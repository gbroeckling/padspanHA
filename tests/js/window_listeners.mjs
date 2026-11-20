// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Listeners on window across redraws. dom_shim.mjs gives window an
// addEventListener that does nothing, so this puts a counting one in its
// place (it honours { signal }, as a browser does) and redraws:
//   * Mapping → Edit (views/maps.js): every redraw rebuilds the receiver
//     markers, each draggable. A drag still moves its receiver and a tap still
//     selects it; window holds a marker's listeners only while it is held.
//   * Mapping → Rooms (views/maps.js) and the shared pan/zoom
//     (views/pan_zoom.js): a redraw attaches a new viewport, and the one
//     before it gives up its window listeners.
// The pytest wrapper is tests/test_window_listeners.py.
//
// Run:  node tests/js/window_listeners.mjs <views-dir>
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install, flush } from "./dom_shim.mjs";

const VIEWS_DIR = process.argv[2];
install(globalThis);

const live = [];   // { type, fn } for every listener window holds right now
globalThis.addEventListener = (type, fn, opts) => {
  const row = { type, fn };
  live.push(row);
  const signal = opts && typeof opts === "object" ? opts.signal : null;
  if (signal) signal.addEventListener("abort", () => { const i = live.indexOf(row); if (i >= 0) live.splice(i, 1); });
};
globalThis.removeEventListener = (type, fn) => {
  const i = live.findIndex((r) => r.type === type && r.fn === fn);
  if (i >= 0) live.splice(i, 1);
};
const fireWindow = (type, props = {}) => {
  const ev = { type, preventDefault() {}, stopPropagation() {}, ...props };
  for (const r of live.filter((x) => x.type === type)) r.fn(ev);
};
const fireOn = (node, type, props = {}) => node.dispatchEvent({ type, target: node, preventDefault() {}, stopPropagation() {}, ...props });

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive || k === "toString" ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});

const PLAN = () => ({
  id: "m1", name: "Main floor", floor_id: "main", image: { width: 800, height: 1200 },
  receivers: [
    { id: "rx1", label: "Hall", x: 0.5, y: 0.5, room: "Kitchen" },
    { id: "rx2", label: "Den", x: 0.2, y: 0.7, room: "Kitchen" },
    { id: "rx3", label: "Porch", x: 0.8, y: 0.3, room: "Kitchen" },
  ],
  room_bounds: { Kitchen: { type: "poly", points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]] } },
});

function makeCtx(mapsTab) {
  const state = {
    complexity: "advanced", mapsTab, settings: {}, dataMode: "live", _dataModeKnown: true, view: "maps", activeMapId: "m1",
    maps: { list: [PLAN()] },
    model: {
      floors: [{ id: "main", name: "Main", level: 0 }],
      map_transforms: { m1: { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 10 } },
      areas: [{ name: "Kitchen", floor_id: "main" }],
      room_geometry_m: { Kitchen: { type: "poly", floor_id: "main", points_m: [[1, 1], [9, 1], [9, 9], [1, 9]] } },
      scanner_positions_m: { rx1: { x_m: 5, y_m: 5, floor_id: "main" } },
    },
  };
  return {
    state,
    hass: { states: {}, user: { is_admin: true } },
    helpers: new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"), roomColor: () => "#52b788",
      mapImageUrl: () => "/x.png", pill: (t) => el("span", {}, String(t ?? "")) },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    actions: new Proxy({ renderRooms: () => {},
      // Rooms asks for the floor's other layouts; none here, so it draws the saved one.
      wsCall: async (type) => { if (type === "padspan_ha/fabric_truth_candidates") throw new Error("none"); return {}; }, callWS: async () => ({}), mapsSetActive: () => {} },
      { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: () => {},
  };
}

function walk(node, visit) { visit(node); for (const c of node.childNodes || []) walk(c, visit); }
function all(node, pred) { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; }
const tool = (root, t) => all(root, (n) => n.getAttribute && n.getAttribute("data-edit-tool") === t)[0];
const markers = (root) => all(root, (n) => n.classList && n.classList.contains("marker"));

const maps = await import(pathToFileURL(join(VIEWS_DIR, "maps.js")).href);
const { attachPanZoom } = await import(pathToFileURL(join(VIEWS_DIR, "pan_zoom.js")).href);

// ── Mapping → Edit: receiver markers ─────────────────────────────────────────
{
  const ctx = makeCtx("edit");
  const root = maps.render(ctx); await flush();
  const first = live.length;
  check("edit: three markers are drawn", markers(root).length === 3, markers(root).length);
  const counts = [];
  for (const t of ["rooms", "receivers", "barriers", "receivers", "rooms", "receivers"]) {
    tool(root, t).click(); await flush();
    counts.push(live.length);
  }
  check("edit: six redraws leave window with the listeners it had", counts.every((c) => c === first), { first, counts });
  check("edit: an idle marker keeps nothing on window", !live.some((r) => /^(mouse|touch)/.test(r.type)), live.map((r) => r.type));

  // A drag: held, moved past the tap distance, let go. The stage is 800 x 600 here.
  const rx = () => ctx.state.maps._draftReceivers.find((r) => r.id === "rx2");
  let mk = markers(root)[1];
  fireOn(mk, "mousedown", { clientX: 160, clientY: 420 });
  const held = live.length - first;
  check("edit: a held marker listens on window", held === 5 && ctx.state.maps._editDragging === true, { held, dragging: ctx.state.maps._editDragging });
  fireWindow("mousemove", { clientX: 400, clientY: 150 });
  check("edit: the drag moves its receiver", rx().x === 0.5 && rx().y === 0.25, rx());
  fireWindow("mouseup", {});
  await flush();
  check("edit: letting go ends the drag and clears window", live.length === first && ctx.state.maps._editDragging === false,
    { live: live.length, first, dragging: ctx.state.maps._editDragging });
  check("edit: the marker is redrawn where it was dropped", markers(root)[1].style.left === "50%" && markers(root)[1].style.top === "25%",
    [markers(root)[1].style.left, markers(root)[1].style.top]);

  // A tap (no movement) selects, and moves nothing.
  mk = markers(root)[2];
  fireOn(mk, "touchstart", { touches: [{ clientX: 640, clientY: 180 }] });
  fireWindow("touchmove", { touches: [{ clientX: 643, clientY: 182 }] });
  fireWindow("touchend", {});
  await flush();
  const rx3 = ctx.state.maps._draftReceivers.find((r) => r.id === "rx3");
  check("edit: a tap selects its receiver and does not move it", ctx.state.maps._selectedRxId === "rx3" && rx3.x === 0.8 && rx3.y === 0.3 && live.length === first,
    { sel: ctx.state.maps._selectedRxId, rx3, live: live.length });

  // A gesture the system cancels is released the same way.
  fireOn(markers(root)[0], "touchstart", { touches: [{ clientX: 400, clientY: 300 }] });
  fireWindow("touchcancel", {});
  await flush();
  check("edit: a cancelled touch releases the drag", ctx.state.maps._editDragging === false && live.length === first, { live: live.length, first });

  // Redrawn while held (an answer from the server arriving mid-drag): the drag in hand still ends.
  fireOn(markers(root)[0], "mousedown", { clientX: 400, clientY: 300 });
  tool(root, "receivers").click(); await flush();
  check("edit: a redraw while held keeps the drag's own listeners", live.length === first + 5, { live: live.length, first });
  fireWindow("mouseup", {});
  await flush();
  check("edit: and its release still ends it", ctx.state.maps._editDragging === false && live.length === first, { live: live.length, first });

  // Another tool: a press on a marker starts nothing.
  tool(root, "rooms").click(); await flush();
  fireOn(markers(root)[0], "mousedown", { clientX: 400, clientY: 300 });
  check("edit: outside the Receivers tool a press starts no drag", live.length === first && !ctx.state.maps._editDragging, { live: live.length, first });
}

// ── Mapping → Rooms: the stage's pan/zoom ────────────────────────────────────
{
  const ctx = makeCtx("rooms");
  const stages = (root) => all(root, (n) => n.classList && n.classList.contains("mapstage"));
  let root = maps.render(ctx); await flush();
  check("rooms: the stage is drawn", stages(root).length === 1, stages(root).length);
  const first = live.filter((r) => /^mouse/.test(r.type)).length;
  const counts = [];
  for (let i = 0; i < 6; i++) {
    root = maps.render(ctx); await flush();
    counts.push(live.filter((r) => /^mouse/.test(r.type)).length);
  }
  check("rooms: six redraws leave window with the mouse listeners it had", first === 2 && counts.every((c) => c === first), { first, counts });
}

// ── the shared pan/zoom ──────────────────────────────────────────────────────
{
  const before = live.length;
  const make = (opts) => {
    const viewport = document.createElement("div"), inner = document.createElement("div");
    viewport.appendChild(inner);
    return { viewport, inner, pz: attachPanZoom(viewport, inner, opts) };
  };
  const a = [];
  for (let i = 0; i < 8; i++) a.push(make({ slot: "test-a" }));
  check("pan/zoom: eight attachments in one slot hold two window listeners", live.length === before + 2, live.length - before);
  const b = make({ slot: "test-b" });
  check("pan/zoom: another slot is left alone", live.length === before + 4, live.length - before);

  const drag = (v) => {
    fireOn(v.viewport, "mousedown", { button: 0, clientX: 10, clientY: 10 });
    fireWindow("mousemove", { clientX: 40, clientY: 30 });
    fireWindow("mouseup", {});
    return v.inner.style.transform;
  };
  check("pan/zoom: the newest in a slot pans", drag(a[7]) === "translate(30px, 20px) scale(1)", a[7].inner.style.transform);
  check("pan/zoom: the other slot's pans too", drag(b) === "translate(30px, 20px) scale(1)", b.inner.style.transform);
  check("pan/zoom: a mouse button let go anywhere puts the hand cursor back", (() => {
    b.viewport.style.cursor = ""; fireWindow("mouseup", {}); return b.viewport.style.cursor === "grab";
  })(), b.viewport.style.cursor);
  check("pan/zoom: one replaced by a redraw no longer follows the mouse", drag(a[0]) === "", a[0].inner.style.transform);
}

process.stdout.write(JSON.stringify(results) + "\n", () => process.exit(0));
