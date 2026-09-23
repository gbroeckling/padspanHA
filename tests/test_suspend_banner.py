# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Overview's suspend banner goes away after "Resume Normal" (panel.js),
RUN rather than read — see tests/js/suspend_banner.mjs."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PANEL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_SCRIPT = Path(__file__).parent / "js" / "suspend_banner.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def test_a_rebuild_skipped_by_the_click_still_happens_on_a_later_poll():
    r = subprocess.run([_NODE, str(_SCRIPT), str(_PANEL)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
