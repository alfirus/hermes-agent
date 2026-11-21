// A2UI v0.9 surface model for the chat transcript.
//
// Pure helpers only — no React, no store. `extractA2uiEnvelopes` is the
// structural gate the renderer consumes (JSON parses, spec-shaped envelopes,
// one surface); the real `@a2ui/web_core` MessageProcessor behind it is the
// schema authority for component internals. `parseA2uiFence` keeps the small
// subset fold for tests and the P3 authoring convention.

export const A2UI_FENCE_LANGUAGE = 'a2ui'

export const A2UI_VERSIONS = ['v0.9', 'v0.9.1'] as const

const ENVELOPE_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const
type EnvelopeKind = (typeof ENVELOPE_KEYS)[number]

export interface A2uiComponent {
  id: string
  /** Catalog type name (the wire field; e.g. `Text`, `Button`). */
  component: string
  children?: string[]
  [key: string]: unknown
}

export interface A2uiSurface {
  id: string
  catalog: string
  components: A2uiComponent[]
  dataModel: Record<string, unknown>
}

/** A sealed fence: validated raw envelopes plus the surface they address. */
export interface A2uiEnvelopeSet {
  surfaceId: string
  messages: Record<string, unknown>[]
}

/**
 * Structural gate for the renderer: the block parses, holds spec-shaped
 * v0.9 envelopes for a single surface, and opens with createSurface.
 * Throws on partial JSON (streaming state — renders as source) and on
 * schema drift (the processor would reject it; the boundary shows source).
 */
export function extractA2uiEnvelopes(code: string): A2uiEnvelopeSet {
  const trimmed = code.trim()

  if (!trimmed) {
    throw new Error('a2ui: empty block')
  }

  let raw: unknown

  try {
    raw = JSON.parse(trimmed)
  } catch {
    throw new Error('a2ui: block is not JSON (renders as source until the fence seals)')
  }

  const messages = Array.isArray(raw) ? raw : [raw]

  if (!messages.length) {
    throw new Error('a2ui: no envelopes')
  }

  const checked = messages.map(validateEnvelopeStructure)
  const [first] = checked

  if (first.kind !== 'createSurface') {
    throw new Error('a2ui: first envelope must be createSurface')
  }

  for (const { record } of checked) {
    if (record.surfaceId !== first.record.surfaceId) {
      throw new Error('a2ui: one fence renders one surface')
    }
  }

  return { surfaceId: first.record.surfaceId, messages: messages as Record<string, unknown>[] }
}

function validateEnvelopeStructure(env: unknown): { kind: EnvelopeKind; record: Record<string, unknown> & { surfaceId: string } } {
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new Error('a2ui: envelope must be an object')
  }

  const record = env as Record<string, unknown>

  if (typeof record.version !== 'string' || !(A2UI_VERSIONS as readonly string[]).includes(record.version)) {
    throw new Error('a2ui: envelope needs a v0.9 version')
  }

  const keys = ENVELOPE_KEYS.filter(k => k in record)

  if (keys.length !== 1) {
    throw new Error('a2ui: envelope must carry exactly one message type')
  }

  const kind = keys[0] as EnvelopeKind

  for (const key of Object.keys(record)) {
    if (key !== 'version' && key !== kind) {
      throw new Error(`a2ui: unknown envelope key ${key}`)
    }
  }

  const body = record[kind]

  if (typeof body !== 'object' || body === null) {
    throw new Error(`a2ui: ${kind} must be an object`)
  }

  const surfaceId = (body as Record<string, unknown>).surfaceId

  if (typeof surfaceId !== 'string' || !surfaceId) {
    throw new Error(`a2ui: ${kind} requires surfaceId`)
  }

  return { kind, record: { ...(body as Record<string, unknown>), surfaceId } as Record<string, unknown> & { surfaceId: string } }
}

/** Fold a ```a2ui fence body into the subset surface model. Throws on anything else. */
export function parseA2uiFence(code: string): A2uiSurface {
  const { messages } = extractA2uiEnvelopes(code)

  let surface: A2uiSurface | null = null

  for (const env of messages) {
    surface = applyEnvelope(surface, env)
  }

  if (!surface) {
    throw new Error('a2ui: no surface created')
  }

  return surface
}

function applyEnvelope(current: A2uiSurface | null, env: unknown): A2uiSurface | null {
  // Structural validation lives in validateEnvelopeStructure; the fold trusts it.
  const record = env as Record<string, unknown>
  const kind = (ENVELOPE_KEYS.find(k => k in record) ?? 'updateDataModel') as EnvelopeKind
  const body = record[kind]

  if (typeof body !== 'object' || body === null) {
    throw new Error(`a2ui: ${kind} must be an object`)
  }

  const surfaceRecord = body as Record<string, unknown>
  const surfaceId = surfaceRecord.surfaceId

  if (typeof surfaceId !== 'string' || !surfaceId) {
    throw new Error(`a2ui: ${kind} requires surfaceId`)
  }

  if (kind === 'deleteSurface') {
    return null
  }

  const surface: A2uiSurface = current ?? { id: surfaceId, catalog: 'basic', components: [], dataModel: {} }

  if (kind === 'createSurface') {
    surface.id = surfaceId

    if (typeof surfaceRecord.catalogId === 'string') {
      surface.catalog = surfaceRecord.catalogId
    } else if (typeof surfaceRecord.catalog === 'string') {
      surface.catalog = surfaceRecord.catalog
    }

    if (Array.isArray(surfaceRecord.components)) {
      surface.components = validateComponents(surfaceRecord.components)
    }

    if (isRecord(surfaceRecord.dataModel)) {
      surface.dataModel = surfaceRecord.dataModel
    }

    return surface
  }

  if (kind === 'updateComponents') {
    if (!Array.isArray(surfaceRecord.components) || !surfaceRecord.components.length) {
      throw new Error('a2ui: updateComponents.components must be a non-empty list')
    }

    const next = validateComponents(surfaceRecord.components)
    const byId = new Map(surface.components.map(c => [c.id, c]))

    for (const comp of next) {
      byId.set(comp.id, comp)
    }

    surface.components = [...byId.values()]

    return surface
  }

  // updateDataModel: { surfaceId, path?, value? } — a path sets one slot,
  // a bare value object merges at the root (the wire replaces; the subset
  // fold merges so P3 examples compose).
  if (typeof surfaceRecord.path === 'string' && surfaceRecord.path) {
    setA2uiPath(surface.dataModel, surfaceRecord.path, surfaceRecord.value)

    return surface
  }

  if (!isRecord(surfaceRecord.value)) {
    throw new Error('a2ui: updateDataModel requires a value object')
  }

  deepMerge(surface.dataModel, surfaceRecord.value)

  return surface
}

function validateComponents(list: unknown[]): A2uiComponent[] {
  return list.map(entry => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('a2ui: each component must be an object')
    }

    const comp = entry as Record<string, unknown>

    if (typeof comp.id !== 'string' || typeof comp.component !== 'string') {
      throw new Error('a2ui: each component needs {id, component}')
    }

    return comp as A2uiComponent
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(src)) {
    if (isRecord(value) && isRecord(dst[key])) {
      deepMerge(dst[key], value)
    } else {
      dst[key] = value
    }
  }
}

/** Resolve a `/a/b` path against the surface data model. */
export function resolveA2uiPath(model: Record<string, unknown>, path: string): unknown {
  if (!path.startsWith('/')) {
    return undefined
  }

  let current: unknown = model

  for (const part of path.slice(1).split('/').filter(Boolean)) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }

    current = (current as Record<string, unknown>)[Array.isArray(current) && /^\d+$/.test(part) ? Number(part) : part]
  }

  return current
}

/** Set a `/a/b` slot on the surface data model, creating objects as needed. */
export function setA2uiPath(model: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('/').filter(Boolean)

  if (!parts.length) {
    return
  }

  let current = model

  for (const part of parts.slice(0, -1)) {
    const next = current[part]

    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[part] = {}
    }

    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
}

/** Interpolate `{/path}` placeholders in a string value. Unknown paths stay literal. */
export function interpolateA2ui(value: unknown, model: Record<string, unknown>): unknown {
  if (typeof value !== 'string') {
    return value
  }

  return value.replace(/\{(\/[^{}]*)\}/g, (match, path: string) => {
    const resolved = resolveA2uiPath(model, path)

    return resolved === undefined || resolved === null ? match : String(resolved)
  })
}
