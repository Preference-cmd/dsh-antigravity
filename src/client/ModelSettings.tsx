/**
 * The bundle page's model section: which `agy` models the plugin may use, and
 * which one it picks when the deployment config does not pin a model.
 *
 * The selection lives in the Host document, so every device reading this
 * profile sees the same set; the provider re-reads it on the next delegation.
 *
 * @module dsh-antigravity/client/ModelSettings
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SETTINGS_PATH, type AntigravitySettingsPayload } from '../protocol.ts'
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

const BORDER = 'var(--dsw-alias-border-l1, #ddd)'
const LABEL_PRIMARY = 'var(--dsw-alias-label-primary, inherit)'
const LABEL_SECONDARY = 'var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6))'
const LABEL_TERTIARY = 'var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45))'
const ERROR = 'var(--dsw-alias-state-error-primary, #e03131)'

/** Post one selection and return the normalized payload. */
async function saveSelection(payload: { available: string[]; defaultModel?: string }): Promise<AntigravitySettingsPayload> {
  const response = await fetch(SETTINGS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `${response.status}`
    throw new Error(detail)
  }
  return body as AntigravitySettingsPayload
}

/** The model section rendered for this plugin's detail page. */
export function ModelSettings({ subject, t }: PanelProps) {
  if (subject.kind !== 'bundle' || subject.pkg?.name !== 'dsh-antigravity') return null
  return <ModelCard t={t} />
}

/** One row: availability toggle, display name, and the default choice. */
function ModelRow({ t, id, name, checked, isDefault, onToggle, onDefault }: {
  readonly t: Translate
  readonly id: string
  readonly name: string
  readonly checked: boolean
  readonly isDefault: boolean
  readonly onToggle: (next: boolean) => void
  readonly onDefault: () => void
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 0',
      borderTop: `1px solid ${BORDER}`,
    }}>
      <input type="checkbox" checked={checked} aria-label={`${name} — ${t('modelsAvailable')}`} onChange={event => onToggle(event.target.checked)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: checked ? LABEL_PRIMARY : LABEL_TERTIARY }}>{name}</span>
        <span style={{ fontSize: 11, color: LABEL_TERTIARY, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{id}</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: isDefault ? LABEL_PRIMARY : LABEL_SECONDARY }}>
        <input type="radio" name="antigravity-default-model" checked={isDefault} onChange={onDefault} />
        {t('modelsDefault')}
      </label>
    </div>
  )
}

/** The stateful card: load, edit, and persist the selection. */
function ModelCard({ t }: { readonly t: Translate }) {
  const [payload, setPayload] = useState<AntigravitySettingsPayload | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetch(SETTINGS_PATH)
      .then(async response => {
        const body: unknown = await response.json()
        if (live) setPayload(body as AntigravitySettingsPayload)
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  const commit = useCallback(async (next: { available: string[]; defaultModel?: string }) => {
    setSaving(true)
    setError(undefined)
    try {
      setPayload(await saveSelection(next))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }, [])

  if (failed) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: LABEL_PRIMARY }}>{t('modelsTitle')}</h2>
        <span style={{ fontSize: 12, color: ERROR }}>{t('modelsFailed')}</span>
      </section>
    )
  }
  if (payload === undefined) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: LABEL_PRIMARY }}>{t('modelsTitle')}</h2>
        <span style={{ fontSize: 12, color: LABEL_TERTIARY }}>{t('checking')}</span>
      </section>
    )
  }

  const available = payload.available
  const unrestricted = available.length === 0
  const models = payload.models

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: LABEL_PRIMARY }}>{t('modelsTitle')}</h2>
        <span style={{ fontSize: 12, color: LABEL_TERTIARY }}>
          {`${models.length} ${t('modelsCount')} · ${unrestricted ? t('modelsAllAvailable') : `${available.length} ${t('modelsAvailable')}`}`}
          {saving ? ` · ${t('modelsSaving')}` : ''}
        </span>
      </div>
      <span style={{ fontSize: 12, color: LABEL_SECONDARY }}>{t('modelsHint')}</span>
      {models.length === 0
        ? <span style={{ fontSize: 12, color: LABEL_TERTIARY }}>{t('modelsEmpty')}</span>
        : models.map(model => (
          <ModelRow
            key={model.id}
            t={t}
            id={model.id}
            name={model.name}
            checked={!unrestricted && available.includes(model.id)}
            isDefault={payload.defaultModel === model.id}
            onToggle={(next) => {
              const set = new Set(available)
              if (next) set.add(model.id)
              else set.delete(model.id)
              const kept = payload.defaultModel !== undefined && set.has(payload.defaultModel) ? payload.defaultModel : undefined
              void commit({ available: [...set], ...kept === undefined ? {} : { defaultModel: kept } })
            }}
            onDefault={() => {
              void commit({ available: [...available], defaultModel: model.id })
            }}
          />
        ))}
      {error === undefined ? null : <span style={{ fontSize: 12, color: ERROR }}>{error}</span>}
    </section>
  )
}
