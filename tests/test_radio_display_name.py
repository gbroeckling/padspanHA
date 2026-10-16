# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""One name per receiver (Ben Hines, 2026-10-13: "each receiver has three or
more names"). radio_display_name picks it; every view shows that one.

The order: the name the user gave the device in HA, HA's device name, the
scanner's own name without its "(MAC)" tail, "<area> receiver", the source.
"""

from __future__ import annotations

from types import SimpleNamespace

from custom_components.padspan_ha.ws_common import radio_display_name


def _dev(name=None, name_by_user=None):
    return SimpleNamespace(name=name, name_by_user=name_by_user)


def test_user_name_in_ha_wins():
    r = {"source": "AA:BB:CC:DD:EE:FF", "name": "office-proxy (AA:BB:CC:DD:EE:FF)"}
    assert radio_display_name(r, _dev("ESP32 Proxy 1", "Office proxy")) == "Office proxy"


def test_ha_device_name_next():
    r = {"source": "AA:BB:CC:DD:EE:FF", "name": "office-proxy (AA:BB:CC:DD:EE:FF)"}
    assert radio_display_name(r, _dev("Office Proxy")) == "Office Proxy"


def test_scanner_name_loses_its_mac_tail():
    r = {"source": "AA:BB:CC:DD:EE:FF", "name": "office-proxy (AA:BB:CC:DD:EE:FF)"}
    assert radio_display_name(r) == "office-proxy"


def test_tasmota_and_espresense_names_kept():
    assert radio_display_name({"source": "tasmota_x", "name": "tasmota_E9C66C (Tasmota)"}) == "tasmota_E9C66C (Tasmota)"
    assert radio_display_name({"source": "espresense_k", "name": "Kitchen (ESPresense)"}) == "Kitchen (ESPresense)"


def test_bare_mac_name_falls_to_area_then_source():
    r = {"source": "AA:BB:CC:DD:EE:FF", "name": "AA:BB:CC:DD:EE:FF", "area_name": "Hall"}
    assert radio_display_name(r) == "Hall receiver"
    assert radio_display_name({"source": "AA:BB:CC:DD:EE:FF", "name": "AA:BB:CC:DD:EE:FF"}) == "AA:BB:CC:DD:EE:FF"


def test_blank_device_names_skipped():
    r = {"source": "s", "name": "kitchen-proxy"}
    assert radio_display_name(r, _dev("", "  ")) == "kitchen-proxy"
