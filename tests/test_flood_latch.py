# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Unit tests for custom_components.padspan_ha.flood_latch.

2026-09-18/19 incident: the listener was registered as
``hass.bus.async_listen("state_changed", lambda event: _on_state_changed(hass,
event))``. HA's real event bus decides whether to run a listener directly on
the event loop or hand it to a worker thread by checking for the ``@callback``
marker — and a bare lambda wrapping a marked function is a *different*,
unmarked function object, so HA dispatched it to a thread. Every trigger then
crashed inside `hass.async_create_task` (only legal from the event loop) with
"calls hass.async_create_task from a thread other than the event loop" — the
task, and therefore the latch write, silently never happened. Verified live:
`flood_latches` stayed `{}` in the deployed settings store despite the sensor
tripping repeatedly.

Fixed by registering ``functools.partial(_on_state_changed, hass)`` instead —
HA's dispatcher unwraps ``functools.partial`` to find the ``@callback`` marker
on the wrapped function. The stub ``homeassistant.core`` this test suite runs
against (see conftest.py) does not model that thread-vs-loop dispatch at all,
so no test here can reproduce the crash itself — what CAN be pinned down is
the actual code shape that caused it: the registered listener must be the
real function (or a `functools.partial` of it), never a lambda/closure.
test_setup_registers_a_partial_not_a_lambda below is that guard.

2026-09-19 week-review finding: the read-modify-write into flood_latches
used to happen synchronously in _on_state_changed itself, with only the
final write deferred via hass.async_create_task — so two different sensors
triggering back-to-back (no await between the two calls) read the same
pre-update snapshot and the later write silently clobbered the earlier
one's addition. Fixed by moving the whole read-check-write into
_async_latch, serialized behind a lock, so the snapshot is taken fresh at
write time. That means _on_state_changed's own tests now need to actually
run the coroutine it schedules (via hass.async_create_task) to see the
write happen — _hass() below hands back the scheduled coroutine(s) for a
test to await, rather than a bare MagicMock that silently drops them.
"""

from __future__ import annotations

from tests.conftest import keep_task

import asyncio
import functools
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.flood_latch import (
    ACTIVE_WINDOW_S,
    _on_entity_registry_updated,
    _on_state_changed,
    async_reset_latch,
    async_setup_flood_latch,
    async_stop_flood_latch,
    is_active,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _settings(flood_latches=None):
    return SimpleNamespace(
        data={"flood_latches": dict(flood_latches or {})},
        async_set=AsyncMock(),
    )


def _hass(st):
    """.tasks collects every coroutine handed to async_create_task, in
    order — a test drives one (or, for the race test, interleaves several)
    by awaiting it directly, the same way the real event loop eventually
    would. async_create_task itself stays a real MagicMock so
    .assert_called_once() etc. still work."""
    tasks = []
    hass = SimpleNamespace(
        data={DOMAIN: {DATA_SETTINGS: st}},
        bus=MagicMock(),
        async_create_task=MagicMock(side_effect=lambda coro, *a, **k: tasks.append(keep_task(coro))),
        tasks=tasks,
    )
    return hass


def _state_event(entity_id, state, device_class="moisture"):
    new_state = SimpleNamespace(entity_id=entity_id, state=state, attributes={"device_class": device_class})
    return SimpleNamespace(data={"new_state": new_state})


# ---------------------------------------------------------------------------
# Tests: the actual regression — how the listener is registered
# ---------------------------------------------------------------------------


def test_setup_registers_a_partial_not_a_lambda() -> None:
    """The listener passed to hass.bus.async_listen must be a functools.partial
    wrapping _on_state_changed directly — never a lambda/closure, which is
    exactly what broke live (see module docstring). Same requirement for the
    entity_registry_updated listener (2026-09-19, the orphan-cleanup fix) —
    it schedules a task the same way and would fail the same way on a
    worker thread if it were ever registered as a lambda."""
    hass = _hass(_settings())
    async_setup_flood_latch(hass)
    assert hass.bus.async_listen.call_count == 2
    calls = {c.args[0]: c.args[1] for c in hass.bus.async_listen.call_args_list}
    assert set(calls) == {"state_changed", "entity_registry_updated"}

    state_listener = calls["state_changed"]
    assert isinstance(state_listener, functools.partial)
    assert state_listener.func is _on_state_changed
    assert state_listener.args == (hass,)

    registry_listener = calls["entity_registry_updated"]
    assert isinstance(registry_listener, functools.partial)
    assert registry_listener.func is _on_entity_registry_updated
    assert registry_listener.args == (hass,)


def test_setup_is_idempotent_across_reloads() -> None:
    hass = _hass(_settings())
    async_setup_flood_latch(hass)
    async_setup_flood_latch(hass)
    assert hass.bus.async_listen.call_count == 2


def test_stop_unsubscribes_and_allows_resetup() -> None:
    hass = _hass(_settings())
    async_setup_flood_latch(hass)
    async_stop_flood_latch(hass)
    async_setup_flood_latch(hass)
    assert hass.bus.async_listen.call_count == 4  # 2 listeners, twice


# ---------------------------------------------------------------------------
# Tests: is_active
# ---------------------------------------------------------------------------


def test_is_active_false_for_non_dict() -> None:
    assert is_active(None) is False
    assert is_active("nope") is False


def test_is_active_false_for_missing_or_bad_expiry() -> None:
    assert is_active({}) is False
    assert is_active({"expires_at": "soon"}) is False
    assert is_active({"expires_at": True}) is False  # bool is an int subclass


def test_is_active_true_before_expiry_false_after() -> None:
    rec = {"triggered_at": 1000.0, "expires_at": 1000.0 + ACTIVE_WINDOW_S}
    assert is_active(rec, now_ts=1000.0 + ACTIVE_WINDOW_S - 1) is True
    assert is_active(rec, now_ts=1000.0 + ACTIVE_WINDOW_S + 1) is False


# ---------------------------------------------------------------------------
# Tests: _on_state_changed
# ---------------------------------------------------------------------------


async def test_a_fresh_trigger_latches_and_persists() -> None:
    st = _settings()
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.kitchen_leak", "on"))
    hass.async_create_task.assert_called_once()
    await hass.tasks[0]
    st.async_set.assert_called_once()
    latches = st.async_set.call_args.kwargs["flood_latches"]
    rec = latches["binary_sensor.kitchen_leak"]
    assert rec["expires_at"] - rec["triggered_at"] == ACTIVE_WINDOW_S


def test_ignores_non_on_states() -> None:
    st = _settings()
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.kitchen_leak", "off"))
    st.async_set.assert_not_called()


def test_ignores_non_binary_sensor_domain() -> None:
    st = _settings()
    hass = _hass(st)
    _on_state_changed(hass, _state_event("sensor.kitchen_leak", "on"))
    st.async_set.assert_not_called()


def test_ignores_non_moisture_device_class() -> None:
    st = _settings()
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.motion", "on", device_class="motion"))
    st.async_set.assert_not_called()


async def test_retrigger_while_already_latched_keeps_original_time() -> None:
    """ISA-18.2: a still-active alarm keeps its ORIGINAL occurrence time —
    a chattering sensor must not push expiry out further on every flap.
    The no-op decision now lives inside the scheduled task (it has to, to
    read fresh state under the lock — see the module docstring), so a task
    IS still scheduled here; it just must not end up writing anything."""
    now = time.time()
    original = {"triggered_at": now - 10, "expires_at": now - 10 + ACTIVE_WINDOW_S}
    st = _settings({"binary_sensor.kitchen_leak": original})
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.kitchen_leak", "on"))
    await hass.tasks[0]
    st.async_set.assert_not_called()


async def test_retrigger_after_expiry_starts_a_fresh_latch() -> None:
    expired = {"triggered_at": 0.0, "expires_at": 1.0}
    st = _settings({"binary_sensor.kitchen_leak": expired})
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.kitchen_leak", "on"))
    await hass.tasks[0]
    st.async_set.assert_called_once()
    latches = st.async_set.call_args.kwargs["flood_latches"]
    assert latches["binary_sensor.kitchen_leak"] != expired


# ---------------------------------------------------------------------------
# Tests: the lost-update race (2026-09-19 week-review finding)
# ---------------------------------------------------------------------------


async def test_two_different_sensors_triggering_back_to_back_do_not_clobber_each_other() -> None:
    """The actual regression: two _on_state_changed calls for DIFFERENT
    entities, back-to-back with no await between them (exactly what HA
    does dispatching two listeners off the same event-bus tick), used to
    each read the same pre-update flood_latches snapshot and independently
    build a new dict from it — whichever write landed last silently won,
    with the other entity's brand-new latch vanishing. fake_async_set below
    mutates st.data (like the real store) and yields once mid-write
    (await asyncio.sleep(0)), the same way a real store.async_save's disk
    write would give the loop a chance to run the other pending task —
    the exact window the original bug fell into."""
    st = _settings()

    async def fake_async_set(**kwargs):
        await asyncio.sleep(0)
        st.data = {**st.data, **kwargs}

    st.async_set = AsyncMock(side_effect=fake_async_set)
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.flood_a", "on"))
    _on_state_changed(hass, _state_event("binary_sensor.flood_b", "on"))
    assert len(hass.tasks) == 2
    await asyncio.gather(*hass.tasks)
    latches = st.data["flood_latches"]
    assert "binary_sensor.flood_a" in latches, f"the first trigger must survive the second's write: {latches}"
    assert "binary_sensor.flood_b" in latches, f"the second trigger must survive too: {latches}"


async def test_a_reset_racing_a_different_sensors_trigger_does_not_clobber_it() -> None:
    """async_reset_latch shares _async_latch's lock (same module docstring
    hazard, a second caller) — a Reset click for one entity racing a fresh
    trigger for a DIFFERENT entity must not drop either change."""
    st = _settings({"binary_sensor.flood_old": {"triggered_at": 1.0, "expires_at": 2.0}})

    async def fake_async_set(**kwargs):
        await asyncio.sleep(0)
        st.data = {**st.data, **kwargs}

    st.async_set = AsyncMock(side_effect=fake_async_set)
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.flood_new", "on"))
    assert len(hass.tasks) == 1
    await asyncio.gather(hass.tasks[0], async_reset_latch(hass, "binary_sensor.flood_old"))
    latches = st.data["flood_latches"]
    assert "binary_sensor.flood_new" in latches, f"the concurrent trigger must survive the reset: {latches}"
    assert "binary_sensor.flood_old" not in latches, f"the reset must still take effect: {latches}"


# ---------------------------------------------------------------------------
# Tests: async_reset_latch
# ---------------------------------------------------------------------------


async def test_reset_clears_an_existing_latch() -> None:
    st = _settings({"binary_sensor.kitchen_leak": {"triggered_at": 1.0, "expires_at": 2.0}})
    hass = _hass(st)
    result = await async_reset_latch(hass, "binary_sensor.kitchen_leak")
    assert result is True
    st.async_set.assert_called_once_with(flood_latches={})


async def test_reset_is_a_no_op_when_nothing_latched() -> None:
    st = _settings()
    hass = _hass(st)
    result = await async_reset_latch(hass, "binary_sensor.kitchen_leak")
    assert result is False
    st.async_set.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: _on_entity_registry_updated (orphan cleanup, 2026-09-19)
# ---------------------------------------------------------------------------


def _registry_event(entity_id, action="remove"):
    return SimpleNamespace(data={"action": action, "entity_id": entity_id})


async def test_a_deleted_entitys_latch_is_forgotten() -> None:
    st = _settings({"binary_sensor.old_leak": {"triggered_at": 1.0, "expires_at": 2.0}})
    hass = _hass(st)
    _on_entity_registry_updated(hass, _registry_event("binary_sensor.old_leak"))
    assert len(hass.tasks) == 1
    await hass.tasks[0]
    st.async_set.assert_called_once_with(flood_latches={})


async def test_deleting_an_entity_with_no_latch_is_a_silent_no_op() -> None:
    st = _settings({"binary_sensor.other": {"triggered_at": 1.0, "expires_at": 2.0}})
    hass = _hass(st)
    _on_entity_registry_updated(hass, _registry_event("binary_sensor.some_unrelated_light"))
    await hass.tasks[0]
    st.async_set.assert_not_called()


def test_a_rename_is_left_alone_not_migrated() -> None:
    """action="update" (a rename included) must not schedule anything —
    migrating the key to the new entity_id is a different, bigger feature
    nobody has asked for; see the module docstring."""
    st = _settings({"binary_sensor.old_name": {"triggered_at": 1.0, "expires_at": 2.0}})
    hass = _hass(st)
    _on_entity_registry_updated(hass, _registry_event("binary_sensor.new_name", action="update"))
    assert hass.tasks == []


def test_ignores_an_event_with_no_entity_id() -> None:
    hass = _hass(_settings())
    _on_entity_registry_updated(hass, SimpleNamespace(data={"action": "remove"}))
    assert hass.tasks == []


def test_the_phone_alarm_pill_hides_with_nothing_latched() -> None:
    """Design pass 2026-09-28: every phone showed a red "🚨 0" pill in the
    PadSpan top bar with nothing latched. panel.js toggles .hidden on it, but
    .mobile-topbar-pill's `all:unset` (same weight, later in the file) undid
    .hidden. The pill's own hidden rule must come after its base rule."""
    from pathlib import Path
    css = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
           / "styles.css").read_text(encoding="utf-8")
    base = css.index(".mobile-topbar-pill{")
    assert "all:unset" in css[base:css.index("}", base)]
    hidden = css.find(".mobile-topbar-pill.hidden{display:none}")
    assert hidden > base, "the pill's .hidden rule is missing or before the rule that undoes it"


def test_smoke_gas_and_co_alarms_latch_like_a_leak() -> None:
    """Emergency, widened (0.38.131): a smoke, gas or carbon monoxide alarm
    going on schedules the same latch a leak does; any other class never."""
    from custom_components.padspan_ha.flood_latch import EMERGENCY_DEVICE_CLASSES
    assert EMERGENCY_DEVICE_CLASSES == {"moisture", "smoke", "gas", "carbon_monoxide"}
    for dc in ("smoke", "gas", "carbon_monoxide"):
        st = _settings()
        hass = _hass(st)
        _on_state_changed(hass, _state_event(f"binary_sensor.hall_{dc}", "on", device_class=dc))
        assert hass.async_create_task.called, f"{dc} must latch"
    st = _settings()
    hass = _hass(st)
    _on_state_changed(hass, _state_event("binary_sensor.hall_problem", "on", device_class="problem"))
    assert not hass.async_create_task.called


# ---------------------------------------------------------------------------
# The phone notification (emergency_notify, on by default, 2026-11-22)
# ---------------------------------------------------------------------------

import sys  # noqa: E402
import types  # noqa: E402

import pytest  # noqa: E402

from custom_components.padspan_ha import alert_store as AS  # noqa: E402
from custom_components.padspan_ha import flood_latch as FL  # noqa: E402
from custom_components.padspan_ha import presence_coordinator as PC  # noqa: E402
from custom_components.padspan_ha import ws_occupancy as WO  # noqa: E402

_EID = "binary_sensor.sink_leak"


def _live_store(on=True, latches=None):
    st = SimpleNamespace(data={"emergency_notify": on, "flood_latches": dict(latches or {})})

    async def _set(**kw):
        st.data = {**st.data, **kw}
    st.async_set = AsyncMock(side_effect=_set)
    return st


def _hass_live(st):
    hass = _hass(st)
    attrs = {"device_class": "moisture", "friendly_name": "Sink leak sensor"}
    hass.states = SimpleNamespace(get=lambda eid: SimpleNamespace(attributes=attrs))
    return hass


@pytest.fixture
def notices(monkeypatch):
    """Every notice sent, as (target, email, title, message), to the Follow
    targets in notices.targets; the area is the Kitchen; the 2-day timer is
    recorded in notices.later, never run."""
    out: list = []
    out_targets = [("notify.mobile_app_phone", ""), ("", "me@example.com")]

    async def _send(hass, preferred, email, title, message, context=None):
        out.append((preferred, email, title, message))
        return preferred or "notify.auto"
    monkeypatch.setattr(PC, "async_send_follow_notify", _send)
    monkeypatch.setattr(AS, "follow_alert_targets", lambda hass, limit=5: list(out_targets))
    monkeypatch.setattr(WO, "_entity_area_name", lambda hass, eid: "Kitchen")
    ev = types.ModuleType("homeassistant.helpers.event")
    ev.async_call_later = MagicMock(side_effect=lambda hass, delay, cb: MagicMock())
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    return SimpleNamespace(sent=out, targets=out_targets, later=ev.async_call_later)


def test_on_by_default_and_settable() -> None:
    from pathlib import Path

    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["emergency_notify"] is True
    ws = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("emergency_notify"): bool' in ws and '"emergency_notify", "atlas_heatmap_enabled"' in ws


async def test_a_latch_sends_one_notice_to_each_follow_target_and_never_repeats(notices) -> None:
    st = _live_store()
    hass = _hass_live(st)
    await FL._async_latch(hass, _EID)
    assert [(p, e) for p, e, _, _ in notices.sent] == notices.targets
    title, message = notices.sent[0][2], notices.sent[0][3]
    assert title == "PadSpan: Leak alarm"
    assert message.startswith("Leak alarm: Sink leak sensor in the Kitchen, at ") and "You get this once" in message
    rec = st.data["flood_latches"][_EID]
    assert rec["notified"] is True and "end_said" not in rec
    delay = notices.later.call_args.args[1]
    assert abs(delay - ACTIVE_WINDOW_S) < 5, "the clear is scheduled for when the 2 days are up"
    # The sensor chatters on and off: still latched, nothing more is sent.
    for _ in range(3):
        await FL._async_latch(hass, _EID)
    assert len(notices.sent) == 2 and st.async_set.await_count == 1


async def test_with_no_follow_target_it_auto_picks_once(notices) -> None:
    notices.targets.clear()
    await FL._async_latch(_hass_live(_live_store()), _EID)
    assert [(p, e) for p, e, _, _ in notices.sent] == [("", "")], (
        "none set: the auto-pick a Follow alert with no target uses, once")


async def test_nothing_in_home_assistant_sends_nothing_and_the_latch_still_holds(notices, monkeypatch, caplog) -> None:
    async def _send(hass, preferred, email, title, message, context=None):
        raise PC.FollowNotifyNotSent("no_notify", "no notify services available in HA")
    monkeypatch.setattr(PC, "async_send_follow_notify", _send)
    notices.targets.clear()
    st = _live_store()
    await FL._async_latch(_hass_live(st), _EID)
    assert is_active(st.data["flood_latches"][_EID])
    assert "Emergency alarm notice not sent via auto-detect" in caplog.text


async def test_off_sends_nothing_and_marks_nothing(notices) -> None:
    st = _live_store(on=False)
    hass = _hass_live(st)
    await FL._async_latch(hass, _EID)
    assert "notified" not in st.data["flood_latches"][_EID]
    await FL.async_reset_latch(hass, _EID)
    assert notices.sent == [] and not notices.later.called


async def test_a_reset_says_the_clear_once_and_a_deleted_sensor_says_nothing(notices) -> None:
    notices.targets[:] = [("notify.mobile_app_phone", "")]
    now = time.time()
    rec = {"triggered_at": now - 60, "expires_at": now + 3600, "notified": True}
    st = _live_store(latches={_EID: rec, "binary_sensor.gone": dict(rec)})
    hass = _hass_live(st)
    cancel = MagicMock()
    hass.data[DOMAIN][FL._DATA_TIMERS] = {_EID: cancel}
    assert await FL.async_reset_latch(hass, _EID) is True
    assert [t for _, _, t, _ in notices.sent] == ["PadSpan: Leak alarm cleared"]
    cancel.assert_called_once()
    assert await FL.async_reset_latch(hass, _EID) is False and len(notices.sent) == 1
    _on_entity_registry_updated(hass, SimpleNamespace(data={"action": "remove", "entity_id": "binary_sensor.gone"}))
    await hass.tasks[-1]
    assert "binary_sensor.gone" not in st.data["flood_latches"] and len(notices.sent) == 1


async def test_the_two_days_ending_says_the_clear_once(notices) -> None:
    notices.targets[:] = [("notify.mobile_app_phone", "")]
    now = time.time()
    rec = {"triggered_at": now - ACTIVE_WINDOW_S - 5, "expires_at": now - 5, "notified": True}
    st = _live_store(latches={_EID: rec})
    hass = _hass_live(st)
    await FL._async_ended(hass, _EID, rec["triggered_at"])
    assert [t for _, _, t, _ in notices.sent] == ["PadSpan: Leak alarm ended"]
    assert "after 2 days without a reset" in notices.sent[0][3]
    assert st.data["flood_latches"][_EID]["end_said"] is True
    await FL._async_ended(hass, _EID, rec["triggered_at"])
    await FL.async_reset_latch(hass, _EID)
    assert len(notices.sent) == 1, "said once: not again, nor on a reset after it"


async def test_a_restart_schedules_only_the_clears_still_to_say(notices) -> None:
    now = time.time()
    st = _live_store(latches={
        "binary_sensor.a": {"triggered_at": now - 10, "expires_at": now + 100, "notified": True},
        "binary_sensor.b": {"triggered_at": now - 10, "expires_at": now + 100},                     # from before
        "binary_sensor.c": {"triggered_at": now - 10, "expires_at": now - 1, "notified": True},      # due while off
        "binary_sensor.d": {"triggered_at": now - 10, "expires_at": now - 1, "notified": True, "end_said": True},
    })
    hass = _hass_live(st)
    async_setup_flood_latch(hass)
    assert sorted(hass.data[DOMAIN][FL._DATA_TIMERS]) == ["binary_sensor.a", "binary_sensor.c"]
    delays = sorted(c.args[1] for c in notices.later.call_args_list)
    assert delays[0] == 0.0 and 90 < delays[1] <= 100
    async_stop_flood_latch(hass)
    assert FL._DATA_TIMERS not in hass.data[DOMAIN]


def test_vacation_mode_and_alarms_read_follow_targets_one_way() -> None:
    from pathlib import Path
    cc = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    for name in ("vacation_mode.py", "flood_latch.py"):
        assert "follow_alert_targets" in (cc / name).read_text(encoding="utf-8"), name
    store = SimpleNamespace(all=lambda: {
        "a": {"notify_service": "notify.mobile_app_phone", "email": ""},
        "b": {"notify_service": "notify.mobile_app_phone", "email": ""},
        "c": {"notify_service": "", "email": ""},
        "d": {"notify_service": "", "email": "me@example.com"},
    })
    from custom_components.padspan_ha.const import DATA_ALERTS
    hass = SimpleNamespace(data={DOMAIN: {DATA_ALERTS: store}})
    assert AS.follow_alert_targets(hass) == [("notify.mobile_app_phone", ""), ("", "me@example.com")]
