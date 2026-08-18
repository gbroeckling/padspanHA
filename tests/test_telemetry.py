"""The opt-in usage report (telemetry.py).

The promise on the settings card is "counts only — never addresses, keys,
names, coordinates or timestamps", and "what you see in Preview is what
goes". These tests hold the code to that from both sides: a house full of
names, MACs, UUIDs, keys and coordinates goes in; the report is scanned for
every one of them; and assert_shareable is proven to REFUSE a report if any
identifier-shaped value ever got in.
"""

from __future__ import annotations

import asyncio
import json
import re
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN,
)

# ── a house full of things that must never leave ─────────────────────────────
_MAC1, _MAC2 = "48:87:2D:9D:BC:88", "DD:E1:C8:89:75:73"
_UUID = "99a58376-461d-4a9b-9700-2375fcfd705b"
_IRK = "ec0234a357c8ad05341010a60a397d9b"
_KEY = "PSPAN-AAAA-BBBB-CCCC-DDDD"
_ROOM = "Nicole's Office"
_FLOOR = "Spare Bedroom Closet"
_LIGHT = "light.kitchen_valance"
_IP = "192.168.3.155"
_SECRETS = [_MAC1, _MAC2, _UUID, _IRK, _KEY, _ROOM, _FLOOR, _LIGHT, _IP, "Garry", "Pixel 8 Pro", "MaschineBOX"]
# Bluetooth Core Spec Vol 3 Part H, Appendix D.7 — a real key/address pair, for the resolver tests
_SIG_IRK = bytes.fromhex("EC0234A357C8AD05341010A60A397D9B")
_SIG_RPA = "70:81:94:0D:FB:AA"


def _hass():
    h = MagicMock()
    settings = SimpleNamespace(data={
        "telemetry_enabled": True,
        "telemetry_install_id": "8f0d0f7e-2c8f-4c8a-9d1c-0f2c3d4e5f60",
        "irk_devices": [{"name": "Pixel 8 Pro", "irk_hex": _IRK}],
        "followed_addrs": [_MAC1, _MAC2],
        "forensics_license_key": _KEY,
        "excluded_scanners": [_MAC2],
        "quiet_mode": True, "lights_showcase": True, "data_mode": "live", "cpu_mode": "shared",
        "light_shapes": {_LIGHT: "bar"},
        "scanner_offsets": {_MAC1: 3},
    })
    async def _set(**kw): settings.data.update(kw)
    settings.async_set = _set
    fabric = SimpleNamespace(data={
        "floors": {"main": {"rooms": {_ROOM: {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]},
                                     "Kitchen": {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}}},
                   "up": {"rooms": {_FLOOR: {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}}}},
        "light_positions_m": {_LIGHT: {"x_m": 1.234, "y_m": 5.678, "floor_id": "main"}},
        "rf_barriers_m": [{"id": "w1", "x1_m": 0, "y1_m": 0, "x2_m": 4, "y2_m": 0}],
        "scanner_positions_m": {_MAC1: {"x_m": 2.0, "y_m": 2.0}},
        "beacon_positions_m": {},
    })
    model = SimpleNamespace(data={"floors": [{"id": "main", "name": "Main"}, {"id": "up", "name": _FLOOR}]})
    maps = SimpleNamespace(data={"maps": [{"id": "m1", "name": "Garry's basement plan"}]})
    cal = SimpleNamespace(data={"points": [{"room": _ROOM, "source": "auto:x", "rssi": {_MAC1: -60}},
                                           {"room": "Kitchen", "source": "manual"}]})
    coord = SimpleNamespace(_coverage_floor=-90.0)
    snapshot = {
        "ble": {"radios": [{"source": _MAC1, "name": "ble-white3dprintedbox", "ip": _IP, "adapter": "x"},
                           {"source": "hci0", "name": "local", "lost": True}],
                "diag": {"ok": True, "callback_active": True}},
        "objects": {"list": [
            {"kind": "ibeacon", "name": "Pixel 8 Pro", "address": _MAC1, "identified": True, "x_m": 1.0, "room": _ROOM,
             "ibeacon_uuid": _UUID, "user_label": "Garry"},
            {"kind": "ble", "name": "MaschineBOX", "address": _MAC2, "outside": True},
        ], "summary": {"resolver": {"crypto_ok": True, "rpa_count": 80, "resolved": 0, "errors": [f"bad {_MAC1}"]}}},
        "calibration_status": {"knn_positioned_objects": 1},
    }
    h.data = {DOMAIN: {
        DATA_SETTINGS: settings, DATA_FABRIC: fabric, DATA_MODEL: model, DATA_MAPS: maps,
        "calibration": cal, "presence_coordinator": coord,
        "snapshot_cache": (0.0, snapshot),
        "_telemetry_started_mono": 0.0,
    }}
    def _entries(domain):
        return [SimpleNamespace(entry_id="e1")] if domain in ("esphome", "bluetooth", "mobile_app") else []
    h.config_entries.async_entries = _entries
    return h


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_nothing_from_the_house_is_in_the_report():
    h = _hass()
    T.bump(h, "light_placed"); T.bump(h, "tab:bluetooth/irk_panel"); T.bump(h, "tab:maps")
    payload = T.build_payload(h)
    T.assert_shareable(payload)                      # the gate the send goes through
    text = json.dumps(payload)
    for secret in _SECRETS:
        assert secret not in text, f"{secret!r} leaked into the report"
    # and it still says the useful things
    assert payload["env"]["scanners"] == 2 and payload["env"]["scanner_kinds"] == {"ip_known": 1, "espresense": 0, "other": 1}
    assert payload["env"]["rooms"] == 3 and payload["env"]["floors"] == 2
    assert payload["env"]["placed_lights"] == 1 and payload["env"]["walls"] == 1 and payload["env"]["irks"] == 1
    assert payload["env"]["followed"] == 2 and payload["env"]["scanner_state"] == {"lost": 1, "disabled": 0, "excluded": 1}
    assert payload["env"]["objects_by_kind"] == {"ibeacon": 1, "ble": 1}
    assert payload["env"]["calibration_points"] == 2 and payload["env"]["calibration_auto_points"] == 1
    assert payload["env"]["integrations"]["esphome"] == 1 and payload["env"]["integrations"]["bermuda"] == 0
    assert payload["features"]["quiet_mode"] is True and payload["features"]["data_mode"] == "live"
    assert payload["health"]["rpas_seen"] == 80 and payload["health"]["coverage_floor_active"] is True
    assert payload["health"]["outside_now"] == 1 and payload["health"]["positioned_now"] == 1
    assert payload["health"]["resolver_errors"] == 1          # the count, not the message with the MAC in it
    assert payload["health"]["uptime"] in ("<1h", "<1d", "1-7d", ">7d") and "uptime_h" not in payload["health"]
    assert payload["usage"] == {"light_placed": 1, "tab:bluetooth/irk_panel": 1, "tab:maps": 1}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", payload["day"])  # a day, not a timestamp
    assert len(text) < 3000


def test_the_gate_refuses_every_identifier_shape():
    h = _hass()
    base = T.build_payload(h)
    T.assert_shareable(base)
    for bad, where in ((_MAC1, "MAC"), ("48-87-2D-9D-BC-88", "MAC"), ("48872D9DBC88", "MAC"),
                       (_UUID, "UUID"), (_IRK, "32-hex"), (_KEY, "licence key"), (_IP, "IP"),
                       ("fe80::1c2b:3d4e:5f60:7a8b", "IPv6"), (_LIGHT, "entity id")):
        p = json.loads(json.dumps(base))
        p["env"]["note"] = f"seen {bad} today"
        with pytest.raises(ValueError, match=where):
            T.assert_shareable(p)
    p = json.loads(json.dumps(base)); p["surprise"] = 1
    with pytest.raises(ValueError, match="top-level"):
        T.assert_shareable(p)
    p = json.loads(json.dumps(base)); p["install_id"] = "not-a-uuid"
    with pytest.raises(ValueError, match="install_id"):
        T.assert_shareable(p)
    p = json.loads(json.dumps(base)); p["env"]["free_text"] = "x" * 65
    with pytest.raises(ValueError, match="too long"):
        T.assert_shareable(p)


def test_off_means_nothing_counted_and_nothing_sent():
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    assert T.bump(h, "light_placed") is False
    assert T._DATA_COUNTERS not in h.data[DOMAIN]
    res = _run(T.send_now(h))
    assert res == {"sent": False, "reason": "disabled", "bytes": 0}


def test_only_the_vocabulary_counts():
    """The keys of the report are data too: a closed list, not a pattern —
    an authenticated non-admin could otherwise put a word into the report
    through telemetry_event ("tab:nicoles_office/pixel")."""
    h = _hass()
    assert T.bump(h, "tab:overview") and T.bump(h, "tab:bluetooth/irk_panel") and T.bump(h, "wall_placed")
    for bad in ("tab:nicoles_office", "tab:bluetooth/pixel", "tab:overview\n", "tab:has space",
                "anything_i_like", "tab:a/b/c", "tab:maps/irk_panel"):
        assert not T.bump(h, bad), bad
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"tab:overview": 1, "tab:bluetooth/irk_panel": 1, "wall_placed": 1}


def test_the_tab_vocabulary_is_the_panel():
    """telemetry.VIEWS must equal panel.js _VIEW_PATHS and the sub-tab lists
    must equal what bluetooth.js / maps.js render — add a tab, forget the
    list, and its opens are silently dropped."""
    from pathlib import Path
    www = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
    panel = (www / "panel.js").read_text(encoding="utf-8")
    block = panel[panel.index("_VIEW_PATHS = {"):]
    block = block[:block.index("};")]
    views = set(re.findall(r"^\s+([a-z_]+):", block, re.M))
    assert views == set(T.VIEWS), (views ^ set(T.VIEWS))
    bt = (www / "views" / "bluetooth.js").read_text(encoding="utf-8")
    bt_tabs = set(re.findall(r'tabButton\("([a-z_]+)"', bt))
    assert bt_tabs == set(T.SUBTABS["bluetooth"]), (bt_tabs ^ set(T.SUBTABS["bluetooth"]))
    maps = (www / "views" / "maps.js").read_text(encoding="utf-8")
    line = next(l for l in maps.splitlines() if '["library","Library"],["upload","Upload"],["edit"' in l)
    map_tabs = set(re.findall(r'\["([a-z_]+)","', line))
    assert map_tabs == set(T.SUBTABS["maps"]), (map_tabs ^ set(T.SUBTABS["maps"]))


def test_preview_keeps_the_counters_and_a_send_consumes_them():
    h = _hass()
    T.bump(h, "light_placed")
    T.build_payload(h, consume=False)
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"light_placed": 1}
    T.build_payload(h, consume=True)
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {}


def test_a_report_that_would_leak_is_refused_at_send(monkeypatch):
    """Belt and braces: even if build_payload were wrong, send_now does not send —
    and a refused send keeps the day's counters for the next attempt."""
    h = _hass()
    T.bump(h, "wall_placed")
    monkeypatch.setattr(T, "build_payload", lambda hass, consume=False: {"schema": 1, "install_id": "", "env": {"x": _MAC1}})
    res = _run(T.send_now(h))
    assert res["sent"] is False and res["reason"].startswith("refused: MAC")
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"wall_placed": 1}


def test_one_report_per_day_and_the_windows_close_only_on_acceptance(monkeypatch):
    h = _hass()
    T.bump(h, "wall_placed")
    # Already sent today: nothing goes, counters kept
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_last_day"] = T._today()
    res = _run(T.send_now(h))
    assert res == {"sent": False, "reason": "already sent today", "bytes": 0}
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"wall_placed": 1}
    # The button forces; a server failure keeps the counters; an accepted send consumes them and stamps the day
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_last_day"] = ""
    class _Resp:
        def __init__(self, status): self.status = status
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
    class _Session:
        def __init__(self, status): self._s = status
        def post(self, *a, **k): return _Resp(self._s)
    import sys, types
    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake.async_get_clientsession = lambda hass: _Session(500)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    res = _run(T.send_now(h, force=True))
    assert res["sent"] is False and res["reason"] == "http 500"
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"wall_placed": 1}
    fake.async_get_clientsession = lambda hass: _Session(200)
    res = _run(T.send_now(h, force=True))
    assert res["sent"] is True
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {}
    assert h.data[DOMAIN][DATA_SETTINGS].data["telemetry_last_day"] == T._today()


def test_every_event_name_has_a_real_call_site():
    """The vocabulary must not carry dead names: a name nothing ever bumps
    would sit in the docs as something measured and never be. Each EVENTS
    entry must appear as a bump()/_bump()/telemetryEvent() call somewhere in
    the integration."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    src = "\n".join(p.read_text(encoding="utf-8", errors="ignore")
                    for p in list(root.rglob("*.py")) + list(root.rglob("*.js")) if "telemetry.py" not in p.name)
    dead = [e for e in sorted(T.EVENTS)
            if not any(f'{fn}({arg}"{e}")' in src for fn in ("bump", "_bump", "self._count", "telemetryEvent", "ctx.actions.telemetryEvent")
                       for arg in ("hass, ", "self._hass, ", "", "ctx, "))]
    assert not dead, f"events with no call site: {dead}"


def test_the_resolver_counts_new_resolutions_and_new_unresolved_rpas():
    """irk_resolved / irk_unresolved_rpa tick once per NEW address; a cache
    hit or an expired-and-re-resolved address does not count again; and the
    set of keys that resolved anything is what health.irk_devices_resolving
    reports."""
    from custom_components.padspan_ha.private_ble_resolver import PrivateBLEResolver
    h = _hass()
    r = PrivateBLEResolver(h)
    r._devices = [{"canonical_id": "irk:" + _SIG_IRK.hex(), "name": "Phone", "irk_bytes": _SIG_IRK}]
    assert r.resolve_address(_SIG_RPA)["canonical_id"] == "irk:" + _SIG_IRK.hex()
    assert r.resolve_address(_SIG_RPA)                       # cached — no second tick
    assert r.resolve_address("4A:11:22:33:44:55") is None    # RPA, no key matches
    assert r.resolve_address("4A:11:22:33:44:55") is None    # cached miss — no second tick
    assert r.resolve_address("DD:E1:C8:89:75:73") is None    # not an RPA at all — nothing counted
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"irk_resolved": 1, "irk_unresolved_rpa": 1}
    assert r.take_resolved_ids() == {"irk:" + _SIG_IRK.hex()}
    assert r.take_resolved_ids() == set()
    # and nothing at all when the report is off
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    r2 = PrivateBLEResolver(h); r2._devices = r._devices
    r2.resolve_address("70:81:94:0D:FB:AA")
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"irk_resolved": 1, "irk_unresolved_rpa": 1}


def test_health_reports_how_many_keys_are_resolving():
    from custom_components.padspan_ha import private_ble_resolver as pbr
    h = _hass()
    r = pbr.PrivateBLEResolver(h)
    r._devices = [{"canonical_id": "irk:" + _SIG_IRK.hex(), "name": "Phone", "irk_bytes": _SIG_IRK}]
    pbr._resolvers[id(h)] = r
    try:
        r.resolve_address(_SIG_RPA)
        p = T.build_payload(h)                     # a preview: reads, does not reset
        assert p["health"]["irk_devices_resolving"] == 1
        assert p["usage"]["irk_resolved"] == 1
        T.assert_shareable(p)
        assert "irk:" not in json.dumps(p) and _SIG_IRK.hex() not in json.dumps(p)
        p2 = T.build_payload(h, consume=True)      # a send: resets the window
        assert p2["health"]["irk_devices_resolving"] == 1
        assert T.build_payload(h)["health"]["irk_devices_resolving"] == 0
    finally:
        pbr._resolvers.pop(id(h), None)


def test_a_send_builds_a_snapshot_first(monkeypatch):
    """The environment half of the report comes from the live snapshot. A
    send ten minutes after a restart, with nobody on the panel, reported
    "0 scanners, 0 objects" about a full house — measured on the first real
    send. send_now now builds one first (the builder serves its own cache)."""
    h = _hass()
    built = []
    import sys, types
    fake_sb = types.ModuleType("custom_components.padspan_ha.snapshot_builder")
    async def _ls(hass):
        built.append(hass)
        return {}
    fake_sb._live_snapshot = _ls
    monkeypatch.setitem(sys.modules, "custom_components.padspan_ha.snapshot_builder", fake_sb)

    class _Resp:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
    class _Session:
        def post(self, *a, **k): return _Resp()
    fake_http = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake_http.async_get_clientsession = lambda hass: _Session()
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake_http)

    res = _run(T.send_now(h, force=True))
    assert res["sent"] is True
    assert built == [h], "send_now did not build a snapshot before reporting"


def test_opting_in_starts_the_windows_fresh():
    h = _hass()
    T.bump(h, "wall_placed")
    T.reset_windows(h)
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {}


def test_the_install_id_is_minted_once_and_is_a_uuid():
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_install_id"] = ""
    a = _run(T.ensure_install_id(h)); b = _run(T.ensure_install_id(h))
    assert a == b and T._UUID_RE.fullmatch(a)


def test_default_is_off_and_the_wire_is_registered():
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["telemetry_enabled"] is False
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    ws = (root / "websocket.py").read_text(encoding="utf-8")
    for cmd in ("ws_telemetry_preview", "ws_telemetry_event", "ws_telemetry_send_now", "ws_telemetry_reset_id"):
        assert f"async_register_command(hass, {cmd})" in ws
    init = (root / "__init__.py").read_text(encoding="utf-8")
    assert "async_setup_telemetry(hass)" in init and "async_stop_telemetry(hass)" in init
    js = (root / "www" / "padspan-ha" / "views" / "settings.js").read_text(encoding="utf-8")
    assert "padspan_ha/telemetry_preview" in js and "Help improve PadSpan" in js
    panel = (root / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    assert "telemetry_enabled" in panel, "the panel must not send events unless opted in"
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
    assert "Help improve PadSpan" in readme, "the opt-in report must be disclosed in the README"
