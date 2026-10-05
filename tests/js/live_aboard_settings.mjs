// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN Settings → UI Structure → Atlas → 3D house (views/settings.js).
//
// The master switch and one line on what it adds; once it is on, Quality
// (Auto / Low / High) and North (the GPS Bridge's fabric_bearing_deg, with a
// live preview: the plan's outline as drawn, y down, with an N arrow from
// fabric_compass.js, loaded only once the switch is on). Each saves on its
// own, straight to the wire, the moment it changes; a save that fails puts
// the control back.
//
// usage: live_aboard_settings.mjs <views-dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS = process.argv[2];
if (!VIEWS) { console.error("usage: live_aboard_settings.mjs <views-dir>"); process.exit(2); }
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
// A save's promise chain, run to the end.
const settle = async () => { await flush(); await new Promise(r => globalThis._realSetTimeout(r, 5)); };

function settingsPage(settings, { refuse = false, admin = true } = {}) {
  const sent = [], ws = [], toasts = [];
  let rerenders = 0;
  const ctx = {
    hass: { user: { is_admin: admin }, states: {} },
    state: { view: "settings", complexity: "advanced", _settingsTab: "ui", model: { floors: [], areas: [], room_geometry_m: {
      Kitchen: { type: "poly", floor_id: "main", points_m: [[0, 0], [6, 0], [6, 2], [0, 2]] },
      Garage: { type: "poly", floor_id: "main", points_m: [[0, 4], [6, 4], [6, 6], [0, 6]] },
      Yard: { type: "poly", floor_id: "__outside__", points_m: [[20, 0], [30, 0], [30, 9], [20, 9]] } } },
      settings: { lights_panel_enabled: true, atlas_emergency_button: true, advanced_extra_tabs: [], tier: "pro", ...settings } },
    helpers: new Proxy({ el, esc: (s) => String(s), roomColor: () => "#52b788", helpBtn: noop },
      { get: (t, k) => (k in t ? t[k] : noop) }),
    actions: new Proxy({ settingsSet: async () => { rerenders++; return {}; },
      wsCall: async (type, data = {}) => {
        if (type !== "padspan_ha/settings_set") { ws.push([type, data]); return { cleared: true, backup_id: "bk_1" }; }
        sent.push(data);
        if (refuse) throw new Error("refused");
        return { settings: { ...ctx.state.settings, ...data } };
      }, renderRooms() {}, renderNav() {} },
      { get: (t, k) => (k in t ? t[k] : () => {}) }),
    toast(text, isError) { toasts.push([text, !!isError]); },
  };
  const root = S.render(ctx);
  const box = root._all().find(n => n.children && n.children.some(c => c.textContent === "🏠 Live Aboard"));
  if (!box) { if (settings.__maybe) return null; throw new Error("no Live Aboard box on Settings → UI Structure"); }
  const all = box._all();
  const cb = all.find(n => n.localName === "input" && n.getAttribute("type") === "checkbox");
  const sel = all.find(n => n.localName === "select");
  const more = all.find(n => n.attributes && "data-la3d-more" in n.attributes);
  const north = all.find(n => n.localName === "input" && n.getAttribute("type") === "number");
  const needle = all.find(n => n.attributes && "data-la3d-north" in n.attributes);
  const polys = all.filter(n => n.localName === "polygon").map(n => n.getAttribute("points"));
  return { ctx, sent, ws, toasts, box, cb, sel, more, north, needle, polys, rerenders: () => rerenders,
           text: box.textContent, options: sel ? sel.children.map(o => [o.getAttribute("value"), o.textContent]) : [] };
}

try {
  // Off (the default): the switch, the line, no Quality.
  const off = settingsPage({ atlas_3d_enabled: false, atlas_3d_quality: "auto" });
  check("box: off shows the switch and one line, not Quality or North",
    off.cb && off.cb.checked === false && off.more && off.more.style.display === "none"
    && off.sel && off.more.contains(off.sel) && off.north && off.more.contains(off.north)
    && /Adds a Map \/ Live Aboard switch to the Atlas/.test(off.text) && /Off by default\./.test(off.text)
    && /Show Live Aboard on the Atlas/.test(off.text) && !/people|AI Task|library|furniture/i.test(off.text.replace(off.more.textContent, "").replace(/Adds a Map[^.]*\./, "")),
    { text: off.text });
  await settle();
  const offNeedle = off.needle && off.needle.getAttribute("visibility");
  check("box: Quality is Auto / Low / High",
    JSON.stringify(off.options.map(o => o[0])) === JSON.stringify(["auto", "low", "high"]), off.options);
  // Tick it: saved at once, alone, and Quality appears.
  off.cb.checked = true;
  off.cb.dispatchEvent({ type: "change" });
  await flush();
  await settle();
  check("box: ticking saves atlas_3d_enabled alone and shows Quality and North",
    JSON.stringify(off.sent) === JSON.stringify([{ atlas_3d_enabled: true }]) && off.more.style.display === "block"
    && off.rerenders() === 0 && off.ctx.state.settings.atlas_3d_enabled === true, { sent: off.sent, display: off.more.style.display });
  check("north: the compass loads only once the switch is on", offNeedle === "hidden" && off.needle.getAttribute("visibility") === "visible",
    { before: offNeedle, after: off.needle.getAttribute("visibility") });
  // Quality: saved at once, alone.
  off.sent.length = 0;
  off.sel.value = "low";
  off.sel.dispatchEvent({ type: "change" });
  await flush();
  check("box: Quality saves atlas_3d_quality alone",
    JSON.stringify(off.sent) === JSON.stringify([{ atlas_3d_quality: "low" }]) && off.ctx.state.settings.atlas_3d_quality === "low", off.sent);
  // On already: Quality shows with its value.
  const on = settingsPage({ atlas_3d_enabled: true, atlas_3d_quality: "high" });
  check("box: on shows Quality with the saved value", on.cb.checked && on.more.style.display === "block" && on.sel.value === "high",
    { checked: on.cb.checked, display: on.more.style.display, value: on.sel.value });
  // North: the GPS Bridge's bearing, written alone, kept to 0-359.
  const n = settingsPage({ atlas_3d_enabled: true, fabric_bearing_deg: 180, fabric_origin_lat: 49.28, fabric_origin_lon: -123.12 });
  await settle();
  const rot = () => n.needle && n.needle.getAttribute("transform");
  const start = { value: n.north.value, rot: rot(), text: /same bearing the GPS Bridge uses/.test(n.text) };
  // The plan as drawn: the two indoor rooms, the Garage (y 4-6) below the Kitchen (y 0-2); no yard.
  const ys = n.polys.map(pts => pts.split(" ").map(q => Number(q.split(",")[1])));
  check("north: the preview is the plan's outline, y down as drawn", n.polys.length === 2
    && Math.min(...ys[1]) > Math.max(...ys[0]), n.polys);
  n.north.value = "90";
  n.north.dispatchEvent({ type: "input" });
  const live = rot();
  n.north.dispatchEvent({ type: "change" });
  await settle();
  const first = n.sent.splice(0);
  n.north.value = "370";
  n.north.dispatchEvent({ type: "change" });
  await settle();
  const wrapped = { sent: n.sent.splice(0), value: n.north.value };
  n.north.value = "north-ish";
  n.north.dispatchEvent({ type: "change" });
  await settle();
  const junk = { sent: n.sent.splice(0), value: n.north.value };
  check("north: the row writes only fabric_bearing_deg, 0-359, with a live preview",
    start.value === "180" && start.rot === "rotate(0.0 66 44)" && start.text && live === "rotate(90.0 66 44)"
    && JSON.stringify(first) === JSON.stringify([{ fabric_bearing_deg: 90 }])
    && JSON.stringify(wrapped.sent) === JSON.stringify([{ fabric_bearing_deg: 10 }]) && wrapped.value === "10"
    && junk.sent.length === 0 && junk.value === "10"
    && n.ctx.state.settings.fabric_origin_lat === 49.28 && n.ctx.state.settings.fabric_bearing_deg === 10,
    { start, live, first, wrapped, junk });
  // Pro only: PadSpan Pro and Bright Pro (the effective tier "pro" in either
  // edition). Below it there is no box at all, and what is stored stays.
  const gate = {};
  for (const [edition, tier] of [["full", "pro"], ["bright", "pro"], ["full", "bright"], ["bright", "bright"], ["full", "free"], ["bright", "free"], ["full", undefined]]) {
    const pg = settingsPage({ __maybe: true, edition, tier, atlas_3d_enabled: true, atlas_3d_quality: "high", fabric_bearing_deg: 33 });
    gate[`${edition}/${tier}`] = !!pg;
  }
  check("gate: the box shows at Pro in either edition, never below", JSON.stringify(gate) === JSON.stringify({
    "full/pro": true, "bright/pro": true, "full/bright": false, "bright/bright": false, "full/free": false, "bright/free": false, "full/undefined": false }), gate);
  // Remove all furniture: admins only, once on; asked in the page; the
  // server takes the backup (ws_house3d.house3d_clear only="pieces").
  const btns = (pg) => pg.box._all().filter(b => b.localName === "button");
  const btn = (pg, text) => btns(pg).find(b => b.textContent === text);
  const rm = settingsPage({ atlas_3d_enabled: true });
  const rmRow = rm.box._all().find(n => n.attributes && "data-la3d-rmfur" in n.attributes);
  const firstBtn = btn(rm, "Remove all furniture…");
  firstBtn.dispatchEvent({ type: "click" });
  const asked = { text: rmRow.textContent, sentBefore: rm.ws.length };
  btn(rm, "Cancel").dispatchEvent({ type: "click" });
  const cancelled = { back: !!btn(rm, "Remove all furniture…"), sent: rm.ws.length };
  btn(rm, "Remove all furniture…").dispatchEvent({ type: "click" });
  btn(rm, "Remove all").dispatchEvent({ type: "click" });
  await settle();
  check("furniture: Remove all asks in the page, then sends only pieces, once",
    rmRow && rm.more.contains(rmRow) && /Remove every piece of furniture\? A backup is taken first\./.test(asked.text)
    && asked.sentBefore === 0 && cancelled.back && cancelled.sent === 0
    && JSON.stringify(rm.ws) === JSON.stringify([["padspan_ha/house3d_clear", { only: "pieces" }]])
    && rm.sent.length === 0 && !!btn(rm, "Remove all furniture…")
    && rm.toasts.length === 1 && /restore the backup taken just now/.test(rm.toasts[0][0]) && !rm.toasts[0][1],
    { asked, cancelled, ws: rm.ws, toasts: rm.toasts });
  const notAdmin = settingsPage({ atlas_3d_enabled: true }, { admin: false });
  check("furniture: no Remove all for a user who is not an admin",
    !notAdmin.box._all().some(n => n.attributes && "data-la3d-rmfur" in n.attributes) && !/Remove all furniture/i.test(notAdmin.text),
    notAdmin.text);
  // A save that fails puts the switch back.
  const bad = settingsPage({ atlas_3d_enabled: false }, { refuse: true });
  bad.cb.checked = true;
  bad.cb.dispatchEvent({ type: "change" });
  await flush();
  await new Promise(r => globalThis._realSetTimeout(r, 10));
  check("box: a failed save puts the switch back", bad.cb.checked === false && bad.more.style.display === "none",
    { checked: bad.cb.checked, display: bad.more.style.display });
} catch (e) { failures.push({ name: "harness", detail: String(e && e.stack || e).slice(0, 800) }); }

console.log(JSON.stringify({ cases, failures }));
process.exit(failures.length ? 1 : 0);
