# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The map as text for screen readers (0.38.165, views/map_text.js).

tests/js/map_text.mjs runs the module for real: the lines built from a
snapshot (only what the Overview map shows, so quiet mode is respected), the
Atlas's people and tags, names kept as text, the hidden box and its 10 s pace.
Held here: the wiring in panel.js, overview.js, lights_map.js and
atlas_aboard.js, and that nothing about it can be seen."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "map_text.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 20


def test_names_go_in_as_text_never_markup() -> None:
    mt = _src(_WWW / "views" / "map_text.js")
    assert "n.textContent = text" in mt
    assert "innerHTML" not in mt and "insertAdjacentHTML" not in mt


def test_the_box_is_never_seen() -> None:
    mt = _src(_WWW / "views" / "map_text.js")
    assert ('export const SR_ONLY = "position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;"\n'
            '  + "overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none";') in mt
    assert "box.style.cssText = SR_ONLY;" in mt
    assert "export const EVERY_MS = 10000;" in mt
    # No stylesheet carries it: the inline style is the whole of its look.
    for css in ("styles.css", "styles-2025.css"):
        assert "data-map-text" not in _src(_WWW / css) and "psMapText" not in _src(_WWW / css)


def test_the_panel_keeps_one_box_and_fills_it_only_on_the_overview() -> None:
    panel = _src(_WWW / "panel.js")
    assert 'import(`./views/map_text.js?b=${BUILD_ID}`)' in panel
    assert "  _scheduleRender(fromPoll = false) {\n    this._updateMapText();\n" in panel
    body = panel[panel.index("  _updateMapText(){"):panel.index("  _scheduleRender(fromPoll = false) {")]
    assert 'MAP_TEXT.createMapText("psMapText", "Who is in which room")' in body
    assert 'this.state.view !== "overview" || atlasHome' in body and "mt.clear(); return;" in body
    assert "isAway(o, t)" in body and "isScanner" in body and "followedAddrs" in body


def test_the_maps_are_figures_described_by_it() -> None:
    ov = _src(_WWW / "views" / "overview.js")
    assert 'isoDiv.setAttribute("role", "figure");' in ov
    assert 'isoDiv.setAttribute("aria-describedby", "psMapText");' in ov
    lm = _src(_WWW / "views" / "lights_map.js")
    assert 'isoDiv.setAttribute("role", "figure");\n  isoDiv.setAttribute("aria-label", "House map");' in lm
    ab = _src(_WWW / "views" / "atlas_aboard.js")
    assert "await import(`./map_text.js${new URL(import.meta.url).search}`).catch(() => null)" in ab
    assert 'd.stage.setAttribute("aria-describedby", textId)' in ab
    # Only what is drawn: on a floor of the map and in sight.
    assert 'items.get(w.key).g.style.display !== "none"' in ab


def test_it_is_a_counted_helper() -> None:
    from custom_components.padspan_ha import telemetry
    assert "map_text" in telemetry.UI_ERROR_HELPERS
