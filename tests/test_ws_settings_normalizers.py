# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""_normalize_automorph_style / _normalize_showcase_theme / the Showcase
preset sanitizer, unit-tested directly rather than through a mocked
websocket handler.

Extracted from ws_settings_set's inline logic after a code review found the
whole preset sanitizer (malformed-entry filtering, name truncation, numeric
clamping, and the stale-style/theme-key fallback) had zero test coverage —
and that this exact failure class (a whitelist check silently defaulting
with no error) had already shipped once for lights_automorph_style, one
commit before the preset system was added. Extracting these into plain
functions makes them directly testable without needing to construct a fake
HA connection/message just to exercise a few lines of validation.
"""

from __future__ import annotations

from custom_components.padspan_ha.ws_settings import (
    _normalize_automorph_style,
    _normalize_showcase_theme,
    _sanitize_showcase_presets,
)


def test_normalize_automorph_style_passes_through_a_real_style():
    assert _normalize_automorph_style("spikecrown") == "spikecrown"


def test_normalize_automorph_style_falls_back_to_glow_for_anything_unknown():
    assert _normalize_automorph_style("a-style-that-no-longer-exists") == "glow"
    assert _normalize_automorph_style("") == "glow"
    assert _normalize_automorph_style(None) == "glow"


def test_normalize_automorph_style_is_case_and_whitespace_insensitive():
    assert _normalize_automorph_style("  SpikeCrown ") == "spikecrown"


def test_normalize_showcase_theme_passes_through_a_real_theme():
    assert _normalize_showcase_theme("obsidian_noir") == "obsidian_noir"


def test_normalize_showcase_theme_falls_back_to_classic_for_anything_unknown():
    """The exact failure mode a code review flagged as untested: a stale or
    invalid theme string must normalize to "classic", never pass through
    raw or silently corrupt the stored setting."""
    assert _normalize_showcase_theme("a-theme-that-no-longer-exists") == "classic"
    assert _normalize_showcase_theme("") == "classic"
    assert _normalize_showcase_theme(None) == "classic"


def _preset(name="Look", **overrides):
    values = {
        "lights_showcase": True, "lights_showcase_theme": "hygge",
        "lights_fit_rooms": False, "lights_isolux": False,
        "lights_show_beacons": False, "lights_hide_device_codes": False,
        "lights_hide_untouched": False, "lights_automorph_enabled": True,
        "lights_automorph_room_pct": 40, "lights_automorph_hardness": -10,
        "lights_automorph_style": "geode", "lights_automorph_subtlety": 0,
        **overrides,
    }
    return {"name": name, "values": values}


def test_sanitize_showcase_presets_passes_through_a_well_formed_preset():
    out = _sanitize_showcase_presets([_preset()])
    assert len(out) == 1
    assert out[0]["name"] == "Look"
    assert out[0]["values"]["lights_showcase_theme"] == "hygge"
    assert out[0]["values"]["lights_automorph_style"] == "geode"


def test_sanitize_showcase_presets_resets_a_stale_style_or_theme_to_defaults():
    out = _sanitize_showcase_presets([_preset(
        lights_showcase_theme="a-removed-theme",
        lights_automorph_style="a-removed-style",
    )])
    assert out[0]["values"]["lights_showcase_theme"] == "classic"
    assert out[0]["values"]["lights_automorph_style"] == "glow"


def test_sanitize_showcase_presets_drops_malformed_entries_without_rejecting_the_rest():
    out = _sanitize_showcase_presets([
        "not-a-dict",
        {"name": "", "values": {}},          # empty name
        {"values": {"x": 1}},                # missing name entirely
        {"name": "No Values"},                # missing values
        {"name": "Bad Numeric", "values": {**_preset()["values"], "lights_automorph_room_pct": "not-a-number"}},
        _preset("Good One"),
    ])
    assert [p["name"] for p in out] == ["Good One"]


def test_sanitize_showcase_presets_truncates_a_too_long_name():
    out = _sanitize_showcase_presets([_preset("x" * 100)])
    assert len(out[0]["name"]) == 60


def test_sanitize_showcase_presets_clamps_numeric_fields():
    out = _sanitize_showcase_presets([_preset(
        lights_automorph_room_pct=500, lights_automorph_hardness=-500,
    )])
    assert out[0]["values"]["lights_automorph_room_pct"] == 100
    assert out[0]["values"]["lights_automorph_hardness"] == -100


def test_sanitize_showcase_presets_keeps_the_50_most_recent_not_the_first_50():
    """A code review caught this as a real, shipped data-loss bug: the
    original `presets_in[:50]` kept the OLDEST 50 and silently dropped a
    just-appended 51st preset every time, while the frontend still reported
    "Saved". The frontend always appends a new preset LAST, so the fix must
    keep the tail of the list, not the head."""
    presets = [_preset(f"Old {i}") for i in range(50)] + [_preset("Newest")]
    out = _sanitize_showcase_presets(presets)
    assert len(out) == 50
    assert out[-1]["name"] == "Newest", "the just-saved preset must survive, not vanish"
    assert "Old 0" not in [p["name"] for p in out], "the OLDEST entry is the one that should be evicted"


def test_sanitize_showcase_presets_returns_empty_list_for_non_list_input():
    assert _sanitize_showcase_presets("not-a-list") == []
    assert _sanitize_showcase_presets(None) == []
