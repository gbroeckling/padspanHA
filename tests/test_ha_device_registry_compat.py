# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Home Assistant's device registry, read the way both supported versions allow.

HA 2026.9 made `DeviceRegistry.devices` a view
(helpers/device_registry.py, `_DeprecatedDeviceRegistryItemsView`, "Can be
removed in release 2027.9"). Iterating it yields the DeviceEntry objects; every
mapping use (`.values()`, `.get()`, `[id]`, `id in`) logs a deprecation warning
(the #88 reporter's log has them) and stops working in 2027.9. PadSpan had eight
such reads, behind the live snapshot, the scanner sync and the companion
lookups.

Iterating is not a drop-in answer: in HA 2026.7 `devices` is still a
device_id -> DeviceEntry mapping, and iterating that yields ids.
`util.ha_devices` is the one read that is right on both, so it is the only
place allowed to touch `.devices`.
"""

from __future__ import annotations

import ast
from collections import UserDict
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import homeassistant.helpers.device_registry as _dr_mod
from custom_components.padspan_ha.util import ha_devices
from custom_components.padspan_ha.ws_common import RadioDeviceIndex

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


class _Dev:
    def __init__(self, id: str, name: str) -> None:
        self.id = id
        self.name = name
        self.name_by_user = None
        self.connections: set = set()


class _View2026_9:
    """HA 2026.9.3's `_DeprecatedDeviceRegistryItemsView`, same rules.

    Iteration and len() are supported. Everything else is a deprecated use:
    recorded here (HA logs it) and then served, as HA 2026.9 does.
    """

    def __init__(self, devices: dict[str, _Dev], uses: list[str]) -> None:
        self._devices = devices
        self._uses = uses

    def __iter__(self):
        return iter(self._devices.values())

    def __len__(self) -> int:
        return len(self._devices)

    def __getitem__(self, key: str) -> _Dev:
        self._uses.append(f"[{key!r}]")
        return self._devices[key]

    def __contains__(self, obj: object) -> bool:
        if isinstance(obj, str):
            self._uses.append(f"{obj!r} in")
            return obj in self._devices
        return any(obj is d for d in self._devices.values())

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        self._uses.append(f".{name}")
        return getattr(self._devices, name)


def _registry_2026_9(devs: list[_Dev], uses: list[str]) -> Any:
    reg = MagicMock()
    reg.devices = _View2026_9({d.id: d for d in devs}, uses)
    return reg


def _registry_2026_7(devs: list[_Dev]) -> Any:
    # A UserDict, like HA's BaseRegistryItems: iterating it yields ids.
    reg = MagicMock()
    reg.devices = UserDict({d.id: d for d in devs})
    return reg


_DEVS = [_Dev("d1", "btproxy_kitchen"), _Dev("d2", "btproxy_garage")]


def test_the_2026_9_view_is_read_without_a_deprecated_use() -> None:
    uses: list[str] = []
    assert ha_devices(_registry_2026_9(_DEVS, uses)) == _DEVS
    assert uses == [], f"deprecated device-registry access: {uses}"


def test_the_2026_7_mapping_gives_entries_not_ids() -> None:
    """The trap in 'just iterate it': on 2026.7 that yields device ids."""
    assert ha_devices(_registry_2026_7(_DEVS)) == _DEVS


def test_a_radio_resolves_on_2026_9_without_a_deprecation(monkeypatch) -> None:
    """A real consumer, end to end, against the 2026.9 shape.

    It used to read `.devices.values()`: a warning on every pass today, and an
    AttributeError from 2027.9, which its own try/except turned into an empty
    registry, so no radio found its HA device.
    """
    uses: list[str] = []
    monkeypatch.setattr(_dr_mod, "async_get",
                        lambda hass: _registry_2026_9(_DEVS, uses), raising=False)
    match = RadioDeviceIndex(MagicMock()).resolve("btproxy_kitchen")
    assert match.device is _DEVS[0]
    assert uses == [], f"deprecated device-registry access: {uses}"


def test_the_ha_device_registry_is_read_in_one_place() -> None:
    """No `x.devices` outside util.ha_devices, in any form.

    `.devices.values()`, `.devices.get()`, `.devices[id]` and `id in x.devices`
    all start with the attribute read, so that is what is caught — an alias
    (`devs = reg.devices; devs.get(...)`) included. `self.devices` is
    PadSpan's own and is not the registry.
    """
    found = []
    for path in sorted(_ROOT.rglob("*.py")):
        if path.name == "util.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Attribute) and node.attr == "devices"
                    and not (isinstance(node.value, ast.Name) and node.value.id == "self")):
                found.append(f"{path.name}:{node.lineno}")
    assert not found, (
        "read HA's device registry through util.ha_devices — `.devices` as a "
        f"mapping is deprecated in HA 2026.9 and gone in 2027.9: {found}"
    )
