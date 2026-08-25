# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Rooms tab draws a map's placement, and it has to draw the whole of it.

Two draw sites, both four degrees of freedom against a record that has six:

  * `_mapFootprintM` — the dashed outline of where a map sits — built its four
    corners from origin, both scales and `rotation_rad`.
  * the ghosted `<image>` beside it — the photo itself at that pose — was
    x / y / width / height plus a `rotate()`.

Four numbers plus an angle describe a rectangle. `shear_rad` says the map's
two axes are not square to each other, which is what a Point Align full
transform, a mirror, and any rotated placement on a degraded anchor all
produce — so a sheared map drew as a rectangle in the ONE panel whose job is
to show a system placement and a stack placement disagreeing. The
disagreement it could not draw was the one about the lean.

Both now ask `mapFracToMetres` — the function every pin converts through —
where a fraction of the map goes, instead of rebuilding the placement out of
its fields. The picture and the pins therefore cannot disagree, and this file
grows no fourth copy of the model.

Checked as NUMBERS against the backend's `map_frac_to_metres`, through the
functions exactly as they ship (lifted out of maps.js by text, the same route
tests/js/align_master_refusal.mjs uses), plus the control that every fixture
here really is sheared: with σ dropped, the same corners move metres.

`preserveAspectRatio="none"` is checked with them. It is not arithmetic — it
is what the SVG renderer does with an `<image>` whose box does not match the
photo's intrinsic aspect — and under the unit square + `matrix()` drawing that
box IS the placement. The default fits the photo inside instead of filling it,
which letterboxes a 4:3 photo on a 20 x 15 m map to 11.25 m tall: 1.875 m of
blank at each horizontal edge, on the ghost whose only job is to show where
the photo sits.

Confirmed as cover by mutation: putting `_mapAffineM` back on
cos/sin(rotation_rad) and the two scales — the four degrees of freedom both
sites used to have — fails
`test_both_draw_sites_draw_the_placement_the_record_holds`; dropping the
`preserveAspectRatio` line from the shipped element fails the same test, on
the check named for it.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import seed_world_gauge

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "map_draw_sites.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_GRID = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.5, 0.5), (0.137, 0.911)]
_CORNERS = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]

# Placements the four-DOF version could not draw: a lean either way, a mirror,
# and a solved affine that is neither.
_RECORDS = {
    "5 deg lean": {"origin_x_m": 3.0, "origin_y_m": -1.0, "scale_x_m": 20.0,
                   "scale_y_m": 15.0, "rotation_rad": 0.25, "shear_rad": math.radians(5)},
    "minus 12 deg lean": {"origin_x_m": -4.5, "origin_y_m": 8.0, "scale_x_m": 18.0,
                          "scale_y_m": 12.0, "rotation_rad": -0.9,
                          "shear_rad": math.radians(-12)},
    "mirror": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 14.0,
               "scale_y_m": 14.0, "rotation_rad": 0.4, "shear_rad": math.pi},
    "point align": {"origin_x_m": 11.0, "origin_y_m": 2.5, "scale_x_m": 25.0,
                    "scale_y_m": 9.0, "rotation_rad": 1.2, "shear_rad": -0.31},
}


def _store(t: dict) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.data = {"map_transforms": {"m": t}}
    seed_world_gauge(s, [{"id": "m", "image": {"width": 800, "height": 600},
                          "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
                                    "rotation": 0, "x_offset": 0, "y_offset": 0,
                                    "is_master": True}}])
    s.fabric = None
    return s


@pytest.fixture(scope="module")
def result(tmp_path_factory) -> dict:
    cases = []
    for name, t in sorted(_RECORDS.items()):
        s = _store(t)
        cases.append({
            "name": name, "t": t,
            "grid": [{"f": [fx, fy], "m": list(s.map_frac_to_metres(fx, fy, "m"))}
                     for fx, fy in _GRID],
            "corners": [list(s.map_frac_to_metres(fx, fy, "m")) for fx, fy in _CORNERS],
        })
    path = tmp_path_factory.mktemp("draw") / "cases.json"
    path.write_text(json.dumps(cases), encoding="utf-8")
    res = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS), str(path)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in (res.stdout or "").strip().splitlines() if ln.startswith("{")]
    assert lines, (
        "the harness itself failed — a harness bug, not a draw bug:\n"
        f"{(res.stderr or '')[-3000:]}"
    )
    return json.loads(lines[-1])


def test_both_draw_sites_draw_the_placement_the_record_holds(result) -> None:
    assert not result["failures"], json.dumps(result["failures"], indent=2)


def test_the_harness_checked_what_it_claims_to(result) -> None:
    """A harness that silently checked nothing would pass the test above."""
    assert result["n"] == len(_RECORDS)
    assert len(result["checks"]) == 6, result["checks"]
    # …and the fixtures are genuinely sheared: four DOF is metres out on every
    # one of them, so neither measurement above is passing on a rectangle.
    assert result["worst"]["control"] > 1.0, result["worst"]


def test_the_stack_derived_records_land_here_too() -> None:
    """The four hand-written records above are the shapes; this is the proof
    they are the shapes a real stack produces. `legacy_stack_metre_transform` writes
    σ for a Point-Aligned map, and that is the record the panel is handed."""
    m = {"id": "m", "floor_id": "main", "image": {"width": 1600, "height": 1200},
         "stack": {"_m": [1.0, -math.sin(math.radians(5)), 0.0,
                          math.cos(math.radians(5)) / 0.75],
                   "_m_ar": 0.75, "ref_ar": 0.75, "x_offset": 0.13,
                   "y_offset": -0.07, "is_master": True}}
    t = fabric_truth.legacy_stack_metre_transform(
        m, {"m_per_unit": 20.0})
    assert abs(t["shear_rad"]) > 0.05, "the fixture the panel is handed is not sheared"
