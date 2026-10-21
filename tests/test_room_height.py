# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A room's own height, for Live Aboard (room_meta[room].height_m).

Height was per HA floor only, so a double-height living room made every wall
on its floor rise through the floor above. A room may now carry its own
height: metres from its floor to the top of its space (the measure of a
floor's floor_to_floor_m); none means its floor's, exactly as before. Held
here:
- the value: a finite number, kept 1.5 m to MAX_HEIGHT_M; anything else none;
- padspan_ha/room_height_set: its schema (an undeclared key refused, null
  clears), a room not on the map refused, a drawn room with no room_meta
  entry given one (the fabric's floor), set and cleared;
- model_update (the settings page's colour editor) keeps a stored height it
  was not sent; only an explicit null clears it;
- a load keeps it, model_get hands it over (room_meta), a backup and its
  restore keep it;
- positioning never reads it: the floors' elevations are what they were.
"""

from __future__ import annotations

import asyncio
import copy
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
import voluptuous as vol

from custom_components.padspan_ha.const import DATA_FABRIC, DATA_MODEL, DATA_SETTINGS, DOMAIN, MAPS_STORE_KEY, MAX_HEIGHT_M, MODEL_STORE_KEY
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import ModelStore, room_height
from custom_components.padspan_ha.websocket import ws_room_height_set


def _fab() -> FabricStore:
    f = FabricStore.__new__(FabricStore)
    f.hass = MagicMock()
    f.store = AsyncMock()
    f.store.async_save = AsyncMock()
    f.data = {"floors": {"g": {"committed": False, "rooms": {
        "Living": {"type": "poly", "floor_id": "g", "points_m": [[0, 0], [6, 0], [6, 8], [0, 8]]},
        "Kitchen": {"type": "poly", "floor_id": "g", "points_m": [[6, 0], [12, 0], [12, 8], [6, 8]]}}},
        "u": {"committed": False, "rooms": {
            "Gallery": {"type": "poly", "floor_id": "u", "points_m": [[6, 0], [12, 0], [12, 8], [6, 8]]}}}},
        "history": [], "scanner_positions_m": {}, "beacon_positions_m": {}, "rf_barriers_m": [], "light_positions_m": {}}
    return f


def _mdl() -> ModelStore:
    m = ModelStore.__new__(ModelStore)
    m.hass = MagicMock()
    m.store = AsyncMock()
    m.store.async_save = AsyncMock()
    m.data = {"floors": [{"id": "g", "name": "Ground", "level": 0, "floor_to_floor_m": 2.8},
                         {"id": "u", "name": "Upstairs", "level": 1}],
              "room_meta": {"Kitchen": {"floor_id": "g", "color": "#112233"}},
              "map_transforms": {}}
    m.fabric = _fab()
    return m


def _hass(mdl):
    h = MagicMock()
    h.data = {DOMAIN: {DATA_MODEL: mdl, DATA_FABRIC: mdl.fabric, DATA_SETTINGS: SimpleNamespace(data={})}}
    return h


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _wire(msg):
    """The message as Home Assistant hands it over: through the command's own schema."""
    return vol.Schema({vol.Required("id"): int, **ws_room_height_set.ws_schema})(
        {"id": 1, "type": "padspan_ha/room_height_set", **msg})


def _call(h, msg):
    conn = MagicMock()
    _run(ws_room_height_set(h, conn, _wire(msg)))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1]}
    return conn.send_result.call_args[0][1]


# ═══ the value ═══════════════════════════════════════════════════════════════

def test_a_height_is_a_finite_number_kept_in_range() -> None:
    assert room_height(5.6) == 5.6 and room_height(5) == 5.0 and room_height(5.60049) == 5.6
    assert room_height(0.4) == 1.5 and room_height(1e6) == MAX_HEIGHT_M
    for bad in (None, True, False, "5.6", math.nan, math.inf, -math.inf, [5.6], {}):
        assert room_height(bad) is None, bad


# ═══ room_height_set ═════════════════════════════════════════════════════════

def test_the_schema_takes_a_number_or_null_and_nothing_else() -> None:
    assert _wire({"room": "Living", "height_m": "5.6"})["height_m"] == 5.6
    assert _wire({"room": "Living", "height_m": None})["height_m"] is None
    for bad in ({"room": "Living"}, {"height_m": 5.6}, {"room": "", "height_m": 5.6},
                {"room": "Living", "height_m": 5.6, "floor_id": "g"}, {"room": "Living", "height_m": "tall"}):
        with pytest.raises(vol.Invalid):
            _wire(bad)


def test_set_and_clear_a_rooms_height() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    assert _call(h, {"room": "Kitchen", "height_m": 5.6}) == {"ok": True, "room": "Kitchen", "height_m": 5.6}
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#112233", "height_m": 5.6}
    assert mdl.store.async_save.await_count == 1
    assert _call(h, {"room": "Kitchen", "height_m": None})["height_m"] is None
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#112233"}, "cleared: the floor's again"


def test_a_drawn_room_with_no_meta_gets_one_on_its_fabric_floor() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    assert _call(h, {"room": "Gallery", "height_m": None}) == {"ok": True, "room": "Gallery", "height_m": None}
    assert "Gallery" not in mdl.room_meta() and not mdl.store.async_save.await_count, "clearing nothing writes nothing"
    assert _call(h, {"room": "Gallery", "height_m": 99999})["height_m"] == MAX_HEIGHT_M
    meta = mdl.room_meta()["Gallery"]
    assert meta["floor_id"] == "u" and meta["height_m"] == MAX_HEIGHT_M and meta["color"].startswith("#")


def test_a_room_not_on_the_map_and_a_nan_are_refused() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    before = copy.deepcopy(mdl.data)
    assert _call(h, {"room": "Nowhere", "height_m": 3.0}) == {"error": "not_found"}
    assert _call(h, {"room": "Kitchen", "height_m": "nan"}) == {"error": "invalid"}
    assert mdl.data == before and not mdl.store.async_save.await_count


# ═══ the other room_meta paths keep it ═══════════════════════════════════════

def test_model_update_keeps_a_height_it_was_not_sent() -> None:
    mdl = _mdl()
    mdl.data["room_meta"]["Kitchen"]["height_m"] = 5.6
    # The settings page's colour editor posts floor and colour only.
    _run(mdl.async_update(room_meta={"Kitchen": {"floor_id": "g", "color": "#445566"}}))
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#445566", "height_m": 5.6}
    _run(mdl.async_update(room_meta={"Kitchen": {"floor_id": "g", "color": "#445566", "height_m": 4.2}}))
    assert mdl.room_meta()["Kitchen"]["height_m"] == 4.2
    _run(mdl.async_update(room_meta={"Kitchen": {"floor_id": "g", "color": "#445566", "height_m": None}}))
    assert "height_m" not in mdl.room_meta()["Kitchen"]
    _run(mdl.async_update(room_meta={"Kitchen": {"floor_id": "g", "color": "#445566", "height_m": "x"}}))
    assert "height_m" not in mdl.room_meta()["Kitchen"], "a stray value is never kept"


def test_a_load_keeps_it_and_drops_a_stray_one() -> None:
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock()
    mdl.store = AsyncMock()
    mdl.store.async_load = AsyncMock(return_value={
        "floors": [{"id": "main", "name": "Main"}],
        "room_meta": {"Living": {"floor_id": "main", "color": "#aabbcc", "height_m": 5.6},
                      "Den": {"floor_id": "main", "color": "#ccbbaa", "height_m": "tall"},
                      "Hall": {"floor_id": "main", "color": "#bbccaa"}}})
    mdl.store.async_save = AsyncMock()
    mdl.data = {}
    _run(mdl.async_setup())
    rm = mdl.room_meta()      # what model_get hands the panel, as it is
    assert rm["Living"] == {"floor_id": "main", "color": "#aabbcc", "height_m": 5.6}
    assert rm["Den"] == {"floor_id": "main", "color": "#ccbbaa"}
    assert rm["Hall"] == {"floor_id": "main", "color": "#bbccaa"}


def test_model_get_sends_room_meta_whole() -> None:
    import inspect

    from custom_components.padspan_ha import websocket as ws
    src = inspect.getsource(ws.ws_model_get)
    assert "room_meta = mdl.room_meta() if mdl else {}" in src and '"room_meta": room_meta' in src


def test_a_backup_and_its_restore_keep_it(monkeypatch) -> None:
    from custom_components.padspan_ha import ws_backup
    from tests.test_house3d_store import _capture_backups
    box = _capture_backups(monkeypatch)
    mdl = _mdl()
    h = _hass(mdl)
    h.async_add_executor_job = AsyncMock(return_value=False)
    assert _call(h, {"room": "Kitchen", "height_m": 5.6})["ok"]
    saved = {}

    class _St:
        def __init__(self, _h, _v, key):
            self.key = key

        async def async_load(self):
            return copy.deepcopy(saved.get(self.key))

        async def async_save(self, data):
            saved[self.key] = copy.deepcopy(data)

    import homeassistant.helpers.storage as _hs
    monkeypatch.setattr(_hs, "Store", _St)
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 1}))
    bk = box["backups"][-1]
    assert bk["stores"][MODEL_STORE_KEY]["room_meta"]["Kitchen"]["height_m"] == 5.6
    assert _call(h, {"room": "Kitchen", "height_m": None})["ok"]
    assert "height_m" not in mdl.room_meta()["Kitchen"]
    # Model with Maps (a restore refuses one without the other: map placements).
    keys = [MODEL_STORE_KEY] + ([MAPS_STORE_KEY] if MAPS_STORE_KEY in bk["stores"] else [])
    conn = MagicMock()
    _run(ws_backup.ws_store_backup_restore(h, conn, {"id": 2, "backup_id": bk["id"], "store_keys": keys}))
    assert not conn.send_error.called, conn.send_error.call_args
    assert saved[MODEL_STORE_KEY]["room_meta"]["Kitchen"]["height_m"] == 5.6
    assert mdl.room_meta()["Kitchen"]["height_m"] == 5.6, "in memory too"


# ═══ positioning: exactly as before ══════════════════════════════════════════

def test_floor_elevations_never_read_a_rooms_height() -> None:
    mdl = _mdl()
    before = mdl.floor_base_elevations_m()
    _run(mdl.async_set_room_height("Kitchen", 7.5))
    _run(mdl.async_set_room_height("Gallery", 2.0))
    assert mdl.floor_base_elevations_m() == before == {"g": 0.0, "u": 2.8}
