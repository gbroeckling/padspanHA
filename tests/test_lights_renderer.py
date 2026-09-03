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
import re
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
    for name in ("iso_lights", "light_codes", "room_color"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"')
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


# Every file the lights UI actually loads, walked transitively from its two
# entry points. Both static `import ... from "./x.js"` and the dynamic
# `await import(`./x.js${...}`)` form are followed.
#   import { x } from "./y.js"          (static)
#   await import(`./y.js${...}`)        (dynamic, cache-busted)
_IMPORT_RE = re.compile(
    r"""import\s*\(?\s*(?:\{[^}]*\}\s*from\s*)?[`'"]\./([A-Za-z0-9_./-]+?)\.js"""
)


def _lights_import_closure() -> dict:
    entries = [("lights_panel.js", _WWW / "lights_panel.js")]
    seen, out = set(), {}
    while entries:
        label, path = entries.pop()
        if not path.exists() or label in seen:
            continue
        seen.add(label)
        src = path.read_text(encoding="utf-8")
        out[label] = path
        for rel in _IMPORT_RE.findall(src):
            if "lib/" in rel:
                continue          # preact and friends are not ours to police
            child = (path.parent / (rel + ".js")).resolve()
            entries.append((child.relative_to(_WWW).as_posix(), child))
    return out


def test_no_lights_file_touches_the_photo_machinery():
    """The rule, enforced across the WHOLE lights path, not just the renderer.

    stack_transform is where map placement, image aspect ratio and the
    measured-photo anchor live. Lights read the metric fabric and nothing
    else. Every one of these files has, at some point in this feature's
    history, reached for a photo and put the map in the wrong place.
    """
    # Walked, not listed. A hardcoded list is how room_color.js joined this
    # path and escaped the rule: the file was new, the list was not updated,
    # and nothing noticed. The graph cannot go stale.
    targets = _lights_import_closure()
    assert len(targets) >= 5, (
        "the import walk found only {} files — it is not following the "
        "graph: {}".format(len(targets), sorted(targets))
    )
    for label, path in sorted(targets.items()):
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


def test_the_run_shape_carries_its_state_and_reads_as_continuous(tmp_path):
    """A strip run is a length of light, and it must look lit or unlit.

    This began as three fat dashes with no body, which read as a dotted border
    rather than a fixture and, having no fill, painted nothing at all when the
    key drew it as an outline. It is now the linear-luminaire symbol: a slim
    continuous rail with end caps, solid so it takes the state colour the same
    way every other shape does.
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
        "out.drawn=/<path d=\"M[^\"]+\"[^>]*fill=\"#fbbf24\"/.test(svg);\n"
        "out.onCol=M.shapeSvg('line',0,0,10,'fill=\"#fbbf24\" stroke=\"#c084fc\"');\n"
        "out.offCol=M.shapeSvg('line',0,0,10,'fill=\"#374151\" stroke=\"#60a5fa\"');\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["drawn"], "no run was drawn for a light with shape=line"
    # State must survive, or an off run looks lit.
    assert 'fill="#fbbf24"' in out["onCol"], out["onCol"]
    assert 'fill="#374151"' in out["offCol"], out["offCol"]
    # Continuous, not a row of gaps.
    assert "stroke-dasharray" not in out["onCol"], out["onCol"]


def test_the_run_fits_the_same_footprint_as_every_other_shape(tmp_path):
    """Cluster packing assumes one width for all shapes."""
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "const out={};\n"
        "const a='fill=\"#fbbf24\" stroke=\"#60a5fa\" stroke-width=\"2\"';\n"
        "const l=M.shapeSvg('line',0,0,10,a);\n"
        "const xs=[...l.matchAll(/[ML]([-0-9.]+),/g)].map(m=>Number(m[1]));\n"
        "out.lineMin=Math.min(...xs); out.lineMax=Math.max(...xs);\n"
        "const b=M.shapeSvg('bar',0,0,10,a);\n"
        "out.barX=Number(/x=\"([-0-9.]+)\"/.exec(b)[1]);\n"
        "out.barW=Number(/width=\"([-0-9.]+)\"/.exec(b)[1]);\n"
        "console.log(JSON.stringify(out));\n"
    ))
    # Same half-width (r * 0.866) as the bar, so clusters pack identically.
    # Both are emitted at one decimal place, so allow one rounding unit.
    assert abs(out["lineMin"] - out["barX"]) < 0.11, (out["lineMin"], out["barX"])
    assert abs((out["lineMax"] - out["lineMin"]) - out["barW"]) < 0.11, out


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


def test_every_control_keeps_its_label():
    """appendChild takes ONE node.

    Grouping the control row with separators was written as
    `appendChild(SEP(), label)`, which silently appends only the separator —
    the Spacing and Zoom captions vanished and the row became a run of
    unlabelled sliders.
    """
    src = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    # Paren-balanced scan: a regex cannot tell `appendChild(el(a, b))` (fine)
    # from `appendChild(a, b)` (broken).
    multi = []
    needle = "appendChild("
    i = src.find(needle)
    while i != -1:
        j = i + len(needle)
        depth, top_comma = 1, False
        while j < len(src) and depth:
            c = src[j]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
            elif c == "," and depth == 1:
                top_comma = True
            j += 1
        if top_comma:
            multi.append(src[i:i + 70].replace(chr(10), " "))
        i = src.find(needle, i + 1)
    assert not multi, (
        "appendChild called with more than one node — everything after the "
        "first argument is silently dropped: {}".format(multi[:3])
    )
    for caption in ('"Floor"', '"Spacing"', '"L / R"', '"Zoom"'):
        assert caption in src, "the {} control lost its label".format(caption)


def test_each_slab_is_sized_to_its_own_floor(tmp_path):
    """A smaller storey draws as a smaller storey.

    Every floor is rendered at the same px/m, so sizing each plate to its own
    rooms is honest — an upper floor really is narrower than the ground it
    sits on. The shared-envelope rule this replaced was a workaround for a
    basement whose imported geometry was nearly twice its true area; that data
    has since been corrected, so all the workaround did was leave every floor
    as an island in a large empty plate.
    """
    model = {
        "room_geometry_m": {
            "Ground": {"type": "poly", "floor_id": "main",
                       "points_m": [[0, 0], [20, 0], [20, 14], [0, 14]]},
            "Attic":  {"type": "poly", "floor_id": "up",
                       "points_m": [[2, 2], [8, 2], [8, 8], [2, 8]]},
        },
        "light_positions_m": {},
    }
    floors = [{"id": "main", "name": "Main", "level": 0},
              {"id": "up", "name": "Upper", "level": 1}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        "const out={};\n"
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,{},false,FLOORS);\n"
        # The slab plate is the dashed outline polygon, one per floor.
        "out.plates=[...svg.matchAll(/<polygon points=\"([^\"]+)\"[^>]*stroke-dasharray/g)]\n"
        "  .map(m=>{const xs=m[1].split(' ').map(p=>Number(p.split(',')[0]));\n"
        "           return Math.max(...xs)-Math.min(...xs);});\n"
        "console.log(JSON.stringify(out));\n"
    ))
    plates = out["plates"]
    assert len(plates) == 2, plates
    small, large = min(plates), max(plates)
    assert large > small * 1.4, (
        "both plates are nearly the same width ({:.0f} vs {:.0f}) — each is "
        "not sized to its own floor".format(small, large)
    )


def test_the_floor_badge_stays_on_the_canvas(tmp_path):
    """A negative L/R offset walks the upper storeys off the left edge.

    The horizontal gap shifts each storey by z x gap, so on the live install
    (four floors, L/R = -60) the top floors' bottom-left corners projected to
    x = -2 and x = 7 — with a radius of 15 that is one badge fully outside the
    frame and another sliced in half. The badge marks the storey; it has to
    stay on the canvas whatever the slab geometry does.
    """
    sq = [[0, 0], [16, 0], [16, 12], [0, 12]]
    model = {
        "room_geometry_m": {
            k: {"type": "poly", "floor_id": "f%d" % i, "points_m": sq}
            for i, k in enumerate("ABCD")
        },
        "light_positions_m": {},
    }
    floors = [{"id": "f%d" % i, "name": "F%d" % i, "level": i} for i in range(4)]
    # The regex uses . where a double quote belongs, so the JS carries no
    # quotes that would need escaping through two layers of string literal.
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';" + chr(10) +
        "const MODEL=" + json.dumps(model) + ";" + chr(10) +
        "const FLOORS=" + json.dumps(floors) + ";" + chr(10) +
        "const out={};" + chr(10) +
        # 230 / -60 are the view settings the install actually runs.
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,230,-60,{},false,FLOORS);" + chr(10) +
        "out.badges=[...svg.matchAll(/<circle cx=.([-0-9.]+).[^>]*r=.15./g)]" + chr(10) +
        "  .map(m=>Number(m[1]));" + chr(10) +
        "console.log(JSON.stringify(out));" + chr(10)
    ))
    assert len(out["badges"]) == 4, out["badges"]
    for x in out["badges"]:
        assert 15 <= x <= 745, (
            "a floor badge is drawn off the canvas at x={} — badges are r=15, "
            "so anything under 15 is clipped: {}".format(x, out["badges"])
        )


# ── The shape vocabulary, front to back ─────────────────────────────────────

_WS_PY = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "const.py"


def _chooser_kinds() -> set:
    src = (_VIEWS / "light_codes.js").read_text(encoding="utf-8")
    block = src[src.index("export const LIGHT_SHAPES"):]
    block = block[:block.index("];")]
    # "auto" is the absence of an override, so it is never stored.
    return {m for m in re.findall(r'\["(\w+)"', block)} - {"auto"}


def _backend_kinds() -> set:
    src = _WS_PY.read_text(encoding="utf-8")
    block = src[src.index("LIGHT_SHAPE_KINDS = frozenset({"):]
    block = block[:block.index("})") + 2]
    return set(re.findall(r'"(\w+)"', block))


def test_the_backend_accepts_every_shape_the_chooser_offers():
    """This is the whole "choosing dotted line fails" bug.

    The chooser offered "Dotted line / run", the settings command took it, and
    the backend's whitelist — a hand-maintained copy of the frontend list —
    dropped it on the floor. Nothing errored: the setting simply came back
    without the entity, so the shape snapped to Auto and the option looked
    broken. Any shape added to one side and not the other fails silently the
    same way, so the two lists are asserted equal rather than merely
    overlapping.
    """
    assert _chooser_kinds() == _backend_kinds(), (
        "LIGHT_SHAPES and _LIGHT_SHAPE_KINDS disagree; a shape only one side "
        "knows about is silently discarded on save. Chooser only: {} / "
        "backend only: {}".format(
            sorted(_chooser_kinds() - _backend_kinds()),
            sorted(_backend_kinds() - _chooser_kinds()),
        )
    )


def test_a_spotlight_does_not_derive_as_a_pot_light(tmp_path):
    """Every fixture name that has to land on a particular symbol.

    "spot" contains "pot", and the pot rule matched on a substring, so every
    spotlight in the house derived as a recessed downlight.
    """
    out = _run_js(tmp_path, (
        "import { deriveLightShape } from './light_codes.mjs';\n"
        "const n=(s)=>deriveLightShape({entity_id:'light.x',friendly_name:s});\n"
        "console.log(JSON.stringify({\n"
        "  spot:n('Loft Spotlight'), flood:n('Yard Flood'),\n"
        "  pot:n('Kitchen Pot Lights'), fan:n('Office Ceiling Fan'),\n"
        "  pendant:n('Dining Pendant'), sconce:n('Hall Wall Sconce'),\n"
        "  chandelier:n('Entry Chandelier'), track:n('Stair Track Lighting'),\n"
        "}));\n"
    ))
    assert out["spot"] == "triangle", out
    assert out["flood"] == "triangle", out
    assert out["pot"] == "circle", out
    assert out["fan"] == "fan", out
    assert out["pendant"] == "pendant", out
    assert out["sconce"] == "sconce", out
    assert out["chandelier"] == "chandelier", out
    # A track IS a run of light, which the dashed line already says.
    assert out["track"] == "line", out


def test_every_shape_is_visible_as_an_outline(tmp_path):
    """The key and the index table draw shapes with fill="none".

    The dotted line took its colour from the fill, so in both of those places
    it painted nothing at all — the one shape you could not see was the one
    that looked broken when you chose it.
    """
    kinds = sorted(_chooser_kinds())
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "const KINDS=" + json.dumps(kinds) + ";\n"
        "const out={};\n"
        "for(const k of KINDS) out[k]=M.shapeSvg(k,9,9,6.5,"
        "'fill=\"none\" stroke=\"#94a3b8\" stroke-width=\"1.6\"');\n"
        "console.log(JSON.stringify(out));\n"
    ))
    for k in kinds:
        assert re.search(r'(stroke|fill)="#', out[k]), (
            "shape {!r} paints nothing when drawn as an outline: {}".format(k, out[k])
        )


def test_the_dotted_line_can_still_be_clicked(tmp_path):
    """Only the dashes were painted, so only the dashes were hittable."""
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "const s=M.shapeSvg('line',0,0,10,'fill=\"#fbbf24\" stroke=\"#60a5fa\"');\n"
        "console.log(JSON.stringify({s:s, w:Number(/width=\"([0-9.]+)\"/.exec(s)[1])}));\n"
    ))
    assert 'data-hit="1"' in out["s"], out["s"]
    # The plate is the full marker width, so the run is as easy to grab as any
    # other fixture.
    assert abs(out["w"] - 2 * 10 * 0.866) < 0.11, out


# ── Room-perimeter shape ──────────────────────────────────────────────────────

def test_offset_polygon_inward_shrinks_a_square_correctly(tmp_path):
    """Pure geometry, no fabric involved — proves the offset math directly
    against a synthetic square rather than through a rendered path string."""
    out = _run_js(tmp_path, (
        "import { offsetPolygonInward, roomHalfMinDim } from './iso_lights.mjs';\n"
        "const sq=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const rnd=(pts)=>pts.map(p=>[Math.round(p[0]*1e6)/1e6, Math.round(p[1]*1e6)/1e6]);\n"
        "const out={};\n"
        "out.half=roomHalfMinDim(sq);\n"
        "out.zero=offsetPolygonInward(sq,0);\n"
        "out.inset=rnd(offsetPolygonInward(sq,2));\n"
        "const rect=[[0,0],[20,0],[20,6],[0,6]];\n"
        "out.rectHalf=roomHalfMinDim(rect);\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["half"] == 5, "a 10x10 square's half-min-dimension is 5"
    assert out["zero"] == [[0, 0], [10, 0], [10, 10], [0, 10]], "marginM=0 must not move a single point"
    # Exact corners, in order: each new vertex is the intersection of the two
    # adjacent edges after both are pushed 2 units toward the centroid.
    assert out["inset"] == [[2, 2], [8, 2], [8, 8], [2, 8]], out["inset"]
    assert out["rectHalf"] == 3, "a 20x6 rectangle's half-min-dimension is 3"


# The real 9-vertex "Bedroom" room from Garry's own house (main floor) —
# L-shaped, and it closes with two vertices only 3.6cm apart ((0.469,5.296)
# vs (0.505,5.296)), which is how real hand-traced rooms come out. That
# near-degenerate pair drew a visible stray "tail" on the offset trace until
# near-coincident vertices were collapsed before offsetting.
_BEDROOM = [[0.469,5.296],[5.755,5.296],[5.746,6.937],[4.944,6.974],[4.953,12.093],
            [2.892,12.056],[2.902,10.498],[0.478,10.49],[0.505,5.296]]


def test_offset_polygon_collapses_near_coincident_vertices_no_tail(tmp_path):
    out = _run_js(tmp_path, (
        "import { offsetPolygonInward } from './iso_lights.mjs';\n"
        f"const room={json.dumps(_BEDROOM)};\n"
        "const inset=offsetPolygonInward(room, 0.3);\n"
        "const segLens=inset.map((p,i)=>{const q=inset[(i+1)%inset.length];"
        "return Math.hypot(q[0]-p[0], q[1]-p[1]);});\n"
        "console.log(JSON.stringify({n: inset.length, segLens}));\n"
    ))
    # The 3.6cm closing pair collapses to one vertex: 9 in, 8 out.
    assert out["n"] == 8, out
    # And no sliver edges survive anywhere — every drawn segment of the trace
    # is a real wall's worth of line, not a phantom tail stub.
    assert min(out["segLens"]) > 0.25, out["segLens"]


# The real 11-vertex "North Suite" room from Garry's own house (basement
# floor) — pulled live via padspan_ha/model_get during the investigation of
# "doesn't follow the room boundary at all" (2026-09-02). Its last vertex is a
# near-degenerate kink (edge 10->0 is only ~3cm long, barely off the line of
# the long edge before it) — offsetting a 14cm margin there without a miter
# limit shot the reconstructed vertex out to 0.493m, nearly 3.5x requested.
_NORTH_SUITE = [[3.127,-9.19],[10.133,-9.163],[10.15,0.978],[6,0.932],[6.015,1.079],
                [2.016,1.063],[2.046,-2.908],[1.143,-2.865],[1.129,-7.994],[3.127,-7.978],[3.144,-9.163]]


def test_offset_polygon_inward_caps_a_sharp_corner_miter(tmp_path):
    """The real room that exposed the bug: without a miter limit, the
    near-degenerate last vertex overshot to ~0.49m on a 0.14m request. Its
    ~3.2cm closing pair now ALSO collapses in the dedupe pass (10 vertices
    out of 11), which removes that specific spike at the source — the miter
    limit stays as the guard for genuinely acute corners, and this asserts
    the combination: nothing anywhere strays past the limit."""
    out = _run_js(tmp_path, (
        "import { offsetPolygonInward } from './iso_lights.mjs';\n"
        f"const room={json.dumps(_NORTH_SUITE)};\n"
        "const inset=offsetPolygonInward(room, 0.14);\n"
        "const near=inset.map(p=>Math.min(...room.map(q=>Math.hypot(p[0]-q[0], p[1]-q[1]))));\n"
        "console.log(JSON.stringify({n: inset.length, near}));\n"
    ))
    assert out["n"] == 10, out
    near = out["near"]
    assert max(near) < 0.14 * 2.5 + 1e-6, f"a vertex strayed past the miter limit from every wall: {near}"
    # Not flattened into meaninglessness either — most vertices still land
    # close to the requested margin from their nearest source corner.
    assert sum(1 for x in near if 0.10 < x < 0.25) >= 9, near


def test_default_perimeter_margin_is_scale_aware_not_a_flat_cm_value(tmp_path):
    """The actual bug: a flat 15cm default rendered as 4-7px on Garry's real
    house (frame.scale~26 px/m) — indistinguishable from the room's own
    outline stroke. The default must scale so the ON-SCREEN gap stays
    roughly constant across houses of very different sizes/zoom."""
    out = _run_js(tmp_path, (
        "import { defaultPerimeterMarginM } from './iso_lights.mjs';\n"
        "const small={scale: 80};\n"    # a small room/apartment, zoomed in
        "const big={scale: 26.4};\n"    # Garry's real observed scale
        "const out={};\n"
        "out.small=defaultPerimeterMarginM(small);\n"
        "out.big=defaultPerimeterMarginM(big);\n"
        "out.smallPx=out.small*small.scale;\n"
        "out.bigPx=out.big*big.scale;\n"
        "console.log(JSON.stringify(out));\n"
    ))
    # A bigger house (lower px/m) gets a bigger real-world default margin...
    assert out["big"] > out["small"], out
    # ...but capped at a physically plausible cove offset: uncapped, the pixel
    # target computed 0.6m for Garry's real house, which collapsed the narrow
    # 1.57m arm of his L-shaped Bedroom into slivers ("weird square in the
    # middle"). 0.3m is the ceiling — real coves don't sit further off a wall.
    assert out["big"] == 0.3, out
    # The small/zoomed-in house still gets the true pixel target (under the cap)...
    assert abs(out["smallPx"] - 16) < 0.5, out
    # ...and even the capped big-house default stays visibly clear of the
    # room's own outline stroke, unlike the original flat 15cm (4-7px there).
    assert out["bigPx"] > 6, out


_PERIM_MODEL = {
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
    },
    "light_positions_m": {
        "light.cove":    {"x_m": 3.0, "y_m": 2.0, "floor_id": "main", "color": "#22c55e", "margin_cm": 50},
        "light.zero":    {"x_m": 3.0, "y_m": 2.0, "floor_id": "main", "color": "#22c55e", "margin_cm": 0},
        "light.huge":    {"x_m": 3.0, "y_m": 2.0, "floor_id": "main", "color": "#22c55e", "margin_cm": 100000},
        "light.off":     {"x_m": 3.0, "y_m": 2.0, "floor_id": "main", "color": "#22c55e", "margin_cm": 50},
        "light.circle":  {"x_m": 1.0, "y_m": 1.0, "floor_id": "main", "color": "#22c55e"},
        "light.outside": {"x_m": 50.0, "y_m": 50.0, "floor_id": "main", "color": "#22c55e", "margin_cm": 50},
    },
}
_PERIM_FLOORS = [{"id": "main", "name": "Main", "level": 0}]
_PERIM_LBE = {
    "light.cove":    {"entity_id": "light.cove",    "state": "on",  "code": "P01", "shape": "perimeter"},
    "light.zero":    {"entity_id": "light.zero",    "state": "on",  "code": "P02", "shape": "perimeter"},
    "light.huge":    {"entity_id": "light.huge",    "state": "on",  "code": "P03", "shape": "perimeter"},
    "light.off":     {"entity_id": "light.off",     "state": "off", "code": "P04", "shape": "perimeter"},
    "light.circle":  {"entity_id": "light.circle",  "state": "on",  "code": "A01", "shape": "circle"},
    "light.outside": {"entity_id": "light.outside", "state": "on",  "code": "P05", "shape": "perimeter"},
    # Never dragged onto the map — no entry in light_positions_m at all, only
    # a room via HA area assignment, same shape every gatherLights() output
    # carries for a light nobody has placed yet. This is the exact scenario
    # that shipped broken: real bug (Garry, 2026-09-02), root cause was
    # perimeterSvg only ever being called from the PLACED-lights loop.
    "light.unplaced": {"entity_id": "light.unplaced", "state": "on", "code": "P06", "shape": "perimeter"},
}
_PERIM_BYROOM = {"Kitchen": [_PERIM_LBE["light.unplaced"]]}


def _perim_bbox(pts_attr: str) -> tuple[float, float, float, float]:
    """points='x1,y1 x2,y2 ...' -> (x0,y0,x1,y1) bounding box."""
    xs, ys = [], []
    for pair in pts_attr.strip().split():
        x, y = pair.split(",")
        xs.append(float(x)); ys.append(float(y))
    return min(xs), min(ys), max(xs), max(ys)


def test_perimeter_shape(tmp_path):
    """One rendered house, every case checked against its own tagged trace
    (data-eid on the perimeter polygon — added so this test could disambiguate
    six lights in one SVG, since nothing else in the output names which
    fixture a given room-boundary polygon belongs to)."""
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(_PERIM_MODEL)};\n"
        f"const FLOORS={json.dumps(_PERIM_FLOORS)};\n"
        f"const LBE={json.dumps(_PERIM_LBE)};\n"
        f"const BYROOM={json.dumps(_PERIM_BYROOM)};\n"
        "const mk=(o)=>M.buildIsoSVG(MODEL,BYROOM,new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        "const work=mk({}), show=mk({showcase:true});\n"
        "const out={};\n"
        "const traces=(svg,eid)=>[...svg.matchAll(\n"
        "  new RegExp('<polygon data-eid=\"'+eid.replace('.','\\\\.')+'\" points=\"([^\"]+)\"[^>]*'\n"
        "    +'stroke-width=\"([0-9.]+)\"[^>]*opacity=\"([0-9.]+)\"([^>]*)/>','g'))]\n"
        "  .map(m=>({pts:m[1], sw:Number(m[2]), op:Number(m[3]), soft:m[4].includes('psclipsoft')}));\n"
        "const roomFillPts=/<polygon points=\"([^\"]+)\" fill=\"[^\"]*\" fill-opacity=\"0\\.16\"/.exec(work)[1];\n"
        "out.roomFillPts=roomFillPts;\n"
        "out.zeroWork=traces(work,'light.zero');\n"
        "out.coveWork=traces(work,'light.cove');\n"
        "out.coveShow=traces(show,'light.cove');\n"
        "out.hugeWork=traces(work,'light.huge');\n"
        "out.offWork=traces(work,'light.off');\n"
        "out.circleWork=traces(work,'light.circle');\n"
        "out.outsideWork=traces(work,'light.outside');\n"
        "out.unplacedWork=traces(work,'light.unplaced');\n"
        "console.log(JSON.stringify(out));\n"
    ))

    # The actual reported bug: a light that has never been dragged onto the
    # map (no light_positions_m entry, only a room via HA area) must still
    # trace that room's boundary — at the 15cm default, since there is no
    # placement entry to hold a custom margin. Before the fix this list was
    # empty because perimeterSvg was never called from the auto-cluster path.
    assert len(out["unplacedWork"]) == 1, "an unplaced perimeter light drew no trace at all"
    assert out["unplacedWork"][0]["pts"] != out["roomFillPts"], \
        "should be inset by the 15cm default, not sitting exactly on the room's own outline"

    # Zero margin: literally the room's own outline, not the 15cm fallback.
    # This is the exact bug caught in review — `x || 15` would have failed it.
    assert len(out["zeroWork"]) == 1
    assert out["zeroWork"][0]["pts"] == out["roomFillPts"], "margin=0 must equal the room's own outline exactly"

    # A real margin (50cm) genuinely shrinks the box on every side.
    assert len(out["coveWork"]) == 1
    rx0, ry0, rx1, ry1 = _perim_bbox(out["roomFillPts"])
    cx0, cy0, cx1, cy1 = _perim_bbox(out["coveWork"][0]["pts"])
    assert cx0 > rx0 and cy0 > ry0 and cx1 < rx1 and cy1 < ry1, (out["roomFillPts"], out["coveWork"])

    # An absurd margin (1000m in a 6x4m room) clamps to a safe fraction of the
    # room's own half-min-dimension. An unclamped offset doesn't collapse to
    # zero area here (line-intersection reconstruction just keeps going) —
    # it balloons the box to roughly 1994x1996 SVG units, far outside the
    # room, which is the actual, specific failure mode a missing clamp
    # produces and the one this checks for (a bare "positive area" assertion
    # passed against the unclamped code path — caught in review by mutation
    # testing, which is why this checks containment instead).
    assert len(out["hugeWork"]) == 1
    hx0, hy0, hx1, hy1 = _perim_bbox(out["hugeWork"][0]["pts"])
    assert hx1 > hx0 and hy1 > hy0, "an oversized margin inverted the traced polygon"
    pad = 2.0  # stroke width and float slop, in the same SVG-px units
    assert hx0 >= rx0 - pad and hy0 >= ry0 - pad and hx1 <= rx1 + pad and hy1 <= ry1 + pad, \
        ("a clamped trace must stay inside the room; got", (hx0, hy0, hx1, hy1), "room", (rx0, ry0, rx1, ry1))

    # Structural shape, not a Showcase presentation effect: it draws in the
    # WORKING map too, dimmer when the light is off (never invisible).
    assert len(out["offWork"]) == 1
    assert out["offWork"][0]["op"] < out["zeroWork"][0]["op"]

    # Showcase adds a soft glow duplicate under the crisp line for a LIT
    # fixture — two tagged polygons, the first wider and fainter.
    assert len(out["coveShow"]) == 2, out["coveShow"]
    assert out["coveShow"][0]["sw"] > out["coveShow"][1]["sw"]
    assert out["coveShow"][0]["op"] < out["coveShow"][1]["op"]
    assert out["coveShow"][0]["soft"] and not out["coveShow"][1]["soft"], out["coveShow"]

    # A non-perimeter shape and a light outside every room draw no trace.
    assert out["circleWork"] == []
    assert out["outsideWork"] == []


def test_perimeter_marker_hides_the_square_keeps_click_space_and_glow(tmp_path):
    """Garry's spec, verbatim: "Keep the glow, and the click space of the
    square, but hide the square." The marker group survives with its full
    lhex/data-eid/data-cx/cy contract and a transparent rect the exact size
    the square glyph had; no visible body; the Showcase pool still glows."""
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(_PERIM_MODEL)};\n"
        f"const FLOORS={json.dumps(_PERIM_FLOORS)};\n"
        f"const LBE={json.dumps(_PERIM_LBE)};\n"
        f"const BYROOM={json.dumps(_PERIM_BYROOM)};\n"
        "const show=M.buildIsoSVG(MODEL,BYROOM,new Set(),null,150,0,LBE,false,FLOORS,{showcase:true});\n"
        "const g=/<g class=\"lhex\" data-eid=\"light\\.cove\"[^>]*>([\\s\\S]*?)<\\/g>/.exec(show);\n"
        "const out={found:!!g};\n"
        "if(g){\n"
        "  out.hasHitRect=/<rect data-hit=\"1\"[^>]*fill=\"transparent\"/.test(g[1]);\n"
        "  out.hasCode=/>P01</.test(g[1]);\n"
        "  out.hasVisibleBody=/<(rect(?! data-hit)|polygon|circle|path)[^>]*fill=\"(?!transparent|none)/.test(g[1]);\n"
        "  out.hasAnchor=/data-cx=\"[0-9.-]+\" data-cy=\"[0-9.-]+\"/.test(g[0]);\n"
        "}\n"
        "out.poolGlows=/<ellipse[^>]*fill=\"url\\(#psglow_/.test(show);\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["found"], "the perimeter light lost its lhex marker group entirely"
    assert out["hasHitRect"], "the square's click space is gone"
    assert out["hasCode"], "the code label is gone"
    assert not out["hasVisibleBody"], "the square is still visibly drawn"
    assert out["hasAnchor"], "the drag anchor contract broke"
    assert out["poolGlows"], "the Showcase glow was lost"


# ── Showcase ────────────────────────────────────────────────────────────────

_SHOWCASE_MODEL = {
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main",
                    "points_m": [[0, 0], [10, 0], [10, 8], [0, 8]]},
    },
    "light_positions_m": {
        "light.lit": {"x_m": 3.0, "y_m": 4.0, "floor_id": "main", "color": "#fbbf24"},
        "light.dark": {"x_m": 7.0, "y_m": 4.0, "floor_id": "main", "color": "#fbbf24"},
    },
}
_SHOWCASE_FLOORS = [{"id": "main", "name": "Main", "level": 0}]
_SHOWCASE_LBE = {
    "light.lit": {"entity_id": "light.lit", "state": "on", "code": "A01",
                  "shape": "circle", "isWled": False, "rgb": [16, 240, 128], "bri": 255},
    "light.dark": {"entity_id": "light.dark", "state": "off", "code": "A02",
                   "shape": "circle", "isWled": False, "rgb": None, "bri": None},
}


def _showcase(tmp_path, extra):
    return _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "const MODEL=" + json.dumps(_SHOWCASE_MODEL) + ";\n"
        "const FLOORS=" + json.dumps(_SHOWCASE_FLOORS) + ";\n"
        "const LBE=" + json.dumps(_SHOWCASE_LBE) + ";\n"
        "const mk=(o)=>M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        "const out={};\n" + extra + "console.log(JSON.stringify(out));\n"
    ))


def test_showcase_pools_a_lit_fixture_in_its_own_colour(tmp_path):
    """The point of the mode: what is lit, and what colour it is throwing."""
    out = _showcase(tmp_path, (
        "const on=mk({showcase:true}), off=mk({});\n"
        "const g=/<radialGradient id=.(psglow_\\d+)./.exec(on);\n"
        "out.grad=g?g[1]:null;\n"
        "const st=/<radialGradient id=.psglow_0.><stop[^>]*stop-color=.([#0-9a-f]+)./.exec(on);\n"
        "out.stop=st?st[1]:null;\n"
        "out.used=out.grad?on.includes('url(#'+out.grad+')'):false;\n"
        "out.offHasGlow=off.includes('psglow_');\n"
        "out.blend=on.includes('mix-blend-mode:screen');\n"
    ))
    assert out["grad"], "Showcase drew no light pool at all"
    assert out["used"], "the pool gradient is defined but never referenced"
    # The light reports rgb 16,240,128; channels are quantised so the map keeps
    # one gradient per colour rather than one per fixture.
    assert out["stop"] == "#18f078", out["stop"]
    assert out["blend"], "overlapping pools must add, not stack as opaque discs"
    assert not out["offHasGlow"], "the working map must be left exactly as it was"


def test_showcase_moves_the_code_off_the_marker_and_keeps_the_drag_anchor(tmp_path):
    """The label is as wide as the marker, so on top of it nothing shows.

    Moving it below is only safe because the drag anchor comes from data-cx/cy;
    it used to be read off the label's own x/y, and every drag in this mode
    would have landed high by the offset between them.
    """
    out = _showcase(tmp_path, (
        "for(const kv of [['show',{showcase:true}],['work',{}]]){\n"
        "  const svg=mk(kv[1]);\n"
        "  const g=svg.split('data-placed=\"1\"')[1];\n"
        "  out[kv[0]]={cx:Number(/data-cx=\"([-0-9.]+)\"/.exec(svg)[1]),\n"
        "          cy:Number(/data-cy=\"([-0-9.]+)\"/.exec(svg)[1]),\n"
        "          ty:Number(/<text x=\"[-0-9.]+\" y=\"([-0-9.]+)\"/.exec(g)[1])};\n"
        "}\n"
    ))
    # Working mode is unchanged: the code sits on the fixture's centre.
    assert abs(out["work"]["ty"] - out["work"]["cy"]) < 0.2, out["work"]
    # Showcase drops it clear of the glyph, and the anchor stays on the centre.
    assert out["show"]["ty"] > out["show"]["cy"] + 5, out["show"]
    assert abs(out["show"]["cx"] - out["work"]["cx"]) < 0.2, out
    assert abs(out["show"]["cy"] - out["work"]["cy"]) < 0.2, out


def test_showcase_pool_physics_kelvin_clip_beam_breathe(tmp_path):
    """The four pool behaviours added together, each pinned by what it changes.

    Kelvin: a white-only bulb (no rgb, color_temp 2700K) must pool WARM, not
    the default amber — kelvinRGB(2700)=[255,167,87], quantised #ffa860.
    Clip: a placed fixture inside a room polygon has its pool clipped to that
    room's clipPath, so light stops at the walls.
    Beam: a spot (triangle) throws AHEAD of the glyph — its pool ellipse is
    offset off-centre — and tighter than a downlight's.
    Breathe: pools carry a slow opacity animation; the working map carries
    none of this.
    """
    out = _showcase(tmp_path, (
        "const LBE2=JSON.parse(JSON.stringify(LBE));\n"
        "LBE2['light.lit'].rgb=null; LBE2['light.lit'].ct=2700;\n"
        "const warm=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE2,false,FLOORS,{showcase:true});\n"
        "const st=/<radialGradient id=.psglow_0.><stop[^>]*stop-color=.([#0-9a-f]+)./.exec(warm);\n"
        "out.kelvinStop=st?st[1]:null;\n"
        "const on=mk({showcase:true});\n"
        "out.hasClipDef=/<clipPath id=\"psclip_0\"><polygon /.test(on);\n"
        "out.poolClipped=/<g clip-path=\"url\\(#psclip_0\\)\">/.test(on);\n"
        "out.breathes=/<ellipse[^>]*fill=\"url\\(#psglow_0\\)\"[^>]*><animate attributeName=\"opacity\"/.test(on);\n"
        "const LBE3=JSON.parse(JSON.stringify(LBE));\n"
        "LBE3['light.lit'].shape='triangle';\n"
        "const spot=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE3,false,FLOORS,{showcase:true});\n"
        "const cyOf=(s)=>{const m=/fill=\"url\\(#psglow_0\\)\"/.exec(s); const e=/<ellipse cx=\"0\" cy=\"([-0-9.]+)\"[^>]*fill=\"url\\(#psglow_0\\)\"/.exec(s); return e?Number(e[1]):null;};\n"
        "const rxOf=(s)=>{const e=/<ellipse cx=\"0\" cy=\"[-0-9.]+\" rx=\"([0-9.]+)\"[^>]*fill=\"url\\(#psglow_0\\)\"/.exec(s); return e?Number(e[1]):null;};\n"
        "out.downCy=cyOf(on); out.spotCy=cyOf(spot);\n"
        "out.downRx=rxOf(on); out.spotRx=rxOf(spot);\n"
        "out.workInert=!/psclip_|<animate attributeName=\"opacity\" values=/.test(mk({}));\n"
    ))
    assert out["kelvinStop"] == "#ffa860", out["kelvinStop"]
    assert out["hasClipDef"], "no room clipPath was defined"
    assert out["poolClipped"], "the pool inside the Kitchen was not clipped to it"
    assert out["breathes"], "pools no longer carry the breathing animation"
    assert out["downCy"] == 0, out["downCy"]
    assert out["spotCy"] is not None and out["spotCy"] < -1, out["spotCy"]
    assert out["spotRx"] is not None and out["downRx"] is not None and out["spotRx"] < out["downRx"], (out["spotRx"], out["downRx"])
    assert out["workInert"], "the working map picked up Showcase-only effects"


def test_showcase_ambient_scene_spill_isolux(tmp_path):
    """The presentation extensions land together; each asserts its own tell.

    Ambient: full day lifts the ground to the mixed tone and mutes pools.
    Scene field: pools take the field's colour at their own metres, so two
    lit fixtures at opposite ends of the room draw DIFFERENT gradients.
    Wall spill: a fixture within pool reach of a wall strokes that wall in
    its own colour; one in the middle of the room strokes nothing.
    Isolux: contour paths render only when asked, in Showcase.
    sceneColours: apply-side colours come from the same sampler — the two
    ends of the field resolve to (near) the end stops.
    """
    out = _showcase(tmp_path, (
        # Both fixtures lit so the scene has two samples; one near the left wall.
        "const LBE2=JSON.parse(JSON.stringify(LBE));\n"
        "LBE2['light.dark'].state='on'; LBE2['light.dark'].rgb=[16,240,128]; LBE2['light.dark'].bri=255;\n"
        "const MODEL2=JSON.parse(JSON.stringify(MODEL));\n"
        "MODEL2.light_positions_m['light.lit'].x_m=0.8;\n"
        "const mk2=(o)=>M.buildIsoSVG(MODEL2,{},new Set(),null,150,0,LBE2,false,FLOORS,o);\n"
        "const night=mk2({showcase:true}), day=mk2({showcase:true, ambient:1});\n"
        "out.nightBase=/<rect[^>]*fill=\"(#[0-9a-f]{6})\"/.exec(night)[1];\n"
        "out.dayBase=/<rect[^>]*fill=\"(#[0-9a-f]{6})\"/.exec(day)[1];\n"
        "const opOf=(s)=>Number(/<ellipse[^>]*fill=\"url\\(#psglow_0\\)\"[^>]*opacity=\"([0-9.]+)\"/.exec(s)[1]);\n"
        "out.nightOp=opOf(night); out.dayOp=opOf(day);\n"
        "out.spillNear=/<line[^>]*stroke=\"#18f078\"/.test(night);\n"
        "const centre=mk({showcase:true});\n"
        "out.spillCentre=/<line[^>]*stroke=\"#18f078\"/.test(centre);\n"
        "const FIELD={stops:[[240,24,24],[24,24,240]], angleDeg:0};\n"
        "const scene=mk2({showcase:true, sceneField:FIELD});\n"
        "out.sceneGrads=new Set(scene.match(/fill=\"url\\(#psglow_\\d+\\)\"/g)||[]).size;\n"
        "out.iso=/<path d=\"M[^\"]+\" fill=\"none\" stroke=\"#9fe3bd\"/.test(mk2({showcase:true, isolux:true}));\n"
        "out.isoOff=/stroke=\"#9fe3bd\"/.test(night);\n"
        "const cols=M.sceneColours(MODEL2,FLOORS,{},LBE2,new Set(),FIELD);\n"
        "out.colA=cols.find(c=>c.eid==='light.lit').rgb; out.colB=cols.find(c=>c.eid==='light.dark').rgb;\n"
    ))
    assert out["nightBase"] == "#071008" and out["dayBase"] == "#22301f", (out["nightBase"], out["dayBase"])
    assert out["dayOp"] < out["nightOp"] * 0.6, (out["dayOp"], out["nightOp"])
    assert out["spillNear"], "a fixture 0.8m from the wall painted no spill on it"
    assert not out["spillCentre"], "a fixture in the middle of a 10m room spilled on a wall"
    assert out["sceneGrads"] >= 2, "two fixtures across the field POOLED the same colour — the field is not reaching the pools"
    assert out["iso"], "isolux contours missing when asked"
    assert not out["isoOff"], "isolux contours drawn without the toggle"
    # Apply side: the fixture at x=0.8 sits near the red end, x=7 near the blue.
    assert out["colA"][0] > 180 and out["colA"][2] < 100, out["colA"]
    assert out["colB"][2] > 150 and out["colB"][0] < 120, out["colB"]


def test_moving_a_light_does_not_count_as_touching_it(tmp_path):
    """"Hide untouched" shows the fixtures that have been WORKED ON.

    Dropping a light where it really is is the baseline act of building the
    map — on a finished house nearly every light has been dropped — so if a
    move counted as work the filter would hide nothing and be pointless.
    Work means the fixture was described: sized, angled, recoloured, or given
    a shape of its own. The default amber stamped on every drop is not a
    colour choice.
    """
    # The rule lives in the SHARED module, so the builder and the sidebar
    # cannot disagree about what "touched" means.
    src = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    body = src[src.index("const _DROP_COLOR"):]
    body = body[:body.index("// Legend for the shape vocabulary")]
    out = _run_js(tmp_path, (
        body + "\n"
        "const T=(over,pl)=>lightIsTouched({entity_id:'light.x'},over,pl);\n"
        "console.log(JSON.stringify({\n"
        "  never:      T({}, {}),\n"
        "  movedOnly:  T({}, {'light.x':{x_m:1,y_m:2,floor_id:'main'}}),\n"
        "  movedAmber: T({}, {'light.x':{x_m:1,y_m:2,color:'#fbbf24',"
        "width_cm:0,height_cm:0,rotation:0}}),\n"
        "  sized:      T({}, {'light.x':{x_m:1,y_m:2,width_cm:240}}),\n"
        "  tall:       T({}, {'light.x':{x_m:1,y_m:2,height_cm:8}}),\n"
        "  rotated:    T({}, {'light.x':{x_m:1,y_m:2,rotation:30}}),\n"
        "  recoloured: T({}, {'light.x':{x_m:1,y_m:2,color:'#ff00aa'}}),\n"
        "  shaped:     T({'light.x':'bar'}, {}),\n"
        "}));\n"
    ))
    # Not touched: never placed, dropped, or dropped with the default stamp.
    assert out["never"] is False, out
    assert out["movedOnly"] is False, out
    assert out["movedAmber"] is False, (
        "the amber colour and the zeroes stamped on every drop are not work"
    )
    # Touched: the fixture was actually described.
    assert out["sized"] is True, out
    assert out["tall"] is True, out
    assert out["rotated"] is True, out
    assert out["recoloured"] is True, out
    assert out["shaped"] is True, out


def test_fit_to_room_caps_an_oversized_fixture_and_leaves_a_gap(tmp_path):
    """A centimetre typed with one zero too many draws across the house.

    The cap is the room's own extent less a margin, so a fixture that fills its
    room still stops short of the walls. It is a DRAWING constraint: the stored
    width_cm is never rewritten, so turning it off restores what was typed.
    """
    model = {
        "room_geometry_m": {
            "Laundry": {"type": "poly", "floor_id": "main",
                        "points_m": [[0, 0], [3, 0], [3, 2], [0, 2]]},
        },
        # 24 m of valance in a 3 x 2 m laundry — a mis-typed 240 cm.
        "light_positions_m": {
            "light.run": {"x_m": 1.5, "y_m": 1.0, "floor_id": "main",
                          "width_cm": 2400, "height_cm": 6},
        },
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    lbe = {"light.run": {"entity_id": "light.run", "state": "on", "code": "W01",
                         "shape": "bar", "isWled": True, "rgb": None, "bri": 255}}
    by_room = {}   # no HA area assignment anywhere — like the real house
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "const MODEL=" + json.dumps(model) + ";\n"
        "const FLOORS=" + json.dumps(floors) + ";\n"
        "const LBE=" + json.dumps(lbe) + ";\n"
        "const BY=" + json.dumps(by_room) + ";\n"
        "const f=M.fabricFrame(MODEL,FLOORS,150,0);\n"
        "const mk=(o)=>M.buildIsoSVG(MODEL,BY,new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        "const sx=(svg)=>{const g=svg.split('data-placed=\"1\"')[1];\n"
        "  const m=/scale\\(([0-9.]+),([0-9.]+)\\)/.exec(g); return m?[Number(m[1]),Number(m[2])]:null;};\n"
        "const out={scale:f.scale,\n"
        "  free:sx(mk({showcase:true})),\n"
        "  fit:sx(mk({showcase:true,fitRooms:true}))};\n"
        "console.log(JSON.stringify(out));\n"
    ))
    scale = out["scale"]
    # markerScale turns centimetres into a multiple of the default marker; the
    # drawn half-width in metres is what has to fit the room.
    free_m = out["free"][0] * (2 * 0.866 * 5) / scale   # marker base width, metres
    fit_m = out["fit"][0] * (2 * 0.866 * 5) / scale
    assert out["free"][0] > out["fit"][0], (
        "Fit to room did not shrink a 24 m fixture in a 3 m room: %r" % (out,)
    )
    # It must end up inside the 3 m room, and NOT touching the walls.
    assert fit_m < 3.0, ("still wider than the room", fit_m, out)
    assert fit_m <= 2.75, ("no margin was left between the fixture and the "
                           "walls", fit_m, out)
    # ...and the unconstrained draw really was oversized, or the test proves
    # nothing about the cap.
    assert free_m > 3.0, ("the unconstrained fixture was not oversized to "
                          "begin with", free_m, out)
