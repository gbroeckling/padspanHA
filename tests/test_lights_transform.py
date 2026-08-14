"""Free-transform: what you drag is what gets stored.

The Mapping -> Lights Transform mode puts resize/rotate handles on a placed
fixture.  It has to be precise and instant, which means three things must hold
exactly, not approximately:

  1. dragging a handle to N pixels from the centre stores the fixture's real
     size, because the handle describes HALF the axis;
  2. the live preview uses the SAME scale function the renderer commits, or
     the shape jumps the moment the pointer comes up;
  3. sizing a light that has never been placed PLACES it, rather than
     building a draft that cannot be saved.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_VIEWS = _ROOT / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run_js(tmp_path: Path, body: str) -> dict:
    for name in ("iso_lights", "light_codes"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(
        "import * as M from './iso_lights.mjs';\nconst out={};\n"
        + body + "\nconsole.log(JSON.stringify(out));\n",
        encoding="utf-8",
    )
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, "node failed:\n" + res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


def _handles_block() -> str:
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    block = src[src.index("function _wireTransformHandles"):]
    return block[:block.index("\nfunction ")]


# ---------------------------------------------------------------------------
# 1. Handle distance -> stored measurement
# ---------------------------------------------------------------------------

def test_a_handle_describes_half_the_fixture(tmp_path):
    """The handle sits on the EDGE, so its distance is half the width.

    Getting this wrong by 2x is invisible on screen — the marker still tracks
    the pointer — but every stored measurement would be half or double the
    real fixture.
    """
    out = _run_js(tmp_path, (
        "const scale=20;\n"
        "out.oneMetreOut=M.cmFromHandlePx(20, scale);\n"
        "out.halfMetreOut=M.cmFromHandlePx(10, scale);\n"
        "out.threeMetresOut=M.cmFromHandlePx(60, scale);\n"
    ))
    assert out["oneMetreOut"] == 200      # 1 m half-width -> 2 m fixture
    assert out["halfMetreOut"] == 100
    assert out["threeMetresOut"] == 600


def test_dragging_either_way_gives_the_same_size(tmp_path):
    """Pulling the handle left or right describes the same fixture."""
    out = _run_js(tmp_path, (
        "out.pos=M.cmFromHandlePx(37, 14);\n"
        "out.neg=M.cmFromHandlePx(-37, 14);\n"
    ))
    assert out["pos"] == out["neg"]


def test_size_is_bounded_and_never_negative(tmp_path):
    out = _run_js(tmp_path, (
        "out.huge=M.cmFromHandlePx(100000, 14);\n"
        "out.zero=M.cmFromHandlePx(0, 14);\n"
        "out.badScale=M.cmFromHandlePx(50, 0);\n"
        "out.max=M.MAX_FIXTURE_CM;\n"
    ))
    assert out["huge"] == out["max"] == 2000
    assert out["zero"] == 0
    assert out["badScale"] == 0, "a zero scale must not produce Infinity"


def test_handle_distance_round_trips_through_the_stored_size(tmp_path):
    """Drag to a distance, store it, redraw: the fixture matches the drag.

    This is the property that makes the tool trustworthy — the box you drew is
    the box you get back.
    """
    out = _run_js(tmp_path, (
        "const scale=14, hexR=M.markerRadiusPx(scale);\n"
        "out.rows=[];\n"
        "for(const px of [20,45,80,140,260]){\n"
        "  const cm=M.cmFromHandlePx(px, scale);\n"
        "  const s=M.markerScale(cm, cm, scale, hexR);\n"
        "  const drawnHalfW=(hexR*2*0.866)*s.sx/2;\n"
        "  out.rows.push({px:px, cm:cm, drawnHalfW:drawnHalfW});\n"
        "}\n"
    ))
    checked = 0
    for row in out["rows"]:
        # Two deliberate exceptions: below the legibility floor the drawn size
        # is larger than the measurement so the marker stays clickable, and a
        # drag past MAX_FIXTURE_CM stores the bound rather than the pointer.
        if row["cm"] < 60 or row["cm"] >= 2000:
            continue
        checked += 1
        assert abs(row["drawnHalfW"] - row["px"]) < 1.0, (
            "dragged to {}px, stored {}cm, redrew at {:.1f}px".format(
                row["px"], row["cm"], row["drawnHalfW"])
        )
    assert checked >= 3, "the round-trip was never actually exercised"


def test_a_drag_past_the_maximum_stores_the_maximum(tmp_path):
    """Dragging beyond 20 m is bounded, not wrapped or ignored."""
    out = _run_js(tmp_path, (
        "const scale=14;\n"
        "out.far=M.cmFromHandlePx(260, scale);\n"
        "out.further=M.cmFromHandlePx(2600, scale);\n"
    ))
    assert out["far"] == out["further"] == 2000


# ---------------------------------------------------------------------------
# 2. Preview must equal the committed render
# ---------------------------------------------------------------------------

def test_the_preview_uses_the_renderers_own_scale_function():
    """A second implementation of the scale is a shape that jumps on release."""
    block = _handles_block()
    assert "markerScale(" in block, (
        "the transform preview computes its own scale instead of calling the "
        "renderer's markerScale — preview and commit will disagree"
    )
    assert "markerRadiusPx(" in block, (
        "the preview hard-codes a marker radius; it varies with site scale"
    )
    assert not re.search(r"Math\.hypot\([^)]*frame\.scale", block), (
        "the transform preview still hand-rolls the soft-floor scale maths"
    )


def test_marker_scale_is_the_single_source():
    """markerScale must be what actually draws the fixture."""
    src = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    body = src[src.index("const markerSvg"):src.index("// Rooms, straight from the metre fabric")]
    assert "markerScale(" in body, "markerSvg no longer uses the shared scale"


def test_scale_is_stable_and_ordered(tmp_path):
    """No dead zone, no inversion, bounded at both ends."""
    out = _run_js(tmp_path, (
        "const scale=14, hexR=M.markerRadiusPx(scale);\n"
        "out.sx=[10,15,30,60,150,400,1200,2000].map(cm=>M.markerScale(cm,cm,scale,hexR).sx);\n"
        "out.unset=M.markerScale(0,0,scale,hexR);\n"
    ))
    sx = out["sx"]
    assert all(sx[i] > sx[i - 1] for i in range(1, len(sx))), "not monotonic: {}".format(sx)
    assert sx[0] >= 0.5, "legibility floor lost"
    # No ceiling: a 20 m fixture must not draw the same as a 12 m one.
    assert sx[-1] > sx[-2] > sx[-3]
    assert out["unset"] == {"sx": 1, "sy": 1}, "an unsized fixture must draw at 1x"


def test_width_and_length_are_independent(tmp_path):
    """A valance is long and thin; the axes must not be coupled."""
    out = _run_js(tmp_path, (
        "const scale=14, hexR=M.markerRadiusPx(scale);\n"
        "out.wide=M.markerScale(400, 10, scale, hexR);\n"
        "out.tall=M.markerScale(10, 400, scale, hexR);\n"
        "out.square=M.markerScale(200, 200, scale, hexR);\n"
    ))
    assert out["wide"]["sx"] > out["wide"]["sy"] * 3
    assert out["tall"]["sy"] > out["tall"]["sx"] * 3
    assert out["square"]["sx"] > 1 and out["square"]["sy"] > 1


def test_one_axis_set_alone_still_sizes_the_marker(tmp_path):
    """Setting only Width must not leave the other axis at the default.

    markerScale falls back to the axis that IS set, so a fixture measured on
    one axis still reads as that size rather than half-default.
    """
    out = _run_js(tmp_path, (
        "const scale=14, hexR=M.markerRadiusPx(scale);\n"
        "out.wOnly=M.markerScale(400, 0, scale, hexR);\n"
        "out.both=M.markerScale(400, 400, scale, hexR);\n"
    ))
    assert out["wOnly"] == out["both"]


# ---------------------------------------------------------------------------
# 3. Handles must never build an unsavable draft
# ---------------------------------------------------------------------------

def test_sizing_an_unplaced_light_places_it_where_it_is_drawn():
    """fabric_light_position_set requires x_m and y_m.

    An unplaced light has neither, so a resize alone would build a draft that
    "Save placements" could only fail on — after the user watched the shape
    change on screen. Refusing the handles just moves that dead end earlier.
    The light is already drawn in the middle of its room, so sizing it there
    adopts that spot as its position and the save is valid.
    """
    block = _handles_block()
    assert "prev.x_m == null" in block, (
        "the handle commit does not backfill a position for an unplaced "
        "light — its draft cannot be saved"
    )
    assert "frame.isoInv(" in block, (
        "the backfilled position is not derived from where the light is "
        "actually drawn"
    )
    assert "_floorIdForLight(" in block, "the backfilled position has no floor"


def test_transform_handles_are_offered_on_every_light():
    """Easy mode: a new light is placed by moving OR sizing it."""
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    call = src[src.index("o.mapState._lightsTransform"):]
    call = call[:call.index("_wireTransformHandles(ctx") + 60]
    assert "isPlaced" not in call, (
        "transform handles are gated on the light already being placed"
    )


def test_the_transform_preview_anchors_on_the_fixture_centre():
    """The group bounding box grows with the scaled outline and its label.

    Anchoring handles to it drifts them off-centre exactly when the fixture is
    largest, which is when precision matters most.
    """
    assert 'querySelector("text")' in _handles_block(), (
        "handles no longer anchor on the fixture's own centre label"
    )


def test_a_transform_preserves_the_lights_position():
    """Resizing must never move the fixture.

    The handle drag writes size and rotation into the same draft entry the
    position drag uses; spreading the previous entry is what keeps x_m/y_m.
    """
    block = _handles_block()
    assert "...prev" in block, (
        "the handle commit replaces the draft entry instead of merging — a "
        "resize would drop the light's position"
    )


def test_rotation_is_bounded_to_the_stored_range():
    """The schema and the Rotate box both use -180..180."""
    block = _handles_block()
    assert "-180" in block and "180" in block, (
        "rotation from the handle is not clamped to the stored range"
    )


# ---------------------------------------------------------------------------
# 4. Editing one property must not destroy another
# ---------------------------------------------------------------------------

def test_moving_a_light_keeps_unsaved_sizing():
    """Move and resize write to the same draft entry.

    The move handler rebuilt that entry from the COMMITTED model, so any
    sizing or rotation done since the last save was thrown away: shape a
    valance, nudge it half a metre, and it snapped back to a default marker.
    """
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    # The move handler is the one that writes x_m/y_m from a pointer drag.
    blk = src[src.index("const [x_mRaw, y_mRaw] = frame.isoInv("):]
    blk = blk[:blk.index("draft[eid] = {")]
    prev_expr = blk[blk.index("const prev"):]
    prev_expr = prev_expr[:prev_expr.index(";")]
    assert "draft[eid]" in prev_expr, (
        "the move handler seeds its draft entry from the committed model "
        "only, so an unsaved resize is overwritten:\n" + prev_expr
    )


# ---------------------------------------------------------------------------
# 5. Reaching a fixture that something bigger is sitting on
# ---------------------------------------------------------------------------

def _picker_block() -> str:
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    blk = src[src.index("function _wireLightsPicker"):]
    return blk[:blk.index("\nfunction ")]


def test_right_click_offers_everything_under_the_pointer():
    """Left-click always hits the topmost marker.

    Once fixtures render at their real size a big one covers its neighbours,
    so the small ones became unreachable exactly when the map started telling
    the truth about size.
    """
    blk = _picker_block()
    assert "contextmenu" in blk, "there is no right-click picker"
    assert "querySelectorAll(\"g.lhex[data-eid]\")" in blk, (
        "the picker does not consider every marker"
    )


def test_the_picker_lists_the_smallest_first():
    """The small fixture is the one that could not be reached any other way."""
    blk = _picker_block()
    assert "a.area - b.area" in blk, (
        "picker results are not sorted smallest-first, so the occluded "
        "fixture is not the easiest to reach"
    )


def test_the_picker_is_wired_into_the_lights_map():
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    build = src[src.index("function _wireLightsBuild"):]
    build = build[:build.index("\nfunction ")]
    assert "_wireLightsPicker(" in build, "the picker is never attached"


# ---------------------------------------------------------------------------
# 6. A light stays in its room, whatever the pointer was over
# ---------------------------------------------------------------------------

def _floor_fn_block() -> str:
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    blk = src[src.index("function _floorIdForLight"):]
    return blk[:blk.index("\nfunction ")]


def test_a_lights_floor_comes_from_its_room_first():
    """Dragging must never re-assign the storey.

    Taking the floor from whichever slab the pointer was over moved lights
    between floors at random — and stranded them, because once a fixture was
    written onto a floor its room is not on, it stopped drawing with that room
    and there was nothing left to grab to bring it back.
    """
    blk = _floor_fn_block()
    room_idx = blk.index("room_geometry_m")
    prev_idx = blk.index("light_positions_m")
    drawn_idx = blk.index("_floorIdForZ(")
    assert room_idx < prev_idx < drawn_idx, (
        "the room's own floor is not consulted first — the drawn slab can "
        "still win and move the light to another storey"
    )


def test_both_write_paths_pin_the_floor_to_the_room():
    """The position drag and the transform commit both store a floor."""
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    body = src[src.index("function _wireLightsBuild"):]
    assert body.count("_floorIdForLight(") >= 2, (
        "a write path still derives the floor from the drawn height, so that "
        "path can move a light between storeys"
    )


def test_the_drawn_height_is_only_a_last_resort():
    """It is still needed for a light with no room and no stored floor."""
    blk = _floor_fn_block()
    assert "_floorIdForZ(" in blk, (
        "the fallback is gone — a light with no room and no stored floor "
        "would have no floor at all"
    )
