# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""People go away after the away timeout; things keep their room for hours.

One away timeout (default 5 min) used to cover every device, so keys in a
drawer read not_home five minutes after they were put there. A device a Home
Assistant person carries still goes away after the away timeout. Any other
labelled device is a thing: its area sensor and tracker keep its last room
for the things' away time (Settings → Presence → Home/Away Timeout, default
6 hours), say where that was in `last_room`, and only then read not_home.
They never go unavailable.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.device_tracker import PadSpanDeviceTracker
from custom_components.padspan_ha.presence_rules import (
    DEFAULT_THING_AWAY_TIMEOUT_H,
    device_away_timeout_s,
    is_carried,
    thing_away_timeout_s,
)
from custom_components.padspan_ha.sensor import PadSpanAreaSensor
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

from tests.test_house3d_store import _house, _run
from tests.test_poll_level import ble_object, make_coordinator, run_poll, snapshot

ROOT = Path(__file__).resolve().parents[1]
K = "ble:AA:BB:CC:DD:EE:01"
ADDR = "AA:BB:CC:DD:EE:01"
HOUR = 3600.0


def _keys(age: float, **extra) -> dict:
    return {"key": K, "kind": "ble", "address": ADDR, "user_label": "Keys", "room": "Kitchen", "age_s": age, **extra}


def _hass(settings: dict | None = None, persons: list | None = None, states: dict | None = None) -> MagicMock:
    hass = MagicMock()
    store = MagicMock()
    store.data = dict(settings or {})
    hass.data = {DOMAIN: {DATA_SETTINGS: store}}
    hass.states.async_all.side_effect = lambda domain=None: list(persons or []) if domain == "person" else []
    hass.states.get.side_effect = lambda eid: (states or {}).get(eid)
    return hass


def _person(name: str = "Garry", trackers: list | None = None, source: str | None = None):
    attrs = {"friendly_name": name, "device_trackers": list(trackers or [])}
    if source:
        attrs["source"] = source
    return SimpleNamespace(entity_id=f"person.{name.lower()}", attributes=attrs)


def _state(**attrs):
    return SimpleNamespace(attributes=attrs)


def _coord(obj: dict, hass: MagicMock) -> MagicMock:
    coord = MagicMock()
    coord.data = {obj.get("key") or K: obj}
    coord.hass = hass
    coord.last_update_success = True
    return coord


def _sensor(obj: dict, hass: MagicMock) -> PadSpanAreaSensor:
    s = PadSpanAreaSensor.__new__(PadSpanAreaSensor)
    s.coordinator = _coord(obj, hass)
    s._key = obj.get("key") or K
    return s


def _tracker(obj: dict, hass: MagicMock, entity_id: str = "device_tracker.keys") -> PadSpanDeviceTracker:
    t = PadSpanDeviceTracker(_coord(obj, hass), obj.get("key") or K)
    t.entity_id = entity_id
    return t


# ── the setting ──────────────────────────────────────────────────────────────

def test_default_is_six_hours():
    assert DEFAULT_SETTINGS["thing_away_timeout_h"] == 6.0 == DEFAULT_THING_AWAY_TIMEOUT_H
    assert thing_away_timeout_s(_hass()) == 6 * HOUR
    assert thing_away_timeout_s(_hass(DEFAULT_SETTINGS)) == 6 * HOUR


def test_the_setting_is_read_and_clamped():
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": 2})) == 2 * HOUR
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": 99})) == 48 * HOUR
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": "bad"})) == 6 * HOUR
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": float("nan")})) == 6 * HOUR


def test_a_thing_is_never_dropped_sooner_than_a_person():
    # 0 = the same as the away timeout.
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": 0})) == 300.0
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": 0, "away_timeout_m": 20})) == 1200.0
    # An away timeout longer than the things' time wins.
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": 6, "away_timeout_m": 600})) == 600 * 60.0


def test_settings_set_takes_it_clamped():
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert "thing_away_timeout_h" in keys
    h = _house()
    for typed, kept in ((3, 3.0), ("12.5", 12.5), (0, 0.0), (-4, 0.0), (0.1, 0.5), (500, 48.0), ("x", 6.0)):
        conn = MagicMock()
        conn.user = MagicMock(is_admin=True)
        _run(WS.ws_settings_set(h, conn, {"id": 1, "thing_away_timeout_h": typed}))
        assert not conn.send_error.called, typed
        assert h.data[DOMAIN][DATA_SETTINGS].data["thing_away_timeout_h"] == kept, typed


# ── who carries what ─────────────────────────────────────────────────────────

def test_a_labelled_device_nobody_carries_is_a_thing():
    assert not is_carried(_hass(), _keys(10))
    assert not is_carried(_hass(persons=[_person("Nicole", ["device_tracker.pixel"])],
                                states={"device_tracker.pixel": _state(friendly_name="Pixel")}), _keys(10))


def test_picked_for_a_person_in_people_and_devices():
    hass = _hass({"atlas_3d_carries": {"person.garry": [K]}})
    assert is_carried(hass, _keys(10))


def test_picked_under_another_key_of_the_same_device():
    """The phone wizard's iBeacon and IRK keys are one device, by its name."""
    other = "irk:0011"
    hass = _hass({"atlas_3d_carries": {"person.garry": [other]}})
    data = {K: _keys(10), other: {"key": other, "kind": "private_ble", "user_label": "keys"}}
    assert is_carried(hass, _keys(10), data)
    assert not is_carried(hass, _keys(10), {K: _keys(10)})


def test_its_own_tracker_is_on_a_person():
    hass = _hass(persons=[_person("Garry", ["device_tracker.garrys_thing"])])
    assert is_carried(hass, _keys(10), own_entity_id="device_tracker.garrys_thing")
    assert not is_carried(hass, _keys(10), own_entity_id="device_tracker.other")


def test_the_area_sensor_finds_the_tracker_on_a_person_by_its_name():
    """The sensor has no tracker id of its own: PadSpan's tracker says its label."""
    hass = _hass(persons=[_person("Garry", ["device_tracker.renamed"])],
                 states={"device_tracker.renamed": _state(user_label="Keys", friendly_name="Anything")})
    assert is_carried(hass, _keys(10))


def test_an_ha_entity_on_the_same_bluetooth_device_is_on_a_person():
    hass = _hass(persons=[_person("Garry", source="device_tracker.bermuda_keys")])
    assert is_carried(hass, _keys(10, linked_entities=["device_tracker.bermuda_keys"]))


def test_named_as_the_person_or_one_of_their_trackers():
    assert is_carried(_hass(persons=[_person("Keys")]), _keys(10))
    hass = _hass(persons=[_person("Garry", ["device_tracker.pixel_9"])],
                 states={"device_tracker.pixel_9": _state(friendly_name="Pixel 9")})
    assert is_carried(hass, _keys(10, user_label="Pixel 9"))
    assert is_carried(_hass(persons=[_person("Garry", ["device_tracker.garry_phone"])]),
                      _keys(10, user_label="Garry phone"))


def test_carried_uses_the_away_timeout_and_a_thing_the_longer_time():
    assert device_away_timeout_s(_hass(), _keys(10)) == 6 * HOUR
    assert device_away_timeout_s(_hass(persons=[_person("Keys")]), _keys(10)) == 300.0


# ── the entities ─────────────────────────────────────────────────────────────

def test_a_thing_keeps_its_room_past_the_away_timeout():
    hass = _hass()
    for age in (600.0, HOUR, 5.9 * HOUR):
        s, t = _sensor(_keys(age), hass), _tracker(_keys(age), hass)
        assert s.native_value == "Kitchen" and t.state == "Kitchen", age
        assert s.extra_state_attributes["home"] is True and t.extra_state_attributes["home"] is True
        assert s.extra_state_attributes["last_room"] == "Kitchen" == t.extra_state_attributes["last_room"]


def test_a_thing_reads_not_home_after_its_time_and_says_where_it_was():
    hass = _hass()
    s, t = _sensor(_keys(6.1 * HOUR), hass), _tracker(_keys(6.1 * HOUR), hass)
    assert s.native_value == "not_home" and t.state == "not_home"
    for attrs in (s.extra_state_attributes, t.extra_state_attributes):
        assert attrs["home"] is False and attrs["last_room"] == "Kitchen"


def test_a_person_s_device_still_goes_away_after_the_away_timeout():
    hass = _hass(persons=[_person("Garry", ["device_tracker.keys"])])
    t = _tracker(_keys(600.0), hass)
    assert t.state == "not_home"
    assert t.extra_state_attributes["last_room"] == "Kitchen"
    # The sensor sees the same tracker on the person by the label it carries.
    hass.states.get.side_effect = lambda eid: _state(user_label="Keys") if eid == "device_tracker.keys" else None
    assert _sensor(_keys(600.0), hass).native_value == "not_home"
    assert _sensor(_keys(60.0), hass).native_value == "Kitchen"


def test_zero_hours_makes_things_go_away_like_people():
    hass = _hass({"thing_away_timeout_h": 0})
    assert _sensor(_keys(600.0), hass).native_value == "not_home"
    assert _tracker(_keys(600.0), hass).state == "not_home"


def test_never_unavailable():
    hass = _hass()
    for age in (5.0, HOUR, 7 * HOUR):
        assert _sensor(_keys(age), hass).available is True
        assert _tracker(_keys(age), hass).available is True


def test_a_thing_keeps_its_room_through_a_real_poll():
    """The object history replays a quiet labelled device with the room it
    had; the poll must hand that room to the entities, not clear it."""
    coord = make_coordinator()
    coord.data = run_poll(coord, snapshot([ble_object(K, ADDR, age_s=1.0, user_label="Keys", room="Kitchen")]))
    coord.data = run_poll(coord, snapshot([ble_object(K, ADDR, age_s=2 * HOUR, user_label="Keys", room="Kitchen")]))
    assert coord.data[K]["room"] == "Kitchen"
    coord.last_update_success = True
    s = PadSpanAreaSensor.__new__(PadSpanAreaSensor)
    s.coordinator, s._key = coord, K
    assert s.native_value == "Kitchen"
    assert s.extra_state_attributes["last_room"] == "Kitchen"


# ── the setting on screen ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def drawn():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "thing_away_setting.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_the_row_sits_in_the_away_timeout_card(drawn):
    for name, want in (("unset", "6"), ("saved", "2"), ("zero", "0")):
        d = drawn[name]
        assert d["found"] and d["value"] == want, name
        assert "Home/Away Timeout" in d["card"] and "Away timeout" in d["card"]
        assert "Things keep their room" in d["card"] and "nobody carries" in d["card"]
    assert "same as the away timeout" in drawn["zero"]["card"].split("Things keep their room")[1]


def test_save_sends_the_hours_kept_in_range(drawn):
    sent = {s["typed"]: s["sent"] for s in drawn["saves"]}
    assert sent == {
        "3": [{"thing_away_timeout_h": 3}], "0": [{"thing_away_timeout_h": 0}],
        "100": [{"thing_away_timeout_h": 48}], "0.1": [{"thing_away_timeout_h": 0.5}],
        "": [{"thing_away_timeout_h": 6}], "-2": [{"thing_away_timeout_h": 0}],
    }
