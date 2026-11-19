"""How big the house is drawn on a wall (views/atlas_fit.js), 2026-11-19.

The owner, for the sixth time: the wall "keeps loading with the view in the
map very small, with tons of space around it". Every earlier fix tuned one
saved spacing that every screen and two views shared. The rule now: a wall
arranges its floors for its own shape each time it draws, and checks after
every drawing that the house is as large as the screen allows.

tests/js/atlas_fit.mjs runs the rule and the measure (no DOM). Here: each part
of it passes, and the wall is wired to it and to nothing saved.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def fit() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    args = [_NODE, str(Path(__file__).parent / "js" / "atlas_fit.mjs"), str(_WWW)]
    dump = os.environ.get("PADSPAN_FIT_DUMP", "")       # a real house's model_get, to hold it there too
    if dump:
        args.append(dump)
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["box:", "best:", "saved:", "judge:", "plate:"])
def test_each_part_of_the_rule(fit, prefix) -> None:
    got = {k: v for k, v in fit["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(fit['cases'])[:8]}"
    bad = [f for f in fit["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_house_was_tried_on_every_screen(fit) -> None:
    names = [k for k in fit["cases"] if k.startswith("best:") and "nearly every room in sight" in k]
    assert len(names) >= 5 * 6, names                   # four fixture houses and the estate, six screen shapes


def test_a_wall_arranges_its_own_floors_and_reads_no_saved_spacing() -> None:
    lm = _js(_WWW / "views" / "lights_map.js")
    # before the frame is built, every time a card is; and again when a kept card's wall changed shape
    assert "  if (WALL) _fitWall(host, view, floors);\n" in lm
    assert lm.index("if (WALL) _fitWall(host, view, floors);") < lm.index("const _frame = fabricFrame(host.model, floors, view.floorGap, view.horizGap);")
    assert "if (WALL && _fitWall(lightsHostForTier(next), view, next.floors || [])) return false;" in lm
    # optional: without the module a wall draws as it did
    assert 'const FIT = await import(`./atlas_fit.js${new URL(import.meta.url).search}`)\n  .catch(' in lm
    # a hand on Spacing or L/R stands for this page; Reset view gives the fit back
    assert lm.count("if (WALL) view.fitByHand = true;") == 2 and "view.fitByHand = false;" in lm
    # the box hugs the house on a wall only
    assert "...(WALL ? { hugX: true } : {})," in lm
    panel = _js(_WWW / "lights_panel.js")
    assert '_wallFitted(){ return this.hasAttribute("data-wall") && !this._view.fitByHand; }' in panel
    load = panel[panel.index("async _loadSettings(applyView=true){"):panel.index("// Per-light shape overrides")]
    assert "if(!this._wallFitted()){\n          this._view.floorGap = s.overview_iso_floor_gap ?? 150;" in load
    save = panel[panel.index("async _saveSettings(){"):panel.index("async _saveSettings(){") + 900]
    assert "const gaps = this._wallFitted() ? {} : { overview_iso_floor_gap: this._view.floorGap, overview_iso_horiz_gap: this._view.horizGap };" in save
    assert "wallStage: ()=>{" in panel and 'r === "90" || r === "270" ? [h, w] : [w, h]' in panel


def test_the_wall_checks_itself_after_every_drawing_and_never_stays_far_back() -> None:
    lm = _js(_WWW / "views" / "lights_map.js")
    draw = lm[lm.index("  const rebuildISO = () => {"):lm.index("  // Pinch on the drawing zooms about the fingers")]
    assert "    applyZoom();\n    if (WALL) checkFill();\n" in draw
    check = lm[lm.index("  const checkFill = () => {"):lm.index("  let drawnWhole = false;")]
    # judged against the size THIS stage allows, at 100%, for the whole house, and never over a person's own zoom
    assert "FIT.bestLayout(shapes, sw, sh)" in check and "FIT.shortfall(drawnAt100(), best && best.px)" in check
    assert "if (short.known && short.low && whole && (view.zoom || 1) === 1 && !view.zoomByHand) {" in check
    assert "if (h3 && la3dOn())" in check or "(h3 && la3dOn())" in check          # not while the 3D house shows
    for key in ("fillRatio", "fillLow", "fillCloser", "fillZoom", "fitted"):
        assert f"isoDiv.dataset.{key} = " in check, key
    assert "if (byHand) view.zoomByHand = (view.zoom || 1) !== 1;" in lm
    # said once a page in the opt-in report, from what the stage carries
    panel = _js(_WWW / "lights_panel.js")
    assert 'querySelector(".lv-stage[data-fill-ratio]")' in panel
    assert 'send("wall_fill:" + (st.dataset.fillCloser === "1" ? "closer" : st.dataset.fillLow === "1" ? "low" : "ok"));' in panel
    from custom_components.padspan_ha import telemetry as T
    assert {"wall_fill:ok", "wall_fill:low", "wall_fill:closer"} <= T.SCREEN_EVENTS
    assert all(T.event_allowed(e) for e in ("wall_fill:ok", "wall_fill:low", "wall_fill:closer"))


def test_a_wall_has_no_scroll_bars() -> None:
    css = _js(_WWW / "styles.css")
    assert ".lv-mapcard.lv-display.lv-wall > .lv-stage{scrollbar-width:none}" in css
    assert ".lv-mapcard.lv-display.lv-wall > .lv-stage::-webkit-scrollbar{display:none}" in css


def test_the_tool_that_checks_a_wall_reads_what_the_page_says() -> None:
    tool = _ROOT / "tools" / "wall_fill_check.py"
    if not tool.exists():
        pytest.skip("no tools/ in this tree (the Bright derivation carries none)")
    src = tool.read_text(encoding="utf-8")
    assert "[data-fill-ratio]" in src and "padspan-lights?kiosk=1" in src and "page=atlas&kiosk=1" in src
    assert "return 1 if bad else 0" in src
