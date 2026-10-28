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


def _node(code: str):
    """Run `code` with views/wall_scale.js's exports in scope (the wall and the card share it)."""
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / "views" / "wall_scale.js").resolve().as_uri()
    js = (f"import({json.dumps(url)}).then(({{wallScale, wallParams, wallLink, textMm, textWord, controlScale, WALL_UI_MAX}}) => {{ "
          + code + " });")
    res = subprocess.run([_NODE, "--input-type=module", "-e", js], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_the_card_s_numbers():
    got = _node("console.log(JSON.stringify([wallLink({inches:55, meters:2.5, arcmin:20}), wallLink({inches:0, meters:2.5, arcmin:24}),"
                " Math.round(textMm(wallScale(3840,2160,{inches:55,meters:2.5}), 55, 3840, 2160)), textMm(2, 0, 3840, 2160),"
                " textWord(16), textWord(21), textWord(25), textWord(30), WALL_UI_MAX]))")
    assert got[0] == "/padspan-lights?kiosk=1&wall_in=55&wall_m=2.5"
    assert got[1] == "/padspan-lights?kiosk=1&wall_text=24"
    assert got[2] == 15, "text about 1.5 cm tall on a 55-inch 4K at 2.5 m"
    assert got[3] is None, "no physical size without the screen's size"
    assert got[4:8] == ["Small", "Comfortable", "Large", "Very large"] and got[8] == 6


def test_the_card_is_in_settings_and_saves_the_wall_settings():
    st = _src("views/settings.js")
    assert "const WALLCARD = await import(`./wall_card.js" in st and "WALLCARD.wallCard(ctx, el, settings)" in st
    card = _src("views/wall_card.js")
    for k in ("wall_screen_in", "wall_distance_m", "wall_text_arcmin", "wall_night_dim", "wall_pixel_shift"):
        assert k in card, k
    assert 'ctx.actions.wsCall("padspan_ha/settings_set", patch)' in card, "straight to the wire, Settings not rebuilt under the slider"
    assert '["Living-room TV", 55, 3]' in card and "WALLS.wallLink(o, linkOnly)" in card
    lp = _src("lights_panel.js")
    assert "const WALLS = await import(`./views/wall_scale.js" in lp and "WALLS.wallScale(" in lp, "the wall and the card share the numbers"


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
    assert got[0] == {"inches": 65, "meters": 3, "arcmin": 22, "dim": 0, "shift": False, "cycle": 0, "fully": False, "rotate": 0}
    assert got[1] == {"inches": 55, "meters": 2, "arcmin": 22, "dim": 0.7, "shift": True, "cycle": 0, "fully": False, "rotate": 0}, "night dim kept to 70%"
    assert got[2] == {"inches": 0, "meters": 2.5, "arcmin": 20, "dim": 0, "shift": False, "cycle": 0, "fully": False, "rotate": 0}


def test_kiosk_turns_it_on_and_only_on_the_sidebar_atlas():
    src = _src("lights_panel.js")
    on = src[src.index("  _wallOn(){"):]
    on = on[:on.index("\n  }\n")]
    assert 'get("kiosk") === "1"' in on and "this._embedded" in on, "the Atlas as Overview never takes it"
    assert "|| !v2 || !WALLS)" in on and "_atlasLayoutV2" in on, "a classic layout on ?kiosk=1 stays as it was (review: it lost its header for nothing)"
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
    assert "zoom:var(--wall-ctl,var(--wall-ui,1))" in css
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
    assert 'setProperty("--tw", `calc(${L.w}px * var(--wall-px, 1))`)' in wx


def test_its_use_is_counted():
    assert {"wall_ui:1", "wall_ui:1.5", "wall_ui:2", "wall_ui:3", "wall_awake:on", "wall_awake:off"} <= telemetry.SCREEN_EVENTS
    src = _src("lights_panel.js")
    assert 'send("wall_ui:" +' in src and 'send("wall_awake:" +' in src


def test_flat_map_names_and_key_grow_on_a_sized_wall():
    iso = _src("views/iso_lights.js")
    assert "const LS = Number(opts.labelScale) > 1 ? Math.min(6, Number(opts.labelScale)) : 1;" in iso, "1 everywhere but a wall"
    assert "const rfsBase=(SHOW?5.9:6.7)*LS;" in iso and "const LEGEND_H=32*LS;" in iso
    assert "labelScale: WALL && host.wallLabel ? host.wallLabel() : 1," in _src("views/lights_map.js")
    assert "(this._wallUi || 1) / (this._wallPx || 1)" in _src("lights_panel.js"), \
        "the drawing already grows with the screen: names take only the rest"


def test_a_wall_that_stops_being_one_leaves_nothing_behind():
    src = _src("lights_panel.js")
    off = src[src.index("  _wallOff(){"):]
    off = off[:off.index("\n  }\n")]
    for s in ('removeEventListener("resize"', '"visibilitychange"', "this._wakeLock.release()",
              'removeProperty("--wall-ui")', 'removeAttribute("data-wall-active")'):
        assert s in off, s
    on = src[src.index("  _wallOn(){"):]
    assert 'this.removeAttribute("data-wall");\n      this.removeAttribute("data-wall-rotate");\n      this._wallOff();' in on[:on.index("\n  }\n")]
    assert "disconnectedCallback(){" in src and "    this._wallOff();\n" in src


def test_the_server_keeps_the_card_s_smallest_screen():
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    assert '_clamped(msg["wall_screen_in"], 10, 120,' in src, "the Kitchen tablet preset is 11 inches, the slider starts at 10"
    assert 'slider("Screen size", 10, 110,' in _src("views/wall_card.js")


def test_live_aboard_re_reads_the_scale_when_settings_change_it():
    assert "host.style.getPropertyValue(prop)" in _src("views/live_aboard.js")


def test_a_portrait_wall_opens_on_the_whole_house_not_room_scale():
    la = _src("views/live_aboard.js")
    assert "if (camera.aspect >= 0.8 || onWallPage(root)) return;" in la, "the first view"
    assert "if (camera.aspect < 0.8 && !onWallPage(root)) g.radius" in la, "and the sidebar's home view"


def test_a_wall_is_the_map_alone_no_table_under_it():
    # Found on a real 4K monitor at 200%: the lights' table under the map gave a wall a scrollbar.
    assert ":host([data-wall]) .lv-tablecard.lv-index{display:none}" in _src("lights_panel.js")


def test_every_wall_keeps_the_1440p_budget():
    # Release review, 2026-10-21: High at full 4K would have changed TV sticks
    # already set to High; every wall keeps 0.38.159's budget.
    la = _src("views/live_aboard.js")
    assert "if (!onWallPage(root) || !w || !h) return profileDpr;" in la
    assert 'quality.setting === "high") return profileDpr' not in la


def test_buttons_stop_at_finger_size_while_the_text_grows():
    # Found on a real 4K monitor run as a 55-inch touch wall at 3 m: scale 6
    # made the rail's buttons 61 mm across. Text is read from the room, a
    # button is touched at arm's length.
    got = _node("console.log(JSON.stringify([controlScale(6, 55, 3840, 2160), controlScale(6, 55, 1920, 1080, 2),"
                " controlScale(2, 0, 3840, 2160), controlScale(1.2, 55, 3840, 2160), controlScale(6, 110, 3840, 2160)]))")
    assert got[0] == 2.17, "about 22 mm on a 55-inch 4K"
    assert got[1] == 1.08, "the same 22 mm at Windows 200%: its pixels are already twice the size"
    assert got[2] == 2, "no screen size: as the text"
    assert got[3] == 1.2, "never bigger than the text"
    assert got[4] == 1.08
    lp = _src("lights_panel.js")
    assert 'setProperty("--wall-ctl", String(WALLS.controlScale(' in lp and 'removeProperty("--wall-ctl")' in lp
    css = _src("styles.css")
    assert ".lv-mapcard.lv-display.lv-wall .lv-alone-anchor > button{zoom:var(--wall-ctl,var(--wall-ui,1))}" in css
    assert ".lv-wall > .lv-legend{" not in css.replace(".lv-mapcard.lv-display", ""), "the only legend there is stays off a wall"
    la = _src("views/live_aboard.js")
    assert ':host([data-wall]) .la3d-sheet,:host([data-wall]) .la3d-card{zoom:var(--wall-ctl,var(--wall-ui,1))}' in la
    # The People and Motion chips and the motion colour key grow with the HUD
    # (a 4K wall drew them 1080p-sized until 2026-10-28). The lone Motion chip
    # matches only outside the row, so it is never zoomed twice.
    assert ':host([data-wall]) .la3d-chiprow,:host([data-wall]) .la3d > .la3d-mchip,:host([data-wall]) .la3d-mkey,:host([data-wall]) .la3d-wet{zoom:var(--wall-ui,1)}' in la
    assert 'wallUiOf(root, "--wall-ctl")' in la, "the menu is placed by the scale it is drawn at"


def test_the_review_s_wall_fixes():
    lp = _src("lights_panel.js")
    shift = lp[lp.index("  _wallShift(){"):]
    shift = shift[:shift.index(chr(10) + "  }" + chr(10))]
    assert "this.shadowRoot.children" in shift and "el.style.translate" in shift, "the 3D full screen moves too"
    assert ":host([data-wall]){overflow:clip}" in lp, "a moved page never scrolls"
    assert 'window.addEventListener("pointerdown", this._wallTap, true);' in lp and 'removeEventListener("click", this._wallTap, true)' in lp,         "a touch on a faded wall only wakes it"
    assert 'setProperty("--wall-px"' in lp and "(this._wallUi || 1) / (this._wallPx || 1)" in lp
    assert "calc(${L.w}px * var(--wall-px, 1))" in _src("views/atlas_weather.js"), "rain goes with the drawing, not the text"
    assert "height:100vh;height:100dvh;" in _src("styles.css"), "a tablet's browser bars"
    card = _src("views/wall_card.js")
    assert "WALLS.wallLink(o, linkOnly)" in card and "Just make a link" in card and "showSaved()" in card
    assert "if (was === null) was = get();" in card, "a failed save puts back what it was before the drag"
    assert "const H2=HTOTAL-32*(LS-Math.max(1,k));" in _src("views/iso_lights.js")


def test_a_full_link_says_everything():
    got = _node("console.log(JSON.stringify([wallLink({inches:0, meters:2.5, arcmin:20}, true), wallLink({inches:11, meters:0.5, arcmin:20}, true),"
                " wallParams('?kiosk=1&wall_in=0&wall_text=20', {wall_screen_in: 55, wall_distance_m: 3, wall_text_arcmin: 24}).inches]))")
    assert got[0] == "/padspan-lights?kiosk=1&wall_in=0&wall_text=20"
    assert got[1] == "/padspan-lights?kiosk=1&wall_in=11&wall_m=0.5&wall_text=20"
    assert got[2] == 0, "wall_in=0 sizes from the screen whatever the house says"


def _node_mod(code: str):
    """`code` with every export of views/wall_scale.js in scope as W."""
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / "views" / "wall_scale.js").resolve().as_uri()
    res = subprocess.run([_NODE, "--input-type=module", "-e", f"import({json.dumps(url)}).then((W) => {{ {code} }});"],
                         capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_floors_in_turn_all_then_each_floor_off_by_default():
    got = _node_mod("console.log(JSON.stringify([W.nextFloorStop([0,1,3,5],0), W.nextFloorStop([0,1,3,5],5),"
                    " W.nextFloorStop([0,1,3,5],2), W.nextFloorStop([0],0), W.nextFloorStop(undefined,0),"
                    " W.wallParams('', {}).cycle, W.wallParams('', {wall_floor_cycle_s: 5}).cycle,"
                    " W.wallParams('', {wall_floor_cycle_s: 30}).cycle, W.wallParams('', {wall_floor_cycle_s: 9999}).cycle]))")
    assert got == [1, 0, 0, None, None, 0, 0, 30, 600], got
    lm = _src("views/lights_map.js")
    assert "if (host.wall) view.wallStops = isoPos.map((p, i) => (Array.isArray(p) ? -1 : i))" in lm, "only on a wall, pairs left out"
    lp = _src("lights_panel.js")
    cyc = lp[lp.index("  _wallCycle(){"):]
    cyc = cyc[:cyc.index("\n  }\n")]
    assert 'this.hasAttribute("data-wall-active")' in cyc, "it waits while someone uses the wall"
    assert 'this.hasAttribute("data-wall") ?' in cyc and "if(!s) return;" in cyc
    assert "this._wallCycle();" in lp[lp.index("  _wallOn(){"):lp.index("  _wallNight(){")]
    assert "clearInterval(this._cycleTimer)" in lp[lp.index("disconnectedCallback(){"):]


def test_fully_kiosk_dims_its_own_screen_and_wakes_on_motion_only_when_asked():
    got = _node_mod("console.log(JSON.stringify([W.fullyBrightness(200, 0.5), W.fullyBrightness(0, 0.3), W.fullyBrightness(10, 0.99),"
                    " W.fullyBrightness(255, 0), W.wallParams('', {}).fully, W.wallParams('', {wall_fully: true}).fully]))")
    assert got == [100, 179, 3, 255, False, True], got
    lp = _src("lights_panel.js")
    night = lp[lp.index("  _wallNight(){"):]
    night = night[:night.index("\n  }\n")]
    assert "const fully = p && p.fully ? this._fully() : null;" in night, "the overlay stays everywhere else"
    assert "this._fullyRestore();" in night, "day brightness back in the morning or when the wall stops"
    assert 'fully.bind("onMotion",' in lp and "f.turnScreenOn()" in lp
    assert "this._fullyRestore();" in lp[lp.index("disconnectedCallback(){"):]


def test_the_card_and_the_server_carry_the_new_wall_settings():
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    ws = (root / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("wall_floor_cycle_s"): vol.Coerce(float)' in ws and 'vol.Optional("wall_fully"): bool' in ws
    assert '_clamped(msg["wall_floor_cycle_s"], 10, 600, 0, zero_ok=True)' in ws
    assert '"wall_pixel_shift", "wall_fully",' in ws, "in the bool allowlist"
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["wall_floor_cycle_s"] == 0 and DEFAULT_SETTINGS["wall_fully"] is False
    card = _src("views/wall_card.js")
    assert "save({ wall_floor_cycle_s: v.cycle }" in card and "save({ wall_fully: want }" in card
    lp = _src("lights_panel.js")
    assert "wall_floor_cycle_s: s.wall_floor_cycle_s, wall_fully: s.wall_fully" in lp


def test_the_wake_tap_only_eats_a_tap_on_a_hidden_control():
    # Review, 2026-10-21: the rail, drawers and lights stay showing on a faded
    # wall, so a first tap on them must work; only one where a faded control was is eaten.
    lp = _src("lights_panel.js")
    assert 'const FADED = ".la3d-bar, .la3d-compass, .la3d-hud, .lv-alone-anchor > button";' in lp
    assert "if(!onFaded(e.clientX, e.clientY)) return;" in lp
    assert '"translate"];' in _src("views/live_aboard.js"), "leaving full screen clears the wall's shift on the 3D view"


def test_the_atlas_page_runs_without_the_wall_module():
    # The 15-hour review's load-risk check: an optional module must not take the page with it.
    lp = _src("lights_panel.js")
    assert '.catch(err => { console.warn("PadSpan: wall_scale failed to load", err); return null; });' in lp
    assert "if(!kiosk || this._embedded || !v2 || !WALLS){" in lp, "no module: no wall mode, and every other use of it sits behind data-wall"


def test_a_portrait_wall_is_sized_like_a_landscape_one_and_can_be_turned():
    """A portrait 4K wall (2160 x 3840) drew its text at about half size:
    min(w/1920, h/1080) is 1.13 there. Long side against 1920, short against
    1080: 2 either way up. A wall whose TV can't turn its picture turns
    itself from its link (?wall_rotate=90|270)."""
    src = (_WWW / "views" / "wall_scale.js").read_text(encoding="utf-8")
    assert "Math.min(Math.max(W, H) / 1920, Math.min(W, H) / 1080)" in src
    assert "s = screenRatio(w, h) * (arcmin / 20);" in src
    assert 'rotate: rotationOf(q.get("wall_rotate")),' in src
    assert "if (rotationOf(o.rotate)) p.push(`wall_rotate=${rotationOf(o.rotate)}`);" in src
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "const W = rot ? window.innerHeight : window.innerWidth, H = rot ? window.innerWidth : window.innerHeight;" in lp
    assert ':host([data-wall][data-wall-rotate="90"]){transform:rotate(90deg) translateY(-100%)}' in lp
    card = (_WWW / "views" / "wall_card.js").read_text(encoding="utf-8")
    assert "Screen orientation" in card and "WALLS.ROTATIONS" in card
