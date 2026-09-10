# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Arrival/departure Follow alerts.

Garry, 2026-09-10: "do 2-10" (from a missing-features shortlist) — #4: the
_arrived/_departed sets were already computed every poll and already fed
the HA bus events (padspan_device_arrived/departed) and PadSpan automation
rules, but never reached the user-facing notify path on_room_change already
had. Adds on_arrive/on_depart next to it, routed through the SAME dispatch
logic (extracted into _send_follow_notify so room-change and arrive/depart
alerts can never silently disagree about how a notification gets sent).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.alert_store import AlertStore
from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS, DATA_ALERTS, DATA_OBJECTS
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator


def _make_coordinator(
    alert_configs: dict[str, Any] | None = None,
    obj_store_entries: dict[str, Any] | None = None,
) -> PresenceCoordinator:
    hass = MagicMock()
    mock_settings = MagicMock()
    mock_settings.data = {}

    alert_store = AlertStore.__new__(AlertStore)
    alert_store.hass = hass
    alert_store.store = MagicMock()
    alert_store.data = alert_configs or {}

    obj_store = MagicMock()
    obj_store.all.return_value = obj_store_entries or {}

    hass.data = {DOMAIN: {DATA_SETTINGS: mock_settings, DATA_ALERTS: alert_store, DATA_OBJECTS: obj_store}}
    hass.services.async_services.return_value = {"notify": {"mobile_app_phone": True}}
    hass.services.async_call = AsyncMock()
    hass.states.async_all.return_value = []
    hass.bus.async_fire = MagicMock()

    coord = PresenceCoordinator(hass)
    coord._alert_last_sent = {}
    return coord


@pytest.mark.asyncio
async def test_arrive_alert_fires_when_configured_and_labelled():
    coord = _make_coordinator({
        "AA:BB:CC:DD:EE:FF": {"email": "me@example.com", "on_arrive": True, "notify_service": "mobile_app_phone"},
    })
    result = {
        "ble:AA:BB:CC:DD:EE:FF": {"user_label": "Garry's Phone", "room": "Living Room", "address": "AA:BB:CC:DD:EE:FF"},
    }
    await coord._run_automations({"ble:AA:BB:CC:DD:EE:FF"}, set(), result, now=1000.0)
    coord.hass.services.async_call.assert_awaited()
    call = coord.hass.services.async_call.call_args
    assert call.args[0] == "notify"
    assert "arrived" in call.args[2]["message"]
    assert "Garry's Phone" in call.args[2]["message"]


@pytest.mark.asyncio
async def test_depart_alert_fires_when_configured():
    """A departed device is no longer in `result` (that's what departed
    means) — its label has to come from the object store, the same source
    the pre-existing HA-bus-event loop right above this code already reads
    from for exactly this reason."""
    coord = _make_coordinator(
        {"AA:BB:CC:DD:EE:FF": {"email": "me@example.com", "on_depart": True, "notify_service": "mobile_app_phone"}},
        obj_store_entries={"ble:AA:BB:CC:DD:EE:FF": {"label": "Garry's Phone"}},
    )
    result: dict[str, Any] = {}
    coord._known_objs = {"ble:AA:BB:CC:DD:EE:FF": {"user_label": "Garry's Phone", "address": "AA:BB:CC:DD:EE:FF"}}
    await coord._run_automations(set(), {"ble:AA:BB:CC:DD:EE:FF"}, result, now=1000.0)
    coord.hass.services.async_call.assert_awaited()
    assert "left" in coord.hass.services.async_call.call_args.args[2]["message"]


@pytest.mark.asyncio
async def test_no_alert_when_on_arrive_is_not_set():
    coord = _make_coordinator({
        "AA:BB:CC:DD:EE:FF": {"email": "me@example.com", "on_room_change": True},  # on_arrive absent
    })
    result = {"ble:AA:BB:CC:DD:EE:FF": {"user_label": "Garry's Phone", "address": "AA:BB:CC:DD:EE:FF"}}
    await coord._run_automations({"ble:AA:BB:CC:DD:EE:FF"}, set(), result, now=1000.0)
    coord.hass.services.async_call.assert_not_awaited()


@pytest.mark.asyncio
async def test_unlabelled_device_never_fires_an_alert():
    """Matches the existing HA-bus-event precedent right above this code —
    an unlabelled rotating-MAC 'arrival' is noise, not something worth an
    email, even if somehow a config exists for its raw key."""
    coord = _make_coordinator({
        "ble:AA:BB:CC:DD:EE:FF": {"email": "me@example.com", "on_arrive": True},
    })
    result: dict[str, Any] = {"ble:AA:BB:CC:DD:EE:FF": {"address": "AA:BB:CC:DD:EE:FF"}}  # no user_label
    await coord._run_automations({"ble:AA:BB:CC:DD:EE:FF"}, set(), result, now=1000.0)
    coord.hass.services.async_call.assert_not_awaited()


@pytest.mark.asyncio
async def test_arrive_and_room_change_cooldowns_are_independent():
    """A newly-arrived device commonly fires a room-change event in the
    SAME poll — sharing one cooldown key would let the first silently eat
    the second."""
    coord = _make_coordinator({
        "AA:BB:CC:DD:EE:FF": {"email": "me@example.com", "on_arrive": True, "notify_service": "mobile_app_phone"},
    })
    coord._alert_last_sent["ble:AA:BB:CC:DD:EE:FF:room"] = 999.0  # room-change alert JUST sent
    result = {"ble:AA:BB:CC:DD:EE:FF": {"user_label": "Garry's Phone", "room": "Living Room", "address": "AA:BB:CC:DD:EE:FF"}}
    await coord._run_automations({"ble:AA:BB:CC:DD:EE:FF"}, set(), result, now=1000.0)
    coord.hass.services.async_call.assert_awaited()  # arrive alert must still fire


@pytest.mark.asyncio
async def test_repeated_arrival_within_60s_is_throttled():
    coord = _make_coordinator({
        "AA:BB:CC:DD:EE:FF": {"email": "me@example.com", "on_arrive": True, "notify_service": "mobile_app_phone"},
    })
    coord._alert_last_sent["ble:AA:BB:CC:DD:EE:FF:arrive"] = 1000.0
    result = {"ble:AA:BB:CC:DD:EE:FF": {"user_label": "Garry's Phone", "address": "AA:BB:CC:DD:EE:FF"}}
    await coord._run_automations({"ble:AA:BB:CC:DD:EE:FF"}, set(), result, now=1030.0)  # 30s later
    coord.hass.services.async_call.assert_not_awaited()
