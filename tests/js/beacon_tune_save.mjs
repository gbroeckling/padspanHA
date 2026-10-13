// Beacon Tune placement -> fabric pin harness (r5).
//
// Runs the SHIPPED Beacon Tune functions from calibration.js - the auto-pin
// (_autoPinTracked), placement from the Available list and Relocate
// (_placeBeaconOnMap), the drag's auto-save (_autoSaveAndStartTimer), the
// save (_saveBeacons) and the Save button - against a stub ctx, and reports
// the fabric_beacon_position_set calls and toasts each flow produced. A
// fixed beacon is pinned when placed or moved, a device known to move is
// not (and the toast says so), and a beacon that already has a fabric pin
// is moved whatever it is.
//
// Run: node tests/js/beacon_tune_save.mjs <views dir>
// Prints one JSON line: { <scenario>: { calls, toasts, captures, rows } }.
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWS = process.argv[2];
// LF regardless of the checkout's line endings (tune_save_fabric.mjs).
const SRC = fs.readFileSync(join(VIEWS, "calibration.js"), "utf8").replace(/\r\n/g, "\n");

function cut(head, tail, mustHave) {
  let h = SRC.indexOf(head);
  while (h >= 0 && mustHave && !SRC.slice(h, SRC.indexOf(tail, h)).includes(mustHave)) h = SRC.indexOf(head, h + 1);
  if (h < 0) throw new Error("not found: " + head);
  const t = SRC.indexOf(tail, h);
  if (t < 0) throw new Error("tail not found after: " + head);
  return SRC.slice(h, t + tail.length);
}
const ROOM_CENTROID = cut("function _roomCentroid(roomName, mapData) {", "\n}\n");
const IS_FOLLOWED = cut("  const _isFollowed = (obj) =>", "\n");
const AUTO_PIN = cut("  function _autoPinTracked() {", "\n  }\n");
const SAVE_BEACONS = cut("  async function _saveBeacons(mapIds) {", "\n  }\n");
const SAVE_BUTTON = cut('  saveBtn.addEventListener("click", async () => {', "\n  });\n", "Object.keys(bs.dirtyMaps)");
const AUTO_SAVE = cut("  async function _autoSaveAndStartTimer(bkObj, mapId) {", "\n  }\n");
const PLACE = cut("  function _placeBeaconOnMap(m, nx, ny) {", "\n  }\n");

const P = await import(pathToFileURL(join(VIEWS, "tune_save_plan.js")).href);
const S = await import(pathToFileURL(join(VIEWS, "stack_transform.js")).href);
P.tuneSavePlanInit({ mapFracToMetres: S.mapFracToMetres, metresToMapFrac: S.metresToMapFrac });

const TF = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 20, scale_y_m: 10, rotation_rad: 0, shear_rad: 0, floor_id: "main" };
const flush = () => new Promise(r => setTimeout(r, 20));

// One Beacon Tune tab: its state, the real functions, and what they did.
function tab({ maps, objects = [], pins = {}, follows = [] }) {
  const calls = [], toasts = [], captures = [];
  const followed = new Set(follows.map(f => f.toUpperCase()));
  const snap = { objects: { list: objects } };
  const ctx = {
    state: { model: { map_transforms: { m1: TF }, beacon_positions_m: JSON.parse(JSON.stringify(pins)) },
             settings: { beacon_auto_calibrate: true }, live: { snapshot: snap } },
    actions: {
      callWS: async (p) => { calls.push(p); return { ok: true, key: p.key, room: "" }; },
      followedHas: (id) => !!id && followed.has(String(id).toUpperCase()),
      mapsRefresh: async () => {}, modelRefresh: async () => {},
    },
    toast: (m) => { toasts.push(String(m)); },
  };
  const bs = { draftBeacons: {}, dirtyMaps: {}, editBaseline: {}, selectedBk: null, pendingPlace: null,
               _relocating: null, _liveTimers: {}, _liveBeaconKeys: new Set() };
  // Seeded from the maps as the view does: the fabric's pins come back in m.beacons.
  for (const m of maps) {
    bs.draftBeacons[m.id] = (m.beacons || []).map(bk => ({ ...bk }));
    bs.editBaseline[m.id] = P.tuneBeaconBaseline(bs.draftBeacons[m.id]);
  }
  const saveBtn = { disabled: false, _fn: null, addEventListener(ev, fn) { if (ev === "click") this._fn = fn; } };
  const statusLbl = { textContent: "" };
  const body = [
    "const _refreshDirtyLabel = () => {}, _refreshSVG = () => {}, _refreshInfo = () => {},",
    "  _refreshBeaconList = () => {}, _refreshAvailable = () => {}, _refreshPlaceBanner = () => {};",
    "const _startLiveTimer = (bk, mapId) => captures.push(bk.key);",
    ROOM_CENTROID, IS_FOLLOWED, AUTO_PIN, SAVE_BEACONS, SAVE_BUTTON, AUTO_SAVE, PLACE,
    "return { _autoPinTracked, _placeBeaconOnMap, _autoSaveAndStartTimer };",
  ].join("\n");
  // Every tune_save_plan export, as calibration.js imports them.
  const plan = Object.keys(P).filter(n => n.startsWith("tune"));
  const fns = new Function("bs", "maps_list", "ctx", "snap", "saveBtn", "statusLbl", "captures", ...plan, body)(
    bs, maps, ctx, snap, saveBtn, statusLbl, captures, ...plan.map(n => P[n]));
  const T = {
    bs, ctx, calls, toasts, captures, maps,
    autoPin: () => fns._autoPinTracked(),
    // Available list row click, then a double-click on the map.
    place: async (obj, x, y) => {
      bs.pendingPlace = { key: obj.key, label: obj.user_label || obj.name || "", kind: obj.kind || "ble" };
      fns._placeBeaconOnMap(maps[0], x, y);
      await flush();
    },
    // Relocate button, then a double-click on the map.
    relocate: async (key, x, y) => {
      const bk = bs.draftBeacons.m1.find(b => b.key === key);
      bs._relocating = { bkId: bk.id, mapId: "m1" };
      bs.pendingPlace = { key, label: bk.label, kind: bk.kind };
      fns._placeBeaconOnMap(maps[0], x, y);
      await flush();
    },
    // A drag ends (onUp): the row moved, then the auto-save.
    drag: async (key, x, y) => {
      const bk = bs.draftBeacons.m1.find(b => b.key === key);
      bk.x = x; bk.y = y; bs.dirtyMaps.m1 = true;
      await fns._autoSaveAndStartTimer(bk, "m1");
    },
    save: async () => { await saveBtn._fn(); },
    report: () => ({ calls: calls.map(c => c.key), toasts: toasts.slice(), captures: captures.slice(),
      rows: (bs.draftBeacons.m1 || []).map(b => ({ key: b.key, tracked: !!b._tracked })) }),
  };
  return T;
}

const out = {};

// Side A: rooms only in the fabric (no room_bounds), so nothing is auto-pinned
// and every labelled device sits in the Available list.
{
  const objects = [
    { key: "ble:IRK1", kind: "private_ble", user_label: "Garry's Phone", room: "Office" },
    { key: "ibeacon:app", kind: "ibeacon", user_label: "Pixel app", room: "Office" },
    { key: "ble:AA:BB:CC:DD:EE:09", kind: "ble", address: "AA:BB:CC:DD:EE:09", user_label: "Car Keys", room: "Hall" },
    { key: "ibeacon:door", kind: "ibeacon", user_label: "Door beacon", room: "Hall" },
    { key: "entity:device_tracker.fob", kind: "entity", address: "AA:BB:CC:DD:EE:04",
      entity_id: "device_tracker.fob", user_label: "Fob", room: "Hall" },
  ];
  const T = tab({ maps: [{ id: "m1", floor_id: "main", beacons: [] }], objects,
                  follows: ["IBEACON:APP", "AA:BB:CC:DD:EE:09"] });
  T.autoPin();
  const autoPinned = T.report().rows.length;
  for (const [i, o] of objects.entries()) await T.place(o, 0.1 + i * 0.1, 0.2);
  out.fabricOnly = { ...T.report(), autoPinned };
}

// Side A's other half (b): a photo polygon, so the auto-pin shows a
// Companion-app phone nobody follows and a Find My tag on its first address.
{
  const objects = [
    { key: "ibeacon:companion", kind: "ibeacon", user_label: "Pixel", room: "Kitchen" },
    { key: "ble:AA:BB:CC:DD:EE:02", kind: "ble", address: "AA:BB:CC:DD:EE:02", user_label: "AirTag", room: "Kitchen" },
  ];
  const T = tab({ maps: [{ id: "m1", floor_id: "main", beacons: [],
    room_bounds: { Kitchen: { type: "circle", cx: 0.5, cy: 0.5 } } }], objects });
  T.autoPin();
  const shown = T.report().rows;
  await T.drag("ibeacon:companion", 0.2, 0.2);
  await T.relocate("ble:AA:BB:CC:DD:EE:02", 0.8, 0.8);
  out.autoPinned = { ...T.report(), shown };
}

// (a) existing pins - a fixed BLE beacon Bermuda tracks (entity) and a
// followed one - come back from the fabric in m.beacons and are moved.
{
  const pins = { "entity:device_tracker.hall": { x_m: 10, y_m: 5, floor_id: "main" },
                 "ble:AA:BB:CC:DD:EE:01": { x_m: 4, y_m: 5, floor_id: "main" } };
  const T = tab({ maps: [{ id: "m1", floor_id: "main", beacons: [
      { id: "bk_hall", key: "entity:device_tracker.hall", label: "Hall", kind: "entity", x: 0.5, y: 0.5 },
      { id: "bk_shelf", key: "ble:AA:BB:CC:DD:EE:01", label: "Shelf", kind: "ble", x: 0.2, y: 0.5 } ] }],
    objects: [{ key: "entity:device_tracker.hall", kind: "entity", address: "AA:BB:CC:DD:EE:05", entity_id: "device_tracker.hall" }],
    pins, follows: ["AA:BB:CC:DD:EE:01", "DEVICE_TRACKER.HALL"] });
  await T.drag("entity:device_tracker.hall", 0.6, 0.5);
  await T.relocate("ble:AA:BB:CC:DD:EE:01", 0.3, 0.5);
  out.existingPins = T.report();
}

// Save: a held row is said by name, never "No beacon positions changed".
{
  const T = tab({ maps: [{ id: "m1", floor_id: "main", beacons: [] }],
    objects: [{ key: "ble:IRK1", kind: "private_ble", user_label: "Garry's Phone" }] });
  T.bs.draftBeacons.m1.push({ id: "bk_p", key: "ble:IRK1", label: "Garry's Phone", kind: "private_ble", x: 0.3, y: 0.3 });
  T.bs.dirtyMaps.m1 = true;
  await T.save();
  out.saveHeld = T.report();
}

console.log(JSON.stringify(out));
