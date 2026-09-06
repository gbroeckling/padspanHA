# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Room-dwell analytics (gap #4, best-in-class roadmap): time-in-room, entry
counts, and a per-room concurrent-occupancy count, aggregated from
TracebackStore's frames.

Pure — no HA dependency, no I/O. Takes the frames TracebackStore.get_frames()
already returns and a timezone name for local-day bucketing, so it is
testable with plain synthetic frame lists. The websocket handler
(ws_insights_get) is the only caller and does nothing but fetch frames and
hand them here.

There is no existing per-pair "expected vs measured" analogue to reuse this
time — searched presence_coordinator.py's dwell timers (_room_dwell_start /
_floor_dwell_start) and found they are ephemeral in-memory gates for the
room-change velocity check, discarded on every room change, never persisted
or aggregated. This module is genuinely new aggregation, not exposure of
something already computed.
"""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

# A gap between two consecutive frames for the same object longer than this
# is an OUTAGE (away, HA restart, the object dropped out of range) — not
# time spent in whatever room it was last confirmed in. Frames land every
# ~10s (traceback_store.py's MIN_FRAME_INTERVAL_S=8) when tracking is
# healthy, so 5 minutes is generous headroom before an interruption stops
# counting as dwell.
MAX_DWELL_GAP_S = 300.0


def compute_dwell_stats(
    frames: list[dict[str, Any]],
    tz_name: str = "UTC",
) -> dict[str, Any]:
    """Aggregate TracebackStore frames into dwell/entry/occupancy stats.

    frames: [{"ts": epoch_s, "o": [{"k": key, "r": room, "n"?: name}, ...]}, ...]
      in any order (sorted here by ts).
    tz_name: IANA timezone name for local-day/-hour bucketing (a house's
      "today" is not UTC's).

    Returns:
      {
        "objects": {key: display_name},
        "days": ["YYYY-MM-DD", ...] ascending, every day with any data,
        "dwell": {key: {day: {room: seconds}}},
        "entries": {key: {day: {room: count}}},   # times ENTERING that room
        "occupancy": {day: {hour: {room: distinct_object_count}}},
      }

    A room-change between two consecutive frames is attributed as: the
    elapsed gap counts toward the room the object was in BEFORE the change
    (that is where it spent the whole gap, as far as anything actually
    observed it) — the entry into the new room is counted at, and dwell in
    it starts from, the later frame's timestamp.
    """
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")

    def local_day_hour(ts: float) -> tuple[str, str]:
        dt = datetime.fromtimestamp(ts, tz=tz)
        return dt.strftime("%Y-%m-%d"), dt.strftime("%H")

    names: dict[str, str] = {}
    last_room: dict[str, str] = {}
    last_ts: dict[str, float] = {}
    dwell: dict[str, dict[str, dict[str, float]]] = {}
    entries: dict[str, dict[str, dict[str, int]]] = {}
    occupancy_sets: dict[str, dict[str, dict[str, set[str]]]] = {}
    days_seen: set[str] = set()

    for frame in sorted(frames, key=lambda f: f.get("ts", 0)):
        ts = frame.get("ts")
        if ts is None:
            continue
        day, hour = local_day_hour(ts)
        days_seen.add(day)

        for o in frame.get("o", []):
            key = o.get("k")
            room = o.get("r")
            if not key or not room:
                continue
            names[key] = o.get("n") or names.get(key) or key

            prev_room = last_room.get(key)
            prev_ts = last_ts.get(key)
            if prev_ts is not None and prev_room is not None:
                gap = ts - prev_ts
                if 0 < gap <= MAX_DWELL_GAP_S:
                    day_bucket = dwell.setdefault(key, {}).setdefault(day, {})
                    day_bucket[prev_room] = day_bucket.get(prev_room, 0.0) + gap
            if prev_room != room:
                day_bucket = entries.setdefault(key, {}).setdefault(day, {})
                day_bucket[room] = day_bucket.get(room, 0) + 1
            last_room[key] = room
            last_ts[key] = ts

            occ_room_sets = (
                occupancy_sets.setdefault(day, {}).setdefault(hour, {}).setdefault(room, set())
            )
            occ_room_sets.add(key)

    dwell_rounded = {
        key: {day: {room: round(secs, 1) for room, secs in rooms.items()} for day, rooms in by_day.items()}
        for key, by_day in dwell.items()
    }
    occupancy_counts = {
        day: {hour: {room: len(keys) for room, keys in rooms.items()} for hour, rooms in by_hour.items()}
        for day, by_hour in occupancy_sets.items()
    }

    return {
        "objects": names,
        "days": sorted(days_seen),
        "dwell": dwell_rounded,
        "entries": entries,
        "occupancy": occupancy_counts,
    }
