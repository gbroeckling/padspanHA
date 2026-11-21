# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Room tracking never waits for the Random Forest to train.

Replaying four hours of a real house: every automatic calibration point from
a pinned beacon (about 32 an hour) made the presence poll wait while
CalibrationStore.async_add_point trained a pure-Python Random Forest, about
25 s on a desktop. 75 results came 25-55 s late. And that house positions
with k-NN: only the "rf" positioning setting uses the forest.

Now nothing that changes the points waits for a training. With k-NN the
forest is only marked out of date; with "rf" it trains in the background, one
at a time with at most one more queued, and the coordinator matches
calibration points until it is trained. The retrain button still trains and
answers, whatever the setting.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import math
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha import ws_calibration as WC
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import DATA_CALIBRATION, DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
from custom_components.padspan_ha.random_forest import RandomForestLocator
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS, SettingsStore

_SCANNERS = {"sc_a": (0.0, 0.0), "sc_b": (8.0, 0.0), "sc_c": (4.0, 6.0)}


def _readings(x: float, y: float) -> list[dict]:
    out = []
    for src, (sx, sy) in _SCANNERS.items():
        rssi = -50.0 - 20.0 * math.log10(1.0 + math.hypot(x - sx, y - sy))
        out.append({"source": src, "rssi_samples": [rssi - 1, rssi, rssi + 1, rssi]})
    return out


def _point(i: int) -> dict:
    x, y = (i % 5) * 1.5, (i // 5) * 1.5
    return {"map_id": "", "x_m": x, "y_m": y, "room": f"room{i % 3}", "label": f"p{i}",
            "duration_s": 10, "scanner_readings": _readings(x, y)}


class _House:
    """Just enough Home Assistant for the calibration store: the settings, an
    executor whose forest trainings are counted (and can be held, the way a
    25 s training holds), and background tasks on the running loop."""

    def __init__(self, algorithm: str) -> None:
        self.settings = SimpleNamespace(data={"positioning_algorithm": algorithm})
        self.data = {DOMAIN: {DATA_SETTINGS: self.settings}}
        self.trainings: list[list[str]] = []      # the point labels each training learnt from
        self.hold: asyncio.Event | None = None
        self.tasks: list[asyncio.Task] = []

    async def async_add_executor_job(self, fn, *args):
        if getattr(fn, "__name__", "") == "train":
            self.trainings.append(sorted(p["label"] for p in args[0]))
            if self.hold is not None:
                await self.hold.wait()
        return fn(*args)

    def async_create_background_task(self, coro, name, eager_start=True):
        task = asyncio.get_running_loop().create_task(coro, name=name)
        self.tasks.append(task)
        return task

    async def settle(self) -> None:
        """Every background training finished."""
        while any(not t.done() for t in self.tasks):
            await asyncio.gather(*self.tasks, return_exceptions=True)


def _store(house: _House, n_points: int = 0) -> CalibrationStore:
    store = CalibrationStore.__new__(CalibrationStore)
    store.hass = house
    store.store = SimpleNamespace(async_save=AsyncMock())
    store.data = {"points": [], "model": {}}
    store._rf = RandomForestLocator()
    store._model = None
    for i in range(n_points):
        store.data["points"].append(store._clean_point(_point(i)))
    house.data[DOMAIN][DATA_CALIBRATION] = store
    return store


# ── k-NN, the default: nothing trains ────────────────────────────────────────

async def test_with_knn_a_point_added_trains_nothing_and_returns_at_once() -> None:
    house = _House("knn")
    house.hold = asyncio.Event()            # a training would never finish
    store = _store(house, 6)
    saved = await asyncio.wait_for(store.async_add_point(_point(6)), 2.0)
    assert saved["label"] == "p6"
    await asyncio.sleep(0)
    assert house.trainings == [] and house.tasks == []
    assert store.rf_stale and not store.rf_trained
    assert store.rf_state == "not_used"


async def test_with_knn_no_automatic_change_trains() -> None:
    """Trimmed, deleted, a room walk, moved, a map cleared, start-up: all
    automatic, none trains with k-NN. The forest is marked out of date."""
    house = _House("knn")
    store = _store(house, 6)
    before = store._rf_changes
    pid = store.data["points"][0]["id"]
    assert await store.async_delete_point(pid)
    assert await store.async_move_points({store.data["points"][0]["id"]: (2.0, 2.0)}) == 1
    for i in range(3):
        p = store._clean_point({**_point(10 + i), "label": "[auto] tag", "device_id": "tag"})
        store.data["points"].append(p)
    assert await store.async_prune_auto_points(max_per_beacon=1) == 2
    await store.async_clear_map("")
    store.rf_train_if_used()                 # start-up
    await asyncio.sleep(0)
    assert house.trainings == [] and house.tasks == []
    assert store._rf_changes > before and store.rf_stale


# ── "rf": in the background, coalesced ───────────────────────────────────────

async def test_with_rf_add_point_returns_before_the_training_finishes() -> None:
    house = _House("rf")
    house.hold = asyncio.Event()
    store = _store(house, 5)
    await asyncio.wait_for(store.async_add_point(_point(5)), 2.0)
    await asyncio.sleep(0.01)
    assert len(house.trainings) == 1 and store.rf_training
    assert store.rf_state == "training"
    house.hold.set()
    await house.settle()
    assert store.rf_trained and not store.rf_stale and store.rf_state == "ready"


async def test_with_rf_many_points_make_at_most_two_trainings_and_the_last_has_them_all() -> None:
    house = _House("rf")
    house.hold = asyncio.Event()
    store = _store(house, 5)
    await store.async_add_point(_point(5))
    await asyncio.sleep(0.01)                # the first training is under way
    for i in range(6, 26):
        await asyncio.wait_for(store.async_add_point(_point(i)), 2.0)
        await asyncio.sleep(0)
    assert len(house.trainings) == 1
    house.hold.set()
    await house.settle()
    assert len(house.trainings) == 2
    assert house.trainings[-1] == sorted(f"p{i}" for i in range(26))
    assert store.rf_trained and not store.rf_stale
    assert len(store._rf._points) == 26


async def test_the_poll_adding_then_trimming_makes_one_training() -> None:
    house = _House("rf")
    store = _store(house, 5)
    for i in range(3):
        store.data["points"].append(store._clean_point({**_point(10 + i), "label": "[auto] tag", "device_id": "tag"}))
    await store.async_add_point({**_point(20), "label": "[auto] tag", "device_id": "tag"})
    await store.async_prune_auto_points(max_per_beacon=3)
    await house.settle()
    assert len(house.trainings) == 1
    assert house.trainings[0].count("[auto] tag") == 3
    assert not store.rf_stale


async def test_the_poll_never_waits_for_a_training() -> None:
    """The presence poll's own path: a pinned beacon's automatic point, with
    the forest's training held. It returns at once in both modes; with k-NN
    nothing trains at all."""
    for algorithm, trainings in (("knn", 0), ("rf", 1)):
        house = _House(algorithm)
        house.hold = asyncio.Event()
        store = _store(house, 5)
        hass = MagicMock()
        hass.data = house.data
        coord = PresenceCoordinator(hass)
        coord._beacon_autocal_buf = {"ble:B1": {"sc_a": [-60.0] * 3, "sc_b": [-70.0] * 3}}
        pinned = {"ble:B1": {"room": "room0", "x_m": 1.0, "y_m": 2.0, "floor_id": ""}}
        result = {"ble:B1": {"room": "room0", "address": "B1"}}
        started = time.monotonic()
        await asyncio.wait_for(
            coord._inject_beacon_calibration(time.monotonic() + 1e6, pinned, result, {}, {}), 2.0)
        assert time.monotonic() - started < 1.0
        assert len(store.data["points"]) == 6, algorithm
        await asyncio.sleep(0.01)
        assert len(house.trainings) == trainings, algorithm
        house.hold.set()
        await house.settle()


async def test_unloading_during_a_training_is_clean(caplog) -> None:
    """Home Assistant cancels background tasks when it stops; a reload leaves
    the store (and its training) as it is. Cancelled mid-training: nothing is
    logged, the old forest stays, and the next change trains again."""
    house = _House("rf")
    house.hold = asyncio.Event()
    store = _store(house, 5)
    await store.async_add_point(_point(5))
    await asyncio.sleep(0.01)
    assert store.rf_training
    with caplog.at_level(logging.DEBUG):
        for t in house.tasks:
            t.cancel()
        await asyncio.gather(*house.tasks, return_exceptions=True)
    assert not store.rf_training and store.rf_stale and not store.rf_trained
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
    house.hold.set()
    await store.async_add_point(_point(6))
    await house.settle()
    assert store.rf_trained and not store.rf_stale


async def test_a_failed_training_stops_and_positioning_keeps_knn() -> None:
    house = _House("rf")
    store = _store(house, 5)
    with patch.object(RandomForestLocator, "train", side_effect=RuntimeError("boom")):
        store.rf_points_changed()
        await house.settle()
    assert len(house.tasks) == 1 and not store.rf_trained and store.rf_stale
    assert store.rf_state == "not_trained"


async def test_an_older_training_finishing_last_does_not_replace_a_newer_one() -> None:
    house = _House("rf")
    first = house.hold = asyncio.Event()
    store = _store(house, 5)
    store.rf_points_changed()
    await asyncio.sleep(0.01)                   # the background training learns 5 points, held
    store.data["points"].append(store._clean_point(_point(5)))
    store.rf_points_changed()
    house.hold = None                           # the retrain button's training is not held
    await store._async_train_rf()
    assert len(store._rf._points) == 6 and not store.rf_stale
    first.set()                                 # the older one finishes last
    await house.settle()
    assert [len(t) for t in house.trainings] == [5, 6]
    assert len(store._rf._points) == 6 and not store.rf_stale


async def test_clear_all_leaves_no_old_forest() -> None:
    house = _House("rf")
    house.hold = asyncio.Event()
    store = _store(house, 6)
    store.rf_points_changed()
    await asyncio.sleep(0.01)
    await store.async_clear_all()
    house.hold.set()
    await house.settle()
    assert not store.rf_trained and not store.rf_stale


# ── Switching the setting ────────────────────────────────────────────────────

def _settings_house(algorithm: str, n_points: int) -> tuple[_House, SettingsStore, CalibrationStore]:
    house = _House(algorithm)
    st = SettingsStore.__new__(SettingsStore)
    st.data = {**copy.deepcopy(DEFAULT_SETTINGS), "positioning_algorithm": algorithm}
    st.hass = house
    st.store = SimpleNamespace(async_save=AsyncMock())
    house.data[DOMAIN][DATA_SETTINGS] = st
    house.async_create_task = lambda coro, *a, **kw: house.async_create_background_task(coro, "task")
    cal = _store(house, n_points)
    return house, st, cal


def _admin():
    return SimpleNamespace(user=SimpleNamespace(is_admin=True, name="Admin", id="u1"), refresh_token_id="t1",
                           send_error=MagicMock(), send_result=MagicMock())


async def test_switching_to_rf_trains_with_the_new_setting() -> None:
    house, st, cal = _settings_house("knn", 6)
    with patch.object(WS, "_invalidate_snapshot_cache", lambda h: None):
        await WS.ws_settings_set(house, _admin(), {"id": 1, "type": "padspan_ha/settings_set",
                                                   "positioning_algorithm": "rf"})
    assert st.data["positioning_algorithm"] == "rf"
    await house.settle()
    assert len(house.trainings) == 1 and cal.rf_trained and cal.rf_state == "ready"


async def test_switching_to_knn_or_saving_other_settings_trains_nothing() -> None:
    house, st, cal = _settings_house("knn", 6)
    with patch.object(WS, "_invalidate_snapshot_cache", lambda h: None):
        for msg in ({"positioning_algorithm": "knn"}, {"excluded_scanners": ["sc_c"]}):
            await WS.ws_settings_set(house, _admin(), {"id": 1, "type": "padspan_ha/settings_set", **msg})
    await house.settle()
    assert house.trainings == [] and cal.rf_stale


async def test_excluding_a_scanner_with_rf_retrains_without_it() -> None:
    house, st, cal = _settings_house("rf", 6)
    cal.rf_train_if_used()
    await house.settle()
    assert "sc_c" in cal._rf._sources
    with patch.object(WS, "_invalidate_snapshot_cache", lambda h: None):
        await WS.ws_settings_set(house, _admin(), {"id": 1, "type": "padspan_ha/settings_set",
                                                   "excluded_scanners": ["sc_c"]})
    await house.settle()
    assert len(house.trainings) == 2 and "sc_c" not in cal._rf._sources


# ── Asked for: the retrain button and Compute ────────────────────────────────

@pytest.mark.parametrize("algorithm", ["knn", "rf"])
async def test_the_retrain_command_trains_and_answers_under_either_setting(algorithm) -> None:
    house = _House(algorithm)
    store = _store(house, 6)
    conn = MagicMock()
    with patch.object(WC, "_get_cal_store", AsyncMock(return_value=store)):
        await WC.ws_calibration_retrain_rf(house, conn, {"id": 1})
    res = conn.send_result.call_args.args[1]
    assert res["ok"] and res["rf_trained"] is True and res["point_count"] == 6
    assert len(house.trainings) == 1 and not store.rf_stale


async def test_accuracy_is_the_active_algorithms_and_never_an_old_forests() -> None:
    house = _House("rf")
    house.hold = asyncio.Event()
    store = _store(house, 8)
    store.rf_train_if_used()
    await asyncio.sleep(0.01)
    # Still training: no forest accuracy is reported as today's.
    assert store.compute_model()["loo_accuracy"] is None
    house.hold.set()
    await house.settle()
    loo = store.compute_model()["loo_accuracy"]
    assert loo and loo["algorithm"] == "rf"
    # A point added: the forest learnt the old points. Compute waits for it.
    house.hold = asyncio.Event()
    await store.async_add_point(_point(8))
    await asyncio.sleep(0.01)
    assert store.compute_model()["loo_accuracy"] is None
    conn = MagicMock()
    with patch.object(WC, "_get_cal_store", AsyncMock(return_value=store)):
        asked = asyncio.ensure_future(WC.ws_calibration_compute_model(house, conn, {"id": 1}))
        await asyncio.sleep(0.01)
        assert not asked.done()
        house.hold.set()
        await asyncio.wait_for(asked, 5.0)
    model = conn.send_result.call_args.args[1]["model"]
    assert model["loo_accuracy"]["algorithm"] == "rf" and model["loo_accuracy"]["point_count"] >= 1
    # k-NN: its own accuracy, whatever the forest is doing.
    house.settings.data["positioning_algorithm"] = "knn"
    assert store.compute_model()["loo_accuracy"]["algorithm"] == "knn"


# ── What the panel is told ───────────────────────────────────────────────────

async def _fabric_rf_check(house: _House) -> dict:
    from custom_components.padspan_ha.ws_fabric import ws_fabric_health
    hass = MagicMock()
    hass.data = house.data
    hass.states.async_all = MagicMock(return_value=[])
    conn = MagicMock()
    await ws_fabric_health(hass, conn, {"id": 1})
    return next(c for c in conn.send_result.call_args.args[1]["checks"] if c["name"] == "RF Model")


async def test_the_health_check_says_not_used_with_knn_and_is_not_a_fault() -> None:
    house = _House("knn")
    _store(house, 6)
    check = await _fabric_rf_check(house)
    assert check["ok"] is True and check["value"] == "not used"
    assert "k-NN" in check["detail"]


async def test_the_health_check_with_rf_training_ready_and_too_few_points() -> None:
    house = _House("rf")
    house.hold = asyncio.Event()
    store = _store(house, 6)
    store.rf_train_if_used()
    await asyncio.sleep(0.01)
    check = await _fabric_rf_check(house)
    assert (check["ok"], check["value"]) == (True, "training")
    house.hold.set()
    await house.settle()
    check = await _fabric_rf_check(house)
    assert (check["ok"], check["value"]) == (True, "metres")
    few = _House("rf")
    _store(few, 2).rf_train_if_used()
    await few.settle()
    check = await _fabric_rf_check(few)
    assert (check["ok"], check["value"]) == (False, "not trained")


def _snapshot_calibration(house: _House) -> dict:
    hass = MagicMock()
    hass.data = house.data
    conn = MagicMock()
    snap = {"objects": {"list": []}, "ble": {"advertisements": [], "radios": []}}

    async def _snap(_hass):
        return snap

    async def _run():
        with patch.object(SB, "_live_snapshot", _snap), \
             patch("custom_components.padspan_ha.perf_sampler.note_snapshot_request", lambda h: None):
            await SB.ws_live_snapshot(hass, conn, {"id": 1})
    return _run, conn


async def test_the_snapshot_says_what_the_forest_is_doing() -> None:
    for algorithm, want in (("knn", "not_used"), ("rf", "ready")):
        house = _House(algorithm)
        store = _store(house, 6)
        store.rf_train_if_used()
        await house.settle()
        run, conn = _snapshot_calibration(house)
        await run()
        cs = conn.send_result.call_args.args[1]["snapshot"]["calibration_status"]
        assert cs["rf_state"] == want, algorithm
        assert cs["rf_trained"] is (algorithm == "rf")
