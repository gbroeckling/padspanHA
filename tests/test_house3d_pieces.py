# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P2, Furnish: furniture in the 3D file (house3d_edit's pieces).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md on the live-aboard branch ("Data", "Undoing
it", P2's "Done when"). Garry, 2026-10-04: "unable to place furniture on the
level I want, add a drop raise feature to move between floors and height in
room". A piece is saved with the rest of the editor's draft, in one write, or
not at all. Held here:
- refused while off and below Pro, the light-placement gate (any user);
- checked on the way in (contracts §2): the id, the recipe, the floor, x/y,
  z (its height in the room) and rotation, the device link, a cap of 1000;
- tolerant: an unknown kind, param or key is kept, and a floor since deleted;
- "Remove all furniture": admin, a backup first, the other sections kept;
- registration: a backup carries the furniture, a restore of an older backup
  with no furniture keeps it, a factory reset empties it, store version 1,
  and saving furniture changes no other file's bytes.
"""

from __future__ import annotations

import copy
import json
import math
from unittest.mock import MagicMock

import pytest
import voluptuous as vol

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import ws_house3d as W
from custom_components.padspan_ha.const import (DATA_FABRIC, DATA_HOUSE3D, DATA_MODEL, DATA_SETTINGS, DOMAIN,
                                                FABRIC_STORE_KEY, HOUSE3D_STORE_KEY, MAPS_STORE_KEY,
                                                MODEL_STORE_KEY, SETTINGS_STORE_KEY)
from tests.test_house3d_edit import _DOOR, _WIN, _edit, _file, _on, _seed, disk  # noqa: F401
from tests.test_house3d_store import _capture_backups, _restore, _run, store  # noqa: F401

_SOFA = {"id": "fur_1a2b3c4d", "recipe": {"kind": "sofa", "params": {"seats": 3, "arms": "slim", "legs": "tapered"},
                                          "colors": ["#5b6b7a", "#c8b89a"],
                                          "width_m": 2.2, "depth_m": 0.9, "height_m": 0.8},
         "origin": "build", "label": "", "library_id": None, "submission_id": None,
         "floor_id": "main", "x_m": 3.412, "y_m": 1.25, "z_m": 0.0, "rotation": 90.0,
         "entity_id": None, "entity_reg_id": None}
_STAMP = "2026-01-15T12:00:00+00:00"          # the tests' utcnow (conftest)


def _sofa(**kw) -> dict:
    p = copy.deepcopy(_SOFA)
    p.update(kw)
    return p


def _recipe(**kw) -> dict:
    return _sofa(recipe={**_SOFA["recipe"], **kw})


def _pieces(*ps: dict) -> dict:
    return {"pieces": {p["id"]: p for p in ps}}


# ═══ the gate ═════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("how", ["off", "free", "bright"])
def test_refused_while_off_and_below_pro_and_nothing_written(disk, tmp_path, how):  # noqa: F811
    h, conn = _on(tmp_path, tier="pro" if how == "off" else how)
    if how == "off":
        h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    out = _edit(h, conn, **_pieces(_sofa()))
    assert out["error"] == W.OFF_CODE
    assert disk.writes == [] and not _file(tmp_path).exists()


def test_any_user_at_pro_saves_furniture_and_the_schema_takes_it(disk, tmp_path):  # noqa: F811
    h, conn = _on(tmp_path, admin=False)
    out = _edit(h, conn, **_pieces(_sofa()))
    assert out["data"]["pieces"]["fur_1a2b3c4d"]["recipe"]["kind"] == "sofa"
    assert out["counts"]["pieces"] == 1
    assert "pieces" in {str(k) for k in W.ws_house3d_edit.ws_schema}


# ═══ checked on the way in ════════════════════════════════════════════════════

_BAD = {
    "an id that is not fur_ + 8 hex": {"pieces": {"fur_1": _sofa(id="fur_1")}},
    "an id in capitals": {"pieces": {"fur_1A2B3C4D": _sofa(id="fur_1A2B3C4D")}},
    "an id with a newline after it": {"pieces": {"fur_1a2b3c4d\n": _sofa(id="fur_1a2b3c4d\n")}},
    "an id of another kind": {"pieces": {"win_1a2b3c4d": _sofa(id="win_1a2b3c4d")}},
    "an id that is not its key": {"pieces": {"fur_1a2b3c4d": _sofa(id="fur_00000000")}},
    "a piece that is a list": {"pieces": {"fur_1a2b3c4d": [1, 2]}},
    "no recipe": {"pieces": {"fur_1a2b3c4d": {k: v for k, v in _SOFA.items() if k != "recipe"}}},
    "a recipe that is text": _pieces(_sofa(recipe="sofa")),
    "no kind": _pieces(_sofa(recipe={k: v for k, v in _SOFA["recipe"].items() if k != "kind"})),
    "an empty kind": _pieces(_recipe(kind=" ")),
    "a kind of 41 characters": _pieces(_recipe(kind="k" * 41)),
    "a kind with a control character": _pieces(_recipe(kind="so\x00fa")),
    "params that are a list": _pieces(_recipe(params=[3])),
    "41 params": _pieces(_recipe(params={f"p{i}": 1 for i in range(41)})),
    "a param that is an object": _pieces(_recipe(params={"seats": {"n": 3}})),
    "a param that is a list": _pieces(_recipe(params={"seats": [3]})),
    "a param that is null": _pieces(_recipe(params={"seats": None})),
    "a param of 61 characters": _pieces(_recipe(params={"arms": "a" * 61})),
    "a param name of 41 characters": _pieces(_recipe(params={"p" * 41: 1})),
    "a param that is not a number": _pieces(_recipe(params={"seats": math.nan})),
    "a param too big for a float": _pieces(_recipe(params={"seats": 10 ** 400})),
    "colours that are text": _pieces(_recipe(colors="#5b6b7a")),
    "seven colours": _pieces(_recipe(colors=["#5b6b7a"] * 7)),
    "a colour by name": _pieces(_recipe(colors=["red"])),
    "a colour of five digits": _pieces(_recipe(colors=["#5b6b7"])),
    "a colour not hex": _pieces(_recipe(colors=["#gggggg"])),
    "a width under 1 mm": _pieces(_recipe(width_m=0.0009)),
    "a depth over 8 m": _pieces(_recipe(depth_m=8.01)),
    "no height": _pieces(_sofa(recipe={k: v for k, v in _SOFA["recipe"].items() if k != "height_m"})),
    "a size that is true": _pieces(_recipe(width_m=True)),
    "details that are a list": _pieces(_recipe(details=["seating"])),
    "an origin not on the list": _pieces(_sofa(origin="shop")),
    "a label of 61 characters": _pieces(_sofa(label="L" * 61)),
    "a label that is a number": _pieces(_sofa(label=7)),
    "no floor": {"pieces": {"fur_1a2b3c4d": {k: v for k, v in _SOFA.items() if k != "floor_id"}}},
    "an empty floor": _pieces(_sofa(floor_id="  ")),
    "a floor id of 65 characters": _pieces(_sofa(floor_id="f" * 65)),
    "no x": {"pieces": {"fur_1a2b3c4d": {k: v for k, v in _SOFA.items() if k != "x_m"}}},
    "an x past 10 km": _pieces(_sofa(x_m=10_000.5)),
    "a y that is infinite": _pieces(_sofa(y_m=math.inf)),
    "an x that is text": _pieces(_sofa(x_m="3.4")),
    "a height under the floor": _pieces(_sofa(z_m=-0.01)),
    "a height over 20 m": _pieces(_sofa(z_m=20.01)),
    "a rotation that is not a number": _pieces(_sofa(rotation=math.nan)),
    "an entity id in capitals": _pieces(_sofa(entity_id="Light.Lamp")),
    "an entity id with no domain": _pieces(_sofa(entity_id="lamp")),
    "an entity registry id with a space": _pieces(_sofa(entity_reg_id="a b")),
    "a library id that is a number": _pieces(_sofa(library_id=5)),
    "a piece of 9000 characters": _pieces(_sofa(notes="n" * 9000)),
}


@pytest.mark.parametrize("name", sorted(_BAD))
def test_a_bad_piece_is_refused_and_nothing_written(disk, tmp_path, name):  # noqa: F811
    h, conn = _on(tmp_path)
    out = _edit(h, conn, **_BAD[name])
    assert out.get("error") == "invalid", (name, out)
    assert disk.writes == [] and not _file(tmp_path).exists(), name


def test_a_rug_keeps_its_real_thickness():
    """The least size is a millimetre, as the library's and the builders': a
    12 mm rug is kept 12 mm thick, never raised to 5 cm."""
    out = H.apply_edit(H.empty(), _pieces(_recipe(kind="rug", width_m=2.0, depth_m=1.4, height_m=0.012),
                                          _sofa(id="fur_00000001", recipe=_recipe(height_m=0.001)["recipe"])))
    assert out["pieces"]["fur_1a2b3c4d"]["recipe"]["height_m"] == 0.012
    assert out["pieces"]["fur_00000001"]["recipe"]["height_m"] == 0.001


def test_the_least_size_is_one_number_everywhere():
    """house3d_store, the view's rules, the import, Furnish, and the library
    (its sizes and a device's look) all keep a piece down to one millimetre."""
    import re
    from pathlib import Path
    from custom_components.padspan_ha import house3d_library as L
    views = Path(H.__file__).parent / "www" / "padspan-ha" / "views"
    pieces = (views / "live_aboard_pieces.js").read_text(encoding="utf-8")
    imp = (views / "live_aboard_import.js").read_text(encoding="utf-8")
    furnish = (views / "live_aboard_furnish.js").read_text(encoding="utf-8")
    least = {"house3d_store": H.SIZE_MIN_M, "library": L.DIM_MIN_M, "look": H.LOOK_SIZE_M[0],
             "pieces.js": float(re.search(r"export const SIZE_MIN_M = ([\d.]+)", pieces)[1]),
             "import.js": float(re.search(r"export const SIZE_MIN_M = ([\d.]+)", imp)[1]),
             "furnish.js inRange": float(re.search(r"function inRange\(recipe\)\{.*?Math\.max\(([\d.]+),",
                                                   furnish, re.S)[1])}
    assert set(least.values()) == {0.001}, least


def test_a_good_piece_is_tidied_and_stamped():
    out = H.apply_edit(H.empty(), _pieces(
        _sofa(rotation=-15, label="  Mum's\x07 old couch \n", x_m=3.41249, z_m=0.4,
              recipe={**_SOFA["recipe"], "colors": ["#5B6B7A"], "kind": " sofa "},
              entity_id="light.lounge_lamp", entity_reg_id="0123456789abcdef0123456789abcdef",
              updated_at="1999-01-01T00:00:00+00:00"),
        _sofa(id="fur_00000001", rotation=725.5), _sofa(id="fur_00000002", rotation=359.9999)))["pieces"]
    p = out["fur_1a2b3c4d"]
    assert p["rotation"] == 345.0 and out["fur_00000001"]["rotation"] == 5.5 and out["fur_00000002"]["rotation"] == 0.0
    assert p["label"] == "Mum's old couch", "control characters stripped, then trimmed"
    assert p["x_m"] == 3.412 and p["z_m"] == 0.4, "kept to the millimetre"
    assert p["recipe"]["colors"] == ["#5b6b7a"] and p["recipe"]["kind"] == "sofa"
    assert p["updated_at"] == _STAMP, "the server stamps it"
    assert p["entity_id"] == "light.lounge_lamp" and p["entity_reg_id"] == "0123456789abcdef0123456789abcdef"


def test_what_a_piece_leaves_out_takes_its_default():
    out = H.apply_edit(H.empty(), {"pieces": {"fur_1a2b3c4d": {
        "recipe": {"kind": "lamp", "width_m": 0.4, "depth_m": 0.4, "height_m": 1.6}, "floor_id": "main",
        "x_m": 1, "y_m": 2}}})["pieces"]["fur_1a2b3c4d"]
    assert out == {"id": "fur_1a2b3c4d", "recipe": {"kind": "lamp", "params": {}, "colors": [], "width_m": 0.4,
                                                    "depth_m": 0.4, "height_m": 1.6},
                   "label": "", "floor_id": "main", "origin": "build", "x_m": 1.0, "y_m": 2.0, "z_m": 0.0,
                   "rotation": 0.0, "updated_at": _STAMP, "library_id": None, "submission_id": None,
                   "entity_reg_id": None, "entity_id": None}


def test_an_unknown_kind_param_or_key_is_kept_and_a_deleted_floor_is_accepted():
    """Contracts §1: unknown kinds and params are kept (an unknown kind is
    drawn as a box); the library's details sheet rides along; a floor that no
    longer exists is accepted (the plan)."""
    p = _sofa(recipe={"kind": "hammock_chair", "params": {"sway": 0.2, "rope": "jute", "tassels": True},
                      "colors": ["#aa8844"], "width_m": 1.0, "depth_m": 1.0, "height_m": 2.0,
                      "details": {"category": "seating", "title": "Hanging chair"}, "material": "rope"},
              floor_id="a_floor_since_deleted", from_the_future={"k": 1})
    out = H.apply_edit(H.empty(), _pieces(p))["pieces"]["fur_1a2b3c4d"]
    assert out["recipe"]["kind"] == "hammock_chair" and out["recipe"]["params"] == p["recipe"]["params"]
    assert out["recipe"]["details"] == {"category": "seating", "title": "Hanging chair"}
    assert out["recipe"]["material"] == "rope" and out["from_the_future"] == {"k": 1}
    assert out["floor_id"] == "a_floor_since_deleted"


def test_at_most_1000_pieces():
    full = {**H.empty(), "pieces": {f"fur_{i:08x}": _sofa(id=f"fur_{i:08x}") for i in range(H.MAX_PIECES)}}
    with pytest.raises(H.EditError, match="at most"):
        H.apply_edit(full, _pieces(_sofa(id="fur_ffffffff")))
    moved = H.apply_edit(full, _pieces(_sofa(id="fur_00000000", x_m=9.0)))
    assert moved["pieces"]["fur_00000000"]["x_m"] == 9.0, "at the cap, moving one still saves"


def test_a_set_keeps_what_the_file_had_that_it_does_not_know_and_a_removal_takes_it_all():
    have = {**H.empty(), "pieces": {"fur_1a2b3c4d": {**_sofa(), "glow_profile": "warm"},
                                    "fur_00000001": {**_sofa(id="fur_00000001"), "note": "n"}}}
    out = H.apply_edit(have, {"pieces": {"fur_1a2b3c4d": _sofa(x_m=5.0), "fur_00000001": None}})["pieces"]
    assert out["fur_1a2b3c4d"]["x_m"] == 5.0 and out["fur_1a2b3c4d"]["glow_profile"] == "warm"
    assert "fur_00000001" not in out, "a removed piece goes whole"


# ═══ atomic, and one write with the rest of the draft ═════════════════════════

def test_one_bad_piece_and_nothing_of_the_save_is_written(disk, tmp_path):  # noqa: F811
    before = {**H.empty(), "pieces": {"fur_1a2b3c4d": _sofa()}}
    _seed(tmp_path, before)
    raw = _file(tmp_path).read_bytes()
    h, conn = _on(tmp_path)
    out = _edit(h, conn, openings={"win_5e6f7a8b": dict(_WIN)}, lights={"light.kitchen": {"z_m": 2.0}},
                pieces={"fur_1a2b3c4d": _sofa(x_m=1.0), "fur_00000001": _sofa(id="fur_00000001", z_m=99)})
    assert out["error"] == "invalid" and "z_m" in out["message"]
    assert disk.writes == [] and _file(tmp_path).read_bytes() == raw
    assert h.data[DOMAIN][DATA_HOUSE3D].data == H.normalise(before)


def test_a_failed_write_changes_no_furniture(disk, tmp_path):  # noqa: F811
    before = {**H.empty(), "pieces": {"fur_1a2b3c4d": _sofa()}}
    _seed(tmp_path, before)
    h, conn = _on(tmp_path)
    store = _run(H.async_get_store(h))
    disk.fail = ["swallowed"]
    out = _edit(h, conn, pieces={"fur_1a2b3c4d": None})
    assert out["error"] == "save_failed" and store.data == before


def test_furniture_doors_and_heights_are_one_write(disk, tmp_path):  # noqa: F811
    h, conn = _on(tmp_path)
    out = _edit(h, conn, openings={"door_0a1b2c3d": dict(_DOOR)}, devices={"sensor.t": {"z_m": 1.4}},
                pieces={"fur_1a2b3c4d": _sofa(), "fur_00000001": _sofa(id="fur_00000001", floor_id="up", z_m=0.75)})
    assert disk.writes == [HOUSE3D_STORE_KEY]
    assert out["counts"] == {"pieces": 2, "lights": 0, "openings": 1, "devices": 1, "figures": 0}
    assert json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"] == out["data"]


# ═══ Remove all furniture ═════════════════════════════════════════════════════

def _clear(h, conn=None, **kw):
    conn = conn or MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 3, "type": "padspan_ha/house3d_clear", **kw}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1]}
    return conn.send_result.call_args[0][1]


def _furnished(tmp_path) -> dict:
    data = {**H.empty(), "pieces": {"fur_1a2b3c4d": _sofa(), "fur_00000001": _sofa(id="fur_00000001")},
            "openings": {"win_5e6f7a8b": dict(_WIN)}, "lights": {"light.a": {"z_m": 1.5}}, "library": {"x": 1},
            "future_top": [1]}
    _seed(tmp_path, data)
    return data


def test_remove_all_furniture_backs_up_first_then_removes_every_piece_and_keeps_the_rest(disk, tmp_path, monkeypatch):  # noqa: F811
    from custom_components.padspan_ha import ws_backup
    order = []

    async def _bk(hass, note, keys):
        order.append(("backup", note, tuple(keys), copy.deepcopy(hass.data[DOMAIN][DATA_HOUSE3D].data["pieces"])))
        return "bk_9"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    before = _furnished(tmp_path)
    h, _conn = _on(tmp_path, admin=True)
    out = _clear(h, only="pieces")
    assert out == {"cleared": True, "backup_id": "bk_9"}
    assert order[0][1] == "Before removing all furniture in Live Aboard" and order[0][2] == (HOUSE3D_STORE_KEY,)
    assert set(order[0][3]) == {"fur_1a2b3c4d", "fur_00000001"}, "the backup has the furniture"
    on_disk = json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]
    assert on_disk == {**before, "pieces": {}}, "every piece gone, everything else kept"
    assert h.data[DOMAIN][DATA_HOUSE3D].data == on_disk


def test_remove_all_furniture_no_backup_nothing_removed(disk, tmp_path, monkeypatch):  # noqa: F811
    from custom_components.padspan_ha import ws_backup

    async def _bk(*a):
        return None

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    _furnished(tmp_path)
    raw = _file(tmp_path).read_bytes()
    h, _conn = _on(tmp_path, admin=True)
    assert _clear(h, only="pieces") == {"error": "backup_failed"}
    assert disk.writes == [] and _file(tmp_path).read_bytes() == raw


@pytest.mark.parametrize("how", ["off", "free", "no furniture", "a newer file"])
def test_remove_all_furniture_refused_or_nothing_to_do_takes_no_backup(disk, tmp_path, monkeypatch, how):  # noqa: F811
    from custom_components.padspan_ha import ws_backup
    calls = []

    async def _bk(*a):
        calls.append(a)
        return "bk_1"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    if how == "no furniture":
        _seed(tmp_path, {**H.empty(), "lights": {"light.a": {"z_m": 1.0}}})
    elif how == "a newer file":
        _seed(tmp_path, {"schema": 2, "pieces": [{"id": "fur_1a2b3c4d"}]})
    else:
        _furnished(tmp_path)
    raw = _file(tmp_path).read_bytes()
    h, _conn = _on(tmp_path, tier="free" if how == "free" else "pro", admin=True)
    if how == "off":
        h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    out = _clear(h, only="pieces")
    want = {"off": {"error": W.OFF_CODE}, "free": {"error": W.OFF_CODE}, "a newer file": {"error": W.NEWER_CODE},
            "no furniture": {"cleared": True, "backup_id": None}}[how]
    assert out == want
    assert calls == [] and disk.writes == [] and _file(tmp_path).read_bytes() == raw


def test_remove_all_furniture_is_admin_only_and_takes_only_pieces():
    import inspect
    src = inspect.getsource(W)
    at = src.index("async def ws_house3d_clear(")
    assert "require_admin" in src[src.rindex("@websocket_api.websocket_command(", 0, at):at]
    schema = vol.Schema(W.ws_house3d_clear.ws_schema)
    assert schema({"type": "padspan_ha/house3d_clear", "only": "pieces"})["only"] == "pieces"
    for bad in ("lights", "everything", True):
        with pytest.raises(vol.Invalid):
            schema({"type": "padspan_ha/house3d_clear", "only": bad})


def test_restoring_the_remove_all_backup_brings_the_furniture_back(disk, tmp_path, monkeypatch):  # noqa: F811
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    before = _furnished(tmp_path)
    h, _conn = _on(tmp_path, admin=True)
    assert _clear(h, only="pieces")["backup_id"]
    assert h.data[DOMAIN][DATA_HOUSE3D].data["pieces"] == {}
    bk = box["backups"][-1]
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {"id": 4, "backup_id": bk["id"]}))
    assert h.data[DOMAIN][DATA_HOUSE3D].data["pieces"] == before["pieces"]
    assert json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]["pieces"] == before["pieces"]


# ═══ registration: backup, restore, factory reset, store version ═════════════

def test_a_backup_carries_furniture_saved_through_the_editor(disk, tmp_path, monkeypatch):  # noqa: F811
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    h, conn = _on(tmp_path)
    _edit(h, conn, **_pieces(_sofa(floor_id="up", z_m=0.75)))
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 1}))
    p = box["backups"][-1]["stores"][HOUSE3D_STORE_KEY]["pieces"]["fur_1a2b3c4d"]
    assert p["floor_id"] == "up" and p["z_m"] == 0.75


@pytest.mark.parametrize("older", ["no 3D file", "a 3D file with no pieces", "a 3D file with empty pieces",
                                   "a 3D file with broken pieces"])
def test_restoring_an_older_backup_with_no_furniture_leaves_the_furniture_alone(disk, tmp_path, monkeypatch, older):  # noqa: F811
    """The plan ("Undoing it"): restoring an older backup that has no
    furniture leaves the current furniture alone. One from before the 3D
    file, and one from P1 (doors, windows and heights, no furniture): the
    rest of the 3D file comes back as the backup has it."""
    _seed(tmp_path, {**H.empty(), "pieces": {"fur_1a2b3c4d": _sofa()}, "lights": {"light.a": {"z_m": 2.0}}})
    h, _conn = _on(tmp_path)
    p1 = {"schema": 1, "openings": {"win_5e6f7a8b": dict(_WIN)}, "lights": {"light.a": {"z_m": 1.0}}}
    stores = {SETTINGS_STORE_KEY: {"atlas_3d_enabled": True, "quiet_mode": True}}
    if older != "no 3D file":
        stores[HOUSE3D_STORE_KEY] = {**p1, **({"a 3D file with empty pieces": {"pieces": {}},
                                               "a 3D file with broken pieces": {"pieces": [1]}}.get(older, {}))}
    _restore(h, monkeypatch, stores)
    assert h.data[DOMAIN][DATA_SETTINGS].data["quiet_mode"] is True, "the restore ran"
    for data in (_run(H.async_get_store(h)).data, json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]):
        assert data["pieces"] == {"fur_1a2b3c4d": _sofa()}, older
        if older != "no 3D file":
            assert data["lights"] == {"light.a": {"z_m": 1.0}} and "win_5e6f7a8b" in data["openings"]


def test_restoring_a_backup_with_furniture_restores_its_furniture(disk, tmp_path, monkeypatch):  # noqa: F811
    _seed(tmp_path, {**H.empty(), "pieces": {"fur_00000001": _sofa(id="fur_00000001")}})
    h, _conn = _on(tmp_path)
    _restore(h, monkeypatch, {HOUSE3D_STORE_KEY: {**H.empty(), "pieces": {"fur_1a2b3c4d": _sofa()}}})
    assert set(_run(H.async_get_store(h)).data["pieces"]) == {"fur_1a2b3c4d"}


def test_a_factory_reset_empties_furniture_saved_through_the_editor(disk, tmp_path):  # noqa: F811
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    h, conn = _on(tmp_path)
    _edit(h, conn, **_pieces(_sofa()))
    reset = MagicMock()
    _run(ws_factory_reset(h, reset, {"id": 1, "confirm": "FACTORY RESET"}))
    assert json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"] == H.empty()
    assert h.data[DOMAIN][DATA_HOUSE3D].data == H.empty()


def test_furniture_is_saved_at_store_version_one(store, tmp_path):  # noqa: F811
    """Home Assistant refuses a file of another major version, and the next
    Save would then write an empty house over it: version 1 forever, shape
    changes through the data's own schema."""
    h, conn = _on(tmp_path)
    _edit(h, conn, **_pieces(_sofa()))
    assert h.data[DOMAIN][DATA_HOUSE3D]._raw_store.version == 1
    saved = store.saved[HOUSE3D_STORE_KEY]
    assert saved["schema"] == 1 and saved["pieces"]["fur_1a2b3c4d"]["recipe"]["kind"] == "sofa"


# ═══ editing furniture changes no other file ═════════════════════════════════

def test_editing_furniture_changes_no_other_file(disk, tmp_path):  # noqa: F811
    """The fabric (rooms, walls, light positions), the model, the maps and the
    settings keep every byte through adding, moving, raising, moving between
    floors and removing furniture; the 3D file is the only write."""
    seeds = {
        FABRIC_STORE_KEY: {"rf_barriers_m": [{"id": "bar_a71a3324", "floor_id": "main",
                                              "points_m": [[3.035, -9.228], [5.46, -9.255]]}],
                           "light_positions_m": {"light.lounge_lamp": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"}}},
        MODEL_STORE_KEY: {"floors": [{"id": "main"}, {"id": "up"}], "scanner_positions_m": {"aa": {"z_m": 2.1}}},
        MAPS_STORE_KEY: {"maps": [{"id": "m1", "name": "Main floor"}]},
        SETTINGS_STORE_KEY: {"atlas_3d_enabled": True},
    }
    for k, v in seeds.items():
        _seed(tmp_path, v, k)
    raw = {k: _file(tmp_path, k).read_bytes() for k in seeds}
    h, conn = _on(tmp_path)
    live = {DATA_MODEL: {"light_positions_m": {"light.lounge_lamp": {"x_m": 1.0}}}, DATA_FABRIC: {"rf_barriers_m": []}}
    for k, v in live.items():
        h.data[DOMAIN][k] = copy.deepcopy(v)
    _edit(h, conn, **_pieces(_sofa(entity_id="light.lounge_lamp")))
    _edit(h, conn, **_pieces(_sofa(floor_id="up", z_m=0.9, rotation=105)))
    _edit(h, conn, pieces={"fur_1a2b3c4d": None})
    assert disk.writes == [HOUSE3D_STORE_KEY] * 3
    for k in seeds:
        assert _file(tmp_path, k).read_bytes() == raw[k], k
    for k, v in live.items():
        assert h.data[DOMAIN][k] == v, k
