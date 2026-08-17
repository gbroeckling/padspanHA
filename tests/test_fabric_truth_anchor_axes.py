# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The metre anchor carries two scales here too — this is the side that writes.

Issue #62 again. `find_metre_anchor` computed both axis scales, reported how
far they disagreed as `iso_error`, and returned only x. Every caller then
applied that one number to both axes.

The JS twin (`views/stack_transform.js`) was fixed when the issue was raised.
This was not, and this is the half that WRITES:

  * `rooms_from_stack` produces the room geometry in metres that gets
    committed to the fabric
  * `stack_metre_transform` produces the `scale_x_m` / `scale_y_m` written into
    `map_transforms`, from which every later read inherits them

World space is anisotropic in y — `stack_world_xform` spans the image across
`scale * scale_x_adj` in x and `scale * ar` in y — so one figure for both axes
stretches everything by exactly the map's aspect error. It only ever looked
right while a map's pixel aspect matched its metric aspect; trimming a map
breaks that, which is how the issue was found.
"""

from __future__ import annotations

import math
from typing import Any

from custom_components.padspan_ha import fabric_truth


class FakeModel:
    def __init__(self, transforms: dict[str, dict[str, Any]]) -> None:
        self._t = transforms

    def map_transform(self, map_id: str) -> dict[str, Any] | None:
        return self._t.get(map_id)


def _map(map_id: str, *, width: int, height: int, ref_ar: float,
         bounds: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": map_id,
        "image": {"width": width, "height": height},
        "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": ref_ar,
                  "rotation": 0, "x_offset": 0, "y_offset": 0, "is_master": True},
        "room_bounds": bounds or {},
    }


# A plan 20 m wide and 10 m tall whose IMAGE was later trimmed to half its
# height: ref_ar 0.25, while the stored metric height still describes the
# untrimmed plan. That disagreement is the bug condition.
#
#   x: 20 m across a world width of 1.00  -> 20 m per world unit
#   y: 10 m down  a world height of 0.25  -> 40 m per world unit
#
# A factor of two, on y only.
TRIMMED_T = {"scale_x_m": 20.0, "scale_y_m": 10.0,
             "reference_measurements": [{"m": 20.0}]}

# The same plan untrimmed: pixel aspect and metric aspect AGREE, so both
# figures are 20 and one scale would have worked.
SQUARE_T = {"scale_x_m": 20.0, "scale_y_m": 10.0,
            "reference_measurements": [{"m": 20.0}]}


def test_the_anchor_reports_both_axes() -> None:
    maps = [_map("ground", width=1000, height=250, ref_ar=0.25)]
    a = fabric_truth.find_metre_anchor(maps, FakeModel({"ground": TRIMMED_T}))

    assert a is not None
    assert abs(a["m_per_world_x"] - 20.0) < 1e-6, a
    assert abs(a["m_per_world_y"] - 40.0) < 1e-6, a
    assert a["m_per_world_x"] != a["m_per_world_y"], (
        "the fixture no longer exercises the fault")
    # The legacy field keeps its old meaning for readers that only want x.
    assert abs(a["m_per_world"] - a["m_per_world_x"]) < 1e-9, a
    # And it still reports the disagreement it always reported.
    assert abs(a["iso_error"] - 1.0) < 1e-6, a


def test_a_square_room_stays_square_when_the_axes_differ() -> None:
    """The bug as a user could see it, on the side that COMMITS.

    A room traced as a square on the plan must come out square in metres.
    Through one x-derived scale it came out twice as tall as it should be, and
    that geometry is what gets written to the fabric.
    """
    # A square in map fractions: 0.2 wide, and 0.2 * (1/ar) tall in fraction
    # terms is what covers the same metres... simplest to assert the ratio.
    bounds = {"Study": {"type": "poly",
                        "points": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]}}
    maps = [_map("ground", width=1000, height=250, ref_ar=0.25, bounds=bounds)]
    anchor = fabric_truth.find_metre_anchor(maps, FakeModel({"ground": TRIMMED_T}))

    rooms = fabric_truth.rooms_from_stack(maps, anchor)
    pts = rooms["Study"]["points_m"]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)

    # 0.2 of the image width  = 0.2 world-x = 0.2 * 20 = 4.0 m
    # 0.2 of the image height = 0.2 * ar = 0.05 world-y = 0.05 * 40 = 2.0 m
    assert abs(w - 4.0) < 1e-6, (w, h)
    assert abs(h - 2.0) < 1e-6, (w, h)
    # Under the single-scale bug h came out 0.05 * 20 = 1.0 — half of this.
    assert abs(w / h - 2.0) < 1e-9, (w, h)


def test_the_written_map_transform_carries_the_true_y_scale() -> None:
    """stack_metre_transform feeds map_transforms, so a wrong y poisons the store.

    Every later read of scale_y_m inherits it, including the anchor itself the
    next time round — which is how one bad repair becomes permanent.
    """
    maps = [_map("ground", width=1000, height=250, ref_ar=0.25)]
    anchor = fabric_truth.find_metre_anchor(maps, FakeModel({"ground": TRIMMED_T}))

    t = fabric_truth.stack_metre_transform(maps[0], anchor)

    assert t is not None
    # The full image is 20 m across and 10 m down. That is what a transform
    # describing this map must say, whatever its pixels were trimmed to.
    assert abs(t["scale_x_m"] - 20.0) < 1e-6, t
    assert abs(t["scale_y_m"] - 10.0) < 1e-6, t


def test_an_undistorted_map_is_completely_unchanged() -> None:
    """Nobody whose maps were fine may notice this fix.

    When pixel aspect and metric aspect agree the two scales are equal, and the
    new code must produce exactly what the old single scale did.
    """
    bounds = {"Study": {"type": "poly",
                        "points": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]}}
    maps = [_map("ground", width=1000, height=500, ref_ar=0.5, bounds=bounds)]
    anchor = fabric_truth.find_metre_anchor(maps, FakeModel({"ground": SQUARE_T}))

    assert abs(anchor["m_per_world_x"] - anchor["m_per_world_y"]) < 1e-9, anchor
    assert anchor["iso_error"] == 0.0, anchor

    t = fabric_truth.stack_metre_transform(maps[0], anchor)
    assert abs(t["scale_x_m"] - 20.0) < 1e-6, t
    assert abs(t["scale_y_m"] - 10.0) < 1e-6, t

    rooms = fabric_truth.rooms_from_stack(maps, anchor)
    pts = rooms["Study"]["points_m"]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    # 0.2 of width = 4.0 m; 0.2 of height = 0.2 * 0.5 * 20 = 2.0 m. Square on
    # the plan, and the plan is twice as wide as it is tall.
    assert abs((max(xs) - min(xs)) - 4.0) < 1e-6
    assert abs((max(ys) - min(ys)) - 2.0) < 1e-6


def test_a_circle_takes_the_area_preserving_radius() -> None:
    """This geometry format has one radius; an anisotropic world has two.

    The geometric mean is the radius of the circle with the same AREA as the
    true ellipse — bounded by the aspect error rather than proportional to it,
    which is the best a single number can do. Asserting it so the choice is a
    decision on the record rather than an accident.
    """
    bounds = {"Turret": {"type": "circle", "cx": 0.5, "cy": 0.5, "r": 0.1}}
    maps = [_map("ground", width=1000, height=250, ref_ar=0.25, bounds=bounds)]
    anchor = fabric_truth.find_metre_anchor(maps, FakeModel({"ground": TRIMMED_T}))

    rooms = fabric_truth.rooms_from_stack(maps, anchor)
    r = rooms["Turret"]["r_m"]

    expected = 0.1 * math.sqrt(20.0 * 40.0)
    assert abs(r - round(expected, 3)) < 1e-3, (r, expected)
    # Strictly between the two axis answers — not silently one of them.
    assert 0.1 * 20.0 < r < 0.1 * 40.0, r
