// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Health's problems in plain words, one step from the fix (2026-11-21), RUN:
//   critics   each card's kind and seriousness in words, its detail line,
//             and a "Go there" button that opens the screen that fixes it
//   banner    a new house's next steps alone are not issues
//   dot       what the status dot says is listed at the top of Health, each
//             line with its screen; the dot's issues carry that screen
//   support   Health opens Diagnostics
// The pytest wrapper is tests/test_plain_problems.py.
//
// Run:  node tests/js/plain_problems.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const HEALTH = await import(pathToFileURL(V + "health.js").href);
const DOT = await import(pathToFileURL(V + "status_dot.js").href);
const DIAG = await import(pathToFileURL(V + "diagnostics.js").href);

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const html = (n) => [n, ...all(n)].map(x => x.innerHTML || "").join(" ");
const buttons = (n, sel) => all(n).filter(x => x.getAttribute && x.getAttribute(sel) != null);

const MAPS = [{ id: "ground", name: "Ground", floor_id: "main" }, { id: "attic", name: "Attic", floor_id: "upper" }];

function makeCtx(state, ws = {}, issues = []) {
  const opened = [];
  const s = Object.assign({ dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "health", version: "0",
    buildId: "b", settings: {}, timing: {}, roomTagMap: {}, wsCounts: {}, model: { floors: [] },
    maps: { list: MAPS }, live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} } } } }, state);
  const FABRIC = { summary: { total: 0, passed: 0, failed: 0, healthy: true }, checks: [], adjacency: {}, fabric_floors: {} };
  const call = async (p) => (ws[p && p.type] !== undefined ? ws[p.type] : p && p.type === "padspan_ha/fabric_health" ? FABRIC : {});
  const ctx = {
    hass: { user: { is_admin: true } }, state: s, toast: () => {},
    helpers: { el, helpBtn: () => el("button", {}, "?"), radioShortId: () => "", errorText: (e) => String(e && e.message || e),
      statusIssues: () => issues.slice() },
    actions: { callWS: call, renderRooms: () => {}, renderNav: () => {}, canOpen: () => true, telemetryEvent: () => {},
      showView: (id) => { s.view = id; opened.push(id); }, openReceivers: () => { s.view = "receivers"; opened.push("receivers"); },
      setMapsTab: (t) => { s.mapsTab = t; } },
  };
  return { ctx, s, opened };
}

const CRITICS = {
  summary: { total: 5, critical: 1, warning: 2, info: 2, healthy: false },
  critics: [
    { category: "map_geometry", severity: "critical", title: "PadSpan can't read where “Attic” goes", message: "m", action: "a",
      detail: "The stored placement is not a placement.", go: { to: "measure", map_id: "attic" } },
    { category: "room_footprint", severity: "warning", title: "t", message: "m", action: "a", detail: "Rooms span 1m × 1m", go: { to: "layout", floor_id: "upper" } },
    { category: "scanner", severity: "warning", title: "t", message: "m", action: "a", detail: "Reliability 0.50", go: { to: "receivers", source: "AA" } },
    { category: "calibration", severity: "info", title: "Next step: calibrate", message: "m", action: "a", detail: "d", go: { to: "calibrate" } },
    { category: "propagation", severity: "info", title: "t", message: "m", action: "a", detail: "d", go: { to: "adaptive_learning" } },
  ],
  confusion_matrix: [{ room_a: "Kitchen", room_b: "Hall", count: 9, rate: 0.2 }], per_map_quality: [],
};

// ── critics ──
{
  const { ctx } = makeCtx({}, { "padspan_ha/system_critics": CRITICS });
  const root = HEALTH.render(ctx);
  await flush(16);
  const h = html(root), t = text(root);
  check("critics: kinds in words, never the ids", h.includes("Floor plan") && h.includes("Room sizes") && h.includes("Signal and learning")
    && !h.includes("propagation") && !h.includes("room footprint") && !h.includes("map geometry"), h.slice(0, 600));
  check("critics: seriousness in words", h.includes("Fix this") && h.includes("Worth fixing") && h.includes("Good to know")
    && !/• (critical|warning|info)\b/.test(h), h.slice(0, 600));
  check("critics: the detail line keeps the figures", h.includes("Details: The stored placement is not a placement.") && h.includes("Details: Reliability 0.50"), h.slice(0, 900));
  const go = buttons(root, "data-go").map(b => b.getAttribute("data-go") + "=" + text(b));
  check("critics: each has its Go there button", JSON.stringify(go) === JSON.stringify(
    ["measure=Measure", "layout=Open Layout", "receivers=Open Receivers", "calibrate=Calibrate", "adaptive_learning=Open the setting"]), go);
  check("critics: the banner counts what to fix", t.includes("3 ISSUES") && t.includes("1 to fix · 2 worth fixing · 2 good to know"), t.slice(0, 900));
  check("mix-ups: moves, not bidirectional transitions", t.includes("Moves") && !t.includes("Bidirectional") && !t.includes("Transitions"), t.slice(-600));
}

// ── Go there: each opens its screen the panel's own way ──
{
  const go = (target, state = {}) => { const m = makeCtx(state); HEALTH.goThere(m.ctx, target); return m; };
  let m = go({ to: "measure", map_id: "attic" });
  check("go measure: the Mapping wizard's scale step on that plan", m.s.view === "maps" && m.s._mapsWizard && m.s._mapsWizard.step === 2 && m.s._mapsWizard.mapId === "attic", m.s._mapsWizard);
  m = go({ to: "measure", map_id: "gone" }, { activeMapId: "ground" });
  check("go measure: a plan that is gone falls back to the open one", m.s._mapsWizard.mapId === "ground", m.s._mapsWizard);
  m = go({ to: "calibrate", map_id: "attic" });
  check("go calibrate: the guided calibration, on that plan", m.s.view === "calibration" && m.s._calibWizard && m.s._calibWizard.step === 1 && m.s.activeMapId === "attic", [m.s.view, m.s._calibWizard]);
  m = go({ to: "layout", floor_id: "upper" }, { maps: { list: MAPS, _roomsFloorId: "main", _roomsDraftFloorId: "main" } });
  check("go layout: Mapping → Layout on that floor", m.s.view === "maps" && m.s.mapsTab === "rooms" && m.s.maps._roomsFloorId === "upper" && m.s.maps._roomsDraftFloorId === null, [m.s.mapsTab, m.s.maps]);
  m = go({ to: "receivers", problems: true }, { _receivers: { sort: "room", dir: -1, problems: false } });
  check("go receivers: the Receivers page, problems only when asked", m.s.view === "receivers" && m.s._receivers.problems === true && m.s._receivers.sort === "room", m.s._receivers);
  m = go({ to: "adaptive_learning" });
  check("go setting: Settings → Tracking, scrolled to the card", m.s.view === "settings" && m.s._settingsTab === "presence" && m.s._settingsPart === "adaptive_learning", [m.s.view, m.s._settingsTab]);
  m = go({ to: "adaptive_learning" }, { complexity: "basic" });
  check("go setting in Basic: only that card", m.s._focus && m.s._focus.part === "adaptive_learning" && !m.s._settingsPart, m.s._focus);
  m = go({ to: "diagnostics" });
  check("go diagnostics", m.s.view === "diagnostics", m.s.view);
  const basic = makeCtx({ complexity: "basic" }).ctx;
  check("Basic has no Layout tab, so no Layout button", HEALTH.canGo(basic, { to: "layout", floor_id: "x" }) === false && HEALTH.canGo(basic, { to: "calibrate" }) === true);
  const none = makeCtx({ maps: { list: [] } }).ctx;
  check("no plan, no Measure button", HEALTH.canGo(none, { to: "measure", map_id: "x" }) === false);
  check("an unknown screen gets no button", HEALTH.canGo(makeCtx().ctx, { to: "nowhere" }) === false && HEALTH.canGo(makeCtx().ctx, null) === false);
}

// ── banner: next steps only ──
// (Health keeps its answers 30 s per data mode: another mode reads afresh.)
{
  const { ctx } = makeCtx({ dataMode: "new-house" }, { "padspan_ha/system_critics": { summary: { total: 1, critical: 0, warning: 0, info: 1, healthy: false },
    critics: [{ category: "calibration", severity: "info", title: "Next step: calibrate", message: "m", action: "a", detail: "d", go: { to: "calibrate" } }],
    confusion_matrix: [], per_map_quality: [] } });
  const root = HEALTH.render(ctx);
  await flush(16);
  const t = text(root);
  check("a new house's next step is not an issue", t.includes("NOTHING TO FIX") && t.includes("Nothing to fix. 1 good to know.") && !t.includes("ISSUE"), t.slice(-700));
}

// ── the status dot's words at the top of Health ──
{
  const issues = DOT.statusIssues({ live: true, failed: false, snapshot: { suspended: true, ble: { radios: [
    { source: "aa", last_heard_s: 900 }, { source: "bb", last_heard_s: 3 }] } } });
  check("dot: each issue names its screen", JSON.stringify(issues.map(i => [i.id, i.go && i.go.to, !!(i.go && i.go.problems)]))
    === JSON.stringify([["receivers_silent", "receivers", true], ["learning_suspended", "overview", false]]), issues);
  check("dot: no answer opens Diagnostics", DOT.statusIssues({ live: true, failed: true })[0].go.to === "diagnostics");
  const { ctx } = makeCtx({}, {}, issues);
  const root = HEALTH.render(ctx);
  const now = all(root).find(n => n.getAttribute && n.getAttribute("data-health-now"));
  check("dot: Health lists what the dot says", !!now && now.getAttribute("data-health-now") === "amber"
    && text(now).includes("Something needs attention") && text(now).includes("1 receiver hasn't been heard from in over 10 minutes."), now && text(now));
  const go = now ? buttons(now, "data-go").map(b => b.getAttribute("data-go")) : [];
  check("dot: each line has its button", JSON.stringify(go) === JSON.stringify(["receivers", "overview"]), go);
  const quiet = makeCtx({}, {}, []);
  check("dot: nothing to say, no card", !all(HEALTH.render(quiet.ctx)).some(n => n.getAttribute && n.getAttribute("data-health-now")));
}

// ── Scanner Health: the column is reliability (1 / (1 + disagreement)), not a weight ──
{
  const sh = { AA: { reliability: 0.62, agree_pct: 40, polls: 20, room: "Hall" } };
  const m = makeCtx({ dataMode: "scanner-health", live: { snapshot: { ble: { radios: [{ source: "AA", name: "Hall proxy" }] },
    objects: { list: [], summary: {} }, scanner_health: sh } } });
  const root = HEALTH.render(m.ctx), t = text(root), h = html(root);   // the warning is drawn as markup
  check("scanner health: the column says Reliability", t.includes("Reliability") && !t.includes("Weight")
    && h.includes("1 receiver often points to a different room than the others") && h.includes("reliability below 0.7"), [t.slice(0, 600), h.slice(0, 600)]);
}

// ── support: Diagnostics from Health ──
{
  const m = makeCtx();
  const root = HEALTH.render(m.ctx);
  const b = all(root).find(n => n.getAttribute && n.getAttribute("data-open-diagnostics") === "health");
  if (b) b.dispatchEvent({ type: "click" });
  check("support: Health opens Diagnostics", !!b && m.s.view === "diagnostics" && !text(root).includes("QA → Go to Diagnostics"), text(root).slice(0, 500));
}

// ── Diagnostics: the report, copied, then the email or the issue opened ──
{
  const m = makeCtx({ view: "diagnostics", status: {}, versionInfo: {}, diag: null });
  m.ctx.helpers.helpBtn = () => el("button", {}, "?");
  const root = DIAG.render(m.ctx);
  const send = Object.fromEntries(all(root).filter(n => n.getAttribute && n.getAttribute("data-diag-send"))
    .map(n => [n.getAttribute("data-diag-send"), [text(n), n.getAttribute("href"), n.getAttribute("target")]]));
  check("diagnostics: Email support writes to hello@traks.ca", send.mail && send.mail[0] === "Email support"
    && send.mail[1].startsWith("mailto:hello@traks.ca?subject=PadSpan%20problem") && send.mail[2] === "_blank", send);
  check("diagnostics: Open an issue opens a new GitHub issue", send.issue && send.issue[0] === "Open an issue"
    && send.issue[1] === "https://github.com/gbroeckling/padspanHA/issues/new", send);
  let copied = null;
  globalThis.navigator = { clipboard: { writeText: async (t) => { copied = t; } } };
  let toast = "";
  m.ctx.toast = (t) => { toast = t; };
  const issue = all(root).find(n => n.getAttribute && n.getAttribute("data-diag-send") === "issue");
  issue.dispatchEvent({ type: "click" });
  for (let i = 0; i < 20; i++) await Promise.resolve();   // the clipboard's promise, then the toast
  check("diagnostics: the same report goes to the clipboard first", typeof copied === "string" && copied.includes('"ui"')
    && toast.includes("issues are public"), [String(copied).slice(0, 80), toast]);
}

console.log(JSON.stringify(results));
