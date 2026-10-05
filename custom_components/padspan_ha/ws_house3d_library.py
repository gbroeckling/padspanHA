# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket commands for Live Aboard's shared furniture library (house3d_library.py).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md, "The shared furniture library". Every
command is refused while Live Aboard is off and below Pro (as if off), the
way ws_house3d.py refuses; and each one that would reach the library is
refused, before anything is sent, while the "Shared library" switch is off
(settings.atlas_3d_library, off by default): off means no network.

- house3d_library_search, house3d_library_get, house3d_library_report: anyone
  who can see Live Aboard. Browsing needs no terms. A search or a look that
  the library answers also sends the shares that were waiting for it.
- house3d_library_share, house3d_terms_accept: the light-placement gate (any
  user, at Pro), as making furniture is. A share needs the terms accepted
  at the current version; accepting them needs no network.
- house3d_library_withdraw: admin only.
The results never carry an owner token (house3d_library.status).
"""

from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import house3d_library as L
from .const import DATA_SETTINGS, DOMAIN
from .house3d_store import ReadFailed, async_get_store, enabled
from .ws_common import _tier_at_least
from .ws_house3d import OFF_CODE, OFF_MESSAGE, PRO_MESSAGE, READ_CODE, READ_MESSAGE

LIBRARY_OFF_CODE = "library_off"
LIBRARY_OFF_MESSAGE = ("The shared library is off. An administrator can turn it on in Settings → UI Structure "
                       "→ Atlas → Live Aboard → Shared library.")


def library_on(hass: HomeAssistant) -> bool:
    """settings.atlas_3d_library (default off)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool(((st.data if st else {}) or {}).get("atlas_3d_library", False))


def _open(hass: HomeAssistant, connection, msg, *, network: bool) -> bool:
    """Live Aboard on and at Pro, and for anything that reaches the library,
    its switch on. Sends the refusal and returns False otherwise."""
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return False
    if not _tier_at_least(hass, "pro"):
        connection.send_error(msg["id"], OFF_CODE, PRO_MESSAGE)
        return False
    if network and not library_on(hass):
        connection.send_error(msg["id"], LIBRARY_OFF_CODE, LIBRARY_OFF_MESSAGE)
        return False
    return True


async def _store(hass: HomeAssistant, connection, msg):
    try:
        return await async_get_store(hass)
    except ReadFailed:
        connection.send_error(msg["id"], READ_CODE, READ_MESSAGE)
        return None


async def _send_waiting(hass: HomeAssistant) -> None:
    """The library answered: the shares that waited for it go now."""
    try:
        await L.flush_pending(hass, await async_get_store(hass))
    except (ReadFailed, L.LibraryError):
        pass


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_library_search",
    vol.Optional("text"): str,
    vol.Optional("filters"): dict,
    vol.Optional("sort"): str,
    vol.Optional("offset"): int,
    vol.Optional("limit"): int,
})
@websocket_api.async_response
async def ws_house3d_library_search(hass: HomeAssistant, connection, msg) -> None:
    if not _open(hass, connection, msg, network=True):
        return
    try:
        found = await L.search(hass, msg)
    except L.LibraryError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    connection.send_result(msg["id"], found)
    await _send_waiting(hass)


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_library_get",
    vol.Required("library_id"): str,
    vol.Optional("placed"): bool,
})
@websocket_api.async_response
async def ws_house3d_library_get(hass: HomeAssistant, connection, msg) -> None:
    """One piece; with placed, the library counts the placing (anonymous +1)."""
    if not _open(hass, connection, msg, network=True):
        return
    try:
        entry = await L.get(hass, msg["library_id"], msg.get("placed", False))
    except L.LibraryError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    connection.send_result(msg["id"], {"entry": entry})
    await _send_waiting(hass)


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_library_report",
    vol.Required("library_id"): str,
    vol.Required("reason"): str,
})
@websocket_api.async_response
async def ws_house3d_library_report(hass: HomeAssistant, connection, msg) -> None:
    if not _open(hass, connection, msg, network=True):
        return
    store = await _store(hass, connection, msg)
    if store is None:
        return
    try:
        await L.report(hass, store, msg["library_id"], msg["reason"])
    except L.LibraryError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    connection.send_result(msg["id"], {"reported": True})


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_library_share",
    vol.Required("recipe"): dict,
    vol.Optional("submission_id"): vol.Any(str, None),
})
@websocket_api.async_response
async def ws_house3d_library_share(hass: HomeAssistant, connection, msg) -> None:
    """Share a piece's recipe and details sheet (nothing else of the piece),
    or send new details for one this house shared. It goes now, or waits for
    the library: {submission_id, status: shared | updated | queued, library_id}."""
    if not _open(hass, connection, msg, network=True):
        return
    store = await _store(hass, connection, msg)
    if store is None:
        return
    try:
        out = await L.share(hass, store, msg["recipe"], msg.get("submission_id"))
    except L.LibraryError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    connection.send_result(msg["id"], {**out, "library": L.status(store.data)})


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_library_withdraw",
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_house3d_library_withdraw(hass: HomeAssistant, connection, msg) -> None:
    """Take every piece this house shared out of the library: {withdrawn, left}."""
    if not _open(hass, connection, msg, network=True):
        return
    store = await _store(hass, connection, msg)
    if store is None:
        return
    try:
        out = await L.withdraw_all(hass, store)
    except L.LibraryError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    connection.send_result(msg["id"], {**out, "library": L.status(store.data)})


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_terms_accept",
    vol.Required("version"): int,
})
@websocket_api.async_response
async def ws_house3d_terms_accept(hass: HomeAssistant, connection, msg) -> None:
    """Accept the library's terms (the version the screen showed). Stored in
    the 3D file with the date; a later terms version asks again."""
    if not _open(hass, connection, msg, network=False):
        return
    store = await _store(hass, connection, msg)
    if store is None:
        return
    try:
        out = await L.accept_terms(store, msg["version"])
    except L.LibraryError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    connection.send_result(msg["id"], {"library": out})


WS_COMMANDS = (ws_house3d_library_search, ws_house3d_library_get, ws_house3d_library_report,
               ws_house3d_library_share, ws_house3d_library_withdraw, ws_house3d_terms_accept)
