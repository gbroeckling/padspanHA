from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from homeassistant.core import HomeAssistant, callback
from homeassistant.components import bluetooth

_LOGGER = logging.getLogger(__name__)
BleCallback = Callable[[bluetooth.BluetoothServiceInfoBleak, bluetooth.BluetoothChange], None]


class PadSpanBluetoothIngestor:
    def __init__(
        self,
        hass: HomeAssistant,
        on_advertisement: BleCallback,
        *,
        match_dict: Optional[dict[str, Any]] = None,
        scanning_mode: bluetooth.BluetoothScanningMode = bluetooth.BluetoothScanningMode.ACTIVE,
    ) -> None:
        self.hass = hass
        self._on_advertisement = on_advertisement
        self._match_dict: dict[str, Any] = match_dict or {}
        self._scanning_mode = scanning_mode
        self._unsub: Optional[Callable[[], None]] = None

    async def start(self) -> None:
        if self._unsub is not None:
            return
        self._unsub = bluetooth.async_register_callback(
            self.hass,
            self._async_ble_callback,
            self._match_dict,
            self._scanning_mode,
        )
        _LOGGER.debug("PadSpan BLE ingestor started mode=%s", self._scanning_mode)

    async def stop(self) -> None:
        if self._unsub is None:
            return
        try:
            self._unsub()
        finally:
            self._unsub = None
        _LOGGER.debug("PadSpan BLE ingestor stopped")

    @callback
    def _async_ble_callback(
        self,
        service_info: bluetooth.BluetoothServiceInfoBleak,
        change: bluetooth.BluetoothChange,
    ) -> None:
        try:
            self._on_advertisement(service_info, change)
        except Exception:
            _LOGGER.exception("PadSpan BLE advertisement handler crashed")
