# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Bluetooth snapshot for PadSpan.

Goal: expose the same kind of scanner + advertisement feed you can see in
Home Assistant Settings → Devices & services → Bluetooth → Visualization.

We keep a light in-memory cache via bluetooth async callbacks, and we also
fall back to querying Home Assistant's discovered service-info list when
available.
"""

from __future__ import annotations

import datetime as dt
import logging
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from homeassistant.core import HomeAssistant, callback

_LOGGER = logging.getLogger(__name__)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _bytes_to_hex_list(b: bytes) -> str:
    # Match HA UI-ish style: "0x4A 0x17 ..."
    return " ".join(f"0x{v:02X}" for v in b)


def _scanning_mode(obj: Any, attr: str) -> Optional[str]:
    """habluetooth's BluetoothScanningMode off a scanner, as a plain string.

    ACTIVE means the radio TRANSMITS — it sends SCAN_REQ and reads the SCAN_RSP
    that comes back, which is where a device puts its complete local name when
    it will not fit in the 31-byte advertisement. PASSIVE only listens. AUTO
    starts passive and is promoted to active on demand, so `current_mode`
    genuinely changes over time.

    Returns "active" / "passive" / "auto", or None when the attribute is absent
    (older habluetooth) or the scanner did not say. None means UNKNOWN and must
    never be presented as passive: not transmitting and not telling us are
    different facts.
    """
    m = getattr(obj, attr, None)
    if m is None:
        return None
    v = getattr(m, "value", None)          # Enum -> its value
    if isinstance(v, str) and v:
        return v.lower()
    try:
        return str(m).rsplit(".", 1)[-1].lower() or None
    except Exception:
        return None


def _coerce_source(src: Any) -> str:
    # src may be a string, list/tuple/set of strings, or None.
    if src is None:
        return ""
    if isinstance(src, str):
        return src
    try:
        # iterable
        for s in src:
            if isinstance(s, str):
                return s
        return ""
    except Exception:
        return str(src)


def _service_info_to_record(si: Any, seen: Optional[dt.datetime] = None) -> Dict[str, Any]:
    seen_dt = seen or getattr(si, "time", None) or getattr(si, "seen", None) or _now()
    if isinstance(seen_dt, (int, float)):
        # Some implementations may use unix seconds.
        seen_dt = dt.datetime.fromtimestamp(float(seen_dt), tz=dt.timezone.utc)
    if isinstance(seen_dt, dt.datetime) and seen_dt.tzinfo is None:
        seen_dt = seen_dt.replace(tzinfo=dt.timezone.utc)

    address = getattr(si, "address", "") or ""
    name = getattr(si, "name", None) or getattr(si, "local_name", None) or ""
    source = _coerce_source(getattr(si, "source", None))

    rssi = getattr(si, "rssi", None)
    if rssi is None:
        adv = getattr(si, "advertisement", None)
        rssi = getattr(adv, "rssi", None) if adv is not None else None

    service_uuids = getattr(si, "service_uuids", None) or getattr(si, "service_uuids", None) or []

    manuf = getattr(si, "manufacturer_data", None)
    if manuf is None:
        adv = getattr(si, "advertisement", None)
        manuf = getattr(adv, "manufacturer_data", None) if adv is not None else None
    if manuf is None:
        manuf = {}

    svcdata = getattr(si, "service_data", None)
    if svcdata is None:
        adv = getattr(si, "advertisement", None)
        svcdata = getattr(adv, "service_data", None) if adv is not None else None
    if svcdata is None:
        svcdata = {}

    manuf_out: Dict[str, str] = {}
    try:
        for k, v in dict(manuf).items():
            if isinstance(v, (bytes, bytearray)):
                manuf_out[str(k)] = _bytes_to_hex_list(bytes(v))
            else:
                manuf_out[str(k)] = str(v)
    except Exception:
        manuf_out = {}

    svc_out: Dict[str, str] = {}
    try:
        for k, v in dict(svcdata).items():
            if isinstance(v, (bytes, bytearray)):
                svc_out[str(k)] = _bytes_to_hex_list(bytes(v))
            else:
                svc_out[str(k)] = str(v)
    except Exception:
        svc_out = {}

    # TX Power Level AD type (0x0A) — device's declared transmit power at 1 m.
    # When present, use this instead of the static ref_power config to improve distance accuracy.
    # ESPresense uses the same approach for automatic per-device calibration.
    tx_power = getattr(si, "tx_power", None)
    if tx_power is None:
        adv = getattr(si, "advertisement", None)
        tx_power = getattr(adv, "tx_power", None) if adv is not None else None

    # Connectable flag — can this device accept BLE connections?
    connectable = getattr(si, "connectable", None)

    return {
        "address": address,
        "name": name or address,
        "source": source,
        "rssi": rssi,
        "tx_power": int(tx_power) if tx_power is not None else None,
        "connectable": bool(connectable) if connectable is not None else None,
        "last_seen": seen_dt.isoformat(),
        # age_s is filled in get_snapshot so it's relative to snapshot time
        "manufacturer_data": manuf_out,
        "service_data": svc_out,
        "service_uuids": list(service_uuids) if isinstance(service_uuids, (list, tuple, set)) else [],
    }


def _service_info_to_record_from_adv(
    addr: str, source: str, rssi: Any,
    ble_device: Any, adv_data: Any, seen: dt.datetime,
) -> Dict[str, Any]:
    """Build a record dict from raw BLEDevice + AdvertisementData (per-scanner)."""
    name = getattr(ble_device, "name", None) or getattr(adv_data, "local_name", None) or ""

    manuf = getattr(adv_data, "manufacturer_data", None) or {}
    manuf_out: Dict[str, str] = {}
    try:
        for k, v in dict(manuf).items():
            if isinstance(v, (bytes, bytearray)):
                manuf_out[str(k)] = _bytes_to_hex_list(bytes(v))
            else:
                manuf_out[str(k)] = str(v)
    except Exception:
        pass

    svcdata = getattr(adv_data, "service_data", None) or {}
    svc_out: Dict[str, str] = {}
    try:
        for k, v in dict(svcdata).items():
            if isinstance(v, (bytes, bytearray)):
                svc_out[str(k)] = _bytes_to_hex_list(bytes(v))
            else:
                svc_out[str(k)] = str(v)
    except Exception:
        pass

    service_uuids = getattr(adv_data, "service_uuids", None) or []
    tx_power = getattr(adv_data, "tx_power", None)

    return {
        "address": str(addr),
        "name": str(name or addr),
        "source": _coerce_source(source),
        "rssi": int(rssi) if rssi is not None else None,
        "tx_power": int(tx_power) if tx_power is not None else None,
        "connectable": None,
        "last_seen": seen.isoformat(),
        "manufacturer_data": manuf_out,
        "service_data": svc_out,
        "service_uuids": list(service_uuids) if isinstance(service_uuids, (list, tuple, set)) else [],
    }


@dataclass
class _Adv:
    record: Dict[str, Any]
    seen: dt.datetime


class BluetoothLive:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        # Keyed as {address: {source: _Adv}} so every radio's reading is kept independently.
        # Previously keyed only by address, which caused the second scanner callback to
        # overwrite the first — meaning only one radio's RSSI ever appeared per device.
        self._seen_by_source: Dict[str, Dict[str, _Adv]] = {}
        # {addr: {source: deque[(seen_dt, rssi)]}} — recent raw samples from
        # REAL callbacks (never the reseed path) for median-of-N filtering.
        self._rssi_samples: Dict[str, Dict[str, Any]] = {}
        self._unsubs: List[Any] = []
        # Per-radio "last heard" timestamp — updated on every callback, independent of filtering.
        # Used by the frontend to show a radio as "listening" even when its ads are old/filtered.
        self._radio_last_heard: Dict[str, dt.datetime] = {}  # source → datetime
        self._last_reseed: Optional[dt.datetime] = None  # periodic reseed for proxy scanners
        # source → last observed scan mode, for counting transitions. Memory
        # only: it exists to answer "does the reported mode actually move?",
        # which cannot be answered from one reading.
        self._last_scan_mode: Dict[str, str] = {}
        # Diagnostics: last seed result
        self.seed_method: str = "none"  # "per_scanner", "deduplicated", "failed"
        self.seed_scanner_count: int = 0
        self.seed_device_readings: int = 0
        self.seed_error: str = ""

    def _note_scan_mode_flips(self, radios: List[Dict[str, Any]]) -> None:
        """Count radios whose live scan mode CHANGED since the last snapshot.

        One reading cannot tell a field that tracks the radio from one that
        echoes a stored setting. Movement can — and the two counters mean
        opposite things:

          auto    a scanner on AUTO is promoted to active in short windows, so
                  flips are expected. Seeing them proves the value is live.
          pinned  HA leaves an explicitly ACTIVE or PASSIVE scanner alone, so
                  flips should be ~0. A fleet where pinned radios keep changing
                  would mean the mode is not under the owner's control there,
                  which is the one result that makes the map indicator
                  dishonest — and it cannot be seen from a single install.

        Counts only, and only when the owner opted in. `bump` is a dict
        increment when on and one lookup when off, so this is safe on the
        snapshot path.
        """
        try:
            from .telemetry import bump  # noqa: PLC0415 - avoids an import cycle
        except Exception:
            return
        for r in radios:
            src = r.get("source") or ""
            mode = r.get("scan_mode")
            if not src or not mode:
                continue          # unknown is not a transition, and never a flip
            prev = self._last_scan_mode.get(src)
            self._last_scan_mode[src] = mode
            if prev is None or prev == mode:
                continue
            req = str(r.get("requested_scan_mode") or "").lower()
            if req == "auto":
                bump(self.hass, "scan_mode_flip_auto")
            else:
                bump(self.hass, "scan_mode_flip_pinned")

    def unload(self) -> None:
        for u in self._unsubs:
            try:
                u()
            except Exception:
                pass
        self._unsubs.clear()
        self._seen_by_source.clear()
        self._rssi_samples.clear()

    @callback
    def _on_adv(self, service_info: Any, change: Any = None) -> None:
        # Store latest reading per {address, source} — preserves all radios' views of a device
        try:
            addr = getattr(service_info, "address", None) or ""
            if not addr:
                return
            seen = _now()
            rec = _service_info_to_record(service_info, seen=seen)
            src = rec.get("source") or "_unknown"
            if addr not in self._seen_by_source:
                self._seen_by_source[addr] = {}
            self._seen_by_source[addr][src] = _Adv(record=rec, seen=seen)
            # Sample history for median-of-N (real callbacks only — the
            # reseed path replays cached readings and must not multiply them)
            _rs = rec.get("rssi")
            if _rs is not None:
                self._rssi_samples.setdefault(addr, {}).setdefault(
                    src, deque(maxlen=32)
                ).append((seen, float(_rs)))
            # Track when each radio last sent us anything (independent of age filtering)
            if src != "_unknown":
                self._radio_last_heard[src] = seen
        except Exception as e:
            _LOGGER.debug("BLE adv parse failed: %s", e)

    def _seed_from_discovered(self) -> None:
        """Populate cache with per-scanner RSSI data from ALL scanners.

        HA's deduplicated APIs (async_discovered_service_info, async_register_callback)
        only return ONE scanner's reading per device.  For indoor positioning we need
        RSSI from EVERY scanner that sees each device.

        Primary method: iterate each scanner's own device cache via the habluetooth
        manager (same pattern Bermuda uses).  Each scanner maintains its own dict of
        discovered devices with per-scanner RSSI — no deduplication.

        Fallback: async_discovered_service_info (deduplicated, only 1 scanner per device).
        """
        try:
            _seeded_scanner = False
            _scanner_count = 0
            _total_ads = 0
            # ── Primary: per-scanner iteration (full RSSI matrix) ──
            try:
                from habluetooth import get_manager as _get_bt_manager  # type: ignore
                manager = _get_bt_manager()
                if manager:
                    seen = _now()
                    _mono_now = time.monotonic()
                    scanners_list = list(manager.async_current_scanners())
                    _scanner_count = len(scanners_list)
                    for scanner in scanners_list:
                        src = getattr(scanner, "source", None)
                        if not src:
                            continue
                        dev_adv = getattr(scanner, "discovered_devices_and_advertisement_data", None)
                        if dev_adv is None:
                            continue
                        # Per-device timestamps of when the scanner ACTUALLY
                        # last heard each device (monotonic, Bermuda-style).
                        # Without them, reseeding would stamp every cached
                        # entry as heard-now, laundering stale readings as
                        # fresh every 30 s for as long as the cache holds them.
                        _stamps = getattr(scanner, "discovered_device_timestamps", None) or {}
                        for ble_device, adv_data in dev_adv.values():
                            addr = getattr(ble_device, "address", None)
                            if not addr:
                                continue
                            rssi = getattr(adv_data, "rssi", None)
                            _stamp = _stamps.get(addr)
                            if _stamp is not None:
                                # Stamps are monotonic; > 1e9 means a unix-epoch
                                # implementation — handle both.
                                if float(_stamp) > 1e9:
                                    _age = max(0.0, time.time() - float(_stamp))
                                else:
                                    _age = max(0.0, _mono_now - float(_stamp))
                                dev_seen = seen - dt.timedelta(seconds=_age)
                            else:
                                # No real timestamp for this device: keep the
                                # existing record's age rather than refreshing
                                # it; only brand-new entries get stamped now.
                                _prev = self._seen_by_source.get(addr, {}).get(str(src))
                                dev_seen = _prev.seen if _prev else seen
                            rec = _service_info_to_record_from_adv(
                                addr, src, rssi, ble_device, adv_data, dev_seen
                            )
                            if addr not in self._seen_by_source:
                                self._seen_by_source[addr] = {}
                            self._seen_by_source[addr][str(src)] = _Adv(record=rec, seen=dev_seen)
                            if str(src) != "_unknown":
                                self._radio_last_heard[str(src)] = seen
                            _total_ads += 1
                    _seeded_scanner = True
                    self.seed_method = "per_scanner"
                    self.seed_scanner_count = _scanner_count
                    self.seed_device_readings = _total_ads
                    self.seed_error = ""
                else:
                    self.seed_error = "get_manager() returned None"
            except ImportError as _imp_err:
                self.seed_error = f"habluetooth import: {_imp_err}"
            except Exception as _mgr_err:
                self.seed_error = f"scanner iteration: {_mgr_err}"

            # ── Fallback: deduplicated API (1 scanner per device) ──
            if not _seeded_scanner:
                self.seed_method = "deduplicated"
                from homeassistant.components import bluetooth  # type: ignore
                if hasattr(bluetooth, "async_discovered_service_info"):
                    infos = bluetooth.async_discovered_service_info(self.hass)
                    for si in infos:
                        self._on_adv(si)
                    try:
                        infos_nc = bluetooth.async_discovered_service_info(
                            self.hass, connectable=False
                        )
                        for si in infos_nc:
                            self._on_adv(si)
                    except TypeError:
                        pass

            self._last_reseed = _now()
        except Exception as e:
            _LOGGER.debug("BLE seed failed: %s", e)

    @property
    def callback_active(self) -> bool:
        """True if at least one BLE callback is registered."""
        return bool(self._unsubs)

    @property
    def unique_address_count(self) -> int:
        return len(self._seen_by_source)

    def clear_scanner(self, source: str) -> int:
        """Remove all cached advertisements from a specific scanner.

        Returns the number of address entries cleaned.
        """
        cleared = 0
        for addr in list(self._seen_by_source):
            if source in self._seen_by_source[addr]:
                del self._seen_by_source[addr][source]
                cleared += 1
                if not self._seen_by_source[addr]:
                    del self._seen_by_source[addr]
        return cleared

    def get_snapshot(self, max_ads: int = 1000, max_age_s: int = 900) -> Dict[str, Any]:
        """Return a lightweight BLE snapshot for the UI.

        radios: active scanners/adapters (local + remote proxies)
        advertisements: recently seen advertisements with RSSI + metadata

        We include a small diagnostics object so the UI can surface why BLE might look empty.
        """
        diag: Dict[str, Any] = {
            "ok": True,
            "seeded": False,
            "callback_active": self.callback_active,
            "adv_cache_size": sum(len(v) for v in self._seen_by_source.values()),
            "unique_cached": self.unique_address_count,
            "errors": [],
        }

        try:
            from homeassistant.components import bluetooth  # type: ignore

            now = _now()
            radios: List[Dict[str, Any]] = []
            try:
                scanners_fn = getattr(bluetooth, "async_current_scanners", None)
                if scanners_fn is not None:
                    scanners = scanners_fn(self.hass)

                    # Some HA versions return dict-like containers.
                    if isinstance(scanners, dict):
                        scanners = scanners.values()

                    for s in scanners:
                        src = getattr(s, "source", None)
                        name = getattr(s, "name", None)
                        connectable = getattr(s, "connectable", None)
                        scanning = getattr(s, "scanning", None)
                        adapter = getattr(s, "adapter", None)
                        # ACTIVE vs PASSIVE scanning — whether the radio
                        # TRANSMITS. An active scanner sends SCAN_REQ and reads
                        # the SCAN_RSP that comes back; a passive one only
                        # listens. This is habluetooth's BluetoothScanningMode
                        # and is NOT `connectable` (which is about opening GATT
                        # connections) and NOT `scanning` (which only says the
                        # scanner is running). Three separate facts.
                        #
                        # AUTO is a real third value: the scanner starts
                        # passive and the manager promotes it to active on
                        # demand, so `current_mode` genuinely changes over
                        # time. current_mode is what it is doing NOW;
                        # requested_mode is what was asked for.
                        cur_mode = _scanning_mode(s, "current_mode")
                        req_mode = _scanning_mode(s, "requested_mode")

                        _radio_src = _coerce_source(src) or ""
                        _lh = self._radio_last_heard.get(_radio_src)
                        _lh_s = round((now - _lh).total_seconds(), 1) if _lh else None
                        radios.append({
                            "source": _radio_src,
                            "name": str(name or ""),
                            "connectable": bool(connectable) if connectable is not None else None,
                            "scanning": bool(scanning) if scanning is not None else None,
                            "scan_mode": cur_mode,
                            "requested_scan_mode": req_mode,
                            "adapter": str(adapter or "") if adapter is not None else "",
                            "last_heard_s": _lh_s,
                        })
                else:
                    # Older HA: we may not be able to list scanners individually.
                    count = None
                    count_fn = getattr(bluetooth, "async_scanner_count", None)
                    if count_fn is not None:
                        try:
                            count = count_fn(self.hass, connectable=True)
                        except TypeError:
                            count = count_fn(self.hass)
                    if isinstance(count, int):
                        radios.append(
                            {
                                "source": "",
                                "name": f"Scanners active: {count} (upgrade HA for per-scanner list)",
                                "connectable": None,
                                "scanning": None,
                                "scan_mode": None,
                                "requested_scan_mode": None,
                                "adapter": "",
                            }
                        )
            except Exception as e:
                diag["ok"] = False
                diag["errors"].append(f"scanner_list_failed: {e!s}")
                radios = []

            # Periodically reseed from HA's discovered-service-info API.
            # This is essential for proxy scanners (Shelly, etc.) whose
            # advertisements arrive via HA's scanner infrastructure but NOT
            # through async_register_callback.  Default 30s; aggressive mode
            # (5s) can be enabled in settings for HA 2026.4+ where habluetooth
            # dedup suppresses repeat callbacks from passive proxies.
            _RESEED_INTERVAL_S = 30
            try:
                from .const import DOMAIN, DATA_SETTINGS
                _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                if _st:
                    _custom = (_st.data or {}).get("ble_reseed_interval_s")
                    if _custom is not None:
                        _RESEED_INTERVAL_S = max(1, min(60, int(_custom)))
                    elif _st.data.get("aggressive_ble_reseed"):
                        _RESEED_INTERVAL_S = 5
            except Exception:
                pass
            _needs_reseed = (
                not self._seen_by_source
                or self._last_reseed is None
                or (now - self._last_reseed).total_seconds() > _RESEED_INTERVAL_S
            )
            if _needs_reseed:
                try:
                    self._seed_from_discovered()
                    diag["seeded"] = True
                except Exception as e:
                    diag["ok"] = False
                    diag["errors"].append(f"seed_failed: {e!s}")

            ads: List[Dict[str, Any]] = []
            # Prune very old entries from cache (>4 hours) to prevent unbounded growth
            # Previously 30 min — too aggressive, caused beacons/tags to vanish
            # from the objects list before users could find/tag them.
            _prune_age = 14400
            _prune_addrs: List[str] = []
            for addr, src_map in self._seen_by_source.items():
                _dead = [s for s, a in src_map.items() if (now - a.seen).total_seconds() > _prune_age]
                for s in _dead:
                    del src_map[s]
                if not src_map:
                    _prune_addrs.append(addr)
            for addr in _prune_addrs:
                del self._seen_by_source[addr]
                self._rssi_samples.pop(addr, None)

            # Collect per-address records, keeping ALL per-source readings for
            # each address.  The max_ads cap applies to unique *addresses* (not
            # total per-source records) so that multiple scanners don't crowd
            # out devices.
            addr_best_age: Dict[str, float] = {}  # addr → best (lowest) age_s
            addr_records: Dict[str, List[Dict[str, Any]]] = {}
            for addr, src_map in self._seen_by_source.items():
                for src, a in src_map.items():
                    age_s = (now - a.seen).total_seconds()
                    if max_age_s and age_s > max_age_s:
                        continue
                    rec = dict(a.record)
                    rec["age_s"] = age_s
                    # Median-of-N: a 1-2 Hz beacon emits many ads per poll
                    # window but the cache keeps only the newest per source.
                    # Report the median of the last 15 s of real samples —
                    # BLE noise is heavy-tailed and the median rejects
                    # multipath fade outliers the single latest ad can't.
                    _sd = self._rssi_samples.get(addr, {}).get(src)
                    if _sd:
                        _fresh = sorted(
                            r for (t, r) in _sd
                            if (now - t).total_seconds() <= 15.0
                        )
                        if len(_fresh) >= 3:
                            _m = len(_fresh) // 2
                            rec["rssi"] = round(
                                _fresh[_m] if len(_fresh) % 2
                                else (_fresh[_m - 1] + _fresh[_m]) / 2.0,
                                1,
                            )
                    addr_records.setdefault(addr, []).append(rec)
                    prev = addr_best_age.get(addr)
                    if prev is None or age_s < prev:
                        addr_best_age[addr] = age_s

            # Cap by unique address count (most recently seen first)
            sorted_addrs = sorted(addr_best_age, key=lambda a: addr_best_age[a])
            if max_ads and len(sorted_addrs) > max_ads:
                sorted_addrs = sorted_addrs[:max_ads]
            kept = set(sorted_addrs)
            for addr in kept:
                ads.extend(addr_records[addr])

            # Sort: most recently seen first
            ads.sort(key=lambda x: x.get("age_s", 1e9))

            # --- Synthetic radios for orphaned sources ---
            # Some scanners (e.g. Shelly BLE proxies) relay advertisements
            # through HA but don't appear in async_current_scanners().  If we
            # see a source in our advertisement cache that has no matching
            # radio entry, create a synthetic one so it shows up in the
            # scanner list, calibration UI, and everywhere else.
            known_sources = {r["source"] for r in radios if r.get("source")}
            orphan_sources: Dict[str, dt.datetime] = {}  # source → latest seen
            for src_map in self._seen_by_source.values():
                for src, adv_obj in src_map.items():
                    if src and src != "_unknown" and src not in known_sources:
                        prev = orphan_sources.get(src)
                        if prev is None or adv_obj.seen > prev:
                            orphan_sources[src] = adv_obj.seen
            for src, last_seen in orphan_sources.items():
                _lh_s = round((now - last_seen).total_seconds(), 1)
                radios.append({
                    "source": src,
                    "name": src,  # best-effort; enrichment in websocket.py adds device name
                    "connectable": False,
                    "scanning": True,
                    "scan_mode": None,
                    "requested_scan_mode": None,
                    "adapter": "",
                    "last_heard_s": _lh_s,
                })
            if orphan_sources:
                diag["synthetic_radios"] = len(orphan_sources)

            diag["adv_cache_size"] = sum(len(v) for v in self._seen_by_source.values())
            diag["unique_addresses"] = len(addr_best_age)
            diag["unique_after_cap"] = len(kept)
            self._note_scan_mode_flips(radios)

            return {
                "radios": radios,
                "advertisements": ads,
                "diag": diag,
            }
        except Exception as e:
            _LOGGER.debug("BLE snapshot failed: %s", e)
            return {"radios": [], "advertisements": [], "diag": {"ok": False, "errors": [str(e)]}}
DATA_KEY = "bluetooth_live"


async def async_setup_bluetooth_live(hass: HomeAssistant) -> BluetoothLive:
    """Create + register BLE callbacks."""
    bl = BluetoothLive(hass)

    try:
        from homeassistant.components import bluetooth  # type: ignore

        # Register callbacks without filters to capture all advertisements.
        # We need BOTH ACTIVE (connectable scanners) and PASSIVE (non-connectable
        # scanners like Shelly BLE proxies) to see ads from all scanner types.
        mode_enum = getattr(bluetooth, "BluetoothScanningMode", None)
        active_mode = mode_enum.ACTIVE if mode_enum is not None else None
        passive_mode = getattr(mode_enum, "PASSIVE", None) if mode_enum is not None else None

        def _register_cb(mode):
            try:
                if mode is not None:
                    return bluetooth.async_register_callback(hass, bl._on_adv, {}, mode)
                else:
                    return bluetooth.async_register_callback(hass, bl._on_adv, {})
            except TypeError:
                try:
                    return bluetooth.async_register_callback(hass, bl._on_adv)
                except TypeError:
                    try:
                        return bluetooth.async_register_callback(hass, bl._on_adv, matcher={})
                    except Exception:
                        return None

        # Register for connectable (ACTIVE) scanner advertisements
        unsub = _register_cb(active_mode)
        if unsub:
            bl._unsubs.append(unsub)

        # Register for non-connectable (PASSIVE) scanner advertisements
        # (Shelly BLE proxies, other passive relay scanners)
        if passive_mode is not None:
            unsub2 = _register_cb(passive_mode)
            if unsub2:
                bl._unsubs.append(unsub2)

        # Seed once on startup so UI isn't empty while we wait for callbacks.
        bl._seed_from_discovered()

    except Exception as e:
        _LOGGER.debug("Bluetooth callbacks not available: %s", e)

    hass.data.setdefault("padspan_ha", {})[DATA_KEY] = bl
    return bl


def get_bluetooth_live(hass: HomeAssistant) -> Optional[BluetoothLive]:
    return hass.data.get("padspan_ha", {}).get(DATA_KEY)
