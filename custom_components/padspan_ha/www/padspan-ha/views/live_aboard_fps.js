// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The frame-rate readout over the 3D house (Settings → Live Aboard → Frame
// rate, this browser only, off by default): the frames drawn over each second, read off
// the view's own frame counter, and "0 fps at rest" while nothing is
// redrawing. Asks for no frame itself: once a second it reads the count and
// writes one line of text. Off, there is no element and no timer, so the
// view is exactly as it was. Imports no three.js.

export const FPS_MS = 1000;           // how often the readout is read again
export const FPS_CSS = `.la3d-fps{position:absolute;right:12px;bottom:60px;z-index:3;padding:3px 9px;border-radius:999px;
  background:rgba(6,14,9,.72);border:1px solid rgba(120,190,155,.26);color:#e2e8f0;
  font:600 11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:none;white-space:nowrap}`;

/** What the readout says for n frames over ms milliseconds. */
export function fpsText(n, ms){
  if (!(n > 0) || !(ms > 0)) return "0 fps at rest";
  return `${Math.max(1, Math.round(n * 1000 / ms))} fps`;
}

/** The readout: {sync(on), state(), dispose()}. root: the view's element;
 *  frames(): the view's frame counter; now(): the clock (performance.now). */
export function createFpsReadout({ root, frames, now }){
  let el = null, timer = null, n0 = 0, t0 = 0;
  const stop = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  };
  const tick = () => {
    timer = null;
    if (!el) return;
    const n = frames(), t = now();
    el.textContent = fpsText(n - n0, t - t0);
    n0 = n; t0 = t;
    timer = setTimeout(tick, FPS_MS);
  };
  return {
    sync(on){
      if (!on || !root) { stop(); return; }
      if (el) return;
      el = document.createElement("div");
      el.className = "la3d-fps";
      el.setAttribute("data-la3d-fps", "");
      el.setAttribute("aria-hidden", "true");
      el.textContent = "… fps";
      root.appendChild(el);
      n0 = frames(); t0 = now();
      timer = setTimeout(tick, FPS_MS);
    },
    state(){ return { on: !!el, text: el ? el.textContent : "", timer: timer !== null }; },
    dispose(){ stop(); },
  };
}
