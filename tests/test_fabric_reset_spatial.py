# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Health → Reset Spatial Model, through the real handler and the real stores.

It raised TypeError on every press from v0.34.3: barriers became addressed by
id (128d493b) and FabricStore.async_spatial_update lost `remove_barrier_names`,
but the reset still passed it. Nothing was cleared, and the toast said
"Failed".

Behind that error sat a second stale step, dormant only because the TypeError
came first: the reset stripped every calibration point's metres, "to be
re-backfilled on migrate". Migrate to Metres was removed in v0.30.0, and since
then a point's metres are where a person stood, the stored truth — while the
button's own confirmation says calibration points are NOT touched.

Fixing the TypeError turned a harmless no-op into a real wipe, so the reset
now keeps map_transforms (each map's placement and measured scale: the only
record since the derived-placement conversion, nothing rebuilds it) and takes
an automatic fabric backup first; no backup, no reset.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha import ws_fabric
from custom_components.padspan_ha.const import (
    DATA_CALIBRATION,
    DATA_FABRIC,
    DATA_MODEL,
    DOMAIN,
    FABRIC_STORE_KEY,
)
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import ModelStore
from custom_components.padspan_ha.ws_fabric import ws_fabric_reset_spatial

_KITCHEN = {"type": "poly", "floor_id": "main", "revision": 1,
            "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]}


def _bar(id: str, name: str, floor_id: str) -> dict:
    return {"id": id, "name": name, "floor_id": floor_id, "material": "drywall",
            "points_m": [[0, 0], [3, 0]]}


def _setup():
    fab = FabricStore.__new__(FabricStore)
    fab.store = AsyncMock()
    fab.data = {
        "floors": {"main": {"rooms": {"Kitchen": dict(_KITCHEN)}, "committed": True}},
        "scanner_positions_m": {"AA:01": {"x_m": 1, "y_m": 1, "z_m": 1, "floor_id": "main"}},
        "beacon_positions_m": {"ibeacon:x": {"x_m": 2, "y_m": 2, "floor_id": "main"}},
        # Two "Barrier 1"s, as on the reference house: names do not identify.
        "rf_barriers_m": [_bar("bar_a", "Barrier 1", "main"),
                          _bar("bar_b", "Barrier 1", "upper"),
                          _bar("bar_c", "Barrier 2", "main")],
        "light_positions_m": {"light.hall": {"x_m": 1, "y_m": 2, "floor_id": "main"}},
        "history": [],
    }
    mdl = ModelStore.__new__(ModelStore)
    mdl.store = AsyncMock()
    mdl.data = {"map_transforms": {"m1": {"scale": 1}, "m2": {"scale": 2}}}
    cal = MagicMock()
    cal.store = AsyncMock()
    cal.data = {"points": [{"room": "Kitchen", "map_id": "m1", "x_frac": 0.2,
                            "y_frac": 0.3, "x_m": 1.25, "y_m": 2.5}]}
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_FABRIC: fab, DATA_CALIBRATION: cal}}
    return hass, fab, mdl, cal


def _backup_ok(monkeypatch, fab):
    """Stand in for ws_backup._auto_backup; record what the fabric held at
    the moment the backup was taken."""
    seen = {}

    async def _fake(hass, note, keys):
        seen["keys"] = list(keys)
        seen["scanners"] = len(fab.data["scanner_positions_m"])
        seen["barriers"] = len(fab.data["rf_barriers_m"])
        return "bk_test"

    monkeypatch.setattr(ws_fabric, "_auto_backup", _fake, raising=False)
    return seen


async def test_the_reset_clears_what_it_says(monkeypatch) -> None:
    hass, fab, _mdl, _cal = _setup()
    seen = _backup_ok(monkeypatch, fab)
    conn = MagicMock()

    await ws_fabric_reset_spatial(hass, conn, {"id": 1})

    conn.send_error.assert_not_called()
    assert fab.data["scanner_positions_m"] == {}
    assert fab.data["beacon_positions_m"] == {}
    assert fab.data["rf_barriers_m"] == [], "a barrier survived the reset"
    fab.store.async_save.assert_awaited()
    result = conn.send_result.call_args.args[1]
    # What the Health toast reads.
    assert result["removed"] == 5
    assert result["backup_id"] == "bk_test"
    # The backup was taken of the fabric, BEFORE anything was cleared.
    assert seen == {"keys": [FABRIC_STORE_KEY], "scanners": 1, "barriers": 3}


async def test_rooms_lights_placements_and_calibration_points_are_not_touched(
        monkeypatch) -> None:
    """The confirmation: "Room shapes, lights, map placements and calibration
    points are NOT touched." Map placements and calibration metres have
    nothing left to rebuild them."""
    hass, fab, mdl, cal = _setup()
    _backup_ok(monkeypatch, fab)

    await ws_fabric_reset_spatial(hass, MagicMock(), {"id": 1})

    assert fab.data["floors"]["main"]["rooms"]["Kitchen"] == _KITCHEN
    assert "light.hall" in fab.data["light_positions_m"]
    assert mdl.data["map_transforms"] == {"m1": {"scale": 1}, "m2": {"scale": 2}},         "map placements were wiped"
    mdl.store.async_save.assert_not_awaited()
    point = cal.data["points"][0]
    assert (point["x_m"], point["y_m"]) == (1.25, 2.5), "calibration metres were wiped"
    cal.store.async_save.assert_not_awaited()


async def test_no_backup_no_reset(monkeypatch) -> None:
    hass, fab, _mdl, _cal = _setup()

    async def _fail(hass, note, keys):
        return None

    monkeypatch.setattr(ws_fabric, "_auto_backup", _fail, raising=False)
    conn = MagicMock()

    await ws_fabric_reset_spatial(hass, conn, {"id": 1})

    conn.send_result.assert_not_called()
    assert conn.send_error.call_args.args[1] == "backup_failed"
    assert len(fab.data["scanner_positions_m"]) == 1
    assert len(fab.data["beacon_positions_m"]) == 1
    assert len(fab.data["rf_barriers_m"]) == 3
    fab.store.async_save.assert_not_awaited()
