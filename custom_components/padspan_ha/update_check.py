"""Daily update check against padspan.traks.ca.

Once a day (and once shortly after startup) PadSpan fetches the latest
version manifest from https://padspan.traks.ca/api/version.php, sending only
the installed version as a query parameter.  The server sees the request IP
and version, nothing else — this is disclosed in the README ("Update check")
and can be turned off with the ``update_check_enabled`` setting.

When a newer stable release exists, a persistent notification is created
(once per new version).
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN, DATA_SETTINGS, VERSION

_LOGGER = logging.getLogger(__name__)

UPDATE_CHECK_URL = "https://padspan.traks.ca/api/version.php"
_INTERVAL = timedelta(hours=24)
_FIRST_DELAY_S = 300  # don't compete with startup
_DATA_UNSUBS = "_update_check_unsubs"
_DATA_MANIFEST = "update_manifest"
_DATA_NOTIFIED = "_update_notified_version"


def _parse_version(v: Any) -> tuple[int, ...] | None:
    """'0.21.10' → (0, 21, 10); None when unparseable."""
    try:
        parts = str(v).strip().lstrip("v").split(".")
        return tuple(int(p) for p in parts)
    except (ValueError, AttributeError):
        return None


def _enabled(hass: HomeAssistant) -> bool:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool((st.data if st else {}).get("update_check_enabled", True))


async def _check(hass: HomeAssistant) -> None:
    if not _enabled(hass):
        return
    try:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415

        session = async_get_clientsession(hass)
        async with session.get(
            UPDATE_CHECK_URL, params={"v": VERSION}, timeout=15
        ) as resp:
            if resp.status != 200:
                _LOGGER.debug("Update check HTTP %s", resp.status)
                return
            manifest = await resp.json(content_type=None)
    except Exception as err:  # network errors are expected and non-fatal
        _LOGGER.debug("Update check failed: %s", err)
        return

    if not isinstance(manifest, dict):
        return
    hass.data.setdefault(DOMAIN, {})[_DATA_MANIFEST] = manifest

    latest = _parse_version(manifest.get("latest_stable"))
    current = _parse_version(VERSION)
    if not latest or not current or latest <= current:
        return

    latest_str = str(manifest.get("latest_stable"))
    if hass.data[DOMAIN].get(_DATA_NOTIFIED) == latest_str:
        return
    hass.data[DOMAIN][_DATA_NOTIFIED] = latest_str
    try:
        from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415

        notes = manifest.get("notes_url") or "https://github.com/gbroeckling/padspanHA/releases"
        async_create(
            hass,
            f"PadSpan HA {latest_str} is available (you run {VERSION}). "
            f"Update via HACS. [Release notes]({notes})",
            title="PadSpan HA update available",
            notification_id="padspan_ha_update_available",
        )
    except Exception:
        pass


async def _revalidate_license(hass: HomeAssistant) -> None:
    """Refresh the PadSpan Pro expiry from the licence server, once a day.

    Activation validates the key exactly once; without this, a refund,
    chargeback or revocation never takes effect, and a renewal never extends
    the stored expiry. Only ever WRITES a new expiry date — it never clears
    the key. A server that is unreachable, slow, or returns anything
    unexpected leaves the stored state exactly as it was, so an offline house
    keeps working: expiry is enforced locally against the last known date,
    with the grace window in websocket._pro_expiry_state absorbing the gap.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        return
    key = str(st.data.get("forensics_license_key") or "").strip()
    if not key:
        return
    try:
        import json as _json  # noqa: PLC0415
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
        try:
            from homeassistant.helpers.instance_id import async_get as _instance_id  # noqa: PLC0415
            machine = await _instance_id(hass)
        except Exception:
            machine = "padspan-ha"
        session = async_get_clientsession(hass)
        async with session.get(
            "https://traks.ca/license/",
            params={"action": "validate", "product": "padspan", "key": key, "machine": machine},
            timeout=15,
        ) as resp:
            data = _json.loads((await resp.text()).lstrip("﻿"))
    except Exception as err:
        _LOGGER.debug("PadSpan Pro revalidation skipped (%s)", err)
        return
    expires = str(data.get("expires_at") or "").strip()
    if data.get("valid") and expires and expires != str(st.data.get("forensics_license_expires") or ""):
        await st.async_set(forensics_license_expires=expires)
        _LOGGER.info("PadSpan Pro licence revalidated — expires %s", expires)
    elif data.get("valid") is False:
        # Explicitly revoked. Record it as expired-now rather than deleting
        # the key: the grace window still applies, the user keeps their data,
        # and re-activating a reinstated licence restores everything.
        _LOGGER.warning("PadSpan Pro licence reported invalid by the licence server")
        if not str(st.data.get("forensics_license_expires") or ""):
            from homeassistant.util import dt as _dt_util  # noqa: PLC0415
            await st.async_set(forensics_license_expires=_dt_util.utcnow().isoformat())


def async_setup_update_check(hass: HomeAssistant) -> None:
    """Schedule the startup + daily checks (idempotent across reloads)."""
    from homeassistant.helpers.event import async_call_later, async_track_time_interval  # noqa: PLC0415

    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_DATA_UNSUBS):
        return  # already scheduled

    async def _run(_now: Any = None) -> None:
        await _check(hass)
        await _revalidate_license(hass)

    dom[_DATA_UNSUBS] = [
        async_call_later(hass, _FIRST_DELAY_S, _run),
        async_track_time_interval(hass, _run, _INTERVAL),
    ]


def async_stop_update_check(hass: HomeAssistant) -> None:
    for unsub in hass.data.get(DOMAIN, {}).pop(_DATA_UNSUBS, []) or []:
        try:
            unsub()
        except Exception:
            pass
