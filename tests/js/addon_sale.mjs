// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Black Friday sale's Overview card, its rule (views/editions.js
// addonSaleCardDue, addonSaleCardPicks) and the add-on funnel's once-per-page
// counting (addonOfferSeen, addonUsedSeen). Who sees the card: an install
// without paid Pro (no key, a trial, a lapsed key, Bright, an add-on key that
// lacks an add-on on sale), only while the sale runs, only once the backend
// says it was never shown. The panel's own gates (an administrator, never a
// wall, live data) are run in tests/js/whats_new_card.mjs.
//
// usage: addon_sale.mjs <views-dir> [payloads.json]
// prints one JSON line: { checks: [...], failures: [...], due: {...} } — with a
// payloads file ({label: {settings, now}}), `due` answers each (the Python test
// that loads a 0.38.274 install's settings through the backend).

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const VIEWS = process.argv[2];
const E = await import(pathToFileURL(join(VIEWS, "editions.js")).href);
const checks = [], failures = [];
const check = (name, ok, detail) => { checks.push(name); if (!ok) failures.push({ name, detail: String(detail ?? "") }); };

const FROM = Date.parse(E.ADDON_HALF_FROM), UNTIL = Date.parse(E.ADDON_HALF_UNTIL);
const IN = FROM + 3 * 86400e3;
const ON_SALE = E.ADDONS.filter(a => a.on_sale !== false).map(a => a.name);

// The settings payload's licence fields, as ws_common._get_settings sends them.
const base = { addon_sale_card_done: false, pro_has_key: false, pro_active: false, tier: "free", addons_licensed: [],
  addon_key: false, license_is_trial: false, pro_days_left: null };
const TIERS = {
  free: base,
  trial: { ...base, pro_has_key: true, pro_active: true, tier: "pro", license_is_trial: true, addons_licensed: [...E.ADDONS.map(a => a.name)] },
  trial_lapsed: { ...base, pro_has_key: true, pro_active: false, tier: "free", license_is_trial: true },
  pro_year: { ...base, pro_has_key: true, pro_active: true, tier: "pro", pro_days_left: 200, addons_licensed: E.ADDONS.map(a => a.name) },
  pro_life: { ...base, pro_has_key: true, pro_active: true, tier: "pro", pro_days_left: 26000, addons_licensed: E.ADDONS.map(a => a.name) },
  pro_tester: { ...base, pro_has_key: true, pro_active: true, tier: "pro", pro_days_left: 700, addons_licensed: E.ADDONS.map(a => a.name) },
  pro_lapsed: { ...base, pro_has_key: true, pro_active: false, tier: "free", pro_days_left: -30 },
  bright: { ...base, pro_has_key: true, pro_active: true, tier: "bright", pro_days_left: 100 },
  bright_lapsed: { ...base, pro_has_key: true, pro_active: false, tier: "free", pro_days_left: -40 },
  addon_some: { ...base, pro_has_key: true, pro_active: true, addon_key: true, addons_licensed: ["audio", "climate"] },
  addon_all: { ...base, pro_has_key: true, pro_active: true, addon_key: true, addons_licensed: [...ON_SALE] },
  addon_all_but_one: { ...base, pro_has_key: true, pro_active: true, addon_key: true, addons_licensed: ON_SALE.slice(1) },
  addon_lapsed: { ...base, pro_has_key: true, pro_active: false, addon_key: true, addons_licensed: [] },
  // "maps" is not on sale (on_sale: false): holding every add-on but it is holding every one on sale.
  addon_all_on_sale_not_maps: { ...base, pro_has_key: true, pro_active: true, addon_key: true, addons_licensed: ON_SALE.filter(n => n !== "maps") },
};
const WANT = { free: true, trial: true, trial_lapsed: true, pro_year: false, pro_life: false, pro_tester: false, pro_lapsed: true,
  bright: true, bright_lapsed: true, addon_some: true, addon_all: false, addon_all_but_one: true, addon_lapsed: true,
  addon_all_on_sale_not_maps: false };
check("every tier in the matrix has an answer", Object.keys(TIERS).every(k => k in WANT));
const WHEN = { before: FROM - 1, first_second: FROM, in_sale: IN, last_second: UNTIL - 1, ended: UNTIL, long_after: UNTIL + 90 * 86400e3 };
const OPEN = { before: false, first_second: true, in_sale: true, last_second: true, ended: false, long_after: false };
for (const [tier, s] of Object.entries(TIERS)) {
  for (const [when, now] of Object.entries(WHEN)) {
    const want = WANT[tier] && OPEN[when];
    check(`due: ${tier} at ${when}`, E.addonSaleCardDue(s, now) === want, `${E.addonSaleCardDue(s, now)} != ${want}`);
    // Once shown, never again; a backend that does not know the flag (older) never shows it; settings not loaded: no flash.
    check(`flag: ${tier} at ${when} once shown`, E.addonSaleCardDue({ ...s, addon_sale_card_done: true }, now) === false);
    const old = { ...s }; delete old.addon_sale_card_done;
    check(`flag: ${tier} at ${when} from an older backend`, E.addonSaleCardDue(old, now) === false);
  }
}
const notLoaded = { ...base }; delete notLoaded.pro_has_key;
check("not loaded yet: never due", E.addonSaleCardDue(notLoaded, IN) === false);
check("no settings: never due", E.addonSaleCardDue(null, IN) === false && E.addonSaleCardDue(undefined, IN) === false);
check("the card's window is the sale's", E.addonHalfOff(IN) && !E.addonHalfOff(FROM - 1) && !E.addonHalfOff(UNTIL));

// The few it names: three on sale that the install can't use yet, never one it has, never one not on sale.
const picks = (s) => E.addonSaleCardPicks(s);
check("picks: a free install", JSON.stringify(picks(TIERS.free)) === JSON.stringify(["audio", "climate", "timetravel"]), picks(TIERS.free));
check("picks: a trial names what the trial would take away", JSON.stringify(picks(TIERS.trial)) === JSON.stringify(["audio", "climate", "timetravel"]), picks(TIERS.trial));
check("picks: an add-on holder, never what it has", JSON.stringify(picks(TIERS.addon_some)) === JSON.stringify(["timetravel", "looks", "alarm"]), picks(TIERS.addon_some));
check("picks: one left, one named", JSON.stringify(picks(TIERS.addon_all_but_one)) === JSON.stringify([ON_SALE[0]]), picks(TIERS.addon_all_but_one));
check("picks: never one not on sale", !picks(TIERS.free).includes("maps") && E.ADDONS.find(a => a.name === "maps").on_sale === false);
check("picks: each has its half price in the sale", picks(TIERS.free).every(n => E.addonPriceParts(n, IN).half && E.addonPrice(n, IN) !== E.ADDONS.find(a => a.name === n).price));

// The funnel: once per page load per place and add-on; a click is the caller's, each time.
const sent = [];
const send = (n) => sent.push(n);
E.addonOfferSeen(send, "licence_card", "audio");
E.addonOfferSeen(send, "licence_card", "audio");
E.addonOfferSeen(send, "licence_card", "climate");
E.addonOfferSeen(send, "busy_times", "insights");
E.addonUsedSeen(send, "insights");
E.addonUsedSeen(send, "insights");
check("offers and uses: once per page load each", JSON.stringify(sent) === JSON.stringify(
  ["addon_offer:licence_card:audio", "addon_offer:licence_card:climate", "addon_offer:busy_times:insights", "addon_used:insights"]), sent);
E.addonOfferSeen(null, "locate", "insights");
E.addonOfferSeen(() => { throw new Error("report down"); }, "locate", "insights");
check("no sender, or one that throws: nothing breaks", true);

const due = {};
if (process.argv[3]) {
  const cases = JSON.parse(readFileSync(process.argv[3], "utf8"));
  for (const [label, c] of Object.entries(cases)) due[label] = E.addonSaleCardDue(c.settings, Date.parse(c.now));
}
console.log(JSON.stringify({ checks, failures, due }));
process.exit(failures.length ? 1 : 0);
