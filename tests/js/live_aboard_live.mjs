// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's live parts (views/live_aboard_house.js, part B), run for real
// against the flat Atlas's own renderer (iso_lights.js buildIsoSVG) for the
// same house and the same states: whatever the 3D house reads, the flat Atlas
// draws the same.
//
//   doors     a linked door, window or lock: open, shut, no reading, locked,
//             unlocked, an inverted sensor, a dangling link — each against
//             the barrier the Atlas draws (a gap, a line, the dashed no-reading
//             line, the flashing lock), and the Atlas's own state word; what
//             kind of opening it is; hinged left and swinging in by default;
//             the card's barrier exactly as the Atlas's click builds it
//   motion    active, quiet round the colour wheel, offline, a restart's
//             timestamp, stuck on past six hours — against the pulse and the
//             ring the Atlas draws, in its colours, on its clocks
//   air       the bars' colour, cycle and strength, room by room
//   readouts  temperature, humidity and air: the Atlas's words and colours,
//             fresh or stale; the height by type, and part C's stored z_m
//   badges    one per plate, its storey, number and colour
//   sensors   placed only, hidden ones never; rebuilt for a move, not a state
//
// usage: live_aboard_live.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], copies: {...} }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_live.mjs <www/padspan-ha dir>"); process.exit(2); }
const H = await import(pathToFileURL(join(WWW, "views", "live_aboard_house.js")).href);
const ISO = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const LC = await import(pathToFileURL(join(WWW, "views", "light_codes.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const unesc = (s) => String(s).replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

// ── a two-storey house with linked openings and sensors ─────────────────────
const NOW = Date.parse("2026-09-30T12:00:00Z");
const STARTED = NOW - 3 * 86400e3;
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const MODEL = {
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "up", name: "Upstairs", level: 1 }],
  floor_elevations: { main: 0, up: 2.8 },
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6.1, 0, 10, 4), Loft: rect("up", 0, 0, 5, 5) },
  light_positions_m: {
    "binary_sensor.kitchen_motion": { x_m: 2, y_m: 2, floor_id: "main" },
    "binary_sensor.hall_motion": { x_m: 8, y_m: 2, floor_id: "main" },
    "binary_sensor.loft_motion": { x_m: 2, y_m: 2, floor_id: "up" },
    "sensor.kitchen_co2": { x_m: 3, y_m: 1, floor_id: "main" },
    "sensor.hall_air": { x_m: 9, y_m: 3, floor_id: "main" },
    "sensor.hall_temp": { x_m: 7, y_m: 3, floor_id: "main" },
    "sensor.loft_humidity": { x_m: 4, y_m: 4, floor_id: "up" },
    "sensor.loft_temp": { x_m: 1, y_m: 4, floor_id: "up" },
    "light.kitchen": { x_m: 3, y_m: 3, floor_id: "main" },
  },
  rf_barriers_m: [
    { id: "b_door", name: "Back door", material: "wood", floor_id: "main", points_m: [[1, 0], [2, 0]], linked_entity_id: "binary_sensor.back_door" },
    { id: "b_win", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[3, 0], [5, 0]], linked_entity_id: "binary_sensor.kitchen_window" },
    { id: "b_inv", name: "Garage & Car", material: "metal", floor_id: "main", points_m: [[6.5, 4], [9.5, 4]],
      linked_entity_id: "binary_sensor.garage_contact", invert_state: true },
    { id: "b_lock", name: "Front door", material: "custom", floor_id: "main", points_m: [[10, 1], [10, 2]],
      linked_entity_id: "lock.front", linked_opener_entity_id: "switch.front_opener" },
    { id: "b_gone", floor_id: "main", points_m: [[0, 1], [0, 2]], linked_entity_id: "binary_sensor.gone" },
    { id: "b_plain", name: "Partition", material: "metal", floor_id: "main", points_m: [[6.05, 1], [6.05, 3]] },
  ],
};
const FLOORS = MODEL.floors;
const BASE = {
  "binary_sensor.back_door": { state: "off", attributes: { friendly_name: "Back door", device_class: "door" } },
  "binary_sensor.kitchen_window": { state: "off", attributes: { friendly_name: "Kitchen window", device_class: "window" } },
  "binary_sensor.garage_contact": { state: "on", attributes: { friendly_name: "Garage contact", device_class: "garage_door" } },
  "lock.front": { state: "locked", attributes: { friendly_name: "Front lock" } },
  "binary_sensor.kitchen_motion": { state: "off", attributes: { friendly_name: "Kitchen motion", device_class: "motion" }, last_changed: ago(30) },
  "binary_sensor.hall_motion": { state: "on", attributes: { friendly_name: "Hall motion", device_class: "occupancy" }, last_changed: ago(1) },
  "binary_sensor.loft_motion": { state: "off", attributes: { friendly_name: "Loft motion", device_class: "motion" }, last_changed: ago(2) },
  "sensor.kitchen_co2": { state: "1600", attributes: { friendly_name: "Kitchen CO2", device_class: "carbon_dioxide", unit_of_measurement: "ppm" }, last_updated: ago(5) },
  "sensor.hall_air": { state: "poor", attributes: { friendly_name: "Hall air quality", device_class: "enum" }, last_updated: ago(5) },
  "sensor.hall_temp": { state: "21.4", attributes: { friendly_name: "Hall temp", device_class: "temperature" }, last_updated: ago(5) },
  "sensor.loft_humidity": { state: "57.2", attributes: { friendly_name: "Loft humidity", device_class: "humidity" }, last_updated: ago(10) },
  "sensor.loft_temp": { state: "18", attributes: { friendly_name: "Loft temp", device_class: "temperature" }, last_updated: ago(200) },
  "light.kitchen": { state: "on", attributes: { friendly_name: "Kitchen", brightness: 200 } },
};
function states(patch = {}){
  const out = {};
  for (const [eid, s] of Object.entries({ ...BASE, ...patch })) {
    if (!s) continue;
    out[eid] = { entity_id: eid, last_changed: ago(600), last_updated: ago(600), ...s, attributes: { ...(s.attributes || {}) } };
  }
  return out;
}
const records = (st) => Object.fromEntries(LM.gatherLights(st, {}, {}, "pro", {}, {}, {}, {}, NOW).map(l => [l.entity_id, l]));
const draw = (lbe) => ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, lbe, false, FLOORS,
  { barrierHit: true, nowMs: NOW, haStartedMs: STARTED });
const FRAME = ISO.fabricFrame(MODEL, FLOORS, 150, 0);
const pointsOf = (b) => b.points_m.map(p => { const [x, y] = FRAME.iso(p[0], p[1], FRAME.levelOf(b.floor_id)); return `${Math.round(x)},${Math.round(y)}`; }).join(" ");
// What the Atlas draws for a barrier: a gap, a line, the dashed no-reading line, the flash.
function flatLook(svg, b){
  const m = new RegExp(`<polyline points="${pointsOf(b)}" fill="none" ([^>]*)>`).exec(svg);
  if (!m) return "gap";
  if (m[1].includes('class="lv-lockflash"')) return "flash";
  if (m[1].includes('stroke="#64748b"') && m[1].includes('stroke-dasharray="3,4"')) return "dashed";
  if (m[1].includes('stroke="#94a3b8"')) return "line";
  return "other:" + m[1];
}
const LOOK_OF = { open: "gap", closed: "line", locked: "line", unlocked: "flash", none: "dashed" };
const WORD_OF = { open: ["OPEN"], closed: ["CLOSED"], locked: ["LOCKED"], unlocked: ["UNLOCKED", "JAMMED"], none: ["NO READING", null] };

// ── doors, windows and locks ────────────────────────────────────────────────
tryCase("doors: every opening reads as the Atlas draws it, in every state", () => {
  const bad = [];
  const sensorStates = ["on", "off", "unavailable", "unknown", null];
  const lockStates = ["locked", "unlocked", "jammed", "unavailable", null];
  for (let i = 0; i < 5; i++) {
    const patch = {
      "binary_sensor.back_door": sensorStates[i] === null ? null : { ...BASE["binary_sensor.back_door"], state: sensorStates[i] },
      "binary_sensor.kitchen_window": { ...BASE["binary_sensor.kitchen_window"], state: sensorStates[(i + 1) % 4] },
      "binary_sensor.garage_contact": sensorStates[(i + 2) % 5] === null ? null : { ...BASE["binary_sensor.garage_contact"], state: sensorStates[(i + 2) % 5] },
      "lock.front": lockStates[i] === null ? null : { ...BASE["lock.front"], state: lockStates[i] },
    };
    const lbe = records(states(patch)), svg = draw(lbe), inv = LM.doorInvertOf(MODEL);
    for (const b of MODEL.rf_barriers_m.filter(x => x.linked_entity_id)) {
      const dl = lbe[b.linked_entity_id], st = H.openingState(b, dl), flat = flatLook(svg, b);
      const word = dl ? (LM.stateWordOf(dl, null, inv) || {}).text : null;
      if (LOOK_OF[st] !== flat || !WORD_OF[st].includes(dl ? word : null)) bad.push({ i, b: b.id, st, flat, word });
    }
  }
  check("doors: every opening reads as the Atlas draws it, in every state", !bad.length, bad);
});
tryCase("doors: an inverted sensor reads backwards, for that barrier alone", () => {
  const on = records(states({ "binary_sensor.garage_contact": { ...BASE["binary_sensor.garage_contact"], state: "on" } }));
  const off = records(states({ "binary_sensor.garage_contact": { ...BASE["binary_sensor.garage_contact"], state: "off" } }));
  const b = MODEL.rf_barriers_m.find(x => x.id === "b_inv");
  check("doors: an inverted sensor reads backwards, for that barrier alone",
    H.openingState(b, on["binary_sensor.garage_contact"]) === "closed" && H.openingState(b, off["binary_sensor.garage_contact"]) === "open"
    && H.openingState({ ...b, invert_state: false }, on["binary_sensor.garage_contact"]) === "open"
    && flatLook(draw(off), b) === "gap" && flatLook(draw(on), b) === "line", null);
});
tryCase("doors: what kind of opening — the sensor's class, else the name; a linked one is never a wall", () => {
  const lbe = records(states());
  const kinds = Object.fromEntries(MODEL.rf_barriers_m.map(b => [b.id, H.openingKind(b, lbe[b.linked_entity_id])]));
  const h = H.readHouse(MODEL, FLOORS, lbe, null);
  const pieces = h.perFloor.get(h.byId.get("main")).pieces;
  const kindOf = (id) => pieces.filter(p => p.barrier && p.barrier.id === id).map(p => p.kind);
  const doorish = H.openingKind({ name: "Bar 7", material: "wood", linked_entity_id: "binary_sensor.x" }, { device_class: "opening" });
  const windowByName = H.openingKind({ name: "Bay window", linked_entity_id: "binary_sensor.y" }, null);
  check("doors: what kind of opening — the sensor's class, else the name; a linked one is never a wall",
    JSON.stringify(kinds) === JSON.stringify({ b_door: "door", b_win: "window", b_inv: "door", b_lock: "door", b_gone: "door", b_plain: "wall" })
    && kindOf("b_win").join() === "window" && kindOf("b_lock").join() === "door" && kindOf("b_plain").every(k => k === "wall")
    && doorish === "door" && windowByName === "window"
    && H.openingKind({ material: "open", linked_entity_id: "binary_sensor.z" }, { device_class: "door" }) === "open", { kinds });
});
tryCase("doors: hinged on the left, swinging in, until the 3D file says otherwise", () => {
  // The Kitchen's top edge (y = 0) is an outside wall; inside is +y.
  const lbe = records(states());
  const h = H.readHouse(MODEL, FLOORS, lbe, null);
  const per = h.perFloor.get(h.byId.get("main"));
  const pc = per.pieces.find(p => p.barrier && p.barrier.id === "b_door");
  const sw = H.openingSwing(pc, per.rooms, null);
  const into = [pc.nx * sw.side, pc.ny * sw.side];
  // Standing outside facing in — +y, down the plan as it is drawn — the
  // left hand points to the plan's right (+x): the hinge is the x = 2 end.
  const hinge = sw.hinge === "a" ? [pc.x0, pc.y0] : [pc.x1, pc.y1];
  const right = H.openingSwing(pc, per.rooms, { hinge: "right" }), out = H.openingSwing(pc, per.rooms, { swing: "out" });
  check("doors: hinged on the left, swinging in, until the 3D file says otherwise",
    near(into[0], 0) && near(into[1], 1) && near(hinge[0], 2, 0.01) && right.hinge !== sw.hinge && right.side === sw.side
    && out.side === -sw.side && out.hinge === sw.hinge, { pc, sw, hinge, right, out });
});
tryCase("doors: the card is handed the barrier exactly as the Atlas's click builds it", () => {
  const lbe = records(states()), svg = draw(lbe);
  const bad = [];
  for (const b of MODEL.rf_barriers_m.filter(x => x.linked_entity_id)) {
    const m = new RegExp(`<polyline class="lbarhit" data-eid="${b.linked_entity_id}" ([^>]*)>`).exec(svg);
    // A link to nothing the Atlas knows has no line to press — nor in 3D
    // (H.openingPressable).
    if (!m || !H.openingPressable(lbe[b.linked_entity_id])) {
      if (!!m !== H.openingPressable(lbe[b.linked_entity_id])) bad.push({ b: b.id, why: "pressable differs", flat: !!m });
      continue;
    }
    const ds = Object.fromEntries([...m[1].matchAll(/data-(\w+)="([^"]*)"/g)].map(x => [x[1], unesc(x[2])]));
    // lights_map.js wireUseSurface's .lbarhit click, field by field.
    const flat = { linked_entity_id: b.linked_entity_id, invert_state: ds.invert === "1", name: ds.name || null,
                   linked_opener_entity_id: ds.opener || null, linked_lock_entity_id: ds.lock || null };
    const mine = H.barrierCardOf(b);
    if (JSON.stringify(flat) !== JSON.stringify(mine)) bad.push({ b: b.id, flat, mine });
  }
  check("doors: the card is handed the barrier exactly as the Atlas's click builds it", !bad.length, bad);
});

// ── motion ──────────────────────────────────────────────────────────────────
// What the Atlas draws under a motion marker: the active pulse (1.6 s, the
// active blue ring), the quiet ring in the colour of how long ago (3 s), or
// nothing.
function flatMotion(svg, eid){
  const p = new RegExp(`<g class="lpulse" data-eid="${eid}"[^>]*>([\\s\\S]*?)</g>`).exec(svg);
  if (p) {
    const ring = /stroke="hsl\((\d+),75%,58%\)"/.exec(p[1]);
    return { active: true, hue: ring ? Number(ring[1]) : null, ms: /dur="1\.6s"/.test(p[1]) ? 1600 : null,
             fill: (/<animate attributeName="opacity" values="([\d.;]+)" dur="1\.6s"/.exec(p[1]) || [])[1] };
  }
  const r = new RegExp(`<circle class="lrecent" data-eid="${eid}"[^>]*stroke="hsl\\((\\d+),75%,58%\\)"[^>]*>([\\s\\S]*?)</circle>`).exec(svg);
  if (r) return { active: false, hue: Number(r[1]), ms: /dur="3s"/.test(r[2]) ? 3000 : null, op: (/values="([\d.;]+)"/.exec(r[2]) || [])[1] };
  return null;
}
tryCase("motion: active, quiet and gone read as the Atlas draws them, on its clocks", () => {
  const bad = [];
  const variants = [
    ["on", 1], ["on", 400], ["off", 2], ["off", 4.9], ["off", 6], ["off", 21], ["off", 41], ["off", 66], ["off", 91], ["off", 121],
    ["off", 359], ["off", 361], ["on", 361], ["unavailable", 1], ["unknown", 1],
  ];
  for (const [state, min] of variants) {
    const lbe = records(states({ "binary_sensor.kitchen_motion": { ...BASE["binary_sensor.kitchen_motion"], state, last_changed: ago(min) } }));
    const l = lbe["binary_sensor.kitchen_motion"], svg = draw(lbe), look = H.motionLook(l, NOW, STARTED), flat = flatMotion(svg, l.entity_id);
    const same = !look ? flat === null
      : !!flat && flat.active === look.active && flat.hue === (look.active ? 240 : look.hue)
        && flat.ms === (look.active ? H.MOTION_PULSE.ms : H.MOTION_RECENT.ms)
        && (look.active ? flat.fill === H.MOTION_PULSE.fill.join(";") : flat.op === H.MOTION_RECENT.op.join(";"));
    // The sensor's own marker: lit (its pin colour) while motionActive, else
    // the Atlas's dark body — stuck "on" past six hours still lit, no pulse.
    const g = new RegExp(`<g class="lhex" data-eid="${l.entity_id}"[^>]*>([\\s\\S]*?)</g>`).exec(svg);
    const lit = !!g && /fill="#fbbf24"/.test(g[1]) && !/fill="#374151"/.test(g[1]);
    if (!same || lit !== H.motionActive(l, NOW, STARTED)) bad.push({ state, min, look, flat, lit, active: H.motionActive(l, NOW, STARTED) });
  }
  check("motion: active, quiet and gone read as the Atlas draws them, on its clocks", !bad.length, bad);
});
tryCase("motion: a restart's restored timestamp is no motion; the same sensor really on still is", () => {
  // Home Assistant came up two minutes ago and restored the sensor's state
  // half a minute later: that timestamp is the restart's, not a trigger.
  const up = NOW - 2 * 60e3, restored = new Date(up + 30e3).toISOString(), ME = "binary_sensor.kitchen_motion";
  const quiet = records(states({ [ME]: { ...BASE[ME], state: "off", last_changed: restored } }));
  const on = records(states({ [ME]: { ...BASE[ME], state: "on", last_changed: restored } }));
  const flat = (lbe) => flatMotion(ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, lbe, false, FLOORS, { nowMs: NOW, haStartedMs: up }), ME);
  const lookOn = H.motionLook(on[ME], NOW, up);
  check("motion: a restart's restored timestamp is no motion; the same sensor really on still is",
    H.motionLook(quiet[ME], NOW, up) === null && flat(quiet) === null && lookOn && lookOn.active && flat(on) && flat(on).active
    && H.motionLook(quiet[ME], NOW, 0).active === true, { lookOn, flatOn: flat(on) });
});
tryCase("motion: the clocks play the Atlas's values", () => {
  const P = H.MOTION_PULSE, R = H.MOTION_RECENT;
  check("motion: the clocks play the Atlas's values",
    near(H.cycleAt(P.fill, P.ms, 0), 0.55) && near(H.cycleAt(P.fill, P.ms, 800), 0.2) && near(H.cycleAt(P.fill, P.ms, 1600), 0.55)
    && near(H.cycleAt(P.fill, P.ms, 400), 0.375) && near(H.cycleAt(P.ringR, P.ms, 800), 1.55) && near(H.cycleAt(P.ringA, P.ms, 1200), 0.2)
    && near(H.cycleAt(R.op, R.ms, 1500), 0.16) && near(H.cycleAt(R.op, R.ms, 3750), 0.33)
    && H.lockFlashAt(0) === 0 && near(H.lockFlashAt(500), 1) && near(H.lockFlashAt(250), 0.5) && near(H.lockFlashAt(1000), 0), null);
});

// ── air ─────────────────────────────────────────────────────────────────────
tryCase("air: the bars' colour, cycle and strength are the Atlas's, room by room", () => {
  const bad = [];
  for (const [co2, word] of [["1600", "poor"], ["900", "fair"], ["700", "good"], ["2600", "very_poor"], ["6000", "hazardous"], ["unavailable", "unknown"]]) {
    const lbe = records(states({ "sensor.kitchen_co2": { ...BASE["sensor.kitchen_co2"], state: co2 },
                                 "sensor.hall_air": { ...BASE["sensor.hall_air"], state: word } }));
    const svg = draw(lbe);
    for (const eid of ["sensor.kitchen_co2", "sensor.hall_air"]) {
      const a = H.airLook(lbe[eid]);
      const m = new RegExp(`<g class="lair" data-eid="${eid}"[^>]*fill="hsl\\((\\d+),80%,60%\\)" fill-opacity="([\\d.]+)">[\\s\\S]*?dur="([\\d.]+)s"`).exec(svg);
      const same = !a ? !m : !!m && Number(m[1]) === a.hue && Number(m[2]) === a.op && Number(m[3]) === a.dur;
      if (!same) bad.push({ co2, word, eid, a, m: m && m.slice(1) });
    }
  }
  check("air: the bars' colour, cycle and strength are the Atlas's, room by room", !bad.length, bad);
});

// ── readouts ────────────────────────────────────────────────────────────────
function flatDigits(svg, eid){
  const g = new RegExp(`<g class="lhex" data-eid="${eid}"[^>]*>([\\s\\S]*?)</g>`).exec(svg);
  if (!g) return null;
  const t = /<text[^>]*font-size="[\d.]+" font-weight="800" fill="([^"]+)"[^>]*>([^<]*)<\/text>/.exec(g[1]);
  return t ? { color: t[1], text: t[2] } : { color: null, text: null };
}
tryCase("readouts: the Atlas's words and colours, while fresh; stale, the code, quiet", () => {
  const lbe = records(states());
  const svg = draw(lbe);
  const got = {}, bad = [];
  for (const eid of ["sensor.hall_temp", "sensor.loft_humidity", "sensor.loft_temp"]) {
    const r = H.readoutOf(lbe[eid], NOW), f = flatDigits(svg, eid), l = lbe[eid];
    got[eid] = { r, f };
    const same = r.live ? f && f.text !== null && r.color === f.color && r.text === LM.stateWordOf(l).text
                          && r.text.startsWith(String(f.text).replace("%", ""))
                        : f && f.text === null && r.text === l.code && r.color === H.STALE_INK;
    if (!same) bad.push(eid);
  }
  const hot = H.readoutOf({ ...lbe["sensor.hall_temp"], temperature: 35 }, NOW), cool = H.readoutOf({ ...lbe["sensor.hall_temp"], temperature: 19 }, NOW);
  const air = H.readoutOf(lbe["sensor.kitchen_co2"], NOW), enumAir = H.readoutOf(lbe["sensor.hall_air"], NOW);
  check("readouts: the Atlas's words and colours, while fresh; stale, the code, quiet",
    !bad.length && got["sensor.hall_temp"].r.text === "21°" && got["sensor.loft_humidity"].r.text === "57%"
    && hot.color === "#fb923c" && cool.color === "#93c5fd" && got["sensor.hall_temp"].r.color === "#fca5a5"
    && got["sensor.loft_humidity"].r.color === LC.HUMIDITY_BORDER
    && air.text === LM.airQualityLabel(lbe["sensor.kitchen_co2"]) && air.color === H.airColor(H.airLook(lbe["sensor.kitchen_co2"]).hue)
    && enumAir.text === "Poor" && H.readoutOf(lbe["binary_sensor.hall_motion"], NOW) === null, { bad, got, air, enumAir });
});
tryCase("readouts: a height by type, under the ceiling; part C's stored z_m replaces it", () => {
  const ceil = 2.8 - H.SLAB_T;
  check("readouts: a height by type, under the ceiling; part C's stored z_m replaces it",
    H.deviceZ("temp", ceil, null) === 1.5 && H.deviceZ("humidity", ceil, null) === 1.5 && H.deviceZ("air", ceil, null) === 1.2
    && H.deviceZ("motion", ceil, null) === 2.2 && H.deviceZ("motion", 2.0, null) === 1.92 && H.deviceZ("temp", ceil, { z_m: 0.4 }) === 0.4
    && H.deviceZ("temp", ceil, { z_m: 9 }) === ceil - 0.08 && H.deviceZ("temp", ceil, { z_m: "nope" }) === 1.5
    && Object.keys(H.DEVICE_Z).sort().join() === "air,humidity,motion,temp", null);
});

// ── badges ──────────────────────────────────────────────────────────────────
tryCase("badges: one per plate — its storey, number and colour, as the Atlas's", () => {
  const lbe = records(states());
  const svg = draw(lbe);
  const flat = [...svg.matchAll(/<g class="lfloor" data-role="floor" data-z="([^"]+)"[^>]*>[\s\S]*?<circle[^>]*r="15" fill="([^"]+)"[\s\S]*?>(\d+)<\/text><\/g>/g)]
    .map(m => ({ z: m[1], color: m[2], n: Number(m[3]) }));
  const h = H.readHouse(MODEL, FLOORS, lbe, null);
  const mine = H.floorBadges(MODEL, FLOORS, h).map(B => ({ z: B.z, color: B.color, n: B.n }));
  const main = H.floorBadges(MODEL, FLOORS, h)[0];
  check("badges: one per plate — its storey, number and colour, as the Atlas's",
    flat.length === 2 && JSON.stringify(flat) === JSON.stringify(mine) && main.floor.id === "main" && main.x < 0 && main.y > 4
    && main.name === "Main", { flat, mine });
});

// ── sensors ─────────────────────────────────────────────────────────────────
tryCase("sensors: placed only, hidden never; rebuilt for a move, not a state", () => {
  const lbe = records(states({ "binary_sensor.unplaced": { state: "on", attributes: { device_class: "motion" } } }));
  const h = H.readHouse(MODEL, FLOORS, lbe, new Set(["sensor.loft_temp"]));
  const got = Object.fromEntries(h.sensors.map(S => [S.eid, S.kind]));
  const sig = (l, hidden, model = MODEL) => H.sensorsSignature(model, l, hidden);
  const off = records(states({ "binary_sensor.hall_motion": { ...BASE["binary_sensor.hall_motion"], state: "off" } }));
  const moved = { ...MODEL, light_positions_m: { ...MODEL.light_positions_m, "sensor.hall_temp": { x_m: 7.5, y_m: 3, floor_id: "main" } } };
  check("sensors: placed only, hidden never; rebuilt for a move, not a state",
    JSON.stringify(got) === JSON.stringify({ "binary_sensor.hall_motion": "motion", "binary_sensor.kitchen_motion": "motion",
      "binary_sensor.loft_motion": "motion", "sensor.hall_air": "air", "sensor.hall_temp": "temp", "sensor.kitchen_co2": "air",
      "sensor.loft_humidity": "humidity" })
    && sig(lbe, null) === sig(off, null) && sig(lbe, null, moved) !== sig(lbe, null) && sig(lbe, new Set(["sensor.hall_temp"])) !== sig(lbe, null)
    && H.shellSignature(MODEL, FLOORS, lbe) === H.shellSignature(MODEL, FLOORS, off)
    && H.shellSignature(MODEL, FLOORS, lbe) !== H.shellSignature(MODEL, FLOORS, {}), got);
});

// The copies the house file keeps of the Atlas's (held equal to the original
// by tests/test_live_aboard_live.py, which reads iso_lights.js itself).
console.log(JSON.stringify({ cases, failures, copies: {
  MOTION_COLOR_STOPS: H.MOTION_COLOR_STOPS, MOTION_HOLD_MS: H.MOTION_HOLD_MS, MOTION_RECENT_MS: H.MOTION_RECENT_MS,
  MOTION_BOOT_GRACE_MS: H.MOTION_BOOT_GRACE_MS, TEMP_FRESH_MS: H.TEMP_FRESH_MS, TEMP_TINT: H.TEMP_TINT, LAYER_PAL: H.LAYER_PAL,
  TEMP_WARM_AT: H.TEMP_WARM_AT, TEMP_HOT_OVER: H.TEMP_HOT_OVER, MOTION_PULSE: H.MOTION_PULSE, MOTION_RECENT: H.MOTION_RECENT,
  LOCK_FLASH: H.LOCK_FLASH } }));
process.exit(failures.length ? 1 : 0);
