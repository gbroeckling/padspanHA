# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What the click-through of every screen found and was fixed.

tools/ui_click_through presses every control of the panel on the demo build.
tests/js/click_through_fixes.mjs renders each fixed view with panel.js's own
el() under the DOM shim and gives it the answer that showed the fault:

- Radio QA's propagation card said "Loading propagation analysis..." for good
  when the answer had no grade (Sample mode's sample house has none) or the
  call failed.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "click_through_fixes.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-3000:]
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("qa propagation", 6)])
def test_fixed(run: dict, prefix: str, least: int) -> None:
    mine = {k: v for k, v in run.items() if k.startswith(prefix)}
    assert len(mine) >= least, sorted(run)
    bad = {k: v for k, v in mine.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=1, ensure_ascii=False)[:3000]
