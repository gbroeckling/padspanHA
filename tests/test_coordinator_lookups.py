# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""hass.data[DOMAIN]['coordinator'] is PadSpanCoordinator, a config holder
(room_tag_map, last_error). The presence methods and figures live on
hass.data[DOMAIN]['presence_coordinator']. Several handlers asked the holder,
so their work silently never happened: forget object, clearing a removed
beacon, immediate beacon calibration (BUG_LOG #111), Radio Reset's smoothing
clear, Calibration Health's scanner names, and the System Critics' scanner
reliability section."""

from __future__ import annotations

import re
from pathlib import Path

from custom_components.padspan_ha.coordinator import PadSpanCoordinator

_PKG = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_PRESENCE_ONLY = ("clear_object_state", "clear_scanner", "inject_immediate_calibration",
                  "_scanner_reliability", "_scanner_agree")


def test_the_config_holder_has_none_of_the_presence_methods():
    for name in _PRESENCE_ONLY:
        assert not hasattr(PadSpanCoordinator, name), name


def test_no_handler_asks_the_config_holder_for_them():
    bad = []
    for path in _PKG.glob("*.py"):
        src = path.read_text(encoding="utf-8")
        for m in re.finditer(r"(\w+)\s*=\s*[^\n]*\.get\((?:DATA_COORDINATOR|\"coordinator\")\)", src):
            var = m.group(1)
            rest = src[m.end():m.end() + 3000]
            for name in _PRESENCE_ONLY:
                if re.search(rf"\b{var}\.{name}\b|hasattr\({var}, \"{name}\"\)", rest):
                    bad.append(f"{path.name}: {var}.{name}")
    assert bad == []


def test_clear_scanner_removes_a_source_without_touching_dicts_in_use():
    """Radio Reset runs clear_scanner on the event loop while, in cpu_mode
    single or dedicated, the object loop iterates these dicts on the
    executor: it replaces a device's dicts instead of editing them."""
    from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
    pc = PresenceCoordinator.__new__(PresenceCoordinator)
    a_ema = {"kit": -60.0, "off": -70.0}
    pc._ema_rssi = {"A": a_ema, "B": {"kit": -55.0}, "C": {"off": -80.0}}
    pc._kalman_p = {"A": {"kit": 1.0, "off": 2.0}, "B": {"kit": 1.0}}
    pc._silence_miss = {"A": {"kit": 2}, "C": {"off": 1}}
    assert pc.clear_scanner("kit") == 2
    assert pc._ema_rssi == {"A": {"off": -70.0}, "C": {"off": -80.0}}
    assert pc._kalman_p == {"A": {"off": 2.0}}
    assert pc._silence_miss == {"C": {"off": 1}}
    assert a_ema == {"kit": -60.0, "off": -70.0}      # the loop's reference was not edited
