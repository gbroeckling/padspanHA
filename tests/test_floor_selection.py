# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A floor changes on evidence, not on a gap in the data.

Reported as "beacons jump around as a group, so not a valid jump but a logic
error". The "as a group" is the whole diagnosis: independent devices cannot
move together unless something they SHARE moved, and what they share is the
scanner evidence feeding floor selection.

Measured with the capture harness on a live three-storey house, ten tracked
objects, one poll per ~10 s:

    scannersHeard=15  floorChanges=0
    scannersHeard=15  floorChanges=1
    ...
    scannersHeard=4   floorChanges=3      <- evidence collapses
    scannersHeard=14  floorChanges=4      <- and they all snap back

Baseline is nought to two changes a poll. In the poll where the scanner count
fell to four, three of ten objects changed floor at once, and four more changed
on the recovery poll. Every device re-picked its floor from the same collapsed
evidence, and because `_dev_abs_z` and the per-slab attenuation both derive
from the chosen floor, all of their positions moved with it.

The cause was structural: `_select_floor`'s scoring was recomputed from scratch
every poll and compared on equal terms however much had been heard, with a flat
+4 dB nudge for the incumbent as the only damping. The other two stages of the
pipeline already refuse to act on one thin poll — `_SILENCE_GRACE` before RSSI
decays, the vote window before a room is confirmed. Floor selection was the one
stage with no such discipline.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_coordinator import (
    _FLOOR_EVIDENCE_FRACTION,
    _FLOOR_STICKY_DB,
    _FLOOR_SWITCH_DB,
    PresenceCoordinator,
)


def _coord() -> PresenceCoordinator:
    hass = MagicMock()
    settings = MagicMock()
    settings.data = {}
    hass.data = {DOMAIN: {DATA_SETTINGS: settings}}
    c = PresenceCoordinator(hass)
    c._pending_room_changes = []
    return c


def _src(*entries: tuple[str, float, str]) -> list[tuple[str, float, float, float, str]]:
    """(name, rssi, floor) -> the solver's (src, x, y, rssi, floor) tuples."""
    return [(n, 0.0, 0.0, r, f) for n, r, f in entries]


# A device sitting on `main`, heard well by main and faintly through the slab.
HEALTHY = _src(
    ("m1", -55.0, "main"), ("m2", -58.0, "main"), ("m3", -63.0, "main"),
    ("u1", -78.0, "upper"), ("u2", -81.0, "upper"),
    ("b1", -84.0, "basement"), ("b2", -88.0, "basement"),
)


def test_a_healthy_poll_picks_the_floor_the_evidence_points_at() -> None:
    """The ordinary case has to keep working, or the rest is worthless."""
    c = _coord()
    assert c._select_floor("dev", HEALTHY, "main") == "main"
    # And it will move when the evidence genuinely moves.
    upstairs = _src(("m1", -84.0, "main"), ("m2", -88.0, "main"),
                    ("u1", -54.0, "upper"), ("u2", -57.0, "upper"),
                    ("b1", -90.0, "basement"))
    assert c._select_floor("dev", upstairs, "main") == "upper"


def test_a_collapsed_poll_does_not_move_the_device() -> None:
    """The measured fault, as the thing that must stop happening.

    The device has been hearing seven scanners; this poll it hears two, one of
    them loud on the wrong floor. That is the frame where three of ten objects
    changed floor at once.
    """
    c = _coord()
    c._select_floor("dev", HEALTHY, "main")          # establish the norm: 7
    collapsed = _src(("u1", -52.0, "upper"), ("m1", -70.0, "main"))

    assert c._select_floor("dev", collapsed, "main") == "main", (
        "a poll that heard a fraction of the usual evidence moved the device")
    assert "evidence" in c._spatial_debug["dev"], c._spatial_debug


def test_a_device_that_only_ever_hears_a_few_is_not_frozen() -> None:
    """The rule is RELATIVE, and this is why it has to be.

    An absolute floor would freeze every device in a thinly covered corner
    permanently. Three scanners is this device's normal, so three scanners is
    enough for it to move on.
    """
    c = _coord()
    sparse_main = _src(("m1", -60.0, "main"), ("m2", -64.0, "main"), ("m3", -70.0, "main"))
    for _ in range(5):
        c._select_floor("dev", sparse_main, "main")

    sparse_upper = _src(("u1", -50.0, "upper"), ("u2", -53.0, "upper"), ("m1", -72.0, "main"))
    assert c._select_floor("dev", sparse_upper, "main") == "upper", (
        "a device in thin coverage was frozen: %r" % (c._spatial_debug,))


def test_the_expectation_forgets_slowly_enough_to_survive_a_gap() -> None:
    """One collapsed poll must not redefine what "usual" means.

    If the baseline tracked the latest count it would drop to the gap's level
    and immediately re-open the hole this closes.
    """
    c = _coord()
    c._select_floor("dev", HEALTHY, "main")
    assert c._floor_evidence["dev"] == 7.0

    collapsed = _src(("u1", -52.0, "upper"), ("m1", -70.0, "main"))
    c._select_floor("dev", collapsed, "main")
    assert c._floor_evidence["dev"] > 6.0, (
        "one thin poll collapsed the expectation: %r" % (c._floor_evidence,))


def test_a_genuine_loss_of_coverage_is_adopted_eventually() -> None:
    """A scanner really removed from the house must not freeze a device forever."""
    c = _coord()
    c._select_floor("dev", HEALTHY, "main")
    reduced = _src(("m1", -60.0, "main"), ("m2", -64.0, "main"), ("m3", -70.0, "main"))
    for _ in range(80):
        c._select_floor("dev", reduced, "main")

    assert c._floor_evidence["dev"] < 4.0, c._floor_evidence
    moved = _src(("u1", -48.0, "upper"), ("u2", -51.0, "upper"), ("m1", -75.0, "main"))
    assert c._select_floor("dev", moved, "main") == "upper"


def test_a_challenger_inside_the_noise_does_not_win() -> None:
    """Floors change on a real difference, not on a decibel of jitter.

    `upper` is ahead here on the raw score, but not by enough to overcome the
    incumbent's head start plus the switching margin.
    """
    c = _coord()
    marginal = _src(
        ("u1", -60.0, "upper"), ("u2", -62.0, "upper"),
        ("m1", -63.0, "main"), ("m2", -65.0, "main"), ("m3", -70.0, "main"),
    )
    # upper top-2 mean -61.0, main top-2 mean -64.0 -> a 3 dB lead
    assert c._select_floor("dev", marginal, "main") == "main"
    assert "margin" in c._spatial_debug["dev"], c._spatial_debug

    # Widen the lead past the bar and it should switch.
    decisive = _src(
        ("u1", -52.0, "upper"), ("u2", -54.0, "upper"),
        ("m1", -63.0, "main"), ("m2", -65.0, "main"), ("m3", -70.0, "main"),
    )
    assert c._select_floor("dev", decisive, "main") == "upper"


def test_the_bar_is_the_head_start_plus_the_margin() -> None:
    """State the arithmetic, so a later tweak to one constant is deliberate."""
    c = _coord()
    bar = _FLOOR_STICKY_DB + _FLOOR_SWITCH_DB

    just_under = _src(
        ("u1", -60.0, "upper"), ("u2", -60.0, "upper"),
        ("m1", -60.0 - bar + 0.5, "main"), ("m2", -60.0 - bar + 0.5, "main"),
        ("m3", -90.0, "main"),
    )
    assert c._select_floor("dev", just_under, "main") == "main"

    just_over = _src(
        ("u1", -60.0, "upper"), ("u2", -60.0, "upper"),
        ("m1", -60.0 - bar - 0.5, "main"), ("m2", -60.0 - bar - 0.5, "main"),
        ("m3", -90.0, "main"),
    )
    assert c._select_floor("dev", just_over, "main") == "upper"


def test_a_device_we_have_never_placed_gets_an_answer() -> None:
    """With nothing to hold on to, refusing to answer is worse than answering.

    A first sighting has no sticky floor; the quorum and margin rules exist to
    protect an EXISTING answer and must not prevent a first one.
    """
    c = _coord()
    assert c._select_floor("new", HEALTHY, "") == "main"
    thin = _src(("u1", -52.0, "upper"))
    assert c._select_floor("new", thin, "") == "upper"


def test_a_sticky_floor_that_has_gone_silent_is_released() -> None:
    """Holding a floor nothing can hear any more would strand the device.

    The hold is only meaningful while the incumbent is still in the running; if
    no scanner on it reported at all, there is no incumbent to defend.
    """
    c = _coord()
    moved_away = _src(("u1", -55.0, "upper"), ("u2", -58.0, "upper"))
    assert c._select_floor("dev", moved_away, "main") == "upper"


def test_no_positioned_scanners_leaves_the_floor_alone() -> None:
    """Nothing heard is not evidence of a move."""
    c = _coord()
    assert c._select_floor("dev", [], "main") == "main"
    assert c._select_floor("dev", _src(("x1", -60.0, "")), "main") == "main"


def test_a_lone_scanner_floor_still_takes_its_handicap() -> None:
    """One scanner is weaker evidence than two, and the score says so.

    Pre-existing behaviour, asserted because the extraction moved it and a
    silent loss would show up as floors flipping toward whichever storey
    happens to have a single loud scanner.
    """
    c = _coord()
    # upper: one scanner at -57 -> -60 after the 3 dB handicap.
    # main:  two at -61/-61 -> -61. Upper still leads, but only by 1 dB, which
    # is inside the switching bar — so the handicap is what keeps it on main.
    lopsided = _src(("u1", -57.0, "upper"),
                    ("m1", -61.0, "main"), ("m2", -61.0, "main"), ("m3", -75.0, "main"))
    assert c._select_floor("dev", lopsided, "main") == "main"
