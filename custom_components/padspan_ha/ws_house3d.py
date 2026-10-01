# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket commands for Live Aboard's file (house3d_store.py).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md on the live-aboard branch. This is the
first build step, the switch and the empty store: house3d_get and
house3d_clear. Later phases add the piece, light, opening, photo, terms and
library commands, each refused while the feature is off.

- house3d_get: any user, and it works while the feature is off (backups
  label the file from it). It reads; it never writes.
- house3d_clear: admin only, refused while the feature is off, and takes an
  automatic backup of the file first. No backup, no clear. A file that was
  never written has nothing to clear: no backup, no write.
"""

from __future__ import annotations

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import HOUSE3D_STORE_KEY
from .house3d_store import async_get_store, enabled

OFF_CODE = "house3d_off"
OFF_MESSAGE = "The 3D house is off. Turn it on in Settings → UI Structure → Atlas → 3D house."


@websocket_api.websocket_command({"type": "padspan_ha/house3d_get"})
@websocket_api.async_response
async def ws_house3d_get(hass: HomeAssistant, connection, msg) -> None:
    store = await async_get_store(hass)
    connection.send_result(msg["id"], {"enabled": enabled(hass), "data": store.data,
                                       "counts": store.counts()})


@websocket_api.websocket_command({"type": "padspan_ha/house3d_clear"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_house3d_clear(hass: HomeAssistant, connection, msg) -> None:
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    from .house3d_store import async_file_exists  # noqa: PLC0415
    if not await async_file_exists(hass):
        # Never written: nothing to remove. No backup (an empty one would push
        # a real safety backup out of the three kept) and no new file.
        store = await async_get_store(hass)
        store.data = {}
        connection.send_result(msg["id"], {"cleared": True, "backup_id": None})
        return
    from .ws_backup import _auto_backup  # noqa: PLC0415
    backup_id = await _auto_backup(hass, "Before removing everything in the 3D house", [HOUSE3D_STORE_KEY])
    if not backup_id:
        connection.send_error(msg["id"], "backup_failed",
                              "Could not take the safety backup — nothing was removed.")
        return
    store = await async_get_store(hass)
    ok = await store.async_clear()
    connection.send_result(msg["id"], {"cleared": ok, "backup_id": backup_id})


WS_COMMANDS = (ws_house3d_get, ws_house3d_clear)
