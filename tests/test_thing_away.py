# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""An option: things nobody carries keep their room for hours.

One away timeout (default 5 min) covers every device, so keys in a drawer
read not_home five minutes after they were put there. With "Things keep their
room" set to a number of hours (Settings → Presence → Home/Away Timeout), a
device a Home Assistant person carries still goes away after the away
timeout, and any other labelled device is a thing: its area sensor and
tracker keep its last room for those hours and only then read not_home.

The option is off (0) unless a home turns it on: every labelled device no
person is linked to would count as a thing, a phone nobody linked and a car's
tag included. Off, every device goes away after the away timeout, as before.
`last_room` is there either way, and the entities never go unavailable.
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
    away_timeout_s,
    device_away_timeout_s,
    is_away,
    is_carried,
    thing_away_timeout_s,
)
from custom_components.padspan_ha.sensor import PadSpanAreaSensor
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

from tests.test_house3d_store import _house, _run
from tests.test_poll_level import ble_object, make_coordinator, run_poll, snapshot
from tests.test_poll_room_and_presence_fixes import POLL_S, TAG, _House
from tests.test_settings_refusals import changed_nothing, send

ROOT = Path(__file__).resolve().parents[1]
K = "ble:AA:BB:CC:DD:EE:01"
ADDR = "AA:BB:CC:DD:EE:01"
HOUR = 3600.0
ON = {"thing_away_timeout_h": 6}      # the option turned on: things keep their room for 6 hours


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


def _person(name: str = "Alex", trackers: list | None = None, source: str | None = None):
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

def test_default_is_off():
    """Off is 0: the things' time is the away timeout, whatever that is set to."""
    assert DEFAULT_SETTINGS["thing_away_timeout_h"] == 0.0 == DEFAULT_THING_AWAY_TIMEOUT_H
    assert thing_away_timeout_s(_hass()) == 300.0                       # a home that never saved it
    assert thing_away_timeout_s(_hass(DEFAULT_SETTINGS)) == 300.0       # a new home
    assert thing_away_timeout_s(_hass({**DEFAULT_SETTINGS, "away_timeout_m": 20})) == 1200.0


def test_the_setting_is_read_and_clamped():
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": 2})) == 2 * HOUR
    assert thing_away_timeout_s(_hass({"thing_away_timeout_h": 99})) == 48 * HOUR
    # What cannot be read as hours is off, not some number of hours.
    for unreadable in ("bad", float("nan"), float("inf"), None, [6]):
        assert thing_away_timeout_s(_hass({"thing_away_timeout_h": unreadable})) == 300.0, unreadable


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
    for typed, kept in ((3, 3.0), ("12.5", 12.5), (0, 0.0), (-4, 0.0), (0.1, 0.5), (500, 48.0), ("x", 0.0)):
        conn = MagicMock()
        conn.user = MagicMock(is_admin=True)
        _run(WS.ws_settings_set(h, conn, {"id": 1, "thing_away_timeout_h": typed}))
        assert not conn.send_error.called, typed
        assert h.data[DOMAIN][DATA_SETTINGS].data["thing_away_timeout_h"] == kept, typed


@pytest.mark.parametrize("text", ["nan", "inf", "-inf"])
def test_settings_set_refuses_hours_that_are_not_a_finite_number(text):
    """As every numeric setting: refused by name, and nothing is stored."""
    assert "thing_away_timeout_h" in WS._NUMBER_KEYS
    got = send({"thing_away_timeout_h": text}, start=ON)
    assert got["error"] == ["invalid", "thing_away_timeout_h must be a finite number"]
    assert changed_nothing(got) and got["data"]["thing_away_timeout_h"] == 6


# ── off, as every home starts: exactly as before ─────────────────────────────

AGES = (0.0, 5.0, 299.0, 300.0, 301.0, 600.0, 1199.0, 1201.0, HOUR, 5.9 * HOUR, 7 * HOUR, 3 * 24 * HOUR, None)


@pytest.mark.parametrize("settings", [
    {}, dict(DEFAULT_SETTINGS), {"thing_away_timeout_h": 0}, {**DEFAULT_SETTINGS, "away_timeout_m": 20},
], ids=["never saved", "defaults", "zero", "defaults, away timeout 20 min"])
@pytest.mark.parametrize("carried", [False, True], ids=["nobody carries it", "on a person"])
def test_with_the_option_off_every_device_goes_away_after_the_away_timeout(settings, carried):
    """The rule both entities had before the option: not_home once the age is
    past the away timeout, the room until then, for a device on a person and
    for one on nobody alike. Who carries what is not even looked up."""
    persons = [_person("Alex", ["device_tracker.keys"])] if carried else []
    for age in AGES:
        hass = _hass(settings, persons=persons, states={"device_tracker.keys": _state(user_label="Keys")})
        obj = _keys(age, sources=["office"])
        timeout = away_timeout_s(hass)
        away = is_away(obj, timeout)
        assert device_away_timeout_s(hass, obj) == timeout
        s, t = _sensor(obj, hass), _tracker(obj, hass)
        assert s.native_value == ("not_home" if away else "Kitchen"), age
        assert t.state == ("not_home" if away else "Kitchen"), age
        sa, ta = s.extra_state_attributes, t.extra_state_attributes
        assert sa["home"] is (not away) and ta["home"] is (not away), age
        assert sa["sources"] == (None if away else ["office"]), age
        assert sa["last_room"] == "Kitchen" == ta["last_room"]          # the one thing added
        assert not hass.states.async_all.called and not hass.states.get.called, age


def test_with_the_option_off_the_attributes_are_the_ones_before_plus_last_room():
    hass = _hass(dict(DEFAULT_SETTINGS))
    assert set(_sensor(_keys(600.0), hass).extra_state_attributes) == {
        "kind", "address", "padspan_id", "rssi", "age_s", "sources", "home", "last_room",
        "room_confidence", "rssi_margin_confidence"}
    assert set(_tracker(_keys(600.0), hass).extra_state_attributes) == {
        "address", "padspan_id", "rssi", "age_s", "user_label", "home", "last_room"}


# ── who carries what ─────────────────────────────────────────────────────────

def test_a_labelled_device_nobody_carries_is_a_thing():
    assert not is_carried(_hass(), _keys(10))
    assert not is_carried(_hass(persons=[_person("Sam", ["device_tracker.pixel"])],
                                states={"device_tracker.pixel": _state(friendly_name="Pixel")}), _keys(10))


def test_picked_for_a_person_in_people_and_devices():
    hass = _hass({"atlas_3d_carries": {"person.alex": [K]}})
    assert is_carried(hass, _keys(10))


def test_picked_under_another_key_of_the_same_device():
    """The phone wizard's iBeacon and IRK keys are one device, by its name."""
    other = "irk:0011"
    hass = _hass({"atlas_3d_carries": {"person.alex": [other]}})
    data = {K: _keys(10), other: {"key": other, "kind": "private_ble", "user_label": "keys"}}
    assert is_carried(hass, _keys(10), data)
    assert not is_carried(hass, _keys(10), {K: _keys(10)})


def test_its_own_tracker_is_on_a_person():
    hass = _hass(persons=[_person("Alex", ["device_tracker.alexs_thing"])])
    assert is_carried(hass, _keys(10), own_entity_id="device_tracker.alexs_thing")
    assert not is_carried(hass, _keys(10), own_entity_id="device_tracker.other")


def test_the_area_sensor_finds_the_tracker_on_a_person_by_its_name():
    """The sensor has no tracker id of its own: PadSpan's tracker says its label."""
    hass = _hass(persons=[_person("Alex", ["device_tracker.renamed"])],
                 states={"device_tracker.renamed": _state(user_label="Keys", friendly_name="Anything")})
    assert is_carried(hass, _keys(10))


def test_an_ha_entity_on_the_same_bluetooth_device_is_on_a_person():
    hass = _hass(persons=[_person("Alex", source="device_tracker.bermuda_keys")])
    assert is_carried(hass, _keys(10, linked_entities=["device_tracker.bermuda_keys"]))


def test_named_as_the_person_or_one_of_their_trackers():
    assert is_carried(_hass(persons=[_person("Keys")]), _keys(10))
    hass = _hass(persons=[_person("Alex", ["device_tracker.pixel_9"])],
                 states={"device_tracker.pixel_9": _state(friendly_name="Pixel 9")})
    assert is_carried(hass, _keys(10, user_label="Pixel 9"))
    assert is_carried(_hass(persons=[_person("Alex", ["device_tracker.alex_phone"])]),
                      _keys(10, user_label="Alex phone"))


def test_carried_uses_the_away_timeout_and_a_thing_the_longer_time():
    assert device_away_timeout_s(_hass(ON), _keys(10)) == 6 * HOUR
    assert device_away_timeout_s(_hass(ON, persons=[_person("Keys")]), _keys(10)) == 300.0
    assert device_away_timeout_s(_hass(), _keys(10)) == 300.0                  # the option off


def test_a_thing_with_no_room_to_keep_goes_away_after_the_away_timeout():
    """Not placed since Home Assistant started: there is no room to keep it
    in, so it reads not_home as it would with the option off, not "unknown"
    for hours."""
    hass = _hass(ON)
    for room in ("", None):
        obj = _keys(HOUR, room=room)
        assert device_away_timeout_s(hass, obj) == 300.0
        s, t = _sensor(obj, hass), _tracker(obj, hass)
        assert s.native_value == "not_home" and t.state == "not_home"
        assert s.extra_state_attributes["last_room"] is None and t.extra_state_attributes["last_room"] is None


# ── the entities ─────────────────────────────────────────────────────────────

def test_a_thing_keeps_its_room_past_the_away_timeout():
    hass = _hass(ON)
    for age in (600.0, HOUR, 5.9 * HOUR):
        s, t = _sensor(_keys(age), hass), _tracker(_keys(age), hass)
        assert s.native_value == "Kitchen" and t.state == "Kitchen", age
        assert s.extra_state_attributes["home"] is True and t.extra_state_attributes["home"] is True
        assert s.extra_state_attributes["last_room"] == "Kitchen" == t.extra_state_attributes["last_room"]


def test_a_thing_reads_not_home_after_its_time_and_says_where_it_was():
    hass = _hass(ON)
    s, t = _sensor(_keys(6.1 * HOUR), hass), _tracker(_keys(6.1 * HOUR), hass)
    assert s.native_value == "not_home" and t.state == "not_home"
    for attrs in (s.extra_state_attributes, t.extra_state_attributes):
        assert attrs["home"] is False and attrs["last_room"] == "Kitchen"


def test_a_person_s_device_still_goes_away_after_the_away_timeout():
    hass = _hass(ON, persons=[_person("Alex", ["device_tracker.keys"])])
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
    for hass in (_hass(), _hass(ON)):
        for age in (5.0, HOUR, 7 * HOUR):
            assert _sensor(_keys(age), hass).available is True
            assert _tracker(_keys(age), hass).available is True


def test_a_thing_keeps_its_room_through_a_real_poll():
    """The object history replays a quiet labelled device with the room it
    had; the poll must hand that room to the entities, not clear it."""
    coord = make_coordinator(ON)
    coord.hass.states.async_all.return_value = []
    coord.data = run_poll(coord, snapshot([ble_object(K, ADDR, age_s=1.0, user_label="Keys", room="Kitchen")]))
    coord.data = run_poll(coord, snapshot([ble_object(K, ADDR, age_s=2 * HOUR, user_label="Keys", room="Kitchen")]))
    assert coord.data[K]["room"] == "Kitchen"
    coord.last_update_success = True
    s = PadSpanAreaSensor.__new__(PadSpanAreaSensor)
    s.coordinator, s._key = coord, K
    assert s.native_value == "Kitchen"
    assert s.extra_state_attributes["last_room"] == "Kitchen"


# ── a thing that goes quiet, through the polls ───────────────────────────────

@pytest.fixture
def house():
    h = _House()
    try:
        yield h
    finally:
        h.close()


def _entities(house, hours):
    """The tag's area sensor and tracker over the house's coordinator, with
    the things' time set to `hours` (0: off)."""
    hass = house.coord.hass
    hass.data[DOMAIN][DATA_SETTINGS].data["thing_away_timeout_h"] = hours
    hass.states.async_all.return_value = []          # nobody carries the tag
    house.coord.last_update_success = True
    s = PadSpanAreaSensor.__new__(PadSpanAreaSensor)
    s.coordinator, s._key = house.coord, TAG
    t = PadSpanDeviceTracker(house.coord, TAG)
    t.entity_id = "device_tracker.keys"
    return s, t


def _read(house, hours):
    s, t = _entities(house, hours)
    assert s.extra_state_attributes["last_room"] == t.extra_state_attributes["last_room"]
    assert s.native_value == t.state
    return s.native_value, s.extra_state_attributes["last_room"]


def _heard_in_the_office_then_quiet(house):
    for n in range(21):
        house.coord.data = house.poll({TAG: 1.0}, {"office": -60, **({"landing": -75} if n % 5 == 0 else {})},
                                      label="Keys")
    assert house.coord.data[TAG]["room"] == "Office"


def test_a_thing_gone_quiet_keeps_its_room_for_its_hours_then_reads_not_home(house):
    """A device nothing hears keeps the room it was in (no receiver's old
    reading moves it), and the snapshot goes on listing it with its real age.
    So a thing reads that room for its hours and not_home after them, and
    `last_room` says where it was all the while. With the option off the same
    polls read not_home once the away timeout has passed."""
    _heard_in_the_office_then_quiet(house)
    for n in range(1, 12):                                   # 55 s of silence
        house.coord.data = house.poll({TAG: 1.0 + n * POLL_S}, label="Keys")
        assert _read(house, 6) == ("Office", "Office") == _read(house, 0)
    for age, on, off in ((301.0, "Office", "not_home"), (HOUR, "Office", "not_home"),
                         (5.9 * HOUR, "Office", "not_home"), (6.1 * HOUR, "not_home", "not_home"),
                         (30 * HOUR, "not_home", "not_home")):
        house.coord.data = house.poll({TAG: age}, label="Keys")
        assert house.coord.data[TAG]["room"] == "Office" and house.coord.data[TAG]["age_s"] == age
        assert _read(house, 6) == (on, "Office"), age
        assert _read(house, 0) == (off, "Office"), age


@pytest.mark.parametrize("quiet_h, with_it_on", [(2, "Office"), (7, "not_home")])
def test_a_thing_no_longer_listed_keeps_its_real_age(house, quiet_h, with_it_on):
    """An object the snapshot stops listing is kept for two minutes with the
    age it had, going on from there. A thing two hours quiet goes on reading
    its room; one past its hours goes on reading not_home, and is not taken
    for just heard."""
    _heard_in_the_office_then_quiet(house)
    house.coord.data = house.poll({TAG: quiet_h * HOUR}, label="Keys")
    for n in range(1, 20):                                   # not listed any more
        house.coord.data = house.poll({})
        assert house.coord.data[TAG]["age_s"] == quiet_h * HOUR + n * POLL_S
        assert _read(house, 6) == (with_it_on, "Office")
        assert _read(house, 0) == ("not_home", "Office")


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
    for name, want in (("unset", "0"), ("saved", "2"), ("zero", "0")):
        d = drawn[name]
        assert d["found"] and d["value"] == want, name
        assert "Home/Away Timeout" in d["card"] and "Away timeout" in d["card"]
        assert "Things keep their room" in d["card"] and "nobody carries" in d["card"]
    # Off is the starting state, and the card says so and what to do first.
    for name in ("unset", "zero"):
        after = drawn[name]["card"].split("Things keep their room")[1]
        assert "Current: off (same as the away timeout)" in after and "Default: off" in after
    assert "Current: 2 h" in drawn["saved"]["card"]
    card = drawn["unset"]["card"]
    assert "off to start with" in card and "phone and watch" in card and "car's tag" in card
    assert "If a device hasn't been detected for this long" in card      # the away timeout is every device's


def test_save_sends_the_hours_kept_in_range(drawn):
    sent = {s["typed"]: s["sent"] for s in drawn["saves"]}
    assert sent == {
        "3": [{"thing_away_timeout_h": 3}], "0": [{"thing_away_timeout_h": 0}],
        "100": [{"thing_away_timeout_h": 48}], "0.1": [{"thing_away_timeout_h": 0.5}],
        "": [{"thing_away_timeout_h": 0}], "-2": [{"thing_away_timeout_h": 0}],
    }
