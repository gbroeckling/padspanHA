# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""How many devices PadSpan holds, and the low-memory switch.

Near a busy street PadSpan hears thousands of passing devices, and each one
it holds costs memory (docs/MINIMUM_REQUIREMENTS.md: about 14 MB per 1,000).
Two layers bound that:

- Always: the object history keeps at most HISTORY_MAX devices nobody has
  identified. Someone's object (labelled, identified, an IRK phone) is never
  counted and never dropped.
- Low-memory mode (Settings → Presence, setting `low_memory_mode`, off by
  default), for a 2 GB machine: the Bluetooth cache keeps addresses for
  LOW_MEM_BLE_AGE_S at most and LOW_MEM_BLE_ADDRS of them, the live snapshot
  carries LOW_MEM_SNAPSHOT_ADS advertisements, and the history keeps
  LOW_MEM_HISTORY_MAX unidentified devices for one day at most. Together that
  stays under the ~5,000 devices a 2 GB machine was measured to fit.

What the switch turns off is exactly that: passing devices drop out of the
device list and the Monitor's advertisement list sooner. Positioning, the
Atlas and Live Aboard are untouched by it.
"""
from __future__ import annotations

from typing import Any

from .const import DATA_SETTINGS, DOMAIN

BLE_AGE_DEFAULT_S = 14400        # the BLE Advertisement Timeout when never set
BLE_AGE_MIN_S = 60
BLE_AGE_MAX_S = 14400
SNAPSHOT_ADS = 5000              # advertisements in the live snapshot
HISTORY_MAX = 10000              # unidentified objects in the object history

LOW_MEM_BLE_AGE_S = 900
LOW_MEM_BLE_ADDRS = 2000
LOW_MEM_SNAPSHOT_ADS = 2000
LOW_MEM_HISTORY_MAX = 2000
LOW_MEM_HISTORY_DAYS = 1


def _settings(hass: Any) -> dict[str, Any]:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    data = getattr(st, "data", None) if st is not None else None
    return data if isinstance(data, dict) else {}


def enabled(hass: Any) -> bool:
    """Low-memory mode is on."""
    return bool(_settings(hass).get("low_memory_mode"))


def ble_age_s(hass: Any) -> int:
    """How long a Bluetooth address is kept: the BLE Advertisement Timeout
    (60 s - 4 h, 4 h when never set), at most LOW_MEM_BLE_AGE_S in low-memory
    mode."""
    age = BLE_AGE_DEFAULT_S
    raw = _settings(hass).get("ble_max_age_s")
    if raw is not None:
        try:
            age = max(BLE_AGE_MIN_S, min(BLE_AGE_MAX_S, int(raw)))
        except (TypeError, ValueError):
            pass
    return min(age, LOW_MEM_BLE_AGE_S) if enabled(hass) else age


def ble_max_addrs(hass: Any) -> int:
    """Bluetooth cache addresses at most; 0: no cap."""
    return LOW_MEM_BLE_ADDRS if enabled(hass) else 0


def snapshot_ads(hass: Any) -> int:
    return LOW_MEM_SNAPSHOT_ADS if enabled(hass) else SNAPSHOT_ADS


def history_max(hass: Any) -> int:
    """Unidentified objects the object history keeps at most."""
    return LOW_MEM_HISTORY_MAX if enabled(hass) else HISTORY_MAX
