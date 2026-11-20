# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Persistent follow-alert configuration store.

Stores per-device alert configs (email, on_room_change, watch_rooms) so they
survive HA restarts.  Previously these lived in session-only hass.data.
"""

import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import ALERTS_STORE_KEY
from .safe_store import async_load_readable

_LOGGER = logging.getLogger(__name__)


@dataclass
class AlertStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any]          # {addr_or_key: {email, on_room_change, watch_rooms}}

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, ALERTS_STORE_KEY)
        self.data = {}

    async def async_load(self) -> dict[str, Any]:
        loaded = await async_load_readable(self.store, lambda d: isinstance(d, dict))
        if isinstance(loaded, dict):
            self.data = loaded
        else:
            self.data = {}
        return self.data

    async def async_save_config(self, addr: str, config: dict[str, Any],
                               padspan_id: str | None = None) -> None:
        """Save alert config for a single device address/key."""
        if padspan_id:
            config["padspan_id"] = padspan_id
        self.data[addr] = config
        await self.store.async_save(self.data)

    async def async_delete_config(self, addr: str) -> bool:
        """Delete alert config for a device. Returns True if it existed."""
        if addr in self.data:
            del self.data[addr]
            await self.store.async_save(self.data)
            return True
        return False

    def get_config(self, addr: str) -> dict[str, Any] | None:
        """Get alert config for a device, or None."""
        return self.data.get(addr)

    def all(self) -> dict[str, Any]:
        return dict(self.data)
