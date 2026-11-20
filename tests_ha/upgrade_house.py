# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The made-up house of the upgrade test (upgrade_capture.py makes its
stored data with the last stable, test_upgrade.py loads that with today's
code): the HA floors, areas and states it stands on, and the Bluetooth it
hears. Every name, address and key here is made up."""

from __future__ import annotations

from types import SimpleNamespace

from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import floor_registry as fr

ENTRY_ID = "01UPGRADETESTENTRY000000000"

FLOORS = [("Ground", 0), ("Upstairs", 1)]
AREAS = [("Kitchen", "ground"), ("Living Room", "ground"), ("Hall", "ground"),
         ("Bedroom", "upstairs"), ("Office", "upstairs")]
STATES = {
    "light.kitchen_ceiling": ("on", {"friendly_name": "Kitchen ceiling", "brightness": 200, "color_mode": "brightness",
                                     "supported_color_modes": ["brightness"]}),
    "light.living_lamp": ("off", {"friendly_name": "Living lamp", "color_mode": None,
                                  "supported_color_modes": ["brightness"]}),
    "light.bedroom_strip": ("on", {"friendly_name": "Bedroom strip", "rgb_color": [255, 120, 0],
                                   "color_mode": "rgb", "supported_color_modes": ["rgb"]}),
    "binary_sensor.hall_motion": ("off", {"friendly_name": "Hall motion", "device_class": "motion"}),
    "binary_sensor.front_door": ("off", {"friendly_name": "Front door", "device_class": "door"}),
    "person.alex_example": ("home", {"friendly_name": "Alex Example"}),
    "person.sam_example": ("not_home", {"friendly_name": "Sam Example"}),
    "cover.garage_example": ("closed", {"friendly_name": "Garage example"}),
}

# Locally administered (02:...) addresses: no real device has them.
TAG = "02:00:00:00:00:01"
PHONE = "02:00:00:00:00:02"
WALLET = "02:00:00:00:00:03"
BEACON = "02:00:00:00:00:04"
IBEACON_ADDR = "02:00:00:00:00:06"
IBEACON_UUID = "00000000000040008000000000000001"
SCANNERS = ("scanner_example_kitchen", "scanner_example_living", "scanner_example_hall",
            "scanner_example_bedroom", "scanner_example_office")
# Who is heard where, and how strongly (dBm per scanner, in SCANNERS' order).
HEARD = {
    TAG: ("Example tag", (-55, -70, -72, -88, -90), {}),
    PHONE: ("Example phone", (-80, -62, -70, -85, -88), {}),
    WALLET: ("Example wallet", (-86, -84, -78, -58, -74), {}),
    BEACON: ("Example beacon", (-60, -66, -75, -90, -92), {}),
    IBEACON_ADDR: ("", (-75, -80, -60, -82, -86),
                   {76: bytes.fromhex("0215" + IBEACON_UUID + "0001" + "0001" + "c5")}),
}


def build_ha_house(hass, states: dict | None = None) -> None:
    """The floors, areas and states the house stands on, as HA holds them."""
    floors = fr.async_get(hass)
    for name, level in FLOORS:
        floors.async_create(name, level=level)
    areas = ar.async_get(hass)
    for name, floor in AREAS:
        areas.async_create(name, floor_id=floor)
    for eid, (state, attrs) in (states or STATES).items():
        hass.states.async_set(eid, state, attrs)


def stand_in_bluetooth(monkeypatch) -> None:
    """Home Assistant's Bluetooth integration does not import in this
    environment (its USB and adapter libraries are not installed), and
    bluetooth_live reads its list of scanners through it. A stand-in with no
    environment's own: the five receivers below, listening, and no cached
    adverts of its own (a receiver it does not list is one HA dropped, and
    its readings are let go)."""
    import enum  # noqa: PLC0415
    import sys  # noqa: PLC0415
    import types  # noqa: PLC0415

    mod = types.ModuleType("homeassistant.components.bluetooth")

    class BluetoothScanningMode(enum.Enum):
        PASSIVE = "passive"
        ACTIVE = "active"

    mod.BluetoothScanningMode = BluetoothScanningMode
    scanners = [SimpleNamespace(source=src, name=src, connectable=False, scanning=True, adapter="",
                                current_mode=None, requested_mode=None) for src in SCANNERS]
    mod.async_current_scanners = lambda hass: list(scanners)
    mod.async_scanner_count = lambda hass, connectable=True: 0
    mod.async_discovered_service_info = lambda hass, connectable=True: []
    mod.async_register_callback = lambda *args, **kwargs: (lambda: None)
    monkeypatch.setitem(sys.modules, "homeassistant.components.bluetooth", mod)


async def poll(hass, domain: str, polls: int = 1) -> None:
    """`polls` polls of a house that hears its devices. The snapshot cache is
    dropped first each time: a real poll comes 5 s after the last, past the
    cache's few seconds, and here they come within milliseconds."""
    from custom_components.padspan_ha.ws_common import _invalidate_snapshot_cache  # noqa: PLC0415

    coord = hass.data[domain]["presence_coordinator"]
    for _ in range(polls):
        hear(hass, domain)
        _invalidate_snapshot_cache(hass)
        await coord.async_refresh()
        await hass.async_block_till_done()


def hear(hass, domain: str, times: int = 4) -> int:
    """Every device heard by every scanner `times` times, through the same
    callback Home Assistant's Bluetooth calls (bluetooth_live._on_adv).
    Returns how many adverts went in; 0 when the feed is not there."""
    bl = hass.data.get(domain, {}).get("bluetooth_live")
    if bl is None:
        return 0
    n = 0
    for i in range(times):
        for addr, (name, rssi, manuf) in HEARD.items():
            for src, dbm in zip(SCANNERS, rssi):
                bl._on_adv(SimpleNamespace(
                    address=addr, name=name or None, source=src, rssi=dbm + (i % 3) - 1, tx_power=None,
                    connectable=False, manufacturer_data=dict(manuf), service_data={}, service_uuids=[]))
                n += 1
    return n
