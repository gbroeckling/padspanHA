// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The translated help (i18n/<lang>/help.json, ~340 KB) is fetched on first
// need, not at startup: panel.js's set-hass language lines,
// _loadHelpLanguage, _showHelp and Training's line in _renderCurrentView,
// lifted out and run on a stand-in panel with the real i18n.js and
// help_content.js and a recording fetch.
//
// usage: help_lazy.mjs <www/padspan-ha dir>
// prints one JSON line: { cases, failures }

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WWW = process.argv[2];
const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const settle = () => new Promise(r => setTimeout(r, 30));

const fetched = [];
let gate = null;
globalThis.localStorage = { getItem: () => null };
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  fetched.push(u.pathname);
  if (gate) await gate;
  const rel = decodeURIComponent(u.pathname).split("/i18n/")[1];
  try { const d = JSON.parse(readFileSync(join(WWW, "i18n", rel), "utf-8")); return { ok: true, json: async () => d }; }
  catch (_) { return { ok: false, json: async () => ({}) }; }
};

const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const cut = (a, b) => { const i = src.indexOf(a); return i < 0 ? "" : src.slice(i, src.indexOf(b, i)); };
const hassLines = cut("    const langSeen = hass ?", "\n    if(this.state?.settings?.theme_follow_sun");
const methods = cut("  _loadHelpLanguage(){", "\n  /** The help modal itself");
const trainingLine = 'if(this.state.view === "training" && !this._helpLoad) this._loadHelpLanguage();';
check("lifted", hassLines && methods.includes("_showHelp(key){") && src.includes(trainingLine));

// A fresh i18n.js + help_content.js pair per stand-in panel (help_content.js
// imports i18n.js with its own query, so one query = one shared instance).
let n = 0;
async function panel(language, view = "overview") {
  const q = `?b=L${n++}`;
  const I18N = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href + q);
  const HELP_MOD = await import(pathToFileURL(join(WWW, "help_content.js")).href + q);
  const make = new Function("_i18nPromise", "_criticalPromise", "HELP_MOD",
    `let HELP = HELP_MOD.HELP; return { help: () => HELP, cls: class {
       setHass(hass){ this._hass = hass; ${hassLines} }
       renderView(){ ${trainingLine} }
       ${methods}
     } };`);
  const { help, cls } = make(Promise.resolve(I18N), Promise.resolve(), HELP_MOD);
  const p = new cls();
  p.state = { view };
  p.renders = 0;
  p.opened = [];
  p._scheduleRender = () => { p.renders++; };
  p._openHelp = (key) => { p.opened.push(help()[key].title); };
  p.setHass({ language });
  return { p, help, HELP_MOD };
}

const de = JSON.parse(readFileSync(join(WWW, "i18n", "de", "help.json"), "utf-8"));
{
  const f0 = fetched.length;
  const { p, HELP_MOD } = await panel("de");
  await settle();
  p.setHass({ language: "de" });
  await settle();
  check("startup: no help.json until the help is needed", fetched.length === f0, fetched.slice(f0));
  p._showHelp("follow");
  await settle();
  check("first ?: fetches de/help.json once and opens it translated",
    fetched.length === f0 + 1 && fetched[f0].endsWith("/i18n/de/help.json")
    && p.opened.length === 1 && p.opened[0] === de[HELP_MOD.HELP.follow.title], { fetched: fetched.slice(f0), opened: p.opened });
  p._showHelp("follow");
  check("second ?: opens at once, no new fetch", p.opened.length === 2 && fetched.length === f0 + 1);
}
{
  const f0 = fetched.length;
  const { p, HELP_MOD } = await panel("en");
  p._showHelp("follow");
  await settle();
  check("English: fetches nothing, opens the English",
    fetched.length === f0 && p.opened[0] === HELP_MOD.HELP.follow.title, { fetched: fetched.slice(f0), opened: p.opened });
}
{
  const f0 = fetched.length;
  const { p, help, HELP_MOD } = await panel("fr", "training");
  await settle();
  check("Training not open: nothing fetched", fetched.length === f0);
  p.renderView();
  await settle();
  check("Training opened: fetches fr/help.json and redraws once",
    fetched.length === f0 + 1 && fetched[f0].endsWith("/i18n/fr/help.json") && p.renders === 1
    && help().follow.title !== HELP_MOD.HELP.follow.title, { fetched: fetched.slice(f0), renders: p.renders });
  p.renderView();
  await settle();
  check("Training again: no new fetch, no redraw", fetched.length === f0 + 1 && p.renders === 1);
}
{
  const { p, HELP_MOD } = await panel("nl");
  let open; gate = new Promise(r => { open = r; });
  p._showHelp("follow");
  await new Promise(r => setTimeout(r, 2150));
  check("slow help.json: the English opens after 2 s", p.opened.length === 1 && p.opened[0] === HELP_MOD.HELP.follow.title, p.opened);
  open(); gate = null;
  await settle();
  check("and the late arrival opens nothing twice", p.opened.length === 1, p.opened);
}

console.log(JSON.stringify({ cases, failures }));
