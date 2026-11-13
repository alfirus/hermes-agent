import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clampSnoozeDuration,
  DEFAULT_SNOOZE_MS,
  isHoldSnoozed,
  MAX_SNOOZE_MS,
  parseHoldSnooze,
  readHoldSnooze,
  UPDATE_HOLD_SNOOZE_KEY,
  writeHoldSnooze
} from './update-hold-snooze'

describe('update-hold snooze decisions', () => {
  it('clamps a duration to (0, 24h]', () => {
    expect(clampSnoozeDuration(DEFAULT_SNOOZE_MS)).toBe(DEFAULT_SNOOZE_MS)
    expect(clampSnoozeDuration(MAX_SNOOZE_MS + 1)).toBe(MAX_SNOOZE_MS)
    expect(clampSnoozeDuration(0)).toBe(0)
    expect(clampSnoozeDuration(-5)).toBe(0)
    expect(clampSnoozeDuration(Number.NaN)).toBe(0)
  })

  it("hides only while this hold's snooze is still running", () => {
    const now = 1_000_000

    // No snooze, or a snooze for a different hold: show.
    expect(isHoldSnoozed(null, 'h1', now)).toBe(false)
    expect(isHoldSnoozed({ holdId: 'h2', until: now + 1000 }, 'h1', now)).toBe(false)
    // No hold at all: nothing to hide.
    expect(isHoldSnoozed({ holdId: 'h1', until: now + 1000 }, null, now)).toBe(false)
    // Same hold, still due: hide.
    expect(isHoldSnoozed({ holdId: 'h1', until: now + 1000 }, 'h1', now)).toBe(true)
    // Passed the timestamp (boundary counts as expired): show again.
    expect(isHoldSnoozed({ holdId: 'h1', until: now }, 'h1', now)).toBe(false)
    expect(isHoldSnoozed({ holdId: 'h1', until: now - 1 }, 'h1', now)).toBe(false)
  })

  it('parses only records shaped like what it wrote', () => {
    expect(parseHoldSnooze(null)).toBeNull()
    expect(parseHoldSnooze('not json')).toBeNull()
    expect(parseHoldSnooze('{}')).toBeNull()
    expect(parseHoldSnooze('{"holdId":"h1"}')).toBeNull()
    expect(parseHoldSnooze('{"until":5}')).toBeNull()
    expect(parseHoldSnooze('{"holdId":"","until":5}')).toBeNull()
    expect(parseHoldSnooze('{"holdId":"h1","until":"later"}')).toBeNull()
    expect(parseHoldSnooze('{"holdId":"h1","until":123}')).toEqual({ holdId: 'h1', until: 123 })
  })
})

describe('update-hold snooze storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips an armed snooze through localStorage', () => {
    const now = 1_000_000
    const until = writeHoldSnooze('h1', DEFAULT_SNOOZE_MS, now)

    expect(until).toBe(now + DEFAULT_SNOOZE_MS)
    expect(readHoldSnooze()).toEqual({ holdId: 'h1', until })
    expect(window.localStorage.getItem(UPDATE_HOLD_SNOOZE_KEY)).toBeTruthy()
    // And the decision sees it as snoozed until `until`.
    expect(isHoldSnoozed(readHoldSnooze(), 'h1', now)).toBe(true)
    expect(isHoldSnoozed(readHoldSnooze(), 'h1', until)).toBe(false)
  })

  it('a corrupt stored value reads as no snooze', () => {
    window.localStorage.setItem(UPDATE_HOLD_SNOOZE_KEY, '{oops')
    expect(readHoldSnooze()).toBeNull()
  })

  it('a broken storage never throws: write still returns the wake time, read says none', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      }
    } as unknown as Storage

    const original = window.localStorage

    Object.defineProperty(window, 'localStorage', { configurable: true, value: broken })

    try {
      expect(writeHoldSnooze('h1', DEFAULT_SNOOZE_MS, 10)).toBe(10 + DEFAULT_SNOOZE_MS)
      expect(readHoldSnooze()).toBeNull()
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original })
    }
  })
})
