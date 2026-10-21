# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""4K wall mode (0.38.159): ?kiosk=1 on the sidebar Atlas puts the whole
house on the screen and sizes its controls for the room. Garry, 2026-10-21:
wall mode rides on ?kiosk=1, and the scale follows the screen (a 1080p wall
stays as it was, a 4K wall is twice the size)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _src(name: str) -> str:
    return (_WWW / name).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_scale_is_the_screen_against_1080p_never_under_one():
    if _NODE is None:
        pytest.skip("node is not installed")
    src = _src("lights_panel.js")
    fn = re.search(r"const WALL_UI_MAX = 3;\nfunction wallScale\(w, h\)\{.*?\n\}", src, re.S).group(0)
    code = fn + "\nconsole.log(JSON.stringify([[1920,1080],[3840,2160],[1280,720],[2560,1440],[7680,4320],[3840,1600],[1080,1920],[0,0]].map(([w,h]) => wallScale(w,h))));"
    got = json.loads(subprocess.run([_NODE, "-e", code], capture_output=True, text=True, timeout=30).stdout)
    assert got == [1, 2, 1, 1.33, 3, 1.48, 1, 1], got


def test_kiosk_turns_it_on_and_only_on_the_sidebar_atlas():
    src = _src("lights_panel.js")
    on = src[src.index("  _wallOn(){"):]
    on = on[:on.index("\n  }\n")]
    assert 'get("kiosk") === "1"' in on and "this._embedded" in on, "the Atlas as Overview never takes it"
    assert "|| !v2)" in on and "_atlasLayoutV2" in on, "a classic layout on ?kiosk=1 stays as it was (review: it lost its header for nothing)"
    assert "_buildUI(){\n    this._wallOn();" in src, "asked again at every build: tier and layout come with the settings"
    assert 'this.setAttribute("data-wall", "")' in on and 'setProperty("--wall-ui"' in on
    assert 'navigator.wakeLock.request("screen")' in on, "a wall nobody touches stays awake"
    assert "wall: this.hasAttribute(\"data-wall\")," in src
    assert ":host([data-wall]) .lv-hero" in src, "no header on a wall"


def test_the_house_fits_the_screen_both_ways():
    lm = _src("views/lights_map.js")
    assert "const WALL = DISPLAY && !!host.wall;" in lm
    assert "100cqh *" in lm and "wxSlot.fit(view.zoom, V2, wallW)" in lm, "the drawing and the rain take the same width"
    css = _src("styles.css")
    assert ".lv-mapcard.lv-display.lv-wall > .lv-stage{flex:1 1 auto;min-height:0;container-type:size;" in css
    assert "zoom:var(--wall-ui,1)" in css
    assert "la3d" not in css, "Live Aboard's wall rules live in its own CSS, never styles.css"
    assert ".lv-mapcard.lv-display.lv-wall .la3d-tip{display:none}" in _src("views/live_aboard.js")


def test_3d_names_grow_and_the_first_card_waits_for_someone_to_tap_it():
    la = _src("views/live_aboard.js")
    assert "NAME_PX[0] * wallK" in la and "NAME_PX[1] * wallK" in la
    assert 'if (!again && root.closest && root.closest(".lv-wall")) return;' in la


def test_rain_is_drawn_bigger_on_a_wall():
    wx = _src("views/atlas_weather.js")
    assert 'setProperty("--tw", `calc(${L.w}px * var(--wall-ui, 1))`)' in wx


def test_its_use_is_counted():
    assert {"wall_ui:1", "wall_ui:1.5", "wall_ui:2", "wall_ui:3", "wall_awake:on", "wall_awake:off"} <= telemetry.SCREEN_EVENTS
    src = _src("lights_panel.js")
    assert 'send("wall_ui:" +' in src and 'send("wall_awake:" +' in src
