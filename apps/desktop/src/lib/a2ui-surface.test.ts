import { describe, expect, it } from 'vitest'

import {
  extractA2uiEnvelopes,
  interpolateA2ui,
  parseA2uiFence,
  resolveA2uiPath
} from './a2ui-surface'

const V = 'v0.9'
const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

function stream(extra: unknown[] = []): string {
  return JSON.stringify([
    { version: V, createSurface: { surfaceId: 'plan', catalogId: CATALOG } },
    { version: V, updateDataModel: { surfaceId: 'plan', value: { task: 'Cut release', done: false } } },
    {
      version: V,
      updateComponents: {
        surfaceId: 'plan',
        components: [
          { id: 'root', component: 'Column', children: ['t', 'go'] },
          { id: 't', component: 'Text', text: { path: '/task' } },
          { id: 'go', component: 'Button', child: 'Approve', action: { event: { name: 'approve' } } }
        ]
      }
    },
    ...extra
  ])
}

describe('extractA2uiEnvelopes', () => {
  it('returns the surface id and raw messages for a sealed fence', () => {
    const set = extractA2uiEnvelopes(stream())

    expect(set.surfaceId).toBe('plan')
    expect(set.messages).toHaveLength(3)
  })

  it('accepts a single envelope object, not just an array', () => {
    const set = extractA2uiEnvelopes(JSON.stringify({ version: V, createSurface: { surfaceId: 's1', catalogId: CATALOG } }))

    expect(set.surfaceId).toBe('s1')
    expect(set.messages).toHaveLength(1)
  })

  it('rejects partial JSON, missing versions, and unknown keys (strict v0.9 parity)', () => {
    expect(() => extractA2uiEnvelopes('not json{{{')).toThrow()
    expect(() => extractA2uiEnvelopes(JSON.stringify({ createSurface: { surfaceId: 'x', catalogId: CATALOG } }))).toThrow(/version/)
    expect(() => extractA2uiEnvelopes(JSON.stringify({ version: 'v1.0', createSurface: { surfaceId: 'x', catalogId: CATALOG } }))).toThrow(/version/)
    // Two message types in one envelope is malformed.
    expect(() =>
      extractA2uiEnvelopes(JSON.stringify({ version: V, createSurface: { surfaceId: 'x', catalogId: CATALOG }, deleteSurface: { surfaceId: 'x' } }))
    ).toThrow(/exactly one/)
    // Unknown top-level keys are rejected, matching the spec's strict schemas.
    expect(() =>
      extractA2uiEnvelopes(JSON.stringify({ version: V, createSurface: { surfaceId: 'x', catalogId: CATALOG }, metadata: {} }))
    ).toThrow(/unknown envelope key/)
  })

  it('requires one surface opened by createSurface', () => {
    expect(() =>
      extractA2uiEnvelopes(JSON.stringify({ version: V, updateDataModel: { surfaceId: 'x', data: {} } }))
    ).toThrow(/first envelope must be createSurface/)
    expect(() =>
      extractA2uiEnvelopes(
        JSON.stringify([
          { version: V, createSurface: { surfaceId: 'a', catalogId: CATALOG } },
          { version: V, updateDataModel: { surfaceId: 'b', data: {} } }
        ])
      )
    ).toThrow(/one surface/)
  })
})

describe('parseA2uiFence', () => {
  it('folds a create/model/components stream into one surface', () => {
    const surface = parseA2uiFence(stream())

    expect(surface.id).toBe('plan')
    expect(surface.catalog).toBe(CATALOG)
    expect(surface.components.map(c => c.id)).toEqual(['root', 't', 'go'])
    expect(surface.dataModel).toEqual({ task: 'Cut release', done: false })
  })

  it('upserts components by id across updates', () => {
    const surface = parseA2uiFence(
      JSON.stringify([
        { version: V, createSurface: { surfaceId: 's', catalogId: CATALOG } },
        { version: V, updateComponents: { surfaceId: 's', components: [{ id: 'a', component: 'Text', text: 'one' }] } },
        { version: V, updateComponents: { surfaceId: 's', components: [{ id: 'a', component: 'Text', text: 'two' }] } }
      ])
    )

    expect(surface.components).toHaveLength(1)
    expect(surface.components[0].text).toBe('two')
  })

  it('deep-merges data model updates', () => {
    const surface = parseA2uiFence(
      JSON.stringify([
        { version: V, createSurface: { surfaceId: 's', catalogId: CATALOG } },
        { version: V, updateDataModel: { surfaceId: 's', value: { form: { a: 1 } } } },
        { version: V, updateDataModel: { surfaceId: 's', value: { form: { b: 2 } } } }
      ])
    )

    expect(surface.dataModel).toEqual({ form: { a: 1, b: 2 } })
  })

  it('sets a single slot when the update carries a path', () => {
    const surface = parseA2uiFence(
      JSON.stringify([
        { version: V, createSurface: { surfaceId: 's', catalogId: CATALOG } },
        { version: V, updateDataModel: { surfaceId: 's', value: { form: { a: 1 } } } },
        { version: V, updateDataModel: { surfaceId: 's', path: '/form/b', value: 2 } }
      ])
    )

    expect(surface.dataModel).toEqual({ form: { a: 1, b: 2 } })
  })

  it('rejects nameless components', () => {
    expect(() =>
      parseA2uiFence(
        JSON.stringify([
          { version: V, createSurface: { surfaceId: 'x', catalogId: CATALOG } },
          { version: V, updateComponents: { surfaceId: 'x', components: [{ id: 'a' }] } }
        ])
      )
    ).toThrow(/id, component/)
  })
})

describe('a2ui data binding', () => {
  it('resolves /paths and leaves unknown placeholders literal', () => {
    const model = { task: 'Cut release', nested: { deep: 'yes' } }

    expect(resolveA2uiPath(model, '/task')).toBe('Cut release')
    expect(resolveA2uiPath(model, '/nested/deep')).toBe('yes')
    expect(resolveA2uiPath(model, '/missing')).toBeUndefined()
    expect(interpolateA2ui('Tonight: {/task} ({/missing})', model)).toBe('Tonight: Cut release ({/missing})')
  })
})
