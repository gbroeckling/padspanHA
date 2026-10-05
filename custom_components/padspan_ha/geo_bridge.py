# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
GPS geolocation bridge (gap #5, best-in-class roadmap): fabric metres ->
real latitude/longitude, so a tracked object's device_tracker can plot on
HA's built-in map.

Pure — no HA dependency, no I/O. The fabric's (x_m, y_m) plane (model.py's
scanner_positions_m / room_geometry_m) has no inherent relationship to true
north or a real-world location — verified by searching the whole backend
for any existing lat/long/bearing/origin concept and finding none. An
origin (lat, lon) plus a bearing anchor it; both are new settings fields
(settings_store.py's fabric_origin_lat/lon/bearing_deg), None until a
person sets them.

Equirectangular approximation — accurate to a few centimetres at house
scale, nowhere near where a geodesic (Vincenty) correction would matter.
"""

import math

EARTH_RADIUS_M = 6_371_000.0


def fabric_compass(bearing_deg: float) -> tuple[tuple[float, float], tuple[float, float]]:
    """North and east as unit vectors in fabric coordinates: x right and y
    DOWN the plan, as it is drawn (a map's metres are origin + frac x scale,
    positive scales). bearing_deg (settings.fabric_bearing_deg) is the
    compass bearing, clockwise from true north, that fabric +Y points
    toward, so a plan drawn north-up has bearing 180: north (0, -1), the
    top, and east (1, 0), the right. At 0, +Y is north and +X is WEST.

    The same maths as views/fabric_compass.js's fabricCompass (the 3D
    house's sun and compass, the Settings preview); a test holds the two
    equal (tests/test_geo_bridge.py)."""
    b = math.radians(bearing_deg)
    return (math.sin(b), math.cos(b)), (-math.cos(b), math.sin(b))


def metres_to_latlon(
    x_m: float,
    y_m: float,
    origin_lat: float,
    origin_lon: float,
    bearing_deg: float = 0.0,
) -> tuple[float, float]:
    """Convert a fabric (x_m, y_m) point to (latitude, longitude): its
    metres north and east (fabric_compass), then metres to degrees."""
    north, east = fabric_compass(bearing_deg)
    true_north = x_m * north[0] + y_m * north[1]
    true_east = x_m * east[0] + y_m * east[1]

    dlat = (true_north / EARTH_RADIUS_M) * (180.0 / math.pi)
    origin_lat_rad = math.radians(origin_lat)
    # Meridians converge toward the poles — a metre of east-west distance is
    # a bigger longitude delta the further from the equator. cos(lat) -> 0
    # at the poles, where "east" stops meaning anything; no fabric is there.
    cos_lat = math.cos(origin_lat_rad)
    dlon = (true_east / (EARTH_RADIUS_M * cos_lat)) * (180.0 / math.pi) if abs(cos_lat) > 1e-9 else 0.0

    return origin_lat + dlat, origin_lon + dlon


def accuracy_from_confidence(confidence: float | None) -> float:
    """A GPS-style accuracy radius in metres, from a 0..1 position confidence.

    There is no GPS receiver here to report a measured accuracy — this is a
    heuristic (a confident fabric placement reads as a tight ~2 m radius, an
    unconfident one as a loose ~20 m radius), stated as one rather than
    hidden as if it were a real sensor spec.
    """
    c = 0.0 if confidence is None else max(0.0, min(1.0, float(confidence)))
    return round(20.0 - 18.0 * c, 1)
