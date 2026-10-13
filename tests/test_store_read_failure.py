# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A store file that cannot be READ (an I/O error, a file it cannot open) is
not a first boot. SafeStore turned the error into None, and each core store
saved its defaults over the real file: one bad read at startup lost the
rooms, positions, walls, floors, maps, settings (licence key, followed
devices, IRKs) and, at the next auto point, calibration. It raises now, the
store stays unloaded for this run, and the file is left untouched. And one
store failing no longer drops every other store loaded with it."""
import pytest
import asyncio
from unittest.mock import MagicMock

import asyncio
from pathlib import Path
from unittest.mock import MagicMock
from custom_components.padspan_ha.safe_store import SafeStore


class DiskStore:
    def __init__(self, data):
        self.on_disk = data
        self.fail_reads = 1
        self.saves = []
    async def async_load(self):
        if self.fail_reads:
            self.fail_reads -= 1
            raise OSError("[Errno 5] Input/output error")
        return self.on_disk
    async def async_save(self, data):
        self.saves.append(data)
        self.on_disk = data


def _hass(tmp_path):
    h = MagicMock()
    h.config.path = lambda *p: str(Path(tmp_path).joinpath(*p))
    h.data = {}
    async def ex(f, *a): return f(*a)
    h.async_add_executor_job = ex
    return h


def _mk(modname, cls, disk, hass, monkeypatch):
    import importlib
    mod = importlib.import_module("custom_components.padspan_ha." + modname)
    monkeypatch.setattr(mod, "Store", lambda *a, **k: disk)
    return getattr(mod, cls)(hass)


def test_fabric(tmp_path, monkeypatch):
    from custom_components.padspan_ha.fabric_store import FabricStore
    hass = _hass(tmp_path)
    good = {"floors": {"main": {"rooms": {"Kitchen": {"type": "poly"}}}},
            "scanner_positions_m": {"aa": {"x_m": 1, "y_m": 2, "z_m": 1, "floor_id": "main"}},
            "beacon_positions_m": {}, "rf_barriers_m": [], "light_positions_m": {"light.k": {"x_m": 1, "y_m": 1}},
            "history": [], "migrations_done": ["fabric_photo_divorce"]}
    disk = DiskStore(good)
    fab = _mk('fabric_store', 'FabricStore', disk, hass, monkeypatch)
    with pytest.raises(OSError):
        asyncio.run(fab.async_setup(legacy_geometry={}, legacy_spatial={}))
    assert disk.on_disk is good, "fabric file overwritten after a read error"


def test_model(tmp_path, monkeypatch):
    from custom_components.padspan_ha.model_store import ModelStore
    hass = _hass(tmp_path)
    good = {"floors": [{"id": "main", "name": "Main"}, {"id": "up", "name": "Upstairs", "level": 1}],
            "room_meta": {"Kitchen": {"floor_id": "main", "color": "#123456"}},
            "map_transforms": {"m1": {"origin_x_m": 0, "origin_y_m": 0, "scale_x_m": 0.01, "scale_y_m": 0.01, "origin_anchored": True}},
            "world_gauge": {"m_per_unit": 0.05, "source_map_id": "m1"}}
    disk = DiskStore(good)
    mdl = _mk('model_store', 'ModelStore', disk, hass, monkeypatch)
    with pytest.raises(OSError):
        asyncio.run(mdl.async_setup())
    assert disk.on_disk is good, "model file overwritten after a read error"


def test_maps(tmp_path, monkeypatch):
    from custom_components.padspan_ha.maps_store import MapsStore
    hass = _hass(tmp_path)
    good = {"maps": [{"id": "m1", "name": "Ground", "receivers": [], "beacons": []}]}
    disk = DiskStore(good)
    ms = _mk('maps_store', 'MapsStore', disk, hass, monkeypatch)
    with pytest.raises(OSError):
        asyncio.run(ms.async_setup())
    assert disk.on_disk is good, "maps file overwritten after a read error"


def test_settings(tmp_path, monkeypatch):
    from custom_components.padspan_ha.settings_store import SettingsStore
    hass = _hass(tmp_path)
    good = {"license_key": "PAID-KEY", "followed_addrs": ["AA:BB"], "data_mode": "live", "first_seen_ts": 1.0,
            "atlas_default_v1_applied": True}
    disk = DiskStore(good)
    st = _mk('settings_store', 'SettingsStore', disk, hass, monkeypatch)
    with pytest.raises(OSError):
        asyncio.run(st.async_load())
    assert disk.on_disk is good, "settings file overwritten after a read error"


def test_calibration_next_point(tmp_path, monkeypatch):
    from custom_components.padspan_ha.calibration_store import CalibrationStore
    hass = _hass(tmp_path)
    good = {"points": [{"id": f"cp_{i}", "x_m": i, "y_m": 1.0, "floor_id": "main", "room": "Kitchen",
                        "scanner_readings": [{"source": "a", "mean_rssi": -60, "sample_count": 20}]} for i in range(40)],
            "model": {}}
    disk = DiskStore(good)
    cal = _mk('calibration_store', 'CalibrationStore', disk, hass, monkeypatch)
    with pytest.raises(OSError):
        asyncio.run(cal.async_setup_fast())
    samples = [-60.0] * 20
    try:
        asyncio.run(cal.async_add_point({"x_m": 1.0, "y_m": 2.0, "floor_id": "main", "room": "Hall",
            "scanner_readings": [{"source": "a", "rssi_samples": samples}, {"source": "b", "rssi_samples": samples}]}))
    except Exception as e:
        assert len(disk.on_disk["points"]) >= 40, "40 calibration points lost"


import custom_components.padspan_ha as pkg  # noqa: E402
from custom_components.padspan_ha import const as C  # noqa: E402


class FakeObj:
    def __init__(self, hass): pass
    async def async_load(self): pass
    def all(self): return {"AA:BB": {"label": "Phone"}}


class FailingMovement:
    def __init__(self, hass): self.entries = []
    async def async_load(self): raise OSError("[Errno 5] Input/output error")


def test_one_failing_deferred_store_drops_the_rest(monkeypatch):
    hass = MagicMock()
    keep = [C.DATA_SETTINGS, C.DATA_MAPS, C.DATA_MODEL, C.DATA_ALERTS, C.DATA_LOST_AND_FOUND,
            C.DATA_FORENSICS, C.DATA_CAPTURE, C.DATA_ADAPTIVE, C.DATA_CALIBRATION, C.DATA_TRACEBACK,
            C.DATA_TAG_INTEGRATION, C.DATA_WLED_LOOKS]
    hass.data = {C.DOMAIN: {k: MagicMock() for k in keep}}
    monkeypatch.setattr(pkg, "ObjectStore", FakeObj)
    monkeypatch.setattr(pkg, "MovementStore", FailingMovement)
    asyncio.run(pkg._ensure_deferred_stores(hass))
    dom = hass.data[C.DOMAIN]
    assert C.DATA_OBJECTS in dom, "ObjectStore (labels) dropped because MovementStore failed"
