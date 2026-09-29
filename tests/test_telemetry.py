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
_FAN = "fan.bedroom_ceiling"
_MOTION = "binary_sensor.hallway_motion"
_TEMP = "sensor.attic_temp"
_IP = "192.168.3.155"
_SECRETS = [_MAC1, _MAC2, _UUID, _IRK, _KEY, _ROOM, _FLOOR, _LIGHT, _FAN, _MOTION, _TEMP, _IP,
            "Garry", "Pixel 8 Pro", "MaschineBOX"]
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
        "lights_showcase_presets": [
            {"name": _ROOM, "values": {
                "lights_showcase": True, "lights_showcase_theme": "hygge",
                "lights_fit_rooms": False, "lights_isolux": False, "lights_show_beacons": False,
                "lights_hide_device_codes": False, "lights_hide_untouched": False,
                "lights_automorph_enabled": True, "lights_automorph_room_pct": 40,
                "lights_automorph_hardness": -10, "lights_automorph_style": "geode",
                "lights_automorph_subtlety": 0,
            }},
        ],
        "light_shapes": {_LIGHT: "bar"},
        "scanner_offsets": {_MAC1: 3},
        "light_type_overrides": {_LIGHT: "wled"},
    })
    async def _set(**kw): settings.data.update(kw)
    settings.async_set = _set
    fabric = SimpleNamespace(data={
        "floors": {"main": {"rooms": {_ROOM: {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]},
                                     "Kitchen": {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}}},
                   "up": {"rooms": {_FLOOR: {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}}}},
        "light_positions_m": {
            _LIGHT: {"x_m": 1.234, "y_m": 5.678, "floor_id": "main"},
            _FAN: {"x_m": 2.0, "y_m": 1.0, "floor_id": "main"},
            _MOTION: {"x_m": 3.0, "y_m": 1.0, "floor_id": "main"},
            _TEMP: {"x_m": 3.5, "y_m": 1.5, "floor_id": "main"},
        },
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
        "ble": {"radios": [{"source": _MAC1, "name": "ble-white3dprintedbox", "ip": _IP, "adapter": "x",
                            "scan_mode": "active", "requested_scan_mode": "active"},
                           {"source": "hci0", "name": "local", "lost": True,
                            "scan_mode": "passive", "requested_scan_mode": "auto"}],
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
    # placed_by_domain (Phase 2a registry audit, 2026-09-19) looks up each
    # placed entity's real device_class via hass.states — a plain MagicMock
    # here would answer every .attributes.get(...) with another MagicMock,
    # not a real string, so nothing would ever match and everything would
    # silently fall into "other".
    _state_attrs = {_MOTION: {"device_class": "motion"}, _TEMP: {"device_class": "temperature"}}
    h.states = SimpleNamespace(get=lambda eid, default=None:
        SimpleNamespace(attributes=_state_attrs[eid]) if eid in _state_attrs else default)
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
    assert payload["env"]["placed_lights"] == 4 and payload["env"]["walls"] == 1 and payload["env"]["irks"] == 1
    assert payload["env"]["placed_by_domain"] == {
        "light": 1, "fan": 1, "lock": 0, "motion_sensor": 1, "door_sensor": 0,
        "flood_sensor": 0, "temp_sensor": 1, "humidity_sensor": 0,
        "air_quality_sensor": 0, "other": 0,
    }
    assert payload["env"]["light_type_overrides_by_kind"] == {"wled": 1}
    assert payload["env"]["followed"] == 2 and payload["env"]["scanner_state"] == {"lost": 1, "disabled": 0, "excluded": 1}
    assert payload["env"]["objects_by_kind"] == {"ibeacon": 1, "ble": 1}
    # Scan mode: counted by value, with an explicit unknown bucket so an older
    # habluetooth that reports nothing is never silently counted as passive.
    # Both are carried because they answer different questions — `requested` is
    # the owner's choice, `scan_modes` is the momentary state, and an AUTO
    # scanner reads "passive" nearly all the time.
    assert payload["env"]["scan_modes"] == {"active": 1, "passive": 1, "auto": 0, "unknown": 0}
    assert payload["env"]["scan_modes_requested"] == {"active": 1, "passive": 0, "auto": 1, "unknown": 0}
    assert sum(payload["env"]["scan_modes"].values()) == payload["env"]["scanners"]

    assert payload["env"]["calibration_points"] == 2 and payload["env"]["calibration_auto_points"] == 1
    assert payload["env"]["integrations"]["esphome"] == 1 and payload["env"]["integrations"]["bermuda"] == 0
    assert payload["features"]["quiet_mode"] is True and payload["features"]["data_mode"] == "live"
    assert payload["health"]["rpas_seen"] == 80 and payload["health"]["coverage_floor_active"] is True
    assert payload["health"]["outside_now"] == 1 and payload["health"]["positioned_now"] == 1
    assert payload["health"]["resolver_errors"] == 1          # the count, not the message with the MAC in it
    assert payload["health"]["uptime"] in ("<1h", "<1d", "1-7d", ">7d") and "uptime_h" not in payload["health"]
    assert payload["usage"] == {"light_placed": 1, "tab:bluetooth/irk_panel": 1, "tab:maps": 1}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", payload["day"])  # a day, not a timestamp
    # The preset's VALUES travel; its user-typed NAME (here _ROOM, already
    # covered by the _SECRETS loop above) never does.
    assert payload["presets"] == [{
        "lights_showcase": True, "lights_showcase_theme": "hygge",
        "lights_fit_rooms": False, "lights_isolux": False, "lights_show_beacons": False,
        "lights_hide_device_codes": False, "lights_hide_untouched": False,
        "lights_automorph_enabled": True, "lights_automorph_room_pct": 40,
        "lights_automorph_hardness": -10, "lights_automorph_style": "geode",
        "lights_automorph_subtlety": 0,
    }]
    # The budget exists to force an argument over every byte, in the open.
    # Raised 3000 → 3100 for `maps_divergent` (21 bytes): the count of maps
    # whose two room records drifted apart as a group — the class that hid
    # rjbutler's trimmed floors (issue #62) for weeks, and exactly the kind
    # of silent state the report exists to surface. `stack_desync: None`
    # (22 bytes) was considered and kept — its null carries meaning a zero
    # would lie about, and its own test pins it.
    # Raised 3100 → 3200 for `placed_by_domain` and
    # `light_type_overrides_by_kind`: motion sensors and temperature readouts
    # both shipped with no way to see whether anyone had actually started
    # placing them, and `placed_lights` alone can't answer that — it already
    # folded lights, fans, motion and temperature into one number. Per-domain
    # counts (never entity ids) answer "is anyone using the newer classes"
    # instead of just "how many lights". `light_type_overrides_by_kind` is
    # the direct read on advanced (pro-only) type-override adoption.
    # Raised 3200 → 3300 for three lights_* switches the report never carried
    # (`lights_isolux`, `lights_automorph_enabled`, `lights_show_beacons`) plus
    # `lights_automorph_style` as an enum — Garry, 2026-09-09: "Collect info
    # for opt-in on how lights is configured and used". Each was already a
    # real, working feature (isolux contours, the Automorph aura, the beacons
    # overlay) the report simply never mentioned.
    # Raised 3300 → 3700 for `presets` — Garry, 2026-09-11: "add presets and
    # their components into the opt-in records" so popular Showcase-preset
    # combinations across installs can surface in a shared pulldown. One
    # preset's values here cost ~350 bytes; the cap is 10 per report (see
    # _PRESET_SHARE_CAP), so a full report could run well past this fixture's
    # single-preset size — the cap, not this test, is what bounds it in
    # practice, and it is exercised on its own in test_presets_are_capped_.
    # Raised 3700 → 3800 for `placed_by_domain` growing from 4 buckets to 10
    # (~70 bytes): it used to bucket by bare domain prefix, so a placed
    # door/flood sensor was silently counted as "motion_sensor" and a
    # humidity/air-quality sensor as "temp_sensor" — found in the Phase 2a
    # registry audit, 2026-09-19. Now one bucket per real device_class.
    # Raised 3800 → 3950 for `env.hw` (~95 bytes) and `health.perf` with no
    # samples yet (~20) — Garry, 2026-09-29: "Add load numbers and CPU info
    # to opt-in", "need to watch the pi installs for max outs". A full day's
    # `health.perf` is ~550 bytes more; that is bounded on its own in
    # test_a_full_load_section_is_small_and_every_word_is_on_the_list.
    assert len(text) < 3950


def test_presets_are_capped_at_ten_per_report():
    """Up to 50 presets can be saved; only a courtesy sample travels."""
    h = _hass()
    one = {"lights_showcase": True, "lights_showcase_theme": "classic", "lights_fit_rooms": False,
           "lights_isolux": False, "lights_show_beacons": False, "lights_hide_device_codes": False,
           "lights_hide_untouched": False, "lights_automorph_enabled": False,
           "lights_automorph_room_pct": 0, "lights_automorph_hardness": 0,
           "lights_automorph_style": "glow", "lights_automorph_subtlety": 0}
    h.data[DOMAIN][DATA_SETTINGS].data["lights_showcase_presets"] = [
        {"name": f"Look {i}", "values": one} for i in range(15)
    ]
    payload = T.build_payload(h)
    T.assert_shareable(payload)
    assert len(payload["presets"]) == 10


def test_a_malformed_preset_entry_is_skipped_not_crashed_on():
    """Settings storage is sanitized before it gets here (ws_settings.py), but
    telemetry must not assume that -- a hand-edited .storage file or an old
    schema version should degrade to "skip it", never a stack trace that
    breaks the whole day's report."""
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["lights_showcase_presets"] = [
        "not-a-dict",
        {"name": "No values"},
        {"name": "Values not a dict", "values": "nope"},
        {"name": "Fine", "values": {"lights_showcase_theme": "hygge"}},
    ]
    payload = T.build_payload(h)
    T.assert_shareable(payload)
    assert payload["presets"] == [{"lights_showcase_theme": "hygge"}]


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


def test_what_is_counted_while_a_report_is_in_flight_goes_with_the_next(monkeypatch):
    """Review: send_now took the windows only once the POST came back (up to
    15 s later) and threw away whatever had been counted meanwhile — a Find
    My link, a log line, a key resolving went with neither report. A send
    that fails still keeps everything for the next."""
    import sys
    import types
    from custom_components.padspan_ha import private_ble_resolver as pbr
    from custom_components.padspan_ha import ws_common
    h = _hass()
    T.bump(h, "findmy_linked", 5)
    handler = ws_common._RingLogHandler()
    handler.counts = {"WARNING:telemetry": 2}
    monkeypatch.setattr(ws_common, "_log_handler", handler)
    r = pbr.PrivateBLEResolver(h)
    r._resolved_ids_window = {"irk:before"}
    pbr._resolvers[id(h)] = r
    sent = {}

    class _Resp:
        def __init__(self, status):
            self.status = status

        async def __aenter__(self):          # the POST in flight: the house carries on
            T.bump(h, "findmy_linked")
            T.bump(h, "findmy_missed_ambiguous")
            handler.counts["ERROR:findmy"] = handler.counts.get("ERROR:findmy", 0) + 1
            r._resolved_ids_window.add("irk:during")
            return self

        async def __aexit__(self, *a):
            return False

    class _Session:
        def __init__(self, status):
            self._s = status

        def post(self, url, data=None, **k):
            sent["body"] = json.loads(data)
            return _Resp(self._s)

    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    try:
        fake.async_get_clientsession = lambda hass: _Session(500)
        assert _run(T.send_now(h, force=True))["sent"] is False
        assert h.data[DOMAIN][T._DATA_COUNTERS] == {"findmy_linked": 6, "findmy_missed_ambiguous": 1}
        assert handler.counts == {"WARNING:telemetry": 2, "ERROR:findmy": 1}
        assert r._resolved_ids_window == {"irk:before", "irk:during"}
        fake.async_get_clientsession = lambda hass: _Session(200)
        assert _run(T.send_now(h, force=True))["sent"] is True
        assert sent["body"]["usage"] == {"findmy_linked": 6, "findmy_missed_ambiguous": 1}
        assert sent["body"]["errors"] == {"WARNING:telemetry": 2, "ERROR:findmy": 1}
        assert h.data[DOMAIN][T._DATA_COUNTERS] == {"findmy_linked": 1, "findmy_missed_ambiguous": 1}
        assert handler.counts == {"ERROR:findmy": 1}
        assert r._resolved_ids_window == {"irk:during"}
    finally:
        pbr._resolvers.pop(id(h), None)


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
                       # Call shapes actually used in the tree. `self.hass, ` is
                       # BluetoothLive's convention (it stores hass unprefixed);
                       # omitting it made a live counter look dead.
                       for arg in ("hass, ", "self._hass, ", "self.hass, ", "", "ctx, "))]
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


def test_the_readme_lists_everything_a_report_carries():
    """Review: the README calls its list of what is sent complete, but it had
    no `presets` (up to ten saved Showcase presets' values) and no
    `lights_automorph_style`; and it put a report at ~2 KB (so did this
    module's docstring) when real ones run 2-5 KB."""
    from pathlib import Path
    readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(encoding="utf-8")
    for text in (readme, T.__doc__):
        assert "2 KB" not in text
    if "the complete list:" not in readme:
        pytest.skip("this README only summarises the report (the Bright derivation's)")
    listed = readme[readme.index("the complete list:"):readme.index("**Never**")]
    for key in sorted(T._TOP_KEYS) + list(T._FEATURE_ENUMS):
        assert f"`{key}`" in listed, key


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

def test_ui_errors_are_counted_by_module_and_only_by_closed_name():
    h = _hass()
    assert T.bump(h, "ui_error:maps") is True
    assert T.bump(h, "ui_error:maps") is True
    assert T.bump(h, "ui_error:overview") is True
    assert T.bump(h, "ui_error:wled_tab_look") is True      # a helper module
    assert T.bump(h, "ui_error:panel") is True
    assert T.bump(h, "ui_error:atlas_panel") is True
    assert T.bump(h, "ui_error_while:maps") is True
    assert T.bump(h, "ui_error_while:atlas") is True
    # Not a module, so not a key. The vocabulary is closed for the same reason
    # the tab list is: the report's KEYS leave the box too.
    for bad in ("ui_error:Nicole's Office", "ui_error:", "ui_error_while:",
                "ui_error_while:Nicole's Office", "ui_error_while:panel",
                "ui_error:frontend_latest/app", "ui_error:button-card"):
        assert T.bump(h, bad) is False, bad
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["usage"]["ui_error:maps"] == 2 and p["usage"]["ui_error:overview"] == 1
    assert p["usage"]["ui_error_while:atlas"] == 1
    assert not any("Nicole" in k for k in p["usage"])


def test_every_padspan_file_the_panel_can_name_is_an_allowed_ui_error():
    """views/ui_error.js sends the base name of any views/*.js that threw; the
    backend drops what is not on the list. A new helper file left off
    UI_ERROR_HELPERS would have its errors thrown away without a word."""
    from pathlib import Path
    views = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
             / "www" / "padspan-ha" / "views")
    # ui_error.js counts these as "other" (the report never names the tester sign-up).
    as_other = {"tester_signup"}
    src = (views / "ui_error.js").read_text(encoding="utf-8")
    assert all(f'"{n}"' in src for n in as_other)
    names = {f.stem for f in views.glob("*.js")} - as_other
    assert names, "no views found"
    missing = {n for n in names if not T.event_allowed(f"ui_error:{n}")}
    assert not missing, f"add to telemetry.UI_ERROR_HELPERS: {sorted(missing)}"
    stale = (T.UI_ERROR_HELPERS | T.VIEWS) - names
    assert not stale, f"no such file in views/: {sorted(stale)}"
    assert not (T.UI_ERROR_HELPERS & T.VIEWS)
    assert all(T.event_allowed(f"ui_error_while:{v}") for v in T.VIEWS | {"atlas"})
    assert all(T.event_allowed(e) for e in T.UI_ERRORS)


def test_both_panels_install_the_error_listeners_and_remove_them():
    from pathlib import Path
    www = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
           / "www" / "padspan-ha")
    for name in ("panel.js", "lights_panel.js"):
        src = (www / name).read_text(encoding="utf-8")
        assert 'window.addEventListener("error", this._uiErrorHandler)' in src, name
        assert 'window.removeEventListener("error", this._uiErrorHandler)' in src, name
        assert "UI_ERROR.reportUiError(ev," in src, name
        # The attribution module is optional: its import failing must not
        # take the panel down (a top-level await would).
        assert "import(`./views/ui_error.js" in src and "await import(`./views/ui_error.js" not in src, name
    panel = (www / "panel.js").read_text(encoding="utf-8")
    assert 'window.addEventListener("unhandledrejection", this._uiRejectionHandler)' in panel
    assert 'window.removeEventListener("unhandledrejection", this._uiRejectionHandler)' in panel
    # The old attribution — whatever tab was open — must be gone.
    assert '"ui_error:" + view' not in panel
    atlas = (www / "lights_panel.js").read_text(encoding="utf-8")
    assert 'window.removeEventListener("unhandledrejection", this._uiErrorHandler)' in atlas


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
    # gone after any answer, never shown to someone already opted in, and not
    # before settings have loaded (tests/js/whats_new_card.mjs runs it)
    assert 'if (!st || !("telemetry_enabled" in st) || st.telemetry_enabled || st.telemetry_asked) return null;' in panel
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


# ── Apple Find My: how well following a tag works ────────────────────────────
# Garry, 2026-09-27: "make sure the opt-in records how well tools for this
# feature actually work". Counts only: the bridge and the adverts it is
# counted from are full of addresses, and none of them may travel.

_FM_EVENTS = ("findmy_linked", "findmy_linked_slow", "findmy_missed_ambiguous", "findmy_missed_late",
              "findmy_missed_elsewhere", "findmy_missed_no_candidate", "findmy_moved_back",
              "findmy_moved_back_addrs", "findmy_back_on_day_key", "findmy_not_this_tag")
_TAG_A, _TAG_A2, _TAG_OLD = "D1:11:11:11:11:11", "E2:22:22:22:22:22", "F3:33:33:33:33:33"
_TAG_B, _PODS, _STALE = "C7:77:77:77:77:77", "C4:44:44:44:44:44", "D5:55:55:55:55:55"
_FM_ADDRS = (_TAG_A, _TAG_A2, _TAG_OLD, _TAG_B, _PODS, _STALE)


def _fm_adv(device_type, separated=True):
    """A Find My payload in bluetooth_live.py's "0x.." form (findmy.py)."""
    body = [0x12, 0x19 if separated else 0x02, device_type << 4] + ([0x11] * 22 + [0x01, 0x00] if separated else [0x01])
    return " ".join(f"0x{b:02X}" for b in body)


def _findmy_house(bridging=True):
    """The fixture house with Find My on the air — an AirTag and a Find My
    accessory away from their owners, AirPods near theirs, a stale address —
    and a bridge following two tags, one of them carried onto a new address;
    MAC Rotation Bridging on unless told otherwise (the bridge stays in
    memory once it has run, whatever the switch says now)."""
    import time as _t
    from custom_components.padspan_ha.findmy import FindMyBridge
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["mac_rotation_bridging"] = bridging
    now = _t.time()
    h.data[DOMAIN]["snapshot_cache"][1]["ble"]["advertisements"] = [
        {"address": a, "source": s, "rssi": -60, "age_s": age, "manufacturer_data": {"76": p}}
        for a, p, age in ((_TAG_A2, _fm_adv(1), 3), (_TAG_B, _fm_adv(2), 8), (_PODS, _fm_adv(3, False), 20),
                          (_STALE, _fm_adv(1), 900))
        for s in (_MAC1, "hci0")]
    h.data[DOMAIN]["findmy_bridge"] = FindMyBridge({"tags": {
        _TAG_A: {"addr": _TAG_A2, "type": 1, "rssi": {_MAC1: -60.0}, "last_ts": now - 3,
                 "past": [_TAG_A], "refused": [_TAG_OLD], "linked_ts": now - 600},
        _TAG_B: {"addr": _TAG_B, "type": 2, "rssi": {_MAC1: -70.0}, "last_ts": now - 3600,
                 "past": [], "refused": []},
    }})
    return h


def test_find_my_is_reported_as_counts_and_never_an_address():
    h = _findmy_house()
    for n in _FM_EVENTS:
        T.bump(h, n)
    p = T.build_payload(h)
    T.assert_shareable(p)
    text = json.dumps(p)
    for a in _FM_ADDRS:
        assert a not in text and a.replace(":", "") not in text, f"{a} leaked into the report"
    assert p["env"]["findmy"] == {          # zeros left out (the cap refuses the whole report)
        "on_air": {"airtag": 1, "accessory": 1, "airpods": 1},
        "separated": {"airtag": 1, "accessory": 1},
        "tracked": {"airtag": 1, "accessory": 1},
        "tracked_live": 1, "tracked_carried": 1,
    }
    assert all(p["usage"][n] == 1 for n in _FM_EVENTS)
    # The addresses in this house are ones the gate would refuse, had any got in.
    for a in _FM_ADDRS:
        q = json.loads(text)
        q["env"]["findmy"]["note"] = a
        with pytest.raises(ValueError, match="MAC"):
            T.assert_shareable(q)


def test_with_bridging_off_the_report_still_says_whether_find_my_is_here():
    """Garry's own house: bridging off, a dozen Find My addresses on the air.
    The environment half is what says whether the feature would matter. The
    bridge stays in memory after the switch goes off ("Not this tag" loads it
    too): review — its tags went out as followed until HA restarted, and then
    as none, with nothing changed."""
    p = T.build_payload(_findmy_house(bridging=False))
    T.assert_shareable(p)
    assert p["features"]["mac_rotation_bridging"] is False
    assert p["env"]["findmy"] == {"on_air": {"airtag": 1, "accessory": 1, "airpods": 1},
                                  "separated": {"airtag": 1, "accessory": 1}}
    # Nothing Find My on the air: an empty block — counted, none here (a
    # report with no `findmy` at all is from before it).
    assert T.build_payload(_hass())["env"]["findmy"] == {}


def test_find_my_outcomes_are_in_the_vocabulary_and_a_preview_keeps_them():
    h = _hass()
    for n in _FM_EVENTS:
        assert n in T.EVENTS and T.bump(h, n), n
    T.bump(h, "findmy_linked")
    want = dict.fromkeys(_FM_EVENTS, 1)
    want["findmy_linked"] = 2
    assert T.build_payload(h)["usage"] == want
    assert T.build_payload(h)["usage"] == want, "a preview reset the Find My counters"
    assert T.build_payload(h, consume=True)["usage"] == want
    assert T.build_payload(h)["usage"] == {}


def test_a_full_day_fits_by_sending_fewer_presets_not_by_refusing(monkeypatch):
    """Review: the 8 KB cap refuses the WHOLE report, and a refused one keeps
    its counters, so every day after is refused too until HA restarts. With
    ten presets, every tab and sub-tab opened, a few modules logging and every
    Find My outcome counted, the report ran past the cap. The presets are the
    courtesy sample: as many go as fit, and the counts all do."""
    from custom_components.padspan_ha import ws_common
    h = _findmy_house()
    one = {"lights_showcase": True, "lights_showcase_theme": "classic", "lights_fit_rooms": False,
           "lights_isolux": False, "lights_show_beacons": False, "lights_hide_device_codes": False,
           "lights_hide_untouched": False, "lights_automorph_enabled": False,
           "lights_automorph_room_pct": 100, "lights_automorph_hardness": -100,
           "lights_automorph_style": "glow", "lights_automorph_subtlety": 100}
    h.data[DOMAIN][DATA_SETTINGS].data["lights_showcase_presets"] = [{"name": f"Look {i}", "values": one} for i in range(10)]
    monkeypatch.setattr(ws_common, "_log_handler", SimpleNamespace(counts={
        "snapshot_builder": 12, "bluetooth_live": 3, "presence_coordinator": 41, "telemetry": 1}))
    for n in sorted(T.TAB_EVENTS) + list(_FM_EVENTS):
        T.bump(h, n, 250)
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert all(p["usage"][n] == 250 for n in list(T.TAB_EVENTS) + list(_FM_EVENTS))
    assert p["env"]["findmy"]["tracked"] == {"airtag": 1, "accessory": 1} and len(p["errors"]) == 4
    assert 0 < len(p["presets"]) < 10, "the fixture no longer overflows the cap with ten presets"
    one_more = {**p, "presets": p["presets"] + p["presets"][:1]}
    assert len(json.dumps(p)) <= T._MAX_BYTES < len(json.dumps(one_more)), "only as many dropped as needed"
    # A day with room for them all sends all ten.
    h2 = _findmy_house()
    h2.data[DOMAIN][DATA_SETTINGS].data["lights_showcase_presets"] = h.data[DOMAIN][DATA_SETTINGS].data["lights_showcase_presets"]
    for n in _FM_EVENTS:
        T.bump(h2, n, 250)
    assert len(T.build_payload(h2)["presets"]) == 10


def test_the_summary_reads_find_my_with_and_without_the_new_fields(tmp_path):
    """server/telemetry_summary.py on reports from before these fields and
    after: no crash; "elsewhere" and "no candidate" are shown but kept out of
    the follow rate, and links later undone are taken out of it altogether —
    a wrong link, caught, is not a hand-over that was due (review: it counted
    as one the matcher failed, so noticing a wrong link lowered the rate,
    and the same link unnoticed raised it); their share is its own line. A
    day key return is its own line. Two reports from one install on one day
    ("Send a report now") each carry their own counters — keeping only the
    last lost the first's — and an install that used something in either is
    an install that used it (review: the column read only the last report).
    Bridging is counted among the installs that can report Find My at all
    (review: seven installs on 0.38.22-0.38.29 read as "bridging on, follows
    nothing")."""
    import os
    import subprocess
    import sys
    from datetime import date
    from pathlib import Path
    script = Path(__file__).resolve().parents[1] / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    old = {"install_id": "11111111-1111-4111-8111-111111111111", "version": "0.38.80",
           "env": {"scanners": 2}, "features": {"mac_rotation_bridging": False},
           "usage": {"tab:maps": 3}, "health": {"crypto_ok": True}}
    new = {"install_id": "22222222-2222-4222-8222-222222222222", "version": "0.38.81",
           "env": {"scanners": 5, "findmy": {
               "on_air": {"apple": 2, "airtag": 3, "accessory": 1, "airpods": 2},
               "separated": {"airtag": 2, "accessory": 1},
               "tracked": {"airtag": 1, "accessory": 1},
               "tracked_live": 1, "tracked_carried": 1}},
           "features": {"mac_rotation_bridging": True},
           "usage": {"findmy_linked": 8, "findmy_linked_slow": 1, "findmy_missed_ambiguous": 1,
                     "findmy_missed_late": 1, "findmy_missed_elsewhere": 4, "findmy_missed_no_candidate": 5,
                     "findmy_moved_back": 1, "findmy_moved_back_addrs": 2, "findmy_back_on_day_key": 3,
                     "findmy_not_this_tag": 1},
           "errors": {"snapshot_builder": 2, "telemetry": 1}}
    quiet = {"install_id": "33333333-3333-4333-8333-333333333333", "version": "0.38.81",
             "env": {"scanners": 1, "findmy": {}}, "features": {"mac_rotation_bridging": False}}
    # The same install again that day, after "Send a report now".
    again = {**new, "usage": {"findmy_linked": 2}, "errors": {"snapshot_builder": 5}}

    def run(*reports):
        d = tmp_path / f"r{len(list(tmp_path.iterdir()))}"
        d.mkdir()
        day = date.today().isoformat()
        (d / f"{day}.jsonl").write_text("".join(json.dumps({"recv_day": day, "report": r}) + "\n" for r in reports),
                                        encoding="utf-8")
        out = subprocess.run([sys.executable, str(script), str(d)], capture_output=True, text=True, encoding="utf-8",
                             env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=60)
        assert out.returncode == 0, out.stderr
        return out.stdout

    def section(*reports):
        out = run(*reports)
        return out[out.index("Find My (AirTag) tools"):].split("\n\n")[0]

    s = section({**old, "features": {"mac_rotation_bridging": True}})
    assert re.search(r"installs with bridging on\s+0\s+/ 0 that report Find My", s), s
    assert re.search(r"installs from before Find My reports\s+1\s+\(1 with bridging on\)", s), s
    assert re.search(r"follow rate\s+n/a", s), s
    s = section(old, new, quiet)
    assert re.search(r"installs with bridging on\s+1\s+/ 2 that report Find My", s), s
    assert re.search(r"installs from before Find My reports\s+1\s+\(0 with bridging on\)", s), s
    assert re.search(r"installs with Find My on the air\s+1\s+/ 2 that report it", s), s
    assert "airtag 3 (2 away from owner)" in s and "apple 2 (0 away from owner)" in s, s
    assert "1 on the air, 1 carried" in s, s
    assert re.search(r"hand-overs followed \(links\)\s+8\s+\(1 took over 2 min\)", s), s
    assert re.search(r"late, where it was\s+1\b", s), s
    assert re.search(r"elsewhere\s+4\s+\(not in the rate", s), s
    assert re.search(r"no candidate\s+5\s+\(left range", s), s
    assert re.search(r"undone by themselves\s+1\s+\(2 links\)", s), s
    assert re.search(r"undone by a person\s+1\b", s), s
    assert re.search(r"back on the day key \(expected\)\s+3\b", s), s
    assert re.search(r"follow rate\s+71%", s), "(8 - 3) / (8 - 3 + 1 + 1)\n" + s
    assert re.search(r"wrong links \(undone\) per link\s+37%", s), "3 / 8\n" + s
    out = run(old, new, again)
    s = out[out.index("Find My (AirTag) tools"):].split("\n\n")[0]
    assert re.search(r"hand-overs followed \(links\)\s+10\b", s), s
    assert re.search(r"follow rate\s+77%", s), "(10 - 3) / (10 - 3 + 1 + 1): both reports of the day count\n" + s
    assert re.search(r"snapshot_builder\s+7\s+1 installs", out), out
    assert re.search(r"telemetry\s+1\s+1 installs", out), "an error only the day's first report carried\n" + out
    assert re.search(r"findmy_missed_ambiguous\s+1\s+1 installs", out), "used only in the day's first report\n" + out
    assert "2 installs, 2 install-days" in out, out


# ── load and hardware (perf_sampler.py) ──────────────────────────────────────
# Garry, 2026-09-29: "Add load numbers and CPU info to opt-in for this type of
# decision in future", "need to watch the pi installs for max outs". Numbers
# about the MACHINE — which makes them the easiest place for something about
# the machine's owner (a hostname, a model string with a serial in it) to slip
# in. So both sections are a closed list, like the event vocabulary.

_PI4 = {"cpus": 4, "ram": "4g", "arch": "aarch64", "install": "os", "board": "rpi4", "ready": True}


def _busy_day(h, hours: float = 24.0):
    """A day on a Pi that is struggling, as the sampler would have measured it."""
    import time as _t
    from custom_components.padspan_ha import perf_sampler as ps
    h.data[DOMAIN][ps._DATA_HW] = dict(_PI4)
    w = ps.PerfWindow(started=_t.monotonic() - hours * 3600)
    rnd = __import__("random").Random(3)
    for i in range(1440):
        w.samples += 1
        w.add("load", rnd.uniform(10, 160))
        w.add("cpu", rnd.uniform(1, 99.4))
        w.add("rss", rnd.uniform(600, 900))
        w.add("mem", rnd.uniform(4, 60))
        w.add("swap", rnd.uniform(0, 300))
        w.add("lag", rnd.uniform(0.05, 1800))
    for i in range(8640):
        w.add("snap", rnd.uniform(900, 8200))
        w.add("cycle", rnd.uniform(40, 2400))
    w.over.update({"load": 200, "cpu": 40, "mem": 12, "lag": 5})
    h.data[DOMAIN][ps._DATA_WINDOW] = w
    return w


def test_a_full_load_section_is_small_and_every_word_is_on_the_list():
    h = _hass()
    _busy_day(h)
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["env"]["hw"] == {"cpus": 4, "ram": "4g", "arch": "aarch64", "install": "os", "board": "rpi4"}
    perf = p["health"]["perf"]
    assert set(perf) == {"samples", "over"} | set(T.PERF_METRICS), set(perf) ^ ({"samples", "over"} | set(T.PERF_METRICS))
    for name, (_m, stats) in T.PERF_METRICS.items():
        assert set(perf[name]) == set(stats), name
        for s, v in perf[name].items():
            if name.endswith("_pc"):
                assert type(v) is int, (name, s, v)               # whole percents
            else:
                assert v == T._sig2(v), (name, s, v)              # already two significant figures
    # 30 or more to the nearest 60 (200 -> 180, 40 -> 60), fewer exact
    assert perf["samples"] == 1440 and perf["over"] == {"load": 180, "cpu": 60, "mem": 12, "lag": 5}
    assert perf["snap_ms"]["per_h"] == 360 and perf["cycle_ms"]["per_h"] == 360
    assert perf["cpu_all_pc"]["max"] == round(perf["cpu_pc"]["max"] / 4) or \
        abs(perf["cpu_all_pc"]["max"] - perf["cpu_pc"]["max"] / 4) <= 1
    assert perf["mem_avail_pc"]["min"] <= perf["mem_avail_pc"]["p05"] <= perf["mem_avail_pc"]["p50"]
    assert perf["lag_ms"]["p50"] <= perf["lag_ms"]["p95"] <= perf["lag_ms"]["max"]
    section = len(json.dumps(perf)) + len(json.dumps(p["env"]["hw"]))
    assert section < 700, section
    assert len(json.dumps(p)) <= T._MAX_BYTES


def test_nothing_identifying_can_ride_in_the_load_sections():
    """A board, installation type or architecture that is not a listed word
    goes as "unknown" — and if one ever reached the gate anyway, the gate
    refuses the whole report."""
    from custom_components.padspan_ha import perf_sampler as ps
    h = _hass()
    h.data[DOMAIN][ps._DATA_HW] = {"cpus": 512, "ram": "3.7 GiB", "arch": "aarch64 on garrys-pi",
                                   "install": "Home Assistant OS 16.2", "ready": True,
                                   "board": "Raspberry Pi 4 Model B Rev 1.4 serial 10000000abcdef12"}
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["env"]["hw"] == {"cpus": 64, "ram": "unknown", "arch": "unknown", "install": "unknown",
                              "board": "unknown"}
    assert "garrys" not in json.dumps(p) and "serial" not in json.dumps(p)

    base = T.build_payload(_hass())
    T.assert_shareable(base)

    def refused(mutate, match):
        q = json.loads(json.dumps(base))
        mutate(q)
        with pytest.raises(ValueError, match=match):
            T.assert_shareable(q)

    refused(lambda q: q["env"]["hw"].update(board="rpi4 in the garage"), "board")
    refused(lambda q: q["env"]["hw"].update(hostname="homeassistant"), "unexpected key in env.hw")
    refused(lambda q: q["env"]["hw"].update(cpus=65), "cpus")
    refused(lambda q: q["env"]["hw"].update(cpus=True), "cpus")
    refused(lambda q: q["env"].update(hw="rpi4"), "env.hw")
    refused(lambda q: q["health"]["perf"].update(host="garrys-pi"), "unexpected key in health.perf")
    refused(lambda q: q["health"]["perf"].update(lag_ms={"p99": 3}), "unexpected key in health.perf.lag_ms")
    refused(lambda q: q["health"]["perf"].update(lag_ms={"max": "slow"}), "not a count")
    refused(lambda q: q["health"]["perf"].update(lag_ms={"max": -1}), "not a count")
    refused(lambda q: q["health"]["perf"].update(lag_ms={"max": float("nan")}), "not a count")
    refused(lambda q: q["health"]["perf"].update(over={"swap": 1}), "unexpected key in health.perf.over")
    refused(lambda q: q["health"]["perf"].update(samples=None), "not a count")
    refused(lambda q: q["health"].update(perf=[1, 2]), "health.perf")


def test_a_failed_send_keeps_the_load_window_and_an_accepted_one_takes_it(monkeypatch):
    import sys
    import types
    from custom_components.padspan_ha import perf_sampler as ps
    h = _hass()
    w = _busy_day(h)
    sent = {}

    class _Resp:
        def __init__(self, status):
            self.status = status

        async def __aenter__(self):
            ps.window(h).add("snap", 100.0)          # the house carries on while the POST is out
            return self

        async def __aexit__(self, *a):
            return False

    class _Session:
        def __init__(self, status):
            self._s = status

        def post(self, url, data=None, **k):
            sent["body"] = json.loads(data)
            return _Resp(self._s)

    async def _no_build(hass):                        # a real build would be timed too: keep the count exact
        return None

    monkeypatch.setattr(T, "ensure_snapshot", _no_build)
    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    fake.async_get_clientsession = lambda hass: _Session(500)
    assert _run(T.send_now(h, force=True))["sent"] is False
    back = ps.window(h)
    assert back.samples == 1440 and back.hists["snap"].n == 8641 and back.over["load"] == 200
    assert T.build_payload(h)["health"]["perf"]["samples"] == 1440, "a preview reads, never takes"
    assert ps.window(h) is back
    fake.async_get_clientsession = lambda hass: _Session(200)
    assert _run(T.send_now(h, force=True))["sent"] is True
    assert sent["body"]["health"]["perf"]["samples"] == 1440
    assert ps.window(h).samples == 0 and ps.window(h).hists["snap"].n == 1, "what came in flight goes next"
    assert ps.window(h) is not w


def test_the_receiver_accepts_the_load_sections_unchanged():
    """server/telemetry.php refuses any top-level key it does not list, and
    any identifier shape anywhere in the flattened report — and a receiver
    that is not redeployed drops every report without a word (September: a
    new top-level key cost 16 days of reports). env.hw and health.perf nest
    under keys it already allows; this holds a full day's report to the
    PHP's OWN lists, read from the file, so a change that would need a
    redeploy fails here first."""
    from pathlib import Path
    php_path = Path(__file__).resolve().parents[1] / "server" / "telemetry.php"
    if not php_path.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    php = php_path.read_text(encoding="utf-8")
    allowed = set(re.findall(r"'([a-z_]+)'", php[php.index("$allowed = array("):].split(");")[0]))
    shapes_src = php[php.index("$shapes = array("):].split(");\n")[0]
    patterns = [m.group(1).replace("\\'", "'") for m in re.finditer(r"'((?:[^'\\]|\\.)*)'", shapes_src)]
    assert len(patterns) == 6 and "$MAX = 8192;" in php and "(int)$r['schema'] !== 1" in php
    h = _hass()
    _busy_day(h)
    p = T.build_payload(h)
    assert set(p) <= allowed, set(p) - allowed
    assert p["schema"] == 1
    flat = json.dumps({k: v for k, v in p.items() if k != "install_id"}, separators=(",", ":"))
    for pat in patterns:
        body, flags = pat[1:pat.rindex("/")], pat[pat.rindex("/") + 1:]
        assert not re.search(body, flat, re.I if "i" in flags else 0), f"telemetry.php would refuse: {pat}"
    assert len(json.dumps(p)) <= 8192


def test_opting_in_starts_the_load_window_fresh():
    from custom_components.padspan_ha import perf_sampler as ps
    h = _hass()
    _busy_day(h)
    T.reset_windows(h)
    assert ps.window(h).samples == 0 and T.build_payload(h)["health"]["perf"] == {"samples": 0}


def test_the_readme_and_the_panel_say_the_load_sections_go():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    readme = (root / "README.md").read_text(encoding="utf-8")
    if "the complete list:" in readme:
        listed = readme[readme.index("the complete list:"):readme.index("**Never**")]
        assert "`hw`" in listed and "`perf`" in listed
        for word in ("Raspberry Pi", "load per CPU", "event-loop lag", "memory available", "95th percentile",
                     "never a model string, hostname or serial"):
            assert word in listed, word
    else:                                   # the Bright derivation's README only summarises the report
        assert "how hard the machine works" in readme and "what class of machine it is" in readme
    settings = (root / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "settings.js").read_text(encoding="utf-8")
    assert "how hard the machine" in settings and "what class of machine it is" in settings
    panel = (root / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    assert "how hard the machine works and what class of machine it is" in panel
