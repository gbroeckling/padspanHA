# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
REPO LOGIC NOTES (read me when debugging vendor lookups)

Why this exists:
- In PadSpan, "unidentified" BLE objects are usually just MAC addresses from the advertisement monitor.
- To make those usable, we do a best-effort *manufacturer/vendor* lookup using public OUI databases.

Important privacy note:
- A MAC address (or its OUI/prefix) may still be personal data in some contexts.
- This feature is ON by default because the user requested it, but you can disable it in the UI Settings.
- We cache aggressively and rate-limit so we don't spam 3rd-party services.

We intentionally use TWO independent sources so we can cross-check results:
1) MACVendors API (simple GET, returns vendor string, 404 if unknown)
2) MACLookup API v2 (JSON response with company + extra flags, 404 if unknown)

Sources / docs:
- MACVendors API: https://macvendors.com/api
- MACLookup v2: https://maclookup.app/api-v2/documentation

If you ever swap providers:
- keep the output schema stable: the UI expects "sources.macvendors" and "sources.maclookup".
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Tuple

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from .const import DOMAIN, VENDOR_CACHE_STORE_KEY

_LOGGER = logging.getLogger(__name__)

# Cache vendor results by OUI/prefix (first 3 bytes). This keeps lookups fast and cheap.
CACHE_TTL = timedelta(days=30)

# Conservative defaults; both providers allow higher, but we stay gentle.
# MACVendors free tier is limited (see their docs); MACLookup also recommends caching.
MIN_SECONDS_BETWEEN_CALLS = {
    "macvendors": 1.0,
    "maclookup": 0.6,  # ~2 req/sec max without API key
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _norm_mac(mac: str) -> str:
    """Normalize to AA:BB:CC:DD:EE:FF uppercase, best-effort."""
    s = (mac or "").strip().upper()
    # keep hex digits only
    hexs = "".join(ch for ch in s if ch in "0123456789ABCDEF")
    if len(hexs) < 12:
        # allow prefix-only (6 chars) inputs
        hexs = hexs.ljust(12, "0")
    hexs = hexs[:12]
    return ":".join(hexs[i : i + 2] for i in range(0, 12, 2))


def _oui_prefix(mac_norm: str) -> str:
    """Return OUI prefix as AA:BB:CC."""
    parts = (mac_norm or "").split(":")
    if len(parts) < 3:
        return ""
    return ":".join(parts[:3])


@dataclass
class VendorCache:
    # @dataclass here is for the free __repr__/__eq__ only — construction
    # needs a real HomeAssistant instance to build the Store (Store(hass, ...)
    # can't be expressed as a dataclass field default), so __init__ is fully
    # hand-written below and the dataclass-generated one never runs.
    hass: HomeAssistant
    store: Store
    data: Dict[str, Any]

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, VENDOR_CACHE_STORE_KEY)
        self.data = {"entries": {}}

    async def async_load(self) -> Dict[str, Any]:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and isinstance(loaded.get("entries"), dict):
            self.data = loaded
        else:
            self.data = {"entries": {}}
        return self.data

    async def async_save(self) -> None:
        await self.store.async_save(self.data)

    def get(self, prefix: str) -> Optional[Dict[str, Any]]:
        return self.data.get("entries", {}).get(prefix)

    def set(self, prefix: str, entry: Dict[str, Any]) -> None:
        self.data.setdefault("entries", {})[prefix] = entry


async def _get_cache(hass: HomeAssistant) -> VendorCache:
    dom = hass.data.setdefault(DOMAIN, {})
    cache: VendorCache | None = dom.get("_vendor_cache")
    if cache is None:
        cache = VendorCache(hass)
        await cache.async_load()
        dom["_vendor_cache"] = cache
    return cache


def _rate_limiter(hass: HomeAssistant) -> Tuple[asyncio.Lock, Dict[str, float]]:
    """One lock + per-provider last-call timestamps, stored in hass.data."""
    dom = hass.data.setdefault(DOMAIN, {})
    lock: asyncio.Lock = dom.setdefault("_vendor_rl_lock", asyncio.Lock())
    last: Dict[str, float] = dom.setdefault("_vendor_rl_last", {})
    return lock, last


async def _throttle(hass: HomeAssistant, provider: str) -> None:
    lock, last = _rate_limiter(hass)
    async with lock:
        now = _utcnow().timestamp()
        min_dt = MIN_SECONDS_BETWEEN_CALLS.get(provider, 0.5)
        prev = float(last.get(provider, 0.0))
        wait = (prev + min_dt) - now
        if wait > 0:
            await asyncio.sleep(wait)
        last[provider] = _utcnow().timestamp()


async def _fetch_macvendors(hass: HomeAssistant, mac_norm: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (vendor, error)."""
    await _throttle(hass, "macvendors")
    url = f"https://api.macvendors.com/{mac_norm}"
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, timeout=10) as resp:
            if resp.status == 404:
                return None, None
            if resp.status != 200:
                return None, f"macvendors_http_{resp.status}"
            txt = (await resp.text()).strip()
            return (txt or None), None
    except Exception as e:
        _LOGGER.debug("MACVendors lookup failed for %s: %s", mac_norm, e)
        return None, "macvendors_exception"


async def _fetch_maclookup(hass: HomeAssistant, mac_norm: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Return (info_dict, error)."""
    await _throttle(hass, "maclookup")
    url = f"https://api.maclookup.app/v2/macs/{mac_norm}"
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, timeout=10) as resp:
            if resp.status == 404:
                return None, None
            if resp.status != 200:
                return None, f"maclookup_http_{resp.status}"
            js = await resp.json(content_type=None)
            if not isinstance(js, dict):
                return None, "maclookup_bad_json"
            # We keep a stable subset; UI can evolve without reworking cache format.
            return {
                "company": js.get("company"),
                "address": js.get("address"),
                "blockType": js.get("blockType"),
                "blockStart": js.get("blockStart"),
                "blockEnd": js.get("blockEnd"),
                "updated": js.get("updated"),
                "isRand": js.get("isRand"),
                "isPrivate": js.get("isPrivate"),
                "found": js.get("found"),
                "success": js.get("success"),
            }, None
    except Exception as e:
        _LOGGER.debug("MACLookup lookup failed for %s: %s", mac_norm, e)
        return None, "maclookup_exception"


async def async_lookup_vendor(hass: HomeAssistant, mac: str, force_refresh: bool = False) -> Dict[str, Any]:
    """Lookup vendor/manufacturer for a MAC address (or prefix).

    Output schema is intentionally stable because the UI calls this directly.
    """
    mac_norm = _norm_mac(mac)
    prefix = _oui_prefix(mac_norm)

    out: Dict[str, Any] = {
        "mac": mac_norm,
        "prefix": prefix,
        "found": False,
        "sources": {"macvendors": None, "maclookup": None},
        "errors": [],
        "cached": False,
        "fetched_at": None,
    }

    if not prefix:
        out["errors"].append("bad_mac")
        return out

    cache = await _get_cache(hass)
    cached = cache.get(prefix)

    def _is_fresh(entry: Dict[str, Any]) -> bool:
        try:
            ts = entry.get("fetched_at")
            if not ts:
                return False
            t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return (_utcnow() - t) <= CACHE_TTL
        except Exception:
            return False

    if cached and _is_fresh(cached) and not force_refresh:
        out.update({
            "found": bool(cached.get("found")),
            "sources": cached.get("sources", out["sources"]),
            "fetched_at": cached.get("fetched_at"),
            "cached": True,
        })
        return out

    vendor1, err1 = await _fetch_macvendors(hass, mac_norm)
    info2, err2 = await _fetch_maclookup(hass, mac_norm)

    if err1:
        out["errors"].append(err1)
    if err2:
        out["errors"].append(err2)

    out["sources"]["macvendors"] = vendor1
    out["sources"]["maclookup"] = info2

    # "found" means either provider returned something useful.
    out["found"] = bool(vendor1) or bool(info2 and (info2.get("company") or info2.get("found")))
    out["fetched_at"] = _utcnow().isoformat().replace("+00:00", "Z")

    # Save cache by prefix. This means if you lookup any MAC that shares the prefix,
    # it will reuse the cached vendor info (correct for OUI-based manufacturer lookup).
    cache.set(prefix, {
        "fetched_at": out["fetched_at"],
        "found": out["found"],
        "sources": out["sources"],
    })
    try:
        await cache.async_save()
    except Exception as e:
        _LOGGER.debug("Vendor cache save failed: %s", e)

    return out
