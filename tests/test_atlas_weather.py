# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Atlas outdoor weather (docs/IDEA_ATLAS_WEATHER.md, views/atlas_weather.js).

tests/js/atlas_weather.mjs runs the module for real: every row of the
decision table and its fallbacks, warning auto-detect for each listed
integration, the mask built from a real buildIsoSVG drawing, the Showcase
byte-identical contract with the feature absent/off/on, the overlay's mount,
move and anchored animation, the free-tier still, and the once-per-page usage
words. The rest is held here: the five settings, their schema and
validation, the usage report's vocabulary (equal to the frontend's, closed,
never an id), the error attribution, the summary, and the wiring that keeps
a weather failure from ever blanking the Atlas.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from custom_components.padspan_ha.ws_settings import (
    _WEATHER_ENTITY_DOMAINS,
    _weather_entity,
    _weather_strength,
)

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "atlas_weather.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


# ── the module, run ──────────────────────────────────────────────────────────

def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)


@pytest.mark.parametrize("prefix,least", [
    ("table:", 11), ("fallback:", 3), ("no signal:", 3), ("warnings:", 5), ("mask:", 3),
    ("contract:", 1), ("overlay:", 9), ("errors:", 2), ("telemetry:", 1),
])
def test_the_harness_covers_each_part(harness, prefix, least) -> None:
    got = [k for k in harness["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    assert all(harness["cases"][k] for k in got), [k for k in got if not harness["cases"][k]]


# ── the usage report ─────────────────────────────────────────────────────────

def test_the_report_words_are_the_frontends(harness) -> None:
    """The frontend counts from its lists, the backend drops what is not on
    its own: the two must be the same words or counts vanish silently."""
    lists = harness["lists"]
    assert tuple(lists["errors"]) == T.WEATHER_ERROR_KINDS
    assert tuple(lists["shown"]) == T.WEATHER_SHOWN_STATES
    assert tuple(lists["sources"]) == T.WEATHER_SOURCES
    assert tuple(lists["platforms"]) == T.WEATHER_WARNING_PLATFORMS
    assert set(lists["events"]) == set(T.WEATHER_EVENTS)
    assert set(T.WEATHER_ERROR_KINDS) == {"mask_build", "mask_unsupported", "tiles", "decision", "mount", "source"}
    assert set(T.WEATHER_SHOWN_STATES) == {"light_rain", "heavy_rain", "light_snow", "heavy_snow", "still"}
    assert {"rain_sensor", "condition", "none", "warning:env_canada", "warning:meteoalarm",
            "warning:dwd_weather_warnings", "warning:nina", "warning:meteo_france",
            "warning:weatheralerts", "warning:nws_alerts", "warning:other"} == set(T.WEATHER_SOURCES)


def _hass(on: bool = True):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": on})}}
    return h


def test_only_the_weather_words_count_and_never_an_id_or_text() -> None:
    from custom_components.padspan_ha.const import DOMAIN
    h = _hass()
    for name in T.WEATHER_EVENTS:
        assert T.bump(h, name), name
        assert not re.search(r"[a-z_]{2,}\.[a-z0-9_]{2,}", name), f"{name} looks like an entity id"
        assert len(name) <= 64
    for bad in ("weather_error:", "weather_error:Nicole's Office", "weather_source:warning:binary_sensor.meteoalarm",
                "weather_source:binary_sensor.rain", "weather_shown:drizzle", "weather_source:warning:",
                "weather_shown:Rainfall Warning in effect", "weather_error:mask_build\n"):
        assert not T.bump(h, bad), bad
    counters = h.data[DOMAIN][T._DATA_COUNTERS]
    assert set(counters) == set(T.WEATHER_EVENTS)


def test_weather_counts_pass_the_shareable_gate() -> None:
    usage = {n: 1 for n in T.WEATHER_EVENTS}
    for key in usage:
        # telemetry.php's shapes (MAC, UUID, 32-hex, key, IP, email) and the
        # client's entity-id rule: none of the new keys may look like one.
        for rx in (T._MAC_RE, T._UUID_RE, T._HEX32_RE, T._KEY_RE, T._IPV4_RE, T._IPV6_RE, T._EMAIL_RE, T._ENTITY_RE):
            assert not rx.search(key), (key, rx.pattern)
    T.assert_shareable({"schema": 1, "install_id": "8f0d0f7e-2c8f-4c8a-9d1c-0f2c3d4e5f60", "usage": usage})


def test_nothing_is_counted_while_the_report_is_off() -> None:
    from custom_components.padspan_ha.const import DOMAIN
    h = _hass(on=False)
    assert not T.bump(h, "weather_shown:light_rain")
    assert T._DATA_COUNTERS not in h.data[DOMAIN]


def test_the_frontend_sends_only_while_the_report_is_on() -> None:
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    block = lp[lp.index("weather: this.state._weather ?"):]
    block = block[:block.index("} : null,")]
    assert "if(!this.state._telemetryOn || !this._hass) return;" in block
    assert 'type:"padspan_ha/telemetry_event"' in block
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert 'slot: "builder"' in maps and "ctx.actions.telemetryEvent(name)" in maps
    assert "weather: ctx.state.settings && ctx.state.settings.atlas_weather_enabled !== undefined ?" in maps


def test_an_uncaught_weather_throw_is_attributed_to_its_module() -> None:
    assert "atlas_weather" in T.UI_ERROR_HELPERS
    assert T.event_allowed("ui_error:atlas_weather")


def test_the_server_receiver_needs_nothing_new() -> None:
    """telemetry.php checks the shape of what arrives, never the names: the
    new keys must pass its patterns as they are."""
    path = _ROOT / "server" / "telemetry.php"
    if not path.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    php = path.read_text(encoding="utf-8")
    pats = re.findall(r"'(/.+?/i?)',", php[php.index("$shapes = array("):])
    assert len(pats) >= 6
    flat = json.dumps({"usage": {n: 3 for n in T.WEATHER_EVENTS}})
    for p in pats:
        body, flags = p[1:p.rindex("/")], p[p.rindex("/") + 1:]
        assert not re.search(body.replace("\\'", "'"), flat, re.I if "i" in flags else 0), p


def test_the_summary_has_an_atlas_weather_section(tmp_path) -> None:
    script = _ROOT / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    a = {"install_id": "11111111-1111-4111-8111-111111111111", "version": "0.38.91",
         "usage": {"weather_error:mask_unsupported": 1, "weather_shown:light_rain": 2,
                   "weather_source:condition": 2, "weather_source:warning:meteoalarm": 1, "tab:maps": 4}}
    b = {"install_id": "22222222-2222-4222-8222-222222222222", "version": "0.38.91",
         "usage": {"weather_shown:light_rain": 1, "weather_shown:still": 1, "weather_source:condition": 1}}
    day = date.today().isoformat()
    (tmp_path / f"{day}.jsonl").write_text("".join(json.dumps({"recv_day": day, "report": r}) + "\n" for r in (a, b)),
                                           encoding="utf-8")
    out = subprocess.run([sys.executable, str(script), str(tmp_path)], capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=60)
    assert out.returncode == 0, out.stderr
    s = out.stdout[out.stdout.index("Atlas weather (page loads; installs)"):].split("\n\n")[0]
    assert re.search(r"errors, per kind.*\n\s+mask_unsupported\s+1\s+1 installs", s), s
    assert re.search(r"light_rain\s+3\s+2 installs", s), s
    assert re.search(r"still\s+1\s+1 installs", s), s
    assert re.search(r"condition\s+3\s+2 installs", s), s
    assert re.search(r"warning:meteoalarm\s+1\s+1 installs", s), s
    usage_block = out.stdout[out.stdout.index("Usage (events"):out.stdout.index("Atlas weather")]
    assert "weather_" not in usage_block, "listed twice"
    # Nothing reported: the section says so rather than vanishing.
    (tmp_path / f"{day}.jsonl").write_text(json.dumps({"recv_day": day, "report": {**a, "usage": {"tab:maps": 1}}}) + "\n",
                                           encoding="utf-8")
    out = subprocess.run([sys.executable, str(script), str(tmp_path)], capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=60)
    assert "Atlas weather (page loads; installs)\n  none reported" in out.stdout


# ── settings ─────────────────────────────────────────────────────────────────

def test_the_five_settings_and_their_defaults() -> None:
    assert DEFAULT_SETTINGS["atlas_weather_enabled"] is True, "on by default: it only shows while it rains or snows"
    assert DEFAULT_SETTINGS["atlas_weather_rain_entity"] == ""
    assert DEFAULT_SETTINGS["atlas_weather_condition_entity"] == ""
    assert DEFAULT_SETTINGS["atlas_weather_warning_entity"] == ""
    assert DEFAULT_SETTINGS["atlas_weather_strength"] == 1.0


def test_the_wire_accepts_all_five() -> None:
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    for k in ("atlas_weather_enabled", "atlas_weather_rain_entity", "atlas_weather_condition_entity",
              "atlas_weather_warning_entity", "atlas_weather_strength"):
        assert k in keys, k
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    loop = src[src.index('for key in ("ha_entity_tracker_enabled"'):]
    assert '"atlas_weather_enabled"' in loop[:loop.index("):")], "the switch must be stored as a bool"
    assert "for _wkey, _wdoms in _WEATHER_ENTITY_DOMAINS.items():" in src
    assert 'payload["atlas_weather_strength"] = _weather_strength(msg["atlas_weather_strength"])' in src


def test_each_entity_setting_keeps_only_its_own_domains() -> None:
    rain, cond, warn = (_WEATHER_ENTITY_DOMAINS[k] for k in (
        "atlas_weather_rain_entity", "atlas_weather_condition_entity", "atlas_weather_warning_entity"))
    assert _weather_entity("binary_sensor.rain", rain) == "binary_sensor.rain"
    assert _weather_entity(" sensor.rain_rate ", rain) == "sensor.rain_rate"
    assert _weather_entity("weather.home", rain) == ""
    assert _weather_entity("weather.forecast_home", cond) == "weather.forecast_home"
    assert _weather_entity("sensor.temp", cond) == ""
    assert _weather_entity("binary_sensor.meteoalarm", warn) == "binary_sensor.meteoalarm"
    assert _weather_entity("light.kitchen", warn) == ""
    for bad in (None, "", "   ", 42, "Rain sensor", "sensor.", "sensor.x; drop", "SENSOR.Rain", "sensor.a.b"):
        assert _weather_entity(bad, rain) == "", bad


def test_strength_is_clamped_and_never_refused() -> None:
    assert _weather_strength(1) == 1.0
    assert _weather_strength(0.7) == 0.7
    assert _weather_strength(9) == 1.5
    assert _weather_strength(-2) == 0.5
    assert _weather_strength("1.25") == 1.25
    assert _weather_strength("loud") == 1.0
    assert _weather_strength(None) == 1.0
    assert _weather_strength(float("nan")) == 1.0


def test_the_atlas_reads_every_setting_and_waits_for_them() -> None:
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    load = lp[lp.index("async _loadSettings("):lp.index("// ── Emergency lighting test")]
    assert "if (s.atlas_weather_enabled !== undefined) {" in load, "a failed fetch must keep the last answer"
    for k in ("atlas_weather_enabled", "atlas_weather_rain_entity", "atlas_weather_condition_entity",
              "atlas_weather_warning_entity", "atlas_weather_strength"):
        assert f"{k}: s.{k}" in load, k


def test_the_settings_card_offers_each_setting_saved_on_its_own() -> None:
    src = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    sec = src[src.index("function _atlasWeatherSection("):src.index("// ── UI Structure tab")]
    for k in ("atlas_weather_enabled", "atlas_weather_rain_entity", "atlas_weather_condition_entity",
              "atlas_weather_warning_entity", "atlas_weather_strength"):
        assert f'"{k}"' in sec, k
    assert 'ctx.actions.wsCall("padspan_ha/settings_set"' in sec and "settingsSet(" not in sec
    assert 'eid.startsWith("weather.")' in sec and "/^(binary_sensor|sensor)\\./" in sec
    assert "lightsCard.appendChild(_atlasWeatherSection(ctx, el, settings));" in src
    # "Above 0 = wet" needs a sensor that means raining NOW: no running totals.
    assert "!accumulates(eid)" in sec and '["moisture", "precipitation_intensity"]' in sec
    assert 'dc(eid) === "precipitation"' in sec and "/^total/" in sec


# ── the Atlas can never be blanked by it ─────────────────────────────────────

def test_every_import_of_the_module_is_optional_and_cache_busted() -> None:
    """Views load behind .catch(): a module that throws at import is a blank
    Atlas. The weather module is imported with its own .catch, so a failure
    there costs the weather and nothing else."""
    want = "await import(`./atlas_weather.js${new URL(import.meta.url).search}`)\n  .catch("
    for name in ("lights_map.js", "settings.js"):
        src = (_VIEWS / name).read_text(encoding="utf-8")
        assert want in src, name
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert "const wxSlot = WX && host.weather && host.weather.settings ?" in lm
    assert "} catch (_) { /* attach counts its own failures; the map never sees one */ }" in lm
    # It imports nothing itself: nothing it depends on can take it down.
    wx = (_VIEWS / "atlas_weather.js").read_text(encoding="utf-8")
    assert not re.search(r"^\s*import\b|\bimport\s*\(", wx, re.M)


def test_the_renderer_is_untouched() -> None:
    """The Showcase byte-identical contract: the overlay lives outside the
    SVG, so iso_lights.js knows nothing about weather (the harness also
    compares the drawing with the feature absent, off and on)."""
    iso = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert "weather" not in iso.lower() and "lv-wx" not in iso


def test_the_overlay_is_quiet_by_css() -> None:
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    block = css[css.index("/* ── Atlas outdoor weather"):]
    block = block[:block.index("@media (prefers-reduced-motion:reduce){\n  .lv-wx") + 200]
    assert ".lv-wx{display:block;position:relative;z-index:0;" in block and "pointer-events:none" in block
    assert ".lv-wx.still,.lv-wx.still *{animation:none !important}" in block
    assert ".lv-wx.still .lv-wx-ripples{display:none !important}" in block
    assert "@media (prefers-reduced-motion:reduce)" in block
    # Transform-only motion; will-change only on the falling layers.
    frames = re.findall(r"@keyframes (lv-wx-[a-z]+)\{(.*?)\}\}?", block)
    assert {n for n, _ in frames} >= {"lv-wx-fall", "lv-wx-sway", "lv-wx-ripple", "lv-wx-in", "lv-wx-out", "lv-wx-wind"}
    for n, body in frames:
        props = set(re.findall(r"([a-z-]+):", body))
        assert props <= {"transform", "opacity"}, (n, props)
    assert block.count("will-change:transform") == 1 and ".lv-wx-layer{" in block[:block.index("will-change:transform")]
    assert ".lv-wx.still .lv-wx-layer{will-change:auto}" in block, "a still texture asks for no layers"
    assert "inset:" not in block, "older WebViews have no inset shorthand"
    # Below the emergency dial (z 6), the drawers (4) and the rail (5).
    assert int(re.search(r"\.lv-wx\{[^}]*z-index:(\d+)", block).group(1)) < 4
    wx = (_VIEWS / "atlas_weather.js").read_text(encoding="utf-8")
    assert "requestAnimationFrame" not in wx and "setInterval" not in wx and "setTimeout" not in wx
