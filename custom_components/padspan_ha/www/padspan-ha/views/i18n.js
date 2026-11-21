// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The panel's translations. English is the source text AND the key:
// t("Restore") is "Restore" until a shipped language loads, so English never
// fetches a file. Others come lazily from ../i18n/<lang>/<group>.json, a flat
// {"English": "Translation"} map; a string missing there stays English.
// Plurals: tn(n, "1 device", "{n} devices"), the entry {"one", "other"} keyed
// by the English "other". Plain text out: callers use textContent or esc().
// Nothing runs on import. tests/test_panel_i18n.py holds the files to it.

// Filled into {product}. The Bright build's rename rewrites this one literal,
// so no translation names "PadSpan HA" itself; PadSpan, PadSpan™ and
// PadSpan Pro stay exactly as the English writes them.
export const PRODUCT = "PadSpan HA";

// Shipped languages, used when the HA profile (or the per-browser choice) is
// one of them. Everyone else sees English.
export const LANGUAGES = Object.freeze(["nl", "de", "fr"]);

const _PH = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
let _lang = "en";
let _cat = null;           // the loaded language's strings, null = English
let _groups = new Set();
const _want = new Set();   // every group asked for: each call loads them all
let _req = 0;              // the latest useLanguage() call

/** This browser's base language: its own choice (localStorage padspan_lang),
 *  the HA profile, then HA's own. de-AT -> de. */
export function langOf(hass) {
  let pick = "";
  try { pick = localStorage.getItem("padspan_lang") || ""; } catch (_) { /* no storage */ }
  const raw = pick || (hass && hass.locale && hass.locale.language) || (hass && hass.language) || "en";
  return String(raw).toLowerCase().split(/[-_]/)[0] || "en";
}

export function currentLanguage() { return _lang; }

/** Group g loaded for the language now in use. */
export const loaded = (g) => _groups.has(g);

/** Load `groups` and every group asked for before in hass's language. English
 *  or one not shipped loads nothing; a group that fails stays English (none
 *  loaded: all of it). An overtaken call changes nothing. */
export async function useLanguage(hass, groups = ["core"], shipped = LANGUAGES) {
  groups.forEach(g => _want.add(g));
  const lang = langOf(hass), req = ++_req;
  if (lang === "en" || !shipped.includes(lang)) { _lang = "en"; _cat = null; _groups = new Set(); return "en"; }
  const same = lang === _lang && _cat;
  const cat = same ? _cat : Object.create(null), got = same ? _groups : new Set();
  const q = new URL(import.meta.url).search;
  await Promise.all([..._want].filter(g => !got.has(g)).map(async g => {
    try {
      const r = await fetch(new URL(`../i18n/${lang}/${g}.json${q}`, import.meta.url));
      if (r.ok) { Object.assign(cat, await r.json()); got.add(g); }
    } catch (_) { /* stays English */ }
  }));
  if (req !== _req) return _lang;
  if (!got.size) { _lang = "en"; _cat = null; _groups = new Set(); return "en"; }
  _lang = lang; _cat = cat; _groups = got;
  return lang;
}

function fill(s, vars) {
  if (s.indexOf("{") < 0) return s;
  return s.replace(_PH, (m, k) => (vars && Object.prototype.hasOwnProperty.call(vars, k)) ? String(vars[k])
    : k === "product" ? PRODUCT : m);
}

/** t("Remove IRK for \"{name}\"?", {name}) -> plain text. */
export function t(text, vars) {
  const tr = _cat ? _cat[text] : undefined;
  return fill(typeof tr === "string" ? tr : text, vars);
}

/** tn(n, "1 device", "{n} devices", vars) -> plain text, {n} filled. */
export function tn(n, one, other, vars) {
  const v = Object.assign({ n }, vars);
  const e = _cat ? _cat[other] : undefined;
  if (e && typeof e === "object") {
    let c = "other";
    try { c = new Intl.PluralRules(_lang).select(n); } catch (_) { /* other */ }
    const s = typeof e[c] === "string" ? e[c] : e.other;
    if (typeof s === "string") return fill(s, v);
  }
  return fill(n === 1 ? one : other, v);
}
