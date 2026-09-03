# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers that write the metric fabric: scanners, beacons, lights, rooms, walls, floors, map transforms.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DATA_FABRIC,
    DATA_OBJECTS,
    DEFAULT_FLOOR_ID,
    DATA_CALIBRATION,
    DATA_ADAPTIVE,
    DATA_ALERTS,
    DATA_MOVEMENT,
    DATA_TRACEBACK,
    DATA_DEVICE_REGISTRY,
)
from .fabric_truth import cluster_count as _cluster_count, geom_bbox_m as _geom_bbox_m
from .snapshot_builder import _live_snapshot
from .ws_common import _invalidate_snapshot_cache, _tier_at_least
from .telemetry import bump as _bump

_LOGGER = logging.getLogger(__name__)

# A refusal that names a product the user cannot find is a dead end. Both
# light-placement gates say the same thing, once, and it points at the two
# places that can resolve it: the licence card, and the page that sells a key.
_PRO_REQUIRED_MSG = (
    "Light placement needs PadSpan Bright Pro or PadSpan Pro. "
    "Enter a key in Settings \u2192 Features \u2192 PadSpan licence, "
    "or get one at https://padspan.traks.ca/#pro"
)



@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_scanner_remove",
        "source": str,
    }
)
@websocket_api.async_response
async def ws_fabric_scanner_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove a scanner from the positioning fabric."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    source = (msg.get("source") or "").strip()
    if not source:
        connection.send_error(msg["id"], "invalid", "source is required")
        return
    await mdl.async_remove_scanner(source)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_light_position_set",
        "entity_id": str,
        "x_m": vol.Coerce(float),
        "y_m": vol.Coerce(float),
        vol.Optional("floor_id"): str,
        vol.Optional("color"): str,
        vol.Optional("shape"): str,
        vol.Optional("rotation"): vol.Coerce(float),
        vol.Optional("width_cm"): vol.Coerce(float),
        vol.Optional("height_cm"): vol.Coerce(float),
        vol.Optional("margin_cm"): vol.Coerce(float),
        vol.Optional("label"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_light_position_set(hass: HomeAssistant, connection, msg) -> None:
    """Place a light in real-world metres. No photo involved.

    PadSpan Pro editing. The gate used to sit on the per-photo light list in
    maps_update, which the UI stopped writing when lights moved to metres —
    so the licence guarded a path nothing used while the live one was open.
    """
    if not _tier_at_least(hass, "bright"):
        connection.send_error(msg["id"], "pro_required", _PRO_REQUIRED_MSG)
        return
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    eid = (msg.get("entity_id") or "").strip()
    # Fans and motion sensors are placed on the lights map exactly like a
    # light — same store, same metres, same drag. The binary_sensor gate is
    # by domain only; the frontend admits motion-class sensors alone, and a
    # stray placement of another class is harmless (an unlit marker).
    if not (eid.startswith("light.") or eid.startswith("fan.") or eid.startswith("binary_sensor.")):
        connection.send_error(msg["id"], "invalid", "a light, fan or motion-sensor entity_id is required")
        return
    await mdl.async_set_light_position_m(
        eid, float(msg["x_m"]), float(msg["y_m"]),
        (msg.get("floor_id") or "").strip() or DEFAULT_FLOOR_ID,
        color=(msg.get("color") or "").strip(),
        shape=(msg.get("shape") or "").strip(),
        rotation=float(msg.get("rotation") or 0.0),
        width_cm=float(msg.get("width_cm") or 0.0),
        height_cm=float(msg.get("height_cm") or 0.0),
        margin_cm=float(msg.get("margin_cm") or 0.0),
        label=(msg.get("label") or "").strip(),
    )
    _bump(hass, "light_placed")
    connection.send_result(msg["id"], {"ok": True, "entity_id": eid})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_light_remove",
        "entity_id": str,
    }
)
@websocket_api.async_response
async def ws_fabric_light_remove(hass: HomeAssistant, connection, msg) -> None:
    """Un-place a light (it returns to automatic room clustering). Bright-tier editing."""
    if not _tier_at_least(hass, "bright"):
        connection.send_error(msg["id"], "pro_required", _PRO_REQUIRED_MSG)
        return
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    eid = (msg.get("entity_id") or "").strip()
    if not eid:
        connection.send_error(msg["id"], "invalid", "entity_id is required")
        return
    await mdl.async_remove_light_position_m(eid)
    _bump(hass, "light_removed")
    connection.send_result(msg["id"], {"ok": True, "entity_id": eid})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_beacon_position_set",
        "key": str,
        "x_m": vol.Coerce(float),
        "y_m": vol.Coerce(float),
        vol.Optional("floor_id"): str,
        vol.Optional("room"): str,
        vol.Optional("kind"): str,
        vol.Optional("label"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_beacon_position_set(hass: HomeAssistant, connection, msg) -> None:
    """Pin a beacon in real-world metres. No photo involved."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    key = (msg.get("key") or "").strip()
    if not key:
        connection.send_error(msg["id"], "invalid", "key is required")
        return
    fl = (msg.get("floor_id") or "").strip() or DEFAULT_FLOOR_ID
    x_m, y_m = float(msg["x_m"]), float(msg["y_m"])
    room = (msg.get("room") or "").strip() or mdl.beacon_room_from_geometry(x_m, y_m, fl)
    await mdl.async_set_beacon_position_m(
        key, x_m, y_m, fl,
        room=room, kind=(msg.get("kind") or "").strip(),
        label=(msg.get("label") or "").strip(),
    )
    connection.send_result(msg["id"], {"ok": True, "key": key, "room": room})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_beacon_remove",
        "key": str,
    }
)
@websocket_api.async_response
async def ws_fabric_beacon_remove(hass: HomeAssistant, connection, msg) -> None:
    """Un-pin a beacon from the positioning fabric.

    The deletion counterpart to a manual beacon placement: a batch save only
    writes the entries it carries, so dropping a pin from an editor's draft
    has to be an explicit removal or the fabric keeps it (and re-injects it
    into the map on the next re-derive).
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    key = (msg.get("key") or "").strip()
    if not key:
        connection.send_error(msg["id"], "invalid", "key is required")
        return
    await mdl.async_remove_beacon_position_m(key)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_room_add",
        "room": str,
        vol.Optional("floor_id"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_room_add(hass: HomeAssistant, connection, msg) -> None:
    """Add a PadSpan-native room (no HA area needed)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    room = (msg.get("room") or "").strip()
    if not room:
        connection.send_error(msg["id"], "invalid", "room is required")
        return
    floor_id = (msg.get("floor_id") or "").strip() or DEFAULT_FLOOR_ID
    await mdl.async_ensure_rooms([room])
    # Update floor_id if provided
    rm = mdl.data.get("room_meta", {})
    if room in rm:
        rm[room]["floor_id"] = floor_id
        await mdl.store.async_save(mdl.data)
    # Also init adjacency entry if not present
    adj = mdl.data.setdefault("room_adjacency", {})
    if room not in adj:
        adj[room] = []
        await mdl.store.async_save(mdl.data)
    _bump(hass, "room_committed")
    connection.send_result(msg["id"], {"ok": True, "room": room, "floor_id": floor_id})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_room_remove",
        "room": str,
    }
)
@websocket_api.async_response
async def ws_fabric_room_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove a room from the fabric: geometry, metadata, adjacency, scanners.

    This used to edit mdl.data directly — room_meta, adjacency and the scanner
    map — and never touched room_geometry_m, which had since moved to the
    FabricStore. The room's SHAPE therefore survived every delete, so it kept
    drawing on the map and kept being a room the positioning pipeline could
    choose. The store owns the write now, in one call, so there is no longer a
    place for a fourth copy to be forgotten.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    room = (msg.get("room") or "").strip()
    if not room:
        connection.send_error(msg["id"], "invalid", "room is required")
        return
    res = await mdl.async_remove_room(room)
    if not res.get("ok"):
        connection.send_error(msg["id"], "invalid", res.get("error") or "remove failed")
        return
    _invalidate_snapshot_cache(hass)
    _LOGGER.info("Fabric: removed room %s (geometry=%s, %d scanners detached)",
                 room, res.get("geometry_removed"), res.get("scanners_detached", 0))
    connection.send_result(msg["id"], {**res, "removed": room})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_sync_mode_set",
        "mode": str,
    }
)
@websocket_api.async_response
async def ws_fabric_sync_mode_set(hass: HomeAssistant, connection, msg) -> None:
    """Switch fabric sync mode: 'auto' (sync from HA) or 'manual' (standalone)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    mode = (msg.get("mode") or "").strip().lower()
    if mode not in ("auto", "manual"):
        connection.send_error(msg["id"], "invalid", "mode must be 'auto' or 'manual'")
        return
    await mdl.async_set_sync_mode(mode)
    # If switching to auto, trigger immediate HA sync
    if mode == "auto":
        try:
            await mdl.async_sync_from_ha()
        except Exception:
            pass
    connection.send_result(msg["id"], {"ok": True, "mode": mode})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_scanner_position_set",
        "source": str,
        "x_m": float,
        "y_m": float,
        vol.Optional("z_m"): float,
        vol.Optional("floor_id"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_scanner_position_set(hass: HomeAssistant, connection, msg) -> None:
    """Set a scanner's real-world position in metres."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    source = (msg.get("source") or "").strip()
    if not source:
        connection.send_error(msg["id"], "invalid", "source is required")
        return
    await mdl.async_set_scanner_position_m(
        source, float(msg["x_m"]), float(msg["y_m"]),
        float(msg.get("z_m", 2.4)),
        (msg.get("floor_id") or "").strip() or DEFAULT_FLOOR_ID,
    )
    connection.send_result(msg["id"], {"ok": True, "source": source})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_scanner_z_set",
        "source": str,
        "z_m": vol.Coerce(float),
    }
)
@websocket_api.async_response
async def ws_fabric_scanner_z_set(hass: HomeAssistant, connection, msg) -> None:
    """Set only a scanner's mounting height (z stays through map syncs)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    ok = await mdl.async_set_scanner_z_m((msg.get("source") or "").strip(), float(msg["z_m"]))
    if not ok:
        connection.send_error(msg["id"], "not_found", "Scanner has no fabric position yet")
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_floor_elevations_set",
        "floors": list,  # [{id, level?, floor_to_floor_m?, base_elevation_m?}]
    }
)
@websocket_api.async_response
async def ws_fabric_floor_elevations_set(hass: HomeAssistant, connection, msg) -> None:
    """Upsert per-floor elevation data (floor-to-floor height / base elevation).

    Merge-only: unlisted floors are untouched; ids unknown to the ModelStore
    (HA-registry floor ids appear here the first time elevation data is
    written for them) are created.  Null clears a field.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    floors = await mdl.async_set_floor_elevations(msg.get("floors") or [])
    connection.send_result(msg["id"], {
        "floors": floors,
        "floor_elevations": mdl.floor_base_elevations_m(),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_correct_room",
        "floor_id": str,
        "room": str,
        "geometry": dict,
        vol.Optional("source_map_id"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_correct_room(hass: HomeAssistant, connection, msg) -> None:
    """Directly correct one room's real-world shape in the FabricStore.

    Always allowed — a committed floor blocks bulk re-commits, never
    corrections. This is the room editor's save path.

    `source_map_id` is the client asserting "this geometry is, unedited, what
    that map's placement implies right now" — the Rooms tab sends it only
    when committing an untouched Map-placements candidate room. The stamp's
    transform is read HERE, from the model store, never from the client: the
    claim is about the server's current placement, so the server records what
    that placement actually is. No readable placement, no stamp — the write
    still happens, it just carries no claim.
    """
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    if not fab:
        connection.send_error(msg["id"], "no_fabric", "FabricStore not loaded")
        return
    room = (msg.get("room") or "").strip()
    geo = msg.get("geometry")
    if not room or not isinstance(geo, dict):
        connection.send_error(msg["id"], "invalid", "room and geometry dict are required")
        return
    source_map_id = (msg.get("source_map_id") or "").strip() or None
    source_transform = None
    source_image = None
    if source_map_id:
        from . import fabric_truth  # noqa: PLC0415
        mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        source_transform = fabric_truth.placement_snapshot(
            mdl.map_transform(source_map_id) if mdl else None)
        if source_transform is None:
            source_map_id = None
        elif ms:
            source_image = fabric_truth.image_identity(ms.get_map(source_map_id))
    res = await fab.async_correct_room(
        msg.get("floor_id") or DEFAULT_FLOOR_ID, room, geo,
        source_map_id=source_map_id, source_transform=source_transform,
        source_image=source_image)
    if not res.get("ok"):
        connection.send_error(msg["id"], res.get("error", "failed"), str(res))
        return
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_truth_candidates",
        "floor_id": str,
    }
)
@websocket_api.async_response
async def ws_fabric_truth_candidates(hass: HomeAssistant, connection, msg) -> None:
    """Read-only preview of every form of truth a floor's layout can come
    from, so the user can compare and pick the most accurate one BEFORE
    anything is committed to the base fabric.

    Returns {fabric, transforms} — each {rooms, stats} — plus the per-map
    placement table.

    THERE USED TO BE THREE. The third, `stack`, composed the hand-tuned
    alignment and anchored it to metres, and it was a genuine second opinion
    while the alignment was stored separately. It is derived from the same
    record `transforms` reads, so the two agree to 0.0 m by construction —
    measured over 20 maps, exactly zero. A truth selector offering two
    candidates that cannot differ is not a comparison, and an owner picking
    between them is being asked a question with one answer.

    `agrees` and the two repair buttons went with it, for the same reason: a
    map cannot disagree with itself. Every one of the four historical states
    they were built to catch — a trim, a 50 m displacement, a half-turn, a
    mirror — reports nothing here now, because the picture moves with the
    record. See `map_geometry_faults` for the faults that are still possible.
    """
    from . import fabric_truth

    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not fab or not mdl or not ms:
        connection.send_error(msg["id"], "no_stores", "Fabric/Model/Maps store not loaded")
        return
    fl = str(msg.get("floor_id") or DEFAULT_FLOOR_ID)
    all_maps = ms.data.get("maps") or []
    floor_maps = [m for m in all_maps if str(m.get("floor_id", DEFAULT_FLOOR_ID)) == fl]

    fabric_rooms = {r: g for r, g in fab.rooms_flat().items() if str(g.get("floor_id")) == fl}
    transforms_rooms = fabric_truth.rooms_from_transforms(floor_maps, mdl)

    gauge = fabric_truth.metre_gauge(mdl)
    _faults = {f["map_id"]: f for f in fabric_truth.map_geometry_faults(all_maps, mdl)}

    placements = []
    for m in floor_maps:
        mid = m.get("id", "")
        t = mdl.map_transform(mid) or {}
        placements.append({
            "map_id": mid,
            "name": m.get("name", mid),
            "system": {
                "origin_x_m": t.get("origin_x_m"), "origin_y_m": t.get("origin_y_m"),
                "scale_x_m": t.get("scale_x_m"), "scale_y_m": t.get("scale_y_m"),
                "rotation_rad": t.get("rotation_rad", 0),
                "shear_rad": t.get("shear_rad", 0),
                "measured": bool(t.get("reference_measurements")),
            } if t else None,
            "geometry_fault": _faults.get(mid),
        })

    # Rooms on this floor the explicit reconcile could safely re-derive —
    # provenance-stamped, unedited since, their source map's placement moved.
    # Rides in this response because the Rooms tab already fetches it on
    # every render; the ACTION is its own command below.
    reconcilable = [r for r in fabric_truth.reconcilable_rooms(fab.rooms_flat(), all_maps, mdl)
                    if r["floor_id"] == fl]

    # Maps on this floor whose trace and committed fabric have drifted apart
    # as a group — one of the two records predates a map change, and only a
    # person looking at the preview can tell which. Same ride-along.
    divergence = [d for d in fabric_truth.room_divergence_faults(fab.rooms_flat(), all_maps, mdl)
                  if d["floor_id"] == fl]

    connection.send_result(msg["id"], {
        "floor_id": fl,
        "fabric": {"rooms": fabric_rooms, "stats": fabric_truth.rooms_stats(fabric_rooms)},
        "transforms": {"rooms": transforms_rooms, "stats": fabric_truth.rooms_stats(transforms_rooms)},
        "world_gauge": gauge,
        "no_world_frame_reason": None if gauge else "no map anywhere in the house has a reference-measured scale",
        "placements": placements,
        "reconcilable": reconcilable,
        "divergence": divergence,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_rooms_reconcile",
        "floor_id": str,
    }
)
@websocket_api.async_response
async def ws_fabric_rooms_reconcile(hass: HomeAssistant, connection, msg) -> None:
    """Re-derive this floor's provenance-clean rooms from their maps' current
    placements. The ONE sanctioned map→fabric write, and only as this
    explicit command — never a side effect of another save.

    Eligibility is decided HERE, at execution time, by
    `fabric_truth.reconcilable_rooms` — a client cannot widen the set by
    sending room names, because it does not send any. A room a person has
    hand-corrected carries no provenance stamp and is structurally out of
    reach. Every skip and every failure is reported by name; nothing is
    swallowed. (Its silent, unconditional ancestor is the f3466fc incident —
    see the FabricStore header for why this one is shaped the way it is.)
    """
    from . import fabric_truth

    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not fab or not mdl or not ms:
        connection.send_error(msg["id"], "no_stores", "Fabric/Model/Maps store not loaded")
        return
    fl = str(msg.get("floor_id") or DEFAULT_FLOOR_ID)
    all_maps = ms.data.get("maps") or []
    maps_by_id = {m.get("id"): m for m in all_maps if m.get("id")}

    eligible = [r for r in fabric_truth.reconcilable_rooms(fab.rooms_flat(), all_maps, mdl)
                if r["floor_id"] == fl]
    fixed: list[str] = []
    failed: list[dict[str, str]] = []
    for r in eligible:
        m = maps_by_id.get(r["map_id"])
        geo = fabric_truth.recompute_room_from_map(m, r["room"], mdl) if m else None
        if geo is None:
            failed.append({"room": r["room"], "error": "recompute_failed"})
            continue
        snap = fabric_truth.placement_snapshot(mdl.map_transform(r["map_id"]))
        res = await fab.async_correct_room(
            fl, r["room"], geo, committed_by="reconcile",
            source_map_id=r["map_id"], source_transform=snap,
            source_image=fabric_truth.image_identity(m))
        if res.get("ok"):
            fixed.append(r["room"])
        else:
            failed.append({"room": r["room"], "error": str(res.get("error", "failed"))})
    if fixed:
        _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {
        "floor_id": fl, "fixed": fixed, "failed": failed,
        "eligible": [r["room"] for r in eligible],
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_floor_finalize",
        "floor_id": str,
        "committed": bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_floor_finalize(hass: HomeAssistant, connection, msg) -> None:
    """Finalize (lock) or unlock a floor's fabric. Flips only the flag."""
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    if not fab:
        connection.send_error(msg["id"], "no_fabric", "FabricStore not loaded")
        return
    res = await fab.async_set_floor_committed(
        msg.get("floor_id") or DEFAULT_FLOOR_ID, bool(msg.get("committed"))
    )
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_rf_barrier_set",
        "barrier": dict,
    }
)
@websocket_api.async_response
async def ws_fabric_rf_barrier_set(hass: HomeAssistant, connection, msg) -> None:
    """Add or update an RF barrier in real-world metres, by id.

    A barrier without an id is new; the reply carries the stored entry with
    the id it was given, and that id is how it is addressed from then on.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    barrier = msg.get("barrier")
    if not isinstance(barrier, dict) or not barrier.get("name"):
        connection.send_error(msg["id"], "invalid", "barrier dict with name is required")
        return
    barrier.setdefault("floor_id", DEFAULT_FLOOR_ID)
    stored = await mdl.async_set_rf_barrier_m(barrier)
    if stored is None:
        connection.send_error(msg["id"], "invalid", "barrier needs a name and at least two points_m")
        return
    _bump(hass, "wall_placed")
    connection.send_result(msg["id"], {"ok": True, "barrier": stored})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_rf_barrier_remove",
        "barrier_id": str,
    }
)
@websocket_api.async_response
async def ws_fabric_rf_barrier_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove an RF barrier by id."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    bid = (msg.get("barrier_id") or "").strip()
    if not bid:
        connection.send_error(msg["id"], "invalid", "barrier_id is required")
        return
    await mdl.async_remove_rf_barrier_m(bid)
    _bump(hass, "wall_removed")
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_map_transform_set",
        "map_id": str,
        "transform": dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_map_transform_set(hass: HomeAssistant, connection, msg) -> None:
    """Set the affine transform for a map (frac ↔ metres).

    Admin-gated with its three siblings. It rewrites where a map sits in the
    house, which every position, every room and the world frame itself are
    read through — the same write `fabric_map_reanchor` has always required an
    admin for. Without the decorator any authenticated HA user could move any
    map.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    map_id = (msg.get("map_id") or "").strip()
    transform = msg.get("transform")
    if not map_id or not isinstance(transform, dict):
        connection.send_error(msg["id"], "invalid", "map_id and transform dict are required")
        return
    # A payload that does not STATE a floor has not moved the map to 'main'.
    # `_put_map_transform` carries `floor_id` with the placement coordinates
    # for exactly that reason — this is the σ rule on the field that decides
    # which storey a map's rooms are drawn on, and this handler is the one
    # writer that takes a client dict whole. The default below is only for a
    # record that has never had a floor, which is a map's first measurement.
    if "floor_id" not in transform and not mdl.map_transform(map_id):
        transform["floor_id"] = DEFAULT_FLOOR_ID
    await mdl.async_set_map_transform(map_id, transform)
    # An install's FIRST measurement is what gives the house a metre
    # scale, and this is the writer every measurement comes through. The
    # migration seeds a store that already had measured maps; without
    # this an install that measures its first map after upgrading would
    # wait for the next restart to be able to draw anything. Write-once,
    # so a re-measure re-places THIS MAP and does not rescale the house.
    try:
        _ms_seed = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        await mdl.async_ensure_world_gauge(
            (_ms_seed.data.get("maps") or []) if _ms_seed else [])
    except Exception:  # a gauge that could not be seeded is refusal, not failure
        _LOGGER.exception("Could not seed the world gauge after a transform write")
    # Remap calibration points using the new transform
    try:
        _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if _cal:
            await _cal.async_remap_from_metres(map_id)
    except Exception:
        pass
    _stored = (mdl.data.get("map_transforms") or {}).get(map_id, {})
    connection.send_result(msg["id"], {
        "ok": True, "map_id": map_id,
        "scale_x_m": _stored.get("scale_x_m"),
        "scale_y_m": _stored.get("scale_y_m"),
        "refs": len(_stored.get("reference_measurements", [])),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_map_reanchor",
        "map_id": str,
        vol.Optional("origin_x_m"): vol.Coerce(float),
        vol.Optional("origin_y_m"): vol.Coerce(float),
        vol.Optional("rotation_rad"): vol.Coerce(float),
        vol.Optional("scale_x_m"): vol.Coerce(float),
        vol.Optional("scale_y_m"): vol.Coerce(float),
        vol.Optional("shear_rad"): vol.Coerce(float),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_map_reanchor(hass: HomeAssistant, connection, msg) -> None:
    """Explicitly redefine a map's placement. All six fields.

    THE ALIGN EDITOR'S COMMIT. Dragging a plan over another one is a
    placement now, not a separate "stack" the metre record could not see, so
    the whole placement comes through here — scales and lean included — and
    through the one guard that can refuse it. Metres are the truth: the map's
    fracs re-derive through the new placement. Refuses (writing nothing) when
    it would strand the calibration pins off the map, and says so, which is
    why it is a Save button and not a mouseup.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    if not ms:
        connection.send_error(msg["id"], "no_maps", "Maps store not initialized")
        return
    map_id = (msg.get("map_id") or "").strip()
    m = ms.get_map(map_id)
    if not m:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return
    _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    res = await mdl.async_reanchor_map(
        map_id, m, _cal,
        origin_x_m=msg.get("origin_x_m"),
        origin_y_m=msg.get("origin_y_m"),
        rotation_rad=msg.get("rotation_rad"),
        scale_x_m=msg.get("scale_x_m"),
        scale_y_m=msg.get("scale_y_m"),
        shear_rad=msg.get("shear_rad"),
    )
    if not res.get("ok"):
        _err = res.get("error", "reanchor_failed")
        _detail = "Re-anchor refused"
        if _err == "points_out_of_range":
            _detail = (
                f"Re-anchor refused: {res.get('out_of_range', 0)}/{res.get('owned', 0)} "
                "calibration pins would land off the map under this pose; nothing was changed"
            )
        elif _err == "not_measured":
            _detail = "Map has no measured transform to re-anchor"
        elif _err == "invalid_pose":
            _detail = ("Placement must be finite numbers describing a map with "
                       "some area — a zero scale or a 90° lean places nothing")
        connection.send_error(msg["id"], _err, _detail)
        return
    if res.get("map_items_rederived"):
        await ms.store.async_save(ms.data)
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command({"type": "padspan_ha/fabric_health"})
@websocket_api.async_response
async def ws_fabric_health(hass: HomeAssistant, connection, msg) -> None:
    """Run diagnostic checks on the positioning fabric (Phase 1-3)."""
    checks: list[dict[str, Any]] = []
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")

    # ── Phase 1: Fabric sync ────────────────────────────────────────────────
    if mdl:
        scanners = mdl.data.get("scanners", {})
        sync_mode = mdl.sync_mode()
        ha_sync_count = sum(1 for s in scanners.values() if isinstance(s, dict) and s.get("source_type") == "ha_sync")
        manual_count = sum(1 for s in scanners.values() if isinstance(s, dict) and s.get("source_type") == "manual")
        adj = mdl.adjacency()
        adj_room_count = len(adj)
        adj_edge_count = sum(len(v) for v in adj.values()) // 2

        checks.append({
            "group": "fabric_sync", "name": "Sync Mode",
            "ok": True, "value": sync_mode,
            "detail": f"Mode: {sync_mode}",
        })
        checks.append({
            "group": "fabric_sync", "name": "Scanners in Fabric",
            "ok": len(scanners) > 0, "value": len(scanners),
            "detail": f"{len(scanners)} total ({ha_sync_count} ha_sync, {manual_count} manual)",
        })
        # List scanner→room mappings
        scanner_list = []
        for src, info in sorted(scanners.items()):
            if isinstance(info, dict):
                scanner_list.append({
                    "source": src, "room": info.get("room", "?"),
                    "floor_id": info.get("floor_id", "?"),
                    "source_type": info.get("source_type", "?"),
                })
        # Adjacency: pass if we have adjacency data OR centroid-based adjacency is active
        _has_centroids = bool(mdl.room_centroids_m()) or bool(mdl.room_geometry_m())
        checks.append({
            "group": "fabric_sync", "name": "Adjacency",
            "ok": adj_room_count > 0 or _has_centroids or len(scanners) <= 1,
            "value": f"{adj_room_count} rooms, {adj_edge_count} edges" + (" (centroids active)" if _has_centroids and adj_room_count == 0 else ""),
            "detail": f"{adj_room_count} rooms with neighbors, {adj_edge_count} bidirectional edges" +
                      (". Centroid-based adjacency prior active from room geometry." if _has_centroids and adj_room_count == 0 else ""),
        })
    else:
        checks.append({
            "group": "fabric_sync", "name": "ModelStore",
            "ok": False, "value": "not loaded",
            "detail": "ModelStore is not initialized — fabric is offline",
        })
        scanner_list = []

    # ── Phase 2: Spatial model ───────────────────────────────────────────────
    if mdl:
        positions = mdl.scanner_positions_m()
        geometry = mdl.room_geometry_m()
        barriers = mdl.rf_barriers_m()
        transforms = mdl.data.get("map_transforms", {})

        checks.append({
            "group": "spatial", "name": "Scanner Positions (metres)",
            "ok": len(positions) > 0, "value": len(positions),
            "detail": f"{len(positions)} scanners have real-world metre positions",
        })
        checks.append({
            "group": "spatial", "name": "Room Geometry (metres)",
            "ok": len(geometry) > 0, "value": len(geometry),
            "detail": f"{len(geometry)} rooms have real-world geometry (poly/circle)",
        })
        checks.append({
            "group": "spatial", "name": "RF Barriers (metres)",
            "ok": True, "value": len(barriers),
            "detail": f"{len(barriers)} barriers in real-world metre space",
        })
        # Build transform detail with scale and measurement info
        _tx_details = []
        for _mid, _tx in transforms.items():
            sx = _tx.get("scale_x_m", 0)
            sy = _tx.get("scale_y_m", 0)
            _refs = _tx.get("reference_measurements") or []
            _ref_str = f", {len(_refs)} ref measurement(s)" if _refs else ""
            _map_name = ""
            if ms:
                _m = ms.get_map(_mid)
                if _m:
                    _map_name = _m.get("name", _mid)
            _tx_details.append(f"{_map_name or _mid}: {sx:.1f}m × {sy:.1f}m{_ref_str}")
        checks.append({
            "group": "spatial", "name": "Map Transforms",
            "ok": len(transforms) > 0 or (ms and not ms.list_maps()),
            "value": len(transforms),
            "detail": "; ".join(_tx_details) if _tx_details else "No transforms",
        })
        # Reference measurements check
        _total_refs = sum(len(t.get("reference_measurements") or []) for t in transforms.values() if isinstance(t, dict))
        _has_refs = _total_refs > 0
        checks.append({
            "group": "spatial", "name": "Scale Calibration",
            "ok": _has_refs,
            "value": f"{_total_refs} measurement(s)" if _has_refs else "not calibrated",
            "detail": f"{_total_refs} reference distance measurement(s) from the Measure tool" if _has_refs else "Use the Measure tool in Maps \u2192 Edit to set real-world scale from known distances",
        })

        # Check if coordinator is using metre model
        use_metres = getattr(pc, "_use_metres", False) if pc else False
        checks.append({
            "group": "spatial", "name": "Coordinator Mode",
            "ok": True, "value": "metres" if use_metres else "map fractions",
            "detail": "Presence coordinator is using " + ("real-world metre model" if use_metres else "legacy map-fraction model"),
        })

        # Scanner positions detail list
        position_list = []
        for src, pos in sorted(positions.items()):
            if isinstance(pos, dict):
                position_list.append({
                    "source": src,
                    "x_m": pos.get("x_m"), "y_m": pos.get("y_m"), "z_m": pos.get("z_m"),
                    "floor_id": pos.get("floor_id", "?"),
                    "map_id": pos.get("map_id"),
                })

        # Room geometry detail list
        geometry_list = []
        centroids = mdl.room_centroids_m()
        for room, geo in sorted(geometry.items()):
            if isinstance(geo, dict):
                c = centroids.get(room)
                geometry_list.append({
                    "room": room, "type": geo.get("type", "?"),
                    "floor_id": geo.get("floor_id", "?"),
                    "origin": geo.get("committed_by") or geo.get("origin", "?"),
                    "centroid_m": [round(c[0], 2), round(c[1], 2)] if c else None,
                })

        # ── Fabric floor status + disconnected-cluster diagnostic ─────────
        # A floor whose room shapes form more than one spatially disconnected
        # group is the signature of the fabricated-transform corruption —
        # surface it proactively instead of waiting for positioning to lie.
        _fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
        fabric_floors = _fab.floors_status() if _fab else {}
        _by_floor: dict[str, list] = {}
        for _room, _geo in geometry.items():
            if isinstance(_geo, dict):
                _bb = _geom_bbox_m(_geo)
                if _bb:
                    _by_floor.setdefault(str(_geo.get("floor_id", "?")), []).append(_bb)
        for _fl, _bbs in _by_floor.items():
            _clusters = _cluster_count(_bbs)
            _entry = fabric_floors.setdefault(_fl, {"committed": False, "committed_at": None, "rooms": len(_bbs)})
            _entry["clusters"] = _clusters
            _entry["bbox_w_m"] = round(max(b[2] for b in _bbs) - min(b[0] for b in _bbs), 1)
            _entry["bbox_h_m"] = round(max(b[3] for b in _bbs) - min(b[1] for b in _bbs), 1)
            checks.append({
                "group": "spatial", "name": f"Floor '{_fl}' coherence",
                "ok": _clusters <= 1,
                "value": f"{_clusters} cluster" + ("s" if _clusters != 1 else ""),
                "detail": (
                    f"{len(_bbs)} rooms form one connected floor plan"
                    if _clusters <= 1 else
                    f"{len(_bbs)} rooms fall into {_clusters} disconnected groups — "
                    "open Mapping → Rooms and drag the stray group into place"
                ),
            })
    else:
        position_list = []
        geometry_list = []
        fabric_floors = {}

    # ── Phase 3: Calibration metres ──────────────────────────────────────────
    if cal:
        pts = cal.data.get("points", [])
        total_pts = len(pts)
        pts_with_m = sum(1 for p in pts if p.get("x_m") is not None)
        pts_without_m = total_pts - pts_with_m

        checks.append({
            "group": "calibration", "name": "Calibration Points",
            "ok": total_pts > 0, "value": total_pts,
            "detail": f"{total_pts} total calibration fingerprint points",
        })
        checks.append({
            "group": "calibration", "name": "Points with Metres",
            "ok": pts_without_m == 0 or total_pts == 0,
            "value": f"{pts_with_m}/{total_pts}",
            "detail": f"{pts_with_m} of {total_pts} points have x_m/y_m coordinates" +
                      (f" ({pts_without_m} with no real-world position — record them again where you are standing)" if pts_without_m > 0 else " — all anchored"),
        })

        # ModelStore wired?
        has_model_ref = cal._model is not None
        checks.append({
            "group": "calibration", "name": "ModelStore Wired",
            "ok": has_model_ref, "value": "yes" if has_model_ref else "no",
            "detail": "CalibrationStore " + ("has" if has_model_ref else "MISSING") + " reference to ModelStore for metre conversions",
        })

        # RF trained in metres?
        rf_trained = cal.rf_trained
        rf_metres = getattr(cal._rf, "_use_metres", False) if rf_trained else False
        checks.append({
            "group": "calibration", "name": "RF Model",
            "ok": rf_trained, "value": ("metres" if rf_metres else "fractions") if rf_trained else "not trained",
            "detail": ("Random Forest trained in " + ("metre" if rf_metres else "fraction") + " space") if rf_trained else "RF not trained (need ≥4 points)",
        })

        # LOO accuracy
        loo = cal.loo_accuracy()
        if loo:
            err_str = f"{loo['mean_error_m']}m"
            checks.append({
                "group": "calibration", "name": "LOO Accuracy",
                "ok": True, "value": err_str,
                "detail": f"Mean error: {err_str}, median: "
                          f"{loo.get('median_error_m', '?')}m "
                          f"({loo['point_count']} points)",
            })
    else:
        checks.append({
            "group": "calibration", "name": "CalibrationStore",
            "ok": False, "value": "not loaded",
            "detail": "CalibrationStore is not initialized",
        })

    # ── Device Registry ───────────────────────────────────────────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            _dev_count = _dev_reg.device_count()
            _labeled = _dev_reg.all_labeled()
            _labeled_count = len(_labeled)
            checks.append({
                "group": "identity", "name": "Device Registry",
                "ok": True, "value": f"{_dev_count} devices",
                "detail": f"{_dev_count} persistent devices, {_labeled_count} labeled",
            })
            # Migration status
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            _obj_count = len(obj_store.all()) if obj_store else 0
            _needs_migration = _dev_count == 0 and _obj_count > 0
            checks.append({
                "group": "identity", "name": "Identity Migration",
                "ok": not _needs_migration,
                "value": "needed" if _needs_migration else "complete",
                "detail": (f"{_obj_count} objects in legacy store need migration to Device Registry"
                           if _needs_migration else
                           f"Device Registry active ({_dev_count} devices, {_labeled_count} labeled)"),
            })
        else:
            checks.append({
                "group": "identity", "name": "Device Registry",
                "ok": False, "value": "not loaded",
                "detail": "DeviceRegistry is not initialized",
            })
    except Exception:
        pass

    # ── Dependent store identity migration ──────────────────────────────────
    try:
        from .const import DATA_MOVEMENT, DATA_TRACEBACK, DATA_ALERTS, DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg and _dev_reg.device_count() > 0:
            # Movement store: check how many entries have padspan_id
            _mv = hass.data.get(DOMAIN, {}).get(DATA_MOVEMENT)
            if _mv:
                _mv_total = len(_mv.entries)
                _mv_with_pid = sum(1 for e in _mv.entries if e.get("padspan_id"))
                checks.append({
                    "group": "identity", "name": "Movement History",
                    "ok": _mv_total == 0 or _mv_with_pid > 0,
                    "value": f"{_mv_with_pid}/{_mv_total}",
                    "detail": f"{_mv_with_pid} of {_mv_total} movement entries have stable padspan_id",
                })

            # Traceback: check recent frames for padspan_id
            _tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
            if _tb and _tb.frames:
                _recent = _tb.frames[-min(100, len(_tb.frames)):]
                _tb_objs = sum(len(f.get("o", [])) for f in _recent)
                _tb_with_pid = sum(1 for f in _recent for o in f.get("o", []) if o.get("pid"))
                checks.append({
                    "group": "identity", "name": "Traceback Frames",
                    "ok": _tb_objs == 0 or _tb_with_pid > 0,
                    "value": f"{_tb_with_pid}/{_tb_objs} (last 100 frames)",
                    "detail": f"{_tb_with_pid} of {_tb_objs} traceback objects have stable padspan_id",
                })

            # Alert configs: check for padspan_id
            _al = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
            if _al:
                _al_total = len(_al.data)
                _al_with_pid = sum(1 for v in _al.data.values() if isinstance(v, dict) and v.get("padspan_id"))
                checks.append({
                    "group": "identity", "name": "Follow Alerts",
                    "ok": _al_total == 0 or _al_with_pid > 0,
                    "value": f"{_al_with_pid}/{_al_total}",
                    "detail": f"{_al_with_pid} of {_al_total} alert configs have stable padspan_id",
                })
    except Exception:
        pass

    # ── Label pipeline health ───────────────────────────────────────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if _dev_reg:
            # Compare label counts: DeviceRegistry vs ObjectStore
            _reg_labeled = len(_dev_reg.all_labeled())
            _obj_labeled = 0
            _obj_only = 0  # labels in ObjectStore but NOT in DeviceRegistry
            if obj_store:
                _obj_all = obj_store.all()
                for _oaddr, _oval in _obj_all.items():
                    if isinstance(_oval, dict) and _oval.get("label"):
                        _obj_labeled += 1
                        _pid = _dev_reg.resolve(_oaddr)
                        if not _pid or not _dev_reg.get_label(_pid):
                            _obj_only += 1
            checks.append({
                "group": "identity", "name": "Label Pipeline",
                "ok": _obj_only == 0,
                "value": f"Registry: {_reg_labeled}, Legacy: {_obj_labeled}" + (f", {_obj_only} unmigrated" if _obj_only else ""),
                "detail": (f"{_obj_only} labels exist only in legacy ObjectStore — re-save them or restart to trigger migration"
                           if _obj_only else
                           f"All labels in DeviceRegistry ({_reg_labeled} devices). Legacy ObjectStore has {_obj_labeled} entries (fallback only)."),
            })
    except Exception:
        pass

    # ── HA Entity identity ──────────────────────────────────────────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        _pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if _dev_reg and _pc and _pc.data:
            _ent_total = len(_pc.data)
            _ent_with_pid = sum(1 for v in _pc.data.values() if isinstance(v, dict) and v.get("padspan_id"))
            checks.append({
                "group": "identity", "name": "Entity Identity",
                "ok": _ent_total == 0 or _ent_with_pid > 0,
                "value": f"{_ent_with_pid}/{_ent_total}",
                "detail": f"{_ent_with_pid} of {_ent_total} tracked objects have padspan_id (used for HA device identity)",
            })
    except Exception:
        pass

    # ── Phase B: Multi-floor + Occupancy ────────────────────────────────────
    try:
        _ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
        _pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if _ad:
            # Floor transition learning
            _ft = _ad.data.get("floor_transitions", {})
            _ft_total = sum(e.get("n", 0) for e in _ft.values() if isinstance(e, dict))
            _ft_pairs = len(_ft)
            checks.append({
                "group": "multifloor", "name": "Floor Transition Learning",
                "ok": True, "value": f"{_ft_total} observations, {_ft_pairs} pairs",
                "detail": f"{_ft_total} floor transitions recorded across {_ft_pairs} floor pairs" +
                          (f" ({', '.join(k + ':' + str(v.get('n',0)) for k,v in _ft.items() if isinstance(v,dict))})" if _ft_pairs else "")
                          if _ft_total else "No floor transitions recorded yet — learning starts automatically when devices change floors",
            })
            # Learned cross-floor attenuation
            _fp = _ad.data.get("floor_pairs", {})
            _fp_ready = sum(1 for v in _fp.values() if isinstance(v, dict) and v.get("n", 0) >= 10)
            _fp_total = len(_fp)
            checks.append({
                "group": "multifloor", "name": "Cross-Floor Attenuation",
                "ok": True, "value": f"{_fp_ready}/{_fp_total} pairs ready",
                "detail": f"{_fp_ready} floor pairs have enough data (>10 obs) for learned attenuation correction" +
                          (". " + ", ".join(f"{k}: {v.get('mean',0):.1f}dB ({v.get('n',0)} obs)" for k,v in _fp.items() if isinstance(v,dict) and v.get("n",0) >= 10) if _fp_ready else ""),
            })
        # Dwell tracking
        if _pc:
            _dwell_count = len(getattr(_pc, "_room_dwell_start", {}))
            _floor_count = len(getattr(_pc, "_device_floor", {}))
            checks.append({
                "group": "multifloor", "name": "Dwell Tracking",
                "ok": True, "value": f"{_dwell_count} devices tracked",
                "detail": f"{_dwell_count} devices with room dwell tracking, {_floor_count} with floor assignment",
            })
        # Occupancy
        try:
            _st_occ = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _occ_training = ((_st_occ.data if _st_occ else {}).get("occupancy_training") or []) if _st_occ else []
            _occ_mult = float((_st_occ.data if _st_occ else {}).get("occupancy_multiplier", 1.5)) if _st_occ else 1.5
            checks.append({
                "group": "occupancy", "name": "Occupancy Estimator",
                "ok": True, "value": f"multiplier {_occ_mult}x, {len(_occ_training)} training observations",
                "detail": f"BLE device multiplier: {_occ_mult}x" +
                          (f" (trained from {len(_occ_training)} observations)" if _occ_training else " (default — train with actual headcounts to improve accuracy)"),
            })
        except Exception:
            pass
    except Exception:
        pass

    # ── Summary ──────────────────────────────────────────────────────────────
    total = len(checks)
    passed = sum(1 for c in checks if c["ok"])
    failed = total - passed

    # ── Maps diagnostic info ───────────────────────────────────────────────
    maps_diag: list[dict[str, Any]] = []
    if ms:
        # Walls live in the fabric, per floor — not on a photograph.
        _mdl_h = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        _bars_by_floor: dict[str, int] = {}
        for _b in (_mdl_h.rf_barriers_m() if _mdl_h else []):
            _fl = str(_b.get("floor_id") or "")
            _bars_by_floor[_fl] = _bars_by_floor.get(_fl, 0) + 1
        for m in ms.list_maps():
            img = m.get("image") or {}
            cal = m.get("calibration") or {}
            stk = m.get("stack") or {}
            maps_diag.append({
                "id": m.get("id", "?"),
                "name": m.get("name", "?"),
                "floor_id": m.get("floor_id", "?"),
                "width": img.get("width", 0),
                "height": img.get("height", 0),
                "px_per_meter": cal.get("px_per_meter"),
                "cal_mode": cal.get("mode", "none"),
                "z_level": stk.get("z_level", 0),
                "has_receivers": len(m.get("receivers") or []),
                "has_room_bounds": len(m.get("room_bounds") or {}),
                "has_rf_barriers": _bars_by_floor.get(str(m.get("floor_id") or ""), 0),
            })

    connection.send_result(msg["id"], {
        "summary": {"total": total, "passed": passed, "failed": failed, "healthy": failed == 0},
        "checks": checks,
        "scanners": scanner_list,
        "scanner_positions_m": position_list if mdl else [],
        "room_geometry_m": geometry_list if mdl else [],
        "fabric_floors": fabric_floors,
        "adjacency": mdl.adjacency() if mdl else {},
        "maps": maps_diag,
    })


@websocket_api.websocket_command({"type": "padspan_ha/fabric_resync"})
@websocket_api.async_response
async def ws_fabric_resync(hass: HomeAssistant, connection, msg) -> None:
    """Wipe all ha_sync scanner entries and rebuild clean from HA + snapshot.

    Fixes stale room/floor assignments. Preserves manual entries.
    Also prunes to actual BLE radios only.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    stats = await mdl.async_resync_clean()
    # Prune to radios only (using presence coordinator's last known radios)
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    pruned = 0
    if pc:
        try:
            from .websocket import _live_snapshot
            snap = await _live_snapshot(hass)
            _radios = (snap.get("ble") or {}).get("radios") or []
            _radio_srcs = {str(r.get("source")) for r in _radios if r.get("source")}
            if _radio_srcs:
                pruned = await mdl.async_prune_non_radio_scanners(_radio_srcs)
        except Exception:
            pass
    # Force snapshot sync to pick up floor_ids
    try:
        snap = await _live_snapshot(hass)
        _radios = (snap.get("ble") or {}).get("radios") or []
        if _radios:
            await mdl.async_sync_from_snapshot(_radios)
    except Exception:
        pass
    final_count = len(mdl.data.get("scanners", {}))
    connection.send_result(msg["id"], {
        "ok": True,
        **stats,
        "pruned": pruned,
        "final_count": final_count,
    })


@websocket_api.websocket_command({"type": "padspan_ha/fabric_reset_spatial"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_reset_spatial(hass: HomeAssistant, connection, msg) -> None:
    """Reset the spatial model (Phase 2+3) and rebuild from maps.

    Clears scanner_positions_m, rf_barriers_m, map_transforms, and beacon
    positions. The room fabric (FabricStore) is deliberately untouched — a
    built floor's room shapes are ground truth and no reset may wipe them.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return

    # Clear spatial data only — user must explicitly migrate after.
    # Spatial ground truth lives in the fabric (pass 2); map_transforms
    # stay model-owned.  The legacy model copies are left untouched — they
    # are the rollback/import source, never live data.
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    if fab:
        await fab.async_spatial_update(
            remove_scanners=list(fab.scanner_positions_m()),
            remove_beacons=list(fab.beacon_positions_m()),
            remove_barrier_names=[str(b.get("name", "")) for b in fab.rf_barriers_m()],
            op="reset_spatial",
        )
    mdl.data["map_transforms"] = {}
    await mdl.store.async_save(mdl.data)

    # Clear metre coords from calibration points (they'll be re-backfilled on migrate)
    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    cal_cleared = 0
    if cal:
        try:
            for p in cal.data.get("points", []):
                if p.get("x_m") is not None:
                    p.pop("x_m", None)
                    p.pop("y_m", None)
                    cal_cleared += 1
            if cal_cleared:
                await cal.store.async_save(cal.data)
        except Exception:
            pass

    connection.send_result(msg["id"], {
        "ok": True, "cleared": True,
        "cal_points_cleared": cal_cleared,
        "next_step": "Click 'Migrate to Metres' with your floor width to rebuild.",
    })
