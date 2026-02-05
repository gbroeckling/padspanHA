from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_event

from .const import DOMAIN, ATTR_CANDIDATES, ATTR_LAST_SEEN, ATTR_RSSI, ATTR_ADDRESS, ATTR_NAME
from .coordinator import PadSpanCoordinator


@dataclass(frozen=True, kw_only=True)
class PadSpanSensorDescription(SensorEntityDescription):
    pass


SENSORS: tuple[PadSpanSensorDescription, ...] = (
    PadSpanSensorDescription(
        key="seen_devices",
        name="PadSpan Seen Devices",
        icon="mdi:bluetooth",
    ),
    PadSpanSensorDescription(
        key="last_advertisement",
        name="PadSpan Last Advertisement",
        icon="mdi:radio-tower",
    ),
    PadSpanSensorDescription(
        key="discovery_candidates",
        name="PadSpan Discovery Candidates",
        icon="mdi:account-search",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: PadSpanCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[SensorEntity] = []
    for desc in SENSORS:
        entities.append(PadSpanSensor(coordinator, entry, desc))

    async_add_entities(entities)


class PadSpanSensor(SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator: PadSpanCoordinator, entry: ConfigEntry, desc: PadSpanSensorDescription):
        self.coordinator = coordinator
        self.entry = entry
        self.entity_description = desc
        self._attr_unique_id = f"{entry.entry_id}_{desc.key}"
        self._unsub = None

    async def async_added_to_hass(self) -> None:
        @callback
        def _handle(_event):
            self.async_write_ha_state()

        # Update when coordinator fires
        self._unsub = self.hass.bus.async_listen("padspan_update", _handle)

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    @property
    def native_value(self) -> Any:
        key = self.entity_description.key

        if key == "seen_devices":
            return len(self.coordinator.seen)

        if key == "last_advertisement":
            si = self.coordinator.last_service_info
            if not si:
                return None
            # Keep UI friendly: show name if available, otherwise "BLE advertiser"
            name = getattr(si, "name", None) or "BLE advertiser"
            return name

        if key == "discovery_candidates":
            # show count; details in attributes
            return len(self.coordinator.discovery_candidates())

        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        key = self.entity_description.key

        if key == "last_advertisement":
            si = self.coordinator.last_service_info
            if not si:
                return None
            return {
                ATTR_NAME: getattr(si, "name", None),
                ATTR_ADDRESS: getattr(si, "address", None),
                ATTR_RSSI: getattr(si, "rssi", None),
                ATTR_LAST_SEEN: datetime.now(timezone.utc).isoformat(),
                "manufacturer_data_keys": list(getattr(si, "manufacturer_data", {}).keys()),
                "service_uuids": list(getattr(si, "service_uuids", []) or []),
            }

        if key == "discovery_candidates":
            return {
                "active": self.coordinator.discovery_active,
                "started": self.coordinator.discovery_started.isoformat() if self.coordinator.discovery_started else None,
                "stopped": self.coordinator.discovery_stopped.isoformat() if self.coordinator.discovery_stopped else None,
                ATTR_CANDIDATES: self.coordinator.discovery_candidates(),
            }

        return None
