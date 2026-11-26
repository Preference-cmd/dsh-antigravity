/**
 * Typecheck the plugin against every published harness release it supports.
 *
 * The manifest declares the harness packages as run-time dependencies, so each
 * candidate pins them through `pnpm` overrides, installs, and typechecks the
 * source against the real published types. The lockfile and workspace file are
 * restored afterwards, so a run leaves the checkout as it found it.
 *
 * The run also asserts that every declared runtime dependency range admits its
 * candidate. A range that rejects a host this matrix names leaves the plugin
 * uninstallable there, and the typecheck cannot see it: the overrides decide
 * what is installed, not the declared ranges. Development pins are not checked,
 * because they track the newest verified line by design.
 *
 * Run with `node scripts/verify-version-matrix.mjs`; set DSH_MATRIX_ONLY to a
 * version to check a single candidate.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import semver from 'semver'

const root = resolve(import.meta.dirname, '..')

/** The published harness versions the plugin supports, with the Cordis and Schemastery release each one requires. */
const VERSIONS = [
  ['0.2.2-rc.1', '4.1.0', '3.19.0'],
  ['0.2.3-alpha.2', '4.2.0-alpha.1', '3.20.0-alpha.1'],
]

const manifestPath = resolve(root, 'package.json')
const lockPath = resolve(root, 'pnpm-lock.yaml')
const workspacePath = resolve(root, 'pnpm-workspace.yaml')
const tscPath = resolve(root, 'node_modules/typescript/bin/tsc')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
/** Every package the candidate pins: the harness packages plus the framework pair. */
const pinned = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]
  .filter(name => name.startsWith('@deepseek-ai/') && name !== '@deepseek-ai/cosmokit')
/** The declared runtime ranges a user's install resolves against. */
const runtime = Object.keys(manifest.dependencies)

/**
 * Report whether the declared runtime ranges admit a candidate.
 * @param dsh - The harness release.
 * @returns The conflicts, or null when every range admits it.
 */
function conflicts(dsh) {
  const problems = runtime
    .filter(name => !semver.satisfies(dsh, manifest.dependencies[name]))
    .map(name => `the ${name} dependency range "${manifest.dependencies[name]}" rejects ${dsh}`)
  return problems.length === 0 ? null : problems.join('\n')
}

/**
 * Write the workspace file with one candidate pinned.
 * @param dsh - The harness release to pin the plugin's dependencies to.
 * @param cordis - The Cordis release that harness line requires.
 * @param schemastery - The Schemastery release that harness line requires.
 */
function writeWorkspace(dsh, cordis, schemastery) {
  const lines = ['packages: []', 'overrides:']
  for (const name of pinned) {
    const version = name === '@deepseek-ai/cordis' ? cordis : name === '@deepseek-ai/schemastery' ? schemastery : dsh
    lines.push(`  '${name}': '${version}'`)
  }
  writeFileSync(workspacePath, `${lines.join('\n')}\n`)
}

/**
 * Run the typecheck against the installed harness packages.
 * @returns The compiler output, empty when the check passed.
 */
function typecheck() {
  try {
    execFileSync(process.execPath, [tscPath, '-p', 'tsconfig.json', '--noEmit'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return ''
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

const only = process.env['DSH_MATRIX_ONLY']
const candidates = only === undefined ? VERSIONS : VERSIONS.filter(([dsh]) => dsh === only)
if (candidates.length === 0) {
  console.error(`verify-version-matrix: no candidate matches DSH_MATRIX_ONLY=${only}`)
  process.exit(1)
}

const originalWorkspace = readFileSync(workspacePath, 'utf8')
const originalLock = readFileSync(lockPath, 'utf8')
const results = []

try {
  for (const [dsh, cordis, schemastery] of candidates) {
    const conflict = conflicts(dsh)
    if (conflict !== null) {
      results.push({ dsh, cordis, outcome: 'dependency range rejects the candidate', detail: conflict })
      continue
    }
    writeWorkspace(dsh, cordis, schemastery)
    try {
      // The overrides make the lockfile stale by construction, so the frozen
      // install pnpm turns on under CI has to be turned off explicitly.
      execFileSync('pnpm', ['install', '--no-frozen-lockfile', '--reporter=append-only'], { cwd: root, stdio: 'inherit' })
    } catch (error) {
      results.push({ dsh, cordis, outcome: 'install failed', detail: String(error) })
      continue
    }
    const output = typecheck()
    results.push({
      dsh,
      cordis,
      outcome: output === '' ? 'typecheck passed' : 'typecheck failed',
      detail: output,
    })
  }
} finally {
  writeFileSync(workspacePath, originalWorkspace)
  writeFileSync(lockPath, originalLock)
}

console.log('')
console.log('| DeepSeek Harness | Cordis | Result |')
console.log('| --- | --- | --- |')
for (const result of results) console.log(`| ${result.dsh} | ${result.cordis} | ${result.outcome} |`)
const failures = results.filter(result => result.outcome !== 'typecheck passed')
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${failure.dsh}: ${failure.outcome}`)
    if (failure.detail !== '') console.error(failure.detail)
  }
  process.exit(1)
}
console.log(`verify-version-matrix: ${results.length} harness version(s) typecheck cleanly, and the declared ranges admit them.`)
