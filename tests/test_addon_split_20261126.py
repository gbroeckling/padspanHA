"""The owner's add-on review, 2026-11-26.

- "Shades should go with doors and Windows": a room card's shades are everyone's, their own switch; and an
  opener (a door's or a gate's) is never one of them (tests/js/room_controls.mjs "parts").
- "Thermostats in climate and air quality": a room card's thermostats are the Climate & air quality add-on's.
- A house that had Audio on keeps its shades and thermostats: their switches start on there, once.
- "Yes, with the shapes": a light's size and angle come with Advanced smart lighting, not only the lighting tier.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha.const import DATA_MODEL, DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.websocket import ws_fabric_light_position_set
from tests.test_addon_gates import _addon_key
from tests.test_conversion import _load
from tests.test_fabric_lights import _fab, _mdl
from tests.test_free_basics import free_basics  # noqa: F401  (the fixture)


def _keyed(mdl, key: dict) -> MagicMock:
    h = MagicMock()
    h.data = {DOMAIN: {DATA_MODEL: mdl, DATA_SETTINGS: SimpleNamespace(data=dict(key))}}
    return h


async def _place(mdl, key: dict, **msg) -> MagicMock:
    conn = MagicMock()
    await ws_fabric_light_position_set(_keyed(mdl, key), conn, {"id": 1, "floor_id": "main", **msg})
    conn.send_error.assert_not_called()
    return conn


@pytest.mark.asyncio
@pytest.mark.usefixtures("free_basics")
async def test_advanced_smart_lighting_sets_a_lights_size_and_angle() -> None:
    mdl = _mdl()
    mdl.fabric = _fab()
    await _place(mdl, _addon_key("lighting"), entity_id="light.island", x_m=1.0, y_m=2.0,
                 width_cm=120, height_cm=30, rotation=45, color="#ff0000", label="Island")
    e = mdl.light_positions_m()["light.island"]
    assert (e["width_cm"], e["height_cm"], e["rotation"]) == (120.0, 30.0, 45.0)
    # Its colour and label stay the lighting tier's: none set from the add-on.
    assert not e.get("label") and e.get("color") != "#ff0000"


@pytest.mark.asyncio
@pytest.mark.usefixtures("free_basics")
async def test_another_add_on_places_but_keeps_the_stored_size() -> None:
    mdl = _mdl()
    mdl.fabric = _fab()
    await _place(mdl, _addon_key("lighting"), entity_id="light.island", x_m=1.0, y_m=2.0, width_cm=120, rotation=45)
    await _place(mdl, _addon_key("audio"), entity_id="light.island", x_m=3.0, y_m=4.0, width_cm=10, rotation=0)
    e = mdl.light_positions_m()["light.island"]
    assert (e["x_m"], e["y_m"], e["width_cm"], e["rotation"]) == (3.0, 4.0, 120.0, 45.0)


@pytest.mark.parametrize("loaded, shades, thermostats", [
    ({"atlas_audio_enabled": True}, True, True),                          # had Audio: keeps them
    ({"atlas_audio_enabled": True, "atlas_shades_enabled": False}, False, True),   # chose since: kept as chosen
    ({"atlas_audio_enabled": False}, False, False),
    ({}, False, False),
])
@pytest.mark.asyncio
async def test_a_house_that_had_audio_keeps_its_shades_and_thermostats(loaded, shades, thermostats) -> None:
    _, data, _ = await _load(loaded)
    assert data["atlas_shades_enabled"] is shades and data["atlas_thermostats_enabled"] is thermostats


@pytest.mark.asyncio
async def test_a_new_install_has_neither() -> None:
    _, data, _ = await _load(None)
    assert data["atlas_shades_enabled"] is False and data["atlas_thermostats_enabled"] is False


def test_forensics_is_part_of_presence_insights() -> None:
    """Never sold on its own; a key holding either has both, so a Forensics bought before the merge has Locate."""
    assert licence.ADDON_PART_OF == {"forensics": "insights"}
    assert not licence.addon_on_sale("forensics") and licence.addon_on_sale("insights")
    for held in ("forensics", "insights"):
        got = licence.addons_allowed(_addon_key(held), True)
        assert "forensics" in got and "insights" in got, held
    assert licence.addons_allowed(_addon_key("audio"), True) == ["audio"]
