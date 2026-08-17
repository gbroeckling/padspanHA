# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for follow/alert configuration and room-tag housekeeping.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry, entity_registry
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MODEL,
    DATA_ALERTS,
    DATA_DEVICE_REGISTRY,
)
from .snapshot_builder import _live_snapshot
from .ws_common import _get_settings, _invalidate_snapshot_cache

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/room_tags"})
@websocket_api.async_response
async def ws_room_tags(hass: HomeAssistant, connection, msg) -> None:
    """
    Return the room→object map used by the UI.

    Important behavior:
      - Always prefer the saved/coordinator room_tag_map when it exists (this is the user's curated model).
      - In live mode, also return the best-effort *derived* map from HA Areas/entities for debugging,
        but do not let it collapse the UI to a single room if Areas aren't set up.
    """
    settings = _get_settings(hass)

    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    saved_map = coord.room_tag_map if coord else {}

    if settings.get("data_mode") == "live":
        snap = await _live_snapshot(hass)
        live_map = snap.get("room_tag_map", {}) or {}
        # If the user has a saved map, keep UI stable by using it.
        effective = saved_map if saved_map else live_map
        connection.send_result(
            msg["id"],
            {
                "room_tag_map": effective,
                "room_tag_map_saved": saved_map,
                "room_tag_map_live": live_map,
                "live": True,
                "sources": snap.get("sources", {}) or {},
                "raw_counts": snap.get("raw_counts", {}) or {},
            },
        )
        return

    connection.send_result(msg["id"], {"room_tag_map": saved_map, "live": False})


@websocket_api.websocket_command({"type": "padspan_ha/follow_alert_get"})
@websocket_api.async_response
async def ws_follow_alert_get(hass: HomeAssistant, connection, msg) -> None:
    """Return all saved follow-alert configurations (persisted in AlertStore)."""
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    configs = alert_store.all() if alert_store else {}
    connection.send_result(msg["id"], {"configs": configs})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/follow_alert_save",
        vol.Optional("addr"): str,
        vol.Optional("config"): dict,
    }
)
@websocket_api.async_response
async def ws_follow_alert_save(hass: HomeAssistant, connection, msg) -> None:
    """Save follow/alert configuration for a tracked object.

    Persists to AlertStore so configs survive HA restarts.
    """
    addr = str(msg.get("addr") or "").strip()
    config = msg.get("config") or {}
    if len(str(config)) > 50000:
        connection.send_error(msg["id"], "config_too_large", "Alert config exceeds size limit")
        return
    # Persist to AlertStore (disk-backed) — resolve padspan_id for stable identity
    from .const import DATA_ALERTS, DATA_DEVICE_REGISTRY
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    _pid = None
    try:
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            _pid = _dev_reg.resolve(addr)
    except Exception:
        pass
    if alert_store:
        await alert_store.async_save_config(addr, config, padspan_id=_pid)
    else:
        # Fallback: session-only (shouldn't happen if stores loaded)
        hass.data.setdefault(DOMAIN, {}).setdefault("follow_alerts", {})[addr] = config
    _LOGGER.debug("PadSpan HA follow_alert_save: addr=%s keys=%s", addr, list(config.keys()) if isinstance(config, dict) else "?")
    connection.send_result(msg["id"], {"ok": True, "addr": addr})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/follow_alert_delete",
        vol.Required("addr"): str,
    }
)
@websocket_api.async_response
async def ws_follow_alert_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a follow-alert configuration for a tracked object."""
    addr = str(msg.get("addr") or "").strip()
    if not addr:
        connection.send_error(msg["id"], "missing_addr", "addr is required")
        return
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    deleted = False
    if alert_store:
        deleted = await alert_store.async_delete_config(addr)
    else:
        alerts = hass.data.get(DOMAIN, {}).get("follow_alerts", {})
        if addr in alerts:
            del alerts[addr]
            deleted = True
    _LOGGER.debug("PadSpan HA follow_alert_delete: addr=%s deleted=%s", addr, deleted)
    connection.send_result(msg["id"], {"ok": True, "addr": addr, "deleted": deleted})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/area_delete",
        "area_id": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_area_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete an HA area and clean up PadSpan room_meta."""
    area_id = (msg.get("area_id") or "").strip()
    if not area_id:
        connection.send_error(msg["id"], "invalid_area_id", "area_id required")
        return
    ar = area_registry.async_get(hass)
    area = ar.async_get_area(area_id)
    if not area:
        connection.send_error(msg["id"], "not_found", "Area not found")
        return
    area_name = area.name
    ar.async_delete(area_id)
    # Clean up PadSpan room_meta for this area name
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if mdl:
        try:
            room_meta = mdl.room_meta() or {}
            if area_name in room_meta:
                updated_meta = {k: v for k, v in room_meta.items() if k != area_name}
                await mdl.async_update(room_meta=updated_meta)
        except Exception:
            pass
    connection.send_result(msg["id"], {"deleted": area_id, "name": area_name})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/entity_delete",
        "entity_id": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_entity_delete(hass: HomeAssistant, connection, msg) -> None:
    """Remove an entity from the HA entity registry."""
    entity_id = (msg.get("entity_id") or "").strip()
    if not entity_id:
        connection.send_error(msg["id"], "invalid_entity_id", "entity_id required")
        return
    er = entity_registry.async_get(hass)
    entry = er.async_get(entity_id)
    if not entry:
        connection.send_error(msg["id"], "not_found", f"Entity '{entity_id}' not found in registry")
        return
    er.async_remove(entity_id)
    connection.send_result(msg["id"], {"deleted": entity_id})


@websocket_api.websocket_command({"type": "padspan_ha/room_tag_purge_missing"})
@websocket_api.async_response
async def ws_room_tag_purge_missing(hass: HomeAssistant, connection, msg) -> None:
    """Remove entity_ids from room_tag_map that have no current HA state (phantom/sample entities)."""
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    if not coord:
        connection.send_result(msg["id"], {"removed": 0, "rooms": 0})
        return
    removed = 0
    new_map: dict = {}
    for room, ids in (coord.room_tag_map or {}).items():
        valid = [eid for eid in (ids or []) if hass.states.get(str(eid)) is not None]
        removed += len(ids or []) - len(valid)
        if valid:
            new_map[room] = valid
    coord.room_tag_map = new_map
    # Persist the purge so phantom entries don't reappear on restart.  The
    # set_room_tag_map service saves room_tag_map to SettingsStore and
    # async_setup_entry restores it; without saving here the restored map would
    # re-add the very entries we just removed.  Only write when something changed.
    if removed:
        try:
            _settings = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _settings:
                await _settings.async_set(room_tag_map=new_map)
        except Exception as err:
            _LOGGER.exception("Failed to persist purged room_tag_map: %s", err)
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"removed": removed, "rooms": len(new_map)})
