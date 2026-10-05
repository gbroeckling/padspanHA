// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Live Aboard's shared library in the page (views/live_aboard_library.js).
//
// The rules first, from the fixtures every copy of them runs
// (tests/fixtures/furniture_library/): free text, the details sheet, and the
// searches of the seeded library done here the way the server does them (the
// starter set is searched in the page). Then what the page works out itself:
// colour families, size classes per kind, a sheet prefilled from the builder
// or tidied from an AI's. Then both flows for real, through a fake ctx: the
// library off, unreachable and answering, every filter and sort reaching the
// wire, Fits here, placing, reporting, the terms read-only; and sharing: the
// terms once, the sheet's refusals (a missing detail; a title with a phone
// number, which puts the suggestion back), and a share that carries only the
// recipe's keys and the sheet.
//
// usage: live_aboard_library.mjs <views-dir> <fixtures-dir>
// prints one JSON line: { cases: {name: result}, failures: [...], data: {...} }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install, flush } from "./dom_shim.mjs";

const VIEWS = process.argv[2], FIX = process.argv[3];
if (!VIEWS || !FIX) { console.error("usage: live_aboard_library.mjs <views-dir> <fixtures-dir>"); process.exit(2); }
install(globalThis);

const L = await import(pathToFileURL(join(VIEWS, "live_aboard_library.js")).href);
const T = await import(pathToFileURL(join(VIEWS, "live_aboard_furniture.js")).href);
const fx = (name) => JSON.parse(readFileSync(join(FIX, name), "utf-8"));
const cases = {}, failures = [], data = {};
const check = (name, ok, info) => {
  cases[name] = (cases[name] ?? true) && !!ok;
  if (!ok) failures.push({ name, info: info === undefined ? null : info });
};
const $ = (root, sel) => root.querySelector(sel);
const $$ = (root, sel) => root.querySelectorAll(sel);
const text = (n) => (n ? n.textContent : "");
const change = (sel, v) => { sel.value = v; sel.dispatchEvent({ type: "change" }); };
const typeIn = (inp, v) => { inp.value = v; inp.dispatchEvent({ type: "input" }); };
const settle = async () => { for (let i = 0; i < 4; i++) { await flush(); await new Promise(r => globalThis._realSetTimeout(r, 5)); } };

// ── 1. the lists and patterns, for the Python side to hold equal ─────────────
data.lists = {};
for (const k of ["CATEGORIES", "ROOMS", "STYLES", "MATERIALS", "COLOR_FAMILIES", "SIZE_CLASSES", "BED_SIZES", "FEATURES",
  "FIXTURES", "FORMS", "SORTS", "REASONS", "RECIPE_KEYS", "DETAIL_KEYS", "REQUIRED", "FILTER_KEYS", "WORDS"]) data.lists[k] = L[k];
data.counts = L.COUNTS;
data.text = L.TEXT;
data.secrets = L.SECRETS.map(([w, rx]) => [w, rx.source, rx.flags]);
data.personal = L.PERSONAL.map(([w, rx]) => [w, rx.source, rx.flags]);
data.terms = { version: L.TERMS_VERSION, status: L.TERMS.status, points: L.TERMS.points };
data.fit_margin = L.FIT_MARGIN_M;

// ── 2. the shared fixtures ───────────────────────────────────────────────────
for (const c of fx("freetext.json").cases) {
  const got = L.textProblem(c.text) || null;
  check("freetext", got === c.refused, { text: c.text, got, want: c.refused });
}
{
  const f = fx("details.json");
  for (const c of f.cases) {
    let d;
    if ("whole" in c) d = c.whole;
    else {
      d = {};
      for (const [k, v] of Object.entries(f.details)) if (!c.only || c.only.includes(k)) d[k] = JSON.parse(JSON.stringify(v));
      for (const k of c.drop || []) delete d[k];
      Object.assign(d, JSON.parse(JSON.stringify(c.set || {})));
    }
    const got = L.checkDetails(d, f.kind);
    const ok = c.field === null ? got.details !== null : got.field === c.field && got.problem === c.problem;
    check("details", ok, { name: c.name, got: [got.field, got.problem], want: [c.field, c.problem] });
  }
}
const seedEntries = fx("seed.json").entries.map(e => ({ library_id: e.id, key: e.id,
  recipe: { ...e.recipe, details: e.details }, houses: 1 + e.placed, copies: 1, checked: e.details.checked === true,
  created: e.created }));
for (const q of fx("queries.json").queries) {
  const got = L.searchEntries(seedEntries, q.search);
  const ids = got.entries.map(e => e.library_id.slice("lib_00000000000".length));
  check("search", JSON.stringify(ids) === JSON.stringify(q.ids) && got.total === (q.total ?? q.ids.length),
    { name: q.name, got: ids, total: got.total, want: q.ids });
}

// ── 3. what the page works out ───────────────────────────────────────────────
const COLOURS = { "#ffffff": "white", "#f5f5f5": "white", "#fafafa": "white", "#000000": "black", "#1f1f1f": "black",
  "#222222": "black", "#333333": "grey", "#808080": "grey", "#5b6b7a": "grey", "#f0ece4": "cream", "#fffdd0": "cream",
  "#c8b89a": "beige", "#d9c49a": "beige", "#d8c3a0": "beige", "#bdb76b": "beige", "#6b4a2e": "brown",
  "#7a5230": "brown", "#5a4632": "brown", "#8b4513": "brown", "#a0522d": "brown", "#d2691e": "brown",
  "#ff0000": "red", "#b22222": "red", "#8b0000": "red", "#ffc0cb": "pink", "#ff69b4": "pink", "#ffa500": "orange",
  "#ff8c00": "orange", "#ffd700": "yellow", "#ffff00": "yellow", "#ffff99": "yellow", "#808000": "green",
  "#4f7942": "green", "#228b22": "green", "#008080": "teal", "#40e0d0": "teal", "#87ceeb": "blue", "#0000ff": "blue",
  "#4682b4": "blue", "#800080": "purple", "#4b0082": "purple", "#5B6B7A": "grey", "not a colour": "grey",
  "#c9a227": "yellow", "#b08a63": "brown", "#c9b48f": "beige" };
for (const [hex, want] of Object.entries(COLOURS)) {
  const got = L.colorFamily(hex);
  check("colour", got === want, { hex, got, want });
}
check("colour", Object.values(COLOURS).every(f => L.COLOR_FAMILIES.includes(f)) && new Set(Object.values(COLOURS)).size === 14,
  "the table covers all fourteen families");

const sofa = (w, d, h) => ({ kind: "sofa", params: {}, colors: ["#5b6b7a"], width_m: w, depth_m: d, height_m: h });
for (const [r, want] of [[sofa(2.1, 0.9, 0.82), "medium"], [sofa(0.95, 0.85, 0.8), "small"], [sofa(2.7, 0.95, 0.85), "large"],
  [sofa(3.6, 1.2, 1.0), "extra-large"], [{ kind: "statue", width_m: 0.3, depth_m: 0.3, height_m: 0.5 }, "small"],
  [{ kind: "statue", width_m: 1, depth_m: 1, height_m: 1 }, "large"], [{ kind: "other", width_m: 2, depth_m: 1, height_m: 1 }, "extra-large"]]) {
  const got = L.sizeClass(r, T);
  check("size", got === want, { r, got, want });
}
{   // per kind: the same volume is a large lamp and a small sofa
  const tools = { FURNITURE: { sofa: {}, lamp: {} }, defaultRecipe: (k) => (k === "sofa" ? sofa(2.1, 0.9, 0.82) : { width_m: 0.4, depth_m: 0.4, height_m: 1.6 }) };
  const v = { width_m: 0.5, depth_m: 0.5, height_m: 1.8 };
  check("size", L.sizeClass({ ...v, kind: "lamp" }, tools) === "large" && L.sizeClass({ ...v, kind: "sofa" }, tools) === "small",
    "a large lamp isn't a large sofa");
}

{   // a sheet prefilled from the builder
  const r = { kind: "sofa", params: { seats: 3, arms: "slim", legs: "tapered" }, colors: ["#5b6b7a", "#c8b89a"],
    width_m: 2.1, depth_m: 0.9, height_m: 0.82, label: "Mum's old couch" };
  const d = L.prefillDetails(r, T);
  data.prefill_sofa = d;
  check("prefill", d.category === "seating" && d.kind === "sofa" && d.seats === 3 && d.color_family === "grey"
    && d.size_class === "medium" && JSON.stringify(d.features) === '["has_arms"]' && d.outdoor === false
    && d.title === "Three-seat grey sofa" && JSON.stringify(d.rooms) === "[]" && d.style === "" && d.material === "", d);
  const bed = L.prefillDetails({ kind: "bed", params: { size: "king" }, colors: ["#6b4f3a"], width_m: 2.07, depth_m: 2.2, height_m: 1.15 }, T);
  check("prefill", bed.category === "sleeping" && bed.bed_size === "king" && bed.seats === 2 && bed.color_family === "brown", bed);
  const tag = L.prefillDetails(T.defaultRecipe("tag"), T);
  const scanner = L.prefillDetails({ ...T.defaultRecipe("scanner"), params: { form: "board", antenna: true } }, T);
  check("prefill", tag.category === "device" && tag.form === "puck" && tag.antenna === undefined
    && scanner.form === "board" && scanner.antenna === true && L.checkDetails({ ...scanner, rooms: ["any"], style: "other",
    material: "plastic" }, "scanner").details !== null, { tag, scanner });
  const box = L.prefillDetails({ kind: "chaise_longue", colors: ["#336699"], width_m: 1.7, depth_m: 0.7, height_m: 0.8 }, T);
  check("prefill", box.kind === "other" && box.category === "other" && box.color_family === "blue", box);
  // An AI's sheet, tidied: close spellings become the library's values; what isn't the sheet's is left out.
  const ai = L.prefillDetails({ ...r, details: { category: "Seating", rooms: ["Living room", "kids room", "attic"],
    style: "Mid Century", material: "Rattan/Wicker", features: ["modular", "Has arms"], outdoor: "no",
    title: "  Nice sofa  ", confidence: 0.9, label: "secret name" } }, T);
  data.prefill_ai = ai;
  check("prefill", JSON.stringify(ai.rooms) === '["living","kids-room"]' && ai.style === "mid-century" && ai.material === "rattan"
    && JSON.stringify(ai.features) === '["has_arms","sectional"]' && ai.outdoor === false && ai.title === "Nice sofa"
    && !("confidence" in ai) && !("label" in ai), ai);
  check("prefill", L.checkDetails({ ...ai, checked: true }, "sofa").details !== null, "a tidied AI sheet passes the rules");
}

// ── 4. libraryFlow ───────────────────────────────────────────────────────────
const STARTERS = { schema: 1, pieces: fx("seed.json").entries.slice(0, 5).map(e => ({ id: `s${e.id.slice(-1)}`,
  recipe: { ...e.recipe, details: e.details } })) };
L._setStartersForTests(STARTERS);
function fakeCtx({ libraryOn = true, answer = () => ({}), space, room, settingsExtra } = {}){
  const el = document.createElement("div");
  const calls = [], toasts = [];
  const callWS = async (msg) => {
    calls.push(JSON.parse(JSON.stringify(msg)));
    return answer(msg);
  };
  const ctx = { el, callWS, wsCall: callWS, toast: (t, e) => toasts.push([t, !!e]), floor: { id: "main", name: "Main floor" },
    room: room === undefined ? null : room, recipeTools: T, settings: { atlas_3d_library: libraryOn, ...(settingsExtra || {}) } };
  if (space) ctx.space = space;
  return { ctx, calls, toasts };
}
const libEntries = seedEntries.map(({ key, ...e }) => e);
const searchAnswer = (msg) => {
  if (msg.type === "padspan_ha/house3d_library_search") return L.searchEntries(seedEntries, msg);
  if (msg.type === "padspan_ha/house3d_library_get") {
    const e = libEntries.find(x => x.library_id === msg.library_id);
    return { entry: { ...e, houses: e.houses + 1 } };
  }
  if (msg.type === "padspan_ha/house3d_library_report") return { reported: true };
  throw { code: "unknown_command", message: msg.type };
};
const searches = (calls) => calls.filter(c => c.type === "padspan_ha/house3d_library_search");

{   // the library off: the starter set, and not a single library call
  const { ctx, calls } = fakeCtx({ libraryOn: false });
  const p = L.libraryFlow(ctx);
  await settle();
  check("library_off", /shared library is off/.test(text($(ctx.el, '[data-lal="status"]'))), text($(ctx.el, '[data-lal="status"]')));
  check("library_off", calls.length === 0, calls);
  const cards = $$(ctx.el, ".lal-card");
  check("library_off", cards.length === 5 && /Starter set \(5\)/.test(text($(ctx.el, '[data-lal="starters"]'))), cards.length);
  $(cards[0], '[data-lal="place"]').click();
  const v = await p;
  check("library_off", v && v.library_id === null && v.recipe && v.recipe.kind === "sofa" && v.recipe.details
    && v.recipe.details.style === "mid-century", v);
  check("library_off", ctx.el.children.length === 0, "the flow leaves its container empty");
}

{   // the library unreachable: said plainly, and Furnish still works from the starter set
  const { ctx } = fakeCtx({ answer: () => { throw { code: "unreachable", message: "Can't reach the shared library right now." }; } });
  const p = L.libraryFlow(ctx);
  await settle();
  check("library_down", /Can't reach the shared library/.test(text($(ctx.el, '[data-lal="status"]'))), text($(ctx.el, '[data-lal="status"]')));
  check("library_down", $$(ctx.el, ".lal-card").length === 5 && $(ctx.el, '[data-lal="shared"]').style.display === "none");
  $(ctx.el, '[data-lal="close"]').click();
  check("library_down", (await p) === null && ctx.el.children.length === 0);
}

{   // the library answering: every filter and the sorts reach the wire; placing counts
  const { ctx, calls } = fakeCtx({ answer: searchAnswer, space: { width_m: 1.0, depth_m: 1.0 } });
  const p = L.libraryFlow(ctx);
  await settle();
  const shared = $(ctx.el, '[data-lal="shared"]');
  check("library_ok", $$(shared, ".lal-card").length === 13 && /13 shared pieces/.test(text($(ctx.el, '[data-lal="status"]'))),
    text($(ctx.el, '[data-lal="status"]')));
  const first = searches(calls)[0];
  check("library_ok", first && first.sort === "placed" && first.offset === 0 && first.limit === 30 && !first.filters && !first.text, first);
  const sel = (k) => $(ctx.el, `[data-filter="${k}"]`);
  for (const [k, v, want] of [["category", "seating", "seating"], ["room", "bedroom", "bedroom"], ["style", "scandinavian", "scandinavian"],
    ["material", "wood", "wood"], ["color_family", "white", "white"], ["size_class", "medium", "medium"], ["seats", "1", 1],
    ["outdoor", "no", false], ["kind", "sofa", "sofa"]]) {
    change(sel(k), v);
    await settle();
    const last = searches(calls).at(-1);
    check("library_filters", last.filters && last.filters[k] === want, { k, last });
    change(sel(k), "");
    await settle();
  }
  const armsChip = [...$$($(ctx.el, '[data-lal="filters"]'), ".lal-chip")].find(b => b.getAttribute("data-v") === "has_arms");
  armsChip.click();
  await settle();
  check("library_filters", JSON.stringify(searches(calls).at(-1).filters) === '{"features":["has_arms"]}', searches(calls).at(-1));
  check("library_filters", $$(shared, ".lal-card").length === 3, $$(shared, ".lal-card").length);
  armsChip.click();
  await settle();
  typeIn($(ctx.el, '[data-lal="search"]'), "IKEA");
  await settle();
  check("library_search", searches(calls).at(-1).text === "IKEA" && $$(shared, ".lal-card").length === 2, searches(calls).at(-1));
  typeIn($(ctx.el, '[data-lal="search"]'), "");
  await settle();
  for (const s of ["newest", "size", "name", "placed"]) {
    change($(ctx.el, '[data-lal="sort"]'), s);
    await settle();
    check("library_sort", searches(calls).at(-1).sort === s, searches(calls).at(-1));
  }
  // Fits here: the free space the Furnish tab passed, best fit first.
  $(ctx.el, '[data-lal="fits"]').click();
  await settle();
  const fit = searches(calls).at(-1);
  check("library_fits", fit.sort === "fit" && JSON.stringify(fit.filters) === '{"fits":{"width_m":1,"depth_m":1}}', fit);
  const order = [...$$(shared, ".lal-card")].map(c => c.getAttribute("data-key").slice(-1)).join("");
  check("library_fits", order === "3cd89", order);
  check("library_fits", /1\.00 × 1\.00 m/.test(text(ctx.el)), "the space is said");
  $(ctx.el, '[data-lal="fits"]').click();
  await settle();
  check("library_fits", searches(calls).at(-1).sort === "placed" && !searches(calls).at(-1).filters, searches(calls).at(-1));
  // Report: counted only, with a reason.
  const card = [...$$(shared, ".lal-card")].find(c => c.getAttribute("data-key") === "lib_000000000001");
  $(card, '[data-lal="report"]').click();
  [...$$(card, "button")].find(b => b.getAttribute("data-reason") === "title").click();
  await settle();
  check("library_report", JSON.stringify(calls.at(-1)) === JSON.stringify({ type: "padspan_ha/house3d_library_report",
    library_id: "lib_000000000001", reason: "title" }) && /Thanks, reported/.test(text(card)), calls.at(-1));
  // The terms, read only: browsing needs none.
  $(ctx.el, '[data-lal="terms"]').click();
  const ts = $(ctx.el, '[data-lal="terms-screen"]');
  check("library_terms", ts && /Draft — under review/.test(text(ts)) && !$(ts, '[data-lal="accept"]')
    && $(ctx.el, '[data-lal="main"]').style.display === "none", text(ts));
  $(ts, '[data-lal="back"]').click();
  check("library_terms", !$(ctx.el, '[data-lal="terms-screen"]') && $(ctx.el, '[data-lal="main"]').style.display === "");
  // Place a shared piece: the library counts it, the recipe and its details come back.
  $(card, '[data-lal="place"]').click();
  const v = await p;
  check("library_place", v && v.library_id === "lib_000000000001" && v.recipe.kind === "sofa" && v.recipe.details.title === "Three-seat grey sofa"
    && calls.at(-1).type === "padspan_ha/house3d_library_get" && calls.at(-1).placed === true, { v, last: calls.at(-1) });
}

{   // no spot passed: no Fits here to press; a room's own outline is its size
  const { ctx } = fakeCtx({ answer: searchAnswer });
  L.libraryFlow(ctx);
  await settle();
  check("library_fits", $(ctx.el, '[data-lal="fits"]').style.display === "none", "hidden with nothing to fit");
  check("library_fits", JSON.stringify(L.fitSpace({ room: { name: "Den", points_m: [[0, 0], [3.2, 0], [3.2, -2.5], [0, -2.5]] } }))
    === '{"width_m":3.2,"depth_m":2.5,"what":"room"}' && L.fitSpace({ room: { name: "Den" } }) === null
    && JSON.stringify(L.fitSpace({ space: { width_m: 2, depth_m: 1 } })) === '{"width_m":2,"depth_m":1,"what":"space"}');
  $(ctx.el, '[data-lal="close"]').click();
}

{   // only a room's name: its outline is read once, from the model, when Fits here is pressed
  const { ctx, calls } = fakeCtx({ room: { name: "Den" }, answer: (msg) => (msg.type === "padspan_ha/model_get"
    ? { room_geometry_m: { Den: { floor_id: "main", points_m: [[1, 1], [2.2, 1], [2.2, 2.5], [1, 2.5]] } } } : searchAnswer(msg)) });
  L.libraryFlow(ctx);
  await settle();
  check("library_fits", !calls.some(c => c.type === "padspan_ha/model_get"), "nothing read before it is asked for");
  $(ctx.el, '[data-lal="fits"]').click();
  await settle();
  const fit = searches(calls).at(-1);
  check("library_fits", calls.filter(c => c.type === "padspan_ha/model_get").length === 1
    && JSON.stringify(fit.filters) === '{"fits":{"width_m":1.2,"depth_m":1.5}}', fit);
  $(ctx.el, '[data-lal="close"]').click();
}

// ── 5. shareFlow ─────────────────────────────────────────────────────────────
const PIECE = { id: "fur_1a2b3c4d", origin: "build", label: "Mum's old couch", floor_id: "main", x_m: 3.412, y_m: 1.25,
  z_m: 0, rotation: 90, entity_id: "light.lounge_lamp", entity_reg_id: "abc123", library_id: null, submission_id: null,
  recipe: { kind: "sofa", params: { seats: 3, arms: "slim", seat_h_m: 0.44, legs: "tapered", cushions: 3 },
    colors: ["#5b6b7a", "#c8b89a"], width_m: 2.1, depth_m: 0.9, height_m: 0.82, future_key: 1 } };
const houseGet = (accepted) => ({ data: { library: accepted ? { terms_version: L.TERMS_VERSION } : {} } });

{   // the library off: said, nothing sent
  const { ctx, calls } = fakeCtx({ libraryOn: false });
  const p = L.shareFlow(ctx, PIECE);
  await settle();
  check("share_off", $(ctx.el, '[data-lal="off"]') && calls.length === 0);
  $(ctx.el, '[data-lal="close"]').click();
  check("share_off", (await p) === null);
}

{   // the terms first, then the sheet; its refusals; then a share of the recipe's keys and the sheet only
  let shared = null;
  const { ctx, calls, toasts } = fakeCtx({ answer: (msg) => {
    if (msg.type === "padspan_ha/house3d_get") return houseGet(false);
    if (msg.type === "padspan_ha/house3d_terms_accept") return { library: { terms_version: msg.version } };
    if (msg.type === "padspan_ha/house3d_library_share") { shared = msg; return { submission_id: "sub_a1b2c30000000001", status: "shared", library_id: "lib_00000000abcd" }; }
    throw { code: "unknown_command" };
  } });
  const p = L.shareFlow(ctx, PIECE);
  await settle();
  const ts = $(ctx.el, '[data-lal="terms-screen"]');
  check("share_terms", ts && /Draft — under review/.test(text(ts)) && /licence/.test(text(ts)) && /withdraw/.test(text(ts)), text(ts));
  $(ts, '[data-lal="accept"]').click();
  await settle();
  check("share_terms", calls.some(c => c.type === "padspan_ha/house3d_terms_accept" && c.version === L.TERMS_VERSION)
    && $(ctx.el, '[data-lal="share"]'), calls);
  // A missing detail: refused in the page, nothing sent.
  $(ctx.el, '[data-lal="share"]').click();
  await settle();
  check("share_refusals", !shared && /Tick at least one room/.test(text($(ctx.el, '[data-lal="msg"]')))
    && $(ctx.el, '[data-field="rooms"]').classList.contains("bad"), text($(ctx.el, '[data-lal="msg"]')));
  [...$$($(ctx.el, '[data-field="rooms"]'), ".lal-chip")].find(b => b.getAttribute("data-v") === "living").click();
  change($($(ctx.el, '[data-field="style"]'), "select"), "modern");
  $(ctx.el, '[data-lal="share"]').click();
  await settle();
  check("share_refusals", !shared && /main material/.test(text($(ctx.el, '[data-lal="msg"]'))), text($(ctx.el, '[data-lal="msg"]')));
  change($($(ctx.el, '[data-field="material"]'), "select"), "fabric");
  // A title with a phone number: refused, and the suggestion goes back in its place.
  const title = $($(ctx.el, '[data-field="title"]'), "input");
  typeIn(title, "Call 604 555 0123");
  $(ctx.el, '[data-lal="share"]').click();
  await settle();
  check("share_refusals", !shared && /phone number/.test(text($(ctx.el, '[data-lal="msg"]'))) && title.value === "Three-seat grey sofa",
    { msg: text($(ctx.el, '[data-lal="msg"]')), title: title.value });
  for (const [bad, what] of [["bob@example.com", "email address"], ["42 Maple Street", "street address"], ["sofas.com", "web address"]]) {
    typeIn($($(ctx.el, '[data-field="brand"]'), "input"), bad);
    $(ctx.el, '[data-lal="share"]').click();
    await settle();
    check("share_refusals", !shared && text($(ctx.el, '[data-lal="msg"]')).includes(what), { bad, msg: text($(ctx.el, '[data-lal="msg"]')) });
  }
  typeIn($($(ctx.el, '[data-field="brand"]'), "input"), "");
  $(ctx.el, '[data-lal="share"]').click();
  const v = await p;
  check("share_sent", shared && JSON.stringify(Object.keys(shared.recipe)) === '["kind","params","colors","width_m","depth_m","height_m","details"]',
    shared && Object.keys(shared.recipe));
  const flat = JSON.stringify(shared);
  check("share_sent", !/Mum|3\.412|lounge_lamp|abc123|future_key|fur_1a2b3c4d|rotation|floor_id/.test(flat), flat);
  const d = shared && shared.recipe.details;
  check("share_sent", d && d.category === "seating" && d.kind === "sofa" && JSON.stringify(d.rooms) === '["living"]' && d.style === "modern"
    && d.material === "fabric" && d.color_family === "grey" && d.size_class === "medium" && d.title === "Three-seat grey sofa"
    && d.checked === true && !("brand" in d), d);
  check("share_sent", v && v.submission_id === "sub_a1b2c30000000001" && v.details && v.details.style === "modern"
    && toasts.some(([t]) => /Shared/.test(t)) && !("submission_id" in shared), { v, toasts });
  data.share_message = shared;
}

{   // an AI's sheet: the person's tick is the "details checked" mark; a queued share is said
  const results = [];
  for (const tick of [false, true]) {
    let shared = null;
    const { ctx, toasts } = fakeCtx({ answer: (msg) => {
      if (msg.type === "padspan_ha/house3d_get") return houseGet(true);
      shared = msg;
      return { submission_id: "sub_a1b2c30000000002", status: "queued", library_id: null };
    } });
    const piece = { ...PIECE, submission_id: "sub_a1b2c30000000002", recipe: { ...PIECE.recipe, details: { category: "seating",
      rooms: ["living"], style: "modern", material: "fabric", title: "Grey sofa" } } };
    const p = L.shareFlow(ctx, piece);
    await settle();
    const confirm = $(ctx.el, '[data-lal="confirm"]');
    if (tick) confirm.checked = true;
    $(ctx.el, '[data-lal="share"]').click();
    await p;
    results.push({ checked: shared && shared.recipe.details.checked, sid: shared && shared.submission_id, toasts });
  }
  check("share_ai", results[0].checked === false && results[1].checked === true && results[0].sid === "sub_a1b2c30000000002"
    && results.every(r => r.toasts.some(([t]) => /as soon as the library can be reached/.test(t))), results);
}

// ── 7. the starter set (assets/furniture_starters.json) ──────────────────────
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
{
  const json = JSON.parse(readFileSync(join(VIEWS, "..", "assets", "furniture_starters.json"), "utf-8"));
  const pieces = json.pieces || [];
  const ids = pieces.map(p => p.id);
  check("starters", json.schema === 1 && pieces.length >= 20 && pieces.length <= 30 && new Set(ids).size === ids.length, ids.length);
  const kinds = new Set(pieces.map(p => p.recipe.kind));
  const starterKinds = ["sofa", "bed", "table", "chair", "desk", "dresser", "tv", "lamp"];   // Garry's choice 13
  check("starters", starterKinds.every(k => kinds.has(k)), { missing: starterKinds.filter(k => !kinds.has(k)) });
  for (const p of pieces) {
    const r = p.recipe, d = r.details || {};
    const c = T.clampRecipe(r);
    const same = JSON.stringify(c.params) === JSON.stringify(r.params) && ["width_m", "depth_m", "height_m"].every(k => c[k] === r[k])
      && JSON.stringify(c.colors) === JSON.stringify(r.colors);
    check("starters", own(T.FURNITURE, r.kind) && same, { id: p.id, clamped: c });
    const got = L.checkDetails(d, r.kind);
    check("starters", got.details && L.REQUIRED.every(k => d[k] !== undefined) && d.title && d.checked === true
      && JSON.stringify(got.details) === JSON.stringify(d), { id: p.id, got });
    check("starters", d.color_family === L.colorFamily(r.colors[0]) && d.size_class === L.sizeClass(r, T) && d.kind === r.kind,
      { id: p.id, family: [d.color_family, L.colorFamily(r.colors[0])], size: [d.size_class, L.sizeClass(r, T)] });
  }
  const entries = L.starterEntries(json);
  const lamps = L.searchEntries(entries, { filters: { category: "lighting" }, limit: 100 });
  check("starters", lamps.total === pieces.filter(p => p.recipe.details.category === "lighting").length && lamps.total >= 2, lamps.total);
  check("starters", entries.every(e => e.library_id === null && e.starter === true), "starters are no library's pieces");
}

// ── 6. Settings → UI Structure → Atlas → 3D house: the library's rows ───────
const S = await import(pathToFileURL(join(VIEWS, "settings.js")).href);
function hel(tag, attrs = {}, children = []){
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
function settingsBox(settings){
  const sent = [], toasts = [];
  const ctx = {
    hass: { user: { is_admin: true }, states: {} },
    state: { view: "settings", complexity: "advanced", _settingsTab: "ui", model: { floors: [], areas: [], room_geometry_m: {} },
      settings: { lights_panel_enabled: true, advanced_extra_tabs: [], tier: "pro", ...settings } },
    helpers: new Proxy({ el: hel, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: () => hel("span") },
      { get: (t, k) => (k in t ? t[k] : () => hel("span")) }),
    actions: new Proxy({ settingsSet: async () => ({}),
      wsCall: async (type, msg = {}) => {
        sent.push([type, msg]);
        if (type === "padspan_ha/house3d_library_withdraw") return { withdrawn: 2, left: 0 };
        return { settings: { ...ctx.state.settings, ...msg } };
      }, renderRooms() {}, renderNav() {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast: (t, e) => toasts.push([t, !!e]),
  };
  const root = S.render(ctx);
  const box = root._all().find(n => n.children && n.children.some(c => c.textContent === "🏠 Live Aboard"));
  const all = () => box._all();
  const libCb = () => { const lab = all().find(n => n.localName === "span" && n.textContent === "Use the shared furniture library"); return lab && lab.parentNode.children.find(c => c.localName === "input"); };
  const attr = (a) => all().find(n => n.attributes && a in n.attributes);
  return { ctx, sent, toasts, box, all, libCb, attr, master: all().find(n => n.localName === "input" && n.getAttribute("type") === "checkbox") };
}
{
  const off = settingsBox({ atlas_3d_enabled: false, atlas_3d_library: false });
  check("settings_rows", !/library|furniture|Withdraw/i.test(off.box.textContent), "nothing of the library while off");
  off.master.checked = true;
  off.master.dispatchEvent({ type: "change" });
  await settle();
  off.master.checked = false;
  off.master.dispatchEvent({ type: "change" });
  off.master.checked = true;
  off.master.dispatchEvent({ type: "change" });
  await settle();
  const rows = off.all().filter(n => n.localName === "span" && n.textContent === "Use the shared furniture library");
  check("settings_rows", rows.length === 1 && off.libCb() && off.libCb().checked === false
    && off.attr("data-la3d-withdraw").parentNode.style.display === "none", "built once, when the switch goes on");
  const on = settingsBox({ atlas_3d_enabled: true, atlas_3d_library: false });
  const cb = on.libCb();
  cb.checked = true;
  cb.dispatchEvent({ type: "change" });
  await settle();
  check("settings_rows", JSON.stringify(on.sent) === JSON.stringify([["padspan_ha/settings_set", { atlas_3d_library: true }]])
    && on.attr("data-la3d-withdraw").parentNode.style.display === "flex", on.sent);
  const lib = settingsBox({ atlas_3d_enabled: true, atlas_3d_library: true });
  const wd = lib.attr("data-la3d-withdraw"), yes = lib.attr("data-la3d-withdraw-yes");
  check("settings_withdraw", wd.parentNode.style.display === "flex" && yes.parentNode.parentNode.style.display === "none");
  wd.click();
  check("settings_withdraw", yes.parentNode.parentNode.style.display === "block" && lib.sent.length === 0, "asked in the page first");
  yes.click();
  await settle();
  check("settings_withdraw", JSON.stringify(lib.sent) === JSON.stringify([["padspan_ha/house3d_library_withdraw", {}]])
    && lib.toasts.some(([t, e]) => !e && /2 pieces taken out of the library/.test(t)) && yes.parentNode.parentNode.style.display === "none",
    { sent: lib.sent, toasts: lib.toasts });
}

console.log(JSON.stringify({ cases, failures, data }));
