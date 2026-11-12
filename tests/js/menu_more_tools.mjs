// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The sidebar menu's More tools group (2026-10-30: modes stop hiding
// screens), run for real: panel.js's menu constants and its menu methods
// (_getVisibleTabs, _getMainTabs, _moreToolsOpen, _toggleMoreTools,
// _keepsLinkedView, _renderNav, _setComplexity) and its ?view= block lifted
// onto a stand-in panel under the DOM shim, in both skins and every mode.
//
// usage: menu_more_tools.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], menus: {...} }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
shim.install(globalThis);
const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");

const cut = (from, to) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error("not found: " + from);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error("not found after " + from + ": " + to);
  return src.slice(a, b);
};
const fn = (head) => cut(head, "\n}\n") + "\n}\n";
const method = (name) => cut(`\n  ${name}(`, "\n  }\n").slice(1) + "\n  }\n";

const consts = [
  cut("const _VIEW_PATHS = {", "\n};\n") + "\n};\n",
  cut("const _VIEW_PATHS_HIDDEN_OK", "\n") + "\n",
  cut("const MENU = [", "// ── DOM Utility Functions"),
  fn("function esc(s){"),
  fn("function el(tag, attrs={}, children=[]){"),
].join("\n");
const methods = ["_getVisibleTabs", "_setupInMenu", "_getMainTabs", "_moreToolsOpen", "_toggleMoreTools",
                 "_keepsLinkedView", "_renderNav", "_setComplexity"].map(method).join("\n");
// The constructor's ?view= block, as a method.
const deepLink = cut("      const q = new URLSearchParams(window.location.search);", "\n    } catch(e) { /* ignore */ }");

const make = new Function("EDITIONS", "VIEWS", "_loadView", "SETUP_STATUS",
  consts + "\nclass P {\n" + methods + "\n_deepLink(){\n" + deepLink + "\n}\n}\n"
  + "return { P, MENU, BASIC_TABS, ADVANCED_DEFAULT, DEV_ONLY_TABS, MENU_GROUPS, _VIEW_PATHS };");

const EDITIONS = { surfacesForEdition: (ids) => ids.slice() };
const SETUP_STATUS = await import(pathToFileURL(join(WWW, "views", "setup_status.js")).href);
const { P, MENU, BASIC_TABS, ADVANCED_DEFAULT, DEV_ONLY_TABS, MENU_GROUPS, _VIEW_PATHS } = make(EDITIONS, {}, async () => null, SETUP_STATUS);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

function panel({ mode = "advanced", skin = "2025", settings = {}, view = "overview" } = {}) {
  const root = document.createElement("div");
  const ids = {};
  for (const id of ["navLabel", "mobileBottomNav", "mobileTitle", "mobileModePill", "app", "sideBackdrop"]) {
    const n = document.createElement("div"); n.id = id; root.appendChild(n); ids[id] = n;
  }
  const p = new P();
  Object.assign(p, {
    state: { complexity: mode, view, settings: { forensics_enabled: false, guest_tags_enabled: false, ...settings } },
    _skin: skin, _settingsLoaded: true, events: [], renders: 0,
    $nav: document.createElement("nav"),
    shadowRoot: { querySelector: (s) => ids[s.replace(/^#/, "")] || null },
    $: (s) => ids[s.replace(/^#/, "")] || null,
    _telemetryEvent(n) { this.events.push(n); },
    _logEvent() {}, _scheduleRender() { this.renders++; }, _paintDataModeLabel() {},
    _renderSidebarTrial() {}, _updateBadges() {}, _closeDrawer: null,
  });
  return p;
}
const navIds = (p) => p.$nav.children.filter(n => n.classList.contains("navbtn") && !n.classList.contains("navmore"))
  .map(n => { const lbl = n.textContent.trim(); const m = MENU.find(x => x[1] === lbl); return m ? m[0] : lbl; });
const moreBtn = (p) => p.$nav.children.find(n => n.classList.contains("navmore")) || null;
const afterMore = (p) => { const i = p.$nav.children.indexOf(moreBtn(p)); return i < 0 ? [] : navIds({ $nav: { children: p.$nav.children.slice(i + 1) } }); };
const beforeMore = (p) => { const i = p.$nav.children.indexOf(moreBtn(p)); return navIds({ $nav: { children: i < 0 ? p.$nav.children : p.$nav.children.slice(0, i) } }); };
const allIds = MENU.map(x => x[0]);
// Setup is in the menu only while the house's steps are not all done (owner's D4, 2026-11-13; its own block below).
const gated = new Set(["forensics", "guests", "setup"]);
const menus = {};

for (const skin of ["2025", "classic"]) {
  for (const mode of ["basic", "advanced", "development"]) {
    const tag = `${mode}/${skin}`;
    localStorage.clear();
    const p = panel({ mode, skin });
    p._renderNav();
    const main = beforeMore(p);
    const btn = moreBtn(p);
    check(`closed: ${tag}: More tools is there and closed by default`,
      btn && btn.getAttribute("aria-expanded") === "false" && afterMore(p).length === 0, { main, after: afterMore(p) });
    const wantMain = [...(mode === "basic" ? BASIC_TABS : ADVANCED_DEFAULT)].filter(id => id !== "setup");
    check(`main: ${tag}: the main groups are the mode's everyday screens`,
      main.length === wantMain.length && wantMain.every(id => main.includes(id)), { main, wantMain });
    btn.click();
    const more = afterMore(p);
    check(`open: ${tag}: opening lists the rest, counts it once, keeps the mode and remembers it`,
      moreBtn(p).getAttribute("aria-expanded") === "true" && localStorage.getItem("padspan_more_tools") === "open"
      && JSON.stringify(p.events) === JSON.stringify(["menu_more_tools_open"]) && p.state.complexity === mode,
      { events: p.events, mode: p.state.complexity });
    const listed = new Set([...beforeMore(p), ...more]);
    check(`reach: ${tag}: every screen is in the menu (Forensics/Guests only while on)`,
      allIds.filter(id => !gated.has(id)).every(id => listed.has(id)) && !listed.has("forensics") && !listed.has("guests")
      && listed.size === beforeMore(p).length + more.length, { missing: allIds.filter(id => !gated.has(id) && !listed.has(id)) });
    check(`more: ${tag}: every Development-only screen is under More tools`,
      DEV_ONLY_TABS.every(id => more.includes(id)), { more });
    menus[tag] = { main, more };
    // A More tools screen opened from the menu: the mode stays.
    for (const id of DEV_ONLY_TABS) {
      const b = p.$nav.children.find(n => n.classList.contains("navbtn") && n.textContent.trim() === MENU.find(x => x[0] === id)[1]);
      b.click();
    }
    check(`stay: ${tag}: opening each More tools screen keeps the mode and the screen`,
      p.state.complexity === mode && p.state.view === DEV_ONLY_TABS[DEV_ONLY_TABS.length - 1]
      && p.events.filter(e => e.startsWith("tab:")).length === DEV_ONLY_TABS.length, { mode: p.state.complexity, view: p.state.view });
    // Remembered: a new page load (fresh panel, same browser) starts open; closing is remembered and not counted.
    const again = panel({ mode, skin });
    again._renderNav();
    moreBtn(again).click();
    again._renderNav();
    check(`remember: ${tag}: open survives a reload; closing is remembered, not counted`,
      moreBtn(p).getAttribute("aria-expanded") === "true" && moreBtn(again).getAttribute("aria-expanded") === "false"
      && localStorage.getItem("padspan_more_tools") === "closed" && again.events.length === 0, { events: again.events });
  }
}

// Closed, the group still shows the screen that is open now.
{
  localStorage.clear();
  const p = panel({ mode: "basic", view: "bluetooth" });
  p._renderNav();
  check("closed: a closed group still shows the More tools screen open now, highlighted",
    JSON.stringify(afterMore(p)) === JSON.stringify(["bluetooth"]) && p.state.view === "bluetooth"
    && p.$nav.children.some(n => n.classList.contains("active")), { after: afterMore(p) });
}

// Switching modes on a More tools screen keeps the screen.
for (const view of ["devices", "traceback", "qa"]) {
  localStorage.clear();
  const p = panel({ mode: "development", view });
  p._renderNav();
  p._setComplexity("advanced");
  const a = p.state.view;
  p._setComplexity("basic");
  check(`stay: switching to Advanced then Basic on ${view} keeps ${view}`, a === view && p.state.view === view, { a, b: p.state.view });
}

// UI Structure's opt-ins: in the main groups in Advanced and Development, not in Basic.
{
  localStorage.clear();
  const opt = { advanced_extra_tabs: ["devices", "bluetooth"] };
  const out = {};
  for (const mode of ["basic", "advanced", "development"]) {
    const p = panel({ mode, settings: opt });
    p._renderNav();
    moreBtn(p).click();
    out[mode] = { main: beforeMore(p), more: afterMore(p) };
  }
  localStorage.clear();
  check("optin: a tab opted in under UI Structure is a main tab in Advanced and Development, More tools in Basic",
    ["advanced", "development"].every(m => out[m].main.includes("devices") && out[m].main.includes("bluetooth") && !out[m].more.includes("devices"))
    && out.basic.more.includes("devices") && !out.basic.main.includes("devices"), out);
}

// Forensics and Guests: in the main groups while switched on, in every mode; gone while off.
{
  const out = {};
  for (const mode of ["basic", "advanced", "development"]) {
    const p = panel({ mode, settings: { forensics_enabled: true, guest_tags_enabled: true } });
    p._renderNav();
    out[mode] = beforeMore(p);
  }
  check("gated: Forensics and Guests switched on are main tabs in every mode",
    Object.values(out).every(m => m.includes("forensics") && m.includes("guests")), out);
}

// ?view= links, every view, every mode: the screen opens and stays, the mode unchanged.
{
  const bad = [];
  const real = globalThis.window;
  for (const mode of ["basic", "advanced", "development"]) {
    for (const id of Object.keys(_VIEW_PATHS)) {
      if (gated.has(id)) continue;
      globalThis.window = { location: { search: "?view=" + id } };
      localStorage.clear();
      const p = panel({ mode, view: "overview" });
      p.state.maps = {};
      p._deepLink();
      p._renderNav();
      p._renderNav();
      if (p.state.view !== id || p.state.complexity !== mode) bad.push({ mode, id, got: p.state.view, mode_now: p.state.complexity });
    }
  }
  globalThis.window = real;
  check("link: a ?view= link opens its screen in every mode and leaves the mode alone", bad.length === 0, bad.slice(0, 6));
}

// The phone drawer is the sidebar: More tools is in it; the bottom bar keeps its pinned tabs + More.
{
  localStorage.clear();
  const p = panel({ mode: "basic" });
  p._renderNav();
  const bar = p.shadowRoot.querySelector("#mobileBottomNav").children.map(n => n.innerHTML.replace(/<[^>]+>/g, ""));
  check("phone: the bottom bar keeps its pinned tabs and More; the drawer (the sidebar) has More tools",
    JSON.stringify(bar) === JSON.stringify(["Follow", "Overview", "Mapping", "Settings", "More"]) && !!moreBtn(p), { bar });
}

// Setup in the menu (owner's D4, 2026-11-13): at the top of the build group until every step is done, in every mode and
// both skins, in the phone's drawer too (the drawer is the sidebar); then out of it; never before the answer is known.
{
  // Review 2026-11-11: a scale is the placement's positive size (setup_status.hasScale), as Measure writes it. (Item 0 of
  // the next round: any house not finished or skipped has Setup, an empty one too; below.)
  const house = (done) => ({
    dataMode: "live", _mapsLoaded: true, _modelLoaded: true,
    maps: { list: done ? [{ id: "m1", receivers: [{ id: "r1" }], room_bounds: { K: {} } }] : [{ id: "m1", receivers: [], room_bounds: {} }] },
    model: { floors: [{ id: "main" }], room_geometry_m: done ? { K: {} } : {},
      map_transforms: done ? { m1: { scale_x_m: 10, scale_y_m: 8, reference_measurements: [{}] } } : {} },
    calibration: { points: done ? [1, 2, 3, 4, 5] : [] },
  });
  for (const skin of ["2025", "classic"]) {
    for (const mode of ["basic", "advanced", "development"]) {
      const tag = `${mode}/${skin}`;
      localStorage.clear();
      const p = panel({ mode, skin });
      Object.assign(p.state, house(false));
      p._renderNav();
      const main = beforeMore(p);
      const build = MENU_GROUPS.find(g => g[0] === "Build")[1].filter(id => main.includes(id));
      check(`setup: ${tag}: unfinished, Setup is a main tab at the top of the build group`, main.includes("setup") && build[0] === "setup"
        && main.indexOf("setup") === main.indexOf("maps") - 1, main);
      const f = panel({ mode, skin });
      Object.assign(f.state, house(true));
      f._renderNav();
      moreBtn(f) && moreBtn(f).click();
      check(`setup: ${tag}: every step done, Setup steps out of the menu (More tools too)`, ![...beforeMore(f), ...afterMore(f)].includes("setup"), beforeMore(f));
    }
  }
  // Review 2026-11-11: Calibration's points are asked only when calibration is the step that decides (every other one
  // done): once a page load, never on a wall screen, not on the Overview (it asks them itself); a failure, never again.
  const asked = [];
  const u = panel({ mode: "basic", view: "devices" });
  Object.assign(u.state, house(true), { calibration: null });
  u._callWS = (m) => { asked.push(m.type); return new Promise(() => {}); };
  u._renderNav(); u._renderNav();
  check("setup: not shown before Calibration's points are known; asked for once", !beforeMore(u).includes("setup")
    && JSON.stringify(asked) === '["padspan_ha/calibration_get"]', asked);
  const fails = [];
  const uf = panel({ mode: "basic", view: "devices" });
  Object.assign(uf.state, house(true), { calibration: null });
  uf._callWS = (m) => { fails.push(m.type); return Promise.reject(new Error("down")); };
  uf._renderNav(); for (let i = 0; i < 4; i++) await Promise.resolve(); uf._renderNav(); uf._renderNav();
  check("setup: a failed ask leaves the menu as it is, and is not asked again on this page", fails.length === 1 && !beforeMore(uf).includes("setup"), fails);
  for (const [tag, o] of [["a wall screen", { kioskMode: true }], ["the Overview (it asks itself)", { view: "overview" }],
    ["a plan still to measure (calibration decides nothing)", { maps: { list: [{ id: "m1", receivers: [], room_bounds: {} }] }, model: { floors: [{ id: "main" }], map_transforms: {} } }]]) {
    const w = [], pw = panel({ mode: "basic", view: "devices" });
    Object.assign(pw.state, house(true), { calibration: null }, o);
    pw._callWS = (m) => { w.push(m.type); return new Promise(() => {}); };
    pw._renderNav();
    check(`setup: calibration not asked on ${tag}`, w.length === 0, w);
  }
  // Finished or skipped: one rule (panel.js _setupInMenu).
  const inMenu = (st) => { const x = panel({ mode: "advanced" }); Object.assign(x.state, house(false), st); x._renderNav(); return beforeMore(x).includes("setup"); };
  // Changed in review 2026-11-11 item 0: this asserted an empty house was NOT pinned; the owner's rule is "until every step
  // is done", and a brand-new house with no plan is exactly who needs Setup. Not before the plans and the model are in.
  check("setup: a new house with nothing yet has it", inMenu({ maps: { list: [] } }) && inMenu({ maps: { list: [] }, settings: { setup_progress: { at: "plan" } } }));
  check("setup: a new house waits for the plans and the model", !inMenu({ maps: { list: [] }, _mapsLoaded: false }) && !inMenu({ maps: { list: [] }, _modelLoaded: false }));
  check("setup: Skip setup takes it out of the menu", !inMenu({ settings: { onboarding_completed: true } }) && !inMenu({ maps: { list: [] }, settings: { onboarding_completed: true } }));
  check("setup: Setup's own Finish takes it out of the menu", !inMenu({ maps: { list: [] }, settings: { setup_progress: { done: true } } }));
  check("setup: every step left skipped takes it out of the menu", !inMenu({ settings: { setup_progress: { skipped: ["scale", "rooms", "receivers", "calibration"] } } })
    && inMenu({ settings: { setup_progress: { skipped: ["scale", "rooms"] } } }));
  check("setup: a wall screen never has it", !inMenu({ kioskMode: true }));
  // A vacuum import's scale (no measurement on record) is a scale: the house is finished, Setup steps out.
  check("setup: a vacuum-scaled finished house is out of the menu", !inMenu({ ...house(true), model: { ...house(true).model, map_transforms: { m1: { scale_x_m: 12, scale_y_m: 9 } } } }));
  const sm = panel({ mode: "basic" });
  Object.assign(sm.state, house(false), { dataMode: "sample" });
  sm._renderNav();
  check("setup: not in the menu while the demo house shows", !beforeMore(sm).includes("setup"));
  // The phone: the drawer is the sidebar, so Setup is in it; still reached by link when out of the menu.
  check("setup: Setup stays reachable when out of the menu (a hidden-OK view)", _VIEW_PATHS.setup && src.includes('"devices", "setup"]);'));
}

console.log(JSON.stringify({ cases, failures, menus }));
