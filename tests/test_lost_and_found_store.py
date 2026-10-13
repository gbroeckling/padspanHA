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
    store.store.async_delay_save = MagicMock()
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
async def test_record_persists_to_the_backing_store_coalesced_not_inline():
    store = _make_store()
    await store.record("ble:AA", "Kitchen")
    store.store.async_delay_save.assert_called_once()
    assert store.store.async_delay_save.call_args[0][0]() is store.records
    store.store.async_save.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_same_room_again_is_not_a_new_record_and_writes_nothing():
    """ws_live_snapshot sees every away object on every poll (a fresh copy
    of the shared snapshot each time). Re-recording the same room rewrote the
    whole file per object per poll, and live_snapshot never answered."""
    store = _make_store()
    await store.record("ble:AA", "Kitchen", label="Keys")
    ts = store.get_all()["ble:AA"]["ts"]
    store.store.async_delay_save.reset_mock()
    for _ in range(50):
        await store.record("ble:AA", "Kitchen", label="Keys")
    store.store.async_delay_save.assert_not_called()
    assert store.get_all()["ble:AA"]["ts"] == ts, "an unchanged room keeps its time"
    await store.record("ble:AA", "Garage", label="Keys")
    store.store.async_delay_save.assert_called_once()


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
    store.store.async_delay_save.assert_not_called()


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


@pytest.mark.asyncio
async def test_leaving_the_same_room_again_later_is_a_new_record_with_its_own_time():
    """Monday it left the Kitchen; it came back and left the Kitchen again on
    Wednesday. "Last seen in the Kitchen" must say Wednesday, not Monday."""
    store = _make_store()
    monday, wednesday = 1_790_000_000.0, 1_790_172_800.0
    await store.record("ble:AA", "Kitchen", seen_at=monday)
    for _ in range(5):                                   # the same departure, every poll
        await store.record("ble:AA", "Kitchen", seen_at=monday + 3)
    assert store.get_all()["ble:AA"]["ts"] == monday
    store.store.async_delay_save.reset_mock()
    await store.record("ble:AA", "Kitchen", seen_at=wednesday)
    assert store.get_all()["ble:AA"]["ts"] == wednesday
    store.store.async_delay_save.assert_called_once()


def test_a_backup_carries_lost_and_found_and_a_restore_takes_it_back():
    """The store exists so a last-seen room "never resets to Unknown" — and a
    restore reset all of it: it was never in a backup. Its live data is
    `records`, which the backup reads; the restore joins the backup's into the
    running store (async_merge), so the next save can't put the old ones back
    and a record made since the backup isn't lost."""
    import inspect
    from custom_components.padspan_ha import ws_backup
    from custom_components.padspan_ha.const import DATA_LOST_AND_FOUND, LOST_AND_FOUND_STORE_KEY
    from custom_components.padspan_ha.ws_common import _ALL_STORE_KEYS, _DATA_KEY_MAP
    assert LOST_AND_FOUND_STORE_KEY in _ALL_STORE_KEYS
    assert _DATA_KEY_MAP[LOST_AND_FOUND_STORE_KEY] == DATA_LOST_AND_FOUND
    src = inspect.getsource(ws_backup)
    assert "stores_data[store_key] = store_obj.records" in src
    assert "await lf_obj.async_merge(data)" in src


@pytest.mark.asyncio
async def test_a_restore_keeps_the_newer_record_per_object_and_saves_what_it_holds():
    store = _make_store()
    store.records = {"ble:TAG": {"room": "Garage", "ts": 300.0},
                     "ble:KEYS": {"room": "Hall", "ts": 300.0},
                     "ble:PHONE": {"room": "Office", "ts": 150.0}}
    await store.async_merge({"ble:KEYS": {"room": "Kitchen", "ts": 100.0},
                             "ble:PHONE": {"room": "Lounge", "ts": 200.0},
                             "ble:WALLET": {"room": "Bedroom", "ts": 100.0}})
    assert {k: v["room"] for k, v in store.get_all().items()} == {
        "ble:TAG": "Garage", "ble:KEYS": "Hall", "ble:PHONE": "Lounge", "ble:WALLET": "Bedroom"}
    store.store.async_save.assert_awaited_once_with(store.records)


async def test_a_record_for_someones_device_survives_the_startup_prune(tmp_path):
    """The once-per-start prune judged records by whether the device was still
    heard, so an HA-linked tag away for two days lost its record at restart.
    Records are marked when made; only unmarked (pre-0.38.106 stranger)
    records are judged."""
    import time as _t
    from unittest.mock import MagicMock
    from tests.conftest import MockHass
    from custom_components.padspan_ha.lost_and_found_store import LostAndFoundStore
    lf = LostAndFoundStore(MockHass(tmp_path))
    lf.store = MagicMock()
    await lf.record("ble:AA:BB:CC:DD:EE:02", "Garage", label="Suitcase tag", seen_at=_t.time() - 2 * 86400)
    lf.records["ble:AA:BB:CC:DD:EE:09"] = {"room": "Street", "ts": 1.0}     # an old stranger
    from custom_components.padspan_ha.snapshot_builder import _prune_lost_and_found_strangers
    from custom_components.padspan_ha.const import DOMAIN, DATA_DEVICE_REGISTRY, DATA_OBJECTS, DATA_SETTINGS
    from types import SimpleNamespace
    dev_reg = MagicMock(); dev_reg.get_label_by_key.return_value = None
    dev_reg.get.return_value = None; dev_reg.resolve.return_value = None
    obj_store = MagicMock(); obj_store.get_label.return_value = None
    hass = SimpleNamespace(data={DOMAIN: {DATA_DEVICE_REGISTRY: dev_reg, DATA_OBJECTS: obj_store,
                                          DATA_SETTINGS: SimpleNamespace(data={"followed_addrs": []})}})
    _prune_lost_and_found_strangers(hass, lf, [])
    assert list(lf.records) == ["ble:AA:BB:CC:DD:EE:02"]


def test_a_followed_unlabelled_device_is_recorded():
    """The Follow button needs no label; the snapshot passed identified=
    obj_is_identified(obj) alone, so a followed device was never recorded."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "snapshot_builder.py").read_text(encoding="utf-8")
    assert 'or str(_obj.get("address") or "").upper() in _lf_followed' in src
