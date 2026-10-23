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


# The free-Pro offers' switches, from the same answer: {"tester": bool,
# "invite": bool}, set on padspan.traks.ca (server/version.php reads
# private/padspan-offers.json). Kept in settings so the last answer stands
# through a restart or an offline day; before any answer, every offer is on.
# Only these names, only booleans: the answer can switch an offer off or on,
# never add anything. ws_common._get_settings hands the panel offer_tester /
# offer_invite.
_OFFER_NAMES = ("tester", "invite")


async def _keep_offers(hass: HomeAssistant, manifest: dict) -> None:
    offers = manifest.get("offers")
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not isinstance(offers, dict) or not st:
        return
    vals = {k: offers[k] for k in _OFFER_NAMES if isinstance(offers.get(k), bool)}
    if vals and (st.data.get("server_offers") or {}) != vals:
        try:
            await st.async_set(server_offers=vals)
        except Exception as err:  # never at the cost of the update notice
            _LOGGER.debug("Offer switches not kept: %s", err)


def offer_on(settings: dict | None, name: str) -> bool:
    """An offer is on unless the server's last answer switched it off."""
    return ((settings or {}).get("server_offers") or {}).get(name, True) is not False


def _tester_line(hass: HomeAssistant) -> str:
    """One line about the tester offer under the update notice: only while
    the offer is on, in the full edition, with no licence key here."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    data = (st.data if st else {}) or {}
    try:
        from .licence import edition  # noqa: PLC0415
        full = edition() == "full"
    except Exception:
        full = False
    if not full or not offer_on(data, "tester") or str(data.get("forensics_license_key") or "").strip():
        return ""
    try:
        from .tester import SETTINGS_KEY as _TESTER_KEY, signed_up  # noqa: PLC0415
        if signed_up(data.get(_TESTER_KEY) or {}):
            return ""          # signed up already: the key is on its way
    except Exception:
        pass
    return ("\n\nTesters get PadSpan Pro free for two years. "
            "Sign up under Help improve PadSpan in PadSpan's Settings.")


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
    await _keep_offers(hass, manifest)

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
            f"Update via HACS. [Release notes]({notes})" + _tester_line(hass),
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
        from .licence_homes import home_params, machine_id  # noqa: PLC0415
        machine = await machine_id(hass)
        session = async_get_clientsession(hass)
        async with session.get(
            "https://traks.ca/license/",
            params={"action": "validate", "product": "padspan", "key": key, "machine": machine,
                    **home_params(st.data)},
            timeout=15,
        ) as resp:
            data = _json.loads((await resp.text()).lstrip("\ufeff"))
    except Exception as err:
        _LOGGER.debug("PadSpan Pro revalidation skipped (%s)", err)
        return
    expires = str(data.get("expires_at") or "").strip()
    if data.get("valid"):
        from .licence import normalize_tier  # noqa: PLC0415
        from .licence_homes import keep_token  # noqa: PLC0415
        await keep_token(st, data)
        if st.data.get("license_home_status"):
            await st.async_set(license_home_status="")
        updates: dict = {}
        if expires and expires != str(st.data.get("forensics_license_expires") or ""):
            updates["forensics_license_expires"] = expires
        # A tier the server names is recorded; a server that does not name
        # one changes nothing (an absent field is a Pro key — licence.py).
        if data.get("tier"):
            tier = normalize_tier(data.get("tier"), default="pro")
            if tier != str(st.data.get("license_tier") or ""):
                updates["license_tier"] = tier
        # A trial key upgraded in place (bought, or the lifetime offer) stops
        # reading as a trial the day the server says so.
        if data.get("plan"):
            is_trial = str(data.get("plan")) == "trial"
            if is_trial != bool(st.data.get("license_is_trial")):
                updates["license_is_trial"] = is_trial
        if updates:
            await st.async_set(**updates)
            _LOGGER.info("PadSpan licence revalidated — %s", ", ".join(f"{k}={v}" for k, v in updates.items()))
    elif data.get("valid") is False:
        # Over the key's homes (a copy of a home, or a sixth): said in Settings
        # (licence_homes.py), and then the same grace as any refusal.
        _hs = str(data.get("status") or "")
        _hs = _hs if _hs in ("activation_limit", "activation_rate", "homes_frozen", "needs_report", "removed") else ""
        if _hs != str(st.data.get("license_home_status") or ""):
            await st.async_set(license_home_status=_hs)
        # Not a refusal of the licence: a pause on new homes this month, or a
        # third-to-fifth home whose report is off. Settings says which; the
        # licence stays as it is.
        if _hs in ("activation_rate", "needs_report"):
            return
        # Explicitly revoked. Record it as expired-now rather than deleting
        # the key: the grace window still applies, the user keeps their data,
        # and re-activating a reinstated licence restores everything.
        _LOGGER.warning("PadSpan Pro licence reported invalid by the licence server")
        # Expired now unless it already has: a key with a date still ahead
        # (an annual one, or a lifetime one stored as 2099) kept working
        # after a refund until that date. One already past stays as it is,
        # so repeated answers never stretch the grace period.
        from datetime import datetime as _dt, timezone as _tz  # noqa: PLC0415
        now = _dt.now(_tz.utc)
        stored = str(st.data.get("forensics_license_expires") or "").strip()
        try:
            exp = _dt.fromisoformat(stored.replace("Z", "+00:00")) if stored else None
            if exp is not None and exp.tzinfo is None:
                exp = exp.replace(tzinfo=_tz.utc)
        except ValueError:
            exp = None
        if exp is None or exp > now:
            await st.async_set(forensics_license_expires=now.isoformat())


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
