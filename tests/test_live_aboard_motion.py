# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Motion in Live Aboard, in all its glory (views/live_aboard_motion.js).

tests/js/live_aboard_motion.mjs runs the module for real, inside the view
(views/live_aboard.js) under the DOM shim with a stub GL: a new trigger rings
once across its room's own floor, rate-limited, then the view rests; the room
glows in the Atlas's colours at each of its steps, fainter as it ages, gone at
six hours; a restart's restored timestamp is quiet; an occupancy or presence
sensor holds its room steady with no frames, then hands over to the steps; a
motion + occupancy pair is one sensor; the marker is a tap target that opens
the activity calendar through the use api; coverage is aimed by rotation or at
the room's middle, its reach from a range setting, shown only on a trigger's
flash, hovered, or under the motion lens; no reading and stuck on read as
neither "clear" nor "motion"; the Motion chip lists the newest rooms and flies
there; an outside sensor rings on the ground or not at all.

Held here: the module reads the Atlas's own rules (it never copies the colours
or the timing), is imported by the view alone, runs no clock of its own, and
says nothing in its own words that calls the view "3D".
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def motion() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_motion.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("ring:", 3), ("glow:", 3), ("boot:", 1), ("presence:", 2), ("pair:", 2), ("marker:", 2), ("cover:", 2),
    ("health:", 1), ("chip:", 2), ("outside:", 1), ("frames:", 1),
])
def test_the_motion_harness_covers_each_part(motion, prefix, least) -> None:
    got = [k for k in motion["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in motion["failures"] if f["name"].startswith(prefix)]
    assert all(motion["cases"][k] for k in got) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)[:3000]


def test_every_motion_case_passes(motion) -> None:
    assert not motion["failures"], json.dumps(motion["failures"][:4], indent=2, ensure_ascii=False)[:4000]


def _code(p: Path) -> str:
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def test_the_atlas_rules_are_read_never_copied() -> None:
    """Garry's motion language stays the Atlas's: the colours, the hold, the
    steps and the boot rule come from live_aboard_house.js (itself held to
    iso_lights.js by test_live_aboard_live.py), the pairs from lights_map.js,
    stuck on from light_codes.js."""
    src = _code(_VIEWS / "live_aboard_motion.js")
    for want in ("HOUSE.motionLook(", "HOUSE.MOTION_COLOR_STOPS", "HOUSE.motionFill(", "HOUSE.motionColor(",
                 "HOUSE.MOTION_BOOT_GRACE_MS", "computeMotionOccupancyPairs(", "healthOf(", "deviceClassOf("):
        assert want in src, want
    # No colour step, hold or recent window of its own.
    assert not re.search(r"hsl\(", src)
    for bad in ("60 * 1000", "3600000 * 6", "MOTION_HOLD_MS =", "MOTION_RECENT_MS =", "#3b82f6"):
        assert bad not in src, bad


def test_imported_by_the_view_alone_with_its_own_catch() -> None:
    want = "import(`./live_aboard_motion.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and want in p.read_text(encoding="utf-8"))
    assert importers == ["live_aboard.js"], importers
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    at = la.index(want)
    assert ".catch(" in la[at:at + 200]


def test_no_clock_of_its_own_and_no_reads_of_home_assistant() -> None:
    """Only the view's capped clock moves it; it reads the states the host passes."""
    src = _code(_VIEWS / "live_aboard_motion.js")
    for bad in ("setInterval(", "setTimeout(", "requestAnimationFrame(", "callWS(", "callService(", "subscribe", "fetch("):
        assert bad not in src, bad


def test_its_words_never_call_the_view_3d() -> None:
    src = _code(_VIEWS / "live_aboard_motion.js")
    for s in re.findall(r'"([^"\n]*)"|`([^`\n]*)`', src):
        text = s[0] or s[1]
        assert not re.search(r"\b3D\b", text), text
