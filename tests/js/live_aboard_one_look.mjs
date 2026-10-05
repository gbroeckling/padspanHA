// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// One look: Live Aboard wears the Atlas's look (views/live_aboard_showcase.js
// atlasLook, drawn by views/live_aboard.js) unless "Live Aboard's own" is
// chosen (settings.atlas_3d_look). Under the DOM shim with a stub GL.
//
//   choice    no choice handed over, or "own": today's look exactly; "atlas"
//             with Showcase off: the plain Atlas's page; with a theme: the
//             theme's; back to "own": today's again
//   rules     the plain Atlas's room rules are the flat drawing's own
//             (buildIsoSVG's output), a theme's are its SHOWCASE_THEMES entry
//   rooms     per theme (plain, Hygge, Neo HUD): each floor its theme's floor
//             with the room's colour faintly in it, the outline in the room's
//             colour showing by day, the name in the room's colour (UPPERCASE
//             where the theme says), slab edges and off fixtures the theme's
//   floors    the stepper and the floor list carry each floor's number in its
//             plate's colour (iso_lights.js LAYER_PAL), each plate its line;
//             Live Aboard's own: none
//   readouts  a room's chip says what the Atlas says (its state word, its
//             colour), the air as the Atlas's room sheet words it
//   safety    covering the panel, the Vacation banner and the emergency dial
//             rise above it; uncovered, nothing is changed
//
// usage: live_aboard_one_look.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as shim from "./dom_shim.mjs";
import { installStubGL } from "./stub_gl.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_one_look.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();
// The shim's tree, with the real DOM's moves (as live_aboard_screen.mjs).
{
  const NP = globalThis.Node.prototype, ap = NP.appendChild, ib = NP.insertBefore, rc = NP.removeChild;
  const leave = (c) => { const p = c && c.parentNode; if (p && p.children) { const i = p.children.indexOf(c); if (i >= 0) p.children.splice(i, 1); } };
  NP.appendChild = function(c){ leave(c); return ap.call(this, c); };
  NP.insertBefore = function(c, ref){ leave(c); return ib.call(this, c, ref); };
  NP.removeChild = function(c){ const r = rc.call(this, c); if (c && c.parentNode === this) c.parentNode = null; return r; };
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
const LOOKS = await import(url("views", "live_aboard_showcase.js"));
const ISO = await import(url("views", "iso_lights.js"));
const LM = await import(url("views", "lights_map.js"));
const LC = await import(url("views", "light_codes.js"));
const HOUSE = await import(url("views", "live_aboard_house.js"));
const { roomColor } = await import(url("views", "room_color.js"));

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => {
  try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; }
};
const settle = async (rounds = 14) => { await shim.flush(rounds); await new Promise(r => globalThis._realSetTimeout(r, 0)); };

// ── the house: a basement under two rooms, sensors in the den ───────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const MODEL = {
  floors: [{ id: "basement", name: "Basement" }, { id: "main", name: "Main" }],
  room_geometry_m: { Rec: rect("basement", 0, 0, 6, 5), "Living room": rect("main", 0, 0, 4.5, 5), Den: rect("main", 4.6, 0, 9, 5) },
  rf_barriers_m: [],
  light_positions_m: { "light.den": { x_m: 6, y_m: 1, floor_id: "main" }, "light.hall": { x_m: 2, y_m: 1, floor_id: "main" },
                       "sensor.den_temp": { x_m: 6, y_m: 4, floor_id: "main" }, "sensor.den_humidity": { x_m: 6.2, y_m: 4, floor_id: "main" },
                       "sensor.den_air": { x_m: 6.4, y_m: 4, floor_id: "main" } },
};
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const LBE = {
  "light.den": { entity_id: "light.den", friendly_name: "Den light", state: "on", brightness: 200, shape: "pendant" },
  "light.hall": { entity_id: "light.hall", friendly_name: "Hall light", state: "off", shape: "pot" },
  "sensor.den_temp": { entity_id: "sensor.den_temp", code: "T1", friendly_name: "Den temperature", isTemp: true, state: "21.5", temperature: 21.5,
                       device_class: "temperature", unit_of_measurement: "°C", last_changed: ago(60e3) },
  "sensor.den_humidity": { entity_id: "sensor.den_humidity", code: "H1", friendly_name: "Den humidity", isHumidity: true, state: "45", humidity: 45,
                           device_class: "humidity", unit_of_measurement: "%", last_changed: ago(60e3) },
  "sensor.den_air": { entity_id: "sensor.den_air", code: "Q1", friendly_name: "Den air", isAir: true, state: "fair", air_level: "fair",
                      device_class: "aqi", last_changed: ago(60e3) },
};
const api = { toast(){}, toggle(){}, openRoom(){}, openFloor(){}, openControls(){}, openActivity(){}, controlsFor: () => null, lightsByEid: LBE, hass: null };
const DAY = { "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 160, elevation: 40 } } };
const steps = (over = {}) => ({ names: ["Basement", "Main"], zs: ["0", "1"], at: 1, all: false, go(){}, ...over });
const AT = (key, on = true) => ({ on, key, theme: ISO.SHOWCASE_THEMES[key] || ISO.SHOWCASE_THEMES.classic });
const SC = (key) => ({ key, theme: ISO.SHOWCASE_THEMES[key] || ISO.SHOWCASE_THEMES.classic });
const store = new Map();
const prefs = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, String(v)) };
const P = (over = {}) => ({ model: MODEL, floors: MODEL.floors, lightsByEid: LBE, hidden: new Set(), topFloorIds: null, quality: "low",
  telemetry: () => {}, onTouch: () => {}, states: DAY, config: {}, bearing: 0, saveNorth: async () => true, useApi: () => api,
  haStartedMs: 0, load: async () => ({ data: {} }), edit: null, mapOnly: true, floorSteps: steps(), prefs, ...over });
// The panel's stand-in shadow root, as live_aboard_screen.mjs builds it.
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
const hexOf = (c) => { const s = String(c); if (s.startsWith("#")) return s.toLowerCase();
  const m = /hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/.exec(s); if (!m) return s;
  const h = Number(m[1]) / 360, sa = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + sa) : l + sa - l * sa, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return "#" + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join(""); };
const near = (a, b, d = 2) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  return [16, 8, 0].every(s => Math.abs(((x >> s) & 255) - ((y >> s) & 255)) <= d); };

// ── choice ──────────────────────────────────────────────────────────────────
await tryCase("choice: no choice or own is today's look; atlas follows the Atlas; own again is today's", async () => {
  const absent = await view("ol-absent", {});
  const own = await view("ol-own", { look3d: "own", atlasLook: AT("hygge") });
  const plain = await view("ol-plain", { look3d: "atlas", atlasLook: AT("hygge", false) });
  const hygge = await view("ol-hygge", { look3d: "atlas", atlasLook: AT("hygge"), showcase: SC("hygge") });
  const a = strip(S(absent).look), o = strip(S(own).look), pl = S(plain).look, hy = S(hygge).look;
  const wantHy = LOOKS.atlasLook(AT("hygge"));
  // Back to Live Aboard's own on the same view: today's look again.
  card(hygge, { look3d: "own", atlasLook: AT("hygge"), showcase: SC("hygge") });
  await settle(30);
  const back = strip(S(hygge).look);
  check("choice: no choice or own is today's look; atlas follows the Atlas; own again is today's",
    S(absent).look.key === "classic" && S(absent).look.atlas === null && JSON.stringify(o) === JSON.stringify(a) && S(own).look.atlas === null
    && pl.key === "atlas:plain" && pl.atlas.on === false && pl.bg === "#0c110f" && pl.ground === "#18201c"
    && hy.key === "atlas:hygge" && hy.atlas.on === true && hy.bg === wantHy.page.bg && hy.ground === wantHy.page.ground
    && hy.bg !== LOOKS.SHOWCASE_LOOKS.hygge.bg && JSON.stringify(back) === JSON.stringify(a),
    { a, o, pl, hy, back, want: wantHy.page });
  for (const k of ["ol-absent", "ol-own", "ol-plain", "ol-hygge"]) LA.releaseLiveAboardSlot(k);
  await settle();
});

// ── rules ───────────────────────────────────────────────────────────────────
await tryCase("rules: the plain Atlas's room rules are the flat drawing's own; a theme's are its own entry", async () => {
  const FL = MODEL.floors;
  const flat = (opts) => ISO.buildIsoSVG(MODEL, {}, new Set(), null, 150, 0, {}, false, FL, opts);
  const plainSvg = flat({}), hygSvg = flat({ showcase: true, showcaseTheme: "hygge" });
  const PR = LOOKS.PLAIN_ROOMS, T = ISO.SHOWCASE_THEMES.hygge, hy = LOOKS.atlasLook(AT("hygge")), pl = LOOKS.atlasLook(AT("hygge", false));
  const roomLine = new RegExp(`fill-opacity="${PR.fillOpacity}" stroke="[^"]+" stroke-width="${PR.strokeWidth}" opacity="${PR.strokeOpacity}"`);
  const isoSrc = readFileSync(join(WWW, "views", "iso_lights.js"), "utf8");
  const has = { line: roomLine.test(plainSvg), name: plainSvg.includes(`opacity="${PR.labelOpacity}" pointer-events="none">Den</text>`),
                off: isoSrc.includes(`(SHOW?THEME.fixtureOffFill:"${PR.offFill}")`), pal: ISO.LAYER_PAL === HOUSE.LAYER_PAL,
                spacing: hygSvg.includes(`letter-spacing="${T.roomLabelLetterSpacing}"`), upper: hygSvg.includes(">DEN</text>") };
  check("rules: the plain Atlas's room rules are the flat drawing's own; a theme's are its own entry",
    Object.values(has).every(Boolean)
    && hy.fillOpacity === T.roomFillOpacity && hy.strokeWidth === T.roomStrokeWidth && hy.strokeOpacity === T.roomStrokeOpacity
    && hy.upper === true && hy.spacing === parseFloat(T.roomLabelLetterSpacing) && hy.offFill === T.fixtureOffFill
    && pl.fillOpacity === PR.fillOpacity && pl.upper === false && pl.offFill === PR.offFill
    // Showcase off, the slab edges and the chips still take the theme the Atlas reads them from.
    && pl.chipBg === T.codeChipBg && pl.side !== LOOKS.atlasLook(AT("classic", false)).side,
    { has, hy, pl });
});

// ── rooms ───────────────────────────────────────────────────────────────────
for (const [name, at] of [["plain", AT("classic", false)], ["hygge", AT("hygge")], ["neo_hud", AT("neo_hud")]]) {
  await tryCase(`rooms: ${name}`, async () => {
    const A = LOOKS.atlasLook(at);
    const own = await view(`ol-r-own-${name}`, { look3d: "own" });
    const slot = await view(`ol-r-${name}`, { look3d: "atlas", atlasLook: at });
    const st = S(slot), o = S(own);
    const den = st.names.find(n => n.room === "Den"), denOwn = o.names.find(n => n.room === "Den");
    const want = hexOf(roomColor("Den"));
    check(`rooms: ${name}`,
      // The floor: not today's tiles; the outline shows by day at the theme's strength (own: night only).
      st.look.tiles !== o.look.tiles && st.look.atlas.edges.length > 0 && st.look.atlas.edges.every(e => Math.abs(e - A.lineOp) < 1e-9)
      && o.night.edges.every(e => e === 0)
      // The name: in the room's colour, UPPERCASE where the theme says, at its strength; own: white, as written.
      && near(den.color, want) && den.text === (A.upper ? "DEN" : "Den") && Math.abs(den.opacity - A.nameOp) < 1e-9
      && denOwn.color === "#ffffff" && denOwn.text === "Den" && den.onTop && den.upright
      // A fixture that is off leans to the theme's dark fixture.
      && st.night.offBulb && st.night.offLit && st.night.offBulb.every((v, i) => Math.abs(v - st.night.offLit[i]) < 1e-6)
      && JSON.stringify(st.night.offLit) !== JSON.stringify(o.night.offLit),
      { name, look: st.look.atlas, den, denOwn, want, tiles: [st.look.tiles, o.look.tiles], off: [st.night.offLit, o.night.offLit] });
    LA.releaseLiveAboardSlot(`ol-r-own-${name}`); LA.releaseLiveAboardSlot(`ol-r-${name}`);
    await settle();
  });
}

// ── floors ──────────────────────────────────────────────────────────────────
await tryCase("floors: each floor's number in its plate's colour, each plate its line; own: none", async () => {
  const slot = await view("ol-floors", { look3d: "atlas", atlasLook: AT("hygge") });
  const own = await view("ol-floors-own", { look3d: "own" });
  const fname = (s) => s.element.querySelectorAll("button").find(b => (b.className || "").includes("la3d-fname"));
  const badge = (b) => (b ? b.children.find(c => c.className === "la3d-fb") || null : null);
  const fb = badge(fname(slot)), fbOwn = badge(fname(own));
  // The floor list (View ▾ / Views ▾): every floor its number.
  const views = slot.element.querySelectorAll("button").find(b => /^Views?\b/.test(b.textContent || ""));
  if (views) views.dispatchEvent({ type: "click", detail: 1, stopPropagation() {}, preventDefault() {} });
  await settle(4);
  const menu = slot.element.querySelectorAll("div").find(d => d.className === "la3d-menu");
  const listed = menu ? menu.querySelectorAll("button").map(b => badge(b)).filter(Boolean).map(b => [b.textContent, b.style.background]) : [];
  const plates = S(slot).look.atlas.plates;
  check("floors: each floor's number in its plate's colour, each plate its line; own: none",
    fb && fb.textContent === "2" && fb.style.background === ISO.LAYER_PAL[1] && fbOwn === null
    && JSON.stringify(listed) === JSON.stringify([["1", ISO.LAYER_PAL[0]], ["2", ISO.LAYER_PAL[1]]])
    && JSON.stringify([...plates].sort()) === JSON.stringify([1, 2]) && S(own).look.atlas === null,
    { fb: fb && [fb.textContent, fb.style.background], listed, plates, menu: !!menu, views: !!views });
  LA.releaseLiveAboardSlot("ol-floors"); LA.releaseLiveAboardSlot("ol-floors-own");
  await settle();
});

// ── readouts ────────────────────────────────────────────────────────────────
await tryCase("readouts: the chip says what the Atlas says, the air in its room sheet's words", async () => {
  const slot = await view("ol-read", { look3d: "atlas", atlasLook: AT("hygge") });
  const own = await view("ol-read-own", { look3d: "own" });
  const chip = S(slot).chips.find(c => c.room === "Den"), chipOwn = S(own).chips.find(c => c.room === "Den");
  const recs = S(slot).readouts;
  const word = (eid) => LM.stateWordOf(LBE[eid]).text;
  const air = `Air ${LC.airQualityWord(LC.airQualityBadness(LBE["sensor.den_air"]))}`;
  const temp = recs.find(r => r.eid === "sensor.den_temp"), hum = recs.find(r => r.eid === "sensor.den_humidity");
  check("readouts: the chip says what the Atlas says, the air in its room sheet's words",
    chip && chip.text === `${word("sensor.den_temp")} · ${word("sensor.den_humidity")} · ${air}`
    && chip.text === "21.5° · 45% · Air Moderate" && chipOwn.text === `21.5° · 45% · Air: ${word("sensor.den_air")}`
    // The Atlas's colours for each reading: the temperature's band ink, humidity's border.
    && temp.color === HOUSE.TEMP_TINT[HOUSE.tempBand(21.5)].ink && hum.color === LC.HUMIDITY_BORDER,
    { chip, chipOwn, air, temp, hum });
  LA.releaseLiveAboardSlot("ol-read"); LA.releaseLiveAboardSlot("ol-read-own");
  await settle();
});

// ── safety ──────────────────────────────────────────────────────────────────
await tryCase("safety: covering the panel, the Vacation banner and the emergency dial rise above it", async () => {
  const slot = await view("ol-cover", { look3d: "atlas", atlasLook: AT("hygge") });
  const cssOf = () => slot.element.querySelectorAll("style").map(s => s.textContent).join("\n");
  const before = cssOf();
  const cv = slot.element.querySelector("canvas");
  const ev = (type, x, y, extra = {}) => ({ type, button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, deltaMode: 0,
    stopPropagation() {}, preventDefault() {}, composedPath: () => [], ...extra });
  for (let i = 0; i < 3; i++) cv.dispatchEvent(ev("wheel", 400, 300, { deltaY: -160 }));
  await settle();
  const st = S(slot).screen, during = cssOf(), z = Number(slot.element.style.zIndex);
  const vac = /\.lv-vacation\{z-index:(\d+)\}/.exec(during), emerg = /\.lv-emerg\{position:fixed;z-index:(\d+);top:\d+px;right:\d+px\}/.exec(during);
  // Out again (Escape): back as it was.
  for (const fn of [...(lists.window.keydown || [])]) fn({ type: "keydown", key: "Escape" });
  await settle();
  const after = cssOf();
  check("safety: covering the panel, the Vacation banner and the emergency dial rise above it",
    st.cover && z === 45 && vac && emerg && Number(vac[1]) > z && Number(emerg[1]) > z
    && !/lv-vacation\{z-index/.test(before) && !/lv-emerg\{position:fixed/.test(before)
    && !S(slot).screen.cover && !/lv-vacation\{z-index/.test(after) && !/lv-emerg\{position:fixed/.test(after),
    { st, z, vac: vac && vac[0], emerg: emerg && emerg[0], after: S(slot).screen.cover });
  LA.releaseLiveAboardSlot("ol-cover");
  await settle();
});

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
