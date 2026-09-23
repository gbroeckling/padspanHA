# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Vacation Mode — a Whole House Preset that isn't a snapshot (Garry,
2026-09-21): "act like an average day based on data collected, and turn on
and off lights based on that data until it is turned off", "day of the week
to make it look a bit more random", and a 5-100 intensity slider that
doubles as an energy-saving mode.

bucket_key/sample_points/state_at/build_pattern/decide_states are pure —
tested directly here with synthetic history and an injectable random
function, no real HA recorder or clock needed. The scheduler/recorder glue
(_async_tick, _async_fetch_history, async_setup_vacation_mode) is exercised
with a fake hass/store, the same style test_flood_latch.py already uses —
what it can't cover is the real recorder API shape, since this repo's test
suite has no real recorder to run against (flagged in the module docstring
too).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.vacation_mode import (
    VM_DOMAINS,
    _VM_LOG,
    _async_refresh_pattern_if_stale,
    _async_tick,
    build_pattern,
    bucket_key,
    closed_periods,
    decide_states,
    in_periods,
    prune_log,
    sample_points,
    state_at,
)


# ---------------------------------------------------------------------------
# bucket_key
# ---------------------------------------------------------------------------


def test_bucket_key_floors_to_the_window_and_names_the_weekday():
    mon_0605 = datetime(2026, 9, 21, 6, 5)   # a Monday
    assert mon_0605.weekday() == 0
    assert bucket_key(mon_0605) == "0:0600"
    assert bucket_key(mon_0605.replace(minute=29)) == "0:0600"
    assert bucket_key(mon_0605.replace(minute=30)) == "0:0630"
    sun = datetime(2026, 9, 20, 18, 45)  # a Sunday
    assert sun.weekday() == 6
    assert bucket_key(sun) == "6:1830"


# ---------------------------------------------------------------------------
# sample_points
# ---------------------------------------------------------------------------


def test_sample_points_covers_the_range_on_the_window_grid():
    start = datetime(2026, 9, 21, 6, 5)
    end = datetime(2026, 9, 21, 7, 35)
    pts = sample_points(start, end)
    # Floors to 6:00, then every 30 minutes while strictly < end, but never
    # a point actually before `start` itself (06:00 is dropped for that).
    assert [p.strftime("%H:%M") for p in pts] == ["06:30", "07:00", "07:30"]


def test_sample_points_empty_for_a_backwards_or_empty_range():
    t = datetime(2026, 9, 21, 6, 0)
    assert sample_points(t, t) == []
    assert sample_points(t, t - timedelta(minutes=1)) == []


# ---------------------------------------------------------------------------
# state_at
# ---------------------------------------------------------------------------


def test_state_at_returns_the_latest_change_at_or_before():
    changes = [(1000.0, "off"), (2000.0, "on"), (3000.0, "off")]
    assert state_at(changes, 500.0) is None, "before the first known change"
    assert state_at(changes, 1000.0) == "off"
    assert state_at(changes, 1999.0) == "off"
    assert state_at(changes, 2000.0) == "on"
    assert state_at(changes, 2500.0) == "on"
    assert state_at(changes, 3000.0) == "off"
    assert state_at(changes, 9999.0) == "off"


def test_state_at_does_not_require_pre_sorted_input():
    changes = [(3000.0, "off"), (1000.0, "off"), (2000.0, "on")]
    assert state_at(changes, 2500.0) == "on"


# ---------------------------------------------------------------------------
# build_pattern
# ---------------------------------------------------------------------------


def _epoch(dt: datetime) -> float:
    return dt.timestamp()


def test_build_pattern_computes_on_probability_per_weekday_slot():
    """Two Mondays at 18:00, light on both times: build_pattern sweeps
    EVERY 30-min slot across the whole history_days window, not just the
    exact instants a light changed — so a bucket's sample count is how
    many times that (weekday, time) recurred in-window, each one sampled
    via carry-forward state (state_at), not a literal event count. Kept
    to a short, easy-to-hand-verify 8-day window: exactly two Mondays at
    18:00 fall inside it (2026-09-14 and 2026-09-21), so "0:1800" clears
    MIN_SAMPLES at 100% on; no other weekday recurs twice in 8 days, so
    every other bucket stays below MIN_SAMPLES and is omitted."""
    now = datetime(2026, 9, 22, 0, 0)  # the Tuesday right after both Mondays
    mon1 = datetime(2026, 9, 14, 18, 0)  # Monday
    mon2 = datetime(2026, 9, 21, 18, 0)  # Monday
    history = {
        "light.a": [
            (_epoch(mon1), "on"), (_epoch(mon1) + 1800, "off"),
            (_epoch(mon2), "on"), (_epoch(mon2) + 1800, "off"),
        ],
    }
    pattern = build_pattern(history, now, history_days=8)
    # Verified by hand against the real implementation, not guessed: every
    # Monday evening slot from 18:00 (the on-transition) through midnight
    # gets 2 real samples (both Mondays), correctly on at 18:00 and off from
    # 18:30 on. Monday MORNING slots get only 1 real sample (the first
    # Monday predates any transition at all, so state_at returns None there
    # and it isn't counted) — below MIN_SAMPLES, correctly omitted. No other
    # weekday recurs twice in an 8-day window, so nothing else appears.
    assert pattern["light.a"]["0:1800"] == 1.0, pattern
    assert pattern["light.a"]["0:1830"] == 0.0, pattern
    assert not any(k.startswith("1:") for k in pattern["light.a"]), "only 1 Tuesday in-window — must not appear"
    assert set(pattern["light.a"]) == {
        "0:1800", "0:1830", "0:1900", "0:1930", "0:2000", "0:2030",
        "0:2100", "0:2130", "0:2200", "0:2230", "0:2300", "0:2330",
    }, pattern


def test_build_pattern_a_single_weekday_occurrence_never_clears_min_samples():
    """A tight 3-day window around one Tuesday 18:00 event sees that
    (weekday, slot) recur exactly once — must not appear at all, a
    confident-looking probability from a single fluke would be worse than
    no answer."""
    now = datetime(2026, 9, 16, 0, 0)  # Wednesday, 1 day after tue1
    tue1 = datetime(2026, 9, 15, 18, 0)  # Tuesday
    history = {"light.a": [(_epoch(tue1), "off")]}
    pattern = build_pattern(history, now, history_days=3)
    assert pattern == {}, pattern

def test_build_pattern_mixed_on_off_gives_a_real_fraction():
    now = datetime(2026, 9, 28, 0, 0)
    mon1 = datetime(2026, 9, 14, 9, 0)
    mon2 = datetime(2026, 9, 21, 9, 0)
    history = {"light.a": [(_epoch(mon1), "on"), (_epoch(mon2), "off")]}
    pattern = build_pattern(history, now, history_days=30)
    assert pattern["light.a"]["0:0900"] == 0.5


def test_build_pattern_ignores_entities_with_no_history():
    now = datetime(2026, 9, 28, 0, 0)
    assert build_pattern({"light.a": []}, now) == {}


def test_build_pattern_only_counts_real_on_off_states_not_unavailable():
    now = datetime(2026, 9, 28, 0, 0)
    mon1 = datetime(2026, 9, 14, 9, 0)
    mon2 = datetime(2026, 9, 21, 9, 0)
    history = {"light.a": [(_epoch(mon1), "unavailable"), (_epoch(mon2), "on")]}
    pattern = build_pattern(history, now, history_days=30)
    assert "light.a" not in pattern, "only 1 real on/off sample — below MIN_SAMPLES"


# ---------------------------------------------------------------------------
# decide_states
# ---------------------------------------------------------------------------


def test_decide_states_only_includes_entities_with_data_for_this_slot():
    pattern = {"light.a": {"0:1800": 1.0}, "light.b": {"0:0900": 1.0}}
    at = datetime(2026, 9, 21, 18, 0)  # Monday 18:00 — matches light.a only
    out = decide_states(pattern, at, 100, rand_fn=lambda: 0.5)
    assert out == {"light.a": True}
    assert "light.b" not in out, "no data for this (entity, slot) — must not be forced to a state"


def test_decide_states_applies_intensity_as_a_probability_scale_not_a_cutoff():
    pattern = {"light.a": {"0:1800": 0.5}}
    at = datetime(2026, 9, 21, 18, 0)
    # prob(0.5) * intensity(50%) = 0.25 — a draw of 0.2 should turn it on,
    # a draw of 0.3 should not. This is the "energy saving" mechanism, not
    # a hard top-N cutoff.
    assert decide_states(pattern, at, 50, rand_fn=lambda: 0.2)["light.a"] is True
    assert decide_states(pattern, at, 50, rand_fn=lambda: 0.3)["light.a"] is False


def test_decide_states_5_percent_intensity_is_five_percent_not_zero():
    pattern = {"light.a": {"0:1800": 1.0}}
    at = datetime(2026, 9, 21, 18, 0)
    assert decide_states(pattern, at, 5, rand_fn=lambda: 0.04)["light.a"] is True
    assert decide_states(pattern, at, 5, rand_fn=lambda: 0.06)["light.a"] is False


def test_decide_states_clamps_out_of_range_intensity():
    pattern = {"light.a": {"0:1800": 1.0}}
    at = datetime(2026, 9, 21, 18, 0)
    assert decide_states(pattern, at, 500, rand_fn=lambda: 0.999)["light.a"] is True
    assert decide_states(pattern, at, -10, rand_fn=lambda: 0.0)["light.a"] is False


# ---------------------------------------------------------------------------
# _async_tick — the glue, with a fake hass/store
# ---------------------------------------------------------------------------


def _settings(**data):
    base = {
        "vacation_mode_enabled": False, "vacation_mode_intensity": 100,
        "vacation_mode_pattern": {}, "vacation_mode_pattern_built_at": 0,
    }
    base.update(data)
    return SimpleNamespace(data=base, async_set=AsyncMock(side_effect=lambda **kw: base.update(kw)))


def _states(**entities):
    return {eid: SimpleNamespace(state=state) for eid, state in entities.items()}


def _hass(st, states=None):
    return SimpleNamespace(
        data={DOMAIN: {DATA_SETTINGS: st}},
        states=SimpleNamespace(get=lambda eid: (states or {}).get(eid)),
        services=SimpleNamespace(async_call=AsyncMock()),
    )


async def test_tick_is_a_no_op_when_disabled():
    st = _settings(vacation_mode_enabled=False)
    hass = _hass(st)
    await _async_tick(hass)
    hass.services.async_call.assert_not_called()


async def test_tick_is_a_no_op_with_no_pattern_yet():
    st = _settings(vacation_mode_enabled=True, vacation_mode_pattern={})
    hass = _hass(st)
    await _async_tick(hass)
    hass.services.async_call.assert_not_called()


async def test_tick_turns_on_a_light_the_pattern_says_should_be_on():
    now = datetime(2026, 1, 15, 12, 0, 0)  # matches conftest.py's _fake_utcnow (as_local strips tzinfo only)
    key = bucket_key(now)
    st = _settings(
        vacation_mode_enabled=True, vacation_mode_intensity=100,
        vacation_mode_pattern={"light.a": {key: 1.0}},
        vacation_mode_pattern_built_at=now.timestamp(),  # already fresh — skip a real recorder call
    )
    hass = _hass(st, _states(**{"light.a": "off"}))
    await _async_tick(hass)
    hass.services.async_call.assert_called_once_with("light", "turn_on", {"entity_id": "light.a"})


async def test_tick_leaves_a_light_alone_if_it_already_matches():
    now = datetime(2026, 1, 15, 12, 0, 0)  # matches conftest.py's _fake_utcnow (as_local strips tzinfo only)
    key = bucket_key(now)
    st = _settings(
        vacation_mode_enabled=True, vacation_mode_intensity=100,
        vacation_mode_pattern={"light.a": {key: 1.0}},
        vacation_mode_pattern_built_at=now.timestamp(),
    )
    hass = _hass(st, _states(**{"light.a": "on"}))
    await _async_tick(hass)
    hass.services.async_call.assert_not_called()


async def test_tick_skips_an_unavailable_entity():
    now = datetime(2026, 1, 15, 12, 0, 0)  # matches conftest.py's _fake_utcnow (as_local strips tzinfo only)
    key = bucket_key(now)
    st = _settings(
        vacation_mode_enabled=True, vacation_mode_intensity=100,
        vacation_mode_pattern={"light.a": {key: 1.0}},
        vacation_mode_pattern_built_at=now.timestamp(),
    )
    hass = _hass(st, _states(**{"light.a": "unavailable"}))
    await _async_tick(hass)
    hass.services.async_call.assert_not_called()


async def test_tick_never_calls_a_non_light_fan_domain_even_from_a_hand_edited_pattern():
    """Defense in depth: the pattern is only ever supposed to hold light./
    fan. entities (build_pattern is only ever fed light./fan. history), but
    a hand-edited or foreign settings store must not be trusted blindly."""
    now = datetime(2026, 1, 15, 12, 0, 0)  # matches conftest.py's _fake_utcnow (as_local strips tzinfo only)
    key = bucket_key(now)
    st = _settings(
        vacation_mode_enabled=True, vacation_mode_intensity=100,
        vacation_mode_pattern={"lock.front_door": {key: 1.0}, "light.ok": {key: 1.0}},
        vacation_mode_pattern_built_at=now.timestamp(),
    )
    hass = _hass(st, _states(**{"lock.front_door": "locked", "light.ok": "off"}))
    await _async_tick(hass)
    hass.services.async_call.assert_called_once_with("light", "turn_on", {"entity_id": "light.ok"})


def test_vm_domains_is_light_and_fan_only():
    assert VM_DOMAINS == ("light.", "fan.")


# ---------------------------------------------------------------------------
# NEVER LEARN FROM ITSELF (Garry, 2026-09-23) — the pattern is built from
# history before the vacation began, never from Vacation Mode's own output
# ---------------------------------------------------------------------------


def test_build_pattern_skips_earlier_vacation_spans():
    now = datetime(2026, 1, 30, 0, 0, 0)
    # On every day at noon for the whole window...
    changes = []
    for d in range(30):
        day = now - timedelta(days=d + 1)
        changes.append(((day.replace(hour=11, minute=45)).timestamp(), "off"))
        changes.append(((day.replace(hour=12, minute=0)).timestamp(), "on"))
        changes.append(((day.replace(hour=12, minute=15)).timestamp(), "off"))
    # ...but the whole window was one earlier vacation: nothing is learned.
    span = [[(now - timedelta(days=31)).timestamp(), now.timestamp()]]
    assert build_pattern({"light.a": changes}, now, exclude=span) == {}
    assert build_pattern({"light.a": changes}, now) != {}


def test_in_periods_open_and_closed_spans():
    assert in_periods(150, [[100, 200]])
    assert not in_periods(200, [[100, 200]])      # end is exclusive
    assert in_periods(10**9, [[100, None]])       # still-open span
    assert not in_periods(50, [[100, None], "junk", [None, 5]])


def test_closed_periods_appends_the_span_and_prunes_old_ones():
    now = 100 * 86400.0
    old = [[1.0, 2.0]]                       # ended ~100 days ago: pruned
    keep = [[now - 10 * 86400, now - 9 * 86400]]
    out = closed_periods(old + keep, now - 3600, now)
    assert out == keep + [[now - 3600, now]]
    assert closed_periods([], 0, now) == []  # never-stamped: nothing to add


def test_prune_log_keeps_14_days_and_the_newest_rows():
    now = 30 * 86400.0
    rows = [[now - 20 * 86400, "light.a", 1], [now - 60, "light.a", 0]]
    assert prune_log(rows, now) == [[now - 60, "light.a", 0]]


async def test_refresh_builds_from_history_ending_when_the_vacation_began(monkeypatch):
    import custom_components.padspan_ha.vacation_mode as vm
    enabled_at = datetime(2026, 1, 14, 18, 0, 0).timestamp()
    seen = {}

    async def fake_fetch(hass, eids, days, end=None):
        seen["end"] = end
        t = (end - timedelta(days=15)).timestamp()   # every weekday slot seen twice
        return {"light.a": [(t, "on")]}

    monkeypatch.setattr(vm, "_async_fetch_history", fake_fetch)
    monkeypatch.setattr(vm, "_eligible_entity_ids", lambda hass: ["light.a"])
    st = _settings(vacation_mode_enabled=True, vacation_mode_enabled_at=enabled_at)
    await _async_refresh_pattern_if_stale(_hass(st), st)
    assert seen["end"].timestamp() == enabled_at
    assert st.data["vacation_mode_pattern"]
    assert st.data["vacation_mode_pattern_until"] == enabled_at


async def test_refresh_never_rebuilds_during_the_vacation(monkeypatch):
    import custom_components.padspan_ha.vacation_mode as vm
    fetch = AsyncMock(return_value={"light.a": [(0.0, "on")]})
    monkeypatch.setattr(vm, "_async_fetch_history", fetch)
    enabled_at = datetime(2026, 1, 1).timestamp()   # two weeks into the trip
    st = _settings(vacation_mode_enabled=True, vacation_mode_enabled_at=enabled_at,
                   vacation_mode_pattern={"light.a": {"0:1200": 0.5}},
                   vacation_mode_pattern_until=enabled_at, vacation_mode_pattern_built_at=enabled_at)
    await _async_refresh_pattern_if_stale(_hass(st), st)
    fetch.assert_not_called()


async def test_refresh_freezes_a_pattern_built_before_enabled_at_existed(monkeypatch):
    """Turned on under the old code (no enabled_at): keep the pattern it has."""
    import custom_components.padspan_ha.vacation_mode as vm
    fetch = AsyncMock(return_value={})
    monkeypatch.setattr(vm, "_async_fetch_history", fetch)
    built = datetime(2026, 1, 10).timestamp()
    st = _settings(vacation_mode_enabled=True, vacation_mode_pattern={"light.a": {"0:1200": 0.5}},
                   vacation_mode_pattern_built_at=built)
    await _async_refresh_pattern_if_stale(_hass(st), st)
    fetch.assert_not_called()
    assert st.data["vacation_mode_enabled_at"] == built


async def test_tick_logs_what_it_switched():
    now = datetime(2026, 1, 15, 12, 0, 0)
    key = bucket_key(now)
    st = _settings(vacation_mode_enabled=True, vacation_mode_pattern={"light.a": {key: 1.0}},
                   vacation_mode_pattern_built_at=now.timestamp(), vacation_mode_enabled_at=now.timestamp(),
                   vacation_mode_pattern_until=now.timestamp())
    hass = _hass(st, _states(**{"light.a": "off"}))
    log = SimpleNamespace(async_append=AsyncMock())
    hass.data[DOMAIN][_VM_LOG] = log
    await _async_tick(hass)
    log.async_append.assert_called_once()
    _ts, eid, on = log.async_append.call_args.args
    assert (eid, on) == ("light.a", True)
