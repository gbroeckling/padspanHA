# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""An outdoor room's surface (room_meta[room].surface; the owner, 2026-11-11:
"Add a 2 foot by 2 foot grey landscaping tile to the outside patio spaces as
an option").

Held here, on the real store and the real command:
- the value: one of ROOM_SURFACES ("pavers_2ft"); anything else none (standard);
- padspan_ha/room_height_set takes it beside height and split level: its
  schema refuses an unknown surface, null clears it, a room not on the map
  is refused, a drawn room with no room_meta entry gets one;
- model_update (the colour editor) keeps a surface it was not sent; a load
  keeps it and drops a stray one; height and split level stay as they were;
- the opt-in report counts paved rooms only from a house with one;
- tests/js/room_surface.mjs runs the drawing: the flat Map byte for byte as
  before without a paved room, the 3D joints mesh, the Rooms page's choice.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import voluptuous as vol

from custom_components.padspan_ha.model_store import ROOM_SURFACES, ModelStore, room_surface
from tests.test_room_height import _call, _hass, _mdl, _wire

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_surface_is_one_of_the_known_ones() -> None:
    assert ROOM_SURFACES == ("pavers_2ft",)
    assert room_surface("pavers_2ft") == "pavers_2ft"
    for bad in (None, "", "gravel", "PAVERS_2FT", True, 2, ["pavers_2ft"], {}):
        assert room_surface(bad) is None, bad


def test_the_panel_knows_the_same_list() -> None:
    src = (_WWW / "views" / "outdoor_space.js").read_text(encoding="utf-8")
    assert 'export const SURFACES = ["pavers_2ft"];' in src
    assert "PAVER_M = 0.6096" in src, "2 ft, true to scale"


def test_the_schema_takes_a_known_surface_or_null() -> None:
    assert _wire({"room": "Kitchen", "surface": "pavers_2ft"})["surface"] == "pavers_2ft"
    assert _wire({"room": "Kitchen", "surface": None})["surface"] is None
    for bad in ({"room": "Kitchen", "surface": "gravel"}, {"room": "Kitchen", "surface": 1}):
        with pytest.raises(vol.Invalid):
            _wire(bad)


def test_set_and_clear_a_rooms_surface() -> None:
    mdl = _mdl()
    h = _hass(mdl)
    assert _call(h, {"room": "Kitchen", "surface": "pavers_2ft"}) == {"ok": True, "room": "Kitchen", "surface": "pavers_2ft"}
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#112233", "surface": "pavers_2ft"}
    out = _call(h, {"room": "Kitchen", "height_m": 3.0, "floor_raise_m": 0.5})
    assert out["height_m"] == 3.0 and mdl.room_meta()["Kitchen"]["surface"] == "pavers_2ft", "height and raise leave it alone"
    assert _call(h, {"room": "Kitchen", "surface": None})["surface"] is None
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#112233", "height_m": 3.0, "floor_raise_m": 0.5}
    assert _call(h, {"room": "Nowhere", "surface": "pavers_2ft"}) == {"error": "not_found"}
    assert _call(h, {"room": "Gallery", "surface": None}) == {"ok": True, "room": "Gallery", "surface": None}
    assert "Gallery" not in mdl.room_meta(), "clearing nothing writes nothing"
    assert _call(h, {"room": "Gallery", "surface": "pavers_2ft"})["surface"] == "pavers_2ft"
    assert mdl.room_meta()["Gallery"]["floor_id"] == "u", "a drawn room gets an entry on its fabric floor"


def test_model_update_keeps_a_surface_it_was_not_sent() -> None:
    mdl = _mdl()
    mdl.data["room_meta"]["Kitchen"]["surface"] = "pavers_2ft"
    _run(mdl.async_update(room_meta={"Kitchen": {"floor_id": "g", "color": "#445566"}}))
    assert mdl.room_meta()["Kitchen"] == {"floor_id": "g", "color": "#445566", "surface": "pavers_2ft"}
    _run(mdl.async_update(room_meta={"Kitchen": {"floor_id": "g", "color": "#445566", "surface": "gravel"}}))
    assert "surface" not in mdl.room_meta()["Kitchen"], "a stray value is never kept"


def test_a_load_keeps_it_and_drops_a_stray_one() -> None:
    from unittest.mock import AsyncMock, MagicMock
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock()
    mdl.store = AsyncMock()
    mdl.store.async_load = AsyncMock(return_value={
        "floors": [{"id": "main", "name": "Main"}],
        "room_meta": {"Patio": {"floor_id": "main", "color": "#aabbcc", "surface": "pavers_2ft", "floor_raise_m": -0.3},
                      "Deck": {"floor_id": "main", "color": "#ccbbaa", "surface": "marble"}}})
    mdl.store.async_save = AsyncMock()
    mdl.data = {}
    _run(mdl.async_setup())
    rm = mdl.room_meta()
    assert rm["Patio"] == {"floor_id": "main", "color": "#aabbcc", "floor_raise_m": -0.3, "surface": "pavers_2ft"}
    assert rm["Deck"] == {"floor_id": "main", "color": "#ccbbaa"}


def test_the_report_counts_paved_rooms_only_from_a_house_with_one() -> None:
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
    from tests.test_telemetry import _hass as _thass
    h = _thass()
    p = T.build_payload(h)
    assert "room_surfaces" not in p["env"], "a house without one sends no key"
    h.data[DOMAIN][DATA_MODEL].data["room_meta"] = {"Patio": {"floor_id": "main", "color": "#112233", "surface": "pavers_2ft"},
                                                   "Deck": {"floor_id": "main", "color": "#445566"}}
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["env"]["room_surfaces"] == {"pavers_2ft": 1}
    assert "Patio" not in json.dumps(p), "a count, never the room"


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "room_surface.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("frame:", 2), ("map:", 5), ("view:", 2), ("rooms:", 3)])
def test_the_surface_drawn_and_offered(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)
