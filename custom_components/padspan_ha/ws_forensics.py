# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for Forensics (PadSpan Pro) and the licence.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_OBJECTS,
    DATA_OBJECT_HISTORY,
    DATA_FORENSICS,
)
from .ws_common import _get_settings, _invalidate_snapshot_cache, _pro_expiry_state
from .telemetry import bump as _bump

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/forensics_query",
        vol.Required("from_ts"): vol.Coerce(float),
        vol.Required("to_ts"): vol.Coerce(float),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_forensics_query(hass: HomeAssistant, connection, msg) -> None:
    """Return devices present (recorded) or possibly present (first/last-seen
    overlap) during [from_ts, to_ts] (epoch seconds).

    Admin-gated (Phase 2i security audit, 2026-09-19) — this is per-room
    presence history of household members, the same sensitivity as the
    license/reveal commands elsewhere in this file that already require
    admin; the panel surfacing it is itself require_admin=False, so any
    signed-in non-admin HA account could otherwise read it.
    """
    from .const import DATA_FORENSICS
    from .forensics_store import retention_days

    from_ts = float(msg["from_ts"])
    to_ts = float(msg["to_ts"])
    if to_ts < from_ts:
        from_ts, to_ts = to_ts, from_ts

    _dom = hass.data.get(DOMAIN, {})
    fs = _dom.get(DATA_FORENSICS)
    # The query is a sync scan over every stored session — run it off the
    # event loop (only the 60s tick otherwise touches the store's dict).
    recorded = (await hass.async_add_executor_job(fs.query, from_ts, to_ts, 500, list(fs.addrs.items()))
                if fs else [])
    stats = fs.stats() if fs else {}
    _bump(hass, "forensics_query")

    # Label + vendor enrichment from ObjectStore / object-history cache.
    # Rotating-MAC devices (private BLE / split iBeacon) are cached under
    # irk:/ibeacon: keys with the current MAC only in the entry's address /
    # all_addresses fields — build a reverse MAC index so the user's own
    # labelled phone doesn't show up as an anonymous MAC.
    obj_store = _dom.get(DATA_OBJECTS)
    _hist: dict = _dom.get(DATA_OBJECT_HISTORY) or {}
    _mac_to_hist: dict[str, tuple[str, dict]] = {}
    for _k, _cached in list(_hist.items()):
        if not _k.startswith(("irk:", "ibeacon:")):
            continue
        _macs = [_cached.get("address")] + list(_cached.get("all_addresses") or [])
        for _m in _macs:
            _mu = str(_m or "").upper()
            if len(_mu) == 17:
                _mac_to_hist.setdefault(_mu, (_k, _cached))
    for r in recorded:
        addr = r["address"]
        if obj_store:
            label = obj_store.get_label(addr) or obj_store.get_label(f"ble:{addr}")
            if label:
                r["user_label"] = label
        h = _hist.get(f"ble:{addr}")
        hist_key = f"ble:{addr}"
        if h is None and addr in _mac_to_hist:
            hist_key, h = _mac_to_hist[addr]
        if h:
            for fld in ("company_name", "device_type", "user_label", "name"):
                if h.get(fld) and not r.get(fld):
                    r[fld] = h[fld]
            if obj_store and not r.get("user_label"):
                label = obj_store.get_label(h.get("canonical_id") or hist_key)
                if label:
                    r["user_label"] = label

    # Fallback tier: cache entries whose [first_seen, last_seen] span overlaps
    # the window but have no recorded sessions.  A device seen before AND
    # after the window matches too — hence "possible", not "recorded".
    #
    # ONLY offered when the window reaches before recording began: for any
    # window the recorder already covers, span-overlap matches every device
    # currently alive (last_seen = now) and floods the results with the whole
    # neighbourhood (measured: 145 "possible" on a 1-minute window).
    oldest_rec = stats.get("oldest_ts")
    include_possible = oldest_rec is None or from_ts < float(oldest_rec)
    recorded_addrs = {r["address"] for r in recorded}
    possible = []
    for key, cached in list(_hist.items()) if include_possible else []:
        fs_ts = cached.get("_first_seen")
        ls_ts = cached.get("_last_seen_ts")
        if not isinstance(fs_ts, (int, float)) or not isinstance(ls_ts, (int, float)):
            continue
        if fs_ts > to_ts or ls_ts < from_ts:
            continue
        addr = (cached.get("address") or "").upper()
        if addr and addr in recorded_addrs:
            continue
        # Grouped entries (irk:/ibeacon:) carry their rotation history in
        # all_addresses — drop them too if any of those MACs was recorded.
        if any(str(a or "").upper() in recorded_addrs for a in (cached.get("all_addresses") or [])):
            continue
        possible.append({
            "key": key,
            "kind": cached.get("kind") or "",
            "address": addr,
            "name": cached.get("name") or "",
            "user_label": cached.get("user_label") or "",
            "company_name": cached.get("company_name") or "",
            "device_type": cached.get("device_type") or "",
            "first_seen": fs_ts,
            "last_seen": ls_ts,
        })
    # Collect ALL matches first, then sort by recency and truncate — an early
    # break would keep an arbitrary insertion-order subset of the cache.
    possible.sort(key=lambda p: p["last_seen"], reverse=True)
    del possible[500:]

    connection.send_result(msg["id"], {
        "recorded": recorded,
        "possible": possible,
        "possible_suppressed": not include_possible,
        "recording_oldest_ts": stats.get("oldest_ts"),
        "retention_days": retention_days(hass),
    })


@websocket_api.websocket_command({"type": "padspan_ha/forensics_license_reveal"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_forensics_license_reveal(hass: HomeAssistant, connection, msg) -> None:
    """Return the licence key itself — admin only, on explicit request.

    The key is redacted from the normal settings payload (see _get_settings),
    but an owner still has to be able to read it back to move the licence to
    another install. That is a deliberate, admin-gated action rather than
    something every household account receives on every panel load.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    state = _pro_expiry_state(hass)
    connection.send_result(msg["id"], {
        "key": str((st.data if st else {}).get("forensics_license_key") or ""),
        "expires": state["expires"],
        "days_left": state["days_left"],
        "active": state["active"],
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/licence_homes",
        vol.Optional("op", default="list"): vol.In(["list", "remove", "label"]),
        vol.Optional("home_id"): vol.Coerce(int),
        vol.Optional("label"): vol.All(str, vol.Length(max=60)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_licence_homes(hass: HomeAssistant, connection, msg) -> None:
    """The licence key's homes, from the licence server: list them, remove
    one (it frees its place), or name this one. licence_homes.py."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    key = str((st.data if st else {}).get("forensics_license_key") or "").strip()
    if not key:
        connection.send_error(msg["id"], "no_key", "No licence key on this install")
        return
    from . import licence_homes  # noqa: PLC0415
    op = msg.get("op") or "list"
    try:
        if op == "remove":
            data = await licence_homes.call(hass, "home_remove", key, {"home_id": str(int(msg.get("home_id") or 0))}, post=True)
            # One fewer home: the licence server's answer on this home (its
            # reports warning, how many homes) follows now, not tomorrow.
            from .update_check import _revalidate_license  # noqa: PLC0415
            hass.async_create_task(_revalidate_license(hass))
        elif op == "label":
            label = str(msg.get("label") or "").strip()[:60]
            await st.async_set(license_home_label=label)
            data = await licence_homes.call(hass, "home_label", key, {"label": label}, post=True)
        else:
            data = await licence_homes.call(hass, "homes", key)
    except Exception as err:
        connection.send_error(msg["id"], "network", f"Could not reach the licence server ({err}).")
        return
    if not isinstance(data, dict) or not data.get("ok"):
        connection.send_error(msg["id"], "refused", str((data or {}).get("message") or "The licence server refused it."))
        return
    def _n(v, d=0):
        try:
            return int(v)
        except (TypeError, ValueError):
            return d
    homes = [h for h in (data.get("homes") or []) if isinstance(h, dict)]
    lic = data.get("licence") if isinstance(data.get("licence"), dict) else {}
    connection.send_result(msg["id"], {
        "homes": [{"id": _n(h.get("id")), "label": str(h.get("label") or ""), "version": h.get("version") or "",
                   "first_seen": h.get("first_seen") or "", "last_seen": h.get("last_seen") or "", "this": bool(h.get("this")),
                   "reporting": bool(h.get("reporting"))}
                  for h in homes],
        "homes_max": _n(data.get("homes_max"), 5), "frozen": bool(data.get("frozen")),
        # The licence they share: its owner's email masked by the server, its plan, the key's last four.
        "licence": {k: lic.get(k) for k in ("owner", "plan", "expires_at", "key_end", "homes_free")},
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/forensics_license_activate",
        vol.Required("key"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_forensics_license_activate(hass: HomeAssistant, connection, msg) -> None:
    """Validate a PadSpan Pro licence key against traks.ca and, if valid,
    store it and enable forensics.  The server does the HTTP call so the
    browser never needs cross-origin access."""
    key = str(msg.get("key") or "").strip().upper()
    if not key:
        connection.send_error(msg["id"], "invalid_key", "Licence key is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return
    try:
        import json as _json  # noqa: PLC0415
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
        from .licence_homes import home_params, homes_warning, machine_id  # noqa: PLC0415
        machine = await machine_id(hass)
        # A different key starts this home afresh among that key's homes, and
        # so does a home removed from its key: it asks for a free place again.
        _hp = home_params(st.data)
        new_key = key != str(st.data.get("forensics_license_key") or "").strip().upper()
        if new_key or st.data.get("license_home_status") == "removed":
            _hp["token"] = ""
        session = async_get_clientsession(hass)
        async with session.get(
            "https://traks.ca/license/",
            params={"action": "validate", "product": "padspan", "key": key, "machine": machine, **_hp},
            timeout=15,
        ) as resp:
            text = await resp.text()
        data = _json.loads(text.lstrip("\ufeff"))  # licence server prefixes a BOM
    except Exception as err:
        connection.send_error(msg["id"], "network",
            f"Could not reach the licence server ({err}). Check the internet connection and try again.")
        return
    if data.get("valid"):
        from .licence import normalize_tier  # noqa: PLC0415
        # The server names the tier it sold ("pro" / "bright"). A server that
        # does not (yet) say is a Pro key — see licence.key_tier.
        await st.async_set(
            forensics_license_key=key,
            forensics_license_expires=str(data.get("expires_at") or ""),
            license_tier=normalize_tier(data.get("tier"), default="pro"),
            # A key typed in is whatever the server says it is: a trialist who
            # buys (or goes lifetime on the same key) is no longer on a trial.
            license_is_trial=str(data.get("plan") or "") == "trial",
            forensics_enabled=True,
            license_home_status="",
            # Past two homes with a report off somewhere: the server's warning (or none).
            license_homes_warning=homes_warning(data),
            # A different key: a fresh home on it.
            **({"license_home_token": str(data.get("token") or "") if len(str(data.get("token") or "")) == 32 else "",
                "license_homes_used": int(data.get("homes_used") or 0) if str(data.get("homes_used") or "0").isdigit() else 0}
               if new_key else {}),
        )
        if not new_key:
            # The same key again: this home keeps its token unless a new one came.
            from .licence_homes import keep_token  # noqa: PLC0415
            await keep_token(st, data)
        _invalidate_snapshot_cache(hass)
        connection.send_result(msg["id"], {
            "ok": True,
            "expires_at": data.get("expires_at"),
            "days_left": data.get("days_left"),
            "settings": _get_settings(hass),
        })
    else:
        connection.send_result(msg["id"], {
            "ok": False,
            "status": data.get("status") or "invalid",
            "message": (NEEDS_ALL_REPORTS_JOIN if data.get("status") == "needs_all_reports" else None)
                       or data.get("message") or "Key not valid for PadSpan Pro.",
        })


# A key on more than two homes takes a new one only while every home on it,
# the new one too, has its usage report on (0.38.163).
NEEDS_ALL_REPORTS_JOIN = ("To use this key on more than 2 homes, turn on the usage report on all of them, "
                          "including this one.")


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/trial_start",
        vol.Required("email"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_trial_start(hass: HomeAssistant, connection, msg) -> None:
    """Start the one-time 3-month PadSpan Bright Pro trial.

    Mints a real trial key server-side (same validate/activate path a
    purchase uses, so expiry/grace/the editing-only gate all just work) and
    stores it immediately — no email round-trip needed on this end. The
    licence server is the enforcement point for "only once": it is keyed on
    both this install's `machine` id and the email, because either alone is
    trivial to reset (reinstall vs. a throwaway address), and it rate-limits
    by requesting IP on top of that. This command only surfaces whatever the
    server decides.
    """
    email = str(msg.get("email") or "").strip()
    if "@" not in email:
        connection.send_error(msg["id"], "invalid_email", "A real email address is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return
    # Every free offer needs the opt-in usage report on (Garry, 2026-10-27).
    # The trial card asks for it in the same step (views/trial_offer.js).
    from .telemetry import enabled as _report_on  # noqa: PLC0415
    if not _report_on(hass):
        connection.send_result(msg["id"], {"ok": False, "status": "report_off", "message": "The free trial needs the usage report on (Settings → Presence → Usage report): anonymous counts that help PadSpan get better. Turn it on, then start the trial."})
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
        async with session.post(
            "https://traks.ca/license/",
            params={"action": "trial_start", "product": "padspan"},
            data={"email": email, "machine": machine},
            timeout=15,
        ) as resp:
            text = await resp.text()
        data = _json.loads(text.lstrip("﻿"))
    except Exception as err:
        connection.send_error(msg["id"], "network",
            f"Could not reach the licence server ({err}). Check the internet connection and try again.")
        return
    if data.get("ok"):
        from .licence import normalize_tier  # noqa: PLC0415
        await st.async_set(
            forensics_license_key=str(data.get("key") or ""),
            forensics_license_expires=str(data.get("expires_at") or ""),
            license_tier=normalize_tier(data.get("tier"), default="bright"),
            license_is_trial=True,
            forensics_enabled=True,
            license_home_token="", license_homes_used=0, license_home_status="",
            license_homes_warning={},
        )
        _invalidate_snapshot_cache(hass)
        connection.send_result(msg["id"], {
            "ok": True,
            "expires_at": data.get("expires_at"),
            "days_left": data.get("days_left"),
            "settings": _get_settings(hass),
        })
    else:
        connection.send_result(msg["id"], {
            "ok": False,
            "status": data.get("status") or "unavailable",
            "message": data.get("message") or "Could not start a trial for this install.",
        })


@websocket_api.websocket_command({"type": "padspan_ha/forensics_stats"})
@websocket_api.async_response
async def ws_forensics_stats(hass: HomeAssistant, connection, msg) -> None:
    """Return recorder stats for the Settings UI."""
    from .const import DATA_FORENSICS

    fs = hass.data.get(DOMAIN, {}).get(DATA_FORENSICS)
    stats = fs.stats() if fs else {"addr_count": 0, "session_count": 0, "oldest_ts": None, "newest_ts": None}
    connection.send_result(msg["id"], stats)


@websocket_api.websocket_command({"type": "padspan_ha/forensics_clear"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_forensics_clear(hass: HomeAssistant, connection, msg) -> None:
    """Delete all recorded forensics sessions (irreversible)."""
    from .const import DATA_FORENSICS

    fs = hass.data.get(DOMAIN, {}).get(DATA_FORENSICS)
    removed = await fs.async_clear() if fs else 0
    _LOGGER.info("Forensics data cleared (%d addresses removed)", removed)
    connection.send_result(msg["id"], {"ok": True, "removed": removed})
