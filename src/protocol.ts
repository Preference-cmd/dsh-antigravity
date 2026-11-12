/**
 * The panel's wire types: what the Host route returns and where it lives.
 * Imported by both faces, so it must stay free of Node-only imports.
 *
 * @module dsh-antigravity/protocol
 */

/** The authenticated route the browser half reads. */
export const STATUS_PATH = '/api/antigravity/status'

/** The mounted-model selection the browser half reads and writes. */
export const SETTINGS_PATH = '/api/antigravity/settings'

/** One quota window the CLI reports, already normalized for the browser. */
export interface AntigravityBucket {
  readonly id: string
  readonly name: string
  readonly window: string
  /** Remaining share of the window, 0–1. */
  readonly remainingFraction: number
  /** ISO 8601 UTC instant when the window refreshes. */
  readonly resetTime: string
}

/** One model family and its quota windows. */
export interface AntigravityQuotaGroup {
  readonly group: string
  readonly buckets: readonly AntigravityBucket[]
}

/** What the panel renders, and the only value that crosses the route. */
export interface AntigravityStatus {
  readonly state: 'signed-in' | 'signed-out' | 'unavailable'
  readonly checkedAt: number
  readonly quota: readonly AntigravityQuotaGroup[]
  readonly credits?: { readonly remaining: number; readonly upgradeUri: string }
  /** Fixed, non-sensitive reason the state is what it is. */
  readonly detail?: string
}


/** One model the account offers, as the panel lists it. */
export interface AntigravityModel {
  /** Flag value for `--model`. */
  readonly id: string
  /** Display name the CLI reports. */
  readonly name: string
}

/** What the settings route returns and accepts. */
export interface AntigravitySettingsPayload {
  /** Model ids the plugin may use; empty means every model the account offers. */
  readonly available: readonly string[]
  /** Model used when the deployment config does not pin one. */
  readonly defaultModel?: string
  /** Models the account currently offers; empty when the list could not be read. */
  readonly models: readonly AntigravityModel[]
  /** Fixed reason the model list is empty. */
  readonly detail?: string
}
