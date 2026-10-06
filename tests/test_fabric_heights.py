# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A device's height lives in its one placement record.

Garry, 2026-10-05: "Device placement on atlas is good until we get to sims,
needs same information store, but needs to be a tool to add the third
dimension for the sims view, height mostly. Same dataset, just extra info."

light_positions_m[eid] (every placed device: lights, fans, motion,
temperature and the rest, locks) takes an optional z_m: metres above its
floor, 0 to MAX_HEIGHT_M, to the centimetre (as a scanner's). Fixed beacons'
records take the same. Held here:
- fabric_light_position_set takes an optional z_m; a save without it keeps
  the stored one (a drag never wipes a height); only null clears it;
- fabric_light_height_set changes the height alone (x/y untouched), on the
  same tier gate and through the same fabric write, one write for many, all
  or nothing;
- the same for fixed beacons;
- validation: NaN and infinity refused, out of range clamped, a stray value
  in a stored record never kept;
- backups and restores keep it;
- presence and positioning read exactly what they read before.
"""

from __future__ import annotations

import asyncio
import copy
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
import voluptuous as vol

from custom_components.padspan_ha.const import (DATA_FABRIC, DATA_MODEL, DATA_SETTINGS, DOMAIN,
                                                FABRIC_STORE_KEY, MAX_HEIGHT_M)
from custom_components.padspan_ha.fabric_store import FabricStore, device_height
from custom_components.padspan_ha.model_store import ModelStore
from custom_components.padspan_ha.websocket import (  # noqa: I001
    ws_fabric_beacon_height_set,
    ws_fabric_beacon_position_set,
    ws_fabric_light_height_set,
    ws_fabric_light_position_set,
)


def _fab() -> FabricStore:
    f = FabricStore.__new__(FabricStore)
    f.hass = MagicMock()
    f.store = AsyncMock()
    f.store.async_save = AsyncMock()
    f.data = {"floors": {}, "history": [], "scanner_positions_m": {},
              "beacon_positions_m": {}, "rf_barriers_m": [], "light_positions_m": {}}
    return f


def _mdl() -> ModelStore:
    m = ModelStore.__new__(ModelStore)
    m.hass = MagicMock()
    m.store = AsyncMock()
    m.store.async_save = AsyncMock()
    m.data = {"map_transforms": {}}
    m.fabric = _fab()
    return m


def _hass(mdl, *, pro: bool = True):
    h = MagicMock()
    settings = SimpleNamespace(data={"forensics_license_key": "PSPAN-TEST" if pro else ""})
    h.data = {DOMAIN: {DATA_MODEL: mdl, DATA_FABRIC: mdl.fabric, DATA_SETTINGS: settings}}
    return h


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _wire(handler, msg):
    """The message as Home Assistant hands it over: through the command's
    own schema (an undeclared key refused, numbers coerced)."""
    return vol.Schema({vol.Required("id"): int, **handler.ws_schema})(
        {"id": 1, "type": handler.ws_schema["type"], **msg})


def _call(handler, hass, msg):
    conn = MagicMock()
    _run(handler(hass, conn, _wire(handler, msg)))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


def _place(h, eid="light.island_pendant", **more):
    return _call(ws_fabric_light_position_set, h, {"entity_id": eid, "x_m": 4.5, "y_m": -2.25,
                                                   "floor_id": "main", "color": "#ff0000", **more})


def _rec(mdl, eid="light.island_pendant"):
    return mdl.light_positions_m()[eid]


# ═══ the placement record carries it ═════════════════════════════════════════

def test_a_placement_can_carry_a_height_and_without_one_has_none() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    assert _place(h)["ok"] and "z_m" not in _rec(mdl), "no value means the default for its kind"
    assert _place(h, z_m=1.65)["ok"]
    r = _rec(mdl)
    assert r["z_m"] == 1.65 and (r["x_m"], r["y_m"], r["floor_id"]) == (4.5, -2.25, "main")


def test_a_save_without_a_height_keeps_the_stored_one_and_only_null_clears_it() -> None:
    """Dragging a device on the Atlas re-saves its whole record without a
    height: it must never wipe the one set for Live Aboard."""
    mdl = _mdl()
    h = _hass(mdl)
    _place(h, z_m=2.4)
    _call(ws_fabric_light_position_set, h, {"entity_id": "light.island_pendant", "x_m": 1.0, "y_m": 2.0,
                                            "floor_id": "main", "width_cm": 40})
    r = _rec(mdl)
    assert r["z_m"] == 2.4 and (r["x_m"], r["y_m"], r["width_cm"]) == (1.0, 2.0, 40.0), "moved, height kept"
    assert _place(h, z_m=None)["ok"] and _rec(mdl)["z_m"] is None, "an explicit null clears it: the default, chosen"
    _place(h)
    assert _rec(mdl)["z_m"] is None, "and a later save without one does not bring it back"


@pytest.mark.parametrize("given,kept", [
    (2.456, 2.46), (0, 0.0), (-1.0, 0.0), (MAX_HEIGHT_M + 50, MAX_HEIGHT_M), ("1.2", 1.2), (3, 3.0),
])
def test_a_height_is_kept_like_a_scanners(given, kept) -> None:
    """0 to MAX_HEIGHT_M, to the centimetre (ModelStore.async_set_scanner_z_m)."""
    mdl = _mdl()
    h = _hass(mdl)
    assert _place(h, z_m=given)["ok"]
    assert _rec(mdl)["z_m"] == kept


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), "nan", "-inf"])
def test_not_a_height_is_refused_and_nothing_changes(bad) -> None:
    mdl = _mdl()
    h = _hass(mdl)
    _place(h, z_m=1.0)
    before = copy.deepcopy(mdl.fabric.data)
    got = _place(h, z_m=bad)
    assert got.get("error") == "invalid" and "z_m" in got["message"]
    assert mdl.fabric.data == before


def test_the_fabric_never_keeps_a_stray_value_as_a_height() -> None:
    """Every path into the record goes through the fabric's own check: a
    value that is not a height says nothing, x/y as given; a stored record
    never holds a height (it sits beside it)."""
    assert device_height(None) is None and device_height(True) is None and device_height("tall") is None
    assert device_height(float("nan")) is None and device_height(1.234) == 1.23
    fab = _fab()
    _run(fab.async_spatial_update(set_lights={
        "light.a": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main", "z_m": "tall"},
        "light.b": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main", "z_m": 2.555},
    }, set_beacons={"ble:1": {"x_m": 0.5, "y_m": 0.5, "floor_id": "main", "z_m": None}}))
    lp = fab.light_positions_m()
    assert not any("z_m" in r for r in lp.values()) and lp["light.a"]["x_m"] == 1.0
    assert fab.light_heights_m() == {"light.b": 2.56}, "light.a: not a height, so nothing decided"
    assert "z_m" not in fab.beacon_positions_m()["ble:1"] and fab.beacon_heights_m() == {"ble:1": None}


def test_every_device_class_placed_like_a_light_takes_a_height() -> None:
    """Lights, fans, motion, temperature/humidity/air, leak sensors and locks
    share the one record and the one command."""
    mdl = _mdl()
    h = _hass(mdl)
    eids = ["light.pot_1", "fan.lounge", "binary_sensor.hall_motion", "sensor.lounge_temperature",
            "binary_sensor.sink_leak", "lock.front_door"]
    for e in eids:
        assert _place(h, e, z_m=1.0)["ok"], e
    assert all(_rec(mdl, e)["z_m"] == 1.0 for e in eids)


# ═══ the height alone ═════════════════════════════════════════════════════════

def test_the_height_alone_changes_only_the_height() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    _place(h, width_cm=60, rotation=30, label="Island")
    before = copy.deepcopy(_rec(mdl))
    got = _call(ws_fabric_light_height_set, h, {"entity_id": "light.island_pendant", "z_m": 1.7})
    assert got == {"ok": True, "heights": {"light.island_pendant": 1.7}}
    after = _rec(mdl)
    assert after.pop("z_m") == 1.7 and after == before, "x, y, floor and looks exactly as they were"
    got = _call(ws_fabric_light_height_set, h, {"entity_id": "light.island_pendant", "z_m": None})
    after = _rec(mdl)
    assert got["heights"] == {"light.island_pendant": None} and after.pop("z_m") is None and after == before


def test_the_height_alone_goes_through_the_fabric_write_and_its_history() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    _place(h)
    saves = mdl.fabric.store.async_save.await_count
    _call(ws_fabric_light_height_set, h, {"entity_id": "light.island_pendant", "z_m": 2.0})
    assert mdl.fabric.store.async_save.await_count == saves + 1
    assert mdl.fabric.data["history"][-1]["op"] == "light_height_set"
    # The same height again: nothing to write.
    _call(ws_fabric_light_height_set, h, {"entity_id": "light.island_pendant", "z_m": 2.0})
    assert mdl.fabric.store.async_save.await_count == saves + 1


def test_many_heights_in_one_write_all_or_nothing() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    for e in ("light.pot_1", "light.pot_2", "light.pot_3"):
        _place(h, e)
    saves = mdl.fabric.store.async_save.await_count
    got = _call(ws_fabric_light_height_set, h, {"heights": {"light.pot_1": 2.6, "light.pot_2": 2.6, "light.pot_3": None}})
    assert got["ok"] and mdl.fabric.store.async_save.await_count == saves + 1
    assert _rec(mdl, "light.pot_1")["z_m"] == 2.6 and _rec(mdl, "light.pot_3")["z_m"] is None
    before = copy.deepcopy(mdl.fabric.data)
    got = _call(ws_fabric_light_height_set, h, {"heights": {"light.pot_1": 1.0, "light.not_placed": 1.0}})
    assert got["error"] == "not_found" and "light.not_placed" in got["message"]
    assert mdl.fabric.data == before, "one device with no record: nothing written"


@pytest.mark.parametrize("msg", [
    {},                                                  # neither form
    {"entity_id": "light.pot_1"},                        # no z_m
    {"z_m": 1.0},                                        # no id
    {"entity_id": "light.pot_1", "z_m": 1.0, "heights": {"light.pot_1": 1.0}},
    {"heights": {}},
    {"heights": {"light.pot_1": 1.0}, "z_m": 2.0},
    {"heights": {"light.pot_1": float("nan")}},
    {"entity_id": "  ", "z_m": 1.0},
])
def test_the_height_command_says_what_it_needs(msg) -> None:
    mdl = _mdl()
    h = _hass(mdl)
    _place(h, "light.pot_1")
    before = copy.deepcopy(mdl.fabric.data)
    assert _call(ws_fabric_light_height_set, h, msg).get("error") == "invalid"
    assert mdl.fabric.data == before


def test_the_height_alone_has_the_placement_gate() -> None:
    mdl = _mdl()
    _place(_hass(mdl))
    before = copy.deepcopy(mdl.fabric.data)
    got = _call(ws_fabric_light_height_set, _hass(mdl, pro=False), {"entity_id": "light.island_pendant", "z_m": 2.0})
    assert got["error"] == "pro_required" and mdl.fabric.data == before
    got = _call(ws_fabric_light_position_set, _hass(mdl, pro=False), {"entity_id": "light.island_pendant",
                                                                      "x_m": 0.0, "y_m": 0.0, "z_m": 2.0})
    assert got["error"] == "pro_required" and mdl.fabric.data == before


def test_the_commands_are_registered_and_the_schema_takes_z_m() -> None:
    from custom_components.padspan_ha import websocket as WSM
    src = open(WSM.__file__, encoding="utf-8").read()
    assert "async_register_command(hass, ws_fabric_light_height_set)" in src
    assert "async_register_command(hass, ws_fabric_beacon_height_set)" in src
    for handler, idk in ((ws_fabric_light_position_set, "entity_id"), (ws_fabric_beacon_position_set, "key")):
        assert _wire(handler, {idk: "x", "x_m": 1, "y_m": 2, "z_m": None})["z_m"] is None
        assert _wire(handler, {idk: "x", "x_m": 1, "y_m": 2, "z_m": "2.5"})["z_m"] == 2.5
    assert _wire(ws_fabric_light_height_set, {"heights": {"light.a": "1.5", "light.b": None}})["heights"] == {
        "light.a": 1.5, "light.b": None}
    with pytest.raises(vol.Invalid):
        _wire(ws_fabric_light_height_set, {"entity_id": "light.a", "z_m": 1, "x_m": 2})


# ═══ fixed beacons: the same ══════════════════════════════════════════════════

def test_a_fixed_beacon_takes_a_height_kept_through_a_re_pin() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    assert _call(ws_fabric_beacon_position_set, h, {"key": "ble:aa", "x_m": 1.0, "y_m": 1.0, "floor_id": "main",
                                                    "room": "Hall", "z_m": 0.9})["ok"]
    assert mdl.beacon_positions_m()["ble:aa"]["z_m"] == 0.9
    _call(ws_fabric_beacon_position_set, h, {"key": "ble:aa", "x_m": 2.0, "y_m": 1.0, "floor_id": "main", "room": "Hall"})
    assert mdl.beacon_positions_m()["ble:aa"]["z_m"] == 0.9 and mdl.beacon_positions_m()["ble:aa"]["x_m"] == 2.0
    got = _call(ws_fabric_beacon_height_set, h, {"key": "ble:aa", "z_m": 2.1})
    assert got == {"ok": True, "heights": {"ble:aa": 2.1}}
    b = mdl.beacon_positions_m()["ble:aa"]
    assert (b["x_m"], b["y_m"], b["room"], b["z_m"]) == (2.0, 1.0, "Hall", 2.1)
    assert mdl.fabric.data["history"][-1]["op"] == "beacon_height_set"
    _call(ws_fabric_beacon_height_set, h, {"key": "ble:aa", "z_m": None})
    assert mdl.beacon_positions_m()["ble:aa"]["z_m"] is None
    assert _call(ws_fabric_beacon_height_set, h, {"key": "ble:zz", "z_m": 1.0})["error"] == "not_found"


# ═══ reading a record with a height ══════════════════════════════════════════

def test_model_get_hands_the_record_over_whole() -> None:
    """The panel spreads model_get's whole answer (test_model_get_floor_payload):
    the height reaches it with the record, no new key."""
    mdl = _mdl()
    _place(_hass(mdl), z_m=1.65)
    assert mdl.light_positions_m()["light.island_pendant"]["z_m"] == 1.65


def test_telemetry_and_the_bright_import_read_a_record_with_a_height() -> None:
    """Nothing that reads the records chokes on the new key (an older PadSpan
    re-saving a device simply drops it: it never sends one)."""
    from custom_components.padspan_ha.bright_import import target_contents
    fab = {"light_positions_m": {"light.a": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main", "z_m": 2.4}}}
    assert target_contents(fab, {}, {}) == ["1 placed light"]


# ═══ backups and restores keep it ════════════════════════════════════════════

def test_a_backup_and_its_restore_keep_the_heights(monkeypatch) -> None:
    from custom_components.padspan_ha import ws_backup
    from tests.test_house3d_store import _capture_backups
    box = _capture_backups(monkeypatch)
    mdl = _mdl()
    h = _hass(mdl)
    h.async_add_executor_job = AsyncMock(return_value=False)
    _place(h, z_m=1.65)
    _call(ws_fabric_beacon_position_set, h, {"key": "ble:aa", "x_m": 1.0, "y_m": 1.0, "z_m": 0.9})
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
    assert bk["stores"][FABRIC_STORE_KEY]["light_heights_m"]["light.island_pendant"] == 1.65
    _call(ws_fabric_light_height_set, h, {"entity_id": "light.island_pendant", "z_m": None})
    _call(ws_fabric_beacon_height_set, h, {"key": "ble:aa", "z_m": None})
    assert mdl.light_positions_m()["light.island_pendant"]["z_m"] is None
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {"id": 2, "backup_id": bk["id"],
                                                            "store_keys": [FABRIC_STORE_KEY]}))
    assert saved[FABRIC_STORE_KEY]["light_heights_m"]["light.island_pendant"] == 1.65
    assert mdl.light_positions_m()["light.island_pendant"]["z_m"] == 1.65, "in memory too"
    assert mdl.beacon_positions_m()["ble:aa"]["z_m"] == 0.9


# ═══ presence and positioning: exactly as before ═════════════════════════════

def _house_model() -> ModelStore:
    mdl = _mdl()
    mdl.data["floors"] = [{"id": "main", "name": "Main", "level": 0, "floor_to_floor_m": 2.7},
                          {"id": "up", "name": "Up", "level": 1}]
    fab = mdl.fabric
    fab.data["floors"] = {"main": {"committed": False, "rooms": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]]},
        "Hall": {"type": "poly", "floor_id": "main", "points_m": [[4, 0], [8, 0], [8, 3], [4, 3]]}}},
        "up": {"committed": False, "rooms": {
            "Bed": {"type": "poly", "floor_id": "up", "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]]}}}}
    fab.data["scanner_positions_m"] = {
        "aa:01": {"x_m": 1.0, "y_m": 1.0, "z_m": 2.2, "floor_id": "main"},
        "aa:02": {"x_m": 6.0, "y_m": 2.0, "z_m": 0.4, "floor_id": "main"},
        "aa:03": {"x_m": 2.0, "y_m": 2.0, "floor_id": "up"}}
    fab.data["rf_barriers_m"] = [{"id": "bar_1", "name": "Wall", "material": "brick", "floor_id": "main",
                                  "points_m": [[4, 0], [4, 3]]}]
    h = _hass(mdl)
    for i, (e, x) in enumerate((("light.pot_1", 1.0), ("binary_sensor.hall_motion", 6.0), ("lock.front", 7.5))):
        _place(h, e, x_m=x, y_m=1.0 + i)
    _call(ws_fabric_beacon_position_set, h, {"key": "ble:tag", "x_m": 5.0, "y_m": 1.5, "floor_id": "main"})
    return mdl


def _presence_inputs(mdl: ModelStore) -> dict:
    """Everything presence and positioning read from the model
    (presence_coordinator: scanners, their absolute heights, rooms, their
    centroids and floors, walls, the floor stack, the pinned beacons' x, y,
    room and floor; calibration_store: the absolute heights)."""
    return copy.deepcopy({
        "scanners": mdl.scanner_positions_m(), "abs_z": mdl.scanner_absolute_z_m(),
        "rooms": mdl.room_geometry_m(), "centroids": mdl.room_centroids_m(),
        "barriers": mdl.rf_barriers_m(), "bases": mdl.floor_base_elevations_m(),
        "stack": mdl.floor_stack_index(),
        "pinned": {k: {f: v.get(f) for f in ("room", "floor_id", "x_m", "y_m")}
                   for k, v in mdl.beacon_positions_m().items()},
        "room_at": [mdl.beacon_room_from_geometry(x, y, "main") for x, y in ((1, 1), (6, 2), (9, 9))],
        "placed_xy": {k: (v["x_m"], v["y_m"], v["floor_id"]) for k, v in mdl.light_positions_m().items()},
    })


def test_a_height_on_a_light_record_changes_nothing_in_presence() -> None:
    mdl = _house_model()
    before = _presence_inputs(mdl)
    h = _hass(mdl)
    _call(ws_fabric_light_height_set, h, {"heights": {"light.pot_1": 2.6, "binary_sensor.hall_motion": 2.2,
                                                      "lock.front": 1.0}})
    _call(ws_fabric_beacon_height_set, h, {"key": "ble:tag", "z_m": 0.9})
    _place(h, "light.pot_1", x_m=1.0, y_m=1.0)        # a drag keeps the height and changes nothing else
    assert _rec(mdl, "light.pot_1")["z_m"] == 2.6
    assert _presence_inputs(mdl) == before


def test_nothing_that_computes_presence_reads_a_device_record() -> None:
    """The placement records are the Atlas's and Live Aboard's: no module that
    places a person or a tag reads them, so a height on one cannot move
    anybody."""
    from pathlib import Path
    cc = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    for name in ("presence_coordinator.py", "calibration_store.py", "snapshot_builder.py", "trilateration.py",
                 "floor_detect.py", "adaptive_store.py"):
        p = cc / name
        if p.exists():
            assert "light_positions_m" not in p.read_text(encoding="utf-8"), name
    # A pinned beacon's height is not read where presence reads the pins.
    src = (cc / "presence_coordinator.py").read_text(encoding="utf-8")
    pins = src[src.index("_model.beacon_positions_m().items()"):][:600]
    assert "z_m" not in pins and math.isfinite(1.0)


# ═══ review 2026-10-05: rolling back, Default, Auto position ═════════════════
# An older PadSpan (0.38.101, 0.38.104) copies a placement record WHOLE into
# its Mapping draft and sends it back through a schema with no z_m, which
# refuses it. So a stored placement record never carries a height: heights
# sit beside the records in the same fabric file (light_heights_m), and the
# model hands each record over with its height in it, as before.

def _old_schema_without_z():
    """fabric_light_position_set's schema as an older PadSpan has it."""
    return vol.Schema({vol.Required("id"): int, **{k: v for k, v in ws_fabric_light_position_set.ws_schema.items()
                                                     if str(k) != "z_m"}})


def test_a_stored_record_never_carries_a_height_so_an_older_padspan_can_save_it() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    _place(h, z_m=1.65)
    _call(ws_fabric_light_height_set, h, {"entity_id": "light.island_pendant", "z_m": 1.7})
    stored = mdl.fabric.data["light_positions_m"]["light.island_pendant"]
    assert "z_m" not in stored and mdl.fabric.data["light_heights_m"] == {"light.island_pendant": 1.7}
    assert _rec(mdl)["z_m"] == 1.7, "the model still hands the record over with its height"
    # What an older Mapping sends back after a rollback: the stored record, whole.
    _old_schema_without_z()({"id": 1, "type": "padspan_ha/fabric_light_position_set",
                             "entity_id": "light.island_pendant", **stored})
    _call(ws_fabric_beacon_position_set, h, {"key": "ble:aa", "x_m": 1.0, "y_m": 1.0, "z_m": 0.9})
    assert "z_m" not in mdl.fabric.data["beacon_positions_m"]["ble:aa"]
    assert mdl.beacon_positions_m()["ble:aa"]["z_m"] == 0.9


def test_default_is_a_decided_height_that_beats_any_other_copy() -> None:
    """null is "the default for its kind, chosen": the record says so (z_m
    None), so nothing else (a height still in Live Aboard's file) stands in."""
    mdl = _mdl()
    h = _hass(mdl)
    _place(h)
    assert "z_m" not in _rec(mdl), "never set: undecided"
    _call(ws_fabric_light_height_set, h, {"entity_id": "light.island_pendant", "z_m": None})
    assert "z_m" in _rec(mdl) and _rec(mdl)["z_m"] is None
    assert mdl.fabric.data["light_heights_m"] == {"light.island_pendant": None}


def test_auto_position_keeps_the_height_for_when_it_is_placed_again() -> None:
    from custom_components.padspan_ha.websocket import ws_fabric_light_remove
    mdl = _mdl()
    h = _hass(mdl)
    _place(h, z_m=2.1)
    _call(ws_fabric_light_remove, h, {"entity_id": "light.island_pendant"})
    assert "light.island_pendant" not in mdl.light_positions_m()
    _place(h)                                          # dropped on the map again, no height sent
    assert _rec(mdl)["z_m"] == 2.1
