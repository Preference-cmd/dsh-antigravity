/**
 * The `antigravity` subagent provider: one `agy` print-mode child per start.
 *
 * Deployment-fixed model, execution mode, and reasoning effort are native
 * `agy` flags (`--model`, `--mode`, `--effort`), so a profile pins them in the
 * bundle patch rather than negotiating them with a running child.
 *
 * @module dsh-antigravity/provider
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  assertUsableCwd,
  NO_START_CAPABILITIES,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { startPrintRun, type PrintRunSpec } from './print.ts'
import type { StoredSettings } from './settings.ts'

/** Provider name the model-facing tool refers to. */
export const PROVIDER_NAME = 'antigravity'

/** Execution modes `agy --mode` accepts. */
export const ANTIGRAVITY_MODES = ['accept-edits', 'auto', 'plan'] as const

/** Reasoning efforts `agy --effort` accepts. */
export const ANTIGRAVITY_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** One execution mode accepted by `agy --mode`. */
export type AntigravityMode = (typeof ANTIGRAVITY_MODES)[number]

/** One reasoning effort accepted by `agy --effort`. */
export type AntigravityEffort = (typeof ANTIGRAVITY_EFFORTS)[number]

/** Deployment-fixed provider settings resolved from plugin config. */
export interface ProviderConfig {
  /** Registry name on `ctx.subagents`. */
  readonly providerName: string
  /** The `agy` executable. */
  readonly command: string
  /** Model id fixed for every run; omitted to inherit the account default. */
  readonly model?: string | undefined
  /** Execution mode fixed for every run; omitted to inherit `agy`'s own. */
  readonly mode?: AntigravityMode | undefined
  /** Reasoning effort fixed for every run; omitted to inherit the model default. */
  readonly effort?: AntigravityEffort | undefined
  /** Additional flags placed after the deployment flags. */
  readonly args: readonly string[]
  /** Child environment layered over the scrubbed parent base. */
  readonly env: Record<string, string>
  /** Bounded teardown grace for the managed process range. */
  readonly disposeGraceMs: number
  /** The plugin's own selection, read on every start so a settings change applies to the next run. */
  readonly readSelection: () => StoredSettings
}

/**
 * Compose the deployment flags for one run.
 * @param config - resolved provider settings.
 * @returns the flags placed before `--output-format` and the prompt.
 */
export function deploymentArgs(config: ProviderConfig): string[] {
  const args: string[] = []
  if (config.model !== undefined) args.push('--model', config.model)
  if (config.mode !== undefined) args.push('--mode', config.mode)
  if (config.effort !== undefined) args.push('--effort', config.effort)
  args.push(...config.args)
  return args
}

/** One `agy` print-mode provider instance. */
class AntigravityProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  // Context contract: an out-of-process child starts fresh — no parent conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ProviderConfig,
  ) {}

  /**
   * Pick the model this run uses: the deployment pin wins, then the plugin's
   * selected default. A selection that excludes the effective model is a
   * configuration error rather than a silently ignored toggle.
   * @returns the model id, or undefined to inherit the account default.
   * @throws when the effective model is outside the available set.
   */
  private resolveModel(): string | undefined {
    const selection = this.config.readSelection()
    const model = this.config.model ?? selection.defaultModel
    if (model !== undefined && selection.available.length > 0 && !selection.available.includes(model)) {
      throw new Error(
        `dsh-antigravity: model "${model}" is not among the plugin's available models; update the model settings on the plugin page`,
      )
    }
    return model
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    let cwd: string
    try {
      cwd = assertUsableCwd('dsh-antigravity', 'child cwd', request.cwd)
    } catch (error: unknown) {
      this.ctx.logger.warn(`dsh-antigravity "${this.name}": child start failed: %o`, error)
      throw new Error(`dsh-antigravity: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    if (request.signal.aborted) {
      throw new Error('dsh-antigravity: request was aborted before the agy child started')
    }
    const model = this.resolveModel()
    const spec: PrintRunSpec = {
      command: this.config.command,
      args: deploymentArgs({ ...this.config, ...model === undefined ? {} : { model } }),
      cwd,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`dsh-antigravity "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startPrintRun(request, spec)
  }
}

/**
 * Register the provider on the subagent service.
 * @param ctx - context carrying the subagent and subprocess services.
 * @param config - resolved provider settings.
 */
export function registerAntigravityProvider(ctx: Context, config: ProviderConfig): void {
  // The registration is an effect so unloading this plugin also unregisters
  // the provider instead of blocking the next mount with a duplicate name.
  ctx.effect(() => ctx.subagents.registerProvider(new AntigravityProvider(config.providerName, ctx, config)))
}
