# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Traceback's Full house activity (Garry, 2026-09-23) — the PadSpan Pro
option that plays the whole house back on the Atlas map: every light, door,
lock and motion sensor as it was at the frame's moment, beacons on top in
Traceback's own marker style.

The Atlas drawing is a pure function of entity states and a "now", so the
correctness that matters lives in views/house_activity.js's pure helpers:
rebuilding hass.states for a moment from recorder history, the event list,
and each frame's beacons. Those run here under node; the gate is a static
check, the same way test_atlas_layout_v2_pro_gate.py pins the Atlas one.

Runs the real module under node; skipped, not failed, without node.
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
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const HA = await import(pathToFileURL({json.dumps(str(_VIEWS / 'house_activity.js'))}).href);\n"
        "const out={};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# HA's compressed history rows: s=state, a=attributes, lu=last_updated (s),
# lc=last_changed when it differs. The first row is the start-of-window state.
_HISTORY = """
const history = {
  "light.kitchen": [
    {s:"off", a:{friendly_name:"Kitchen"}, lu:1000},
    {s:"on",  a:{friendly_name:"Kitchen", brightness:200}, lu:1100},
    {s:"on",  lu:1150},
    {s:"off", lu:1300},
  ],
  "binary_sensor.front_door": [
    {s:"off", a:{friendly_name:"Front door"}, lu:900},
    {s:"on", lu:1200},
  ],
};
"""


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_states_at_rebuilds_each_entity_as_it_was_at_that_moment():
    out = _run(_HISTORY + """
const tl = HA.buildStateTimeline(history);
const live = {"light.kitchen": {state:"LIVE"}, "light.unrecorded": {state:"on"}};
const eids = ["light.kitchen", "binary_sensor.front_door", "light.unrecorded"];
const at = (t) => HA.statesAt(tl, live, eids, t * 1000);
out.before = at(1050)["light.kitchen"].state;
out.during = at(1160)["light.kitchen"].state;
out.bri = at(1160)["light.kitchen"].attributes.brightness;
out.after = at(1400)["light.kitchen"].state;
out.door = [at(1100)["binary_sensor.front_door"].state, at(1250)["binary_sensor.front_door"].state];
out.unrecorded = at(1100)["light.unrecorded"].state;
out.lc = at(1160)["light.kitchen"].last_updated;
""")
    assert out["before"] == "off"
    assert out["during"] == "on"
    # A row HA sent without attributes keeps the previous row's.
    assert out["bri"] == 200
    assert out["after"] == "off"
    assert out["door"] == ["off", "on"]
    # Not in the recorder at all: nothing else to show but its live state.
    assert out["unrecorded"] == "on"
    assert out["lc"] == "1970-01-01T00:19:10.000Z"


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_activity_events_are_real_changes_inside_the_window_only():
    out = _run(_HISTORY + """
const tl = HA.buildStateTimeline(history);
out.ev = HA.activityEvents(tl, (e) => e, 1000 * 1000, 1250 * 1000)
  .map(e => [e.t / 1000, e.eid, e.from, e.to]);
""")
    # The start-state rows (lu 1000, 900) are not changes; lu 1150 is an
    # attribute-only update; lu 1300 is outside the window.
    assert out["ev"] == [
        [1100, "light.kitchen", "off", "on"],
        [1200, "binary_sensor.front_door", "off", "on"],
    ]


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_beacons_for_frame_carry_traceback_style_and_a_same_floor_trail():
    out = _run("""
const model = { room_geometry_m: { Kitchen: { type:"poly", floor_id:"main", points_m:[[0,0],[4,0],[4,2],[0,2]] } } };
const frames = [
  { ts: 1, o: [ {k:"a", r:"Hall", x_m:1, y_m:1, f:"main"}, {k:"scanner", r:"Hall", x_m:0, y_m:0, f:"main"} ] },
  { ts: 2, o: [ {k:"a", r:"Hall", x_m:2, y_m:1, f:"up"} ] },
  { ts: 3, o: [ {k:"a", r:"Hall", x_m:3, y_m:1, f:"main"}, {k:"b", r:"kitchen"} ] },
];
const b = HA.beaconsForFrame(frames, 2, model, {
  keep: (o) => o.k !== "scanner", colorOf: (k) => k === "a" ? "#fbbf24" : "#60a5fa", labelOf: (o) => o.k.toUpperCase(),
});
out.b = b.map(x => ({ key:x.key, label:x.label, room:x.room, x:x.x_m, y:x.y_m, f:x.floor_id, color:x.color, trail:x.trail }));
out.scannerDropped = HA.beaconsForFrame(frames, 0, model, { keep: (o) => o.k !== "scanner" }).map(x => x.key);
""")
    a, b = out["b"]
    assert a == {"key": "a", "label": "A", "room": "Hall", "x": 3, "y": 1, "f": "main",
                 "color": "#fbbf24", "trail": [[1, 1]]}   # the "up"-floor fix is not trailed across floors
    # Room-only record: the room's metre centroid, found case-insensitively.
    assert (b["x"], b["y"], b["f"], b["color"]) == (2, 1, "main", "#60a5fa")
    assert out["scannerDropped"] == ["a"]


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_vacation_mode_switching_is_marked_and_a_persons_is_not():
    out = _run("""
const ev = [
  { t: 1000_000, eid: "light.a", from: "off", to: "on" },   // VM asked on at 995 s
  { t: 2000_000, eid: "light.a", from: "on", to: "off" },   // a person: no VM action near it
  { t: 3000_000, eid: "light.b", from: "off", to: "on" },   // VM asked OFF, not on
  { t: 4000_000, eid: "light.a", from: "off", to: "on" },   // VM action 5 min earlier: too old
];
const acts = [[995, "light.a", 1], [2999, "light.b", 0], [3700, "light.a", 1]];
out.marked = HA.markVacationEvents(ev, acts).map(e => e.vacation);
out.inVac = [HA.inVacation([[100, 200], [500, null]], 150_000), HA.inVacation([[100, 200]], 250_000),
             HA.inVacation([[500, null]], 9e9)];
""")
    assert out["marked"] == [True, False, False, False]
    assert out["inVac"] == [True, False, True]


def test_full_house_activity_is_offered_to_pro_only():
    src = (_VIEWS / "traceback.js").read_text(encoding="utf-8")
    m = re.search(r"const _houseOK = ([^;]+);", src)
    assert m, "traceback.js no longer computes _houseOK"
    assert 'tierAtLeast(currentTier(ctx.state.settings), "pro")' in m.group(1)
    # The switch is only put on screen at all when _houseOK holds…
    assert "if (_houseOK) modeRow.appendChild(houseBtn);" in src
    # …and a stored "on" does nothing below Pro.
    assert re.search(r"const _houseActive = \(\) => _houseOK && tb\.house\.on", src)


def test_house_activity_asks_home_assistant_not_a_new_store():
    src = (_VIEWS / "house_activity.js").read_text(encoding="utf-8")
    assert '"history/history_during_period"' in src
    assert "include_start_time_state: true" in src


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_render_house_frame_draws_the_atlas_with_the_frames_beacons():
    """End to end through the real Atlas builder: the frame's beacon is drawn
    in its playback colour, and nothing throws before the registry lands."""
    out = _run("""
const ctx = {
  state: { model: { floors: [{ id: "main", level: 0, name: "Main" }], areas: [],
             room_geometry_m: { Hall: { type:"poly", floor_id:"main", points_m:[[0,0],[5,0],[5,4],[0,4]] } } },
           settings: { tier: "pro" }, _modelLoaded: false },
  hass: { states: { "light.hall": { entity_id:"light.hall", state:"on", attributes:{ friendly_name:"Hall" } } },
          callWS: async () => ({}) },
};
const hs = { timeline: null, events: [], eids: [] };
const frames = [{ ts: 100, o: [{ k:"phone", r:"Hall", x_m:2, y_m:2, f:"main" }] }];
const svg = HA.renderHouseFrame(ctx, hs, frames, 0, { colorOf: () => "#fbbf24", labelOf: () => "Phone" }, () => {});
out.isSvg = svg.includes("<svg");
out.beacon = svg.includes("#fbbf24") && svg.includes(">Phone<");
out.eids = hs.eids;
""")
    assert out["isSvg"]
    assert out["beacon"]
    assert out["eids"] == ["light.hall"]
