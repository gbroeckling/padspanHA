# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Quiet mode: a panel-only filter that hides untagged Bluetooth devices.

The radio map keeps the house's own devices even when 30 louder strangers
outrank them (the filter runs before the 24-a-scanner cut, so no gaps); the
Overview counts labelled, identified and followed objects as the other views
do; Bluetooth, Objects and Monitor say how many quiet mode hides. With quiet
mode off (most houses) none of that shows: the 24 strongest, the full total.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

NOTE = re.compile(r"(\d+) hidden \(quiet mode\)")


@pytest.fixture(scope="module")
def drawn():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "quiet_mode.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    for q in out.values():
        for name, html in q.items():
            assert not html.startswith("THREW"), (name, html[:1500])
    return out


def _device_rows(svg_text: str) -> list[int]:
    return [int(y) for y in re.findall(r'<circle cx="\d+" cy="(\d+)" r="5" class="bt-viz-node device', svg_text)]


def test_quiet_off_shows_everything_and_no_note(drawn):
    off = drawn["off"]
    for name, html in off.items():
        assert not NOTE.search(html), name
    # The radio map: the scanner's 24 strongest, the house's own quieter three not among them.
    assert len(_device_rows(off["map"])) == 24
    assert not any(n in off["map"] for n in ("Keys (", "Watch (", "Dog ("))
    assert re.search(r"8\s*Objects", off["overview"])          # summary.total


def test_quiet_on_radio_map_keeps_tracked_devices_past_24_without_gaps(drawn):
    m = drawn["on"]["map"]
    assert all(n in m for n in ("Keys (-90)", "Watch (-91)", "Dog (-92)"))  # labelled, identified, followed
    rows = _device_rows(m)
    assert len(rows) == 3 and [b - a for a, b in zip(rows, rows[1:])] == [16, 16], rows


def test_quiet_on_counts_and_hidden_notes(drawn):
    on = drawn["on"]
    # Overview: labelled + identified + followed (summary.identified alone said 1).
    assert re.search(r"3\s*Objects", on["overview"])
    # 30 strangers on the air; 5 of them in the object list.
    assert NOTE.search(on["scanner"]).group(1) == "30"
    assert NOTE.search(on["adverts"]).group(1) == "30"
    for view in ("objects", "objectsAdv", "monitor"):
        assert NOTE.search(on[view]).group(1) == "5", view


def test_settings_says_quiet_mode_is_display_only(drawn):
    assert "It only changes what this panel shows, not how much work Home Assistant or PadSpan does." in drawn["off"]["settings"]
