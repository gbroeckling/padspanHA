# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Vacation Mode replays last week, with a monthly-average choice (Garry,
2026-10-31: "Is a read of the previous week, not a 'is it dark outside'? Also
add monthly average button too for the weekday choice."). The evening lights
follow the same history instead of sunset."""

from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha import vacation_mode as vm
from tests.test_vacation_mode import _hass, _settings, _states

# A Saturday afternoon: "last week" is Sat Oct 17 .. Fri Oct 23.
NOW = datetime(2026, 10, 24, 15, 0)
LAST_TUE = datetime(2026, 10, 20)
PREV_TUE = datetime(2026, 10, 13)


def _ts(d: datetime, h: int, m: int = 0) -> float:
    return d.replace(hour=h, minute=m).timestamp()


def _house() -> dict:
    """Off since a month ago. Last Tuesday on 18:10-22:40; the Tuesday before,
    07:00-08:00 only."""
    start = (NOW - timedelta(days=31)).timestamp()
    return {"light.a": [(start, "off"),
                        (_ts(PREV_TUE, 7), "on"), (_ts(PREV_TUE, 8), "off"),
                        (_ts(LAST_TUE, 18, 10), "on"), (_ts(LAST_TUE, 22, 40), "off")]}


# ═══ last week ═══════════════════════════════════════════════════════════════

def test_tuesday_plays_like_last_tuesday():
    pat = vm.build_routine(_house(), NOW, "last_week", 30, [])["light.a"]
    assert abs(pat["1:1800"] - 20 / 30) < 1e-9          # on from 18:10: two thirds of the window
    assert all(pat[f"1:{h:02d}{m:02d}"] == 1.0 for h in range(18, 22) for m in (0, 30) if (h, m) != (18, 0))
    assert abs(pat["1:2230"] - 10 / 30) < 1e-9
    assert pat["1:0700"] == 0.0 and pat["1:2300"] == 0.0   # the Tuesday before doesn't count
    # The coming Tuesday: on through the evening, off in the morning, at 100%.
    tue = datetime(2026, 10, 27)
    assert vm.decide_states({"light.a": pat}, tue.replace(hour=19), 100) == {"light.a": True}
    assert vm.decide_states({"light.a": pat}, tue.replace(hour=7), 100) == {"light.a": False}
    # Intensity still scales it, and a partial window is a fresh draw each night.
    assert vm.decide_states({"light.a": pat}, tue.replace(hour=19), 100, rand_fn=lambda: 0.6) == {"light.a": True}
    assert vm.decide_states({"light.a": pat}, tue.replace(hour=19), 50, rand_fn=lambda: 0.6) == {"light.a": False}
    draws = {vm._window_draw("light.a", tue + timedelta(days=7 * k, hours=18), "1:1800") for k in range(6)}
    assert len(draws) == 6


def test_month_mode_is_the_monthly_average_as_before():
    pat = vm.build_routine(_house(), NOW, "month", 30, [])["light.a"]
    # Four Tuesdays in the month, on at 07:00 once: the average, not last week's replay.
    assert pat["1:0700"] == 0.25 and pat["1:1830"] == 0.25


def test_a_tuesday_inside_a_past_vacation_falls_back_to_the_week_before():
    away = [[_ts(LAST_TUE, 9), _ts(LAST_TUE + timedelta(days=1), 9)]]
    pat = vm.build_routine(_house(), NOW, "last_week", 30, away)["light.a"]
    assert pat["1:0700"] == 1.0 and pat["1:0800"] == 0.0 and pat["1:1900"] == 0.0


def test_a_weekday_with_no_history_falls_back_to_the_monthly_average():
    # A light first seen on Wednesday: no Tuesday at all, so Tuesday uses the
    # any-day average (the month pattern underneath).
    wed = datetime(2026, 10, 21)
    hist = {"light.new": []}
    for d in range(3):
        day = wed + timedelta(days=d)
        hist["light.new"] += [(_ts(day, 19), "on"), (_ts(day, 21), "off")]
    hist["light.new"].insert(0, (_ts(wed, 8), "off"))
    pat = vm.build_routine(hist, NOW, "last_week", 30, [])["light.new"]
    assert not any(k.startswith("1:") for k in pat)
    assert pat["*:1900"] == 1.0
    assert vm.decide_states({"light.new": pat}, datetime(2026, 10, 27, 19, 30), 100) == {"light.new": True}
    # Wednesday plays like last Wednesday.
    assert pat["2:1900"] == 1.0 and pat["2:2100"] == 0.0


# ═══ the monthly average is exactly what it was ══════════════════════════════

# sha256 of the pattern the pre-2026-10-31 build_pattern (git HEAD before this
# change) made from _golden_fixture(): 1085 slots over three entities.
GOLDEN = "9d5a2b10e1058f7318ebff14f51fe0cc4432850d78f054d017923109a539a8e3"


def _golden_fixture():
    rng = random.Random(20261031)
    now = datetime(2026, 10, 24, 15, 0)
    hist = {}
    for eid in ("light.kitchen", "light.porch", "fan.attic"):
        t = now - timedelta(days=31)
        ch = [(t.timestamp(), "off")]
        while t < now:
            t += timedelta(minutes=rng.randint(20, 300))
            ch.append((t.timestamp(), rng.choice(["on", "off", "on", "unavailable"])))
        hist[eid] = ch
    periods = [[(now - timedelta(days=12)).timestamp(), (now - timedelta(days=9)).timestamp()]]
    return hist, now, periods


def test_month_mode_is_byte_for_byte_the_old_pattern():
    hist, now, periods = _golden_fixture()
    digest = lambda p: hashlib.sha256(json.dumps(p, sort_keys=True).encode()).hexdigest()  # noqa: E731
    assert digest(vm.build_pattern(hist, now, 30, periods)) == GOLDEN
    routine = vm.build_routine(hist, now, "month", 30, periods)
    slots = {eid: {k: v for k, v in b.items() if k != "evening"} for eid, b in routine.items()}
    assert digest({k: v for k, v in slots.items() if v}) == GOLDEN
    assert "evening" not in routine.get("fan.attic", {})          # evenings are for lights


# ═══ evening lights from history ═════════════════════════════════════════════

def test_an_evening_light_holds_over_last_weeks_evening_including_past_midnight():
    hist = _house()
    hist["light.a"] += [(_ts(datetime(2026, 10, 21), 21), "on"), (_ts(datetime(2026, 10, 22), 1, 30), "off")]
    hist["light.a"].sort()
    ev = vm.build_routine(hist, NOW, "last_week", 30, [])["light.a"]["evening"]
    assert ev["1"] == [18 * 60 + 10, 22 * 60 + 40]
    assert ev["2"] == [21 * 60, 25 * 60 + 30]
    assert ev["3"] is None                                       # off last Thursday: not held
    entry = {"evening": ev}
    assert vm.anchor_open(entry, "light.a", datetime(2026, 10, 27, 20, 0), "")
    assert not vm.anchor_open(entry, "light.a", datetime(2026, 10, 27, 17, 0), "")
    assert vm.anchor_open(entry, "light.a", datetime(2026, 10, 29, 0, 45), "")   # Wednesday's, after midnight
    assert not vm.anchor_open(entry, "light.a", datetime(2026, 10, 29, 20, 0), "")


def test_month_mode_holds_an_evening_light_over_its_typical_evening():
    # Every evening 19:00-22:00, except Mondays at four different times and
    # Tuesdays when it was on only one week in four.
    start = NOW - timedelta(days=31)
    ch = [(start.timestamp(), "off")]
    mondays = iter([(18, 0, 22, 0), (18, 30, 22, 30), (19, 0, 23, 0), (20, 0, 23, 0)])
    tuesdays_on = 0
    d = start.replace(hour=0)
    while d < NOW - timedelta(days=1):
        if d.weekday() == 0:
            h1, m1, h2, m2 = next(mondays, (19, 0, 22, 0))
        elif d.weekday() == 1:
            tuesdays_on += 1
            if tuesdays_on != 2:
                d += timedelta(days=1)
                continue
            h1, m1, h2, m2 = 19, 0, 22, 0
        else:
            h1, m1, h2, m2 = 19, 0, 22, 0
        ch += [(_ts(d, h1, m1), "on"), (_ts(d, h2, m2), "off")]
        d += timedelta(days=1)
    ev = vm.build_routine({"light.porch": ch}, NOW, "month", 30, [])["light.porch"]["evening"]
    assert ev["0"] == [18 * 60 + 45, 22 * 60 + 45]                # medians of the four Mondays
    assert ev["3"] == [19 * 60, 22 * 60]
    assert ev["1"] is None                                       # on one Tuesday in four: not held
    # Last week instead: last Monday's own evening.
    ev = vm.build_routine({"light.porch": ch}, NOW, "last_week", 30, [])["light.porch"]["evening"]
    assert ev["0"] == [20 * 60, 23 * 60]


# ═══ the source is fixed for a trip ══════════════════════════════════════════

def _admin_house():
    from tests.test_house3d_store import _house as house
    h = house()
    st = h.data[DOMAIN][DATA_SETTINGS]

    async def _set(**kw):
        st.data.update(kw)
    st.async_set = _set
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    return h, st, conn


def test_the_source_setting_is_validated_admin_only_and_last_week_by_default():
    from custom_components.padspan_ha import ws_settings as WS
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    from tests.test_house3d_store import _run
    assert DEFAULT_SETTINGS["vacation_mode_source"] == "last_week"
    h, st, conn = _admin_house()
    _run(WS.ws_settings_set(h, conn, {"id": 1, "vacation_mode_source": "month"}))
    assert st.data["vacation_mode_source"] == "month"
    _run(WS.ws_settings_set(h, conn, {"id": 2, "vacation_mode_source": "sunset"}))
    conn.send_error.assert_called_once()
    assert st.data["vacation_mode_source"] == "month"
    other = MagicMock()
    other.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, other, {"id": 3, "vacation_mode_source": "last_week"}))
    other.send_error.assert_called_once()
    assert st.data["vacation_mode_source"] == "month"


async def test_a_source_change_mid_trip_waits_for_the_next_turn_on(monkeypatch):
    from custom_components.padspan_ha import ws_settings as WS
    h, st, conn = _admin_house()
    await (WS.ws_settings_set(h, conn, {"id": 1, "vacation_mode_enabled": True}))
    assert st.data["vacation_mode_trip_source"] == "last_week"
    pat = {"light.a": {"1:1900": 1.0}}
    st.data.update(vacation_mode_pattern=pat, vacation_mode_pattern_until=st.data["vacation_mode_enabled_at"],
                   vacation_mode_pattern_source="last_week")
    await (WS.ws_settings_set(h, conn, {"id": 2, "vacation_mode_source": "month"}))
    assert st.data["vacation_mode_pattern"] == pat and st.data["vacation_mode_trip_source"] == "last_week"
    assert not st.data.get("vacation_mode_pattern_end")
    fetch = AsyncMock(return_value={"light.a": [(0.0, "on")]})
    monkeypatch.setattr(vm, "_async_fetch_history", fetch)
    s2 = _settings(**st.data)
    await vm._async_refresh_pattern_if_stale(_hass(s2), s2)
    fetch.assert_not_called()
    assert s2.data["vacation_mode_pattern"] == pat
    # The status entity says what this trip runs on; the report, the choice.
    assert vm.running_source(st.data) == "last_week" and vm.report_buckets(st.data, [], 0)["source"] == "month"
    # Off, and a new trip a month later: the new choice.
    await (WS.ws_settings_set(h, conn, {"id": 3, "vacation_mode_enabled": False}))
    st.data["vacation_mode_periods"] = [[p[0] - 40 * 86400, p[1] - 40 * 86400] for p in st.data["vacation_mode_periods"]]
    await (WS.ws_settings_set(h, conn, {"id": 4, "vacation_mode_enabled": True}))
    assert st.data["vacation_mode_trip_source"] == "month" and st.data["vacation_mode_pattern"] == {}


async def test_the_build_uses_the_trips_source_and_records_it(monkeypatch):
    enabled_at = NOW.timestamp()

    async def fetch(hass, eids, days, end=None):
        return _house()
    monkeypatch.setattr(vm, "_async_fetch_history", fetch)
    for source, expect in (("last_week", 0.0), ("month", 0.25)):
        st = _settings(vacation_mode_enabled=True, vacation_mode_enabled_at=enabled_at,
                       vacation_mode_trip_source=source, vacation_mode_source="month")
        await vm._async_refresh_pattern_if_stale(_hass(st, _states(**{"light.a": "off"})), st)
        assert st.data["vacation_mode_pattern_source"] == source
        assert st.data["vacation_mode_pattern"]["light.a"]["1:0700"] == expect
    # A trip turned on before the choice existed builds the monthly average.
    st = _settings(vacation_mode_enabled=True, vacation_mode_enabled_at=enabled_at)
    await vm._async_refresh_pattern_if_stale(_hass(st, _states(**{"light.a": "off"})), st)
    assert st.data["vacation_mode_pattern_source"] == "month"


async def test_a_resumed_trip_with_a_new_source_relearns_its_own_days(monkeypatch):
    from tests.test_vacation_mode import _trip
    start = NOW.timestamp()
    off = start + 5 * 86400
    data = _trip(start, off, {"light.a": {"*:1200": 1.0}}, vacation_mode_source="month")
    now = off + 2 * 86400
    data.update(vm.switch_fields(data, True, now), vacation_mode_enabled=True)
    assert data["vacation_mode_pattern_end"] == start and data["vacation_mode_trip_source"] == "month"
    seen = {}

    async def fetch(hass, eids, days, end=None):
        seen["end"] = end.timestamp()
        return _house()
    monkeypatch.setattr(vm, "_async_fetch_history", fetch)
    st = _settings(**data)
    await vm._async_refresh_pattern_if_stale(_hass(st, _states(**{"light.a": "off"})), st)
    assert seen["end"] == start                       # the days before the trip, not the empty house since
    assert st.data["vacation_mode_pattern"]["light.a"]["1:0700"] == 0.25
    assert st.data["vacation_mode_pattern_source"] == "month" and st.data["vacation_mode_pattern_end"] == 0
    assert vm.pattern_serves(st.data) and vm.routine_word(st.data) == "resumed"
    # Nothing left in the history: it carries on with the routine it had.
    st = _settings(**data)
    monkeypatch.setattr(vm, "_async_fetch_history", AsyncMock(return_value={}))
    await vm._async_refresh_pattern_if_stale(_hass(st), st)
    assert st.data["vacation_mode_pattern"] == {"light.a": {"*:1200": 1.0}} and st.data["vacation_mode_pattern_end"] == 0


# ═══ preview and status ══════════════════════════════════════════════════════

async def test_the_preview_says_which_source_it_plays(monkeypatch):
    from custom_components.padspan_ha import websocket as W
    monkeypatch.setattr(vm, "_sun_times", lambda *a: (None, None))
    monkeypatch.setattr("custom_components.padspan_ha.telemetry.bump", lambda h, n: None)
    built = []

    async def fetch(hass, eids, days, end=None):
        return {"light.a": [(0.0, "on")]}
    real = vm.build_routine
    monkeypatch.setattr(vm, "build_routine", lambda h, n, source, *a: built.append(source) or real(h, n, source, *a))
    monkeypatch.setattr(vm, "_async_fetch_history", fetch)
    for chosen in ("last_week", "month"):
        st = _settings(vacation_mode_enabled=False, vacation_mode_source=chosen)
        hass = _hass(st, _states(**{"light.a": "off"}))
        conn = MagicMock()
        await W.ws_vacation_preview(hass, conn, {"id": 1})
        out = conn.send_result.call_args.args[1]
        assert out["source"] == chosen and out["routine"] == "own" and built[-1] == chosen
    # Running: what the trip was built from, whatever the setting says now.
    now = datetime(2026, 1, 15, 12, 0, 0).timestamp()
    st = _settings(vacation_mode_enabled=True, vacation_mode_enabled_at=now, vacation_mode_source="month",
                   vacation_mode_pattern={"light.a": {"*:1200": 1.0}}, vacation_mode_pattern_until=now,
                   vacation_mode_pattern_source="last_week")
    conn = MagicMock()
    await W.ws_vacation_preview(_hass(st, _states(**{"light.a": "off"})), conn, {"id": 2})
    assert conn.send_result.call_args.args[1]["source"] == "last_week"
    a = vm.status_attributes(_hass(st), st.data)
    assert a["source"] == "last_week"
    assert vm.status_attributes(_hass(st), {"vacation_mode_source": "month"})["source"] == "month"


def test_the_options_box_offers_the_choice_and_drops_sunset_from_evening_lights():
    from pathlib import Path
    www = Path(vm.__file__).parent / "www" / "padspan-ha"
    lm = (www / "views" / "lights_map.js").read_text(encoding="utf-8")
    assert "vacation_mode_source" in lm and "Monthly average" in lm and "Last week" in lm
    assert "From last week" in lm and "From the monthly average" in lm
    assert "On from dark" not in lm and "needs Home Assistant's sun times" not in lm
    assert "lv-vac-seg" in (www / "styles.css").read_text(encoding="utf-8")
    ib = (www / "views" / "installbase.js").read_text(encoding="utf-8")
    assert '"vacation.source:last_week"' in ib and '"vacation.source:month"' in ib
    assert vm.REPORT_WORDS["source"] == ("last_week", "month")
