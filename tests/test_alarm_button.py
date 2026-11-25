# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The house's alarm on the emergency button (views/alarm_panel.js), RUN (tests/js/alarm_button.mjs).

2026-11-23, the owner: "add the alarm control to the emergency button in the
top right". Bright and Pro (his choice, 2026-11-24) arm and disarm from it;
an alarm going off is a safety alert, so it shows on every tier, in the red
emergency banner on every tab. Every arm and disarm asks first, with the
panel's code when it wants one. The panel itself, booted, is in
tests/test_lights_panel_lifecycle.py (test_the_alarm_on_the_emergency_button).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "alarm_button.mjs"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run():
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["modes", "no-code", "code", "refused", "tripped", "chip", "banner", "german"])
def test_alarm_button(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_counts_are_a_closed_list_and_carry_no_name():
    want = {"alarm_button:shown", "alarm_button:arm", "alarm_button:disarm", "alarm_button:refused"}
    assert want == T.ALARM_BUTTON_EVENTS and all(T.event_allowed(e) for e in want)
    assert not T.event_allowed("alarm_button:alarm_control_panel.house") and not T.event_allowed("alarm_button:1234")
    panel = _src("lights_panel.js")
    assert 'event:"alarm_button:" + word' in panel and 'this._alarmCount("shown")' in panel
    card = _src("views/alarm_panel.js")
    assert {w for w in ("arm", "disarm", "refused") if f'host.count("{w}")' in card or f'"{w}"' in card} == {"arm", "disarm", "refused"}
    assert 'host.count(arming ? "arm" : "disarm")' in card and 'host.count("refused")' in card


def test_the_controls_are_bright_or_pro_and_the_banner_every_tier():
    panel = _src("lights_panel.js")
    assert '_alarmControls(){ return ["bright","pro"].includes(String(this.state._tier||"").toLowerCase()); }' in panel
    assert "if(this._alarmCard || !ALARM || !this._alarmControls()) return;" in panel
    shell = _src("panel.js")
    banner = shell[shell.index("  _updateEmergencyBanner(){"):shell.index("  // ── Navigation & View Routing")]
    assert "ALARM.triggeredAlarms(" in banner and "tier" not in banner


def test_an_unlock_and_an_alarm_ask_in_one_box():
    """One question box (lights_map.js confirmAsk): an unlock asks there, and so does every arm and disarm."""
    lm = _src("views/lights_map.js")
    assert 'return confirmAsk(t("Unlock {name}?", { name }), t("Unlock"));' in lm
    assert "ask: confirmAsk," in _src("lights_panel.js")
    assert ".callService(" not in _src("views/alarm_panel.js")   # it calls through its host, as the lock does through toggleEntity
