# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""σ — the sixth degree of freedom of a map's placement.

A placement is written down as `origin_x_m, origin_y_m, scale_x_m, scale_y_m,
rotation_rad`. Five numbers can only describe a placement whose two axes are
SQUARE to each other, and the renderer draws placements whose axes are not:

  * a Point Align full transform, which solves a raw 2x2 and can shear;
  * a MIRRORED placement, which five fields cannot express at all;
  * any ROTATED placement on an anchor whose two axis scales disagree — the
    world→metre map is then not conformal, so perpendicular world axes come
    out non-perpendicular in metres with no Point Align anywhere near it.

All three were recorded as the nearest square placement. `shear_rad` closes
that: σ is the y axis's lean away from perpendicular, wrapped to (-π, π],

    metres = origin + R(ρ) · [[Sx, -Sy·sin σ], [0, Sy·cos σ]] · frac

which is a QR decomposition with a positive leading diagonal — complete over
the invertible 2x2, so the record now holds every affine the renderer can
draw, exactly rather than approximately. σ = 0 is the five-field arithmetic
unchanged and σ = ±π is a mirror, so neither compatibility nor reflection
needs a flag.

The field was ALREADY REACHING DISK before this: the photo-divorce migration
copies the whole of `legacy_stack_metre_transform`'s output into the record, and
nothing read it. It was written through an `abs()`, so +5° and -5° of lean
both stored +0.087266 — which is why the backfill class at the bottom exists.
"""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import seed_world_gauge, migration_backup, maps_store_with


_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

_ANCHOR = {"m_per_unit": 20.0}
_FRACS = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.5, 0.5), (0.137, 0.911)]


def _store(transforms: dict) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.store.async_save = AsyncMock()
    s.data = {"map_transforms": transforms}
    s.fabric = None
    return s


def _affine_map(a: float, b: float, c: float, d: float, mid: str = "m") -> dict:
    """A 1600x1200 map placed by a raw solved affine — the Point Align case."""
    return {"id": mid, "floor_id": "main", "image": {"width": 1600, "height": 1200},
            "stack": {"_m": [a, b, c, d], "_m_ar": 0.75, "ref_ar": 0.75,
                      "x_offset": 0.13, "y_offset": -0.07, "is_master": True}}


def _drawn(m: dict, fx: float, fy: float, anchor: dict = _ANCHOR) -> tuple[float, float]:
    """Where `stack_world_xform` — the shipping renderer — ACTUALLY puts this
    fraction of this map, in metres."""
    k = fabric_truth._gauge_scale(anchor)
    wx, wy = fabric_truth.legacy_stack_world_xform(m["stack"], fabric_truth.image_ar(m))(fx, fy)
    return (wx * k, wy * k)


def _worst_error_m(m: dict, t: dict) -> float:
    s = _store({"m": t})
    return max(math.hypot(*(g - e for g, e in zip(s.map_frac_to_metres(fx, fy, "m"),
                                                  _drawn(m, fx, fy))))
               for fx, fy in _FRACS)


# ── σ = 0 is not a new code path, it is the old one ──────────────────────────

def _todays_frac_to_metres(t: dict, x_frac: float, y_frac: float):
    """`map_frac_to_metres` verbatim as it stood before σ existed.

    Kept in the ORIGINAL statement order, not folded into one expression:
    `ox + (dx·c - dy·s)` and `(ox + dx·c) - dy·s` differ in the last place,
    and the first transcription of this helper did exactly that and reported
    the production code as changed when it was the helper that had.
    """
    ox, oy = float(t.get("origin_x_m", 0)), float(t.get("origin_y_m", 0))
    sx, sy = float(t.get("scale_x_m", 1)), float(t.get("scale_y_m", 1))
    rot = float(t.get("rotation_rad", 0))
    dx = x_frac * sx
    dy = y_frac * sy
    if abs(rot) > 1e-9:
        cos_r = math.cos(rot)
        sin_r = math.sin(rot)
        rx = dx * cos_r - dy * sin_r
        ry = dx * sin_r + dy * cos_r
    else:
        rx, ry = dx, dy
    return (ox + rx, oy + ry)


def _todays_metres_to_frac(t: dict, x_m: float, y_m: float):
    """`metres_to_map_frac` verbatim as it stood before σ existed."""
    ox, oy = float(t.get("origin_x_m", 0)), float(t.get("origin_y_m", 0))
    sx, sy = float(t.get("scale_x_m", 1)), float(t.get("scale_y_m", 1))
    rot = float(t.get("rotation_rad", 0))
    rx, ry = x_m - ox, y_m - oy
    if abs(rot) > 1e-9:
        cos_r, sin_r = math.cos(-rot), math.sin(-rot)
        dx, dy = rx * cos_r - ry * sin_r, rx * sin_r + ry * cos_r
    else:
        dx, dy = rx, ry
    return (dx / sx, dy / sy)


_PLACEMENTS = [
    {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 80.0, "scale_y_m": 60.0, "rotation_rad": 0.0},
    {"origin_x_m": 13.5, "origin_y_m": -7.25, "scale_x_m": 40.0, "scale_y_m": 24.0,
     "rotation_rad": math.radians(7)},
    {"origin_x_m": -3.0, "origin_y_m": 41.0, "scale_x_m": 12.0, "scale_y_m": 55.0,
     "rotation_rad": math.radians(30)},
    {"origin_x_m": 2.0, "origin_y_m": 2.0, "scale_x_m": 18.3472, "scale_y_m": 9.7813,
     "rotation_rad": math.radians(90)},
    {"origin_x_m": -11.0, "origin_y_m": 6.5, "scale_x_m": 33.0, "scale_y_m": 21.0,
     "rotation_rad": math.radians(180)},
    {"origin_x_m": 7.0, "origin_y_m": -2.0, "scale_x_m": 9.0, "scale_y_m": 9.0,
     "rotation_rad": math.radians(-135)},
]


@pytest.mark.parametrize("t", _PLACEMENTS)
@pytest.mark.parametrize("explicit_zero", [False, True],
                         ids=["shear_rad absent", "shear_rad = 0.0"])
def test_sigma_zero_is_todays_arithmetic_bit_for_bit(t, explicit_zero) -> None:
    """Not "close to" — the SAME IEEE-754 doubles.

    Every placement on disk today reads σ = 0, so this is the whole installed
    base. `rot + 0.0` is `rot` exactly, so the sheared form collapses to the
    same multiplications in the same order rather than to an equal-looking
    rearrangement of them. Compared on the raw bit patterns; a rounding
    difference in the last place would be a real change to every stored
    position and would not show up in an approx() comparison.
    """
    rec = {**t, "shear_rad": 0.0} if explicit_zero else dict(t)
    s = _store({"m": rec})
    for fx, fy in _FRACS:
        got = s.map_frac_to_metres(fx, fy, "m")
        want = _todays_frac_to_metres(rec, fx, fy)
        assert struct.pack(">2d", *got) == struct.pack(">2d", *want), (fx, fy)
        back = s.metres_to_map_frac(*want, "m")
        want_back = _todays_metres_to_frac(rec, *want)
        assert struct.pack(">2d", *back) == struct.pack(">2d", *want_back), (fx, fy)


# ── the six fields reproduce what the renderer draws ─────────────────────────

# `_m` columns are world-space, and stack_world_xform stretches every y term
# by `_m_ar` — so a matrix that looks like a 5° shear on paper is not one on
# the floor. These are built backwards from the metre columns they have to
# produce under `_ANCHOR` (isotropic) and `_m_ar` 0.75:
#     col_x_m ∝ (1, 0)                 -> ρ = 0
#     col_y_m ∝ (-sin σ, cos σ)        -> the y axis leaning σ off square
_S5, _C5 = math.sin(math.radians(5.0)), math.cos(math.radians(5.0))
_AFFINES = {
    "5 deg lean": (1.0, -_S5, 0.0, _C5 / 0.75),
    "minus 5 deg lean": (1.0, _S5, 0.0, _C5 / 0.75),
    "mirror": (1.0, 0.0, 0.0, -1.0),
    "mirror at 25 deg": (math.cos(math.radians(25)), math.sin(math.radians(25)),
                         math.sin(math.radians(25)), -math.cos(math.radians(25))),
    "general affine": (1.21, -0.44, 0.37, 0.93),
    "squashed and skewed": (0.62, 0.51, -0.18, 1.34),
}


@pytest.mark.parametrize("name", sorted(_AFFINES))
def test_the_six_field_record_reproduces_what_the_renderer_draws(name) -> None:
    """The record and the picture agree, for every affine the solver can write.

    Measured through the REAL `stack_world_xform`, which is the function that
    puts the photo on the screen — not a re-derivation of it. The residual is
    the store's own 4-decimal-place rounding of the record (0.1 mm per field),
    nothing else.
    """
    m = _affine_map(*_AFFINES[name])
    t = fabric_truth.legacy_stack_metre_transform(m, _ANCHOR)
    assert t is not None
    assert _worst_error_m(m, t) < 1e-3


@pytest.mark.parametrize("name", sorted(_AFFINES))
def test_deleting_shear_from_the_record_moves_the_map_metres(name) -> None:
    """The control. Without this the test above could pass on a fixture that
    was never sheared in the first place.

    Deleting σ from the record is exactly what shipped before Release 1 — the
    QR decomposition was computed in full and five of its six fields stored.
    On a 20 m map that is between 1.7 m and 55 m of silent displacement.
    """
    m = _affine_map(*_AFFINES[name])
    t = fabric_truth.legacy_stack_metre_transform(m, _ANCHOR)
    five = {k: v for k, v in t.items() if k != "shear_rad"}
    assert _worst_error_m(m, five) > 1.0


def test_the_sign_survives() -> None:
    """`abs()` at the point of measurement made the record unable to say WHICH
    WAY a map was skewed: +5° and -5° both recorded +0.087266."""
    plus = fabric_truth.legacy_stack_metre_transform(_affine_map(*_AFFINES["5 deg lean"]), _ANCHOR)
    minus = fabric_truth.legacy_stack_metre_transform(_affine_map(*_AFFINES["minus 5 deg lean"]), _ANCHOR)
    assert plus["shear_rad"] == pytest.approx(-minus["shear_rad"], abs=1e-9)
    assert plus["shear_rad"] != pytest.approx(0.0, abs=1e-6)
    assert abs(plus["shear_rad"]) == pytest.approx(math.radians(5.0), abs=1e-6)


def test_a_mirror_is_sigma_pi_and_not_a_flag() -> None:
    """Reflection is a value of σ, so nothing needs a separate `mirrored` bit.

    A negative-determinant placement puts the y axis on the far side of the x
    one, which is a lean of half a turn. Five fields had no way to say that at
    all: |σ| had to be ≤ π/2 for the axes to be a right-handed pair.
    """
    t = fabric_truth.legacy_stack_metre_transform(_affine_map(*_AFFINES["mirror"]), _ANCHOR)
    assert abs(abs(t["shear_rad"]) - math.pi) < 1e-6


@pytest.mark.parametrize("rot_deg", [0.0, 15.0, 45.0, 90.0, 217.0])
def test_the_gauge_cannot_manufacture_shear_at_any_rotation(rot_deg) -> None:
    """A lean the world frame invented, made impossible rather than tolerated.

    This test used to assert the invention. A degraded anchor's two axis
    scales made the world→metre map non-conformal, so a plain decomposed
    stack — no Point Align anywhere near it — arrived with non-perpendicular
    axes in metres, and the lean it produced was the anchor's own iso_error.
    That is why the rebuild's shear bar was written as `ANCHOR_ISO_TOL`: they
    were one number seen from two ends.

    The gauge is one scalar now, so the world→metre map is a similarity and
    a right angle stays a right angle. σ = 0 EXACTLY, at every rotation.
    Every σ that reaches a record from here is a lean the renderer draws.

    RECORD_ISO_TOL is the surviving name, for the half of the old
    reason that survives: both are the point at which a map's own geometry
    stops being self-consistent.
    """
    anchor = {"m_per_unit": 20.0}
    m = {"id": "m", "floor_id": "main", "image": {"width": 1600, "height": 1200},
         "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
                   "rotation": rot_deg, "x_offset": 0.0, "y_offset": 0.0}}
    sigma = fabric_truth.legacy_stack_metre_transform(m, anchor)["shear_rad"]
    assert sigma == 0.0, f"the frame invented {sigma} rad of lean at {rot_deg}°"


@pytest.mark.parametrize("name", sorted(_AFFINES))
def test_frac_and_metres_round_trip_through_a_sheared_placement(name) -> None:
    """`metres_to_map_frac` is the inverse of `map_frac_to_metres`, σ included.

    The inverse is not "rotate back and divide": the matrix has determinant
    Sx·Sy·cos σ and a non-orthogonal y column, so a transpose is not an
    inverse once σ ≠ 0. Pins are placed through one direction and drawn
    through the other, so a mismatch walks a scanner across the floor a little
    further every time somebody saves.
    """
    m = _affine_map(*_AFFINES[name])
    s = _store({"m": fabric_truth.legacy_stack_metre_transform(m, _ANCHOR)})
    for fx, fy in _FRACS:
        xm, ym = s.map_frac_to_metres(fx, fy, "m")
        bx, by = s.metres_to_map_frac(xm, ym, "m")
        assert (bx, by) == pytest.approx((fx, fy), abs=1e-9)


def test_a_quarter_turn_lean_is_singular_not_a_placement() -> None:
    """σ = ±90° puts both axes on one line: the placement covers no area and
    the matrix has determinant zero. Refused with a zero scale, because it is
    the same failure — not clamped to something nearby, which would invent a
    map that is not there."""
    t = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0, "scale_y_m": 10.0,
         "rotation_rad": 0.0, "shear_rad": math.pi / 2}
    assert _store({"m": t}).metres_to_map_frac(1.0, 1.0, "m") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["not a number", float("nan"), float("inf"), None])
async def test_the_store_refuses_to_hold_a_shear_that_is_not_a_number(bad) -> None:
    """σ is sanitised with the pose, not beside it: a NaN in it poisons every
    later conversion exactly the way a NaN rotation does."""
    s = _store({})
    await s.async_set_map_transform("m", {
        "origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0, "scale_y_m": 10.0,
        "rotation_rad": 0.0, "shear_rad": bad,
    })
    assert s.data["map_transforms"]["m"]["shear_rad"] == 0.0


@pytest.mark.asyncio
async def test_shear_is_shape_so_a_re_measure_may_restate_it() -> None:
    """The write-once rule covers the world POSE — origin and rotation. σ says
    how the map's own two axes sit relative to each other, which is what a
    re-measure is entitled to change, so it follows the scales."""
    s = _store({})
    base = {"origin_x_m": 4.0, "origin_y_m": 5.0, "scale_x_m": 10.0,
            "scale_y_m": 10.0, "rotation_rad": 0.3, "shear_rad": 0.0}
    await s.async_set_map_transform("m", base)
    await s.async_set_map_transform("m", {**base, "origin_x_m": 99.0,
                                          "rotation_rad": 1.2, "shear_rad": -0.09})
    t = s.data["map_transforms"]["m"]
    assert t["origin_x_m"] == 4.0 and t["rotation_rad"] == 0.3, "the pose is write-once"
    assert t["shear_rad"] == pytest.approx(-0.09), "the shape is not"


# ── the JS twins ─────────────────────────────────────────────────────────────

@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_js_twins_agree_with_python_to_the_micron(tmp_path) -> None:
    """`stack_transform.js` and `traceback.js` convert the same placements the
    backend does. They are separate copies of the same arithmetic — the panel
    draws through them without asking the backend — so a σ the frontend
    ignores is a map drawn in one place and a pin drawn in another.
    """
    src = (_VIEWS / "stack_transform.js").read_text(encoding="utf-8")
    (tmp_path / "stack_transform.mjs").write_text(src, encoding="utf-8")

    # traceback.js is a view module, not importable on its own; lift its
    # _toMetres by text so the check is of the SHIPPING line, not a copy.
    tb = (_VIEWS / "traceback.js").read_text(encoding="utf-8")
    i = tb.index("const _toMetres = (x, y, mid) => {")
    body = tb[i:tb.index("};", i) + 2].replace(
        "const t = transforms[mid]; if (!t) return null;", "const t = TF;")

    cases = []
    for name, mat in sorted(_AFFINES.items()):
        m = _affine_map(*mat)
        t = fabric_truth.legacy_stack_metre_transform(m, _ANCHOR)
        s = _store({"m": t})
        for fx, fy in _FRACS:
            cases.append({"t": t, "f": [fx, fy],
                          "m": list(s.map_frac_to_metres(fx, fy, "m"))})

    (tmp_path / "run.mjs").write_text(
        "import * as S from './stack_transform.mjs';\n"
        f"const CASES = {json.dumps(cases)};\n"
        "let worstF = 0, worstI = 0, worstT = 0;\n"
        "for (const c of CASES) {\n"
        "  const got = S.mapFracToMetres(c.t, c.f[0], c.f[1]);\n"
        "  worstF = Math.max(worstF, Math.hypot(got[0]-c.m[0], got[1]-c.m[1]));\n"
        "  const back = S.metresToMapFrac(c.t, c.m[0], c.m[1]);\n"
        "  worstI = Math.max(worstI, Math.hypot(back[0]-c.f[0], back[1]-c.f[1]));\n"
        "  const TF = c.t;\n"
        f"  {body}\n"
        "  const tb = _toMetres(c.f[0], c.f[1], null);\n"
        "  worstT = Math.max(worstT, Math.hypot(tb[0]-c.m[0], tb[1]-c.m[1]));\n"
        "}\n"
        "console.log(JSON.stringify({worstF, worstI, worstT, n: CASES.length}));\n",
        encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    out = json.loads(res.stdout.strip().splitlines()[-1])
    assert out["n"] == len(cases)
    assert out["worstF"] < 1e-9, f"stack_transform.js mapFracToMetres: {out}"
    assert out["worstI"] < 1e-9, f"stack_transform.js metresToMapFrac: {out}"
    assert out["worstT"] < 1e-9, f"traceback.js _toMetres: {out}"


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_js_twin_refuses_the_placements_python_refuses(tmp_path) -> None:
    """Agreeing about the arithmetic is not agreeing about the SINGULARITY.

    The matrix has determinant Sx·Sy·cos σ, so σ = ±90° puts both axes on one
    line and the placement covers no area — as singular as a zero scale, and
    refused with it. The test above only compares placements that HAVE an
    inverse, so `metresToMapFrac` losing its `cos σ` guard is invisible to it:
    the panel then divides by ~6e-17 and lays pins out at coordinates of order
    1e16 while the backend correctly answers "no such fraction".
    """
    src = (_VIEWS / "stack_transform.js").read_text(encoding="utf-8")
    (tmp_path / "stack_transform.mjs").write_text(src, encoding="utf-8")

    base = {"origin_x_m": 2.0, "origin_y_m": -3.0, "scale_x_m": 10.0,
            "scale_y_m": 10.0, "rotation_rad": 0.3}
    cases = {
        "quarter turn lean": {**base, "shear_rad": math.pi / 2},
        "quarter turn lean, other way": {**base, "shear_rad": -math.pi / 2},
        "three quarter turn lean": {**base, "shear_rad": 3 * math.pi / 2},
        "zero x scale": {**base, "scale_x_m": 0.0, "shear_rad": 0.2},
        "zero y scale": {**base, "scale_y_m": 0.0, "shear_rad": 0.2},
        # …and one that is NOT singular, so "return null always" fails too.
        "a lean just short of it": {**base, "shear_rad": math.radians(89.0)},
    }
    want = {name: _store({"m": t}).metres_to_map_frac(4.0, 4.0, "m") is None
            for name, t in cases.items()}
    assert sum(want.values()) == len(cases) - 1, "the fixture list is not what it claims"

    (tmp_path / "run.mjs").write_text(
        "import * as S from './stack_transform.mjs';\n"
        f"const CASES = {json.dumps(cases)};\n"
        "const out = {};\n"
        "for (const [k, t] of Object.entries(CASES)) {\n"
        "  const r = S.metresToMapFrac(t, 4.0, 4.0);\n"
        "  out[k] = r === null ? null : r;\n"
        "}\n"
        "console.log(JSON.stringify(out));\n",
        encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    got = json.loads(res.stdout.strip().splitlines()[-1])

    for name in cases:
        assert (got[name] is None) == want[name], (
            f"{name}: python says {'no fraction' if want[name] else 'a fraction'}, "
            f"stack_transform.js says {got[name]}"
        )


# ── the two repair paths carry it instead of refusing it ─────────────────────

# ── the backfill ─────────────────────────────────────────────────────────────

class TestTheShearSignBackfill:
    """`shear_rad` reached disk unsigned. This recovers the sign, once.

    Only from the solved affine `_m`, because that is the only thing that
    still holds it. A map whose matrix has since been nulled — any click on
    ±15°, Scale ±, X-stretch or Reset does that — has no sign to recover, and
    a decomposed stack's apparent lean is the anchor's anisotropy rather than
    the map's placement, so writing it would bake a degraded anchor's error
    into the record permanently.
    """

    @staticmethod
    def _scene(stack_overrides: dict | None = None, stored: dict | None = None):
        master = {"id": "master", "floor_id": "main", "name": "Ground",
                  "image": {"width": 1600, "height": 1200},
                  "stack": {"is_master": True, "scale": 1.0, "scale_x_adj": 1.0,
                            "ref_ar": 0.75, "rotation": 0, "x_offset": 0, "y_offset": 0}}
        skew = _affine_map(*_AFFINES["minus 5 deg lean"], mid="skew")
        skew["name"] = "Skewed"
        skew["stack"]["is_master"] = False
        skew["stack"].update(stack_overrides or {})
        transforms = {
            "master": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                       "scale_y_m": 15.0, "rotation_rad": 0.0, "floor_id": "main",
                       "reference_measurements": [{"m": 1}]},
            "skew": {"origin_x_m": 1.0, "origin_y_m": 2.0, "scale_x_m": 5.0,
                     "scale_y_m": 5.0, "rotation_rad": 0.0, "floor_id": "main",
                     **(stored or {})},
        }
        return [master, skew], transforms

    @pytest.mark.asyncio
    async def test_it_recovers_the_sign_from_the_matrix(self) -> None:
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene()
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out["shear_signed"] == 1
        sigma = mdl.data["map_transforms"]["skew"]["shear_rad"]
        assert sigma < 0, "the matrix leans the other way; the sign is the point"
        assert abs(sigma) == pytest.approx(math.radians(5.0), abs=1e-4)

    @pytest.mark.asyncio
    async def test_it_completes_the_unsigned_value_already_on_disk(self) -> None:
        """The state a real install is in: `dict(stack_t)` put the magnitude on
        disk through an `abs()`, and nothing has ever read it. A stored value
        whose magnitude matches the matrix while its sign does not is provably
        that `abs()` — no other producer of the field has existed."""
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene(stored={"shear_rad": round(math.radians(5.0), 6)})
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out["shear_signed"] == 1
        assert mdl.data["map_transforms"]["skew"]["shear_rad"] < 0

    @pytest.mark.asyncio
    async def test_a_small_wrong_signed_lean_is_repaired_not_waved_through(self) -> None:
        """1e-6 is "are these the same number", not "are these close enough".

        The stored value is compared against the matrix's twice: once to ask
        whether it is already right, and once to ask whether it is this
        codebase's own `abs()` output. Both are IDENTITY questions — no other
        producer of the field has ever existed — so the tolerance is a float
        epsilon and not a physical one, and it has no business tracking any
        of the angular tolerances elsewhere in this file.

        Loosened to 1e-1 it reads a small lean recorded the wrong way round as
        "already signed and already right" and leaves it: up to 0.1 rad of
        wrong-signed lean, which is the metres measured at the bottom.
        """
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene()
        # 2.5°, which is small enough that the stored +σ and the matrix's −σ
        # are 0.087 rad apart — inside a 1e-1 tolerance, and nowhere near 1e-6.
        _s, _c = math.sin(math.radians(2.5)), math.cos(math.radians(2.5))
        maps[1]["stack"]["_m"] = [1.0, _s, 0.0, _c / 0.75]
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        sigma = fabric_truth.legacy_stack_metre_transform(maps[1], anchor)["shear_rad"]
        transforms["skew"]["shear_rad"] = round(abs(sigma), 6)
        assert sigma < 0 and 2 * abs(sigma) < 1e-1, (
            "the fixture no longer sits inside the tolerance it is guarding"
        )

        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out["shear_signed"] == 1, "a wrong-signed lean was waved through"
        assert mdl.data["map_transforms"]["skew"]["shear_rad"] < 0

        # …and the control: a lean this size recorded the wrong way round is
        # worth over a metre on a 15 m axis.
        right = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                 "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": sigma}
        moved = math.hypot(*(a - b for a, b in zip(
            _store({"m": right}).map_frac_to_metres(1.0, 1.0, "m"),
            _store({"m": {**right, "shear_rad": -sigma}}).map_frac_to_metres(1.0, 1.0, "m"))))
        assert moved > 1.0, f"the unrepaired sign is only worth {moved:.4f} m"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("deg,metres", [(5.0, 4.1036), (20.0, 11.6554),
                                           (30.0, 16.2785)])
    async def test_the_second_tolerance_is_an_identity_check_too(self, deg, metres) -> None:
        """The OTHER 1e-6, and it asks the same identity question.

        `abs(stored - abs(sigma)) > 1e-6` is "is this number our own `abs()`
        output" — the only thing that makes completing it a repair rather than
        an overwrite. Loosened to 1e-1 it says yes to a number this codebase
        never wrote, and replaces it with the matrix's SIGNED lean: a stored
        value sitting just inside the band is flipped to the other side of
        square, so the write is worth about twice the lean plus the tolerance,
        and it is a migration — it runs once, unattended, with the old value
        gone.

        `test_a_small_wrong_signed_lean_is_repaired_not_waved_through` above
        guards the first 1e-6, which fails the other way (a repair skipped).
        This one fails as damage.
        """
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene()
        _s, _c = math.sin(math.radians(deg)), math.cos(math.radians(deg))
        maps[1]["stack"]["_m"] = [1.0, _s, 0.0, _c / 0.75]      # leans -deg
        # A 20 m x 15 m record, so the control below reads in house metres.
        transforms["skew"]["scale_x_m"] = 20.0
        transforms["skew"]["scale_y_m"] = 15.0
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        sigma = fabric_truth.legacy_stack_metre_transform(maps[1], anchor)["shear_rad"]
        assert sigma < 0, "the fixture no longer leans the other way"

        # A number no producer in this codebase has ever written: 1e-1 of a
        # radian away from the matrix's magnitude, which is five orders of
        # magnitude outside the identity tolerance that decides.
        stored = round(abs(sigma) + 0.0999, 6)
        mdl.data["map_transforms"]["skew"]["shear_rad"] = stored

        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out["shear_signed"] == 0, (
            "a stored lean the migration cannot account for was overwritten"
        )
        assert mdl.data["map_transforms"]["skew"]["shear_rad"] == stored

        # …and the control: what that overwrite is worth on this map.
        base = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                "scale_y_m": 15.0, "rotation_rad": 0.0}
        moved = fabric_truth.placement_disagreement_m(
            {**base, "shear_rad": stored}, {**base, "shear_rad": sigma})
        assert moved == pytest.approx(metres, abs=1e-2), f"{moved:.4f} m"

    @pytest.mark.asyncio
    async def test_it_leaves_a_number_it_cannot_account_for_alone(self) -> None:
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene(stored={"shear_rad": 0.4})
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out["shear_signed"] == 0
        assert mdl.data["map_transforms"]["skew"]["shear_rad"] == 0.4

    @pytest.mark.asyncio
    async def test_a_map_whose_matrix_was_nulled_is_counted_not_guessed_at(self) -> None:
        """Reset, ±15°, Scale ± and X-stretch all write `_m: null`, and the map
        keeps no record that it ever had one. A map that HAS a recorded lean
        and no matrix left to sign it is the honest loss in this backfill: it
        is reported, and its unsigned number is left exactly as it was rather
        than guessed at from a decomposed stack that has no lean of its own.
        """
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene(
            stack_overrides={"_m": None, "_m_ar": None, "scale": 1.0,
                             "scale_x_adj": 1.0, "rotation": 20.0},
            stored={"shear_rad": 0.087266})
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out == {"shear_signed": 0, "shear_no_matrix": 1, "shear_over_tol": 0}
        assert mdl.data["map_transforms"]["skew"]["shear_rad"] == 0.087266

    @pytest.mark.asyncio
    async def test_an_ordinary_unsheared_map_is_not_reported_as_damage(self) -> None:
        """No matrix AND no recorded lean is not a loss — it is a map that was
        never sheared. Counting those would report every plain floor plan in
        the house as something the backfill could not do."""
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene(
            stack_overrides={"_m": None, "_m_ar": None, "scale": 1.0,
                             "scale_x_adj": 1.0, "rotation": 0.0})
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out == {"shear_signed": 0, "shear_no_matrix": 0, "shear_over_tol": 0}
        assert "shear_rad" not in mdl.data["map_transforms"]["skew"]

    @pytest.mark.asyncio
    async def test_it_counts_the_placements_beyond_the_tolerance(self) -> None:
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._scene()
        mdl = _store(transforms)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out["shear_over_tol"] == 1, (
            "5 degrees is 0.087 rad, four times RECORD_ISO_TOL — the owner is "
            "entitled to know how many of their maps are that far off square"
        )

    @staticmethod
    def _fab(marker: list[str] | None = None):
        from custom_components.padspan_ha.fabric_store import FabricStore
        from custom_components.padspan_ha.migrations import MARKER

        fab = FabricStore.__new__(FabricStore)
        fab.hass = MagicMock()
        fab.store = AsyncMock()
        fab.data = {"floors": {}, "history": [], "scanner_positions_m": {},
                    "beacon_positions_m": {}, "rf_barriers_m": []}
        if marker is not None:
            fab.data[MARKER] = marker
        return fab

    @pytest.mark.asyncio
    async def test_the_migration_actually_runs_it(self) -> None:
        """WIRED, not merely callable.

        Every other test in this class calls `_backfill_shear_sign` directly,
        so unhooking step 9 from `async_run_photo_divorce` left all seven of
        them green — and the marker was set from the list of OUTSTANDING steps
        rather than the ones that ran, so a box that skipped the backfill was
        told it had done it. A marker is one-way: every unsigned σ on that
        disk would stay unsigned forever.

        The install here is the one the backfill was written for. It upgraded
        through an earlier release, so PHOTO_DIVORCE is already marked and
        step 1 is not along to rewrite the whole record — the sign has to come
        from step 9 or from nowhere.

        Confirmed as cover by mutation: deleting the `if anchor and SHEAR_SIGN
        in todo:` block from `async_run_photo_divorce` fails this with
        `assert 0 == 1`. And `done |= ran` reverted to `done |= todo` fails
        `test_without_an_anchor_the_step_stays_on_the_todo_list` and
        `test_a_step_whose_store_is_missing_is_not_marked_done` — the marker
        can no longer be set for a step that did not run.
        """
        from custom_components.padspan_ha.migrations import (
            MARKER, PHOTO_DIVORCE, SHEAR_SIGN, async_run_photo_divorce,
        )

        maps, transforms = self._scene(stored={"shear_rad": round(math.radians(5.0), 6)})
        mdl = _store(transforms)
        ms = maps_store_with(maps)
        fab = self._fab([PHOTO_DIVORCE])
        assert mdl.data["map_transforms"]["skew"]["shear_rad"] > 0, "fixture is signed already"

        stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, migration_backup)

        assert stats["shear_signed"] == 1
        assert mdl.data["map_transforms"]["skew"]["shear_rad"] < 0, (
            "the migration did not run the backfill — the matrix leans the "
            "other way and the record still says it leans this way"
        )
        assert SHEAR_SIGN in fab.data[MARKER]

    @pytest.mark.asyncio
    async def test_without_an_anchor_the_step_stays_on_the_todo_list(self) -> None:
        """A step that could not run has not run. There is no world frame to
        measure a lean against until a map is measured, and installs measure
        their first map some time after they install the release."""
        from custom_components.padspan_ha.fabric_store import FabricStore
        from custom_components.padspan_ha.migrations import (
            MARKER, SHEAR_SIGN, async_run_photo_divorce,
        )

        fab = FabricStore.__new__(FabricStore)
        fab.hass = MagicMock()
        fab.store = AsyncMock()
        fab.data = {"floors": {}, "history": [], "scanner_positions_m": {},
                    "beacon_positions_m": {}, "rf_barriers_m": []}
        ms = maps_store_with([])        # nothing measured — no anchor
        await async_run_photo_divorce(MagicMock(), _store({}), ms, fab, None, migration_backup)
        assert SHEAR_SIGN not in fab.data[MARKER]
        assert MARKER in fab.data and fab.data[MARKER], "the other steps still ran"


# ── the model itself, with the store's rounding taken out of the way ─────────

@pytest.mark.parametrize("name", sorted(_AFFINES))
def test_the_unrounded_six_field_model_is_the_renderer_exactly(name) -> None:
    """Not "within a millimetre" — exact, to the limit of double precision.

    `test_the_six_field_record_reproduces_what_the_renderer_draws` above is
    measured through a STORED record, so its threshold is 1e-3 m and cannot be
    tightened: `legacy_stack_metre_transform` rounds to 0.1 mm and 1 µrad, and on a
    20 m map that rounding alone displaces the far corner by ~1e-4 m. That
    floor makes the placement tolerance blind to a σ error below ~5e-5 rad —
    1e-6, 1e-5 and 1e-4 relative all pass it, and only 1e-3 is caught.

    So the residual is measured once with the rounding removed. What is left
    is the model, and the model is not an approximation: six fields are a QR
    decomposition with a positive leading diagonal, which is complete over the
    invertible 2x2. Anything above 1e-12 m here is a wrong formula, not a
    wrong decimal place.
    """
    m = _affine_map(*_AFFINES[name])
    fit = fabric_truth._legacy_stack_metre_fit(m, _ANCHOR)
    assert fit is not None
    assert _worst_error_m(m, fit) < 1e-12, "the six-field model is not the renderer"


def test_the_rounding_is_the_whole_of_the_stored_records_residual() -> None:
    """The control for the test above: the 1e-3 m threshold elsewhere is the
    store's decimal places and nothing else, so tightening it would fail on
    arithmetic that is correct."""
    m = _affine_map(*_AFFINES["general affine"])
    rounded = _worst_error_m(m, fabric_truth.legacy_stack_metre_transform(m, _ANCHOR))
    unrounded = _worst_error_m(m, fabric_truth._legacy_stack_metre_fit(m, _ANCHOR))
    assert unrounded < 1e-12 < 1e-5 < rounded < 1e-3


# ── a crop keeps the picture it kept ─────────────────────────────────────────

def _sheared_map_and_record(sigma_deg: float = 5.0):
    """A 20 m x 15 m map leaning σ, and the map dict a crop is handed."""
    t = {"origin_x_m": 3.0, "origin_y_m": -1.0, "scale_x_m": 20.0, "scale_y_m": 15.0,
         "rotation_rad": 0.25, "shear_rad": math.radians(sigma_deg), "floor_id": "main",
         "origin_anchored": True,
         "reference_measurements": [{"p1": [0.1, 0.5], "p2": [0.6, 0.5],
                                     "distance_m": 10.0, "px_per_meter": 80.0}]}
    m = {"id": "m", "floor_id": "main", "name": "Ground",
         "image": {"width": 1600, "height": 1200},
         "stack": {"is_master": True, "scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
                   "rotation": 0.0, "x_offset": 0.0, "y_offset": 0.0},
         "calibration": {"mode": "manual", "px_per_meter": 80.0, "reference_points": []},
         "receivers": [], "beacons": []}
    return m, t


@pytest.mark.asyncio
@pytest.mark.parametrize("crop", [
    {"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 1.0},
    {"fx0": 0.18, "fy0": 0.31, "fx1": 0.77, "fy1": 0.94},
], ids=["left half", "inset window"])
async def test_a_crop_leaves_the_retained_picture_exactly_where_it_was(crop) -> None:
    """THE invariant of a crop: trimming the margins off a photo does not move
    the house. Every point still in the picture is still in the same place.

    Both halves of the placement have to survive it and neither is free. σ is
    SHAPE — the crop rescales the two fraction axes without turning either, so
    the angle between them is untouched — and dropping it squares the map up
    by the whole lean: on this 20 m map the far corner of a left-half crop
    moves 1.31 m. The ORIGIN is where old frac (fx0, fy0) already is, which is
    the six-field model and not `origin + R(ρ)·(frac ⊙ scale)`; the five-field
    version loses the -Sy·sin σ term and slides the retained window sideways.

    Confirmed as cover by mutation: stopping `_put_map_transform` carrying
    the fields a new record does not state — which is what leaves a crop's
    five-field literal free to drop σ — fails both cases here and the σ half
    of the control below. Before this test it was invisible: the single-writer
    suite drives the same crop with a sheared fixture and only asks whether
    anything changed.
    """
    m, t = _sheared_map_and_record()
    s = _store({"m": t})
    fw = crop["fx1"] - crop["fx0"]
    fh = crop["fy1"] - crop["fy0"]
    before = {f: s.map_frac_to_metres(crop["fx0"] + f[0] * fw,
                                      crop["fy0"] + f[1] * fh, "m") for f in _FRACS}

    ok = await s.async_recompute_transform_for_map("m", m, None, crop=crop)
    assert ok, "the fixture no longer exercises the crop path"

    after = s.data["map_transforms"]["m"]
    assert "shear_rad" in after, (
        "the crop dropped σ: the map has been squared up by the whole lean, "
        "silently, which is the class of bug the record grew a sixth field to "
        "stop"
    )
    worst = max(math.hypot(*(g - e for g, e in zip(s.map_frac_to_metres(*f, "m"), before[f])))
                for f in _FRACS)
    # 0.1 mm: the crop rounds the record it writes to the store's decimal
    # places, which over a 20 m span is ~1e-4 m. The failure this guards is
    # 1.31 m — see the control below.
    assert worst < 1e-3, f"the crop moved the picture it kept by {worst:.4f} m"


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["shear_rad", "origin"])
async def test_the_crop_control_both_halves_are_load_bearing(field) -> None:
    """The test above has to be failing for the right reason.

    Each half of the crop's placement is knocked out in turn and the picture
    is measured again: σ dropped, and the origin rebuilt the five-field way it
    used to be. On this window σ is worth 0.82 m (1.31 m if the crop keeps the
    map's full height) and the naive origin 0.41 m, against the 1e-3 m the
    test above allows. Neither is passing because the fixture is square.
    """
    m, t = _sheared_map_and_record()
    crop = {"fx0": 0.18, "fy0": 0.31, "fx1": 0.77, "fy1": 0.94}
    s = _store({"m": t})
    before = s.map_frac_to_metres(crop["fx0"], crop["fy0"], "m")
    await s.async_recompute_transform_for_map("m", m, None, crop=crop)
    good = dict(s.data["map_transforms"]["m"])

    if field == "shear_rad":
        broken = {k: v for k, v in good.items() if k != "shear_rad"}
        moved = math.hypot(*(g - e for g, e in zip(
            _store({"m": broken}).map_frac_to_metres(1.0, 1.0, "m"),
            _store({"m": good}).map_frac_to_metres(1.0, 1.0, "m"))))
    else:
        # origin = old_origin + R(ρ)·(frac ⊙ scale) — the five-field offset.
        _dx, _dy = crop["fx0"] * 20.0, crop["fy0"] * 15.0
        _c, _sn = math.cos(0.25), math.sin(0.25)
        naive = (3.0 + _dx * _c - _dy * _sn, -1.0 + _dx * _sn + _dy * _c)
        moved = math.hypot(naive[0] - before[0], naive[1] - before[1])
    assert moved > 0.4, f"{field} is not load-bearing here — only {moved:.4f} m"


# ── σ is a lean, not a winding ───────────────────────────────────────────────

@pytest.mark.parametrize("rho_deg", [0.0, 89.0, 143.0, 179.0, -143.0])
def test_sigma_is_wrapped_to_a_lean_and_not_a_winding(rho_deg) -> None:
    """`atan2` reports each axis's bearing in (-π, π], so once ρ + σ passes a
    quarter turn the y axis's bearing comes back a full turn BELOW the x
    axis's and the raw difference lands near -2π.

    Unwrapped, a square map turned 143° with a 0.3° lean records σ = -359.7°.
    It is the same placement — every conversion in this file is 2π-periodic in
    σ, so no pin moves — and it is refused by everything that asks whether σ
    is SMALL, `stack_from_transform` first. Rebuild Stack, the command that
    exists to end a stack desync, stops being offered for square maps from
    about a quarter turn on; 89° below still wraps to nothing, which is why
    this went unnoticed on every fixture in the suite.
    """
    rho, lean = math.radians(rho_deg), math.radians(0.3)
    q = rho + math.pi / 2 + lean          # the y column leans `lean` off square
    t = fabric_truth.placement_from_columns(
        (0.0, 0.0),
        (20 * math.cos(rho), 20 * math.sin(rho)),
        (15 * math.cos(q), 15 * math.sin(q)))
    assert t["shear_rad"] == pytest.approx(lean, abs=1e-9), (
        f"a {rho_deg}° placement recorded a {math.degrees(t['shear_rad']):.1f}° lean"
    )


# ── a re-anchor moves the pose and only the pose ─────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("sigma_deg", [5.0, 20.0, 45.0])
async def test_an_identity_re_anchor_does_not_move_the_map(sigma_deg) -> None:
    """"Re-anchor origin" REDEFINES a map's world pose, and handed the pose
    the map already has it must do nothing at all.

    One click from the Maps tab, on the button whose whole promise is that
    metres are the truth and the picture follows them. A record rebuilt out of
    five of its six fields squares the map up on the spot: 1.31 m at a 5°
    lean, 5.21 m at 20°, 11.48 m at 45°, with the pose unchanged and nothing
    on screen to say why the house moved. See the control below.
    """
    m, t = _sheared_map_and_record(sigma_deg)
    s = _store({"m": t})
    before = {f: s.map_frac_to_metres(*f, "m") for f in _FRACS}

    res = await s.async_reanchor_map(
        "m", m, None, origin_x_m=t["origin_x_m"], origin_y_m=t["origin_y_m"],
        rotation_rad=t["rotation_rad"])
    assert res["ok"], res

    worst = max(math.hypot(*(g - e for g, e in zip(s.map_frac_to_metres(*f, "m"), before[f])))
                for f in _FRACS)
    assert worst < 1e-3, f"an identity re-anchor moved the map {worst:.4f} m"


@pytest.mark.asyncio
async def test_a_re_anchor_changes_the_pose_and_leaves_the_shape_alone() -> None:
    """The other half: a real re-anchor turns and shifts the map by exactly
    what it was given, and the angle between the map's own two axes — which is
    not part of a pose — comes through untouched."""
    m, t = _sheared_map_and_record()
    s = _store({"m": t})
    res = await s.async_reanchor_map("m", m, None, origin_x_m=-6.5,
                                     origin_y_m=11.0, rotation_rad=1.1)
    assert res["ok"], res

    want = _store({"m": {**t, "origin_x_m": -6.5, "origin_y_m": 11.0,
                         "rotation_rad": 1.1}})
    worst = max(math.hypot(*(g - e for g, e in zip(s.map_frac_to_metres(*f, "m"),
                                                   want.map_frac_to_metres(*f, "m"))))
                for f in _FRACS)
    assert worst < 1e-3, f"the re-anchored map is {worst:.4f} m from the pose it was given"
    assert s.data["map_transforms"]["m"]["shear_rad"] == t["shear_rad"]


@pytest.mark.parametrize("sigma_deg,expect", [(5.0, 1.3086), (20.0, 5.2094), (45.0, 11.4805)])
def test_the_control_a_five_field_re_anchor_was_worth_metres(sigma_deg, expect) -> None:
    """What the identity re-anchor above is guarding, measured.

    `new_t = {five fields}` instead of `dict(old_t)` — the record rebuilt
    field by field, which is how σ goes missing on any path that rebuilds one.
    """
    _, t = _sheared_map_and_record(sigma_deg)
    five = {k: v for k, v in t.items() if k != "shear_rad"}
    moved = max(math.hypot(*(g - e for g, e in zip(_store({"m": five}).map_frac_to_metres(*f, "m"),
                                                   _store({"m": t}).map_frac_to_metres(*f, "m"))))
                for f in _FRACS)
    assert moved == pytest.approx(expect, abs=1e-3), f"{moved:.4f} m"


# ── the rebuild refuses a lean it cannot write down ──────────────────────────

# ── a payload that does not mention σ has not restated it ────────────────────

_SHEARED_RECORD = {"origin_x_m": 4.0, "origin_y_m": 5.0, "scale_x_m": 10.0,
                   "scale_y_m": 10.0, "rotation_rad": 0.3, "shear_rad": -0.1161,
                   "floor_id": "main", "origin_anchored": True}


_FIVE_FIELD_SAVE = {"origin_x_m": 4.0, "origin_y_m": 5.0, "scale_x_m": 10.5,
                    "scale_y_m": 10.5, "rotation_rad": 0.3, "floor_id": "main"}


@pytest.mark.asyncio
@pytest.mark.parametrize("reanchor", [False, True], ids=["save", "re-anchor"])
async def test_a_five_field_save_does_not_straighten_a_sheared_map(reanchor) -> None:
    """INVARIANT: a placement field is changed only by a payload that STATES it.

    "σ is shape, so a re-measure may restate it" is not "σ is shape, so any
    save may erase it". The sanitise defaulted a missing key to 0, and Save
    Scale sends exactly five fields — origin, both scales, rotation, floor —
    so re-measuring the scale of a sheared map squared it up by the whole
    lean, with the deliberate scale change to hide the displacement behind.

    Through BOTH doors, because the rule is about the payload and not about
    which one it came in by. `reanchor=True` takes the branch that is allowed
    to overwrite the world pose, and σ is not part of a pose — a re-anchor
    that restates the pose the map already has has said nothing about the
    shape. Nothing pinned that: all four callers state σ today, so the whole
    exemption was invisible.
    """
    s = _store({"m": dict(_SHEARED_RECORD)})
    before = s.map_frac_to_metres(1.0, 1.0, "m")

    # Exactly what maps.js used to send: five fields and no mention of σ.
    await s.async_set_map_transform("m", dict(_FIVE_FIELD_SAVE), reanchor=reanchor)
    t = s.data["map_transforms"]["m"]
    assert t["shear_rad"] == pytest.approx(-0.1161), "the save erased a stored lean"

    # ...and the scale change it DID state is the only thing that moved.
    s2 = _store({"m": {**t, "scale_x_m": 10.0, "scale_y_m": 10.0}})
    assert s2.map_frac_to_metres(1.0, 1.0, "m") == pytest.approx(before, abs=1e-9)


@pytest.mark.asyncio
async def test_the_five_field_save_survives_the_endpoint_it_is_posted_to() -> None:
    """Save Scale posts to `padspan_ha/fabric_map_transform_set`, and not one
    test in this suite named that endpoint.

    Everything above measures `async_set_map_transform` directly, so the whole
    rule was defeatable by a single `transform.setdefault("shear_rad", 0)` in
    the handler between the button and the store — a line that reads like
    defaulting a missing key and squares up every sheared map on the box, with
    nothing looking at it.
    """
    from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
    from custom_components.padspan_ha.ws_fabric import ws_fabric_map_transform_set

    mdl = _store({"m": dict(_SHEARED_RECORD)})
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl}}
    conn = MagicMock()
    await ws_fabric_map_transform_set(
        hass, conn, {"id": 1, "map_id": "m", "transform": dict(_FIVE_FIELD_SAVE)})

    conn.send_error.assert_not_called()
    assert mdl.data["map_transforms"]["m"]["shear_rad"] == pytest.approx(-0.1161), (
        "the endpoint straightened the map on the way through"
    )


def test_the_control_the_erased_lean_was_worth_metres() -> None:
    grown = {**_SHEARED_RECORD, "scale_x_m": 10.5, "scale_y_m": 10.5}
    with_sigma = _store({"m": grown}).map_frac_to_metres(1.0, 1.0, "m")
    without = _store({"m": {k: v for k, v in grown.items() if k != "shear_rad"}}
                     ).map_frac_to_metres(1.0, 1.0, "m")
    moved = math.hypot(*(a - b for a, b in zip(with_sigma, without)))
    assert moved > 1.0, f"only {moved:.4f} m"


@pytest.mark.asyncio
async def test_an_explicit_zero_is_still_a_restatement() -> None:
    """The other side of the rule. Saying "square" is allowed, so the preserve
    must not become a value nothing can ever clear."""
    s = _store({"m": dict(_SHEARED_RECORD)})
    await s.async_set_map_transform("m", {**_SHEARED_RECORD, "shear_rad": 0.0})
    assert s.data["map_transforms"]["m"]["shear_rad"] == 0.0


# ── the panel that shows two placements disagreeing ──────────────────────────

# The record leans one way and the stack leans the other. It used to lean
# -0.0873 against a stack saying radians(-5) = -0.0872665 — the SAME NUMBER to
# four decimal places, and both assertions below passed only on `approx`'s
# default 1e-6 relative tolerance. A panel whose whole job is to show two
# placements disagreeing was being proved able to show two that agree.
_PANEL_SYSTEM_SIGMA = 0.31


# ── the two migration steps write σ under opposite conditions, on purpose ────

class TestWhoMayWriteSigmaDuringTheUpgrade:
    """Step 1 of the migration copies a SIGNED σ onto every disagreeing map.
    Step 9 refuses to write σ onto a map that has no solved matrix of its own.

    Read as one policy about one field, that looks like a contradiction. They
    are not one policy, because they are not the same operation:

      * Step 1 REPLACES a placement that provably disagrees with the stack.
        Its output has to be internally consistent with what the renderer
        draws, and a map placed by a solved affine really does lean, so the
        lean really is part of where the map is drawn. Storing five of the six
        fields is the record R1 exists to stop.
      * Step 9 EDITS one field of a record that is otherwise trusted, and
        re-derives nothing afterwards. A σ it did not read off the map's own
        matrix would move every pin on that map without repairing anything.

    THE RULE, written down once: σ is written WHOLE-RECORD, or from the map's
    OWN matrix. It is never inferred onto a record in place.

    R2 removed the case that made this hardest to state. Step 9's old reason
    was that a decomposed stack's σ is "the ANCHOR's anisotropy showing
    through a rotation" — a lean the world frame invented, which step 1 had to
    store (the renderer really drew it) and step 9 had to refuse (it was not
    the map's). One gauge cannot invent one: see
    `test_the_gauge_cannot_manufacture_shear_at_any_rotation`. So the two
    fixtures below are different maps rather than two readings of one, and
    step 9's refusal is now about a map with no matrix, full stop.

    Only installs that have never run photo-divorce are affected either way.
    """

    # A 5° lean, as a solved affine. The columns are [1, 0] and
    # [-sin 5°, cos 5°] — a real Point Align result, not a frame artefact.
    _LEAN_RAD = math.radians(5.0)

    @classmethod
    def _leaning_scene(cls):
        """A map genuinely placed with a lean, beside a well-formed master.

        Point Align wrote the matrix, so the lean is the map's own placement
        and step 1 has to carry it into the record it replaces.
        """
        lean = cls._LEAN_RAD
        master = {"id": "master", "floor_id": "main", "name": "Ground",
                  "image": {"width": 1600, "height": 1200},
                  "stack": {"is_master": True, "scale": 1.0, "scale_x_adj": 1.0,
                            "ref_ar": 0.75, "rotation": 0, "x_offset": 0, "y_offset": 0}}
        turned = {"id": "turned", "floor_id": "main", "name": "Turned",
                  "image": {"width": 1600, "height": 1200},
                  # stack_world_xform's affine branch reads the world
                  # columns as (a, ar·c) and (b, ar·d), so the y column is
                  # divided by ar to come out at the lean asked for.
                  "stack": {"_m": [0.6, -0.6 * math.sin(lean),
                                   0.0, 0.6 * math.cos(lean) / 0.75],
                            "_m_ar": 0.75, "ref_ar": 0.75,
                            "x_offset": 0.2, "y_offset": 0.1}}
        transforms = {
            "master": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                       "scale_y_m": 15.0, "rotation_rad": 0.0,
                       "floor_id": "main", "reference_measurements": [{"m": 1}]},
            # Nowhere near the stack — so step 1 repairs it rather than
            # counting it already correct.
            "turned": {"origin_x_m": 40.0, "origin_y_m": 40.0, "scale_x_m": 5.0,
                       "scale_y_m": 5.0, "rotation_rad": 0.0, "floor_id": "main"},
        }
        return [master, turned], transforms

    @staticmethod
    def _decomposed_scene():
        """The same shape with a plain rotated stack and NO matrix.

        This is the fixture that used to carry a degraded anchor, and it is
        kept because it is the map step 9 must leave alone: no matrix, no sign
        to recover. What has changed is that its stack no longer yields a lean
        at all, so there is nothing left to refuse.
        """
        master = {"id": "master", "floor_id": "main", "name": "Ground",
                  "image": {"width": 1600, "height": 1200},
                  "stack": {"is_master": True, "scale": 1.0, "scale_x_adj": 1.0,
                            "ref_ar": 0.75, "rotation": 0, "x_offset": 0, "y_offset": 0}}
        turned = {"id": "turned", "floor_id": "main", "name": "Turned",
                  "image": {"width": 1600, "height": 1200},
                  "stack": {"is_master": False, "scale": 0.6, "scale_x_adj": 1.0,
                            "ref_ar": 0.75, "rotation": 30.0,
                            "x_offset": 0.2, "y_offset": 0.1}}
        transforms = {
            "master": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                       "scale_y_m": 15.0, "rotation_rad": 0.0,
                       "floor_id": "main", "reference_measurements": [{"m": 1}]},
            "turned": {"origin_x_m": 40.0, "origin_y_m": 40.0, "scale_x_m": 5.0,
                       "scale_y_m": 5.0, "rotation_rad": 0.0, "floor_id": "main"},
        }
        return [master, turned], transforms

    @pytest.mark.asyncio
    async def test_step_1_writes_it_because_it_is_replacing_the_whole_record(self) -> None:
        from custom_components.padspan_ha.migrations import (
            MARKER, SHEAR_SIGN, async_run_photo_divorce,
        )

        maps, transforms = self._leaning_scene()
        mdl = _store(transforms)
        seed_world_gauge(mdl, maps)
        ms = maps_store_with(maps)
        # SHEAR_SIGN pre-marked: step 1 is the only thing that may write σ here.
        fab = TestTheShearSignBackfill._fab([SHEAR_SIGN])
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        assert anchor["source_map_id"] == "master", anchor
        # The lean under test is the MAP's, from its own solved matrix.
        assert abs(fabric_truth.legacy_stack_metre_transform(
            maps[1], anchor)["shear_rad"]) == pytest.approx(self._LEAN_RAD, abs=1e-6)

        # Where the LEGACY renderer drew it, captured BEFORE the run: step 13
        # converts the stack into the record and then deletes it, so after the
        # migration there is no legacy stack left to ask.
        drawn = [_drawn(maps[1], fx, fy, anchor) for fx, fy in _FRACS]

        stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, migration_backup)
        assert "Turned" in stats["maps_repaired"]
        assert SHEAR_SIGN in fab.data[MARKER] and stats["shear_signed"] == 0, (
            "step 9 ran after all — this test is not measuring step 1")

        t = mdl.data["map_transforms"]["turned"]
        assert t["shear_rad"] != 0.0, "step 1 stored five of the six fields"
        # ...and the direction is the point: the repaired record puts the map
        # where the renderer draws it.
        with_sigma = max(math.hypot(*(g - e for g, e in zip(
            _store({"turned": t}).map_frac_to_metres(fx, fy, "turned"), d)))
            for (fx, fy), d in zip(_FRACS, drawn))
        five = {k: v for k, v in t.items() if k != "shear_rad"}
        without = max(math.hypot(*(g - e for g, e in zip(
            _store({"turned": five}).map_frac_to_metres(fx, fy, "turned"), d)))
            for (fx, fy), d in zip(_FRACS, drawn))
        # 6.3e-05 m with it, 0.47 m without — four orders of magnitude, and
        # the wrong one is most of a metre off on a 12 m map.
        assert with_sigma < 1e-3 < 0.1 < without, (with_sigma, without)

    @pytest.mark.asyncio
    async def test_step_9_leaves_a_map_with_no_matrix_alone(self) -> None:
        """The other half of the rule. An in-place edit may only take σ from
        the map's own matrix, and this map has none — so its record keeps
        whatever it already said.

        And there is nothing for it to have taken: with one gauge the rotated
        decomposed stack yields σ = 0 exactly, where a degraded anchor used to
        hand it a lean the map did not have.
        """
        from custom_components.padspan_ha.migrations import _backfill_shear_sign

        maps, transforms = self._decomposed_scene()
        mdl = _store(transforms)
        seed_world_gauge(mdl, maps)
        anchor = fabric_truth.measure_world_gauge(maps, mdl)
        assert fabric_truth.legacy_stack_metre_transform(maps[1], anchor)["shear_rad"] == 0.0
        out = await _backfill_shear_sign(mdl, maps, anchor)
        assert out["shear_signed"] == 0
        assert "shear_rad" not in mdl.data["map_transforms"]["turned"]
