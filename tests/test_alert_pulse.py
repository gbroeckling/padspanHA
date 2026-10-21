# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Alert pulse (Settings → UI Structure → Atlas), off by default.

On, a door left open for hours (the health check's "left open") or a window
or cover open while it rains (the Atlas's own weather decision) rings its
room in amber, the leak ring's own drawing; leak, smoke, gas and CO keep the
red rings they already had. On a wall screen (?kiosk=1) a banner names the
worst alert and where ("Leak · Laundry") until it clears. Off, the Atlas is
byte-identical.

tests/js/alert_pulse.mjs runs the modules for real; the wiring is held here.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "alert_pulse.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 10


def test_the_setting_is_off_by_default_and_accepted() -> None:
    assert DEFAULT_SETTINGS["atlas_alert_pulse"] is False
    ws = (_PKG / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("atlas_alert_pulse"): bool' in ws
    assert '"atlas_weather_enabled", "atlas_alert_pulse",' in ws


def test_settings_offers_it_under_the_atlas() -> None:
    js = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    assert 'pulseCb.checked = settings.atlas_alert_pulse === true;' in js
    assert '"Alert pulse"' in js
    assert 'wsCall("padspan_ha/settings_set", { atlas_alert_pulse: want })' in js


def test_both_atlas_hosts_ask_only_when_it_is_on() -> None:
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "this.state._alertPulse = s.atlas_alert_pulse === true;" in lp
    assert "...(this.state._alertPulse ? { alertPulse: true } : {})," in lp
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert "...(ctx.state.settings && ctx.state.settings.atlas_alert_pulse === true ? { alertPulse: true } : {})," in maps
    lm = (_WWW / "views" / "lights_map.js").read_text(encoding="utf-8")
    assert "let alerts = null, alertOpenings = null;\n  if (host.alertPulse) {" in lm


def test_the_banner_breathes_in_css_and_rests_for_reduced_motion() -> None:
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    assert ".lv-alertbar{" in css and "animation:lv-alert-breathe" in css
    assert "@media (prefers-reduced-motion:reduce){.lv-alertbar{animation:none}}" in css
