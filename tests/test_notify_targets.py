# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Which call a chosen notify target gets: alerts and the Test button.

The picker (padspan_ha/notify_services_list) offers "notify.<name>" for
legacy services and notify entities alike, and that is what Follow saves.
Both send paths took any "notify.*" for an ENTITY and sent it through
notify.send_message — but a phone (mobile_app) is a legacy SERVICE, and HA
2024+'s send_message aimed at an entity that does not exist logs and
returns without an error. So an alert to a chosen phone counted as sent and
went nowhere, and the Test button said it worked.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import ws_notify
from tests.test_follow_arrive_depart_alerts import _make_coordinator

ADDR = "AA:BB:CC:DD:EE:FF"
RESULT = {f"ble:{ADDR}": {"user_label": "Keys", "room": "Hall", "address": ADDR}}


def _with_send_message(coord, notify_entities=()):
    coord.hass.services.async_services.return_value = {
        "notify": {"send_message": True, "mobile_app_phone": True}}
    coord.hass.states.async_all.return_value = [SimpleNamespace(entity_id=e) for e in notify_entities]
    return coord


async def _arrive(target, notify_entities=()):
    coord = _with_send_message(_make_coordinator({
        ADDR: {"on_arrive": True, "notify_service": target}}), notify_entities)
    await coord._run_automations({f"ble:{ADDR}"}, set(), RESULT, now=1000.0)
    return [c.args[:2] for c in coord.hass.services.async_call.call_args_list]


@pytest.mark.asyncio
async def test_a_phone_chosen_in_the_picker_gets_the_alert():
    assert await _arrive("notify.mobile_app_phone") == [("notify", "mobile_app_phone")]


@pytest.mark.asyncio
async def test_the_bare_service_name_still_works():
    assert await _arrive("mobile_app_phone") == [("notify", "mobile_app_phone")]


@pytest.mark.asyncio
async def test_a_real_notify_entity_goes_through_send_message():
    calls = await _arrive("notify.smtp_home", notify_entities=["notify.smtp_home"])
    assert calls == [("notify", "send_message")]


def _ws_hass(notify_entities=()):
    hass = MagicMock()
    hass.services.async_services.return_value = {"notify": {"send_message": True, "mobile_app_phone": True}}
    hass.services.async_call = AsyncMock()
    hass.states.async_all.return_value = [SimpleNamespace(entity_id=e) for e in notify_entities]
    return hass


async def _test_button(chosen, notify_entities=()):
    hass = _ws_hass(notify_entities)
    conn = MagicMock()
    await ws_notify.ws_notify_test(hass, conn, {"id": 1, "service": chosen})
    return [c.args[:2] for c in hass.services.async_call.call_args_list], conn


@pytest.mark.asyncio
async def test_the_test_button_sends_to_the_phone_itself():
    calls, conn = await _test_button("notify.mobile_app_phone")
    assert calls == [("notify", "mobile_app_phone")]
    assert conn.send_result.call_args.args[1]["service"] == "mobile_app_phone"


@pytest.mark.asyncio
async def test_the_test_button_uses_send_message_for_a_real_entity():
    calls, _conn = await _test_button("notify.smtp_home", notify_entities=["notify.smtp_home"])
    assert calls == [("notify", "send_message")]


# ── Companion App: the phone's own notify service (BLE Transmitter command) ──

from custom_components.padspan_ha.ws_companion import mobile_app_notify_service  # noqa: E402


def _phone_hass(*services):
    hass = MagicMock()
    hass.services.async_services.return_value = {"notify": {s: True for s in ("send_message",) + services}}
    return hass


def _device(name, ident="8f2c1e0b9a7d4c36", by_user=None):
    return SimpleNamespace(name=name, name_by_user=by_user, identifiers={("mobile_app", ident)})


def test_the_phone_is_found_by_its_name_not_its_device_id():
    hass = _phone_hass("mobile_app_garry_s_pixel_8", "mobile_app_nicoles_iphone")
    assert mobile_app_notify_service(hass, _device("Garry's Pixel 8")) == "mobile_app_garry_s_pixel_8"
    assert mobile_app_notify_service(hass, _device("Nicole's iPhone")) == "mobile_app_nicoles_iphone"


def test_a_service_named_by_the_id_still_wins_if_it_exists():
    hass = _phone_hass("mobile_app_8f2c1e0b9a7d4c36", "mobile_app_pixel")
    assert mobile_app_notify_service(hass, _device("Pixel")) == "mobile_app_8f2c1e0b9a7d4c36"


def test_no_matching_service_is_none_not_a_guess():
    hass = _phone_hass("mobile_app_someone_else")
    assert mobile_app_notify_service(hass, _device("Garry's Pixel 8")) is None
