# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""PadSpan's own requests to its servers: the update check and the licence server.

Each one names PadSpan in its User-Agent instead of Home Assistant's default,
which names aiohttp: a web host or firewall that throttles generic clients can
then tell PadSpan apart (another integration's host answered every request
carrying aiohttp's default with 429, and nobody could activate for days). A 429
is asked once more, after the Retry-After the server gives (at most
RETRY_AFTER_MAX_S); a second 429 is the caller's to handle.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

from homeassistant.core import HomeAssistant

from .const import VERSION

USER_AGENT = f"PadSpan-HA/{VERSION} (Home Assistant; +https://padspan.traks.ca)"
RETRY_AFTER_MAX_S = 60.0
RETRY_AFTER_DEFAULT_S = 5.0
_sleep = asyncio.sleep   # the tests' to replace


def retry_after_s(value: Any) -> float:
    """Seconds to wait from a Retry-After header (seconds, or an HTTP date),
    between 1 and RETRY_AFTER_MAX_S; RETRY_AFTER_DEFAULT_S when it says nothing usable."""
    text = str(value or "").strip()
    if not text:
        return RETRY_AFTER_DEFAULT_S
    try:
        secs = float(text)
    except ValueError:
        try:
            secs = (parsedate_to_datetime(text) - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError):
            return RETRY_AFTER_DEFAULT_S
    return min(max(secs, 1.0), RETRY_AFTER_MAX_S)


async def request(hass: HomeAssistant, method: str, url: str, *, params: dict | None = None,
                  data: dict | None = None, timeout: int = 15) -> tuple[int, str]:
    """One GET or POST (form body) with PadSpan's User-Agent: (status, text).
    Network errors raise, as the session's own calls do."""
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
    session = async_get_clientsession(hass)
    headers = {"User-Agent": USER_AGENT}

    async def _once() -> tuple[int, Any, str]:
        if method == "POST":
            req = session.post(url, params=params, data=data, headers=headers, timeout=timeout)
        else:
            req = session.get(url, params=params, headers=headers, timeout=timeout)
        async with req as resp:
            return resp.status, resp.headers.get("Retry-After"), await resp.text()

    status, after, text = await _once()
    if status == 429:
        await _sleep(retry_after_s(after))
        status, _after, text = await _once()
    return status, text
