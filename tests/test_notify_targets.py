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


@pytest.mark.asyncio
async def test_an_entity_target_with_an_email_too_gets_no_target_key():
    """notify.send_message takes the message, title and entity only: with the
    email filled in as well, `target` was added and HA refused every alert
    ("extra keys not allowed @ data['target']")."""
    def _calls(hass):
        return [(c.args[0], c.args[1], sorted(c.args[2])) for c in hass.services.async_call.call_args_list]
    want = [("notify", "send_message", ["entity_id", "message", "title"])]
    coord = _with_send_message(_make_coordinator({ADDR: {
        "on_arrive": True, "email": "me@example.com", "notify_service": "notify.smtp_home"}}), ["notify.smtp_home"])
    await coord._run_automations({f"ble:{ADDR}"}, set(), RESULT, now=1000.0)
    assert _calls(coord.hass) == want
    hass = _ws_hass(["notify.smtp_home"])
    await ws_notify.ws_notify_test(hass, MagicMock(), {"id": 1, "service": "notify.smtp_home", "email": "me@example.com"})
    assert _calls(hass) == want


# ── The Test button sends the way an alert does (one dispatch) ───────────────
# It fell back to auto-pick for any choice that was not a notify entity or
# legacy service: a renamed phone's Test went to the first notify service and
# said "Test sent", while every alert to it was refused; and a
# telegram_bot.send_message target was never tried.

@pytest.mark.asyncio
async def test_the_test_button_fails_for_a_saved_phone_that_is_gone():
    calls, conn = await _test_button("notify.mobile_app_old_phone")
    assert calls == []
    conn.send_result.assert_not_called()
    assert conn.send_error.call_args.args[1] == "not_found"
    assert "notify.mobile_app_old_phone" in conn.send_error.call_args.args[2]


def _telegram(hass, notify=None):
    if notify is not None:
        hass.services.async_services.return_value = {"notify": notify}
    hass.services.has_service = lambda d, s: (d, s) == ("telegram_bot", "send_message")
    return hass


@pytest.mark.asyncio
@pytest.mark.parametrize("notify", [{"send_message": True, "mobile_app_phone": True}, {}])
async def test_the_test_button_calls_another_integrations_target(notify):
    hass = _telegram(_ws_hass(), notify)
    conn = MagicMock()
    await ws_notify.ws_notify_test(hass, conn, {"id": 1, "service": "telegram_bot.send_message"})
    assert [c.args[:2] for c in hass.services.async_call.call_args_list] == [("telegram_bot", "send_message")]
    assert conn.send_result.call_args.args[1]["service"] == "telegram_bot.send_message"


@pytest.mark.asyncio
async def test_an_alert_to_another_integration_needs_no_notify_service():
    coord = _make_coordinator({ADDR: {"on_arrive": True, "notify_service": "telegram_bot.send_message"}})
    _telegram(coord.hass, {})
    coord.hass.states.async_all.return_value = []
    await coord._run_automations({f"ble:{ADDR}"}, set(), RESULT, now=1000.0)
    assert [c.args[:2] for c in coord.hass.services.async_call.call_args_list] == [("telegram_bot", "send_message")]


@pytest.mark.asyncio
async def test_the_test_button_with_nothing_chosen_auto_picks_as_alerts_do():
    calls, conn = await _test_button("")
    assert calls == [("notify", "mobile_app_phone")]
    assert conn.send_result.call_args.args[1]["ok"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["notify.mobile_app_phone", "mobile_app_phone", "notify.smtp_home",
                                    "notify.mobile_app_old_phone", "telegram_bot.send_message", ""])
async def test_the_test_button_reaches_exactly_what_an_alert_reaches(target):
    def _targets(hass):
        return [(c.args[0], c.args[1], c.args[2].get("entity_id")) for c in hass.services.async_call.call_args_list]
    coord = _with_send_message(_make_coordinator({ADDR: {"on_arrive": True, "notify_service": target}}),
                               ["notify.smtp_home"])
    _telegram(coord.hass)
    await coord._run_automations({f"ble:{ADDR}"}, set(), RESULT, now=1000.0)
    hass = _telegram(_ws_hass(["notify.smtp_home"]))
    await ws_notify.ws_notify_test(hass, MagicMock(), {"id": 1, "service": target})
    assert _targets(hass) == _targets(coord.hass)


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


# ── The opt-in report's counters for these paths ──────────────────────────────

def _counting(monkeypatch):
    from custom_components.padspan_ha import telemetry as T
    seen = []
    monkeypatch.setattr(T, "bump", lambda hass, name, n=1: seen.append(name) or True)
    return seen


@pytest.mark.asyncio
async def test_alerts_and_tagged_arrivals_are_counted(monkeypatch):
    seen = _counting(monkeypatch)
    await _arrive("notify.mobile_app_phone")
    assert sorted(seen) == ["follow_alert_sent", "tagged_arrived"]


@pytest.mark.asyncio
async def test_an_alert_with_nowhere_to_go_is_counted_failed(monkeypatch):
    seen = _counting(monkeypatch)
    coord = _make_coordinator({ADDR: {"on_arrive": True, "notify_service": "notify.mobile_app_phone"}})
    coord.hass.services.async_services.return_value = {"notify": {"mobile_app_phone": True}}
    coord.hass.services.async_call = AsyncMock(side_effect=RuntimeError("service down"))
    await coord._run_automations({f"ble:{ADDR}"}, set(), RESULT, now=1000.0)
    assert "follow_alert_failed" in seen and "follow_alert_sent" not in seen


@pytest.mark.asyncio
async def test_the_wizard_counts_a_phone_it_cannot_reach(monkeypatch):
    seen = _counting(monkeypatch)
    assert mobile_app_notify_service(_phone_hass("mobile_app_other"), _device("Pixel")) is None
    # the count itself is bumped by ws_companion_follow around this lookup
    import inspect
    from custom_components.padspan_ha import ws_companion as WC
    src = inspect.getsource(WC.ws_companion_follow)
    assert 'bump(hass, "companion_tx_no_service")' in src and 'bump(hass, "companion_tx_sent")' in src


@pytest.mark.asyncio
async def test_room_change_alerts_are_throttled_per_device():
    """The cooldown was read under the bare key but written under
    "<key>:room", so a tag flapping between two rooms alerted every flip."""
    coord = _with_send_message(_make_coordinator({
        ADDR: {"on_room_change": True, "notify_service": "notify.mobile_app_phone"}}))
    for t, (a, b) in ((1000.0, ("Hall", "Kitchen")), (1005.0, ("Kitchen", "Hall")), (1010.0, ("Hall", "Kitchen"))):
        coord._pending_room_changes = [(f"ble:{ADDR}", a, b)]
        await coord._process_room_alerts(t, RESULT)
    assert coord.hass.services.async_call.await_count == 1
    coord._pending_room_changes = [(f"ble:{ADDR}", "Kitchen", "Hall")]
    await coord._process_room_alerts(1061.0, RESULT)       # cooldown over
    assert coord.hass.services.async_call.await_count == 2


@pytest.mark.asyncio
async def test_a_first_confirmation_after_restart_is_not_a_move():
    """Every restart sent "moved from unknown to Kitchen" per followed device."""
    coord = _with_send_message(_make_coordinator({
        ADDR: {"on_room_change": True, "notify_service": "notify.mobile_app_phone"}}))
    coord._pending_room_changes = [(f"ble:{ADDR}", None, "Kitchen")]
    await coord._process_room_alerts(1000.0, RESULT)
    coord.hass.services.async_call.assert_not_awaited()


# ── Companion unfollow ────────────────────────────────────────────────────────

def test_the_overview_unfollow_call_passes_the_schema():
    """Overview sends {ibeacon_key, device_name}; the schema refused the extra key."""
    import voluptuous as vol
    from custom_components.padspan_ha import ws_companion as WC
    import inspect
    src = inspect.getsource(WC)
    i = src.index('"type": "padspan_ha/companion_unfollow"')
    assert 'vol.Optional("device_name")' in src[i:i + 500]


@pytest.mark.asyncio
async def test_unfollow_removes_the_irk_identity_label_too(monkeypatch):
    from custom_components.padspan_ha import ws_companion as WC
    from custom_components.padspan_ha.const import DATA_OBJECTS, DATA_SETTINGS, DOMAIN

    class _Store:
        def __init__(self, d):
            self.d = {k.upper(): v for k, v in d.items()}

        def get(self, k):
            return self.d.get(str(k).upper())

        def all(self):
            return dict(self.d)

        async def async_delete(self, k):
            self.d.pop(str(k).upper(), None)

    key = "ibeacon:e2c56db5-dffb-48d2-b060-d0f5a71096e0:100:1"
    store = _Store({key: {"label": "Garry's Pixel"}, "irk:aabb": {"label": "Garry's Pixel"},
                    "irk:ccdd": {"label": "Someone Else"}})
    st = SimpleNamespace(data={"followed_addrs": [key.upper()]}, async_set=AsyncMock())
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_OBJECTS: store, DATA_SETTINGS: st}}

    async def _no_resolver(h):
        raise RuntimeError("phone not on the air")
    monkeypatch.setattr(WC, "_get_ble_resolver", _no_resolver)
    conn = MagicMock()
    await WC.ws_companion_unfollow(hass, conn, {"id": 1, "ibeacon_key": key, "device_name": "Garry's Pixel"})
    assert set(store.d) == {"IRK:CCDD"}
    assert "IRK identity label removed" in conn.send_result.call_args.args[1]["actions"]


@pytest.mark.asyncio
async def test_an_irk_phone_keeps_its_alerts_after_its_address_rotates():
    """Follow saved the config under the phone's address of the moment; the
    phone rotates (~15 min) and lookups by key / current address found none."""
    old, new = "5A:11:22:33:44:55", "6B:99:88:77:66:55"
    coord = _with_send_message(_make_coordinator({
        old: {"on_room_change": True, "notify_service": "notify.mobile_app_phone"}}))
    result = {"irk:abc": {"user_label": "Phone", "kind": "private_ble", "address": new,
                          "all_addresses": [new, old], "room": "Kitchen"}}
    coord._pending_room_changes = [("irk:abc", "Hall", "Kitchen")]
    await coord._process_room_alerts(1000.0, result)
    assert [c.args[:2] for c in coord.hass.services.async_call.call_args_list] == [("notify", "mobile_app_phone")]
