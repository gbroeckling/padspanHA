# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Setup checks shared by the opt-in report and the Overview's accuracy tips.

The report's own health checks found (2026-10-28, pad.traks.ca) that most
multi-floor homes skip three setup steps: 39% leave every floor at the
default height, 30% leave every receiver at the same height, 28% never give
a plan a real-world scale. The Overview now says so, quietly, to the person
who can fix it (padspan_ha/setup_tips); the same rules decide both, here.

Also counted for the report, never shown: rooms on one floor drawn over each
other (a hand-drawn outline slightly past its wall; Garry's Garage and
Laundry overlap 17 cm), and the stairs in Live Aboard's file.
"""

from __future__ import annotations

import math
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_FABRIC, DATA_HOUSE3D, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN

TIPS: tuple[str, ...] = ("floor_heights", "receiver_heights", "scale")
# How far past each other two rooms' outlines must reach to count as drawn
# over each other: outlines traced by hand meet a few centimetres apart.
OVERLAP_M = 0.10


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def floor_has_height(f: dict[str, Any]) -> bool:
    """A floor given a real storey height or elevation (the report's own test)."""
    return any(_num(f.get(k)) is not None for k in ("floor_to_floor_m", "base_elevation_m"))


def _poly(g: Any) -> list[tuple[float, float]]:
    pts = g.get("points_m") if isinstance(g, dict) else None
    out = []
    for p in pts or []:
        if isinstance(p, (list, tuple)) and len(p) >= 2 and _num(p[0]) is not None and _num(p[1]) is not None:
            out.append((float(p[0]), float(p[1])))
    return out if len(out) >= 3 else []


def _inside(x: float, y: float, P: list[tuple[float, float]]) -> bool:
    c = False
    j = len(P) - 1
    for i in range(len(P)):
        (xi, yi), (xj, yj) = P[i], P[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
        j = i
    return c


def _edge_dist(x: float, y: float, P: list[tuple[float, float]]) -> float:
    best = math.inf
    for i in range(len(P)):
        (ax, ay), (bx, by) = P[i], P[(i + 1) % len(P)]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) or 1e-12)))
        best = min(best, math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
    return best


def _reaches_into(A: list[tuple[float, float]], B: list[tuple[float, float]]) -> bool:
    """A corner of A, or the middle of one of its edges, inside B and more
    than OVERLAP_M from B's outline."""
    probes = list(A) + [((A[i][0] + A[(i + 1) % len(A)][0]) / 2, (A[i][1] + A[(i + 1) % len(A)][1]) / 2) for i in range(len(A))]
    return any(_inside(x, y, B) and _edge_dist(x, y, B) > OVERLAP_M for x, y in probes)


def rooms_overlapping(geometry: dict[str, Any]) -> int:
    """Pairs of rooms on the same floor drawn over each other by more than
    OVERLAP_M. A count, never which rooms.

    It runs inside the report on Home Assistant's event loop, so it must stay
    cheap on a house of hundreds of rooms: each floor's rooms are sorted by
    their left edge and only rooms whose boxes overlap by more than OVERLAP_M
    are compared point by point (a sweep, not every pair)."""
    by_floor: dict[str, list[tuple[tuple[float, float, float, float], list[tuple[float, float]]]]] = {}
    for g in (geometry or {}).values():
        P = _poly(g)
        if P:
            xs, ys = [p[0] for p in P], [p[1] for p in P]
            by_floor.setdefault(str(g.get("floor_id") or "main"), []).append(((min(xs), min(ys), max(xs), max(ys)), P))
    n = 0
    for rooms in by_floor.values():
        rooms.sort(key=lambda r: r[0][0])
        for i, ((ax0, ay0, ax1, ay1), A) in enumerate(rooms):
            for (bx0, by0, bx1, by1), B in rooms[i + 1:]:
                if bx0 > ax1 - OVERLAP_M:
                    break                                   # sorted by left edge: none further can reach in
                if min(ax1, bx1) - max(ax0, bx0) <= OVERLAP_M or min(ay1, by1) - max(ay0, by0) <= OVERLAP_M:
                    continue                                # boxes not over each other by enough
                if _reaches_into(A, B) or _reaches_into(B, A):
                    n += 1
    return n


def stairs_summary(pieces: Any) -> dict[str, int] | None:
    """Live Aboard's stairs: how many, how many the AI read off a plan and
    are still there (their label says so until someone renames them), and
    how many are a few steps within one floor. None with no stairs."""
    rows = [p for p in (pieces or {}).values()
            if isinstance(p, dict) and isinstance(p.get("recipe"), dict) and p["recipe"].get("kind") == "stairs"]
    if not rows:
        return None
    ai = sum(1 for p in rows if str(p.get("label") or "").startswith(("Stairs (AI first guess", "Stairs (from the plan")))
    within = sum(1 for p in rows
                 if str(((p["recipe"].get("params") or {}).get("to_floor")) or "").split("~")[0] == str(p.get("floor_id") or ""))
    out = {"total": len(rows), "ai_kept": ai, "within": within,
           # How they got there (0.38.194): imported from a home-design file, or
           # a stair room's guess (labelled "Stairs (<room>)" until renamed).
           "imported": sum(1 for p in rows if p.get("origin") == "import"),
           "room_guess": sum(1 for p in rows if str(p.get("label") or "").startswith("Stairs (")
                             and not str(p.get("label") or "").startswith(("Stairs (AI first guess", "Stairs (from the plan")))}
    # Shapes and styles in use, each only where some stairs have it.
    for key, allowed in (("shape", ("straight", "l", "u", "l2", "l3")), ("style", ("closed", "open", "treads", "floating"))):
        for v in allowed:
            n = sum(1 for p in rows if (p["recipe"].get("params") or {}).get(key) == v)
            if n:
                out[f"{key}_{v}"] = n
    return out


def house3d_pieces(hass: HomeAssistant) -> Any:
    """The 3D file's pieces, if Live Aboard's file is loaded (it loads on first
    use), else None: nothing is read from disk for this."""
    store = hass.data.get(DOMAIN, {}).get(DATA_HOUSE3D)
    data = getattr(store, "data", None)
    return data.get("pieces") if isinstance(data, dict) else None


def setup_tips(hass: HomeAssistant) -> list[str]:
    """The accuracy tips that apply to this home, in TIPS order:
    floor_heights (a home of two floors or more with no floor given a height),
    receiver_heights (two floors or more, two placed receivers or more, all
    at one height or none given), scale (a floor plan, and no real-world
    scale). The report's floors_all_default, scanner_z_uniform and
    has_metre_anchor, from the same stores; receivers here are the ones
    placed on a plan (their height is what the tip is about)."""
    dom = hass.data.get(DOMAIN, {})
    mdl_store = dom.get(DATA_MODEL)
    mdl = getattr(mdl_store, "data", None) or {}
    fab = getattr(dom.get(DATA_FABRIC), "data", None) or {}
    floors = [f for f in (mdl.get("floors") or []) if isinstance(f, dict)]
    multi = len(floors) > 1
    out = []
    if multi and not any(floor_has_height(f) for f in floors):
        out.append("floor_heights")
    placed = [v for v in (fab.get("scanner_positions_m") or {}).values() if isinstance(v, dict)]
    zs = {round(z, 2) for z in (_num(v.get("z_m")) for v in placed) if z is not None}
    if multi and len(placed) > 1 and len(zs) <= 1:
        out.append("receiver_heights")
    maps = (getattr(dom.get(DATA_MAPS), "data", None) or {}).get("maps") or []
    has_maps = any(isinstance(m, dict) for m in maps)
    if has_maps and mdl_store is not None:
        try:
            from . import fabric_truth  # noqa: PLC0415
            if fabric_truth.metre_gauge(mdl_store) is None:
                out.append("scale")
        except Exception:  # noqa: BLE001 — a check that can't run says nothing
            pass
    return out


@websocket_api.websocket_command({"type": "padspan_ha/setup_tips"})
@websocket_api.async_response
async def ws_setup_tips(hass: HomeAssistant, connection, msg) -> None:
    """The accuracy tips for the Overview: {tips: [ids that apply and are not
    hidden]}. Administrators only (they can make the fix); empty for anyone
    else, and with every tip hidden ("all")."""
    user = getattr(connection, "user", None)
    if not (user and getattr(user, "is_admin", False)):
        connection.send_result(msg["id"], {"tips": []})
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    hidden = set((getattr(st, "data", None) or {}).get("accuracy_tips_hidden") or [])
    tips = [] if "all" in hidden else [t for t in setup_tips(hass) if t not in hidden]
    connection.send_result(msg["id"], {"tips": tips})


WS_COMMANDS = (ws_setup_tips,)
