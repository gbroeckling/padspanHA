"""The lights map renderer, exercised for real.

Every lights defect in this feature's history shipped because the frontend had
no test at all: the map is JavaScript, the suite is Python, so nothing ever ran
it. These tests execute the actual module under node and assert the behaviours
that were broken — the fabric-only frame, render/drag agreement, and physical
size and rotation, which sat in the storage schema and the save command for
weeks while nothing drew them and nothing could set them.

Skipped (not failed) when node is unavailable, so the suite still runs on a
box without it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run_js(tmp_path: Path, script: str) -> dict:
    """Load iso_lights.js in node and return whatever the script prints.

    The module imports its sibling with a cache-busting query built from
    import.meta.url; copying to .mjs and rewriting that one specifier is all
    node needs to run the real file rather than a reimplementation of it.
    """
    for name in ("iso_lights", "light_codes"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    # encoding is explicit: text=True decodes with the locale codepage, which
    # on Windows mangles the module's UTF-8 arrows and dashes into mojibake.
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# A house with NO maps, NO map_transforms and NO photos of any kind.
_MODEL = {
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
        "Loft":    {"type": "poly", "floor_id": "up",   "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]},
    },
    "light_positions_m": {
        "light.plain":  {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
        "light.strip":  {"x_m": 4.0, "y_m": 1.0, "floor_id": "main",
                         "width_cm": 240, "height_cm": 5, "rotation": 30},
    },
}
_FLOORS = [{"id": "main", "name": "Main", "level": 0}, {"id": "up", "name": "Upper", "level": 1}]
_LIGHTS_BY_EID = {
    "light.plain": {"entity_id": "light.plain", "state": "on", "code": "A01", "shape": "circle", "isWled": False},
    "light.strip": {"entity_id": "light.strip", "state": "on", "code": "W01", "shape": "bar", "isWled": True},
}


def _harness(body: str) -> str:
    return (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(_MODEL)};\n"
        f"const FLOORS={json.dumps(_FLOORS)};\n"
        f"const LBE={json.dumps(_LIGHTS_BY_EID)};\n"
        "const out={};\n" + body + "\nconsole.log(JSON.stringify(out));\n"
    )


_FORBIDDEN = ("stack_transform", "makeStackXform", "imageAr", "metreAnchor",
              "room_bounds", "map_transforms", "maps_list", "mapImageUrl")


def _code_only(src: str) -> str:
    """Source with comment lines stripped, so prose about the rule is allowed."""
    return chr(10).join(l for l in src.splitlines() if not l.strip().startswith("//"))


def test_no_lights_file_touches_the_photo_machinery():
    """The rule, enforced across the WHOLE lights path, not just the renderer.

    stack_transform is where map placement, image aspect ratio and the
    measured-photo anchor live. Lights read the metric fabric and nothing
    else. Every one of these files has, at some point in this feature's
    history, reached for a photo and put the map in the wrong place.
    """
    targets = {
        "views/iso_lights.js": _VIEWS / "iso_lights.js",
        "views/lights_map.js": _VIEWS / "lights_map.js",
        "views/light_codes.js": _VIEWS / "light_codes.js",
        "lights_panel.js": _WWW / "lights_panel.js",
    }
    for label, path in targets.items():
        code = _code_only(path.read_text(encoding="utf-8"))
        for bad in _FORBIDDEN:
            assert bad not in code, f"{label} reaches for {bad}"


def test_the_lights_tab_builds_without_a_photo_too():
    """The Mapping tab shares the renderer, so it must share the rule."""
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    # From the first lights-tab helper to the Rooms tab, so nothing in the
    # tab's own code can reach for a photo. NOTE the limit of this guard:
    # maps.js legitimately imports the photo machinery at module level for the
    # Edit/Stack/Rooms tabs, so a file-wide ban is not possible here — only
    # the lights region is covered.
    seg = _code_only(src[src.index("function _floorIdForZ"):src.index("// ─── Rooms tab")])
    for bad in _FORBIDDEN + ("visMaps", "mapsForRender"):
        assert bad not in seg, f"the Lights tab reaches for {bad}"


def test_frame_builds_from_the_fabric_with_no_maps_at_all(tmp_path):
    out = _run_js(tmp_path, _harness(
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);"
        "out.levels=f.levels; out.scale=f.scale; out.empty=f.empty;"
    ))
    assert out["empty"] is False
    assert out["levels"] == [0, 1], "floor levels come from the floor registry"
    assert out["scale"] > 0, "a metres-per-pixel scale is derived from the fabric extent"


def test_drag_inverts_exactly_what_the_renderer_drew(tmp_path):
    """Render and drag must share one projection, or a dropped light moves."""
    out = _run_js(tmp_path, _harness(
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);"
        "out.rt=[[3,2,0],[0,0,0],[5,5,1],[-2,7,1]].map(([x,y,z])=>{"
        "const p=f.iso(x,y,z); const b=f.isoInv(p[0],p[1],z);"
        "return [Math.abs(b[0]-x),Math.abs(b[1]-y)];});"
    ))
    for dx, dy in out["rt"]:
        assert dx < 1e-9 and dy < 1e-9, "isoInv must be the exact inverse of iso"


def test_a_placed_light_renders_without_any_map(tmp_path):
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);"
        "out.svg=svg; out.placed=(svg.match(/data-placed=\"1\"/g)||[]).length;"
    ))
    assert out["placed"] == 2, "both placed lights draw, with no maps_list in play"
    assert "No floor plans uploaded yet" not in out["svg"], "must not blame a missing photo"


def test_physical_size_and_rotation_are_actually_drawn(tmp_path):
    """The defect: both sat in the schema while nothing rendered them."""
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);"
        "const strip=svg.split('data-eid=\"light.strip\"')[1].split('</g>')[0];"
        "const plain=svg.split('data-eid=\"light.plain\"')[1].split('</g>')[0];"
        "out.strip=strip; out.plain=plain;"
    ))
    assert "scale(" in out["strip"], "a 2.4 m fixture must be drawn at 2.4 m"
    # ...and the scale must actually reflect the measurement. The first cut
    # floored at 1x, and the default marker already represents ~2.4 m at house
    # scale, so every real fixture rendered identically and sizing looked inert.
    import re as _re
    sx = float(_re.search(r"scale\(([0-9.]+)", out["strip"]).group(1))
    assert sx > 1.3, f"a 2.4 m fixture drew at {sx}x - sizing is not faithful"
    assert "rotate(30" in out["strip"], "rotation must reach the SVG"
    # A light with no measurements keeps the plain, legible default marker.
    assert "scale(" not in out["plain"] and "rotate(" not in out["plain"]


def test_the_code_label_is_never_rotated_or_stretched(tmp_path):
    """Readability is the whole point of the view."""
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);"
        "const g=svg.split('data-eid=\"light.strip\"')[1];"
        "out.textAfterTransformClose = g.indexOf('</g>') < g.indexOf('W01');"
    ))
    assert out["textAfterTransformClose"] is True, "the label must sit outside the transformed group"


def test_empty_fabric_points_at_the_fabric_not_at_uploading_a_photo(tmp_path):
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG({},{},new Set(),null,150,0,{},false,[]);"
        "out.svg=svg;"
    ))
    assert "Mapping → Rooms" in out["svg"]
    assert "uploaded" not in out["svg"], "no photo is involved in this view"


# ── Marker scale ────────────────────────────────────────────────────────────
# A marker is an object in a room, so it is measured in metres. It used to be a
# flat 14 px, which was fine when the world was a normalised photo but became
# 2.38 m across once the scale came from the fabric — wider than the room it
# sat in, which is what made the sidebar unusable.

_MARKER_JS = 'import * as M from \'./iso_lights.mjs\';\nconst MODEL=__MODEL__;\nconst FLOORS=[{id:\'main\',level:0}];\nconst LBE={\'light.probe\':{entity_id:\'light.probe\',state:\'on\',code:\'A01\',shape:\'circle\',isWled:false}};\nconst f=M.fabricFrame(MODEL,FLOORS,150,0);\nconst svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);\nconst g=svg.split(\'data-placed="1"\')[1];\nconst r=parseFloat(g.match(/<circle[^>]*r="([0-9.]+)"/)[1]);\nconsole.log(JSON.stringify({px:r*2, m:(r*2)/f.scale, scale:f.scale}));\n'


def _sq(span_x, span_y):
    return {"room_geometry_m": {"R": {"type": "poly", "floor_id": "main",
             "points_m": [[0, 0], [span_x, 0], [span_x, span_y], [0, span_y]]}},
            "light_positions_m": {}}


def _marker_m(tmp_path, model):
    """Measure the marker the RENDERER actually draws, not the helper.

    Asserting on markerRadiusPx() looked fine and proved nothing: reverting
    buildIsoSVG to the old fixed 14 px left every such test passing, because
    the helper stayed correct and simply went unused. Parse the SVG instead.
    A circle marker is drawn at HW = r_hex * 0.866, so its width is 2 * r.
    """
    model = dict(model)
    model["light_positions_m"] = {"light.probe": {"x_m": 1.0, "y_m": 1.0, "floor_id": "main"}}
    return _run_js(tmp_path, _MARKER_JS.replace("__MODEL__", json.dumps(model)))


def test_marker_is_never_wider_than_a_small_room(tmp_path):
    """The reported failure: gigantic icons swamping the map."""
    out = _marker_m(tmp_path, _sq(25, 51))          # a house the size of Garry's
    assert out["m"] < 1.2, f"marker is {out['m']:.2f} m across on a house-sized fabric"


def test_marker_shrinks_with_the_site_rather_than_staying_a_fixed_pixel_size(tmp_path):
    """A fixed pixel size is what broke: it ignores how big the place is."""
    small = _marker_m(tmp_path, _sq(8, 6))
    big = _marker_m(tmp_path, _sq(60, 40))
    assert small["px"] > big["px"] + 1, "a marker must take fewer pixels on a larger site"
    assert small["m"] <= 0.75, "on a studio the marker should read as a real fixture"


def test_marker_stays_clickable_on_a_very_large_site(tmp_path):
    out = _marker_m(tmp_path, _sq(200, 150))
    assert out["px"] >= 8, "a marker must not shrink into an unclickable speck"


def test_marker_never_exceeds_the_old_fixed_size(tmp_path):
    """A studio flat must not render saucers."""
    out = _marker_m(tmp_path, _sq(4, 3))
    assert out["px"] <= 14 * 2 * 0.866 + 0.01


_LABEL_JS = 'import * as M from \'./iso_lights.mjs\';\nconst MODEL=__MODEL__;\nconst FLOORS=[{id:\'main\',level:0}];\nconst LBE={\'light.probe\':{entity_id:\'light.probe\',state:\'on\',code:\'A01\',shape:\'circle\',isWled:false}};\nconst svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);\nconst g=svg.split(\'data-placed="1"\')[1];\nconsole.log(JSON.stringify({font:parseFloat(g.match(/font-size="([0-9.]+)"/)[1])}));\n'


def test_the_code_label_shrinks_with_the_marker(tmp_path):
    """An 11px label on an 8.7px marker is half of why it read as gigantic."""
    def font(model):
        model = dict(model)
        model["light_positions_m"] = {"light.probe": {"x_m": 1.0, "y_m": 1.0, "floor_id": "main"}}
        return _run_js(tmp_path, _LABEL_JS.replace("__MODEL__", json.dumps(model)))["font"]
    studio, house = font(_sq(8, 6)), font(_sq(25, 51))
    assert house < studio, "the label must scale with the marker, not stay fixed"


# ── Floor stacking and canvas use ─────────────────────────────────────────────

# A house whose fabric floors do NOT number contiguously once the garden is
# dropped: the outdoor sentinel ranks between Main and Upper, so the drawn
# storeys are levels 0, 1 and 3.
_GAPPED_MODEL = {
    "room_geometry_m": {
        "Basement": {"type": "poly", "floor_id": "base",
                     "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
        "Kitchen":  {"type": "poly", "floor_id": "main",
                     "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
        "Shed":     {"type": "poly", "floor_id": "__outside__",
                     "points_m": [[40, 40], [50, 40], [50, 48], [40, 48]]},
        "Loft":     {"type": "poly", "floor_id": "up",
                     "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]},
    },
    "light_positions_m": {},
}
_GAPPED_FLOORS = [
    {"id": "base", "name": "Basement", "level": 0},
    {"id": "main", "name": "Main", "level": 1},
    {"id": "outside", "name": "Outside", "level": 2},
    {"id": "up", "name": "Upper", "level": 3},
]


def _gapped_harness(body: str) -> str:
    return (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(_GAPPED_MODEL)};\n"
        f"const FLOORS={json.dumps(_GAPPED_FLOORS)};\n"
        "const out={};\n" + body + "\nconsole.log(JSON.stringify(out));\n"
    )


def test_drawn_floors_are_evenly_spaced_even_when_levels_skip(tmp_path):
    """A floor the map does not draw must not reserve a storey of empty air.

    The garden ranks between Main and Upper, so dropping it leaves levels
    0, 1, 3. Multiplying the raw level by the spacing drew the top gap at
    twice the size of the one below it.
    """
    out = _run_js(tmp_path, _gapped_harness(
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);\n"
        "out.levels=f.levels;\n"
        "out.ys=f.levels.map(z=>f.iso(0,0,z)[1]);\n"
    ))
    assert out["levels"] == [0, 1, 3], "precondition: the numbering has a hole"
    ys = out["ys"]
    gaps = [round(ys[i - 1] - ys[i], 6) for i in range(1, len(ys))]
    assert len(set(gaps)) == 1, f"floor gaps are uneven: {gaps}"
    assert gaps[0] == 150, f"gap should equal the spacing slider, got {gaps[0]}"


def test_the_drag_inverse_still_round_trips_with_skipped_levels(tmp_path):
    """Whatever the stacking does, the drag must undo it exactly."""
    out = _run_js(tmp_path, _gapped_harness(
        "const f=M.fabricFrame(MODEL,FLOORS,150,40);\n"
        "out.err=f.levels.map(z=>{const p=f.iso(2.5,1.5,z);\n"
        "  const b=f.isoInv(p[0],p[1],z);\n"
        "  return Math.hypot(b[0]-2.5,b[1]-1.5);});\n"
    ))
    assert max(out["err"]) < 1e-9, f"round-trip drift: {out['err']}"


def test_the_garden_never_reserves_a_storey(tmp_path):
    """The outdoor sentinel is not a floor of the building."""
    out = _run_js(tmp_path, _gapped_harness(
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);\n"
        "out.rooms=f.rooms.map(r=>r.room).sort();\n"
        "out.n=f.levels.length;\n"
    ))
    assert "Shed" not in out["rooms"]
    assert out["n"] == 3, f"expected 3 drawn storeys, got {out['n']}"


def test_the_map_is_not_pinned_to_its_natural_size(tmp_path):
    """A hard max-height let the browser letterbox the drawing.

    With the SVG capped at its own viewBox height, any panel wider than the
    760-unit canvas rendered the map at 1:1 in the middle with dead space down
    both sides — and the zoom control could then only slide it around inside
    that box rather than making it bigger.
    """
    out = _run_js(tmp_path, _harness(
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);\n"
        "out.head=svg.slice(0,svg.indexOf('>')+1);\n"
    ))
    head = out["head"]
    assert 'width="100%"' in head, "the map must fill its host"
    assert "max-height" not in head, (
        f"the drawing is still pinned to its natural size: {head}"
    )


def test_unplaced_lights_sit_at_the_room_centre_not_at_its_name(tmp_path):
    """A light with no stored position belongs in the middle of its room.

    The room NAME was moved off the centroid so fixtures stopped being drawn
    through it — but the unplaced-light cluster shared the same variable, so
    those lights moved to the room's top edge with it. Two different things
    that both happened to be "the middle of the room" until one of them moved.
    """
    model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main",
                        "points_m": [[0, 0], [10, 0], [10, 10], [0, 10]]},
        },
        "light_positions_m": {},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    lbe = {"light.a": {"entity_id": "light.a", "state": "on", "code": "A01",
                       "shape": "hex", "isWled": False}}
    by_room = {"Kitchen": [{"entity_id": "light.a", "code": "A01"}]}

    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const BYROOM={json.dumps(by_room)};\n"
        "const out={};\n"
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);\n"
        "out.centre=f.iso(5,5,0);\n"
        "const svg=M.buildIsoSVG(MODEL,BYROOM,new Set(),null,150,0,LBE,false,FLOORS);\n"
        "const m=svg.match(/<g class=\"lhex\"[^>]*>.*?<polygon points=\"([^\"]+)\"/s);\n"
        "out.marker=m?m[1].split(' ').map(p=>p.split(',').map(Number)):null;\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["marker"], "the unplaced light was not drawn at all"
    xs = [p[0] for p in out["marker"]]
    ys = [p[1] for p in out["marker"]]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    cx, cy = out["centre"]
    assert abs(mx - cx) < 2 and abs(my - cy) < 2, (
        f"unplaced light drawn at ({mx:.1f}, {my:.1f}) but the room centre is "
        f"({cx:.1f}, {cy:.1f}) — it has drifted to the room's name"
    )


def test_fixture_size_has_no_dead_zone(tmp_path):
    """Setting a width must always change something.

    The size factor is roughly 0.016 per cm at a house's scale, so a hard
    max(0.5, ...) floor meant nothing under ~31 cm could clear it: a 10 cm pot
    light, the 15 cm default and a 30 cm fixture all rendered at exactly the
    same size, and the Width box appeared to do nothing.
    """
    def scale_for(w_cm):
        model = {
            "room_geometry_m": {
                "Kitchen": {"type": "poly", "floor_id": "main",
                            "points_m": [[0, 0], [14, 0], [14, 12], [0, 12]]},
            },
            "light_positions_m": {
                "light.a": {"x_m": 7.0, "y_m": 6.0, "floor_id": "main",
                            "width_cm": w_cm, "height_cm": w_cm},
            },
        }
        out = _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const FLOORS={json.dumps([{'id': 'main', 'name': 'Main', 'level': 0}])};\n"
            f"const LBE={json.dumps({'light.a': {'entity_id': 'light.a', 'state': 'on', 'code': 'A01', 'shape': 'bar', 'isWled': False}})};\n"
            "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);\n"
            r'const m=svg.match(/scale\(([0-9.]+),([0-9.]+)\)/);' + chr(10) +
            "console.log(JSON.stringify({sx:m?Number(m[1]):null}));\n"
        ))
        return out["sx"]

    sizes = [10, 15, 30, 60, 150]
    scales = [scale_for(w) for w in sizes]
    assert all(s is not None for s in scales), f"no scale drawn: {scales}"
    for i in range(1, len(scales)):
        assert scales[i] > scales[i - 1], (
            f"{sizes[i]}cm renders at {scales[i]} — no larger than "
            f"{sizes[i-1]}cm at {scales[i-1]}; the size control has a dead zone"
        )
    # The legibility minimum still holds for the smallest fixture.
    assert scales[0] >= 0.5


def test_placing_a_light_uses_the_floor_the_renderer_drew(tmp_path):
    """A light dropped on the Upper floor must be stored as Upper.

    The map's inverse floor lookup matched the registry's `level`, but on a
    real install every floor has level null — Number(null) is 0, so z=0 matched
    the first floor by accident and every storey above it fell through to the
    "main" default. A light placed in an upstairs room was saved as main and
    disappeared from the room it had just been put in.

    fabricFrame resolves the stack (explicit level, then base elevation, then
    registry order); the inverse has to agree with it.
    """
    # The live registry: four floors, every level null.
    floors = [
        {"id": "basement", "name": "Basement", "level": None},
        {"id": "main", "name": "Main", "level": None},
        {"id": "outside", "name": "Outside", "level": None},
        {"id": "upper", "name": "Upper", "level": None},
    ]
    model = {
        "room_geometry_m": {
            "Cellar":  {"type": "poly", "floor_id": "basement",
                        "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
            "Kitchen": {"type": "poly", "floor_id": "main",
                        "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
            "Office":  {"type": "poly", "floor_id": "upper",
                        "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]},
        },
        "light_positions_m": {},
    }
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        "const out={};\n"
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);\n"
        "out.levelOf={basement:f.levelOf('basement'), main:f.levelOf('main'),\n"
        "             upper:f.levelOf('upper')};\n"
        "out.backToFloor={};\n"
        "for(const id of ['basement','main','upper'])\n"
        "  out.backToFloor[id]=M.floorIdAtLevel(f, MODEL, FLOORS, f.levelOf(id));\n"
        "out.levels=f.levels;\n"
        "console.log(JSON.stringify(out));\n"
    ))
    lv = out["levelOf"]
    # The three storeys must resolve to three DIFFERENT heights...
    assert len({lv["basement"], lv["main"], lv["upper"]}) == 3, lv
    # ...and the naive registry-level match would have collapsed them all to 0.
    assert lv["upper"] != 0, "Upper resolved to the ground slab"

    # And the INVERSE must hand back the same floor for that height. This is
    # the behaviour, not a grep: it fails if the inverse stops asking the
    # renderer, which is what silently moved lights between storeys.
    back = out["backToFloor"]
    assert back["basement"] == "basement", back
    assert back["main"] == "main", back
    assert back["upper"] == "upper", (
        "a light drawn on Upper is stored as {!r} — it vanishes from the room "
        "it was placed in".format(back["upper"])
    )


def test_the_map_inverts_the_floor_through_the_renderer(tmp_path):
    """The maps view must use that inverse, not its own.

    Two implementations of "which floor is this height" is how lights ended up
    on storeys at random: the renderer stacked by one rule and the save wrote
    the other rule's answer.
    """
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    body = src[src.index("function _floorIdForZ"):]
    body = body[:body.index("\n}\n") + 3]
    assert "floorIdAtLevel(" in body, (
        "the maps view resolves the floor itself instead of asking the "
        "renderer, so the two can disagree"
    )


def test_the_dotted_line_shape_draws_a_run_not_a_body(tmp_path):
    """A strip run is a length of light, not a fixture with a body.

    It has no fill to carry on/off, so the DASHES must take the state colour —
    drawing them in the border colour would make an off light look on.
    """
    model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main",
                        "points_m": [[0, 0], [10, 0], [10, 8], [0, 8]]},
        },
        "light_positions_m": {
            "light.run": {"x_m": 5.0, "y_m": 4.0, "floor_id": "main"},
        },
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    lbe = {"light.run": {"entity_id": "light.run", "state": "on", "code": "W01",
                         "shape": "line", "isWled": True}}
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        "const out={};\n"
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS);\n"
        "out.line=(svg.match(/<line[^>]*stroke-dasharray[^>]*>/)||[])[0]||null;\n"
        "out.onCol=M.shapeSvg('line',0,0,10,'fill=\"#fbbf24\" stroke=\"#c084fc\"');\n"
        "out.offCol=M.shapeSvg('line',0,0,10,'fill=\"#374151\" stroke=\"#60a5fa\"');\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["line"], "no dotted line was drawn for a light with shape=line"
    assert "stroke-dasharray" in out["line"]

    # State must survive: the dashes carry the on/off colour.
    assert 'stroke="#fbbf24"' in out["onCol"], out["onCol"]
    assert 'stroke="#374151"' in out["offCol"], out["offCol"]
    # ...and it must not paint a solid body.
    assert 'fill="none"' in out["onCol"]


def test_the_dotted_line_fits_the_same_footprint_as_every_other_shape(tmp_path):
    """Cluster packing assumes one width for all shapes."""
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "const out={};\n"
        "const a='fill=\"#fbbf24\" stroke=\"#60a5fa\" stroke-width=\"2\"';\n"
        "const l=M.shapeSvg('line',0,0,10,a);\n"
        "out.x1=Number(/x1=\"([-0-9.]+)\"/.exec(l)[1]);\n"
        "out.x2=Number(/x2=\"([-0-9.]+)\"/.exec(l)[1]);\n"
        "const b=M.shapeSvg('bar',0,0,10,a);\n"
        "out.barX=Number(/x=\"([-0-9.]+)\"/.exec(b)[1]);\n"
        "out.barW=Number(/width=\"([-0-9.]+)\"/.exec(b)[1]);\n"
        "console.log(JSON.stringify(out));\n"
    ))
    # Same half-width (r * 0.866) as the bar, so clusters pack identically.
    # Both are emitted at one decimal place, so allow one rounding unit.
    assert abs(out["x1"] - out["barX"]) < 0.11, (out["x1"], out["barX"])
    assert abs((out["x2"] - out["x1"]) - out["barW"]) < 0.11


def test_the_dotted_line_is_offered_in_the_chooser():
    src = (_VIEWS / "light_codes.js").read_text(encoding="utf-8")
    block = src[src.index("export const LIGHT_SHAPES"):]
    block = block[:block.index("];")]
    assert '"line"' in block, "the dotted line is not selectable"


def test_moving_a_light_does_not_move_the_frame_under_it(tmp_path):
    """The projection is a property of the BUILDING, not of its fixtures.

    Scale, centre and per-floor offset were all grown by light positions, so
    dragging one light past its room's edge rescaled and re-centred the whole
    map mid-edit. The fixture landed at the right metres but the drawing moved
    beneath it, so the drag looked short — or like the light sprang back.
    """
    rooms = {
        "Kitchen": {"type": "poly", "floor_id": "main",
                    "points_m": [[0, 0], [10, 0], [10, 8], [0, 8]]},
    }
    def frame_for(light_xy):
        model = {"room_geometry_m": rooms,
                 "light_positions_m": {"light.a": {"x_m": light_xy[0],
                                                   "y_m": light_xy[1],
                                                   "floor_id": "main"}}}
        return _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const FLOORS={json.dumps([{'id':'main','name':'Main','level':0}])};\n"
            "const out={};\n"
            "const f=M.fabricFrame(MODEL,FLOORS,150,0);\n"
            "out.scale=f.scale;\n"
            "out.corner=f.iso(0,0,0);\n"     # a fixed point of the BUILDING
            "console.log(JSON.stringify(out));\n"
        ))

    inside = frame_for((5.0, 4.0))
    outside = frame_for((40.0, 30.0))   # dragged well past the room

    assert abs(inside["scale"] - outside["scale"]) < 1e-9, (
        "moving a light rescaled the map: {} -> {}".format(
            inside["scale"], outside["scale"])
    )
    assert abs(inside["corner"][0] - outside["corner"][0]) < 1e-9, (
        "moving a light shifted the map horizontally"
    )
    assert abs(inside["corner"][1] - outside["corner"][1]) < 1e-9, (
        "moving a light shifted the map vertically"
    )


def test_a_fabric_with_no_rooms_still_frames_its_lights(tmp_path):
    """Negative control: lights must still set the frame when nothing else can."""
    model = {"room_geometry_m": {},
             "light_positions_m": {
                 "light.a": {"x_m": 0.0, "y_m": 0.0, "floor_id": "main"},
                 "light.b": {"x_m": 9.0, "y_m": 6.0, "floor_id": "main"}}}
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const FLOORS={json.dumps([{'id':'main','name':'Main','level':0}])};\n"
        "const out={};\n"
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);\n"
        "out.scale=f.scale; out.empty=f.empty;\n"
        "out.spread=Math.abs(f.iso(9,6,0)[0]-f.iso(0,0,0)[0]);\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["empty"] is False
    assert out["scale"] > 0, "a roomless fabric must still derive a scale"
    assert out["spread"] > 20, "two lights 11 m apart must not collapse together"
