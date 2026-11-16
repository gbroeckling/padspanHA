// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// "Set this plan's scale now" (owner, 2026-11-12: "Mark one length, optional second"; "Once, then a quiet
// reminder"). Right after Mapping → Upload (Advanced; Basic goes on to the Setup Wizard's own scale step, and an
// upload in the wizard goes on to it anyway), once per plan: the measuring screen the rooms helper uses
// (plan_measure.js), with none of the helper's Claude parts, its counters or its state. One length, and a second one
// the other way if the person wants it, which says plainly when the two disagree (the plan picture stretched). Save
// writes the scale as Mapping → Edit → Measure does (padspan_ha/maps_scale_measure, through Measure's own writer);
// Later puts it off for good. Both end it for that plan (the plan's own record: scale_nudge, set by the upload).
// After that a plan with no scale has one quiet line, "No scale yet: Measure", in Mapping → Library and in Setup.
// Only for an administrator on the house's own data, never on a wall screen.
// Owner, 2026-11-13 (D1): this screen is used wherever a plan gets its FIRST scale (maps.js _openMeasure and the Setup
// Wizard's scale step decide, by `offered`); Mapping → Edit → Measure stays for measuring a scaled plan again. `opts`
// of render: `door` (which door it came through, counted at Save), `onSaved` (where Save goes on to), `later: false`
// (no Later: the Setup Wizard's own Skip is there), `onLater`.

const V = new URL(import.meta.url).search;
const PM = await import(`./plan_measure.js${V}`);
const { isOutdoorFloorId } = await import(`./iso_lights.js${V}`);
const { planHasScale } = await import(`./setup_status.js${V}`);
const { btn, P, MUTED, row } = PM;

export const TITLE = "Set this plan's scale now";
export const WHY = "PadSpan needs its real size before rooms, receivers or anything in metres can go on it.";
export const SECOND = "Add a length the other way";
export const SECOND_WHY = "Optional: a second length, running the other way, checks that the plan picture isn't stretched.";
export const ONE_ONLY = "Use only the first length";
// A picture that is not to scale (2026-11-16). Every picture is taken for a proper plan unless the person says otherwise:
// by ticking "my own sketch" at upload (map.kind), or here, once two lengths disagree.
export const SKETCH_SAYS = "You said this picture is your own sketch. Room-by-room presence comes from calibration, so it works on a sketch; "
  + "distances in metres will be as rough as the drawing. Measure one length across and one down, and each direction gets its own scale.";
export const SECOND_WHY_SKETCH = "A sketch is rarely in proportion: with a second length running the other way, each direction gets its own scale.";
export const NOT_TO_SCALE = "This picture isn't to scale";
export const NOT_TO_SCALE_WHY = "For your own sketch or a stretched scan: each length then sets the scale for its own direction, in place of the average.";
export const PER_AXIS_SAYS = "Each direction has its own scale: both lengths come out right.";
export const SAME_WAY_SAYS = "Your two lengths run nearly the same way, so they can't give each direction its own scale. Measure the second one the other way.";
export const SAVE_SAYS = "Saved as Mapping → Edit → Measure saves a scale. You can measure again there at any time.";
// Basic has no Edit tab (review 2026-11-13, break 7): the way back to measuring there is Setup's scale step.
export const SAVE_SAYS_BASIC = "You can measure it again at any time in Setup's Set the scale step.";
export const REMINDER = "No scale yet";
export const DIFFER_PCT = 5;
// The doors a first scale comes through, counted at Save (scale_nudge:via_<door>; telemetry.SCALE_NUDGE_WORDS).
export const DOORS = Object.freeze(["upload", "setup", "getting_started", "wizard", "reminder", "plans", "stack"]);      // two lengths this far apart are said, never refused (Save takes their average, as Measure does)

/** The two lengths' agreement in plain words (the server's differ_pct: how far apart the scales they give are). */
export function differWords(pct) {
  return pct > DIFFER_PCT
    ? `Your two lengths don't agree: they give scales ${Math.round(pct)} % apart. The plan picture may be stretched, or an end is off. ` +
      "Check both ends and both lengths; Save uses the average of the two."
    : `Your two lengths agree (${Number(pct).toFixed(1)} % apart): the plan isn't stretched.`;
}

const tel = (ctx, w) => { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("scale_nudge:" + w); };
const redraw = (ctx) => ctx.actions.renderRooms();
const _shown = new Set();         // counted once a page, per plan
// How far a person got on the screen (2026-11-15: houses stop between "shown" and a saved scale, and the report could not
// say where): the first end tapped, both ends down, a length typed, a Save refused. Each once a page, per plan.
const _got = new Set();
const first = (map, w) => !_got.has(map.id + ":" + w) && !!_got.add(map.id + ":" + w);
export function _resetCounts() { _shown.clear(); _got.clear(); }   // a test's new page

/** A plan the nudge and the reminder are for: inside the house, with no scale, for an administrator on the house's
 *  own data (not Sample), not on a wall screen. */
export function offered(ctx, map) {
  const st = ctx.state;
  return !!(map && map.id) && st.dataMode === "live" && !st.kioskMode && !(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin === false)
    && !isOutdoorFloorId(map.floor_id) && !planHasScale(st, map.id);
}
/** The nudge is waiting on this plan: uploaded through Mapping → Upload, neither Later nor Save pressed yet. */
export const pending = (ctx, map) => !!map && map.scale_nudge === true && offered(ctx, map);

function draft(ctx, map) {
  const st = ctx.state;
  if (!st._scaleNudge || st._scaleNudge.map_id !== map.id) {
    st._scaleNudge = { map_id: map.id, pts: [], text: "", first: null, pv: null, pvFor: null, seq: 0, timer: null,
      zoom: 1, scroll: null, drag: null, moved: false, busy: false, msg: "", paint: null };
  }
  return st._scaleNudge;
}
/** The lengths as they are now, as the server is asked about them: the first (when a second is being measured), then
 *  the one being measured, each with its two ends once both are down. */
const ask = (d) => [...(d.first ? [d.first] : []),
  { text: String(d.text || "").trim(), ...(d.pts.length === 2 ? { p1: d.pts[0].slice(), p2: d.pts[1].slice() } : {}) }].filter(m => m.text);
const fresh = (d) => !!d.pv && JSON.stringify(d.pvFor) === JSON.stringify(ask(d));
const complete = (d) => { const a = ask(d); return a.length === (d.first ? 2 : 1) && a.every(m => m.p1 && m.p2); };
const ready = (d) => fresh(d) && complete(d) && !!d.pv.across_m && !d.busy;

/** What the server makes of the lengths (only the newest answer is taken); drawn in place, so typing is never lost. */
async function preview(ctx, d) {
  const seq = ++d.seq, a = ask(d);
  if (d.timer) { clearTimeout(d.timer); d.timer = null; }
  try {
    const pv = await ctx.actions.callWS({ type: "padspan_ha/maps_scale_measure", map_id: d.map_id, measures: a, ...(d.nts ? { not_to_scale: true } : {}) });
    if (seq !== d.seq || ctx.state._scaleNudge !== d) return;
    d.pv = pv; d.pvFor = a; d.msg = "";
  } catch (e) {
    if (seq !== d.seq || ctx.state._scaleNudge !== d) return;
    d.msg = (e && e.message) || "That didn't work. Try again in a moment.";
  }
  if (d.paint) d.paint();
}
function previewSoon(ctx, d) {
  d.seq++;
  if (d.timer) clearTimeout(d.timer);
  d.timer = null;
  if (d.paint) d.paint();
  if (typeof setTimeout !== "function") { preview(ctx, d); return; }
  d.timer = setTimeout(() => { d.timer = null; preview(ctx, d); }, 250);
}

/** The second length: the first kept (drawn quietly), a fresh line and field for the other way. */
function second(ctx, d) {
  d.first = ask(d)[0];
  Object.assign(d, { pts: [], text: "", pv: null, pvFor: null });
  redraw(ctx);
}
function oneOnly(ctx, d) {
  const f = d.first;
  Object.assign(d, { first: null, pts: [f.p1, f.p2], text: f.text, pv: null, pvFor: null, nts: false });
  preview(ctx, d);
  redraw(ctx);
}

async function save(ctx, map, d, opts = {}) {
  const a = ask(d);
  d.busy = true; d.msg = ""; redraw(ctx);
  let r;
  try {
    r = await ctx.actions.callWS({ type: "padspan_ha/maps_scale_measure", map_id: map.id, measures: a, save: true, ...(d.nts ? { not_to_scale: true } : {}) });
  } catch (e) {
    r = { ok: false, message: e && e.message };
  }
  d.busy = false;
  if (!r || r.ok === false) {
    if (first(map, "refused")) tel(ctx, "refused");
    d.msg = (r && r.message) || "The scale couldn't be saved. Try again in a moment.";
    redraw(ctx);
    return;
  }
  tel(ctx, a.length === 2 ? "measured_two" : "measured_one");
  if (r.per_axis) { tel(ctx, "per_axis"); if (d.nts) map.kind = "sketch"; }
  if (DOORS.includes(opts.door)) tel(ctx, "via_" + opts.door);
  map.scale_nudge = false;
  ctx.state._scaleNudge = null;
  if (ctx.toast) ctx.toast(`Scale saved: the plan is ${PM.lengthText(r.scale_x_m, PM.feetOn(ctx))} across and ${PM.lengthText(r.scale_y_m, PM.feetOn(ctx))} down.`);
  if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  if (ctx.actions.mapsRefresh) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
  if (opts.onSaved) opts.onSaved(map);
  redraw(ctx);
}

function later(ctx, map, opts = {}) {
  tel(ctx, "later");
  map.scale_nudge = false;
  ctx.state._scaleNudge = null;
  ctx.actions.callWS({ type: "padspan_ha/maps_scale_nudge_end", map_id: map.id }).catch(() => {});
  if (opts.onLater) opts.onLater(map);
  redraw(ctx);
}

/** The server's answer, drawn in place: what each length was read as, the plan's size, the two lengths' agreement,
 *  the way to a second length, and whether Save may go. */
function paint(ctx, d, said, sized, saveBtn) {
  const { el } = ctx.helpers, pv = d.pv;
  PM.paintSaid(said, d.text, pv, d.first ? 1 : 0, PM.feetOn(ctx));
  const lines = [];
  if (fresh(d) && complete(d) && pv.across_m) {
    lines.push(...PM.sizeLines(ctx, pv));
    if (d.first && typeof pv.differ_pct === "number") {
      const off = pv.differ_pct > DIFFER_PCT, own = d.sketch || d.nts;
      if (pv.per_axis) {
        lines.push(el("div", { "data-nudge": "per-axis", style: "font-size:12px;line-height:1.5;margin:4px 0;color:#a7f3d0" }, PER_AXIS_SAYS));
      } else if (own) {
        lines.push(el("div", { "data-nudge": "same-way", style: "font-size:12px;line-height:1.5;margin:4px 0;color:#f59e0b" }, SAME_WAY_SAYS));
      } else {
        lines.push(el("div", { "data-nudge": off ? "differs" : "agrees", style: `font-size:12px;line-height:1.5;margin:4px 0;color:${off ? "#f59e0b" : "#a7f3d0"}` },
          differWords(pv.differ_pct)));
        // Said by the person, never assumed: a proper plan's two lengths that disagree are far more often a slipped end.
        if (off) lines.push(row(ctx, [btn(ctx, NOT_TO_SCALE, () => { tel(ctx, "not_to_scale"); d.nts = true; d.pv = null; preview(ctx, d); },
          { attrs: { "data-nudge": "not-to-scale" } }), MUTED(ctx, NOT_TO_SCALE_WHY)]));
      }
    }
    if (!d.first) lines.push(row(ctx, [btn(ctx, SECOND, () => second(ctx, d), { attrs: { "data-nudge": "second" } }), MUTED(ctx, d.sketch ? SECOND_WHY_SKETCH : SECOND_WHY)]));
  }
  if (d.msg) lines.push(P(ctx, d.msg, "color:#f59e0b"));
  sized.replaceChildren(...lines);
  saveBtn.disabled = !ready(d);
}

/** The one-length screen for this plan: in place of Mapping → Edit while the upload's nudge waits, or wherever the plan
 *  gets its first scale (`opts`: see the header). */
export function render(ctx, map, opts = {}) {
  const { el } = ctx.helpers, d = draft(ctx, map), tap = PM.tapWord();
  if (!_shown.has(map.id)) { _shown.add(map.id); tel(ctx, "shown"); }
  const card = el("div", { class: "card", "data-nudge": "card" });
  card.appendChild(el("div", { class: "h2" }, TITLE));
  card.appendChild(P(ctx, `${map.name || "Your plan"} ${opts.door === "upload" ? "is uploaded" : "has no scale yet"}. ${WHY}`));
  card.appendChild(P(ctx, PM.measureHow(tap)));
  d.sketch = map.kind === "sketch";
  if (d.sketch) card.appendChild(el("div", { "data-nudge": "sketch", style: "font-size:12px;line-height:1.5;margin:6px 0;color:#a7f3d0" }, SKETCH_SAYS));
  const cols = el("div", { style: "display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start" });
  const side = el("div", { style: "flex:0 1 240px;min-width:220px" });
  const ends = () => {
    if (d.pts.length >= 1 && first(map, "first_end")) tel(ctx, "first_end");
    if (d.pts.length === 2 && first(map, "both_ends")) tel(ctx, "both_ends");
  };
  const pic = PM.measurePicture(ctx, d, map, { changed: () => { ends(); preview(ctx, d); redraw(ctx); }, redraw: () => redraw(ctx),
    kept: d.first ? [[d.first.p1, d.first.p2]] : [] });
  cols.appendChild(el("div", { style: "flex:1 1 0;min-width:280px" }, [pic, MUTED(ctx, PM.endHint(d, tap))]));
  cols.appendChild(side);
  card.appendChild(cols);
  if (d.first) {
    side.appendChild(MUTED(ctx, `First length: ${d.first.text} (the dashed line). Now the second one, running the other way.`));
    side.appendChild(btn(ctx, ONE_ONLY, () => oneOnly(ctx, d), { disabled: d.busy, attrs: { "data-nudge": "one-only" } }));
  }
  const { said } = PM.lengthField(ctx, side, d.text, { busy: d.busy, onInput: (t) => { d.text = t; if (String(t).trim() && first(map, "typed")) tel(ctx, "typed"); previewSoon(ctx, d); },
    key: d.first ? "scale-length-2" : "scale-length", label: d.first ? "The second length:" : "Its length:" });
  const sized = el("div", { "data-nudge": "size" });
  side.appendChild(sized);
  const saveBtn = btn(ctx, d.busy ? "Saving…" : "Save the scale", () => { if (ready(d)) save(ctx, map, d, opts); }, { primary: true, attrs: { "data-nudge": "save" } });
  const laterBtn = opts.later === false ? null : btn(ctx, "Later", () => later(ctx, map, opts), { disabled: d.busy, attrs: { "data-nudge": "later" } });
  // On a phone the picture and the length stack: a bar held at the bottom of the screen would lie over the picture, where
  // the two ends are tapped. There it comes after the length, as an ordinary row (real-panel run 2026-11-12, 390 px).
  const stacked = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
  card.appendChild(el("div", { "data-nudge": "bar", style: stacked ? PM.STICKY_BAR.replace("position:sticky;bottom:0;", "") : PM.STICKY_BAR }, [row(ctx, [saveBtn, laterBtn].filter(Boolean), "margin:0"),
    el("div", { style: "font-size:11px;color:#94a3b8;line-height:1.4" }, ctx.state.complexity === "basic" ? SAVE_SAYS_BASIC : SAVE_SAYS)]));
  d.paint = () => paint(ctx, d, said, sized, saveBtn);
  d.paint();
  return card;
}

/** The quiet reminder: one muted line on a plan with no scale (Mapping → Library, Setup), its Measure opening the
 *  measuring the caller's place already has (`onMeasure`). `name`: said where the line isn't on the plan's own row. */
export function reminderLine(ctx, map, onMeasure, name = "") {
  if (!offered(ctx, map)) return null;
  const { el } = ctx.helpers;
  return el("div", { "data-nudge": "reminder", style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:#94a3b8;margin-top:2px" }, [
    el("span", {}, name ? `${REMINDER}: ${name}` : `${REMINDER}:`),
    btn(ctx, "Measure", () => { tel(ctx, "reminder_measure"); onMeasure(); }, { attrs: { "data-nudge": "reminder-measure" } })]);
}
