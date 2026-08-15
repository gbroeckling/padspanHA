"""The contract every photo-free view now depends on.

Two days of removing photo links left several views drawing through one shared
projection — `fabricFrame()` in views/iso_lights.js. Before, each view carried
its own transform derived from where someone had dragged an image, so a bug in
one view stayed in that view. Now a bug in this function is a bug in the
Overview stack, the Lights map, the Lights sidebar and Pure Live at once.

So the contract gets asserted directly, against a fabric with NO maps in it.

The fixture is synthetic and deliberately so. It has the same SHAPE as a real
install — several storeys, an outdoor floor, rooms of honest sizes, scanners
keyed by MAC, barriers, a light with real measurements — but none of it is
anyone's house. This repository is public; a real fabric would publish room
names, MAC addresses and a floor plan.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
          / "www" / "padspan-ha" / "views")
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


# ── A house, in metres, with no photograph anywhere in it ────────────────────
FLOORS = [
    {"id": "basement", "name": "Basement", "level": None},
    {"id": "main", "name": "Main", "level": None},
    {"id": "upper", "name": "Upper", "level": None},
    {"id": "outside", "name": "Outside", "level": None},
]

def _rect(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

MODEL = {
    "floors": FLOORS,
    "room_geometry_m": {
        # main
        "Kitchen":    {"type": "poly", "floor_id": "main", "points_m": _rect(0, 0, 6, 4)},
        "Living":     {"type": "poly", "floor_id": "main", "points_m": _rect(6, 0, 14, 8)},
        "Laundry":    {"type": "poly", "floor_id": "main", "points_m": _rect(0, 4, 3, 7)},
        # upper
        "Bedroom":    {"type": "poly", "floor_id": "upper", "points_m": _rect(1, 1, 8, 6)},
        "Ensuite":    {"type": "poly", "floor_id": "upper", "points_m": _rect(8, 1, 11, 4)},
        # basement
        "Utility":    {"type": "poly", "floor_id": "basement", "points_m": _rect(0, 0, 3, 4)},
        # outside — deliberately far away, which is the whole reason outdoor
        # areas must not get a vote on the building's scale
        "Shed":       {"type": "poly", "floor_id": "__outside__", "points_m": _rect(48, 40, 51, 43)},
        "Driveway":   {"type": "poly", "floor_id": "__outside__", "points_m": _rect(40, 30, 47, 38)},
    },
    "scanner_positions_m": {
        "1C:DB:D4:74:D7:1E": {"x_m": 3.0, "y_m": 2.0, "z_m": 2.2, "floor_id": "main"},
        "9C:13:9E:DC:04:62": {"x_m": 10.0, "y_m": 4.0, "z_m": 1.1, "floor_id": "main"},
        "E0:72:A1:F3:90:12": {"x_m": 4.0, "y_m": 3.0, "z_m": 2.4, "floor_id": "upper"},
    },
    "rf_barriers_m": [
        {"name": "Barrier 1", "material": "metal", "attenuation_dbm": 12.0,
         "floor_id": "main", "points_m": [[6, 0], [6, 8]]},
    ],
    "light_positions_m": {
        "light.valance": {"x_m": 1.2, "y_m": 3.6, "floor_id": "main",
                          "width_cm": 240, "height_cm": 6, "rotation": 0,
                          "color": "#fbbf24"},
        "light.pot":     {"x_m": 9.0, "y_m": 4.0, "floor_id": "main"},
        "light.shed":    {"x_m": 49.0, "y_m": 41.0, "floor_id": "__outside__"},
    },
}


def _run(tmp_path: Path, script: str) -> dict:
    for name in ("iso_lights", "light_codes", "room_color"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"')
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "model.json").write_text(json.dumps(MODEL), encoding="utf-8")
    (tmp_path / "run.mjs").write_text(
        "import * as M from './iso_lights.mjs';\n"
        "import fs from 'node:fs';\n"
        "const MODEL = JSON.parse(fs.readFileSync(new URL('./model.json', import.meta.url)));\n"
        "const FLOORS = MODEL.floors;\n"
        "const out = {};\n" + script + "\nconsole.log(JSON.stringify(out));\n",
        encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_frame_exists_without_a_single_photograph(tmp_path):
    """The sentence the whole sweep is about."""
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "out.empty = f.empty; out.levels = f.levels; out.rooms = f.rooms.length;\n"
        "out.scale = f.scale; out.names = f.rooms.map(r => r.room);\n"
    ))
    assert out["empty"] is False
    assert out["rooms"] == 6, out["names"]          # the indoor six
    assert len(out["levels"]) == 3, out["levels"]   # basement, main, upper
    assert out["scale"] > 0


def test_outdoor_areas_are_kept_out_of_the_stack_but_handed_back(tmp_path):
    """The regression this suite was written after.

    A shed 50 m down the garden must not size the house — so outdoor rooms are
    excluded from the storey stack. They were then simply dropped, and deleting
    Overview's per-photo path took them off the map entirely: three rooms that
    had always been drawn quietly vanished. They come back as `outdoor`.
    """
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "out.stack = f.rooms.map(r => r.room);\n"
        "out.outdoor = (f.outdoor || []).map(r => r.room);\n"
        "out.hasPts = (f.outdoor || []).every(r => Array.isArray(r.pts) && r.pts.length >= 3);\n"
    ))
    assert "Shed" not in out["stack"], "the shed is sizing the building"
    assert sorted(out["outdoor"]) == ["Driveway", "Shed"], out["outdoor"]
    assert out["hasPts"], "outdoor rooms came back without geometry to draw"


def test_a_shed_fifty_metres_away_does_not_shrink_the_house(tmp_path):
    """Why outdoor is excluded at all — assert the scale, not the intention."""
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "const near = JSON.parse(JSON.stringify(MODEL));\n"
        "delete near.room_geometry_m.Shed; delete near.room_geometry_m.Driveway;\n"
        "const g = M.fabricFrame(near, FLOORS, 150, 0);\n"
        "out.withOutdoor = f.scale; out.withoutOutdoor = g.scale;\n"
    ))
    assert abs(out["withOutdoor"] - out["withoutOutdoor"]) < 1e-9, (
        "removing the outdoor areas changed the building's scale — they are "
        "voting on it: {}".format(out)
    )


def test_render_and_drag_use_one_projection(tmp_path):
    """iso and isoInv must be exact inverses on every storey.

    Every view that places something now inverts through this. A discrepancy
    here is a light that lands where it was not dropped, in four views at once.
    """
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "out.worst = 0;\n"
        "for (const z of f.levels) for (const [x,y] of [[0,0],[6,4],[13.5,7.9],[-2,3]]) {\n"
        "  const p = f.iso(x,y,z); const b = f.isoInv(p[0],p[1],z);\n"
        "  out.worst = Math.max(out.worst, Math.abs(b[0]-x), Math.abs(b[1]-y));\n"
        "}\n"
    ))
    assert out["worst"] < 1e-9, f"round trip drifts by {out['worst']} m"


def test_every_storey_gets_its_own_slab_extent(tmp_path):
    """Overview sizes each slab from the rooms on that storey.

    It used to size them from the four corners of every uploaded image, so a
    plan photographed with a margin made that floor bigger than it is.
    """
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "out.byZ = {};\n"
        "for (const z of f.levels) {\n"
        "  const rs = f.rooms.filter(r => r.z === z);\n"
        "  let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;\n"
        "  for (const r of rs) for (const p of r.pts) { a=Math.min(a,p[0]); b=Math.min(b,p[1]); c=Math.max(c,p[0]); d=Math.max(d,p[1]); }\n"
        "  out.byZ[z] = [rs.length, +(c-a).toFixed(2), +(d-b).toFixed(2)];\n"
        "}\n"
    ))
    extents = out["byZ"]
    assert len(extents) == 3, extents
    # The basement holds one 3x4 room; the main floor is much wider. If slabs
    # were still sized from images these would not differ this way.
    widths = sorted(v[1] for v in extents.values())
    assert widths[0] < widths[-1], extents


def test_a_scanner_is_placed_from_its_metres(tmp_path):
    """Overview's scanner markers now come from scanner_positions_m."""
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "const zOf = (fid) => { const r = f.rooms.find(rr => String(rr.floor_id) === String(fid)); return r ? r.z : undefined; };\n"
        "out.placed = [];\n"
        "for (const [src, p] of Object.entries(MODEL.scanner_positions_m)) {\n"
        "  const z = zOf(p.floor_id);\n"
        "  if (z === undefined) continue;\n"
        "  const [sx, sy] = f.iso(p.x_m, p.y_m, z);\n"
        "  out.placed.push([src, Number.isFinite(sx), Number.isFinite(sy)]);\n"
        "}\n"
    ))
    assert len(out["placed"]) == 3, out["placed"]
    assert all(ok_x and ok_y for _, ok_x, ok_y in out["placed"]), out["placed"]


def test_floors_with_no_level_numbers_still_stack_in_order(tmp_path):
    """Every floor in this fixture has level: null, like the real registry.

    Number(null) is 0, so before floors were ranked they all collapsed onto
    one slab. The fixture keeps them null on purpose.
    """
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "out.levels = f.levels;\n"
        "out.distinct = new Set(f.rooms.map(r => r.z)).size;\n"
        "out.ys = f.levels.map(z => Math.round(f.iso(0,0,z)[1]));\n"
    ))
    assert out["distinct"] == 3, "storeys collapsed onto one slab"
    assert len(set(out["ys"])) == 3, f"storeys drew at the same height: {out['ys']}"


def test_a_measured_fixture_keeps_its_measurements(tmp_path):
    """width_cm/height_cm/rotation drive the marker, in metres, unscaled."""
    out = _run(tmp_path, (
        "const f = M.fabricFrame(MODEL, FLOORS, 150, 0);\n"
        "const s1 = M.markerScale(240, 6, f.scale, 10);\n"
        "const s2 = M.markerScale(0, 0, f.scale, 10);\n"
        "out.sized = s1.sx; out.unsized = s2.sx;\n"
    ))
    assert out["unsized"] == 1, "an unmeasured fixture must draw at the default"
    assert out["sized"] > out["unsized"], "a 2.4 m valance draws no larger than a dot"


def test_the_frame_is_honest_about_an_empty_fabric(tmp_path):
    """No rooms is a real state, and must be reported rather than crash."""
    out = _run(tmp_path, (
        "const f = M.fabricFrame({}, [], 150, 0);\n"
        "out.empty = f.empty; out.rooms = f.rooms.length; out.levels = f.levels.length;\n"
        "out.outdoor = (f.outdoor || []).length;\n"
    ))
    assert out["empty"] is True
    assert out["rooms"] == 0 and out["outdoor"] == 0
