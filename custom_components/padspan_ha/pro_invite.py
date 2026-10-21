# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""A free year of PadSpan Pro, offered to an install the developer invites.

Garry, 2026-10-13: give a year of Pro to about 20 of the installs that send
the opt-in usage report, without scaring anyone off.

How an invite arrives: the developer puts an install's anonymous id on a list
on padspan.traks.ca. The next time that install sends its daily report, the
report's reply carries `{"invite": {"token", "until"}}`. Nothing extra is
sent to get it, and an install that does not send the report never gets one.

What stays here: the token and its end date, under SETTINGS_KEY, backend
only (ws_common._get_settings takes it out; the panel only learns whether an
invite is open and until when). The usage report never reads it.

What leaves, and only on a button: Claim sends the token, the email typed
and this Home Assistant's instance id (the same one a trial or a key
activation sends) to the licence server, which issues a one-year Pro key to
that email. "No thanks" sends the token alone, so the developer's list says
declined and the invite is never sent again. Either way the invite is gone
from here afterwards. The licence server keeps the email with the key, as it
does for a purchase, and the developer is told who claimed (the card says the
email goes to the developer). The invite list keeps only the outcome, never
the email, so the anonymous reports stay unlinked from it.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_SETTINGS, DOMAIN

_LOGGER = logging.getLogger(__name__)

SETTINGS_KEY = "pro_invite"
LICENCE_URL = "https://traks.ca/license/"
_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def _today() -> str:
    return date.today().isoformat()


def parse_reply(reply: Any) -> dict[str, str] | None:
    """The invite in a report reply, or None. Anything not exactly the shape
    the server sends is ignored: a reply is never trusted to write more."""
    inv = reply.get("invite") if isinstance(reply, dict) else None
    if not isinstance(inv, dict):
        return None
    token = str(inv.get("token") or "")
    until = str(inv.get("until") or "")
    if not _TOKEN_RE.match(token) or not _DAY_RE.match(until):
        return None
    return {"token": token, "until": until}


async def store_from_reply(hass: HomeAssistant, reply: Any) -> None:
    """Keep an invite the report's reply carried. A token this install
    already answered is not stored again (the server stops sending it once
    it hears the answer; a decline that could not reach it is retried)."""
    inv = parse_reply(reply)
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not inv or not st:
        return
    cur = st.data.get(SETTINGS_KEY) or {}
    if cur.get("answered") == inv["token"]:
        if cur.get("declined_unsent"):
            await _send_decline(hass, inv["token"])
        return
    if cur.get("token") == inv["token"] and cur.get("until") == inv["until"]:
        return
    await st.async_set(**{SETTINGS_KEY: inv})


def public_state(settings: dict[str, Any] | None) -> dict[str, Any]:
    """What the panel may know: whether an invite is open, and its last day."""
    inv = (settings or {}).get(SETTINGS_KEY) or {}
    token, until = inv.get("token"), str(inv.get("until") or "")
    open_ = bool(token) and bool(until) and until >= _today()
    return {"pro_invite_open": open_, "pro_invite_until": until if open_ else ""}


async def _post(hass: HomeAssistant, action: str, data: dict[str, str]) -> dict[str, Any]:
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
    session = async_get_clientsession(hass)
    async with session.post(LICENCE_URL, params={"action": action, "product": "padspan"},
                            data=data, timeout=15) as resp:
        text = await resp.text()
    return json.loads(text.lstrip("﻿"))  # the licence server prefixes a BOM


async def _send_decline(hass: HomeAssistant, token: str) -> bool:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    try:
        data = await _post(hass, "invite_decline", {"token": token})
        sent = isinstance(data, dict) and bool(data.get("ok"))
    except Exception as err:  # offline: retried when the report's reply carries it again
        _LOGGER.debug("Pro invite decline not sent: %s", err)
        sent = False
    if st:
        await st.async_set(**{SETTINGS_KEY: {"answered": token, "declined_unsent": not sent}})
    return sent


@websocket_api.websocket_command({
    "type": "padspan_ha/pro_invite_claim",
    vol.Required("email"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pro_invite_claim(hass: HomeAssistant, connection, msg) -> None:
    """Claim the open invite: a one-year PadSpan Pro key for this email,
    stored in the same fields a bought key uses (one gate, licence.py)."""
    from .ws_common import _get_settings, _invalidate_snapshot_cache  # noqa: PLC0415
    email = str(msg.get("email") or "").strip()
    if not _EMAIL_RE.match(email):
        connection.send_error(msg["id"], "invalid_email", "A real email address is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return
    if not public_state(st.data)["pro_invite_open"]:
        connection.send_result(msg["id"], {"ok": False, "message": "This invite has ended."})
        return
    # A key someone paid for and that still works would be replaced by a
    # one-year one: refuse, and say how to get the year added instead.
    from .ws_common import _pro_expiry_state  # noqa: PLC0415
    if _pro_expiry_state(hass)["active"] and not st.data.get("license_is_trial"):
        connection.send_result(msg["id"], {"ok": False, "message":
            "This Home Assistant already has a licence key. Email hello@traks.ca and the year can be added to it."})
        return
    token = st.data[SETTINGS_KEY]["token"]
    try:
        try:
            from homeassistant.helpers.instance_id import async_get as _instance_id  # noqa: PLC0415
            machine = await _instance_id(hass)
        except Exception:
            machine = "padspan-ha"
        data = await _post(hass, "invite_claim", {"token": token, "email": email, "machine": machine})
    except Exception as err:
        connection.send_error(msg["id"], "network",
            f"Could not reach the licence server ({err}). Check the internet connection and try again.")
        return
    if not (isinstance(data, dict) and data.get("ok") and data.get("key")):
        why = data.get("message") if isinstance(data, dict) else None
        connection.send_result(msg["id"], {"ok": False,
            "message": str(why or "The invite could not be claimed.")})
        return
    from .licence import normalize_tier  # noqa: PLC0415
    await st.async_set(**{
        "forensics_license_key": str(data.get("key") or ""),
        "forensics_license_expires": str(data.get("expires_at") or ""),
        "license_tier": normalize_tier(data.get("tier"), default="pro"),
        "license_is_trial": False,
        "forensics_enabled": True,
        "license_home_token": "", "license_homes_used": 0, "license_home_status": "",   # a new key: a fresh home on it
        SETTINGS_KEY: {"answered": token},
    })
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"ok": True, "expires_at": data.get("expires_at"),
                                       "days_left": data.get("days_left"), "settings": _get_settings(hass)})


@websocket_api.websocket_command({"type": "padspan_ha/pro_invite_decline"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pro_invite_decline(hass: HomeAssistant, connection, msg) -> None:
    """No thanks: final. Gone from here at once, and the developer's list is
    told so it is never sent again (retried later if the server is away)."""
    from .ws_common import _get_settings  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    token = ((st.data if st else {}).get(SETTINGS_KEY) or {}).get("token")
    if token:
        await _send_decline(hass, token)
    connection.send_result(msg["id"], {"ok": True, "settings": _get_settings(hass)})
