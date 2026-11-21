# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Random Forest trains in the background, and only when it is used.

A calibration point used to wait for the forest to train (about 25 s on a
desktop) before its command answered, and the presence poll waited the same
way for every pinned beacon's automatic point. Now: with the default k-NN
setting nothing trains; with the Random Forest setting it trains in the
background (calibration_store.rf_points_changed), and unloading or reloading
the integration during a training is clean.
"""

from __future__ import annotations

import asyncio
import logging
import math
import threading

from homeassistant.config_entries import ConfigEntryState

from .conftest import DOMAIN, call

_SCANNERS = {"AA:00:00:00:00:01": (0.0, 0.0), "AA:00:00:00:00:02": (8.0, 0.0), "AA:00:00:00:00:03": (4.0, 6.0)}


def _point(i: int) -> dict:
    x, y = (i % 3) * 2.0, (i // 3) * 2.0
    readings = []
    for src, (sx, sy) in _SCANNERS.items():
        rssi = round(-50.0 - 20.0 * math.log10(1.0 + math.hypot(x - sx, y - sy)), 1)
        readings.append({"source": src, "rssi_samples": [rssi, rssi - 1, rssi + 1, rssi]})
    return {"map_id": "", "x_m": x, "y_m": y, "room": f"Room {i % 2}", "scanner_readings": readings}


def _problems(caplog) -> list[str]:
    return [f"{r.levelname} {r.name}: {r.getMessage()}" for r in (*caplog.get_records("setup"), *caplog.records)
            if r.levelno >= logging.WARNING and r.name.startswith("custom_components.padspan_ha")]


async def _save_points(admin, n: int) -> None:
    for i in range(n):
        reply = await call(admin, {"type": "padspan_ha/calibration_save_point", "point": _point(i)})
        assert reply["success"], reply


async def test_with_knn_a_saved_point_trains_nothing(hass, padspan, admin, caplog):
    await _save_points(admin, 5)
    cal = hass.data[DOMAIN]["calibration"]
    assert not cal.rf_training and not cal.rf_trained and cal.rf_state == "not_used"
    assert not _problems(caplog)


async def test_unloading_and_reloading_while_the_forest_trains(hass, padspan, admin, caplog, monkeypatch):
    from custom_components.padspan_ha.random_forest import RandomForestLocator  # noqa: PLC0415

    release = threading.Event()
    real_train = RandomForestLocator.train

    def held_train(self, *args, **kwargs):      # a training as long as the test wants
        release.wait(15)
        return real_train(self, *args, **kwargs)

    monkeypatch.setattr(RandomForestLocator, "train", held_train)
    assert (await call(admin, {"type": "padspan_ha/settings_set", "positioning_algorithm": "rf"}))["success"]
    await _save_points(admin, 5)                # each answered while the forest trains
    cal = hass.data[DOMAIN]["calibration"]
    assert cal.rf_training and cal.rf_state == "training"

    assert await hass.config_entries.async_unload(padspan.entry_id)
    await hass.async_block_till_done()
    assert padspan.state is ConfigEntryState.NOT_LOADED
    assert await hass.config_entries.async_setup(padspan.entry_id)
    await hass.async_block_till_done()
    assert padspan.state is ConfigEntryState.LOADED

    release.set()
    async with asyncio.timeout(15):
        while cal.rf_training:
            await asyncio.sleep(0.05)
    assert cal.rf_trained and not cal.rf_stale and cal.rf_state == "ready"
    assert len(cal._rf._points) == 5
    assert not _problems(caplog)
