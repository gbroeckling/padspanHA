// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Heights for Live Aboard on the Atlas (views/atlas_heights.js and its hooks
// in maps.js), run for real: Mapping's Atlas tab rendered under the DOM shim,
// every module load recorded.
//
//   off     Live Aboard off, or below Pro, or Preview: atlas_heights.js is
//           never fetched, no Height row, no Heights list, nothing read
//   row     a placed device picked in the inspector has a Height row: its
//           kind's chips (a leak sensor: Floor; a lock: Door height; motion:
//           Corner, Ceiling...; a pendant: Over a counter), a cm box, and
//           Default (Live Aboard's own default for its kind); a chip puts the
//           height in the placement draft, Undo takes it back, Default clears
//           it, the box takes centimetres
//   save    Save placements sends z_m only when the Height row set it (null
//           to clear); a moved device sends none (the record keeps its own),
//           even one whose draft copied an old height
//   list    the Heights list: every placed device but a door sensor, its
//           height or "default", sorted by a heading, the "Using a default"
//           filter, a floor; tick all shown, then Ceiling: every one at its
//           own ceiling in one step, one Undo
//   draw    the map Live Aboard reads (the card's model) carries the row's
//           unsaved height, and a moved device's record height, never an old
//           copy; the hover box says "2.40 m up"
//   byte    buildIsoSVG is byte for byte the same with heights in the
//           records as without, on a realistic house and on Garry's own
//
// usage: atlas_heights.mjs <www/padspan-ha dir> [house_export.json]
// prints one JSON line: { cases: {name: result}, failures: [...], sent: [...] }

import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2], HOUSE = process.argv[3] && existsSync(process.argv[3]) ? process.argv[3] : null;
if (!WWW) { console.error("usage: atlas_heights.mjs <www/padspan-ha dir> [house_export.json]"); process.exit(2); }
const loaded = [];
if (typeof nodeModule.registerHooks !== "function") {
  console.log(JSON.stringify({ cases: {}, failures: [{ name: "harness", detail: `node ${process.version} has no module.registerHooks` }] }));
  process.exit(1);
}
nodeModule.registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });
install(globalThis);

const failures = [], cases = {}, sent = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 1200) }); cases[name] = false; } };
const sleep = (ms) => new Promise((r) => globalThis._realSetTimeout ? globalThis._realSetTimeout(r, ms) : setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 8; i++) await sleep(0); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const heightsLoaded = () => loaded.some((u) => u.includes("/atlas_heights.js"));

const MAPS = await import(pathToFileURL(join(WWW, "views", "maps.js")).href);
const ISO = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

// ── the house ───────────────────────────────────────────────────────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const FLOORS = [{ id: "main", name: "Main", level: 0, floor_to_floor_m: 2.8 }, { id: "up", name: "Upstairs", level: 1, floor_to_floor_m: 2.6 }];
const RECORDS = {
  "light.island_pendant": { x_m: 3, y_m: 2, floor_id: "main", color: "#fbbf24", shape: "pendant", rotation: 0, width_cm: 0, height_cm: 0, margin_cm: 15, label: "Island" },
  "light.hall_sconce": { x_m: 7, y_m: 0.3, floor_id: "main", color: "#fbbf24", shape: "sconce", rotation: 0, width_cm: 0, height_cm: 0, margin_cm: 15, z_m: 2.0 },
  "light.kitchen_pots": { x_m: 2, y_m: 1, floor_id: "main", color: "#fbbf24", shape: "circle", rotation: 0, width_cm: 0, height_cm: 0, margin_cm: 15 },
  "light.bed_lamp": { x_m: 2, y_m: 2, floor_id: "up", color: "#fbbf24", shape: "hex", rotation: 0, width_cm: 0, height_cm: 0, margin_cm: 15 },
  "binary_sensor.sink_leak": { x_m: 1, y_m: 2.5, floor_id: "main" },
  "lock.front_door": { x_m: 9.5, y_m: 1.5, floor_id: "main" },
  "binary_sensor.hall_motion": { x_m: 8, y_m: 2.5, floor_id: "main" },
  "sensor.lounge_temperature": { x_m: 6, y_m: 3, floor_id: "main" },
  "binary_sensor.front_door_contact": { x_m: 9.8, y_m: 1, floor_id: "main" },
};
const MODEL = {
  floors: FLOORS, areas: [],
  room_geometry_m: { Kitchen: rect("main", 0, 0, 5, 4), Hall: rect("main", 5.1, 0, 10, 4), Bed: rect("up", 0, 0, 5, 4) },
  light_positions_m: RECORDS, rf_barriers_m: [], scanner_positions_m: {}, beacon_positions_m: {}, map_transforms: {},
};
const S = (eid, state, attrs) => ({ entity_id: eid, state, attributes: { friendly_name: attrs.name, ...attrs }, last_changed: "2026-10-05T10:00:00Z" });
const STATES = {
  "light.island_pendant": S("light.island_pendant", "on", { name: "Island pendant", brightness: 200 }),
  "light.hall_sconce": S("light.hall_sconce", "off", { name: "Hall sconce" }),
  "light.kitchen_pots": S("light.kitchen_pots", "on", { name: "Kitchen pot lights" }),
  "light.bed_lamp": S("light.bed_lamp", "off", { name: "Bed lamp" }),
  "binary_sensor.sink_leak": S("binary_sensor.sink_leak", "off", { name: "Sink leak", device_class: "moisture" }),
  "lock.front_door": S("lock.front_door", "locked", { name: "Front door lock" }),
  "binary_sensor.hall_motion": S("binary_sensor.hall_motion", "off", { name: "Hall motion", device_class: "motion" }),
  "sensor.lounge_temperature": S("sensor.lounge_temperature", "21.5", { name: "Lounge temperature", device_class: "temperature", unit_of_measurement: "°C" }),
  "binary_sensor.front_door_contact": S("binary_sensor.front_door_contact", "off", { name: "Front door", device_class: "door" }),
};
const FILE = { schema: 1, lights: { "light.island_pendant": { kind: "pendant" }, "light.bed_lamp": { kind: "lamp" } }, devices: {}, openings: {}, pieces: {}, figures: {} };

function el(tag, attrs = {}, children = []){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}

let root = null, ctx = null, reads = 0;
function makeCtx(settings, over = {}){
  const state = { mapsTab: "lights", maps: { list: [] }, model: clone(MODEL), settings: { light_shapes: {}, ...settings },
                  dataMode: "live", _modelLoaded: false, ...over };
  const c = {
    hass: { states: clone(STATES), user: { is_admin: true }, callWS: async () => [], connection: { sendMessagePromise: async () => ({}) } },
    state,
    helpers: new Proxy({ el, esc: (s) => String(s), pill: (t) => el("span", {}, String(t)), HELP: {} },
      { get: (t, k) => (k in t ? t[k] : () => el("span")) }),
    actions: new Proxy({
      renderRooms: () => { root = MAPS.render(c); },
      wsCall: async (type, msg) => {
        if (type === "padspan_ha/house3d_get") { reads++; return { data: clone(FILE) }; }
        sent.push([type, clone(msg)]);
        if (type === "padspan_ha/fabric_light_position_set") {
          const { entity_id, ...rec } = msg, old = c.state.model.light_positions_m[entity_id] || {};
          const next = { ...rec };
          if (!("z_m" in msg) && old.z_m !== undefined) next.z_m = old.z_m;      // the server keeps it (null: Default chosen)
          c.state.model.light_positions_m[entity_id] = next;
        }
        return { ok: true };
      },
      modelRefresh: async () => {}, mapsRefreshQuiet: async () => {}, settingsSet: async () => ({}), telemetryEvent: () => {},
    }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast: () => {},
  };
  return c;
}
const ON = { tier: "pro", atlas_3d_enabled: true };
async function open(settings = ON, over = {}){
  ctx = makeCtx(settings, over);
  root = MAPS.render(ctx);
  await settle(); await sleep(20); await settle();
  root = MAPS.render(ctx);
  await settle();
  return ctx;
}
const all = (sel) => (root ? root.querySelectorAll(sel) : []);
const text = (n) => (n ? (n.textContent || "").trim() : "");
function pick(eid){ ctx.state.maps._selLight = { eid, mapId: null }; root = MAPS.render(ctx); }
const row = () => all(".lv-heightrow")[0] || null;
const chipsOf = (n) => (n ? n.querySelectorAll("button").map((b) => text(b)) : []);
const chipBtn = (n, label) => (n ? n.querySelectorAll("button").find((b) => text(b).startsWith(label)) : null);
const draft = () => ctx.state.maps._lightsDraftM || {};
const keydown = (key) => { for (const f of (globalThis.__docKeys || [])) f({ key, ctrlKey: true, metaKey: false, shiftKey: false, preventDefault(){} }); };
const card = () => all(".lv-heightscard")[0] || null;
const buttonIn = (n, label) => (n ? n.querySelectorAll("button").find((b) => text(b) === label) : null);

// ── off ─────────────────────────────────────────────────────────────────────
await tryCase("off: Live Aboard off, below Pro or in Preview: nothing fetched, no Height row, no Heights list", async () => {
  const runs = [];
  for (const [settings, over] of [[{ tier: "pro", atlas_3d_enabled: false }, {}], [{ tier: "bright", atlas_3d_enabled: true }, {}],
                                  [ON, { maps: { list: [], _lightsPreview: true } }]]) {
    await open(settings, over);
    pick("light.island_pendant");
    runs.push({ row: !!row(), card: !!card() });
  }
  check("off: Live Aboard off, below Pro or in Preview: nothing fetched, no Height row, no Heights list",
    !heightsLoaded() && reads === 0 && runs.every((r) => !r.row && !r.card), { loaded: heightsLoaded(), reads, runs });
});

// ── row ─────────────────────────────────────────────────────────────────────
await open();
await tryCase("row: a picked device has a Height row with its kind's chips and Live Aboard's default", async () => {
  pick("light.island_pendant");
  const pend = chipsOf(row());
  pick("binary_sensor.sink_leak");
  const leak = chipsOf(row());
  pick("lock.front_door");
  const lock = chipsOf(row());
  pick("binary_sensor.hall_motion");
  const pir = chipsOf(row());
  pick("light.kitchen_pots");
  const pots = chipsOf(row());
  pick("binary_sensor.front_door_contact");
  const contact = row();
  const has = (list, ...want) => want.every((w) => list.some((t) => t.startsWith(w)));
  check("row: a picked device has a Height row with its kind's chips and Live Aboard's default",
    heightsLoaded() && reads === 1
    && has(pend, "Ceiling", "Over a counter", "Default") && pend.some((t) => t === "Default2.05 m")      // a pendant: 0.6 m under a 2.65 m ceiling
    && leak.length === 2 && has(leak, "Floor", "Default0.02 m")
    && lock.length === 2 && has(lock, "Door height1.00 m", "Default1.00 m")
    && has(pir, "Corner2.20 m", "Ceiling", "High on the wall2.10 m", "Default2.20 m")
    && has(pots, "Ceiling2.65 m", "High on the wall", "Wall1.50 m", "Table0.75 m", "Floor")
    && contact === null, { pend, leak, lock, pir, pots, reads });
});
await tryCase("row: a chip puts the height in the draft, Undo takes it back, Default clears it, the box takes cm", async () => {
  pick("light.island_pendant");
  chipBtn(row(), "Over a counter").click();
  const a = clone(draft()["light.island_pendant"] || null);
  const on = chipBtn(row(), "Over a counter").className.includes(" on");
  const hint = text(row().querySelectorAll(".lv-hint")[0]);
  // Undo, as the tab's own Ctrl+Z does: through its undo stack (the draft goes back).
  ctx.state.maps._lightsUndo.undo && null;
  const st = ctx.state.maps._lightsUndo;
  const snap = st.undo({ "light.island_pendant": draft()["light.island_pendant"] ? { ...draft()["light.island_pendant"] } : null });
  for (const [k, v] of Object.entries(snap)) { if (v) draft()[k] = v; else delete draft()[k]; }
  root = MAPS.render(ctx);
  const undone = draft()["light.island_pendant"] === undefined;
  chipBtn(row(), "Default").click();
  const toDefault = clone(draft()["light.island_pendant"] || null);
  const box = row().querySelectorAll("input")[0];
  box.value = "185"; box.dispatchEvent({ type: "change" });
  const typed = clone(draft()["light.island_pendant"] || null);
  box.value = "9999"; box.dispatchEvent({ type: "change" });
  const capped = clone(draft()["light.island_pendant"] || null);
  check("row: a chip puts the height in the draft, Undo takes it back, Default clears it, the box takes cm",
    a && a.z_m === 1.7 && a._z === true && a.x_m === 3 && on && /1\.70 m up in Live Aboard/.test(hint) && undone
    && toDefault === null                                                    // no height set: Default changes nothing
    && typed && typed.z_m === 1.85 && capped && capped.z_m === 2.65, { a, on, hint, undone, toDefault, typed, capped });
});

// ── save ────────────────────────────────────────────────────────────────────
await tryCase("save: Save placements sends z_m only when the Height row set it; a move keeps the record's", async () => {
  ctx.state.maps._lightsDraftM = {};
  pick("light.hall_sconce");
  chipBtn(row(), "Default").click();                                        // clear its 2.0 m
  pick("light.kitchen_pots");
  chipBtn(row(), "Ceiling").click();
  // A device moved (a drag's draft carries a copy of its record, old height and all).
  ctx.state.maps._lightsDraftM["light.island_pendant"] = { ...RECORDS["light.island_pendant"], z_m: 0.5, x_m: 3.5 };
  ctx.state.model.light_positions_m["light.island_pendant"] = { ...RECORDS["light.island_pendant"], z_m: 1.6 };   // set meanwhile in Live Aboard
  root = MAPS.render(ctx);
  const drawn = clone(LM && ctx.state.model.light_positions_m);
  const save = all("button").find((b) => text(b).includes("Save placements"));
  sent.length = 0;
  save.dispatchEvent({ type: "click", currentTarget: save, target: save, stopPropagation(){}, preventDefault(){} });
  await settle(); await sleep(5); await settle();
  const by = Object.fromEntries(sent.filter(([t]) => t === "padspan_ha/fabric_light_position_set").map(([, m]) => [m.entity_id, m]));
  const recs = ctx.state.model.light_positions_m;
  check("save: Save placements sends z_m only when the Height row set it; a move keeps the record's",
    by["light.hall_sconce"] && by["light.hall_sconce"].z_m === null && !("_z" in by["light.hall_sconce"])
    && by["light.kitchen_pots"] && by["light.kitchen_pots"].z_m === 2.65
    && by["light.island_pendant"] && !("z_m" in by["light.island_pendant"]) && by["light.island_pendant"].x_m === 3.5
    && recs["light.hall_sconce"].z_m === null && recs["light.kitchen_pots"].z_m === 2.65 && recs["light.island_pendant"].z_m === 1.6
    && Object.keys(draft()).length === 0, { by, recs: { hall: recs["light.hall_sconce"], pots: recs["light.kitchen_pots"], isl: recs["light.island_pendant"] }, drawn: !!drawn });
});

// ── draw: what the card (and Live Aboard) reads ─────────────────────────────
await tryCase("draw: the card's model has the row's unsaved height and a moved device's record height, never an old copy", async () => {
  const committed = { a: { x_m: 1, z_m: 1.6 }, b: { x_m: 1 }, c: { x_m: 1, z_m: 2 }, d: { x_m: 1 } };
  const lp = MAPS._draftOverRecords(committed, {
    a: { x_m: 3.5, z_m: 0.5, source: "manual" },          // a move carrying an old copy
    b: { x_m: 2, z_m: 2.4, _z: true },                    // the row's, unsaved
    c: { x_m: 2, z_m: null, _z: true },                   // the row's Default, unsaved
    d: { x_m: 2.5, z_m: 0.9 },                            // a move, no height on the record
    e: { x_m: 4, source: "auto" },                        // newly placed
  });
  const same = MAPS._draftOverRecords({ a: { x_m: 1 } }, { a: { x_m: 2, source: "manual" } });
  check("draw: the card's model has the row's unsaved height and a moved device's record height, never an old copy",
    lp.a.z_m === 1.6 && lp.a.x_m === 3.5 && lp.a.source === "manual" && lp.b.z_m === 2.4 && !("_z" in lp.b)
    && lp.c.z_m === null && !("z_m" in lp.d) && lp.e.x_m === 4 && !("z_m" in lp.e)
    && JSON.stringify(same) === JSON.stringify({ a: { x_m: 2, source: "manual" } }), lp);
});
await tryCase("draw: the hover box says how high a device is", async () => {
  const stage = document.createElement("div"), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  stage.appendChild(svg);
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("data-eid", "light.island_pendant");
  svg.appendChild(g);
  g.closest = (sel) => (sel.startsWith("g.lhex") ? g : null);
  stage.getRootNode = () => ({ elementsFromPoint: () => [g], querySelector: () => null });
  const lbe = { "light.island_pendant": { entity_id: "light.island_pendant", friendly_name: "Island pendant", code: "L01" },
                "light.b": { entity_id: "light.b", friendly_name: "B", code: "L02" } };
  const words = (heightOf) => {
    const s2 = { ...stage };
    void s2;
    const before = stage.children.length;
    LM.wireHoverHud(stage, { lightsByEid: lbe, heightOf });
    const hud = stage.querySelectorAll(".lv-hoverhud").slice(-1)[0];
    stage.dispatchEvent({ type: "pointermove", pointerType: "mouse", clientX: 5, clientY: 5, target: stage });
    const t = hud ? (hud.textContent || "") : "";
    return { t, added: stage.children.length > before };
  };
  const up = words((eid) => LM.heightOfRecord({ light_positions_m: { "light.island_pendant": { z_m: 2.4 } } }, eid));
  const none = words((eid) => LM.heightOfRecord({ light_positions_m: { "light.island_pendant": {} } }, eid));
  const off = words(null);
  check("draw: the hover box says how high a device is",
    /L01 · Island pendant · 2\.40 m up/.test(up.t) && /L01 · Island pendant/.test(none.t) && !/m up/.test(none.t) && !/m up/.test(off.t)
    && LM.heightOfRecord(null, "a") === null, { up, none, off });
});

await tryCase("draw: Default chosen on the record beats a height still in Live Aboard's file", async () => {
  // Review finding 7: the Height row and the list say "default", as Live Aboard draws it.
  const H = await import(pathToFileURL(join(WWW, "views", "atlas_heights.js")).href);
  const file = { lights: { "light.a": { z_m: 1.9 } }, devices: {} };
  const decided = H.heightNow("light.a", { "light.a": { x_m: 1, z_m: null } }, {}, file, "lights");
  const never = H.heightNow("light.a", { "light.a": { x_m: 1 } }, {}, file, "lights");
  const set = H.heightNow("light.a", { "light.a": { x_m: 1, z_m: 2.2 } }, {}, file, "lights");
  check("draw: Default chosen on the record beats a height still in Live Aboard's file",
    decided === null && never === 1.9 && set === 2.2, { decided, never, set });
});

// ── list ────────────────────────────────────────────────────────────────────
await tryCase("list: every placed device but a door sensor, its height or default, sorted, filtered, by floor", async () => {
  await open();
  const c0 = card();
  const shut = c0 && !c0.querySelectorAll("table")[0] && /9 placed|8 placed/.test(text(c0));
  buttonIn(c0, "Show").click();
  const names = () => card().querySelectorAll("tr").filter((r) => r.getAttribute("data-eid")).map((r) => r.getAttribute("data-eid"));
  const rowsAll = names();
  const hs = ctx.state.maps._heightsUi;
  card().querySelectorAll("th").find((t) => text(t).startsWith("Height")).click();
  const byHeight = names();
  card().querySelectorAll("th").find((t) => text(t).startsWith("Height")).click();
  const byHeightDown = names();
  chipBtn(card(), "Using a default").click();
  const usingDefault = names();
  const sel = card().querySelectorAll("select")[0];
  sel.value = "up"; sel.dispatchEvent({ type: "change" });
  const upstairs = names();
  hs.onlyDefault = false; hs.floor = "all"; hs.sort = "name"; hs.dir = 1;
  root = MAPS.render(ctx);
  const ids = names();
  if (!ids.includes("light.hall_sconce")) throw new Error("not listed again: " + JSON.stringify({ ids, hs, t: text(card()).slice(0, 400), n: all(".lv-heightscard").length }));
  const heightCell = card().querySelectorAll("tr").filter((r) => r.getAttribute("data-eid")).find((r) => r.getAttribute("data-eid") === "light.hall_sconce").querySelectorAll("td")[4];
  const defCell = card().querySelectorAll("tr").filter((r) => r.getAttribute("data-eid")).find((r) => r.getAttribute("data-eid") === "binary_sensor.sink_leak").querySelectorAll("td")[4];
  check("list: every placed device but a door sensor, its height or default, sorted, filtered, by floor",
    shut && rowsAll.length === 8 && !rowsAll.includes("binary_sensor.front_door_contact")
    && byHeight[0] === "binary_sensor.sink_leak" && byHeightDown[0] !== "binary_sensor.sink_leak"
    && usingDefault.length === 7 && !usingDefault.includes("light.hall_sconce")
    && upstairs.length === 1 && upstairs[0] === "light.bed_lamp"
    && text(heightCell) === "2.00 m" && /^default \(0\.02 m\)$/.test(text(defCell)),
    { shut, rowsAll, byHeight, byHeightDown, usingDefault, upstairs, h: text(heightCell), d: text(defCell) });
});
await tryCase("list: tick all shown, then Ceiling: each at its own ceiling, in one step, one Undo", async () => {
  ctx.state.maps._lightsDraftM = {};
  ctx.state.maps._lightsUndo = undefined;
  root = MAPS.render(ctx);
  buttonIn(card(), "Tick all shown").click();
  const setBar = card();
  const ceilBtn = chipBtn(setBar, "Ceiling");
  ceilBtn.click();
  const d = clone(draft());
  const steps = ctx.state.maps._lightsUndo ? ctx.state.maps._lightsUndo : null;
  const top = steps.peekUndo();
  const prev = steps.undo(Object.fromEntries(Object.keys(top).map((k) => [k, draft()[k] ? { ...draft()[k] } : null])));
  for (const [k, v] of Object.entries(prev)) { if (v) draft()[k] = v; else delete draft()[k]; }
  const afterUndo = Object.keys(draft()).length;
  check("list: tick all shown, then Ceiling: each at its own ceiling, in one step, one Undo",
    d["light.kitchen_pots"].z_m === 2.65 && d["light.bed_lamp"].z_m === 2.45 && d["binary_sensor.hall_motion"].z_m === 2.57
    && d["sensor.lounge_temperature"].z_m === 2.57 && d["light.island_pendant"].z_m === 2.65
    && !d["binary_sensor.sink_leak"] === false && Object.values(d).every((e) => e._z === true)
    && Object.keys(top).length === Object.keys(d).length && afterUndo === 0 && steps.peekUndo() === null,
    { d: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.z_m])), top: Object.keys(top || {}), afterUndo });
});

// ── byte ────────────────────────────────────────────────────────────────────
function lbeOf(states){
  const lights = LM.gatherLights(states, {}, {}, "pro", {}, {}, {}, {}, undefined, false, {});
  return Object.fromEntries(lights.map((l) => [l.entity_id, l]));
}
await tryCase("byte: buildIsoSVG is byte-identical with heights in the records, on a realistic house", async () => {
  const lbe = lbeOf(STATES);
  const bare = clone(MODEL);
  for (const r of Object.values(bare.light_positions_m)) delete r.z_m;
  const high = clone(bare);
  for (const [i, r] of Object.values(high.light_positions_m).entries()) r.z_m = 0.3 + i * 0.25;
  const mk = (m, o = {}) => ISO.buildIsoSVG(m, {}, new Set(), null, 150, 0, lbe, false, FLOORS, { codeChip: true, hitHalo: true, ...o });
  const a = mk(bare), b = mk(high), c = mk(bare, { showcase: true }), d = mk(high, { showcase: true });
  check("byte: buildIsoSVG is byte-identical with heights in the records, on a realistic house",
    a.length > 1000 && a === b && c === d, { a: a.length, b: b.length });
});
if (HOUSE) {
  await tryCase("byte: the same on Garry's own house", async () => {
    const ex = JSON.parse(readFileSync(HOUSE, "utf-8"));
    const model = ex.model, floors = model.floors || [], states = {};
    for (const [eid, s] of Object.entries(ex.light_states || {})) {
      const attrs = { friendly_name: s.name };
      if (s.rgb_color) attrs.rgb_color = s.rgb_color;
      if (s.brightness !== null && s.brightness !== undefined) attrs.brightness = s.brightness;
      if (s.device_class) attrs.device_class = s.device_class;
      states[eid] = { entity_id: eid, state: s.state, attributes: attrs, last_changed: "2026-10-05T10:00:00Z" };
    }
    const lbe = lbeOf(states);
    const high = clone(model);
    let n = 0;
    for (const r of Object.values(high.light_positions_m || {})) { r.z_m = 0.4 + (n++ % 9) * 0.25; }
    const mk = (m) => ISO.buildIsoSVG(m, {}, new Set(), null, 150, 0, lbe, false, floors, { codeChip: true, hitHalo: true });
    const a = mk(model), b = mk(high);
    check("byte: the same on Garry's own house", n > 10 && a.length > 1000 && a === b, { n, a: a.length, b: b.length });
  });
}

console.log(JSON.stringify({ cases, failures, sent }));
