// Tune receiver save plan — pure, testable, no DOM.
//
// The Tune tab edits map-fraction drafts; the fabric holds authoritative
// metres. This module is the narrow bridge between the two. It takes no
// ctx, touches no DOM, and posts nothing — the view calls it, then issues
// the resulting payloads.
//
// EDIT INTENT = DIFFERENCE FROM BASELINE. Every draft row carries the
// coordinates it had when last synced (seeded, reconciled, or saved):
// ts.editBaseline[mapId][source] = {x, y}. A row is an edit candidate
// only when its current fractions differ bitwise from its baseline, or
// when its pin is missing from the fabric entirely (placed-but-never-
// saved). A stale pin nobody touched compares equal to its baseline and
// NEVER posts, however far it lies from the fabric — disagreement with
// the fabric is not an edit. Reconcile and save both advance the
// baseline, so production-rounded fractions can never drift past the
// save and post spuriously.
//
// Canonical gates mirror the backend exactly (fabric_truth.
// placement_is_readable): scales present and POSITIVE with >=1mm reach on
// both axes, forward probe finite, inverse finite. Conversion functions
// are INJECTED by the caller (calibration.js imports them from
// stack_transform.js). This module must not import photo-adjacent modules
// itself: the photo-divorce guard certifies every non-editor view
// photo-free. The injected functions are the canonical shared
// implementation — never a copy.
let _fracToM = null;
let _mToFrac = null;
export function tuneSavePlanInit(conv) {
  _fracToM = conv.mapFracToMetres;
  _mToFrac = conv.metresToMapFrac;
}
function mapFracToMetres(tf, fx, fy) {
  if (typeof _fracToM !== "function") return null;
  return _fracToM(tf, fx, fy);
}
function metresToMapFrac(tf, xm, ym) {
  if (typeof _mToFrac !== "function") return null;
  return _mToFrac(tf, xm, ym);
}

// Same-session mutual exclusion for fabric writers (position save, height
// save, removal). Single-threaded JS: a boolean is sufficient. Acquire
// BEFORE the first request; release unconditionally (finally). A caller
// that finds it held must NOT post — toast busy and return, changing
// nothing. There is deliberately no queue: a save completes in ~100ms and
// a queued height would land on a baseline it never saw.
export function tuneTryAcquire(ts) {
  if (!ts) return false;
  if (ts._tuneBusy) return false;
  ts._tuneBusy = true;
  return true;
}
export function tuneRelease(ts) {
  if (ts) ts._tuneBusy = false;
}

// A placement the backend can actually convert through: scales present
// and POSITIVE (backend requires sx >= 1e-3 and sy*|cos σ| >= 1e-3 — a
// negative scale is unreadable, not mirrored), forward probe finite and
// the inverse finite (singular scale / quarter-turn lean refuse).
export function tunePlacementReadable(tf) {
  if (!tf || typeof tf !== "object") return false;
  const sx = Number(tf.scale_x_m);
  const sy = Number(tf.scale_y_m);
  if (!(sx >= 1e-3)) return false;
  const sig = Number(tf.shear_rad ?? 0);
  if (!Number.isFinite(sig)) return false;
  if (!(sy * Math.abs(Math.cos(sig)) >= 1e-3)) return false;
  const rot = Number(tf.rotation_rad ?? 0);
  if (!Number.isFinite(rot)) return false;
  const probe = mapFracToMetres(tf, 1.0, 1.0);
  if (!probe || !Number.isFinite(probe[0]) || !Number.isFinite(probe[1])) return false;
  const back = metresToMapFrac(tf, probe[0], probe[1]);
  if (!back || !Number.isFinite(back[0]) || !Number.isFinite(back[1])) return false;
  return true;
}

function _finiteNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Seed drafts from stored map pins. PURE construction — no baselines, no
// reconcile. The sync routine below owns both.
export function tuneSeedDrafts(mapsList) {
  const drafts = {};
  for (const m of mapsList || []) {
    drafts[m.id] = (m.receivers || []).map(r => ({
      id: r.id || r.source || ("rx_" + Math.random().toString(16).slice(2, 10)),
      label: r.label || "", x: Number(r.x || 0), y: Number(r.y || 0),
      room: r.room || "", source: r.source || "",
    }));
  }
  return drafts;
}

export function tuneMapsStamp(mapsList) {
  return (mapsList || []).map(m =>
    `${m.id}:${m.updated || ""}:${(m.receivers || []).length}`).join("|");
}

// Baseline snapshot of one map's draft: addressed sources to the exact
// fractions last synced (seeded, reconciled, or acknowledged on save).
// Exported so the save handler advances exactly the acknowledged rows.
export function tuneSnapBaseline(draftRows) {
  const base = {};
  for (const r of draftRows || []) {
    const src = (r && r.source) || "";
    // Unaddressable rows cannot post; they carry no baseline either.
    if (!src || base[src]) continue;
    base[src] = { x: r.x, y: r.y };
  }
  return base;
}
function _snapBaseline(draftRows) {
  return tuneSnapBaseline(draftRows);
}

// Single authoritative draft-sync, shared by initial render and Reset.
//   - empty drafts → seed everything, baseline = seeded coords, then
//     reconcile clean maps (baseline follows reconciled coords);
//   - maps metadata changed → reseed CLEAN maps only (dirty drafts keep
//     both their coords AND their baselines), drop dead maps;
//   - model data changed → reconcile clean maps (a model arriving after
//     the initial map-seeded render is the normal first-paint order).
// Reconcile failures leave map as seeded with a seeded baseline; dirty
// maps are never reseeded and never reconciled here.
export function tuneSyncTuneDrafts(ts, mapsList, fabricPositions, transforms) {
  if (!ts) return;
  const fab = fabricPositions || {};
  const tfs = transforms || {};
  ts.draftReceivers = ts.draftReceivers || {};
  ts.dirtyMaps = ts.dirtyMaps || {};
  ts.editBaseline = ts.editBaseline || {};
  const stamp = tuneMapsStamp(mapsList);
  const modelStamp = JSON.stringify(fab) + "|" + JSON.stringify(tfs);
  const fresh = Object.keys(ts.draftReceivers).length === 0;
  if (fresh) {
    ts.draftReceivers = tuneSeedDrafts(mapsList);
    for (const m of mapsList || []) {
      ts.editBaseline[m.id] = _snapBaseline(ts.draftReceivers[m.id]);
    }
  } else if (stamp !== ts._mapsStamp) {
    for (const m of mapsList || []) {
      if (ts.dirtyMaps[m.id]) continue;
      ts.draftReceivers[m.id] = tuneSeedDrafts([m])[m.id];
      ts.editBaseline[m.id] = _snapBaseline(ts.draftReceivers[m.id]);
    }
    for (const id of Object.keys(ts.draftReceivers)) {
      if (!(mapsList || []).some(m => m.id === id)) {
        delete ts.draftReceivers[id];
        delete ts.editBaseline[id];
      }
    }
  }
  if (fresh || stamp !== ts._mapsStamp || modelStamp !== ts._modelStamp) {
    for (const m of mapsList || []) {
      if (ts.dirtyMaps[m.id]) continue;
      try {
        const next = tuneReconcileDraft(
          m, ts.draftReceivers[m.id] || [], fab, tfs, false);
        if (next) {
          ts.draftReceivers[m.id] = next;
          ts.editBaseline[m.id] = _snapBaseline(next);
        }
      } catch (e) { /* best-effort; seeded drafts stay */ }
    }
  }
  ts._mapsStamp = stamp;
  ts._modelStamp = modelStamp;
}

// Diff one map's draft for the save. A row is a candidate ONLY when its
// fractions differ bitwise from its baseline (an actual drag/place this
// session) or — with includeMissing — its pin is absent from the fabric
// (placed-but-never-saved). Untouched rows never post, however stale.
// Returns { writes: [{source,x_m,y_m,floor_id,z_m?}], skipped: [""],
// invalid: [source…], refused: bool }.
//   invalid — addressed rows (have a source) whose coords will not coerce
//     to finite numbers: failed pending work, NOT a silent skip.
// z_m carries the stored height for existing entries (preserved, never
// restated from the draft — drafts have no z); new entries omit z_m so
// the backend default applies.
export function tuneDiffMapDraft(mapObj, draftRows, fabricPositions, transforms,
    baselineMap, includeMissing) {
  const tf = transforms ? transforms[mapObj.id] : null;
  if (!tunePlacementReadable(tf)) return { writes: [], skipped: [], invalid: [], refused: true };
  const writes = [];
  const skipped = [];
  const invalid = [];
  const seen = new Set();
  const fab = fabricPositions || {};
  const base = baselineMap || {};
  for (const r of draftRows || []) {
    const src = (r && r.source) || "";
    if (!src) { skipped.push(src); continue; }
    if (seen.has(src)) continue;
    seen.add(src);
    const b = base[src];
    const changed = !b || b.x !== r.x || b.y !== r.y;
    const missing = includeMissing && !fab[src];
    if (!changed && !missing) continue;
    const fx = _finiteNum(r.x), fy = _finiteNum(r.y);
    if (fx === null || fy === null) { invalid.push(src); continue; }
    const m = mapFracToMetres(tf, fx, fy);
    if (!m || !Number.isFinite(m[0]) || !Number.isFinite(m[1])) {
      return { writes: [], skipped, invalid, refused: true };
    }
    const prev = fab[src];
    const w = { source: src, x_m: Math.round(m[0] * 1000) / 1000,
      y_m: Math.round(m[1] * 1000) / 1000, floor_id: mapObj.floor_id || "main" };
    if (prev && Number.isFinite(Number(prev.z_m))) w.z_m = Number(prev.z_m);
    writes.push(w);
  }
  return { writes, skipped, invalid, refused: false };
}

// Eligible missing-fabric pins across ALL maps: draft receivers with a
// source, valid coords, absent from the fabric, on a readable placement.
// Returns EVERY occurrence [{mapId, source}] — dedup happens AFTER
// conflict detection, so the same missing source on two differently-
// placed maps is refused on both instead of silently writing the first.
export function tuneMissingFabricPins(mapsList, draftReceivers, fabricPositions, transforms) {
  const out = [];
  const fab = fabricPositions || {};
  for (const m of mapsList || []) {
    if (!tunePlacementReadable(transforms ? transforms[m.id] : null)) continue;
    for (const r of (draftReceivers || {})[m.id] || []) {
      const src = (r && r.source) || "";
      if (!src || fab[src]) continue;
      if (_finiteNum(r.x) === null || _finiteNum(r.y) === null) continue;
      out.push({ mapId: m.id, source: src });
    }
  }
  return out;
}

// Conflicting writes for one source (different metres or floor beyond
// tolerance). Returns [source…]; the save refuses those sources everywhere
// rather than letting last-write-win silently.
export function tuneConflictingSources(perMapWrites, tolM) {
  const tol = (tolM !== undefined) ? tolM : 0.0005;
  const bySrc = new Map();
  const bad = [];
  for (const w of perMapWrites || []) {
    const prev = bySrc.get(w.source);
    if (!prev) { bySrc.set(w.source, w); continue; }
    const dx = Math.abs(prev.x_m - w.x_m), dy = Math.abs(prev.y_m - w.y_m);
    const sameFloor = String(prev.floor_id) === String(w.floor_id);
    if ((dx > tol || dy > tol || !sameFloor) && !bad.includes(w.source)) bad.push(w.source);
  }
  return bad;
}

// Reconcile a CLEAN draft map from authoritative fabric: project every
// fabric entry inside this map's footprint back to fractions, preserving
// draft metadata (id/label/room) by source match. Dirty maps are NEVER
// touched here — unsaved user edits (positions AND failed writes) survive.
// Fractions keep FULL inverse precision (no rounding): the baseline snaps
// the same values, so no drift can ever read as an edit.
// Returns the reconciled draft array, or null when the map must be left
// alone (dirty, or unreadable placement).
export function tuneReconcileDraft(mapObj, draftRows, fabricPositions, transforms, isDirty) {
  if (isDirty) return null;
  const tf = transforms ? transforms[mapObj.id] : null;
  if (!tunePlacementReadable(tf)) return null;
  const bySrc = new Map();
  for (const r of draftRows || []) {
    const src = (r && r.source) || "";
    if (src && !bySrc.has(src)) bySrc.set(src, r);
  }
  const next = [];
  for (const [src, prev] of Object.entries(fabricPositions || {})) {
    if (typeof prev !== "object" || !prev) continue;
    if (!Number.isFinite(Number(prev.x_m)) || !Number.isFinite(Number(prev.y_m))) continue;
    if (String(prev.floor_id || "main") !== String(mapObj.floor_id || "main")) continue;
    const f = metresToMapFrac(tf, Number(prev.x_m), Number(prev.y_m));
    if (!f || !Number.isFinite(f[0]) || !Number.isFinite(f[1])) continue;
    if (f[0] < -0.05 || f[0] > 1.05 || f[1] < -0.05 || f[1] > 1.05) continue;
    const old = bySrc.get(src) || {};
    next.push({ id: old.id || src, label: old.label || src,
      x: f[0], y: f[1], room: old.room || "", source: src });
    bySrc.delete(src);
  }
  // Draft rows with no fabric entry (failed writes, unconvertible maps,
  // brand-new placements) stay exactly as the user left them.
  for (const r of draftRows || []) {
    const src = (r && r.source) || "";
    if (src && (fabricPositions || {})[src]) continue;
    next.push(r);
  }
  return next;
}
