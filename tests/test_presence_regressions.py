# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Presence bugs introduced by the 0.38.110-0.38.117 fixes, found by a
review of those fixes (2026-10-12)."""

from __future__ import annotations

import asyncio

from tests.test_follow_arrive_depart_alerts import _make_coordinator
from tests.test_poll_level import ble_object, make_coordinator, run_poll, snapshot


def _rec(coord):
    seen = []

    async def _r(arrived, departed, result, now, members=None):
        seen.append((sorted(arrived), sorted(departed), {k: sorted(v) for k, v in (members or {}).items()}))
    coord._run_automations = _r
    return seen


_IB = {"key": "ibeacon:UUID:1:2", "kind": "ibeacon", "address": "AA:AA:AA:AA:AA:01", "user_label": "Pixel"}
_IRK = {"key": "irk:abc", "kind": "private_ble", "address": "5A:AA:AA:AA:AA:02",
        "canonical_id": "irk:abc", "user_label": "Pixel"}


def test_a_phone_on_two_keys_is_one_device_for_arrive_and_depart():
    """Per key, the phone "left" when its iBeacon went quiet while its IRK
    was still heard: depart alert and depart rules with the phone home."""
    coord = make_coordinator()
    seen = _rec(coord)
    run_poll(coord, snapshot([dict(_IB, age_s=1.0), dict(_IRK, age_s=1.0)]))      # baseline
    run_poll(coord, snapshot([dict(_IB, age_s=400.0), dict(_IRK, age_s=1.0)]))    # one key quiet
    assert seen == []
    run_poll(coord, snapshot([dict(_IB, age_s=410.0), dict(_IRK, age_s=400.0)]))  # both quiet: it left
    assert len(seen) == 1 and len(seen[0][1]) == 1
    rep = seen[0][1][0]
    assert seen[0][2][rep] == ["ibeacon:UUID:1:2", "irk:abc"]   # either key matches rules/alerts


def test_changing_the_away_timeout_is_a_new_baseline():
    """Raised, every device heard within the new timeout "arrived"."""
    coord = make_coordinator({"away_timeout_m": 5})
    seen = _rec(coord)
    k = "ble:AA:BB:CC:DD:EE:01"
    obj = lambda age: ble_object(k, "AA:BB:CC:DD:EE:01", age_s=age, user_label="Keys")
    run_poll(coord, snapshot([obj(1000.0)]))
    run_poll(coord, snapshot([obj(1010.0)]))
    coord.hass.data["padspan_ha"]["settings"].data["away_timeout_m"] = 60
    run_poll(coord, snapshot([obj(1020.0)]))
    assert seen == []


def test_a_short_gap_keeps_the_room_it_left_from():
    """90 s unheard (never away) cleared the confirmed room, so the next room
    was queued with no "from" room and Follow alerts and tag events skipped it."""
    coord = make_coordinator()
    _rec(coord)
    k = "ble:AA:BB:CC:DD:EE:01"
    obj = lambda age: ble_object(k, "AA:BB:CC:DD:EE:01", age_s=age, user_label="Phone")
    run_poll(coord, snapshot([obj(1.0)]))
    coord._confirmed_room[k] = "Kitchen"
    run_poll(coord, snapshot([obj(90.0)]))
    run_poll(coord, snapshot([obj(1.0)]))
    assert coord._room_before_gap.get(k) == "Kitchen"


def test_after_a_real_absence_the_room_is_not_carried():
    """A homecoming starts fresh (BUG_LOG #30): no "from" room."""
    coord = make_coordinator()
    _rec(coord)
    k = "ble:AA:BB:CC:DD:EE:01"
    obj = lambda age: ble_object(k, "AA:BB:CC:DD:EE:01", age_s=age, user_label="Phone")
    run_poll(coord, snapshot([obj(1.0)]))
    coord._confirmed_room[k] = "Kitchen"
    run_poll(coord, snapshot([obj(400.0)]))       # away
    run_poll(coord, snapshot([obj(1.0)]))
    assert k not in coord._room_before_gap


KEY = "ble:AA:BB:CC:DD:EE:FF"
CFG = {"AA:BB:CC:DD:EE:FF": {"on_room_change": True, "notify_service": "notify.mobile_app_phone"}}
RES = {KEY: {"user_label": "Phone", "address": "AA:BB:CC:DD:EE:FF", "room": "Bedroom"}}


def _msgs(coord):
    return [c.args[2]["message"] for c in coord.hass.services.async_call.call_args_list]


def test_a_room_alert_inside_the_cooldown_is_sent_when_it_ends():
    """Kitchen -> Hall -> Bedroom 20 s apart reported Hall and never Bedroom."""
    coord = _make_coordinator(CFG)
    coord.hass.services.async_services.return_value = {"notify": {"mobile_app_phone": True}}
    asyncio.run(coord._process_room_alerts(1000.0, RES, [(KEY, "Kitchen", "Hall")]))
    asyncio.run(coord._process_room_alerts(1020.0, RES, [(KEY, "Hall", "Bedroom")]))
    asyncio.run(coord._flush_held_room_alerts(1030.0, RES))      # still inside the cooldown
    asyncio.run(coord._flush_held_room_alerts(1070.0, RES))
    assert _msgs(coord) == ["Phone moved from Kitchen to Hall", "Phone moved from Hall to Bedroom"]


def test_a_missing_saved_target_is_not_replaced_by_another():
    """A renamed or removed phone's alerts went to whichever notify target
    the auto-pick found first."""
    coord = _make_coordinator({"AA:BB:CC:DD:EE:FF": {"on_room_change": True,
                                                     "notify_service": "notify.mobile_app_old"}})
    coord.hass.services.async_services.return_value = {"notify": {"send_message": True,
                                                                  "mobile_app_wifes_phone": True}}
    asyncio.run(coord._process_room_alerts(1000.0, RES, [(KEY, "Kitchen", "Hall")]))
    assert coord.hass.services.async_call.call_count == 0


def test_naming_a_device_that_is_home_is_not_a_departure_and_arrival():
    """Groups are keyed by label, so naming or renaming a present device, or
    the wizard naming its second key, looked like one device leaving and
    another arriving: depart rules turned lights off with the phone home."""
    coord = make_coordinator()
    seen = _rec(coord)
    k = "ble:AA:BB:CC:DD:EE:01"
    run_poll(coord, snapshot([ble_object(k, "AA:BB:CC:DD:EE:01", age_s=1.0)]))
    run_poll(coord, snapshot([ble_object(k, "AA:BB:CC:DD:EE:01", age_s=1.0, user_label="Keys")]))
    run_poll(coord, snapshot([ble_object(k, "AA:BB:CC:DD:EE:01", age_s=1.0, user_label="Car keys")]))
    assert seen == []
    # The wizard: the iBeacon is home as "Pixel", then the IRK is named too.
    coord2 = make_coordinator()
    seen2 = _rec(coord2)
    irk_unnamed = {k2: v for k2, v in _IRK.items() if k2 != "user_label"}
    run_poll(coord2, snapshot([dict(_IB, age_s=1.0), dict(irk_unnamed, age_s=1.0)]))
    run_poll(coord2, snapshot([dict(_IB, age_s=1.0), dict(_IRK, age_s=1.0)]))
    assert seen2 == []


def test_a_target_from_another_integration_is_called_directly():
    """The picker offers <domain>.send_message targets (telegram_bot); with
    no fallback any more they never sent."""
    coord = _make_coordinator({"AA:BB:CC:DD:EE:FF": {"on_room_change": True,
                                                     "notify_service": "telegram_bot.send_message"}})
    coord.hass.services.has_service = lambda d, s: (d, s) == ("telegram_bot", "send_message")
    asyncio.run(coord._process_room_alerts(1000.0, RES, [(KEY, "Kitchen", "Hall")]))
    calls = [(c.args[0], c.args[1]) for c in coord.hass.services.async_call.call_args_list]
    assert calls == [("telegram_bot", "send_message")]
