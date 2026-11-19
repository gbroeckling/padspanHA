"""The opt-in report can tell irk-capture homes apart.

irk-capture (github.com/DerekSeaman/irk-capture) on a spare ESP32 is how most
people get an iPhone's or Apple Watch's key. A key the phone wizard saved from
one counted as "padspan", like any other key saved in PadSpan, so the report
could not say how many homes get keys that way or whether those keys work.

Now a key that came from an irk-capture ESP32 is saved with `via:
"irk_capture"` (that one value; from the phone wizard's irk-capture path, or
the IRK Manager once Auto-detect found it there), the resolver counts such a key
under the label "irk_capture" in irks_by_source / irks_resolving_by_source,
and the report carries how many irk-capture ESP32s Home Assistant has
(health.irk_capture_boards) — counts only, and only when the report is on.
The panel still lists the key as PadSpan's, so its Remove button stays.

tests/js/irk_capture_steps.mjs ("marker:") holds which Save sends the marker.
The developer's side adds them up: server/stats.php's identity counts, shown
in the Install Base view's "Following phones" card
(tests/js/installbase_identity.mjs).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
import voluptuous as vol

from custom_components.padspan_ha import private_ble_resolver as pbr
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_irk
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_irk_add_refuses_what_cannot_work import _hass as _irk_hass, _SIG_IRK, _SIG_RPA
from tests.test_telemetry import _hass as _report_hass, _run

_KEY_B = bytes(range(16))
_ROOT = Path(__file__).resolve().parents[1]


# ── 1. The marker: stored only from the irk-capture path, only that value ──

@pytest.fixture
def _add(monkeypatch):
    resolver = SimpleNamespace(device_count=1, async_load=AsyncMock())

    async def _get(hass):
        return resolver
    monkeypatch.setattr(ws_irk, "_get_ble_resolver", _get)

    def _do(msg_extra):
        ads = [{"address": _SIG_RPA, "name": "x", "rssi": -60, "manufacturer_data": {}}]
        h, ble = _irk_hass(ads=ads)
        monkeypatch.setattr(ws_irk, "get_bluetooth_live", lambda hass: ble)
        conn = MagicMock()
        _run(ws_irk.ws_irk_add(h, conn, {"id": 1, "name": "Alex's iPhone", "irk_hex": _SIG_IRK.hex(), **msg_extra}))
        conn.send_error.assert_not_called()
        return h._saved["irk_devices"]
    return _do


def test_a_key_from_the_irk_capture_path_keeps_the_marker(_add):
    assert _add({"via": "irk_capture"}) == [{"name": "Alex's iPhone", "irk_hex": _SIG_IRK.hex(), "via": "irk_capture"}]


def test_a_key_saved_any_other_way_has_none(_add):
    assert _add({}) == [{"name": "Alex's iPhone", "irk_hex": _SIG_IRK.hex()}]
    # Past the schema somehow, any other word still stores nothing.
    assert _add({"via": "padspan"}) == [{"name": "Alex's iPhone", "irk_hex": _SIG_IRK.hex()}]


def test_the_command_takes_that_one_value_only():
    schema = vol.Schema(ws_irk.ws_irk_add.ws_schema)
    base = {"type": "padspan_ha/irk_add", "name": "Sam's watch", "irk_hex": _SIG_IRK.hex()}
    assert schema({**base, "via": "irk_capture"})["via"] == "irk_capture"
    assert "via" not in schema(base)
    for bad in ("padspan", "IRK_CAPTURE", "", "Sam's ESP32"):
        with pytest.raises(vol.Invalid):
            schema({**base, "via": bad})


# ── 2. The resolver's label ─────────────────────────────────────────────────

def _resolver(irk_devices):
    hass = MagicMock()
    hass.config_entries.async_entries = lambda domain: []
    hass.async_add_executor_job = AsyncMock(return_value=[])
    hass.states.async_all = lambda domain=None: []
    hass.data = {DOMAIN: {"settings": SimpleNamespace(data={"irk_devices": irk_devices})}}
    r = pbr.PrivateBLEResolver(hass)
    _run(r.async_load())
    return r


def test_the_report_labels_an_irk_capture_key_apart_and_says_whether_it_works():
    assert "irk_capture" in pbr.PrivateBLEResolver.IDENTITY_SOURCES
    r = _resolver([
        {"name": "Alex's iPhone", "irk_hex": _SIG_IRK.hex(), "via": "irk_capture"},
        {"name": "Sam's watch", "irk_hex": _KEY_B.hex(), "via": "irk_capture"},
        {"name": "Jordan's phone", "irk_hex": bytes(range(16, 32)).hex()},             # saved before, or by hand
    ])
    assert r.resolve_address(_SIG_RPA)["canonical_id"] == "irk:" + _SIG_IRK.hex()
    out = r.identity_breakdown(r.take_resolved_ids())
    assert out["by_source"] == {"irk_capture": {"total": 2, "resolving": 1}, "padspan": {"total": 1, "resolving": 0}}
    # The panel still lists all three as PadSpan's (its Remove button goes by that).
    assert [d["source"] for d in r.get_status()["devices"]] == ["padspan", "padspan", "padspan"]


def test_an_unknown_marker_on_disk_counts_as_padspan():
    r = _resolver([{"name": "Alex's iPhone", "irk_hex": _SIG_IRK.hex(), "via": "Alex's own tool"}])
    assert r.identity_breakdown(set())["by_source"] == {"padspan": {"total": 1, "resolving": 0}}


# ── 3. The board count, and 4. only when the report is on ───────────────────

def _boards(monkeypatch, h, n):
    """n irk-capture ESP32s, plus an ESPHome proxy that is not one."""
    from homeassistant.helpers import device_registry as dr_mod, entity_registry as er_mod
    ents, states, devs = [], {}, {}
    for i in range(1, n + 1):
        eid = f"sensor.alex_irk_capture_{i}_irk"
        ents.append(SimpleNamespace(entity_id=eid, device_id=f"dev{i}", platform="esphome"))
        states[eid] = SimpleNamespace(state=_SIG_IRK.hex(), attributes={})
        devs[f"dev{i}"] = SimpleNamespace(name=f"alex-irk-capture-{i}", name_by_user=f"Alex IRK Capture {i}")
    ents.append(SimpleNamespace(entity_id="sensor.kitchen_proxy_uptime", device_id="dev9", platform="esphome"))
    er = SimpleNamespace(entities={e.entity_id: e for e in ents})
    monkeypatch.setattr(er_mod, "async_get", lambda hass: er, raising=False)
    monkeypatch.setattr(dr_mod, "async_get", lambda hass: SimpleNamespace(async_get=devs.get), raising=False)
    h.states = SimpleNamespace(get=lambda eid, default=None: states.get(eid, default))


def test_the_report_counts_the_boards_and_nothing_about_them(monkeypatch):
    h = _report_hass()
    _boards(monkeypatch, h, 2)
    p = T.build_payload(h)
    assert p["health"]["irk_capture_boards"] == 2
    T.assert_shareable(p)
    text = json.dumps(p)
    for secret in ("Alex", "alex", "irk_capture_1", "dev1", _SIG_IRK.hex()):
        assert secret not in text, secret


def test_no_board_is_a_zero(monkeypatch):
    h = _report_hass()
    _boards(monkeypatch, h, 0)
    assert T.build_payload(h)["health"]["irk_capture_boards"] == 0


def test_the_fields_go_only_when_the_report_is_on(monkeypatch):
    h = _report_hass()
    _boards(monkeypatch, h, 1)
    r = pbr.PrivateBLEResolver(h)
    r._devices = [{"canonical_id": "irk:" + _SIG_IRK.hex(), "name": "Alex's iPhone", "irk_bytes": _SIG_IRK}]
    r._source_info = [{"source": "padspan", "via": "irk_capture"}]
    pbr._resolvers[id(h)] = r
    looked = []
    real = ws_irk._irk_capture_devices
    monkeypatch.setattr(ws_irk, "_irk_capture_devices", lambda hass: looked.append(1) or real(hass))
    sent = []

    class _Resp:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

    class _Session:
        def post(self, url, data=None, **k):
            sent.append(json.loads(data))
            return _Resp()
    fake_http = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake_http.async_get_clientsession = lambda hass: _Session()
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake_http)
    fake_sb = types.ModuleType("custom_components.padspan_ha.snapshot_builder")
    fake_sb._live_snapshot = AsyncMock(return_value={})
    monkeypatch.setitem(sys.modules, "custom_components.padspan_ha.snapshot_builder", fake_sb)
    try:
        r.resolve_address(_SIG_RPA)
        h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
        assert _run(T.send_now(h, force=True))["sent"] is False
        assert sent == [] and looked == [], "off: nothing built, nothing looked at, nothing sent"

        h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = True
        assert _run(T.send_now(h, force=True))["sent"] is True
        assert len(sent) == 1 and looked == [1], "read once, when the report is built"
        health = sent[0]["health"]
        assert health["irk_capture_boards"] == 1
        assert health["irks_by_source"] == {"irk_capture": 1}
        assert health["irks_resolving_by_source"] == {"irk_capture": 1}
    finally:
        pbr._resolvers.pop(id(h), None)


# ── 5. The developer's stats: server/stats.php and the Install Base card ────

def test_stats_php_adds_up_what_the_report_sends(monkeypatch):
    """stats.php reads the three fields by the names the report uses, as
    counts, into its identity block. (No PHP here to run it: read as text,
    like the other stats.php tests, against a report this code built.)"""
    php = _ROOT / "server" / "stats.php"
    if not php.is_file():
        pytest.skip("the Bright tree has no server folder")
    src = php.read_text(encoding="utf-8")
    h = _report_hass()
    _boards(monkeypatch, h, 1)
    r = pbr.PrivateBLEResolver(h)
    r._devices = [{"canonical_id": "irk:" + _SIG_IRK.hex(), "name": "Sam's iPhone", "irk_bytes": _SIG_IRK}]
    r._source_info = [{"source": "padspan", "via": "irk_capture"}]
    pbr._resolvers[id(h)] = r
    try:
        health = T.build_payload(h)["health"]
    finally:
        pbr._resolvers.pop(id(h), None)
    block = src[src.index("    // irk-capture"):src.index("$latest[$id]['_bad']")]
    read = set(re.findall(r"\$h\['([a-z_]+)'\]", block))
    assert read == {"irk_capture_boards", "irks_by_source", "irks_resolving_by_source"}
    assert read <= set(health), "stats.php reads a field the report does not send"
    assert "irk_capture" in health["irks_by_source"] and "['irk_capture']" in block
    assert block.count("(int)") == 3, "every number read is made a whole number"
    assert block.count("as_map(") == 2, "the two by-source maps may come back as [] when empty"
    for k in ("capture_installs", "capture_keys", "capture_keys_resolving"):
        assert f"'{k}' => 0" in src and f"$identity['{k}']" in block, k
    assert "'identity' => $identity" in src


def test_the_install_base_card_shows_them():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(_ROOT / "tests" / "js" / "installbase_identity.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in r.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{r.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert len(out["cases"]) >= 5 and all(out["cases"].values()) and not out["failures"], \
        json.dumps(out["failures"][:4], indent=2, ensure_ascii=False)
