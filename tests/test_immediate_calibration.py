# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A map save carrying beacons must not write one-reading auto points.

inject_immediate_calibration saved each scanner's smoothed RSSI as a single
sample; async_add_point then kept one scanner and marked the point
undersampled — the exact auto point the AUTOCAL_HYGIENE migration deletes.
Restore-from-backup and the migration Revert both send beacons through
maps_update, so each one wrote a fresh bad point per live beacon.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.const import DOMAIN, DATA_CALIBRATION, DATA_MODEL
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator


def _coord():
    hass = MagicMock()
    cal = MagicMock()
    cal.async_add_point = AsyncMock()
    cal.async_prune_auto_points = AsyncMock()
    model = MagicMock()
    model.beacon_positions_m.return_value = {"ble:B1": {"x_m": 2.0, "y_m": 3.0, "room": "Kitchen"}}
    hass.data = {DOMAIN: {DATA_CALIBRATION: cal, DATA_MODEL: model}}
    coord = PresenceCoordinator(hass)
    return coord, cal


@pytest.mark.asyncio
async def test_smoothed_rssi_alone_writes_nothing():
    coord, cal = _coord()
    coord._ema_rssi["ble:B1"] = {"s1": -60.0, "s2": -70.0}
    n = await coord.inject_immediate_calibration([{"key": "ble:B1"}], "m1", "f1", {})
    assert n == 0
    cal.async_add_point.assert_not_awaited()


@pytest.mark.asyncio
async def test_buffered_fingerprint_is_saved_with_its_samples():
    coord, cal = _coord()
    coord._beacon_autocal_buf["ble:B1"] = {"s1": [-60.0, -61.0, -59.0], "s2": [-70.0, -71.0, -72.0], "s3": [-80.0]}
    n = await coord.inject_immediate_calibration([{"key": "ble:B1"}], "m1", "f1", {})
    assert n == 1
    pt = cal.async_add_point.await_args.args[0]
    assert {r["source"]: len(r["rssi_samples"]) for r in pt["scanner_readings"]} == {"s1": 3, "s2": 3}
    assert coord._beacon_autocal_buf["ble:B1"] == {}


@pytest.mark.asyncio
async def test_auto_point_drops_a_pin_room_that_is_not_a_room():
    """Legacy pins stamped a device label into room; the live pass refuses
    it, and the auto points must too."""
    import time
    coord, cal = _coord()
    buf = {"s1": [-60.0] * 3, "s2": [-70.0] * 3}
    for pin_room, live_room, want in (("Garry's Keys", "Kitchen", ""), ("Kitchen", "Kitchen", "Kitchen")):
        cal.async_add_point.reset_mock()
        coord._beacon_autocal_last = {}
        coord._beacon_autocal_buf = {"ble:B1": {k: list(v) for k, v in buf.items()}}
        pinned = {"ble:B1": {"room": pin_room, "x_m": 1.0, "y_m": 2.0, "floor_id": "f1"}}
        result = {"ble:B1": {"room": live_room, "address": "B1"}}
        # Well past the 10-minute rate limit whatever the clock: a CI machine
        # booted a few minutes ago has a monotonic clock below 600 s.
        await coord._inject_beacon_calibration(time.monotonic() + 1e6, pinned, result, {}, {})
        assert cal.async_add_point.await_args.args[0]["room"] == want
