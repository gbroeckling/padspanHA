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
    COVERAGE_WINDOW_POLLS,
    coverage_evidence,
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


# ── The evidence window ──────────────────────────────────────────────────────
# The rule reads the strongest scanner still inside the silence grace. When the
# scanner that hears a device best goes quiet, that value does not degrade — it
# drops to the next-best, which can be 25-30 dB lower, and crosses the floor in
# one poll. Scanners are shared, so every device whose best hearer went quiet
# flips in the SAME poll: a whole house outside at once, then back next poll.
#
# Deciding from a trailing max instead makes that impossible, and makes the
# rule deliberately asymmetric: slow to claim a device left (it disables the
# indoor solve), immediate to bring it back (which costs nothing).

FLOOR = -84.0


def _drive(readings, *, floor=FLOOR):
    """Feed per-poll best readings through window + rule, as the coordinator does."""
    hist, out, verdicts = None, False, []
    for r in readings:
        hist, best_recent = coverage_evidence(hist, r)
        out = outside_by_coverage(best_recent, floor, out)
        verdicts.append(out)
    return verdicts


def test_the_best_scanner_falling_silent_does_not_put_a_device_outside():
    """The reported symptom. Strong for a while, then its best radio goes quiet
    and only a distant one is left — the device has not moved."""
    settled = [-62.0] * 8            # comfortably inside, one close scanner
    dropout = [-92.0] * 4            # best radio silent; a far scanner is all that is left
    verdicts = _drive(settled + dropout)
    assert not any(verdicts), f"went outside on poll {verdicts.index(True)} of a 4-poll dropout"


def test_a_whole_house_does_not_flip_on_one_quiet_poll():
    """Several devices sharing one strong scanner, which misses a single poll."""
    for own_rssi in (-55.0, -61.0, -68.0, -74.0):
        verdicts = _drive([own_rssi] * 6 + [-95.0] + [own_rssi] * 3)
        assert not any(verdicts), f"device at {own_rssi} dBm flipped on a single quiet poll"


def test_a_device_that_actually_leaves_still_goes_outside():
    """The rule must still work. Sustained weak readings, no recovery."""
    verdicts = _drive([-60.0] * 6 + [-96.0] * (COVERAGE_WINDOW_POLLS + 2))
    assert verdicts[-1] is True, "a device that genuinely left was never marked outside"


def test_leaving_is_slow_and_returning_is_immediate():
    """The asymmetry, stated as a test.

    Going outside disables the indoor solve, so it must survive a full window.
    Coming back needs one good reading, because being wrongly inside costs only
    an ordinary room vote.
    """
    leaving = _drive([-60.0] * 6 + [-96.0] * COVERAGE_WINDOW_POLLS)
    assert leaving[6] is False, "declared outside on the first weak poll"
    assert leaving[-1] is True, "never declared outside despite a full window of weak readings"

    hist, out = None, False
    for r in [-96.0] * COVERAGE_WINDOW_POLLS:
        hist, br = coverage_evidence(hist, r)
        out = outside_by_coverage(br, FLOOR, out)
    assert out is True
    hist, br = coverage_evidence(hist, -58.0)      # one strong reading
    assert outside_by_coverage(br, FLOOR, out) is False, "did not come back on a strong reading"


def test_polls_where_nothing_was_heard_are_not_evidence():
    """Not advertising is not the same as being far away."""
    hist, _ = coverage_evidence(None, -60.0)
    for _ in range(COVERAGE_WINDOW_POLLS * 2):
        hist, best = coverage_evidence(hist, None)
    assert best == -60.0, "silence displaced a real reading"
    assert outside_by_coverage(best, FLOOR, False) is False


def test_the_window_is_bounded():
    hist = None
    for i in range(200):
        hist, _ = coverage_evidence(hist, -70.0 - (i % 5))
    assert len(hist) == COVERAGE_WINDOW_POLLS


def test_an_inactive_rule_is_still_inactive():
    assert outside_by_coverage(-99.0, None, False) is False
    hist, best = coverage_evidence(None, None)
    assert best is None and hist == []


# ── the window is a duration, not a poll count ───────────────────────────────

class TestCoverageWindowIsADuration:
    """`presence_poll_interval_s` is a user setting (1-60s, default 5).

    A fixed poll count therefore means a different length of time on every
    install — six polls is 30s at the default and a full minute on an install
    polling every 10s, which is what a real install was running. How long a
    device has been unheard is a fact about the device, so the window has to be
    a duration and the poll count derived from it.
    """

    def test_same_duration_at_every_poll_rate(self):
        from custom_components.padspan_ha.presence_rules import (
            COVERAGE_WINDOW_S, coverage_window_polls,
        )
        for poll_s in (1, 2, 5, 10, 15, 30):
            polls = coverage_window_polls(poll_s)
            assert abs(polls * poll_s - COVERAGE_WINDOW_S) <= poll_s, (
                f"{poll_s}s poll -> {polls} polls = {polls * poll_s}s, "
                f"want ~{COVERAGE_WINDOW_S}s"
            )

    def test_default_matches_the_documented_constant(self):
        from custom_components.padspan_ha.presence_rules import (
            COVERAGE_WINDOW_POLLS, coverage_window_polls,
        )
        assert coverage_window_polls(5) == COVERAGE_WINDOW_POLLS

    def test_nonsense_intervals_fall_back_rather_than_explode(self):
        from custom_components.padspan_ha.presence_rules import coverage_window_polls
        for bad in (None, 0, -1, "x"):
            assert coverage_window_polls(bad) == 6

    def test_never_degenerates_to_a_single_poll(self):
        """A one-poll window is the instantaneous rule the change removed."""
        from custom_components.padspan_ha.presence_rules import coverage_window_polls
        assert coverage_window_polls(60) >= 2
