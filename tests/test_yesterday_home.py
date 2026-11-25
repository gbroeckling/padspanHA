# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Yesterday at home: the morning message about the day before.

Off by default; sent once a day at the chosen time, never twice for a day (not
after a restart either); only the lines chosen; "Nothing to report" rather than
an empty message; its figures are the frames Traceback replays for that day;
and its link opens Traceback on that day. The house is a demo one (Alex, Sam,
a guest called Jordan), in America/Vancouver.
"""

from __future__ import annotations

import sys
import time
import types
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import pytest

from custom_components.padspan_ha import presence_coordinator as PC
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import traceback_store as TS
from custom_components.padspan_ha import vacation_mode as VM
from custom_components.padspan_ha import ws_occupancy as WO
from custom_components.padspan_ha.const import DATA_SETTINGS, DATA_TRACEBACK, DOMAIN
from custom_components.padspan_ha.guest_tags import DATA_GUESTS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.conftest import MockHass, MockStore

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
TZ = ZoneInfo("America/Vancouver")
NOW = datetime(2026, 11, 24, 9, 0, tzinfo=TZ).timestamp()        # the morning after
DAY_START = datetime(2026, 11, 23, 0, 0, tzinfo=TZ).timestamp()
DAY_END = datetime(2026, 11, 24, 0, 0, tzinfo=TZ).timestamp()
RECEIVER_ROOMS = ["Bedroom", "Garage", "Kitchen", "Living room", "Office"]


def at(h: int, m: int = 0, day: int = 23) -> float:
    return datetime(2026, 11, day, h, m, tzinfo=TZ).timestamp()


def _alex_room(ts: float) -> str | None:
    """Alex's phone: Bedroom, Kitchen at breakfast, out 08:10-17:40, then the Living room."""
    if at(7, 30) <= ts < at(8, 10):
        return "Kitchen"
    if at(8, 10) <= ts < at(17, 40):
        return None
    if at(17, 40) <= ts < at(23, 0):
        return "Living room"
    return "Bedroom"


def _sam_room(ts: float) -> str:
    return "Office" if at(9, 0) <= ts < at(17, 0) else "Bedroom"


def _jordan_room(ts: float) -> str | None:
    """The guest tag: in a drawer (Bedroom) until Jordan takes it at 10:00, back 14:00."""
    return None if at(10, 0) <= ts < at(14, 0) else "Bedroom"


def _frames(guest: bool = False) -> list[dict[str, Any]]:
    """A frame a minute from the evening before to the morning after, as
    TracebackStore records them (only who is in; one frame per poll)."""
    out = []
    ts = at(20, 0, day=22)
    while ts < NOW:
        o = []
        r = _alex_room(ts)
        if r:
            o.append({"k": "irk:alex", "r": r, "pid": "p_alex", "n": "Alex's phone"})
        o.append({"k": "ble:AA:00:00:00:00:02", "r": _sam_room(ts), "pid": "p_sam", "n": "Sam's watch"})
        if guest:
            g = _jordan_room(ts)
            if g:
                o.append({"k": "ibeacon:guest1", "r": g, "pid": "p_guest1", "n": "Guest tag 1"})
        out.append({"ts": ts, "o": o})
        ts += 60
    return out


class _Settings:
    def __init__(self, **data: Any) -> None:
        self.data = {**DEFAULT_SETTINGS, **data}

    async def async_set(self, **kw: Any) -> dict[str, Any]:
        self.data = {**self.data, **kw}
        return self.data


@pytest.fixture
def clock(monkeypatch):
    monkeypatch.setattr(time, "time", lambda: NOW)
    return NOW


@pytest.fixture
def sent(monkeypatch):
    """What was sent: (target, title, message); "" for a Home Assistant notification."""
    out: list = []

    async def _send(hass, preferred, email, title, message, context=None):
        out.append((preferred, title, message))
        return preferred
    monkeypatch.setattr(PC, "async_send_follow_notify", _send)
    pn = types.ModuleType("homeassistant.components.persistent_notification")
    pn.async_create = lambda hass, message, title=None, notification_id=None: out.append(("", title, message))
    monkeypatch.setitem(sys.modules, "homeassistant.components.persistent_notification", pn)
    net = types.ModuleType("homeassistant.helpers.network")
    net.get_url = lambda hass, **kw: "https://ha.example.org"
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.network", net)
    return out


@pytest.fixture
def bumps(monkeypatch):
    got: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, event, n=1: got.append(event) or True)
    return got


async def _house(tmp_path, frames=None, **settings: Any):
    hass = MockHass(tmp_path)
    hass.config.time_zone = "America/Vancouver"
    hass.states = SimpleNamespace(get=lambda eid: SimpleNamespace(attributes={"friendly_name": "Ceiling light"}),
                                  async_all=lambda *a: [])
    tb = TS.TracebackStore(hass)
    tb._store = MockStore()
    if frames:
        tb._write_files_sync(frames)
    st = _Settings(**settings)
    hass.data = {DOMAIN: {DATA_SETTINGS: st, DATA_TRACEBACK: tb}}
    return hass, tb, st


# ── off by default ──────────────────────────────────────────────────────────

def test_off_by_default_and_existing_installs_see_no_change() -> None:
    assert DEFAULT_SETTINGS["yesterday_home_enabled"] is False
    hass = SimpleNamespace(config=SimpleNamespace(time_zone="America/Vancouver"))
    # Long past the time, never told: still nothing while it is off.
    assert PC.yesterday_due(hass, dict(DEFAULT_SETTINGS), at(23, 0, day=24)) is None
    assert PC.yesterday_due(hass, {}, at(23, 0, day=24)) is None
    # The usage report says "on" only when it is on.
    assert T._FEATURE_ON_ONLY["yesterday_home_enabled"] == "yesterday_home"


def test_the_poll_starts_nothing_while_it_is_off() -> None:
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: _Settings()}}
    me = SimpleNamespace(hass=hass, _last_source_to_area={"rx1": "Kitchen"})
    PC.PresenceCoordinator._maybe_yesterday_home(me)
    hass.async_create_task.assert_not_called()


# ── the chosen time ─────────────────────────────────────────────────────────

def test_it_is_due_at_the_chosen_time_in_home_assistants_time_zone() -> None:
    hass = SimpleNamespace(config=SimpleNamespace(time_zone="America/Vancouver"))
    on = {"yesterday_home_enabled": True, "yesterday_home_time": "07:30"}
    assert PC.yesterday_due(hass, on, at(7, 29, day=24)) is None
    assert PC.yesterday_due(hass, on, at(7, 30, day=24)) == "2026-11-23"
    assert PC.yesterday_due(hass, {**on, "yesterday_home_time": "21:15"}, at(21, 14, day=24)) is None
    assert PC.yesterday_due(hass, {**on, "yesterday_home_time": "21:15"}, at(21, 15, day=24)) == "2026-11-23"
    # The day is Home Assistant's: 07:30 in Vancouver is 15:30 UTC.
    day, start, end = PC.yesterday_window(hass, at(7, 30, day=24))
    assert (day, start, end) == ("2026-11-23", DAY_START, DAY_END)


def test_the_time_must_be_hh_mm() -> None:
    assert PC.yesterday_clock("08:00") == 480 and PC.yesterday_clock("23:59") == 1439
    for bad in ("8:00", "24:00", "08:60", "0800", "", None, "ab:cd"):
        assert PC.yesterday_clock(bad) is None, bad


def test_turned_on_after_todays_time_the_first_message_comes_tomorrow() -> None:
    hass = SimpleNamespace(config=SimpleNamespace(time_zone="America/Vancouver"))
    on = {"yesterday_home_enabled": True, "yesterday_home_time": "08:00"}
    assert PC.yesterday_stamp_on(hass, on, at(15, 0, day=24)) == "2026-11-23"
    assert PC.yesterday_stamp_on(hass, on, at(6, 0, day=24)) is None
    stamped = {**on, "yesterday_home_sent_day": "2026-11-23"}
    assert PC.yesterday_due(hass, stamped, at(15, 0, day=24)) is None
    assert PC.yesterday_due(hass, stamped, at(8, 0, day=25)) == "2026-11-24"


# ── one message a day ───────────────────────────────────────────────────────

async def test_one_message_a_day_and_none_again_after_a_restart(tmp_path, clock, sent, bumps) -> None:
    hass, _tb, st = await _house(tmp_path, _frames(), yesterday_home_enabled=True, yesterday_home_time="08:00")
    day = PC.yesterday_due(hass, st.data, NOW)
    assert day == "2026-11-23"
    assert await PC.async_send_yesterday_home(hass, day, RECEIVER_ROOMS, NOW) == "sent"
    assert len(sent) == 1
    assert st.data["yesterday_home_sent_day"] == "2026-11-23"
    # Every later poll that day, and a restart (the same settings, read again): nothing more.
    for later in (NOW + 5, NOW + 3600, at(23, 59, day=24)):
        assert PC.yesterday_due(hass, dict(st.data), later) is None
    # The next morning is the next day's message.
    assert PC.yesterday_due(hass, dict(st.data), at(8, 0, day=25)) == "2026-11-24"


async def test_the_day_is_marked_told_before_the_send_so_a_failure_never_repeats(tmp_path, clock, monkeypatch, bumps) -> None:
    hass, _tb, st = await _house(tmp_path, _frames(), yesterday_home_enabled=True,
                                 yesterday_home_target="notify.mobile_app_alex")

    async def _fail(*a, **k):
        assert st.data["yesterday_home_sent_day"] == "2026-11-23"
        raise PC.FollowNotifyNotSent("not_found", "gone")
    monkeypatch.setattr(PC, "async_send_follow_notify", _fail)
    net = types.ModuleType("homeassistant.helpers.network")
    net.get_url = lambda hass, **kw: "https://ha.example.org"
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.network", net)
    assert await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW) == "failed"
    assert PC.yesterday_due(hass, st.data, NOW + 60) is None
    assert bumps == ["yesterday_home:failed"]


def test_the_poll_starts_one_task_and_waits_for_it() -> None:
    hass = MagicMock()
    hass.config.time_zone = "America/Vancouver"
    hass.data = {DOMAIN: {DATA_SETTINGS: _Settings(yesterday_home_enabled=True, yesterday_home_time="00:00")}}
    task = MagicMock()
    task.done.return_value = False

    def _task(coro):
        coro.close()
        return task
    hass.async_create_task.side_effect = _task
    me = SimpleNamespace(hass=hass, _last_source_to_area={"rx1": "Kitchen", "rx2": "Office"})
    PC.PresenceCoordinator._maybe_yesterday_home(me)
    PC.PresenceCoordinator._maybe_yesterday_home(me)
    assert hass.async_create_task.call_count == 1


# ── the chosen notify target ────────────────────────────────────────────────

async def test_it_goes_to_the_chosen_target_or_a_home_assistant_notification(tmp_path, clock, sent, bumps) -> None:
    hass, _tb, _st = await _house(tmp_path, _frames(), yesterday_home_enabled=True,
                                  yesterday_home_target="notify.mobile_app_alex")
    await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW)
    hass2, _tb2, _st2 = await _house(tmp_path / "b", _frames(), yesterday_home_enabled=True)
    await PC.async_send_yesterday_home(hass2, "2026-11-23", RECEIVER_ROOMS, NOW)
    assert [s[0] for s in sent] == ["notify.mobile_app_alex", ""]


# ── the message, its lines and its figures ─────────────────────────────────

async def test_the_message_tells_the_day_from_traceback(tmp_path, clock, sent, bumps) -> None:
    hass, _tb, _st = await _house(tmp_path, _frames(), yesterday_home_enabled=True)
    assert await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW) == "sent"
    _target, title, message = sent[0]
    assert title == "PadSpan: yesterday at home (Mon 23 Nov)"
    lines = message.split("\n")
    # Alex's phone was last seen 08:09 and seen again 17:40; Sam's watch never left.
    assert lines[0] == "Came and went: Alex's phone left 08:09, back 17:40."
    # The Garage had no one all day; the Kitchen only at breakfast; the Living room from 17:40 to 23:00.
    assert lines[1] == "Empty longest: Garage all day; Living room until 17:40 (17 h 40 min); Kitchen from 08:09 (15 h 51 min)."
    assert lines[-1].startswith("Traceback for the day: https://ha.example.org/padspan-ha?view=traceback&")
    assert len(lines) == 3          # no guests (guest tags off) and no lights on
    assert sorted(bumps) == ["yesterday_home:line_comings", "yesterday_home:line_empty_rooms", "yesterday_home:sent"]
    assert all(T.event_allowed(b) for b in bumps)


async def test_only_the_chosen_lines(tmp_path, clock, sent, bumps) -> None:
    hass, _tb, _st = await _house(tmp_path, _frames(), yesterday_home_enabled=True,
                                  yesterday_home_lines=["empty_rooms"])
    await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW)
    message = sent[0][2]
    assert "Empty longest:" in message and "Came and went" not in message
    hass2, _tb2, _st2 = await _house(tmp_path / "b", _frames(), yesterday_home_enabled=True,
                                     yesterday_home_lines=["comings"])
    await PC.async_send_yesterday_home(hass2, "2026-11-23", RECEIVER_ROOMS, NOW)
    assert "Came and went:" in sent[1][2] and "Empty longest" not in sent[1][2]


async def test_nothing_to_report_is_said_briefly(tmp_path, clock, sent, bumps) -> None:
    # Sam home all day, nobody came or went: with only that line chosen, nothing to report.
    frames = [{"ts": f["ts"], "o": [o for o in f["o"] if o["k"] != "irk:alex"]} for f in _frames()]
    hass, _tb, _st = await _house(tmp_path, frames, yesterday_home_enabled=True, yesterday_home_lines=["comings", "lights"])
    assert await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW) == "nothing"
    assert len(sent) == 1
    _t, title, message = sent[0]
    assert title == "PadSpan: yesterday at home (Mon 23 Nov)"
    assert message.split("\n")[0] == "Nothing to report."
    assert len(message.split("\n")) == 2 and "Traceback for the day:" in message
    assert bumps == ["yesterday_home:nothing"]
    # No lines chosen at all: the same short message, never an empty one.
    hass2, _tb2, _st2 = await _house(tmp_path / "b", _frames(), yesterday_home_enabled=True, yesterday_home_lines=[])
    assert await PC.async_send_yesterday_home(hass2, "2026-11-23", RECEIVER_ROOMS, NOW) == "nothing"
    assert sent[1][2].startswith("Nothing to report.\nTraceback for the day: ")


async def test_a_day_traceback_did_not_record_says_nothing_of_empty_rooms(tmp_path, clock, sent, bumps) -> None:
    # A new install: Traceback starts at 18:00, so the rooms before it were not watched.
    frames = [f for f in _frames() if f["ts"] >= at(18, 0)]
    hass, _tb, _st = await _house(tmp_path, frames, yesterday_home_enabled=True, yesterday_home_lines=["empty_rooms", "lights"])
    assert await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW) == "nothing"


async def test_the_figures_agree_with_what_traceback_replays_for_that_day(tmp_path, clock) -> None:
    """The message's comings and goings and its rooms are the frames
    padspan_ha/traceback_get returns for the link's window."""
    hass, tb, _st = await _house(tmp_path, _frames())
    summary = await tb.async_day_summary(DAY_START, DAY_END)
    frames, matched = await tb.async_get_frames(DAY_START, DAY_END, max_frames=4000, with_count=True)
    assert matched == len(frames)      # a day is never thinned
    # Traceback's window takes the frame at midnight itself; the day is up to it.
    frames = [f for f in frames if f["ts"] < DAY_END]
    assert len(frames) == summary["frames"]
    # Alex in Traceback's replay: the last frame before the gap and the first after it.
    alex = [f["ts"] for f in frames if any(o["k"] == "irk:alex" for o in f["o"])]
    gaps = [(a, b) for a, b in zip(alex, alex[1:]) if b - a > TS.COMING_GAP_S]
    assert len(gaps) == 1
    people = {p["name"]: p["events"] for p in summary["people"]}
    assert people == {"Alex's phone": [("left", gaps[0][0]), ("back", gaps[0][1])]}
    # One object's replay (Traceback filtered on Alex) says the same.
    only, _n = await tb.async_get_frames(DAY_START, DAY_END, obj_key="irk:alex", max_frames=4000, with_count=True)
    assert [f["ts"] for f in only if f["ts"] < DAY_END] == alex
    # Every room someone was in, in the replay, is occupied in the summary at that time, and only then.
    for f in frames:
        for o in f["o"]:
            assert any(s <= f["ts"] <= e for s, e in summary["occupied"][o["r"]]), (o, f["ts"])
    kitchen = [f["ts"] for f in frames if any(o["r"] == "Kitchen" for o in f["o"])]
    assert summary["occupied"]["Kitchen"] == [(min(kitchen), max(kitchen))]
    assert "Garage" not in summary["occupied"]


async def test_guest_tags_that_arrived_or_left(tmp_path, clock, sent, bumps) -> None:
    hass, _tb, st = await _house(tmp_path, _frames(guest=True), yesterday_home_enabled=True, guest_tags_enabled=True)
    store = SimpleNamespace(
        loaded=True,
        sessions=lambda: {"gs_1": {"id": "gs_1", "pid": "p_guest1", "name": "Jordan", "start": at(9, 30), "ended": None}},
        tags=lambda: {"p_guest1": {"pid": "p_guest1", "label": "Guest tag 1", "keys": ["ibeacon:guest1"]}},
    )

    async def _load():
        return None
    store.async_load = _load
    hass.data[DOMAIN][DATA_GUESTS] = store
    assert await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW) == "sent"
    message = sent[0][2]
    assert "Guests: Jordan (Guest tag 1) left 09:59, arrived 14:00." in message
    # A lent tag is the guest's, never in the people line.
    assert "Guest tag 1 left" not in message.split("\n")[0]


async def test_lights_left_on_in_rooms_where_nobody_was(tmp_path, clock, sent, bumps, monkeypatch) -> None:
    hass, _tb, _st = await _house(tmp_path, _frames(), yesterday_home_enabled=True, yesterday_home_lines=["lights"])
    monkeypatch.setattr(VM, "_eligible_entity_ids", lambda hass: ["light.kitchen", "light.office", "fan.office"])
    monkeypatch.setattr(WO, "_entity_area_name", lambda hass, eid: {"light.kitchen": "Kitchen", "light.office": "Office"}[eid])

    async def _history(hass, eids, days, end=None):
        assert eids == ["light.kitchen", "light.office"] and end.timestamp() == DAY_END
        return {
            # The Kitchen light: on through breakfast and left on until 10:00 (Kitchen empty from 08:09).
            "light.kitchen": [(DAY_START - 3600, "off"), (at(7, 30), "on"), (at(10, 0), "off")],
            # The Office light: on only while Sam is in (09:00-17:00) and 10 minutes after.
            "light.office": [(DAY_START - 3600, "off"), (at(9, 0), "on"), (at(17, 10), "off")],
        }
    monkeypatch.setattr(VM, "_async_fetch_history", _history)
    assert await PC.async_send_yesterday_home(hass, "2026-11-23", RECEIVER_ROOMS, NOW) == "sent"
    assert sent[0][2].split("\n")[0] == "Lights on with nobody there: Ceiling light (Kitchen) 1 h 51 min."


def test_lights_left_on_counts_only_the_empty_stretches() -> None:
    empty = {"Den": [(0.0, 1000.0), (5000.0, 10000.0)]}
    hist = {"light.den": [(-50.0, "on"), (3000.0, "off"), (4000.0, "on")]}
    got = PC.lights_left_on(hist, {"light.den": ("Den", "Lamp")}, empty, 0.0, 10000.0)
    assert got == [("Den", "Lamp", 1000.0 + 5000.0)]
    assert PC.lights_left_on(hist, {"light.den": ("Den", "Lamp")}, {"Den": [(0.0, 600.0)]}, 0.0, 10000.0) == []


# ── the link to Traceback ───────────────────────────────────────────────────

def test_the_link_opens_traceback_on_that_day(monkeypatch) -> None:
    net = types.ModuleType("homeassistant.helpers.network")
    net.get_url = lambda hass, **kw: "https://ha.example.org/"
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.network", net)
    url = urlparse(PC.yesterday_link(object(), DAY_START, DAY_END))
    assert url.path == "/padspan-ha"
    q = parse_qs(url.query)
    assert q == {"view": ["traceback"], "from": [str(int(DAY_START))], "to": [str(int(DAY_END))]}
    # No URL set up in Home Assistant: the panel's own path still works from a notification in HA.
    net.get_url = MagicMock(side_effect=RuntimeError("no url"))
    assert PC.yesterday_link(object(), DAY_START, DAY_END).startswith("/padspan-ha?view=traceback&from=")


def test_the_panel_opens_that_window_in_traceback() -> None:
    panel = (WWW / "panel.js").read_text(encoding="utf-8")
    assert 'if (reqView === "traceback") this._tracebackWindow(q);' in panel
    assert 'if(q.get("view") === "traceback" && this._tracebackWindow(q)){' in panel
    assert "this.state._tracebackPreset = { start_ms: Math.round(a * 1000), end_ms: Math.round(b * 1000) };" in panel
    tb = (WWW / "views" / "traceback.js").read_text(encoding="utf-8")
    # A window with no object: every object over it (the guest report's preset keeps its one object).
    assert "if (Number.isFinite(s0) && Number.isFinite(s1)) {" in tb
    assert 'tb.filterKey = _preset.key ? String(_preset.key) : null;' in tb


# ── settings ────────────────────────────────────────────────────────────────

def test_the_settings_command_takes_the_keys_and_lists_them() -> None:
    src = (ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    for k in ("yesterday_home_enabled", "yesterday_home_time", "yesterday_home_target", "yesterday_home_lines"):
        assert f'vol.Optional("{k}")' in src, k
    assert "yesterday_home_sent_day" not in src.split('"type": "padspan_ha/settings_set"')[1].split("@websocket_api.async_response")[0]
    js = (WWW / "views" / "settings.js").read_text(encoding="utf-8")
    for k in ("yesterday_home_enabled", "yesterday_home_time", "yesterday_home_target", "yesterday_home_lines"):
        assert k in js, k
