// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Showcase's West Coast Forest (iso_lights.js SHOWCASE_THEMES.west_coast_forest,
// views/atlas_forest.js drawn from views/lights_map.js), under the DOM shim.
//
//   off      every other theme: the drawing as it was, nothing in the stage;
//            the ground left out only when the card's own forest asks, and only
//            with Showcase on
//   clear    on the fixture house, the estate and (given a path) a real house's
//            dump: no tree, fern, log or rock on the house or in the margin, and
//            nothing in front of the house rises into it
//   same     the same house, the same forest; another house, another forest;
//            a floor or a spacing only takes away or shortens what meets the house
//   layer    the plates are cut out one by one, and nothing is drawn after it
//   keep     through polls of the kept card: the same box, first in the same
//            stage, never painted again; spacing and zoom paint it again
//   light    the Light theme's sum undoes itself, and no CSS filter is used
//
// usage: atlas_forest.mjs <www/padspan-ha dir> [dump model_get.json]
// prints one JSON line: { cases: {name: result}, failures: [...], counts: {...} }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush, timerQueue } from "./dom_shim.mjs";

const WWW = process.argv[2], DUMP = process.argv[3] || "";
if (!WWW) { console.error("usage: atlas_forest.mjs <www/padspan-ha dir> [dump]"); process.exit(2); }
install(globalThis);

const failures = [], cases = {}, counts = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };

const proto = Object.getPrototypeOf(document.createElement("div"));
const up = (n) => { while (n.parentNode) n = n.parentNode; return n; };
Object.defineProperty(proto, "isConnected", { configurable: true, get() { const t = up(this); return t === document || t._screen === true; } });
proto.getRootNode = function () { return up(this); };
const _remove = proto.removeChild;
proto.removeChild = function (c) { const r = _remove.call(this, c); if (c && this.children.indexOf(c) < 0 && c.parentNode === this) c.parentNode = null; return r; };
if (!proto.remove) proto.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
const screen = () => { const s = document.createElement("#screen"); s._screen = true; s.activeElement = null; return s; };

const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const ISO = await import(url("views", "iso_lights.js"));
const LM = await import(url("views", "lights_map.js"));
const WX = await import(url("views", "atlas_weather.js"));
const FO = await import(url("views", "atlas_forest.js"));

const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const FLOORS = [{ id: "base", name: "Basement", level: -1 }, { id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }, { id: "outside", name: "Outside" }];
const HOUSE = { floors: FLOORS, floor_elevations: { base: -2.7, main: 0, upper: 2.8 }, room_geometry_m: {
  Kitchen: rect("main", 0, 0, 5, 4), Living: rect("main", 5.1, 0, 11, 6), Deck: rect("main", 11.2, 0, 15, 6), Office: rect("upper", 0, 0, 5, 5), Rec: rect("base", 0, 0, 8, 10),
  Shed: rect("__outside__", 40, 40, 44, 44), Drive: rect("__outside__", -20, 8, -12, 24) }, light_positions_m: {}, rf_barriers_m: [] };
const OTHER = { ...HOUSE, room_geometry_m: { ...HOUSE.room_geometry_m, Kitchen: rect("main", 0, 0, 6, 4) } };
const SVG = (m, gap = 150, hg = 0, floors = m.floors, opts = {}) => ISO.buildIsoSVG(m, {}, new Set(), null, gap, hg, {}, false, floors, { showcase: true, showcaseTheme: FO.FOREST_THEME, ...opts });
const geoOf = (m, gap = 150, hg = 0, floors = m.floors) => {
  const fr = ISO.fabricFrame(m, floors, gap, hg);
  return FO.forestKeepOut(SVG(m, gap, hg, floors), WX.outdoorPlateLevels(fr, ISO.isOutdoorFloorId), WX.plateOffsets(fr));
};
const areaOf = (ko) => { const [x, y, w, h] = ko.viewBox; return { x0: x, y0: y, x1: x + w, y1: y + h }; };
const planOf = (m, gap, hg, floors) => { const ko = geoOf(m, gap, hg, floors); return { ko, plan: FO.forestPlan(areaOf(ko), ko.polys, FO.forestSeed(m)) }; };

/** Everything in a plan keeps clear of the house, as the module promises. */
function clearOf(plan, polys){
  const sh = FO.houseShape(polys), bad = [];
  for (const t of plan.items) {
    const m = t.k === "fern" || t.k === "salal" ? FO.FOREST_MARGIN * 0.5 : FO.FOREST_MARGIN;
    if (t.k === "log") {
      for (const u of [-1, 0, 1]) {
        const x = t.x + Math.cos(t.a) * t.w / 2 * u, y = t.y + Math.sin(t.a) * t.w / 2 * u;
        if (sh.near(x, y, m - 0.01)) bad.push([t.k, x, y]);
      }
      continue;
    }
    if (sh.near(t.x, t.y, m - 0.01)) bad.push([t.k, t.x, t.y, "on the margin"]);
    if (t.k === "tree") {
      // Rising into the house from in front: an edge above its foot, in its own column, below its top.
      for (const cx of [t.x - Math.min(t.w / 2, 26) * 0.5, t.x, t.x + Math.min(t.w / 2, 26) * 0.5]) {
        if (sh.inside(cx, t.y)) continue;
        const b = sh.under(cx, t.y);
        if (b > -Infinity && t.y - t.h < b) bad.push(["tree", t.x, t.y, "top", t.y - t.h, "house", b]);
      }
    }
  }
  return bad;
}

// ── off ─────────────────────────────────────────────────────────────────────
await tryCase("off: every other theme draws as it did", async () => {
  const ground = (s) => /<svg[^>]*>\s*<rect[^>]*>/.exec(s)[0];
  const bad = [];
  for (const k of Object.keys(ISO.SHOWCASE_THEMES)) {
    const a = ISO.buildIsoSVG(HOUSE, {}, new Set(), null, 150, 0, {}, false, FLOORS, { showcase: true, showcaseTheme: k });
    if (/fill-opacity="0"\/>/.test(ground(a))) bad.push(k);
  }
  const on = ISO.buildIsoSVG(HOUSE, {}, new Set(), null, 150, 0, {}, false, FLOORS, { showcase: true, showcaseTheme: FO.FOREST_THEME, outsideBehind: true });
  const noShow = ISO.buildIsoSVG(HOUSE, {}, new Set(), null, 150, 0, {}, false, FLOORS, { showcase: false, showcaseTheme: FO.FOREST_THEME, outsideBehind: true });
  const plain = ISO.buildIsoSVG(HOUSE, {}, new Set(), null, 150, 0, {}, false, FLOORS, { showcase: false, showcaseTheme: FO.FOREST_THEME });
  check("off: every other theme draws as it did",
    !bad.length && /fill-opacity="0"\/>/.test(ground(on)) && noShow === plain && ISO.SHOWCASE_THEMES[FO.FOREST_THEME].label === "West Coast Forest",
    { bad, on: ground(on), same: noShow === plain });
});

// ── the card ────────────────────────────────────────────────────────────────
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
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
const VIEW = { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 };
const RAIN = { settings: { atlas_weather_enabled: true }, slot: "t", states: { "weather.home": { state: "rainy", attributes: { temperature: 12 } } }, entities: {}, telemetry: () => {} };
const hostOf = (extra = {}) => { const h = { el, floors: FLOORS, model: HOUSE, byRoom: {}, hiddenEids: new Set(), lightsByEid: {}, lightsLoading: false, tier: "pro", layoutV2: true, displayMode: true,
  view: VIEW, saveView: async () => {}, onHexesBuilt() {}, weather: RAIN, screen: { slot: "t", shownAt: 1 }, showcase: true, showcaseTheme: FO.FOREST_THEME, patchSvg: true, render() {}, ...extra };
  return h; };
const stageIn = (card) => card._all ? card._all().find(n => n.className === "lv-stage") : null;
const settle = async () => { await flush(20); await new Promise(r => globalThis._realSetTimeout(r, 0)); await flush(20); };
// The shim holds timers back: run what is waiting (a repaint "a moment later").
const timers = async () => { for (const q of timerQueue.splice(0)) { try { (q.fn || q)(); } catch (_) { /* not this test's */ } } await settle(); };

await tryCase("off: another theme, or below Pro: no box, nothing fetched", async () => {
  const slot = FO.atlasForestSlot("t2");
  const scr = screen(), card = LM.buildLightsMapCard(hostOf({ showcaseTheme: "hygge", weather: { ...RAIN, slot: "t2" }, screen: { slot: "t2", shownAt: 1 } }));
  scr.appendChild(card);
  await settle();
  const st = stageIn(card), hy = !!st && st.children.every(c => c.className !== "lv-forest") && !/fill-opacity="0"\/>/.test(st.firstChild && st.firstChild._html || "");
  const cardFree = LM.buildLightsMapCard(hostOf({ tier: "free", weather: { ...RAIN, slot: "t2" }, screen: { slot: "t2", shownAt: 1 } }));
  scr.appendChild(cardFree);
  await settle();
  const sf = stageIn(cardFree), free = !!sf && sf.children.every(c => c.className !== "lv-forest");
  check("off: another theme, or below Pro: no box, nothing fetched", hy && free && !slot.element, { hy, free, el: !!slot.element });
});

await tryCase("keep: polls paint nothing and the box stays first in its stage", async () => {
  const keep = {}, scr = screen();
  const hostK = (over = {}) => hostOf({ keepCard: keep, ...over });
  // The shim parses no drawing: a stand-in with the shim's one fixed rect.
  const drawn = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const qs = proto.querySelector;
  proto.querySelector = function (q) { return q === "svg" && this.className === "lv-stage" ? drawn : qs.call(this, q); };
  let card = LM.buildLightsMapCard(hostK());
  scr.appendChild(card);
  await settle();
  card = LM.buildLightsMapCard(hostK());        // the import has landed: the card redraws
  if (card.parentNode !== scr) scr.appendChild(card);
  await settle();
  const slot = FO.atlasForestSlot("t"), st = stageIn(card), cv = st && st.firstChild;
  await timers();
  const started = slot._state(), firstIs = !!cv && cv.className === "lv-forest", n0 = started.paints;
  let same = true;
  for (let i = 0; i < 6; i++) {
    const c = LM.buildLightsMapCard(hostK({ lightsByEid: {}, states: { tick: i } }));
    if (c !== card) same = false;
    if (stageIn(c).firstChild !== cv) same = false;
    await settle();
  }
  const after = slot._state();
  check("keep: polls paint nothing and the box stays first in its stage",
    firstIs && n0 >= 1 && after.paints === n0 && same,
    { firstIs, n0, after: after.paints, same, kids: st.children.map(c => c.className || c.localName) });
  // Another spacing is another drawing: painted again.
  VIEW.floorGap = 260;
  LM.buildLightsMapCard(hostK());
  await settle();
  await new Promise(r => globalThis._realSetTimeout(r, 600));
  await timers();
  const moved = slot._state().paints;
  VIEW.floorGap = 150;
  proto.querySelector = qs;
  check("keep: a new spacing paints again", moved > after.paints, { moved, before: after.paints });
});

// ── clear ───────────────────────────────────────────────────────────────────
const houses = [["fixture", HOUSE, FLOORS]];
try {
  const SH = await import(url("sample_house.js"));
  const q = new URLSearchParams("");
  const fx = SH.estateFixture ? SH.estateFixture(q) : null;
  if (fx && fx.MODEL) houses.push(["estate", fx.MODEL, fx.MODEL.floors]);
} catch (e) { failures.push({ name: "clear: the estate loads", detail: String(e).slice(0, 300) }); }
if (DUMP) { const m = JSON.parse(readFileSync(DUMP, "utf8")); houses.push(["dump", m, m.floors]); }
for (const [name, m, floors] of houses) {
  await tryCase(`clear: ${name}`, async () => {
    const bad = [];
    for (const [gap, hg] of [[150, 0], [260, 0], [80, 0], [150, 60]]) {
      const { ko, plan } = planOf(m, gap, hg, floors);
      counts[`${name}:${gap}:${hg}`] = { trees: plan.items.filter(i => i.k === "tree").length, all: plan.items.length, polys: ko.polys.length };
      bad.push(...clearOf(plan, ko.polys));
    }
    check(`clear: ${name}`, !bad.length && counts[`${name}:150:0`].trees > 20, { bad: bad.slice(0, 5), n: bad.length, counts: counts[`${name}:150:0`] });
  });
}

// ── same ────────────────────────────────────────────────────────────────────
await tryCase("same: the same house, the same forest", async () => {
  const a = planOf(HOUSE).plan, b = planOf(JSON.parse(JSON.stringify(HOUSE))).plan, c = planOf(OTHER).plan;
  const key = (p) => JSON.stringify(p.items);
  // The rooms' names are not the shape.
  const renamed = { ...HOUSE, room_geometry_m: Object.fromEntries(Object.entries(HOUSE.room_geometry_m).map(([k, v]) => [`Room ${k}`, v])) };
  // Another spacing: a tree that stands in both stands in the same place.
  const wide = planOf(HOUSE, 260).plan, at = new Map(a.items.filter(i => i.k === "tree").map(i => [`${i.x}|${i.y}`, i]));
  const shared = wide.items.filter(i => i.k === "tree" && at.has(`${i.x}|${i.y}`)).length;
  check("same: the same house, the same forest",
    key(a) === key(b) && key(a) !== key(c) && FO.forestSeed(HOUSE) === FO.forestSeed(renamed) && FO.forestSeed(HOUSE) !== FO.forestSeed(OTHER) && shared > 20,
    { same: key(a) === key(b), other: key(a) !== key(c), shared });
});

// ── layer ───────────────────────────────────────────────────────────────────
await tryCase("layer: each plate is cut out on its own, and nothing but the picture is touched", async () => {
  const ko = geoOf(HOUSE), plan = FO.forestPlan(areaOf(ko), ko.polys, 7);
  const log = [];
  const g = new Proxy({ globalCompositeOperation: "source-over" }, {
    get: (t, k) => (k in t ? t[k] : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : (...a) => { log.push([String(k), t.globalCompositeOperation]); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const sprite = { width: 4, height: 4 };
  const spr = { tree: { fir: [sprite, sprite, sprite], cedar: [sprite, sprite, sprite], hemlock: [sprite, sprite, sprite] }, fern: [sprite, sprite, sprite], salal: [sprite, sprite], log: [sprite, sprite], rock: [sprite, sprite], mist: sprite, moss: sprite, duff: sprite };
  FO.drawForest(g, plan, spr);
  const fills = log.filter(l => l[0] === "fill" && l[1] === "destination-out").length;
  const notBack = log.filter(l => l[0] === "drawImage" && l[1] !== "source-over").length;
  check("layer: each plate is cut out on its own, and nothing but the picture is touched",
    fills === ko.polys.length && notBack === 0 && g.globalCompositeOperation === "source-over", { fills, polys: ko.polys.length, notBack });
});

// ── light ───────────────────────────────────────────────────────────────────
await tryCase("light: the Light theme's sum undoes itself", async () => {
  const d = new Uint8ClampedArray([8, 20, 14, 255, 40, 60, 50, 128, 0, 0, 0, 0]), want = [...d];
  FO.negativePixels(d);
  const changed = d[0] !== want[0];
  FO.negativePixels(d);
  check("light: the Light theme's sum undoes itself", changed && want.every((v, i) => Math.abs(d[i] - v) <= 3) && d[3] === 255 && d[7] === 128,
    { d: [...d], want });
});

console.log(JSON.stringify({ cases, failures, counts }));
process.exit(failures.length ? 1 : 0);
