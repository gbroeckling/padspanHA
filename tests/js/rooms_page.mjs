// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Rooms page (views/rooms.js, 2026-10-30), run for real under the DOM
// shim from a model fixture: rooms grouped by Home Assistant floor, the values
// each row shows, and every inline edit sending the same command the screen
// that already had it sends (Settings → Appearance's model_update for the
// colour, Mapping → Rooms' room_height_set for height and split level).
//
// usage: rooms_page.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: ok}, failures: [...] }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
install(globalThis);

// panel.js's own el(), lifted by text.
const panelSrc = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const elSrc = panelSrc.slice(panelSrc.indexOf("function el(tag, attrs={}, children=[]){"));
const el = new Function(elSrc.slice(0, elSrc.indexOf("\n}\n") + 3) + "\nreturn el;")();

const R = await import(pathToFileURL(join(WWW, "views", "rooms.js")).href + "?t=1");

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const MODEL = () => ({
  floors: [
    { id: "ground", name: "Ground Floor", level: 0, floor_to_floor_m: 2.6 },
    { id: "upper", name: "Upstairs", level: 1 },
  ],
  areas: [
    { id: "kitchen", name: "Kitchen", floor_id: "ground" },
    { id: "living_room", name: "Living Room", floor_id: "ground" },
    { id: "office", name: "Office", floor_id: "upper" },
    { id: "hall", name: "Hall", floor_id: "main" },
  ],
  room_meta: {
    Kitchen: { floor_id: "ground", color: "#FF0000", height_m: 3.2 },
    "Living Room": { floor_id: "ground", color: "hsl(120 70% 55%)" },
    Office: { floor_id: "upper", color: "#123456", floor_raise_m: 0.4 },
  },
  room_geometry_m: {
    Kitchen: { floor_id: "ground", type: "poly", points_m: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    Garage: { floor_id: "ground", type: "circle", cx_m: 9, cy_m: 0, r_m: 1 },
  },
  scanners: { kitchen_hub: { room: "Kitchen", floor_id: "ground" } },
});
const SNAP = {
  ble: { radios: [
    { source: "kitchen_hub", name: "Kitchen Hub", area_name: "Kitchen" },
    { source: "office_hub", name: "Office Hub", area_name: "Office" },
  ] },
  objects: { list: [
    { key: "irk:a", kind: "private_ble", address: "AA:AA:AA:AA:AA:AA", user_label: "Alice", identified: true, room: "Kitchen", age_s: 2 },
    { key: "ble:B", kind: "ble", address: "BB:BB:BB:BB:BB:BB", identified: false, room: "Kitchen", age_s: 2 },
    { key: "ble:C", kind: "ble", address: "CC:CC:CC:CC:CC:CC", user_label: "Keys", identified: true, room: "Office", age_s: 9999 },
  ] },
};
const MAPS = [
  { id: "m_first", name: "First", floor_id: "elsewhere" },
  { id: "m_ground", name: "Ground", floor_id: "ground" },
  { id: "m_upper", name: "Upper", floor_id: "upper" },
];

function makeCtx({ mode = "advanced", model = MODEL(), snap = SNAP, maps = MAPS } = {}) {
  const calls = [], events = [], toasts = [], nav = [];
  const ctx = {
    hass: { user: { is_admin: true } },
    state: { complexity: mode, view: "rooms", settings: {}, model, live: { snapshot: snap }, maps: { list: maps }, _settingsDraft: { stale: true } },
    helpers: {
      el, esc: (s) => String(s ?? ""),
      roomColor: (n) => (model.room_meta && model.room_meta[n] && model.room_meta[n].color) || "hsl(200 70% 55%)",
      isAway: (o, t) => (o.age_s || 0) > t, awayTimeoutS: () => 300, isScanner: () => false,
    },
    actions: {
      modelUpdate: async (payload) => { calls.push({ type: "padspan_ha/model_update", ...payload }); },
      wsCall: async (type, data) => { calls.push({ type, ...data }); return { ok: true }; },
      modelRefresh: async () => { calls.push({ type: "refresh" }); },
      telemetryEvent: (n) => events.push(n),
      renderRooms: () => nav.push("render"), renderNav: () => nav.push("nav"),
      setMapsTab: (t) => { ctx.state.mapsTab = t; nav.push("maps/" + t); },
      setComplexity: (m) => { ctx.state.complexity = m; },
      followedHas: () => false,
    },
    toast: (m, err) => toasts.push({ m: String(m), err: !!err }),
  };
  return { ctx, calls, events, toasts, nav };
}

const all = (n, out = []) => { for (const c of n.children || []) { out.push(c); all(c, out); } return out; };
const roomNode = (root, name) => all(root).find(n => n.getAttribute && n.getAttribute("data-room") === name);
const q = (node, attr, val) => all(node).find(n => n.getAttribute && n.getAttribute(attr) === val);
const text = (n) => n.textContent;

// ── grouped by floor, in HA's order ───────────────────────────────────────
{
  const { ctx } = makeCtx();
  const groups = R.roomGroups(ctx);
  check("floors: grouped in Home Assistant's floor order, unassigned last",
    JSON.stringify(groups.map(g => g.floorId)) === JSON.stringify(["ground", "upper", "main"]), groups.map(g => g.floorId));
  check("floors: rooms by name within a floor, a PadSpan-only drawn room included",
    JSON.stringify(groups[0].rooms.map(r => r.name)) === JSON.stringify(["Garage", "Kitchen", "Living Room"]), groups[0].rooms.map(r => r.name));
  check("floors: names come from HA (floor name, and 'no floor' for an area without one)",
    groups[0].floorName === "Ground Floor" && groups[2].floorName === "No floor set in Home Assistant", groups.map(g => g.floorName));
  const k = groups[0].rooms.find(r => r.name === "Kitchen");
  check("values: Kitchen's size from its outline in metres", k.areaM2 === 12 && k.outline, k);
  check("values: stored colour, height, receivers (placed + HA area counted once), people now",
    k.color === "#ff0000" && k.heightM === 3.2 && k.floorHeightM === 2.6 && k.receivers === 1
    && JSON.stringify(k.people) === JSON.stringify(["Alice"]) && k.others === 1, k);
  const lr = groups[0].rooms.find(r => r.name === "Living Room");
  check("values: no outline in the layout is not drawn (a photo never counts); Edit opens its floor's plan; derived colour as hex",
    !lr.outline && lr.areaM2 === null && lr.mapId === "m_ground" && /^#[0-9a-f]{6}$/.test(lr.color) && lr.color === "#3cdd3c", lr);
  const off = groups[1].rooms[0];
  check("values: Office's split level, receiver from its HA area, someone away not in it now",
    off.raiseM === 0.4 && off.receivers === 1 && off.people.length === 0 && off.mapId === "m_upper" && off.floorHeightM === 2.8, off);
  const hall = groups[2].rooms[0];
  check("values: a room with no record and no outline can't take a height (room_height_set would refuse it)",
    hall.heightEditable === false && hall.outline === false && hall.mapId === "m_first", hall);
  const g = groups[0].rooms.find(r => r.name === "Garage");
  check("values: circle size, and a drawn room not in HA has no HA id", g.haId === null && Math.abs(g.areaM2 - 3.1) < 1e-9, g);
}

// ── what the page prints ─────────────────────────────────────────────────
{
  const { ctx } = makeCtx();
  const root = R.render(ctx);
  await flush();
  const t = text(root);
  check("render: no undefined / NaN / [object", !/undefined|NaN|\[object/.test(t), t.slice(0, 400));
  const k = roomNode(root, "Kitchen");
  check("render: Kitchen row shows its size, receivers and who's in it",
    /Drawn, 12 m²/.test(text(k)) && /1 receiverSee/.test(text(k)) && /Alice, and 1 other device/.test(text(k)), text(k));
  check("render: the height input holds the stored height, the floor's as placeholder",
    q(k, "data-edit", "height").value === "3.2" && /floor's, 2.6/.test(q(k, "data-edit", "height").getAttribute("placeholder")));
  check("render: the colour input holds the room colour", q(k, "data-edit", "color").value === "#ff0000");
  check("render: an HA room links to its HA area to rename; a PadSpan-only one says so",
    q(k, "href", "/config/areas/area/kitchen") && /PadSpan only/.test(text(roomNode(root, "Garage"))));
  const hall = roomNode(root, "Hall");
  check("render: Hall's height can't be saved yet", q(hall, "data-save", "height").disabled === true);
  check("render: rooms grouped in floor cards", all(root).filter(n => n.getAttribute && n.getAttribute("data-floor")).length === 3);
  check("render: Add a room goes to HA's Areas", !!q(root, "href", "/config/areas/dashboard"));
  check("render: Office's split level shows its value", q(roomNode(root, "Office"), "data-edit", "raise").value === "0.4");
}

// ── the edits, through the existing commands ──────────────────────────────
{
  const { ctx, calls, events } = makeCtx();
  const root = R.render(ctx);
  const col = q(roomNode(root, "Kitchen"), "data-edit", "color");
  col.value = "#00FF00";
  col.dispatchEvent({ type: "change" });
  await flush();
  const c = calls.find(x => x.type === "padspan_ha/model_update");
  check("edit: colour goes through model_update for that room only, keeping its floor",
    c && JSON.stringify(c.room_meta) === JSON.stringify({ Kitchen: { floor_id: "ground", color: "#00ff00" } }) && !("floors" in c), c);
  check("edit: counted once as rooms_page_edit, and Settings' stale draft dropped",
    JSON.stringify(events) === JSON.stringify(["rooms_page_edit"]) && ctx.state._settingsDraft === null, { events, d: ctx.state._settingsDraft });
}
{
  const { ctx, calls, events, toasts } = makeCtx();
  const root = R.render(ctx);
  const k = roomNode(root, "Kitchen");
  q(k, "data-edit", "height").value = "3.5";
  q(k, "data-save", "height").click();
  await flush();
  q(k, "data-edit", "height").value = "";
  q(k, "data-save", "height").click();
  await flush();
  q(k, "data-edit", "height").value = "50";
  q(k, "data-save", "height").click();
  await flush();
  const hs = calls.filter(x => x.type === "padspan_ha/room_height_set");
  check("edit: height through room_height_set {room, height_m}; blank clears; out of range refused",
    hs.length === 2 && hs[0].room === "Kitchen" && hs[0].height_m === 3.5 && !("floor_raise_m" in hs[0])
    && hs[1].height_m === null && toasts.some(x => x.err && /1.5 to 30/.test(x.m)), { hs, toasts });
  check("edit: each saved height counted, the model re-read", events.length === 2 && calls.filter(x => x.type === "refresh").length === 2, events);
}
{
  const { ctx, calls } = makeCtx();
  const root = R.render(ctx);
  const o = roomNode(root, "Office");
  q(o, "data-edit", "raise").value = "-0.5";
  q(o, "data-save", "raise").click();
  await flush();
  q(o, "data-edit", "raise").value = "0.01";
  q(o, "data-save", "raise").click();
  await flush();
  const rs = calls.filter(x => x.type === "padspan_ha/room_height_set");
  check("edit: split level through room_height_set {room, floor_raise_m}; under 5 cm is level (null)",
    rs.length === 2 && rs[0].room === "Office" && rs[0].floor_raise_m === -0.5 && !("height_m" in rs[0]) && rs[1].floor_raise_m === null, rs);
}

// ── the same commands as the existing screens ─────────────────────────────
{
  const maps = readFileSync(join(WWW, "views", "maps.js"), "utf-8");
  const settings = readFileSync(join(WWW, "views", "settings.js"), "utf-8");
  check("same: Mapping → Rooms sets height and split level with room_height_set",
    maps.includes('wsCall("padspan_ha/room_height_set", { room: only, height_m: v })')
    && maps.includes('wsCall("padspan_ha/room_height_set", { room: only, floor_raise_m: off ? v : null })'));
  check("same: Settings → Appearance saves colours with modelUpdate room_meta",
    settings.includes("await ctx.actions.modelUpdate({floors: draft.floors || [], room_meta: draft.room_meta || {}});"));
}

// ── links out ────────────────────────────────────────────────────────────
for (const mode of ["advanced", "basic"]) {
  const { ctx, nav, toasts } = makeCtx({ mode });
  ctx.state.maps._draftMapId = "m_other";
  const root = R.render(ctx);
  q(roomNode(root, "Living Room"), "data-link", "outline").click();
  const ms = ctx.state.maps;
  check(`link: ${mode}: Edit outline opens Mapping → Edit on the room's plan with the Rooms tool and the room`,
    ctx.state.view === "maps" && ctx.state.mapsTab === "edit" && ctx.state.activeMapId === "m_ground"
    && ms._openMode === "rooms" && ms._openRoom === "Living Room" && ctx.state.complexity === "advanced"
    && (mode === "basic" ? toasts.some(t => /switched to Advanced/.test(t.m)) : toasts.length === 0), { ms, nav, c: ctx.state.complexity });
}
{
  const { ctx } = makeCtx();
  const root = R.render(ctx);
  q(roomNode(root, "Kitchen"), "data-link", "receivers").click();
  check("link: receivers go to Bluetooth → Receivers when there is no Receivers page", ctx.state.view === "bluetooth" && ctx.state.btTab === "scanners");
  // The Receivers page through panel.js's openReceivers, loaded or not yet.
  ctx.actions.openReceivers = () => { ctx.state.view = "receivers"; };
  q(roomNode(root, "Kitchen"), "data-link", "receivers").click();
  check("link: and to the Receivers page once it exists", ctx.state.view === "receivers");
}
{
  const { ctx } = makeCtx({ maps: [] });
  const root = R.render(ctx);
  q(roomNode(root, "Kitchen"), "data-link", "mapping").click();
  check("link: with no floor plan the outline links to Mapping's Library", ctx.state.view === "maps" && ctx.state.mapsTab === "library");
}
// ── Sample mode: the demo house elsewhere, so nothing saved or counted here
{
  const { ctx, calls, events } = makeCtx();
  Object.assign(ctx.state, { dataMode: "sample", _dataModeKnown: true });
  const root = R.render(ctx);
  const k = roomNode(root, "Kitchen");
  const col = q(k, "data-edit", "color");
  col.value = "#00ff00";
  col.dispatchEvent && col.dispatchEvent(new Event("change"));
  check("sample: says so, and every edit is switched off",
    !!q(root, "data-rooms-note", "sample") && col.disabled && q(k, "data-edit", "height").disabled
    && q(k, "data-save", "height").disabled && q(k, "data-edit", "raise").disabled, text(root).slice(0, 300));
  check("sample: the demo house's people are not put in your rooms", !/Alice/.test(text(k)), text(k));
  await flush();
  check("sample: nothing sent, nothing counted", !calls.length && !events.length, { calls, events });
  const live = makeCtx();
  Object.assign(live.ctx.state, { dataMode: "live", _dataModeKnown: true });
  const lr = R.render(live.ctx);
  check("live: no note, edits on", !q(lr, "data-rooms-note", "sample") && !q(roomNode(lr, "Kitchen"), "data-edit", "color").disabled);
}
{
  const { ctx } = makeCtx({ model: { floors: [], areas: [] }, snap: null, maps: [] });
  const root = R.render(ctx);
  check("empty: no rooms says where to add them", /No rooms yet/.test(text(root)) && !/undefined|NaN/.test(text(root)));
}
{
  // Mapping applies the one-shot room when the plan loads into Edit.
  const maps = readFileSync(join(WWW, "views", "maps.js"), "utf-8").replace(/\r\n/g, "\n");
  check("link: Mapping → Edit takes the room it was opened on, on a plan it loads",
    maps.includes('ctx.state.maps._selectedRoom = ctx.state.maps._openRoom || "";\n    ctx.state.maps._openRoom = null;'));
  check("link: and on a plan already open, keeping its drafts",
    maps.includes('} else if (ctx.state.maps._openRoom) {\n    // Already open on this plan: the Rooms tool and the room, drafts kept.\n'
      + '    ctx.state.maps._mode = ctx.state.maps._openMode || "rooms";\n    ctx.state.maps._selectedRoom = ctx.state.maps._openRoom;'));
  check("link: Mapping opens the plan the room is traced on; the hint is dropped off the Edit tab",
    maps.includes("const tracedOn = maps.find(m => m.room_bounds && m.room_bounds[_openRoom]);\n    if (tracedOn) ctx.state.activeMapId = tracedOn.id;")
    && maps.includes('if (activeTab !== "edit" && ctx.state.maps) ctx.state.maps._openRoom = null;'));
}

console.log(JSON.stringify({ cases, failures }));
