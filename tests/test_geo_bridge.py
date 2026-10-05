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


def test_bearing_zero_local_plus_x_is_true_west():
    """The fabric is y-DOWN (+Y runs down the plan): with +Y pointing north,
    +X — right on the plan — points WEST (backlog 2026-10-05: the bridge took
    the fabric for y-up and put every house the wrong way round). At the
    equator a degree of longitude is as long as one of latitude (cos 0 = 1)."""
    lat, lon = metres_to_latlon(_ONE_DEG_LAT_M, 0.0, origin_lat=0.0, origin_lon=0.0, bearing_deg=0.0)
    assert lat == pytest.approx(0.0, abs=1e-9)
    assert lon == pytest.approx(-1.0, abs=1e-6)


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


_D = _ONE_DEG_LAT_M
_S37, _C37 = math.sin(math.radians(37)), math.cos(math.radians(37))


@pytest.mark.parametrize("bearing,x_m,y_m,dlat,dlon", [
    # fabric_bearing_deg is the compass bearing of fabric +Y; +Y runs DOWN the plan.
    (0, 0.0, _D, 1, 0), (0, _D, 0.0, 0, -1),                # +Y north, so +X west
    (90, _D, 0.0, 1, 0), (90, 0.0, _D, 0, 1),               # +Y east: +X north
    (180, 0.0, -_D, 1, 0), (180, _D, 0.0, 0, 1),            # a plan drawn north-up: up is north, right is east
    (270, -_D, 0.0, 1, 0), (270, 0.0, -_D, 0, 1),           # +Y west: -X north, -Y east
    (37, _D * _S37, _D * _C37, 1, 0), (37, -_D * _C37, _D * _S37, 0, 1),
    (37, _D * (_S37 - _C37), _D * (_C37 + _S37), 1, 1),     # north and east together
])
def test_known_points_land_the_right_way_round(bearing, x_m, y_m, dlat, dlon):
    lat, lon = metres_to_latlon(x_m, y_m, origin_lat=0.0, origin_lon=0.0, bearing_deg=bearing)
    assert (lat, lon) == (pytest.approx(dlat, abs=1e-6), pytest.approx(dlon, abs=1e-6))


def test_north_and_east_are_the_3d_houses_own():
    """One maths for the bearing: geo_bridge.fabric_compass is
    views/fabric_compass.js's fabricCompass, which the 3D house's sun and
    compass and the Settings preview use."""
    import json
    import shutil
    import subprocess
    from pathlib import Path

    from custom_components.padspan_ha.geo_bridge import fabric_compass
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    js = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
          / "views" / "fabric_compass.js").as_uri()
    bearings = [0, 37, 90, 137.25, 180, 270, 359.5, -45, 400]
    code = (f"const m = await import({json.dumps(js)}); "
            f"console.log(JSON.stringify({json.dumps(bearings)}.map(b => m.fabricCompass(b))));")
    res = subprocess.run([node, "--input-type=module", "-e", code], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    for b, want in zip(bearings, json.loads(res.stdout)):
        north, east = fabric_compass(b)
        assert list(north) == pytest.approx(want["north"], abs=1e-12), b
        assert list(east) == pytest.approx(want["east"], abs=1e-12), b


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
