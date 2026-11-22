# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Light platform for PadSpan HA: one light per power team (power_team.py).

A power team is a wall dimmer or switch and the smart bulbs it feeds. Its
light is what people, automations and the map switch: on is the power going
on and the bulbs being sent their colour once they answer. None exists until
a team is made (padspan_ha/power_teams_set)."""
from __future__ import annotations

from typing import Any

from homeassistant.components.light import ColorMode, LightEntity, LightEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .power_team import EFFECT_ADAPTIVE, EFFECT_SLEEP, SIGNAL_TEAMS, Team, async_setup_power_teams, manager


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """A light for each team now, and for each made later; a removed team's light goes."""
    from homeassistant.helpers.dispatcher import async_dispatcher_connect  # noqa: PLC0415
    have: dict[str, PadSpanTeamLight] = {}
    if manager(hass) is None:
        async_setup_power_teams(hass)

    @callback
    def sync() -> None:
        m = manager(hass)
        teams = m.teams if m else {}
        for tid in [t for t in have if t not in teams]:
            hass.async_create_task(have.pop(tid).async_gone())
        new = [PadSpanTeamLight(hass, tid) for tid in teams if tid not in have]
        for e in new:
            have[e.tid] = e
        if new:
            async_add_entities(new)
        for e in have.values():
            e.async_refresh()
    sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_TEAMS, sync))


class PadSpanTeamLight(LightEntity):
    """A power team, as one light."""

    _attr_should_poll = False
    _attr_supported_color_modes = {ColorMode.COLOR_TEMP, ColorMode.HS}
    _attr_min_color_temp_kelvin = 2000
    _attr_max_color_temp_kelvin = 6500
    _attr_icon = "mdi:lightbulb-group"

    def __init__(self, hass: HomeAssistant, tid: str) -> None:
        self.hass = hass
        self.tid = tid
        self._attr_unique_id = f"padspan_power_team_{tid}"

    @property
    def _team(self) -> Team | None:
        m = manager(self.hass)
        return m.teams.get(self.tid) if m else None

    async def async_added_to_hass(self) -> None:
        m = manager(self.hass)
        if m:
            m.listeners[self.tid] = self.async_refresh
            m.lights[self.tid] = self.entity_id         # what PadSpan switches a member as (team_light_of)

    async def async_will_remove_from_hass(self) -> None:
        m = manager(self.hass)
        if m:
            m.listeners.pop(self.tid, None)
            m.lights.pop(self.tid, None)

    @callback
    def async_refresh(self) -> None:
        if self.entity_id and self.hass:
            self.async_write_ha_state()

    async def async_gone(self) -> None:
        """Its team was removed: the light leaves Home Assistant with it."""
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
        eid = self.entity_id
        await self.async_remove()
        if eid and er.async_get(self.hass).async_get(eid):
            er.async_get(self.hass).async_remove(eid)

    @property
    def name(self) -> str | None:
        t = self._team
        return t.cfg.get("name") if t else None

    @property
    def available(self) -> bool:
        t = self._team
        if not t:
            return False
        # Switched by its bulbs (no power source, or an off that leaves the power on): there while any bulb is, even
        # with the wall dimmer out of reach. Otherwise there while the power source is.
        if t.by_bulbs and any((s := self.hass.states.get(b)) and s.state != "unavailable" for b in t.cfg["bulbs"]):
            return True
        if t.powerless:
            return False
        st = self.hass.states.get(t.cfg["power"])
        return bool(st and st.state != "unavailable")

    @property
    def is_on(self) -> bool:
        t = self._team
        return bool(t and t.is_on)

    @property
    def brightness(self) -> int | None:
        t = self._team
        return int(t.want.get("brightness") or 255) if t else None

    @property
    def color_mode(self) -> ColorMode:
        t = self._team
        return ColorMode.HS if t and t.want.get("hs") is not None else ColorMode.COLOR_TEMP

    @property
    def color_temp_kelvin(self) -> int | None:
        t = self._team
        return t.want.get("kelvin") if t else None

    @property
    def hs_color(self) -> tuple[float, float] | None:
        t = self._team
        return t.want.get("hs") if t else None

    @property
    def supported_features(self) -> LightEntityFeature:
        t = self._team
        # A fade (transition) of any length: half an hour from dim and warm is a wake-up light.
        return LightEntityFeature.TRANSITION | (LightEntityFeature.EFFECT if t and t.adaptive else LightEntityFeature(0))

    @property
    def effect_list(self) -> list[str] | None:
        t = self._team
        return [EFFECT_ADAPTIVE, EFFECT_SLEEP] if t and t.adaptive else None

    @property
    def effect(self) -> str | None:
        t = self._team
        return t.effect if t else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        t = self._team
        if not t:
            return {}
        # starting: the bulbs are being woken; failed: `missing` never answered. turns_off: "power" (cut) or "bulbs"
        # (the power left on). waking: the wake-up's light (fading, or faded and kept). The map's team card reads these.
        return {"padspan_power_team": True, "team_id": t.cfg.get("id"), "power": t.cfg.get("power") or None, "bulbs": list(t.cfg["bulbs"]),
                "phase": t.phase, "missing": list(t.missing), "follows_the_day": t.effect == EFFECT_ADAPTIVE,
                "turns_off": t.cfg.get("off") or "power", "waking": t.waking, "fading": t.fading,
                "brightness_follows": t.brightness_follows, "going_off": t._off_at is not None}

    async def async_turn_on(self, **kwargs: Any) -> None:
        t = self._team
        if not t:
            return
        # In the background: the bulbs can take BOOT_DEADLINE_S to answer, and a service call should not wait on that.
        self.hass.async_create_task(t.turn_on(brightness=kwargs.get("brightness"), kelvin=kwargs.get("color_temp_kelvin"),
                                              hs=kwargs.get("hs_color"), effect=kwargs.get("effect"),
                                              transition=kwargs.get("transition")))

    async def async_turn_off(self, **kwargs: Any) -> None:
        t = self._team
        if t:
            await t.turn_off(transition=kwargs.get("transition"))
