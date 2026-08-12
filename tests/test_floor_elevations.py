"""Unit tests for ModelStore floor elevations (issue #54 groundwork)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import (
    DEFAULT_FLOOR_TO_FLOOR_M,
    ModelStore,
)


def _make_store(floors: list[dict]) -> ModelStore:
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_save = AsyncMock()
    store.data = {"floors": list(floors)}
    fab = FabricStore.__new__(FabricStore)
    fab.hass = store.hass
    fab.store = AsyncMock()
    fab.store.async_save = AsyncMock()
    fab.data = {"floors": {}, "scanner_positions_m": {},
                "beacon_positions_m": {}, "rf_barriers_m": [], "history": []}
    store.fabric = fab
    return store


# ---------------------------------------------------------------------------
# Derivation
# ---------------------------------------------------------------------------


def test_bases_run_bottom_up() -> None:
    store = _make_store([
        {"id": "ground", "name": "Ground", "level": 0, "floor_to_floor_m": 2.8},
        {"id": "first", "name": "First", "level": 1, "floor_to_floor_m": 3.0},
        {"id": "attic", "name": "Attic", "level": 2},
    ])
    bases = store.floor_base_elevations_m()
    assert bases == {"ground": 0.0, "first": 2.8, "attic": 5.8}


def test_missing_floor_to_floor_uses_default() -> None:
    store = _make_store([
        {"id": "a", "name": "A", "level": 0},
        {"id": "b", "name": "B", "level": 1},
    ])
    assert store.floor_base_elevations_m()["b"] == pytest.approx(DEFAULT_FLOOR_TO_FLOOR_M)


def test_explicit_base_rebases_stack() -> None:
    """A split-level override re-anchors everything stacked above it."""
    store = _make_store([
        {"id": "ground", "name": "G", "level": 0, "floor_to_floor_m": 2.8},
        {"id": "split", "name": "S", "level": 1, "base_elevation_m": 1.4, "floor_to_floor_m": 2.8},
        {"id": "top", "name": "T", "level": 2},
    ])
    bases = store.floor_base_elevations_m()
    assert bases["split"] == pytest.approx(1.4)
    assert bases["top"] == pytest.approx(4.2)   # 1.4 + 2.8, not 5.6


def test_level_ordering_beats_list_order() -> None:
    store = _make_store([
        {"id": "upper", "name": "U", "level": 1, "floor_to_floor_m": 3.0},
        {"id": "lower", "name": "L", "level": 0, "floor_to_floor_m": 2.5},
    ])
    bases = store.floor_base_elevations_m()
    assert bases == {"lower": 0.0, "upper": 2.5}


def test_scanner_absolute_z() -> None:
    store = _make_store([
        {"id": "ground", "name": "G", "level": 0, "floor_to_floor_m": 2.8},
        {"id": "first", "name": "F", "level": 1},
    ])
    store.fabric.data["scanner_positions_m"] = {
        "kitchen": {"x_m": 1, "y_m": 2, "z_m": 2.4, "floor_id": "ground"},
        "bedroom": {"x_m": 3, "y_m": 4, "z_m": 1.0, "floor_id": "first"},
        "lost": {"x_m": 5, "y_m": 6, "z_m": 2.0, "floor_id": "nonexistent"},
    }
    z = store.scanner_absolute_z_m()
    assert z["kitchen"] == pytest.approx(2.4)
    assert z["bedroom"] == pytest.approx(3.8)   # 2.8 base + 1.0 local
    assert z["lost"] == pytest.approx(2.0)      # unknown floor → base 0


# ---------------------------------------------------------------------------
# Upsert write path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upsert_preserves_unlisted_floors() -> None:
    store = _make_store([
        {"id": "ground", "name": "G", "floor_to_floor_m": 2.8},
        {"id": "first", "name": "F", "floor_to_floor_m": 3.0},
    ])
    await store.async_set_floor_elevations([{"id": "first", "floor_to_floor_m": 2.6}])
    by_id = {f["id"]: f for f in store.data["floors"]}
    assert by_id["first"]["floor_to_floor_m"] == pytest.approx(2.6)
    assert by_id["ground"]["floor_to_floor_m"] == pytest.approx(2.8)   # untouched


@pytest.mark.asyncio
async def test_upsert_creates_unknown_ha_floor_ids() -> None:
    """HA-registry floor ids don't exist in the ModelStore until first write."""
    store = _make_store([{"id": "main", "name": "Main Floor"}])
    await store.async_set_floor_elevations([
        {"id": "ha_basement_uuid", "level": -1, "floor_to_floor_m": 2.4},
    ])
    by_id = {f["id"]: f for f in store.data["floors"]}
    assert by_id["ha_basement_uuid"]["floor_to_floor_m"] == pytest.approx(2.4)
    assert by_id["ha_basement_uuid"]["level"] == -1
    assert "main" in by_id


@pytest.mark.asyncio
async def test_null_clears_a_field() -> None:
    store = _make_store([{"id": "ground", "name": "G", "base_elevation_m": 1.4}])
    await store.async_set_floor_elevations([{"id": "ground", "base_elevation_m": None}])
    assert "base_elevation_m" not in store.data["floors"][0]


@pytest.mark.asyncio
async def test_values_are_clamped() -> None:
    store = _make_store([{"id": "g", "name": "G"}])
    await store.async_set_floor_elevations([{"id": "g", "floor_to_floor_m": 900}])
    assert store.data["floors"][0]["floor_to_floor_m"] == pytest.approx(20.0)


@pytest.mark.asyncio
async def test_no_change_no_save() -> None:
    store = _make_store([{"id": "g", "name": "G", "floor_to_floor_m": 2.8}])
    await store.async_set_floor_elevations([{"id": "g", "floor_to_floor_m": 2.8}])
    store.store.async_save.assert_not_awaited()


# ---------------------------------------------------------------------------
# Slant→horizontal projection (presence coordinator)
# ---------------------------------------------------------------------------


def test_slant_projection() -> None:
    from custom_components.padspan_ha.presence_coordinator import _slant_to_horizontal

    assert _slant_to_horizontal(5.0, 0.0) == pytest.approx(5.0)      # 2D legacy
    assert _slant_to_horizontal(5.0, 1.4) == pytest.approx(4.8, abs=0.01)
    # Ceiling scanner directly overhead: slant 2.4, dz 2.4 → horizontally ~0
    assert _slant_to_horizontal(2.4, 2.4) == pytest.approx(0.3)
    # Noise: slant reading SHORTER than the vertical offset → floor, not NaN
    assert _slant_to_horizontal(1.0, 2.4) == pytest.approx(0.3)
    # Sign of dz is irrelevant (scanner below the device plane)
    assert _slant_to_horizontal(5.0, -1.4) == pytest.approx(4.8, abs=0.01)


def test_floor_stack_index() -> None:
    store = _make_store([
        {"id": "attic", "name": "A", "level": 2},
        {"id": "ground", "name": "G", "level": 0},
        {"id": "first", "name": "F", "level": 1},
    ])
    assert store.floor_stack_index() == {"ground": 0, "first": 1, "attic": 2}


# ---------------------------------------------------------------------------
# Scanner z ownership (z_origin manual survives syncs)
# ---------------------------------------------------------------------------


def _store_with_scanner() -> ModelStore:
    store = _make_store([{"id": "main", "name": "Main"}])
    store.fabric.data["scanner_positions_m"] = {
        "kitchen": {"x_m": 1.0, "y_m": 2.0, "z_m": 2.4, "floor_id": "main",
                    "origin": "map", "map_id": "m1"},
    }
    store.data["map_transforms"] = {
        "m1": {"origin_x_m": 0, "origin_y_m": 0, "scale_x_m": 10.0,
               "scale_y_m": 8.0, "rotation_rad": 0, "floor_id": "main"},
    }
    return store


@pytest.mark.asyncio
async def test_set_scanner_z_marks_manual() -> None:
    store = _store_with_scanner()
    ok = await store.async_set_scanner_z_m("kitchen", 1.0)
    assert ok
    entry = store.scanner_positions_m()["kitchen"]
    assert entry["z_m"] == pytest.approx(1.0)
    assert entry["z_origin"] == "manual"
    assert entry["origin"] == "map"          # x/y ownership untouched


@pytest.mark.asyncio
async def test_set_scanner_z_unknown_source() -> None:
    store = _store_with_scanner()
    assert await store.async_set_scanner_z_m("nope", 1.0) is False


@pytest.mark.asyncio
async def test_manual_z_survives_map_sync() -> None:
    """Dragging in Tune (map sync) must not reset a user-set height."""
    store = _store_with_scanner()
    await store.async_set_scanner_z_m("kitchen", 1.0)
    map_dict = {
        "floor_id": "main",
        "stack": {"ceiling_height_m": 2.6},
        "receivers": [{"id": "kitchen", "source": "kitchen", "x": 0.5, "y": 0.5}],
    }
    await store.async_sync_spatial_from_map("m1", map_dict)
    entry = store.scanner_positions_m()["kitchen"]
    assert entry["x_m"] == pytest.approx(5.0)          # drag applied
    assert entry["z_m"] == pytest.approx(1.0)          # height kept
    assert entry["z_origin"] == "manual"


@pytest.mark.asyncio
async def test_default_z_follows_ceiling_on_sync() -> None:
    """Without a manual z, a ceiling change propagates to the default."""
    store = _store_with_scanner()
    map_dict = {
        "floor_id": "main",
        "stack": {"ceiling_height_m": 2.6},
        "receivers": [{"id": "kitchen", "source": "kitchen", "x": 0.5, "y": 0.5}],
    }
    await store.async_sync_spatial_from_map("m1", map_dict)
    assert store.scanner_positions_m()["kitchen"]["z_m"] == pytest.approx(2.6)


@pytest.mark.asyncio
async def test_batch_save_preserves_existing_z() -> None:
    """The Tune batch save has no height info — it must keep the stored z."""
    store = _store_with_scanner()
    store.fabric.data["scanner_positions_m"]["kitchen"]["z_m"] = 2.6
    await store.async_batch_save_spatial(
        "m1", "main",
        scanners=[{"id": "kitchen", "source": "kitchen", "x": 0.25, "y": 0.25}],
    )
    entry = store.scanner_positions_m()["kitchen"]
    assert entry["x_m"] == pytest.approx(2.5)
    assert entry["z_m"] == pytest.approx(2.6)          # not reset to 2.4
