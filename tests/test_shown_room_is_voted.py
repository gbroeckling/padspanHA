"""The room shown for a Bluetooth device is the room vote's (November 2026).

While a device had no voted room, the poll left the snapshot's own room in
place: the area of its strongest receiver, from adverts up to 60 s old, with no
signal filter, no vote and no Room Change Delay. That happens after the reset
when a device comes back from a short quiet spell, and for as long as the vote
is held for want of fresh readings. On a recording of a real house about a
quarter of all room changes went through such a poll, and no setting reached
them. Now, with no voted room yet, a device that never went away is shown in
the last room the vote gave it, and one with none (first seen since a start,
or back from away) is shown in no room until the vote names one.
"""

from __future__ import annotations

import pytest

from tests.test_poll_room_and_presence_fixes import POLL_S, TAG, _House


@pytest.fixture
def house():
    h = _House()
    try:
        yield h
    finally:
        h.close()


def _in_office(house) -> None:
    for _ in range(10):
        house.poll({TAG: 1.0}, {"office": -60}, raw="Office")
    assert house.coord._confirmed_room[TAG] == "Office"
    for n in range(1, 4):                       # quiet for over a minute, never away
        assert house.poll({TAG: 60.0 + n * POLL_S}, raw="Office")[TAG]["room"] == "Office"


def test_back_from_a_quiet_spell_the_old_room_stays_until_the_vote_moves_it(house) -> None:
    """Heard again, on the Landing: the Landing is shown when the vote gives
    it, not on the first poll the snapshot's strongest receiver says so."""
    _in_office(house)
    shown, voted = [], []
    for _ in range(8):
        shown.append(house.poll({TAG: 1.0}, {"landing": -55}, raw="Landing")[TAG].get("room"))
        voted.append(house.coord._confirmed_room.get(TAG))
    first = voted.index("Landing")
    assert first > 0, voted                                   # the vote needed some polls
    assert shown == ["Office"] * first + ["Landing"] * (8 - first), (shown, voted)   # was "Landing" from the first


def test_a_held_vote_shows_the_last_voted_room_not_the_snapshots(house) -> None:
    """Back from a quiet spell with no new advert: the vote is held, and the
    snapshot's room swaps between two receivers of a near-tie."""
    _in_office(house)
    shown = [house.poll({TAG: 30.0 + n}, raw="Landing" if n % 2 else "Office")[TAG].get("room")
             for n in range(10)]
    assert house.coord._confirmed_room.get(TAG) is None       # no voted room all along
    assert shown == ["Office"] * 10, shown                     # was Office, Landing, Office, ...


def test_with_no_voted_room_at_all_nothing_is_shown_until_the_vote_has_one(house) -> None:
    """First seen since the start: no room until the vote names one."""
    shown, voted = [], []
    for _ in range(8):
        shown.append(house.poll({TAG: 1.0}, {"landing": -55}, raw="Landing")[TAG].get("room"))
        voted.append(house.coord._confirmed_room.get(TAG))
    first = voted.index("Landing")
    assert first > 0, voted
    assert shown == [None] * first + ["Landing"] * (8 - first), (shown, voted)     # was "Landing" from the first


def test_the_panel_shows_no_room_where_the_vote_has_none() -> None:
    """The live snapshot takes the poll's room over its own, and with none
    (a smoothed device the vote has not placed) it is no room, as on the
    device's entities; it kept its own strongest-receiver room."""
    from tests.test_room_hold_and_reason import ADDR, K, _pc_with_gap, _run_snapshot

    objs = [{"key": K, "address": ADDR, "kind": "ble", "room": "Landing", "age_s": 5.0}]
    pc = _pc_with_gap()
    pc.data = {K: {"key": K, "_smoothed": True, "room": None}}
    assert _run_snapshot({}, objs, pc)["objects"]["list"][0]["room"] == ""      # was "Landing"
    pc.data = {K: {"key": K, "_smoothed": True, "room": "Office"}}
    assert _run_snapshot({}, objs, pc)["objects"]["list"][0]["room"] == "Office"
    pc.data = {K: {"key": K, "room": None}}                    # not smoothed here: its own room stands
    assert _run_snapshot({}, objs, pc)["objects"]["list"][0]["room"] == "Landing"


def test_back_from_away_starts_afresh(house) -> None:
    """Away is not a short gap: its old room is not shown on the way back."""
    _in_office(house)
    house.poll({TAG: 400.0}, raw="Office")                     # over the 5 minute away timeout
    shown = [house.poll({TAG: 1.0}, {"landing": -55}, raw="Landing")[TAG].get("room") for _ in range(8)]
    assert "Office" not in shown and shown[0] is None and shown[-1] == "Landing", shown
