# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Find mistakes: where the robot's runs say a receiver really is.

The owner, 2026-11-24: "the robovac card could also have a mistake finder.
Since it can go anywhere, have it find where radios are placed incorrectly",
"maybe opening a separate card for finding only" (views/robovac_findings.js).

It reads only what the room location runs already stored (vacuum_run.py): each
robot point is an exact spot (where the robot itself said it stood) with each
receiver's RSSI of the tag on the robot. No extra driving, and nothing is
moved: it only says what it found.

A placed receiver is judged on its own floor when it was heard at MIN_SPOTS
robot spots or more, spread over MIN_SPREAD_M or more, and those spots lie
round it (in QUADRANTS of the four quarters about its placed spot: spots all on
one side, a run of one room, said nothing about where it is and raised false
alarms in review). The log-distance model rssi = A - 10 n log10(d) is fitted
(A and n by least squares) at the spot it is placed, and over the floor's rooms:
first every COARSE_M, then every GRID_M round the best few. It is flagged when
the best spot fits clearly better (its residual at most BETTER of the placed
spot's and BETTER_DB lower), lies more than FAR_M from where it is placed or in
another room, and is itself among the robot's spots (QUADRANTS round it too,
never a guess past their edge). A receiver placed on another floor that hears
the robot at STRONG_DBM or more at STRONG_SPOTS spots may be on the wrong floor;
a floor left empty is unknown, never "another". Otherwise: "not enough
readings", never a verdict.
"""

from __future__ import annotations

import math
import statistics
from typing import Any

from .calibration_store import is_robot_point
from .subzones import room_at

MIN_SPOTS = 6
MIN_SPREAD_M = 3.0
QUADRANTS = 3                # of the four quarters round a spot, at least this many hold robot spots
COARSE_M = 1.0               # the first search, then
GRID_M = 0.25                # this fine round the best COARSE_KEEP coarse cells
COARSE_KEEP = 3
BETTER = 0.65                # the best cell's residual at most this share of the placed spot's (~35 % lower)
BETTER_DB = 2.0              # and at least this many dB lower (a good fit is not "beaten" by noise)
FAR_M = 2.5
STRONG_DBM = -60.0
STRONG_SPOTS = 3
N_RANGE = (1.0, 6.0)         # the path-loss exponent a real house has
D_MIN_M = 0.3                # nearer than this, the model says nothing more
TAG_Z_M = 0.1                # the tag on the robot's top
RX_Z_M = 1.0                 # a receiver with no height: about this high
MARGIN_M = 2.0               # no rooms drawn: the robot's spots' box, this much wider


def _rssi(r: dict) -> float | None:
    v = r.get("mean_rssi")
    if isinstance(v, (int, float)) and math.isfinite(v):
        return float(v)
    s = [float(x) for x in (r.get("rssi_samples") or []) if isinstance(x, (int, float))]
    return statistics.median(s) if s else None


def fit(rssi: list[float], dist: list[float]) -> tuple[float, float, float]:
    """(A, n, rms): rssi = A - 10 n log10(d), n held within N_RANGE."""
    x = [-10.0 * math.log10(max(D_MIN_M, d)) for d in dist]
    mx, my = sum(x) / len(x), sum(rssi) / len(rssi)
    vx = sum((a - mx) ** 2 for a in x)
    n = sum((a - mx) * (b - my) for a, b in zip(x, rssi)) / vx if vx > 1e-9 else 2.0
    n = min(N_RANGE[1], max(N_RANGE[0], n))
    a = my - n * mx
    rms = math.sqrt(sum((b - a - n * c) ** 2 for b, c in zip(rssi, x)) / len(x))
    return a, n, rms


def surrounded(cx: float, cy: float, spots: list[tuple[float, float, float]]) -> bool:
    """Do the robot's spots lie round (cx, cy): in QUADRANTS of its four quarters?"""
    q = {(x >= cx, y >= cy) for x, y, _ in spots}
    return len(q) >= QUADRANTS


def _box(rooms: dict, floor_id: str, spots: list[tuple[float, float]]) -> tuple[list, tuple[float, float, float, float] | None]:
    """The floor's room outlines and the box to search (no rooms drawn: the spots' box, wider)."""
    pts = [p for g in rooms.values() if isinstance(g, dict) and str(g.get("floor_id") or "") == floor_id
           and g.get("type") == "poly" for p in (g.get("points_m") or [])]
    box = pts or spots
    if not box:
        return pts, None
    m = 0.0 if pts else MARGIN_M
    return pts, (min(p[0] for p in box) - m, min(p[1] for p in box) - m, max(p[0] for p in box) + m, max(p[1] for p in box) + m)


def _cells(rooms: dict, floor_id: str, box, step: float, has_rooms: bool) -> list[tuple[float, float]]:
    x0, y0, x1, y1 = box
    out = []
    for i in range(int((x1 - x0) / step) + 1):
        for j in range(int((y1 - y0) / step) + 1):
            c = (x0 + (i + 0.5) * step, y0 + (j + 0.5) * step)
            if not has_rooms or room_at(rooms, floor_id, c[0], c[1]):
                out.append(c)
    return out


def _search(at, rooms: dict, floor_id: str, box, has_rooms: bool) -> tuple[float, float] | None:
    """The best-fitting spot: a COARSE_M grid, then GRID_M round its best few."""
    coarse = sorted(((at(*c), c) for c in _cells(rooms, floor_id, box, COARSE_M, has_rooms)))[:COARSE_KEEP]
    best = None
    k = int(COARSE_M / GRID_M)
    for _, (cx, cy) in coarse:
        for i in range(-k, k + 1):
            for j in range(-k, k + 1):
                c = (cx + i * GRID_M, cy + j * GRID_M)
                if has_rooms and not room_at(rooms, floor_id, c[0], c[1]):
                    continue
                e = at(*c)
                if best is None or e < best[0]:
                    best = (e, c)
    return best[1] if best else None


def cache_key(points: list[dict], positions: dict, rooms: dict) -> tuple:
    """What the findings depend on: the robot points (id, place), the receivers' places, the rooms."""
    pts = tuple(sorted((str(p.get("id")), p.get("x_m"), p.get("y_m"), str(p.get("floor_id") or ""))
                       for p in points if isinstance(p, dict) and is_robot_point(p.get("label"))))
    pos = tuple(sorted((k, v.get("x_m"), v.get("y_m"), v.get("z_m"), v.get("floor_id"))
                       for k, v in (positions or {}).items() if isinstance(v, dict)))
    rms = tuple(sorted((k, str(g.get("floor_id")), str(g.get("points_m"))) for k, g in (rooms or {}).items() if isinstance(g, dict)))
    return pts, pos, rms


def find_mistakes(points: list[dict], positions: dict[str, dict], rooms: dict | None = None) -> dict[str, Any]:
    """The findings from the robot runs' points. positions: model.scanner_positions_m;
    rooms: fabric's rooms_flat. Pure: nothing is changed."""
    rooms = rooms or {}
    robot = [p for p in points if isinstance(p, dict) and is_robot_point(p.get("label"))
             and isinstance(p.get("x_m"), (int, float)) and isinstance(p.get("y_m"), (int, float))]
    heard: dict[str, list[tuple[str, float, float, float]]] = {}       # source -> [(floor, x, y, rssi)]
    names: dict[str, str] = {}
    for p in robot:
        for r in p.get("scanner_readings") or []:
            v = _rssi(r) if isinstance(r, dict) else None
            src = str(r.get("source") or "") if isinstance(r, dict) else ""
            if v is None or not src:
                continue
            heard.setdefault(src, []).append((str(p.get("floor_id") or ""), float(p["x_m"]), float(p["y_m"]), v))
            names.setdefault(src, str(r.get("name") or src))
    floors = sorted({str(p.get("floor_id") or "") for p in robot})
    boxes: dict[str, tuple] = {}
    findings, fine, thin = [], [], []
    for src in sorted(heard):
        pos = positions.get(src)
        if not isinstance(pos, dict) or not isinstance(pos.get("x_m"), (int, float)) or not isinstance(pos.get("y_m"), (int, float)):
            continue                                       # not placed: the Receivers page says so
        pf, px, py = str(pos.get("floor_id") or ""), float(pos["x_m"]), float(pos["y_m"])
        dz = (float(pos["z_m"]) if isinstance(pos.get("z_m"), (int, float)) else RX_Z_M) - TAG_Z_M
        name = names.get(src) or src
        placed = {"x_m": round(px, 2), "y_m": round(py, 2), "floor_id": pf, "room": room_at(rooms, pf, px, py)}
        for fl in floors:
            spots = [(x, y, v) for f, x, y, v in heard[src] if f == fl]
            if not spots:
                continue
            if fl not in boxes:
                outline, box = _box(rooms, fl, [(p["x_m"], p["y_m"]) for p in robot if str(p.get("floor_id") or "") == fl])
                boxes[fl] = (box, bool(outline))
            box, has_rooms = boxes[fl]
            spread = max((math.dist(a[:2], b[:2]) for i, a in enumerate(spots) for b in spots[i + 1:]), default=0.0)
            enough = len(spots) >= MIN_SPOTS and spread >= MIN_SPREAD_M and box is not None
            rssi = [v for _, _, v in spots]

            def at(cx: float, cy: float) -> float:
                return fit(rssi, [math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + dz * dz) for x, y, _ in spots])[2]

            def where(best: tuple[float, float]) -> dict:
                return {"x_m": round(best[0], 2), "y_m": round(best[1], 2), "floor_id": fl,
                        "room": room_at(rooms, fl, best[0], best[1])}

            if pf and fl and pf != fl:
                # Placed on another floor, yet heard strongly here: it may be on the wrong floor.
                strong = sum(1 for v in rssi if v >= STRONG_DBM)
                if strong >= STRONG_SPOTS:
                    best = _search(at, rooms, fl, box, has_rooms) if enough else None
                    findings.append({"source": src, "name": name, "kind": "other_floor", "placed": placed,
                                     "found": {**where(best), "distance_m": None} if best else {"floor_id": fl, "room": ""},
                                     "spots": len(spots), "strong": strong, "strongest_dbm": round(max(rssi), 1),
                                     "rms_before": None, "rms_after": round(at(*best), 1) if best else None})
                continue
            if not enough:
                thin.append({"source": src, "name": name, "spots": len(spots), "why": "few"})
                continue
            if not surrounded(px, py, spots):
                thin.append({"source": src, "name": name, "spots": len(spots), "why": "around"})
                continue
            best = _search(at, rooms, fl, box, has_rooms)
            if best is None:
                continue
            after, before = at(*best), at(px, py)
            found = where(best)
            far = math.dist((px, py), best)
            other_room = bool(found["room"] and placed["room"] and found["room"] != placed["room"])
            if (after <= BETTER * before and before - after >= BETTER_DB and (far > FAR_M or other_room)
                    and surrounded(best[0], best[1], spots)):
                findings.append({"source": src, "name": name, "kind": "moved", "placed": placed,
                                 "found": {**found, "distance_m": round(far, 1)}, "spots": len(spots),
                                 "rms_before": round(before, 1), "rms_after": round(after, 1)})
            else:
                fine.append({"source": src, "name": name, "spots": len(spots), "rms": round(before, 1)})
    return {"findings": findings, "fine": fine, "thin": thin, "points": len(robot),
            "runs": len({str(p.get("label") or "").split(" ")[1] for p in robot if len(str(p.get("label") or "").split(" ")) > 1})}
