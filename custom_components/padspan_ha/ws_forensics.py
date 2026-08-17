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

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/forensics_query",
        vol.Required("from_ts"): vol.Coerce(float),
        vol.Required("to_ts"): vol.Coerce(float),
    }
)
@websocket_api.async_response
async def ws_forensics_query(hass: HomeAssistant, connection, msg) -> None:
    """Return devices present (recorded) or possibly present (first/last-seen
    overlap) during [from_ts, to_ts] (epoch seconds)."""
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
    recorded = await hass.async_add_executor_job(fs.query, from_ts, to_ts, 500) if fs else []
    stats = fs.stats() if fs else {}

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
            text = await resp.text()
        data = _json.loads(text.lstrip("\ufeff"))  # licence server prefixes a BOM
    except Exception as err:
        connection.send_error(msg["id"], "network",
            f"Could not reach the licence server ({err}). Check the internet connection and try again.")
        return
    if data.get("valid"):
        await st.async_set(
            forensics_license_key=key,
            forensics_license_expires=str(data.get("expires_at") or ""),
            forensics_enabled=True,
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
            "status": data.get("status") or "invalid",
            "message": data.get("message") or "Key not valid for PadSpan Pro.",
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
