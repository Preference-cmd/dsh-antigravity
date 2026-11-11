/**
 * Browser half: mount the Antigravity status section on this plugin's bundle page.
 *
 * Copy follows the Harness language preference through the `locale` service,
 * so the section reads in the same language as the page hosting it.
 *
 * @module dsh-antigravity/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { StatusPanel } from './StatusPanel.tsx'
import { NS, en, zh, type AntigravityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    dshAntigravity: AntigravityKey
  }
}

export const inject = ['slots', 'locale']

/**
 * Register the dictionaries and the section entry.
 * @param ctx - Browser plugin context; the injected services are ready because of {@link inject}.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-antigravity: dictionaries')
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section',
    id: 'antigravity-status',
    locale: NS,
  }, StatusPanel))
}
