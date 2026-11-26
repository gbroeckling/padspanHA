// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// PadSpan add-ons in views/editions.js (2026-11-25): one ADDONS table;
// addonAllowed(settings, name) is Pro or the backend's addons_licensed;
// addonKey tells an add-on key from a Pro key; an add-on key is never pitched
// as a lapsed Pro licence.
//
// usage: addons.mjs <views-dir>
// prints one JSON line: { checks: [...], failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const VIEWS = process.argv[2];
const E = await import(pathToFileURL(join(VIEWS, "editions.js")).href);
const checks = [], failures = [];
const check = (name, ok, detail) => { checks.push(name); if (!ok) failures.push({ name, detail: String(detail ?? "") }); };

const KEY = { tier: "free", pro_has_key: true, addon_key: true, pro_active: true, license_tier: "free", license_addons: ["audio", "wifi"],
  license_addons_until: { audio: "2028-11-25 10:00:00", wifi: "2028-12-01 10:00:00" }, addons_licensed: ["audio", "wifi"] };
const LAPSED = { ...KEY, pro_active: false, license_addons: [], addons_licensed: [] };

// The table: twelve add-ons and one specialty, the owner's prices, words and a line each (maps and vacuum: on sale from
// December 1; c4local: not on sale yet, 2026-11-25).
const want = { audio: "$6.45 CAD", alarm: "$6.45 CAD", wifi: "$6.45 CAD", climate: "$8.65 CAD", timetravel: "$7.55 CAD",
  vacation: "$4.25 CAD", looks: "$4.25 CAD", forensics: "$5.56 CAD", insights: "$5.56 CAD", maps: "$8.65 CAD",
  lighting: "$8.65 CAD", vacuum: "$6.45 CAD", c4local: "$26 CAD" };
check("twelve add-ons and one specialty, in order", JSON.stringify(E.ADDONS.map(a => a.name)) === JSON.stringify(Object.keys(want)),
  E.ADDONS.map(a => a.name));
for (const a of E.ADDONS) {
  check(`${a.name}: its price`, a.price === want[a.name], a.price);
  check(`${a.name}: words and a line`, typeof a.words === "string" && a.words && typeof a.desc === "string" && a.desc.length > 8);
}
check("the table can't be changed at run time", Object.isFrozen(E.ADDONS));
check("the term", E.ADDON_TERM === "2 years", E.ADDON_TERM);
check("the buy link", E.ADDONS_URL === "https://padspan.traks.ca/#addons", E.ADDONS_URL);

// Specialty (the owner, 2026-11-25): OS 2 Local for Control4, for life, its own box on the site, not on sale yet, and
// never in a sale; the only specialty and the only one for life.
const C4 = E.ADDONS.find(a => a.name === "c4local") || {};
check("c4local: a specialty, for life", C4.category === "specialty" && C4.lifetime === true
  && E.ADDONS.filter(a => a.category === "specialty" || a.lifetime).length === 1, JSON.stringify(C4));
check("c4local: OS 2 Local for Control4 at its own box", C4.words === "OS 2 Local for Control4" && C4.url === "https://padspan.traks.ca/#c4local");
check("c4local: not on sale, and no date yet", C4.on_sale === false && C4.on_sale_from === ""
  && E.addonOnSale("c4local") === false && E.addonOnSale("c4local", Date.parse("2030-01-01T00:00:00Z")) === false);
for (const at of ["2026-11-27T08:00:00Z", "2026-12-24T12:00:00Z", "2027-01-02T07:59:59Z", "2027-03-01T00:00:00Z"]) {
  const p = E.addonPriceParts("c4local", Date.parse(at));
  check(`c4local: never half off (${at})`, p.price === "$26 CAD" && p.half === false && E.addonPrice("c4local", Date.parse(at)) === "$26 CAD",
    JSON.stringify(p));
}
check("the sale still halves the feature add-ons", E.addonPriceParts("audio", Date.parse("2026-12-24T12:00:00Z")).half === true);
check("c4local: an add-on key holding it may use it", E.addonAllowed({ ...KEY, addons_licensed: ["c4local"] }, "c4local") === true
  && E.addonAllowed(KEY, "c4local") === false && E.addonAllowed({ tier: "pro" }, "c4local") === true);

// Pro has every add-on; an active add-on key has its own; nothing else has any.
for (const a of E.ADDONS) check(`addonAllowed: Pro has ${a.name}`, E.addonAllowed({ tier: "pro" }, a.name) === true);
for (const [name, s, addon, want] of [
  ["Pro, a payload without addons_licensed", { tier: "PRO" }, "audio", true],
  ["an add-on key, one it holds", KEY, "wifi", true],
  ["an add-on key, one it doesn't", KEY, "climate", false],
  ["a lapsed add-on key", LAPSED, "audio", false],
  ["no key", { tier: "free", pro_has_key: false }, "audio", false],
  ["Bright", { tier: "bright", pro_has_key: true, pro_active: true, license_tier: "bright" }, "audio", false],
  ["addons_licensed a string", { tier: "free", addons_licensed: "audio" }, "audio", false],
  ["nothing at all", undefined, "audio", false],
]) check(`addonAllowed: ${name}`, E.addonAllowed(s, addon) === want, E.addonAllowed(s, addon));

// addonKey is the backend's own answer (settings.addon_key), never re-derived here.
for (const [name, s, want] of [
  ["an active add-on key", KEY, true],
  ["a lapsed add-on key", LAPSED, true],
  ["a Pro key", { tier: "pro", pro_has_key: true, addon_key: false, license_tier: "pro" }, false],
  ["an older backend that doesn't say", { pro_has_key: true, license_tier: "free", license_addons: ["audio"] }, false],
  ["the flag as a string", { addon_key: "true" }, false],
  ["nothing at all", undefined, false],
]) check(`addonKey: ${name}`, E.addonKey(s) === want, E.addonKey(s));

// The Pro trial is offered to an add-on install too (its key is kept aside for it), never to a Pro one.
const TR = await import(pathToFileURL(join(VIEWS, "trial_offer.js")).href);
check("trial: an add-on install may try Pro", TR.trialOfferable(KEY) === true && TR.trialOfferable(LAPSED) === true);
check("trial: no key", TR.trialOfferable({ tier: "free", pro_has_key: false }) === true);
check("trial: never on Pro", TR.trialOfferable({ tier: "pro", pro_has_key: true, addon_key: false }) === false);
check("trial: never while not loaded", TR.trialOfferable({}) === false);
check("trial: the note says the add-on key comes back", /comes back by itself when the trial ends/.test(TR.TRIAL_ADDONS_NOTE));

// What a licence adds is said to an add-on key as to a free install, lapsed or not:
// never "Your licence has lapsed" about Pro features it never had.
for (const [name, s] of [["active", KEY], ["lapsed", LAPSED]]) {
  const p = E.proPitch(s);
  check(`proPitch: an ${name} add-on key is pitched as free`, p && p.kind === "free", JSON.stringify(p));
}
check("proPitch: a lapsed Pro key is still told it lapsed",
  (E.proPitch({ tier: "free", pro_has_key: true, pro_active: false, license_tier: "pro" }) || {}).kind === "lapsed");

process.stdout.write(JSON.stringify({ checks, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));
