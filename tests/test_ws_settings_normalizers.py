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
    _sanitize_light_shapes,
    _sanitize_showcase_presets,
    _sanitize_whole_house_presets,
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


def test_sanitize_showcase_presets_carries_the_layout_trio_when_present():
    """Garry (2026-09-12): "include more elements into this feature" — a
    preset may now carry the Floor / Spacing / L-R layout, under the SAME
    keys Save view writes, clamped exactly like the live setters."""
    out = _sanitize_showcase_presets([_preset(
        overview_iso_floor_gap=999, overview_iso_horiz_gap=-999, overview_iso_focus=2,
    )])
    v = out[0]["values"]
    assert v["overview_iso_floor_gap"] == 340
    assert v["overview_iso_horiz_gap"] == -120
    assert v["overview_iso_focus"] == 2


def test_sanitize_showcase_presets_keeps_a_null_focus_as_all_floors():
    out = _sanitize_showcase_presets([_preset(overview_iso_floor_gap=150, overview_iso_focus=None)])
    v = out[0]["values"]
    assert "overview_iso_focus" in v and v["overview_iso_focus"] is None


def test_sanitize_showcase_presets_leaves_the_layout_out_of_an_older_look():
    """A look saved before the layout keys existed must stay a pure look:
    no default floor gap / offset / focus may be invented for it, or
    applying it would snap the camera somewhere the user never chose."""
    v = _sanitize_showcase_presets([_preset()])[0]["values"]
    assert "overview_iso_floor_gap" not in v
    assert "overview_iso_horiz_gap" not in v
    assert "overview_iso_focus" not in v


# ── _sanitize_light_shapes ───────────────────────────────────────────────────

def test_sanitize_light_shapes_keeps_a_valid_light_override():
    assert _sanitize_light_shapes({"light.kitchen": "circle"}) == {"light.kitchen": "circle"}


def test_sanitize_light_shapes_now_keeps_non_light_classes_too():
    """Phase 2a registry audit, 2026-09-19: this used to keep only
    'light.'-prefixed keys, so the Atlas inspector's Shape chooser — offered
    for every placed class — silently saved nothing for a fan, a door, a
    lock, or any other non-light entity. resolveLightShape (light_codes.js)
    already applies an override generically regardless of class; the
    backend just wasn't storing what it was sent."""
    raw = {"fan.ceiling": "fan", "lock.front_door": "lock", "binary_sensor.front_door": "door"}
    assert _sanitize_light_shapes(raw) == raw


def test_sanitize_light_shapes_drops_an_unknown_shape_value():
    assert _sanitize_light_shapes({"light.x": "not_a_real_shape"}) == {}


def test_sanitize_light_shapes_drops_an_empty_key():
    assert _sanitize_light_shapes({"": "circle"}) == {}


def test_sanitize_light_shapes_returns_empty_dict_for_non_dict_input():
    assert _sanitize_light_shapes(None) == {}
    assert _sanitize_light_shapes([("light.x", "circle")]) == {}


# ── _sanitize_whole_house_presets ────────────────────────────────────────────

def _whp(name="Evening", entities=None, **extra):
    return {"name": name, "created_at": 1790000000.5,
            "entities": entities if entities is not None else {"light.kitchen": {"state": "on", "brightness": 180}},
            **extra}


def test_whole_house_presets_pass_through_a_well_formed_preset():
    out = _sanitize_whole_house_presets([_whp(entities={
        "light.kitchen": {"state": "on", "brightness": 180, "color_mode": "rgb", "rgb_color": [255, 120, 0], "effect": "Rainbow"},
        "light.hall": {"state": "off", "brightness": 40},
        "fan.ceiling": {"state": "on", "percentage": 66, "preset_mode": "breeze", "oscillating": True, "direction": "reverse"},
    })])
    assert len(out) == 1 and out[0]["name"] == "Evening" and out[0]["created_at"] == 1790000000.5
    e = out[0]["entities"]
    assert e["light.kitchen"] == {"state": "on", "brightness": 180, "color_mode": "rgb", "rgb_color": [255, 120, 0], "effect": "Rainbow"}
    assert e["light.hall"] == {"state": "off"}, "an OFF device stores nothing but off — stale attributes must not ride along"
    assert e["fan.ceiling"] == {"state": "on", "percentage": 66, "preset_mode": "breeze", "oscillating": True, "direction": "reverse"}


def test_whole_house_presets_refuse_every_domain_but_light_and_fan():
    """The security line: a saved preset must never be able to unlock a
    door, open a cover, disarm a panel or run a script when applied."""
    out = _sanitize_whole_house_presets([_whp(entities={
        "lock.front_door": {"state": "unlocked"},
        "cover.garage": {"state": "open"},
        "alarm_control_panel.house": {"state": "disarmed"},
        "switch.heater": {"state": "on"},
        "script.anything": {"state": "on"},
        "light.ok": {"state": "on"},
    })])
    assert list(out[0]["entities"]) == ["light.ok"]


def test_whole_house_presets_refuse_malformed_entity_ids_and_states():
    out = _sanitize_whole_house_presets([_whp(entities={
        "light.ok": {"state": "on"},
        "light.Bad Id": {"state": "on"},
        "light.x; drop": {"state": "on"},
        "light.unavail": {"state": "unavailable"},
        "light.notadict": "on",
        42: {"state": "on"},
    })])
    assert list(out[0]["entities"]) == ["light.ok"]


def test_whole_house_presets_clamp_and_drop_bad_attribute_values():
    out = _sanitize_whole_house_presets([_whp(entities={
        "light.a": {"state": "on", "brightness": 9999, "color_temp_kelvin": 5, "color_mode": "not_a_mode",
                    "rgb_color": [1, 2], "hs_color": [10.123456, float("nan")], "effect": "x" * 500},
        "light.b": {"state": "on", "brightness": True},
        "fan.c": {"state": "on", "percentage": -40, "oscillating": "yes", "direction": "sideways"},
    })])
    e = out[0]["entities"]
    assert e["light.a"]["brightness"] == 255 and e["light.a"]["color_temp_kelvin"] == 1000
    assert "color_mode" not in e["light.a"] and "rgb_color" not in e["light.a"] and "hs_color" not in e["light.a"]
    assert len(e["light.a"]["effect"]) == 100
    assert e["light.b"] == {"state": "on"}, "a bool is not a brightness"
    assert e["fan.c"] == {"state": "on", "percentage": 0}


def test_whole_house_presets_drop_malformed_presets_without_rejecting_the_rest():
    out = _sanitize_whole_house_presets([
        "not-a-dict", {"name": "", "entities": {"light.a": {"state": "on"}}},
        {"name": "No entities"}, {"name": "Only a lock", "entities": {"lock.x": {"state": "locked"}}},
        _whp("Good One"),
    ])
    assert [p["name"] for p in out] == ["Good One"]


def test_whole_house_presets_keep_the_newest_and_cap_name_and_entity_count():
    presets = [_whp(f"Old {i}") for i in range(20)] + [_whp("N" * 100)]
    out = _sanitize_whole_house_presets(presets)
    assert len(out) == 20 and out[-1]["name"] == "N" * 60
    assert "Old 0" not in [p["name"] for p in out]
    big = _sanitize_whole_house_presets([_whp(entities={f"light.l{i}": {"state": "on"} for i in range(400)})])
    assert len(big[0]["entities"]) == 300


def test_whole_house_presets_return_empty_list_for_non_list_input():
    assert _sanitize_whole_house_presets(None) == []
    assert _sanitize_whole_house_presets({"name": "x"}) == []
