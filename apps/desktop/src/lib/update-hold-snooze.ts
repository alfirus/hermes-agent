/**
 * "Remind me later" for the update-hold overlay.
 *
 * The hold screen blocks the boot screen while an earlier update's leftover
 * process still owns the install. The owner may want it out of the way for a
 * while without quitting: a snooze stores a wake-up timestamp in localStorage
 * and the overlay hides itself until that moment passes. The pending update
 * itself keeps surfacing through the existing update-status indicator — the
 * snooze only defers this modal.
 *
 * Decision helpers are pure (state + now in, verdict out) so the show/hide
 * contract is testable without a DOM; localStorage is touched only in the
 * thin read/write wrappers, which swallow storage failures (private mode,
 * quota): a broken store means "no snooze", never a hidden or crashed screen.
 */

const STORAGE_KEY = 'hermes.desktop.update-hold-snooze.v1'

/** A snooze is meaningless past a day; cap it so a stale value cannot mask the screen forever. */
export const MAX_SNOOZE_MS = 24 * 60 * 60_000

/** "Remind me later" without a chooser: one hour, capped like everything else. */
export const DEFAULT_SNOOZE_MS = 60 * 60_000

export function clampSnoozeDuration(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0
  }

  return Math.min(ms, MAX_SNOOZE_MS)
}

/** The stored record is the snoozed hold's id plus its wake-up time. */
export interface HoldSnoozeRecord {
  holdId: string
  until: number
}

export function parseHoldSnooze(raw: string | null): HoldSnoozeRecord | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<HoldSnoozeRecord> | null

    if (
      parsed &&
      typeof parsed.holdId === 'string' &&
      parsed.holdId &&
      typeof parsed.until === 'number' &&
      Number.isFinite(parsed.until)
    ) {
      return { holdId: parsed.holdId, until: parsed.until }
    }
  } catch {
    // Not JSON we wrote: treat as no snooze.
  }

  return null
}

/** True when a stored snooze still hides the overlay for this hold right now. */
export function isHoldSnoozed(record: HoldSnoozeRecord | null, holdId: string | null, now: number): boolean {
  if (!record || !holdId) {
    return false
  }

  return record.holdId === holdId && record.until > now
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readHoldSnooze(): HoldSnoozeRecord | null {
  const store = storage()

  if (!store) {
    return null
  }

  try {
    return parseHoldSnooze(store.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

/** Arm the snooze for this hold from `now`; the overlay returns at `now + durationMs`. */
export function writeHoldSnooze(holdId: string, durationMs: number, now: number): number {
  const until = now + clampSnoozeDuration(durationMs)
  const store = storage()

  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ holdId, until } satisfies HoldSnoozeRecord))
    } catch {
      // Storage full or blocked: the snooze is simply lost; the overlay keeps showing.
    }
  }

  return until
}

export const UPDATE_HOLD_SNOOZE_KEY = STORAGE_KEY
