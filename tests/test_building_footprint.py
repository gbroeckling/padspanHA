# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""`inside_building_footprint` — the gate that decides whether a solved
position is published at all, which shipped in 0.36.1 with no tests of its own.

It answers one question: is this point inside the building on this floor? A
"no" means the solve is treated as failed and the last good position is held,
so a wrong answer here either strands a device at a stale position or draws it
in a field. Both were live symptoms this week.

The two behaviours worth pinning are the tolerance (rooms do not tile a floor —
hallways, landings and stairwells are almost never drawn) and the fail-open
(a floor nobody has drawn must not have its positions suppressed).
"""

from __future__ import annotations

from custom_components.padspan_ha.fabric_truth import (
    FOOTPRINT_TOLERANCE_M,
    inside_building_footprint,
)

# A 10 x 8 m room with its corner at the origin.
ROOM = {"type": "poly", "points_m": [[0, 0], [10, 0], [10, 8], [0, 8]]}
# A second wing, leaving an L-shaped building with a notch at (12, 6).
WING = {"type": "poly", "points_m": [[10, 0], [18, 0], [18, 4], [10, 4]]}
ROUND_ROOM = {"type": "circle", "cx_m": 30.0, "cy_m": 30.0, "r_m": 3.0}

FLOOR = {"Kitchen": ROOM, "Garage": WING}


class TestInsideAndOutside:
    def test_a_point_in_a_room_is_inside(self):
        assert inside_building_footprint(5.0, 4.0, FLOOR) is True

    def test_a_point_in_the_other_room_is_inside(self):
        assert inside_building_footprint(14.0, 2.0, FLOOR) is True

    def test_a_point_far_outside_is_not(self):
        """The parked car thirteen metres into the field."""
        assert inside_building_footprint(3.8, -13.2, FLOOR) is False

    def test_a_circle_room_is_understood(self):
        assert inside_building_footprint(30.0, 30.0, {"Turret": ROUND_ROOM}) is True
        assert inside_building_footprint(40.0, 30.0, {"Turret": ROUND_ROOM}) is False


class TestTheTolerance:
    """Rooms do not tile a floor, and a wall has thickness."""

    def test_a_hallway_between_rooms_is_still_indoors(self):
        """1 m outside every polygon — a landing nobody drew."""
        assert inside_building_footprint(5.0, 9.0, FLOOR) is True

    def test_just_inside_the_tolerance(self):
        y = 8.0 + FOOTPRINT_TOLERANCE_M - 0.05
        assert inside_building_footprint(5.0, y, FLOOR) is True

    def test_just_outside_the_tolerance(self):
        y = 8.0 + FOOTPRINT_TOLERANCE_M + 0.05
        assert inside_building_footprint(5.0, y, FLOOR) is False

    def test_the_notch_of_an_L_is_not_inside_the_building(self):
        """A bounding box would call this indoors; the union of rooms does not.

        This is the whole reason the check is the rooms rather than a box: the
        missing corner of an L, the yard between two wings, the driveway.
        """
        assert inside_building_footprint(14.0, 7.0, FLOOR) is False


class TestFailOpen:
    """A floor nobody has drawn must not have its positions suppressed."""

    def test_no_geometry_for_this_floor_accepts(self):
        assert inside_building_footprint(1000.0, 1000.0, None) is True

    def test_an_empty_floor_accepts(self):
        assert inside_building_footprint(1000.0, 1000.0, {}) is True

    def test_unusable_geometry_accepts_rather_than_suppressing(self):
        """Two-point 'polygons' and unknown shapes cannot judge anything."""
        junk = {
            "Bad": {"type": "poly", "points_m": [[0, 0], [1, 1]]},
            "Odd": {"type": "hexagon", "points_m": [[0, 0], [1, 0], [1, 1]]},
            "Null": None,
        }
        assert inside_building_footprint(1000.0, 1000.0, junk) is True

    def test_one_usable_room_is_enough_to_start_judging(self):
        """Fail-open must not survive the presence of real geometry."""
        mixed = {"Bad": {"type": "poly", "points_m": [[0, 0]]}, "Kitchen": ROOM}
        assert inside_building_footprint(1000.0, 1000.0, mixed) is False


class TestFloorKeying:
    """The coordinator groups rooms by floor and looks them up by floor id.

    If those two disagree the lookup misses, the footprint is None, fail-open
    accepts everything, and the gate is silently disabled — the failure mode
    that leaves no trace at all.
    """

    def _group(self, geo_all: dict) -> dict[str, dict]:
        """Exactly the grouping presence_coordinator does."""
        out: dict[str, dict] = {}
        for name, geo in (geo_all or {}).items():
            out.setdefault(str((geo or {}).get("floor_id") or "main"), {})[name] = geo
        return out

    def _lookup(self, grouped: dict, best_floor) -> dict | None:
        """Exactly the lookup presence_coordinator does."""
        return grouped.get(str(best_floor or "main"))

    def test_a_named_floor_round_trips(self):
        geo = {"Loft": {**ROOM, "floor_id": "upper"}}
        assert self._lookup(self._group(geo), "upper") is not None
        assert inside_building_footprint(5.0, 4.0, self._lookup(self._group(geo), "upper")) is True

    def test_a_missing_floor_id_and_an_empty_best_floor_meet_on_main(self):
        """Both sides normalise falsy to 'main'; if only one did, the gate
        would be off for every room written without a floor."""
        geo = {"Kitchen": dict(ROOM)}          # no floor_id at all
        grouped = self._group(geo)
        assert set(grouped) == {"main"}
        for best_floor in ("", None, "main"):
            assert self._lookup(grouped, best_floor) is not None, best_floor

    def test_an_unknown_floor_falls_open_rather_than_suppressing(self):
        geo = {"Loft": {**ROOM, "floor_id": "upper"}}
        rooms = self._lookup(self._group(geo), "basement")
        assert rooms is None
        assert inside_building_footprint(5.0, 4.0, rooms) is True
