from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from homeassistant.components import bluetooth
from homeassistant.core import HomeAssistant, callback

_LOGGER = logging.getLogger(__name__)


@dataclass
class SeenDevice:
    address: str
    name: str | None = None
    last_rssi: int | None = None
    last_seen: datetime | None = None
    count: int = 0
    # simple rolling stats for discovery (prototype)
    rssi_min: int | None = None
    rssi_max: int | None = None

    def update(self, name: str | None, rssi: int | None):
        self.count += 1
        if name:
            self.name = name
        if rssi is not None:
            self.last_rssi = int(rssi)
            self.rssi_min = int(rssi) if self.rssi_min is None else min(self.rssi_min, int(rssi))
            self.rssi_max = int(rssi) if self.rssi_max is None else max(self.rssi_max, int(rssi))
        self.last_seen = datetime.now(timezone.utc)


class BluetoothIngestor:
    def __init__(self, hass: HomeAssistant, on_update_cb):
        self.hass = hass
        self._unsub = None
        self.on_update_cb = on_update_cb

    async def start(self):
        @callback
        def _callback(service_info: bluetooth.BluetoothServiceInfoBleak, change: bluetooth.BluetoothChange):
            # service_info includes address, name, rssi, manufacturer_data, service_uuids, etc.
            try:
                self.on_update_cb(service_info)
            except Exception:  # pragma: no cover
                _LOGGER.exception("PadSpan BLE callback error")

        # Listen to all BLE advertisements that HA sees
        self._unsub = bluetooth.async_register_callback(
            self.hass,
            _callback,
            bluetooth.BluetoothScanningMode.ACTIVE,
            bluetooth.BluetoothCallbackMatcher(),
        )

    async def stop(self):
        if self._unsub:
            self._unsub()
            self._unsub = None
