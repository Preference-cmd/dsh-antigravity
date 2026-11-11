/**
 * Host-side Antigravity account and quota probe.
 *
 * Every datum comes from a slash command the CLI answers itself: they cost no
 * model tokens (`num_turns: 0`, zeroed usage), so the panel may refresh them
 * freely. `agy models` is the sign-in probe — unlike a prompt it fails fast
 * instead of blocking in an interactive OAuth flow.
 *
 * @module dsh-antigravity/status
 */

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AntigravityBucket, AntigravityQuotaGroup, AntigravityStatus } from './protocol.ts'

/** Default binary location: the per-user install `agy` documents. */
export function defaultCommand(): string {
  return process.env.AGY_BIN ?? join(homedir(), '.local', 'bin', 'agy')
}

type CommandOutcome =
  | { readonly kind: 'ok'; readonly stdout: string }
  | { readonly kind: 'failed'; readonly code: number; readonly stderr: string }
  | { readonly kind: 'missing' }

/**
 * Run one CLI invocation and capture its streams.
 * @param command - the `agy` executable.
 * @param args - arguments after the executable.
 * @param timeoutMs - hard limit for the child process.
 * @returns the outcome; a spawn failure is `missing`, a non-zero exit is `failed`.
 */
function run(command: string, args: readonly string[], timeoutMs: number): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ kind: 'ok', stdout })
        return
      }
      if (typeof error.code !== 'number') {
        resolve({ kind: 'missing' })
        return
      }
      resolve({ kind: 'failed', code: error.code, stderr })
    })
  })
}

/**
 * Read one slash-command payload.
 * @param command - the `agy` executable.
 * @param slash - the command text, e.g. `/usage`.
 * @returns the decoded JSON body, or undefined when the call failed.
 */
async function readSlash(command: string, slash: string): Promise<Record<string, unknown> | undefined> {
  const outcome = await run(command, ['--output-format', 'json', `-p=${slash}`], 20_000)
  if (outcome.kind !== 'ok') return undefined
  try {
    const parsed: unknown = JSON.parse(outcome.stdout)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Read one nested object path without assuming the CLI's full envelope. */
function at(value: unknown, ...path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Project the CLI's `/usage` envelope onto the panel's quota rows. */
function readQuota(payload: Record<string, unknown> | undefined): AntigravityQuotaGroup[] {
  const groups = at(payload, 'command', 'data', 'groups')
  if (!Array.isArray(groups)) return []
  const quota: AntigravityQuotaGroup[] = []
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue
    const name = (group as Record<string, unknown>).name
    const buckets = (group as Record<string, unknown>).buckets
    if (typeof name !== 'string' || !Array.isArray(buckets)) continue
    const rows: AntigravityBucket[] = []
    for (const bucket of buckets) {
      if (typeof bucket !== 'object' || bucket === null) continue
      const fields = bucket as Record<string, unknown>
      if (typeof fields.id !== 'string' || typeof fields.remaining_fraction !== 'number') continue
      rows.push({
        id: fields.id,
        name: typeof fields.name === 'string' ? fields.name : fields.id,
        window: typeof fields.window === 'string' ? fields.window : '',
        remainingFraction: Math.min(1, Math.max(0, fields.remaining_fraction)),
        resetTime: typeof fields.reset_time === 'string' ? fields.reset_time : '',
      })
    }
    quota.push({ group: name, buckets: rows })
  }
  return quota
}

/** Project the CLI's `/credits` envelope onto the panel's credits row. */
function readCredits(payload: Record<string, unknown> | undefined): AntigravityStatus['credits'] {
  const remaining = at(payload, 'command', 'data', 'remaining_credits')
  const upgrade = at(payload, 'command', 'data', 'upgrade_uri')
  if (typeof remaining !== 'number') return undefined
  return { remaining, upgradeUri: typeof upgrade === 'string' ? upgrade : '' }
}

/**
 * Probe one account: sign-in first, then the two zero-cost quota commands.
 * @param command - the `agy` executable.
 * @returns the panel payload with a fixed reason when something is missing.
 */
export async function readAntigravityStatus(command: string): Promise<AntigravityStatus> {
  const checkedAt = Date.now()
  // All three calls are independent zero-token probes; running them together
  // keeps the panel's first paint to one CLI cold start instead of three.
  const [signIn, usage, credits] = await Promise.all([
    run(command, ['models'], 15_000),
    readSlash(command, '/usage'),
    readSlash(command, '/credits'),
  ])
  if (signIn.kind === 'missing') {
    return { state: 'unavailable', checkedAt, quota: [], detail: 'binary-not-found' }
  }
  if (signIn.kind === 'failed') {
    return { state: 'signed-out', checkedAt, quota: [], detail: 'not-signed-in' }
  }
  const quota = readQuota(usage)
  const credit = readCredits(credits)
  return {
    state: 'signed-in',
    checkedAt,
    quota,
    ...(credit === undefined ? {} : { credits: credit }),
    ...(quota.length === 0 ? { detail: 'quota-unavailable' } : {}),
  }
}
