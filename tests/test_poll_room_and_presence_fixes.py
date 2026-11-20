"""Four things the presence poll got wrong, each held by a plain test.

1. A pinned beacon is shown in its pin's room. When the solver put it next
   door, the poll reported "pin's room -> solved room" again on every poll the
   vote was met: an alert, a history row and a tag event each time, for a
   beacon whose shown room never changed. A room change is reported when the
   room an object is SHOWN in changes.

2. A device that stops being heard kept voting on what was left of its
   readings. The receivers that heard it every poll let go after 20 s; an old
   reading held by a receiver that seldom heard it then won, and the device
   moved to that receiver's room. With nothing new from any receiver for
   three polls (15 s), it keeps its room.

3. An object the snapshot stops listing is kept in the result for two
   minutes. Its copy was given an age of 0, so a device away for hours
   "arrived" the moment it dropped off the list; and one dropped while still
   present was never reported as departed.

4. Room-change events and Follow's room alerts are held back while one was
   sent a moment ago. The next one went out with the poll's own "from" room,
   which is not always the room last reported: the same change was sent twice
   running, and an event could start in a room no event had ended in. What is
   sent now starts in the room the last one ended in.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import presence_coordinator as pc
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests import golden_poll as gp
from tests import room_speed_sim as sim

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


# ── 2. No fresh reading: the room is kept ────────────────────────────────────

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


# ── 3. Arrivals and departures ───────────────────────────────────────────────

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


# ── 4. What is reported starts where the last report ended ───────────────────
# Seen on a real house with nobody moving: "Living Room -> Garage" sent twice
# running with nothing between, and an event that started in a room no event
# had ended in. Neither device was pinned.

def test_a_device_dropped_from_the_list_for_a_minute_reports_its_next_room_from_the_old_one(house) -> None:
    """Shown in the Office; the snapshot stops listing it for 75 s (it is
    kept, shown in the Office); listed again, it is heard on the Landing."""
    for _ in range(8):
        house.poll({TAG: 1.0}, {"office": -60})
    assert house.coord._confirmed_room[TAG] == "Office"
    for _ in range(15):
        assert house.poll({})[TAG]["room"] == "Office"
    changes = []
    for _ in range(8):
        house.poll({TAG: 1.0}, {"landing": -55})
        changes += [tuple(c) for c in house.events.get("room_changes", [])]
    assert changes == [(TAG, "Office", "Landing")], changes       # was (TAG, None, "Landing"): a first placement


@pytest.fixture
def tags(monkeypatch):
    """The tag events, with Home Assistant's tag component standing in and a
    clock the test moves."""
    import sys
    import types
    from unittest.mock import AsyncMock

    from custom_components.padspan_ha import tag_integration as ti

    mod = types.ModuleType("homeassistant.components.tag")
    mod.async_scan_tag = AsyncMock()
    monkeypatch.setitem(sys.modules, "homeassistant.components.tag", mod)
    clock = [1000.0]
    monkeypatch.setattr(ti.time, "time", lambda: clock[0])
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={
        "tags_room_events_enabled": True, "followed_addrs": [TAG]})}}
    integration = ti.TagIntegration(hass)

    def sent() -> list[tuple]:
        return [(c.args[1]["from_room"], c.args[1]["to_room"])
                for c in hass.bus.async_fire.call_args_list if c.args[0] == "padspan_room_change"]

    async def change(after_s: float, old: str | None, new: str) -> None:
        clock[0] += after_s
        result = {TAG: {"address": TAG, "room": new}}
        await integration.async_emit_room_changes([(TAG, old, new)], result)
        await integration.async_emit_held(result)

    return SimpleNamespace(change=change, sent=sent)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_room_change_event_is_not_sent_twice_running(tags) -> None:
    """Living Room -> Garage, back 16 s later (inside the 30 s between
    events, so held), and to the Garage again 16 s after that."""
    _run(tags.change(0, "Living Room", "Garage"))
    _run(tags.change(16, "Garage", "Living Room"))
    _run(tags.change(16, "Living Room", "Garage"))
    assert tags.sent() == [("Living Room", "Garage")]             # was the same event twice
    _run(tags.change(60, "Garage", "Living Room"))
    assert tags.sent() == [("Living Room", "Garage"), ("Garage", "Living Room")]


def test_every_room_change_event_starts_where_the_last_one_ended(tags) -> None:
    """The poll starts a device afresh (dropped from the list, back from
    away): its next room comes with no "from" room, and the one after that
    with a "from" room no event ever ended in."""
    _run(tags.change(0, "Lower Garage", "Entry"))
    _run(tags.change(600, None, "Bedroom Closet"))                # afresh: was not sent at all
    _run(tags.change(600, "Bedroom Closet", "Lower Garage"))
    _run(tags.change(600, None, "Lower Garage"))                  # afresh, in the room last reported: nothing
    events = tags.sent()
    assert events == [("Lower Garage", "Entry"), ("Entry", "Bedroom Closet"), ("Bedroom Closet", "Lower Garage")]
    assert all(b[0] == a[1] for a, b in zip(events, events[1:]))


def test_a_first_room_after_a_restart_is_still_not_an_event(tags) -> None:
    _run(tags.change(0, None, "Kitchen"))
    assert tags.sent() == []


def test_a_follow_alert_is_not_sent_twice_running() -> None:
    """The same shape through Follow's room alerts (60 s between alerts)."""
    from tests.test_follow_arrive_depart_alerts import _make_coordinator

    key = "ble:AA:BB:CC:DD:EE:FF"
    coord = _make_coordinator({"AA:BB:CC:DD:EE:FF": {"on_room_change": True,
                                                     "notify_service": "notify.mobile_app_phone"}})
    coord.hass.services.async_services.return_value = {"notify": {"mobile_app_phone": True}}

    def at(now: float, old: str, new: str) -> None:
        result = {key: {"user_label": "Phone", "address": "AA:BB:CC:DD:EE:FF", "room": new}}
        _run(coord._process_room_alerts(now, result, [(key, old, new)]))
        _run(coord._flush_held_room_alerts(now, result))

    at(1000.0, "Kitchen", "Hall")
    at(1020.0, "Hall", "Kitchen")              # inside the cooldown: held
    at(1070.0, "Kitchen", "Hall")              # back in the room last reported
    messages = [c.args[2]["message"] for c in coord.hass.services.async_call.call_args_list]
    assert messages == ["Phone moved from Kitchen to Hall"], messages      # was the same message twice
    at(1200.0, "Hall", "Bedroom")
    messages = [c.args[2]["message"] for c in coord.hass.services.async_call.call_args_list]
    assert messages == ["Phone moved from Kitchen to Hall", "Phone moved from Hall to Bedroom"]
