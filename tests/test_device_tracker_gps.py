"""GPS bridge properties on PadSpanDeviceTracker (gap #5 of the best-in-class
roadmap, docs/BEST_IN_CLASS_ROADMAP.md).

device_tracker.py had zero test coverage before this — importing it under
the test stub raised a metaclass TypeError, because TrackerEntity fell back
to None (no real HA install) and `class Foo(Base, None)` is invalid. Fixed
by stubbing homeassistant.components.device_tracker in conftest.py (see its
own comment) — a prerequisite for testing this file at all, not specific to
GPS.
"""
from __future__ import annotations

from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.device_tracker import PadSpanDeviceTracker


def _make_tracker(obj: dict, settings: dict | None = None) -> PadSpanDeviceTracker:
    coordinator = MagicMock()
    coordinator.data = {"key1": obj}
    coordinator.hass = MagicMock()
    mock_settings = MagicMock()
    mock_settings.data = settings or {}
    coordinator.hass.data = {DOMAIN: {DATA_SETTINGS: mock_settings}}
    return PadSpanDeviceTracker(coordinator, "key1")


def test_no_origin_configured_means_no_gps_not_null_island():
    t = _make_tracker({"x_m": 4.0, "y_m": -3.0})
    assert t.latitude is None
    assert t.longitude is None
    assert t.location_accuracy == 0


def test_origin_configured_but_object_has_no_position_means_no_gps():
    t = _make_tracker({}, settings={"fabric_origin_lat": 49.0, "fabric_origin_lon": -123.0})
    assert t.latitude is None
    assert t.longitude is None


def test_origin_and_position_both_present_yields_real_coordinates():
    t = _make_tracker(
        {"x_m": 0.0, "y_m": 0.0, "knn_confidence": 0.9},
        settings={"fabric_origin_lat": 49.28, "fabric_origin_lon": -123.12, "fabric_bearing_deg": 0.0},
    )
    assert t.latitude == 49.28
    assert t.longitude == -123.12
    assert 0 < t.location_accuracy <= 20


def test_location_accuracy_reflects_position_confidence():
    confident = _make_tracker(
        {"x_m": 1.0, "y_m": 1.0, "knn_confidence": 1.0},
        settings={"fabric_origin_lat": 0.0, "fabric_origin_lon": 0.0},
    )
    unconfident = _make_tracker(
        {"x_m": 1.0, "y_m": 1.0, "knn_confidence": 0.0},
        settings={"fabric_origin_lat": 0.0, "fabric_origin_lon": 0.0},
    )
    assert confident.location_accuracy < unconfident.location_accuracy


def test_a_missing_origin_lat_alone_still_disables_gps():
    t = _make_tracker(
        {"x_m": 1.0, "y_m": 1.0},
        settings={"fabric_origin_lat": None, "fabric_origin_lon": -123.0},
    )
    assert t.latitude is None and t.longitude is None


def test_room_confidence_is_the_fallback_when_knn_confidence_is_absent():
    t = _make_tracker(
        {"x_m": 1.0, "y_m": 1.0, "room_confidence": 0.8},
        settings={"fabric_origin_lat": 0.0, "fabric_origin_lon": 0.0},
    )
    assert t.location_accuracy > 0
