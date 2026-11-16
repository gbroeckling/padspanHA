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
// `opts` of render: floorId() (the floor chosen on the upload card), toBase64(file), onMade(map) (a scan or a blank
// floor was saved: go on to its rooms), onSketch() (tick "my own sketch" on the upload card), vacuumOn.
// Counted as words only (telemetry.ROUGH_PLAN_WORDS): opened, each kind opened, and what came of a scan or a blank floor.

const V = new URL(import.meta.url).search;
const PM = await import(`./plan_measure.js${V}`);
const { btn, P, MUTED, row } = PM;

export const LINK = "No floor plan? Ways to get one";
export const KINDS = Object.freeze(["have", "scan", "vacuum", "sketch", "blank"]);
export const SCAN_MAX_BYTES = 11_000_000;      // the server's cap is on the base64 (ws_maps.SCAN_MAX_B64)

const TITLES = {
  have: ["Look for a drawing you already have", "The quickest, and the most exact."],
  scan: ["Scan the rooms with an iPhone or iPad", "For a Pro model with LiDAR. Exact, and nothing to measure."],
  vacuum: ["Use your robot vacuum's map", "If the robot has already mapped the floor."],
  sketch: ["Draw it yourself and photograph it", "Rough is fine: rooms are told apart by calibration, not by the drawing."],
  blank: ["Start from a blank floor", "No picture at all: type the floor's size and draw the rooms on a grid."],
};
const STEPS = {
  have: [
    "Places to look: the builder's or architect's drawings, the real-estate listing, the strata or council file, an insurance or appraisal report, the fire-escape plan on a wall.",
    "A photo or a screenshot of it is enough. Hold the camera straight over the page so the drawing isn't slanted, and fill the frame with it.",
    "Upload it above as usual. You'll set its scale from one length you know, then draw the rooms over it.",
  ],
  scan: [
    "You need an iPhone or iPad Pro with LiDAR (iPhone 12 Pro or newer Pro, iPad Pro 2020 or newer). Someone else's will do: they scan, and send you the file.",
    "Install a room-scanning app that uses Apple's RoomPlan (search the App Store for \"RoomPlan\" or \"LiDAR room scanner\"). Any of them can share the scan as a USDZ file.",
    "Scan one floor in one go if the app allows it: walk slowly round each room, point at every wall, and go through the doorways without stopping the scan. Doors open, lights on.",
    "Share or export the scan as USDZ (some apps also offer \"RoomPlan JSON\": that works too), and get the file onto this device.",
    "Choose the floor above, then pick the file here. PadSpan draws the plan from the scan's walls, to scale, with nothing to measure.",
  ],
  vacuum: [
    "A robot vacuum that Home Assistant can see (Valetudo, Dreame or Xiaomi) has a map of the floor it cleans.",
    "Turn on Settings → Features → Robot Vacuum Import, then use Mapping → Rooms → \"Import from a robot vacuum\". It becomes a floor plan with its rooms.",
  ],
  sketch: [
    "On plain paper, draw the outside walls of the floor first, as one shape. Then the walls between rooms, and a gap for each doorway.",
    "Keep the proportions as true as you can, and write the length of one long wall running across and one running down. You'll type those two in.",
    "Photograph it from straight above, the page filling the frame, in even light.",
    "Upload it above with \"my own sketch\" ticked. PadSpan then takes a length each way, so each direction gets its own scale.",
  ],
  blank: [
    "Pace or measure the floor's outside walls: its width and its depth. Rough numbers are fine; you can measure again later.",
    "PadSpan makes an empty floor of that size with a line every metre. Draw each room on it by its corners, counting the lines.",
  ],
};

const tel = (ctx, w) => { if (ctx.state.dataMode === "live" && ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("rough_plan:" + w); };
const st = (ctx) => ctx.state._roughPlan || (ctx.state._roughPlan = { open: false, kind: null, across: "", down: "", busy: false, msg: "", walk: null });
const redraw = (ctx) => ctx.actions.renderRooms();

/** The quiet line on the upload card. */
export function link(ctx) {
  const { el } = ctx.helpers, s = st(ctx);
  const a = el("button", { class: "btn inline", "data-rough": "link", style: "font-size:12px" }, s.open ? "Hide the ways to get a floor plan" : LINK);
  a.addEventListener("click", () => { s.open = !s.open; if (s.open) tel(ctx, "opened"); redraw(ctx); });
  return el("div", { style: "margin:8px 0" }, [a]);
}
export const isOpen = (ctx) => st(ctx).open;

async function makeBlank(ctx, opts) {
  const s = st(ctx);
  s.busy = true; s.msg = ""; redraw(ctx);
  let r;
  try { r = await ctx.actions.callWS({ type: "padspan_ha/maps_blank_create", floor_id: opts.floorId(), across: String(s.across).trim(), down: String(s.down).trim() }); }
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
  if (file.size > SCAN_MAX_BYTES) { tel(ctx, "scan_refused"); s.msg = "This file is too large to be a room scan (11 MB at most)."; redraw(ctx); return; }
  s.busy = true; s.msg = ""; redraw(ctx);
  let r;
  try { r = await ctx.actions.callWS({ type: "padspan_ha/maps_scan_create", floor_id: opts.floorId(), file_base64: await opts.toBase64(file),
    name: String(file.name || "").replace(/\.[^.]+$/, "").slice(0, 120) }); }
  catch (e) { r = { ok: false, message: (e && e.message) || "That didn't work. Try again in a moment." }; }
  s.busy = false;
  if (!r || r.ok === false) { tel(ctx, "scan_refused"); s.msg = (r && r.message) || "The scan couldn't be read."; redraw(ctx); return; }
  tel(ctx, "scan_made");
  if (walking(ctx)) {                          // the walk-through says so itself, on its last screen
    Object.assign(s, { walk: WALK.length, made: { id: r.map.id, walls: r.walls } });
    if (ctx.actions.mapsRefresh) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
    redraw(ctx);
    return;
  }
  Object.assign(s, { open: false, kind: null });
  if (ctx.toast) ctx.toast(`Scan read: ${r.walls} wall${r.walls === 1 ? "" : "s"}, drawn to scale. Its scale is set.`);
  await opts.onMade(r.map);
}

/** The scan's file picker. No `accept`: an iPhone greys out a .usdz in Files when the list names extensions only. */
function scanFile(ctx, opts) {
  const { el } = ctx.helpers, s = st(ctx);
  const file = el("input", { type: "file", "data-rough": "scan-file", style: "font-size:14px;max-width:100%" });
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
  const close = () => { Object.assign(s, { walk: null, made: null, msg: "" }); opts.onClose(); };
  if (s.walk >= n) {                                      // the scan is in
    const made = s.made || {};
    card.appendChild(el("div", { class: "h2", "data-rough": "walk-done", style: "font-size:20px" }, "Done: the plan is drawn"));
    card.appendChild(P(ctx, `PadSpan read ${made.walls || "the"} walls from the scan and drew this floor's plan to scale. Nothing needs measuring.`, "font-size:16px;line-height:1.6"));
    card.appendChild(P(ctx, "Next, the rooms are drawn on it and the receivers placed. That is easier on a computer or a tablet than on a phone.", "font-size:16px;line-height:1.6"));
    card.appendChild(row(ctx, [btn(ctx, "See the plan", () => { const id = made.id; close(); if (id) opts.onMade({ id }); }, { primary: true, attrs: { "data-rough": "walk-see", style: BIG } }),
      btn(ctx, "Scan another floor", () => { Object.assign(s, { walk: 2, made: null, msg: "" }); redraw(ctx); }, { attrs: { "data-rough": "walk-again", style: BIG } })]));
    return card;
  }
  const [title, lines] = WALK[s.walk];
  card.appendChild(el("div", { style: "font-size:13px;color:#52b788;font-weight:700;margin-bottom:4px", "data-rough": "walk-step" }, `Scan a floor with an iPhone or iPad · step ${s.walk + 1} of ${n}`));
  card.appendChild(el("div", { class: "h2", style: "font-size:20px" }, title));
  for (const t of lines) card.appendChild(P(ctx, t, "font-size:16px;line-height:1.6"));
  if (s.walk === n - 1) {
    const sel = el("select", { class: "select", "data-rough": "walk-floor", style: "font-size:16px;min-height:44px;max-width:100%" });
    if (!s.floor && opts.floors[0]) s.floor = opts.floors[0][0];
    for (const [id, name] of opts.floors) { const o = el("option", { value: id }, name); if (id === s.floor) o.selected = true; sel.appendChild(o); }
    sel.addEventListener("change", () => { s.floor = sel.value; });
    card.appendChild(row(ctx, [el("span", { style: "font-size:16px;color:#cbd5e1" }, "The floor you scanned:"), sel]));
    card.appendChild(row(ctx, [el("span", { style: "font-size:16px;color:#cbd5e1" }, s.busy ? "Reading the scan…" : "The scan file:"),
      scanFile(ctx, { ...opts, floorId: () => s.floor })]));
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
    wrap.appendChild(row(ctx, [el("span", { style: "font-size:13px;color:#cbd5e1" }, s.busy ? "Reading the scan…" : "The scan file (.usdz or .json):"), scanFile(ctx, opts)]));
    // The person holding the phone may not be the one at this screen: the same steps one at a time, made for a phone.
    wrap.appendChild(row(ctx, [btn(ctx, "Guide me step by step", () => startWalk(ctx), { attrs: { "data-rough": "walk-go" } }),
      MUTED(ctx, "One step a screen, made for the phone doing the scan.")]));
    wrap.appendChild(el("div", { "data-rough": "walk-link", style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:6px 0;word-break:break-all" },
      `To open that guide on the phone itself, open this address in its Home Assistant app or browser: ${walkLink()}`));
  } else if (kind === "sketch") {
    wrap.appendChild(row(ctx, [btn(ctx, "I have my sketch: upload it", () => { tel(ctx, "sketch_upload"); s.open = false; opts.onSketch(); }, { attrs: { "data-rough": "sketch-go" } })]));
  } else if (kind === "blank") {
    const side = el("div", { style: "max-width:420px" });
    PM.lengthField(ctx, side, s.across, { busy: s.busy, onInput: (t) => { s.across = t; }, key: "blank-across", label: "The floor's width, across:" });
    PM.lengthField(ctx, side, s.down, { busy: s.busy, onInput: (t) => { s.down = t; }, key: "blank-down", label: "Its depth, front to back:" });
    wrap.appendChild(side);
    wrap.appendChild(row(ctx, [btn(ctx, s.busy ? "Making it…" : "Make the blank floor", () => { if (!s.busy) makeBlank(ctx, opts); }, { primary: true, disabled: s.busy, attrs: { "data-rough": "blank-go" } }),
      MUTED(ctx, "On the floor chosen above.")]));
  }
  if (s.msg && s.kind === kind) wrap.appendChild(P(ctx, s.msg, "color:#f59e0b"));
  return wrap;
}

/** The ways to a plan, each with its steps (one open at a time). */
export function render(ctx, opts) {
  const { el } = ctx.helpers, s = st(ctx);
  const card = el("div", { class: "card", "data-rough": "card" });
  card.appendChild(el("div", { class: "h2" }, "Ways to get a floor plan"));
  card.appendChild(P(ctx, "PadSpan needs a picture of each floor to place rooms and receivers on. It doesn't have to be an architect's drawing. " +
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
  return card;
}
