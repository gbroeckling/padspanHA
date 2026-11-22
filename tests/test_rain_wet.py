# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""When the Atlas's rain sensor really turned wet (rain_wet.py).

Live 2026-11-21: a Tuya solar rain sensor (Zigbee2MQTT) said "on" for over
30 hours while still reporting every minute, and the Atlas drew rain as soon
as the weather entity turned cloudy. Its last_changed could not say how long
it had been wet: Zigbee2MQTT replays the retained "on" after every Home
Assistant restart, so it went unknown -> on at the 16:48 restart. The time
kept here is what the panel's stuck rule reads (views/atlas_weather.js,
tests/js/atlas_weather.mjs "stuck:").

The listener runs against the stub HA (conftest.py), driven the way the bus
would drive it; the settings store merges and saves as the real one does.
"""

from __future__ import annotations

import functools
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import rain_wet as RW
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.conftest import keep_task

RAIN = "binary_sensor.0xa4c138c535b29601_rain"
OTHER = "binary_sensor.garden_rain"
T0 = 1_795_000_000.0


class _Store:
    """SettingsStore's own merge: async_set replaces only the keys it is given."""

    def __init__(self, **data):
        self.data = {**DEFAULT_SETTINGS, "atlas_weather_rain_entity": RAIN, **data}
        self.saves = 0

    async def async_set(self, **kw):
        self.data = {**self.data, **kw}
        self.saves += 1
        return self.data


def _hass(st, states=None):
    tasks = []
    hass = SimpleNamespace(
        data={DOMAIN: {DATA_SETTINGS: st}},
        bus=MagicMock(),
        states=SimpleNamespace(get=lambda eid: (states or {}).get(eid)),
        async_create_task=MagicMock(side_effect=lambda coro, *a, **k: tasks.append(keep_task(coro))),
        tasks=tasks,
    )
    return hass


def _state(value):
    return SimpleNamespace(state=value, attributes={"device_class": "moisture"})


async def _run(hass):
    """Every task started so far, in order, as the event loop would."""
    while hass.tasks:
        await hass.tasks.pop(0)


async def _feed(hass, eid, seq, clock):
    """Each (state, time) through the listener; None is the entity removed."""
    for value, when in seq:
        clock.t = when
        new = None if value is None else _state(value)
        RW._on_state_changed(hass, SimpleNamespace(data={"entity_id": eid, "new_state": new}))
    await _run(hass)


@pytest.fixture
def clock(monkeypatch):
    c = SimpleNamespace(t=T0)
    monkeypatch.setattr(RW.time, "time", lambda: c.t)
    return c


# ── The readings ────────────────────────────────────────────────────────────


def test_readings_match_the_panel():
    """atlas_weather.js rainReading: on/off, or a number above 0; no reading otherwise."""
    for v, want in (("on", True), ("ON", True), (" off ", False), ("2.5", True), ("0", False), ("-1", False),
                    ("unknown", None), ("unavailable", None), ("", None), ("wet", None), ("nan", None), ("inf", None)):
        assert RW.reading(_state(v)) is want, v
    assert RW.reading(None) is None
    assert RW.reading(SimpleNamespace(state=MagicMock())) is None


# ── The listener ────────────────────────────────────────────────────────────


def test_setup_registers_a_partial_once():
    """A lambda would run on a worker thread (flood_latch.py, 2026-09-18)."""
    hass = _hass(_Store())
    RW.async_setup_rain_wet(hass)
    RW.async_setup_rain_wet(hass)
    assert hass.bus.async_listen.call_count == 1
    event, listener = hass.bus.async_listen.call_args.args
    assert event == "state_changed"
    assert isinstance(listener, functools.partial) and listener.func is RW._on_state_changed and listener.args == (hass,)
    RW.async_stop_rain_wet(hass)
    RW.async_setup_rain_wet(hass)
    assert hass.bus.async_listen.call_count == 2


async def test_off_to_on_keeps_the_time_it_turned_wet(clock):
    st = _Store()
    hass = _hass(st)
    await _feed(hass, RAIN, [("off", T0), ("on", T0 + 60)], clock)
    assert st.data[RW.KEY] == T0 + 60
    # Still on, an hour later (an attribute update): the time stays.
    await _feed(hass, RAIN, [("on", T0 + 3600)], clock)
    assert st.data[RW.KEY] == T0 + 60


async def test_unavailable_and_back_keeps_the_time(clock):
    st = _Store()
    hass = _hass(st)
    await _feed(hass, RAIN, [("off", T0), ("on", T0 + 60), ("unavailable", T0 + 7200), ("unknown", T0 + 7210),
                             ("on", T0 + 7260)], clock)
    assert st.data[RW.KEY] == T0 + 60


async def test_a_restart_with_a_kept_time_keeps_it(clock):
    """The 16:48 restart: Zigbee2MQTT replays "on" after unknown, and the
    state machine's own startup, before the replay, has no reading."""
    st = _Store(**{RW.KEY: T0 - 30 * 3600})
    hass = _hass(st, {RAIN: _state("unknown")})
    RW.async_setup_rain_wet(hass)
    await _run(hass)
    await _feed(hass, RAIN, [(None, T0), ("unknown", T0 + 5), ("on", T0 + 9)], clock)
    assert st.data[RW.KEY] == T0 - 30 * 3600
    assert st.saves == 0


async def test_on_seen_for_the_first_time_is_since_now(clock):
    st = _Store()
    hass = _hass(st)
    await _feed(hass, RAIN, [("on", T0 + 5)], clock)
    assert st.data[RW.KEY] == T0 + 5


async def test_already_wet_when_padspan_starts_is_since_then(clock):
    """A sensor Home Assistant loaded before PadSpan sends no change for it."""
    st = _Store()
    hass = _hass(st, {RAIN: _state("on")})
    RW.async_setup_rain_wet(hass)
    await _run(hass)
    assert st.data[RW.KEY] == T0


async def test_dry_clears_it(clock):
    st = _Store(**{RW.KEY: T0 - 4 * 3600})
    hass = _hass(st)
    await _feed(hass, RAIN, [("off", T0)], clock)
    assert st.data[RW.KEY] == 0
    # A number 0 is dry too; a number above it wet again, from then.
    st.data["atlas_weather_rain_entity"] = "sensor.rain_rate"
    await _feed(hass, "sensor.rain_rate", [("0.4", T0 + 10), ("0", T0 + 20), ("0.2", T0 + 30)], clock)
    assert st.data[RW.KEY] == T0 + 30


async def test_two_changes_close_together_each_count(clock):
    """off then on before either task has run: the second sees the first."""
    st = _Store(**{RW.KEY: T0 - 4 * 3600})
    hass = _hass(st)
    await _feed(hass, RAIN, [("off", T0), ("on", T0 + 1)], clock)
    assert st.data[RW.KEY] == T0 + 1


async def test_other_sensors_and_none_chosen_are_ignored(clock):
    st = _Store()
    hass = _hass(st)
    await _feed(hass, OTHER, [("on", T0)], clock)
    assert st.data[RW.KEY] == 0 and not hass.async_create_task.called
    st.data["atlas_weather_rain_entity"] = ""
    await _feed(hass, RAIN, [("on", T0)], clock)
    assert st.data[RW.KEY] == 0 and st.saves == 0


async def test_a_change_for_the_sensor_no_longer_chosen_writes_nothing(clock):
    st = _Store()
    hass = _hass(st)
    RW._on_state_changed(hass, SimpleNamespace(data={"entity_id": RAIN, "new_state": _state("on")}))
    st.data["atlas_weather_rain_entity"] = OTHER      # settings_set ran before the task did
    await _run(hass)
    assert st.data[RW.KEY] == 0 and st.saves == 0


# ── Choosing another sensor (settings_set) ──────────────────────────────────


def _house(states):
    """A real SettingsStore (its merge) saving nowhere, in a stub Home Assistant."""
    from custom_components.padspan_ha.settings_store import SettingsStore

    async def _save(_data):
        return None
    st = SettingsStore.__new__(SettingsStore)
    st.data = {**DEFAULT_SETTINGS, "atlas_weather_rain_entity": RAIN, RW.KEY: T0 - 30 * 3600}
    st.store = SimpleNamespace(async_save=_save)
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    hass.states.get = lambda eid: states.get(eid)
    return hass, st


async def _settings_set(hass, **msg):
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=True, id="u", name="Admin")
    await WS.ws_settings_set(hass, conn, {"id": 1, "type": "padspan_ha/settings_set", **msg})
    assert not conn.send_error.called, conn.send_error.call_args


async def test_another_sensor_chosen_starts_again(clock):
    hass, st = _house({OTHER: _state("off"), RAIN: _state("on")})
    await _settings_set(hass, atlas_weather_rain_entity=OTHER)
    assert st.data["atlas_weather_rain_entity"] == OTHER and st.data[RW.KEY] == 0
    # Back to the first, still wet: seen wet for the first time, from now.
    clock.t = T0 + 100
    await _settings_set(hass, atlas_weather_rain_entity=RAIN)
    assert st.data[RW.KEY] == T0 + 100
    # The same sensor sent again keeps its time.
    clock.t = T0 + 9000
    await _settings_set(hass, atlas_weather_rain_entity=RAIN)
    assert st.data[RW.KEY] == T0 + 100
    # Another setting saved keeps it too.
    await _settings_set(hass, atlas_weather_strength=1.2)
    assert st.data[RW.KEY] == T0 + 100
    # None chosen: nothing to time.
    await _settings_set(hass, atlas_weather_rain_entity="")
    assert st.data[RW.KEY] == 0


def test_the_panel_is_sent_it():
    """settings_get is dict(st.data): the Atlas reads it there (lights_panel.js)."""
    from custom_components.padspan_ha.ws_common import _get_settings
    hass, _st = _house({})
    assert _get_settings(hass)[RW.KEY] == T0 - 30 * 3600


def test_the_panel_cannot_set_it():
    """Only the listener and a new rain sensor write it (tests/test_websocket_settings_schema.py)."""
    assert RW.KEY not in {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert DEFAULT_SETTINGS[RW.KEY] == 0
