/**
 * The plugin's own settings document: which `agy` models the plugin may use and
 * which one it picks when the deployment config does not pin a model.
 *
 * The browser half edits this through the Host route; the provider reads it on
 * every start, so a change applies to the next delegation without a restart.
 *
 * @module dsh-antigravity/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { AntigravityModel } from './protocol.ts'

/** What the route persists; unknown fields never reach this type. */
export interface StoredSettings {
  /** Model ids the plugin may use. Empty means every model the account offers. */
  readonly available: readonly string[]
  /** Model used when the deployment config does not pin one. */
  readonly defaultModel?: string
}

/** Settings applied before the user has chosen anything. */
export const EMPTY_SETTINGS: StoredSettings = { available: [] }

/**
 * Where the document lives.
 * @returns the absolute path under the DSH home.
 */
export function settingsPath(): string {
  return dshHomePath('storages', 'dsh-antigravity.json')
}

/**
 * Read the document, tolerating a missing or malformed file: a corrupt file
 * must not stop delegation, so it reads as the empty selection.
 * @param file - path to the document.
 * @returns the stored selection.
 */
export function readSettings(file: string = settingsPath()): StoredSettings {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return EMPTY_SETTINGS
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_SETTINGS
    const record = parsed as Record<string, unknown>
    const available = Array.isArray(record.available)
      ? record.available.filter((value): value is string => typeof value === 'string' && value !== '')
      : []
    const defaultModel = typeof record.defaultModel === 'string' && record.defaultModel !== '' ? record.defaultModel : undefined
    return defaultModel === undefined ? { available } : { available, defaultModel }
  } catch {
    return EMPTY_SETTINGS
  }
}

/**
 * Write the document through a sibling temporary file so a crash mid-write
 * cannot leave a truncated document behind.
 * @param next - the selection to persist.
 * @param file - path to the document.
 */
export function writeSettings(next: StoredSettings, file: string = settingsPath()): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

/**
 * Parse `agy models`, whose output is one `id<TAB>name` pair per line with an
 * unlabelled progress line around it.
 * @param stdout - the command's standard output.
 * @returns the models it listed, in the reported order.
 */
export function parseModels(stdout: string): AntigravityModel[] {
  const models: AntigravityModel[] = []
  for (const line of stdout.split('\n')) {
    const [id, name] = line.trim().split('\t')
    if (id === undefined || id === '' || name === undefined || name === '') continue
    if (/\s/.test(id)) continue
    models.push({ id, name: name.trim() })
  }
  return models
}

/**
 * Reject a selection the plugin cannot honor.
 * @param candidate - the posted selection.
 * @param known - model ids the account currently offers, or undefined when the list is unavailable.
 * @returns the normalized selection.
 * @throws when a field has the wrong type, or the default is not among the available ids.
 */
export function validateSelection(candidate: unknown, known: readonly string[] | undefined): StoredSettings {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('dsh-antigravity: the settings body must be an object')
  }
  const record = candidate as Record<string, unknown>
  const available = record.available
  if (!Array.isArray(available) || available.some(value => typeof value !== 'string' || value === '')) {
    throw new Error('dsh-antigravity: available must be an array of model ids')
  }
  const defaultModel = record.defaultModel
  if (defaultModel !== undefined && defaultModel !== null && (typeof defaultModel !== 'string' || defaultModel === '')) {
    throw new Error('dsh-antigravity: defaultModel must be a non-empty model id')
  }
  const ids = [...new Set(available as string[])]
  if (known !== undefined) {
    const unknown = ids.filter(id => !known.includes(id))
    if (unknown.length > 0) throw new Error(`dsh-antigravity: unknown model id(s): ${unknown.join(', ')}`)
  }
  const chosen = typeof defaultModel === 'string' ? defaultModel : undefined
  if (chosen !== undefined && known !== undefined && !known.includes(chosen)) {
    throw new Error(`dsh-antigravity: unknown default model id: ${chosen}`)
  }
  if (chosen !== undefined && ids.length > 0 && !ids.includes(chosen)) {
    throw new Error('dsh-antigravity: the default model must be one of the available models')
  }
  return chosen === undefined ? { available: ids } : { available: ids, defaultModel: chosen }
}
