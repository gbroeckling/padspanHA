# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the opt-in usage report (telemetry.py).

    telemetry_preview   the exact report that would be sent (counters kept)
    install_base        the developer's dashboard feed (admin, Pro, dev-listed key)
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
    STATS_URL, TELEMETRY_URL, assert_shareable, build_payload, bump, enabled, ensure_snapshot, send_now,
)

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/telemetry_preview"})
@websocket_api.async_response
async def ws_telemetry_preview(hass: HomeAssistant, connection, msg) -> None:
    """The report as it stands right now — same fields, same values as a send
    made this second would carry — shown before anyone opts in."""
    await ensure_snapshot(hass)          # preview the real numbers, not zeros
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


_INSTALL_BASE_CACHE = "_install_base_cache"
_INSTALL_BASE_TTL_S = 300


@websocket_api.websocket_command({
    "type": "padspan_ha/install_base",
    vol.Optional("fresh"): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_install_base(hass: HomeAssistant, connection, msg) -> None:
    """The install-base dashboard: what every opted-in report adds up to,
    plus the update-check ping count for the installs that did not opt in.

    Three gates, and only the last one is real. Admin (this decorator); Pro
    tier (below — a free install has no key to present); and the server,
    which admits a key only if its hash is on the developer list. A Pro
    customer therefore gets a clean 403, not a view of other people's
    houses. Cached five minutes so an open dashboard costs one fetch.
    """
    from .licence import hass_tier_at_least  # noqa: PLC0415
    if not hass_tier_at_least(hass, "pro"):
        connection.send_error(msg["id"], "tier", "Install-base stats need PadSpan Pro")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    key = str(((st.data if st else {}) or {}).get("forensics_license_key") or "").strip()
    if not key:
        connection.send_error(msg["id"], "no_key", "No licence key to present")
        return
    dom = hass.data.setdefault(DOMAIN, {})
    cached = dom.get(_INSTALL_BASE_CACHE)
    import time as _time  # noqa: PLC0415
    if cached and not msg.get("fresh") and _time.monotonic() - cached[0] < _INSTALL_BASE_TTL_S:
        connection.send_result(msg["id"], {"cached": True, "stats": cached[1]})
        return
    try:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
        session = async_get_clientsession(hass)
        url = STATS_URL + ("?fresh=1" if msg.get("fresh") else "")
        async with session.get(url, headers={"X-PadSpan-Key": key}, timeout=20) as resp:
            if resp.status == 403:
                connection.send_error(msg["id"], "forbidden", "This key is not on the developer list")
                return
            if resp.status != 200:
                connection.send_error(msg["id"], "http", f"Stats server answered {resp.status}")
                return
            stats = await resp.json(content_type=None)
    except Exception as err:
        connection.send_error(msg["id"], "network", f"Could not reach the stats server ({err})")
        return
    if not isinstance(stats, dict) or not stats.get("ok"):
        connection.send_error(msg["id"], "bad", "Stats server returned something unexpected")
        return
    dom[_INSTALL_BASE_CACHE] = (_time.monotonic(), stats)
    connection.send_result(msg["id"], {"cached": False, "stats": stats})


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
