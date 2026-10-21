# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The director (views/live_aboard_director.js): on the sidebar, Live Aboard
flies to a doorbell, door, sensor or alarm that went off, shows a card (the
picked camera's snapshot through Home Assistant's camera proxy) and goes back
to its home view; never while someone is using the screen.

tests/js/live_aboard_director.mjs runs the module under the DOM shim on a
clock of its own. Held here: the setting (an administrator's, cleaned,
default off), the hooks the hosts hand over, the module asking nothing of
Home Assistant, the Settings row, and nothing of it in the usage report.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_telemetry import _hass

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")
_PICK = [{"entity": "event.front_doorbell", "camera": "camera.front_porch"},
         {"entity": "binary_sensor.back_door", "camera": ""}]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_director.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["rules:", "fly:", "touch:", "off:"])
def test_the_director_harness_covers_each_part(harness, prefix) -> None:
    got = {k: v for k, v in harness["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(harness['cases'])}"
    bad = [f for f in harness["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)


def test_every_director_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:4], indent=2, ensure_ascii=False)


# ═══ the setting ══════════════════════════════════════════════════════════════

def test_the_setting_is_off_by_default_and_in_the_schema() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_director"] == []
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert "atlas_3d_director" in keys


def test_triggers_are_cleaned_once_each_and_capped() -> None:
    raw = [{"entity": "event.front_doorbell", "camera": "camera.front_porch"},
           {"entity": "event.front_doorbell", "camera": ""},             # twice: the first
           {"entity": "binary_sensor.back_door", "camera": "sensor.not_a_camera"},
           {"entity": "alarm_control_panel.house"},
           {"entity": "light.kitchen", "camera": ""},                    # not a kind that goes off
           {"entity": "event.Bad"}, {"entity": "event._x"}, {"entity": 7}, "event.x", None]
    assert WS._atlas_3d_director(raw) == [{"entity": "event.front_doorbell", "camera": "camera.front_porch"},
                                          {"entity": "binary_sensor.back_door", "camera": ""},
                                          {"entity": "alarm_control_panel.house", "camera": ""}]
    assert WS._atlas_3d_director({"entity": "event.x"}) == []
    many = [{"entity": f"binary_sensor.s{i}"} for i in range(30)]
    assert len(WS._atlas_3d_director(many)) == WS.DIRECTOR_MAX == 12
    assert WS.DIRECTOR_DOMAINS == ("event", "binary_sensor", "alarm_control_panel")


def test_it_saves_through_settings_set_and_a_bad_payload_wipes_nothing() -> None:
    h, conn = _hass(), MagicMock()
    conn.user = MagicMock(is_admin=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_director": _PICK}))
    assert not conn.send_error.called
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert data["atlas_3d_director"] == _PICK
    for bad in ("event.x", {"entity": "event.x"}, None):
        _run(WS.ws_settings_set(h, conn, {"id": 2, "atlas_3d_director": bad}))
        assert data["atlas_3d_director"] == _PICK, f"{bad!r} wiped what was saved"
    _run(WS.ws_settings_set(h, conn, {"id": 3, "atlas_3d_director": []}))
    assert data["atlas_3d_director"] == [], "an empty list is off"


def test_only_an_administrator_picks_what_it_flies_to() -> None:
    h, conn = _hass(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    data = h.data[DOMAIN][DATA_SETTINGS].data
    before = dict(data)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_director": _PICK, "quiet_mode": False}))
    assert conn.send_error.called and conn.send_error.call_args[0][1] == "unauthorized"
    assert data == before


def test_what_it_flies_to_never_goes_in_the_usage_report() -> None:
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data.update({"atlas_3d_enabled": True, "atlas_3d_director": list(_PICK)})
    p = T.build_payload(h)
    T.assert_shareable(p)
    flat = json.dumps(p)
    for word in ("atlas_3d_director", "front_doorbell", "front_porch", "back_door"):
        assert word not in flat, word
    assert "live_aboard_director" in T.UI_ERROR_HELPERS


# ═══ the hooks, the module, the Settings row ══════════════════════════════════

def test_the_hosts_hand_over_the_setting_and_the_live_states() -> None:
    lp = _js(_WWW / "lights_panel.js")
    assert "atlas_3d_director: s.atlas_3d_director };" in lp
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert "liveStates: ()=>this._hass?.states || {}," in block
    lm = _js(_VIEWS / "lights_map.js")
    assert 'liveStates: typeof h3.liveStates === "function" ? h3.liveStates : null,' in lm
    la = _js(_VIEWS / "live_aboard.js")
    at = la.index("import(`./live_aboard_director.js${new URL(import.meta.url).search}`)")
    assert ".catch(" in la[at:at + 200], "optional: a failure leaves the view as it was"
    assert "if (director) director.attach();" in la and "if (director) director.detach();" in la
    assert 'director && director.showing() ? "director"' in la, "the idle return waits while its card is up"
    assert "fly: (eid) => panel.moveQuietly(() => findDevice(String(eid)))," in la


def test_the_director_asks_nothing_of_home_assistant_and_streams_nothing() -> None:
    src = _code(_VIEWS / "live_aboard_director.js")
    for word in ("callWS", "wsCall", "fetch(", "hass", "setInterval", "localStorage", "three", "camera_proxy_stream",
                 "<video", "createElement(\"video\")", "live_aboard_panel"):
        assert word not in src, word
    assert '"/api/camera_proxy/"' in src, "the snapshot only through the camera proxy's own link"


def test_the_settings_row_is_an_administrators_and_says_what_it_does() -> None:
    sec = _js(_VIEWS / "settings.js")
    fn = sec[sec.index("function _atlas3dDirector("):]
    fn = fn[:fn.index("\nfunction ")]
    assert 'const _DIRECTOR_DOMAINS = ["event", "binary_sensor", "alarm_control_panel"];' in sec
    assert "const _DIRECTOR_MAX = 12;" in sec
    assert 'save("atlas_3d_director", next,' in fn and "ctx.hass.user.is_admin" in fn
    for words in ("Fly to when it goes off", "camera's snapshot", "home view after 20 s", "only the card shows"):
        assert words in fn, words
    box = sec[sec.index("function _atlas3dSection("):]
    assert "more.appendChild(_atlas3dDirector(ctx, el, settings, save, row));" in box[:box.index("\nfunction ")]
