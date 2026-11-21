"""Tests for optional-skills/web-development/a2ui-chat-surfaces/scripts/validate_surface.py."""

import json
import re
import sys
from pathlib import Path

import hermes_yaml as yaml

SKILL_DIR = Path(__file__).resolve().parents[2] / "optional-skills" / "web-development" / "a2ui-chat-surfaces"
sys.path.insert(0, str(SKILL_DIR / "scripts"))

import validate_surface as vs

TEMPLATE = json.loads((SKILL_DIR / "templates" / "approval-card.json").read_text(encoding="utf-8"))


def check(body, strict=False):
    errors, warnings = vs.validate_envelopes(body)
    if strict and warnings:
        return ["strict: warnings treated as errors", *errors]
    return errors


class TestFrontmatter:
    def test_name_matches_directory(self):
        content = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        assert content.startswith("---")
        match = re.search(r"\n---\s*\n", content[3:])
        assert match, "SKILL.md frontmatter must close"
        fm = yaml.safe_load(content[3 : match.start() + 3])
        assert fm["name"] == SKILL_DIR.name
        assert len(fm["description"]) <= 60
        assert fm["description"].rstrip().endswith(".")


class TestTemplate:
    def test_template_is_strict_clean(self):
        assert check(TEMPLATE, strict=True) == []

    def test_skill_example_is_strict_clean(self):
        content = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        body = json.loads(vs.extract_block(content))
        assert check(body, strict=True) == []


class TestGateParity:
    def test_rejects_non_json_shape(self):
        assert check([]) == ["a2ui: no envelopes"]

    def test_rejects_bad_version(self):
        assert check({"version": "v1.0", "createSurface": {"surfaceId": "s"}}) != []

    def test_rejects_two_message_types(self):
        assert check({
            "version": "v0.9",
            "createSurface": {"surfaceId": "s"},
            "deleteSurface": {"surfaceId": "s"},
        }) != []

    def test_rejects_unknown_key(self):
        assert check({"version": "v0.9", "createSurface": {"surfaceId": "s"}, "bogus": 1}) != []

    def test_requires_createsurface_first(self):
        assert check({"version": "v0.9", "deleteSurface": {"surfaceId": "s"}}) != []

    def test_rejects_second_surface(self):
        body = [
            {"version": "v0.9", "createSurface": {"surfaceId": "a"}},
            {"version": "v0.9", "deleteSurface": {"surfaceId": "b"}},
        ]
        assert check(body) == ["a2ui: one fence renders one surface"]

    def test_rejects_component_without_component(self):
        body = [
            {"version": "v0.9", "createSurface": {"surfaceId": "s"}},
            {"version": "v0.9", "updateComponents": {
                "surfaceId": "s", "components": [{"id": "x", "name": "Text"}]}},
        ]
        assert check(body) == ["a2ui: each component needs {id, component}"]

    def test_rejects_datamodel_without_value(self):
        body = [
            {"version": "v0.9", "createSurface": {"surfaceId": "s"}},
            {"version": "v0.9", "updateDataModel": {"surfaceId": "s"}},
        ]
        assert check(body) == ["a2ui: updateDataModel requires a value object"]


class TestWarnings:
    def test_unknown_component_warns_but_passes(self):
        body = [
            {"version": "v0.9", "createSurface": {"surfaceId": "s"}},
            {"version": "v0.9", "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {"id": "root", "component": "Column", "children": ["x"]},
                    {"id": "x", "component": "Hologram"},
                ]}},
        ]
        errors, warnings = vs.validate_envelopes(body)
        assert errors == []
        assert any("Hologram" in warning for warning in warnings)
        assert check(body, strict=True) != []

    def test_nameless_button_action_warns(self):
        body = [
            {"version": "v0.9", "createSurface": {"surfaceId": "s"}},
            {"version": "v0.9", "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {"id": "root", "component": "Column", "children": ["go"]},
                    {"id": "go", "component": "Button", "child": "Go"},
                ]}},
        ]
        _, warnings = vs.validate_envelopes(body)
        assert any("action.event.name" in warning for warning in warnings)


class TestFenceExtraction:
    def test_pulls_first_a2ui_fence(self):
        doc = "hello\n```a2ui\n" + json.dumps(TEMPLATE) + "\n```\ntail"
        assert json.loads(vs.extract_block(doc)) == TEMPLATE

    def test_raw_json_passes_through(self):
        assert json.loads(vs.extract_block(json.dumps(TEMPLATE))) == TEMPLATE
