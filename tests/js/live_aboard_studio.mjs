// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Studio look (settings.atlas_3d_look "studio", views/live_aboard_studio.js
// drawn by views/live_aboard.js). Under the DOM shim with a stub GL.
//
//   colours   Studio draws every room, name and glow in Live Aboard's own
//             colours (the same tiles, halos and names as "own")
//   parts     Low keeps the cheap parts only (no rim light, no shadow
//             softening); High has them all
//   sky       the sky follows the sun: day, night; the rain a slate blue by
//             day, white at night
//   off       back to "own" on the same view: today's look exactly (page,
//             fog, sky light, tiles, halos), nothing of Studio left
//   arrival   the camera glides in once on open, and the house still counts
//             as untouched (it is fitted again as before)
//   pure      skyAt / studioParts / rainOf, the module's own numbers
//
// usage: live_aboard_studio.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_studio.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
  if (!NP.insertAdjacentElement) NP.insertAdjacentElement = function(where, el){ return this.parentNode ? this.parentNode.insertBefore(el, this.nextSibling || null) : null; };
}
const lists = { window: {}, document: {} };
const listen = (key) => ({
  add: (t, fn) => { (lists[key][t] ||= []).push(fn); },
  remove: (t, fn) => { lists[key][t] = (lists[key][t] || []).filter(f => f !== fn); },
});
const W = listen("window"), Dc = listen("document");
globalThis.addEventListener = W.add; globalThis.removeEventListener = W.remove;
document.addEventListener = Dc.add; document.removeEventListener = Dc.remove;
installStubGL();
const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const LA = await import(url("views", "live_aboard.js"));
const ST = await import(url("views", "live_aboard_studio.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "basement", name: "Basement" }, { id: "main", name: "Main" }],
  room_geometry_m: { Rec: rect("basement", 0, 0, 6, 5), "Living room": rect("main", 0, 0, 4.5, 5), Den: rect("main", 4.6, 0, 9, 5) },
  rf_barriers_m: [],
  light_positions_m: { "light.den": { x_m: 6, y_m: 1, floor_id: "main" }, "light.hall": { x_m: 2, y_m: 1, floor_id: "main" } },
};
const LBE = {
  "light.den": { entity_id: "light.den", friendly_name: "Den light", state: "on", brightness: 200, shape: "pendant", rgb_color: [255, 120, 40] },
  "light.hall": { entity_id: "light.hall", friendly_name: "Hall light", state: "off", shape: "pot" },
};
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: LBE, hass: null };
const SUN = (elevation) => ({ "sun.sun": { entity_id: "sun.sun", state: elevation > 0 ? "above_horizon" : "below_horizon", attributes: { azimuth: 160, elevation } } });
const store = new Map();
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const P = (over = {}) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: SUN(40), config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: true, prefs, ...over });
const host = document.createElement("padspan-lights-app");
const shadow = document.createElement("#shadow-root");
shadow.host = host;
document.body.appendChild(host);
host.appendChild(shadow);
function card(slot, over){
  const c = document.createElement("div"), stage = document.createElement("div");
  c.appendChild(stage);
  const content = shadow.children.find(n => n.className === "content") || shadow.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
  content.replaceChildren(c);
  return { ok: slot.attach(stage, P(over)), stage, c };
}
const inTree = (n, top) => { for (let x = n; x; x = x.parentNode) if (x === top) return true; return false; };
function rooted(slot){ const el = slot.element; if (el && !el.getRootNode) el.getRootNode = () => (inTree(el, shadow) ? shadow : el); return el; }
async function view(key, over){
  const slot = LA.liveAboardSlot(key);
  card(slot, over);
  rooted(slot);
  card(slot, over);
  await settle(30);
  return slot;
}
const S = (slot) => slot._state();
const strip = (l) => ({ bg: l.bg, fog: l.fog, ground: l.ground, sky: l.sky, skyI: Number(l.skyI.toFixed(6)), glow: l.glow,
  tiles: Number(l.tiles.toFixed(5)), halos: Number(l.halos.toFixed(5)) });
const names = (st) => st.names.map(n => [n.room, n.text, n.color, n.opacity]);

// ── colours ─────────────────────────────────────────────────────────────────
await tryCase("colours: every room, name and glow in Live Aboard's own colours", async () => {
  const own = await view("st-own", { look3d: "own" });
  const studio = await view("st-studio", { look3d: "studio" });
  const o = S(own), s = S(studio);
  check("colours: every room, name and glow in Live Aboard's own colours",
    s.look.key === "studio" && s.look.atlas === null && !!s.studio && s.studio.on
    && Math.abs(s.look.tiles - o.look.tiles) < 1e-6 && Math.abs(s.look.halos - o.look.halos) < 1e-6
    && JSON.stringify(names(s)) === JSON.stringify(names(o)) && o.studio === null,
    { o: strip(o.look), s: strip(s.look), studio: s.studio });
  for (const k of ["st-own", "st-studio"]) LA.releaseLiveAboardSlot(k);
  await settle();
});

// ── parts ───────────────────────────────────────────────────────────────────
await tryCase("parts: Low keeps the cheap parts; High has them all", async () => {
  const low = await view("st-low", { look3d: "studio", quality: "low" });
  const high = await view("st-high", { look3d: "studio", quality: "high" });
  const l = S(low), h = S(high);
  const cheap = (p) => p.sky && p.stage && p.contact && p.fill && p.vignette && p.wallFoot;
  check("parts: Low keeps the cheap parts; High has them all",
    l.profile === "low" && cheap(l.studio.parts) && !l.studio.parts.rim && !l.studio.parts.softShadow && l.studio.rim === 0
    && h.profile === "high" && cheap(h.studio.parts) && h.studio.parts.rim && h.studio.parts.softShadow && h.studio.rim > 0
    && l.studio.pad && l.studio.contact && l.studio.vignette && l.studio.hidden === 2 && l.studio.wallFoot,
    { low: [l.profile, l.studio], high: [h.profile, h.studio] });
  for (const k of ["st-low", "st-high"]) LA.releaseLiveAboardSlot(k);
  await settle();
});

// ── sky ─────────────────────────────────────────────────────────────────────
await tryCase("sky: the sky follows the sun; rain slate by day, white at night", async () => {
  const day = await view("st-day", { look3d: "studio", states: SUN(40) });
  const night = await view("st-night", { look3d: "studio", states: SUN(-20) });
  const d = S(day).studio, n = S(night).studio;
  check("sky: the sky follows the sun; rain slate by day, white at night",
    d.sky.zenith === ST.STUDIO_SKY.day.zenith && d.sky.horizon === ST.STUDIO_SKY.day.horizon
    && n.sky.zenith === ST.STUDIO_SKY.night.zenith && n.sky.pad === ST.STUDIO_SKY.night.pad
    && S(day).look.bg === ST.STUDIO_SKY.day.horizon && S(night).look.fog === ST.STUDIO_SKY.night.horizon
    && ST.rainOf({ night: 0 }) === ST.STUDIO_RAIN_DAY && ST.rainOf({ night: 1 }) === "#ffffff",
    { d, n });
  for (const k of ["st-day", "st-night"]) LA.releaseLiveAboardSlot(k);
  await settle();
});

// ── off ─────────────────────────────────────────────────────────────────────
await tryCase("off: back to own on the same view is today's look exactly", async () => {
  const ref = await view("st-ref", { look3d: "own" });
  const want = strip(S(ref).look), wantNames = names(S(ref)), wantWall = S(ref).wallMat ? S(ref).wallMat.type : null;
  const slot = await view("st-back", { look3d: "studio" });
  const during = strip(S(slot).look), vigBefore = !!S(slot).studio.vignette;
  const marked = () => { const out = []; const walk = (n) => { for (const c of n.children || []) { if (c.getAttribute && c.getAttribute("data-la3d-studio")) out.push(c); walk(c); } }; walk(slot.element); return out.length; };
  const markedBefore = marked();
  card(slot, { look3d: "own" });
  await settle(30);
  const back = S(slot);
  const vignette = marked();
  check("off: back to own on the same view is today's look exactly",
    back.studio === null && JSON.stringify(strip(back.look)) === JSON.stringify(want) && JSON.stringify(names(back)) === JSON.stringify(wantNames)
    && JSON.stringify(during) !== JSON.stringify(want) && vigBefore && markedBefore === 1 && vignette === 0 && (back.wallMat ? back.wallMat.type : null) === wantWall,
    { want, during, back: strip(back.look), vignette, vigBefore, markedBefore });
  for (const k of ["st-ref", "st-back"]) LA.releaseLiveAboardSlot(k);
  await settle();
});

// ── arrival ─────────────────────────────────────────────────────────────────
await tryCase("arrival: once on open, and the house still counts as untouched", async () => {
  const slot = LA.liveAboardSlot("st-arrive");
  card(slot, { look3d: "studio" });
  rooted(slot);
  card(slot, { look3d: "studio" });
  await settle(4);
  const early = S(slot);
  await settle(30);
  const st = S(slot);
  const own = await view("st-arrive-own", { look3d: "own" });
  check("arrival: once on open, and the house still counts as untouched",
    early.cam.moved === false && st.cam.moved === false && S(own).cam.moved === false
    && ST.STUDIO_ARRIVAL.ms > 1000 && ST.STUDIO_ARRIVAL.radius > 1,
    { early: early.cam, st: st.cam, flying: early.screen.flying });
  for (const k of ["st-arrive", "st-arrive-own"]) LA.releaseLiveAboardSlot(k);
  await settle();
});

// ── pure ────────────────────────────────────────────────────────────────────
await tryCase("pure: the module's own numbers", async () => {
  const day = ST.skyAt({ night: 0, warm: 0 }), gold = ST.skyAt({ night: 0, warm: 1 }), dark = ST.skyAt({ night: 1, warm: 1 });
  const lo = ST.studioParts("low"), hi = ST.studioParts("high"), odd = ST.studioParts("anything");
  check("pure: the module's own numbers",
    JSON.stringify(day) === JSON.stringify({ zenith: ST.STUDIO_SKY.day.zenith, horizon: ST.STUDIO_SKY.day.horizon, pad: ST.STUDIO_SKY.day.pad, glow: ST.STUDIO_SKY.day.glow })
    && gold.horizon === ST.STUDIO_SKY.golden.horizon && dark.zenith === ST.STUDIO_SKY.night.zenith
    && ST.skyAt(null).zenith === ST.STUDIO_SKY.day.zenith && ST.mixHex("#000000", "#ffffff", 0.5) === "#808080"
    && !lo.rim && !lo.softShadow && hi.rim && hi.softShadow && JSON.stringify(odd) === JSON.stringify(lo),
    { day, gold, dark, lo, hi });
});

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
