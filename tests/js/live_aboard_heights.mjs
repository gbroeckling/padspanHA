// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Heights on the placement record, in Live Aboard (Garry, 2026-10-05: "same
// information store"): the rules (views/live_aboard_draft.js) and the real
// 3D view and editor (views/live_aboard.js, live_aboard_edit.js) under the
// DOM shim with a stub GL.
//
//   rules   recordHeights takes only real heights, and Default chosen (null);
//           with none in any record the 3D file is the drawing's, the very
//           same object; a record's height (or its Default) lands in the
//           section the view reads it from, over the file's; Save splits: a
//           placed device's height to its record only when the draft changed
//           it from where it started (review finding 3: never a stale one
//           over a newer record), the rest to the 3D file, whose own copy of a
//           height is never taken out (an older PadSpan reads it there)
//   read    the record's height first (Default chosen beats the file's:
//           finding 7), then the 3D file's, then the kind's default; with no
//           height in any record the house is drawn exactly from the file
//           and the defaults, as before; a height just saved gives way when
//           the map brings another (finding 4)
//   save    Edit → Heights writes the record: one Save, the height command
//           only (nothing for the 3D file), Undo and Discard before Save send
//           nothing; a height and a kind in one Save: both writes, the file
//           without the height; Reset to default clears the record; heights
//           refused: nothing saved, said plainly; the file failing after the
//           heights went in: said so, the rest kept to save again, and from
//           then on Undo, Discard and the next Save count the heights as saved
//           (finding 1); a device dropped on Mapping's map and not yet saved
//           has no record yet: its height goes to the 3D file (finding 4); a
//           host with no height command: all to the file, as before
//
// usage: live_aboard_heights.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], payloads: [...] }
// payloads: what went to the 3D file (house3d_edit), which the server's own
// apply_edit must take (test_atlas_heights.py), and heights: what went to
// fabric_light_height_set, which its schema must take.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_heights.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
const winL = {};
globalThis.addEventListener = (t, fn) => { (winL[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winL[t] = (winL[t] || []).filter(f => f !== fn); };
installStubGL();

const LA = await import(pathToFileURL(join(WWW, "views", "live_aboard.js")).href);
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const D = await import(pathToFileURL(join(WWW, "views", "live_aboard_draft.js")).href);

const failures = [], cases = {}, payloads = [], heightCalls = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 1200) }); cases[name] = false; } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const settle = async (rounds = 12) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-6;

// ── rules ───────────────────────────────────────────────────────────────────
await tryCase("rules: only real heights and Default chosen; none in any record: the file itself", async () => {
  const recs = D.recordHeights({ light_positions_m: { a: { z_m: 1.2 }, b: { z_m: "2" }, c: { z_m: null }, d: {}, e: { z_m: NaN } } });
  const file = D.ownedOf({ lights: { a: { z_m: 2.2, kind: "pendant" } } });
  check("rules: only real heights and Default chosen; none in any record: the file itself",
    JSON.stringify(recs) === '{"a":1.2,"c":null}' && D.withRecordHeights(file, {}, () => "lights") === file
    && JSON.stringify(D.recordHeights(null)) === "{}", recs);
});
await tryCase("rules: a record's height lands where the view reads it, over the file's", async () => {
  const file = D.ownedOf({ lights: { "light.a": { z_m: 2.2, kind: "pendant" } }, devices: { "sensor.t": { z_m: 1.0 } } });
  const sec = (eid) => (eid.startsWith("light.") ? "lights" : "devices");
  const v = D.withRecordHeights(file, { "light.a": 1.7, "sensor.t": 1.4, "lock.f": 0.9 }, sec);
  // Default chosen on the record: the file's height no longer stands in.
  const w = D.withRecordHeights(file, { "light.a": null, "sensor.t": null }, sec);
  check("rules: a record's height lands where the view reads it, over the file's",
    v.lights["light.a"].z_m === 1.7 && v.lights["light.a"].kind === "pendant" && v.devices["sensor.t"].z_m === 1.4
    && v.devices["lock.f"].z_m === 0.9 && file.lights["light.a"].z_m === 2.2 && v.openings === file.openings
    && JSON.stringify(w.lights["light.a"]) === '{"kind":"pendant"}' && !("sensor.t" in w.devices), { v, w });
});
const canonical = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((q) => [q, v[q]])) : v));
await tryCase("rules: Save splits heights to the records and the rest to the file", async () => {
  const file = D.ownedOf({ lights: { "light.a": { z_m: 2.2, kind: "pendant" }, "light.b": { kind: "pot" }, "light.loose": { z_m: 1 } },
                           devices: { "sensor.t": { z_m: 1.0 } } });
  const placed = new Set(["light.a", "light.b", "light.c", "sensor.t"]);
  // Where the draft started (the file with the records' heights over it): light.b at 2.6 on its record.
  const base = D.ownedOf({ lights: { "light.a": { z_m: 2.2, kind: "pendant" }, "light.b": { z_m: 2.6, kind: "pot" }, "light.loose": { z_m: 1 } },
                           devices: { "sensor.t": { z_m: 1.0 } } });
  // light.a: only its kind changed (its height stays where it is, the file
  // keeps its own copy); light.b: back to its default; light.c: a new height;
  // sensor.t: unchanged; light.loose (no record): the file, as before.
  const s1 = D.splitSave(file, { lights: { "light.a": { z_m: 2.2, kind: "chandelier" }, "light.b": { kind: "pot" }, "light.c": { z_m: 1.1 },
                                            "light.loose": { z_m: 1.5 } },
                                 devices: { "sensor.t": { z_m: 1.0 } }, openings: { win_00000001: { x: 1 } } }, base, placed);
  // Only heights: nothing for the file.
  const s2 = D.splitSave(D.ownedOf({}), { lights: { "light.c": { z_m: 1.3 } } }, D.ownedOf({}), placed);
  // Reset to default on a light with nothing else: the record set to its default, the file untouched.
  const s3 = D.splitSave(D.ownedOf({}), { lights: { "light.b": null } }, D.ownedOf({ lights: { "light.b": { z_m: 2.6 } } }), placed);
  check("rules: Save splits heights to the records and the rest to the file",
    canonical(s1.heights) === canonical({ "light.b": null, "light.c": 1.1 })
    && canonical(s1.file.lights) === canonical({ "light.a": { kind: "chandelier", z_m: 2.2 }, "light.loose": { z_m: 1.5 } })
    && !s1.file.devices && !!s1.file.openings.win_00000001
    && canonical(s2) === canonical({ heights: { "light.c": 1.3 }, file: null })
    && canonical(s3) === canonical({ heights: { "light.b": null }, file: null }), { s1, s2, s3 });
});
await tryCase("rules: a kind changed while the record moved on elsewhere sends no stale height", async () => {
  // Review finding 3: Live Aboard's draft started with the pendant at 1.6;
  // meanwhile Mapping set its record to 2.0; here only its kind changes.
  const file = D.ownedOf({ lights: { "light.p": { kind: "pendant" } } });
  const base = D.ownedOf({ lights: { "light.p": { z_m: 1.6, kind: "pendant" } } });
  const s = D.splitSave(file, { lights: { "light.p": { z_m: 1.6, kind: "chandelier" } } }, base, new Set(["light.p"]));
  check("rules: a kind changed while the record moved on elsewhere sends no stale height",
    s.heights === null && canonical(s.file) === canonical({ lights: { "light.p": { kind: "chandelier" } } }), s);
});
await tryCase("rules: the heights saved become where the draft starts, the rest kept", async () => {
  // Review finding 1: the heights went in, the file did not.
  const base = D.ownedOf({ lights: { "light.p": { z_m: 1.6, kind: "pendant" } }, devices: { "sensor.t": { z_m: 1.2 } } });
  const ch = { lights: { "light.p": { z_m: 1.25, kind: "chandelier" } }, devices: { "sensor.t": null } };
  const b = D.baseWithHeights(base, ch, { "light.p": 1.25, "sensor.t": null });
  check("rules: the heights saved become where the draft starts, the rest kept",
    canonical(b.lights["light.p"]) === canonical({ z_m: 1.25, kind: "pendant" }) && !("sensor.t" in b.devices)
    && base.lights["light.p"].z_m === 1.6, b);
});

// ── the house, the 3D file, the server ──────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const BASE = {
  floors: [{ id: "main", name: "Main" }],
  room_geometry_m: { Living: rect("main", 0, 0, 4.5, 8), Den: rect("main", 4.6, 0, 10, 8) },
  rf_barriers_m: [],
  light_positions_m: {
    "light.den": { x_m: 9.2, y_m: 0.9, floor_id: "main" },
    "light.living": { x_m: 2.2, y_m: 4, floor_id: "main" },
    "light.lamp": { x_m: 1.0, y_m: 7, floor_id: "main" },
    "sensor.den_temp": { x_m: 9.2, y_m: 7.1, floor_id: "main" },
  },
};
const LBE = {
  "light.den": { entity_id: "light.den", friendly_name: "Den light", state: "on", brightness: 200, shape: "pendant" },
  "light.living": { entity_id: "light.living", friendly_name: "Living light", state: "on", brightness: 200, shape: "hex" },
  "light.lamp": { entity_id: "light.lamp", friendly_name: "Floor lamp", state: "on", brightness: 200, shape: "hex" },
  "sensor.den_temp": { entity_id: "sensor.den_temp", friendly_name: "Den temperature", isTemp: true, state: "21.5",
                       device_class: "temperature", unit_of_measurement: "°C" },
};
const server = { file: null, model: null, fail: null, failHeights: null };
const editFn = async (changes) => {
  payloads.push(clone(changes));
  if (server.fail) { const f = server.fail; server.fail = null; throw f; }
  const next = clone(server.file);
  for (const [sec, entries] of Object.entries(changes)) for (const [k, v] of Object.entries(entries)) {
    if (v === null) delete next[sec][k]; else next[sec][k] = clone(v);
  }
  server.file = next;
  return { data: clone(next), counts: {} };
};
const heightsFn = async (heights) => {
  heightCalls.push(clone(heights));
  if (server.failHeights) { const f = server.failHeights; server.failHeights = null; throw f; }
  for (const [eid, z] of Object.entries(heights)) {
    server.model.light_positions_m[eid].z_m = z;                 // null: the default, chosen
  }
  return { ok: true, heights };
};
const api = { calls: [], toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null,
              lightsByEid: {}, hass: null };
let slotN = 0, slot = null, withHeights = true, draftOnly = null;
const P = () => ({ model: clone(server.model), floors: server.model.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, states: {}, config: {}, bearing: 0, saveNorth: null, useApi: () => api, haStartedMs: 0,
  load: async () => ({ data: clone(server.file) }), edit: editFn, heights: withHeights ? heightsFn : null,
  // Mapping: the draft adds a device just dropped (draftOnly), not yet saved.
  ...(draftOnly ? { placed: () => Object.keys(server.model.light_positions_m) } : null) });
const drawnModel = () => (draftOnly ? { ...clone(server.model), light_positions_m: { ...clone(server.model.light_positions_m), ...draftOnly } } : clone(server.model));
function poll(){
  const card = document.createElement("div"), stage = document.createElement("div");
  card.appendChild(stage);
  document.body.replaceChildren(card);
  return slot.attach(stage, { ...P(), model: drawnModel() });
}
async function start(model, file){
  server.model = clone(model); server.file = clone(file); server.fail = null; server.failHeights = null;
  slot = LA.liveAboardSlot(`heights-${++slotN}`);
  poll();
  await settle(40);
  poll();
  await settle(20);
}
const st = () => slot._state();
const ed = () => st().edit;
const root = () => slot.element;
const zOf = (eid) => {
  const L = st().heights.lights.find(x => x.eid === eid) || st().heights.devices.find(x => x.eid === eid);
  return L ? L.z : null;
};
function button(label, cls){
  const box = cls ? root().querySelectorAll("." + cls)[0] : root();
  return box ? box.querySelectorAll("button").find(b => b.textContent === label) || null : null;
}
const click = (label, cls) => { const b = button(label, cls); if (!b || b.disabled) return false; b.click(); return true; };
let seq = 0;
function fire(type, x, y){
  const ev = { type, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
               isPrimary: true, shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: ++seq, target: st().canvas,
               preventDefault(){}, stopPropagation(){} };
  for (const fn of [...(winL[type] || [])]) fn(ev);
  ev.target.dispatchEvent(ev);
}
const tap = (p) => { fire("pointerdown", p[0], p[1]); fire("pointerup", p[0], p[1]); };
const sliderOf = (label) => (root().querySelectorAll(".la3d-sheet")[0] || { querySelectorAll: () => [] }).querySelectorAll("input")
  .find(r => r.getAttribute("aria-label") === label) || null;
function slide(label, v){ const r = sliderOf(label); if (!r) return false; r.value = String(v); r.dispatchEvent({ type: "input" }); r.dispatchEvent({ type: "change" }); return true; }
async function openHeights(){
  if (!ed().editing) click("Edit");
  await settle();
  if (ed().tool !== "heights") click("Heights", "la3d-tools");
  slot._look(0.6, 0.7, [5, 2.8, 4], 26);
  await settle();
}
async function pickDevice(eid){ tap(slot._where({ eid })); await settle(); return ed().sel && ed().sel.eid === eid; }
const hint = () => ed().hint || "";
const withZ = (eids) => { const m = clone(BASE); for (const [k, z] of Object.entries(eids)) m.light_positions_m[k].z_m = z; return m; };
const FILE = { schema: 1, openings: {}, lights: { "light.den": { z_m: 2.3, kind: "pendant" }, "light.living": { z_m: 1.9 } },
               devices: { "sensor.den_temp": { z_m: 1.1 } }, pieces: {}, figures: {} };

// ── read ────────────────────────────────────────────────────────────────────
await tryCase("read: the record's height first, then the 3D file's, then the kind's default", async () => {
  await start(withZ({ "light.den": 1.6, "sensor.den_temp": 1.35, "light.lamp": 0.4 }), FILE);
  const den = zOf("light.den"), liv = zOf("light.living"), lamp = zOf("light.lamp"), temp = zOf("sensor.den_temp");
  // Nothing anywhere: the default (not listed as moved).
  const plain = st().heights.lights.find(x => x.eid === "light.living");
  await start(withZ({ "light.den": 1.6 }), { schema: 1, openings: {}, lights: {}, devices: {}, pieces: {}, figures: {} });
  const noFile = st().heights.lights.map(x => x.eid);
  check("read: the record's height first, then the 3D file's, then the kind's default",
    near(den, 1.6) && near(liv, 1.9) && near(lamp, 0.4) && near(temp, 1.35) && plain && near(plain.z, 1.9)
    && JSON.stringify(noFile) === JSON.stringify(["light.den"]), { den, liv, lamp, temp, noFile });
});
await tryCase("read: Default chosen on the record beats a height still in the 3D file", async () => {
  await start(withZ({ "light.den": null, "sensor.den_temp": null }), FILE);
  const den = st().heights.lights.find(x => x.eid === "light.den"), temp = st().heights.devices.find(x => x.eid === "sensor.den_temp");
  check("read: Default chosen on the record beats a height still in the 3D file", !den && !temp && near(zOf("light.living"), 1.9),
    { den, temp, heights: st().heights });
});
await tryCase("read: with no height in any record, the house is drawn from the file and the defaults as before", async () => {
  await start(clone(BASE), FILE);
  const a = clone(st().heights), fixtures = clone(st().fixtures);
  check("read: with no height in any record, the house is drawn from the file and the defaults as before",
    a.lights.length === 2 && near(a.lights.find(x => x.eid === "light.den").z, 2.3) && near(a.lights.find(x => x.eid === "light.living").z, 1.9)
    && a.devices.length === 1 && near(a.devices[0].z, 1.1) && fixtures.length === 3, { a, n: fixtures.length });
});

// ── save ────────────────────────────────────────────────────────────────────
await tryCase("save: Heights writes the record in one Save, and nothing to the file", async () => {
  await start(withZ({ "light.den": 1.6 }), { ...FILE, lights: { "light.den": { kind: "pendant" } }, devices: {} });
  heightCalls.length = 0;
  const before = payloads.length;
  await openHeights();
  const picked = await pickDevice("light.den");
  const shownAt = sliderOf("Height") ? Number(sliderOf("Height").value) : null;
  slide("Height", 1.25);
  await settle();
  const drawn = zOf("light.den");
  click("Save", "la3d-tools");
  await settle(); await settle();
  // The map read again (the host refreshes it): the next card has the record's height.
  poll(); await settle();
  check("save: Heights writes the record in one Save, and nothing to the file",
    picked && near(shownAt, 1.6) && near(drawn, 1.25) && heightCalls.length === 1
    && JSON.stringify(heightCalls[0]) === JSON.stringify({ "light.den": 1.25 }) && payloads.length === before
    && server.model.light_positions_m["light.den"].z_m === 1.25 && server.file.lights["light.den"].kind === "pendant"
    && !ed().dirty && near(zOf("light.den"), 1.25) && /Saved/.test(hint()), { picked, shownAt, drawn, heightCalls, sent: payloads.length - before, hint: hint() });
});
await tryCase("save: Undo and Discard before Save send nothing", async () => {
  heightCalls.length = 0;
  const before = payloads.length;
  slide("Height", 2.0);
  await settle();
  const moved = zOf("light.den");
  click("Undo", "la3d-tools");
  await settle();
  const undone = zOf("light.den");
  slide("Height", 2.1);
  await settle();
  click("Discard", "la3d-tools");
  await settle();
  const discarded = zOf("light.den");
  check("save: Undo and Discard before Save send nothing",
    near(moved, 2.0) && near(undone, 1.25) && near(discarded, 1.25) && !ed().dirty && heightCalls.length === 0 && payloads.length === before,
    { moved, undone, discarded });
});
await tryCase("save: a kind and Reset to default in one Save: the record gets its Default, the file keeps its own copy", async () => {
  await start(clone(BASE), FILE);                                  // the heights still in the file (not moved yet)
  heightCalls.length = 0;
  const before = payloads.length;
  await openHeights();
  await pickDevice("light.living");
  const kind = root().querySelectorAll(".la3d-sheet")[0].querySelectorAll("select")[0];
  kind.value = "chandelier"; kind.dispatchEvent({ type: "change" });
  await settle();
  await pickDevice("sensor.den_temp");
  click("Reset to default", "la3d-sheet");
  await settle();
  click("Save", "la3d-tools");
  await settle(); await settle();
  const sentFile = payloads.slice(before);
  check("save: a kind and Reset to default in one Save: the record gets its Default, the file keeps its own copy",
    heightCalls.length === 1 && canonical(heightCalls[0]) === canonical({ "sensor.den_temp": null })
    && sentFile.length === 1 && canonical(sentFile[0]) === canonical({ lights: { "light.living": { kind: "chandelier", z_m: 1.9 } } })
    && !("z_m" in server.model.light_positions_m["light.living"]) && server.file.lights["light.living"].z_m === 1.9
    && server.file.devices["sensor.den_temp"].z_m === 1.1 && server.model.light_positions_m["sensor.den_temp"].z_m === null
    && !ed().dirty && !st().heights.devices.some(x => x.eid === "sensor.den_temp"),
    { heightCalls, sentFile, rec: server.model.light_positions_m, file: server.file });
});
await tryCase("save: heights refused: nothing saved, said plainly", async () => {
  await start(withZ({ "light.den": 1.6 }), { ...FILE, lights: {}, devices: {} });
  const before = payloads.length;
  await openHeights();
  await pickDevice("light.den");
  slide("Height", 1.4);
  server.failHeights = Object.assign(new Error("Light placement needs PadSpan Bright Pro or PadSpan Pro."), { code: "pro_required" });
  click("Save", "la3d-tools");
  await settle(); await settle();
  const h = hint();
  check("save: heights refused: nothing saved, said plainly",
    /^Not saved: the heights couldn't be saved/.test(h) && /Nothing was changed/.test(h) && ed().dirty && payloads.length === before
    && server.model.light_positions_m["light.den"].z_m === 1.6, { h });
  click("Discard", "la3d-tools"); await settle();
});
await tryCase("save: the file failing after the heights went in says so, and the rest stays to save again", async () => {
  await start(withZ({ "light.den": 1.6 }), { ...FILE, lights: {}, devices: {} });
  heightCalls.length = 0;
  await openHeights();
  await pickDevice("light.den");
  slide("Height", 1.45);
  const kind = root().querySelectorAll(".la3d-sheet")[0].querySelectorAll("select")[0];
  kind.value = "chandelier"; kind.dispatchEvent({ type: "change" });
  await settle();
  server.fail = Object.assign(new Error("Could not save Live Aboard. Nothing was changed."), { code: "save_failed" });
  click("Save", "la3d-tools");
  await settle(); await settle();
  const h = hint(), dirty = ed().dirty, rec = server.model.light_positions_m["light.den"].z_m;
  click("Save", "la3d-tools");                                     // again: the rest goes in
  await settle(); await settle();
  check("save: the file failing after the heights went in says so, and the rest stays to save again",
    /^Heights saved\. The rest wasn't: Live Aboard's file couldn't be written\./.test(h) && dirty && rec === 1.45
    && !ed().dirty && server.file.lights["light.den"].kind === "chandelier" && heightCalls.every(c => c["light.den"] === 1.45),
    { h, dirty, rec, heightCalls, file: server.file.lights });
});
await tryCase("save: after a Save that went partly in, Undo, Discard and the next Save count the heights as saved", async () => {
  await start(withZ({ "light.den": 1.6 }), { ...FILE, lights: {}, devices: {} });
  heightCalls.length = 0;
  await openHeights();
  await pickDevice("light.den");
  slide("Height", 1.45);
  const kind = root().querySelectorAll(".la3d-sheet")[0].querySelectorAll("select")[0];
  kind.value = "chandelier"; kind.dispatchEvent({ type: "change" });
  await settle();
  server.fail = Object.assign(new Error("Could not save Live Aboard. Nothing was changed."), { code: "save_failed" });
  click("Save", "la3d-tools");
  await settle(); await settle();
  // Discard: the kind goes back; the height stays the saved one.
  click("Discard", "la3d-tools"); await settle();
  const afterDiscard = zOf("light.den"), dirty = ed().dirty;
  // Undo all the way (the Discard, the kind, the height): the old height is
  // back, and the next Save sends it back to the record too.
  for (let i = 0; i < 3; i++) { click("Undo", "la3d-tools"); await settle(); }
  const afterUndo = zOf("light.den");
  heightCalls.length = 0;
  click("Save", "la3d-tools");
  await settle(); await settle();
  check("save: after a Save that went partly in, Undo, Discard and the next Save count the heights as saved",
    near(afterDiscard, 1.45) && !dirty && near(afterUndo, 1.6) && heightCalls.length === 1 && heightCalls[0]["light.den"] === 1.6
    && server.model.light_positions_m["light.den"].z_m === 1.6, { afterDiscard, dirty, afterUndo, heightCalls });
});
await tryCase("save: a device dropped on Mapping's map, not yet saved: its height goes to the 3D file", async () => {
  draftOnly = { "light.lamp": { x_m: 1.0, y_m: 7, floor_id: "main" } };
  const model = clone(BASE);
  delete model.light_positions_m["light.lamp"];
  await start(model, { ...FILE, lights: {}, devices: {} });
  heightCalls.length = 0;
  const before = payloads.length;
  await openHeights();
  const picked = await pickDevice("light.lamp");
  slide("Height", 1.3);
  click("Save", "la3d-tools");
  await settle(); await settle();
  const sentFile = payloads.slice(before), h = hint();
  draftOnly = null;
  check("save: a device dropped on Mapping's map, not yet saved: its height goes to the 3D file",
    picked && heightCalls.length === 0 && sentFile.length === 1 && canonical(sentFile[0]) === canonical({ lights: { "light.lamp": { z_m: 1.3 } } })
    && !ed().dirty && /Saved/.test(h), { picked, heightCalls, sentFile, h });
});
await tryCase("read: a height just saved gives way when the map brings another", async () => {
  await start(withZ({ "light.den": 1.6 }), { ...FILE, lights: {}, devices: {} });
  await openHeights();
  await pickDevice("light.den");
  slide("Height", 1.25);
  click("Save", "la3d-tools");
  await settle(); await settle();
  const saved = zOf("light.den");
  // Mapping saves another height for it; the map's next read brings it.
  server.model.light_positions_m["light.den"].z_m = 2.0;
  poll(); await settle();
  check("read: a height just saved gives way when the map brings another", near(saved, 1.25) && near(zOf("light.den"), 2.0),
    { saved, now: zOf("light.den") });
});
await tryCase("save: a host with no height command: all to the file, as before", async () => {
  withHeights = false;
  await start(clone(BASE), { ...FILE, lights: {}, devices: {} });
  heightCalls.length = 0;
  const before = payloads.length;
  await openHeights();
  await pickDevice("light.den");
  slide("Height", 1.3);
  click("Save", "la3d-tools");
  await settle(); await settle();
  const sentFile = payloads.slice(before);
  withHeights = true;
  check("save: a host with no height command: all to the file, as before",
    heightCalls.length === 0 && sentFile.length === 1 && JSON.stringify(sentFile[0]) === JSON.stringify({ lights: { "light.den": { z_m: 1.3 } } }),
    { sentFile, heightCalls });
});

console.log(JSON.stringify({ cases, failures, payloads, heights: heightCalls }));
