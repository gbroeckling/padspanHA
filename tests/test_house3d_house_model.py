# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard, the house itself: stairs, doorways and doors shown open, in
the 3D file (house3d_edit). Garry, 2026-10-05: "Lots still missing on the
sims view." Held here:
- a doorway ("doorway_" + 8 hex digits): an opening with no door in it, drawn
  along a wall like a door, checked as one (its ends, its head, nothing else);
- a door with no sensor is shown open, ajar or shut: an added door's "shown",
  and a map door's override, round trip and are checked against the list;
- stairs are a piece (recipe kind "stairs"): their shape, turn, the floor
  they reach, a footprint at least half a metre each way and a rise in range
  are checked the way every piece is, and the rest of a piece's rules hold;
- the map is never written: only the 3D file changes.
"""

from __future__ import annotations

import copy
import json

import pytest

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha.const import FABRIC_STORE_KEY, HOUSE3D_STORE_KEY, MODEL_STORE_KEY
from tests.test_house3d_edit import _DOOR, _WIN, _edit, _file, _on, _seed, disk  # noqa: F401
from tests.test_house3d_pieces import _SOFA

_WAY = {"kind": "doorway", "floor_id": "main", "a_m": [1.0, 0.0], "b_m": [2.2, 0.0], "head_m": 2.1}
_STAIRS = {**copy.deepcopy(_SOFA), "id": "fur_5a6b7c8d",
           "recipe": {"kind": "stairs", "params": {"shape": "straight", "turn": "left", "to_floor": "upper"},
                      "colors": ["#8b6a4f", "#e8e2d6", "#3d3a36"], "width_m": 0.95, "depth_m": 3.6, "height_m": 2.3},
           "rotation": 0.0}


def _stairs(**params) -> dict:
    p = copy.deepcopy(_STAIRS)
    p["recipe"]["params"].update(params)
    return {"pieces": {p["id"]: p}}


def _stairs_size(**size) -> dict:
    p = copy.deepcopy(_STAIRS)
    p["recipe"].update(size)
    return {"pieces": {p["id"]: p}}


# ═══ a doorway ════════════════════════════════════════════════════════════════

def test_a_doorway_is_kept_as_drawn() -> None:
    out = H.apply_edit(H.empty(), {"openings": {"doorway_0a1b2c3d": dict(_WAY)}})
    assert out["openings"]["doorway_0a1b2c3d"] == _WAY


@pytest.mark.parametrize("why,entry", [
    ("narrower than a door", {**_WAY, "b_m": [1.5, 0.0]}),
    ("with a hinge", {**_WAY, "hinge": "left"}),
    ("with a sill", {**_WAY, "sill_m": 0.5}),
    ("shown open", {**_WAY, "shown": "open"}),
    ("with no head", {k: v for k, v in _WAY.items() if k != "head_m"}),
    ("a head too low", {**_WAY, "head_m": 0.4}),
    ("of another kind", {**_WAY, "kind": "door"}),
])
def test_a_doorway_is_checked_as_one(why, entry) -> None:
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"openings": {"doorway_0a1b2c3d": entry}})


@pytest.mark.parametrize("key", ["doorway_0A1B2C3D", "doorway_0a1b2c3", "doorway_zzzzzzzz", "doorway_0a1b2c3d\n"])
def test_a_doorway_id_is_doorway_and_eight_hex_digits(key) -> None:
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"openings": {key: dict(_WAY)}})


def test_a_door_id_holding_a_doorway_is_refused() -> None:
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"openings": {"door_0a1b2c3d": dict(_WAY)}})


def test_a_doorway_removed_goes_whole() -> None:
    base = H.apply_edit(H.empty(), {"openings": {"doorway_0a1b2c3d": dict(_WAY)}})
    out = H.apply_edit(base, {"openings": {"doorway_0a1b2c3d": None}})
    assert "doorway_0a1b2c3d" not in out["openings"]


# ═══ a door shown open, ajar or shut ══════════════════════════════════════════

@pytest.mark.parametrize("shown", list(H.DOOR_SHOWN))
def test_an_added_doors_shown_state_round_trips(shown) -> None:
    out = H.apply_edit(H.empty(), {"openings": {"door_0a1b2c3d": {**_DOOR, "shown": shown}}})
    assert out["openings"]["door_0a1b2c3d"] == {**_DOOR, "shown": shown}
    # Saved again without it: back to the default (the entry is the editor's whole).
    again = H.apply_edit(out, {"openings": {"door_0a1b2c3d": dict(_DOOR)}})
    assert again["openings"]["door_0a1b2c3d"] == _DOOR


@pytest.mark.parametrize("shown", list(H.DOOR_SHOWN))
def test_a_map_doors_shown_state_round_trips(shown) -> None:
    out = H.apply_edit(H.empty(), {"openings": {"bar_a71a3324": {"hinge": "right", "shown": shown}}})
    assert out["openings"]["bar_a71a3324"] == {"hinge": "right", "shown": shown}


@pytest.mark.parametrize("entry", [{**_DOOR, "shown": "half"}, {**_DOOR, "shown": True}, {**_WIN, "shown": "open"}])
def test_shown_is_open_ajar_or_shut_and_only_on_a_door(entry) -> None:
    key = "win_5e6f7a8b" if entry["kind"] == "window" else "door_0a1b2c3d"
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"openings": {key: entry}})
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"openings": {"bar_a71a3324": {"shown": "wide"}}})


def test_through_the_websocket_command_only_the_3d_file_is_written(disk, tmp_path) -> None:  # noqa: F811
    seeds = {FABRIC_STORE_KEY: {"rf_barriers_m": [{"id": "bar_a71a3324", "name": "Door", "material": "wood",
                                                   "floor_id": "main", "points_m": [[3.0, 0.0], [3.9, 0.0]]}]},
             MODEL_STORE_KEY: {"floors": [{"id": "main", "name": "Main"}, {"id": "upper", "name": "Upper"}]}}
    for k, v in seeds.items():
        _seed(tmp_path, v, k)
    raw = {k: _file(tmp_path, k).read_bytes() for k in seeds}
    h, conn = _on(tmp_path)
    out = _edit(h, conn, openings={"door_0a1b2c3d": {**_DOOR, "shown": "shut"}, "doorway_0a1b2c3d": dict(_WAY),
                                   "bar_a71a3324": {"shown": "open"}}, pieces=_stairs()["pieces"])
    assert "error" not in out, out
    data = json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]
    assert data["openings"]["door_0a1b2c3d"]["shown"] == "shut"
    assert data["openings"]["doorway_0a1b2c3d"] == _WAY
    assert data["openings"]["bar_a71a3324"] == {"shown": "open"}
    assert data["pieces"]["fur_5a6b7c8d"]["recipe"]["kind"] == "stairs"
    assert {k: _file(tmp_path, k).read_bytes() for k in seeds} == raw
    assert {w for w in disk.writes} <= {HOUSE3D_STORE_KEY}, disk.writes


# ═══ stairs ═══════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("shape", list(H.STAIR_SHAPES))
@pytest.mark.parametrize("turn", list(H.STAIR_TURNS))
def test_stairs_are_kept_as_a_piece(shape, turn) -> None:
    out = H.apply_edit(H.empty(), _stairs(shape=shape, turn=turn))
    p = out["pieces"]["fur_5a6b7c8d"]
    assert p["recipe"]["kind"] == "stairs" and p["recipe"]["params"] == {"shape": shape, "turn": turn, "to_floor": "upper"}
    assert p["recipe"]["height_m"] == 2.3 and p["floor_id"] == "main"


def test_stairs_with_no_floor_named_reach_the_next_floor_up() -> None:
    p = copy.deepcopy(_STAIRS)
    del p["recipe"]["params"]["to_floor"]
    out = H.apply_edit(H.empty(), {"pieces": {p["id"]: p}})
    assert "to_floor" not in out["pieces"]["fur_5a6b7c8d"]["recipe"]["params"]


@pytest.mark.parametrize("why,changes", [
    ("a shape not straight, L or U", _stairs(shape="spiral")),
    ("a turn not left or right", _stairs(turn="up")),
    ("a blank floor", _stairs(to_floor=" ")),
    ("a floor that is a number", _stairs(to_floor=3)),
    ("narrower than half a metre", _stairs_size(width_m=0.4)),
    ("shorter than half a metre", _stairs_size(depth_m=0.3)),
    ("a rise under 0.3 m", _stairs_size(height_m=0.2)),
    ("a rise over 8 m", _stairs_size(height_m=8.5)),
])
def test_stairs_are_checked_the_way_pieces_are(why, changes) -> None:
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), changes)


def test_stairs_keep_a_piece_s_other_rules_and_unknown_params() -> None:
    p = copy.deepcopy(_STAIRS)
    p["recipe"]["params"]["newer"] = "kept"
    p["future_key"] = 1
    out = H.apply_edit(H.empty(), {"pieces": {p["id"]: p}})
    got = out["pieces"]["fur_5a6b7c8d"]
    assert got["recipe"]["params"]["newer"] == "kept" and got["future_key"] == 1
    bad = copy.deepcopy(_STAIRS)
    bad["x_m"] = float("nan")
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"pieces": {bad["id"]: bad}})


def test_a_sofa_is_not_checked_as_stairs() -> None:
    p = copy.deepcopy(_SOFA)
    p["recipe"]["params"]["shape"] = "spiral"
    p["recipe"]["width_m"] = 0.3
    assert H.apply_edit(H.empty(), {"pieces": {p["id"]: p}})["pieces"][p["id"]]["recipe"]["params"]["shape"] == "spiral"
