"""The rules that make a room change show quickly without a still device
flickering, one at a time (tests/test_room_speed.py measures them together on
a walk). Every clock is explicit: polls are 5 s apart because the test says
so, never because of how fast it runs."""

from __future__ import annotations

import datetime as dt
import sys
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import bluetooth_live as BL
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS, SettingsStore
from tests.test_poll_level import ble_object, run_poll, snapshot

S2A = {"sa": "A", "sb": "B"}
ROOMS = {"A", "B"}


def _coord(settings: dict | None = None) -> PresenceCoordinator:
    hass = MagicMock()
    st = MagicMock()
    st.data = {**DEFAULT_SETTINGS, **(settings or {})}
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    c = PresenceCoordinator(hass)
    c.update_interval = timedelta(seconds=5)
    c._pending_room_changes = []
    return c


class _Walk:
    """One device, polled every 5 s of explicit time."""

    def __init__(self, coord: PresenceCoordinator) -> None:
        self.c = coord
        self.t = 1000.0

    def poll(self, readings: dict[str, float]) -> str | None:
        self.t += 5.0
        return self.c._smooth_room("dev", "D", {"D": dict(readings)}, S2A, 4, 3, {}, ROOMS, self.t)

    def settle(self, readings: dict[str, float], polls: int = 30) -> str | None:
        room = None
        for _ in range(polls):
            room = self.poll(readings)
        return room

    @property
    def ema(self) -> dict[str, float]:
        return self.c._ema_rssi["D"]

    @property
    def votes(self) -> list[str]:
        return list(self.c._room_votes["dev"])


# ── The Kalman stage ─────────────────────────────────────────────────────────

def test_a_move_is_followed_in_one_poll() -> None:
    w = _Walk(_coord())
    assert w.settle({"sa": -60.0, "sb": -80.0}) == "A"
    w.poll({"sa": -80.0, "sb": -60.0})
    # Most of the way at once: B came 20 dB closer, A fell 20 dB with it.
    assert w.ema["sb"] >= -64.0
    assert w.ema["sa"] <= -76.0


def test_a_drop_with_nothing_else_moving_is_taken_as_a_fade() -> None:
    w = _Walk(_coord())
    w.settle({"sa": -60.0, "sb": -80.0})
    w.poll({"sa": -80.0, "sb": -80.0})
    # Counted, but only as far as the noise allows: a few dB, not 20.
    assert -66.0 < w.ema["sa"] < -60.5


def test_a_scanner_that_hears_seldom_is_not_silent_between_its_adverts() -> None:
    w = _Walk(_coord())
    # sb hears this device one poll in four; sa every poll.
    for i in range(40):
        w.poll({"sa": -60.0, "sb": -70.0} if i % 4 == 0 else {"sa": -60.0})
    w.poll({"sa": -60.0, "sb": -70.0})
    for _ in range(8):                      # twice its usual gap, 40 s
        w.poll({"sa": -60.0})
    assert w.ema["sb"] == pytest.approx(-70.0, abs=0.5)   # still held, not decayed


def test_a_scanner_that_hears_every_poll_is_silent_after_20_s() -> None:
    w = _Walk(_coord())
    w.settle({"sa": -60.0, "sb": -70.0})
    for _ in range(5):
        w.poll({"sa": -60.0})
    assert w.ema["sb"] < -71.0               # decaying


def test_a_move_ends_the_hold_on_a_scanner_with_nothing_new() -> None:
    w = _Walk(_coord())
    for i in range(40):
        w.poll({"sa": -60.0, "sb": -85.0} if i % 4 == 0 else {"sb": -85.0})
    w.poll({"sa": -60.0, "sb": -85.0})
    w.poll({"sb": -85.0})                    # sa: nothing new, held
    assert w.ema["sa"] == pytest.approx(-60.0, abs=0.5)
    w.poll({"sb": -62.0})                    # the device walked to sb
    # sa's last reading says where it was: no longer held.
    assert w.ema["sa"] < -62.0


# ── The vote ─────────────────────────────────────────────────────────────────

def test_a_clear_move_next_door_is_shown_after_half_the_delay() -> None:
    w = _Walk(_coord())
    assert w.settle({"sa": -60.0, "sb": -85.0}) == "A"
    assert w.poll({"sa": -85.0, "sb": -60.0}) == "A"
    assert w.poll({"sa": -85.0, "sb": -60.0}) == "B"      # two polls, not three
    assert w.votes.count("B") == 2


def test_a_close_call_waits_for_the_whole_vote() -> None:
    w = _Walk(_coord())
    w.settle({"sa": -62.0, "sb": -66.0})
    shown = []
    for _ in range(12):
        shown.append(w.poll({"sa": -66.0, "sb": -62.0}))
        if shown[-1] == "B":
            break
    assert shown[-1] == "B"
    # 4 dB ahead is over the hysteresis but not clear: it took the majority.
    assert w.votes.count("B") >= 3


def test_a_clear_move_to_a_far_room_waits_for_the_whole_vote() -> None:
    c = _coord()
    c._use_metres = True
    c._room_centroids = {"A": (0.0, 0.0, "main"), "B": (12.0, 0.0, "main")}
    w = _Walk(c)
    w.settle({"sa": -60.0, "sb": -85.0})
    shown = []
    for _ in range(8):
        shown.append(w.poll({"sa": -85.0, "sb": -60.0}))
        if shown[-1] == "B":
            break
    assert shown[-1] == "B" and len(shown) >= 4
    assert w.votes == ["B"] * 4


# ── Each advert once ─────────────────────────────────────────────────────────

def test_an_advert_already_used_is_not_used_again() -> None:
    from tests.test_poll_level import make_coordinator

    coord = make_coordinator(dict(DEFAULT_SETTINGS))
    addr = "AA:BB:CC:00:00:01"

    def ad(rssi: float, seen: str) -> dict:
        return {"address": addr, "source": "sa", "rssi": rssi, "age_s": 1.0, "last_seen": seen}

    obj = ble_object("k1", addr, age_s=1.0, identified=True)
    run_poll(coord, snapshot([obj], [ad(-60.0, "2026-11-18T10:00:00+00:00")]))
    run_poll(coord, snapshot([obj], [ad(-60.0, "2026-11-18T10:00:00+00:00")]))
    assert coord._silence_miss[addr].get("sa") == 1         # nothing new from sa
    run_poll(coord, snapshot([obj], [ad(-62.0, "2026-11-18T10:00:05+00:00")]))
    assert coord._silence_miss[addr].get("sa") is None       # a new advert
    assert coord._ema_rssi[addr]["sa"] < -60.0


# ── Reading every scanner every poll ─────────────────────────────────────────

class _Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def monotonic(self) -> float:
        return 5000.0 + self.t

    def time(self) -> float:
        return 1_790_000_000.0 + self.t

    def now(self) -> dt.datetime:
        return dt.datetime.fromtimestamp(self.time(), tz=dt.timezone.utc)


@pytest.fixture
def scanner_stack(monkeypatch):
    clock = _Clock()
    monkeypatch.setattr(BL, "_now", clock.now)
    monkeypatch.setattr(BL, "time", clock)
    dev = SimpleNamespace(address="C0:00:00:00:00:01", name="", details={})
    sc = SimpleNamespace(source="sa", discovered_devices_and_advertisement_data={},
                         discovered_device_timestamps={})

    def hear(rssi: int, payload: bytes = b"\x01\x02") -> None:
        adv = SimpleNamespace(rssi=rssi, local_name="", tx_power=None, service_uuids=[],
                              service_data={}, manufacturer_data={0xFFFF: payload})
        sc.discovered_devices_and_advertisement_data[dev.address] = (dev, adv)
        sc.discovered_device_timestamps[dev.address] = clock.monotonic()

    manager = SimpleNamespace(async_current_scanners=lambda: [sc],
                              async_last_service_info=lambda a, c: None)
    monkeypatch.setitem(sys.modules, "habluetooth", SimpleNamespace(get_manager=lambda: manager))
    st = MagicMock()
    st.data = dict(DEFAULT_SETTINGS)
    bl = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}))
    return SimpleNamespace(bl=bl, clock=clock, hear=hear, addr=dev.address)


def test_the_reseed_skips_an_advert_it_already_holds(scanner_stack) -> None:
    s = scanner_stack
    s.hear(-60)
    s.bl._seed_from_discovered()
    held = s.bl._seen_by_source[s.addr]["sa"]
    s.clock.t += 5.0
    s.bl._seed_from_discovered()
    assert s.bl._seen_by_source[s.addr]["sa"] is held


def test_a_new_advert_saying_the_same_reuses_the_record(scanner_stack, monkeypatch) -> None:
    s = scanner_stack
    s.hear(-60)
    s.bl._seed_from_discovered()
    before = s.bl._seen_by_source[s.addr]["sa"].record
    s.clock.t += 5.0
    s.hear(-66)

    def _no(*a, **k):
        raise AssertionError("the advert's data was formatted again")

    monkeypatch.setattr(BL, "_service_info_to_record_from_adv", _no)
    s.bl._seed_from_discovered()
    after = s.bl._seen_by_source[s.addr]["sa"].record
    assert after["rssi"] == -66 and after["last_seen"] != before["last_seen"]
    assert after["manufacturer_data"] == before["manufacturer_data"]


def test_a_new_advert_saying_something_else_is_read_in_full(scanner_stack) -> None:
    s = scanner_stack
    s.hear(-60, b"\x01\x02")
    s.bl._seed_from_discovered()
    s.clock.t += 5.0
    s.hear(-60, b"\x03\x04")
    s.bl._seed_from_discovered()
    assert s.bl._seen_by_source[s.addr]["sa"].record["manufacturer_data"] == {"65535": "0x03 0x04"}


def test_every_scanner_is_read_on_every_5_s_poll(scanner_stack) -> None:
    s = scanner_stack
    s.hear(-60)
    assert s.bl.get_snapshot()["diag"]["seeded"] is True
    for _ in range(4):
        s.clock.t += 5.0
        assert s.bl.get_snapshot()["diag"]["seeded"] is True


def test_the_median_looks_back_one_poll() -> None:
    assert BL.median_window_s({}) == 5.0
    assert BL.median_window_s({"presence_poll_interval_s": 10}) == 10.0
    assert BL.median_window_s({"presence_poll_interval_s": 60}) == 15.0
    assert BL.median_window_s({"presence_poll_interval_s": "x"}) == 5.0


# ── Installs on the old defaults ─────────────────────────────────────────────

class _Store:
    def __init__(self, data):
        self._data = data

    async def async_load(self):
        return self._data

    async def async_save(self, data):
        self._data = data


async def _load(stored: dict) -> dict:
    ss = SettingsStore.__new__(SettingsStore)
    ss.hass = MagicMock()
    ss.store = _Store(stored)
    ss.data = dict(DEFAULT_SETTINGS)
    return await ss.async_load()


@pytest.mark.asyncio
async def test_the_old_defaults_move_to_the_new_ones_once() -> None:
    data = await _load({"kalman_q": 0.125, "ble_reseed_interval_s": 30})
    assert data["kalman_q"] == 3.0 and data["ble_reseed_interval_s"] == 5
    assert data["room_speed_v1_applied"] is True
    # Set back by hand afterwards: it stays.
    data = await _load({"kalman_q": 0.125, "ble_reseed_interval_s": 30, "room_speed_v1_applied": True})
    assert data["kalman_q"] == 0.125 and data["ble_reseed_interval_s"] == 30


@pytest.mark.asyncio
async def test_values_someone_chose_stay() -> None:
    data = await _load({"kalman_q": 0.5, "ble_reseed_interval_s": 10})
    assert data["kalman_q"] == 0.5 and data["ble_reseed_interval_s"] == 10


# ── A replay keeps the recording's time ──────────────────────────────────────

def test_a_replay_runs_on_the_recorded_clock(monkeypatch) -> None:
    from custom_components.padspan_ha import capture_replay

    seen: list = []
    real = PresenceCoordinator._smooth_room

    def spy(self, *a, **k):
        seen.append(a[8] if len(a) > 8 else k.get("now"))
        return real(self, *a, **k)

    monkeypatch.setattr(PresenceCoordinator, "_smooth_room", spy)
    frames = [{"ts": 100.0 + 5 * i, "o": [{"k": "x", "a": "X", "v": {"sa": -60}, "w": {}}]}
              for i in range(3)]
    capture_replay.replay({"set": {}, "s2a": S2A}, frames)
    assert seen == [105.0, 110.0]
