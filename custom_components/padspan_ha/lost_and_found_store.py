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
the object itself is explicitly forgotten. (prune() exists only to clear out
strangers that older versions recorded — never someone's object.)
"""

import logging
import time
from typing import Any, Callable

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
                     padspan_id: str | None = None, seen_at: float | None = None,
                     identified: bool = True) -> None:
        """Overwrite this key's last-confirmed room.

        The caller (ws_live_snapshot) sees every away object on EVERY poll —
        it works on a fresh copy of the shared snapshot each time — so this
        is where "once per departure" is enforced: an unchanged room is not a
        new record, and writes nothing. It once rewrote the whole (~1 MB) file
        per away object per poll, which kept live_snapshot from ever answering
        (2026-09-28). Saves are coalesced, never awaited inline.

        Only someone's object (`identified`): one entry per TRACKED object, as
        the header says. A stranger's phone passing the house is nobody's lost
        item, and with no pruning here every one ever heard stayed in the file
        — and in memory, and in every lost_and_found_get — forever (#91)."""
        if not key or not room or not identified:
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
        # Marked: the start-up prune is for strangers recorded before
        # `identified` existed, and judged the rest by whether the device was
        # still heard, so an HA-linked tag away for two days lost its record
        # at the next restart.
        entry: dict[str, Any] = {"room": room, "ts": ts, "identified": True}
        if label:
            entry["label"] = label
        if padspan_id:
            entry["padspan_id"] = padspan_id
        self.records[key] = entry
        self.store.async_delay_save(lambda: self.records, 10)

    def prune(self, keep: Callable[[str, dict[str, Any]], bool]) -> int:
        """Drop each record `keep` says no to, with one coalesced save. For the
        strangers recorded before `identified` existed (snapshot_builder runs
        it once per start). Returns how many went."""
        drop = [k for k, v in self.records.items() if not keep(k, v)]
        for k in drop:
            del self.records[k]
        if drop:
            self.store.async_delay_save(lambda: self.records, 10)
        return len(drop)

    async def async_merge(self, records: Any) -> None:
        """A restore: the backup's records join these, the newer `ts` per key
        kept. Replacing them sent every object back to the room it was in when
        the backup was taken, and dropped the only record of one lost since —
        never reset until explicitly forgotten, as the header says."""
        if not isinstance(records, dict):
            return
        for key, rec in records.items():
            cur = self.records.get(key)
            if isinstance(rec, dict) and (
                    not isinstance(cur, dict)
                    or float(rec.get("ts") or 0) > float(cur.get("ts") or 0)):
                self.records[key] = rec
        await self.store.async_save(self.records)

    def get_all(self) -> dict[str, dict[str, Any]]:
        return self.records

    async def forget(self, key: str) -> None:
        """Explicit removal — the only way an entry ever disappears."""
        if key in self.records:
            del self.records[key]
            await self.store.async_save(self.records)
