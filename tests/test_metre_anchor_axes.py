"""The metre anchor carries two scales, because world space has two.

Issue #62. A user trimmed a floor plan, and afterwards the room outlines in the
overhead view were correct across and squashed down — while the radios on the
same image stayed exactly where they belonged.

Both halves of that are explained by one line. `metreAnchor()` read the map's
x AND y metric scales, validated both, and returned only the x figure. Every
consumer then applied that single number to both axes. Radios were unaffected
because they are stored as fractions of the image and never pass through the
anchor at all.

It only ever looked right while a map's pixel aspect matched its metric aspect.
Trimming changes the stored dimensions, `ar` moves with them, and the fabric
gets drawn through a scale that no longer describes the picture it is drawn on.
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

# A map 20 m wide and 10 m tall, stored as an image twice as wide as it is high.
# Pixel aspect and metric aspect AGREE, so one scale would have worked.
SQUARE = {
    "id": "ground",
    "image": {"width": 1000, "height": 500},
    "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.5, "rotation": 0,
              "x_offset": 0, "y_offset": 0, "z_level": 0, "floor_id": "main"},
}
SQUARE_T = {"scale_x_m": 20.0, "scale_y_m": 10.0, "reference_measurements": [{"m": 20.0}]}

# The same plan after trimming: the IMAGE lost half its height (ref_ar 0.5 ->
# 0.25) while the stored metric height still describes the untrimmed plan —
# 10 m, not 5. That disagreement is the bug condition, and it is what "shows
# the scaled full map instead of the trimmed version" means in numbers.
#
#   x: 20 m across a world width of 1.00  -> 20 m per world unit
#   y: 10 m down  a world height of 0.25  -> 40 m per world unit
#
# A factor of two, on y only, which is the vertical squash in the screenshots.
# NOTE: an earlier version of this fixture used scale_y_m 5.0, which makes both
# figures 20 and quietly agrees — the test passed with the bug reintroduced.
# A fixture that cannot fail is worse than no fixture.
TRIMMED = {
    "id": "ground",
    "image": {"width": 1000, "height": 250},
    "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.25, "rotation": 0,
              "x_offset": 0, "y_offset": 0, "z_level": 0, "floor_id": "main"},
}
TRIMMED_T = {"scale_x_m": 20.0, "scale_y_m": 10.0, "reference_measurements": [{"m": 20.0}]}

MODEL_ROOMS = {
    "room_geometry_m": {
        # A 4 m x 4 m room — SQUARE in metres, which is what makes an axis
        # error visible rather than merely present.
        "Study": {"type": "poly", "floor_id": "main",
                  "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
    },
}


def _run(tmp_path: Path, script: str) -> dict:
    src = (_VIEWS / "stack_transform.js").read_text(encoding="utf-8")
    (tmp_path / "stack_transform.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(
        "import * as S from './stack_transform.mjs';\nconst out={};\n"
        + script + "\nconsole.log(JSON.stringify(out));\n", encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_anchor_reports_both_axes(tmp_path):
    out = _run(tmp_path, (
        f"const MAPS=[{json.dumps(TRIMMED)}];\n"
        f"const T={{ground:{json.dumps(TRIMMED_T)}}};\n"
        "const a=S.metreAnchor(MAPS,T);\n"
        "out.x=a.m_per_world_x; out.y=a.m_per_world_y; out.legacy=a.m_per_world;\n"
    ))
    # x: 20 m across a world width of 1.0
    assert abs(out["x"] - 20.0) < 1e-9, out
    # y: 10 m down a world height of ref_ar = 0.25
    assert abs(out["y"] - 40.0) < 1e-9, out
    assert out["y"] != out["x"], "the fixture no longer exercises the fault"
    # The legacy field keeps its old meaning for readers that only want x.
    assert abs(out["legacy"] - out["x"]) < 1e-9, out


def test_a_square_room_stays_square_on_a_trimmed_map(tmp_path):
    """The bug, stated as the thing a user can see.

    A 4x4 m room must come out with equal width and height in world space. With
    one x-derived scale on a trimmed map it came out four times too tall in
    world units, which is the vertical squash in the screenshots.
    """
    out = _run(tmp_path, (
        f"const MAPS=[{json.dumps(TRIMMED)}];\n"
        f"const MODEL=Object.assign({json.dumps(MODEL_ROOMS)},{{map_transforms:{{ground:{json.dumps(TRIMMED_T)}}}}});\n"
        "const rooms=S.fabricWorldRooms(MAPS,MODEL);\n"
        "const pts=rooms.Study.pts;\n"
        "const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);\n"
        "out.w=Math.max(...xs)-Math.min(...xs);\n"
        "out.h=Math.max(...ys)-Math.min(...ys);\n"
    ))
    # 4 m / 20 m across = 0.20 world units wide.
    # 4 m / 40 m per world unit = 0.10 world units tall.
    # Those are DIFFERENT numbers, and they must be, because world y is not
    # world x — 0.10 of a 0.25-tall world is the same fraction as 0.20 of a
    # 1.0-wide world. Squashing y through the x scale is what made the room
    # twice as tall as it should be on screen.
    assert abs(out["w"] - 0.2) < 1e-9, out
    assert abs(out["h"] - 0.1) < 1e-9, out
    assert abs(out["w"] / max(out["h"], 1e-12) - 2.0) < 1e-6, (
        "the room is not being scaled per axis: %r" % (out,))


def test_an_undistorted_map_is_completely_unchanged(tmp_path):
    """Nobody whose maps were fine may notice this fix.

    When pixel aspect and metric aspect agree, the two scales are equal and the
    new code must produce exactly what the old single scale did.
    """
    out = _run(tmp_path, (
        f"const MAPS=[{json.dumps(SQUARE)}];\n"
        f"const MODEL=Object.assign({json.dumps(MODEL_ROOMS)},{{map_transforms:{{ground:{json.dumps(SQUARE_T)}}}}});\n"
        "const a=S.metreAnchor(MAPS,{ground:" + json.dumps(SQUARE_T) + "});\n"
        "out.x=a.m_per_world_x; out.y=a.m_per_world_y;\n"
        "const rooms=S.fabricWorldRooms(MAPS,MODEL);\n"
        "const pts=rooms.Study.pts;\n"
        "const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);\n"
        "out.w=Math.max(...xs)-Math.min(...xs);\n"
        "out.h=Math.max(...ys)-Math.min(...ys);\n"
    ))
    assert abs(out["x"] - out["y"]) < 1e-9, out
    assert abs(out["w"] - 0.2) < 1e-9, out
    assert abs(out["h"] - 0.2) < 1e-9, out


def test_scanners_use_the_same_two_scales_as_the_rooms(tmp_path):
    """Rooms and radios must land in ONE space or the map is a lie.

    fabricWorldScanners had the same single-scale bug. Had only the rooms been
    fixed, they would have become correct and started disagreeing with the
    scanners instead — the same complaint with the blame moved.
    """
    model = dict(MODEL_ROOMS)
    model["map_transforms"] = {"ground": TRIMMED_T}
    model["scanner_positions_m"] = {
        # Sitting exactly on the far corner of the 4x4 room.
        "AA:BB:CC:DD:EE:FF": {"x_m": 4.0, "y_m": 4.0, "z_m": 2.4, "floor_id": "main"},
    }
    out = _run(tmp_path, (
        f"const MAPS=[{json.dumps(TRIMMED)}];\n"
        f"const MODEL={json.dumps(model)};\n"
        "const rooms=S.fabricWorldRooms(MAPS,MODEL);\n"
        "const sc=S.fabricWorldScanners(MAPS,MODEL);\n"
        "const pts=rooms.Study.pts;\n"
        "out.roomMaxX=Math.max(...pts.map(p=>p[0]));\n"
        "out.roomMaxY=Math.max(...pts.map(p=>p[1]));\n"
        "out.sx=sc.scanners[0].wx; out.sy=sc.scanners[0].wy;\n"
    ))
    assert abs(out["sx"] - out["roomMaxX"]) < 1e-9, out
    assert abs(out["sy"] - out["roomMaxY"]) < 1e-9, (
        "the scanner on the room's corner does not land on the room's corner: %r" % (out,)
    )


def test_a_circular_room_becomes_an_ellipse_when_the_axes_differ(tmp_path):
    """A circle in metres is not a circle in an anisotropic space.

    Drawing it as one — on either scale, or their mean — puts the room's edge
    in the wrong place on exactly the maps this fix is for.
    """
    model = {
        "room_geometry_m": {
            "Turret": {"type": "circle", "floor_id": "main",
                       "cx_m": 10.0, "cy_m": 2.5, "r_m": 2.0},
        },
        "map_transforms": {"ground": TRIMMED_T},
    }
    out = _run(tmp_path, (
        f"const MAPS=[{json.dumps(TRIMMED)}];\n"
        f"const MODEL={json.dumps(model)};\n"
        "const pts=S.fabricWorldRooms(MAPS,MODEL).Turret.pts;\n"
        "const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);\n"
        "out.w=Math.max(...xs)-Math.min(...xs);\n"
        "out.h=Math.max(...ys)-Math.min(...ys);\n"
        "out.n=pts.length;\n"
    ))
    assert out["n"] == 16
    # 4 m across / 20 = 0.20 wide; 4 m down / 40 = 0.10 tall — an ellipse.
    assert abs(out["w"] - 0.2) < 1e-9, out
    assert abs(out["h"] - 0.1) < 1e-9, out
