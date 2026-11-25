"""Three features moved down the ladder by one switch (licence.FREE_BASICS).

Exact placement of lights and devices (from bright), the plain wall mode and
the 3D house's basics (both from pro) move to the free rung together. The
switch is a constant, off: with it off, every gate and every screen is what it
was, which the first block here holds. The rest runs with it on (the
`free_basics` fixture flips it for one test) and holds what moves and what
does not: a free placement keeps a device's stored looks (shape, size,
rotation, colour stay the lighting tier's), Live Aboard comes on once for a
house that never had it to choose, and the one-tap "place this room's
devices" spreads lights inside a room and wall-mounted devices round it.

The frontend half runs the real modules under node; skipped without node.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.websocket import (
    ws_fabric_light_height_set,
    ws_fabric_light_position_set,
    ws_fabric_light_remove,
)
from tests.test_conversion import _load
from tests.test_fabric_lights import _fab, _hass, _mdl
from tests.test_lights_free_gate import _stage

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture
def free_basics(monkeypatch):
    monkeypatch.setattr(licence, "FREE_BASICS", True)


def _settings_hass(**settings) -> MagicMock:
    st = MagicMock()
    st.data = {"forensics_license_key": "", "forensics_license_expires": "", **settings}
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: st}}
    return h


async def _place(mdl, *, pro: bool, **msg):
    conn = MagicMock()
    await ws_fabric_light_position_set(_hass(mdl, pro=pro), conn, {"id": 1, "floor_id": "main", **msg})
    return conn


# ═══ Off: nothing changed ══════════════════════════════════════════════════════

def test_the_switch_ships_off_and_every_rung_is_where_it_was() -> None:
    assert licence.FREE_BASICS is False
    assert licence.placement_tier() == "bright"
    assert licence.house3d_tier() == "pro"
    assert licence.TIERS == ("free", "bright", "pro")


def test_off_the_settings_payload_does_not_name_the_switch() -> None:
    assert "free_basics" not in ws._get_settings(_settings_hass())


async def test_off_a_free_install_still_cannot_place_or_unplace() -> None:
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    conn = await _place(mdl, pro=False, entity_id="light.kitchen", x_m=1.0, y_m=2.0)
    assert conn.send_error.call_args[0][1] == "pro_required"
    assert mdl.light_positions_m() == {}
    for handler, msg in ((ws_fabric_light_remove, {"entity_id": "light.kitchen"}),
                         (ws_fabric_light_height_set, {"entity_id": "light.kitchen", "z_m": 2.0})):
        c = MagicMock()
        await handler(_hass(mdl, pro=False), c, {"id": 2, **msg})
        assert c.send_error.call_args[0][1] == "pro_required"


async def test_off_live_aboard_stays_as_stored_and_no_marker_is_written() -> None:
    _, data, saved = await _load({"atlas_3d_enabled": False, "atlas_default_v1_applied": True})
    assert data["atlas_3d_enabled"] is False
    assert "atlas_3d_default_v1_applied" not in data and "atlas_3d_default_v1_applied" not in saved


# ═══ On: what moves ════════════════════════════════════════════════════════════

def test_on_placement_and_the_3d_house_move_to_free(free_basics) -> None:
    assert licence.placement_tier() == "free"
    assert licence.house3d_tier() == "free"
    assert licence.tier_at_least("free", licence.placement_tier())
    # One ladder: nothing else about it changes.
    assert licence.TIERS == ("free", "bright", "pro")


def test_on_the_settings_payload_says_so(free_basics) -> None:
    assert ws._get_settings(_settings_hass())["free_basics"] is True


async def test_on_a_free_install_places_and_keeps_the_stored_looks(free_basics) -> None:
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    # A record from a lapsed key: shaped, sized and turned.
    await _place(mdl, pro=True, entity_id="light.strip", x_m=1.0, y_m=1.0, color="#ff0000",
                 shape="bar", width_cm=240, height_cm=5, rotation=30, label="Valance")
    before = dict(mdl.light_positions_m()["light.strip"])
    conn = await _place(mdl, pro=False, entity_id="light.strip", x_m=3.0, y_m=2.5,
                        shape="circle", rotation=90, width_cm=10, color="#00ff00", label="Other")
    conn.send_error.assert_not_called()
    after = mdl.light_positions_m()["light.strip"]
    assert (after["x_m"], after["y_m"]) == (3.0, 2.5)
    for k in ("color", "shape", "width_cm", "height_cm", "rotation", "label"):
        assert after.get(k) == before.get(k), k
    # A device never placed gets a place and the default looks, whatever was sent.
    await _place(mdl, pro=False, entity_id="binary_sensor.hall_motion", x_m=0.5, y_m=0.5, shape="bar", width_cm=90)
    await _place(mdl, pro=True, entity_id="binary_sensor.plain", x_m=0.5, y_m=0.5)
    assert mdl.light_positions_m()["binary_sensor.hall_motion"] == mdl.light_positions_m()["binary_sensor.plain"]


async def test_on_a_free_install_can_unplace_and_set_a_height(free_basics) -> None:
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    await _place(mdl, pro=False, entity_id="light.kitchen", x_m=1.0, y_m=2.0)
    c = MagicMock()
    await ws_fabric_light_height_set(_hass(mdl, pro=False), c, {"id": 2, "entity_id": "light.kitchen", "z_m": 2.4})
    c.send_error.assert_not_called()
    c = MagicMock()
    await ws_fabric_light_remove(_hass(mdl, pro=False), c, {"id": 3, "entity_id": "light.kitchen"})
    c.send_error.assert_not_called()
    assert mdl.light_positions_m() == {}


async def test_on_a_paid_install_still_sets_the_looks(free_basics) -> None:
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    await _place(mdl, pro=True, entity_id="light.kitchen", x_m=1.0, y_m=2.0, shape="bar", width_cm=90)
    entry = mdl.light_positions_m()["light.kitchen"]
    assert entry["shape"] == "bar" and entry["width_cm"] == 90.0


async def test_on_live_aboard_comes_on_once_where_it_was_never_a_choice(free_basics) -> None:
    # A new install: on.
    _, data, _ = await _load(None)
    assert data["atlas_3d_enabled"] is True and data["atlas_3d_default_v1_applied"] is True
    # An existing install with no key never had the 3D house: on, and saved.
    _, data, saved = await _load({"atlas_3d_enabled": False, "atlas_default_v1_applied": True})
    assert data["atlas_3d_enabled"] is True
    assert saved["atlas_3d_enabled"] is True and saved["atlas_3d_default_v1_applied"] is True
    # One with a key could have chosen off: it keeps it.
    _, data, _ = await _load({"atlas_3d_enabled": False, "forensics_license_key": "PSPAN-TEST",
                              "atlas_default_v1_applied": True})
    assert data["atlas_3d_enabled"] is False and data["atlas_3d_default_v1_applied"] is True
    # Once: an off chosen after it stays off.
    _, data, _ = await _load({"atlas_3d_enabled": False, "atlas_3d_default_v1_applied": True,
                              "atlas_default_v1_applied": True})
    assert data["atlas_3d_enabled"] is False


async def test_on_the_3d_editor_and_its_extras_stay_pro(free_basics) -> None:
    """Furnish, the AI features and the people figures are not part of this:
    their server gates still ask for pro, whatever the switch says."""
    for name in ("ws_house3d.py", "ws_house3d_library.py", "ws_house3d_photo.py", "ws_house3d_import.py",
                 "ws_house3d_stairs.py", "ws_plan_ai.py"):
        src = (_ROOT / "custom_components" / "padspan_ha" / name).read_text(encoding="utf-8")
        assert '_tier_at_least(hass, "pro")' in src, name
        assert "house3d_tier" not in src, name


# ═══ The frontend's mirror ═════════════════════════════════════════════════════

def test_every_moved_gate_asks_its_rung_from_editions() -> None:
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert "tierAtLeast(host.tier, placementTier(host.freeBasics))" in lm
    assert "tierAtLeast(host.tier, house3dTier(host.house3d.settings))" in lm
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "wallTier(!!this.state?._freeBasics)" in lp
    # The wall's extras stay Pro's: below Pro they are stripped, whatever is stored or linked.
    assert re.search(r'=== "pro" \? p : \{ \.\.\.p, dim: 0, shift: false, cycle: 0, fully: false \}', lp)
    assert lp.count("this._wallParams()") == 4 and "WALLS.wallParams(location.search" in lp
    wc = (_VIEWS / "wall_card.js").read_text(encoding="utf-8")
    assert "pro || tierAtLeast(s.tier, wallTier(s))" in wc
    st = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    assert "tierAtLeast(currentTier(settings), house3dTier(settings))" in st
    assert 'toLowerCase() === "bright" && !tierAtLeast(currentTier(settings), wallTier(settings))' in st
    mp = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "_tierAtLeast(ctx.state.settings?.tier, _placementTier(ctx.state.settings))" in mp
    # The 3D editor's Save stays Pro's (house3d_edit is).
    assert 'edit: paid && !preview && _tierAtLeast(tier, "pro")' in mp


_HARNESS = r"""
const E = await import('./editions.mjs');
const LM = await import('./lights_map.mjs');
const out = {};
out.rungs = {};
for (const [name, s] of [["absent", {}], ["false", { free_basics: false }], ["on", { free_basics: true }],
                         ["host_true", true], ["host_false", false], ["none", undefined]]) {
  out.rungs[name] = [E.placementTier(s), E.wallTier(s), E.house3dTier(s)];
}
const MODEL = { light_positions_m: {
  "light.strip": { x_m: 4, y_m: 1, floor_id: "main", width_cm: 240, height_cm: 5, rotation: 30, color: "#f00", shape: "bar", label: "V", z_m: 2.4 },
  "light.plain": { x_m: 0.5, y_m: 0.5, floor_id: "main", source: "auto" } } };
const frozen = JSON.stringify(MODEL);
const onPlaceRow = () => {}, queue = new Set(["light.loft"]);
const host = (tier, freeBasics) => ({ tier, freeBasics, model: MODEL, onPlaceRow, placeQueue: queue, collapseUnplaced: true });
const view = (h) => ({ positions: h.model.light_positions_m,
  placeRow: h.onPlaceRow === onPlaceRow, queue: h.placeQueue === queue, collapse: h.collapseUnplaced });
const freeOff = LM.lightsHostForTier(host("free", undefined)), freeOn = LM.lightsHostForTier(host("free", true));
const brightOn = host("bright", true), proOff = host("pro", false);
out.freeOff = view(freeOff); out.freeOn = view(freeOn);
out.paidUntouched = LM.lightsHostForTier(brightOn) === brightOn && LM.lightsHostForTier(proOff) === proOff;
out.modelUntouched = JSON.stringify(MODEL) === frozen;
// A 6 x 4 m room; three lights, a fan, a motion sensor, a temperature sensor, a lock and a door.
const ROOM = [[0, 0], [6, 0], [6, 4], [0, 4]];
const devs = [{ entity_id: "light.a" }, { entity_id: "light.b" }, { entity_id: "light.c" }, { entity_id: "fan.f", isFan: true },
  { entity_id: "binary_sensor.m", isMotion: true }, { entity_id: "sensor.t", isTemp: true }, { entity_id: "lock.l", isLock: true },
  { entity_id: "binary_sensor.door", isDoor: true }];
out.placed = LM.placeRoomDevices(ROOM, devs);
out.walls = LM.alongWalls(ROOM, 4, 0.3);
out.none = LM.placeRoomDevices(null, devs);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def js(tmp_path_factory) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    tmp = tmp_path_factory.mktemp("free_basics")
    _stage(tmp)
    (tmp / "run.mjs").write_text("import { install } from './dom_shim.mjs';\ninstall(globalThis);\n" + _HARNESS, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp / "run.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_js_off_the_rungs_are_where_they_were(js) -> None:
    for name in ("absent", "false", "host_false", "none"):
        assert js["rungs"][name] == ["bright", "pro", "pro"], name


def test_js_on_every_rung_is_free(js) -> None:
    assert js["rungs"]["on"] == ["free", "free", "free"]
    assert js["rungs"]["host_true"] == ["free", "free", "free"]


def test_js_off_a_free_map_withholds_placement_exactly_as_before(js) -> None:
    v = js["freeOff"]
    assert v["positions"] == {} and not v["placeRow"] and not v["queue"] and v["collapse"] is False


def test_js_on_a_free_map_shows_places_without_looks(js) -> None:
    v = js["freeOn"]
    assert v["placeRow"] and v["queue"] and v["collapse"] is True
    assert v["positions"] == {
        "light.strip": {"x_m": 4, "y_m": 1, "floor_id": "main", "z_m": 2.4},
        "light.plain": {"x_m": 0.5, "y_m": 0.5, "floor_id": "main", "source": "auto"},
    }
    assert js["paidUntouched"] and js["modelUntouched"]


def _inside(p, x0=0.0, y0=0.0, x1=6.0, y1=4.0) -> bool:
    return x0 < p[0] < x1 and y0 < p[1] < y1


def test_js_one_tap_spreads_a_rooms_devices_sensibly(js) -> None:
    placed = js["placed"]
    assert "binary_sensor.door" not in placed, "a door is linked to a wall, never a point"
    assert set(placed) == {"light.a", "light.b", "light.c", "fan.f", "binary_sensor.m", "sensor.t", "lock.l"}
    assert all(_inside(p) for p in placed.values())
    pts = [tuple(p) for p in placed.values()]
    assert len(set(pts)) == len(pts), "two devices on one spot is the pile this replaces"
    # Lights and the fan inside the room, away from the walls; the rest just inside the walls.
    wall_d = lambda p: min(p[0], 6 - p[0], p[1], 4 - p[1])  # noqa: E731
    for eid in ("light.a", "light.b", "light.c", "fan.f"):
        assert wall_d(placed[eid]) >= 0.5, eid
    for eid in ("binary_sensor.m", "sensor.t", "lock.l"):
        assert wall_d(placed[eid]) <= 0.31, eid
    assert all(wall_d(p) == pytest.approx(0.3, abs=0.01) for p in js["walls"])
    assert js["none"] == {}


def test_the_room_sheet_offers_it_only_where_the_host_hands_it() -> None:
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert 'typeof api.placeRoom === "function" && typeof api.unplacedIn === "function" ? api.unplacedIn(room) : 0' in lm
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    # Only while the switch is on, at the placement rung, never on a wall, and as enhanced security allows.
    assert re.search(r"return fb && tierAtLeast\(this\.state\._tier, placementTier\(fb\)\) && !this\._kiosk\(\)\s*"
                     r"&& \(this\._isAdmin\(\) \|\| this\.state\._enhancedSecurity === false\);", lp)
    assert "if(this._mayPlaceRoom()){" in lp
