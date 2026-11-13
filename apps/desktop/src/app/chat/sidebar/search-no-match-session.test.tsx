// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFreshSessionRequest } from '@/app/contrib/wiring-effects'
import { SidebarProvider } from '@/components/ui/sidebar'
import type { SidebarSessionsResponse } from '@/hermes'
import { $freshSessionDraftSeed, $freshSessionRequest, requestFreshSession, takeFreshSessionDraftSeed } from '@/store/profile'
import { $sessions } from '@/store/session'
import { makeSessionInfo } from '@/test/session-info'

import { SidebarSearchNoMatchState } from './section-states'

import { ChatSidebar } from './index'

// The search dead-end: typing a query that matches no session must offer a
// one-tap path out — a fresh session draft seeded with the query. Proven end
// to end: sidebar renders the row, clicking it bumps the fresh-session
// request with the query as composer seed, and the wiring effect that opens
// the draft hands the seed to the composer bus.

const searchSessions = vi.fn(async (_query: string, _profile: string | null) => ({ results: [] }))

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCronJobs: async () => [],
  listSidebarSessions: async (): Promise<SidebarSessionsResponse> => ({
    cron: { sessions: [] },
    messaging: { sessions: [] },
    recents: { sessions: [] }
  }),
  searchSessions: (query: string, profile: string | null) => searchSessions(query, profile)
}))

const noop = () => {}

const noopAsync = async () => {}

const alpha = makeSessionInfo({ id: 'alpha', last_active: 60, profile: 'default', started_at: 30, title: 'Alpha chat' })

function mountSidebar() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <ChatSidebar
          currentView="chat"
          onArchiveSession={noop}
          onBranchSession={noop}
          onDeleteSession={noop}
          onLoadMoreSessions={noop}
          onManageCronJob={noop}
          onNavigate={noop}
          onNewSessionInWorkspace={noop}
          onNewSessionSplit={noop}
          onResumeSession={noop}
          onRetrySessions={noopAsync}
          onTriggerCronJob={noopAsync}
        />
      </SidebarProvider>
    </MemoryRouter>
  )
}

const composerInsertEvents: Array<{ detail: unknown }> = []

const onWindowInsert = (event: Event) => composerInsertEvents.push({ detail: (event as CustomEvent).detail })

beforeEach(() => {
  composerInsertEvents.length = 0
  window.addEventListener('hermes:composer-insert', onWindowInsert)
  $sessions.set([alpha])
  searchSessions.mockClear()
})

afterEach(() => {
  cleanup()
  window.removeEventListener('hermes:composer-insert', onWindowInsert)
  $sessions.set([])
  $freshSessionDraftSeed.set(null)
})

describe('sidebar search no-match dead-end', () => {
  it('offers a seeded new-session row when a query matches nothing', async () => {
    const before = $freshSessionRequest.get()

    mountSidebar()

    fireEvent.change(screen.getByPlaceholderText('Search sessions…'), { target: { value: 'zebra' } })

    // The debounce + (stubbed) server round-trip resolve into the no-match state.
    const row = await screen.findByText('Start a session about “zebra”')

    expect(screen.getByText('No sessions match “zebra”.')).toBeTruthy()

    fireEvent.click(row)

    expect($freshSessionRequest.get()).toBe(before + 1)
    expect($freshSessionDraftSeed.get()).toBe('zebra')

    // The wiring effect that consumes the request drains the seed exactly once.
    expect(takeFreshSessionDraftSeed()).toBe('zebra')
    expect(takeFreshSessionDraftSeed()).toBe(null)
  })

  it('keeps the plain no-match text while a search is pending', () => {
    mountSidebar()

    fireEvent.change(screen.getByPlaceholderText('Search sessions…'), { target: { value: 'zebra' } })

    // No server hit has resolved yet (debounce): skeletons, not the dead-end row.
    expect(screen.queryByText('Start a session about “zebra”')).toBeNull()
  })

  it('hides the action for a whitespace-only query', () => {
    render(<SidebarSearchNoMatchState query="   " />)

    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('fresh-session draft seed hand-off', () => {
  it('routes a seeded request to the main composer, and a plain one to nobody', async () => {
    const startFreshSessionDraft = vi.fn()

    renderHook(() => useFreshSessionRequest(startFreshSessionDraft))

    act(() => requestFreshSession('fix the flaky test'))

    await waitFor(() => expect(composerInsertEvents.length).toBe(1))

    expect(startFreshSessionDraft).toHaveBeenCalledTimes(1)
    expect(composerInsertEvents[0]!.detail).toEqual({ mode: 'block', target: 'main', text: 'fix the flaky test' })

    composerInsertEvents.length = 0

    // A plain fresh request (profile switch) must not insert anything: the
    // seed was consumed by the previous request, not carried over.
    act(() => requestFreshSession())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    expect(composerInsertEvents.length).toBe(0)
  })
})
