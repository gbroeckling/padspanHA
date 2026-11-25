// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The house's alarm inside the emergency button (views/alarm_panel.js), RUN:
// the modes a panel supports and no others, the code asked for when the
// panel wants one (number or text, code_arm_required), every arm and disarm
// asking first in the Atlas's own box (lights_map.js confirmAsk), Home
// Assistant's refusal said plainly, what set it off named (Alarmo's
// open_sensors), the button's summary (the free tier's only while it goes
// off), panel.js's emergency banner with the alarm going off in it, and its
// words in German.
//
// usage: alarm_button.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { install } from "./dom_shim.mjs";
import { panelT } from "./panel_t.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: alarm_button.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; Object.assign(this, o || {}); } };

const failures = [];
const cases = {};
const check = (name, ok, detail) => { if (cases[name] !== false) cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e && e.stack || e).slice(0, 1500)); } };

globalThis.fetch = async (url) => {
  const key = new URL(String(url)).pathname.split("/i18n/")[1];
  try { return { ok: true, json: async () => JSON.parse(readFileSync(join(WWW, "i18n", key), "utf-8")) }; }
  catch (_) { return { ok: false, json: async () => ({}) }; }
};

const I = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href);
const A = await import(pathToFileURL(join(WWW, "views", "alarm_panel.js")).href);
const LM = await import(pathToFileURL(join(WWW, "views", "lights_map.js")).href);
const tick = () => new Promise(r => globalThis._realSetTimeout(r, 0));
const all = (n, tag, out = []) => { for (const c of n.children || []) { if (!tag || c.localName === tag) out.push(c); all(c, tag, out); } return out; };
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of [].concat(kids)) if (c !== null && c !== undefined) n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  return n;
};
const card = () => all(document.body, "div").find(d => d.className === "ps-alarm-card");
const ask = () => all(document.body, "div").filter(d => d.attributes && d.attributes.role === "alertdialog").pop() || null;
const buttonsIn = (n) => (n ? all(n, "button").map(b => b.textContent) : []);
// A press does not wait on what it starts (an Arm waits on its question): the page goes on, as in a browser.
const press = async (b) => { for (const f of (b._listeners.click || []).slice()) f({ stopPropagation() {}, preventDefault() {}, target: b }); await tick(); await tick(); };
const pressText = async (root, label) => { const b = all(root, "button").find(x => x.textContent === label); if (!b) throw new Error(`no "${label}" in ${buttonsIn(root).join(", ")}`); await press(b); };
const reset = () => { document.body.children.length = 0; };
// The alarm's part of the emergency button's card, as lights_panel.js puts it in (controls: Bright or Pro).
const openSection = (api, controls = true) => { const sec = A.alarmSection({ ...api, controls }); sec.fill(); document.body.appendChild(sec.node); return sec; };

const ST = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes: { friendly_name: entity_id.split(".")[1].replace(/_/g, " "), ...attributes } });
const states = (...list) => Object.fromEntries(list.map(s => [s.entity_id, s]));

// A host as lights_panel.js hands one, recording what reached Home Assistant.
function host(st, { refuse = null } = {}) {
  const h = { calls: [], toasts: [], counts: [], closed: 0 };
  h.api = {
    el, states: () => h.states, ask: LM.confirmAsk,
    call: async (service, data) => { h.calls.push({ service, ...data }); if (refuse) throw { code: "service_validation_error", message: refuse }; },
    toast: (m, e) => h.toasts.push([m, !!e]), errorText: (e) => e.message, count: (w) => h.counts.push(w), keys: null,
    onClose: () => { h.closed++; },
  };
  h.states = st;
  return h;
}

await tryCase("modes", async () => {
  const words = (f) => A.armModes({ supported_features: f }).map(m => m.service);
  check("modes", words(3).join() === "alarm_arm_home,alarm_arm_away", words(3));
  check("modes", words(63).join() === "alarm_arm_home,alarm_arm_away,alarm_arm_night,alarm_arm_vacation,alarm_arm_custom_bypass", words(63));
  check("modes", words(8).length === 0 && words(undefined).length === 0, words(8));     // TRIGGER alone: nothing to arm
  check("modes", words(36).join() === "alarm_arm_night,alarm_arm_vacation", words(36));
  // Disarmed: its modes; armed, arming, pending, going off: Disarm; on its way to disarmed or unavailable: nothing.
  const acts = (state) => A.actionsFor({ state, attrs: { supported_features: 2 } }).map(a => a.service).join();
  check("modes", acts("disarmed") === "alarm_arm_away", acts("disarmed"));
  for (const s of ["armed_home", "armed_away", "armed_night", "armed_vacation", "armed_custom_bypass", "arming", "pending", "triggered"])
    check("modes", acts(s) === "alarm_disarm", [s, acts(s)]);
  for (const s of ["disarming", "unavailable", "unknown"]) check("modes", acts(s) === "", [s, acts(s)]);
  // Every Home Assistant alarm state in words.
  for (const [s, w] of [["disarmed", "Disarmed"], ["armed_home", "Armed home"], ["armed_away", "Armed away"], ["armed_night", "Armed night"],
    ["armed_vacation", "Armed vacation"], ["armed_custom_bypass", "Armed custom bypass"], ["pending", "Pending"], ["arming", "Arming"],
    ["disarming", "Disarming"], ["triggered", "Triggered"]]) check("modes", A.stateWord(s) === w, [s, A.stateWord(s)]);
  // A card on a panel with home and away only shows those two.
  reset();
  const h = host(states(ST("alarm_control_panel.house", "disarmed", { supported_features: 3, code_format: null })));
  const c = openSection(h.api);
  check("modes", buttonsIn(card()).filter(b => b !== "✕").join() === "Arm home,Arm away", buttonsIn(card()));
  c.close();
});

await tryCase("no-code", async () => {
  reset();
  const h = host(states(ST("alarm_control_panel.house", "disarmed", { supported_features: 3, code_format: null })));
  openSection(h.api);
  // Never one blind tap: Arm away asks first, and Cancel sends nothing.
  await pressText(card(), "Arm away");
  check("no-code", !!ask() && h.calls.length === 0, buttonsIn(ask()));
  check("no-code", ask() && all(ask(), "input").length === 0, "a code field on a panel with no code");
  check("no-code", ask() && ask().attributes["aria-label"] === "Arm away: house?", ask() && ask().attributes["aria-label"]);
  await pressText(ask(), "Cancel");
  check("no-code", !ask() && h.calls.length === 0, h.calls);
  await pressText(card(), "Arm away");
  await pressText(ask(), "Arm away");
  await tick();
  check("no-code", JSON.stringify(h.calls) === JSON.stringify([{ service: "alarm_arm_away", entity_id: "alarm_control_panel.house" }]), h.calls);
  check("no-code", h.counts.join() === "arm", h.counts);
  // Armed now: Disarm only, and it asks.
  h.states = states(ST("alarm_control_panel.house", "armed_away", { supported_features: 3, code_format: null }));
  reset();
  openSection(h.api);
  check("no-code", buttonsIn(card()).filter(b => b !== "✕").join() === "Disarm", buttonsIn(card()));
  await pressText(card(), "Disarm");
  check("no-code", !!ask() && ask().attributes["aria-label"] === "Disarm house?" && h.calls.length === 1, ask() && ask().attributes["aria-label"]);
  await pressText(ask(), "Disarm");
  await tick();
  check("no-code", h.calls[1] && h.calls[1].service === "alarm_disarm" && !("code" in h.calls[1]), h.calls);
  check("no-code", h.counts.join() === "arm,disarm", h.counts);
});

await tryCase("code", async () => {
  // A number code, wanted to arm and to disarm.
  reset();
  const h = host(states(ST("alarm_control_panel.alarmo", "disarmed", { supported_features: 7, code_format: "number", code_arm_required: true })));
  openSection(h.api);
  await pressText(card(), "Arm night");
  const field = ask() && all(ask(), "input")[0];
  check("code", field && field.attributes.inputmode === "numeric" && field.attributes.type === "password" && field.attributes.autocomplete === "off",
    field && field.attributes);
  // The button does nothing until there is a code.
  await pressText(ask(), "Arm night");
  check("code", !!ask() && h.calls.length === 0, h.calls);
  field.value = "1234";
  await pressText(ask(), "Arm night");
  await tick();
  check("code", JSON.stringify(h.calls) === JSON.stringify([{ service: "alarm_arm_night", entity_id: "alarm_control_panel.alarmo", code: "1234" }]), h.calls);
  check("code", field.value === "", "the code was kept in the field");
  // Enter in the field says yes once a code is typed.
  h.states = states(ST("alarm_control_panel.alarmo", "armed_night", { supported_features: 7, code_format: "number", code_arm_required: true }));
  reset();
  openSection(h.api);
  await pressText(card(), "Disarm");
  const f2 = all(ask(), "input")[0];
  f2.value = "9876";
  f2.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  await tick(); await tick();
  check("code", h.calls[1] && h.calls[1].service === "alarm_disarm" && h.calls[1].code === "9876", h.calls);
  // A text code, and a panel that arms without one (code_arm_required false): arming asks with no field, disarming with one.
  reset();
  const h2 = host(states(ST("alarm_control_panel.panel", "disarmed", { supported_features: 2, code_format: "text", code_arm_required: false })));
  openSection(h2.api);
  await pressText(card(), "Arm away");
  check("code", ask() && all(ask(), "input").length === 0, "arming asked for a code the panel does not want");
  await pressText(ask(), "Arm away"); await tick();
  check("code", h2.calls[0] && !("code" in h2.calls[0]), h2.calls);
  h2.states = states(ST("alarm_control_panel.panel", "armed_away", { supported_features: 2, code_format: "text", code_arm_required: false }));
  reset();
  openSection(h2.api);
  await pressText(card(), "Disarm");
  const f3 = all(ask(), "input")[0];
  check("code", f3 && f3.attributes.inputmode === "text", f3 && f3.attributes);
  f3.value = "open sesame";
  await pressText(ask(), "Disarm"); await tick();
  check("code", h2.calls[1] && h2.calls[1].code === "open sesame", h2.calls);
  // The rule itself: disarming whenever there is a code; arming unless code_arm_required is false.
  check("code", A.codeFor({ code_format: null }, false) === null && A.codeFor({ code_format: "number" }, true) === "number"
    && A.codeFor({ code_format: "number" }, false) === "number" && A.codeFor({ code_format: "text", code_arm_required: false }, true) === null, "codeFor");
});

await tryCase("refused", async () => {
  reset();
  const h = host(states(ST("alarm_control_panel.alarmo", "armed_away", { supported_features: 3, code_format: "number" })), { refuse: "Invalid alarm code provided" });
  openSection(h.api);
  await pressText(card(), "Disarm");
  all(ask(), "input")[0].value = "0000";
  await pressText(ask(), "Disarm"); await tick();
  check("refused", h.toasts.length === 1 && h.toasts[0][0] === "alarmo refused: Invalid alarm code provided" && h.toasts[0][1] === true, h.toasts);
  check("refused", h.counts.join() === "refused", h.counts);
  // Nothing the report carries is a code or a name.
  check("refused", h.counts.every(w => ["shown", "arm", "disarm", "refused"].includes(w)), h.counts);
  check("refused", !!card() && buttonsIn(card()).includes("Disarm"), "the card should stay, ready to try again");
});

await tryCase("tripped", async () => {
  const st = states(
    ST("alarm_control_panel.alarmo", "triggered", { supported_features: 3, code_format: "number", open_sensors: { "binary_sensor.back_door": "on" } }),
    ST("binary_sensor.back_door", "on", { friendly_name: "Back door", device_class: "door" }),
    ST("alarm_control_panel.garage", "triggered", { supported_features: 2, open_sensors: ["binary_sensor.gone"] }),
    ST("alarm_control_panel.shed", "triggered", { supported_features: 2, open_sensors: null, changed_by: "Alex" }),
    ST("alarm_control_panel.house", "armed_home", { supported_features: 3 }),
  );
  const rows = A.triggeredAlarms(st);
  check("tripped", rows.length === 3, rows);
  check("tripped", rows.some(r => r.text === "Alarm going off: alarmo · Back door"), rows);
  check("tripped", rows.some(r => r.text === "Alarm going off: garage · binary_sensor.gone"), rows);   // not in hass: its id
  check("tripped", rows.some(r => r.text === "Alarm going off: shed"), rows);                         // says nothing: no sensor named
  // The card names it too.
  reset();
  const h = host(st);
  openSection(h.api);
  check("tripped", card().textContent.includes("Set off by Back door"), card().textContent);
  check("tripped", A.triggeredAlarms(states(ST("alarm_control_panel.house", "disarmed"))).length === 0, "a quiet alarm in the banner");
});

await tryCase("summary", async () => {
  // What the emergency button's centre shows (lights_panel.js draws the shield in this state's colour).
  const one = A.alarmPanels(states(ST("alarm_control_panel.house", "armed_away", { supported_features: 3 })));
  const st2 = states(ST("alarm_control_panel.house", "armed_away", { supported_features: 3 }), ST("alarm_control_panel.garage", "disarmed", { supported_features: 3 }));
  const two = A.alarmPanels(st2);
  check("summary", A.alarmSummary({ panels: [], states: {}, controls: true }) === null, "a summary with no alarm");
  const s1 = A.alarmSummary({ panels: one, states: {}, controls: true });
  check("summary", s1 && s1.kind === "armed" && s1.word === "Armed away" && s1.label === "Alarm: Armed away" && s1.n === 1, s1);
  // Several: the most pressing state, and how many.
  const s2 = A.alarmSummary({ panels: two, states: st2, controls: true });
  check("summary", s2 && s2.word === "Armed away" && s2.label === "2 alarms: Armed away" && s2.title === "garage: Disarmed\nhouse: Armed away", s2);
  // Free: nothing, until it goes off; then said, with what set it off.
  check("summary", A.alarmSummary({ panels: two, states: st2, controls: false }) === null, "a free summary for a quiet alarm");
  const trig = states(ST("alarm_control_panel.house", "triggered", { open_sensors: { "binary_sensor.hall": "on" } }), ST("binary_sensor.hall", "on", { friendly_name: "Hall motion" }));
  const free = A.alarmSummary({ panels: A.alarmPanels(trig), states: trig, controls: false });
  check("summary", free && free.kind === "triggered" && free.word === "Triggered · Hall motion", free);
  // Free, the card: the alarm going off, said, and nothing to press; a quiet alarm not at all.
  reset();
  const sf = openSection(host(trig).api, false);
  check("summary", !sf.empty() && card().textContent.includes("Set off by Hall motion") && all(card(), "button").length === 0, card() && card().textContent);
  reset();
  const sq = openSection(host(st2).api, false);
  check("summary", sq.empty() && (card().children || []).length === 0, "a free card for a quiet alarm");
});

await tryCase("banner", async () => {
  // panel.js's _updateEmergencyBanner, lifted out and run with the module as panel.js loads it.
  const src = readFileSync(join(WWW, "panel.js"), "utf8").replace(/\r\n/g, "\n");
  const a = src.indexOf("\n  _updateEmergencyBanner(){");
  let depth = 0, end = -1;
  for (let j = src.indexOf("{", a); j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}") { depth--; if (!depth) { end = j + 1; break; } } }
  const { t, tn } = panelT(src);
  const Panel = new Function("ALARM", "t", "tn", `return class { ${src.slice(a, end)} };`)(A, t, tn);
  const make = (st, latches = {}, tier = "free") => {
    const p = new Panel();
    p.state = { settings: { flood_latches: latches, tier }, dataMode: "live" };
    p._hass = { states: st };
    const els = {};
    for (const id of ["#emergencyBanner", "#emergencyBannerCount", "#emergencyBannerList", "#mobileEmergencyPill"]) els[id] = document.createElement("div");
    els["#emergencyBanner"].classList.add("hidden");
    els["#mobileEmergencyPill"].classList.add("hidden");
    p.$ = (sel) => els[sel] || null;
    p._updateEmergencyBanner();
    return els;
  };
  const trig = states(ST("alarm_control_panel.alarmo", "triggered", { open_sensors: { "binary_sensor.back_door": "on" } }),
    ST("binary_sensor.back_door", "on", { friendly_name: "Back door" }));
  // Every tier: the banner is a safety alert.
  for (const tier of ["free", "bright", "pro"]) {
    const els = make(trig, {}, tier);
    check("banner", !els["#emergencyBanner"].classList.contains("hidden") && els["#emergencyBannerList"].textContent === "Alarm going off: alarmo · Back door"
      && els["#emergencyBannerCount"].textContent === "1 active" && els["#mobileEmergencyPill"].textContent === "🚨 1", [tier, els["#emergencyBannerList"].textContent]);
  }
  // With a latched leak: both, counted together.
  const soon = Date.now() / 1000 + 3600;
  const both = make({ ...trig, "binary_sensor.sink": ST("binary_sensor.sink", "off", { friendly_name: "Sink leak" }) },
    { "binary_sensor.sink": { triggered_at: 1, expires_at: soon } });
  check("banner", both["#emergencyBannerCount"].textContent === "2 active" && /Sink leak/.test(both["#emergencyBannerList"].textContent)
    && /Back door/.test(both["#emergencyBannerList"].textContent), both["#emergencyBannerList"].textContent);
  // Armed but quiet, or no alarm at all: the banner stays hidden, as it was.
  for (const st of [states(ST("alarm_control_panel.alarmo", "armed_away")), {}]) {
    const els = make(st);
    check("banner", els["#emergencyBanner"].classList.contains("hidden") && els["#mobileEmergencyPill"].classList.contains("hidden")
      && els["#emergencyBannerList"].children.length === 0, Object.keys(st));
  }
});

await tryCase("german", async () => {
  const lang = await I.useLanguage({ language: "de" }, ["atlas1", "atlasmap"]);
  check("german", lang === "de", lang);
  check("german", A.stateWord("armed_away") === "Scharf (abwesend)" && A.stateWord("triggered") === "Ausgelöst" && A.stateWord("disarmed") === "Unscharf",
    [A.stateWord("armed_away"), A.stateWord("triggered")]);
  reset();
  const h = host(states(ST("alarm_control_panel.haus", "armed_away", { supported_features: 3, code_format: "number" })));
  openSection(h.api);
  check("german", buttonsIn(card()).includes("Unscharf schalten") && card().textContent.includes("Alarmanlage"), buttonsIn(card()));
  await pressText(card(), "Unscharf schalten");
  check("german", ask() && ask().attributes["aria-label"] === "haus unscharf schalten?" && buttonsIn(ask()).includes("Abbrechen")
    && all(ask(), "input")[0].attributes.placeholder === "Code", ask() && [ask().attributes["aria-label"], buttonsIn(ask())]);
  await pressText(ask(), "Abbrechen");
  check("german", A.triggeredAlarms(states(ST("alarm_control_panel.haus", "triggered")))[0].text === "Alarm ausgelöst: haus", "banner in German");
  await I.useLanguage({ language: "en" }, []);
});

process.stdout.write(JSON.stringify({ cases, failures }) + "\n", () => process.exit(0));
