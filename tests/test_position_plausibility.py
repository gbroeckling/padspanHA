# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A position step that could not have happened is a bad measurement.

Reported as "the whole program looks a bit flakey": groups of beacons sliding
off position for three or four polls and coming back.

Every stage of the pipeline has temporal discipline except one.

    RSSI      Kalman covariance, and _SILENCE_GRACE polls before a silent
              source is allowed to decay
    Room      a candidate must win the vote window, with adjacency and dwell
              gates on top
    Position  a fixed 0.5 gain, no gate, no rejection

`_ab_smooth_xy` accepted HALF of any residual unconditionally, so a spurious
eight-metre jump moved the drawn position four metres on the spot. Worse, the
same residual drives the velocity term, so one bad measurement also gave the
estimate momentum in the wrong direction and it kept travelling on the next
poll. The 2.5 m/s clamp bounds the velocity STATE; it never bounded the step.

That is why the map looked flakey, and why it was the POSITION that looked
wrong rather than the room: position is the stage the map draws, and it was the
stage with nothing defending it.
"""

from __future__ import annotations

import math
from datetime import timedelta
from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_coordinator import (
    _XY_JUMP_SPEED_MS,
    _XY_JUMP_TOLERATE,
    PresenceCoordinator,
)

POLL_S = 10.0


def _coord() -> PresenceCoordinator:
    hass = MagicMock()
    settings = MagicMock()
    settings.data = {}
    hass.data = {DOMAIN: {DATA_SETTINGS: settings}}
    c = PresenceCoordinator(hass)
    c.update_interval = timedelta(seconds=POLL_S)
    c._pending_room_changes = []
    return c


def _settle(c: PresenceCoordinator, store: dict, key: str, x: float, y: float,
            n: int = 6) -> tuple[float, float]:
    """Hold a device still until the filter agrees it is still."""
    out = (x, y)
    for _ in range(n):
        out = c._ab_smooth_xy(store, key, x, y)
    return out


def test_a_stationary_device_stays_put() -> None:
    """The ordinary case, and the one a gate could most easily break."""
    c, store = _coord(), {}
    x, y = _settle(c, store, "dev", 5.0, 5.0)
    assert abs(x - 5.0) < 0.05 and abs(y - 5.0) < 0.05, (x, y)


def test_a_walk_is_followed() -> None:
    """1.2 m/s for six polls. A gate that blocked this would be useless.

    The filter carries velocity precisely so it can follow walking, and the
    plausibility bar sits well above walking speed for that reason.
    """
    c, store = _coord(), {}
    pos = (0.0, 0.0)
    for i in range(1, 7):
        pos = c._ab_smooth_xy(store, "dev", 1.2 * POLL_S * i, 0.0)
    # It should be tracking the target, not stuck at the origin.
    assert pos[0] > 1.2 * POLL_S * 3, pos


def test_an_impossible_jump_is_not_believed() -> None:
    """The fault, stated as the thing the map was doing.

    Eighty metres in one ten-second poll is 8 m/s of apparent motion for a
    beacon that has been sitting still. Under the old filter the drawn position
    moved forty metres — half the residual — immediately.
    """
    c, store = _coord(), {}
    _settle(c, store, "dev", 5.0, 5.0)

    x, y = c._ab_smooth_xy(store, "dev", 85.0, 5.0)

    assert abs(x - 5.0) < 0.5, f"the estimate followed an impossible jump: {x}"
    assert abs(y - 5.0) < 0.5, (x, y)


def test_a_rejected_jump_does_not_leave_momentum_behind() -> None:
    """The half that made a single bad poll last for several.

    The residual used to feed the velocity term, so after one spurious jump the
    filter PREDICTED continued travel in the wrong direction. Rejecting the
    position but keeping the velocity kick would have fixed nothing.
    """
    c, store = _coord(), {}
    _settle(c, store, "dev", 5.0, 5.0)
    c._ab_smooth_xy(store, "dev", 85.0, 5.0)      # rejected

    # Back to the truth: the device never moved, and neither should the estimate.
    x, y = c._ab_smooth_xy(store, "dev", 5.0, 5.0)
    assert abs(x - 5.0) < 0.5, f"the rejected jump left momentum: {x}"

    vx, vy = store["dev"][2], store["dev"][3]
    assert math.hypot(vx, vy) < 0.5, f"velocity survived a rejected jump: {(vx, vy)}"


def test_a_brief_excursion_costs_nothing_at_all() -> None:
    """The measured symptom: a group slides away and returns within ~4 polls.

    One bad poll surrounded by good ones must now leave no trace, rather than
    displacing the estimate and slowly walking it back.
    """
    c, store = _coord(), {}
    _settle(c, store, "dev", 5.0, 5.0)

    c._ab_smooth_xy(store, "dev", 60.0, 60.0)     # the excursion
    for _ in range(2):
        x, y = c._ab_smooth_xy(store, "dev", 5.0, 5.0)

    assert abs(x - 5.0) < 0.3 and abs(y - 5.0) < 0.3, (x, y)


def test_a_device_that_really_did_move_is_believed_in_the_end() -> None:
    """Stubborn, not immovable.

    A beacon switched off and carried across the house really does teleport.
    The gate holds for _XY_JUMP_TOLERATE polls and then accepts, re-seeding
    rather than easing across — the velocity state describes a journey that
    never happened, so carrying it forward would be worse than dropping it.
    """
    c, store = _coord(), {}
    _settle(c, store, "dev", 5.0, 5.0)

    seen = []
    for _ in range(_XY_JUMP_TOLERATE + 1):
        seen.append(c._ab_smooth_xy(store, "dev", 85.0, 5.0))

    assert all(abs(p[0] - 5.0) < 1.0 for p in seen[:_XY_JUMP_TOLERATE]), seen
    assert abs(seen[-1][0] - 85.0) < 1e-6, f"never accepted the relocation: {seen}"
    assert store["dev"][2] == 0.0 and store["dev"][3] == 0.0, (
        "re-seeded with stale velocity: %r" % (store["dev"],))


def test_the_bar_is_above_any_speed_worth_following() -> None:
    """Say the number, so raising or lowering it is a decision.

    The α-β filter clamps velocity at a fast walk (2.5 m/s); the gate sits at
    twice that, so it rejects the impossible without arguing with someone
    moving quickly or a beacon in a car on the drive.
    """
    assert _XY_JUMP_SPEED_MS == 5.0
    c, store = _coord(), {}
    _settle(c, store, "dev", 0.0, 0.0)

    # Just under the bar: followed.
    step = (_XY_JUMP_SPEED_MS - 0.6) * POLL_S
    x, _ = c._ab_smooth_xy(store, "dev", step, 0.0)
    assert x > 1.0, x

    # Well over it: refused.
    c2, store2 = _coord(), {}
    _settle(c2, store2, "dev", 0.0, 0.0)
    over = (_XY_JUMP_SPEED_MS + 3.0) * POLL_S
    x2, _ = c2._ab_smooth_xy(store2, "dev", over, 0.0)
    assert abs(x2) < 0.5, x2


def test_a_first_sighting_is_taken_at_face_value() -> None:
    """There is no prediction to disagree with, so there is nothing to reject."""
    c, store = _coord(), {}
    x, y = c._ab_smooth_xy(store, "dev", 42.0, 17.0)
    assert (x, y) == (42.0, 17.0)


def test_legacy_four_tuple_state_is_upgraded_not_crashed_on() -> None:
    """The store is in memory, but a reload can leave the older shape behind.

    Indexing past the end of a 4-tuple would be an IndexError inside the poll
    path — caught, swallowed, and turned into a view that quietly stops
    updating, which is the failure mode this project keeps paying for.
    """
    c = _coord()
    store = {"dev": (5.0, 5.0, 0.0, 0.0)}
    x, y = c._ab_smooth_xy(store, "dev", 5.2, 5.1)
    assert abs(x - 5.2) < 0.5 and abs(y - 5.1) < 0.5, (x, y)
    assert len(store["dev"]) == 5
