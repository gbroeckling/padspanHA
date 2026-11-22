# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Follow Home Assistant area renames (2026-11-22).

PadSpan keys a room by its Home Assistant area's NAME. Renaming an area in
Home Assistant used to leave the room under the old name everywhere PadSpan
stores it, so it showed as "PadSpan only, not a Home Assistant area"
(views/rooms.js) and the new area as a room with nothing drawn.

Home Assistant's area_registry_updated event says only which area changed
(action, area_id), not its old name, so the names are kept here by area_id,
filled at setup and kept up to date by the same events. On a rename this
renames the room, once, in every store below that is loaded, each saved
once, after an automatic backup (ws_backup._auto_backup, slot "area_rename",
the last 3 kept), and logs one line saying what was renamed:

    fabric       floors[*].rooms[<room>] (the room's shape), beacon_positions_m[*].room
    model        room_meta[<room>], room_adjacency[<room>] and its neighbour lists, scanners[*].room
    maps         maps[*].room_bounds[<room>], maps[*].receivers[*].room
    calibration  points[*].room (and a room walk's "[walk] <room>" label); the forest retrains
    settings     room_tag_map[<room>] (and the coordinator's copy of it)
    alerts       Follow alerts' watch_rooms
    adaptive     room_fingerprints[<room>], transition_counts[<room>][<room>]

Not renamed (history, or a name kept only to show): see the list in
docs/manual/08-rooms-and-floors.md and the release note. The model's legacy
room_geometry_m copy is left alone on purpose: FabricStore's drift check
compares it with what it held, and the fabric is what rooms are read from.

A rename onto a name PadSpan already has as a room is not carried over (it
would merge two rooms): the log says so and nothing changes.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback as ha_callback

from .const import (
    ADAPTIVE_STORE_KEY, ALERTS_STORE_KEY, CALIBRATION_STORE_KEY, DATA_ADAPTIVE, DATA_ALERTS,
    DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN, FABRIC_STORE_KEY,
    MAPS_STORE_KEY, MODEL_STORE_KEY, SETTINGS_STORE_KEY,
)
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

_DATA_NAMES = "_area_rename_names"     # {area_id: name}
_DATA_UNSUB = "_area_rename_unsub"
_DATA_LOCK = "_area_rename_lock"
WALK_LABEL = "[walk] "                  # room_walk.LABEL_PREFIX + " "


# ── Each store's rename, on its data: how many places changed ────────────────

def _move_key(d: Any, old: str, new: str) -> int:
    if isinstance(d, dict) and old in d and new not in d:
        d[new] = d.pop(old)
        return 1
    return 0


def rename_in_fabric(data: dict, old: str, new: str) -> int:
    n = 0
    for floor in (data.get("floors") or {}).values():
        if isinstance(floor, dict):
            n += _move_key(floor.get("rooms"), old, new)
    for b in (data.get("beacon_positions_m") or {}).values():
        if isinstance(b, dict) and b.get("room") == old:
            b["room"] = new
            n += 1
    return n


def rename_in_model(data: dict, old: str, new: str) -> int:
    n = _move_key(data.get("room_meta"), old, new)
    adj = data.get("room_adjacency")
    n += _move_key(adj, old, new)
    for k, nbrs in (adj or {}).items():
        if isinstance(nbrs, list) and old in nbrs:
            adj[k] = [new if x == old else x for x in nbrs]
            n += 1
    for s in (data.get("scanners") or {}).values():
        if isinstance(s, dict) and s.get("room") == old:
            s["room"] = new
            n += 1
    return n


def rename_in_maps(data: dict, old: str, new: str) -> int:
    n = 0
    for m in data.get("maps") or []:
        if not isinstance(m, dict):
            continue
        n += _move_key(m.get("room_bounds"), old, new)
        for r in m.get("receivers") or []:
            if isinstance(r, dict) and r.get("room") == old:
                r["room"] = new
                n += 1
    return n


def rename_in_calibration(data: dict, old: str, new: str) -> int:
    n = 0
    for p in data.get("points") or []:
        if isinstance(p, dict) and p.get("room") == old:
            p["room"] = new
            if p.get("label") == WALK_LABEL + old:
                p["label"] = WALK_LABEL + new
            n += 1
    return n


def rename_in_room_tag_map(rtm: Any, old: str, new: str) -> int:
    return _move_key(rtm, old, new)


def rename_in_alerts(data: dict, old: str, new: str) -> int:
    n = 0
    for cfg in data.values():
        rooms = cfg.get("watch_rooms") if isinstance(cfg, dict) else None
        if isinstance(rooms, list) and old in rooms:
            cfg["watch_rooms"] = [new if r == old else r for r in rooms]
            n += 1
    return n


def rename_in_adaptive(data: dict, old: str, new: str) -> int:
    n = _move_key(data.get("room_fingerprints"), old, new)
    tc = data.get("transition_counts")
    n += _move_key(tc, old, new)
    for row in (tc or {}).values():
        n += _move_key(row, old, new)
    return n


def has_room(hass: HomeAssistant, name: str) -> bool:
    """Whether PadSpan already has a room by this name (its shape, its details
    or a plan's bounds)."""
    dom = hass.data.get(DOMAIN) or {}
    fab = getattr(dom.get(DATA_FABRIC), "data", None) or {}
    if any(name in ((f or {}).get("rooms") or {}) for f in (fab.get("floors") or {}).values() if isinstance(f, dict)):
        return True
    if name in ((getattr(dom.get(DATA_MODEL), "data", None) or {}).get("room_meta") or {}):
        return True
    maps = (getattr(dom.get(DATA_MAPS), "data", None) or {}).get("maps") or []
    return any(name in ((m or {}).get("room_bounds") or {}) for m in maps if isinstance(m, dict))


def uses_room(hass: HomeAssistant, name: str) -> bool:
    """has_room, or a calibration point or a Follow alert names it."""
    if has_room(hass, name):
        return True
    dom = hass.data.get(DOMAIN) or {}
    points = (getattr(dom.get(DATA_CALIBRATION), "data", None) or {}).get("points") or []
    if any(isinstance(p, dict) and p.get("room") == name for p in points):
        return True
    alerts = getattr(dom.get(DATA_ALERTS), "data", None) or {}
    return any(isinstance(c, dict) and name in (c.get("watch_rooms") or []) for c in alerts.values())


# ── The rename ───────────────────────────────────────────────────────────────

async def async_rename_room(hass: HomeAssistant, old: str, new: str) -> dict[str, int] | None:
    """Rename room `old` to `new` in every loaded store. Returns what changed,
    by store ({} when PadSpan had nothing under `old`), or None when it was not
    done (the name is taken, or the backup could not be made)."""
    old, new = str(old or ""), str(new or "")
    if not old or not new or old == new:
        return {}
    dom = hass.data.setdefault(DOMAIN, {})
    async with dom.setdefault(_DATA_LOCK, asyncio.Lock()):
        plan = [  # (name, data key, store key, rename)
            ("fabric", DATA_FABRIC, FABRIC_STORE_KEY, rename_in_fabric),
            ("model", DATA_MODEL, MODEL_STORE_KEY, rename_in_model),
            ("maps", DATA_MAPS, MAPS_STORE_KEY, rename_in_maps),
            ("calibration", DATA_CALIBRATION, CALIBRATION_STORE_KEY, rename_in_calibration),
            ("alerts", DATA_ALERTS, ALERTS_STORE_KEY, rename_in_alerts),
            ("adaptive", DATA_ADAPTIVE, ADAPTIVE_STORE_KEY, rename_in_adaptive),
        ]
        stores = [(name, dom.get(key), skey, fn) for name, key, skey, fn in plan
                  if isinstance(getattr(dom.get(key), "data", None), dict)]
        st = dom.get(DATA_SETTINGS)
        rtm = dict((getattr(st, "data", None) or {}).get("room_tag_map") or {})
        # Nothing under the old name (an area PadSpan never used): no backup, no save.
        if not uses_room(hass, old) and old not in rtm:
            return {}
        if has_room(hass, new):
            _LOGGER.warning("Home Assistant area %r was renamed to %r, but PadSpan already has a room called %r, "
                            "so the room was not renamed (that would merge two rooms).", old, new, new)
            return None
        from .ws_backup import _auto_backup  # noqa: PLC0415
        keys = [skey for _, _, skey, _ in stores] + ([SETTINGS_STORE_KEY] if st is not None else [])
        backup = await _auto_backup(hass, f"Before renaming room {old} to {new} (Home Assistant area renamed)",
                                    keys, slot="area_rename", slot_keep=3)
        if not backup:
            _LOGGER.warning("Home Assistant area %r was renamed to %r; the safety backup could not be made, "
                            "so PadSpan's room was not renamed.", old, new)
            return None
        done: dict[str, int] = {}
        for name, store, _, fn in stores:
            n = fn(store.data, old, new)
            if n:
                await store.store.async_save(store.data)
                done[name] = n
        if old in rtm and st is not None:
            rename_in_room_tag_map(rtm, old, new)
            await st.async_set(room_tag_map=rtm)
            coord = dom.get("coordinator")
            if coord is not None and isinstance(getattr(coord, "room_tag_map", None), dict):
                rename_in_room_tag_map(coord.room_tag_map, old, new)
            done["settings"] = 1
    try:
        if done.get("calibration"):
            dom[DATA_CALIBRATION].rf_points_changed()
        from .ws_common import _invalidate_snapshot_cache  # noqa: PLC0415
        _invalidate_snapshot_cache(hass)
    except Exception:  # noqa: BLE001 — the rename itself is saved
        _quiet_error("area_rename:after")
    _LOGGER.info("Home Assistant area renamed: PadSpan room %r is now %r (%s; backup %s)", old, new,
                 ", ".join(f"{k} {v}" for k, v in done.items()), backup)
    return done


# ── Listening ────────────────────────────────────────────────────────────────

def _area_name(hass: HomeAssistant, area_id: str) -> str | None:
    from homeassistant.helpers import area_registry as ar  # noqa: PLC0415
    area = ar.async_get(hass).async_get_area(area_id)
    return str(area.name) if area is not None else None


@ha_callback
def _on_area_updated(hass: HomeAssistant, event: Event) -> None:
    names = (hass.data.get(DOMAIN) or {}).get(_DATA_NAMES)
    if names is None:
        return
    action, area_id = event.data.get("action"), event.data.get("area_id")
    if not area_id:
        return
    if action == "remove":
        names.pop(area_id, None)
        return
    try:
        new = _area_name(hass, area_id)
    except Exception:  # noqa: BLE001
        _quiet_error("area_rename:lookup")
        return
    if new is None:
        return
    old = names.get(area_id)
    names[area_id] = new
    if action == "update" and old and old != new:
        hass.async_create_task(async_rename_room(hass, old, new))


def async_setup_area_rename(hass: HomeAssistant) -> None:
    """Idempotent across reloads (flood_latch.py's shape: functools.partial
    of an @callback function, so Home Assistant runs it on the loop)."""
    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_DATA_UNSUB):
        return
    from homeassistant.helpers import area_registry as ar  # noqa: PLC0415
    dom[_DATA_NAMES] = {a.id: str(a.name) for a in ar.async_get(hass).async_list_areas()}
    dom[_DATA_UNSUB] = hass.bus.async_listen("area_registry_updated", functools.partial(_on_area_updated, hass))


def async_stop_area_rename(hass: HomeAssistant) -> None:
    dom = hass.data.get(DOMAIN) or {}
    unsub = dom.pop(_DATA_UNSUB, None)
    dom.pop(_DATA_NAMES, None)
    if unsub:
        unsub()
