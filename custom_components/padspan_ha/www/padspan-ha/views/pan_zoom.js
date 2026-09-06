// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Shared pan/zoom viewport helper (gap #11, best-in-class roadmap: "map
// interaction parity... everywhere"). Extracted from maps.js's Rooms tab,
// where this exact function already lived as `_attachPanZoom` with only
// one caller — verified first that it was already fully generic (wheel
// zoom-at-cursor, mouse/touch drag-pan, pinch-to-zoom, dblclick-reset via
// a CSS transform on `inner`, no assumptions beyond that DOM shape) before
// moving it here so Overview's iso map, Mapping's Edit stage, and
// Calibration's Pin & Listen can all share the ONE implementation instead
// of three more hand-copies.
//
// Pure Live's own pinch-zoom (purelive.js's MapViewport) is NOT
// consolidated into this — it is a Preact hook-based component reimplementing
// the identical math imperatively is what THIS function already was for
// maps.js's plain-DOM style; the two paradigms don't share a call surface.
//
// `inner` must be an absolutely-positioned div filling `viewport`
// (transform-origin 0 0); `viewport` should have position:relative +
// overflow:hidden. This is pointer/keyboard-event-driven DOM interaction
// with no real layout geometry under the project's dom_shim.mjs (it never
// parses innerHTML or lays out real boxes) — verified live, not unit
// tested, the same convention this codebase already applies to
// iso_motion.js's mergeObjectLayer and traceback.js's frame renderer.

const MIN_SCALE = 0.3, MAX_SCALE = 5;
const KEY_PAN_PX = 48;
const KEY_ZOOM_FACTOR = 1.2;

export function attachPanZoom(viewport, inner, opts = {}) {
  const s = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0, pinchDist: 0, pinchScale: 1 };
  const apply = () => { inner.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`; };
  const zoomAt = (cx, cy, factor) => {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.scale * factor));
    const ratio = newScale / s.scale;
    // The zoom-at-cursor fixed-point math assumes cursor coordinates
    // relative to the inner element's own (untransformed) layout origin —
    // inner is flex-centred inside the viewport, so subtract its layout
    // offset. Without this, every zoom step drifts the content toward a
    // corner and it quickly flies off screen.
    const ox = inner.offsetLeft, oy = inner.offsetTop;
    const px = cx - ox, py = cy - oy;
    s.tx = px - ratio * (px - s.tx);
    s.ty = py - ratio * (py - s.ty);
    s.scale = newScale;
    apply();
  };
  const reset = () => { s.scale = 1; s.tx = 0; s.ty = 0; apply(); };
  // A drag handle inside the viewport (a light pin, a room vertex) handles
  // its own drag; the viewport's pan must not also fire for that same
  // mousedown, or the handle and the whole canvas would both move at once.
  const isExcluded = (t) => t.closest && t.closest("button,input,select,a,[data-light-pin],[data-room-handle]");

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });

  viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isExcluded(e.target)) return;
    s.dragging = true; s.startX = e.clientX; s.startY = e.clientY; s.startTx = s.tx; s.startTy = s.ty;
    viewport.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!s.dragging) return;
    s.tx = s.startTx + (e.clientX - s.startX);
    s.ty = s.startTy + (e.clientY - s.startY);
    apply();
  });
  window.addEventListener("mouseup", () => { s.dragging = false; viewport.style.cursor = "grab"; });

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      if (isExcluded(e.target)) return;
      s.dragging = true; s.startX = e.touches[0].clientX; s.startY = e.touches[0].clientY; s.startTx = s.tx; s.startTy = s.ty;
    } else if (e.touches.length === 2) {
      s.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      s.pinchDist = Math.sqrt(dx * dx + dy * dy); s.pinchScale = s.scale;
    }
  }, { passive: false });
  viewport.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && s.dragging) {
      s.tx = s.startTx + (e.touches[0].clientX - s.startX);
      s.ty = s.startTy + (e.touches[0].clientY - s.startY);
      apply();
    } else if (e.touches.length === 2 && s.pinchDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.pinchScale * (dist / s.pinchDist)));
      const r = viewport.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      const ratio = newScale / s.scale;
      s.tx = cx - ratio * (cx - s.tx); s.ty = cy - ratio * (cy - s.ty); s.scale = newScale;
      apply();
    }
  }, { passive: false });
  viewport.addEventListener("touchend", () => { s.dragging = false; s.pinchDist = 0; });

  viewport.addEventListener("dblclick", (e) => { if (!isExcluded(e.target)) reset(); });

  // Keyboard nav (gap #11): arrows pan, +/- zoom (about the viewport's own
  // centre, since there is no cursor position to zoom at from a keypress),
  // 0 resets. Only fires while the viewport itself has focus — a global
  // keydown listener would hijack arrow keys from every text input and
  // select on the page. `opts.keyboard === false` opts a caller out
  // entirely (e.g. a view that already uses arrow keys for something else
  // at this same DOM level).
  if (opts.keyboard !== false) {
    viewport.tabIndex = viewport.tabIndex >= 0 ? viewport.tabIndex : 0;
    viewport.style.outline = viewport.style.outline || "none";
    viewport.addEventListener("keydown", (e) => {
      const key = e.key;
      let handled = true;
      if (key === "ArrowUp") { s.ty += KEY_PAN_PX; apply(); }
      else if (key === "ArrowDown") { s.ty -= KEY_PAN_PX; apply(); }
      else if (key === "ArrowLeft") { s.tx += KEY_PAN_PX; apply(); }
      else if (key === "ArrowRight") { s.tx -= KEY_PAN_PX; apply(); }
      else if (key === "+" || key === "=") {
        const r = viewport.getBoundingClientRect();
        zoomAt(r.width / 2, r.height / 2, KEY_ZOOM_FACTOR);
      } else if (key === "-" || key === "_") {
        const r = viewport.getBoundingClientRect();
        zoomAt(r.width / 2, r.height / 2, 1 / KEY_ZOOM_FACTOR);
      } else if (key === "0") {
        reset();
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    });
  }

  return { reset, getState: () => ({ scale: s.scale, tx: s.tx, ty: s.ty }) };
}
