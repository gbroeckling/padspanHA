# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Persistent lost-and-found store (gap #10, best-in-class roadmap).

One entry per tracked object: its last CONFIRMED room and when. Verified
first this needed a new store, not a reuse of movement_store.py's
MovementStore — that store is an event LOG with a global 500-entry cap
across every device and a 7-day age prune (movement_store.py's MAX_ENTRIES/
MAX_AGE_S), both of which independently violate "never resets to Unknown":
a busy house's churn can evict an infrequently-moving tag's only record
long before 7 days, and the age prune alone guarantees eventual loss even
with zero churn. This store has no log and no pruning at all — one
{room, ts, label} value per key, overwritten in place, kept forever until
the object itself is explicitly forgotten.
"""

import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import LOST_AND_FOUND_STORE_KEY

_LOGGER = logging.getLogger(__name__)

# Two reports of one departure differ only by how age_s was rounded and when
# the poll ran; a real second departure is at least an away-timeout apart.
_SAME_DEPARTURE_S = 120.0


class LostAndFoundStore:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, LOST_AND_FOUND_STORE_KEY)
        self.records: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> dict[str, dict[str, Any]]:
        loaded = await self.store.async_load()
        self.records = loaded if isinstance(loaded, dict) else {}
        return self.records

    async def record(self, key: str, room: str, label: str | None = None,
                     padspan_id: str | None = None, seen_at: float | None = None) -> None:
        """Overwrite this key's last-confirmed room.

        The caller (ws_live_snapshot) sees every away object on EVERY poll —
        it works on a fresh copy of the shared snapshot each time — so this
        is where "once per departure" is enforced: an unchanged room is not a
        new record, and writes nothing. It once rewrote the whole (~1 MB) file
        per away object per poll, which kept live_snapshot from ever answering
        (2026-09-28). Saves are coalesced, never awaited inline."""
        if not key or not room:
            return
        # seen_at is when the object was last heard (now - age_s): the same
        # departure reports the same moment every poll, give or take the
        # rounding of age_s. A later departure from the same room is a new
        # moment, and a new record — its time must not stay at the first one.
        ts = float(seen_at) if isinstance(seen_at, (int, float)) and seen_at == seen_at else time.time()
        prev = self.records.get(key)
        if (isinstance(prev, dict) and prev.get("room") == room
                and (not label or prev.get("label") == label)
                and (not padspan_id or prev.get("padspan_id") == padspan_id)
                and abs(float(prev.get("ts") or 0) - ts) < _SAME_DEPARTURE_S):
            return
        entry: dict[str, Any] = {"room": room, "ts": ts}
        if label:
            entry["label"] = label
        if padspan_id:
            entry["padspan_id"] = padspan_id
        self.records[key] = entry
        self.store.async_delay_save(lambda: self.records, 10)

    def get_all(self) -> dict[str, dict[str, Any]]:
        return self.records

    async def forget(self, key: str) -> None:
        """Explicit removal — the only way an entry ever disappears."""
        if key in self.records:
            del self.records[key]
            await self.store.async_save(self.records)
