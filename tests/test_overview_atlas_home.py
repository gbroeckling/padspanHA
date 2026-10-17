# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Settings → UI Structure → "Show the Atlas as Overview" (Pro, 0.38.137).

Overview shows the sidebar's own Atlas page (<padspan-lights-app>), one
element kept across redraws (a new one per redraw would reload the map and
restart its poll), and leaves the panel's dot updates alone. Pure Live gets a
switch between itself and the classic Overview. Free and Bright don't get it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


def test_the_atlas_is_overview_for_pro_and_pure_live_switches():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "overview_atlas_home.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out == {"proOn": True, "freeOn": False, "proOff": False, "bright": False,
                   "atlasTag": "padspan-lights-app", "sameElement": True, "noDots": True,
                   "classicAfter": True, "liveAfter": True, "renders": 2,
                   "events": ["live_switch_classic", "live_switch_purelive"]}, out


def test_the_setting_is_saved_and_defaults_off():
    from custom_components.padspan_ha import settings_store as ss
    assert ss.DEFAULT_SETTINGS["overview_atlas"] is False
    src = (Path(__file__).resolve().parents[1] / "custom_components/padspan_ha/ws_settings.py").read_text(encoding="utf-8")
    assert src.count('"overview_atlas"') >= 2      # schema and the save allowlist
