# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Small helpers shared across the integration."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def ha_devices(dev_reg: Any) -> list[Any]:
    """Every device (DeviceEntry) in Home Assistant's device registry.

    The one place PadSpan reads `dev_reg.devices`, because its shape depends
    on the HA version. In HA 2026.7 and earlier it is a device_id ->
    DeviceEntry mapping, and iterating it yields ids. In HA 2026.9 it is a
    view whose iteration yields the entries, and every mapping use
    (`.values()`, `.get()`, `[id]`, `id in`) logs a deprecation warning and
    stops working in 2027.9.
    `.values()` on the first and iteration on the second give the same list.
    Look a device up by id in a dict built from this list, not with
    `dev_reg.async_get()`: from 2026.9 that also resolves child and composite
    devices, which `devices.get()` never did.
    """
    devices = dev_reg.devices
    if isinstance(devices, Mapping):
        return list(devices.values())
    return list(devices)
