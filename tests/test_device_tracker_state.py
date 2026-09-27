# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The tracker's state is its room, without a property HA is removing.

HA's device_tracker/entity.py (2026.7.4 and 2026.9.3 alike) warns at class
creation when a subclass overrides `battery_level` or `location_name` —
"this will be unsupported from Home Assistant 2027.7" — and Garry's HA log
has the PadSpanDeviceTracker line at every start. `location_name` is what
made the state a room name; its replacement, `in_zones`, takes HA zones only.
The room is now the `state` itself, which must read exactly as before: the
room, "not_home" once away, and otherwise whatever HA's TrackerEntity says.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.device_tracker import PadSpanDeviceTracker


def _tracker(obj: dict, settings: dict | None = None) -> PadSpanDeviceTracker:
    coordinator = MagicMock()
    coordinator.data = {"key1": obj}
    store = MagicMock()
    store.data = settings or {}
    coordinator.hass.data = {DOMAIN: {DATA_SETTINGS: store}}
    return PadSpanDeviceTracker(coordinator, "key1")


def test_no_property_ha_is_removing_is_overridden() -> None:
    """HA's own check, verbatim: `if "<name>" in cls.__dict__`."""
    for name in ("battery_level", "location_name"):
        assert name not in PadSpanDeviceTracker.__dict__, (
            f"PadSpanDeviceTracker overrides {name}: HA warns at every start "
            "and ignores it from 2027.7"
        )


def test_the_state_is_the_room_while_seen() -> None:
    assert _tracker({"kind": "ble", "age_s": 5, "room": "Kitchen"}).state == "Kitchen"


def test_the_state_is_not_home_once_away() -> None:
    t = _tracker({"kind": "ble", "age_s": 3600, "room": "Kitchen"})
    assert t.state == "not_home"


def test_the_away_timeout_setting_still_decides() -> None:
    obj = {"kind": "ble", "age_s": 600, "room": "Garage"}
    assert _tracker(obj, {"away_timeout_m": 5}).state == "not_home"
    assert _tracker(obj, {"away_timeout_m": 20}).state == "Garage"


def test_without_a_room_it_is_ha_s_own_answer() -> None:
    """No room: HA decides, from latitude/longitude when there are any.

    That was the location_name fallthrough (None), and it must stay so:
    home/not_home from the GPS bridge, or unknown without one.
    """
    fresh = {"kind": "ble", "age_s": 5, "x_m": 1.0, "y_m": 1.0}
    assert _tracker(fresh).state is None
    gps = {"fabric_origin_lat": 49.0, "fabric_origin_lon": -123.0}
    assert _tracker(fresh, gps).state == "home"
