"""Unit tests for ModelStore floor elevations (issue #54 groundwork)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.model_store import (
    DEFAULT_FLOOR_TO_FLOOR_M,
    ModelStore,
)


def _make_store(floors: list[dict]) -> ModelStore:
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_save = AsyncMock()
    store.data = {"floors": list(floors), "scanner_positions_m": {}}
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
    store.data["scanner_positions_m"] = {
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
