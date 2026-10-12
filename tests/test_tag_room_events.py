# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Room-change tag events (Settings: tags_room_events_enabled) for followed objects.

The panel follows a BLE or IRK device by its address; the object's key is
"ble:<address>" or "irk:...". The event path compared the key alone with the
followed list, so only iBeacons (followed by key) ever fired. And a first
confirmation after a restart (no room before it) fired as a change from None.
"""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.tag_integration import TagIntegration

ADDR = "AA:BB:CC:DD:EE:FF"


@pytest.fixture(autouse=True)
def _ha_tag_component(monkeypatch):
    # HA's own tag component (always there in a real install).
    mod = types.ModuleType("homeassistant.components.tag")
    mod.async_scan_tag = AsyncMock()
    monkeypatch.setitem(sys.modules, "homeassistant.components.tag", mod)


def _tags(followed):
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={
        "tags_room_events_enabled": True, "followed_addrs": list(followed)})}}
    return TagIntegration(hass), hass


def _fired(hass):
    return [c.args[0] for c in hass.bus.async_fire.call_args_list]


@pytest.mark.asyncio
async def test_a_followed_ble_device_fires_by_its_address():
    tags, hass = _tags([ADDR])
    await tags.async_emit_room_changes([(f"ble:{ADDR}", "Hall", "Kitchen")],
                                       {f"ble:{ADDR}": {"address": ADDR}})
    assert "padspan_room_change" in _fired(hass)


@pytest.mark.asyncio
async def test_an_irk_phone_fires_by_its_address():
    tags, hass = _tags(["5A:11:22:33:44:55"])
    await tags.async_emit_room_changes([("irk:abc", "Hall", "Kitchen")],
                                       {"irk:abc": {"address": "5A:11:22:33:44:55", "kind": "private_ble"}})
    assert "padspan_room_change" in _fired(hass)


@pytest.mark.asyncio
async def test_an_unfollowed_device_and_a_first_confirmation_do_not():
    tags, hass = _tags([ADDR])
    await tags.async_emit_room_changes([("ble:11:22:33:44:55:66", "Hall", "Kitchen")],
                                       {"ble:11:22:33:44:55:66": {"address": "11:22:33:44:55:66"}})
    await tags.async_emit_room_changes([(f"ble:{ADDR}", None, "Kitchen")],
                                       {f"ble:{ADDR}": {"address": ADDR}})
    assert _fired(hass) == []
