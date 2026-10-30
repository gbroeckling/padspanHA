# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Vacation Mode, the rest of the 2026-10-26 research list: the most lights
on at once (item 6's second half), anchor lights held on through the
evening (item 7), and a preview of the next 24 hours (item 8). Each is off
until set; with none set, the tick does exactly what it did before."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha import vacation_mode as vm
from tests.test_vacation_mode import _hass, _settings, _states


# ═══ most lights on at once ══════════════════════════════════════════════════

def test_the_cap_keeps_lights_already_on_and_holds_the_rest_off():
    at = datetime(2026, 10, 27, 20, 0)
    dec = {f"light.{c}": True for c in "abcde"}
    dec["light.f"] = False
    out, used = vm.apply_options(dec, data={"vacation_mode_max_lights": 2}, now_ts=at.timestamp(), at_local=at,
                                 dark=None, on_since={}, capped={}, lit={"light.d", "light.e"})
    assert {e for e, v in out.items() if v} == {"light.d", "light.e"} and used == {"max_lights"}
    assert out["light.f"] is False
    # Nothing on yet: the same two every tick of the window (seeded, not random).
    a, _ = vm.apply_options(dec, data={"vacation_mode_max_lights": 2}, now_ts=at.timestamp(), at_local=at,
                            dark=None, on_since={}, capped={}, lit=set())
    b, _ = vm.apply_options(dec, data={"vacation_mode_max_lights": 2}, now_ts=at.timestamp() + 300,
                            at_local=at.replace(minute=5), dark=None, on_since={}, capped={}, lit=set())
    assert sum(a.values()) == 2 and a == b
    # Under the cap, or unset: nothing changes.
    for data in ({"vacation_mode_max_lights": 9}, {"vacation_mode_max_lights": 0}, {}):
        out, used = vm.apply_options(dec, data=data, now_ts=at.timestamp(), at_local=at, dark=None,
                                     on_since={}, capped={}, lit=set())
        assert out == dec and used == set()


# ═══ anchor lights ═══════════════════════════════════════════════════════════

def test_anchor_ids_are_lights_only_capped_and_deduplicated():
    raw = ["light.porch", "lock.front", "light.porch", "cover.garage", 7, "fan.attic"] + [f"light.l{i}" for i in range(15)]
    ids = vm.anchor_ids({"vacation_mode_anchors": raw})
    assert ids[0] == "light.porch" and len(ids) == vm.ANCHORS_MAX
    assert all(e.startswith("light.") for e in ids)
    assert vm.anchor_ids({"vacation_mode_anchors": ["light.porch", "light.gone"]}, {"light.porch"}) == ["light.porch"]
    assert vm.anchor_ids({}) == [] and vm.anchor_ids({"vacation_mode_anchors": "light.porch"}) == []


def test_the_anchor_window_runs_from_dark_to_bedtime():
    eve = datetime(2026, 10, 27, 19, 0)
    assert vm.anchor_window(eve, True, "")
    assert not vm.anchor_window(eve, False, "") and not vm.anchor_window(eve, None, "")
    # No bedtime: about 23:00, with the bedtime's nightly jitter.
    assert vm.anchor_window(eve.replace(hour=22, minute=30), True, "")
    assert not vm.anchor_window(eve.replace(hour=23, minute=30), True, "")
    # A bedtime past midnight carries it through.
    assert vm.anchor_window(datetime(2026, 10, 28, 0, 15), True, "01:30")
    assert not vm.anchor_window(datetime(2026, 10, 28, 2, 0), True, "01:30")
    # Dark before sunrise is not the evening.
    assert not vm.anchor_window(datetime(2026, 10, 28, 6, 0), True, "")


def test_anchors_go_on_in_the_window_and_off_only_if_vacation_mode_lit_them():
    dec = {"light.a": False}
    out, held = vm.apply_anchors(dec, ["light.porch", "light.a"], True, set())
    assert out == {"light.a": True, "light.porch": True} and held
    out, held = vm.apply_anchors({"light.porch": True}, ["light.porch"], True, set())
    assert not held                                   # the pattern had it on anyway
    # Past the window: the pattern decides; one it says nothing about goes off
    # only if Vacation Mode turned it on.
    out, _ = vm.apply_anchors({"light.a": True}, ["light.porch", "light.a"], False, {"light.porch"})
    assert out == {"light.a": True, "light.porch": False}
    out, _ = vm.apply_anchors({}, ["light.porch"], False, set())
    assert out == {}                                  # a person's porch light: left alone


async def test_the_tick_holds_an_anchor_on_after_dark_even_with_no_pattern(monkeypatch):
    now = datetime(2026, 1, 15, 12, 0, 0)            # conftest's clock (as_local: naive UTC)
    st = _settings(vacation_mode_enabled=True, vacation_mode_enabled_at=now.timestamp(),
                   vacation_mode_pattern={}, vacation_mode_pattern_until=now.timestamp(),
                   vacation_mode_anchors=["light.porch"])
    hass = _hass(st, _states(**{"light.porch": "off"}))
    log = vm.VacationLog.__new__(vm.VacationLog)
    log.entries, log._loaded = [], True
    log._store = SimpleNamespace(async_delay_save=lambda *a: None)
    hass.data[DOMAIN][vm._VM_LOG] = log
    monkeypatch.setattr(vm, "_dark_now", lambda *a: True)
    monkeypatch.setattr(vm, "_async_refresh_pattern_if_stale", AsyncMock())
    await vm._async_tick(hass)
    hass.services.async_call.assert_called_once_with("light", "turn_on", {"entity_id": "light.porch"})
    assert log.entries[-1][1:] == ["light.porch", 1]
    # Not dark: no anchor; what it lit goes off again.
    hass.states.get("light.porch").state = "on"
    hass.services.async_call.reset_mock()
    monkeypatch.setattr(vm, "_dark_now", lambda *a: False)
    await vm._async_tick(hass)
    hass.services.async_call.assert_called_once_with("light", "turn_off", {"entity_id": "light.porch"})


async def test_with_no_new_option_set_the_tick_switches_as_before(monkeypatch):
    now = datetime(2026, 1, 15, 12, 0, 0)
    key = vm.bucket_key(now)
    st = _settings(vacation_mode_enabled=True, vacation_mode_pattern={"light.a": {key: 1.0}, "light.b": {key: 1.0}},
                   vacation_mode_pattern_built_at=now.timestamp())
    hass = _hass(st, _states(**{"light.a": "off", "light.b": "off", "light.porch": "off"}))
    dark = MagicMock(return_value=True)
    monkeypatch.setattr(vm, "_dark_now", dark)
    await vm._async_tick(hass)
    calls = sorted(c.args[2]["entity_id"] for c in hass.services.async_call.call_args_list)
    assert calls == ["light.a", "light.b"]
    dark.assert_not_called()                          # no option: no sun lookup either


# ═══ preview ═════════════════════════════════════════════════════════════════

def test_the_preview_steps_the_tick_and_matches_its_draws():
    start = datetime(2026, 10, 27, 17, 2)
    pat = {"light.a": {"*:1800": 1.0, "*:1830": 1.0, "*:1900": 0.0}, "light.b": {"*:1900": 0.0}}
    spans = vm.preview_spans(pat, {}, start.timestamp(), datetime.fromtimestamp, lambda ts, at: True)
    t18 = datetime(2026, 10, 27, 18, 0).timestamp()
    assert spans == {"light.a": [[t18, t18 + 3600]]}
    # With the options and an anchor: capped, held, and bedtime-ended.
    data = {"vacation_mode_max_on_min": 30, "vacation_mode_bedtime": "22:00"}
    spans = vm.preview_spans(pat, data, start.timestamp(), datetime.fromtimestamp, lambda ts, at: at.hour >= 17, ["light.porch"])
    assert spans["light.a"][0] == [t18, t18 + 1800]
    porch = spans["light.porch"]
    assert porch[0][0] == datetime(2026, 10, 27, 17, 0).timestamp()
    assert 21 * 3600 + 40 * 60 <= porch[0][1] - datetime(2026, 10, 27).timestamp() <= 22 * 3600 + 20 * 60
    # An end date inside the window: nothing after it.
    end = datetime(2026, 10, 27, 18, 15).timestamp()
    spans = vm.preview_spans(pat, {"vacation_mode_end_at": end}, start.timestamp(), datetime.fromtimestamp, lambda ts, at: True)
    assert spans == {"light.a": [[t18, end]]}


async def test_the_preview_switches_and_stores_nothing(monkeypatch):
    from custom_components.padspan_ha import websocket as W
    now = datetime(2026, 1, 15, 12, 0, 0)
    key = vm.bucket_key(now)
    st = _settings(vacation_mode_enabled=True, vacation_mode_enabled_at=now.timestamp(),
                   vacation_mode_pattern={"light.a": {key: 1.0}}, vacation_mode_pattern_until=now.timestamp())
    states = _states(**{"light.a": "off"})
    states["light.a"].attributes = {"friendly_name": "Kitchen"}
    hass = _hass(st, states)
    monkeypatch.setattr(vm, "_sun_times", lambda *a: (None, None))
    bumped = []
    monkeypatch.setattr("custom_components.padspan_ha.telemetry.bump", lambda h, n: bumped.append(n))
    before = dict(st.data)
    conn = MagicMock()
    await W.ws_vacation_preview(hass, conn, {"id": 1})
    out = conn.send_result.call_args.args[1]
    assert out["routine"] == "own" and out["lights"][0]["name"] == "Kitchen"
    from homeassistant.util import dt as dt_util
    assert out["lights"][0]["on"][0][0] == dt_util.utcnow().timestamp()      # real time, not wall time
    hass.services.async_call.assert_not_called()
    st.async_set.assert_not_called()
    assert st.data == before and bumped == ["vacation_preview"]
    # Off, with no history to learn from and nothing learned before: empty, and said so.
    st2 = _settings(vacation_mode_enabled=False)
    hass2 = _hass(st2, _states(**{"light.a": "off"}))
    conn2 = MagicMock()
    await W.ws_vacation_preview(hass2, conn2, {"id": 2})
    out2 = conn2.send_result.call_args.args[1]
    assert out2["routine"] == "none" and out2["lights"] == [] and bumped[-1] == "vacation_preview_empty"


# ═══ settings, status entity, report ═════════════════════════════════════════

def test_the_new_options_are_off_by_default_validated_and_admin_only():
    from custom_components.padspan_ha import ws_settings as WS
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS as DEFAULTS
    from tests.test_house3d_store import _house, _run
    assert DEFAULTS["vacation_mode_max_lights"] == 0 and DEFAULTS["vacation_mode_anchors"] == []
    assert vm.OPTION_DEFAULTS["vacation_mode_max_lights"] == 0 and vm.OPTION_DEFAULTS["vacation_mode_anchors"] == []
    h = _house()
    st = h.data[DOMAIN][DATA_SETTINGS]

    async def _set(**kw):
        st.data.update(kw)
    st.async_set = _set
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "vacation_mode_max_lights": 500,
                                      "vacation_mode_anchors": ["light.porch", "lock.front", "light.porch"]}))
    assert st.data["vacation_mode_max_lights"] == 50 and st.data["vacation_mode_anchors"] == ["light.porch"]
    _run(WS.ws_settings_set(h, conn, {"id": 2, "vacation_mode_max_lights": -3, "vacation_mode_anchors": []}))
    assert st.data["vacation_mode_max_lights"] == 0 and st.data["vacation_mode_anchors"] == []
    conn2 = MagicMock()
    conn2.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, conn2, {"id": 3, "vacation_mode_anchors": ["light.porch"]}))
    conn2.send_error.assert_called_once()
    assert st.data["vacation_mode_anchors"] == []
    a = vm.status_attributes(h, {"vacation_mode_max_lights": 3, "vacation_mode_anchors": ["light.porch"]})
    assert a["max_lights_at_once"] == 3 and a["anchor_lights"] == ["light.porch"]
    a = vm.status_attributes(h, {})
    assert a["max_lights_at_once"] is None and a["anchor_lights"] is None


def test_the_report_says_whether_they_are_used_in_closed_words():
    from custom_components.padspan_ha import telemetry as T
    now = 2_000_000_000.0
    base = {"vacation_mode_enabled": False, "vacation_mode_periods": [[now - 86400 * 3, now - 86400]]}
    off = vm.report_buckets(base, [], now)
    assert off["max_lights"] == "no" and off["anchors"] == "no"
    on = vm.report_buckets({**base, "vacation_mode_max_lights": 4, "vacation_mode_anchors": ["light.porch"]}, [], now)
    assert on["max_lights"] == "yes" and on["anchors"] == "yes" and "porch" not in str(on)
    assert all(k in vm.REPORT_WORDS and v in vm.REPORT_WORDS[k] for k, v in on.items())
    for name in ("vacation_rule_max_lights", "vacation_anchor_on", "vacation_preview", "vacation_preview_empty"):
        assert name in T.EVENTS


def test_the_options_box_offers_them_and_both_hosts_wire_the_preview():
    from pathlib import Path
    www = Path(vm.__file__).parent / "www" / "padspan-ha"
    lm = (www / "views" / "lights_map.js").read_text(encoding="utf-8")
    assert "vacation_mode_max_lights" in lm and "vacation_mode_anchors" in lm and "Show the next 24 hours" in lm
    for host in (www / "lights_panel.js", www / "views" / "maps.js"):
        src = host.read_text(encoding="utf-8")
        assert "padspan_ha/vacation_preview" in src and "padspan_ha/vacation_lights" in src and "onVacationLights" in src


# ═══ review fixes ════════════════════════════════════════════════════════════

def test_the_cap_never_counts_or_turns_off_a_light_on_by_hand_or_an_anchor_in_its_window():
    at = datetime(2026, 10, 27, 20, 0)
    dec = {"light.hand": True, "light.porch": True, "light.a": True, "light.b": True}
    out, used = vm.apply_options(dec, data={"vacation_mode_max_lights": 1}, now_ts=at.timestamp(), at_local=at,
                                 dark=True, on_since={"light.a": at.timestamp() - 60}, capped={},
                                 lit={"light.a"}, on_by_hand={"light.hand"}, anchored={"light.porch"})
    assert out == {"light.hand": True, "light.porch": True, "light.a": True, "light.b": False}
    assert used == {"max_lights"}


def test_longest_on_leaves_an_anchor_in_its_window_alone_and_uncounted():
    at = datetime(2026, 10, 27, 21, 0)
    now = at.timestamp()
    capped: dict = {}
    out, used = vm.apply_options({"light.porch": True}, data={"vacation_mode_max_on_min": 60}, now_ts=now,
                                 at_local=at, dark=True, on_since={"light.porch": now - 3 * 3600}, capped=capped,
                                 anchored={"light.porch"})
    assert out == {"light.porch": True} and used == set() and capped == {}


def test_an_anchor_already_on_is_not_counted_as_held():
    _, held = vm.apply_anchors({}, ["light.porch"], True, {"light.porch"}, {"light.porch"})
    assert not held
    _, held = vm.apply_anchors({}, ["light.porch"], True, set(), set())
    assert held


def test_the_preview_steps_real_time_across_a_daylight_saving_change():
    from datetime import timezone, timedelta as td
    change = datetime(2026, 11, 1, 9, 0, tzinfo=timezone.utc).timestamp()     # 02:00 PDT -> 01:00 PST

    def to_local(ts):
        return datetime.fromtimestamp(ts, tz=timezone(td(hours=-7 if ts < change else -8)))
    start = datetime(2026, 10, 31, 12, 0, tzinfo=timezone(td(hours=-7))).timestamp()
    pat = {"light.a": {"*:" + f"{h:02d}{m:02d}": 1.0 for h in range(24) for m in (0, 30)}}
    spans = vm.preview_spans(pat, {}, start, to_local, lambda ts, at: True)
    assert spans == {"light.a": [[start, start + 24 * 3600]]}                  # 24 real hours, not 25
    pat = {"light.a": {"*:0000": 1.0, "*:0100": 0.0, "*:0130": 0.0}}
    for a, b in vm.preview_spans(pat, {}, start, to_local, lambda ts, at: True)["light.a"]:
        assert a < b


async def test_the_preview_reuses_the_routine_it_learned_for_a_few_minutes(monkeypatch):
    from custom_components.padspan_ha import websocket as W
    st = _settings(vacation_mode_enabled=False)
    hass = _hass(st, _states(**{"light.a": "off"}))
    calls = []

    async def fetch(*a, **k):
        calls.append(1)
        return {"light.a": [(0.0, "on")]}
    monkeypatch.setattr(vm, "_async_fetch_history", fetch)
    monkeypatch.setattr(vm, "_sun_times", lambda *a: (None, None))
    monkeypatch.setattr("custom_components.padspan_ha.telemetry.bump", lambda h, n: None)
    await W.ws_vacation_preview(hass, MagicMock(), {"id": 1})
    await W.ws_vacation_preview(hass, MagicMock(), {"id": 2})
    assert len(calls) == 1
    cached = hass.data[DOMAIN][vm._VM_PREVIEW]
    hass.data[DOMAIN][vm._VM_PREVIEW] = (cached[0] - vm.PREVIEW_CACHE_S - 1, cached[1], cached[2])
    await W.ws_vacation_preview(hass, MagicMock(), {"id": 3})
    assert len(calls) == 2


def test_the_anchor_picker_lists_only_lights_vacation_mode_switches():
    st = _settings()
    states = _states(**{"light.porch": "off", "light.hall_group": "off", "fan.attic": "off"})
    states["light.porch"].attributes = {"friendly_name": "Porch"}
    states["light.hall_group"].attributes = {"entity_id": ["light.porch"]}
    hass = _hass(st, states)
    assert vm.eligible_lights(hass) == [["light.porch", "Porch"]]
