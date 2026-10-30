# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Screens that repeated another screen, cleaned up (interface review, 2026-10-30).

  Monitor → Quick status   a line and Open Health (it was a partial copy of
                           Health); the tab id stays, so old links land on it
  Manage → History         a line and Open History → Movement (the same
                           movement log); the tab id stays
  Manage → Events          left as it is: it has the email/phone alerts editor
                           and the session's room changes, which the Events
                           screen doesn't
  Live Aboard wizard       real switches on the first setup (a run that began
                           with Live Aboard never switched on), afterwards
                           each setting's value and a link to its Settings tab
  Basic's links            no link switches to Advanced any more; each opens
                           just the part it is about (tests/test_basic_focus.py)

tests/js/cleanup_dupes.mjs renders each of them.
"""

from __future__ import annotations

import json
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
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "cleanup_dupes.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("prefix", ["monitor:", "manage:", "wizard:", "wizard (Basic):"])
def test_each_part_is_covered_and_passes(got, prefix) -> None:
    mine = {k: v for k, v in got.items() if k.startswith(prefix)}
    assert mine, (prefix, sorted(got))
    bad = {k: v for k, v in mine.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_the_old_duplicates_are_gone_from_the_source() -> None:
    mon = (WWW / "views" / "monitor.js").read_text(encoding="utf-8")
    assert '["health","Quick status"]' in mon, "the tab id stays"
    assert "padspan_ha/system_critics" not in mon and "_renderCriticsInline" not in mon
    man = (WWW / "views" / "manage.js").read_text(encoding="utf-8")
    assert '["history","History"]' in man and '["events","Events"]' in man
    assert "padspan_ha/movement_history_get" not in man and "_manageMovementLoaded" not in man
    assert "function _events(ctx, el){" in man and "_buildNotifications(ctx, el)" in man


def test_the_switch_to_advanced_workarounds_are_gone() -> None:
    for f in [WWW / "panel.js", *(WWW / "views").glob("*.js")]:
        src = f.read_text(encoding="utf-8")
        assert 'etComplexity("advanced")' not in src, f.name
        assert "switched to Advanced" not in src, f.name
    links = {
        "views/maps.js": "ctx.state._mapsWizard = { step: 2, mapId };",
        "views/rooms.js": 'FOCUS.openFocus(ctx, FOCUS.part("roomOutline"',
        "views/receivers.js": 'FOCUS.openFocus(ctx, FOCUS.part("receiverPlace"',
        "panel.js": 'F.openFocus(this._ctx(), F.part("floorHeights"))',
        "views/calibration_results.js": 'FOCUS.openFocus(ctx, FOCUS.part("floorHeights"))',
        "views/setup.js": 'FOCUS.openFocus(ctx, FOCUS.part("floorHeights"',
    }
    for rel, needle in links.items():
        assert needle in (WWW / rel).read_text(encoding="utf-8"), rel
