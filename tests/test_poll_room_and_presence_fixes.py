"""Four things the presence poll got wrong, each held by a plain test.

1. A pinned beacon is shown in its pin's room. When the solver put it next
   door, the poll reported "pin's room -> solved room" again on every poll the
   vote was met: an alert, a history row and a tag event each time, for a
   beacon whose shown room never changed. A room change is reported when the
   room an object is SHOWN in changes.

2. Receiver reliability marked every receiver that heard an object, and
   marked it wrong unless the object was in the receiver's own room. With
   objects in several rooms every receiver sank to about 0.5, had its
   readings weakened, and was reported as "disagrees with consensus". Only
   the receiver that hears the object best is judged: the one whose reading
   says "in my room".

3. A device that stops being heard kept voting on what was left of its
   readings. The receivers that heard it every poll let go after 20 s; an old
   reading held by a receiver that seldom heard it then won, and the device
   moved to that receiver's room. With nothing new from any receiver for
   that long, it keeps its room.

4. An object the snapshot stops listing is kept in the result for two
   minutes. Its copy was given an age of 0, so a device away for hours
   "arrived" the moment it dropped off the list; and one dropped while still
   present was never reported as departed.
"""

from __future__ import annotations

import asyncio
import random
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import presence_coordinator as pc
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests import golden_poll as gp
from tests import room_speed_sim as sim
from tests.test_honest_accuracy import S2A, S2F, ROOMS, make_coord, rssi_at

POLL_S = 5.0
TAG = "C0:FF:EE:00:00:AA"
RADIOS = [{"source": "office", "area_name": "Office"}, {"source": "landing", "area_name": "Landing"}]


class _House:
    """One coordinator polled by hand: each poll is given the objects the
    snapshot lists and the adverts heard, and returns what the poll gave."""

    def __init__(self) -> None:
        self.clock = sim.Clock()
        self._snap: list = [None]
        self._loop = asyncio.new_event_loop()
        self._patched = sim._patched(self.clock, sim.FakeManager([]), self._snap)
        self._recording = gp.recording()
        self._patched.__enter__()
        self.rec = self._recording.__enter__()
        hass = MagicMock()
        hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(DEFAULT_SETTINGS))}}
        self.coord = pc.PresenceCoordinator(hass)
        self.coord.update_interval = timedelta(seconds=POLL_S)
        self.n = 0

    def close(self) -> None:
        self._recording.__exit__(None, None, None)
        self._patched.__exit__(None, None, None)
        self._loop.close()

    def poll(self, listed: dict[str, float], heard: dict[str, int] | None = None, label: str = "") -> dict:
        """listed: {key: age_s} as the snapshot lists them. heard: {source:
        rssi} for TAG, each a new advert this poll. label: the name every
        listed key carries."""
        self.clock.t = self.n * POLL_S
        self.n += 1
        ads = [{"address": TAG, "source": s, "rssi": r, "age_s": 1.0, "last_seen": f"advert {self.n} {s}"}
               for s, r in (heard or {}).items()]
        objects = [{"key": k, "address": k, "kind": "ble", "name": k, "identified": True, "age_s": age,
                    **({"user_label": label} if label else {})}
                   for k, age in listed.items()]
        self._snap[0] = {"objects": {"list": objects}, "ble": {"advertisements": ads, "radios": RADIOS}}
        return self._loop.run_until_complete(self.coord._async_update_data())

    @property
    def events(self) -> dict:
        return self.rec.polls[-1]["events"]


@pytest.fixture
def house():
    h = _House()
    try:
        yield h
    finally:
        h.close()


# ── 1. A pinned beacon's room change is reported once ────────────────────────

def test_a_pinned_beacon_reports_a_room_change_only_when_its_shown_room_changes() -> None:
    """The two-floor house's beacon pinned in the Bath is solved into the
    Bedroom next door from its third poll on."""
    polls = gp.run_house(run_s=130.0).polls
    assert len(polls) == 26
    shown = {p["objects"][gp.PIN_BATH]["result"]["room"] for p in polls}
    solved = {(p["objects"][gp.PIN_BATH]["state"]["_last_candidate"] or {}).get("candidate") for p in polls}
    assert shown == {"Bath"} and "Bedroom" in solved          # shown in the Bath while solved next door
    changes = [(i, c[1], c[2]) for i, p in enumerate(polls)
               for c in p["events"].get("room_changes", []) if c[0] == gp.PIN_BATH]
    assert changes == [(0, None, "Bath")], changes            # was five times "Bath -> Bedroom"


# ── 2. Reliability judges the receiver that claims the object ────────────────

def _sit(coord, where: dict[str, tuple[float, float]], polls: int = 40, seed: int = 5) -> None:
    rng = random.Random(seed)
    for _ in range(polls):
        for key, (x, y) in where.items():
            addr = "AA:00:00:00:00:" + key
            coord._smooth_room(key, addr, {addr: rssi_at(x, y, rng, sd=1.0)}, S2A, 3, 2, S2F, ROOMS)


def test_a_receiver_is_not_marked_wrong_for_objects_in_other_rooms() -> None:
    """Two tags sit still, one in the Kitchen and one in the Office. Every
    receiver hears both. None of them has put anything in the wrong room."""
    coord = make_coord()
    _sit(coord, {"01": (1.5, 1.5), "02": (11.5, 2.5)})
    assert coord._confirmed_room == {"01": "Kitchen", "02": "Office"}
    assert coord._scanner_reliability, "the receivers nearest each tag were judged"
    assert all(r == 1.0 for r in coord._scanner_reliability.values()), coord._scanner_reliability
    # Only a receiver that heard one of the tags best has a record at all.
    assert set(coord._scanner_agree) <= {"k1", "k2", "o1", "o2"}


def test_a_receiver_that_claims_objects_for_the_wrong_room_is_still_marked_down() -> None:
    """The receiver beside the Kitchen tag is set to the Office in Home
    Assistant: it hears the tag best, and its room is not where the tag is."""
    coord = make_coord()
    wrong_area = {**S2A, "k1": "Office"}
    rng = random.Random(5)
    for _ in range(40):
        coord._smooth_room("01", "AA:00:00:00:00:01", {"AA:00:00:00:00:01": rssi_at(1.2, 1.2, rng, sd=1.0)},
                           wrong_area, 3, 2, S2F, ROOMS)
    assert coord._confirmed_room["01"] == "Kitchen"
    assert coord._scanner_reliability["k1"] < 0.8
    assert all(r == 1.0 for s, r in coord._scanner_reliability.items() if s != "k1")


# ── 3. No fresh reading: the room is kept ────────────────────────────────────

def test_a_device_that_stops_being_heard_keeps_its_room(house) -> None:
    """A tag in the Office: the Office receiver hears it every poll, the
    Landing receiver once in five. Then it is switched off."""
    for n in range(21):
        heard = {"office": -60}
        if n % 5 == 0:
            heard["landing"] = -75
        house.poll({TAG: 1.0}, heard)
    assert house.coord._confirmed_room[TAG] == "Office"
    assert house.coord._advert_gap[TAG]["landing"] > 4      # the Landing receiver's readings are held longer
    rooms = []
    for n in range(1, 12):                     # 55 s of silence, still listed
        result = house.poll({TAG: 1.0 + n * POLL_S})
        rooms.append(result[TAG].get("room"))
    # The Office reading is let go after 20 s; the Landing one is held for
    # longer, being a receiver that seldom hears the tag. It was then the only
    # reading, the Landing won the vote, and the tag moved there.
    assert rooms == ["Office"] * 11, rooms
    assert house.coord._confirmed_room[TAG] == "Office"


def test_a_device_heard_again_moves_as_before(house) -> None:
    """Silence holds the room; it does not hold a move that is then heard."""
    for _ in range(8):
        house.poll({TAG: 1.0}, {"office": -60, "landing": -88})
    for n in range(1, 8):
        house.poll({TAG: 1.0 + n * POLL_S})
    rooms = [house.poll({TAG: 1.0}, {"landing": -55})[TAG].get("room") for _ in range(6)]
    assert rooms[-1] == "Landing", rooms


# ── 4. Arrivals and departures ───────────────────────────────────────────────

def _came_and_went(house, polls: int, listed: dict[str, float] | None = None) -> tuple[list, list]:
    arrived, departed = [], []
    for _ in range(polls):
        house.poll(listed or {})
        arrived += house.events.get("arrived", [])
        departed += house.events.get("departed", [])
    return arrived, departed


def test_a_device_that_drops_off_the_list_does_not_arrive(house) -> None:
    """Heard, then silent past the away timeout (it departs), then no longer
    listed at all: it has not come back."""
    house.poll({TAG: 1.0})
    house.poll({TAG: 2.0})
    house.poll({TAG: 400.0})                              # away: over the 5 minute timeout
    assert house.events.get("departed") == [TAG]
    result = house.poll({})                               # the snapshot stops listing it
    assert result[TAG]["age_s"] >= 400.0                  # was 0.0: "just heard"
    arrived, departed = _came_and_went(house, 30)
    assert arrived == [] and departed == []               # was: arrived, the poll after it dropped off
    assert TAG not in house.poll({})                      # and it is dropped when the two minutes are up
    # Heard again, it arrives.
    house.poll({TAG: 1.0})
    assert house.events.get("arrived") == [TAG]


def test_a_device_dropped_while_present_departs(house) -> None:
    """Heard, then no longer listed while still within the away timeout: it
    is kept for two minutes, its age going on, and departs when it is dropped."""
    house.poll({TAG: 1.0})
    house.poll({TAG: 2.0})
    result = house.poll({})
    assert result[TAG]["age_s"] == pytest.approx(2.0 + POLL_S)
    arrived, departed = _came_and_went(house, 30)
    assert TAG not in house.poll({})
    assert arrived == [] and departed == [TAG]            # was: never reported as departed


def test_two_keys_of_one_device_heard_at_the_same_moment_are_in_a_fixed_order(house) -> None:
    """One name on several keys is one device, reported by its freshest key.
    Keys of exactly the same age were taken in the order of a Python set,
    which changes from one start to the next."""
    keys = [f"C0:FF:EE:00:00:{n:02X}" for n in (9, 3, 7, 1, 5)]
    house.poll({k: 1.0 for k in keys}, label="Phone")
    assert house.coord._prev_groups == {"label:phone": sorted(keys)}
