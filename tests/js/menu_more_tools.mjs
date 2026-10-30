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
const methods = ["_getVisibleTabs", "_getMainTabs", "_moreToolsOpen", "_toggleMoreTools",
                 "_keepsLinkedView", "_renderNav", "_setComplexity"].map(method).join("\n");
// The constructor's ?view= block, as a method.
const deepLink = cut("      const q = new URLSearchParams(window.location.search);", "\n    } catch(e) { /* ignore */ }");

const make = new Function("EDITIONS", "VIEWS", "_loadView",
  consts + "\nclass P {\n" + methods + "\n_deepLink(){\n" + deepLink + "\n}\n}\n"
  + "return { P, MENU, BASIC_TABS, ADVANCED_DEFAULT, DEV_ONLY_TABS, MENU_GROUPS, _VIEW_PATHS };");

const EDITIONS = { surfacesForEdition: (ids) => ids.slice() };
const { P, MENU, BASIC_TABS, ADVANCED_DEFAULT, DEV_ONLY_TABS, _VIEW_PATHS } = make(EDITIONS, {}, async () => null);

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
const gated = new Set(["forensics", "guests"]);
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
    const wantMain = [...(mode === "basic" ? BASIC_TABS : ADVANCED_DEFAULT)];
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

console.log(JSON.stringify({ cases, failures, menus }));
