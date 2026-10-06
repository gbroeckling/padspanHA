# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard's heights onto the placement records.

house3d_heights.async_move_heights, on Garry's word (2026-10-05: "same
information store"): a height Live Aboard's file holds for a placed device
whose record has none decided is copied onto the record (a record that has a
height, or Default chosen, keeps it), one fabric write, read back from disk,
after a safety backup the first time. Live Aboard's file is never stripped:
an older PadSpan (rolled back to) still reads its heights there. A device
with no record keeps its height in the file. Idempotent, logged, safe across
a restart, and nothing at all while Live Aboard is off.
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
from tests.test_house3d_store import _capture_backups, _house, _run

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
    "light.hall_sconce": {"x_m": 6.0, "y_m": 0.2, "floor_id": "main"},
    "sensor.lounge_temperature": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"},
}
_FABRIC = {"floors": {}, "history": [], "scanner_positions_m": {"aa:01": {"x_m": 1, "y_m": 1, "z_m": 2.2, "floor_id": "main"}},
           "beacon_positions_m": {}, "rf_barriers_m": [], "light_positions_m": _RECORDS,
           "light_heights_m": {"light.hall_sconce": 2.4}}       # the sconce's height already on its record


@pytest.fixture
def house(disk, monkeypatch, tmp_path):
    """Live Aboard on at Pro, its file on disk, and a real fabric on disk."""
    monkeypatch.setattr(FS, "Store", _DiskStore)
    _seed(tmp_path, copy.deepcopy(_FILE))
    _seed(tmp_path, copy.deepcopy(_FABRIC), FABRIC_STORE_KEY)
    return _boot(tmp_path)


@pytest.fixture
def backups(monkeypatch):
    return _capture_backups(monkeypatch)


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


def _heights(tmp_path: Path) -> dict:
    return _disk(tmp_path, FABRIC_STORE_KEY).get("light_heights_m", {})


def test_heights_are_copied_onto_the_records_and_the_file_keeps_its_own(house, disk, backups, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    got = _run(M.async_move_heights(house))
    assert got == {"copied": 2}
    assert _heights(tmp_path) == {"light.hall_sconce": 2.4, "light.island_pendant": 1.6, "sensor.lounge_temperature": 1.2}, \
        "a record that has a height keeps it: the record wins"
    assert _disk(tmp_path, FABRIC_STORE_KEY)["light_positions_m"] == _RECORDS, "x, y, floor and looks exactly as they were"
    mdl = house.data[DOMAIN][DATA_MODEL]
    assert mdl.light_positions_m()["light.island_pendant"]["z_m"] == 1.6
    assert _disk(tmp_path) == _FILE, "Live Aboard's file is never stripped: an older PadSpan still reads its heights"
    assert disk.writes == [FABRIC_STORE_KEY], "one write: the records"
    assert _disk(tmp_path, FABRIC_STORE_KEY)["scanner_positions_m"]["aa:01"]["z_m"] == 2.2, "scanners untouched"
    assert _disk(tmp_path, FABRIC_STORE_KEY)["history"][-1]["op"] == "migration:house3d_heights"
    assert any("onto their placement records" in r.getMessage() for r in caplog.records), "logged"


def test_a_safety_backup_comes_before_the_first_write_and_holds_the_records_as_they_were(house, disk, backups, tmp_path):
    _run(M.async_move_heights(house))
    assert len(backups["backups"]) == 1
    bk = backups["backups"][0]
    assert set(bk["stores"]) == {FABRIC_STORE_KEY} and bk.get("auto")
    assert bk["stores"][FABRIC_STORE_KEY]["light_heights_m"] == {"light.hall_sconce": 2.4}, "taken before the write"
    assert "Live Aboard" in bk["note"]


def test_no_backup_no_move(house, disk, monkeypatch, tmp_path):
    from custom_components.padspan_ha import ws_backup

    async def _none(*_a, **_k):
        return None
    monkeypatch.setattr(ws_backup, "_auto_backup", _none)
    assert _run(M.async_move_heights(house)) == {"copied": 0}
    assert disk.writes == [] and _heights(tmp_path) == {"light.hall_sconce": 2.4}


def test_a_second_run_finds_nothing_to_do_and_writes_nothing(house, disk, backups, tmp_path):
    _run(M.async_move_heights(house))
    before = (_disk(tmp_path), _disk(tmp_path, FABRIC_STORE_KEY))
    disk.writes.clear()
    assert _run(M.async_move_heights(house)) == {"copied": 0}
    assert _run(M.async_move_heights(_boot(tmp_path))) == {"copied": 0}, "after a restart too"
    assert disk.writes == [] and (_disk(tmp_path), _disk(tmp_path, FABRIC_STORE_KEY)) == before
    assert len(backups["backups"]) == 1


def test_default_chosen_after_the_move_is_never_undone(house, disk, backups, tmp_path):
    """Review finding 7: Default (null) is a decided height; the file's copy
    never comes back over it."""
    _run(M.async_move_heights(house))
    mdl = house.data[DOMAIN][DATA_MODEL]
    assert _run(mdl.async_set_light_heights({"light.island_pendant": None})) == []
    assert _run(M.async_move_heights(_boot(tmp_path))) == {"copied": 0}
    assert _heights(tmp_path)["light.island_pendant"] is None
    assert house.data[DOMAIN][DATA_MODEL].light_positions_m()["light.island_pendant"]["z_m"] is None


def test_a_device_placed_after_the_move_is_copied_at_the_next_start_with_no_new_backup(house, disk, backups, tmp_path):
    _run(M.async_move_heights(house))
    fab = house.data[DOMAIN][DATA_FABRIC]
    _run(fab.async_spatial_update(set_lights={"light.unplaced_lamp": {"x_m": 2.0, "y_m": 2.0, "floor_id": "main"}}))
    assert _run(M.async_move_heights(_boot(tmp_path))) == {"copied": 1}
    assert _heights(tmp_path)["light.unplaced_lamp"] == 0.75
    assert len(backups["backups"]) == 1, "only the first move takes a backup"


def test_a_fabric_only_restore_of_an_older_backup_gets_its_heights_back(house, disk, backups, tmp_path):
    """Review finding 5: the file still has them, so the next start copies
    them again onto the restored records."""
    _run(M.async_move_heights(house))
    _seed(tmp_path, copy.deepcopy(_FABRIC), FABRIC_STORE_KEY)             # the restore: records as before the move
    assert _run(M.async_move_heights(_boot(tmp_path))) == {"copied": 2}
    assert _heights(tmp_path)["light.island_pendant"] == 1.6


def test_a_record_that_could_not_be_saved_is_tried_again(house, disk, backups, tmp_path):
    disk.fail = ["swallowed"]                 # the fabric's write is lost
    assert _run(M.async_move_heights(house)) == {"copied": 0}
    assert _heights(tmp_path) == {"light.hall_sconce": 2.4}
    assert _run(M.async_move_heights(_boot(tmp_path))) == {"copied": 2}, "a later start moves them"


@pytest.mark.parametrize("why", ["off", "below_pro", "no_file", "newer"])
def test_off_below_pro_no_file_or_a_newer_file_nothing_is_read_or_written(house, disk, backups, tmp_path, why):
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
    assert _run(M.async_move_heights(house)) == {"copied": 0}
    assert disk.writes == [] and _disk(tmp_path, FABRIC_STORE_KEY) == before and backups["backups"] == []
    if why in ("off", "below_pro", "no_file"):
        assert DATA_HOUSE3D not in house.data[DOMAIN], "not even read"


def test_an_unreadable_file_is_left_alone(house, disk, backups, tmp_path):
    _file(tmp_path).write_text("{not json", encoding="utf-8")
    assert _run(M.async_move_heights(house)) == {"copied": 0}
    assert disk.writes == []


def test_the_plan_takes_only_heights_of_placed_devices_not_yet_decided():
    copy_in = M.plan({"lights": {"light.a": {"z_m": "high"}, "light.b": {"kind": "pot"}, "light.e": {"z_m": 2.0}},
                      "devices": {"light.c": {"z_m": 1.0}, "lock.d": {"z_m": 1.0}}},
                     {"light.a": {"x_m": 0}, "light.b": {"x_m": 0}, "light.c": {"x_m": 0}, "light.e": {"x_m": 0}},
                     {"light.e": None})
    assert copy_in == {"light.c": 1.0}, "e: Default decided; d: no record; a: not a height"


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
