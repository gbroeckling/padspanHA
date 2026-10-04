# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P7: the import preview (ws_house3d_import.house3d_import_preview).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("P7 Import"; "Done when": a real .sh3d
imports, declining the preview writes nothing). Held here:
- refused while off and below Pro (as if off), and nothing touched;
- the light-placement gate: any user at the tier, no admin (the room import
  keeps its own admin gate);
- the room import's upload mechanism and limits (base64, 10 MB, its parse
  errors);
- the preview WRITES NOTHING, reads nothing but the upload: every store's
  bytes and the live map are unchanged, and the 3D file is not even loaded;
- words → PadSpan kinds, anything unmatched a box of its size; doors and
  windows by their words, else by their shape;
- the candidates are the 3D file's own shapes (contracts §2, the P1 added
  openings), and the openings pass the server's own check once given a floor.
"""

from __future__ import annotations

import base64
import copy
import inspect
import json
import math
import re
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_store as HS
from custom_components.padspan_ha import ws_floorplan_import as WFI
from custom_components.padspan_ha import ws_house3d as W3
from custom_components.padspan_ha import ws_house3d_import as WI
from custom_components.padspan_ha.const import (DATA_FABRIC, DATA_HOUSE3D, DATA_MODEL, DATA_SETTINGS, DOMAIN,
                                                FABRIC_STORE_KEY, HOUSE3D_STORE_KEY, MAPS_STORE_KEY,
                                                MODEL_STORE_KEY, SETTINGS_STORE_KEY)
from tests.test_house3d_edit import _file, _on, _seed, disk  # noqa: F401  (disk: the on-disk store fixture)
from tests.test_house3d_store import _run
from tests.test_sh3d_furniture import _FURNISHED, _ROOMS, _home, _make_sh3d

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_PIECE_KEYS = {"id", "recipe", "origin", "label", "library_id", "submission_id", "floor_id", "x_m", "y_m", "z_m",
               "rotation", "entity_id", "entity_reg_id"}


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


_FILE = _b64(_make_sh3d(_home(_ROOMS + _FURNISHED)))


def _preview(h, conn, b64: str = _FILE):
    _run(WI.ws_house3d_import_preview(h, conn, {"id": 9, "type": "padspan_ha/house3d_import_preview",
                                                "sh3d_base64": b64}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


def _decorators(fn) -> str:
    src = inspect.getsource(inspect.getmodule(fn))
    at = src.index(f"async def {fn.__name__}(")
    return src[src.rindex("@websocket_api.websocket_command(", 0, at):at]


# ═══ refused, and nothing touched ════════════════════════════════════════════

def test_refused_while_off_and_nothing_is_read_or_written(disk, tmp_path):
    h, conn = _on(tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    out = _preview(h, conn)
    assert out["error"] == W3.OFF_CODE and out["message"] == W3.OFF_MESSAGE
    assert disk.writes == [] and not _file(tmp_path).exists()


@pytest.mark.parametrize("tier", ["free", "bright"])
def test_below_pro_it_is_as_if_off_whatever_the_switch_says(disk, tmp_path, tier):
    h, conn = _on(tmp_path, tier=tier)
    out = _preview(h, conn)
    assert out["error"] == W3.OFF_CODE and "Pro" in out["message"] and "padspan.traks.ca" in out["message"]
    assert disk.writes == [] and not _file(tmp_path).exists()


def test_the_light_placement_gate_any_user_no_admin(disk, tmp_path):
    """Making furniture is the light-placement gate inside the Pro-only
    feature (the plan's choice 2), so a non-admin user at Pro previews. The
    room import keeps its own admin gate."""
    assert "require_admin" not in _decorators(WI.ws_house3d_import_preview)
    assert "require_admin" not in _decorators(W3.ws_house3d_edit)
    assert "require_admin" in _decorators(WFI.ws_floorplan_import_sh3d)
    h, conn = _on(tmp_path, admin=False)
    out = _preview(h, conn)
    assert len(out["pieces"]) == 5 and len(out["openings"]) == 2


def test_registered_with_its_schema_beside_the_3d_house_commands():
    assert WI.WS_COMMANDS == (WI.ws_house3d_import_preview,)
    assert {str(k) for k in WI.ws_house3d_import_preview.ws_schema} == {"type", "sh3d_base64"}
    assert WI.ws_house3d_import_preview.ws_schema["type"] == "padspan_ha/house3d_import_preview"
    ws = (_CC / "websocket.py").read_text(encoding="utf-8")
    at = ws.index("from .ws_house3d import WS_COMMANDS as _house3d_commands")
    mine = ws.index("from .ws_house3d_import import WS_COMMANDS as _house3d_import_commands")
    assert at < mine and "for _cmd in _house3d_import_commands:\n        websocket_api.async_register_command(hass, _cmd)" in ws


# ═══ the room import's upload mechanism and limits ═══════════════════════════

def test_the_room_imports_upload_limit_and_field(disk, tmp_path):
    assert WI.MAX_SH3D_BYTES is WFI.MAX_SH3D_BYTES == 10 * 1024 * 1024
    h, conn = _on(tmp_path)
    out = _preview(h, conn, "A" * ((WFI.MAX_SH3D_BYTES * 4) // 3 + 8))
    assert out["error"] == "upload_too_large" and "10 MB" in out["message"]


@pytest.mark.parametrize("b64,code,words", [
    ("not base64!!", "bad_base64", "decode"),
    (_b64(b"not a zip at all"), "parse_failed", "not a ZIP"),
    (_b64(_make_sh3d('<?xml version="1.0"?><!DOCTYPE home [<!ENTITY a "a">]><home/>')), "parse_failed", "DOCTYPE"),
    (_b64(_make_sh3d("<home><pieceOfFurniture")), "parse_failed", "not valid XML"),
    ("", "parse_failed", "not a ZIP"),
])
def test_what_cannot_be_read_is_said_plainly_and_nothing_is_written(disk, tmp_path, b64, code, words):
    h, conn = _on(tmp_path)
    out = _preview(h, conn, b64)
    assert out["error"] == code and words in out["message"], out
    assert disk.writes == []


# ═══ it writes nothing ═══════════════════════════════════════════════════════

def test_the_preview_writes_nothing_and_reads_nothing_but_the_upload(disk, tmp_path):
    """Declining the preview writes nothing because the preview itself
    never writes: the 3D file, the fabric, the model, the maps and the
    settings keep every byte, the live map is unchanged, and the 3D file is
    not even loaded."""
    seeds = {
        HOUSE3D_STORE_KEY: {"schema": 1, "pieces": {}, "openings": {"win_5e6f7a8b": {
            "kind": "window", "floor_id": "main", "a_m": [2.1, -9.23], "b_m": [3.3, -9.23], "sill_m": 0.9,
            "head_m": 2.1}}},
        FABRIC_STORE_KEY: {"rf_barriers_m": [{"id": "bar_a71a3324", "name": "Barrier 1", "material": "metal",
                                              "floor_id": "main", "points_m": [[3.035, -9.228], [5.46, -9.255]]}],
                           "room_geometry_m": {"Kitchen": {"floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 3]]}}},
        MODEL_STORE_KEY: {"floors": [{"id": "main", "name": "Main"}]},
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
    h.data[DOMAIN].pop(DATA_HOUSE3D, None)
    for _ in range(3):
        conn.reset_mock()
        out = _preview(h, conn)
        assert len(out["pieces"]) == 5
    assert disk.writes == []
    for k in seeds:
        assert _file(tmp_path, k).read_bytes() == raw[k], k
    for k, v in live.items():
        assert h.data[DOMAIN][k] == v, k
    assert DATA_HOUSE3D not in h.data[DOMAIN], "the 3D file is never loaded by a preview"


def test_the_answer_is_plain_json(disk, tmp_path):
    h, conn = _on(tmp_path)
    out = _preview(h, conn)
    assert json.loads(json.dumps(out)) == out


# ═══ words → PadSpan kinds; anything else a box ══════════════════════════════

@pytest.mark.parametrize("name,catalog,kind", [
    ("Sofa", "", "sofa"), ("Couch", "", "sofa"), ("Settee", "", "sofa"), ("Corner sofa", "", "sofa"),
    ("Sofa 3 seats", "", "sofa"), ("Sofa bed", "", "sofa"), ("Canapé d'angle", "", "sofa"),
    ("Bed", "", "bed"), ("Double bed 140x190", "", "bed"), ("Bunk bed", "", "bed"), ("Crib", "", "bed"),
    ("Lit double", "", "bed"), ("Bett", "", "bed"),
    ("Table", "", "table"), ("Coffee table", "", "table"), ("Dining tables", "", "table"), ("Esstisch", "", "box"),
    ("Chair", "", "chair"), ("Office chair", "", "chair"), ("Stool", "", "chair"), ("Bar stools", "", "chair"),
    ("Armchair", "", "chair"),
    ("Desk", "", "desk"), ("Writing desk", "", "desk"), ("Schreibtisch", "", "desk"),
    ("Dresser", "", "dresser"), ("Chest of drawers", "", "dresser"), ("Sideboard", "", "dresser"),
    ("Kitchen cabinet", "", "dresser"), ("Bedside table", "", "dresser"), ("Nightstand", "", "dresser"),
    ("TV", "", "tv"), ("Television", "", "tv"), ("TV cabinet", "", "tv"), ("", "eTeks#tvUnit", "tv"),
    ("Flat screen TV", "", "tv"),
    ("Lamp", "", "lamp"), ("Table lamp", "", "lamp"), ("Desk lamp", "", "lamp"), ("Floor light", "", "lamp"),
    ("Light oak bookcase", "", "shelf"),
    ("Rug", "", "rug"), ("Carpet", "", "rug"), ("Bath mat", "", "rug"),
    ("Shelf", "", "shelf"), ("Shelves", "", "shelf"), ("Bookcase", "", "shelf"),
    ("Wardrobe", "", "wardrobe"), ("Closet", "", "wardrobe"), ("Kleiderschrank", "", "wardrobe"),
    ("Plant", "", "plant"), ("Potted plants", "", "plant"), ("Ficus tree", "", "plant"),
    ("Washing machine", "", "washer"), ("Washer", "", "washer"), ("Dryer", "", "dryer"),
    ("Tumble dryer", "", "dryer"), ("Radiator", "", "radiator"), ("Ceiling fan", "", "fan"),
    ("Speaker", "", "speaker"),
    ("Fridge", "", "box"), ("Chest freezer", "", "box"), ("Dishwasher", "", "box"), ("Thingamajig", "", "box"),
    ("", "", "box"), ("Stuff", "eTeks#doubleBed", "bed"), ("", "Scopia#sofa_corner", "sofa"),
    ("Bed", "eTeks#chair", "bed"),
])
def test_words_map_onto_padspans_own_kinds(name, catalog, kind):
    got, word = WI.kind_of({"tag": "pieceOfFurniture", "name": name, "catalog": catalog, "category": ""})
    assert got == kind, (name, catalog, got, word)
    assert (word is None) == (kind == "box" and name not in ("Fridge", "Chest freezer", "Dishwasher"))


def test_a_light_with_no_telling_words_is_a_lamp_and_its_words_still_win():
    assert WI.kind_of({"tag": "light", "name": "Halogen 50W", "catalog": "", "category": ""}) == ("lamp", "light")
    assert WI.kind_of({"tag": "light", "name": "Aquarium", "catalog": "", "category": ""})[0] == "lamp"
    assert WI.kind_of({"tag": "light", "name": "Plant", "catalog": "", "category": ""})[0] == "plant"


def test_the_table_is_small_and_lowercase_and_every_kind_is_a_padspan_name():
    for phrase, kind in WI.KIND_PHRASES:
        assert phrase == phrase.lower() and kind in WI.KIND_WORDS, phrase
    seen: set[str] = set()
    for kind, words in WI.KIND_WORDS.items():
        assert re.fullmatch(r"[a-z]+", kind) and words, kind
        for w in words:
            assert re.fullmatch(r"[a-z]+", w) and w not in seen, w
            seen.add(w)
    assert WI.BOX == "box" and len(seen) < 250


@pytest.mark.parametrize("name,elev,height,kind,word", [
    ("Front door", 0.0, 2.08, "door", "door"), ("Garage door", 0.0, 2.2, "door", "door"),
    ("Garden gate", 0.0, 1.2, "door", "gate"), ("Window", 0.9, 1.2, "window", "window"),
    ("Skylight", 2.4, 0.8, "window", "skylight"), ("Fenêtre", 0.9, 1.2, "window", "fenetre"),
    ("Porte-fenêtre", 0.0, 2.15, "door", None), ("Glazing", 0.0, 2.15, "door", None),
    ("Glazing", 0.9, 1.2, "window", None), ("Opening", 0.0, 1.0, "window", None),
])
def test_doors_and_windows_by_their_words_else_by_their_shape(name, elev, height, kind, word):
    assert WI.opening_kind({"name": name, "catalog": "", "category": "", "elevation_m": elev,
                            "height_m": height}) == (kind, word)


# ═══ the candidates ══════════════════════════════════════════════════════════

def test_pieces_are_the_3d_files_own_shape_kind_and_size_only():
    out = WI.preview(_make_sh3d(_home(_ROOMS + _FURNISHED)))
    assert {lv["id"] for lv in out["levels"]} == {"lvl0", "lvl1"}
    ids = list(out["pieces"])
    assert len(set(ids)) == 5 and all(re.fullmatch(r"fur_[0-9a-f]{8}", i) for i in ids)
    for pid, pc in out["pieces"].items():
        assert set(pc) == _PIECE_KEYS and pc["id"] == pid
        assert pc["origin"] == "import" and pc["floor_id"] is None
        assert pc["library_id"] is None and pc["submission_id"] is None
        assert pc["entity_id"] is None and pc["entity_reg_id"] is None
        assert set(pc["recipe"]) == {"kind", "params", "colors", "width_m", "depth_m", "height_m"}
        assert pc["recipe"]["params"] == {} and pc["recipe"]["colors"] == []
        assert 0.0 <= pc["rotation"] < 360.0 and 0.0 <= pc["z_m"] <= 20.0
    by = {pc["label"]: pc for pc in out["pieces"].values()}
    sofa = by["Corner sofa"]
    assert sofa["recipe"] == {"kind": "sofa", "params": {}, "colors": [], "width_m": 2.2, "depth_m": 0.9,
                              "height_m": 0.8}
    assert (sofa["x_m"], sofa["y_m"], sofa["z_m"], sofa["rotation"]) == (2.0, 1.5, 0.0, 180.0)
    assert by["Ceiling light"]["recipe"]["kind"] == "lamp" and by["Ceiling light"]["z_m"] == 2.4
    odd = by["Thingamajig"]
    assert odd["recipe"]["kind"] == "box" and odd["recipe"]["width_m"] == 0.4 and odd["rotation"] == 270.0
    assert (by["Table"]["recipe"]["kind"], by["Chair"]["recipe"]["kind"]) == ("table", "chair")


def test_doors_and_windows_are_the_editors_own_added_openings():
    out = WI.preview(_make_sh3d(_home(_ROOMS + _FURNISHED)))
    ops = out["openings"]
    assert len(ops) == 2
    door_id = next(k for k, v in ops.items() if v["kind"] == "door")
    win_id = next(k for k, v in ops.items() if v["kind"] == "window")
    assert re.fullmatch(r"door_[0-9a-f]{8}", door_id) and re.fullmatch(r"win_[0-9a-f]{8}", win_id)
    door, win = ops[door_id], ops[win_id]
    # The front door: 91.5 cm wide at (250, 400), angle 0 — along +x.
    assert door == {"kind": "door", "floor_id": None, "a_m": [2.042, 4.0], "b_m": [2.958, 4.0], "head_m": 2.08,
                    "hinge": "left", "swing": "in"}
    # The window: 120 cm at (0, 150), a quarter turn — along +y; sill 0.9, head 2.1.
    assert win == {"kind": "window", "floor_id": None, "a_m": [0.0, 0.9], "b_m": [0.0, 2.1], "sill_m": 0.9,
                   "head_m": 2.1}
    assert set(door) == set(HS._ADDED_KEYS["door"]) and set(win) == set(HS._ADDED_KEYS["window"])


def test_given_a_floor_the_openings_pass_the_servers_own_check():
    out = WI.preview(_make_sh3d(_home(_ROOMS + _FURNISHED)))
    changes = {"openings": {k: {**v, "floor_id": "main"} for k, v in out["openings"].items()}}
    saved = HS.apply_edit(HS.empty(), changes)
    assert set(saved["openings"]) == set(out["openings"])


def test_too_narrow_for_a_door_or_a_window_is_left_out_with_its_reason():
    body = """<doorOrWindow name="Cupboard door" x="0" y="0" width="50" depth="2" height="200"/>
      <doorOrWindow name="Slit window" x="0" y="0" width="20" depth="10" height="100" elevation="120"/>
      <doorOrWindow name="Door" x="0" y="0" width="60" depth="10" height="200"/>"""
    out = WI.preview(_make_sh3d(_home(body)))
    assert [v["kind"] for v in out["openings"].values()] == ["door"]
    assert out["report"]["skipped"] == [
        {"name": "Cupboard door", "why": "narrower than a door can be (0.6 m)"},
        {"name": "Slit window", "why": "narrower than a window can be (0.3 m)"}]


def test_the_report_says_what_mapped_to_what_and_what_was_left_out():
    body = _ROOMS + _FURNISHED + '<pieceOfFurniture name="Broken" x="1" y="1" width="0" depth="1" height="1"/>'
    out = WI.preview(_make_sh3d(_home(body)))
    rep = out["report"]
    assert set(rep["pieces"]) == set(out["pieces"]) and set(rep["openings"]) == set(out["openings"])
    by = {r["name"]: r for r in rep["pieces"].values()}
    assert by["Corner sofa"] == {"name": "Corner sofa", "level_id": "lvl0", "word": "sofa", "kind": "sofa"}
    assert by["Thingamajig"] == {"name": "Thingamajig", "level_id": "lvl1", "word": None, "kind": "box"}
    assert by["Table"]["level_id"] == "lvl1" and by["Chair"]["level_id"] == "lvl0"
    door = next(r for r in rep["openings"].values() if r["kind"] == "door")
    assert door == {"name": "Front door", "level_id": "lvl0", "word": "door", "kind": "door", "width_m": 0.915}
    assert rep["skipped"] == [{"name": "Broken", "why": "it has no size"}] and rep["warnings"] == []


def test_a_piece_below_its_floor_or_far_above_is_kept_within_the_files_range():
    body = """<pieceOfFurniture name="Sunk" x="0" y="0" width="10" depth="10" height="10" elevation="-30"/>
      <pieceOfFurniture name="Sky" x="0" y="0" width="10" depth="10" height="10" elevation="9000"/>"""
    out = WI.preview(_make_sh3d(_home(body)))
    assert sorted(pc["z_m"] for pc in out["pieces"].values()) == [0.0, 20.0]


def test_ids_are_unique_across_pieces_and_openings_even_on_a_collision(monkeypatch):
    seq = iter(["aaaaaaaa", "aaaaaaaa", "bbbbbbbb", "cccccccc", "cccccccc", "dddddddd"])
    monkeypatch.setattr(WI.secrets, "token_hex", lambda n: next(seq))
    body = """<pieceOfFurniture name="A" x="0" y="0" width="10" depth="10" height="10"/>
      <pieceOfFurniture name="B" x="0" y="0" width="10" depth="10" height="10"/>
      <doorOrWindow name="Door" x="0" y="0" width="80" depth="10" height="200"/>
      <doorOrWindow name="Door" x="1" y="0" width="80" depth="10" height="200"/>"""
    out = WI.preview(_make_sh3d(_home(body)))
    assert list(out["pieces"]) == ["fur_aaaaaaaa", "fur_bbbbbbbb"]
    assert list(out["openings"]) == ["door_cccccccc", "door_dddddddd"]


def test_a_rotated_opening_keeps_its_width_and_middle():
    body = '<doorOrWindow name="Window" x="300" y="200" width="150" depth="10" height="100" elevation="100" angle="0.5"/>'
    win = next(iter(WI.preview(_make_sh3d(_home(body)))["openings"].values()))
    a, b = win["a_m"], win["b_m"]
    assert math.dist(a, b) == pytest.approx(1.5, abs=0.002)
    assert [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] == pytest.approx([3.0, 2.0], abs=0.001)
    assert math.atan2(b[1] - a[1], b[0] - a[0]) == pytest.approx(0.5, abs=0.002)
