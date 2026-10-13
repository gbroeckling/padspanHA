# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A panel left open through an update ran the old UI against the new
backend until someone reloaded it (a wall screen, for days). The panel
compares its build with the backend's on every full refresh."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_PANEL = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_NODE = shutil.which("node")


def _action(page, backend, kiosk, reloaded_for):
    if _NODE is None:
        pytest.skip("node is not installed")
    src = _PANEL.read_text(encoding="utf-8")
    fn = re.search(r"^function staleBuildAction\(.*?^}", src, re.S | re.M).group(0)
    js = fn + f"\nconsole.log(JSON.stringify(staleBuildAction({json.dumps(page)}, {json.dumps(backend)}, {json.dumps(kiosk)}, {json.dumps(reloaded_for)})));"
    res = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


OLD, NEW = "20261012T010000Z", "20261013T043232Z"


def test_same_build_or_no_backend_build_does_nothing():
    assert _action(NEW, NEW, True, "") is None
    assert _action(NEW, "", True, "") is None


def test_an_update_shows_and_a_kiosk_screen_reloads_once():
    assert _action(OLD, NEW, False, "") == {"newer": True, "reload": False}
    assert _action(OLD, NEW, True, "") == {"newer": True, "reload": True}
    assert _action(OLD, NEW, True, NEW) == {"newer": True, "reload": False}   # reloaded once already


def test_a_page_newer_than_the_backend_never_reloads():
    """Files updated by HACS before HA restarts: a reload loads the same
    new page, so reloading would loop."""
    assert _action(NEW, OLD, True, "") == {"newer": False, "reload": False}


def test_the_check_runs_on_every_full_refresh():
    s = _PANEL.read_text(encoding="utf-8")
    body = s[s.index("  async _refreshAll("):]
    body = body[:body.index("\n  }\n")]
    assert "this._checkBuild();" in body
    assert '<div id="staleBuild" class="stale-build hidden"></div>' in s
