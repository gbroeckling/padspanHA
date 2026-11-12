// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Setup: the house's setup as one ordered sequence (interface review item
// 15) — plan, scale, floors and heights, rooms, receivers and their heights,
// calibration. A list, not a seventh wizard: each step opens the tool that
// already does it (the Mapping Setup Wizard at its step, Mapping → 3D Stack's
// Floor Heights, the guided calibration), and a bar over that tool leads
// back here. Whether a step is done is read off the house itself, by the
// same rules as the Overview's checklist (setup_status.js) and the accuracy
// tips (setup_checks.py); only where someone is, and what they skipped, is
// stored (settings.setup_progress, cleaned by setup_checks.clean_setup_progress).

const STATUS = await import(`./setup_status.js${new URL(import.meta.url).search}`);
const { hasRooms, undrawnAreaNames, placedReceivers, receiverHeightsOk, stepDone, setupSteps, floorHasHeight, indoorFloors } = STATUS;
// Basic's focused views: a link opens just the part it is about (views/focus.js).
const FOCUS = await import(`./focus.js${new URL(import.meta.url).search}`);
// Let Claude draw your rooms (experimental): one line under the scale and rooms steps, where the rule offers it.
const AIW = await import(`./ai_wizard_offer.js${new URL(import.meta.url).search}`).catch(() => null);
// "No scale yet: Measure" under the scale step, for each plan that has none (scale_nudge.js).
const NUDGE = await import(`./scale_nudge.js${new URL(import.meta.url).search}`).catch(() => null);

// The steps, their names and their words are setup_status.js's: Getting started and the Setup Wizard read the same
// (review 2026-11-13: one order, one vocabulary). setup_checks.SETUP_STEPS holds the same ids.
export const SETUP_STEPS = STATUS.SETUP_STEPS;
const LABELS = STATUS.STEP_LABELS, ABOUT = STATUS.STEP_ABOUT;
// calibration_store fits a model from five points.
export const CAL_POINTS_NEEDED = 5;


function _calPoints(state) {
  const c = state.calibration;
  return c && Array.isArray(c.points) ? c.points.length : 0;
}

/** What a step's line says under its name. */
function _detail(state, id, done) {
  if (id === "plan" && done) {
    const n = state.maps.list.length;
    return `${n} floor plan${n === 1 ? "" : "s"} uploaded.`;
  }
  if (id === "scale" && done) return "The scale is set.";
  if (id === "floors") {
    const fl = indoorFloors(state);
    if (fl.length <= 1) return "One floor: nothing to set here.";
    const k = fl.filter(floorHasHeight).length;
    return k ? `${k} of ${fl.length} floors have a height.` : `Every one of the ${fl.length} floors is at the default height. ${ABOUT.floors}`;
  }
  if (id === "rooms") {
    const total = ((state.model && state.model.areas) || []).filter(a => a && a.name).length;
    if (done && total) return `${total - undrawnAreaNames(state).length} of ${total} rooms drawn.`;
  }
  if (id === "receivers") {
    const n = placedReceivers(state).size;
    if (n && !receiverHeightsOk(state)) return `${n} placed, all at one height. Say how high each one is mounted.`;
    if (done) return `${n} placed.`;
  }
  if (id === "calibration") {
    if (done === null) return "Checking…";
    const p = _calPoints(state);
    if (!done) return p ? `${p} of ${CAL_POINTS_NEEDED} calibration points so far. ${ABOUT.calibration}` : ABOUT.calibration;
    return `${p} calibration point${p === 1 ? "" : "s"}.`;
  }
  return ABOUT[id];
}

/** settings.setup_progress as stored, or a fresh one. */
export function progressOf(state) {
  const p = (state.settings && state.settings.setup_progress) || {};
  return {
    at: SETUP_STEPS.includes(p.at) ? p.at : null,
    skipped: SETUP_STEPS.filter(s => Array.isArray(p.skipped) && p.skipped.includes(s)),
    done: p.done === true,
  };
}

/**
 * Every step's status from the house and the stored progress. The current
 * step is where someone left off (`at`) while it is not done, else the
 * first step neither done nor skipped, else the first one skipped.
 * Returns { known, steps: [{id, n, label, done, status}], current, allDone, doneCount }
 * with status "done" | "current" | "skipped" | "todo".
 */
export function deriveSetup(state, progress) {
  progress = progress || progressOf(state);
  const skipped = new Set(progress.skipped || []);
  const steps = setupSteps(state).map(({ id, n, label }) => {
    const d = stepDone(state, id);
    return { id, n, label, done: d === true, unknown: d === null, skipped: d !== true && skipped.has(id) };
  });
  const cur = steps.find(s => s.id === progress.at && !s.done)
    || steps.find(s => !s.done && !s.skipped) || steps.find(s => !s.done) || null;
  for (const s of steps) s.status = s.done ? "done" : s === cur ? "current" : s.skipped ? "skipped" : "todo";
  const doneCount = steps.filter(s => s.done).length;
  return {
    known: !!(state._mapsLoaded && state._modelLoaded),
    steps, current: cur ? cur.id : null, allDone: doneCount === steps.length, doneCount,
  };
}

/** Skip a step: kept as skipped, and the next step after it that is neither
 * done nor skipped becomes where someone is. */
export function skipStep(state, progress, id) {
  const skipped = [...new Set([...(progress.skipped || []), id])];
  const d = deriveSetup(state, { ...progress, skipped, at: null });
  const after = d.steps.slice(d.steps.findIndex(s => s.id === id) + 1).find(s => s.status !== "done" && !s.skipped);
  return { ...progress, skipped: SETUP_STEPS.filter(s => skipped.includes(s)), at: after ? after.id : null };
}

/** Open a step: it is where someone is now, and no longer skipped. */
export function openProgress(progress, id) {
  return { ...progress, at: id, skipped: (progress.skipped || []).filter(s => s !== id) };
}

// ── the report and the store ────────────────────────────────────────────────

// The demo house showing (Sample mode, or the mode not known yet): Setup is
// about your own house, so nothing is stored or counted meanwhile.
const _demo = (st) => st.dataMode !== "live";

const _counted = new Set();   // setup_step:<id>, once per page
function _countStep(ctx, id) {
  if (_demo(ctx.state) || _counted.has(id) || !ctx.actions.telemetryEvent) return;
  _counted.add(id);
  ctx.actions.telemetryEvent("setup_step:" + id);
}

function _save(ctx, p) {
  const st = ctx.state;
  if (_demo(st)) return;
  if (st.settings) st.settings.setup_progress = p;
  ctx.actions.callWS({ type: "padspan_ha/settings_set", setup_progress: p })
    .then(res => { if (res && res.settings) st.settings = res.settings; })
    .catch(() => {});
}

// ── opening a step: the tool that already does it ───────────────────────────


/** Open a step's own tool, with the bar back to Setup over it. `mapId`: on that plan (the rooms helper's Done opens
 *  receivers on the plan it just saved), else the plan open in Mapping, else the first. */
export function openStep(ctx, id, mapId = null, door = null) {
  const st = ctx.state;
  _save(ctx, openProgress(progressOf(st), id));
  _countStep(ctx, id);
  st._setupReturn = id;
  if (id === "calibration") {
    st._calibWizard = { step: 1 };
    ctx.actions.showView("calibration");
    return;
  }
  if (id === "floors") {
    // Floor Heights, on Mapping → 3D Stack: in Basic only that card
    // (views/focus.js), under the bar back to Setup; Advanced, the tab.
    FOCUS.openFocus(ctx, FOCUS.part("floorHeights", { back: { view: "setup", label: "Setup" } }));
    return;
  }
  const maps = (st.maps && st.maps.list) || [];
  const has = (mid) => !!mid && maps.some(m => m.id === mid);
  const on = has(mapId) ? mapId : has(st.activeMapId) ? st.activeMapId : ((maps[0] && maps[0].id) || null);
  if (has(mapId)) st.activeMapId = mapId;
  // A plan already uploaded: the wizard's Upload adds another floor ("+ Add a floor").
  if (id === "plan") st.activeMapId = null;
  st._mapsWizard = { step: { plan: 1, scale: 2, rooms: 3, receivers: 4 }[id], mapId: id === "plan" ? null : on, ...(door ? { door } : {}) };
  ctx.actions.showView("maps");
}

/** The bar over a step's tool: which step this is, and the way back. */
/** The step the person is on now, from where they are (review 2026-11-11: the bar kept the step Setup opened, "step 1 of
 *  5: Upload" on the scale and rooms steps): the Mapping wizard's step, Edit's tool or Mapping's tab, Calibration. null
 *  where it can't be told (the wizard's Finish): the bar names no step there. */
export function stepNow(st) {
  if (st.view === "calibration") return "calibration";
  const w = st._mapsWizard;
  if (w) return { 1: "plan", 2: "scale", 3: "rooms", 4: "receivers", 6: "floors" }[w.step] || null;
  const tab = st.mapsTab, mode = st.maps && st.maps._mode;
  if (tab === "upload") return "plan";
  if (tab === "stack") return "floors";
  if (tab === "edit") return { measure: "scale", rooms: "rooms", receivers: "receivers" }[mode] || st._setupReturn;
  return st._setupReturn;
}

export function returnBar(ctx) {
  if (!SETUP_STEPS.includes(ctx.state._setupReturn)) return null;
  const id = stepNow(ctx.state);
  const steps = setupSteps(ctx.state), i = steps.findIndex(s => s.id === id);
  const { el } = ctx.helpers;
  const bar = el("div", { "data-setup": "return", style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#0a1f14;border:1px solid #1a4228;border-radius:8px;padding:6px 12px;margin-bottom:12px" });
  bar.appendChild(el("div", { style: "flex:1 1 auto;min-width:0;font-size:12px;color:#94a3b8" }, [
    el("span", { style: "color:#52b788;font-weight:700" }, "Setup"),
    // A step this house's list leaves out (floor heights on one floor, opened by a link): its name, no number.
    !id ? "" : i < 0 ? ` · ${LABELS[id]}` : ` · step ${steps[i].n} of ${steps.length}: ${LABELS[id]}`,
  ]));
  const back = el("button", { class: "btn inline", style: "font-size:12px;white-space:nowrap", "data-setup": "back" }, "← Back to Setup");
  back.addEventListener("click", () => { ctx.state._setupReturn = null; ctx.actions.showView("setup"); });
  bar.appendChild(back);
  return bar;
}

// ── "Put my receivers in their rooms" (owner, 2026-11-12): for everyone, on the receivers step and the rooms helper's
// Done. No AI. Each live receiver whose room (its Home Assistant area) has an outline, and that has no position yet, goes
// inside that room on the server (ws_fabric.ws_receivers_to_rooms: a backup, then the one spatial writer), to be
// dragged to where it is mounted. It says what it placed and what it couldn't, and why; one Undo takes them back. ──
const _rcv = { busy: false, said: "", plan: null, asked: null, waiting: false, fill: null };
export function _resetReceivers() { Object.assign(_rcv, { busy: false, said: "", plan: null, asked: null, waiting: false, fill: null }); }   // a test's new page

const _names = (xs) => xs.length > 4 ? `${xs.slice(0, 4).join(", ")} and ${xs.length - 4} more` : xs.join(", ");
/** Why the server's one rule leaves receivers where they are, in words (placed_already is left unsaid). */
function _whyWords(skipped) {
  const why = (w) => (skipped || []).filter(x => x.why === w).map(x => x.source), bits = [];
  if (why("no_area").length) bits.push(`no Home Assistant area: ${_names(why("no_area"))} (give it an area in Home Assistant, or place it by hand)`);
  if (why("two_plans").length) bits.push(`its room is drawn on plans of more than one floor, and its Home Assistant area's floor doesn't say which: ${_names(why("two_plans"))} (place it by hand)`);
  if (why("no_outline").length) bits.push(`its room has no outline yet: ${_names(why("no_outline"))}`);
  if (why("no_scale").length) bits.push(`its room is drawn on a floor plan with no scale yet: ${_names(why("no_scale"))}`);
  return bits;
}

/** A room drawn only on a plan with no scale: the one press that makes it count, that plan's scale (the server's
 *  no_scale reason names the plan). One button, for the first such plan. */
function _scaleFirst(ctx, skipped) {
  const mapId = ((skipped || []).find(x => x.why === "no_scale") || {}).map_id;
  const map = mapId && ((ctx.state.maps && ctx.state.maps.list) || []).find(m => m.id === mapId);
  if (!map) return null;
  const x = ctx.helpers.el("button", { class: "btn inline", style: "font-size:12px;margin:4px 6px 0 0", "data-setup": "receivers-scale" },
    `Set the scale of ${map.name || "that plan"}`);
  x.addEventListener("click", () => openStep(ctx, "scale", map.id));
  return x;
}

/** What a press would do now: the server's one rule (a dry run of the same command), asked once a visit to the view
 *  and again after a press or an Undo; null while it is asked. Setup's count and its reasons are never the panel's own.
 *  While it is asked (_rcv.waiting) the answer is drawn in place (_rcv.fill), never by a redraw of the whole view. */
function _plan(ctx) {
  const visit = ctx.state._viewVisit || 0;
  if (_rcv.asked !== visit && ctx.actions.callWS) {
    _rcv.asked = visit; _rcv.waiting = true;
    const got = (r) => { _rcv.plan = r || { ready: [], skipped: [], undo: 0 }; _rcv.waiting = false; if (_rcv.fill) _rcv.fill(); };
    ctx.actions.callWS({ type: "padspan_ha/receivers_to_rooms", dry_run: true }).then(got).catch(() => got(null));
  }
  return _rcv.plan;
}

async function _placeReceivers(ctx) {
  _rcv.busy = true; ctx.actions.renderRooms();
  try {
    const r = await ctx.actions.callWS({ type: "padspan_ha/receivers_to_rooms" });
    const placed = (r && r.placed) || [], skipped = (r && r.skipped) || [];
    const bits = [placed.length ? `Placed ${placed.length} receiver${placed.length === 1 ? "" : "s"} inside ${placed.length === 1 ? "its room" : "their rooms"} ` +
      `(${_names(placed.map(p => `${p.source} in ${p.room}`))}), on the map of your house. Drag each to where it is mounted, and set its height, ` +
      `in Calibration's first step, "Check receiver positions"; the Receivers page sets heights too.` : "No receiver was placed."];
    const not = _whyWords(skipped);
    if (not.length) bits.push(`Not placed, ${not.join("; ")}.`);
    const already = skipped.filter(x => x.why === "placed_already").length;
    if (already) bits.push(`${already} already on the map, left where ${already === 1 ? "it is" : "they are"}.`);
    _rcv.said = bits.join(" ");
  } catch (e) {
    _rcv.said = String((e && e.message) || "That didn't work. Try again in a moment.");
  }
  _rcv.busy = false; _rcv.asked = null;            // asked again: what is left to place, what Undo takes back
  if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  ctx.actions.renderRooms();
}

async function _unplaceReceivers(ctx) {
  _rcv.busy = true; ctx.actions.renderRooms();
  try {
    const r = await ctx.actions.callWS({ type: "padspan_ha/receivers_to_rooms", undo: true });   // the last press's, kept on the server
    const n = ((r && r.undone) || []).length, left = ((r && r.left) || []).length;
    _rcv.said = `${n} taken back off the map${left ? `; ${left} moved since, left where ${left === 1 ? "it is" : "they are"}` : ""}.`;
  } catch (e) {
    _rcv.said = String((e && e.message) || "That didn't work. Try again in a moment.");
  }
  _rcv.busy = false; _rcv.asked = null;
  if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  ctx.actions.renderRooms();
}

/** The button with its count, what the last press did, and its Undo (the last press's: earlier ones are simply placed);
 *  when nothing can be placed, why; null on the demo house, for a non-administrator, on a wall screen, while the server
 *  is asked, and on the helper's Done (opts.quiet) when there is nothing to do; nothing either when every receiver is
 *  placed already (review 2026-11-11: a finished house was told "Once your Bluetooth receivers are in Home Assistant…").
 *  Asked of the server once a visit, only where it is shown (Edit's Radios tool, the receivers step, the helper's Done):
 *  the answer fills the block in place (a holder while it is asked), with no redraw of the whole view. */
export function receiversBlock(ctx, opts = {}) {
  const st = ctx.state;
  if (_demo(st) || st.kioskMode || !(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin)) return null;
  const p = _plan(ctx);
  if (!_rcv.waiting) { _rcv.fill = null; return p ? _block(ctx, opts, p) : null; }
  const holder = ctx.helpers.el("div", { "data-setup": "receivers-slot" });
  _rcv.fill = () => { const b = _rcv.plan && _block(ctx, opts, _rcv.plan); holder.replaceChildren(...(b ? [b] : [])); };
  _rcv.fill();
  return holder;
}

function _block(ctx, opts, p) {
  const { el } = ctx.helpers;
  const st = ctx.state;
  const n = (p.ready || []).length, undo = Number(p.undo) || 0, not = _whyWords(p.skipped);
  const rooms = hasRooms(st);                       // any rooms, drawn by hand or by the helper (setup_status: the button is for everyone)
  if (!n && !_rcv.said && !undo) {
    if ((opts && opts.quiet) || !rooms) return null;
    // Every receiver the server knows is placed already: nothing to say. The "once they are in Home Assistant" line only
    // for a house with no receiver at all (none live: nothing ready, nothing skipped).
    if (!not.length && (p.skipped || []).length) return null;
    const later = el("div", { "data-setup": "receivers-later", style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:6px 0" }, not.length
      ? `PadSpan can put a receiver in its room once it has an area that is one of your rooms with an outline. Not ready: ${not.join("; ")}.`
      : "Once your Bluetooth receivers are in Home Assistant, each with an area that is one of your rooms, PadSpan can put them in their rooms for you here.");
    const sc = _scaleFirst(ctx, p.skipped);
    if (sc) later.appendChild(el("div", {}, [sc]));
    return later;
  }
  const box = el("div", { "data-setup": "receivers-rooms", style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:6px 0" });
  const b = (label, attr, on, primary) => {
    const x = el("button", { class: "btn inline" + (primary ? " primary" : ""), style: "font-size:12px;margin:4px 6px 0 0", "data-setup": attr }, label);
    if (_rcv.busy) x.disabled = true;
    x.addEventListener("click", on);
    return x;
  };
  if (_rcv.said) box.appendChild(el("div", { "data-setup": "receivers-said", style: "color:#a7f3d0" }, _rcv.said));
  if (undo) box.appendChild(b(`Undo the ${undo} placed last`, "receivers-undo", () => _unplaceReceivers(ctx), false));
  if (n) {
    box.appendChild(el("div", {}, `${n} receiver${n === 1 ? " has" : "s have"} a room with an outline and no place on the map yet: ` +
      `each can go inside ${n === 1 ? "its room" : "their rooms"}, to drag to where it is mounted. No AI, nothing to pay.` +
      (not.length ? ` Not ready: ${not.join("; ")}.` : "")));
    box.appendChild(b("Put my receivers in their rooms", "receivers-place", () => _placeReceivers(ctx), true));
  }
  const sc = _scaleFirst(ctx, p.skipped);
  if (sc) box.appendChild(sc);
  return box;
}

// ── the rooms helper's later undo, on its Draw the rooms row (owner, 2026-11-12) ──
// Its words and its run are the helper's own (ai_wizard_offer.undoWhat / undoSure / undoHelperRooms), asked once, then
// what happened and the ways on: the helper's line (Try it) and this step's own Start.
let _undoAsking = false, _undoBusy = false, _undoSaid = "";
function _helperUndo(ctx, u) {
  const { el } = ctx.helpers;
  const box = el("div", { "data-setup": "helper-undo", style: "font-size:12px;color:#94a3b8;line-height:1.5;margin:6px 0" });
  if (_undoSaid) box.appendChild(el("div", { "data-setup": "helper-undo-said", style: "color:#a7f3d0" }, _undoSaid));
  if (!u) return box;
  box.appendChild(el("div", {}, AIW.undoWhat(u)));
  const b = (label, attr, on, primary = false) => {
    const x = el("button", { class: "btn inline" + (primary ? " primary" : ""), style: "font-size:12px;margin:4px 6px 0 0", "data-setup": attr }, label);
    if (_undoBusy) x.disabled = true;
    x.addEventListener("click", on);
    return x;
  };
  if (!_undoAsking) {
    box.appendChild(b(AIW.UNDO_TITLE, "helper-undo-ask", () => { _undoAsking = true; _undoSaid = ""; ctx.actions.renderRooms(); }));
    return box;
  }
  box.appendChild(el("div", { style: "color:#fde68a;margin-top:2px" }, AIW.undoSure(u)));
  box.appendChild(b("Undo it (experimental)", "helper-undo-go", async () => {
    _undoBusy = true; ctx.actions.renderRooms();
    let out;
    try { out = await AIW.undoHelperRooms(ctx, u); } catch (e) { out = { ok: false, message: String((e && e.message) || "That didn't work.") }; }
    _undoBusy = false; _undoAsking = false;
    _undoSaid = out.ok ? `${AIW.undoDone(out)} To try again, use the line below; to draw them yourself, this step's own button.` : out.message;
    if (out.ok && ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("ai_wizard:undo_from_setup");
    if (out.ok && ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
    ctx.actions.renderRooms();
  }, true));
  box.appendChild(b("Cancel", "helper-undo-cancel", () => { _undoAsking = false; ctx.actions.renderRooms(); }));
  return box;
}

// ── the view ────────────────────────────────────────────────────────────────

const _COLORS = {
  done: { ring: "#52b788", fill: "#2d6a4f", text: "#a7f3d0" },
  current: { ring: "#5eead4", fill: "#0f2a1a", text: "#e2e8f0" },
  todo: { ring: "#2d4a38", fill: "#0f1a12", text: "#e2e8f0" },
  skipped: { ring: "#2d4a38", fill: "#0f1a12", text: "#94a3b8" },
};
const _WORD = { done: "Done", current: "Next", todo: "To do", skipped: "Skipped" };

export function render(ctx) {
  const { el } = ctx.helpers;
  const st = ctx.state;
  st._setupReturn = null;
  const root = el("div", { id: "setup" });

  // Calibration's points: asked once, as Calibration itself does.
  if (!st.calibration && !st._setupCalAsked && ctx.actions.calibrationGet) {
    st._setupCalAsked = true;
    ctx.actions.calibrationGet()
      .then(d => { if (!st.calibration) st.calibration = d; })
      .catch(() => {})
      .finally(() => { if (st.view === "setup") ctx.actions.renderRooms(); });
  }

  const progress = progressOf(st);
  const d = deriveSetup(st, progress);

  const card = el("div", { class: "card" });
  card.appendChild(el("div", { style: "display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap" }, [
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      el("div", { style: "font-weight:700;font-size:16px;color:#52b788" }, "Setup"),
      ctx.helpers.helpBtn("setup"),
    ]),
    el("div", { class: "muted", style: "font-size:12px", "data-setup": "count" }, d.known ? `${d.doneCount} of ${d.steps.length} done` : "Checking…"),
  ]));
  card.appendChild(el("div", { class: "muted", style: "font-size:13px;line-height:1.5;margin-top:4px" },
    `${["", "One", "Two", "Three", "Four", "Five", "Six"][d.steps.length] || d.steps.length} steps, in this order. Each one opens the tool for it; come back here when it's done. ` +
    "Skip any step and come back to it later: Setup remembers where you were."));

  if (_demo(st)) {
    const note = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding:8px 12px;border:1px solid #f59e0b;border-radius:8px;font-size:12px;color:#e2e8f0" }, [
      el("span", { style: "flex:1 1 auto;min-width:0" }, "The demo house is showing. Setup works on your own house."),
    ]);
    if (ctx.actions.setDataMode) {
      const b = el("button", { class: "btn inline", style: "font-size:12px" }, "Back to my house");
      b.addEventListener("click", () => ctx.actions.setDataMode("live"));
      note.appendChild(b);
    }
    card.appendChild(note);
  }
  if (ctx.hass && ctx.hass.user && ctx.hass.user.is_admin === false) {
    card.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-top:8px" }, "Only an administrator can add or change floor plans."));
  }

  if (!d.known) {
    card.appendChild(el("div", { class: "muted", style: "padding:16px 0;text-align:center" }, "Loading…"));
    root.appendChild(card);
    return root;
  }

  const dots = el("div", { style: "display:flex;gap:4px;margin:12px 0 4px" });
  for (const s of d.steps) {
    dots.appendChild(el("div", { style: `flex:1;height:4px;border-radius:2px;background:${s.done ? "#52b788" : s.status === "current" ? "#5eead4" : "#1b3526"}` }));
  }
  card.appendChild(dots);

  if (d.allDone) {
    card.appendChild(el("div", { "data-setup": "all-done", style: "margin-top:10px;padding:8px 12px;background:#0a1f14;border:1px solid #1a4228;border-radius:8px;color:#a7f3d0;font-size:13px" },
      "Your house is set up. Every step stays here if you want to change one."));
    // Finished: counted once per install, and only by a house that used Setup.
    if ((progress.at || progress.skipped.length) && !progress.done && !_demo(st)) {
      if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("setup_done");
      _save(ctx, { ...progress, done: true });
    }
  } else if (d.current) {
    _countStep(ctx, d.current);
  }

  const list = el("div", { style: "display:flex;flex-direction:column;gap:6px;margin-top:10px" });
  // Let Claude draw your rooms: its one line under the current step when that is Scale or Rooms, else under Rooms, so a
  // house that has moved on (a second floor's heights, receivers) keeps it while the rule offers it (the next floor, a
  // read left part-way).
  const aiwAt = d.current === "scale" || d.current === "rooms" ? d.current : "rooms";
  for (const s of d.steps) {
    const c = _COLORS[s.status];
    const cur = s.status === "current";
    const row = el("div", {
      "data-setup": "step-" + s.id, "data-setup-status": s.status,
      style: `display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;border:1px solid ${cur ? "#2d6a4f" : "#1b3526"};background:${cur ? "#0a1f14" : "transparent"}`,
    });
    row.appendChild(el("div", {
      "aria-hidden": "true",
      style: `flex:none;width:24px;height:24px;border-radius:12px;border:2px solid ${c.ring};background:${c.fill};color:${c.text};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700`,
    }, s.done ? "✓" : String(s.n)));
    const info = el("div", { style: "flex:1 1 200px;min-width:0" }, [
      el("div", { style: `font-size:13px;font-weight:${cur ? 700 : 600};color:${c.text}` }, [
        `${s.n}. ${s.label}`,
        el("span", { style: `margin-left:8px;font-size:10px;font-weight:600;color:${s.done ? "#52b788" : cur ? "#5eead4" : "#64748b"}` }, _WORD[s.status]),
      ]),
      el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.4;margin-top:2px" }, _detail(st, s.id, s.unknown ? null : s.done)),
    ]);
    // The rooms helper's pull trigger: a Scale or Rooms step shown in the Mapping wizard and left unfinished (ai_wizard_offer.stepBack).
    if ((s.id === "scale" || s.id === "rooms") && AIW && AIW.stepBack && !_demo(st)) AIW.stepBack(ctx, s.id, s.done);
    if (s.id === aiwAt && AIW && !_demo(st)) {
      const line = AIW.offerLine(ctx, "setup", s.done);
      if (line) info.appendChild(line);
    }
    if (s.id === "scale" && NUDGE) {
      for (const m of (st.maps && st.maps.list) || []) {
        const n = NUDGE.reminderLine(ctx, m, () => openStep(ctx, "scale", m.id), m.name || "a plan");
        if (n) info.appendChild(n);
      }
    }
    if (s.id === "receivers") {
      const rb = receiversBlock(ctx);
      if (rb) info.appendChild(rb);
    }
    if (s.id === "rooms" && AIW && AIW.helperUndo && !_demo(st) && !st.kioskMode) {
      const u = AIW.helperUndo(ctx);
      if (u || _undoSaid) info.appendChild(_helperUndo(ctx, u));
    }
    row.appendChild(info);
    const btns = el("div", { style: "display:flex;gap:6px;flex:none;margin-left:auto" });
    // Every step after it draws on a plan: no Skip for the plan (as the wizard's Upload).
    if (cur && !s.done && s.id !== "plan") {
      const sk = el("button", { class: "btn inline", style: "font-size:12px;color:#94a3b8", "data-setup": "skip-" + s.id }, "Skip for now");
      if (_demo(st)) sk.disabled = true;
      sk.addEventListener("click", () => {
        if (_demo(st)) return;
        if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("setup_skip:" + s.id);
        _save(ctx, skipStep(st, progress, s.id));
        ctx.actions.renderRooms();
      });
      btns.appendChild(sk);
    }
    const word = s.done ? (s.id === "plan" ? "Add a floor" : "Change") : cur ? (progress.at === s.id ? "Continue →" : "Start →") : "Open";
    const go = el("button", { class: "btn inline" + (cur ? " primary" : ""), style: "font-size:12px", "data-setup": "open-" + s.id }, word);
    // The tools show the demo house too: open them from your own.
    if (_demo(st)) go.disabled = true;
    go.addEventListener("click", () => { if (!_demo(st)) openStep(ctx, s.id); });
    btns.appendChild(go);
    row.appendChild(btns);
    list.appendChild(row);
  }
  card.appendChild(list);
  root.appendChild(card);
  return root;
}
