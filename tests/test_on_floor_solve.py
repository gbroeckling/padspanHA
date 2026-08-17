# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Scanners on the device's floor place it; scanners on other floors do not.

Reported as "the Samsung TV wanders all over the living room but has a massive
amount of data coming in from the scanners — how is it possible to mess that
up?" The answer is that the amount of data was the problem.

Measured on a stationary device (MaschineBOX, sitting in the Spare Bedroom
Closet on `upper`) in a single poll:

    scanners   Spare Bedroom Closet  -62.8   upper   <- 12 dB clearer than anything
               Lower Garage          -74.0   main
               Garage                -74.7   main
    room vote  Spare Bedroom Closet                  <- correct
    spatial    computed (-3.6, -9.5) @ main  ->  NO_GEOMETRY_HIT

The room stage got it right and the position stage put it a floor down, at a
point outside every room. Two garage scanners hearing it through the slab were
fed into the horizontal centroid as if they were on-floor ranges, and with
distance weighting two readings at -74 roughly balance one at -63. More
scanners hearing a device weakly through walls and floors made its position
WORSE, not better — which is exactly what a device with "a massive amount of
data coming in" experiences.

A cross-floor reading is evidence about which FLOOR the device is on. It is
almost no evidence about where on that floor it is: the path went mostly
vertical, and the slab penalty is one average number standing in for whatever
is actually between the two. So on-floor scanners solve position whenever there
are enough of them to solve at all; the cross-floor set is the fallback for a
floor too thinly covered to solve alone.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DATA_MODEL, DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator


def _coord() -> PresenceCoordinator:
    hass = MagicMock()
    settings = MagicMock()
    settings.data = {"kalman_q": 0.125, "kalman_r": 8.0}
    model = MagicMock()
    # The solve only needs the model to be present and to answer the room
    # containment query; None means "no room contains this point".
    model.beacon_room_from_geometry.return_value = None
    hass.data = {DOMAIN: {DATA_SETTINGS: settings, DATA_MODEL: model}}
    c = PresenceCoordinator(hass)
    c.update_interval = timedelta(seconds=10)
    c._pending_room_changes = []
    c._use_metres = True
    # A three-storey house: garage under the closet, one slab apart. The
    # closet's own scanners sit around x≈10; the garage pair sits at x≈4.
    c._scanner_positions = {
        "closet_a": (10.0, -17.0, "upper"),
        "closet_b": (12.0, -15.0, "upper"),
        "closet_c": (11.0, -19.0, "upper"),
        "garage_a": (4.0, -13.0, "main"),
        "garage_b": (5.0, -16.0, "main"),
        "lower_garage": (4.5, -14.0, "basement"),
    }
    c._floor_stack_idx = {"basement": 0, "main": 1, "upper": 2}
    c._floor_bases = {"basement": 0.0, "main": 3.0, "upper": 5.3}
    c._scanner_abs_z = {s: c._floor_bases[p[2]] + 2.3 for s, p in c._scanner_positions.items()}
    c._floor_bounds = {"upper": (0.0, -25.0, 15.0, 0.0),
                       "main": (0.0, -25.0, 15.0, 0.0),
                       "basement": (0.0, -25.0, 15.0, 0.0)}
    c._room_centroids = {}
    return c


S2A = {"closet_a": "Closet", "closet_b": "Closet", "closet_c": "Closet",
       "garage_a": "Garage", "garage_b": "Garage", "lower_garage": "Lower Garage"}
S2F = {"closet_a": "upper", "closet_b": "upper", "closet_c": "upper",
       "garage_a": "main", "garage_b": "main", "lower_garage": "basement"}


def _run(c: PresenceCoordinator, key: str, rssi: dict[str, float], polls: int = 4):
    addr = "AA:BB:CC:DD:EE:01"
    for _ in range(polls):
        c._smooth_room(key, addr, {addr: rssi}, S2A, 2, 2, S2F, {"Closet", "Garage"})
    return c._spatial_position.get(key)


def test_a_device_clear_on_its_own_floor_is_placed_on_that_floor() -> None:
    """The measured fault. Loud upstairs, heard weakly by two floors below.

    Under the old solve the two garage readings pulled the centroid to x≈6 on
    the main floor. The device is in the closet at x≈11.
    """
    c = _coord()
    # The measured shape: ONE clear on-floor scanner, plus two more upstairs
    # that hear it about as faintly as the garage pair below do. Three on-floor
    # readings, only one of them close — which is what a device in a small
    # room on a well-covered floor actually looks like.
    pos = _run(c, "box", {
        "closet_a": -62.8, "closet_b": -73.0, "closet_c": -75.0,
        "garage_a": -74.0, "garage_b": -74.7, "lower_garage": -79.0,
    })
    assert pos is not None, c._spatial_debug
    assert pos["floor_id"] == "upper", (pos, c._spatial_debug)
    # closet_a sits at x=10; the garage pair at x≈4-5. With the garage pair in
    # the centroid the answer lands between them; without it, it stays with
    # the closet.
    assert pos["x_m"] > 8.5, (
        "the cross-floor pair dragged the position toward the garage: %r" % (pos,))


def test_cross_floor_readings_do_not_move_a_well_covered_device() -> None:
    """Adding weak through-slab readings must not change a solvable answer.

    This is the property the TV was missing: it had plenty of on-floor data,
    and every extra scanner that heard it faintly through a wall or floor made
    the answer wobble.
    """
    c1 = _coord()
    alone = _run(c1, "d", {"closet_a": -60.0, "closet_b": -64.0, "closet_c": -66.0})
    c2 = _coord()
    with_bleed = _run(c2, "d", {"closet_a": -60.0, "closet_b": -64.0, "closet_c": -66.0,
                                "garage_a": -78.0, "garage_b": -80.0, "lower_garage": -85.0})
    assert alone is not None and with_bleed is not None
    assert with_bleed["floor_id"] == alone["floor_id"] == "upper"
    assert abs(with_bleed["x_m"] - alone["x_m"]) < 0.5, (alone, with_bleed)
    assert abs(with_bleed["y_m"] - alone["y_m"]) < 0.5, (alone, with_bleed)


def test_a_thinly_covered_floor_still_gets_a_position() -> None:
    """The fallback. Two on-floor scanners cannot solve; cross-floor is admitted.

    A room with only two receivers must not lose its position entirely — that
    would be a regression on every install with a sparse floor. Cross-floor
    readings are worse than on-floor ones, and better than nothing.
    """
    c = _coord()
    pos = _run(c, "sparse", {
        "closet_a": -60.0, "closet_b": -64.0,            # only two upstairs
        "garage_a": -76.0, "garage_b": -77.0, "lower_garage": -84.0,
    })
    assert pos is not None, "a sparse floor lost its position: %r" % (c._spatial_debug,)
    assert pos["floor_id"] == "upper", pos


# ── A thin poll is a gap, not a move ─────────────────────────────────────────
# Measured on the same house with the capture harness, ten minutes, 22 floor
# change events. Seventeen were one shape: a beacon that never left its room
# (roomFrom == roomTo, every time) had its FLOOR flip to "__outside__" on a
# poll where a single scanner heard it at -89 dBm or worse, and flip back
# when the others returned. The spatial solve could not run on one scanner,
# so it POPPED the position, and the object fell back to k-NN — which, asked
# to match one faint reading against 746 fingerprints, returned whichever
# point happened to have that scanner faint. On this house that is routinely
# an outdoor point.

def test_a_thin_poll_holds_the_last_position_instead_of_dropping_it() -> None:
    """The room vote never moved; the position must not either."""
    c = _coord()
    good = {"closet_a": -60.0, "closet_b": -64.0, "closet_c": -66.0}
    pos = _run(c, "dev", good)
    assert pos is not None and pos["floor_id"] == "upper"

    # The scanners go quiet. For the first _SILENCE_GRACE polls the anchor
    # hold (an earlier fix) keeps solving on their held values, so the solve
    # still runs; the position may drift a little as one live reading fades.
    # Once the held anchors expire the solve CANNOT run — and that is the poll
    # this test is about: the old code popped the position right here.
    addr = "AA:BB:CC:DD:EE:01"
    for _ in range(3):
        c._smooth_room("dev", addr, {addr: {"closet_a": -95.0}}, S2A, 2, 2, S2F, {"Closet"})
    held = c._spatial_position.get("dev")
    assert held is not None, "a thin poll discarded a good position"
    assert held["floor_id"] == "upper", held
    assert held.get("_held_polls", 0) >= 1, "the position was not marked as held: %r" % (held,)


def test_a_position_held_too_long_is_released() -> None:
    """Stubborn, not immovable — the same window the RSSI stage uses.

    A device that genuinely goes quiet must not be pinned to its last spot
    forever; past the silence grace the position is stale and is dropped.
    """
    c = _coord()
    _run(c, "dev", {"closet_a": -60.0, "closet_b": -64.0, "closet_c": -66.0})
    addr = "AA:BB:CC:DD:EE:01"
    # Anchors hold for _SILENCE_GRACE (2 at 10 s), then the position holds
    # for _SILENCE_GRACE more, then it is released: 2 + 2 + 1 thin polls.
    for _ in range(6):
        c._smooth_room("dev", addr, {addr: {"closet_a": -95.0}}, S2A, 2, 2, S2F, {"Closet"})
    assert c._spatial_position.get("dev") is None, (
        "a stale position was held indefinitely: %r" % (c._spatial_position.get("dev"),))


def test_knn_is_not_consulted_on_a_single_reading() -> None:
    """One reading has no discriminating power against hundreds of fingerprints.

    This is the other half of the same fault: with the position held, k-NN
    must ALSO not be handed a one-scanner query, or its answer still leaks into
    the candidate room.
    """
    from unittest.mock import MagicMock
    from custom_components.padspan_ha.const import DATA_CALIBRATION

    c = _coord()
    cal = MagicMock()
    cal.data = {"points": [{}] * 50}
    cal.rf_trained = False
    cal.knn_locate = MagicMock(return_value={"room": "Garden", "confidence": 0.9,
                                             "x_m": 30.0, "y_m": 30.0, "floor_id": "__outside__"})
    c.hass.data[DOMAIN][DATA_CALIBRATION] = cal
    addr = "AA:BB:CC:DD:EE:01"

    # Two readings: k-NN may be asked.
    c._smooth_room("dev", addr, {addr: {"closet_a": -70.0, "closet_b": -75.0}}, S2A, 2, 2, S2F, {"Closet"})
    asked_with_two = cal.knn_locate.call_count
    # One reading: it must not be.
    c._smooth_room("dev2", addr, {addr: {"closet_a": -95.0}}, S2A, 2, 2, S2F, {"Closet"})
    assert cal.knn_locate.call_count == asked_with_two, (
        "k-NN was consulted on a single faint reading")
