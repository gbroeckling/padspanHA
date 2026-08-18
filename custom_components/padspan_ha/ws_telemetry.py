# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the opt-in usage report (telemetry.py).

    telemetry_preview   the exact report that would be sent (counters kept)
    telemetry_event     count one allow-listed event (the panel's tab opens)
    telemetry_send_now  send one report now (admin) — the "Send a test report" button
    telemetry_reset_id  mint a new anonymous install id (admin)

Registration stays in websocket.py.
"""

from __future__ import annotations

import logging
import uuid

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_SETTINGS, DOMAIN
from .telemetry import (
    TELEMETRY_URL, assert_shareable, build_payload, bump, enabled, send_now,
)

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/telemetry_preview"})
@websocket_api.async_response
async def ws_telemetry_preview(hass: HomeAssistant, connection, msg) -> None:
    """The report as it stands right now — same fields, same values as a send
    made this second would carry — shown before anyone opts in."""
    payload = build_payload(hass, consume=False)
    if not payload.get("install_id"):
        payload["install_id"] = "(minted when you opt in)"
    problem = ""
    try:
        check = dict(payload)
        if check["install_id"].startswith("("):
            check["install_id"] = ""
        assert_shareable(check)
    except ValueError as err:
        problem = str(err)
    connection.send_result(msg["id"], {"payload": payload, "url": TELEMETRY_URL,
                                       "enabled": enabled(hass), "problem": problem})


@websocket_api.websocket_command({
    "type": "padspan_ha/telemetry_event",
    vol.Required("event"): str,
})
@websocket_api.async_response
async def ws_telemetry_event(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"counted": bump(hass, str(msg.get("event") or ""))})


@websocket_api.websocket_command({"type": "padspan_ha/telemetry_send_now"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_telemetry_send_now(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], await send_now(hass, force=True))


@websocket_api.websocket_command({"type": "padspan_ha/telemetry_reset_id"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_telemetry_reset_id(hass: HomeAssistant, connection, msg) -> None:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return
    new = str(uuid.uuid4())
    await st.async_set(telemetry_install_id=new)
    connection.send_result(msg["id"], {"install_id": new})
