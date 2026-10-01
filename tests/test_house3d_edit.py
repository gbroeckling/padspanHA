# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part C: the 3D editor's Save (ws_house3d.house3d_edit).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md on the live-aboard branch ("Data", "Undoing
it", "Added by Garry": the door and window line tool, device heights). The
editor's whole draft is saved by one command, in one store write, or not at
all; nothing is stored until then. Held here:
- refused while off and below Pro (as if off), and nothing touched;
- the light-placement gate: any user at the tier, no admin;
- checked on the way in: finite numbers, widths and heights in range, the
  head above the sill, the closed lists, the id formats, a cap on counts;
- atomic: one bad entry, or a failed write, and nothing changes;
- the first Save creates the file, and from then on backups carry it;
- tolerant: every key it does not own, in the file or in an entry, is kept;
- the map is never written: fabric, model, maps and settings keep their bytes.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
import json
import math
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import ws_fabric as WF
from custom_components.padspan_ha import ws_house3d as W
from custom_components.padspan_ha.const import (DATA_FABRIC, DATA_HOUSE3D, DATA_MODEL, DATA_SETTINGS, DOMAIN,
                                                FABRIC_STORE_KEY,
                                                HOUSE3D_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY,
                                                SETTINGS_STORE_KEY)
from tests.test_house3d_store import _capture_backups, _house, _run

_WIN = {"kind": "window", "floor_id": "main", "a_m": [2.1, -9.23], "b_m": [3.3, -9.23], "sill_m": 0.9, "head_m": 2.1}
_DOOR = {"kind": "door", "floor_id": "main", "a_m": [5.0, 0.0], "b_m": [5.0, 0.9], "head_m": 2.03,
         "hinge": "left", "swing": "in"}


class _DiskStore:
    """Home Assistant's Store, on disk under <root>/.storage/<key>; every
    write recorded by key, in order. `fail` is consumed one entry per write:
    "raised" (the write raises) or "swallowed" (as Home Assistant's Store
    does with a failed write: logged, and it returns normally). `slow` makes
    every load and save yield to the loop, so commands can interleave."""
    root: Path = Path(".")
    writes: list = []
    fail: list = []
    slow: bool = False

    def __init__(self, hass, version, key):
        self.key = key

    def _path(self) -> Path:
        return _DiskStore.root / ".storage" / self.key

    async def async_load(self):
        if _DiskStore.slow:
            await asyncio.sleep(0)
        p = self._path()
        return json.loads(p.read_text(encoding="utf-8"))["data"] if p.is_file() else None

    async def async_save(self, data):
        if _DiskStore.slow:
            await asyncio.sleep(0)
        how = _DiskStore.fail.pop(0) if _DiskStore.fail else None
        if how == "raised":
            raise OSError(28, "No space left on device")
        if how == "swallowed":
            return
        p = self._path()
        p.parent.mkdir(parents=True, exist_ok=True)
        _DiskStore.writes.append(self.key)
        p.write_text(json.dumps({"version": 1, "key": self.key, "data": data}), encoding="utf-8")


@pytest.fixture
def disk(monkeypatch, tmp_path):
    import homeassistant.helpers.storage as _hs
    _DiskStore.root, _DiskStore.writes, _DiskStore.fail, _DiskStore.slow = tmp_path, [], [], False
    monkeypatch.setattr(_hs, "Store", _DiskStore)
    return _DiskStore


def _file(tmp_path: Path, key: str = HOUSE3D_STORE_KEY) -> Path:
    return tmp_path / ".storage" / key


def _seed(tmp_path: Path, data: dict, key: str = HOUSE3D_STORE_KEY) -> None:
    f = _file(tmp_path, key)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"version": 1, "key": key, "data": data}), encoding="utf-8")


def _on(tmp_path: Path, *, tier: str = "pro", admin: bool = False):
    h = _house(tmp_path, on=True)
    st = h.data[DOMAIN][DATA_SETTINGS]
    if tier == "free":
        st.data["forensics_license_key"] = ""
    elif tier == "bright":
        st.data["license_tier"] = "bright"
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=admin, name="Nicole")
    return h, conn


def _edit(h, conn, **sections):
    _run(W.ws_house3d_edit(h, conn, {"id": 7, "type": "padspan_ha/house3d_edit", **sections}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


# ═══ refused, and nothing touched ════════════════════════════════════════════

def test_refused_while_off_and_nothing_is_read_or_written(disk, tmp_path):
    h, conn = _on(tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    out = _edit(h, conn, openings={"win_5e6f7a8b": dict(_WIN)})
    assert out["error"] == W.OFF_CODE and out["message"] == W.OFF_MESSAGE
    assert disk.writes == [] and not _file(tmp_path).exists()


@pytest.mark.parametrize("tier", ["free", "bright"])
def test_below_pro_it_is_as_if_off_whatever_the_switch_says(disk, tmp_path, tier):
    h, conn = _on(tmp_path, tier=tier)
    out = _edit(h, conn, lights={"light.kitchen": {"z_m": 1.5}})
    assert out["error"] == W.OFF_CODE and "Pro" in out["message"] and "padspan.traks.ca" in out["message"]
    assert disk.writes == [] and not _file(tmp_path).exists()


def test_the_light_placement_gate_any_user_no_admin(disk, tmp_path):
    """Light placement (ws_fabric) is open to every user at the paid tier,
    with no admin decorator; the 3D editor's Save is the same, inside the
    Pro-only feature. A non-admin user at Pro saves."""
    def decorators(fn) -> str:
        src = inspect.getsource(inspect.getmodule(fn))
        at = src.index(f"async def {fn.__name__}(")
        return src[src.rindex("@websocket_api.websocket_command(", 0, at):at]

    assert "require_admin" not in decorators(WF.ws_fabric_light_position_set)
    assert "require_admin" not in decorators(W.ws_house3d_edit)
    assert "require_admin" in decorators(W.ws_house3d_clear)
    h, conn = _on(tmp_path, admin=False)
    out = _edit(h, conn, lights={"light.kitchen": {"z_m": 1.55}})
    assert out["data"]["lights"] == {"light.kitchen": {"z_m": 1.55}}


def test_registered_with_its_schema():
    assert W.ws_house3d_edit in W.WS_COMMANDS
    keys = {str(k) for k in W.ws_house3d_edit.ws_schema}
    assert {"type", "openings", "lights", "devices"} <= keys


# ═══ checked on the way in ═══════════════════════════════════════════════════

def _win(**kw):
    return {"openings": {"win_5e6f7a8b": {**_WIN, **kw}}}


def _door(**kw):
    return {"openings": {"door_0a1b2c3d": {**_DOOR, **kw}}}


_BAD = {
    "window narrower than 0.3 m": _win(b_m=[2.39, -9.23]),
    "door narrower than 0.6 m": _door(b_m=[5.0, 0.59]),
    "window wider than 50 m": _win(b_m=[60.0, -9.23]),
    "sill above the head": _win(sill_m=2.2, head_m=2.1),
    "head equal to the sill": _win(sill_m=1.0, head_m=1.0),
    "a NaN": _win(sill_m=math.nan),
    "an infinity": _win(a_m=[math.inf, 0.0]),
    "a bool for a number": _win(sill_m=True),
    "text for a number": _win(head_m="2.1"),
    "a negative sill": _win(sill_m=-0.1),
    "a head over 10 m": _win(head_m=10.5),
    "a door 0.4 m high": _door(head_m=0.4),
    "a hinge not left or right": _door(hinge="up"),
    "a swing not in or out": _door(swing="sideways"),
    "a window with a hinge": _win(hinge="left"),
    "a door with a sill": {"openings": {"door_0a1b2c3d": {**_DOOR, "sill_m": 0.0}}},
    "a point of three numbers": _win(a_m=[1.0, 2.0, 3.0]),
    "a missing key": {"openings": {"win_5e6f7a8b": {k: v for k, v in _WIN.items() if k != "head_m"}}},
    "an unknown key": _win(colour="red"),
    "a win_ id that is a door": {"openings": {"win_5e6f7a8b": dict(_DOOR)}},
    "a floor id that is empty": _win(floor_id=" "),
    "a short id": {"openings": {"win_5e6f7a8": dict(_WIN)}},
    "an id in capitals": {"openings": {"win_5E6F7A8B": dict(_WIN)}},
    "an id not hex": {"openings": {"door_zzzzzzzz": dict(_DOOR)}},
    "a barrier id with a space": {"openings": {"bar 1": {"hinge": "right"}}},
    "a barrier id of 41 characters": {"openings": {"b" * 41: {"hinge": "right"}}},
    "a barrier override with a floor": {"openings": {"bar_a71a3324": {"hinge": "right", "floor_id": "main"}}},
    "an empty barrier override": {"openings": {"bar_a71a3324": {}}},
    "a barrier head under its sill": {"openings": {"bar_a71a3324": {"sill_m": 1.5, "head_m": 1.0}}},
    "a light that is not an entity id": {"lights": {"Light.Kitchen": {"z_m": 1.0}}},
    "a light with two dots": {"lights": {"light..kitchen": {"z_m": 1.0}}},
    "a device with no domain": {"devices": {"kitchen_temperature": {"z_m": 1.0}}},
    "a height under the floor": {"lights": {"light.kitchen": {"z_m": -0.01}}},
    "a height over 10 m": {"devices": {"sensor.kitchen_temperature": {"z_m": 10.01}}},
    "a height with another key": {"lights": {"light.kitchen": {"z_m": 1.0, "x_m": 2.0}}},
    "an entry that is a list": {"lights": {"light.kitchen": [1.0]}},
    "a section that is a list": {"lights": [["light.kitchen", 1.0]]},
    "nothing at all": {},
    "an added id with a newline after it": {"openings": {"win_5e6f7a8b\n": dict(_WIN)}},
    "a barrier id with a newline after it": {"openings": {"bar_a71a3324\n": {"hinge": "right"}}},
    "a light id with a newline after it": {"lights": {"light.kitchen\n": {"z_m": 1.0}}},
    "a number too big for a float": {"lights": {"light.kitchen": {"z_m": 10 ** 400}}},
}


@pytest.mark.parametrize("name", sorted(_BAD))
def test_a_bad_edit_is_refused_and_nothing_written(disk, tmp_path, name):
    h, conn = _on(tmp_path)
    out = _edit(h, conn, **_BAD[name])
    assert out.get("error") == "invalid", (name, out)
    assert disk.writes == [] and not _file(tmp_path).exists(), name


def test_unknown_sections_and_too_many_changes_are_refused():
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"pieces": {"fur_1": {}}})
    many = {f"light.l{i}": {"z_m": 1.0} for i in range(H.MAX_CHANGES + 1)}
    with pytest.raises(H.EditError, match="at most"):
        H.apply_edit(H.empty(), {"lights": many})
    full = {**H.empty(), "openings": {f"win_{i:08x}": dict(_WIN) for i in range(H.MAX_OPENINGS)}}
    with pytest.raises(H.EditError, match="at most"):
        H.apply_edit(full, {"openings": {"door_ffffffff": dict(_DOOR)}})
    # At the cap, an edit that adds nothing still saves.
    assert H.apply_edit(full, {"openings": {"win_00000000": {**_WIN, "sill_m": 1.0}}})["openings"]["win_00000000"]["sill_m"] == 1.0


def test_good_entries_are_kept_to_the_millimetre():
    out = H.apply_edit(H.empty(), {
        "openings": {"win_5e6f7a8b": {**_WIN, "a_m": [2.10049, -9.23], "sill_m": 0.90001},
                     "door_0a1b2c3d": dict(_DOOR), "bar_a71a3324": {"hinge": "right", "swing": "out"},
                     "bar_h_win": {"sill_m": 1.0, "head_m": 2.2}},
        "lights": {"light.kitchen": {"z_m": 1.55}, "fan.loft": {"z_m": 2.4}},
        "devices": {"sensor.kitchen_temperature": {"z_m": 1.5}, "binary_sensor.hall_motion": {"z_m": 0}},
    })
    assert out["openings"]["win_5e6f7a8b"]["a_m"] == [2.1, -9.23] and out["openings"]["win_5e6f7a8b"]["sill_m"] == 0.9
    assert out["openings"]["door_0a1b2c3d"] == _DOOR
    assert out["openings"]["bar_a71a3324"] == {"hinge": "right", "swing": "out"}
    assert out["devices"]["binary_sensor.hall_motion"] == {"z_m": 0.0}
    assert set(out["lights"]) == {"light.kitchen", "fan.loft"}


# ═══ atomic ═════════════════════════════════════════════════════════════════

def test_one_bad_entry_and_nothing_of_the_edit_is_written(disk, tmp_path):
    before = {**H.empty(), "lights": {"light.kitchen": {"z_m": 1.2}}}
    _seed(tmp_path, before)
    raw = _file(tmp_path).read_bytes()
    h, conn = _on(tmp_path)
    out = _edit(h, conn, openings={"win_5e6f7a8b": dict(_WIN)}, lights={"light.kitchen": {"z_m": 2.0}},
                devices={"sensor.kitchen_temperature": {"z_m": 99}})
    assert out["error"] == "invalid" and "z_m" in out["message"]
    assert disk.writes == [] and _file(tmp_path).read_bytes() == raw
    assert h.data[DOMAIN][DATA_HOUSE3D].data == H.normalise(before), "memory unchanged too"


@pytest.mark.parametrize("how", ["raised", "swallowed"])
def test_a_failed_write_changes_nothing(disk, tmp_path, how):
    """A write that raises (SafeStore catches it), and one Home Assistant's
    Store swallows (it logs the error and returns normally, so a read-back
    finds the old file): save_failed, and the file and the memory are as
    they were."""
    before = {**H.empty(), "lights": {"light.kitchen": {"z_m": 1.2}}}
    _seed(tmp_path, before)
    raw = _file(tmp_path).read_bytes()
    h, conn = _on(tmp_path)
    store = _run(H.async_get_store(h))
    disk.fail = [how]
    out = _edit(h, conn, lights={"light.kitchen": {"z_m": 2.0}}, openings={"win_5e6f7a8b": dict(_WIN)})
    assert out["error"] == "save_failed"
    assert _file(tmp_path).read_bytes() == raw
    assert store.data == before


def test_saves_take_turns(disk, tmp_path):
    """Two Saves at once, the first of which fails: the second neither
    carries the first's change nor is rolled back by it, and the memory and
    the file agree."""
    _seed(tmp_path, H.empty())
    h, c1 = _on(tmp_path)
    c2 = MagicMock()
    c2.user = c1.user
    store = _run(H.async_get_store(h))
    disk.slow, disk.fail = True, ["swallowed"]

    async def both():
        await asyncio.gather(W.ws_house3d_edit(h, c1, {"id": 1, "lights": {"light.a": {"z_m": 1.1}}}),
                             W.ws_house3d_edit(h, c2, {"id": 2, "lights": {"light.b": {"z_m": 2.2}}}))

    _run(both())
    assert c1.send_error.called and c1.send_error.call_args[0][1] == "save_failed"
    assert c2.send_result.call_args[0][1]["data"]["lights"] == {"light.b": {"z_m": 2.2}}
    on_disk = json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]
    assert store.data == on_disk and on_disk["lights"] == {"light.b": {"z_m": 2.2}}


def test_two_first_uses_at_once_load_one_store(disk, tmp_path):
    """A Save and a read that both find nothing loaded: one store, so the
    Save is in the memory every later Save starts from."""
    _seed(tmp_path, H.empty())
    h, conn = _on(tmp_path)
    disk.slow = True

    async def race():
        await asyncio.gather(W.ws_house3d_edit(h, conn, {"id": 1, "lights": {"light.a": {"z_m": 1.5}}}),
                             W.ws_house3d_get(h, MagicMock(), {"id": 2}))

    _run(race())
    out = _edit(h, MagicMock(), lights={"light.b": {"z_m": 2.0}})
    assert set(out["data"]["lights"]) == {"light.a", "light.b"}
    assert set(json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]["lights"]) == {"light.a", "light.b"}


@pytest.mark.parametrize("schema", [2, 99, "1", 1.5, True, None, -1])
def test_a_newer_padspans_file_is_kept_whole_and_never_written(disk, tmp_path, schema):
    """After a downgrade the file can be a newer PadSpan's: read and kept
    whole in memory (backups carry it as it is), and never written. An edit
    reshaped its sections to this version's and wrote them back."""
    newer = {"schema": schema, "lights": [{"entity_id": "light.a", "z_m": 1.4}], "devices": 5,
             "openings": {"win_00000001": {**_WIN, "tint": "blue"}}, "rooms3d": {"k": 1}}
    _seed(tmp_path, newer)
    raw = _file(tmp_path).read_bytes()
    h, conn = _on(tmp_path)
    out = _edit(h, conn, openings={"door_0a1b2c3d": dict(_DOOR)})
    assert out == {"error": "house3d_newer", "message": H.NEWER_MESSAGE}
    assert disk.writes == [] and _file(tmp_path).read_bytes() == raw
    assert h.data[DOMAIN][DATA_HOUSE3D].data == newer, "every section kept as it is"
    get = MagicMock()
    _run(W.ws_house3d_get(h, get, {"id": 8}))
    assert get.send_result.call_args[0][1]["counts"] == {"pieces": 0, "lights": 0, "openings": 1, "devices": 0,
                                                         "figures": 0}
    with pytest.raises(H.EditError):
        H.apply_edit(newer, {"openings": {"door_0a1b2c3d": dict(_DOOR)}})


def test_a_schema_this_version_writes():
    for data in ({"schema": 1}, {"schema": 0}, {}, None):
        assert H.writable(H.normalise(data)), data
    assert H.apply_edit({"schema": 1}, {"lights": {"light.a": {"z_m": 1.0}}})["schema"] == 1


def test_the_whole_draft_is_one_write(disk, tmp_path):
    h, conn = _on(tmp_path)
    out = _edit(h, conn, openings={"win_5e6f7a8b": dict(_WIN), "door_0a1b2c3d": dict(_DOOR),
                                   "bar_a71a3324": {"hinge": "right"}},
                lights={"light.kitchen": {"z_m": 1.55}}, devices={"sensor.kitchen_temperature": {"z_m": 1.4}})
    assert disk.writes == [HOUSE3D_STORE_KEY], "one store write for the whole draft"
    assert out["counts"]["openings"] == 3 and out["counts"]["lights"] == 1 and out["counts"]["devices"] == 1
    on_disk = json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]
    assert on_disk == out["data"]


# ═══ the file: created by the first Save, carried by backups after ═══════════

def test_the_first_save_creates_the_file_and_backups_carry_it_from_then_on(disk, tmp_path, monkeypatch):
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    h, conn = _on(tmp_path)
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 1}))
    assert HOUSE3D_STORE_KEY not in box["backups"][-1]["stores"], "never written: no entry"
    assert not _file(tmp_path).exists()
    _edit(h, conn, openings={"win_5e6f7a8b": dict(_WIN)})
    assert _file(tmp_path).is_file(), "the first Save creates it"
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 2}))
    assert box["backups"][-1]["stores"][HOUSE3D_STORE_KEY]["openings"]["win_5e6f7a8b"]["sill_m"] == 0.9


# ═══ tolerant: what it does not own stays ════════════════════════════════════

def test_every_key_it_does_not_own_is_kept(disk, tmp_path):
    seeded = {
        "schema": 1, "future_top": {"x": 1}, "rooms3d": {"kept": True},
        "pieces": {"fur_1": {"id": "fur_1", "recipe": {"kind": "sofa"}, "label": "Mum's old couch"}},
        "figures": {"person.garry": {"params": {"height_m": 1.8}}}, "library": {"terms_version": 1},
        "lights": {"light.a": {"z_m": 1.0, "glow": "warm"}, "light.b": {"z_m": 2.0}, "light.c": {"z_m": 0.5, "note": "n"}},
        "devices": {"aa:bb:cc:dd:ee:ff": {"recipe": {"kind": "tag"}}, "sensor.t": {"z_m": 1.5}},
        "openings": {"bar_a71a3324": {"hinge": "left", "swing": "in", "lean": 3},
                     "win_00000001": {**_WIN, "tint": "blue"}},
    }
    _seed(tmp_path, seeded)
    h, conn = _on(tmp_path)
    out = _edit(h, conn,
                lights={"light.a": {"z_m": 1.25}, "light.b": None, "light.c": None},
                devices={"sensor.t": {"z_m": 1.6}},
                openings={"bar_a71a3324": {"hinge": "right"}, "win_00000001": None,
                          "door_0a1b2c3d": dict(_DOOR)})["data"]
    for k in ("future_top", "rooms3d", "pieces", "figures", "library"):
        assert out[k] == seeded[k], k
    assert out["lights"] == {"light.a": {"z_m": 1.25, "glow": "warm"}, "light.c": {"note": "n"}}
    assert out["devices"] == {"aa:bb:cc:dd:ee:ff": {"recipe": {"kind": "tag"}}, "sensor.t": {"z_m": 1.6}}
    assert out["openings"]["bar_a71a3324"] == {"lean": 3, "hinge": "right"}, "set replaces what it owns, keeps the rest"
    assert "win_00000001" not in out["openings"], "a window drawn in 3D goes whole"
    assert out["openings"]["door_0a1b2c3d"] == _DOOR


def test_a_floor_that_no_longer_exists_is_accepted(disk, tmp_path):
    h, conn = _on(tmp_path)
    out = _edit(h, conn, openings={"win_5e6f7a8b": {**_WIN, "floor_id": "a_floor_since_deleted"}})
    assert out["data"]["openings"]["win_5e6f7a8b"]["floor_id"] == "a_floor_since_deleted"


# ═══ the map is never written ════════════════════════════════════════════════

def test_editing_and_saving_leaves_the_map_bytes_unchanged(disk, tmp_path):
    """The fabric (rooms, walls, light positions), the model, the maps and
    the settings keep every byte; the 3D file is the only write."""
    seeds = {
        FABRIC_STORE_KEY: {"rf_barriers_m": [{"id": "bar_a71a3324", "name": "Barrier 1", "material": "metal",
                                              "floor_id": "main", "points_m": [[3.035, -9.228], [5.46, -9.255]]}],
                           "light_positions_m": {"light.kitchen": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"}},
                           "room_geometry_m": {"Kitchen": {"floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 3]]}}},
        MODEL_STORE_KEY: {"floors": [{"id": "main", "name": "Main"}], "scanner_positions_m": {"aa": {"z_m": 2.1}}},
        MAPS_STORE_KEY: {"maps": [{"id": "m1", "name": "Main floor"}]},
        SETTINGS_STORE_KEY: {"atlas_3d_enabled": True},
    }
    for k, v in seeds.items():
        _seed(tmp_path, v, k)
    raw = {k: _file(tmp_path, k).read_bytes() for k in seeds}
    h, conn = _on(tmp_path)
    live = {DATA_MODEL: {"light_positions_m": {"light.kitchen": {"x_m": 1.0}}}, DATA_FABRIC: {"rf_barriers_m": []}}
    for k, v in live.items():
        h.data[DOMAIN][k] = copy.deepcopy(v)
    _edit(h, conn, openings={"win_5e6f7a8b": dict(_WIN), "bar_a71a3324": {"hinge": "right", "swing": "out"}},
          lights={"light.kitchen": {"z_m": 1.55}}, devices={"sensor.kitchen_temperature": {"z_m": 1.4}})
    _edit(h, conn, openings={"win_5e6f7a8b": None}, lights={"light.kitchen": None})
    assert disk.writes == [HOUSE3D_STORE_KEY, HOUSE3D_STORE_KEY]
    for k in seeds:
        assert _file(tmp_path, k).read_bytes() == raw[k], k
    for k, v in live.items():
        assert h.data[DOMAIN][k] == v, k
