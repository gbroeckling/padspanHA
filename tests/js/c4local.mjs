// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN OS 2 Local for Control4 in the panel (views/c4local.js, the specialty part of the licence card in
// views/settings.js): the Settings card for each state the backend can report, every press (nothing
// is sent before a confirm, Home Assistant restarts only from its own button after its confirm),
// the Overview's card, the card in its Settings section, and the licence card's Specialty part.
// The clock is set here, never read. Before the product is published (c4local.published: its on-sale flag in
// editions.js at <now>, and the backend's settings.addons_on_sale) nothing shows to anyone and nothing is asked;
// the cards' own checks run on a copy put on sale (tests/test_c4local.py on_sale_copy).
//
// usage: c4local.mjs <views-dir> [<now ISO>]
// prints one JSON line: { checks, failures, out }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: c4local.mjs <views-dir> [now]"); process.exit(2); }
install(globalThis);
const NOW = process.argv[3] ? Date.parse(process.argv[3]) : Date.parse("2026-11-26T12:00:00Z");
const realNow = Date.now;
Date.now = () => NOW;

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
const checks = [], failures = [];
const check = (name, ok, detail) => { checks.push(name); if (!ok) failures.push({ name, detail: String(detail ?? "") }); };
const out = {};

const S = await import(pathToFileURL(join(VIEWS, "settings.js")).href);
const C = await import(pathToFileURL(join(VIEWS, "c4local.js")).href);
const ED = await import(pathToFileURL(join(VIEWS, "editions.js")).href);
const PUB = ED.addonOnSale("c4local", NOW);   // the panel's half of the switch; the backend's is addons_on_sale below
out.published = PUB;
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));
const find = (root, key) => root && root._all ? root._all().find(n => n.getAttribute && n.getAttribute("data-c4local") === key) : null;
const press = (n) => n.dispatchEvent(new Event("click"));

// A Home Assistant the card talks to: every WS call and service call is recorded; answers are set per test.
function host({ admin = true, settings = {}, answers = {}, components = ["control4"] } = {}) {
  const calls = [], services = [], sets = [];
  const ctx = {
    hass: { user: { is_admin: admin }, states: {}, config: { components },
      callService: async (d, s, data) => { services.push([d, s, data]); } },
    state: { view: "settings", complexity: "advanced", _settingsTab: "presence", model: { floors: [], areas: [] },
      settings: { telemetry_enabled: false, addons_on_sale: PUB ? ["c4local"] : [], ...settings }, dataMode: "live", _dataModeKnown: true },
    helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop },
      { get: (t, k) => (k in t ? t[k] : noop) }),
    actions: new Proxy({
      wsCall: async (type, data) => {
        calls.push(type);
        const a = answers[type];
        if (a instanceof Error || (a && a.code && !a.ok)) throw a;
        return typeof a === "function" ? a(data) : a;
      },
      settingsSet: async (payload) => { sets.push(payload); },
      renderRooms() {}, renderNav() {},
    }, { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast() {},
  };
  return { ctx, calls, services, sets };
}
let confirmSays = true;
const asked = [];
globalThis.confirm = (q) => { asked.push(q); return confirmSays; };

const PRO = { tier: "pro", pro_has_key: true, pro_active: true, license_tier: "pro", addons_licensed: ["c4local"] };
const C4KEY = { tier: "free", pro_has_key: true, addon_key: true, pro_active: true, license_tier: "free",
  license_addons: ["c4local"], addons_licensed: ["c4local"], forensics_license_expires: "" };
const BASE = { allowed: true, entries: [{ title: "Control4 HC-800", state: "setup_retry" }], failed: true, os2: ["2.10.6"],
  discovered: false, disk: null, running: null, restart_needed: false, undo: null, project_url: "https://github.com/gbroeckling/os2-local-for-control4" };
const INSTALLED = { ...BASE, failed: false, entries: [{ title: "Control4 HC-800", state: "loaded" }],
  disk: { name: "OS 2 Local for Control4", version: "1.0.0", ours: true }, running: { name: "OS 2 Local for Control4", version: "1.0.0", ours: true },
  undo: { what: "remove" } };
const text = (n) => (n ? n.textContent : null);

// ── Before it is published: nothing, to anyone, Pro included, and nothing asked ──
if (!PUB) {
  for (const [who, settings] of [["Pro", PRO], ["its key", C4KEY], ["free", { tier: "free" }]]) {
    C._reset(null);
    const h = host({ settings, answers: { "padspan_ha/c4local_status": BASE } });
    check(`unpublished, ${who}: no Settings card`, C.settingsCard(h.ctx, el) === null);
    check(`unpublished, ${who}: no Overview card`, C.overviewCard(h.ctx) === null);
    await tick();
    check(`unpublished, ${who}: nothing asked`, h.calls.length === 0 && C.settingsCard(h.ctx, el) === null, h.calls);
  }
  C._reset(BASE);
  check("unpublished, even with a status read: no card", C.settingsCard(host({ settings: PRO }).ctx, el) === null
    && C.overviewCard(host({ settings: PRO }).ctx) === null);
  const root = S.render(host({ settings: PRO }).ctx);
  check("unpublished: Settings → Tracking has no card", !find(root, "card"));
}

// ── The Settings card ────────────────────────────────────────────────────────
if (PUB) {
  C._reset(BASE);
  check("published in the panel's table alone (the backend's word not yet): no card",
    C.settingsCard(host({ settings: { ...PRO, addons_on_sale: [] } }).ctx, el) === null
    && C.overviewCard(host({ settings: { ...PRO, addons_on_sale: [] } }).ctx) === null);
  C._reset(BASE);
  check("not an administrator: no card", C.settingsCard(host({ admin: false, settings: PRO }).ctx, el) === null);
  C._reset({ ...BASE, entries: [], failed: false, os2: [] });
  check("no Control4 in Home Assistant and not bought: no card", C.settingsCard(host({ settings: PRO }).ctx, el) === null);
  const bought = C.settingsCard(host({ settings: C4KEY }).ctx, el);
  check("bought without Control4 yet: the card, to install it", !!find(bought, "install"), text(bought));
  C._reset({ ...BASE, allowed: false });
  // Published is on sale: without Pro or its key, the offer (its price, its link), never Install.
  const offered = C.settingsCard(host({ settings: { tier: "free" } }).ctx, el);
  check("not allowed, published: the offer, no Install", !!find(offered, "offer") && !!find(offered, "buy") && !find(offered, "install"), text(offered));
  C._reset({ ...BASE, entries: [], failed: false, os2: [], discovered: true });
  check("a discovered controller counts as Control4 here", !!C.settingsCard(host({ settings: PRO }).ctx, el));
}
if (PUB) {
  C._reset(BASE);
  const h = host({ settings: PRO, answers: { "padspan_ha/c4local_install": { ok: true, version: "1.0.0", restart_needed: true,
    status: { ...INSTALLED, running: null, restart_needed: true } } } });
  const card = C.settingsCard(h.ctx, el);
  out.fresh = text(card);
  check("its focus part", card.getAttribute("data-focus-part") === "c4local");
  check("says what PadSpan found", /failed to set up/.test(text(find(card, "found"))) && /runs OS 2\.10\.6/.test(text(find(card, "found"))),
    text(find(card, "found")));
  check("says why, as facts", /Cloud services for Control4 OS 2 ended on November 1, 2026/.test(out.fresh)
    && /logs in through that cloud/.test(out.fresh));
  check("no undo and no restart before anything was done", !find(card, "undo") && !find(card, "restart"));
  confirmSays = false;
  press(find(card, "install")); await tick();
  check("Install: nothing sent without the confirm", h.calls.length === 0 && asked.length === 1, h.calls);
  check("the confirm says it replaces the built-in and Undo takes it out", /built-in Control4 integration/.test(asked[0]) && /Undo/.test(asked[0]));
  confirmSays = true;
  press(find(card, "install")); await tick(); await tick();
  check("Install: one install call", JSON.stringify(h.calls) === JSON.stringify(["padspan_ha/c4local_install"]), h.calls);
  check("Install never restarts Home Assistant", h.services.length === 0, JSON.stringify(h.services));
  const after = C.settingsCard(h.ctx, el);
  out.installed = text(after);
  check("after: installed, its version, and Restart to load it",
    /Installed: version 1\.0\.0/.test(out.installed) && /Restart Home Assistant to load it/.test(text(find(after, "note"))), out.installed);
  check("after: how to use it, with the link to the entry",
    /Devices & services → Control4 → Configure/.test(text(find(after, "setup"))) && /system password/.test(text(find(after, "setup")))
    && /PadSpan Pro key/.test(text(find(after, "setup")))
    && find(after, "configure").getAttribute("href") === "/config/integrations/integration/control4");
  const restart = find(after, "restart");
  check("after: Home Assistant's restart offered", !!restart && /restarts/.test(text(after._all().find(n => n.getAttribute && n.getAttribute("data-c4local") === "restart" && n.localName === "div"))));
  const restartBtn = after._all().find(n => n.localName === "button" && n.getAttribute("data-c4local") === "restart");
  confirmSays = false; asked.length = 0;
  press(restartBtn); await tick();
  check("Restart: not without its confirm", h.services.length === 0 && asked.length === 1 && /Restart Home Assistant now\?/.test(asked[0]));
  confirmSays = true;
  press(restartBtn); await tick();
  check("Restart: Home Assistant's own restart, once", JSON.stringify(h.services) === JSON.stringify([["homeassistant", "restart", {}]]),
    JSON.stringify(h.services));
}
if (PUB) {
  // Installed, no entry yet: how to add it. Check for an update; an update; Undo's two confirms; a refusal in words.
  C._reset({ ...INSTALLED, entries: [] });
  const h = host({ settings: C4KEY, answers: {
    "padspan_ha/c4local_check": { latest: "1.1.0", newer: true, status: { ...INSTALLED, entries: [] } },
    "padspan_ha/c4local_install": Object.assign(new Error("x"), { code: "not_the_product" }),
    "padspan_ha/c4local_undo": { ok: true, what: "remove", restart_needed: true, status: { ...BASE, disk: null, running: INSTALLED.running, restart_needed: true } },
  } });
  let card = C.settingsCard(h.ctx, el);
  check("no entry yet: Add integration, with its link", /Add integration → OS 2 Local for Control4/.test(text(find(card, "setup")))
    && find(card, "add").getAttribute("href") === "/config/integrations/dashboard/add?domain=control4");
  check("installed: Check for an update, no Install", !!find(card, "check") && !find(card, "install"));
  press(find(card, "check")); await tick(); await tick();
  card = C.settingsCard(h.ctx, el);
  check("a newer release: Update to it", /Version 1\.1\.0 is out/.test(text(card)) && text(find(card, "update")) === "Update to 1.1.0", text(card));
  press(find(card, "update")); await tick(); await tick();
  card = C.settingsCard(h.ctx, el);
  check("a refusal is said in words", text(find(card, "note")) === "The download is not OS 2 Local for Control4. Nothing was changed.", text(find(card, "note")));
  asked.length = 0; confirmSays = false;
  press(find(card, "undo")); await tick();
  check("Undo: nothing sent without the confirm", !h.calls.includes("padspan_ha/c4local_undo") && /built-in Control4 integration comes back/.test(asked[0]), asked[0]);
  confirmSays = true;
  press(find(card, "undo")); await tick(); await tick();
  card = C.settingsCard(h.ctx, el);
  check("Undo: removed, restart to bring back the built-in", h.calls.includes("padspan_ha/c4local_undo")
    && /bring back the built-in Control4 integration/.test(text(find(card, "note"))) && !!find(card, "install") && h.services.length === 0, text(card));
  C._reset({ ...INSTALLED, undo: { what: "restore", name: "Control4", version: "0.9" } });
  asked.length = 0; confirmSays = false;
  press(find(C.settingsCard(host({ settings: PRO }).ctx, el), "undo"));
  check("Undo after an update or over another integration: it puts that back", /Put back the control4 folder that was there before \(Control4 0\.9\)/.test(asked[0]), asked[0]);
  C._reset({ ...BASE, disk: { name: "Control4 (someone's fork)", version: "0.1", ours: false } });
  card = C.settingsCard(host({ settings: PRO }).ctx, el);
  check("another integration in the folder: said, and Install backs it up", /holds another integration \(Control4 \(someone's fork\)\)/.test(text(find(card, "other"))));
  confirmSays = true;
  // The house's own local Control4 (the owner's: core control4 with a local token): it has it. Said, never offered.
  const LOCAL = { ...BASE, local_other: true, disk: { name: "Control4", version: "2026.7.4.1", ours: false },
    running: { name: "Control4", version: "2026.7.4.1", ours: false } };
  for (const [who, settings] of [["Pro", PRO], ["free", { tier: "free" }]]) {
    C._reset(LOCAL);
    card = C.settingsCard(host({ settings }).ctx, el);
    check(`a local Control4 of its own, ${who}: said, no Install and no offer`,
      text(find(card, "local")) === "✓ A local Control4 integration is installed (not OS 2 Local for Control4)."
      && !find(card, "install") && !find(card, "offer") && !find(card, "buy") && !/runs OS 2/.test(text(card)), text(card));
    check(`a local Control4 of its own, ${who}: no Overview card`, C.overviewCard(host({ settings }).ctx) === null);
  }
}

// ── The Overview's card ──────────────────────────────────────────────────────
if (PUB) {
  C._reset(null);
  const none = host({ settings: PRO, components: ["light"], answers: { "padspan_ha/c4local_status": BASE } });
  check("Overview: no Control4 in Home Assistant, nothing asked", C.overviewCard(none.ctx) === null && none.calls.length === 0);
  const h = host({ settings: PRO, answers: { "padspan_ha/c4local_status": BASE } });
  check("Overview: Control4 here, the status asked once", C.overviewCard(h.ctx) === null && h.calls.length === 1);
  await tick(); await tick();
  const card = C.overviewCard(h.ctx);
  check("Overview: a failed entry and OS 2, allowed, not installed: the card", !!card && /failed to set up/.test(text(card))
    && text(find(card, "open")) === "Install it from Settings", text(card));
  C.overviewCard(h.ctx);
  check("Overview: asked once per page load", h.calls.length === 1);
  press(find(card, "open"));
  check("Overview: opens Settings at the card", h.ctx.state._presenceReveal === "integrations" && h.ctx.state._settingsPart === "c4local");
  C._reset(INSTALLED);
  check("Overview: installed, no card", C.overviewCard(host({ settings: PRO }).ctx) === null);
  C._reset({ ...BASE, allowed: false });
  const ov = C.overviewCard(host({ settings: { tier: "free" } }).ctx);
  check("Overview: not allowed, published: the offer", !!find(ov, "buy") && !find(ov, "open"), text(ov));
  C._reset({ ...BASE, failed: false, os2: [], entries: [{ title: "C4", state: "loaded" }] });
  check("Overview: Control4 working, no card", C.overviewCard(host({ settings: PRO }).ctx) === null);
  C._reset(BASE);
  const h2 = host({ settings: PRO });
  const c2 = C.overviewCard(h2.ctx);
  press(find(c2, "no"));
  await tick();
  check("Overview: No thanks is the install's: saved, and away for this page", C.overviewCard(h2.ctx) === null
    && JSON.stringify(h2.sets) === JSON.stringify([{ c4local_offer_done: true }]), JSON.stringify(h2.sets));
  check("Overview: No thanks never touches the browser's storage", localStorage.getItem("padspan_c4local_offer") === null);
  C._reset(BASE);
  check("Overview: its flag keeps it away on every page and browser",
    C.overviewCard(host({ settings: { ...PRO, c4local_offer_done: true } }).ctx) === null && !!C.overviewCard(host({ settings: PRO }).ctx));
  C._reset(BASE);
  const wall = host({ settings: PRO });
  wall.ctx.state.kioskMode = true;
  check("Overview: never on a wall", C.overviewCard(wall.ctx) === null);
  check("Overview: not an administrator, no card", C.overviewCard(host({ admin: false, settings: PRO }).ctx) === null);
}

// ── In its Settings section ──────────────────────────────────────────────────
if (PUB) {
  C._reset(BASE);
  const root = S.render(host({ settings: PRO }).ctx);
  const sec = root._all().find(n => n.getAttribute && n.getAttribute("data-presence-section") === "integrations");
  check("Settings → Tracking: the card is in Home Assistant and integrations", !!sec && !!find(sec, "card"));
}

// ── The licence card's Specialty part ────────────────────────────────────────
function licenceCard(settings) {
  const { ctx } = host({ settings });
  ctx.state._settingsTab = "features";
  const root = S.render(ctx);
  return root._all().find(n => (n.className || "") === "card" && /^PadSpan licence/.test((n.textContent || "").trim()));
}
const part = (card) => card._all().find(n => (n.className || "") === "addon-specialty") || null;
const offerList = (card) => { const o = card._all().find(n => (n.className || "") === "addon-offer"); return o ? o._all().filter(n => n.localName === "a").map(a => a.getAttribute("data-addon")) : []; };
const status = (card) => text(card._all().find(n => /margin:8px 0 10px/.test((n.getAttribute && n.getAttribute("style")) || "")));
{
  const only = licenceCard(C4KEY);
  out.c4only = { status: status(only), specialty: text(part(only)) };
  const both = licenceCard({ ...C4KEY, license_addons: ["audio", "c4local"], addons_licensed: ["audio", "c4local"],
    license_addons_until: { audio: "2028-11-25 10:00:00" }, forensics_license_expires: "2028-11-25" });
  out.both = { status: status(both), specialty: text(part(both)) };
  const nokey = licenceCard({ tier: "free", pro_has_key: false });
  out.nokey = { specialty: part(nokey) ? text(part(nokey)) : null, offer: offerList(nokey) };
  out.pro = { specialty: part(licenceCard(PRO)) ? "shown" : null };
}

Date.now = realNow;
process.stdout.write(JSON.stringify({ checks, failures, out }) + "\n", () => process.exit(failures.length ? 1 : 0));
