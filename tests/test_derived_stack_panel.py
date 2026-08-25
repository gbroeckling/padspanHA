# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The panel draws a map from its placement, and the two languages agree.

`stack_world_xform` and `makeStackXform` are one function written twice, so
this generates the cases in Python — the world coordinates, the align stage's
affine, and a Point Align composition — and hands them to node to reproduce.
A disagreement here is a map drawn in one place and positioned in another,
which is the entire class of bug this release deletes; it cannot be checked by
reading either file.

The align editor's gestures are replayed too. Every one of them edits the
placement and the stage is redrawn from it, so what the owner is looking at
and what Save commits are the same object. That is what "the stack is derived"
means at 60 Hz: there is no second description for a gesture to update and
forget, which is why the four controls that used to null `_m` on one click do
not have to.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import fabric_truth

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "derived_stack.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_FRACS = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0], [0.5, 0.5],
          [0.137, 0.911], [0.73, 0.21]]

_PLACEMENTS = [
    ("square", {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}),
    ("offset", {"origin_x_m": -7.25, "origin_y_m": 31.5, "scale_x_m": 12.5,
                "scale_y_m": 9.75, "rotation_rad": 0.0, "shear_rad": 0.0}),
    ("turned 30 deg", {"origin_x_m": 3.0, "origin_y_m": -2.0, "scale_x_m": 20.0,
                       "scale_y_m": 15.0, "rotation_rad": math.radians(30),
                       "shear_rad": 0.0}),
    ("turned 143 deg", {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 18.0,
                        "scale_y_m": 24.0, "rotation_rad": math.radians(143),
                        "shear_rad": 0.0}),
    ("leaning 5 deg", {"origin_x_m": 1.0, "origin_y_m": 2.0, "scale_x_m": 20.0,
                       "scale_y_m": 15.0, "rotation_rad": 0.0,
                       "shear_rad": math.radians(5)}),
    ("leaning -20 deg, turned", {"origin_x_m": 40.0, "origin_y_m": -12.0,
                                 "scale_x_m": 33.0, "scale_y_m": 8.0,
                                 "rotation_rad": math.radians(-77),
                                 "shear_rad": math.radians(-20)}),
    ("mirrored", {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                  "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": math.pi}),
]

_GAUGES = [20.0, 1.0, 0.375, 137.4]


@pytest.fixture(scope="module")
def result() -> dict:
    world = []
    for gk in _GAUGES:
        gauge = {"m_per_unit": gk, "source_map_id": "m0"}
        for name, t in _PLACEMENTS:
            xf = fabric_truth.stack_world_xform(t, gauge)
            world.append({
                "name": f"{name} @ {gk} m/unit", "transform": t, "gauge": gauge,
                "fracs": _FRACS,
                "world": [list(xf(fx, fy)) for fx, fy in _FRACS],
            })

    # The align stage: every placement drawn over every other placement, which
    # is what picking a Reference and a Target does.
    stage = []
    for rname, ref in _PLACEMENTS:
        for tname, tgt in _PLACEMENTS:
            if rname == tname:
                continue
            stage.append({"name": f"{tname} over {rname}", "target": tgt,
                          "reference": ref, "fracs": _FRACS})

    # Point Align: a solve in reference-fraction space, composed with the
    # reference's record and read off its two metre columns.
    point_align = []
    for i, (rname, ref) in enumerate(_PLACEMENTS):
        m = [0.8 + 0.1 * i, -0.15 + 0.05 * i, 0.2 - 0.04 * i, 1.1 - 0.07 * i]
        dx, dy = 0.031 * (i + 1), -0.019 * (i + 1)

        def at(u, v, m=m, dx=dx, dy=dy, ref=ref):
            fx = m[0] * (u - 0.5) + m[1] * (v - 0.5) + 0.5 + dx
            fy = m[2] * (u - 0.5) + m[3] * (v - 0.5) + 0.5 + dy
            return fabric_truth.placement_metres(ref, fx, fy)

        o, ex, ey = at(0, 0), at(1, 0), at(0, 1)
        expected = fabric_truth.placement_from_columns(
            o, (ex[0] - o[0], ex[1] - o[1]), (ey[0] - o[0], ey[1] - o[1]))
        point_align.append({"name": f"solve onto {rname}", "reference": ref,
                            "m": m, "dx": dx, "dy": dy, "fracs": _FRACS,
                            "expected": expected})

    cases = _ROOT / "tests" / "js" / "_derived_stack_cases.json"
    cases.write_text(json.dumps(
        {"world": world, "stage": stage, "point_align": point_align}), encoding="utf-8")
    try:
        res = subprocess.run(
            [_NODE, str(_SCRIPT), str(_VIEWS), str(cases)],
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        )
    finally:
        cases.unlink(missing_ok=True)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_the_panel_and_the_backend_draw_the_same_map(result) -> None:
    assert not result["failures"], json.dumps(result["failures"][:8], indent=2)


def test_the_harness_actually_checked_something(result) -> None:
    assert len(result["checks"]) > 200, len(result["checks"])
    # And the agreement is exact, not merely inside a tolerance.
    for k, v in result["worst"].items():
        assert v <= 1e-9, f"{k}: {v}"
