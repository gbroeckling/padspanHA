from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Deque, Dict, Optional, Set, Callable

from homeassistant.components import bluetooth
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

from .bluetooth import PadSpanBluetoothIngestor
from .const import CONF_SCANNING_MODE, CONF_MANUFACTURER_ID, DEFAULT_SCANNING_MODE

_LOGGER = logging.getLogger(__name__)


@dataclass
class PadSpanStats:
    packets_last_60s: int = 0
    unique_last_60s: int = 0
    packets_last_5m: int = 0
    unique_last_5m: int = 0
    packets_today: int = 0
    unique_today: int = 0
    last_seen_address: Optional[str] = None
    last_seen_rssi: Optional[int] = None
    last_seen_name: Optional[str] = None
    last_seen_time: Optional[str] = None


class PadSpanCoordinator:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.stats = PadSpanStats()

        self._events_60s: Deque[datetime] = deque()
        self._events_5m: Deque[datetime] = deque()
        self._addr_last_60s: Dict[str, datetime] = {}
        self._addr_last_5m: Dict[str, datetime] = {}
        self._today: date = datetime.now(timezone.utc).date()
        self._addr_today: Set[str] = set()

        self._listeners = set()
        self._unsub_tick = None

        opts = dict(entry.options)
        data = dict(entry.data)
        self._manufacturer_id: Optional[int] = opts.get(CONF_MANUFACTURER_ID, data.get(CONF_MANUFACTURER_ID))
        mode = opts.get(CONF_SCANNING_MODE, data.get(CONF_SCANNING_MODE, DEFAULT_SCANNING_MODE))
        scanning_mode = bluetooth.BluetoothScanningMode.ACTIVE if mode == "active" else bluetooth.BluetoothScanningMode.PASSIVE

        self.ingestor = PadSpanBluetoothIngestor(
            hass,
            self._handle_advertisement,
            match_dict={},
            scanning_mode=scanning_mode,
        )

    async def async_start(self) -> None:
        await self.ingestor.start()
        if self._unsub_tick is None:
            self._unsub_tick = async_track_time_interval(self.hass, self._async_tick, timedelta(seconds=5))
        self._recompute()

    async def async_stop(self) -> None:
        if self._unsub_tick:
            self._unsub_tick()
            self._unsub_tick = None
        await self.ingestor.stop()

    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        def _unsub():
            self._listeners.discard(listener)
        return _unsub

    def _notify(self) -> None:
        for l in list(self._listeners):
            try:
                l()
            except Exception:
                _LOGGER.exception("PadSpan listener error")

    @callback
    def _handle_advertisement(self, service_info: bluetooth.BluetoothServiceInfoBleak, change: bluetooth.BluetoothChange) -> None:
        now = datetime.now(timezone.utc)

        if self._manufacturer_id is not None:
            md = service_info.manufacturer_data or {}
            if self._manufacturer_id not in md:
                return

        self._events_60s.append(now)
        self._events_5m.append(now)

        if service_info.address:
            self._addr_last_60s[service_info.address] = now
            self._addr_last_5m[service_info.address] = now
            self._addr_today.add(service_info.address)

        self._roll_day_if_needed(now.date())
        self.stats.packets_today += 1
        self.stats.unique_today = len(self._addr_today)

        self.stats.last_seen_address = service_info.address
        self.stats.last_seen_rssi = service_info.rssi
        self.stats.last_seen_name = getattr(service_info, "name", None)
        self.stats.last_seen_time = now.isoformat()

    @callback
    def _async_tick(self, _now) -> None:
        self._recompute()
        self._notify()

    def _roll_day_if_needed(self, d: date) -> None:
        if d == self._today:
            return
        self._today = d
        self.stats.packets_today = 0
        self._addr_today.clear()
        self.stats.unique_today = 0

    def _recompute(self) -> None:
        now = datetime.now(timezone.utc)
        cutoff_60 = now - timedelta(seconds=60)
        cutoff_5m = now - timedelta(minutes=5)

        while self._events_60s and self._events_60s[0] < cutoff_60:
            self._events_60s.popleft()
        while self._events_5m and self._events_5m[0] < cutoff_5m:
            self._events_5m.popleft()

        self._addr_last_60s = {k: v for k, v in self._addr_last_60s.items() if v >= cutoff_60}
        self._addr_last_5m = {k: v for k, v in self._addr_last_5m.items() if v >= cutoff_5m}

        self.stats.packets_last_60s = len(self._events_60s)
        self.stats.unique_last_60s = len(self._addr_last_60s)
        self.stats.packets_last_5m = len(self._events_5m)
        self.stats.unique_last_5m = len(self._addr_last_5m)

        self._roll_day_if_needed(now.date())
        self.stats.unique_today = len(self._addr_today)
