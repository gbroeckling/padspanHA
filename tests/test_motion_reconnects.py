# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A motion sensor back from an offline blip is not motion (motion_reconnects.py).

Live 2026-09-27 02:22 PDT: CarTruckHome and DeckLounge occupancy dropped to
unavailable for 29 s and came back "off", alarm_di2/3/4 for 0.2 s. HA dated
each return like a change, so the Atlas pulsed five markers for 5 minutes and
CarTruckHome wore the recent-motion ring until 08:22. The timestamps below are
that night's, from /api/history.

The listener runs against the stub HA (conftest.py); the drawing runs the real
lights_map.js + iso_lights.js under node, fed exactly what the listener made.
"""

from __future__ import annotations

import datetime
import functools
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import motion_reconnects as MR
from custom_components.padspan_ha.const import DOMAIN
from tests.test_lights_ergonomics import _NODE, _run

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"

CAR = "binary_sensor.0xa4c13814d221ffff_occupancy"      # CarTruckHome Occupancy
DI2 = "binary_sensor.alarm_di2"
# The night of 2026-09-27 (UTC; 09:22 is 02:22 PDT).
CAR_NIGHT = [("on", "2026-09-27T01:32:30.799517+00:00"), ("off", "2026-09-27T01:34:24.667573+00:00"),
             ("unavailable", "2026-09-27T09:22:00.318118+00:00"), ("off", "2026-09-27T09:22:29.310481+00:00")]
DI2_NIGHT = [("on", "2026-09-27T05:42:25.634594+00:00"), ("off", "2026-09-27T05:42:28.289297+00:00"),
             ("unavailable", "2026-09-27T09:22:21.863975+00:00"), ("off", "2026-09-27T09:22:22.061116+00:00")]
# The last HA start before that night (2026-09-24 18:32 PDT).
STARTED = "2026-09-25T01:32:00+00:00"


def _hass():
    return SimpleNamespace(data={DOMAIN: {}}, bus=MagicMock())


def _feed(hass, eid, seq, dc="occupancy", old=None):
    """Drive the listener through `seq` the way HA's bus would; returns the
    last state object (the one hass.states now holds)."""
    for state, when in seq:
        new = SimpleNamespace(state=state, attributes={"device_class": dc},
                              last_changed=datetime.datetime.fromisoformat(when))
        MR._on_state_changed(hass, SimpleNamespace(data={"entity_id": eid, "old_state": old, "new_state": new}))
        old = new
    return old


def _reconnects(hass):
    return hass.data[DOMAIN][MR._DATA]["reconnects"]


# ── The listener ────────────────────────────────────────────────────────────


def test_setup_registers_a_partial_once():
    """A lambda would run on a worker thread (flood_latch.py, 2026-09-18);
    async_setup runs once per process, but twice must still be one listener."""
    hass = _hass()
    MR.async_setup_motion_reconnects(hass)
    MR.async_setup_motion_reconnects(hass)
    assert hass.bus.async_listen.call_count == 1
    event, listener = hass.bus.async_listen.call_args.args
    assert event == "state_changed"
    assert isinstance(listener, functools.partial) and listener.func is MR._on_state_changed and listener.args == (hass,)


def test_the_09_27_blip_keeps_the_real_change():
    hass = _hass()
    _feed(hass, CAR, CAR_NIGHT)
    assert _reconnects(hass) == {CAR: {"at": "2026-09-27T09:22:29.310481+00:00",
                                       "last_changed": "2026-09-27T01:34:24.667573+00:00"}}


def test_back_in_a_different_state_is_a_real_change():
    """unavailable -> on after an "off": that is motion, dated to the return."""
    hass = _hass()
    _feed(hass, CAR, CAR_NIGHT[:3] + [("on", "2026-09-27T09:22:29.310481+00:00")])
    assert _reconnects(hass) == {}


def test_a_real_change_after_the_return_drops_it_and_repeated_blips_keep_the_first():
    hass = _hass()
    last = _feed(hass, CAR, CAR_NIGHT + [("unknown", "2026-09-27T10:00:00+00:00"),
                                         ("unavailable", "2026-09-27T10:00:01+00:00"),
                                         ("off", "2026-09-27T10:00:05+00:00")])
    assert _reconnects(hass)[CAR] == {"at": "2026-09-27T10:00:05+00:00", "last_changed": "2026-09-27T01:34:24.667573+00:00"}
    # An attribute-only update keeps it; the next real motion drops it.
    MR._on_state_changed(hass, SimpleNamespace(data={"entity_id": CAR, "old_state": last, "new_state": last}))
    assert CAR in _reconnects(hass)
    _feed(hass, CAR, [("on", "2026-09-27T17:33:19.732862+00:00")], old=last)
    assert _reconnects(hass) == {}


def test_only_motion_classes_and_a_removed_entity_leaves_nothing():
    hass = _hass()
    _feed(hass, "binary_sensor.front_door", CAR_NIGHT, dc="door")
    assert _reconnects(hass) == {}
    last = _feed(hass, CAR, CAR_NIGHT)
    MR._on_state_changed(hass, SimpleNamespace(data={"entity_id": CAR, "old_state": last, "new_state": None}))
    assert _reconnects(hass) == {}


async def test_the_subscription_sends_the_map_now_and_on_every_change(monkeypatch):
    monkeypatch.setattr(MR.websocket_api, "event_message", lambda i, p: {"id": i, "event": p}, raising=False)
    hass = _hass()
    _feed(hass, DI2, DI2_NIGHT, dc="motion")
    conn = SimpleNamespace(subscriptions={}, send_message=MagicMock(), send_result=MagicMock())
    await MR.ws_motion_reconnects(hass, conn, {"id": 7, "type": "padspan_ha/motion_reconnects"})
    conn.send_result.assert_called_once_with(7)
    assert [c.args[0]["event"] for c in conn.send_message.call_args_list] == [
        {DI2: {"at": "2026-09-27T09:22:22.061116+00:00", "last_changed": "2026-09-27T05:42:28.289297+00:00"}}]
    _feed(hass, CAR, CAR_NIGHT)
    assert set(conn.send_message.call_args.args[0]["event"]) == {DI2, CAR}
    conn.subscriptions[7]()                                  # unsubscribe
    _feed(hass, "binary_sensor.other", CAR_NIGHT)
    assert conn.send_message.call_count == 2


# ── What the Atlas draws ────────────────────────────────────────────────────


def _draw(tmp_path, states, reconnects, now_iso):
    """gatherLights -> buildIsoSVG as the sidebar does it. Each state's
    last_changed is built the way HA's frontend builds it (from the float
    epoch seconds: new Date(lc * 1000).toISOString())."""
    fe = {eid: {"entity_id": eid, "state": s, "attributes": {"device_class": dc, "friendly_name": eid},
                "lc": datetime.datetime.fromisoformat(when).timestamp()}
          for eid, (s, when, dc) in states.items()}
    model = {"room_geometry_m": {"Garage": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [12, 0], [12, 5], [0, 5]]}},
             "light_positions_m": {eid: {"x_m": 2.0 + 3 * i, "y_m": 2.5, "floor_id": "main"} for i, eid in enumerate(fe)}}
    return _run(tmp_path, (
        "const M = await import('./iso_lights.mjs');\n"
        f"const FE = {json.dumps(fe)};\n"
        "const states = Object.fromEntries(Object.entries(FE).map(([e, s]) => [e, { entity_id: e, state: s.state,\n"
        "  attributes: s.attributes, last_changed: new Date(s.lc * 1000).toISOString() }]));\n"
        f"const NOW = Date.parse({json.dumps(now_iso)});\n"
        f"const lights = LM.gatherLights(states, {{}}, {{}}, 'pro', {{}}, {{}}, {{}}, {{}}, NOW, false, {json.dumps(reconnects)});\n"
        "const lbe = Object.fromEntries(lights.map(l => [l.entity_id, l]));\n"
        f"const svg = M.buildIsoSVG({json.dumps(model)}, {{}}, new Set(), null, 150, 0, lbe, false, [{{id:'main',name:'Main',level:0}}],\n"
        f"  {{ nowMs: NOW, haStartedMs: Date.parse({json.dumps(STARTED)}) }});\n"
        "const out = {};\n"
        "for (const e of Object.keys(FE)) {\n"
        "  const q = e.replace(/\\./g, '\\\\.');\n"
        "  const ring = new RegExp('<[^>]*class=\"lrecent\"[^>]*data-eid=\"' + q + '\"[^>]*>|<[^>]*data-eid=\"' + q + '\"[^>]*class=\"lrecent\"[^>]*>').exec(svg);\n"
        "  out[e] = { pulse: new RegExp('class=\"lpulse\" data-eid=\"' + q + '\"').test(svg), ring: ring ? ring[0] : null,\n"
        "             last_changed: lbe[e].last_changed };\n"
        "}\n"
        "console.log(JSON.stringify(out));\n"
    ))


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_09_27_blip_draws_no_pulse_and_no_ring(tmp_path):
    """CarTruckHome's real change was 7.8 h before the blip: nothing to draw,
    a minute after the return and all through the 6 hours after it. alarm_di2's
    was 3.7 h before: it wears exactly the ring it wore before the blip."""
    hass = _hass()
    _feed(hass, CAR, CAR_NIGHT)
    _feed(hass, DI2, DI2_NIGHT, dc="motion")
    rec = json.loads(json.dumps(_reconnects(hass)))
    now_states = {CAR: ("off", CAR_NIGHT[-1][1], "occupancy"), DI2: ("off", DI2_NIGHT[-1][1], "motion")}
    for now, di2_ring in (("2026-09-27T09:23:30+00:00", True), ("2026-09-27T12:00:00+00:00", False)):
        out = _draw(tmp_path, now_states, rec, now)
        assert not out[CAR]["pulse"] and not out[CAR]["ring"], (now, out)
        assert not out[DI2]["pulse"] and bool(out[DI2]["ring"]) == di2_ring, (now, out)
        # As if the blip never happened: the same drawing as the pre-blip state.
        before = _draw(tmp_path, {CAR: ("off", CAR_NIGHT[1][1], "occupancy"), DI2: ("off", DI2_NIGHT[1][1], "motion")}, {}, now)
        assert out[DI2]["ring"] == before[DI2]["ring"] and out[CAR]["ring"] == before[CAR]["ring"], (now, out, before)


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_real_motion_still_pulses(tmp_path):
    """off -> on, the next real motion after a blip (its on and its off), and
    a return in a different state (unavailable -> on) all pulse; an entry the
    panel still holds from before a real change never masks it."""
    hass = _hass()
    last = _feed(hass, CAR, CAR_NIGHT)
    stale = json.loads(json.dumps(_reconnects(hass)))       # the push may trail the state
    _feed(hass, CAR, [("on", "2026-09-27T17:33:19.732862+00:00"), ("off", "2026-09-27T17:35:12.740069+00:00")], old=last)
    _feed(hass, DI2, DI2_NIGHT[:3] + [("on", "2026-09-27T09:22:22.061116+00:00")], dc="motion")
    rec = json.loads(json.dumps(_reconnects(hass)))
    assert rec == {}
    on = _draw(tmp_path, {CAR: ("on", "2026-09-27T17:33:19.732862+00:00", "occupancy")}, rec, "2026-09-27T17:33:30+00:00")
    back_on = _draw(tmp_path, {DI2: ("on", "2026-09-27T09:22:22.061116+00:00", "motion")}, rec, "2026-09-27T09:22:30+00:00")
    assert on[CAR]["pulse"] and back_on[DI2]["pulse"], (on, back_on)
    off = _draw(tmp_path, {CAR: ("off", "2026-09-27T17:35:12.740069+00:00", "occupancy")}, stale, "2026-09-27T17:36:00+00:00")
    assert off[CAR]["pulse"] and off[CAR]["last_changed"].startswith("2026-09-27T17:35:12"), off


def test_both_hosts_subscribe_and_hand_it_to_the_pipeline():
    """The sidebar's wiring runs for real in tests/js/lights_panel_lifecycle.mjs;
    the Mapping tab's host is panel.js + maps.js."""
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert 'type: "padspan_ha/motion_reconnects"' in panel and "this.state._motionReconnects = m" in panel
    assert "undefined, false, ctx.state._motionReconnects)" in maps
