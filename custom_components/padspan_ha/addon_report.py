# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""The usage report's Add-ons section: the top-level `addons` (telemetry.py build_payload).

Opt-in and previewable like the rest of the report, and like the rest of it words from the lists below, counts and
yes/no only: never a key, an email, an entity id, a name or an address (assert_shareable walks it; check() holds every
key and word to these lists). What it says, for the owner's add-ons (licence.ADDONS, 2026-11-25):

    licence   the licence this install runs on, as one word (LICENCE_WORDS)
    held      with an add-on key (running, lapsed, or kept aside while a Pro trial runs): each add-on it carries and how
              long it has left, as a band (DAYS_WORDS)
    kept      a Pro trial was started over an add-on key, which comes back when the trial ends
    was       the licence word of the last report sent, only when it changed since (an add-on key that became Pro)
    moved     the features that moved from free into an add-on which this house had in use, noted once, the first time
              this code ran here (MOVED_WORDS), so what the move cost and who came back can be told
    used      the add-ons whose feature was used since the last report, among the ones this install may use (USED_WORDS)
    market    what the house has that an add-on is for: counts of alarm panels, garage and gate openers, emergency
              lights, whole-house audio players by system, temperature / humidity / CO2 sensors, WLED devices, power
              teams and colour bulbs, robot vacuums; Control4's controller OS (2 or 3), its config entry's state and
              whether the local-token override is installed; UniFi (Utopia or UniFi Network); the recorder's days of
              history; the plan sources used. Zeros and noes are left out.

The funnel (offers seen, the site opened, keys entered, add-ons gained, the sale card) is in `usage`, through
telemetry.bump and its lists (ADDON_EVENTS there).
"""

from __future__ import annotations

import sys
import time
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from .const import DATA_SETTINGS, DOMAIN
from .quiet_errors import note as _quiet_error
from .licence import ADDONS, addon_allowed, addon_on_sale, is_addon_key, key_tier, normalize_addons, normalize_addons_until

LICENCE_WORDS: tuple[str, ...] = ("free", "trial", "pro_year", "pro_pass", "pro_life", "pro_tester", "bright", "addon",
                                  "lapsed_trial", "lapsed_pro", "lapsed_bright", "lapsed_addon")
DAYS_WORDS: tuple[str, ...] = ("gt365", "91_365", "30_90", "lt30", "grace", "ended", "unknown")
MOVED_WORDS: tuple[str, ...] = ("emergency_test", "power_teams", "circadian", "lidar", "robot_vacuum")
# The add-ons, and Advanced smart lighting (circadian and power teams), which is everyone's until it is sold.
USED_WORDS: tuple[str, ...] = tuple(dict.fromkeys(ADDONS + ("lighting",)))   # once, now that lighting is an add-on too
# Whole-house audio by the integration that runs the player (an integration's name starts with one of these:
# russound_rio, denonavr, yamaha_musiccast, anthemav, nuvo_serial, triad_ams ...).
AUDIO_SYSTEMS: tuple[str, ...] = ("control4", "crestron", "savant", "russound", "nuvo", "monoprice", "xantech", "triad",
                                  "denon", "yamaha", "anthem")
C4_OS_WORDS: tuple[str, ...] = ("2", "3", "other", "unknown")
C4_ENTRY_WORDS: tuple[str, ...] = ("loaded", "setup_error", "setup_retry", "not_loaded", "other")
WIFI_WORDS: tuple[str, ...] = ("utopia", "unifi")
HISTORY_WORDS: tuple[str, ...] = ("none", "lt7d", "7_13d", "14_30d", "gt30d")
PLAN_WORDS: tuple[str, ...] = ("picture", "sketch", "blank", "scan")      # telemetry.PLAN_SOURCES
MARKET_COUNTS: tuple[str, ...] = ("alarm", "garage", "gate", "emergency", "temp", "humidity", "co2", "wled", "teams",
                                  "colour_bulbs", "vacuum")
CAP = 99                      # a count says "99 or more" past this
# The Black Friday sale (views/editions.js ADDON_HALF_FROM / ADDON_HALF_UNTIL; a test holds them equal).
SALE_FROM = "2026-11-27T08:00:00Z"
SALE_UNTIL = "2027-01-02T08:00:00Z"
SALE_WHEN: tuple[str, ...] = ("before", "sale_w1", "sale_w2", "sale_w3", "sale_w4", "sale_w5", "sale_w6", "after")
SEEN_KEY = "addon_report_seen"


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def sale_when(now: float) -> str:
    """Where `now` falls against the sale: before it, its week (1-6), or after it."""
    start, end = _ts(SALE_FROM), _ts(SALE_UNTIL)
    if now < start:
        return "before"
    if now >= end:
        return "after"
    return f"sale_w{min(6, int((now - start) // (7 * 86400)) + 1)}"


def _days_left(end: Any, now: float) -> int | None:
    try:
        when = datetime.fromisoformat(str(end).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    when = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
    return int((when.timestamp() - now) // 86400)


def days_word(days: int | None) -> str:
    """A key's or an add-on's time left as a band; past its end, within a key's grace or beyond it."""
    from .ws_common import PRO_GRACE_DAYS  # noqa: PLC0415
    if days is None:
        return "unknown"
    if days < -PRO_GRACE_DAYS:
        return "ended"
    if days < 0:
        return "grace"
    return "lt30" if days < 30 else "30_90" if days <= 90 else "91_365" if days <= 365 else "gt365"


def licence_word(settings: dict[str, Any], active: bool, days_left: int | None) -> str:
    """The licence as one word. A Pro key by what it has left: for life (ten years or more, the way the licence card
    reads it), a pass (more than a year and a bit: two years), else a year; a free licence the report holds on (a
    tester's or a free year's, settings_store.report_locked_until) is pro_tester. A key the server never dated
    reads as a year."""
    if not str(settings.get("forensics_license_key") or "").strip():
        return "free"
    trial = bool(settings.get("license_is_trial"))
    addon = is_addon_key(settings)
    tier = key_tier(settings)
    if not active:
        return "lapsed_trial" if trial else "lapsed_addon" if addon else "lapsed_bright" if tier == "bright" else "lapsed_pro"
    if trial:
        return "trial"
    if addon:
        return "addon"
    if tier == "bright":
        return "bright"
    if tier != "pro":
        return "free"
    from .settings_store import report_locked_until  # noqa: PLC0415
    if report_locked_until(settings):
        return "pro_tester"
    if isinstance(days_left, int) and days_left >= 3650:
        return "pro_life"
    if isinstance(days_left, int) and days_left > 400:
        return "pro_pass"
    return "pro_year"


def held(settings: dict[str, Any], now: float) -> dict[str, str]:
    """{add-on: DAYS_WORDS} for an add-on key; the one kept aside while a trial runs over it. {} otherwise."""
    src = settings
    kept = settings.get("license_addons_kept")
    if settings.get("license_is_trial") and isinstance(kept, dict) and str(kept.get("forensics_license_key") or "").strip():
        src = kept
    if not is_addon_key(src):
        return {}
    until = normalize_addons_until(src.get("license_addons_until"))
    names = set(normalize_addons(src.get("license_addons"))) | set(until)
    key_end = src.get("forensics_license_expires")
    return {a: days_word(_days_left(until.get(a) or key_end, now)) for a in ADDONS if a in names}


def _count(usage: dict[str, Any], *names: str) -> bool:
    return any(isinstance(usage.get(n), int) and usage.get(n) > 0 for n in names)


def used_words(settings: dict[str, Any], usage: dict[str, Any], key_active: bool) -> list[str]:
    """The add-ons whose feature was used since the last report, among the ones this install may use (Pro: all; an
    add-on key: its own; Bright: the alarm's controls; a feature that is still everyone's: anyone)."""
    got = {w for w in USED_WORDS if _count(usage, f"addon_used:{w}")}
    if _count(usage, *(f"room_controls:{w}" for w in ("up", "down", "mute", "off", "match_saved"))):
        got.add("audio")
    if _count(usage, "alarm_button:arm", "alarm_button:disarm", "emergency_test_on", "emergency_force_off"):
        got.add("alarm")
    if _count(usage, "tab:wifi"):
        got.add("wifi")
    if settings.get("atlas_heatmap_enabled") is True:
        got.add("climate")
    if settings.get("vacation_mode_enabled") is True or _count(usage, "vacation_on", "vacation_resumed"):
        got.add("vacation")
    if settings.get("day_theme") is True or settings.get("theme_palette") in ("graphite", "ocean", "dusk") \
            or settings.get("lights_showcase") is True:
        got.add("looks")
    if settings.get("forensics_enabled") is True or _count(usage, "forensics_query"):
        got.add("forensics")
    if _count(usage, "plan_ai_session:started", "rough_plan:scan"):
        got.add("maps")
    if _count(usage, "vacuum_imported", "robot_run:started"):
        got.add("vacuum")
    if any(isinstance(t, dict) and t.get("adaptive") is True for t in settings.get("power_teams") or []):
        got.add("lighting")
    bright = key_active and key_tier(settings) == "bright"

    def may(w: str) -> bool:
        if w not in ADDONS or not addon_on_sale(w):
            return True                                  # still everyone's
        return addon_allowed(settings, key_active, w) or (w == "alarm" and bright)
    return [w for w in USED_WORDS if w in got and may(w)]


def moved_now(hass: Any, settings: dict[str, Any]) -> list[str]:
    """The features that moved from free into an add-on which this house has in use now: emergency lights the test
    finds, a power team, one following the day, a LiDAR scan (a scan plan, or the RoomPlan import switched on), the
    robot vacuum's features (Import from a robot vacuum switched on)."""
    out: set[str] = set()
    try:
        from .emergency_test import resolve_members  # noqa: PLC0415
        if resolve_members(hass).get("members"):
            out.add("emergency_test")
    except Exception:
        _quiet_error("addon_report:moved_emergency")
    teams = [t for t in settings.get("power_teams") or [] if isinstance(t, dict)]
    if teams:
        out.add("power_teams")
    if any(t.get("adaptive") is True for t in teams):
        out.add("circadian")
    from .const import DATA_MAPS  # noqa: PLC0415
    maps = (getattr(hass.data.get(DOMAIN, {}).get(DATA_MAPS), "data", None) or {}).get("maps")
    if settings.get("roomplan_import_enabled") is True or any(
            isinstance(m, dict) and m.get("kind") == "scan" for m in (maps if isinstance(maps, list) else [])):
        out.add("lidar")
    if settings.get("vacuum_import_enabled") is True:
        out.add("robot_vacuum")
    return [w for w in MOVED_WORDS if w in out]


async def async_note_moved(hass: Any) -> None:
    """Once per install, whether or not the report is on (nothing leaves the house for it): which moved features this
    house had in use the first time this code ran, before it could buy them back."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        return
    seen = st.data.get(SEEN_KEY) if isinstance(st.data.get(SEEN_KEY), dict) else {}
    if "moved" in seen:
        return
    await st.async_set(**{SEEN_KEY: {**seen, "moved": moved_now(hass, st.data)}})


def note_gained(hass: Any, before: Any, after: Any, now: float | None = None) -> None:
    """Add-ons a key carries now that it did not (a purchase, entered or added to the key): counted by name and by
    where the day falls against the sale (usage addon_gained:*, only while the report is on)."""
    from .telemetry import bump  # noqa: PLC0415
    new = [a for a in normalize_addons(after) if a not in set(normalize_addons(before))]
    for a in new:
        bump(hass, f"addon_gained:{a}")
    if new:
        bump(hass, f"addon_gained_in:{sale_when(time.time() if now is None else now)}")


def _state_class(s: Any) -> str:
    attrs = getattr(s, "attributes", None)
    return str(attrs.get("device_class") or "") if isinstance(attrs, Mapping) else ""


def _c4(hass: Any, entries: list[Any]) -> dict[str, Any]:
    st = getattr(entries[0], "state", None)
    st = str(getattr(st, "value", st) or "")
    out: dict[str, Any] = {"entry": st if st in C4_ENTRY_WORDS else "other", "os": "unknown"}
    try:
        from homeassistant.helpers import device_registry as _dr  # noqa: PLC0415
        from .util import ha_devices  # noqa: PLC0415
        for d in ha_devices(_dr.async_get(hass)):
            ids = getattr(d, "identifiers", None) or ()
            ver = getattr(d, "sw_version", None)
            if isinstance(ver, str) and ver.strip() and any(isinstance(i, tuple) and i and i[0] == "control4" for i in ids):
                major = ver.strip().split(".")[0]
                out["os"] = major if major in ("2", "3") else "other"
                break
    except Exception:
        _quiet_error("addon_report:c4_os")
    # "Control4 OS 2 Local": a custom control4 integration that signs in with the controller's own token.
    if "custom_components.control4.local_token" in sys.modules or any(
            "director_password" in (getattr(e, "options", None) or {}) for e in entries):
        out["local"] = True
    return out


def _history_word(hass: Any) -> str:
    """How many days of history the recorder keeps (Time travel and Vacation Mode replay it), as a band."""
    try:
        from homeassistant.helpers.recorder import get_instance  # noqa: PLC0415
        days = getattr(get_instance(hass), "keep_days", None)
    except Exception:
        _quiet_error("addon_report:history")
        return "none"
    if isinstance(days, bool) or not isinstance(days, (int, float)) or days <= 0:
        return "none"
    return "lt7d" if days < 7 else "7_13d" if days < 14 else "14_30d" if days <= 30 else "gt30d"


def market(hass: Any, settings: dict[str, Any], env: dict[str, Any]) -> dict[str, Any]:
    """What the house has that an add-on is for (see the module's docstring). Counts are capped at CAP."""
    out: dict[str, Any] = {}

    def n(key: str, v: int) -> None:
        if v > 0:
            out[key] = min(int(v), CAP)

    def states(domain: str) -> list[Any]:
        try:
            return list(hass.states.async_all(domain))
        except Exception:
            _quiet_error("addon_report:states")
            return []

    def entries(domain: str) -> list[Any]:
        try:
            return list(hass.config_entries.async_entries(domain) or [])
        except Exception:
            _quiet_error("addon_report:entries")
            return []

    n("alarm", len(states("alarm_control_panel")))
    covers = [_state_class(s) for s in states("cover")]
    n("garage", covers.count("garage"))
    n("gate", covers.count("gate"))
    sensors = [_state_class(s) for s in states("sensor")]
    n("temp", sensors.count("temperature"))
    n("humidity", sensors.count("humidity"))
    n("co2", sensors.count("carbon_dioxide"))
    try:
        from .emergency_test import resolve_members  # noqa: PLC0415
        n("emergency", len(resolve_members(hass).get("members") or []))
    except Exception:
        _quiet_error("addon_report:market_emergency")
    players = states("media_player")
    vacuums = states("vacuum")
    if players or vacuums:
        try:
            from homeassistant.helpers import device_registry as _dr, entity_registry as _er  # noqa: PLC0415
            from .util import ha_devices  # noqa: PLC0415
            ents = _er.async_get(hass)
            audio: dict[str, int] = {}
            for s in players:
                plat = str(getattr(ents.async_get(getattr(s, "entity_id", "")), "platform", "") or "").lower()
                system = next((w for w in AUDIO_SYSTEMS if plat.startswith(w)), None)
                if system:
                    audio[system] = min(audio.get(system, 0) + 1, CAP)
            if audio:
                out["audio"] = audio
            if vacuums:
                devs = {d.id: d for d in ha_devices(_dr.async_get(hass))}
                for s in vacuums:
                    e = ents.async_get(getattr(s, "entity_id", ""))
                    d = devs.get(getattr(e, "device_id", None))
                    words = " ".join(str(getattr(x, k, "") or "") for x, k in (
                        (d, "manufacturer"), (d, "model"), (d, "sw_version"), (d, "name"), (e, "unique_id")))
                    if "valetudo" in words.lower():
                        out["valetudo"] = True
                        break
        except Exception:
            _quiet_error("addon_report:market_players")
    n("vacuum", len(vacuums))
    c4 = entries("control4")
    if c4:
        out["c4"] = _c4(hass, c4)
    if entries("unifi_utopia"):
        out["wifi"] = "utopia"
    elif entries("unifi"):
        out["wifi"] = "unifi"
    out["history"] = _history_word(hass)
    n("wled", len(entries("wled")))
    n("teams", len([t for t in settings.get("power_teams") or [] if isinstance(t, dict)]))
    pt = env.get("power_teams") if isinstance(env.get("power_teams"), dict) else {}
    bulbs = pt.get("colour_bulbs_by_brand") if isinstance(pt.get("colour_bulbs_by_brand"), dict) else {}
    n("colour_bulbs", sum(v for v in bulbs.values() if isinstance(v, int) and not isinstance(v, bool)))
    plans = env.get("plans") if isinstance(env.get("plans"), dict) else {}
    if any(p in plans for p in PLAN_WORDS):
        out["plans"] = [p for p in PLAN_WORDS if p in plans]
    if settings.get("roomplan_import_enabled") is True:
        out["roomplan"] = True
    return out


def section(hass: Any, settings: dict[str, Any], usage: dict[str, Any], env: dict[str, Any],
            now: float | None = None) -> dict[str, Any]:
    """The report's `addons`."""
    from .ws_common import _pro_expiry_state  # noqa: PLC0415
    now = time.time() if now is None else now
    state = _pro_expiry_state(hass)
    active = bool(state.get("active"))
    word = licence_word(settings, active, state.get("days_left"))
    out: dict[str, Any] = {"licence": word}
    h = held(settings, now)
    if h:
        out["held"] = h
    kept = settings.get("license_addons_kept")
    if settings.get("license_is_trial") and isinstance(kept, dict) and str(kept.get("forensics_license_key") or "").strip():
        out["kept"] = True
    seen = settings.get(SEEN_KEY) if isinstance(settings.get(SEEN_KEY), dict) else {}
    if seen.get("licence") in LICENCE_WORDS and seen.get("licence") != word:
        out["was"] = seen["licence"]
    moved = [w for w in seen.get("moved") or [] if w in MOVED_WORDS] if isinstance(seen.get("moved"), list) else []
    if moved:
        out["moved"] = moved
    used = used_words(settings, usage, active)
    if used:
        out["used"] = used
    out["market"] = market(hass, settings, env)
    return out


def check(sec: Any) -> None:
    """Raise ValueError unless `sec` holds only this module's keys and words (telemetry.assert_shareable)."""
    def count(v: Any) -> bool:
        return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= CAP

    def words(v: Any, allowed: tuple[str, ...]) -> bool:
        return isinstance(v, list) and len(v) == len(set(v)) and all(w in allowed for w in v)
    if not isinstance(sec, dict) or sec.get("licence") not in LICENCE_WORDS:
        raise ValueError("addons.licence not in the vocabulary")
    for k, v in sec.items():
        ok = (k == "licence"
              or (k == "held" and isinstance(v, dict) and all(a in ADDONS and d in DAYS_WORDS for a, d in v.items()))
              or (k == "kept" and v is True)
              or (k == "was" and v in LICENCE_WORDS)
              or (k == "moved" and words(v, MOVED_WORDS))
              or (k == "used" and words(v, USED_WORDS))
              or (k == "market" and isinstance(v, dict)))
        if not ok:
            raise ValueError(f"addons.{str(k)[:24]} not in the vocabulary")
    for k, v in sec["market"].items() if "market" in sec else ():
        ok = ((k in MARKET_COUNTS and count(v))
              or (k == "audio" and isinstance(v, dict) and all(s in AUDIO_SYSTEMS and count(c) for s, c in v.items()))
              or (k == "c4" and isinstance(v, dict) and v.get("os") in C4_OS_WORDS and v.get("entry") in C4_ENTRY_WORDS
                  and set(v) <= {"os", "entry", "local"} and v.get("local", True) is True)
              or (k == "wifi" and v in WIFI_WORDS)
              or (k == "history" and v in HISTORY_WORDS)
              or (k == "plans" and words(v, PLAN_WORDS))
              or (k in ("roomplan", "valetudo") and v is True))
        if not ok:
            raise ValueError(f"addons.market.{str(k)[:24]} not in the vocabulary")
