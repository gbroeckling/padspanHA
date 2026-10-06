# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The flat Atlas's open door, Sims style (Garry, 2026-10-05: "in atlas, you
never got the door looking like it's open, fix in sim style").

A linked door that reads open keeps its clear gap (Garry, 2026-09-10: no grey
line where the door is) and now draws its leaf swung open beside it: a short
upright panel turned into the room from its hinge with a faint quarter circle
for its swing, or a door of another type as it stands open (slid, folded, two
leaves, a dashed outline at the head for one that lifts). Hinge, swing and type
are Live Aboard's own rule and file (views/door_types.js, shared, never
copied). The drawing changes only there: a shut door, a door with no reading,
a window and every other part of the map are byte for byte what they were, and
with the door rules missing the open door is the bare gap it always was.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")


def _run(tmp_path: Path, script: str, doors: bool = True) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    for name in ("iso_lights", "light_codes", "room_color", "wall_geom", "door_types"):
        if name == "door_types" and not doors:
            continue
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace("./light_codes.js${new URL(import.meta.url).search}", "./light_codes.mjs")
        src = src.replace("./door_types.js${new URL(import.meta.url).search}", "./door_types.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"')
        src = src.replace('"./wall_geom.js"', '"./wall_geom.mjs"')
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# Two rooms on Main: the Hall and the Den, a door between them at x = 4 (the
# Den's side is +x), and a front door on the Hall's outside wall.
_MODEL = {
    "room_geometry_m": {
        "Hall": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
        "Den": {"type": "poly", "floor_id": "main", "points_m": [[4, 0], [8, 0], [8, 4], [4, 4]]},
    },
    "rf_barriers_m": [
        {"id": "bar_den", "name": "Den door", "material": "wood", "floor_id": "main", "points_m": [[4, 1], [4, 1.9]],
         "linked_entity_id": "binary_sensor.den_door"},
        {"id": "bar_front", "name": "Front door", "material": "wood", "floor_id": "main", "points_m": [[1, 0], [1.9, 0]],
         "linked_entity_id": "binary_sensor.front_door"},
        {"id": "bar_win", "name": "Hall window", "material": "glass", "floor_id": "main", "points_m": [[0, 1], [0, 2]],
         "linked_entity_id": "binary_sensor.hall_window"},
        # A door linked to nothing: the flat lights map draws no unlinked wall
        # (they are the Rooms tab's), whatever Live Aboard's file says of it.
        {"id": "bar_pantry", "name": "Pantry door", "material": "wood", "floor_id": "main", "points_m": [[6, 4], [6.9, 4]]},
    ],
}
_FLOORS = [{"id": "main", "name": "Main", "level": 0}]


def _lbe(den="off", front="off", win="off", den_class="door"):
    rec = lambda eid, st, dc: {"entity_id": eid, "state": st, "device_class": dc, "isDoor": dc != "window"}  # noqa: E731
    return {"binary_sensor.den_door": rec("binary_sensor.den_door", den, den_class),
            "binary_sensor.front_door": rec("binary_sensor.front_door", front, "door"),
            "binary_sensor.hall_window": rec("binary_sensor.hall_window", win, "window")}


def _script(cases: dict, model: dict | None = None) -> str:
    """cases: {name: (lbe, opts)} or {name: (lbe, opts, model)}."""
    body = ["import * as M from './iso_lights.mjs';",
            f"const MODEL={json.dumps(model or _MODEL)};", f"const FLOORS={json.dumps(_FLOORS)};",
            "const R=(lbe, opts={}, m=MODEL)=>M.buildIsoSVG(m,{},new Set(),null,150,0,lbe,false,FLOORS,{barrierHit:true,...opts});",
            "const out={};"]
    for k, (lbe, opts, *m) in cases.items():
        body.append(f"out[{json.dumps(k)}]=R({json.dumps(lbe)},{json.dumps(opts)}{',' + json.dumps(m[0]) if m else ''});")
    body.append("console.log(JSON.stringify(out));")
    return "\n".join(body)


_LEAF = re.compile(r'<g class="lvdoorleaf"[^>]*>.*?</g>', re.S)
_NO_PANTRY = {**_MODEL, "rf_barriers_m": [b for b in _MODEL["rf_barriers_m"] if b["id"] != "bar_pantry"]}
# Live Aboard's file says the unlinked Pantry door stands open, or is a
# sliding door shown ajar: the flat Atlas draws none of it.
_PANTRY_SAID = {"bar_pantry": {"shown": "open"}}
_PANTRY_SLID = {"bar_pantry": {"shown": "ajar", "type": "sliding"}}



def test_an_open_door_draws_its_leaf_and_nothing_else_changes(tmp_path) -> None:
    out = _run(tmp_path, _script({"shut": (_lbe(), {}), "open": (_lbe(den="on"), {}), "bare": (_lbe(), {}, _NO_PANTRY),
                                  "said": (_lbe(den="on"), {"doorOpenings": _PANTRY_SAID}),
                                  "slid": (_lbe(den="on"), {"doorOpenings": _PANTRY_SLID})}))
    shut, opened = out["shut"], out["open"]
    # The unlinked Pantry door draws nothing, as ever: not shut, not with a
    # door open beside it, and not whatever Live Aboard says of it.
    assert shut == out["bare"] and out["said"] == opened and out["slid"] == opened
    leaves = _LEAF.findall(opened)
    assert len(leaves) == 1 and not _LEAF.findall(shut)
    leaf = leaves[0]
    assert 'pointer-events="none"' in leaf and "<polygon" in leaf and 'stroke-dasharray="2,3"' in leaf, leaf
    # The gap stays clear: the shut door's grey line is gone, and that line and
    # the leaf are the only difference in the whole drawing.
    grey = [m.group(0) for m in re.finditer(r'<polyline points="[^"]+" fill="none" stroke="#94a3b8" stroke-width="2\.6"[^>]*/>', shut)]
    missing = [g for g in grey if g not in opened]          # the Den door's line, and only it (the front door and the window stay)
    assert len(grey) == 3 and len(missing) == 1
    den_grey = missing[0]
    assert opened.replace(leaf, "") == shut.replace(den_grey, "")
    # The hit-line stays the tap target.
    assert opened.count('class="lbarhit"') == 3 and 'data-eid="binary_sensor.den_door"' in opened


def test_the_leaf_swings_into_the_room_from_its_hinge_by_live_aboards_rule(tmp_path) -> None:
    stored = {"bar_den": {"hinge": "right", "swing": "out"}}
    out = _run(tmp_path, _script({"plain": (_lbe(den="on"), {}), "stored": (_lbe(den="on"), {"doorOpenings": stored}),
                                  "same": (_lbe(den="on"), {"doorOpenings": {"bar_den": {"hinge": "left", "swing": "in"}}})}))
    a, b, c = (_LEAF.findall(out[k])[0] for k in ("plain", "stored", "same"))
    assert a != b, "a stored hinge and swing move the leaf"
    assert a == c, "the stored defaults are the default"


def test_other_door_types_as_they_stand_open(tmp_path) -> None:
    out = _run(tmp_path, _script({
        "sliding": (_lbe(den="on"), {"doorOpenings": {"bar_den": {"type": "sliding"}}}),
        "double": (_lbe(den="on"), {"doorOpenings": {"bar_den": {"type": "double"}}}),
        "bifold": (_lbe(den="on"), {"doorOpenings": {"bar_den": {"type": "bifold", "panels": 4}}}),
        "garage": (_lbe(den="on", den_class="garage_door"), {}),
        "rollup": (_lbe(den="on"), {"doorOpenings": {"bar_den": {"type": "rollup"}}}),
    }))
    poly = lambda leaf: leaf.count("<polygon")  # noqa: E731
    sl, db, bf, gar, ru = (_LEAF.findall(out[k])[0] for k in ("sliding", "double", "bifold", "garage", "rollup"))
    assert poly(sl) == 2 and 'stroke-dasharray="2,3"' not in sl, sl         # two panels, no swing
    assert poly(db) == 2 and sl.count("<polyline") == 0 and db.count("<polyline") == 2, db
    assert poly(bf) == 4, bf
    for lifted in (gar, ru):                                                 # a dashed outline at the head
        assert poly(lifted) == 1 and 'fill="none"' in lifted and 'stroke-dasharray="3,3"' in lifted, lifted


def test_shut_no_reading_and_windows_are_as_they_were(tmp_path) -> None:
    out = _run(tmp_path, _script({
        "shut": (_lbe(), {}),
        "offline": (_lbe(den="unavailable"), {}),
        "offlineAjar": (_lbe(den="unavailable"), {"doorOpenings": {"bar_den": {"shown": "ajar"}}}),
        "offlineShut": (_lbe(den="unavailable"), {"doorOpenings": {"bar_den": {"shown": "shut"}}}),
        "windowOpen": (_lbe(win="on"), {}),
        "shutStored": (_lbe(), {"doorOpenings": {"bar_den": {"shown": "ajar", "type": "barn"}}}),
    }))
    assert not _LEAF.findall(out["shut"]) and not _LEAF.findall(out["offline"]) and not _LEAF.findall(out["windowOpen"])
    assert out["shutStored"] == out["shut"], "a shut door draws its grey line as ever, whatever Live Aboard stores"
    assert out["offlineShut"] == out["offline"]
    # No reading, but Live Aboard shows it ajar: the dashed no-reading line stays, and its leaf is ajar.
    ajar = _LEAF.findall(out["offlineAjar"])
    assert len(ajar) == 1 and out["offlineAjar"].replace(ajar[0], "") == out["offline"]


def test_without_the_door_rules_an_open_door_is_the_bare_gap_it_was(tmp_path) -> None:
    """The door rules load optionally: missing, the flat map is exactly the
    old drawing, and with no door open the rules change nothing at all."""
    script = _script({"open": (_lbe(den="on"), {}), "shut": (_lbe(), {}), "said": (_lbe(), {"doorOpenings": _PANTRY_SAID}),
                      "noPantry": (_lbe(), {}, _NO_PANTRY)})
    bare = _run(tmp_path, script, doors=False)
    (tmp_path / "door_types.mjs").unlink(missing_ok=True)
    full_dir = tmp_path / "full"
    full_dir.mkdir()
    full = _run(full_dir, script, doors=True)
    assert not _LEAF.findall(bare["open"])
    # The unlinked Pantry door, said open in Live Aboard's file, draws
    # nothing: the old drawing with or without it, byte for byte.
    assert full["shut"] == bare["shut"] == full["said"] == bare["said"] == full["noPantry"] == bare["noPantry"]
    assert _LEAF.sub("", full["open"]) == bare["open"]


def test_a_wide_door_is_drawn_as_live_aboard_guesses_it(tmp_path) -> None:
    """One first guess (door_types.js guessDoorType) for the flat Atlas and
    Live Aboard: open, a 2.44 m patio door is slid aside, and a plain door
    wider than a double lifts (a dashed outline at the head), as Live Aboard
    draws them."""
    def wide(name):
        return {**_MODEL, "rf_barriers_m": [{**_MODEL["rf_barriers_m"][0], "name": name, "points_m": [[4, 0.5], [4, 2.94]]}]}
    out = _run(tmp_path, _script({"patio": (_lbe(den="on"), {}, wide("Patio door")), "plain": (_lbe(den="on"), {}, wide("Den door"))}))
    patio, plain = (_LEAF.findall(out[k])[0] for k in ("patio", "plain"))
    assert patio.count("<polygon") == 2 and 'stroke-dasharray="3,3"' not in patio, patio
    assert plain.count("<polygon") == 1 and 'fill="none"' in plain and 'stroke-dasharray="3,3"' in plain, plain


def test_the_rules_are_shared_not_copied() -> None:
    iso = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    house = (_VIEWS / "live_aboard_house.js").read_text(encoding="utf-8")
    want = "import(`./door_types.js${new URL(import.meta.url).search}`)"
    assert want in iso and ".catch(" in iso[iso.index(want):iso.index(want) + 120]
    assert want in house and "return doorSwing(pc, rooms, stored);" in house
    assert "DOORS.doorSwing(pc, rooms, pc.override)" in iso
    # The card hands the flat map Live Aboard's own file's openings only when it has read them.
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert 'doorOpenings: abData && abData.openings && typeof abData.openings === "object" ? abData.openings : null' in lm
