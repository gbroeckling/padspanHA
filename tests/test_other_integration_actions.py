"""The user-pressed actions that reach another integration's objects
(tests/test_never_touches_others.py, OTHER): the deletes stay admin-only and
are confirmed twice by name, and Track a phone can only ever turn on a
phone's BLE Transmitter sensor."""
from __future__ import annotations

import inspect
import pathlib
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_companion as WC
from custom_components.padspan_ha import ws_follow as WF
from custom_components.padspan_ha import ws_radios as WR
from custom_components.padspan_ha.const import DOMAIN

_VIEWS = pathlib.Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def _decorators(mod, name):
    src = inspect.getsource(mod)
    i = src.index(f"async def {name}(")
    return src[src.rindex("@websocket_api.websocket_command", 0, i):i]


# ── Deletes: admin only, and they still work for an admin ────────────────────

def test_entity_and_area_delete_require_admin():
    assert "@websocket_api.require_admin" in _decorators(WF, "ws_entity_delete")
    assert "@websocket_api.require_admin" in _decorators(WF, "ws_area_delete")


@pytest.mark.asyncio
async def test_admin_entity_delete_still_removes_the_entity(monkeypatch):
    reg = MagicMock()
    reg.async_get.return_value = SimpleNamespace(entity_id="sensor.x", platform="bermuda")
    monkeypatch.setattr(WF.entity_registry, "async_get", lambda h: reg)
    conn = MagicMock()
    await WF.ws_entity_delete(MagicMock(), conn, {"id": 1, "entity_id": "sensor.x"})
    reg.async_remove.assert_called_once_with("sensor.x")
    conn.send_result.assert_called_once_with(1, {"deleted": "sensor.x"})


@pytest.mark.asyncio
async def test_admin_area_delete_still_deletes_the_area(monkeypatch):
    reg = MagicMock()
    reg.async_get_area.return_value = SimpleNamespace(id="kitchen", name="Kitchen")
    monkeypatch.setattr(WF.area_registry, "async_get", lambda h: reg)
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    conn = MagicMock()
    await WF.ws_area_delete(hass, conn, {"id": 2, "area_id": "kitchen"})
    reg.async_delete.assert_called_once_with("kitchen")
    conn.send_result.assert_called_once_with(2, {"deleted": "kitchen", "name": "Kitchen"})


def test_manage_deletes_confirm_twice_naming_the_object_and_its_owner():
    m = (_VIEWS / "manage.js").read_text(encoding="utf-8")
    # Entity: the owner comes from HA's registry (hass.entities[...].platform);
    # PadSpan's own entities keep the inline Yes, delete.
    assert "ctx.hass.entities[o.entity_id]" in m and 'if(platform !== "padspan_ha"){' in m
    assert "if(!confirm(`Delete ${o.entity_id}? ${owner}; deleting it removes it from Home Assistant.`)) return;" in m
    assert "`It belongs to ${" in m and ", not PadSpan`" in m
    assert "if(!confirm(`Are you sure? ${o.entity_id} will be deleted from Home Assistant." in m
    # Area: both confirms name it, before the delete is sent.
    a = m.index('if(!confirm(`Delete the area "${area.name}"?')
    b = m.index('if(!confirm(`Are you sure? "${area.name}" will be deleted from Home Assistant.`)) return;')
    assert a < b < m.index("await ctx.actions.areaDelete(area.id);")


def test_radio_area_set_is_left_open_to_the_overview_any_user_sees():
    # Overview > View radios list > Assign has no admin gate; a require_admin
    # here would break it for household members (reported, not changed).
    assert "require_admin" not in _decorators(WR, "ws_radio_area_set")


# ── Track a phone: only a phone's BLE Transmitter sensor ─────────────────────

def _follow_hass(monkeypatch, entry):
    reg = MagicMock()
    reg.async_get.return_value = entry
    import homeassistant.helpers.entity_registry as er_mod
    import homeassistant.helpers as helpers
    monkeypatch.setattr(er_mod, "async_get", lambda h: reg, raising=False)
    monkeypatch.setattr(helpers, "entity_registry", er_mod, raising=False)
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    return hass, reg


def _entry(entity_id, platform, disabled=True):
    return SimpleNamespace(entity_id=entity_id, platform=platform,
                           disabled_by="user" if disabled else None, device_id=None)


@pytest.mark.asyncio
async def test_track_a_phone_still_enables_its_ble_transmitter(monkeypatch):
    eid = "sensor.pixel_8_ble_transmitter"
    hass, reg = _follow_hass(monkeypatch, _entry(eid, "mobile_app"))
    conn = MagicMock()
    await WC.ws_companion_follow(hass, conn, {"id": 1, "ibeacon_key": "ibeacon:x:1:2",
                                              "device_name": "Pixel", "entity_id": eid})
    reg.async_update_entity.assert_called_once_with(eid, disabled_by=None)
    assert conn.send_result.call_args.args[1]["transmitter_enabled"] is True
    conn.send_error.assert_not_called()


@pytest.mark.parametrize("eid,platform", [
    ("sensor.pixel_8_ble_transmitter", "bermuda"),          # right name, other integration
    ("sensor.pixel_8_battery_level", "mobile_app"),         # the phone's other sensors
    ("device_tracker.pixel_8", "mobile_app"),
    ("switch.ble_transmitter_lookalike", "mobile_app"),     # not a sensor
])
@pytest.mark.asyncio
async def test_track_a_phone_refuses_any_other_entity(monkeypatch, eid, platform):
    hass, reg = _follow_hass(monkeypatch, _entry(eid, platform))
    conn = MagicMock()
    await WC.ws_companion_follow(hass, conn, {"id": 3, "ibeacon_key": "ibeacon:x:1:2",
                                              "device_name": "Pixel", "entity_id": eid})
    reg.async_update_entity.assert_not_called()
    conn.send_result.assert_not_called()
    code, text = conn.send_error.call_args.args[1:3]
    assert code == "not_ble_transmitter" and eid in text


@pytest.mark.asyncio
async def test_track_a_phone_without_an_entity_still_follows(monkeypatch):
    hass, reg = _follow_hass(monkeypatch, None)
    conn = MagicMock()
    await WC.ws_companion_follow(hass, conn, {"id": 4, "ibeacon_key": "ibeacon:x:1:2", "device_name": "Pixel"})
    reg.async_update_entity.assert_not_called()
    assert conn.send_result.call_args.args[1]["ok"] is True


def test_track_a_phone_still_open_to_any_user():
    assert "require_admin" not in _decorators(WC, "ws_companion_follow")
