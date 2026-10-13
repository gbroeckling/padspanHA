# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A restore (and a factory reset) must reach the running stores, not only
the files: a store left holding its old data writes it back over the restored
file at its next save. Found 2026-10-12 for Forensics (.addrs), the device
registry (._devices), the object history (a plain dict), and Traceback, whose
history is its daily segment files — a restore wrote the old single file and
was gone at restart, and a factory reset left every segment."""
import time
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import device_registry as _drm
from custom_components.padspan_ha import forensics_store as _fsm
from custom_components.padspan_ha import lost_and_found_store as _lfm
from custom_components.padspan_ha import traceback_store as _tbm
from custom_components.padspan_ha import ws_backup
from custom_components.padspan_ha.const import (
    DATA_DEVICE_REGISTRY, DATA_FORENSICS, DATA_LOST_AND_FOUND, DATA_OBJECT_HISTORY, DATA_TRACEBACK, DOMAIN,
    FORENSICS_STORE_KEY, LOST_AND_FOUND_STORE_KEY, OBJECT_HISTORY_STORE_KEY, TRACEBACK_STORE_KEY,
)
from custom_components.padspan_ha.device_registry import DEVICE_REGISTRY_STORE_KEY, DeviceRegistry
from custom_components.padspan_ha.forensics_store import ForensicsStore
from custom_components.padspan_ha.lost_and_found_store import LostAndFoundStore
from custom_components.padspan_ha.traceback_store import TracebackStore
from tests.test_backup_store_locks import _restore_msg
from tests.test_house3d_store import _house, _run, store  # noqa: F401


@pytest.fixture(autouse=True)
def _patch(store, monkeypatch):
    for m in (_fsm, _drm, _tbm, _lfm):
        monkeypatch.setattr(m, "Store", store)


def test_forensics_keeps_what_was_restored(store, monkeypatch, tmp_path):
    h = _house(tmp_path)
    fs = ForensicsStore(h)
    fs.addrs = {"OLD": {"sessions": []}}
    h.data[DOMAIN][DATA_FORENSICS] = fs
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), _restore_msg(
        monkeypatch, {FORENSICS_STORE_KEY: {"addrs": {"NEW": {"sessions": []}}}})))
    assert set(fs.addrs) == {"NEW"}
    fs._dirty = True
    _run(fs.async_save_if_due(force=True))
    assert set(store.saved[FORENSICS_STORE_KEY]["addrs"]) == {"NEW"}


def test_the_device_registry_keeps_what_was_restored(store, monkeypatch, tmp_path):
    h = _house(tmp_path)
    dr = DeviceRegistry(h)
    dr._devices = {"ps_old": {"padspan_id": "ps_old", "label": "Old", "identities": []}}
    h.data[DOMAIN][DATA_DEVICE_REGISTRY] = dr
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), _restore_msg(monkeypatch, {
        DEVICE_REGISTRY_STORE_KEY: {"version": 1, "devices": {
            "ps_new": {"padspan_id": "ps_new", "label": "Keys", "identities": []}}}})))
    assert list(dr._devices) == ["ps_new"]
    dr._dirty = True
    _run(dr.async_flush_dirty())
    assert list(store.saved[DEVICE_REGISTRY_STORE_KEY]["devices"]) == ["ps_new"]


def test_the_object_history_keeps_what_was_restored(store, monkeypatch, tmp_path):
    h = _house(tmp_path)
    live = {"ble:OLD": {"key": "ble:OLD"}}
    h.data[DOMAIN][DATA_OBJECT_HISTORY] = live
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), _restore_msg(
        monkeypatch, {OBJECT_HISTORY_STORE_KEY: {"ble:NEW": {"key": "ble:NEW"}}})))
    assert h.data[DOMAIN][DATA_OBJECT_HISTORY] is live and list(live) == ["ble:NEW"]


def test_a_restored_traceback_survives_a_restart(store, monkeypatch, tmp_path):
    h = _house(tmp_path)
    tb = TracebackStore(h)
    h.data[DOMAIN][DATA_TRACEBACK] = tb
    fr = {"ts": time.time() - 60, "o": [{"k": "AA", "r": "kitchen"}]}
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), _restore_msg(monkeypatch, {TRACEBACK_STORE_KEY: [fr]})))
    tb2 = TracebackStore(h)
    _run(tb2.async_load())
    assert len(tb2.frames) == 1


def test_a_restore_joins_lost_and_found_keeping_the_newer_record(store, monkeypatch, tmp_path):
    """Monday's backup restored on Friday put every object back in its Monday
    room and dropped the only record of a tag lost on Wednesday. Each key now
    keeps its newer record, and the file and the running store agree."""
    h = _house(tmp_path)
    lf = LostAndFoundStore(h)
    lf.records = {
        "ble:TAG": {"room": "Garage", "ts": 300.0, "identified": True},     # lost since the backup
        "ble:KEYS": {"room": "Hall", "ts": 300.0, "identified": True},      # moved since
        "ble:PHONE": {"room": "Office", "ts": 150.0, "identified": True},
    }
    h.data[DOMAIN][DATA_LOST_AND_FOUND] = lf
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), _restore_msg(monkeypatch, {LOST_AND_FOUND_STORE_KEY: {
        "ble:KEYS": {"room": "Kitchen", "ts": 100.0, "identified": True},
        "ble:PHONE": {"room": "Lounge", "ts": 200.0, "identified": True},  # the backup's is newer
        "ble:WALLET": {"room": "Bedroom", "ts": 100.0, "identified": True},
    }})))
    rooms = {k: v["room"] for k, v in lf.records.items()}
    assert rooms == {"ble:TAG": "Garage", "ble:KEYS": "Hall", "ble:PHONE": "Lounge", "ble:WALLET": "Bedroom"}
    assert store.saved[LOST_AND_FOUND_STORE_KEY] == lf.records
    after_restart = LostAndFoundStore(h)
    _run(after_restart.async_load())
    assert after_restart.records == lf.records


def test_a_factory_reset_erases_the_traceback_history(store, monkeypatch, tmp_path):
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    h = _house(tmp_path)
    tb = TracebackStore(h)
    h.data[DOMAIN][DATA_TRACEBACK] = tb
    fr = {"ts": time.time() - 60, "o": [{"k": "AA", "r": "kitchen"}]}
    tb._pending = [fr]
    tb.frames = [fr]
    _run(tb.async_flush())
    _run(ws_factory_reset(h, MagicMock(), {"id": 1, "confirm": "FACTORY RESET"}))
    tb2 = TracebackStore(h)
    _run(tb2.async_load())
    assert tb2.frames == [] and tb.frames == []


def test_a_factory_reset_also_empties_the_registry_lost_and_found_and_forensics(store, monkeypatch, tmp_path):
    """The reset screen promises ALL PadSpan data and every label; the device
    registry put its labels back on every device, and Lost & Found and
    Forensics kept everything."""
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    h = _house(tmp_path)
    dr = DeviceRegistry(h)
    dr._devices = {"ps_1": {"padspan_id": "ps_1", "label": "Keys", "identities": []}}
    dr._index = {"AA:BB:CC:DD:EE:FF": "ps_1"}
    fs = ForensicsStore(h)
    fs.addrs = {"AA": {"sessions": []}}
    lf = LostAndFoundStore.__new__(LostAndFoundStore)
    lf.records = {"ble:AA": {"room": "Hall", "ts": 1.0}}
    h.data[DOMAIN].update({DATA_DEVICE_REGISTRY: dr, DATA_FORENSICS: fs, DATA_LOST_AND_FOUND: lf})
    _run(ws_factory_reset(h, MagicMock(), {"id": 1, "confirm": "FACTORY RESET"}))
    assert dr._devices == {} and dr._index == {} and dr.get_label_by_key("AA:BB:CC:DD:EE:FF") is None
    assert fs.addrs == {} and lf.records == {}
    assert store.saved[DEVICE_REGISTRY_STORE_KEY] == {"version": 1, "devices": {}}
    assert store.saved[LOST_AND_FOUND_STORE_KEY] == {} and store.saved[FORENSICS_STORE_KEY] == {"addrs": {}}
