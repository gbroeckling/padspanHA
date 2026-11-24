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

For each placed receiver heard at MIN_SPOTS robot spots or more, spread over
MIN_SPREAD_M or more, on its own floor: the log-distance model
rssi = A - 10 n log10(d) is fitted (A and n by least squares) at the spot the
receiver is placed, and again at every GRID_M cell of that floor's rooms. A
receiver is flagged when the best cell fits clearly better (its residual at
most BETTER of the placed spot's and BETTER_DB lower) and lies more than FAR_M
from where it is placed or in another room. A receiver placed on another floor
that hears the robot at STRONG_DBM or more at STRONG_SPOTS spots may be on the
wrong floor. Fewer spots: "not enough readings", never a verdict.
"""

from __future__ import annotations

import math
import statistics
from typing import Any

from .calibration_store import is_robot_point
from .subzones import room_at

MIN_SPOTS = 6
MIN_SPREAD_M = 3.0
GRID_M = 0.25
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


def _cells(rooms: dict, floor_id: str, spots: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Every GRID_M cell inside the floor's rooms (none drawn: the spots' box, wider)."""
    pts = [p for g in rooms.values() if isinstance(g, dict) and str(g.get("floor_id") or "") == floor_id
           and g.get("type") == "poly" for p in (g.get("points_m") or [])]
    box = pts or spots
    if not box:
        return []
    m = 0.0 if pts else MARGIN_M
    x0, x1 = min(p[0] for p in box) - m, max(p[0] for p in box) + m
    y0, y1 = min(p[1] for p in box) - m, max(p[1] for p in box) + m
    out = []
    nx, ny = int((x1 - x0) / GRID_M) + 1, int((y1 - y0) / GRID_M) + 1
    for i in range(nx):
        for j in range(ny):
            c = (x0 + (i + 0.5) * GRID_M, y0 + (j + 0.5) * GRID_M)
            if not pts or room_at(rooms, floor_id, c[0], c[1]):
                out.append(c)
    return out


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
    cells_of: dict[str, list[tuple[float, float]]] = {}
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
            if fl not in cells_of:
                cells_of[fl] = _cells(rooms, fl, [(p["x_m"], p["y_m"]) for p in robot if str(p.get("floor_id") or "") == fl])
            spread = max((math.dist(a[:2], b[:2]) for i, a in enumerate(spots) for b in spots[i + 1:]), default=0.0)
            enough = len(spots) >= MIN_SPOTS and spread >= MIN_SPREAD_M
            rssi = [v for _, _, v in spots]

            def at(cx: float, cy: float) -> float:
                return fit(rssi, [math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + dz * dz) for x, y, _ in spots])[2]

            def where(best: tuple[float, float]) -> dict:
                return {"x_m": round(best[0], 2), "y_m": round(best[1], 2), "floor_id": fl,
                        "room": room_at(rooms, fl, best[0], best[1])}

            if pf != fl:
                # Placed on another floor, yet heard strongly here: it may be on the wrong floor.
                strong = sum(1 for v in rssi if v >= STRONG_DBM)
                if strong >= STRONG_SPOTS:
                    best = min(cells_of[fl], key=lambda c: at(*c), default=None) if enough else None
                    findings.append({"source": src, "name": name, "kind": "other_floor", "placed": placed,
                                     "found": {**where(best), "distance_m": None} if best else {"floor_id": fl, "room": ""},
                                     "spots": len(spots), "strong": strong, "strongest_dbm": round(max(rssi), 1),
                                     "rms_before": None, "rms_after": round(at(*best), 1) if best else None})
                continue
            if not enough:
                thin.append({"source": src, "name": name, "spots": len(spots)})
                continue
            best = min(cells_of[fl], key=lambda c: at(*c), default=None)
            if best is None:
                continue
            after = at(*best)
            found = where(best)
            before = at(px, py)
            far = math.dist((px, py), best)
            other_room = bool(found["room"] and placed["room"] and found["room"] != placed["room"])
            if after <= BETTER * before and before - after >= BETTER_DB and (far > FAR_M or other_room):
                findings.append({"source": src, "name": name, "kind": "moved", "placed": placed,
                                 "found": {**found, "distance_m": round(far, 1)}, "spots": len(spots),
                                 "rms_before": round(before, 1), "rms_after": round(after, 1)})
            else:
                fine.append({"source": src, "name": name, "spots": len(spots), "rms": round(before, 1)})
    return {"findings": findings, "fine": fine, "thin": thin, "points": len(robot),
            "runs": len({str(p.get("label") or "").split(" ")[1] for p in robot if len(str(p.get("label") or "").split(" ")) > 1})}
