# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
When the Atlas's rain sensor really turned wet (views/atlas_weather.js, the
stuck rule).

2026-11-21, the owner: "why is the wall computer showing the atlas with rain,
it is not raining?" His solar rain sensor had said "on" for over 30 hours
while still reporting every minute, and the Atlas drew rain as soon as the
weather entity turned cloudy. An on/off rain sensor wet for hours while the
weather entity does not say it is wet is stuck, but the panel cannot tell how
long it has been wet: Zigbee2MQTT replays the retained state after every Home
Assistant restart, so the sensor goes unknown -> on at each start and its
last_changed is the restart.

This listener sees every change of the chosen rain sensor
(atlas_weather_rain_entity) and keeps the time it went from dry to wet in the
settings store (atlas_weather_rain_wet_since, epoch seconds, 0 = dry or not
known), so the time survives restarts:

  reads dry (off, or a number 0 or below)   -> 0
  reads wet, no time kept                   -> now (off -> on, or the first wet seen)
  reads wet, a time kept                    -> kept (a restart's replay, back from unavailable)
  unavailable / unknown / gone              -> kept: no reading is not dry

Choosing another rain sensor starts again (ws_settings.py settings_set calls
wet_since_for). The panel reads the time from settings_get, as it does
flood_latches, and sees a change at its next settings read (every 30 s).
"""

import functools
import math
import time
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback as ha_callback

from .const import DATA_SETTINGS, DOMAIN

KEY = "atlas_weather_rain_wet_since"
ENTITY_KEY = "atlas_weather_rain_entity"

_DATA_UNSUB = "_rain_wet_unsub"


def reading(state: Any) -> bool | None:
    """True wet, False dry, None no reading — atlas_weather.js rainReading:
    on/off, or a number above 0."""
    v = getattr(state, "state", None)
    if not isinstance(v, str):
        return None
    v = v.strip().lower()
    if v in ("", "unknown", "unavailable"):
        return None
    if v in ("on", "off"):
        return v == "on"
    try:
        n = float(v)
    except ValueError:
        return None
    return n > 0 if math.isfinite(n) else None


def next_since(kept: float, wet: bool | None, now: float) -> float:
    """The time to keep after a reading (the table in the module docstring)."""
    if wet is None:
        return kept
    if not wet:
        return 0
    return kept if kept > 0 else now


def _kept(st: Any) -> float:
    v = st.data.get(KEY)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
        return 0
    return float(v)


def _chosen(st: Any) -> str:
    v = st.data.get(ENTITY_KEY)
    return v.strip() if isinstance(v, str) else ""


def wet_since_for(hass: HomeAssistant, entity_id: str) -> float:
    """For a newly chosen rain sensor: now if it reads wet (seen wet for the
    first time), else 0."""
    if not entity_id:
        return 0
    return time.time() if reading(hass.states.get(entity_id)) is True else 0


async def _async_note(hass: HomeAssistant, entity_id: str, wet: bool | None, now: float) -> None:
    """One reading of the chosen sensor, written if it changes the time.
    Worked out here, when the task runs, and not in the callback: two changes
    close together each start a task before either has written, and the
    second must see what the first wrote. A sensor no longer chosen by now
    (settings_set has started its replacement's time) is left alone."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st or _chosen(st) != entity_id:
        return
    before = _kept(st)
    since = next_since(before, wet, now)
    if since != before:
        await st.async_set(**{KEY: since})


@ha_callback
def _on_state_changed(hass: HomeAssistant, event: Event) -> None:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        return
    eid = event.data.get("entity_id")
    if not eid or eid != _chosen(st):
        return
    wet = reading(event.data.get("new_state"))
    if wet is None:
        return
    hass.async_create_task(_async_note(hass, eid, wet, time.time()))


def async_setup_rain_wet(hass: HomeAssistant) -> None:
    """Idempotent across config-entry reloads, as flood_latch.py. A sensor
    already wet when this starts (one loaded before PadSpan) is noted now;
    one not loaded yet is noted by its first change."""
    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_DATA_UNSUB):
        return
    # functools.partial, never a lambda: see flood_latch.py.
    dom[_DATA_UNSUB] = hass.bus.async_listen("state_changed", functools.partial(_on_state_changed, hass))
    st = dom.get(DATA_SETTINGS)
    eid = _chosen(st) if st else ""
    if eid:
        hass.async_create_task(_async_note(hass, eid, reading(hass.states.get(eid)), time.time()))


def async_stop_rain_wet(hass: HomeAssistant) -> None:
    unsub = hass.data.get(DOMAIN, {}).pop(_DATA_UNSUB, None)
    if unsub:
        unsub()
