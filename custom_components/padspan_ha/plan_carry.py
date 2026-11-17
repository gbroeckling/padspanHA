# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Carry-along: what was placed on a floor plan, moved with it when the plan is.

A plan's place in the house is corrected now and then: its scale was wrong, its
shape was squeezed, it was lined up again against another floor. Everything
put ON the plan is stored in metres, so it stays where the plan used to be: the
room traced on it, the receivers placed on it, the calibration spots clicked
on it, the lights and sensors standing in its rooms. (Owner's house, 2026-11:
a basement plan widened by 27 % left two receivers 1.1 m off and four devices
outside their room, each put right by hand.)

The model store notes where a plan stood before it was first moved
(`plans_moved_from`, ModelStore._put_map_transform). From that and where it
stands now, each thing that was placed on it has one new place: the same spot
on the picture. Nothing is moved on its own: `carry_list` says what could
move, `carry_apply` moves only the kinds asked for, after a backup, and
`carry_dismiss` says they are right where they are. Owner, 2026-11-16: "a
room the user drew is primary", and calibration data is never changed unless
asked.

What counts as placed on a plan:
  rooms      the rooms traced on it (its room_bounds), on its floor
  receivers  the receivers pinned on it, on its floor
  points     the calibration points recorded on it (their map_id)
  devices    the lights and sensors standing inside those rooms
"""
from __future__ import annotations

import logging
import math
from types import SimpleNamespace
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import fabric_truth
from .const import (CALIBRATION_STORE_KEY, DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DEFAULT_FLOOR_ID, DOMAIN, FABRIC_STORE_KEY,
                    MAPS_STORE_KEY, MODEL_STORE_KEY)

_LOGGER = logging.getLogger(__name__)

KINDS: tuple[str, ...] = ("rooms", "receivers", "points", "devices")
MOVED_KEY = "plans_moved_from"
MIN_SHIFT_M = 0.05           # a thing that would move less than this is where it belongs


def _inside(x: float, y: float, P: list) -> bool:
    c = False
    for i in range(len(P)):
        x0, y0 = P[i][0], P[i][1]
        x1, y1 = P[i - 1][0], P[i - 1][1]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def _stores(hass: HomeAssistant) -> tuple[Any, Any, Any, Any]:
    dom = hass.data.get(DOMAIN, {})
    return dom.get(DATA_MODEL), dom.get(DATA_MAPS), dom.get(DATA_CALIBRATION), dom.get(DATA_FABRIC)


def carry_plan(hass: HomeAssistant, map_id: str) -> dict[str, Any] | None:
    """What was placed on this plan and where each would go: {map_id, name, floor_id, at, shift_m, rooms: {name:
    points_m}, receivers: {source: [x, y]}, points: {id: [x, y]}, points_hand, devices: {entity_id: [x, y]}}, each
    kind holding only what would move MIN_SHIFT_M or more. None when the plan has not moved or nothing would."""
    from .model_store import ModelStore  # noqa: PLC0415
    mdl, ms, cal, _fab = _stores(hass)
    if mdl is None or ms is None:
        return None
    was = (mdl.data.get(MOVED_KEY) or {}).get(map_id)
    now = mdl.map_transform(map_id)
    m = ms.get_map(map_id)
    if not (isinstance(was, dict) and now and m) or not fabric_truth.placement_is_readable(was) or not fabric_truth.placement_is_readable(now):
        return None
    if fabric_truth.placements_agree(was, now):
        return None
    # A spot in the house, read as its place on the picture where the plan WAS, then put where the plan IS. The inverse
    # is ModelStore's own (one arithmetic for a placement and its inverse), asked of the old record.
    old = SimpleNamespace(data={"map_transforms": {"was": was}})

    def to(x: Any, y: Any) -> list[float] | None:
        try:
            f = ModelStore.metres_to_map_frac(old, float(x), float(y), "was")
        except (TypeError, ValueError):
            return None
        if f is None:
            return None
        nx, ny = fabric_truth.placement_metres(now, f[0], f[1])
        return [round(nx, 3), round(ny, 3)] if math.isfinite(nx) and math.isfinite(ny) else None

    floor = str(m.get("floor_id") or DEFAULT_FLOOR_ID)
    on_floor = lambda v: isinstance(v, dict) and str(v.get("floor_id") or DEFAULT_FLOOR_ID) == floor  # noqa: E731
    far = lambda a, b: b is not None and math.dist((float(a[0]), float(a[1])), b) >= MIN_SHIFT_M  # noqa: E731
    shift = 0.0
    out: dict[str, Any] = {"map_id": map_id, "name": str(m.get("name") or ""), "floor_id": floor, "at": was.get("at"),
                           "rooms": {}, "receivers": {}, "points": {}, "points_hand": 0, "devices": {}}
    geo = mdl.room_geometry_m() or {}
    old_rooms: list[list] = []
    for name in (m.get("room_bounds") or {}):
        g = geo.get(name)
        pts = (g or {}).get("points_m") if on_floor(g) else None
        if not isinstance(pts, list) or len(pts) < 3:
            continue
        new = [to(p[0], p[1]) for p in pts]
        if any(n is None for n in new):
            continue
        old_rooms.append(pts)
        d = max(math.dist((float(p[0]), float(p[1])), n) for p, n in zip(pts, new))
        if d >= MIN_SHIFT_M:
            out["rooms"][name] = new
            shift = max(shift, d)
    pos = mdl.scanner_positions_m() or {}
    # The receivers pinned on it when it was moved (the note's own list, where the move kept one); else those on it now.
    pinned = was["receivers"] if isinstance(was.get("receivers"), list) else [r.get("source") for r in m.get("receivers") or [] if isinstance(r, dict)]
    for src in pinned:
        v = pos.get(src) if src else None
        if on_floor(v) and v.get("x_m") is not None and v.get("y_m") is not None:
            n = to(v["x_m"], v["y_m"])
            if far((v["x_m"], v["y_m"]), n):
                out["receivers"][src] = n
                shift = max(shift, math.dist((float(v["x_m"]), float(v["y_m"])), n))
    for p in ((getattr(cal, "data", None) or {}).get("points") or []) if cal is not None else []:
        if isinstance(p, dict) and p.get("map_id") == map_id and p.get("x_m") is not None and p.get("y_m") is not None and p.get("id"):
            n = to(p["x_m"], p["y_m"])
            if far((p["x_m"], p["y_m"]), n):
                out["points"][str(p["id"])] = n
                out["points_hand"] += 0 if str(p.get("label") or "").startswith("[auto]") else 1
                shift = max(shift, math.dist((float(p["x_m"]), float(p["y_m"])), n))
    for eid, v in (mdl.light_positions_m() or {}).items():
        if on_floor(v) and v.get("x_m") is not None and v.get("y_m") is not None \
                and any(_inside(float(v["x_m"]), float(v["y_m"]), P) for P in old_rooms):
            n = to(v["x_m"], v["y_m"])
            if far((v["x_m"], v["y_m"]), n):
                out["devices"][eid] = n
                shift = max(shift, math.dist((float(v["x_m"]), float(v["y_m"])), n))
    if not any(out[k] for k in KINDS):
        return None
    out["shift_m"] = round(shift, 2)
    return out


def _summary(plan: dict[str, Any]) -> dict[str, Any]:
    """The plan's carry as the panel lists it: counts and names, never a coordinate it has no use for."""
    return {"map_id": plan["map_id"], "name": plan["name"], "floor_id": plan["floor_id"], "at": plan["at"], "shift_m": plan["shift_m"],
            "rooms": sorted(plan["rooms"]), "receivers": len(plan["receivers"]), "points": len(plan["points"]),
            "points_hand": plan["points_hand"], "devices": len(plan["devices"])}


async def _forget(hass: HomeAssistant, map_ids: list[str]) -> None:
    mdl = _stores(hass)[0]
    moved = mdl.data.get(MOVED_KEY) if mdl is not None else None
    if isinstance(moved, dict) and any(moved.pop(i, None) is not None for i in list(map_ids)):
        await mdl.store.async_save(mdl.data)


async def carry_list(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Every plan that has moved with something still standing where it was. A plan noted as moved with nothing left
    to carry (a new plan placed for the first time, one deleted, one moved back) is forgotten here."""
    mdl = _stores(hass)[0]
    moved = dict((mdl.data.get(MOVED_KEY) or {}) if mdl is not None else {})
    out, gone = [], []
    for map_id in moved:
        plan = carry_plan(hass, map_id)
        if plan is None:
            gone.append(map_id)
        else:
            out.append(_summary(plan))
    if gone:
        await _forget(hass, gone)
    return out


async def carry_apply(hass: HomeAssistant, map_id: str, kinds: list[str]) -> dict[str, Any]:
    """Move the kinds asked for with the plan, after a backup (refused without one). {ok, moved: {kind: n},
    backup_id} or {ok: False, code, message}. Whatever was not asked for stays, and the plan is no longer listed."""
    from .ws_backup import _auto_backup  # noqa: PLC0415
    mdl, _ms, cal, fab = _stores(hass)
    plan = carry_plan(hass, map_id)
    kinds = [k for k in KINDS if k in (kinds or [])]
    if plan is None:
        return {"ok": False, "code": "nothing", "message": "Nothing placed on this plan would move now."}
    if not kinds:
        return {"ok": False, "code": "none_chosen", "message": "Tick what should move with the plan."}
    backup_id = await _auto_backup(hass, "Before moving what was placed on '" + (plan["name"] or "a plan") + "' with it",
                                   [MODEL_STORE_KEY, FABRIC_STORE_KEY, MAPS_STORE_KEY, CALIBRATION_STORE_KEY])
    if not backup_id:
        return {"ok": False, "code": "backup_failed",
                "message": "The safety backup couldn't be made, so nothing was moved. Check Home Assistant's storage and try again."}
    moved = dict.fromkeys(KINDS, 0)
    floor = plan["floor_id"]
    if "rooms" in kinds and fab is not None:
        for name, pts in plan["rooms"].items():
            res = await fab.async_correct_room(floor, name, {"type": "poly", "points_m": pts})
            moved["rooms"] += 1 if res.get("ok") else 0
    if "receivers" in kinds:
        pos = mdl.scanner_positions_m() or {}
        for src, (x, y) in plan["receivers"].items():
            v = pos.get(src) or {}
            await mdl.async_set_scanner_position_m(src, x, y, float(v.get("z_m") if v.get("z_m") is not None else 2.4), floor)
            moved["receivers"] += 1
    if "devices" in kinds:
        lp = mdl.light_positions_m() or {}
        for eid, (x, y) in plan["devices"].items():
            v = lp.get(eid) or {}
            keep = {k: v[k] for k in ("color", "shape", "rotation", "width_cm", "height_cm", "margin_cm", "label") if v.get(k) is not None}
            await mdl.async_set_light_position_m(eid, x, y, floor, **keep)       # its height is kept (KEEP_HEIGHT)
            moved["devices"] += 1
    if "points" in kinds and cal is not None:
        moved["points"] = await cal.async_move_points({pid: (x, y) for pid, (x, y) in plan["points"].items()}, map_id)
    await _forget(hass, [map_id])
    try:
        from .ws_common import _invalidate_snapshot_cache  # noqa: PLC0415
        _invalidate_snapshot_cache(hass)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "moved": moved, "backup_id": backup_id}


@websocket_api.websocket_command({"type": "padspan_ha/plan_carry_list"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_carry_list(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"plans": await carry_list(hass)})


@websocket_api.websocket_command({"type": "padspan_ha/plan_carry_apply", "map_id": str, "kinds": [vol.In(KINDS)]})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_carry_apply(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], await carry_apply(hass, msg["map_id"], msg["kinds"]))


@websocket_api.websocket_command({"type": "padspan_ha/plan_carry_dismiss", "map_id": str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_carry_dismiss(hass: HomeAssistant, connection, msg) -> None:
    """They are right where they are: the plan is no longer listed, and nothing is moved."""
    await _forget(hass, [msg["map_id"]])
    connection.send_result(msg["id"], {"ok": True})


WS_COMMANDS = (ws_plan_carry_list, ws_plan_carry_apply, ws_plan_carry_dismiss)
