/**
 * Host half of the Antigravity plugin: one authenticated read route the panel
 * polls on demand. The probe runs three zero-token CLI commands, so the route
 * caches its answer and shares one in-flight probe between concurrent callers.
 *
 * @module dsh-antigravity
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'
import { STATUS_PATH, type AntigravityStatus } from './protocol.ts'
import { defaultCommand, readAntigravityStatus } from './status.ts'

export const name = 'antigravity-status'

export { STATUS_PATH }

/** The route needs the browser surface only; a headless profile skips it. */
export const inject: string[] = []

/** Plugin config: which binary to probe and how long an answer stays fresh. */
export interface Config {
  /** The `agy` executable; defaults to `$AGY_BIN` or the per-user install path. */
  command?: string
  /** Cache lifetime for one probe, in milliseconds; a `refresh` query parameter bypasses it. */
  refreshMs: number
}

export const Config: z<Config> = z.object({
  command: z.string(),
  refreshMs: z.natural().default(60_000),
})

/**
 * Serve the account status from a scope that exists only where `connection` does.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const command = config.command ?? defaultCommand()
  // A headless profile never creates this scope, so its tree stays free of a
  // row that cannot work there.
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
