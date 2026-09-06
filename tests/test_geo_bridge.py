"""Unit tests for geo_bridge.py — fabric metres -> lat/long (gap #5 of the
best-in-class roadmap, docs/BEST_IN_CLASS_ROADMAP.md). Pure math, no HA
dependency.
"""
from __future__ import annotations

import math

import pytest

from custom_components.padspan_ha.geo_bridge import (
    accuracy_from_confidence,
    metres_to_latlon,
)

_ONE_DEG_LAT_M = (math.pi / 180.0) * 6_371_000.0  # ~111,195 m


def test_the_origin_itself_maps_to_the_origin_lat_lon():
    lat, lon = metres_to_latlon(0.0, 0.0, 49.28, -123.12, bearing_deg=0.0)
    assert lat == pytest.approx(49.28)
    assert lon == pytest.approx(-123.12)


def test_bearing_zero_local_plus_y_is_true_north():
    lat, lon = metres_to_latlon(0.0, _ONE_DEG_LAT_M, origin_lat=0.0, origin_lon=0.0, bearing_deg=0.0)
    assert lat == pytest.approx(1.0, abs=1e-6)
    assert lon == pytest.approx(0.0, abs=1e-9)


def test_bearing_zero_local_plus_x_is_true_east():
    # At the equator, a degree of longitude is the same length as a degree
    # of latitude (cos(0) == 1), so the same metre distance along +X should
    # produce the same magnitude of change, in longitude instead of latitude.
    lat, lon = metres_to_latlon(_ONE_DEG_LAT_M, 0.0, origin_lat=0.0, origin_lon=0.0, bearing_deg=0.0)
    assert lat == pytest.approx(0.0, abs=1e-9)
    assert lon == pytest.approx(1.0, abs=1e-6)


def test_bearing_90_rotates_local_plus_y_to_true_east():
    """A fabric whose +Y axis actually points EAST (bearing 90) must turn a
    pure +Y offset into a pure longitude change, not a latitude one."""
    lat, lon = metres_to_latlon(0.0, _ONE_DEG_LAT_M, origin_lat=0.0, origin_lon=0.0, bearing_deg=90.0)
    assert lat == pytest.approx(0.0, abs=1e-6)
    assert lon == pytest.approx(1.0, abs=1e-6)


def test_bearing_180_rotates_local_plus_y_to_true_south():
    lat, lon = metres_to_latlon(0.0, _ONE_DEG_LAT_M, origin_lat=0.0, origin_lon=0.0, bearing_deg=180.0)
    assert lat == pytest.approx(-1.0, abs=1e-6)
    assert lon == pytest.approx(0.0, abs=1e-9)


def test_longitude_degrees_per_metre_shrink_away_from_the_equator():
    """The same east-west metre offset must be a BIGGER longitude delta at
    high latitude than at the equator — meridians converge toward the poles."""
    _, lon_at_equator = metres_to_latlon(1000.0, 0.0, origin_lat=0.0, origin_lon=0.0)
    _, lon_at_high_lat = metres_to_latlon(1000.0, 0.0, origin_lat=60.0, origin_lon=0.0)
    assert abs(lon_at_high_lat) > abs(lon_at_equator)


def test_accuracy_scales_from_tight_at_full_confidence_to_loose_at_none():
    assert accuracy_from_confidence(1.0) == pytest.approx(2.0)
    assert accuracy_from_confidence(0.0) == pytest.approx(20.0)
    assert accuracy_from_confidence(0.5) == pytest.approx(11.0)


def test_accuracy_of_none_confidence_is_the_loose_end_not_an_error():
    assert accuracy_from_confidence(None) == pytest.approx(20.0)


def test_accuracy_clamps_out_of_range_confidence():
    assert accuracy_from_confidence(1.5) == pytest.approx(2.0)
    assert accuracy_from_confidence(-0.5) == pytest.approx(20.0)
