# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Bluetooth → Scanners → "Find the one in your hand".

Ben Hines (2026-10-13): tagging a device you're holding is unworkable among
2,000. Press Start away from a receiver, hold the device against it, and what
got louder there comes up with a Tag button. Also checks the receiver shows
under its one display_name.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


def test_hold_near_ranks_what_got_louder_and_offers_tag():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "bt_hold_near.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    # A new address counts from -100; a 2-3 dB wobble or a weak one never shows.
    assert out == {"quiet": [["DD", -30, True], ["AA", -24, False]], "quietIdle": True, "quietLive": True,
                   "louderDefault": True,
                   "rank": [["DD", 45, True], ["AA", 32, False]], "idleStart": True, "liveJump": True,
                   "liveOnlyHeld": True, "tagBtn": True, "oneName": True}, out
