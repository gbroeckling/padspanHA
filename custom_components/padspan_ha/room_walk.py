# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Walk a room (setting calibration_room_walk, off by default).

The person carries one phone or tag slowly around one room for about 90 s
while the panel samples that device's RSSI from every scanner each poll.
This module turns those polls into a short summary and, only once the
person presses Save, into ordinary calibration points (source="room_walk")
at the room's centre in the fabric, one per slice of the walk, so k-NN learns the room
the same way it learns any other point. Nothing here writes anything.
"""

from __future__ import annotations

import math
from typing import Any

SOURCE = "room_walk"
LABEL_PREFIX = "[walk]"
# Slices of the walk stored as points: each slice is a different stretch of
# the room, so the room keeps some of its spread instead of one average.
WALK_SLICES = 6
# Fewer polls than this and the walk is too short to save.
MIN_POLLS = 10
# The one-sided penalty k-NN-style matchers use: a scanner heard on one side
# only counts as this many dB apart.
MISSING_DB = 12.0
# Distance to the closest other room's signature, in dB: below the first the
# room looks like that one, above the second it stands out.
SIMILAR_DB = 4.0
DISTINCT_DB = 8.0
# env.room_walk in the opt-in report: rooms walked and the held-out change.
WALKS_BUCKETS = ("1", "2_3", "4_6", "ge7")
CHANGE_WORDS = ("up", "same", "down")


def _median(vals: list[float]) -> float:
    s = sorted(vals)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def clean_polls(polls: Any, excluded: frozenset[str] = frozenset()) -> list[dict[str, float]]:
    """The walk's polls as [{source: rssi}], numbers only, masked scanners out."""
    out: list[dict[str, float]] = []
    for p in polls if isinstance(polls, list) else []:
        if not isinstance(p, dict):
            continue
        row = {
            str(src)[:200]: float(v) for src, v in p.items()
            if str(src) not in excluded and isinstance(v, (int, float))
            and not isinstance(v, bool) and math.isfinite(float(v)) and -130.0 <= float(v) <= 0.0
        }
        out.append(row)
    return out[:2000]


def signature(polls: list[dict[str, float]]) -> dict[str, float]:
    """Median RSSI per scanner over the whole walk."""
    per: dict[str, list[float]] = {}
    for p in polls:
        for src, v in p.items():
            per.setdefault(src, []).append(v)
    return {src: round(_median(v), 2) for src, v in per.items()}


def distance_db(a: dict[str, float], b: dict[str, float]) -> float | None:
    """RMS dB difference, a one-sided scanner counted as MISSING_DB."""
    keys = set(a) | set(b)
    if not keys:
        return None
    sq = [(a[k] - b[k]) ** 2 if k in a and k in b else MISSING_DB ** 2 for k in keys]
    return math.sqrt(sum(sq) / len(sq))


def room_signatures(points: list[dict[str, Any]], skip_room: str = "",
                    excluded: frozenset[str] = frozenset()) -> dict[str, dict[str, float]]:
    """Each other room's median reading per scanner, from its stored points."""
    per: dict[str, dict[str, list[float]]] = {}
    for p in points:
        room = str(p.get("room") or "")
        if not room or room == skip_room:
            continue
        for r in p.get("scanner_readings") or []:
            src = str(r.get("source") or "")
            v = r.get("mean_rssi")
            if src and src not in excluded and isinstance(v, (int, float)):
                per.setdefault(room, {}).setdefault(src, []).append(float(v))
    return {room: {s: _median(v) for s, v in d.items()} for room, d in per.items()}


def summarize(polls: list[dict[str, float]], room: str, points: list[dict[str, Any]],
              excluded: frozenset[str] = frozenset()) -> dict[str, Any]:
    """What the walk caught: samples, scanners heard, and how far it sits
    from the closest other room's signature. Read-only."""
    sig = signature(polls)
    others = room_signatures(points, skip_room=room, excluded=excluded)
    nearest, gap = None, None
    for other, osig in others.items():
        d = distance_db(sig, osig)
        if d is not None and (gap is None or d < gap):
            nearest, gap = other, d
    if gap is None:
        looks = "unknown"
    elif gap < SIMILAR_DB:
        looks = "similar"
    elif gap < DISTINCT_DB:
        looks = "fair"
    else:
        looks = "distinct"
    return {
        "room": room,
        "polls": len(polls),
        "samples": sum(len(p) for p in polls),
        "scanners": len(sig),
        "signature": sig,
        "nearest_room": nearest,
        "gap_db": round(gap, 1) if gap is not None else None,
        "looks": looks,
        "enough": len(polls) >= MIN_POLLS and bool(sig),
        "previous_walk_points": sum(1 for p in points if is_walk_point(p, room)),
    }


def room_centre_m(geo: Any) -> tuple[float, float] | None:
    """The middle of a fabric room (room_geometry_m entry), in metres."""
    if not isinstance(geo, dict):
        return None
    pts = [p for p in (geo.get("points_m") or []) if isinstance(p, (list, tuple)) and len(p) >= 2]
    if len(pts) >= 3:
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        return (sum(float(p[0]) for p in pts) / len(pts), sum(float(p[1]) for p in pts) / len(pts))
    if isinstance(geo.get("cx_m"), (int, float)) and isinstance(geo.get("cy_m"), (int, float)):
        return (float(geo["cx_m"]), float(geo["cy_m"]))
    return None


def slice_readings(polls: list[dict[str, float]], slices: int = WALK_SLICES) -> list[list[dict[str, Any]]]:
    """The walk cut into consecutive slices, each as scanner_readings for
    CalibrationStore (source, rssi_samples). Empty slices are dropped."""
    n = len(polls)
    if not n:
        return []
    slices = max(1, min(slices, n))
    out: list[list[dict[str, Any]]] = []
    for i in range(slices):
        part = polls[i * n // slices:(i + 1) * n // slices]
        per: dict[str, list[float]] = {}
        for p in part:
            for src, v in p.items():
                per.setdefault(src, []).append(v)
        readings = [{"source": s, "rssi_samples": v} for s, v in sorted(per.items())]
        if readings:
            out.append(readings)
    return out


def is_walk_point(p: dict[str, Any], room: str | None = None) -> bool:
    """A point a room walk added (in that room, when one is given)."""
    return p.get("source") == SOURCE and (room is None or str(p.get("room") or "") == room)


def walks_bucket(points: list[dict[str, Any]]) -> str | None:
    """Rooms that have a saved walk, as a bucket word; None when none."""
    n = len({str(p.get("room") or "") for p in points if is_walk_point(p)})
    if not n:
        return None
    return "1" if n == 1 else "2_3" if n <= 3 else "4_6" if n <= 6 else "ge7"


def change_word(before: dict[str, Any] | None, after: dict[str, Any] | None) -> str | None:
    """k-NN's held-out rooms-right before vs after a walk: up, same or down
    (inside 2 points is the same). None when either side has no score."""
    b = ((before or {}).get("knn") or {}).get("rooms_right_pc")
    a = ((after or {}).get("knn") or {}).get("rooms_right_pc")
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return None
    return "up" if a - b >= 2 else "down" if b - a >= 2 else "same"


def report_buckets(settings: dict[str, Any], points: list[dict[str, Any]],
                   last_change: Any) -> dict[str, str] | None:
    """env.room_walk: only while the setting is on and a walk was saved."""
    if settings.get("calibration_room_walk") is not True:
        return None
    wb = walks_bucket(points)
    if not wb:
        return None
    out = {"walks": wb}
    if last_change in CHANGE_WORDS:
        out["change"] = last_change
    return out
