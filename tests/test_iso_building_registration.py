# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Two storeys of one building share one origin, or it is not a building.

Reported as "the wall look is at different angles for the floors", with a box
sticking out and too much empty space at the sides.

`fabricFrame` used to draw every floor centred on its OWN bounding box. The
justification, in its own comment, was that the floors "do not share a
footprint in the metre frame" and that scaling to the union gave "51 m against
a 29 m building". Both were true when written and neither is true now: the
51 m was the GARDEN, and outdoor rooms were later dropped from the map. On the
install this was reported from the indoor union is 33.7 m against the largest
floor's 30.2 — twelve percent.

What the workaround cost was the registration. Measured from the live fabric:

    basement  x -4.3..11.6   y -17.8..12.4   centre (3.7, -2.7)
    main      x -3.2..16.7   y -16.5..12.1   centre (6.7, -2.2)
    upper     x  3.4..12.8   y -21.3.. 6.2   centre (8.1, -7.6)

Those overlap the way the floors of a house overlap — the fabric is right. But
centring each floor on its own centre SHIFTS the upper floor 5.4 m in y
relative to the main floor beneath it. In an isometric that shears the stack:
the vertical edges between storeys join outlines that no longer line up, so
walls run at different angles per floor, the silhouette spreads wider than the
house, and a set-back floor reads as a box floating out of place.
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

FLOORS = [{"id": "basement", "level": -1}, {"id": "main", "level": 0},
          {"id": "upper", "level": 1}]


def _rect(fid, x0, y0, x1, y1):
    return {"type": "poly", "floor_id": fid,
            "points_m": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


# The reported install, reduced to one rectangle per floor at its real extent.
MODEL = {"room_geometry_m": {
    "Shop":    _rect("basement", -4.3, -17.8, 11.6, 12.4),
    "Kitchen": _rect("main",     -3.2, -16.5, 16.7, 12.1),
    "Bed":     _rect("upper",     3.4, -21.3, 12.8,  6.2),
}}


def _frame(tmp_path, model, floors, *, floor_gap=120, horiz_gap=0, probes=""):
    (tmp_path / "package.json").write_text('{"type":"module"}', encoding="utf-8")
    for p in _VIEWS.glob("*.js"):
        (tmp_path / p.name).write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "run.js").write_text(
        "import * as M from './iso_lights.js';\n"
        f"const f = M.fabricFrame({json.dumps(model)}, {json.dumps(floors)}, "
        f"{floor_gap}, {horiz_gap});\n"
        "const out = {levels: f.levels, scale: f.scale};\n"
        + probes +
        "console.log(JSON.stringify(out));\n", encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.js")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_same_metres_on_two_floors_land_on_the_same_spot(tmp_path) -> None:
    """The definition of a shared origin, and the whole fix in one assertion.

    Ignoring the storey lift, a point at (5, 0) is the same place on every
    floor. Under per-floor centring it was three different places.
    """
    out = _frame(tmp_path, MODEL, FLOORS, probes=(
        "const zs = f.levels;\n"
        "out.pts = zs.map(z => { const p = f.iso(5, 0, z); "
        "return [p[0], p[1] + f.rankOf(z) * 120]; });\n"
    ))
    xs = [p[0] for p in out["pts"]]
    ys = [p[1] for p in out["pts"]]
    assert max(xs) - min(xs) < 1e-6, f"floors are shifted horizontally: {out['pts']}"
    assert max(ys) - min(ys) < 1e-6, f"floors are shifted vertically: {out['pts']}"


def test_a_floor_that_is_set_back_is_drawn_set_back(tmp_path) -> None:
    """The upper floor really does start 4.9 m further along x than the main.

    Centring each floor hid that — every storey came out concentric, which is
    what made a genuinely offset floor look like a box in the wrong place once
    its outline no longer matched the one below.
    """
    out = _frame(tmp_path, MODEL, FLOORS, probes=(
        "const zm = f.levelOf('main'), zu = f.levelOf('upper');\n"
        "out.mainX0 = f.iso(-3.2, 0, zm)[0];\n"
        "out.upperX0 = f.iso(3.4, 0, zu)[0];\n"
        "out.mainAt = f.iso(3.4, 0, zm)[0];\n"
    ))
    # The upper floor's near corner sits where 3.4 m sits on the main floor.
    assert abs(out["upperX0"] - out["mainAt"]) < 1e-6, out
    assert out["upperX0"] > out["mainX0"], "the set-back floor was re-centred away"


def test_the_projection_is_the_same_shape_on_every_floor(tmp_path) -> None:
    """Walls at different angles per floor was the reported symptom.

    A wall is a straight run in metres; its screen direction is fixed by the
    isometric and must not depend on which storey it is on. Only a per-floor
    translation could change where it lands — and a shear of the stack is what
    a viewer reads as the angles disagreeing.
    """
    out = _frame(tmp_path, MODEL, FLOORS, probes=(
        "out.dirs = f.levels.map(z => { const a = f.iso(0, 0, z), b = f.iso(3, 1, z);\n"
        "  return [b[0]-a[0], b[1]-a[1]]; });\n"
    ))
    first = out["dirs"][0]
    for d in out["dirs"][1:]:
        assert abs(d[0] - first[0]) < 1e-9 and abs(d[1] - first[1]) < 1e-9, (
            f"a wall runs at a different angle on another floor: {out['dirs']}")


def test_the_inverse_undoes_the_projection_on_every_floor(tmp_path) -> None:
    """Dragging a light reads metres back out of the pointer.

    The forward and inverse carried the same per-floor offset, so removing it
    from one and not the other would put fixtures on the wrong floor's
    coordinates — silently, and only on the floors that were offset.
    """
    out = _frame(tmp_path, MODEL, FLOORS, probes=(
        "out.rt = f.levels.map(z => { const p = f.iso(7.5, -4.25, z);\n"
        "  return f.isoInv(p[0], p[1], z); });\n"
    ))
    for x, y in out["rt"]:
        assert abs(x - 7.5) < 1e-6 and abs(y + 4.25) < 1e-6, out["rt"]


def test_the_building_still_fits_the_canvas(tmp_path) -> None:
    """Scaling moved from the largest floor to the union, so it must still fit.

    A shared origin means the widest storey is no longer the widest thing on
    screen — the union of all of them is.
    """
    out = _frame(tmp_path, MODEL, FLOORS, probes=(
        "const pts = [];\n"
        "for (const r of f.rooms) for (const p of r.pts) pts.push(f.iso(p[0], p[1], r.z));\n"
        "out.minX = Math.min(...pts.map(p=>p[0])); out.maxX = Math.max(...pts.map(p=>p[0]));\n"
        "out.minY = Math.min(...pts.map(p=>p[1])); out.maxY = Math.max(...pts.map(p=>p[1]));\n"
    ))
    assert out["scale"] > 0
    # ISO canvas is 760 x 940; the drawing has to sit inside it with the
    # storey lift included, or the fix trades a shear for an overflow.
    assert out["minX"] >= -1 and out["maxX"] <= 761, out
    assert out["minY"] >= -1 and out["maxY"] <= 941, out


def test_the_drawing_fills_the_canvas_it_is_given(tmp_path) -> None:
    """Scale is fitted to the drawn shape, not to the box around it.

    The isometric of a bounding rectangle is a diamond, and a building never
    fills its diamond — sizing to one left a third of the width unused, with
    uneven margins because the metre bbox centre is not the centre of the
    projected shape. Measured before: 533 px of drawing in a 760 px canvas,
    90 px margin one side and 137 px the other.
    """
    out = _frame(tmp_path, MODEL, FLOORS, probes=(
        "const xs=[];\n"
        "for (const r of f.rooms) for (const p of r.pts) xs.push(f.iso(p[0],p[1],r.z)[0]);\n"
        "out.minX=Math.min(...xs); out.maxX=Math.max(...xs);\n"
    ))
    width = out["maxX"] - out["minX"]
    left, right = out["minX"], 760 - out["maxX"]
    # The horizontal budget is W-90; the drawing has to actually use it.
    assert width >= 760 - 90 - 2, f"only {width:.0f} px of 670 used"
    # And sit in the middle of what is left, rather than off to one side.
    assert abs(left - right) < 2.0, f"margins {left:.0f} / {right:.0f}"


def test_a_single_floor_building_is_unchanged(tmp_path) -> None:
    """With one floor there is nothing to register, and nothing may move."""
    one = {"room_geometry_m": {"Kitchen": _rect("main", -3.2, -16.5, 16.7, 12.1)}}
    out = _frame(tmp_path, one, [{"id": "main", "level": 0}], probes=(
        "out.c = f.iso(6.75, -2.2, f.levelOf('main'));\n"
    ))
    # The building's own centre lands on the canvas centre, as it always did.
    assert abs(out["c"][0] - 380) < 1e-6, out
