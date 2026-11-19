# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Attributes that change with every poll stay out of HA's database.

The area sensor carried rssi, age_s and two confidences, the tracker rssi and
age_s, and nothing was excluded, so the recorder stored a fresh attributes
row about every 5 s for every labelled device. Home Assistant reads
`_unrecorded_attributes` (a class attribute; its Entity.__init_subclass__
joins it with the platform's own) and leaves those names out of what it
records. They stay live in the state. Slow ones (room, home, names) are
still recorded, so history keeps where a device was.
"""

from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import MagicMock

from custom_components.padspan_ha import device_tracker, sensor
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

K = "ble:AA:BB:CC:DD:EE:01"

# Everything a labelled device's object can carry, so every attribute shows.
OBJ = {
    "key": K, "kind": "ble", "address": "AA:BB:CC:DD:EE:01", "padspan_id": "ps_1",
    "user_label": "Keys", "rssi": -61.0, "tx_power": -59, "age_s": 3.2,
    "sources": [{"source": "kitchen_proxy", "rssi": -61.0, "age_s": 3.2}],
    "_source_rssi": {"kitchen_proxy": -61.0},
    "room": "Kitchen", "room_confidence": 0.8, "rssi_margin_confidence": 0.6,
    "room_unsure": "few_scanners", "ibeacon_uuid": "u", "ibeacon_major": 1, "ibeacon_minor": 2,
    "all_addresses": ["AA:BB:CC:DD:EE:01"], "room_scores": {"Kitchen": 0.7, "Hall": 0.3},
}


def _coordinator(settings: dict | None = None, data: dict | None = None) -> MagicMock:
    coord = MagicMock()
    coord.data = data if data is not None else {K: dict(OBJ)}
    store = MagicMock()
    store.data = settings or {}
    coord.hass.data = {DOMAIN: {DATA_SETTINGS: store}}
    return coord


def _entity(cls, coord, *extra):
    ent = cls.__new__(cls)
    ent.coordinator = coord
    ent._key = K
    if extra:
        ent._source = extra[0]
    return ent


def _attrs(cls) -> set[str]:
    """The attribute names the entity really writes, at their fullest."""
    if cls is sensor.PadSpanOccupancySensor:
        coord = MagicMock()
        coord.data = {"total_estimate": 2, "total_low": 1, "total_high": 3, "confidence": "high",
                      "known": 1, "unknown": 1, "people": [], "rooms": []}
        ent = cls.__new__(cls)
        ent.coordinator = coord
        return set(ent.extra_state_attributes)
    coord = _coordinator({"room_reason_attribute": True})
    extra = ("kitchen_proxy",) if cls is sensor.PadSpanScannerDistanceSensor else ()
    names = set(_entity(cls, coord, *extra).extra_state_attributes)
    if cls is device_tracker.PadSpanDeviceTracker:
        # HA's TrackerEntity.state_attributes adds these with a position
        # (the GPS bridge); the test stub has no state_attributes of its own.
        names |= {"source_type", "latitude", "longitude", "gps_accuracy"}
    return names


# class → (changes every poll: must be unrecorded, slow: must be recorded)
EXPECTED = {
    sensor.PadSpanAreaSensor: (
        {"rssi", "age_s", "sources", "room_confidence", "rssi_margin_confidence", "room_unsure", "room_reason"},
        {"kind", "address", "padspan_id", "home", "ibeacon_uuid", "ibeacon_major", "ibeacon_minor",
         "num_addresses", "all_addresses"},
    ),
    sensor.PadSpanDistanceSensor: ({"rssi", "age_s"}, {"tx_power", "room"}),
    sensor.PadSpanScannerDistanceSensor: ({"rssi", "age_s"}, {"scanner", "room"}),
    sensor.PadSpanOccupancySensor: ({"confidence", "rooms"}, {"minimum", "maximum", "known", "unknown", "people"}),
    device_tracker.PadSpanDeviceTracker: (
        {"rssi", "age_s"},
        # latitude/longitude/gps_accuracy stay recorded: they draw the trail on HA's map
        {"latitude", "longitude", "gps_accuracy", "address", "padspan_id", "user_label", "home", "source_type"},
    ),
}

# Entity classes with nothing that changes per poll: written only when what
# they report changes (a sub-zone's people, Vacation Mode, a guest, a team).
NOTHING_PER_POLL = {
    "PadSpanSubzoneWhoSensor", "PadSpanSubzoneOccupied",
    "PadSpanVacationMode", "PadSpanGuestHome", "PadSpanTeamLight",
}


def test_each_class_declares_its_own_exclusions():
    for cls in EXPECTED:
        unrec = cls.__dict__.get("_unrecorded_attributes")
        assert isinstance(unrec, frozenset), f"{cls.__name__} declares no _unrecorded_attributes"


def test_every_per_poll_attribute_is_unrecorded():
    for cls, (fast, _slow) in EXPECTED.items():
        missing = fast - cls._unrecorded_attributes
        assert not missing, f"{cls.__name__} still records {sorted(missing)} on every poll"


def test_slow_attributes_are_still_recorded():
    for cls, (_fast, slow) in EXPECTED.items():
        hidden = slow & cls._unrecorded_attributes
        assert not hidden, f"{cls.__name__} keeps {sorted(hidden)} out of history"


def test_every_excluded_name_is_one_the_entity_writes():
    """A misspelt name excludes nothing, silently."""
    for cls in EXPECTED:
        unknown = cls._unrecorded_attributes - _attrs(cls)
        assert not unknown, f"{cls.__name__} excludes names it never writes: {sorted(unknown)}"


def test_every_attribute_is_sorted_into_fast_or_slow():
    """A new attribute is decided on: per poll (unrecorded) or slow."""
    for cls, (fast, slow) in EXPECTED.items():
        undecided = _attrs(cls) - fast - slow
        assert not undecided, f"{cls.__name__}: {sorted(undecided)} neither per-poll nor slow here"


def test_the_attributes_stay_live_in_the_state():
    attrs = _entity(sensor.PadSpanAreaSensor, _coordinator()).extra_state_attributes
    assert attrs["rssi"] == -61.0 and attrs["age_s"] == 3.2 and attrs["room_confidence"] == 0.8


def test_every_entity_class_was_considered():
    """A new entity class has to be sorted here too (read from the source:
    the binary_sensor and light platforms need HA modules the stubs lack)."""
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    seen = set()
    for name in ("sensor.py", "binary_sensor.py", "device_tracker.py", "light.py"):
        for node in ast.walk(ast.parse((root / name).read_text(encoding="utf-8"))):
            if isinstance(node, ast.ClassDef) and any("Entity" in ast.unparse(b) for b in node.bases):
                seen.add(node.name)
    considered = {c.__name__ for c in EXPECTED} | NOTHING_PER_POLL
    assert seen and seen <= considered, sorted(seen - considered)
