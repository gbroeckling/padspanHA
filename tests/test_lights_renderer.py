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


def test_room_shapes_carry_a_soft_centre_glow_like_the_light_pools(tmp_path):
    """Garry: "That cool look you have inside the shape [the light pool]...
    can the shape that is built by the room shape also have some of that,
    maybe a bit less intense, but the same shaded look." A room polygon now
    gets its own soft radial glow, tinted with the room's own colour — one
    gradient definition per DISTINCT colour in use (the same dedup glowIds
    already does for lights), referenced by every room polygon that colour,
    in both the working view and Showcase. Loft is forced (via room_meta) to
    the exact colour Kitchen's name hashes to, so the dedup is proven by
    construction rather than by hoping two arbitrary names collide."""
    base_model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
            "Loft":    {"type": "poly", "floor_id": "main", "points_m": [[8, 0], [13, 0], [13, 5], [8, 5]]},
        },
        "light_positions_m": {},
    }
    lbe = {}
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "import { roomColor } from './room_color.mjs';\n"
        f"const BASE_MODEL={json.dumps(base_model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        "const kitchenColor=roomColor('Kitchen', BASE_MODEL);\n"
        "const MODEL={...BASE_MODEL, room_meta:{Loft:{color:kitchenColor}}};\n"
        "const svgWork=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{});\n"
        "const svgShow=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{showcase:true});\n"
        "const defCount=(svg)=>(svg.match(/<radialGradient id=\"psroomglow_[^\"]*\"/g)||[]).length;\n"
        "const usesGlow=(svg)=>/<polygon[^>]*fill=\"url\\(#psroomglow_[0-9]+\\)\"/.test(svg);\n"
        "console.log(JSON.stringify({\n"
        "  workDefCount: defCount(svgWork), showDefCount: defCount(svgShow),\n"
        "  workUsesGlow: usesGlow(svgWork), showUsesGlow: usesGlow(svgShow),\n"
        "}));\n"
    ))
    assert out["workDefCount"] == 1, \
        f"Kitchen and Loft share one forced colour — must share one gradient definition, not two: {out}"
    assert out["showDefCount"] == 1, out
    assert out["workUsesGlow"], "the working view's room polygons must reference their glow gradient"
    assert out["showUsesGlow"], "Showcase must keep the room glow alongside its own pswash sheen"


def test_room_tint_blends_the_colour_of_its_own_lit_fixtures_in_showcase(tmp_path):
    """Gap #15, best-in-class roadmap: "slab tint from blended live rgb/brightness".

    A room whose lights are actually glowing a colour should tint that
    colour on the slab — not just wear its assigned display colour. Falls
    back to the static colour when the room has nothing lit (or byRoom
    carries nothing for it at all, the shape every prior Showcase test in
    this file already uses and must keep working unchanged).
    """
    base_model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
        },
        "light_positions_m": {
            "light.lit": {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
        },
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    lbe = {"light.lit": {"entity_id": "light.lit", "state": "on", "code": "A01",
                         "shape": "circle", "isWled": False, "rgb": [16, 240, 128], "bri": 255}}
    by_room = {"Kitchen": [{"entity_id": "light.lit", "state": "on", "rgb": [16, 240, 128], "bri": 255}]}

    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        "import { roomColor } from './room_color.mjs';\n"
        f"const MODEL={json.dumps(base_model)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const BYROOM={json.dumps(by_room)};\n"
        "const out={};\n"
        "out.staticColor=roomColor('Kitchen', MODEL);\n"
        "const show=M.buildIsoSVG(MODEL,BYROOM,new Set(),null,150,0,LBE,false,FLOORS,{showcase:true});\n"
        "const work=M.buildIsoSVG(MODEL,BYROOM,new Set(),null,150,0,LBE,false,FLOORS,{});\n"
        "const showOff=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{showcase:true});\n"
        "const strokeOf=(svg)=>{const m=/<polygon points=\"[^\"]+\" fill=\"none\" stroke=\"#04100a\"[^>]*\\/>\\s*<polygon[^>]*stroke=\"([^\"]+)\"/.exec(svg); return m?m[1]:null;};\n"
        "out.showStroke=strokeOf(show);\n"
        "out.workStroke=/<polygon[^>]*fill=\"[^\"]*\" fill-opacity=\"0\\.16\" stroke=\"([^\"]+)\"/.exec(work)?.[1]||null;\n"
        "out.showOffStroke=strokeOf(showOff);\n"
        "console.log(JSON.stringify(out));\n"
    ))
    # The fixture reports rgb 16,240,128; quantised the same way glowIds
    # quantises it elsewhere in this file (see #18f078 in the showcase tests).
    assert out["showStroke"] == "#18f078", out
    # Working (non-Showcase) mode is a "cinematic Showcase upgrade" — the
    # working map keeps its ordinary static colour regardless of byRoom.
    assert out["workStroke"] == out["staticColor"], out
    # No lit fixture recorded for the room at all (byRoom={}) — the shape
    # every OTHER Showcase test in this file uses — must fall back exactly
    # as before.
    assert out["showOffStroke"] == out["staticColor"], out


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
        "  new RegExp('<polygon data-eid=\"'+eid.replace('.','\\\\.')+'\" points=\"([^\"]+)\" fill=\"none\" '\n"
        "    +'stroke=\"([^\"]+)\" stroke-width=\"([0-9.]+)\"[^>]*opacity=\"([0-9.]+)\"([^>]*)/>','g'))]\n"
        "  .map(m=>({pts:m[1], stroke:m[2], sw:Number(m[3]), op:Number(m[4]), soft:m[5].includes('psclipsoft')}));\n"
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

    # The crisp line wears the standard marker outline colours, never the
    # fixture's body colour ("not a yellow line" — Garry): blue in the
    # working map, white lit / slate off in Showcase. The GLOW half is where
    # the fixture's own colour lives.
    assert out["zeroWork"][0]["stroke"] == "#60a5fa", out["zeroWork"]
    assert out["offWork"][0]["stroke"] == "#60a5fa", out["offWork"]
    assert out["coveShow"][1]["stroke"] == "#f8fafc", out["coveShow"]
    assert out["coveShow"][0]["stroke"] == "#22c55e", "the Showcase glow must keep the fixture's own colour"

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


def test_motion_sensor_pulses_blue_while_triggered_and_fans_do_not_pool(tmp_path):
    """Garry: "a blue pulsing glow around motion sensors when activated".
    The pulse draws in BOTH modes (it is live status, not presentation),
    only while the sensor is ON, and neither a fan nor a sensor ever throws
    a light pool on the floor — they are on the map, not light sources."""
    model = {
        "room_geometry_m": {"Hall": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            "binary_sensor.pir_on":  {"x_m": 2.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.pir_off": {"x_m": 6.0, "y_m": 2.0, "floor_id": "main"},
            "fan.ceiling":           {"x_m": 4.0, "y_m": 1.0, "floor_id": "main"},
        },
    }
    lbe = {
        "binary_sensor.pir_on":  {"entity_id": "binary_sensor.pir_on",  "state": "on",  "code": "M01", "shape": "motion", "isMotion": True},
        "binary_sensor.pir_off": {"entity_id": "binary_sensor.pir_off", "state": "off", "code": "M02", "shape": "motion", "isMotion": True},
        "fan.ceiling":           {"entity_id": "fan.ceiling",           "state": "on",  "code": "F01", "shape": "fan",    "isFan": True},
    }
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
        "const mk=(o)=>M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        "const work=mk({}), show=mk({showcase:true});\n"
        "const pulses=(s)=>(s.match(/fill=\"url\\(#psmotion\\)\"/g)||[]).length;\n"
        "const out={workPulses:pulses(work), showPulses:pulses(show),\n"
        "  workAnimatesR:/<animate attributeName=\"r\"/.test(work),\n"
        "  showPools:(show.match(/fill=\"url\\(#psglow_/g)||[]).length,\n"
        "  motionGlyph:/<g class=\"lhex\" data-eid=\"binary_sensor\\.pir_on\"/.test(work),\n"
        "  fanGlyph:/<g class=\"lhex\" data-eid=\"fan\\.ceiling\"/.test(work)};\n"
        "console.log(JSON.stringify(out));\n"
    ))
    # Exactly one sensor is triggered: one pulse disc in each mode, not two.
    assert out["workPulses"] == 1 and out["showPulses"] == 1, out
    assert out["workAnimatesR"], "the expanding ring animation is missing from the working map"
    # The lit fan pools nothing; the sensors pool nothing; so Showcase has no light pools at all.
    assert out["showPools"] == 0, out
    assert out["motionGlyph"] and out["fanGlyph"], out


def test_motion_sensor_fades_through_a_distinct_rainbow_while_quiet_but_stays_fixed_blue_while_on(tmp_path):
    """Garry, across several rounds: "if a motion detector went off in the
    last 6 hours the flashing blue goes to a flashing purple after the blue
    has stopped" — "so all colours from blue to purple over 6 hours" — then,
    watching it live: "don't think the color is changing" (a continuous
    sweep moves under 1deg/minute, correct but invisible) — "the blue only
    stays on for 5 minutes, and the next color is visibly not blue" — then,
    the one-clock-whether-on-or-quiet version: "why can't you get this
    right! ... they start blue for 5 minutes, then cycle thru every color
    ... after 2 hours end up on green ... all types of motion sensors and
    occupance sensor replicate the same behavior. I need consistancy!" —
    live data showed the actual bugs: (1) the first three stops (blue,
    violet, magenta) are all "cool" blue-purple-pink tones that read as one
    colour at a glance even though they are 40deg apart on paper, so a room
    re-triggered inside 20 minutes only ever looked blue; (2) applying that
    same elapsed-since-last-changed clock to the TRIGGERED state meant a
    genuine occupancy/radar sensor that stays "on" for hours while someone
    is continuously present faded all the way to the "long since quiet"
    colour while the room was still actively occupied — backwards for
    "simple occupancy viewing", and Garry's real complaint: "I need
    consistent behaviour regardless of the sensor type."

    Settled design, round three (Garry: "the blue flashing motion bulb only
    flashes for 5 seconds for [any] of the alarm motion sensors!! They
    should flash for 5 minutes like some of the other motion sensors, Make
    them all behave the same way"): the ANIMATED flashing pulse runs while
    a sensor is genuinely "on" OR is still within the shared 5-minute hold
    window of its last transition — never merely while the raw state reads
    "on". The raw "on" duration is a hardware artefact (an alarm panel's
    PIR zone self-clears in ~5 seconds; a standalone PIR's retrigger timer
    holds for minutes; a radar unit holds while someone is present), and
    tying the flash to it alone made the identical real-world event flash
    for seconds on one sensor and minutes on another. Because last_changed
    also resets on the on→off flip, a short-hold sensor's off-transition
    lands within seconds of the trigger itself, so the hold window gives
    every class the same minimum flash. While flashing the colour is always
    the fixed active blue. Only once a sensor has been QUIET past the hold
    window does the calmer ring take over, driving a step function through
    classic, immediately-distinct colour-wheel colours (cyan/green/yellow/
    orange/red/magenta) — held stages, front-loaded, the long way round the
    wheel to the held end colour (magenta, at 2h). last_changed is HA's own
    field for when a binary_sensor last transitioned; nowMs is injectable
    so this test does not race a real clock."""
    model = {
        "room_geometry_m": {"Hall": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            "binary_sensor.just_now":        {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.under_five":      {"x_m": 2.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.just_after_five": {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.mid_sweep":       {"x_m": 4.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.at_two_hours":    {"x_m": 5.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.past_two_hours":  {"x_m": 6.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.almost_six":      {"x_m": 7.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.over_six":        {"x_m": 8.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.no_ts":           {"x_m": 9.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.active":          {"x_m": 10.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.active_fresh":    {"x_m": 11.0, "y_m": 2.0, "floor_id": "main"},
            "binary_sensor.active_stuck":    {"x_m": 12.0, "y_m": 2.0, "floor_id": "main"},
        },
    }
    NOW = 1_000_000_000_000  # an arbitrary fixed epoch ms, matched by nowMs
    H = 3_600_000
    M = 60_000
    lbe = {
        # The alarm-panel case: the zone triggered and its hardware already
        # self-cleared back to "off" seconds later. The ANIMATED flash must
        # still be running — the raw "on" hold-time never decides how long
        # the flash lasts.
        "binary_sensor.just_now":        {"entity_id": "binary_sensor.just_now",        "state": "off", "code": "M01", "shape": "motion", "isMotion": True, "last_changed": NOW - 1},
        # 4m59s quiet: STILL inside the hold window — still the animated
        # flash, still blue. "Holds THROUGH 5 minutes", not "starts fading
        # (or calming) immediately".
        "binary_sensor.under_five":      {"entity_id": "binary_sensor.under_five",      "state": "off", "code": "M02", "shape": "motion", "isMotion": True, "last_changed": NOW - (5 * M - 1000)},
        # 5m01s quiet: the very next instant after the hold — must already
        # be a CLEARLY different hue, not a one-degree nudge off blue.
        "binary_sensor.just_after_five": {"entity_id": "binary_sensor.just_after_five", "state": "off", "code": "M03", "shape": "motion", "isMotion": True, "last_changed": NOW - (5 * M + 1000)},
        # 50 min: between the 40-min (red) and 65-min (orange) stops — still
        # mid-sweep, neither the start nor the end.
        "binary_sensor.mid_sweep":       {"entity_id": "binary_sensor.mid_sweep",       "state": "off", "code": "M04", "shape": "motion", "isMotion": True, "last_changed": NOW - 50 * M},
        # Exactly 2h: the stop table uses >=, so the boundary itself must
        # already read as green, not the stage before it.
        "binary_sensor.at_two_hours":    {"entity_id": "binary_sensor.at_two_hours",    "state": "off", "code": "M05", "shape": "motion", "isMotion": True, "last_changed": NOW - 2 * H},
        "binary_sensor.past_two_hours":  {"entity_id": "binary_sensor.past_two_hours",  "state": "off", "code": "M06", "shape": "motion", "isMotion": True, "last_changed": NOW - 3 * H},
        # Just under 6h: green is HELD all the way to the outer cutoff, not
        # swept toward some later colour — there is no stage past green.
        "binary_sensor.almost_six":      {"entity_id": "binary_sensor.almost_six",      "state": "off", "code": "M07", "shape": "motion", "isMotion": True, "last_changed": NOW - (6 * H - 1000)},
        "binary_sensor.over_six":        {"entity_id": "binary_sensor.over_six",        "state": "off", "code": "M08", "shape": "motion", "isMotion": True, "last_changed": NOW - (6 * H + 1000)},
        "binary_sensor.no_ts":           {"entity_id": "binary_sensor.no_ts",           "state": "off", "code": "M09", "shape": "motion", "isMotion": True, "last_changed": None},
        # A sensor that is CURRENTLY "on" is always the fixed active colour
        # (blue), whatever its device class or how long it has been "on" —
        # a hold-time PIR and a genuine sustained-occupancy sensor that has
        # been continuously "on" for hours must look identical, and neither
        # one may fade toward the "long since quiet" colours while it is
        # still actively triggered.
        "binary_sensor.active":          {"entity_id": "binary_sensor.active",          "state": "on",  "code": "M10", "shape": "motion", "isMotion": True, "last_changed": NOW - 5 * H},
        "binary_sensor.active_fresh":    {"entity_id": "binary_sensor.active_fresh",    "state": "on",  "code": "M11", "shape": "motion", "isMotion": True, "last_changed": NOW - 1000},
        # Reporting "on" continuously past the 6h outer cutoff is a stuck
        # sensor, not six hours of one continuous fresh event — it gets the
        # same hard edge a quiet sensor gets: nothing drawn at all.
        "binary_sensor.active_stuck":    {"entity_id": "binary_sensor.active_stuck",    "state": "on",  "code": "M12", "shape": "motion", "isMotion": True, "last_changed": NOW - (6 * H + 1000)},
    }
    # Encode last_changed as real ISO strings (what gatherLights actually
    # hands the renderer), built from the epoch-ms markers above.
    import datetime
    for l in lbe.values():
        lc = l["last_changed"]
        l["last_changed"] = (None if lc is None
                             else datetime.datetime.fromtimestamp(lc / 1000, tz=datetime.timezone.utc).isoformat())
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,{{nowMs:{NOW}}});\n"
        "const hueFor=(eid)=>{\n"
        "  const m=new RegExp('class=\"lrecent\" data-eid=\"'+eid.replace(/\\./g,'\\\\.')+'\"[^]*?stroke=\"hsl\\\\((\\\\d+),').exec(svg);\n"
        "  return m ? parseInt(m[1],10) : null;\n"
        "};\n"
        "const pulseHueFor=(eid)=>{\n"
        "  const m=new RegExp('class=\"lpulse\" data-eid=\"'+eid.replace(/\\./g,'\\\\.')+'\"[^]*?stroke=\"hsl\\\\((\\\\d+),').exec(svg);\n"
        "  return m ? parseInt(m[1],10) : null;\n"
        "};\n"
        "const iconOpacityFor=(eid)=>{\n"
        "  const m=new RegExp('class=\"lhex\" data-eid=\"'+eid.replace(/\\./g,'\\\\.')+'\"[^>]*opacity=\"([\\\\d.]+)\"').exec(svg);\n"
        "  return m ? parseFloat(m[1]) : null;\n"
        "};\n"
        "console.log(JSON.stringify({\n"
        "  justNow: pulseHueFor('binary_sensor.just_now'),\n"
        "  justNowCalmRing: hueFor('binary_sensor.just_now'),\n"
        "  underFive: pulseHueFor('binary_sensor.under_five'),\n"
        "  underFiveCalmRing: hueFor('binary_sensor.under_five'),\n"
        "  justAfterFive: hueFor('binary_sensor.just_after_five'),\n"
        "  justAfterFivePulse: pulseHueFor('binary_sensor.just_after_five'),\n"
        "  midSweep: hueFor('binary_sensor.mid_sweep'),\n"
        "  atTwoHours: hueFor('binary_sensor.at_two_hours'),\n"
        "  pastTwoHours: hueFor('binary_sensor.past_two_hours'),\n"
        "  almostSix: hueFor('binary_sensor.almost_six'),\n"
        "  overSix: hueFor('binary_sensor.over_six'),\n"
        "  noTs: hueFor('binary_sensor.no_ts'),\n"
        "  activeHue: pulseHueFor('binary_sensor.active'),\n"
        "  activeFreshHue: pulseHueFor('binary_sensor.active_fresh'),\n"
        "  activeStuckHue: pulseHueFor('binary_sensor.active_stuck'),\n"
        "  activeStuckHasAnyPulseMarkup: /class=\"l(pulse|recent)\" data-eid=\"binary_sensor\\.active_stuck\"/.test(svg),\n"
        "  justNowIcon: iconOpacityFor('binary_sensor.just_now'),\n"
        "  underFiveIcon: iconOpacityFor('binary_sensor.under_five'),\n"
        "  justAfterFiveIcon: iconOpacityFor('binary_sensor.just_after_five'),\n"
        "  activeIcon: iconOpacityFor('binary_sensor.active'),\n"
        "}));\n"
    ))
    # The alarm-zone case, and the heart of round three: hardware already
    # reads "off" seconds after the trigger, but the ANIMATED flashing
    # pulse (not the calm ring) must still be running, blue, for the whole
    # 5-minute hold — the raw "on" hold-time never decides the flash.
    assert out["justNow"] == 240 and out["justNowCalmRing"] is None, \
        f"seconds after triggering, an already-cleared sensor must still wear the ANIMATED blue flash: {out}"
    assert out["underFive"] == 240 and out["underFiveCalmRing"] is None, \
        "4m59s after its last transition the animated flash is still running — the hold is a firm hold"
    # The very next instant after 5 minutes: the flash ends and the calm
    # ring takes over at cyan — a genuinely different colour family, not a
    # nudge within the same blue-purple cluster the earlier violet/magenta
    # stops read as.
    assert out["justAfterFive"] == 180 and out["justAfterFivePulse"] is None, \
        f"right after 5 minutes: calm ring at cyan, no animated flash: {out}"
    # The marker ICON lights for the SAME window the pulse flashes (round
    # four: "the blue solid flash for the motion icon still goes out ...
    # The ring might be OK, but not the icon") — full opacity through the
    # hold, dimmed only once the calm ring takes over.
    assert out["justNowIcon"] == 1 and out["underFiveIcon"] == 1, \
        f"the icon must stay lit through the whole hold window, not the raw hardware hold: {out}"
    assert out["justAfterFiveIcon"] == 0.45, \
        f"past the hold the icon dims like any off device: {out}"
    assert out["activeIcon"] == 1, out
    # 50 minutes in: past the 40-min (yellow) stop, before the 65-min
    # (orange) one — neither blue nor the final magenta.
    assert out["midSweep"] == 60, f"the 50-min mark must read as yellow (the 40-min stop, held): {out}"
    # Exactly 2h, and every point past it out to the 6h cutoff: magenta, held.
    assert out["atTwoHours"] == 300, "2h is the stop's own boundary — must already be magenta, not the stage before it"
    assert out["pastTwoHours"] == 300, out
    assert out["almostSix"] == 300, "magenta is held all the way to the 6h edge, not swept past"
    # Past 6h: no glow at all — "recent" has a hard edge.
    assert out["overSix"] is None, "a sensor quiet for over 6 hours must show no recent-pulse at all"
    # No timestamp at all (defensive): no glow, no crash.
    assert out["noTs"] is None, out
    # A CURRENTLY TRIGGERED sensor is ALWAYS the fixed active colour (blue),
    # never elapsed-shifted — 5h since its last transition must look
    # identical to one that just started, not fade toward "long since
    # quiet" while the room is still actively occupied.
    assert out["activeHue"] == 240, \
        f"an 'on' sensor must always read as the fixed active blue, whatever its elapsed time: {out}"
    assert out["activeFreshHue"] == 240, out
    # An "on" sensor stuck past the 6h outer cutoff gets the same hard edge
    # a quiet one gets: no pulse ring, no recency ring — nothing, because a
    # sensor still claiming "on" six hours after its last transition is
    # stuck, not six hours of one continuous fresh event.
    assert out["activeStuckHue"] is None, out
    assert not out["activeStuckHasAnyPulseMarkup"], \
        "a sensor stuck 'on' past 6h must draw no motion glow at all"


def test_room_label_steps_out_of_a_markers_way_by_its_own_rendered_width(tmp_path):
    """Live on Garry's own house: the room name "SpareBedroomBath" (16
    characters) was drawn straight through its own M08 marker. The label's
    collision check compared a marker's position against a FIXED ±34px
    window regardless of how wide the label's own text actually rendered —
    a long name's real half-width (~40px here) reaches past that window, so
    a marker sitting just outside 34px but still under the text was checked
    as "not near" and never triggered the step-up. The fix makes the window
    the label's own half-width, not a constant.

    Same marker position, same distance from room centre, two room names:
    a long one whose true half-width covers that marker (must step up) and
    a short one whose true half-width does not (must not step — proving the
    old bug wasn't "the window is too small everywhere", it was "the window
    doesn't know how wide THIS label is").
    """
    NOW = 1_000_000_000_000

    def render_with_room_name(room_name):
        model = {
            "room_geometry_m": {room_name: {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 3], [0, 3]]}},
            # Calibrated against this exact room polygon (re-tuned 2026-09-07
            # for the smaller rfsBase — "takes up too much space"): lands
            # inside a long name's (now narrower) half-width, outside a
            # short one's, and within the (unchanged) ±9px vertical band
            # either way.
            "light_positions_m": {"binary_sensor.probe": {"x_m": 0.7, "y_m": -0.4, "floor_id": "main"}},
        }
        lbe = {"binary_sensor.probe": {"entity_id": "binary_sensor.probe", "state": "off", "code": "M08", "shape": "motion", "isMotion": True, "last_changed": None}}
        return _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const LBE={json.dumps(lbe)};\n"
            "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
            f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,{{nowMs:{NOW}}});\n"
            f"const m=/<text x=\"([\\d.-]+)\" y=\"([\\d.-]+)\" text-anchor=\"middle\"[^]*?>{room_name}/.exec(svg);\n"
            "console.log(JSON.stringify({y: m ? parseFloat(m[2]) : null}));\n"
        ))

    long_name = render_with_room_name("SpareBedroomBath")
    short_name = render_with_room_name("Den")
    assert long_name["y"] is not None and short_name["y"] is not None
    assert long_name["y"] < short_name["y"], (
        "a long room name's label must step up and away from a marker its "
        f"own rendered width reaches over — long={long_name}, short={short_name}"
    )
    # The short name's marker sits outside even ITS OWN (narrower) window,
    # so it must render at the plain, unshifted top-edge position — proving
    # the fix didn't just make the window bigger for everyone.
    assert short_name["y"] == long_name["y"] + 13, (
        f"the short name should be exactly one 13px step below the long "
        f"name's shifted position, not shifted itself: long={long_name}, short={short_name}"
    )


def test_temperature_readout_shows_digits_only_when_placed_and_fresh(tmp_path):
    """Garry: "...a shape can be chosen for that temp and inside is simply
    the temperature, 3 digit, and larger" — "if they gave the temperature
    in the last hour" — "And only if placed like all others". Four
    entities, only one of which should ever show its number: placed+fresh
    shows the digits; placed+stale and unplaced+fresh both fall back to the
    ordinary small code, exactly like every other shape does."""
    NOW = 2_000_000_000_000
    H = 3_600_000
    model = {
        "room_geometry_m": {"Hall": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            # Placed AND fresh — the only one that should show digits.
            "sensor.fresh_placed": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"},
            # Placed but stale (>1h) — falls back to its code.
            "sensor.stale_placed": {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
        },
        # sensor.fresh_unplaced deliberately has NO light_positions_m entry —
        # it auto-clusters in "Hall" instead.
    }
    import datetime
    iso = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).isoformat()
    lbe = {
        "sensor.fresh_placed":   {"entity_id": "sensor.fresh_placed",   "state": "on", "code": "T01", "shape": "tempreadout", "isTemp": True, "temperature": 72, "last_changed": iso(NOW - 5 * 60_000)},
        "sensor.stale_placed":   {"entity_id": "sensor.stale_placed",   "state": "on", "code": "T02", "shape": "tempreadout", "isTemp": True, "temperature": 68, "last_changed": iso(NOW - 2 * H)},
        "sensor.fresh_unplaced": {"entity_id": "sensor.fresh_unplaced", "state": "on", "code": "T03", "shape": "tempreadout", "isTemp": True, "temperature": 105, "last_changed": iso(NOW - 60_000)},
    }
    by_room = {"Hall": [lbe["sensor.fresh_unplaced"]]}
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const BYROOM={json.dumps(by_room)};\n"
        "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
        f"const svg=M.buildIsoSVG(MODEL,BYROOM,new Set(),null,150,0,LBE,false,FLOORS,{{nowMs:{NOW}}});\n"
        "const out={\n"
        "  freshPlacedShowsDigits: />72</.test(svg),\n"
        "  stalePlacedShowsCode: />T02</.test(svg) && !/>68</.test(svg),\n"
        "  freshUnplacedShowsCode: />T03</.test(svg) && !/>105</.test(svg),\n"
        "};\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["freshPlacedShowsDigits"], "a placed, fresh reading must show its own number"
    assert out["stalePlacedShowsCode"], "a placed but STALE reading must fall back to its code, not show a number"
    assert out["freshUnplacedShowsCode"], "an UNPLACED reading must fall back to its code even when fresh"


def test_use_surface_ergonomics_opts(tmp_path):
    """The ergonomics opts buildIsoSVG grew for the sidebar/preview use
    surface: codeChip splits the tap target into its own data-role="code"
    pill; hideCodes drops codes entirely (semantic zoom); classFilter dims
    every OTHER class and stops it taking taps; hitHalo draws an invisible
    tap disc under every marker; collapseUnplaced turns a room's unplaced
    pile into ONE data-role="stack" chip. Room names and the floor badge are
    tap targets (data-role="room"/"floor") unconditionally — every host can
    use them, whether or not it asks for the rest."""
    model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
        },
        "light_positions_m": {
            "light.placed": {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
        },
    }
    lbe = {
        "light.placed": {"entity_id": "light.placed", "state": "on", "code": "A01", "shape": "circle"},
        "fan.ceiling":  {"entity_id": "fan.ceiling", "state": "on", "code": "F01", "shape": "fan", "isFan": True},
        "light.a":      {"entity_id": "light.a", "state": "off", "code": "A02", "shape": "hex"},
        "light.b":      {"entity_id": "light.b", "state": "on",  "code": "A03", "shape": "hex"},
    }
    by_room = {"Kitchen": [lbe["fan.ceiling"], lbe["light.a"], lbe["light.b"]]}
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const BYROOM={json.dumps(by_room)};\n"
        "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
        "const mk=(o)=>M.buildIsoSVG(MODEL,BYROOM,new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        "const plain=mk({});\n"
        "const chip=mk({codeChip:true});\n"
        "const hidden=mk({codeChip:true, hideCodes:true});\n"
        "const filtered=mk({classFilter:'fan'});\n"
        "const haloed=mk({hitHalo:true});\n"
        "const collapsed=mk({collapseUnplaced:true});\n"
        "const codeCount=(s)=>(s.match(/data-role=\"code\"/g)||[]).length;\n"
        "const out={\n"
        "  plainHasRoleCode: /data-role=\"code\"/.test(plain),\n"
        "  chipHasRoleCode: codeCount(chip) >= 1,\n"
        "  hiddenHasRoleCode: codeCount(hidden) === 0,\n"
        "  hiddenHasCodeText: hidden.includes('A01'),\n"
        "  // filtered=fan: the fan glyph is full-opacity and clickable; the two\n"
        "  // plain lights are dimmed AND pointer-events:none.\n"
        "  fanFull: /data-class=\"fan\"[^>]*opacity=\"1\"/.test(filtered) || /opacity=\"1\"[^>]*data-class=\"fan\"/.test(filtered),\n"
        "  lightsDimmed: (filtered.match(/data-class=\"light\"[^>]*pointer-events=\"none\"/g)||[]).length"
        " + (filtered.match(/pointer-events=\"none\"[^>]*data-class=\"light\"/g)||[]).length,\n"
        "  plainNoHalo: !/class=\"lhalo\"/.test(plain),\n"
        "  haloedCount: (haloed.match(/class=\"lhalo\"/g)||[]).length,\n"
        "  haloForPlacedOnly: /data-eid=\"light\\.placed\"/.test(haloed.match(/<circle class=\"lhalo\"[^\\/]*\\/>/g)?.join('')||''),\n"
        "  plainClusterMarkers: (plain.match(/<g class=\"lhex\" data-eid=\"(fan\\.ceiling|light\\.a|light\\.b)\"/g)||[]).length,\n"
        "  collapsedStackChip: /data-role=\"stack\"/.test(collapsed),\n"
        "  collapsedNoClusterMarkers: (collapsed.match(/<g class=\"lhex\" data-eid=\"(fan\\.ceiling|light\\.a|light\\.b)\"/g)||[]).length,\n"
        "  collapsedStackCount: (collapsed.match(/3 unplaced/g)||[]).length,\n"
        "  roomTapTarget: /data-role=\"room\" data-room=\"Kitchen\"/.test(plain),\n"
        "  floorTapTarget: /data-role=\"floor\" data-z=\"0\"/.test(plain),\n"
        "};\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert not out["plainHasRoleCode"], "the default render must not grow a code-chip target unasked"
    assert out["chipHasRoleCode"], "codeChip must add a data-role=\"code\" target"
    assert out["hiddenHasRoleCode"] and not out["hiddenHasCodeText"], "hideCodes must drop the code entirely, not just its chip"
    assert out["fanFull"], "the matching class must stay full-opacity and clickable"
    # Three "light"-class devices are drawn: the placed marker plus the two
    # clustered in the room — classFilter:"fan" must dim every one of them.
    assert out["lightsDimmed"] == 3, "every non-matching class must dim AND stop taking taps"
    assert out["plainNoHalo"], "a halo must never appear unasked"
    assert out["haloedCount"] >= 1, "hitHalo must draw at least one halo"
    assert out["haloForPlacedOnly"], "the placed light's halo must exist"
    assert out["plainClusterMarkers"] == 3, "without collapseUnplaced the pile stays three individual markers"
    assert out["collapsedStackChip"], "collapseUnplaced must draw a stack chip"
    assert out["collapsedNoClusterMarkers"] == 0, "collapseUnplaced must replace the individual markers, not add to them"
    assert out["collapsedStackCount"] == 1, "one chip for the whole pile, not one per light"
    assert out["roomTapTarget"], "the room name must be a data-role=\"room\" tap target unconditionally"
    assert out["floorTapTarget"], "the floor badge must be a data-role=\"floor\" tap target unconditionally"


def test_locate_ring_and_drop_marker(tmp_path):
    """Garry, choosing a light from the Mapping -> Lights index: "I want the
    item to be easy to find" — a slow ring flashes outward from wherever it
    actually is, a third of the whole canvas across (locateEid). And: "put a
    drag and drop marker on the lower right side of the map ... as a second
    way to place the selected item" (dropMarker) — a fixed pin, not tied to
    any entity, that the builder's own drag wiring reads by data-role."""
    model = {
        "room_geometry_m": {"Hall": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            "light.a": {"x_m": 2.0, "y_m": 2.0, "floor_id": "main"},
            "light.b": {"x_m": 6.0, "y_m": 2.0, "floor_id": "main"},
        },
    }
    lbe = {
        "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle"},
        "light.b": {"entity_id": "light.b", "state": "on", "code": "A02", "shape": "circle"},
    }
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
        "const mk=(o)=>M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        "const plain=mk({});\n"
        "const locateA=mk({locateEid:'light.a'});\n"
        "const locateNone=mk({locateEid:'light.nonexistent'});\n"
        "const withPin=mk({dropMarker:true});\n"
        "const ringNear=(svg,eid)=>{\n"
        "  const g=svg.match(new RegExp('<g class=\"lhex\" data-eid=\"'+eid+'\"[^]*?data-cx=\"([^\"]+)\" data-cy=\"([^\"]+)\"'));\n"
        "  return g ? {cx:parseFloat(g[1]), cy:parseFloat(g[2])} : null;\n"
        "};\n"
        "const ringMatch=/<circle class=\"llocate\"[^>]*cx=\"([^\"]+)\" cy=\"([^\"]+)\"[^>]*r=\"([^\"]+)\"/.exec(locateA);\n"
        "console.log(JSON.stringify({\n"
        "  plainHasNoRing: !/class=\"llocate\"/.test(plain),\n"
        "  locateARingCount: (locateA.match(/class=\"llocate\"/g)||[]).length,\n"
        "  locateNoneRingCount: (locateNone.match(/class=\"llocate\"/g)||[]).length,\n"
        "  ringCx: ringMatch ? parseFloat(ringMatch[1]) : null,\n"
        "  ringCy: ringMatch ? parseFloat(ringMatch[2]) : null,\n"
        "  ringR: ringMatch ? parseFloat(ringMatch[3]) : null,\n"
        "  markerA: ringNear(locateA, 'light\\\\.a'),\n"
        "  animR: (/<animate attributeName=\"r\" values=\"[^;]+;([^\"]+)\"/.exec(locateA)||[])[1],\n"
        "  plainHasNoPin: !/data-role=\"dropmarker\"/.test(plain),\n"
        "  pinCount: (withPin.match(/data-role=\"dropmarker\"/g)||[]).length,\n"
        "  pinHasNoEid: !new RegExp('data-role=\"dropmarker\"[^>]*data-eid').test(withPin),\n"
        "}));\n"
    ))
    assert out["plainHasNoRing"], "a ring must never appear unasked"
    assert out["locateARingCount"] == 1, out
    assert out["locateNoneRingCount"] == 0, "an eid that matches nothing must draw no ring"
    # The ring centres on the light's REAL drawn position, and its target
    # radius is a third of the canvas (ISO.W / 6, since 6*radius = 3*diameter).
    assert out["markerA"] is not None, out
    assert abs(out["ringCx"] - out["markerA"]["cx"]) < 0.5 and abs(out["ringCy"] - out["markerA"]["cy"]) < 0.5, out
    assert out["ringR"] < 20, "the ring must start small (it sweeps OUTWARD)"
    # ISO.W is 760 — a third of the whole canvas as a diameter is W/6 as a radius.
    assert out["animR"] is not None and abs(float(out["animR"]) - 760 / 6) < 1, \
        f"the ring's target radius must be a third of the canvas: {out}"
    assert out["plainHasNoPin"], "the drop pin must never appear unasked"
    assert out["pinCount"] == 1, out
    assert out["pinHasNoEid"], "the pin is not tied to any entity — the host resolves the drop itself"


def test_code_chip_clears_an_oversized_fixture(tmp_path):
    """Found live (2026-09-03), on the house's own map: a fixture given a
    real width_cm/height_cm (this session's resize handles) can draw many
    times the marker's base radius, and the code chip's gap was a flat
    HEX_R*1.55 — on Garry's own "A14" it landed the chip INSIDE the lower
    third of the glyph instead of clearly below it. The gap now scales with
    the marker's actual drawn size (Math.max(sx,sy))."""
    model = {
        "room_geometry_m": {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [10, 0], [10, 10], [0, 10]]}},
        "light_positions_m": {
            "light.small": {"x_m": 2.0, "y_m": 2.0, "floor_id": "main"},
            # A big chandelier — the exact shape of the reported bug.
            "light.big":   {"x_m": 6.0, "y_m": 2.0, "floor_id": "main", "width_cm": 300, "height_cm": 300},
        },
    }
    lbe = {
        "light.small": {"entity_id": "light.small", "state": "on", "code": "A01", "shape": "chandelier"},
        "light.big":   {"entity_id": "light.big",   "state": "on", "code": "A02", "shape": "chandelier"},
    }
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
        "const svg=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,{codeChip:true});\n"
        # A marker's own SHAPE can nest a <g transform=...> layer, so a lazy
        # "up to the first </g>" regex truncates before the code chip, which
        # is appended AFTER every shape layer. Slice on the string index of
        # the NEXT sibling marker instead — that bound is always correct
        # regardless of how deeply the shape itself nests.
        "const chipY=(eid)=>{\n"
        "  const start=svg.indexOf('data-eid=\"'+eid+'\"');\n"
        "  const nextStart=svg.indexOf('<g class=\"lhex\"', start+1);\n"
        "  const g=svg.slice(Math.max(0,start-40), nextStart>0?nextStart:svg.length);\n"
        "  const m=/data-role=\"code\"[^]*?<rect x=\"[^\"]+\" y=\"([^\"]+)\"/.exec(g);\n"
        "  return {chipTop: parseFloat(m[1]), cy: parseFloat(g.match(/data-cy=\"([^\"]+)\"/)[1])};\n"
        "};\n"
        "const small=chipY('light.small'), big=chipY('light.big');\n"
        "console.log(JSON.stringify({\n"
        "  smallGap: small.chipTop - small.cy,\n"
        "  bigGap: big.chipTop - big.cy,\n"
        "}));\n"
    ))
    # The big fixture's chip must sit measurably farther from its own centre
    # than the small fixture's — the whole point of the fix — and specifically
    # below where a flat HEX_R*1.55 gap (~15-20px at this scale) would land it.
    assert out["bigGap"] > out["smallGap"] * 2, out
    assert out["bigGap"] > 25, f"the chip must clear a 3m fixture's drawn extent: {out}"


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

    workInert's contract was deliberately narrowed when the room clipPath
    defs were re-gated on (SHOW || Automorph) — the Automorph aura is gated
    on its own slider, never on Showcase, so its room clip must exist on
    the working map too whenever the slider is up. A bare def is inert, so
    the working map is policed for clip-path APPLICATION and the breathing
    animation, not for the mere presence of psclip_ ids (which the
    automorph-off byte-identity guard test polices separately).
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
        "out.workInert=!/clip-path=\"url\\(#psclip_|<animate attributeName=\"opacity\" values=/.test(mk({}));\n"
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


# ── Automorph geometry (Garry, 2026-09-07) ───────────────────────────────────
# The morph's pure maths — resample, align, lerp — tested directly against
# synthetic squares/hexes, the same "prove it on a shape a human can check by
# hand" approach the offsetPolygonInward tests above use.

def test_resample_polygon_ring_preserves_point_count_and_perimeter(tmp_path):
    out = _run_js(tmp_path, (
        "import { resamplePolygonRing } from './iso_lights.mjs';\n"
        "const sq=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const r=resamplePolygonRing(sq,8);\n"
        "const perim=(pts)=>{let s=0;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];s+=Math.hypot(b[0]-a[0],b[1]-a[1]);}return s;};\n"
        "console.log(JSON.stringify({count:r.length, first:r[0], perim:perim(r)}));\n"
    ))
    assert out["count"] == 8, "resampling must return exactly the requested point count"
    assert out["first"] == [0, 0], "resampling starts exactly at the ring's own first point"
    # Every resampled point lies ON the original square's boundary (straight
    # edges), so the total perimeter is preserved exactly, not just approximated.
    assert abs(out["perim"] - 40) < 1e-6, out["perim"]


def test_align_ring_start_normalizes_winding_and_starts_at_the_top(tmp_path):
    """Two rings built by unrelated code — a hand-written icon, a traced room
    — cannot be lerped index-for-index unless both wind the same way and
    start from the same reference point, or the interpolation twists through
    itself. A clockwise square (negative signed area by this file's formula)
    must come back reversed (positive area) and starting at its own
    topmost point (smallest y — this file's y grows downward, so "top" is
    the minimum, matching arcPts' own "y down" convention)."""
    out = _run_js(tmp_path, (
        "import { alignRingStart } from './iso_lights.mjs';\n"
        "const cw=[[0,0],[0,10],[10,10],[10,0]];\n"
        "const out=alignRingStart(cw);\n"
        "const area=(pts)=>{let a=0;for(let i=0,j=pts.length-1;i<pts.length;j=i++)a+=pts[j][0]*pts[i][1]-pts[i][0]*pts[j][1];return a/2;};\n"
        "console.log(JSON.stringify({out, area: area(out)}));\n"
    ))
    assert out["area"] > 0, "a clockwise ring must come back with reversed (positive) winding"
    top_y = min(p[1] for p in out["out"])
    assert out["out"][0][1] == top_y, (
        "the ring must start at its own topmost point (min y), not wherever "
        f"the original vertex order happened to begin: {out['out']}"
    )


def test_automorph_ring_at_zero_percent_is_the_icon_completely_untouched(tmp_path):
    """The switch's and slider's own rest-position contract: t=0 must be
    byte-for-byte the icon's own outline, translated to its position — no
    resampling, no realignment, nothing that could shift a single pixel of
    the map when Automorph is off or freshly turned on at 0%."""
    out = _run_js(tmp_path, (
        "import { iconRingLocal, automorphRing } from './iso_lights.mjs';\n"
        "const icon=iconRingLocal('hex', 10);\n"
        "const room=[[0,0],[200,0],[200,200],[0,200]];\n"
        "const ring=automorphRing(icon, 50, 60, room, 0);\n"
        "const expect=icon.map(p=>[p[0]+50, p[1]+60]);\n"
        "console.log(JSON.stringify({ring, expect, equal: JSON.stringify(ring)===JSON.stringify(expect)}));\n"
    ))
    assert out["equal"], (
        "t=0 must exactly equal the icon's own points translated to its "
        f"position, unresampled: ring={out['ring']} expect={out['expect']}"
    )


def test_automorph_ring_at_full_percent_lands_exactly_on_the_room_boundary(tmp_path):
    """t=1 is the fully-grown end of the slider — every returned point must
    sit exactly on the room's own (inset) boundary, not somewhere between
    the icon and the room. A concentric, axis-aligned icon and room (both
    squares, same orientation) is the one case simple enough to check this
    generically: every output point's x is 0 or 100, or its y is 0 or 100 —
    a point strictly inside the square (a leftover from the icon) or outside
    it (an overshoot) would fail this."""
    out = _run_js(tmp_path, (
        "import { iconRingLocal, automorphRing } from './iso_lights.mjs';\n"
        "const icon=iconRingLocal('square', 10);\n"
        "const room=[[0,0],[100,0],[100,100],[0,100]];\n"
        "const ring=automorphRing(icon, 50, 50, room, 1);\n"
        "console.log(JSON.stringify({ring}));\n"
    ))
    for p in out["ring"]:
        on_boundary = (
            abs(p[0] - 0) < 1e-6 or abs(p[0] - 100) < 1e-6
            or abs(p[1] - 0) < 1e-6 or abs(p[1] - 100) < 1e-6
        )
        assert on_boundary, f"point {p} is not on the room's own square boundary: {out['ring']}"


def test_automorph_ring_at_half_percent_sits_strictly_between_icon_and_room(tmp_path):
    """A sanity check against a twisted/overshooting morph: at t=0.5, every
    point's distance from the shared centre must be strictly between the
    icon's own radius and the room's half-width — not collapsed back near
    the icon, and not overshooting past the room."""
    out = _run_js(tmp_path, (
        "import { iconRingLocal, automorphRing } from './iso_lights.mjs';\n"
        "const icon=iconRingLocal('circle', 10);\n"
        "const room=[[0,0],[100,0],[100,100],[0,100]];\n"
        "const ring=automorphRing(icon, 50, 50, room, 0.5);\n"
        "const dist=ring.map(p=>Math.hypot(p[0]-50, p[1]-50));\n"
        "console.log(JSON.stringify({dist}));\n"
    ))
    icon_r = 10 * 0.866
    room_half_diag = (50 * 2 ** 0.5)
    for d in out["dist"]:
        assert icon_r < d < room_half_diag, (
            f"a half-morphed point sat outside the icon..room range: {d} "
            f"(icon_r={icon_r}, room_half_diag={room_half_diag})"
        )


def test_best_rotational_match_recovers_a_cyclic_shift(tmp_path):
    """Ring correspondence must come from geometry, not from each ring's own
    'topmost point' guess: two copies of the SAME ring, one cyclically
    rotated, are the case where the right answer is unambiguous — the search
    must undo the rotation exactly (cost 0), so the subsequent index-for-
    index lerp pairs every point with itself instead of twisting."""
    out = _run_js(tmp_path, (
        "import { bestRotationalMatch } from './iso_lights.mjs';\n"
        "const a=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const b=a.slice(3).concat(a.slice(0,3));\n"
        "const m=bestRotationalMatch(a,b);\n"
        "console.log(JSON.stringify({m, equal: JSON.stringify(m)===JSON.stringify(a)}));\n"
    ))
    assert out["equal"], (
        "bestRotationalMatch must rotate the shifted copy back into exact "
        f"index-for-index alignment with the reference ring: {out['m']}"
    )


def test_automorph_resample_count_adapts_to_the_target_rings_own_density(tmp_path):
    """AUTOMORPH_N is a floor, not the count: a sparse 4-vertex room polygon
    still resamples to exactly 24 (the pre-cell behaviour, unchanged), but a
    Chaikin-densified cell ring arriving with more points keeps its own
    density — capped at 64 — so a cell's concave detail survives the
    resample instead of being averaged away by a fixed sparse count."""
    out = _run_js(tmp_path, (
        "import { iconRingLocal, automorphRing } from './iso_lights.mjs';\n"
        "const icon=iconRingLocal('circle', 10);\n"
        "const circ=(n,r)=>Array.from({length:n},(_,i)=>{const a=i/n*2*Math.PI;"
        "return [50+Math.cos(a)*r, 50+Math.sin(a)*r];});\n"
        "const sparse=automorphRing(icon, 50, 50, [[0,0],[100,0],[100,100],[0,100]], 0.5);\n"
        "const dense=automorphRing(icon, 50, 50, circ(40, 40), 0.5);\n"
        "const capped=automorphRing(icon, 50, 50, circ(200, 40), 0.5);\n"
        "console.log(JSON.stringify({sparse:sparse.length, dense:dense.length, capped:capped.length}));\n"
    ))
    assert out["sparse"] == 24, (
        "a 4-vertex target must still resample to exactly AUTOMORPH_N=24, "
        f"got {out['sparse']}"
    )
    assert out["dense"] == 40, (
        f"a 40-point target must keep its own density, got {out['dense']}"
    )
    assert out["capped"] == 64, (
        f"a 200-point target must cap at 64, got {out['capped']}"
    )


# ── Automorph slider 2: edge hardness (Garry, 2026-09-07) ───────────────────
# "The second slider is to make all the shapes from hard edges to soft, this
# one starts in the center." Centered at 0 = today's straight polygon,
# unchanged either direction; negative sharpens via a LOCAL Pucker-and-Bloat
# push (each point away from its own neighbours' midpoint — straight runs
# hold still, existing corners spike), positive smooths (a closed Catmull-Rom
# spline). The negative push is bounded twice: by 75% of the point's own
# shorter adjacent edge (no local self-intersection at -100) and by an
# absolute cap the aura call site derives from its inset margin (hardness
# must never eat the non-overlap gap between neighbouring cells).

def test_hardness_zero_is_the_straight_polygon_completely_unchanged(tmp_path):
    """The rest position's own contract: hardness=0 must produce the exact
    same M/L/Z straight-polygon path as before this slider existed, and
    applyHardness at 0 must not touch a single point."""
    out = _run_js(tmp_path, (
        "import { applyHardness, ringPathD } from './iso_lights.mjs';\n"
        "const ring=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const same = JSON.stringify(applyHardness(ring, 0)) === JSON.stringify(ring);\n"
        "const d = ringPathD(ring, 0);\n"
        "console.log(JSON.stringify({same, d}));\n"
    ))
    assert out["same"], "applyHardness(ring, 0) must return the ring's points completely untouched"
    assert out["d"] == "M0.0,0.0 L10.0,0.0 L10.0,10.0 L0.0,10.0Z", out["d"]


def test_hardness_negative_spikes_corners_and_holds_straight_runs_still(tmp_path):
    """Negative hardness is a LOCAL corner-sharpening operator (the
    Pucker-and-Bloat technique), not the old centroid inflate: each point
    is pushed away from the midpoint of its own two neighbours, so
    'harder' actually ADDS angularity instead of uniformly scaling the
    whole shape. Checked on a square listed WITH its edge midpoints: a
    midpoint is collinear with its neighbours (zero local deviation) and
    must not move AT ALL, while each true corner must spike outward within
    its own quadrant. Also pins the operator's structural invariants:
    point count preserved, and byte-identical output across two calls
    (a render must be reproducible from the fabric alone)."""
    ring = [[-10, -10], [0, -10], [10, -10], [10, 0],
            [10, 10], [0, 10], [-10, 10], [-10, 0]]
    out = _run_js(tmp_path, (
        "import { applyHardness } from './iso_lights.mjs';\n"
        f"const ring={json.dumps(ring)};\n"
        "const a=applyHardness(ring, -100);\n"
        "const b=applyHardness(ring, -100);\n"
        "console.log(JSON.stringify({a, same: JSON.stringify(a)===JSON.stringify(b), n: a.length}));\n"
    ))
    assert out["n"] == len(ring), "the operator must preserve the point count"
    assert out["same"], "applyHardness must be deterministic"
    for orig, p in zip(ring, out["a"]):
        if 0 in orig:
            # An edge midpoint: on the straight run between two corners.
            assert p == orig, f"straight-run point {orig} must not move, got {p}"
        else:
            # A true corner: must move strictly outward, same quadrant.
            assert abs(p[0]) > 10 and abs(p[1]) > 10, f"corner {orig} must spike outward, got {p}"
            assert p[0] * orig[0] > 0 and p[1] * orig[1] > 0, f"corner {orig} left its quadrant: {p}"


def test_hardness_negative_outward_push_respects_an_absolute_cap(tmp_path):
    """The hardness slider must never blow through the non-overlap gap:
    the optional third argument is a hard per-point displacement cap (the
    aura call site derives it from the same inset margin that created the
    gap). Every point's displacement must stay within the cap, cap=0 must
    return the ring completely unchanged (a zero inset means the ring
    already sits on the wall), and the cap must actually bind here —
    i.e. the uncapped push in this scenario is larger."""
    ring = [[-10, -10], [0, -10], [10, -10], [10, 0],
            [10, 10], [0, 10], [-10, 10], [-10, 0]]
    out = _run_js(tmp_path, (
        "import { applyHardness } from './iso_lights.mjs';\n"
        f"const ring={json.dumps(ring)};\n"
        "const disp=(r)=>Math.max(...r.map((p,i)=>Math.hypot(p[0]-ring[i][0], p[1]-ring[i][1])));\n"
        "const dCapped=disp(applyHardness(ring, -100, 2));\n"
        "const dFree=disp(applyHardness(ring, -100));\n"
        "const zeroSame=JSON.stringify(applyHardness(ring, -100, 0))===JSON.stringify(ring);\n"
        "console.log(JSON.stringify({dCapped, dFree, zeroSame}));\n"
    ))
    assert out["dCapped"] <= 2 + 1e-9, f"a point moved {out['dCapped']} past the cap of 2"
    assert out["dFree"] > 2, "the cap must actually bind in this scenario, or the test proves nothing"
    assert out["zeroSame"], "cap=0 (no gap at all) must leave the ring completely unchanged"


def test_hardness_negative_gain_is_linear_in_the_slider_and_exact_at_the_endpoint(tmp_path):
    """The negative side's amplitude anchor: push = (-h/100)*2 * local
    deviation. Without this, a slider-magnitude-blind gain (hardness -1
    spiking exactly like -100) passes every other hardness test — they pin
    direction, locality, quadrant, count, determinism and the two clamps,
    but no amplitude. Built on a shallow bump whose deviation (1) sits far
    under both clamps (adjacent edges ~10, no cap passed), so the raw gain
    formula is the ONLY thing deciding the displacement: -100 must double
    the deviation exactly, -50 half of that, -25 half again — the linear
    slider law, pinned at three points."""
    out = _run_js(tmp_path, (
        "import { applyHardness } from './iso_lights.mjs';\n"
        "const ring=[[0,0],[10,1],[20,0],[20,10],[0,10]];\n"
        "const bump=(h)=>applyHardness(ring, h)[1];\n"
        "console.log(JSON.stringify({m100:bump(-100), m50:bump(-50), m25:bump(-25)}));\n"
    ))
    assert out["m100"] == [10, 3], (
        f"at -100 the unclamped bump (deviation 1) must move by exactly 2: {out}"
    )
    assert out["m50"] == [10, 2], (
        f"at -50 the push must be exactly HALF the -100 endpoint's — gain is linear in -h: {out}"
    )
    assert out["m25"] == [10, 1.5], (
        f"at -25 the push must be exactly a quarter of the -100 endpoint's: {out}"
    )


def test_hardness_cap_is_derived_from_the_inset_margin_itself():
    """Structural pin, same discipline as the marginM multiplier pin: the
    absolute spike cap must be derived from the SAME margin the ring was
    just inset by — marginM*frame.scale (metres to px) * SQRT1_2 (the iso
    projection's most-compressed direction, so the cap holds whichever way
    a spike points) * 0.85 (spend at most 85% of the projected gap). No
    render test can pin this formula cheaply: with the inset ring holding
    its full-margin clearance, the 75%-of-edge clamp also bounds ordinary
    spikes, so a regressed cap only shows on shapes with long edges AND
    tight margins — exactly the combination a fixed scene doesn't stage."""
    src = _code_only((_VIEWS / "iso_lights.js").read_text(encoding="utf-8"))
    assert "const hardCapPx=marginM*frame.scale*Math.SQRT1_2*0.85;" in src, (
        "the hardness spike cap must stay derived from the inset margin that created "
        "the gap it protects — an Infinity or unrelated-constant cap silently re-opens "
        "the negative-hardness overlap defect on tight-margin scenes"
    )


def test_hardness_negative_push_cannot_exceed_the_local_edge_length(tmp_path):
    """Self-intersection guard: an already-sharp corner's amplified
    deviation could overshoot its own neighbours at -100, folding the
    outline over itself. The push is clamped to 75% of the shorter
    adjacent edge, so a spike is always shorter than the edges it grows
    between. Built on a needle whose deviation (~10) dwarfs its shortest
    edge (~0.71) — uncapped, the raw push would be ~20."""
    ring = [[10, 0], [9.5, 0.5], [-10, 1], [-10, -1]]
    short_edge = (0.5 ** 2 + 0.5 ** 2) ** 0.5  # [10,0] to [9.5,0.5]
    out = _run_js(tmp_path, (
        "import { applyHardness } from './iso_lights.mjs';\n"
        f"const ring={json.dumps(ring)};\n"
        "const r=applyHardness(ring, -100);\n"
        "const d0=Math.hypot(r[0][0]-ring[0][0], r[0][1]-ring[0][1]);\n"
        "console.log(JSON.stringify({d0}));\n"
    ))
    assert 0 < out["d0"] <= short_edge * 0.75 + 1e-9, \
        f"the needle point moved {out['d0']}, past 75% of its shorter edge ({short_edge * 0.75:.3f})"


def test_hardness_non_negative_is_exact_passthrough_even_with_a_cap(tmp_path):
    """The soft half lives entirely in ringPathD; applyHardness at any
    hardness >= 0 must return the very same array untouched regardless of
    the cap argument — the rest position (0) and the whole positive range
    must be unreachable by the new clamp plumbing."""
    out = _run_js(tmp_path, (
        "import { applyHardness } from './iso_lights.mjs';\n"
        "const ring=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const atZero=applyHardness(ring, 0, 5)===ring;\n"
        "const atSoft=applyHardness(ring, 60, 5)===ring;\n"
        "console.log(JSON.stringify({atZero, atSoft}));\n"
    ))
    assert out["atZero"], "hardness=0 with a cap must still be an exact (same-array) passthrough"
    assert out["atSoft"], "positive hardness with a cap must still be an exact (same-array) passthrough"


def test_hardness_positive_leaves_points_untouched_only_the_path_smooths(tmp_path):
    """Positive (soft) hardness is deliberately NOT a point transform —
    applyHardness must return the ring as-is; only ringPathD changes,
    producing cubic-Bezier ("C") segments, one per ring point, instead of
    straight lines."""
    out = _run_js(tmp_path, (
        "import { applyHardness, ringPathD } from './iso_lights.mjs';\n"
        "const ring=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const same = JSON.stringify(applyHardness(ring, 100)) === JSON.stringify(ring);\n"
        "const d = ringPathD(ring, 100);\n"
        "const cCount = (d.match(/C/g)||[]).length;\n"
        "const hasL = d.includes('L');\n"
        "console.log(JSON.stringify({same, cCount, hasL}));\n"
    ))
    assert out["same"], "positive hardness must not transform the ring's points"
    assert out["cCount"] == 4, "one cubic-bezier segment per ring point, at full softness"
    assert not out["hasL"], "a fully-softened path must not contain any straight-line (L) segments"


def test_hardness_softening_scales_continuously_with_the_slider(tmp_path):
    """A half-soft path (hardness=50) must sit strictly between the sharp
    corner (the straight polygon's own vertex) and the fully-softened
    curve's control point — proving the dial is continuous, not a hard
    flip between two fixed looks at some threshold."""
    out = _run_js(tmp_path, (
        "import { ringPathD } from './iso_lights.mjs';\n"
        "const ring=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const d0 = ringPathD(ring, 0);\n"
        "const d50 = ringPathD(ring, 50);\n"
        "const d100 = ringPathD(ring, 100);\n"
        "console.log(JSON.stringify({d0, d50, d100}));\n"
    ))
    assert "L" in out["d0"] and "C" not in out["d0"], out["d0"]
    assert "C" in out["d50"], out["d50"]
    assert "C" in out["d100"] and "L" not in out["d100"], out["d100"]
    assert out["d50"] != out["d100"], "50% soft must not already equal the fully-softened path"


def test_automorph_style_dropdown_switches_the_rendered_treatment(tmp_path):
    """Every style paints the SAME morphed ring differently — verified
    through the real renderer (buildIsoSVG), not just the pure geometry:
    glow (default) carries the aura's blur group (psaurasoft, its own
    clone of the pool filter) and a stroke, plus — this fixture is lit —
    exactly one masked inner bloom; blueprint is stroke-only with dashes
    and per-vertex node circles, no fill and no blur; nebula fills through
    the shared mask and has neither a blur group nor a stroke. An
    unrecognised style name must fall back to glow."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]}},
        "light_positions_m": {"light.lamp": {"x_m": 3, "y_m": 3, "floor_id": "main"}},
    }
    lbe = {"light.lamp": {"entity_id": "light.lamp", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None}}
    floors = [{"id": "main", "name": "Main", "level": 0}]

    def render(style):
        return _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const LBE={json.dumps(lbe)};\n"
            f"const FLOORS={json.dumps(floors)};\n"
            f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
            f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:50, automorphStyle:{json.dumps(style)}}});\n"
            "console.log(JSON.stringify({"
            "blur: (svg.match(/filter=\"url\\(#psaurasoft\\)\"/g)||[]).length,"
            "mask: (svg.match(/mask=\"url\\(#psautomorphmask\\)\"/g)||[]).length,"
            "dashed: svg.includes('stroke-dasharray=\"4,3\"'),"
            "}));\n"
        ))

    glow = render("glow")
    blueprint = render("blueprint")
    nebula = render("nebula")
    unknown = render("bogus")

    # glow's single mask application is the on-state inner bloom: the lit
    # material split borrows nebula's shared mask (one def, any number of
    # fixtures) rather than defining a second fade of its own.
    assert glow["blur"] >= 1 and not glow["dashed"] and glow["mask"] == 1, glow
    assert blueprint["dashed"] and blueprint["blur"] == 0 and blueprint["mask"] == 0, blueprint
    assert nebula["mask"] >= 1 and nebula["blur"] == 0 and not nebula["dashed"], nebula
    assert unknown == glow, "an unrecognised style name must fall back to glow, not silently render nothing"


def test_automorph_subtlety_thins_opacity_and_stroke_without_ever_reaching_zero(tmp_path):
    """0 must be today's exact opacity/stroke-width (the same contract every
    other Automorph control's rest position holds); 100 must be visibly
    thinner and fainter, but never fully invisible or zero-width — Garry
    asked for "almost completely lost", not gone."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]}},
        "light_positions_m": {"light.lamp": {"x_m": 3, "y_m": 3, "floor_id": "main"}},
    }
    lbe = {"light.lamp": {"entity_id": "light.lamp", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None}}
    floors = [{"id": "main", "name": "Main", "level": 0}]

    def render(subtlety):
        out = _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const LBE={json.dumps(lbe)};\n"
            f"const FLOORS={json.dumps(floors)};\n"
            f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
            f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:50, automorphStyle:'glow', automorphSubtlety:{subtlety}}});\n"
            # The wash's fill is the shared duotone gradient now (craft round:
            # interiors own the depth cue), so the probe keys on its url ref
            # rather than the old flat on-grey.
            "const m = svg.match(/<path d=\"[^\"]+\" fill=\"url\\(#psautomorphduo_on\\)\" fill-opacity=\"([\\d.]+)\"[^]*?stroke-width=\"([\\d.]+)\"/);\n"
            "console.log(JSON.stringify({fillOpacity: m ? parseFloat(m[1]) : null, strokeWidth: m ? parseFloat(m[2]) : null}));\n"
        ))
        return out

    at0 = render(0)
    at100 = render(100)
    assert at0["fillOpacity"] is not None and at100["fillOpacity"] is not None, (at0, at100)
    assert at100["fillOpacity"] < at0["fillOpacity"], (at0, at100)
    assert at100["fillOpacity"] > 0, "subtlety=100 must fade, not fully hide"
    assert at100["strokeWidth"] < at0["strokeWidth"], (at0, at100)
    assert at100["strokeWidth"] > 0, "subtlety=100 must thin, not zero out, the stroke"


# ── Automorph non-overlap partitioning (Garry, 2026-09-07: "give a thorough
# rethink to complete the logic of this feature") ───────────────────────────
# Before this, every fixture sharing a room grew toward the SAME full-room
# shape and piled on top of its neighbours. buildRoomFixtureCells instead
# gives each fixture its own region: a masked approximate-geodesic flood per
# fixture, weighted (and reach-capped) by its own manual footprint.

def test_automorph_fixture_weight_default_and_scaled(tmp_path):
    """No recorded manual size is a typical/default fixture (weight 1); a
    tiny footprint weighs less (a smaller reach cap later); a very long one
    weighs more, clamped so no single fixture's footprint can blow past the
    [0.25, 2.5] band regardless of how extreme the entered dimensions are."""
    out = _run_js(tmp_path, (
        "import { automorphFixtureWeight as w } from './iso_lights.mjs';\n"
        "console.log(JSON.stringify({"
        "unset: w(0,0), unsetNull: w(undefined,undefined), tiny: w(15,15), "
        "long: w(300,10), extreme: w(1,1)"
        "}));\n"
    ))
    assert out["unset"] == 1 and out["unsetNull"] == 1, out
    assert 0.25 <= out["tiny"] < 1, out
    assert out["long"] == 2.5, "a very long fixture's weight must clamp at the 2.5 ceiling"
    assert out["extreme"] == 0.25, "a near-zero footprint's weight must clamp at the 0.25 floor"


def test_partition_two_fixtures_get_non_overlapping_cells(tmp_path):
    """Two ordinary (default-weight) fixtures placed on opposite sides of a
    square room must each get a cell containing their OWN position and
    excluding the other's, and the two cells must not substantially overlap
    — sampled across the room's interior, only a thin sliver near the shared
    boundary may legitimately land in both (grid-resolution ambiguity right
    at the dividing line), never a broad swath."""
    out = _run_js(tmp_path, (
        "import { buildRoomFixtureCells, pointInPolygon } from './iso_lights.mjs';\n"
        "const room=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const fixtures=[{id:'a',x:2,y:5,weight:1},{id:'b',x:8,y:5,weight:1}];\n"
        "const cells=buildRoomFixtureCells(room, fixtures);\n"
        "const a=cells.get('a'), b=cells.get('b');\n"
        "const aHasOwn = a ? pointInPolygon(a, 2, 5) : false;\n"
        "const bHasOwn = b ? pointInPolygon(b, 8, 5) : false;\n"
        "const aHasOther = a ? pointInPolygon(a, 8, 5) : false;\n"
        "const bHasOther = b ? pointInPolygon(b, 2, 5) : false;\n"
        "let both=0, either=0;\n"
        "for(let x=0.5;x<10;x+=0.5) for(let y=0.5;y<10;y+=0.5){\n"
        "  const inA = a && pointInPolygon(a, x, y), inB = b && pointInPolygon(b, x, y);\n"
        "  if(inA||inB) either++;\n"
        "  if(inA&&inB) both++;\n"
        "}\n"
        "console.log(JSON.stringify({hasA: !!a, hasB: !!b, aHasOwn, bHasOwn, aHasOther, bHasOther, both, either}));\n"
    ))
    assert out["hasA"] and out["hasB"], f"both fixtures must resolve to a real cell: {out}"
    assert out["aHasOwn"] and out["bHasOwn"], f"a fixture's own cell must contain its own position: {out}"
    assert not out["aHasOther"] and not out["bHasOther"], (
        f"a fixture's cell must not contain the OTHER fixture's position — that was exactly "
        f"the pre-fix bug (every fixture grew toward the same shared target): {out}"
    )
    overlap_frac = out["both"] / out["either"]
    assert overlap_frac < 0.15, f"cells overlap too broadly to be a real partition: {out}"


def test_partition_single_tiny_fixture_stays_small_even_alone_in_its_room(tmp_path):
    """'Common sense' sizing (Garry, 2026-09-07): a fixture with a small
    recorded manual footprint must NOT balloon to fill most of the room just
    because it happens to be the only fixture present — the same reach-cap
    weighting that divides a room between several fixtures also caps a lone
    fixture's own cell, with no special-cased N=1 branch needed."""
    out = _run_js(tmp_path, (
        "import { buildRoomFixtureCells, automorphFixtureWeight } from './iso_lights.mjs';\n"
        "const room=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const area=(pts)=>{ let a=0; for(let i=0,j=pts.length-1;i<pts.length;j=i++) "
        "a+=pts[j][0]*pts[i][1]-pts[i][0]*pts[j][1]; return Math.abs(a)/2; };\n"
        "const tinyW=automorphFixtureWeight(15,15), defaultW=automorphFixtureWeight(0,0);\n"
        "const tinyCell=buildRoomFixtureCells(room, [{id:'x', x:1.2, y:1.2, weight:tinyW}]).get('x');\n"
        "const defaultCell=buildRoomFixtureCells(room, [{id:'x', x:1.2, y:1.2, weight:defaultW}]).get('x');\n"
        "console.log(JSON.stringify({tinyArea: tinyCell?area(tinyCell):null, defaultArea: defaultCell?area(defaultCell):null, roomArea: area(room)}));\n"
    ))
    assert out["tinyArea"] is not None and out["defaultArea"] is not None, out
    assert out["tinyArea"] < out["defaultArea"], (
        f"a tiny-footprint fixture alone in a room must still get a smaller cell than a "
        f"default-weight fixture alone in the same room: {out}"
    )
    assert out["defaultArea"] > out["roomArea"] * 0.5, (
        f"a default-weight lone fixture should still comfortably fill most of its room "
        f"(today's original v1 behaviour, unchanged for the common case): {out}"
    )


# ── Chaikin baseline smoothing of the automorph TARGET (2026-09-07 critique:
# the marching-squares cell rings render their sampling grid's stairstep as
# zig-zags even at hardness=0 — a NEW artifact the partition introduced, not
# what "0 = today's clean straight treatment" ever meant — and the room-trace
# fallback carries digitization noise and miter bevels of its own). The fix
# is chaikinSmooth, applied exactly once at automorphAuraSvg's targetPts
# choice so BOTH target kinds share one corner language.

def test_chaikin_smooth_cuts_corners_but_only_along_the_rings_own_edges(tmp_path):
    """One pass replaces each edge with its 25%/75% points: the point count
    doubles, the ring is treated as CLOSED (the last->first edge is cut like
    any other, and no original corner vertex survives), and every output
    point lies ON an edge of the input ring — the property that makes the
    pass unable to change topology or push a cell broadly into a
    neighbour's, unlike a blur or inflate. Two passes are exactly one pass
    applied twice, so that per-pass on-edge guarantee composes."""
    out = _run_js(tmp_path, (
        "import { chaikinSmooth } from './iso_lights.mjs';\n"
        "const ring=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const onEdge=(p)=>{ for(let i=0;i<ring.length;i++){\n"
        "  const a=ring[i], b=ring[(i+1)%ring.length];\n"
        "  const cross=Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));\n"
        "  const within=p[0]>=Math.min(a[0],b[0])-1e-9 && p[0]<=Math.max(a[0],b[0])+1e-9\n"
        "    && p[1]>=Math.min(a[1],b[1])-1e-9 && p[1]<=Math.max(a[1],b[1])+1e-9;\n"
        "  if(cross<1e-9 && within) return true; } return false; };\n"
        "const one=chaikinSmooth(ring, 1);\n"
        "const two=chaikinSmooth(ring, 2);\n"
        "const composed=chaikinSmooth(chaikinSmooth(ring, 1), 1);\n"
        "console.log(JSON.stringify({\n"
        "  oneLen: one.length, twoLen: two.length,\n"
        "  allOnEdge: one.every(onEdge),\n"
        "  cornerSurvives: one.some(p=>ring.some(q=>p[0]===q[0]&&p[1]===q[1])),\n"
        "  closingEdgeCut: one.some(p=>p[0]===0 && p[1]>0 && p[1]<10),\n"
        "  composes: JSON.stringify(two)===JSON.stringify(composed),\n"
        "}));\n"
    ))
    assert out["oneLen"] == 8 and out["twoLen"] == 16, f"each pass must double the point count: {out}"
    assert out["allOnEdge"], f"every smoothed point must lie on an edge of the input ring: {out}"
    assert not out["cornerSurvives"], f"corner cutting must remove every original corner vertex: {out}"
    assert out["closingEdgeCut"], f"the closing (last->first) edge must be cut like any other: {out}"
    assert out["composes"], f"two passes must equal one pass applied twice: {out}"


def test_chaikin_smooth_passthrough_clamp_and_determinism(tmp_path):
    """A degenerate under-3-point ring passes through untouched (never
    fabricate geometry from nothing); iterations clamp at 2 — past that,
    corner cutting starts eating an L-shaped trace's REAL concave corners
    rather than the grid noise it exists to remove; and the output is a pure
    function of the input ring alone — the same determinism contract the
    cell wobble already documents (the fabric alone must reproduce a
    render)."""
    out = _run_js(tmp_path, (
        "import { chaikinSmooth } from './iso_lights.mjs';\n"
        "const ring=[[0,0],[10,0],[10,10],[0,10]];\n"
        "const j=JSON.stringify;\n"
        "console.log(j({\n"
        "  twoPt: j(chaikinSmooth([[0,0],[5,5]], 2))===j([[0,0],[5,5]]),\n"
        "  empty: j(chaikinSmooth(null, 2))===j([]),\n"
        "  clamped: j(chaikinSmooth(ring, 5))===j(chaikinSmooth(ring, 2)),\n"
        "  zero: j(chaikinSmooth(ring, 0))===j(ring),\n"
        "  deterministic: j(chaikinSmooth(ring, 2))===j(chaikinSmooth(ring, 2)),\n"
        "}));\n"
    ))
    assert out["twoPt"], "an under-3-point ring must pass through untouched"
    assert out["empty"], "a null ring must come back as an empty ring, not a crash"
    assert out["clamped"], "iterations beyond 2 must clamp — over-smoothing eats real concave corners"
    assert out["zero"], "zero iterations must be a no-op"
    assert out["deterministic"], "same ring in, same points out — no hidden randomness"


def test_chaikin_is_applied_once_at_the_shared_target_choice():
    """The smoothing has exactly ONE application point — automorphAuraSvg's
    targetPts choice — so a resolved cell and the room.pts fallback get the
    identical corner language. Smoothing inside buildRoomFixtureCells AND at
    the call site would double-smooth every resolved cell while the fallback
    got a single pass; this pins the reconciled single-site scheme, and it
    keeps the stored cells raw so the non-overlap partition tests above
    measure the field competition itself, not a post-process of it.
    The densifyRing wrapper is part of the pinned shape: Chaikin's cut rides
    its input's edge length, so 'identical corner language' only holds when
    both target kinds enter at the same ~0.1m edge scale — without it the
    sparse room.pts fallback got metre-scale corner rounding where a cell
    ring got cm-scale cleanup (see the densify unit test below for the
    measured numbers)."""
    src = _code_only((_VIEWS / "iso_lights.js").read_text(encoding="utf-8"))
    calls = re.findall(r"(?<!function )chaikinSmooth\(", src)
    assert len(calls) == 1, f"expected exactly one chaikinSmooth call site, found {len(calls)}"
    assert "chaikinSmooth(densifyRing((cellPtsM && cellPtsM.length>=3) ? cellPtsM : room.pts, 0.1), 2)" in src, (
        "the one call site must wrap the cell/room-fallback choice itself — densified "
        "to the same ~0.1m edge scale — so both target kinds are smoothed identically"
    )


def test_densify_makes_the_sparse_fallback_smoothing_cm_scale(tmp_path):
    """Chaikin's cut rides its input's edge length, so the same two passes
    that clean cm-scale grid noise off a ~0.1m-edged cell ring rounded the
    sparse 4-8-vertex room.pts fallback at METRE scale — measured: a 6x4m
    room's smoothed fallback passed 0.83m inside its own corner, on input
    that had zero digitization noise to remove, defeating 'barely changing
    the traced position'. Pre-densified to ~0.1m edges the identical call
    passes within ~2cm of the corner — the cells' corner language, at the
    cells' scale. Also pins densifyRing's own contract: original vertices
    kept exactly (subdivision only, never displacement), and an already-
    dense ring passes through as a no-op."""
    out = _run_js(tmp_path, (
        "import { chaikinSmooth, densifyRing } from './iso_lights.mjs';\n"
        "const sq=[[0,0],[6,0],[6,4],[0,4]];\n"
        "const corner=(pts)=>Math.min(...pts.map(p=>Math.hypot(p[0]-6, p[1]-0)));\n"
        "const raw=corner(chaikinSmooth(sq, 2));\n"
        "const dens=corner(chaikinSmooth(densifyRing(sq, 0.1), 2));\n"
        "const kept=densifyRing(sq, 0.1).some(p=>p[0]===6&&p[1]===0);\n"
        "const fine=[[0,0],[0.05,0],[0.1,0],[0.1,0.05],[0.1,0.1],[0,0.1]];\n"
        "const noop=JSON.stringify(densifyRing(fine, 0.1))===JSON.stringify(fine);\n"
        "console.log(JSON.stringify({raw:+raw.toFixed(3), dens:+dens.toFixed(3), kept, noop}));\n"
    ))
    assert out["raw"] > 0.8, (
        f"the raw sparse ring should document the defect scale (~0.83m of corner cut): {out}"
    )
    assert out["dens"] < 0.05, (
        f"the densified ring must keep the smoothing at cm scale — the fallback aura has "
        f"to track the room's actual corners: {out}"
    )
    assert out["kept"], "densifyRing must keep every original vertex exactly — subdivision only"
    assert out["noop"], "a ring already at or under the edge scale must pass through untouched"


def test_automorph_two_fixtures_sharing_a_room_render_different_auras(tmp_path):
    """End-to-end through the real renderer: two fixtures placed in the SAME
    room must render two DIFFERENT aura outlines at pct=100 — before this,
    both fixtures resampled the identical full-room boundary and produced
    the same point set (visually, two auras stacked on each other). Uses
    hardness=0 (plain M/L/Z, easy to parse) and the 'blueprint' style, whose
    dashed single-path-per-fixture output (see the style-dropdown test
    above) is unambiguous to pull two separate 'd' strings out of."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            "light.a": {"x_m": 1.5, "y_m": 2, "floor_id": "main"},
            "light.b": {"x_m": 6.5, "y_m": 2, "floor_id": "main"},
        },
    }
    lbe = {
        "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.b": {"entity_id": "light.b", "state": "on", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:100, automorphHardness:0, automorphStyle:'blueprint'}});\n"
        "const ds = [...svg.matchAll(/<path d=\"([^\"]+)\" fill=\"none\" stroke=\"[^\"]+\" \"?stroke-opacity/g)].map(m=>m[1]);\n"
        "const ds2 = [...svg.matchAll(/<path d=\"([^\"]+)\"[^>]*stroke-dasharray=\"4,3\"/g)].map(m=>m[1]);\n"
        "console.log(JSON.stringify({count: ds2.length, d0: ds2[0]||null, d1: ds2[1]||null}));\n"
    ))
    assert out["count"] == 2, f"expected exactly one blueprint aura path per fixture: {out}"
    assert out["d0"] and out["d1"] and out["d0"] != out["d1"], (
        f"the two fixtures' aura outlines must differ — identical outlines mean the partition "
        f"was not applied and both fell back to the same full-room shape: {out}"
    )


def test_automorph_rendered_rings_are_simple_and_never_cross_a_neighbours(tmp_path):
    """The two invariants the whole inset stage exists to deliver, checked
    on the DRAWN rings end-to-end — no earlier test ever parsed a rendered
    ring for simplicity or tested two rendered rings against each other,
    which is exactly how both defects shipped green:

    - SIMPLE: every emitted aura ring must have zero self-intersections.
      Before the resample-before-offset + fold-pruning repair, feeding
      offsetPolygonInward the raw Chaikin output rendered every ring in
      the 3-fixture strip scene with 5 self-crossing bowtie loops at the
      hardness slider's REST position.
    - SEPARATED: no ring vertex may sit inside a neighbouring fixture's
      ring by more than ~1px, at ANY hardness. Before the repair the
      4-downlight square scene penetrated 6.0px at hardness 0, and the
      strip's ring genuinely crossed its neighbour's at 6 segment pairs
      at -100 — hardCapPx's "can never eat the gap" argument was void
      because the inset ring never had the gap to begin with.

    Two scenes on purpose: the 4-pack of even circles (the symmetric
    common case) and the 10x4m strip room whose 240cm rotated bar takes
    weight 2.5 and carves concave neighbour cells (the hard case that
    produced the worst folds). Hardness sweeps the full slider: -100
    spikes, 0 straight polygons, +100 Catmull-Rom curves (whose on-curve
    points are the ring's own vertices — the same ring, parsed from the
    C endpoints)."""
    NOW = 1_000_000_000_000
    pack_model = {
        "room_geometry_m": {"Sq": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]}},
        "light_positions_m": {
            "light.p1": {"x_m": 1.5, "y_m": 1.5, "floor_id": "main"},
            "light.p2": {"x_m": 3.5, "y_m": 1.5, "floor_id": "main"},
            "light.p3": {"x_m": 1.5, "y_m": 3.5, "floor_id": "main"},
            "light.p4": {"x_m": 3.5, "y_m": 3.5, "floor_id": "main"},
        },
    }
    pack_lbe = {
        f"light.p{i}": {"entity_id": f"light.p{i}", "state": "on", "code": f"A0{i}",
                        "shape": "circle", "isMotion": False, "last_changed": None}
        for i in (1, 2, 3, 4)
    }
    strip_model = {
        "room_geometry_m": {"Wide": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [10, 0], [10, 4], [0, 4]]}},
        "light_positions_m": {
            "light.a": {"x_m": 1.5, "y_m": 2, "floor_id": "main"},
            "light.b": {"x_m": 5.0, "y_m": 2, "floor_id": "main", "width_cm": 240, "height_cm": 5, "rotation": 30},
            "light.c": {"x_m": 8.5, "y_m": 2, "floor_id": "main"},
        },
    }
    strip_lbe = {
        "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.b": {"entity_id": "light.b", "state": "on", "code": "A02", "shape": "bar", "isMotion": False, "last_changed": None},
        "light.c": {"entity_id": "light.c", "state": "on", "code": "A03", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const PACK={json.dumps(pack_model)};\n"
        f"const PACKL={json.dumps(pack_lbe)};\n"
        f"const STRIP={json.dumps(strip_model)};\n"
        f"const STRIPL={json.dumps(strip_lbe)};\n"
        "const FLOORS=[{id:'main',name:'Main',level:0}];\n"
        "const pip=(pts,x,y)=>{let s=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){"
        "const xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1];"
        "if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))s=!s;}return s;};\n"
        "const dTo=(pts,x,y)=>{let b=Infinity;for(let i=0;i<pts.length;i++){"
        "const a=pts[i],c=pts[(i+1)%pts.length];const dx=c[0]-a[0],dy=c[1]-a[1],L2=dx*dx+dy*dy;"
        "let t=L2>0?((x-a[0])*dx+(y-a[1])*dy)/L2:0;t=Math.max(0,Math.min(1,t));"
        "b=Math.min(b,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t));}return b;};\n"
        "const segX=(a,b,c,d)=>{const d1x=b[0]-a[0],d1y=b[1]-a[1],d2x=d[0]-c[0],d2y=d[1]-c[1];"
        "const den=d1x*d2y-d1y*d2x;if(Math.abs(den)<1e-12)return false;"
        "const t=((c[0]-a[0])*d2y-(c[1]-a[1])*d2x)/den,u=((c[0]-a[0])*d1y-(c[1]-a[1])*d1x)/den;"
        "return t>1e-9&&t<1-1e-9&&u>1e-9&&u<1-1e-9;};\n"
        "const selfX=(r)=>{let c=0;const n=r.length;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){"
        "if((j+1)%n===i||(i+1)%n===j)continue;if(segX(r[i],r[(i+1)%n],r[j],r[(j+1)%n]))c++;}return c;};\n"
        "const parseRing=(d)=>{\n"
        "  if(d.includes('C')){\n"
        "    const m0=d.match(/^M(-?[\\d.]+),(-?[\\d.]+)/);\n"
        "    const pts=[[+m0[1],+m0[2]]];\n"
        "    for(const c of d.matchAll(/C(-?[\\d.]+),(-?[\\d.]+) (-?[\\d.]+),(-?[\\d.]+) (-?[\\d.]+),(-?[\\d.]+)/g)) pts.push([+c[5],+c[6]]);\n"
        "    if(pts.length>1&&pts[0][0]===pts[pts.length-1][0]&&pts[0][1]===pts[pts.length-1][1]) pts.pop();\n"
        "    return pts;\n"
        "  }\n"
        "  return [...d.matchAll(/[ML](-?[\\d.]+),(-?[\\d.]+)/g)].map(m=>[+m[1],+m[2]]);\n"
        "};\n"
        "const rings=(model,lbe,h)=>{\n"
        "  const svg=M.buildIsoSVG(model,{},new Set(),null,150,0,lbe,false,FLOORS,\n"
        "    {nowMs:1000000000000,automorph:true,automorphRoomPct:100,automorphHardness:h,automorphStyle:'glow'});\n"
        "  return [...svg.matchAll(/<path d=\"([^\"]+)\" fill=\"url\\(#psautomorphduo_(?:on|off)\\)\" fill-opacity=\"[\\d.]+\" stroke=\"#/g)].map(m=>parseRing(m[1]));\n"
        "};\n"
        "const audit=(model,lbe,h)=>{\n"
        "  const rs=rings(model,lbe,h);\n"
        "  let pen=0;\n"
        "  for(let i=0;i<rs.length;i++)for(let j=0;j<rs.length;j++){if(i===j)continue;\n"
        "    for(const [x,y] of rs[i]) if(pip(rs[j],x,y)) pen=Math.max(pen,dTo(rs[j],x,y));}\n"
        "  return {n:rs.length, pen:+pen.toFixed(2), selfX:rs.reduce((a,r)=>a+selfX(r),0)};\n"
        "};\n"
        "const out={};\n"
        "for(const h of [-100,0,100]){ out['pack_'+h]=audit(PACK,PACKL,h); out['strip_'+h]=audit(STRIP,STRIPL,h); }\n"
        "console.log(JSON.stringify(out));\n"
    ))
    for h in (-100, 0, 100):
        pack, strip = out[f"pack_{h}"], out[f"strip_{h}"]
        assert pack["n"] == 4 and strip["n"] == 3, (
            f"expected one edgeCore ring per fixture at hardness {h}: {out}"
        )
        assert pack["selfX"] == 0 and strip["selfX"] == 0, (
            f"every rendered aura ring must be SIMPLE at hardness {h} — a self-crossing "
            f"bowtie means the offset stage folded and nothing pruned it: {out}"
        )
        assert pack["pen"] <= 1.0 and strip["pen"] <= 1.0, (
            f"no ring vertex may sit inside a neighbouring fixture's ring by more than "
            f"~1px at hardness {h} — the non-overlap gap was spent before hardness even "
            f"ran: {out}"
        )


# ── Automorph icon endpoint: the fixture's REAL manual footprint ────────────
# (Garry, 2026-09-07: "the existing manual shapes are still meant to be a
# guide for the overall look, don't throw that info away.") The morph's
# starting shape is automorphIconRing — iconRingLocal scaled and rotated by
# the SAME markerScale transform the real glyph already draws with — so a
# strip's aura grows from its own long, angled footprint, not a generic hex.

def test_automorph_icon_ring_without_manual_size_is_exactly_the_plain_icon(tmp_path):
    """No recorded width/height and no rotation must be a byte-for-byte
    no-op — the same identity contract every other Automorph control's rest
    position holds, so no existing fixture's aura moves a pixel."""
    out = _run_js(tmp_path, (
        "import { automorphIconRing, iconRingLocal } from './iso_lights.mjs';\n"
        "const a=automorphIconRing('circle', 0, 0, 0, 30, 10);\n"
        "const b=iconRingLocal('circle', 10);\n"
        "console.log(JSON.stringify({equal: JSON.stringify(a)===JSON.stringify(b)}));\n"
    ))
    assert out["equal"], "no manual size + no rotation must return iconRingLocal's own points untouched"


def test_automorph_icon_ring_scales_per_axis_and_rotates_like_the_real_glyph(tmp_path):
    """A wide manual footprint must stretch the ring along x (and leave y at
    its soft-floored height); rotating the same fixture 90° must carry that
    long axis to y — the same scale-then-rotate order the real glyph's own
    `rotate(rot) scale(sx,sy)` transform applies to each point."""
    out = _run_js(tmp_path, (
        "import { automorphIconRing } from './iso_lights.mjs';\n"
        "const ext=(pts)=>{let x=0,y=0;for(const p of pts){x=Math.max(x,Math.abs(p[0]));y=Math.max(y,Math.abs(p[1]));}return {x,y};};\n"
        "const plain=ext(automorphIconRing('square', 0, 0, 0, 30, 10));\n"
        "const wide=ext(automorphIconRing('square', 400, 20, 0, 30, 10));\n"
        "const wideTurned=ext(automorphIconRing('square', 400, 20, 90, 30, 10));\n"
        "console.log(JSON.stringify({plain, wide, wideTurned}));\n"
    ))
    plain, wide, turned = out["plain"], out["wide"], out["wideTurned"]
    assert wide["x"] > plain["x"] * 2, f"a 4 m width must visibly stretch the ring along x: {out}"
    assert wide["x"] > wide["y"] * 2, f"the stretched ring must actually be wide, not scaled uniformly: {out}"
    assert abs(turned["x"] - wide["y"]) < 1e-6 and abs(turned["y"] - wide["x"]) < 1e-6, (
        f"rotating 90° must swap the long axis exactly: {out}"
    )


def test_automorph_aura_grows_from_the_real_manual_footprint_not_a_generic_hex(tmp_path):
    """End-to-end: at a low room%, a fixture with a real 240cm-wide manual
    footprint must render a much WIDER aura outline than the identical
    fixture with no manual size — before this, both started from the same
    small default-radius icon and the manual shape information never reached
    the morph at all."""
    NOW = 1_000_000_000_000

    def render(extra_lp):
        model = {
            "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 8], [0, 8]]}},
            "light_positions_m": {"light.strip": {"x_m": 4, "y_m": 4, "floor_id": "main", **extra_lp}},
        }
        lbe = {"light.strip": {"entity_id": "light.strip", "state": "on", "code": "W01", "shape": "bar", "isMotion": False, "last_changed": None}}
        floors = [{"id": "main", "name": "Main", "level": 0}]
        out = _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const LBE={json.dumps(lbe)};\n"
            f"const FLOORS={json.dumps(floors)};\n"
            f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
            f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:1, automorphHardness:0, automorphStyle:'blueprint'}});\n"
            "const m = svg.match(/<path d=\"([^\"]+)\"[^>]*stroke-dasharray=\"4,3\"/);\n"
            "if(!m){ console.log(JSON.stringify({w: null})); }\n"
            "else {\n"
            "  const nums=[...m[1].matchAll(/(-?[\\d.]+),(-?[\\d.]+)/g)].map(mm=>[parseFloat(mm[1]),parseFloat(mm[2])]);\n"
            "  const xs=nums.map(p=>p[0]);\n"
            "  console.log(JSON.stringify({w: Math.max(...xs)-Math.min(...xs)}));\n"
            "}\n"
        ))
        return out["w"]

    plain_w = render({})
    manual_w = render({"width_cm": 240, "height_cm": 5, "rotation": 0})
    assert plain_w is not None and manual_w is not None, (plain_w, manual_w)
    assert manual_w > plain_w * 2, (
        f"a 240cm manual width must make the aura's outline visibly wider than the "
        f"default icon's ({manual_w} vs {plain_w}) — the manual footprint must reach the morph"
    )


# ── Automorph aura draw order, room clip and interior margin ────────────────
# (the composition/craft round of the 2026-09-07 design critique)
# The aura used to be appended from the placed-lights loop — after the
# deferred label pass, interleaved fixture by fixture, unclipped, and inset
# by a margin tuned only for the wall case. Each test below pins one of the
# corrections.

def test_automorph_aura_paints_under_room_labels_in_two_floor_tiers(tmp_path):
    """Composition: labels must paint over every boundary line on the floor
    — the file's own documented rule — so every aura tier flushes BEFORE the
    label pass, never after it the way the placed-lights loop used to.
    Craft: the tiers are floor-wide, all blurred glow then all crisp edges,
    so one fixture's wash can never paint over the crisp bisector edge its
    neighbour already drew (the same underlay discipline the light pools
    document for markers). Final order, bottom to top: room fills/borders,
    all aura glow, all aura edges, labels, markers/glyphs."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            "light.a": {"x_m": 1.5, "y_m": 2, "floor_id": "main"},
            "light.b": {"x_m": 6.5, "y_m": 2, "floor_id": "main"},
        },
    }
    lbe = {
        "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.b": {"entity_id": "light.b", "state": "on", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:60, automorphHardness:0, automorphStyle:'glow'}});\n"
        # In working mode only the aura's glow tier carries psaurasoft, and
        # only the aura's edgeCore layer strokes in the on-state grey.
        "console.log(JSON.stringify({\n"
        "  glowCount: (svg.match(/filter=\"url\\(#psaurasoft\\)\"/g)||[]).length,\n"
        "  glowLast: svg.lastIndexOf('filter=\"url(#psaurasoft)\"'),\n"
        "  edgeFirst: svg.indexOf('stroke=\"#94a3b8\"'),\n"
        "  edgeLast: svg.lastIndexOf('stroke=\"#94a3b8\"'),\n"
        "  labelFirst: svg.indexOf('<g class=\"lroom\"'),\n"
        "  markerFirst: svg.indexOf('<g class=\"lhex\"'),\n"
        "}));\n"
    ))
    assert out["glowCount"] == 2, (
        f"expected exactly ONE blur group per fixture — the shadow/AO/wash/bloom "
        f"layers must share a single feGaussianBlur, never carry one each: {out}"
    )
    assert out["edgeFirst"] >= 0 and out["labelFirst"] >= 0 and out["markerFirst"] >= 0, out
    assert out["glowLast"] < out["edgeFirst"], (
        f"every fixture's glow must flush before any fixture's crisp edge — interleaving "
        f"lets a wash muddy a neighbour's already-drawn bisector edge: {out}"
    )
    assert out["edgeLast"] < out["labelFirst"], (
        f"every aura tier must land before the first room label — auras were painting "
        f"over the room's own name: {out}"
    )
    assert out["labelFirst"] < out["markerFirst"], (
        f"markers/glyphs must stay above the labels, unchanged by the aura move: {out}"
    )


def test_automorph_aura_is_clipped_to_its_room_in_both_modes(tmp_path):
    """The aura is gated on its own slider, never on Showcase — so its room
    clip must exist and be APPLIED on the working map too. While the
    clipPath defs were built only under if(SHOW), roomClip stayed empty for
    the whole working-mode render and the aura's blur/hardness overshoot
    had nothing stopping it at the room's own wall. The defs are gated on
    (SHOW || Automorph): present the moment anything can reference them,
    absent otherwise — the working map with Automorph off is contractually
    byte-identical to the pre-Automorph render (see
    test_automorph_off_render_carries_no_automorph_defs)."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]}},
        "light_positions_m": {"light.lamp": {"x_m": 3, "y_m": 3, "floor_id": "main"}},
    }
    lbe = {"light.lamp": {"entity_id": "light.lamp", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None}}
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const mk=(o)=>M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        f"const on=mk({{nowMs:{NOW}, automorph:true, automorphRoomPct:50, automorphStyle:'glow'}});\n"
        f"const off=mk({{nowMs:{NOW}}});\n"
        "console.log(JSON.stringify({\n"
        "  defOn: /<clipPath id=\"psclip_0\"><polygon /.test(on),\n"
        "  appliedOn: (on.match(/clip-path=\"url\\(#psclip_0\\)\"/g)||[]).length,\n"
        "  defOff: /<clipPath id=\"psclip_0\"><polygon /.test(off),\n"
        "  appliedOff: (off.match(/clip-path=/g)||[]).length,\n"
        "}));\n"
    ))
    assert out["defOn"], "working mode with Automorph on defined no room clipPath"
    # glow style: the blurred wash clips inside its filter group AND the
    # edge/gloss tier clips — two applications for one fixture.
    assert out["appliedOn"] >= 2, f"the aura tiers must be clipped to their room: {out}"
    assert not out["defOff"], (
        "with Automorph off nothing can reference a room clip on the working map, "
        "so no psclip_ def may be emitted — the off render is byte-identical to pre-Automorph"
    )
    assert out["appliedOff"] == 0, f"nothing may APPLY a clip on the working map with Automorph off: {out}"


def test_automorph_off_render_carries_no_automorph_defs(tmp_path):
    """The byte-identity contract, policed structurally: with Automorph off
    the render may carry NONE of the aura-only defs — psautomorphduo_*,
    psaurasoft, psglossauto_*, psclip_* (and, in working mode, the
    Showcase-owned psclipsoft too) — because nothing in that render can
    reference them. They were briefly emitted unconditionally: ~1-1.7KB of
    dead DOM per render in the most common configuration (working map,
    feature off), and a byte-level break of the automorph-off identity
    contract. With the slider up they must all appear. In showcase-off the
    Showcase-owned psclipsoft/psclip_ defs sit at their pre-Automorph
    position AFTER the pool gradients, so def ORDER is byte-identical to
    that era too; with Automorph on they sit BEFORE if(SHOW), because the
    working map needs them regardless of Showcase."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
            "Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 4], [6, 4], [6, 8], [0, 8]]},
        },
        "light_positions_m": {
            "light.a": {"x_m": 3, "y_m": 2, "floor_id": "main"},
            "light.b": {"x_m": 3, "y_m": 6, "floor_id": "main"},
        },
    }
    lbe = {
        "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.b": {"entity_id": "light.b", "state": "off", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        "const mk=(o)=>M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        "const auto={automorph:true, automorphRoomPct:50, automorphStyle:'glow'};\n"
        f"const workOff=mk({{nowMs:{NOW}}});\n"
        f"const workOn=mk({{nowMs:{NOW}, ...auto}});\n"
        f"const showOff=mk({{nowMs:{NOW}, showcase:true}});\n"
        f"const showOn=mk({{nowMs:{NOW}, showcase:true, ...auto}});\n"
        "const hits=(s)=>({duo:s.includes('psautomorphduo_'), aura:s.includes('psaurasoft'),"
        " gloss:s.includes('psglossauto_'), clip:s.includes('psclip_'), soft:s.includes('psclipsoft')});\n"
        "const clipVsGlow=(s)=>s.indexOf('<clipPath id=\"psclip_0\"')-s.indexOf('<radialGradient id=\"psglow_0\"');\n"
        "console.log(JSON.stringify({\n"
        "  workOff: hits(workOff), workOn: hits(workOn), showOff: hits(showOff),\n"
        "  showOffOrder: clipVsGlow(showOff), showOnOrder: clipVsGlow(showOn),\n"
        "}));\n"
    ))
    assert out["workOff"] == {"duo": False, "aura": False, "gloss": False, "clip": False, "soft": False}, (
        f"the working map with Automorph off must carry NO aura or Showcase defs at all: {out['workOff']}"
    )
    assert out["workOn"] == {"duo": True, "aura": True, "gloss": True, "clip": True, "soft": True}, (
        f"with the slider up every aura def must be present on the working map: {out['workOn']}"
    )
    assert out["showOff"] == {"duo": False, "aura": False, "gloss": False, "clip": True, "soft": True}, (
        f"showcase with Automorph off keeps its own psclipsoft/psclip_ defs but no aura-only ones: {out['showOff']}"
    )
    assert out["showOffOrder"] > 0, (
        "showcase-off must emit psclip_0 AFTER psglow_0 — the pre-Automorph def order the "
        "byte-identity contract covers"
    )
    assert out["showOnOrder"] < 0, (
        "with Automorph on psclip_0 is emitted before the Showcase-only defs — the working "
        "map needs it regardless of Showcase"
    )


def test_automorph_interior_margin_is_a_larger_multiple_of_the_wall_margin():
    """One inset constant was serving two different composition jobs:
    defaultPerimeterMarginM is tuned for a shape a plausible cove-distance
    off a static WALL, but a resolved cell's inset separates two
    comparably-weighted aura objects from EACH OTHER — and 2x a wall-tuned
    margin between neighbours read as tiles laid nearly edge-to-edge. The
    interior case gets a distinctly larger multiple (1.6x) of the same
    frame-scaled base; the room-outline fallback keeps 1x; the
    roomHalfMinDim clamp stays outside the multiplier so a tight cell can
    never be inset past its own middle. Pinned structurally, the same way
    the single chaikinSmooth call site is."""
    src = _code_only((_VIEWS / "iso_lights.js").read_text(encoding="utf-8"))
    assert "const hasCell=!!(cellPtsM && cellPtsM.length>=3);" in src, (
        "the margin multiplier must key on the same cell test the targetPts choice uses"
    )
    assert "Math.min(defaultPerimeterMarginM(frame)*(hasCell?1.6:1), roomHalfMinDim(targetPts)*0.85)" in src, (
        "the interior (resolved-cell) inset must be 1.6x the wall-tuned base margin, the "
        "room fallback 1x, with the half-min-dimension clamp still bounding the product"
    )


def test_automorph_cornered_fixture_loses_its_cell_but_never_its_aura(tmp_path):
    """The hasCell=false fallback (room.pts target, 1x margin) is reachable
    through the REAL partition, not just a code path the pins above
    protect: a weight-0.25 fixture 5cm into a corner, crowded by three
    weight-2.5 neighbours packed around it, is squeezed to nothing by the
    field competition and comes back ABSENT from buildRoomFixtureCells —
    its cue to fall back to the full-room shape rather than draw nothing.
    Every other aura render in this file resolves a cell, so a runtime
    break of only the fallback (`if(!hasCell) return null;`) left both
    structural pins intact and the whole suite green while the cornered
    fixture silently lost the aura the code comment promises it keeps.
    The weights go through automorphFixtureWeight from the SAME footprints
    the render sees, so the direct partition call proves the render scene
    itself takes the fallback branch."""
    NOW = 1_000_000_000_000
    room_pts = [[0, 0], [8, 0], [8, 4], [0, 4]]
    model = {
        "room_geometry_m": {"Hall": {"type": "poly", "floor_id": "main", "points_m": room_pts}},
        "light_positions_m": {
            "light.t":  {"x_m": 0.05, "y_m": 0.05, "floor_id": "main", "width_cm": 5,   "height_cm": 5},
            "light.b1": {"x_m": 0.3,  "y_m": 0.3,  "floor_id": "main", "width_cm": 300, "height_cm": 300},
            "light.b2": {"x_m": 0.05, "y_m": 0.5,  "floor_id": "main", "width_cm": 300, "height_cm": 300},
            "light.b3": {"x_m": 0.5,  "y_m": 0.05, "floor_id": "main", "width_cm": 300, "height_cm": 300},
        },
    }
    lbe = {
        eid: {"entity_id": eid, "state": "on", "code": f"A0{i}", "shape": "circle",
              "isMotion": False, "last_changed": None}
        for i, eid in enumerate(("light.t", "light.b1", "light.b2", "light.b3"), 1)
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const ROOM={json.dumps(room_pts)};\n"
        "const wT=M.automorphFixtureWeight(5,5), wB=M.automorphFixtureWeight(300,300);\n"
        "const cells=M.buildRoomFixtureCells(ROOM,[\n"
        "  {id:'t',x:0.05,y:0.05,weight:wT},{id:'b1',x:0.3,y:0.3,weight:wB},\n"
        "  {id:'b2',x:0.05,y:0.5,weight:wB},{id:'b3',x:0.5,y:0.05,weight:wB}]);\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:100, automorphHardness:0, automorphStyle:'glow'}});\n"
        "console.log(JSON.stringify({wT, wB, keys:[...cells.keys()].sort(),\n"
        "  auraGroups:(svg.match(/filter=\"url\\(#psaurasoft\\)\"/g)||[]).length}));\n"
    ))
    assert out["wT"] == 0.25 and out["wB"] == 2.5, (
        f"the scene leans on the weight clamps — a 5x5cm footprint must floor at 0.25 and "
        f"a 300x300cm one ceiling at 2.5, or the crowding below proves nothing: {out}"
    )
    assert out["keys"] == ["b1", "b2", "b3"], (
        f"the partition itself must omit the crowded corner fixture (and ONLY it) — "
        f"otherwise this scene never exercises the fallback branch: {out}"
    )
    assert out["auraGroups"] == 4, (
        f"one glow-tier aura group per fixture: the cell-less fixture must still paint "
        f"its aura through the room-shape fallback, never silently lose it: {out}"
    )


def test_automorph_suppresses_the_glyph_only_where_an_aura_really_painted(tmp_path):
    """The suppressGlyph decision must track what the floor-wide aura pass
    ACTUALLY emitted, per fixture — not the bare slider value. A fixture in
    a room gets an aura, so its old glyph body hides (transparent hit
    silhouette only); a hallway fixture outside every room polygon gets no
    aura, and hiding its glyph too would leave nothing drawn there at all.
    Guards the aura-generation move into the tier pass: the placed-lights
    loop no longer computes the aura itself, so it must consult the pass's
    own per-fixture record."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]}},
        "light_positions_m": {
            "light.inroom": {"x_m": 3, "y_m": 3, "floor_id": "main"},
            "light.hallway": {"x_m": 9, "y_m": 9, "floor_id": "main"},
        },
    }
    lbe = {
        "light.inroom": {"entity_id": "light.inroom", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.hallway": {"entity_id": "light.hallway", "state": "on", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:50, automorphStyle:'glow'}});\n"
        "const grab=(eid)=>{const g=new RegExp('<g class=\"lhex\" data-eid=\"'+eid+'\"[^>]*>([\\\\s\\\\S]*?)</g>').exec(svg); return g?g[1]:null;};\n"
        "const visible=(b)=>/<(rect(?! data-hit)|polygon|circle|path)[^>]*fill=\"(?!transparent|none)/.test(b);\n"
        "const hit=(b)=>/data-hit=\"1\" fill=\"transparent\"/.test(b);\n"
        "const inroom=grab('light\\\\.inroom'), hall=grab('light\\\\.hallway');\n"
        "console.log(JSON.stringify({\n"
        "  found: !!(inroom&&hall),\n"
        "  inroomVisible: inroom?visible(inroom):null, inroomHit: inroom?hit(inroom):null,\n"
        "  hallVisible: hall?visible(hall):null,\n"
        "}));\n"
    ))
    assert out["found"], "one of the two markers lost its lhex group entirely"
    assert not out["inroomVisible"], "the aura'd fixture's old glyph body must be suppressed"
    assert out["inroomHit"], "the suppressed glyph must keep its transparent hit silhouette"
    assert out["hallVisible"], (
        "a fixture outside every room polygon gets no aura — suppressing its glyph too "
        "would leave nothing drawn there at all"
    )


# ── Automorph material stack (the light/composition round of the 2026-09-07
# design critique) ──────────────────────────────────────────────────────────
# The glow style used to be three layers stamped in one position — wash,
# flat stroke, gloss — a decal. The stack now gives the aura a material
# read: a displaced cast shadow (it sits ON the floor), an ambient-
# occlusion ring (it has a cross-section), a rim stroked with the floor's
# own psglossauto ramp (lit from the drawing's one upper-left sun), an
# on-only masked inner bloom (a lit fixture EMITS; an inert one doesn't),
# and fill ceilings rebalanced to stay under the room's own colour weight.
# All of it blurs through ONE group filter per fixture, and every layer
# routes opacity/width through the same subtlety multipliers as the
# originals.

def _aura_probe(tmp_path, *, state="on", pct=100, style="glow", subtlety=0):
    """Working-mode render of one lit-or-not fixture with Automorph up —
    the smallest scene that exercises the full aura material stack — with
    each layer's numbers extracted for assertion. In working mode the aura
    is the only filter user, and #020617 is the aura's shadow/AO ink
    alone, so the probes cannot alias anything else on the map."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]}},
        "light_positions_m": {"light.lamp": {"x_m": 3, "y_m": 3, "floor_id": "main"}},
    }
    lbe = {"light.lamp": {"entity_id": "light.lamp", "state": state, "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None}}
    floors = [{"id": "main", "name": "Main", "level": 0}]
    return _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:{pct}, automorphStyle:{json.dumps(style)}, automorphSubtlety:{subtlety}}});\n"
        "const num=(re)=>{const m=re.exec(svg); return m?parseFloat(m[1]):null;};\n"
        "console.log(JSON.stringify({\n"
        "  shadow: (()=>{const m=/<g transform=\"translate\\(([\\d.]+),([\\d.]+)\\)\"><path d=\"[^\"]+\" fill=\"#020617\" fill-opacity=\"([\\d.]+)\"/.exec(svg);"
        " return m?{dx:parseFloat(m[1]),dy:parseFloat(m[2]),op:parseFloat(m[3])}:null;})(),\n"
        "  ao: (()=>{const m=/stroke=\"#020617\" stroke-opacity=\"([\\d.]+)\" stroke-width=\"([\\d.]+)\"/.exec(svg);"
        " return m?{op:parseFloat(m[1]),w:parseFloat(m[2])}:null;})(),\n"
        "  washOp: num(/fill=\"url\\(#psautomorphduo_(?:on|off)\\)\" fill-opacity=\"([\\d.]+)\"/),\n"
        "  bloomOp: num(/fill=\"url\\(#psautomorphduo_(?:on|off)\\)\" fill-opacity=\"([\\d.]+)\" stroke=\"none\" mask=\"url\\(#psautomorphmask\\)\"/),\n"
        "  edgeCoreFillOp: num(/fill=\"url\\(#psautomorphduo_(?:on|off)\\)\" fill-opacity=\"([\\d.]+)\" stroke=\"#/),\n"
        "  glossMaxStop: (()=>{const m=/<linearGradient id=\"psglossauto_\\d+\"[^>]*>(?:<stop [^>]+\\/>)+/.exec(svg);"
        " return m?Math.max(...[...m[0].matchAll(/stop-opacity=\"([\\d.]+)\"/g)].map(x=>parseFloat(x[1]))):null;})(),\n"
        "  roomFillOp: num(/<polygon points=\"[^\"]+\" fill=\"[^\"]+\" fill-opacity=\"([\\d.]+)\" stroke=\"[^\"]+\" stroke-width=\"1.6\" opacity=\"1\"\\/>/),\n"
        "  roomGlowCentre: num(/<radialGradient id=\"psroomglow_0\"><stop offset=\"0%\" stop-color=\"[^\"]+\" stop-opacity=\"([\\d.]+)\"/),\n"
        "  bloomCount: (svg.match(/mask=\"url\\(#psautomorphmask\\)\"/g)||[]).length,\n"
        "  rim: (()=>{const m=/fill=\"none\" stroke=\"url\\(#psglossrim\\)\" stroke-opacity=\"([\\d.]+)\" stroke-width=\"([\\d.]+)\"/.exec(svg);"
        " return m?{op:parseFloat(m[1]),w:parseFloat(m[2])}:null;})(),\n"
        "  glossOp: num(/fill=\"url\\(#psglossauto_\\d+\\)\" fill-opacity=\"([\\d.]+)\"/),\n"
        "  blurGroups: (svg.match(/filter=\"url\\(#psaurasoft\\)\"/g)||[]).length,\n"
        "  filterApps: (svg.match(/ filter=\"url\\(/g)||[]).length,\n"
        "  shadowIdx: svg.indexOf('fill=\"#020617\"'),\n"
        "  washIdx: svg.search(/fill=\"url\\(#psautomorphduo_(?:on|off)\\)\" fill-opacity=/),\n"
        "}));\n"
    ))


def test_automorph_glow_aura_casts_a_displaced_contact_shadow(tmp_path):
    """The aura floated: glow, edge and gloss were all stamped in the exact
    same position, so nothing separated 'object' from 'floor it rests on'.
    The bottom-most glow-tier layer is now a copy of the same `d` displaced
    along psgloss's own light-to-dark diagonal (0.41,0.91 — down and to the
    right of the drawing's one upper-left sun), scaled off the ring's own
    bbox diagonal so it stays proportionate at any t. Gated to the glow
    style: blueprint is deliberately a flat dashed wireframe, and nebula's
    mask-faded orb has no cutout edge for a paper-shadow to sell."""
    on = _aura_probe(tmp_path)
    assert on["shadow"], "glow style must cast a displaced contact shadow"
    assert on["shadow"]["dx"] > 0 and on["shadow"]["dy"] > 0, on["shadow"]
    # psgloss's normalized light vector is (0.41, 0.91): more drop than slide.
    assert on["shadow"]["dy"] > on["shadow"]["dx"], (
        f"the shadow must fall along the shared light direction, mostly downward: {on['shadow']}"
    )
    assert 0 <= on["shadowIdx"] < on["washIdx"], (
        f"the shadow is the bottom-most layer — it must be emitted before the wash: {on}"
    )
    for style in ("blueprint", "nebula"):
        other = _aura_probe(tmp_path, style=style)
        assert other["shadow"] is None and other["ao"] is None and other["rim"] is None, (
            f"{style} must not grow the glow style's bevel/shadow language: {other}"
        )


def test_automorph_glow_soft_layers_share_one_blur_group(tmp_path):
    """Shadow, AO, wash and bloom all want the same soft blur — done the
    obvious way (a filter attribute per path) that is up to 4 rasterized
    feGaussianBlur passes per fixture, ~400 at the ~100-fixture scale the
    feature targets. They must share ONE group filter instead: exactly one
    filter application in the whole working-mode render. And it must be the
    aura's own psaurasoft clone with the wider region — the group's bbox
    now includes the shadow's offset copy, and widening psclipsoft itself
    would silently grow every Showcase pool's raster cost too."""
    out = _aura_probe(tmp_path)
    assert out["blurGroups"] == 1, f"the four soft layers must share one blur group: {out}"
    assert out["filterApps"] == 1, (
        f"no aura layer may carry its own filter attribute beside the group's: {out}"
    )
    src = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert '<filter id="psaurasoft" x="-12%" y="-12%" width="124%" height="124%">' in src, (
        "the aura's blur def must keep the widened region that covers the shadow-bearing "
        "group's blur bleed"
    )
    assert '<filter id="psclipsoft" x="-8%" y="-8%" width="116%" height="116%">' in src, (
        "the Showcase pools' clip-soften filter must keep its original tighter region — "
        "the aura got a clone precisely so this one never had to grow"
    )


def test_automorph_on_and_off_differ_by_material_not_just_hex(tmp_path):
    """On vs off used to differ ONLY by which grey base was picked — a
    colour swap on a static sticker. Lit now gets the masked inner bloom
    (light welling up from inside) plus a heavier wash/gloss/rim; off gets
    no bloom, lighter fills, and DEEPER ambient occlusion — a matte, inert
    surface shows more contact darkening, a lit one pushes light out."""
    on = _aura_probe(tmp_path, state="on")
    off = _aura_probe(tmp_path, state="off")
    assert on["bloomCount"] == 1, f"a lit fixture must carry exactly one masked bloom: {on}"
    assert off["bloomCount"] == 0, f"an off fixture must carry no bloom: {off}"
    assert off["ao"]["op"] > on["ao"]["op"], (on["ao"], off["ao"])
    assert on["washOp"] > off["washOp"], (on["washOp"], off["washOp"])
    assert on["glossOp"] > off["glossOp"], (on["glossOp"], off["glossOp"])
    assert on["rim"]["op"] > off["rim"]["op"], (on["rim"], off["rim"])


def test_automorph_aura_fill_weight_stays_under_the_rooms_own_colour(tmp_path):
    """Garry's standing directive: the grey aura stays QUIET next to the
    room's own colour. The first rebalance cut wash/gloss to numbers that
    LOOKED right per-layer, but the same edit series added bloom, the
    duotone edge fill and an untapered 0.16 shadow on top, and nobody
    re-summed: the five fills composited to ~0.58-0.64 at ring centre —
    ~4x the 'under roughly half the room's own fill+glow' target the
    in-code comment asserted, and heavier than the room's colour outright.
    So this test no longer pins raw numbers alone: it rebuilds the
    composited stack (1 - PROD(1-o), every fill at its centre-worst —
    bloom's mask is 1.0 at the ring's own centre, gloss at its ramp's max
    white stop) and asserts the RELATIONSHIP against the same render's own
    room fill + glow-centre weights, so no future per-layer edit can drift
    the total silently again. The exact constants are pinned too — they
    are the budget's ledger — and the shadow must taper with t, so an
    icon-sized low-t aura is never out-shadowed by its own shadow."""
    on = _aura_probe(tmp_path, state="on", pct=100)
    off = _aura_probe(tmp_path, state="off", pct=100)
    # The ledger: change any of these and the composited assertion below is
    # the number that has to survive the change.
    assert on["shadow"]["op"] == 0.04 and off["shadow"]["op"] == 0.04, (on["shadow"], off["shadow"])
    assert on["washOp"] == 0.04 and off["washOp"] == 0.03, (on["washOp"], off["washOp"])
    assert on["bloomOp"] == 0.04 and off["bloomOp"] is None, (on["bloomOp"], off["bloomOp"])
    assert on["edgeCoreFillOp"] == 0.02 and off["edgeCoreFillOp"] == 0.02, (
        on["edgeCoreFillOp"], off["edgeCoreFillOp"])
    assert on["glossOp"] == 0.05 and off["glossOp"] == 0.04, (on["glossOp"], off["glossOp"])

    def composited(p):
        stack = [p["shadow"]["op"], p["washOp"], p["edgeCoreFillOp"],
                 p["glossOp"] * p["glossMaxStop"]]
        if p["bloomOp"] is not None:
            stack.append(p["bloomOp"])
        prod = 1.0
        for o in stack:
            prod *= 1.0 - o
        return 1.0 - prod

    for p in (on, off):
        room = p["roomFillOp"] + p["roomGlowCentre"]
        # The budget's denominator comes from the render itself; if the
        # room's own weight ever moves, the aura must be re-budgeted, not
        # silently rescaled here.
        assert room == 0.32, (p["roomFillOp"], p["roomGlowCentre"])
        assert composited(p) <= 0.5 * room + 1e-9, (
            f"the aura's composited fill weight ({composited(p):.3f}) must sit at or "
            f"under half the room's own fill+glow ({room})"
        )
    assert composited(off) < composited(on), (composited(off), composited(on))
    # Shadow taper: at t=1 the shadow may match the wash, never beat it, and
    # it must shrink with t rather than sit at a flat weight sized for the
    # room-large ring.
    small = _aura_probe(tmp_path, state="on", pct=30)
    assert small["shadow"]["op"] < on["shadow"]["op"], (small["shadow"], on["shadow"])
    assert small["shadow"]["op"] <= small["washOp"], (small["shadow"], small["washOp"])
    assert on["shadow"]["op"] <= on["washOp"], (on["shadow"], on["washOp"])


def test_automorph_subtlety_fades_the_new_material_layers_too(tmp_path):
    """House rule for every layer the material stack added: opacity and
    stroke-width route through the same opac()/swid() multipliers as the
    originals, so the subtlety slider keeps fading EVERYTHING — thinner and
    fainter at 100, never zero (the slider's own 'almost completely lost,
    not gone' contract)."""
    a0 = _aura_probe(tmp_path, subtlety=0)
    a100 = _aura_probe(tmp_path, subtlety=100)
    for label, hi, lo in (
        ("shadow opacity", a0["shadow"]["op"], a100["shadow"]["op"]),
        ("AO opacity", a0["ao"]["op"], a100["ao"]["op"]),
        ("AO width", a0["ao"]["w"], a100["ao"]["w"]),
        ("rim opacity", a0["rim"]["op"], a100["rim"]["op"]),
        ("rim width", a0["rim"]["w"], a100["rim"]["w"]),
    ):
        assert lo < hi, f"subtlety=100 must fade the {label} ({lo} !< {hi})"
        assert lo > 0, f"subtlety=100 must fade the {label}, never erase it"


# ── Automorph colour & finish (the craft/composition colour round of the
# 2026-09-07 design critique) ───────────────────────────────────────────────
# Fill interiors move from flat state greys to TWO shared duotone radial
# gradients (lighter centre fading to the base tone at the rim — the
# distance-from-the-light depth cue); the rim/gloss sheen moves from the
# per-shape psgloss to ONE userSpaceOnUse psglossauto per floor (every cell
# on the slab lit from the same sun); a deterministic per-fixture lightness
# offset derived from automorphFixtureWeight rides the flat ink; and the
# final ring carries a small deterministic hand-inked jitter. The
# colour-ownership split both fill features live by: the SHARED gradients
# own the fill interiors (and so can carry no per-fixture offset), while
# the weight offset expresses only through the flat-colour ink (and, for
# inkless nebula, a narrow fill-opacity delta).

def test_lighten_is_identity_at_zero_and_monotone_toward_white_or_black(tmp_path):
    """pct=0 must return the INPUT STRING untouched — the contract that
    keeps every default-weight fixture's ink byte-identical to before the
    weight offset existed (weight 1 -> offset 0 -> today's exact hex).
    Positive pct moves every channel toward white, negative toward black,
    and ±100 clamps cleanly at the extremes."""
    out = _run_js(tmp_path, (
        "import { lighten } from './iso_lights.mjs';\n"
        "console.log(JSON.stringify({\n"
        "  idSame: lighten('#94a3b8', 0)==='#94a3b8',\n"
        "  up: lighten('#94a3b8', 18), down: lighten('#94a3b8', -18),\n"
        "  white: lighten('#94a3b8', 100), black: lighten('#94a3b8', -100),\n"
        "}));\n"
    ))
    assert out["idSame"], "lighten(hex, 0) must be the exact input string"
    base = [0x94, 0xA3, 0xB8]
    up = [int(out["up"][i:i + 2], 16) for i in (1, 3, 5)]
    down = [int(out["down"][i:i + 2], 16) for i in (1, 3, 5)]
    assert all(u > b for u, b in zip(up, base)), (out["up"], base)
    assert all(d < b for d, b in zip(down, base)), (out["down"], base)
    assert out["white"] == "#ffffff" and out["black"] == "#000000", out


def test_automorph_duotone_interiors_are_exactly_two_shared_defs(tmp_path):
    """The aura's fill interiors key the one signal the partition computes
    per fixture — distance from its own light — as a duotone: lighter at
    the centre, the state's base tone at the rim. The defs must be exactly
    TWO shared radialGradients, one per state and never per fixture (the
    psautomorphgrad O(2) discipline), gated on the slider because only the
    aura ever references them — with Automorph off they are not emitted at
    all (the off render is byte-identical to pre-Automorph). Stops
    carry colour only — the referencing path's fill-opacity stays the
    single authority on layer weight, so the pinned ceilings hold."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            "light.a": {"x_m": 1.5, "y_m": 2, "floor_id": "main"},
            "light.b": {"x_m": 6.5, "y_m": 2, "floor_id": "main"},
        },
    }
    lbe = {
        "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.b": {"entity_id": "light.b", "state": "off", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const mk=(o)=>M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        f"const on=mk({{nowMs:{NOW}, automorph:true, automorphRoomPct:60, automorphStyle:'glow'}});\n"
        f"const plain=mk({{nowMs:{NOW}}});\n"
        "const def=/<radialGradient id=\"psautomorphduo_on\"><stop offset=\"0%\" stop-color=\"(#[0-9a-f]{6})\"\\/>[^]*?offset=\"100%\" stop-color=\"(#[0-9a-f]{6})\"\\/><\\/radialGradient>/.exec(on);\n"
        "console.log(JSON.stringify({\n"
        "  defs: (on.match(/<radialGradient id=\"psautomorphduo_/g)||[]).length,\n"
        "  onRefs: (on.match(/fill=\"url\\(#psautomorphduo_on\\)\"/g)||[]).length,\n"
        "  offRefs: (on.match(/fill=\"url\\(#psautomorphduo_off\\)\"/g)||[]).length,\n"
        "  plainDefs: (plain.match(/<radialGradient id=\"psautomorphduo_/g)||[]).length,\n"
        "  centre: def?def[1]:null, rim: def?def[2]:null,\n"
        "}));\n"
    ))
    assert out["defs"] == 2, f"exactly two shared duotone defs, never per fixture: {out}"
    assert out["onRefs"] >= 1 and out["offRefs"] >= 1, (
        f"each state's fill interiors must reference its own shared gradient: {out}"
    )
    assert out["plainDefs"] == 0, (
        "the duotone defs are aura-only — with Automorph off they may not be emitted "
        "(automorph-off byte-identity contract)"
    )
    assert out["rim"] == "#94a3b8", f"the on-gradient's rim stop must be the on base tone itself: {out}"
    centre = [int(out["centre"][i:i + 2], 16) for i in (1, 3, 5)]
    rim = [int(out["rim"][i:i + 2], 16) for i in (1, 3, 5)]
    assert all(c > r for c, r in zip(centre, rim)), (
        f"the centre stop must be lighter than the rim on every channel: {out}"
    )


def test_automorph_sheen_is_one_userspace_ramp_per_floor(tmp_path):
    """The gloss FILL used to stretch psgloss (objectBoundingBox) across
    each cell's own bbox — a different highlight angle/spread on every
    differently-proportioned cell, the exact 'two suns' drift psgloss's own
    comment exists to prevent, and invisible in working mode besides (that
    def is Showcase-gated). The fill now points at psglossauto: ONE ungated
    userSpaceOnUse gradient per FLOOR spanning the slab's projected bbox,
    so every cell's interior on the slab agrees where the sun is. The RIM
    deliberately does NOT share it — a floor-wide ramp decided a rim's
    bright-vs-dark by position on the slab; it sweeps each shape's own
    bbox through psglossrim instead (see
    test_automorph_rim_sweeps_each_shapes_own_bbox_not_the_floor). psgloss
    itself stays byte-identical for markers/rooms."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]}},
        "light_positions_m": {"light.lamp": {"x_m": 3, "y_m": 3, "floor_id": "main"}},
    }
    lbe = {"light.lamp": {"entity_id": "light.lamp", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None}}
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:60, automorphStyle:'glow'}});\n"
        "console.log(JSON.stringify({\n"
        "  defs: (svg.match(/<linearGradient id=\"psglossauto_/g)||[]).length,\n"
        "  userSpace: svg.includes('<linearGradient id=\"psglossauto_0\" gradientUnits=\"userSpaceOnUse\"'),\n"
        "  refs: (svg.match(/url\\(#psglossauto_0\\)/g)||[]).length,\n"
        "  oldRefs: (svg.match(/url\\(#psgloss\\)/g)||[]).length,\n"
        "}));\n"
    ))
    assert out["defs"] == 1, f"one psglossauto per floor — a one-floor scene defines exactly one: {out}"
    assert out["userSpace"], "psglossauto must be userSpaceOnUse — per-floor, not per-shape"
    assert out["refs"] == 1, (
        f"the gloss FILL alone rides the floor ramp — the rim moved to its own "
        f"per-shape psglossrim sweep: {out}"
    )
    assert out["oldRefs"] == 0, (
        f"the aura may no longer lean on Showcase-gated psgloss anywhere in working mode: {out}"
    )
    src = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert '<linearGradient id="psgloss" x1="0.15" y1="0" x2="0.6" y2="1">' in src, (
        "psgloss itself must stay untouched — markers and rooms keep exactly what they have"
    )


def test_automorph_sheen_ramp_is_defined_and_referenced_per_floor_on_two_floors(tmp_path):
    """The one-floor sheen test above cannot tell psglossauto_${lidx} from
    a hardcoded psglossauto_0 — and that regression is exactly the
    wrong-sun defect the per-floor def exists to prevent: an upper floor's
    gloss sampling floor 0's user-space bbox, which sits elsewhere in iso
    space, gets an off-range near-uniform ramp. Two floors, one lit
    fixture each: each floor defines its own userSpaceOnUse ramp and each
    fixture's gloss FILL references its OWN floor's — exactly one ref per
    id, because the rim moved to the per-shape psglossrim sweep and the
    gloss fill is the floor ramp's only consumer. Floors render in level
    order, so the ref order also pins WHICH fixture holds which id — a
    swapped-but-count-balanced mapping fails too."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]},
            "Loft":    {"type": "poly", "floor_id": "up",   "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]},
        },
        "light_positions_m": {
            "light.down": {"x_m": 3.0, "y_m": 3.0, "floor_id": "main"},
            "light.up":   {"x_m": 2.5, "y_m": 2.5, "floor_id": "up"},
        },
    }
    lbe = {
        "light.down": {"entity_id": "light.down", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.up":   {"entity_id": "light.up",   "state": "on", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}, {"id": "up", "name": "Upper", "level": 1}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:60, automorphStyle:'glow'}});\n"
        "console.log(JSON.stringify({\n"
        "  defs: (svg.match(/<linearGradient id=\"psglossauto_/g)||[]).length,\n"
        "  upperUserSpace: svg.includes('<linearGradient id=\"psglossauto_1\" gradientUnits=\"userSpaceOnUse\"'),\n"
        "  refs0: (svg.match(/url\\(#psglossauto_0\\)/g)||[]).length,\n"
        "  refs1: (svg.match(/url\\(#psglossauto_1\\)/g)||[]).length,\n"
        "  lowerFirst: svg.indexOf('url(#psglossauto_0)') < svg.indexOf('url(#psglossauto_1)'),\n"
        "}));\n"
    ))
    assert out["defs"] == 2, f"two floors must define two per-floor ramps, one each: {out}"
    assert out["upperUserSpace"], (
        f"the upper floor's ramp must exist and be userSpaceOnUse like floor 0's: {out}"
    )
    assert out["refs0"] == 1 and out["refs1"] == 1, (
        f"each fixture's gloss fill must ride its OWN floor's ramp exactly once — "
        f"refs0=2/refs1=0 is the hardcoded-floor-0 wrong-sun regression: {out}"
    )
    assert out["lowerFirst"], (
        f"floors render in level order, so the floor-0 fixture's ref must come first — "
        f"a swapped mapping still lights the upper floor from the wrong sun: {out}"
    )


def test_automorph_weight_offset_rides_the_ink_and_stays_inside_the_state_gap(tmp_path):
    """A fixture with a big recorded manual footprint must read very
    slightly more present: its flat INK (edgeCore's stroke) lightens by a
    deterministic offset from automorphFixtureWeight. Two default-weight
    neighbours — the common case — must keep byte-identical ink, and the
    whole ±7% band must sit far inside the on/off gap so state stays
    unambiguous. The shared duotone fills carry no offset by construction —
    the ink is the offset's only channel in the glow style."""
    NOW = 1_000_000_000_000

    def render(b_extra):
        model = {
            "room_geometry_m": {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
            "light_positions_m": {
                "light.a": {"x_m": 1.5, "y_m": 2, "floor_id": "main"},
                "light.b": {"x_m": 6.5, "y_m": 2, "floor_id": "main", **b_extra},
            },
        }
        lbe = {
            "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
            "light.b": {"entity_id": "light.b", "state": "on", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
        }
        floors = [{"id": "main", "name": "Main", "level": 0}]
        return _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const LBE={json.dumps(lbe)};\n"
            f"const FLOORS={json.dumps(floors)};\n"
            f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
            f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:60, automorphStyle:'glow'}});\n"
            "const inks=[...svg.matchAll(/fill=\"url\\(#psautomorphduo_on\\)\" fill-opacity=\"[\\d.]+\" stroke=\"(#[0-9a-f]{6})\"/g)].map(m=>m[1]);\n"
            "import { lighten } from './iso_lights.mjs';\n"
            "console.log(JSON.stringify({inks, onFloor: lighten('#94a3b8', -7), offCeil: lighten('#475569', 7)}));\n"
        ))

    sized = render({"width_cm": 300, "height_cm": 300})
    assert len(sized["inks"]) == 2, f"expected one edgeCore ink per fixture: {sized}"
    assert "#94a3b8" in sized["inks"], f"the default-weight fixture must keep today's exact ink: {sized}"
    other = next(i for i in sized["inks"] if i != "#94a3b8")
    big = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    base = [0x94, 0xA3, 0xB8]
    assert all(b >= s for b, s in zip(big, base)) and any(b > s for b, s in zip(big, base)), (
        f"a heavier fixture's ink must lighten, never darken or hold: {sized}"
    )
    plain = render({})
    assert plain["inks"] == ["#94a3b8", "#94a3b8"], (
        f"two default-weight neighbours must stay essentially identical — exact same ink: {plain}"
    )
    on_floor = [int(sized["onFloor"][i:i + 2], 16) for i in (1, 3, 5)]
    off_ceil = [int(sized["offCeil"][i:i + 2], 16) for i in (1, 3, 5)]
    assert all(a > b for a, b in zip(on_floor, off_ceil)), (
        f"the darkest possible on-ink must stay clearly lighter than the lightest possible "
        f"off-ink — the offset band may never blur the on/off state read: {sized}"
    )


def test_automorph_nebula_weight_delta_rides_the_wash_inside_the_state_gap(tmp_path):
    """Nebula has no ink channel, so the per-fixture weight offset rides a
    narrow fill-opacity delta on its single wash (weightOffPct*0.004,
    ±0.028 at the weight clamps) — the contract the colour-ownership
    comment states, tested nowhere until now: every nebula render in this
    file used unsized fixtures, and the glow weight test's ink regex only
    matches stroked paths, which nebula's stroke="none" wash never is.
    Deleting the term (delta 0) or fat-fingering it x100 (delta 2.8,
    swamping the ~0.09 on/off split) both kept the suite green. Two
    probes: a both-on pair — the delta exists and stays at the 0.028
    ceiling (the emitted attribute is quantized to 0.01 steps by opac's
    toFixed(2), so it reads as at most 0.03) — and the worst direction, a
    max-weight OFF fixture pushed UP toward an unsized ON one: the state
    split must stay clearly ordered by more than the whole weight band."""
    NOW = 1_000_000_000_000

    def washes(b_extra, a_state, b_state):
        model = {
            "room_geometry_m": {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
            "light_positions_m": {
                "light.a": {"x_m": 1.5, "y_m": 2, "floor_id": "main"},
                "light.b": {"x_m": 6.5, "y_m": 2, "floor_id": "main", **b_extra},
            },
        }
        lbe = {
            "light.a": {"entity_id": "light.a", "state": a_state, "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
            "light.b": {"entity_id": "light.b", "state": b_state, "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
        }
        floors = [{"id": "main", "name": "Main", "level": 0}]
        out = _run_js(tmp_path, (
            "import * as M from './iso_lights.mjs';\n"
            f"const MODEL={json.dumps(model)};\n"
            f"const LBE={json.dumps(lbe)};\n"
            f"const FLOORS={json.dumps(floors)};\n"
            f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
            f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:60, automorphStyle:'nebula'}});\n"
            "const washes=[...svg.matchAll(/fill=\"url\\(#psautomorphduo_(on|off)\\)\" "
            "fill-opacity=\"([\\d.]+)\" stroke=\"none\" mask=\"url\\(#psautomorphmask\\)\"/g)]"
            ".map(m=>({state:m[1], op:parseFloat(m[2])}));\n"
            "console.log(JSON.stringify({washes}));\n"
        ))
        return out["washes"]

    both_on = washes({"width_cm": 300, "height_cm": 300}, "on", "on")
    assert len(both_on) == 2 and all(w["state"] == "on" for w in both_on), (
        f"expected one masked nebula wash per fixture, both lit: {both_on}"
    )
    delta = max(w["op"] for w in both_on) - min(w["op"] for w in both_on)
    assert delta > 0, (
        f"a max-weight fixture's wash must read very slightly heavier than a default "
        f"neighbour's — the weight term vanished from nebula's one channel: {both_on}"
    )
    assert delta <= 0.03 + 1e-9, (
        f"the weight delta must hold the ±0.028 ceiling (0.03 once quantized) — "
        f"anything bigger starts competing with the on/off intensity split: {both_on}"
    )
    mixed = washes({"width_cm": 300, "height_cm": 300}, "on", "off")
    on_op = next(w["op"] for w in mixed if w["state"] == "on")
    off_op = next(w["op"] for w in mixed if w["state"] == "off")
    assert on_op - off_op > 0.03, (
        f"worst direction: a max-weight OFF wash pushed up its full delta must stay "
        f"clearly under an unsized ON wash — by more than the whole weight band, or "
        f"state stops being readable as intensity: {mixed}"
    )


def test_automorph_ring_jitter_is_deterministic_bounded_and_fades_hard(tmp_path):
    """The hand-inked jitter follows the cell wobble's own discipline: a
    seeded sine of position, never Math.random(), so the fabric alone
    reproduces a render. Zero amplitude (t=0, or hardness=-100) returns the
    SAME array — the applyHardness passthrough convention. Amplitude scales
    exactly linearly with t, fades linearly to zero on the negative-
    hardness side (jitter on a 'geometrically aligned' shape reads as dirt,
    not craft), never fades on the soft side, and is capped ~1px — far
    inside the marginM non-overlap gap."""
    out = _run_js(tmp_path, (
        "import { automorphRingJitter } from './iso_lights.mjs';\n"
        "const ring=[]; for(let i=0;i<24;i++){const a=i/24*2*Math.PI; ring.push([100+Math.cos(a)*40, 100+Math.sin(a)*40]);}\n"
        "const disp=(o)=>Math.max(...o.map((p,i)=>Math.hypot(p[0]-ring[i][0], p[1]-ring[i][1])));\n"
        "const j1=automorphRingJitter(ring,100,100,1,0);\n"
        "console.log(JSON.stringify({\n"
        "  identT0: automorphRingJitter(ring,100,100,0,0)===ring,\n"
        "  identHard: automorphRingJitter(ring,100,100,1,-100)===ring,\n"
        "  same: JSON.stringify(j1)===JSON.stringify(automorphRingJitter(ring,100,100,1,0)),\n"
        "  seedMoves: JSON.stringify(automorphRingJitter(ring,120,80,1,0))!==JSON.stringify(j1),\n"
        "  full: disp(j1),\n"
        "  half: disp(automorphRingJitter(ring,100,100,0.5,0)),\n"
        "  faded: disp(automorphRingJitter(ring,100,100,1,-50)),\n"
        "  soft: disp(automorphRingJitter(ring,100,100,1,60)),\n"
        "}));\n"
    ))
    assert out["identT0"] and out["identHard"], f"zero amplitude must be the same-array passthrough: {out}"
    assert out["same"], "the jitter must be fully deterministic — two identical calls, identical output"
    assert out["seedMoves"], "a different fixture position must seed a different waviness"
    assert 0 < out["full"] <= 1.1 + 1e-9, f"amplitude must be real but capped ~1px: {out}"
    assert abs(out["half"] - out["full"] * 0.5) < 1e-9, f"amplitude must scale linearly with t: {out}"
    assert abs(out["faded"] - out["full"] * 0.5) < 1e-9, (
        f"hardness -50 must halve the amplitude on its way to zero at -100: {out}"
    )
    assert abs(out["soft"] - out["full"]) < 1e-9, (
        f"positive (soft) hardness must not fade the jitter — only the hard side reads it as dirt: {out}"
    )


def test_ring_jitter_applied_once_before_hardness_and_skipped_for_nebula():
    """Structural pin, same discipline as the chaikinSmooth call-site pin:
    exactly ONE jitter application, sitting between the morph and
    applyHardness — so hardness spikes grow from inked points and the soft
    spline runs through them — and skipped entirely for nebula, whose mask
    fades the edge the jitter would decorate."""
    src = _code_only((_VIEWS / "iso_lights.js").read_text(encoding="utf-8"))
    calls = re.findall(r"(?<!function )automorphRingJitter\(", src)
    assert len(calls) == 1, f"expected exactly one automorphRingJitter call site, found {len(calls)}"
    assert 'const inked=(AUTOMORPH_STYLE==="nebula") ? morphed' in src, (
        "nebula must skip the jitter at the one call site"
    )
    assert "automorphRingJitter(morphed, hx, hy, AUTOMORPH_PCT/100, AUTOMORPH_HARDNESS)" in src, (
        "the jitter must ride the morphed ring, seeded from the fixture's own position"
    )
    assert "applyHardness(inked, AUTOMORPH_HARDNESS, hardCapPx)" in src, (
        "hardness must operate on the inked ring — jitter before spikes, spikes before pathing"
    )


# ── Automorph per-ring fade, per-shape rim, blueprint state split (the
# 2026-09-08 five-lens review: svg lens f0, completeness lens f1/f2) ────────

def test_automorph_mask_fades_at_the_rings_own_edge_not_the_viewports(tmp_path):
    """psautomorphmask's content rect used percentage coordinates under the
    default maskContentUnits=userSpaceOnUse, where percentage lengths
    resolve against the VIEWPORT (SVG 1.1 §7.10/§14.4): the fade was one
    canvas-centred vignette. Rasterized (resvg), three identical masked
    squares read ~0.11 alpha at the canvas corners vs 1.0 at its centre,
    and a real bloom/nebula ring had NO fade at its own edge — its whole
    strength a function of where the room sat on the canvas, worst on tall
    multi-floor stacks. The def must carry
    maskContentUnits="objectBoundingBox" with FRACTION coordinates, so the
    -0.2..1.4 rect (and psautomorphgrad, objectBoundingBox itself, centred
    on it) hugs each REFERENCING ring: per-fixture centre-to-edge fade
    from ONE shared def (post-fix raster: bloom centre 1.0, own bbox edge
    ~0.1, corner 0.0, identical at any canvas position). The defect is
    invisible to string matching, so the exact def string IS the pin —
    both in the emitted render and at its single source site."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Office": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 6], [0, 6]]}},
        "light_positions_m": {"light.lamp": {"x_m": 3, "y_m": 3, "floor_id": "main"}},
    }
    lbe = {"light.lamp": {"entity_id": "light.lamp", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None}}
    floors = [{"id": "main", "name": "Main", "level": 0}]
    def_pin = (
        '<mask id="psautomorphmask" maskContentUnits="objectBoundingBox">'
        '<rect x="-0.2" y="-0.2" width="1.4" height="1.4" fill="url(#psautomorphgrad)"/></mask>'
    )
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const mk=(o)=>M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        f"const glow=mk({{nowMs:{NOW}, automorph:true, automorphRoomPct:100, automorphStyle:'glow'}});\n"
        f"const nebula=mk({{nowMs:{NOW}, automorph:true, automorphRoomPct:100, automorphStyle:'nebula'}});\n"
        f"const PIN={json.dumps(def_pin)};\n"
        "console.log(JSON.stringify({\n"
        "  glowDefs: (glow.match(/<mask id=\"psautomorphmask\"/g)||[]).length,\n"
        "  glowPinned: glow.includes(PIN), nebulaPinned: nebula.includes(PIN),\n"
        "  pctLeak: /<mask id=\"psautomorphmask\"[^>]*>[^]*?%[^]*?<\\/mask>/.test(glow),\n"
        "  glowRefs: (glow.match(/mask=\"url\\(#psautomorphmask\\)\"/g)||[]).length,\n"
        "  nebulaRefs: (nebula.match(/mask=\"url\\(#psautomorphmask\\)\"/g)||[]).length,\n"
        "}));\n"
    ))
    assert out["glowDefs"] == 1, f"one shared mask def, never per fixture: {out}"
    assert out["glowPinned"] and out["nebulaPinned"], (
        "psautomorphmask must be the objectBoundingBox fraction-rect def — percentage "
        "coordinates under default maskContentUnits resolve against the viewport and "
        f"turn the fade into a canvas-centred vignette: {out}"
    )
    assert not out["pctLeak"], f"no percentage length may creep back into the mask content: {out}"
    assert out["glowRefs"] == 1 and out["nebulaRefs"] >= 1, (
        f"the lit bloom and the nebula wash must still fade through the shared mask: {out}"
    )
    src = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert def_pin in src, "the fixed mask def must sit at its single source site, byte-exact"


def test_automorph_rim_sweeps_each_shapes_own_bbox_not_the_floor(tmp_path):
    """edgeRim stroked with the floor-wide userSpaceOnUse psglossauto, so
    bright-vs-dark on a shape's rim was decided by the fixture's POSITION
    on the floor, not by which side of each shape faces the light: on a
    16x8m two-room floor the right-hand fixture's ENTIRE rim projected
    past the ramp's 45% stop (offset fractions ~0.60..1.04 — max white
    opacity ~0.07, a near-uniform dark outline, the exact flat-sticker
    tell the rim exists to kill), while the left fixture's rim was bright
    on most of its perimeter. The rim must stroke psglossrim — psgloss's
    exact stops on default objectBoundingBox units, ONE shared aura-gated
    def — so every shape's rim sweeps bright upper-left to dark
    lower-right across its OWN bbox (offsets 0..1 by construction). The
    gloss FILL keeps the floor-wide psglossauto: the one-sun rule was
    moved for the interiors, not the bevel."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {
            "West": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 8], [0, 8]]},
            "East": {"type": "poly", "floor_id": "main", "points_m": [[8, 0], [16, 0], [16, 8], [8, 8]]},
        },
        "light_positions_m": {
            "light.a": {"x_m": 1.5, "y_m": 4, "floor_id": "main"},
            "light.b": {"x_m": 6.5, "y_m": 4, "floor_id": "main"},
            "light.c": {"x_m": 14.5, "y_m": 4, "floor_id": "main"},
        },
    }
    lbe = {
        eid: {"entity_id": eid, "state": "on", "code": f"A0{i}", "shape": "circle", "isMotion": False, "last_changed": None}
        for i, eid in enumerate(["light.a", "light.b", "light.c"], start=1)
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    def_pin = (
        '<linearGradient id="psglossrim" x1="0.15" y1="0" x2="0.6" y2="1">'
        '<stop offset="0%" stop-color="#fff" stop-opacity="0.5"/>'
        '<stop offset="45%" stop-color="#fff" stop-opacity="0.1"/>'
        '<stop offset="100%" stop-color="#000" stop-opacity="0.18"/></linearGradient>'
    )
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const mk=(o)=>M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,o);\n"
        f"const on=mk({{nowMs:{NOW}, automorph:true, automorphRoomPct:100, automorphHardness:0, automorphStyle:'glow'}});\n"
        f"const off=mk({{nowMs:{NOW}}});\n"
        f"const PIN={json.dumps(def_pin)};\n"
        "console.log(JSON.stringify({\n"
        "  rimRefs: (on.match(/fill=\"none\" stroke=\"url\\(#psglossrim\\)\"/g)||[]).length,\n"
        "  rimOnFloorRamp: (on.match(/fill=\"none\" stroke=\"url\\(#psglossauto_/g)||[]).length,\n"
        "  glossFillRefs: (on.match(/fill=\"url\\(#psglossauto_0\\)\"/g)||[]).length,\n"
        "  rimDefs: (on.match(/<linearGradient id=\"psglossrim\"/g)||[]).length,\n"
        "  pinned: on.includes(PIN),\n"
        "  userSpaceLeak: on.includes('id=\"psglossrim\" gradientUnits'),\n"
        "  offCarriesRim: off.includes('psglossrim'),\n"
        "}));\n"
    ))
    assert out["rimRefs"] == 3, f"every fixture's rim must stroke the per-shape ramp: {out}"
    assert out["rimOnFloorRamp"] == 0, (
        f"no rim may stroke the floor-wide ramp — that decided bright-vs-dark by slab "
        f"position instead of per shape: {out}"
    )
    assert out["glossFillRefs"] == 3, f"the gloss FILL must keep the one-sun floor ramp: {out}"
    assert out["rimDefs"] == 1 and out["pinned"], (
        f"psglossrim is ONE shared def carrying psgloss's exact stops: {out}"
    )
    assert not out["userSpaceLeak"], (
        f"psglossrim must stay on default objectBoundingBox units — user space would "
        f"recreate the position-dependent rim: {out}"
    )
    assert not out["offCarriesRim"], (
        f"psglossrim is aura-only — the automorph-off render may not carry it "
        f"(byte-identity contract): {out}"
    )


def test_automorph_blueprint_carries_state_in_its_one_channel(tmp_path):
    """light[3]'s problem statement — every aura opacity formula identical
    for on and off, the sole difference the base hex — stayed literally
    true for the blueprint style: a lit and an unlit fixture rendered
    byte-identically except for the grey (both 0.80/1.10 at pct=100).
    Blueprint's one channel is linework brightness, so state must ride it:
    lit dashes and nodes a step brighter than unlit at every t
    (0.45+0.40t vs 0.30+0.40t), while width, dash pattern and node radius
    stay state-independent — heavier lit linework would read as a
    different pen, not a lit fixture."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [8, 0], [8, 4], [0, 4]]}},
        "light_positions_m": {
            "light.a": {"x_m": 1.5, "y_m": 2, "floor_id": "main"},
            "light.b": {"x_m": 6.5, "y_m": 2, "floor_id": "main"},
        },
    }
    lbe = {
        "light.a": {"entity_id": "light.a", "state": "on", "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.b": {"entity_id": "light.b", "state": "off", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        f"const svg=M.buildIsoSVG(MODEL,{{}},new Set(),null,150,0,LBE,false,FLOORS,"
        f"{{nowMs:{NOW}, automorph:true, automorphRoomPct:100, automorphStyle:'blueprint'}});\n"
        "const dashes=[...svg.matchAll(/<path d=\"[^\"]+\" fill=\"none\" stroke=\"(#[0-9a-f]{6})\""
        " stroke-opacity=\"([\\d.]+)\" stroke-width=\"([\\d.]+)\" stroke-dasharray=\"([^\"]+)\"/g)]"
        ".map(m=>({hex:m[1], op:parseFloat(m[2]), w:m[3], dash:m[4]}));\n"
        "const nodeOps={};\n"
        "for(const m of svg.matchAll(/<circle cx=\"[-\\d.]+\" cy=\"[-\\d.]+\" r=\"1.6\" fill=\"(#[0-9a-f]{6})\" fill-opacity=\"([\\d.]+)\"/g))"
        " nodeOps[m[1]]=parseFloat(m[2]);\n"
        "console.log(JSON.stringify({dashes, nodeOps}));\n"
    ))
    assert len(out["dashes"]) == 2, f"expected one dashed outline per fixture: {out}"
    by_hex = {d["hex"]: d for d in out["dashes"]}
    on, off = by_hex["#94a3b8"], by_hex["#475569"]
    assert on["op"] == 0.85 and off["op"] == 0.70, (
        f"blueprint linework must carry state — lit brighter than unlit at every t: {out}"
    )
    assert on["w"] == off["w"] and on["dash"] == off["dash"], (
        f"width and dash pattern stay state-independent — brightness is the one channel: {out}"
    )
    assert out["nodeOps"]["#94a3b8"] == on["op"] and out["nodeOps"]["#475569"] == off["op"], (
        f"the vertex nodes ride the same dashOp as their outline: {out}"
    )


# ── Determinism of the WHOLE automorph render, not just its helpers ─────────

def test_automorph_full_map_two_renders_are_byte_identical(tmp_path):
    """Determinism is a hard invariant, but it was pinned only per helper —
    applyHardness, chaikinSmooth and automorphRingJitter each compare two
    of their own calls — so entropy introduced in any unpinned painted
    formula (the shadow's displacement, an opacity, a duotone stop, a
    seed taken from Date.now() outside the pinned jitter site) passed
    every existing test: helper units call helpers with fixed args, and
    every render probe compares within one render. This closes the CLASS:
    one scene with everything live — two floors, a sized rotated strip
    (jitter + weight offset), negative hardness (spikes + jitter fade),
    an off fixture — rendered twice per style in one node run with the
    same nowMs. The fabric alone must reproduce the bytes."""
    NOW = 1_000_000_000_000
    model = {
        "room_geometry_m": {
            "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
            "Loft":    {"type": "poly", "floor_id": "up",   "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]},
        },
        "light_positions_m": {
            "light.plain": {"x_m": 3.0, "y_m": 2.0, "floor_id": "main"},
            "light.strip": {"x_m": 4.0, "y_m": 1.0, "floor_id": "main",
                            "width_cm": 240, "height_cm": 5, "rotation": 30},
            "light.up":    {"x_m": 2.5, "y_m": 2.5, "floor_id": "up"},
        },
    }
    lbe = {
        "light.plain": {"entity_id": "light.plain", "state": "on",  "code": "A01", "shape": "circle", "isMotion": False, "last_changed": None},
        "light.strip": {"entity_id": "light.strip", "state": "on",  "code": "W01", "shape": "bar",    "isMotion": False, "last_changed": None},
        "light.up":    {"entity_id": "light.up",    "state": "off", "code": "A02", "shape": "circle", "isMotion": False, "last_changed": None},
    }
    floors = [{"id": "main", "name": "Main", "level": 0}, {"id": "up", "name": "Upper", "level": 1}]
    out = _run_js(tmp_path, (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model)};\n"
        f"const LBE={json.dumps(lbe)};\n"
        f"const FLOORS={json.dumps(floors)};\n"
        "const res={};\n"
        "for(const style of ['glow','nebula','blueprint']){\n"
        f"  const opts={{nowMs:{NOW}, automorph:true, automorphRoomPct:100, automorphHardness:-60, automorphStyle:style}};\n"
        "  const s1=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,opts);\n"
        "  const s2=M.buildIsoSVG(MODEL,{},new Set(),null,150,0,LBE,false,FLOORS,opts);\n"
        "  res[style]={same:s1===s2, len:s1.length};\n"
        "}\n"
        "console.log(JSON.stringify(res));\n"
    ))
    for style in ("glow", "nebula", "blueprint"):
        assert out[style]["len"] > 0, f"the {style} scene must actually render: {out}"
        assert out[style]["same"], (
            f"two identical {style} renders must be byte-identical — the fabric alone "
            f"reproduces a render, no Math.random()/Date.now() anywhere in the paint path: {out}"
        )
    # Byte equality alone cannot see entropy smaller than the emitted
    # quantization (a 1% Math.random() factor on a toFixed(1) coordinate
    # usually rounds away — measured: that exact mutation stayed green), so
    # the no-entropy discipline is ALSO pinned at the source, the hardCapPx
    # pin's own rationale: Math.random appears nowhere in code, Date.now
    # exactly once — buildIsoSVG's deliberate nowMs fallback, which every
    # render test here pins away by passing nowMs.
    src = _code_only((_VIEWS / "iso_lights.js").read_text(encoding="utf-8"))
    assert "Math.random(" not in src, (
        "Math.random must appear nowhere in the renderer's code — even sub-quantization "
        "entropy breaks the fabric-reproduces-the-render contract"
    )
    assert src.count("Date.now(") == 1 and "const NOW_MS=Number(opts.nowMs)||Date.now();" in src, (
        "Date.now may appear exactly once: the deliberate nowMs fallback at the top of "
        "buildIsoSVG — a second site would seed paint from wall-clock time"
    )
