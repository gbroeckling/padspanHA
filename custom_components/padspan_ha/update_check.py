"""Daily update check against padspan.traks.ca.

About once a day PadSpan fetches the latest version manifest from
https://padspan.traks.ca/api/version.php, sending only the installed version
as a query parameter.  The server sees the request IP and version, nothing
else — this is disclosed in the README ("Update check") and can be turned off
with the ``update_check_enabled`` setting.

When a newer stable release exists, a persistent notification is created
(once per new version).

When it runs (with the licence recheck, which follows it): the first time a
random while after Home Assistant starts (_FIRST_DELAY_S), because many homes
restart at the same moment after a Home Assistant release and their checks
should not all arrive together; then once a day (_INTERVAL). A check within
the last _MIN_AGE_S makes it wait, so a restart does not ask again
(server_checked_at, kept in PadSpan's settings).
"""

from __future__ import annotations

import logging
import random
import time
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN, DATA_SETTINGS, PRO_PASS_FROM_TS, VERSION
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

# The end of December 15, 2026: from then a new tester gets one year of Pro,
# not two (const.PRO_PASS_FROM_TS).
_PASS_FROM_TS = PRO_PASS_FROM_TS

UPDATE_CHECK_URL = "https://padspan.traks.ca/api/version.php"
_FIRST_DELAY_S = (300, 6 * 3600)  # the first check after a start: at random, 5 minutes to 6 hours in
_MIN_AGE_S = 20 * 3600            # a check this recent makes the next one wait
_INTERVAL = timedelta(hours=24)   # after the first, once a day
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
            _quiet_error("update_check:keep_offers")
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
        _quiet_error("update_check:tester_line_edition")
        full = False
    if not full or not offer_on(data, "tester") or str(data.get("forensics_license_key") or "").strip():
        return ""
    try:
        from .tester import SETTINGS_KEY as _TESTER_KEY, signed_up  # noqa: PLC0415
        if signed_up(data.get(_TESTER_KEY) or {}):
            return ""          # signed up already: the key is on its way
    except Exception:
        _quiet_error("update_check:tester_line_signed_up")
        pass
    # Two years for a tester until the end of December 15, 2026, one year from
    # then (the licence server's TESTER_YEARS_AFTER; editions.js testerTerm).
    term = "one year" if time.time() >= _PASS_FROM_TS else "two years"
    return (f"\n\nTesters get PadSpan Pro free for {term}. "
            "Sign up under Help improve PadSpan in PadSpan's Settings.")


# How to update, by the store that keeps this copy up to date. It said
# "Update via HACS" on Marketplace installs too. The store is the usage
# report's env.store (report_context.install_store), read from Home Assistant
# itself, so it needs no network; when it can't be read, words that fit both.
_UPDATE_HOW = {
    "marketplace": "Update via the Marketplace.",
    "hacs": "Update via HACS.",
    "manual": "This copy was installed by hand: update it with padspan_ha.zip from the release.",
}
_UPDATE_HOW_EITHER = "Update via the Marketplace or HACS."


def _update_how(hass: HomeAssistant) -> str:
    from .report_context import install_store  # noqa: PLC0415
    return _UPDATE_HOW.get(install_store(hass), _UPDATE_HOW_EITHER)


async def _check(hass: HomeAssistant) -> None:
    if not _enabled(hass):
        return
    try:
        import json as _json  # noqa: PLC0415
        from .server_http import request  # noqa: PLC0415

        status, text = await request(hass, "GET", UPDATE_CHECK_URL, params={"v": VERSION})
        if status != 200:
            _LOGGER.debug("Update check HTTP %s", status)
            return
        manifest = _json.loads(text.lstrip("\ufeff"))
    except Exception as err:  # network errors are expected and non-fatal
        _quiet_error("update_check:check_fetch")
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
            f"{_update_how(hass)} [Release notes]({notes})" + _tester_line(hass),
            title="PadSpan HA update available",
            notification_id="padspan_ha_update_available",
        )
    except Exception:
        _quiet_error("update_check:check_notify")
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
        from .licence_homes import call, home_params  # noqa: PLC0415
        data = await call(hass, "validate", key, home_params(st.data))
    except Exception as err:
        _quiet_error("update_check:revalidate_license")
        _LOGGER.debug("PadSpan Pro revalidation skipped (%s)", err)
        return
    expires = str(data.get("expires_at") or "").strip()
    if data.get("valid"):
        from .licence import normalize_addons, normalize_tier  # noqa: PLC0415
        from .licence_homes import keep_token, keep_warning  # noqa: PLC0415
        await keep_token(st, data)
        await keep_warning(st, data)
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
            # The add-ons come with the tier: an answer that names the tier
            # names them too, none when it names none (the backup's bare
            # "valid" names neither and changes neither).
            addons = normalize_addons(data.get("addons"))
            if addons != normalize_addons(st.data.get("license_addons")):
                updates["license_addons"] = addons
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
        _hs = _hs if _hs in ("activation_limit", "activation_rate", "homes_frozen", "needs_report", "removed", "needs_all_reports") else ""
        if _hs != str(st.data.get("license_home_status") or ""):
            await st.async_set(license_home_status=_hs)
        # A home past the first two, after the 14 days the server gave once a
        # report on the key went off: Pro ends now (below), and Settings names
        # the homes whose report is off.
        if _hs == "needs_all_reports":
            from .licence_homes import keep_warning  # noqa: PLC0415
            await keep_warning(st, data)
        # Not a refusal of the licence: a pause on new homes this month, or a
        # third-to-fifth home whose report is off. Settings says which; the
        # licence stays as it is.
        if _hs in ("activation_rate", "needs_report"):
            # A renewal still moves the date on (never back).
            new_exp = _parse_utc(expires)
            old_exp = _parse_utc(str(st.data.get("forensics_license_expires") or ""))
            if new_exp is not None and (old_exp is None or new_exp > old_exp):
                await st.async_set(forensics_license_expires=expires)
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
        # A home past the first two refused for a report off elsewhere already
        # had its 14 days from the server: it ends now, not after a second
        # grace (dated just past PRO_GRACE_DAYS ago; the next valid answer
        # writes the real date back).
        if _hs == "needs_all_reports":
            from datetime import timedelta as _td  # noqa: PLC0415
            from .ws_common import PRO_GRACE_DAYS  # noqa: PLC0415
            now = now - _td(days=PRO_GRACE_DAYS, minutes=1)
        if exp is None or exp > now:
            await st.async_set(forensics_license_expires=now.isoformat())


def _parse_utc(value: str):
    """A stored or server expiry as an aware UTC datetime, or None."""
    from datetime import datetime as _dt, timezone as _tz  # noqa: PLC0415
    value = value.strip()
    if not value:
        return None
    try:
        dt = _dt.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=_tz.utc)


async def _run_if_due(hass: HomeAssistant, now=time.time) -> bool:
    """The update check and the licence recheck, unless they ran in the last
    _MIN_AGE_S. A time stamped in the future (a clock put back, a restored
    backup) does not hold them off. True when they ran."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    try:
        last = float((st.data if st else {}).get("server_checked_at") or 0)
    except (TypeError, ValueError):
        last = 0.0
    if 0 <= now() - last < _MIN_AGE_S:
        return False
    if st:
        await st.async_set(server_checked_at=now())
    await _check(hass)
    await _revalidate_license(hass)
    return True


def async_setup_update_check(hass: HomeAssistant) -> None:
    """Schedule the checks (idempotent across reloads): the first at random
    within _FIRST_DELAY_S, then once a day."""
    from homeassistant.helpers.event import async_call_later, async_track_time_interval  # noqa: PLC0415

    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_DATA_UNSUBS):
        return  # already scheduled
    unsubs: list = []

    async def _tick(_now: Any = None) -> None:
        await _run_if_due(hass)

    async def _first(_now: Any = None) -> None:
        # The daily timer first, so a first check that raises can't lose it.
        if dom.get(_DATA_UNSUBS) is unsubs:  # not stopped meanwhile
            unsubs.append(async_track_time_interval(hass, _tick, _INTERVAL))
        await _run_if_due(hass)

    unsubs.append(async_call_later(hass, random.uniform(*_FIRST_DELAY_S), _first))
    dom[_DATA_UNSUBS] = unsubs


def async_stop_update_check(hass: HomeAssistant) -> None:
    for unsub in hass.data.get(DOMAIN, {}).pop(_DATA_UNSUBS, []) or []:
        try:
            unsub()
        except Exception:
            _quiet_error("update_check:stop_update_check")
            pass
