# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Live Aboard setup wizard (views/aboard_wizard.js, Pro).

On a house shaped like the developer's (one floor without a height, nothing
with its own height, 7 door/window sensors with 2 linked, valances not laid
out, no furniture) it opens on the first step that isn't done, says what it
found in each, renders and steps through all ten, and offers the Atlas as
Overview switch (off unless chosen). Free installs are told it's Pro.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


def test_the_wizard_surveys_the_house_and_walks_every_step():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "aboard_wizard.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["steps"] == ["on", "floors", "rooms", "devices", "heights", "openings", "strips", "furniture", "extras", "screen"]
    assert out["done"] == {"on": True, "floors": False, "rooms": True, "devices": True, "heights": False,
                           "openings": False, "strips": False, "furniture": False, "extras": True, "screen": False}
    assert out["floors"] == ["basement", "main", "upper"]          # Outside is not a storey
    assert out["floorsLine"] == "Upper has no height yet (2.8 m is used)."
    assert out["openingsLine"].startswith("2 of 7 door and window sensors")
    assert out["stripsLine"] == "0 of 2 lights that look like strips are laid out."
    assert out["freeOn"] == "Live Aboard comes with PadSpan Pro."
    assert out["firstStep"] == 1                                   # the first step not done
    assert out["allRendered"] and out["finish"] and out["overviewMentioned"]
    assert out["events"] == ["wizard_la_opened"]
