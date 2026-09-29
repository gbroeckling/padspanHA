// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → Features → PadSpan licence (views/settings.js) for each kind
// of licence, on a day inside the lifetime launch offer and a day after it.
// The clock is set here, never read: the suite has to give the same answer
// after October 31 as before it.
//
// usage: licence_card.mjs <views-dir>
// prints one JSON line: { cases: { name: { buy, lifetime: {text, href} | null } }, failures }

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
};
const DAYS = { during: Date.parse("2026-10-15T12:00:00Z"), after: Date.parse("2026-11-01T08:00:00Z") };

function licenceCard(settings) {
  const ctx = {
    hass: { user: { is_admin: true }, states: {} },
    state: { view: "settings", complexity: "advanced", _settingsTab: "features", model: { floors: [], areas: [] },
      settings: { ...settings, telemetry_enabled: false } },
    helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop },
      { get: (t, k) => (k in t ? t[k] : noop) }),
    actions: new Proxy({ wsCall: async () => ({}), renderRooms() {}, renderNav() {} },
      { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast() {},
  };
  const root = S.render(ctx);
  const card = root._all().find(n => (n.className || "") === "card" && /^PadSpan licence/.test((n.textContent || "").trim()));
  if (!card) throw new Error("no PadSpan licence card on Settings → Features");
  return card;
}

const realNow = Date.now;
const cases = {};
for (const [day, now] of Object.entries(DAYS)) {
  Date.now = () => now;
  try {
    for (const [kind, settings] of Object.entries(KINDS)) {
      try {
        const links = licenceCard(settings)._all().filter(n => n.localName === "a");
        const buy = links.some(a => /^(Buy|Renew) PadSpan Pro/.test(a.textContent));
        const life = links.find(a => /for life/.test(a.textContent));
        cases[`${kind}_${day}`] = { buy, lifetime: life ? { text: life.textContent, href: life.getAttribute("href") } : null };
      } catch (e) { failures.push(`${kind}_${day}: ${e && e.message ? e.message : e}`); }
    }
  } finally { Date.now = realNow; }
}
console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
