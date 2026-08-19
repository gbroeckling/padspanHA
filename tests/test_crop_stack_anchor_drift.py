# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Cropping a map must not move the metre anchor (issue #62, rjbutler).

The invariant under test is a physical one: **cropping a photograph does not
change how many metres a world unit is.** The house did not move; only the
picture got smaller. So `find_metre_anchor` must return the same
`m_per_world_x` / `m_per_world_y` before and after a trim.

It does not today. `async_recompute_transform_for_map(crop=...)` rewrites the
map's METRIC record (`scale_x_m` / `scale_y_m` shrink by the retained
fraction, and the origin shifts by the cut-off margin) but nothing rewrites the
map's STACK, which is what says how much world space that image spans. The
anchor divides one by the other:

    m_per_world_x = scale_x_m / (stack.scale * stack.scale_x_adj)
    m_per_world_y = scale_y_m / (stack.scale * ref_ar)

so the numerator shrinks and the denominator does not.

Worse, a trim rarely removes the same fraction from both axes, so the two
scales stop agreeing with each other — which is why it reads as bad scaling
rather than a clean offset.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.model_store import ModelStore


# A well-formed measured map: 1600x1200 px covering 80 m x 60 m at 20 px/m.
# Its stack spans the full image across 1.0 world unit in x and ref_ar = 0.75
# in y, so both axes agree at 80 m per world unit and iso_error is 0.
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


def _map(width: int, height: int) -> dict:
    return {
        "id": "m1",
        "floor_id": "main",
        "image": {"width": width, "height": height},
        # ref_ar 0.75 == 1200/1600: the stack agrees with the untrimmed image.
        "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
                  "rotation": 0, "x_offset": 0, "y_offset": 0, "is_master": True},
        "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
    }


def test_untrimmed_map_anchor_is_self_consistent() -> None:
    """Control: before any crop the two axis scales agree exactly."""
    store = _store()
    anchor = fabric_truth.find_metre_anchor([_map(1600, 1200)], store)
    assert anchor is not None
    assert anchor["m_per_world_x"] == pytest.approx(80.0)
    assert anchor["m_per_world_y"] == pytest.approx(80.0)
    assert anchor["iso_error"] == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_symmetric_crop_does_not_move_the_anchor() -> None:
    """Cropping half off both axes must not rescale the world.

    Both axes shrink together here, so the map still looks self-consistent
    (iso_error stays 0) — but every fabric metre now converts into twice as
    much world space, so every room is drawn at double size.
    """
    store = _store()
    before = fabric_truth.find_metre_anchor([_map(1600, 1200)], store)

    # One dict throughout: the crop rewrites map["stack"] in place, exactly as
    # it does on the live map the maps store then persists.
    cropped = _map(800, 600)
    await store.async_recompute_transform_for_map(
        "m1", cropped, MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5},
    )
    after = fabric_truth.find_metre_anchor([cropped], store)

    assert after["m_per_world_x"] == pytest.approx(before["m_per_world_x"]), (
        "cropping the photo rescaled the world in x: "
        f"{before['m_per_world_x']} -> {after['m_per_world_x']} m per world unit"
    )
    assert after["m_per_world_y"] == pytest.approx(before["m_per_world_y"])


@pytest.mark.asyncio
async def test_anisotropic_crop_does_not_skew_the_anchor() -> None:
    """Trimming more off one axis than the other must not skew the world.

    This is rjbutler's case. Half the width removed, full height kept: the two
    axis scales stop agreeing, so the fabric is drawn through a scale that
    describes neither dimension of the picture it lands on. Rooms come out
    stretched on one axis only — "the previously drawn rooms are now
    incorrect", and an edge room (his garage) falls outside the drawn floor.
    """
    store = _store()
    before = fabric_truth.find_metre_anchor([_map(1600, 1200)], store)

    cropped = _map(800, 1200)
    await store.async_recompute_transform_for_map(
        "m1", cropped, MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 1.0},
    )
    after = fabric_truth.find_metre_anchor([cropped], store)

    assert after["iso_error"] == pytest.approx(before["iso_error"], abs=1e-6), (
        "the two axis scales stopped agreeing after a crop: iso_error "
        f"{before['iso_error']} -> {after['iso_error']}"
    )
    assert after["m_per_world_x"] == pytest.approx(before["m_per_world_x"])
    assert after["m_per_world_y"] == pytest.approx(before["m_per_world_y"])


# ── The shipped guard ────────────────────────────────────────────────────────
# It does not repair a trimmed map. It stops one anchoring the whole house,
# which is what made an untrimmed floor render wrong in rjbutler's install.

def _clean_map(map_id: str) -> dict:
    m = _map(1600, 1200)
    m["id"] = map_id
    return m


def _trimmed_map(map_id: str) -> dict:
    """Half the width cut off: image and metric extent moved, stack did not."""
    m = _map(800, 1200)
    m["id"] = map_id
    return m


_TRIMMED_T = {**_MEASURED, "scale_x_m": 40.0, "scale_y_m": 60.0}


def test_anchor_prefers_a_self_consistent_map_over_a_trimmed_one() -> None:
    """A trimmed map listed first must not anchor the house."""
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.data = {"map_transforms": {"trimmed": dict(_TRIMMED_T),
                                     "clean": dict(_MEASURED)}}

    anchor = fabric_truth.find_metre_anchor(
        [_trimmed_map("trimmed"), _clean_map("clean")], store)

    assert anchor["map_id"] == "clean", (
        "the skewed map anchored the house; every floor inherits its error"
    )
    assert anchor["iso_error"] == pytest.approx(0.0)
    assert not anchor.get("degraded")


def test_anchor_falls_back_to_least_skewed_when_nothing_is_clean() -> None:
    """No consistent map: keep working, but say so rather than silently skew."""
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.data = {"map_transforms": {"trimmed": dict(_TRIMMED_T)}}

    anchor = fabric_truth.find_metre_anchor([_trimmed_map("trimmed")], store)

    assert anchor is not None, "must not strand an install with one trimmed map"
    assert anchor["map_id"] == "trimmed"
    assert anchor["degraded"] is True


def test_offset_crop_keeps_the_map_where_it_was() -> None:
    """A crop taken off-centre must not slide the map through world space.

    Scale alone is not enough: the retained rectangle's centre is no longer the
    old image's centre, so the stack's offsets have to absorb the difference.
    A point of the house that survived the cut must land on the same world
    coordinate before and after.
    """
    from custom_components.padspan_ha.maps_store import MapsStore

    stk_old = _map(1600, 1200)["stack"]
    fx0, fy0, fw, fh = 0.25, 0.10, 0.50, 0.40

    # A feature at frac (0.5, 0.3) of the OLD image...
    px_old, py_old = 0.5, 0.3
    world_before = MapsStore.map_to_world(px_old, py_old, stk_old)

    # ...is at this frac of the NEW one.
    px_new = (px_old - fx0) / fw
    py_new = (py_old - fy0) / fh
    assert 0 <= px_new <= 1 and 0 <= py_new <= 1, "test point must survive the crop"

    from custom_components.padspan_ha.model_store import _recrop_stack
    stk_new = _recrop_stack(stk_old, fx0, fy0, fw, fh)
    world_after = MapsStore.map_to_world(px_new, py_new, stk_new)

    assert world_after[0] == pytest.approx(world_before[0], abs=1e-9)
    assert world_after[1] == pytest.approx(world_before[1], abs=1e-9)


def test_recrop_stack_is_identity_for_a_full_frame_crop() -> None:
    """Cropping nothing must change nothing."""
    stk = _map(1600, 1200)["stack"]
    out = _recrop_stack_ref(stk)
    assert out["scale"] == pytest.approx(stk["scale"])
    assert out["scale_x_adj"] == pytest.approx(stk["scale_x_adj"])
    assert out["x_offset"] == pytest.approx(stk["x_offset"])
    assert out["y_offset"] == pytest.approx(stk["y_offset"])
    assert out["ref_ar"] == pytest.approx(stk["ref_ar"]), "ref_ar is the shared frame — never rescaled"


def _recrop_stack_ref(stk: dict) -> dict:
    from custom_components.padspan_ha.model_store import _recrop_stack
    return _recrop_stack(stk, 0.0, 0.0, 1.0, 1.0)
