from __future__ import annotations

from dataclasses import asdict
from typing import Any, Optional

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, DEFAULT_NAME
from .coordinator import PadSpanCoordinator, PadSpanStats


DESCRIPTIONS: dict[str, SensorEntityDescription] = {
    "packets_last_60s": SensorEntityDescription(key="packets_last_60s", name="Packets last 60s", icon="mdi:bluetooth"),
    "unique_last_60s": SensorEntityDescription(key="unique_last_60s", name="Unique devices last 60s", icon="mdi:bluetooth-connect"),
    "packets_last_5m": SensorEntityDescription(key="packets_last_5m", name="Packets last 5m", icon="mdi:bluetooth"),
    "unique_last_5m": SensorEntityDescription(key="unique_last_5m", name="Unique devices last 5m", icon="mdi:bluetooth-connect"),
    "packets_today": SensorEntityDescription(key="packets_today", name="Packets today", icon="mdi:counter"),
    "unique_today": SensorEntityDescription(key="unique_today", name="Unique devices today", icon="mdi:counter"),
}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: PadSpanCoordinator = hass.data[DOMAIN][entry.entry_id]
    name = entry.data.get("name", DEFAULT_NAME)

    entities = [
        PadSpanStatSensor(coordinator, entry, name, DESCRIPTIONS["packets_last_60s"]),
        PadSpanStatSensor(coordinator, entry, name, DESCRIPTIONS["unique_last_60s"]),
        PadSpanStatSensor(coordinator, entry, name, DESCRIPTIONS["packets_last_5m"]),
        PadSpanStatSensor(coordinator, entry, name, DESCRIPTIONS["unique_last_5m"]),
        PadSpanStatSensor(coordinator, entry, name, DESCRIPTIONS["packets_today"]),
        PadSpanStatSensor(coordinator, entry, name, DESCRIPTIONS["unique_today"]),
        PadSpanLastSeenSensor(coordinator, entry, name),
    ]
    async_add_entities(entities)


class _PadSpanBase(CoordinatorEntity):
    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry, name: str) -> None:
        super().__init__(coordinator)
        self._coordinator = coordinator
        self._entry = entry
        self._base_name = name
        self._unsub = self._coordinator.async_add_listener(self._handle_coordinator_update)

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        return True

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": self._base_name,
            "manufacturer": "PadSpan",
            "model": "PadSpan HA",
        }


class PadSpanStatSensor(_PadSpanBase, SensorEntity):
    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry, name: str, description: SensorEntityDescription) -> None:
        super().__init__(coordinator, entry, name)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_name = f"{name} {description.name}"

    @property
    def native_value(self) -> Optional[int]:
        s: PadSpanStats = self._coordinator.stats
        return getattr(s, self.entity_description.key)


class PadSpanLastSeenSensor(_PadSpanBase, SensorEntity):
    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry, name: str) -> None:
        super().__init__(coordinator, entry, name)
        self._attr_unique_id = f"{entry.entry_id}_last_seen"
        self._attr_name = f"{name} Last seen"
        self._attr_icon = "mdi:bluetooth-transfer"

    @property
    def native_value(self) -> Optional[str]:
        s: PadSpanStats = self._coordinator.stats
        if not s.last_seen_address:
            return None
        rssi = f" rssi={s.last_seen_rssi}" if s.last_seen_rssi is not None else ""
        nm = f" name={s.last_seen_name}" if s.last_seen_name else ""
        return f"{s.last_seen_address}{rssi}{nm}"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return asdict(self._coordinator.stats)
