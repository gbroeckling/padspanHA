// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Mapping → Edit's tool row and stage (views/maps.js), run: the lit tool and
// its hint follow the tool in use, Measure shows only its own panel, a wizard
// step opens on its own tool, a view with one tool prints no layout as text,
// and names sit over the stage rather than stretched inside its SVG.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS_DIR = process.argv[2];
install(globalThis);

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

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
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

const PLAN = () => ({
  id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 1200 },
  receivers: [{ id: "rx1", label: "Hall", x: 0.5, y: 0.5, room: "Kitchen" }],
  room_bounds: { Kitchen: { type: "poly", points: [[0.9, 0.1], [1, 0.1], [1, 0.3], [0.9, 0.3]] } },
});

function makeCtx(complexity) {
  const state = {
    complexity, mapsTab: "edit", settings: {}, dataMode: "live", _dataModeKnown: true, view: "maps", activeMapId: "m1",
    maps: { list: [PLAN()] },
    model: { floors: [{ id: "main", name: "Main", level: 0 }], map_transforms: {}, areas: [{ name: "Kitchen", floor_id: "main" }] },
  };
  return {
    state,
    hass: { states: {}, user: { is_admin: true } },
    helpers: new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), roomColor: () => "#52b788",
      mapImageUrl: () => "/x.png", pill: (t) => el("span", {}, String(t ?? "")) },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy({ renderRooms: () => {}, wsCall: async () => ({}), callWS: async () => ({}), mapsSetActive: () => {} },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: () => {},
  };
}

function walk(node, visit) { visit(node); for (const c of node.childNodes || []) walk(c, visit); }
function all(node, pred) { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; }
const textOf = (n) => (n.textContent || "").trim();
const tools = (root) => all(root, (n) => n.getAttribute && n.getAttribute("data-edit-tool"));
const lit = (root) => tools(root).filter((b) => b.classList.contains("primary")).map((b) => b.getAttribute("data-edit-tool"));
const tool = (root, t) => tools(root).find((b) => b.getAttribute("data-edit-tool") === t);
const labels = (root) => all(root, (n) => n.classList && n.classList.contains("maplabel"));

const maps = await import(pathToFileURL(join(VIEWS_DIR, "maps.js")).href);

// ── Edit's tool row ──────────────────────────────────────────────────────────
{
  const ctx = makeCtx("advanced");
  const root = maps.render(ctx); await flush();
  check("a plan opens on Radios, lit", JSON.stringify(lit(root)) === '["receivers"]' && ctx.state.maps._mode === "receivers", lit(root));
  for (const [t, hint] of [["rooms", "Click map to add points"], ["barriers", "Click to draw wall"], ["measure", "Click two points"], ["receivers", "Double-click map to place receiver"]]) {  // "radio" → "receiver" (review 2026-11-11, C7)
    tool(root, t).click();
    await flush();
    check(`${t}: lit, and the only one`, JSON.stringify(lit(root)) === JSON.stringify([t]) && ctx.state.maps._mode === t, lit(root));
    check(`${t}: its hint`, textOf(root).includes(hint), textOf(root).slice(0, 300));
  }
  // Review 2026-11-11 (C7): the tool a person reads is "Receivers" (it said Radios), and its list "Live BLE Receivers".
  check("the receivers tool reads Receivers, its list Live BLE Receivers", tool(root, "receivers").textContent === "Receivers"
    && !/\bRadios?\b/.test(textOf(root)) && /Live BLE Receivers|No live BLE receivers|see your BLE receivers/.test(textOf(root)), textOf(root).slice(0, 400));
  tool(root, "barriers").click(); await flush();
  check("Signal walls lit loses its tint, which would hide the highlight", !tool(root, "barriers").getAttribute("style"), tool(root, "barriers").getAttribute("style"));
  check("Measure, not lit, keeps its tint", /background/.test(tool(root, "measure").getAttribute("style") || ""), tool(root, "measure").getAttribute("style"));

  tool(root, "measure").click(); await flush();
  const m = textOf(root);
  check("Measure shows its own panel", /Reference Distance Calibration/.test(m), m.slice(0, 300));
  check("Measure does not show the Rooms tool", !/Room boundary tools|Polygon layers|Start drawing|Choose room/.test(m), m.slice(0, 600));
  check("Measure does not show Suggest Placement", !/Suggest Placement/.test(m), m.slice(0, 300));
  tool(root, "rooms").click(); await flush();
  check("Rooms still shows the Rooms tool", /Room boundary tools/.test(textOf(root)), textOf(root).slice(0, 300));
}

// ── a wizard step opens on its own tool, on a plan not yet open ──────────────
for (const [complexity, step, want] of [["advanced", 2, "measure"], ["advanced", 3, "rooms"], ["advanced", 4, "receivers"], ["basic", 2, "measure"]]) {
  const ctx = makeCtx(complexity);
  ctx.state._mapsWizard = { step, mapId: "m1" };
  // 2026-11-13 (D1): step 2 is Edit → Measure on a plan that has a scale (measuring it again); a plan with none gets the
  // one-length screen instead (tests/js/scale_nudge.mjs).
  if (step === 2) ctx.state.model.map_transforms = { m1: { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 10 } };
  const root = maps.render(ctx); await flush();
  check(`${complexity} wizard step ${step} opens on ${want}`, ctx.state.maps._mode === want && JSON.stringify(lit(root)) === JSON.stringify([want]), [ctx.state.maps._mode, lit(root)]);
}

// ── the layout as text: the full editor only ─────────────────────────────────
{
  const adv = maps.render(makeCtx("advanced")); await flush();
  check("Advanced's Edit keeps the layout as text", /Room bounds:/.test(textOf(adv)), textOf(adv).slice(-200));
  const ctx = makeCtx("basic");
  ctx.state._mapsWizard = { step: 3, mapId: "m1" };
  const wiz = maps.render(ctx); await flush();
  check("a Basic wizard step has none", !/Room bounds:/.test(textOf(wiz)), textOf(wiz).slice(-200));
}

// ── names on the stage ───────────────────────────────────────────────────────
{
  const ctx = makeCtx("advanced");
  const root = maps.render(ctx); await flush();
  check("no name inside the stage's stretched SVG", !all(root, (n) => n.localName === "text").length, null);
  const k = labels(root).filter((n) => textOf(n) === "Kitchen");
  check("the room's name is over the stage, once", k.length === 1, k.length);
  const style = (k[0] && k[0].getAttribute("style")) || "";
  check("at the room's middle as a fraction, shifted to stay on the stage", /left:95%;top:20%;transform:translate\(-95%,-20%\)/.test(style), style);
  tool(root, "rooms").click(); await flush();
  check("a redraw does not leave a second copy", labels(root).filter((n) => textOf(n) === "Kitchen").length === 1, labels(root).length);
}

// ── a wall's name: only in the tool that works on walls ──────────────────────
{
  const ctx = makeCtx("advanced");
  ctx.state.model.map_transforms = { m1: { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 10 } };
  ctx.state.model.rf_barriers_m = [{ id: "w1", floor_id: "main", material: "metal", attenuation_dbm: 12, points_m: [[2, 2], [6, 2]] }];
  const root = maps.render(ctx); await flush();
  const wallNames = () => labels(root).filter((n) => textOf(n) === "metal (12dB)").length;
  const wallLines = () => all(root, (n) => n.localName === "polyline").length;
  check("Radios: the wall is drawn, with no name", wallLines() === 1 && wallNames() === 0, [wallLines(), wallNames()]);
  for (const [t, names] of [["barriers", 1], ["rooms", 0], ["measure", 0], ["barriers", 1], ["receivers", 0]]) {
    tool(root, t).click(); await flush();
    check(`${t}: wall name ${names ? "shown" : "hidden"}, wall still drawn, room name kept`,
      wallNames() === names && wallLines() === 1 && labels(root).some((n) => textOf(n) === "Kitchen"), [wallNames(), wallLines(), labels(root).map(textOf)]);
  }
}

// Review 2026-11-11 (item 9): a tool button asks for Setup's bar again (panel.js setupBar draws setup.js returnBar in
// place), and the bar then names the step of the tool chosen: Measure the scale, Rooms the rooms.
{
  const SETUP = await import(pathToFileURL(join(VIEWS_DIR, "setup.js")).href);
  const ctx = makeCtx("advanced");
  ctx.state._setupReturn = "receivers";
  const bars = [];
  ctx.actions.setupBar = () => { const b = SETUP.returnBar(ctx); bars.push(b ? b.textContent : null); };
  const root = maps.render(ctx); await flush();
  tool(root, "measure").click(); await flush();
  const m = bars[bars.length - 1];
  tool(root, "rooms").click(); await flush();
  const r = bars[bars.length - 1];
  check("setup bar: a tool chosen draws it again, naming that tool's step", /Set the scale/.test(m || "") && /Draw the rooms/.test(r || ""), [m, r]);
}

console.log(JSON.stringify(results));
