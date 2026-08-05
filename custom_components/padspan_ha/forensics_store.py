# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Forensics presence-session recorder (opt-in, off by default).

Answers "which BLE devices were actually near my scanners between X and Y?"
(GitHub issue #55).  The object-history cache only keeps first_seen/last_seen
per device, so a device seen Monday and Wednesday would falsely match a
Tuesday window.  This store records real presence *sessions*: contiguous
[start, end] intervals per address, closed when an address goes silent for
more than GAP_S.

Privacy: recording is gated per-tick on the `forensics_enabled` setting
(default off) AND `data_mode == "live"`.  Data never leaves HA storage and
is NEVER shipped in live_snapshot (see the 19.5MB payload scar tissue in
websocket.py) — it is served only by the on-demand padspan_ha/forensics_*
websocket commands.

Storage shape (.storage/padspan_ha.forensics):
    {
      "addrs": {
        "AA:BB:CC:DD:EE:FF": {
          "name": "Advertised Name",
          "sessions": [[start_ts, end_ts, max_rssi, ["scanner1", ...]], ...]
        },
        ...
      }
    }
Timestamps are epoch seconds (time.time()), matching MovementStore.
"""

import logging
import time
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DATA_FORENSICS, DATA_SETTINGS, DOMAIN, FORENSICS_STORE_KEY

_LOGGER = logging.getLogger(__name__)

GAP_S = 300                 # silence longer than this closes a session
FRESH_S = 90                # only ads seen within the last 90s count as "present"
SAMPLE_INTERVAL = timedelta(seconds=60)
SAVE_INTERVAL_S = 300       # write .storage at most every 5 minutes
# Caps sized for busy urban installs: rotating-MAC phones mint a new address
# every ~15 min, so the addr cap is what bounds disk/RAM.  5000 addrs × 50
# sessions ≈ low-single-digit MB of JSON worst case (int timestamps).
MAX_SESSIONS_PER_ADDR = 50
MAX_ADDRS = 5000
MAX_SOURCES_PER_SESSION = 8
RETENTION_CHOICES = (7, 14, 30, 60, 90)
DEFAULT_RETENTION_DAYS = 14

_DATA_UNSUBS = "_forensics_unsubs"

# Session tuple indices (stored as JSON lists)
_S_START, _S_END, _S_RSSI, _S_SOURCES = 0, 1, 2, 3


class ForensicsStore:
    """Persistent store of BLE presence sessions, keyed by address."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, FORENSICS_STORE_KEY)
        self.addrs: dict[str, dict[str, Any]] = {}
        self._dirty = False
        self._last_save_ts = 0.0

    async def async_load(self) -> None:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and isinstance(loaded.get("addrs"), dict):
            self.addrs = loaded["addrs"]
        else:
            self.addrs = {}
        self._last_save_ts = time.time()
        _LOGGER.debug("ForensicsStore loaded (%d addresses)", len(self.addrs))

    # ── Recording ────────────────────────────────────────────────────────────

    def record_sightings(self, ads: list[dict[str, Any]], now: float | None = None) -> int:
        """Fold one sample of advertisements into presence sessions.

        `ads` is bluetooth_live get_snapshot()["advertisements"] — may contain
        multiple records per address (one per scanner source); they are merged
        here.  Returns the number of addresses updated.

        Timestamps are stored as int epoch seconds — sub-second precision is
        meaningless at a 60s sample cadence and full floats double the JSON.
        """
        now = int(now if now is not None else time.time())
        # Merge per-address: best rssi, any real name, union of sources
        merged: dict[str, dict[str, Any]] = {}
        for ad in ads:
            addr = str(ad.get("address") or "").upper()
            if not addr:
                continue
            age = ad.get("age_s")
            if isinstance(age, (int, float)) and age > FRESH_S:
                continue
            m = merged.setdefault(addr, {"rssi": None, "name": "", "sources": set()})
            rssi = ad.get("rssi")
            if isinstance(rssi, (int, float)) and (m["rssi"] is None or rssi > m["rssi"]):
                m["rssi"] = int(rssi)
            name = str(ad.get("name") or "")
            if name and name != addr and not m["name"]:
                m["name"] = name
            src = str(ad.get("source") or "")
            if src:
                m["sources"].add(src)

        for addr, m in merged.items():
            entry = self.addrs.get(addr)
            if entry is None:
                entry = {"name": m["name"], "sessions": []}
                self.addrs[addr] = entry
            elif m["name"] and not entry.get("name"):
                entry["name"] = m["name"]
            sessions = entry["sessions"]
            rssi = m["rssi"] if m["rssi"] is not None else -127
            if sessions and (now - sessions[-1][_S_END]) <= GAP_S:
                # Extend the open session.  max() guards against a backward
                # wall-clock step (NTP correction) rewinding the session end
                # below its own start and breaking chronological ordering.
                last = sessions[-1]
                last[_S_END] = max(last[_S_END], now)
                if rssi > last[_S_RSSI]:
                    last[_S_RSSI] = rssi
                srcs = last[_S_SOURCES]
                for s in m["sources"]:
                    if s not in srcs and len(srcs) < MAX_SOURCES_PER_SESSION:
                        srcs.append(s)
            else:
                sessions.append([now, now, rssi, sorted(m["sources"])[:MAX_SOURCES_PER_SESSION]])
                if len(sessions) > MAX_SESSIONS_PER_ADDR:
                    del sessions[0 : len(sessions) - MAX_SESSIONS_PER_ADDR]
        if merged:
            self._dirty = True
        return len(merged)

    # ── Pruning / persistence ────────────────────────────────────────────────

    def prune(self, retention_days: int, now: float | None = None) -> int:
        """Drop sessions past retention and enforce the address cap."""
        now = now if now is not None else time.time()
        cutoff = now - retention_days * 86400
        removed = 0
        for addr in list(self.addrs):
            sessions = self.addrs[addr].get("sessions") or []
            # Fast path: sessions are time-ordered, so if even the oldest one
            # is inside retention there is nothing to rebuild (the common case
            # on every 60s tick).
            if sessions and sessions[0][_S_END] >= cutoff:
                continue
            kept = [s for s in sessions if s[_S_END] >= cutoff]
            removed += len(sessions) - len(kept)
            if kept:
                self.addrs[addr]["sessions"] = kept
            else:
                del self.addrs[addr]
        if len(self.addrs) > MAX_ADDRS:
            # Drop the addresses seen least recently
            by_last = sorted(
                self.addrs, key=lambda a: self.addrs[a]["sessions"][-1][_S_END]
            )
            for addr in by_last[: len(self.addrs) - MAX_ADDRS]:
                del self.addrs[addr]
                removed += 1
        if removed:
            self._dirty = True
        return removed

    async def async_save_if_due(self, now: float | None = None, force: bool = False) -> bool:
        now = now if now is not None else time.time()
        if not self._dirty:
            return False
        if not force and (now - self._last_save_ts) < SAVE_INTERVAL_S:
            return False
        await self.store.async_save({"addrs": self.addrs})
        self._dirty = False
        self._last_save_ts = now
        return True

    async def async_clear(self) -> int:
        count = len(self.addrs)
        self.addrs = {}
        self._dirty = False
        await self.store.async_save({"addrs": {}})
        return count

    # ── Queries ──────────────────────────────────────────────────────────────

    def query(self, from_ts: float, to_ts: float, limit: int = 500) -> list[dict[str, Any]]:
        """Return addresses with at least one session overlapping [from_ts, to_ts].

        Sorted by total dwell inside the window, descending.  dwell_s is
        clamped to the window; session entries carry the full recorded
        [start, end] bounds (int seconds) so the UI shows true session extent.
        Only the last 10 sessions per address ship (session_count keeps the
        true total) — response size is a hard constraint, see the 19.5MB
        live_snapshot incident in websocket.py.
        """
        results: list[dict[str, Any]] = []
        for addr, entry in self.addrs.items():
            hits = []
            dwell = 0.0
            max_rssi = -127
            sources: list[str] = []
            for s in entry.get("sessions") or []:
                if s[_S_START] <= to_ts and s[_S_END] >= from_ts:
                    start = max(s[_S_START], from_ts)
                    end = min(s[_S_END], to_ts)
                    hits.append({"start": int(s[_S_START]), "end": int(s[_S_END]), "rssi": s[_S_RSSI]})
                    dwell += max(0.0, end - start)
                    if s[_S_RSSI] > max_rssi:
                        max_rssi = s[_S_RSSI]
                    for src in s[_S_SOURCES]:
                        if src not in sources:
                            sources.append(src)
            if hits:
                results.append({
                    "address": addr,
                    "name": entry.get("name") or "",
                    "sessions": hits[-10:],
                    "session_count": len(hits),
                    "dwell_s": round(dwell, 1),
                    "max_rssi": max_rssi,
                    "sources": sources,
                })
        results.sort(key=lambda r: r["dwell_s"], reverse=True)
        return results[:limit]

    def stats(self) -> dict[str, Any]:
        session_count = sum(len(e.get("sessions") or []) for e in self.addrs.values())
        oldest = None
        newest = None
        for e in self.addrs.values():
            sessions = e.get("sessions") or []
            if sessions:
                if oldest is None or sessions[0][_S_START] < oldest:
                    oldest = sessions[0][_S_START]
                if newest is None or sessions[-1][_S_END] > newest:
                    newest = sessions[-1][_S_END]
        return {
            "addr_count": len(self.addrs),
            "session_count": session_count,
            "oldest_ts": oldest,
            "newest_ts": newest,
        }


# ── Background sampler (update_check.py pattern) ─────────────────────────────


def _recording_enabled(hass: HomeAssistant) -> bool:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    data = st.data if st else {}
    return bool(data.get("forensics_enabled")) and data.get("data_mode") == "live"


def retention_days(hass: HomeAssistant) -> int:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    days = (st.data if st else {}).get("forensics_retention_days")
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = DEFAULT_RETENTION_DAYS
    return days if days in RETENTION_CHOICES else DEFAULT_RETENTION_DAYS


async def _tick(hass: HomeAssistant) -> None:
    """One 60s sample.  Cheap no-op unless forensics is enabled + live mode.

    Retention pruning runs even while recording is DISABLED — the advertised
    7–90 day retention is a privacy promise about existing data, not just a
    property of active recording.  Disabled + empty store stays a no-op.
    """
    store: ForensicsStore | None = hass.data.get(DOMAIN, {}).get(DATA_FORENSICS)
    if store is None:
        return
    try:
        if store.addrs:
            store.prune(retention_days(hass))
        if not _recording_enabled(hass):
            await store.async_save_if_due()  # persist prune results while disabled
            return
        from .bluetooth_live import get_bluetooth_live  # noqa: PLC0415
        bl = get_bluetooth_live(hass)
        if bl is None:
            return
        snap = bl.get_snapshot(max_ads=5000, max_age_s=FRESH_S)
        store.record_sightings(snap.get("advertisements") or [])
        await store.async_save_if_due()
    except Exception as err:
        _LOGGER.debug("Forensics tick failed: %s", err)


def async_setup_forensics(hass: HomeAssistant) -> None:
    """Schedule the 60s sampler (idempotent across reloads).

    The timer always runs; the per-tick gate in _tick makes disabled mode a
    no-op, so toggling forensics_enabled needs no reload and no start/stop
    hook in ws_settings_set.
    """
    from homeassistant.helpers.event import async_track_time_interval  # noqa: PLC0415

    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_DATA_UNSUBS):
        return  # already scheduled

    async def _run(_now: Any = None) -> None:
        await _tick(hass)

    dom[_DATA_UNSUBS] = [async_track_time_interval(hass, _run, SAMPLE_INTERVAL)]


def async_stop_forensics(hass: HomeAssistant) -> None:
    for unsub in hass.data.get(DOMAIN, {}).pop(_DATA_UNSUBS, []) or []:
        try:
            unsub()
        except Exception:
            pass
