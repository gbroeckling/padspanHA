# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Persistent movement history store.

Records room-to-room transitions for tracked BLE devices so the frontend
can show a movement timeline.  Older entries are pruned automatically.

This is a bounded LOG for a timeline display, not a source of truth for
"where was this device last seen" — the global MAX_ENTRIES cap and the
MAX_AGE_S prune below are both fine for that purpose (a timeline only
needs recent history) but would silently violate "never forget a device's
last known room" if anything else depended on this store for that.
lost_and_found_store.py exists specifically because that guarantee was
needed elsewhere: see its own module docstring for why it could not just
reuse this store instead.
"""

import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import MOVEMENT_STORE_KEY

_LOGGER = logging.getLogger(__name__)

MAX_ENTRIES = 500        # total entries kept across ALL devices combined, not per-device —
                          # a timeline display only needs to be recent, not exhaustive
MAX_AGE_S = 86400 * 7    # prune entries older than 7 days, for the same reason


class MovementStore:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, MOVEMENT_STORE_KEY)
        self.entries: list[dict[str, Any]] = []

    async def async_load(self) -> list[dict[str, Any]]:
        loaded = await self.store.async_load()
        if isinstance(loaded, list):
            self.entries = loaded
        else:
            self.entries = []
        self._prune()
        return self.entries

    async def record(self, device: str, from_room: str | None, to_room: str | None,
                     label: str | None = None, padspan_id: str | None = None) -> None:
        """Record a room transition."""
        entry = {
            "device": device,
            "label": label,
            "from": from_room,
            "to": to_room,
            "ts": time.time(),
        }
        if padspan_id:
            entry["padspan_id"] = padspan_id
        self.entries.append(entry)
        self._prune()
        await self.store.async_save(self.entries)

    def get_history(self, device: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Return recent movement entries, optionally filtered by device."""
        entries = self.entries
        if device:
            entries = [e for e in entries if e.get("device") == device]
        return entries[-limit:]

    def _prune(self) -> None:
        """Remove old entries and trim to MAX_ENTRIES."""
        cutoff = time.time() - MAX_AGE_S
        self.entries = [e for e in self.entries if (e.get("ts") or 0) > cutoff]
        if len(self.entries) > MAX_ENTRIES:
            self.entries = self.entries[-MAX_ENTRIES:]
