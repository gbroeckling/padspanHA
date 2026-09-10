# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Door/window linking, triggered directly from the Lights map — the circle
tool, built from scratch after the first attempt.

Garry, 2026-09-09, after the wall-then-two-points picker: "you did a
rediculusly poor job designing the door/windows mapping... Let's start from
scratch. So, when in the device, open/close sensor, allow the placement of a
circle, that circle will start at 1 meter in real world size. The tool will
allow you to increase the size of the circle, and then also move the circle.
When clicking done, the two places the line intersects with the room line,
those will be the edges of the opening." And separately: "BTW, you tool as
you just described was never visable" — the earlier tool's "live
verification" never proved a real human could actually find and use it.

lights_map.js now offers a "Place" button on an unlinked door/window row;
clicking it arms mapState._doorCircleEid. The first click on the Lights map
(_doorCircleFloorForClick) drops a 1m-radius circle there; from then on,
dragging its body/rim (maps.js's _wireDoorCircle, not exercised here — it
needs a real SVGPoint/getScreenCTM the node shim doesn't implement) moves
and resizes it, and the row's Done button (_commitDoorCircle) cuts whichever
wall bestCircleWall (stack_transform.js) says the circle matches — the SAME
function iso_lights.js's live preview uses, so the two can never disagree.

_doorCircleFloorForClick, _cancelDoorCircle and _commitDoorCircle are pure
enough (no DOM) to call directly once maps.js is loaded under node with the
dom shim installed, the same way render_smoke.mjs already loads it.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

# A two-storey building: a main-floor wall (w1, unlinked), an upper-floor
# wall (w2, unlinked) directly "above" it in plan (same x/y span) so a wrong
# floor resolution would still find A wall — just the wrong one — and a
# second main-floor wall (w3) already linked, which must never be offered.
_MODEL = {
    "floors": [{"id": "main", "name": "Main", "level": 0}, {"id": "upper", "name": "Upper", "level": 1}],
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [10, 0], [10, 8], [0, 8]]},
        "Bed": {"type": "poly", "floor_id": "upper", "points_m": [[0, 0], [10, 0], [10, 8], [0, 8]]},
    },
    "rf_barriers_m": [
        {"id": "w1", "name": "Kitchen wall", "floor_id": "main", "material": "concrete",
         "attenuation_dbm": 8, "points_m": [[2, 0], [8, 0]]},
        {"id": "w2", "name": "Bed wall", "floor_id": "upper", "material": "metal",
         "attenuation_dbm": 12, "points_m": [[2, 0], [8, 0]]},
        {"id": "w3", "name": "Already a door", "floor_id": "main", "material": "custom",
         "attenuation_dbm": 6, "points_m": [[0, 4], [0, 6]], "linked_entity_id": "binary_sensor.existing_door"},
    ],
    "floor_elevations": {"main": 0, "upper": 3},
}


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const M = await import(pathToFileURL({json.dumps(str(_VIEWS / 'maps.js'))}).href);\n"
        f"const IL = await import(pathToFileURL({json.dumps(str(_VIEWS / 'iso_lights.js'))}).href);\n"
        f"const ST = await import(pathToFileURL({json.dumps(str(_VIEWS / 'stack_transform.js'))}).href);\n"
        f"const MODEL = {json.dumps(_MODEL)};\n"
        "const calls = [];\n"
        "const toasts = [];\n"
        "function makeCtx(model) {\n"
        "  return { state: { model }, hass: {},\n"
        "    actions: {\n"
        "      callWS: async (msg) => { calls.push(msg); return { barrier: { id: 'new_' + calls.length } }; },\n"
        "      modelRefresh: async () => {},\n"
        "      renderRooms: () => {},\n"
        "    },\n"
        "    toast: (m, isErr) => toasts.push({ m, isErr: !!isErr }) };\n"
        "}\n"
        "const frame = IL.fabricFrame(MODEL, MODEL.floors, 150, 0);\n"
        "const out = {};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_floor_for_click_finds_the_walls_own_floor_not_the_one_above():
    """A click near w1's midpoint, projected through MAIN's own z, must
    resolve to main — even though w2 sits at the identical x/y one floor up
    — and land at that same point in world metres."""
    out = _run("""
const ctx = makeCtx(MODEL);
const o = { model: MODEL };
const zMain = frame.levelOf('main');
const [vx, vy] = frame.iso(5, 0, zMain);   // w1's midpoint, projected
const picked = M._doorCircleFloorForClick(ctx, o, frame, { x: vx, y: vy });
out.fid = picked.fid; out.cx = picked.cx; out.cy = picked.cy;
""")
    assert out["fid"] == "main", out
    assert abs(out["cx"] - 5) < 0.05 and abs(out["cy"] - 0) < 0.05, out


def test_floor_for_click_falls_back_to_the_lowest_storey_with_no_walls_yet():
    """A bare click with nothing to compare against yet still has to land
    somewhere — the lowest drawn storey, at the raw click position."""
    out = _run("""
const model = { floors: [{ id: 'main', name: 'Main', level: 0 }],
  room_geometry_m: { Kitchen: { type: 'poly', floor_id: 'main', points_m: [[0,0],[10,0],[10,8],[0,8]] } } };
const ctx = makeCtx(model);
const o = { model };
const f2 = IL.fabricFrame(model, model.floors, 150, 0);
const z0 = f2.levels[0];
const [vx, vy] = f2.iso(3, 4, z0);
const picked = M._doorCircleFloorForClick(ctx, o, f2, { x: vx, y: vy });
out.fid = picked.fid; out.cx = picked.cx; out.cy = picked.cy;
""")
    assert out["fid"] == "main", out
    assert abs(out["cx"] - 3) < 0.05 and abs(out["cy"] - 4) < 0.05, out


def test_commit_splits_the_wall_and_links_the_middle_section_to_the_sensor():
    """A circle centred at (4.5,0) r=2 crosses w1 (spanning x=2..8) at
    x=2.5 and x=6.5 — must split into a before piece, a linked middle (the
    door), and an after piece, three fabric_rf_barrier_set calls."""
    out = _run("""
const ctx = makeCtx(MODEL);
const mapState = { _doorCircleEid: 'binary_sensor.kitchen_door',
  _doorCircleM: { x_m: 4.5, y_m: 0, r_m: 2, floorId: 'main' } };
await M._commitDoorCircle(ctx, mapState);
out.calls = calls;
out.armedAfter = mapState._doorCircleEid;
out.circleAfter = mapState._doorCircleM;
out.toasts = toasts;
""")
    assert out["armedAfter"] is None, "must disarm after commit"
    assert out["circleAfter"] is None, "must clear the circle after commit"
    calls = out["calls"]
    assert len(calls) == 3, calls
    linked = [c for c in calls if c["barrier"].get("linked_entity_id") == "binary_sensor.kitchen_door"]
    assert len(linked) == 1, calls
    mid = linked[0]["barrier"]
    assert mid["floor_id"] == "main", mid
    assert mid["material"] == "concrete", "must default to the parent wall's own material"
    assert mid["attenuation_dbm"] == 8, mid
    xs = [p[0] for p in mid["points_m"]]
    assert abs(min(xs) - 2.5) < 0.01 and abs(max(xs) - 6.5) < 0.01, mid
    unlinked = [c for c in calls if c["barrier"].get("linked_entity_id") is None]
    assert len(unlinked) == 2, "the two remaining wall pieces must stay unlinked"
    assert not any(t["isErr"] for t in out["toasts"]), out["toasts"]


def test_commit_never_matches_an_already_linked_wall():
    """A circle sitting right on w3 (already a door) must find nothing to
    cut — bestCircleWall excludes any barrier that already has a
    linked_entity_id — rather than silently re-splitting an existing door."""
    out = _run("""
const ctx = makeCtx(MODEL);
const mapState = { _doorCircleEid: 'binary_sensor.new_door',
  _doorCircleM: { x_m: 0, y_m: 5, r_m: 2, floorId: 'main' } };
await M._commitDoorCircle(ctx, mapState);
out.calls = calls;
out.toasts = toasts;
out.stateAfter = mapState;
""")
    assert out["calls"] == [], out["calls"]
    assert any(t["isErr"] for t in out["toasts"]), out["toasts"]
    assert out["stateAfter"]["_doorCircleEid"] == "binary_sensor.new_door", (
        "a failed commit must leave the circle in place so it can be adjusted, not vanish"
    )


def test_commit_failure_names_the_nearest_wall_and_the_actual_gap():
    """Reported a second time — "it is not [in the wrong place]" — so a
    generic "move or resize" hint alone was not enough to tell whether this
    really is the room-outline confusion or something the circle's own
    numbers would show at a glance. w1 spans y=0 from x=2..8; a circle at
    (5, 1.5) r=1 falls exactly 0.5m short of reaching it."""
    out = _run("""
const ctx = makeCtx(MODEL);
const mapState = { _doorCircleEid: 'binary_sensor.kitchen_door',
  _doorCircleM: { x_m: 5, y_m: 1.5, r_m: 1, floorId: 'main' } };
await M._commitDoorCircle(ctx, mapState);
out.calls = calls;
out.toasts = toasts;
""")
    assert out["calls"] == [], out["calls"]
    msgs = [t["m"] for t in out["toasts"] if t["isErr"]]
    assert msgs, out["toasts"]
    msg = msgs[0]
    assert "Kitchen wall" in msg, msg
    assert "0.50m" in msg, msg
    assert 'floor "main"' in msg, msg
    assert "r=1.00m" in msg, msg
    assert "(5.00, 1.50)" in msg, msg


def test_commit_with_no_matching_wall_names_the_room_outline_confusion():
    """Garry, 2026-09-09: "the done right now just says move or resize so
    it crosses the line, but it already is" — a circle drawn over a ROOM's
    own outline, where main HAS unlinked walls elsewhere but none under the
    circle, must say so isn't a wall the tool knows about, not just repeat
    the generic hint as if repositioning would fix it."""
    out = _run("""
const ctx = makeCtx(MODEL);
const mapState = { _doorCircleEid: 'binary_sensor.kitchen_door',
  _doorCircleM: { x_m: 50, y_m: 50, r_m: 1, floorId: 'main' } };
await M._commitDoorCircle(ctx, mapState);
out.calls = calls;
out.toasts = toasts;
""")
    assert out["calls"] == [], out["calls"]
    assert any(t["isErr"] for t in out["toasts"]), out["toasts"]
    assert any("room's own outline doesn't count" in t["m"] for t in out["toasts"]), out["toasts"]


def test_commit_with_no_walls_drawn_on_the_floor_at_all_says_so():
    """A floor with ZERO rf_barriers_m entries can never match anything no
    matter how the circle is dragged — that is a different, more useful
    thing to tell someone than "move or resize the circle"."""
    out = _run("""
const model = { ...MODEL, rf_barriers_m: [] };
const ctx = makeCtx(model);
const mapState = { _doorCircleEid: 'binary_sensor.kitchen_door',
  _doorCircleM: { x_m: 5, y_m: 0, r_m: 1, floorId: 'main' } };
await M._commitDoorCircle(ctx, mapState);
out.calls = calls;
out.toasts = toasts;
""")
    assert out["calls"] == [], out["calls"]
    assert any("No wall is drawn on this floor yet" in t["m"] for t in out["toasts"]), out["toasts"]


def test_cancel_clears_both_fields():
    out = _run("""
const mapState = { _doorCircleEid: 'binary_sensor.x',
  _doorCircleM: { x_m: 1, y_m: 1, r_m: 1, floorId: 'main' } };
M._cancelDoorCircle(mapState);
out.state = mapState;
""")
    assert out["state"] == {"_doorCircleEid": None, "_doorCircleM": None}, out["state"]


def test_lights_row_offers_place_not_a_jump_to_rooms():
    """The confusion this whole feature exists to fix: the row must no
    longer send anyone away to Rooms, and none of the old wall-then-
    two-points fields (never visible, per Garry) must linger unused."""
    src = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert '"Place"' in src, "the row's button text must say the tool is here, on this map"
    assert "setMapsTab" not in src, "lights_map.js must not itself navigate tabs for a door row"
    for old in ("doorLinkArmedEid", "doorLinkBarrierId", "doorLinkPts", "DOOR_LINK"):
        assert old not in src, f"the old wall-picker field {old!r} must be gone, not just unused"


def test_maps_js_click_handler_dispatches_to_the_circle_placer_before_placement():
    """Source-level pin, since toVB needs a real SVGPoint the node shim does
    not provide: the door-circle branch must run, and return, before the
    ordinary placement-queue branch even looks at the click."""
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    dl = src.index("if (!mapState._doorCircleEid || mapState._doorCircleM) return;")
    pq = src.index('const q = o.mapState._placeQueue || [];')
    assert dl < pq, "the door-circle branch must be wired before the placement-queue branch"


def test_wire_lights_build_wires_the_circle_drag_handlers():
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "_wireDoorCircle(ctx, isoDiv, svg, o, toVB, frame, mapState);" in src, (
        "the circle's move/resize drag handlers must be wired on every rebuild, "
        "the same way _wireLightsPicker is"
    )
