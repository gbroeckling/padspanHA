"""Tasmota BLE over MQTT, for PadSpan HA (EXPERIMENTAL).

Tasmota on an ESP32 (a Sonoff Dual R3, a smart plug) scans for Bluetooth and
publishes what it hears over MQTT. Switched on, PadSpan reads that the way it
reads ESPresense: each Tasmota device is a scanner, each address it lists is
a reading. Output matches bluetooth_live.py, so it merges into the live
snapshot. Off by default - Settings → Manage → Tasmota BLE.

Default Tasmota topics (FullTopic %prefix%/%topic%/):
  stat/<topic>/BLE   {"Time": ..., "BLEDevices": {"total": 2,
                       "4A9EBAAAAAAA": {"i": 0, "r": -87},
                       "D0C24BBBBBBB": {"i": 1, "n": "Some TV", "r": -76}}}
  tele/<topic>/BLE   {"Time": ..., "BLE": {"scans": .., "adverts": .., "devices": 2, ..}}

The device list comes every TelePeriod (300 s by default), on tele/ (and
stat/ when asked). A tester found it stopped after a reboot until
`cmnd/<topic>/BLEDevices` was sent, so when a device reports its scan counts
but no list, PadSpan sends that (at most once every 15 minutes per device).

A reading is as old as the message it came in, and Tasmota keeps listing a
device for BLEMaxAge (600 s by default) after it was last heard, with its
last RSSI. For room presence, on each Tasmota:
  TelePeriod 10      positioning ignores readings older than 3 polls (15 s)
  BLEMaxAge 30       a device that left stops being listed within 30 s
  BLEAddrFilter 1    the default drops random addresses: phones, AirTags, tags
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List

from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

DATA_TASMOTA_BLE = "tasmota_ble"
_PRUNE_AGE_S = 14400          # 4 h, as bluetooth_live and ESPresense
_MAX_ADDRS = 5000             # a device near a busy street lists a lot
_REQUEST_EVERY_S = 900        # cmnd/<topic>/BLEDevices, per device
_HEX12 = re.compile(r"^[0-9A-Fa-f]{12}$")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _mac(raw: str) -> str | None:
    """Tasmota's 12-hex key ("4A9EBAAAAAAA") as AA:BB:CC:DD:EE:FF; None if
    the key is not an address (e.g. "total")."""
    if not isinstance(raw, str) or not _HEX12.match(raw):
        return None
    raw = raw.upper()
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2))


@dataclass
class _Reading:
    address: str
    name: str
    rssi: float
    source: str
    seen: dt.datetime


@dataclass
class _Scanner:
    topic: str
    source: str
    last_seen: dt.datetime = field(default_factory=_now)
    last_list: dt.datetime | None = None
    last_request: dt.datetime | None = None
    reported_devices: int = 0


class TasmotaBle:
    """Subscribe to Tasmota BLE topics and cache readings."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsubs: list[Callable] = []
        self._seen: Dict[str, Dict[str, _Reading]] = {}     # address -> source -> reading
        self._scanners: Dict[str, _Scanner] = {}            # topic -> scanner
        self.cache_age_s: float = _PRUNE_AGE_S
        self.max_addrs: int = _MAX_ADDRS          # low-memory mode lowers it

    async def async_start(self) -> None:
        try:
            from homeassistant.components.mqtt import async_subscribe  # type: ignore
        except ImportError:
            _LOGGER.warning("MQTT integration not available — Tasmota BLE disabled")
            return
        for topic in ("stat/+/BLE", "tele/+/BLE"):
            try:
                self._unsubs.append(await async_subscribe(self.hass, topic, self._on_message, qos=0))
                _LOGGER.info("Tasmota BLE: subscribed to %s", topic)
            except Exception as err:  # noqa: BLE001
                _LOGGER.error("Tasmota BLE: subscribe failed for %s: %s", topic, err)

    async def async_stop(self) -> None:
        for unsub in self._unsubs:
            try:
                unsub()
            except Exception:  # noqa: BLE001
                pass
        self._unsubs.clear()
        self._seen.clear()
        self._scanners.clear()

    # ── MQTT (on the event loop: @callback, as ESPresense) ───────────────

    @callback
    def _on_message(self, msg) -> None:
        try:
            parts = str(msg.topic).split("/")
            if len(parts) != 3 or parts[2] != "BLE" or not parts[1]:
                return
            topic = parts[1]
            payload = msg.payload.decode("utf-8", "replace") if isinstance(msg.payload, bytes) else msg.payload
            data = json.loads(payload) if isinstance(payload, str) else None
            if not isinstance(data, dict):
                return
            self.handle(topic, data, _now())
        except Exception:  # noqa: BLE001 - one bad message never stops the rest
            pass

    def handle(self, topic: str, data: dict[str, Any], now: dt.datetime) -> None:
        """One message from one Tasmota device (separate from the MQTT
        callback so it can be tested without a broker)."""
        sc = self._scanners.get(topic)
        if sc is None:
            sc = self._scanners[topic] = _Scanner(topic=topic, source=f"tasmota_{topic}", last_seen=now)
        sc.last_seen = now
        devices = data.get("BLEDevices")
        if isinstance(devices, dict):
            sc.last_list = now
            n = 0
            for key, rec in devices.items():
                addr = _mac(key)
                if addr is None or not isinstance(rec, dict):
                    continue
                rssi = rec.get("r")
                if not isinstance(rssi, (int, float)) or isinstance(rssi, bool):
                    continue
                n += 1
                self._seen.setdefault(addr, {})[sc.source] = _Reading(
                    address=addr, name=str(rec.get("n") or ""), rssi=float(rssi),
                    source=sc.source, seen=now)
            sc.reported_devices = n
            self._cap()
        elif isinstance(data.get("BLE"), dict):
            # Scan counts but no list: after a reboot the list only starts
            # once asked for.
            self._maybe_request(sc, now)

    def _maybe_request(self, sc: _Scanner, now: dt.datetime) -> None:
        if sc.last_list is not None and (now - sc.last_list).total_seconds() < _REQUEST_EVERY_S:
            return
        if sc.last_request is not None and (now - sc.last_request).total_seconds() < _REQUEST_EVERY_S:
            return
        sc.last_request = now
        try:
            from homeassistant.components.mqtt import async_publish  # type: ignore
            self.hass.async_create_task(async_publish(self.hass, f"cmnd/{sc.topic}/BLEDevices", ""))
            _LOGGER.debug("Tasmota BLE: asked %s for its device list", sc.topic)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Tasmota BLE: could not ask %s for its list: %s", sc.topic, err)

    def _cap(self) -> None:
        cap = self.max_addrs
        if len(self._seen) <= cap:
            return
        oldest_first = sorted(self._seen, key=lambda a: max(r.seen for r in self._seen[a].values()))
        for addr in oldest_first[: len(self._seen) - cap]:
            del self._seen[addr]

    # ── Snapshot ─────────────────────────────────────────────────────────

    def get_snapshot(self, max_age_s: float = 900) -> Dict[str, Any]:
        now = _now()
        for addr in list(self._seen):
            src = self._seen[addr]
            for s in [s for s, r in src.items() if (now - r.seen).total_seconds() > self.cache_age_s]:
                del src[s]
            if not src:
                del self._seen[addr]

        radios: List[Dict[str, Any]] = []
        for topic, sc in self._scanners.items():
            heard = round((now - sc.last_seen).total_seconds(), 1)
            radios.append({
                "source": sc.source,
                "name": f"{topic} (Tasmota)",
                "connectable": False,
                "scan_mode": None,
                "requested_scan_mode": None,
                # Listening if it reported within two default TelePeriods.
                "scanning": heard < 600,
                "adapter": "mqtt",
                "last_heard_s": heard,
                "device_count": sc.reported_devices,
                "tasmota": True,
                "tasmota_topic": topic,
            })

        ads: List[Dict[str, Any]] = []
        for addr, src in self._seen.items():
            for source, r in src.items():
                age = (now - r.seen).total_seconds()
                if max_age_s and age > max_age_s:
                    continue
                ads.append({
                    "address": r.address, "name": r.name, "source": source,
                    "rssi": round(r.rssi), "tx_power": None, "connectable": None,
                    "last_seen": r.seen.isoformat(), "age_s": round(age, 1),
                    "manufacturer_data": {}, "service_data": {}, "service_uuids": [],
                })
        ads.sort(key=lambda x: x.get("age_s", 1e9))
        return {
            "radios": radios,
            "advertisements": ads,
            "diag": {"ok": bool(self._scanners), "source": "tasmota_ble",
                     "scanners": len(self._scanners), "cached_devices": len(self._seen)},
        }


async def async_setup_tasmota_ble(hass: HomeAssistant) -> TasmotaBle:
    tb = TasmotaBle(hass)
    await tb.async_start()
    # Switched off while it was subscribing: nothing to register.
    from .const import DATA_SETTINGS  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st is not None and not (st.data or {}).get("tasmota_ble_enabled"):
        await tb.async_stop()
        return tb
    hass.data.setdefault(DOMAIN, {})[DATA_TASMOTA_BLE] = tb
    return tb
