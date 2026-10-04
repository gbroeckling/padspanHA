// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): Import, one of the
// Furnish tab's ways to add (P7; contracts §4). A Sweet Home 3D file's doors,
// windows and furniture as a list to choose from: a tick for each, a kind to
// re-map a piece to, and which floor each of the file's levels goes to. Add
// resolves {pieces, openings} (origin "import") for the Furnish tab to drop
// into its draft, unsaved; Cancel resolves null. Nothing here writes: the
// preview command (ws_house3d_import.py) only reads the upload, and only the
// Furnish tab's Save writes the 3D file.
//
// Furniture comes in as kind and size: the builder's own recipe
// (ctx.recipeTools, contracts §3) at the file's size, kept to the builder's
// range; a kind no builder has is a box of its size. Doors and windows go on
// the nearest wall of their floor by the 3D editor's own rules
// (live_aboard_draft.js: the walls the view draws, as runs; a door or window
// stops at a corner and never overlaps one already there), so each is one
// the line tool could have drawn. One keeps the file's width, moved along
// the wall only as far as it must to clear a corner or another opening, and
// is cut only where the free stretch is narrower.

const HOUSE = await import(`./live_aboard_house.js${new URL(import.meta.url).search}`);
const DRAFT = await import(`./live_aboard_draft.js${new URL(import.meta.url).search}`);

export const PREVIEW_TYPE = "padspan_ha/house3d_import_preview";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;     // the room import's limit (ws_floorplan_import.py)
export const SNAP_M = 1.0;                           // a door or window this near a wall goes on it,
const SNAP_COS = Math.cos(25 * Math.PI / 180);       // when it runs about the same way
export const BOX = "other";                          // the builders' own box ("Box" in the Build menu)
export const BOX_COLOR = "#a8a29e";
export const SIZE_MIN_M = 0.05, SIZE_MAX_M = 8;      // a piece's sizes as the 3D file keeps them
export const Z_MAX_M = 20;
export const HIGH_LIGHT_M = 1.5;                     // a lamp this high is a ceiling or wall light
export const LEAVE_OUT = "";                         // a level that goes to no floor
const NO_LEVEL = "";                                 // what the file has on no level
const GROUPS = new Set(["furniture", "device"]);     // the kinds a piece can be re-mapped to
const EPS = 1e-6;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mm = DRAFT.mm;
const keyOf = (levelId) => (levelId === null || levelId === undefined ? NO_LEVEL : String(levelId));
const sizeText = (r) => `${r.width_m.toFixed(2)} × ${r.depth_m.toFixed(2)} × ${r.height_m.toFixed(2)} m`;

function randHex(n){
  const c = globalThis.crypto;
  let s = "";
  for (let i = 0; i < n; i++) {
    const v = c && c.getRandomValues ? c.getRandomValues(new Uint8Array(1))[0] / 256 : Math.random();
    s += Math.floor(v * 16).toString(16);
  }
  return s;
}

// ── The house, as the 3D view reads it ──────────────────────────────────────
/** The house's floors, lowest first, as the 3D view stacks them (or the
 *  floor being furnished alone, when the house names none). */
export function floorsOf(model, current){
  let floors = [];
  try { floors = HOUSE.readFloors(model || {}, (model && model.floors) || []).floors; } catch (_e) { floors = []; }
  if (!floors.length && current && current.id) {
    floors = [{ id: String(current.id), name: String(current.name || current.id), elev: 0, h: HOUSE.FLOOR_TO_FLOOR_M, outdoor: false }];
  }
  return floors;
}
/** The walls the 3D view draws (rooms' outlines, the map's barriers, the
 *  doors and windows already in the 3D file), read once per preview. */
export function readingOf(model, file3d){
  try {
    const d = (file3d && file3d.data) || {};
    return DRAFT.applyOpenings(HOUSE.readingCopy(HOUSE.readHouse(model || {}, (model && model.floors) || [], {}, null)),
      DRAFT.ownedOf(d).openings);
  } catch (_e) { return null; }
}
/** One floor's walls as the line tool's runs: {fl, ceil, runs: [{run, stops, ops}]}. */
export function wallsOf(reading, floorId){
  const fl = reading ? reading.byId.get(reading.canon(floorId)) : null;
  const per = fl ? reading.perFloor.get(fl) : null;
  if (!per) return null;
  const pcs = per.pieces;
  return { fl, ceil: fl.h - HOUSE.SLAB_T,
           runs: DRAFT.wallRuns(pcs).map(run => ({ run, stops: DRAFT.runStops(run, pcs), ops: DRAFT.runOpenings(run) })) };
}

// ── Which floor each level goes to ──────────────────────────────────────────
/** To start with: one level (or none), the floor being furnished; several,
 *  the indoor floor at the nearest height, each counted from its own lowest.
 *  What is on no level of a file with levels: the floor being furnished. */
export function defaultFloors(keys, levels, floors, current){
  const out = {};
  const cur = floors.find(f => current && f.id === String(current.id)) || floors.find(f => !f.outdoor) || floors[0] || null;
  const curId = cur ? cur.id : LEAVE_OUT;
  if (keys.length <= 1) { for (const k of keys) out[k] = curId; return out; }
  const indoor = floors.filter(f => !f.outdoor), pool = indoor.length ? indoor : floors;
  const elevOf = new Map((levels || []).map(l => [String(l.id), num(l.elevation_m) ?? 0]));
  const named = keys.filter(k => k !== NO_LEVEL);
  const lvLow = named.length ? Math.min(...named.map(k => elevOf.get(k) ?? 0)) : 0;
  const flLow = pool.length ? Math.min(...pool.map(f => f.elev)) : 0;
  for (const k of keys) {
    if (k === NO_LEVEL) { out[k] = curId; continue; }
    const rel = (elevOf.get(k) ?? 0) - lvLow;
    let best = null;
    for (const f of pool) { const d = Math.abs(f.elev - flLow - rel); if (!best || d < best.d - 1e-9) best = { f, d }; }
    out[k] = best ? best.f.id : curId;
  }
  return out;
}

// ── A door or window onto a wall ────────────────────────────────────────────
/** One door or window of the file onto the nearest wall of a floor (W,
 *  wallsOf), about as parallel and within SNAP_M: {rec, width, cut, moved}
 *  — rec the 3D file's own record on that wall, the file's heights kept
 *  under the floor's ceiling — or {why} it cannot go there. `taken`: what
 *  this import has placed already, per run (Map), so two never overlap. */
export function placeOpening(o, W, taken){
  if (!W || !W.runs.length) return { why: "no walls on that floor" };
  const a = o.a_m, b = o.b_m, w = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(w > 0)) return { why: "it has no width" };
  const ux = (b[0] - a[0]) / w, uy = (b[1] - a[1]) / w, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  let best = null;
  for (const R of W.runs) {
    if (Math.abs(ux * R.run.ux + uy * R.run.uy) < SNAP_COS) continue;
    const d = DRAFT.runDist(R.run, mx, my);
    if (d <= SNAP_M && (!best || d < best.d)) best = { R, d };
  }
  if (!best) return { why: `no wall within ${SNAP_M} m` };
  const { run, stops } = best.R, mine = taken.get(run) || [];
  const ops = [...best.R.ops, ...mine];
  const tc = DRAFT.tOn(run, mx, my);
  if (DRAFT.insideOpening(ops, tc)) return { why: "a door or window is already there" };
  // The free stretch round its middle: to the corner or opening each way.
  const lo = DRAFT.spanOf(run, stops, ops, tc, run.t0 - 1).t0, hi = DRAFT.spanOf(run, stops, ops, tc, run.t1 + 1).t1;
  let t0 = lo, t1 = hi;
  if (hi - lo >= w) { t0 = clamp(tc - w / 2, lo, hi - w); t1 = t0 + w; }
  if (t1 - t0 < DRAFT.minWidth(o.kind) - EPS) return { why: `too little wall there for a ${o.kind}` };
  const rec = DRAFT.newOpening(o.kind, W.fl.id, DRAFT.pointOf(run, t0), DRAFT.pointOf(run, t1), W.ceil);
  Object.assign(rec, DRAFT.openingHeights(o.kind === "door" ? { kind: "door", head_m: o.head_m }
    : { kind: "window", sill_m: o.sill_m, head_m: o.head_m }, W.ceil));
  mine.push({ lo: t0, hi: t1, id: `import:${mine.length}`, kind: o.kind });
  taken.set(run, mine);
  return { rec, width: t1 - t0, cut: t1 - t0 < w - 0.005, moved: Math.abs((t0 + t1) / 2 - tc) };
}

// ── A piece: kind and size ──────────────────────────────────────────────────
/** The kinds a piece can be: the builders' furniture and device pieces, in
 *  their menu order, by name; then Box. */
export function kindChoices(tools){
  const F = (tools && tools.FURNITURE) || {};
  const order = Array.isArray(tools && tools.FURNITURE_KINDS) ? tools.FURNITURE_KINDS : Object.keys(F);
  const out = [];
  for (const k of order) {
    const d = F[k];
    if (k !== BOX && d && GROUPS.has(d.group)) out.push({ kind: k, name: String(d.name || k) });
  }
  out.push({ kind: BOX, name: String((F[BOX] && F[BOX].name) || "Box") });
  return out;
}
/** A recipe of `kind` at the file's size: the builder's defaults kept to
 *  its range (clampRecipe; the builders' own box too), else a plain box of
 *  that size; every size within what the 3D file keeps. */
export function recipeFor(kind, size, tools){
  let r = null;
  const d = tools && tools.FURNITURE && tools.FURNITURE[kind];
  if (d && typeof tools.defaultRecipe === "function") {
    try {
      r = { ...tools.defaultRecipe(kind), width_m: size.w, depth_m: size.d, height_m: size.h };
      if (typeof tools.clampRecipe === "function") r = tools.clampRecipe(r);
    } catch (_e) { r = null; }
  }
  if (!r || typeof r !== "object") r = { kind: BOX, params: {}, colors: [BOX_COLOR], width_m: size.w, depth_m: size.d, height_m: size.h };
  for (const k of ["width_m", "depth_m", "height_m"]) r[k] = mm(clamp(num(r[k]) ?? SIZE_MIN_M, SIZE_MIN_M, SIZE_MAX_M));
  return r;
}
/** A candidate piece as the Furnish tab gets it: kind and size, its floor,
 *  the file's place, height in the room and turn. */
export function pieceFor(cand, kind, floorId, tools){
  const r0 = (cand && cand.recipe) || {};
  const size = { w: num(r0.width_m) ?? 0.5, d: num(r0.depth_m) ?? 0.5, h: num(r0.height_m) ?? 0.5 };
  const turn = num(cand.rotation) ?? 0;
  return { id: cand.id, recipe: recipeFor(kind, size, tools), origin: "import",
           label: String(cand.label || "").slice(0, 60), library_id: null, submission_id: null,
           floor_id: floorId, x_m: mm(num(cand.x_m) ?? 0), y_m: mm(num(cand.y_m) ?? 0),
           z_m: mm(clamp(num(cand.z_m) ?? 0, 0, Z_MAX_M)), rotation: mm(((turn % 360) + 360) % 360) % 360,
           entity_id: null, entity_reg_id: null };
}

// ── The choice: the preview as the person sets it ───────────────────────────
/** Everything the preview list shows and the person sets, from the preview
 *  command's answer, the house (model_get) and the 3D file (house3d_get):
 *  {levels, rep, cands, floors, keys, floorOf, reading, kinds, pick, kind,
 *  placed}. A candidate's id that is already in the 3D file gets a new one. */
export function choiceOf(prev, model, file3d, current, tools){
  const levels = Array.isArray(prev && prev.levels) ? prev.levels : [];
  const rep0 = (prev && prev.report) || {};
  const rep = { pieces: { ...(rep0.pieces || {}) }, openings: { ...(rep0.openings || {}) },
                skipped: Array.isArray(rep0.skipped) ? rep0.skipped : [], warnings: Array.isArray(rep0.warnings) ? rep0.warnings : [] };
  const d = (file3d && file3d.data) || {};
  const inFile = new Set([...Object.keys(d.pieces || {}), ...Object.keys(d.openings || {})]);
  const cands = { pieces: {}, openings: {} };
  for (const [sec, mk] of [["pieces", () => `fur_${randHex(8)}`], ["openings", null]]) {
    for (const [id0, c] of Object.entries((prev && prev[sec]) || {})) {
      let id = id0;
      while (inFile.has(id) || cands.pieces[id] || cands.openings[id]) {
        id = mk ? mk() : DRAFT.newOpeningId(c.kind === "door" ? "door" : "window");
      }
      cands[sec][id] = sec === "pieces" ? { ...c, id } : { ...c };
      if (id !== id0) { rep[sec][id] = rep[sec][id0]; delete rep[sec][id0]; }
    }
  }
  const floors = floorsOf(model, current);
  const order = new Map(levels.map((l, i) => [String(l.id), i]));
  const used = new Set();
  for (const sec of ["pieces", "openings"]) for (const id of Object.keys(cands[sec])) used.add(keyOf((rep[sec][id] || {}).level_id));
  const keys = [...used].sort((p, q) => (order.get(p) ?? -1) - (order.get(q) ?? -1));
  const kinds = kindChoices(tools), known = new Set(kinds.map(k => k.kind));
  const pick = {}, kind = {};
  for (const [id, c] of Object.entries(cands.pieces)) {
    const k = c.recipe && c.recipe.kind;
    kind[id] = known.has(k) ? k : BOX;
    pick[id] = !(kind[id] === "lamp" && (num(c.z_m) ?? 0) >= HIGH_LIGHT_M);
  }
  for (const id of Object.keys(cands.openings)) pick[id] = true;
  const S = { levels, rep, cands, floors, keys, floorOf: defaultFloors(keys, levels, floors, current),
              reading: readingOf(model, file3d), kinds, pick, kind, kind0: { ...kind }, placed: {} };
  placeAll(S);
  return S;
}
const levelOf = (S, sec, id) => keyOf((S.rep[sec][id] || {}).level_id);
/** Each door and window placed again on the floors as now chosen. */
export function placeAll(S){
  const placed = {}, taken = new Map(), walls = new Map();
  for (const [id, o] of Object.entries(S.cands.openings)) {
    const fid = S.floorOf[levelOf(S, "openings", id)];
    if (!fid) { placed[id] = { why: "its level is left out", out: true }; continue; }
    if (!walls.has(fid)) walls.set(fid, wallsOf(S.reading, fid));
    placed[id] = S.reading ? placeOpening(o, walls.get(fid), taken) : { why: "the house's walls could not be read" };
  }
  S.placed = placed;
  return placed;
}
/** What Add hands the Furnish tab: the ticked pieces and placed doors and
 *  windows, on the floors chosen. */
export function chosenOf(S, tools){
  const pieces = {}, openings = {};
  for (const [id, c] of Object.entries(S.cands.pieces)) {
    const fid = S.floorOf[levelOf(S, "pieces", id)];
    if (S.pick[id] && fid) pieces[id] = pieceFor(c, S.kind[id], fid, tools);
  }
  for (const id of Object.keys(S.cands.openings)) {
    const p = S.placed[id];
    if (S.pick[id] && p && p.rec) openings[id] = { ...p.rec };
  }
  return { pieces, openings };
}

// ── The page ────────────────────────────────────────────────────────────────
const CSS = {
  wrap: "display:flex;flex-direction:column;gap:10px;max-width:760px;font-size:13px;line-height:1.4",
  title: "font-weight:600;font-size:15px",
  row: "display:flex;align-items:center;gap:8px;flex-wrap:wrap",
  item: "display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;padding:5px 2px;border-top:1px solid var(--divider-color, rgba(127,127,127,.25))",
  name: "flex:1 1 150px;min-width:0;overflow-wrap:anywhere",
  head: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600;margin-top:4px",
  note: "font-size:12px",
  bad: "font-size:12px;color:var(--error-color, #db4437)",
  sel: "width:auto;min-width:8em;max-width:100%;margin-top:0;padding:6px 8px",   // beside its label (the panel's selects are full width)
};
function h(tag, props, kids){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "style") n.style.cssText = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "textContent" || k === "value" || k === "checked" || k === "disabled" || k === "selected") n[k] = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(kids === undefined ? [] : kids)) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}
function readBase64(file){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1] || "");
    fr.onerror = () => rej(fr.error || new Error("the file could not be read"));
    fr.readAsDataURL(file);
  });
}

/** contracts §4: pick a .sh3d, choose from the preview, and resolve the
 *  accepted {pieces, openings}; Cancel (before or after the preview)
 *  resolves null and writes nothing. ctx: {el, callWS, toast, floor,
 *  recipeTools, …}. */
export function importFlow(ctx){
  return new Promise((resolve) => {
    const el = ctx && ctx.el;
    if (!el) { resolve(null); return; }
    const call = (msg) => (typeof ctx.callWS === "function" ? ctx.callWS(msg) : ctx.wsCall(msg));
    const toast = (t, bad) => { try { if (typeof ctx.toast === "function") ctx.toast(t, !!bad); } catch (_e) { /* the page's own */ } };
    const tools = ctx.recipeTools || null;
    let S = null, fileName = "", token = 0, done = false;
    const finish = (v) => { if (done) return; done = true; token++; el.replaceChildren(); resolve(v); };
    const input = h("input", { type: "file", accept: ".sh3d", style: "display:none", onchange: () => pick() });
    const screen = (kids) => el.replaceChildren(h("div", { class: "la-import", style: CSS.wrap }, kids));
    const cancelBtn = () => h("button", { class: "btn inline", onclick: () => finish(null) }, "Cancel");
    const chooseBtn = (label, primary) => h("button", { class: "btn inline" + (primary ? " primary" : ""), onclick: () => input.click() }, label);

    function start(msg, bad){
      screen([
        h("div", { style: CSS.title }, "Import from Sweet Home 3D"),
        h("div", { class: "muted", style: CSS.note },
          "Doors, windows and furniture from a .sh3d file. Furniture comes in as its kind and size. You choose what to add; nothing is saved until you press Save."),
        msg ? h("div", { role: "alert", style: bad ? CSS.bad : CSS.note }, msg) : null,
        h("div", { style: CSS.row }, [chooseBtn("Choose a .sh3d file", true), cancelBtn(), input]),
      ]);
    }
    async function pick(){
      const file = input.files && input.files[0];
      input.value = "";
      if (!file || done) return;
      if (num(file.size) !== null && file.size > MAX_FILE_BYTES) {
        start(`That file is over ${MAX_FILE_BYTES / (1024 * 1024)} MB, the most an import takes.`, true);
        return;
      }
      const mine = ++token;
      screen([h("div", { style: CSS.title }, "Import from Sweet Home 3D"),
              h("div", { class: "muted", style: CSS.note }, `Reading ${file.name}…`), h("div", { style: CSS.row }, [cancelBtn()])]);
      try {
        const b64 = await readBase64(file);
        if (mine !== token) return;
        const [prev, model, file3d] = await Promise.all([
          call({ type: PREVIEW_TYPE, sh3d_base64: b64 }),
          Promise.resolve().then(() => call({ type: "padspan_ha/model_get" })).catch(() => null),
          Promise.resolve().then(() => call({ type: "padspan_ha/house3d_get" })).catch(() => null),
        ]);
        if (mine !== token) return;
        fileName = String(file.name || "");
        S = choiceOf(prev, model, file3d, ctx.floor, tools);
        render();
      } catch (err) {
        if (mine !== token) return;
        const m = (err && (err.message || err.code)) || String(err);
        start(`Could not import that file: ${m}`, true);
        toast(`Import failed: ${m}`, true);
      }
    }

    // ── the preview list ──
    const floorName = (fid) => { const f = S.floors.find(x => x.id === fid); return f ? f.name : fid; };
    const levelName = (k) => {
      if (k !== NO_LEVEL) { const l = S.levels.find(x => String(x.id) === k); return l ? String(l.name || k) : k; }
      return S.levels.length ? "Not on a level" : "Everything in the file";
    };
    const count = () => { const r = chosenOf(S, tools); return Object.keys(r.pieces).length + Object.keys(r.openings).length; };
    let addBtn = null;
    const recount = () => {
      const n = count();
      addBtn.textContent = n ? `Add ${n} to the house` : "Add to the house";
      addBtn.disabled = !n;
    };
    function tick(id, on){
      S.pick[id] = on;
      recount();
    }
    function openingRow(id){
      const o = S.cands.openings[id], p = S.placed[id] || {}, r = S.rep.openings[id] || {};
      const ok = !!p.rec;
      const cb = h("input", { type: "checkbox", checked: ok && !!S.pick[id], disabled: !ok, "aria-label": "Add this one",
                              onchange: () => tick(id, cb.checked) });
      const what = `${o.kind === "door" ? "Door" : "Window"} ${(ok ? p.width : (r.width_m || 0)).toFixed(2)} m`;
      const note = !ok ? p.why
        : p.cut ? `cut to ${p.width.toFixed(2)} m to fit the wall, on ${floorName(p.rec.floor_id)}`
        : `on ${floorName(p.rec.floor_id)}`;
      return h("label", { style: CSS.item, "data-id": id }, [cb,
        h("span", { style: CSS.name }, [h("b", {}, what), r.name && !/^(door|window)$/i.test(r.name.trim()) ? ` · ${r.name}` : ""]),
        h("span", { class: ok ? "muted" : "", style: ok ? CSS.note : CSS.bad }, note)]);
    }
    function pieceRow(id){
      const c = S.cands.pieces[id], r = S.rep.pieces[id] || {}, fid = S.floorOf[levelOf(S, "pieces", id)];
      const ok = !!fid, rec = recipeFor(S.kind[id], { w: c.recipe.width_m, d: c.recipe.depth_m, h: c.recipe.height_m }, tools);
      const cb = h("input", { type: "checkbox", checked: ok && !!S.pick[id], disabled: !ok, "aria-label": "Add this one",
                              onchange: () => tick(id, cb.checked) });
      const sel = h("select", { style: CSS.sel, "aria-label": "Kind", disabled: !ok, onchange: () => {
        S.kind[id] = sel.value;
        if (row.parentNode) row.parentNode.replaceChild(pieceRow(id), row);
        recount();
      } }, S.kinds.map(k => h("option", { value: k.kind, selected: k.kind === S.kind[id] }, k.name)));
      sel.value = S.kind[id];
      const file = { width_m: c.recipe.width_m, depth_m: c.recipe.depth_m, height_m: c.recipe.height_m };
      const kept = ["width_m", "depth_m", "height_m"].some(k => Math.abs(rec[k] - file[k]) > 0.005);
      // Why it is this kind: while it is still the kind it came in as.
      const why = S.kind[id] !== S.kind0[id] ? null
        : r.kind && r.kind !== BOX && S.kind[id] === BOX ? `no builder for a ${r.kind} yet, so a box`
        : S.kind[id] === BOX ? (r.word ? `no builder for a ${r.word}, so a box of its size` : "no match, so a box of its size")
        : r.word ? `by the word “${r.word}”` : null;
      const notes = [!ok ? "its level is left out" : null, why,
        kept ? `the file has ${sizeText(file)}` : null,
        ok && S.kind[id] === "lamp" && (num(c.z_m) ?? 0) >= HIGH_LIGHT_M ? "a ceiling or wall light; the map's own lights already show" : null,
      ].filter(Boolean).join(" · ");
      const kindName = (S.kinds.find(k => k.kind === S.kind[id]) || { name: "Piece" }).name;
      const row = h("div", { style: CSS.item, "data-id": id }, [
        h("label", { style: "display:flex;align-items:center;gap:6px;" + CSS.name }, [cb, h("b", {}, r.name || c.label || kindName)]),
        sel, h("span", {}, sizeText(rec)),
        notes ? h("span", { class: "muted", style: "flex-basis:100%;" + CSS.note }, notes) : null,
      ]);
      return row;
    }
    function section(title, ids, rowOf){
      if (!ids.length) return null;
      const set = (on) => { for (const id of ids) S.pick[id] = on; render(); };
      return h("div", {}, [
        h("div", { style: CSS.head }, [h("span", {}, `${title} (${ids.length})`),
          h("button", { class: "btn inline", onclick: () => set(true) }, "All"),
          h("button", { class: "btn inline", onclick: () => set(false) }, "None")]),
        ...ids.map(rowOf),
      ]);
    }
    function render(){
      const pIds = Object.keys(S.cands.pieces), oIds = Object.keys(S.cands.openings);
      const doors = oIds.filter(id => S.cands.openings[id].kind === "door").length;
      const found = [`${pIds.length} ${pIds.length === 1 ? "piece" : "pieces"}`,
        `${doors} ${doors === 1 ? "door" : "doors"}`, `${oIds.length - doors} ${oIds.length - doors === 1 ? "window" : "windows"}`];
      const opts = [...S.floors.map(f => ({ id: f.id, name: f.name })), { id: LEAVE_OUT, name: "Leave out" }];
      const floorsBlock = S.keys.length ? h("div", {}, [
        h("div", { style: CSS.head }, S.keys.length > 1 ? "Which floor each level goes on" : "Which floor it goes on"),
        ...S.keys.map(k => {
          const sel = h("select", { style: CSS.sel, "aria-label": `Floor for ${levelName(k)}`, onchange: () => {
            S.floorOf[k] = sel.value;
            placeAll(S);
            render();
          } }, opts.map(o => h("option", { value: o.id, selected: o.id === S.floorOf[k] }, o.name)));
          sel.value = S.floorOf[k];
          return h("div", { style: CSS.item, "data-level": k }, [h("span", { style: CSS.name }, levelName(k)), sel]);
        }),
      ]) : null;
      const left = [...S.rep.skipped.map(s => `${s.name}: ${s.why}`), ...S.rep.warnings];
      addBtn = h("button", { class: "btn inline primary", onclick: () => { if (count()) finish(chosenOf(S, tools)); } }, "Add");
      screen([
        h("div", { style: CSS.title }, "Import from Sweet Home 3D"),
        h("div", {}, [h("b", {}, fileName || "The file"), `: ${found.join(", ")}.`]),
        !pIds.length && !oIds.length ? h("div", { role: "alert", style: CSS.bad }, "Nothing in this file can be added.") : null,
        floorsBlock,
        section("Doors and windows", oIds, openingRow),
        section("Furniture", pIds, pieceRow),
        left.length ? h("details", {}, [h("summary", {}, `Left out or noted (${left.length})`),
          ...left.map(t => h("div", { class: "muted", style: CSS.note }, t))]) : null,
        h("div", { style: CSS.row }, [addBtn, cancelBtn(), chooseBtn("Choose another file", false), input]),
        h("div", { class: "muted", style: CSS.note }, "They go into the house unsaved, with the rest of your changes; Save keeps them."),
      ]);
      recount();
    }
    start(null, false);
  });
}
