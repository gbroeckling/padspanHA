// pan_zoom.js under a small event-path DOM (#90).
//
// dom_shim.mjs dispatches nothing, so this builds the one thing the bugs are
// about: an event goes to its target and up through parentNode, and a node a
// redraw took out of the page no longer reaches the viewport or window. Runs
// the SHIPPED attachPanZoom: a touch pan whose node is replaced mid-gesture,
// a beacon touched after it, a pinch, and the mouse/wheel/keyboard/
// double-click paths every caller (Pin & Listen, Roam, Rooms, Beacon Tune)
// shares.
//
// Run: node tests/js/pan_zoom_touch.mjs <views dir>
// Prints one JSON line: { <scenario>: {scale, tx, ty, ...} }.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const winL = {};
globalThis.window = {
  addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
  removeEventListener(t, f) { winL[t] = (winL[t] || []).filter(x => x !== f); },
};
const ROOT = { parentNode: null, _root: true, l: {} };

class El {
  constructor(parent, attrs = {}) { this.parentNode = parent; this.attrs = attrs; this.l = {}; this.style = {};
    this.offsetLeft = 0; this.offsetTop = 0; this.tabIndex = -1; }
  addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
  removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter(x => x !== f); }
  closest(sel) {
    for (let n = this; n && n instanceof El; n = n.parentNode) {
      if (sel.split(",").some(s => /^\[[\w-]+\]$/.test(s.trim()) && s.trim().slice(1, -1) in n.attrs)) return n;
    }
    return null;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; }
}

// target, then each ancestor, then window if the path reaches the page.
function fire(target, type, props = {}) {
  const ev = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}, ...props };
  let n = target;
  for (; n; n = n.parentNode) {
    for (const f of [...((n.l || {})[type] || [])]) f(ev);
    if (n._root) for (const f of [...(winL[type] || [])]) f(ev);
  }
  return ev;
}
const pt = (x, y) => ({ clientX: x, clientY: y });

const { attachPanZoom } = await import(pathToFileURL(join(process.argv[2], "pan_zoom.js")).href);

function setup(opts) {
  const viewport = new El(ROOT);
  const inner = new El(viewport);
  inner.offsetLeft = 8; inner.offsetTop = 8;  // the viewport's padding, as Beacon Tune's
  const svg = new El(inner);
  const beacon = new El(svg, { "data-bk-id": "bk1" });
  const lightPin = new El(svg, { "data-light-pin": "p1" });
  const pz = attachPanZoom(viewport, inner, opts);
  return { viewport, inner, svg, beacon, lightPin, pz, st: () => ({ ...pz.getState(), transform: inner.style.transform }) };
}

const out = {};

// A touch pan; mid-gesture the 1 s redraw replaces the SVG it started on.
{
  const T = setup({ exclude: "[data-bk-id]", dblclickReset: false });
  fire(T.svg, "touchstart", { touches: [pt(100, 100)] });
  fire(T.svg, "touchmove", { touches: [pt(150, 100)] });
  const mid = T.st();
  T.svg.parentNode = null;                       // innerHTML = ... : out of the page
  const svg2 = new El(T.inner);
  const beacon2 = new El(svg2, { "data-bk-id": "bk1" });
  fire(T.svg, "touchmove", { touches: [pt(200, 120)] });
  const afterRedraw = T.st();
  fire(T.svg, "touchend", { touches: [] });
  // Then a beacon is dragged: the map must not move under it.
  fire(beacon2, "touchstart", { touches: [pt(300, 200)] });
  const mv = fire(beacon2, "touchmove", { touches: [pt(10, 10)] });
  fire(beacon2, "touchend", { touches: [] });
  out.replacedNode = { mid, afterRedraw, afterBeacon: T.st(), beaconMovePrevented: mv.defaultPrevented,
    listenersLeft: (T.svg.l.touchmove || []).length + (T.svg.l.touchend || []).length };
}

// The same, never latched even when the end is lost entirely.
{
  const T = setup({ exclude: "[data-bk-id]", dblclickReset: false });
  fire(T.svg, "touchstart", { touches: [pt(100, 100)] });
  fire(T.svg, "touchmove", { touches: [pt(140, 100)] });
  T.svg.parentNode = null;                       // and no touchend at all
  const svg2 = new El(T.inner);
  const beacon2 = new El(svg2, { "data-bk-id": "bk1" });
  fire(beacon2, "touchstart", { touches: [pt(300, 200)] });
  fire(beacon2, "touchmove", { touches: [pt(10, 10)] });
  out.lostEnd = T.st();
}

// Pinch about (150, 100): the content under the fingers' centre stays put.
{
  const T = setup();
  fire(T.svg, "touchstart", { touches: [pt(100, 100), pt(200, 100)] });
  fire(T.svg, "touchmove", { touches: [pt(50, 100), pt(250, 100)] });
  const s = T.pz.getState();
  // content point that was under (150,100) at scale 1: (150-8, 100-8)
  out.pinch = { ...s, centreX: 8 + s.tx + s.scale * 142, centreY: 8 + s.ty + s.scale * 92 };
  fire(T.svg, "touchend", { touches: [pt(250, 100)] });
  fire(T.svg, "touchend", { touches: [] });
  out.pinchCleanup = (T.svg.l.touchmove || []).length;
}

// Shared paths, as before: mouse pan, wheel at the cursor, keys, double-click.
{
  const T = setup();
  fire(T.svg, "mousedown", { button: 0, ...pt(10, 10) });
  for (const f of winL.mousemove) f(pt(40, 30));
  for (const f of winL.mouseup) f({});
  out.mouse = T.st();
  fire(T.svg, "wheel", { deltaY: -1, ...pt(108, 58) });
  out.wheel = T.st();
  fire(T.viewport, "keydown", { key: "ArrowLeft" });
  fire(T.viewport, "keydown", { key: "+" });
  out.keys = T.st();
  fire(T.svg, "dblclick", {});
  out.dblclick = T.st();
  // a one-finger pan on an attached node moves once, not twice
  fire(T.svg, "touchstart", { touches: [pt(0, 0)] });
  fire(T.svg, "touchmove", { touches: [pt(25, 5)] });
  fire(T.svg, "touchend", { touches: [] });
  out.touchPan = T.st();
  // a drag handle never pans
  fire(T.lightPin, "mousedown", { button: 0, ...pt(0, 0) });
  for (const f of winL.mousemove) f(pt(90, 90));
  for (const f of winL.mouseup) f({});
  out.handle = T.st();
}
{
  const T = setup({ dblclickReset: false });
  fire(T.svg, "touchstart", { touches: [pt(0, 0)] });
  fire(T.svg, "touchmove", { touches: [pt(30, 0)] });
  fire(T.svg, "touchend", { touches: [] });
  fire(T.svg, "dblclick", {});
  out.noDblReset = T.st();
}

console.log(JSON.stringify(out));
