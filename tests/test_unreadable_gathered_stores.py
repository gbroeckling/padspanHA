"""The object history, the opt-in report's run log and its usage counters
load through safe_store.async_load_readable, as the other stores do: a file
holding the wrong kind of data is set aside and said, not started empty and
written over by the next save. (tests_ha/test_unreadable_store.py holds the
same with real files in a real Home Assistant.)"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import perf_sampler, safe_store, snapshot_builder, telemetry
from custom_components.padspan_ha.const import DOMAIN


class _Store:
    def __init__(self, key, data):
        self.key, self.path, self._data, self.saved = key, f"/nowhere/.storage/{key}", data, []

        async def _exec(fn, *a):
            return fn(*a)
        self.hass = SimpleNamespace(async_add_executor_job=_exec)

    async def async_load(self):
        return self._data

    async def async_save(self, data):
        self.saved.append(data)


@pytest.fixture
def set_aside(monkeypatch):
    seen: list[str] = []

    async def _aside(raw, what):
        seen.append(raw.key)
        return None
    monkeypatch.setattr(safe_store, "_set_aside", _aside)
    return seen


def _history(data):
    return asyncio.run(snapshot_builder.async_load_object_history(_Store("padspan_ha.object_history", data)))


def _runs(data):
    st = _Store("padspan_ha.perf_runs", data)
    log = perf_sampler.RunLog(SimpleNamespace(), store=st)
    asyncio.run(log.async_begin(True))
    return log, st


def _counters(data, monkeypatch):
    st = _Store("padspan_ha.telemetry_counters", data)
    hass = SimpleNamespace(data={DOMAIN: {telemetry._DATA_COUNTERS_STORE: st}})
    monkeypatch.setattr(telemetry, "_persist_counters", lambda *a, **k: None)
    monkeypatch.setattr(telemetry, "enabled", lambda h: True)
    asyncio.run(telemetry.async_restore_counters(hass))
    return hass


@pytest.mark.parametrize("wrong", [[], [1, 2], "text", 5])
def test_object_history_of_the_wrong_kind_is_set_aside(set_aside, wrong):
    assert _history(wrong) == {} and set_aside == ["padspan_ha.object_history"]


def test_object_history_it_reads_is_kept(set_aside):
    assert _history({"ble:AA": {"name": "x"}}) == {"ble:AA": {"name": "x"}} and _history(None) == {}
    assert set_aside == []


@pytest.mark.parametrize("wrong", [[], [1, 2], "text", 5])
def test_a_run_log_of_the_wrong_kind_is_set_aside(set_aside, wrong):
    log, st = _runs(wrong)
    assert set_aside == ["padspan_ha.perf_runs"] and log.data["starts"] == 1 and log.data["unclean"] == 0


def test_a_run_log_it_reads_is_kept(set_aside):
    log, _st = _runs({"running": True, "starts": 4, "unclean": 1})
    assert set_aside == [] and log.data["starts"] == 5 and log.data["unclean"] == 2


@pytest.mark.parametrize("wrong", [[], [1, 2], "text", 5])
def test_usage_counters_of_the_wrong_kind_are_set_aside(set_aside, wrong, monkeypatch):
    _counters(wrong, monkeypatch)
    assert set_aside == ["padspan_ha.telemetry_counters"]


def test_usage_counters_it_reads_are_kept(set_aside, monkeypatch):
    _counters({"counters": {}}, monkeypatch)
    assert set_aside == []
