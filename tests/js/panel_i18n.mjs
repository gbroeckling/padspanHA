// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// views/i18n.js, run for real:
//   import    nothing runs: no fetch, no storage read, no new globals
//   english   t()/tn() hand back the English (placeholders filled), and an
//             English or unshipped language fetches nothing
//   loaded    a shipped language loads its groups lazily, once each, from
//             ../i18n/<lang>/<group>.json with the module's ?b= query;
//             missing strings and a failed group stay English
//   failed    a language none of whose groups loads (404, network error)
//             stays English; a call overtaken by a newer one changes nothing
//   text      placeholders by name in any order, {product} from PRODUCT,
//             markup-looking values come back as the same plain text
//
// usage: panel_i18n.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: panel_i18n.mjs <www/padspan-ha dir>"); process.exit(2); }

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const fetched = [];
let storageReads = 0;
const STORE = {};
globalThis.localStorage = { getItem: (k) => { storageReads++; return k in STORE ? STORE[k] : null; } };
const FILES = {
  "nl/core.json": { "Restore": "Herstellen", "Remove IRK for \"{name}\"?": "IRK voor \"{name}\" verwijderen?",
                    "{a} then {b}": "{b} en dan {a}", "{n} devices": { "one": "{n} apparaat", "other": "{n} apparaten" },
                    "About {product}": "Over {product}", "<b>x</b>": "<b>y</b>" },
  "nl/help.json": { "Help": "Hulp" },
};
let gate = null;          // a promise: fetches wait on it (a slow network)
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  fetched.push(u.pathname + u.search);
  const key = u.pathname.split("/i18n/")[1];
  if (gate) await gate;
  if (key.startsWith("fr/")) throw new TypeError("network error");
  if (!(key in FILES)) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => JSON.parse(JSON.stringify(FILES[key])) };
};

const globalsBefore = new Set(Object.keys(globalThis));
const I = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href + "?b=TESTBUILD");
check("import_has_no_side_effects", fetched.length === 0 && storageReads === 0
  && Object.keys(globalThis).every(k => globalsBefore.has(k)), { fetched, storageReads });

// English: the argument, unchanged.
check("english_plain", I.t("Restore") === "Restore");
check("english_vars", I.t("Remove IRK for \"{name}\"?", { name: "Phone" }) === "Remove IRK for \"Phone\"?");
check("english_unknown_placeholder_kept", I.t("Hi {who}") === "Hi {who}");
check("english_product", I.t("About {product}") === "About " + I.PRODUCT);
check("english_plural", I.tn(1, "{n} device", "{n} devices") === "1 device" && I.tn(3, "{n} device", "{n} devices") === "3 devices");
check("english_markup_is_text", I.t("<b>x</b>") === "<b>x</b>");

check("lang_of", I.langOf({ locale: { language: "de-AT" }, language: "fr" }) === "de"
  && I.langOf({ language: "pt_BR" }) === "pt" && I.langOf(null) === "en" && I.langOf({}) === "en");
STORE.padspan_lang = "nl";
check("lang_of_override", I.langOf({ language: "de" }) === "nl");
delete STORE.padspan_lang;

check("shipped_nl_de_fr", Array.isArray(I.LANGUAGES) && I.LANGUAGES.join() === "nl,de,fr" && Object.isFrozen(I.LANGUAGES));
const r1 = await I.useLanguage({ language: "en-GB" }, ["core"], ["nl"]);
const r2 = await I.useLanguage({ language: "pt" });   // not shipped: stays English
check("english_and_unshipped_fetch_nothing", r1 === "en" && r2 === "en" && fetched.length === 0
  && I.t("Restore") === "Restore", { r1, r2, fetched });

// A shipped language.
const r3 = await I.useLanguage({ locale: { language: "nl-BE" } }, ["core", "missing"], ["nl"]);
check("loaded", r3 === "nl" && I.currentLanguage() === "nl");
check("fetch_urls", fetched.length === 2 && fetched.every(p => p.includes("/www/padspan-ha/i18n/nl/") || p.includes("/padspan-ha/i18n/nl/"))
  && fetched.every(p => p.endsWith(".json?b=TESTBUILD")), fetched);
check("translated", I.t("Restore") === "Herstellen");
check("translated_vars", I.t("Remove IRK for \"{name}\"?", { name: "<i>Phone</i>" }) === "IRK voor \"<i>Phone</i>\" verwijderen?");
check("word_order", I.t("{a} then {b}", { a: "A", b: "B" }) === "B en dan A");
check("missing_stays_english", I.t("Cancel") === "Cancel");
check("plural_nl", I.tn(1, "{n} device", "{n} devices") === "1 apparaat" && I.tn(4, "{n} device", "{n} devices") === "4 apparaten");
check("product_in_translation", I.t("About {product}") === "Over " + I.PRODUCT);
check("help_not_loaded_yet", I.t("Help") === "Help");
check("loaded_names_the_groups_in", I.loaded("core") && !I.loaded("missing") && !I.loaded("help"));
const before = fetched.length;
await I.useLanguage({ language: "nl" }, ["core", "help"], ["nl"]);
// core is in already; help is new; missing (asked before, never in) is tried again.
const again = fetched.slice(before).map(p => p.split("/i18n/")[1].split("?")[0]).sort();
check("groups_load_once", again.join() === "nl/help.json,nl/missing.json" && I.t("Help") === "Hulp" && I.t("Restore") === "Herstellen"
  && I.loaded("help"), fetched.slice(before));
check("proto_key_harmless", I.t("__proto__") === "__proto__" && I.t("constructor") === "constructor");
await I.useLanguage({ language: "en" }, ["core"], ["nl"]);
check("back_to_english", I.t("Restore") === "Restore" && I.currentLanguage() === "en");

// Nothing loaded is no language: a 404 or a network error stays English.
const r4 = await I.useLanguage({ language: "de" }, ["core"], ["nl", "de", "fr"]);
const r5 = await I.useLanguage({ language: "fr" }, ["core", "help"], ["nl", "de", "fr"]);
check("failed_load_stays_english", r4 === "en" && r5 === "en" && I.currentLanguage() === "en" && I.t("Restore") === "Restore", { r4, r5 });
await I.useLanguage({ language: "nl" }, ["core"], ["nl", "de"]);
const r6 = await I.useLanguage({ language: "de" }, ["core"], ["nl", "de"]);
check("failed_switch_is_english", r6 === "en" && I.currentLanguage() === "en" && I.t("Restore") === "Restore");
// nl still loading when the profile goes back to English: English wins.
let open; gate = new Promise(r => { open = r; });
const slow = I.useLanguage({ language: "nl" }, ["core"], ["nl"]);
const r7 = await I.useLanguage({ language: "en" }, ["core"], ["nl"]);
open(); gate = null;
const r8 = await slow;
check("stale_load_ignored", r7 === "en" && r8 === "en" && I.currentLanguage() === "en" && I.t("Restore") === "Restore", { r7, r8 });
// and nl overtaken by de still loading: de wins, nl's strings never show.
gate = new Promise(r => { open = r; });
const nlSlow = I.useLanguage({ language: "nl" }, ["core"], ["nl", "de"]);
FILES["de/core.json"] = { "Restore": "Wiederherstellen" };
const deSlow = I.useLanguage({ language: "de" }, ["core"], ["nl", "de"]);
open(); gate = null;
const [r9, r10] = await Promise.all([nlSlow, deSlow]);
check("newest_language_wins", r10 === "de" && I.currentLanguage() === "de" && I.t("Restore") === "Wiederherstellen", { r9, r10 });
await I.useLanguage({ language: "en" }, ["core"], ["nl"]);
check("english_unloads_every_group", !I.loaded("core") && !I.loaded("help") && I.t("Help") === "Help");

// Every group asked for once is loaded by each later call, whichever group
// that call names: the panel's own words and the help never drop each other,
// across a language change or a call overtaken by another (a fresh instance).
FILES["de/help.json"] = { "Help": "Hilfe" };
const J = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href + "?b=GROUPS");
await J.useLanguage({ language: "nl" }, ["core"], ["nl", "de"]);
await J.useLanguage({ language: "nl" }, ["help"], ["nl", "de"]);
await J.useLanguage({ language: "de" }, ["core"], ["nl", "de"]);
check("a_new_language_loads_every_group_asked_before", J.currentLanguage() === "de" && J.loaded("core") && J.loaded("help")
  && J.t("Restore") === "Wiederherstellen" && J.t("Help") === "Hilfe");
const K = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href + "?b=OVERTAKEN");
gate = new Promise(r => { open = r; });
const helpFirst = K.useLanguage({ language: "nl" }, ["help"], ["nl"]);
const coreAfter = K.useLanguage({ language: "nl" }, ["core"], ["nl"]);
open(); gate = null;
await Promise.all([helpFirst, coreAfter]);
check("an_overtaking_call_keeps_the_overtaken_groups", K.loaded("help") && K.loaded("core")
  && K.t("Help") === "Hulp" && K.t("Restore") === "Herstellen");

console.log(JSON.stringify({ cases, failures }));
