"""Warnings the opt-in reports counted in the field (2026-10-29).

  1. WARNING:__init__, one line per home: a config-entry reload (saving the
     options, Reload) clears the "panel registered" flag but leaves the panel
     registered, so the re-register raised "Overwriting panel padspan-ha"
     and logged "Panel re-registration failed". panel.py now asks Home
     Assistant's own panel list what to remove.
  2. WARNING:ws_calibration: a point refused because its map has no metre
     scale is told to the user in the panel; the log no longer repeats it.
  3. WARNING:ws_companion: one phone with a Major/Minor that is not a number
     failed the whole phone search.
  4. WARNING:device_registry: the identity guard refusing a key another
     device owns is the guard working; debug, counted.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import panel
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_PANEL_REGISTERED, DOMAIN


def _fake_frontend(monkeypatch, hass) -> list[str]:
    """Home Assistant's panel rules: registering a path it has raises, and
    removing one it does not have logs a warning."""
    panels: dict = hass.data.setdefault("frontend_panels", {})
    unknown: list[str] = []

    def _register(**kw):
        path = kw["frontend_url_path"]
        if path in panels:
            raise ValueError(f"Overwriting panel {path} owned by custom")
        panels[path] = kw

    def _remove(_hass, path, **_kw):
        if panels.pop(path, None) is None:
            unknown.append(path)

    pc = ModuleType("homeassistant.components.panel_custom")
    pc.async_register_panel = _register
    fe = ModuleType("homeassistant.components.frontend")
    fe.async_remove_panel = _remove
    for name, mod in (("panel_custom", pc), ("frontend", fe)):
        monkeypatch.setitem(sys.modules, f"homeassistant.components.{name}", mod)
        monkeypatch.setattr(sys.modules["homeassistant.components"], name, mod, raising=False)
    return unknown


async def test_a_config_entry_reload_re_registers_the_panel(monkeypatch) -> None:
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    unknown = _fake_frontend(monkeypatch, hass)
    monkeypatch.setattr(panel, "_register_static", AsyncMock(return_value=None))
    monkeypatch.setattr(panel, "edition", lambda: "full")

    await panel.async_setup_panel(hass)                # async_setup at boot
    await panel.async_setup_panel(hass)                # async_setup_entry right after
    hass.data[DOMAIN].pop(DATA_PANEL_REGISTERED, None)  # async_unload_entry (reload)
    await panel.async_setup_panel(hass)                # async_setup_entry again: raised before

    assert "padspan-ha" in hass.data["frontend_panels"]
    assert hass.data[DOMAIN][DATA_PANEL_REGISTERED] is True
    assert unknown == [], f"removed panels Home Assistant did not have: {unknown}"


def test_a_refused_calibration_point_is_not_a_warning(monkeypatch, caplog) -> None:
    from custom_components.padspan_ha import ws_calibration as W
    from custom_components.padspan_ha.calibration_store import NoScaleError

    bumped: list[str] = []
    monkeypatch.setattr(W, "_bump", lambda _h, ev: bumped.append(ev))

    def _run(err):
        cal = SimpleNamespace(async_add_point=AsyncMock(side_effect=err))
        monkeypatch.setattr(W, "_get_cal_store", AsyncMock(return_value=cal))
        conn = MagicMock()
        fn = getattr(W.ws_calibration_save_point, "__wrapped__", W.ws_calibration_save_point)
        while hasattr(fn, "__wrapped__"):
            fn = fn.__wrapped__
        res = fn(MagicMock(), conn, {"id": 1, "point": {}})
        if asyncio.iscoroutine(res):
            asyncio.run(res)
        return conn

    caplog.set_level(logging.DEBUG, logger="custom_components.padspan_ha")
    conn = _run(NoScaleError("no metre scale"))
    conn.send_error.assert_called_once()
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
    caplog.clear()
    _run(RuntimeError("disk full"))
    assert [r for r in caplog.records if r.levelno >= logging.WARNING], "a real failure must still warn"
    assert bumped == ["calibration_save_refused_no_scale", "calibration_save_failed_other"]


def test_the_new_counters_are_on_the_closed_list() -> None:
    for ev in ("companion_ids_unreadable", "device_identity_refused"):
        assert T.event_allowed(ev), ev


async def test_the_identity_guard_is_debug_and_counted(monkeypatch, caplog) -> None:
    from custom_components.padspan_ha import device_registry as D
    bumped: list[str] = []
    monkeypatch.setattr(T, "bump", lambda _h, ev, n=1: bumped.append(ev) or True)
    reg = D.DeviceRegistry.__new__(D.DeviceRegistry)
    reg.hass = MagicMock()
    reg._devices = {"p1": {"identities": []}, "p2": {"identities": []}}
    monkeypatch.setattr(reg, "resolve", lambda v: "p2", raising=False)
    caplog.set_level(logging.DEBUG, logger="custom_components.padspan_ha")
    await reg.async_add_identity("p1", "mac", "AA:BB:CC:DD:EE:FF")
    assert reg._devices["p1"]["identities"] == []
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert bumped == ["device_identity_refused"]


@pytest.mark.parametrize("bad", [None, "", "unknown"])
async def test_one_phone_with_odd_major_minor_does_not_fail_the_search(monkeypatch, bad) -> None:
    from homeassistant.helpers import device_registry as dr_mod, entity_registry as er_mod
    from custom_components.padspan_ha import ws_companion as WC
    bumped: list[str] = []
    monkeypatch.setattr(T, "bump", lambda _h, ev, n=1: bumped.append(ev) or True)
    eid = "sensor.pixel_ble_transmitter"
    dev = SimpleNamespace(id="dev1", name="Pixel", name_by_user=None, model="Pixel 8",
                          manufacturer="Google", identifiers={("mobile_app", "8f2c")}, connections=set())
    ent = SimpleNamespace(entity_id=eid, platform="mobile_app", device_id="dev1", disabled_by=None,
                          original_name="BLE Transmitter", name=None)
    er = SimpleNamespace(entities={eid: ent}, async_get=lambda e: ent if e == eid else None)
    drg = SimpleNamespace(devices={"dev1": dev}, async_get=lambda i: dev if i == "dev1" else None)
    monkeypatch.setattr(er_mod, "async_get", lambda h: er, raising=False)
    monkeypatch.setattr(dr_mod, "async_get", lambda h: drg, raising=False)
    st = SimpleNamespace(entity_id=eid, state="Stopped",
                         attributes={"UUID": "e2c56db5-dffb-48d2-b060-d0f5a71096e0", "Major": bad, "Minor": bad})
    # a second phone that reads fine is still listed
    eid2 = "sensor.iphone_ble_transmitter"
    dev2 = SimpleNamespace(id="dev2", name="iPhone", name_by_user=None, model="iPhone 15",
                           manufacturer="Apple", identifiers={("mobile_app", "9a1b")}, connections=set())
    ent2 = SimpleNamespace(entity_id=eid2, platform="mobile_app", device_id="dev2", disabled_by=None,
                           original_name="BLE Transmitter", name=None)
    er.entities[eid2] = ent2
    er.async_get = lambda e: {eid: ent, eid2: ent2}.get(e)
    drg.devices["dev2"] = dev2
    drg.async_get = lambda i: {"dev1": dev, "dev2": dev2}.get(i)
    st2 = SimpleNamespace(entity_id=eid2, state="Transmitting",
                          attributes={"UUID": "f7826da6-4fa2-4e98-8024-bc5b71e0893e", "Major": 100, "Minor": 40004})
    hass = MagicMock()
    hass.data = {}
    hass.states.get = lambda e: {eid: st, eid2: st2}.get(e)
    hass.states.async_all = lambda *a: [st, st2]
    hass.services.async_services.return_value = {"notify": {"mobile_app_pixel": True}}
    conn = MagicMock()
    await WC.ws_companion_discover(hass, conn, {"id": 1})
    out = conn.send_result.call_args.args[1]
    assert "error" not in out, out.get("error")
    # the odd phone is listed without a key to follow (a 0:0 key would never
    # match its adverts), as a phone whose sensor PadSpan can't use
    assert [p["device_name"] for p in out["phones"]] == ["iPhone", "Pixel"]
    assert out["phones"][0]["ibeacon_key"] == "ibeacon:f7826da6-4fa2-4e98-8024-bc5b71e0893e:100:40004"
    assert out["phones"][1]["ibeacon_key"] == ""
    assert out["phones"][1]["state"] == "sensor_not_registered"
    assert bumped == ["companion_ids_unreadable"]
