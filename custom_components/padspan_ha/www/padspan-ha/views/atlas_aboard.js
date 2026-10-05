// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// What the flat Atlas on the sidebar takes from Live Aboard (Garry,
// 2026-10-05: one house, two views — "add features back and forth"):
//
//   people, tags  with Show people / Show tags & scanners on (the same two
//                 switches as Live Aboard's, Pro), who and what is where:
//                 a tag is a small marker with its name and a faint ring as
//                 wide as PadSpan is unsure of its spot; a scanner a small
//                 square; a person a round marker with their initial in
//                 their figure's top colour, moving smoothly to where they
//                 are. A tap says what it is (the same card Live Aboard
//                 shows: live_aboard_tracked.js tagCard, scannerCard), and a
//                 person's says who, where and since when. The same live
//                 snapshot through the same reader as Live Aboard (one read
//                 serves both, never more often than Overview polls)
//   light kinds   with Live Aboard on, a light whose "What is this?" kind was
//                 set there, and whose Atlas shape the person never set, is
//                 drawn in the matching shape (an Atlas shape always wins)
//   furniture     with Live Aboard on and Show furniture, each piece's
//                 footprint, faint, on its floor, under the markers; the
//                 doors and windows drawn in Live Aboard as thin plain marks
//
// Read only: the 3D file through the host's own load, once each time the
// panel is opened and again when Settings removes the furniture; the map is
// never written. The card loads this module only once one of the above is
// on; off, nothing of it is fetched and the drawing is byte for byte as it
// was. Nothing here runs at rest: a person's move is a CSS transition.

const TRACKED = await import(`./live_aboard_tracked.js${new URL(import.meta.url).search}`);
const PIECES = await import(`./live_aboard_pieces.js${new URL(import.meta.url).search}`);

const NS = "http://www.w3.org/2000/svg";
const TAG = "#5eead4";                      // the flat Atlas's beacon teal (Live Aboard's tag)
const SCANNER = "#cbd5e1";                  // a plain scanner
const NEUTRAL = "#7dd3fc";                  // someone with no figure (Live Aboard's soft marker)
const JUMP_M = 8;                           // further than this (or another floor): there at once
const C30 = Math.cos(Math.PI / 6);

// ── light kinds → Atlas shapes ──────────────────────────────────────────────
/** A Live Aboard kind ("What is this?") and the Atlas shape that draws it;
 *  the other kinds keep the Atlas's own choice. */
export const SHAPE_OF_KIND = {
  pot: "circle", strip: "bar", valance: "bar", undercab: "bar", kick: "bar", tv: "bar", fan: "fan", pendant: "pendant",
  sconce: "sconce", chandelier: "chandelier", spot: "triangle", track: "line", tube: "square", led: "diamond",
  pot_ring: "perimeter", cove: "perimeter",
};
// A sensor's glyph is its class's, never a fixture's.
const SENSOR_SHAPES = new Set(["motion", "tempreadout", "humidityreadout", "airquality", "lock", "door", "flood"]);
/** {entity id: shape} for the lights the 3D file gives a kind with an Atlas
 *  shape, whose Atlas shape the person never set (settings.light_shapes). */
export function kindShapes(file, lightsByEid, shapeOverrides){
  const out = {}, L = file && file.lights && typeof file.lights === "object" ? file.lights : {}, ov = shapeOverrides || {};
  for (const [eid, v] of Object.entries(L)) {
    const shape = SHAPE_OF_KIND[v && typeof v === "object" ? v.kind : null], l = lightsByEid ? lightsByEid[eid] : null;
    if (!shape || !l || (ov[eid] && ov[eid] !== "auto") || SENSOR_SHAPES.has(l.shape) || l.shape === shape) continue;
    out[eid] = shape;
  }
  return out;
}
/** The card's lights with those shapes: copies, never the host's own (none: the very same objects). */
export function drawnWith(lightsByEid, byRoom, shapes){
  const ks = Object.keys(shapes || {});
  if (!ks.length) return { lightsByEid, byRoom };
  const lbe = { ...lightsByEid };
  for (const k of ks) lbe[k] = { ...lightsByEid[k], shape: shapes[k] };
  const rooms = {};
  for (const [r, list] of Object.entries(byRoom || {})) rooms[r] = (list || []).map(l => (l && shapes[l.entity_id] ? lbe[l.entity_id] : l));
  return { lightsByEid: lbe, byRoom: rooms };
}

// ── furniture, doors and windows → the drawing's underlay ───────────────────
/** buildIsoSVG's opts.underlay for the 3D file: each piece's footprint
 *  (closed, faint) and each door or window drawn in Live Aboard (a thin plain
 *  line on its wall, not a wall of the map). */
export function underlayOf(file){
  const out = [], f = file && typeof file === "object" ? file : {};
  for (const p of Object.values(f.pieces && typeof f.pieces === "object" ? f.pieces : {})) {
    if (!p || typeof p !== "object" || !Number.isFinite(Number(p.x_m)) || !Number.isFinite(Number(p.y_m))) continue;
    const pts = PIECES.cornersOf(PIECES.boxOf(p));
    out.push({ floor_id: String(p.floor_id || "main"), pts, closed: true, color: "#94a3b8", width: 1, fill: 0.18, opacity: 0.75 });
  }
  for (const o of Object.values(f.openings && typeof f.openings === "object" ? f.openings : {})) {
    if (!o || !Array.isArray(o.a_m) || !Array.isArray(o.b_m) || (o.kind !== "window" && o.kind !== "door")) continue;
    out.push({ floor_id: String(o.floor_id || "main"), pts: [o.a_m, o.b_m], closed: false,
               color: o.kind === "window" ? "#bae6fd" : "#fde68a", width: 2.2, opacity: 0.85 });
  }
  return out;
}

// ── the 3D file, read through the host ──────────────────────────────────────
const _files = new Map();                   // slot -> {data, p, for (the panel showing it was read for)}
let _changed = false;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  // Settings → Remove all furniture: read again on the next card.
  window.addEventListener("padspan-ha-house3d-changed", () => { _changed = true; for (const f of _files.values()) f.stale = true; });
}
/**
 * The 3D file as last read for this screen (null before the first answer).
 * Read through load() when the panel was opened since (shownAt) or the file
 * changed; arrived(): draw again.
 */
export function fileOf(slot, load, shownAt, arrived){
  const k = String(slot || "atlas");
  let f = _files.get(k);
  if (!f) _files.set(k, f = { data: null, p: null, for: null, stale: true });
  if ((f.stale || f.for !== shownAt) && !f.p && typeof load === "function") {
    f.stale = false; f.for = shownAt;
    const mine = f.p = Promise.resolve().then(() => load()).then((r) => {
      if (f.p !== mine) return;
      f.p = null;
      f.data = r && r.data && typeof r.data === "object" ? r.data : {};
      if (typeof arrived === "function") arrived();
    }, () => { if (f.p === mine) f.p = null; });
  }
  return f.data;
}
/** For the tests: forget what was read. */
export function dropFiles(){ _files.clear(); _changed = false; }
export const fileChanged = () => _changed;

// ── people, tags and scanners on the flat map ────────────────────────────────
const FLAT_LIVE_CSS = `
.lv-live-item{transition:transform 1.2s ease}
.lv-live-item.lv-live-jump{transition:none}
@media (prefers-reduced-motion:reduce){.lv-live-item{transition:none}}`;
/** The layer's own sheet, for a card that has the layer (the sidebar's). */
export function liveCss(){ const st = document.createElement("style"); st.textContent = FLAT_LIVE_CSS; return st; }

const svgEl = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
};
/** Dark ink on a light colour, light ink on a dark one. */
function inkOn(hex){
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#0a1a12";
  const n = parseInt(m[1], 16), lum = 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? "#0a1a12" : "#f8fafc";
}
const clockOf = (t) => {
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString([], { weekday: "short" })} ${hm}`;
};
const STATE_WORD = { home: "Home", not_home: "Away" };
/** What a tapped person says: who, where, and since when. */
export function personCard(P, st, roomSince){
  const lines = [];
  const room = P.at && P.at.room ? P.at.room : "";
  lines.push(room ? `In ${room}${roomSince ? ` since ${clockOf(roomSince)}` : ""}` : "Room not known");
  if (st && st.state && st.last_changed) {
    const w = STATE_WORD[st.state] || String(st.state).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    const t = Date.parse(st.last_changed);
    if (Number.isFinite(t)) lines.push(`${w} since ${clockOf(t)}`);
  }
  const seen = TRACKED.seenText(P.at && P.at.age);
  if (seen) lines.push(seen);
  return { title: P.name, lines };
}

// The card a tap opens: Live Aboard's face (live_aboard_use.js), fixed by the
// spot that was tapped; the next press anywhere, or ×, closes it.
const CARD = "position:fixed;z-index:60;box-sizing:border-box;min-width:170px;max-width:min(280px,calc(100vw - 12px));padding:8px 10px 9px;"
  + "border-radius:10px;background:rgba(6,14,9,.95);border:1px solid rgba(94,234,212,.45);color:#e8f0ea;font:12.5px/1.45 Inter,system-ui,sans-serif;"
  + "box-shadow:0 8px 22px rgba(0,0,0,.5);pointer-events:auto";
let _card = null;
export function closeCard(){
  if (!_card) return;
  try { _card.el.remove(); } catch (_) { /* gone with the page */ }
  window.removeEventListener("pointerdown", _card.away, true);
  _card = null;
}
/** Show `c` ({title, lines}) by the screen box `at` (a DOMRect), in `home` (the panel's shadow root). */
export function showCard(c, at, home, key){
  closeCard();
  const el = document.createElement("div");
  el.className = "lv-live-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", c.title);
  el.setAttribute("data-live-card", key || "");
  el.style.cssText = CARD;
  const head = document.createElement("div"), name = document.createElement("b"), x = document.createElement("button");
  head.style.cssText = "display:flex;gap:8px;align-items:flex-start;margin-bottom:3px";
  name.style.cssText = "flex:1;font-size:13.5px;color:#5eead4";
  name.textContent = c.title;
  x.type = "button"; x.textContent = "×"; x.title = "Close";
  x.style.cssText = "all:unset;cursor:pointer;padding:0 4px;font-size:16px;line-height:1;color:rgba(226,240,232,.7)";
  x.addEventListener("click", (e) => { e.stopPropagation(); closeCard(); });
  head.append(name, x);
  el.appendChild(head);
  for (const l of c.lines || []) { const d = document.createElement("div"); d.textContent = l; el.appendChild(d); }
  for (const ev of ["pointerdown", "pointerup", "click", "wheel"]) el.addEventListener(ev, (e) => e.stopPropagation());
  (home || document.body).appendChild(el);
  const W = window.innerWidth || 0, H = window.innerHeight || 0, w = el.offsetWidth || 200, h = el.offsetHeight || 80;
  const cx = at ? at.left + at.width / 2 : W / 2, by = at ? at.bottom : H / 2;
  const left = W ? Math.max(6, Math.min(cx - w / 2, W - w - 6)) : cx - w / 2;
  let top = by + 8;
  if (H && top + h > H - 6) top = Math.max(6, (at ? at.top : H / 2) - h - 8);
  el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
  const away = (e) => { if (!el.contains(e.target)) closeCard(); };
  window.addEventListener("pointerdown", away, true);
  _card = { el, away, key };
  return el;
}
export const cardOpen = () => (_card ? { key: _card.key, text: _card.el.textContent } : null);

const _layers = new Map();                  // slot -> the long-lived layer, moved into each new drawing
/** The flat map's people and tags layer for a screen (one per slot). */
export function liveLayer(slot){
  const k = String(slot || "atlas");
  if (!_layers.has(k)) _layers.set(k, createLiveLayer());
  return _layers.get(k);
}
export function dropLayers(){ for (const L of _layers.values()) L.clear(); _layers.clear(); closeCard(); }

function createLiveLayer(){
  // One group per floor, each laid in the drawing just under the next
  // floor up (its plate covers what is under it, as the map's own markers
  // are covered), the top floor's last.
  const floorsG = new Map();                // z -> its group
  let svg = null;
  const groupOf = (z) => {
    let fg = floorsG.get(z);
    if (!fg) { floorsG.set(z, fg = svgEl("g", { class: "lv-live", "data-live": "", "data-z": z })); place(z); }
    return fg;
  };
  function place(z){
    const fg = floorsG.get(z);
    if (!svg || !fg) return;
    const above = d && d.frame ? d.frame.levels.filter(l => l > z).sort((a, b) => a - b)[0] : undefined;
    const next = above === undefined ? null : svg.querySelector(`g[data-role="floorslab"][data-z="${above}"]`);
    if (next && next.parentNode) next.parentNode.insertBefore(fg, next);
    else if (fg.parentNode !== svg || fg.nextSibling) svg.appendChild(fg);
  }
  const items = new Map();                  // key -> {g, kind, m: [x, y, z], at, ...}
  const since = new Map();                  // person -> {room, t (null: the room they were in when first seen)}
  let d = null, snap = null, frameKey = null;

  function make(w){
    const n = svgEl("g", { class: "lv-live-item lv-live-jump", "data-live": w.kind, "data-live-key": w.key });
    n.style.cursor = "pointer";
    const it = { g: n, kind: w.kind, m: null, parts: {} };
    if (w.kind === "beacon") {
      it.parts.ring = svgEl("ellipse", { cx: 0, cy: 0, rx: 10, ry: 6, fill: TAG, "fill-opacity": 0.13, stroke: TAG, "stroke-opacity": 0.42, "stroke-width": 0.8, "pointer-events": "none" });
      it.parts.dot = svgEl("circle", { cx: 0, cy: 0, r: 4, fill: TAG, stroke: "#0a1a12", "stroke-width": 1.2 });
      it.parts.name = svgEl("text", { x: 0, y: -8, "text-anchor": "middle", "font-family": "system-ui,sans-serif", "font-size": 9, "font-weight": 600,
                                      fill: TAG, "paint-order": "stroke", stroke: "#0a1a12", "stroke-width": 2.2, "stroke-linejoin": "round", "pointer-events": "none" });
      n.append(it.parts.ring, it.parts.dot, it.parts.name);
    } else if (w.kind === "scanner") {
      n.append(svgEl("rect", { x: -3.5, y: -3.5, width: 7, height: 7, rx: 1.2, fill: SCANNER, stroke: "#0a1a12", "stroke-width": 1 }),
               svgEl("circle", { cx: 0, cy: 0, r: 1.3, fill: TAG, "pointer-events": "none" }));
    } else {
      it.parts.body = svgEl("circle", { cx: 0, cy: 0, r: 8, fill: NEUTRAL, stroke: "#0a1a12", "stroke-width": 1.5 });
      it.parts.initial = svgEl("text", { x: 0, y: 3.2, "text-anchor": "middle", "font-family": "system-ui,sans-serif", "font-size": 9, "font-weight": 800,
                                         fill: "#0a1a12", "pointer-events": "none" });
      n.append(it.parts.body, it.parts.initial);
    }
    // A finger's reach (the Atlas's 44 px target), invisible.
    n.insertBefore(svgEl("circle", { cx: 0, cy: 0, r: w.kind === "person" ? 12 : 10, fill: "transparent", "pointer-events": "all" }), n.firstChild);
    const tap = (e) => {
      e.stopPropagation();
      if (e.type !== "click") return;
      const I = items.get(w.key);
      if (I && I.card && d && typeof d.home === "function") showCard(I.card, n.getBoundingClientRect(), d.home(), w.key);
    };
    n.addEventListener("pointerdown", (e) => e.stopPropagation());
    n.addEventListener("click", tap);
    items.set(w.key, it);
    return it;
  }
  function paint(){
    if (!d) return;
    const fr = d.frame, wants = TRACKED.wantedOf({ model: d.model, looks: {}, figures: d.figures || {}, snapshot: snap,
                                                  states: d.states || {}, people: !!d.people, tags: !!d.tags });
    const people = d.people ? TRACKED.peopleOf(d.states || {}, TRACKED.trackedOf(snap)) : [];
    const byEid = new Map(people.map(P => [P.eid, P]));
    const keep = new Set();
    const S = fr.scale || 1, now = Date.now();
    for (const w of wants) {
      if (w.kind === "scanner" && !d.tags) continue;
      const fid = String(w.floor_id || "main");
      if (d.outdoor && d.outdoor(fid)) continue;
      const z = fr.levelOf(fid);
      if (!fr.levels.includes(z)) continue;
      keep.add(w.key);
      const it = items.get(w.key) || make(w);
      const [sx, sy] = fr.iso(w.x, w.y, z);
      const far = !it.m || it.m[2] !== z || Math.hypot(it.m[0] - w.x, it.m[1] - w.y) > JUMP_M || it.frame !== frameKey;
      const fg = groupOf(z);
      if (it.g.parentNode !== fg) fg.appendChild(it.g);
      it.m = [w.x, w.y, z]; it.frame = frameKey; it.at = [sx, sy];
      it.g.classList.toggle("lv-live-jump", far);
      it.g.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      const shown = !d.focused || d.focused(z);
      it.g.style.display = shown ? "" : "none";
      if (w.kind === "beacon") {
        const r = w.halo || TRACKED.haloOf(null);
        it.parts.ring.setAttribute("rx", (Math.SQRT2 * C30 * S * r).toFixed(1));
        it.parts.ring.setAttribute("ry", (Math.SQRT2 * 0.5 * S * r).toFixed(1));
        it.parts.name.textContent = d.hideNames ? "" : String(w.name || "Tag").slice(0, 20);
        it.card = w.card; it.name = w.name;
      } else if (w.kind === "scanner") {
        it.card = w.card;
      } else {
        const P = byEid.get(w.key), name = P ? P.name : w.key;
        const top = w.figure && w.figure.colors && /^#[0-9a-f]{6}$/i.test(String(w.figure.colors.top || "")) ? w.figure.colors.top : NEUTRAL;
        it.parts.body.setAttribute("fill", top);
        it.parts.initial.setAttribute("fill", inkOn(top));
        it.parts.initial.textContent = String(name || "?").trim().charAt(0).toUpperCase() || "?";
        const room = P && P.at ? P.at.room || "" : "";
        const was = since.get(w.key);
        if (!was) since.set(w.key, { room, t: null });
        else if (was.room !== room) since.set(w.key, { room, t: now });
        it.card = P ? personCard(P, (d.states || {})[w.key], since.get(w.key).t) : { title: name, lines: [] };
        it.name = name; it.color = top;
      }
    }
    for (const [k, it] of items) if (!keep.has(k)) { try { it.g.remove(); } catch (_) { /* gone */ } items.delete(k); }
  }
  return {
    /**
     * Into this card's drawing, as of now: d = {stage, frame (fabricFrame's),
     * frameKey (what moves every marker at once: spacing, L/R), model,
     * states, figures, people, tags, hideNames, focused(z), outdoor(fid),
     * home() (where a card goes)}; snapshot when a read came in (else the
     * last one).
     */
    draw(next, snapshot){
      if (next) {
        d = next;
        if (next.frameKey !== frameKey) frameKey = next.frameKey;
        const s2 = next.stage && next.stage.querySelector ? next.stage.querySelector("svg") : null;
        if (s2 && s2 !== svg) {
          svg = s2;
          for (const z of floorsG.keys()) place(z);
          if (floorsG.size && typeof svg.getBoundingClientRect === "function") void svg.getBoundingClientRect();
        }
      }
      if (snapshot !== undefined) snap = snapshot;
      paint();
    },
    /** Off (both switches): nothing of it stays in the drawing. */
    clear(){
      for (const fg of floorsG.values()) { try { fg.remove(); } catch (_) { /* gone */ } }
      floorsG.clear(); items.clear(); since.clear(); d = null; snap = null; svg = null;
    },
    /** The floor groups (the tests). */
    groups: () => [...floorsG.entries()].map(([z, fg]) => ({ z, n: fg.children.length, parent: fg.parentNode })),
    /** What is drawn (the tests and the harness). */
    state: () => [...items.entries()].map(([key, it]) => ({ key, kind: it.kind, at: it.at, shown: it.g.style.display !== "none",
      jump: it.g.classList.contains("lv-live-jump"), name: it.name || null, color: it.color || null,
      initial: it.parts.initial ? it.parts.initial.textContent : null, ring: it.parts.ring ? [Number(it.parts.ring.getAttribute("rx")), Number(it.parts.ring.getAttribute("ry"))] : null,
      card: it.card || null })),
    hasSnapshot: () => !!snap,
  };
}
