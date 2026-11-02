# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Open edges: rooms with no wall between them (a loft, one big open space).

An open edge, or no barrier at all, already lets signal through: the solver
and the coverage map add up the attenuation of the barriers a ray crosses
and nothing else. What was missing was the tool, and one rule:

  store   _norm_barrier: an open wall saved from now on is 0 dB. One stored
          at 6 dB by an old path stays until it is saved again (Garry,
          2026-11-02: no heal at startup); the railing stamp doesn't save it.
          A rewritten barrier keeps its place in the list (the first barrier
          wins an overlap in the 3D house).
  stamp   async_stamp_barrier_rails: only the rail key, on the stored record
  tool    Mapping → Edit → Signal walls: "Open edge: tap a room edge" writes
          an Open (0 dB) barrier along the stretch shared with the room next
          door, or the whole edge with no neighbour, rail "none"; a shared edge
          is marked once; a signal wall there is replaced only on a confirm;
          "Open all edges" does a room and "Remove open edges" takes it back
          (tests/js/open_edges.mjs)
  help    the barrier help and the Live Aboard editor say so, in four languages
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_fabric as WF
from custom_components.padspan_ha.const import DATA_FABRIC, DOMAIN
from custom_components.padspan_ha.fabric_store import FabricStore

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _fabric(barriers: list[dict]) -> FabricStore:
    fab = FabricStore.__new__(FabricStore)
    fab.hass = MagicMock()
    fab.store = AsyncMock()
    fab.store.async_save = AsyncMock()
    fab.data = {"floors": {"main": {"rooms": {"Kitchen": {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]}}}},
                "rf_barriers_m": barriers, "history": [], "light_positions_m": {"light.a": {"x_m": 1, "y_m": 2}}}
    return fab


def _run(coro):
    return asyncio.run(coro)


def _bars() -> list[dict]:
    return [{"id": "edge", "name": "Gallery", "material": "open", "attenuation_dbm": 6, "floor_id": "upper",
             "points_m": [[0.1234, 4.5678], [20, 4]], "invert_state": False, "keep_me": {"a": 1}},
            {"id": "wall", "name": "Half wall", "material": "metal", "attenuation_dbm": 12, "floor_id": "upper",
             "points_m": [[5, 4], [8, 4]]},
            {"id": "chosen", "name": "Chosen", "material": "open", "attenuation_dbm": 0, "floor_id": "main",
             "points_m": [[0, 0], [1, 0]], "rail": "glass"}]


def test_a_rewritten_barrier_keeps_its_place_and_a_new_one_goes_last():
    """The first barrier wins an overlap in the 3D house (applyBarriers), so
    saving one must not move it: a railing click once put a wall in a railing."""
    fab = _fabric(_bars())
    _run(fab.async_spatial_update(set_barriers=[{**_bars()[0], "rail": "none"}]))
    assert [b["id"] for b in fab.data["rf_barriers_m"]] == ["edge", "wall", "chosen"]
    assert fab.data["rf_barriers_m"][0]["rail"] == "none"
    _run(fab.async_spatial_update(set_barriers=[{"id": "new", "name": "New", "material": "brick", "points_m": [[0, 0], [1, 1]]}]))
    assert [b["id"] for b in fab.data["rf_barriers_m"]] == ["edge", "wall", "chosen", "new"]
    # A file that somehow holds an id twice ends with it once, where it first stood.
    fab2 = _fabric([*_bars(), copy.deepcopy(_bars()[0])])
    _run(fab2.async_spatial_update(set_barriers=[_bars()[0]]))
    assert [b["id"] for b in fab2.data["rf_barriers_m"]] == ["edge", "wall", "chosen"]


def test_the_stamp_writes_only_the_rail_key_where_the_barrier_stands():
    before = _bars()
    fab = _fabric(_bars())
    others = copy.deepcopy({k: v for k, v in fab.data.items() if k not in ("rf_barriers_m", "history")})
    counts = _run(fab.async_stamp_barrier_rails({"edge": "glass", "wall": "none", "chosen": "none", "gone": "glass"}))
    assert counts == {"glass": 1, "none": 0}
    after = fab.data["rf_barriers_m"]
    assert [b["id"] for b in after] == ["edge", "wall", "chosen"]
    assert after[0].pop("rail") == "glass"
    # Byte for byte: corners, 6 dB, floor, name and keys this version doesn't know.
    assert json.dumps(after) == json.dumps(before[:2] + [before[2]])
    assert fab.data["rf_barriers_m"][2]["rail"] == "glass", "a word already there stays"
    assert {k: v for k, v in fab.data.items() if k not in ("rf_barriers_m", "history")} == others
    assert fab.store.async_save.await_count == 1
    assert [h["op"] for h in fab.data["history"]] == ["barrier_rails_stamp"]


def test_the_stamp_with_nothing_to_do_does_not_save():
    fab = _fabric(_bars())
    assert _run(fab.async_stamp_barrier_rails({"chosen": "none", "wall": "glass"})) == {"glass": 0, "none": 0}
    assert fab.store.async_save.await_count == 0 and fab.data["history"] == []


def _ws(handler, fab, **msg):
    """The handler itself, past HA's decorators and the Enhanced security gate."""
    hass, conn = MagicMock(), MagicMock()
    hass.data = {DOMAIN: {DATA_FABRIC: fab}}
    fn = handler
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    _run(fn(hass, conn, {"id": 1, **msg}))
    return conn, hass


def test_the_stamp_command_counts_words_never_walls(monkeypatch):
    counted = []
    monkeypatch.setattr(WF, "_bump", lambda hass, e, n=1: counted.append((e, n)))
    fab = _fabric(_bars())
    conn, _ = _ws(WF.ws_fabric_rf_barrier_rails_stamp, fab, rails={"edge": "none"})
    assert counted == [("rail_stamped:none", 1)]
    assert conn.send_result.call_args[0][1] == {"ok": True, "stamped": {"glass": 0, "none": 1}}


def test_the_tool_s_write_is_one_save_all_or_nothing(monkeypatch):
    counted = []
    monkeypatch.setattr(WF, "_bump", lambda hass, e, n=1: counted.append(e))
    fab = _fabric(_bars())
    before = copy.deepcopy(fab.data["rf_barriers_m"])
    # One piece that can't be stored: nothing is written, and it says so.
    conn, _ = _ws(WF.ws_fabric_open_edges_apply, fab, action="replaced", remove_barrier_ids=["wall"],
                  set_barriers=[{"name": "Open edge — Kitchen", "material": "open", "points_m": [[0, 0], [1, 1]]},
                                {"name": "No points", "material": "brick", "points_m": []}])
    assert conn.send_error.call_args[0][1] == "invalid" and fab.data["rf_barriers_m"] == before
    assert fab.store.async_save.await_count == 0 and counted == []
    # Shortened wall, its new piece, the open edge, a wall gone: one save, one count.
    conn, _ = _ws(WF.ws_fabric_open_edges_apply, fab, action="replaced", remove_barrier_ids=["chosen"],
                  set_barriers=[{**before[1], "points_m": [[5, 4], [6, 4]]},
                                {"name": "Half wall (2)", "material": "metal", "attenuation_dbm": 12, "floor_id": "upper", "points_m": [[7, 4], [8, 4]]},
                                {"name": "Open edge — Kitchen", "material": "open", "attenuation_dbm": 0, "rail": "none", "floor_id": "upper", "points_m": [[6, 4], [7, 4]]}])
    assert fab.store.async_save.await_count == 1 and counted == ["open_edge:replaced"]
    after = fab.data["rf_barriers_m"]
    assert [b["name"] for b in after] == ["Gallery", "Half wall", "Half wall (2)", "Open edge — Kitchen"]
    assert after[1]["id"] == "wall" and after[1]["points_m"] == [[5.0, 4.0], [6.0, 4.0]] and after[1]["attenuation_dbm"] == 12
    assert conn.send_result.call_args[0][1]["barriers"][-1]["id"] == after[3]["id"]


def test_the_tool_s_counts_are_a_closed_family_with_plain_names():
    ib = (WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    for k in T.OPEN_EDGE_ACTIONS:
        assert T.event_allowed(f"open_edge:{k}")
        assert re.search(rf'\b{k}: "Open edges: ', ib), k
    assert T.event_allowed("rail_stamped:glass") and T.event_allowed("rail_stamped:none")
    assert 'if (a === "rail_stamped")' in ib
    assert not T.event_allowed("open_edge:Kitchen") and not T.event_allowed("rail_stamped:auto")


def test_the_tool_s_numbers_are_the_3d_house_s():
    geom = (WWW / "views" / "wall_geom.js").read_text(encoding="utf-8")
    house = (WWW / "views" / "live_aboard_house.js").read_text(encoding="utf-8")
    num = lambda text, pat: float(re.search(pat, text).group(1))  # noqa: E731
    assert num(geom, r"const SHARE_M = ([\d.]+)") == num(house, r"const SHARE_TOL = ([\d.]+)")
    assert num(geom, r"const STUB_M = ([\d.]+)") == num(house, r"const STUB_M = ([\d.]+)")
    wall = num(house, r"export const EXT_T = ([\d.]+)") / 2 + num(house, r"const BAR_TOL = ([\d.]+)")
    assert num(geom, r"const WALL_M = ([\d.]+)") == pytest.approx(wall)
    for deg in (r"SHARE_COS = Math\.cos\((\d+) \* Math\.PI", r"BAR_COS = Math\.cos\((\d+) \* Math\.PI"):
        assert re.search(deg, house), deg
    assert num(geom, r"const SHARE_COS = Math\.cos\((\d+) \*") == num(house, r"SHARE_COS = Math\.cos\((\d+) \*")
    assert num(geom, r"const ALONG_COS = Math\.cos\((\d+) \*") == num(house, r"BAR_COS = Math\.cos\((\d+) \*")


def _bar(**kw):
    return {"name": "Open edge — Loft", "floor_id": "upper", "points_m": [[0, 0], [4, 0]], **kw}


def test_an_open_barrier_saved_at_6_db_reads_as_open():
    out = FabricStore._norm_barrier(_bar(material="open", attenuation_dbm=6))
    assert out["attenuation_dbm"] == 0.0


def test_an_open_barrier_with_no_attenuation_reads_as_open():
    out = FabricStore._norm_barrier(_bar(material="open"))
    assert out["attenuation_dbm"] == 0.0
    assert FabricStore._norm_barrier(_bar(material="Open "))["attenuation_dbm"] == 0.0


def test_other_materials_keep_their_attenuation():
    assert FabricStore._norm_barrier(_bar(material="metal", attenuation_dbm=12))["attenuation_dbm"] == 12
    assert FabricStore._norm_barrier(_bar(material="custom", attenuation_dbm=3))["attenuation_dbm"] == 3
    assert "attenuation_dbm" not in FabricStore._norm_barrier(_bar(material="brick"))


def test_the_tool_s_rail_and_points_survive_the_store():
    """The per-edge rail key is kept as written (none until one is chosen);
    the edge's own vertices are stored as they came, on the floor given."""
    out = FabricStore._norm_barrier(_bar(material="open", attenuation_dbm=0, rail="none"))
    assert out["rail"] == "none"
    assert out["points_m"] == [[0.0, 0.0], [4.0, 0.0]]
    assert out["floor_id"] == "upper"


@pytest.fixture(scope="module")
def got() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "open_edges.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("prefix", ["render:", "tools:", "stage:", "tap:", "all:", "stretch:", "wall:", "busy:", "remove:",
                                    "labels:", "corners:", "refusal:", "rail:", "geom:"])
def test_the_tool_writes_the_edge_itself_once(got, prefix) -> None:
    mine = {k: v for k, v in got.items() if k.startswith(prefix)}
    assert mine, (prefix, sorted(got))
    bad = {k: v for k, v in mine.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_the_help_says_an_open_edge_already_lets_signal_through() -> None:
    line = "An open edge, or no wall drawn at all, already lets signal through for positioning and coverage"
    assert line in (WWW / "help_content.js").read_text(encoding="utf-8")
    assert line in (WWW / "views" / "maps.js").read_text(encoding="utf-8")
    hint = "No wall between two rooms? Mark that edge open in Mapping → Edit → Signal walls"
    assert hint in (WWW / "help_content.js").read_text(encoding="utf-8")
    assert hint in (WWW / "views" / "live_aboard_edit.js").read_text(encoding="utf-8")
    for lang in ("de", "fr", "nl"):
        keys = json.loads((WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        assert any(line in k for k in keys), lang
        assert any(hint in k for k in keys), lang
