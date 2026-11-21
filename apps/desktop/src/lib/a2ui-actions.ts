// A2UI renderer→agent action bridge (P2): capture a surface tap as a visible
// user follow-up through the session owner's `prompt.submit`.
//
// Delivery reuses the pipeline's safety properties without the pipeline: the
// RPC is owner-routed and fail-closed (`requestForOwnedSession`, the #91684 /
// #93080 lesson), carries an explicit `submission_id` for gateway dedupe, and
// the surface disables while the turn runs or the action is in flight, so a
// double-click cannot mint two turns. Fresh input components stay display-only
// in P2 — only explicit button taps submit; two-way sync is P3 with the agent
// authoring convention.

import { randomUuid } from '@hermes/shared'

export interface A2uiOutboundAction {
  /** Stable key: message + surface + name + context hash (remount-proof). */
  key: string
  name: string
  surfaceId: string
  /** Human line for the user bubble. */
  text: string
  /** Full machine payload (goes in the fenced block). */
  payload: Record<string, unknown>
}

/** Normalize a component's action declaration. Nameless actions become a generic `click`. */
export function normalizeA2uiAction(
  messageId: string,
  surfaceId: string,
  componentId: string,
  action: unknown,
  label: string
): A2uiOutboundAction {
  const record = typeof action === 'object' && action !== null ? (action as Record<string, unknown>) : null
  const name = typeof record?.name === 'string' && record.name ? record.name : 'click'
  const data = { ...(record ?? {}), componentId }
  const key = [messageId, surfaceId, name, stableHash(data)].join('|')

  return { key, name, surfaceId, text: formatA2uiActionText(surfaceId, label || name), payload: { surface: surfaceId, action: name, data } }
}

/** Visible user-bubble text: human line plus a machine-readable fenced block. */
export function formatA2uiActionText(surfaceId: string, label: string): string {
  return `[A2UI · ${surfaceId}] ${label}`
}

/** Shape of the action callback the real MessageProcessor invokes. */
export interface A2uiActionPayload {
  name: string
  surfaceId: string
  sourceComponentId: string
  context: Record<string, unknown>
}

/** Map a processor action callback into the outbound follow-up model. */
export function fromA2uiActionPayload(messageId: string, payload: A2uiActionPayload): A2uiOutboundAction {
  const label = typeof payload.context.label === 'string' && payload.context.label ? payload.context.label : payload.name
  const data = { ...payload.context, componentId: payload.sourceComponentId }
  const key = [messageId, payload.surfaceId, payload.name, stableHash(data)].join('|')

  return { key, name: payload.name, surfaceId: payload.surfaceId, text: formatA2uiActionText(payload.surfaceId, label), payload: { surface: payload.surfaceId, action: payload.name, data } }
}

/** Minimal `prompt.submit` params (the canonical layer fills anything else). */
export function a2uiSubmitParams(sessionId: string, action: A2uiOutboundAction): Record<string, unknown> {
  return {
    session_id: sessionId,
    submission_id: randomUuid(),
    text: `${action.text}\n\n\`\`\`a2ui-action\n${JSON.stringify(action.payload)}\n\`\`\``
  }
}

function stableHash(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, sortDeep(entry)])
    )
  }

  return value
}
