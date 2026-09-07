// Tune Save -> fabric lifecycle harness (R4/R5).
//
// Executes the SHIPPED registered callbacks from calibration.js — the Tune
// Save handler, the Height (Save Z) handler, the Remove-from-floor handler
// and the Reset handler — against a stub ctx with a faithful backend
// model:
//
//   backend.spatial  scanner_positions_m (x/y/z/floor per source)
//   backend.meta     model scanners metadata (what fabric_scanner_remove
//                    actually deletes — the spatial entry PERSISTS,
//                    modelling the real backend, see finding 4)
//
// modelRefresh publishes backend.spatial into ctx.state.model (or swallows
// the update on demand, modelling panel.js error swallowing); mapsRefresh
// is counted. Deferred requests let flows interleave a save with a drag,
// a height press, or a refresh the way the live tab does.
//
// Single-save scenarios run: real tuneSyncTuneDrafts init -> UI-faithful
// draft mutations -> Save -> refreshes -> post-save sync (as a rerender).
// Flow scenarios (flow_*) run bespoke multi-step callback sequences and
// report journals.
//
// Run: node tests/js/tune_save_fabric.mjs <views dir> <scenario>
// Prints one JSON line.
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWS = process.argv[2];
const SCENARIO = process.argv[3] || "moved";
const SRC = fs.readFileSync(join(VIEWS, "calibration.js"), "utf8");

function extractHandler(headMark, windowSize, tailMark) {
  const HEAD = headMark;
  let h = SRC.indexOf(HEAD);
  while (h >= 0) {
    if (SRC.slice(h, h + windowSize).includes(tailMark)) break;
    h = SRC.indexOf(HEAD, h + 1);
  }
  if (h < 0) throw new Error("handler not found: " + headMark);
  return { h };
}

// Tune Save handler: the saveBtn listener whose body reads dirtyMaps.
const SAVE_HEAD = '  saveBtn.addEventListener("click", async () => {';
const SAVE_MARK = "const dirtyIds = Object.keys(ts.dirtyMaps)";
let hStart = SRC.indexOf(SAVE_HEAD);
while (hStart >= 0) {
  if (SRC.slice(hStart, hStart + 2600).includes(SAVE_MARK)) break;
  hStart = SRC.indexOf(SAVE_HEAD, hStart + 1);
}
if (hStart < 0) throw new Error("Tune Save handler body not found");
const SAVE_TAIL = "  });\n\n  // Reset button";
const saveTailIdx = SRC.indexOf(SAVE_TAIL, hStart);
if (saveTailIdx < 0) throw new Error("Reset-button anchor moved; harness needs updating");
const SAVE_HANDLER = SRC.slice(hStart, saveTailIdx + "  });".length);

// Height handler: the zBtn listener inside the info panel.
const Z_HEAD = '      zBtn.addEventListener("click", async () => {';
const Z_TAIL = "      });\n      zRow.appendChild(zLbl);";
const zStart = SRC.indexOf(Z_HEAD);
if (zStart < 0) throw new Error("Height handler not found");
const zTailIdx = SRC.indexOf(Z_TAIL, zStart);
if (zTailIdx < 0) throw new Error("Height handler tail moved; harness needs updating");
const HEIGHT_HANDLER = SRC.slice(zStart, zTailIdx + "      });".length);

// Removal handler: the removeBtn listener ("Remove from floor").
const R_HEAD = '    removeBtn.addEventListener("click", async () => {';
const R_TAIL = "    });\n    infoCard.appendChild(removeBtn);";
const rStart = SRC.indexOf(R_HEAD);
if (rStart < 0) throw new Error("Removal handler not found");
const rTailIdx = SRC.indexOf(R_TAIL, rStart);
if (rTailIdx < 0) throw new Error("Removal handler tail moved; harness needs updating");
const REMOVE_HANDLER = SRC.slice(rStart, rTailIdx + "    });".length);

// Reset handler: up to ctrlRow.appendChild(saveBtn).
const RST_HEAD = '  resetBtn.addEventListener("click", () => {';
const RST_TAIL = "  });\n\n  ctrlRow.appendChild(saveBtn);";
const rstStart = SRC.indexOf(RST_HEAD);
// NOTE: several resetBtn listeners exist (other tabs); take the one in the
// Tune tab — the one whose body touches ts.draftReceivers.
let rst = rstStart;
while (rst >= 0) {
  const tail = SRC.indexOf(RST_TAIL, rst);
  if (tail > rst && SRC.slice(rst, tail).includes("ts.draftReceivers = {};")) break;
  rst = SRC.indexOf(RST_HEAD, rst + 1);
}
if (rst < 0) throw new Error("Tune Reset handler not found");
const rstTailIdx = SRC.indexOf(RST_TAIL, rst);
const RESET_HANDLER = SRC.slice(rst, rstTailIdx + "  });".length);

const EE1 = "aa:bb:cc:dd:ee:01";
const GH = "google_home_3e759f07-new";
const GHU = "google_home_6f47324e-new";

function baseMaps() {
  return [
    { id: "mA", name: "Lower", floor_id: "downstairs", updated: "t0",
      receivers: [
        { id: "r1", label: "RX1", x: 0.30, y: 0.30, room: "A", source: EE1 },
      ] },
    { id: "mB", name: "Upper", floor_id: "upper", updated: "t0", receivers: [] },
  ];
}
function baseModel() {
  return {
    floors: [{ id: "downstairs", name: "Down" }, { id: "upper", name: "Up" }],
    settings: {},
    map_transforms: {
      mA: { origin_x_m: 1.3, origin_y_m: -0.98, scale_x_m: 18.01,
            scale_y_m: 12.04, rotation_rad: -0.015, shear_rad: 0.008,
            floor_id: "downstairs" },
    },
    scanner_positions_m: {
      [EE1]: { x_m: 5.0, y_m: 5.0, z_m: 1.2, floor_id: "downstairs" },
      "aa:bb:cc:dd:ee:02": { x_m: 9.0, y_m: 9.0, z_m: 2.4, floor_id: "upper" },
    },
  };
}
function scenario(name, maps_list, model) {
  const drag = (ts, mid, src, x, y) => {
    const r = ts.draftReceivers[mid].find(q => q.source === src);
    r.x = x; r.y = y;
    ts.dirtyMaps[mid] = true;
    ts._tuneRev = (ts._tuneRev || 0) + 1;
  };
  const place = (ts, mid, row) => {
    ts.draftReceivers[mid].push(row);
    ts.dirtyMaps[mid] = true;
    ts._tuneRev = (ts._tuneRev || 0) + 1;
  };
  switch (name) {
    case "moved":
      return { opts: {}, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
        place(ts, "mA", { id: "rx_new", label: "Spare Mini", x: 0.0289,
          y: 0.0485, room: "B", source: GH });
      } };
    case "nodrag":
      return { opts: {}, flow: "save", mutate(ts) {} };
    case "missingfabric":
      maps_list.find(m => m.id === "mA").receivers.push(
        { id: "rx_miss", label: "Spare Mini", x: 0.0289, y: 0.0485,
          room: "B", source: GH });
      return { opts: {}, flow: "save", mutate(ts) {} };
    case "stale":
      delete model.map_transforms.mA;
      return { opts: {}, flow: "save", mutate(ts) {
        model.map_transforms.mA = { origin_x_m: 1.3, origin_y_m: -0.98,
          scale_x_m: 18.01, scale_y_m: 12.04, rotation_rad: -0.015,
          shear_rad: 0.008, floor_id: "downstairs" };
        place(ts, "mA", { id: "rx_new", label: "Spare Mini", x: 0.0289,
          y: 0.0485, room: "B", source: GH });
      } };
    case "untouched":
      return { opts: {}, flow: "save", mutate(ts) {
        place(ts, "mA", { id: "rx_new", label: "Spare Mini", x: 0.0289,
          y: 0.0485, room: "B", source: GH });
      } };
    case "unmeasured":
      maps_list.find(m => m.id === "mB").receivers.push(
        { id: "rx_u", label: "New", x: 0.5, y: 0.5, room: "", source: GHU });
      return { opts: {}, flow: "save", mutate(ts) {
        ts.draftReceivers.mB.push({ id: "rx_u", label: "New", x: 0.5,
          y: 0.5, room: "", source: GHU });
        ts.dirtyMaps.mB = true;
        ts._tuneRev = (ts._tuneRev || 0) + 1;
      } };
    case "partial":
      maps_list.find(m => m.id === "mB").receivers.push(
        { id: "rx_u", label: "New", x: 0.5, y: 0.5, room: "", source: GHU });
      return { opts: {}, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
        ts.draftReceivers.mB.push({ id: "rx_u", label: "New", x: 0.5,
          y: 0.5, room: "", source: GHU });
        ts.dirtyMaps.mB = true;
        ts._tuneRev = (ts._tuneRev || 0) + 1;
      } };
    case "conflict":
      model.map_transforms.mB = { origin_x_m: 0, origin_y_m: 0,
        scale_x_m: 10, scale_y_m: 10, rotation_rad: 0, shear_rad: 0,
        floor_id: "upper" };
      maps_list.find(m => m.id === "mB").receivers.push(
        { id: "r1b", label: "RX1", x: 0.9, y: 0.9, room: "C", source: EE1 });
      return { opts: {}, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
        if (!ts.draftReceivers.mB.some(q => q.source === EE1)) {
          ts.draftReceivers.mB.push({ id: "r1b", label: "RX1", x: 0.9,
            y: 0.9, room: "C", source: EE1 });
        }
        const r = ts.draftReceivers.mB.find(q => q.source === EE1);
        r.x = 0.91; r.y = 0.91;
        ts.dirtyMaps.mB = true;
        ts._tuneRev = (ts._tuneRev || 0) + 1;
      } };
    case "missingconflict":
      model.map_transforms.mB = { origin_x_m: 0, origin_y_m: 0,
        scale_x_m: 10, scale_y_m: 10, rotation_rad: 0, shear_rad: 0,
        floor_id: "upper" };
      maps_list.find(m => m.id === "mA").receivers.push(
        { id: "rx_dup", label: "Dup", x: 0.10, y: 0.10, room: "A", source: GH });
      maps_list.find(m => m.id === "mB").receivers.push(
        { id: "rx_dup2", label: "Dup", x: 0.90, y: 0.90, room: "C", source: GH });
      return { opts: {}, flow: "save" };
    case "missingmap":
      return { opts: {}, flow: "save", mutate(ts) {
        ts.draftReceivers.mGhost = [{ id: "rx_g", label: "Ghost", x: 0.5,
          y: 0.5, room: "", source: "aa:bb:cc:dd:ee:09" }];
        ts.dirtyMaps.mGhost = true;
        ts._tuneRev = (ts._tuneRev || 0) + 1;
      } };
    case "singular":
      model.map_transforms.mA = { origin_x_m: 0, origin_y_m: 0,
        scale_x_m: 0, scale_y_m: 12.04, rotation_rad: 0, shear_rad: 0,
        floor_id: "downstairs" };
      return { opts: {}, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
      } };
    case "negscale":
      model.map_transforms.mA = { origin_x_m: 0, origin_y_m: 0,
        scale_x_m: -18.01, scale_y_m: 12.04, rotation_rad: 0, shear_rad: 0,
        floor_id: "downstairs" };
      return { opts: {}, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
      } };
    case "invalid":
      return { opts: {}, flow: "save", mutate(ts) {
        const r = ts.draftReceivers.mA.find(q => q.source === EE1);
        r.x = "not-a-number";
        ts.dirtyMaps.mA = true;
        ts._tuneRev = (ts._tuneRev || 0) + 1;
      } };
    case "reject":
      return { opts: { rejectSource: EE1 }, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
      } };
    case "throw":
      return { opts: { throwSource: GH }, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
        place(ts, "mA", { id: "rx_new", label: "Spare Mini", x: 0.0289,
          y: 0.0485, room: "B", source: GH });
      } };
    case "concurrent":
      return { opts: { concurrentDrag: true }, flow: "save", mutate(ts) {
        drag(ts, "mA", EE1, 0.10, 0.10);
      } };
    case "dedupfail":
      model.map_transforms.mB = { origin_x_m: 1.3, origin_y_m: -0.98,
        scale_x_m: 18.01, scale_y_m: 12.04, rotation_rad: -0.015,
        shear_rad: 0.008, floor_id: "downstairs" };
      maps_list.find(m => m.id === "mB").floor_id = "downstairs";
      return { opts: { rejectSource: GH }, flow: "save", mutate(ts) {
        ts.draftReceivers.mA.push({ id: "rx_dup", label: "Dup", x: 0.10,
          y: 0.10, room: "A", source: GH });
        ts.dirtyMaps.mA = true;
        ts.draftReceivers.mB.push({ id: "rx_dup2", label: "Dup", x: 0.10,
          y: 0.10, room: "C", source: GH });
        ts.dirtyMaps.mB = true;
        ts._tuneRev = (ts._tuneRev || 0) + 1;
      } };
    // Flow scenarios run bespoke callback sequences (see part 3).
    case "flow_saveA_retryB_reset":
    case "flow_reset_dirty":
    case "flow_height_blocked":
    case "flow_height_refresh_fail":
    case "flow_save_refresh_fail":
    case "flow_removal_busy":
    case "flow_removal_reject":
    case "flow_removal_ok":
      return { opts: {}, flow: name };
    default:
      throw new Error("unknown scenario " + name);
  }
}
const maps_list = baseMaps();
const model = baseModel();
const sc = scenario(SCENARIO, maps_list, model);
const FLOW = sc.flow && sc.flow.startsWith("flow_");

const planMod = await import(pathToFileURL(join(VIEWS, "tune_save_plan.js")).href);
const stackMod = await import(pathToFileURL(join(VIEWS, "stack_transform.js")).href);
planMod.tuneSavePlanInit({ mapFracToMetres: stackMod.mapFracToMetres,
  metresToMapFrac: stackMod.metresToMapFrac });
const P = planMod;

const calls = [];
const toasts = [];
const journal = [];
const J = (ev, data) => journal.push({ ev, ...(data || {}) });

const backend = {
  spatial: JSON.parse(JSON.stringify(model.scanner_positions_m)),
  meta: { scanners: Object.fromEntries(
    Object.keys(model.scanner_positions_m).map(s => [s, { room: "r" }])) },
};
let refreshCount = 0;
let swallowRefresh = false;
const deferred = [];
const flush = (n) => new Promise(res => setTimeout(res, n || 0));

const ts = { draftReceivers: {}, dirtyMaps: {},
             selectedRx: null, _tuneRev: 0 };
P.tuneSyncTuneDrafts(ts, maps_list, model.scanner_positions_m,
  model.map_transforms);
if (!FLOW && sc.mutate) sc.mutate(ts);

const mkBtn = () => {
  const b = { disabled: false, textContent: "",
    classList: { add() {}, remove() {} }, style: {}, _fn: null,
    addEventListener(ev, fn) { if (ev === "click") b._fn = fn; } };
  return b;
};
const saveBtn = mkBtn();
const statusLbl = { textContent: "", style: {} };

const ctx = {
  state: { model, maps: { list: maps_list } },
  actions: {
    callWS: async (p) => {
      calls.push(JSON.parse(JSON.stringify(p)));
      if (p.type === "padspan_ha/fabric_scanner_position_set") {
        if (sc.opts.rejectSource === p.source) return { ok: false };
        if (sc.opts.throwSource === p.source) throw new Error("boom");
        if (sc.opts.deferPositions) {
          J("deferred-held", { source: p.source });
          await new Promise((resolve, reject) =>
            deferred.push({ resolve, reject, p }));
        }
        // Backend default: omitted z_m stores 2.4 (model_store path).
        backend.spatial[p.source] = { x_m: p.x_m, y_m: p.y_m,
          z_m: p.z_m !== undefined ? p.z_m :
            ((backend.spatial[p.source] || {}).z_m !== undefined ?
              backend.spatial[p.source].z_m : 2.4),
          floor_id: p.floor_id };
        if (sc.opts.concurrentDrag) {
          sc.opts.concurrentDrag = false;
          const r = ts.draftReceivers.mA.find(q => q.source === EE1);
          r.x = 0.77; r.y = 0.77;
          ts.dirtyMaps.mA = true;
          ts._tuneRev = (ts._tuneRev || 0) + 1;
        }
        return { ok: true };
      }
      if (p.type === "padspan_ha/fabric_scanner_z_set") {
        // Backend rounds to 2dp within 0..100 (model_store z path).
        const zv = Math.round(Math.max(0, Math.min(100, Number(p.z_m))) * 100) / 100;
        backend.spatial[p.source] = { ...(backend.spatial[p.source] || {}), z_m: zv };
        return { ok: true };
      }
      if (p.type === "padspan_ha/fabric_scanner_remove") {
        if (sc.opts.rejectRemove) return { ok: false };
        if (sc.opts.throwRemove) throw new Error("boom-remove");
        if (sc.opts.deferRemove) {
          await new Promise((resolve, reject) =>
            deferred.push({ resolve, reject, p }));
        }
        delete backend.meta.scanners[p.source];
        return { ok: true };
      }
      return { ok: true };
    },
    mapsRefresh: async () => { refreshCount++; },
    modelRefresh: async () => {
      refreshCount++;
      if (swallowRefresh) return;
      ctx.state.model = { ...ctx.state.model,
        scanner_positions_m: JSON.parse(JSON.stringify(backend.spatial)) };
    },
  },
  toast: (m) => { toasts.push(String(m)); },
};

const preamble =
  "const _refreshDirtyLabel = () => {};\n" +
  "const _refreshSVG = () => {};\n" +
  "const _refreshInfo = () => {};\n" +
  "const _refreshRadiosList = () => {};\n" +
  "const _refreshPlaceBanner = () => {};\n";
const shimUrl = pathToFileURL(join(VIEWS, "calibration.js")).href;
function shimmed(src) {
  return "const import_meta_url = " + JSON.stringify(shimUrl) + ";\n" +
    src
      .replaceAll("import.meta.url", "import_meta_url")
      .replaceAll("new URL(import_meta_url).search", JSON.stringify(""))
      .replaceAll("./tune_save_plan.js",
        pathToFileURL(join(VIEWS, "tune_save_plan.js")).href);
}
const PLAN_NAMES = ["tuneDiffMapDraft", "tuneMissingFabricPins",
  "tuneConflictingSources", "tuneReconcileDraft", "tuneSyncTuneDrafts",
  "tuneSnapBaseline", "tuneTryAcquire", "tuneRelease"];
function compileHandler(body, extraParams, extraArgs) {
  const params = ["ts", "maps_list", "ctx", "saveBtn", "statusLbl",
    "calls", "toasts", "refreshCount",
    ...PLAN_NAMES, "mapFracToMetres",
    ...(extraParams || [])];
  const args = [ts, maps_list, ctx, saveBtn, statusLbl, calls, toasts,
    refreshCount, P.tuneDiffMapDraft, P.tuneMissingFabricPins,
    P.tuneConflictingSources, P.tuneReconcileDraft, P.tuneSyncTuneDrafts,
    P.tuneSnapBaseline, P.tuneTryAcquire, P.tuneRelease,
    stackMod.mapFracToMetres, ...(extraArgs || [])];
  return new Function(...params, preamble + body)(...args);
}
function runSave() {
  const body = shimmed(SAVE_HANDLER) +
    "\nreturn (async () => { await saveBtn._fn();\n" +
    "return { payloads: calls.slice(), toasts: toasts.slice(), " +
    "dirty: JSON.parse(JSON.stringify(ts.dirtyMaps)), " +
    "draft: JSON.parse(JSON.stringify(ts.draftReceivers)), " +
    "baseline: JSON.parse(JSON.stringify(ts.editBaseline || {})), " +
    "model: JSON.parse(JSON.stringify(ctx.state.model)), " +
    "refreshCount }; })()";
  return compileHandler(body);
}
function runHeight(source, label, value) {
  const body = shimmed(HEIGHT_HANDLER) +
    "\nreturn (async () => { await zBtn._fn(); return {}; })()";
  const params = ["ts", "maps_list", "ctx", "rx", "zInp",
    "calls", "toasts", "tuneTryAcquire", "tuneRelease"];
  const zInp = { value: String(value) };
  const fn = new Function(...params,
    preamble +
    "const zBtn = { _fn: null, addEventListener(ev, fn) " +
    "{ if (ev === 'click') this._fn = fn; } };\n" +
    "const zRow = { appendChild(){} }, zLbl = {};\n" +
    "const infoCard = { appendChild(){} };\n" +
    body);
  return fn(ts, maps_list, ctx, { source, label }, zInp,
    calls, toasts, P.tuneTryAcquire, P.tuneRelease);
}
function runRemove(mapId, rxId) {
  // The extracted listener body is document-free (verified); only the
  // button registration needs a stub.
  const fn2 = new Function("ts", "maps_list", "ctx", "_selMapId", "_selRxId",
    "calls", "toasts", "tuneTryAcquire", "tuneRelease",
    preamble +
    "const removeBtn = { _fn: null, addEventListener(ev, fn) " +
    "{ if (ev === 'click') this._fn = fn; } };\n" +
    "const infoCard = { appendChild(){} };\n" +
    shimmed(REMOVE_HANDLER).replace(
      "    removeBtn.addEventListener(\"click\", async () => {",
      "    removeBtn.addEventListener(\"click\", async () => {") +
    "\nreturn (async () => { await removeBtn._fn(); return {}; })()");
  return fn2(ts, maps_list, ctx, mapId, rxId,
    calls, toasts, P.tuneTryAcquire, P.tuneRelease);
}
function runReset() {
  const sliders = () => ({ value: "0", textContent: "" });
  const fn2 = new Function("ts", "maps_list", "ctx",
    "calls", "toasts", "tuneSyncTuneDrafts", "tuneTryAcquire", "tuneRelease",
    "gapSlider", "hgSlider", "focusSlider", "focusLbl",
    "gapLbl", "hgLbl", "statusLbl",
    preamble +
    "const resetBtn = { _fn: null, addEventListener(ev, fn) " +
    "{ if (ev === 'click') this._fn = fn; } };\n" +
    "const ctrlRow = { appendChild(){} };\n" +
    "const saveBtn = {}, dirtyLbl = { textContent: '' };\n" +
    shimmed(RESET_HANDLER) +
    "\nreturn (async () => { resetBtn._fn(); return {}; })()");
  return fn2(ts, maps_list, ctx, calls, toasts, P.tuneSyncTuneDrafts,
    P.tuneTryAcquire, P.tuneRelease,
    sliders(), sliders(), sliders(), { textContent: "" },
    { textContent: "" }, { textContent: "" }, statusLbl);
}
function posPosts(list) {
  return list.filter(p => p.type === "padspan_ha/fabric_scanner_position_set");
}
function snap(o) { return JSON.parse(JSON.stringify(o)); }

async function flow_saveA_retryB_reset() {
  // (a) SaveA -> dragB -> ackA -> retry posts B -> Reset/fresh render B.
  const r1e = ts.draftReceivers.mA.find(q => q.source === EE1);
  r1e.x = 0.10; r1e.y = 0.10;
  ts.dirtyMaps.mA = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  sc.opts.deferPositions = true;
  const saveP = runSave();
  await flush(10);
  J("saveA-posts", { n: posPosts(calls).length });
  r1e.x = 0.20; r1e.y = 0.20;   // B lands while A is in flight
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  J("dragB-dirty", { dirty: snap(ts.dirtyMaps) });
  while (deferred.length) deferred.shift().resolve();
  sc.opts.deferPositions = false;
  const r1 = await saveP;
  J("saveA-done", { toasts: r1.toasts.slice(), dirty: snap(ts.dirtyMaps),
    baseline: snap(ts.editBaseline) });
  const nBefore = calls.length;
  const r2 = await runSave();
  J("retry", { posts: posPosts(calls.slice(nBefore)).map(
    p => [p.source, p.x_m, p.y_m]),
    toasts: r2.toasts.slice(), dirty: snap(ts.dirtyMaps) });
  await runReset();
  const ar = ts.draftReceivers.mA.find(q => q.source === EE1);
  J("after-reset", { x: ar && ar.x, y: ar && ar.y,
    dirty: snap(ts.dirtyMaps),
    baseline: snap((ts.editBaseline.mA || {})[EE1] || null) });
  const fresh = { draftReceivers: {}, dirtyMaps: {},
    selectedRx: null, _tuneRev: 0 };
  P.tuneSyncTuneDrafts(fresh, maps_list,
    ctx.state.model.scanner_positions_m || {},
    ctx.state.model.map_transforms || {});
  const fr = fresh.draftReceivers.mA.find(q => q.source === EE1);
  J("fresh-render", { x: fr && fr.x, y: fr && fr.y });
  J("backend", { spatial: snap(backend.spatial) });
}

async function flow_reset_dirty() {
  // (b) Dirty map with a stale pin + a fabric-only entry: Reset retains
  // fabric coords and the fabric-only pin WITH its baseline.
  backend.spatial["fabric-only-src"] = { x_m: 4.0, y_m: 3.0, z_m: 2.0,
    floor_id: "downstairs" };
  backend.meta.scanners["fabric-only-src"] = { room: "r" };
  ctx.state.model.scanner_positions_m = snap(backend.spatial);
  const r1e = ts.draftReceivers.mA.find(q => q.source === EE1);
  r1e.x = 0.77; r1e.y = 0.77;   // unsaved drag (stale vs fabric)
  ts.dirtyMaps.mA = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  await runReset();
  const rows = ts.draftReceivers.mA;
  J("after-reset", {
    ee1: rows.find(q => q.source === EE1),
    fabonly: rows.find(q => q.source === "fabric-only-src"),
    baseline: snap(ts.editBaseline.mA || {}),
    dirty: snap(ts.dirtyMaps) });
}

async function flow_height_blocked() {
  // (c1) Height press with a PENDING refresh: a position Save attempted
  // meanwhile is refused busy with zero posts; then the refresh lands and
  // the height completes; the next position Save carries the new height.
  const r1e = ts.draftReceivers.mA.find(q => q.source === EE1);
  r1e.x = 0.10; r1e.y = 0.10;
  ts.dirtyMaps.mA = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  let releaseRefresh = null;
  const origRefresh = ctx.actions.modelRefresh;
  ctx.actions.modelRefresh = async () => {
    refreshCount++;
    await new Promise(res => { releaseRefresh = res; });
    ctx.state.model = { ...ctx.state.model,
      scanner_positions_m: snap(backend.spatial) };
  };
  const heightP = runHeight(EE1, "RX1", 1.7);
  await flush(10);
  J("height-pending", { heightCalls: calls.filter(
    c => c.type === "padspan_ha/fabric_scanner_z_set").length });
  const rs = await runSave();
  J("save-during-height", { posts: posPosts(rs.payloads).length,
    toasts: rs.toasts.slice() });
  releaseRefresh();
  const hr = await heightP;
  void hr;
  J("height-done", { toasts: toasts.slice(),
    localZ: (ctx.state.model.scanner_positions_m[EE1] || {}).z_m,
    backendZ: (backend.spatial[EE1] || {}).z_m });
  ctx.actions.modelRefresh = origRefresh;
  const r2 = await runSave();
  J("next-save", { posts: posPosts(r2.payloads).map(
    p => [p.source, p.z_m]) });
}

async function flow_height_refresh_fail() {
  // (c2) Height ack with a SWALLOWED refresh: swallowing is enabled
  // BEFORE the height callback runs, so its own modelRefresh is the one
  // swallowed; the acked height must survive locally anyway.
  swallowRefresh = true;
  await runHeight(EE1, "RX1", 1.7);
  swallowRefresh = false;
  J("height-acked", { toasts: toasts.slice(),
    localZ: (ctx.state.model.scanner_positions_m[EE1] || {}).z_m });
  J("after-swallowed-refresh", {
    localZ: (ctx.state.model.scanner_positions_m[EE1] || {}).z_m });
  const r1e = ts.draftReceivers.mA.find(q => q.source === EE1);
  r1e.x = 0.10; r1e.y = 0.10;
  ts.dirtyMaps.mA = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  const r2 = await runSave();
  J("next-save", { posts: posPosts(r2.payloads).map(
    p => [p.source, p.x_m, p.y_m, p.z_m]) });
}

async function flow_save_refresh_fail() {
  // (f) Position ack with a SWALLOWED refresh: the published ack survives
  // in the local model and the draft reconciles to it.
  const r1e = ts.draftReceivers.mA.find(q => q.source === EE1);
  r1e.x = 0.10; r1e.y = 0.10;
  ts.dirtyMaps.mA = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  swallowRefresh = true;
  const r1 = await runSave();
  swallowRefresh = false;
  const acked = posPosts(r1.payloads)[0];
  J("save-done", { toasts: r1.toasts.slice(), dirty: snap(ts.dirtyMaps) });
  J("local-model", {
    local: (ctx.state.model.scanner_positions_m[EE1] || {}),
    acked: acked && [acked.x_m, acked.y_m] });
  const row = ts.draftReceivers.mA.find(q => q.source === EE1);
  J("draft", { x: row && row.x, y: row && row.y });
}

async function flow_removal_busy() {
  // (d1) Removal attempted while a save holds the lock: zero calls,
  // zero mutations, busy toast.
  P.tuneTryAcquire(ts);
  const before = { draft: snap(ts.draftReceivers),
    baseline: snap(ts.editBaseline || {}), dirty: snap(ts.dirtyMaps) };
  await runRemove("mA", "r1");
  P.tuneRelease(ts);
  J("removal-busy", { calls: calls.length, toasts: toasts.slice(),
    unchanged: JSON.stringify({ draft: ts.draftReceivers,
      dirty: ts.dirtyMaps }) === JSON.stringify(
      { draft: before.draft, dirty: before.dirty }),
    baselineUnchanged: JSON.stringify(ts.editBaseline || {}) ===
      JSON.stringify(before.baseline) });
}

async function flow_removal_reject() {
  // (d2) Backend ok:false: zero mutations, failure toast.
  sc.opts.rejectRemove = true;
  const before = { draft: snap(ts.draftReceivers),
    baseline: snap(ts.editBaseline || {}), dirty: snap(ts.dirtyMaps) };
  await runRemove("mA", "r1");
  J("removal-reject", { calls: calls.length, toasts: toasts.slice(),
    draftSame: JSON.stringify(ts.draftReceivers) ===
      JSON.stringify(before.draft),
    dirtySame: JSON.stringify(ts.dirtyMaps) ===
      JSON.stringify(before.dirty) });
}

async function flow_removal_ok() {
  // (d3) Acked removal: targeted cleanup only; an unrelated dirty edit
  // on the SAME map survives with its coords/baseline/dirty intact;
  // metadata removed; SPATIAL ENTRY PERSISTS (backend limitation — the
  // victim therefore starts as an established receiver WITH one).
  backend.spatial["gone-src"] = { x_m: 1.0, y_m: 1.0, z_m: 2.0,
    floor_id: "downstairs" };
  backend.meta.scanners["gone-src"] = { room: "r" };
  ctx.state.model.scanner_positions_m["gone-src"] =
    JSON.parse(JSON.stringify(backend.spatial["gone-src"]));
  const r1e = ts.draftReceivers.mA.find(q => q.source === EE1);
  r1e.x = 0.10; r1e.y = 0.10;   // unrelated dirty edit, same map
  ts.dirtyMaps.mA = true;
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  ts.draftReceivers.mA.push({ id: "rx_gone", label: "Gone", x: 0.5,
    y: 0.5, room: "", source: "gone-src" });
  ts._tuneRev = (ts._tuneRev || 0) + 1;
  await runRemove("mA", "rx_gone");
  const rows = ts.draftReceivers.mA;
  J("removal-ok", { toasts: toasts.slice(),
    ee1: rows.find(q => q.source === EE1),
    goneGone: !rows.some(q => q.source === "gone-src"),
    dirty: snap(ts.dirtyMaps),
    metaGone: !backend.meta.scanners["gone-src"],
    spatialPersists: Boolean(backend.spatial["gone-src"]),
    ee1others: Object.keys(backend.spatial) });
}

const FLOWS = { flow_saveA_retryB_reset, flow_reset_dirty,
  flow_height_blocked, flow_height_refresh_fail, flow_save_refresh_fail,
  flow_removal_busy, flow_removal_reject, flow_removal_ok };

let result;
if (FLOW) {
  try {
    await FLOWS[SCENARIO]();
  } catch (e) {
    J("flow-threw", { error: String((e && e.stack) || e).slice(0, 800) });
  }
  result = { journal };
} else {
  // NOTE: sc.mutate already ran once right after sync init above; it
  // must NOT run again here (place() would push duplicate rows).
  const r = await runSave();
  // Post-save rerender sync, as the live tab does on refresh.
  P.tuneSyncTuneDrafts(ts, maps_list,
    ctx.state.model.scanner_positions_m || {},
    ctx.state.model.map_transforms || {});
  const heightVisible = {};
  for (const src of [GH, EE1]) {
    heightVisible[src] = Boolean(
      (ctx.state.model.scanner_positions_m || {})[src]);
  }
  result = { payloads: calls, toasts, dirty: ts.dirtyMaps,
    draft: ts.draftReceivers, baseline: ts.editBaseline || {},
    refreshCount, heightVisible,
    fabric: backend.spatial, meta: backend.meta.scanners };
}
console.log(JSON.stringify(result));
