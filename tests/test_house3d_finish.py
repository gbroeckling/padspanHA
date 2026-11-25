# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard, Furnish's floors and walls (the owner's item 22, 2026-11-23):
each room's floor material and wall colours, and each floor's outside wall
colour, in the 3D file's "rooms" and "floors" (house3d_store.py).

Held here: what a Save may hold (a material from the short list, or another
short word a newer version wrote, kept; colours as #rrggbb; a wall by its
number), each entry the editor's whole while a newer version's keys stay; a
Save at Pro by any user; the file read back after a restart; a PadSpan backup
carrying them and a restore bringing them back; nothing chosen, nothing in
the file; and the opt-in report's words (counts only, never a room or a
colour). tests/test_live_aboard_finish.py runs the screens.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d as W
from custom_components.padspan_ha.const import DATA_HOUSE3D, DOMAIN, HOUSE3D_STORE_KEY
from tests.test_house3d_edit import _edit, _file, _on, _seed, disk  # noqa: F401
from tests.test_house3d_store import _capture_backups, _restore, _run

_DEN = {"floor": "wood", "wall": "#3f6e8c", "walls": {"0": "#aa3322", "2": "#ffffff"}}


# ═══ what a Save may hold ════════════════════════════════════════════════════

def test_a_rooms_floor_and_walls_and_a_floors_outside_walls_are_kept() -> None:
    out = H.apply_edit(H.empty(), {"rooms": {"Den": dict(_DEN), "Hall": {"floor": "light_wood"}},
                                   "floors": {"main": {"outside": "#C8B89A"}}})
    assert out["rooms"] == {"Den": _DEN, "Hall": {"floor": "light_wood"}}
    assert out["floors"] == {"main": {"outside": "#c8b89a"}}, "colours kept in lower case"
    assert set(H.FLOOR_MATERIALS) == {"wood", "light_wood", "tile", "stone", "carpet", "concrete"}
    for m in H.FLOOR_MATERIALS:
        assert H.apply_edit(H.empty(), {"rooms": {"Den": {"floor": m}}})["rooms"]["Den"] == {"floor": m}


@pytest.mark.parametrize("section, key, entry", [
    ("rooms", "Den", {"floor": "Wood"}),                     # not a short lowercase word
    ("rooms", "Den", {"floor": 3}),
    ("rooms", "Den", {"wall": "blue"}),
    ("rooms", "Den", {"wall": "#12345"}),
    ("rooms", "Den", {"walls": {"0": "#zzzzzz"}}),
    ("rooms", "Den", {"walls": {"-1": "#ffffff"}}),
    ("rooms", "Den", {"walls": {"200": "#ffffff"}}),
    ("rooms", "Den", {"walls": {}}),
    ("rooms", "Den", {"walls": ["#ffffff"]}),
    ("rooms", "Den", {"ceiling": "#ffffff"}),                # not the editor's
    ("rooms", "Den", {}),
    ("rooms", "Den", "wood"),
    ("rooms", "x" * 101, {"floor": "wood"}),
    ("rooms", "Den\n", {"floor": "wood"}),
    ("floors", "main", {"outside": "white"}),
    ("floors", "main", {"outside": "#ffffff", "inside": "#000000"}),
    ("floors", "main", {}),
])
def test_anything_else_is_refused_and_nothing_changes(section, key, entry) -> None:
    base = H.apply_edit(H.empty(), {"rooms": {"Den": dict(_DEN)}})
    with pytest.raises(H.EditError):
        H.apply_edit(base, {section: {key: entry}})
    assert base["rooms"] == {"Den": _DEN}


def test_a_newer_versions_material_and_keys_stay() -> None:
    """A material this version does not know (a short word) is kept, and drawn
    as the room's colour; keys a newer version added to an entry stay through
    this version's Save, which owns only floor, wall and walls."""
    newer = {**H.empty(), "rooms": {"Den": {"floor": "marble", "trim": "#111111"}}, "floors": {"main": {"outside": "#222222", "roof": "slate"}}}
    out = H.apply_edit(newer, {"rooms": {"Den": {"floor": "terrazzo", "wall": "#333333"}}, "floors": {"main": {"outside": "#444444"}}})
    assert out["rooms"]["Den"] == {"floor": "terrazzo", "wall": "#333333", "trim": "#111111"}
    assert out["floors"]["main"] == {"outside": "#444444", "roof": "slate"}
    gone = H.apply_edit(out, {"rooms": {"Den": None}, "floors": {"main": None}})
    assert gone["rooms"] == {"Den": {"trim": "#111111"}} and gone["floors"] == {"main": {"roof": "slate"}}


def test_each_entry_is_the_editors_whole_and_none_removes_it() -> None:
    a = H.apply_edit(H.empty(), {"rooms": {"Den": dict(_DEN)}, "floors": {"main": {"outside": "#c8b89a"}}})
    b = H.apply_edit(a, {"rooms": {"Den": {"wall": "#3f6e8c"}}})         # floor and walls left out: they go
    assert b["rooms"] == {"Den": {"wall": "#3f6e8c"}}
    c = H.apply_edit(b, {"rooms": {"Den": None}, "floors": {"main": None}})
    assert c["rooms"] == {} and c["floors"] == {}
    assert H.apply_edit(c, {"rooms": {"Gone": None}})["rooms"] == {}, "removing what is not there is no change"


def test_nothing_chosen_nothing_in_the_file() -> None:
    """A new house and a file from before: empty sections, counted as none."""
    assert H.empty()["rooms"] == {} and H.empty()["floors"] == {}
    old = H.normalise({"schema": 1, "pieces": {}, "openings": {}, "lights": {}, "devices": {}, "figures": {}, "rails_chosen": True})
    assert old["rooms"] == {} and old["floors"] == {}


def test_the_command_takes_both_sections() -> None:
    keys = {str(k) for k in W.ws_house3d_edit.ws_schema}
    assert {"rooms", "floors"} <= keys
    assert {"rooms", "floors"} <= set(H.EDIT_SECTIONS) and {"rooms", "floors"} <= set(H.SECTIONS)


# ═══ saved, read back, backed up, restored ═══════════════════════════════════

def test_any_user_at_pro_saves_them_and_a_restart_reads_them_back(disk, tmp_path):  # noqa: F811
    h, conn = _on(tmp_path, admin=False)
    out = _edit(h, conn, rooms={"Den": dict(_DEN)}, floors={"main": {"outside": "#c8b89a"}})
    assert out["data"]["rooms"] == {"Den": _DEN} and out["counts"]["rooms"] == 1 and out["counts"]["floors"] == 1
    on_disk = json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]
    assert on_disk["rooms"] == {"Den": _DEN} and on_disk["floors"] == {"main": {"outside": "#c8b89a"}}
    h.data[DOMAIN].pop(DATA_HOUSE3D)                                       # a restart: read from the file again
    again = _run(H.async_get_store(h)).data
    assert again["rooms"] == {"Den": _DEN} and again["floors"] == {"main": {"outside": "#c8b89a"}}
    get = MagicMock()
    _run(W.ws_house3d_get(h, get, {"id": 2}))
    assert get.send_result.call_args[0][1]["data"]["rooms"] == {"Den": _DEN}


def test_refused_while_off_like_every_other_save(disk, tmp_path):  # noqa: F811
    from custom_components.padspan_ha.const import DATA_SETTINGS
    h, conn = _on(tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    assert _edit(h, conn, rooms={"Den": dict(_DEN)})["error"] == W.OFF_CODE
    assert not _file(tmp_path).exists()


def test_a_backup_carries_them_and_a_restore_brings_them_back(disk, tmp_path, monkeypatch):  # noqa: F811
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    h, conn = _on(tmp_path)
    _edit(h, conn, rooms={"Den": dict(_DEN)}, floors={"main": {"outside": "#c8b89a"}})
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 1}))
    bk = box["backups"][-1]
    assert bk["stores"][HOUSE3D_STORE_KEY]["rooms"] == {"Den": _DEN}
    assert bk["stores"][HOUSE3D_STORE_KEY]["floors"] == {"main": {"outside": "#c8b89a"}}
    # Changed since, then the backup restored: as they were when it was taken.
    _edit(h, conn, rooms={"Den": {"floor": "tile"}, "Hall": {"wall": "#000000"}}, floors={"main": None})
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {"id": 2, "backup_id": bk["id"]}))
    for data in (h.data[DOMAIN][DATA_HOUSE3D].data, json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]):
        assert data["rooms"] == {"Den": _DEN} and data["floors"] == {"main": {"outside": "#c8b89a"}}


def test_restoring_a_backup_from_before_them_draws_the_house_as_it_was(disk, tmp_path, monkeypatch):  # noqa: F811
    """A backup taken before anything was chosen restores to nothing chosen
    (unlike furniture, which a backup with none leaves alone: the plan's
    rule is for pieces placed since, not for a look)."""
    _seed(tmp_path, {**H.empty(), "rooms": {"Den": dict(_DEN)}})
    h, _conn = _on(tmp_path)
    _restore(h, monkeypatch, {HOUSE3D_STORE_KEY: {"schema": 1, "openings": {}, "lights": {}, "pieces": {}}})
    assert _run(H.async_get_store(h)).data["rooms"] == {}


# ═══ the opt-in report ═══════════════════════════════════════════════════════

def test_the_report_counts_words_only() -> None:
    from tests.test_live_aboard_show import _hass
    want = {"house3d_finish:drawn", "house3d_finish:wall", "house3d_finish:one_wall", "house3d_finish:outside",
            *(f"house3d_finish:floor:{m}" for m in H.FLOOR_MATERIALS)}
    assert T.HOUSE3D_FINISH_EVENTS == want and want <= T.HOUSE3D_EVENTS
    assert T.HOUSE3D_FLOOR_MATERIALS == H.FLOOR_MATERIALS
    h = _hass()
    for name in want:
        assert T.bump(h, name), name
    for bad in ("house3d_finish:floor:marble", "house3d_finish:wall:#ffffff", "house3d_finish:floor:Den", "house3d_finish:room:Den"):
        assert not T.bump(h, bad), bad
    T.assert_shareable(T.build_payload(h))
