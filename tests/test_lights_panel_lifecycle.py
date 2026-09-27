# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas sidebar panel, RUN as the custom element it is.

docs/PHASE2_STRATEGIC_REVIEW.md gap 4.2 (as corrected): tests/js/render_smoke.mjs
calls every view's render(ctx), but lights_panel.js is not a view — it is a
stateful customElement with a lifecycle (constructor → hass setter → _boot →
connectedCallback → _render → _poll), and nothing ever instantiated it. A
ReferenceError anywhere on that path — an import that lost a name in a
refactor is all it takes — shipped as a blank sidebar panel with a green
suite. tests/js/lights_panel_lifecycle.mjs boots the real module against a
fake hass across tiers and presentation modes, clicks every row and button,
and drives every entity through the panel's own toggle path.

Skipped (not failed) when node is unavailable.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "lights_panel_lifecycle.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def result() -> dict:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True,
                         encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_the_panel_boots_renders_and_polls_in_every_scenario(result) -> None:
    assert not result["failures"], json.dumps(result["failures"][:6], indent=2)


def test_the_harness_actually_drew_the_house(result) -> None:
    assert len(result["scenarios"]) >= 6, result["scenarios"]
    for s in result["scenarios"]:
        assert s["svg"], f"{s['name']}: no isometric map was drawn"
        assert s["rows"] >= 19, f"{s['name']}: the index lost rows ({s['rows']})"
        assert s["svcCalls"] > 0, f"{s['name']}: no toggle ever reached hass.callService — the harness is not exercising the action path"


def test_a_motion_sensor_back_from_a_blip_redraws_quiet(result) -> None:
    """Live 2026-09-27: a sensor back "off" from a 29 s offline blip pulsed,
    then wore the 6-hour ring. The sidebar subscribes to
    padspan_ha/motion_reconnects itself, and the push redraws it quiet."""
    b = result["blip"]
    assert b["subscribed"] == {"type": "padspan_ha/motion_reconnects"}, b
    assert b["pulseBefore"], f"the harness must first show the false pulse: {b}"
    assert not b["pulseAfter"] and not b["ringAfter"], b
