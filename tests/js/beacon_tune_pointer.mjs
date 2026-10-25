// Beacon Tune's beacon pointer handling (#90, and the double-click dead zone).
//
// Runs the SHIPPED pointerdown/pointerup/click block from calibration.js
// against a stub map whose screen point IS the map fraction (iso, the
// stack transform and the SVG's CTM all identity), and reports what was
// saved, toasted and placed: a drag dropped off the map, one dropped on it,
// and two quick taps on a beacon with and without a beacon waiting to be
// placed.
//
// Run: node tests/js/beacon_tune_pointer.mjs <views dir>
// Prints one JSON line: { <scenario>: {...} }.
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWS = process.argv[2];
const SRC = fs.readFileSync(join(VIEWS, "calibration.js"), "utf8").replace(/\r\n/g, "\n");
const head = "  let _didDrag = false;\n  // A double-click on a beacon";
const tail = "\n  // Helper: commit placement of a pending beacon";
const h = SRC.indexOf(head), t = SRC.indexOf(tail, h);
if (h < 0 || t < 0) throw new Error("pointer block not found");
const BLOCK = SRC.slice(h, t);
const P = await import(pathToFileURL(join(VIEWS, "tune_save_plan.js")).href);

function tab() {
  const saved = [], toasts = [], placed = [];
  const docL = {};
  const document = {
    addEventListener(tp, f) { (docL[tp] = docL[tp] || []).push(f); },
    removeEventListener(tp, f) { docL[tp] = (docL[tp] || []).filter(x => x !== f); },
  };
  const isoL = {};
  const g = { getAttribute: (a) => ({ "data-map-id": "m1", "data-bk-id": "bk1", "data-z": "0" })[a],
              setAttribute() {} };
  const isoDiv = {
    style: {},
    addEventListener(tp, f) { (isoL[tp] = isoL[tp] || []).push(f); },
    querySelector: () => ({ getScreenCTM: () => ({ inverse: () => ({ a: 0.01, b: 0, c: 0, d: 0.01, e: 0, f: 0 }) }) }),
  };
  const bs = { draftBeacons: { m1: [{ id: "bk1", key: "ble:K", label: "Keys", x: 0.5, y: 0.5 }] },
               dirtyMaps: {}, selectedBk: null, pendingPlace: null, _dragging: false };
  const ctx = { toast: (m, err) => toasts.push([String(m), !!err]) };
  const env = {
    bs, ctx, isoDiv, document, maps_list: [{ id: "m1" }],
    mapXforms: { m1: { mapPt: (x, y) => [x, y], invMapPt: (x, y) => [x, y] } },
    iso: (x, y) => [x, y], invIso: (x, y) => [x, y],
    _refreshInfo() {}, _refreshSVG() {}, _refreshDirtyLabel() {}, _detectRoom: () => "Hall",
    _autoSaveAndStartTimer: (bk) => saved.push({ key: bk.key, x: bk.x, y: bk.y }),
    _placeAtPoint: (e) => placed.push([e.clientX, e.clientY]),
    tuneBeaconInBounds: P.tuneBeaconInBounds,
  };
  const names = Object.keys(env);
  new Function(...names, BLOCK)(...names.map(n => env[n]));
  const fireDoc = (tp, ev) => { for (const f of [...(docL[tp] || [])]) f({ type: tp, preventDefault() {}, ...ev }); };
  // 100 screen px per map unit, about what a real screen gives (taps jitter in px).
  const down = (x, y) => { for (const f of isoL.pointerdown) f({ target: { closest: () => g }, clientX: x * 100, clientY: y * 100,
    preventDefault() {}, stopPropagation() {} }); };
  return {
    bs, saved, toasts, placed,
    drag: (x, y) => { down(0.5, 0.5); fireDoc("pointermove", { clientX: x * 100, clientY: y * 100 }); fireDoc("pointerup", { clientX: x * 100, clientY: y * 100 }); },
    tap: (x, y) => { down(x, y); fireDoc("pointerup", { clientX: x * 100, clientY: y * 100 }); },
    jitter: (dpx) => { down(0.5, 0.5); fireDoc("pointermove", { clientX: 50 + dpx, clientY: 50 }); fireDoc("pointerup", { clientX: 50 + dpx, clientY: 50 }); },
    row: () => ({ x: bs.draftBeacons.m1[0].x, y: bs.draftBeacons.m1[0].y }),
  };
}

const out = {};
{ const T = tab(); T.drag(4.3, -2); out.offMap = { saved: T.saved, toasts: T.toasts, row: T.row(), dirty: !!T.bs.dirtyMaps.m1 }; }
{ const T = tab(); T.drag(0.25, 0.75); out.onMap = { saved: T.saved, toasts: T.toasts, row: T.row(), dirty: !!T.bs.dirtyMaps.m1 }; }
{ const T = tab(); T.drag(1, 0); out.edge = { saved: T.saved.length, toasts: T.toasts.length }; }
{ const T = tab(); T.bs.pendingPlace = { key: "ble:NEW" }; T.tap(0.5, 0.5); T.tap(0.5005, 0.5);
  out.doublePlacing = { placed: T.placed, saved: T.saved.length }; }
{ const T = tab(); T.tap(0.5, 0.5); T.tap(0.5, 0.5);
  out.doubleNotPlacing = { placed: T.placed, selected: T.bs.selectedBk, saved: T.saved.length }; }
{ const T = tab(); T.bs.pendingPlace = { key: "ble:NEW" }; T.tap(0.5, 0.5); T.tap(40, 40);
  out.twoTapsApart = { placed: T.placed }; }
{ const T = tab(); T.jitter(2); out.jitter = { saved: T.saved.length, row: T.row(), dirty: !!T.bs.dirtyMaps.m1 }; }
console.log(JSON.stringify(out));
