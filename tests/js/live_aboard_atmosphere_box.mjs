// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → UI Structure → Atlas → 3D house (views/settings.js): its
// atmosphere rows (P8). "Rain and snow" (atlas_3d_weather, on by default; it
// follows Outdoor weather, which must be on too) and "Look" (atlas_3d_look:
// Same as the Atlas, the default, or Live Aboard's own; it took the place of
// the old "Use the Atlas's Showcase look" tick) sit with the box's other
// rows, shown only once the 3D house is on; each saves alone, straight to
// the wire, and a save that fails puts its choice back.
//
// usage: live_aboard_atmosphere_box.mjs <views-dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: live_aboard_atmosphere_box.mjs <views-dir>"); process.exit(2); }
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
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const noop = () => el("span");
const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const S = await import(pathToFileURL(join(VIEWS, "settings.js")).href);
const settle = async () => { await flush(); await new Promise(r => globalThis._realSetTimeout(r, 5)); };

function settingsPage(settings, { refuse = false } = {}) {
  const sent = [];
  let rerenders = 0;
  const ctx = {
    hass: { user: { is_admin: true }, states: {} },
    state: { view: "settings", complexity: "advanced", _settingsTab: "ui", model: { floors: [], areas: [], room_geometry_m: {} },
      settings: { lights_panel_enabled: true, atlas_emergency_button: true, advanced_extra_tabs: [], tier: "pro", ...settings } },
    helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop },
      { get: (t, k) => (k in t ? t[k] : noop) }),
    actions: new Proxy({ settingsSet: async () => { rerenders++; return {}; },
      wsCall: async (type, data = {}) => {
        if (type !== "padspan_ha/settings_set") return {};
        sent.push(data);
        if (refuse) throw new Error("refused");
        return { settings: { ...ctx.state.settings, ...data } };
      }, renderRooms() {}, renderNav() {} },
      { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast() {},
  };
  const root = S.render(ctx);
  const box = root._all().find(n => n.children && n.children.some(c => c.textContent === "🏠 Live Aboard"));
  if (!box) throw new Error("no Live Aboard box on Settings → UI Structure");
  const all = box._all();
  const more = all.find(n => n.attributes && "data-la3d-more" in n.attributes);
  const tick = (key) => all.find(n => (n.localName === "input" || n.localName === "select") && n.getAttribute("data-la3d-key") === key) || null;
  const master = all.find(n => n.localName === "input" && n.getAttribute("type") === "checkbox");
  return { ctx, sent, box, more, master, wx: tick("atlas_3d_weather"), sc: tick("atlas_3d_look"), old: tick("atlas_3d_showcase"),
           rerenders: () => rerenders, text: box.textContent };
}
const change = async (cb, v) => { if (cb.localName === "select") cb.value = v; else cb.checked = v; cb.dispatchEvent({ type: "change" }); await settle(); };

try {
  const off = settingsPage({ atlas_3d_enabled: false });
  check("box: the two rows sit with the box's other rows, shown only while it is on",
    off.wx && off.sc && off.master !== off.wx && off.master !== off.sc && off.more.contains(off.wx) && off.more.contains(off.sc)
    && off.more.style.display === "none" && /Rain and snow/.test(off.text) && /Look/.test(off.text) && /Same as the Atlas/.test(off.text)
    && /Live Aboard's own/.test(off.text) && !/Use the Atlas's Showcase look/.test(off.text) && off.old === null
    && /Follows Outdoor weather above, and shows only while that is on too\./.test(off.text) && !/\b3D\b/.test(
      off.more.textContent.slice(off.more.textContent.indexOf("Rain and snow"))), { text: off.text });
  const dflt = settingsPage({ atlas_3d_enabled: true });
  const wxOff = settingsPage({ atlas_3d_enabled: true, atlas_3d_weather: false, atlas_3d_look: "own" });
  const oldOn = settingsPage({ atlas_3d_enabled: true, atlas_3d_showcase: true });
  check("box: Rain and snow is on unless switched off; the look is the Atlas's unless Live Aboard's own is chosen",
    dflt.wx.checked === true && dflt.sc.value === "atlas" && wxOff.wx.checked === false && wxOff.sc.value === "own"
    && oldOn.sc.value === "atlas" && dflt.more.style.display === "block",
    { dflt: [dflt.wx.checked, dflt.sc.value], wxOff: [wxOff.wx.checked, wxOff.sc.value], oldOn: oldOn.sc.value });
  // Each saves alone, at once, straight to the wire (no page re-render).
  await change(dflt.wx, false);
  const a = dflt.sent.splice(0);
  await change(dflt.sc, "own");
  const b = dflt.sent.splice(0);
  await change(dflt.wx, true);
  const c = dflt.sent.splice(0);
  check("box: each saves its own key alone",
    JSON.stringify(a) === JSON.stringify([{ atlas_3d_weather: false }]) && JSON.stringify(b) === JSON.stringify([{ atlas_3d_look: "own" }])
    && JSON.stringify(c) === JSON.stringify([{ atlas_3d_weather: true }]) && dflt.rerenders() === 0
    && dflt.ctx.state.settings.atlas_3d_look === "own" && dflt.ctx.state.settings.atlas_3d_weather === true, { a, b, c });
  const bad = settingsPage({ atlas_3d_enabled: true }, { refuse: true });
  await change(bad.wx, false);
  await change(bad.sc, "own");
  await new Promise(r => globalThis._realSetTimeout(r, 10));
  check("box: a failed save puts the tick back", bad.wx.checked === true && bad.sc.value === "atlas",
    { wx: bad.wx.checked, sc: bad.sc.value });
} catch (e) { failures.push({ name: "harness", detail: String(e && e.stack || e).slice(0, 800) }); }

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
