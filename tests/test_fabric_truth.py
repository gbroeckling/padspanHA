"""Unit tests for fabric_truth — the competing forms of room-layout truth.

The stack fixture numbers are taken from the LIVE Main-floor data that
motivated this module: a measured master (Electrical.jpg, 10.0364m x
14.1982m), a same-size sibling whose own calibration was fabricated at 20m
(Electrical-3), and a scaled sibling (Valance1). The hand-tuned stack
composition must reassemble them into one coherent floor, and
stack_metre_transform must recover the sibling's TRUE ~10m size — that
recovery is the "fix the alignment instead of throwing it away" repair.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth as ft
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import ModelStore

AR = 1600 / 1131  # 1.41468... — the shared reference aspect ratio
M_PER_W = 10.0364


def _model(transforms: dict) -> ModelStore:
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock()
    mdl.store = AsyncMock()
    mdl.data = {"map_transforms": transforms}
    mdl.fabric = None
    return mdl


def _master(room_bounds: dict | None = None) -> dict:
    return {
        "id": "master", "floor_id": "main",
        "image": {"width": 1131, "height": 1600},
        "stack": {"x_offset": 0, "y_offset": 0, "scale": 1, "rotation": 0, "is_master": True},
        "room_bounds": room_bounds or {},
    }


def _sibling(room_bounds: dict | None = None) -> dict:
    # Electrical-3: same image size as the master, offset upward in the stack.
    return {
        "id": "sibling", "floor_id": "main",
        "image": {"width": 1131, "height": 1600},
        "stack": {"x_offset": 0.0198, "y_offset": -0.8056, "scale": 1, "scale_x_adj": 1,
                  "rotation": 0, "ref_ar": AR},
        "room_bounds": room_bounds or {},
    }


_MEASURED = {
    "master": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0364,
               "scale_y_m": 14.1982, "rotation_rad": 0.0, "floor_id": "main",
               "reference_measurements": [{"px": 100, "m": 1.0}]},
}
_FABRICATED_SIBLING = {
    "sibling": {"origin_x_m": 0.199, "origin_y_m": -11.44, "scale_x_m": 20.0,
                "scale_y_m": 28.2935, "rotation_rad": 0.0, "floor_id": "main"},
}


# ── Anchor discovery ────────────────────────────────────────────────────────


def test_anchor_found_and_isotropic() -> None:
    mdl = _model(dict(_MEASURED))
    anchor = ft.find_metre_anchor([_master(), _sibling()], mdl)
    assert anchor is not None
    assert anchor["map_id"] == "master"
    assert anchor["m_per_world"] == pytest.approx(10.0364, abs=1e-3)
    assert anchor["iso_error"] < 0.001          # 14.1982 / AR == 10.0364 exactly


def test_no_anchor_without_reference_measurements() -> None:
    mdl = _model(dict(_FABRICATED_SIBLING))     # fabricated scale, no refs
    assert ft.find_metre_anchor([_master(), _sibling()], mdl) is None


# ── Stack composition ───────────────────────────────────────────────────────


def test_master_stack_rooms_match_its_own_measured_calibration() -> None:
    """On the identity master the stack path must equal the transforms path."""
    bounds = {"Kitchen": {"type": "poly", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]}}
    mdl = _model(dict(_MEASURED))
    anchor = ft.find_metre_anchor([_master(bounds)], mdl)
    via_stack = ft.rooms_from_stack([_master(bounds)], anchor)
    via_transforms = ft.rooms_from_transforms([_master(bounds)], mdl)
    for a, b in zip(via_stack["Kitchen"]["points_m"], via_transforms["Kitchen"]["points_m"]):
        assert a[0] == pytest.approx(b[0], abs=0.01)
        assert a[1] == pytest.approx(b[1], abs=0.01)


def test_sibling_assembles_at_true_size_not_fabricated() -> None:
    """The stack places the sibling at master scale (~10m), not its
    fabricated 20m calibration — the disconnected-cluster fix in one number."""
    bounds = {"Laundry": {"type": "poly", "points": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]}}
    mdl = _model({**_MEASURED, **_FABRICATED_SIBLING})
    anchor = ft.find_metre_anchor([_master(), _sibling(bounds)], mdl)
    via_stack = ft.rooms_from_stack([_sibling(bounds)], anchor)
    xs = [p[0] for p in via_stack["Laundry"]["points_m"]]
    ys = [p[1] for p in via_stack["Laundry"]["points_m"]]
    assert max(xs) - min(xs) == pytest.approx(10.0364, abs=0.02)   # true width
    assert max(ys) - min(ys) == pytest.approx(14.1982, abs=0.02)   # true height
    # ...whereas its own fabricated calibration says 20m wide:
    via_transforms = ft.rooms_from_transforms([_sibling(bounds)], mdl)
    xs_t = [p[0] for p in via_transforms["Laundry"]["points_m"]]
    assert max(xs_t) - min(xs_t) == pytest.approx(20.0, abs=0.02)


def test_master_priority_in_stack_merge() -> None:
    bounds = {"Kitchen": {"type": "poly", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]}}
    mdl = _model(dict(_MEASURED))
    anchor = ft.find_metre_anchor([_master(bounds)], mdl)
    rooms = ft.rooms_from_stack([_master(bounds), _sibling(bounds)], anchor)
    assert rooms["Kitchen"]["source_map_id"] == "master"


# ── Alignment repair transform ──────────────────────────────────────────────


def test_stack_metre_transform_recovers_master_calibration() -> None:
    mdl = _model(dict(_MEASURED))
    anchor = ft.find_metre_anchor([_master()], mdl)
    t = ft.stack_metre_transform(_master(), anchor)
    assert t["origin_x_m"] == pytest.approx(0.0, abs=0.01)
    assert t["origin_y_m"] == pytest.approx(0.0, abs=0.01)
    assert t["scale_x_m"] == pytest.approx(10.0364, abs=0.01)
    assert t["scale_y_m"] == pytest.approx(14.1982, abs=0.01)
    assert t["rotation_rad"] == pytest.approx(0.0, abs=1e-6)
    assert t["shear_rad"] == pytest.approx(0.0, abs=1e-6)


def test_stack_metre_transform_repairs_fabricated_sibling() -> None:
    """The repair recovers the sibling's TRUE placement: master-sized
    (~10 x 14.2m), shifted up — NOT the fabricated 20 x 28.3m."""
    mdl = _model({**_MEASURED, **_FABRICATED_SIBLING})
    anchor = ft.find_metre_anchor([_master(), _sibling()], mdl)
    t = ft.stack_metre_transform(_sibling(), anchor)
    assert t["scale_x_m"] == pytest.approx(10.0364, abs=0.02)
    assert t["scale_y_m"] == pytest.approx(14.1982, abs=0.02)
    assert t["origin_x_m"] == pytest.approx(0.0198 * M_PER_W, abs=0.05)
    # y origin: ar*(0.5+oy) - 0.5*ar, all times m_per_world
    expected_oy = (AR * (0.5 - 0.8056) - 0.5 * AR) * M_PER_W
    assert t["origin_y_m"] == pytest.approx(expected_oy, abs=0.05)


def test_rotated_stack_has_rotation_no_shear() -> None:
    m = _master()
    m["stack"]["rotation"] = 30
    mdl = _model(dict(_MEASURED))
    anchor = ft.find_metre_anchor([_master()], mdl)
    t = ft.stack_metre_transform(m, anchor)
    assert t["rotation_rad"] == pytest.approx(0.5236, abs=1e-3)
    assert t["shear_rad"] < 1e-6


# ── Stats ───────────────────────────────────────────────────────────────────


def test_rooms_stats_counts_clusters() -> None:
    rooms = {
        "A": {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]},
        "B": {"type": "poly", "points_m": [[4.5, 0], [8, 0], [8, 3]]},     # within 1m of A
        "C": {"type": "poly", "points_m": [[50, 50], [54, 50], [54, 53]]},  # far away
    }
    s = ft.rooms_stats(rooms)
    assert s["rooms"] == 3 and s["clusters"] == 2
    assert s["bbox_w_m"] == pytest.approx(54.0, abs=0.1)


# ── commit_floor with source="stack" ────────────────────────────────────────


def _fabric() -> FabricStore:
    fab = FabricStore.__new__(FabricStore)
    fab.hass = MagicMock()
    fab.store = AsyncMock()
    fab.store.async_save = AsyncMock()
    fab.data = {"floors": {}, "history": []}
    return fab


@pytest.mark.asyncio
async def test_commit_floor_stack_source() -> None:
    bounds = {"Laundry": {"type": "poly", "points": [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]]}}
    ms = MagicMock()
    ms.data = {"maps": [_master(), _sibling(bounds)]}
    mdl = _model({**_MEASURED, **_FABRICATED_SIBLING})
    fab = _fabric()
    res = await fab.async_commit_floor("main", ms, mdl, source="stack")
    assert res["ok"] is True and res["source"] == "stack"
    room = fab.rooms_flat()["Laundry"]
    assert room["source_map_id"] == "sibling"
    # Placed at true (master-anchored) scale: x span = 0.2 * 10.0364
    xs = [p[0] for p in room["points_m"]]
    assert max(xs) - min(xs) == pytest.approx(2.007, abs=0.02)


@pytest.mark.asyncio
async def test_commit_floor_stack_refuses_without_anchor() -> None:
    ms = MagicMock()
    ms.data = {"maps": [_sibling({"L": {"type": "poly", "points": [[0, 0], [1, 0], [1, 1]]}})]}
    mdl = _model(dict(_FABRICATED_SIBLING))     # nothing measured anywhere
    fab = _fabric()
    res = await fab.async_commit_floor("main", ms, mdl, source="stack")
    assert res == {"ok": False, "error": "no_metre_anchor", "floor_id": "main"}
