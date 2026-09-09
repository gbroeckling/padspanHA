# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Door/window linking, triggered directly from the Lights map.

Garry, 2026-09-09, after finding nothing at Mapping -> Rooms: "What imaginary
setup do you think I see for setting up a door or windows in the
software???? ... needs to be under lights to build." Then, sharpening it:
"In lights it's triggered by a sensor for open/close being placed."

maps.js now offers a "Link on map" button on an unlinked door/window row
(lights_map.js); clicking it arms mapState._doorLinkEid, and three clicks on
the Lights map itself — the wall, then its two ends — commit the link via
_doorLinkPickWall / _commitDoorLink. These reuse the exact fabric mechanics
Rooms -> RF Barriers already used (nearestPointOnPolyline /
splitPolylineAtTwoPositions, the same fabric_rf_barrier_set/remove calls) —
only the click surface is new: the Lights map is already in world metres
(frame.isoInv), so there is no photo-fraction round-trip at all, unlike the
Rooms-tab picker.

_doorLinkPickWall and _commitDoorLink are pure enough (no DOM) to call
directly once maps.js is loaded under node with the dom shim installed —
the same way render_smoke.mjs already loads it. toVB's raw pointer-event ->
viewBox conversion is the only piece these tests don't reach (it needs a
real SVGPoint/getScreenCTM, which the shim doesn't implement); it is ~10
lines of coordinate extraction ahead of the functions tested here.

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


def test_picks_the_wall_actually_under_the_click_not_a_wrong_floor():
    """A click near w1's midpoint, projected through MAIN's own z, must
    resolve to w1 — even though w2 sits at the identical x/y one floor up."""
    out = _run("""
const ctx = makeCtx(MODEL);
const o = { model: MODEL };
const zMain = frame.levelOf('main');
const [vx, vy] = frame.iso(5, 0, zMain);   // w1's midpoint, projected
const picked = M._doorLinkPickWall(ctx, o, frame, { x: vx, y: vy });
out.barId = picked && picked.bar.id;
out.floorId = picked && picked.fid;
""")
    assert out["barId"] == "w1", out
    assert out["floorId"] == "main", out


def test_an_already_linked_wall_is_never_offered():
    """Clicking exactly on w3 (already a door) must never return w3 — the
    row's own 'already linked' state must not be clobberable by picking it
    again. It may fall through to whatever OTHER wall is globally nearest
    (same threshold-free contract as the "far from any wall" case, enforced
    by the caller) — the one outcome that must be impossible is w3 itself."""
    out = _run("""
const ctx = makeCtx(MODEL);
const o = { model: MODEL };
const zMain = frame.levelOf('main');
const [vx, vy] = frame.iso(0, 5, zMain);   // w3's own midpoint, right on it
const picked = M._doorLinkPickWall(ctx, o, frame, { x: vx, y: vy });
out.barId = picked && picked.bar.id;
out.distSqIfAny = picked ? picked.hit.distSq : null;
""")
    assert out["barId"] != "w3", out
    assert out["distSqIfAny"] is None or out["distSqIfAny"] > 0.36, (
        "fell through to a real, in-range wall other than w3 -- that would let a click "
        "meant for the already-linked wall silently re-link a different one instead"
    )


def test_a_click_far_from_any_wall_finds_nothing_useful():
    out = _run("""
const ctx = makeCtx(MODEL);
const o = { model: MODEL };
const zMain = frame.levelOf('main');
const [vx, vy] = frame.iso(50, 50, zMain);  // nowhere near w1
const picked = M._doorLinkPickWall(ctx, o, frame, { x: vx, y: vy });
out.distSqIfAny = picked ? picked.hit.distSq : null;
""")
    # It may technically return the globally-nearest wall — the caller is the
    # one that enforces the snap radius (_DOOR_LINK_SNAP_M2, 0.36 m^2) before
    # accepting a pick. Confirm this candidate would be correctly rejected.
    assert out["distSqIfAny"] is None or out["distSqIfAny"] > 0.36, out


def test_commit_splits_the_wall_and_links_the_middle_section_to_the_sensor():
    """Two points inside w1's span (2..8 on x) must split it into a before
    piece, a linked middle (the door), and an after piece — three
    fabric_rf_barrier_set calls, the middle one carrying linked_entity_id."""
    out = _run("""
const ctx = makeCtx(MODEL);
const mapState = { _doorLinkEid: 'binary_sensor.kitchen_door', _doorLinkBarrierId: 'w1',
  _doorLinkFloorId: 'main', _doorLinkPts: [] };
const points = [[2, 0], [8, 0]];
mapState._doorLinkPts.push(ST.nearestPointOnPolyline(points, 3, 0));
mapState._doorLinkPts.push(ST.nearestPointOnPolyline(points, 6, 0));
await M._commitDoorLink(ctx, mapState);
out.calls = calls;
out.armedAfter = mapState._doorLinkEid;
out.toasts = toasts;
""")
    assert out["armedAfter"] is None, "must disarm after commit"
    calls = out["calls"]
    assert len(calls) == 3, calls
    linked = [c for c in calls if c["barrier"].get("linked_entity_id") == "binary_sensor.kitchen_door"]
    assert len(linked) == 1, calls
    mid = linked[0]["barrier"]
    assert mid["floor_id"] == "main", mid
    assert mid["material"] == "concrete", "must default to the parent wall's own material"
    assert mid["attenuation_dbm"] == 8, mid
    xs = [p[0] for p in mid["points_m"]]
    assert min(xs) >= 2.9 and max(xs) <= 6.1, mid  # inside the two clicked points
    unlinked = [c for c in calls if c["barrier"].get("linked_entity_id") is None]
    assert len(unlinked) == 2, "the two remaining wall pieces must stay unlinked"
    assert not any(t["isErr"] for t in out["toasts"]), out["toasts"]


def test_cancel_clears_every_field():
    out = _run("""
const mapState = { _doorLinkEid: 'binary_sensor.x', _doorLinkBarrierId: 'w1',
  _doorLinkFloorId: 'main', _doorLinkPts: [{x:1,y:1}] };
M._cancelDoorLink(mapState);
out.state = mapState;
""")
    assert out["state"] == {
        "_doorLinkEid": None, "_doorLinkBarrierId": None,
        "_doorLinkFloorId": None, "_doorLinkPts": None,
    }, out["state"]


def test_lights_row_offers_link_on_map_not_a_jump_to_rooms():
    """The confusion this whole feature exists to fix: the row must no
    longer send anyone away to Rooms to do this."""
    src = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert "Link on map" in src, "the row's button text must say the tool is here, on this map"
    assert "setMapsTab" not in src, "lights_map.js must not itself navigate tabs for a door row"


def test_maps_js_click_handler_dispatches_to_the_wall_picker_before_placement():
    """Source-level pin, since toVB needs a real SVGPoint the node shim does
    not provide: the door-link branch must run, and return, before the
    ordinary placement-queue branch even looks at the click."""
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    dl = src.index("if (!mapState._doorLinkEid) return;")
    pq = src.index('const q = o.mapState._placeQueue || [];')
    assert dl < pq, "the door-link branch must be wired before the placement-queue branch"
