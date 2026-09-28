# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The WLED card's Advanced tab for the exact look, rendered for real under
node: the Exact look tab (the remembered look in words and swatches, the
last result, a changed LED setup, the history) and the Sync & team tab's
"Who gives this light its instructions" and "Run this team by", against a
fake backend that records what each button sends. The look is the one
PadSpan remembers from Quin Kitchen (.2.118's captured JSON, wled_look.py).
Skipped without node."""

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
pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

# wled_look.capture() of scratch live/192.168.2.118.json: a 5-channel PWM
# output (RGB+CCT) and 30 RGB LEDs, both orange.
_LOOK = json.loads(
    '{"v":1,"at":1790000000,"by":"Garry","fw":"0.15.0-b7","arch":"esp32","state":{"bri":128,"tt":7,"mainseg":0,"seg":['
    '{"id":0,"start":0,"stop":1,"grp":1,"spc":0,"of":0,"on":true,"frz":false,"bri":255,"cct":127,"set":0,'
    '"col":[[255,160,0,0],[0,0,0,0],[0,0,0,0]],"fx":0,"sx":128,"ix":128,"pal":0,"c1":128,"c2":128,"c3":16,"sel":true,'
    '"rev":false,"mi":false,"o1":false,"o2":false,"o3":false,"si":0,"m12":0},'
    '{"id":1,"start":1,"stop":31,"grp":1,"spc":0,"of":0,"on":true,"frz":false,"bri":255,"cct":127,"set":0,'
    '"col":[[255,160,0,0],[0,0,0,0],[0,0,0,0]],"fx":0,"sx":128,"ix":128,"pal":0,"c1":128,"c2":128,"c3":16,"sel":true,'
    '"rev":false,"mi":false,"o1":false,"o2":false,"o3":false,"si":0,"m12":0}]},'
    '"setup":{"geometry":{"total":31,"seglc":[7,1],"rgbw":true,"matrix":null,"buses":[{"type":45,"start":0,"len":1,"skip":0,'
    '"rev":false},{"type":22,"start":1,"len":30,"skip":0,"rev":false}]},"colour":{"buses":[{"order":1,"rgbwm":0,'
    '"freq":19531,"maxpwr":0,"ledma":0},{"order":0,"rgbwm":0,"freq":0,"maxpwr":1250,"ledma":55}],"rgbwm":255,"cb":0,'
    '"cr":false,"cct":false,"ic":false,"gc":{"bri":1,"col":1,"val":2.8},"scale_bri":100,"maxpwr":1250,"ledma":0}},'
    '"setup_hash":"8e73db572de64834","warnings":[]}')
_SUMMARY = ("2 parts · Part 1: 5-channel output, orange + white 0, warmth 127 · Part 2: 30 LEDs, orange, Solid · "
            "Brightness 50% · Fade 0.7 s")

_PRELUDE = """
import { pathToFileURL } from 'node:url';
const { install, flush } = await import(pathToFileURL(%(shim)s).href);
install(globalThis);
const WA = await import(new URL("wled_advanced.js", pathToFileURL(%(views)s + "/")).href);
const all = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); all(c, acc); } return acc; };
const texts = (n) => all(n).map(c => c.textContent || "");
// Elements (not their text nodes) whose whole text is `s`, or passes `s`.
const count = (n, s) => all(n).filter(c => c.tagName !== "#TEXT" && (typeof s === "function" ? s(c.textContent || "") : c.textContent === s)).length;
const settle = async () => { for (let i = 0; i < 10; i++) { await flush(); await new Promise(r => globalThis._realSetTimeout(r, 3)); } };
const LOOK = %(look)s;
const SEGS = LOOK.state.seg.map(s => ({ ...s, len: s.stop - s.start }));
const DEVICE = {
  "json/si": { info: { name: "Quin Kitchen", ver: "0.15.0-b7", vid: 2405180, arch: "esp32", mac: "aabbccddeeff", uptime: 900,
                       leds: { count: 31, maxseg: 32, seglc: [7, 1], rgbw: true } },
               state: { on: false, bri: 128, transition: 7, udpn: { send: false, recv: true, sgrp: 1, rgrp: 1 }, seg: SEGS } },
  "json/eff": ["Solid", "Blink"], "json/fxdata": ["", ""], "json/pal": ["Default"], "presets.json": {}, "json/nodes": { nodes: [] },
  "json/cfg": { if: { sync: { port0: 21324, recv: { bri: true, col: true, fx: true, pal: true, grp: 1, seg: false, sb: false },
                              send: { en: false, dir: false, btn: false, va: false, hue: true, grp: 1, ret: 0 } } } },
};
const DEVICES = [
  { device_id: "dQ", name: "Quin Kitchen", lights: ["light.quin"], sw_version: "0.15.0-b7" },
  { device_id: "dF", name: "Far West", lights: ["light.far_west"], sw_version: "0.15.0-b7" },
  { device_id: "dX", name: "Driveway", lights: ["light.driveway"] },
];
const PRIOR = { dQ: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1, bri: true } },
                dF: { send: { en: false, grp: 1 }, recv: { grp: 1, bri: true, col: true } } };
function backend({ x = {}, teams = [], exact = [], admin = true } = {}) {
  const calls = [];
  const X = { device_id: "dQ", mac: "aabbccddeeff", name: "Quin Kitchen", join: "wled", exact: false, hold: true, sync_off: null,
    sync_off_message: null, team_id: null, team_mode: null, look: null, history: [], last_cmd: null, last_result: null, drift: null,
    prior_sync: null, can_switch: false, differs: null, compare_error: null, ...x };
  const hass = { states: {}, callService: async () => {}, user: { is_admin: admin }, callWS: async (m) => {
    calls.push(JSON.parse(JSON.stringify(m)));
    switch (m.type) {
      case "padspan_ha/wled_get":
        if (m.device_id && m.path === "json/info") return { data: { ver: "0.15.0-b7", vid: 2405180 } };
        if (m.device_id) return { data: { if: { sync: { send: { en: true, grp: 1 }, recv: { grp: 1 } } } }, hash: "h" + m.device_id };
        return { data: DEVICE[m.path], hash: "H" };
      case "padspan_ha/wled_state": return { data: DEVICE["json/si"].state };
      case "padspan_ha/wled_look_get": return X;
      case "padspan_ha/wled_look_remember": return { saved: !m.preview, team_warnings: m.team ? ["Colour gamma differs between team members — the same colour numbers will look different"] : [],
        looks: [{ device_id: "dQ", name: "Quin Kitchen", mac: "aabbccddeeff", look: LOOK, warnings: ["2 of 31 LEDs aren't in any part of the look, so they stay dark"] }] };
      case "padspan_ha/wled_look_use_history": return { look: LOOK, history: [] };
      case "padspan_ha/wled_exact_set": return { join: m.exact ? "padspan" : "wled", exact: !!m.exact, hold: m.hold !== false, sync_off: m.exact ? "saved" : null,
        sync_off_message: null, backup: "20260927T210400", message: null,
        before: { send: { en: true, grp: 1 }, recv: { grp: 1 }, live: { send: true, recv: true, sgrp: 1, rgrp: 1 } },
        after: { send: { en: false, grp: 0 }, recv: { grp: 0 }, live: { send: false, recv: false, sgrp: 0, rgrp: 0 } } };
      case "padspan_ha/wled_power": return { handled: true, results: [{ name: "Quin Kitchen", ok: true, tries: 1, diffs: [] }] };
      case "padspan_ha/wled_teams_get": return { teams, hash: "th" };
      case "padspan_ha/wled_devices": return { devices: DEVICES };
      case "padspan_ha/wled_exact_list": return { devices: exact };
      case "padspan_ha/wled_team_mode": return { team: { ...teams[0], mode: m.mode }, hash: "th2", members: [] };
      case "padspan_ha/wled_teams_set": return { teams: m.teams, hash: "th3" };
      case "padspan_ha/wled_cfg": return { backup: "b", unexpected: [] };
      default: return {};
    }
  } };
  return { hass, calls };
}
async function open(tab, opts = {}) {
  const b = backend(opts);
  const toasts = [];
  const pane = document.createElement("div");
  await WA.mountWledAdvanced(pane, { hass: b.hass, eid: "light.quin", api: { wled: { isAdmin: opts.admin !== false, tier: "pro" },
    toast: (m, e) => toasts.push([m, !!e]), onExactChanged: () => toasts.push(["<exact changed>", false]) } });
  await settle();
  all(pane).find(n => n.tagName === "BUTTON" && n.textContent === tab).click();
  await settle();
  return { pane, ...b, toasts };
}
const btn = (pane, label) => all(pane).filter(n => n.tagName === "BUTTON" && n.textContent === label);
const sent = (calls, type) => calls.filter(c => c.type === type).map(({ type, entity_id, ...rest }) => rest);
const confirms = [];
globalThis.confirm = (m) => { confirms.push(m); return true; };
const out = {};
""" % {"shim": json.dumps(str(_ROOT / "tests" / "js" / "dom_shim.mjs")), "views": json.dumps(str(_VIEWS)),
       "look": json.dumps(_LOOK)}


def _run(script: str) -> dict:
    res = subprocess.run([_NODE, "--input-type=module", "-e", _PRELUDE + script + "\nconsole.log(JSON.stringify(out));\n"],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-3000:]
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_before_a_look_is_remembered():
    out = _run("""
const { pane } = await open("Exact look");
const t = texts(pane);
out.none = t.includes("No look remembered yet. Set the light the way it should look, then press Remember this look.");
out.who = t.includes("WLED sync gives this light its instructions. Remember a look here, then choose PadSpan on the Sync & team tab.");
out.remember = btn(pane, "Remember this look").length;
out.tryIt = btn(pane, "Try it").length;
out.hold = t.some(x => x === "Put the look back when something else turns it on");
out.history = t.some(x => x.startsWith("History ("));
""")
    assert out == {"none": True, "who": True, "remember": 1, "tryIt": 0, "hold": False, "history": False}


def test_the_remembered_look_in_words_and_swatches_with_its_result_drift_and_history():
    look = json.loads(json.dumps(_LOOK))
    look["setup"]["colour"]["buses"][0]["rgbwm"] = 2       # Accurate on the 5-channel output
    out = _run("""
const look = __LOOK__;
const older = { ...look, at: look.at - 86400, by: "Nicole", state: { ...look.state, bri: 255 } };
const { pane } = await open("Exact look", { x: { join: "padspan", exact: true, look, can_switch: true,
  last_result: { at: 1790003040, ok: true, tries: 1, diffs: [], source: "atlas", on: true, bri: 128 },
  drift: { at: 1790002000, geometry: false, what: ["Output 1 white mode None → Accurate", "Output 1 PWM frequency 19531 Hz → 9765 Hz"] },
  differs: ["part 2: colour, effect"],
  history: [{ index: 0, ...older }, { index: 1, ...older, at: older.at - 60 }] } });
const t = texts(pane);
out.summary = count(pane, __SUMMARY__);
out.colourSwatches = all(pane).filter(n => (n.getAttribute("title") || "") === "Colour #ffa000").length;
out.whiteSwatch = all(pane).filter(n => (n.getAttribute("title") || "") === "White 0, warmth 127").length;
out.autoWhite = count(pane, "White is worked out from the colour on this output (Accurate)");
out.result = t.find(x => x.startsWith("✓ On at ")) || null;
out.driftTitle = t.some(x => x.startsWith("⚠ The LED setup changed since the look was remembered ("));
out.driftLines = ["Output 1 white mode None → Accurate", "Output 1 PWM frequency 19531 Hz → 9765 Hz"].every(l => t.includes(l));
out.colourOnly = t.includes("The look is still put on exactly as remembered; these settings change how it comes out.");
out.rememberAgain = t.includes("Remember the look again");
out.differs = t.includes("Differs from the remembered look now: part 2 colour, effect");
out.historyTitle = t.includes("History (2)");
out.useThis = btn(pane, "Use this one").length;
out.olderSummary = count(pane, x => x.startsWith("2 parts · ") && x.endsWith("Brightness 100% · Fade 0.7 s"));
out.remembered = t.some(x => /^Remembered at \\d\\d:\\d\\d on \\d+ \\w{3} by Garry · WLED 0.15.0-b7$/.test(x));
out.who = t.includes("PadSpan gives this light its instructions: it comes on with the look below every time.");
const hold = all(pane).find(n => n.tagName === "LABEL" && n.textContent === "Put the look back when something else turns it on");
out.holdChecked = hold.firstChild.checked;
out.holdDisabled = hold.firstChild.disabled;
out.buttons = ["Remember this look", "Try it", "Remember team look"].map(l => btn(pane, l).length);
""".replace("__LOOK__", json.dumps(look)).replace("__SUMMARY__", json.dumps(_SUMMARY)))
    assert out.pop("result") is not None
    assert out == {"summary": 1, "colourSwatches": 2, "whiteSwatch": 1, "autoWhite": 1, "driftTitle": True,
                   "driftLines": True, "colourOnly": True, "rememberAgain": False, "differs": True, "historyTitle": True,
                   "useThis": 2, "olderSummary": 2, "remembered": True, "who": True, "holdChecked": True,
                   "holdDisabled": False, "buttons": [1, 1, 0]}


def test_the_last_result_line_reads_as_designed():
    out = _run("""
const look = LOOK;
let r = await open("Exact look", { x: { join: "padspan", exact: true, look,
  last_result: { at: 1790003040, ok: true, tries: 1, diffs: [], source: "atlas", on: true, bri: 128 } } });
out.ok = texts(r.pane).find(x => x.startsWith("✓ On at "));
r = await open("Exact look", { x: { join: "padspan", exact: true, look,
  last_result: { at: 1790003040, ok: false, tries: 3, diffs: ["part 2: colour"], source: "atlas", on: true, bri: 128,
                 message: "part 2: colour didn't take after 3 tries" },
  drift: { at: 1790002000, geometry: true, what: ["Output 2 changed from RGB (WS281x) to RGBW (SK6812)"] } } });
const t = texts(r.pane);
out.fail = t.find(x => x.startsWith("⚠ On at "));
out.rememberAgain = t.includes("Remember the look again");
out.geometry = t.includes("Until then PadSpan puts the look on without its part sizes, which may no longer fit. ");
r = await open("Exact look", { x: { join: "padspan", exact: true, look,
  last_result: { at: 1790003040, ok: false, tries: 0, diffs: [], source: "vacation", on: true, waiting: true,
                 error: "Offline — the look goes on when it reconnects" } } });
out.waiting = texts(r.pane).find(x => x.startsWith("⚠ On at "));
""")
    assert re.fullmatch(r"✓ On at \d\d:\d\d from Atlas: matched exactly \(1 try\)", out["ok"]), out["ok"]
    assert re.fullmatch(r"⚠ On at \d\d:\d\d from Atlas: Part 2 colour didn't take after 3 tries", out["fail"]), out["fail"]
    assert re.fullmatch(r"⚠ On at \d\d:\d\d from Vacation Mode: Offline — the look goes on when it reconnects", out["waiting"])
    assert out["rememberAgain"] and out["geometry"]


def test_remember_shows_the_summary_and_warnings_then_saves():
    out = _run("""
const r = await open("Exact look");
btn(r.pane, "Remember this look")[0].click();
await settle();
out.sent = sent(r.calls, "padspan_ha/wled_look_remember");
out.asked = confirms[confirms.length - 1];
out.toasts = r.toasts;
""")
    assert out["sent"] == [{"team": False, "preview": True}, {"team": False}]
    assert _SUMMARY in out["asked"] and "⚠ 2 of 31 LEDs aren't in any part of the look, so they stay dark" in out["asked"]
    assert ["Look remembered", False] in out["toasts"] and ["<exact changed>", False] in out["toasts"]


def test_try_it_hold_and_history_send_what_they_say():
    out = _run("""
const x = { join: "padspan", exact: true, look: LOOK, team_id: "team-1", history: [{ index: 0, ...LOOK }, { index: 1, ...LOOK }] };
let r = await open("Exact look", { x });
btn(r.pane, "Try it")[0].click();
await settle();
out.power = sent(r.calls, "padspan_ha/wled_power");
r = await open("Exact look", { x });
const hold = all(r.pane).find(n => n.tagName === "LABEL" && n.textContent === "Put the look back when something else turns it on");
hold.firstChild.checked = false; hold.firstChild.dispatchEvent({ type: "change" });
await settle();
out.hold = sent(r.calls, "padspan_ha/wled_exact_set");
r = await open("Exact look", { x });
btn(r.pane, "Use this one")[1].click();
await settle();
out.history = sent(r.calls, "padspan_ha/wled_look_use_history");
r = await open("Exact look", { x });
btn(r.pane, "Remember team look")[0].click();
await settle();
out.team = sent(r.calls, "padspan_ha/wled_look_remember");
out.teamAsked = confirms[confirms.length - 1];
""")
    assert out["power"] == [{"on": False, "source": "try"}, {"on": True, "source": "try"}]
    assert out["hold"] == [{"hold": False}]
    assert out["history"] == [{"index": 1}]
    assert out["team"] == [{"team": True, "preview": True}, {"team": True}]
    assert "Quin Kitchen: 2 parts" in out["teamAsked"] and "⚠ Colour gamma differs between team members" in out["teamAsked"]


def test_a_non_admin_sees_the_look_but_changes_nothing():
    out = _run("""
const r = await open("Exact look", { admin: false, x: { join: "padspan", exact: true, look: LOOK, history: [{ index: 0, ...LOOK }] } });
const t = texts(r.pane);
const hold = all(r.pane).find(n => n.tagName === "LABEL" && n.textContent === "Put the look back when something else turns it on");
out.holdDisabled = hold.firstChild.disabled;
out.buttons = ["Remember this look", "Use this one", "Try it"].map(l => btn(r.pane, l).length);
out.note = t.includes("An administrator remembers the look.");
const s = await open("Sync & team", { admin: false, x: { join: "wled", look: LOOK } });
btn(s.pane, "PadSpan (exact look)")[0].click();
await settle();
out.switched = sent(s.calls, "padspan_ha/wled_exact_set").length;
out.chooses = texts(s.pane).includes("An administrator chooses this.");
""")
    assert out == {"holdDisabled": True, "buttons": [0, 0, 1], "note": True, "switched": 0, "chooses": True}


def test_who_gives_the_instructions_while_wled_sync_does():
    out = _run("""
const r = await open("Sync & team");
const t = texts(r.pane);
out.title = t.includes("Who gives this light its instructions");
out.wledText = t.includes("Other WLED lights can change this one.");
const [wled, padspan] = [btn(r.pane, "WLED sync")[0], btn(r.pane, "PadSpan (exact look)")[0]];
out.wledSelected = /font-weight:700/.test(wled.getAttribute("style"));
out.padspanBlocked = padspan.getAttribute("title");
out.needsLook = t.includes("PadSpan needs a remembered look first.");
out.rememberNow = btn(r.pane, "Remember the look as it is now").length;
out.locked = count(r.pane, "Switched off by PadSpan");
out.save = btn(r.pane, "Save").length;
padspan.click();
await settle();
out.switched = sent(r.calls, "padspan_ha/wled_exact_set").length;
""")
    assert out == {"title": True, "wledText": True, "wledSelected": True, "padspanBlocked": "Remember the look first",
                   "needsLook": True, "rememberNow": 1, "locked": 0, "save": 1, "switched": 0}


def test_switching_to_padspan_shows_the_sync_settings_before_and_after():
    out = _run("""
const r = await open("Sync & team", { x: { join: "wled", look: LOOK, can_switch: true } });
btn(r.pane, "PadSpan (exact look)")[0].click();
await settle();
const t = texts(r.pane);
out.sent = sent(r.calls, "padspan_ha/wled_exact_set");
out.report = ["Sync settings, before → after (a backup was taken first)",
  "Saved: sends to group 1; follows group 1 → doesn't send; follows nothing",
  "Right now: sends to group 1; follows group 1 → doesn't send; follows nothing"].map(l => t.includes(l));
out.toasts = r.toasts.map(x => x[0]);
""")
    assert out["sent"] == [{"exact": True}]
    assert out["report"] == [True, True, True]
    assert "PadSpan gives this light its instructions now" in out["toasts"] and "<exact changed>" in out["toasts"]


def test_while_padspan_runs_it_the_sync_cards_are_read_only():
    out = _run("""
const r = await open("Sync & team", { x: { join: "padspan", exact: true, look: LOOK, sync_off: "live",
  sync_off_message: "Sync is switched off until the device restarts; PadSpan switches it off again every time it turns the light on or reconnects." } });
const t = texts(r.pane);
out.text = t.includes("PadSpan sends every setting each time this light turns on, so it looks the same every time. "
  + "WLED's own sync is switched off on this device, and put back if you switch back.");
out.liveOnly = t.includes("⚠ Sync is switched off until the device restarts; PadSpan switches it off again every time it turns the light on or reconnects.");
out.locked = count(r.pane, "Switched off by PadSpan");
out.save = btn(r.pane, "Save").length;
out.sendDisabled = all(r.pane).find(n => n.tagName === "LABEL" && n.textContent === "Send my changes").firstChild.disabled;
out.savedDisabled = all(r.pane).find(n => n.tagName === "LABEL" && n.textContent === "Brightness").firstChild.disabled;
const before = r.calls.length;
all(r.pane).filter(n => n.tagName === "BUTTON" && n.textContent === "2")[0].click();
await settle();
out.chipWrites = r.calls.slice(before).filter(c => c.type === "padspan_ha/wled_state").length;
btn(r.pane, "WLED sync")[0].click();
await settle();
out.back = sent(r.calls, "padspan_ha/wled_exact_set");
""")
    assert out == {"text": True, "liveOnly": True, "locked": 2, "save": 0, "sendDisabled": True, "savedDisabled": True,
                   "chipWrites": 0, "back": [{"exact": False}]}


_TEAM = ('{ id: "team-1", name: "Kitchen team", mode: "%s", group: 2, leader: "dQ", followers: ["dF"], '
         'prior: PRIOR, incomplete: [] }')


def test_run_this_team_by_padspan():
    out = _run("""
const r = await open("Sync & team", { x: { join: "wled", look: LOOK, team_id: "team-1", team_mode: "mirror" }, teams: [%s] });
const t = texts(r.pane);
out.row = t.includes("Run this team by:");
btn(r.pane, "PadSpan")[0].click();
await settle();
out.sent = sent(r.calls, "padspan_ha/wled_team_mode");
out.asked = confirms[confirms.length - 1];
""" % (_TEAM % "mirror"))
    assert out["row"] is True
    assert out["sent"] == [{"team_id": "team-1", "mode": "padspan"}]
    assert "Every member gets its own remembered look at the same moment. WLED sync is switched off on the members." in out["asked"]


def test_a_padspan_team_back_to_wled_sync_sets_its_group_up_again():
    out = _run("""
const r = await open("Sync & team", { x: { join: "padspan", exact: true, look: LOOK, team_id: "team-1", team_mode: "padspan" }, teams: [%s] });
const t = texts(r.pane);
out.teamText = t.includes("Every member gets its own remembered look at the same moment. WLED sync is switched off on the members.");
out.joinLocked = t.includes("Its team is run by PadSpan — change that on the Team card below.");
const wledButtons = btn(r.pane, "WLED sync");
wledButtons[0].click();                    // the device's own switch: locked while the team is PadSpan's
await settle();
out.deviceSwitch = sent(r.calls, "padspan_ha/wled_exact_set").length;
wledButtons[wledButtons.length - 1].click();
await settle(); await settle();
out.mode = sent(r.calls, "padspan_ha/wled_team_mode");
out.cfg = sent(r.calls, "padspan_ha/wled_cfg").map(c => [c.device_id, c.patch.if.sync.send.grp, c.patch.if.sync.recv.grp, c.base_hash]);
out.order = r.calls.map(c => c.type).filter(x => x === "padspan_ha/wled_team_mode" || x === "padspan_ha/wled_cfg");
""" % (_TEAM % "padspan"))
    assert out["teamText"] and out["joinLocked"] and out["deviceSwitch"] == 0
    assert out["mode"] == [{"team_id": "team-1", "mode": "mirror"}]
    # Then the team's group on each, from its sync before the team: the
    # leader sends on group 2 only, the follower follows group 2 only.
    assert out["cfg"] == [["dQ", 2, 1, "hdQ"], ["dF", 1, 2, "hdF"]]
    assert out["order"][0] == "padspan_ha/wled_team_mode"


def test_breaking_up_a_padspan_team_hands_it_back_to_wled_sync_first():
    out = _run("""
const r = await open("Sync & team", { x: { join: "padspan", exact: true, look: LOOK, team_id: "team-1", team_mode: "padspan" }, teams: [%s] });
btn(r.pane, "Break up the team")[0].click();
await settle(); await settle();
out.order = r.calls.map(c => c.type).filter(x => ["padspan_ha/wled_team_mode", "padspan_ha/wled_cfg", "padspan_ha/wled_teams_set"].includes(x));
out.cfg = sent(r.calls, "padspan_ha/wled_cfg").map(c => [c.device_id, c.patch.if.sync]);
out.saved = sent(r.calls, "padspan_ha/wled_teams_set").map(c => c.teams);
""" % (_TEAM % "padspan"))
    assert out["order"] == ["padspan_ha/wled_team_mode", "padspan_ha/wled_cfg", "padspan_ha/wled_cfg", "padspan_ha/wled_teams_set"]
    assert out["cfg"][0] == ["dQ", {"send": {"en": True, "grp": 1, "dir": False}, "recv": {"grp": 1, "bri": True}}]
    assert out["saved"] == [[]]


def test_a_device_padspan_runs_is_never_put_in_a_wled_sync_team():
    out = _run("""
let r = await open("Sync & team", { x: { join: "wled", look: LOOK }, exact: [{ device_id: "dF" }] });
let t = texts(r.pane);
out.follower = t.includes("Far West — run by PadSpan");
out.pickable = all(r.pane).some(n => n.tagName === "LABEL" && (n.textContent || "").startsWith("Far West"));
r = await open("Sync & team", { x: { join: "padspan", exact: true, look: LOOK }, exact: [{ device_id: "dQ" }] });
t = texts(r.pane);
out.leader = t.includes("PadSpan gives this light its instructions, so it can't lead a WLED sync team. Switch it back to "
  + "WLED sync above to set one up — the team can then be run by PadSpan.");
out.setup = btn(r.pane, "Set up the team").length;
""")
    assert out == {"follower": True, "pickable": False, "leader": True, "setup": 0}
