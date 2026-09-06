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


def metres_to_latlon(
    x_m: float,
    y_m: float,
    origin_lat: float,
    origin_lon: float,
    bearing_deg: float = 0.0,
) -> tuple[float, float]:
    """Convert a fabric (x_m, y_m) point to (latitude, longitude).

    bearing_deg is the compass bearing, clockwise from true north, that the
    fabric's own +Y axis points toward. At bearing_deg=0, +Y is true north
    and +X is true east, so (x_m, y_m) already IS (east_m, north_m);
    otherwise the local vector is rotated clockwise by bearing_deg to
    recover true east/north before the metre->degree conversion.
    """
    theta = math.radians(bearing_deg)
    true_east = x_m * math.cos(theta) + y_m * math.sin(theta)
    true_north = -x_m * math.sin(theta) + y_m * math.cos(theta)

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
