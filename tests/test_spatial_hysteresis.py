"""How far into the next room a solved position must be to count for it.

A still device's solved position wanders a metre or two, so with the house
drawn a position counts for the next room only once it is 0.75 m past the wall
of the room shown (_SPATIAL_HYST_M). A small room along one wall of a bigger
one reaches only its own depth past that wall: in a 2 m bathroom beside a
bedroom, 0.75 m in is the far 1.25 m of the room, which the scattered solve
seldom gave, and a real stay there was often never shown. Such a room needs a
quarter of its reach instead (_SPATIAL_HYST_SHARE). A corridor beside a room
reaches its whole length past it and keeps the full margin.
"""
from __future__ import annotations

import math

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.presence_coordinator import (
    _SPATIAL_HYST_M,
    _SPATIAL_HYST_SHARE,
    _spatial_hyst_m,
)


def _rect(x0, y0, x1, y1):
    return {"type": "poly", "points_m": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


# A bedroom with a 2 m bathroom along its north wall, a 2 m corridor down its
# west side, and a 4 m office along its south wall.
BEDROOM = _rect(6, 4, 10, 8)
BATH = _rect(6, 8, 10, 10)
HALL = _rect(4, 0, 6, 10)
OFFICE = _rect(6, 0, 10, 4)


def test_a_room_along_a_wall_reaches_its_own_depth_past_it():
    assert math.isclose(fabric_truth.room_reach_m(BATH, BEDROOM), 2.0)
    assert math.isclose(fabric_truth.room_reach_m(OFFICE, BEDROOM), 4.0)


def test_a_corridor_reaches_its_length_past_a_room_beside_it():
    # Its far end, 4 m past the bedroom's south wall and 2 m to the west.
    assert math.isclose(fabric_truth.room_reach_m(HALL, BEDROOM), math.hypot(2.0, 4.0))


def test_reach_is_measured_from_the_room_shown():
    # The bedroom goes 4 m past the bathroom: leaving the bathroom keeps 0.75 m.
    assert math.isclose(fabric_truth.room_reach_m(BEDROOM, BATH), 4.0)


def test_a_circle_reaches_its_centre_plus_its_radius():
    room = {"type": "circle", "cx_m": 8.0, "cy_m": 9.0, "r_m": 1.0}
    assert math.isclose(fabric_truth.room_reach_m(room, BEDROOM), 2.0)


def test_no_reach_without_both_geometries():
    assert fabric_truth.room_reach_m(None, BEDROOM) is None
    assert fabric_truth.room_reach_m(BATH, None) is None
    assert fabric_truth.room_reach_m({"type": "poly", "points_m": [[0, 0], [1, 1]]}, BEDROOM) is None


def test_a_small_room_needs_a_quarter_of_its_reach():
    assert math.isclose(_spatial_hyst_m(BATH, BEDROOM), _SPATIAL_HYST_SHARE * 2.0)
    assert _spatial_hyst_m(BATH, BEDROOM) < _SPATIAL_HYST_M


def test_rooms_reaching_3_m_or_more_keep_the_full_margin():
    assert _spatial_hyst_m(OFFICE, BEDROOM) == _SPATIAL_HYST_M
    assert _spatial_hyst_m(BEDROOM, BATH) == _SPATIAL_HYST_M
    assert _spatial_hyst_m(_rect(6, 8, 10, 11), BEDROOM) == _SPATIAL_HYST_M   # exactly 3 m


def test_a_corridor_keeps_the_full_margin():
    # A stay in a corridor and a device just inside a doorway off it look alike;
    # only the margin tells them apart.
    assert _spatial_hyst_m(HALL, BEDROOM) == _SPATIAL_HYST_M


def test_unknown_geometry_keeps_the_full_margin():
    assert _spatial_hyst_m(None, BEDROOM) == _SPATIAL_HYST_M
    assert _spatial_hyst_m(BATH, None) == _SPATIAL_HYST_M
