# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Unit tests for custom_components.padspan_ha.lost_and_found_store (gap #10
of the best-in-class roadmap, docs/BEST_IN_CLASS_ROADMAP.md).

The one property that matters: this store NEVER evicts a record on its own
(no age prune, no count cap) — that is the whole reason it exists instead
of reusing movement_store.py's MovementStore, which has both.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.lost_and_found_store import LostAndFoundStore


def _make_store() -> LostAndFoundStore:
    store = LostAndFoundStore.__new__(LostAndFoundStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.records = {}
    return store


@pytest.mark.asyncio
async def test_record_stores_room_and_a_timestamp():
    store = _make_store()
    await store.record("ble:AA", "Kitchen")
    rec = store.get_all()["ble:AA"]
    assert rec["room"] == "Kitchen"
    assert isinstance(rec["ts"], float) and rec["ts"] > 0


@pytest.mark.asyncio
async def test_record_persists_to_the_backing_store():
    store = _make_store()
    await store.record("ble:AA", "Kitchen")
    store.store.async_save.assert_awaited_once_with(store.records)


@pytest.mark.asyncio
async def test_a_new_confirmation_overwrites_the_old_one_not_appends():
    store = _make_store()
    await store.record("ble:AA", "Kitchen")
    await store.record("ble:AA", "Garage")
    assert store.get_all()["ble:AA"]["room"] == "Garage"
    assert len(store.get_all()) == 1


@pytest.mark.asyncio
async def test_label_and_padspan_id_are_optional(tmp_path=None):
    store = _make_store()
    await store.record("ble:AA", "Kitchen")
    assert "label" not in store.get_all()["ble:AA"]
    assert "padspan_id" not in store.get_all()["ble:AA"]
    await store.record("ble:BB", "Garage", label="Keys", padspan_id="p1")
    rec = store.get_all()["ble:BB"]
    assert rec["label"] == "Keys" and rec["padspan_id"] == "p1"


@pytest.mark.asyncio
async def test_an_empty_key_or_room_is_a_no_op():
    store = _make_store()
    await store.record("", "Kitchen")
    await store.record("ble:AA", "")
    assert store.get_all() == {}
    store.store.async_save.assert_not_awaited()


@pytest.mark.asyncio
async def test_records_are_never_pruned_by_age_or_count():
    """The defining property: unlike MovementStore, nothing here ever
    evicts a record on its own — only explicit forget() does."""
    store = _make_store()
    for i in range(2000):
        await store.record(f"ble:{i}", "Kitchen")
    assert len(store.get_all()) == 2000


@pytest.mark.asyncio
async def test_forget_is_the_only_way_a_record_disappears():
    store = _make_store()
    await store.record("ble:AA", "Kitchen")
    await store.forget("ble:AA")
    assert "ble:AA" not in store.get_all()


@pytest.mark.asyncio
async def test_forgetting_an_unknown_key_does_not_error_or_save():
    store = _make_store()
    store.store.async_save.reset_mock()
    await store.forget("ble:never-existed")
    store.store.async_save.assert_not_awaited()


@pytest.mark.asyncio
async def test_async_load_reads_a_dict_from_the_backing_store():
    store = _make_store()
    store.store.async_load = AsyncMock(return_value={"ble:AA": {"room": "Kitchen", "ts": 1.0}})
    result = await store.async_load()
    assert result == {"ble:AA": {"room": "Kitchen", "ts": 1.0}}
    assert store.records == result


@pytest.mark.asyncio
async def test_async_load_tolerates_corrupt_or_missing_data():
    store = _make_store()
    store.store.async_load = AsyncMock(return_value=["not", "a", "dict"])
    result = await store.async_load()
    assert result == {}
    assert store.records == {}
