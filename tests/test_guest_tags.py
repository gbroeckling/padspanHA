# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Guest tags (0.38.178): a tag lent to a guest, and the stay it is lent for.
Off until chosen in Settings; with it off nothing runs and nothing is written."""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import guest_tags as G
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

T0 = 2_000_000_000.0
AT = datetime(2026, 11, 3, 15, 0)


def _session(**opts):
    s = {"id": "gs_1", "pid": "ps_1", "name": "Anna", "start": T0, "end_planned": None, "ended": None,
         "opts": G.clean_opts(opts), "summary": G._empty_summary(), "live": {}}
    return s


def test_a_stay_counts_rooms_arrivals_and_leaving():
    s = _session()
    assert G.step(s, True, "Kitchen", T0, AT) == []                       # first poll: a baseline, no "arrived"
    assert G.step(s, True, "Kitchen", T0 + 30, AT) == []
    assert G.step(s, True, "Den", T0 + 60, AT) == []
    assert s["summary"]["rooms"] == {"Kitchen": 60.0}
    assert G.step(s, False, None, T0 + 90, AT) == [("left", {"room": "Den"})]
    assert s["summary"]["rooms"]["Den"] == 30.0 and s["summary"]["last_out"] == T0 + 90
    assert G.step(s, True, "Hall", T0 + 4000, AT) == [("arrived", {"room": "Hall"})]
    assert s["summary"]["arrivals"] == 1 and s["summary"]["departures"] == 1
    # A long gap between polls is not counted as time in a room.
    G.step(s, True, "Hall", T0 + 9000, AT)
    assert s["summary"]["rooms"]["Hall"] == G.TICK_MAX_S


def test_an_off_limits_room_alerts_once_per_visit_after_the_dwell():
    s = _session(off_limits=["Office"])
    G.step(s, True, "Hall", T0, AT)
    assert G.step(s, True, "Office", T0 + 5, AT) == []                    # passing through
    assert G.step(s, True, "Office", T0 + 5 + G.OFFLIMITS_DWELL_S, AT) == [("off_limits", {"room": "Office"})]
    assert G.step(s, True, "Office", T0 + 100, AT) == []                  # once per visit
    G.step(s, True, "Hall", T0 + 120, AT)
    G.step(s, True, "Office", T0 + 130, AT)
    assert G.step(s, True, "Office", T0 + 130 + G.OFFLIMITS_DWELL_S, AT) == [("off_limits", {"room": "Office"})]
    assert len(s["summary"]["off_limits"]) == 2


def test_a_forgotten_stay_reminds_after_two_days_and_ends_after_a_week():
    s = _session()
    G.step(s, True, "Hall", T0, AT)
    G.step(s, False, None, T0 + 60, AT)
    assert G.step(s, False, None, T0 + G.STALE_REMIND_S + 60, AT) == [("remind", {})]
    assert G.step(s, False, None, T0 + G.STALE_REMIND_S + 120, AT) == []  # once
    assert G.step(s, False, None, T0 + G.STALE_END_S + 60, AT) == [("end_stale", {})]


def test_a_planned_end_ends_the_stay():
    s = _session()
    s["end_planned"] = T0 + 3600
    G.step(s, True, "Hall", T0, AT)
    assert ("end_scheduled", {}) in G.step(s, True, "Hall", T0 + 3601, AT)


def test_quiet_hours_cross_midnight():
    assert G.quiet_now("22:00-07:00", datetime(2026, 1, 1, 23, 30))
    assert G.quiet_now("22:00-07:00", datetime(2026, 1, 1, 6, 59))
    assert not G.quiet_now("22:00-07:00", datetime(2026, 1, 1, 12, 0))
    assert G.quiet_now("09:00-17:00", datetime(2026, 1, 1, 12, 0))
    assert not G.quiet_now("", datetime(2026, 1, 1, 12, 0))
    for bad in ("9-5", "25:00-07:00", "22:00"):
        assert not G.valid_quiet(bad)
    assert G.valid_quiet("") and G.valid_quiet("22:00-07:00")


def _hass(on=True, **settings):
    st = SimpleNamespace(data={"guest_tags_enabled": on, "guest_retention_days": 30, **settings})
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: st}}
    h.bus = SimpleNamespace(async_fire=MagicMock())
    return h


def _store(h):
    gs = G.GuestStore.__new__(G.GuestStore)
    gs.hass = h
    gs._store = MagicMock()
    gs._store.async_save = AsyncMock()
    gs.data = {"tags": {}, "sessions": {}}
    gs.loaded = True
    h.data[DOMAIN][G.DATA_GUESTS] = gs
    return gs


def test_the_store_lends_one_tag_at_a_time_and_keeps_the_name_with_the_stay():
    h = _hass()
    gs = _store(h)
    with pytest.raises(ValueError):
        gs.start("ps_1", "Anna", T0, None, {})                         # not a guest tag yet
    gs.mark("ps_1", "Guest tag 1", ["ble:aa", "AA:BB"], "ibeacon", T0)
    s = gs.start("ps_1", "Anna", T0, T0 - 5, {"off_limits": ["Office", ""], "quiet": "bad"})
    assert s["end_planned"] is None and s["opts"]["off_limits"] == ["Office"] and s["opts"]["quiet"] == ""
    assert gs.tags()["ps_1"]["label"] == "Guest tag 1", "the tag keeps its own name"
    with pytest.raises(ValueError):
        gs.start("ps_1", "Ben", T0, None, {})
    with pytest.raises(ValueError):
        gs.unmark("ps_1")
    gs.end(s["id"], T0 + 100)
    assert gs.active() == [] and gs.sessions()[s["id"]]["end_how"] == "manual"
    assert gs.prune(T0 + 100 + 29 * 86400, 30) == 0
    assert gs.prune(T0 + 100 + 31 * 86400, 30) == 1 and gs.sessions() == {}


def test_matching_the_tag_by_id_key_or_label():
    tag = {"pid": "ps_1", "label": "Guest tag 1", "keys": ["ble:aa"]}
    result = {"ble:aa": {"room": "Den", "age_s": 3}, "x": {"padspan_id": "ps_1", "room": "Hall", "age_s": 1},
              "y": {"user_label": "guest TAG 1", "room": "Attic", "age_s": 9}, "z": {"user_label": "Other"}}
    present, room, keys = G.tag_state(tag, result, {"ble:aa", "x", "y"})
    assert present and room == "Hall" and set(keys) == {"ble:aa", "x", "y"}
    assert G.tag_state(tag, result, set())[0] is False


def test_nothing_runs_while_guest_tags_are_off():
    h = _hass(on=False)
    asyncio.new_event_loop().run_until_complete(G.async_poll(h, {}, set(), T0))
    assert G.DATA_GUESTS not in h.data[DOMAIN], "no store, no file"
    assert not G.counts_home_present(h) and not G.key_in_active_session(h, "ble:aa")
    assert G.report_buckets(h, T0) is None


def test_the_poll_sends_notices_mutes_quiet_hours_and_ends_on_time(monkeypatch):
    h = _hass()
    gs = _store(h)
    gs.mark("ps_1", "Guest tag 1", ["ble:aa"], "ibeacon", T0)
    s = gs.start("ps_1", "Anna", T0, T0 + 600, {"notify_arrive": True, "notify_leave": True, "quiet": ""})
    sent = []
    monkeypatch.setattr(G, "_async_notify", AsyncMock(side_effect=lambda _h, _s, t, m: sent.append(t) or True))
    monkeypatch.setattr(G, "refresh", lambda _h: None)
    import sys
    import types
    util = types.ModuleType("homeassistant.util")
    util.dt = SimpleNamespace(as_local=lambda d: AT, utc_from_timestamp=lambda ts: AT)
    monkeypatch.setitem(sys.modules, "homeassistant.util", util)
    loop = asyncio.new_event_loop()
    here = {"ble:aa": {"room": "Kitchen", "age_s": 1}}
    loop.run_until_complete(G.async_poll(h, here, {"ble:aa"}, T0 + 10))
    loop.run_until_complete(G.async_poll(h, here, set(), T0 + 20))         # left
    loop.run_until_complete(G.async_poll(h, here, {"ble:aa"}, T0 + 30))    # back
    assert sent == ["PadSpan: Anna left", "PadSpan: Anna arrived"]
    assert G.counts_home_present(h) is False and G.anyone_guest_home(h) is True
    assert G.key_in_active_session(h, "ble:aa")
    loop.run_until_complete(G.async_poll(h, here, {"ble:aa"}, T0 + 700))   # planned end
    assert gs.sessions()[s["id"]]["end_how"] == "scheduled" and sent[-1] == "PadSpan: Anna's stay ended"
    events = [c.args[1]["type"] for c in h.bus.async_fire.call_args_list]
    assert events == ["left", "arrived", "ended"]


def test_the_report_has_words_only_and_never_a_name():
    h = _hass()
    gs = _store(h)
    gs.mark("ps_1", "Guest tag 1", ["ble:aa"], "findmy", T0)
    s = gs.start("ps_1", "Anna Smith", T0, None, {"off_limits": ["Office", "Den", "Attic"], "counts_home": True})
    gs.end(s["id"], T0 + 2 * 86400)
    out = G.report_buckets(h, T0 + 2 * 86400 + 5)
    assert out == {"tags": "1", "active": "0", "sessions_30d": "1", "retention": "30", "tag_kind": "findmy",
                   "length": "1-3d", "end_how": "manual", "off_limits_rooms": "3+", "counts_home": "yes", "quiet": "no"}
    assert all(k in G.REPORT_WORDS and v in G.REPORT_WORDS[k] for k, v in out.items())
    assert "Anna" not in str(out)


def test_the_commands_refuse_while_off_and_changes_are_admin_only():
    from custom_components.padspan_ha import ws_guests as W
    src = __import__("inspect").getsource(W)
    for name in ("ws_guest_tag_mark", "ws_guest_tag_unmark", "ws_guest_session_start", "ws_guest_session_update",
                 "ws_guest_session_end", "ws_guest_session_forget"):
        head = src.split(f"async def {name}(", 1)[0].rsplit("@websocket_api.websocket_command", 1)[1]
        assert "@websocket_api.require_admin" in head, name
    h = _hass(on=False)
    conn = MagicMock()
    fn = W.ws_guest_session_start
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    asyncio.new_event_loop().run_until_complete(fn(h, conn, {"id": 1, "pid": "ps_1", "name": "A"}))
    conn.send_error.assert_called_once()
    assert conn.send_error.call_args.args[1] == W.OFF_CODE
