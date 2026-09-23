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
out.saveBtn = t.some(x => x === "Save as boot preset");
out.version = t.some(x => x === "v16.0.1");
""")
    assert out == {"overlap": True, "gap": True, "range": True, "unsaved": True, "saveBtn": True, "version": True}


def test_non_admins_get_no_save_button_and_writes_resend_the_name():
    out = _run("""
const writes = [];
const pane = document.createElement("div");
await WA.mountWledAdvanced(pane, { hass: fakeHass(writes), eid: "light.upper_north", api: { wled: { isAdmin: false, tier: "bright" }, toast: () => {} } });
await settle();
out.saveBtn = texts(pane).some(x => x === "Save as boot preset");
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
out.team = (calls.find(c => c.type === "padspan_ha/wled_teams_set") || {}).teams;
""")
    # No team exists yet, so the draft takes sync group 1 — the first no team uses.
    lead, fol = out["cfg"]
    assert lead[0] == "dL" and lead[2] == "hdL"
    assert lead[1] == {"if": {"sync": {"send": {"en": True, "dir": True, "grp": 1}}}}
    assert fol[0] == "dF"
    assert fol[1] == {"if": {"sync": {"recv": {"grp": 1, "bri": True, "col": True, "fx": True, "pal": True}}}}
    assert out["live"] == [["dL", {"udpn": {"send": True, "sgrp": 1}}], ["dF", {"udpn": {"rgrp": 1}}]]
    assert out["team"] == [{"id": "team-dL", "name": "Upper North team", "mode": "mirror", "group": 1,
                            "leader": "dL", "followers": ["dF"]}]
