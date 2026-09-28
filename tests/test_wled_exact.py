# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The PadSpan join and the exact on/off (wled_exact.py), against the
in-process WLED fake (tests/wled_fake.py) — no device is ever contacted.

What must hold: switching to PadSpan writes exactly one settings patch
(with a backup) and switching back puts the sync block back byte for byte;
the I2C guard falls back to live-only; a turn-on reproduces the look; an
outside "on" gets the look back once, keeping its brightness, and PadSpan's
own echo never loops; a power cut puts the last command back; a team's
members are all sent before any reply; rapid taps collapse; Vacation Mode
and presence rules take this path; without the licence it's plain HA.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
import json
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import wled_exact as E
from custom_components.padspan_ha import wled_look as L
from custom_components.padspan_ha import ws_wled as W
from custom_components.padspan_ha.const import DATA_SETTINGS, DATA_WLED_LOOKS, DOMAIN, WLED_LOOKS_STORE_KEY
from tests.wled_fake import FakeFleet, simple_device


class _MemStore:
    def __init__(self):
        self.saved = None
        self.delayed = 0

    async def async_load(self):
        return None

    async def async_save(self, data):
        self.saved = json.loads(json.dumps(data))

    def async_delay_save(self, fn, delay):
        self.delayed += 1
        self.saved = json.loads(json.dumps(fn()))


class _Conn:
    def __init__(self, admin=True):
        self.user = SimpleNamespace(is_admin=admin, name="Garry")
        self.results, self.errors = [], []

    def send_result(self, mid, data=None):
        self.results.append(data)

    def send_error(self, mid, code, message):
        self.errors.append((code, message))


class House:
    """HA as far as wled_exact needs it: registries, WLED entries, states,
    settings, services — and a fleet of fake WLEDs behind ws_wled."""

    def __init__(self, monkeypatch, tmp_path):
        from homeassistant.helpers import device_registry as dr, entity_registry as er
        self.devices, self.entries, self.entities, self.states = {}, {}, {}, {}
        self.fleet = FakeFleet()
        self.clock = [1000.0]
        self.timers = []
        self.settings = SimpleNamespace(data={"wled_teams": []})

        async def _set(**kw):
            self.settings.data = {**self.settings.data, **kw}
        self.settings.async_set = _set
        hass = MagicMock()
        hass.data = {DOMAIN: {DATA_SETTINGS: self.settings}}
        hass.config_entries.async_entries = lambda domain: list(self.entries.values()) if domain == "wled" else []
        hass.config.path = lambda *p: str(tmp_path.joinpath(*p))

        async def _exec(fn, *a):
            return fn(*a)
        hass.async_add_executor_job = _exec
        hass.async_create_background_task = lambda coro, name=None: asyncio.get_running_loop().create_task(coro)
        hass.states.get = lambda eid: self.states.get(eid)
        self.service_calls = []

        async def _call(domain, service, data=None, blocking=False):
            self.service_calls.append((domain, service, dict(data or {})))
        hass.services.async_call = _call
        self.hass = hass
        store = E.WledLooksStore.__new__(E.WledLooksStore)
        store.hass, store.store, store.data = hass, _MemStore(), {"devices": {}}
        hass.data[DOMAIN][DATA_WLED_LOOKS] = store
        self.store = store
        monkeypatch.setattr(dr, "async_get", lambda h: SimpleNamespace(async_get=lambda i: self.devices.get(i)), raising=False)
        monkeypatch.setattr(er, "async_get", lambda h: SimpleNamespace(async_get=lambda e: self.entities.get(e)), raising=False)
        monkeypatch.setattr(er, "async_entries_for_device",
                            lambda reg, d: [e for e in self.entities.values() if e.device_id == d], raising=False)
        self.tier = [True]
        monkeypatch.setattr(E, "_tier_at_least", lambda h, t: self.tier[0])
        monkeypatch.setattr(W, "_tier_at_least", lambda h, t: self.tier[0])
        monkeypatch.setattr(W, "_request_once", self.fleet.request_once)
        monkeypatch.setattr(E, "RETRY_DELAYS", (0, 0))
        monkeypatch.setattr(E, "_now", lambda: self.clock[0])
        monkeypatch.setattr(E, "_mono", lambda: self.clock[0])

        def _later(h, delay, job):
            self.timers.append((delay, job))
            return lambda: None
        monkeypatch.setattr(E, "_later", _later)
        self.tracked = []
        ev = types.ModuleType("homeassistant.helpers.event")
        ev.async_track_state_change_event = lambda h, ids, cb: (self.tracked.append(sorted(ids)), lambda: None)[1]
        monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)

    def add(self, name, dev, *, segs=2, main=True):
        did, eid = f"dev_{name}", f"e_{name}"
        mac = dev.info["mac"]
        self.fleet.devices[dev.host] = dev
        self.entries[eid] = SimpleNamespace(entry_id=eid, data={"host": dev.host}, domain="wled", unique_id=mac,
                                            state=SimpleNamespace(value="loaded"), disabled_by=None)
        self.devices[did] = SimpleNamespace(id=did, name=name, name_by_user=None, config_entries={eid})
        lights = {}
        if main:
            lights[f"light.{name}_main"] = mac
        for i in range(segs):
            lights[f"light.{name}" + ("" if i == 0 else f"_segment_{i}")] = f"{mac}_{i}"
        for ent_id, uid in lights.items():
            self.entities[ent_id] = SimpleNamespace(entity_id=ent_id, device_id=did, unique_id=uid, platform="wled")
            self.states[ent_id] = SimpleNamespace(state="on", attributes={})
        return did

    def offline(self, name, dev, flag=True):
        self.entries[f"e_{name}"].state = SimpleNamespace(value="setup_retry" if flag else "loaded")
        dev.offline = flag

    async def settle(self):
        for _ in range(50):
            ws = list((self.hass.data[DOMAIN].get(E._WORKERS) or {}).values())
            pending = [w.task for w in ws if w.task and not w.task.done()]
            if not pending:
                await asyncio.sleep(0)
                if not [w.task for w in ws if w.task and not w.task.done()]:
                    return
            else:
                await asyncio.gather(*pending)
        raise AssertionError("workers never settled")


@pytest.fixture
def house(monkeypatch, tmp_path):
    return House(monkeypatch, tmp_path)


async def _remember(house, did, **kw):
    conn = _Conn()
    await E.ws_wled_look_remember(house.hass, conn, {"id": 1, "device_id": did, **kw})
    assert not conn.errors, conn.errors
    return conn.results[0]


async def _to_padspan(house, did):
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 2, "device_id": did, "exact": True})
    assert not conn.errors, conn.errors
    return conn.results[0]


def _all_posts(house):
    return [(d.host, p, b) for d in house.fleet.devices.values() for m, p, b in d.log if m == "POST"]


@pytest.fixture(autouse=True)
def _never_forbidden(request):
    """Whatever a test did, the exact path never sent a forbidden key and
    wrote nothing but sync blocks to /json/cfg (checked after every test)."""
    yield
    house = request.node.funcargs.get("house")
    if house is None:
        return
    for host, path, body in _all_posts(house):
        if path == "json/state":
            assert not L.forbidden_in(body) or set(body) <= {"ps"}, (host, body)
        elif path == "json/cfg":
            sync_only = {k: v for k, v in body.items() if k not in ("hw", "light", "nw")}
            assert L.check_exact_cfg_patch(sync_only) is None, (host, body)
            assert not (body.get("hw") or {}).get("led", {}).keys() - {"fps", "rgbwm"}, (host, body)


# ── the switch ───────────────────────────────────────────────────────────────


async def test_padspan_mode_sends_exactly_the_one_settings_patch_and_switching_back_restores_it(house):
    dev = simple_device()
    did = house.add("valance", dev)
    before_sync = copy.deepcopy(dev.cfg["if"]["sync"])
    await _remember(house, did)
    res = await _to_padspan(house, did)
    cfg_posts = dev.posts("json/cfg")
    assert len(cfg_posts) == 1
    body = cfg_posts[0]
    assert body["if"] == L.SYNC_OFF_PATCH["if"]
    assert set(body) <= {"if", "hw", "light"}, "only the patch plus the reset-prone keys it must carry"
    assert res["backup"] and res["exact"] is True and res["sync_off"] == "saved"
    backup = house.hass.config.path(DOMAIN, "wled_backups", "28562f551738", res["backup"], "cfg.json")
    assert json.loads(open(backup, encoding="utf-8").read())["if"]["sync"] == before_sync, "backed up first"
    assert dev.cfg["if"]["sync"]["send"]["en"] is False and dev.cfg["if"]["sync"]["recv"]["grp"] == 0
    assert L.udpn_ok(dev.serialize_state())
    rec = house.store.get("28562f551738")
    assert rec["prior_sync"]["cfg"] == {"send": before_sync["send"], "recv": before_sync["recv"]}
    # Back to WLED sync: the sync block byte-identical to before, live sync too.
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 3, "device_id": did, "exact": False})
    assert not conn.errors, conn.errors
    assert json.dumps(dev.cfg["if"]["sync"], sort_keys=True) == json.dumps(before_sync, sort_keys=True)
    live = dev.serialize_state()["udpn"]
    assert (live["send"], live["sgrp"], live["rgrp"]) == (False, 1, 1)
    assert conn.results[0]["exact"] is False and conn.results[0]["before"] and conn.results[0]["after"]
    assert house.store.get("28562f551738")["prior_sync"] is None


async def test_an_i2c_device_falls_back_to_live_only_and_every_command_puts_sync_off_again(house):
    dev = simple_device()
    dev.cfg["hw"]["if"] = {"i2c-pin": [21, 22]}
    did = house.add("valance", dev)
    await _remember(house, did)
    res = await _to_padspan(house, did)
    assert res["sync_off"] == "live" and res["sync_off_message"] == E.LIVE_ONLY_MSG
    assert dev.posts("json/cfg") == [], "the I2C guard refused before anything was written"
    assert L.udpn_ok(dev.serialize_state())
    dev.reboot()                                   # rgrp back to 1 from the saved settings
    assert not L.udpn_ok(dev.serialize_state())
    out = await E.async_power(house.hass, "light.valance_main", True)
    assert out["handled"] and out["results"][0]["ok"], out
    assert L.udpn_ok(dev.serialize_state())


async def test_switching_needs_a_look_and_back_is_allowed_without_the_licence(house):
    dev = simple_device()
    did = house.add("valance", dev)
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 1, "device_id": did, "exact": True})
    assert conn.errors[0][0] == "no_look" and dev.posts("json/cfg") == []
    await _remember(house, did)
    await _to_padspan(house, did)
    house.tier[0] = False
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 2, "device_id": did, "exact": True})
    assert conn.errors and conn.errors[0][0] == "bright_required"
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 3, "device_id": did, "exact": False})
    assert not conn.errors and conn.results[0]["exact"] is False


async def test_a_failed_live_switch_rolls_the_saved_change_back(house, monkeypatch):
    dev = simple_device()
    did = house.add("valance", dev)
    before_sync = copy.deepcopy(dev.cfg["if"]["sync"])
    await _remember(house, did)
    real = dev.handle

    async def _fail_udpn(method, path, body):
        if method == "POST" and path == "json/state" and (body.get("udpn") or {}).get("rgrp") == 0:
            dev.log.append((method, path, body))
            raise W.WledError("http_error", "The device answered HTTP 500")
        return await real(method, path, body)

    dev.handle = _fail_udpn
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 1, "device_id": did, "exact": True})
    assert conn.errors and conn.errors[0][0] == "http_error"
    assert len(dev.posts("json/cfg")) == 2, "the sync-off patch, then the saved blocks back"
    assert json.dumps(dev.cfg["if"]["sync"], sort_keys=True) == json.dumps(before_sync, sort_keys=True)
    assert house.store.get("28562f551738")["exact"] is False


# ── exact on/off ─────────────────────────────────────────────────────────────


async def test_turn_on_from_dark_reproduces_the_look_and_off_keeps_the_segments(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    look = house.store.get("28562f551738")["look"]
    # Someone else changed everything and switched it off.
    await dev.handle("POST", "json/state", {"seg": [{"id": 0, "col": [[9, 9, 9]], "fx": 7}, {"id": 1, "on": False}],
                                            "on": False})
    n = len(dev.log)
    out = await E.async_power(house.hass, "light.valance_main", True)
    r = out["results"][0]
    assert r["ok"] and r["tries"] == 1 and r["bri"] == look["state"]["bri"]
    posts = [b for m, p, b in dev.log[n:] if m == "POST"]
    assert "on" not in posts[0] and posts[0]["tt"] == 0 and posts[-1]["on"] is True
    assert L.compare(look["state"], dev.serialize_state(), L.Ctx(dev.serialize_info()), on=True,
                     bri=look["state"]["bri"], exact=True) == []
    await E.async_power(house.hass, "light.valance_main", False)
    st = dev.serialize_state()
    assert st["on"] is False and all(s["on"] for s in st["seg"]), "only the master goes off"


async def test_dimming_a_lit_matching_light_sends_only_the_brightness(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True)
    n = len(dev.log)
    await E.async_power(house.hass, "light.valance_main", True, 40)
    posts = [b for m, p, b in dev.log[n:] if m == "POST"]
    assert posts == [{"bri": 40, "tt": 2, "udpn": {"nn": True}, "v": True}]


async def test_a_segment_that_didnt_take_is_resent_whole_and_a_lost_reply_is_read_first(house, monkeypatch):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", False)
    real = dev.deserialize_state
    spoil = [True]

    def _spoiling(root):
        real(root)
        if spoil[0] and root.get("on") is True:          # a button pressed mid-apply
            spoil[0] = False
            dev.segs[1]["fx"] = 9
    monkeypatch.setattr(dev, "deserialize_state", _spoiling)
    n = len(dev.log)
    out = await E.async_power(house.hass, "light.valance_main", True)
    r = out["results"][0]
    assert r["ok"] and r["tries"] == 2
    resend = [b for m, p, b in dev.log[n:] if m == "POST"][-1]
    assert [s["id"] for s in resend["seg"]] == [1] and resend["on"] is True and "sx" in resend["seg"][0]
    # A lost reply on a lit light (one request): read back, nothing re-sent — it did apply.
    await dev.handle("POST", "json/state", {"seg": [{"id": 0, "col": [[9, 9, 9, 9]]}]})
    dev.lose = 1
    n = len(dev.log)
    out = await E.async_power(house.hass, "light.valance_main", True)
    assert out["results"][0]["ok"]
    after = dev.log[n:]
    lost_at = next(i for i, (m, p, b) in enumerate(after) if m == "POST")
    assert after[lost_at + 1][:2] == ("GET", "json/state"), "a lost reply is followed by a read"
    assert [m for m, p, b in after].count("POST") == 1, "never a blind re-send"
    # Lost mid-sequence while dark: the read shows the segments took, so only the master follows.
    await E.async_power(house.hass, "light.valance_main", False)
    await dev.handle("POST", "json/state", {"seg": [{"id": 0, "col": [[9, 9, 9, 9]]}]})
    dev.lose = 1
    n = len(dev.log)
    out = await E.async_power(house.hass, "light.valance_main", True)
    assert out["results"][0]["ok"] and out["results"][0]["tries"] == 2
    posts = [b for m, p, b in dev.log[n:] if m == "POST"]
    assert len(posts) == 2 and "seg" in posts[0] and "seg" not in posts[1] and posts[1]["on"] is True


async def test_three_tries_at_most_and_the_result_says_what_didnt_take(house, monkeypatch):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await dev.handle("POST", "json/state", {"on": False})
    real = dev.deserialize_state

    def _stubborn(root):
        real(root)
        dev.segs[1]["col"][0] = [1, 2, 3, 0]
    monkeypatch.setattr(dev, "deserialize_state", _stubborn)
    out = await E.async_power(house.hass, "light.valance_main", True)
    r = out["results"][0]
    assert not r["ok"] and r["tries"] == 3 and r["diffs"] == ["part 2: colour"]
    assert "didn't take after 3 tries" in r["message"]


async def test_the_late_check_fixes_once_then_names_what_keeps_changing(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True, 100)
    delay, job = house.timers[-1]
    assert delay == pytest.approx(0.7 + E.LATE_EXTRA_S)
    await dev.handle("POST", "json/state", {"seg": [{"id": 1, "fx": 3}]})     # the 08:00 timer
    await job()
    assert dev.serialize_state()["seg"][1]["fx"] == 0, "fixed once"
    rec = house.store.get("28562f551738")
    assert "effect" in rec["last_result"]["late"]
    _, job2 = house.timers[-1]
    await dev.handle("POST", "json/state", {"seg": [{"id": 1, "fx": 3, "col": [[1, 1, 1]]}]})
    await job2()
    assert rec["last_result"]["message"] == "Something else keeps changing this light: colour, effect"
    assert dev.serialize_state()["seg"][1]["fx"] == 3, "not fought a second time"


async def test_ten_rapid_taps_are_at_most_two_applies(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await house.settle()
    dev.gate = asyncio.Event()
    n = len(dev.log)
    tasks = [asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", True))]
    for _ in range(20):                       # the first tap's apply is in flight (held at the device)
        await asyncio.sleep(0)
    assert [p for m, p, b in dev.log[n:]] == ["json/si"]
    tasks += [asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", i % 2 == 0)) for i in range(1, 10)]
    for _ in range(5):
        await asyncio.sleep(0)
    dev.gate.set()
    results = await asyncio.gather(*tasks)
    dev.gate = None
    applies = [p for m, p, b in dev.log[n:] if m == "GET" and p == "json/si"]      # each apply reads first
    assert len(applies) == 2, "one in flight, then only the newest"
    assert results[0]["results"][0]["on"] is True and all(r["results"][0]["on"] is False for r in results[1:])
    assert dev.serialize_state()["on"] is False, "the newest tap (off) wins"


async def test_busy_is_backed_off_and_a_different_mac_is_refused(house, monkeypatch):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    monkeypatch.setattr(W.asyncio, "sleep", AsyncMock())
    dev.busy = 1
    out = await E.async_power(house.hass, "light.valance_main", True)
    assert out["results"][0]["ok"]
    dev.info["mac"] = "112233445566"
    n = len(dev.log)
    out = await E.async_power(house.hass, "light.valance_main", False)
    assert "different MAC" in out["results"][0]["message"]
    assert not [1 for m, p, b in dev.log[n:] if m == "POST"]


async def test_geometry_drift_is_recorded_and_the_look_goes_on_without_bounds(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await dev.handle("POST", "json/state", {"seg": [{"id": 0, "col": [[10, 20, 30, 200]]}, {"id": 1, "fx": 8}]})
    await _remember(house, did)
    await _to_padspan(house, did)
    dev.cfg["hw"]["led"]["ins"][1]["type"] = 30        # output 2 now RGBW
    dev.reboot()
    house.clock[0] += 5000
    n = len(dev.log)
    out = await E.async_power(house.hass, "light.valance_main", True)
    rec = house.store.get("28562f551738")
    assert rec["drift"]["geometry"] and "Output 2 changed from RGB (WS281x) to RGBW (SK6812)" in rec["drift"]["what"]
    segs = [s for m, p, b in dev.log[n:] if m == "POST" for s in b.get("seg") or []]
    assert segs and not any(k in s for s in segs for k in L.SEG_BOUNDS)
    assert out["results"][0]["ok"]


# ── outside changes ──────────────────────────────────────────────────────────


async def test_hold_puts_the_look_back_once_keeping_the_callers_brightness(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", False)
    look = house.store.get("28562f551738")["look"]
    house.clock[0] += 10
    # HA's dashboard: "on" at 60, with an old colour left on part 2.
    await dev.handle("POST", "json/state", {"on": True, "bri": 60, "seg": [{"id": 1, "col": [[0, 0, 255]]}]})
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 60}))
    await house.settle()
    st = dev.serialize_state()
    assert st["bri"] == 60, "the caller's brightness is kept"
    assert L.compare(look["state"], st, L.Ctx(dev.serialize_info()), on=True, bri=60, exact=True) == []
    # PadSpan's own change coming back through HA: nothing at all.
    n = len(dev.log)
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={}))
    await house.settle()
    assert len(dev.log) == n, "inside the echo window nothing is even read"
    house.clock[0] += 10
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={}))
    await house.settle()
    assert not [1 for m, p, b in dev.log[n:] if m == "POST"], "compare-before-write: no loop"


async def test_hold_off_leaves_an_outside_on_alone(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 1, "device_id": did, "hold": False})
    assert conn.results[0]["hold"] is False
    await E.async_power(house.hass, "light.valance_main", False)
    house.clock[0] += 10
    await dev.handle("POST", "json/state", {"on": True, "seg": [{"id": 1, "col": [[0, 0, 255]]}]})
    n = len(dev.log)
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"), SimpleNamespace(state="on"))
    await house.settle()
    assert len(dev.log) == n


async def test_a_reconnect_after_a_power_cut_puts_the_last_command_back(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True, 90)
    look = house.store.get("28562f551738")["look"]
    house.clock[0] += 3600
    dev.reboot()                                        # factory orange, full, sync from the saved settings
    dev.info["uptime"] = 30
    await dev.handle("POST", "json/state", {"seg": [{"id": 0, "col": [[255, 160, 0, 0]]}], "bri": 128})
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="unavailable"),
                            SimpleNamespace(state="on"))
    await house.settle()
    st = dev.serialize_state()
    assert st["on"] and st["bri"] == 90
    assert L.compare(look["state"], st, L.Ctx(dev.serialize_info()), on=True, bri=90, exact=True) == []
    # Last command "off": it comes back off.
    await E.async_power(house.hass, "light.valance_main", False)
    house.clock[0] += 3600
    dev.reboot()
    dev.info["uptime"] = 30
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="unavailable"),
                            SimpleNamespace(state="on"))
    await house.settle()
    assert dev.serialize_state()["on"] is False


async def test_an_outside_off_is_remembered_so_a_power_cut_doesnt_turn_it_on(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True)
    house.clock[0] += 10
    await dev.handle("POST", "json/state", {"on": False})
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"), SimpleNamespace(state="off"))
    assert house.store.get("28562f551738")["last_cmd"]["on"] is False


# ── teams ────────────────────────────────────────────────────────────────────


def _team(house, leader, followers, mode="mirror"):
    house.settings.data["wled_teams"] = [{"id": "t1", "name": "Valances", "mode": mode, "group": 3, "leader": leader,
                                          "followers": followers, "prior": {}, "incomplete": []}]


async def _padspan_team(house, n=3):
    devs, dids = [], []
    for i in range(n):
        d = simple_device(host=f"192.168.2.{130 + i}", mac=f"aabbccddee{i:02x}")
        dids.append(house.add(f"m{i}", d))
        devs.append(d)
    _team(house, dids[0], dids[1:])
    await _remember(house, dids[0], team=True)
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 5, "team_id": "t1", "mode": "padspan"})
    assert not conn.errors, conn.errors
    return devs, dids, conn.results[0]


async def test_a_team_run_by_padspan_switches_every_member_and_back(house):
    devs, dids, res = await _padspan_team(house)
    assert res["team"]["mode"] == "padspan" and all(m["ok"] for m in res["members"])
    assert all(L.udpn_ok(d.serialize_state()) and len(d.posts("json/cfg")) == 1 for d in devs)
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 6, "device_id": dids[1], "exact": False})
    assert conn.errors[0][0] == "in_team", "locked on while the team exists"
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 7, "team_id": "t1", "mode": "mirror"})
    assert not conn.errors and conn.results[0]["team"]["mode"] == "mirror"
    assert all(d.cfg["if"]["sync"]["recv"]["grp"] == 1 for d in devs)
    assert not any(house.store.get(d.info["mac"])["exact"] for d in devs)


async def test_a_team_member_that_fails_rolls_the_others_back(house):
    devs = [simple_device(host=f"192.168.2.{130 + i}", mac=f"aabbccddee{i:02x}") for i in range(3)]
    dids = [house.add(f"m{i}", d) for i, d in enumerate(devs)]
    _team(house, dids[0], dids[1:])
    await _remember(house, dids[0], team=True)
    devs[2].cfg["hw"]["if"] = {"i2c-pin": [21, 22]}
    real = devs[2].handle

    async def _no_udpn(method, path, body):
        if method == "POST" and (body or {}).get("udpn", {}).get("rgrp") == 0:
            raise W.WledError("http_error", "The device answered HTTP 500")
        return await real(method, path, body)
    devs[2].handle = _no_udpn
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 5, "team_id": "t1", "mode": "padspan"})
    assert conn.errors and conn.errors[0][0] == "failed" and "switched back" in conn.errors[0][1]
    assert not any(house.store.get(d.info["mac"])["exact"] for d in devs)
    assert all(d.cfg["if"]["sync"]["recv"]["grp"] == 1 for d in devs[:2])
    assert house.settings.data["wled_teams"][0]["mode"] == "mirror"


async def test_team_members_are_all_sent_before_any_reply_and_keep_their_tuning(house):
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", False)
    # Member 2 was remembered 20% brighter.
    house.store.get(devs[1].info["mac"])["look"]["state"]["bri"] = 154
    for d in devs:
        d.gate = asyncio.Event()
    house.fleet.order.clear()
    task = asyncio.ensure_future(E.async_power(house.hass, "light.m0_main", True, 64))
    for _ in range(20):
        await asyncio.sleep(0)
    reached = {h for h, m, p in house.fleet.order}
    assert reached == {d.host for d in devs}, "every member was asked before any answered"
    for d in devs:
        d.gate.set()
    out = await task
    assert all(r["ok"] for r in out["results"])
    bri = {r["device_id"]: r["bri"] for r in out["results"]}
    assert bri[dids[0]] == 64 and bri[dids[1]] == round(154 * 64 / 128) and bri[dids[2]] == 64
    finals = [b for d in devs for b in d.posts() if b.get("on") is True and "seg" not in b]
    assert finals and all(b.get("tb") == 0 for b in finals), "effects start in step"


async def test_an_offline_member_waits_and_gets_its_look_when_it_reconnects(house):
    devs, dids, _ = await _padspan_team(house)
    for d in devs:
        await d.handle("POST", "json/state", {"on": False})
    house.offline("m2", devs[2])
    out = await E.async_power(house.hass, "light.m0_main", True)
    by = {r["device_id"]: r for r in out["results"]}
    assert by[dids[0]]["ok"] and by[dids[1]]["ok"]
    assert by[dids[2]]["waiting"] and not by[dids[2]]["ok"]
    house.offline("m2", devs[2], False)
    devs[2].info["uptime"] = 5
    house.clock[0] += 600
    await E.on_state_change(house.hass, "light.m2_main", SimpleNamespace(state="unavailable"), SimpleNamespace(state="off"))
    await house.settle()
    assert devs[2].serialize_state()["on"] is True


async def test_a_member_switched_from_outside_takes_the_team_with_it(house):
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", False)
    house.clock[0] += 10
    await devs[1].handle("POST", "json/state", {"on": True, "bri": 100})
    await E.on_state_change(house.hass, "light.m1_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 100}))
    await house.settle()
    assert all(d.serialize_state()["on"] for d in devs)
    assert devs[1].serialize_state()["bri"] == 100


# ── the rest of PadSpan takes this path ──────────────────────────────────────


async def test_without_the_licence_every_path_is_a_plain_ha_light_call(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    house.tier[0] = False
    n = len(dev.log)
    assert not E.is_exact_entity(house.hass, "light.valance_main")
    out = await E.async_power(house.hass, "light.valance_main", True, 50)
    assert out == {"handled": False, "results": []}
    assert house.service_calls == [("light", "turn_on", {"entity_id": "light.valance_main", "brightness": 50})]
    assert len(dev.log) == n
    conn = _Conn()
    await E.ws_wled_exact_list(house.hass, conn, {"id": 1})
    assert conn.results[0] == {"devices": []}


async def test_vacation_mode_routes_exact_lights_through_the_exact_path(house, monkeypatch):
    from custom_components.padspan_ha import vacation_mode as VM
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    house.settings.data.update(vacation_mode_enabled=True, vacation_mode_pattern={"light.valance_main": {}, "light.plain": {}},
                               vacation_mode_pattern_until=0)
    house.states["light.valance_main"] = SimpleNamespace(state="off", attributes={})
    house.states["light.plain"] = SimpleNamespace(state="off", attributes={})
    monkeypatch.setattr(VM, "_async_refresh_pattern_if_stale", AsyncMock())
    monkeypatch.setattr(VM, "_eligible_entity_ids", lambda h: ["light.valance_main", "light.plain"])
    monkeypatch.setattr(VM, "decide_states", lambda p, now, i: {"light.valance_main": True, "light.plain": True})
    calls = []

    async def _power(h, eid, on, brightness=None, **kw):
        calls.append((eid, on, kw.get("source")))
        return {"handled": True, "results": []}
    monkeypatch.setattr(E, "async_power", _power)
    await VM._async_tick(house.hass)
    assert calls == [("light.valance_main", True, "vacation")]
    assert house.service_calls == [("light", "turn_on", {"entity_id": "light.plain"})]


async def test_vacation_followers_are_still_left_to_their_leader(house):
    """A PadSpan team's followers stay out of Vacation Mode, as a WLED
    team's do: switching the leader brings the whole team."""
    devs, dids, _ = await _padspan_team(house, n=2)
    teams = house.settings.data["wled_teams"]
    assert teams[0]["mode"] == "padspan"
    assert W.follower_light_entities(house.hass, teams) == {"light.m1_main", "light.m1", "light.m1_segment_1"}


def test_presence_rules_route_exact_lights_through_the_exact_path():
    from custom_components.padspan_ha import presence_coordinator as PC
    src = inspect.getsource(PC)
    i = src.index("# A WLED light PadSpan runs: its remembered look")
    block = src[i:i + 600]
    assert "is_exact_entity(self.hass, entity_id)" in block and 'async_power(self.hass, entity_id, action == "turn_on", source="presence")' in block


async def test_the_services_turn_on_with_the_look_and_fall_back_for_other_lights(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", False)
    registered = {}
    house.hass.services.async_register = lambda dom, name, fn, schema=None: registered.setdefault(name, (fn, schema))
    E.async_register_services(house.hass)
    assert set(registered) == {"wled_on", "wled_off"}
    fn, schema = registered["wled_on"]
    data = schema({"entity_id": ["light.valance_main", "light.kitchen"], "brightness_pct": 50})
    await fn(SimpleNamespace(data=data))
    assert dev.serialize_state()["on"] and dev.serialize_state()["bri"] == 128
    assert ("light", "turn_on", {"entity_id": "light.kitchen", "brightness": 128}) in house.service_calls


# ── websocket contract ───────────────────────────────────────────────────────


async def test_look_get_remember_history_and_compare(house):
    dev = simple_device()
    did = house.add("valance", dev)
    conn = _Conn()
    await E.ws_wled_look_get(house.hass, conn, {"id": 1, "device_id": did})
    assert conn.results[0]["look"] is None and conn.results[0]["can_switch"] is False
    first = await _remember(house, did)
    assert first["saved"] and first["looks"][0]["look"]["state"]["seg"]
    await dev.handle("POST", "json/state", {"seg": [{"id": 1, "fx": 9, "col": [[1, 2, 3, 4]]}]})
    conn = _Conn()
    await E.ws_wled_look_get(house.hass, conn, {"id": 2, "device_id": did, "compare": True})
    assert conn.results[0]["differs"] == ["part 2: colour, effect"]
    preview = await _remember(house, did, preview=True)
    assert preview["saved"] is False and house.store.get("28562f551738")["history"] == []
    await _remember(house, did)
    rec = house.store.get("28562f551738")
    assert len(rec["history"]) == 1 and rec["look"]["state"]["seg"][1]["fx"] == 9
    conn = _Conn()
    await E.ws_wled_look_use_history(house.hass, conn, {"id": 3, "device_id": did, "index": 0})
    assert not conn.errors and conn.results[0]["look"]["state"]["seg"][1]["fx"] == 0
    assert conn.results[0]["history"][0]["state"]["seg"][1]["fx"] == 9
    for _ in range(7):
        await _remember(house, did)
    assert len(house.store.get("28562f551738")["history"]) == E.HISTORY_KEPT


async def test_remember_team_look_saves_nothing_unless_every_member_answers(house):
    devs = [simple_device(host=f"192.168.2.{130 + i}", mac=f"aabbccddee{i:02x}") for i in range(2)]
    dids = [house.add(f"m{i}", d) for i, d in enumerate(devs)]
    _team(house, dids[0], dids[1:])
    house.offline("m1", devs[1])
    conn = _Conn()
    await E.ws_wled_look_remember(house.hass, conn, {"id": 1, "device_id": dids[0], "team": True})
    assert conn.errors and conn.errors[0][0] == "unreachable"
    assert house.store.records() == {}


async def test_power_is_open_to_any_user_but_only_for_lights(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    conn = _Conn(admin=False)
    await E.ws_wled_power(house.hass, conn, {"id": 1, "entity_id": "light.valance_main", "on": True, "source": "atlas"})
    assert not conn.errors and conn.results[0]["handled"] and conn.results[0]["results"][0]["ok"]
    conn = _Conn()
    await E.ws_wled_power(house.hass, conn, {"id": 2, "entity_id": "lock.front", "on": True})
    assert conn.errors[0][0] == "invalid"
    conn = _Conn()
    await E.ws_wled_exact_list(house.hass, conn, {"id": 3})
    d = conn.results[0]["devices"][0]
    assert d["main"] == "light.valance_main" and d["lights"]["light.valance_segment_1"] == 1


def test_admin_only_commands_and_no_host_from_the_client():
    src = inspect.getsource(E)
    for name in ("ws_wled_look_remember", "ws_wled_look_use_history", "ws_wled_exact_set", "ws_wled_team_mode"):
        i = src.index(f"async def {name}")
        head = src[src.rindex("@websocket_api.websocket_command", 0, i):i]
        assert "@websocket_api.require_admin" in head, name
    for name in ("ws_wled_power", "ws_wled_look_get", "ws_wled_exact_list"):
        i = src.index(f"async def {name}")
        head = src[src.rindex("@websocket_api.websocket_command", 0, i):i]
        assert "@websocket_api.require_admin" not in head, name
    for cmd in E.WS_COMMANDS:
        keys = {str(getattr(k, "schema", k)) for k in cmd.ws_schema}
        assert not keys & {"host", "ip", "url", "address"}, (cmd.__name__, keys)


def test_the_looks_are_in_padspans_backups():
    from custom_components.padspan_ha.ws_common import _ALL_STORE_KEYS, _DATA_KEY_MAP
    assert WLED_LOOKS_STORE_KEY in _ALL_STORE_KEYS and _DATA_KEY_MAP[WLED_LOOKS_STORE_KEY] == DATA_WLED_LOOKS
    assert WLED_LOOKS_STORE_KEY == "padspan_ha.wled_looks"


def test_the_commands_are_registered_with_the_wled_ones():
    src = inspect.getsource(W.async_register)
    assert "_exact_commands" in src
    assert len(E.WS_COMMANDS) == 7


def test_the_exact_path_only_writes_sync_blocks_to_the_config(monkeypatch):
    """Negative control for _cfg_write: anything but the sync blocks is refused
    before safe_cfg_write is reached."""
    called = []

    async def _safe(*a, **k):
        called.append(a)
        return {}
    monkeypatch.setattr(W, "safe_cfg_write", _safe)
    with pytest.raises(W.WledError) as err:
        asyncio.run(E._cfg_write(None, {"host": "x"}, {"hw": {"led": {"maxpwr": 0}}}, "h"))
    assert err.value.code == "refused" and called == []
    asyncio.run(E._cfg_write(None, {"host": "x"}, L.sync_off_patch(), "h"))
    assert len(called) == 1


async def test_the_runtime_guard_refuses_a_forbidden_key_before_it_is_sent(house):
    """Negative control for _post_all's own check: no normal path builds one,
    so it is driven directly — a preset or a lasting transition never goes."""
    dev = simple_device()
    house.add("valance", dev)
    worker = E._worker(house.hass, "28562f551738")
    for body in ({"ps": 1, "v": True}, {"transition": 7}, {"seg": [{"id": 0, "fxdef": True}]}):
        with pytest.raises(W.WledError) as err:
            await E._post_all(house.hass, worker, dev.host, [body])
        assert err.value.code == "refused"
    assert dev.posts() == []


async def test_opening_the_card_rechecks_the_led_setup_once_a_day(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    dev.cfg["hw"]["led"]["ins"][0]["rgbwm"] = 2                 # output 1: white mode None -> Accurate
    conn = _Conn()
    await E.ws_wled_look_get(house.hass, conn, {"id": 1, "device_id": did, "compare": True})
    assert conn.results[0]["drift"] is None, "checked within the day: not read again"
    house.clock[0] += E.SETUP_RECHECK_S
    conn = _Conn()
    await E.ws_wled_look_get(house.hass, conn, {"id": 2, "device_id": did, "compare": True})
    drift = conn.results[0]["drift"]
    assert drift and drift["geometry"] is False and "Output 1 white mode None → Accurate" in drift["what"]
