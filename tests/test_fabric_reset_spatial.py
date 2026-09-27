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
    assert mdl.data["map_transforms"] == {"m1": {"scale": 1}, "m2": {"scale": 2}}, (
        "map placements were wiped")
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


# ── The backup the reset takes, through the real _auto_backup ───────────────

import json  # noqa: E402

from custom_components.padspan_ha.const import BACKUPS_STORE_KEY  # noqa: E402
from custom_components.padspan_ha.ws_backup import ws_store_backup_create  # noqa: E402


class _DiskStore:
    """HA's Store as far as backups need it: serialised at save, and a write
    that fails is logged and swallowed (helpers/storage.py
    _async_handle_write_data), never raised."""

    files: dict[str, str] = {}
    unwritable: set[str] = set()

    def __init__(self, hass, version, key):
        self._key = key

    async def async_load(self):
        raw = _DiskStore.files.get(self._key)
        return json.loads(raw) if raw is not None else None

    async def async_save(self, data):
        if self._key in _DiskStore.unwritable:
            return   # "Error writing config for ..." and carry on
        _DiskStore.files[self._key] = json.dumps(data)


def _manual(n: int) -> dict:
    return {"id": f"bk_manual{n}", "created_at": f"2026-0{n}-01T00:00:00+00:00",
            "version": "0.38.48", "note": f"mine {n}", "stores": {"padspan_ha.settings": {}},
            "map_images": {"plan.png": "AAAA"}}


def _real_backups(monkeypatch, existing: list[dict]) -> None:
    import homeassistant.helpers.storage as _hs
    _DiskStore.files = {BACKUPS_STORE_KEY: json.dumps({"backups": existing})}
    _DiskStore.unwritable = set()
    monkeypatch.setattr(_hs, "Store", _DiskStore, raising=False)


def _on_disk() -> list[dict]:
    return json.loads(_DiskStore.files[BACKUPS_STORE_KEY])["backups"]


def _replace_positions(fab) -> None:
    fab.data["scanner_positions_m"] = {"AA:02": {"x_m": 3, "y_m": 3, "z_m": 1, "floor_id": "main"}}


async def test_nothing_to_clear_takes_no_backup(monkeypatch) -> None:
    """Pressing Reset again after a reset found nothing and still took a
    backup; each one pushed an older backup out of the list."""
    hass, fab, _mdl, _cal = _setup()
    fab.data["scanner_positions_m"] = {}
    fab.data["beacon_positions_m"] = {}
    fab.data["rf_barriers_m"] = []
    seen = _backup_ok(monkeypatch, fab)
    conn = MagicMock()

    await ws_fabric_reset_spatial(hass, conn, {"id": 1})

    conn.send_error.assert_not_called()
    result = conn.send_result.call_args.args[1]
    assert (result["removed"], result["backup_id"]) == (0, None)
    assert seen == {}, "a backup was taken of a fabric with nothing to clear"


async def test_repeated_resets_keep_every_backup_the_user_made(monkeypatch) -> None:
    """Three backups of the user's own, then Reset pressed four times. The
    list held 3 in total, so each automatic backup evicted the oldest entry,
    manual or not — and finally the one holding the pre-reset positions."""
    hass, fab, _mdl, _cal = _setup()
    _real_backups(monkeypatch, [_manual(1), _manual(2), _manual(3)])
    pre_scanners = json.loads(json.dumps(fab.data["scanner_positions_m"]))

    for i in range(4):
        conn = MagicMock()
        await ws_fabric_reset_spatial(hass, conn, {"id": i})
        conn.send_error.assert_not_called()

    ids = [b["id"] for b in _on_disk()]
    assert {"bk_manual1", "bk_manual2", "bk_manual3"} <= set(ids), (
        f"an automatic backup pushed out one the user made: {ids}")
    assert any((b["stores"].get("padspan_ha.fabric") or {}).get("scanner_positions_m")
               == pre_scanners for b in _on_disk()), (
        "the backup holding the positions the reset cleared is gone")


async def test_automatic_backups_have_their_own_slots(monkeypatch) -> None:
    """Five resets, each with something to clear: the last three automatic
    backups are kept, and all three of the user's."""
    hass, fab, _mdl, _cal = _setup()
    _real_backups(monkeypatch, [_manual(1), _manual(2), _manual(3)])
    taken = []
    for i in range(5):
        _replace_positions(fab)
        conn = MagicMock()
        await ws_fabric_reset_spatial(hass, conn, {"id": i})
        taken.append(conn.send_result.call_args.args[1]["backup_id"])

    ids = [b["id"] for b in _on_disk()]
    assert ids == ["bk_manual1", "bk_manual2", "bk_manual3", *taken[-3:]], ids


async def test_a_new_manual_backup_removes_only_the_oldest_manual_one(monkeypatch) -> None:
    hass, fab, _mdl, _cal = _setup()
    _real_backups(monkeypatch, [_manual(1), _manual(2), _manual(3)])
    for i in range(3):
        _replace_positions(fab)
        await ws_fabric_reset_spatial(hass, MagicMock(), {"id": i})
    autos = [b["id"] for b in _on_disk() if b.get("auto")]
    assert len(autos) == 3

    conn = MagicMock()
    await ws_store_backup_create(hass, conn, {"id": 9, "note": "mine 4"})
    new_id = conn.send_result.call_args.args[1]["backup_id"]

    ids = [b["id"] for b in _on_disk()]
    assert ids == ["bk_manual2", "bk_manual3", *autos, new_id], ids


async def test_a_backup_that_was_not_written_stops_the_reset(monkeypatch) -> None:
    """HA's Store logs a failed write (a full disk) and returns normally, so
    the reset went ahead and the toast said a backup was taken."""
    hass, fab, _mdl, _cal = _setup()
    _real_backups(monkeypatch, [_manual(1), _manual(2)])
    _DiskStore.unwritable = {BACKUPS_STORE_KEY}
    conn = MagicMock()

    await ws_fabric_reset_spatial(hass, conn, {"id": 1})

    conn.send_result.assert_not_called()
    assert conn.send_error.call_args.args[1] == "backup_failed"
    assert len(fab.data["scanner_positions_m"]) == 1
    assert len(fab.data["beacon_positions_m"]) == 1
    assert len(fab.data["rf_barriers_m"]) == 3
    fab.store.async_save.assert_not_awaited()
