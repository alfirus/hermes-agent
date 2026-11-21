#!/usr/bin/env python3
"""Offline structural check for an A2UI v0.9 chat surface.

Mirrors the render gate in apps/desktop/src/lib/a2ui-surface.ts
(`extractA2uiEnvelopes` + component/data-model shape checks): the same
input must pass here and there. Component internals stay the schema
authority of @a2ui/web_core's MessageProcessor -- this script only
rejects what the gate rejects, and warns about what is unproven in chat.

Usage:
    python scripts/validate_surface.py templates/approval-card.json
    python scripts/validate_surface.py surface.md --strict < FILE
    <paste> | python scripts/validate_surface.py -

Exit 0: no errors (warnings allowed). Exit 1: structural error, or a
warning under --strict.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

VERSIONS = ("v0.9", "v0.9.1")
ENVELOPE_KEYS = ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")

# Components proven inside the Hermes transcript (P2 test contract).
# The renderer hosts the whole basic catalog; anything else renders but
# is unverified in chat, so it warns instead of failing.
PROVEN_COMPONENTS = ("Text", "Button", "Column", "Row")

FENCE_RE = re.compile(r"```a2ui\s*\n(.*?)```", re.DOTALL)


def extract_block(text: str) -> str:
    """Accept a raw JSON body or a markdown file; pull the first ```a2ui fence."""
    match = FENCE_RE.search(text)
    return match.group(1).strip() if match else text.strip()


def _check_component(comp: object, errors: list[str], warnings: list[str]) -> None:
    """Shape-check one component entry; unknown types warn, broken shapes error."""
    if not isinstance(comp, dict):
        errors.append("a2ui: each component must be an object")
        return

    cid, ctype = comp.get("id"), comp.get("component")
    if not isinstance(cid, str) or not isinstance(ctype, str):
        errors.append("a2ui: each component needs {id, component}")
        return

    if ctype not in PROVEN_COMPONENTS:
        warnings.append(
            f"a2ui: {ctype!r} renders but is unverified in chat "
            f"(proven: {', '.join(PROVEN_COMPONENTS)})"
        )
    elif ctype == "Button":
        _check_button(cid, comp, warnings)
    elif ctype == "Text" and "text" not in comp:
        warnings.append(f"a2ui: Text {cid!r} has no text")


def _check_button(cid: str, comp: dict, warnings: list[str]) -> None:
    action = comp.get("action") or {}
    event = action.get("event") if isinstance(action, dict) else None
    name = event.get("name") if isinstance(event, dict) else None
    if "child" not in comp:
        warnings.append(f"a2ui: Button {cid!r} has no child label")
    if not isinstance(name, str) or not name:
        warnings.append(f"a2ui: Button {cid!r} has no action.event.name")


def _check_components_body(body: dict, where: str, errors: list[str], warnings: list[str]) -> None:
    components = body.get("components")
    if not isinstance(components, list) or not components:
        errors.append("a2ui: updateComponents.components must be a non-empty list")
        return

    for comp in components:
        _check_component(comp, errors, warnings)


def _check_datamodel_body(body: dict, where: str, errors: list[str], _warnings: list[str]) -> None:
    path = body.get("path")
    if isinstance(path, str) and path:
        return

    if not isinstance(body.get("value"), dict):
        errors.append("a2ui: updateDataModel requires a value object")


KIND_CHECKS = {
    "updateComponents": _check_components_body,
    "updateDataModel": _check_datamodel_body,
}


def validate_envelopes(raw: object) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for a parsed fence body."""
    errors: list[str] = []
    warnings: list[str] = []
    messages = raw if isinstance(raw, list) else [raw]

    if not messages:
        return ["a2ui: no envelopes"], warnings

    surface_id: str | None = None

    for index, env in enumerate(messages):
        where = f"envelope {index}"
        if not isinstance(env, dict) or isinstance(env, list):
            errors.append(f"a2ui: {where} must be an object")
            continue

        body, kind = _envelope_body(env, where, errors)
        if body is None or kind is None:
            continue

        sid = body.get("surfaceId")
        if not isinstance(sid, str) or not sid:
            errors.append(f"a2ui: {kind} requires surfaceId ({where})")
            continue

        if surface_id is None:
            if kind != "createSurface":
                errors.append("a2ui: first envelope must be createSurface")
            surface_id = sid
        elif sid != surface_id:
            errors.append("a2ui: one fence renders one surface")

        check = KIND_CHECKS.get(kind)
        if check is not None:
            check(body, where, errors, warnings)

    return errors, warnings


def _envelope_body(env: dict, where: str, errors: list[str]) -> tuple[dict | None, str | None]:
    """Pull (body, kind) from one envelope, or (None, None) with errors recorded."""
    version = env.get("version")
    if not isinstance(version, str) or version not in VERSIONS:
        errors.append(f"a2ui: {where} needs a v0.9 version")
        return None, None

    keys = [key for key in ENVELOPE_KEYS if key in env]
    if len(keys) != 1:
        errors.append(f"a2ui: {where} must carry exactly one message type")
        return None, None

    kind = keys[0]
    extra = [key for key in env if key not in ("version", kind)]
    if extra:
        errors.append(f"a2ui: unknown envelope key {extra[0]!r} in {where}")
        return None, None

    body = env[kind]
    if not isinstance(body, dict):
        errors.append(f"a2ui: {kind} must be an object ({where})")
        return None, None

    return body, kind


def main(argv: list[str]) -> int:
    strict = "--strict" in argv
    sources = [arg for arg in argv[1:] if arg != "--strict"]
    text = sys.stdin.read() if not sources or sources[0] == "-" else Path(sources[0]).read_text(encoding="utf-8")

    try:
        raw = json.loads(extract_block(text))
    except json.JSONDecodeError as exc:
        print(f"a2ui: block is not JSON ({exc.msg} at char {exc.pos})")
        return 1

    errors, warnings = validate_envelopes(raw)

    for warning in warnings:
        print(f"warning: {warning}")

    if strict and warnings:
        print(f"a2ui: {len(warnings)} warning(s) treated as errors under --strict")
        return 1

    for error in errors:
        print(f"error: {error}")

    if errors:
        return 1

    print(f"a2ui: ok ({len(raw) if isinstance(raw, list) else 1} envelope(s), "
          f"{len(warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
