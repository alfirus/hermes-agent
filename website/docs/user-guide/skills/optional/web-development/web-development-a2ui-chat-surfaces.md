---
title: "A2Ui Chat Surfaces — Emit interactive A2UI surfaces into the transcript"
sidebar_label: "A2Ui Chat Surfaces"
description: "Emit interactive A2UI surfaces into the transcript"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# A2Ui Chat Surfaces

Emit interactive A2UI surfaces into the transcript.

## Skill metadata

| | |
|---|---|
| Source | Optional — install with `hermes skills install official/web-development/a2ui-chat-surfaces` |
| Path | `optional-skills/web-development\a2ui-chat-surfaces` |
| Version | `0.1.0` |
| Author | Alfirus Ahmad (alfirus), Hermes Agent |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `a2ui`, `chat`, `surfaces`, `catalog`, `agent-ui` |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# A2UI Chat Surfaces Skill

Emit declarative A2UI v0.9 surfaces that Hermes Desktop renders inline in
the chat transcript (approval cards, status panels, choice buttons). You
write sealed JSON; the transcript renders it and routes taps back as
visible follow-ups. It does not run scripts, fetch URLs, or open pages —
for driving a browser use `browser_exec` instead.

## When to Use

- The agent's reply needs a **tappable surface**: approve / reject, pick
  an option, confirm a plan, show bound live status.
- The user asks for buttons, cards, or interactive UI **inside Hermes chat**.
- Validating or fixing an `a2ui` fenced block before sending it.

Don't use for:

- Static prose, code, or tables — plain markdown already wins there.
- Web pages or external apps — this renders only in the Hermes transcript.
- Anything needing script, network, or navigation — surfaces are JSON only.

## Prerequisites

- A Hermes Desktop build containing the A2UI chat-surface integration
  (the `a2ui` fence language renders it; older builds show source text).
- Python 3.11+ for the validator (stdlib only, no installs).

## How to Run

Validate before sending, from the repo root, through the `terminal` tool:

```text
terminal(command="python optional-skills/web-development/a2ui-chat-surfaces/scripts/validate_surface.py <file> [--strict]")
```

`<file>` is the JSON body or a markdown file holding the fence; `-`
reads stdin. Exit 0 means sendable. `--strict` fails on warnings.

## Quick Reference

Minimal sendable surface (full copy in `templates/approval-card.json`):

```a2ui
[
  { "version": "v0.9", "createSurface": { "surfaceId": "plan", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json" } },
  { "version": "v0.9", "updateDataModel": { "surfaceId": "plan", "value": { "task": "Cut release" } } },
  { "version": "v0.9", "updateComponents": { "surfaceId": "plan", "components": [
    { "id": "root", "component": "Column", "children": ["t", "row"] },
    { "id": "t", "component": "Text", "text": { "path": "/task" } },
    { "id": "row", "component": "Row", "children": ["go"] },
    { "id": "go", "component": "Button", "child": "Approve", "action": { "event": { "name": "approve", "context": { "choice": "yes" } } } }
  ] } }
]
```

Wrap the array in one fenced block tagged `a2ui`. Field traps: `component` not `name`,
`catalogId` not `catalog`, `value` not `data`. Full rules live in
`references/wire-format.md`.

## Procedure

1. **Decide the surface.** One verb per button, one fence per surface.
   Completion: the surfaceId, the buttons, and each button's event name
   are written down before any JSON.
2. **Draft the envelopes.** `createSurface` first, then data model, then
   components. Stick to the proven set (`Column`, `Row`, `Text`,
   `Button`) unless the user explicitly needs more.
   Completion: every `children` entry resolves to a defined component id.
3. **Validate.** Run the validator; fix every error, justify or fix every
   warning. Completion: exit 0, and `--strict` clean for anything
   user-facing.
4. **Send the sealed fence.** Emit the whole block at once — never stream
   it envelope by envelope. Completion: one closed fence, valid JSON.
5. **Confirm the loop.** Each tap must arrive back as a
   `[A2UI · <surfaceId>] <label>` follow-up the agent can continue from.
   Completion: state what each event name does when it comes back.

## Pitfalls

- Partial JSON renders as source text — a "broken surface" is usually an
  unclosed fence, not a renderer bug. Re-validate the exact sent bytes.
- Unknown components don't crash scroll; the branch silently drops.
  A missing piece means a typo'd `component` value — check it first.
- A tap with no `action.event.name` is a dead button; the validator warns.
- While the thread runs, taps queue as `pending` — clicking twice does
  not send twice, so don't "fix" a slow send by re-emitting the surface.
- Never put secrets in `context`: the follow-up bubble is visible.
- `deleteSurface` never shares a fence with the surface it deletes.

## Verification

- `terminal(command="python optional-skills/web-development/a2ui-chat-surfaces/scripts/validate_surface.py optional-skills/web-development/a2ui-chat-surfaces/templates/approval-card.json --strict")` exits 0.
- `scripts/run_tests.sh tests/skills/test_a2ui_chat_surfaces_skill.py -q` passes.
- A sent fence renders bound text plus a working button, and the tap
  returns a follow-up the agent answers from.
