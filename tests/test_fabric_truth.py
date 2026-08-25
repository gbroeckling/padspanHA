"""Unit tests for fabric_truth — the competing forms of room-layout truth.

The stack fixture numbers are taken from the LIVE Main-floor data that
motivated this module: a measured master (Electrical.jpg, 10.0364m x
14.1982m), a same-size sibling whose own calibration was fabricated at 20m
(Electrical-3), and a scaled sibling (Valance1). The hand-tuned stack
composition must reassemble them into one coherent floor, and
legacy_stack_metre_transform must recover the sibling's TRUE ~10m size — that
recovery is the "fix the alignment instead of throwing it away" repair.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth as ft
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import seed_world_gauge

AR = 1600 / 1131  # 1.41468... — the shared reference aspect ratio
M_PER_W = 10.0364


def _model(transforms: dict) -> ModelStore:
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock()
    mdl.store = AsyncMock()
    mdl.data = {"map_transforms": transforms}
    seed_world_gauge(mdl, [_master(), _sibling()])
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
    anchor = ft.measure_world_gauge([_master(), _sibling()], mdl)
    assert anchor is not None
    assert anchor["source_map_id"] == "master"
    assert anchor["m_per_unit"] == pytest.approx(10.0364, abs=1e-3)
    # ISOTROPIC is now a property of the gauge, not a measurement of it: there
    # is one scalar and `iso_error` has nothing to be the difference of. What
    # is still checkable is that the map it was taken from agrees with its own
    # picture — 14.1982 / AR == 10.0364 exactly.
    assert ft.legacy_record_iso_error(_master(), _MEASURED["master"]) < 0.001


def test_no_anchor_without_reference_measurements() -> None:
    mdl = _model(dict(_FABRICATED_SIBLING))     # fabricated scale, no refs
    assert ft.measure_world_gauge([_master(), _sibling()], mdl) is None


# ── Room composition ────────────────────────────────────────────────────────


def test_there_is_one_room_candidate_not_two() -> None:
    """`rooms_from_stack` is deleted.

    It composed the hand-tuned stack and multiplied by the gauge; the stack is
    the record divided by the gauge, so the multiplication puts it straight
    back. Two candidates that agree by construction are one candidate and a
    lie about it.
    """
    assert not hasattr(ft, "rooms_from_stack")


def test_room_precedence_is_creation_order_and_cannot_be_nulled() -> None:
    """The oldest map on a floor wins a room-name collision.

    It was `is_master`, a boolean on the stack, and `maps_store` honoured any
    `is_master` key present in a stack payload — so a view holding a stale
    copy of a map revoked the star on an ordinary save and the rooms on that
    floor silently changed shape (#67). `created` is written once by
    `async_add_map` and by nothing else.
    """
    bounds = {"Kitchen": {"type": "poly", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]}}
    mdl = _model({**_MEASURED, **_FABRICATED_SIBLING})
    older = {**_master(bounds), "created": "2020-01-01T00:00:00+00:00"}
    newer = {**_sibling(bounds), "created": "2024-06-01T00:00:00+00:00"}
    for order in ([older, newer], [newer, older]):
        rooms = ft.rooms_from_transforms(order, mdl)
        assert rooms["Kitchen"]["source_map_id"] == "master", "list order decided it"

    # And no stack write can change the answer.
    for stk in ({}, {"is_master": True}, {"is_master": False}):
        newer2 = {**newer, "stack": {**newer.get("stack", {}), **stk}}
        rooms = ft.rooms_from_transforms([older, newer2], mdl)
        assert rooms["Kitchen"]["source_map_id"] == "master"


# ── Alignment repair transform ──────────────────────────────────────────────


def test_stack_metre_transform_recovers_master_calibration() -> None:
    mdl = _model(dict(_MEASURED))
    anchor = ft.measure_world_gauge([_master()], mdl)
    t = ft.legacy_stack_metre_transform(_master(), anchor)
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
    anchor = ft.measure_world_gauge([_master(), _sibling()], mdl)
    t = ft.legacy_stack_metre_transform(_sibling(), anchor)
    assert t["scale_x_m"] == pytest.approx(10.0364, abs=0.02)
    assert t["scale_y_m"] == pytest.approx(14.1982, abs=0.02)
    assert t["origin_x_m"] == pytest.approx(0.0198 * M_PER_W, abs=0.05)
    # y origin: ar*(0.5+oy) - 0.5*ar, all times m_per_world
    expected_oy = (AR * (0.5 - 0.8056) - 0.5 * AR) * M_PER_W
    assert t["origin_y_m"] == pytest.approx(expected_oy, abs=0.05)


def test_rotated_stack_has_rotation_no_shear() -> None:
    """A rotation must be reported as rotation, never as shear.

    The tolerance is no longer exactly zero, and that is a real change rather
    than a slackened assertion. Shear used to be UNREPRESENTABLE: both axes
    were scaled by the same number, so a rotation could not produce any. Now
    each axis carries its own metres-per-world figure (issue #62), and a
    rotation composed with genuinely unequal axis scales does shear — that is
    what shear_rad exists to report.

    This fixture's own numbers are slightly anisotropic: scale_x_m 10.0364
    against scale_y_m 14.1982 over an image aspect of 1600/1131, which works
    out to 10.03636 on y. That 4e-06 relative difference is measurement
    precision in the stored transform, and at 30° it surfaces as 4e-06 rad —
    two ten-thousandths of a degree. The assertion is that no MEANINGFUL shear
    is invented, so it is bounded well below anything a map could show.
    """
    m = _master()
    m["stack"]["rotation"] = 30
    mdl = _model(dict(_MEASURED))
    anchor = ft.measure_world_gauge([_master()], mdl)
    t = ft.legacy_stack_metre_transform(m, anchor)
    assert t["rotation_rad"] == pytest.approx(0.5236, abs=1e-3)
    assert t["shear_rad"] < 1e-4, (
        "a rotation is being reported as shear: %r" % (t,))


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
