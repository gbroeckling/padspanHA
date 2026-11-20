# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Listeners on window do not pile up as a view redraws.

Mapping → Edit rebuilds its receiver markers on every redraw, and each one is
draggable; the pan/zoom shared by Mapping → Rooms and Calibration's maps is
attached again on every redraw. Both listen on window for the mouse or finger
leaving the element. tests/js/window_listeners.mjs counts what window holds
while it redraws the shipped views: a marker's listeners are there only while
it is held, and a pan/zoom replaced by a redraw gives its listeners up. The
drag, the tap, the pan and the hand cursor behave as before.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_window_listeners_do_not_grow_across_redraws() -> None:
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "window_listeners.mjs"), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])
    assert len(got) >= 20, got
    bad = {k: v for k, v in got.items() if not v["ok"]}
    assert not bad, bad


def test_every_pan_zoom_caller_names_its_slot() -> None:
    """A caller with no slot keeps its window listeners for good, one pair per redraw."""
    slots = []
    for name in ("calibration.js", "maps.js"):
        src = (_VIEWS / name).read_text(encoding="utf-8")
        calls = re.findall(r"attachPanZoom\(.*", src)
        assert calls, name
        for c in calls:
            m = re.search(r'slot: "([a-z-]+)"', c)
            assert m, (name, c)
            slots.append(m.group(1))
    assert len(slots) == 4 and len(set(slots)) == 4, slots
