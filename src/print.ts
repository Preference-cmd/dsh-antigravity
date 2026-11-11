/**
 * Print-mode runner for `agy`: one non-interactive turn over
 * `--output-format stream-json`, folded into one subagent result.
 *
 * The child publishes three event kinds — `init`, `step_update`, and `result`.
 * Assistant text arrives as `step_update.text_delta` pieces and the terminal
 * `result.response` repeats the completed answer, so the fold prefers the
 * streamed text and falls back to the response when no delta was observed.
 *
 * @module dsh-antigravity/print
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  AssistantOutputFold,
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'

/**
 * Conservative bound for one `-p` argument. Print mode takes the prompt on the
 * command line, where the host caps total argv bytes; a longer prompt fails
 * with an actionable diagnostic instead of an opaque `E2BIG` spawn error.
 */
const MAX_PROMPT_BYTES = 128 * 1024

/** The `result` payload of the last stream-json event. */
interface PrintTerminalEvent {
  readonly status?: string | undefined
  readonly response?: string | undefined
  readonly error?: string | undefined
  readonly finished_reason?: string | undefined
}

/** One decoded stream-json line; unknown fields are ignored. */
interface PrintEvent {
  readonly event?: string | undefined
  readonly step_update?: { readonly step_type?: string | undefined; readonly text_delta?: string | undefined } | undefined
  readonly result?: PrintTerminalEvent | undefined
}

/** One resolved print-mode invocation. */
export interface PrintRunSpec {
  /** The `agy` executable. */
  readonly command: string
  /** Deployment-fixed flags placed before the prompt (`--model`, `--mode`, `--effort`, …). */
  readonly args: readonly string[]
  /** Absolute child working directory. */
  readonly cwd: string
  /** Child environment layered over the subprocess seam's scrubbed parent base. */
  readonly env: Record<string, string>
  /** Bounded teardown grace for the managed process range. */
  readonly disposeGraceMs: number
  /** Spawn through the caller's subprocess service. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a child-level failure flattened to a stop reason. */
  readonly onError?: ((error: Error, stopReason: SubagentStopReason) => void) | undefined
}

/**
 * Flatten the prompt into the single argv text print mode accepts.
 * @param prompt - the request's content blocks.
 * @returns the joined text.
 * @throws when the prompt carries a non-text block, which print mode cannot express.
 */
export function promptText(prompt: readonly ContentBlock[]): string {
  const segments: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error(`dsh-antigravity: print mode accepts text prompts only, received a "${block.type}" block`)
    }
    segments.push(block.text)
  }
  return segments.join('\n\n')
}

/** Read the assistant text a `step_update` contributes, if any. */
function stepText(event: PrintEvent): string | undefined {
  const update = event.step_update
  if (update === undefined || update.step_type !== 'agent_response') return undefined
  return update.text_delta
}

/**
 * Start one print-mode child and publish its run handle.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved invocation: command, flags, cwd, env, grace, and spawn.
 * @returns the ready run handle for the child process.
 */
export async function startPrintRun(request: SubagentStartRequest, spec: PrintRunSpec): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('dsh-antigravity: request was aborted before the agy child started')

  const text = promptText(request.prompt)
  if (Buffer.byteLength(text, 'utf8') > MAX_PROMPT_BYTES) {
    throw new Error(
      `dsh-antigravity: prompt exceeds the ${MAX_PROMPT_BYTES} byte print-mode argv limit; shorten the task`,
    )
  }

  const id = brandString<SubagentRun['id']>(randomUUID())
  const argv = [spec.command, ...spec.args, '--output-format', 'stream-json', `-p=${text}`]

  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv,
      cwd: spec.cwd,
      // The turn needs no further input: the prompt is complete in argv.
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error: unknown) {
    throw new Error(`dsh-antigravity: agy could not be spawned: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  /* v8 ignore start -- 'pipe' dispositions expose both streams by the seam contract; defensive. */
  if (child.stdout === undefined || child.stderr === undefined) {
    throw new Error('dsh-antigravity: subprocess implementation dropped a piped stream')
  }
  /* v8 ignore stop */

  // The seam contract forbids a published result from rejecting; observe a
  // child that dies while local cancellation settles the run.
  child.done.catch(() => { /* observed by the settlement race */ })

  const fold = new AssistantOutputFold()
  const flags = { cancelled: false }
  let terminal: PrintTerminalEvent | undefined
  // The child's own failure report wins over ambient stderr: it names the
  // rejected option or the model error the operator has to act on.
  let failureDetail: string | undefined
  let stderrText = ''
  let buffered = ''

  const observeLine = (line: string): void => {
    if (line.length === 0) return
    let event: PrintEvent
    try {
      event = JSON.parse(line) as PrintEvent
    } catch {
      // `agy` writes progress chatter to stderr; an unparsable stdout line is
      // not a turn fact and cannot be interpreted without guessing its grammar.
      return
    }
    const delta = stepText(event)
    if (delta !== undefined) fold.pushText(delta)
    if (event.result !== undefined) terminal = event.result
  }

  const consume = (chunk: string): void => {
    buffered += chunk
    let index = buffered.indexOf('\n')
    while (index !== -1) {
      observeLine(buffered.slice(0, index).trim())
      buffered = buffered.slice(index + 1)
      index = buffered.indexOf('\n')
    }
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', consume)
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderrText += chunk })

  let settleCancel!: () => void
  const cancelSettled = new Promise<void>((resolve) => { settleCancel = resolve })
  const requestCancel = (): void => {
    if (flags.cancelled) return
    flags.cancelled = true
    settleCancel()
    // The process range is the only cancellation channel print mode offers.
    child.terminate()
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  const collectOutput = (): readonly ContentBlock[] => fold.collect() ?? []
  const collectDiagnostic = (): string | undefined => {
    if (failureDetail !== undefined) return failureDetail
    const trimmed = stderrText.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async (): Promise<SubagentResult> => {
      await Promise.race([
        child.done,
        cancelSettled.then((): never => { throw new Error('subagent cancelled while the agy turn was running') }),
      ])
      // A final line without a trailing newline still belongs to the turn.
      observeLine(buffered.trim())

      const settled = terminal
      if (settled === undefined) {
        throw new Error('dsh-antigravity: agy exited without reporting a result event')
      }
      if (settled.status !== 'SUCCESS') {
        failureDetail = `agy reported ${settled.status ?? 'no status'}: ${settled.error ?? settled.response ?? 'no detail'}`
        throw new Error(`dsh-antigravity: ${failureDetail}`)
      }
      // The streamed deltas are the turn's text; the response repeats them and
      // covers a child that emitted only a terminal event.
      if (fold.collect() === undefined && settled.response !== undefined && settled.response.length > 0) {
        fold.pushText(settled.response)
      }
      return { output: collectOutput(), stopReason: 'completed' }
    },
    collectOutput,
    collectDiagnostic,
    cancelled: () => flags.cancelled,
    ...spec.onError === undefined ? {} : { onError: spec.onError },
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({
    id,
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: async () => {
      child.terminate()
      const exited = await child.waitForExit(AbortSignal.timeout(Math.ceil(spec.disposeGraceMs)))
      if (!exited) {
        throw new Error(`dsh-antigravity: agy did not exit within ${spec.disposeGraceMs}ms; the process range is still live`)
      }
    },
  })
}
