# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Point Align placed a map with the REFERENCE picture's shape (issue #62, rjbutler).

The invariant is about pixels being square: **a placed map's world footprint
has its OWN image's aspect.** Break it and the map covers a world rectangle of
the wrong shape, so one axis reads back a different metres-per-world-unit from
the other and every metre derived through the placement is wrong on that axis.

`_solvePtAlignRigid` (maps.js) broke it. Both pictures are drawn into one stage
sized to the REFERENCE map's ratio, and the solver was handed only that ratio —
`arHW = _refIH / _refIW` — which it then used for the TARGET's v terms as well.
Its reconstruction was `m11 = a, m12 = -b*ar, m21 = b/ar, m22 = a`, so
m11 === m22 by construction, and a footprint whose two diagonal entries are
equal has aspect `_m_ar` whatever the target's picture is.

rjbutler point-aligned a 1600x853 Main Floor against a 930x850 Upstairs. The
values below are his, quoted from the issue: his stack still carries
`_m_ar = 850/930`, the reference image's ratio, and `ref_map_id` naming that
same map. The error is exactly the ratio of the two pictures —
1 - 0.533125/0.9139785 = 0.4167 — which is the 42% his health card showed.

His stack's x_offset / y_offset were not quoted in the issue and are set to
zero here. `iso_error` and `scale_error_frac` are differences of transformed
points, so both are independent of them; only `origin_delta_m` is not, and it
is then whatever this placement implies against a stored origin of (0, 0).
"""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.model_store import ModelStore


# Upstairs is 930x850, so this is the ratio the solver was handed — and the
# only ratio it used. Main Floor's own is 853/1600 = 0.533125.
_UPSTAIRS_AR = 850 / 930

# Quoted verbatim from issue #62. a == d, and b and c equal and opposite: the
# signature of the rigid solver's reconstruction, and of nothing else.
_STORED_M = [1.12767, -8.9e-5, 1.06e-4, 1.12767]

_REF_MEASUREMENT = [
    {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 5.0,
     "px_per_meter": 87.21, "angle_deg": 0, "date": "2026-08-01"},
]

# Basement anchors his house at 10.916 m per world unit with iso_error 0.0003.
# 1200x900 at scale 1.0 spans 1.0 x 0.75 world units, so its metric record is
# 10.916 m across and 10.916 * 1.0003 * 0.75 m down.
_BASEMENT_T = {
    "origin_x_m": 0.0, "origin_y_m": 0.0,
    "scale_x_m": 10.916, "scale_y_m": 8.1895,
    "rotation_rad": 0.0, "floor_id": "basement",
    "reference_measurements": _REF_MEASUREMENT,
}

# Main Floor as MEASURED — the trustworthy half, and self-consistent with the
# picture: 9.7813 / 18.3472 = 0.53312, which is 853/1600.
_MAIN_T = {
    "origin_x_m": 0.0, "origin_y_m": 0.0,
    "scale_x_m": 18.3472, "scale_y_m": 9.7813,
    "rotation_rad": 0.0, "floor_id": "main",
    "reference_measurements": _REF_MEASUREMENT,
}


def _main_map(m_ar: float = _UPSTAIRS_AR) -> dict:
    """Main Floor exactly as Point Align left it.

    `scale` and `scale_x_adj` are what stackFieldsFromAffine writes beside the
    matrix — the decomposition of `_m` itself — so the two halves of the stack
    AGREE. Nothing is stale here; the matrix is simply the wrong shape, which
    is why stack_desync stayed silent about it.
    """
    return {
        "id": "main", "floor_id": "main",
        "image": {"width": 1600, "height": 853},
        "stack": {
            "scale": 1.1277, "scale_x_adj": 1.0, "rotation": 0.0,
            "x_offset": 0.0, "y_offset": 0.0,
            "ref_ar": _UPSTAIRS_AR, "ref_map_id": "upstairs",
            "_m": list(_STORED_M), "_m_ar": m_ar, "is_master": False,
        },
    }


def _basement_map() -> dict:
    return {
        "id": "basement", "floor_id": "basement",
        "image": {"width": 1200, "height": 900},
        "stack": {"scale": 1.0, "scale_x_adj": 1.0, "rotation": 0.0,
                  "x_offset": 0.0, "y_offset": 0.0, "ref_ar": 0.75,
                  "is_master": False},
    }


def _store() -> ModelStore:
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.data = {"map_transforms": {"basement": dict(_BASEMENT_T),
                                     "main": dict(_MAIN_T)}}
    return store


def _iso_error(m: dict, t: dict) -> float:
    """How far the map's two metres-per-world-unit figures disagree."""
    world_w, world_h = fabric_truth.world_footprint(m)
    m_per_x, m_per_y = t["scale_x_m"] / world_w, t["scale_y_m"] / world_h
    return abs(m_per_y - m_per_x) / m_per_x


def _placement_error(m: dict, t: dict, anchor: dict) -> tuple[float, float]:
    """(scale_error_frac, origin_delta_m) — the two halves map_geometry_faults
    compares, readable whether or not the map is over tolerance."""
    st = fabric_truth.stack_metre_transform(m, anchor)
    scale_err = max(abs(t["scale_x_m"] - st["scale_x_m"]) / t["scale_x_m"],
                    abs(t["scale_y_m"] - st["scale_y_m"]) / t["scale_y_m"])
    origin_delta = math.hypot(t["origin_x_m"] - st["origin_x_m"],
                              t["origin_y_m"] - st["origin_y_m"])
    return scale_err, origin_delta


def test_the_rigid_solve_gave_main_floor_the_reference_pictures_shape() -> None:
    """The invariant, stated where it broke: a footprint keeps its own aspect."""
    main = _main_map()
    world_w, world_h = fabric_truth.world_footprint(main)

    assert _STORED_M[0] == _STORED_M[3], (
        "a == d is the whole defect: the solver could not express two different "
        "diagonal entries, so the shape below was forced"
    )
    assert world_h / world_w == pytest.approx(_UPSTAIRS_AR, abs=1e-6), (
        "the placed footprint has Upstairs' aspect, not Main Floor's"
    )
    assert world_h / world_w != pytest.approx(fabric_truth.image_ar(main), abs=1e-3)


def test_rjbutlers_stack_reproduces_the_health_card_he_reported() -> None:
    """Control: his exact values, and the numbers he was shown come back out."""
    maps = [_basement_map(), _main_map()]
    store = _store()
    anchor = fabric_truth.find_metre_anchor(maps, store)
    assert anchor["map_id"] == "basement"
    assert anchor["m_per_world_x"] == pytest.approx(10.916)

    faults = {f["map_id"]: f for f in fabric_truth.map_geometry_faults(maps, store)}
    assert list(faults) == ["main"]
    # "axis scales disagree by 42%" — and it is exactly 1 - image_ar/_m_ar.
    assert faults["main"]["iso_error"] == pytest.approx(0.4167, abs=1e-4)
    assert faults["main"]["iso_error"] == pytest.approx(
        1 - fabric_truth.image_ar(_main_map()) / _UPSTAIRS_AR, abs=1e-4)
    # "stored scale 33% off placement" — 1.12767 world units is 12.31 m of a
    # floor that measures 18.35 m, so 6.04 m of the garage end is not there.
    assert faults["main"]["scale_error_frac"] == pytest.approx(0.3291, abs=1e-4)
    assert faults["main"]["origin_delta_m"] == pytest.approx(0.944, abs=1e-3)
    # And nothing else could have caught it: the stack agrees with itself.
    assert fabric_truth.stack_desync(_main_map()) == pytest.approx(0.0)


def test_rebuild_alignment_clears_every_fault_metric() -> None:
    """The repair for a store already in this state — the button he pressed.

    stack_from_transform refused every `_m` stack, which is why "Rebuild
    alignment" did nothing for him. His matrix carries no shear, so the
    decomposed fields describe it exactly and the measured record — the half
    that was always right — rebuilds the placement.
    """
    maps = [_basement_map(), _main_map()]
    store = _store()
    anchor = fabric_truth.find_metre_anchor(maps, store)

    before_scale, before_origin = _placement_error(maps[1], _MAIN_T, anchor)
    assert _iso_error(maps[1], _MAIN_T) == pytest.approx(0.4167, abs=1e-4)
    assert before_scale == pytest.approx(0.3291, abs=1e-4)
    assert before_origin == pytest.approx(0.944, abs=1e-3)

    rebuilt = fabric_truth.stack_from_transform(maps[1], _MAIN_T, anchor)
    assert rebuilt is not None, "the repair still refuses the map it exists for"
    maps[1]["stack"] = rebuilt

    # The matrix must go with it, or stack_world_xform keeps drawing the stale
    # one and the repair is invisible.
    assert rebuilt["_m"] is None and rebuilt["_m_ar"] is None

    after_scale, after_origin = _placement_error(maps[1], _MAIN_T, anchor)
    assert _iso_error(maps[1], _MAIN_T) == pytest.approx(0.0, abs=1e-3)
    assert after_scale == pytest.approx(0.0, abs=1e-4)
    assert after_origin == pytest.approx(0.0, abs=1e-3)
    assert fabric_truth.map_geometry_faults(maps, store) == []

    # The placement now IS the measured record: 18.3472 m x 9.7813 m at (0, 0).
    st = fabric_truth.stack_metre_transform(maps[1], anchor)
    assert st["scale_x_m"] == pytest.approx(_MAIN_T["scale_x_m"], abs=1e-3)
    assert st["scale_y_m"] == pytest.approx(_MAIN_T["scale_y_m"], abs=1e-3)
    # ...and it covers a world rectangle Main Floor's own shape again.
    world_w, world_h = fabric_truth.world_footprint(maps[1])
    assert world_h / world_w == pytest.approx(fabric_truth.image_ar(maps[1]), abs=1e-3)


def test_the_repaired_map_is_safe_to_anchor_the_house() -> None:
    """Order must stop mattering: the repaired map agrees with the Basement.

    find_metre_anchor takes the FIRST map inside ANCHOR_ISO_TOL, so a repair
    that only silences iso_error hands the whole house a new metre scale as
    soon as the repaired map happens to be listed first.
    """
    store = _store()
    maps = [_basement_map(), _main_map()]
    anchor = fabric_truth.find_metre_anchor(maps, store)
    maps[1]["stack"] = fabric_truth.stack_from_transform(maps[1], _MAIN_T, anchor)

    main_first = fabric_truth.find_metre_anchor([maps[1], maps[0]], store)
    assert main_first["m_per_world_x"] == pytest.approx(10.916, abs=1e-3), (
        "the repaired map anchors the house at a different scale from the "
        "Basement; every floor, scanner and barrier moves with it"
    )


def test_substituting_the_maps_own_aspect_into_m_ar_does_not_repair_it() -> None:
    """The one-number fix that looks right and is not (raised on issue #62).

    Setting `_m_ar` to Main Floor's own aspect drops iso_error to nothing, but
    only because a == d makes the footprint's aspect identically `_m_ar` — the
    metric then agrees with itself by definition while the placement stays
    wrong. `_m` is untouched, so the floor is still 12.31 m of an 18.35 m
    building, and it moves.
    """
    store = _store()
    patched = _main_map(m_ar=853 / 1600)
    maps = [_basement_map(), patched]
    anchor = fabric_truth.find_metre_anchor(maps, store)

    assert _iso_error(patched, _MAIN_T) == pytest.approx(0.0, abs=1e-4)
    scale_err, origin_delta = _placement_error(patched, _MAIN_T, anchor)
    assert scale_err == pytest.approx(0.3291, abs=1e-4), "still a third short"
    assert origin_delta > fabric_truth.GEOMETRY_ORIGIN_TOL_M, "and it moved"
    assert [f["map_id"] for f in fabric_truth.map_geometry_faults(maps, store)] == ["main"]

    # Worse: it now qualifies to anchor the house, at 1.49x the true scale.
    main_first = fabric_truth.find_metre_anchor([patched, maps[0]], store)
    assert main_first["map_id"] == "main"
    assert main_first["m_per_world_x"] == pytest.approx(16.27, abs=0.01)
