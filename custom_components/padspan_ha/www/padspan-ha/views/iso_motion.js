// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live-motion helpers for the string-built iso maps.
//
// The iso views build their object layers as SVG strings and, on every
// 5-second poll (Overview) or playback frame (Traceback), wholesale-replace
// the layer's children — destroying node identity, so every dot TELEPORTS
// to its new position. This module gives those layers motion without
// abandoning the string-built architecture the whole codebase uses.
//
// Split in two on purpose:
//   planObjectLayerMerge — PURE. Takes plain {key, x, y} descriptors (no
//   DOM), decides who moved/appeared/departed and by how far. This is the
//   part that can actually be wrong (key matching, glide-vs-snap threshold,
//   z-order), so it is the part with unit tests.
//   mergeObjectLayer — the DOM-touching wrapper: parses the fresh HTML
//   fragment via innerHTML (a real parse — like every other poll-swap in
//   this codebase, e.g. overview.js's old _updateIsoObjects, traceback.js's
//   _renderFrame — this only runs in a real browser, not the project's
//   lightweight test-DOM shim, which deliberately never parses innerHTML;
//   see tests/js/dom_shim.mjs's own header), then executes the plan by
//   moving/animating real nodes. Verified live, same as the code it replaces.
//
// The glide uses the CSS `translate` PROPERTY, not the `transform`
// attribute: per CSS Transforms 2 the individual transform properties
// compose with (apply before) the attribute, so the counter-scale
// annotation transform (_annT's translate/scale/translate) is untouched
// and _watchAnnScale can keep rewriting it on resize mid-glide.

// How far a matched node may glide. A jump larger than this is not
// movement, it is a re-layout (floor focus change, outside-tether flip,
// stagger reshuffle) — gliding a marker clear across the map for those
// reads as an error, so they snap like they always did.
const MAX_GLIDE_PX = 400;

/**
 * Pure key-diff for one object-layer merge. No DOM.
 *
 * live/fresh — arrays of descriptors: {key, x, y} for a keyed object
 *   (x/y from its anchor, or null if unparseable), or {key: null} for
 *   unkeyed markup (trail lines, one-off decorations) which is always
 *   swapped in fresh order, never matched.
 *
 * Returns, in FRESH order:
 *   kept    — [{key, index, from:[x,y]|null, to:[x,y]|null, glide:boolean}]
 *             one entry per fresh item that is keyed AND matched a live
 *             item still eligible to match (not currently departing).
 *             glide is true iff both anchors parsed and the distance is
 *             in (0, maxGlidePx] — otherwise the item still "kept" its
 *             identity but should just snap (no visible jump to animate).
 *   added   — [{key, index}] fresh keyed items with no live match.
 *   removed — [key, ...] live keys with no fresh match (fade out).
 *   swapped — count of unkeyed fresh items (plain replace, no identity).
 */
export function planObjectLayerMerge(live, fresh, opts = {}) {
  const maxGlide = opts.maxGlidePx != null ? opts.maxGlidePx : MAX_GLIDE_PX;
  const liveByKey = new Map();
  for (const l of (live || [])) {
    if (l && l.key && !l.departing) liveByKey.set(l.key, l);
  }
  const kept = [], added = [];
  const freshKeys = new Set();
  let swapped = 0;
  (fresh || []).forEach((f, index) => {
    if (!f || !f.key) { swapped++; return; }
    freshKeys.add(f.key);
    const prev = liveByKey.get(f.key);
    if (!prev) { added.push({ key: f.key, index }); return; }
    const from = (prev.x != null && prev.y != null) ? [prev.x, prev.y] : null;
    const to = (f.x != null && f.y != null) ? [f.x, f.y] : null;
    let glide = false;
    if (from && to) {
      const dist = Math.hypot(from[0] - to[0], from[1] - to[1]);
      glide = dist > 0.5 && dist <= maxGlide;
    }
    kept.push({ key: f.key, index, from, to, glide });
  });
  const removed = [];
  for (const [key] of liveByKey) if (!freshKeys.has(key)) removed.push(key);
  return { kept, added, removed, swapped };
}

// Parse an anchor attribute of the form "x y" into [x, y], or null.
function _anchor(node, attr) {
  const v = node && node.getAttribute && node.getAttribute(attr);
  if (!v) return null;
  const parts = String(v).trim().split(/\s+/).map(Number);
  if (parts.length < 2 || !isFinite(parts[0]) || !isFinite(parts[1])) return null;
  return [parts[0], parts[1]];
}

// Force a style flush so a transition set right after animates from the
// state just written rather than coalescing both writes into one paint.
function _flush(node) {
  if (typeof node.getBoundingClientRect === "function") {
    try { node.getBoundingClientRect(); } catch (_) { /* not a real layout box */ }
  }
}

/**
 * Keyed in-place morph of a string-built SVG layer. DOM-touching; parses
 * `freshHTML` via innerHTML, so this runs in a real browser only (see the
 * module header) — planObjectLayerMerge above carries the unit tests.
 *
 * group      — the live container (<g>) whose children get updated
 * freshHTML  — the layer's new content as an SVG-fragment string
 * opts.keyAttr    — attribute identifying a stable object   (default data-obj-key)
 * opts.anchorAttr — attribute carrying the "x y" anchor      (default data-ann)
 * opts.moveMs     — glide duration                           (default 900)
 * opts.fadeMs     — fade in/out duration                     (default 300)
 * opts.maxGlidePx — snap instead of glide beyond this        (default 400)
 */
export function mergeObjectLayer(group, freshHTML, opts = {}) {
  const keyAttr = opts.keyAttr || "data-obj-key";
  const anchorAttr = opts.anchorAttr || "data-ann";
  const moveMs = opts.moveMs != null ? opts.moveMs : 900;
  const fadeMs = opts.fadeMs != null ? opts.fadeMs : 300;
  const out = { moved: 0, added: 0, removed: 0, swapped: 0 };
  if (!group) return out;

  const doc = group.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc) return out;
  const tmp = doc.createElement("div");
  tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${freshHTML || ""}</svg>`;
  const tmpSvg = tmp.querySelector && tmp.querySelector("svg");
  if (!tmpSvg) return out;

  const liveNodes = Array.from(group.childNodes || []).filter(n => n && n.getAttribute);
  const freshNodes = Array.from(tmpSvg.childNodes || []).filter(n => n && n.getAttribute);

  const live = liveNodes.map(n => ({
    key: n.getAttribute(keyAttr) || null,
    departing: !!n.getAttribute("data-departing"),
    ..._xy(_anchor(n, anchorAttr)),
  }));
  const fresh = freshNodes.map(n => ({
    key: n.getAttribute(keyAttr) || null,
    ..._xy(_anchor(n, anchorAttr)),
  }));
  const plan = planObjectLayerMerge(live, fresh, opts);

  const liveNodeByKey = new Map();
  for (const n of liveNodes) {
    const k = n.getAttribute(keyAttr);
    if (k && !n.getAttribute("data-departing")) liveNodeByKey.set(k, n);
  }

  // Unkeyed live children get the plain swap they always had.
  for (const n of liveNodes) if (!n.getAttribute(keyAttr)) group.removeChild(n);

  // Append fresh children in fresh order — appendChild on a node not yet a
  // child of `group` is a pure add, so this reproduces the fresh z-order
  // for every case (kept/added/unkeyed) without ever re-appending a node
  // already in this group's children (that specific move-to-end op is
  // what the shim's simplified appendChild — and a real DOM's — both do
  // fine already; skipping it entirely just avoids doing it twice).
  freshNodes.forEach((node, index) => {
    const key = node.getAttribute(keyAttr);
    if (!key) { group.appendChild(node); out.swapped++; return; }
    const keptEntry = plan.kept.find(k => k.index === index);
    if (keptEntry) {
      const old = liveNodeByKey.get(key);
      if (old) group.removeChild(old);
      group.appendChild(node);
      if (keptEntry.glide) {
        const [fx, fy] = keptEntry.from, [tx, ty] = keptEntry.to;
        node.style.transition = "none";
        node.style.translate = `${fx - tx}px ${fy - ty}px`;
        _flush(node);
        node.style.transition = `translate ${moveMs}ms cubic-bezier(.22,.9,.35,1)`;
        node.style.translate = "0px 0px";
        out.moved++;
      } else {
        out.swapped++;
      }
      return;
    }
    // Added: fade in to its own markup opacity (attribute or 1).
    const target = node.getAttribute("opacity");
    node.style.transition = "none";
    node.style.opacity = "0";
    group.appendChild(node);
    _flush(node);
    node.style.transition = `opacity ${fadeMs}ms ease`;
    node.style.opacity = target != null ? String(target) : "1";
    out.added++;
  });

  // Departed keyed objects: fade out, then remove. The attribute marks the
  // corpse so the next merge never matches it as still-live.
  for (const key of plan.removed) {
    const node = liveNodeByKey.get(key);
    if (!node || node.parentNode !== group) continue;
    node.setAttribute("data-departing", "1");
    node.style.transition = `opacity ${fadeMs}ms ease`;
    node.style.opacity = "0";
    out.removed++;
    if (typeof setTimeout === "function") {
      setTimeout(() => {
        try { if (node.parentNode === group) group.removeChild(node); } catch (_) {}
      }, fadeMs + 50);
    }
  }
  return out;
}

function _xy(anchor) {
  return anchor ? { x: anchor[0], y: anchor[1] } : { x: null, y: null };
}

// ── Breadcrumb trails ────────────────────────────────────────────────────────
// A small per-object ring buffer of recent anchor points, and the fading
// polyline drawn from it. Pure data + string helpers so they are testable
// and usable from any string-building view.

const TRAIL_MAX_POINTS = 12;
const TRAIL_MAX_AGE_MS = 10 * 60 * 1000;
const TRAIL_MIN_STEP_PX = 6;   // ignore sub-jitter moves

/** Record a position for `key` in `trails` (a Map). Dedupes jitter, caps
 *  length and age. nowMs injectable for tests. */
export function trailPush(trails, key, x, y, nowMs, opts = {}) {
  if (!trails || !key || !isFinite(x) || !isFinite(y)) return;
  const minStep = opts.minStepPx != null ? opts.minStepPx : TRAIL_MIN_STEP_PX;
  const maxPts = opts.maxPoints != null ? opts.maxPoints : TRAIL_MAX_POINTS;
  const maxAge = opts.maxAgeMs != null ? opts.maxAgeMs : TRAIL_MAX_AGE_MS;
  let arr = trails.get(key);
  if (!arr) { arr = []; trails.set(key, arr); }
  const last = arr[arr.length - 1];
  if (last && Math.hypot(x - last.x, y - last.y) < minStep) {
    last.t = nowMs; // refresh age; the object is simply still here
  } else {
    arr.push({ x, y, t: nowMs });
  }
  while (arr.length > maxPts) arr.shift();
  while (arr.length && (nowMs - arr[0].t) > maxAge) arr.shift();
}

/** Fading breadcrumb segments for every trail with 2+ points. Newest
 *  segments are most opaque; segments age out with the buffer. colorFor
 *  maps a key to its stroke colour. */
export function trailSvg(trails, colorFor, nowMs, opts = {}) {
  if (!trails || !trails.size) return "";
  const maxAge = opts.maxAgeMs != null ? opts.maxAgeMs : TRAIL_MAX_AGE_MS;
  let s = "";
  for (const [key, arr] of trails) {
    // Prune here too, so a stale buffer never draws (push may not have
    // run for a departed object).
    while (arr.length && (nowMs - arr[0].t) > maxAge) arr.shift();
    if (arr.length < 2) continue;
    const col = (colorFor && colorFor(key)) || "#fbbf24";
    const n = arr.length - 1;
    for (let i = 0; i < n; i++) {
      const a = arr[i], b = arr[i + 1];
      // Oldest segment ~0.08, newest ~0.45 — a memory, not a claim.
      const op = (0.08 + 0.37 * ((i + 1) / n)).toFixed(2);
      s += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ` +
           `stroke="${col}" stroke-width="2" stroke-linecap="round" opacity="${op}" pointer-events="none"/>`;
    }
  }
  return s ? `<g data-role="trails" pointer-events="none">${s}</g>` : "";
}
