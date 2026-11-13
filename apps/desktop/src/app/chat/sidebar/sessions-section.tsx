import type { useSensors } from '@dnd-kit/core'
import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { type NewSessionSplitHandler, startNewSessionDrag } from '@/app/chat/new-session-drag'
import { SidebarPanelLabel } from '@/app/shell/sidebar-label'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { SidebarGroup, SidebarGroupContent } from '@/components/ui/sidebar'
import { Tip } from '@/components/ui/tooltip'
import type { HermesGitWorktree } from '@/global'
import type { SessionInfo } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { flattenSessionsWithBranches } from '@/lib/session-branch-tree'
import {
  groupEntriesByRecency,
  groupEntriesByStatus,
  hideCollapsedGroupRows,
  type SidebarListRow,
  toSessionRows
} from '@/lib/session-date-groups'
import { sessionBucketLabel } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  $sidebarListGroupIds,
  $sidebarShowAllSessions,
  $sidebarWorkspaceNodeOpen,
  listGroupNodeId,
  toggleWorkspaceNodeCollapsed
} from '@/store/layout'
import type { AgentProfileRoute } from '@/store/profile'
import { markSessionRead, sessionPinId } from '@/store/session'
import { $sessionDotStateById, hasLiveTurn } from '@/store/session-dot-state'
import { ackStoredSessionId } from '@/store/session-unread'

import { SIDEBAR_FOCUS_VISIBLE, SidebarDateDivider, SidebarSectionMeta } from './chrome'
import { GatewayProfileGroups } from './gateway-groups'
import { mergeVisibleReorder, orderRowsWithinGroups, reorderableRowIds } from './order'
import {
  EnteredProjectContent,
  ProjectOverviewRow,
  type SidebarProjectTree,
  type SidebarSessionGroup,
  SidebarWorkspaceGroup,
  type SidebarWorkspaceTree
} from './projects'
import { WorkspaceAddButton } from './projects/workspace-header'
import { ReorderableList, useSortableBindings } from './reorderable-list'
import { SidebarSessionSkeletons } from './section-states'
import { SidebarSessionRow } from './session-row'
import { VirtualSessionList } from './virtual-session-list'

export const VIRTUALIZE_THRESHOLD = 25

interface SidebarSectionHeaderProps {
  label: string
  open: boolean
  onToggle: () => void
  action?: React.ReactNode
  meta?: React.ReactNode
  icon?: React.ReactNode
  // When false the section can't be collapsed: the label renders static (no
  // toggle, no caret) and the section is always open. Used for the single-
  // project view, where collapsing one project makes no sense.
  collapsible?: boolean
}

function SidebarSectionHeader({
  label,
  open,
  onToggle,
  action,
  meta,
  icon,
  collapsible = true
}: SidebarSectionHeaderProps) {
  const labelBody = (
    <>
      {icon}
      <SidebarPanelLabel>{label}</SidebarPanelLabel>
      {meta && <SidebarSectionMeta>{meta}</SidebarSectionMeta>}
    </>
  )

  return (
    <div className="group/section flex shrink-0 items-center justify-between gap-1 pb-1 pt-1.5">
      {collapsible ? (
        <button
          aria-expanded={open}
          // min-w-0 lets the label truncate at narrow sidebar widths instead of
          // pushing the header's trailing action icons out of view.
          className={cn(
            'group/section-label flex w-fit min-w-0 items-center gap-1 rounded-sm bg-transparent text-left leading-none',
            SIDEBAR_FOCUS_VISIBLE
          )}
          onClick={onToggle}
          type="button"
        >
          {labelBody}
          <DisclosureCaret
            className="text-(--ui-text-tertiary) opacity-0 transition group-hover/section-label:opacity-100 group-focus-visible/section-label:opacity-100"
            open={open}
          />
        </button>
      ) : (
        <div className="flex w-fit min-w-0 items-center gap-1 leading-none">{labelBody}</div>
      )}
      {action}
    </div>
  )
}

interface SidebarSessionsSectionProps {
  label: string
  open: boolean
  onToggle: () => void
  sessions: SessionInfo[]
  activeSessionId: null | string
  onResumeSession: (sessionId: string, session?: SessionInfo) => void
  onDeleteSession: (sessionId: string) => void
  onArchiveSession: (sessionId: string) => void
  onBranchSession?: (sessionId: string, profile?: string) => void
  onTogglePin: (sessionId: string) => void
  onToggleUnread: (sessionId: string) => void
  onNewSessionInWorkspace?: (path: null | string, owner?: AgentProfileRoute) => void
  /** Create a new session as a tile at a drop target (drag from a project "+"). */
  onNewSessionSplit?: NewSessionSplitHandler
  pinned: boolean
  rootClassName?: string
  contentClassName?: string
  emptyState: React.ReactNode
  forceEmptyState?: boolean
  headerAction?: React.ReactNode
  footer?: React.ReactNode
  groups?: SidebarSessionGroup[]
  // Owner groups inside a messaging platform: the section's footer pages them.
  embeddedGroups?: boolean
  tree?: SidebarWorkspaceTree[]
  // Project overview: when present, render a drill-in list of project rows
  // instead of sessions. Clicking a row enters that project (onEnterProject),
  // which then passes `projectContent` on the next render. Takes precedence
  // over `tree` / `groups`.
  projectOverview?: SidebarProjectTree[]
  // Per-project preview rows (from the backend tree), keyed by project id.
  projectOverviewPreviews?: Record<string, SessionInfo[]>
  // The exclusion the previews were built with (pins, filter misses, removed
  // ids) plus how many of each project's `sessionCount` it hides — applied
  // again when a row hydrates its full lanes on "Show all".
  projectOverviewHidden?: { isHidden: (session: SessionInfo) => boolean; counts: Record<string, number> }
  // True while the backend project tree is loading (overview skeleton).
  projectsLoading?: boolean
  onEnterProject?: (id: string) => void
  // The entered project's flattened content: main-checkout sessions render
  // directly (no redundant repo/branch header); only linked worktrees nest.
  projectContent?: SidebarProjectTree
  // Live git lanes (`git worktree list`) for repos in the entered project —
  // a VISUAL enhancer only (empty lanes), never session membership.
  projectRepoWorktrees?: Record<string, HermesGitWorktree[]>
  // Live session cache used for optimistic placement inside entered-project lanes.
  liveSessions?: SessionInfo[]
  // Client-side optimistic eviction layer (deleted/archived ids).
  removedSessionIds?: ReadonlySet<string>
  activeProjectId?: null | string
  labelMeta?: React.ReactNode
  labelIcon?: React.ReactNode
  // When false the section header is static (no caret/toggle) and always open.
  collapsible?: boolean
  sortable?: boolean
  // The persisted drag order, applied WITHIN each date group (see
  // orderRowsWithinGroups). Chronology decides the groups; this decides the
  // sequence inside one, so a reorder no longer costs the whole list its
  // dividers. Pinned passes nothing — its rows arrive in pin order already.
  manualOrderIds?: string[]
  // The flat session list is the only hand-reorderable surface (grouped/project
  // views sort deterministically), so it owns the one ReorderableList.
  onReorderSessions?: (ids: string[]) => void
  // Drag-to-reorder for the project overview list (top-level projects).
  onReorderProjects?: (ids: string[]) => void
  // Rendered atop the entered-project body (a "back to overview" row).
  projectBackRow?: React.ReactNode
  dndSensors?: ReturnType<typeof useSensors>
  // Tag every row with its owning profile. Set on the flat cross-profile
  // lists (Pinned / search results) in the All-profiles view, where no group
  // header communicates ownership (#66003).
  showProfileTags?: boolean
  // Which dividers to fold into the flat list: `date` gives the chronological
  // "Yesterday" / "Last week" separators (flat recents + entered-project lanes),
  // `status` splits into WORKING / DONE under the same separators. `none` for
  // pinned, messaging groups, and the project overview, where the order isn't
  // strictly by recency so a bucket would be misleading.
  grouping?: 'date' | 'none' | 'status'
  // Keep the caller's row order instead of re-sorting by group recency
  // (defaults to `pinned`, the only pre-ordered caller). The search results
  // set it too: their order is the backend's ranking (exact id matches
  // first), which recency re-sorting would bury under newer quoting rows.
  preserveOrder?: boolean
  // Inbox style: render every flat session row as a three-line card (project ·
  // age / title / model · size). A render variant that composes with whichever
  // grouping is active — the flat recents list opts in; dense tree surfaces
  // (pinned, projects, messaging) keep the one-line row.
  card?: boolean
}

export function SidebarSessionsSection({
  label,
  open,
  onToggle,
  sessions,
  activeSessionId,
  onResumeSession,
  onDeleteSession,
  onArchiveSession,
  onBranchSession,
  onTogglePin,
  onToggleUnread,
  onNewSessionInWorkspace,
  onNewSessionSplit,
  pinned,
  rootClassName,
  contentClassName,
  emptyState,
  forceEmptyState = false,
  headerAction,
  footer,
  groups,
  embeddedGroups = false,
  projectOverview,
  projectOverviewPreviews,
  projectOverviewHidden,
  projectsLoading = false,
  onEnterProject,
  projectContent,
  projectRepoWorktrees,
  liveSessions,
  removedSessionIds,
  activeProjectId,
  labelMeta,
  labelIcon,
  collapsible = true,
  sortable = false,
  manualOrderIds,
  onReorderSessions,
  onReorderProjects,
  projectBackRow,
  dndSensors,
  showProfileTags = false,
  grouping = 'none',
  preserveOrder = pinned,
  card = false
}: SidebarSessionsSectionProps) {
  const { t } = useI18n()
  const showAllSessions = useStore($sidebarShowAllSessions)
  const dividerLabels = t.sidebar.dateDivider
  const statusDividerLabels = t.sidebar.statusDivider
  const dotStates = useStore($sessionDotStateById)
  const nodeOpen = useStore($sidebarWorkspaceNodeOpen)
  const isListGroupOpen = useCallback((key: string) => nodeOpen[listGroupNodeId(key)] ?? true, [nodeOpen])
  const sectionOpen = collapsible ? open : true

  // ---- Bulk triage -------------------------------------------------------
  // Selection state is LOCAL to the section (a Set of session ids, plus the
  // mode flag); the actions ride the existing per-row seams — onToggleUnread
  // (persisted watermark) + markSessionRead/ackStoredSessionId (transient dot
  // layer, the same trio the row's ⋯ "Mark as read" uses), and
  // onArchiveSession per selected id. No new store, no new RPC.
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())

  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  const toggleSelected = useCallback((sessionId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)

      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }

      return next
    })
  }, [])

  // The flat list is the bulk-triage surface: grouped/project/tree views
  // render sessions through other callers' compositions where a section-level
  // select-all would silently skip the rows under workspace group headers.
  const hasGroupedSessions = Boolean(groups?.some(group => group.sessions.length > 0 || group.mode === 'profile'))

  const bulkTriageCapable =
    !groups?.length && !projectOverview?.length && !projectContent && !pinned && sessions.length > 0

  // Unread among the sessions THIS section lists: either the transient
  // finished-dot layer (dotStates) or the persisted backend watermark
  // (row.unread) — the same union the row's dot paints.
  const unreadSessionIds = useMemo(
    () =>
      sessions
        .filter(session => session.unread === true || dotStates[session.id] === 'unread')
        .map(session => session.id),
    [dotStates, sessions]
  )

  // "Mark all read" for this section: for every unread row, replay the exact
  // trio the row menu's "Mark as read" uses — clear the transient family dot
  // (markSessionRead), retire the persisted marker/watermark (ackStoredSessionId),
  // and drop the backend watermark when the row carries one (onToggleUnread,
  // which flips unread rows to read).
  const markSectionRead = useCallback(() => {
    for (const session of sessions) {
      const rowUnread = session.unread === true
      const dotUnread = dotStates[session.id] === 'unread'

      if (!rowUnread && !dotUnread) {
        continue
      }

      markSessionRead(session.id)
      ackStoredSessionId(session.id)

      if (rowUnread) {
        onToggleUnread(session.id)
      }
    }
  }, [dotStates, onToggleUnread, sessions])

  // Bulk archive: fire the existing per-session seam once per selected id.
  const archiveSelected = useCallback(() => {
    const ids = [...selectedIds]

    exitSelection()

    for (const id of ids) {
      onArchiveSession(id)
    }
  }, [exitSelection, onArchiveSession, selectedIds])

  // A defined project list is itself content (even an empty project should
  // render as a drill-in row so the user can see it exists).
  const hasProjectOverview = Boolean(projectOverview?.length)

  // Declared repos are content even before their first session: each repo header owns the action that starts
  // a session in that folder. Lanes likewise survive filtering and must still render.
  const hasProjectContent = Boolean(
    projectContent && (projectContent.sessionCount > 0 || projectContent.repos.length > 0)
  )

  const showEmptyState =
    forceEmptyState || (!hasGroupedSessions && !hasProjectOverview && !hasProjectContent && sessions.length === 0)

  // The flat recents/pinned list is the only place sessions reorder by hand;
  // grouped/tree views always sort by creation date and never drag.
  const sessionsDraggable = sortable && !!onReorderSessions

  // Only Pinned arrives pre-ordered as a flat sequence. Recents keeps its
  // recency sort — the drag order is layered on per date group below, so the
  // buckets stay truthful and a reorder never costs the list its dividers.
  const displayEntries = useMemo(
    () => flattenSessionsWithBranches(sessions, { preserveOrder }),
    [sessions, preserveOrder]
  )

  const renderRow = useCallback(
    (session: SessionInfo, draggable: boolean, branchStem?: string) => {
      const rowProps = {
        branchStem,
        card,
        isPinned: pinned,
        isSelected: session.id === activeSessionId,
        onArchive: () => onArchiveSession(session.id),
        onBranch: onBranchSession ? () => onBranchSession(session.id, session.profile) : undefined,
        onDelete: () => onDeleteSession(session.id),
        onPin: () => onTogglePin(sessionPinId(session)),
        onToggleUnread: () => onToggleUnread(session.id),
        onResume: () => onResumeSession(session.id, session),
        // A drag and a multi-select can't share a press: selection mode wins.
        reorderable: draggable && !branchStem && !selectionMode,
        selectionMode,
        selected: selectedIds.has(session.id),
        onToggleSelected: () => toggleSelected(session.id),
        session,
        showProfile: showProfileTags,
        unread: session.unread === true
      }

      // Key by (profile, id): twins with the same stored id in two profiles
      // are distinct rows (#92454) — a bare-id key makes React misattribute
      // one twin's rendered state to the other.
      return draggable && !branchStem && !selectionMode ? (
        <SortableSidebarSessionRow key={`${session.profile ?? ''}::${session.id}`} {...rowProps} />
      ) : (
        <SidebarSessionRow key={`${session.profile ?? ''}::${session.id}`} {...rowProps} />
      )
    },
    [
      activeSessionId,
      card,
      onArchiveSession,
      onBranchSession,
      onDeleteSession,
      onResumeSession,
      onTogglePin,
      onToggleUnread,
      pinned,
      selectedIds,
      selectionMode,
      showProfileTags,
      toggleSelected
    ]
  )

  // Date dividers head a group the same way a repo header does, so they carry
  // the same hover-revealed "+". Only for dates: "new session in WORKING" is
  // not a thing. The divider "+" is a drag source too (the same gesture as the
  // nav's "New session" row): drag it onto a chat zone to create the session
  // exactly there; a sub-threshold release stays the ordinary click. The ONE
  // element here feeds both the plain and the virtualized list paths, so this
  // single wiring covers every date-divider "+" on screen.
  const dividerAction =
    grouping === 'date' && onNewSessionInWorkspace ? (
      <WorkspaceAddButton
        label={t.sidebar.nav['new-session']}
        onClick={() => onNewSessionInWorkspace(null)}
        onPointerDown={
          onNewSessionSplit
            ? event => {
                startNewSessionDrag(placement => {
                  onNewSessionSplit(placement.dir, {
                    anchor: placement.anchor,
                    before: placement.before
                  })
                }, event)
              }
            : undefined
        }
      />
    ) : null

  const dividerToggle = useMemo(
    () => ({
      ariaLabel: (label: string, open: boolean) => t.sidebar.projects.toggle(label, !open),
      onToggle: (key: string) => toggleWorkspaceNodeCollapsed(listGroupNodeId(key)),
      open: isListGroupOpen
    }),
    [isListGroupOpen, t]
  )

  // A single flat/virtual/lane list row — either a divider or a session.
  const renderListRow = useCallback(
    (row: SidebarListRow, draggable: boolean, action?: React.ReactNode) => {
      if (row.kind === 'session') {
        return renderRow(row.entry.session, draggable, row.entry.branchStem)
      }

      const label = 'label' in row ? row.label : sessionBucketLabel(row.bucket, dividerLabels)
      const open = dividerToggle.open(row.key)

      return (
        <SidebarDateDivider
          action={action}
          key={row.key}
          label={label}
          toggle={{
            ariaLabel: dividerToggle.ariaLabel(label, open),
            onToggle: () => dividerToggle.onToggle(row.key),
            open
          }}
        />
      )
    },
    [dividerLabels, dividerToggle, renderRow]
  )

  // Sessions inside repos/worktrees are date-ordered and static.
  const renderRows = useCallback(
    (items: SessionInfo[]) =>
      flattenSessionsWithBranches(items).map(({ branchStem, session }) => renderRow(session, false, branchStem)),
    [renderRow]
  )

  // Limit complete groups, not sessions, so a burst and its branches stay
  // together. Compute boundaries from the whole pool, just like Updated.
  const renderPreviewRows = useCallback(
    (items: SessionInfo[], projectId: string) => {
      const rows = groupEntriesByRecency(
        flattenSessionsWithBranches(items),
        undefined,
        undefined,
        showAllSessions ? Infinity : 2
      ).map(row => (row.kind === 'divider' ? { ...row, key: `project:${projectId}:${row.key}` } : row))

      const ordered = manualOrderIds?.length ? orderRowsWithinGroups(rows, manualOrderIds) : rows

      return hideCollapsedGroupRows(ordered, isListGroupOpen).map(row => renderListRow(row, false))
    },
    [isListGroupOpen, manualOrderIds, renderListRow, showAllSessions]
  )

  // Same as `renderRows`, but with date dividers folded in — used for
  // entered-project lanes so a lane spanning multiple days reads
  // chronologically, matching the flat recents list.
  const renderRowsDated = useCallback(
    (items: SessionInfo[]) => {
      const entries = flattenSessionsWithBranches(items)

      const rows = grouping === 'date' ? groupEntriesByRecency(entries) : toSessionRows(entries)

      return hideCollapsedGroupRows(rows, isListGroupOpen).map(row => renderListRow(row, false))
    },
    [grouping, isListGroupOpen, renderListRow]
  )

  // Flat recents as list rows: grouped by recency when enabled, plain otherwise.
  // The hand-picked order is then applied INSIDE each date group, so dragging a
  // row ranks it among its own day's chats instead of freezing the whole list
  // into an undated manual mode.
  const flatRows: SidebarListRow[] = useMemo(() => {
    const rows =
      grouping === 'date'
        ? groupEntriesByRecency(displayEntries)
        : grouping === 'status'
          ? groupEntriesByStatus(
              displayEntries,
              entry => hasLiveTurn(dotStates[entry.session.id] ?? 'idle'),
              statusDividerLabels
            )
          : toSessionRows(displayEntries)

    return manualOrderIds?.length ? orderRowsWithinGroups(rows, manualOrderIds) : rows
  }, [grouping, displayEntries, dotStates, manualOrderIds, statusDividerLabels])

  // Closed date/status buckets keep their divider and drop the sessions under
  // it. Same array when nothing is collapsed so the virtualizer's rows ref
  // stays stable across parent re-renders.
  const visibleRows = useMemo(() => hideCollapsedGroupRows(flatRows, isListGroupOpen), [flatRows, isListGroupOpen])

  // dnd-kit must see exactly the ids it renders, in render order: the sortable
  // set is derived from the rows, not from `sessions`. Feeding it the unrendered
  // session order made a drop compute its target index against a list the user
  // wasn't looking at — the drag that landed a row in the wrong slot.
  const sortableRowIds = useMemo(() => reorderableRowIds(visibleRows), [visibleRows])
  const allSortableRowIds = useMemo(() => reorderableRowIds(flatRows), [flatRows])

  const persistSessionOrder = useCallback(
    (ids: string[]) => onReorderSessions?.(mergeVisibleReorder(allSortableRowIds, ids)),
    [allSortableRowIds, onReorderSessions]
  )

  useEffect(() => {
    if (grouping !== 'date' && grouping !== 'status') {
      return
    }

    $sidebarListGroupIds.set(flatRows.flatMap(row => (row.kind === 'divider' ? [listGroupNodeId(row.key)] : [])))

    return () => {
      $sidebarListGroupIds.set([])
    }
  }, [flatRows, grouping])

  // Pinned never virtualizes. Virtualization needs a bounded viewport to
  // measure against, and Pinned deliberately has none — however many chats you
  // pin, all of them render and the sidebar's own scroll carries the length.
  const flatVirtualized =
    !pinned &&
    !showEmptyState &&
    !groups?.length &&
    !projectOverview?.length &&
    !projectContent &&
    sessions.length >= VIRTUALIZE_THRESHOLD

  // First paint into the grouped view (e.g. the app restoring the Projects tab)
  // has flat recents in `sessions` but no tree yet. Show skeletons rather than
  // flashing the flat session list until the overview/content/groups resolve. A
  // background refresh keeps the prior tree, so this only fires when empty.
  const showProjectsSkeleton =
    projectsLoading && !hasProjectOverview && !hasProjectContent && !projectContent && !groups?.length

  let inner: React.ReactNode

  if (showProjectsSkeleton) {
    inner = <SidebarSessionSkeletons />
  } else if (projectContent) {
    // Entered a project: the back row is always present, then either the
    // (overlay-aware) content or a clean empty state — never a bare spinner or a
    // blank pane while lanes hydrate.
    inner = (
      <>
        {projectBackRow}
        {hasProjectContent ? (
          <EnteredProjectContent
            liveSessions={liveSessions}
            onNewSession={onNewSessionInWorkspace}
            onNewSessionSplit={onNewSessionSplit}
            project={projectContent}
            removedSessionIds={removedSessionIds}
            renderRows={renderRowsDated}
            repoWorktrees={projectRepoWorktrees}
          />
        ) : (
          emptyState
        )}
      </>
    )
  } else if (showEmptyState) {
    inner = emptyState
  } else if (projectOverview?.length) {
    // The model is already ordered (Home leads; then the default sort groups
    // explicit-before-auto, with a manual drag-order winning when present).
    // Render in that order and make rows drag-to-reorder when a handler is
    // wired — Home stays outside the sortable list, it's a fixture.
    const home = projectOverview[0]?.isNoProject ? projectOverview[0] : undefined
    const sortableProjects = home ? projectOverview.slice(1) : projectOverview
    const projectsDraggable = sortableProjects.length > 1 && !!onReorderProjects
    const Row = projectsDraggable ? SortableProjectOverviewRow : ProjectOverviewRow

    const projectRow = (project: SidebarProjectTree, Component: typeof ProjectOverviewRow) => (
      <Component
        activeProjectId={activeProjectId}
        hiddenSessionCount={projectOverviewHidden?.counts[project.id]}
        isSessionHidden={projectOverviewHidden?.isHidden}
        key={project.id}
        onEnter={onEnterProject}
        onNewSession={onNewSessionInWorkspace}
        onNewSessionSplit={onNewSessionSplit}
        // Keyed by project ID to match the producer: `overlayLivePreviews`
        // writes `out[node.id]` (workspace-groups.ts). A path key made Home
        // (path: null) and any id/path-divergent project fall back to stale
        // preview rows instead of the live overlay.
        previewSessions={projectOverviewPreviews?.[project.id]}
        project={project}
        renderRows={showAllSessions ? items => renderPreviewRows(items, project.id) : renderRows}
      />
    )

    const rows = sortableProjects.map(project => projectRow(project, Row))

    inner = (
      <>
        {home && projectRow(home, ProjectOverviewRow)}
        {projectsDraggable && onReorderProjects ? (
          <ReorderableList
            ids={sortableProjects.map(project => project.id)}
            onReorder={onReorderProjects}
            sensors={dndSensors}
          >
            {rows}
          </ReorderableList>
        ) : (
          rows
        )}
      </>
    )
  } else if (groups?.length && groups.every(group => group.mode === 'profile' && group.profile)) {
    inner = (
      <GatewayProfileGroups
        embedded={embeddedGroups}
        groups={groups}
        onNewSessionSplit={onNewSessionSplit}
        renderRows={renderRows}
        sensors={dndSensors}
      />
    )
  } else if (groups?.length) {
    inner = groups.map(group => (
      <SidebarWorkspaceGroup
        group={group}
        key={group.id}
        onNewSession={onNewSessionInWorkspace}
        onNewSessionSplit={onNewSessionSplit}
        renderRows={renderRows}
      />
    ))
  } else if (flatVirtualized) {
    const virtual = (
      <VirtualSessionList
        activeSessionId={activeSessionId}
        card={card}
        className={contentClassName}
        dividerAction={dividerAction}
        dividerToggle={dividerToggle}
        onArchiveSession={onArchiveSession}
        onBranchSession={onBranchSession}
        onDeleteSession={onDeleteSession}
        onResumeSession={onResumeSession}
        onTogglePin={onTogglePin}
        onToggleSelected={toggleSelected}
        onToggleUnread={onToggleUnread}
        pinned={pinned}
        rows={visibleRows}
        selectedIds={selectedIds}
        selectionMode={selectionMode}
        showProfileTags={showProfileTags}
        sortable={sessionsDraggable}
      />
    )

    inner = sessionsDraggable ? (
      <ReorderableList ids={sortableRowIds} onReorder={persistSessionOrder} sensors={dndSensors}>
        {virtual}
      </ReorderableList>
    ) : (
      virtual
    )
  } else if (sessionsDraggable) {
    inner = (
      <ReorderableList ids={sortableRowIds} onReorder={persistSessionOrder} sensors={dndSensors}>
        {visibleRows.map(row => renderListRow(row, true, dividerAction))}
      </ReorderableList>
    )
  } else {
    inner = visibleRows.map(row => renderListRow(row, false, dividerAction))
  }

  // The virtualizer owns its own scroller, so suppress the wrapper's overflow
  // to avoid a double scroll container. Both axes: `overflow-y-visible` next
  // to the inherited `overflow-x-hidden` computes to `auto` (CSS spec), which
  // kept a phantom 4px scrollbar gutter and cut every row short on the right.
  const resolvedContentClassName = cn(contentClassName, flatVirtualized && 'overflow-visible')

  return (
    <SidebarGroup className={cn(rootClassName, DROP_TARGET_RING)} {...sessionDropTargetProps(pinned)}>
      <SidebarSectionHeader
        action={headerAction}
        collapsible={collapsible}
        icon={labelIcon}
        label={label}
        meta={labelMeta}
        onToggle={onToggle}
        open={sectionOpen}
      />
      {sectionOpen && bulkTriageCapable ? (
        <SidebarBulkTriageRow
          bulk={t.sidebar.bulk}
          label={label}
          onArchiveSelected={archiveSelected}
          onCancel={exitSelection}
          onMarkRead={markSectionRead}
          onSelectAll={() => setSelectedIds(new Set(sessions.map(session => session.id)))}
          onSelectionStart={() => setSelectionMode(true)}
          selectedCount={selectedIds.size}
          selectionMode={selectionMode}
          totalCount={sessions.length}
          unreadCount={unreadSessionIds.length}
        />
      ) : null}
      {sectionOpen && (
        <SidebarGroupContent className={resolvedContentClassName}>
          {inner}
          {footer}
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

// Painted imperatively by session-drag.ts while a session hovers a pin
// (Pinned) or unpin (any other list) target — same ring as a project row drop
// target.
const DROP_TARGET_RING =
  'rounded-[6px] data-[session-drop-hover=true]:outline-2 data-[session-drop-hover=true]:-outline-offset-2 data-[session-drop-hover=true]:outline-sidebar-ring'

// ---- Bulk triage row -----------------------------------------------------
// A slim section-level row under the header: "Mark all read" clears the
// unread flags of the sessions this section lists (each one through the same
// store seams the row menu uses), and "Select" enters a multi-select mode
// whose bar offers Select all / bulk Archive / Cancel. Selection lives in
// the section component; the archive action fires the existing per-session
// onArchiveSession seam once per selected id.
interface SidebarBulkTriageRowProps {
  bulk: Translations['sidebar']['bulk']
  label: string
  onCancel: () => void
  onArchiveSelected: () => void
  onMarkRead: () => void
  onSelectAll: () => void
  onSelectionStart: () => void
  selectedCount: number
  selectionMode: boolean
  totalCount: number
  unreadCount: number
}

function SidebarBulkTriageRow({
  bulk,
  label,
  onCancel,
  onArchiveSelected,
  onMarkRead,
  onSelectAll,
  onSelectionStart,
  selectedCount,
  selectionMode,
  totalCount,
  unreadCount
}: SidebarBulkTriageRowProps) {
  if (selectionMode) {
    const allSelected = selectedCount === totalCount && totalCount > 0

    return (
      <div
        aria-label={`${bulk.select}: ${label}`}
        className="flex shrink-0 items-center gap-1 px-2 pb-1 text-[0.6875rem] text-(--ui-text-tertiary)"
        data-session-bulk-bar=""
      >
        <Button
          className={BULK_BTN}
          onClick={allSelected ? onCancel : onSelectAll}
          size="xs"
          variant="ghost"
        >
          {allSelected ? bulk.deselectAll : bulk.selectAll}
        </Button>
        <Button
          className={BULK_BTN}
          disabled={selectedCount === 0}
          onClick={onArchiveSelected}
          size="xs"
          variant="ghost"
        >
          <Codicon name="archive" size="0.75rem" />
          {bulk.archiveSelected(selectedCount)}
        </Button>
        <span className="ml-auto tabular-nums">{bulk.selectedCount(selectedCount)}</span>
        <Tip label={bulk.cancel}>
          <Button
            aria-label={bulk.cancel}
            className={BULK_BTN}
            onClick={onCancel}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="close" size="0.75rem" />
          </Button>
        </Tip>
      </div>
    )
  }

  if (unreadCount === 0 && totalCount <= 1) {
    return null
  }

  return (
    <div
      aria-label={`${bulk.select}: ${label}`}
      className="flex shrink-0 items-center justify-end gap-0.5 px-2 pb-0.5"
      data-session-bulk-row=""
    >
      {unreadCount > 0 ? (
        <Tip label={bulk.markSectionRead}>
          <Button
            aria-label={bulk.markSectionRead}
            className={BULK_BTN}
            onClick={onMarkRead}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="check-all" size="0.75rem" />
          </Button>
        </Tip>
      ) : null}
      <Tip label={bulk.select}>
        <Button
          aria-label={bulk.select}
          className={BULK_BTN}
          onClick={onSelectionStart}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="checklist" size="0.75rem" />
        </Button>
      </Tip>
    </div>
  )
}

const BULK_BTN = 'text-(--ui-text-tertiary) hover:text-(--ui-text-primary) gap-1 text-[0.6875rem]'

const sessionDropTargetProps = (pinned: boolean) =>
  pinned ? { 'data-session-pin-drop': '' } : { 'data-session-unpin-drop': '' }

interface SortableSessionRowProps {
  session: SessionInfo
  isPinned: boolean
  isSelected: boolean
  unread: boolean
  selectionMode?: boolean
  selected?: boolean
  onToggleSelected?: () => void
  onArchive: () => void
  onDelete: () => void
  onPin: () => void
  onToggleUnread: () => void
  onResume: () => void
}

function SortableSidebarSessionRow(props: SortableSessionRowProps) {
  return <SidebarSessionRow {...props} {...useSortableBindings(props.session.id)} />
}

function SortableProjectOverviewRow(props: React.ComponentProps<typeof ProjectOverviewRow>) {
  return <ProjectOverviewRow {...props} {...useSortableBindings(props.project.id)} />
}
