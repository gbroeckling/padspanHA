# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Setup checks shared by the opt-in report and the Overview's accuracy tips.

The report's own health checks found (2026-10-28, pad.traks.ca) that most
multi-floor homes skip three setup steps: 39% leave every floor at the
default height, 30% leave every receiver at the same height, 28% never give
a plan a real-world scale. The Overview now says so, quietly, to the person
who can fix it (padspan_ha/setup_tips); the same rules decide both, here.

Also counted for the report: rooms on one floor drawn over each other (a
hand-drawn outline slightly past its wall; one home's Garage and Laundry overlap
17 cm), and the stairs in Live Aboard's file. The report sends only how many
rooms overlap; Mapping's Edit and Layout name them to the person drawing
(2026-11-18, padspan_ha/rooms_overlap), by the same rule.
"""

from __future__ import annotations

import math
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_FABRIC, DATA_HOUSE3D, DATA_MAPS, DATA_MODEL, DATA_OBJECTS, DATA_SETTINGS, DOMAIN
from .presence_rules import is_outdoor_floor
from .quiet_errors import note as _quiet_error

TIPS: tuple[str, ...] = ("floor_heights", "receiver_heights", "scale", "plan_shape")
# The guided Setup's steps, in order (views/setup.js SETUP_STEPS, held equal
# by tests/test_guided_setup.py): settings["setup_progress"] names only these,
# and so do the report's setup_step:/setup_skip: counters.
# Owner's D5 (2026-11-13): floor heights after the rooms (and shown only for two indoor floors or more).
# 2026-11-21: "Track your phone or watch" after the receivers and before calibration, which is walked with it.
SETUP_STEPS: tuple[str, ...] = ("plan", "scale", "rooms", "floors", "receivers", "phone", "calibration")


def clean_setup_progress(raw: Any) -> dict[str, Any]:
    """settings["setup_progress"] as the panel may store it: the step last
    opened (`at`), the steps skipped, and whether finishing was counted."""
    raw = raw if isinstance(raw, dict) else {}
    at = raw.get("at")
    skipped = raw.get("skipped")
    return {
        "at": at if at in SETUP_STEPS else None,
        "skipped": [s for s in SETUP_STEPS if isinstance(skipped, list) and s in skipped],
        "done": raw.get("done") is True,
    }
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
    for p in pts if isinstance(pts, list) else []:
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


# A plan placed out of shape (2026-11-16): how far its placed width-to-height may be from its picture's before it is
# said. A real home's office plan, a nearly square picture, stood 31 % too narrow for months (an old 3D Stack drag, converted
# as drawn): its room and three receivers were up to 1.1 m off, and nothing said so.
SHAPE_OFF = 0.12


def plans_out_of_shape(maps: Any, transforms: Any) -> list[dict[str, Any]]:
    """Plans placed wider or narrower than their own picture by more than SHAPE_OFF: [{id, name, off}], `off` the
    placed width against the picture's shape in percent (-31: 31 % too narrow). The trust order: a plan with a hand
    measurement of its own leads and is never named here; a plan with nothing drawn on it misleads nothing, so it
    is not named either."""
    out: list[dict[str, Any]] = []
    for m in maps or []:
        t = (transforms or {}).get(m.get("id")) if isinstance(m, dict) else None
        if not isinstance(t, dict) or t.get("reference_measurements") or not (m.get("room_bounds") or m.get("receivers")):
            continue
        im = m.get("image") if isinstance(m.get("image"), dict) else {}
        w, h, sx, sy = (_num(v) for v in (im.get("width"), im.get("height"), t.get("scale_x_m"), t.get("scale_y_m")))
        if not (w and h and sx and sy) or min(w, h, sx, sy) <= 0:
            continue
        k = (sx / sy) / (w / h)
        if abs(math.log(k)) > math.log(1 + SHAPE_OFF):
            out.append({"id": str(m.get("id")), "name": str(m.get("name") or ""), "off": round((k - 1) * 100)})
    return out


def overlapping_pairs(geometry: dict[str, Any]) -> list[tuple[str, str]]:
    """Pairs of rooms on the same floor drawn over each other by more than
    OVERLAP_M, by name: each pair once, its two names in order, the pairs in
    order.

    It runs inside the report on Home Assistant's event loop, so it must stay
    cheap on a house of hundreds of rooms: each floor's rooms are sorted by
    their left edge and only rooms whose boxes overlap by more than OVERLAP_M
    are compared point by point (a sweep, not every pair)."""
    by_floor: dict[str, list[tuple[tuple[float, float, float, float], list[tuple[float, float]], str]]] = {}
    for name, g in (geometry or {}).items():
        P = _poly(g)
        if P:
            xs, ys = [p[0] for p in P], [p[1] for p in P]
            by_floor.setdefault(str(g.get("floor_id") or "main"), []).append(((min(xs), min(ys), max(xs), max(ys)), P, str(name)))
    out: list[tuple[str, str]] = []
    for rooms in by_floor.values():
        rooms.sort(key=lambda r: r[0][0])
        for i, ((ax0, ay0, ax1, ay1), A, an) in enumerate(rooms):
            for (bx0, by0, bx1, by1), B, bn in rooms[i + 1:]:
                if bx0 > ax1 - OVERLAP_M:
                    break                                   # sorted by left edge: none further can reach in
                if min(ax1, bx1) - max(ax0, bx0) <= OVERLAP_M or min(ay1, by1) - max(ay0, by0) <= OVERLAP_M:
                    continue                                # boxes not over each other by enough
                if _reaches_into(A, B) or _reaches_into(B, A):
                    out.append((an, bn) if an <= bn else (bn, an))
    return sorted(out)


def rooms_overlapping(geometry: dict[str, Any]) -> int:
    """How many pairs of rooms overlapping_pairs finds: the report's count, never which rooms."""
    return len(overlapping_pairs(geometry))


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
    scale), plan_shape (plans_out_of_shape names one). The report's floors_all_default, scanner_z_uniform and
    has_metre_anchor, from the same stores; receivers here are the ones
    placed on a plan (their height is what the tip is about)."""
    dom = hass.data.get(DOMAIN, {})
    mdl_store = dom.get(DATA_MODEL)
    mdl = getattr(mdl_store, "data", None) or {}
    fab = getattr(dom.get(DATA_FABRIC), "data", None) or {}
    # Indoor floors only: Outside is never a storey (presence_rules' one outdoor rule, as setup_status.indoorFloors reads
    # it). The report's floors_all_default and scanner_z_uniform (telemetry) keep counting every floor, as they always have.
    floors = [f for f in (mdl.get("floors") or []) if isinstance(f, dict)
              and not is_outdoor_floor(f.get("floor_id") or f.get("id")) and not is_outdoor_floor(f.get("name"))]
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
            _quiet_error("setup_checks:setup_tips")
            pass
    if plans_out_of_shape(maps, mdl.get("map_transforms")):
        out.append("plan_shape")
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
    res: dict[str, Any] = {"tips": tips}
    if "plan_shape" in tips:                    # which plans, for the tip's words and its button
        dom = hass.data.get(DOMAIN, {})
        res["plan_shape"] = plans_out_of_shape((getattr(dom.get(DATA_MAPS), "data", None) or {}).get("maps"),
                                               (getattr(dom.get(DATA_MODEL), "data", None) or {}).get("map_transforms"))
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command({
    "type": "padspan_ha/rooms_overlap",
    vol.Required("rooms"): vol.All(dict, vol.Length(max=1000)),
})
@websocket_api.async_response
async def ws_rooms_overlap(hass: HomeAssistant, connection, msg) -> None:
    """Which rooms are drawn over each other, for Mapping's Edit and Layout
    (2026-11-18: the report counted them and nobody was told). The outlines
    sent, one floor's, in metres ({room: [[x, y], ...]}, unsaved drafts
    included), by the report's own rule (overlapping_pairs): {pairs: [[room,
    room], ...]}. Reads and writes nothing, so anyone may ask."""
    geo = {str(r): {"points_m": pts} for r, pts in msg["rooms"].items()}
    connection.send_result(msg["id"], {"pairs": [list(p) for p in overlapping_pairs(geo)]})


def phones_tracked(irk_devices: Any, labels: Any, followed: Any, transmitters: Any) -> list[dict[str, str]]:
    """The phones and watches PadSpan follows as someone's: Setup's "Track your phone or watch" step is done with one.

    Two kinds, as the engine counts them (presence_coordinator.obj_is_identified: labelled, or a phone resolved
    through its IRK): every device with an IRK registered (`irk_devices`, the resolver's [{name, canonical_id}]: a
    phone's or watch's key from Private BLE Device, the Companion app, the IRK Manager or the phone wizard), and every
    Companion-app phone tracked with Track Your Phone (ws_companion_follow labels and follows its iBeacon key): a key
    labelled (`labels`, ObjectStore's {KEY: {label}}) or followed (`followed`, settings.followed_addrs) of the form
    IBEACON:<uuid>:<major>:<minor> whose UUID one of the Companion app's BLE Transmitter sensors sends
    (`transmitters`: each sensor's state and attributes as one text). An iBeacon tag's key is not a phone, so it does
    not count. [{name, how: "key" | "app"}], one per name."""
    out: dict[str, dict[str, str]] = {}
    for d in irk_devices if isinstance(irk_devices, list) else []:
        if isinstance(d, dict) and d.get("canonical_id"):
            name = str(d.get("name") or d["canonical_id"])
            out.setdefault(name.casefold(), {"name": name, "how": "key"})
    sent = [str(t).lower().replace("-", "") for t in (transmitters or [])]
    labels = labels if isinstance(labels, dict) else {}
    keys = {str(k).upper() for k in labels} | {str(k).upper() for k in (followed if isinstance(followed, list) else [])}
    for key in sorted(keys):
        parts = key.split(":")
        uuid = parts[1].replace("-", "").lower() if len(parts) == 4 and parts[0] == "IBEACON" else ""
        if len(uuid) != 32 or not any(uuid in s for s in sent):
            continue
        entry = labels.get(key) or labels.get(key.lower()) or {}
        name = str((entry.get("label") if isinstance(entry, dict) else "") or key)
        out.setdefault(name.casefold(), {"name": name, "how": "app"})
    return sorted(out.values(), key=lambda p: p["name"].casefold())


@websocket_api.websocket_command({"type": "padspan_ha/setup_phones"})
@websocket_api.async_response
async def ws_setup_phones(hass: HomeAssistant, connection, msg) -> None:
    """Setup's "Track your phone or watch" step: the phones and watches PadSpan follows as someone's
    (phones_tracked), {phones: [{name, how}]}. Reads and writes nothing else, so anyone may ask."""
    dom = hass.data.get(DOMAIN, {})
    devices: list = []
    try:
        from .private_ble_resolver import get_resolver  # noqa: PLC0415
        devices = (await get_resolver(hass)).get_status().get("devices") or []
    except Exception:  # noqa: BLE001 — no keys known is the answer a failed read can give
        _quiet_error("setup_checks:setup_phones")
    obj = dom.get(DATA_OBJECTS)
    labels = obj.all() if obj is not None else {}
    followed = (getattr(dom.get(DATA_SETTINGS), "data", None) or {}).get("followed_addrs") or []
    sent = [" ".join([str(s.state)] + [str(v) for v in (s.attributes or {}).values()])
            for s in hass.states.async_all("sensor") if "ble_transmitter" in (s.entity_id or "")]
    connection.send_result(msg["id"], {"phones": phones_tracked(devices, labels, followed, sent)})


WS_COMMANDS = (ws_setup_tips, ws_rooms_overlap, ws_setup_phones)
