// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN (0.38.163) a key on more than two homes needs every home's usage
// report on: Settings → Features → PadSpan licence says so when the server
// warned, and Settings → Presence → Help improve PadSpan asks first before the
// report goes off on such a key. Keys on one or two homes: nothing new.
//
// usage: licence_homes_warning.mjs <views-dir>
// prints one JSON line: { cases: { name: {...} }, failures }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: licence_homes_warning.mjs <views-dir>"); process.exit(2); }
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

const KEY = { tier: "pro", pro_has_key: true, pro_active: true, license_tier: "pro", pro_days_left: 300,
              forensics_license_expires: "2027-07-20", telemetry_enabled: true };
const WARN = { warning: "reports_off", grace_until: "2026-11-06T19:05:43Z", off_labels: ["Cabin", "<b>Shop</b>"] };

function makeCtx(settings, tab, sets) {
  return {
    hass: { user: { is_admin: true }, states: {} },
    state: { view: "settings", complexity: "advanced", _settingsTab: tab, model: { floors: [], areas: [] }, settings },
    helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop },
      { get: (t, k) => (k in t ? t[k] : noop) }),
    actions: new Proxy({ wsCall: async () => ({}), renderRooms() {}, renderNav() {},
                         settingsSet: async (p) => { sets.push(p); } },
      { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast() {},
  };
}
function card(settings) {
  const root = S.render(makeCtx(settings, "features", []));
  const c = root._all().find(n => (n.className || "") === "card" && /^PadSpan licence/.test((n.textContent || "").trim()));
  if (!c) throw new Error("no PadSpan licence card");
  const w = c._all().find(n => (n.className || "") === "homes-reports-warning");
  return { warning: w ? w.textContent : null, text: c.textContent };
}
async function toggle(settings, answer) {
  const sets = [], asked = [];
  globalThis.confirm = (m) => { asked.push(m); return answer; };
  const root = S.render(makeCtx(settings, "presence", sets));
  const btn = root._all().find(n => n.localName === "button" && /^(Opted in|Not sharing)$/.test((n.textContent || "").trim()));
  if (!btn) throw new Error("no usage report button on Settings → Presence");
  btn.click();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return { asked, sets };
}

const cases = {};
const run = async (name, f) => { try { cases[name] = await f(); } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); } };
await run("card_two_homes", () => card({ ...KEY, license_homes_used: 2 }));
await run("card_warned", () => card({ ...KEY, license_homes_used: 3, license_homes_warning: WARN }));
await run("card_stopped_other", () => card({ ...KEY, license_homes_used: 3, license_homes_warning: WARN, license_home_status: "needs_all_reports" }));
await run("card_stopped_own", () => card({ ...KEY, telemetry_enabled: false, license_homes_used: 3,
  license_homes_warning: { ...WARN, off_labels: ["This one"] }, license_home_status: "needs_all_reports" }));
await run("off_three_cancel", () => toggle({ ...KEY, license_homes_used: 3 }, false));
await run("off_three_ok", () => toggle({ ...KEY, license_homes_used: 3 }, true));
await run("off_two", () => toggle({ ...KEY, license_homes_used: 2 }, true));
await run("off_no_key", () => toggle({ telemetry_enabled: true, pro_has_key: false, license_homes_used: 3 }, true));
await run("on_three", () => toggle({ ...KEY, telemetry_enabled: false, license_homes_used: 3 }, true));
console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
