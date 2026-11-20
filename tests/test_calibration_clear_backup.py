# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Clearing calibration points takes the automatic safety backup first.

Clear All (Calibration) and a map's Clear (Settings) remove points a person
walked the house to collect. Each now takes the same automatic backup the
other clearing commands take, before anything is removed; if the backup can't
be made, nothing is removed and the reply says so. Nothing to clear: no backup.
"""

from __future__ import annotations

import copy
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import ws_backup
from custom_components.padspan_ha import ws_calibration as W
from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import CALIBRATION_STORE_KEY, DATA_CALIBRATION, DOMAIN
from custom_components.padspan_ha.random_forest import RandomForestLocator

_REFUSAL = "The safety backup couldn't be made, so no calibration point was removed."


def _point(pid: str, map_id: str) -> dict:
    return {"id": pid, "map_id": map_id, "room": "Kitchen", "x_frac": 0.2, "y_frac": 0.3, "x_m": 1.0, "y_m": 2.0,
            "scanner_readings": [{"source": "s1", "name": "s1", "rssi_samples": [-60.0], "rssi_mean": -60.0}]}


def _house(points: list[dict], model: dict | None = None):
    cal = CalibrationStore.__new__(CalibrationStore)
    cal.hass = MagicMock()
    cal.store = AsyncMock()
    cal.data = {"points": list(points), "model": dict(model or {})}
    cal._rf = RandomForestLocator()
    cal._model = None
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_CALIBRATION: cal}}
    return hass, cal


_POINTS = [_point("a", "m1"), _point("b", "m1"), _point("c", "m2")]
_CLEARS = [("ws_calibration_clear", {"id": 1}, 3, []),
           ("ws_calibration_clear_map", {"id": 1, "map_id": "m1"}, 2, ["c"])]


def _backup(monkeypatch, cal, result="bk_test"):
    """Stand in for ws_backup._auto_backup; record what the store held when it was asked."""
    seen: list[dict] = []

    async def _fake(hass, note, keys):
        seen.append({"note": note, "keys": list(keys), "points": [p["id"] for p in cal.data["points"]]})
        return result

    monkeypatch.setattr(W, "_auto_backup", _fake)
    return seen


@pytest.mark.parametrize("cmd,msg,deleted,left", _CLEARS)
async def test_the_backup_is_taken_before_the_points_are_gone(monkeypatch, cmd, msg, deleted, left):
    hass, cal = _house(copy.deepcopy(_POINTS))
    seen = _backup(monkeypatch, cal)
    conn = MagicMock()
    await getattr(W, cmd)(hass, conn, msg)
    conn.send_error.assert_not_called()
    assert len(seen) == 1 and seen[0]["keys"] == [CALIBRATION_STORE_KEY]
    assert seen[0]["points"] == ["a", "b", "c"], "the backup was asked for after the points went"
    assert seen[0]["note"].startswith("Before clearing ")
    assert [p["id"] for p in cal.data["points"]] == left
    assert conn.send_result.call_args.args[1]["deleted"] == deleted


@pytest.mark.parametrize("cmd,msg,deleted,left", _CLEARS)
@pytest.mark.parametrize("failed", [None, ""])
async def test_a_backup_that_fails_refuses_the_clear_and_keeps_every_point(monkeypatch, cmd, msg, deleted, left, failed):
    hass, cal = _house(copy.deepcopy(_POINTS), {"coverage_by_map": {"m1": {"n": 2}}})
    before = copy.deepcopy(cal.data)
    _backup(monkeypatch, cal, result=failed)
    counted = []
    monkeypatch.setattr(W, "_bump", lambda _h, name, n=1: counted.append(name))
    conn = MagicMock()
    await getattr(W, cmd)(hass, conn, msg)
    conn.send_error.assert_called_once_with(1, "backup_failed", _REFUSAL)
    conn.send_result.assert_not_called()
    assert cal.data == before
    cal.store.async_save.assert_not_awaited()
    assert counted == [], "a clear that did not happen is not counted as one"


@pytest.mark.parametrize("cmd,msg,points", [("ws_calibration_clear", {"id": 1}, []),
                                            ("ws_calibration_clear_map", {"id": 1, "map_id": "m1"}, [_point("c", "m2")])])
async def test_nothing_to_clear_takes_no_backup(monkeypatch, cmd, msg, points):
    hass, cal = _house(points)
    seen = _backup(monkeypatch, cal, result=None)
    conn = MagicMock()
    await getattr(W, cmd)(hass, conn, msg)
    assert seen == []
    conn.send_error.assert_not_called()
    assert conn.send_result.call_args.args[1]["deleted"] == 0
    assert len(cal.data["points"]) == len(points)


@pytest.mark.parametrize("cmd,msg,deleted,left", _CLEARS)
async def test_the_real_backup_holds_the_points_that_were_cleared(monkeypatch, cmd, msg, deleted, left):
    # ws_backup._auto_backup itself, over a backup list kept in memory.
    disk = {"backups": []}

    async def _load(_hass):
        return copy.deepcopy(disk)

    async def _save(_hass, data):
        disk.clear()
        disk.update(copy.deepcopy(data))

    monkeypatch.setattr(ws_backup, "_load_backups", _load)
    monkeypatch.setattr(ws_backup, "_save_backups", _save)
    hass, cal = _house(copy.deepcopy(_POINTS))
    conn = MagicMock()
    await getattr(W, cmd)(hass, conn, msg)
    conn.send_error.assert_not_called()
    assert [p["id"] for p in cal.data["points"]] == left
    assert len(disk["backups"]) == 1 and disk["backups"][0]["auto"] is True
    kept = disk["backups"][0]["stores"][CALIBRATION_STORE_KEY]["points"]
    assert [p["id"] for p in kept] == ["a", "b", "c"]
