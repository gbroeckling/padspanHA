# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
REPO LOGIC NOTES

Persistent store for user-assigned object labels.
Maps MAC address (uppercase) → { label, tagged_at }

Used by the Objects / Bluetooth / Devices views to let the user
assign a human-readable label to any raw BLE advertisement address.
"""

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import OBJECT_STORE_KEY
from .safe_store import async_load_readable

_LOGGER = logging.getLogger(__name__)


class ObjectStore:
    """Persistent store for user-assigned BLE object labels."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store = Store(hass, 1, OBJECT_STORE_KEY)
        self._data: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        """Load persisted data from HA storage."""
        loaded = await async_load_readable(self._store, lambda d: isinstance(d, dict))
        if isinstance(loaded, dict):
            self._data = loaded
        else:
            self._data = {}
        _LOGGER.debug("ObjectStore loaded (%d labels)", len(self._data))

    async def async_set(self, mac: str, label: str) -> None:
        """Assign a label to a MAC address and persist."""
        self._data[mac.upper()] = {
            "label": label,
            "tagged_at": dt_util.utcnow().isoformat(),
        }
        await self._store.async_save(self._data)

    async def async_delete(self, mac: str) -> None:
        """Remove a label for a MAC address and persist."""
        self._data.pop(mac.upper(), None)
        await self._store.async_save(self._data)

    def get(self, mac: str) -> dict[str, Any] | None:
        """Return the label entry for a MAC address, or None."""
        return self._data.get(mac.upper())

    def get_label(self, mac: str) -> str | None:
        """Return just the label string for a MAC address, or None."""
        entry = self._data.get(mac.upper())
        return entry.get("label") if entry else None

    def all(self) -> dict[str, dict[str, Any]]:
        """Return a copy of all label entries."""
        return dict(self._data)
