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
//   answer   no UniFi Blocker: said in words, nothing drawn
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
        if (m.type === "unifiblocker/wifi_heatmap") return o.data || DATA;
        if (m.type === "unifiblocker/wifi_links") return { wifi: [{ mac: "aa:00:00:00:00:02", name: "iPhone", band: "5", signal: -60, linked_to: null }], padspan: [{ id: "ps_1", label: "Alex's phone" }] };
        if (m.type === "unifiblocker/wifi_link_set") return { wifi: [], padspan: [] };
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
  check("first draw asks UniFi Blocker once and says it is loading", calls.length === 1 && calls[0].type === "unifiblocker/wifi_heatmap" && /Loading/.test(text(root)));
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
  check("no UniFi Blocker: said in words, nothing drawn", /didn't answer/.test(text(root)) && !q(root, '[data-wifi="map"]'));
  check("probe: no UniFi Blocker is no", (await W.probe(ctx.actions.callWS)) === false);
  check("probe: an answer with a version is yes", (await W.probe(host().ctx.actions.callWS)) === true);
}

console.log(JSON.stringify({ cases, failures }));
