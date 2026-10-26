# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Manage → HA Entities → BLE Proxy Compatibility, "Enable aggressive BLE
reseed (5s) for passive proxy scanners", did nothing.

The reseed read ble_reseed_interval_s first and the checkbox only when that
was missing, but DEFAULT_SETTINGS (30) is merged into every load, so it never
was: the panel said "reseeding every 5 seconds" while it stayed at 30.
"""
from pathlib import Path

from custom_components.padspan_ha.bluetooth_live import reseed_interval_s
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS


def test_the_default_is_30_seconds():
    assert reseed_interval_s(dict(DEFAULT_SETTINGS)) == 30
    assert reseed_interval_s(None) == 30


def test_the_checkbox_now_takes_it_to_5_seconds():
    assert reseed_interval_s({**DEFAULT_SETTINGS, "aggressive_ble_reseed": True}) == 5


def test_a_shorter_interval_set_in_presence_stays():
    assert reseed_interval_s({**DEFAULT_SETTINGS, "aggressive_ble_reseed": True, "ble_reseed_interval_s": 2}) == 2
    assert reseed_interval_s({**DEFAULT_SETTINGS, "ble_reseed_interval_s": 10}) == 10


def test_out_of_range_and_bad_values_are_safe():
    assert reseed_interval_s({"ble_reseed_interval_s": 0}) == 1
    assert reseed_interval_s({"ble_reseed_interval_s": 999}) == 60
    assert reseed_interval_s({"ble_reseed_interval_s": "x"}) == 30


def test_the_reseed_uses_it():
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "bluetooth_live.py").read_text(encoding="utf-8")
    assert "_RESEED_INTERVAL_S = reseed_interval_s(_st.data)" in src
