# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Binary sensor platform for PadSpan HA (home/away presence).

binary_sensor.padspan_<sub-zone>_occupied, one per sub-zone (subzones.py):
none unless sub-zones are switched on and one has been added."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .subzones import SubzoneEntityMixin, async_setup_entities


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up PadSpan binary sensors. Entities are added dynamically by the presence coordinator."""
    await async_setup_entities(hass, entry, async_add_entities, PadSpanSubzoneOccupied)


class PadSpanSubzoneOccupied(SubzoneEntityMixin, CoordinatorEntity, BinarySensorEntity):
    """On while anyone labelled is in the sub-zone."""

    _attr_device_class = BinarySensorDeviceClass.OCCUPANCY
    _suffix = "occupied"

    def __init__(self, coordinator, zid: str) -> None:
        super().__init__(coordinator)
        self._setup(zid)

    @property
    def name(self) -> str:
        return "Occupied"

    @property
    def is_on(self) -> bool:
        return bool(self._people)
