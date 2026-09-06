# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for floorplan-file import (gap #7, best-in-class
roadmap) — Sweet Home 3D today, RoomPlan JSON and image room-detection are
future tiers that belong in this same module.

These handlers only PARSE a file into a room-layout candidate; nothing is
written to the fabric here. The frontend (maps.js's Rooms tab) plugs the
result into its existing candidate/preview/commit mechanism, the same one
"Map placements"/"Blended" already use.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import base64
import logging

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .sh3d_import import Sh3dParseError, parse_sh3d

_LOGGER = logging.getLogger(__name__)

# .sh3d files are typically a few hundred KB to a few MB (a ZIP of an XML
# description plus optional embedded textures/models); 10 MB is generous
# headroom without inviting an oversized upload to sit in memory as base64
# (which inflates a file to ~4/3 its size) plus a second decoded copy.
MAX_SH3D_BYTES = 10 * 1024 * 1024


@websocket_api.websocket_command({
    "type": "padspan_ha/floorplan_import_sh3d",
    "sh3d_base64": str,
})
@websocket_api.async_response
async def ws_floorplan_import_sh3d(hass: HomeAssistant, connection, msg) -> None:
    """Parse a Sweet Home 3D (.sh3d) file into levels + room polygons."""
    b64 = msg.get("sh3d_base64") or ""
    max_b64_len = (MAX_SH3D_BYTES * 4) // 3 + 4
    if len(b64) > max_b64_len:
        connection.send_error(
            msg["id"], "upload_too_large",
            f"File exceeds the {MAX_SH3D_BYTES // (1024 * 1024)} MB limit",
        )
        return
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        connection.send_error(msg["id"], "bad_base64", "Could not decode the uploaded file")
        return
    try:
        result = await hass.async_add_executor_job(parse_sh3d, raw)
    except Sh3dParseError as exc:
        connection.send_error(msg["id"], "parse_failed", str(exc))
        return
    connection.send_result(msg["id"], result)
