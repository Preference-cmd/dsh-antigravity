/**
 * Verifies the model-selection contract: parsing `agy models`, the settings
 * document's read/write and validation rules, the route that edits it, and the
 * provider's use of the stored default — all against fixture binaries, so no
 * real `agy` and no browser are involved.
 *
 * @module dsh-antigravity/scripts/verify-model-settings
 */
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const plugin = await import(new URL('lib/index.js', root).href)

const work = mkdtempSync(join(tmpdir(), 'dsh-antigravity-settings-'))
const argvLog = join(work, 'argv')
const settingsFile = join(work, 'settings.json')
const binary = join(work, 'agy')

writeFileSync(binary, `#!/bin/sh
case "$1" in
  models)
    printf 'gemini-3.8-flash\\tGemini 3.8 Flash\\n'
    printf 'claude-sonnet-4-6\\tClaude Sonnet 4.6 (Thinking)\\n'
    ;;
  *)
    printf '%s\\n' "$@" > ${argvLog}
    echo '{"event":"result","result":{"status":"SUCCESS","response":"ok"}}'
    ;;
esac
`)
chmodSync(binary, 0o755)

const failures = []
const check = (passed, label) => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}`)
  if (!passed) failures.push(label)
}

// ---- the route surface -----------------------------------------------------
let route
let provider
const scoped = {
  effect: (fn) => fn(),
  logger: { warn: () => {} },
  connection: { fetch: { register: (registered) => { route = registered; return () => {} } } },
  subagents: { registerProvider: (registered) => { provider = registered; return () => {} } },
  subprocess: { spawn: spec => spawnHandle(spec) },
}
const inject = (dependencies, callback) => {
  if (dependencies.includes('connection') || dependencies.includes('subagents')) callback(scoped)
}
plugin.apply({ inject }, plugin.Config({ command: binary, refreshMs: 60_000, settingsFile }))

/** A real child behind the subprocess-handle contract the runner reads. */
function spawnHandle(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...spec.env },
    detached: true,
  })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
  })
  return {
    stdin: undefined,
    stdout: child.stdout,
    stderr: child.stderr,
    control: undefined,
    collected: {},
    done,
    terminate: () => {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
    },
    waitForExit: async (signal) => {
      if (signal === undefined) return done.then(() => true, () => true)
      return Promise.race([
        done.then(() => true, () => true),
        new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true })),
      ])
    },
  }
}

/** Mount a second instance whose deployment config pins one model. */
function mountPinned(model) {
  let mounted
  const pinScope = { ...scoped, subagents: { registerProvider: (registered) => { mounted = registered; return () => {} } } }
  plugin.apply(
    { inject: (dependencies, callback) => { if (dependencies.includes('subagents')) callback(pinScope) } },
    plugin.Config({ command: binary, refreshMs: 60_000, settingsFile, model }),
  )
  return mounted
}

const read = async () => {
  const response = await route.fetch(new Request('http://127.0.0.1/api/antigravity/settings'))
  return { status: response.status, body: await response.json() }
}
const post = async (body) => {
  const response = await route.fetch(new Request('http://127.0.0.1/api/antigravity/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() }
}

const runDelegation = async () => {
  const controller = new AbortController()
  const run = await provider.start({ prompt: [{ type: 'text', text: 'ping' }], cwd: work, signal: controller.signal })
  await run.result
  await run.dispose()
  return readFileSync(argvLog, 'utf8').trim().split('\n')
}

try {
  const initial = await read()
  check(initial.status === 200 && initial.body.models.length === 2, 'the route lists the fixture models')
  check(initial.body.models[1].name === 'Claude Sonnet 4.6 (Thinking)', 'model names keep their display text')
  check(initial.body.available.length === 0 && initial.body.defaultModel === undefined, 'a fresh profile has no selection')

  const saved = await post({ available: ['claude-sonnet-4-6'], defaultModel: 'claude-sonnet-4-6' })
  check(saved.status === 200 && saved.body.defaultModel === 'claude-sonnet-4-6', 'the route persists a selection')
  const stored = JSON.parse(readFileSync(settingsFile, 'utf8'))
  check(stored.version === 1 && stored.available.length === 1, 'the document carries a version and the selection')

  const rejectedUnknown = await post({ available: ['nope-1'] })
  check(rejectedUnknown.status === 400 && /unknown model/i.test(rejectedUnknown.body.error), 'an unknown model id is rejected')

  const rejectedDefault = await post({ available: ['claude-sonnet-4-6'], defaultModel: 'gemini-3.8-flash' })
  check(rejectedDefault.status === 400, 'a default outside the available set is rejected')

  const badJson = await post('{')
  check(badJson.status === 400, 'a malformed body is rejected')

  const argv = await runDelegation()
  check(argv.includes('--model') && argv[argv.indexOf('--model') + 1] === 'claude-sonnet-4-6', 'the stored default reaches the child as --model')

  await post({ available: ['gemini-3.8-flash'] })
  const pinned = mountPinned('claude-sonnet-4-6')
  let rejected = false
  try {
    await pinned.start({ prompt: [{ type: 'text', text: 'ping' }], cwd: work, signal: new AbortController().signal })
  } catch (error) {
    rejected = /not among the plugin's available models/.test(String(error))
  }
  check(rejected, 'a deployment pin outside the available set fails the start')

  writeFileSync(settingsFile, '{ not json')
  const recovered = await read()
  check(recovered.status === 200 && recovered.body.available.length === 0, 'a corrupt document reads as no selection')
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exitCode = 1
}
