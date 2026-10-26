# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Binary sensor platform for PadSpan HA (home/away presence).

binary_sensor.padspan_<sub-zone>_occupied, one per sub-zone (subzones.py):
none unless sub-zones are switched on and one has been added.
binary_sensor.padspan_vacation_mode: on while Vacation Mode runs, for
automations (an alarm armed with it, a notice of your own)."""
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
    async_add_entities([PadSpanVacationMode(hass, entry)])


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


class PadSpanVacationMode(BinarySensorEntity):
    """On while Vacation Mode runs. Attributes say since when, which routine,
    the trip's options and end, whether it is paused (someone home), and who
    last turned it off. Updated on every switch and option change
    (vacation_mode.announce / refresh_status); never polled."""

    _attr_should_poll = False
    _attr_icon = "mdi:palm-tree"
    _attr_name = "PadSpan Vacation Mode"

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self._attr_unique_id = f"{entry.entry_id}_vacation_mode"

    async def async_added_to_hass(self) -> None:
        from homeassistant.helpers.dispatcher import async_dispatcher_connect  # noqa: PLC0415
        from .vacation_mode import SIGNAL_VACATION  # noqa: PLC0415
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_VACATION, self.async_write_ha_state))

    def _data(self) -> dict:
        from .const import DATA_SETTINGS, DOMAIN  # noqa: PLC0415
        st = (self.hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
        return (st.data if st else None) or {}

    @property
    def is_on(self) -> bool:
        return bool(self._data().get("vacation_mode_enabled"))

    @property
    def extra_state_attributes(self) -> dict:
        from .vacation_mode import status_attributes  # noqa: PLC0415
        return status_attributes(self.hass, self._data())
