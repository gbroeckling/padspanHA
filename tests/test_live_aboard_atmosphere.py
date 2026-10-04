# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P8, atmosphere: rain and snow, and the Atlas's Showcase look.

Two settings, each switching off on its own: atlas_3d_weather (on — rain and
snow in Live Aboard; it follows the Outdoor weather settings, which must be on
too) and atlas_3d_showcase (off — the Atlas's Showcase theme as Live Aboard's
lighting). tests/js/live_aboard_atmosphere_box.mjs renders their two rows in
Settings → UI Structure → Atlas → 3D house.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _harness(name: str, arg: Path) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / name), str(arg)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _case(h: dict, prefix: str) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def box() -> dict:
    return _harness("live_aboard_atmosphere_box.mjs", _VIEWS)


# ── the two settings ─────────────────────────────────────────────────────────

def test_the_two_settings_and_their_defaults() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_weather"] is True, "rain and snow: on (it follows Outdoor weather)"
    assert DEFAULT_SETTINGS["atlas_3d_showcase"] is False, "the Showcase look: off"
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"atlas_3d_weather", "atlas_3d_showcase"} <= keys
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    loop = src[src.index('for key in ("ha_entity_tracker_enabled"'):]
    loop = loop[:loop.index("):")]
    assert '"atlas_3d_weather"' in loop and '"atlas_3d_showcase"' in loop, "both are stored as bools"


def test_the_settings_round_trip() -> None:
    """Saved by any user (nothing leaves the house), stored as bools, echoed
    in the reply the box reads and read back by settings_get, which both
    Atlas hosts load."""
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    from tests.test_telemetry import _hass as _house_hass
    h, conn = _house_hass(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_weather": 0, "atlas_3d_showcase": 1}))
    assert not conn.send_error.called
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert data["atlas_3d_weather"] is False and data["atlas_3d_showcase"] is True
    reply = conn.send_result.call_args[0][1]["settings"]
    assert reply["atlas_3d_weather"] is False and reply["atlas_3d_showcase"] is True
    get = MagicMock()
    _run(WS.ws_settings_get(h, get, {"id": 2}))
    back = get.send_result.call_args[0][1]["settings"]
    assert back["atlas_3d_weather"] is False and back["atlas_3d_showcase"] is True
    _run(WS.ws_settings_set(h, conn, {"id": 3, "atlas_3d_weather": True}))
    assert data["atlas_3d_weather"] is True and data["atlas_3d_showcase"] is True, "each switches on its own"


def test_the_box_offers_each_row_saved_on_its_own(box) -> None:
    """Rain and snow (on unless switched off) says it follows Outdoor
    weather; the Showcase look is off unless switched on. Each saves alone,
    straight to the wire, shown only once the 3D house is on; a failed save
    puts the tick back."""
    _case(box, "box:")
    assert not box["failures"], json.dumps(box["failures"][:4], indent=2, ensure_ascii=False)
    src = (_VIEWS / "settings.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    sec = src[src.index("function _atlas3dSection("):src.index("// ── UI Structure tab")]
    assert 'tick("atlas_3d_weather", "Rain and snow", settings.atlas_3d_weather !== false,' in sec
    assert 'tick("atlas_3d_showcase", "Use the Atlas\'s Showcase look", settings.atlas_3d_showcase === true,' in sec
    assert 'ctx.actions.wsCall("padspan_ha/settings_set"' in sec and "settingsSet(" not in sec


# ── rain and snow (views/live_aboard_weather.js) ─────────────────────────────

@pytest.fixture(scope="module")
def wx() -> dict:
    return _harness("live_aboard_weather.mjs", _WWW)


@pytest.mark.parametrize("prefix", ["spawn:", "budget:", "layers:", "decision:", "dry:", "frames:", "still:", "release:"])
def test_the_weather_harness_covers_each_part(wx, prefix) -> None:
    """spawn: nothing ever falls inside an indoor room on any floor, decks
    catch what falls on them; budget: Low a few thousand at most; decision:
    the flat Atlas's own through holdVisual; dry: nothing built, no frame;
    frames: rain at most 30 a second on Low and 60 on High, snow 30, at 60,
    120 and 144 Hz; still: reduced motion draws once; release: it goes with
    the view."""
    _case(wx, prefix)


def test_every_weather_case_passes(wx) -> None:
    assert not wx["failures"], json.dumps(wx["failures"][:6], indent=2, ensure_ascii=False)


def _code(p: Path) -> str:
    """A file's code without its comments' prose (lines that are comments)."""
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def test_the_decision_is_the_flat_atlases_never_a_copy() -> None:
    """The same settings, the same decision and the same hold, imported from
    atlas_weather.js; none of its rules or words are written again here."""
    src = (_VIEWS / "live_aboard_weather.js").read_text(encoding="utf-8")
    code = _code(_VIEWS / "live_aboard_weather.js")
    assert "const AW = await import(`./atlas_weather.js${new URL(import.meta.url).search}`);" in src
    for use in ("AW.weatherSettingsFrom(", "AW.decideAtlasWeather(", "AW.holdVisual(", "AW.weatherColourOf(", "AW.seededRandom("):
        assert use in code, use
    for copy in ("pouring", "snowy", "rainy", "WET_CONDITIONS", "SNOW_AT_OR_BELOW", "env_canada", "warning", "HOLD_MS", "rainReading"):
        assert copy not in code, copy


def test_the_gpu_moves_every_particle() -> None:
    """Each layer's shader holds the clock; a frame hands over the time and
    the fades, never a particle (no per-particle work on the CPU per frame)."""
    src = (_VIEWS / "live_aboard_weather.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    for vs in ("const RAIN_VS = `", "const SNOW_VS = `", "const SPLASH_VS = `"):
        body = src[src.index(vs):]
        body = body[:body.index("}`;")]
        assert "uniform float uTime" in body and "fract(" in body, vs
    paint = src[src.index("  function paint(t){"):src.index("  return {\n    /** At each poll.")]
    for per_particle in ("aDrop", ".pos[", "spawnLayer(", "setXYZ(", ".n; i++"):
        assert per_particle not in paint, per_particle
    assert "u.uTime.value = time;" in paint and "u.uOpacity.value" in paint


def test_the_weather_module_stands_alone() -> None:
    """three.js is handed in (no import of its own), no timers (the view's
    live clock drives it), nothing sent to Home Assistant but the flat
    Atlas's own closed error words, and only the 3D view imports it, with
    its own .catch."""
    code = _code(_VIEWS / "live_aboard_weather.js")
    src = (_VIEWS / "live_aboard_weather.js").read_text(encoding="utf-8")
    assert "three.module" not in src and "import * as THREE" not in src
    for bad in ("setTimeout", "setInterval", "requestAnimationFrame", "callWS", "callService", "fetch(", "localStorage"):
        assert bad not in code, bad
    assert 'AW.countWeatherOnce("weather_error:decision", send)' in code and 'AW.countWeatherOnce("weather_error:mount", send)' in code
    want = "import(`./live_aboard_weather.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and want in p.read_text(encoding="utf-8"))
    assert importers == ["live_aboard.js"], importers
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    at = la.index(want)
    assert la[at:at + 200].count(".catch(") == 1, "an optional module: a failed load leaves the house as it was"


def test_the_view_draws_it_on_its_own_live_clock() -> None:
    """The view's existing live clock: the weather's frame interval joins
    liveRate, its clock is handed over where the view's own animations are
    played, the decision runs at each poll, and switching off lets it go."""
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    rate = la[la.index("  function liveRate(now){"):la.index("  /** The frame: the Atlas's clocks, played")]
    assert "const wxMs = wx ? wx.frameMs() : 0" in rate and rate.rstrip().endswith("return wxMs;\n  }")
    anim = la[la.index("  function animateLive(t){"):la.index("  // Readouts keep to a size you can read")]
    assert "if (wx) wx.tick(t);" in anim and anim.index("if (wx) wx.tick(t);") < anim.index("liveMs = liveRate(t);")
    upd = la[la.index("  function update(p){"):la.index("  function place(s){")]
    assert upd.rstrip().endswith("applyWeather(p);\n  }")
    td = la[la.index("  function teardown(){"):la.index("  function fail(kind){")]
    assert "if (wx) wx.dispose();" in td and td.index("if (wx) wx.dispose();") < td.index("{ renderer.dispose();")
    aw = la[la.index("  function applyWeather(p){"):la.index("  // ── the slot ──")]
    assert "p.weather3d !== false && p.weather && p.weather.settings" in aw, "off unless Rain and snow is on and the host hands it over"
    assert "catch (_)" in aw, "weather that cannot be drawn is simply not drawn: never the view's failure"


def test_both_hosts_hand_over_their_weather_inputs() -> None:
    """The sidebar Atlas and Mapping already build host.weather (settings,
    hass.states, hass.entities); the shared card passes it on to the 3D
    view with the Rain and snow switch, nothing more asked of Home
    Assistant."""
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert "weather: host.weather && host.weather.settings ? host.weather : null, weather3d: h3.settings.atlas_3d_weather," in lm
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    load = lp[lp.index("async _loadSettings("):lp.index("// ── Emergency lighting test")]
    for k in ("atlas_3d_weather", "atlas_3d_showcase"):
        assert f"{k}: s.{k}" in load, k
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    block = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    assert 'slot: "builder", settings: ctx.state.settings,' in block[:200], "Mapping hands over the whole settings payload"
