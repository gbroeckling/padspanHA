// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The add-ons' gates (the owner, 2026-11-25), RUN: for each install below
// (free, free with one add-on, Bright, Pro) what each gated surface lets it
// use. The pytest wrapper is tests/test_addon_gates.py; the Atlas sidebar's
// own gates (alarm, emergency lights, Audio) run in lights_panel_lifecycle.mjs.
//
//   editions.js addonAllowed       every add-on for every install
//   lights_map.js                  lightsHostForTier (Showcase vs placement), hostAddon (the whole-house bar)
//   settings.js                    Settings → Atlas's Heatmap and Audio rows, the Theme card's locked looks
//   devices.js                     Door Openers and the relay wizard's kinds
//   busy_times.js, locate.js       the gate card or the screen
//   maps and vacuum (on sale from December 1)  addonOnSale, addonGate, the licence card's offer, the rooms helper's intro
//
// Run:  node tests/js/addon_gates.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const ED = await import(pathToFileURL(V + "editions.js").href);
const LM = await import(pathToFileURL(V + "lights_map.js").href);
const SET = await import(pathToFileURL(V + "settings.js").href);
const DEV = await import(pathToFileURL(V + "devices.js").href);
const BUSY = await import(pathToFileURL(V + "busy_times.js").href);
const LOC = await import(pathToFileURL(V + "locate.js").href);
const AIW = await import(pathToFileURL(V + "ai_wizard.js").href);
const TO = await import(pathToFileURL(V + "trial_offer.js").href);

const out = {};
const fail = [];
// The installs: a tier and the add-ons the backend allows (settings.addons_licensed).
const INSTALLS = {
  free: { tier: "free" },
  bright: { tier: "bright" },
  pro: { tier: "pro" },
  ...Object.fromEntries(ED.ADDONS.map(a => [a.name, { tier: "free", addons_licensed: [a.name], pro_has_key: true, addon_key: true }])),
};

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }
  return n;
}
const recorder = () => new Proxy(() => document.createElement("span"), {
  get: (t, k) => k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : recorder() });
const all = (n, acc = []) => { for (const c of (n.children || [])) { acc.push(c); all(c, acc); } return acc; };
function ctxFor(settings, extra = {}) {
  const state = {
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "settings",
    settings: { edition: "full", ...settings }, followedAddrs: new Set(), timing: {}, roomTagMap: {},
    model: { floors: [], areas: [], room_meta: {}, room_geometry_m: {}, room_adjacency: {} }, maps: [],
    live: { snapshot: { ble: { radios: [], advertisements: [] }, objects: { list: [], summary: {} } } }, ...extra,
  };
  const helpers = new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {},
    errorText: (e) => String(e) }, { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ renderRooms: () => {}, settingsSet: async () => ({}), callWS: async () => ({}), wsCall: async () => ({}) },
    { get: (t, k) => k in t ? t[k] : recorder() });
  return new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state, helpers, actions, toast: () => {} }, { get: (t, k) => k in t ? t[k] : recorder() });
}
const run = (name, fn) => { try { fn(); } catch (e) { fail.push(`${name}: ${e && e.stack || e}`); } };

// ── editions.js: every add-on for every install ───────────────────────────
run("addonAllowed", () => {
  out.allowed = {};
  for (const [k, s] of Object.entries(INSTALLS)) out.allowed[k] = ED.ADDONS.map(a => a.name).filter(n => ED.addonAllowed(s, n));
  out.prices = Object.fromEntries(ED.ADDONS.map(a => [a.name, ED.addonPrice(a.name, Date.parse("2026-11-01T00:00:00Z"))]));
  out.noPrice = ED.addonPrice("nope");
  out.insightsWords = ED.ADDONS.find(a => a.name === "insights").words;
});

// ── lights_map.js: Showcase (the Looks pack) apart from placement (Bright or Pro) ──
run("lightsHostForTier", () => {
  const host = (s) => ({ tier: s.tier, addons: s.addons_licensed || [], model: { light_positions_m: { "light.a": { x_m: 1, y_m: 1 } } },
    showcase: true, onShowcase: () => {}, showcaseTheme: "west_coast_forest", onShowcaseTheme: () => {},
    fitRooms: true, onFitRooms: () => {}, isolux: true, onIsolux: () => {}, automorph: true, onAutomorph: () => {},
    onScene: () => {}, onRipple: () => {}, onTypeOverride: () => {}, onPlaceRow: () => {},
    onApplyPreset: () => {}, showcasePresets: [{ name: "x", values: {} }], hideUntouched: true, onHideUntouched: () => {} });
  out.host = {};
  for (const [k, s] of Object.entries(INSTALLS)) {
    const h = LM.lightsHostForTier(host(s));
    out.host[k] = { showcase: h.showcase === true && typeof h.onShowcase === "function", theme: h.showcaseTheme,
      placed: Object.keys(h.model.light_positions_m).length, fitRooms: !!h.onFitRooms, isolux: !!h.onIsolux,
      automorph: !!h.onAutomorph, scene: !!h.onScene, ripple: !!h.onRipple, typeOverride: !!h.onTypeOverride,
      placeRow: !!h.onPlaceRow, hideUntouched: !!h.onHideUntouched, presets: typeof h.onApplyPreset === "function" && h.showcase === true };
  }
  out.hostAddon = Object.fromEntries(Object.entries(INSTALLS).map(([k, s]) =>
    [k, ["vacation", "looks", "climate"].filter(n => LM.hostAddon({ tier: s.tier, addons: s.addons_licensed }, n))]));
});

// ── settings.js: Settings → Atlas's rows, and the Theme card ──────────────
run("settings", () => {
  out.atlasRows = {};
  out.looks = {};
  for (const [k, s] of Object.entries(INSTALLS)) {
    const root = SET.render(ctxFor(s, { _settingsTab: "atlas" }));
    const nodes = all(root);
    out.atlasRows[k] = {
      heatmap: (root.textContent || "").includes("Heatmap chip on the Atlas"),
      audio: nodes.some(n => n.getAttribute && n.getAttribute("data-settings") === "atlas-audio"),
    };
    const app = SET.render(ctxFor(s, { _settingsTab: "appearance" }));
    const dis = all(app).filter(n => n.localName === "button" && n.getAttribute("disabled") !== null).map(n => n.textContent);
    out.looks[k] = dis.filter(t => ["Graphite", "Ocean", "Dusk", "Day"].includes(t)).length;
  }
});

// ── devices.js: Door Openers and the relay wizard ─────────────────────────
run("devices", () => {
  out.openers = {};
  for (const [k, s] of Object.entries(INSTALLS)) {
    const ctx = ctxFor(s, { _devicesTab: "openers", _relayWizardOpen: true });
    const root = DEV.render(ctx);
    const text = root.textContent || "";
    const kinds = all(root).filter(n => n.localName === "option").map(n => n.value || n.getAttribute("value"));
    out.openers[k] = { refused: text.includes(`Door Openers needs PadSpan Pro or the Alarm & security add-on (${ED.addonPrice("alarm")})`),
      relayLight: kinds.includes("relay_light"), opener: kinds.includes("momentary_opener"), lock: kinds.includes("momentary_lock") };
  }
});

// ── busy_times.js and locate.js: the gate card, or the screen ─────────────
run("insights", () => {
  out.insights = {};
  for (const [k, s] of Object.entries(INSTALLS)) {
    const b = BUSY.render(ctxFor(s));
    const l = LOC.render(ctxFor(s, { followAddr: "AA:TAG" }));
    const gate = (n) => (n.textContent || "").includes(`needs PadSpan Pro or the Presence insights add-on (${ED.addonPrice("insights")})`);
    out.insights[k] = { busyGate: gate(b), locateGate: gate(l) };
  }
});

// ── Advanced map creation (maps) and Robot vacuum: on sale from December 1 ──
run("maps", () => {
  // Just before the moment (editions.js FREE_BASICS_FROM) and at it.
  const moments = { before: Date.parse(ED.FREE_BASICS_FROM) - 1, from: Date.parse(ED.FREE_BASICS_FROM) };
  // What the backend says is on sale then (settings.addons_on_sale, licence.addons_on_sale).
  const sale = { before: ED.ADDONS.map(a => a.name).filter(n => n !== "maps" && n !== "vacuum"), from: ED.ADDONS.map(a => a.name) };
  out.onSale = {}; out.mapsGate = {}; out.vacuumGate = {}; out.offered = {};
  const realNow = Date.now;
  try {
    for (const [when, t] of Object.entries(moments)) {
      out.onSale[when] = Object.fromEntries(ED.ADDONS.map(a => [a.name, ED.addonOnSale(a.name, t)]));
      for (const [key, name] of [["mapsGate", "maps"], ["vacuumGate", "vacuum"]]) {
        out[key][when] = Object.fromEntries(Object.entries(INSTALLS).map(([k, s]) => [k, ED.addonGate({ ...s, addons_on_sale: sale[when] }, name)]));
      }
      // The licence card offers the add-ons an install lacks, never one that isn't on sale.
      Date.now = () => t;
      out.offered[when] = {};
      for (const k of ["free", "audio"]) {
        const root = SET.render(ctxFor(INSTALLS[k], { _settingsTab: "features" }));
        out.offered[when][k] = all(root).filter(n => n.getAttribute && n.getAttribute("data-addon")).map(n => n.getAttribute("data-addon"));
      }
    }
  } finally { Date.now = realNow; }
  // Settings not in yet (no addons_on_sale): "not on sale", everyone's.
  out.vacuumGate.unsaid = ED.addonGate({ tier: "free" }, "vacuum");
  // The rooms helper's intro, by the backend's answer (ai_wizard.py: tier, maps, trial_offerable), Claude ready.
  const build = { unlock: { ok: true, display: "Claude" } };
  out.helper = {};
  for (const [k, info] of Object.entries({ pro: { tier: "pro", maps: true }, maps: { tier: "free", maps: true },
                                           free: { tier: "free", maps: false }, trial: { tier: "free", maps: false, trial_offerable: true } })) {
    out.helper[k] = AIW.introBlock(info, build);
  }
});

// ── Advanced smart lighting: the light design tools apart from placement ──
run("lighting", () => {
  out.design = Object.fromEntries(Object.entries(INSTALLS).map(([k, s]) => [k, LM.designUnlocked({ tier: s.tier, addons: s.addons_licensed })]));
  out.designTier = [LM.designUnlocked("pro"), LM.designUnlocked("bright"), LM.designUnlocked("free"), LM.designUnlocked(null)];
  // A WLED strip and a shape set by hand: a strip (its effects) and its shape only with the design tools.
  const states = { "light.strip": { state: "on", attributes: { friendly_name: "Strip", effect_list: ["Solid", "Rainbow"] } },
                   "light.lamp": { state: "on", attributes: { friendly_name: "Lamp" } } };
  out.gather = Object.fromEntries(Object.entries(INSTALLS).map(([k, s]) => {
    const ls = LM.gatherLights(states, { "light.strip": "Hall", "light.lamp": "Hall" }, { "light.lamp": "pendant" },
      { tier: s.tier, addons: s.addons_licensed }, { "light.strip": "wled" });
    const by = Object.fromEntries(ls.map(l => [l.entity_id, l]));
    return [k, { strip: Array.isArray(by["light.strip"].effect_list), shape: by["light.lamp"].shape }];
  }));
  // The type override, as stored (settings.light_type_overrides): Pro's and Advanced smart lighting's, never Bright's.
  out.typeOverride = Object.fromEntries(Object.entries(INSTALLS).map(([k, s]) => {
    const ls = LM.gatherLights(states, { "light.strip": "Hall", "light.lamp": "Hall" }, {}, { tier: s.tier, addons: s.addons_licensed },
      {}, { "light.lamp": "plain" });
    return [k, ls.find(l => l.entity_id === "light.lamp").type_override];
  }));
  // WLED's Advanced tab: controlApiFor hands the add-ons to the card.
  out.wled = Object.fromEntries(Object.entries(INSTALLS).map(([k, s]) => {
    const api = LM.controlApiFor({ platformMap: { "light.strip": "wled" } }, "light.strip", { tier: s.tier, addons: s.addons_licensed });
    return [k, LM.designUnlocked(api.wled)];
  }));
  // An add-on key whose add-ons are all newer than this PadSpan (the server's needs_update): never Pro.
  const key = { tier: "free", pro_has_key: true, addon_key: true, pro_active: true, license_tier: "free", license_plan: "addons",
                license_addons: [], license_addons_until: {}, addons_licensed: [], license_home_status: "needs_update",
                forensics_license_expires: "2028-11-25 10:00:00" };
  const card = SET.render(ctxFor(key, { _settingsTab: "features" }));
  const t = card.textContent || "";
  out.needsUpdate = { said: t.includes("This add-on needs a newer PadSpan — update PadSpan."), pro: t.includes("PadSpan Pro licensed") };
  // A key the server called an add-on key (its plan) holding only add-ons this PadSpan doesn't know, no status: still
  // an add-on key (the backend's addon_key), never Pro, the update asked for, and the Pro trial still offered.
  const unknown = { ...key, license_home_status: "", license_addons: ["teleport"], license_addons_until: { teleport: "2028-11-25 10:00:00" } };
  const t2 = SET.render(ctxFor(unknown, { _settingsTab: "features" })).textContent || "";
  out.unknownAddons = { said: t2.includes("This add-on needs a newer PadSpan — update PadSpan."), pro: t2.includes("PadSpan Pro licensed"),
                        buyPro: t2.includes("Buy PadSpan Pro"), trial: TO.trialOfferable(unknown) };
});

// ── Robot vacuum: the gate, the cross discount, the licence card's own link (tests/test_free_basics_dec1.py) ──
run("vacuum", () => {
  const T = Date.parse(ED.FREE_BASICS_FROM), END = Date.parse(ED.ADDON_HALF_UNTIL);
  const every = ED.ADDONS.map(a => a.name);
  const v = out.vacuum = {};
  // The gate: the backend's word on what is on sale (settings.addons_on_sale), then Pro, the add-on or a Bright key.
  v.allowed = Object.fromEntries(Object.entries(INSTALLS).map(([k, s]) =>
    [k, { unsaid: ED.vacuumAllowed(s), before: ED.vacuumAllowed({ ...s, addons_on_sale: every.filter(n => n !== "maps" && n !== "vacuum") }),
          from: ED.vacuumAllowed({ ...s, addons_on_sale: every }) }]));
  // What each costs an install, just before and at each moment.
  const holders = { none: { tier: "free" }, maps: INSTALLS.maps, vacuum: INSTALLS.vacuum, pro: INSTALLS.pro,
                    lapsed: { tier: "free", pro_has_key: true, addon_key: true, license_addons: ["maps"], addons_licensed: [] } };
  const at = { before: T - 1, from: T, sale_last: END - 1, after_sale: END };
  v.price = {};
  for (const [h, s] of Object.entries(holders)) {
    v.price[h] = {};
    for (const name of ["maps", "vacuum", "audio"]) {
      v.price[h][name] = Object.fromEntries(Object.entries(at).map(([w, t]) => [w, ED.addonPriceFor(s, name, t)]));
    }
  }
  v.cross = { maps: ED.crossPrice("$8.65 CAD"), vacuum: ED.crossPrice("$6.45 CAD") };
  v.url = { cross: ED.addonBuyUrl(INSTALLS.maps, "vacuum", END), sale: ED.addonBuyUrl(INSTALLS.maps, "vacuum", T),
            none: ED.addonBuyUrl({ tier: "free" }, "vacuum", END), mapsCross: ED.addonBuyUrl(INSTALLS.vacuum, "maps", END) };
  // The licence card, after the sale, for an install holding Advanced map creation.
  const realNow = Date.now;
  try {
    Date.now = () => END + 3600e3;
    const root = SET.render(ctxFor({ ...INSTALLS.maps, addons_on_sale: every }, { _settingsTab: "features" }));
    v.card = all(root).filter(n => n.getAttribute && n.getAttribute("data-addon"))
      .map(n => ({ name: n.getAttribute("data-addon"), href: n.getAttribute("href"), text: n.textContent }));
    const note = all(root).find(n => n.getAttribute && n.getAttribute("data-addon-cross") === "note");
    v.note = note ? note.textContent : null;
    const plain = SET.render(ctxFor({ tier: "free", addons_on_sale: every }, { _settingsTab: "features" }));
    v.plainNote = !!all(plain).find(n => n.getAttribute && n.getAttribute("data-addon-cross") === "note");
    // Settings → Features: the Robot Vacuum Import row says what it needs once it is gated.
    const needs = (s) => { const r = SET.render(ctxFor(s, { _settingsTab: "features" }));
      const n = all(r).find(x => x.getAttribute && x.getAttribute("data-feature-needs") === "vacuum_import_enabled"); return n ? n.textContent : null; };
    v.needs = { free_from: needs({ tier: "free", addons_on_sale: every }), free_before: needs({ tier: "free", addons_on_sale: [] }),
                vacuum_from: needs({ ...INSTALLS.vacuum, addons_on_sale: every }) };
  } finally { Date.now = realNow; }
  // The Atlas's robot reads (lights_map.js hostVacuum): the same gate from a host.
  v.host = { free_from: LM.hostVacuum({ tier: "free", addons: [], addonsOnSale: every }),
             free_before: LM.hostVacuum({ tier: "free", addons: [], addonsOnSale: [] }),
             vacuum_from: LM.hostVacuum({ tier: "free", addons: ["vacuum"], addonsOnSale: every }),
             bright_from: LM.hostVacuum({ tier: "bright", addons: [], addonsOnSale: every }) };
  // The one-time "3D house is now free" card's rule (editions.js freeHouseCardDue).
  const due = ED.freeHouseCardDue;
  v.card3d = { before: due({ tier: "free", house3d_free_card_done: false }), from: due({ tier: "free", free_basics: true, house3d_free_card_done: false }),
               seen: due({ tier: "free", free_basics: true, house3d_free_card_done: true }),
               unknown: due({ tier: "free", free_basics: true }), pro: due({ tier: "pro", free_basics: true, house3d_free_card_done: false }),
               addonKey: due({ ...INSTALLS.audio, free_basics: true, house3d_free_card_done: false }), none: due(null) };
});

await flush();
process.stdout.write(JSON.stringify({ out, fail }) + "\n", () => process.exit(fail.length ? 1 : 0));
