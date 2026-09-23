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
await settle();
ctx.state._traceback.active = false;
const B = H.TB.render(ctx);
await settle();
for (let i = 0; i < 4; i++) { for (const r of pending.splice(0)) r({}); await settle(); }
out.status = (String(B.children[2].innerHTML).match(/color:#94a3b8">([^<]*)</) || [])[1];
""")
    assert out["status"] and "Loading" not in out["status"]
