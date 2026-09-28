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
    n = len(dev.posts())
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"), SimpleNamespace(state="on"))
    await house.settle()
    # Only its uptime is read (a restart would put the last command back).
    assert len(dev.posts()) == n


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



# ── review 2026-09-27: each finding reproduced, then held ────────────────────

# Old white kitchen east (.2.116), the one WLED 0.14.4 unit — captured
# 2026-09-27 (GET only). Its saved send block carries "macro" (0.14.4
# cfg.cpp:868) and no "en"; its receive block has no "pal".
_OLD_WHITE_SEG = {"id": 0, "start": 0, "stop": 1, "len": 1, "grp": 1, "spc": 0, "of": 0, "on": True, "frz": False,
                  "bri": 255, "cct": 127, "set": 0, "col": [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "fx": 0,
                  "sx": 128, "ix": 128, "pal": 0, "c1": 128, "c2": 128, "c3": 16, "sel": True, "rev": False,
                  "mi": False, "o1": False, "o2": False, "o3": False, "si": 0, "m12": 0}
_OLD_WHITE_INFO = {"ver": "0.14.4", "vid": 2405180, "arch": "esp32", "mac": "f4650bc22c00", "fxcount": 187,
                   "uptime": 347892, "i2c": [-1, -1], "name": "Old white kitchen east",
                   "leds": {"count": 1, "pwr": 100, "fps": 5, "maxpwr": 850, "maxseg": 32, "seglc": [7], "lc": 7,
                            "rgbw": True, "wv": 2, "cct": 4}}
_OLD_WHITE_STATE = {"on": True, "bri": 128, "transition": 7, "ps": -1, "pl": -1, "AudioReactive": {"on": True},
                    "nl": {"on": False, "dur": 60, "mode": 1, "tbri": 0, "rem": -1},
                    "udpn": {"send": False, "recv": True, "sgrp": 1, "rgrp": 1}, "lor": 0, "mainseg": 0,
                    "seg": [_OLD_WHITE_SEG]}
_OLD_WHITE_CFG = {
    "hw": {"led": {"total": 1, "maxpwr": 850, "ledma": 55, "cct": False, "cr": False, "cb": 0, "fps": 42, "rgbwm": 255,
                   "ld": True, "ins": [{"start": 0, "len": 1, "pin": [19, 18, 17, 16, 4], "order": 1, "rev": False,
                                        "skip": 0, "type": 45, "ref": False, "rgbwm": 0, "freq": 19531}]},
           "if": {"i2c-pin": [-1, -1], "spi-pin": [-1, -1, -1]}},
    "light": {"scale-bri": 100, "pal-mode": 0, "aseg": False, "gc": {"bri": 1, "col": 1, "val": 2.8},
              "tr": {"mode": True, "fx": True, "dur": 7, "pal": 0, "rpc": 5}},
    "def": {"ps": 0, "on": True, "bri": 128},
    "if": {"sync": {"port0": 21324, "port1": 65506,
                    "recv": {"bri": True, "col": True, "fx": True, "grp": 1, "seg": False, "sb": False},
                    "send": {"dir": False, "btn": False, "va": False, "hue": True, "macro": False, "grp": 1, "ret": 0}}}}


@pytest.mark.parametrize("sends", [False, True], ids=["as captured", "sending on"])
async def test_the_0144_unit_goes_to_padspan_and_back_byte_for_byte(house, sends):
    """Review finding 1: the restore carried "macro" and was refused, so
    .2.116 could never leave PadSpan. And 0.14.4 saves the LIVE send switch
    as "dir", so a unit that sends must get its live switch back before
    its saved blocks, or the saved "dir" comes back off."""
    from tests.wled_fake import FakeWled
    cfg, state = copy.deepcopy(_OLD_WHITE_CFG), copy.deepcopy(_OLD_WHITE_STATE)
    cfg["if"]["sync"]["send"]["dir"] = sends
    state["udpn"]["send"] = sends
    dev = FakeWled(host="192.168.2.116", info=_OLD_WHITE_INFO, state=state, cfg=cfg)
    did = house.add("oldwhite", dev, segs=1, main=False)
    before_sync = copy.deepcopy(dev.cfg["if"]["sync"])
    await _remember(house, did)
    res = await _to_padspan(house, did)
    assert res["exact"] is True and res["sync_off"] == "saved"
    assert dev.cfg["if"]["sync"]["send"]["grp"] == 0 and dev.cfg["if"]["sync"]["recv"]["grp"] == 0
    assert L.udpn_ok(dev.serialize_state())
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 3, "device_id": did, "exact": False})
    assert not conn.errors, conn.errors
    assert json.dumps(dev.cfg["if"]["sync"], sort_keys=True) == json.dumps(before_sync, sort_keys=True)
    live = dev.serialize_state()["udpn"]
    assert (live["send"], live["sgrp"], live["rgrp"]) == (sends, 1, 1)
    rec = house.store.get("f4650bc22c00")
    assert (rec["join"], rec["exact"], rec["prior_sync"]) == ("wled", False, None)
    dev.reboot()                                        # and it lasts: the saved settings are the originals
    assert dev.serialize_state()["udpn"]["send"] is sends


async def test_a_restart_ha_never_showed_as_unavailable_puts_the_last_command_back(house):
    """Review finding 2: HA 2026.7.4 re-polls at once after WLED's socket
    closes, so a quick restart can come through as on→on (PillTaker 09-27,
    Quin Kitchen 09-23). Every unit boots ON (def.on true)."""
    dev = simple_device()
    await dev.handle("POST", "json/state", {"seg": [{"id": 0, "col": [[10, 20, 30, 40]], "fx": 9}], "v": True})
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    look = house.store.get("28562f551738")["look"]
    await E.async_power(house.hass, "light.valance_main", True, 90)
    await house.settle()
    house.clock[0] += 3600
    dev.reboot()                                      # boot defaults: factory orange, ON at 128
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"),
                            SimpleNamespace(state="on", attributes={"brightness": 128}))
    await house.settle()
    st = dev.serialize_state()
    assert st["on"] and st["bri"] == 90
    assert L.compare(look["state"], st, L.Ctx(dev.serialize_info()), on=True, bri=90, exact=True) == []
    # Left OFF by PadSpan: it boots ON, HA shows off→on — it goes back off,
    # and "off" stays the last command (hold never turns it on).
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    house.clock[0] += 3600
    dev.reboot()
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 128}))
    await house.settle()
    rec = house.store.get("28562f551738")
    assert dev.serialize_state()["on"] is False
    assert rec["last_cmd"]["on"] is False and rec["last_result"]["source"] == "reconnect"
    # Negative control: no restart since (up 25 s, booted before that
    # command), the same off→on is an outside "on" — held, not undone.
    house.clock[0] += 20
    dev.info["uptime"] = 25
    await dev.handle("POST", "json/state", {"on": True, "bri": 60})
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 60}))
    await house.settle()
    assert dev.serialize_state()["on"] is True and rec["last_result"]["source"] == "hold"
    # A power cut seconds after a command: the uptime read with the command
    # is not taken for the device's now.
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    house.clock[0] += 5
    dev.reboot()
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 128}))
    await house.settle()
    assert dev.serialize_state()["on"] is False and rec["last_result"]["source"] == "reconnect"


async def test_a_lost_reply_to_the_sync_off_write_never_loses_the_original_sync(house, monkeypatch):
    """Review finding 3: the write was applied, its reply lost. The switch
    goes on (the saved change is in); and where it can't be told, PadSpan
    keeps the device with its ORIGINAL settings so switching back works."""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    original = copy.deepcopy(dev.cfg["if"]["sync"])
    dev.lose = 1                                      # the cfg POST applies; its reply is lost
    res = await _to_padspan(house, did)
    rec = house.store.get("28562f551738")
    assert res["exact"] is True and rec["prior_sync"]["cfg"]["recv"]["grp"] == 1
    assert L.udpn_ok(dev.serialize_state())
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 3, "device_id": did, "exact": False})
    assert not conn.errors and json.dumps(dev.cfg["if"]["sync"], sort_keys=True) == json.dumps(original, sort_keys=True)
    # Can't tell: the write applied, the reply lost, then the device gone.
    real = dev.handle

    async def _then_gone(method, path, body):
        out = await real(method, path, body)
        if method == "POST" and path == "json/cfg":
            dev.offline = True
            raise W.WledError("timeout", "No answer from 192.168.2.118 within 12 s")
        return out
    dev.handle = _then_gone
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 4, "device_id": did, "exact": True})
    assert conn.errors and conn.errors[0][0] == "timeout"
    assert (rec["join"], rec["exact"], rec["sync_off"]) == ("padspan", True, "saved")
    assert rec["prior_sync"]["cfg"] == {"send": original["send"], "recv": original["recv"]}
    dev.handle, dev.offline = real, False
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 5, "device_id": did, "exact": False})
    assert not conn.errors and json.dumps(dev.cfg["if"]["sync"], sort_keys=True) == json.dumps(original, sort_keys=True)
    # Refused before anything was sent: nothing is kept.
    monkeypatch.setattr(W, "check_cfg_patch", lambda patch, mx: "too big")
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 6, "device_id": did, "exact": True})
    assert conn.errors[0][0] == "refused" and (rec["join"], rec["exact"], rec["prior_sync"]) == ("wled", False, None)


async def test_the_original_sync_is_saved_before_the_sync_off_write(house, monkeypatch):
    """Review finding 3: a restart of HA between the write and the record
    must not lose the original settings either."""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    seen = []
    real = W.safe_cfg_write

    async def _spy(hass, tgt, patch, base_hash, **kw):
        seen.append(copy.deepcopy(house.store.store.saved["devices"]["28562f551738"]["prior_sync"]))
        return await real(hass, tgt, patch, base_hash, **kw)
    monkeypatch.setattr(W, "safe_cfg_write", _spy)
    await _to_padspan(house, did)
    assert seen and seen[0]["cfg"]["recv"]["grp"] == 1


async def test_a_command_that_never_reached_the_device_goes_on_when_it_is_back(house):
    """Review findings 4 and 9: offline (a WiFi drop, no restart) while it
    was switched: "the look goes on when it reconnects" — and it does."""
    devs, dids, _ = await _padspan_team(house)
    for d in devs:
        await d.handle("POST", "json/state", {"on": False})
    house.offline("m2", devs[2])
    out = await E.async_power(house.hass, "light.m0_main", True)
    assert {r["device_id"]: r for r in out["results"]}[dids[2]]["waiting"]
    house.offline("m2", devs[2], False)
    devs[2].info["uptime"] = 10_000_000               # never restarted
    house.clock[0] += 600
    await E.on_state_change(house.hass, "light.m2_main", SimpleNamespace(state="unavailable"), SimpleNamespace(state="off"))
    await house.settle()
    assert [d.serialize_state()["on"] for d in devs] == [True, True, True]
    # A single device: tapped on while offline, back without a restart.
    dev = simple_device(host="192.168.2.140", mac="aabbccddee40")
    did = house.add("porch", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.porch_main", False)
    await house.settle()
    house.offline("porch", dev)
    res = await E.async_power(house.hass, "light.porch_main", True, source="atlas")
    assert res["results"][0]["waiting"]
    house.offline("porch", dev, False)
    dev.info["uptime"] = 100_000
    house.clock[0] += 30
    await E.on_state_change(house.hass, "light.porch_main", SimpleNamespace(state="unavailable"), SimpleNamespace(state="off"))
    await house.settle()
    assert dev.serialize_state()["on"] is True
    # Negative controls: a command that landed isn't sent again on a
    # reconnect; nor is an outside "off" the device made itself (turned on
    # again while HA couldn't see it, it keeps its look, as before).
    house.clock[0] += 30
    n = len(dev.posts())
    E._worker(house.hass, "aabbccddee40").last_reconnect = -1e9
    await E.on_state_change(house.hass, "light.porch_main", SimpleNamespace(state="unavailable"), SimpleNamespace(state="on"))
    await house.settle()
    assert len(dev.posts()) == n
    house.clock[0] += 30
    await dev.handle("POST", "json/state", {"on": False})
    await E.on_state_change(house.hass, "light.porch_main", SimpleNamespace(state="on"), SimpleNamespace(state="off"))
    assert house.store.get("aabbccddee40")["last_cmd"]["source"] == "outside"
    house.clock[0] += 30
    await dev.handle("POST", "json/state", {"on": True})
    E._worker(house.hass, "aabbccddee40").last_reconnect = -1e9
    await E.on_state_change(house.hass, "light.porch_main", SimpleNamespace(state="unavailable"), SimpleNamespace(state="on"))
    await house.settle()
    assert dev.serialize_state()["on"] is True


async def test_a_failed_padspan_switch_leaves_a_wled_team_on_its_own_group(house):
    """Review finding 5: the rollback put every member on its settings from
    BEFORE the team; it goes back to what each had at the switch."""
    devs = [simple_device(host=f"192.168.2.{130 + i}", mac=f"aabbccddee{i:02x}") for i in range(3)]
    dids = [house.add(f"m{i}", d) for i, d in enumerate(devs)]
    prior = {}
    for i, (d, did) in enumerate(zip(devs, dids)):
        prior[did] = {"send": copy.deepcopy(d.cfg["if"]["sync"]["send"]), "recv": copy.deepcopy(d.cfg["if"]["sync"]["recv"])}
        d.cfg["if"]["sync"]["send"].update(grp=3, en=(i == 0))          # what applyTeam(join) left
        d.cfg["if"]["sync"]["recv"]["grp"] = 3 if i else 0
        d.sgrp, d.rgrp, d.send_rt = 3, (3 if i else 0), i == 0
    team_sync = [copy.deepcopy(d.cfg["if"]["sync"]) for d in devs]
    house.settings.data["wled_teams"] = [{"id": "t1", "name": "Valances", "mode": "mirror", "group": 3, "leader": dids[0],
                                          "followers": dids[1:], "prior": prior, "incomplete": []}]
    await _remember(house, dids[0], team=True)
    real = devs[2].handle

    async def _fail(method, path, body):
        if method == "POST" and (body or {}).get("udpn", {}).get("rgrp") == 0:
            raise W.WledError("http_error", "The device answered HTTP 500")
        return await real(method, path, body)
    devs[2].handle = _fail
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 5, "team_id": "t1", "mode": "padspan"})
    assert conn.errors and "switched back" in conn.errors[0][1]
    assert house.settings.data["wled_teams"][0]["mode"] == "mirror"
    for i, d in enumerate(devs):
        assert json.dumps(d.cfg["if"]["sync"], sort_keys=True) == json.dumps(team_sync[i], sort_keys=True), i
        u = d.serialize_state()["udpn"]
        assert (u["send"], u["sgrp"], u["rgrp"]) == (i == 0, 3, 3 if i else 0), i
        assert not house.store.get(d.info["mac"])["exact"]


async def test_a_team_member_padspan_cant_put_back_keeps_the_teams_group_to_go_back_to(house):
    """Review finding 5, its edge: a member whose sync-off write took, reply
    lost, then gone, stays PadSpan's — switching it back puts it on the
    team's group (where the switch found it), not its settings from before
    the team."""
    devs = [simple_device(host=f"192.168.2.{130 + i}", mac=f"aabbccddee{i:02x}") for i in range(2)]
    dids = [house.add(f"m{i}", d) for i, d in enumerate(devs)]
    prior = {did: {"send": copy.deepcopy(d.cfg["if"]["sync"]["send"]), "recv": copy.deepcopy(d.cfg["if"]["sync"]["recv"])}
             for d, did in zip(devs, dids)}
    for i, d in enumerate(devs):
        d.cfg["if"]["sync"]["send"].update(grp=3, en=(i == 0))
        d.cfg["if"]["sync"]["recv"]["grp"] = 3 if i else 0
        d.sgrp, d.rgrp, d.send_rt = 3, (3 if i else 0), i == 0
    team_sync = copy.deepcopy(devs[1].cfg["if"]["sync"])
    house.settings.data["wled_teams"] = [{"id": "t1", "name": "Valances", "mode": "mirror", "group": 3, "leader": dids[0],
                                          "followers": dids[1:], "prior": prior, "incomplete": []}]
    await _remember(house, dids[0], team=True)
    real = devs[1].handle

    async def _then_gone(method, path, body):
        out = await real(method, path, body)
        if method == "POST" and path == "json/cfg":
            devs[1].offline = True
            raise W.WledError("timeout", "No answer within 12 s")
        return out
    devs[1].handle = _then_gone
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 5, "team_id": "t1", "mode": "padspan"})
    assert conn.errors and house.settings.data["wled_teams"][0]["mode"] == "mirror"
    rec = house.store.get(devs[1].info["mac"])
    assert rec["exact"] and rec["prior_sync"]["cfg"]["recv"]["grp"] == 3
    assert not house.store.get(devs[0].info["mac"])["exact"]
    devs[1].handle, devs[1].offline = real, False
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 6, "device_id": dids[1], "exact": False})
    assert not conn.errors, conn.errors
    assert json.dumps(devs[1].cfg["if"]["sync"], sort_keys=True) == json.dumps(team_sync, sort_keys=True)


async def test_without_the_licence_a_padspan_team_is_still_switched_together(house):
    """Review finding 6: the members' sync stays off after a lapse, so every
    surface switches every member (plain HA calls) — Vacation Mode still
    switching only the leader is then right."""
    devs, dids, _ = await _padspan_team(house)
    house.tier[0] = False
    house.service_calls.clear()
    assert E.is_exact_entity(house.hass, "light.m0_main") and E.is_exact_entity(house.hass, "light.m1")
    out = await E.async_power(house.hass, "light.m1", True, 100, source="vacation")
    assert out["handled"] is False
    # Any light of a member is the member (as with the licence): every member's main light.
    assert sorted(c[2]["entity_id"] for c in house.service_calls) == ["light.m0_main", "light.m1_main", "light.m2_main"]
    assert all(c[:2] == ("light", "turn_on") for c in house.service_calls)
    conn = _Conn()
    await E.ws_wled_exact_list(house.hass, conn, {"id": 1})
    assert sorted(d["device_id"] for d in conn.results[0]["devices"]) == sorted(dids)
    assert all(d["team_id"] == "t1" for d in conn.results[0]["devices"])
    # Negative control: a device PadSpan runs on its own is HA's own light again.
    solo = simple_device(host="192.168.2.140", mac="aabbccddee40")
    sdid = house.add("solo", solo)
    house.tier[0] = True
    await _remember(house, sdid)
    await _to_padspan(house, sdid)
    house.tier[0] = False
    house.service_calls.clear()
    assert not E.is_exact_entity(house.hass, "light.solo_main")
    await E.async_power(house.hass, "light.solo_main", False)
    assert house.service_calls == [("light", "turn_off", {"entity_id": "light.solo_main"})]
    conn = _Conn()
    await E.ws_wled_exact_list(house.hass, conn, {"id": 2})
    assert sdid not in [d["device_id"] for d in conn.results[0]["devices"]]


async def test_identify_is_not_undone_by_put_the_look_back(house):
    """Review finding 7: Identify turns an OFF exact light on to blink a part;
    HA's off→on must not be taken as an outside "on" while it runs."""
    fired = []
    sys.modules["homeassistant.helpers.event"].async_call_later = lambda h, d, job: (fired.append(job), lambda: None)[1]
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    house.clock[0] += 30
    conn = _Conn()
    await W.ws_wled_identify(house.hass, conn, {"id": 9, "device_id": did, "seg_id": 1, "seconds": 10})
    assert not conn.errors
    blink = dev.serialize_state()
    assert blink["on"] and blink["seg"][1]["col"][0] == [255, 255, 255, 0]
    n = len(dev.posts())
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": blink["bri"]}))
    await house.settle()
    assert len(dev.posts()) == n and dev.serialize_state()["seg"][1]["col"][0] == [255, 255, 255, 0]
    await fired[-1]()                                   # the blink ends: the light is put back off
    assert dev.serialize_state()["on"] is False


async def test_a_member_of_a_wled_sync_team_is_never_switched_to_padspan_alone(house):
    """Review finding 8: its switch would leave the team (or stop the leader
    sending) with the team record unchanged — it goes through the team."""
    lead, fol = simple_device("192.168.2.118", mac="aa0000000001"), simple_device("192.168.2.116", mac="aa0000000002")
    dl, df = house.add("lead", lead), house.add("fol", fol)
    _team(house, dl, [df])
    for did, dev in ((df, fol), (dl, lead)):
        await _remember(house, did)
        conn = _Conn()
        await E.ws_wled_exact_set(house.hass, conn, {"id": 3, "device_id": did, "exact": True})
        assert conn.errors and conn.errors[0][0] == "in_team" and "WLED sync team" in conn.errors[0][1]
        assert dev.posts("json/cfg") == [] and not house.store.get(dev.info["mac"])["exact"]


async def test_one_segment_brightness_is_the_one_home_assistant_shows(house):
    """Review finding 10: with one segment HA shows seg × master / 255 (light.py
    2026.7.4). What the Atlas reads back must set the same light again."""
    dev = simple_device(segs=1)
    await dev.handle("POST", "json/state", {"bri": 200, "seg": [{"id": 0, "bri": 64}]})
    did = house.add("porch", dev, segs=1, main=False)
    await _remember(house, did)
    await _to_padspan(house, did)
    conn = _Conn()
    await E.ws_wled_exact_list(house.hass, conn, {"id": 1})
    d = conn.results[0]["devices"][0]
    assert d["main"] is None and d["look_bri"] == round(200 * 64 / 255)       # 50, as HA shows it
    await E.async_power(house.hass, "light.porch", True, 50)
    await house.settle()
    assert dev.serialize_state()["bri"] == round(50 * 255 / 64)               # 199, not 50
    await E.async_power(house.hass, "light.porch", True, 200)                 # past the part's own 64: the most it has
    await house.settle()
    assert dev.serialize_state()["bri"] == 255


# ── review round 2: what the repairs broke ───────────────────────────────────


async def _spin(n=10):
    for _ in range(n):
        await asyncio.sleep(0)


async def test_a_padspan_command_during_an_outside_changes_uptime_read_wins(house):
    """Review r2: an outside change waits for an uptime read (under the device
    lock). A PadSpan command that lands meanwhile — an automation's
    light.turn_off on the area, then padspan_ha.wled_on — is the newer one."""
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", True)
    await house.settle()
    house.clock[0] += 60
    for d in devs:                                   # HA's light.turn_off on the area
        await d.handle("POST", "json/state", {"on": False})
    for d in devs:                                   # a real request takes a moment
        d.gate = asyncio.Event()
    handlers = [asyncio.ensure_future(E.on_state_change(
        house.hass, f"light.m{i}_main", SimpleNamespace(state="on"), SimpleNamespace(state="off", attributes={})))
        for i in range(3)]
    await _spin()
    power = asyncio.ensure_future(E.async_power(house.hass, "light.m0_main", True, source="service"))
    await _spin()
    for d in devs:
        d.gate.set()
    await asyncio.gather(*handlers)
    res = await power
    await house.settle()
    assert all(r["ok"] for r in res["results"])
    assert [d.serialize_state()["on"] for d in devs] == [True, True, True]
    assert all(house.store.get(d.info["mac"])["last_cmd"]["on"] is True for d in devs)
    # A solo light: HA's turn_on, then padspan_ha.wled_off.
    dev = simple_device(host="192.168.2.140", mac="aabbccddee40")
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    house.clock[0] += 60
    await dev.handle("POST", "json/state", {"on": True, "bri": 60})
    dev.gate = asyncio.Event()
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                                                SimpleNamespace(state="on", attributes={"brightness": 60})))
    await _spin()
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", False, source="service"))
    await _spin()
    dev.gate.set()
    await h
    res = await p
    await house.settle()
    assert res["results"][0]["on"] is False and dev.serialize_state()["on"] is False
    assert house.store.get("aabbccddee40")["last_result"]["source"] == "service"
    # Negative control: with nothing newer, the outside "on" is still held.
    dev.gate = None
    house.clock[0] += 60
    await dev.handle("POST", "json/state", {"on": True, "bri": 60})
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 60}))
    await house.settle()
    assert dev.serialize_state()["on"] is True and house.store.get("aabbccddee40")["last_result"]["source"] == "hold"


async def test_a_command_the_device_didnt_answer_is_tried_again(house):
    """Review r2: a request error while HA still has the device brings no
    reconnect, so nothing would ever send it: PadSpan tries again after
    10 s and 60 s, then says it wasn't switched."""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    house.clock[0] += 60
    dev.busy = 3                                      # every try of the json/si read
    n = len(house.timers)
    res = await E.async_power(house.hass, "light.valance_main", True, source="atlas")
    r = res["results"][0]
    assert r["waiting"] and r["retry_in"] == 10 and "tries again in 10 s" in r["message"]
    assert [t[0] for t in house.timers[n:]] == [10]
    await house.timers[-1][1]()                       # 10 s later it answers
    await house.settle()
    rec = house.store.get("28562f551738")
    assert dev.serialize_state()["on"] is True
    assert rec["last_result"]["ok"] and rec["last_result"]["source"] == "atlas"
    # Still busy at both tries: it says so, and stops.
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    dev.busy = 9
    await E.async_power(house.hass, "light.valance_main", True)
    await house.timers[-1][1]()
    await house.settle()
    assert house.timers[-1][0] == 60 and rec["last_result"]["waiting"]
    await house.timers[-1][1]()
    await house.settle()
    assert not rec["last_result"].get("waiting") and "wasn't switched" in rec["last_result"]["error"]
    assert dev.serialize_state()["on"] is False
    # A newer command before the timer: the timer sends nothing.
    dev.busy = 3
    await E.async_power(house.hass, "light.valance_main", True)
    fire = house.timers[-1][1]
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    n = len(dev.posts())
    await fire()
    await house.settle()
    assert len(dev.posts()) == n and dev.serialize_state()["on"] is False


async def test_an_outside_change_replaces_a_command_that_never_went(house):
    """Review r2: a command that didn't answer (HA never showed the device
    unavailable) was re-sent on the next outside change, however old —
    undoing what the person just did. Their change stands; neither the
    retry nor a later reconnect sends the old command."""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True)
    await house.settle()
    house.clock[0] += 3600
    dev.busy = 3
    res = await E.async_power(house.hass, "light.valance_main", False, source="vacation")
    await house.settle()
    fire = house.timers[-1][1]
    assert res["results"][0]["waiting"] and dev.serialize_state()["on"] is True
    house.clock[0] += 5                                # someone dims it in HA
    await dev.handle("POST", "json/state", {"bri": 40})
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"),
                            SimpleNamespace(state="on", attributes={"brightness": 40}))
    await house.settle()
    rec = house.store.get("28562f551738")
    assert dev.serialize_state()["on"] is True and dev.serialize_state()["bri"] == 40
    assert not rec["last_result"]["waiting"] and "changed outside PadSpan" in rec["last_result"]["error"]
    await fire()
    await house.settle()
    assert dev.serialize_state()["on"] is True
    house.clock[0] += 8 * 3600                         # and not on a reconnect hours later
    dev.info["uptime"] = house.clock[0]                # up all along (booted at 0)
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="unavailable"),
                            SimpleNamespace(state="on", attributes={"brightness": 40}))
    await house.settle()
    assert dev.serialize_state()["on"] is True and dev.serialize_state()["bri"] == 40


async def test_a_switched_member_padspan_cant_put_back_goes_back_to_the_teams_group(house):
    """Review r2: a member already switched whose rollback fails stays
    PadSpan's; given back on its own tab it must go back to the team's
    group (where the switch found it), not its settings from before the team."""
    devs = [simple_device(host=f"192.168.2.{130 + i}", mac=f"aabbccddee{i:02x}") for i in range(3)]
    dids = [house.add(f"m{i}", d) for i, d in enumerate(devs)]
    prior = {}
    for i, (d, did) in enumerate(zip(devs, dids)):
        prior[did] = {"send": copy.deepcopy(d.cfg["if"]["sync"]["send"]), "recv": copy.deepcopy(d.cfg["if"]["sync"]["recv"])}
        d.cfg["if"]["sync"]["send"].update(grp=3, en=(i == 0))
        d.cfg["if"]["sync"]["recv"]["grp"] = 3 if i else 0
        d.sgrp, d.rgrp, d.send_rt = 3, (3 if i else 0), i == 0
    team_sync = copy.deepcopy(devs[0].cfg["if"]["sync"])
    house.settings.data["wled_teams"] = [{"id": "t1", "name": "Valances", "mode": "mirror", "group": 3, "leader": dids[0],
                                          "followers": dids[1:], "prior": prior, "incomplete": []}]
    await _remember(house, dids[0], team=True)
    real2 = devs[2].handle

    async def _fail(method, path, body):
        if method == "POST" and (body or {}).get("udpn", {}).get("rgrp") == 0:
            devs[0].offline = True                   # the leader drops off as the rollback starts
            raise W.WledError("http_error", "The device answered HTTP 500")
        return await real2(method, path, body)
    devs[2].handle = _fail
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 5, "team_id": "t1", "mode": "padspan"})
    assert conn.errors and "couldn't switch back: m0" in conn.errors[0][1]
    rec0 = house.store.get(devs[0].info["mac"])
    assert (rec0["join"], rec0["exact"]) == ("padspan", True)
    assert rec0["prior_sync"]["cfg"]["send"]["grp"] == 3 and rec0["prior_sync"]["cfg"]["send"]["en"] is True
    assert house.store.store.saved["devices"][devs[0].info["mac"]]["prior_sync"]["cfg"]["send"]["grp"] == 3
    devs[0].offline = False
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 6, "device_id": dids[0], "exact": False})
    assert not conn.errors, conn.errors
    assert json.dumps(devs[0].cfg["if"]["sync"], sort_keys=True) == json.dumps(team_sync, sort_keys=True)
    u = devs[0].serialize_state()["udpn"]
    assert (u["send"], u["sgrp"], u["rgrp"]) == (True, 3, 0)


async def test_a_light_padspan_keeps_after_a_failed_switch_is_listened_to(house):
    """Review r2: a failed switch can leave the device PadSpan's (exact); its
    lights must reach on_state_change (power-cut catch-up, hold) at once."""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    E._refresh_listener(house.hass)
    real = dev.handle

    async def _then_gone(method, path, body):
        out = await real(method, path, body)
        if method == "POST" and path == "json/cfg":
            dev.offline = True
            raise W.WledError("timeout", "No answer within 12 s")
        return out
    dev.handle = _then_gone
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 4, "device_id": did, "exact": True})
    assert conn.errors and house.store.get("28562f551738")["exact"] is True
    assert house.tracked and "light.valance_main" in house.tracked[-1]
    # The same through a team switch that fails.
    house.tracked.clear()
    devs = [simple_device(host=f"192.168.2.{130 + i}", mac=f"aabbccddee{i:02x}") for i in range(2)]
    dids = [house.add(f"m{i}", d) for i, d in enumerate(devs)]
    _team(house, dids[0], dids[1:])
    await _remember(house, dids[0], team=True)
    real1 = devs[1].handle

    async def _gone1(method, path, body):
        out = await real1(method, path, body)
        if method == "POST" and path == "json/cfg":
            devs[1].offline = True
            raise W.WledError("timeout", "No answer within 12 s")
        return out
    devs[1].handle = _gone1
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 5, "team_id": "t1", "mode": "padspan"})
    assert conn.errors and house.store.get(devs[1].info["mac"])["exact"] is True
    assert house.tracked and "light.m1_main" in house.tracked[-1]


async def test_without_the_licence_a_team_follows_a_member_switched_from_outside(house):
    """Review r2: after a lapse a member switched from HA's own dashboard,
    voice or an HA automation takes the others with it (plain HA calls, as
    every PadSpan surface does) — their WLED sync is off. PadSpan's own
    plain calls coming back through HA never cascade."""
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", False)
    await house.settle()
    house.clock[0] += 60
    house.tier[0] = False
    house.service_calls.clear()
    n = [len(d.posts()) for d in devs]
    await devs[0].handle("POST", "json/state", {"on": True})
    await E.on_state_change(house.hass, "light.m0_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 64}))
    assert house.service_calls == [("light", "turn_on", {"entity_id": "light.m1_main", "brightness": 64}),
                                   ("light", "turn_on", {"entity_id": "light.m2_main", "brightness": 64})]
    assert [len(d.posts()) - k for d, k in zip(devs, n)] == [1, 0, 0], "no exact command without the licence"
    # Those calls coming back through HA: nothing more.
    await E.on_state_change(house.hass, "light.m1_main", SimpleNamespace(state="off"),
                            SimpleNamespace(state="on", attributes={"brightness": 64}))
    assert len(house.service_calls) == 2
    # Off from outside: the others go off. A segment light, or no change of on/off, takes nobody.
    house.clock[0] += 10
    await E.on_state_change(house.hass, "light.m2_main", SimpleNamespace(state="on"), SimpleNamespace(state="off"))
    assert house.service_calls[2:] == [("light", "turn_off", {"entity_id": "light.m0_main"}),
                                       ("light", "turn_off", {"entity_id": "light.m1_main"})]
    house.clock[0] += 10
    await E.on_state_change(house.hass, "light.m1_segment_1", SimpleNamespace(state="off"), SimpleNamespace(state="on"))
    await E.on_state_change(house.hass, "light.m1_main", SimpleNamespace(state="on"),
                            SimpleNamespace(state="on", attributes={"brightness": 9}))
    assert len(house.service_calls) == 4
    # A device PadSpan ran on its own: HA's own light again, nothing follows.
    solo = simple_device(host="192.168.2.140", mac="aabbccddee40")
    sdid = house.add("solo", solo)
    house.tier[0] = True
    await _remember(house, sdid)
    await _to_padspan(house, sdid)
    house.tier[0] = False
    await E.on_state_change(house.hass, "light.solo_main", SimpleNamespace(state="off"), SimpleNamespace(state="on"))
    assert len(house.service_calls) == 4


async def test_without_the_licence_a_team_keeps_its_tuning_on_one_segment_lights(house):
    """Review r2: the plain calls took the brightness HA shows on a
    one-segment light as the master, and HA's call sets that part's opacity
    to 255. Upper North (.2.122: opacity 255, master 15) and Upper South
    (.2.123: opacity 13, master 128) end as they would with the licence."""
    un, us = simple_device("192.168.2.122", mac="aa0000000122", segs=1), simple_device("192.168.2.123", mac="aa0000000123", segs=1)
    await un.handle("POST", "json/state", {"on": True, "bri": 15, "seg": [{"id": 0, "bri": 255}]})
    await us.handle("POST", "json/state", {"on": True, "bri": 128, "seg": [{"id": 0, "bri": 13}]})
    dun, dus = house.add("un", un, segs=1, main=False), house.add("us", us, segs=1, main=False)
    _team(house, dus, [dun])
    await _remember(house, dus, team=True)
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 5, "team_id": "t1", "mode": "padspan"})
    assert not conn.errors, conn.errors
    await house.settle()

    def output(dev):
        st = dev.serialize_state()
        return round(st["bri"] * st["seg"][0]["bri"] / 255) if st["on"] else 0
    await E.async_power(house.hass, "light.us", True, 50)
    await house.settle()
    licensed = (output(us), output(un))
    house.tier[0] = False
    house.service_calls.clear()
    await E.async_power(house.hass, "light.us", True, 50)
    # HA's own turn_on on a one-segment light: master = brightness, opacity 255.
    plain = {c[2]["entity_id"]: c[2]["brightness"] for c in house.service_calls}
    assert (plain["light.us"], plain["light.un"]) == licensed == (13, 30)
    house.service_calls.clear()
    await E.async_power(house.hass, "light.us", True, 5)
    plain = {c[2]["entity_id"]: c[2]["brightness"] for c in house.service_calls}
    assert plain["light.us"] == 5 and plain["light.un"] == L.team_bri(15, round(5 * 255 / 13), 128)


# ── review round 3: what the round-2 repairs broke ───────────────────────────


def _up(house, devs, s):
    """s seconds pass; the devices stay up all along (no false restart)."""
    house.clock[0] += s
    for d in devs:
        d.info["uptime"] = house.clock[0]


async def test_a_retry_never_reaches_a_light_given_back_to_wled_sync(house):
    """Review r3: a command waiting to be tried again kept its timer after
    the light (or its team) went back to WLED sync, and every exact body
    switches the live sync off — so the retry cut it out of its team."""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True)
    await house.settle()
    _up(house, [dev], 60)
    dev.busy = 3
    res = await E.async_power(house.hass, "light.valance_main", False, source="presence")
    await house.settle()
    assert res["results"][0]["waiting"]
    fire = house.timers[-1][1]
    _up(house, [dev], 4)
    conn = _Conn()
    await E.ws_wled_exact_set(house.hass, conn, {"id": 9, "device_id": did, "exact": False})
    assert not conn.errors, conn.errors
    synced = dict(dev.serialize_state()["udpn"])
    rec = house.store.get("28562f551738")
    assert not rec["last_result"]["waiting"] and "WLED sync" in rec["last_result"]["error"]
    n = len(dev.posts())
    _up(house, [dev], 6)
    await fire()
    await house.settle()
    assert dev.posts()[n:] == [] and dev.serialize_state()["udpn"] == synced
    # A team given back to WLED sync: a member's retry sends nothing either.
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", True)
    await house.settle()
    _up(house, devs, 60)
    devs[1].busy = 3
    res = await E.async_power(house.hass, "light.m0_main", False, source="vacation")
    await house.settle()
    assert [r["waiting"] for r in res["results"]] == [False, True, False]
    fire = house.timers[-1][1]
    _up(house, devs, 3)
    conn = _Conn()
    await E.ws_wled_team_mode(house.hass, conn, {"id": 7, "team_id": "t1", "mode": "mirror"})
    assert not conn.errors, conn.errors
    synced = dict(devs[1].serialize_state()["udpn"])
    n = len(devs[1].posts())
    _up(house, devs, 7)
    await fire()
    await house.settle()
    assert devs[1].posts()[n:] == [] and devs[1].serialize_state()["udpn"] == synced


async def test_a_retry_after_the_licence_lapsed_sends_nothing(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    _up(house, [dev], 60)
    dev.busy = 3
    await E.async_power(house.hass, "light.valance_main", True, source="presence")
    await house.settle()
    fire = house.timers[-1][1]
    house.tier[0] = False
    n = len(dev.posts())
    await fire()
    await house.settle()
    assert len(dev.posts()) == n


async def _waiting_off(house):
    """Vacation Mode's off, unanswered (busy) while HA still has the light."""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True)
    await house.settle()
    _up(house, [dev], 3600)
    dev.busy = 3
    res = await E.async_power(house.hass, "light.valance_main", False, source="vacation")
    await house.settle()
    assert res["results"][0]["waiting"] and res["results"][0]["retry_in"] == 10
    assert dev.serialize_state()["on"] is True
    return dev, house.timers[-1][1]


async def test_a_retry_firing_while_an_outside_change_is_read_never_undoes_it(house):
    """Review r3 (a): the 10 s timer fired during the outside change's uptime
    read; the handler took the retry for a newer command and left, and the
    old off won over the person's dim."""
    dev, fire = await _waiting_off(house)
    _up(house, [dev], 9.8)                            # someone dims it in HA
    await dev.handle("POST", "json/state", {"bri": 40})
    dev.gate = asyncio.Event()                        # the uptime read takes a moment
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"),
                                                SimpleNamespace(state="on", attributes={"brightness": 40})))
    await _spin()
    _up(house, [dev], 0.2)
    t = asyncio.ensure_future(fire())                 # the timer fires meanwhile
    await _spin()
    dev.gate.set()
    await h
    await t
    await house.settle()
    dev.gate = None
    rec = house.store.get("28562f551738")
    s = dev.serialize_state()
    assert s["on"] is True and s["bri"] == 40
    assert rec["last_result"]["replaced"] and not rec["last_result"]["waiting"]


async def test_a_change_made_while_a_retry_is_being_read_stops_the_retries(house):
    """Review r3 (b): an outside change while a retry was reading the device
    was dropped as PadSpan's own echo (nothing had been written); the next
    retry undid it a minute later."""
    dev, fire = await _waiting_off(house)
    _up(house, [dev], 10)
    gate = dev.gate = asyncio.Event()
    t = asyncio.ensure_future(fire())                 # the retry's read is in flight
    await _spin()
    dev.gate = None
    await dev.handle("POST", "json/state", {"bri": 40})   # the person dims it
    dev.busy = 3                                      # the retry's read is answered busy
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"),
                                                SimpleNamespace(state="on", attributes={"brightness": 40})))
    await _spin()
    gate.set()
    await t
    await h
    await house.settle()
    rec = house.store.get("28562f551738")
    assert not rec["last_result"].get("waiting") and rec["last_result"].get("replaced")
    for _delay, job in list(house.timers):            # whatever timers there are fire
        await job()
        await house.settle()
    s = dev.serialize_state()
    assert s["on"] is True and s["bri"] == 40
    # Its read answered instead: nothing is written over the person's change.
    dev2 = simple_device(host="192.168.2.141", mac="aabbccddee41")
    did2 = house.add("desk", dev2)
    await _remember(house, did2)
    await _to_padspan(house, did2)
    await E.async_power(house.hass, "light.desk_main", True)
    await house.settle()
    _up(house, [dev2], 3600)
    dev2.busy = 3
    await E.async_power(house.hass, "light.desk_main", False, source="vacation")
    await house.settle()
    fire2 = house.timers[-1][1]
    _up(house, [dev2], 10)
    gate = dev2.gate = asyncio.Event()
    t = asyncio.ensure_future(fire2())
    await _spin()
    dev2.gate = None
    await dev2.handle("POST", "json/state", {"bri": 40})
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.desk_main", SimpleNamespace(state="on"),
                                                SimpleNamespace(state="on", attributes={"brightness": 40})))
    await _spin()
    n = len(dev2.posts())
    gate.set()
    await t
    await h
    await house.settle()
    assert dev2.posts()[n:] == [] and dev2.serialize_state()["on"] is True


async def test_a_retrys_own_write_coming_back_before_its_reply_is_not_an_outside_change(house, monkeypatch):
    """The retry's own off reaches HA (WLED pushes it) before the reply to
    its POST: that is PadSpan's echo, not someone switching it off."""
    dev, fire = await _waiting_off(house)
    _up(house, [dev], 10)
    held = asyncio.Event()
    replied = asyncio.Event()
    orig = house.fleet.request_once

    async def _slow_reply(hass, host, method, path, body, timeout):
        res = await orig(hass, host, method, path, body, timeout)
        if method == "POST" and path == "json/state":
            held.set()
            await replied.wait()
        return res
    monkeypatch.setattr(W, "_request_once", _slow_reply)
    t = asyncio.ensure_future(fire())
    await held.wait()
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"),
                            SimpleNamespace(state="off", attributes={}))
    replied.set()
    await t
    await house.settle()
    rec = house.store.get("28562f551738")
    assert rec["last_cmd"]["source"] == "vacation"
    assert rec["last_result"]["ok"] and rec["last_result"]["source"] == "vacation"
    assert dev.serialize_state()["on"] is False


async def test_a_change_seen_before_a_retry_starts_running_still_stops_it(house):
    """The retry is submitted, its task not yet running, when HA reports the
    person's dim: it is not PadSpan's echo (nothing has been sent)."""
    dev, fire = await _waiting_off(house)
    _up(house, [dev], 10)
    await dev.handle("POST", "json/state", {"bri": 40})
    await fire()                                      # submitted; the task hasn't run yet
    await E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"),
                            SimpleNamespace(state="on", attributes={"brightness": 40}))
    await house.settle()
    s = dev.serialize_state()
    assert s["on"] is True and s["bri"] == 40
    assert house.store.get("28562f551738")["last_result"]["replaced"]


# ── review round 4: what the round-3 repairs left ────────────────────────────


def _hold_request(monkeypatch, house, method, path):
    """The first matching request waits until released."""
    held, release = asyncio.Event(), asyncio.Event()
    orig = house.fleet.request_once
    state = {"done": False}

    async def _req(hass, host, m, p, body, timeout):
        if m == method and p == path and not state["done"]:
            state["done"] = True
            held.set()
            await release.wait()
        return await orig(hass, host, m, p, body, timeout)
    monkeypatch.setattr(W, "_request_once", _req)
    return held, release


async def _lit(house):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", True)
    await house.settle()
    return dev, did


def _shown(bri=40):
    return SimpleNamespace(state="on", attributes={"brightness": bri})


async def _w(aw):
    return await asyncio.wait_for(aw, 15)


async def test_a_change_during_a_retrys_setup_recheck_stops_it(house, monkeypatch):
    """Review r4 (P1): the retry checked for a change from outside before its
    once-a-day LED setup read, the last wait before it writes: a dim made
    during that read was counted, and the old off went anyway."""
    dev, _did = await _lit(house)
    _up(house, [dev], 86400 + 10)                     # the daily setup recheck is due
    dev.busy = 3
    res = await E.async_power(house.hass, "light.valance_main", False, source="vacation")
    await house.settle()
    assert res["results"][0]["waiting"] and res["results"][0]["retry_in"] == 10
    fire = house.timers[-1][1]
    _up(house, [dev], 10)
    held, release = _hold_request(monkeypatch, house, "GET", "json/cfg")
    t = asyncio.ensure_future(fire())                 # its json/si answered, its json/cfg read held
    await _w(held.wait())
    await dev.handle("POST", "json/state", {"bri": 40})   # the person dims it meanwhile
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"), _shown()))
    await _spin()
    release.set()
    await _w(t)
    await _w(h)
    await house.settle()
    rec = house.store.get("28562f551738")
    s = dev.serialize_state()
    assert s["on"] is True and s["bri"] == 40
    assert rec["last_result"]["replaced"] and not rec["last_result"]["ok"]


async def test_a_change_while_the_first_try_is_answered_busy_is_not_undone_by_the_retry(house):
    """Review r4 (P6): while the first try's read was answered busy (WLED's
    JSON buffer in use by the panel, the app or HA), a change from outside
    was taken for PadSpan's echo — nothing had been sent — and the retry
    undid it 10 s later."""
    dev, _did = await _lit(house)
    _up(house, [dev], 3600)
    dev.busy = 3
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", False, source="presence"))
    for _ in range(200):                              # its first read answered busy
        await asyncio.sleep(0.01)
        if dev.busy == 2:
            break
    assert dev.busy == 2
    b, dev.busy = dev.busy, 0
    await dev.handle("POST", "json/state", {"bri": 40})   # someone dims it
    dev.busy = b
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"), _shown()))
    res = await _w(p)
    await _w(h)
    await house.settle()
    r0 = res["results"][0]
    assert not r0["waiting"] and "changed outside PadSpan" in r0["message"]
    for _delay, job in list(house.timers):            # whatever timers there are fire
        await _w(job())
        await house.settle()
    s = dev.serialize_state()
    assert s["on"] is True and s["bri"] == 40


async def test_a_change_while_the_first_try_times_out_is_not_undone_by_the_retry(house, monkeypatch):
    """Review r4 (P6b): the same for a first read that times out (8 s)."""
    dev, _did = await _lit(house)
    _up(house, [dev], 3600)
    held, release = asyncio.Event(), asyncio.Event()
    orig = house.fleet.request_once
    state = {"n": 0}

    async def _req(hass, host, m, p, body, timeout):
        if m == "GET" and p == "json/si" and state["n"] == 0:
            state["n"] = 1
            held.set()
            await release.wait()
            raise W.WledError("timeout", "No answer within 8 s")
        return await orig(hass, host, m, p, body, timeout)
    monkeypatch.setattr(W, "_request_once", _req)
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", False, source="presence"))
    await _w(held.wait())
    _up(house, [dev], 4)                              # 4 s into the read, the wall button dims it
    await dev.handle("POST", "json/state", {"bri": 40})
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"), _shown()))
    await _spin()
    _up(house, [dev], 4)
    release.set()
    res = await _w(p)
    await _w(h)
    await house.settle()
    assert not res["results"][0]["waiting"] and "changed outside PadSpan" in res["results"][0]["message"]
    for _delay, job in list(house.timers):
        await _w(job())
        await house.settle()
    s = dev.serialize_state()
    assert s["on"] is True and s["bri"] == 40


async def test_a_fresh_command_goes_even_when_a_change_is_reported_while_it_is_read(house, monkeypatch):
    """Live test 2026-09-28 (Quin Kitchen, cycle 12): a colour changed on
    WLED's own page, then an Atlas "off" 1.5 s later — HA reported the change
    after the off was issued, and the off was dropped as "changed outside
    PadSpan first". A fresh command is the newest word: it goes. (Only
    PadSpan's own repeats and answers step aside for a change from outside.)"""
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    look = house.store.get("28562f551738")["look"]
    await E.async_power(house.hass, "light.valance_main", True)
    await house.settle()
    _up(house, [dev], 60)
    # (1) The live-test sequence: changed on WLED's page while lit ...
    await dev.handle("POST", "json/state", {"seg": [{"id": 1, "col": [[255, 0, 0]], "fx": 9}, {"id": 0, "col": [[255, 0, 255]]}]})
    _up(house, [dev], 1.5)
    # ... then the Atlas "off"; HA reports the WLED-page change while the off is read.
    held, release = _hold_request(monkeypatch, house, "GET", "json/si")
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", False, source="atlas"))
    await _w(held.wait())
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_segment_1", SimpleNamespace(state="on"),
                                                _shown(128)))
    await _spin()
    release.set()
    res = await _w(p)
    await _w(h)
    await house.settle()
    r0 = res["results"][0]
    assert r0["ok"] and not r0["message"], r0
    assert dev.serialize_state()["on"] is False
    # (2) An "on" from the Atlas while the wall button turns it on at 60 with an
    # old colour: the Atlas "on" goes — the look, at the look's brightness.
    _up(house, [dev], 60)
    held, release = _hold_request(monkeypatch, house, "GET", "json/si")
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", True, source="atlas"))
    await _w(held.wait())
    await dev.handle("POST", "json/state", {"on": True, "bri": 60, "seg": [{"id": 1, "col": [[0, 0, 255]]}]})
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"),
                                                _shown(60)))
    await _spin()
    release.set()
    res = await _w(p)
    await _w(h)
    await house.settle()
    assert res["results"][0]["ok"], res
    st = dev.serialize_state()
    assert st["on"] and st["bri"] == look["state"]["bri"]
    assert L.compare(look["state"], st, L.Ctx(dev.serialize_info()), on=True, bri=look["state"]["bri"], exact=True) == []
    # (3) A presence "off" while someone dims it at the wall: the off goes too.
    _up(house, [dev], 60)
    held, release = _hold_request(monkeypatch, house, "GET", "json/si")
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", False, source="presence"))
    await _w(held.wait())
    await dev.handle("POST", "json/state", {"bri": 40})
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="on"), _shown()))
    await _spin()
    release.set()
    res = await _w(p)
    await _w(h)
    await house.settle()
    assert res["results"][0]["ok"], res
    assert dev.serialize_state()["on"] is False


async def test_the_other_lights_reporting_the_same_change_never_stop_a_command(house, monkeypatch):
    """Review r4: the lights of one device report one change together, one
    after the other. The ones that come after a hold or a reconnect started
    for it, or after a newer PadSpan command, are that same change: they
    must not stop the command, nor its retry when the device was busy."""
    lights = ("light.valance", "light.valance_segment_1")
    # (a) The wall button turns it on; the hold's read is answered busy
    # while the segment lights report the same "on": it still waits.
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    look = house.store.get("28562f551738")["look"]
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    _up(house, [dev], 60)
    arm = {"after_info": 0, "si": 0}
    orig = house.fleet.request_once

    async def _busy_after_info(hass, host, m, pth, body, timeout):
        if m == "GET" and pth == "json/si" and arm["si"]:
            arm["si"] -= 1
            raise W.WledError("busy", "The device is busy — try again in a moment")
        res = await orig(hass, host, m, pth, body, timeout)
        if m == "GET" and pth == "json/info" and arm["after_info"]:
            arm.update(after_info=0, si=3)            # the command's read that follows is answered busy
        return res
    monkeypatch.setattr(W, "_request_once", _busy_after_info)
    await dev.handle("POST", "json/state", {"on": True, "bri": 60, "seg": [{"id": 1, "col": [[0, 0, 255]]}]})
    arm["after_info"] = 1
    await _w(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"), _shown(60)))
    await _spin()                                     # (HA starts it at once)
    for eid in lights:                                # the hold is reading meanwhile
        await _w(E.on_state_change(house.hass, eid, SimpleNamespace(state="off"), _shown(60)))
    await house.settle()
    rec = house.store.get("28562f551738")
    assert rec["last_result"]["source"] == "hold" and rec["last_result"].get("waiting"), rec["last_result"]
    await _w(house.timers[-1][1]())
    await house.settle()
    st = dev.serialize_state()
    assert st["on"] and st["bri"] == 60 and rec["last_result"]["ok"]
    assert L.compare(look["state"], st, L.Ctx(dev.serialize_info()), on=True, bri=60, exact=True) == []
    # (b) A restart HA never showed as unavailable (it boots ON): the
    # reconnect's read is answered busy while the other lights report the
    # boot — the off still goes back.
    await E.async_power(house.hass, "light.valance_main", False)
    await house.settle()
    _up(house, [dev], 3600)
    dev.reboot()
    dev.info["uptime"] = 2
    arm["after_info"] = 1
    await _w(E.on_state_change(house.hass, "light.valance_main", SimpleNamespace(state="off"), _shown(128)))
    await _spin()
    for eid in lights:                                # the reconnect is reading meanwhile
        await _w(E.on_state_change(house.hass, eid, SimpleNamespace(state="off"), _shown(128)))
    await house.settle()
    assert rec["last_result"]["source"] == "reconnect" and rec["last_result"].get("waiting"), rec["last_result"]
    _up(house, [dev], 10)
    await _w(house.timers[-1][1]())
    await house.settle()
    assert dev.serialize_state()["on"] is False and rec["last_result"]["ok"]
    # (c) HA's area off, whose uptime read is slow; a PadSpan "on" lands
    # meanwhile (the newer one) and its read is answered busy; the segment
    # lights' off, reported with the main light's, comes after: it retries.
    await E.async_power(house.hass, "light.valance_main", True)
    await house.settle()
    _up(house, [dev], 60)
    await dev.handle("POST", "json/state", {"on": False})
    held, release = asyncio.Event(), asyncio.Event()
    orig = house.fleet.request_once
    busy_si = {"n": 3}

    async def _req(hass, host, m, pth, body, timeout):
        if m == "GET" and pth == "json/info" and not release.is_set():
            held.set()
            await release.wait()                      # the uptime read takes a moment
        if m == "GET" and pth == "json/si" and busy_si["n"]:
            busy_si["n"] -= 1
            raise W.WledError("busy", "The device is busy — try again in a moment")
        return await orig(hass, host, m, pth, body, timeout)
    monkeypatch.setattr(W, "_request_once", _req)
    off = SimpleNamespace(state="off", attributes={})
    handlers = [asyncio.ensure_future(E.on_state_change(house.hass, eid, SimpleNamespace(state="on"), off))
                for eid in ("light.valance_main", *lights)]
    await _w(held.wait())
    await _spin()
    _up(house, [dev], 0.5)
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", True, source="service"))
    await _spin()
    release.set()
    await _w(asyncio.gather(*handlers))
    res = await _w(p)
    await house.settle()
    assert res["results"][0]["waiting"], res
    assert rec["last_result"]["source"] == "service" and not rec["last_result"].get("replaced")
    _up(house, [dev], 10)
    await _w(house.timers[-1][1]())
    await house.settle()
    assert dev.serialize_state()["on"] is True and rec["last_result"]["ok"]
