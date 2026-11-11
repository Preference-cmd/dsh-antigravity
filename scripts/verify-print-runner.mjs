/**
 * Verifies the print-mode provider end to end with a fixture `agy` binary, so it
 * runs without the real CLI: the runner passes the deployment flags, folds a
 * stream-json turn into the subagent result, maps a child failure to
 * `stopReason: 'error'` with a diagnostic, and reaps a cancelled child.
 *
 * @module dsh-antigravity/scripts/verify-print-runner
 */
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const plugin = await import(new URL('lib/index.js', root).href)

const work = mkdtempSync(join(tmpdir(), 'dsh-antigravity-print-'))
const argvLog = join(work, 'argv')
const binary = join(work, 'agy')
writeFileSync(binary, `#!/bin/sh
printf '%s\\n' "$@" > ${argvLog}
prompt=""
for a in "$@"; do case "$a" in -p=*) prompt="\${a#-p=}" ;; esac; done
case "$prompt" in
  ok)
    echo '{"event":"init","init":{"model":"fixture-model"}}'
    echo '{"event":"step_update","step_update":{"step_type":"user_input","state":"DONE"}}'
    echo '{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":"2 + 3"}}'
    echo '{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":" = 5"}}'
    echo '{"event":"result","result":{"status":"SUCCESS","response":"2 + 3 = 5"}}'
    ;;
  error)
    echo '{"event":"result","result":{"status":"ERROR","response":"","error":"invalid model selection"}}'
    ;;
  crash)
    echo 'agy: something went wrong' >&2
    exit 3
    ;;
  hang)
    sleep 30
    ;;
esac
`)
chmodSync(binary, 0o755)

/** Resolve the one provider this stub context registers. */
let provider
const invoke = (dependencies, callback, scope) => {
  if (dependencies.includes('subagents')) callback(scope)
}

const scope = {
  effect: (fn) => fn(),
  logger: { warn: () => {} },
  subagents: { registerProvider: (registered) => { provider = registered; return () => { provider = undefined } } },
  subprocess: { spawn: spec => spawnHandle(spec) },
}
const mount = (config) => {
  // Normalize exactly as the Cordis loader does before calling apply.
  const resolved = plugin.Config({ command: binary, refreshMs: 60_000, ...config })
  plugin.apply({ inject: (dependencies, callback) => invoke(dependencies, callback, scope) }, resolved)
  return provider
}
mount({})

/** A real child behind the subprocess-handle contract the runner reads. */
function spawnHandle(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...spec.env },
  })
  let escalation
  let terminated = false
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(escalation)
      resolve({ exitCode: code, signal })
    })
  })
  return {
    stdin: undefined,
    stdout: child.stdout,
    stderr: child.stderr,
    control: undefined,
    collected: {},
    done,
    terminate: () => {
      if (terminated) return
      terminated = true
      child.kill('SIGTERM')
      escalation = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, spec.graceMs)
      escalation.unref()
    },
    waitForExit: async (signal) => {
      const bounded = signal === undefined ? undefined : new Promise(resolve => {
        signal.addEventListener('abort', () => { resolve(false) }, { once: true })
      })
      return bounded === undefined
        ? done.then(() => true, () => true)
        : Promise.race([done.then(() => true, () => true), bounded])
    },
  }
}

const run = (prompt, signal = new AbortController().signal) => provider.start({ prompt: [{ type: 'text', text: prompt }], cwd: work, signal })

const failures = []
const check = (passed, label) => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}`)
  if (!passed) failures.push(label)
}
const text = result => result.output.map(block => block.type === 'text' ? block.text : '').join('')

try {
  check(typeof provider?.start === 'function', 'the plugin registers the antigravity provider')

  const completed = await run('ok')
  const completedResult = await completed.result
  check(completedResult.stopReason === 'completed', 'a SUCCESS turn settles as completed')
  check(text(completedResult) === '2 + 3 = 5', 'the folded text deltas become the output')
  await completed.dispose()

  const failed = await run('error')
  const failedResult = await failed.result
  check(failedResult.stopReason === 'error', 'a child-reported ERROR settles as error')
  check(failedResult.diagnostic?.includes('invalid model selection') === true, 'the child failure detail becomes the diagnostic')
  await failed.dispose()

  const crashed = await run('crash')
  const crashedResult = await crashed.result
  check(crashedResult.stopReason === 'error', 'an exit without a result event settles as error')
  check(crashedResult.diagnostic?.includes('something went wrong') === true, 'stderr reaches the diagnostic')
  await crashed.dispose()

  const controller = new AbortController()
  const cancelled = await run('hang', controller.signal)
  controller.abort()
  const cancelledResult = await cancelled.result
  check(cancelledResult.stopReason === 'aborted', 'aborting the request settles as aborted')

  const started = Date.now()
  await cancelled.dispose()
  check(Date.now() - started < 10_000, 'dispose reaps a cancelled child instead of waiting for its own exit')

  const pinned = mount({ model: 'fixture-model', effort: 'high', mode: 'plan' })
  await pinned.start({ prompt: [{ type: 'text', text: 'ok' }], cwd: work, signal: new AbortController().signal }).then(async (pinnedRun) => {
    await pinnedRun.result
    await pinnedRun.dispose()
  })
  const argv = readFileSync(argvLog, 'utf8').trim().split('\n')
  const argvIndex = (flag, value) => argv.indexOf(flag) !== -1 && argv[argv.indexOf(flag) + 1] === value
  check(
    argvIndex('--model', 'fixture-model') && argvIndex('--effort', 'high') && argvIndex('--mode', 'plan'),
    'configured model, effort, and mode reach the child as flags',
  )
  check(argv.includes('--output-format') && argv.includes('stream-json'), 'the runner requests the stream-json event stream')
  check(argv.includes('-p=ok'), 'the prompt travels as one argv element')
  mount({})

  const hanging = await run('hang')
  const disposeStarted = Date.now()
  await hanging.dispose()
  check(Date.now() - disposeStarted < 10_000, 'dispose reaps a live child without an abort')
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exitCode = 1
}
