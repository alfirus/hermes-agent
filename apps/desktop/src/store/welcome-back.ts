import { persistStringRecord, storedStringRecord } from '@/lib/storage'

// Version re-orientation for returning users: when the running desktop version
// differs from the last version this profile already saw (and acknowledged),
// the chat surface shows a one-shot "welcome back" note with a link to the
// release notes. Exactly once per new version, per profile.

const STORAGE_KEY = 'hermes:welcome-back:v1'
const RELEASE_NOTES_URL = 'https://github.com/NousResearch/hermes-agent/releases'

export { RELEASE_NOTES_URL }

/** profile name → last version the note was acknowledged for. */
type AckMap = Record<string, string>

function profileKey(profile: string): string {
  return profile.trim() || 'default'
}

function readAcks(): AckMap {
  return storedStringRecord(STORAGE_KEY)
}

export function acknowledgedWelcomeVersion(profile: string): null | string {
  return readAcks()[profileKey(profile)] ?? null
}

/** Mark `version` as acknowledged for `profile` (shown once, or dismissed). */
export function acknowledgeWelcomeVersion(profile: string, version: string): void {
  const trimmed = version.trim()

  if (!trimmed) {
    return
  }

  const acks = readAcks()
  const key = profileKey(profile)

  if (acks[key] === trimmed) {
    return
  }

  persistStringRecord(STORAGE_KEY, { ...acks, [key]: trimmed })
}

export interface WelcomeBackDecisionInput {
  /** Running desktop version ('' / blank = not yet known — never show). */
  appVersion: string
  /** Last acknowledged version for this profile (null = none yet). */
  acknowledgedVersion: null | string
  /** Returning-user gate: existing sessions/history present. First-run never shows. */
  hasHistory: boolean
}

/** The pure decision: show the welcome-back note?
 *  - version unknown → no (don't flash an empty banner pre-bridge)
 *  - first run (no history) → no
 *  - already acknowledged this exact version → no (once per new version)
 */
export function shouldShowWelcomeBack({
  acknowledgedVersion,
  appVersion,
  hasHistory
}: WelcomeBackDecisionInput): boolean {
  const version = appVersion.trim()

  if (!version || !hasHistory) {
    return false
  }

  return acknowledgedVersion !== version
}

/** Rename counterpart: the acknowledged marker follows the profile's new name. */
export function migrateWelcomeBackForProfile(oldProfile: string, newProfile: string): void {
  const from = profileKey(oldProfile)
  const to = profileKey(newProfile)

  if (from === to) {
    return
  }

  const acks = readAcks()

  if (!(from in acks)) {
    return
  }

  const next = { ...acks }
  delete next[from]
  // A renamed profile must not re-see an old version's note it acknowledged
  // under the new name: keep the newer acknowledgement on collision.
  const moved = next[to] ?? acks[from]
  persistStringRecord(STORAGE_KEY, { ...next, [to]: moved })
}

/** Delete counterpart: drop the profile's key so a later same-named profile starts fresh. */
export function dropWelcomeBackForProfile(profile: string): void {
  const key = profileKey(profile)
  const acks = readAcks()

  if (!(key in acks)) {
    return
  }

  const next = { ...acks }
  delete next[key]
  persistStringRecord(STORAGE_KEY, next)
}
