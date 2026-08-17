# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the device registry.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MODEL,
    DATA_FABRIC,
    DATA_OBJECTS,
    DEFAULT_FLOOR_ID,
    DATA_DEVICE_REGISTRY,
)
from .ws_common import _point_in_polygon

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/device_registry_list"})
@websocket_api.async_response
async def ws_device_registry_list(hass: HomeAssistant, connection, msg) -> None:
    """Return all devices in the Device Registry."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    devices = dev_reg.all_devices()
    connection.send_result(msg["id"], {
        "devices": devices,
        "count": len(devices),
        "labeled": len(dev_reg.all_labeled()),
    })


@websocket_api.websocket_command({"type": "padspan_ha/device_registry_migrate"})
@websocket_api.async_response
async def ws_device_registry_migrate(hass: HomeAssistant, connection, msg) -> None:
    """Trigger migration from ObjectStore to DeviceRegistry."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    stats = await dev_reg.async_migrate_from_object_store(obj_store)
    connection.send_result(msg["id"], {
        "ok": True,
        "migrated": stats["migrated"],
        "merged": stats["merged"],
        "skipped": stats["skipped"],
        "total_devices": dev_reg.device_count(),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_merge",
    "keep_id": str,
    "absorb_id": str,
})
@websocket_api.async_response
async def ws_device_registry_merge(hass: HomeAssistant, connection, msg) -> None:
    """Merge two devices in the Device Registry. absorb_id is removed."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    keep_id = str(msg["keep_id"]).strip()
    absorb_id = str(msg["absorb_id"]).strip()
    if not keep_id or not absorb_id:
        connection.send_error(msg["id"], "invalid_ids", "Both keep_id and absorb_id are required")
        return
    ok = await dev_reg.async_merge(keep_id, absorb_id)
    if not ok:
        connection.send_error(msg["id"], "merge_failed", "One or both devices not found")
        return
    connection.send_result(msg["id"], {
        "ok": True,
        "kept": keep_id,
        "absorbed": absorb_id,
        "device": dev_reg.get(keep_id),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_label_set",
    "padspan_id": str,
    "label": str,
})
@websocket_api.async_response
async def ws_device_registry_label_set(hass: HomeAssistant, connection, msg) -> None:
    """Set label on a device by padspan_id."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    pid = str(msg["padspan_id"]).strip()
    label = str(msg["label"]).strip()[:48]
    await dev_reg.async_set_label(pid, label)
    # Also sync to ObjectStore for backwards compat
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if obj_store:
        dev = dev_reg.get(pid)
        if dev:
            for ident in (dev.get("identities") or []):
                val = ident.get("value", "")
                if val:
                    await obj_store.async_set(val, label)
    connection.send_result(msg["id"], {
        "ok": True,
        "padspan_id": pid,
        "label": label,
        "device": dev_reg.get(pid),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_add_identity",
    "padspan_id": str,
    "kind": str,
    "value": str,
})
@websocket_api.async_response
async def ws_device_registry_add_identity(hass: HomeAssistant, connection, msg) -> None:
    """Link an additional volatile key to an existing device."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    pid = str(msg["padspan_id"]).strip()
    kind = str(msg["kind"]).strip()
    value = str(msg["value"]).strip()
    await dev_reg.async_add_identity(pid, kind, value)
    connection.send_result(msg["id"], {
        "ok": True,
        "padspan_id": pid,
        "device": dev_reg.get(pid),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_delete",
    "padspan_id": str,
})
@websocket_api.async_response
async def ws_device_registry_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a device from the Device Registry."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    pid = str(msg["padspan_id"]).strip()
    if not dev_reg.get(pid):
        connection.send_error(msg["id"], "not_found", f"Device {pid} not found")
        return
    await dev_reg.async_delete(pid)
    connection.send_result(msg["id"], {"ok": True, "padspan_id": pid})


@websocket_api.websocket_command({"type": "padspan_ha/espresense_companion_import"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_espresense_companion_import(hass: HomeAssistant, connection, msg) -> None:
    """Import floors, rooms, and scanner positions from ESPresense Companion.

    Reads from the Companion REST API (GET /api/state/config), parses the
    response, and writes floors/room_meta/scanner positions to the ModelStore.
    Room shapes go through FabricStore.async_correct_room (external_import,
    merge-only) — an import can add rooms but never overwrite existing fabric.
    """
    import aiohttp

    _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not _st:
        connection.send_error(msg["id"], "no_settings", "Settings not loaded")
        return

    url = (_st.data.get("espresense_companion_url") or "").strip().rstrip("/")
    if not url:
        connection.send_error(msg["id"], "no_url",
                              "ESPresense Companion URL not configured. Set it in Manage → ESPresense MQTT.")
        return

    # ── Fetch config from Companion REST API ─────────────────────────────
    api_url = f"{url}/api/state/config"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200:
                    connection.send_error(msg["id"], "http_error",
                                          f"Companion returned HTTP {resp.status} from {api_url}")
                    return
                data = await resp.json()
    except aiohttp.ClientError as e:
        connection.send_error(msg["id"], "connect_failed",
                              f"Cannot reach ESPresense Companion at {api_url}: {e}")
        return
    except Exception as e:
        connection.send_error(msg["id"], "fetch_error", f"Failed to fetch config: {e}")
        return

    if not isinstance(data, dict):
        connection.send_error(msg["id"], "bad_data", "Unexpected response format from Companion")
        return

    # ── Parse and import ─────────────────────────────────────────────────
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return

    stats = {"floors": 0, "rooms": 0, "scanners": 0, "skipped": 0}

    # ── Floors ───────────────────────────────────────────────────────────
    floors_raw = data.get("floors") or []
    if not isinstance(floors_raw, list):
        floors_raw = []

    existing_floors = {f.get("id"): f for f in (mdl.data.get("floors") or [])}

    for fl in floors_raw:
        if not isinstance(fl, dict):
            continue
        fl_name = str(fl.get("name") or fl.get("id") or "").strip()
        fl_id = str(fl.get("id") or fl_name).strip().lower().replace(" ", "_")
        if not fl_id:
            stats["skipped"] += 1
            continue

        # Add floor if not already present
        if fl_id not in existing_floors:
            floors_list = mdl.data.setdefault("floors", [])
            # Derive z_level from bounds if available
            bounds = fl.get("bounds") or []
            z_level = 0
            if isinstance(bounds, list) and len(bounds) >= 2:
                try:
                    z_level = int(round(float(bounds[0][2]) if len(bounds[0]) > 2 else 0))
                except Exception:
                    pass
            floors_list.append({"id": fl_id, "name": fl_name, "level": z_level})
            existing_floors[fl_id] = floors_list[-1]
            stats["floors"] += 1

        # ── Rooms (nested under floor) ───────────────────────────────────
        rooms_raw = fl.get("rooms") or []
        if not isinstance(rooms_raw, list):
            continue

        room_meta = mdl.data.setdefault("room_meta", {})
        _fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)

        for rm in rooms_raw:
            if not isinstance(rm, dict):
                continue
            rm_name = str(rm.get("name") or "").strip()
            if not rm_name:
                stats["skipped"] += 1
                continue

            # Room meta
            if rm_name not in room_meta:
                room_meta[rm_name] = {"floor_id": fl_id}
                color = rm.get("color")
                if color:
                    room_meta[rm_name]["color"] = str(color)

            # Room geometry: routed through the FabricStore's correction
            # choke point, merge-only — an import can add a new room but
            # never overwrite existing (possibly hand-corrected) fabric.
            points = rm.get("points") or []
            if _fab and isinstance(points, list) and len(points) >= 3:
                try:
                    pts_m = [[round(float(p[0]), 3), round(float(p[1]), 3)]
                             for p in points if isinstance(p, (list, tuple)) and len(p) >= 2]
                    if len(pts_m) >= 3:
                        res = await _fab.async_correct_room(
                            fl_id, rm_name,
                            {"type": "poly", "points_m": pts_m},
                            committed_by="external_import",
                        )
                        if res.get("ok"):
                            stats["rooms"] += 1
                        else:
                            stats["skipped"] += 1
                except Exception:
                    stats["skipped"] += 1

    # ── Nodes (scanner positions) ────────────────────────────────────────
    nodes_raw = data.get("nodes") or []
    if not isinstance(nodes_raw, list):
        nodes_raw = []

    positions: dict[str, dict] = {}
    scanners = mdl.data.setdefault("scanners", {})

    for nd in nodes_raw:
        if not isinstance(nd, dict):
            continue
        nd_name = str(nd.get("name") or nd.get("id") or "").strip()
        nd_id = str(nd.get("id") or nd_name).strip().lower().replace(" ", "_")
        if not nd_name or not nd_id:
            stats["skipped"] += 1
            continue

        # Enabled check
        if nd.get("enabled") is False:
            stats["skipped"] += 1
            continue

        # Position [x, y, z] in metres
        point = nd.get("point") or []
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            stats["skipped"] += 1
            continue

        try:
            x_m = round(float(point[0]), 3)
            y_m = round(float(point[1]), 3)
            z_m = round(float(point[2]), 3) if len(point) > 2 else 2.4
        except (ValueError, TypeError):
            stats["skipped"] += 1
            continue

        # Determine floor from node's floor assignment or z coordinate
        nd_floors = nd.get("floors") or []
        fl_id = nd_floors[0] if isinstance(nd_floors, list) and nd_floors else DEFAULT_FLOOR_ID

        # Determine room from node position (check which room polygon contains the point)
        room = ""
        for rm_name, geo in mdl.room_geometry_m().items():
            if geo.get("floor_id") != fl_id or geo.get("type") != "poly":
                continue
            pts = geo.get("points_m") or []
            if _point_in_polygon(x_m, y_m, pts):
                room = rm_name
                break

        # Use ESPresense source naming (matches MQTT topic espresense/rooms/{id})
        source = f"espresense_{nd_id}"

        positions[source] = {
            "x_m": x_m,
            "y_m": y_m,
            "z_m": z_m,
            "floor_id": fl_id,
        }

        # Also add to scanners dict for auto-sync
        if source not in scanners or scanners[source].get("source_type") != "manual":
            scanners[source] = {
                "room": room or nd_name,
                "floor_id": fl_id,
                "source_type": "espresense_import",
            }

        stats["scanners"] += 1

    # ── Save ─────────────────────────────────────────────────────────────
    await mdl.store.async_save(mdl.data)
    _fab_imp = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    if _fab_imp and positions:
        await _fab_imp.async_spatial_update(
            set_scanners=positions, op="espresense_import")

    _LOGGER.info(
        "ESPresense Companion import: %d floors, %d rooms, %d scanners (%d skipped) from %s",
        stats["floors"], stats["rooms"], stats["scanners"], stats["skipped"], url,
    )

    connection.send_result(msg["id"], {
        "ok": True,
        **stats,
        "source": url,
    })
