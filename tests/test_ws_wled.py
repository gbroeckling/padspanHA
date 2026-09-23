# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The WLED proxy (ws_wled.py) behind the Atlas WLED card's Advanced tab.

The panel is NOT admin-only, so this proxy is a security boundary: the
device address comes only from HA's own WLED config entry, reads go only to
an allowlist, persisting/disrupting writes need an administrator, and a few
things are never sent at all (the legacy /win API that wedges Garry's
Gyver-class forks; firmware update; hw.com through /json/cfg).
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_wled as W


# ── pure checks ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", [
    "json", "json/state", "json/info", "json/si", "json/eff", "json/fxdata", "json/pal",
    "json/palx", "json/palx?page=3", "json/nodes", "json/cfg", "json/pins", "json/net",
    "presets.json", "cfg.json", "palette0.json", "palette12.json", "ledmap.json", "ledmap3.json",
])
def test_allowlisted_reads(path):
    assert W.check_get_path(path) is None


@pytest.mark.parametrize("path", [
    "win&T=1", "update", "updatebootloader", "reset", "edit?func=list", "upload",
    "json/state?x=1", "../json/cfg", "json/../reset", "http://evil/json", "wsec.json",
    "json/live", "settings/leds", "json/cfg/extra", "", "presets.json.bak", None,
])
def test_everything_else_is_refused(path):
    assert W.check_get_path(path) is not None


def test_win_is_never_sent_even_by_an_admin():
    assert W.check_state_body({"win": "FX=1"}, is_admin=True)


@pytest.mark.parametrize("key", ["psave", "pdel", "bootps", "rb", "rmcpal", "wifi"])
def test_persisting_keys_need_an_admin(key):
    assert W.check_state_body({key: 1}, is_admin=False)
    assert W.check_state_body({key: 1}, is_admin=True) is None


def test_live_changes_are_open_to_any_licensed_user():
    body = {"seg": [{"id": 0, "start": 0, "stop": 60, "n": "Door"}], "on": True, "bri": 128,
            "playlist": {"ps": [1, 2], "dur": 100}}
    assert W.check_state_body(body, is_admin=False) is None


def test_a_body_bigger_than_the_device_buffer_is_refused():
    big = {"seg": [{"id": 0, "i": ["FF0000"] * 2000}]}
    assert "bytes" in W.check_state_body(big, is_admin=True, max_bytes=W.MAX_BODY_ESP8266)


def test_hw_com_is_never_written_through_json_cfg():
    assert W.check_cfg_patch({"hw": {"com": [{"start": 0, "len": 10, "order": 1}]}})
    assert W.check_cfg_patch({"hw": {"led": {"maxpwr": 850}}}) is None
    assert W.check_cfg_patch({}) is not None


def test_cfg_hash_is_order_independent():
    assert W.cfg_hash({"a": 1, "b": {"c": 2}}) == W.cfg_hash({"b": {"c": 2}, "a": 1})
    assert W.cfg_hash({"a": 1}) != W.cfg_hash({"a": 2})


def test_device_buffer_size_follows_the_chip():
    assert W.max_body_for({"arch": "esp8266"}) == W.MAX_BODY_ESP8266
    assert W.max_body_for({"arch": "esp32"}) == W.MAX_BODY_ESP32


# ── no command accepts a host from the client ───────────────────────────────


def test_no_command_schema_takes_a_host():
    for cmd in (W.ws_wled_devices, W.ws_wled_get, W.ws_wled_state, W.ws_wled_cfg, W.ws_wled_backups):
        keys = {str(getattr(k, "schema", k)) for k in cmd.ws_schema}
        assert not keys & {"host", "ip", "url", "address"}, (cmd.__name__, keys)


def test_config_writes_are_admin_only():
    src = inspect.getsource(W)
    i = src.index("async def ws_wled_cfg")
    head = src[src.rindex("@websocket_api.websocket_command", 0, i):i]
    assert "@websocket_api.require_admin" in head


# ── handlers, with a fake HA ─────────────────────────────────────────────────


class _Conn:
    def __init__(self, admin=True):
        self.user = SimpleNamespace(is_admin=admin)
        self.results, self.errors = [], []

    def send_result(self, mid, data):
        self.results.append(data)

    def send_error(self, mid, code, message):
        self.errors.append((code, message))


def _hass(tmp_path, wled=True):
    dev = SimpleNamespace(id="dev1", name="Upper North", name_by_user=None, config_entries={"e1"})
    entry = SimpleNamespace(entry_id="e1", data={"host": "192.168.2.122"}, domain="wled")
    hass = MagicMock()
    hass.config_entries.async_entries = lambda domain: [entry] if (wled and domain == "wled") else []
    hass.config.path = lambda *p: str(Path(tmp_path).joinpath(*p))

    async def _exec(fn, *a):
        return fn(*a)

    hass.async_add_executor_job = _exec
    return hass, dev


@pytest.fixture
def fake(monkeypatch, tmp_path):
    from homeassistant.helpers import device_registry as dr, entity_registry as er
    hass, dev = _hass(tmp_path)
    ent = SimpleNamespace(entity_id="light.upper_north", device_id="dev1")
    monkeypatch.setattr(dr, "async_get", lambda h: SimpleNamespace(async_get=lambda i: dev if i == "dev1" else None), raising=False)
    monkeypatch.setattr(er, "async_get", lambda h: SimpleNamespace(async_get=lambda e: ent if e == "light.upper_north" else None), raising=False)
    monkeypatch.setattr(W, "_tier_at_least", lambda h, t: True)
    calls = []
    state = {"cfg": {"hw": {"led": {"maxpwr": 850}}}}

    async def _req(h, host, method, path, body=None, timeout=0):
        calls.append((method, host, path, body))
        if path == "json/info":
            return {"mac": "aa:bb:cc:dd:ee:ff", "arch": "esp32"}
        if path == "json/cfg":
            return state["cfg"]
        if path == "presets.json":
            return {"0": {}}
        return {"ok": True}

    monkeypatch.setattr(W, "_request", _req)
    return SimpleNamespace(hass=hass, calls=calls, state=state, tmp=tmp_path)


async def test_the_host_comes_from_the_wled_config_entry(fake):
    conn = _Conn()
    await W.ws_wled_get(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "path": "json/info",
                                           "host": "10.0.0.66"})
    assert not conn.errors
    assert fake.calls == [("GET", "192.168.2.122", "json/info", None)]


async def test_a_light_outside_the_wled_integration_is_refused(fake):
    conn = _Conn()
    await W.ws_wled_get(fake.hass, conn, {"id": 1, "entity_id": "light.kitchen", "path": "json/info"})
    assert conn.errors and conn.errors[0][0] == "not_wled"
    assert fake.calls == []


async def test_below_bright_nothing_is_reached(fake, monkeypatch):
    monkeypatch.setattr(W, "_tier_at_least", lambda h, t: False)
    conn = _Conn()
    await W.ws_wled_get(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "path": "json/info"})
    assert conn.errors[0][0] == "bright_required" and fake.calls == []


async def test_a_non_admin_cannot_save_a_preset(fake):
    conn = _Conn(admin=False)
    await W.ws_wled_state(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "body": {"psave": 3, "n": "x"}})
    assert conn.errors and conn.errors[0][0] == "refused" and fake.calls == []


async def test_a_live_change_asks_for_the_resulting_state(fake):
    conn = _Conn(admin=False)
    await W.ws_wled_state(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "body": {"bri": 40}})
    assert fake.calls == [("POST", "192.168.2.122", "json/state", {"bri": 40, "v": True})]


async def test_a_cfg_write_backs_up_first_and_refuses_a_changed_device(fake):
    base = W.cfg_hash(fake.state["cfg"])
    conn = _Conn()
    await W.ws_wled_cfg(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north",
                                           "patch": {"hw": {"led": {"maxpwr": 1200}}}, "base_hash": "stale"})
    assert conn.errors[0][0] == "changed"
    assert not any(c[0] == "POST" for c in fake.calls)

    conn = _Conn()
    fake.calls.clear()
    await W.ws_wled_cfg(fake.hass, conn, {"id": 2, "entity_id": "light.upper_north",
                                           "patch": {"hw": {"led": {"maxpwr": 1200}}}, "base_hash": base})
    assert not conn.errors, conn.errors
    paths = [(m, p) for m, _, p, _ in fake.calls]
    post = paths.index(("POST", "json/cfg"))
    assert ("GET", "presets.json") in paths[:post], "presets are read for the backup before the write"
    backup = Path(fake.tmp, "padspan_ha", "wled_backups", "aabbccddeeff", conn.results[0]["backup"])
    assert json.loads((backup / "cfg.json").read_text()) == {"hw": {"led": {"maxpwr": 850}}}
    assert (backup / "presets.json").exists()
    assert paths[-1] == ("GET", "json/cfg"), "re-read after the write"


async def test_a_reboot_write_sends_rb_and_does_not_re_read(fake):
    base = W.cfg_hash(fake.state["cfg"])
    conn = _Conn()
    await W.ws_wled_cfg(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north",
                                           "patch": {"if": {"sync": {"port0": 21324}}}, "base_hash": base, "reboot": True})
    post = next(c for c in fake.calls if c[0] == "POST")
    assert post[3]["rb"] is True
    assert fake.calls[-1][0] == "POST"
    assert conn.results[0]["after"] is None


async def test_a_restore_is_admin_only_and_takes_a_safety_copy_first(fake, monkeypatch):
    uploads = []

    async def _up(h, host, fname, data, pin=None):
        uploads.append((host, fname, data))

    monkeypatch.setattr(W, "_upload", _up)
    folder = Path(fake.tmp, "padspan_ha", "wled_backups", "aabbccddeeff", "20260101-000000")
    folder.mkdir(parents=True)
    (folder / "presets.json").write_text(json.dumps({"0": {}, "1": {"n": "Old"}}))

    conn = _Conn(admin=False)
    await W.ws_wled_backups(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north",
                                               "action": "restore_presets", "backup_id": "20260101-000000"})
    assert conn.errors[0][0] == "unauthorized" and not uploads

    conn = _Conn(admin=True)
    await W.ws_wled_backups(fake.hass, conn, {"id": 2, "entity_id": "light.upper_north",
                                               "action": "restore_presets", "backup_id": "20260101-000000"})
    assert not conn.errors, conn.errors
    assert uploads == [("192.168.2.122", "presets.json", {"0": {}, "1": {"n": "Old"}})]
    safety = conn.results[0]["safety_backup"]
    assert (folder.parent / safety / "presets.json").exists(), "the device's current presets are kept first"


async def test_a_restore_reads_only_this_devices_folder(fake, monkeypatch):
    """The folder is keyed by the device's own MAC: another unit's backup
    can't be pushed here (never copy presets.json between devices)."""
    monkeypatch.setattr(W, "_upload", lambda *a, **k: None)
    other = Path(fake.tmp, "padspan_ha", "wled_backups", "112233445566", "20260101-000000")
    other.mkdir(parents=True)
    (other / "presets.json").write_text("{}")
    conn = _Conn(admin=True)
    await W.ws_wled_backups(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north",
                                               "action": "restore_presets", "backup_id": "20260101-000000"})
    assert conn.errors and conn.errors[0][0] == "not_found"
