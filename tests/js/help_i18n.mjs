// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// help_content.js through views/i18n.js, run for real against the files on
// disk (tests/test_panel_i18n.py, and the Bright tree in test_bright_build.py):
//   english   every entry, built through t(), equals the same file with the
//             t() wrappers taken off (the help as it was), no note, no fetch
//   select    nl/de/fr follow the HA profile, its region (nl-BE) and the
//             per-browser choice; English, en-GB and unshipped fetch nothing
//   failed    help.json not found, or nl still loading when the profile goes
//             back to English: the English help, no note
//   rebuilt   helpTexts() in each language: every string in its help.json
//             used, the rest English, the note first, product and edition
//             names exactly as in the English entry
//
// usage: help_i18n.mjs <www dir>
// prints one JSON line: { cases, failures, product, samples }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: help_i18n.mjs <www dir>"); process.exit(2); }

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const fetched = [];
const STORE = {};
let down = false, gate = null;   // help.json 404s / the network is slow
globalThis.localStorage = { getItem: (k) => (k in STORE ? STORE[k] : null) };
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  fetched.push(u.pathname + u.search);
  if (gate) await gate;
  if (down) return { ok: false, json: async () => ({}) };
  const rel = decodeURIComponent(u.pathname).split("/i18n/")[1];
  try { const d = JSON.parse(readFileSync(join(WWW, "i18n", rel), "utf-8")); return { ok: true, json: async () => d }; }
  catch (_) { return { ok: false, json: async () => ({}) }; }
};

const SRC = readFileSync(join(WWW, "help_content.js"), "utf-8");
const H = await import(pathToFileURL(join(WWW, "help_content.js")).href + "?b=T");
const I = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href + "?b=T");

// The help as it was: the object literal with every t("...") unwrapped.
const a = SRC.indexOf("export function helpTexts() { return {");
const b = SRC.indexOf("\n}; }", a);
const literal = SRC.slice(SRC.indexOf("{", SRC.indexOf("return {", a)), b + 2)
  .replace(/(?<![\w.$])t\(("(?:[^"\\]|\\.)*")\)/g, "$1");
const BEFORE = new Function(`return ${literal};`)();
const strings = (help) => Object.values(help).flatMap(h => [h.title, ...h.body]);
const en = JSON.stringify(BEFORE);
const names = (s) => [...new Set(s.match(/PadSpan™?(?: (?:HA|Bright|Pro)\b)*/g) || [])].sort().join("|");

check("unwrapped_is_plain", !/(?<![\w.$])t\(/.test(literal) && Object.keys(BEFORE).length >= 49);
check("import_fetches_nothing", fetched.length === 0, fetched);
check("english_identical", JSON.stringify(H.HELP) === en && JSON.stringify(H.helpTexts()) === en);
check("english_no_note", H.helpNote() === "");
for (const lang of ["en", "en-GB", "pt", "pt-BR"]) {
  const r = await I.useLanguage({ language: lang }, ["help"]);
  check(`no_fetch_${lang}`, r === "en" && fetched.length === 0 && JSON.stringify(H.helpTexts()) === en, { r, fetched });
}

const samples = {};
const product = I.PRODUCT;
for (const lang of I.LANGUAGES) {
  const file = JSON.parse(readFileSync(join(WWW, "i18n", lang, "help.json"), "utf-8"));
  const n0 = fetched.length;
  const r = await I.useLanguage({ locale: { language: `${lang}-XX` }, language: "en" }, ["help"]);
  check(`${lang}_selected`, r === lang && I.currentLanguage() === lang);
  check(`${lang}_one_fetch`, fetched.length === n0 + 1 && fetched[n0].endsWith(`/i18n/${lang}/help.json?b=T`), fetched.slice(n0));
  const T = H.helpTexts();
  const pairs = strings(BEFORE).map((s, i) => [s, strings(T)[i]]);
  check(`${lang}_same_shape`, Object.keys(T).join() === Object.keys(BEFORE).join()
    && Object.keys(T).every(k => T[k].body.length === BEFORE[k].body.length));
  const wrong = pairs.filter(([e, x]) => (e in file) ? x !== file[e].replace(/\{product\}/g, product) : x !== e);
  check(`${lang}_every_string_used`, wrong.length === 0, wrong.slice(0, 3));
  check(`${lang}_note`, H.helpNote() !== "" && Object.values(file).includes(H.helpNote()));
  // Product and edition names exactly as the English entry has them (PadSpan,
  // PadSpan™, PadSpan Pro): the Bright rename leaves both sides alike.
  const off = pairs.filter(([e, x]) => names(e) !== names(x) || x.includes("{product}"));
  check(`${lang}_names_as_english`, off.length === 0, off.slice(0, 3));
  const withProduct = strings(T).filter(s => s.includes("PadSpan"));
  samples[lang] = { title: T.follow.title, product: withProduct[0] };
}
STORE.padspan_lang = "de";
check("browser_choice_wins", (await I.useLanguage({ language: "en" }, ["help"])) === "de");
delete STORE.padspan_lang;
const back = await I.useLanguage({ language: "en" }, ["help"]);
check("back_to_english", back === "en" && JSON.stringify(H.helpTexts()) === en && H.helpNote() === "");

down = true;
const r404 = await I.useLanguage({ language: "nl" }, ["help"]);
down = false;
check("help_404_is_english", r404 === "en" && H.helpNote() === "" && JSON.stringify(H.helpTexts()) === en, { r404 });
let open; gate = new Promise(r => { open = r; });
const slow = I.useLanguage({ language: "nl" }, ["help"]);
const now = await I.useLanguage({ language: "en" }, ["help"]);
open(); gate = null;
const late = await slow;
check("help_stale_nl_is_english", now === "en" && late === "en" && H.helpNote() === "" && JSON.stringify(H.helpTexts()) === en, { now, late });

console.log(JSON.stringify({ cases, failures, product, samples }));
