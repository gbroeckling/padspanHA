# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Outside, by the site's indoor coverage envelope — docs/outside-attribution-plan.md.

A device on the property but not in the building is heard by every indoor
scanner faintly; the strongest of several faint readings is a perimeter room,
so a parked vehicle lived in a closet. What is always true of an outside
device on a covered site is that NO scanner hears it well, and the site can
measure that about itself from its own calibration.
"""

from __future__ import annotations

from custom_components.padspan_ha.presence_rules import (
    COVERAGE_MIN_POINTS,
    indoor_coverage_floor,
    is_outdoor_floor,
    modelled_coverage_floor,
    outdoor_attribution,
    outside_by_coverage,
)


def _pt(floor, *rssis):
    return {"floor_id": floor, "scanner_readings": [{"source": f"s{i}", "mean_rssi": r} for i, r in enumerate(rssis)]}


def test_outdoor_floor_is_one_vocabulary() -> None:
    assert is_outdoor_floor("__outside__") and is_outdoor_floor("outside") and is_outdoor_floor("Garden")
    assert not is_outdoor_floor("main") and not is_outdoor_floor("") and not is_outdoor_floor(None)


def test_the_floor_is_the_low_tail_of_strongest_indoor_reading() -> None:
    # 40 indoor points: strongest readings -50…-89 (one per point), plus outdoor
    # points that must not count, plus a point with no readings.
    pts = [_pt("main", -50 - i, -95) for i in range(40)]
    pts += [_pt("__outside__", -100, -102)] * 20 + [{"floor_id": "main", "scanner_readings": []}]
    fl = indoor_coverage_floor(pts)
    # 5th percentile of 40 sorted values (-89 … -50): index int(0.05*39)=1 → -88
    assert fl == -88.0


def test_too_few_points_means_no_rule() -> None:
    pts = [_pt("main", -60)] * (COVERAGE_MIN_POINTS - 1)
    assert indoor_coverage_floor(pts) is None
    assert outside_by_coverage(-99.0, None, False) is False   # inactive: never outside by this rule


def test_hysteresis_band_holds_the_state() -> None:
    fl = -85.0
    assert outside_by_coverage(-90.0, fl, False) is True     # clearly below: enter
    assert outside_by_coverage(-86.0, fl, True) is True      # inside the band: hold
    assert outside_by_coverage(-86.0, fl, False) is False    # inside the band: hold
    assert outside_by_coverage(-80.0, fl, True) is False     # clearly above: leave
    assert outside_by_coverage(None, fl, True) is False      # nothing heard: not by this rule


def test_attribution_is_the_best_outdoor_scanner_or_nothing() -> None:
    s2a = {"shed": "Shed", "rshed": "Richard's Shed", "kitchen": "Kitchen"}
    s2f = {"shed": "__outside__", "rshed": "outside", "kitchen": "main"}
    live = {"kitchen": -87.0, "shed": -96.0, "rshed": -92.0}
    assert outdoor_attribution(live, s2a, s2f) == "Richard's Shed"   # indoor -87 is not a candidate
    assert outdoor_attribution({"kitchen": -87.0}, s2a, s2f) is None  # no outdoor evidence: change nothing


def test_the_modelled_floor_is_the_worst_best_reading_indoors() -> None:
    rooms = {
        "Near": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
        "Far": {"type": "poly", "floor_id": "main", "points_m": [[20, 0], [24, 0], [24, 4], [20, 4]]},
        "Garden": {"type": "poly", "floor_id": "__outside__", "points_m": [[0, 40], [4, 40], [4, 44], [0, 44]]},
    }
    scanners = {"a": (2.0, 2.0, "main")}
    fl = modelled_coverage_floor(rooms, scanners, ref_power=-59.0, path_loss_exp=2.5, floor_stack_idx={"main": 0})
    # Worst indoor sample is the far corner of "Far" (~22 m): -59 - 25*log10(22.4) ≈ -92.7
    assert fl is not None and -95.0 < fl < -90.0
    assert modelled_coverage_floor(rooms, {}, -59.0, 2.5) is None


def test_a_faint_device_heard_by_the_shed_is_in_the_shed_not_the_closet() -> None:
    """The Bronco. Every indoor scanner hears it faintly through the walls;
    the strongest faint one is a perimeter room. Below the site's coverage
    floor, with an outdoor scanner hearing it, it is attributed outdoors —
    and stays there through the vote."""
    from tests.test_presence_coordinator import _make_coordinator, _VOTE_WINDOW

    coord = _make_coordinator()
    coord._coverage_floor = -80.0
    src_area = {"closet": "Bedroom Closet", "entry": "Entry", "shed": "Richard's Shed"}
    src_floor = {"closet": "main", "entry": "main", "shed": "__outside__"}
    readings = {"AA:BB": {"closet": -87.0, "entry": -93.0, "shed": -98.0}}
    for _ in range(_VOTE_WINDOW + 1):
        coord._smooth_room("bronco", "AA:BB", readings, src_area, source_to_floor=src_floor)
    assert coord._confirmed_room.get("bronco") == "Richard's Shed"
    assert coord._outside_by_cov.get("bronco") is True
    assert coord._spatial_debug.get("bronco", "").startswith("outside_by_coverage")

    # Carried indoors: heard well again → back to the vote's indoor answer.
    # The Kalman filter climbs, the outside state leaves its band, and the
    # indoor↔outdoor step is the vote's most guarded one — so it takes a few
    # windows, as it should for a real move.
    strong = {"AA:BB": {"closet": -58.0, "entry": -75.0, "shed": -99.0}}
    for _ in range(4 * _VOTE_WINDOW):
        coord._smooth_room("bronco", "AA:BB", strong, src_area, source_to_floor=src_floor)
    assert coord._outside_by_cov.get("bronco") is False
    assert coord._confirmed_room.get("bronco") == "Bedroom Closet"


def test_below_the_floor_with_no_outdoor_evidence_changes_nothing() -> None:
    from tests.test_presence_coordinator import _make_coordinator, _VOTE_WINDOW

    coord = _make_coordinator()
    coord._coverage_floor = -80.0
    src_area = {"closet": "Bedroom Closet", "entry": "Entry"}
    src_floor = {"closet": "main", "entry": "main"}
    readings = {"AA:BB": {"closet": -87.0, "entry": -93.0}}
    for _ in range(_VOTE_WINDOW + 1):
        coord._smooth_room("bronco", "AA:BB", readings, src_area, source_to_floor=src_floor)
    assert coord._outside_by_cov.get("bronco") is True          # the state is known…
    assert coord._confirmed_room.get("bronco") == "Bedroom Closet"   # …but nothing is invented
