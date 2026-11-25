// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Wi-Fi coverage (views/wifi.js, test 2026-11-22) under the DOM shim:
//
//   colour   the radio map's ramp on the Wi-Fi scale; words for a reading
//   rooms    a floor's rooms from PadSpan's own floor model, never a photograph
//   raster   readings colour only inside the rooms and only near a reading
//   view     floors with data, the band chips, room readings, placed devices,
//            the counts line, the links card for an administrator only
//   answer   no UniFi Utopia: said in words, nothing drawn
//   bands    2.4 and 5 GHz always have a button; a room-only reading counts for its floor
//   refresh  it asks again each minute by itself while open, never under an open picker
//   findings what to fix, on top; a click shows it on the plan; access points drawn, dragged, reset
//   robot    the robot vacuum's floor-level layer: its own marks and details, on by default, off
//            remembered per browser, never in the coverage colours, counts or findings; German words
//   moving   its readings taken while it cleans: weighted 0.5 m cells as a faint tint, their own choice
//
// usage: wifi.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as shim from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: wifi.mjs <www/padspan-ha dir>"); process.exit(2); }
shim.install();

const src = readFileSync(join(WWW, "panel.js"), "utf-8").replace(/\r\n/g, "\n");
const grab = (head) => {
  const i = src.indexOf(head);
  return src.slice(i, src.indexOf("\n}\n", i) + 2);
};
const esc = new Function(`return ${grab("function esc(s){").replace(/^function esc/, "function")}`)();
const el = new Function("esc", `return ${grab("function el(tag, attrs={}, children=[]){").replace(/^function el/, "function")}`)(esc);

const W = await import(pathToFileURL(join(WWW, "views", "wifi.js")).href + "?b=test");
const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const q = (n, sel) => (n.querySelector ? n.querySelector(sel) : null);
const all = (n, sel) => (n.querySelectorAll ? [...n.querySelectorAll(sel)] : []);
const text = (n) => (n && n.textContent) || "";

const MODEL = {
  floors: [{ id: "main", name: "Main" }, { id: "upper", name: "Upper" }, { id: "outside", name: "Outside" }],
  room_geometry_m: {
    Office: { floor_id: "upper", points_m: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    Hall: { floor_id: "upper", points_m: [[4, 0], [10, 0], [10, 4], [4, 4]] },
    Kitchen: { floor_id: "main", points_m: [[0, 0], [6, 0], [6, 5], [0, 5]] },
  },
  map_transforms: { should_never_be_read: true },
};
const DATA = {
  version: 1, cell_m: 1.5, bands: ["2.4", "5"],
  aps: [{ mac: "f0:00:00:00:00:0a", name: "AP Upstairs" }, { mac: "f0:00:00:00:00:0b", name: "AP Garage" }],
  cells: [{ floor: "upper", band: "5", x: 2.25, y: 2.25, size: 1.5, median: -58, p25: -60, p75: -55, n: 40 }],
  rooms: [{ floor: "upper", band: "5", room: "Office", median: -58, p25: -60, p75: -55, n: 40 },
          { floor: "upper", band: "5", room: "Hall", median: -79, p25: -81, p75: -77, n: 6 }],
  fixed: [{ name: "esp32c3-trk", kind: "receiver", floor: "upper", x: 8, y: 2, band: "2.4", ap: "AP Garage", median: -71, n: 12 },
          { name: "wled-kitchen", kind: "device", floor: "main", x: 3, y: 2, band: "2.4", ap: "AP Garage", median: -48, n: 12 }],
  status: { padspan: true, linked: [], stats: {} },
};

function host(o = {}) {
  const calls = [], toasts = [];
  const ctx = {
    state: { view: "wifi", model: MODEL, dataMode: "live" },
    hass: { user: { is_admin: o.admin !== false } },
    helpers: { el, esc },
    toast: (m) => toasts.push(m),
    actions: {
      renderRooms: () => { ctx._renders = (ctx._renders || 0) + 1; },
      callWS: async (m) => {
        calls.push(m);
        if (o.absent) throw new Error("Unknown command.");
        if (m.type === "unifi_utopia/wifi_heatmap") return o.data || DATA;
        if (m.type === "unifi_utopia/wifi_links") return { wifi: [{ mac: "aa:00:00:00:00:02", name: "iPhone", band: "5", signal: -60, linked_to: null }], padspan: [{ id: "ps_1", label: "Alex's phone" }] };
        if (m.type === "unifi_utopia/wifi_link_set") return { wifi: [], padspan: [] };
        return {};
      },
    },
  };
  return { ctx, calls, toasts };
}

// colour and words
check("colour: the radio map's ramp, red at the weak end, green at the strong end",
  W.colour(-85) !== W.colour(-45) && /^rgb\(/.test(W.colour(-60)));
check("words", W.words(-50) === "excellent" && W.words(-62) === "good" && W.words(-70) === "fair" && W.words(-78) === "weak" && W.words(-90) === "very weak");

// rooms from the floor model; raster inside rooms and near readings only
const up = W.floorRooms(MODEL, "upper");
check("rooms: the floor's rooms from the floor model", up.map((r) => r.name).sort().join() === "Hall,Office");
{
  const pts = W.points(DATA, "upper", "5");
  const r = W.raster(up, pts, { x0: -1, y0: -1, x1: 11, y1: 5 });
  const at = (x, y) => r.grid[Math.floor((y + 1) / ((5 + 1) / r.h)) * r.w + Math.floor((x + 1) / (12 / r.w))];
  check("raster: coloured next to a reading", Number.isFinite(at(2.2, 2.2)) && Math.abs(at(2.2, 2.2) + 58) < 0.01, at(2.2, 2.2));
  check("raster: nothing far from every reading", !Number.isFinite(at(9.5, 3.5)), at(9.5, 3.5));
  check("raster: nothing outside the rooms", !Number.isFinite(at(2, -0.6)), at(2, -0.6));
}

// the view
{
  const { ctx, calls } = host();
  let root = W.render(ctx);
  check("first draw asks UniFi Utopia once and says it is loading", calls.length === 1 && calls[0].type === "unifi_utopia/wifi_heatmap" && /Loading/.test(text(root)));
  await tick(); await tick();
  root = W.render(ctx);
  const floors = all(root, "[data-wifi-floor]").map((b) => b.getAttribute("data-wifi-floor"));
  check("floors: those with rooms or readings, Outside left out when it has neither", floors.join() === "main,upper", floors);
  check("starts on a floor with readings, on 5 GHz", ctx.state._wifi.floor === "main" || ctx.state._wifi.floor === "upper");
  ctx.state._wifi.floor = "upper"; ctx.state._wifi.band = "5";
  root = W.render(ctx);
  const map = q(root, '[data-wifi="map"]');
  check("the floor drawn from the floor model, never the photo transform", map && /<svg/.test(map.innerHTML) && /Office/.test(map.innerHTML) && /Hall/.test(map.innerHTML));
  check("each room's typical reading on the map", (map.innerHTML.match(/data-wifi="room"/g) || []).length === 2 && /-58 dBm/.test(map.innerHTML) && /-79 dBm/.test(map.innerHTML));
  check("without a canvas the measured cells are drawn as squares", /data-wifi="cell"/.test(map.innerHTML));
  check("placed devices of another band are not on the 5 GHz map", !/data-wifi="device"/.test(map.innerHTML));
  const rows = text(q(root, '[data-wifi="rooms"]'));
  check("room list, weakest first, in words", rows.indexOf("Hall") < rows.indexOf("Office") && /very weak|weak/.test(rows) && /good/.test(rows), rows);
  check("counts line", /40 minutes of still-phone readings in 1 spot/.test(text(q(root, '[data-wifi="counts"]'))), text(q(root, '[data-wifi="counts"]')));
  check("access point picker when there is more than one", !!q(root, '[data-wifi="ap"]'));
  ctx.state._wifi.band = "2.4";
  root = W.render(ctx);
  check("2.4 GHz: the placed device on this floor, named in its tooltip", /data-wifi="device"/.test(q(root, '[data-wifi="map"]').innerHTML) && /esp32c3-trk/.test(q(root, '[data-wifi="map"]').innerHTML));
  check("links card for an administrator", !!q(root, '[data-wifi="links"]'));
  const bad = host({ data: { ...DATA, rooms: [{ floor: "upper", band: "5", room: "<img src=x onerror=1>", median: -60, n: 1 }] } });
  W.render(bad.ctx); await tick(); await tick();
  bad.ctx.state._wifi.floor = "upper"; bad.ctx.state._wifi.band = "5";
  const bad2 = W.render(bad.ctx);
  check("a room name from the data is text, never markup", !/<img/.test(q(bad2, '[data-wifi="rooms"]').innerHTML || ""));
}
{
  const { ctx } = host({ admin: false });
  W.render(ctx); await tick(); await tick();
  const root = W.render(ctx);
  check("no links card for anyone else", !q(root, '[data-wifi="links"]'));
}
{
  const { ctx } = host({ absent: true });
  W.render(ctx); await tick(); await tick();
  const root = W.render(ctx);
  check("no UniFi Utopia: said in words, nothing drawn", /didn't answer/.test(text(root)) && !q(root, '[data-wifi="map"]'));
  check("probe: no UniFi Utopia is no", (await W.probe(ctx.actions.callWS)) === false);
  check("probe: an answer with a version is yes", (await W.probe(host().ctx.actions.callWS)) === true);
}

// Both bands always have their button; the first floor is one with readings in the band shown.
{
  const only24 = { ...DATA, bands: ["2.4"], cells: [], rooms: [],
    fixed: [{ name: "wled-kitchen", kind: "device", floor: "main", x: 3, y: 2, band: "2.4", ap: "AP Garage", median: -48, n: 12 }] };
  const { ctx } = host({ data: only24 });
  W.render(ctx); await tick(); await tick();
  const root = W.render(ctx);
  const bands = all(root, "[data-wifi-band]").map((b) => b.getAttribute("data-wifi-band"));
  check("2.4 and 5 GHz buttons even before any 5 GHz reading", bands.join() === "2.4,5", bands);
  check("nothing on 5 GHz yet: starts on 2.4 GHz, on its floor", ctx.state._wifi.band === "2.4" && ctx.state._wifi.floor === "main", ctx.state._wifi);
  // A phone reading with a room but no spot (PadSpan had the room, not yet the place) still shows.
  const roomOnly = { ...DATA, bands: ["2.4", "5"], cells: [],
    rooms: [{ floor: "upper", band: "5", room: "Office", median: -90, n: 3 }],
    fixed: only24.fixed };
  const h2 = host({ data: roomOnly });
  W.render(h2.ctx); await tick(); await tick();
  const r2 = W.render(h2.ctx);
  check("a room-only 5 GHz reading: starts on 5 GHz on that room's floor, in the room list",
    h2.ctx.state._wifi.band === "5" && h2.ctx.state._wifi.floor === "upper" && /Office/.test(text(q(r2, '[data-wifi="rooms"]'))), h2.ctx.state._wifi);
  check("the access point picker is as wide as its names", /width:auto/.test(q(r2, '[data-wifi="ap"]').getAttribute("style") || ""));
}

// What to fix (UniFi Utopia's findings) on top; access points on the plan; where they are.
{
  const FINDINGS = [
    { id: "far_ap:WLED PillTaker", kind: "far_ap", level: "bad", title: "WLED PillTaker is on a far access point",
      detail: "It is on AP Upstairs at -80 dBm; Kitchen valance, 1.4 m away, gets -39 dBm from AP Garage.",
      advice: "Restart it (power off and on) so it chooses again.", floor: "main", x: 3, y: 2, band: "2.4" },
    { id: "phone_weak:Alex's phone|upper|Office|5", kind: "phone_weak", level: "warn", title: "Office: weak Wi-Fi where Alex's phone spends time",
      detail: "Alex's phone spent 2.0 hours there on weak Wi-Fi.", advice: "An access point nearer makes the most difference.",
      floor: "upper", room: "Office", band: "5" },
  ];
  const APS = [{ mac: "f0:00:00:00:00:0a", name: "AP Upstairs", floor: "upper", x: 6, y: 2, placed: "estimated", entity_id: "binary_sensor.ap_upstairs_online" },
               { mac: "f0:00:00:00:00:0b", name: "AP Garage", floor: "main", x: 5, y: 4, placed: "padspan", entity_id: "binary_sensor.ap_garage_online" },
               { mac: "f0:00:00:00:00:0c", name: "AP Nowhere", floor: null, x: null, y: null, placed: null }];
  const D2 = { ...DATA, findings: FINDINGS, aps: APS };
  const apTag = (svg, mac) => { const i = svg.indexOf(`data-mac="${mac}"`); return i < 0 ? "" : svg.slice(i, svg.indexOf("</g>", i)); };
  const { ctx, calls } = host({ data: D2 });
  W.render(ctx); await tick(); await tick();
  let root = W.render(ctx);
  const fc = q(root, '[data-wifi="findings"]');
  const rows = all(root, "[data-wifi-finding]");
  check("what to fix: on top, most urgent first, each with what it is and what to do",
    fc && root.children.indexOf(fc) === 1 && rows.length === 2 && rows[0].getAttribute("data-wifi-finding") === "far_ap:WLED PillTaker"
    && /Restart it/.test(text(rows[0])) && /1.4 m away/.test(text(rows[0])), text(fc));
  check("a far-access-point finding says neighbours' transmitters and antennas differ",
    /transmitters and antennas/.test(text(fc)) && /strong sign, not proof/.test(text(fc)));
  rows[1].click(); await tick();
  root = W.render(ctx);
  check("a click on a phone finding: its floor and band, its room ringed",
    ctx.state._wifi.floor === "upper" && ctx.state._wifi.band === "5" && /<polygon data-wifi="focus"/.test(q(root, '[data-wifi="map"]').innerHTML), ctx.state._wifi);
  check("the picked finding is marked in the list", /background:#13211a/.test(all(root, "[data-wifi-finding]")[1].getAttribute("style") || ""));
  all(root, "[data-wifi-finding]")[0].click(); await tick();
  root = W.render(ctx);
  const map = q(root, '[data-wifi="map"]').innerHTML;
  check("a click on a device finding: its floor and band, a ring at the device",
    ctx.state._wifi.floor === "main" && ctx.state._wifi.band === "2.4" && /<circle data-wifi="focus" cx="3" cy="2"/.test(map), map.slice(0, 200));
  const solid = apTag(map, "f0:00:00:00:00:0b");
  check("access points on their floor, named; one placed in Mapping drawn solid",
    solid && /AP Garage/.test(solid) && !/stroke-dasharray/.test(solid) && !apTag(map, "f0:00:00:00:00:0a"), solid.slice(0, 160));
  ctx.state._wifi.floor = "upper"; ctx.state._wifi.focus = null;
  root = W.render(ctx);
  const est = apTag(q(root, '[data-wifi="map"]').innerHTML, "f0:00:00:00:00:0a");
  check("an estimated access point is drawn dashed; nothing on this screen drags it", /stroke-dasharray/.test(est)
    && !/cursor:grab/.test(q(root, '[data-wifi="map"]').innerHTML), est.slice(0, 160));
  const card = q(root, '[data-wifi="aps"]');
  check("where the access points are: how each is placed, and Mapping is where they are placed",
    card && /placed in Mapping, like any device/.test(text(card)) && /placed in Mapping/.test(text(card))
    && /estimated/.test(text(card)) && /no placed device hears it yet/.test(text(card)) && !q(card, "select"), text(card));
  check("a button to Mapping for each access point UniFi Utopia added to Home Assistant; none without",
    all(card, "[data-wifi-ap-place]").length === 2 && /update UniFi Utopia/.test(text(card)), all(card, "[data-wifi-ap-place]").length);
  const before = calls.length;
  q(card, '[data-wifi-ap-place="f0:00:00:00:00:0a"]').click(); await tick();
  check("Place in Mapping: Mapping's devices, that access point selected; nothing sent to UniFi Utopia",
    ctx.state.view === "maps" && ctx.state.mapsTab === "lights" && ctx.state.maps._selLight.eid === "binary_sensor.ap_upstairs_online"
    && ctx.state.maps._focusRow === "binary_sensor.ap_upstairs_online" && calls.length === before, ctx.state.maps);
  ctx.state.view = "wifi";
  // Not an administrator: the findings and the access points, nothing to change.
  const viewer = host({ data: D2, admin: false });
  W.render(viewer.ctx); await tick(); await tick();
  viewer.ctx.state._wifi.floor = "upper";
  const vr = W.render(viewer.ctx);
  check("anyone else: findings and access points shown, no access point list",
    !!q(vr, '[data-wifi="findings"]') && /data-wifi="ap-mark"/.test(q(vr, '[data-wifi="map"]').innerHTML) && !q(vr, '[data-wifi="aps"]'));
  // Many findings: six, then all on asking. None yet: said so. An older UniFi Utopia: no list.
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `weak:d${i}`, kind: "weak", level: "bad", title: `d${i} has very weak Wi-Fi`, detail: "-87 dBm", advice: "", floor: "main", x: 1, y: 1, band: "2.4" }));
  const hm = host({ data: { ...DATA, findings: many, aps: [] } });
  W.render(hm.ctx); await tick(); await tick();
  let mr = W.render(hm.ctx);
  const six = all(mr, "[data-wifi-finding]").length;
  q(mr, '[data-wifi="findings-more"]').click();
  mr = W.render(hm.ctx);
  check("more than six findings: six, then all of them on asking", six === 6 && all(mr, "[data-wifi-finding]").length === 8, six);
  const twice = host({ data: { ...DATA, aps: [], findings: [
    { id: "far_ap:a", kind: "far_ap", level: "warn", title: "a", detail: "da", advice: "Restart it.", floor: "main", x: 1, y: 1, band: "2.4" },
    { id: "far_ap:b", kind: "far_ap", level: "warn", title: "b", detail: "db", advice: "Restart it.", floor: "main", x: 2, y: 1, band: "2.4" },
    { id: "weak:c", kind: "weak", level: "warn", title: "c", detail: "dc", advice: "Move it.", floor: "main", x: 3, y: 1, band: "2.4" }] } });
  W.render(twice.ctx); await tick(); await tick();
  const tw = text(q(W.render(twice.ctx), '[data-wifi="findings"]'));
  check("the same advice for findings in a row is said once", (tw.match(/Restart it\./g) || []).length === 1 && /Move it\./.test(tw), tw);
  const none = host({ data: { ...DATA, findings: [], aps: [] } });
  W.render(none.ctx); await tick(); await tick();
  check("nothing found yet: said in words", /Nothing found yet/.test(text(q(W.render(none.ctx), '[data-wifi="findings"]'))));
  const older = host({ data: DATA });
  W.render(older.ctx); await tick(); await tick();
  check("an older UniFi Utopia without findings: no list, the rest as before", !q(W.render(older.ctx), '[data-wifi="findings"]'));
  const bad = host({ data: { ...DATA, findings: [{ id: "x", level: "bad", title: "<img src=x onerror=1>", detail: "<b>x</b>", advice: "" }], aps: [] } });
  W.render(bad.ctx); await tick(); await tick();
  const br = q(W.render(bad.ctx), '[data-wifi="findings"]');
  check("a finding's words are text, never markup", !all(br, "img").length && !all(br, "b").length && /<img src=x/.test(text(br)));
}

// It asks again by itself each minute while it is open (the panel's poll redraws only live views).
{
  const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; };
  globalThis.clearTimeout = (t) => { if (t) t.cleared = true; };
  const live = () => timers.filter((t) => !t.cleared && !t.fired);
  const fire = async () => { const t = live().pop(); t.fired = true; t.fn(); await tick(); await tick(); };
  try {
    const { ctx, calls } = host();
    W.render(ctx); await tick(); await tick();
    check("after an answer: asks again in a minute, one timer only", live().length === 1 && live()[0].ms === 60000, timers.map((t) => t.ms));
    const before = ctx._renders || 0;
    await fire();
    check("a minute on the tab: asked again and redrawn", calls.length === 2 && (ctx._renders || 0) > before && live().length === 1, calls.length);
    const S = ctx.state._wifi;
    const realRoot = S.root;
    S.root = { isConnected: true, contains: () => true, getRootNode: () => ({ activeElement: { tagName: "SELECT" } }) };
    await fire();
    check("a picker open: not redrawn under it, looked at again in 15 s", calls.length === 2 && live().length === 1 && live()[0].ms === 15000);
    S.root = realRoot;
    ctx.state.view = "overview";
    await fire();
    check("on another tab: not asked, and no timer left", calls.length === 2 && live().length === 0);
    ctx.state.view = "wifi"; S.ts = 0;
    W.render(ctx); await tick(); await tick();
    S.root = { isConnected: false };
    await fire();
    check("the panel gone: not asked, and no timer left", calls.length === 3 && live().length === 0, calls.length);
  } finally {
    globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
  }
}

// The robot vacuum's floor-level layer (UniFi Utopia 0.4.0.8's "robot"): its own marks, never the coverage colours.
{
  const ROBOT = { version: 1, readings: [
    { x: 1, y: 1, floor: "main", band: "2.4", own: -62, ap: "AP Garage", ap_side: -71, ts: 1764000000, run: "rr_1" },
    { x: 4, y: 3, floor: "main", band: "2.4", own: -81, ap: "AP Garage", ap_side: null, ts: 1764000060, run: "rr_1" },
    { x: 2, y: 2, floor: "upper", band: "2.4", own: -70, ap: null, ap_side: null, ts: 1764000120, run: "rr_1" },
    { x: 3, y: 3, floor: "main", band: "2.4", own: null, ap: null, ap_side: null, ts: 1764000180, run: "rr_1" },
  ] };
  const withRobot = { ...DATA, robot: ROBOT };
  const MARK = /<g data-wifi="robot">[\s\S]*?<\/g>/g;
  const robotMarks = (root) => (q(root, '[data-wifi="map"]').innerHTML.match(MARK) || []);
  const open = async (data, floor = "main", band = "2.4") => {
    const h = host({ data });
    W.render(h.ctx); await tick(); await tick();
    h.ctx.state._wifi.floor = floor; h.ctx.state._wifi.band = band;
    return { ...h, root: W.render(h.ctx) };
  };
  localStorage.clear();
  const plain = await open(DATA);
  check("robot: an answer without robot readings: no layer choice, no marks, no note",
    !q(plain.root, '[data-wifi-layer="robot"]') && !robotMarks(plain.root).length && !q(plain.root, '[data-wifi="robot-note"]'));
  const on = await open(withRobot);
  const tog = q(on.root, '[data-wifi-layer="robot"]');
  check("robot: the layer choice, named with its band and floor level, on by default",
    tog && text(tog) === "Robot (floor level, 2.4 GHz)" && /background:#1f3d2b/.test(tog.getAttribute("style") || ""), tog && text(tog));
  const marks = robotMarks(on.root);
  check("robot: a mark at each of this floor's readings, none for one without a signal", marks.length === 2
    && /M 1 0\.\d+/.test(marks[0]) && marks.every((m) => !/\b3 3\b/.test(m)), marks);
  check("robot: coloured by its own signal on the screen's scale", marks[0].includes(`fill="${W.colour(-62)}"`) && marks[1].includes(`fill="${W.colour(-81)}"`));
  check("robot: details give its own dBm, the access point, the access point's side when joined, and when",
    /Robot at floor level: -62 dBm/.test(marks[0]) && /Access point: AP Garage/.test(marks[0]) && /AP Garage hears the robot at -71 dBm/.test(marks[0])
    && marks[0].includes(new Date(1764000000 * 1000).toLocaleString()), marks[0]);
  check("robot: not joined: no access point side said", /-81 dBm/.test(marks[1]) && !/hears the robot/.test(marks[1]), marks[1]);
  const note = q(on.root, '[data-wifi="robot-note"]');
  check("robot: a note under the layer: floor height, weaker than at hand height", note && /floor height/.test(text(note)) && /weaker than at hand height/.test(text(note)), text(note));
  // Not mixed in: the drawing without its marks is the drawing without the robot; the readings, rooms, counts and findings as before.
  const bare = await open(DATA);
  check("robot: nothing else on the map changes (no coverage colour, no room reading, no device)",
    q(on.root, '[data-wifi="map"]').innerHTML.replace(MARK, "") === q(bare.root, '[data-wifi="map"]').innerHTML);
  check("robot: not in the coverage readings", JSON.stringify(W.points(withRobot, "main", "2.4")) === JSON.stringify(W.points(DATA, "main", "2.4")));
  check("robot: counts line as before", text(q(on.root, '[data-wifi="counts"]')) === text(q(bare.root, '[data-wifi="counts"]')));
  const fnd = { ...withRobot, findings: [{ id: "weak:x", kind: "weak", level: "bad", title: "x has very weak Wi-Fi", detail: "-87 dBm", advice: "", floor: "main", x: 1, y: 1, band: "2.4" }] };
  const fr = await open(fnd);
  check("robot: findings as UniFi Utopia gave them, none added", all(fr.root, "[data-wifi-finding]").length === 1);
  const up = await open(withRobot, "upper");
  check("robot: each floor its own readings", robotMarks(up.root).length === 1 && /-70 dBm/.test(robotMarks(up.root)[0]) && !/Access point:/.test(robotMarks(up.root)[0]));
  const five = await open(withRobot, "main", "5");
  check("robot: on 5 GHz no marks, and the note says the readings are on 2.4 GHz",
    !robotMarks(five.root).length && /None on this floor at 5 GHz: the robot's readings are at 2\.4 GHz/.test(text(q(five.root, '[data-wifi="robot-note"]'))));
  // Turned off: remembered in this browser, also on the next visit; on again the same way.
  q(on.root, '[data-wifi-layer="robot"]').click();
  const off = W.render(on.ctx);
  check("robot: turned off: no marks, no note, the choice still there to turn it on",
    localStorage.getItem("padspan_wifi_robot") === "0" && !robotMarks(off).length && !q(off, '[data-wifi="robot-note"]') && !!q(off, '[data-wifi-layer="robot"]'));
  const again = await open(withRobot);
  check("robot: off is remembered per browser", !robotMarks(again.root).length);
  q(again.root, '[data-wifi-layer="robot"]').click();
  check("robot: on again", localStorage.getItem("padspan_wifi_robot") === "1" && robotMarks(W.render(again.ctx)).length === 2);
  const evil = await open({ ...DATA, robot: { version: 1, readings: [{ x: 1, y: 1, floor: "main", band: "2.4", own: -60, ap: "<img src=x onerror=1>", ap_side: -70, ts: 1764000000 }] } });
  check("robot: an access point's name is text, never markup", !/<img/.test(q(evil.root, '[data-wifi="map"]').innerHTML) && /&lt;img/.test(q(evil.root, '[data-wifi="map"]').innerHTML));
  const older = await open({ ...DATA, robot: { version: 1 } });
  check("robot: no readings list: no layer", !q(older.root, '[data-wifi-layer="robot"]'));
  // Readings taken while it cleans (2026-11-25, kind "moving", weight 0.1): a faint tint in 0.5 m cells, weighted.
  const MV = (x, y, own, o = {}) => ({ x, y, floor: "main", band: "2.4", own, ap: null, ap_side: null, ts: 1764000300, run: null, kind: "moving", weight: 0.1, ...o });
  const STOP = { x: 5.1, y: 1.1, floor: "main", band: "2.4", own: -50, ap: null, ap_side: null, ts: 1764000000, run: "rr_2", kind: "stop", weight: 1.0 };
  const withMoving = { ...DATA, robot: { version: 1, readings: [...ROBOT.readings, STOP,
    MV(5.2, 1.3, -80), MV(5.4, 1.1, -80),                     // with the stop in its cell: the stop decides
    MV(5.1, 4.1, -70), MV(5.3, 4.4, -74),                     // a cell of moving ones alone: their mean
    MV(3.2, 3.2, -60, { floor: "upper" }), MV(3.2, 3.2, -60, { band: "5" })] } };
  const cells = W.movingCells(W.robotReadings(withMoving), "main", "2.4");
  const at = (x, y) => cells.find((c) => Math.abs(c.x - x) < 1e-9 && Math.abs(c.y - y) < 1e-9);
  const withStop = at(5.25, 1.25), alone = at(5.25, 4.25);
  const expect = (1 * -50 + 0.1 * -80 + 0.1 * -80) / 1.2;
  check("moving: cells of 0.5 m on this floor and band, only where a reading was taken while it cleaned",
    W.MOVING_CELL_M === 0.5 && cells.length === 2 && withStop && alone, cells);
  check("moving: a weighted mean, so a cell with a stop is decided almost entirely by the stop",
    Math.abs(withStop.v - expect) < 1e-9 && Math.abs(withStop.v - -50) < 5 && withStop.n === 2 && withStop.stops === 1, withStop);
  check("moving: a cell of moving readings alone is their mean", Math.abs(alone.v - -72) < 1e-9 && alone.n === 2 && alone.stops === 0, alone);
  check("moving: a reading without a kind is a stop at weight 1", W.isMoving(ROBOT.readings[0]) === false
    && W.movingCells([{ x: 0.1, y: 0.1, floor: "main", band: "2.4", own: -50 }, MV(0.2, 0.2, -90)], "main", "2.4")[0].v === (-50 - 9) / 1.1);
  const mo = await open(withMoving);
  const html = q(mo.root, '[data-wifi="map"]').innerHTML;
  const tint = (html.match(/<g data-wifi="robot-moving"[\s\S]*?<\/g>/) || [""])[0];
  check("moving: drawn as a faint tint of small squares, one per cell, coloured by the weighted value",
    /opacity="0\.55"/.test(tint) && (tint.match(/data-wifi="robot-cell"/g) || []).length === 2 && tint.includes(`fill="${W.colour(withStop.v)}"`)
    && /width="0\.3"/.test(tint), tint);
  check("moving: under the rooms' outlines, the devices and the stops' diamonds", html.indexOf('data-wifi="robot-moving"') < html.indexOf('fill="none" stroke="#3d5a48"')
    && html.indexOf('data-wifi="robot-moving"') < html.indexOf('<g data-wifi="robot">'), html.slice(0, 300));
  check("moving: stops stay diamonds, none for a moving reading", robotMarks(mo.root).length === 3, robotMarks(mo.root).length);
  check("moving: details say how many while cleaning and the weighted value",
    /While cleaning: 2 readings/.test(tint) && new RegExp(`Weighted: ${Math.round(withStop.v)} dBm at floor level`).test(tint)
    && /With 1 stop here, which counts ten times as much/.test(tint), tint);
  const mnote = text(q(mo.root, '[data-wifi="robot-note"]'));
  check("moving: the layer note names both kinds", /Diamonds:/.test(mnote) && /Faint squares: its Wi-Fi taken every few seconds while it cleaned/.test(mnote), mnote);
  check("moving: nothing else on the map changes", html.replace(/<g data-wifi="robot-moving"[\s\S]*?<\/g>/, "").replace(MARK, "")
    === q(bare.root, '[data-wifi="map"]').innerHTML.replace(MARK, ""));
  // Its own choice, shown with the layer on: hidden, remembered per browser; the stops stay.
  const mtog = q(mo.root, '[data-wifi-layer="robot-moving"]');
  check("moving: its own choice beside the layer's, on by default", mtog && text(mtog) === "While it cleaned" && /background:#1f3d2b/.test(mtog.getAttribute("style") || ""), mtog && text(mtog));
  check("moving: no choice without moving readings", !q(on.root, '[data-wifi-layer="robot-moving"]'));
  mtog.click();
  const hid = W.render(mo.ctx);
  check("moving: hidden: no tint, the stops still there, the choice still there",
    localStorage.getItem("padspan_wifi_robot_moving") === "0" && !/data-wifi="robot-moving"/.test(q(hid, '[data-wifi="map"]').innerHTML)
    && robotMarks(hid).length === 3 && !!q(hid, '[data-wifi-layer="robot-moving"]'));
  const mo2 = await open(withMoving);
  check("moving: hidden is remembered per browser", !/data-wifi="robot-moving"/.test(q(mo2.root, '[data-wifi="map"]').innerHTML) && robotMarks(mo2.root).length === 3);
  q(mo2.root, '[data-wifi-layer="robot-moving"]').click();
  check("moving: shown again", localStorage.getItem("padspan_wifi_robot_moving") === "1" && /data-wifi="robot-moving"/.test(q(W.render(mo2.ctx), '[data-wifi="map"]').innerHTML));
  q(mo2.root, '[data-wifi-layer="robot"]').click();
  const layerOff = W.render(mo2.ctx);
  check("moving: the robot layer off takes the tint and its choice with it",
    !/data-wifi="robot-moving"/.test(q(layerOff, '[data-wifi="map"]').innerHTML) && !q(layerOff, '[data-wifi-layer="robot-moving"]'));
  localStorage.setItem("padspan_wifi_robot", "1");
  const onlyMoving = await open({ ...DATA, robot: { version: 1, readings: [MV(3.1, 3.2, -70)] } });
  check("moving: a floor with moving readings only is not said to have none",
    !/None on this floor/.test(text(q(onlyMoving.root, '[data-wifi="robot-note"]'))) && /robot-cell/.test(q(onlyMoving.root, '[data-wifi="map"]').innerHTML));
  // In German (i18n/de/aboard2.json, the robot's words): the choice and the note.
  const I = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href + "?b=test");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const p = new URL(String(u)).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    return { ok: true, json: async () => JSON.parse(readFileSync(decodeURIComponent(p), "utf-8")) };
  };
  try {
    const got = await I.useLanguage({ locale: { language: "de" } }, ["aboard2"]);
    const de = await open(withRobot);
    check("robot: in German, the layer and its note", got === "de" && text(q(de.root, '[data-wifi-layer="robot"]')) === "Roboter (Bodenhöhe, 2.4 GHz)"
      && /Bodenhöhe/.test(text(q(de.root, '[data-wifi="robot-note"]'))) && /Roboter in Bodenhöhe: -62 dBm/.test(robotMarks(de.root)[0]), text(q(de.root, '[data-wifi-layer="robot"]')));
    const dm = await open(withMoving);
    const dtint = q(dm.root, '[data-wifi="map"]').innerHTML;
    check("moving: in German, its choice, its note and its details", text(q(dm.root, '[data-wifi-layer="robot-moving"]')) === "Beim Saugen"
      && /Blasse Quadrate/.test(text(q(dm.root, '[data-wifi="robot-note"]'))) && /Beim Saugen: 2 Messwerte/.test(dtint) && /Gewichtet: -\d+ dBm in Bodenhöhe/.test(dtint)
      && /Mit 1 Halt hier, der zehnmal so viel zählt/.test(dtint) && !/While cleaning/.test(dtint), text(q(dm.root, '[data-wifi-layer="robot-moving"]')));
  } finally {
    await I.useLanguage({ locale: { language: "en" } });
    globalThis.fetch = realFetch;
  }
  localStorage.clear();
}

console.log(JSON.stringify({ cases, failures }));
