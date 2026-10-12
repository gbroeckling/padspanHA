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


@pytest.mark.asyncio
async def test_a_phone_with_an_apostrophe_is_listed_once(monkeypatch):
    """discover lists phones by their BLE Transmitter sensor, then adds any
    mobile_app_<slug> notify service not already listed. "Garry's Pixel 8"
    -> mobile_app_garry_s_pixel_8 never matched a lowercase compare, so the
    phone showed twice, once as "sensor not registered"."""
    from homeassistant.helpers import device_registry as dr_mod, entity_registry as er_mod
    from custom_components.padspan_ha import ws_companion as WC
    eid = "sensor.garry_s_pixel_8_ble_transmitter"
    dev = SimpleNamespace(id="dev1", name="Garry's Pixel 8", name_by_user=None, model="Pixel 8",
                          manufacturer="Google", identifiers={("mobile_app", "8f2c1e0b")}, connections=set())
    ent = SimpleNamespace(entity_id=eid, platform="mobile_app", device_id="dev1", disabled_by=None,
                          original_name="BLE Transmitter", name=None)
    er = SimpleNamespace(entities={eid: ent}, async_get=lambda e: ent if e == eid else None)
    drg = SimpleNamespace(devices={"dev1": dev}, async_get=lambda i: dev if i == "dev1" else None)
    monkeypatch.setattr(er_mod, "async_get", lambda h: er, raising=False)
    monkeypatch.setattr(dr_mod, "async_get", lambda h: drg, raising=False)
    st = SimpleNamespace(entity_id=eid, state="Transmitting",
                         attributes={"id": "e2c56db5-dffb-48d2-b060-d0f5a71096e0-100-1", "UUID": "e2c56db5-dffb-48d2-b060-d0f5a71096e0",
                                     "Major": 100, "Minor": 1, "friendly_name": "Garry's Pixel 8 BLE Transmitter"})
    hass = MagicMock()
    hass.data = {}
    hass.states.get = lambda e: st if e == eid else None
    hass.states.async_all = lambda *a: [st]
    hass.services.async_services.return_value = {"notify": {"mobile_app_garry_s_pixel_8": True, "send_message": True}}
    conn = MagicMock()
    await WC.ws_companion_discover(hass, conn, {"id": 1})
    phones = conn.send_result.call_args.args[1]["phones"]
    names = [p["device_name"] for p in phones]
    assert len(phones) == 1, names


@pytest.mark.asyncio
async def test_a_phone_only_room_change_alert_is_sent():
    """Follow saves without an email when a phone is picked, and arrive/depart
    never needed one — but room-change alerts skipped any config without an
    email, so a phone-only one was never sent."""
    coord = _with_send_message(_make_coordinator({
        ADDR: {"on_room_change": True, "notify_service": "notify.mobile_app_phone"}}))
    coord._pending_room_changes = [(f"ble:{ADDR}", "Hall", "Kitchen")]
    await coord._process_room_alerts(1000.0, RESULT)
    assert [c.args[:2] for c in coord.hass.services.async_call.call_args_list] == [("notify", "mobile_app_phone")]


@pytest.mark.asyncio
async def test_a_config_with_nowhere_to_send_still_sends_nothing():
    coord = _with_send_message(_make_coordinator({ADDR: {"on_room_change": True}}))
    coord._pending_room_changes = [(f"ble:{ADDR}", "Hall", "Kitchen")]
    await coord._process_room_alerts(1000.0, RESULT)
    coord.hass.services.async_call.assert_not_awaited()
