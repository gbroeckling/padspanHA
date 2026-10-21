# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket commands for sub-zones (subzones.py).

- subzones_list: any user, and it works while the feature is off. It reads;
  it never writes (an install with no sub-zones still has no file).
- subzone_add / subzone_update / subzone_remove / subzone_from_piece: admin
  only, refused while settings.subzones_enabled is off. A sub-zone's
  geometry is metres on its floor, the same shapes a room has (a polygon or
  a circle). Its room, when not given, is the fabric room its centre is in.
  Removing one also removes its two entities from HA's registry.
- subzone_from_piece: a sub-zone over a Live Aboard furniture piece's
  footprint (the bed, the couch), read from house3d_store; the piece itself
  is never written.
"""

from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_FABRIC, DOMAIN
from .subzones import ZoneError, async_get_store, centre_of, enabled, get_monitor, piece_footprint, room_at

OFF_CODE = "subzones_off"
OFF_MESSAGE = "Sub-zones are off. Turn them on in Manage → HA Entities → Entity Publishing Controls."
ENTITY_SUFFIXES = (("binary_sensor", "occupied"), ("sensor", "who"))


def unique_id(zid: str, suffix: str) -> str:
    return f"padspan_ha__subzone__{zid}__{suffix}"


def _with_room(hass: HomeAssistant, zone: dict) -> dict:
    if str(zone.get("room") or "").strip():
        return zone
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    try:
        from .subzones import normalise_zone  # noqa: PLC0415
        x, y = centre_of(normalise_zone("_", zone))
    except (ZoneError, KeyError, TypeError, ValueError, ZeroDivisionError):
        return zone            # the add itself says what is wrong
    return {**zone, "room": room_at(fab.rooms_flat() if fab else {}, str(zone.get("floor_id") or ""), x, y)}


def _payload(hass: HomeAssistant, store) -> dict:
    coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    members = get_monitor(hass).current(hass, coord) if coord is not None else {}
    return {"enabled": enabled(hass),
            "zones": [{**z, "people": members.get(zid, [])} for zid, z in store.zones().items()]}


@websocket_api.websocket_command({"type": "padspan_ha/subzones_list"})
@websocket_api.async_response
async def ws_subzones_list(hass: HomeAssistant, connection, msg) -> None:
    store = await async_get_store(hass)
    connection.send_result(msg["id"], _payload(hass, store))


async def _write(hass: HomeAssistant, connection, msg, zid: str | None, zone: dict) -> None:
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    store = await async_get_store(hass)
    try:
        z = await store.async_put(zid, _with_room(hass, zone))
    except ZoneError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], {"zone": z, **_payload(hass, store)})


@websocket_api.websocket_command({"type": "padspan_ha/subzone_add", vol.Required("zone"): dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_subzone_add(hass: HomeAssistant, connection, msg) -> None:
    await _write(hass, connection, msg, None, msg["zone"])


@websocket_api.websocket_command({"type": "padspan_ha/subzone_update", vol.Required("zone_id"): str,
                                  vol.Required("zone"): dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_subzone_update(hass: HomeAssistant, connection, msg) -> None:
    """The whole sub-zone, changed fields merged over what is stored."""
    store = await async_get_store(hass)
    old = store.zones().get(msg["zone_id"])
    if old is None:
        connection.send_error(msg["id"], "not_found", "no such sub-zone")
        return
    new = {**old, **msg["zone"]}
    if "points_m" in msg["zone"] or "r_m" in msg["zone"] or "type" in msg["zone"]:
        # A new shape replaces the old one whole (a circle has no points).
        new = {k: v for k, v in {**old, "room": ""}.items()
               if k not in ("type", "points_m", "cx_m", "cy_m", "r_m")}
        new.update(msg["zone"])
    await _write(hass, connection, msg, msg["zone_id"], new)


@websocket_api.websocket_command({"type": "padspan_ha/subzone_remove", vol.Required("zone_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_subzone_remove(hass: HomeAssistant, connection, msg) -> None:
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    store = await async_get_store(hass)
    zid = msg["zone_id"]
    if not await store.async_remove(zid):
        connection.send_error(msg["id"], "not_found", "no such sub-zone")
        return
    from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
    reg = er.async_get(hass)
    for platform, suffix in ENTITY_SUFFIXES:
        eid = reg.async_get_entity_id(platform, DOMAIN, unique_id(zid, suffix))
        if eid:
            reg.async_remove(eid)
    connection.send_result(msg["id"], {"removed": zid, **_payload(hass, store)})


@websocket_api.websocket_command({"type": "padspan_ha/subzone_from_piece", vol.Required("piece_id"): str,
                                  vol.Optional("name"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_subzone_from_piece(hass: HomeAssistant, connection, msg) -> None:
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    from .house3d_store import ReadFailed, async_file_exists  # noqa: PLC0415
    from .house3d_store import async_get_store as _house3d  # noqa: PLC0415
    piece = None
    if await async_file_exists(hass):
        try:
            piece = ((await _house3d(hass)).data.get("pieces") or {}).get(msg["piece_id"])
        except ReadFailed:
            piece = None
    if not isinstance(piece, dict):
        connection.send_error(msg["id"], "not_found", "no such furniture piece")
        return
    name = msg.get("name") or piece.get("label") or str((piece.get("recipe") or {}).get("kind") or "Sub-zone")
    await _write(hass, connection, msg, None, {
        "name": name, "floor_id": piece.get("floor_id"), "type": "poly",
        "points_m": piece_footprint(piece), "piece_id": msg["piece_id"]})


WS_COMMANDS = (ws_subzones_list, ws_subzone_add, ws_subzone_update, ws_subzone_remove, ws_subzone_from_piece)
