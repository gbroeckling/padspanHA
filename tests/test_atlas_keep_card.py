# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The sidebar Atlas keeps its lights index on screen between polls.

Every poll builds the sidebar's page afresh, and the index under the map was
most of it: a row per device, all laid out again every 5 seconds. Now the
table card stays (lights_map.js buildLightsTable with host.keepTable): a row
is built again only when its device or its state word changed, the header
only when its counts did, and anything else the table reads from the host (a
filter, the sort, hidden lights, another map, a setting) builds a new card,
as before. The result is always what a new card makes. On the poll's update a
row holding the focused control stays. The Mapping tab's builder keeps nothing.

tests/js/atlas_keep_card.mjs runs the modules for real; the wiring is held here.
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


def _read(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "atlas_keep_card.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 15


def test_only_the_sidebar_keeps_its_table() -> None:
    panel = _read("lights_panel.js")
    assert "keepTable: this._tableKeep || (this._tableKeep = {})," in panel
    # The Mapping tab's builder builds a new table every time, as ever.
    assert "keepTable" not in _read("views/maps.js")


def test_only_the_poll_holds_a_focused_row() -> None:
    panel = _read("lights_panel.js")
    assert "keepFocused: !!this._pollRender," in panel
    i = panel.index("  async _poll(){")
    body = panel[i:panel.index("\n  }\n", i)]
    assert "this._pollRender = true;" in body and "finally { this._pollRender = false; }" in body


def test_the_page_lays_its_parts_around_the_kept_table() -> None:
    panel = _read("lights_panel.js")
    i = panel.index("  _render(){")
    body = panel[i:panel.index("\n  }\n", i)]
    # The kept table never leaves the page: the rest comes out before the build.
    assert "if(n!==kept) root.removeChild(n);" in body
    assert "layChildren(root, parts);" in body


def test_a_hold_on_a_marker_stops_the_poll() -> None:
    # A marker's pointerdown stops the event (wirePress), so the panel hears
    # presses in the capture phase, and releases too, so none is missed.
    panel = _read("lights_panel.js")
    assert 'this.addEventListener("pointerdown", ()=>{ this._pointerDown = true; this._pointerDownAt = Date.now(); }, true);' in panel
    assert 'window.addEventListener("pointerup", ()=>{ this._pointerDown = false; }, true);' in panel
    assert 'window.addEventListener("pointercancel", ()=>{ this._pointerDown = false; }, true);' in panel
    # A release that never comes (context menu, window left mid-hold) cannot
    # stop the updates for good: leaving the window or 30 s ends the hold.
    assert 'window.addEventListener("blur", ()=>{ this._pointerDown = false; });' in panel
    assert 'if(this._pointerDown && Date.now() - (this._pointerDownAt || 0) < 30000) return;' in panel
