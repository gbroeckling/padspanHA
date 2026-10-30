// The sidebar Atlas's poll redraw, patched (lights_map.js drawStageSvg), run for real:
//   split     svgParts: the drawing's own markup, part for part, and back
//   patch     buildLightsMapCard with host.patchSvg: a new card per tick, as
//             the sidebar's poll makes one; the last <svg> moves in and only
//             the parts whose markup changed are replaced, and the markup is
//             what a full rebuild makes
//   rebuild   another floor, another map, a setting, a stage already in use:
//             a new <svg>, as before
//   wiring    wireUseSurface on a drawing kept across ticks: one listener each
//
// The DOM shim does not parse markup, so here innerHTML parses one level: a
// stage's <svg> and its top-level parts, each part a leaf that keeps its own
// markup. That is all drawStageSvg touches.
//
// usage: atlas_svg_patch.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, timerQueue } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_svg_patch.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const ISO = await import(pathToFileURL(join(WWW, "views", "iso_lights.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = (name, fn) => { try { fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };

// ── one level of parsing ─────────────────────────────────────────────────────
const SVG_NS = "http://www.w3.org/2000/svg";
const proto = Object.getPrototypeOf(document.createElement("div"));
const html = Object.getOwnPropertyDescriptor(proto, "innerHTML");
const leaf = (markup) => { const n = document.createElementNS(SVG_NS, "part"); n._leaf = markup; return n; };
Object.defineProperty(proto, "innerHTML", {
  configurable: true,
  get() { return html.get.call(this); },
  set(v) {
    html.set.call(this, v);
    const s = String(v ?? "");
    if (!s) return;
    if (s.startsWith("<svg")) {
      const p = LM.svgParts(s);
      if (!p) throw new Error("the drawing did not split");
      const svg = document.createElementNS(SVG_NS, "svg");
      svg._open = p.open;
      for (const k of p.kids) svg.appendChild(leaf(k));
      this.appendChild(svg);
    } else {
      const p = LM.svgParts(`<svg>${s}</svg>`);
      for (const k of p.kids) this.appendChild(leaf(k));
    }
  },
});
// The stage's drawing as markup, from its nodes (parts the layer above adds
// to the drawing itself, not from markup, are not parts: skipped).
const markupOf = (svg) => svg._open + svg.childNodes.filter(n => n._leaf !== undefined).map(n => n._leaf).join("") + "</svg>";

// ── the house ────────────────────────────────────────────────────────────────
const NOW = Date.UTC(2026, 9, 30, 12);
const S = (state, attributes) => ({ state, attributes, last_changed: new Date(NOW - 3600e3).toISOString(), last_updated: new Date(NOW - 3600e3).toISOString() });
const STATES = {
  "light.kitchen":   S("on",  { friendly_name: "Kitchen pots", brightness: 200 }),
  "light.hall":      S("off", { friendly_name: "Hall light" }),
  "light.den":       S("off", { friendly_name: "Den lamp" }),
  "light.office":    S("on",  { friendly_name: "Office light", brightness: 120 }),
  "binary_sensor.den_motion": S("off", { device_class: "motion", friendly_name: "Den motion" }),
};
const AREAS = { "light.kitchen": "Kitchen", "light.hall": "Hall", "light.den": "Den", "light.office": "Office", "binary_sensor.den_motion": "Den" };
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const mkModel = () => ({
  floors: [{ id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }],
  room_geometry_m: { Kitchen: rect("main", 0, 0, 6, 4), Hall: rect("main", 6, 0, 10, 4), Den: rect("main", 0, 4.1, 10, 8), Office: rect("upper", 0, 0, 10, 8) },
  rf_barriers_m: [{ id: "w1", name: "Kitchen window", material: "glass", floor_id: "main", points_m: [[0, 1], [0, 2]] }],
  light_positions_m: {
    "light.kitchen": { x_m: 3, y_m: 2, floor_id: "main" }, "light.hall": { x_m: 8, y_m: 2, floor_id: "main" },
    "light.den": { x_m: 2, y_m: 6, floor_id: "main" }, "light.office": { x_m: 5, y_m: 4, floor_id: "upper" },
    "binary_sensor.den_motion": { x_m: 8, y_m: 6, floor_id: "main" },
  },
});
const MODEL = mkModel();
const lightsOf = (states) => {
  const all = LM.gatherLights(states, AREAS, undefined, "pro", undefined, undefined, undefined, undefined, NOW);
  const byEid = Object.fromEntries(all.map(l => [l.entity_id, l]));
  const byRoom = {};
  for (const l of all) if (l.area_name) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);
  return { byEid, byRoom };
};
const flip = (eid) => ({ ...STATES, [eid]: S(STATES[eid].state === "on" ? "off" : "on", STATES[eid].attributes) });

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
// One poll's card, as the sidebar builds it: a new card, the same view.
function card(view, { states = STATES, model = MODEL, patch = true, ...extra } = {}) {
  const L = lightsOf(states);
  const host = { el, view, floors: model.floors, model, byRoom: L.byRoom, hiddenEids: new Set(), lightsByEid: L.byEid, lightsLoading: false,
    tier: "pro", layoutV2: true, displayMode: true, codeChip: true, hitHalo: true, saveView: async () => {}, onHexesBuilt() {},
    patchSvg: patch, ...extra };
  const c = LM.buildLightsMapCard(host);
  const stage = c._all().find(n => n.className === "lv-stage");
  const svg = stage && stage.childNodes.find(n => n.localName === "svg");
  return { stage, svg, parts: svg ? svg.childNodes.filter(n => n._leaf !== undefined) : [] };
}
// The markup a full rebuild makes for the same inputs (no patching, a view of its own).
const fullMarkup = (view, opts = {}) => card({ ...view }, { ...opts, patch: false }).stage.innerHTML;
const newView = () => ({ floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 });

// ── split ────────────────────────────────────────────────────────────────────
tryCase("split: the drawing, part for part, and back", () => {
  const L = lightsOf(STATES);
  const s = ISO.buildIsoSVG(MODEL, L.byRoom, new Set(), null, 150, 0, L.byEid, false, MODEL.floors, { codeChip: true, hitHalo: true });
  const p = LM.svgParts(s);
  check("split: the drawing, part for part, and back", p && p.open + p.kids.join("") + p.close === s && p.kids.length > 20
    && p.kids.some(k => k.startsWith('<g class="lhex"')) && p.kids.some(k => k.startsWith('<g data-role="floorslab"')),
  p ? p.kids.length : null);
});
tryCase("split: quotes, comments, text, and what does not split", () => {
  const s = `<svg viewBox="0 0 1 1"><g title="a > b"><rect/></g><!-- x --><text>a &amp; b</text>tail<rect width='1>'/></svg>`;
  const p = LM.svgParts(s);
  check("split: quotes, comments, text, and what does not split",
    p && JSON.stringify(p.kids) === JSON.stringify([`<g title="a > b"><rect/></g>`, "<!-- x -->", "<text>a &amp; b</text>", "tail", `<rect width='1>'/>`])
    && LM.svgParts("<svg><g></svg>") === null && LM.svgParts("<div></div>") === null && LM.svgParts("<svg/>") === null
    && LM.svgParts(`<svg><g></g></g></svg>`) === null, p && p.kids);
});

// ── patch ────────────────────────────────────────────────────────────────────
tryCase("patch: one light switched, one marker's parts replaced", () => {
  const view = newView();
  const a = card(view);
  const before = new Set(a.parts);
  const statics = a.parts.filter(n => /^<(g data-role="floorslab"|g class="lroom"|g class="lfloor"|defs|polygon)/.test(n._leaf));
  const b = card(view, { states: flip("light.hall") });
  const replaced = b.parts.filter(n => !before.has(n));
  const want = fullMarkup(view, { states: flip("light.hall") });
  check("patch: one light switched, one marker's parts replaced",
    b.svg === a.svg && b.stage !== a.stage && markupOf(b.svg) === want
    && replaced.length > 0 && replaced.length <= 4 && replaced.every(n => n._leaf.includes("light.hall") || !n._leaf.includes("data-eid"))
    && statics.length > 8 && statics.every(n => n.parentNode === b.svg),
  { replaced: replaced.map(n => n._leaf.slice(0, 60)), same: b.svg === a.svg, equal: markupOf(b.svg) === want, statics: statics.length });
});
tryCase("patch: the same tick again replaces nothing", () => {
  const view = newView();
  const a = card(view);
  const before = new Set(a.parts);
  const b = card(view);
  check("patch: the same tick again replaces nothing",
    b.svg === a.svg && b.parts.every(n => before.has(n)) && b.parts.length === a.parts.length
    && markupOf(b.svg) === fullMarkup(view));
});
tryCase("patch: lights on and off over many ticks, always the full rebuild's markup", () => {
  const view = newView();
  let states = STATES, ok = true, a = card(view);
  const svg = a.svg;
  for (const eid of ["light.hall", "light.den", "light.kitchen", "light.hall", "binary_sensor.den_motion", "light.den"]) {
    states = { ...states, [eid]: S(states[eid].state === "on" ? "off" : "on", states[eid].attributes) };
    a = card(view, { states });
    ok = ok && a.svg === svg && markupOf(a.svg) === fullMarkup(view, { states });
  }
  check("patch: lights on and off over many ticks, always the full rebuild's markup", ok);
});
tryCase("patch: parts laid in the drawing from outside stay where they were", () => {
  const view = newView();
  const a = card(view);
  // atlas_aboard.js lays its people layer in the drawing itself, just under a floor's plate.
  const slab = a.parts.find(n => n._leaf.startsWith('<g data-role="floorslab" data-z="1"'));
  const live = document.createElementNS(SVG_NS, "g");
  live.setAttribute("data-live", "");
  a.svg.insertBefore(live, slab);
  const b = card(view, { states: flip("light.office") });
  const kids = b.svg.childNodes, i = kids.indexOf(live);
  check("patch: parts laid in the drawing from outside stay where they were",
    b.svg === a.svg && i >= 0 && kids[i + 1] && /^<g data-role="floorslab" data-z="1"/.test(kids[i + 1]._leaf || "")
    && markupOf(b.svg) === fullMarkup(view, { states: flip("light.office") }), i);
});

tryCase("patch: anything else left in the drawing goes", () => {
  const view = newView();
  const a = card(view);
  // A press ring (pressRing) a hold left when the poll cut it short.
  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("class", "lpress");
  a.svg.appendChild(ring);
  const live = document.createElementNS(SVG_NS, "g");
  live.setAttribute("data-live", "");
  a.svg.appendChild(live);
  const b = card(view);
  check("patch: anything else left in the drawing goes", b.svg === a.svg
    && !b.svg.childNodes.includes(ring) && b.svg.childNodes.includes(live) && markupOf(b.svg) === fullMarkup(view));
});

// ── rebuild ──────────────────────────────────────────────────────────────────
tryCase("rebuild: another floor shown", () => {
  const view = newView();
  const a = card(view);
  view.focusIdx = 1;
  const b = card(view);
  check("rebuild: another floor shown", b.svg !== a.svg && markupOf(b.svg) === fullMarkup(view));
});
tryCase("rebuild: another map (the model read again)", () => {
  const view = newView();
  const a = card(view);
  const m2 = mkModel();
  const b = card(view, { model: m2 });
  m2.room_geometry_m.Hall = rect("main", 6, 0, 11, 4);
  const c = card(view, { model: mkModel() });
  check("rebuild: another map (the model read again)", b.svg !== a.svg && c.svg !== b.svg && markupOf(c.svg) === fullMarkup(view));
});
tryCase("rebuild: zoom, gaps and a setting", () => {
  const view = newView();
  let a = card(view), ok = true;
  for (const step of [() => { view.zoom = 1.5; }, () => { view.floorGap = 120; }, () => {}, () => { view.horizGap = 30; }]) {
    step();
    const b = card(view, { showcase: false });
    ok = ok && markupOf(b.svg) === fullMarkup(view);
    a = b;
  }
  const s1 = card(view), s2 = card(view, { showcase: true }), s3 = card(view, { showcase: true });
  check("rebuild: zoom, gaps and a setting", ok && s2.svg !== s1.svg && s3.svg === s2.svg && markupOf(s3.svg) === fullMarkup(view, { showcase: true }));
});
tryCase("rebuild: the Mapping tab's host (no patchSvg) as before", () => {
  const view = newView();
  const a = card(view, { patch: false }), b = card(view, { patch: false });
  check("rebuild: the Mapping tab's host (no patchSvg) as before", a.svg && b.svg && a.svg !== b.svg && a.stage.innerHTML === b.stage.innerHTML);
});
tryCase("rebuild: a stage already in use, or the drawing still on screen", () => {
  const view = newView();
  const a = card(view);
  const stage = document.createElement("div");
  stage.appendChild(document.createElement("span"));
  const r1 = LM.drawStageSvg(stage, a.stage.innerHTML, view, { text: "x", model: MODEL, floors: MODEL.floors });
  const r0 = LM.drawStageSvg(document.createElement("div"), a.stage.innerHTML, view, { text: "x", model: MODEL, floors: MODEL.floors });
  const kept = stage.childNodes.find(n => n.localName === "svg");
  kept.isConnected = true;
  const r2 = LM.drawStageSvg(document.createElement("div"), a.stage.innerHTML, view, { text: "x", model: MODEL, floors: MODEL.floors });
  check("rebuild: a stage already in use, or the drawing still on screen", r1.full && !r0.full && r0.replaced === 0 && r2.full, { r1, r0, r2 });
});

// ── wiring ───────────────────────────────────────────────────────────────────
tryCase("wiring: a kept marker is wired once, to the newest api", () => {
  const view = newView();
  const a = card(view);
  const L = lightsOf(STATES);
  const api = { lightsByEid: L.byEid, controlsFor: () => true, openRoom() {}, openFloor() {}, toggle() {}, hass: null };
  const hex = () => a.svg.childNodes.find(n => n._leaf && n._leaf.startsWith('<g class="lhex" data-eid="light.kitchen"'));
  // The shim's leaves have no classes: give the kept marker its own, as the browser's parse would.
  const g = hex();
  g.className = "lhex"; g.dataset.eid = "light.kitchen"; g.dataset.cx = "1"; g.dataset.cy = "1";
  LM.wireUseSurface(a.stage, api);
  const n1 = Object.values(g._listeners).reduce((t, l) => t + l.length, 0);
  const b = card(view, { states: flip("light.hall") });
  LM.wireUseSurface(b.stage, api);
  const n2 = Object.values(g._listeners).reduce((t, l) => t + l.length, 0);
  check("wiring: a kept marker is wired once, to the newest api", b.svg === a.svg && hex() === g && n1 > 0 && n2 === n1, { n1, n2 });
});
tryCase("wiring: a hold the poll cut short leaves no timer, ring or dimming", () => {
  const view = newView();
  const a = card(view);
  const L = lightsOf(STATES);
  const api = { lightsByEid: L.byEid, controlsFor: () => true, openRoom() {}, openFloor() {}, toggle() {}, hass: null };
  const g = a.svg.childNodes.find(n => n._leaf && n._leaf.startsWith('<g class="lhex" data-eid="light.kitchen"'));
  g.className = "lhex"; g.dataset.eid = "light.kitchen"; g.dataset.cx = "1"; g.dataset.cy = "1";
  LM.wireUseSurface(a.stage, api);
  const t0 = timerQueue.length;
  g._listeners.pointerdown[0]({ button: 0, pointerType: "touch", clientX: 5, clientY: 5, timeStamp: 0, pointerId: 1, stopPropagation() {} });
  const pending = timerQueue.slice(t0).filter(Boolean);
  pending[0].fn();                                   // the ring shows (PRESS_RING_MS)
  const ring = a.svg.childNodes.find(n => n.getAttribute && n.getAttribute("class") === "lpress");
  g.style.opacity = "0.6";                           // hovered (a touch screen sends no mouseout)
  // The poll lands mid-hold: a new card, the drawing kept, wired again.
  const b = card(view);
  LM.wireUseSurface(b.stage, api);
  check("wiring: a hold the poll cut short leaves no timer, ring or dimming",
    pending.length === 2 && ring && b.svg === a.svg && !b.svg.childNodes.includes(ring)
    && timerQueue.slice(t0, t0 + 2).every(t => t === null) && g.style.opacity === "",
    { pending: pending.length, ring: !!ring, timers: timerQueue.slice(t0, t0 + 2).map(t => !!t), opacity: g.style.opacity });
});

console.log(JSON.stringify({ cases, failures }));
