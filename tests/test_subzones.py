# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Sub-zones (subzones.py, ws_subzones.py): named areas inside a room.

What must hold: off by default, and while off, or on with none added, no
entity is created, no file is read or written and the coordinator's objects
(the positions) are exactly what they were; membership enters only enter_m
inside the edge and leaves only leave_m outside it, each after dwell_s, so a
position jittering on the edge never flaps; away, another floor or no
position counts as out; the admin commands refuse while off; removing one
takes its two entities out of HA's registry; a sub-zone can be made from a
Live Aboard piece's footprint; backups carry the file only once it exists;
positioning never reads any of it.
"""

from __future__ import annotations

import asyncio
import copy
import re
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import subzones as SZ
from custom_components.padspan_ha import ws_subzones as WS
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_SETTINGS, DATA_SUBZONES, DOMAIN, SUBZONES_STORE_KEY,
)

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


def _run(coro):
    return asyncio.run(coro)


class _DiskStore:
    files: dict = {}
    loads = 0

    def __init__(self, hass, version, key):
        self.key = key

    async def async_load(self):
        _DiskStore.loads += 1
        return copy.deepcopy(_DiskStore.files.get(self.key))

    async def async_save(self, data):
        _DiskStore.files[self.key] = copy.deepcopy(data)


class _Conn:
    def __init__(self):
        self.result, self.error = None, None

    def send_result(self, _id, r):
        self.result = r

    def send_error(self, _id, code, text):
        self.error = (code, text)


class _Coord:
    def __init__(self, data):
        self.data = data
        self.last_update_success = True
        self.listeners = []

    def async_add_listener(self, fn):
        self.listeners.append(fn)
        return lambda: None


def _hass(monkeypatch, on=False, data=None):
    from homeassistant.helpers import storage
    _DiskStore.files, _DiskStore.loads = {}, 0
    monkeypatch.setattr(storage, "Store", _DiskStore, raising=False)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"subzones_enabled": on})}})
    hass.async_create_task = lambda c: asyncio.ensure_future(c)
    coord = _Coord(data if data is not None else {})
    coord.hass = hass
    hass.data[DOMAIN]["presence_coordinator"] = coord
    return hass, coord


def _tag(x, y, floor="main", label="Garry", **kw):
    return {"kind": "private_ble", "user_label": label, "x_m": x, "y_m": y, "floor_id": floor, "age_s": 1.0, **kw}


BED = {"id": "sz_1", "name": "Bed", "floor_id": "main", "type": "poly",
       "points_m": [[0, 0], [2, 0], [2, 2], [0, 2]], "enter_m": 0.1, "leave_m": 0.3, "dwell_s": 5.0}


class _Entry:
    def __init__(self):
        self.unloads = []
        self.entry_id = "e1"

    def async_on_unload(self, fn):
        self.unloads.append(fn)


# ── Off by default; nothing created; positions untouched ─────────────────────

def test_off_by_default_everywhere():
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    from custom_components.padspan_ha import websocket as ws
    assert DEFAULT_SETTINGS["subzones_enabled"] is False
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert "subzones_enabled" in keys
    assert '"subzones_enabled"' in (ROOT / "ws_settings.py").read_text(encoding="utf-8").split("for key in (", 1)[1]


@pytest.mark.parametrize("on", [False, True])
def test_no_entities_and_positions_unchanged_without_subzones(monkeypatch, on):
    """Off (the default), or on with none added: nothing is added, and the
    objects the coordinator hands everyone else are exactly as they were."""
    objs = {"irk:a": _tag(1, 1), "irk:b": _tag(5, 5, label="Nicole")}
    before = copy.deepcopy(objs)
    hass, coord = _hass(monkeypatch, on=on, data=objs)
    added = []
    _run(SZ.async_setup_entities(hass, _Entry(), added.extend, lambda c, z: z))
    for fn in coord.listeners:
        fn()
    assert added == []
    assert SZ.get_monitor(hass).current(hass, coord) == {}
    assert objs == before and coord.data is objs
    assert _DiskStore.files == {}                     # no file written
    if not on:
        assert _DiskStore.loads == 0 and DATA_SUBZONES not in hass.data[DOMAIN]   # not even read


def test_positioning_never_reads_subzones():
    for f in ("presence_coordinator.py", "snapshot_builder.py", "calibration_store.py", "ws_calibration.py",
              "presence_rules.py", "fabric_store.py", "model_store.py"):
        assert "subzone" not in (ROOT / f).read_text(encoding="utf-8").lower(), f


def test_evaluate_does_not_touch_objects():
    objs = {"irk:a": _tag(1, 1)}
    before = copy.deepcopy(objs)
    SZ.SubzoneTracker().evaluate({"sz_1": BED}, objs, 0.0, 300.0)
    assert objs == before


# ── Geometry ──────────────────────────────────────────────────────────────────

def test_depth_poly_and_circle():
    assert SZ.depth_m(BED, 1, 1) == pytest.approx(1.0)
    assert SZ.depth_m(BED, 1, 0.2) == pytest.approx(0.2)
    assert SZ.depth_m(BED, 3, 1) == pytest.approx(-1.0)
    circ = {"type": "circle", "cx_m": 0, "cy_m": 0, "r_m": 1}
    assert SZ.depth_m(circ, 0.5, 0) == pytest.approx(0.5)
    assert SZ.depth_m(circ, 2, 0) == pytest.approx(-1.0)


def test_piece_footprint_turned():
    piece = {"x_m": 5, "y_m": 5, "rotation": 90, "recipe": {"width_m": 2, "depth_m": 1}}
    pts = SZ.piece_footprint(piece)
    xs, ys = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
    assert xs[0] == pytest.approx(4.5) and xs[-1] == pytest.approx(5.5)   # turned: depth across x
    assert ys[0] == pytest.approx(4.0) and ys[-1] == pytest.approx(6.0)


def test_normalise_rejects_and_drops():
    with pytest.raises(SZ.ZoneError):
        SZ.normalise_zone("sz_x", {"name": "", "floor_id": "main", "type": "poly", "points_m": BED["points_m"]})
    with pytest.raises(SZ.ZoneError):
        SZ.normalise_zone("sz_x", {"name": "Bed", "floor_id": "main", "type": "poly", "points_m": [[0, 0], [1, 1]]})
    with pytest.raises(SZ.ZoneError):
        SZ.normalise_zone("sz_x", {**BED, "dwell_s": -1})
    data = SZ._normalise_data({"zones": {"sz_1": BED, "sz_bad": {"name": "x"}}})
    assert list(data["zones"]) == ["sz_1"]


# ── Hysteresis and dwell ─────────────────────────────────────────────────────

def test_enter_needs_margin_and_dwell():
    t = SZ.SubzoneTracker()
    z = {"sz_1": BED}
    assert t.evaluate(z, {"k": _tag(1, 0.05)}, 0, 300) == {"sz_1": []}     # inside but not enter_m in
    for now in (10, 12, 14.9):
        assert t.evaluate(z, {"k": _tag(1, 1)}, now, 300) == {"sz_1": []}  # not dwelt yet
    assert t.evaluate(z, {"k": _tag(1, 1)}, 15, 300) == {"sz_1": ["Garry"]}


def test_edge_jitter_never_flaps():
    t = SZ.SubzoneTracker()
    z = {"sz_1": BED}
    t.evaluate(z, {"k": _tag(1, 1)}, 0, 300)
    t.evaluate(z, {"k": _tag(1, 1)}, 5, 300)
    seen = []
    for i in range(40):     # wobbling 0.25 m either side of the edge, every second
        x = 2.25 if i % 2 else 1.75
        seen.append(t.evaluate(z, {"k": _tag(x, 1)}, 6 + i, 300)["sz_1"])
    assert all(s == ["Garry"] for s in seen)


def test_leave_needs_margin_and_dwell():
    t = SZ.SubzoneTracker()
    z = {"sz_1": BED}
    t.evaluate(z, {"k": _tag(1, 1)}, 0, 300)
    t.evaluate(z, {"k": _tag(1, 1)}, 5, 300)
    assert t.evaluate(z, {"k": _tag(2.5, 1)}, 6, 300) == {"sz_1": ["Garry"]}
    assert t.evaluate(z, {"k": _tag(2.5, 1)}, 10.9, 300) == {"sz_1": ["Garry"]}
    assert t.evaluate(z, {"k": _tag(2.5, 1)}, 11, 300) == {"sz_1": []}


@pytest.mark.parametrize("obj", [
    _tag(1, 1, floor="upstairs"), _tag(1, 1, age_s=900.0), _tag(None, None), _tag(1, 1, outside=True), None,
])
def test_away_other_floor_or_no_position_leaves(obj):
    t = SZ.SubzoneTracker()
    z = {"sz_1": BED}
    t.evaluate(z, {"k": _tag(1, 1)}, 0, 300)
    t.evaluate(z, {"k": _tag(1, 1)}, 5, 300)
    objs = {"k": obj} if obj is not None else {}
    assert t.evaluate(z, objs, 6, 300) == {"sz_1": ["Garry"]}
    assert t.evaluate(z, objs, 11, 300) == {"sz_1": []}


def test_unlabelled_ignored():
    t = SZ.SubzoneTracker()
    z = {"sz_1": {**BED, "dwell_s": 0.0}}
    assert t.evaluate(z, {"k": _tag(1, 1, label="")}, 0, 300) == {"sz_1": []}
    assert t.evaluate(z, {"k": {**_tag(1, 1), "kind": "entity"}}, 0, 300) == {"sz_1": []}


# ── WebSocket ─────────────────────────────────────────────────────────────────

def test_writes_refused_while_off(monkeypatch):
    hass, _ = _hass(monkeypatch, on=False)
    for fn, msg in ((WS.ws_subzone_add, {"zone": BED}), (WS.ws_subzone_remove, {"zone_id": "sz_1"}),
                    (WS.ws_subzone_from_piece, {"piece_id": "fur_00000000"})):
        c = _Conn()
        _run(fn(hass, c, {"id": 1, **msg}))
        assert c.error and c.error[0] == WS.OFF_CODE
    c = _Conn()
    _run(WS.ws_subzones_list(hass, c, {"id": 1}))
    assert c.result == {"enabled": False, "zones": []}
    assert _DiskStore.files == {}


def test_add_list_update_remove(monkeypatch):
    from homeassistant.helpers import entity_registry as er
    hass, coord = _hass(monkeypatch, on=True, data={"k": _tag(1, 1)})
    hass.data[DOMAIN][DATA_FABRIC] = SimpleNamespace(rooms_flat=lambda: {
        "Bedroom": {"type": "poly", "floor_id": "main", "points_m": [[-1, -1], [4, -1], [4, 4], [-1, 4]]}})
    removed = []
    reg = SimpleNamespace(async_get_entity_id=lambda p, d, uid: f"{p}.{uid}", async_remove=removed.append)
    monkeypatch.setattr(er, "async_get", lambda h: reg, raising=False)
    c = _Conn()
    _run(WS.ws_subzone_add(hass, c, {"id": 1, "zone": {k: v for k, v in BED.items() if k != "id"}}))
    assert c.error is None
    zid = c.result["zone"]["id"]
    assert re.fullmatch(r"sz_[0-9a-f]{8}", zid) and c.result["zone"]["room"] == "Bedroom"
    assert list(_DiskStore.files[SUBZONES_STORE_KEY]["zones"]) == [zid]
    c = _Conn()
    _run(WS.ws_subzone_update(hass, c, {"id": 2, "zone_id": zid, "zone": {"name": "Couch", "dwell_s": 2}}))
    assert c.result["zone"]["name"] == "Couch" and c.result["zone"]["points_m"] == BED["points_m"]
    c = _Conn()
    _run(WS.ws_subzone_update(hass, c, {"id": 3, "zone_id": zid, "zone": {"type": "circle", "cx_m": 1, "cy_m": 1, "r_m": 1}}))
    assert c.result["zone"]["type"] == "circle" and "points_m" not in c.result["zone"]
    c = _Conn()
    _run(WS.ws_subzone_remove(hass, c, {"id": 4, "zone_id": zid}))
    assert c.result["zones"] == [] and _DiskStore.files[SUBZONES_STORE_KEY] == {"zones": {}}
    assert sorted(removed) == sorted(f"{p}.{WS.unique_id(zid, s)}" for p, s in WS.ENTITY_SUFFIXES)


def test_from_piece(monkeypatch):
    from custom_components.padspan_ha import house3d_store as H
    hass, _ = _hass(monkeypatch, on=True)
    piece = {"label": "Our bed", "floor_id": "main", "x_m": 1, "y_m": 1, "rotation": 0,
             "recipe": {"kind": "bed", "width_m": 1.6, "depth_m": 2.0}}

    async def _exists(h):
        return True

    async def _store(h):
        return SimpleNamespace(data={"pieces": {"fur_0000abcd": piece}})
    monkeypatch.setattr(H, "async_file_exists", _exists)
    monkeypatch.setattr(H, "async_get_store", _store)
    c = _Conn()
    _run(WS.ws_subzone_from_piece(hass, c, {"id": 1, "piece_id": "fur_0000abcd"}))
    z = c.result["zone"]
    assert z["name"] == "Our bed" and z["piece_id"] == "fur_0000abcd" and len(z["points_m"]) == 4
    assert SZ.depth_m(z, 1, 1) == pytest.approx(0.8)
    c = _Conn()
    _run(WS.ws_subzone_from_piece(hass, c, {"id": 2, "piece_id": "fur_ffffffff"}))
    assert c.error[0] == "not_found"


# ── Entities ──────────────────────────────────────────────────────────────────

def _binary_sensor_module():
    mod = types.ModuleType("homeassistant.components.binary_sensor")
    mod.BinarySensorEntity = type("BinarySensorEntity", (), {})
    mod.BinarySensorDeviceClass = SimpleNamespace(OCCUPANCY="occupancy")
    sys.modules.setdefault("homeassistant.components.binary_sensor", mod)
    from custom_components.padspan_ha import binary_sensor
    return binary_sensor


def test_entities_follow_subzones(monkeypatch):
    BS = _binary_sensor_module()
    monkeypatch.setattr(sys.modules["homeassistant.components.sensor"], "SensorStateClass",
                        SimpleNamespace(MEASUREMENT="measurement"), raising=False)
    from custom_components.padspan_ha import sensor as S
    hass, coord = _hass(monkeypatch, on=True, data={"k": _tag(1, 1)})
    _DiskStore.files[SUBZONES_STORE_KEY] = {"zones": {"sz_1": {**BED, "dwell_s": 0.0}}}
    occ, who = [], []
    _run(BS.async_setup_entry(hass, _Entry(), occ.extend))
    # The platform also adds binary_sensor.padspan_vacation_mode, once.
    vac = [e for e in occ if isinstance(e, BS.PadSpanVacationMode)]
    assert len(vac) == 1 and vac[0]._attr_unique_id == "e1_vacation_mode" and vac[0].is_on is False
    occ[:] = [e for e in occ if not isinstance(e, BS.PadSpanVacationMode)]
    _run(SZ.async_setup_entities(hass, _Entry(), who.extend, S.PadSpanSubzoneWhoSensor))
    assert len(occ) == 1 and len(who) == 1
    assert occ[0].unique_id == WS.unique_id("sz_1", "occupied") and who[0].unique_id == WS.unique_id("sz_1", "who")
    assert occ[0].is_on is True and who[0].native_value == "Garry" and occ[0].available
    assert occ[0].device_info["name"] == "PadSpan Bed"
    for fn in coord.listeners:
        fn()
    assert len(occ) == 1                                   # never twice
    hass.data[DOMAIN][DATA_SETTINGS].data["subzones_enabled"] = False
    assert occ[0].available is False


# ── Backups, structure ────────────────────────────────────────────────────────

def test_backups_only_once_written():
    from custom_components.padspan_ha import ws_common
    assert SUBZONES_STORE_KEY in ws_common._BACKUP_ONLY_ONCE_WRITTEN
    assert ws_common._DATA_KEY_MAP[SUBZONES_STORE_KEY] == DATA_SUBZONES
    assert SUBZONES_STORE_KEY in ws_common._ALL_STORE_KEYS


def test_commands_registered_and_admin():
    src = (ROOT / "websocket.py").read_text(encoding="utf-8")
    assert "from .ws_subzones import WS_COMMANDS" in src
    ws_src = (ROOT / "ws_subzones.py").read_text(encoding="utf-8")
    for name in ("ws_subzone_add", "ws_subzone_update", "ws_subzone_remove", "ws_subzone_from_piece"):
        head = ws_src.split(f"async def {name}(", 1)[0].rsplit("@websocket_api.websocket_command", 1)[1]
        assert "@websocket_api.require_admin" in head, name


def test_mapping_tool_hidden_unless_on():
    js = (ROOT / "www" / "padspan-ha" / "views" / "maps.js").read_text(encoding="utf-8")
    assert "const _szOn = () => ctx.state.settings?.subzones_enabled === true;" in js
    assert '...(_szOn() ? [el("button"' in js
    assert 'ctx.state.maps._mode==="subzones" && _szOn()' in js
