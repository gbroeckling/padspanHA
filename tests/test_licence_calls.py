# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The licence and update checks, done the careful way (2026-11-18).

- The key and the home's id go in a POST body, never a URL, and the id is a
  hash: the raw instance id stays home once the licence server reads the hash.
  A server from before that (or one moving a home over to the hash) is asked
  once more with the raw id.
- A home whose instance id can't be read gets its own random id, kept, instead
  of the "padspan-ha" every such install used to share.
- The first check after a start waits a random while; a check in the last 20
  hours makes the next one wait.
- PadSpan's own User-Agent, and one more try after a 429.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.padspan_ha import licence_homes as LH
from custom_components.padspan_ha import server_http as SH
from custom_components.padspan_ha import update_check as U
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN, VERSION

RAW = "0123456789abcdef0123456789abcdef"
HASHED = hashlib.sha256(f"padspan-licence|{RAW}".encode()).hexdigest()


class _St:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def async_set(self, **kw):
        self.data.update(kw)


class _Resp:
    def __init__(self, status, body, headers=None):
        self.status, self._body, self.headers = status, body, headers or {}

    async def text(self):
        return self._body if isinstance(self._body, str) else json.dumps(self._body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Session:
    """Answers in order; records (method, url, kwargs) of every request."""

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def _req(self, method, url, **kw):
        self.calls.append((method, url, kw))
        return _Resp(*self.answers.pop(0))

    def get(self, url, **kw):
        return self._req("GET", url, **kw)

    def post(self, url, **kw):
        return self._req("POST", url, **kw)


def _wire(monkeypatch, *answers, instance=RAW, settings=None):
    session = _Session(*answers)
    http = types.ModuleType("homeassistant.helpers.aiohttp_client")
    http.async_get_clientsession = lambda hass: session
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", http)
    iid = types.ModuleType("homeassistant.helpers.instance_id")
    if isinstance(instance, Exception):
        iid.async_get = AsyncMock(side_effect=instance)
    else:
        iid.async_get = AsyncMock(return_value=instance)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.instance_id", iid)
    waits = []

    async def _sleep(s):
        waits.append(s)
    monkeypatch.setattr(SH, "_sleep", _sleep)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: _St(settings)}})
    return hass, session, waits


ACK = {"valid": True, "token": "b" * 32, "machine_h": True}


# ── (a) POST, a hash, and the old form only for an old server ──────────────

def test_the_key_and_a_hash_of_the_id_go_in_a_post_body(monkeypatch):
    hass, session, _ = _wire(monkeypatch, (200, ACK))
    data = asyncio.run(LH.call(hass, "validate", "PSPAN-AAAA", LH.home_params({"license_home_token": "a" * 32})))
    assert data["token"] == "b" * 32
    assert len(session.calls) == 1, "a server that confirms the hash is asked once"
    method, url, kw = session.calls[0]
    assert method == "POST" and url == LH.LICENCE_URL
    assert kw["params"] == {"action": "validate", "product": "padspan"}, "nothing secret in the address"
    body = kw["data"]
    assert body["key"] == "PSPAN-AAAA" and body["machine_h"] == HASHED and body["token"] == "a" * 32
    assert "machine" not in body and RAW not in json.dumps(kw), "the raw instance id never leaves"


def test_the_hash_is_the_one_the_licence_server_makes_in_both_editions():
    """The server hashes an older PadSpan's raw id with the same prefix;
    Bright's derivation renames padspan_ha / padspan-ha / padspan-lights /
    "PadSpan HA" in every file, so the prefix must hold none of them."""
    assert LH.machine_hash(RAW) == HASHED
    for renamed in ("padspan_", "padspan-ha", "padspan-b", "padspan-lights", "PadSpan "):
        assert renamed not in "padspan-licence|"


@pytest.mark.parametrize("status", [400, 404, 405, 415])
def test_a_server_that_refuses_the_post_is_asked_once_the_old_way(monkeypatch, status):
    hass, session, _ = _wire(monkeypatch, (status, "Method Not Allowed"), (200, {"valid": True}))
    data = asyncio.run(LH.call(hass, "validate", "PSPAN-AAAA", {"t": "1", "token": ""}))
    assert data == {"valid": True}
    assert [c[0] for c in session.calls] == ["POST", "GET"]
    old = session.calls[1][2]["params"]
    assert old == {"action": "validate", "product": "padspan", "key": "PSPAN-AAAA", "machine": RAW, "t": "1", "token": ""}, \
        "exactly the request older PadSpan makes"


@pytest.mark.parametrize("answer", [
    {"valid": True, "expires_at": "2027-01-01"},   # a server from before: reads the body, not the hash
    {"status": "send_machine"},                     # the new server, moving a home recorded by the raw id
    "not json",
])
def test_an_answer_that_does_not_confirm_the_hash_is_asked_again_in_a_body(monkeypatch, answer):
    """Its answer is not used. The raw id goes once more, in a POST body:
    never in a URL."""
    hass, session, _ = _wire(monkeypatch, (200, answer), (200, {"valid": True, "token": "c" * 32}))
    data = asyncio.run(LH.call(hass, "validate", "PSPAN-AAAA", {"t": "1"}))
    assert data["token"] == "c" * 32
    assert [c[0] for c in session.calls] == ["POST", "POST"]
    again = session.calls[1][2]
    assert again["params"] == {"action": "validate", "product": "padspan"}
    assert again["data"] == {"key": "PSPAN-AAAA", "machine": RAW, "t": "1"}


def test_a_refused_post_call_is_asked_again_as_a_post(monkeypatch):
    hass, session, _ = _wire(monkeypatch, (405, "Method Not Allowed"), (200, {"ok": True}))
    asyncio.run(LH.call(hass, "home_label", "PSPAN-AAAA", {"label": "Cabin"}, post=True))
    assert [c[0] for c in session.calls] == ["POST", "POST"]
    assert session.calls[1][2]["data"] == {"key": "PSPAN-AAAA", "machine": RAW, "label": "Cabin"}


def test_a_refused_fallback_raises(monkeypatch):
    hass, session, _ = _wire(monkeypatch, (404, ""), (404, ""))
    with pytest.raises(RuntimeError):
        asyncio.run(LH.call(hass, "homes", "PSPAN-AAAA"))
    assert len(session.calls) == 2, "once more, not again and again"


@pytest.mark.parametrize("status", [500, 502, 503])
def test_a_server_that_is_down_is_not_asked_again(monkeypatch, status):
    hass, session, _ = _wire(monkeypatch, (status, "down"))
    with pytest.raises(RuntimeError):
        asyncio.run(LH.call(hass, "validate", "PSPAN-AAAA"))
    assert len(session.calls) == 1


def test_the_daily_recheck_and_the_activation_use_the_call():
    import pathlib
    cc = pathlib.Path(LH.__file__).parent
    for name in ("update_check.py", "ws_forensics.py"):
        src = (cc / name).read_text(encoding="utf-8")
        assert 'await call(hass, "validate", key, ' in src, name
    fo = (cc / "ws_forensics.py").read_text(encoding="utf-8")
    act = fo[fo.index("async def ws_forensics_license_activate("):fo.index("async def ws_trial_start(")]
    assert "session.get(" not in act and '"key": key' not in act, "no key in a URL"


# ── The trial: the hash too, and the raw id once for a server from before ──

TRIAL_OK = {"ok": True, "key": "PSPAN-TRIA-LKEY-AAAA-BBBB", "tier": "pro", "expires_at": "2027-02-16 00:00:00",
            "days_left": 90}


def test_a_trial_asks_with_the_hash_in_a_post_body(monkeypatch):
    hass, session, _ = _wire(monkeypatch, (200, {**TRIAL_OK, "machine_h": True}))
    assert asyncio.run(LH.trial_start(hass, "a@b.ca"))["key"] == TRIAL_OK["key"]
    assert len(session.calls) == 1
    method, url, kw = session.calls[0]
    assert method == "POST" and url == LH.LICENCE_URL
    assert kw["params"] == {"action": "trial_start", "product": "padspan"}
    assert kw["data"] == {"email": "a@b.ca", "machine_h": HASHED}
    assert RAW not in json.dumps(kw) and kw["headers"]["User-Agent"] == SH.USER_AGENT


def test_todays_server_refuses_a_trial_without_machine_and_gets_the_raw_id_once(monkeypatch):
    """license/index.php before the hash: no `machine` -> "invalid_machine",
    answered before anything is read or written. Then the old request."""
    hass, session, _ = _wire(monkeypatch,
                             (200, {"ok": False, "status": "invalid_machine", "message": "Missing install identifier."}),
                             (200, TRIAL_OK))
    assert asyncio.run(LH.trial_start(hass, "a@b.ca")) == TRIAL_OK
    assert [c[0] for c in session.calls] == ["POST", "POST"]
    assert session.calls[1][2]["data"] == {"email": "a@b.ca", "machine": RAW}, "exactly what older PadSpan sends"


@pytest.mark.parametrize("first", [(405, "Method Not Allowed"), (200, {"ok": False, "status": "send_machine"})])
def test_a_trial_falls_back_as_a_post(monkeypatch, first):
    hass, session, _ = _wire(monkeypatch, first, (200, TRIAL_OK))
    asyncio.run(LH.trial_start(hass, "a@b.ca"))
    assert [c[0] for c in session.calls] == ["POST", "POST"] and session.calls[1][2]["data"]["machine"] == RAW


def test_a_confirmed_refusal_is_the_answer(monkeypatch):
    refused = {"ok": False, "status": "trial_exhausted", "message": "used", "machine_h": True}
    hass, session, _ = _wire(monkeypatch, (200, refused))
    assert asyncio.run(LH.trial_start(hass, "a@b.ca")) == refused and len(session.calls) == 1


def test_the_trial_command_stores_the_key_it_gets(monkeypatch):
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha import ws_forensics as F
    hass, session, _ = _wire(monkeypatch, (200, {**TRIAL_OK, "machine_h": True}))
    monkeypatch.setattr(T, "enabled", lambda h: True)
    monkeypatch.setattr(F, "_invalidate_snapshot_cache", lambda h: None)
    monkeypatch.setattr(F, "_get_settings", lambda h: {})
    sent = {}
    conn = SimpleNamespace(send_result=lambda i, r: sent.update(r), send_error=lambda i, c, m: sent.update(error=c))
    asyncio.run(F.ws_trial_start(hass, conn, {"id": 1, "email": "a@b.ca"}))
    st = hass.data[DOMAIN][DATA_SETTINGS].data
    assert sent.get("ok") is True and st["forensics_license_key"] == TRIAL_OK["key"] and st["license_is_trial"] is True
    assert session.calls[0][2]["data"] == {"email": "a@b.ca", "machine_h": HASHED}


# ── (b) An install without a readable instance id ──────────────────────────

def test_an_unreadable_instance_id_gives_this_install_its_own_kept_id(monkeypatch):
    hass, _, _ = _wire(monkeypatch, instance=RuntimeError("no core.uuid"))
    first = asyncio.run(LH.machine_id(hass))
    assert first != "padspan-ha" and len(first) == 32
    assert hass.data[DOMAIN][DATA_SETTINGS].data["license_install_id"] == first, "kept in PadSpan's settings"
    assert asyncio.run(LH.machine_id(hass)) == first, "made once"
    other, _, _ = _wire(monkeypatch, instance=RuntimeError("no core.uuid"))
    assert asyncio.run(LH.machine_id(other)) != first, "two such installs are two homes"


def test_a_readable_instance_id_is_used_and_nothing_is_stored(monkeypatch):
    hass, _, _ = _wire(monkeypatch)
    assert asyncio.run(LH.machine_id(hass)) == RAW
    assert "license_install_id" not in hass.data[DOMAIN][DATA_SETTINGS].data


def test_no_licence_call_has_a_shared_fallback_id_any_more():
    import pathlib
    cc = pathlib.Path(LH.__file__).parent
    import re
    for name in ("licence_homes.py", "ws_forensics.py", "pro_invite.py"):
        assert not re.search(r'(=|return)\s*"padspan-ha"', (cc / name).read_text(encoding="utf-8")), name


def test_the_install_id_survives_a_reset_and_a_restore_and_stays_in_the_backend():
    import pathlib
    cc = pathlib.Path(LH.__file__).parent
    assert '"license_install_id", "license_home_token",' in (cc / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert 'data["license_install_id"] = _live.get("license_install_id", "")' in (cc / "ws_backup.py").read_text(encoding="utf-8")
    assert 'out["license_install_id"] = ""' in (cc / "ws_common.py").read_text(encoding="utf-8")


# ── (c) A random first delay, and no check twice in 20 hours ───────────────

def _counted(monkeypatch):
    ran = []

    async def _check(hass):
        ran.append("check")

    async def _reval(hass):
        ran.append("licence")
    monkeypatch.setattr(U, "_check", _check)
    monkeypatch.setattr(U, "_revalidate_license", _reval)
    return ran


@pytest.mark.parametrize("ago_h,runs", [(1, False), (19.9, False), (20.1, True), (48, True)])
def test_a_check_in_the_last_20_hours_makes_the_next_one_wait(monkeypatch, ago_h, runs):
    ran = _counted(monkeypatch)
    now = 1_800_000_000.0
    st = _St({"server_checked_at": now - ago_h * 3600})
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}})
    assert asyncio.run(U._run_if_due(hass, now=lambda: now)) is runs
    assert ran == (["check", "licence"] if runs else [])
    assert st.data["server_checked_at"] == (now if runs else now - ago_h * 3600)


@pytest.mark.parametrize("stamp", [0, None, "junk", 1_800_000_000.0 + 3600])
def test_no_stamp_or_one_in_the_future_never_holds_the_checks_off(monkeypatch, stamp):
    ran = _counted(monkeypatch)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: _St({"server_checked_at": stamp})}})
    assert asyncio.run(U._run_if_due(hass, now=lambda: 1_800_000_000.0)) is True
    assert ran == ["check", "licence"]


def test_the_first_check_waits_a_random_while_then_runs_daily(monkeypatch):
    later, intervals = [], []
    ev = types.ModuleType("homeassistant.helpers.event")
    ev.async_call_later = lambda hass, delay, action: later.append((delay, action)) or (lambda: None)
    ev.async_track_time_interval = lambda hass, action, every: intervals.append((action, every)) or (lambda: None)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    monkeypatch.setattr(U.random, "uniform", lambda a, b: 4321.0)
    ran = _counted(monkeypatch)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: _St()}})
    U.async_setup_update_check(hass)
    assert [d for d, _ in later] == [4321.0] and intervals == [], "nothing at start, no daily timer yet"
    assert U._FIRST_DELAY_S == (300, 6 * 3600) and U._MIN_AGE_S == 20 * 3600
    asyncio.run(later[0][1]())
    assert ran == ["check", "licence"]
    assert len(intervals) == 1 and intervals[0][1].total_seconds() == 24 * 3600
    U.async_stop_update_check(hass)
    assert U._DATA_UNSUBS not in hass.data[DOMAIN]


def _timers(monkeypatch):
    later, intervals, cancelled = [], [], []
    ev = types.ModuleType("homeassistant.helpers.event")
    ev.async_call_later = lambda hass, delay, action: later.append(action) or (lambda: cancelled.append("later"))
    ev.async_track_time_interval = lambda hass, action, every: intervals.append(action) or (lambda: cancelled.append("daily"))
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    return later, intervals, cancelled


def test_a_stop_while_the_first_check_runs_leaves_nothing_running(monkeypatch):
    later, intervals, cancelled = _timers(monkeypatch)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: _St()}})

    async def _stops(h, now=None):
        U.async_stop_update_check(h)
        return True
    monkeypatch.setattr(U, "_run_if_due", _stops)
    U.async_setup_update_check(hass)
    asyncio.run(later[0]())
    assert len(intervals) == 1 and "daily" in cancelled


def test_a_stop_before_the_first_check_adds_no_daily_timer(monkeypatch):
    later, intervals, _ = _timers(monkeypatch)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: _St()}})
    _counted(monkeypatch)
    U.async_setup_update_check(hass)
    U.async_stop_update_check(hass)
    asyncio.run(later[0]())   # a timer that fired as it was cancelled
    assert intervals == []


def test_a_first_check_that_raises_keeps_the_daily_timer(monkeypatch):
    later, intervals, _ = _timers(monkeypatch)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: _St()}})

    async def _boom(h, now=None):
        raise RuntimeError("unexpected answer")
    monkeypatch.setattr(U, "_run_if_due", _boom)
    U.async_setup_update_check(hass)
    with pytest.raises(RuntimeError):
        asyncio.run(later[0]())
    assert len(intervals) == 1


# ── (d) PadSpan's User-Agent, and one more try after a 429 ─────────────────

def test_every_request_names_padspan(monkeypatch):
    hass, session, _ = _wire(monkeypatch, (200, ACK), (200, {"latest_stable": "0.0.1"}))
    asyncio.run(LH.call(hass, "validate", "PSPAN-AAAA"))
    asyncio.run(U._check(hass))
    assert len(session.calls) == 2
    for _m, _u, kw in session.calls:
        assert kw["headers"]["User-Agent"] == SH.USER_AGENT
    assert SH.USER_AGENT.startswith(f"PadSpan-HA/{VERSION} ") and "aiohttp" not in SH.USER_AGENT
    assert session.calls[1][1] == U.UPDATE_CHECK_URL and session.calls[1][2]["params"] == {"v": VERSION}


def test_a_429_is_asked_once_more_after_its_retry_after(monkeypatch):
    hass, session, waits = _wire(monkeypatch, (429, "slow down", {"Retry-After": "7"}), (200, ACK))
    assert asyncio.run(LH.call(hass, "validate", "PSPAN-AAAA"))["machine_h"] is True
    assert waits == [7.0] and [c[0] for c in session.calls] == ["POST", "POST"]


def test_a_second_429_is_not_asked_a_third_time(monkeypatch):
    hass, session, waits = _wire(monkeypatch, (429, "", {"Retry-After": "999"}), (429, "", {}))
    with pytest.raises(RuntimeError):
        asyncio.run(LH.call(hass, "validate", "PSPAN-AAAA"))
    assert waits == [SH.RETRY_AFTER_MAX_S] and len(session.calls) == 2, "capped, once, and no old form after it"


def test_the_update_check_also_retries_a_429(monkeypatch):
    hass, session, waits = _wire(monkeypatch, (429, "", {}), (200, {"latest_stable": "0.0.1"}))
    asyncio.run(U._check(hass))
    assert waits == [SH.RETRY_AFTER_DEFAULT_S] and len(session.calls) == 2
    assert hass.data[DOMAIN]["update_manifest"] == {"latest_stable": "0.0.1"}


@pytest.mark.parametrize("header,wait", [
    ("3", 3.0), ("0", 1.0), ("120", 60.0), ("", 5.0), (None, 5.0), ("soon", 5.0),
    ("Wed, 21 Oct 2015 07:28:00 GMT", 1.0),   # a date already past
])
def test_retry_after_is_read_and_capped(header, wait):
    assert SH.retry_after_s(header) == wait
