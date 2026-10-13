# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Tasmota BLE over MQTT (tasmota_ble.py). Payloads as a tester posted them
from Sonoff Dual R3s running Tasmota (discussion #40)."""

from __future__ import annotations

import datetime as dt
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha.tasmota_ble import TasmotaBle, _mac

_LIST = {"Time": "2026-05-16T11:07:33", "BLEDevices": {
    "total": 2, "4A9EBAAAAAAA": {"i": 0, "r": -87}, "D0C24BBBBBBB": {"i": 1, "n": "Samsung TV", "r": -76}}}
_STATS = {"Time": "2026-05-16T11:08:13", "BLE": {"scans": 7528, "adverts": 3489529, "devices": 2, "resets": 0}}


def _t(s: float = 0) -> dt.datetime:
    return dt.datetime(2026, 10, 13, 12, 0, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=s)


def test_addresses_are_read_from_the_device_list():
    assert _mac("4A9EBAAAAAAA") == "4A:9E:BA:AA:AA:AA"
    assert _mac("total") is None
    tb = TasmotaBle(MagicMock())
    tb.handle("sonoff_kitchen", _LIST, _t())
    assert set(tb._seen) == {"4A:9E:BA:AA:AA:AA", "D0:C2:4B:BB:BB:BB"}
    r = tb._seen["D0:C2:4B:BB:BB:BB"]["tasmota_sonoff_kitchen"]
    assert r.rssi == -76 and r.name == "Samsung TV"


def test_the_snapshot_has_the_scanner_and_its_readings(monkeypatch):
    from custom_components.padspan_ha import tasmota_ble as T
    tb = TasmotaBle(MagicMock())
    tb.handle("sonoff_kitchen", _LIST, _t())
    monkeypatch.setattr(T, "_now", lambda: _t(30))
    snap = tb.get_snapshot(max_age_s=900)
    radio = snap["radios"][0]
    assert radio["source"] == "tasmota_sonoff_kitchen" and radio["scanning"] is True
    assert radio["device_count"] == 2 and radio["name"] == "sonoff_kitchen (Tasmota)"
    ads = {a["address"]: a for a in snap["advertisements"]}
    assert ads["4A:9E:BA:AA:AA:AA"]["rssi"] == -87 and ads["4A:9E:BA:AA:AA:AA"]["age_s"] == 30.0
    assert ads["4A:9E:BA:AA:AA:AA"]["source"] == "tasmota_sonoff_kitchen"


def test_two_devices_hearing_one_address_are_two_readings():
    tb = TasmotaBle(MagicMock())
    tb.handle("sonoff_kitchen", _LIST, _t())
    tb.handle("sonoff_hall", {"BLEDevices": {"4A9EBAAAAAAA": {"i": 0, "r": -60}}}, _t(5))
    assert set(tb._seen["4A:9E:BA:AA:AA:AA"]) == {"tasmota_sonoff_kitchen", "tasmota_sonoff_hall"}


def test_a_list_is_asked_for_after_a_restart_at_most_every_15_minutes(monkeypatch):
    """Tasmota reports its scan counts after a reboot but sends no device
    list until BLEDevices is sent to it."""
    published = []
    mod = types.ModuleType("homeassistant.components.mqtt")

    async def _pub(hass, topic, payload):
        published.append((topic, payload))
    mod.async_publish = _pub
    monkeypatch.setitem(sys.modules, "homeassistant.components.mqtt", mod)
    hass = MagicMock()
    hass.async_create_task = lambda coro: coro.close() or published.append(("task", None))
    tb = TasmotaBle(hass)
    tb.handle("sonoff_kitchen", _STATS, _t())
    tb.handle("sonoff_kitchen", _STATS, _t(300))        # within 15 min: not again
    assert published == [("task", None)]
    tb.handle("sonoff_kitchen", _STATS, _t(1000))
    assert len(published) == 2
    tb.handle("sonoff_kitchen", _LIST, _t(1010))         # a list arrived: nothing to ask
    tb.handle("sonoff_kitchen", _STATS, _t(1300))
    assert len(published) == 2


def test_junk_never_becomes_a_reading():
    tb = TasmotaBle(MagicMock())
    tb.handle("x", {"BLEDevices": {"total": 3, "nothex000000": {"r": -50}, "AABBCCDDEEFF": {"r": "loud"},
                                   "112233445566": {"i": 1}}}, _t())
    assert tb._seen == {}


def test_it_is_off_by_default_and_a_setting_like_the_others():
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["tasmota_ble_enabled"] is False
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    ws = (root / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("tasmota_ble_enabled"): bool' in ws and '"tasmota_ble_enabled", "aggressive_ble_reseed"' in ws
    assert "_haTasmotaSection(ctx, el, settings)" in (root / "www/padspan-ha/views/manage.js").read_text(encoding="utf-8")


def test_the_address_cap_follows_low_memory_mode():
    tb = TasmotaBle(MagicMock())
    tb.max_addrs = 3
    tb.handle("t", {"BLEDevices": {f"AABBCCDDEE{i:02X}": {"r": -60} for i in range(6)}}, _t())
    assert len(tb._seen) == 3


@pytest.mark.asyncio
async def test_switched_off_while_subscribing_it_is_not_registered(monkeypatch):
    from custom_components.padspan_ha import tasmota_ble as T
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    mod = types.ModuleType("homeassistant.components.mqtt")

    async def _sub(hass, topic, cb, qos=0):
        return lambda: None
    mod.async_subscribe = _sub
    monkeypatch.setitem(sys.modules, "homeassistant.components.mqtt", mod)
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"tasmota_ble_enabled": False})}}
    await T.async_setup_tasmota_ble(hass)
    assert T.DATA_TASMOTA_BLE not in hass.data[DOMAIN]


def test_the_card_gives_the_tasmota_settings_presence_needs():
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    js = (root / "www/padspan-ha/views/manage.js").read_text(encoding="utf-8")
    for cmd in ("TelePeriod 10", "BLEMaxAge 30", "BLEAddrFilter 1"):
        assert cmd in js
