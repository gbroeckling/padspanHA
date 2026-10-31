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

const { hasMaps, hasScale, hasRooms, hasReceivers, hasCalibration, undrawnAreaNames } =
  await import(`./setup_status.js${new URL(import.meta.url).search}`);
// Basic's focused views: a link opens just the part it is about (views/focus.js).
const FOCUS = await import(`./focus.js${new URL(import.meta.url).search}`);

// setup_checks.SETUP_STEPS, in order (tests/test_guided_setup.py holds them equal).
export const SETUP_STEPS = ["plan", "scale", "floors", "rooms", "receivers", "calibration"];
// calibration_store fits a model from five points.
export const CAL_POINTS_NEEDED = 5;

const LABELS = {
  plan: "Upload a floor plan",
  scale: "Set the scale",
  floors: "Floors and their heights",
  rooms: "Draw the rooms",
  receivers: "Place receivers and set their heights",
  calibration: "Calibrate",
};
const ABOUT = {
  plan: "A photo or scan of each floor. It doesn't need to be perfect.",
  scale: "Measure one distance you know, a doorway or a wall, so the map is in metres.",
  floors: "How tall each floor is, so PadSpan can tell the floors apart.",
  rooms: "Trace each Home Assistant room onto its floor plan.",
  receivers: "Put each Bluetooth receiver where it is mounted, and say how high.",
  calibration: "Walk around the house with your phone so PadSpan learns what each spot sounds like.",
};

const _num = (v) => typeof v === "number" && Number.isFinite(v);
const _floors = (state) => ((state.model && state.model.floors) || []).filter(f => f && typeof f === "object");
// setup_checks.floor_has_height: a real storey height or elevation.
const _floorHasHeight = (f) => _num(f.floor_to_floor_m) || _num(f.base_elevation_m);
const _placed = (state) => Object.values((state.model && state.model.scanner_positions_m) || {}).filter(v => v && typeof v === "object");

/** The receivers' heights say something: setup_checks' receiver_heights tip
 * does not apply (a house of two floors or more, two placed receivers or
 * more, all at one height or none given). */
function _heightsOk(state) {
  const placed = _placed(state);
  const zs = new Set(placed.map(v => v.z_m).filter(_num).map(z => Math.round(z * 100) / 100));
  return !(_floors(state).length > 1 && placed.length > 1 && zs.size <= 1);
}

function _calPoints(state) {
  const c = state.calibration;
  return c && Array.isArray(c.points) ? c.points.length : 0;
}

/** Each step's "done", from the house: true, false, or null (not known yet). */
const DONE = {
  plan: (s) => hasMaps(s),
  scale: (s) => hasScale(s),
  // One floor has nothing to set: the floor_heights tip's own rule.
  floors: (s) => _floors(s).length <= 1 || _floors(s).some(_floorHasHeight),
  rooms: (s) => hasRooms(s),
  receivers: (s) => (hasReceivers(s) || _placed(s).length > 0) && _heightsOk(s),
  // The Overview checklist's own rule (setup_status.js): five points or a fitted model.
  calibration: (s) => (s.calibration ? hasCalibration(s) : null),
};

/** What a step's line says under its name. */
function _detail(state, id, done) {
  if (id === "plan" && done) {
    const n = state.maps.list.length;
    return `${n} floor plan${n === 1 ? "" : "s"} uploaded.`;
  }
  if (id === "scale" && done) return "The scale is set.";
  if (id === "floors") {
    const fl = _floors(state);
    if (fl.length <= 1) return "One floor: nothing to set here.";
    const k = fl.filter(_floorHasHeight).length;
    return k ? `${k} of ${fl.length} floors have a height.` : `Every one of the ${fl.length} floors is at the default height. ${ABOUT.floors}`;
  }
  if (id === "rooms") {
    const total = ((state.model && state.model.areas) || []).filter(a => a && a.name).length;
    if (done && total) return `${total - undrawnAreaNames(state).length} of ${total} rooms drawn.`;
  }
  if (id === "receivers") {
    const n = Math.max(_placed(state).length, ...((state.maps && state.maps.list) || []).map(m => (m.receivers || []).length), 0);
    if (n && !_heightsOk(state)) return `${n} placed, all at one height. Say how high each one is mounted.`;
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
  const steps = SETUP_STEPS.map((id, i) => {
    const d = DONE[id](state);
    return { id, n: i + 1, label: LABELS[id], done: d === true, unknown: d === null, skipped: d !== true && skipped.has(id) };
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
  const after = d.steps.slice(SETUP_STEPS.indexOf(id) + 1).find(s => s.status !== "done" && !s.skipped);
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

/** Open a step's own tool, with the bar back to Setup over it. */
export function openStep(ctx, id) {
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
  const mapId = (st.activeMapId && maps.some(m => m.id === st.activeMapId)) ? st.activeMapId : ((maps[0] && maps[0].id) || null);
  // A plan already uploaded: the wizard's Upload adds another floor ("+ Add a floor").
  if (id === "plan") st.activeMapId = null;
  st._mapsWizard = { step: { plan: 1, scale: 2, rooms: 3, receivers: 4 }[id], mapId: id === "plan" ? null : mapId };
  ctx.actions.showView("maps");
}

/** The bar over a step's tool: which step this is, and the way back. */
export function returnBar(ctx) {
  const id = ctx.state._setupReturn;
  const i = SETUP_STEPS.indexOf(id);
  if (i < 0) return null;
  const { el } = ctx.helpers;
  const bar = el("div", { "data-setup": "return", style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#0a1f14;border:1px solid #1a4228;border-radius:8px;padding:6px 12px;margin-bottom:12px" });
  bar.appendChild(el("div", { style: "flex:1 1 auto;min-width:0;font-size:12px;color:#94a3b8" }, [
    el("span", { style: "color:#52b788;font-weight:700" }, "Setup"),
    ` · step ${i + 1} of ${SETUP_STEPS.length}: ${LABELS[id]}`,
  ]));
  const back = el("button", { class: "btn inline", style: "font-size:12px;white-space:nowrap", "data-setup": "back" }, "← Back to Setup");
  back.addEventListener("click", () => { ctx.state._setupReturn = null; ctx.actions.showView("setup"); });
  bar.appendChild(back);
  return bar;
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
    "Six steps, in this order. Each one opens the tool for it; come back here when it's done. " +
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
    row.appendChild(el("div", { style: "flex:1 1 200px;min-width:0" }, [
      el("div", { style: `font-size:13px;font-weight:${cur ? 700 : 600};color:${c.text}` }, [
        `${s.n}. ${s.label}`,
        el("span", { style: `margin-left:8px;font-size:10px;font-weight:600;color:${s.done ? "#52b788" : cur ? "#5eead4" : "#64748b"}` }, _WORD[s.status]),
      ]),
      el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.4;margin-top:2px" }, _detail(st, s.id, s.unknown ? null : s.done)),
    ]));
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
