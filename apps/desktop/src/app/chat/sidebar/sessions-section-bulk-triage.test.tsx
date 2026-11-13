// Bulk triage on the sessions sidebar section:
//  (a) a section-level "Mark all in this section as read" that fires the
//      existing per-session read seams for EVERY unread listed session, and
//  (b) multi-select with a checkbox affordance + bulk Archive that fires the
//      existing onArchiveSession seam once per selected session.
// Selection state lives in the section component; nothing here adds a store.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'
import { $sessions, $unreadFinishedSessionIds, setSessions } from '@/store/session'
import type * as SessionUnreadStore from '@/store/session-unread'

import type * as ProjectsModel from './projects/model'
import { SidebarSessionsSection } from './sessions-section'

// The virtual list can't measure a jsdom viewport; the flat paths below stay
// under VIRTUALIZE_THRESHOLD anyway, but other section renders in this file
// (none currently) would want the inert stub the sibling test uses.
vi.mock('./virtual-session-list', () => ({
  VirtualSessionList: () => <div data-testid="virtual-session-list" />
}))

// Row stub: echoes selection state + exposes the toggle the section owns, so
// the assertions test the SECTION's wiring (props it passes per row), not the
// production row's paint (covered by session-row tests).
vi.mock('./session-row', () => ({
  SidebarSessionRow: ({
    onToggleSelected,
    selected,
    selectionMode,
    session
  }: {
    onToggleSelected?: () => void
    selected?: boolean
    selectionMode?: boolean
    session: SessionInfo
  }) =>
    selectionMode ? (
      <button
        data-testid={`row-select-${session.id}`}
        onClick={onToggleSelected}
        type="button"
      >
        {selected ? 'checked' : 'unchecked'}
      </button>
    ) : (
      <div data-testid={`session-row-${session.id}`}>{session.id}</div>
    )
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { cancel: 'Cancel' },
      desktop: {},
      sidebar: {
        dateDivider: {
          earlierThisMonth: 'Earlier this month',
          lastWeek: 'Last week',
          thisWeek: 'This week',
          today: 'Today',
          yesterday: 'Yesterday'
        },
        statusDivider: { done: 'Done', working: 'Working' },
        bulk: {
          select: 'Select',
          selectAll: 'Select all',
          deselectAll: 'Deselect all',
          archiveSelected: (count: number) => `Archive ${count} selected`,
          cancel: 'Cancel',
          selectedCount: (count: number) => `${count} selected`,
          toggleSelect: (title: string) => `Select "${title}"`,
          markSectionRead: 'Mark all in this section as read'
        },
        nav: { 'new-session': 'New session' },
        newSessionIn: (label: string) => `New session in ${label}`,
        noSessions: 'No sessions yet',
        projects: {
          home: 'Home',
          toggle: (label: string, open: boolean) => `${open ? 'Show' : 'Hide'} ${label} sessions`
        },
        showMoreIn: (count: number, label: string) => `Show ${count} more in ${label}`
      },
      profiles: { switchToProfile: (label: string) => `Switch to ${label}` },
      statusStack: { coding: { switchFailed: (label: string) => `Could not switch to ${label}` } }
    }
  })
}))

vi.mock('../new-session-drag', () => ({ startNewSessionDrag: vi.fn() }))

vi.mock('./projects/model', async () => ({
  ...(await vi.importActual<typeof ProjectsModel>('./projects/model')),
  latestProjectSessions: () => [],
  useWorkspaceNodeOpen: () => [false, vi.fn()]
}))

vi.mock('./projects/project-menu', () => ({
  ProjectContextMenu: ({ children }: { children: ReactNode }) => children,
  ProjectMenu: () => null
}))

// The persisted ack writes into persistentAtoms backed by window storage; the
// unit under test only needs to fire it per unread row — its own behaviour is
// covered by session-unread's tests.
const ackStoredSessionId = vi.hoisted(() => vi.fn())

vi.mock('@/store/session-unread', async () => {
  const actual = await vi.importActual<typeof SessionUnreadStore>('@/store/session-unread')

  return { ...actual, ackStoredSessionId }
})

const noop = vi.fn()

function makeSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    message_count: 1,
    source: 'cli',
    started_at: 1_000,
    state: 'finished',
    title: `Session ${id}`,
    ...overrides
  } as SessionInfo
}

const baseProps = (sessions: SessionInfo[]) => ({
  activeSessionId: null,
  emptyState: null,
  label: 'Recents',
  onArchiveSession: noop,
  onDeleteSession: noop,
  onResumeSession: noop,
  onToggle: noop,
  onTogglePin: noop,
  onToggleUnread: noop,
  open: true,
  pinned: false,
  sessions
})

beforeEach(() => {
  noop.mockClear()
  ackStoredSessionId.mockClear()
  // Real store atoms: seed rows + the transient finished-unread dots so the
  // section's mark-all-read path has honest inputs.
  setSessions([])
  $unreadFinishedSessionIds.set([])
})

afterEach(() => {
  cleanup()
  setSessions([])
  $unreadFinishedSessionIds.set([])
})

describe('section-level mark all read', () => {
  it('fires the read seams once per unread listed session (and none for read ones)', () => {
    const sessions = [
      makeSession('a', { unread: true }),
      makeSession('b'),
      makeSession('c', { unread: true })
    ]

    $sessions.set(sessions)
    // 'c' carries both the persisted watermark and a transient dot; 'b' is
    // clean and must not be touched.
    $unreadFinishedSessionIds.set(['c'])

    const onToggleUnread = vi.fn()

    render(<SidebarSessionsSection {...baseProps(sessions)} onToggleUnread={onToggleUnread} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mark all in this section as read' }))

    // Persisted watermark flip through the existing row seam: once per
    // unread-flagged row, only for those rows.
    expect(onToggleUnread.mock.calls.map(call => call[0]).sort()).toEqual(['a', 'c'])
    // Transient/persisted ack layer fired for each unread session too.
    expect(ackStoredSessionId.mock.calls.map(call => call[0]).sort()).toEqual(['a', 'c'])
    // The transient dot layer is genuinely cleared (real store fn, not mocked).
    expect($unreadFinishedSessionIds.get()).not.toContain('c')
  })

  it('shows the mark-all-read row only when a listed session is unread', () => {
    const sessions = [makeSession('a'), makeSession('b')]

    render(<SidebarSessionsSection {...baseProps(sessions)} />)

    expect(screen.queryByRole('button', { name: 'Mark all in this section as read' })).toBeNull()
  })

  it('counts transient-dot-only unread sessions without a persisted watermark', () => {
    const sessions = [makeSession('a'), makeSession('b')]

    $sessions.set(sessions)
    $unreadFinishedSessionIds.set(['a'])

    const onToggleUnread = vi.fn()

    render(<SidebarSessionsSection {...baseProps(sessions)} onToggleUnread={onToggleUnread} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mark all in this section as read' }))

    // The dot is cleared via markSessionRead/ackStoredSessionId; the
    // watermark seam is NOT fired — the row has no persisted unread flag.
    expect(ackStoredSessionId).toHaveBeenCalledWith('a')
    expect(onToggleUnread).not.toHaveBeenCalled()
  })
})

describe('multi-select bulk archive', () => {
  it('fires onArchiveSession exactly once per selected session', () => {
    const sessions = [makeSession('a'), makeSession('b'), makeSession('c')]
    const onArchiveSession = vi.fn()

    render(<SidebarSessionsSection {...baseProps(sessions)} onArchiveSession={onArchiveSession} />)

    // Enter selection mode from the section-level row.
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    // Checkbox affordance appears on every row; toggle two of them.
    fireEvent.click(screen.getByTestId('row-select-a'))
    fireEvent.click(screen.getByTestId('row-select-b'))

    expect(screen.getByTestId('row-select-a').textContent).toBe('checked')

    fireEvent.click(screen.getByRole('button', { name: 'Archive 2 selected' }))

    expect(onArchiveSession).toHaveBeenCalledTimes(2)
    expect(onArchiveSession).toHaveBeenCalledWith('a')
    expect(onArchiveSession).toHaveBeenCalledWith('b')
    expect(onArchiveSession).not.toHaveBeenCalledWith('c')
  })

  it('toggling a row twice deselects it; the archive button is disabled with an empty selection', () => {
    const sessions = [makeSession('a'), makeSession('b')]
    const onArchiveSession = vi.fn()

    render(<SidebarSessionsSection {...baseProps(sessions)} onArchiveSession={onArchiveSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    const archive = screen.getByRole('button', { name: 'Archive 0 selected' }) as HTMLButtonElement

    expect(archive.disabled).toBe(true)

    fireEvent.click(screen.getByTestId('row-select-a'))
    fireEvent.click(screen.getByTestId('row-select-a'))

    expect(screen.getByTestId('row-select-a').textContent).toBe('unchecked')
    expect(
      (screen.getByRole('button', { name: 'Archive 0 selected' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(onArchiveSession).not.toHaveBeenCalled()
  })

  it('select-all then archive covers every listed session, and exits selection mode', () => {
    const sessions = [makeSession('a'), makeSession('b'), makeSession('c')]
    const onArchiveSession = vi.fn()

    const { getByRole, queryByTestId } = render(
      <SidebarSessionsSection {...baseProps(sessions)} onArchiveSession={onArchiveSession} />
    )

    fireEvent.click(getByRole('button', { name: 'Select' }))
    fireEvent.click(getByRole('button', { name: 'Select all' }))
    fireEvent.click(getByRole('button', { name: 'Archive 3 selected' }))

    expect(onArchiveSession).toHaveBeenCalledTimes(3)

    // The bulk action commits once: the section leaves selection mode, so a
    // second click cannot re-archive the same ids.
    expect(queryByTestId('row-select-a')).toBeNull()
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy()
  })

  it('cancel leaves selection mode without archiving anything', () => {
    const sessions = [makeSession('a'), makeSession('b')]
    const onArchiveSession = vi.fn()

    render(<SidebarSessionsSection {...baseProps(sessions)} onArchiveSession={onArchiveSession} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByTestId('row-select-a'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onArchiveSession).not.toHaveBeenCalled()
    expect(screen.queryByTestId('row-select-a')).toBeNull()
  })
})
