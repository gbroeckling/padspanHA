"""The panel's copy of the metre anchor is DELETED, gauge and all.

Issue #62. A user trimmed a floor plan, and afterwards the room outlines in the
overhead view were correct across and squashed down — while the radios on the
same image stayed exactly where they belonged.

`metreAnchor()` read the map's x AND y metric scales, validated both, and
returned only the x figure. Every consumer applied that single number to both
axes. The fix was to return the pair and make every consumer take the right
half of it.

That was the patch. R2 removes the thing that made a pair possible: the panel
does not MEASURE the house's scale any more. `model.world_gauge` is one stored
scalar, the backend writes it once, and `worldGauge()` reads it. So
`m_per_world_x`, `m_per_world_y` and `isoError` are not wrong — they are
unrepresentable, and with them go the two sites that were still applying the x
figure to y (`calibration.js`, `traceback.js`), which is why this file now
proves those two dead rather than testing that they pick correctly.

The tests below are the ones that survive the deletion, restated against one
gauge, plus the guards that stop the measurement growing back.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
          / "www" / "padspan-ha" / "views")
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

# A map 20 m wide and 10 m tall, stored as an image twice as wide as it is high.
SQUARE = {
    "id": "ground",
    "image": {"width": 1000, "height": 500},
    "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.5, "rotation": 0,
              "x_offset": 0, "y_offset": 0, "z_level": 0, "floor_id": "main",
              "is_master": True},
}
SQUARE_T = {"scale_x_m": 20.0, "scale_y_m": 10.0, "reference_measurements": [{"m": 20.0}]}

# 20 m per world unit: what the backend seeds from SQUARE.
GAUGE = {"m_per_unit": 20.0, "source_map_id": "ground"}

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


def _src(name: str) -> str:
    return (_VIEWS / name).read_text(encoding="utf-8", errors="replace")


# ── the measurement is gone from the panel ───────────────────────────────────

def test_the_panel_no_longer_measures_the_house() -> None:
    """`metreAnchor` is deleted, not renamed and not kept for compatibility.

    It was a SECOND implementation of a measurement the backend was already
    doing, which is how the reader and the writer came to be able to pick
    different maps and disagree about how big the house is.
    """
    for name in ("stack_transform.js", "calibration.js", "traceback.js",
                 "plan_viewer.js", "maps.js", "radio_map.js"):
        body = _src(name)
        # The word survives in one historical comment; a CALL does not.
        assert "metreAnchor(" not in body, f"{name} still measures the anchor"
    stack = _src("stack_transform.js")
    assert "export function worldGauge(" in stack
    for gone in ("m_per_world_x", "m_per_world_y", "ANCHOR_ISO_TOL"):
        assert f"const {gone}" not in stack and f"{gone}:" not in stack, gone


def test_the_gauge_is_read_not_derived(tmp_path) -> None:
    """One scalar in, one scalar out, and no map list to walk."""
    out = _run(tmp_path, (
        f"const g=S.worldGauge({{world_gauge:{json.dumps(GAUGE)}}});\n"
        "out.k=g.m_per_unit; out.src=g.source_map_id;\n"
        "out.keys=Object.keys(g).sort();\n"
    ))
    assert out["k"] == 20.0 and out["src"] == "ground"
    assert out["keys"] == ["m_per_unit", "source_map_id"], out


# What a stored gauge may be, and what it may not. ONE table, checked in both
# languages, because a reader and a writer that disagree about which records
# are usable is this project's bug class in miniature — it is how the panel and
# the backend came to be able to pick different anchor maps.
#
# `map_transforms` has shipped a null, a string, a zero and a NaN in a scale
# field (migration step 10 exists to repair exactly those), so a stored gauge
# has to survive the same inputs. The answer for an unusable one is the refusal
# every consumer already handles; inventing a number is the deleted 20 m
# fallback.
#
# A numeric STRING is USABLE and is accepted: `float("20")` and `Number("20")`
# both give 20, both languages already did, and refusing it would blank a house
# whose scale is perfectly well known over a JSON type. Zero, negatives,
# Infinity, NaN and anything non-numeric are not usable at any price.
_GAUGE_CASES = [
    ({"m_per_unit": 20.0, "source_map_id": "ground"}, True),
    ({"m_per_unit": 20}, True),
    ({"m_per_unit": "20"}, True),
    ({"m_per_unit": 0.0001}, True),
    (None, False),
    ({}, False),
    ({"m_per_unit": None}, False),
    ({"m_per_unit": 0}, False),
    ({"m_per_unit": -3}, False),
    ({"m_per_unit": ""}, False),
    ({"m_per_unit": "wide"}, False),
    ({"m_per_unit": [20]}, False),      # Number([20]) is 20; float([20]) raises
    ({"m_per_unit": True}, False),      # float(True) is 1.0; typeof true is not a number
    ({"m_per_unit": {"m": 20}}, False),
    ({"m_per_unit": "Infinity"}, False),
]


@pytest.mark.parametrize("stored,usable", _GAUGE_CASES,
                         ids=[repr(c[0]) for c in _GAUGE_CASES])
def test_the_panel_and_the_backend_agree_on_which_gauges_are_usable(
        tmp_path, stored, usable) -> None:
    """The same record, the same verdict, on both sides of the websocket."""
    from custom_components.padspan_ha import fabric_truth

    model = {"world_gauge": stored} if stored is not None else {}

    class _Store:
        def world_gauge(self):
            return stored

    py = fabric_truth.metre_gauge(_Store())
    out = _run(tmp_path, (
        "out.g=S.worldGauge(" + json.dumps(model) + ");\n"
        "out.rooms=S.fabricWorldRooms(Object.assign("
        + json.dumps(MODEL_ROOMS) + "," + json.dumps(model) + "));\n"
    ))

    assert (py is not None) is usable, py
    assert (out["g"] is not None) is usable, out
    if usable:
        assert py["m_per_unit"] == out["g"]["m_per_unit"], (py, out["g"])
    else:
        assert out["rooms"] is None, "an ungauged fabric drew something anyway"


# ── nothing moves on a map that was fine ─────────────────────────────────────

def test_an_undistorted_map_is_completely_unchanged(tmp_path) -> None:
    """Nobody whose maps were fine may notice this.

    On SQUARE the pair's two figures were both 20.0, so one gauge of 20.0
    reproduces the old arithmetic exactly: a 4 m square room is 0.2 world
    units on both axes, as it was.
    """
    model = dict(MODEL_ROOMS, world_gauge=GAUGE,
                 map_transforms={"ground": SQUARE_T})
    out = _run(tmp_path, (
        f"const MODEL={json.dumps(model)};\n"
        "const pts=S.fabricWorldRooms(MODEL).Study.pts;\n"
        "const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);\n"
        "out.w=Math.max(...xs)-Math.min(...xs);\n"
        "out.h=Math.max(...ys)-Math.min(...ys);\n"
    ))
    assert abs(out["w"] - 0.2) < 1e-9, out
    assert abs(out["h"] - 0.2) < 1e-9, out


def test_a_square_room_stays_square(tmp_path) -> None:
    """One gauge is a SIMILARITY: it cannot stretch one axis.

    The pair could — that is issue #62 as the user saw it — and getting the
    halves the right way round was the patch. There are no halves.
    """
    model = dict(MODEL_ROOMS, world_gauge=GAUGE,
                 map_transforms={"ground": SQUARE_T})
    out = _run(tmp_path, (
        f"const MODEL={json.dumps(model)};\n"
        "const pts=S.fabricWorldRooms(MODEL).Study.pts;\n"
        "const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);\n"
        "out.r=(Math.max(...xs)-Math.min(...xs))/(Math.max(...ys)-Math.min(...ys));\n"
    ))
    assert abs(out["r"] - 1.0) < 1e-12, out


def test_scanners_land_in_the_same_space_as_the_rooms(tmp_path) -> None:
    """Rooms and radios must land in ONE space or the map is a lie.

    `fabricWorldScanners` had the same single-scale bug, and fixing only the
    rooms would have made them correct and started them disagreeing with the
    scanners instead — the same complaint with the blame moved. They read the
    same gauge through the same helper now, so they cannot part.
    """
    model = dict(MODEL_ROOMS, world_gauge=GAUGE,
                 map_transforms={"ground": SQUARE_T},
                 scanner_positions_m={
                     # Sitting exactly on the far corner of the 4x4 room.
                     "AA:BB:CC:DD:EE:FF": {"x_m": 4.0, "y_m": 4.0, "z_m": 2.4,
                                           "floor_id": "main"}})
    out = _run(tmp_path, (
        f"const MODEL={json.dumps(model)};\n"
        "const pts=S.fabricWorldRooms(MODEL).Study.pts;\n"
        "const sc=S.fabricWorldScanners(MODEL);\n"
        "out.roomMaxX=Math.max(...pts.map(p=>p[0]));\n"
        "out.roomMaxY=Math.max(...pts.map(p=>p[1]));\n"
        "out.sx=sc.scanners[0].wx; out.sy=sc.scanners[0].wy;\n"
        "out.k=sc.m_per_unit;\n"
    ))
    assert abs(out["sx"] - out["roomMaxX"]) < 1e-12, out
    assert abs(out["sy"] - out["roomMaxY"]) < 1e-12, (
        "the scanner on the room's corner does not land on the room's corner: %r" % (out,)
    )
    assert out["k"] == 20.0, "the scale handed to consumers is not the gauge"


def test_a_circular_room_stays_a_circle(tmp_path) -> None:
    """The ellipse is deleted, not tuned.

    A circle in metres was an ELLIPSE in world space whenever the two scales
    differed, so this drew a 16-gon with two radii. A similarity preserves
    every ratio: the 16-gon is regular.
    """
    model = {
        "world_gauge": GAUGE,
        "map_transforms": {"ground": SQUARE_T},
        "room_geometry_m": {"Turret": {"type": "circle", "floor_id": "main",
                                       "cx_m": 10.0, "cy_m": 5.0, "r_m": 2.0}},
    }
    out = _run(tmp_path, (
        f"const MODEL={json.dumps(model)};\n"
        "const pts=S.fabricWorldRooms(MODEL).Turret.pts;\n"
        "const cx=10.0/20.0, cy=5.0/20.0;\n"
        "const rs=pts.map(p=>Math.hypot(p[0]-cx,p[1]-cy));\n"
        "out.min=Math.min(...rs); out.max=Math.max(...rs);\n"
    ))
    # Every vertex the same distance from the centre — that is what "circle"
    # means, and it was not true before.
    assert abs(out["max"] - out["min"]) < 1e-12, out
    assert abs(out["min"] - 2.0 / 20.0) < 1e-12, out


# ── the two live x-scale-applied-to-y bugs, asserted dead ────────────────────

@pytest.mark.parametrize("name", ["calibration.js", "traceback.js"])
def test_no_view_inverts_the_gauge_by_hand(name) -> None:
    """`const k = 1 / anchor.m_per_world` then `x * k, y * k`.

    Both of these took the X figure of a per-axis pair and applied it to BOTH
    components. Measured on a trimmed anchor (kx 20 m, ky 40 m per world
    unit), an object 10.00 m down the house was drawn at world 0.5000 instead
    of 0.2500 — 10.000 m out in y, on the calibration overlay and in the
    traceback replay.

    They go through `metresToWorld` now, which is the single place the gauge
    is inverted. Hand-inverting it is how the second copy gets made, so the
    text is what is banned, not just the wrong half.
    """
    body = _src(name)
    stripped = re.sub(r"^\s*//.*$", "", body, flags=re.M)
    assert not re.search(r"1\s*/\s*\w*\.?m_per_", stripped), (
        f"{name} inverts a metres-per-world figure by hand again"
    )
    assert "metresToWorld(" in stripped, (
        f"{name} does not use the one place the gauge is inverted"
    )


def test_what_the_two_bugs_cost_while_they_were_live(tmp_path) -> None:
    """The number, so "dead" is a measurement and not an adjective.

    On a map trimmed to a quarter of its height the pair read 20 m per world
    unit across and 40 m down. Both views took the x figure and applied it to
    y, so an object 10.00 m down the house was drawn at world 0.5000 where it
    belonged at 0.2500 — half the height of the whole picture, every frame.

    Reconstructed from the deleted arithmetic, because there is no way left to
    express the state that caused it.
    """
    kx, ky = 20.0, 40.0
    y_m = 10.0
    drawn_wrong = y_m / kx
    drawn_right = y_m / ky
    assert drawn_wrong == pytest.approx(0.5)
    assert drawn_right == pytest.approx(0.25)
    assert abs(drawn_wrong - drawn_right) * ky == pytest.approx(10.0), (
        "the fixture no longer shows the cost")

    # And the state itself: a gauge cannot hold two axis scales to pick from.
    out = _run(
        tmp_path,
        "out.g=S.worldGauge({world_gauge:{m_per_unit:20,m_per_world_y:40}});",
    )
    assert out["g"] == {"m_per_unit": 20, "source_map_id": None}, out


def test_the_inversion_lives_in_exactly_one_place() -> None:
    """The invariant the two bugs above violated, stated once.

    Everything that converts metres into world coordinates divides by the
    gauge, and it divides in `metresToWorld`. A second division site is a
    second chance to divide by the wrong thing, which is what a pair of axis
    scales guaranteed.
    """
    stack = _src("stack_transform.js")
    body = re.sub(r"^\s*//.*$", "", stack, flags=re.M)
    assert body.count("1 / gauge.m_per_unit") == 1, (
        "the gauge is inverted in more than one place in stack_transform.js"
    )
