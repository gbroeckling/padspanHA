// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The guided measurement of a plan's scale, one copy for the two screens that measure by hand: the rooms helper's
// measuring screen (views/ai_wizard.js) and "Set this plan's scale now" after an upload (views/scale_nudge.js). The
// plan's picture with the two ends on it (a tap places, a drag moves, two fingers pinch, − and + look closer inside
// its own window), the length field, what the length was read as, the plan's size from it, and the bar that keeps
// Save in view. Moved here from ai_wizard.js, not copied. The caller owns the draft (`sc`), the server's answer, the
// counters and every write; nothing here sends anything.

/** "Tap" on a touch screen, "Click" with a mouse. */
export const tapWord = () => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "Tap" : "Click");
export const ZOOM_MAX = 4;

/** A length as the scale screen says it: whole metres past 100, else one decimal. */
export const metresText = (v) => (Number(v) >= 100 ? String(Math.round(Number(v))) : Number(v).toFixed(1));

// The bar stuck to the bottom of the screen that keeps a screen's Save in view while it scrolls (the rooms list, the scale).
export const STICKY_BAR = "position:sticky;bottom:0;z-index:2;background:#0f1a12;border-top:1px solid #1b3526;padding:4px 0;margin-top:8px";

export function btn(ctx, label, on, extra = {}) {
  const b = ctx.helpers.el("button", { class: "btn inline" + (extra.primary ? " primary" : ""), style: "font-size:12px", ...(extra.attrs || {}) }, label);
  if (extra.disabled) b.disabled = true;
  b.addEventListener("click", on);
  return b;
}
export const P = (ctx, text, style = "") => ctx.helpers.el("div", { style: "font-size:13px;color:#cbd5e1;line-height:1.55;margin:6px 0;" + style }, text);
export const MUTED = (ctx, text) => ctx.helpers.el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:6px 0" }, text);
export const row = (ctx, kids, style = "") => ctx.helpers.el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0;" + style }, kids);

/** What to do, said once above the picture. */
export const measureHow = (tap) => `${tap} both ends of something you know the length of (a wall, a doorway, the whole house), then type its length. ` +
  "The longer the thing you measure, the more exact your map." + (tap === "Tap" ? " Pinch with two fingers, or use + below the plan, to look closer." : "");
/** The line under the picture: which end is next, or how to move one. */
export const endHint = (sc, tap) => (sc.pts.length < 2 ? `${tap} the ${sc.pts.length ? "other" : "first"} end on the plan.` : `Drag an end, or ${tap.toLowerCase()} near it, to move it.`);

/** A window's scroll put back once it is on the page, before it is painted (a microtask: the panel draws a screen and
 *  puts it on the page in one go), so a redraw neither jumps nor flickers. */
export function keepScroll(win, at) {
  const go = () => { win.scrollLeft = at[0]; win.scrollTop = at[1]; };
  if (typeof queueMicrotask === "function") queueMicrotask(go); else if (typeof setTimeout === "function") setTimeout(go, 0);
}

/** The plan's picture with a layer over it, 1000 units across and H down: as wide as its column, but never
 *  taller than most of the screen, so an upright plan stays whole, beside its list. `zoom` (the guided measurement's,
 *  inside its own scrolling window): that many times as big. */
export function planFrame(ctx, map, layerStyle = "", zoom = 0) {
  const { el } = ctx.helpers;
  const img = map && ctx.helpers.mapImageUrl ? ctx.helpers.mapImageUrl(map) : null;
  const w = Number((map && map.image && map.image.width) || 1000), h = Number((map && map.image && map.image.height) || 750);
  const fit = `min(100%, calc(72vh * ${w} / ${h}))`;
  const pic = el("div", { "data-aiw": "picture",
    style: `position:relative;width:${zoom > 1 ? `calc(${zoom} * ${fit})` : fit};aspect-ratio:${w}/${h};background:#0f1a12;border-radius:6px;overflow:hidden;margin:${zoom ? 0 : "8px 0"}` });
  if (img) pic.appendChild(el("img", { src: img, alt: "", style: "position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;opacity:.85" }));
  const layer = el("div", { style: "position:absolute;left:0;top:0;width:100%;height:100%;" + layerStyle });
  pic.appendChild(layer);
  return { pic, layer, H: Math.round(1000 * h / w) };
}

/** The two ends on the plan: a tap puts the first, then the second; after that a tap moves the nearer one, and either
 *  can be dragged (mouse, pen or finger: pointer events). One finger places and drags; two fingers pinch and pan the
 *  page (touch-action pinch-zoom). − and + enlarge the picture inside its own window, which keeps its place through
 *  every redraw (sc.scroll), so the printed numbers can be read. `sc`: the caller's draft (pts, zoom, scroll and the
 *  drag's own fields). `on.changed()`: an end was put down or let go; `on.redraw()`: draw again; `on.zoomed()`: zoomed
 *  in; `on.kept`: lengths already measured on this plan ([[p1, p2], ...]), drawn quietly under the one being measured. */
export function measurePicture(ctx, sc, map, on) {
  const { el } = ctx.helpers;
  const z = sc.zoom || 1;
  const { pic, layer, H } = planFrame(ctx, map, "cursor:crosshair;touch-action:pinch-zoom", z);
  const xy = (p) => [(p[0] * 1000).toFixed(1), (p[1] * H).toFixed(1)];
  let svg = `<svg viewBox="0 0 1000 ${H}" preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:100%;height:100%">`;
  const u = (v) => (v / z).toFixed(1);                             // marks keep their size on the screen when zoomed, so an end sits exactly
  for (const [a, b] of (on.kept || []).map(l => l.map(xy))) {
    svg += `<line data-aiw-kept="1" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#94a3b8" stroke-width="${u(4)}" stroke-dasharray="${u(12)} ${u(8)}"/>`;
  }
  if (sc.pts.length === 2) {
    const [a, b] = sc.pts.map(xy);
    svg += `<line data-aiw-line="1" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#000000" stroke-width="${u(9)}" stroke-opacity=".5"/>` +
      `<line data-aiw-line="2" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#f59e0b" stroke-width="${u(5)}"/>`;
  }
  sc.pts.forEach((p, i) => {
    const [x, y] = xy(p);
    svg += `<circle data-pt="${i}" cx="${x}" cy="${y}" r="${u(16)}" fill="#f59e0b" fill-opacity=".9" stroke="#ffffff" stroke-width="${u(4)}" style="cursor:grab"/>` +
      `<text x="${x}" y="${(Number(y) - 24 / z).toFixed(1)}" text-anchor="middle" font-size="${u(28)}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="${u(5)}" paint-order="stroke" pointer-events="none">${i + 1}</text>`;
  });
  svg += "</svg>";
  layer.innerHTML = svg;
  layer.setAttribute("data-aiw", "measure");
  const frac = (e) => {
    const r = layer.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))].map(v => Math.round(v * 10000) / 10000);
  };
  layer.addEventListener("click", (e) => {
    if (sc.moved) { sc.moved = false; return; }                     // the end of a drag, not a tap
    const p = e && frac(e);
    if (!p) return;
    if (sc.pts.length < 2) sc.pts.push(p);
    else {
      const d = (q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      sc.pts[d(sc.pts[0]) <= d(sc.pts[1]) ? 0 : 1] = p;
    }
    on.changed();
  });
  // One pointer at a time: an end dragged by the finger that took it; a second finger (a pinch) puts it back where it was,
  // as the browser's pointercancel does. Zoomed in, a drag on the empty plan pans the window; a tap still places an end.
  const capture = (e) => { try { if (layer.setPointerCapture && e.pointerId !== undefined) layer.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ } };
  const putBack = () => { if (sc.drag !== null && sc.dragFrom) sc.pts[sc.drag] = sc.dragFrom; sc.drag = null; sc.pan = null; sc.moved = false; on.redraw(); };
  layer.addEventListener("pointerdown", (e) => {
    if (sc.drag !== null || sc.pan) { if (e.pointerId !== sc.dragId) putBack(); return; }      // a second finger: a pinch, not a drag
    sc.moved = false;                                               // a drag's own click may never have come: every press starts afresh
    const i = e && e.target && e.target.getAttribute ? e.target.getAttribute("data-pt") : null;
    if (i === null || i === undefined) {
      if (z > 1) { sc.pan = { x: e.clientX, y: e.clientY, l: Number(view.scrollLeft) || 0, t: Number(view.scrollTop) || 0 }; sc.dragId = e.pointerId; capture(e); }
      return;
    }
    sc.drag = Number(i);
    sc.dragId = e.pointerId;
    sc.dragFrom = sc.pts[sc.drag] ? sc.pts[sc.drag].slice() : null;
    if (e.preventDefault) e.preventDefault();
    capture(e);
  });
  layer.addEventListener("pointermove", (e) => {
    if (e.pointerId !== sc.dragId) return;                          // another finger's: never moves this end
    if (sc.pan) {
      const dx = e.clientX - sc.pan.x, dy = e.clientY - sc.pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) sc.moved = true;          // a pan, not a tap
      view.scrollLeft = Math.max(0, sc.pan.l - dx); view.scrollTop = Math.max(0, sc.pan.t - dy);
      return;
    }
    if (sc.drag === null) return;
    const p = frac(e);
    if (!p) return;
    sc.pts[sc.drag] = p;
    sc.moved = true;
    // Moved in place while dragging (a redraw would drop the pointer); the screen is drawn again when it is let go.
    const c = layer.querySelector ? layer.querySelector(`circle[data-pt="${sc.drag}"]`) : null;
    const [x, y] = xy(p);
    if (c && c.setAttribute) { c.setAttribute("cx", x); c.setAttribute("cy", y); }
    for (const k of ["1", "2"]) {
      const l = layer.querySelector ? layer.querySelector(`line[data-aiw-line="${k}"]`) : null;
      if (l && l.setAttribute) { l.setAttribute(sc.drag === 0 ? "x1" : "x2", x); l.setAttribute(sc.drag === 0 ? "y1" : "y2", y); }
    }
  });
  const drop = (e) => {
    if (e && e.pointerId !== sc.dragId) return;
    if (sc.pan) { sc.pan = null; return; }
    if (sc.drag === null) return;
    sc.drag = null;
    on.changed();
  };
  layer.addEventListener("pointerup", drop);
  layer.addEventListener("pointercancel", (e) => { if (e && e.pointerId === sc.dragId && (sc.drag !== null || sc.pan)) putBack(); });   // the browser took it (a pinch)
  const view = el("div", { "data-aiw": "measure-view", style: "overflow:auto;max-width:100%;max-height:72vh;margin:8px 0" }, [pic]);
  view.addEventListener("scroll", () => { sc.scroll = [Number(view.scrollLeft) || 0, Number(view.scrollTop) || 0]; });
  if (z > 1 && sc.scroll) keepScroll(view, sc.scroll);
  const zoomTo = (nz) => {                                         // the middle of the window stays where it was
    const r = nz / z, vw = Number(view.clientWidth) || 0, vh = Number(view.clientHeight) || 0, [l, t] = sc.scroll || [0, 0];
    sc.scroll = [Math.max(0, (l + vw / 2) * r - vw / 2), Math.max(0, (t + vh / 2) * r - vh / 2)];
    sc.zoom = nz;
    if (nz > 1 && on.zoomed) on.zoomed();
    on.redraw();
  };
  return el("div", {}, [view, row(ctx, [MUTED(ctx, "Zoom:"),
    btn(ctx, "−", () => zoomTo(Math.max(1, z - 1)), { disabled: z <= 1, attrs: { "data-aiw": "zoom-out", "aria-label": "Smaller" } }),
    btn(ctx, "+", () => zoomTo(Math.min(ZOOM_MAX, z + 1)), { disabled: z >= ZOOM_MAX, attrs: { "data-aiw": "zoom-in", "aria-label": "Bigger" } })], "margin:0")]);
}

/** The length field under its label, in `side`, and the span beside it that says what it was read as (paintSaid).
 *  Typing goes to `onInput(text)`; the field is never rebuilt while it is typed in (the caller paints the answer in
 *  place). `key`: its data-aiw. */
export function lengthField(ctx, side, text, { busy = false, onInput, key = "scale-length", label = "Its length:" }) {
  const { el } = ctx.helpers;
  const len = el("input", { type: "text", maxlength: "40", "data-aiw": key, placeholder: "e.g. 4.2 m or 13' 9\"",
    style: "flex:0 1 180px;min-width:120px;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:14px" });
  len.value = text;
  if (busy) len.disabled = true;
  len.addEventListener("input", () => onInput(String(len.value || "")));
  const said = el("span", { "data-aiw": key === "scale-length" ? "scale-understood" : key + "-understood", style: "font-size:13px" });
  side.appendChild(el("label", { style: "display:block;font-size:13px;color:#cbd5e1;margin:8px 0 4px" }, label));
  side.appendChild(row(ctx, [len, said], "margin:0 0 8px"));
  return { len, said };
}

/** What the server made of a typed length (its `i`th): the metres, with the unit a bare number was read in, or why it
 *  isn't a length. Nothing while the field is empty. */
export function paintSaid(said, text, pv, i = 0) {
  const m = pv && Array.isArray(pv.metres) && pv.metres[i];
  const unit = pv && Array.isArray(pv.assumed) && pv.assumed[i];
  said.textContent = !String(text || "").trim() ? "" : m ? `= ${Number(m).toFixed(2)} m${unit ? ` (read as ${unit})` : ""}` : (pv && pv.invalid) || "";
  said.style.color = m ? "#a7f3d0" : "#f59e0b";
}

/** The whole picture's size from the measurement (margins and all: it is the picture, not the house), and a size no
 *  house has said plainly (`odd`: said, never refused). */
export function sizeLines(ctx, pv) {
  const { el } = ctx.helpers;
  const lines = [P(ctx, `The whole picture, margins and all, will be ${metresText(pv.across_m)} m across and ${metresText(pv.down_m)} m down.`, "font-weight:600")];
  if (pv.odd) {
    const big = pv.across_m > 100 || pv.across_m < 2 ? ["across", pv.across_m] : ["down", pv.down_m];
    lines.push(el("div", { "data-aiw": "scale-odd", style: "font-size:12px;color:#f59e0b;line-height:1.5;margin:4px 0" },
      `That makes your plan ${metresText(big[1])} m ${big[0]}. Is the number right? You can change it, or save it as it is.`));
  }
  return lines;
}
