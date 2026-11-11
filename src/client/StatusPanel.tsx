/**
 * The bundle page's status section: sign-in state, quota windows, and credits.
 * It renders only for this plugin's own bundle, so the slot stays quiet on
 * every other plugin page.
 *
 * @module dsh-antigravity/client/StatusPanel
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { STATUS_PATH, type AntigravityStatus } from '../protocol.ts'
import { NS } from './locales.ts'

/** The detail-page subject this section reacts to. */
interface Subject {
  readonly kind: string
  readonly pkg?: { readonly name?: string }
}

/** The section entry the slot renders for every plugin page. */
type PanelProps = { readonly subject: Subject } & PropsLocale<typeof NS>

/** The translate seat this section passes down to its rows. */
type Translate = PanelProps['t']

/**
 * Format an instant in the Harness language, which the locale service publishes
 * on the document, rather than in the operating system's locale.
 * @param value - epoch milliseconds or an ISO instant.
 * @returns the localized date and time.
 */
function formatInstant(value: number | string, withTime: boolean): string {
  const language = document.documentElement.lang
  const locale = language === '' ? undefined : language
  const instant = new Date(value)
  return withTime ? instant.toLocaleString(locale) : instant.toLocaleTimeString(locale)
}

/** The section entry rendered for a plugin detail page. */
export function StatusPanel({ subject, t }: PanelProps) {
  if (subject.kind !== 'bundle' || subject.pkg?.name !== 'dsh-antigravity') return null
  return <StatusCard t={t} />
}

const BORDER = 'var(--dsw-alias-border-l1, #ddd)'
const LABEL_PRIMARY = 'var(--dsw-alias-label-primary, inherit)'
const LABEL_SECONDARY = 'var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6))'
const LABEL_TERTIARY = 'var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45))'
const SUCCESS = 'var(--dsw-alias-state-success-primary, #2f9e44)'
const WARN = 'var(--dsw-alias-state-warn-primary, #f08c00)'
const ERROR = 'var(--dsw-alias-state-error-primary, #e03131)'

/** Remaining share at which a window stops reading as comfortable. */
function barColor(fraction: number): string {
  if (fraction <= 0.1) return ERROR
  if (fraction <= 0.3) return WARN
  return SUCCESS
}

/** One quota window: label, remaining bar, and its refresh instant. */
function BucketRow({ t, name, fraction, resetTime }: {
  readonly t: Translate
  readonly name: string
  readonly fraction: number
  readonly resetTime: string
}) {
  const percent = Math.round(fraction * 100)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: LABEL_SECONDARY }}>
        <span>{name}</span>
        <span style={{ color: LABEL_TERTIARY }}>
          {`${t('remaining')} ${percent}%`}
          {resetTime === '' ? '' : ` · ${t('resetAt')} ${formatInstant(resetTime, true)}`}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08))' }}>
        <div style={{ width: `${Math.max(2, percent)}%`, height: '100%', borderRadius: 3, background: barColor(fraction) }} />
      </div>
    </div>
  )
}

/** The card itself: fetch on mount, refresh on demand. */
function StatusCard({ t }: { readonly t: Translate }) {
  const [status, setStatus] = useState<AntigravityStatus | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(true)

  const load = useCallback(async (force: boolean): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch(force ? `${STATUS_PATH}?refresh=1` : STATUS_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`status ${response.status}`)
      setStatus(await response.json() as AntigravityStatus)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void load(false) }, [load])

  const badge = failed || status?.state === 'unavailable'
    ? { text: t('unavailable'), color: ERROR }
    : status === undefined
      ? { text: t('checking'), color: LABEL_TERTIARY }
      : status.state === 'signed-in'
        ? { text: t('signedIn'), color: SUCCESS }
        : { text: t('signedOut'), color: WARN }

  const hint = failed
    ? t('failedHint')
    : status === undefined
      ? undefined
      : status.detail === 'binary-not-found'
        ? t('missingHint')
        : status.state === 'unavailable'
          ? t('failedHint')
          : status.state === 'signed-out'
            ? t('signedOutHint')
            : status.quota.length === 0 ? t('quotaUnavailable') : undefined

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: `0.5px solid ${BORDER}`, borderRadius: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: LABEL_PRIMARY }}>{t('title')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: LABEL_SECONDARY }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: badge.color }} />
            {badge.text}
          </span>
        </div>
        <button
          type="button"
          onClick={() => { void load(true) }}
          disabled={busy}
          style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
            color: LABEL_SECONDARY, background: 'transparent', border: `0.5px solid ${BORDER}`,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? t('checking') : t('refresh')}
        </button>
      </header>

      {hint === undefined ? undefined : <p style={{ margin: 0, fontSize: 12, color: LABEL_TERTIARY }}>{hint}</p>}

      {status?.quota.map(group => (
        <div key={group.group} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: LABEL_SECONDARY }}>{group.group}</span>
          {group.buckets.map(bucket => (
            <BucketRow key={bucket.id} t={t} name={bucket.name} fraction={bucket.remainingFraction} resetTime={bucket.resetTime} />
          ))}
        </div>
      ))}

      {status?.credits === undefined ? undefined : (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: LABEL_SECONDARY }}>
          <span>{t('credits')}</span>
          <span>{status.credits.remaining}</span>
        </div>
      )}

      {status === undefined ? undefined : (
        <footer style={{ fontSize: 11, color: LABEL_TERTIARY }}>
          {`${t('checkedAt')} ${formatInstant(status.checkedAt, false)}`}
        </footer>
      )}
    </section>
  )
}
