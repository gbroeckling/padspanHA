# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Start with a rough house from your Home Assistant rooms (the owner's gap pick 1, 2026-11-23).

With no drawing at all: one box room per Home Assistant area, laid out on its floor, so a new house has every room on
the map in under a minute. Asked for with a button only (padspan_ha/maps_starter_house, ws_maps.py); nothing here runs
by itself, and it is free.

What one press makes, for each indoor floor that has no plan and no rooms yet:
  * a blank floor (the "Start from a blank floor" plan, views/rough_plan.js, ws_maps.async_add_blank_floor), sized to
    hold its boxes, to scale by construction, marked as a rough start: `starter` on the plan's record, with the boxes as
    they were made ({room: corners in metres}), which is how the panel tells a box from a room someone has drawn;
  * one square box per area on that floor, on the map of the house (the fabric), through the one room writer as the
    other imports write theirs (FabricStore.async_correct_room, committed_by="external_import": it refuses any room
    that is already there, so nothing existing is ever overwritten), named as the area is, which is the link to it.
An area with no floor in Home Assistant goes on the floor the person picks (by default the first floor being made) and
is said so. Areas that already have an outline (on the house or traced on a plan), areas of the outdoors, and the areas
of a floor that already has a plan or rooms are left out and listed with why. A second press finds every floor taken
and makes nothing.

The boxes are a guess: 3.5 m square, a quarter metre wider for each device past four in the area, at most 6 m; packed in
rows, the biggest first, half a metre apart, a metre in from the floor's edge. Never calibration, never a receiver, a
wall or a light: only the plan and the boxes.

A box is a placeholder. Reshaped in Mapping → Layout, it is the person's room from then on. Traced on any plan (the
rough one, or a real plan uploaded for that floor later) and put on the map with "Put it on the map"
(views/wizard_build.js), the traced outline replaces the box under the same name, so the room keeps its area.
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_FABRIC, DATA_MAPS, DATA_MODEL, DEFAULT_FLOOR_ID, DOMAIN
from .presence_rules import is_outdoor_floor
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

BOX_M = 3.5            # a box's side with up to BOX_FREE_DEVICES devices in its area
BOX_FREE_DEVICES = 4
BOX_STEP_M = 0.25      # this much wider for each device past those
BOX_MAX_M = 6.0
GAP_M = 0.5            # between two boxes
EDGE_M = 1.0           # from the floor's edge to the nearest box
ROW_SHAPE = 1.25       # a row is this many times the square root of the boxes' area: a floor a little wider than deep
# Why an area gets no box (the panel says each in words).
SKIPPED: tuple[str, ...] = ("drawn", "outdoor", "floor_has_plan", "too_big", "no_floor")


def box_side_m(devices: int) -> float:
    """A box's side for an area with this many devices in it."""
    extra = max(0, int(devices or 0) - BOX_FREE_DEVICES)
    return min(BOX_MAX_M, round(BOX_M + BOX_STEP_M * extra, 2))


def pack(sides: dict[str, float]) -> tuple[dict[str, list[list[float]]], float, float]:
    """Square boxes in rows, the biggest first (then by name), never overlapping: ({room: four corners in metres,
    clockwise from the top left, y down as on the plan}, across_m, down_m), the floor's size with its edge."""
    order = sorted(sides, key=lambda r: (-sides[r], r.casefold(), r))
    if not order:
        return {}, 0.0, 0.0
    width = max(max(sides.values()), math.sqrt(sum((s + GAP_M) ** 2 for s in sides.values())) * ROW_SHAPE)
    out: dict[str, list[list[float]]] = {}
    x = y = row_h = right = 0.0
    for room in order:
        s = sides[room]
        if x > 0 and x + s > width + 1e-9:
            y += row_h + GAP_M
            x = row_h = 0.0
        x0, y0 = EDGE_M + x, EDGE_M + y
        out[room] = [[round(x0, 3), round(y0, 3)], [round(x0 + s, 3), round(y0, 3)],
                     [round(x0 + s, 3), round(y0 + s, 3)], [round(x0, 3), round(y0 + s, 3)]]
        right = max(right, x + s)
        row_h = max(row_h, s)
        x += s + GAP_M
    return out, round(right + 2 * EDGE_M, 3), round(y + row_h + 2 * EDGE_M, 3)


def plan(floors: list[dict], areas: list[dict], devices: dict[str, int], taken: set[str], drawn: set[str], *,
         only: str | None = None, no_floor_to: str | None = None, max_m: float = 200.0) -> dict[str, Any]:
    """Pure: what one press would make. `floors` [{id, name}] in the house's order; `areas` [{id, name, floor_id}];
    `devices` {area id: devices in it}; `taken` the floors with a plan or rooms already; `drawn` the rooms that already
    have an outline; `only` one floor's boxes only; `no_floor_to` where the areas with no floor go (none, or one that
    isn't offered: the chosen floor, else the first floor being made). max_m: a floor's longest side (BLANK_MAX_M).

    {"floors": [{floor_id, name, across_m, down_m, rooms: [{name, devices, side_m, points_m}]}],
     "skipped": [{room, why, floor_id}], "no_floor": {"to", "rooms"}, "choices": [[floor id, name]]}"""
    indoor = [f for f in floors if f.get("id") and not is_outdoor_floor(f.get("id")) and not is_outdoor_floor(f.get("name"))]
    known = {str(f["id"]) for f in floors if f.get("id")}
    outdoors = known - {str(f["id"]) for f in indoor}       # by its id or its name (a floor called Garden)
    free = [f for f in indoor if str(f["id"]) not in taken and (only is None or str(f["id"]) == only)]
    choices = [[str(f["id"]), str(f.get("name") or f["id"])] for f in free]
    to = no_floor_to if no_floor_to in {c[0] for c in choices} else (only if only in {c[0] for c in choices} else (choices[0][0] if choices else None))
    if to is None and indoor:
        to = str(indoor[0]["id"])           # every floor taken: said under that floor, as its own areas are
    skipped: list[dict[str, Any]] = []
    wanted: dict[str, list[dict]] = {}
    no_floor: list[str] = []
    for a in sorted(areas, key=lambda a: str(a.get("name") or "").casefold()):
        name = str(a.get("name") or "").strip()
        if not name:
            continue
        fid = a.get("floor_id") if a.get("floor_id") in known else None
        on = str(fid) if fid else to
        if only is not None and on != only:
            continue
        if name in drawn:
            skipped.append({"room": name, "why": "drawn", "floor_id": on})
            continue
        if on is None or on in outdoors or is_outdoor_floor(on):
            skipped.append({"room": name, "why": "outdoor" if on else "no_floor", "floor_id": on})
            continue
        if on in taken:
            skipped.append({"room": name, "why": "floor_has_plan", "floor_id": on})
            continue
        if not fid:
            no_floor.append(name)
        wanted.setdefault(on, []).append(a)
    out_floors = []
    for f in free:
        fid = str(f["id"])
        rooms = wanted.get(fid) or []
        if not rooms:
            continue
        count = {str(a["name"]).strip(): int(devices.get(str(a.get("id") or ""), 0)) for a in rooms}
        sides = {r: box_side_m(n) for r, n in count.items()}
        boxes, across, down = pack(sides)
        if max(across, down) > max_m:
            skipped.extend({"room": r, "why": "too_big", "floor_id": fid} for r in sides)
            no_floor = [r for r in no_floor if r not in sides]
            continue
        out_floors.append({"floor_id": fid, "name": str(f.get("name") or fid), "across_m": across, "down_m": down,
                           "rooms": [{"name": r, "devices": count[r], "side_m": sides[r], "points_m": boxes[r]} for r in boxes]})
    return {"floors": out_floors, "skipped": skipped, "no_floor": {"to": to if no_floor else None, "rooms": no_floor}, "choices": choices}


def house_floors(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The house's floors in order, as the panel has them (padspan_ha/model_get): Home Assistant's floor registry by
    level, else PadSpan's own list, else the main floor. [{id, name, level}]."""
    floors: list[dict[str, Any]] = []
    try:
        from homeassistant.helpers import floor_registry as fr_helper  # noqa: PLC0415
        fr = fr_helper.async_get(hass)
        floors = [{"id": f.floor_id, "name": f.name, "level": getattr(f, "level", None)}
                  for f in sorted(fr.async_list_floors(), key=lambda x: (getattr(x, "level", 0) or 0, x.name))]
    except Exception:  # noqa: BLE001
        _quiet_error("websocket:model_get_floors")
    if not floors:
        mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        floors = mdl.floors() if mdl else [{"id": DEFAULT_FLOOR_ID, "name": "Main Floor"}]
    return floors


def _devices_per_area(hass: HomeAssistant) -> dict[str, int]:
    """{area id: devices in it} from Home Assistant's device registry (disabled devices left out); none if unreadable."""
    try:
        from homeassistant.helpers import device_registry as dr  # noqa: PLC0415
        from .util import ha_devices  # noqa: PLC0415  (the one read of the registry right on every supported HA)
        out: dict[str, int] = {}
        for d in ha_devices(dr.async_get(hass)):
            a = getattr(d, "area_id", None)
            if a and not getattr(d, "disabled_by", None):
                out[str(a)] = out.get(str(a), 0) + 1
        return out
    except Exception:  # noqa: BLE001 — every box the default size then
        _quiet_error("starter_house:devices")
        return {}


def floor_taken(ms: Any, fab: Any, floor_id: str) -> bool:
    """A plan or a room on this floor already (the vacuum import's own rule, ws_vacuum._floor_is_empty)."""
    from .ws_vacuum import _floor_is_empty  # noqa: PLC0415
    return not _floor_is_empty(ms, fab, floor_id)


def facts(hass: HomeAssistant) -> dict[str, Any]:
    """What plan() reads, from the house now."""
    from .ai_wizard import ha_areas  # noqa: PLC0415
    dom = hass.data.get(DOMAIN, {})
    ms, fab = dom.get(DATA_MAPS), dom.get(DATA_FABRIC)
    floors = house_floors(hass)
    maps = (ms.data.get("maps") if ms else None) or []
    drawn = set(fab.rooms_flat()) if fab else set()
    for m in maps:
        if isinstance(m, dict):
            drawn |= {str(r) for r in (m.get("room_bounds") or {})}
    ids = {str(f["id"]) for f in floors if f.get("id")} | {str(m.get("floor_id") or DEFAULT_FLOOR_ID) for m in maps if isinstance(m, dict)}
    taken = {fid for fid in ids if ms is not None and floor_taken(ms, fab, fid)}
    return {"floors": floors, "areas": ha_areas(hass), "devices": _devices_per_area(hass), "taken": taken, "drawn": drawn}


async def async_make(hass: HomeAssistant, got: dict[str, Any], label: str) -> dict[str, Any]:
    """Write what plan() said: each floor's plan, then its boxes. A floor taken meanwhile (another tab) is left out
    and its rooms listed; a box the writer refuses (a room that appeared meanwhile) is listed too and left out of the
    plan's record. Returns {maps, rooms, skipped}."""
    from .ws_common import _invalidate_snapshot_cache  # noqa: PLC0415
    from .ws_maps import async_add_blank_floor  # noqa: PLC0415
    dom = hass.data.get(DOMAIN, {})
    ms, fab, mdl = dom.get(DATA_MAPS), dom.get(DATA_FABRIC), dom.get(DATA_MODEL)
    made, rooms, skipped = [], [], list(got.get("skipped") or [])
    for f in got.get("floors") or []:
        fid = f["floor_id"]
        if floor_taken(ms, fab, fid):
            skipped.extend({"room": r["name"], "why": "floor_has_plan", "floor_id": fid} for r in f["rooms"])
            continue
        boxes = {r["name"]: r["points_m"] for r in f["rooms"]}
        name = f"{f['name']} ({label})"[:120]
        info = await async_add_blank_floor(hass, ms, name, fid, f["across_m"], f["down_m"],
                                           starter={"made": time.strftime("%Y-%m-%d", time.gmtime()), "rooms": boxes})
        kept: dict[str, list] = {}
        for room, pts in boxes.items():
            res = await fab.async_correct_room(fid, room, {"type": "poly", "points_m": pts}, committed_by="external_import")
            if not res.get("ok"):
                skipped.append({"room": room, "why": "drawn", "floor_id": fid})
                continue
            kept[room] = pts
            rooms.append(room)
            # As fabric_room_add makes a room: its settings entry (on this floor, where it had none) and its adjacency.
            had = room in (mdl.data.get("room_meta") or {})
            await mdl.async_ensure_rooms([room])
            if not had:
                mdl.data["room_meta"][room]["floor_id"] = fid
            mdl.data.setdefault("room_adjacency", {}).setdefault(room, [])
        await mdl.store.async_save(mdl.data)
        if kept != boxes:
            m = ms.get_map(info["id"])
            if m is not None:
                m["starter"]["rooms"] = kept
                await ms.store.async_save(ms.data)
        made.append(ms.get_map(info["id"]) or info)
    if rooms:
        _invalidate_snapshot_cache(hass)
    _LOGGER.info("Starter house: %d plans, %d rooms made, %d areas left out", len(made), len(rooms), len(skipped))
    return {"maps": made, "rooms": rooms, "skipped": skipped}
