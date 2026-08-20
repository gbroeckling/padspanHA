# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What the coverage window actually does, including where it does not work.

0.36.2 made the window a duration, which HALVED it on an install polling every
10 s — from six polls (60 s) to three (30 s). That is the documented intent,
but fewer samples is a real change to a rule whose whole job is to be slow, so
these tests pin the properties it is supposed to have.

The last class documents a limitation the change did NOT fix, so that it is
written down rather than assumed away.
"""

from __future__ import annotations

from custom_components.padspan_ha.presence_rules import (
    COVERAGE_HYSTERESIS_DB,
    coverage_evidence,
    coverage_window_polls,
    outside_by_coverage,
)

FLOOR = -80.0
INSIDE = -60.0          # comfortably above floor + band
OUTSIDE = -95.0         # comfortably below floor - band


def _walk(readings, floor=FLOOR, window=3, start_outside=False):
    """Run a sequence of per-poll best readings through the rule."""
    hist, outside, trail = None, start_outside, []
    for r in readings:
        hist, best = coverage_evidence(hist, r, window=window)
        outside = outside_by_coverage(best, floor, outside)
        trail.append(outside)
    return trail


class TestTheAsymmetryTheRuleIsBuiltOn:
    """Going outside is slow; coming back inside is immediate."""

    def test_one_weak_poll_does_not_put_a_device_outside(self):
        """The bug the window was added for: a single poll deciding it."""
        trail = _walk([INSIDE, INSIDE, OUTSIDE], window=3)
        assert trail[-1] is False, (
            "one weak reading flipped the device outside — the window is not "
            "holding, which is the whole-house-goes-outside bug"
        )

    def test_a_full_window_of_weak_readings_does_put_it_outside(self):
        trail = _walk([INSIDE, OUTSIDE, OUTSIDE, OUTSIDE], window=3)
        assert trail[-1] is True, "sustained weak evidence never took effect"

    def test_coming_back_inside_is_immediate(self):
        """Being wrongly inside costs an ordinary room vote; wrongly outside
        disables the indoor solve. So the return must not wait a window."""
        trail = _walk([OUTSIDE, OUTSIDE, OUTSIDE, INSIDE], window=3)
        assert trail[-2] is True
        assert trail[-1] is False, "a strong reading did not bring it back at once"


class TestItRidesOutAScannerGoingQuiet:
    """The window exists because the best scanner falling silent is not the
    device leaving. Three samples must still absorb that."""

    def test_a_single_silent_poll_does_not_flip_it(self):
        trail = _walk([INSIDE, INSIDE, None], window=3)
        assert trail[-1] is False

    def test_two_silent_polls_in_a_row_do_not_flip_it(self):
        trail = _walk([INSIDE, None, None], window=3)
        assert trail[-1] is False, (
            "the halved window no longer absorbs a radio missing two reports"
        )

    def test_silence_alone_never_puts_a_device_outside(self):
        """'Not advertising' is not evidence about where something is."""
        trail = _walk([INSIDE, None, None, None, None, None, None], window=3)
        assert trail[-1] is False, (
            "silence alone moved the device outside; a device that stopped "
            "advertising has told us nothing about its location"
        )


class TestTheWindowScalesWithThePollRate:
    def test_the_same_duration_on_a_5s_and_a_10s_install(self):
        assert coverage_window_polls(5) * 5 == coverage_window_polls(10) * 10

    def test_the_live_install_rate(self):
        """This machine polls every 10 s, which was running a 60 s window."""
        assert coverage_window_polls(10) == 3


class TestKnownLimitation:
    """The window counts POLLS IN WHICH SOMETHING WAS HEARD, not wall time.

    `coverage_evidence` appends only when there is a reading, so a device heard
    once every fifth poll fills three slots over fifteen polls — a window
    spanning two and a half minutes on a 10 s install, not thirty seconds.

    Making the window a duration fixed its dependence on the POLL rate. It did
    not fix its dependence on the ADVERTISING rate. This test documents the
    behaviour so the next person reads it here instead of rediscovering it in
    a house.
    """

    def test_a_rarely_heard_device_has_a_much_longer_effective_window(self):
        hist = None
        heard_polls = 0
        for poll in range(15):
            reading = INSIDE if poll % 5 == 0 else None
            hist, _best = coverage_evidence(hist, reading, window=3)
            if reading is not None:
                heard_polls += 1
        assert heard_polls == 3
        assert len(hist) == 3, (
            "three readings gathered across fifteen polls still fill the whole "
            "window — the window is in heard-polls, not seconds"
        )

    def test_and_that_keeps_a_stale_reading_authoritative(self):
        """The consequence: evidence from long ago still decides the answer."""
        hist, _ = coverage_evidence(None, INSIDE, window=3)
        for _ in range(20):
            hist, best = coverage_evidence(hist, None, window=3)
        assert best == INSIDE, (
            "expected the old strong reading to still be the window maximum"
        )
        assert outside_by_coverage(best, FLOOR, False) is False
