// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// What kind of space a room is (outdoor_space.js outdoorKind, the one rule;
// room_meta[name].space), run for real. The owner, 2026-11-11: "outside as a
// floor that is outside any part of the house, and a patio that is covered,
// and has no walls to the outside edges ... very different things"; "a patio
// still belongs to a floor".
//
//   guess   nothing stored: the name decides indoors or outdoors as before; an
//           outdoor room with a room of a higher floor over most of it (an
//           indoor room or a deck) is covered, only partly under is open; a
//           gallery called "Deck A" in a hall stays indoors; on an Outside
//           floor it is ground
//   stored  what a person chose wins: Indoors for a "Patio Room", Covered for a
//           porch with nothing over it (roofed at its floor's height), Open for
//           a patio under a deck; a room whose name no longer says patio keeps
//           its chosen kind
//   rain    Live Aboard's weather: rain and snow land on an open patio, never
//           on a covered one (it is kept dry, as a room is)
//   lights  a ceiling pot is set into an open patio's floor, and hangs from
//           what covers a covered one (the deck above, or its own roof)
//   roof    a porch chosen Covered with nothing over it gets a thin roof slab
//           over its outline in the view, at its ceiling, part of the roof
//   doors   door_types.js reads outdoors by the same rule, and gives the old
//           name rule's answer whenever nothing is stored
//   rooms   the Rooms page: the choice for a room on a house floor, what it
//           was worked out as, none for a room on the Outside floor (a deck
//           there gets one muted line), saved with room_height_set {room, space}
//   parity  a table of rooms through outdoorKind, printed for the server's
//           presence_rules.outdoor_kind to be held to (tests/test_outdoor_kind.py)
//
// usage: outdoor_space.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: ok}, failures: [...], table: [...] }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: outdoor_space.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
const lists = {};
globalThis.addEventListener = (t, fn) => { (lists[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { lists[t] = (lists[t] || []).filter(f => f !== fn); };
document.addEventListener = () => {}; document.removeEventListener = () => {};
installStubGL();

const url = (rel) => pathToFileURL(join(WWW, rel)).href;
const S = await import(url("views/outdoor_space.js"));
const H = await import(url("views/live_aboard_house.js"));
const W = await import(url("views/live_aboard_weather.js"));
const D = await import(url("views/door_types.js"));
const ISO = await import(url("views/iso_lights.js"));
const LA = await import(url("views/live_aboard.js"));
const R = await import(url("views/rooms.js") + "?t=2");

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

// ── the house: a lower floor and a main floor, an Outside floor ─────────────
// Lower (0 m): Rec; Patio under the Deck; Side Patio only partly under Main's
// Den; Garden Patio under nothing. Main (2.6 m): Den, Deck (over Patio).
// Outside: a Shed and a Back Deck (a deck put on the Outside floor).
const HOUSE = () => ({
  floors: [{ id: "lower", name: "Lower", floor_to_floor_m: 2.6 }, { id: "main", name: "Main", floor_to_floor_m: 2.8 },
           { id: "outside", name: "Outside" }],
  floor_elevations: { lower: 0, main: 2.6 },
  room_geometry_m: {
    Rec: rect("lower", 0, 0, 6, 5),
    Patio: rect("lower", 0, 5, 6, 9),
    "Side Patio": rect("lower", 6, 0, 10, 5),
    "Garden Patio": rect("lower", 10, 0, 14, 5),
    Den: rect("main", 0, 0, 7.2, 5),                       // over the Rec, and 30 % of the Side Patio
    Deck: rect("main", 0, 5, 6, 9),                        // over the Patio
    Shed: rect("outside", 20, 0, 23, 3),
    "Back Deck": rect("outside", 20, 5, 23, 8),
  },
  room_meta: {},
  light_positions_m: {},
});
const withSpace = (m, spaces) => { for (const [n, v] of Object.entries(spaces)) m.room_meta[n] = { ...(m.room_meta[n] || {}), floor_id: m.room_geometry_m[n].floor_id, color: "#556677", space: v }; return m; };
const read = (m) => H.readHouse(H.splitLevels(m), m.floors, {}, new Set(), {});
const kinds = (h) => Object.fromEntries(h.rooms.map(r => [r.name, r.kind]));

// ── guess ──────────────────────────────────────────────────────────────────
await tryCase("guess: by name as before; under a higher floor's room covered, partly under open; Outside floor ground", () => {
  const h = read(HOUSE()), k = kinds(h);
  const p = h.rooms.find(r => r.name === "Patio");
  check("guess: by name as before; under a higher floor's room covered, partly under open; Outside floor ground",
    k.Rec === "indoor" && k.Den === "indoor" && k.Patio === "covered" && k["Side Patio"] === "open" && k["Garden Patio"] === "open"
    && k.Deck === "open" && k.Shed === "ground" && k["Back Deck"] === "ground"
    && p.outdoor && p.covered && p.covers.length === 1 && Math.abs(p.covers[0].h - 2.6) < 1e-9 && !p.roofed, { k, covers: p.covers });
});
await tryCase("guess: under an indoor room is covered too", () => {
  const m = HOUSE(); m.room_geometry_m.Deck = rect("main", 0, 5, 6, 9); delete m.room_geometry_m.Deck;
  m.room_geometry_m.Sunroom = rect("main", 0, 5, 6, 9);
  check("guess: under an indoor room is covered too", kinds(read(m)).Patio === "covered", kinds(read(m)));
});
await tryCase("guess: a gallery called Deck A in a hall stays indoors, as before", () => {
  const m = { floors: [{ id: "g", name: "G", floor_to_floor_m: 3.2 }, { id: "m", name: "M", floor_to_floor_m: 2.6 }],
              floor_elevations: { g: 0, m: 3.2 }, room_meta: { Hall: { floor_id: "g", color: "#123456", height_m: 7.5 } },
              room_geometry_m: { Hall: rect("g", 0, 0, 10, 10), "Deck A": rect("m", 0, 0, 3, 10) } };
  const r = read(m).rooms.find(x => x.name === "Deck A");
  check("guess: a gallery called Deck A in a hall stays indoors, as before", r.kind === "indoor" && !r.outdoor && r.within, { kind: r.kind, within: r.within });
});
// ── stored ─────────────────────────────────────────────────────────────────
await tryCase("stored: what a person chose wins; a porch chosen Covered with nothing over it is roofed at its floor's height", () => {
  const m = withSpace(HOUSE(), { "Garden Patio": "covered", Patio: "open", Rec: "covered" });
  m.room_geometry_m["Patio Room"] = rect("main", 7.3, 0, 10, 5);
  withSpace(m, { "Patio Room": "indoor" });
  const h = read(m), k = kinds(h), g = h.rooms.find(r => r.name === "Garden Patio");
  check("stored: what a person chose wins; a porch chosen Covered with nothing over it is roofed at its floor's height",
    k["Garden Patio"] === "covered" && g.roofed && g.coverH === 2.6 && k.Patio === "open" && !h.rooms.find(r => r.name === "Patio").covered
    && k["Patio Room"] === "indoor" && !h.rooms.find(r => r.name === "Patio Room").outdoor && k.Rec === "covered", k);
});
await tryCase("stored: a room whose name no longer says patio keeps its chosen kind", () => {
  const m = HOUSE();
  m.room_geometry_m.Lanai = m.room_geometry_m["Garden Patio"]; delete m.room_geometry_m["Garden Patio"];
  const before = kinds(read(m)).Lanai;
  withSpace(m, { Lanai: "covered" });
  check("stored: a room whose name no longer says patio keeps its chosen kind", before === "indoor" && kinds(read(m)).Lanai === "covered", { before });
});
await tryCase("stored: a value on a room on the Outside floor changes nothing: ground", () => {
  check("stored: a value on a room on the Outside floor changes nothing: ground", kinds(read(withSpace(HOUSE(), { Shed: "covered" }))).Shed === "ground");
});

// ── rain ───────────────────────────────────────────────────────────────────
const STY = await import(url("views/live_aboard_storey.js"));
// As the view hands it over: the ground drawn just under the lowest slab.
const area = (h, shown = () => true) => W.weatherArea({ rooms: h.rooms, ground: h.ground - H.SLAB_T - 0.02, shown, minus: STY.minusPolys });
// Where a fall of rain lands, by spot: what spawnLayer keeps (seeded, so the same each run).
const drops = (A) => { const L = W.spawnLayer(A, "downpour", 4000, 7), out = []; for (let i = 0; i < L.n; i++) out.push([L.pos[i * 4], L.pos[i * 4 + 1], L.pos[i * 4 + 2]]); return out; };
const inRect = (x, y, x0, y0, x1, y1) => x > x0 && x < x1 && y > y0 && y < y1;
await tryCase("rain: falls on the open deck over a covered patio, never on the patio under it; no snow layer there", () => {
  const A = area(read(HOUSE())), D = drops(A);
  const onDeck = D.filter(d => inRect(d[0], d[1], 0, 5, 6, 9) && Math.abs(d[2] - 2.6) < 1e-6).length;
  const onPatio = D.filter(d => inRect(d[0], d[1], 0, 5, 6, 9) && d[2] < 2.5).length;
  const patio = A.decks.find(d => d.y === 0 && H.inPoly(3, 7, d.pts));
  // Main hidden (Lower alone): still nothing falls on the covered patio.
  const D2 = drops(area(read(HOUSE()), (fl) => fl.id !== "main"));
  const hidden = D2.filter(d => inRect(d[0], d[1], 0.05, 5.05, 5.95, 8.95)).length;
  check("rain: falls on the open deck over a covered patio, never on the patio under it; no snow layer there",
    onDeck > 20 && onPatio === 0 && W.landingAt(A, 3, 7) === 2.6 && patio && patio.cover.length === 1 && patio.open.length === 0
    && !A.indoor.some(d => H.inPoly(3, 7, d.pts)) && !A.tops.some(t => H.inPoly(3, 7, t.pts)) && hidden === 0, { onDeck, onPatio, hidden });
});
await tryCase("rain: a deck with nothing under it, and an open patio, are rained on as before", () => {
  const m = HOUSE(); delete m.room_geometry_m.Patio;
  const A = area(read(m)), D = drops(A);
  const deck = A.decks.find(d => H.inPoly(3, 7, d.pts));
  check("rain: a deck with nothing under it, and an open patio, are rained on as before",
    deck && !deck.cover && deck.y === 2.6 && D.some(d => inRect(d[0], d[1], 0, 5, 6, 9) && Math.abs(d[2] - 2.6) < 1e-6)
    && D.some(d => inRect(d[0], d[1], 10, 0, 14, 5) && d[2] === 0) && W.landingAt(A, 12, 2) === 0);
});
// An L-shaped patio half under the deck: Patio L (0..6, 5..13) with the Deck over 5..9 only.
const LHOUSE = () => { const m = HOUSE(); m.room_geometry_m.Patio = { type: "poly", floor_id: "lower", points_m: [[0, 5], [6, 5], [6, 9], [3, 9], [3, 12], [0, 12]] }; return m; };
await tryCase("rain: on an L-shaped patio half under a deck, rain and snow on the open half only", () => {
  const h = read(LHOUSE()), p = h.rooms.find(r => r.name === "Patio"), A = area(h), D = drops(A);
  const deck = A.decks.find(d => d.y === 0 && H.inPoly(1, 10, d.pts));
  const openArea = (deck ? deck.open : []).reduce((a, P) => a + Math.abs(P.reduce((s, q, i) => { const r = P[(i + 1) % P.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2, 0);
  const lowOpen = D.filter(d => inRect(d[0], d[1], 0, 9, 3, 12) && d[2] === 0).length, lowUnder = D.filter(d => inRect(d[0], d[1], 0, 5, 6, 9) && d[2] < 2.5).length;
  check("rain: on an L-shaped patio half under a deck, rain and snow on the open half only",
    p.kind === "covered" && deck && Math.abs(openArea - 9) < 1e-6 && lowOpen > 5 && lowUnder === 0 && W.landingAt(A, 1, 10) === 0 && W.landingAt(A, 1, 7) === 2.6,
    { kind: p.kind, openArea, lowOpen, lowUnder });
});

// ── lights ─────────────────────────────────────────────────────────────────
const potIn = (m, x, y) => {
  const h = read(m), fl = h.byId.get("lower");
  const per = h.perFloor.get(fl);
  return H.fixtureParts({ kind: "pot", x, y, floor: fl, fp: null, rot: 0, marginM: null }, { rooms: per.rooms, pieces: per.pieces, ground: h.ground });
};
await tryCase("lights: a ceiling pot is set into an open patio's floor and hangs from what covers a covered one", () => {
  const hOf = (P) => P.bulbs[0].h;
  const open = hOf(potIn(HOUSE(), 12, 2)), cov = potIn(HOUSE(), 3, 7), covered = hOf(cov), roofed = potIn(withSpace(HOUSE(), { "Garden Patio": "covered" }), 12, 2);
  const reopened = potIn(withSpace(HOUSE(), { Patio: "open" }), 3, 7);
  check("lights: a ceiling pot is set into an open patio's floor and hangs from what covers a covered one",
    open === 0.015 && hOf(reopened) === 0.015 && !reopened.under && covered > 2.3 && covered < 2.6 - H.SLAB_T + 1e-9 && cov.under === true
    && hOf(roofed) > 2.3 && roofed.under === true, { open, covered, roofed: hOf(roofed), reopened: hOf(reopened) });
});
await tryCase("lights: on the L-shaped patio, a pot under the deck hangs at its ceiling, one in the open half sits in the floor", () => {
  const under = potIn(LHOUSE(), 1.5, 7), out = potIn(LHOUSE(), 1.5, 11);
  check("lights: on the L-shaped patio, a pot under the deck hangs at its ceiling, one in the open half sits in the floor",
    under.bulbs[0].h > 2.3 && under.under === true && out.bulbs[0].h === 0.015 && !out.under, { under: under.bulbs[0].h, out: out.bulbs[0].h });
});
await tryCase("lights: the height is from the room over the spot, not a sunk room beside it", () => {
  const m = HOUSE();
  // A study on Main, sunk half a metre, beside the deck (its box meets the patio's, it is over none of it).
  m.room_geometry_m.Study = rect("main", 6.2, 5, 9, 9);
  withSpace(m, {}); m.room_meta.Study = { floor_id: "main", color: "#334455", floor_raise_m: -0.5 };
  m.room_geometry_m.Patio = rect("lower", 0, 5, 6.5, 9);
  const h = potIn(m, 3, 7).bulbs[0].h, base = potIn(HOUSE(), 3, 7).bulbs[0].h;
  check("lights: the height is from the room over the spot, not a sunk room beside it", Math.abs(h - base) < 1e-9, { h, base });
});
await tryCase("lights: a porch chosen Covered hangs its pots from its roof's underside", () => {
  const P = potIn(withSpace(HOUSE(), { "Garden Patio": "covered" }), 12, 2), Q = potIn(HOUSE(), 3, 7);
  // Its roof's underside is at its floor's height (2.6), as the deck's slab underside is (2.6 less the slab): pots as far under each.
  check("lights: a porch chosen Covered hangs its pots from its roof's underside", Math.abs(P.bulbs[0].h - (Q.bulbs[0].h + H.SLAB_T)) < 1e-9,
    { porch: P.bulbs[0].h, patio: Q.bulbs[0].h });
});

// ── roof ───────────────────────────────────────────────────────────────────
const settle = async (rounds = 30) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: {}, hass: null };
const props = (model) => ({ model, floors: model.floors, lightsByEid: {}, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: {}, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: async () => ({ data: {} }) });
async function viewState(key, model){
  const slot = LA.liveAboardSlot(key);
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage); document.body.replaceChildren(c);
  slot.attach(stage, props(model));
  await settle();
  const s = slot._state();
  LA.releaseLiveAboardSlot(key);
  await settle(4);
  return s;
}
await tryCase("roof: a porch chosen Covered with nothing over it gets a thin roof slab at its ceiling; nothing for the others", async () => {
  const plain = await viewState("space-plain", HOUSE());
  const porch = await viewState("space-porch", withSpace(HOUSE(), { "Garden Patio": "covered" }));
  const roofs = (s) => ((s.house && s.house.roofs) || []).filter(r => r.porch);
  const p = roofs(porch)[0], ys = p ? [...new Set(p.y.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b) : [];
  check("roof: a porch chosen Covered with nothing over it gets a thin roof slab at its ceiling; nothing for the others",
    plain.house && roofs(plain).length === 0 && roofs(porch).length === 1 && p.porch === "Garden Patio"
    && JSON.stringify(ys) === JSON.stringify([2.6, 2.7]), { plain: plain.house && plain.house.roofs, p: p && { ...p, y: ys } });
});

// ── doors ──────────────────────────────────────────────────────────────────
const OLD_NAME = /\b(deck|patio|porch|balcony|terrace|veranda|yard|garden|lawn|driveway|outside|outdoor)\b/i;
const NAMES = ["Kitchen", "Patio", "Back Patio", "back_patio", "Deck A", "Upper Deck", "Porch", "Sunroom", "Outdoors", "Outdoor Kitchen",
               "Garden", "Driveway", "Patio Room", "Balcony", "Lanai", "Terrace", "Yard", "Veranda", "Decking", "Lawn", ""];
await tryCase("doors: the doors' rule gives the old name rule's answer whenever nothing is stored, and follows a stored kind", () => {
  const same = NAMES.every(n => D.outdoorRoom({ name: n }) === OLD_NAME.test(n) && S.outdoorKind({ name: n }) !== "indoor" === OLD_NAME.test(n));
  check("doors: the doors' rule gives the old name rule's answer whenever nothing is stored, and follows a stored kind",
    same && D.outdoorRoom({ name: "Patio Room", space: "indoor" }) === false && D.outdoorRoom({ name: "Lanai", space: "covered" }) === true
    && D.outdoorRoom({ name: "Patio", outdoor: false }) === false, NAMES.map(n => [n, D.outdoorRoom({ name: n }), OLD_NAME.test(n)]));
});
await tryCase("doors: on the flat Map open and covered draw alike (it has no rain on rooms and no ceilings)", () => {
  const svg = (m) => ISO.buildIsoSVG(m, {}, new Set(), null, 150, 0, {}, false, m.floors, {});
  const base = withSpace(HOUSE(), { Patio: null, "Side Patio": null });
  const a = svg(base), b = svg(withSpace(HOUSE(), { Patio: "open", "Side Patio": "covered" }));
  check("doors: on the flat Map open and covered draw alike (it has no rain on rooms and no ceilings)",
    a.length > 2000 && a === b);
});

// ── rooms ──────────────────────────────────────────────────────────────────
const panelSrc = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elSrc = panelSrc.slice(panelSrc.indexOf("function el(tag, attrs={}, children=[]){"));
const el = new Function(elSrc.slice(0, elSrc.indexOf("\n}\n") + 3) + "\nreturn el;")();
function roomsCtx(model, over = {}){
  const calls = [];
  model.areas = Object.entries(model.room_geometry_m).map(([n, g]) => ({ id: n.toLowerCase().replace(/\s+/g, "_"), name: n, floor_id: g.floor_id }));
  for (const [n, g] of Object.entries(model.room_geometry_m)) model.room_meta[n] = { floor_id: g.floor_id, color: "#556677", ...(model.room_meta[n] || {}) };
  const ctx = {
    hass: { user: { is_admin: true } },
    state: { complexity: "advanced", view: "rooms", settings: {}, model, live: { snapshot: null }, maps: { list: [] }, ...over },
    helpers: { el, helpBtn: () => el("button", {}, "?"), esc: (s) => String(s ?? ""), roomColor: () => "#888888" },
    actions: { modelUpdate: async () => {}, wsCall: async (type, data) => { calls.push({ type, ...data }); return { ok: true }; },
               modelRefresh: async () => {}, telemetryEvent: () => {}, renderRooms: () => {}, followedHas: () => false },
    toast: () => {},
  };
  return { ctx, calls };
}
const all = (n, out = []) => { for (const c of n.children || []) { out.push(c); all(c, out); } return out; };
const roomNode = (root, name) => all(root).find(n => n.getAttribute && n.getAttribute("data-room") === name);
const attrIn = (root, name, attr) => all(roomNode(root, name)).find(n => n.getAttribute && n.getAttribute(attr) !== null && n.getAttribute(attr) !== undefined) || null;
await tryCase("rooms: the choice for a room on a house floor with what it was worked out as; none on the Outside floor, a deck there gets one line", async () => {
  const { ctx } = roomsCtx(withSpace(HOUSE(), { "Garden Patio": "covered" }));
  const root = R.render(ctx);
  const sel = (n) => all(roomNode(root, n)).find(x => x.getAttribute && x.getAttribute("data-edit") === "space") || null;
  const worked = (n) => { const w = attrIn(root, n, "data-space-worked"); return w ? w.textContent : null; };
  check("rooms: the choice for a room on a house floor with what it was worked out as; none on the Outside floor, a deck there gets one line",
    sel("Patio") && sel("Patio").value === "" && worked("Patio") === "Worked out: covered patio or porch"
    && sel("Garden Patio").value === "covered" && worked("Garden Patio") === "Worked out: open deck or patio"
    && sel("Rec") && worked("Rec") === "Worked out: indoors" && sel("Side Patio") && worked("Side Patio") === "Worked out: open deck or patio"
    && !sel("Shed") && !sel("Back Deck") && !attrIn(root, "Shed", "data-space-note")
    && attrIn(root, "Back Deck", "data-space-note").textContent === "A deck or patio usually belongs to the floor it is level with"
    // The surface is offered for every outdoor room, the Outside floor's included; never indoors.
    && !!all(roomNode(root, "Patio")).find(x => x.getAttribute && x.getAttribute("data-edit") === "surface")
    && !all(roomNode(root, "Rec")).find(x => x.getAttribute && x.getAttribute("data-edit") === "surface"),
    { patio: worked("Patio"), garden: worked("Garden Patio") });
});
await tryCase("rooms: a choice is saved with room_height_set {room, space}; Work it out sends null", async () => {
  const { ctx, calls } = roomsCtx(HOUSE());
  const root = R.render(ctx);
  const s = all(roomNode(root, "Patio")).find(x => x.getAttribute && x.getAttribute("data-edit") === "space");
  s.value = "open"; s.dispatchEvent({ type: "change" }); await shim.flush();
  s.value = ""; s.dispatchEvent({ type: "change" }); await shim.flush();
  check("rooms: a choice is saved with room_height_set {room, space}; Work it out sends null",
    JSON.stringify(calls) === JSON.stringify([{ type: "padspan_ha/room_height_set", room: "Patio", space: "open" },
                                              { type: "padspan_ha/room_height_set", room: "Patio", space: null }]), calls);
});

await tryCase("rooms: the page works out every room as the 3D view does (one rule, the same facts)", async () => {
  const same = [];
  for (const m of [HOUSE(), LHOUSE(), (() => { const x = HOUSE(); x.room_geometry_m.Study = rect("main", 6.2, 5, 9, 9); x.room_meta.Study = { floor_id: "main", color: "#334455", floor_raise_m: -0.5 }; return x; })()]) {
    const k3 = kinds(read(clone(m))), { ctx } = roomsCtx(clone(m));
    for (const g of R.roomGroups(ctx)) for (const r of g.rooms) same.push([r.name, r.spaceWorked, k3[r.name]]);
  }
  check("rooms: the page works out every room as the 3D view does (one rule, the same facts)",
    same.length >= 20 && same.every(([, a, b]) => a === b), same.filter(([, a, b]) => a !== b));
});
await tryCase("rooms: a room drawn on the Outside plan whose area has no floor is outside ground: no choice", async () => {
  const { ctx } = roomsCtx(HOUSE());
  for (const a of ctx.state.model.areas) if (a.name === "Shed" || a.name === "Back Deck") a.floor_id = null;
  const root = R.render(ctx);
  const sel = (n) => all(roomNode(root, n)).find(x => x.getAttribute && x.getAttribute("data-edit") === "space") || null;
  check("rooms: a room drawn on the Outside plan whose area has no floor is outside ground: no choice",
    !sel("Shed") && !sel("Back Deck") && !!attrIn(root, "Back Deck", "data-space-note") && !!sel("Patio"));
});

// ── parity ─────────────────────────────────────────────────────────────────
const table = [];
for (const name of NAMES) for (const floor of ["main", "basement", "outside", "__outside__", "Garden", "Back Yard"])
  for (const stored of [null, "indoor", "open", "covered", "bogus"]) for (const within of [false, true]) for (const over of [false, true])
    table.push([name, floor, stored, within, over, S.outdoorKind({ name, ground: ISO.isOutdoorFloorId(floor), stored, within, over })]);
check("parity: the table was built", table.length === NAMES.length * 6 * 5 * 4);

process.stdout.write(JSON.stringify({ cases, failures, table }) + "\n", () => process.exit(0));   // exit only once the result is written (a pipe holds 64 KiB)
