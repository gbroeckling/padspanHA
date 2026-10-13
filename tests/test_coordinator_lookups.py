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
