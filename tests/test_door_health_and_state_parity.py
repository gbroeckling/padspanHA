# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Door/window Light-Index parity with every other status-only class.

Garry, 2026-09-10: "do 2-10" (from a missing-features shortlist) — #6: every
other status-only class (motion, temp, lock) already had a stuck-state
health check and a read-only, non-clickable state badge; isDoor had neither
— a raw ON/OFF label that reads like a switch, and a dead toggle button in
room/floor aggregate sheets that does nothing but surface a read-only toast.

Runs the real modules under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const LC = await import(pathToFileURL({json.dumps(str(_VIEWS / 'light_codes.js'))}).href);\n"
        "const out={};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=30, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_a_door_left_open_past_the_threshold_is_unhealthy():
    out = _run("""
const now = new Date('2026-09-10T12:00:00Z').getTime();
const changed = new Date('2026-09-10T02:00:00Z').toISOString();  // 10h ago
const r = LC.healthOf({ isDoor: true, state: 'on', last_changed: changed }, now);
out.healthy = r.healthy; out.reason = r.reason;
""")
    assert out["healthy"] is False
    assert "Open" in out["reason"] and "10h" in out["reason"]


def test_a_door_open_briefly_is_healthy():
    out = _run("""
const now = new Date('2026-09-10T12:00:00Z').getTime();
const changed = new Date('2026-09-10T11:55:00Z').toISOString();  // 5 min ago
const r = LC.healthOf({ isDoor: true, state: 'on', last_changed: changed }, now);
out.healthy = r.healthy;
""")
    assert out["healthy"] is True


def test_a_closed_door_is_healthy_regardless_of_how_long():
    out = _run("""
const now = new Date('2026-09-10T12:00:00Z').getTime();
const changed = new Date('2020-01-01T00:00:00Z').toISOString();  // years ago
const r = LC.healthOf({ isDoor: true, state: 'off', last_changed: changed }, now);
out.healthy = r.healthy;
""")
    assert out["healthy"] is True


def test_door_reuses_the_same_stuck_threshold_motion_uses_not_a_new_number():
    """Both must flip unhealthy at the identical elapsed time — a real
    threshold shared on purpose, not two numbers that happen to match today
    and drift apart later."""
    out = _run("""
const now = new Date('2026-09-10T12:00:00Z').getTime();
const justUnder = new Date(now - (6*60*60*1000 - 60000)).toISOString();
const justOver = new Date(now - (6*60*60*1000 + 60000)).toISOString();
out.doorUnder = LC.healthOf({ isDoor: true, state: 'on', last_changed: justUnder }, now).healthy;
out.doorOver = LC.healthOf({ isDoor: true, state: 'on', last_changed: justOver }, now).healthy;
out.motionUnder = LC.healthOf({ isMotion: true, state: 'on', last_changed: justUnder }, now).healthy;
out.motionOver = LC.healthOf({ isMotion: true, state: 'on', last_changed: justOver }, now).healthy;
""")
    assert out["doorUnder"] is True and out["motionUnder"] is True
    assert out["doorOver"] is False and out["motionOver"] is False


def test_the_light_index_state_column_shows_open_closed_not_on_off():
    s = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert 'l.isDoor\n        ? el("span", { class: `lv-state ${on ? "on" : "off"}` }, on ? "OPEN" : "CLOSED")' in s


def test_aggregate_sheet_gives_doors_a_readonly_badge_not_a_dead_toggle_button():
    s = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    fn = s[s.index("export function openAggregateSheet("):]
    fn = fn[:fn.index("\n}\n")]
    assert 'l.isDoor' in fn
    i = fn.index("} else if (l.isDoor) {")
    branch = fn[i:i + 400]
    assert '"OPEN"' in branch and '"CLOSED"' in branch
    assert "api.toggle" not in branch, "a door row must never wire the generic toggle button"
