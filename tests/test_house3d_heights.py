# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard's heights move into the placement records, once.

house3d_heights.async_move_heights, on Garry's word (2026-10-05: "same
information store"): a height Live Aboard's file holds for a device with a
placement record is copied into that record (unless the record has one: the
record wins), then taken out of the file, the record written and read back
first, the file second, under the file's lock. A device with no record keeps
its height in the file. Idempotent, logged, safe across a restart midway,
and nothing at all while Live Aboard is off.
"""

from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import fabric_store as FS
from custom_components.padspan_ha import house3d_heights as M
from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha.const import (DATA_FABRIC, DATA_HOUSE3D, DATA_MODEL, DATA_SETTINGS, DOMAIN,
                                                FABRIC_STORE_KEY, HOUSE3D_STORE_KEY)
from custom_components.padspan_ha.model_store import ModelStore
from tests.test_house3d_edit import _DiskStore, _file, _seed, disk  # noqa: F401
from tests.test_house3d_store import _house, _run

_FILE = {
    "schema": 1,
    "lights": {"light.island_pendant": {"z_m": 1.6, "kind": "pendant"},
               "light.hall_sconce": {"z_m": 2.0},
               "light.unplaced_lamp": {"z_m": 0.75, "kind": "lamp"}},
    "devices": {"sensor.lounge_temperature": {"z_m": 1.2},
                "ble:aa:bb": {"recipe": {"kind": "tag", "params": {}, "colors": []}, "z_m": 0.9}},
    "pieces": {}, "openings": {}, "figures": {}, "library": {},
}
_RECORDS = {
    "light.island_pendant": {"x_m": 3.0, "y_m": 1.0, "floor_id": "main", "color": "#fbbf24"},
    "light.hall_sconce": {"x_m": 6.0, "y_m": 0.2, "floor_id": "main", "z_m": 2.4},
    "sensor.lounge_temperature": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"},
}


@pytest.fixture
def house(disk, monkeypatch, tmp_path):
    """Live Aboard on at Pro, its file on disk, and a real fabric on disk."""
    monkeypatch.setattr(FS, "Store", _DiskStore)
    _seed(tmp_path, copy.deepcopy(_FILE))
    _seed(tmp_path, {"floors": {}, "history": [], "scanner_positions_m": {"aa:01": {
        "x_m": 1, "y_m": 1, "z_m": 2.2, "floor_id": "main"}}, "beacon_positions_m": {}, "rf_barriers_m": [],
        "light_positions_m": copy.deepcopy(_RECORDS)}, FABRIC_STORE_KEY)
    return _boot(tmp_path)


def _boot(tmp_path: Path):
    """Home Assistant starting: the stores read from disk afresh."""
    h = _house(tmp_path, on=True)
    fab = FS.FabricStore(h)
    _run(fab.async_setup())
    _DiskStore.writes.clear()                 # its first load records where it came from
    mdl = ModelStore.__new__(ModelStore)
    mdl.data, mdl.fabric = {}, fab
    h.data[DOMAIN][DATA_MODEL] = mdl
    h.data[DOMAIN][DATA_FABRIC] = fab
    h.data[DOMAIN].pop(DATA_HOUSE3D, None)
    return h


def _disk(tmp_path: Path, key: str = HOUSE3D_STORE_KEY) -> dict:
    return json.loads(_file(tmp_path, key).read_text(encoding="utf-8"))["data"]


def _records(tmp_path: Path) -> dict:
    return _disk(tmp_path, FABRIC_STORE_KEY)["light_positions_m"]


def test_heights_move_into_the_records_and_out_of_the_file(house, disk, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    got = _run(M.async_move_heights(house))
    assert got == {"copied": 2, "removed": 3}
    rec = _records(tmp_path)
    assert rec["light.island_pendant"]["z_m"] == 1.6 and rec["sensor.lounge_temperature"]["z_m"] == 1.2
    assert rec["light.hall_sconce"]["z_m"] == 2.4, "a record that has a height keeps it: the record wins"
    for eid, r in _RECORDS.items():
        assert {k: v for k, v in rec[eid].items() if k != "z_m"} == {k: v for k, v in r.items() if k != "z_m"}, \
            "x, y, floor and looks exactly as they were"
    f = _disk(tmp_path)
    assert f["lights"]["light.island_pendant"] == {"kind": "pendant"}, "its kind stays, its height goes"
    assert "light.hall_sconce" not in f["lights"], "an entry left empty goes"
    assert f["lights"]["light.unplaced_lamp"] == {"z_m": 0.75, "kind": "lamp"}, "no record: the file keeps it"
    assert "sensor.lounge_temperature" not in f["devices"]
    assert f["devices"]["ble:aa:bb"]["z_m"] == 0.9, "a tag's look and height, not a placement record, stay"
    assert disk.writes == [FABRIC_STORE_KEY, HOUSE3D_STORE_KEY], "the record first, the file second"
    assert _disk(tmp_path, FABRIC_STORE_KEY)["scanner_positions_m"]["aa:01"]["z_m"] == 2.2, "scanners untouched"
    assert _disk(tmp_path, FABRIC_STORE_KEY)["history"][-1]["op"] == "migration:house3d_heights"
    assert any("moved into the placement records" in r.getMessage() for r in caplog.records), "logged"


def test_a_second_run_finds_nothing_to_do_and_writes_nothing(house, disk, tmp_path):
    _run(M.async_move_heights(house))
    before = (_disk(tmp_path), _disk(tmp_path, FABRIC_STORE_KEY))
    disk.writes.clear()
    assert _run(M.async_move_heights(house)) == {"copied": 0, "removed": 0}
    assert _run(M.async_move_heights(_boot(tmp_path))) == {"copied": 0, "removed": 0}, "after a restart too"
    assert disk.writes == [] and (_disk(tmp_path), _disk(tmp_path, FABRIC_STORE_KEY)) == before


def test_a_restart_between_the_record_and_the_file_finishes_the_move(house, disk, tmp_path):
    disk.fail = [None, "swallowed"]           # the record is written; the file's write is lost
    assert _run(M.async_move_heights(house)) == {"copied": 2, "removed": 0}
    assert _records(tmp_path)["light.island_pendant"]["z_m"] == 1.6
    assert _disk(tmp_path)["lights"]["light.island_pendant"]["z_m"] == 1.6, "the file still has it"
    h2 = _boot(tmp_path)
    disk.writes.clear()
    assert _run(M.async_move_heights(h2)) == {"copied": 0, "removed": 3}, "nothing copied twice"
    assert disk.writes == [HOUSE3D_STORE_KEY]
    assert _disk(tmp_path)["lights"]["light.island_pendant"] == {"kind": "pendant"}
    assert _records(tmp_path)["light.island_pendant"]["z_m"] == 1.6


def test_a_record_that_could_not_be_saved_keeps_the_heights_in_the_file(house, disk, tmp_path):
    disk.fail = ["swallowed"]                 # the fabric's write is lost
    assert _run(M.async_move_heights(house)) == {"copied": 0, "removed": 0}
    assert _disk(tmp_path) == _FILE, "the file is not touched"
    assert "z_m" not in _records(tmp_path)["light.island_pendant"]
    assert _run(M.async_move_heights(_boot(tmp_path))) == {"copied": 2, "removed": 3}, "a later start moves them"


@pytest.mark.parametrize("why", ["off", "below_pro", "no_file", "newer"])
def test_off_below_pro_no_file_or_a_newer_file_nothing_is_read_or_written(house, disk, tmp_path, why):
    st = house.data[DOMAIN][DATA_SETTINGS]
    if why == "off":
        st.data["atlas_3d_enabled"] = False
    elif why == "below_pro":
        st.data["forensics_license_key"] = ""
    elif why == "no_file":
        _file(tmp_path).unlink()
    else:
        _seed(tmp_path, {**copy.deepcopy(_FILE), "schema": 2})
    before = _disk(tmp_path, FABRIC_STORE_KEY)
    assert _run(M.async_move_heights(house)) == {"copied": 0, "removed": 0}
    assert disk.writes == [] and _disk(tmp_path, FABRIC_STORE_KEY) == before
    if why in ("off", "below_pro", "no_file"):
        assert DATA_HOUSE3D not in house.data[DOMAIN], "not even read"


def test_an_unreadable_file_is_left_alone(house, disk, tmp_path):
    _file(tmp_path).write_text("{not json", encoding="utf-8")
    assert _run(M.async_move_heights(house)) == {"copied": 0, "removed": 0}
    assert disk.writes == []


def test_the_plan_takes_only_heights_of_placed_devices():
    copy_in, strip = M.plan({"lights": {"light.a": {"z_m": "high"}, "light.b": {"kind": "pot"}},
                             "devices": {"light.c": {"z_m": 1.0}, "lock.d": {"z_m": 1.0}}},
                            {"light.a": {"x_m": 0}, "light.b": {"x_m": 0}, "light.c": {"x_m": 0}})
    assert copy_in == {"light.c": 1.0} and strip == [("devices", "light.c")]


def test_it_runs_at_start_and_when_live_aboard_is_turned_on():
    cc = Path(H.__file__).resolve().parent
    init = (cc / "__init__.py").read_text(encoding="utf-8")
    bg = init[init.index("async def _background_init"):]
    assert bg.index("async_move_heights") < bg.index("_async_start_live_feeds(hass)")
    st = (cc / "ws_settings.py").read_text(encoding="utf-8")
    hook = st[st.index("await st.async_set(**payload)"):][:500]
    assert 'msg.get("atlas_3d_enabled") is True' in hook and "async_move_heights(hass)" in hook


def test_a_settings_save_turning_live_aboard_on_starts_the_move(monkeypatch):
    """The settings hook schedules the move; the move itself decides (off,
    below Pro, no file: nothing)."""
    from custom_components.padspan_ha import ws_settings as WS
    from tests.test_house3d_store import _house as _h
    h = _h(on=False)
    started = []
    h.async_create_task = lambda coro: (started.append(coro.cr_code.co_name), coro.close())
    st = h.data[DOMAIN][DATA_SETTINGS]

    async def _set(**kw):
        st.data.update(kw)
    st.async_set = _set
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "type": "padspan_ha/settings_set", "atlas_3d_enabled": True}))
    assert "async_move_heights" in started
    started.clear()
    _run(WS.ws_settings_set(h, conn, {"id": 2, "type": "padspan_ha/settings_set", "atlas_3d_enabled": False}))
    assert "async_move_heights" not in started
