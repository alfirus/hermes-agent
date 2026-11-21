import { describe, expect, it } from 'vitest'

import { a2uiSubmitParams, formatA2uiActionText, fromA2uiActionPayload, normalizeA2uiAction } from './a2ui-actions'

describe('normalizeA2uiAction', () => {
  it('builds a stable key for identical inputs', () => {
    const a = normalizeA2uiAction('m1', 'plan', 'go', { name: 'approve', extra: 1 }, 'Approve')
    const b = normalizeA2uiAction('m1', 'plan', 'go', { extra: 1, name: 'approve' }, 'Approve')

    expect(a.key).toBe(b.key)
  })

  it('keys on message, surface, name, and context', () => {
    const base = normalizeA2uiAction('m1', 'plan', 'go', { name: 'approve' }, 'Approve')

    expect(normalizeA2uiAction('m2', 'plan', 'go', { name: 'approve' }, 'Approve').key).not.toBe(base.key)
    expect(normalizeA2uiAction('m1', 'other', 'go', { name: 'approve' }, 'Approve').key).not.toBe(base.key)
    expect(normalizeA2uiAction('m1', 'plan', 'go', { name: 'reject' }, 'Reject').key).not.toBe(base.key)
  })

  it('falls back to a generic click for nameless actions', () => {
    const action = normalizeA2uiAction('m1', 'plan', 'go', null, 'Go')

    expect(action.name).toBe('click')
    expect(action.text).toBe('[A2UI · plan] Go')
  })

  it('keeps the component id in the payload for agent routing', () => {
    const action = normalizeA2uiAction('m1', 'plan', 'go', { name: 'approve', choice: 'a' }, 'Approve')

    expect(action.payload).toEqual({ surface: 'plan', action: 'approve', data: { name: 'approve', choice: 'a', componentId: 'go' } })
  })
})

describe('fromA2uiActionPayload', () => {
  it('maps a processor callback into the outbound model', () => {
    const action = fromA2uiActionPayload('m1', {
      name: 'approve',
      surfaceId: 'plan',
      sourceComponentId: 'go',
      context: { choice: 'yes' }
    })

    expect(action.key).toContain('m1|plan|approve')
    expect(action.text).toBe('[A2UI · plan] approve')
    expect(action.payload).toEqual({ surface: 'plan', action: 'approve', data: { choice: 'yes', componentId: 'go' } })
  })

  it('prefers a context label for the human line', () => {
    const action = fromA2uiActionPayload('m1', {
      name: 'approve',
      surfaceId: 'plan',
      sourceComponentId: 'go',
      context: { label: 'Approve it' }
    })

    expect(action.text).toBe('[A2UI · plan] Approve it')
  })
})
describe('formatA2uiActionText', () => {
  it('names the surface and the human label', () => {
    expect(formatA2uiActionText('plan', 'Approve')).toBe('[A2UI · plan] Approve')
  })
})
describe('a2uiSubmitParams', () => {
  it('targets the owning session with a dedupe id and a machine payload', () => {
    const action = normalizeA2uiAction('m1', 'plan', 'go', { name: 'approve' }, 'Approve')
    const params = a2uiSubmitParams('sess-1', action)

    expect(params.session_id).toBe('sess-1')
    expect(typeof params.submission_id).toBe('string')
    expect(String(params.text)).toContain('[A2UI · plan] Approve')
    expect(String(params.text)).toContain('"action":"approve"')
    expect(String(params.text)).toContain('```a2ui-action')
  })

  it('mints a fresh submission id per call', () => {
    const action = normalizeA2uiAction('m1', 'plan', 'go', { name: 'approve' }, 'Approve')

    expect(a2uiSubmitParams('sess-1', action).submission_id).not.toBe(a2uiSubmitParams('sess-1', action).submission_id)
  })
})
