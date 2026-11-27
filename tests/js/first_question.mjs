// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The first-run question (views/first_question.js), run for real under the DOM shim: asked only while the backend
// says it is due, to an administrator and never on a wall; Start saves the answers (the first ticked first) and opens
// the first one's step; Skip saves "skipped" and opens nothing; each answer's first step; the next steps for several
// answers; and Settings' card, which saves as it is ticked.
//
// Run: node tests/js/first_question.mjs <repo root>
// Prints one JSON line: { cases: {name: bool}, failures: [...] }.
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const pushed = [];
globalThis.history = { pushState: (_s, _t, path) => pushed.push(path) };
globalThis.dispatchEvent = () => true;
if (typeof globalThis.CustomEvent !== "function") globalThis.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
const FQ = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/first_question.js").href);

const cases = {}, failures = [];
const check = (name, ok, info) => { cases[name] = !!ok; if (!ok) failures.push({ name, info }); };
const wait = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => (globalThis._realSetTimeout || setTimeout)(r, 2)); };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}

function makeCtx({ settings = {}, admin = true, kiosk = false, complexity = "advanced", fail = false, rooms = true,
                   dataMode = "live", snapshot = { objects: { list: [] } } } = {}) {
  const log = [];
  const state = { settings: { lights_panel_enabled: true, ...settings }, kioskMode: kiosk, complexity, mapsTab: "library", dataMode,
    live: { snapshot }, model: { room_geometry_m: rooms ? { Kitchen: { points_m: [[0, 0], [3, 0], [3, 3]] } } : {} } };
  const ctx = {
    hass: { user: { is_admin: admin } }, state, toast: (m, bad) => log.push(["toast", m, !!bad]),
    helpers: { el, asButton: {} },
    actions: {
      settingsSet: async (p) => { log.push(["save", p]); if (fail) throw new Error("no"); state.settings = { ...state.settings, ...p }; },
      showView: (id) => { log.push(["view", id]); state.view = id; },
      openSetupStep: (id, mapId, door) => log.push(["setup", id, door]),
      // as the panel's: the mode changes only once the server took it (refuse: an admin-only refusal, nothing changes)
      setDataMode: async (mode) => { log.push(["mode", mode]); if (!ctx._refuseMode) state.dataMode = mode; },
      telemetryEvent: (n) => log.push(["event", n]),
    },
  };
  return { ctx, log, state };
}
const tick = (root, key) => { const c = root.querySelector(`[data-purpose="${key}"]`); c.checked = !c.checked; c.dispatchEvent({ type: "change" }); };

// ── who is asked ──
check("due:new install, admin", FQ.due(makeCtx({ settings: { purpose_ask: "due" } }).ctx));
check("due:not an existing install", !FQ.due(makeCtx({ settings: { purpose_ask: "" } }).ctx));
check("due:not once answered", !FQ.due(makeCtx({ settings: { purpose_ask: "done" } }).ctx));
check("due:not someone who is not an administrator", !FQ.due(makeCtx({ settings: { purpose_ask: "due" }, admin: false }).ctx));
check("due:not on a wall screen", !FQ.due(makeCtx({ settings: { purpose_ask: "due" }, kiosk: true }).ctx));

// ── the question, its words and order ──
{
  const { ctx } = makeCtx({ settings: { purpose_ask: "due" } });
  const card = FQ.askCard(ctx);
  const text = card.textContent;
  check("ask:the question", text.includes("What do you want PadSpan for?"), text);
  const labels = card.querySelectorAll("label").map(l => l.textContent);
  check("ask:four answers in order", JSON.stringify(labels) === JSON.stringify(
    ["The whole house on one screen", "Who's in which room", "My floor plan and 3D house", "Every light in its place"]), labels);
  check("ask:start waits for a tick", card.querySelector('[data-first-question="start"]').disabled === true);
  check("ask:skippable", !!card.querySelector('[data-first-question="skip"]'));
  const rows = card.querySelectorAll("label");
  check("ask:rows a finger can hit (36 px at least)", rows.length === 4 && rows.every(r => /min-height:36px/.test(r.getAttribute("style") || "")), rows.map(r => r.getAttribute("style")));
}

// ── Start: saved, the first ticked opens ──
{
  pushed.length = 0;
  const { ctx, log, state } = makeCtx({ settings: { purpose_ask: "due" } });
  const card = FQ.askCard(ctx);
  tick(card, "lights"); tick(card, "presence"); tick(card, "whole_house"); tick(card, "whole_house");   // untick drops it
  const start = card.querySelector('[data-first-question="start"]');
  check("start:enabled after a tick", start.disabled === false);
  start.click(); await wait();
  check("start:saved, the first ticked first", JSON.stringify(log.find(x => x[0] === "save")) === JSON.stringify(["save", { purpose: ["lights", "presence"] }]), log);
  check("start:opens the first ticked one's step (the lights tour)", state.mapsTab === "lights" && state._lightsTour && state._lightsTour.step === 1
    && log.some(x => x[0] === "view" && x[1] === "maps"), { log, state });
  check("start:nothing else opened", !log.some(x => x[0] === "setup") && !pushed.length, { log, pushed });
}
{
  const { ctx, log, state } = makeCtx({ settings: { purpose_ask: "due" }, fail: true });
  const card = FQ.askCard(ctx);
  tick(card, "plan");
  card.querySelector('[data-first-question="start"]').click(); await wait();
  check("start:a failed save opens nothing and says so", !log.some(x => x[0] === "view") && log.some(x => x[0] === "toast" && x[2]) && state.mapsTab === "library", log);
}

// ── Skip ──
{
  const { ctx, log } = makeCtx({ settings: { purpose_ask: "due" } });
  const card = FQ.askCard(ctx);
  card.querySelector('[data-first-question="skip"]').click(); await wait();
  check("skip:saved as skipped, nothing ticked", JSON.stringify(log.filter(x => x[0] === "save")) === JSON.stringify([["save", { purpose_ask: "skipped" }]]), log);
  check("skip:opens nothing", !log.some(x => x[0] === "view" || x[0] === "setup"), log);
}

// ── each answer's first step ──
{
  pushed.length = 0;
  const { ctx, log } = makeCtx();
  FQ.openStep(ctx, "whole_house");
  check("step:whole_house opens the Atlas page", JSON.stringify(pushed) === JSON.stringify(["/padspan-lights"]) && !log.some(x => x[0] === "view"), { pushed, log });
}
{
  pushed.length = 0;
  const { ctx, log, state } = makeCtx({ settings: { lights_panel_enabled: false } });
  FQ.openStep(ctx, "whole_house");
  check("step:whole_house with the Atlas out of the sidebar: Settings → Atlas", !pushed.length && state._settingsTab === "atlas" && log.some(x => x[1] === "settings"), { pushed, log });
}
{
  // a live house with no rooms drawn: the Overview's "Who's where now" is the first step
  const { ctx, log } = makeCtx({ rooms: false });
  FQ.openStep(ctx, "presence");
  check("step:presence on a live house with no rooms stays on the Overview's Who's where", log[0][0] === "view" && log[0][1] === "overview"
    && log.some(x => x[0] === "toast" && /Who's where now/.test(x[1])), log);
}
{
  // rooms drawn, or no live snapshot yet: the receivers, with the line saying why
  for (const opts of [{}, { rooms: false, snapshot: null }]) {
    const { ctx, log } = makeCtx(opts);
    FQ.openStep(ctx, "presence");
    check("step:presence opens the receivers, saying why (" + JSON.stringify(opts) + ")", log[0][0] === "view" && log[0][1] === "receivers"
      && log.some(x => x[0] === "toast" && /Bluetooth receivers/.test(x[1]) && !x[2]), log);
  }
}
{
  const { ctx, log, state } = makeCtx();
  state._mapsWizard = { step: 2 };
  FQ.openStep(ctx, "plan");
  check("step:plan opens Mapping → Upload with the scan offered first", state.mapsTab === "upload" && state._mapsWizard === null
    && state._roughPlan.open === true && state._roughPlan.kind === "scan" && log.some(x => x[1] === "maps"), state);
  // rough_plan.js's own defaults on a new install (no _roughPlan yet): the blank floor's fields read "", not undefined
  check("step:plan on a new install keeps the blank floor's defaults", state._roughPlan.across === "" && state._roughPlan.down === ""
    && state._roughPlan.busy === false, state._roughPlan);
  const kept = makeCtx();
  kept.state._roughPlan = { open: false, kind: null, across: "12", down: "8", busy: false, msg: "x", walk: null };
  FQ.openStep(kept.ctx, "plan");
  check("step:plan keeps what was typed", kept.state._roughPlan.across === "12" && kept.state._roughPlan.down === "8"
    && kept.state._roughPlan.kind === "scan" && kept.state._roughPlan.msg === "", kept.state._roughPlan);
}
{
  const { ctx, log, state } = makeCtx();
  FQ.openStep(ctx, "lights");
  check("step:lights opens the Atlas builder's tour", state.mapsTab === "lights" && state._lightsTour.step === 1
    && log.some(x => x[0] === "event" && x[1] === "lights_tour_opened") && log.some(x => x[1] === "maps"), { log, state });
}
{
  // a new house with no rooms drawn: nothing to place lights in, so the plan first
  const { ctx, log, state } = makeCtx({ rooms: false });
  FQ.openStep(ctx, "lights");
  check("step:lights with no rooms drawn opens the plan step first", state.mapsTab === "upload" && state._roughPlan.kind === "scan"
    && !state._lightsTour && !log.some(x => x[1] === "lights_tour_opened"), { log, state });
}
{
  pushed.length = 0;
  const { ctx, state } = makeCtx({ complexity: "basic" });
  FQ.openStep(ctx, "lights");
  check("step:lights in Basic (no Atlas builder) opens the Atlas", JSON.stringify(pushed) === JSON.stringify(["/padspan-lights"]) && !state._lightsTour, { pushed });
}

// ── the sample house: the presence, plan and lights steps it blocks ──
for (const key of ["presence", "plan", "lights"]) {
  const { ctx, log, state } = makeCtx({ dataMode: "sample", rooms: false });
  FQ.openStep(ctx, key);
  check(`sample:${key} stays on the Overview, no step opened`, JSON.stringify(log) === JSON.stringify([["view", "overview"]])
    && state.mapsTab === "library" && !state._roughPlan && !state._lightsTour && FQ.sampleLineShown(state), { log, state });
  check(`sample:${key} never switches the mode by itself`, state.dataMode === "sample" && !log.some(x => x[0] === "mode"), log);
  const line = FQ.sampleLine(ctx);
  const words = { presence: "Switch to your house to set up your receivers.", plan: "Switch to your house to start your plan.",
                  lights: "Switch to your house to place your lights." }[key];
  check(`sample:${key} says so, one line`, !!line && line.textContent.includes("This is the sample house. " + words), line && line.textContent);
  ctx._refuseMode = true;
  line.querySelector('[data-first-question="sample-go"]').click(); await wait();
  check(`sample:${key} a refused switch opens nothing and keeps the line`, state.dataMode === "sample" && state.mapsTab === "library"
    && !!FQ.sampleLine(ctx), log);
  ctx._refuseMode = false;
  FQ.sampleLine(ctx).querySelector('[data-first-question="sample-go"]').click(); await wait();
  // presence on a live house with no rooms drawn: the Overview's Who's where; the lights answer with no rooms: the plan
  // first, as on the house
  const opened = key === "presence" ? state.view === "overview" && log.some(x => x[0] === "toast" && /Who's where now/.test(x[1]))
    : key === "plan" ? state.mapsTab === "upload" && state._roughPlan.kind === "scan" : state.mapsTab === "upload";
  check(`sample:${key} Back to my house, then the step chosen`, log.filter(x => x[0] === "mode").every(x => x[1] === "live")
    && state.dataMode === "live" && opened && !FQ.sampleLine(ctx) && !FQ.sampleLineShown(state), { log, state });
}
{
  pushed.length = 0;
  const { ctx, log } = makeCtx({ dataMode: "sample" });
  FQ.openStep(ctx, "whole_house");
  check("sample:the whole house is not held back", JSON.stringify(pushed) === JSON.stringify(["/padspan-lights"]) && !FQ.sampleLine(ctx), { log, pushed });
  check("sample:no line with nothing waiting", FQ.sampleLine(makeCtx({ dataMode: "sample" }).ctx) === null);
  const moved = makeCtx({ dataMode: "sample" });
  FQ.openStep(moved.ctx, "plan");
  moved.state.dataMode = "live";            // switched by the banner's own button meanwhile
  check("sample:the line goes once the house is live", FQ.sampleLine(moved.ctx) === null && moved.state._fqSampleStep === null);
}

// ── the next steps ──
{
  const none = FQ.nextSteps({ purpose: [] });
  check("next:none unanswered", Array.isArray(none) && !none.length);
  const withRooms = makeCtx().state;
  const one = FQ.nextSteps({ purpose: ["whole_house"] }, withRooms);
  check("next:the Atlas, then the wall screen tip", one.length === 1 && one[0].id === "wall" && one[0].link === "/padspan-lights?kiosk=1", one);
  const several = FQ.nextSteps({ purpose: ["presence", "plan", "lights", "junk"] }, withRooms);
  check("next:the other answers, the phone not again (Getting started lists it)", JSON.stringify(several.map(s => s.id)) === JSON.stringify(["plan", "lights"]), several);
  const noRooms = makeCtx({ rooms: false }).state;
  const lightsFirst = FQ.nextSteps({ purpose: ["lights", "plan", "presence"] }, noRooms);
  check("next:with no rooms, the Atlas builder after the plan the lights answer opened", JSON.stringify(lightsFirst.map(s => s.id)) === JSON.stringify(["lights", "presence"]), lightsFirst);
  {
    const { ctx, log, state } = makeCtx({ rooms: false, settings: { purpose: ["lights"], purpose_ask: "done" } });
    FQ.nextCard(ctx).querySelector('[data-next="lights"]').click();
    check("next:the Atlas builder offered after the plan opens its tour", state.mapsTab === "lights" && state._lightsTour.step === 1, { log, state });
  }
  {
    const { ctx } = makeCtx({ settings: { purpose: ["whole_house"], purpose_ask: "done" } });
    const card = FQ.nextCard(ctx);
    const a = card.querySelector("a");
    check("next:the wall screen's address is a link", !!a && a.getAttribute("href") === "/padspan-lights?kiosk=1" && a.textContent === "/padspan-lights?kiosk=1"
      && !card.textContent.includes("\u0000") && card.textContent.includes("on the screen: the whole house fits it"), card.textContent);
  }
  const { ctx, log, state } = makeCtx({ settings: { purpose: ["presence", "plan"], purpose_ask: "done" } });
  const card = FQ.nextCard(ctx);
  check("next:no phone step here", !card.querySelector('[data-next="phone"]'));
  card.querySelector('[data-next="plan"]').click();
  check("next:another answer opens its own step", state.mapsTab === "upload", state);
  check("next:no card unanswered", FQ.nextCard(makeCtx({ settings: { purpose: [] } }).ctx) === null);
}

// ── Settings ──
{
  check("settings:not for someone who is not an administrator", FQ.settingsCard(makeCtx({ admin: false }).ctx) === null);
  const { ctx, log } = makeCtx({ settings: { purpose: ["plan"] } });
  const card = FQ.settingsCard(ctx);
  check("settings:shows what was answered", card.querySelector('[data-purpose-setting="plan"]').checked === true
    && card.querySelector('[data-purpose-setting="lights"]').checked === false);
  const c = card.querySelector('[data-purpose-setting="lights"]');
  c.checked = true; c.dispatchEvent({ type: "change" }); await wait();
  check("settings:saves as it is ticked", JSON.stringify(log.filter(x => x[0] === "save")) === JSON.stringify([["save", { purpose: ["plan", "lights"] }]]), log);
  check("settings:never opens a step by itself", !log.some(x => x[0] === "view"), log);
}

console.log(JSON.stringify({ cases, failures }));
