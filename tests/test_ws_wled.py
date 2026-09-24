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
from unittest.mock import AsyncMock, MagicMock

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
    "json/live", "settings/leds", "json/cfg/extra", "", "presets.json.bak", None, "json/cfg" + chr(10),
])
def test_everything_else_is_refused(path):
    assert W.check_get_path(path) is not None


def test_win_is_never_sent_even_by_an_admin():
    assert W.check_state_body({"win": "FX=1"}, is_admin=True)


@pytest.mark.parametrize("key", ["psave", "pdel", "bootps", "rb", "rmcpal", "wifi", "pin", "time", "AudioReactive"])
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

    async def _req(h, host, method, path, body=None, timeout=0, retries=0):
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


def test_teams_are_validated_before_they_are_stored(fake, monkeypatch):
    monkeypatch.setattr(W, "resolve_device", lambda h, entity_id=None, device_id=None:
                        {"host": "x"} if device_id in ("dL", "dF", "dG") else None)
    ok = W.sanitize_teams(fake.hass, [{"name": "T", "group": 3, "leader": "dL", "followers": ["dF"]}])
    assert ok == [{"id": "team1", "name": "T", "mode": "mirror", "group": 3, "leader": "dL", "followers": ["dF"],
                   "prior": {}, "incomplete": []}]
    bad = [
        [{"group": 9, "leader": "dL", "followers": ["dF"]}],                  # group out of range
        [{"group": 1, "leader": "dL", "followers": []}],                       # no followers
        [{"group": 1, "leader": "dL", "followers": ["dL"]}],                   # leader follows itself
        [{"group": 1, "leader": "dL", "followers": ["dNOPE"]}],                # not a WLED device
        [{"group": 1, "leader": "dL", "followers": ["dF"]},
         {"group": 2, "leader": "dG", "followers": ["dF"]}],                   # dF in two teams
        [{"group": 1, "leader": "dL", "followers": ["dF"], "mode": "ddp"}],    # unknown mode
    ]
    for teams in bad:
        assert isinstance(W.sanitize_teams(fake.hass, teams), str), teams


def test_team_writes_are_admin_only():
    src = inspect.getsource(W)
    i = src.index("async def ws_wled_teams_set")
    head = src[src.rindex("@websocket_api.websocket_command", 0, i):i]
    assert "@websocket_api.require_admin" in head



# ── review 2026-09-23 (round 4 + first WLED review) ─────────────────────────


def test_a_non_admin_cannot_move_sync_groups_or_the_nightlight_target():
    assert W.check_state_body({"udpn": {"sgrp": 0, "rgrp": 0}}, is_admin=False)
    assert W.check_state_body({"udpn": {"send": True}}, is_admin=False) is None
    assert W.check_state_body({"nl": {"on": True, "dur": 30}}, is_admin=False) is None
    assert W.check_state_body({"nl": {"on": True, "tbri": 0}}, is_admin=False)


def test_a_cfg_write_carries_the_keys_wled_resets_when_absent():
    """WLED's cfg parser resets fps, the auto-white override, gamma and paired
    ESP-NOW remotes when a write leaves them out (cfg.cpp, 0.14–16)."""
    before = {"hw": {"led": {"fps": 120, "rgbwm": 3, "maxpwr": 850}}, "light": {"gc": {"bri": 2.2, "col": 1.0, "val": 2.2}},
              "nw": {"linked_remote": ["aabbccddeeff"]}, "def": {"ps": 1}}
    body = W.with_preserved({"def": {"ps": 4}}, before)
    assert body == {"def": {"ps": 4}, "hw": {"led": {"fps": 120, "rgbwm": 3}},
                    "light": {"gc": {"bri": 2.2, "col": 1.0, "val": 2.2}}, "nw": {"linked_remote": ["aabbccddeeff"]}}
    # A key the write sets itself is left as the write has it.
    assert W.with_preserved({"hw": {"led": {"fps": 60}}}, before)["hw"]["led"]["fps"] == 60
    # Only keys the device has.
    assert W.with_preserved({"def": {"ps": 2}}, {"def": {"ps": 1}}) == {"def": {"ps": 2}}


def test_unexpected_changes_are_reported():
    before = {"hw": {"led": {"fps": 120}}, "def": {"ps": 1}, "vid": 1}
    after = {"hw": {"led": {"fps": 42}}, "def": {"ps": 4}, "vid": 2}
    assert W.unexpected_changes(before, {"def": {"ps": 4}}, after) == ["hw.led.fps"]


def test_non_admins_see_a_redacted_config():
    cfg = {"def": {"ps": 1}, "hw": {"led": {}}, "light": {}, "nw": {"ins": [{"ssid": "x"}]}, "ap": {}, "ota": {},
           "um": {"WireGuard": {"key": "SECRET"}}, "if": {"sync": {}, "mqtt": {"user": "u"}, "live": {}}}
    r = W.redact_cfg(cfg)
    assert set(r) == {"def", "hw", "light", "if"} and set(r["if"]) == {"sync", "live"}
    assert "SECRET" not in json.dumps(r)


async def test_a_non_admin_read_of_the_config_is_redacted_but_hashed_whole(fake):
    fake.state["cfg"] = {"def": {"ps": 1}, "um": {"WireGuard": {"key": "SECRET"}}}
    conn = _Conn(admin=False)
    await W.ws_wled_get(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "path": "json/cfg"})
    assert "SECRET" not in json.dumps(conn.results[0]["data"])
    assert conn.results[0]["hash"] == W.cfg_hash(fake.state["cfg"])


async def test_backup_contents_are_admin_only(fake):
    conn = _Conn(admin=False)
    await W.ws_wled_backups(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "action": "get",
                                               "backup_id": "20260101-000000"})
    assert conn.errors[0][0] == "unauthorized"


async def test_a_device_claiming_another_mac_is_refused(fake, monkeypatch):
    real = W.resolve_device
    monkeypatch.setattr(W, "resolve_device", lambda h, **k: {**real(h, **k), "mac": "112233445566"} if real(h, **k) else None)
    conn = _Conn(admin=True)
    await W.ws_wled_backups(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "action": "create"})
    assert conn.errors[0][0] == "mac_mismatch"


def test_two_backups_in_one_second_never_share_a_folder(tmp_path):
    a = W._write_backup_sync(tmp_path, {"cfg.json": {"a": 1}})
    b = W._write_backup_sync(tmp_path, {"cfg.json": {"b": 2}})
    assert a != b and json.loads((tmp_path / a / "cfg.json").read_text()) == {"a": 1}


def test_urls_are_built_so_an_ipv6_host_works():
    assert str(W._url("192.168.2.122", "json/palx?page=2")) == "http://192.168.2.122/json/palx?page=2"
    assert str(W._url("fd00::12", "json/info")) == "http://[fd00::12]/json/info"


async def test_busy_is_retried_and_redirects_are_refused(monkeypatch):
    calls = []

    async def once(h, host, method, path, body, timeout):
        calls.append(path)
        if len(calls) < 3:
            raise W.WledError("busy", "busy")
        return {"ok": 1}

    monkeypatch.setattr(W, "_request_once", once)
    monkeypatch.setattr(W.asyncio, "sleep", lambda s: _noop())
    assert await W._request(None, "h", "GET", "json/info") == {"ok": 1} and len(calls) == 3
    src = inspect.getsource(W)
    body = src[src.index("async def _request_once"):src.index("async def _upload")]
    assert "allow_redirects=False" in body and "300 <= resp.status < 400" in body


async def _noop():
    return None



def test_identify_lights_only_the_target_and_restores_in_device_sized_chunks():
    state = {"on": True, "bri": 40, "pl": 3, "seg": [{"id": i, "start": i * 10, "stop": i * 10 + 10, "fx": 5, "len": 10, "lc": 1,
                                                     "n": "x" * 40} for i in range(30)]}
    body = W.identify_body(state, 2)
    assert body["bri"] == 96 and body["seg"][2]["col"][0] == [255, 255, 255]
    assert body["seg"][0] == {"id": 0, "on": False}          # nothing else about others is touched
    chunks = W.restore_bodies(state, 1024)
    assert len(chunks) > 1 and all(len(json.dumps(c, separators=(",", ":"))) <= 1024 for c in chunks)
    assert sum(len(c["seg"]) for c in chunks) == 30
    assert all("len" not in s and "lc" not in s for c in chunks for s in c["seg"])


def test_the_matrix_form_matches_wleds_settings_page_fields():
    """set.cpp SUBPAGE_2D: SOMP, MPC, P<i>{B,R,V,S,X,Y,W,H}; S by presence."""
    f = W.matrix_form(True, [{"w": 16, "h": 8, "x": 0, "y": 0, "b": 1, "r": 0, "v": 0, "s": 1},
                             {"w": 16, "h": 8, "x": 16, "y": 0, "s": 0}])
    assert f["SOMP"] == "1" and f["MPC"] == "2"
    assert (f["P0B"], f["P0R"], f["P0V"], f["P0S"], f["P0W"], f["P0H"]) == ("1", "0", "0", "on", "16", "8")
    assert "P1S" not in f and f["P1X"] == "16"
    assert W.matrix_form(False, []) == {"SOMP": "0"}
    assert isinstance(W.matrix_form(True, []), str)
    assert isinstance(W.matrix_form(True, [{"w": 0, "h": 8}]), str)
    assert isinstance(W.matrix_form(True, [{"w": 8, "h": 8}] * 19), str)


def test_matrix_writes_are_admin_only():
    src = inspect.getsource(W)
    i = src.index("async def ws_wled_matrix")
    head = src[src.rindex("@websocket_api.websocket_command", 0, i):i]
    assert "@websocket_api.require_admin" in head


def test_live_frames_are_decoded_like_wleds_own_liveview():
    assert W.decode_live_frame(bytes([0x4C, 1, 255, 0, 0, 0, 255, 0])) == {"w": 0, "h": 0, "rgb": bytes([255, 0, 0, 0, 255, 0])}
    assert W.decode_live_frame(bytes([0x4C, 2, 16, 8, 1, 2, 3])) == {"w": 16, "h": 8, "rgb": bytes([1, 2, 3])}
    assert W.decode_live_frame(b'{"state":1}') is None


def test_one_upstream_per_device_closed_by_the_last_viewer():
    tasks = []

    class _Task:
        def __init__(self):
            self.cancelled = False

        def done(self):
            return False

        def cancel(self):
            self.cancelled = True

    hass = SimpleNamespace(async_create_background_task=lambda coro, name: (coro.close(), tasks.append(_Task()), tasks[-1])[2])
    r = W._LiveRelay(hass, "192.168.2.122")
    r.add(1, lambda p: None)
    r.add(2, lambda p: None)
    assert len(tasks) == 1
    r.remove(1)
    assert not tasks[0].cancelled
    r.remove(2)
    assert tasks[0].cancelled



# ── round 5 ──────────────────────────────────────────────────────────────────


def test_a_stored_team_isnt_rechecked_and_groups_are_one_teams(monkeypatch, fake):
    monkeypatch.setattr(W, "resolve_device", lambda h, entity_id=None, device_id=None: None)   # every device offline
    stored = [{"group": 2, "leader": "dA", "followers": ["dB"]}]
    # Unchanged stored team: kept though its devices can't be resolved right now.
    assert not isinstance(W.sanitize_teams(fake.hass, stored, stored), str)
    # A second team on the same group is refused.
    monkeypatch.setattr(W, "resolve_device", lambda h, entity_id=None, device_id=None: {"host": "x"})
    assert "already another team" in W.sanitize_teams(fake.hass, stored + [{"group": 2, "leader": "dC", "followers": ["dD"]}], stored)


def test_config_writes_are_refused_on_an_esp32_using_i2c():
    assert W.i2c_at_risk({"arch": "esp32"}, {"hw": {"if": {"i2c-pin": [21, 22]}}}) == [21, 22]
    assert W.i2c_at_risk({"arch": "esp32"}, {"hw": {"if": {"i2c-pin": [-1, -1]}}}) is None
    assert W.i2c_at_risk({"arch": "esp8266"}, {"hw": {"if": {"i2c-pin": [4, 5]}}}) is None


async def test_a_cfg_write_to_an_i2c_esp32_is_refused_before_anything_is_sent(fake):
    fake.state["cfg"] = {"hw": {"if": {"i2c-pin": [21, 22]}}}
    conn = _Conn()
    await W.ws_wled_cfg(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "patch": {"def": {"ps": 2}},
                                           "base_hash": W.cfg_hash(fake.state["cfg"])})
    assert conn.errors[0][0] == "i2c_in_use"
    assert not any(c[0] == "POST" for c in fake.calls)


def test_computed_values_and_filled_in_output_keys_are_not_unexpected():
    before = {"hw": {"led": {"total": 30, "ins": [{"start": 0, "len": 30, "type": 22}]}}}
    patch = {"hw": {"led": {"ins": [{"start": 0, "len": 60, "type": 22}]}}}
    after = {"hw": {"led": {"total": 60, "ins": [{"start": 0, "len": 60, "type": 22, "drv": 0, "maxpwr": 0}]}}}
    assert W.unexpected_changes(before, patch, after) == []
    after_bad = {"hw": {"led": {"total": 60, "ins": [{"start": 0, "len": 30, "type": 22}]}}}
    assert W.unexpected_changes(before, patch, after_bad) == ["hw.led.ins[0].len"]


async def test_a_failed_identify_request_still_restores(fake, monkeypatch):
    posts, timers = [], []

    async def _req(h, host, method, path, body=None, timeout=0, retries=0):
        if method == "GET":
            return {"state": {"on": True, "bri": 50, "seg": [{"id": 0, "start": 0, "stop": 10, "fx": 3}]}, "info": {"arch": "esp32"}}
        posts.append(body)
        if len(posts) == 1:
            raise W.WledError("timeout", "no answer")
        return {}

    monkeypatch.setattr(W, "_request", _req)
    import sys
    import types

    def later(hass, delay, fn):
        timers.append((delay, fn))
        return lambda: None

    ev = types.ModuleType("homeassistant.helpers.event")
    ev.async_call_later = later
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    fake.hass.data = {}
    conn = _Conn()
    await W.ws_wled_identify(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "seg_id": 0, "seconds": 10})
    assert conn.errors and "putting the lights back" in conn.errors[0][1]
    assert timers and timers[0][0] == 0
    await timers[0][1]()
    assert posts[-1]["seg"][0]["fx"] == 3, "the saved state went back"


# ── round 6 ──────────────────────────────────────────────────────────────────


class _Dev015:
    """A WLED 0.15 device as far as sync goes: a cfg write sets the live
    "send" to the saved one (sendNotificationsRT = sendNotifications)."""

    def __init__(self, en=False, live=False):
        self.cfg = {"if": {"sync": {"send": {"en": en, "dir": True, "grp": 1}, "recv": {"grp": 1}}}}
        self.live = live

    async def req(self, h, host, method, path, body=None, timeout=0, retries=0):
        if path == "json/info":
            return {"mac": "aa:bb:cc:dd:ee:ff", "arch": "esp32", "ver": "0.15.1"}
        if path == "presets.json":
            return {"0": {}}
        if path == "json/cfg" and method == "GET":
            return json.loads(json.dumps(self.cfg))     # a fresh read, like HTTP
        if path == "json/cfg":
            send = ((body.get("if") or {}).get("sync") or {}).get("send") or {}
            if "en" in send:
                self.cfg["if"]["sync"]["send"]["en"] = send["en"]
            self.live = self.cfg["if"]["sync"]["send"]["en"]
            return {"success": True}
        if path == "json/state" and method == "GET":
            return {"udpn": {"send": self.live, "sgrp": 1, "rgrp": 1}}
        if path == "json/state":
            self.live = (body.get("udpn") or {}).get("send", self.live)
        return {}


async def test_saving_sending_on_is_not_undone_live(fake, monkeypatch):
    dev = _Dev015(en=False, live=False)
    monkeypatch.setattr(W, "_request", dev.req)
    conn = _Conn()
    patch = {"if": {"sync": {"send": {"en": True, "dir": True, "grp": 1}}}}
    await W.ws_wled_cfg(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "patch": patch,
                                           "base_hash": W.cfg_hash(dev.cfg)})
    assert not conn.errors and dev.live is True


async def test_an_unrelated_save_keeps_the_live_send_switch(fake, monkeypatch):
    dev = _Dev015(en=False, live=True)          # someone switched sending on live
    monkeypatch.setattr(W, "_request", dev.req)
    conn = _Conn()
    await W.ws_wled_cfg(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "patch": {"def": {"ps": 2}},
                                           "base_hash": W.cfg_hash(dev.cfg)})
    assert not conn.errors and dev.live is True


def test_two_stored_teams_on_one_group_dont_block_an_unrelated_change(monkeypatch, fake):
    """Stored before the one-group rule: every later save (even a break-up
    of another team) used to be refused."""
    monkeypatch.setattr(W, "resolve_device", lambda h, entity_id=None, device_id=None: {"host": "x"})
    stored = [{"group": 2, "leader": "dA", "followers": ["dB"]}, {"group": 2, "leader": "dC", "followers": ["dD"]},
              {"group": 3, "leader": "dE", "followers": ["dF"]}]
    assert not isinstance(W.sanitize_teams(fake.hass, stored[:2], stored), str)
    # …but a NEW team on that group is still refused.
    assert isinstance(W.sanitize_teams(fake.hass, stored[:2] + [{"group": 2, "leader": "dG", "followers": ["dH"]}], stored), str)


async def test_a_team_list_changed_in_another_window_is_refused(fake):
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    stored = [{"id": "t", "name": "T", "mode": "mirror", "group": 3, "leader": "dL", "followers": ["dF"], "prior": {}, "incomplete": []}]
    st = SimpleNamespace(data={"wled_teams": stored}, async_set=AsyncMock())
    fake.hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    conn = _Conn()
    await W.ws_wled_teams_set(fake.hass, conn, {"id": 1, "teams": [], "base_hash": W.cfg_hash([])})
    assert conn.errors and conn.errors[0][0] == "changed"
    st.async_set.assert_not_called()
    conn = _Conn()
    await W.ws_wled_teams_set(fake.hass, conn, {"id": 2, "teams": [], "base_hash": W.cfg_hash(stored)})
    assert not conn.errors and conn.results[0]["hash"] == W.cfg_hash([])


async def test_a_fired_identify_timer_doesnt_cut_a_newer_identify_short(fake, monkeypatch):
    import asyncio
    import sys
    import types
    posts, timers = [], []
    gate = asyncio.Event()
    gate.set()

    async def _req(h, host, method, path, body=None, timeout=0, retries=0):
        if method == "GET":
            return {"state": {"on": True, "bri": 50, "seg": [{"id": 0, "start": 0, "stop": 10, "fx": 3},
                                                             {"id": 1, "start": 10, "stop": 20, "fx": 4}]},
                    "info": {"arch": "esp32"}}
        await gate.wait()
        posts.append("restore" if body.get("seg") and body["seg"][0].get("fx") == 3 else "identify")
        return {}

    monkeypatch.setattr(W, "_request", _req)

    def later(hass, delay, fn):
        timers.append((delay, fn))
        return lambda: None          # like HA: cancelling a fired timer does nothing

    ev = types.ModuleType("homeassistant.helpers.event")
    ev.async_call_later = later
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    fake.hass.data = {}
    await W.ws_wled_identify(fake.hass, _Conn(), {"id": 1, "entity_id": "light.upper_north", "seg_id": 0, "seconds": 10})
    gate.clear()
    t2 = asyncio.create_task(W.ws_wled_identify(fake.hass, _Conn(), {"id": 2, "entity_id": "light.upper_north", "seg_id": 1, "seconds": 10}))
    await asyncio.sleep(0)
    t1 = asyncio.create_task(timers[0][1]())      # timer 1 fires while identify 2 holds the lock
    await asyncio.sleep(0)
    gate.set()
    await t2
    await t1
    assert posts == ["identify", "identify"], "the stale timer restored early"
    await timers[1][1]()                          # identify 2's own timer
    assert posts == ["identify", "identify", "restore"]



async def test_a_sync_card_save_that_leaves_sending_alone_keeps_the_live_switch(fake, monkeypatch):
    """Round 7: the Saved-sync card always sends the whole send block, so
    'en present' skipped the re-apply on every save from it."""
    dev = _Dev015(en=False, live=True)
    monkeypatch.setattr(W, "_request", dev.req)
    conn = _Conn()
    patch = {"if": {"sync": {"send": {"en": False, "dir": True, "grp": 1}, "recv": {"grp": 3}}}}
    await W.ws_wled_cfg(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "patch": patch,
                                           "base_hash": W.cfg_hash(dev.cfg)})
    assert not conn.errors and dev.live is True


def test_vacation_mode_skips_only_followers_still_following(monkeypatch):
    """Round 7: a team kept 'not finished' after a setup that couldn't be
    rolled back everywhere named followers that were never touched."""
    from homeassistant.helpers import entity_registry as er
    ents = {"dA": ["light.a"], "dB": ["light.b"], "dC": ["light.c"]}
    monkeypatch.setattr(er, "async_get", lambda h: None, raising=False)
    monkeypatch.setattr(er, "async_entries_for_device",
                        lambda reg, d: [SimpleNamespace(entity_id=e) for e in ents.get(d, [])], raising=False)
    teams = [{"leader": "dL", "followers": ["dA", "dB"], "incomplete": ["dA"]},
             {"leader": "dM", "followers": ["dC"], "incomplete": []}]
    assert W.follower_light_entities(None, teams) == {"light.a", "light.c"}


async def test_an_offline_wled_says_unreachable_not_that_it_isnt_wled(fake):
    """2026-09-23, live: four WLED strips that were off the network showed
    'That light isn't a WLED device in Home Assistant's WLED integration'."""
    entry = fake.hass.config_entries.async_entries("wled")[0]
    entry.state = SimpleNamespace(value="setup_retry")
    conn = _Conn()
    await W.ws_wled_get(fake.hass, conn, {"id": 1, "entity_id": "light.upper_north", "path": "json/info"})
    # Its own code: "unreachable" already means "a write may have been applied" (wled_tab_sync.js).
    assert conn.errors[0][0] == "wled_offline" and "192.168.2.122" in conn.errors[0][1]
    assert fake.calls == [], "an unloaded entry's host is named, never contacted"
