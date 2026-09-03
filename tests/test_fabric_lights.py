"""Light placements are fabric, in metres — not points on a photo.

A light's position used to live inside a map: {map_id, x, y} in that photo's
fraction space. Re-placing the photo moved the light, and a floor with no
floor plan could not have placed lights at all.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.migrations import _convert_lights
from custom_components.padspan_ha.model_store import ModelStore
from custom_components.padspan_ha.websocket import (
    ws_fabric_light_position_set,
    ws_fabric_light_remove,
)


def _fab() -> FabricStore:
    f = FabricStore.__new__(FabricStore)
    f.hass = MagicMock()
    f.store = AsyncMock()
    f.store.async_save = AsyncMock()
    f.data = {"floors": {}, "history": [], "scanner_positions_m": {},
              "beacon_positions_m": {}, "rf_barriers_m": [], "light_positions_m": {}}
    return f


def _mdl(transforms: dict | None = None) -> ModelStore:
    m = ModelStore.__new__(ModelStore)
    m.hass = MagicMock()
    m.store = AsyncMock()
    m.store.async_save = AsyncMock()
    m.data = {"map_transforms": transforms or {}}
    m.fabric = None
    return m


def _hass(mdl, *, pro: bool = True):
    """Light placement is PadSpan Pro editing; the tests here exercise the
    placement itself, so they carry a licence unless told not to."""
    from types import SimpleNamespace
    from custom_components.padspan_ha.const import DATA_SETTINGS
    h = MagicMock()
    settings = SimpleNamespace(data={"forensics_license_key": "PSPAN-TEST" if pro else ""})
    h.data = {DOMAIN: {DATA_MODEL: mdl, DATA_SETTINGS: settings}}
    return h


@pytest.mark.asyncio
async def test_a_light_is_placed_in_metres_with_no_map_involved() -> None:
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    await ws_fabric_light_position_set(_hass(mdl), MagicMock(), {
        "id": 1, "entity_id": "light.kitchen", "x_m": 4.5, "y_m": -2.25,
        "floor_id": "main", "color": "#ff0000", "shape": "bar", "width_cm": 90,
        "margin_cm": 33,
    })
    entry = mdl.light_positions_m()["light.kitchen"]
    assert (entry["x_m"], entry["y_m"]) == (4.5, -2.25)
    assert entry["floor_id"] == "main"
    assert entry["color"] == "#ff0000" and entry["shape"] == "bar"
    assert entry["margin_cm"] == 33.0   # end-to-end: WS schema -> handler -> stored entry
    assert "map_id" not in entry and "x" not in entry


@pytest.mark.asyncio
async def test_only_light_entities_are_accepted() -> None:
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    conn = MagicMock()
    await ws_fabric_light_position_set(_hass(mdl), conn, {
        "id": 1, "entity_id": "switch.kettle", "x_m": 1.0, "y_m": 1.0})
    conn.send_error.assert_called_once()
    assert mdl.light_positions_m() == {}


@pytest.mark.asyncio
async def test_removing_a_light_returns_it_to_auto_clustering() -> None:
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    fab.data["light_positions_m"] = {
        "light.kitchen": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"}}
    await ws_fabric_light_remove(_hass(mdl), MagicMock(),
                                 {"id": 1, "entity_id": "light.kitchen"})
    assert mdl.light_positions_m() == {}


@pytest.mark.asyncio
async def test_a_floor_with_no_photo_can_still_hold_lights() -> None:
    """The whole point: no map, no transform, still placeable."""
    mdl, fab = _mdl(), _fab()          # zero map_transforms
    mdl.fabric = fab
    await ws_fabric_light_position_set(_hass(mdl), MagicMock(), {
        "id": 1, "entity_id": "light.shed", "x_m": 30.0, "y_m": 51.0,
        "floor_id": "__outside__"})
    assert mdl.light_positions_m()["light.shed"]["y_m"] == 51.0


@pytest.mark.asyncio
async def test_migration_converts_per_photo_lights_once() -> None:
    mdl = _mdl({"m1": {"origin_x_m": 0, "origin_y_m": 0, "scale_x_m": 10,
                       "scale_y_m": 10, "rotation_rad": 0, "floor_id": "main"}})
    fab = _fab()
    mdl.fabric = fab
    maps = [{
        "id": "m1", "floor_id": "main",
        "lights": [
            {"entity_id": "light.a", "x": 0.5, "y": 0.5, "color": "#fbbf24", "shape": "bar"},
            {"entity_id": "light.b", "x": 0.25, "y": 0.75},
        ],
    }]
    n = await _convert_lights(mdl, fab, maps)
    assert n == 2
    a = mdl.light_positions_m()["light.a"]
    assert (a["x_m"], a["y_m"]) == (5.0, 5.0)
    assert a["shape"] == "bar" and a["floor_id"] == "main"
    assert mdl.light_positions_m()["light.b"]["x_m"] == pytest.approx(2.5)


@pytest.mark.asyncio
async def test_migration_never_overwrites_a_hand_placed_light() -> None:
    mdl = _mdl({"m1": {"origin_x_m": 0, "origin_y_m": 0, "scale_x_m": 10,
                       "scale_y_m": 10, "rotation_rad": 0, "floor_id": "main"}})
    fab = _fab()
    mdl.fabric = fab
    fab.data["light_positions_m"] = {
        "light.a": {"x_m": 9.87, "y_m": 6.54, "floor_id": "main"}}
    maps = [{"id": "m1", "floor_id": "main",
             "lights": [{"entity_id": "light.a", "x": 0.5, "y": 0.5}]}]
    assert await _convert_lights(mdl, fab, maps) == 0
    assert mdl.light_positions_m()["light.a"]["x_m"] == 9.87


@pytest.mark.asyncio
async def test_an_unmeasured_photo_contributes_no_lights() -> None:
    """No transform means no way to know what its coordinates meant."""
    mdl, fab = _mdl(), _fab()          # no transform for m1
    mdl.fabric = fab
    maps = [{"id": "m1", "floor_id": "main",
             "lights": [{"entity_id": "light.a", "x": 0.5, "y": 0.5}]}]
    assert await _convert_lights(mdl, fab, maps) == 0
    assert mdl.light_positions_m() == {}


def test_the_panel_copies_every_key_the_model_payload_sends() -> None:
    """Superseded by tests/test_model_get_floor_payload.py::
    test_the_panel_keeps_every_key_model_get_sends.

    This used to check that every key `model_get` sends appeared BY NAME in
    `_getModel`'s whitelist. The whitelist dropped a key three separate times,
    so it was replaced with a spread of the whole response — which makes
    "named in the whitelist" the wrong property to assert. The structural
    guard checks the spread is still there and that no `res?.key` picking has
    crept back. One rule, one place; this stub is kept so a grep for the old
    name still lands somewhere that explains where it went.
    """
    from tests.test_model_get_floor_payload import test_the_panel_keeps_every_key_model_get_sends

    test_the_panel_keeps_every_key_model_get_sends()


@pytest.mark.asyncio
async def test_light_placement_is_pro_editing_on_the_metre_path() -> None:
    """The gate used to sit on the per-photo light list in maps_update, which
    the UI stopped writing when lights moved to metres — so the licence
    guarded a path nothing used while the live one was open."""
    mdl, fab = _mdl(), _fab()
    mdl.fabric = fab
    conn = MagicMock()
    await ws_fabric_light_position_set(_hass(mdl, pro=False), conn, {
        "id": 1, "entity_id": "light.kitchen", "x_m": 1.0, "y_m": 2.0, "floor_id": "main",
    })
    conn.send_error.assert_called_once()
    assert conn.send_error.call_args[0][1] == "pro_required"
    assert mdl.light_positions_m() == {}
    conn2 = MagicMock()
    await ws_fabric_light_remove(_hass(mdl, pro=False), conn2, {"id": 2, "entity_id": "light.kitchen"})
    assert conn2.send_error.call_args[0][1] == "pro_required"


@pytest.mark.asyncio
async def test_a_lights_appearance_is_normalised_on_the_way_in() -> None:
    """Colour, shape, rotation and footprint validation moved here from the
    per-photo list: a bad colour falls back, an unknown shape is a circle, a
    legacy 'square' is a rect, rotation folds, size clamps, default 15 cm."""
    from custom_components.padspan_ha.model_store import light_appearance
    a = light_appearance(color="not-a-colour", shape="bar", rotation=405, width_cm=5000, height_cm=None)
    assert a == {"color": "#fbbf24", "shape": "bar", "rotation": 45.0, "width_cm": 1000.0,
                 "height_cm": 15.0, "margin_cm": 15.0}
    b = light_appearance(color="#12ab34", shape="pendant", rotation=0, width_cm=0, height_cm=0.2)
    assert b["color"] == "#12ab34" and b["shape"] == "pendant"
    assert b["width_cm"] == 1.0 and b["height_cm"] == 1.0   # explicit zero clamps, not defaults
    assert light_appearance(shape="warp-core")["shape"] == "hex"
    # margin_cm reads the opposite way round from width/height: zero is a
    # real answer (the perimeter shape's trace sits right on the wall), so
    # it must NOT bounce up to the minimum the way size does.
    assert light_appearance(margin_cm=None)["margin_cm"] == 15.0
    assert light_appearance(margin_cm=0)["margin_cm"] == 0.0
    assert light_appearance(margin_cm=9999)["margin_cm"] == 500.0
    assert light_appearance(margin_cm=-5)["margin_cm"] == 0.0


def test_the_backend_shape_vocabulary_is_the_renderers() -> None:
    """The list this replaced (rect, pill, octagon, star, bulb…) was a
    vocabulary the frontend had never drawn; it would have turned every
    'bar' strip and 'pendant' into a circle on the way in. The backend
    accepts exactly what views/light_codes.js LIGHT_SHAPES offers."""
    import re
    from pathlib import Path
    from custom_components.padspan_ha.model_store import LIGHT_PIN_SHAPES
    js = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
          / "www" / "padspan-ha" / "views" / "light_codes.js").read_text(encoding="utf-8")
    block = js[js.index("export const LIGHT_SHAPES = ["):]
    block = block[:block.index("];")]
    front = re.findall(r'\["([a-z_]+)",', block)
    assert front, "could not read LIGHT_SHAPES from light_codes.js"
    assert set(front) == set(LIGHT_PIN_SHAPES), (sorted(front), sorted(LIGHT_PIN_SHAPES))
