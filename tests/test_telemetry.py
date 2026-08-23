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
    # Auto-calibration marks its points in the label, as the engine does.
    cal = SimpleNamespace(data={"points": [{"room": _ROOM, "label": "[auto] Garry", "rssi": {_MAC1: -60}},
                                           {"room": "Kitchen", "label": "Kitchen door"}]})
    # The coordinator's poll result, as the live overlay reads it: the house's
    # own phone placed and outside, plus a stranger's phone that the engine
    # positioned too and the report must not count.
    coord = SimpleNamespace(
        _coverage_floor=-90.0,
        data={_MAC1: {"x_m": 1.0, "y_m": 2.0, "outside": True, "room": _ROOM},
              "stranger": {"x_m": 9.0, "y_m": 9.0, "outside": True}},
        is_identified_object=lambda key: key == _MAC1,
    )
    snapshot = {
        "ble": {"radios": [{"source": _MAC1, "name": "ble-white3dprintedbox", "ip": _IP, "adapter": "x"},
                           {"source": "hci0", "name": "local", "lost": True}],
                "diag": {"ok": True, "callback_active": True}},
        "objects": {"list": [
            {"kind": "ibeacon", "name": "Pixel 8 Pro", "address": _MAC1, "identified": True, "x_m": 1.0, "room": _ROOM,
             "ibeacon_uuid": _UUID, "user_label": "Garry"},
            {"kind": "ble", "name": "MaschineBOX", "address": _MAC2, "outside": True},
        ], "summary": {"resolver": {"crypto_ok": True, "rpa_count": 80, "resolved": 0, "errors": [f"bad {_MAC1}"]}}},
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


def test_every_reported_feature_flag_drives_something():
    """A flag the report carries must be read somewhere other than the
    settings plumbing. Three were not (trackability_rating_enabled,
    compass_ring_enabled, replay_timeline_enabled): keys in the schema, the
    store and the Settings view, consumed by nothing — so the report said
    whether a feature was on that did not exist."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    plumbing = {"telemetry.py", "settings_store.py", "ws_settings.py", "settings.js"}
    src = "\n".join(p.read_text(encoding="utf-8", errors="ignore")
                    for p in list(root.rglob("*.py")) + list(root.rglob("*.js")) if p.name not in plumbing)
    dead = [f for f in T._FEATURE_FLAGS if f not in src]
    assert not dead, f"reported flags nothing reads: {dead}"


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


def test_a_registered_key_that_never_matches_is_visible_as_silent():
    """The failure the report could not see.

    rpas_seen / rpas_resolved cannot answer this. count_rpas counts every
    resolvable-looking address on the air, i.e. every rotating device in
    range, so the ratio mostly measures how many neighbours you have. A key
    that is registered and never matches used to look exactly like no key at
    all — both were a zero.
    """
    from custom_components.padspan_ha import private_ble_resolver as pbr
    h = _hass()
    r = pbr.PrivateBLEResolver(h)
    r._devices = [
        {"canonical_id": "irk:" + _SIG_IRK.hex(), "name": "Phone", "irk_bytes": _SIG_IRK},
        {"canonical_id": "irk:deadbeef", "name": "Watch", "irk_bytes": bytes(16)},
    ]
    r._source_info = [{"source": "private_ble_device"}, {"source": "padspan"}]
    pbr._resolvers[id(h)] = r
    try:
        r.resolve_address(_SIG_RPA)                # only the first one matches
        p = T.build_payload(h)
        assert p["health"]["irks_total"] == 2
        assert p["health"]["irks_silent"] == 1, "the Watch resolved nothing and must show"
        assert p["health"]["has_any_identity"] is True
        assert p["health"]["irks_by_source"] == {"private_ble_device": 1, "padspan": 1}
        assert p["health"]["irks_resolving_by_source"] == {"private_ble_device": 1, "padspan": 0}
        T.assert_shareable(p)
        assert "Watch" not in json.dumps(p) and "Phone" not in json.dumps(p)
    finally:
        pbr._resolvers.pop(id(h), None)


def test_no_identity_configured_is_not_the_same_as_none_working():
    """Both are zero resolving. Only has_any_identity separates them."""
    from custom_components.padspan_ha import private_ble_resolver as pbr
    h = _hass()
    r = pbr.PrivateBLEResolver(h)
    r._devices = []
    r._source_info = []
    pbr._resolvers[id(h)] = r
    try:
        p = T.build_payload(h)
        assert p["health"]["irks_total"] == 0
        assert p["health"]["irks_silent"] == 0, "nothing registered is not a silent key"
        assert p["health"]["has_any_identity"] is False
        assert p["health"]["irks_by_source"] == {}
    finally:
        pbr._resolvers.pop(id(h), None)


def test_an_unknown_identity_source_cannot_travel_as_a_label():
    """Source labels are a fixed vocabulary, so a future one cannot leak."""
    from custom_components.padspan_ha import private_ble_resolver as pbr
    h = _hass()
    r = pbr.PrivateBLEResolver(h)
    r._devices = [{"canonical_id": "irk:x", "name": "n", "irk_bytes": bytes(16)}]
    r._source_info = [{"source": "Garry's experimental importer"}]
    pbr._resolvers[id(h)] = r
    try:
        p = T.build_payload(h)
        assert p["health"]["irks_by_source"] == {"other": 1}
        assert "Garry" not in json.dumps(p)
        T.assert_shareable(p)
    finally:
        pbr._resolvers.pop(id(h), None)


def test_a_preview_does_not_consume_the_identity_window():
    from custom_components.padspan_ha import private_ble_resolver as pbr
    h = _hass()
    r = pbr.PrivateBLEResolver(h)
    r._devices = [{"canonical_id": "irk:" + _SIG_IRK.hex(), "name": "Phone", "irk_bytes": _SIG_IRK}]
    r._source_info = [{"source": "private_ble_device"}]
    pbr._resolvers[id(h)] = r
    try:
        r.resolve_address(_SIG_RPA)
        assert T.build_payload(h)["health"]["irks_silent"] == 0
        assert T.build_payload(h)["health"]["irks_silent"] == 0, "a preview reset the window"
        T.build_payload(h, consume=True)
        assert T.build_payload(h)["health"]["irks_silent"] == 1, "after a send the key is silent again"
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


# ── is the building described at all ─────────────────────────────────────────
# The developer has one house, and in it every floor has a storey height,
# every scanner has a mounting height and one map is measured. None of those
# is true by default, and until these fields existed an install with none of
# them set looked identical to his — which is why "my middle floor won't let
# go" took two rounds of screenshots to get anywhere.

def test_an_unconfigured_house_says_so():
    p = T.build_payload(_hass())          # the fixture sets none of it
    T.assert_shareable(p)
    assert p["env"]["calibration_no_floor"] == 2, "neither fixture point has a floor"
    assert p["env"]["floors_with_height"] == 0
    assert p["env"]["scanners_with_z"] == 0
    assert p["health"]["has_metre_anchor"] is False, "no map carries a measurement"
    assert p["health"]["floors_all_default"] is True
    assert p["health"]["scanner_z_uniform"] is True


def test_a_configured_house_says_that_instead():
    h = _hass()
    dom = h.data[DOMAIN]
    dom[DATA_MODEL].data["floors"] = [
        {"id": "main", "floor_to_floor_m": 2.8},
        {"id": "up", "base_elevation_m": 2.8},
    ]
    dom[DATA_FABRIC].data["scanner_positions_m"] = {
        "a": {"x_m": 1.0, "y_m": 1.0, "z_m": 0.9},
        "b": {"x_m": 2.0, "y_m": 2.0, "z_m": 3.6},
    }
    dom["calibration"].data["points"] = [
        {"room": "Kitchen", "floor_id": "main"},
        {"room": "Kitchen", "floor_id": "up"},
    ]
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["env"]["calibration_no_floor"] == 0
    assert p["env"]["floors_with_height"] == 2
    assert p["env"]["scanners_with_z"] == 2
    assert p["health"]["floors_all_default"] is False
    assert p["health"]["scanner_z_uniform"] is False, "two distinct mounting heights"


def test_a_bungalow_is_not_reported_as_misconfigured():
    """One floor cannot be missing a storey height in any way that matters."""
    h = _hass()
    h.data[DOMAIN][DATA_MODEL].data["floors"] = [{"id": "main", "name": "Main"}]
    p = T.build_payload(h)
    assert p["health"]["floors_all_default"] is False
    assert p["health"]["scanner_z_uniform"] is False


# ── uncaught panel errors ────────────────────────────────────────────────────

def test_ui_errors_are_counted_by_view_and_only_by_view():
    h = _hass()
    assert T.bump(h, "ui_error:maps") is True
    assert T.bump(h, "ui_error:maps") is True
    assert T.bump(h, "ui_error:overview") is True
    # Not a view, so not a key. The vocabulary is closed for the same reason
    # the tab list is: the report's KEYS leave the box too.
    assert T.bump(h, "ui_error:Nicole's Office") is False
    assert T.bump(h, "ui_error:") is False
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["usage"]["ui_error:maps"] == 2 and p["usage"]["ui_error:overview"] == 1
    assert not any("Nicole" in k for k in p["usage"])


def test_every_ui_error_name_maps_to_a_real_view():
    assert T.UI_ERRORS == frozenset(f"ui_error:{v}" for v in T.VIEWS)
    assert all(T.event_allowed(e) for e in T.UI_ERRORS)


def test_the_panel_installs_the_error_listeners_and_removes_them():
    from pathlib import Path
    panel = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
             / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    assert 'window.addEventListener("error", this._uiErrorHandler)' in panel
    assert 'window.addEventListener("unhandledrejection", this._uiRejectionHandler)' in panel
    assert 'window.removeEventListener("error", this._uiErrorHandler)' in panel
    assert 'window.removeEventListener("unhandledrejection", this._uiRejectionHandler)' in panel
    assert '"ui_error:" + view' in panel


def test_the_settings_path_is_right_everywhere_it_is_stated():
    """It was wrong in three places at once and a user corrected it twice."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    for rel in ("custom_components/padspan_ha/telemetry.py",
                "custom_components/padspan_ha/www/padspan-ha/panel.js",
                "README.md"):
        text = (root / rel).read_text(encoding="utf-8")
        assert "Update Check & Privacy" not in text, f"{rel} still names a tab that does not exist"


# ── the ask ──────────────────────────────────────────────────────────────────
# The switch existed for three releases and nothing pointed at it. Every
# install that opted in belonged to someone already on GitHub describing their
# bugs in prose — the population the report needs least. So the panel asks,
# once, where people are looking; any answer ends it; the default stays off.

def test_the_ask_defaults_to_unanswered_and_the_report_to_off():
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["telemetry_asked"] is False
    assert DEFAULT_SETTINGS["telemetry_enabled"] is False, "asking is not defaulting"


def test_the_answer_is_a_setting_the_wire_accepts():
    from pathlib import Path
    ws = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("telemetry_asked"): bool' in ws
    assert 'payload["telemetry_asked"] = bool(msg.get("telemetry_asked"))' in ws


def test_the_panel_asks_in_both_places_and_only_until_answered():
    from pathlib import Path
    panel = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
             / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    # one card, built once
    assert panel.count("_telemetryAskCard(compact){") == 1
    # gone after any answer, and never shown to someone already opted in
    assert "if (!st || st.telemetry_enabled || st.telemetry_asked) return null;" in panel
    # inside the setup checklist …
    assert "const _ask = this._telemetryAskCard(true);\n        if (_ask) bar.appendChild(_ask);" in panel
    # … and on Overview once the checklist is gone
    assert "const _ask = this._telemetryAskCard(false);\n        if (_ask) frag.appendChild(_ask);" in panel
    # both answers record that the question was asked; only yes turns it on
    assert "{ telemetry_enabled: true, telemetry_asked: true }" in panel
    assert ": { telemetry_asked: true }" in panel
    # the person can see the report before deciding
    assert 'this._callWS({ type: "padspan_ha/telemetry_preview" })' in panel
    # and the pitch says what it is, plainly
    assert "bleeding edge" in panel and "Never addresses, keys, names, coordinates or timestamps" in panel


# ── the install-base dashboard ───────────────────────────────────────────────
# The developer's view of what the reports add up to. Dev menu, Pro tier, and
# the server admits only a key on its developer list — three gates, and only
# the server's is real. What the panel draws is counts over other people's
# installs; the only per-install handle is the first 8 chars of a random id.

def test_install_base_is_wired_and_gated():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    ws = (root / "websocket.py").read_text(encoding="utf-8")
    assert "async_register_command(hass, ws_install_base)" in ws
    src = (root / "ws_telemetry.py").read_text(encoding="utf-8")
    assert '"type": "padspan_ha/install_base"' in src
    assert "@websocket_api.require_admin" in src.split("padspan_ha/install_base")[1].split("async def ws_install_base")[0]
    assert 'hass_tier_at_least(hass, "pro")' in src
    assert 'headers={"X-PadSpan-Key": key}' in src, "the key goes in a header, never the URL"
    assert T.STATS_URL.startswith("https://padspan.traks.ca/api/")
    panel = (root / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    assert 'installbase:  "./views/installbase.js"' in panel
    assert '"installbase"]' in panel.split("const DEV_ONLY_TABS")[1].split("\n")[0], "dev menu only"
    assert "installbase" in T.VIEWS, "a view that is not in the vocabulary cannot be counted"
    assert (root / "www" / "padspan-ha" / "views" / "installbase.js").exists()


def test_install_base_refuses_below_pro():
    from custom_components.padspan_ha import ws_telemetry as W
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["forensics_license_key"] = ""
    sent = {}
    conn = SimpleNamespace(send_error=lambda i, code, m: sent.update(code=code),
                           send_result=lambda i, r: sent.update(result=r))
    import custom_components.padspan_ha.licence as L
    orig = L.hass_tier_at_least
    L.hass_tier_at_least = lambda hass, want: False
    try:
        _run(W.ws_install_base(h, conn, {"id": 1, "type": "padspan_ha/install_base"}))
    finally:
        L.hass_tier_at_least = orig
    assert sent.get("code") == "tier" and "result" not in sent


def test_install_base_needs_a_key_to_present():
    from custom_components.padspan_ha import ws_telemetry as W
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["forensics_license_key"] = ""
    sent = {}
    conn = SimpleNamespace(send_error=lambda i, code, m: sent.update(code=code),
                           send_result=lambda i, r: sent.update(result=r))
    import custom_components.padspan_ha.licence as L
    orig = L.hass_tier_at_least
    L.hass_tier_at_least = lambda hass, want: True
    try:
        _run(W.ws_install_base(h, conn, {"id": 1, "type": "padspan_ha/install_base"}))
    finally:
        L.hass_tier_at_least = orig
    assert sent.get("code") == "no_key" and "result" not in sent


def test_stats_php_never_emits_an_ip_and_requires_the_dev_list():
    """The pings log has an IP column. stats.php may hash it to count distinct
    callers and must never write it out; and the gate is the dev-key file,
    not 'any valid Pro key'."""
    from pathlib import Path
    php_path = Path(__file__).resolve().parents[1] / "server" / "stats.php"
    if not php_path.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    php = php_path.read_text(encoding="utf-8")
    assert "hash('sha256', $p[1])" in php, "the IP is hashed on the way through"
    assert "hash_equals(" in php and "padspan-dev-keys" in php
    assert "traks.ca/license" not in php, "a valid Pro key is not the developer"
    assert "substr($id, 0, 8)" in php, "the table carries an id prefix, never the whole id"
