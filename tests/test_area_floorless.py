"""Review 2026-11-11 (B1): an area with no floor in Home Assistant is said to have none (model_get's areas: floor_id
None), so Mapping → Edit offers it on every floor; it was renamed "main" and hidden from every other floor's plan. And
the Rooms tool with no area to choose makes one (padspan_ha/area_add), as the room helper's "Also add to Home
Assistant" does (ai_wizard.ensure_area). The panel side is tests/js/scale_nudge.mjs."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from homeassistant.helpers import area_registry

from custom_components.padspan_ha import ai_wizard as W
from custom_components.padspan_ha import websocket as WS
from tests.test_house3d_store import _run


def _conn():
    c = MagicMock()
    c.user = SimpleNamespace(is_admin=True)
    return c


def test_model_get_says_an_area_has_no_floor(monkeypatch):
    areas = [SimpleNamespace(id="kitchen", name="Kitchen", floor_id=None), SimpleNamespace(id="den", name="Den", floor_id="ground")]
    monkeypatch.setattr(area_registry, "async_get", lambda h: SimpleNamespace(async_list_areas=lambda: areas))
    h = MagicMock()
    h.data = {}
    conn = _conn()
    _run(WS.ws_model_get(h, conn, {"id": 1, "type": "padspan_ha/model_get"}))
    got = {a["name"]: a["floor_id"] for a in conn.send_result.call_args[0][1]["areas"]}
    assert got == {"Kitchen": None, "Den": "ground"}


def test_area_add_makes_one_on_the_floor_and_never_twice(monkeypatch):
    made, have = [], {"Den"}
    reg = SimpleNamespace(async_get_area_by_name=lambda n: object() if n in have else None,
                          async_create=lambda n, floor_id=None: made.append((n, floor_id)))
    import homeassistant.helpers as HH
    monkeypatch.setattr(HH, "area_registry", SimpleNamespace(async_get=lambda h: reg), raising=False)
    monkeypatch.setattr(HH, "floor_registry", SimpleNamespace(async_get=lambda h: SimpleNamespace(async_get_floor=lambda f: object() if f == "ground" else None)), raising=False)
    out = []
    for name, fid in (("Kitchen", "ground"), ("Den", "ground"), ("Loft", "nowhere")):
        conn = _conn()
        _run(W.ws_area_add(MagicMock(), conn, {"id": 1, "name": name, "floor_id": fid}))
        out.append(conn.send_result.call_args[0][1]["result"])
    assert out == ["created", "matched", "created"] and made == [("Kitchen", "ground"), ("Loft", None)]
