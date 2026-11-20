"""The calibration accuracy's leave-one-out runs in the executor.

It compares every calibration point with every other: 1-8 s at 500-1,000
points. Layout checks (fabric_health), the propagation grade
(propagation_health), the system critics and the calibration page's model
each asked for it on Home Assistant's event loop, which waits for nothing
else meanwhile; the Health page asks every 30 s while it is open.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace as NS
from typing import Any

import pytest

from custom_components.padspan_ha import calibration_store as cs
from custom_components.padspan_ha import ws_calibration, ws_diagnostics, ws_fabric
from custom_components.padspan_ha.const import DATA_CALIBRATION, DATA_SETTINGS, DOMAIN
from tests.test_calibration_store import _loo_as_it_was, _make_store, _random_points


def _house(points: list[dict]) -> tuple[Any, Any, list[str]]:
    jobs: list[str] = []

    async def _job(fn, *args):
        jobs.append(getattr(fn, "__name__", repr(fn)))
        return fn(*args)

    store = _make_store(points=points)
    hass = NS(data={DOMAIN: {DATA_CALIBRATION: store, DATA_SETTINGS: NS(data={})}},
              states=NS(async_all=lambda *a: [], get=lambda _e: None),
              async_add_executor_job=_job)
    store.hass = hass
    return hass, store, jobs


def _ask(handler: Any, hass: Any) -> dict:
    out: dict = {}
    conn = NS(send_result=lambda _i, p: out.update(p), send_error=lambda *a: out.update(error=a),
              user=NS(is_admin=True))
    asyncio.run(handler(hass, conn, {"id": 1, "type": "x"}))
    return out


@pytest.mark.parametrize("handler", [ws_fabric.ws_fabric_health, ws_diagnostics.ws_propagation_health,
                                     ws_diagnostics.ws_system_critics])
def test_each_health_check_compares_the_points_in_the_executor(handler: Any) -> None:
    hass, store, jobs = _house(_random_points(30, 21))
    _ask(handler, hass)
    assert "_loo_knn" in jobs


def test_the_calibration_page_model_compares_them_in_the_executor() -> None:
    hass, store, jobs = _house(_random_points(30, 22))
    store.store.async_save = lambda *_a: asyncio.sleep(0)
    _ask(ws_calibration.ws_calibration_compute_model, hass)
    assert "_loo_knn" in jobs


def test_the_answer_is_the_same_and_kept_for_the_loop() -> None:
    hass, store, jobs = _house(_random_points(40, 23))
    got = asyncio.run(store.async_loo_accuracy())
    assert got == _loo_as_it_was(store)
    jobs.clear()
    assert store.loo_accuracy() == got          # found kept: no comparison on the loop
    assert asyncio.run(store.async_loo_accuracy()) == got
    assert jobs == []


def test_the_job_reads_only_its_copies() -> None:
    """A point changed while the job runs changes nothing it reads."""
    hass, store, jobs = _house(_random_points(30, 24))
    prep = store._loo_inputs(None)
    before = cs._loo_knn(*prep[1:])
    for p in store.data["points"]:
        p["x_m"] = 0.0
        p["scanner_readings"].clear()
    assert cs._loo_knn(*prep[1:]) == before
