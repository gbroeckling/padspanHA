# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas routes a WLED light PadSpan runs (the exact look, wled_exact.py)
through padspan_ha/wled_power — never through HA's light services — and
every other light exactly as before. tests/js/lights_exact_routing.mjs drives
the tap, drag-dim, light card, room sheet, Whole House Preset and map scene
against a fake hass that records what each one sent.

Skipped (not failed) when node is unavailable.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "lights_exact_routing.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def out() -> dict:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS)], capture_output=True, text=True,
                         encoding="utf-8", timeout=180)
    assert res.returncode == 0, res.stderr[-3000:]
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_list_is_fetched_once_and_only_a_change_redraws(out) -> None:
    assert out["list"] == {"fetches": 2, "renders": 1, "exact": [True, True, False]}


def test_markers_show_the_device_not_a_segment_flag(out) -> None:
    """Far West's strip is dark while HA's segment lights read "on": every
    light of the device is drawn off, as the device is."""
    m = out["markers"]
    assert m["light.far_west_seg0"] == "off" and m["light.far_west_seg1"] == "off"
    assert m["light.kitchen"] == "on"


def test_an_exact_device_never_records_a_per_browser_brightness(out) -> None:
    assert out["remembered"] == {"farWest": 20, "kitchen": 91}


def test_a_tap_sends_the_look_through_the_one_path(out) -> None:
    t = out["tap"]
    # The segment read "on" but the device was off: the tap turns it ON, with
    # no remembered brightness (the look's own); a team member once, not per member.
    assert t["power"] == [{"entity_id": "light.far_west_seg1", "on": True, "source": "atlas"},
                          {"entity_id": "light.upper_north", "on": True, "source": "atlas"}]
    assert t["teamMateDrawn"] == "on"
    # A plain light: HA's own call with its remembered level, as before.
    assert t["svc"] == [["light", "turn_on", {"entity_id": "light.hall", "brightness": 70}]]


def test_only_a_failure_is_said(out) -> None:
    assert out["failToast"] == [["Far West: part 2: colour didn't take after 3 tries · "
                                 "Upper South is offline — it gets its look when it reconnects", True]]


def test_the_drag_dim_goes_through_the_one_path_from_the_looks_brightness(out) -> None:
    d = out["drag"]
    # Off, so it starts from the look's 128 (not the remembered 20): +40 px = 192.
    want = {"entity_id": "light.far_west_seg1", "on": True, "source": "atlas", "brightness": 192}
    assert d["power"] == [want, want] and d["svc"] == []
    assert d["plainWs"] == 0
    assert d["plainSvc"] == [["light", "turn_on", {"entity_id": "light.kitchen", "brightness": 154}]] * 2


def test_the_light_card_switches_and_dims_through_the_one_path(out) -> None:
    c = out["card"]
    assert c["label"] == "Turn On" and c["startsAt"] == "128"
    assert c["power"] == [{"entity_id": "light.far_west_seg1", "on": True, "source": "atlas"},
                          {"entity_id": "light.far_west_seg1", "on": True, "source": "atlas", "brightness": 100}]
    assert c["svc"] == []


def test_a_room_sends_one_command_per_device_or_team(out) -> None:
    r = out["room"]
    assert r["power"] == [{"entity_id": "light.far_west", "on": False, "source": "room"},
                          {"entity_id": "light.upper_north", "on": False, "source": "room"}]
    assert r["svc"] == [["light", "turn_off", {"entity_id": ["light.kitchen", "light.hall"]}]]


def test_a_preset_turns_an_exact_device_on_from_its_main_light(out) -> None:
    p = out["preset"]
    # Far West from its main light at the preset's brightness (the segment's
    # colour is never sent); the team once, from its only-segment light.
    assert p["power"] == [{"entity_id": "light.far_west", "on": True, "source": "preset", "brightness": 90},
                          {"entity_id": "light.upper_north", "on": True, "source": "preset", "brightness": 200}]
    assert p["svc"] == [["scene", "apply", {"entities": {"light.kitchen": {"state": "on", "brightness": 40},
                                                         "light.hall": {"state": "off"}}}]]
    assert p["result"] == {"applied": 6, "skipped": 0}


def test_a_map_scene_leaves_exact_lights_their_look(out) -> None:
    s = out["scene"]
    assert s["svc"] == [["light", "turn_on", {"entity_id": "light.kitchen", "rgb_color": [4, 5, 6], "transition": 1}]]
    assert s["toasts"] == ["Scene sent to 1 lights · 2 exact-look lights kept their look"]


def test_without_the_licence_every_path_is_has_own_again(out) -> None:
    u = out["unlicensed"]
    assert u["power"] == [] and u["exact"] is False
    assert u["svc"] == [["light", "turn_off", {"entity_id": "light.far_west_seg1"}],
                        ["light", "turn_on", {"entity_id": ["light.far_west", "light.kitchen"]}]]
