"""An automatic calibration point is one write of the calibration file.

A pinned beacon adds an [auto] point every ten minutes, at most 50 kept per
beacon. The point was saved, and then the trim of the beacon's oldest point
saved the whole file again: about 1,400 writes a day of a 4.5 MB file in one
house. The trim now goes in the point's own save, and the same points are kept.
"""

from __future__ import annotations

import asyncio
import copy
from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import DATA_CALIBRATION, DATA_MODEL, DOMAIN
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
from tests.test_calibration_store import _make_store

BEACON = "ble:B1"


def _auto(i: int, did: str = BEACON) -> dict:
    return {"id": f"cp_auto_{did}_{i:03d}", "map_id": "", "x_frac": 0.5, "y_frac": 0.5, "x_m": 2.0, "y_m": 3.0,
            "floor_id": "f1", "room": "Kitchen", "label": f"[auto] {did}", "device_id": did,
            "collected_at": f"2026-11-{1 + i // 24:02d}T{i % 24:02d}:00:00+00:00", "duration_s": 10,
            "weight": 1.0, "scanner_readings": [{"source": "s1", "mean_rssi": -60.0, "rssi_samples": [-60.0] * 3}]}


def _store(points: list[dict]) -> CalibrationStore:
    store = _make_store(points=points)
    store._async_train_rf = AsyncMock()
    return store


def _point() -> dict:
    return {"x_m": 2.0, "y_m": 3.0, "floor_id": "f1", "room": "Kitchen", "label": f"[auto] {BEACON}",
            "device_id": BEACON, "duration_s": 10,
            "scanner_readings": [{"source": "s1", "rssi_samples": [-60.0, -61.0, -59.0]},
                                 {"source": "s2", "rssi_samples": [-70.0, -71.0, -72.0]}]}


def test_a_point_over_the_cap_is_one_save_and_keeps_what_add_then_trim_kept() -> None:
    start = [_auto(i) for i in range(50)] + [_auto(i, "ble:OTHER") for i in range(52)]
    one, two = _store(copy.deepcopy(start)), _store(copy.deepcopy(start))
    asyncio.run(one.async_add_point(_point(), auto_cap=50))
    asyncio.run(two.async_add_point(_point()))
    asyncio.run(two.async_prune_auto_points(max_per_beacon=50))
    assert one.store.async_save.await_count == 1
    assert two.store.async_save.await_count == 2              # as it was
    strip = lambda pts: [{k: v for k, v in p.items() if k not in ("id", "collected_at")} for p in pts]  # noqa: E731
    assert strip(one.data["points"]) == strip(two.data["points"])
    assert len([p for p in one.data["points"] if p["device_id"] == BEACON]) == 50
    assert len([p for p in one.data["points"] if p["device_id"] == "ble:OTHER"]) == 50
    assert "cp_auto_ble:B1_000" not in {p["id"] for p in one.data["points"]}     # the oldest went


def test_a_hand_saved_point_is_never_trimmed() -> None:
    store = _store([_auto(i) for i in range(60)])
    asyncio.run(store.async_add_point({**_point(), "label": "by hand", "device_id": "phone"}))
    assert len(store.data["points"]) == 61                     # no cap given: nothing trimmed


def _coord(store: CalibrationStore) -> PresenceCoordinator:
    hass = MagicMock()
    model = MagicMock()
    model.beacon_positions_m.return_value = {BEACON: {"x_m": 2.0, "y_m": 3.0, "room": "Kitchen"}}
    hass.data = {DOMAIN: {DATA_CALIBRATION: store, DATA_MODEL: model}}
    return PresenceCoordinator(hass)


def test_the_poll_writes_each_automatic_point_once() -> None:
    store = _store([_auto(i) for i in range(50)])
    coord = _coord(store)
    coord._beacon_autocal_buf[BEACON] = {"s1": [-60.0, -61.0, -59.0], "s2": [-70.0, -71.0, -72.0]}
    n = asyncio.run(coord.inject_immediate_calibration([{"key": BEACON}], "m1", "f1", {}))
    assert n == 1
    assert store.store.async_save.await_count == 1
    assert len(store.data["points"]) == 50
