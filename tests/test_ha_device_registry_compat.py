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
from types import SimpleNamespace
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


# ── A device's config entries, without the 2026.10 deprecation shim ──────────
#
# HA 2026.10's DeviceEntry.config_entries calls report_usage on every read: a
# stack walk and a copy of sys.modules, about a millisecond each. Read once per
# device per snapshot build, that was the 1-4 s `snap_ha_areas_ms` the opt-in
# report showed in every house with Bermuda. util.ha_device_config_entries reads
# config_entry_id instead.

class _Dev2026_10:
    """A 2026.10 DeviceEntry: one config_entry_id; the old set reports when read."""

    def __init__(self, cid: str, composite: frozenset[str] | None = None) -> None:
        self.config_entry_id = cid
        self._composite = composite
        self.reads = 0

    @property
    def is_composite_device(self) -> bool:
        return self._composite is not None

    @property
    def config_entries(self) -> set[str]:
        if not self.is_composite_device:
            self.reads += 1          # report_usage(...) in HA
            return {self.config_entry_id}
        return set(self._composite)


def test_a_device_s_config_entries_without_the_shim():
    from custom_components.padspan_ha.util import ha_device_config_entries

    new = _Dev2026_10("entry_a")
    assert ha_device_config_entries(new) == {"entry_a"}
    assert new.reads == 0, "read the deprecated property, which reports on every read"

    # A restored composite device belongs to several entries and does not report.
    comp = _Dev2026_10("entry_a", composite=frozenset({"entry_a", "entry_b"}))
    assert ha_device_config_entries(comp) == {"entry_a", "entry_b"}

    # Before 2026.9 there is no config_entry_id, only the set.
    old = SimpleNamespace(config_entries={"entry_x", "entry_y"})
    assert ha_device_config_entries(old) == {"entry_x", "entry_y"}
    assert ha_device_config_entries(SimpleNamespace(config_entries=None)) == set()


_BANNED_DEVICE_ATTRS = ("config_entries", "primary_config_entry", "config_entries_subentries")


def _is_hass(node: ast.AST) -> bool:
    """`hass.config_entries` is the config entry manager, not the device's set."""
    return ((isinstance(node, ast.Attribute) and node.attr in ("hass", "_hass"))
            or (isinstance(node, ast.Name) and node.id in ("hass", "homeassistant")))


def _direct_config_entries_reads(tree: ast.AST) -> list[int]:
    lines = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Attribute) and node.attr in _BANNED_DEVICE_ATTRS
                and not _is_hass(node.value)):
            lines.append(node.lineno)
        # The same read spelt as a string: getattr(dev, "config_entries", ()),
        # hasattr(...), operator.attrgetter("config_entries").
        elif isinstance(node, ast.Call):
            fn = node.func
            name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else ""
            if name in ("getattr", "hasattr"):
                if (len(node.args) >= 2 and not _is_hass(node.args[0])
                        and isinstance(node.args[1], ast.Constant)
                        and node.args[1].value in _BANNED_DEVICE_ATTRS):
                    lines.append(node.lineno)
            elif name == "attrgetter":
                if any(isinstance(a, ast.Constant) and isinstance(a.value, str)
                       and set(a.value.split(".")) & set(_BANNED_DEVICE_ATTRS) for a in node.args):
                    lines.append(node.lineno)
    return lines


def test_nothing_reads_a_device_s_config_entries_directly():
    """Only util.py may touch DeviceEntry.config_entries."""
    offenders = []
    for p in _ROOT.glob("*.py"):
        if p.name == "util.py":
            continue
        tree = ast.parse(p.read_text(encoding="utf-8"))
        offenders += [f"{p.name}:{n}" for n in _direct_config_entries_reads(tree)]
    assert not offenders, "read through util.ha_device_config_entries: " + ", ".join(offenders)


def test_the_guard_sees_a_read_spelt_as_a_string():
    """The three reads the guard used to miss (wled_exact, ws_wled x2) were all
    getattr(dev, "config_entries", ()) or ()."""
    src = (
        'for e in getattr(dev, "config_entries", ()) or (): pass\n'
        'hasattr(dev, "primary_config_entry")\n'
        'operator.attrgetter("config_entries")(dev)\n'
        'attrgetter("x.config_entries_subentries")(dev)\n'
        'getattr(hass, "config_entries")\n'
        'getattr(dev, "name", None)\n'
    )
    assert sorted(_direct_config_entries_reads(ast.parse(src))) == [1, 2, 3, 4]
