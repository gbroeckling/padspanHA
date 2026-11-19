# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""An iPhone's or Apple Watch's key from an irk-capture ESP32, step by step.

"Scan for IRK Capture devices" only read this Home Assistant's own Bluetooth
bonds, never the ESP32: the key it showed in Home Assistant had to be pasted
by hand, and anything found was saved as the bond's name or "Auto-detected".
Now irk_auto_detect also reads the key each irk-capture ESP32 shows, and the
phone wizard asks the name and whose it is first, pairs an iPhone and an
Apple Watch each its own way, saves the key under that name, labels the
device, adds it to that person's things (atlas_3d_carries), and says to
remove the pairing and refresh the ESP32 before the next device. Android
phones are told this is not their way.

The people count places an IRK phone with the person it was picked for.

tests/js/irk_capture_steps.mjs runs the shipped bluetooth.js and iphone_irk.js.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_irk, ws_occupancy

_ROOT = Path(__file__).resolve().parents[1]
_KEY = "00112233445566778899aabbccddeeff"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _ent(eid, device_id, platform="esphome"):
    return SimpleNamespace(entity_id=eid, device_id=device_id, platform=platform)


def _st(eid, state, **attrs):
    return SimpleNamespace(entity_id=eid, state=state, attributes=attrs)


def _detect(monkeypatch, entities, states, devices, registered=()):
    from homeassistant.helpers import device_registry as dr_mod, entity_registry as er_mod
    er = SimpleNamespace(entities={e.entity_id: e for e in entities})
    drg = SimpleNamespace(async_get=lambda i: devices.get(i))
    monkeypatch.setattr(er_mod, "async_get", lambda h: er, raising=False)
    monkeypatch.setattr(dr_mod, "async_get", lambda h: drg, raising=False)
    resolver = SimpleNamespace(_devices=[{"name": n, "irk_bytes": bytes.fromhex(k)} for n, k in registered])

    async def _get(hass):
        return resolver
    monkeypatch.setattr(ws_irk, "_get_ble_resolver", _get)
    ble = MagicMock()
    ble.get_snapshot = lambda **kw: {"advertisements": []}
    monkeypatch.setattr(ws_irk, "get_bluetooth_live", lambda hass: ble)
    hass = MagicMock()
    by_id = {s.entity_id: s for s in states}
    hass.states.get = lambda e: by_id.get(e)

    async def _executor(fn, *a):
        return []                      # no bonds on this Home Assistant
    hass.async_add_executor_job = _executor
    conn = MagicMock()
    _run(ws_irk.ws_irk_auto_detect(hass, conn, {"id": 1}))
    conn.send_error.assert_not_called()
    return conn.send_result.call_args.args[1]


def _capture_board(n, key_state):
    dev = f"dev{n}"
    ents = [_ent(f"sensor.irk_capture_{n}_irk", dev), _ent(f"select.irk_capture_{n}_ble_profile", dev),
            _ent(f"button.irk_capture_{n}_refresh_ble_identity", dev)]
    states = [_st(f"sensor.irk_capture_{n}_irk", key_state),
              _st(f"select.irk_capture_{n}_ble_profile", "Keyboard", options=["Heart Sensor", "Keyboard"]),
              _st(f"button.irk_capture_{n}_refresh_ble_identity", "unknown", friendly_name=f"IRK Capture {n} Refresh BLE Identity")]
    return ents, states, {dev: SimpleNamespace(name=f"irk-capture-{n}", name_by_user=f"IRK Capture {n}")}


def test_the_key_an_irk_capture_esp32_shows_is_found(monkeypatch):
    e1, s1, d1 = _capture_board(1, ":".join(_KEY[i:i + 2] for i in range(0, 32, 2)).upper())
    e2, s2, d2 = _capture_board(2, "unknown")                    # nothing paired yet
    others = [_ent("sensor.kitchen_proxy_irk", "dev9", platform="template"),   # not an ESPHome board
              _ent("sensor.kitchen_proxy_uptime", "dev8")]                     # an ESPHome board with no key sensor
    out = _detect(monkeypatch, e1 + e2 + others, s1 + s2 + [_st("sensor.kitchen_proxy_irk", _KEY)],
                  {**d1, **d2, "dev8": SimpleNamespace(name="proxy", name_by_user=None)})
    assert out["found"] == [{"name": "IRK Capture 1", "irk_hex": _KEY, "source": "irk_capture", "device_mac": "",
                             "already_registered": False, "registered_as": "", "verified": False, "matched_count": 0}]
    assert out["capture_devices"] == [
        {"name": "IRK Capture 1", "has_key": True, "profile": "Keyboard", "refresh": "IRK Capture 1 Refresh BLE Identity"},
        {"name": "IRK Capture 2", "has_key": False, "profile": "Keyboard", "refresh": "IRK Capture 2 Refresh BLE Identity"},
    ]


def test_a_key_already_saved_says_under_which_name(monkeypatch):
    e1, s1, d1 = _capture_board(1, _KEY)
    reversed_key = bytes(reversed(bytes.fromhex(_KEY))).hex()
    out = _detect(monkeypatch, e1, s1, d1, registered=[("Sam's iPhone", reversed_key)])
    assert out["found"][0]["already_registered"] is True
    assert out["found"][0]["registered_as"] == "Sam's iPhone"


def test_no_board_no_key(monkeypatch):
    out = _detect(monkeypatch, [_ent("sensor.kitchen_proxy_uptime", "dev8")], [], {})
    assert out["found"] == [] and out["capture_devices"] == []


def test_the_board_is_only_read():
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_irk.py").read_text(encoding="utf-8")
    fn = src[src.index("def _irk_capture_devices"):src.index("@websocket_api.websocket_command({\"type\": \"padspan_ha/irk_auto_detect\"})")]
    assert "async_call" not in fn and "select_option" not in fn and "press" not in fn.replace("presses", "")


# ── The people count: an IRK phone goes to the person it was picked for ─────

def _person(eid, name):
    return SimpleNamespace(entity_id=eid, state="home", attributes={"friendly_name": name})


def _phone_obj():
    return {"key": f"irk:{_KEY}", "canonical_id": f"irk:{_KEY}", "kind": "private_ble", "user_label": "Sam's iPhone",
            "name": "Sam's iPhone", "room": "Kitchen"}


def test_an_irk_phone_counts_as_the_person_it_was_picked_for():
    people = [{"name": "Sam", "entity_id": "person.sam", "trackers": set(), "match_names": {"sam"}, "aliases": [],
               "room": None, "via": "person entity"}]
    ws_occupancy._irk_phones([_phone_obj()], people, {"person.sam": [f"IRK:{_KEY.upper()}"]})
    assert len(people) == 1 and people[0]["room"] == "Kitchen" and people[0]["via"] == "Sam's iPhone (IRK)"


def test_without_a_pick_the_name_decides_as_before():
    people = [{"name": "Sam", "entity_id": "person.sam", "trackers": set(), "match_names": {"sam"}, "aliases": [],
               "room": None, "via": "person entity"}]
    ws_occupancy._irk_phones([_phone_obj()], people)
    assert [p["name"] for p in people] == ["Sam", "Sam's iPhone"]


def test_the_count_reads_the_picks_from_settings(monkeypatch):
    h = MagicMock()
    st = SimpleNamespace(data={"atlas_3d_carries": {"person.sam": [f"irk:{_KEY}"]}})
    pc = SimpleNamespace(data={f"irk:{_KEY}": {**_phone_obj(), "age_s": 3}})
    mdl = SimpleNamespace(get_scanner_mappings=lambda: ({"s1": "Kitchen"}, {"s1": "main"}))
    from custom_components.padspan_ha.const import DATA_MODEL, DATA_SETTINGS, DOMAIN
    h.data = {DOMAIN: {DATA_SETTINGS: st, DATA_MODEL: mdl, "presence_coordinator": pc}}
    states = [_person("person.sam", "Sam")]
    h.states.async_all = lambda domain=None: [s for s in states if domain is None or s.entity_id.startswith(domain + ".")]
    h.states.get = lambda eid: next((s for s in states if s.entity_id == eid), None)
    monkeypatch.setattr(ws_occupancy, "get_bluetooth_live", lambda hass: None)
    monkeypatch.setattr(ws_occupancy, "_entity_area_name", lambda hass, eid: None)
    res = _run(ws_occupancy.compute_occupancy_estimate(h))
    assert res["known"] == 1 and res["people"][0]["name"] == "Sam" and res["people"][0]["room"] == "Kitchen"


# ── The panel ───────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def run() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(_ROOT / "tests" / "js" / "irk_capture_steps.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in r.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{r.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("steps:", 7), ("save:", 6), ("findings:", 4), ("manager:", 2), ("card:", 1), ("marker:", 8)])
def test_the_capture_steps(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)
