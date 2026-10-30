// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Basic's focused views (views/focus.js, 2026-10-30), RUN rather than read.
// Garry: "Make sure basic still makes sense, no access to things that are so
// foreign to the user that it doesn't tie together". In Basic a link opens
// just the part it is about, under one "← Back" to where it was, and nothing
// on it leads into the rest of the expert screen; the mode never changes.
// Advanced and Development open the whole tab, as before.
//
//   settings   Appearance's "Usage report →" / "Guest tags →", Guests' Open
//              Settings, the tester sign-up, the Live Aboard wizard's setting
//              links: one card each
//   edit       Rooms' Edit outline: the editor with the Rooms tool only, on
//              that room; Receivers' Place / Move: the Radios tool only, with
//              that receiver and its height row
//   heights    the floor-heights links (Overview tip, Calibration Results,
//              Setup → Floors): 3D Stack's Floor Heights card alone
//   expert     links to expert screens are not shown in Basic
//   advanced   Advanced: the same links open the whole tab, no focus
//   back       "← Back" returns exactly where the link was, nested too
// The pytest wrapper is tests/test_basic_focus.py.
//
// Run:  node tests/js/basic_focus.mjs <repo-root>
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const ROOT = process.argv[2];
const { install, flush } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const V = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const imp = (n) => import(pathToFileURL(V + n).href);
const FOCUS = await imp("focus.js");
const SET = await imp("settings.js"), MAPS = await imp("maps.js"), GUESTS = await imp("guests.js");
const MAN = await imp("manage.js"), WIZ = await imp("aboard_wizard.js"), SETUP = await imp("setup.js");

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const attrs = (root, a) => all(root).filter(n => n.getAttribute && n.getAttribute(a) !== null).map(n => n.getAttribute(a));
const attr = (root, a, v) => all(root).find(n => n.getAttribute && n.getAttribute(a) !== null && (v === undefined || n.getAttribute(a) === v)) || null;
const button = (root, label) => all(root).find(n => (n.tagName || "").toUpperCase() === "BUTTON" && text(n).includes(label)) || null;
const tabsOf = (root) => all(root).filter(n => n.classList && n.classList.contains("tab")).map(text);
const click = (n) => n && n.dispatchEvent(new Event("click"));

function makeCtx(state, calls = []) {
  const s = Object.assign({
    dataMode: "live", _dataModeKnown: true, complexity: "basic", view: "settings", version: "0", buildId: "b",
    settings: { tier: "pro", edition: "full", atlas_3d_enabled: true }, followedAddrs: new Set(), timing: {}, roomTagMap: {}, wsCounts: {},
    model: { floors: [{ id: "main", name: "Main", level: 0 }], areas: [{ name: "Kitchen" }, { name: "Hall" }], room_meta: {}, room_geometry_m: {}, map_transforms: {},
             scanner_positions_m: { "AA:BB": { x_m: 1, y_m: 1, z_m: 2.4 } } },
    maps: { list: [{ id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 600, filename: "m1.png" },
      receivers: [{ id: "rx_k", label: "Kitchen proxy", x: 0.4, y: 0.4, room: "Kitchen", source: "AA:BB" }],
      room_bounds: { Kitchen: { type: "poly", points: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]] } } }] },
    live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [] } },
  }, state);
  const actions = {
    renderRooms: () => calls.push(["renderRooms"]), renderNav: () => calls.push(["renderNav"]),
    // As panel.js's: another screen forgets a focus.
    // As panel.js's: another screen forgets a focus unless focus.js keeps it,
    // and the screen may be drawn at once (calls.drawNow).
    showView: (id, o) => { calls.push(["showView", id]); if (!(o && o.keepFocus)) s._focus = null; s.view = id; if (calls.drawNow) calls.drawNow(id); },
    setMapsTab: (t) => { calls.push(["setMapsTab", t]); s.mapsTab = t; },
    mapsSetActive: (id) => { s.activeMapId = id; },
    setComplexity: (m) => { calls.push(["setComplexity", m]); s.complexity = m; },
    settingsSet: async (p) => { calls.push(["settingsSet", p]); Object.assign(s.settings, p); return { settings: s.settings }; },
    callWS: async (p) => (p && p.type === "padspan_ha/house3d_get" ? { data: { pieces: {}, lights: {}, openings: {}, devices: {} } } : {}),
    wsCall: async () => ({}), openModal: (t, body) => { calls.modal = body; }, closeModal: () => {},
    telemetryEvent: () => {}, objectLabelList: async () => ({}), canOpen: () => true, calibrationGet: async () => ({}),
    openReceivers: () => { calls.push(["openReceivers"]); s.view = "receivers"; }, openRooms: () => { calls.push(["openRooms"]); s.view = "rooms"; },
  };
  const helpers = new Proxy({ el, esc: (x) => String(x ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: () => "",
    isScanner: () => false, roomColor: () => "#fff", pill: (t) => el("span", {}, String(t ?? "")), HELP: {}, mapImageUrl: () => "/x.png" },
    { get: (t, k) => (k in t ? t[k] : quiet()) });
  return new Proxy({ hass: { states: {}, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state: s, helpers, actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: (m) => calls.push(["toast", String(m)]) }, { get: (t, k) => (k in t ? t[k] : quiet()) });
}
const noSwitch = (calls) => !calls.some(c => c[0] === "setComplexity");
// The focused screen: the bar, then exactly one part.
const focusedOnly = (root, part) => {
  const kids = [...(root.children || [])];
  return kids.length === 2 && kids[0].getAttribute("data-focus-bar") !== null
    && (kids[1].getAttribute("data-focus-part") === part || !!attr(kids[1], "data-focus-part", part));
};

// ── settings: Basic's Appearance links, one card each ───────────────────────
for (const [btn, part, mustNot] of [
  ["usage_report", "usage_report", ["Guest tags", "Update Check", "Enhanced security", "Quiet Mode", "Bluetooth refresh interval", "Tracking Settings"]],
  ["guest_tags", "guest_tags", ["Help improve PadSpan", "Update Check", "Quiet Mode", "Positioning", "Tracking Settings"]],
]) {
  const calls = [];
  const ctx = makeCtx({ view: "settings" }, calls);
  const app = SET.render(ctx);
  check(`settings: Basic Appearance has its ${btn} link and no Open Tracking`, !!attr(app, "data-settings-open", btn) && !button(app, "Open Tracking"), text(app).slice(-200));
  click(attr(app, "data-settings-open", btn));
  const f = ctx.state._focus || {};
  check(`settings: ${btn} opens only that card (Settings → ${f.tab}), back to Settings`,
    f.view === "settings" && f.part === part && f.back && f.back.view === "settings" && ctx.state.view === "settings", f);
  const root = SET.render(ctx);
  const body = text(root);
  check(`settings: ${btn} draws the bar and the one card; no tabs, sections or other cards`,
    focusedOnly(root, part) && tabsOf(root).length === 0 && attrs(root, "data-presence-section").length === 0
    && mustNot.every(w => !body.includes(w)), { kids: (root.children || []).length, found: mustNot.filter(w => body.includes(w)), body: body.slice(0, 300) });
  click(attr(root, "data-focus-back"));
  const again = SET.render(ctx);
  check(`settings: ${btn} ← Back returns to Appearance, still Basic`,
    !ctx.state._focus && ctx.state.view === "settings" && !!attr(again, "data-settings-open", btn) && ctx.state.complexity === "basic" && noSwitch(calls),
    [ctx.state._focus, ctx.state.view]);
}

// ── settings: Guests' "Open Settings" (guest tags off) ──────────────────────
{
  const calls = [];
  const ctx = makeCtx({ view: "guests", _guests: { data: { enabled: false }, ts: Date.now() } }, calls);
  const g = GUESTS.render(ctx);
  click(button(g, "Open Settings"));
  const f = ctx.state._focus || {};
  check("settings: Guests' Open Settings opens only the Guest tags card, back to Guests",
    ctx.state.view === "settings" && f.part === "guest_tags" && f.back && f.back.view === "guests" && noSwitch(calls), f);
  const root = SET.render(ctx);
  check("settings: Guests' link draws the Guest tags card alone", focusedOnly(root, "guest_tags") && !/Help improve PadSpan/.test(text(root)), text(root).slice(0, 200));
  click(attr(root, "data-focus-back", "guests"));
  check("settings: Guests' ← Back returns to Guests", ctx.state.view === "guests" && !ctx.state._focus, ctx.state.view);
}

// ── settings: the tester sign-up (panel.js _openTesterSignup, lifted) ───────
{
  const src = readFileSync(ROOT + "/custom_components/padspan_ha/www/padspan-ha/panel.js", "utf-8").replace(/\r\n/g, "\n");
  const body = src.slice(src.indexOf("  _openTesterSignup(){"), src.indexOf("\n  }\n", src.indexOf("  _openTesterSignup(){")))
    .replace("  _openTesterSignup(){", "");
  const calls = [];
  const ctx = makeCtx({ view: "overview" }, calls);
  const p = { state: ctx.state, _ctx: () => ctx, _renderNav: () => {}, _scheduleRender: () => {} };
  new Function("_focusPromise", "VIEWS", "_VIEW_PATHS", "_loadView", body).call(p, Promise.resolve(FOCUS), {}, {}, async () => {});
  await flush(); await flush();
  const f = ctx.state._focus || {};
  check("settings: the tester card's Sign me up opens only the usage report's card, back to Overview",
    ctx.state.view === "settings" && f.part === "usage_report" && f.back && f.back.view === "overview" && ctx.state._testerFocus === true && noSwitch(calls), f);
  check("settings: the tester sign-up draws that card alone", focusedOnly(SET.render(ctx), "usage_report"), null);
  // Advanced: the whole Tracking tab.
  const a = makeCtx({ view: "overview", complexity: "advanced" });
  const pa = { state: a.state, _ctx: () => a, _renderNav: () => {}, _scheduleRender: () => {} };
  new Function("_focusPromise", "VIEWS", "_VIEW_PATHS", "_loadView", body).call(pa, Promise.resolve(FOCUS), {}, {}, async () => {});
  await flush(); await flush();
  check("advanced: the tester sign-up opens Settings → Tracking, no focus", a.state.view === "settings" && a.state._settingsTab === "presence" && !a.state._focus,
    [a.state.view, a.state._settingsTab, a.state._focus]);
}

// ── settings: the Live Aboard wizard's setting links (Basic) ────────────────
{
  const settings = { tier: "pro", edition: "full", atlas_3d_enabled: true, atlas_3d_quality: "high", overview_atlas: true };
  for (const [step, label, part] of [["extras", "Quality", "la3d"], ["screen", "Show the Atlas as Overview", "atlas_overview"]]) {
    const calls = [];
    const ctx = makeCtx({ view: "maps", settings: Object.assign({}, settings) }, calls);
    ctx.state._laWizard = null;
    await WIZ.openLiveAboardWizard(ctx, step);
    const row = attr(calls.modal, "data-wiz-setting", label);
    check(`settings: the wizard has a ${label} link (${step})`, !!row, calls.modal && text(calls.modal).slice(0, 200));
    if (!row) continue;
    click(button(row, "Open Settings"));
    const f = ctx.state._focus || {};
    const root = SET.render(ctx);
    check(`settings: the wizard's ${label} link opens only its card (${part}), still Basic`,
      ctx.state.view === "settings" && f.part === part && focusedOnly(root, part) && tabsOf(root).length === 0 && noSwitch(calls),
      [f, text(root).slice(0, 160)]);
    if (part === "la3d") {
      check("expert: in Basic the Live Aboard card has no Open Live Aboard (the builder)", !attr(root, "data-goto", "live-aboard-views"), null);
      const adv = SET.render(makeCtx({ view: "settings", complexity: "advanced", _settingsTab: "atlas", settings: Object.assign({}, settings) }));
      check("advanced: Settings → Atlas still has Open Live Aboard", !!attr(adv, "data-goto", "live-aboard-views"), null);
    }
  }
}

// ── edit: Rooms' Edit outline, as rooms.js leaves the state ─────────────────
async function editFocus(partKey, extra, setup) {
  const calls = [];
  const ctx = makeCtx({ view: extra.from, activeMapId: "m1" }, calls);
  setup(ctx.state);
  FOCUS.openFocus(ctx, FOCUS.part(partKey, extra.part));
  const root = MAPS.render(ctx); await flush();
  return { ctx, calls, root };
}
{
  const { ctx, calls, root } = await editFocus("roomOutline", { from: "rooms", part: { item: "Kitchen", title: "Outline: Kitchen" } },
    (st) => { st.maps._openMode = "rooms"; st.maps._openRoom = "Kitchen"; });
  const body = text(root);
  check("edit: Edit outline in Basic is the editor with the Rooms tool only",
    JSON.stringify(attrs(root, "data-edit-tool")) === '["rooms"]' && ctx.state.maps._mode === "rooms" && ctx.state.maps._selectedRoom === "Kitchen",
    [attrs(root, "data-edit-tool"), ctx.state.maps._mode, ctx.state.maps._selectedRoom]);
  check("edit: no Mapping tabs, map or floor switch, Trim, Rotate, Signal walls, Enclose, Suggest Placement or All rooms",
    tabsOf(root).length === 0 && !/Map:|Floor:|Trim Image|Rotate Image|Signal walls|Enclose|Suggest Placement/.test(body)
    && !attr(root, "data-all-rooms") && focusedOnly(root, "rooms"), body.slice(0, 400));
  check("edit: the bar says which room and goes back to Rooms", /Outline: Kitchen/.test(text(attr(root, "data-focus-bar"))) && !!attr(root, "data-focus-back", "rooms"), null);
  click(attr(root, "data-focus-back", "rooms"));
  check("edit: ← Back returns to the Rooms page, still Basic", ctx.state.view === "rooms" && !ctx.state._focus && ctx.state.complexity === "basic" && noSwitch(calls), ctx.state.view);
  // A menu pick to Mapping afterwards: Library, as Basic's Mapping always was.
  ctx.state.view = "maps";
  const lib = MAPS.render(ctx); await flush();
  check("edit: Mapping from the menu afterwards is Basic's Library again", ctx.state.mapsTab === "library" && JSON.stringify(tabsOf(lib)) === '["Library","Upload"]', [ctx.state.mapsTab, tabsOf(lib)]);
}

{
  // panel.js's showView can draw the screen at once: the focus must already be
  // there, or Basic's Mapping goes back to Library and drops the room (found
  // on the panel harness, 2026-10-30).
  const calls = [];
  const ctx = makeCtx({ view: "rooms", activeMapId: "m1" }, calls);
  calls.drawNow = (id) => { if (id === "maps") MAPS.render(ctx); };
  ctx.state.maps._openMode = "rooms"; ctx.state.maps._openRoom = "Kitchen";
  FOCUS.openFocus(ctx, FOCUS.part("roomOutline", { item: "Kitchen" }));
  MAPS.render(ctx); await flush();
  check("edit: a screen drawn at once by showView keeps the room and the Edit tab",
    ctx.state.mapsTab === "edit" && ctx.state.maps._selectedRoom === "Kitchen" && ctx.state._focus && ctx.state._focus.part === "rooms",
    [ctx.state.mapsTab, ctx.state.maps._selectedRoom, ctx.state._focus]);
}

// ── edit: Receivers' Place / Move ───────────────────────────────────────────
{
  const { ctx, calls, root } = await editFocus("receiverPlace", { from: "receivers", part: { item: "rx_k", title: "Move: Kitchen proxy" } },
    (st) => { st.maps._openRadios = { rxId: "rx_k" }; });
  const body = text(root);
  check("edit: Place / Move in Basic is the editor with the Radios tool only, on that receiver",
    JSON.stringify(attrs(root, "data-edit-tool")) === '["receivers"]' && ctx.state.maps._mode === "receivers" && ctx.state.maps._selectedRxId === "rx_k",
    [attrs(root, "data-edit-tool"), ctx.state.maps._mode, ctx.state.maps._selectedRxId]);
  check("edit: its height row is there", attrs(root, "data-rx-height").includes("AA:BB") && /Height above floor/.test(body), attrs(root, "data-rx-height"));
  check("edit: no tabs, Trim, Rotate, Suggest Placement or All receivers",
    tabsOf(root).length === 0 && !/Trim Image|Rotate Image|Suggest Placement|Signal walls/.test(body) && !attr(root, "data-all-receivers"), body.slice(0, 400));
  click(attr(root, "data-focus-back", "receivers"));
  check("edit: ← Back returns to Receivers, still Basic", ctx.state.view === "receivers" && !ctx.state._focus && noSwitch(calls), ctx.state.view);
}

// ── heights: the Floor Heights card alone ───────────────────────────────────
for (const from of ["overview", "calibration"]) {
  const calls = [];
  const ctx = makeCtx({ view: from }, calls);
  FOCUS.openFocus(ctx, FOCUS.part("floorHeights"));
  const root = MAPS.render(ctx); await flush();
  check(`heights: from ${from}, only 3D Stack's Floor Heights card`,
    ctx.state.view === "maps" && ctx.state.mapsTab === "stack" && focusedOnly(root, "floor_heights") && !!button(root, "Save Floor Heights")
    && tabsOf(root).length === 0 && !/Tie-in|Align|Stack view/.test(text(root)), text(root).slice(0, 300));
  click(attr(root, "data-focus-back", from));
  check(`heights: from ${from}, ← Back returns there`, ctx.state.view === from && !ctx.state._focus && noSwitch(calls), ctx.state.view);
}
{
  // Setup → Floors: Setup's own bar is the way back (panel.js draws it), so this bar has no second one.
  const calls = [];
  const ctx = makeCtx({ view: "setup", dataMode: "sample" }, calls);
  SETUP.openStep(ctx, "floors");
  const f = ctx.state._focus || {};
  const root = MAPS.render(ctx); await flush();
  check("heights: Setup → Floors opens only the Floor Heights card, Setup's bar the one way back",
    ctx.state.view === "maps" && f.part === "floor_heights" && f.back.view === "setup" && ctx.state._setupReturn === "floors"
    && focusedOnly(root, "floor_heights") && !attr(root, "data-focus-back") && noSwitch(calls), [f, ctx.state._setupReturn]);
  const bar = SETUP.returnBar(ctx);
  click(attr(bar, "data-setup", "back"));
  check("heights: Setup's ← Back to Setup leaves the focus", ctx.state.view === "setup" && !ctx.state._focus, [ctx.state.view, ctx.state._focus]);
}

// ── expert: links to expert screens are not shown in Basic ──────────────────
{
  const b = MAN.render(makeCtx({ view: "manage", manageTab: "ha_entities" }));
  const a = MAN.render(makeCtx({ view: "manage", complexity: "advanced", manageTab: "ha_entities" }));
  check("expert: Manage's BLE refresh has no Open Settings in Basic (it has in Advanced)",
    !attr(b, "data-goto", "settings-receivers") && !!attr(a, "data-goto", "settings-receivers") && /Bluetooth refresh interval/.test(text(b)), null);
  check("expert: expertLinks is off in Basic only", FOCUS.expertLinks({ complexity: "basic" }) === false
    && FOCUS.expertLinks({ complexity: "advanced" }) === true && FOCUS.expertLinks({ complexity: "development" }) === true, null);
}

// ── advanced: the same links open the whole tab ─────────────────────────────
{
  const calls = [];
  const ctx = makeCtx({ view: "rooms", complexity: "advanced", activeMapId: "m1" }, calls);
  ctx.state.maps._openMode = "rooms"; ctx.state.maps._openRoom = "Kitchen";
  FOCUS.openFocus(ctx, FOCUS.part("roomOutline", { item: "Kitchen" }));
  const root = MAPS.render(ctx); await flush();
  const tools = attrs(root, "data-edit-tool");
  check("advanced: Edit outline opens the whole Edit tab, every tool, the tab bar, no focus bar",
    !ctx.state._focus && ctx.state.mapsTab === "edit" && ["receivers", "rooms", "barriers", "measure"].every(t => tools.includes(t))
    && tabsOf(root).includes("3D Stack") && !attr(root, "data-focus-bar") && /Trim Image/.test(text(root)), [tools, tabsOf(root)]);
  const s = makeCtx({ view: "settings", complexity: "advanced", _settingsTab: "presence",
    _focus: { view: "settings", tab: "presence", part: "guest_tags", back: { view: "settings" } } });
  const sr = SET.render(s);
  check("advanced: a focus left over does nothing in Advanced (the whole tab and its bar)",
    tabsOf(sr).includes("Tracking") && attrs(sr, "data-presence-section").length > 1 && !attr(sr, "data-focus-bar"), tabsOf(sr));
  const h = makeCtx({ view: "overview", complexity: "development" });
  FOCUS.openFocus(h, FOCUS.part("floorHeights"));
  const hr = MAPS.render(h); await flush();
  check("advanced: floor heights in Development opens the whole 3D Stack tab", !h.state._focus && h.state.mapsTab === "stack" && tabsOf(hr).includes("3D Stack") && !attr(hr, "data-focus-bar"), tabsOf(hr));
}

// ── back: nested, and the mode ──────────────────────────────────────────────
{
  const calls = [];
  const ctx = makeCtx({ view: "rooms", activeMapId: "m1" }, calls);
  FOCUS.openFocus(ctx, FOCUS.part("roomOutline", { item: "Kitchen", title: "Outline: Kitchen" }));
  const first = ctx.state._focus;
  FOCUS.openFocus(ctx, FOCUS.part("floorHeights"));
  check("back: a link inside a focused part remembers it", ctx.state._focus.back.focus === first && ctx.state._focus.back.view === "maps", ctx.state._focus.back);
  const bar = FOCUS.focusBar(ctx, ctx.state._focus);
  check("back: and says where it goes", /Back to Outline: Kitchen/.test(text(bar)), text(bar));
  FOCUS.focusBack(ctx);
  check("back: ← Back returns to that focused part", ctx.state._focus === first && ctx.state.view === "maps", ctx.state._focus);
  FOCUS.focusBack(ctx);
  check("back: and then to where it started", !ctx.state._focus && ctx.state.view === "rooms" && noSwitch(calls), ctx.state.view);
  check("back: a focus belongs to Basic only", FOCUS.focusFor({ complexity: "advanced", _focus: first }, "maps") === null
    && FOCUS.focusFor({ complexity: "basic", _focus: first }, "settings") === null && FOCUS.focusFor({ complexity: "basic", _focus: first }, "maps") === first, null);
}

console.log(JSON.stringify(results));
