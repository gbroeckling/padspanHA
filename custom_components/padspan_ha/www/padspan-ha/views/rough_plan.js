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
// Its words in the panel's language (views/i18n.js; English is the key): the lists below are functions, read when drawn.
const { t, tn } = await import(`./i18n.js${V}`);
// The starter house's boxes still as made, and whether the house has rooms (setup_status.js: the one rule each).
const { starterBoxes, hasRooms } = await import(`./setup_status.js${V}`);

export const LINK = () => t("No floor plan? Ways to get one");
export const KINDS = Object.freeze(["have", "scan", "vacuum", "sketch", "blank"]);
export const SCAN_MAX_BYTES = 2_800_000;      // the server's cap is on the base64 (ws_maps.SCAN_MAX_B64)

const TITLES = () => ({
  have: [t("Look for a drawing you already have"), t("The quickest, and the most exact.")],
  // The scan gives the floor's walls, not its rooms (owner, 2026-11-16: in an open house a room is a matter of opinion).
  scan: [t("Scan the floor with an iPhone or iPad"), t("For a Pro model with LiDAR. Exact walls, and nothing to measure. You still say where each room is.")],
  vacuum: [t("Use your robot vacuum's map"), t("If the robot has already mapped the floor.")],
  sketch: [t("Draw it yourself and photograph it"), t("Rough is fine: rooms are told apart by calibration, not by the drawing.")],
  blank: [t("Start from a blank floor"), t("No picture at all: type the floor's size and draw the rooms on a grid.")],
});
const STEPS = () => ({
  have: [
    t("Places to look: the builder's or architect's drawings, the real-estate listing, the strata or council file, an insurance or appraisal report, the fire-escape plan on a wall."),
    t("A photo or a screenshot of it is enough. Hold the camera straight over the page so the drawing isn't slanted, and fill the frame with it."),
    t("Upload it with the form below. You'll set its scale from one length you know, then draw the rooms over it."),
  ],
  scan: [
    t("You need an iPhone or iPad Pro with LiDAR (iPhone 12 Pro or newer Pro, iPad Pro 2020 or newer). Someone else's will do: they scan, and send you the file."),
    t("Install a room-scanning app that uses Apple's RoomPlan (search the App Store for \"RoomPlan\" or \"LiDAR room scanner\"). Any of them can share the scan as a USDZ file."),
    t("Scan one floor in one go if the app allows it: walk slowly round each room, point at every wall, and go through the doorways without stopping the scan. Doors open, lights on."),
    t("Share or export the scan as USDZ (some apps also offer \"RoomPlan JSON\": that works too), and get the file onto this device."),
    t("Say which floor it is and pick the file, just below. PadSpan draws the plan from the scan's walls, to scale, with nothing to measure."),
  ],
  vacuum: [
    t("A robot vacuum that Home Assistant can see (Valetudo, Dreame or Xiaomi) has a map of the floor it cleans."),
    t("Turn on Settings → Features → Robot Vacuum Import, then use Mapping → Layout → \"Import from a robot vacuum\". It becomes a floor plan with its rooms."),
  ],
  sketch: [
    t("On plain paper, draw the outside walls of the floor first, as one shape. Then the walls between rooms, and a gap for each doorway."),
    t("Keep the proportions as true as you can, and write the length of one long wall running across and one running down. You'll type those two in."),
    t("Photograph it from straight above, the page filling the frame, in even light."),
    t("Press the button below: it ticks \"my own sketch\" on the upload form for you. PadSpan then takes a length each way, so each direction gets its own scale."),
  ],
  blank: [
    t("Pace or measure the floor's outside walls: its width and its depth. Rough numbers are fine; you can measure again later."),
    t("PadSpan makes an empty floor of that size with a line every metre. Draw each room on it by its corners, counting the lines."),
  ],
});

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
/** The scanned wall end nearest [x, y] (fractions) within SNAP_FRAC, or null. (`scan.corners`, the walls' own ends;
 *  a scan from before they were kept: its outlines' corners.) */
export function scanCorner(map, x, y) {
  const ar = map && map.image && map.image.width > 0 && map.image.height > 0 ? map.image.height / map.image.width : 1;
  let best = null, bd = SNAP_FRAC;
  const ends = hasScanRooms(map) && Array.isArray(map.scan.corners) && map.scan.corners.length ? map.scan.corners : scanRooms(map).flatMap(r => r.points);
  for (const p of ends) {
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
  if (!p.fit) return " " + t("It couldn't be matched to this floor's rooms, so it starts where every new plan does: line it up in Mapping → 3D Stack.");
  const L = (m) => PM.lengthText(m, PM.feetOn(ctx)), where = p.room || t("this floor's rooms");
  let say;
  if (p.room && p.size_scan_m && p.size_room_m) {
    const [a, b] = [...p.size_scan_m].sort((x, y) => y - x), [c, d] = [...p.size_room_m].sort((x, y) => y - x);
    say = " " + (sizeOff(p) > SIZE_OFF
      ? t("It was placed over {room}: the scan measures {a} by {b}, and {room} is drawn {c} by {d}. The scan is the measured one, so the drawn room is off.", { room: p.room, a: L(a), b: L(b), c: L(c), d: L(d) })
      : t("It was placed over {room}: the scan measures {a} by {b}, and {room} is drawn {c} by {d}.", { room: p.room, a: L(a), b: L(b), c: L(c), d: L(d) }));
  } else {
    say = " " + t("It was placed over {where}.", { where });
  }
  if (p.fits_both_ways) say += " " + t("Its outline fits both ways round: check its doors are on the right walls, and turn it in Mapping → 3D Stack if not.");
  return say;
}

/** The quiet line on the upload card. */
export function link(ctx) {
  const { el } = ctx.helpers, s = st(ctx);
  once(ctx, "seen");
  const a = el("button", { class: "btn inline", "data-rough": "link", style: "font-size:12px" }, s.open ? t("Hide the ways to get a floor plan") : LINK());
  a.addEventListener("click", () => { s.open = !s.open; if (s.open) tel(ctx, "opened"); redraw(ctx); });
  return el("div", { style: "margin:8px 0" }, [a]);
}
export const isOpen = (ctx) => st(ctx).open;

async function makeBlank(ctx, opts) {
  const s = st(ctx);
  s.busy = true; s.msg = ""; redraw(ctx);
  let r;
  try { r = await ctx.actions.callWS({ type: "padspan_ha/maps_blank_create", floor_id: s.floor, across: String(s.across).trim(), down: String(s.down).trim() }); }
  catch (e) { r = { ok: false, message: (e && e.message) || t("That didn't work. Try again in a moment.") }; }
  s.busy = false;
  if (!r || r.ok === false) { tel(ctx, "blank_refused"); s.msg = (r && r.message) || t("The blank floor couldn't be made."); redraw(ctx); return; }
  tel(ctx, "blank_made");
  Object.assign(s, { open: false, kind: null, across: "", down: "" });
  await opts.onMade(r.map);
}

async function readScan(ctx, opts, file) {
  const s = st(ctx);
  if (!file) return;
  if (file.size > SCAN_MAX_BYTES) { tel(ctx, "scan_refused"); tel(ctx, "scan_refused_size"); s.msg = t("This file is too large to be a room scan (2.8 MB at most). A scan of a whole floor is usually under 2 MB: in the scanning app, share the room scan itself (USDZ), not a 3D photo model of it."); redraw(ctx); return; }
  s.busy = true; s.msg = ""; redraw(ctx);
  let r;
  try { r = await ctx.actions.callWS({ type: "padspan_ha/maps_scan_create", floor_id: s.floor, file_base64: await opts.toBase64(file),
    name: String(file.name || "").replace(/\.[^.]+$/, "").slice(0, 120) }); }
  catch (e) { r = { ok: false, message: (e && e.message) || t("That didn't work. Try again in a moment.") }; }
  s.busy = false;
  if (!r || r.ok === false) {
    tel(ctx, "scan_refused");
    tel(ctx, "scan_refused_" + (REFUSED[r && r.code] || "unreadable"));
    s.msg = (r && r.message) || t("The scan couldn't be read."); redraw(ctx); return;
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
    Object.assign(s, { walk: walkSteps().length, made: { id: r.map.id, walls: r.walls, where } });
    if (ctx.actions.mapsRefresh) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
    redraw(ctx);
    return;
  }
  Object.assign(s, { open: false, kind: null });
  if (ctx.toast) ctx.toast(tn(r.walls, "Scan read: 1 wall, drawn to scale. Its scale is set.", "Scan read: {n} walls, drawn to scale. Its scale is set.") + where);
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
// Its screens in the panel's language: a function, read when drawn (the count never changes).
export const walkSteps = () => [
  [t("Is this the right phone?"), [t("You need an iPhone 12 Pro or newer Pro model, or an iPad Pro from 2020 or newer. They have a LiDAR sensor: a small black dot beside the camera lenses."),
    t("A phone without it can't do this. Borrow one that has it, or close this and choose another way to get a plan.")]],
  [t("Get a room-scanning app"), [t("Open the App Store and search for \"RoomPlan\" or \"LiDAR room scanner\"."),
    t("Pick one that says it can export or share a USDZ file. Most can, and several are free."), t("Install it, open it once and allow it to use the camera.")]],
  [t("Get the house ready"), [t("Open every door on this floor, and turn the lights on."), t("Start at one end of the floor, with the battery charged. You'll walk through every room on this floor in one go.")]],
  [t("Scan the floor"), [t("Start a new room scan in the app. Hold the phone upright and move slowly."),
    t("In each room, turn right round so the phone sees every wall from floor to ceiling. White lines appear on the walls it has found."),
    t("Walk through each doorway into the next room without stopping the scan, if the app lets you. One scan for the whole floor is best."),
    t("When every room on this floor is done, press Done or Finish in the app.")]],
  [t("Save the scan as a file"), [t("In the app, press Share or Export and choose USDZ."), t("Choose \"Save to Files\", and remember where you put it (\"On My iPhone\" is fine)."),
    t("Then come back to this page.")]],
  [t("Give the scan to PadSpan"), [t("Choose which floor you scanned, then press the button below and pick the file you just saved.")]],
];
export const walking = (ctx) => { const s = ctx.state._roughPlan; return !!s && typeof s.walk === "number"; };
export const walkLink = () => `${(typeof location !== "undefined" && location.origin) || ""}/padspan-ha?view=maps&guide=scan`;
export function startWalk(ctx) { const s = st(ctx); Object.assign(s, { walk: 0, msg: "", made: null }); tel(ctx, "walk"); redraw(ctx); }
const BIG = "font-size:16px;padding:12px 18px;min-height:48px";

/** The walk-through's screen. `opts`: toBase64(file), floors [[id, name]], onMade(map) (see the plan), onClose(). */
export function walk(ctx, opts) {
  const { el } = ctx.helpers, s = st(ctx), steps = walkSteps(), n = steps.length;
  const card = el("div", { class: "card", "data-rough": "walk", style: "max-width:560px;margin:0 auto" });
  const close = () => { if (s.walk < n) tel(ctx, "walk_closed"); Object.assign(s, { walk: null, made: null, msg: "" }); opts.onClose(); };
  if (s.linked) { s.linked = false; tel(ctx, "walk"); tel(ctx, "walk_link"); }       // opened by its address (panel.js)
  if (s.walk > 0 && s.walk < n) once(ctx, "walk_" + (s.walk + 1));
  if (s.walk >= n) {                                      // the scan is in
    const made = s.made || {};
    once(ctx, "walk_done");
    card.appendChild(el("div", { class: "h2", "data-rough": "walk-done", style: "font-size:20px" }, t("Done: the plan is drawn")));
    card.appendChild(P(ctx, (made.walls ? tn(made.walls, "PadSpan read 1 wall from the scan and drew this floor's plan to scale. Nothing needs measuring.", "PadSpan read {n} walls from the scan and drew this floor's plan to scale. Nothing needs measuring.")
      : t("PadSpan read the walls from the scan and drew this floor's plan to scale. Nothing needs measuring.")) + (made.where || ""), "font-size:16px;line-height:1.6"));
    card.appendChild(P(ctx, t("Next, the rooms are drawn on it and the receivers placed. That is easier on a computer or a tablet than on a phone."), "font-size:16px;line-height:1.6"));
    card.appendChild(row(ctx, [btn(ctx, t("See the plan"), () => { const id = made.id; close(); if (id) opts.onMade({ id }); }, { primary: true, attrs: { "data-rough": "walk-see", style: BIG } }),
      btn(ctx, t("Scan another floor"), () => { tel(ctx, "walk_again"); _once.delete("walk_done"); Object.assign(s, { walk: 2, made: null, msg: "" }); redraw(ctx); }, { attrs: { "data-rough": "walk-again", style: BIG } })]));
    return card;
  }
  const [title, lines] = steps[s.walk];
  card.appendChild(el("div", { style: "font-size:13px;color:#52b788;font-weight:700;margin-bottom:4px", "data-rough": "walk-step" }, t("Scan a floor with an iPhone or iPad · step {i} of {n}", { i: s.walk + 1, n })));
  card.appendChild(el("div", { class: "h2", style: "font-size:20px" }, title));
  for (const line of lines) card.appendChild(P(ctx, line, "font-size:16px;line-height:1.6"));
  if (s.walk === n - 1) {
    card.appendChild(row(ctx, [el("span", { style: "font-size:16px;color:#cbd5e1" }, t("The floor you scanned:")), floorPick(ctx, opts, true)]));
    card.appendChild(row(ctx, [el("span", { style: "font-size:16px;color:#cbd5e1" }, s.busy ? t("Reading the scan…") : t("The scan file:")), scanFile(ctx, opts)]));
    if (s.msg) card.appendChild(P(ctx, s.msg + " " + t("Check it is the USDZ file the scanning app saved, and try again."), "color:#f59e0b;font-size:15px"));
  }
  card.appendChild(row(ctx, [
    ...(s.walk > 0 ? [btn(ctx, t("← Back"), () => { s.walk -= 1; s.msg = ""; redraw(ctx); }, { disabled: s.busy, attrs: { "data-rough": "walk-back", style: BIG } })] : []),
    ...(s.walk < n - 1 ? [btn(ctx, t("Next →"), () => { s.walk += 1; redraw(ctx); }, { primary: true, attrs: { "data-rough": "walk-next", style: BIG } })] : []),
    btn(ctx, t("Close"), close, { disabled: s.busy, attrs: { "data-rough": "walk-close", style: BIG } })], "margin-top:16px"));
  return card;
}

function body(ctx, kind, opts) {
  const { el } = ctx.helpers, s = st(ctx);
  const wrap = el("div", { "data-rough": "steps-" + kind, style: "margin:4px 0 10px 4px" });
  const ol = el("ol", { style: "margin:4px 0 8px 18px;padding:0;font-size:13px;color:#cbd5e1;line-height:1.55" });
  for (const step of STEPS()[kind]) ol.appendChild(el("li", { style: "margin:3px 0" }, step));
  wrap.appendChild(ol);
  if (kind === "scan") {
    wrap.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, t("Which floor is it?")), floorPick(ctx, opts)]));
    wrap.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, s.busy ? t("Reading the scan…") : t("The scan file (.usdz or .json):")), scanFile(ctx, opts)]));
    // The person holding the phone may not be the one at this screen: the same steps one at a time, made for a phone.
    const hand = el("div", { "data-rough": "phone", style: "margin-top:10px;padding:8px 10px;border:1px solid #1a4228;border-radius:8px;background:#0a1a12" });
    hand.appendChild(el("div", { style: "font-size:13px;color:#e2e8f0;font-weight:600" }, t("Is someone else doing the scan, or are you on the phone now?")));
    hand.appendChild(row(ctx, [btn(ctx, t("Guide me step by step"), () => startWalk(ctx), { attrs: { "data-rough": "walk-go" } }),
      MUTED(ctx, t("The same steps, one a screen, with big buttons: made for the phone."))]));
    const addr = el("input", { type: "text", readonly: "readonly", "data-rough": "walk-link", value: walkLink(),
      style: "flex:1 1 260px;min-width:0;background:#0a150e;border:1px solid #2d5a3d;border-radius:6px;color:#e2e8f0;padding:4px 8px;font-size:12px" });
    addr.value = walkLink();
    addr.addEventListener("focus", () => { if (addr.select) addr.select(); });
    hand.appendChild(MUTED(ctx, t("To open the guide on their phone, send them this address. It opens in the Home Assistant app or a browser signed in to this house:")));
    hand.appendChild(row(ctx, [addr, btn(ctx, t("Copy"), () => { try { navigator.clipboard.writeText(walkLink()).then(() => ctx.toast && ctx.toast(t("Address copied"))).catch(() => {}); } catch (_e) { if (addr.select) addr.select(); } },
      { attrs: { "data-rough": "walk-copy" } })], "margin:4px 0"));
    wrap.appendChild(hand);
  } else if (kind === "sketch") {
    wrap.appendChild(row(ctx, [btn(ctx, t("I have my sketch: upload it"), () => { tel(ctx, "sketch_upload"); s.open = false; opts.onSketch(); }, { attrs: { "data-rough": "sketch-go" } })]));
  } else if (kind === "blank") {
    const side = el("div", { style: "max-width:420px" });
    PM.lengthField(ctx, side, s.across, { busy: s.busy, onInput: (t) => { s.across = t; }, key: "blank-across", label: t("The floor's width, across:") });
    PM.lengthField(ctx, side, s.down, { busy: s.busy, onInput: (t) => { s.down = t; }, key: "blank-down", label: t("Its depth, front to back:") });
    wrap.appendChild(side);
    wrap.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, t("Which floor is it?")), floorPick(ctx, opts)]));
    wrap.appendChild(row(ctx, [btn(ctx, s.busy ? t("Making it…") : t("Make the blank floor"), () => { if (!s.busy) makeBlank(ctx, opts); }, { primary: true, disabled: s.busy, attrs: { "data-rough": "blank-go" } })]));
  }
  if (s.msg && s.kind === kind) wrap.appendChild(P(ctx, s.msg, "color:#f59e0b"));
  return wrap;
}

/** The ways to a plan, each with its steps (one open at a time). */
export function render(ctx, opts) {
  const { el } = ctx.helpers, s = st(ctx);
  const card = el("div", { "data-rough": "card", style: "margin:4px 0 14px;padding:10px 12px;border:1px solid #1a4228;border-radius:8px;background:#0a1a12" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#e2e8f0" }, t("Ways to get a floor plan")));
  card.appendChild(P(ctx, t("PadSpan needs a plan of each floor to place rooms and receivers on. It doesn't have to be an architect's drawing.") + " " +
    t("Take the first of these you can; the further down the list, the rougher the plan.")));
  for (const kind of KINDS) {
    if (kind === "vacuum" && !opts.vacuumOn && ctx.state.complexity === "basic") continue;      // Basic has no Settings → Features to send them to
    const [title, why] = TITLES()[kind], open = s.kind === kind;
    const head = el("button", { class: "btn inline" + (open ? " primary" : ""), "data-rough": "kind-" + kind, style: "font-size:13px;text-align:left" }, title);
    head.addEventListener("click", () => { s.kind = open ? null : kind; s.msg = ""; if (!open) tel(ctx, kind); redraw(ctx); });
    card.appendChild(el("div", { style: "display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin:8px 0 2px;border-top:1px solid #12301f;padding-top:8px" },
      [head, el("span", { style: "font-size:12px;color:#94a3b8" }, why)]));
    if (open) card.appendChild(body(ctx, kind, opts));
  }
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-top:10px;border-top:1px solid #12301f;padding-top:8px" },
    t("Have a picture now? Upload it with the form below.")));
  return card;
}

// ── Start with a rough house from your Home Assistant rooms (the owner's gap pick 1, 2026-11-23; starter_house.py) ──
// No drawing at all: one box room per Home Assistant area, on a blank floor (the "blank" way above, made for each floor
// that has no plan and no rooms yet), named as its area and sized from its devices. Offered at the top of Setup and on
// Mapping's empty Library while the house has no rooms; a preview of what it will make (padspan_ha/maps_starter_house,
// dry_run), then one confirm. Never by itself, nothing for a house that has rooms, free.
// Afterwards the plan it made says it is a rough start (starterNote), with the two ways on: reshape the boxes (Mapping →
// Layout; in Basic the Setup Wizard's rooms step, drawn over the box), or upload a real plan of the floor and trace the
// rooms on it. Either way "Put it on the map" (wizard_build.js) puts the traced outline in place of the box, under the
// same name, so the room keeps its Home Assistant area. Counted as words only (telemetry.STARTER_HOUSE_WORDS).
const starterTel = (ctx, w) => { if (ctx.state.dataMode === "live" && ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("starter_house:" + w); };
const sst = (ctx) => ctx.state._starter || (ctx.state._starter = { busy: false, preview: null, msg: "", to: "" });
let _starterSeen = false;
export function _resetStarter() { _starterSeen = false; }      // a test's new page

/** A plan the starter house made. */
export const isStarter = (m) => !!(m && m.starter && typeof m.starter === "object");

/** Whether to offer it: the house's own data, an administrator, not a wall screen, and no rooms drawn anywhere yet. */
export function starterOffered(ctx) {
  const st = ctx.state;
  return st.dataMode === "live" && !st.kioskMode && !(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin === false) && !hasRooms(st);
}

const _names = (xs) => xs.length > 6 ? t("{names} and {more} more", { names: xs.slice(0, 6).join(", "), more: xs.length - 6 }) : xs.join(", ");
// Why an area gets no box (starter_house.SKIPPED), each as a sentence with the rooms in it.
const SKIP_WORDS = () => ({
  drawn: (n) => t("Already drawn, left as they are: {names}.", { names: n }),
  floor_has_plan: (n) => t("On a floor that already has a plan or rooms, so draw them there: {names}.", { names: n }),
  outdoor: (n) => t("Outdoors, left out: {names}.", { names: n }),
  too_big: (n) => t("Too many rooms for one floor, left out: {names}.", { names: n }),
  no_floor: (n) => t("No indoor floor to put them on: {names}.", { names: n }),
});

async function starterAsk(ctx, dry) {
  const s = sst(ctx);
  s.busy = true; s.msg = ""; redraw(ctx);
  let r;
  try {
    r = await ctx.actions.callWS({ type: "padspan_ha/maps_starter_house", dry_run: dry, ...(s.to ? { no_floor_to: s.to } : {}),
      ...(dry ? {} : { label: t("rough start") }) });
  } catch (e) { r = { ok: false, error: (e && e.message) || t("That didn't work. Try again in a moment.") }; }
  s.busy = false;
  return r || { ok: false };
}

async function starterPreview(ctx) {
  const s = sst(ctx), r = await starterAsk(ctx, true);
  if (r.error) { s.msg = r.error; redraw(ctx); return; }
  s.preview = r;
  if (r.no_floor && r.no_floor.to && !s.to) s.to = r.no_floor.to;
  starterTel(ctx, r.ok ? "previewed" : "nothing");
  redraw(ctx);
}

async function starterMake(ctx, opts) {
  const s = sst(ctx), r = await starterAsk(ctx, false);
  if (r.error || !r.ok) {
    s.msg = r.error || t("Nothing was made: every floor has a plan or rooms now.");
    if (!r.error) s.preview = r;
    redraw(ctx);
    return;
  }
  Object.assign(s, { preview: null, msg: "", to: "" });
  const made = (r.rooms || []).length;
  if (ctx.toast) ctx.toast(tn(made, "Rough house made: 1 room on the map.", "Rough house made: {n} rooms on the map.") + " " + t("Reshape them, or upload a real plan, whenever you like."));
  if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  if (ctx.actions.mapsRefresh) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
  if (opts && opts.onMade) await opts.onMade(r.maps || []);
  redraw(ctx);
}

/** What the preview says it will make, and the one confirm. */
function starterPreviewBox(ctx, opts, p) {
  const { el } = ctx.helpers, s = sst(ctx);
  const box = el("div", { "data-starter": "preview", style: "margin-top:8px;padding:8px 10px;border:1px solid #2d6a4f;border-radius:8px;background:#071510" });
  if (!p.ok) {
    box.appendChild(P(ctx, t("Nothing to make: every floor already has a floor plan or rooms."), "color:#f59e0b"));
  } else {
    box.appendChild(el("div", { style: "font-weight:600;font-size:13px;color:#e2e8f0" }, t("This is what it will make:")));
    const ul = el("ul", { style: "margin:4px 0 6px 18px;padding:0;font-size:13px;color:#cbd5e1;line-height:1.55" });
    for (const f of p.floors || []) {
      ul.appendChild(el("li", { "data-starter": "floor" }, tn(f.rooms.length, "{floor}: a blank floor with 1 room ({names})", "{floor}: a blank floor with {n} rooms ({names})",
        { floor: f.name, names: _names(f.rooms.map(r => r.name)) })));
    }
    box.appendChild(ul);
    box.appendChild(MUTED(ctx, t("Each room is a square box named as its Home Assistant area: 3.5 m, bigger where the area has many devices. Your devices show in their rooms at once.")));
    const nf = (p.no_floor && p.no_floor.rooms) || [];
    if (nf.length && (p.choices || []).length) {
      const sel = el("select", { class: "select", "data-starter": "no-floor", style: "max-width:100%" });
      for (const [id, name] of p.choices) { const o = el("option", { value: id }, name); if (id === (s.to || p.no_floor.to)) o.selected = true; sel.appendChild(o); }
      sel.addEventListener("change", () => { s.to = sel.value; starterPreview(ctx); });
      box.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, tn(nf.length, "{names} has no floor in Home Assistant. Put it on:", "{names} have no floor in Home Assistant. Put them on:", { names: _names(nf) })), sel]));
    }
  }
  const by = {};
  for (const x of p.skipped || []) (by[x.why] = by[x.why] || []).push(x.room);
  for (const [why, rooms] of Object.entries(by)) {
    const say = SKIP_WORDS()[why];
    if (say) box.appendChild(MUTED(ctx, say(_names(rooms))));
  }
  box.appendChild(row(ctx, [
    ...(p.ok ? [btn(ctx, s.busy ? t("Making it…") : t("Make the rough house"), () => { if (!s.busy) starterMake(ctx, opts); }, { primary: true, disabled: s.busy, attrs: { "data-starter": "make" } })] : []),
    btn(ctx, t("Cancel"), () => { Object.assign(s, { preview: null, msg: "", to: "" }); redraw(ctx); }, { disabled: s.busy, attrs: { "data-starter": "cancel" } }),
  ]));
  return box;
}

/** "Start with a rough house from your Home Assistant rooms": the offer, its preview and its confirm; null where it isn't
 *  offered (starterOffered). opts.onMade(maps): the plans it made, after the house was read again. */
export function starterOffer(ctx, opts = {}) {
  if (!starterOffered(ctx)) return null;
  const { el } = ctx.helpers, s = sst(ctx);
  if (!_starterSeen) { _starterSeen = true; starterTel(ctx, "offered"); }
  const card = el("div", { "data-starter": "offer", style: "margin:0 0 12px;padding:10px 12px;border:1px solid #2d6a4f;border-radius:8px;background:#0a1f14;text-align:left" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#a7f3d0" }, t("Start with a rough house from your Home Assistant rooms")));
  card.appendChild(P(ctx, t("No drawing needed: PadSpan puts one box for each Home Assistant area on its floor, so every room is on the map in a minute. It is a rough start: drag and resize the boxes later, or upload a real plan and trace over it.")));
  if (s.preview) card.appendChild(starterPreviewBox(ctx, opts, s.preview));
  else card.appendChild(row(ctx, [btn(ctx, s.busy ? t("Reading your Home Assistant rooms…") : t("Show what it will make"), () => { if (!s.busy) starterPreview(ctx); },
    { primary: true, disabled: s.busy, attrs: { "data-starter": "preview-go" } })]));
  if (s.msg) card.appendChild(P(ctx, s.msg, "color:#f59e0b"));
  return card;
}

/** The rough-start note on a plan the starter house made: how many boxes are still boxes, and the two ways on. null for
 *  any other plan. opts: reshape() (where the boxes are reshaped from here; none: not offered), upload() (Upload, on this
 *  plan's floor; none: not offered), drawHere (the plan editor: how to draw a room over its box). */
export function starterNote(ctx, map, opts = {}) {
  if (!isStarter(map)) return null;
  const { el } = ctx.helpers, boxes = starterBoxes(ctx.state);
  const left = Object.keys((map.starter && map.starter.rooms) || {}).filter(r => boxes[r]).length;
  const note = el("div", { "data-starter": "note", style: "margin:6px 0;padding:6px 10px;border:1px dashed #2d6a4f;border-radius:8px;background:#071510;font-size:12px;color:#cbd5e1;line-height:1.5" });
  note.appendChild(el("div", {}, left
    ? tn(left, "Rough start: 1 room on this floor is still a box made from your Home Assistant rooms.", "Rough start: {n} rooms on this floor are still boxes made from your Home Assistant rooms.") + " " +
      t("Drag and resize them, or upload a real plan of this floor and trace the rooms on it: each room you trace and put on the map takes the place of its box, and keeps its Home Assistant area.")
    : t("Rough start: a blank floor made from your Home Assistant rooms. Upload a real plan of this floor whenever you have one.")));
  if (opts.drawHere && left) note.appendChild(el("div", { style: "color:#94a3b8;margin-top:2px" },
    t("To redraw a box here: choose its room and click its corners over the dashed box. \"Put it on the map\" (the Setup Wizard's last step, or the Rooms page) then puts your outline in its place.")));
  const kids = [];
  if (opts.reshape && left) kids.push(btn(ctx, t("Reshape the rooms"), () => { starterTel(ctx, "reshape"); opts.reshape(); }, { attrs: { "data-starter": "reshape" } }));
  if (opts.upload) kids.push(btn(ctx, t("Upload a plan of this floor"), () => { starterTel(ctx, "upload"); opts.upload(); }, { attrs: { "data-starter": "upload" } }));
  if (kids.length) note.appendChild(row(ctx, kids, "margin:4px 0 0"));
  return note;
}
