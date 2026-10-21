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


def _wall_fns() -> str:
    src = _src("lights_panel.js")
    return re.search(r"const WALL_UI_MAX = 6;.*?\n// A screen's own link.*?\n\}", src, re.S).group(0)


def _node(code: str):
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, "-e", _wall_fns() + "\n" + code], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_auto_is_the_screen_against_1080p_never_under_one():
    got = _node("console.log(JSON.stringify([[1920,1080],[3840,2160],[1280,720],[2560,1440],[7680,4320],[3840,1600],[1080,1920],[0,0]]"
                ".map(([w,h]) => wallScale(w,h))))")
    assert got == [1, 2, 1, 1.33, 4, 1.48, 1, 1], got
    # the text size slider moves auto too: 24 arcmin is 1.2x of 20
    assert _node("console.log(JSON.stringify(wallScale(3840, 2160, {arcmin: 24})))") == 2.4


def test_room_mode_sizes_text_by_what_the_eye_sees():
    # The research brief's worked examples (control-room practice, 20 arcmin):
    # 27" 4K at 0.7 m, 55" 4K at 2.5 m, 65" 4K at 3.5 m, 32" 1080p at 1.5 m.
    got = _node("console.log(JSON.stringify(["
                "wallScale(3840,2160,{inches:27,meters:0.7}), wallScale(3840,2160,{inches:55,meters:2.5}),"
                "wallScale(3840,2160,{inches:65,meters:3.5}), wallScale(1920,1080,{inches:32,meters:1.5}),"
                "wallScale(1920,1080,{inches:24,meters:0.6,arcmin:14.4}),"
                "wallScale(1920,1080,{inches:55,meters:2.5,dpr:2})]))")
    assert got == [2.88, 5.05, 5.98, 2.6, 1, 2.53], got   # the last: Windows at 200% already doubled it, so half of 5.05


def test_a_screens_own_link_wins_over_the_house():
    got = _node("console.log(JSON.stringify([wallParams('?kiosk=1&wall_in=65&wall_m=3', {wall_screen_in: 55, wall_distance_m: 2, wall_text_arcmin: 22}),"
                " wallParams('?kiosk=1', {wall_screen_in: 55, wall_distance_m: 2, wall_text_arcmin: 22, wall_night_dim: 0.9, wall_pixel_shift: true}),"
                " wallParams('?kiosk=1', null)]))")
    assert got[0] == {"inches": 65, "meters": 3, "arcmin": 22, "dim": 0, "shift": False}
    assert got[1] == {"inches": 55, "meters": 2, "arcmin": 22, "dim": 0.7, "shift": True}, "night dim kept to 70%"
    assert got[2] == {"inches": 0, "meters": 2.5, "arcmin": 20, "dim": 0, "shift": False}


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
    assert ":host([data-wall]) .la3d-tip{display:none}" in _src("views/live_aboard.js"), "keyed on the page: it holds full screen too"


def test_3d_names_grow_and_the_first_card_waits_for_someone_to_tap_it():
    la = _src("views/live_aboard.js")
    assert "NAME_PX[0] * wallK" in la and "NAME_PX[1] * wallK" in la
    assert "if (!again && onWallPage(root)) return;" in la
    assert "READ_PX[0] * wallK" in la, "readout chips grow too"
    assert "LABEL_PX * (ctx.uiScale ? ctx.uiScale() : 1)" in _src("views/live_aboard_tracked.js"), "and tags' names"


def test_rain_is_drawn_bigger_on_a_wall():
    wx = _src("views/atlas_weather.js")
    assert 'setProperty("--tw", `calc(${L.w}px * var(--wall-ui, 1))`)' in wx


def test_its_use_is_counted():
    assert {"wall_ui:1", "wall_ui:1.5", "wall_ui:2", "wall_ui:3", "wall_awake:on", "wall_awake:off"} <= telemetry.SCREEN_EVENTS
    src = _src("lights_panel.js")
    assert 'send("wall_ui:" +' in src and 'send("wall_awake:" +' in src
