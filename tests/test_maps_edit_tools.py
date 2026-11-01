"""Mapping → Edit's tool row and stage, and the plans on Calibration's screens.

tests/js/maps_edit_tools.mjs runs the Edit view: the lit tool and its hint
follow the tool in use, Measure shows only its own panel, a wizard step opens
on its own tool, a view with one tool prints no layout as text, and names sit
over the stage. What can only be read from here is below; how a plan looks and
where a tap lands on it were checked in a browser.
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
_NODE = shutil.which("node")


def _text(p: Path) -> str:
    return p.read_text(encoding="utf-8")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_edit_tools_and_stage_names() -> None:
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "maps_edit_tools.mjs"), str(_WWW / "views")],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])
    assert len(got) >= 20, got
    bad = {k: v for k, v in got.items() if not v["ok"]}
    assert not bad, bad


def test_the_alignment_overlay_has_no_stretched_text() -> None:
    """Its SVG stretches a 0-1 viewBox to the plan's shape: text in there comes out stretched."""
    maps = _text(_WWW / "views" / "maps.js")
    for name, end in (("function _stackMapSVGStr(", "// Persistent-pins SVG overlay"), ("function _persistent2dPinsSVGStr(", "// ── 3D Isometric SVG Renderer")):
        body = maps[maps.index(name):maps.index(end)]
        assert "<text" not in body, name
        assert 'class="maplabel"' in body or "label(" in body, name


def test_a_plan_on_calibrations_screens_fits_the_window_and_keeps_its_shape() -> None:
    """Pin & Listen, Roam and Model. Calibration points are fractions of the plan, so
    the only thing that may change is the size of its box: same viewBox, same shape,
    and a tap still a fraction of the plan's on-screen box."""
    cal = _text(_WWW / "views" / "calibration.js")
    fit = cal[cal.index("function _fitPlanToWindow("):]
    fit = fit[:fit.index("\n}")]
    assert "box.style.width = `min(100% - ${border * 2}px, max(100vh - 140px, 320px) * ${100 / vbH})`;" in fit
    assert not re.search(r"(x_frac|y_frac|pinX|pinY|viewBox)", fit)
    assert cal.count("_fitPlanToWindow(mapWrap, vbH, 2);") == 2
    assert cal.count("_fitPlanToWindow(miniDiv, vbH, 1);") == 1
    assert cal.count("mapWrap.style.aspectRatio = `100 / ${vbH}`;") == 2
    assert "cs.pinX = (clientX - rect.left) / rect.width;" in cal
    assert "cs.pinY = (clientY - rect.top) / rect.height;" in cal


def test_sample_mode_has_no_forced_render_to_collapse_open_cards() -> None:
    """Sample mode has no data poll, so nothing stamps a good render there. A render
    that failed still gets the watchdog's recovery; Live is as it was."""
    panel = _text(_WWW / "panel.js")
    assert ('const _noPollToWatch = !!this.state?._dataModeKnown && this.state?.dataMode !== "live" && !this._renderFailCount;'
            in panel)
    assert "const _isLiveView = _liveSet.has(this.state?.view) && !_noPollToWatch;" in panel


def test_which_house_an_answer_is_for_is_not_the_hass_object() -> None:
    """Home Assistant hands over a new hass on every state change: comparing those
    would throw good answers away on every Live home. The generation moves only when
    the house does."""
    panel = _text(_WWW / "panel.js")
    assert panel.count("this._houseGen = (this._houseGen || 0) + 1;") == 2
    i = panel.index("  async _getModel(){")
    assert "this._hass" not in panel[i:panel.index("this.state.model = { ...defaults", i)]
