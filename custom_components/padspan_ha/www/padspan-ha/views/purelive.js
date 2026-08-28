// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
/**
 * Pure Live — zero-flicker immersive dashboard
 *
 * Full isometric map with pan/zoom controls, floating glass stat overlays,
 * and a status ticker. Built with Preact for efficient DOM diffing.
 * Map supports: scroll-to-zoom, pinch-to-zoom, click-drag pan, double-tap reset.
 */

import { h, render as preactRender, html } from "../lib/preact-bundle.js";
import { useState, useEffect, useRef, useMemo } from "../lib/preact-bundle.js";

// ── Persistent state ─────────────────────────────────────────────────────────
let _mapNode = null;
// The model snapshot the mounted map was built from. A model refetch (e.g.
// after a fabric room correction) creates a fresh room_geometry_m object —
// that identity change is the signal to rebuild the room SVG instead of only
// refreshing object dots, so fabric edits show here without a page reload.
let _mapModelRef = null;
let _prevDeviceRooms = {};  // {eid: room} for movement ghost detection

// ── CSS ──────────────────────────────────────────────────────────────────────
const STYLES_ID = "purelive-styles";
function injectStyles(root) {
  if (root.querySelector(`#${STYLES_ID}`)) return;
  const s = document.createElement("style");
  s.id = STYLES_ID;
  s.textContent = `
    .pl-root{display:flex;flex-direction:column;min-height:calc(100vh - 140px);background:#050d08}
    /* Kiosk (?view=purelive&kiosk=1): panel chrome is hidden — fill the viewport */
    .pl-root.pl-kiosk{min-height:calc(100vh - 60px);height:calc(100vh - 60px)}
    .pl-root.pl-kiosk .pl-info-toggle{display:none}

    /* Map viewport — clips the pannable/zoomable content */
    .pl-viewport{flex:1;position:relative;overflow:hidden;background:#071008;border-radius:8px;cursor:grab;touch-action:none}
    .pl-viewport:active{cursor:grabbing}
    .pl-viewport-inner{transform-origin:0 0;will-change:transform}

    /* Zoom controls */
    .pl-zoom{position:absolute;bottom:12px;right:12px;z-index:6;display:flex;flex-direction:column;gap:4px}
    .pl-zoom button{width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.1);
      background:rgba(10,30,15,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      color:#e2e8f0;font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:background .15s}
    .pl-zoom button:hover{background:rgba(82,183,136,.2)}
    .pl-zoom button:active{transform:scale(.92)}

    /* Floating stats */
    .pl-stats{position:absolute;top:10px;left:10px;z-index:5;display:flex;gap:16px;
      background:rgba(10,30,15,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
      border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:8px 16px;
      box-shadow:0 6px 24px rgba(0,0,0,.3);color:#e2e8f0}
    .pl-stats-item{text-align:center;min-width:48px}
    .pl-stats-val{font-size:22px;font-weight:800;line-height:1.1}
    .pl-stats-lbl{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-top:1px}

    /* Scanners */
    .pl-scanners{position:absolute;top:10px;right:10px;z-index:5;display:flex;gap:6px;
      background:rgba(10,30,15,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:6px 10px;
      box-shadow:0 4px 16px rgba(0,0,0,.25)}
    .pl-scanner{text-align:center;cursor:pointer;min-width:32px}
    .pl-scanner-id{font-size:10px;font-weight:700}
    .pl-scanner-cnt{font-size:8px;color:#64748b;margin-top:1px}
    .pl-scanner-dot{width:6px;height:6px;border-radius:50%;margin:2px auto 0}

    /* Odometer */
    .pl-odo{display:inline-flex;overflow:hidden;height:1em;line-height:1em;font-variant-numeric:tabular-nums}
    .pl-odo-digit{display:flex;flex-direction:column;transition:transform .5s cubic-bezier(.22,1,.36,1)}
    .pl-odo-digit span{display:block;height:1em;text-align:center}

    /* Ticker */
    .pl-ticker{display:flex;align-items:center;gap:14px;padding:6px 14px;font-size:11px;color:#94a3b8;
      background:rgba(10,21,14,.7);border-top:1px solid rgba(82,183,136,.12);flex-shrink:0}
    .pl-ticker-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    @keyframes pl-poll{0%{width:0}100%{width:100%}}
    .pl-poll{height:2px;background:linear-gradient(90deg,#52b788,#5eead4);border-radius:1px;animation:pl-poll 5s linear infinite}

    /* Zoom level indicator */
    .pl-zoom-level{position:absolute;bottom:12px;left:12px;z-index:6;font-size:10px;color:#64748b;
      background:rgba(10,30,15,.5);padding:2px 8px;border-radius:6px;pointer-events:none;
      transition:opacity .3s;opacity:0}
    .pl-zoom-level.visible{opacity:1}

    /* ── Scanner sonar pulse ───────────────────────── */
    @keyframes pl-sonar-ring{0%{transform:scale(.6);opacity:.5}100%{transform:scale(2.2);opacity:0}}
    .pl-sonar{position:relative;display:inline-block}
    .pl-sonar::before,.pl-sonar::after{content:'';position:absolute;inset:-3px;border-radius:50%;border:1.5px solid var(--sonar-color,#52b788);animation:pl-sonar-ring 2.5s ease-out infinite;pointer-events:none}
    .pl-sonar::after{animation-delay:1.2s}
    .pl-sonar.offline::before,.pl-sonar.offline::after{animation-play-state:paused;opacity:.2}

    /* ── Staggered bump on data change ────────────── */
    @keyframes pl-bump{0%{filter:brightness(1)}30%{filter:brightness(1.4)}100%{filter:brightness(1)}}

    /* ── Device movement ghost ────────────────────── */
    @keyframes pl-ghost-fly{0%{opacity:.8;transform:translateX(0)}100%{opacity:0;transform:translateX(40px) scale(.7)}}
    .pl-ghost{animation:pl-ghost-fly .8s ease-out forwards;pointer-events:none;font-size:10px;color:#5eead4;white-space:nowrap;padding:2px 8px;border-radius:6px;background:rgba(82,183,136,.1);border:1px solid rgba(82,183,136,.2)}

    /* ── Stat value flash on change ───────────────── */
    @keyframes pl-flash{0%{color:#5eead4}100%{color:inherit}}

    /* ── Followed device tracker ──────────────────── */
    @keyframes pl-tracked-pulse{0%,100%{box-shadow:0 0 6px rgba(251,191,36,.3)}50%{box-shadow:0 0 14px rgba(251,191,36,.5)}}
    .pl-tracked{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;padding:4px 0;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    .pl-tracked::-webkit-scrollbar{display:none}
    .pl-tracked-chip{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;
      border:1px solid rgba(251,191,36,.3);background:rgba(251,191,36,.06);cursor:pointer;
      animation:pl-tracked-pulse 2.5s ease-in-out infinite;transition:transform .15s}
    .pl-tracked-chip:hover{transform:scale(1.04);border-color:rgba(251,191,36,.5)}

    /* ── Activity feed ────────────────────────────── */
    .pl-feed{position:absolute;bottom:10px;left:10px;z-index:5;max-width:280px;display:flex;flex-direction:column;gap:3px;pointer-events:none}
    .pl-feed-item{font-size:10px;color:#94a3b8;padding:3px 8px;border-radius:6px;
      background:rgba(10,30,15,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
      border:1px solid rgba(255,255,255,.04);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      animation:pl-feed-in .4s ease-out}
    @keyframes pl-feed-in{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
    .pl-feed-item .pl-feed-time{color:#64748b}
    .pl-feed-item .pl-feed-room{color:#52b788;font-weight:600}

    /* Map area wrapper — contains viewport + overlays */
    .pl-map-area{flex:1;position:relative;display:flex;flex-direction:column;min-height:0;overflow:hidden}

    /* Info toggle — show/hide bottom panels */
    .pl-info-toggle{position:absolute;bottom:10px;left:12px;z-index:7;width:28px;height:28px;border-radius:8px;
      border:1px solid rgba(255,255,255,.08);background:rgba(10,30,15,.6);backdrop-filter:blur(10px);
      color:#94a3b8;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .pl-info-toggle:hover{background:rgba(82,183,136,.15);color:#e2e8f0}

    @keyframes padspan-suspend-pulse{0%,100%{box-shadow:0 0 8px rgba(251,191,36,.3)}50%{box-shadow:0 0 18px rgba(251,191,36,.7)}}
    @keyframes padspan-suspend-dot{0%,100%{opacity:1}50%{opacity:0.3}}

    /* Compact controls bar */
    .pl-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 10px;
      background:rgba(10,21,14,.8);border-top:1px solid rgba(82,183,136,.1);flex-shrink:0;font-size:10px;color:#94a3b8}
    .pl-controls input[type="range"]{height:4px;cursor:pointer}
    .pl-controls button{padding:1px 6px;font-size:10px;border-radius:4px;border:1px solid rgba(255,255,255,.1);
      background:transparent;color:#64748b;cursor:pointer}
    .pl-controls button.on{border-color:rgba(82,183,136,.4);color:#52b788;background:rgba(82,183,136,.1)}

    @media(max-width:640px){
      .pl-stats{padding:6px 10px;gap:10px;border-radius:10px}
      .pl-stats-val{font-size:18px}
      .pl-scanners{padding:4px 6px;gap:4px}
      .pl-ticker{flex-wrap:wrap;gap:8px;justify-content:center}
      .pl-ticker>div:first-child{width:100%;order:-1}
      .pl-zoom button{width:32px;height:32px;font-size:16px}
    }
  `;
  root.appendChild(s);
}

// ── Odometer ─────────────────────────────────────────────────────────────────
function Odometer({ value, size = "22px", color }) {
  const str = String(value ?? 0);
  return html`
    <span className="pl-odo" style="font-size:${size};font-weight:800;color:${color || "inherit"}">
      ${str.split("").map((d, i) => {
        const n = parseInt(d, 10);
        if (isNaN(n)) return html`<span key=${`s${i}`} style="width:.3em">${d}</span>`;
        return html`
          <span key=${`d${i}`} className="pl-odo-digit" style="transform:translateY(${-n}em);width:.6em">
            ${[0,1,2,3,4,5,6,7,8,9].map(v => html`<span key=${v}>${v}</span>`)}
          </span>
        `;
      })}
    </span>
  `;
}

// ── Stats Overlay ────────────────────────────────────────────────────────────
function Stats({ rooms, objects, radios, loading }) {
  return html`
    <div className="pl-stats">
      <div className="pl-stats-item">
        <div className="pl-stats-val"><${Odometer} value=${loading ? 0 : rooms} /></div>
        <div className="pl-stats-lbl">Rooms</div>
      </div>
      <div className="pl-stats-item">
        <div className="pl-stats-val"><${Odometer} value=${loading ? 0 : objects} /></div>
        <div className="pl-stats-lbl">Tracked</div>
      </div>
      <div className="pl-stats-item">
        <div className="pl-stats-val"><${Odometer} value=${loading ? 0 : radios} /></div>
        <div className="pl-stats-lbl">Radios</div>
      </div>
    </div>
  `;
}

// ── Scanners Overlay ─────────────────────────────────────────────────────────
function Scanners({ radios, ctx }) {
  if (!radios.length) return null;
  return html`
    <div className="pl-scanners">
      ${radios.slice(0, 10).map(r => {
        const sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source || "") : "?";
        const online = r.scanning !== false;
        return html`
          <div key=${r.source} className="pl-scanner"
               title="${r.source}\n${r.area || ""}\n${r.device_count ?? 0} devices"
               onClick=${() => ctx.actions.showScannerDetail?.(r)}>
            <div className="pl-scanner-id" style="color:${online ? "#52b788" : "#f87171"}">${sid}</div>
            <div className="pl-scanner-cnt">${r.device_count ?? 0}</div>
            <div className="pl-sonar ${online ? "" : "offline"}" style="--sonar-color:${online ? "#52b788" : "#f87171"}">
              <div className="pl-scanner-dot" style="background:${online ? "#52b788" : "#f87171"}"></div>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

// ── Ticker ───────────────────────────────────────────────────────────────────
function Ticker({ dataMode, radios, objects, version, cal }) {
  const knn = cal?.knn_active;
  const algo = cal?.positioning_algorithm === "rf" ? "RF" : "k-NN";
  return html`
    <div className="pl-ticker">
      <div style="flex:1;height:2px;background:rgba(255,255,255,.05);border-radius:1px;overflow:hidden">
        <div className="pl-poll"></div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span className="pl-ticker-dot" style="background:${dataMode === "live" ? "#52b788" : "#f59e0b"}"></span>
        ${dataMode === "live" ? "Live" : "Sample"}
      </div>
      <span>${radios} scanners</span>
      <span>${objects} tracked</span>
      <div style="display:flex;align-items:center;gap:4px">
        <span className="pl-ticker-dot" style="background:${knn ? "#52b788" : "#64748b"}"></span>
        ${algo} ${knn ? "active" : "ready"}
      </div>
      <span style="color:#475569">v${version}</span>
    </div>
  `;
}

// ── SVG counter-scaling ──────────────────────────────────────────────────────
// When the viewport is zoomed, SVG text and circles scale with it, making
// labels and dots balloon until they obscure the map. This applies inverse
// scaling so they remain the same visual size regardless of zoom level.
//
// The overview already scales every annotation — labels, markers, badges,
// legend — by one factor k (its root svg's `data-ann-k`) so they read at a
// designed size, and marks each one `data-ann="x y"` with its anchor. Zoom
// multiplies on-screen size by `scale`, so the annotation's transform is
// re-derived as anchor × (k / scale). Composed, not overwritten: this used
// to set scale(1/zoom) outright, which discarded k and brought the giant
// labels back the moment the map was zoomed — or rebuilt, at zoom 1.

const _COUNTER_SCALE_ATTR = "_plOrig";

function _counterScaleSVG(container, scale) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const inv = 1 / scale;
  const k = parseFloat(svg.getAttribute("data-ann-k")) || 1;
  const f = k * inv;

  // 1. Every annotation the overview marked, about its own anchor.
  for (const el of svg.querySelectorAll("[data-ann]")) {
    const [ax, ay] = (el.getAttribute("data-ann") || "0 0").split(" ").map(Number);
    el.setAttribute("transform", `translate(${ax} ${ay}) scale(${f}) translate(${-ax} ${-ay})`);
  }

  // 2. Stroke widths on room polygons and barriers: line weight is a
  //    screen property, not a building property.
  for (const el of svg.querySelectorAll("polygon, polyline")) {
    if (el.closest("[data-ann]")) continue;
    const origSW = el[_COUNTER_SCALE_ATTR];
    const sw = origSW != null ? origSW : parseFloat(el.getAttribute("stroke-width")) || 0;
    if (origSW == null) el[_COUNTER_SCALE_ATTR] = sw;
    if (sw > 0) el.setAttribute("stroke-width", String(Math.max(0.3, sw * inv)));
  }
}

// ── Pan/Zoom Map Viewport ────────────────────────────────────────────────────
// Wraps the iso map with mouse drag-to-pan, scroll-to-zoom, pinch-to-zoom,
// and double-click/double-tap to reset.

function MapViewport({ children }) {
  const viewportRef = useRef(null);
  const innerRef = useRef(null);
  const stateRef = useRef({ scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0, pinchDist: 0, pinchScale: 1 });
  const [zoomPct, setZoomPct] = useState(100);
  const [showZoom, setShowZoom] = useState(false);
  const zoomTimerRef = useRef(null);

  const MIN_SCALE = 0.3;
  const MAX_SCALE = 5;

  const applyTransform = () => {
    const s = stateRef.current;
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
      _counterScaleSVG(innerRef.current, s.scale);
    }
    setZoomPct(Math.round(s.scale * 100));
    setShowZoom(true);
    clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => setShowZoom(false), 1500);
  };

  // Where a zoom is anchored when the user has not pointed at a spot.
  //
  // The VISIBLE centre, not the element's centre. The viewport is a flex child
  // that grows to its content, so on a tall map it runs well past the bottom of
  // the window — measuring 1209px inside a ~750px window here. Anchoring on
  // `height/2` therefore pivots the map around a point the user cannot see, and
  // it drifts under them as they zoom.
  const anchorCentre = () => {
    const vp = viewportRef.current;
    if (!vp) return [0, 0];
    const r = vp.getBoundingClientRect();
    const visTop = Math.max(r.top, 0);
    const visBottom = Math.min(r.bottom, window.innerHeight || r.bottom);
    const visLeft = Math.max(r.left, 0);
    const visRight = Math.min(r.right, window.innerWidth || r.right);
    // Fall back to the element's own centre if it is scrolled fully out of view.
    const cy = visBottom > visTop ? (visTop + visBottom) / 2 - r.top : r.height / 2;
    const cx = visRight > visLeft ? (visLeft + visRight) / 2 - r.left : r.width / 2;
    return [cx, cy];
  };

  const zoomAt = (cx, cy, factor) => {
    const s = stateRef.current;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.scale * factor));
    const ratio = newScale / s.scale;
    s.tx = cx - ratio * (cx - s.tx);
    s.ty = cy - ratio * (cy - s.ty);
    s.scale = newScale;
    applyTransform();
  };

  const resetView = () => {
    const s = stateRef.current;
    s.scale = 1; s.tx = 0; s.ty = 0;
    applyTransform();
  };

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    // Mouse wheel zoom — anchored on the middle of the view, NOT on the pointer.
    //
    // Anchoring on the cursor is what map apps do, and it is why the map slid
    // sideways: scrolling with the pointer a fifth of the way in from the left
    // pushed the map 188px to the right, because the point under the cursor is
    // the one being held still. This view is read at a glance rather than
    // explored, so the middle stays put and the wheel now matches what the
    // +/− buttons already did.
    const onWheel = (e) => {
      e.preventDefault();
      const [cx, cy] = anchorCentre();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      zoomAt(cx, cy, factor);
    };

    // Mouse drag pan
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      // Don't start pan if clicking on a button, input, or interactive element
      if (e.target.closest("button,input,select,a,[data-tip],[data-obj-key],[data-scanner-src]")) return;
      const s = stateRef.current;
      s.dragging = true; s.startX = e.clientX; s.startY = e.clientY; s.startTx = s.tx; s.startTy = s.ty;
    };
    const onMouseMove = (e) => {
      const s = stateRef.current;
      if (!s.dragging) return;
      s.tx = s.startTx + (e.clientX - s.startX);
      s.ty = s.startTy + (e.clientY - s.startY);
      applyTransform();
    };
    const onMouseUp = () => { stateRef.current.dragging = false; };

    // Touch: pinch zoom + drag pan
    const onTouchStart = (e) => {
      const s = stateRef.current;
      if (e.touches.length === 1) {
        if (e.target.closest("button,input,select,a,[data-tip],[data-obj-key],[data-scanner-src]")) return;
        s.dragging = true; s.startX = e.touches[0].clientX; s.startY = e.touches[0].clientY; s.startTx = s.tx; s.startTy = s.ty;
      } else if (e.touches.length === 2) {
        s.dragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        s.pinchDist = Math.sqrt(dx * dx + dy * dy);
        s.pinchScale = s.scale;
      }
    };
    const onTouchMove = (e) => {
      e.preventDefault();
      const s = stateRef.current;
      if (e.touches.length === 1 && s.dragging) {
        s.tx = s.startTx + (e.touches[0].clientX - s.startX);
        s.ty = s.startTy + (e.touches[0].clientY - s.startY);
        applyTransform();
      } else if (e.touches.length === 2 && s.pinchDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.pinchScale * (dist / s.pinchDist)));
        const rect = vp.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        const ratio = newScale / s.scale;
        s.tx = cx - ratio * (cx - s.tx);
        s.ty = cy - ratio * (cy - s.ty);
        s.scale = newScale;
        applyTransform();
      }
    };
    const onTouchEnd = () => { stateRef.current.dragging = false; stateRef.current.pinchDist = 0; };

    // Double-click/tap to reset
    const onDblClick = (e) => {
      if (e.target.closest("button,input,select,a")) return;
      resetView();
    };

    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    vp.addEventListener("touchstart", onTouchStart, { passive: false });
    vp.addEventListener("touchmove", onTouchMove, { passive: false });
    vp.addEventListener("touchend", onTouchEnd);
    vp.addEventListener("dblclick", onDblClick);

    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      vp.removeEventListener("touchstart", onTouchStart);
      vp.removeEventListener("touchmove", onTouchMove);
      vp.removeEventListener("touchend", onTouchEnd);
      vp.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  return html`
    <div className="pl-viewport" ref=${viewportRef}>
      <div className="pl-viewport-inner" ref=${innerRef}>
        ${children}
      </div>
      <div className="pl-zoom">
        <button onClick=${() => { const [cx, cy] = anchorCentre(); zoomAt(cx, cy, 1.3); }} title="Zoom in">+</button>
        <button onClick=${() => { const [cx, cy] = anchorCentre(); zoomAt(cx, cy, 0.77); }} title="Zoom out">−</button>
        <button onClick=${resetView} title="Reset view" style="font-size:13px">⌂</button>
      </div>
      <div className="pl-zoom-level ${showZoom ? "visible" : ""}">${zoomPct}%</div>
    </div>
  `;
}

// ── Iso Map Bridge ───────────────────────────────────────────────────────────
// Keeps map controls (floor/spacing sliders, buttons) but hides the overview's
// room list panel (duplicates Pure Live's own overlays).

function _cleanupMapElement(map) {
  // Keep the SVG wrapper (position:relative), hide everything else.
  for (const child of [...map.children]) {
    const css = child.style?.cssText || "";
    if (css.includes("position") && css.includes("relative")) continue;
    child.style.display = "none";
  }
}

function IsoMap({ ctx }) {
  const ref = useRef(null);
  // Overview supplies the map (Phase-1 module) — briefly absent on a cold
  // load straight into Pure Live (kiosk bookmark).  Show a placeholder that
  // the next poll render replaces, instead of a silent blank view.
  const ovReady = !!window.__PADSPAN_VIEWS?.overview;

  useEffect(() => {
    if (!ref.current) return;

    // A model refetch (fabric edit committed, room corrected, floor rebuilt)
    // replaces ctx.state.model wholesale — the cached map's room shapes are
    // stale the moment that happens, on EVERY floor. Drop the cache and fall
    // through to a fresh overview render below.
    const modelNow = ctx.state.model && ctx.state.model.room_geometry_m;
    if (_mapNode && _mapModelRef !== modelNow) _mapNode = null;

    // If map is already mounted, update object dots on each poll
    // (same as overview's _isoUpdateObjects) instead of leaving them stale.
    if (_mapNode && _mapNode.isConnected && _mapNode.parentNode === ref.current) {
      if (typeof ctx.state._isoUpdateObjects === "function") {
        try {
          ctx.state._isoUpdateObjects();
          // Re-apply counter-scaling to new object DOM nodes after swap.
          // Without this, replaced objects render at zoom-scaled size
          // until the next user zoom/pan event.
          const viewport = ref.current.closest(".pl-viewport-inner");
          if (viewport) {
            const scaleMatch = viewport.style.transform?.match(/scale\(([\d.]+)\)/);
            if (scaleMatch) _counterScaleSVG(viewport, parseFloat(scaleMatch[1]));
          }
        } catch (_) {}
      }
      return;
    }
    if (_mapNode && !_mapNode.isConnected) {
      ref.current.innerHTML = "";
      ref.current.appendChild(_mapNode);
      return;
    }

    const ov = window.__PADSPAN_VIEWS?.overview;
    if (!ov) return;

    try {
      const section = ov.render(ctx);
      if (!section) return;
      const map = section.querySelector("[data-padspan-map]");
      if (!map) return;

      _cleanupMapElement(map);
      _mapNode = map;
      _mapModelRef = modelNow;
      ref.current.innerHTML = "";
      ref.current.appendChild(map);
    } catch (e) {
      console.warn("[Pure Live] Map build:", e);
    }
  });

  return html`<div>
    ${!ovReady && html`<div style="padding:60px 20px;text-align:center;color:#4a6052;font-size:13px">Loading map…</div>`}
    <div ref=${ref}></div>
  </div>`;
}

// ── Radio List (bottom strip) ────────────────────────────────────────────────
function RadioStrip({ radios, ctx }) {
  if (!radios.length) return null;
  return html`
    <div style="display:flex;gap:8px;padding:6px 12px;overflow-x:auto;background:rgba(10,21,14,.5);border-top:1px solid rgba(82,183,136,.1);flex-shrink:0;-webkit-overflow-scrolling:touch">
      ${radios.map(r => {
        const sid = ctx.helpers.radioShortId ? ctx.helpers.radioShortId(r.source || "") : "?";
        const online = r.scanning !== false;
        const area = r.area || r.area_name || "";
        const devs = r.device_count ?? 0;
        const color = online ? "#52b788" : "#f87171";
        return html`
          <div key=${r.source} style="flex-shrink:0;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);cursor:pointer;font-size:11px"
               title="${r.source}"
               onClick=${() => ctx.actions.showScannerDetail?.(r)}>
            <span className="pl-sonar ${online ? "" : "offline"}" style="--sonar-color:${color};width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <span style="font-weight:700;color:${color}">${sid}</span>
            ${area && html`<span style="color:#94a3b8">${area}</span>`}
            <span style="color:#64748b">${devs} dev</span>
          </div>
        `;
      })}
    </div>
  `;
}

// ── Movement Ghosts ──────────────────────────────────────────────────────────
// Shows a brief animated label when a device moves between rooms.
function MovementGhosts({ roomTagMap }) {
  const [ghosts, setGhosts] = useState([]);

  useEffect(() => {
    const current = {};
    for (const [room, eids] of Object.entries(roomTagMap || {})) {
      for (const eid of (eids || [])) current[eid] = room;
    }
    const newG = [];
    for (const [eid, room] of Object.entries(current)) {
      const prev = _prevDeviceRooms[eid];
      if (prev && prev !== room) {
        newG.push({ id: `${eid}-${Date.now()}`, label: String(eid).substring(0, 14), from: prev, to: room });
      }
    }
    _prevDeviceRooms = current;
    if (newG.length) {
      setGhosts(g => [...g, ...newG].slice(-8));
      setTimeout(() => setGhosts(g => g.filter(x => !newG.find(n => n.id === x.id))), 900);
    }
  }, [roomTagMap]);

  if (!ghosts.length) return null;
  return html`
    <div style="position:absolute;top:50px;left:10px;z-index:7;display:flex;flex-direction:column;gap:4px;pointer-events:none">
      ${ghosts.map(g => html`<div key=${g.id} className="pl-ghost">${g.label} → ${g.to}</div>`)}
    </div>
  `;
}

// ── Followed Device Tracker ──────────────────────────────────────────────────
// Shows followed devices as golden pulsing chips with their current room.
function FollowedTracker({ ctx, snap }) {
  const followed = ctx.state.followedAddrs;
  if (!followed || !followed.size) return null;

  const objList = snap?.objects?.list || [];
  const devices = [];
  for (const o of objList) {
    const addr = (o.address || o.entity_id || o.key || "").toUpperCase();
    if (!addr) continue;
    const isFollowed = followed.has(addr) ||
      (o.all_addresses && o.all_addresses.some(a => followed.has(String(a).toUpperCase())));
    if (!isFollowed) continue;
    devices.push({
      key: addr,
      label: o.user_label || o.private_ble_name || o.name || addr.substring(0, 12),
      room: o.room || "Unknown",
      rssi: o.rssi,
      age: o.age_s,
    });
  }

  if (!devices.length) return null;

  return html`
    <div style="padding:4px 12px;flex-shrink:0;border-top:1px solid rgba(251,191,36,.1);background:rgba(251,191,36,.02)">
      <div style="font-size:9px;color:#fbbf24;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;font-weight:600">Tracked Devices</div>
      <div className="pl-tracked">
        ${devices.map(d => html`
          <div key=${d.key} className="pl-tracked-chip"
               onClick=${() => ctx.actions.showObjectDetail?.({address: d.key, key: d.key})}>
            <span style="font-size:11px;font-weight:700;color:#fbbf24">${d.label}</span>
            <span style="font-size:10px;color:#94a3b8">in</span>
            <span style="font-size:11px;font-weight:600;color:#5eead4">${d.room}</span>
            ${d.rssi != null && html`<span style="font-size:9px;color:#64748b">${d.rssi}dBm</span>`}
          </div>
        `)}
      </div>
    </div>
  `;
}

// ── Activity Feed ────────────────────────────────────────────────────────────
// Scrolling log of recent room changes, newest at top. Fed by MovementGhosts data.
let _activityLog = [];  // persistent across renders

function ActivityFeed({ roomTagMap }) {
  const [feed, setFeed] = useState(_activityLog);

  useEffect(() => {
    const current = {};
    for (const [room, eids] of Object.entries(roomTagMap || {})) {
      for (const eid of (eids || [])) current[eid] = room;
    }
    const newEntries = [];
    const now = new Date();
    for (const [eid, room] of Object.entries(current)) {
      const prev = _prevDeviceRooms[eid];
      // Don't duplicate — MovementGhosts already updates _prevDeviceRooms, so only
      // capture entries that MovementGhosts would have also detected.
      // We read from _prevDeviceRooms BEFORE MovementGhosts updates it in the same cycle.
      // Since both run in the same render, we need to check our own log to avoid dupes.
      if (prev && prev !== room) {
        const label = String(eid).substring(0, 14);
        const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        newEntries.push({ id: `${eid}-${now.getTime()}`, label, from: prev, to: room, time });
      }
    }
    if (newEntries.length) {
      _activityLog = [...newEntries, ..._activityLog].slice(0, 20);
      setFeed(_activityLog);
    }
  }, [roomTagMap]);

  if (!feed.length) return null;

  return html`
    <div className="pl-feed">
      ${feed.slice(0, 6).map(e => html`
        <div key=${e.id} className="pl-feed-item">
          <span className="pl-feed-time">${e.time}</span>${" "}
          ${e.label} → <span className="pl-feed-room">${e.to}</span>
        </div>
      `)}
    </div>
  `;
}

// ── Map Controls Bar ─────────────────────────────────────────────────────────
function MapControls({ ctx }) {
  const settings = ctx.state.settings || {};
  const [focusIdx, setFocusIdx] = useState(ctx.state._overviewIsoFocusIdx ?? 0);
  const [gap, setGap] = useState(ctx.state._overviewFloorGap ?? 150);
  const [lr, setLr] = useState(ctx.state._overviewHorizGap ?? 0);
  const [walls, setWalls] = useState(!!ctx.state._overviewShowWalls);
  const [pins, setPins] = useState(!!ctx.state._overviewPersistentPins);
  const [heat, setHeat] = useState(!!ctx.state._overviewShowHeatmap);
  const [dist, setDist] = useState(!!ctx.state._overviewShowDistortion);
  const [expanded, setExpanded] = useState(false);

  const rebuild = () => { _mapNode = null; ctx.actions.renderRooms(); };

  if (!expanded) {
    return html`
      <div className="pl-controls" onClick=${() => setExpanded(true)} style="cursor:pointer;justify-content:center">
        <span style="color:#94a3b8">Controls</span>
      </div>
    `;
  }

  return html`
    <div className="pl-controls">
      <span>Floor:</span>
      <input type="range" min="0" max="10" value=${focusIdx}
             style="width:70px;accent-color:#52b788"
             onInput=${e => { const v=+e.target.value; setFocusIdx(v); ctx.state._overviewIsoFocusIdx=v; rebuild(); }} />
      <span>Gap:</span>
      <input type="range" min="60" max="340" step="10" value=${gap}
             style="width:60px;accent-color:#52b788"
             onInput=${e => { const v=+e.target.value; setGap(v); ctx.state._overviewFloorGap=v; rebuild(); }} />
      <span>L/R:</span>
      <input type="range" min="-120" max="120" step="10" value=${lr}
             style="width:50px;accent-color:#52b788"
             onInput=${e => { const v=+e.target.value; setLr(v); ctx.state._overviewHorizGap=v; rebuild(); }} />
      <button className=${walls?"on":""} onClick=${()=>{const v=!walls;setWalls(v);ctx.state._overviewShowWalls=v;rebuild();}}>
        Walls
      </button>
      <button className=${pins?"on":""} onClick=${()=>{const v=!pins;setPins(v);ctx.state._overviewPersistentPins=v;rebuild();}}>
        Pins
      </button>
      ${!!(settings.radio_map_enabled) && html`
        <button className=${heat?"on":""} onClick=${()=>{
          const v=!heat;setHeat(v);ctx.state._overviewShowHeatmap=v;
          if(v){setDist(false);ctx.state._overviewShowDistortion=false;}rebuild();}}>
          Heat
        </button>
      `}
      ${!!(settings.distortion_map_enabled) && html`
        <button className=${dist?"on":""} onClick=${()=>{
          const v=!dist;setDist(v);ctx.state._overviewShowDistortion=v;
          if(v){setHeat(false);ctx.state._overviewShowHeatmap=false;}rebuild();}}>
          Warp
        </button>
      `}
      <button onClick=${async()=>{
        try{await ctx.actions.settingsSet({
          overview_iso_floor_gap:gap,overview_iso_horiz_gap:lr,overview_iso_focus:focusIdx
        });}catch(e){}
      }} style="color:#52b788;border-color:#2d6a4f">Save</button>
      <button onClick=${() => setExpanded(false)} style="color:#64748b">Collapse</button>
    </div>
  `;
}

// ── Root ─────────────────────────────────────────────────────────────────────
function App({ ctx }) {
  const mode = ctx.state.dataMode || "sample";
  const snap = ctx.state.live?.snapshot || null;
  const loading = mode === "live" && !snap;
  const quiet = !!(ctx.state.settings?.quiet_mode);
  const [infoVisible, setInfoVisible] = useState(false);

  const rtm = loading ? {} : (ctx.state.roomTagMap || {});
  const rooms = Object.keys(rtm).length;
  const tags = (() => { const s = new Set(); for (const r of Object.keys(rtm)) (rtm[r]||[]).forEach(e => s.add(e)); return s.size; })();

  // Count only objects the user has actually labelled (real people/devices).
  // Do NOT fall back to roomTagMap count — that includes every BLE device
  // assigned to a room, which inflates to 50+.
  const objList = snap?.objects?.list || [];
  const identified = objList.filter(o => o.user_label).length;
  const radios = snap?.ble?.radios || [];
  const cal = snap?.calibration_status;

  const _isSusp = snap?.suspended === true;
  const _suspRem = snap?.suspend_remaining_s ?? 0;
  const _suspMM = Math.floor(_suspRem / 60);
  const _suspSS = _suspRem % 60;
  const _suspTime = _suspRem > 0 ? `${_suspMM}:${String(_suspSS).padStart(2,"0")}` : "0:00";

  const kiosk = !!ctx.state.kioskMode;

  return html`
    <div className=${"pl-root" + (kiosk ? " pl-kiosk" : "")}>
      <div className="pl-map-area">
        <${MapViewport}>
          <${IsoMap} ctx=${ctx} />
        <//>
        ${_isSusp && html`
          <div style=${{
            position:"absolute",top:"8px",left:"50%",transform:"translateX(-50%)",zIndex:100,
            display:"flex",alignItems:"center",gap:"8px",
            padding:"6px 16px",borderRadius:"8px",
            background:"linear-gradient(135deg,#78350f,#92400e)",
            border:"1px solid #b45309",
            animation:"padspan-suspend-pulse 2s ease-in-out infinite",
            whiteSpace:"nowrap",
          }}>
            <span style=${{fontSize:"14px",animation:"padspan-suspend-dot 1s ease-in-out infinite"}}>\u26a0</span>
            <span style=${{color:"#fbbf24",fontWeight:700,fontSize:"12px"}}>SUSPENDED</span>
            <span style=${{color:"#fde68a",fontSize:"11px"}}>${_suspTime}</span>
            <button style=${{
              background:"#991b1b",color:"#fecaca",border:"1px solid #b91c1c",borderRadius:"4px",
              padding:"2px 8px",fontSize:"10px",fontWeight:600,cursor:"pointer",
            }} onClick=${async()=>{
              try { await ctx.actions.wsCall("padspan_ha/unsuspend_databases"); ctx.toast("Resumed"); }
              catch(e){ ctx.toast("Failed",true); }
            }}>Resume</button>
          </div>
        `}
        <${Stats} rooms=${rooms} objects=${identified} radios=${radios.length} loading=${loading} />
        <${Scanners} radios=${radios} ctx=${ctx} />
        <${MovementGhosts} roomTagMap=${rtm} />
        <${ActivityFeed} roomTagMap=${rtm} />
        <button className="pl-info-toggle"
                title=${infoVisible ? "Hide info panels" : "Show info panels"}
                onClick=${() => setInfoVisible(v => !v)}>
          ${infoVisible ? "\u25BC" : "\u2139"}
        </button>
      </div>
      ${!kiosk && html`<${MapControls} ctx=${ctx} />`}
      ${infoVisible && html`
        <${FollowedTracker} ctx=${ctx} snap=${snap} />
        <${RadioStrip} radios=${radios} ctx=${ctx} />
        <${Ticker} dataMode=${mode} radios=${radios.length} objects=${identified} version=${ctx.state.version} cal=${cal} />
      `}
    </div>
  `;
}

// ── Bridge ───────────────────────────────────────────────────────────────────
let _container = null;

export function render(ctx) {
  if (!_container || !_container.isConnected) {
    _container = document.createElement("div");
    // Kiosk mode zeroes the .main padding, so there's nothing to bleed into
    _container.style.cssText = ctx.state.kioskMode ? "margin:0;" : "margin:-14px;";
  }

  const root = _container.getRootNode?.();
  if (root && root !== document) injectStyles(root);

  preactRender(html`<${App} ctx=${ctx} />`, _container);
  return _container;
}
