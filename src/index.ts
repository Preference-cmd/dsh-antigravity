/**
 * Host half of the Antigravity plugin: the `antigravity` subagent provider plus
 * the account panel's read route.
 *
 * The provider runs one `agy` print-mode child per start. The probe behind the
 * route runs three zero-token CLI commands, so the route caches its answer and
 * shares one in-flight probe between concurrent callers.
 *
 * @module dsh-antigravity
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import {
  ANTIGRAVITY_EFFORTS,
  ANTIGRAVITY_MODES,
  PROVIDER_NAME,
  registerAntigravityProvider,
  type AntigravityEffort,
  type AntigravityMode,
} from './provider.ts'
import { STATUS_PATH, type AntigravityStatus } from './protocol.ts'
import { defaultCommand, readAntigravityStatus } from './status.ts'

export const name = 'dsh-antigravity'

export { STATUS_PATH }

/**
 * Both halves are topology-dependent: a profile without a browser surface has
 * no `connection`, and one without delegation has no `subagents`. Each half
 * therefore mounts inside its own injection scope.
 */
export const inject: string[] = []

/** Milliseconds a teardown may wait before the managed range is declared live. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Plugin config: the binary, the delegation defaults, and the probe cache. */
export interface Config {
  /** The `agy` executable; defaults to `$AGY_BIN` or the per-user install path. */
  command?: string
  /** Cache lifetime for one probe, in milliseconds; a `refresh` query parameter bypasses it. */
  refreshMs: number
  /** Registry name on `ctx.subagents`. */
  providerName: string
  /** Model id fixed for every delegated run; omitted to inherit the account default. */
  model?: string
  /** Execution mode fixed for every delegated run. */
  mode?: AntigravityMode
  /** Reasoning effort fixed for every delegated run; a model that rejects it fails the run. */
  effort?: AntigravityEffort
  /** Additional `agy` flags for every run, placed after the deployment flags. */
  args: string[]
  /** Child environment layered over the credential-scrubbed parent environment. */
  env: Record<string, string>
  /** Grace in milliseconds for the spaced termination tiers of one child range. */
  disposeGraceMs: number
}

export const Config: z<Config> = z.object({
  command: z.string(),
  refreshMs: z.natural().default(60_000),
  providerName: z.string().min(1).default(PROVIDER_NAME),
  model: z.string().min(1),
  mode: z.union([...ANTIGRAVITY_MODES]),
  effort: z.union([...ANTIGRAVITY_EFFORTS]),
  args: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.natural().default(3_000),
})

/**
 * Register the provider and serve the account status.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const command = config.command ?? defaultCommand()
  if (config.disposeGraceMs <= 0 || config.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-antigravity: disposeGraceMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }

  // A headless profile never creates this scope, so its tree stays free of a
  // row that cannot work there.
  ctx.inject(['subagents', 'subprocess'], (scoped: Context) => {
    registerAntigravityProvider(scoped, {
      providerName: config.providerName,
      command,
      ...config.model === undefined ? {} : { model: config.model },
      ...config.mode === undefined ? {} : { mode: config.mode },
      ...config.effort === undefined ? {} : { effort: config.effort },
      args: config.args,
      env: config.env,
      disposeGraceMs: config.disposeGraceMs,
    })
  })

  // The panel's route needs the browser surface only; a headless profile
  // skips this scope.
  ctx.inject(['connection'], (scoped: Context) => {
    let cached: { readonly at: number; readonly value: AntigravityStatus } | undefined
    let inflight: Promise<AntigravityStatus> | undefined
    const read = (force: boolean): Promise<AntigravityStatus> => {
      if (!force && cached !== undefined && Date.now() - cached.at < config.refreshMs) return Promise.resolve(cached.value)
      inflight ??= readAntigravityStatus(command)
        .catch((): AntigravityStatus => ({ state: 'unavailable', checkedAt: Date.now(), quota: [], detail: 'probe-failed' }))
        .then((value) => {
          cached = { at: Date.now(), value }
          inflight = undefined
          return value
        })
      return inflight
    }
    scoped.effect(() => scoped.connection.fetch.register({
      path: STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => Response.json(await read(new URL(request.url).searchParams.has('refresh'))),
    }), 'antigravity-status: read route')
  })
}
