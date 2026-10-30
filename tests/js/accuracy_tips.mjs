// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Overview's accuracy tips card (panel.js _accuracyTipsCard, 0.38.193),
// run for real: the method lifted out of panel.js and called on a stand-in
// panel under the DOM shim. Who sees it, what it asks the server, each tip's
// fix and hide, the whole card hidden, and each tip counted once as shown.
//
// usage: accuracy_tips.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
shim.install(globalThis);
// Line endings as checked out (CRLF on a Windows checkout, LF here): one form to cut by.
const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const start = src.indexOf("  _accuracyTipsCard(){");
const end = src.indexOf("\n  _proInviteOverviewCard(){", start);
const elSrc = src.slice(src.indexOf("function el(tag, attrs={}, children=[]){"), src.indexOf("\n}\n", src.indexOf("function el(tag, attrs={}, children=[]){")) + 2);
const method = src.slice(start, end).trim().replace(/^_accuracyTipsCard\(\)\{/, "").replace(/\}\s*$/, "");

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tick = () => shim.flush();

let wall = false;
const VIEWS = { maps: {}, calibration: {} };
const make = new Function("el", "wallScreen", "VIEWS", "_VIEW_PATHS", "_loadView", elSrc + "\nreturn function(){" + method + "};");

function panel({ admin = true, tips = ["floor_heights", "receiver_heights", "scale"], hidden = [], kiosk = false, mode = "live" } = {}){
  const calls = [], events = [], toasts = [];
  const p = {
    state: { settings: { accuracy_tips_hidden: hidden }, kioskMode: kiosk, _dataModeKnown: true, dataMode: mode,
             maps: { list: [{ id: "m1" }] }, activeMapId: null, complexity: "basic", _calib: { tab: "beacon" }, view: "overview" },
    _hass: { user: { is_admin: admin } },
    _callWS: async (msg) => { calls.push(msg); return msg.type === "padspan_ha/setup_tips" ? { tips } : { settings: { ...p.state.settings, ...msg } }; },
    _telemetryEvent: (n) => events.push(n),
    _scheduleRender: () => {}, _renderNav: () => {},
    _setComplexity: (m) => { p.state.complexity = m; }, _toast: (t) => toasts.push(t),
    calls, events, toasts,
  };
  p.card = make((t, a, c) => globalThis.__el(t, a, c), () => wall, VIEWS, {}, async () => {}).bind(p);
  return p;
}
globalThis.__el = new Function("return " + elSrc.replace(/^function el/, "function"))();
const rows = (card) => card ? card.querySelectorAll("[data-accuracy-tips]").map(n => n.getAttribute("data-accuracy-tips")).filter(x => x.startsWith("tip-")) : [];

// An administrator, live: nothing until the server answers, then a line per tip.
{
  const p = panel();
  const first = p.card();
  await tick(); await tick();
  const card = p.card();
  check("shown: nothing until the server answers, then one line per tip, each counted once",
    first === null && p.calls.filter(c => c.type === "padspan_ha/setup_tips").length === 1
    && JSON.stringify(rows(card)) === JSON.stringify(["tip-floor_heights", "tip-receiver_heights", "tip-scale"])
    && /Improve accuracy/.test(card.textContent)
    && JSON.stringify(p.events) === JSON.stringify(["tip_shown:floor_heights", "tip_shown:receiver_heights", "tip_shown:scale"]),
    { first: first && "card", rows: rows(card), events: p.events });
  p.card();
  check("shown: a redraw neither asks again within ten minutes nor counts again",
    p.calls.filter(c => c.type === "padspan_ha/setup_tips").length === 1 && p.events.length === 3, { calls: p.calls, events: p.events });
}
// Who never sees it.
{
  const out = {};
  for (const [k, o] of [["not admin", { admin: false }], ["wall (kiosk)", { kiosk: true }], ["sample mode", { mode: "sample" }], ["all hidden", { hidden: ["all"] }]]) {
    const p = panel(o);
    const a = p.card(); await tick(); await tick();
    out[k] = [a, p.card(), p.calls.length];
  }
  wall = true;
  const w = panel(); const a = w.card(); await tick(); out["full-screen wall"] = [a, w.card(), w.calls.length];
  wall = false;
  check("hidden: never for a non-administrator, a wall screen, sample mode, or with the card hidden; nothing asked",
    Object.values(out).every(([a, b, n]) => a === null && b === null && n === 0), Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [!!v[0], !!v[1], v[2]]])));
}
// One tip hidden, then the card.
{
  const p = panel({ hidden: ["scale"] });
  p.card(); await tick(); await tick();
  const card = p.card();
  const x = card.querySelector('[data-accuracy-tips="tip-floor_heights"]').querySelectorAll("span").find(n => n.getAttribute("title") === "Hide this tip");
  x.click(); await tick();
  const set1 = p.calls.find(c => c.type === "padspan_ha/settings_set");
  const after = p.card();
  check("hide: a hidden tip stays out; × hides one, saved beside the others",
    JSON.stringify(rows(card)) === JSON.stringify(["tip-floor_heights", "tip-receiver_heights"])
    && set1 && JSON.stringify(set1.accuracy_tips_hidden) === JSON.stringify(["scale", "floor_heights"])
    && p.events.includes("tip_hidden:floor_heights") && JSON.stringify(rows(after)) === JSON.stringify(["tip-receiver_heights"]),
    { rows: rows(card), set1, after: rows(after), events: p.events });
  after.querySelector('[data-accuracy-tips="off"]').click(); await tick();
  const set2 = p.calls.filter(c => c.type === "padspan_ha/settings_set").pop();
  check("hide: Hide these tips turns the card off for good",
    set2 && set2.accuracy_tips_hidden.includes("all") && p.events.includes("tip_hidden:all") && p.card() === null, { set2, events: p.events });
}
// Each fix goes to its place.
{
  const go = async (tip, complexity) => {
    const p = panel({ tips: [tip] });
    if (complexity) p.state.complexity = complexity;
    p.card(); await tick(); await tick();
    const card = p.card();
    card.querySelector(`[data-accuracy-tips="tip-${tip}"]`).querySelector("button").click();
    return p;
  };
  const f = await go("floor_heights"), r = await go("receiver_heights"), s = await go("scale");
  const fa = await go("floor_heights", "advanced");
  check("fix: floor heights from Advanced: no switch, no toast",
    fa.state.view === "maps" && fa.state.mapsTab === "stack" && fa.state.complexity === "advanced" && fa.toasts.length === 0,
    { fa: [fa.state.view, fa.state.mapsTab, fa.state.complexity, fa.toasts] });
  // Basic's Mapping has no 3D Stack (maps.js sends it to Library): floor heights switches to Advanced and says so.
  check("fix: floor heights → Maps 3D Stack (Basic switched to Advanced, with a toast), receiver heights → Calibration Tune (still in Basic mode), scale → the map wizard's Measure step",
    f.state.view === "maps" && f.state.mapsTab === "stack" && f.events.includes("tip_opened:floor_heights")
    && f.state.complexity === "advanced" && f.toasts.length === 1 && /switched to Advanced/.test(f.toasts[0])
    && r.state.view === "calibration" && r.state._calibTabRequest === "tune" && r.state.complexity === "basic" && r.events.includes("tip_opened:receiver_heights")
    && s.state.view === "maps" && s.state._mapsWizard && s.state._mapsWizard.step === 2 && s.state._mapsWizard.mapId === "m1" && s.events.includes("tip_opened:scale"),
    { f: [f.state.view, f.state.mapsTab, f.state.complexity, f.toasts], r: [r.state.view, r.state._calibTabRequest, r.state.complexity], s: [s.state.view, s.state._mapsWizard] });
}

console.log(JSON.stringify({ cases, failures }));
process.exit(0);
