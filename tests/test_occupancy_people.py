"""The occupancy number is people in the building, not devices.

Pinned from the live install on 2026-08-27: two people were home and the
card said "~8 · 7 identified · 3 BLE clusters · 3 persons home". The seven
"identified" were a key fob, a test beacon, one truck beacon counted twice,
a closet beacon, a box and one phone; "3 persons home" was two person.*
entities on one Pixel plus Nicole; the two "unidentified" were a Windows
PC's non-rotating address and an AirTag-class Find My tag; Nicole's iPhone
— the one phone on the air that IS a person — never became an object.

These tests build that house and require the answer to be 2.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import ws_occupancy
from custom_components.padspan_ha.const import DATA_MODEL, DATA_SETTINGS, DOMAIN

# Apple continuity subtype bytes (ble_enrichment.APPLE_SUBTYPES)
APPLE = {"Nearby Info": 0x10, "AirPlay": 0x09, "iBeacon": 0x02, "Find My": 0x12, "Handoff": 0x0C, "AirPods": 0x07}
MICROSOFT, GOOGLE, GARMIN = 6, 224, 80


# ── builders ────────────────────────────────────────────────────────────────

def _state(entity_id, state, *, changed_s_ago=0.0, **attrs):
    # "now" at the moment THIS fixture is built, not once when the module was
    # collected. compute_occupancy_estimate measures held time against the
    # real wall clock (time.time(), ws_occupancy.py) — a module-level NOW
    # fixed at collection made "cleared 60s ago" drift later and later as the
    # suite ran, until a long enough run pushed it past MOTION_RECENT_S (120s)
    # and flipped this test to failing depending on where in the suite (and
    # how long the suite had been running) it happened to land — passed every
    # time run alone, failed only sometimes under the full ~1s-per-test suite.
    now = datetime.now(timezone.utc)
    return SimpleNamespace(entity_id=entity_id, state=state, attributes=attrs,
                           last_changed=now - timedelta(seconds=changed_s_ago))


def _person(eid, name, tracker, state="home"):
    attrs = {"friendly_name": name}
    if tracker:
        attrs["source"] = tracker
        attrs["device_trackers"] = [tracker]
    return _state(eid, state, **attrs)


def _tracker(eid, name):
    return _state(eid, "home", friendly_name=name)


def _sensor(eid, device_class, state, area, *, changed_s_ago=0.0, name=None):
    """(state, HA area) — the area is what the registry would answer."""
    return _state(eid, state, changed_s_ago=changed_s_ago, device_class=device_class,
                  friendly_name=name or eid), area


def _ad(addr, source, rssi, *, apple=None, company=None, name=None, services=()):
    manuf = {}
    if apple is not None:
        manuf["76"] = f"0x{APPLE[apple]:02X} 0x05 0x00"
    if company is not None:
        manuf[str(company)] = "0x00 0x01"
    return {"address": addr, "name": name or addr, "source": source, "rssi": rssi,
            "manufacturer_data": manuf, "service_uuids": list(services)}


def _obj(key, kind, *, label=None, room=None, age=5.0, padspan_id=None, address=None,
         linked=(), name=None, all_addresses=()):
    return {"key": key, "kind": kind, "user_label": label, "room": room, "age_s": age,
            "padspan_id": padspan_id, "address": address or key.split(":", 1)[-1],
            "linked_entities": list(linked), "name": name or label or key,
            "all_addresses": list(all_addresses)}


def _hass(monkeypatch, *, persons=(), trackers=(), sensors=(), objects=None, ads=(),
          scanners=None, settings=None, ble_missing=False):
    h = MagicMock()
    st = SimpleNamespace(data=dict(settings or {}), store=SimpleNamespace(async_save=AsyncMock()))
    scanners = scanners or {}
    mdl = SimpleNamespace(get_scanner_mappings=lambda: (
        {s: r for s, (r, _f) in scanners.items()}, {s: f for s, (_r, f) in scanners.items()}))
    pc = SimpleNamespace(data=dict(objects or {}))
    h.data = {DOMAIN: {DATA_SETTINGS: st, DATA_MODEL: mdl, "presence_coordinator": pc}}
    states = list(persons) + list(trackers) + [s for s, _a in sensors]
    areas = {s.entity_id: a for s, a in sensors}
    h.states.async_all = lambda domain=None: [
        s for s in states if domain is None or s.entity_id.startswith(domain + ".")]
    h.states.get = lambda eid: next((s for s in states if s.entity_id == eid), None)
    ble = MagicMock()
    ble.get_snapshot = lambda **kw: {"advertisements": list(ads)}
    monkeypatch.setattr(ws_occupancy, "get_bluetooth_live", lambda hass: None if ble_missing else ble)
    monkeypatch.setattr(ws_occupancy, "_entity_area_name", lambda hass, eid: areas.get(eid))
    return h


def _estimate(h):
    return asyncio.new_event_loop().run_until_complete(ws_occupancy.compute_occupancy_estimate(h))


SCANNERS = {"s1": ("Living Room", "main"), "s2": ("Kitchen", "main"), "s3": ("Bedroom", "upper")}

PERSONS = [
    _person("person.remote", "remote", "device_tracker.pixel_8_pro"),
    _person("person.pixel", "pixel", "device_tracker.pixel_8_pro"),
    _person("person.nicole", "Nicole", "device_tracker.iphone"),
    _person("person.admin", "admin", None, state="unknown"),
]
TRACKERS = [_tracker("device_tracker.pixel_8_pro", "Pixel 8 Pro"), _tracker("device_tracker.iphone", "iPhone")]

# A phone + its watch (or its last rotation): same fingerprint, both Nearby Info.
IPHONE_PAIR = [
    _ad("4F:49:7F:E7:CD:2B", "s1", -69, apple="Nearby Info"), _ad("4F:49:7F:E7:CD:2B", "s2", -80, apple="Nearby Info"),
    _ad("75:88:1D:26:CE:2B", "s1", -70, apple="Nearby Info"), _ad("75:88:1D:26:CE:2B", "s2", -81, apple="Nearby Info"),
]
NOT_PEOPLE_ON_THE_AIR = [
    _ad("7F:4B:C2:3F:12:01", "s1", -52, apple="AirPlay"), _ad("7F:4B:C2:3F:12:01", "s2", -60, apple="AirPlay"),   # Apple TV
    _ad("2E:02:12:A7:8B:69", "s1", -74, company=MICROSOFT), _ad("2E:02:12:A7:8B:69", "s2", -76, company=MICROSOFT),  # Windows PC, NRPA
    _ad("E7:AA:DF:CD:66:7D", "s1", -71, apple="Find My"), _ad("E7:AA:DF:CD:66:7D", "s2", -82, apple="Find My"),   # AirTag, static
    _ad("64:24:24:DF:5F:7A", "s1", -65, company=GOOGLE, name="Living Room TV"),
    _ad("64:24:24:DF:5F:7A", "s2", -66, company=GOOGLE, name="Living Room TV"),                                     # named hardware
    _ad("55:C0:1F:A1:C7:1B", "s1", -62, apple="iBeacon"), _ad("55:C0:1F:A1:C7:1B", "s3", -70, apple="iBeacon"),   # the Pixel's transmitter
]
THINGS = {
    "ibeacon:pixel": _obj("ibeacon:pixel", "ibeacon", label="Pixel 8 Pro", room="Living Room",
                          padspan_id="ps_pixel", address="55:C0:1F:A1:C7:1B"),
    "ble:DD:E1:C8:89:75:73": _obj("ble:DD:E1:C8:89:75:73", "ble", label="GarryBroncoKeys", room="Bedroom", padspan_id="ps_keys"),
    "ibeacon:bronco:a": _obj("ibeacon:bronco:a", "ibeacon", label="Bronco", room="Garry's Office", padspan_id="ps_bronco"),
    "ibeacon:bronco:b": _obj("ibeacon:bronco:b", "ibeacon", label="Bronco", room="Garry's Office", padspan_id="ps_bronco"),
    "ibeacon:e2c5": _obj("ibeacon:e2c5", "ibeacon", label="iBeacon e2c56db5", room="Living Room", padspan_id="ps_e2c5"),
    "ibeacon:box": _obj("ibeacon:box", "ibeacon", label="MaschineBOX", room="Spare Bedroom Closet", padspan_id="ps_box"),
    "entity:sensor.fsc_bp103b_area_last_seen": _obj("entity:sensor.fsc_bp103b_area_last_seen", "entity",
                                                    room="Garry's Office", age=None, padspan_id="ps_fsc",
                                                    name="Test Beacon Feasycom"),
}
SENSORS = [
    _sensor("binary_sensor.living_room_occupancy", "occupancy", "on", "Living Room"),
    _sensor("binary_sensor.smartsensor_occupancy", "occupancy", "on", "Bedroom", name="G7TG Occupancy"),
    _sensor("binary_sensor.alarm_di1", "motion", "on", "Utility", changed_s_ago=30 * 3600, name="Utility Room"),
    _sensor("binary_sensor.garage_radar_occupancy", "occupancy", "on", "Outside", name="Driveway Radar Occupancy"),
    _sensor("binary_sensor.pantry_motion", "motion", "off", "Pantry", changed_s_ago=3000),
]


def _the_house(monkeypatch, **over):
    kw = dict(persons=PERSONS, trackers=TRACKERS, sensors=SENSORS, objects=THINGS,
              ads=IPHONE_PAIR + NOT_PEOPLE_ON_THE_AIR, scanners=SCANNERS)
    kw.update(over)
    return _hass(monkeypatch, **kw)


# ── the house, as it was ────────────────────────────────────────────────────

def test_two_people_home_is_two(monkeypatch):
    res = _estimate(_the_house(monkeypatch))
    assert res["total_estimate"] == 2
    assert res["total_low"] == 2
    assert res["known"] == 2 and res["unknown"] == 0
    assert res["confidence"] == "medium"  # Nicole is home but nothing places her


def test_two_person_entities_on_one_phone_are_one_person(monkeypatch):
    res = _estimate(_the_house(monkeypatch))
    names = [p["name"] for p in res["people"]]
    assert names.count("remote") + names.count("pixel") == 1
    garry = next(p for p in res["people"] if p["name"] in ("remote", "pixel"))
    assert "pixel" in garry["aliases"] or "remote" in garry["aliases"]


def test_the_phone_places_its_owner(monkeypatch):
    """The 'Pixel 8 Pro' object is Garry's phone: it puts him in the Living Room, it is not a person."""
    res = _estimate(_the_house(monkeypatch))
    garry = next(p for p in res["people"] if p["name"] in ("remote", "pixel"))
    assert garry["room"] == "Living Room"
    assert "Pixel 8 Pro" not in [t["label"] for t in res["evidence"]["things_seen"]]
    assert res["evidence"]["persons_unlocated"] == ["Nicole"]


def test_labelled_things_are_listed_and_never_counted(monkeypatch):
    res = _estimate(_the_house(monkeypatch))
    labels = sorted(t["label"] for t in res["evidence"]["things_seen"])
    assert labels == ["Bronco", "GarryBroncoKeys", "MaschineBOX", "Test Beacon Feasycom", "iBeacon e2c56db5"]
    # two iBeacon keys, one padspan_id, one thing
    assert labels.count("Bronco") == 1


def test_the_unclaimed_iphone_is_nicole_not_a_stranger(monkeypatch):
    """A phone in the room Garry is placed in is his second device; the occupied
    bedroom with nobody placed is where Nicole is assumed to be — nobody is a stranger."""
    res = _estimate(_the_house(monkeypatch))
    ev = res["evidence"]
    assert ev["phone_addresses"] == 2 and ev["phone_clusters"] == 1
    assert res["unknown"] == 0
    nicole = next(p for p in res["people"] if p["name"] == "Nicole")
    assert nicole["room"] == "Bedroom" and nicole["assumed"] is True and "assumed" in nicole["via"]
    assert ev["persons_unlocated"] == ["Nicole"]  # assumed is not placed
    assert (res["total_low"], res["total_high"]) == (2, 2)


def test_sensors_by_device_class_and_area(monkeypatch):
    res = _estimate(_the_house(monkeypatch))
    ev = res["evidence"]
    assert ev["occupancy_rooms"] == ["Living Room", "Bedroom"]      # the driveway radar (area Outside) is not a room
    assert ev["motion_rooms"] == []                                  # 30 h of 'on' is a held input, 50 min 'off' is nobody
    assert ev["stuck_sensors"] == ["binary_sensor.alarm_di1"]
    assert ev["unaccounted_rooms"] == []                             # Living Room has Garry, Bedroom gets Nicole
    rooms = {r["room"]: r for r in res["rooms"]}
    assert rooms["Living Room"]["people"] == [next(p["name"] for p in res["people"] if p["name"] in ("remote", "pixel"))]
    assert rooms["Living Room"]["phones"] == 1 and rooms["Living Room"]["occupancy"] is True
    assert rooms["Bedroom"]["people"] == ["Nicole"] and rooms["Bedroom"]["occupancy"] is True


# ── each rule on its own ────────────────────────────────────────────────────

def test_a_house_of_tagged_things_and_nobody_home_is_empty(monkeypatch):
    res = _estimate(_hass(monkeypatch, objects=THINGS, scanners=SCANNERS, sensors=[]))
    assert (res["total_estimate"], res["total_low"], res["total_high"]) == (0, 0, 0)
    assert res["confidence"] == "low"
    assert len(res["evidence"]["things_seen"]) == 6  # nobody claims the Pixel either


BEDROOM_PAIR = [
    _ad("4F:49:7F:E7:CD:2B", "s3", -60, apple="Nearby Info"), _ad("4F:49:7F:E7:CD:2B", "s2", -85, apple="Nearby Info"),
    _ad("75:88:1D:26:CE:2B", "s3", -61, apple="Nearby Info"), _ad("75:88:1D:26:CE:2B", "s2", -86, apple="Nearby Info"),
]


def test_a_phone_where_no_known_person_is_is_a_guest(monkeypatch):
    persons = [_person("person.garry", "Garry", "device_tracker.pixel_8_pro")]
    res = _estimate(_hass(monkeypatch, persons=persons, trackers=TRACKERS, objects=THINGS,
                          ads=BEDROOM_PAIR, scanners=SCANNERS))
    assert res["known"] == 1 and res["unknown"] == 1
    assert (res["total_estimate"], res["total_low"], res["total_high"]) == (2, 2, 2)
    guest = next(p for p in res["people"] if p["kind"] == "unknown")
    assert guest["room"] == "Bedroom" and guest["via"] == "2 rotating addresses"


def test_a_phone_in_the_room_a_known_person_is_placed_in_is_theirs(monkeypatch):
    """Garry is in the Living Room by his Pixel; an anonymous phone there is his watch, not a guest."""
    persons = [_person("person.garry", "Garry", "device_tracker.pixel_8_pro")]
    res = _estimate(_hass(monkeypatch, persons=persons, trackers=TRACKERS, objects=THINGS,
                          ads=IPHONE_PAIR, scanners=SCANNERS))
    assert res["known"] == 1 and res["unknown"] == 0 and res["total_estimate"] == 1


def test_two_phone_clusters_in_one_room_are_one_person(monkeypatch):
    """A phone on the desk and a watch on the wrist do not share a fingerprint; they share a room."""
    apart_in_one_room = [
        _ad("4F:49:7F:E7:CD:2B", "s1", -55, apple="Nearby Info"), _ad("4F:49:7F:E7:CD:2B", "s2", -70, apple="Nearby Info"),
        _ad("75:88:1D:26:CE:2B", "s1", -72, apple="Nearby Info"), _ad("75:88:1D:26:CE:2B", "s2", -90, apple="Nearby Info"),
    ]
    res = _estimate(_hass(monkeypatch, ads=apart_in_one_room, scanners=SCANNERS))
    assert res["evidence"]["phone_addresses"] == 2 and res["evidence"]["phone_clusters"] == 1
    assert res["total_estimate"] == 1
    assert res["people"][0]["via"] == "2 rotating addresses"


@pytest.mark.parametrize("addr,kw,counts", [
    ("4F:49:7F:E7:CD:2B", dict(apple="Nearby Info"), True),     # iPhone / Apple Watch, LA bit set
    ("4D:49:7F:E7:CD:2B", dict(apple="Nearby Info"), True),     # same, LA bit clear — the bit is random
    ("4F:49:7F:E7:CD:2B", dict(apple="Handoff"), True),
    ("4F:49:7F:E7:CD:2B", dict(company=GARMIN), True),          # Garmin watch
    ("4F:49:7F:E7:CD:2B", dict(services=["180d"]), True),       # heart-rate broadcaster on a rotating address
    ("7F:4B:C2:3F:12:01", dict(apple="AirPlay"), False),        # Apple TV / HomePod
    ("4F:49:7F:E7:CD:2B", dict(apple="AirPods"), False),        # earbuds
    ("4F:49:7F:E7:CD:2B", dict(apple="iBeacon"), False),        # a beacon (the Companion transmitter)
    ("E7:AA:DF:CD:66:7D", dict(apple="Find My"), False),        # AirTag, static random address
    ("47:AA:DF:CD:66:7D", dict(apple="Find My"), False),        # Find My on a rotating address is still a tag
    ("2E:02:12:A7:8B:69", dict(company=MICROSOFT), False),      # Windows PC, non-resolvable address
    ("6F:4F:F3:CB:62:89", dict(company=MICROSOFT), False),      # Windows PC on a rotating address
    ("64:24:24:DF:5F:7A", dict(company=GOOGLE, name="Living Room TV"), False),  # named hardware
    ("4F:49:7F:E7:CD:2B", dict(apple="Nearby Info", name="Garrys MacBook"), False),  # a named rotating emitter is a Mac
    ("DD:E1:C8:89:75:73", dict(apple="Nearby Info"), False),    # public address
])
def test_phone_class_classifier(monkeypatch, addr, kw, counts):
    ads = [_ad(addr, "s1", -60, **kw), _ad(addr, "s2", -70, **kw)]
    res = _estimate(_hass(monkeypatch, ads=ads, scanners=SCANNERS))
    assert (res["evidence"]["phone_addresses"] == 1) is counts, (addr, kw)


def test_a_phone_must_be_heard_strongly_by_two_scanners(monkeypatch):
    weak = [_ad("4F:49:7F:E7:CD:2B", "s1", -80, apple="Nearby Info"), _ad("4F:49:7F:E7:CD:2B", "s2", -85, apple="Nearby Info")]
    single = [_ad("4F:49:7F:E7:CD:2B", "s1", -50, apple="Nearby Info")]
    assert _estimate(_hass(monkeypatch, ads=weak, scanners=SCANNERS))["evidence"]["phone_addresses"] == 0
    assert _estimate(_hass(monkeypatch, ads=single, scanners=SCANNERS))["evidence"]["phone_addresses"] == 0


def test_a_rotation_or_a_watch_is_the_same_person_a_different_spot_is_not(monkeypatch):
    together = _estimate(_hass(monkeypatch, ads=IPHONE_PAIR, scanners=SCANNERS))
    assert together["evidence"]["phone_clusters"] == 1 and together["total_estimate"] == 1
    apart = [
        _ad("4F:49:7F:E7:CD:2B", "s1", -60, apple="Nearby Info"), _ad("4F:49:7F:E7:CD:2B", "s2", -85, apple="Nearby Info"),
        _ad("75:88:1D:26:CE:2B", "s3", -60, apple="Nearby Info"), _ad("75:88:1D:26:CE:2B", "s2", -88, apple="Nearby Info"),
    ]
    res = _estimate(_hass(monkeypatch, ads=apart, scanners=SCANNERS))
    assert res["evidence"]["phone_clusters"] == 2 and res["total_estimate"] == 2
    assert sorted(p["room"] for p in res["people"]) == ["Bedroom", "Living Room"]


def test_the_owners_own_addresses_are_never_strangers(monkeypatch):
    """An IRK-resolved phone's rotating addresses belong to that object, whatever they advertise."""
    phone = _obj("private:nicole", "private_ble", name="Nicole's iPhone", room="Nicole's Office",
                 address="4F:49:7F:E7:CD:2B", all_addresses=["75:88:1D:26:CE:2B"])
    res = _estimate(_hass(monkeypatch, objects={"private:nicole": phone}, ads=IPHONE_PAIR, scanners=SCANNERS))
    assert res["evidence"]["phone_addresses"] == 0
    assert res["known"] == 1 and res["people"][0]["room"] == "Nicole's Office"
    assert res["people"][0]["via"] == "Nicole's iPhone (IRK)"


def test_an_irk_phone_merges_with_its_person(monkeypatch):
    phone = _obj("private:nicole", "private_ble", name="iPhone", room="Nicole's Office", address="4F:49:7F:E7:CD:2B")
    res = _estimate(_hass(monkeypatch, persons=[PERSONS[2]], trackers=TRACKERS,
                          objects={"private:nicole": phone}, scanners=SCANNERS))
    assert res["known"] == 1
    assert res["people"][0]["name"] == "Nicole" and res["people"][0]["room"] == "Nicole's Office"
    assert res["confidence"] == "high"


def test_an_occupied_room_with_nobody_placed_is_possibly_someone(monkeypatch):
    """Garry is placed by a weak beacon; an occupied bedroom raises the ceiling, not the count."""
    persons = [_person("person.garry", "Garry", "device_tracker.pixel_8_pro")]
    sensors = [_sensor("binary_sensor.bedroom_presence", "presence", "on", "Bedroom")]
    res = _estimate(_hass(monkeypatch, persons=persons, trackers=TRACKERS, objects=THINGS, sensors=sensors, scanners=SCANNERS))
    assert (res["total_estimate"], res["total_low"], res["total_high"]) == (1, 1, 2)
    assert res["unknown"] == 0 and all(p["kind"] == "known" for p in res["people"])
    assert res["evidence"]["unaccounted_rooms"] == ["Bedroom"]
    assert res["confidence"] == "medium"


def test_occupied_rooms_are_the_floor_when_nobody_is_known(monkeypatch):
    sensors = [
        _sensor("binary_sensor.bedroom_presence", "presence", "on", "Bedroom"),
        _sensor("binary_sensor.living_room_occupancy", "occupancy", "on", "Living Room"),
    ]
    res = _estimate(_hass(monkeypatch, sensors=sensors, scanners=SCANNERS))
    assert (res["total_estimate"], res["total_low"], res["total_high"]) == (2, 0, 2)
    assert [p["name"] for p in res["people"]] == ["Someone", "Someone"]
    assert sorted(p["room"] for p in res["people"]) == ["Bedroom", "Living Room"]
    assert res["confidence"] == "low"
    motion_only = [_sensor("binary_sensor.pantry_motion", "motion", "on", "Pantry")]
    res = _estimate(_hass(monkeypatch, sensors=motion_only, scanners=SCANNERS))
    assert res["total_estimate"] == 1 and res["people"][0] == {"name": "Someone", "kind": "unknown", "room": "Pantry", "via": "motion"}


def test_motion_that_just_cleared_still_counts_and_a_held_input_does_not(monkeypatch):
    fresh = [_sensor("binary_sensor.pantry_motion", "motion", "off", "Pantry", changed_s_ago=60)]
    held = [_sensor("binary_sensor.alarm_di1", "motion", "on", "Utility", changed_s_ago=2 * 3600)]
    assert _estimate(_hass(monkeypatch, sensors=fresh, scanners=SCANNERS))["evidence"]["motion_rooms"] == ["Pantry"]
    res = _estimate(_hass(monkeypatch, sensors=held, scanners=SCANNERS))
    assert res["evidence"]["motion_rooms"] == [] and res["evidence"]["stuck_sensors"] == ["binary_sensor.alarm_di1"]


def test_outdoor_and_unplaced_sensors_are_not_rooms(monkeypatch):
    sensors = [
        _sensor("binary_sensor.driveway", "occupancy", "on", "Outside"),
        _sensor("binary_sensor.deck", "motion", "on", "Deck"),
        _sensor("binary_sensor.orphan", "occupancy", "on", None),
        _sensor("binary_sensor.doorbell", "occupancy", "unavailable", "Front Door"),
    ]
    scanners = dict(SCANNERS, s4=("Deck", "__outside__"))
    res = _estimate(_hass(monkeypatch, sensors=sensors, scanners=scanners))
    assert res["evidence"]["occupancy_rooms"] == [] and res["evidence"]["motion_rooms"] == []
    assert res["total_estimate"] == 0


def test_sensor_area_is_matched_to_the_fabric_spelling(monkeypatch):
    sensors = [_sensor("binary_sensor.lr", "occupancy", "on", "living room")]
    res = _estimate(_hass(monkeypatch, sensors=sensors, scanners=SCANNERS))
    assert res["evidence"]["occupancy_rooms"] == ["Living Room"]


def test_hybrid_off_is_phones_only(monkeypatch):
    res = _estimate(_the_house(monkeypatch, settings={"occupancy_hybrid_enabled": False}))
    assert res["hybrid_enabled"] is False
    assert res["known"] == 0 and res["evidence"]["persons_home"] == []
    assert res["evidence"]["occupancy_rooms"] == []
    assert (res["total_estimate"], res["total_low"], res["total_high"]) == (1, 1, 1)
    assert res["confidence"] == "low"


def test_a_room_named_after_someone_is_assumed_to_be_theirs(monkeypatch):
    """Two people home, neither placed by a device: the phone in Nicole's Office is Nicole's,
    the occupied Garry's Office is Garry's — not first-come, first-placed."""
    persons = [_person("person.garry", "Garry", "device_tracker.pixel_8_pro"), PERSONS[2]]
    scanners = dict(SCANNERS, s5=("Nicole's Office", "upper"))
    ads = [_ad("4F:49:7F:E7:CD:2B", "s5", -58, apple="Nearby Info"), _ad("4F:49:7F:E7:CD:2B", "s2", -84, apple="Nearby Info")]
    sensors = [_sensor("binary_sensor.office_occupancy", "occupancy", "on", "Garry's Office")]
    res = _estimate(_hass(monkeypatch, persons=persons, trackers=TRACKERS, ads=ads, sensors=sensors, scanners=scanners))
    where = {p["name"]: p["room"] for p in res["people"]}
    assert where == {"Garry": "Garry's Office", "Nicole": "Nicole's Office"}
    assert all(p["assumed"] for p in res["people"])
    assert (res["total_estimate"], res["total_low"], res["total_high"]) == (2, 2, 2)


def test_an_object_that_is_away_places_nobody(monkeypatch):
    """The Pixel went quiet: Garry is still home per HA, and the phone nearby is only assumed to be his."""
    gone = dict(THINGS)
    gone["ibeacon:pixel"] = dict(THINGS["ibeacon:pixel"], age_s=900.0)
    res = _estimate(_the_house(monkeypatch, objects=gone))
    garry = next(p for p in res["people"] if p["name"] in ("remote", "pixel"))
    assert garry["room"] == "Living Room" and garry["assumed"] is True
    assert sorted(res["evidence"]["persons_unlocated"]) == ["Nicole", garry["name"]]
    assert res["total_estimate"] == 2


def test_no_bluetooth_is_still_a_full_answer(monkeypatch):
    res = _estimate(_the_house(monkeypatch, ble_missing=True))
    for key in ("total_estimate", "total_low", "total_high", "confidence", "people", "rooms", "evidence", "known", "unknown"):
        assert key in res
    assert res["total_estimate"] == 2 and res["evidence"]["phone_clusters"] == 0


# ── training records what was said, and says nothing about multipliers ──────

def test_training_records_the_estimate_beside_the_truth(monkeypatch):
    h = _the_house(monkeypatch)
    conn = MagicMock()
    asyncio.new_event_loop().run_until_complete(
        ws_occupancy.ws_occupancy_train(h, conn, {"id": 7, "actual_count": 2}))
    (msg_id, payload), _ = conn.send_result.call_args
    assert msg_id == 7 and payload["ok"] is True and payload["total_observations"] == 1
    obs = payload["observation"]
    assert obs["actual"] == 2 and obs["estimated"] == 2 and obs["known"] == 2 and obs["unknown"] == 0
    assert "computed_multiplier" not in obs
    st = h.data[DOMAIN][DATA_SETTINGS]
    assert st.data["occupancy_training"] == [obs]
    st.store.async_save.assert_awaited_once()
