# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What kind of space a room is (room_meta[room].space; the owner,
2026-11-11: "outside as a floor that is outside any part of the house, and a
patio that is covered, and has no walls to the outside edges ... very
different things", "And a patio still belongs to a floor").

Held here:
- the value: "indoor", "open" or "covered"; anything else none (worked out);
- padspan_ha/room_height_set takes it beside the others: an unknown kind
  refused by its schema, null clears it, a room on an Outside floor refused
  (it is outside ground), the other values left alone;
- model_update keeps it, a load keeps it and drops a stray one;
- the one rule, presence_rules.outdoor_kind, gives the panel's outdoorKind
  answer on a table of rooms (names, floors, stored kinds, the geometric facts);
- radio is unchanged: positioning, presence, calibration and the report read
  is_outdoor_floor, never the kind, and no Python reader moved;
- tests/js/outdoor_space.mjs runs the panel's side: the guess, the stored
  kinds, rain, ceiling lights, the porch's roof, the doors, the Rooms page.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import voluptuous as vol

from custom_components.padspan_ha import presence_rules as PR
from custom_components.padspan_ha.model_store import ROOM_SPACES, room_space
from tests.test_room_height import _call, _hass, _mdl, _wire

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_kind_is_one_of_three() -> None:
    assert ROOM_SPACES == PR.ROOM_SPACES == ("indoor", "open", "covered")
    for k in ROOM_SPACES:
        assert room_space(k) == k
    for bad in (None, "", "ground", "Covered", 1, True, ["open"]):
        assert room_space(bad) is None, bad
    js = (_WWW / "views" / "outdoor_space.js").read_text(encoding="utf-8")
    assert 'export const SPACES = ["indoor", "open", "covered"];' in js


def test_set_clear_and_refuse() -> None:
    mdl = _mdl()
    mdl.fabric.data["floors"]["outside"] = {"committed": False, "rooms": {
        "Shed": {"type": "poly", "floor_id": "outside", "points_m": [[20, 0], [23, 0], [23, 3], [20, 3]]}}}
    h = _hass(mdl)
    assert _wire({"room": "Kitchen", "space": "covered"})["space"] == "covered"
    with pytest.raises(vol.Invalid):
        _wire({"room": "Kitchen", "space": "ground"})
    mdl.data["room_meta"]["Kitchen"]["surface"] = "pavers_2ft"
    assert _call(h, {"room": "Kitchen", "space": "covered"}) == {"ok": True, "room": "Kitchen", "space": "covered"}
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#112233", "surface": "pavers_2ft", "space": "covered"}
    assert _call(h, {"room": "Kitchen", "space": None})["space"] is None
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#112233", "surface": "pavers_2ft"}, "the surface left alone"
    assert _call(h, {"room": "Shed", "space": "open"}) == {"error": "invalid"}, "outside ground: no kind to choose"
    assert "Shed" not in mdl.room_meta()
    assert _call(h, {"room": "Shed", "space": None}) == {"ok": True, "room": "Shed", "space": None}, "clearing is harmless"
    assert _call(h, {"room": "Nowhere", "space": "open"}) == {"error": "not_found"}


def test_model_update_and_a_load_keep_it() -> None:
    from unittest.mock import AsyncMock, MagicMock

    from custom_components.padspan_ha.model_store import ModelStore
    mdl = _mdl()
    mdl.data["room_meta"]["Kitchen"]["space"] = "open"
    _run(mdl.async_update(room_meta={"Kitchen": {"floor_id": "g", "color": "#445566"}}))
    assert mdl.room_meta()["Kitchen"]["space"] == "open"
    m = ModelStore.__new__(ModelStore)
    m.hass = MagicMock()
    m.store = AsyncMock()
    m.store.async_load = AsyncMock(return_value={"floors": [{"id": "main", "name": "Main"}], "room_meta": {
        "Patio": {"floor_id": "main", "color": "#aabbcc", "space": "covered"},
        "Deck": {"floor_id": "main", "color": "#ccbbaa", "space": "sky"}}})
    m.store.async_save = AsyncMock()
    m.data = {}
    _run(m.async_setup())
    assert m.room_meta()["Patio"]["space"] == "covered" and "space" not in m.room_meta()["Deck"]


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "outdoor_space.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("guess:", 3), ("stored:", 3), ("rain:", 1), ("lights:", 1), ("roof:", 1),
                                          ("doors:", 2), ("rooms:", 2), ("parity:", 1)])
def test_the_panel_side(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_one_rule_both_sides(run: dict) -> None:
    """The server's outdoor_kind gives the panel's outdoorKind answer on every row of the table."""
    assert len(run["table"]) == 2520
    wrong = [row for row in run["table"] if PR.outdoor_kind(row[0], row[1], row[2], within=row[3], over=row[4]) != row[5]]
    assert not wrong, wrong[:10]
    js = (_WWW / "views" / "outdoor_space.js").read_text(encoding="utf-8")
    name_js = re.search(r"export const OUTDOOR_NAME = /(.*)/i;", js).group(1)
    assert PR.OUTDOOR_ROOM_NAME.pattern == name_js, "one list of words"


def test_the_copies_are_gone_and_radio_reads_floors_only() -> None:
    views = _WWW / "views"
    # The 3D house and the doors read the one rule; nothing else keeps the list
    # (the heatmap's own list differs, "outdoors" and underscores, and is left as it is).
    words = r"deck|patio|porch|balcony|terrace|veranda|yard|garden|lawn|driveway|outside|outdoor)\b/i"
    holders = sorted(p.name for p in views.glob("*.js") if words in p.read_text(encoding="utf-8"))
    assert holders == ["outdoor_space.js"], holders
    assert "outdoors?)" in (views / "atlas_heatmap.js").read_text(encoding="utf-8")
    # No Python radio reader calls the kind: only the command that refuses it on an Outside floor.
    callers = sorted(p.name for p in _PKG.glob("*.py") if "outdoor_kind(" in p.read_text(encoding="utf-8"))
    assert callers == ["presence_rules.py", "websocket.py"], callers
    src = inspect.getsource(PR.is_outdoor_floor)
    assert "OUTDOOR_FLOOR_NAMES" in src and "kind" not in src
