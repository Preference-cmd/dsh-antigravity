/**
 * Verifies the status route's cache contract with a fixture `agy` binary, so it
 * runs without the real CLI: a plain GET is cached for `refreshMs`, concurrent
 * probes share one run, and `?refresh=1` bypasses the cache.
 *
 * @module dsh-antigravity/scripts/verify-route-cache
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const plugin = await import(new URL('lib/index.js', root).href)

const work = mkdtempSync(join(tmpdir(), 'dsh-antigravity-'))
const calls = join(work, 'calls')
const binary = join(work, 'agy')
writeFileSync(binary, `#!/bin/sh
echo call >> ${calls}
case "$3" in
  -p=/usage) echo '{"command":{"data":{"groups":[{"name":"Fixture","buckets":[{"id":"b1","name":"Window","window":"5h","remaining_fraction":0.5}]}]}}}' ;;
  -p=/credits) echo '{"command":{"data":{"remaining_credits":3,"upgrade_uri":"https://example.test"}}}' ;;
  *) echo '{"models":[]}' ;;
esac
`)
chmodSync(binary, 0o755)

const invocations = () => {
  try {
    return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

let route
const scoped = {
  effect: (fn) => fn(),
  connection: { fetch: { register: (registered) => { route = registered; return () => {} } } },
}
plugin.apply({ inject: (_dependencies, callback) => callback(scoped) }, { command: binary, refreshMs: 60_000 })

const get = async (suffix = '') => {
  const started = Date.now()
  const response = await route.fetch(new Request(`http://127.0.0.1/api/antigravity/status${suffix}`))
  return { elapsed: Date.now() - started, body: await response.json() }
}

const failures = []
const check = (passed, label) => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}`)
  if (!passed) failures.push(label)
}

try {
  const first = await get()
  check(first.body.state === 'signed-in' && first.body.quota.length === 1, 'probe reports the fixture account')
  check(invocations() === 3, 'one probe runs the three CLI commands')

  const cached = await get()
  check(cached.body.checkedAt === first.body.checkedAt && cached.elapsed < 1000 && invocations() === 3, 'a second GET is served from the cache')

  const [sharedA, sharedB] = await Promise.all([get('?refresh=1'), get('?refresh=1')])
  check(invocations() === 6 && sharedA.body.checkedAt === sharedB.body.checkedAt, 'concurrent forced GETs share one probe')

  const forced = await get('?refresh=1')
  check(invocations() === 9 && forced.body.checkedAt >= sharedA.body.checkedAt, 'a forced GET re-probes')
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exitCode = 1
}
