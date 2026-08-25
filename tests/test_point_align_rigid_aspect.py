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
from tests.conftest import seed_world_gauge


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


def _store(maps: list | None = None) -> ModelStore:
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.data = {"map_transforms": {"basement": dict(_BASEMENT_T),
                                     "main": dict(_MAIN_T)}}
    seed_world_gauge(store, maps if maps is not None else
                     [_basement_map(), _main_map()])
    return store


def _iso_error(m: dict, t: dict) -> float:
    """How far the map's two metres-per-world-unit figures disagree."""
    world_w, world_h = fabric_truth.legacy_world_footprint(m)
    m_per_x, m_per_y = t["scale_x_m"] / world_w, t["scale_y_m"] / world_h
    return abs(m_per_y - m_per_x) / m_per_x


def _placement_error(m: dict, t: dict, anchor: dict) -> tuple[float, float]:
    """(scale_error_frac, origin_delta_m) — the two halves map_geometry_faults
    compares, readable whether or not the map is over tolerance."""
    st = fabric_truth.legacy_stack_metre_transform(m, anchor)
    scale_err = max(abs(t["scale_x_m"] - st["scale_x_m"]) / t["scale_x_m"],
                    abs(t["scale_y_m"] - st["scale_y_m"]) / t["scale_y_m"])
    origin_delta = math.hypot(t["origin_x_m"] - st["origin_x_m"],
                              t["origin_y_m"] - st["origin_y_m"])
    return scale_err, origin_delta


def test_the_rigid_solve_gave_main_floor_the_reference_pictures_shape() -> None:
    """The invariant, stated where it broke: a footprint keeps its own aspect."""
    main = _main_map()
    world_w, world_h = fabric_truth.legacy_world_footprint(main)

    assert _STORED_M[0] == _STORED_M[3], (
        "a == d is the whole defect: the solver could not express two different "
        "diagonal entries, so the shape below was forced"
    )
    assert world_h / world_w == pytest.approx(_UPSTAIRS_AR, abs=1e-6), (
        "the placed footprint has Upstairs' aspect, not Main Floor's"
    )
    assert world_h / world_w != pytest.approx(fabric_truth.image_ar(main), abs=1e-3)


@pytest.mark.asyncio
async def test_the_conversion_takes_his_measured_record_over_the_bad_solve() -> None:
    """His store, through the one-way conversion. The record wins.

    Main Floor's legacy stack draws it at Upstairs' aspect — the rigid solve's
    defect, baked into a matrix — while its measured record says what he
    actually measured. Those two disagree, and the disagreement has the `iso`
    signature: the record does not match the picture as the stack drew it. That
    is the branch where the RECORD wins, so the conversion keeps the
    measurement and the bad solve goes with the stack it lived on.

    The four repair buttons that existed for this state are deleted. There is
    nothing left to repair: the map is drawn from the record now, so it is
    drawn at the size he measured.
    """
    from custom_components.padspan_ha import migrations
    from tests.conftest import maps_store_with, migration_backup

    maps = [_basement_map(), _main_map()]
    store = _store()
    anchor = fabric_truth.measure_world_gauge(maps, store)
    assert anchor["source_map_id"] == "basement"

    # The signature that decides: the record against the map's own picture.
    main_t = store.map_transform("main")
    iso = fabric_truth.legacy_record_iso_error(_main_map(), main_t)
    assert iso > fabric_truth.RECORD_ISO_TOL, f"the fixture no longer carries the iso signature ({iso})"

    before = dict(main_t)
    fab = MagicMock()
    fab.data = {}
    fab.store = AsyncMock()
    ms = maps_store_with(maps)
    out = await migrations._derive_world_placement(store, ms, fab, maps, anchor)

    assert out["record_won"] >= 1
    assert store.map_transform("main") == before, "his measurement was overwritten"
    # And the world copy is gone, so nothing can disagree with it again.
    assert set(ms.data["maps"][1]["stack"]) <= {
        "z_level", "ceiling_height_m", "ref_map_id", "tie_ins"}


