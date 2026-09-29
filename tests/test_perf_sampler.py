"""The load sampler behind the opt-in report's env.hw / health.perf
(perf_sampler.py).

Garry, 2026-09-29: "Add load numbers and CPU info to opt-in for this type of
decision in future", "need to watch the pi installs for max outs". A sampler
that measures load must not BE load, must not outlive its integration, must
not stack a second timer on a reload, must never raise into Home Assistant,
and must keep working — with fewer numbers — where there is no /proc or no
getloadavg. These tests hold it to each of those, the math it reports, and
the summary that reads it on the server.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import random
import subprocess
import sys
import threading
import types
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import perf_sampler as ps
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

_ROOT = Path(__file__).resolve().parents[1]
_HW_READY = {"cpus": 4, "ram": "4g", "arch": "aarch64", "install": "os", "board": "rpi4", "ready": True}


# ── harness: a loop and an executor the test drives by hand ─────────────────

class _Handle:
    def __init__(self, when: float, cb) -> None:
        self.when, self.cb = when, cb
        self.cancelled = self.fired = False

    def cancel(self) -> None:
        self.cancelled = True


class _Loop:
    def __init__(self) -> None:
        self.t = 1000.0
        self.handles: list[_Handle] = []

    def time(self) -> float:
        return self.t

    def call_at(self, when: float, cb) -> _Handle:
        h = _Handle(when, cb)
        self.handles.append(h)
        return h

    def live(self) -> list[_Handle]:
        return [h for h in self.handles if not h.cancelled and not h.fired]

    def run_until(self, t: float) -> None:
        self.t = t
        for h in list(self.live()):
            if h.when <= t:
                h.fired = True
                h.cb()


class _Done:
    """A finished executor future: done-callbacks run at once."""

    def __init__(self, result=None, exc: BaseException | None = None) -> None:
        self._r, self._e = result, exc

    def add_done_callback(self, cb) -> None:
        cb(self)

    def cancelled(self) -> bool:
        return False

    def exception(self):
        return self._e

    def result(self):
        if self._e:
            raise self._e
        return self._r


class _Pending:
    """An executor future that has not come back."""

    def add_done_callback(self, cb) -> None:
        self.cb = cb


def _reading(mono: float = 0.0, cpu_s: float = 0.0, **kw) -> dict:
    r = {"mono": mono, "cpu_s": cpu_s, "cpus": 4, "load1": 1.0, "mem_avail_pct": 50.0,
         "swap_mb": 0.0, "rss_mb": 600.0}
    r.update(kw)
    return r


def _hass(enabled: bool = True, readings: list | None = None):
    h = SimpleNamespace()
    h.loop = _Loop()
    h.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": enabled}),
                       ps._DATA_HW: dict(_HW_READY)}}
    h.jobs = []
    queue = list(readings or [])

    def _job(fn, *args):
        h.jobs.append(fn)
        return _Done(queue.pop(0) if queue else _reading(mono=h.loop.t, cpu_s=h.loop.t * 0.1))

    h.async_add_executor_job = _job
    h.async_create_background_task = MagicMock()
    return h


def _set_enabled(h, on: bool) -> None:
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = on


# ── the histogram and the rounding ──────────────────────────────────────────

def test_percentiles_are_nearest_rank_to_within_the_bin_width():
    h = ps._Hist()
    assert h.quantile(0.5) is None, "nothing measured is not zero"
    for v in range(1, 1001):
        h.add(v)
    assert h.n == 1000 and h.lo == 1 and h.hi == 1000
    assert abs(h.quantile(0.50) - 500) / 500 < 0.02
    assert abs(h.quantile(0.95) - 950) / 950 < 0.02
    assert h.quantile(1.0) == 1000 and h.quantile(0.0) >= 1
    # zeros (an idle CPU, no swap) and junk
    z = ps._Hist()
    for v in (0, 0, 0, -5, 10):
        z.add(v)
    for bad in (float("nan"), float("inf"), None, "x"):
        z.add(bad)
    assert z.n == 5 and z.zeros == 4 and z.lo == 0.0
    assert z.quantile(0.5) == 0.0 and z.quantile(1.0) == 10


def test_memory_is_bounded_however_long_the_window():
    h = ps._Hist()
    rnd = random.Random(7)
    vals = [10 ** rnd.uniform(-2, 6) for _ in range(200_000)]
    for v in vals:
        h.add(v)
    assert h.n == 200_000
    assert len(h.bins) < 1000, "a sparse bin per 2% of range, not a list of samples"
    vals.sort()
    exact = vals[math.ceil(0.95 * len(vals)) - 1]
    assert abs(h.quantile(0.95) - exact) / exact < 0.02


def test_a_merged_window_is_the_same_as_one_window():
    a, b, both = ps.PerfWindow(started=10.0), ps.PerfWindow(started=5.0), ps.PerfWindow(started=5.0)
    for i in range(1, 50):
        a.add("lag", i); both.add("lag", i)
    for i in range(50, 120):
        b.add("lag", i); both.add("lag", i)
    a.samples, b.samples = 3, 4
    a.over["lag"], b.over["lag"] = 1, 2
    a.merge(b)
    assert a.started == 5.0 and a.samples == 7 and a.over["lag"] == 3
    assert a.hists["lag"].bins == both.hists["lag"].bins and a.hists["lag"].n == both.hists["lag"].n
    assert (a.hists["lag"].lo, a.hists["lag"].hi) == (1, 119)


@pytest.mark.parametrize("v,want", [(4123, 4100), (3.456, 3.5), (0.0123, 0.012), (99.6, 100), (9.96, 10),
                                    (0, 0), (-3, 0), (820.4, 820), (float("nan"), None), (None, None)])
def test_two_significant_figures(v, want):
    got = T._sig2(v)
    assert got == want and type(got) is type(want)


# ── the sampler's math ──────────────────────────────────────────────────────

def test_first_sample_is_a_baseline_then_cpu_is_time_over_wall_time():
    h = _hass()
    s = ps.PerfSampler(h)
    s.record(5.0, _reading(mono=100.0, cpu_s=10.0, load1=2.0, mem_avail_pct=40.0, rss_mb=512.0))
    w = ps.window(h)
    assert w.samples == 1
    assert w.hists["cpu"].n == 0, "one reading has no CPU delta: a baseline, never a 0%"
    assert w.hists["load"].hi == pytest.approx(50.0), "load 2 on 4 CPUs is 50% per CPU"
    assert w.hists["mem"].hi == 40.0 and w.hists["rss"].hi == 512.0 and w.hists["lag"].hi == 5.0
    s.record(5.0, _reading(mono=160.0, cpu_s=40.0))
    assert w.hists["cpu"].n == 1 and w.hists["cpu"].hi == pytest.approx(50.0), "30 s of CPU in 60 s"
    assert w.over == {"load": 0, "cpu": 0, "mem": 0, "lag": 0}


def test_each_max_out_counter_counts_samples_over_its_limit():
    h = _hass()
    s = ps.PerfSampler(h)
    s.record(0.0, _reading(mono=0.0, cpu_s=0.0))
    s.record(1500.0, _reading(mono=60.0, cpu_s=57.0, load1=6.0, mem_avail_pct=5.0))   # 95% CPU, 1.5/CPU
    s.record(999.0, _reading(mono=120.0, cpu_s=110.0, load1=4.0, mem_avail_pct=10.0))  # 88%, exactly 1/CPU
    w = ps.window(h)
    assert w.over == {"load": 1, "cpu": 1, "mem": 1, "lag": 1}, "limits are strict: 1.0/CPU and 10% do not count"


def test_a_cpu_delta_that_cannot_be_real_is_dropped():
    h = _hass()
    s = ps.PerfSampler(h)
    s.record(0, _reading(mono=100.0, cpu_s=50.0))
    s.record(0, _reading(mono=100.0, cpu_s=51.0))     # no wall time passed
    s.record(0, _reading(mono=160.0, cpu_s=1.0))      # CPU time went backwards
    assert ps.window(h).hists["cpu"].n == 0
    s.record(0, _reading(mono=220.0, cpu_s=7.0))
    assert ps.window(h).hists["cpu"].hi == pytest.approx(10.0)


def test_off_means_no_reading_and_no_cpu_delta_across_the_gap():
    h = _hass(enabled=False)
    ps.async_start(h)
    h.loop.run_until(1060.0)
    assert h.jobs == [] and ps.window(h).samples == 0, "nothing is read while the report is off"
    _set_enabled(h, True)
    h.loop.run_until(1120.0)
    h.loop.run_until(1180.0)
    assert ps.window(h).samples == 2 and ps.window(h).hists["cpu"].n == 1
    _set_enabled(h, False)
    h.loop.run_until(1240.0)
    assert h.data[DOMAIN][ps._DATA_SAMPLER]._last_cpu is None, "a CPU delta must never span time off"
    ps.record_duration(h, "snap", 1234.0)
    assert ps.window(h).hists["snap"].n == 0
    ps.async_stop(h)


def test_nothing_is_sampled_until_five_minutes_after_a_start_up():
    """A restart pegs a Pi while every integration loads; that is not the
    machine's load, and must not count as a max-out."""
    h = _hass()
    h.is_running = False                         # set up during Home Assistant's own start-up
    ps.async_start(h)
    h.loop.run_until(1060.0)
    h.loop.run_until(1120.0)
    assert h.jobs == [] and ps.window(h).samples == 0, "still starting"
    h.is_running = True
    h.loop.run_until(1180.0)                     # running from here: grace until 1480
    h.loop.run_until(1420.0)
    assert h.jobs == [] and ps.window(h).samples == 0
    h.loop.run_until(1480.0)
    h.loop.run_until(1540.0)
    assert ps.window(h).samples == 2 and ps.window(h).hists["cpu"].n == 1, "the first delta starts after the grace"
    ps.async_stop(h)


def test_a_reload_while_running_samples_at_once():
    h = _hass()
    h.is_running = True
    ps.async_start(h)
    h.loop.run_until(1060.0)
    assert ps.window(h).samples == 1
    ps.async_stop(h)


def test_opting_in_again_drops_the_cpu_reading_from_before():
    h = _hass()
    ps.async_start(h)
    h.loop.run_until(1060.0)
    assert h.data[DOMAIN][ps._DATA_SAMPLER]._last_cpu is not None
    ps.reset_window(h)
    assert h.data[DOMAIN][ps._DATA_SAMPLER]._last_cpu is None and ps.window(h).samples == 0
    ps.async_stop(h)


def test_a_disabled_reading_that_was_in_flight_is_dropped():
    h = _hass()
    s = ps.PerfSampler(h)
    _set_enabled(h, False)
    s.record(3.0, _reading())
    assert ps.window(h).samples == 0


# ── the timer ───────────────────────────────────────────────────────────────

def test_the_timer_measures_its_own_lateness_and_keeps_its_cadence():
    h = _hass()
    ps.async_start(h)
    assert len(h.loop.live()) == 1 and h.loop.live()[0].when == 1060.0
    h.loop.run_until(1060.25)
    w = ps.window(h)
    assert h.jobs == [ps.read_host], "the reads go to the executor, never the loop"
    assert w.samples == 1 and w.hists["lag"].hi == pytest.approx(250.0)
    assert [x.when for x in h.loop.live()] == [1120.0], "the next tick is on the 60 s grid, not 60 s after a late one"
    h.loop.run_until(1121.5)
    assert w.over["lag"] == 1
    h.loop.run_until(1500.0)                     # suspended for minutes: one tick, no burst of catch-ups
    assert w.samples == 3 and [x.when for x in h.loop.live()] == [1560.0]
    ps.async_stop(h)
    assert h.loop.live() == []


def test_a_read_still_in_flight_is_not_doubled_up():
    h = _hass()
    pending = []

    def _job(fn, *args):
        h.jobs.append(fn)
        p = _Pending()
        pending.append(p)
        return p

    h.async_add_executor_job = _job
    ps.async_start(h)
    h.loop.run_until(1060.0)
    h.loop.run_until(1120.0)
    assert len(h.jobs) == 1, "a slow executor gets one read, not a queue of them"
    pending[0].cb(_Done(_reading()))
    h.loop.run_until(1180.0)
    assert len(h.jobs) == 2 and ps.window(h).samples == 1
    ps.async_stop(h)


def test_setup_reload_and_unload_keep_exactly_one_timer(monkeypatch):
    """Through the integration's own entry points: async_setup_telemetry
    twice is one timer; async_stop_telemetry (unload) leaves none; setting up
    again (reload) is one again — and the day's window survives the reload."""
    ev = types.ModuleType("homeassistant.helpers.event")
    ev.async_call_later = lambda hass, delay, fn: (lambda: None)
    ev.async_track_time_interval = lambda hass, fn, interval: (lambda: None)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    h = _hass()
    T.async_setup_telemetry(h)
    first = h.data[DOMAIN][ps._DATA_SAMPLER]
    T.async_setup_telemetry(h)
    assert h.data[DOMAIN][ps._DATA_SAMPLER] is first and len(h.loop.live()) == 1
    h.loop.run_until(1060.0)
    assert ps.window(h).samples == 1 and len(h.loop.live()) == 1
    T.async_stop_telemetry(h)
    assert h.loop.live() == [] and ps._DATA_SAMPLER not in h.data[DOMAIN]
    first._on_timer()                               # a stray fire after unload does nothing
    assert h.loop.live() == [] and ps.window(h).samples == 1
    T.async_setup_telemetry(h)
    assert len(h.loop.live()) == 1 and h.data[DOMAIN][ps._DATA_SAMPLER] is not first
    assert ps.window(h).samples == 1, "a reload keeps the day's numbers"
    T.async_stop_telemetry(h)
    assert h.loop.live() == []


def test_the_wire_starts_and_stops_it():
    init = (_ROOT / "custom_components" / "padspan_ha" / "__init__.py").read_text(encoding="utf-8")
    assert "async_setup_telemetry(hass)" in init and "async_stop_telemetry(hass)" in init
    src = (_ROOT / "custom_components" / "padspan_ha" / "telemetry.py").read_text(encoding="utf-8")
    assert "perf_sampler.async_start(hass)" in src and "perf_sampler.async_stop(hass)" in src


async def test_on_a_real_event_loop_the_reads_run_off_the_loop(monkeypatch):
    monkeypatch.setattr(ps, "INTERVAL_S", 0.02)
    loop = asyncio.get_running_loop()
    threads: list[int] = []
    real = ps.read_host

    def _spy():
        threads.append(threading.get_ident())
        return real()

    monkeypatch.setattr(ps, "read_host", _spy)
    h = SimpleNamespace(loop=loop, data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True}),
                                                  ps._DATA_HW: dict(_HW_READY)}})
    h.async_add_executor_job = lambda fn, *a: loop.run_in_executor(None, fn, *a)
    h.async_create_background_task = lambda coro, name: loop.create_task(coro)
    ps.async_start(h)
    await asyncio.sleep(0.2)
    ps.async_stop(h)
    n = ps.window(h).samples
    assert n >= 2 and threads and threading.get_ident() not in threads
    assert ps.window(h).hists["cpu"].n >= 1
    await asyncio.sleep(0.1)
    assert ps.window(h).samples == n, "stopped means stopped"


# ── resilience ──────────────────────────────────────────────────────────────

def test_no_proc_and_no_getloadavg_still_samples(monkeypatch):
    monkeypatch.delattr(os, "getloadavg", raising=False)
    monkeypatch.setattr(ps, "_read_kb", lambda path, keys: {})
    r = ps.read_host()
    assert set(r) == {"mono", "cpu_s", "cpus"}
    h = _hass(readings=[r, ps.read_host()])
    s = ps.PerfSampler(h)
    s.record(1.0, r)
    w = ps.window(h)
    assert w.samples == 1 and w.hists["load"].n == 0 and w.hists["mem"].n == 0
    p = T._perf_payload(w, 4)
    assert set(p) == {"samples", "lag_ms", "over"}, p


def test_getloadavg_that_fails_is_skipped(monkeypatch):
    def _boom():
        raise OSError("no /proc/loadavg")
    monkeypatch.setattr(os, "getloadavg", _boom, raising=False)
    assert "load1" not in ps.read_host()


def test_proc_files_are_parsed(tmp_path):
    f = tmp_path / "meminfo"
    f.write_text("MemTotal:        3884368 kB\nMemFree:  100 kB\nMemAvailable:    1942184 kB\n"
                 "SwapTotal:  102396 kB\nSwapFree:  51198 kB\nbroken line\nVmRSS:\n", encoding="ascii")
    got = ps._read_kb(str(f), ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree", "VmRSS"))
    assert got == {"MemTotal": 3884368, "MemAvailable": 1942184, "SwapTotal": 102396, "SwapFree": 51198}
    assert ps._read_kb(str(tmp_path / "missing"), ("MemTotal",)) == {}


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="/proc is Linux's")
def test_on_linux_everything_is_read():
    r = ps.read_host()
    assert {"load1", "mem_avail_pct", "swap_mb", "rss_mb"} <= set(r)
    assert 0 < r["mem_avail_pct"] <= 100 and r["rss_mb"] > 1


def test_nothing_escapes_into_home_assistant():
    # the executor refuses the job
    h = _hass()
    def _refuse(fn, *a):
        raise RuntimeError("executor shut down")
    h.async_add_executor_job = _refuse
    ps.async_start(h)
    h.loop.run_until(1060.0)
    s = h.data[DOMAIN][ps._DATA_SAMPLER]
    assert s._busy is False and len(h.loop.live()) == 1, "the timer lives on"
    # the job itself raises
    h.async_add_executor_job = lambda fn, *a: _Done(exc=OSError("boom"))
    h.loop.run_until(1120.0)
    assert s._busy is False and ps.window(h).samples == 0
    # a reading of junk
    s.record(float("nan"), {"mono": "x", "cpu_s": None, "cpus": "four", "load1": "high"})
    ps.async_stop(h)
    # the loop cannot schedule
    h2 = _hass()
    ps.async_start(h2)
    h2.loop.call_at = MagicMock(side_effect=RuntimeError("loop closing"))
    h2.loop.run_until(1060.0)
    # no hass at all
    ps.record_duration(object(), "snap", 5.0)
    ps.async_start(object())
    ps.async_stop(object())
    ps.record_duration(SimpleNamespace(data={}), "snap", 5.0)


def test_nothing_on_the_event_loop_reads_a_file_or_asks_the_os(monkeypatch):
    """The loop side — the tick, folding a reading in, the timings, the
    report's shaping — only reads memory. Every file read and OS query is in
    read_host / _read_static, which only ever run in the executor."""
    calls: list[str] = []
    import builtins
    import platform
    real_open = builtins.open

    def _spy(name):
        def f(*a, **k):
            calls.append(name)
            raise AssertionError(f"{name} on the event loop")
        return f

    h = _hass()
    h.async_add_executor_job = lambda fn, *a: (h.jobs.append(fn), _Pending())[1]
    s = ps.PerfSampler(h)
    s.start()
    monkeypatch.setattr(builtins, "open", _spy("open"))
    for name in ("cpu_count", "sysconf", "getloadavg", "uname"):
        monkeypatch.setattr(os, name, _spy(name), raising=False)
    monkeypatch.setattr(platform, "machine", _spy("platform.machine"))
    try:
        h.loop.run_until(1060.0)
        s.record(3.0, _reading(mono=1.0))
        s.record(3.0, _reading(mono=61.0, cpu_s=6.0))
        ps.record_duration(h, "snap", 4100.0)
        hw = T._hw_payload(h)
        perf = T._perf_payload(ps.window(h), ps.cached_cpus(h) or 0)
    finally:
        monkeypatch.setattr(builtins, "open", real_open)
    assert calls == [], calls
    assert h.jobs == [ps.read_host]
    assert hw == {"cpus": 4, "ram": "4g", "arch": "aarch64", "install": "os", "board": "rpi4"}
    assert perf["samples"] == 0 and perf["snap_ms"]["max"] == 4100, "2 samples is under the half hour"


@pytest.mark.parametrize("n,want", [(0, 0), (29, 0), (31, 60), (1439, 1440), (1440, 1440), (757, 780)])
def test_samples_go_to_the_nearest_hour_so_a_restart_minute_does_not(n, want):
    w = ps.PerfWindow()
    w.samples = n
    assert T._perf_payload(w, 4)["samples"] == want


# ── the hardware class ──────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [
    ("rpi4-64", "rpi4"), ("rpi4", "rpi4"), ("raspberrypi4-64", "rpi4"), ("rpi5-64", "rpi5"),
    ("raspberrypi5-64", "rpi5"), ("rpi3-64", "rpi3"), ("rpi2", "rpi2"), ("rpi", "rpi_other"),
    ("green", "green"), ("yellow", "yellow"), ("odroid-n2", "odroid"), ("tinker", "tinker"),
    ("khadas-vim3", "khadas"), ("ova", "vm"), ("qemux86-64", "vm"), ("qemuarm-64", "vm"),
    ("generic-x86-64", "generic_x86_64"), ("intel-nuc", "generic_x86_64"), ("generic-aarch64", "generic_aarch64"),
    ("Garry's hand-built Pi, serial 10000000abcdef12", "other"), ("", "unknown"), (None, "unknown"),
])
def test_boards_map_to_fixed_words(raw, want):
    assert ps.board_class(raw) == want
    assert want in T.HW_VALUES["board"]


@pytest.mark.parametrize("model,want", [
    ("Raspberry Pi 5 Model B Rev 1.0", "rpi5"), ("Raspberry Pi 500 Rev 1.0", "rpi5"),
    ("Raspberry Pi Compute Module 5 Rev 1.0", "rpi5"), ("Raspberry Pi 4 Model B Rev 1.4", "rpi4"),
    ("Raspberry Pi 400 Rev 1.0", "rpi4"), ("Raspberry Pi Compute Module 4 Rev 1.0", "rpi4"),
    ("Raspberry Pi 3 Model B Plus Rev 1.3", "rpi3"), ("Raspberry Pi Zero 2 W Rev 1.0", "rpi3"),
    ("Raspberry Pi 2 Model B Rev 1.1", "rpi2"), ("Raspberry Pi Model B Rev 2", "rpi_other"),
    ("Hardkernel ODROID-N2Plus", "other"), ("", "unknown"),
])
def test_a_device_tree_model_becomes_a_class_and_never_travels(model, want):
    assert ps.board_from_model(model) == want


@pytest.mark.parametrize("machine,want", [
    ("x86_64", "x86_64"), ("AMD64", "x86_64"), ("aarch64", "aarch64"), ("arm64", "aarch64"),
    ("armv7l", "armv7"), ("armv8l", "armv7"), ("armv6l", "armv6"), ("i686", "x86"),
    ("riscv64", "other"), ("", "unknown"), (None, "unknown"),
])
def test_arch_is_normalized(machine, want):
    assert ps.arch_class(machine) == want and want in T.HW_VALUES["arch"]


@pytest.mark.parametrize("gib,want", [(0.9, "1g"), (1.9, "2g"), (3.8, "4g"), (4.0, "4g"), (7.6, "8g"),
                                      (15.5, "16g"), (31, "16g+"), (None, "unknown"), (0, "unknown")])
def test_ram_buckets_are_the_size_it_is_sold_as(gib, want):
    assert ps.ram_bucket(None if gib is None else gib * 1024 ** 3) == want and want in T.HW_VALUES["ram"]


@pytest.mark.parametrize("t,want", [("Home Assistant OS", "os"), ("Home Assistant Supervised", "supervised"),
                                    ("Home Assistant Container", "container"),
                                    ("Unsupported Third Party Container", "container"),
                                    ("Home Assistant Core", "core"), ("Unknown", "unknown"),
                                    ("Garry's custom build", "other"), (None, "unknown")])
def test_installation_types_map_to_fixed_words(t, want):
    assert ps.install_class(t) == want and want in T.HW_VALUES["install"]


def _detect_hass(components=("hassio",)):
    h = SimpleNamespace(data={DOMAIN: {}}, config=SimpleNamespace(components=set(components)))

    async def _job(fn, *a):
        return fn(*a)

    h.async_add_executor_job = _job
    return h


def test_the_supervisor_board_is_used_once_its_info_has_loaded(monkeypatch):
    info: dict = {"v": None}
    asked = {"system_info": 0, "static": []}
    hassio = types.ModuleType("fake_hassio")     # HA 2026.1+: no is_hassio in this module
    hassio.get_info = lambda hass: info["v"]
    hassio.get_os_info = lambda hass: {"board": "rpi4-64", "version": "16.2"}
    monkeypatch.setattr(sys.modules["homeassistant.components"], "hassio", hassio, raising=False)
    si = types.ModuleType("homeassistant.helpers.system_info")

    async def _si(hass):
        asked["system_info"] += 1
        return {"installation_type": "Home Assistant OS", "hostname": "garrys-pi", "user": "root"}

    si.async_get_system_info = _si
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.system_info", si)

    def _static(want_model):
        asked["static"].append(want_model)
        return {"cpus": 4, "ram_bytes": int(3.8 * 1024 ** 3), "machine": "aarch64", "model": ""}

    monkeypatch.setattr(ps, "_read_static", _static)
    h = _detect_hass()
    assert asyncio.run(ps.async_ensure_hw(h)) is False, "the Supervisor has not answered yet"
    assert asked["system_info"] == 0, "system_info would log a warning with no Supervisor info"
    assert ps.hw_class(h)["board"] == "unknown" and ps.hw_class(h)["cpus"] == 4
    info["v"] = {"hassos": "16.2", "machine": "raspberrypi4-64"}
    assert asyncio.run(ps.async_ensure_hw(h)) is True
    assert ps.hw_class(h) == {"cpus": 4, "ram": "4g", "arch": "aarch64", "install": "os", "board": "rpi4"}
    assert asked["static"] == [False, False], "no device-tree read where the Supervisor knows the board"
    assert asyncio.run(ps.async_ensure_hw(h)) is True and asked["system_info"] == 1, "once, then cached"
    assert "garrys-pi" not in json.dumps(h.data[DOMAIN][ps._DATA_HW])


def test_a_pi_without_a_supervisor_is_found_by_its_device_tree(monkeypatch):
    hassio = types.ModuleType("fake_hassio")

    def _never(hass):
        raise AssertionError("the Supervisor integration is not loaded: do not import or ask it")

    hassio.get_info = hassio.get_os_info = _never
    monkeypatch.setattr(sys.modules["homeassistant.components"], "hassio", hassio, raising=False)
    si = types.ModuleType("homeassistant.helpers.system_info")

    async def _si(hass):
        return {"installation_type": "Home Assistant Container"}

    si.async_get_system_info = _si
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.system_info", si)
    model = "Raspberry Pi 5 Model B Rev 1.0"
    monkeypatch.setattr(ps, "_read_static", lambda want: {"cpus": 4, "ram_bytes": 8 * 1024 ** 3 - 1,
                                                          "machine": "aarch64", "model": model if want else ""})
    h = _detect_hass(components=("http", "frontend"))
    assert asyncio.run(ps.async_ensure_hw(h)) is True
    assert ps.hw_class(h) == {"cpus": 4, "ram": "8g", "arch": "aarch64", "install": "container", "board": "rpi5"}
    assert model not in json.dumps(h.data[DOMAIN][ps._DATA_HW])


def test_detection_that_fails_everywhere_is_unknown_not_an_error(monkeypatch):
    hassio = types.ModuleType("fake_hassio")

    def _boom(hass):
        raise RuntimeError("no hassio")

    hassio.get_info = hassio.get_os_info = _boom
    monkeypatch.setattr(sys.modules["homeassistant.components"], "hassio", hassio, raising=False)
    monkeypatch.delitem(sys.modules, "homeassistant.helpers.system_info", raising=False)
    h = SimpleNamespace(data={DOMAIN: {}}, config=SimpleNamespace(components={"hassio"}),
                        async_add_executor_job=MagicMock(side_effect=RuntimeError("no executor")))
    assert asyncio.run(ps.async_ensure_hw(h)) is False, "not ready: the sampler asks again, _HW_TRIES times"
    assert ps.hw_class(h) == {"cpus": 0, "ram": "unknown", "arch": "unknown", "install": "unknown", "board": "unknown"}
    T.assert_shareable({"schema": 1, "install_id": "", "env": {"hw": T._hw_payload(h)}})


def test_the_vocabularies_agree():
    assert tuple(T.PERF_OVER) == ps.OVER
    assert {m for m, _ in T.PERF_METRICS.values()} <= set(ps.METRICS)
    assert set(T.HW_VALUES) | {"cpus"} == set(ps.hw_class(SimpleNamespace(data={})))


# ── what it times ───────────────────────────────────────────────────────────

async def test_snapshot_builds_are_timed_only_while_the_report_is_on(monkeypatch):
    from custom_components.padspan_ha import snapshot_builder as sb

    async def _build(hass):
        await asyncio.sleep(0.01)
        return {"source": "live"}

    monkeypatch.setattr(sb, "_build_live_snapshot", _build)
    h = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": False})}})
    await sb._live_snapshot(h)
    assert ps.window(h).hists["snap"].n == 0
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = True
    sb._invalidate_snapshot_cache(h)
    snap = await sb._live_snapshot(h)
    assert snap == {"source": "live"} and ps.window(h).hists["snap"].n == 1
    assert ps.window(h).hists["snap"].hi >= 5.0
    await sb._live_snapshot(h)                     # served from the cache: not a build
    assert ps.window(h).hists["snap"].n == 1

    async def _broken(hass):
        raise RuntimeError("builder bug")

    monkeypatch.setattr(sb, "_build_live_snapshot", _broken)
    sb._invalidate_snapshot_cache(h)
    with pytest.raises(RuntimeError, match="builder bug"):
        await sb._live_snapshot(h)                 # behaviour unchanged: the error is the caller's
    assert ps.window(h).hists["snap"].n == 1


def test_presence_polls_are_timed_and_otherwise_unchanged(monkeypatch):
    from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}}
    coord = PresenceCoordinator(hass)
    result = {"obj": {"room": "x"}}

    async def _poll():
        return result

    monkeypatch.setattr(coord, "_async_poll", _poll)
    assert asyncio.run(coord._async_update_data()) is result
    assert ps.window(hass).hists["cycle"].n == 1

    async def _fails():
        raise ValueError("poll failed")

    monkeypatch.setattr(coord, "_async_poll", _fails)
    with pytest.raises(ValueError, match="poll failed"):
        asyncio.run(coord._async_update_data())
    assert ps.window(hass).hists["cycle"].n == 2


# ── the server's summary ────────────────────────────────────────────────────

def _summary(tmp_path, *reports) -> str:
    script = _ROOT / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    d = tmp_path / f"r{len(list(tmp_path.iterdir()))}"
    d.mkdir()
    day = date.today().isoformat()
    (d / f"{day}.jsonl").write_text("".join(json.dumps({"recv_day": day, "report": r}) + "\n" for r in reports),
                                    encoding="utf-8")
    out = subprocess.run([sys.executable, str(script), str(d)], capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=60)
    assert out.returncode == 0, out.stderr
    return out.stdout[out.stdout.index("Load and hardware"):].split("\n\n")[0]


def _perf(cpu95, load95, lag95, snap95, samples=1440, **over):
    return {"samples": samples, "cpu_pc": {"p50": 9, "p95": cpu95, "max": 99},
            "load_pc": {"p50": 20, "p95": load95, "max": 180}, "lag_ms": {"p50": 1.2, "p95": lag95, "max": 900},
            "snap_ms": {"p50": 1200, "p95": snap95, "max": 8200, "per_h": 360},
            "over": {"load": 0, "cpu": 0, "mem": 0, "lag": 0, **over}}


def test_a_crafted_hardware_block_does_not_crash_the_summary(tmp_path):
    bad = {"install_id": "eeeeeeee-1111-4111-8111-111111111111", "version": "0.38.91", "day": "2026-09-29",
           "env": {"hw": {"board": ["rpi4"], "cpus": {"n": 4}, "ram": ["4g"]}},
           "health": {"perf": {"samples": [1], "over": {"load": "x"}}}}
    s = _summary(tmp_path, bad)
    assert "1  / 1" in s, s


def test_the_summary_says_not_reported_for_older_builds(tmp_path):
    old = {"install_id": "11111111-1111-4111-8111-111111111111", "version": "0.38.90", "day": "2026-09-29",
           "env": {"scanners": 2}, "health": {"crypto_ok": True}}
    s = _summary(tmp_path, old)
    assert "installs reporting hardware" in s and "0  / 1" in s and "1 not reported: older builds" in s, s


def test_the_summary_groups_by_class_and_puts_the_pis_first(tmp_path):
    day = date.today().isoformat()
    pi_hw = {"cpus": 4, "ram": "4g", "arch": "aarch64", "install": "os", "board": "rpi4"}
    vm_hw = {"cpus": 6, "ram": "16g", "arch": "x86_64", "install": "os", "board": "vm"}
    pi_a = {"install_id": "aaaaaaaa-1111-4111-8111-111111111111", "version": "0.38.91", "day": day,
            "env": {"hw": pi_hw}, "health": {"perf": _perf(95, 140, 40, 7800, load=12, cpu=3)}}
    # the same install again that day, after "Send a report now": minutes, not the day
    pi_a2 = {**pi_a, "health": {"perf": _perf(5, 10, 1, 900, samples=4, lag=1)}}
    pi_b = {"install_id": "bbbbbbbb-1111-4111-8111-111111111111", "version": "0.38.91", "day": day,
            "env": {"hw": pi_hw}, "health": {"perf": _perf(35, 60, 3.1, 4100)}}
    vm = {"install_id": "cccccccc-1111-4111-8111-111111111111", "version": "0.38.91", "day": day,
          "env": {"hw": vm_hw}, "health": {"perf": _perf(9, 10, 0.8, 1100)}}
    old = {"install_id": "dddddddd-1111-4111-8111-111111111111", "version": "0.38.90", "day": day,
           "env": {"scanners": 1}, "health": {}}
    s = _summary(tmp_path, vm, pi_a, pi_a2, pi_b, old)
    assert "3  / 4" in s and "1 not reported" in s, s
    assert "[Pi] rpi4 2" in s and "vm 1" in s, s
    pi_at, vm_at = s.index("[Pi] rpi4 / 4 cpu / 4g RAM: 2 installs"), s.index("vm / 6 cpu / 16g RAM: 1 installs")
    assert pi_at < vm_at, "Raspberry Pi classes first\n" + s
    pi_block = s[pi_at:vm_at]
    # one row per install-day, the one that covered the day: 95 and 35, not the 4-sample 5
    assert "median 35" in pi_block and "max 95" in pi_block and "(2 install-days)" in pi_block, pi_block
    assert "load > 1/CPU 1/2" in pi_block and "HA > 90% core 1/2" in pi_block, pi_block
    assert "loop lag > 1 s 1/2" in pi_block, "a limit hit in ANY report of the window counts\n" + pi_block
    assert "mem < 10% free 0/2" in pi_block, pi_block
    assert "load > 1/CPU 0/1" in s[vm_at:], s


def test_the_summary_survives_a_class_with_no_figures_yet(tmp_path):
    day = date.today().isoformat()
    r = {"install_id": "eeeeeeee-1111-4111-8111-111111111111", "version": "0.38.91", "day": day,
         "env": {"hw": {"cpus": 4, "ram": "2g", "arch": "armv7", "install": "container", "board": "rpi3"}},
         "health": {"perf": {"samples": 0}}}
    s = _summary(tmp_path, r)
    assert "[Pi] rpi3 / 4 cpu / 2g RAM: 1 installs" in s and "not reported" in s, s
