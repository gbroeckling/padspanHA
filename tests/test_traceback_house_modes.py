# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Traceback's modes and Full house activity, driven through the real
views/traceback.js under node (tests/js/traceback_harness.mjs).

Every test here pins a defect the 2026-09-23 adversarial review reproduced
after v0.38.74 shipped with a green unit suite — the owner's "it feels like
this was too easy" was right. Each docstring names the symptom.

Skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_HARNESS = _ROOT / "tests" / "js" / "traceback_harness.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_PRELUDE = """
import { pathToFileURL } from 'node:url';
const H = await import(pathToFileURL(%s).href);
const out = {};
const settle = async () => { for (let i = 0; i < 6; i++) { await H.flush(); await new Promise(r => globalThis._realSetTimeout(r, 5)); } };
const all = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); all(c, acc); } return acc; };
const modeBtn = (root, m) => all(root).find(n => n.getAttribute && n.getAttribute("data-mode") === m);
""" % json.dumps(str(_HARNESS))


def _run(script: str) -> dict:
    src = _PRELUDE + script + "\nconsole.log(JSON.stringify(out));\n"
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=90, cwd=str(_ROOT))
    assert res.returncode == 0, f"node failed:\n{res.stderr[-3000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_playback_has_its_controls_after_traceback_opened_in_insights():
    """Opened on Insights (or returned to it), tapping Playback showed no
    range picker, Play button or scrubber — and nothing could load one."""
    out = _run("""
const frames = [{ ts: 1000, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] }, { ts: 1010, o: [] }];
const { ctx } = H.makeCtx({ state: { _tracebackInitialMode: "insights" },
  wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames, range: { start: 1000, end: 1010, count: 2 } }
    : t === "padspan_ha/traceback_objects" ? { objects: [] } : { days: [], dwell: {}, entries: {}, occupancy: {}, objects: {} } });
const outer = H.TB.render(ctx);
await settle();
const ctrlCard = outer.children[4];
out.before = ctrlCard.children.length;
modeBtn(outer, "playback").click();
await settle();
out.after = ctrlCard.children.length;
""")
    assert out["before"] == 0
    assert out["after"] > 0


def test_the_house_switch_hides_outside_playback_and_keeps_its_on_look():
    """Switching modes restyled the Full house activity switch as a fifth
    mode button: visible in Insights, 'on' drawn as off."""
    out = _run("""
const { ctx } = H.makeCtx({ wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames: [], range: {} }
  : t === "padspan_ha/traceback_objects" ? { objects: [] } : { days: [], dwell: {}, entries: {}, occupancy: {}, objects: {} } });
const outer = H.TB.render(ctx);
await settle();
const house = all(outer).find(n => String(n.textContent).startsWith("🏠 Full house activity"));
house.click();                              // on
modeBtn(outer, "insights").click();
out.hiddenInInsights = house.style.display === "none";
modeBtn(outer, "playback").click();
out.visibleInPlayback = house.style.display !== "none";
out.onLook = String(house.style.cssText).includes("font-weight:700") && house.textContent.endsWith(": on");
""")
    assert out == {"hiddenInInsights": True, "visibleInPlayback": True, "onLook": True}


def test_house_events_get_frames_of_their_own_and_a_click_lands_on_the_event():
    """Playback stepped only through beacon frames: a door opened while
    nobody was home could never be drawn, and clicking the event jumped to
    the frame before it, showing the door still shut."""
    out = _run("""
const now = Math.floor(Date.now() / 1000);
const start = now - 300;
const frames = [{ ts: start + 10, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] },
                { ts: start + 20, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] }];
const door = { entity_id: "binary_sensor.front_door", state: "off", last_changed: new Date(start * 1000 - 86400e3).toISOString(),
               attributes: { friendly_name: "Front door", device_class: "door" } };
const { ctx } = H.makeCtx({ states: { "binary_sensor.front_door": door },
  wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames, range: { start: start + 10, end: start + 20, count: 2 } }
    : t === "padspan_ha/traceback_objects" ? { objects: [] } : t === "padspan_ha/vacation_log_get" ? { actions: [], periods: [] } : {},
  callWS: (msg) => msg.type !== "history/history_during_period" ? {} : (msg.entity_ids.includes("binary_sensor.front_door")
    ? { "binary_sensor.front_door": [{ s: "off", lu: start }, { s: "on", lu: start + 200 }, { s: "off", lu: start + 230 }] } : {}) });
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
ctx.state._traceback.house.on = true;
ctx.state._traceback.house.devices = true;
ctx.state._traceback.rangePreset = 300;
modeBtn(outer, "playback").click();
await settle();
const tb = ctx.state._traceback;
out.frameTs = tb.frames.map(f => f.ts - start);
out.gapFrameBeacons = tb.frames.find(f => f.ts === start + 200).o.length;
const rows = all(outer.children[3]).filter(n => String(n.style.cssText).includes("cursor:pointer"));
rows[0].click();
const f = tb.frames[tb.frameIdx];
out.jumpedTo = f.ts - start;
out.doorDrawn = H.HA.statesAt(tb.house.timeline, {}, ["binary_sensor.front_door"], f.ts * 1000)["binary_sensor.front_door"].state;
""")
    # Beacon frames at +10/+20; the door's two changes add +200 and +230.
    assert out["frameTs"] == [10, 20, 200, 230]
    # Nobody was recorded near +200 — the frame draws no one, not stale beacons.
    assert out["gapFrameBeacons"] == 0
    assert out["jumpedTo"] == 200
    assert out["doorDrawn"] == "on"


def test_discovery_then_playback_redraws_playback():
    """Back from New Objects, playback kept drawing into the discovery map's
    detached overlay and the purple pins stayed on screen."""
    out = _run("""
const frames = []; for (let i = 0; i < 5; i++) frames.push({ ts: 1000 + i * 10, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] });
const { ctx } = H.makeCtx({ wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames, range: { start: 1000, end: 1040, count: 5 } }
  : t === "padspan_ha/traceback_objects" ? { objects: [] } : {} });
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
await settle();
const mapDiv = outer.children[2];
modeBtn(outer, "discovery").click();
out.discovery = String(mapDiv.innerHTML).includes("dpat_");
modeBtn(outer, "playback").click();
await settle();
out.playback = String(mapDiv.innerHTML).includes("tbpat_");
""")
    assert out == {"discovery": True, "playback": True}


def test_the_floor_slider_walks_the_atlas_floors_in_house_mode():
    """In house mode the slider indexed the 3D stack's photo floors but the
    Atlas drew fabric floors: "Floor 1" focused the basement."""
    out = _run("""
const { ctx } = H.makeCtx({ wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames: [], range: {} }
  : t === "padspan_ha/traceback_objects" ? { objects: [] } : {} });
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
await settle();
const iso = outer.children[1];
const slider = all(iso).find(n => n.type === "range");
const label = () => all(iso).find(n => n.previousSibling === slider || n === slider.nextSibling) ;
out.photoMax = slider.max;
all(outer).find(n => String(n.textContent).startsWith("🏠 Full house activity")).click();
out.atlasMax = slider.max;
const pos = H.HA.atlasFocusPositions(ctx.state.model);
out.labels = [0, 1, 3, 5].map(i => pos.labelOf(i));
""")
    assert out["photoMax"] == "1"          # one photo: All, Main
    assert out["atlasMax"] == "5"          # three fabric floors: All, B, B+M, M, M+U, U
    assert out["labels"] == ["All floors", "Basement", "Main", "Upper"]


def test_a_view_mounted_mid_fetch_repaints_when_the_history_lands():
    """Leaving and coming back while the house history was loading left the
    new view on 'Loading house history…' for good."""
    out = _run("""
const now = Math.floor(Date.now() / 1000);
const frames = [{ ts: now - 100, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] }];
const states = { "binary_sensor.front_door": { entity_id: "binary_sensor.front_door", state: "off",
  attributes: { friendly_name: "Front door", device_class: "door" } } };
const pending = [];
const { ctx } = H.makeCtx({ states,
  wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames, range: {} } : t === "padspan_ha/traceback_objects" ? { objects: [] }
    : t === "padspan_ha/vacation_log_get" ? { actions: [], periods: [] } : {},
  callWS: (msg) => msg.type === "history/history_during_period" ? new Promise(r => pending.push(r)) : {} });
ctx.state._traceback = undefined;
H.TB.render(ctx);
ctx.state._traceback.house.on = true;
ctx.state._traceback.house.devices = true;
await settle();
ctx.state._traceback.active = false;
const B = H.TB.render(ctx);
await settle();
for (let i = 0; i < 4; i++) { for (const r of pending.splice(0)) r({}); await settle(); }
out.status = (String(B.children[2].innerHTML).match(/color:#94a3b8">([^<]*)</) || [])[1];
""")
    assert out["status"] and "Loading" not in out["status"]



# ── Re-review of the repairs (2026-09-23): a repair round ships regressions ──


def test_history_landing_mid_playback_restarts_it_on_the_merged_list():
    """Playback kept the old frame count: it stopped halfway once the house
    history landed, or ran past the end when the switch went off."""
    out = _run("""
const now = Math.floor(Date.now() / 1000), start = now - 300;
const frames = []; for (let i = 0; i < 10; i++) frames.push({ ts: start + 10 + i * 10.37, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] });
const door = { entity_id: "binary_sensor.d", state: "off", attributes: { friendly_name: "D", device_class: "door" } };
const rows = [{ s: "off", lu: start }]; for (let i = 0; i < 10; i++) rows.push({ s: i % 2 ? "off" : "on", lu: start + 150.5 + i * 7.25 });
const pending = [];
const { ctx } = H.makeCtx({ states: { "binary_sensor.d": door },
  wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames, range: {} } : t === "padspan_ha/traceback_objects" ? { objects: [] }
    : t === "padspan_ha/vacation_log_get" ? { actions: [], periods: [] } : {},
  callWS: (m) => m.type === "history/history_during_period" ? new Promise(r => pending.push(() => r({ "binary_sensor.d": rows }))) : {} });
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
ctx.state._traceback.house.on = true;
ctx.state._traceback.house.devices = true;
modeBtn(outer, "playback").click();
await settle();
const tb = ctx.state._traceback;
tb.playing = false;
out.before = tb.frames.length;
// press Play, then let the history land
const play = all(outer).find(n => n.title === "Play");
out.foundPlay = !!play;
play.click();
out.playing = tb.playing;
for (const p of pending.splice(0)) p();
await settle();
out.after = tb.frames.length;
out.stillPlaying = tb.playing;
""")
    assert out["foundPlay"] and out["playing"]
    assert out["before"] == 10
    assert out["after"] == 20
    assert out["stillPlaying"], "playback must be restarted on the merged list, not left on the old count"


def test_an_events_frame_is_never_before_the_event_with_real_timestamps():
    """Rounding the synthetic frame to the second put half of all events'
    frames up to 0.5 s early: the click drew the door still shut."""
    out = _run("""
const ev = [{ t: 200312.456 }];
const m = H.HA.mergeHouseFrames([{ ts: 10.37, o: [] }], ev);
out.ts = m.map(f => f.ts);
""")
    assert out["ts"] == [10.37, 200.312456]


def test_a_thinned_week_keeps_people_on_house_frames():
    """A 7-day range comes back ~150 s apart; a fixed 30 s carry dropped
    everyone from every house-event frame."""
    out = _run("""
const raw = []; for (let i = 0; i < 20; i++) raw.push({ ts: i * 150, o: [{ k: "a" }] });
const m = H.HA.mergeHouseFrames(raw, [{ t: 1_560_000 }, { t: 9_000_000 }], 150);  // thinned to 150 s; +60 s after a frame; far past the end
out.carried = m.find(f => f.ts === 1560).o.length;
out.past = m.find(f => f.ts === 9000).o.length;
""")
    assert out == {"carried": 1, "past": 0}


def test_a_new_range_never_shows_the_old_windows_history():
    out = _run("""
const hs = { eids: ["light.a"], timeline: { "light.a": [{ t: 0, state: "on", attributes: {}, lc: 0 }] }, events: [{ t: 1 }] };
const ctx = { hass: { states: { "light.a": { state: "off", attributes: {} } }, callWS: () => new Promise(() => {}) },
  actions: { wsCall: async () => ({ actions: [], periods: [] }) } };
H.HA.loadHouseHistory(ctx, hs, 100, 200);
out.timeline = hs.timeline; out.events = hs.events.length; out.loading = hs.loading;
// an entity with rows, asked about before its first row, is omitted — not drawn "live"
const tl = H.HA.buildStateTimeline({ "light.b": [{ s: "on", lu: 500 }] });
out.beforeFirst = H.HA.statesAt(tl, { "light.b": { state: "off" } }, ["light.b"], 100_000)["light.b"].state;
""")
    # Before its first row the state is unknown — never today's "off", never missing.
    assert out == {"timeline": None, "events": 0, "loading": True, "beforeFirst": "unknown"}


def test_an_unavailable_gap_does_not_hide_the_change_across_it():
    out = _run("""
const tl = H.HA.buildStateTimeline({ "light.porch": [{ s: "off", lu: 0 }, { s: "unavailable", lu: 10 }, { s: "on", lu: 20 }] });
out.ev = H.HA.activityEvents(tl, e => e, 0, 1e9).map(e => [e.from, e.to, e.t / 1000]);
""")
    assert out["ev"] == [["off", "on", 20]]


# ── Round 3 (2026-09-23) ─────────────────────────────────────────────────────


def test_a_click_lands_on_its_own_event_when_another_is_300_ms_earlier():
    """Motion at T, the automation's light at T+0.3 s: clicking the light
    landed on the motion frame and drew the light still off."""
    out = _run("""
const raw = [{ ts: 10, o: [] }];
const ev = [{ t: 1_000_000 }, { t: 1_000_300 }];
const m = H.HA.mergeHouseFrames(raw, ev);
let i = 0; const e = ev[1];
while (i < m.length - 1 && m[i].ts * 1000 < e.t) i++;       // the row handler's rule
out.landed = m[i].ts;
""")
    assert out["landed"] == 1000.3


def test_isolated_sightings_are_not_carried_for_hours():
    """A tag seen twice an hour apart has no 'cadence' — carrying it across
    the gap drew it long after it was last recorded (round 3)."""
    out = _run("""
const m = H.HA.mergeHouseFrames([{ ts: 0, o: [{ k: "fob" }] }, { ts: 3600, o: [{ k: "fob" }] }],
                                [{ t: 1_800_000 }, { t: 7_600_000 }]);
out.carried = m.filter(f => f.house).map(f => f.o.length);
""")
    assert out["carried"] == [0, 0]


def test_carry_follows_the_real_recording_rate():
    """Round 4: a 60 s presence poll must keep people on house frames; an
    isolated sighting must not be stretched; a thinned week scales with how
    much it was thinned."""
    out = _run("""
const every = (step, n) => Array.from({ length: n }, (_, i) => ({ ts: i * step, o: [{ k: "a" }] }));
const c = (raw, t, f) => H.HA.mergeHouseFrames(raw, [{ t: t * 1000 }], f).find(x => x.house).o.length;
out.poll60 = c(every(60, 50), 60 * 10 + 75, 1);           // 75 s after a frame, 60 s cadence
out.isolated = c([{ ts: 0, o: [{ k: "a" }] }, { ts: 3600, o: [{ k: "a" }] }], 1800, 1);
out.thinned = c(every(150, 50), 150 * 10 + 200, 15);       // 200 s after a frame, thinned 15x
""")
    assert out == {"poll60": 1, "isolated": 0, "thinned": 1}


def test_reset_forgets_the_saved_house_floor_too():
    """Review round 5: Reset showed "All floors" and "Reset ✓" in house mode,
    but never cleared traceback_house_focus — the next visit opened on the
    old floor again."""
    out = _run("""
const { ctx } = H.makeCtx({ wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames: [], range: {} }
  : t === "padspan_ha/traceback_objects" ? { objects: [] } : {} });
const sent = [];
ctx.actions.settingsSet = async (p) => { sent.push(p); return {}; };
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
await settle();
all(outer).find(n => String(n.textContent).startsWith("🏠 Full house activity")).click();
all(outer).find(n => n.tagName === "BUTTON" && n.textContent === "Reset").click();
await settle();
out.sent = sent;
""")
    assert out["sent"] and out["sent"][-1].get("traceback_house_focus") == 0, out



# ── 💡 Devices (Garry, 2026-09-24: "split it in two, devices, and no devices") ──


def test_full_house_is_the_atlas_and_the_beacons_and_devices_plays_every_device_back():
    """Full house activity alone: the Atlas map with the tracked beacons — no
    devices, no house history fetched. 💡 Devices (shown only then) plays
    every device the Atlas shows through the period — a temperature reading
    too — with every tracked object, ringing and naming what changed."""
    out = _run("""
H.MODEL.light_positions_m["sensor.kitchen_temp"] = { x_m: 2, y_m: -2, floor_id: "main" };
const now = Math.floor(Date.now() / 1000), start = now - 300;
const frames = [{ ts: start + 10, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] },
                { ts: start + 20, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] }];
const states = {
  "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } },
  "sensor.kitchen_temp": { entity_id: "sensor.kitchen_temp", state: "21.3",
    attributes: { friendly_name: "Kitchen temp", device_class: "temperature", unit_of_measurement: "°C" } } };
const history = { "light.kitchen": [{ s: "off", a: { friendly_name: "Kitchen" }, lu: start }, { s: "on", lu: start + 200 }],
  "sensor.kitchen_temp": [{ s: "20.2", lu: start }, { s: "20.4", lu: start + 100 }, { s: "21.3", lu: start + 250 }] };
const objArgs = [];
const { ctx, calls } = H.makeCtx({ states,
  wsCall: (t, d) => t === "padspan_ha/traceback_get" ? (objArgs.push(d.obj_key), { frames, range: { start: start + 10, end: start + 20, count: 2 } })
    : t === "padspan_ha/traceback_objects" ? { objects: [] } : t === "padspan_ha/vacation_log_get" ? { actions: [], periods: [] } : {},
  callWS: (m) => m.type !== "history/history_during_period" ? {}
    : Object.fromEntries(m.entity_ids.filter(e => history[e]).map(e => [e, history[e]])) });
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
await settle();
const tb = ctx.state._traceback;
tb.rangePreset = 300;
const devBtn = () => all(outer).find(n => String(n.textContent).startsWith("💡 Devices"));
out.devBtnBefore = devBtn().style.display;
all(outer).find(n => String(n.textContent).startsWith("🏠 Full house activity")).click();
await settle();
out.devBtnShown = devBtn().style.display !== "none";
out.listShown = outer.children[3].style.display !== "none";
out.fetched = calls.some(c => c.type === "history/history_during_period");
out.framesNoDevices = tb.frames.map(f => f.ts - start);
out.kitchenDrawn = /data-eid="light\\.kitchen"/.test(String(outer.children[2].innerHTML));
tb.filterKey = "a"; tb.filterName = "a";
devBtn().click();
await settle();
out.filterCleared = tb.filterKey === null && objArgs[objArgs.length - 1] === undefined;
out.listShownNow = outer.children[3].style.display !== "none";
out.framesDevices = tb.frames.map(f => f.ts - start);
out.events = tb.house.events.map(e => [e.t / 1000 - start, e.eid, e.from, e.to]);
const rows = all(outer.children[3]).filter(n => String(n.style.cssText).includes("cursor:pointer"));
rows[1].click();                                   // the temperature change
const html = String(outer.children[2].innerHTML);
out.named = html.includes("Kitchen temp → 21°");
out.ringed = /class="lchanged" data-eid="sensor\\.kitchen_temp"/.test(html);
""")
    assert out["devBtnBefore"] == "none", out              # only with Full house on
    assert out["devBtnShown"] and not out["listShown"], out
    assert not out["fetched"] and out["framesNoDevices"] == [10, 20], out
    assert not out["kitchenDrawn"], out
    assert out["filterCleared"] and out["listShownNow"], out
    assert out["framesDevices"] == [10, 20, 200, 250], out
    assert out["events"] == [[200, "light.kitchen", "off", "on"], [250, "sensor.kitchen_temp", "20°", "21°"]], out
    assert out["named"] and out["ringed"], out



def test_devices_turned_on_mid_playback_fetches_the_house_once():
    """Round 16: Devices flipped on before the all-objects reload finished, so
    a playback tick fetched the whole house's history for the old,
    one-object window — then again for the new one."""
    out = _run("""
const now = Math.floor(Date.now() / 1000), start = now - 300;
const frames = []; for (let i = 0; i < 20; i++) frames.push({ ts: start + 10 + i * 5, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] });
const states = { "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } } };
let release;
const gate = new Promise(r => { release = r; });
const { ctx, calls } = H.makeCtx({ states,
  wsCall: async (t, d) => t === "padspan_ha/traceback_get" ? (d.obj_key === undefined ? (await gate, { frames, range: {} }) : { frames, range: {} })
    : t === "padspan_ha/traceback_objects" ? { objects: [] } : t === "padspan_ha/vacation_log_get" ? { actions: [], periods: [] } : {},
  callWS: (m) => m.type === "history/history_during_period" ? {} : {} });
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
const tb = ctx.state._traceback;
tb.filterKey = "a"; tb.filterName = "a";
release();
await settle();
all(outer).find(n => String(n.textContent).startsWith("🏠 Full house activity")).click();
await settle();
const gate2 = new Promise(r => { release = r; });
const origWs = ctx.actions.wsCall;
ctx.actions.wsCall = async (t, d) => { if (t === "padspan_ha/traceback_get") await gate2; return origWs(t, d); };
all(outer).find(n => n.title === "Play").click();                 // playing
out.playing = tb.playing === true;
all(outer).find(n => String(n.textContent).startsWith("💡 Devices")).click();
out.stopped = tb.playing === false;
// A playback tick while the all-objects reload is held.
for (const f of H.rafQueue.splice(0).filter(Boolean)) f(performance.now() + 60000);
await settle();
release();
await settle();
out.fetches = calls.filter(c => c.type === "history/history_during_period").length;
out.devices = tb.house.devices === true && tb.filterKey === null;
""")
    assert out["playing"] and out["stopped"] and out["devices"], out
    assert out["fetches"] == 1, out          # one load (this house has only a light: one request)



def test_devices_the_map_draws_changing_mid_playback_rebuild_the_frames_once_and_their_controls():
    """Round 17 (live in 0.38.79): when the devices the map draws changed
    during playback (the entity registry landing after the history, or a
    device hidden on the Atlas), the frames were rebuilt INSIDE the playback
    tick — two playback loops ran, the scrubber kept the old count, and
    scrubbing or playing past the new end threw."""
    out = _run("""
H.MODEL.light_positions_m["light.nowhere"] = { x_m: 2, y_m: -2, floor_id: "main" };
const now = Math.floor(Date.now() / 1000), start = now - 300;
const frames = []; for (let i = 0; i < 12; i++) frames.push({ ts: start + 10 + i * 20, o: [{ k: "a", r: "Kitchen", x_m: 1, y_m: 1, f: "main" }] });
const states = { "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } },
                 "light.nowhere": { entity_id: "light.nowhere", state: "on", attributes: { friendly_name: "Nowhere" } } };
const history = { "light.kitchen": [{ s: "off", a: { friendly_name: "Kitchen" }, lu: start }, { s: "on", lu: start + 101 }],
                  "light.nowhere": [{ s: "off", a: { friendly_name: "Nowhere" }, lu: start }, { s: "on", lu: start + 157 }] };
const { ctx } = H.makeCtx({ states,
  wsCall: (t) => t === "padspan_ha/traceback_get" ? { frames, range: { start: start + 10, end: start + 230, count: 12 } }
    : t === "padspan_ha/traceback_objects" ? { objects: [] } : t === "padspan_ha/vacation_log_get" ? { actions: [], periods: [] } : {},
  callWS: async (m) => m.type === "history/history_during_period"
      ? Object.fromEntries(m.entity_ids.filter(e => history[e]).map(e => [e, history[e]]))
    : (m.type === "config/entity_registry/list" || m.type === "config/device_registry/list") ? [] : {} });
ctx.state._traceback = undefined;
const outer = H.TB.render(ctx);
const tb = ctx.state._traceback;
tb.house.on = true; tb.house.devices = true;
modeBtn(outer, "playback").click();
await settle();
out.before = tb.frames.length;                              // both lights' changes
all(outer).find(n => n.title === "Play").click();
out.playing = tb.playing;
ctx.state.settings = { ...ctx.state.settings, lights_hidden: ["light.nowhere"] };   // hidden on the Atlas
for (const f of H.rafQueue.splice(0).filter(Boolean)) f(performance.now() + 25000);  // a playback tick
await settle();
const scrub = all(outer).find(n => n.id === "tb-scrubber");
out.after = tb.frames.length;
out.scrubMax = Number(scrub.max);
out.loops = H.rafQueue.filter(Boolean).length;
for (let i = 0; i < 6; i++) { for (const f of H.rafQueue.splice(0).filter(Boolean)) f(performance.now() + 60000 * (i + 1)); await settle(); }
out.endedCleanly = tb.frameIdx <= tb.frames.length - 1;
""")
    assert out["before"] == 14 and out["playing"], out     # 12 beacon frames + both changes
    assert out["after"] == 13, out                         # the hidden light's change is not drawn
    assert out["scrubMax"] == out["after"] - 1, out
    assert out["loops"] == 1, out
    assert out["endedCleanly"], out
