# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Trimming a Point-Aligned map desyncs the stack from itself (issue #62).

`stack_world_xform` has two branches. When Point Align has solved a raw affine
it uses `_m` and ignores `scale` / `scale_x_adj` / `rotation` completely.

A fresh Point Align is self-consistent: the solver writes the affine AND an
AR-aware decomposition of the same matrix (maps.js `_solvePtAlignAffine`), so
`scale * scale_x_adj` and the affine's own x span agree exactly. The old
derivation was right there, which is why this went unseen.

A trim is what parts them. `_recrop_stack` correctly rewrites `_m` and returns
early — the decomposed fields are left describing the pre-trim picture, on
purpose, because the affine branch is the one in force. But both anchor-side
callers read those abandoned fields:

    world_w = stack.scale * stack.scale_x_adj
    world_h = stack.scale * ref_ar

so after a trim they measure a footprint the renderer never draws. The write
side of this bug was fixed properly (that is what `_recrop_stack` is);
the read side kept its own copy of the old derivation, twice in Python and
once more in the JS twin.

The error is a pure function of the trim: reading the pre-trim footprint under
the post-trim metric record gives m_per_x = mpw*fw and m_per_y = mpw*fh, so

    iso_error = |fh - fw| / fw

which is 0 for a square trim and grows with how one-sided it is. rjbutler
trimmed a garage-width strip off one axis and was shown 42%.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.model_store import ModelStore, _recrop_stack


# 1600x1200 px covering 80 m x 60 m — one scale, 20 px/m on both axes.
_MEASURED = {
    "origin_x_m": 0.0,
    "origin_y_m": 0.0,
    "scale_x_m": 80.0,
    "scale_y_m": 60.0,
    "rotation_rad": 0.0,
    "floor_id": "main",
    "reference_measurements": [
        {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 40.0,
         "px_per_meter": 20.0, "angle_deg": 0, "date": "2026-07-01"},
    ],
}


def _store() -> ModelStore:
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_save = AsyncMock()
    store.data = {"map_transforms": {"m1": dict(_MEASURED)}}
    return store


def _map(stack: dict) -> dict:
    return {
        "id": "m1",
        "floor_id": "main",
        "image": {"width": 1600, "height": 1200},
        "stack": stack,
        "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
    }


# A Point Align of this map onto its reference, as the solver writes it: the
# raw affine plus the AR-aware decomposition of that same matrix. Identity
# here, so both descriptions agree and the map is self-consistent.
_POINT_ALIGNED = {
    "_m": [1.0, 0.0, 0.0, 1.0], "_m_ar": 0.75,
    "scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
    "rotation": 0, "x_offset": 0, "y_offset": 0, "is_master": True,
}

_DECOMPOSED = {
    "scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
    "rotation": 0, "x_offset": 0, "y_offset": 0, "is_master": True,
}

# rjbutler's trim: a garage-width strip off one side, nothing off the height.
# |fh - fw| / fw = 0.30 / 0.70 = 0.4286, the 42% he was shown.
_TRIM_FW, _TRIM_FH = 0.70, 1.0


def _trimmed(stack: dict) -> tuple[dict, dict]:
    """Drive the REAL crop path, and shrink the metric record with it.

    Returns (map, transform). The metric record shrinks by the retained
    fraction exactly as async_recompute_transform_for_map does, so the
    quotient the anchor takes is invariant across the trim — that is the
    physical fact under test: cropping a photograph does not change how many
    metres a world unit is.
    """
    new_stack = _recrop_stack(stack, 0.0, 0.0, _TRIM_FW, _TRIM_FH)
    assert new_stack is not None
    m = _map(new_stack)
    m["image"] = {"width": int(1600 * _TRIM_FW), "height": int(1200 * _TRIM_FH)}
    t = dict(_MEASURED)
    t["scale_x_m"] = _MEASURED["scale_x_m"] * _TRIM_FW
    t["scale_y_m"] = _MEASURED["scale_y_m"] * _TRIM_FH
    return m, t


def _store_with(t: dict) -> ModelStore:
    store = _store()
    store.data = {"map_transforms": {"m1": t}}
    return store


def test_trimmed_point_aligned_anchor_reads_the_affine() -> None:
    """The metre scale survives the trim, because `_m` did."""
    m, t = _trimmed(_POINT_ALIGNED)
    anchor = fabric_truth.find_metre_anchor([m], _store_with(t))
    assert anchor is not None
    # 80 m per world unit before the trim, and after it. The house did not move.
    assert anchor["m_per_world_x"] == pytest.approx(80.0)
    assert anchor["m_per_world_y"] == pytest.approx(80.0)
    assert anchor["iso_error"] == pytest.approx(0.0, abs=1e-9)


def test_trimmed_point_aligned_map_is_not_flagged_as_disagreeing() -> None:
    """map_geometry_faults keeps its own copy of the derivation — site two."""
    m, t = _trimmed(_POINT_ALIGNED)
    faults = fabric_truth.map_geometry_faults([m], _store_with(t))
    assert faults == [], f"a correctly-trimmed Point-Aligned map was flagged: {faults}"


def test_the_abandoned_fields_carry_rjbutlers_42_percent() -> None:
    """Pins the mechanism: the stale footprint IS the number he was shown.

    Same trimmed map, read the way the old code read it. This is not a tuned
    constant — |fh - fw| / fw falls out of the trim fractions alone.
    """
    m, _ = _trimmed(_POINT_ALIGNED)
    stk = m["stack"]
    stale_w = float(stk["scale"]) * float(stk["scale_x_adj"])
    stale_h = float(stk["scale"]) * float(stk["ref_ar"])
    mpx = (80.0 * _TRIM_FW) / stale_w
    mpy = (60.0 * _TRIM_FH) / stale_h
    assert abs(mpy - mpx) / mpx == pytest.approx(
        abs(_TRIM_FH - _TRIM_FW) / _TRIM_FW)
    assert abs(mpy - mpx) / mpx == pytest.approx(0.42, abs=0.01)


def test_decomposed_map_is_unchanged() -> None:
    """Control: the branch that was always right stays right."""
    anchor = fabric_truth.find_metre_anchor([_map(_DECOMPOSED)], _store())
    assert anchor is not None
    assert anchor["m_per_world_x"] == pytest.approx(80.0)
    assert anchor["m_per_world_y"] == pytest.approx(80.0)
    assert anchor["iso_error"] == pytest.approx(0.0, abs=1e-9)


def test_rotation_does_not_change_the_footprint() -> None:
    """Rotating a map does not change how much world its image covers.

    The old derivation ignored rotation and happened to be right, because
    rotation preserves length. Measuring the transformed edges makes that true
    by construction rather than by luck.
    """
    for deg in (0, 30, 90, 217):
        stack = dict(_DECOMPOSED, rotation=deg)
        anchor = fabric_truth.find_metre_anchor([_map(stack)], _store())
        assert anchor is not None, f"no anchor at {deg} deg"
        assert anchor["m_per_world_x"] == pytest.approx(80.0), f"x at {deg} deg"
        assert anchor["m_per_world_y"] == pytest.approx(80.0), f"y at {deg} deg"
