# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the PadSpan Bright → PadSpan HA import.

The rules live in bright_import.py; this is the wire. Registration stays in
websocket.py.
"""

from __future__ import annotations

import logging

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .bright_import import async_import, async_status
from .ws_backup import _auto_backup

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/bright_import_status"})
@websocket_api.async_response
async def ws_bright_import_status(hass: HomeAssistant, connection, msg) -> None:
    """Is there a Bright house on this HA, was it imported, would we refuse it."""
    connection.send_result(msg["id"], await async_status(hass))


@websocket_api.websocket_command({"type": "padspan_ha/bright_import"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_bright_import(hass: HomeAssistant, connection, msg) -> None:
    """Back up, refuse a non-empty target, copy the house, reload."""
    res = await async_import(hass, _auto_backup)
    if res.get("ok"):
        connection.send_result(msg["id"], res)
    else:
        connection.send_error(msg["id"], res.get("error", "import_failed"), res.get("message", "Import failed"))
