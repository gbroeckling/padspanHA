from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from .bluetooth import BluetoothIngestor, SeenDevice
from .const import (
    CONF_SESSION_DURATION_S,
    DEFAULT_SESSION_DURATION_S,
)

_LOGGER = logging.getLogger(__name__)

STORE_VERSION = 1
STORE_KEY = "padspan_store_v1"


class PadSpanCoordinator:
    """Owns BLE ingest, in-memory state, and discovery session state."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry):
        self.hass = hass
        self.entry = entry
        self.ingestor = BluetoothIngestor(hass, self._on_ble)
        self.seen: dict[str, SeenDevice] = {}
        self.last_service_info: Any | None = None

        # discovery session
        self.discovery_active: bool = False
        self.discovery_started: datetime | None = None
        self.discovery_stopped: datetime | None = None

        self.store = Store(hass, STORE_VERSION, STORE_KEY)

    async def async_start(self):
        await self._load()
        await self.ingestor.start()
        self._register_services()

    async def async_stop(self):
        await self.ingestor.stop()
        await self._save()

    def _session_duration_s(self) -> int:
        return int(
            self.entry.options.get(
                CONF_SESSION_DURATION_S,
                self.entry.data.get(CONF_SESSION_DURATION_S, DEFAULT_SESSION_DURATION_S),
            )
        )

    async def _load(self):
        data = await self.store.async_load()
        if not data:
            return
        # restore nothing critical for now; keep store for future expansion
        _LOGGER.debug("PadSpan store loaded: keys=%s", list(data.keys()))

    async def _save(self):
        await self.store.async_save(
            {
                "updated": datetime.now(timezone.utc).isoformat(),
                "note": "Prototype store (future: maps, devices, ratings).",
            }
        )

    @callback
    def _on_ble(self, service_info):
        self.last_service_info = service_info
        addr = getattr(service_info, "address", None)
        if not addr:
            return

        name = getattr(service_info, "name", None)
        rssi = getattr(service_info, "rssi", None)

        dev = self.seen.get(addr)
        if dev is None:
            dev = SeenDevice(address=addr)
            self.seen[addr] = dev
        dev.update(name=name, rssi=rssi)

        # Auto-stop discovery session if time elapsed
        if self.discovery_active and self.discovery_started:
            if datetime.now(timezone.utc) - self.discovery_started > timedelta(seconds=self._session_duration_s()):
                self._stop_discovery()

        # Notify sensors to update
        self.hass.bus.async_fire("padspan_update")

    def _start_discovery(self):
        self.discovery_active = True
        self.discovery_started = datetime.now(timezone.utc)
        self.discovery_stopped = None

    def _stop_discovery(self):
        self.discovery_active = False
        self.discovery_stopped = datetime.now(timezone.utc)

    def discovery_candidates(self, limit: int = 10) -> list[dict[str, Any]]:
        """Prototype candidate list: ranks by 'activity' during session."""
        items = list(self.seen.values())

        # simple heuristic: prefer devices with more packets and larger RSSI span (movement)
        def score(d: SeenDevice) -> float:
            span = 0 if (d.rssi_min is None or d.rssi_max is None) else abs(d.rssi_max - d.rssi_min)
            last = d.last_seen.timestamp() if d.last_seen else 0
            return (d.count * 0.7) + (span * 1.2) + (last * 1e-6)

        ranked = sorted(items, key=score, reverse=True)[:limit]
        out: list[dict[str, Any]] = []
        for d in ranked:
            out.append(
                {
                    "label": d.name or "Unknown device",
                    "address": d.address,  # UI should hide this; kept for internal binding
                    "packets": d.count,
                    "rssi_last": d.last_rssi,
                    "rssi_min": d.rssi_min,
                    "rssi_max": d.rssi_max,
                    "last_seen": d.last_seen.isoformat() if d.last_seen else None,
                }
            )
        return out

    def _register_services(self):
        async def svc_start(_call):
            self._start_discovery()
            self.hass.bus.async_fire("padspan_update")

        async def svc_stop(_call):
            self._stop_discovery()
            self.hass.bus.async_fire("padspan_update")

        async def svc_clear(_call):
            self.seen = {}
            self.last_service_info = None
            self.hass.bus.async_fire("padspan_update")

        self.hass.services.async_register("padspan", "start_discovery_session", svc_start)
        self.hass.services.async_register("padspan", "stop_discovery_session", svc_stop)
        self.hass.services.async_register("padspan", "clear_seen_devices", svc_clear)
