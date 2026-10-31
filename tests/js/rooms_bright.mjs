// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Rooms page in PadSpan Bright (2026-10-30, Garry: "Bright should get a
// rooms page, but only items on it that apply to Bright functionality"), run
// for real under the DOM shim: views/rooms.js with settings.edition "bright",
// the real editions.js and the real lights_map.js, and panel.js's own menu
// methods lifted onto a stand-in panel with the real editions module.
//
// usage: rooms_bright.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: ok}, failures: [...] }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const WWW = process.argv[2];
install(globalThis);

const panelSrc = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const cut = (from, to) => {
  const a = panelSrc.indexOf(from);
  if (a < 0) throw new Error("not found: " + from);
  const b = panelSrc.indexOf(to, a + from.length);
  if (b < 0) throw new Error("not found after " + from + ": " + to);
  return panelSrc.slice(a, b);
};
const elSrc = cut("function el(tag, attrs={}, children=[]){", "\n}\n") + "\n}\n";
const el = new Function(elSrc + "\nreturn el;")();

const q = (u) => pathToFileURL(join(WWW, "views", u)).href + "?t=1";
const R = await import(q("rooms.js"));
const ED = await import(q("editions.js"));
// Warm the module cache: rooms.js loads lights_map.js on first use in Bright.
await import(q("lights_map.js"));

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const MODEL = () => ({
  floors: [{ id: "ground", name: "Ground Floor", level: 0, floor_to_floor_m: 2.6 }, { id: "upper", name: "Upstairs", level: 1 }],
  areas: [
    { id: "kitchen", name: "Kitchen", floor_id: "ground" },
    { id: "living_room", name: "Living Room", floor_id: "ground" },
    { id: "office", name: "Office", floor_id: "upper" },
  ],
  room_meta: {
    Kitchen: { floor_id: "ground", color: "#ff0000", height_m: 3.2 },
    Office: { floor_id: "upper", color: "#123456", floor_raise_m: 0.4 },
  },
  room_geometry_m: { Kitchen: { floor_id: "ground", type: "poly", points_m: [[0, 0], [4, 0], [4, 3], [0, 3]] } },
  scanners: { kitchen_hub: { room: "Kitchen", floor_id: "ground" } },
});
const SNAP = {
  ble: { radios: [{ source: "kitchen_hub", name: "Kitchen Hub", area_name: "Kitchen" }] },
  objects: { list: [{ key: "irk:a", kind: "private_ble", address: "AA:AA:AA:AA:AA:AA", user_label: "Alice", identified: true, room: "Kitchen", age_s: 2 }] },
};
const STATES = {
  "light.kitchen_a": { entity_id: "light.kitchen_a", state: "on", attributes: { friendly_name: "Kitchen A" } },
  "light.kitchen_b": { entity_id: "light.kitchen_b", state: "off", attributes: { friendly_name: "Kitchen B" } },
  "light.kitchen_hidden": { entity_id: "light.kitchen_hidden", state: "on", attributes: { friendly_name: "Kitchen hidden" } },
  "light.office": { entity_id: "light.office", state: "on", attributes: { friendly_name: "Office" } },
};
const REG = [
  { entity_id: "light.kitchen_a", area_id: "kitchen", platform: "hue" },
  { entity_id: "light.kitchen_b", area_id: "kitchen", platform: "hue" },
  { entity_id: "light.kitchen_hidden", area_id: "kitchen", platform: "hue" },
  { entity_id: "light.office", area_id: "office", platform: "hue" },
];

function makeCtx(settings) {
  const calls = [], ws = [], toasts = [];
  let renders = 0;
  const model = MODEL();
  const ctx = {
    hass: {
      user: { is_admin: true }, states: STATES,
      callWS: async (m) => { ws.push(m.type); return m.type === "config/entity_registry/list" ? REG : []; },
      callService: async () => {},
    },
    state: { complexity: "advanced", view: "rooms", settings: { lights_hidden: ["light.kitchen_hidden"], ...settings }, model, _modelLoaded: true,
      live: { snapshot: SNAP }, maps: { list: [{ id: "m_ground", name: "Ground", floor_id: "ground" }] } },
    helpers: { el, helpBtn: () => el("button", {}, "?"), esc: (s) => String(s ?? ""), roomColor: () => "hsl(200 70% 55%)", isAway: () => false, awayTimeoutS: () => 300, isScanner: () => false },
    actions: {
      modelUpdate: async (p) => { calls.push({ type: "padspan_ha/model_update", ...p }); },
      wsCall: async (type, data) => { calls.push({ type, ...data }); return { ok: true }; },
      modelRefresh: async () => {}, telemetryEvent: () => {},
      renderRooms: () => { renders++; }, renderNav: () => {},
      setMapsTab: (t) => { ctx.state.mapsTab = t; }, setComplexity: (m) => { ctx.state.complexity = m; },
      followedHas: () => false,
    },
    toast: (m, err) => toasts.push({ m: String(m), err: !!err }),
  };
  return { ctx, calls, ws, toasts, renders: () => renders };
}

const all = (n, out = []) => { for (const c of n.children || []) { out.push(c); all(c, out); } return out; };
const roomNode = (root, name) => all(root).find(n => n.getAttribute && n.getAttribute("data-room") === name);
const qa = (node, attr, val) => all(node).find(n => n.getAttribute && n.getAttribute(attr) === val);
const text = (n) => n.textContent;
const PRESENCE_WORDS = /Receiver|receiver|In it now|Nobody|Alice|unnamed device|Bluetooth|calibrat/;

// ── Bright: only the lighting fields ─────────────────────────────────────
const BRIGHT = { edition: "bright", tier: "bright" };
{
  const { ctx, renders } = makeCtx(BRIGHT);
  let root = R.render(ctx);
  check("bright: lights say Loading until the Atlas's list is in", /Loading…/.test(text(qa(roomNode(root, "Kitchen"), "data-lights", "1"))), text(root).slice(0, 300));
  // Real time, not flush(): flush() would fire the registry fetch's 30 s
  // timeout at once (it runs every queued timer).
  for (let i = 0; i < 6; i++) { await new Promise(r => globalThis._realSetTimeout(r, 5)); root = R.render(ctx); }
  const t = text(root);
  check("bright: no receivers, people or Bluetooth anywhere on the page", !PRESENCE_WORDS.test(t), t.match(PRESENCE_WORDS));
  check("bright: no See receivers link and no In it now field",
    !qa(root, "data-link", "receivers") && !qa(root, "data-now", "1"));
  check("bright: no undefined / NaN / [object", !/undefined|NaN|\[object/.test(t), t.slice(0, 400));
  const k = roomNode(root, "Kitchen");
  check("bright: Kitchen keeps colour, outline, ceiling height and split level",
    qa(k, "data-edit", "color").value === "#ff0000" && /Drawn, 12 m²/.test(text(k)) && qa(k, "data-link", "outline")
    && qa(k, "data-edit", "height").value === "3.2" && qa(k, "data-edit", "raise") && qa(k, "href", "/config/areas/area/kitchen"), text(k));
  check("bright: Kitchen's lights as the Atlas counts them (a hidden light left out)",
    text(qa(k, "data-lights", "1")) === "2 lights, 1 on", text(qa(k, "data-lights", "1")));
  check("bright: Office one light on; Living Room none",
    text(qa(roomNode(root, "Office"), "data-lights", "1")) === "1 light, 1 on"
    && text(qa(roomNode(root, "Living Room"), "data-lights", "1")) === "None");
  check("bright: the registry load re-renders the page", renders() >= 1, renders());
  check("bright: Add a room still goes to HA's Areas", !!qa(root, "href", "/config/areas/dashboard"));
}

// ── The edits send the same commands in both editions ────────────────────
async function editsOf(settings) {
  const { ctx, calls } = makeCtx(settings);
  const root = R.render(ctx);
  const k = roomNode(root, "Kitchen");
  const col = qa(k, "data-edit", "color"); col.value = "#00ff00"; col.dispatchEvent({ type: "change" }); await flush();
  qa(k, "data-edit", "height").value = "3.5"; qa(k, "data-save", "height").click(); await flush();
  const o = roomNode(root, "Office");
  qa(o, "data-edit", "raise").value = "-0.5"; qa(o, "data-save", "raise").click(); await flush();
  return calls;
}
{
  const b = await editsOf(BRIGHT), f = await editsOf({});
  check("same: Bright's colour, height and split level edits are the full edition's commands",
    b.length === 3 && JSON.stringify(b) === JSON.stringify(f)
    && b[0].type === "padspan_ha/model_update" && b[1].type === "padspan_ha/room_height_set" && b[1].height_m === 3.5
    && b[2].type === "padspan_ha/room_height_set" && b[2].floor_raise_m === -0.5, { b, f });
}
{
  const { ctx } = makeCtx(BRIGHT);
  const root = R.render(ctx);
  qa(roomNode(root, "Kitchen"), "data-link", "outline").click();
  check("same: Edit outline opens Mapping → Edit on the room (Bright's Mapping has it)",
    ctx.state.view === "maps" && ctx.state.mapsTab === "edit" && ctx.state.maps._openRoom === "Kitchen");
}

// ── The full edition and Bright's reveal switch keep the presence fields ──
{
  const { ctx, ws } = makeCtx({});
  const root = R.render(ctx);
  await flush();
  check("full: unchanged, receivers and who is in it, no Lights field and no registry fetch",
    !!qa(root, "data-link", "receivers") && /Alice/.test(text(roomNode(root, "Kitchen"))) && !qa(root, "data-lights", "1")
    && !("lights" in R.roomGroups(ctx)[0].rooms[0]) && ws.length === 0, { ws, t: text(root).slice(0, 300) });
}
{
  const { ctx } = makeCtx({ ...BRIGHT, bright_reveal_presence: true });
  const root = R.render(ctx);
  check("reveal: Bright with the presence screens revealed shows receivers and lights",
    !!qa(root, "data-link", "receivers") && !!qa(root, "data-lights", "1"));
}

// ── The menu: Rooms is in Bright's ─────────────────────────────────────────
{
  const consts = [
    cut("const _VIEW_PATHS = {", "\n};\n") + "\n};\n",
    cut("const MENU = [", "// ── DOM Utility Functions"),
  ].join("\n");
  const method = (name) => cut(`\n  ${name}(`, "\n  }\n").slice(1) + "\n  }\n";
  const make = new Function("EDITIONS", consts + "\nclass P {\n" + method("_getVisibleTabs") + method("_getMainTabs") + "\n}\nreturn P;");
  const P = make(ED);
  const tabs = (settings, complexity = "advanced") => { const p = new P(); p.state = { settings, complexity }; return p; };
  const vis = [...tabs(BRIGHT)._getVisibleTabs()].sort();
  check("menu: Bright's screens are Mapping, Rooms, Health and Settings",
    JSON.stringify(vis) === JSON.stringify(["health", "maps", "rooms", "settings"]), vis);
  check("menu: Rooms is a main screen in Bright, Basic and Advanced",
    tabs(BRIGHT, "basic")._getMainTabs().has("rooms") && tabs(BRIGHT, "advanced")._getMainTabs().has("rooms"));
  check("menu: so the All rooms links show in Bright (canOpen) and All receivers do not",
    tabs(BRIGHT)._getVisibleTabs().has("rooms") && !tabs(BRIGHT)._getVisibleTabs().has("receivers"));
  check("menu: the full edition's menu still has every screen", tabs({})._getVisibleTabs().has("receivers") && tabs({})._getVisibleTabs().has("rooms"));
}

console.log(JSON.stringify({ cases, failures }));
