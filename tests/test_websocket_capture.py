# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The capture handlers, against hass.data shaped the way __init__ shapes it.

These exist because the first version of `capture_start` reached for
`DATA_COORDINATOR` and got the PadSpanCoordinator — a different object from the
PresenceCoordinator that owns every piece of state a capture records. It raised
AttributeError on the first real click, and nothing in 649 tests noticed,
because nothing called the handler.

The store's own tests can't catch that: they hand `record_frame` its inputs
directly. Only a test that goes in through the websocket, from a hass.data
assembled the way the integration assembles it, ever touches the wiring.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.capture_store import CaptureStore
from custom_components.padspan_ha.const import DATA_CAPTURE, DATA_MODEL, DATA_SETTINGS, DOMAIN

from tests.conftest import MockHass, MockStore

# The two objects that are easy to confuse, and the reason this file exists.
PRESENCE_KEY = "presence_coordinator"


class FakePresenceCoordinator:
    """A PresenceCoordinator's shape, as capture_start actually uses it."""

    def __init__(self) -> None:
        from datetime import timedelta

        self.update_interval = timedelta(seconds=5)
        self._scanner_positions = {"S1": (1.0, 2.0, "main"), "S2": (4.0, 2.0, "main")}
        self._room_centroids = {"Office": (2.0, 2.0)}
        self._floor_bounds = {"main": [0, 0, 10, 10]}
        self._scanner_abs_z = {"S1": 2.4}
        self._floor_bases = {"main": 0.0}
        self._floor_stack_idx = {"main": 0}
        self._rf_barriers: list = []
        self._use_metres = True
        self._pl_fits: dict = {}
        self._ema_rssi: dict = {}
        self._kalman_p: dict = {}
        self._silence_miss: dict = {}
        self._room_votes: dict = {}
        self._confirmed_room: dict = {}
        self._espresense_dist: dict = {}
        # DataUpdateCoordinator sets .data after its first successful poll;
        # None means nothing has run yet.
        self.data: dict | None = {"objects": {}}


class FakeOtherCoordinator:
    """The PadSpanCoordinator: no update_interval, no positioning state.

    Present so a handler that grabs the wrong one fails the way it failed live.
    """

    scan_interval = 10


def _hass(tmp_path, *, enabled: bool = True) -> MagicMock:
    settings = SimpleNamespace(data={
        "rssi_capture_enabled": enabled,
        "rssi_capture_retention_days": 14,
        "room_change_delay_s": 20.0,
        "kalman_q": 0.125, "kalman_r": 8.0, "data_mode": "live",
    })
    model = MagicMock()
    model.get_scanner_mappings.return_value = ({"S1": "Office", "S2": "Office"},
                                               {"S1": "main", "S2": "main"})
    model.room_geometry_m.return_value = {"Office": {}}

    cap = CaptureStore(MockHass(tmp_path))
    cap.store = MockStore()

    hass = MagicMock()
    hass.data = {DOMAIN: {
        DATA_SETTINGS: settings,
        DATA_MODEL: model,
        DATA_CAPTURE: cap,
        PRESENCE_KEY: FakePresenceCoordinator(),
        # The decoy, under the key the broken version reached for.
        "coordinator": FakeOtherCoordinator(),
    }}
    hass.async_add_executor_job = AsyncMock(side_effect=lambda f, *a: f(*a))
    return hass


def _conn() -> MagicMock:
    c = MagicMock()
    c.send_result = MagicMock()
    c.send_error = MagicMock()
    return c


def _result(conn: MagicMock) -> dict:
    assert conn.send_result.called, (
        f"handler sent no result; errors={conn.send_error.call_args_list}")
    return conn.send_result.call_args[0][1]


async def test_starting_a_session_reads_the_presence_coordinator(tmp_path) -> None:
    """The regression. It has to reach the object that holds the state.

    Asserting on `sources` rather than merely on "no exception" is what makes
    this a wiring test: the count can only be right if the handler read the
    coordinator that actually has scanners on it.
    """
    hass, conn = _hass(tmp_path), _conn()
    cap = hass.data[DOMAIN][DATA_CAPTURE]
    await cap.async_load()

    await ws.ws_capture_start(hass, conn, {"id": 1, "minutes": 5, "label": "walk"})

    res = _result(conn)
    assert res["ok"] is True
    assert res["sources"] == 2, "the handler did not see the coordinator's scanners"
    assert cap.recording is True

    # And the header carries the geometry, which is the other half of the
    # wiring. Read from disk, not from _pending: capture_start flushes so the
    # header lands before the first frame, which is the behaviour worth having.
    hdr = cap._path(res["session_id"]).read_text(encoding="utf-8").splitlines()[0]
    assert '"S1"' in hdr and '"Office"' in hdr
    # vote window: 20 s of room-change delay at a 5 s poll = 4 polls.
    assert '"vw":4' in hdr, hdr[:200]


async def test_it_refuses_before_the_first_poll(tmp_path) -> None:
    """A session is only as real as the poll that feeds it.

    Started in the window after an HA restart, capture wrote a header, wrote
    an end line, and recorded zero frames — while reporting 22 healthy
    scanners, because that count comes from the fabric and not from anything
    having actually run. A recording that silently contains nothing is the
    worst failure this feature can have, so the precondition is checked.
    """
    hass, conn = _hass(tmp_path), _conn()
    await hass.data[DOMAIN][DATA_CAPTURE].async_load()
    hass.data[DOMAIN][PRESENCE_KEY].data = None      # has not polled yet

    await ws.ws_capture_start(hass, conn, {"id": 1, "minutes": 5})

    assert not conn.send_result.called
    assert conn.send_error.call_args[0][1] == "not_polling"
    assert hass.data[DOMAIN][DATA_CAPTURE].recording is False


async def test_it_refuses_while_the_feature_is_off(tmp_path) -> None:
    """The opt-in promise, enforced at the only door in."""
    hass, conn = _hass(tmp_path, enabled=False), _conn()
    await hass.data[DOMAIN][DATA_CAPTURE].async_load()

    await ws.ws_capture_start(hass, conn, {"id": 1, "minutes": 5})

    assert not conn.send_result.called
    assert conn.send_error.call_args[0][1] == "not_enabled"
    assert hass.data[DOMAIN][DATA_CAPTURE].recording is False


async def test_a_second_start_does_not_orphan_the_first_session(tmp_path) -> None:
    """Two sessions writing one file would interleave two headers.

    Refusing is the only safe answer — the alternative silently corrupts the
    recording that was already running.
    """
    hass, conn = _hass(tmp_path), _conn()
    await hass.data[DOMAIN][DATA_CAPTURE].async_load()
    await ws.ws_capture_start(hass, conn, {"id": 1, "minutes": 5})
    first = _result(conn)["session_id"]

    conn2 = _conn()
    await ws.ws_capture_start(hass, conn2, {"id": 2, "minutes": 5})
    assert conn2.send_error.call_args[0][1] == "already_recording"
    assert hass.data[DOMAIN][DATA_CAPTURE]._session["id"] == first


async def test_stopping_when_idle_answers_instead_of_erroring(tmp_path) -> None:
    """"Not recording" is a fact about the world, not a failure of the call."""
    hass, conn = _hass(tmp_path), _conn()
    await hass.data[DOMAIN][DATA_CAPTURE].async_load()

    await ws.ws_capture_stop(hass, conn, {"id": 1})

    assert not conn.send_error.called
    assert _result(conn) == {"ok": False, "error": "Not recording"}


async def test_status_is_answerable_before_anything_has_been_recorded(tmp_path) -> None:
    """The panel polls this on every Health render, including the first."""
    hass, conn = _hass(tmp_path, enabled=False), _conn()
    await hass.data[DOMAIN][DATA_CAPTURE].async_load()

    await ws.ws_capture_status(hass, conn, {"id": 1})

    res = _result(conn)
    assert res["recording"] is False
    assert res["enabled"] is False


async def test_export_pages_the_file_and_reports_the_end(tmp_path) -> None:
    """The export transport. `eof` is the loop's only exit, so it has to be true."""
    hass, conn = _hass(tmp_path), _conn()
    cap = hass.data[DOMAIN][DATA_CAPTURE]
    await cap.async_load()
    await ws.ws_capture_start(hass, conn, {"id": 1, "minutes": 5})
    sid = _result(conn)["session_id"]
    await ws.ws_capture_stop(hass, _conn(), {"id": 2})

    conn3 = _conn()
    await ws.ws_capture_get(hass, conn3, {"id": 3, "session_id": sid, "offset": 0, "limit": 2000})
    page = _result(conn3)
    assert page["eof"] is True
    assert page["lines"], "an exported session came back empty"

    conn4 = _conn()
    await ws.ws_capture_get(hass, conn4, {"id": 4, "session_id": "nope", "offset": 0, "limit": 10})
    assert conn4.send_error.call_args[0][1] == "not_found"


async def test_every_capture_command_is_registered(tmp_path) -> None:
    """websocket.py has no auto-discovery — a handler nobody registered is dead.

    The failure mode is a button that does nothing and a log line nobody reads,
    which is precisely how this feature's first bug reached a live click.
    """
    import inspect

    handlers = {n for n, _ in inspect.getmembers(ws, inspect.isfunction)
                if n.startswith("ws_capture_")}
    src = inspect.getsource(ws.async_register_websockets)
    missing = sorted(h for h in handlers if h not in src)
    assert not missing, f"defined but never registered: {missing}"
