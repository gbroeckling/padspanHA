# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas WLED card's Advanced tab, rendered for real under node: the
Controls | Advanced strip on a WLED light, the workbench against a fake
device whose JSON has WLED 16's own shapes, and the writes it sends.
Skipped without node."""

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

_PRELUDE = """
import { pathToFileURL } from 'node:url';
const { install, flush } = await import(pathToFileURL(%(shim)s).href);
install(globalThis);
const LM = await import(new URL("lights_map.js", pathToFileURL(%(views)s + "/")).href);
const WA = await import(new URL("wled_advanced.js", pathToFileURL(%(views)s + "/")).href);
const all = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); all(c, acc); } return acc; };
const texts = (n) => all(n).map(c => c.textContent || "");
const settle = async () => { for (let i = 0; i < 8; i++) { await flush(); await new Promise(r => globalThis._realSetTimeout(r, 3)); } };
const DEVICE = {
  "json/si": { info: { name: "Upper North", ver: "16.0.1", vid: 2607070, repo: "wled/WLED", brand: "WLED", arch: "esp32",
                       leds: { count: 120, maxseg: 32, fps: 42, pwr: 850, maxpwr: 2000, bootps: 1 }, mac: "aabbccddeeff", uptime: 5000,
                       wifi: { rssi: -58, signal: 84, channel: 6 } },
               state: { on: true, bri: 128, seg: [
                 { id: 0, start: 0, stop: 50, n: "Porch", on: true, bri: 255, fx: 0, sx: 128, ix: 128, pal: 0, col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]] },
                 { id: 1, start: 40, stop: 100, on: true, bri: 255, fx: 2, sx: 20, ix: 200, pal: 3, col: [[0, 0, 255], [0, 0, 0], [0, 0, 0]] } ] } },
  "json/eff": ["Solid", "RSVD", "Blink", "Fire 2012"],
  "json/fxdata": ["", "", "!,!;!,!;;01", "!,!;;!;1;sx=64,pal=35"],
  "json/pal": ["Default", "* Random Cycle", "* Color 1", "Party"],
  "presets.json": { "0": {}, "1": { n: "Boot", seg: [{ id: 0, start: 0, stop: 120 }] } },
  "json/cfg": { def: { ps: 1 } },
};
function fakeHass(writes) {
  return { states: { "light.upper_north": { state: "on", attributes: { friendly_name: "Upper North", effect_list: ["Solid", "Blink"], brightness: 128 } } },
    callService: async () => {},
    callWS: async (m) => {
      if (m.type === "padspan_ha/wled_get") return { data: DEVICE[m.path] };
      if (m.type === "padspan_ha/wled_state") { writes.push(m.body); return { data: DEVICE["json/si"].state }; }
      throw new Error("unexpected " + m.type);
    } };
}
const out = {};
""" % {"shim": json.dumps(str(_ROOT / "tests" / "js" / "dom_shim.mjs")), "views": json.dumps(str(_VIEWS))}


def _run(script: str) -> dict:
    res = subprocess.run([_NODE, "--input-type=module", "-e", _PRELUDE + script + "\nconsole.log(JSON.stringify(out));\n"],
                         capture_output=True, text=True, encoding="utf-8", timeout=90)
    assert res.returncode == 0, res.stderr[-3000:]
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_tab_strip_is_there_only_for_a_licensed_wled_light():
    out = _run("""
const writes = [];
const hass = fakeHass(writes);
const reg = { platformMap: { "light.upper_north": "wled" }, ipMap: {} };
for (const tier of ["bright", "free"]) {
  LM.openControlCard(hass, "light.upper_north", { ...LM.controlApiFor(reg, "light.upper_north", { tier, isAdmin: true }) });
  const overlay = document.body.children[document.body.children.length - 1];
  out[tier] = texts(overlay).some(t => t === "Advanced");
  document.body.removeChild(overlay);
}
out.notWled = LM.controlApiFor({ platformMap: { "light.k": "hue" } }, "light.k", { tier: "pro" }).wled;
""")
    assert out == {"bright": True, "free": False, "notWled": None}


def test_the_workbench_lays_out_segments_and_flags_the_overlap():
    out = _run("""
const writes = [];
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass: fakeHass(writes), eid: "light.upper_north", api: { wled: { isAdmin: true, tier: "pro" }, toast: () => {} } });
await settle();
const t = texts(pane);
out.overlap = t.some(x => x.includes("Segments 0 and 1 overlap on LEDs 40–49"));
out.gap = t.some(x => x.includes("LEDs 100–119 aren't in any segment"));
out.range = t.some(x => x === "LEDs 0–49 (50)");
out.unsaved = t.some(x => x.includes("Not saved for the next boot"));
out.saveBtn = t.some(x => x === "Keep after restart");
out.version = t.some(x => x === "v16.0.1");
""")
    assert out == {"overlap": True, "gap": True, "range": True, "unsaved": True, "saveBtn": True, "version": True}


def test_non_admins_get_no_save_button_and_writes_resend_the_name():
    out = _run("""
const writes = [];
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass: fakeHass(writes), eid: "light.upper_north", api: { wled: { isAdmin: false, tier: "bright" }, toast: () => {} } });
await settle();
out.saveBtn = texts(pane).some(x => x === "Keep after restart");
all(pane).find(n => n.textContent === "Split in half").click();
await settle();
out.write = writes[0];
""")
    assert out["saveBtn"] is False
    assert out["write"] == {"seg": [{"id": 0, "start": 0, "stop": 25, "n": "Porch"},
                                    {"id": 2, "start": 25, "stop": 50, "n": "Porch (2)"}]}


def test_the_effect_tab_builds_controls_from_the_device_metadata():
    out = _run("""
const writes = [];
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass: fakeHass(writes), eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "Effect").click();
await settle();
const t = texts(pane);
out.catalog = ["Solid", "Blink", "Fire 2012"].every(n => t.includes(n)) && !t.includes("RSVD");
out.sliders = t.includes("Speed") && t.includes("Intensity");
all(pane).find(n => n.textContent === "Fire 2012").click();
await settle();
out.write = writes[0];
""")
    assert out["catalog"] and out["sliders"]
    assert out["write"] == {"seg": [{"id": 0, "fx": 3, "fxdef": True}]}


def test_presets_list_applies_live_and_renames_without_touching_content():
    out = _run("""
const writes = [];
DEVICE["presets.json"] = { "0": {}, "1": { n: "Boot", on: true, bri: 200, seg: [{ id: 0, start: 0, stop: 120, fx: 3 }] },
                           "2": { n: "Party", playlist: { ps: [1], dur: [100], transition: [7] } } };
const pane = document.createElement("div");
globalThis.prompt = () => "Evening";
await WA.mountWledAdvanced(pane, { hass: fakeHass(writes), eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "Presets & playlists").click();
await settle();
const t = texts(pane);
out.summary = t.some(x => x.includes("1 segment · Fire 2012 · brightness 78%"));
out.playlist = t.some(x => x === "Playlist · 1 presets");
out.boot = t.includes("boot");
all(pane).filter(n => n.textContent === "Apply")[0].click();
await settle();
all(pane).filter(n => n.textContent === "Rename")[0].click();
await settle();
out.writes = writes;
""")
    assert out["summary"] and out["playlist"] and out["boot"]
    assert out["writes"][0] == {"ps": 1}
    assert out["writes"][1] == {"n": "Evening", "on": True, "bri": 200,
                                "seg": [{"id": 0, "start": 0, "stop": 120, "fx": 3}], "psave": 1, "o": True}


def test_non_admins_can_apply_but_not_change_presets():
    out = _run("""
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass: fakeHass([]), eid: "light.upper_north", api: { wled: { isAdmin: false }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "Presets & playlists").click();
await settle();
const t = texts(pane);
out.apply = t.includes("Apply");
out.edits = ["Rename", "Delete", "Update", "+ Save current as preset", "+ New playlist"].filter(x => t.includes(x));
""")
    assert out == {"apply": True, "edits": []}


def test_a_team_sets_the_group_on_every_device_then_records_it():
    """Leader sends to the group, followers follow it — saved (through the
    safe cfg write, one per device) and live — and only then is the team
    recorded, so HA and Vacation Mode drive just the leader."""
    out = _run("""
const calls = [];
const devices = [
  { device_id: "dL", name: "Upper North", lights: ["light.upper_north"], sw_version: "16.0.1" },
  { device_id: "dF", name: "Upper South", lights: ["light.upper_south"], sw_version: "0.15.3" },
  { device_id: "dX", name: "Driveway", lights: ["light.driveway"] },
];
const cfgs = { dL: { if: { sync: { send: { en: false, dir: false, grp: 1 }, recv: { grp: 1, bri: true } } } },
               dF: { if: { sync: { send: { grp: 1 }, recv: { grp: 1, bri: false, col: false, fx: false, pal: false } } } } };
const hass = { states: {}, callWS: async (m) => {
  calls.push(m);
  if (m.type === "padspan_ha/wled_get" && m.device_id) return m.path === "json/cfg" ? { data: cfgs[m.device_id], hash: "h" + m.device_id }
    : { data: { ver: m.device_id === "dL" ? "16.0.1" : "0.15.3", vid: m.device_id === "dL" ? 2607070 : 2503090 } };
  if (m.type === "padspan_ha/wled_get") return { data: DEVICE[m.path], hash: "hme" };
  if (m.type === "padspan_ha/wled_teams_get") return { teams: [] };
  if (m.type === "padspan_ha/wled_devices") return { devices };
  if (m.type === "padspan_ha/wled_teams_set") return { teams: m.teams };
  return { data: DEVICE["json/si"].state };
} };
globalThis.confirm = () => true;
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "Sync & team").click();
await settle();
const box = all(pane).find(n => n.tagName === "LABEL" && (n.textContent || "").startsWith("Upper South"));
const cb = box.children[0]; cb.checked = true; cb.dispatchEvent(new Event("change"));
all(pane).find(n => n.textContent === "Set up the team").click();
await settle(); await settle();
out.cfg = calls.filter(c => c.type === "padspan_ha/wled_cfg").map(c => [c.device_id, c.patch, c.base_hash]);
out.live = calls.filter(c => c.type === "padspan_ha/wled_state" && c.device_id).map(c => [c.device_id, c.body]);
const sets = calls.filter(c => c.type === "padspan_ha/wled_teams_set");
out.recorded = sets[0] && sets[0].teams;
out.team = sets[sets.length - 1] && sets[sets.length - 1].teams;
""")
    # Group 1 is every WLED's factory default: a team never takes it (round 5).
    lead, fol = out["cfg"]
    assert lead[0] == "dL" and lead[2] == "hdL"
    # The leader sends ONLY on the team group and stops receiving it.
    assert lead[1] == {"if": {"sync": {"send": {"en": True, "dir": True, "grp": 2}, "recv": {"grp": 1, "bri": True}}}}
    assert fol[0] == "dF"
    # Followers follow ONLY the team group and don't send on it.
    assert fol[1] == {"if": {"sync": {"send": {"grp": 1}, "recv": {"grp": 2, "bri": True, "col": True, "fx": True, "pal": True}}}}
    assert out["live"] == [["dL", {"udpn": {"send": True, "sgrp": 2, "rgrp": 1}}], ["dF", {"udpn": {"send": False, "sgrp": 1, "rgrp": 2}}]]
    team = out["team"][0]
    assert team["group"] == 2 and team["leader"] == "dL" and team["followers"] == ["dF"]
    # What break-up puts back.
    assert team["prior"]["dF"]["recv"] == {"grp": 1, "bri": False, "col": False, "fx": False, "pal": False}
    # Recorded BEFORE any device changed, as not finished everywhere (round 6);
    # marked finished at the end.
    assert out["recorded"][0]["incomplete"] == ["dL", "dF"] and team["incomplete"] == []


def test_the_leds_section_saves_every_output_whole_and_warns_first():
    """hw.led.ins is always sent in full (WLED replaces every output from
    it); problems are named before saving; non-admins only look."""
    out = _run("""
const calls = [];
DEVICE["json/cfg"] = { hw: { led: { total: 120, maxpwr: 850, fps: 42, cct: false,
  ins: [{ start: 0, len: 60, pin: [16], order: 0, rev: false, skip: 0, type: 22 },
        { start: 60, len: 60, pin: [16], order: 1, rev: true, skip: 0, type: 22 }] } } };
const hass = { states: {}, callWS: async (m) => {
  calls.push(m);
  if (m.type === "padspan_ha/wled_get") return { data: m.path === "json/pins" ? [] : DEVICE[m.path], hash: "H" };
  if (m.type === "padspan_ha/wled_cfg") return { backup: "x" };
  return { data: DEVICE["json/si"].state };
} };
globalThis.confirm = (msg) => { out.confirmText = msg; return true; };
for (const admin of [false, true]) {
  const pane = document.createElement("div");
  await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: admin }, toast: () => {} } });
  await settle();
  all(pane).find(n => n.textContent === "LEDs").click();
  await settle(); await settle();
  const t = texts(pane);
  out["warn" + admin] = t.some(x => x.includes("GPIO 16 is used by two outputs"));
  out["save" + admin] = t.includes("Save LED outputs");
  if (admin) { all(pane).find(n => n.textContent === "Save LED outputs").click(); await settle(); }
}
out.patch = (calls.find(c => c.type === "padspan_ha/wled_cfg") || {}).patch;
""")
    assert out["warnfalse"] and out["warntrue"]
    assert out["savefalse"] is False and out["savetrue"] is True
    assert "GPIO 16 is used by two outputs" in out["confirmText"]
    led = out["patch"]["hw"]["led"]
    assert "total" not in led and len(led["ins"]) == 2 and led["ins"][1]["rev"] is True



def test_a_playlist_boot_preset_is_never_overwritten():
    """Boot preset 1 is a playlist: keeping the layout saves a NEW preset and
    points the boot at it (review 2026-09-23)."""
    out = _run("""
const writes = [];
DEVICE["presets.json"] = { "0": {}, "1": { n: "Party", playlist: { ps: [2], dur: [100] } }, "2": { n: "Red", seg: [{ id: 0, start: 0, stop: 120 }] } };
globalThis.confirm = () => true;
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass: fakeHass(writes), eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: () => {} } });
await settle();
out.text = texts(pane).find(x => x.includes("a playlist")) || "";
all(pane).find(n => n.textContent === "Keep after restart").click();
await settle();
out.write = writes[0];
""")
    assert "a playlist" in out["text"]
    assert out["write"] == {"psave": 3, "n": "Layout", "ib": True, "sb": True, "bootps": 3}


def test_a_typed_range_that_would_delete_the_segment_is_refused():
    out = _run("""
const writes = []; const toasts = [];
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass: fakeHass(writes), eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: (m) => toasts.push(m) } });
await settle();
all(pane).filter(n => n.textContent === "▼")[0].click();
await settle();
const label = all(pane).filter(n => n.tagName === "DIV" && n.textContent === "First LED").pop();   // the label itself, not its wrapper
const first = label.parentNode.children[1];
first.value = "70"; first.dispatchEvent(new Event("change"));
await settle();
out.writes = writes; out.toast = toasts.pop() || "";
""")
    assert out["writes"] == [] and "must come after the first" in out["toast"]


def test_identify_is_asked_of_the_backend():
    out = _run("""
const calls = [];
const hass = fakeHass([]);
const orig = hass.callWS;
hass.callWS = async (m) => { calls.push(m.type === "padspan_ha/wled_identify" ? m : null); return orig(m).catch(() => ({})); };
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: false }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "💡 Identify").click();
await settle();
out.call = calls.filter(Boolean)[0];
""")
    assert out["call"] == {"type": "padspan_ha/wled_identify", "entity_id": "light.upper_north", "seg_id": 0, "seconds": 10}


def test_the_settings_section_saves_only_what_changed_and_gamma_whole():
    out = _run("""
const calls = [];
DEVICE["json/cfg"] = { id: { name: "Upper North", mdns: "upper-north" }, def: { on: true, bri: 128, ps: 1 },
  light: { "scale-bri": 100, "pal-mode": 0, aseg: false, gc: { bri: 1, col: 2.2, val: 2.2 }, tr: { dur: 7, rpc: 5, hrp: true },
           nl: { mode: 1, dur: 60, tbri: 0, macro: 0 } },
  if: { ntp: { en: false, host: "0.wled.pool.ntp.org", tz: 0, offset: 0, ampm: false, ln: 0, lt: 0 } },
  timers: { cntdwn: { goal: [20, 1, 1, 0, 0, 0], macro: 0 }, ins: [] },
  hw: { btn: { pull: true, tt: 32, ins: [{ type: 2, pin: [0], macros: [0, 0, 0] }] } } };
const hass = { states: {}, callWS: async (m) => {
  calls.push(m);
  if (m.type === "padspan_ha/wled_get") return { data: DEVICE[m.path], hash: "H" };
  if (m.type === "padspan_ha/wled_cfg") return { backup: "b", after: DEVICE["json/cfg"], hash: "H2", unexpected: [] };
  return { data: DEVICE["json/si"].state };
} };
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "Settings").click();
await settle(); await settle();
const t = texts(pane);
out.sections = ["Device", "When it starts", "Transitions & brightness", "Nightlight", "Time", "Schedules", "Buttons"].every(s => t.includes(s));
out.noMqtt = !t.includes("MQTT");                         // this device reports none
out.ntpWarn = t.some(x => x.includes("Internet time is off"));
// Turn gamma-correct brightness on, then save that section.
const gl = all(pane).filter(n => n.tagName === "DIV" && n.textContent === "Gamma-correct brightness").pop();
const cb = all(gl.parentNode).find(n => n.tagName === "INPUT");
cb.checked = true; cb.dispatchEvent(new Event("change"));
await settle();
all(pane).find(n => n.tagName === "BUTTON" && (n.textContent || "").startsWith("Save 1 change")).click();
await settle();
all(pane).find(n => n.textContent === "+ At sunset").click();
all(pane).find(n => n.textContent === "Save schedules").click();
await settle();
out.patches = calls.filter(c => c.type === "padspan_ha/wled_cfg").map(c => c.patch);
""")
    assert out["sections"] and out["noMqtt"] and out["ntpWarn"]
    assert len(out["patches"]) == 2, out["patches"]
    gamma, timers = out["patches"]
    assert gamma == {"light": {"gc": {"bri": 2.2, "col": 2.2, "val": 2.2}}}      # whole gc, bri now on
    assert timers["timers"]["ins"][0]["hour"] == 254 and timers["timers"]["ins"][0]["dow"] == 127


def test_the_leds_section_shows_the_matrix_with_its_wiring():
    out = _run("""
DEVICE["json/cfg"] = { hw: { led: { maxpwr: 850, fps: 42, ins: [{ start: 0, len: 128, pin: [16], order: 0, type: 22 }],
  matrix: { mpc: 1, panels: [{ b: 0, r: 0, v: 0, s: 1, x: 0, y: 0, w: 16, h: 8 }] } } } };
const hass = { states: {}, callWS: async (m) => m.type === "padspan_ha/wled_get" ? { data: m.path === "json/pins" ? [] : DEVICE[m.path], hash: "H" } : {} };
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "LEDs").click();
await settle(); await settle();
const t = texts(pane);
out.card = t.includes("2D matrix") && t.includes("Save matrix");
out.svg = all(pane).some(n => String(n.innerHTML || "").includes("<polyline") && String(n.innerHTML).includes("#22c55e"));
""")
    assert out == {"card": True, "svg": True}


def test_live_view_subscribes_and_stops_when_the_card_closes():
    out = _run("""
const subs = []; let unsubs = 0;
const hass = fakeHass([]);
hass.connection = { subscribeMessage: async (cb, msg) => { subs.push({ cb, msg }); return () => { unsubs++; }; } };
const holder = document.createElement("div"); document.body.appendChild(holder);
const pane = document.createElement("div"); holder.appendChild(pane);
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: false }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "▶ Live view").click();
await settle();
out.msg = subs[0] && subs[0].msg;
subs[0].cb({ w: 0, h: 0, rgb: "/wAA" });                  // one red LED, drawn without error
document.body.removeChild(holder);                       // the card closes
Object.defineProperty(pane, "isConnected", { value: false });
subs[0].cb({ w: 0, h: 0, rgb: "/wAA" });
out.unsubs = unsubs;
""")
    assert out["msg"] == {"type": "padspan_ha/wled_live", "entity_id": "light.upper_north"}
    assert out["unsubs"] == 1


# ── review round 6 ───────────────────────────────────────────────────────────


def test_a_failed_team_setup_puts_back_every_device_that_changed():
    """A follower's config write succeeded but its live write failed: it
    used to count only as 'failed', was never put back, and kept following
    only the team group with its old settings thrown away."""
    out = _run(r"""
const calls = [];
const toasts = [];
const devices = [
  { device_id: "dL", name: "Upper North", lights: ["light.upper_north"], sw_version: "0.15.3" },
  { device_id: "dA", name: "A", lights: ["light.a"], sw_version: "0.15.3" },
  { device_id: "dB", name: "B", lights: ["light.b"], sw_version: "0.15.3" },
];
const cfgs = {
  dL: { if: { sync: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1, bri: true } } } },
  dA: { if: { sync: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1, bri: false, col: false, fx: false, pal: false } } } },
  dB: { if: { sync: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1 } } } },
};
let recorded = null;
const hass = { states: {}, callWS: async (m) => {
  calls.push(JSON.parse(JSON.stringify(m)));
  if (m.type === "padspan_ha/wled_get" && m.device_id) return m.path === "json/cfg" ? { data: cfgs[m.device_id], hash: "h" + m.device_id }
    : { data: { ver: "0.15.3", vid: 2503090 } };
  if (m.type === "padspan_ha/wled_get") return { data: DEVICE[m.path], hash: "hme" };
  if (m.type === "padspan_ha/wled_teams_get") return { teams: [] };
  if (m.type === "padspan_ha/wled_devices") return { devices };
  if (m.type === "padspan_ha/wled_teams_set") { recorded = m.teams; return { teams: m.teams }; }
  if (m.type === "padspan_ha/wled_cfg") {
    if (m.device_id === "dB") { const e = new Error("i2c"); e.code = "i2c_in_use"; throw e; }
    // the device applies it
    cfgs[m.device_id] = JSON.parse(JSON.stringify({ ...cfgs[m.device_id], if: { sync: { ...cfgs[m.device_id].if.sync, ...m.patch.if.sync } } }));
    return { backup: "b", unexpected: [] };
  }
  if (m.type === "padspan_ha/wled_state" && m.device_id === "dA" && !globalThis._aBusyOnce) { globalThis._aBusyOnce = true; const e = new Error("busy"); e.code = "busy"; throw e; }
  return { data: DEVICE["json/si"].state };
} };
globalThis.confirm = () => true;
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: (t, bad) => toasts.push([t, !!bad]) } });
await settle();
all(pane).find(n => n.textContent === "Sync & team").click();
await settle();
for (const nm of ["A", "B"]) {
  const box = all(pane).find(n => n.tagName === "LABEL" && (n.textContent || "").startsWith(nm + " "));
  const cb = box.children[0]; cb.checked = true; cb.dispatchEvent(new Event("change"));
}
all(pane).find(n => n.textContent === "Set up the team").click();
for (let i = 0; i < 6; i++) await settle();
out.cfgWrites = calls.filter(c => c.type === "padspan_ha/wled_cfg").map(c => [c.device_id, JSON.stringify(c.patch.if.sync.recv.grp), JSON.stringify(c.patch.if.sync.send.grp)]);
out.finalCfgA = cfgs.dA.if.sync;
out.recorded = recorded;
out.toasts = toasts.filter(t => t[1]);

""")
    # Stops at the first failure: B is never touched.
    assert [w[0] for w in out["cfgWrites"]] == ["dL", "dA", "dL", "dA"], out["cfgWrites"]
    assert out["finalCfgA"]["recv"]["grp"] == 1, "A is back on its own group"
    assert out["recorded"] == [], "nothing left recorded once everything is back"
    assert out["toasts"] and "every device that changed was put back" in out["toasts"][-1][0]


def test_a_second_press_during_setup_does_nothing():
    """Pressed again mid-setup, the second run read the leader's half-done
    state as its 'before', and a later break-up left it on the team group."""
    out = _run(r"""
const devices = [
  { device_id: "dL", name: "Upper North", lights: ["light.upper_north"], sw_version: "0.15.3" },
  { device_id: "dA", name: "A", lights: ["light.a"], sw_version: "0.15.3" },
];
const cfgs = {
  dL: { if: { sync: { send: { en: false, dir: false, grp: 1 }, recv: { grp: 1, bri: true } } } },
  dA: { if: { sync: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1, bri: false, col: false, fx: false } } } },
};
const saves = [];
let secondClick = null;
let cfgWrites = 0;
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 5));
const hass = { states: {}, callWS: async (m) => {
  await tick();                                   // a real round trip
  if (m.type === "padspan_ha/wled_get" && m.device_id) return m.path === "json/cfg" ? { data: JSON.parse(JSON.stringify(cfgs[m.device_id])), hash: "h" }
    : { data: { ver: "0.15.3", vid: 2503090 } };
  if (m.type === "padspan_ha/wled_get") return { data: DEVICE[m.path], hash: "hme" };
  if (m.type === "padspan_ha/wled_teams_get") return { teams: [] };
  if (m.type === "padspan_ha/wled_devices") return { devices };
  if (m.type === "padspan_ha/wled_teams_set") { saves.push(JSON.parse(JSON.stringify(m.teams))); return { teams: m.teams }; }
  if (m.type === "padspan_ha/wled_cfg") {
    const s = cfgs[m.device_id].if.sync; Object.assign(s, JSON.parse(JSON.stringify(m.patch.if.sync)));
    cfgWrites++;
    if (cfgWrites === 1 && secondClick) secondClick();   // the person presses again after the leader is done
    return { backup: "b", unexpected: [] };
  }
  return { data: DEVICE["json/si"].state };
} };
globalThis.confirm = () => true;
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: () => {} } });
await settle();
all(pane).find(n => n.textContent === "Sync & team").click();
for (let i = 0; i < 4; i++) await settle();
const box = all(pane).find(n => n.tagName === "LABEL" && (n.textContent || "").startsWith("A "));
const cb = box.children[0]; cb.checked = true; cb.dispatchEvent(new Event("change"));
const btn = all(pane).find(n => n.textContent === "Set up the team");
secondClick = () => btn.click();
btn.click();
for (let i = 0; i < 20; i++) await settle();
out.saves = saves.length;
out.lastRecordedPriorLeader = saves.length ? saves[saves.length - 1][0].prior.dL : null;
out.firstRecordedPriorLeader = saves.length ? saves[0][0].prior.dL : null;

""")
    assert out["saves"] == 2, out           # recorded, then marked finished — once
    assert out["firstRecordedPriorLeader"]["send"] == {"en": False, "dir": False, "grp": 1}
    assert out["lastRecordedPriorLeader"]["send"] == {"en": False, "dir": False, "grp": 1}


def test_a_device_that_cant_be_put_back_keeps_the_team_for_a_retry():
    """A's live write keeps failing, so the rollback can't finish on it: the
    team stays recorded as not finished on A, so a break-up can retry."""
    out = _run(r"""
const calls = [];
const toasts = [];
const devices = [
  { device_id: "dL", name: "Upper North", lights: ["light.upper_north"], sw_version: "0.15.3" },
  { device_id: "dA", name: "A", lights: ["light.a"], sw_version: "0.15.3" },
  { device_id: "dB", name: "B", lights: ["light.b"], sw_version: "0.15.3" },
];
const cfgs = {
  dL: { if: { sync: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1, bri: true } } } },
  dA: { if: { sync: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1, bri: false, col: false, fx: false, pal: false } } } },
  dB: { if: { sync: { send: { en: true, dir: false, grp: 1 }, recv: { grp: 1 } } } },
};
let recorded = null;
const hass = { states: {}, callWS: async (m) => {
  calls.push(JSON.parse(JSON.stringify(m)));
  if (m.type === "padspan_ha/wled_get" && m.device_id) return m.path === "json/cfg" ? { data: cfgs[m.device_id], hash: "h" + m.device_id }
    : { data: { ver: "0.15.3", vid: 2503090 } };
  if (m.type === "padspan_ha/wled_get") return { data: DEVICE[m.path], hash: "hme" };
  if (m.type === "padspan_ha/wled_teams_get") return { teams: [] };
  if (m.type === "padspan_ha/wled_devices") return { devices };
  if (m.type === "padspan_ha/wled_teams_set") { recorded = m.teams; return { teams: m.teams }; }
  if (m.type === "padspan_ha/wled_cfg") {
    if (m.device_id === "dB") { const e = new Error("i2c"); e.code = "i2c_in_use"; throw e; }
    // the device applies it
    cfgs[m.device_id] = JSON.parse(JSON.stringify({ ...cfgs[m.device_id], if: { sync: { ...cfgs[m.device_id].if.sync, ...m.patch.if.sync } } }));
    return { backup: "b", unexpected: [] };
  }
  if (m.type === "padspan_ha/wled_state" && m.device_id === "dA") { const e = new Error("busy"); e.code = "busy"; throw e; }
  return { data: DEVICE["json/si"].state };
} };
globalThis.confirm = () => true;
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass, eid: "light.upper_north", api: { wled: { isAdmin: true }, toast: (t, bad) => toasts.push([t, !!bad]) } });
await settle();
all(pane).find(n => n.textContent === "Sync & team").click();
await settle();
for (const nm of ["A", "B"]) {
  const box = all(pane).find(n => n.tagName === "LABEL" && (n.textContent || "").startsWith(nm + " "));
  const cb = box.children[0]; cb.checked = true; cb.dispatchEvent(new Event("change"));
}
all(pane).find(n => n.textContent === "Set up the team").click();
for (let i = 0; i < 6; i++) await settle();
out.cfgWrites = calls.filter(c => c.type === "padspan_ha/wled_cfg").map(c => [c.device_id, JSON.stringify(c.patch.if.sync.recv.grp), JSON.stringify(c.patch.if.sync.send.grp)]);
out.finalCfgA = cfgs.dA.if.sync;
out.recorded = recorded;
out.toasts = toasts.filter(t => t[1]);

""")
    assert out["recorded"] and out["recorded"][0]["incomplete"] == ["dA"], out["recorded"]
    assert "couldn't be put back" in out["toasts"][-1][0]
