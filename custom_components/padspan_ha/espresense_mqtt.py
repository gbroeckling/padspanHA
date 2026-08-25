"""ESPresense MQTT ingestion for PadSpan HA (EXPERIMENTAL).

Subscribes to ESPresense MQTT topics and maintains an in-memory cache of
BLE advertisements from ESPresense scanner nodes.  Output format matches
bluetooth_live.py so data merges seamlessly into the live snapshot pipeline.

Off by default — enable via Settings → Manage → ESPresense MQTT.

ESPresense MQTT topic structure (prefix default: "espresense"):
  espresense/devices/{device_id}/{node_id}    — per-device, per-scanner reading
  espresense/rooms/{node_id}/status           — online/offline (LWT, retained)
  espresense/rooms/{node_id}/telemetry        — IP, firmware, uptime (non-retained, every 15s)
  espresense/rooms/{node_id}/name             — human-readable room name (retained)

CRITICAL: each ESPresense node publishes to a DIFFERENT topic for the same device.
  espresense/devices/irk:abc123/living-room   ← from living-room scanner
  espresense/devices/irk:abc123/bedroom       ← from bedroom scanner
The node_id (scanner identity) is ONLY in the topic path, NOT in the JSON payload.

ESPresense encodes rssi, distance, var as JSON STRINGS ("−72.35"), not numbers.
MAC addresses are lowercase 12-char hex without separators ("aabbccddeeff").
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List

from homeassistant.core import HomeAssistant

from .const import DATA_ESPRESENSE_MQTT, DATA_SETTINGS, DOMAIN

_LOGGER = logging.getLogger(__name__)
_PRUNE_AGE_S = 14400  # 4 hours — same as bluetooth_live


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _normalize_mac(raw: str) -> str:
    """Convert ESPresense MAC (aabbccddeeff) to HA format (AA:BB:CC:DD:EE:FF)."""
    clean = re.sub(r"[^0-9a-fA-F]", "", raw)
    if len(clean) == 12:
        return ":".join(clean[i:i+2] for i in range(0, 12, 2)).upper()
    return raw.upper()


def _parse_float(val: Any) -> float | None:
    """Parse ESPresense numeric fields (encoded as JSON strings)."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


@dataclass
class _EspAdv:
    """Cached advertisement from an ESPresense node."""
    address: str        # normalized MAC (AA:BB:CC:DD:EE:FF)
    device_id: str      # ESPresense resolved ID (irk:..., iBeacon:..., etc.)
    name: str
    rssi: float | None
    distance: float | None
    ref_rssi: int | None  # rssi@1m calibrated reference
    source: str           # "espresense_{node_id}"
    seen: dt.datetime
    raw: dict = field(default_factory=dict)


@dataclass
class _EspScanner:
    """Cached ESPresense scanner (room/node) info."""
    node_id: str         # slugified name from topic (e.g., "living-room")
    room_name: str       # human-readable name (e.g., "Living Room"), or node_id as fallback
    source: str          # "espresense_{node_id}"
    online: bool = True
    ip: str = ""
    firmware: str = ""
    uptime: int = 0
    device_count: int = 0
    last_seen: dt.datetime = field(default_factory=_now)


class EspresenseMqtt:
    """Subscribe to ESPresense MQTT topics and cache BLE advertisements."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsubs: list[Callable] = []
        self._prefix = "espresense"

        # Cache: {address: {source: _EspAdv}}
        self._seen: Dict[str, Dict[str, _EspAdv]] = {}
        # Scanners: {node_id: _EspScanner}
        self._scanners: Dict[str, _EspScanner] = {}

    async def async_start(self, topic_prefix: str = "espresense") -> None:
        """Subscribe to ESPresense MQTT topics."""
        self._prefix = topic_prefix.strip().rstrip("/")
        try:
            from homeassistant.components.mqtt import async_subscribe  # type: ignore
        except ImportError:
            _LOGGER.warning("MQTT integration not available — ESPresense ingestion disabled")
            return

        # espresense/devices/{device_id}/{node_id} — BLE advertisement data
        await self._sub(async_subscribe, f"{self._prefix}/devices/#", self._on_device_message)
        # espresense/rooms/{node_id}/# — status, telemetry, name, settings
        await self._sub(async_subscribe, f"{self._prefix}/rooms/#", self._on_room_message)

    async def _sub(self, subscribe_fn, topic, callback) -> None:
        """Subscribe to a topic with error handling."""
        try:
            unsub = await subscribe_fn(self.hass, topic, callback, qos=0)
            self._unsubs.append(unsub)
            _LOGGER.info("ESPresense MQTT: subscribed to %s", topic)
        except Exception as e:
            _LOGGER.error("ESPresense MQTT: subscribe failed for %s: %s", topic, e)

    async def async_stop(self) -> None:
        """Unsubscribe from all MQTT topics."""
        for unsub in self._unsubs:
            try:
                unsub()
            except Exception:
                pass
        self._unsubs.clear()
        self._seen.clear()
        self._scanners.clear()
        _LOGGER.info("ESPresense MQTT: stopped")

    # ── MQTT Callbacks (must be fast — just cache, no async work) ─────────

    def _on_device_message(self, msg) -> None:
        """Handle espresense/devices/{device_id}/{node_id}.

        Topic structure: {prefix}/devices/{device_id}/{node_id}
        - device_id: ESPresense resolved ID (irk:xxx, iBeacon:xxx, name:xxx, etc.)
        - node_id: slugified room name of the scanner node (from topic, NOT payload)

        Payload fields (key ones):
        - mac: raw 12-char lowercase hex ("aabbccddeeff")
        - id: resolved device identifier string
        - name: friendly name (optional)
        - rssi: filtered RSSI (JSON STRING, e.g., "-72.35")
        - distance: estimated distance in metres (JSON STRING)
        - rssi@1m: calibrated 1m reference RSSI (integer)
        """
        try:
            topic = msg.topic
            payload = msg.payload
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8", errors="replace")

            # Parse topic: {prefix}/devices/{device_id}/{node_id}
            parts = topic.split("/")
            prefix_depth = len(self._prefix.split("/"))
            # Need at least: prefix + "devices" + device_id + node_id = prefix_depth + 3
            if len(parts) < prefix_depth + 3:
                return  # missing node_id — can't determine which scanner
            device_id = parts[prefix_depth + 1]
            node_id = parts[prefix_depth + 2]

            if not device_id or not node_id:
                return

            data = json.loads(payload) if isinstance(payload, str) else {}
            if not isinstance(data, dict):
                return

            # Extract and parse fields (rssi/distance are JSON strings, not numbers)
            rssi = _parse_float(data.get("rssi"))
            distance = _parse_float(data.get("distance"))

            if rssi is None and distance is None:
                return  # no useful data

            # Normalize MAC: ESPresense uses lowercase hex without separators
            raw_mac = str(data.get("mac") or "")
            address = _normalize_mac(raw_mac) if raw_mac else device_id.upper()

            esp_id = str(data.get("id") or device_id)
            name = str(data.get("name") or esp_id)
            ref_rssi = data.get("rssi@1m")

            source = f"espresense_{node_id}"
            now = _now()

            # Register/update scanner
            if node_id not in self._scanners:
                self._scanners[node_id] = _EspScanner(
                    node_id=node_id, room_name=node_id, source=source, last_seen=now
                )
            sc = self._scanners[node_id]
            sc.last_seen = now
            sc.online = True

            # Cache the advertisement (keyed by address + source for multi-scanner)
            adv = _EspAdv(
                address=address,
                device_id=esp_id,
                name=name,
                rssi=rssi,
                distance=distance,
                ref_rssi=int(ref_rssi) if ref_rssi is not None else None,
                source=source,
                seen=now,
                raw=data,
            )
            self._seen.setdefault(address, {})[source] = adv

        except Exception:
            pass  # fast path — never block MQTT thread

    def _on_room_message(self, msg) -> None:
        """Handle espresense/rooms/{node_id}/{sub_topic}.

        Sub-topics:
        - status: "online" or "offline" (LWT, retained)
        - name: human-readable room name (retained)
        - telemetry: JSON with ip, uptime, ver, count, etc. (non-retained)
        - Other settings: max_distance, absorption, tx_ref_rssi, etc.
        """
        try:
            topic = msg.topic
            payload = msg.payload
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8", errors="replace")

            parts = topic.split("/")
            prefix_depth = len(self._prefix.split("/"))
            if len(parts) < prefix_depth + 2:
                return
            node_id = parts[prefix_depth + 1]
            sub = parts[prefix_depth + 2] if len(parts) > prefix_depth + 2 else None
            source = f"espresense_{node_id}"
            now = _now()

            if node_id not in self._scanners:
                self._scanners[node_id] = _EspScanner(
                    node_id=node_id, room_name=node_id, source=source, last_seen=now
                )

            sc = self._scanners[node_id]
            sc.last_seen = now

            if sub == "status":
                sc.online = (payload.strip().lower() in ("online", "1", "true"))
            elif sub == "name":
                # Human-readable room name (retained)
                name = payload.strip()
                if name:
                    sc.room_name = name
            elif sub == "telemetry":
                try:
                    data = json.loads(payload) if isinstance(payload, str) else {}
                    if isinstance(data, dict):
                        sc.ip = str(data.get("ip") or sc.ip)
                        sc.firmware = str(data.get("ver") or data.get("firm") or sc.firmware)
                        sc.uptime = int(data.get("uptime") or sc.uptime)
                        sc.device_count = int(data.get("count") or data.get("reported") or sc.device_count)
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass
        except Exception:
            pass

    # ── Snapshot (called from _live_snapshot) ─────────────────────────────

    def get_snapshot(self, max_age_s: int = 900) -> Dict[str, Any]:
        """Return BLE snapshot matching bluetooth_live.py format."""
        now = _now()

        # Prune stale entries
        prune_addrs = []
        for addr, src_map in self._seen.items():
            dead = [s for s, a in src_map.items() if (now - a.seen).total_seconds() > _PRUNE_AGE_S]
            for s in dead:
                del src_map[s]
            if not src_map:
                prune_addrs.append(addr)
        for addr in prune_addrs:
            del self._seen[addr]

        # Build radios list
        radios: List[Dict[str, Any]] = []
        for node_id, sc in self._scanners.items():
            age_s = round((now - sc.last_seen).total_seconds(), 1)
            # Count active devices for this scanner
            dev_count = sum(
                1 for src_map in self._seen.values()
                if sc.source in src_map and (now - src_map[sc.source].seen).total_seconds() < max_age_s
            )
            radios.append({
                "source": sc.source,
                "name": f"{sc.room_name} (ESPresense)",
                "connectable": False,
                # ESPresense does not report its BLE scan mode over MQTT, and
                # unknown must not be rendered as passive.
                "scan_mode": None,
                "requested_scan_mode": None,
                "scanning": sc.online,
                "adapter": "mqtt",
                "last_heard_s": age_s,
                "device_count": dev_count,
                "espresense": True,
                "espresense_node_id": node_id,
                "espresense_room": sc.room_name,
                "ip": sc.ip,
                "firmware": sc.firmware,
            })

        # Build advertisements list
        ads: List[Dict[str, Any]] = []
        for addr, src_map in self._seen.items():
            for source, adv in src_map.items():
                age_s = (now - adv.seen).total_seconds()
                if max_age_s and age_s > max_age_s:
                    continue
                rec = {
                    "address": adv.address,
                    "name": adv.name,
                    "source": adv.source,
                    "rssi": round(adv.rssi) if adv.rssi is not None else None,
                    "tx_power": adv.ref_rssi,  # rssi@1m maps to tx_power for path-loss model
                    "connectable": None,
                    "last_seen": adv.seen.isoformat(),
                    "age_s": round(age_s, 1),
                    "manufacturer_data": {},
                    "service_data": {},
                    "service_uuids": [],
                }
                if adv.distance is not None:
                    rec["espresense_distance"] = round(adv.distance, 2)
                if adv.device_id:
                    rec["espresense_id"] = adv.device_id
                ads.append(rec)

        ads.sort(key=lambda x: x.get("age_s", 1e9))

        return {
            "radios": radios,
            "advertisements": ads,
            "diag": {
                "ok": bool(self._scanners),
                "source": "espresense_mqtt",
                "scanners": len(self._scanners),
                "online": sum(1 for s in self._scanners.values() if s.online),
                "cached_devices": len(self._seen),
                "cached_readings": sum(len(v) for v in self._seen.values()),
            },
        }

    @property
    def scanner_count(self) -> int:
        return len(self._scanners)

    @property
    def online_count(self) -> int:
        return sum(1 for s in self._scanners.values() if s.online)


async def async_setup_espresense_mqtt(hass: HomeAssistant, topic_prefix: str = "espresense") -> EspresenseMqtt:
    """Create and start the ESPresense MQTT subscriber."""
    esp = EspresenseMqtt(hass)
    await esp.async_start(topic_prefix)
    hass.data.setdefault(DOMAIN, {})[DATA_ESPRESENSE_MQTT] = esp
    return esp
