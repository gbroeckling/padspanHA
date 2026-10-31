# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Five bugs found while auditing the help (2026-10-31).

  events    Manage → Events' room log read state.followHistory, which nothing
            writes (Follow moved onto the server's movement history), so it
            was always empty: now a line and Open History → Movement
  health    Health → Live Discovery "Radios" read only the top-level radios,
            which the sample house's snapshot lacks: Sample showed 0
  diag      Diagnostics counted the snapshot's top-level keys as devices
  offset    Bluetooth → Scanners' RSSI offset took ±30 where every other
            screen takes ±20; a stored value outside ±20 is kept as it is
  compare   Compare Maps threw on a visible plan with rooms but no placement

tests/js/help_found_bugs.mjs renders each of them.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


@pytest.fixture(scope="module")
def got() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "help_found_bugs.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("prefix", ["events:", "health:", "diag:", "offset:", "compare:"])
def test_each_bug_is_covered_and_fixed(got, prefix) -> None:
    mine = {k: v for k, v in got.items() if k.startswith(prefix)}
    assert mine, (prefix, sorted(got))
    bad = {k: v for k, v in mine.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_nothing_reads_the_unwritten_follow_history() -> None:
    for f in [WWW / "panel.js", *(WWW / "views").glob("*.js")]:
        assert "followHistory" not in re.sub(r"//.*", "", f.read_text(encoding="utf-8")), f.name


def test_the_help_says_what_manage_events_has() -> None:
    help_src = (WWW / "help_content.js").read_text(encoding="utf-8")
    block = help_src[help_src.index("  manage_events: {"):help_src.index("  manage_logs: {")]
    assert "this session" not in block and "clears when you reload" not in block
    assert "Open History" in block and "History → Movement" in block
    assert "this session's room" not in help_src
