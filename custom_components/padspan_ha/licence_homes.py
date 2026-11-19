# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""A licence key's homes (0.38.160): one key, up to five Home Assistants.

The first two always count. A key on more than two needs every home's
opt-in usage report on (0.38.163): if one turns it off, the homes past the
first two stop using Pro 14 days later unless it's back on. The report then
carries the licence's group code
(telemetry.licence_group, made from the key, never the key), which is how the
developer sees one licence's homes together.

The licence server counts homes; this side only says which home it is. Each
check sends this Home Assistant's instance id (the server keeps only a hash
of it) and the home's current token, in a POST body, and keeps the next token
the server answers with. A restored backup carries an
old token: the server takes it back when the home it came from has gone quiet,
and asks it to take a home of its own when that home is still checking in (a
copy running in a second house). Nothing here can lock anyone out: a server
that is down, or an answer without a token, leaves the stored token as it was.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_SETTINGS, DOMAIN, VERSION

LICENCE_URL = "https://traks.ca/license/"


async def machine_id(hass: HomeAssistant) -> str:
    """This Home Assistant's instance id. Where it can't be read, a random id
    made once for this install and kept in PadSpan's settings
    (license_install_id): every such install used to send the same
    "padspan-ha", which made all of them one home on the licence server."""
    try:
        from homeassistant.helpers.instance_id import async_get as _instance_id  # noqa: PLC0415
        iid = await _instance_id(hass)
        if iid:
            return str(iid)
    except Exception:
        pass
    st = hass.data[DOMAIN][DATA_SETTINGS]
    mid = str(st.data.get("license_install_id") or "")
    if not mid:
        mid = uuid.uuid4().hex
        await st.async_set(license_install_id=mid)
    return mid


def home_params(settings: dict[str, Any] | None) -> dict[str, str]:
    """What a validate call adds for the homes: the token, the version, the
    name, and whether this home's usage report is on."""
    d = settings or {}
    return {"t": "1", "token": str(d.get("license_home_token") or ""), "version": VERSION,
            "label": str(d.get("license_home_label") or "")[:60],
            "report": "1" if d.get("telemetry_enabled") else "0"}


async def keep_token(st: Any, data: dict[str, Any]) -> None:
    """Store the token a validate answered with (only a real, new one), and
    how many homes the key is on (the report says which licence it is only
    once that is more than two: telemetry.build_payload)."""
    if not isinstance(data, dict):
        return
    tok = data.get("token")
    if isinstance(tok, str) and len(tok) == 32 and tok != str(st.data.get("license_home_token") or ""):
        await st.async_set(license_home_token=tok)
    used = data.get("homes_used")
    if isinstance(used, int) and not isinstance(used, bool) and 0 <= used <= 99 and used != st.data.get("license_homes_used"):
        await st.async_set(license_homes_used=used)


def homes_warning(data: dict[str, Any] | None) -> dict[str, Any]:
    """The server's warning for a key on more than two homes with a usage
    report off somewhere (0.38.163): {"warning", "grace_until", "off_labels"},
    or {} when it gave none. The labels are the owner's own home names."""
    if not isinstance(data, dict) or data.get("homes_warning") != "reports_off":
        return {}
    labels = data.get("homes_off_labels")
    # 40 characters of name, plus " (update PadSpan)" for a home on PadSpan before 0.38.160.
    labels = [str(x)[:60] for x in labels if isinstance(x, str)][:5] if isinstance(labels, list) else []
    return {"warning": "reports_off", "grace_until": str(data.get("homes_grace_until") or "")[:25], "off_labels": labels}


async def keep_warning(st: Any, data: dict[str, Any] | None) -> None:
    """Store homes_warning(data) when it differs (an answer without one clears it)."""
    w = homes_warning(data)
    if w != (st.data.get("license_homes_warning") or {}):
        await st.async_set(license_homes_warning=w)


async def call(hass: HomeAssistant, action: str, key: str, extra: dict[str, str] | None = None) -> dict[str, Any]:
    """One licence-server call for `action` (validate, homes, home_remove, home_label).

    The key and this home's id go in a POST body, so neither is in a URL a web
    server or proxy logs (the licence server reads the body as well as the
    address, as it always has). One request; an error answer or none raises."""
    return await _post(hass, action, {"key": key, "machine": await machine_id(hass), **(extra or {})})


async def trial_start(hass: HomeAssistant, email: str) -> dict[str, Any]:
    """Ask for the one-time trial key for this install, the same way as call()."""
    return await _post(hass, "trial_start", {"email": email, "machine": await machine_id(hass)})


async def _post(hass: HomeAssistant, action: str, body: dict[str, str]) -> dict[str, Any]:
    from .server_http import request  # noqa: PLC0415
    status, text = await request(hass, "POST", LICENCE_URL, params={"action": action, "product": "padspan"}, data=body)
    if status >= 400:
        raise RuntimeError(f"the licence server answered {status}")
    return json.loads(text.lstrip("﻿"))   # the licence server prefixes a BOM
