// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The Atlas as a screen (the sidebar): the map alone, full screen, and a
// double-tap on a room — the same for the flat map and Live Aboard (Garry,
// 2026-10-05: "make sure that they look like the same software").
//
//   the map alone  zoomed in past the whole-house size, every bar steps
//                  aside (the header, the rail and its drawers, the legend,
//                  the light index) and the map covers the panel; ☰ (top
//                  right), Escape, or zooming back out brings them back
//   full screen    ⛶ (bottom right) takes the panel full screen, the map
//                  alone; a screen that may not go full screen gets the map
//                  alone in the panel instead
//   double-tap     two taps close together on a room's empty floor zoom the
//                  flat map to that room, as Live Aboard flies to it
//
// Live Aboard keeps its own view element (live_aboard.js) and takes the
// shared rules from here: when the bars step aside (soloStep), the panel's
// box (coverRect), full screen (canFull, askFull, leaveFull, isFullOf) and
// the ⛶ button's face. The flat map's side (flatScreen, flatDoubleTap) is the
// sidebar host's only (lights_panel.js hands host.screen); Mapping's builder
// never gets it. Nothing here calls Home Assistant, and nothing runs at rest:
// listeners only, and only while the map is alone or full screen.

// Zoomed in past SOLO_IN of the whole-house size, the bars step aside; back
// out to SOLO_OUT of it, they return. COVER_Z: the covering map's z-index.
export const SOLO_IN = 0.8, SOLO_OUT = 0.97, COVER_Z = 45;
// A tap (short, still) and two of them (close in time and place).
export const TAP_MS = 320, TAP2_MS = 420, TAP_PX = 10, TAP2_PX = 44;

/**
 * After a zoom by hand: is the map alone? `at` is how far out the view is
 * (Live Aboard: the camera's distance; the flat map: 1 / its zoom), `fit` the
 * whole-house size on the same scale, `hold` where ☰ brought the bars back
 * (zooming further in from there hides them again), `inward` whether this
 * zoom went in. → {bare, hold}.
 */
export function soloStep({ at, fit, bare, hold, inward }){
  if (at >= fit * SOLO_OUT) return { bare: false, hold: null };
  if (inward && !bare && at < fit * SOLO_IN && (hold === null || hold === undefined || at < hold * SOLO_IN)) return { bare: true, hold: hold ?? null };
  return { bare: !!bare, hold: hold ?? null };
}

// ── the panel and full screen ────────────────────────────────────────────────
/** The panel's element: the host of the shadow root `node` is in. */
export function panelHostOf(node){
  try { const rn = node && node.getRootNode ? node.getRootNode() : null; return rn && rn.host ? rn.host : null; } catch (_) { return null; }
}
/** The panel's box, to the window's right and bottom (the whole screen while full screen). */
export function coverRect(host, full){
  const W = window.innerWidth || 0, H = window.innerHeight || 0;
  if (full) return { left: 0, top: 0, width: W, height: H };
  const r = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
  const left = r ? Math.max(0, Math.min(r.left, W - 160)) : 0, top = r ? Math.max(0, Math.min(r.top, H - 160)) : 0;
  const right = r && r.right > left + 160 ? Math.min(r.right, W) : W;
  return { left, top, width: right - left, height: H - top };
}
/** May this panel go full screen (a kiosk may refuse)? */
export function canFull(host){
  if (!host || !(host.requestFullscreen || host.webkitRequestFullscreen)) return false;
  return document.fullscreenEnabled !== false || !!document.webkitFullscreenEnabled;
}
/** Ask for full screen; refused() if the browser says no. */
export function askFull(host, refused){
  try {
    const pr = (host.requestFullscreen || host.webkitRequestFullscreen).call(host, { navigationUI: "hide" });
    if (pr && typeof pr.then === "function") pr.then(null, refused);
  } catch (_) { refused(); }
}
export function leaveFull(){
  try {
    const x = document.exitFullscreen || document.webkitExitFullscreen;
    const pr = x ? x.call(document) : null;
    if (pr && typeof pr.catch === "function") pr.catch(() => { /* already out */ });
  } catch (_) { /* already out */ }
}
/** Is `target` (the panel asked for) the one full screen now? */
export function isFullOf(target){
  if (!target) return false;
  let rn = null;
  try { rn = target.getRootNode ? target.getRootNode() : null; } catch (_) { rn = null; }
  const fs = document.fullscreenElement || document.webkitFullscreenElement || null;
  return fs === target || !!(rn && rn.fullscreenElement === target);
}
export const FULL_ICON = { on: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4", off: "M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4" };
/** The ⛶ button's face: what it says and its icon, full screen or not. */
export const fullLabel = (on, can) => (on ? "Leave full screen" : can ? "Full screen" : "Only the map");
export const fullIconSvg = (on) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="${on ? FULL_ICON.off : FULL_ICON.on}"/></svg>`;

// ── the flat map's side (the sidebar) ───────────────────────────────────────
// The stage is made anew on every card the poll builds, so what the screen is
// doing lives here per screen (slot), and each new card is painted from it:
// alone, the card takes .lv-alone and the stage covers the panel's box; the
// emergency dial and the Vacation banner stay above it (Garry, 2026-09-21:
// the banner pinned in the centre on both Atlas screens), and so do ☰ and ⛶.
// Alone, the drawing takes its zoom on a phone too (the panel's narrow-screen
// rule otherwise holds every svg to the stage's width).
const FLAT_CSS = `
.lv-alone-anchor{position:relative;height:1px;margin-top:-1px;pointer-events:none}
.lv-alone-anchor > button{all:unset;box-sizing:border-box;position:absolute;display:flex;align-items:center;justify-content:center;
  cursor:pointer;pointer-events:auto;color:#e8f0ea;background:rgba(6,14,9,.62);border:1px solid rgba(120,190,155,.24);
  box-shadow:0 4px 14px rgba(0,0,0,.35)}
.lv-alone-anchor > .lv-alone-full{right:12px;bottom:12px;width:38px;height:32px;border-radius:9px;background:rgba(6,14,9,.86)}
.lv-alone-full svg{display:block;width:14px;height:14px}
.lv-alone-anchor > .lv-alone-full.lv-alone-pin{position:fixed;right:var(--lv-pin-r,12px);bottom:12px;z-index:7}
.lv-alone-anchor > .lv-alone-solo{right:12px;top:12px;width:40px;height:40px;border-radius:50%;font-size:18px;opacity:.72;display:none}
.lv-alone-anchor > button:hover,.lv-alone-anchor > button:focus-visible{opacity:1;border-color:rgba(120,190,155,.5)}
.lv-mapcard.lv-alone > .lv-alone-anchor{position:fixed;left:var(--lv-al-l);top:var(--lv-al-t);width:var(--lv-al-w);height:var(--lv-al-h);z-index:${COVER_Z + 1}}
.lv-mapcard.lv-alone > .lv-alone-anchor > .lv-alone-solo{display:flex}
.lv-mapcard.lv-alone:has(.lv-emerg) > .lv-alone-anchor > .lv-alone-solo{right:96px}
.lv-mapcard.lv-alone > .lv-emerg-anchor{position:fixed;left:var(--lv-al-l);top:var(--lv-al-t);width:var(--lv-al-w);z-index:${COVER_Z + 2}}
.lv-mapcard.lv-alone > .lv-vacation{z-index:${COVER_Z + 3}}
.lv-mapcard.lv-alone > .lv-stage > svg{max-width:none}`;
// The stage's own cover, inline (it must win over the layout's own widths).
const COVER_KEYS = ["position", "left", "top", "width", "height", "margin", "maxWidth", "borderRadius", "border", "zIndex", "boxSizing"];

const _flat = new Map();   // slot -> what that screen's flat map is doing, across the card rebuilds
function flatState(slot){
  const k = String(slot || "atlas");
  if (!_flat.has(k)) _flat.set(k, { bare: false, fsOn: false, hold: null, fsTarget: null, host: null, zoom: null, cur: null, off: null, fsOff: null,
                                    io: null, below: false });
  return _flat.get(k);
}
const shownOf = (st) => !!(st.cur && (!st.cur.shown || st.cur.shown()));
function hostOf(st){
  if (!st.host || st.host.isConnected === false) st.host = panelHostOf(st.cur && st.cur.stage) || st.host;
  return st.host;
}

function paint(st){
  const c = st.cur;
  if (!c) return;
  // Live Aboard showing: the flat map is not on screen, so it is not alone.
  if ((st.bare || st.fsOn) && !shownOf(st)) st.bare = false;
  const alone = st.bare;
  c.card.classList.toggle("lv-alone", alone);
  if (alone) {
    const r = coverRect(hostOf(st), st.fsOn);
    for (const [k, v] of [["--lv-al-l", r.left], ["--lv-al-t", r.top], ["--lv-al-w", r.width], ["--lv-al-h", r.height]]) c.card.style.setProperty(k, `${Math.round(v)}px`);
    Object.assign(c.stage.style, { position: "fixed", left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px`, width: `${Math.round(r.width)}px`,
                                   height: `${Math.round(r.height)}px`, margin: "0", maxWidth: "none", borderRadius: "0", border: "none",
                                   zIndex: String(COVER_Z), boxSizing: "border-box" });
  } else {
    for (const k of ["--lv-al-l", "--lv-al-t", "--lv-al-w", "--lv-al-h"]) c.card.style.removeProperty(k);
    for (const k of COVER_KEYS) c.stage.style[k] = "";
  }
  if (c.anchor) c.anchor.style.display = shownOf(st) ? "" : "none";
  if (c.full) {
    // The stage's foot below the screen (a tall house at 100 %): ⛶ waits at
    // the panel's bottom right, where Live Aboard's is, until the foot shows.
    const pin = st.below && !alone && shownOf(st);
    c.full.classList.toggle("lv-alone-pin", pin);
    if (pin) { const r = coverRect(hostOf(st), false); c.card.style.setProperty("--lv-pin-r", `${Math.max(12, Math.round((window.innerWidth || 0) - r.left - r.width + 12))}px`); }
    else c.card.style.removeProperty("--lv-pin-r");
    const t = fullLabel(st.fsOn, canFull(hostOf(st)));
    c.full.title = t;
    c.full.setAttribute("aria-label", t);
    c.full.setAttribute("aria-pressed", String(st.fsOn));
    c.full.innerHTML = fullIconSvg(st.fsOn);
  }
  listen(st, alone);
}
/** While alone: the window's size and the panel's follow it, and Escape brings the bars back. */
function listen(st, on){
  if (!on) { if (st.off) { st.off(); st.off = null; } return; }
  if (st.off) return;
  const onResize = () => { try { paint(st); } catch (_) { /* the next card paints */ } };
  const onKey = (e) => { if (e.key === "Escape" && st.bare && !st.fsOn) setBare(st, false, true); };
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  const h = hostOf(st);
  let ro = null;
  if (h && typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(onResize); ro.observe(h); }
  st.off = () => { window.removeEventListener("resize", onResize); window.removeEventListener("keydown", onKey); if (ro) ro.disconnect(); };
}
/** The bars away (the map alone) or back. byHand: ☰ or Escape, so the same zoom does not hide them again at once. */
function setBare(st, on, byHand){
  const want = !!on && shownOf(st);
  if (want === st.bare) return;
  st.bare = want;
  if (!want && byHand) st.hold = 1 / (st.zoom || 1);
  paint(st);
}
function toggleFull(st){
  if (st.fsOn) { leaveFull(); return; }
  const h = hostOf(st);
  if (!canFull(h)) { setBare(st, true, false); return; }   // not allowed here (a kiosk): the map alone in the panel
  st.fsTarget = h;
  if (!st.fsOff) {
    const on = () => fullChanged(st);
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    st.fsOff = () => { document.removeEventListener("fullscreenchange", on); document.removeEventListener("webkitfullscreenchange", on); };
  }
  askFull(h, () => { st.fsTarget = null; if (!st.fsOn) setBare(st, true, false); });
}
function fullChanged(st){
  const now = isFullOf(st.fsTarget);
  if (now === st.fsOn) return;
  st.fsOn = now;
  // In: the map alone, full screen. Out (⛶, Escape, the browser's own way): everything back.
  if (now) st.bare = shownOf(st);
  else { st.fsTarget = null; st.bare = false; if (st.fsOff) { st.fsOff(); st.fsOff = null; } }
  paint(st);
}

/**
 * The flat map's screen ways on one new card (the sidebar host only).
 * o = {slot, card (the map card), stage (its stage), zoom (the view's now),
 *      shown() (false while Live Aboard shows instead)}
 * → {anchor (☰ and ⛶: put it right after the stage), zoomed(z, byHand)
 *    (after any zoom: only one by hand steps the bars aside; any zoom back
 *    out brings them back), paint(), state()}
 */
export function flatScreen(o){
  const st = flatState(o.slot);
  if (st.zoom === null) st.zoom = Number(o.zoom) || 1;
  const css = document.createElement("style");
  css.textContent = FLAT_CSS;
  o.card.appendChild(css);
  const anchor = document.createElement("div");
  anchor.className = "lv-alone-anchor";
  anchor.setAttribute("data-lv-alone", "");
  const btn = (cls, text, title, act) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = text;
    if (title) { b.title = title; b.setAttribute("aria-label", title); }
    b.addEventListener("click", (e) => { e.stopPropagation(); act(); });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    anchor.appendChild(b);
    return b;
  };
  btn("lv-alone-solo", "☰", "Show the controls", () => setBare(st, false, true));
  const full = btn("lv-alone-full", "", "", () => toggleFull(st));
  st.cur = { card: o.card, stage: o.stage, shown: typeof o.shown === "function" ? o.shown : null, anchor, full };
  // Where the stage's foot is (seen once the card is in the page, and on
  // every scroll that moves it past the screen's edge; nothing at rest).
  if (st.io) st.io.disconnect();
  st.io = null; st.below = false;
  if (typeof IntersectionObserver !== "undefined") {
    st.io = new IntersectionObserver((es) => {
      const e = es[es.length - 1];
      if (!e || st.cur.anchor !== anchor) return;
      st.below = !e.isIntersecting && !!e.rootBounds && e.boundingClientRect.top >= e.rootBounds.bottom;
      try { paint(st); } catch (_) { /* the next card paints */ }
    });
    st.io.observe(anchor);
  }
  paint(st);
  return {
    anchor,
    zoomed(z, byHand = false){
      const prev = st.zoom, next = Number(z) || 1;
      st.zoom = next;
      if (prev === next || !shownOf(st)) return;
      // A zoom not by hand (the saved zoom arriving after the first card, a
      // preset, a floor's remembered zoom) never hides the bars by itself.
      const s = soloStep({ at: 1 / next, fit: 1, bare: st.bare, hold: st.hold, inward: byHand && next > prev });
      st.hold = s.hold;
      if (s.bare !== st.bare) setBare(st, s.bare, false);
    },
    paint: () => paint(st),
    /** What the screen is doing (for the tests and the harness). */
    state: () => ({ bare: st.bare, full: st.fsOn, hold: st.hold, zoom: st.zoom, listening: !!st.off, watchingFull: !!st.fsOff }),
  };
}
/** Forget a screen's state (the tests; a page that drops the screen). */
export function dropFlatScreen(slot){
  const st = _flat.get(String(slot || "atlas"));
  if (!st) return;
  if (st.off) st.off();
  if (st.fsOff) st.fsOff();
  if (st.io) st.io.disconnect();
  _flat.delete(String(slot || "atlas"));
}

// ── a double-tap on a room ──────────────────────────────────────────────────
// What a press on the flat map can land on that is not the floor: a marker,
// its halo or code, a room's name, a stack chip, a floor badge, a door's or
// window's line, a tag, a scanner or a person. A tap there does what it did.
const NOT_FLOOR = ".lhex,.lhalo,.lroom,.lstack,.lfloor,.lbarhit,.ldoorcircle,.ldropmarker,[data-live],button,a,input,select";

/**
 * Two taps close together on a room's empty floor: go there (the flat map,
 * the sidebar). o = {roomAt(clientX, clientY) → a room or null, go(room)}.
 * Wired once per stage; a pinch, a drag or a tap on anything else is no tap.
 */
export function flatDoubleTap(stage, o){
  if (!stage || stage._lvTap2) return;
  stage._lvTap2 = true;
  const downs = new Map();
  let last = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp, many: downs.size > 0 });
    if (downs.size > 1) for (const d of downs.values()) d.many = true;
  });
  const lift = (e) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (!d || d.many || e.type === "pointercancel") return;
    const tgt = e.target && e.target.closest ? e.target.closest(NOT_FLOOR) : null;
    if (tgt || e.timeStamp - d.t > TAP_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX) { last = null; return; }
    const prev = last;
    last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (!prev || e.timeStamp - prev.t > TAP2_MS || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > TAP2_PX) return;
    last = null;
    const room = o.roomAt(e.clientX, e.clientY);
    if (room) o.go(room);
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
}

/**
 * The room under a point of the flat map, as drawn: the top floor showing
 * first, and a floor's plate hides the rooms of the floors under it.
 * frame: fabricFrame's (iso, isoInv, rooms, levels); at: the point in the
 * drawing's own units; focused(z): is that floor showing (not ghosted).
 * → {room, z, pts} or null.
 */
export function roomUnder(frame, at, focused, inside){
  if (!frame || !at) return null;
  const levels = [...(frame.levels || [])].sort((a, b) => b - a);
  for (const z of levels) {
    if (focused && !focused(z)) continue;
    const here = (frame.rooms || []).filter(r => r.z === z && Array.isArray(r.pts) && r.pts.length > 2);
    if (!here.length) continue;
    const [x, y] = frame.isoInv(at[0], at[1], z);
    const r = here.find(rr => inside(rr.pts, x, y));
    if (r) return { room: r.room, z, pts: r.pts };
    // On this floor's plate, between its rooms: the floors under it are hidden there.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const rr of here) for (const p of rr.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (x >= x0 - 0.5 && x <= x1 + 0.5 && y >= y0 - 0.5 && y <= y1 + 0.5) return null;
  }
  return null;
}
/**
 * The zoom and the drawing's point to centre that show a room whole on the
 * stage: its outline as drawn (box in the drawing's units), the viewBox's
 * width, the stage's inner width and height (px). Never further out than the
 * whole house (1), never past the Atlas's 250 %.
 */
export function roomZoom(box, viewW, stageW, stageH){
  const bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.y1 - box.y0);
  const perUnit = stageW / viewW;                            // px per drawing unit at 100 %
  const z = Math.min(0.7 * stageW / (bw * perUnit), 0.7 * stageH / (bh * perUnit));
  return { zoom: Math.max(1, Math.min(2.5, Math.round(z * 10) / 10)), cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 };
}

// ── one read of the live snapshot for both views ────────────────────────────
// Show people and Show tags & scanners read Overview's live snapshot through
// the host's reader ({read(), everyMs}). On the sidebar the flat map and Live
// Aboard read it through this, per screen: a read answered less than everyMs
// ago serves whichever view asks next (within four fifths of it: the poll
// that asks lands a little early or late), so one read serves both, never more
// often than Overview polls. A reader with no read() (Mapping's snapshot()) is
// handed back as it is.
const _reads = new Map();   // slot -> {at, p, n (reads made)}
export function sharedReader(slot, src){
  if (!src || typeof src.read !== "function") return src || null;
  const k = String(slot || "atlas"), every = Math.max(1000, Number(src.everyMs) || 5000);
  return {
    everyMs: src.everyMs,
    read(){
      let c = _reads.get(k);
      if (!c) _reads.set(k, c = { at: 0, p: null, n: 0 });
      if (c.p && Date.now() - c.at < every * 0.8) return c.p;
      c.at = Date.now(); c.n++;
      const p = c.p = Promise.resolve().then(() => src.read());
      p.catch(() => { if (c.p === p) { c.p = null; c.at = 0; } });
      return p;
    },
  };
}
/** How many reads a screen has made (the tests). */
export const readsOf = (slot) => (_reads.get(String(slot || "atlas")) || { n: 0 }).n;
export function dropReads(){ _reads.clear(); }
