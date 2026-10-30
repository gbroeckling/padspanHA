# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The status dot in the panel's top bar (views/status_dot.js).

Nothing when all is well; red when something is broken (PadSpan not
answering, positioning's last update failed, no receiver reporting); amber
when something needs attention (a receiver silent for 10 minutes, one hearing
far less than usual, a floor-plan receiver no live one matches, learning
suspended). A condition shows after two polls in a row and goes after two
without. On a wall screen, red only. A click opens Health and is counted in
the opt-in report (status_dot_open). No toast, no sound.

tests/js/status_dot.mjs runs the module for real; the wiring is held here.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "status_dot.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 30


def test_the_rule_needs_two_polls() -> None:
    js = _read(_WWW / "views" / "status_dot.js")
    assert "export const PERSIST = 2;" in js
    assert "export const SILENT_S = 600;" in js


def test_the_panel_loads_it_optionally_and_counts_once_per_poll() -> None:
    js = _read(_WWW / "panel.js")
    assert "import(`./views/status_dot.js?b=${BUILD_ID}`)\n  .then(m => { STATUS_DOT = m; })" in js
    # Once per poll, in the poll's finally, answered or not.
    assert "    let _pollOk = false;\n    try{" in js
    assert "      _pollOk = true;\n      this._updateBadges();" in js
    assert "try { this._updateStatusDot(!_pollOk || !!this.state.live.error); } catch(e){}" in js
    assert js.count("this._updateStatusDot(") == 1
    # Painting follows every badge update (a switch to sample clears it).
    assert "    this._updateEmergencyBanner();\n    this._paintStatusDot();" in js
    assert 'if (this.state.dataMode !== "live") { this._statusDotTrack = null; this._statusDotActive = null; }' in js


def test_it_sits_in_both_top_bars_and_a_wall_corner() -> None:
    js = _read(_WWW / "panel.js")
    assert '<span class="pill" id="statusBadge">Status: —</span>\n            <button class="status-dot hidden" type="button" data-status-dot="desktop"></button>' in js
    assert '<button class="status-dot hidden" type="button" data-status-dot="mobile"></button>' in js
    assert '<div class="status-dot status-dot-wall hidden" role="status" data-status-dot="wall"></div>' in js
    # Kiosk hides the top bars: the corner shows there, the bars' dots elsewhere.
    assert 'const show = !!view && (wallHost ? kiosk : !kiosk);' in js
    assert "const wall = kiosk || (wallScreen(false) && untouchedFor(120000));" in js


def test_it_is_labelled_and_not_colour_only() -> None:
    js = _read(_WWW / "panel.js")
    assert 'b.setAttribute("aria-label", view.label);' in js
    assert "b.title = view.label;" in js
    assert 'el("span", { class: "status-dot-mark", "aria-hidden": "true" }, "!")' in js
    css = _read(_WWW / "styles.css")
    assert ".status-dot.hidden{display:none}" in css
    assert ".status-dot-red .status-dot-mark{border-radius:50%;" in css
    assert "clip-path:polygon(50% 0,100% 100%,0 100%)" in css
    assert ".status-dot:focus-visible{" in css
    # Day theme: a dark amber count (the day rule alone gave 2.3:1 on white).
    assert ':host([data-theme="day"]) .status-dot-amber{color:#92400e}' in css


def test_a_click_opens_health_and_is_counted() -> None:
    js = _read(_WWW / "panel.js")
    assert "for (const b of this.shadowRoot.querySelectorAll('button[data-status-dot]')) {\n      b.addEventListener(\"click\", () => this._openHealthFromDot());" in js
    body = js.split("  _openHealthFromDot(){", 1)[1].split("\n  }\n", 1)[0]
    assert 'this._telemetryEvent("status_dot_open");' in body
    assert 'this.state.view = "health";' in body
    assert '_loadView("health")' in body
    assert "_toast" not in body
    # Health is in every mode's menu (More tools in Basic): the mode stays.
    assert "complexity" not in body
    assert "status_dot_open" in T.EVENTS
    assert T.event_allowed("status_dot_open")
    ib = _read(_WWW / "views" / "installbase.js")
    assert 'status_dot_open: "Opened Health from the top bar\'s status dot",' in ib


def test_it_never_toasts_or_plays_a_sound() -> None:
    js = _read(_WWW / "views" / "status_dot.js")
    for word in ("_toast", "Audio", "play(", "callWS", "fetch("):
        assert word not in js
    panel = _read(_WWW / "panel.js")
    paint = panel.split("  _paintStatusDot(){", 1)[1].split("\n  }\n", 1)[0]
    assert "_toast" not in paint and "Audio" not in paint


def test_the_snapshot_says_positioning_failed_only_when_it_did() -> None:
    src = _read(_PKG / "snapshot_builder.py")
    assert ('            if getattr(_pc_sus, "last_update_success", True) is False:\n'
            '                snap["positioning_failed"] = True') in src
