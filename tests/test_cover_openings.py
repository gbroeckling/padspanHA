# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Blinds, shades, garage doors and gates (cover.*) follow their state.

A cover is the same opening a door/window contact sensor is, seen from the
motor's side: it joins the Atlas's Doors/Windows class (light_codes.js
isDoorSensor), links to its wall section the same way, and reads open while
any of it is open or it is moving (openingOpen). Part-way open, the row says
how far ("OPEN 40%") and the wall carries a small "40%". Live Aboard reads it
by the same rule (live_aboard_house.js openingState). A closed cover draws
exactly what a closed contact sensor draws; contact sensors are unchanged.

Runs the real modules under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    imp = lambda name: f"pathToFileURL({json.dumps(str(_VIEWS / name))}).href"  # noqa: E731
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const LC = await import({imp('light_codes.js')});\n"
        f"const LM = await import({imp('lights_map.js')});\n"
        f"const ISO = await import({imp('iso_lights.js')});\n"
        f"const H = await import({imp('live_aboard_house.js')});\n"
        "const out={};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_opening_covers_join_the_atlas_and_a_damper_does_not():
    out = _run("""
const C = [['cover.garage', {device_class:'garage'}], ['cover.den_blind', {device_class:'blind'}],
           ['cover.gate', {device_class:'gate'}], ['cover.plain', {}], ['cover.duct', {device_class:'damper'}],
           ['binary_sensor.front_door', {device_class:'door'}], ['binary_sensor.batt', {device_class:'battery'}]];
out.admitted = C.map(([e,a]) => LC.isAtlasEntity(e, a));
const ST = {'cover.den_blind': {state:'open', attributes:{device_class:'blind', current_position:40, friendly_name:'Den blind'}}};
// Release review: a cover is on the Atlas only once it is linked to a wall.
out.unlinked = LM.gatherLights(ST, {}).length;
const recs = LM.gatherLights(ST, {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, null, new Set(['cover.den_blind']));
out.isDoor = !!recs[0].isDoor; out.position = recs[0].position;
""")
    assert out["admitted"] == [True, True, True, True, False, True, False]
    assert out["isDoor"] is True and out["position"] == 40
    assert out["unlinked"] == 0, "a house's blinds aren't new Atlas rows until one is linked to a wall"


def test_a_cover_is_open_while_any_of_it_is_and_never_inverted():
    out = _run("""
const cv = (state, position=null) => ({entity_id:'cover.x', state, position});
out.cases = [cv('open', 40), cv('closed', 0), cv('open'), cv('closed'), cv('closing', 0), cv('opening'), cv('unknown')]
  .map(l => LC.openingOpen(l));
out.inverted = LC.openingOpen(cv('closed', 0), true);
out.pct = [cv('open', 40), cv('open'), cv('closed'), cv('unknown'), {entity_id:'binary_sensor.d', state:'on'}].map(LC.coverPercent);
const bs = (state) => ({entity_id:'binary_sensor.d', state});
out.sensor = [LC.openingOpen(bs('on')), LC.openingOpen(bs('off')), LC.openingOpen(bs('on'), true), LC.openingOpen(bs('off'), true)];
""")
    assert out["cases"] == [True, False, True, False, True, True, False]
    assert out["inverted"] is False
    assert out["pct"] == [40, 100, 0, None, None]
    assert out["sensor"] == [True, False, False, True]


def test_the_row_says_how_far_and_left_open_health_counts_a_cover():
    out = _run("""
const d = (state, position) => ({entity_id:'cover.den_blind', isDoor:true, state, position});
out.words = [d('open', 40), d('open', 100), d('closed', 0), d('unavailable', null)].map(l => LM.stateWordOf(l, null, {}).text);
const now = Date.parse('2026-10-21T12:00:00Z');
const h = LC.healthOf({...d('open', 40), last_changed: '2026-10-21T01:00:00Z'}, now);
out.healthy = h.healthy; out.reason = h.reason;
""")
    assert out["words"] == ["OPEN 40%", "OPEN", "CLOSED", "NO READING"]
    assert out["healthy"] is False and "Open for" in out["reason"]


_MODEL = {
    "room_geometry_m": {
        "Hall": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
    },
    "rf_barriers_m": [
        {"id": "bar_win", "name": "Hall window", "material": "glass", "floor_id": "main", "points_m": [[0, 1], [0, 2]],
         "linked_entity_id": "LINK"},
    ],
}


def _draw(eid: str, state: str, dc: str, position=None) -> str:
    model = json.loads(json.dumps(_MODEL).replace("LINK", eid))
    return (f"ISO.buildIsoSVG({json.dumps(model)},{{}},new Set(),null,150,0,"
            f"{{{json.dumps(eid)}:{{entity_id:{json.dumps(eid)},state:{json.dumps(state)},device_class:{json.dumps(dc)},"
            f"position:{json.dumps(position)},isDoor:true}}}},false,[{{id:'main',name:'Main',level:0}}],{{barrierHit:true}})")


def test_the_atlas_wall_follows_a_blind_and_a_closed_one_draws_as_a_closed_sensor():
    out = _run(f"""
const S = (s, eid) => s.split(eid).join('EID');
out.part = {_draw('cover.hall_blind', 'open', 'blind', 40)};
out.full = {_draw('cover.hall_blind', 'open', 'blind', 100)};
out.shutCover = S({_draw('cover.hall_blind', 'closed', 'blind', 0)}, 'cover.hall_blind');
out.shutSensor = S({_draw('binary_sensor.hall_window', 'off', 'window')}, 'binary_sensor.hall_window');
out.openSensor = {_draw('binary_sensor.hall_window', 'on', 'window')};
const bar = {{invert_state:false}};
out.la = [H.openingState(bar, {{entity_id:'cover.b', state:'open', position:40}}),
          H.openingState(bar, {{entity_id:'cover.b', state:'closed', position:0}}),
          H.openingState(bar, {{entity_id:'cover.b', state:'unavailable'}}),
          H.openingState(bar, {{entity_id:'binary_sensor.w', state:'on'}})];
""")
    assert ">40%</text>" in out["part"]
    assert "lv-coverpct" not in out["full"] and "lv-coverpct" not in out["openSensor"]
    # Open: the wall line is gone, as for an open contact sensor.
    assert 'stroke="#94a3b8" stroke-width="2.6"' not in out["part"]
    assert out["shutCover"] == out["shutSensor"]
    assert out["la"] == ["open", "closed", "none", "open"]


def test_the_cover_percent_grows_on_a_wall_screen_like_the_room_names():
    one = _draw('cover.hall_blind', 'open', 'blind', 40)
    wall = one[:-2] + ",labelScale:2})"
    out = _run(f"out.one = {one};\nout.wall = {wall};")
    import re
    pct = lambda s: re.search(r'<text class="lv-coverpct"[^>]*font-size="([\d.]+)"', s).group(1)  # noqa: E731
    assert pct(out["one"]) == "8"
    assert pct(out["wall"]) == "16"
