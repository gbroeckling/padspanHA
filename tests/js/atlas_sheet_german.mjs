// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Atlas's room sheet in German, RUN: its On/Off and Lock/Unlock buttons
// keep their own state, never read it back from their label (the label is in
// the panel's language: "An", "Aus", "Entriegeln"). Before the fix a light
// switched off in German kept showing "An", and the lock offered "Entriegeln"
// again after unlocking.
//
// usage: atlas_sheet_german.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_sheet_german.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const failures = [];
const cases = {};
const check = (name, ok, detail) => { if (cases[name] !== false) cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

// The shipped German files, served from disk.
globalThis.fetch = async (url) => {
  const key = new URL(String(url)).pathname.split("/i18n/")[1];
  try { return { ok: true, json: async () => JSON.parse(readFileSync(join(WWW, "i18n", key), "utf-8")) }; }
  catch (_) { return { ok: false, json: async () => ({}) }; }
};

const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const I = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href);
const lang = await I.useLanguage({ language: "de" }, ["atlasmap", "atlas1"]);
check("german", lang === "de" && I.t("On") === "An" && I.t("Unlock") === "Entriegeln", { lang, on: I.t("On"), unlock: I.t("Unlock") });

const buttons = (n, out = []) => { for (const c of n.children || []) { if (c.localName === "button") out.push(c); buttons(c, out); } return out; };
const press = async (b) => { for (const f of (b._listeners.click || []).slice()) await f({ stopPropagation() {}, preventDefault() {} }); };

async function sheetWith(item, toggle) {
  const into = document.createElement("div");
  document.body.appendChild(into);
  LM.openAggregateSheet({ floodLatches: {}, doorInvertByEid: {}, controlsFor: () => null, toggle },
    { title: "Küche", sub: "", items: [item] }, { into, stay: true });
  return buttons(into).filter(b => b.textContent !== "✕");
}

// A light that is on: Aus, then An again, each press flipping the word.
{
  let took = true;
  const [b] = await sheetWith({ entity_id: "light.kitchen", code: "L01", friendly_name: "Kitchen", state: "on", isLight: true }, async () => took);
  check("light", b && b.textContent === "An", b && b.textContent);
  await press(b);
  check("light", b.textContent === "Aus", { after_first: b.textContent });
  await press(b);
  check("light", b.textContent === "An", { after_second: b.textContent });
  took = false;   // Home Assistant did not take it: the word goes back
  await press(b);
  check("light", b.textContent === "An", { refused: b.textContent });
}

// A locked lock: Entriegeln, then Verriegeln once Home Assistant took it.
{
  const [b] = await sheetWith({ entity_id: "lock.front", code: "K01", friendly_name: "Front door", state: "locked", isLock: true }, async () => true);
  check("lock", b && b.textContent === "Entriegeln", b && b.textContent);
  await press(b);
  check("lock", b.textContent === I.t("Lock") && b.textContent !== "Entriegeln", { after_unlock: b.textContent });
  await press(b);
  check("lock", b.textContent === "Entriegeln", { after_lock: b.textContent });
}

console.log(JSON.stringify({ cases, failures }));
