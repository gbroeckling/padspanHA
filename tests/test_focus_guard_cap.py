# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""_renderCurrentView's focused-field guard (panel.js), RUN rather than read.

Review round 5, 2026-09-23: a poll render skipped for a focused field used to
stamp _lastGoodRender with no limit, so a field left focused on an idle wall
screen kept the live view frozen for good (the watchdog never saw a stall).
The stamp now needs someone to have used the page in the last 2 minutes.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PANEL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_SCRIPT = Path(__file__).parent / "js" / "focus_guard_cap.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def test_an_idle_focused_field_no_longer_hides_a_stall():
    r = subprocess.run([_NODE, str(_SCRIPT), str(_PANEL)],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.count("ok   ") == 3, r.stdout
