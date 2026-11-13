import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { DesktopUpdateStatus } from '@/global'
import { I18nProvider } from '@/i18n/context'
import { en } from '@/i18n/en'
import { $desktopVersion, $updateOverlayOpen, $updateOverlayTarget, $updateStatus } from '@/store/updates'

import { UpdatesOverlay } from './updates-overlay'

// The release feed is fetched for the change list; this test is about the
// "What changed" handoff, so GitHub is never actually contacted.
afterEach((): void => {
  cleanup()
  $updateOverlayOpen.set(false)
  $updateStatus.set(null)
  $desktopVersion.set(null)
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openWith(status: Partial<DesktopUpdateStatus>): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 599 }))
  )
  $desktopVersion.set({
    appVersion: '0.21.6',
    electronVersion: '37',
    hermesRoot: '/h',
    nodeVersion: '22',
    platform: 'linux'
  })
  $updateStatus.set({ behind: 12, mechanism: 'posix-handoff', supported: true, updateAvailable: true, ...status })
  $updateOverlayTarget.set('client')
  $updateOverlayOpen.set(true)

  await act(async (): Promise<void> => {
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <UpdatesOverlay />
      </I18nProvider>
    )
  })
}

it('"What changed" opens the available release page in the system browser', async () => {
  const openExternal = vi.fn()
  window.hermesDesktop = { openExternal } as unknown as Window['hermesDesktop']
  await openWith({ channel: 'stable', sourceVersion: '0.22.0' })

  const button = screen.getByRole('button', { name: en.updates.whatChanged })
  fireEvent.click(button)

  expect(openExternal).toHaveBeenCalledWith(
    'https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0'
  )
})

it('offers no release page for a main-channel update with no tag', async () => {
  await openWith({ branch: 'main' })
  expect(screen.queryByRole('button', { name: en.updates.whatChanged })).toBeNull()
})

it('offers no release page for a rollback', async () => {
  await openWith({ channel: 'stable', rollback: true, sourceVersion: '0.21.0' })
  expect(screen.queryByRole('button', { name: en.updates.whatChanged })).toBeNull()
})
