# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Every view actually renders, not merely parses.

`tests/test_frontend_parses.py` runs `node --check`, which proves a file is
syntactically valid. Four view modules shipped in a single week that were
syntactically valid and threw the moment they rendered:

    plan_viewer.js   `liveSnap` undeclared — a local of overview.js that did
                     not survive the extraction
    plan_viewer.js   bare `helpBtn()` — same cause
    panel.js         `_showRoomDetail` called `fmtAgo`, a local of
                     `_showObjectDetail`
    radio_map.js     `floorHeatmapSVG` read `_wpRssis`, a local of
                     `isoLevelHeatmapSVG`

Every one is a ReferenceError, and every one is invisible: `panel.js` loads
views with `.catch(console.warn)`, so a throwing view renders BLANK WITH A
CLEAN CONSOLE. Two of them were found by a user, one by an audit, and one only
after a fix had been "verified" four separate times.

The harness imports each view under a DOM shim and calls its entry points with
a context carrying a real three-floor building. It asserts nothing about the
output — a view that returns is fine, a view that throws is broken. Deferred
work (requestAnimationFrame, setTimeout) is flushed, because the `BL` bug lived
inside a deferred SVG build and would otherwise never have run.

Verified as a real guard: with `liveSnap` deleted again, `node --check` passes
and this fails with "plan_viewer.js:render2DMap -> liveSnap is not defined".

KNOWN GAP, stated rather than papered over. Only modules that export a view
entry point (`render`, `render2DMap`, `renderTags`) are called directly.
Helper-only modules — `radio_map.js`, `iso_lights.js`, `stack_transform.js`,
`room_color.js`, `light_codes.js` — are covered only as far as the views reach
into them. `radio_map.floorHeatmapSVG` in particular is a FALLBACK, taken only
when `modelFloorHeatmapSVG` returns nothing, so the `_wpRssis` bug in it is NOT
caught here: reintroducing that bug leaves this suite green. Those modules have
their own tests (`test_lights_renderer.py`, `test_metre_anchor_axes.py`,
`test_iso_building_registration.py`); extending this harness to call their
exports would mean inventing seven-argument signatures, and a guard that
reports its own noise is one people learn to ignore.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SMOKE = Path(__file__).parent / "js" / "render_smoke.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run() -> dict:
    res = subprocess.run(
        [_NODE, str(_SMOKE), str(_VIEWS)],
        capture_output=True, text=True, encoding="utf-8", timeout=180,
    )
    assert res.returncode == 0, (
        "the harness itself failed — this is a harness bug, not a view bug:\n"
        f"{res.stderr[-3000:]}"
    )
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"no result from the harness:\n{res.stdout[-2000:]}\n{res.stderr[-2000:]}"
    return json.loads(lines[-1])


@pytest.fixture(scope="module")
def smoke() -> dict:
    return _run()


def test_no_view_throws_while_rendering(smoke) -> None:
    """The whole point. A throwing view is a blank tab with a clean console."""
    if smoke["failures"]:
        detail = "\n".join(
            f"  {f['file']}:{f['fn']}\n"
            f"      {f['error']}\n"
            f"      {f.get('stack', '')}"
            for f in smoke["failures"]
        )
        pytest.fail(f"{len(smoke['failures'])} view(s) threw while rendering:\n{detail}")


def test_the_harness_actually_ran_the_views(smoke) -> None:
    """A guard that silently stops covering anything is worse than none.

    If a refactor renames the entry points or moves the directory, the run
    above would pass by testing nothing at all — so the count is asserted.
    """
    ran = smoke["ran"]
    assert len(ran) >= 20, f"only {len(ran)} entry points ran: {ran}"

    covered = {r.split(":")[0] for r in ran}
    # The views most likely to break, and the ones that actually did.
    for critical in ("overview.js", "plan_viewer.js", "maps.js", "health.js",
                     "settings.js", "calibration.js", "traceback.js"):
        assert critical in covered, f"{critical} was not exercised: {sorted(covered)}"


def test_every_view_module_is_reachable(smoke) -> None:
    """A module that fails to IMPORT reports as a failure named <import>.

    Worth calling out separately: an import failure is a SyntaxError or a bad
    top-level statement, which takes the module down before any entry point is
    reached — the duplicate `const _esc` that shipped in the plan_viewer
    extraction was exactly this.
    """
    imports = [f for f in smoke["failures"] if f["fn"] == "<import>"]
    assert not imports, "module(s) failed to import: " + ", ".join(
        f"{f['file']} ({f['error']})" for f in imports)
