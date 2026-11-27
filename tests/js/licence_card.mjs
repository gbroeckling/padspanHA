// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → Features → PadSpan licence (views/settings.js) for each kind
// of licence, on a day inside the lifetime launch offer and a day after it.
// The clock is set here, never read: the suite has to give the same answer
// after December 31 as before it.
//
// usage: licence_card.mjs <views-dir>
// prints one JSON line: { cases: { name: { buy, lifetime: {text, href} | null } },
//   addons: { name: { status, buy, offer: { lead, items: [{ addon, text, href }] } | null } }, failures }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: licence_card.mjs <views-dir>"); process.exit(2); }
install(globalThis);

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "id") n.id = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}
const noop = () => el("span");
const failures = [];
const S = await import(pathToFileURL(join(VIEWS, "settings.js")).href);

const KINDS = {
  nokey:    { tier: "free", pro_has_key: false },
  trial:    { tier: "bright", pro_has_key: true, pro_active: true, license_is_trial: true, license_tier: "bright",
              pro_days_left: 80, forensics_license_expires: "2026-12-27" },
  lapsed:   { tier: "free", pro_has_key: true, pro_active: false, license_tier: "pro", forensics_license_expires: "2026-09-01" },
  annual:   { tier: "pro", pro_has_key: true, pro_active: true, license_tier: "pro", pro_days_left: 300,
              forensics_license_expires: "2027-07-20" },
  lifetime: { tier: "pro", pro_has_key: true, pro_active: true, license_tier: "pro", pro_days_left: 26000,
              forensics_license_expires: "2099-12-31" },
  // An add-on key (2026-11-25): tier free; Audio running, Climate map ended (its own date).
  addons:   { tier: "free", pro_has_key: true, addon_key: true, pro_active: true, license_tier: "free", license_addons: ["audio"],
              license_addons_until: { audio: "2028-11-25 10:00:00", climate: "2026-11-01 10:00:00" },
              addons_licensed: ["audio"], pro_days_left: 700, forensics_license_expires: "2028-11-25" },
  addons_lapsed: { tier: "free", pro_has_key: true, addon_key: true, pro_active: false, license_tier: "free", license_addons: [],
              license_addons_until: { audio: "2026-10-01 10:00:00" }, addons_licensed: [], pro_days_left: -40,
              forensics_license_expires: "2026-10-01" },
};
const DAYS = { during: Date.parse("2026-10-15T12:00:00Z"), after: Date.parse("2026-12-01T09:00:00Z"),   // launch price, then $168
               pass: Date.parse("2026-12-16T09:00:00Z") };   // lifetime ended: the two-year pass in its place

function renderFeatures(settings, extraState = {}) {
  const ctx = {
    hass: { user: { is_admin: true }, states: {} },
    state: { view: "settings", complexity: "advanced", _settingsTab: "features", model: { floors: [], areas: [] },
      settings: { ...settings, telemetry_enabled: false }, ...extraState },
    helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop },
      { get: (t, k) => (k in t ? t[k] : noop) }),
    actions: new Proxy({ wsCall: async () => ({}), renderRooms() {}, renderNav() {} },
      { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast() {},
  };
  return S.render(ctx);
}
function licenceCard(settings) {
  const root = renderFeatures(settings);
  const card = root._all().find(n => (n.className || "") === "card" && /^PadSpan licence/.test((n.textContent || "").trim()));
  if (!card) throw new Error("no PadSpan licence card on Settings → Features");
  return card;
}

const realNow = Date.now;
const cases = {};
const addons = {};
for (const [day, now] of Object.entries(DAYS)) {
  Date.now = () => now;
  try {
    for (const [kind, settings] of Object.entries(KINDS)) {
      try {
        const links = licenceCard(settings)._all().filter(n => n.localName === "a");
        const buyA = links.find(a => /^(Buy|Renew) PadSpan Pro/.test(a.textContent));
        const buy = !!buyA;
        // The year's price on the button: $45 until the end of December 15, $49 from then.
        if (buyA && !(day === "pass" ? /\$49 CAD\/year/ : /\$45 CAD\/year/).test(buyA.textContent))
          failures.push(`${kind}_${day}: the buy button says ${buyA.textContent}`);
        const life = links.find(a => /for life|two years for/.test(a.textContent));
        cases[`${kind}_${day}`] = { buy, lifetime: life ? { text: life.textContent, href: life.getAttribute("href") } : null };
        // The status line under the title, the buy button's words, and the add-ons' one list.
        const all = licenceCard(settings)._all();
        const status = all.find(n => /margin:8px 0 10px/.test(n.getAttribute && n.getAttribute("style") || ""));
        const offer = all.find(n => (n.className || "") === "addon-offer");
        addons[`${kind}_${day}`] = { status: status ? status.textContent : null, buy: buyA ? buyA.textContent : null,
          offer: offer ? { lead: offer._all().find(n => n.localName === "div").textContent,
            items: offer._all().filter(n => n.localName === "a").map(a => ({ addon: a.getAttribute("data-addon"),
              text: a.textContent, href: a.getAttribute("href") })) } : null };
      } catch (e) { failures.push(`${kind}_${day}: ${e && e.message ? e.message : e}`); }
    }
  } finally { Date.now = realNow; }
}
// Turning the usage report off asks first on a Pro key past two homes; an add-on key has no reports rule.
if (!S.reportOffConfirmText({ pro_has_key: true, license_homes_used: 3 }))
  failures.push("reportOffConfirmText: a Pro key on 3 homes is no longer asked");
if (S.reportOffConfirmText({ ...KINDS.addons, license_homes_used: 3 }) !== "")
  failures.push("reportOffConfirmText: an add-on key on 3 homes is asked about the reports rule");

// The free basics (editions.js freeBasics; settings.free_basics from December 1): every sentence on the card and in
// the tiers wizard that says what a key adds or what a lapsed key loses. Before (no free_basics) exactly the words it
// always had; from it (free_basics: true) the new ones, which no longer call placement, the wall or the 3D house paid.
const GRACE = { tier: "pro", pro_has_key: true, pro_active: true, license_tier: "pro", pro_days_left: -3,
                forensics_license_expires: "2026-11-20" };   // 11 days of grace left
const statusOf = (s) => { const n = licenceCard(s)._all().find(x => /margin:8px 0 10px/.test(x.getAttribute && x.getAttribute("style") || "")); return n ? n.textContent : ""; };
const footOf = (s) => { const n = licenceCard(s)._all().find(x => /font-size:11px;color:#94a3b8;margin-top:10px/.test(x.getAttribute && x.getAttribute("style") || "")); return n ? n.textContent : ""; };
const wizardOf = (step) => (s) => renderFeatures(s, { _tiersWizard: { step } }).textContent;
const BR = { edition: "bright" };
const FB_SENTENCES = [
  ["nokey", KINDS.nokey, statusOf,
    "No licence key on this install. Light placement, the 3D house and the wall screen are locked. Forensics, Locate and Busy Times need Pro or Presence insights. The free version needs no key and doesn't run out. Some features need PadSpan Pro or an add-on, and PadSpan says which where you meet them. Pro includes every add-on.",
    "No licence key on this install. Light placement, the plain wall screen and the 3D house are free. Fixture shapes with their size and angle, WLED's Advanced controls and Fit room need Pro or the Advanced smart lighting add-on, and Showcase needs Pro or the Looks pack. Forensics, Locate and Busy Times need Pro or Presence insights; the 3D editor, Furnish and people in 3D need Pro. The free version needs no key and doesn't run out. Some features need PadSpan Pro or an add-on, and PadSpan says which where you meet them. Pro includes every add-on."],
  ["nokey_bright", { ...KINDS.nokey, ...BR }, statusOf,
    "No licence key on this install. Light placement, the 3D house and the wall screen are locked. The free version needs no key and doesn't run out. Some features need PadSpan Pro or an add-on, and PadSpan says which where you meet them. Pro includes every add-on.",
    "No licence key on this install. Light placement, the plain wall screen and the 3D house are free. Fixture shapes with their size and angle, WLED's Advanced controls and Fit room need Pro or the Advanced smart lighting add-on, Showcase needs Pro or the Looks pack, and the 3D editor and Furnish need Pro. The free version needs no key and doesn't run out. Some features need PadSpan Pro or an add-on, and PadSpan says which where you meet them. Pro includes every add-on."],
  ["lapsed", KINDS.lapsed, statusOf,
    " — light placement is read-only, Forensics has stopped recording, and the 3D house, the wall screen, Locate and Busy Times are off. ",
    " — fixture shapes, Showcase, the 3D editor, Furnish, people in 3D, the wall screen's night dimming, Locate and Busy Times are off, and Forensics has stopped recording. Lights stay where you placed them; the plain wall screen and the 3D house stay free. "],
  ["lapsed_bright", { ...KINDS.lapsed, ...BR }, statusOf,
    " — light placement is read-only and the 3D house and the wall screen are off. ",
    " — fixture shapes, Showcase, the 3D editor, Furnish and the wall screen's night dimming are off. Lights stay where you placed them; the plain wall screen and the 3D house stay free. "],
  ["grace", GRACE, statusOf,
    " — light placement goes read-only, Forensics stops recording and the 3D house, the wall screen, Locate and Busy Times switch off in 11 days.",
    " — fixture shapes, Showcase, the 3D editor, Furnish, people in 3D, the wall screen's night dimming, Locate and Busy Times switch off and Forensics stops recording in 11 days. Lights stay where you placed them."],
  ["grace_bright", { ...GRACE, ...BR }, statusOf,
    " — light placement goes read-only and the 3D house and the wall screen switch off in 11 days.",
    " — fixture shapes, Showcase, the 3D editor, Furnish and the wall screen's night dimming switch off in 11 days. Lights stay where you placed them."],
  ["footer", KINDS.nokey, footOf,
    "A PadSpan Pro key unlocks the paid features, among them light placement (fixture shapes and sizes, WLED, Showcase, Fit room), Forensics, the 3D house, the wall screen, Locate and Busy Times. A PadSpan Bright Pro key unlocks light placement only.",
    "A PadSpan Pro key unlocks the paid features, among them the lights' looks (fixture shapes and sizes, WLED, Showcase, Fit room), Forensics, the 3D editor, Furnish, people in 3D, the wall screen's night dimming, Locate and Busy Times. A PadSpan Bright Pro key unlocks the lights' looks only. Light placement, the plain wall screen and the 3D house are free."],
  ["footer_bright", { ...KINDS.nokey, ...BR }, footOf,
    "A PadSpan Pro key unlocks the paid features, among them light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house and the wall screen. A PadSpan Bright Pro key unlocks light placement only.",
    "A PadSpan Pro key unlocks the paid features, among them the lights' looks (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D editor, Furnish and the wall screen's night dimming. A PadSpan Bright Pro key unlocks the lights' looks only. Light placement, the plain wall screen and the 3D house are free."],
  ["wizard_free", KINDS.nokey, wizardOf(1),
    "A PadSpan Pro key adds the paid features: light placement (fixture shapes and sizes, WLED, Showcase, Fit room), Forensics (which Bluetooth devices were near a scanner in any time window, with dwell time and CSV export), the 3D house (Live Aboard), the wall screen, Locate, Busy Times and more.",
    "A PadSpan Pro key adds the paid features: the lights' looks (fixture shapes and sizes, WLED, Showcase, Fit room), Forensics (which Bluetooth devices were near a scanner in any time window, with dwell time and CSV export), the 3D editor, Furnish and people in 3D, the wall screen's night dimming and burn-in protection, Locate, Busy Times and more."],
  ["wizard_free_bright", { ...KINDS.nokey, ...BR }, wizardOf(1),
    "Placing each one exactly where it hangs needs a key — see below.A PadSpan Pro key adds the paid features: light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house (Live Aboard), the wall screen and more.",
    "and so are the plain wall screen and the 3D house. Each light's shape, size and looks need a key — see below.A PadSpan Pro key adds the paid features: the lights' looks (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D editor and Furnish, the wall screen's night dimming and burn-in protection, and more."],
  ["wizard_ladder", KINDS.nokey, wizardOf(2),
    "Adds light placement (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D house, the wall screen, Forensics, Locate and Busy Times to this install.",
    "Adds the lights' looks (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D editor, Furnish and people in 3D, the wall screen's night dimming and burn-in protection, Forensics, Locate and Busy Times to this install."],
  ["wizard_ladder_bright", { ...KINDS.nokey, ...BR }, wizardOf(2),
    "Fixture shapes and sizes, WLED, Showcase, Fit room — light placement exactly where it hangs.",
    "Fixture shapes and sizes, WLED, Showcase, Fit room — how each light looks; placing it is free."],
];
for (const [name, settings, read, before, from] of FB_SENTENCES) {
  try {
    const off = read(settings), on = read({ ...settings, free_basics: true });
    if (!off.includes(before)) failures.push(`free basics ${name}: before the moment the words changed: ${off}`);
    if (!on.includes(from)) failures.push(`free basics ${name}: from the moment not the new words: ${on}`);
    if (on.includes(before)) failures.push(`free basics ${name}: from the moment the old words still show`);
    if (read({ ...settings, free_basics: false }) !== off) failures.push(`free basics ${name}: free_basics false is not "before"`);
  } catch (e) { failures.push(`free basics ${name}: ${e && e.message ? e.message : e}`); }
}
process.stdout.write(JSON.stringify({ cases, addons, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));   // exit only once the result is written (a pipe holds 64 KiB)
