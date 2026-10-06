"""PadSpan's own size, the run log and the panels' measurements in the
opt-in report (perf_sampler.py, telemetry.py, www/padspan-ha/client_perf.js).

Garry, 2026-10-05, after a 2 GB Pi on a busy street ran out of memory within
hours: the low-memory version "should force a more safe object max count";
"I will of course need to know if a 2gb pi can be fixed with this switch in
settings, make sure the opt-in gives enough feedback to make that
determination"; and whether a low-memory machine has to give up the Atlas or
the 3D house "must be clear before anyone pays for pro". These tests hold the
report to carrying each of those, to the closed lists, and to costing nothing
while it is off.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections import deque
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import perf_sampler as ps
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.bluetooth_live import DATA_KEY as BL_KEY, _Adv, _now
from custom_components.padspan_ha.const import DATA_ESPRESENSE_MQTT, DATA_OBJECT_HISTORY, DOMAIN
from tests.test_perf_sampler import _hass, _set_enabled

_ROOT = Path(__file__).resolve().parents[1]
_JS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "client_perf.js"


# ── a house on a busy street ────────────────────────────────────────────────

def _obj(i: int) -> dict:
    mac = f"C0:{i >> 16 & 255:02X}:{i >> 8 & 255:02X}:{i & 255:02X}:00:01"
    return {"key": f"ble:{mac}", "kind": "ble", "address": mac, "name": mac, "rssi": -80, "age_s": 12.0,
            "sources": [{"source": "proxy_a", "rssi": -80, "age_s": 12.0}],
            "manufacturer_data": {"76": "0215" + "ab" * 20}, "service_data": {}, "service_uuids": [],
            "identified": False, "linked_entities": [], "device": None}


def _street(h, n_hist: int = 300, n_ble: int = 400, old: int = 100, sources: int = 3) -> None:
    """`n_hist` objects in the history and the snapshot, `n_ble` addresses in
    the Bluetooth cache of which `old` were last heard 20 minutes ago."""
    dom = h.data[DOMAIN]
    hist = {o["key"]: o for o in (_obj(i) for i in range(n_hist))}
    dom[DATA_OBJECT_HISTORY] = hist
    now = _now()
    seen, samples = {}, {}
    for i in range(n_ble):
        mac = f"D0:00:{i >> 8 & 255:02X}:{i & 255:02X}:00:02"
        at = now - timedelta(minutes=20 if i < old else 1)
        seen[mac] = {f"proxy_{s}": _Adv(record={"address": mac, "source": f"proxy_{s}", "rssi": -70 - s,
                                                  "name": None, "manufacturer_data": {"6": "01" * 12}},
                                          seen=at) for s in range(sources)}
        samples[mac] = {f"proxy_{s}": deque([(at, -70.0)] * 5, maxlen=32) for s in range(sources)}
    dom[BL_KEY] = SimpleNamespace(_seen_by_source=seen, _rssi_samples=samples, new_addresses=n_ble)
    ads = [dict(a.record, age_s=60.0) for m in list(seen)[:50] for a in seen[m].values()]
    snap_objs = [dict(o) for o in hist.values()]
    dom["snapshot_cache"] = (0.0, {"objects": {"list": snap_objs, "summary": {"total": len(snap_objs)}},
                                   "ble": {"advertisements": ads, "radios": []}})
    dom[DATA_ESPRESENSE_MQTT] = SimpleNamespace(_seen={f"esp{i}": {} for i in range(7)})


# ── what it measures ────────────────────────────────────────────────────────

def test_a_shared_value_is_counted_once_and_seen_gives_a_copys_own_cost():
    big = "x" * 10_000
    a = {"k": big}
    b = {"k": big}
    together = ps.deep_bytes([a, b])
    assert together < ps.deep_bytes(a) + ps.deep_bytes(b)            # the string once
    seen: set[int] = set()
    ps.deep_bytes(a, seen=seen)
    copy_cost = ps.deep_bytes(dict(a), seen=seen)
    assert copy_cost < 1_000 < ps.deep_bytes(a)                      # a shallow copy is its dict, not the string


def test_padspan_sizes_counts_shares_and_estimates():
    h = _hass()
    _street(h, n_hist=300, n_ble=400, old=100, sources=3)
    kb: dict = {}
    out = ps.padspan_sizes(h, kb, estimate=True)
    assert out["objects"] == 300 and out["history"] == 300 and out["ble_addrs"] == 400 and out["esp_addrs"] == 7
    assert out["ble_old"] == pytest.approx(25.0)                     # 100 of 400 not heard for 15 min
    assert 0.3 < out["obj_kb"] < 20 and out["history_mb"] == pytest.approx(out["obj_kb"] * 300 / 1024)
    assert out["ble_mb"] > 0 and out["snap_mb"] > 0 and out["snap_json_mb"] > 0
    # the snapshot's copies cost less than the history they were copied from
    assert out["snap_mb"] < out["history_mb"]
    # the next look reuses the hourly per-entry sizes, scaled by today's counts
    h.data[DOMAIN][DATA_OBJECT_HISTORY].update({f"x{i}": _obj(10_000 + i) for i in range(300)})
    again = ps.padspan_sizes(h, kb, estimate=False)
    assert again["history"] == 600 and again["history_mb"] == pytest.approx(out["history_mb"] * 2)


def test_a_house_with_nothing_built_yet_reports_only_what_it_has():
    h = _hass()
    assert ps.padspan_sizes(h, {}, estimate=True) == {}
    h.data[DOMAIN][DATA_OBJECT_HISTORY] = {}
    assert ps.padspan_sizes(h, {}, estimate=True) == {"history": 0}


def test_sizes_go_into_the_window_only_while_the_report_is_on():
    h = _hass(enabled=False)
    _street(h)
    s = ps.PerfSampler(h)
    s.start()
    h.loop.run_until(h.loop.t + 60)
    assert ps.window(h).hists["objects"].n == 0
    _set_enabled(h, True)
    h.loop.run_until(h.loop.t + 60)
    w = ps.window(h)
    for m in ("objects", "history", "obj_kb", "history_mb", "ble_addrs", "ble_mb", "ble_old", "esp_addrs",
              "snap_mb", "snap_json_mb"):
        assert w.hists[m].n == 1, m


def test_new_addresses_and_snapshot_requests_are_rates_per_hour():
    h = _hass()
    _street(h)
    s = ps.PerfSampler(h)
    s.start()
    h.loop.run_until(h.loop.t + 60)                                  # baseline
    h.data[DOMAIN][BL_KEY].new_addresses += 50                       # 50 new in a minute
    for _ in range(12):
        ps.note_snapshot_request(h)                                  # one panel, every 5 s
    h.loop.run_until(h.loop.t + 60)
    w = ps.window(h)
    assert w.hists["ble_new"].hi == pytest.approx(3000, rel=0.02)
    assert w.hists["snap_req"].hi == pytest.approx(720, rel=0.02)
    # a cache made again (a reload) is not a burst of new addresses
    h.data[DOMAIN][BL_KEY] = SimpleNamespace(_seen_by_source={}, _rssi_samples={}, new_addresses=5)
    h.loop.run_until(h.loop.t + 60)
    assert w.hists["ble_new"].n == 1


def test_each_minute_counts_for_the_views_on_screen():
    h = _hass()
    s = ps.PerfSampler(h)
    t0 = h.loop.t
    ps.note_view(h, "sim")
    ps.note_view(h, "not-a-view")
    assert ps.views_on_screen(h, t0 + 30) == ("sim",)
    assert ps.views_on_screen(h, t0 + ps.VIEW_HOLD_S + 1) == ("none",)
    s.record(5.0, {"mono": 0.0, "cpu_s": 0.0, "rss_mb": 700.0}, ("sim",))
    s.record(9.0, {"mono": 60.0, "cpu_s": 30.0, "rss_mb": 900.0}, ("atlas", "sim"))
    w = ps.window(h)
    assert w.hists["lag@sim"].n == 2 and w.hists["lag@atlas"].n == 1 and w.hists["lag@none"].n == 0
    assert w.hists["cpu@atlas"].hi == pytest.approx(50.0) and w.hists["rss@sim"].hi == 900.0


def test_the_heartbeat_is_the_fps_event():
    from custom_components.padspan_ha import ws_telemetry
    h = _hass()
    h.data[DOMAIN]["telemetry_counters"] = {}
    sent = []
    conn = SimpleNamespace(send_result=lambda i, r: sent.append(r))
    asyncio.run(ws_telemetry.ws_telemetry_event(h, conn, {"id": 1, "event": "client_fps:atlas:24_45"}))
    asyncio.run(ws_telemetry.ws_telemetry_event(h, conn, {"id": 2, "event": "client_fps:garage:24_45"}))
    assert sent == [{"counted": True}, {"counted": False}]
    assert ps.views_on_screen(h, h.loop.t) == ("atlas",)


# ── the run log ─────────────────────────────────────────────────────────────

class _Store:
    def __init__(self, data=None):
        self.data, self.writes, self.removed = data, 0, False

    async def async_load(self):
        return self.data

    async def async_save(self, data):
        self.data, self.writes = json.loads(json.dumps(data)), self.writes + 1

    def async_delay_save(self, fn, delay):
        self.data, self.writes = json.loads(json.dumps(fn())), self.writes + 1

    async def async_remove(self):
        self.data, self.removed = None, True


def test_a_start_after_a_clean_stop_is_a_start_and_after_a_crash_is_unclean_too():
    store = _Store()
    log = ps.RunLog(_hass(), store)
    asyncio.run(log.async_begin(True))
    assert store.data == {"running": True, "starts": 1, "unclean": 0}
    asyncio.run(log.async_stopping())
    assert store.data["running"] is False
    log2 = ps.RunLog(_hass(), store)                                 # the next process
    asyncio.run(log2.async_begin(True))
    assert store.data == {"running": True, "starts": 2, "unclean": 0}
    log3 = ps.RunLog(_hass(), store)                                 # killed: no stop was written
    asyncio.run(log3.async_begin(True))
    assert store.data["starts"] == 3 and store.data["unclean"] == 1
    log4 = ps.RunLog(_hass(), store)                                 # a reload, not a start
    asyncio.run(log4.async_begin(False))
    assert store.data["starts"] == 3 and store.data["unclean"] == 2


def test_the_worst_minutes_survive_the_crash_that_follows_them():
    store = _Store()
    log = ps.RunLog(_hass(), store)
    asyncio.run(log.async_begin(True))
    for rss in (600, 610, 620, 900, 1500):
        log.observe("rss_mb", rss)
    log.observe("mem_avail_pc", 40)
    log.observe("mem_avail_pc", 39.5)                                # under a point: not worth a write
    log.observe("mem_avail_pc", 3)
    log.observe("objects_n", 25000)
    log.observe("garage_door", 1)
    log.observe("rss_mb", float("nan"))
    assert store.data["rss_mb"] == 1500 and store.data["mem_avail_pc"] == 3 and store.data["objects_n"] == 25000
    writes = store.writes
    for rss in range(1500, 1550):
        log.observe("rss_mb", rss)                                   # creeping up 3%: no new write
    assert store.writes == writes
    after = ps.RunLog(_hass(), store)                                # the process died there
    asyncio.run(after.async_begin(True))
    assert after.peek() == {"starts": 2, "unclean": 1, "rss_mb": 1500.0, "mem_avail_pc": 3.0,
                            "objects_n": 25000.0}


def test_a_send_takes_the_log_and_a_failed_send_gives_it_back():
    h = _hass()
    store = _Store()
    log = h.data[DOMAIN][ps._DATA_RUNS] = ps.RunLog(h, store)
    asyncio.run(log.async_begin(True))
    log.observe("rss_mb", 1200)
    w = ps.take_window(h)
    assert w.runs == {"starts": 1, "unclean": 0, "rss_mb": 1200.0}
    assert log.peek() == {"starts": 0, "unclean": 0} and store.data["running"] is True
    log.observe("rss_mb", 800)
    ps.give_back_window(h, w)
    assert log.peek() == {"starts": 1, "unclean": 0, "rss_mb": 1200.0}


def test_opting_in_starts_an_empty_log_and_opting_out_deletes_it(monkeypatch):
    h = _hass()
    store = _Store({"running": True, "starts": 9, "unclean": 4, "rss_mb": 1900.0})
    monkeypatch.setattr(ps, "_runs_store", lambda hass: store)
    asyncio.run(ps.async_runs_opted_in(h))
    assert store.data == {"running": True, "starts": 0, "unclean": 0}
    asyncio.run(ps.async_runs_opted_out(h))
    assert store.removed and ps.run_log(h) is None


def test_the_log_starts_once_per_process_and_only_while_the_report_is_on(monkeypatch):
    stores = []
    monkeypatch.setattr(ps, "_runs_store", lambda hass: stores.append(_Store()) or stores[-1])
    listeners, tasks = [], []
    h = _hass(enabled=False)
    h.bus = SimpleNamespace(async_listen_once=lambda ev, cb: listeners.append((ev, cb)) or (lambda: None))
    h.async_create_background_task = lambda coro, name: tasks.append(coro)
    h.is_running = False
    ps._start_runs(h)
    assert len(listeners) == 1 and not tasks and ps.run_log(h) is None     # off: listens, logs nothing
    _set_enabled(h, True)
    ps._start_runs(h)
    ps._start_runs(h)                                                # a reload: no second log
    assert len(listeners) == 1 and len(tasks) == 1
    asyncio.run(tasks[0])
    assert stores[0].data == {"running": True, "starts": 1, "unclean": 0}
    asyncio.run(listeners[0][1](None))                               # Home Assistant stops
    assert stores[0].data["running"] is False


# ── in the report ───────────────────────────────────────────────────────────

def test_the_runs_section_is_rounded_closed_and_checked():
    h = _hass()
    log = h.data[DOMAIN][ps._DATA_RUNS] = ps.RunLog(h, _Store())
    asyncio.run(log.async_begin(True))
    for k, v in (("rss_mb", 1234.5), ("mem_avail_pc", 4.4), ("swap_mb", 312.0), ("objects_n", 25321),
                 ("history_n", 24999), ("ble_addrs_n", 61234)):
        log.observe(k, v)
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["health"]["runs"] == {"starts": 1, "unclean": 0, "rss_mb": 1200, "mem_avail_pc": 4,
                                   "swap_mb": 310, "objects_n": 25000, "history_n": 25000, "ble_addrs_n": 61000}
    q = json.loads(json.dumps(p))
    q["health"]["runs"]["hostname"] = 1
    with pytest.raises(ValueError, match="health.runs"):
        T.assert_shareable(q)
    q = json.loads(json.dumps(p))
    q["health"]["runs"]["starts"] = "garrys-pi"
    with pytest.raises(ValueError):
        T.assert_shareable(q)


def test_the_vocabularies_agree():
    assert T.RUNS_KEYS == ("starts", "unclean", *ps.RUN_PEAKS)
    assert {m for m, _ in T.PERF_METRICS.values()} <= set(ps.METRICS)
    src = _JS.read_text(encoding="utf-8")

    def js_list(name):
        body = re.search(rf"export const {name} = \[(.*?)\];", src, re.S).group(1)
        return tuple(re.findall(r'"([^"]+)"', body))

    assert js_list("CLIENT_VIEWS") == T.CLIENT_VIEWS == ps.VIEW_CLASSES
    assert js_list("CLIENT_FPS") == T.CLIENT_FPS
    assert js_list("CLIENT_HEAP") == T.CLIENT_HEAP
    assert js_list("CLIENT_DEV") == T.CLIENT_DEV
    assert all(T.event_allowed(e) for e in ("client_fps:sim:lt10", "client_heap:atlas:1g_up", "client_dev:mem_2g"))
    assert not T.event_allowed("client_fps:sim:59.3") and not T.event_allowed("client_dev:Pixel 7")


def test_the_settings_that_size_the_object_list_are_reported():
    h = _hass()
    h.data[DOMAIN]["settings"] = h.data[DOMAIN].pop(next(iter(h.data[DOMAIN])))  # noqa: keep the fixture's shape
    p = T.build_payload(_hass())
    assert p["env"]["ble_max_age_s"] == 14400
    assert "atlas_3d_enabled" in p["features"]


def test_a_reading_with_nothing_on_screen_counts_as_none():
    h = _hass()
    s = ps.PerfSampler(h)
    s.start()
    h.loop.run_until(h.loop.t + 60)
    assert ps.window(h).hists["lag@none"].n == 1


# ── the server's summary ────────────────────────────────────────────────────

def test_the_summary_shows_what_a_cap_would_leave_smallest_machines_first(tmp_path):
    import os
    import subprocess
    import sys
    from datetime import date
    script = _ROOT / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    day = date.today().isoformat()

    def rep(iid, ram, objs, hist_mb, unclean):
        return {"install_id": iid, "version": "0.38.103", "day": day,
                "env": {"hw": {"cpus": 4, "ram": ram, "arch": "aarch64", "install": "os", "board": "rpi4"},
                        "object_history_days": 1},
                "usage": {"client_fps:sim:lt10": 30, "client_fps:atlas:45up": 600, "client_dev:mem_2g": 3},
                "health": {"perf": {"samples": 1440, "objects_n": {"p50": objs, "max": objs},
                                    "history_n": {"p50": objs, "max": objs}, "obj_kb": {"p50": 3.0, "max": 3.1},
                                    "history_mb": {"p50": hist_mb, "max": hist_mb}, "ble_mb": {"p50": 50, "max": 60},
                                    "snap_held_mb": {"p50": 40, "max": 45}, "none_cpu_pc": {"p95": 12, "n": 600},
                                    "sim_cpu_pc": {"p95": 30, "n": 30}},
                           "runs": {"starts": 7, "unclean": unclean, "rss_mb": 1500, "mem_avail_pc": 3,
                                    "objects_n": objs}}}

    d = tmp_path / "r"
    d.mkdir()
    rows = [rep("aaaaaaaa-1111-4111-8111-111111111111", "8g", 3000, 9, 0),
            rep("bbbbbbbb-1111-4111-8111-111111111111", "2g", 25000, 75, 6),
            {"install_id": "cccccccc-1111-4111-8111-111111111111", "version": "0.38.85", "day": day,
             "env": {"scanners": 2}, "health": {"runs": ["junk"]}}]
    (d / f"{day}.jsonl").write_text("".join(json.dumps({"recv_day": day, "report": r}) + "\n" for r in rows),
                                    encoding="utf-8")
    out = subprocess.run([sys.executable, str(script), str(d)], capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=60)
    assert out.returncode == 0, out.stderr
    s = out.stdout[out.stdout.index("Memory and the low-memory switch"):]
    assert "installs reporting memory figures" in s and "2  / 2" in s, s       # the junk report is skipped
    assert s.index("[rpi4/2g]") < s.index("[rpi4/8g]"), s
    assert "unclean 6" in s and "capped at 2k:" in s, s
    assert "sim    fps lt10 60" in s and "mem_2g 6" in s, s          # summed over every report
