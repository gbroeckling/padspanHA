# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Two things a screen can turn on, both off by default.

Follow the sun (Settings → Appearance → Theme, settings.theme_follow_sun):
Day while sun.sun is up (Light, inverted, without PadSpan Pro), the Theme
picked once it sets (Night if that is Day or Light). Off, or with no sun.sun,
the panel's look is exactly as before.

The frame-rate readout in Live Aboard (Settings → Live Aboard → Frame rate,
this browser only, views/live_aboard_fps.js): the frames drawn each second, "0 fps at rest"
when nothing redraws. Off, no element and no timer; the view harness
(tests/js/live_aboard_view.mjs, fps:) runs it for real.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_WWW = _ROOT / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _node(code: str, *args: str):
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, "-e", code, *args], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


# ── Follow the sun ──────────────────────────────────────────────────────────
def test_follow_the_sun_is_off_by_default_and_saves() -> None:
    assert DEFAULT_SETTINGS["theme_follow_sun"] is False
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert "theme_follow_sun" in keys
    assert '"light_theme", "day_theme", "theme_follow_sun",' in _src(_ROOT / "ws_settings.py")
    # Nothing new in the opt-in report.
    assert "theme_follow_sun" not in _src(_ROOT / "telemetry.py")


def _sun_look(cases: list) -> list:
    """panel.js _sunLook, run on its own for each [settings, sun state, pro]."""
    panel = _src(_WWW / "panel.js")
    m = re.search(r"\n  _sunLook\(pro\)\{\n(.*?)\n  \}\n", panel, re.S)
    assert m, "_sunLook not found"
    code = ("const f = new Function('pro', " + json.dumps(m.group(1)) + ");"
            "const out = JSON.parse(process.argv[1]).map(([s, sun, pro]) => {"
            " const self = { state: { settings: s }, _hass: sun ? { states: { 'sun.sun': { state: sun } } } : { states: {} } };"
            " return [f.call(self, pro), self._sunSeen]; });"
            "console.log(JSON.stringify(out));")
    return _node(code, json.dumps(cases))


def test_off_or_with_no_sun_the_theme_is_as_picked() -> None:
    picked = {"day_theme": True, "light_theme": False, "theme_palette": "ocean", "tier": "pro"}
    cases = [[picked, "above_horizon", True], [picked, "below_horizon", True],
             [{**picked, "theme_follow_sun": True}, None, True]]
    for (s, _, _), (look, seen) in zip(cases, _sun_look(cases)):
        assert look == s and seen is None


def test_on_it_is_day_while_the_sun_is_up_and_the_picked_night_look_after() -> None:
    on = {"theme_follow_sun": True, "day_theme": False, "light_theme": False, "theme_palette": "dusk"}
    got = _sun_look([[on, "above_horizon", True], [on, "above_horizon", False],
                     [on, "below_horizon", True], [{**on, "day_theme": True}, "below_horizon", True]])
    assert got[0] == [{"day_theme": True}, "above_horizon"]
    assert got[1] == [{"light_theme": True}, "above_horizon"], "below Pro, Day is Light (inverted)"
    assert got[2] == [{"theme_palette": "dusk"}, "below_horizon"]
    assert got[3][0] == {"theme_palette": "dusk"}, "Day picked: Night (or the palette) after sunset"


def test_the_panel_uses_it_and_asks_again_only_when_the_sun_changes() -> None:
    panel = _src(_WWW / "panel.js")
    body = panel[panel.index("  async _applyTheme(){"):panel.index("  _sunLook(pro){")]
    assert "const look = this._sunLook(pro);" in body
    assert "this.state.settings?.day_theme" not in body and "this.state.settings?.light_theme" not in body
    # The Pro gate is the theme's own: Day and the palettes only with Pro.
    assert "const day = pro && !!look.day_theme;" in body
    assert ('if(this.state?.settings?.theme_follow_sun === true && (hass?.states?.["sun.sun"]?.state || null) '
            '!== (this._sunSeen ?? null)) this._applyTheme();') in panel


def test_settings_offers_it_beside_the_theme() -> None:
    st = _src(_VIEWS / "settings.js")
    card = st[st.index("// ── Theme: Night, Light (inverted) or Day"):st.index("// ── 2D Map Mode")]
    assert 'sunToggle.checked = settings.theme_follow_sun === true;' in card
    assert "ctx.actions.settingsSet({ theme_follow_sun: sunToggle.checked })" in card
    assert '"Follow the sun"' in card


# ── the frame-rate readout ──────────────────────────────────────────────────
def test_the_readout_text() -> None:
    url = (_VIEWS / "live_aboard_fps.js").resolve().as_uri()
    got = _node("import(process.argv[1]).then(m => console.log(JSON.stringify("
                "[m.fpsText(0, 1000), m.fpsText(60, 1000), m.fpsText(15, 500), m.fpsText(1, 4000), m.fpsText(5, 0)])));", url)
    assert got == ["0 fps at rest", "60 fps", "30 fps", "1 fps", "0 fps at rest"]


def test_the_readout_is_off_unless_this_screen_turned_it_on() -> None:
    la = _src(_VIEWS / "live_aboard.js")
    assert 'const PREF_FPS = "fps";' in la
    assert 'function fpsOn(){ return prefGet(PREF_FPS) === "1"; }' in la
    assert "if (!fpsUi && fpsOn()) fpsUi = FPS.createFpsReadout(" in la
    assert "try { if (fpsUi) fpsUi.dispose(); }" in la
    # Views ▾ is as it was: the switch is in Settings, kept in this browser.
    assert "text: `Frame rate" not in la and "toggleFps" not in la
    st = _src(_VIEWS / "settings.js")
    assert 'fpsCb.checked = localStorage.getItem("padspan_la3d_fps") === "1";' in st
    assert 'localStorage.setItem("padspan_la3d_fps", fpsCb.checked ? "1" : "0");' in st
    assert 'get: (k) => { try { return localStorage.getItem("padspan_la3d_" + k); }' in _src(_VIEWS / "lights_map.js")
    want = "import(`./live_aboard_fps.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and want in p.read_text(encoding="utf-8"))
    assert importers == ["live_aboard.js"], importers
    fps = _src(_VIEWS / "live_aboard_fps.js")
    for bad in ("requestAnimationFrame", "setInterval", "callWS", "fetch(", "localStorage", "THREE"):
        assert bad not in fps, bad
    assert "live_aboard_fps" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_fps")
