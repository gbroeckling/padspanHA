// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// "No floor plan?" (owner, 2026-11-16): the ways to a plan for someone who has none, each with its steps, opened from
// Mapping → Upload. Every picture uploaded is still taken for a proper, to-scale plan; this is only for the person who
// says they have none. The kinds, in the order they are worth trying:
//   have    a drawing that already exists somewhere (the builder's, the listing's)
//   scan    a room scan from an iPhone or iPad with LiDAR (Apple's RoomPlan: the .usdz every such app shares, or its
//           JSON), read on the server (padspan_ha/maps_scan_create) into a plan drawn to scale, nothing to measure
//   vacuum  a robot vacuum's map (its own import, behind its setting)
//   sketch  the person's own drawing, photographed: uploaded as any picture, ticked "my own sketch" (not to scale: the
//           scale screen then takes a length each way, scale_nudge.js)
//   blank   nothing at all: a blank floor of the width and depth typed (padspan_ha/maps_blank_create), to scale
// `opts` of render: floors [[id, name]] and floorId() (the floor chosen on the upload card: the one a scan or a blank
// floor starts on; each asks for its own, so nothing here points at another part of the page), toBase64(file),
// onMade(map) (a scan or a blank floor was saved: go on to its rooms), onSketch() (tick "my own sketch" on the upload
// card), vacuumOn. The list opens straight under its own button, above the upload form the first and fourth ways use.
// Counted as words only (telemetry.ROUGH_PLAN_WORDS): opened, each kind opened, and what came of a scan or a blank floor.

const V = new URL(import.meta.url).search;
const PM = await import(`./plan_measure.js${V}`);
const { btn, P, MUTED, row } = PM;

export const LINK = "No floor plan? Ways to get one";
export const KINDS = Object.freeze(["have", "scan", "vacuum", "sketch", "blank"]);
export const SCAN_MAX_BYTES = 2_800_000;      // the server's cap is on the base64 (ws_maps.SCAN_MAX_B64)

const TITLES = {
  have: ["Look for a drawing you already have", "The quickest, and the most exact."],
  // The scan gives the floor's walls, not its rooms (owner, 2026-11-16: in an open house a room is a matter of opinion).
  scan: ["Scan the floor with an iPhone or iPad", "For a Pro model with LiDAR. Exact walls, and nothing to measure. You still say where each room is."],
  vacuum: ["Use your robot vacuum's map", "If the robot has already mapped the floor."],
  sketch: ["Draw it yourself and photograph it", "Rough is fine: rooms are told apart by calibration, not by the drawing."],
  blank: ["Start from a blank floor", "No picture at all: type the floor's size and draw the rooms on a grid."],
};
const STEPS = {
  have: [
    "Places to look: the builder's or architect's drawings, the real-estate listing, the strata or council file, an insurance or appraisal report, the fire-escape plan on a wall.",
    "A photo or a screenshot of it is enough. Hold the camera straight over the page so the drawing isn't slanted, and fill the frame with it.",
    "Upload it with the form below. You'll set its scale from one length you know, then draw the rooms over it.",
  ],
  scan: [
    "You need an iPhone or iPad Pro with LiDAR (iPhone 12 Pro or newer Pro, iPad Pro 2020 or newer). Someone else's will do: they scan, and send you the file.",
    "Install a room-scanning app that uses Apple's RoomPlan (search the App Store for \"RoomPlan\" or \"LiDAR room scanner\"). Any of them can share the scan as a USDZ file.",
    "Scan one floor in one go if the app allows it: walk slowly round each room, point at every wall, and go through the doorways without stopping the scan. Doors open, lights on.",
    "Share or export the scan as USDZ (some apps also offer \"RoomPlan JSON\": that works too), and get the file onto this device.",
    "Say which floor it is and pick the file, just below. PadSpan draws the plan from the scan's walls, to scale, with nothing to measure.",
  ],
  vacuum: [
    "A robot vacuum that Home Assistant can see (Valetudo, Dreame or Xiaomi) has a map of the floor it cleans.",
    "Turn on Settings → Features → Robot Vacuum Import, then use Mapping → Layout → \"Import from a robot vacuum\". It becomes a floor plan with its rooms.",
  ],
  sketch: [
    "On plain paper, draw the outside walls of the floor first, as one shape. Then the walls between rooms, and a gap for each doorway.",
    "Keep the proportions as true as you can, and write the length of one long wall running across and one running down. You'll type those two in.",
    "Photograph it from straight above, the page filling the frame, in even light.",
    "Press the button below: it ticks \"my own sketch\" on the upload form for you. PadSpan then takes a length each way, so each direction gets its own scale.",
  ],
  blank: [
    "Pace or measure the floor's outside walls: its width and its depth. Rough numbers are fine; you can measure again later.",
    "PadSpan makes an empty floor of that size with a line every metre. Draw each room on it by its corners, counting the lines.",
  ],
};

const tel = (ctx, w) => { if (ctx.state.dataMode === "live" && ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("rough_plan:" + w); };
const st = (ctx) => ctx.state._roughPlan || (ctx.state._roughPlan = { open: false, kind: null, across: "", down: "", busy: false, msg: "", walk: null });
const redraw = (ctx) => ctx.actions.renderRooms();

// Counted once a page each (telemetry.ROUGH_PLAN_WALK): the button shown, a walk-through screen reached.
const _once = new Set();
const once = (ctx, w) => { if (!_once.has(w)) { _once.add(w); tel(ctx, w); } };
export function _resetCounts() { _once.clear(); }      // a test's new page
const REFUSED = { too_large: "size", unreadable: "unreadable", not_scan: "not_scan", empty: "empty" };
const wallsBand = (n) => (n <= 4 ? "1_4" : n <= 12 ? "5_12" : n <= 30 ? "13_30" : "gt30");
const onPhone = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
// Rooms on a scanned plan (owner, 2026-11-16: a drawn room is the person's decision and comes first; the scan's own
// outline is an option beside it). A corner clicked close to a scanned wall end lands on it, and a scanned room's
// outline can be taken whole for the room chosen. Both read the plan's own `scan.rooms` (fractions of the picture).
export const SNAP_FRAC = 0.02;    // how close, as a share of the picture's width, a click must be to a scanned corner
const scanRooms = (map) => (map && map.kind === "scan" && map.scan && Array.isArray(map.scan.rooms) ? map.scan.rooms : []).filter(r => Array.isArray(r.points) && r.points.length >= 3);
export const hasScanRooms = (map) => scanRooms(map).length > 0;
/** The scanned corner nearest [x, y] (fractions) within SNAP_FRAC, or null. */
export function scanCorner(map, x, y) {
  const ar = map && map.image && map.image.width > 0 && map.image.height > 0 ? map.image.height / map.image.width : 1;
  let best = null, bd = SNAP_FRAC;
  for (const r of scanRooms(map)) for (const p of r.points) {
    const d = Math.hypot(p[0] - x, (p[1] - y) * ar);
    if (d < bd) { bd = d; best = [p[0], p[1]]; }
  }
  return best;
}
/** The outline of the scanned room [x, y] is inside (the smallest, where they overlap), or null. */
export function scanRoomAt(map, x, y) {
  const inside = (pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0));
  const hit = scanRooms(map).filter(r => inside(r.points)).sort((a, b) => area(a.points) - area(b.points))[0];
  return hit ? hit.points.map(p => [p[0], p[1]]) : null;
}
/** Counted: a corner landed on a scanned wall end (once a page), a scanned outline taken for a room. */
export const scanCounted = (ctx, w) => (w === "scan_snap" ? once(ctx, w) : tel(ctx, w));
export const SIZE_OFF = 0.1;      // a drawn room this far from the scan's measured size (either way) is said to be off
/** How far a drawn room's size is from the scan's, as a share (the two compared long side to long side). */
const sizeOff = (p) => { const a = [...(p.size_scan_m || [])].sort((x, y) => x - y), b = [...(p.size_room_m || [])].sort((x, y) => x - y);
  return a.length === 2 && b.length === 2 && b[0] > 0 && b[1] > 0 ? Math.max(Math.abs(a[0] - b[0]) / b[0], Math.abs(a[1] - b[1]) / b[1]) : 0; };
/** What came of placing the scan among the floor's rooms (the server's `placed`), in words; "" where the floor has none. */
export function placedWords(ctx, p) {
  if (!p) return "";
  if (!p.fit) return " It couldn't be matched to this floor's rooms, so it starts where every new plan does: line it up in Mapping → 3D Stack.";
  const L = (m) => PM.lengthText(m, PM.feetOn(ctx)), where = p.room || "this floor's rooms";
  let t = ` It was placed over ${where}`;
  if (p.room && p.size_scan_m && p.size_room_m) {
    const [a, b] = [...p.size_scan_m].sort((x, y) => y - x), [c, d] = [...p.size_room_m].sort((x, y) => y - x);
    t += `: the scan measures ${L(a)} by ${L(b)}, and ${p.room} is drawn ${L(c)} by ${L(d)}` + (sizeOff(p) > SIZE_OFF ? ". The scan is the measured one, so the drawn room is off" : "");
  }
  t += ".";
  if (p.fits_both_ways) t += " Its outline fits both ways round: check its doors are on the right walls, and turn it in Mapping → 3D Stack if not.";
  return t;
}

/** The quiet line on the upload card. */
export function link(ctx) {
  const { el } = ctx.helpers, s = st(ctx);
  once(ctx, "seen");
  const a = el("button", { class: "btn inline", "data-rough": "link", style: "font-size:12px" }, s.open ? "Hide the ways to get a floor plan" : LINK);
  a.addEventListener("click", () => { s.open = !s.open; if (s.open) tel(ctx, "opened"); redraw(ctx); });
  return el("div", { style: "margin:8px 0" }, [a]);
}
export const isOpen = (ctx) => st(ctx).open;

async function makeBlank(ctx, opts) {
  const s = st(ctx);
  s.busy = true; s.msg = ""; redraw(ctx);
  let r;
  try { r = await ctx.actions.callWS({ type: "padspan_ha/maps_blank_create", floor_id: s.floor, across: String(s.across).trim(), down: String(s.down).trim() }); }
  catch (e) { r = { ok: false, message: (e && e.message) || "That didn't work. Try again in a moment." }; }
  s.busy = false;
  if (!r || r.ok === false) { tel(ctx, "blank_refused"); s.msg = (r && r.message) || "The blank floor couldn't be made."; redraw(ctx); return; }
  tel(ctx, "blank_made");
  Object.assign(s, { open: false, kind: null, across: "", down: "" });
  await opts.onMade(r.map);
}

async function readScan(ctx, opts, file) {
  const s = st(ctx);
  if (!file) return;
  if (file.size > SCAN_MAX_BYTES) { tel(ctx, "scan_refused"); tel(ctx, "scan_refused_size"); s.msg = "This file is too large to be a room scan (2.8 MB at most). A scan of a whole floor is usually under 2 MB: in the scanning app, share the room scan itself (USDZ), not a 3D photo model of it."; redraw(ctx); return; }
  s.busy = true; s.msg = ""; redraw(ctx);
  let r;
  try { r = await ctx.actions.callWS({ type: "padspan_ha/maps_scan_create", floor_id: s.floor, file_base64: await opts.toBase64(file),
    name: String(file.name || "").replace(/\.[^.]+$/, "").slice(0, 120) }); }
  catch (e) { r = { ok: false, message: (e && e.message) || "That didn't work. Try again in a moment." }; }
  s.busy = false;
  if (!r || r.ok === false) {
    tel(ctx, "scan_refused");
    tel(ctx, "scan_refused_" + (REFUSED[r && r.code] || "unreadable"));
    s.msg = (r && r.message) || "The scan couldn't be read."; redraw(ctx); return;
  }
  tel(ctx, "scan_made");
  tel(ctx, r.file === "json" ? "scan_json" : "scan_usdz");
  tel(ctx, "scan_walls_" + wallsBand(Number(r.walls) || 0));
  if (r.named) tel(ctx, "scan_named");
  if (onPhone()) tel(ctx, "scan_phone");
  if (r.placed) {
    tel(ctx, r.placed.fit ? (r.placed.fits_both_ways ? "scan_placed_both" : "scan_placed") : "scan_unplaced");
    if (r.placed.fit && sizeOff(r.placed) > SIZE_OFF) tel(ctx, "scan_size_differs");
  }
  const where = placedWords(ctx, r.placed);
  if (walking(ctx)) {                          // the walk-through says so itself, on its last screen
    Object.assign(s, { walk: WALK.length, made: { id: r.map.id, walls: r.walls, where } });
    if (ctx.actions.mapsRefresh) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
    redraw(ctx);
    return;
  }
  Object.assign(s, { open: false, kind: null });
  if (ctx.toast) ctx.toast(`Scan read: ${r.walls} wall${r.walls === 1 ? "" : "s"}, drawn to scale. Its scale is set.${where}`);
  await opts.onMade(r.map);
}

/** "Which floor is it?": the floors of the house, starting on the one the upload form has chosen. */
function floorPick(ctx, opts, big = false) {
  const { el } = ctx.helpers, s = st(ctx), floors = opts.floors || [];
  if (!floors.some(([id]) => id === s.floor)) s.floor = floors.some(([id]) => id === (opts.floorId && opts.floorId())) ? opts.floorId() : ((floors[0] || [])[0] || "");
  const sel = el("select", { class: "select", "data-rough": "floor", style: big ? "font-size:16px;min-height:44px;max-width:100%" : "max-width:100%" });
  for (const [id, name] of floors) { const o = el("option", { value: id }, name); if (id === s.floor) o.selected = true; sel.appendChild(o); }
  sel.addEventListener("change", () => { s.floor = sel.value; });
  return sel;
}

/** The scan's file picker. No `accept`: an iPhone greys out a .usdz in Files when the list names extensions only. */
function scanFile(ctx, opts) {
  const { el } = ctx.helpers, s = st(ctx);
  const file = el("input", { type: "file", "data-rough": "scan-file", style: (walking(ctx) ? "font-size:17px;padding:10px 0;" : "font-size:14px;") + "max-width:100%" });
  if (s.busy) file.disabled = true;
  file.addEventListener("change", () => readScan(ctx, opts, file.files && file.files[0]));
  return file;
}

// ── The walk-through (owner, 2026-11-16: "so my wife can be guided through this on her phone") ─────────────────────
// One step a screen, big buttons, nothing else of Mapping round it (maps.js shows only this while it runs). Opened by
// "Guide me step by step", or straight from a link: /padspan-ha?view=maps&guide=scan (panel.js).
export const WALK = Object.freeze([
  ["Is this the right phone?", ["You need an iPhone 12 Pro or newer Pro model, or an iPad Pro from 2020 or newer. They have a LiDAR sensor: a small black dot beside the camera lenses.",
    "A phone without it can't do this. Borrow one that has it, or close this and choose another way to get a plan."]],
  ["Get a room-scanning app", ["Open the App Store and search for \"RoomPlan\" or \"LiDAR room scanner\".",
    "Pick one that says it can export or share a USDZ file. Most can, and several are free.", "Install it, open it once and allow it to use the camera."]],
  ["Get the house ready", ["Open every door on this floor, and turn the lights on.", "Start at one end of the floor, with the battery charged. You'll walk through every room on this floor in one go."]],
  ["Scan the floor", ["Start a new room scan in the app. Hold the phone upright and move slowly.",
    "In each room, turn right round so the phone sees every wall from floor to ceiling. White lines appear on the walls it has found.",
    "Walk through each doorway into the next room without stopping the scan, if the app lets you. One scan for the whole floor is best.",
    "When every room on this floor is done, press Done or Finish in the app."]],
  ["Save the scan as a file", ["In the app, press Share or Export and choose USDZ.", "Choose \"Save to Files\", and remember where you put it (\"On My iPhone\" is fine).",
    "Then come back to this page."]],
  ["Give the scan to PadSpan", ["Choose which floor you scanned, then press the button below and pick the file you just saved."]],
]);
export const walking = (ctx) => { const s = ctx.state._roughPlan; return !!s && typeof s.walk === "number"; };
export const walkLink = () => `${(typeof location !== "undefined" && location.origin) || ""}/padspan-ha?view=maps&guide=scan`;
export function startWalk(ctx) { const s = st(ctx); Object.assign(s, { walk: 0, msg: "", made: null }); tel(ctx, "walk"); redraw(ctx); }
const BIG = "font-size:16px;padding:12px 18px;min-height:48px";

/** The walk-through's screen. `opts`: toBase64(file), floors [[id, name]], onMade(map) (see the plan), onClose(). */
export function walk(ctx, opts) {
  const { el } = ctx.helpers, s = st(ctx), n = WALK.length;
  const card = el("div", { class: "card", "data-rough": "walk", style: "max-width:560px;margin:0 auto" });
  const close = () => { if (s.walk < n) tel(ctx, "walk_closed"); Object.assign(s, { walk: null, made: null, msg: "" }); opts.onClose(); };
  if (s.linked) { s.linked = false; tel(ctx, "walk"); tel(ctx, "walk_link"); }       // opened by its address (panel.js)
  if (s.walk > 0 && s.walk < n) once(ctx, "walk_" + (s.walk + 1));
  if (s.walk >= n) {                                      // the scan is in
    const made = s.made || {};
    once(ctx, "walk_done");
    card.appendChild(el("div", { class: "h2", "data-rough": "walk-done", style: "font-size:20px" }, "Done: the plan is drawn"));
    card.appendChild(P(ctx, `PadSpan read ${made.walls || "the"} walls from the scan and drew this floor's plan to scale. Nothing needs measuring.${made.where || ""}`, "font-size:16px;line-height:1.6"));
    card.appendChild(P(ctx, "Next, the rooms are drawn on it and the receivers placed. That is easier on a computer or a tablet than on a phone.", "font-size:16px;line-height:1.6"));
    card.appendChild(row(ctx, [btn(ctx, "See the plan", () => { const id = made.id; close(); if (id) opts.onMade({ id }); }, { primary: true, attrs: { "data-rough": "walk-see", style: BIG } }),
      btn(ctx, "Scan another floor", () => { tel(ctx, "walk_again"); _once.delete("walk_done"); Object.assign(s, { walk: 2, made: null, msg: "" }); redraw(ctx); }, { attrs: { "data-rough": "walk-again", style: BIG } })]));
    return card;
  }
  const [title, lines] = WALK[s.walk];
  card.appendChild(el("div", { style: "font-size:13px;color:#52b788;font-weight:700;margin-bottom:4px", "data-rough": "walk-step" }, `Scan a floor with an iPhone or iPad · step ${s.walk + 1} of ${n}`));
  card.appendChild(el("div", { class: "h2", style: "font-size:20px" }, title));
  for (const t of lines) card.appendChild(P(ctx, t, "font-size:16px;line-height:1.6"));
  if (s.walk === n - 1) {
    card.appendChild(row(ctx, [el("span", { style: "font-size:16px;color:#cbd5e1" }, "The floor you scanned:"), floorPick(ctx, opts, true)]));
    card.appendChild(row(ctx, [el("span", { style: "font-size:16px;color:#cbd5e1" }, s.busy ? "Reading the scan…" : "The scan file:"), scanFile(ctx, opts)]));
    if (s.msg) card.appendChild(P(ctx, s.msg + " Check it is the USDZ file the scanning app saved, and try again.", "color:#f59e0b;font-size:15px"));
  }
  card.appendChild(row(ctx, [
    ...(s.walk > 0 ? [btn(ctx, "← Back", () => { s.walk -= 1; s.msg = ""; redraw(ctx); }, { disabled: s.busy, attrs: { "data-rough": "walk-back", style: BIG } })] : []),
    ...(s.walk < n - 1 ? [btn(ctx, "Next →", () => { s.walk += 1; redraw(ctx); }, { primary: true, attrs: { "data-rough": "walk-next", style: BIG } })] : []),
    btn(ctx, "Close", close, { disabled: s.busy, attrs: { "data-rough": "walk-close", style: BIG } })], "margin-top:16px"));
  return card;
}

function body(ctx, kind, opts) {
  const { el } = ctx.helpers, s = st(ctx);
  const wrap = el("div", { "data-rough": "steps-" + kind, style: "margin:4px 0 10px 4px" });
  const ol = el("ol", { style: "margin:4px 0 8px 18px;padding:0;font-size:13px;color:#cbd5e1;line-height:1.55" });
  for (const t of STEPS[kind]) ol.appendChild(el("li", { style: "margin:3px 0" }, t));
  wrap.appendChild(ol);
  if (kind === "scan") {
    wrap.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, "Which floor is it?"), floorPick(ctx, opts)]));
    wrap.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, s.busy ? "Reading the scan…" : "The scan file (.usdz or .json):"), scanFile(ctx, opts)]));
    // The person holding the phone may not be the one at this screen: the same steps one at a time, made for a phone.
    const hand = el("div", { "data-rough": "phone", style: "margin-top:10px;padding:8px 10px;border:1px solid #1a4228;border-radius:8px;background:#0a1a12" });
    hand.appendChild(el("div", { style: "font-size:13px;color:#e2e8f0;font-weight:600" }, "Is someone else doing the scan, or are you on the phone now?"));
    hand.appendChild(row(ctx, [btn(ctx, "Guide me step by step", () => startWalk(ctx), { attrs: { "data-rough": "walk-go" } }),
      MUTED(ctx, "The same steps, one a screen, with big buttons: made for the phone.")]));
    const addr = el("input", { type: "text", readonly: "readonly", "data-rough": "walk-link", value: walkLink(),
      style: "flex:1 1 260px;min-width:0;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:12px" });
    addr.value = walkLink();
    addr.addEventListener("focus", () => { if (addr.select) addr.select(); });
    hand.appendChild(MUTED(ctx, "To open the guide on their phone, send them this address. It opens in the Home Assistant app or a browser signed in to this house:"));
    hand.appendChild(row(ctx, [addr, btn(ctx, "Copy", () => { try { navigator.clipboard.writeText(walkLink()).then(() => ctx.toast && ctx.toast("Address copied")).catch(() => {}); } catch (_e) { if (addr.select) addr.select(); } },
      { attrs: { "data-rough": "walk-copy" } })], "margin:4px 0"));
    wrap.appendChild(hand);
  } else if (kind === "sketch") {
    wrap.appendChild(row(ctx, [btn(ctx, "I have my sketch: upload it", () => { tel(ctx, "sketch_upload"); s.open = false; opts.onSketch(); }, { attrs: { "data-rough": "sketch-go" } })]));
  } else if (kind === "blank") {
    const side = el("div", { style: "max-width:420px" });
    PM.lengthField(ctx, side, s.across, { busy: s.busy, onInput: (t) => { s.across = t; }, key: "blank-across", label: "The floor's width, across:" });
    PM.lengthField(ctx, side, s.down, { busy: s.busy, onInput: (t) => { s.down = t; }, key: "blank-down", label: "Its depth, front to back:" });
    wrap.appendChild(side);
    wrap.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, "Which floor is it?"), floorPick(ctx, opts)]));
    wrap.appendChild(row(ctx, [btn(ctx, s.busy ? "Making it…" : "Make the blank floor", () => { if (!s.busy) makeBlank(ctx, opts); }, { primary: true, disabled: s.busy, attrs: { "data-rough": "blank-go" } })]));
  }
  if (s.msg && s.kind === kind) wrap.appendChild(P(ctx, s.msg, "color:#f59e0b"));
  return wrap;
}

/** The ways to a plan, each with its steps (one open at a time). */
export function render(ctx, opts) {
  const { el } = ctx.helpers, s = st(ctx);
  const card = el("div", { "data-rough": "card", style: "margin:4px 0 14px;padding:10px 12px;border:1px solid #1a4228;border-radius:8px;background:#0a1a12" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#e2e8f0" }, "Ways to get a floor plan"));
  card.appendChild(P(ctx, "PadSpan needs a plan of each floor to place rooms and receivers on. It doesn't have to be an architect's drawing. " +
    "Take the first of these you can; the further down the list, the rougher the plan."));
  for (const kind of KINDS) {
    if (kind === "vacuum" && !opts.vacuumOn && ctx.state.complexity === "basic") continue;      // Basic has no Settings → Features to send them to
    const [title, why] = TITLES[kind], open = s.kind === kind;
    const head = el("button", { class: "btn inline" + (open ? " primary" : ""), "data-rough": "kind-" + kind, style: "font-size:13px;text-align:left" }, title);
    head.addEventListener("click", () => { s.kind = open ? null : kind; s.msg = ""; if (!open) tel(ctx, kind); redraw(ctx); });
    card.appendChild(el("div", { style: "display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin:8px 0 2px;border-top:1px solid #12301f;padding-top:8px" },
      [head, el("span", { style: "font-size:12px;color:#94a3b8" }, why)]));
    if (open) card.appendChild(body(ctx, kind, opts));
  }
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-top:10px;border-top:1px solid #12301f;padding-top:8px" },
    "Have a picture now? Upload it with the form below."));
  return card;
}
