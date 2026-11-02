# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The entity IDs the panel and the help print are the ones Home Assistant makes.

Home Assistant builds an ID from the name: with has_entity_name it is the
device's name then the entity's (the entity's alone without has_entity_name),
slugified. So a labelled device's IDs carry no padspan_ (device_tracker.car_keys,
sensor.car_keys_area, as in Garry's house: device_tracker.tesla,
sensor.tesla_area), while the entities whose device or own name starts with
"PadSpan" do. The occupancy sensor is both "PadSpan Occupancy" and "Occupancy",
so its ID has the word twice; Manage → HA Entities used to print it once.

Each ID is worked out from the entity classes here, not copied from the screens.
The rule itself is Home Assistant's: the suite stubs Home Assistant
(tests/conftest.py), so it is not run against a real one.
"""

from __future__ import annotations

import re
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

import tests.conftest  # noqa: F401  (HA stubs)

ROOT = Path(__file__).resolve().parents[1]
INT = ROOT / "custom_components" / "padspan_ha"
WWW = INT / "www" / "padspan-ha"
MANAGE = (WWW / "views" / "manage.js").read_text(encoding="utf-8")
MAPS = (WWW / "views" / "maps.js").read_text(encoding="utf-8")
LIGHTS_MAP = (WWW / "views" / "lights_map.js").read_text(encoding="utf-8")
HELP = (WWW / "help_content.js").read_text(encoding="utf-8")


@pytest.fixture()
def P(monkeypatch):
    """The platform modules, on the suite's Home Assistant stubs."""
    monkeypatch.setattr(sys.modules["homeassistant.components.sensor"], "SensorStateClass",
                        SimpleNamespace(MEASUREMENT="measurement"), raising=False)
    mod = types.ModuleType("homeassistant.components.binary_sensor")
    mod.BinarySensorEntity = type("BinarySensorEntity", (), {})
    mod.BinarySensorDeviceClass = SimpleNamespace(OCCUPANCY="occupancy")
    sys.modules.setdefault("homeassistant.components.binary_sensor", mod)
    from custom_components.padspan_ha import binary_sensor, device_tracker, sensor
    return SimpleNamespace(BS=binary_sensor, T=device_tracker, S=sensor)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def _entity_id(domain: str, entity) -> str:
    """Home Assistant's rule for a new entity's ID."""
    name = entity.name if isinstance(getattr(type(entity), "name", None), property) else entity._attr_name
    if getattr(entity, "_attr_has_entity_name", False):
        device = entity.device_info["name"]
        name = device if name is None else f"{device} {name}"
    return f"{domain}.{_slug(name)}"


def _labelled(cls, **extra):
    """A device-bound entity for a device the user labelled "Car Keys"."""
    e = cls.__new__(cls)
    e.coordinator = SimpleNamespace(data={"k": {"user_label": "Car Keys", "kind": "ble", "address": "AA:BB:CC:DD:EE:FF"}})
    e._key = "k"
    e._init_uid = "uid"
    e._init_label = "Car Keys"
    for attr, value in extra.items():
        setattr(e, attr, value)
    return e


def _subzone(cls, zone_name: str):
    z = type("Z", (cls,), {"_zone": {"name": zone_name}})
    e = z.__new__(z)
    e._setup("sz_1")
    return e


def test_a_labelled_devices_ids_have_no_padspan_prefix(P):
    assert _entity_id("device_tracker", _labelled(P.T.PadSpanDeviceTracker)) == "device_tracker.car_keys"
    assert _entity_id("sensor", _labelled(P.S.PadSpanAreaSensor)) == "sensor.car_keys_area"
    assert _entity_id("sensor", _labelled(P.S.PadSpanDistanceSensor)) == "sensor.car_keys_distance"
    per_receiver = _labelled(P.S.PadSpanScannerDistanceSensor, _source="kitchen_proxy")
    assert _entity_id("sensor", per_receiver) == "sensor.car_keys_distance_kitchen_proxy"
    for label in ('label:"device_tracker.{label}"', 'label:"sensor.{label}_area"', 'label:"sensor.{label}_distance"',
                  'label:"sensor.{label}_distance_{scanner}"'):
        assert label in MANAGE, label
    header = P.S.__doc__
    assert "sensor.car_keys_area" in header and "sensor.car_keys_distance_kitchen_proxy" in header
    assert "sensor.padspan_car_keys" not in MANAGE + HELP + header


def test_the_occupancy_sensor_has_its_word_twice(P):
    e = P.S.PadSpanOccupancySensor.__new__(P.S.PadSpanOccupancySensor)
    got = _entity_id("sensor", e)
    assert got == "sensor.padspan_occupancy_occupancy"
    assert f'label:"{got}"' in MANAGE
    assert 'label:"sensor.padspan_occupancy"' not in MANAGE


def test_a_sub_zones_ids_are_prefixed_as_the_screens_say(P):
    occupied = _entity_id("binary_sensor", _subzone(P.BS.PadSpanSubzoneOccupied, "Bed"))
    who = _entity_id("sensor", _subzone(P.S.PadSpanSubzoneWhoSensor, "Bed"))
    assert occupied == "binary_sensor.padspan_bed_occupied" and who == "sensor.padspan_bed_who"
    assert 'label:"binary_sensor.padspan_{sub-zone}_occupied"' in MANAGE
    assert "binary_sensor.padspan_<name>_occupied and sensor.padspan_<name>_who" in MAPS
    assert "binary_sensor.padspan_…_occupied" in HELP


def test_vacation_mode_and_guest_home_are_prefixed_as_the_screens_say(P):
    vacation = _entity_id("binary_sensor", P.BS.PadSpanVacationMode.__new__(P.BS.PadSpanVacationMode))
    guests = _entity_id("binary_sensor", P.BS.PadSpanGuestHome.__new__(P.BS.PadSpanGuestHome))
    assert vacation == "binary_sensor.padspan_vacation_mode" and guests == "binary_sensor.padspan_guest_home"
    assert vacation in HELP and vacation in LIGHTS_MAP
