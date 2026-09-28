# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for "Become a tester" (tester.py).

    tester_status    what this Home Assistant holds, and the setup lines — sends nothing
    tester_preview   the exact JSON a send would carry — sends nothing
    tester_signup    send a sign-up or an update — the person's own button
    tester_withdraw  ask the server to delete it; cleared here once it has

All four are admin-only: they read or send contact details a person typed,
and choosing to sign a whole Home Assistant up is an administrator's call —
as is the usage report's switch. Registration stays in websocket.py.
"""

from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import tester

# What the form sends. Lengths and shapes are checked in tester.clean_form,
# where the refusal can say what is wrong in words.
_FORM = {
    vol.Optional("email", default=""): str,
    vol.Optional("github", default=""): str,
    vol.Optional("name", default=""): str,
    vol.Optional("interests", default=[]): [str],
    vol.Optional("interests_other", default=""): str,
    vol.Optional("setup_keys", default=[]): [str],
    vol.Optional("notes", default=""): str,
    vol.Optional("timezone", default=""): str,
    vol.Optional("consent", default=False): bool,
    vol.Optional("link_reports", default=False): bool,
}
_FORM_KEYS = tuple(str(getattr(k, "schema", k)) for k in _FORM)


def _form(msg: dict) -> dict:
    return {k: msg.get(k) for k in _FORM_KEYS}


@websocket_api.websocket_command({"type": "padspan_ha/tester_status"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_tester_status(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], await tester.status(hass))


@websocket_api.websocket_command({"type": "padspan_ha/tester_preview", **_FORM})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_tester_preview(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], await tester.preview(hass, _form(msg)))


@websocket_api.websocket_command({"type": "padspan_ha/tester_signup", **_FORM})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_tester_signup(hass: HomeAssistant, connection, msg) -> None:
    try:
        action = await tester.sign_up(hass, _form(msg))
    except tester.TesterError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], {"ok": True, "action": action, "status": await tester.status(hass)})


@websocket_api.websocket_command({"type": "padspan_ha/tester_withdraw"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_tester_withdraw(hass: HomeAssistant, connection, msg) -> None:
    try:
        await tester.withdraw(hass)
    except tester.TesterError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], {"ok": True, "status": await tester.status(hass)})
