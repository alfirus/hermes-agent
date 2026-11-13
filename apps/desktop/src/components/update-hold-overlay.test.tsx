import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { UpdateHoldWire } from '@/global'
import { I18nProvider } from '@/i18n/context'
import { en } from '@/i18n/en'
import { UPDATE_HOLD_SNOOZE_KEY } from '@/lib/update-hold-snooze'
import { $desktopBoot, applyDesktopUpdateHold } from '@/store/boot'

import { UpdateHoldOverlay } from './update-hold-overlay'

function hold(holdId: string): UpdateHoldWire {
  return {
    checkedAt: Date.now(),
    holdId,
    logPath: '/logs/hermes.log',
    ownerPid: 4242,
    since: Date.now() - 60_000,
    verdict: 'held'
  }
}

beforeEach(() => {
  window.localStorage.clear()
  applyDesktopUpdateHold(hold('h-1'))
})

afterEach(() => {
  cleanup()
  applyDesktopUpdateHold(null)
  $desktopBoot.set({ ...$desktopBoot.get(), error: null })
  window.localStorage.clear()
  vi.restoreAllMocks()
})

function renderOverlay() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <UpdateHoldOverlay />
    </I18nProvider>
  )
}

it('shows the hold screen with a Remind me later action', () => {
  renderOverlay()
  expect(screen.getByTestId('update-hold-overlay')).toBeTruthy()
  expect(screen.getByRole('button', { name: en.boot.updateHold.remindLater })).toBeTruthy()
})

function snoozeClick() {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: en.boot.updateHold.remindLater }))
  })
}

it('snoozing hides the overlay and persists the timestamp', () => {
  renderOverlay()
  snoozeClick()

  expect(screen.queryByTestId('update-hold-overlay')).toBeNull()

  const stored = JSON.parse(window.localStorage.getItem(UPDATE_HOLD_SNOOZE_KEY) ?? 'null')
  expect(stored?.holdId).toBe('h-1')
  expect(stored?.until).toBeGreaterThan(Date.now())

  // A remount (dialog closed and reopened) stays hidden while the snooze runs.
  cleanup()
  renderOverlay()
  expect(screen.queryByTestId('update-hold-overlay')).toBeNull()
})

it('a different hold ignores the previous snooze', () => {
  renderOverlay()
  snoozeClick()
  expect(screen.queryByTestId('update-hold-overlay')).toBeNull()

  cleanup()
  applyDesktopUpdateHold(hold('h-2'))
  renderOverlay()
  expect(screen.getByTestId('update-hold-overlay')).toBeTruthy()
})

it('an expired snooze lets the overlay back, and the record survives for the indicator story', () => {
  window.localStorage.setItem(UPDATE_HOLD_SNOOZE_KEY, JSON.stringify({ holdId: 'h-1', until: Date.now() - 1 }))

  renderOverlay()
  expect(screen.getByTestId('update-hold-overlay')).toBeTruthy()
})
