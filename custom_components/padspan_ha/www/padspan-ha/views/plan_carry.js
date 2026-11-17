// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Carry-along (plan_carry.py; owner, 2026-11-16): a floor plan whose place in the house was corrected leaves what was
// put on it standing where it used to be. On that plan's row in Mapping → Library, one line says so; pressing it lists
// what could move with the plan, NOTHING ticked. Only what the person ticks moves, after a backup the server takes
// first; "Leave them where they are" ends it for that plan without moving anything. For an administrator on the
// house's own data, never on a wall screen. Counted as words only (telemetry.PLAN_CARRY_WORDS).
//
// The list is read once when the Library first shows and again after a move or a plan refresh (`refresh`); a row
// draws from what was last read, so nothing is asked on a poll.

const V = new URL(import.meta.url).search;
const PM = await import(`./plan_measure.js${V}`);
const { btn, P, MUTED, row } = PM;

export const KINDS = Object.freeze(["rooms", "receivers", "points", "devices"]);
const tel = (ctx, w) => { if (ctx.state.dataMode === "live" && ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("plan_carry:" + w); };
const st = (ctx) => ctx.state._planCarry || (ctx.state._planCarry = { list: null, busy: false, open: null, ticks: {}, msg: "", offered: new Set() });
const allowed = (ctx) => ctx.state.dataMode === "live" && !ctx.state.kioskMode && !(ctx.hass && ctx.hass.user && ctx.hass.user.is_admin === false);
const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;

/** What stands where the plan used to be, in words: "1 room, 3 receivers and 32 calibration points". */
export function whatWords(c) {
  const parts = [c.rooms.length ? many(c.rooms.length, "room", "rooms") : "", c.receivers ? many(c.receivers, "receiver", "receivers") : "",
    c.points ? many(c.points, "calibration point", "calibration points") : "", c.devices ? many(c.devices, "light or sensor", "lights and sensors") : ""].filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0] || "";
}

/** The Library's call on each draw: the list is read when it never was, and again when any plan's placement changed. */
export function ensure(ctx) {
  const s = st(ctx), sig = JSON.stringify((ctx.state.model && ctx.state.model.map_transforms) || {});
  if (allowed(ctx) && s.sig !== sig && !s.busy) { s.sig = sig; refresh(ctx); }
}

/** Read the list (again): the Library asks when it first shows, and after anything that may have moved a plan. */
export function refresh(ctx) {
  const s = st(ctx);
  if (!allowed(ctx) || s.busy) return;
  s.busy = true;
  Promise.resolve(ctx.actions.callWS({ type: "padspan_ha/plan_carry_list" }))
    .then((r) => { s.list = Array.isArray(r && r.plans) ? r.plans : []; })
    .catch(() => { s.list = s.list || []; })
    .finally(() => { s.busy = false; ctx.actions.renderRooms(); });
}
export const of = (ctx, mapId) => (allowed(ctx) && (st(ctx).list || []).find(c => c.map_id === mapId)) || null;

async function apply(ctx, c) {
  const s = st(ctx), kinds = KINDS.filter(k => s.ticks[k]);
  s.busy = true; s.msg = ""; ctx.actions.renderRooms();
  let r;
  try { r = await ctx.actions.callWS({ type: "padspan_ha/plan_carry_apply", map_id: c.map_id, kinds }); }
  catch (e) { r = { ok: false, message: (e && e.message) || "That didn't work. Try again in a moment." }; }
  s.busy = false;
  if (!r || r.ok === false) { tel(ctx, "refused"); s.msg = (r && r.message) || "Nothing was moved."; ctx.actions.renderRooms(); return; }
  tel(ctx, "moved");
  for (const k of kinds) tel(ctx, "moved_" + k);
  const n = Object.values(r.moved || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  if (ctx.toast) ctx.toast(`Moved ${many(n, "thing", "things")} with the plan. A backup from just before is in Settings → Backup, should you want it back.`);
  Object.assign(s, { open: null, ticks: {}, list: (s.list || []).filter(x => x.map_id !== c.map_id) });
  if (ctx.actions.modelRefresh) await Promise.resolve(ctx.actions.modelRefresh()).catch(() => {});
  if (ctx.actions.mapsRefresh) await Promise.resolve(ctx.actions.mapsRefresh()).catch(() => {});
  ctx.actions.renderRooms();
}

function leave(ctx, c) {
  const s = st(ctx);
  tel(ctx, "dismissed");
  Object.assign(s, { open: null, ticks: {}, list: (s.list || []).filter(x => x.map_id !== c.map_id) });
  Promise.resolve(ctx.actions.callWS({ type: "padspan_ha/plan_carry_dismiss", map_id: c.map_id })).catch(() => {});
  ctx.actions.renderRooms();
}

/** This plan's line on its Library row (and, opened, its list), or null when nothing of it stands where it was. */
export function line(ctx, map) {
  const c = of(ctx, map.id);
  if (!c) return null;
  const { el } = ctx.helpers, s = st(ctx), open = s.open === c.map_id;
  if (!s.offered.has(c.map_id)) { s.offered.add(c.map_id); tel(ctx, "offered"); }
  const wrap = el("div", { "data-carry": "line", style: "margin-top:4px" });
  const head = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:#fbbf24" }, [
    el("span", {}, `This plan was moved: ${whatWords(c)} placed on it still ${c.rooms.length + c.receivers + c.points + c.devices === 1 ? "stands" : "stand"} where it used to be, up to ${PM.lengthText(c.shift_m, PM.feetOn(ctx))} off.`),
    btn(ctx, open ? "Close" : "Review", () => { s.open = open ? null : c.map_id; s.ticks = {}; s.msg = ""; if (!open) tel(ctx, "opened"); ctx.actions.renderRooms(); }, { attrs: { "data-carry": "review" } })]);
  wrap.appendChild(head);
  if (!open) return wrap;
  const card = el("div", { "data-carry": "card", style: "margin:6px 0;padding:10px 12px;border:1px solid #5a4a1a;border-radius:8px;background:#1a160a" });
  card.appendChild(P(ctx, "Each of these was put on this plan before it was moved, so it now sits in the wrong place against the picture. " +
    "Tick what should move with the plan: each goes to the same spot on the picture it was on. Nothing is ticked for you, and a backup is taken first."));
  const OPTS = {
    rooms: c.rooms.length ? [`${many(c.rooms.length, "room", "rooms")}: ${c.rooms.join(", ")}`, "The outline you drew moves with the plan. Its shape is kept."] : null,
    receivers: c.receivers ? [many(c.receivers, "receiver", "receivers"), "Each goes back to where you pinned it on the picture. Receivers' places are what positions are worked out from."] : null,
    points: c.points ? [`${many(c.points, "calibration point", "calibration points")}${c.points_hand ? ` (${c.points_hand} placed by hand)` : ""}`,
      "Each goes back to the spot on the picture you clicked when you recorded it. Their readings are not touched."] : null,
    devices: c.devices ? [many(c.devices, "light or sensor", "lights and sensors"), "The ones standing in those rooms, so they stay in their room."] : null,
  };
  for (const k of KINDS) {
    if (!OPTS[k]) continue;
    const box = el("input", { type: "checkbox", "data-carry": "tick-" + k });
    box.checked = !!s.ticks[k];
    if (s.busy) box.disabled = true;
    box.addEventListener("change", () => { s.ticks[k] = box.checked; ctx.actions.renderRooms(); });
    card.appendChild(el("label", { style: "display:flex;gap:8px;align-items:flex-start;margin:8px 0;font-size:13px;color:#e2e8f0" },
      [box, el("span", {}, [el("div", { style: "font-weight:600" }, OPTS[k][0]), el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5" }, OPTS[k][1])])]));
  }
  if (s.msg) card.appendChild(P(ctx, s.msg, "color:#f59e0b"));
  const any = KINDS.some(k => s.ticks[k]);
  card.appendChild(row(ctx, [
    btn(ctx, s.busy ? "Moving…" : "Move the ticked with the plan", () => { if (any && !s.busy) apply(ctx, c); }, { primary: true, disabled: !any || s.busy, attrs: { "data-carry": "apply" } }),
    btn(ctx, "Leave them where they are", () => { if (!s.busy) leave(ctx, c); }, { disabled: s.busy, attrs: { "data-carry": "leave" } })]));
  card.appendChild(MUTED(ctx, `Pressing "Leave them where they are" means they are right as they stand: this plan will not ask again.`));
  wrap.appendChild(card);
  return wrap;
}
