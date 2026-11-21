# A2UI v0.9 emission convention for Hermes chat

How an agent emits a surface the Hermes Desktop transcript renders inline.
The renderer gate (`apps/desktop/src/lib/a2ui-surface.ts`) enforces §1–§4;
`@a2ui/web_core`'s MessageProcessor is the schema authority for everything else.

## 1. The fence

- One fenced block per surface, language tag `a2ui`, body is a JSON array
  (a single object works for one envelope).
- The array must be **sealed**: partial JSON renders as source text until
  the fence closes. Never stream envelope-by-envelope; emit the whole
  block at once.
- All envelopes in one fence address **one `surfaceId`**, and the first
  envelope is always `createSurface`.

## 2. Envelope shape

Every envelope is `{ "version": "v0.9", "<exactly one message>": { ... } }`.

| Message | Required body |
|---|---|
| `createSurface` | `surfaceId`, `catalogId` (basic: `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`) |
| `updateComponents` | `surfaceId`, `components`: non-empty list of `{ id, component, ... }` |
| `updateDataModel` | `surfaceId`, plus `path` + `value` (set one slot) **or** a `value` object (merge at root) |
| `deleteSurface` | `surfaceId` |

`version` accepts `v0.9` / `v0.9.1`. No other top-level keys beside
`version` and the message. Mixing two message types in one envelope is
rejected — the whole fence falls back to source text.

## 3. Field traps (each has bitten before)

- `component`, not `name`: `{ "id": "t", "component": "Text" }`.
- `catalogId`, not `catalog`: the URL above, on `createSurface`.
- `value`, not `data`: `updateDataModel` carries `value` (and optional `path`).
- Paths are `/a/b` JSON pointers into the data model. `{ "path": "/task" }`
  binds; `{/task}` inside a string interpolates. Unknown paths stay literal.
- Component `id`s are unique per surface; `children` lists reference them.

## 4. Proven subset

Verified rendering inside the transcript (light DOM — Hermes CSS, copy,
and find all reach it): `Column`, `Row`, `Text`, `Button`.

- `Text`: `{ "id": "t", "component": "Text", "text": { "path": "/task" } }`
  or a literal `"text": "..."`. Markdown renders through the chat's own
  typography.
- `Button`: `{ "id": "go", "component": "Button", "child": "Approve",
  "action": { "event": { "name": "approve", "context": { ... } } } }`.
  The label is `child`. The event `name` is required — without it the
  tap has nothing to say.
- `Column` / `Row`: `{ "id": "root", "component": "Column",
  "children": ["t", "row"] }`.

Other basic-catalog components (Card, List, Image, TextField, CheckBox,
Tabs, …) are hosted by the same renderer but **unverified in chat**:
they render, yet promise nothing about look or feel. Prefer the proven
four; anything else ships behind a warning from `validate_surface.py`.

## 5. Action contract

A tap submits a **visible** follow-up on the owning session, reusing the
normal send pipeline (capability checks, idempotency):

- Bubble text: `[A2UI · <surfaceId>] <label>`.
- Machine-readable `a2ui-action` fence: `surfaceId`, `action`, `context`,
  `messageId`.
- Per-button states (`idle → busy → pending → sent`) block double-taps;
  while the thread runs, taps queue as `pending`, never lost, never doubled.
- Delivery failure toasts once (`assistant.a2ui.sendFailed`); the surface
  stays, so the user can retry.

Design rule: one button, one verb, one event name. Context carries the
payload the agent needs to continue — the label carries what the user
needs to decide.

## 6. Anti-patterns

- No `deleteSurface` in the same fence that creates the surface.
- No two surfaces in one fence — split into two blocks.
- No `action` without `event.name` (dead button, warns).
- No literal secrets in `context` — the follow-up bubble is visible in
  the transcript.
- No fetching: surfaces are declarative JSON only. There is no script,
  no URL, no callback — a surface that needs live data binds the data
  model and lets the agent send a follow-up stream.
