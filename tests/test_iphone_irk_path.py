# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The iPhone setup path (GitHub #69).

iPhone owners looked for "BLE Transmitter", which only the Android Companion
App has. With Settings → Features → iPhone Setup Path (iphone_irk_guide, off
by default) an iPhone gets the IRK steps instead: get the key, add it with
Private BLE Device, check it resolves. Off, every screen reads as before, and
the Android path never changes either way.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_VIEWS = _PKG / "www" / "padspan-ha" / "views"


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_off_by_default_and_wired_through_settings():
    assert DEFAULT_SETTINGS["iphone_irk_guide"] is False
    ws = _src(_PKG / "ws_settings.py")
    assert 'vol.Optional("iphone_irk_guide"): bool,' in ws
    assert '"phone_wizard_enabled", "iphone_irk_guide", "mac_rotation_bridging",' in ws
    assert 'key: "iphone_irk_guide",' in _src(_VIEWS / "settings.js")
    # Only ON when it is literally true.
    assert "settings.iphone_irk_guide === true" in _src(_VIEWS / "iphone_irk.js")


def test_nothing_new_in_the_report():
    assert "iphone_irk_guide" not in T._FEATURE_FLAGS
    assert "iphone_irk" in T.UI_ERROR_HELPERS


def test_overview_falls_back_to_todays_text_when_off():
    js = _src(_VIEWS / "overview.js")
    # Every new branch asks the setting first; the old text is still there.
    assert js.count("iphoneGuideOn(ctx.state.settings)") == 6
    assert js.count('"No phones detected. Enable the HA Companion App with BLE Transmitter."') == 2
    assert js.count("3. Find 'BLE Transmitter' and enable it") == 2
    assert '"BLE Transmitter sensor not enabled in Companion App"' in js
    assert '+ "BLE Transmitter sensor not enabled";' in js
    assert '"Phones running the HA Companion App with BLE Transmitter. Click to track."' in js
    assert "Not seeing your phone? Open Companion App" in js
    assert 'phone.state === "sensor_not_registered" && iphoneGuideOn(ctx.state.settings) && isApplePhone(phone)' in js


def test_iphone_path_renders_and_android_path_does_not_move():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(_ROOT / "tests" / "js" / "iphone_irk.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out == {
        "offSame": True, "noWizSame": True, "noWizHasNoWizard": True,
        "androidSame": True, "androidSaysTransmitter": True, "todayIphoneOld": True,
        "iphoneNoTransmitter": True, "iphoneSteps": True, "detected": True, "checked": True,
        "onlyGuideShowsPath": True, "alertNoTransmitter": True,
        "apple": [True, True, True, True, False, False, False],
        "guide": [True, False, False, False],
    }, out
