# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1: the 3D view over its life, under the DOM shim.

tests/js/live_aboard_view.mjs runs views/live_aboard.js for real with a stub
GL (tests/js/stub_gl.mjs): three.js's own renderer, the view's own frames and
teardown. Switched off, nothing of the view is kept, over any number of
off/on cycles. At rest it asks for no frame at all: full rate only while
something has just started moving (a pulse's first seconds, a door
swinging), a lock left unlocked on a timer about twice a second, and the rest
(a pulse after its start, a room breathing after motion, the air's bars)
drawn still. The browser checks (a real GPU, forced garbage collection, the
heap and DOM counters) run outside the suite, in headless Chromium.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def view() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_view.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("release:", 2), ("frames:", 4), ("fps:", 3), ("gap:", 1)])
def test_the_view_harness_covers_each_part(view, prefix, least) -> None:
    got = [k for k in view["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in view["failures"] if f["name"].startswith(prefix)]
    assert all(view["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_view_case_passes(view) -> None:
    assert not view["failures"], json.dumps(view["failures"][:6], indent=2, ensure_ascii=False)


def test_switching_off_lets_go_of_the_sprites_geometry_and_the_host() -> None:
    """three.js hangs a listener on the one geometry all sprites share for
    every renderer that draws one; renderer.dispose() never takes it off.
    The teardown disposes it before the renderer, then lets go of the host's
    card, data and callbacks."""
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    td = la[la.index("  function teardown(){"):la.index("  function fail(kind){")]
    assert td.index("o.isSprite && o.geometry) o.geometry.dispose()") < td.index("{ renderer.dispose();")
    for name in ("lastP", "apiOf", "apiNow", "stage", "send", "touchCb", "saveNorthCb"):
        assert f"{name} = null" in td, name


def test_the_harness_clock_moves_only_when_a_case_moves_it() -> None:
    """The frames' times are the harness's own (later() moves them), never the
    machine's: on the real clock a machine busy with the whole suite put its
    own delay between two frames, the view's frame-time check read a slow
    screen (live_aboard_house.js SLOW_MS) and fell back to the flat Atlas
    mid-case (2026-11-22: fps "back to the flat Atlas" failed under load only)."""
    src = (Path(__file__).parent / "js" / "live_aboard_view.mjs").read_text(encoding="utf-8")
    assert "performance.now = () => clockAt + clockOff;" in src
    assert "realNow" not in src


def test_every_harness_that_times_frames_owns_its_clock() -> None:
    """The same, for every harness that hands its frames performance.now():
    the weather, screen and covered-patio harnesses still read the machine's
    clock (2026-11-25: "dry: the view at rest", the covered patio's taps and
    the screen cases failed under -n auto only, the view fallen back to the
    flat Atlas)."""
    import re
    js = Path(__file__).parent / "js"
    timed = [p for p in sorted(js.glob("*.mjs")) if "fn(performance.now())" in p.read_text(encoding="utf-8")]
    assert len(timed) >= 16, [p.name for p in timed]
    for p in timed:
        src = p.read_text(encoding="utf-8")
        line = re.search(r"^performance\.now = \(\) => (clockAt|clock0)( \+ clockOff)?;$", src, re.M)
        assert line, f"{p.name}: the frames' clock is not the harness's own"
        assert re.search(rf"^const {line.group(1)} = performance\.now\(\)", src, re.M), p.name
