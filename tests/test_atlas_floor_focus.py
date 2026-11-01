# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Choosing a floor on the flat Atlas fades the others, and they ignore taps.

Choosing a floor used to dim only its slab: the other floors' rooms, names and
markers stayed at full strength while most of their markers ignored a tap. Now
everything of an unchosen floor but its slab and badge sits in one faded group
(data-role="floorghost"), and nothing in that group takes a tap. With All, the
drawing is what it always was: no group, nothing changed.

The patch and the kept card are held in tests/js/atlas_svg_patch.mjs and
tests/js/atlas_keep_card.mjs. Also here: Settings and the help say the sidebar
Atlas page stays dark.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")

_FLOORS = [{"id": "main", "name": "Main", "level": 0}, {"id": "up", "name": "Up", "level": 1}]


def _rect(fid, x0, y0, x1, y1):
    return {"type": "poly", "floor_id": fid, "points_m": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


def _light(eid, code):
    return {"entity_id": eid, "state": "on", "code": code, "shape": "circle", "isWled": False}


_MODEL = {
    "room_geometry_m": {
        "Kitchen": _rect("main", 0, 0, 6, 4), "Den": _rect("main", 0, 4.1, 6, 8),
        "Loft": _rect("up", 0, 0, 6, 4), "Study": _rect("up", 0, 4.1, 6, 8),
    },
    "light_positions_m": {
        "light.main": {"x_m": 3, "y_m": 2, "floor_id": "main"},
        "light.up": {"x_m": 2, "y_m": 2, "floor_id": "up"},
    },
    "rf_barriers_m": [
        {"id": "d1", "name": "Main door", "material": "wood", "floor_id": "main", "linked_entity_id": "binary_sensor.door_main", "points_m": [[0, 1], [0, 2]]},
        {"id": "d2", "name": "Up door", "material": "wood", "floor_id": "up", "linked_entity_id": "binary_sensor.door_up", "points_m": [[0, 1], [0, 2]]},
    ],
}
_LBE = {
    "light.main": _light("light.main", "M01"), "light.up": _light("light.up", "U01"),
    "light.den1": {**_light("light.den1", "D01"), "area_name": "Den"},
    "light.study1": {**_light("light.study1", "S01"), "area_name": "Study"},
    "binary_sensor.door_main": {"entity_id": "binary_sensor.door_main", "state": "on"},
    "binary_sensor.door_up": {"entity_id": "binary_sensor.door_up", "state": "on"},
}
_BY_ROOM = {"Den": [_LBE["light.den1"]], "Study": [_LBE["light.study1"]]}
_OPTS = {"codeChip": True, "hitHalo": True, "collapseUnplaced": True, "barrierHit": True, "nowMs": 1790000000000}


def _draw(tmp_path: Path, calls: dict, model: dict | None = None, lbe: dict | None = None) -> dict:
    """{name: [focusZ, opts]} through the real renderer -> {name: svg}."""
    if _NODE is None:
        pytest.skip("node is not installed")
    for name in ("iso_lights", "light_codes", "room_color", "wall_geom"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"').replace('"./wall_geom.js"', '"./wall_geom.mjs"')
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    script = (
        "import * as M from './iso_lights.mjs';\n"
        f"const MODEL={json.dumps(model or _MODEL)},FLOORS={json.dumps(_FLOORS)},LBE={json.dumps(lbe or _LBE)},BY={json.dumps(_BY_ROOM)};\n"
        f"const CALLS={json.dumps(calls)};\n"
        "const out={};\n"
        "for(const [k,[z,o]] of Object.entries(CALLS)) out[k]=M.buildIsoSVG(MODEL,BY,new Set(),z,150,0,LBE,false,FLOORS,o);\n"
        "console.log(JSON.stringify(out));\n"
    )
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


def _ghosts(root: ET.Element) -> list:
    return [e for e in root if e.get("data-role") == "floorghost"]


@pytest.mark.parametrize("show", [False, True])
def test_all_has_no_fade_at_all(tmp_path, show) -> None:
    opts = {**_OPTS, "showcase": show}
    out = _draw(tmp_path, {"all": [None, opts], "both": [[0, 1], opts]})
    assert "floorghost" not in out["all"]
    assert all(s.endswith('opacity="1" pointer-events="none">') for s in re.findall(r'<g data-role="floorslab"[^>]*>', out["all"]))
    # Both floors chosen (the slider's pairs): the drawing All makes.
    assert out["both"] == out["all"]


@pytest.mark.parametrize("show", [False, True])
def test_the_chosen_floor_is_drawn_as_with_all(tmp_path, show) -> None:
    opts = {**_OPTS, "showcase": show}
    out = _draw(tmp_path, {"all": [None, opts], "main": [0, opts]})

    def part(s):
        return s[s.index('<g data-role="floorslab" data-z="0"'):s.index('<g data-role="floorslab" data-z="1"')]

    assert part(out["main"]) == part(out["all"])


@pytest.mark.parametrize("show", [False, True])
def test_a_faded_floor_is_one_faint_group_that_takes_no_tap(tmp_path, show) -> None:
    out = _draw(tmp_path, {"main": [0, {**_OPTS, "showcase": show}]})
    root = ET.fromstring(out["main"])
    ghosts = _ghosts(root)
    assert [g.get("data-z") for g in ghosts] == ["1"]
    g = ghosts[0]
    assert g.get("opacity") == "0.25" and g.get("pointer-events") == "none"
    classes = {e.get("class") for e in g.iter()}
    assert {"lroom", "lhex", "lhalo", "lstack", "lbarhit"} <= classes, classes
    assert any(e.tag.endswith("text") for e in g.iter()), "the floor's room names fade with it"
    live = [(e.tag, e.get("class"), e.get("pointer-events")) for e in g.iter() if e.get("pointer-events") not in (None, "none")]
    assert not live, live
    # The chosen floor's own targets stay live.
    fm = out["main"]
    assert re.search(r'class="lroom"[^>]*data-z="0"[^>]*><rect[^>]*pointer-events="all"', fm)
    assert re.search(r'class="lstack"[^>]*data-z="0"[^>]*pointer-events="all"', fm)
    assert re.search(r'class="lbarhit"[^>]*pointer-events="stroke"', fm)


def test_the_slab_and_badge_stay_outside_the_fade(tmp_path) -> None:
    root = ET.fromstring(_draw(tmp_path, {"main": [0, _OPTS]})["main"])
    top = list(root)
    slabs = [e for e in top if e.get("data-role") == "floorslab"]
    assert [(s.get("data-z"), s.get("opacity")) for s in slabs] == [("0", "1"), ("1", "0.25")]
    # atlas_aboard.js lays the people layer next to a slab in the drawing;
    # atlas_weather.js and the poll's patch read them at this level too.
    badges = [e for e in top if e.get("data-role") == "floor"]
    assert [b.get("pointer-events") for b in badges] == ["all", "all"]
    for g in _ghosts(root):
        assert not [e for e in g.iter() if e.get("data-role") in ("floorslab", "floor")]


def test_mappings_plate_lookup_still_skips_a_faded_plate() -> None:
    src = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "Number(op) < 0.5) continue;" in src
    fade = re.search(r"const GHOST_FLOOR_OPACITY = ([0-9.]+);", (_VIEWS / "iso_lights.js").read_text(encoding="utf-8"))
    assert fade and float(fade.group(1)) < 0.5


def test_a_door_circle_on_a_faded_floor_stays_in_hand(tmp_path) -> None:
    circle = {"doorCircleM": {"x_m": 1, "y_m": 1, "r_m": 1, "floorId": "up"}}
    out = _draw(tmp_path, {"faded": [0, {**_OPTS, **circle}], "chosen": [1, {**_OPTS, **circle}]})
    root = ET.fromstring(out["faded"])
    tops = [e for e in root if e.get("data-role") == "doorcircle"]
    assert len(tops) == 1 and tops[0].get("pointer-events") is None
    assert not [e for g in _ghosts(root) for e in g.iter() if e.get("data-role") == "doorcircle"]
    # On the chosen floor it stays where it always was: under that floor's markers.
    chosen = out["chosen"]
    assert chosen.index('data-role="doorcircle"') < chosen.index('<g class="lhex" data-eid="light.up"')


def test_alarms_and_the_locate_ring_stay_over_the_fade(tmp_path) -> None:
    model = {**_MODEL, "light_positions_m": {**_MODEL["light_positions_m"],
                                             "binary_sensor.leak_up": {"x_m": 3, "y_m": 2, "floor_id": "up"},
                                             "binary_sensor.leak_main": {"x_m": 3, "y_m": 2, "floor_id": "main"}}}
    lbe = {**_LBE,
           "binary_sensor.leak_up": {"entity_id": "binary_sensor.leak_up", "state": "on", "code": "L1", "isFlood": True},
           "binary_sensor.leak_main": {"entity_id": "binary_sensor.leak_main", "state": "on", "code": "L2", "isFlood": True}}
    out = _draw(tmp_path, {"main": [0, {**_OPTS, "locateEid": "light.up"}], "all": [None, {**_OPTS, "locateEid": "light.up"}]}, model=model, lbe=lbe)
    root = ET.fromstring(out["main"])
    inside = {e.get("class") for g in _ghosts(root) for e in g.iter()}
    assert "lflood" not in inside and "llocate" not in inside
    top = {e.get("class"): e for e in root}
    assert "lflood" in top and "llocate" in top
    assert top["lflood"].get("pointer-events") == "none" and top["llocate"].get("pointer-events") == "none"
    # With All they are where they always were: in the floor's run of parts,
    # the ring before that floor's first marker.
    a = out["all"]
    start = a.index('<g data-role="floorslab" data-z="1"')
    assert start < a.index('class="lflood" data-eid="binary_sensor.leak_up"') < a.index('<g class="lhex" data-eid="light.up"', start)


def test_an_underlay_is_not_faded_twice(tmp_path) -> None:
    under = {"underlay": [{"floor_id": "up", "pts": [[1, 1], [2, 2]], "opacity": 0.6, "color": "#abcdef"}]}
    out = _draw(tmp_path, {"main": [0, {**_OPTS, **under}]})
    root = ET.fromstring(out["main"])
    found = [e for g in _ghosts(root) for e in g.iter() if e.get("stroke") == "#abcdef"]
    assert len(found) == 1 and found[0].get("opacity") == "0.60"


def test_live_tracker_does_not_draw_with_this_renderer() -> None:
    # Live Tracker shows Overview's own map (overview.js's local buildIsoSVG):
    # neither takes the Atlas's from iso_lights.js.
    for name in ("purelive.js", "overview.js"):
        src = (_VIEWS / name).read_text(encoding="utf-8")
        imported = re.findall(r"const \{([^}]*)\}\s*=\s*await import\(`\./iso_lights\.js", src)
        assert imported, name
        assert all("buildIsoSVG" not in i for i in imported), name


def test_a_chosen_floor_off_screen_comes_into_view_at_100_percent() -> None:
    src = (_VIEWS / "lights_map.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    i = src.index("const switchTo = (idx) => {")
    body = src[i:src.index("\n      };\n", i)]
    assert body.index("rebuildISO();") < body.index("chosenIntoView(idx);")
    i = src.index("function chosenIntoView(idx) {")
    helper = src[i:src.index("\n  }\n", i)]
    assert "if (!scr || !idx || view.zoom > 1) return;" in helper
    assert "mid < 0 || mid > window.innerHeight" in helper
    assert "plates.every(off)" in helper and ".scrollIntoView(" in helper


def test_only_reading_the_saved_view_asks_for_the_scroll() -> None:
    src = (_WWW / "lights_panel.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    i = src.index("if(applyView){")
    assert "this._view.scrollToChosen = true;" in src[i:src.index("\n      }\n", i)]
    assert src.count("scrollToChosen") == 1
    # A kept card (the poll's update) returns before this; a new one asks once.
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert "if (view.scrollToChosen && sortedLevels.length) {\n    view.scrollToChosen = false;" in lm


def _place(tmp_path: Path, script: str) -> dict:
    """The real _wireLightsBuild over a stage of two plates: Main at viewBox y
    200-300, Up at y 0-100, and nothing anywhere else. place(tap) answers what
    the tap did to the queue's light; pin(drop) what the drop pin was handed."""
    if _NODE is None:
        pytest.skip("node is not installed")
    root = json.dumps(str(_ROOT / "tests" / "js" / "dom_shim.mjs"))
    maps = json.dumps(str(_VIEWS / "maps.js"))
    il = json.dumps(str(_VIEWS / "iso_lights.js"))
    js = tmp_path / "place.mjs"
    js.write_text(f"""
import {{ pathToFileURL }} from "node:url";
const {{ install }} = await import(pathToFileURL({root}).href);
install(globalThis);
const M = await import(pathToFileURL({maps}).href);
const IL = await import(pathToFileURL({il}).href);
const MODEL = {json.dumps({
    "floors": _FLOORS,
    "room_geometry_m": {"Kitchen": _rect("main", 0, 0, 6, 4), "Loft": _rect("up", 0, 0, 6, 4)},
    "light_positions_m": {"light.placed": {"x_m": 2, "y_m": 2, "floor_id": "up"}},
})};
const frame = IL.fabricFrame(MODEL, MODEL.floors, 150, 0);
const [LOW, HIGH] = frame.levels;
const NS = "http://www.w3.org/2000/svg";
const LBE = {{ "light.loose": {{ entity_id: "light.loose", code: "L1" }}, "light.placed": {{ entity_id: "light.placed", code: "P1" }} }};
function stage(chosen) {{
  const isoDiv = document.createElement("div"), svg = document.createElementNS(NS, "svg");
  isoDiv.appendChild(svg);
  svg.createSVGPoint = () => {{ const p = {{ x: 0, y: 0 }}; p.matrixTransform = () => ({{ x: p.x, y: p.y }}); return p; }};
  svg.getScreenCTM = () => ({{ inverse: () => ({{}}) }});
  for (const [z, y0] of [[LOW, 200], [HIGH, 0]]) {{
    const faded = chosen !== null && chosen !== z;
    const g = document.createElementNS(NS, "g");
    g.setAttribute("data-role", "floorslab"); g.setAttribute("data-z", String(z));
    g.setAttribute("opacity", faded ? "0.25" : "1");
    const top = document.createElementNS(NS, "polygon");
    top.setAttribute("data-role", "slabtop");
    top.setAttribute("points", `0,${{y0}} 100,${{y0}} 100,${{y0 + 100}} 0,${{y0 + 100}}`);
    g.appendChild(top); svg.appendChild(g);
    if (faded) {{
      const ghost = document.createElementNS(NS, "g");
      ghost.setAttribute("data-role", "floorghost"); ghost.setAttribute("data-z", String(z));
      svg.appendChild(ghost);
    }}
  }}
  const pinG = document.createElementNS(NS, "g");
  pinG.setAttribute("data-role", "dropmarker");
  svg.appendChild(pinG);
  return {{ isoDiv, svg, pinG }};
}}
function wire(chosen, queue, dropped) {{
  const s = stage(chosen);
  const ctx = {{ state: {{ model: MODEL }}, hass: {{}}, toast: () => {{}}, helpers: {{}}, actions: {{ renderRooms: () => {{}} }} }};
  const o = {{ mapState: {{ _placeQueue: queue }}, view: {{ floorGap: 150, horizGap: 0 }}, lightsByEid: LBE, model: MODEL,
    onDropPlace: (x, y, z) => dropped.push([x, y, z]), toggle: () => {{}} }};
  M._wireLightsBuild(ctx, s.isoDiv, o);
  return {{ ...s, o }};
}}
function place(chosen, eid, x, y) {{
  const s = wire(chosen, [eid], []);
  s.svg.dispatchEvent({{ type: "click", target: s.svg, clientX: x, clientY: y }});
  const d = (s.o.mapState._lightsDraftM || {{}})[eid];
  return {{ floor: d ? d.floor_id : null, left: s.o.mapState._placeQueue.length }};
}}
function pin(chosen, x, y) {{
  const dropped = [], s = wire(chosen, [], dropped);
  const ev = {{ button: 0, pointerType: "mouse", pointerId: 1, preventDefault() {{}}, stopPropagation() {{}} }};
  s.pinG.dispatchEvent({{ ...ev, type: "pointerdown", clientX: 500, clientY: 500 }});
  s.pinG.dispatchEvent({{ ...ev, type: "pointermove", clientX: x, clientY: y }});
  const during = s.pinG.getAttribute("transform");
  s.pinG.dispatchEvent({{ ...ev, type: "pointerup", clientX: x, clientY: y }});
  return {{ dropped, z: dropped.length ? dropped[0][2] : "none", moved: !!during, transform: s.pinG.getAttribute("transform") }};
}}
const out = {{ LOW, HIGH }};
{script}
console.log(JSON.stringify(out));
""", encoding="utf-8")
    res = subprocess.run([_NODE, str(js)], capture_output=True, text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_with_a_floor_chosen_only_its_plate_takes_a_queued_light(tmp_path) -> None:
    out = _place(tmp_path, """
out.loose_on_chosen = place(LOW, "light.loose", 50, 250);
out.loose_on_faded = place(LOW, "light.loose", 50, 50);
out.loose_off_plates = place(LOW, "light.loose", 300, 150);
out.placed_on_faded_own_floor = place(LOW, "light.placed", 50, 50);
out.placed_off_plates = place(LOW, "light.placed", 300, 150);
out.upper_chosen = place(HIGH, "light.loose", 50, 50);
out.lower_faded = place(HIGH, "light.loose", 50, 250);
""")
    assert out["loose_on_chosen"] == {"floor": "main", "left": 0}
    assert out["upper_chosen"] == {"floor": "up", "left": 0}
    for ignored in ("loose_on_faded", "loose_off_plates", "placed_on_faded_own_floor", "placed_off_plates", "lower_faded"):
        assert out[ignored] == {"floor": None, "left": 1}, ignored


def test_with_all_a_queued_light_lands_as_it_always_did(tmp_path) -> None:
    out = _place(tmp_path, """
out.on_low = place(null, "light.loose", 50, 250);
out.on_high = place(null, "light.loose", 50, 50);
out.off_plates = place(null, "light.loose", 300, 150);
out.placed_on_low = place(null, "light.placed", 50, 250);
""")
    assert out["on_low"] == {"floor": "main", "left": 0}
    assert out["on_high"] == {"floor": "up", "left": 0}
    assert out["off_plates"] == {"floor": "main", "left": 0}   # the lowest floor
    assert out["placed_on_low"] == {"floor": "up", "left": 0}  # its own floor


def test_the_drop_pin_follows_the_same_rule(tmp_path) -> None:
    out = _place(tmp_path, """
out.chosen = pin(LOW, 50, 250);
out.faded = pin(LOW, 50, 50);
out.off = pin(LOW, 300, 150);
out.all_on_high = pin(null, 50, 50);
out.all_off = pin(null, 300, 150);
""")
    assert out["chosen"]["z"] == out["LOW"]
    for name in ("faded", "off"):
        assert out[name]["moved"] and out[name]["dropped"] == [] and out[name]["transform"] is None, name
    assert out["all_on_high"]["z"] == out["HIGH"]
    assert out["all_off"]["z"] is None and len(out["all_off"]["dropped"]) == 1


def test_a_changed_ring_stays_with_its_floor_in_traceback(tmp_path) -> None:
    """Not an alarm: a mark on a past moment that the status line names, so it
    fades with its floor. The leak and open-window rings stay above the fade."""
    out = _draw(tmp_path, {"faded": [0, {**_OPTS, "changedEids": ["light.up"]}], "chosen": [1, {**_OPTS, "changedEids": ["light.up"]}]})
    faded = [e for g in _ghosts(ET.fromstring(out["faded"])) for e in g.iter() if e.get("class") == "lchanged"]
    assert len(faded) == 1 and faded[0].get("data-eid") == "light.up"
    assert not _ghosts(ET.fromstring(out["chosen"])) or not [
        e for g in _ghosts(ET.fromstring(out["chosen"])) for e in g.iter() if e.get("class") == "lchanged"]


# ── The sidebar Atlas page stays dark, and the words say so ──────────────────
_HELP_SHORT = "The sidebar Atlas page stays dark with every theme, Light (inverted) included."
_HELP_LONG = "The sidebar page stays dark with every theme in Settings. Light (inverted) doesn't change it either, so it won't help here if you can't use a dark screen."


def test_settings_says_the_sidebar_atlas_stays_dark() -> None:
    src = (_VIEWS / "settings.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    i = src.index("It takes effect immediately, in every browser.")
    words = re.sub(r'"\s*\+\s*"', "", src[i:i + 330])
    assert "The sidebar Atlas page is the exception: it stays dark with every theme" in words
    assert "Light doesn't change it either" in words and "if you can't use a dark screen" in words


def test_help_says_it_in_english_and_each_language() -> None:
    help_src = (_WWW / "help_content.js").read_text(encoding="utf-8")
    assert help_src.count(_HELP_SHORT) == 1 and help_src.count(_HELP_LONG) == 1
    keys = re.findall(r't\("((?:[^"\\]|\\.)*)"\)', help_src)
    wanted = [json.loads(f'"{k}"') for k in keys if _HELP_SHORT in k or _HELP_LONG in k]
    assert len(wanted) == 2
    for lang in ("de", "fr", "nl"):
        table = json.loads((_WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        for key in wanted:
            assert key in table, (lang, key[:60])
            assert "Light (inverted)" in table[key], (lang, key[:60])
