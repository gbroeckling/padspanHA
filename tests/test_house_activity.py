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
    # Not in the recorder at all: what it was then is unknown — never today's state.
    assert out["unrecorded"] == "unknown"
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


# ── Review round, 2026-09-23 ─────────────────────────────────────────────────


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_start_of_window_row_is_not_a_change():
    """HA's include_start_time_state row carries lu = the window start and no
    lc. Taken at face value every quiet motion sensor read 'just triggered'
    at the start of every playback."""
    out = _run("""
const start = 1_000_000;                       // window start, seconds
const rows = { "binary_sensor.hall": [{ s: "off", lu: start }] , "binary_sensor.den": [{ s: "on", lu: start }],
               "binary_sensor.bath": [{ s: "off", lu: start }, { s: "on", lu: start + 60 }] };
const live = { "binary_sensor.hall": { state: "off", last_changed: new Date((start - 86400) * 1000).toISOString() },
               "binary_sensor.bath": { state: "on", last_changed: new Date((start + 60) * 1000).toISOString() } };
const tl = HA.buildStateTimeline(rows, { startMs: start * 1000, live });
out.hall = tl["binary_sensor.hall"][0].lc / 1000;      // unchanged since: the live last_changed
out.den = tl["binary_sensor.den"][0].lc / 1000;        // no live row: on at the start -> the start
out.bath = tl["binary_sensor.bath"][0].lc;             // changed since: unknown -> 0
out.bathChange = tl["binary_sensor.bath"][1].lc / 1000;
""")
    assert out == {"hall": 1_000_000 - 86400, "den": 1_000_000, "bath": 0, "bathChange": 1_000_060}


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_numeric_readings_and_unavailable_flaps_are_not_events():
    out = _run("""
const tl = HA.buildStateTimeline({
  "sensor.kitchen_temp": [{ s: "20.1", lu: 1 }, { s: "20.2", lu: 2 }, { s: "20.3", lu: 3 }],
  "light.a": [{ s: "off", lu: 1 }, { s: "unavailable", lu: 2 }, { s: "off", lu: 3 }, { s: "on", lu: 4 }],
});
out.ev = HA.activityEvents(tl, e => e, 0, 10_000).map(e => [e.eid, e.from, e.to]);
""")
    assert out["ev"] == [["light.a", "off", "on"]]


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_merge_house_frames_carries_beacons_briefly_then_draws_nobody():
    out = _run("""
const raw = [{ ts: 100, o: [{ k: "a" }] }, { ts: 110, o: [{ k: "a" }] }];
const ev = [{ t: 120_000 }, { t: 500_000 }, { t: 110_000 }];     // +10 s, +390 s, and one on a beacon frame
const m = HA.mergeHouseFrames(raw, ev);
out.ts = m.map(f => f.ts);
out.carried = m.find(f => f.ts === 120).o.map(o => o.k);
out.empty = m.find(f => f.ts === 500).o.length;
out.untouched = HA.mergeHouseFrames(raw, []) !== raw && HA.mergeHouseFrames(raw, []).length === 2;
""")
    assert out == {"ts": [100, 110, 120, 500], "carried": ["a"], "empty": 0, "untouched": True}


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_replaying_history_never_touches_a_lights_remembered_brightness():
    """A replayed frame overwrote padspan_ha_last_bri, so the next tap turned
    the light on at last week's level."""
    out = _run("""
const LM = await import(new URL("./lights_map.js", pathToFileURL(%s + "/")).href);
const live = { "light.k": { entity_id: "light.k", state: "on", attributes: { friendly_name: "K", brightness: 40 } } };
LM.gatherLights(live, {}, {}, "pro", {}, {}, {}, {});
const old = { "light.k": { entity_id: "light.k", state: "on", attributes: { friendly_name: "K", brightness: 255 } } };
LM.gatherLights(old, {}, {}, "pro", {}, {}, {}, {}, 0, true);
out.bri = LM.lastBrightness("light.k");
""" % json.dumps(str(_VIEWS)))
    assert out["bri"] == 40


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_history_is_fetched_in_two_requests_and_lean_rows_take_live_attributes():
    out = _run("""
const calls = [];
const live = { "light.a": { state: "on", attributes: { friendly_name: "A" } },
               "binary_sensor.d": { state: "off", attributes: { friendly_name: "D", device_class: "door" } } };
const ctx = { hass: { states: live, callWS: async (m) => { calls.push(m); return m.entity_ids.includes("light.a")
    ? { "light.a": [{ s: "on", a: { brightness: 9 }, lu: 1 }] } : { "binary_sensor.d": [{ s: "on", lu: 1 }] }; } },
  actions: { wsCall: async () => ({ actions: [], periods: [] }) } };
const hs = { eids: ["light.a", "binary_sensor.d"] };
await HA.loadHouseHistory(ctx, hs, 0, 10);
out.calls = calls.map(c => [c.entity_ids, c.no_attributes, c.minimal_response]);
out.doorAttrs = HA.statesAt(hs.timeline, live, ["binary_sensor.d"], 5000)["binary_sensor.d"].attributes.device_class;
out.lightBri = HA.statesAt(hs.timeline, live, ["light.a"], 5000)["light.a"].attributes.brightness;
""")
    assert out["calls"] == [[["light.a"], False, False], [["binary_sensor.d"], True, True]]
    assert out["doorAttrs"] == "door"
    assert out["lightBri"] == 9


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_no_device_states_are_drawn_until_history_is_in():
    """While loading or after a failure the map drew TODAY's states under a
    past timestamp."""
    out = _run("""
const model = { floors: [{ id: "main", name: "Main", level: 0 }], areas: [{ id: "hall", name: "Hall", floor_id: "main" }],
  room_geometry_m: { Hall: { type: "poly", floor_id: "main", points_m: [[0, 0], [5, 0], [5, 4], [0, 4]] } },
  light_positions_m: { "light.hall": { x_m: 2, y_m: 2, floor_id: "main" } } };
const reg = { ts: Date.now() + 1e9, areaMap: { "light.hall": "Hall" }, platformMap: {}, manufacturerMap: {}, ipMap: {}, pairMap: {}, doorLockMap: {} };
const light = { entity_id: "light.hall", state: "on", attributes: { friendly_name: "Hall" } };
const ctx = { state: { model, settings: { tier: "pro" }, _modelLoaded: true, _lightsRegStore: { reg } },
  hass: { states: { "light.hall": light }, callWS: async () => ({}) } };
const frames = [{ ts: 100, o: [] }];
const loading = HA.renderHouseFrame(ctx, { timeline: null, events: [], eids: [] }, frames, 0, {}, () => {});
const loaded = HA.renderHouseFrame(ctx, { timeline: HA.buildStateTimeline({ "light.hall": [{ s: "on", a: {}, lu: 50 }] }), events: [], eids: [] }, frames, 0, {}, () => {});
out.whileLoading = loading.includes('"light.hall"');
out.onceLoaded = loaded.includes('"light.hall"');
""")
    assert out == {"whileLoading": False, "onceLoaded": True}
