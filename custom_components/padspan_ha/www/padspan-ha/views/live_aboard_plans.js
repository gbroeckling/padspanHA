// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Add data via plans (experimental, off by default; 2026-11): Live Aboard's
// Plans tool, Edit → Plans, beside Door, Window, Heights and Strip. Present
// only while Settings → AI's master switch is on and an AI Task is chosen
// (live_aboard_edit.js setPlans). The vetting map, and the list view as its
// fallback (no WebGL: openPlansList, from Mapping → Furnish).
//
//   The map     the plan as a textured plane on the floor showing (one texture
//               at a time, 1024 px at most, released on a floor change), what
//               the AI found as ghosts through the real builders, dashed and
//               at 45 %, NEVER in the draft until accepted, so a ghost can't
//               cut a floor; a pin per item, one card. A pin or the queue picks
//               an item and the camera flies there. New, Correction, Failure,
//               Looks right, Later; Move by hand is accept-then-drag. No accept
//               all: the one bulk action is Dismiss the rest (Later, never wrong).
//               Nothing here costs a frame at rest: pins and ghosts move only
//               in the view's own layout, which runs when it draws.
//   The sheet   which placed plans to read (grouped by floor, all ticked),
//               which kinds (stairs; railings beside them; lights, each plan
//               asked whether it draws fixtures), what to expect, which AI reads
//               them, how long it may be busy, and one button. A session that
//               read nothing says why, not that the AI found nothing.
//   The job     runs on the server (ws_plan_ai.py); the sheet asks for its
//               status every 3 s and can cancel it between reads.
//   The list    one row per suggestion, with a crop of the plan drawn from
//               the Library's signed picture link and the box the AI gave:
//               say it looks right, mark it wrong (one reason chip), later, all
//               written at once, or take that back; "already in your house"
//               and "ignored before" listed apart; Manage ignored.
//   New,        go into the editor's draft: a new stair is a draft piece, a
//   Correction  correction the target piece moved, a railing its side and
//               style, a light its kind (never its place), each one undo step,
//               and what is pending is read off the
//               draft, so Undo, Discard and a lost page take it back and the
//               server never knew. Save sends them first to plan_ai_commit, the
//               one writer (plan_ai_write.py), and only then the person's other
//               edits. "Undo this session" takes a whole session back.
//
// Imports nothing; the editor hands in the sheet, the host's callWS, the floors,
// its draft and three.js. No placement, picture size or map record is read
// here: the server answers in metres and the crop is cut by fractions of the picture.

const CSS = `
.la3d-sheet.plans{max-height:calc(100% - 120px);overflow-y:auto;width:min(520px,calc(100% - 24px))}
@media (max-width:600px){.la3d-sheet.plans{left:10px;right:10px;width:auto;top:auto!important;bottom:58px;max-height:60%}}
.la3d-sheet.plans h4 .pl-chip{flex:none}
.la3d-sheet.plans .pl-ban{font-size:11px;line-height:1.45;color:#fde68a;border:1px solid rgba(251,191,36,.45);border-radius:8px;padding:6px 8px;margin:0 0 8px}
.la3d-sheet.plans .pl-chip{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:999px;padding:0 7px;margin-left:6px;vertical-align:middle}
.la3d-sheet.plans .pl-sum{font-size:12px;color:#cbd5e1;line-height:1.5;margin:0 0 8px}
.la3d-sheet.plans h5{font-size:12px;color:#a7f3d0;margin:10px 0 4px}
.la3d-sheet.plans .pl-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)}
.la3d-sheet.plans .pl-row canvas{flex:none;width:120px;height:84px;border-radius:6px;background:#0b1510;border:1px solid rgba(255,255,255,.1)}
.la3d-sheet.plans .pl-txt{flex:1;min-width:0;font-size:12px;line-height:1.45;color:#e2e8f0}
.la3d-sheet.plans .pl-sub{font-size:11px;color:#94a3b8}
.la3d-sheet.plans .pl-rel{display:inline-block;font-size:10px;font-weight:700;border-radius:999px;padding:0 7px;margin-right:6px;border:1px solid}
.la3d-sheet.plans .pl-rel.new{color:#f59e0b;border-color:rgba(245,158,11,.5)}
.la3d-sheet.plans .pl-rel.correction{color:#60a5fa;border-color:rgba(96,165,250,.5)}
.la3d-sheet.plans .pl-rel.stacked{color:#c4b5fd;border-color:rgba(196,181,253,.5)}
.la3d-sheet.plans .pl-rel.stale{color:#94a3b8;border-color:rgba(148,163,184,.5)}
.la3d-sheet.plans .pl-rel.kept{color:#6ee7b7;border-color:rgba(110,231,183,.5)}
.la3d-sheet.plans .pl-choose{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px;font-size:11px;color:#94a3b8}
.la3d-sheet.plans .pl-choose button{font:inherit;font-size:11px;padding:4px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e2e8f0;cursor:pointer;min-height:28px}
.la3d-sheet.plans .pl-choose button[aria-pressed="true"]{background:#1b4332;border-color:#52b788;color:#d8f3dc}
.la3d-sheet.plans .pl-foot button.go{background:#1b4332;border-color:#52b788;color:#d8f3dc;font-weight:700}
.la3d-sheet.plans .pl-acts button:focus-visible,.la3d-sheet.plans .pl-foot button:focus-visible{outline:2px solid #fbbf24;outline-offset:1px}
.la3d-sheet.plans .pl-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.la3d-sheet.plans .pl-acts button{font:inherit;font-size:11px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e2e8f0;cursor:pointer;min-height:32px}
.la3d-sheet.plans .pl-acts button[disabled]{opacity:.45;cursor:default}
.la3d-sheet.plans .pl-acts button.go{background:#1b4332;border-color:#52b788;color:#d8f3dc;font-weight:700}
.la3d-sheet.plans .pl-acts button.why{border-color:rgba(245,158,11,.5);color:#fde68a}
.la3d-sheet.plans label.pl-tick{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#e2e8f0;padding:4px 0;cursor:pointer}
.la3d-sheet.plans label.pl-tick input{margin-top:2px}
.la3d-sheet.plans label.pl-tick img{flex:none;width:44px;height:32px;object-fit:cover;border-radius:4px;background:#0b1510;border:1px solid rgba(255,255,255,.1)}
.la3d-sheet.plans .pl-note{font-size:11px;color:#94a3b8;line-height:1.45;margin:6px 0}
.la3d-sheet.plans .pl-bad{color:#fca5a5}
.la3d-sheet.plans .pl-foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
.la3d-sheet.plans .pl-foot button{font:inherit;font-size:11px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e2e8f0;cursor:pointer;min-height:32px}
.la3d-sheet.plans.pl-flat{position:static;display:block;width:auto;max-height:none;margin:0 0 12px;padding:10px 12px 12px;border-radius:12px;background:rgba(6,14,9,.95);border:1px solid rgba(120,190,155,.26);color:#e2e8f0;font-size:13px}
.la3d-sheet.plans.pl-flat h4{margin:0 0 2px;font-size:14px;font-weight:700;color:#f3f6f4;display:flex;gap:8px;align-items:center}
.la3d-sheet.plans.pl-flat h4 span:not(.pl-chip){flex:1}
.la3d-sheet.plans.pl-flat .la3d-sub{margin:0 0 8px;color:#94a3b8;font-size:12px}
/* The vetting map's card: one card, the item first, everything else folded away. */
.la3d-sheet.plans.map{width:min(330px,calc(100% - 20px));max-height:calc(100% - 96px);padding:10px 12px}
.la3d-sheet.plans.map h4{font-size:13px;margin:0}
.la3d-sheet.plans.map .pl-strip{font-size:11px;line-height:1.35;color:#fde68a;margin:3px 0 8px}
.la3d-sheet.plans.map .pl-q{display:flex;align-items:center;gap:5px;font-size:12px;color:#94a3b8;font-variant-numeric:tabular-nums}
.la3d-sheet.plans.map .pl-q button{all:unset;cursor:pointer;width:26px;height:26px;line-height:24px;text-align:center;border-radius:7px;border:1px solid rgba(255,255,255,.16);color:#e2e8f0;font-size:15px}
.la3d-sheet.plans.map .pl-q button:hover{background:rgba(255,255,255,.08)}
.la3d-sheet.plans.map .pl-q button:focus-visible{outline:2px solid #fbbf24;outline-offset:1px}
.la3d-sheet.plans.map .pl-q .pl-of{white-space:nowrap}
.la3d-sheet.plans.map .pl-title{font-size:14px;font-weight:700;color:#f3f6f4;line-height:1.3}
.la3d-sheet.plans.map .pl-q .pl-title{flex:1;min-width:0}
.la3d:has(.la3d-sheet.plans.map) .la3d-hint{flex:0 1 auto;width:fit-content;padding:2px 7px;border-radius:6px;background:rgba(6,14,9,.82);text-shadow:none}
.la3d-sheet.plans.map .pl-sub2{font-size:12px;color:#94a3b8;line-height:1.4;margin-top:1px}
.la3d-sheet.plans.map .pl-cue{font-size:12px;color:#fde68a;line-height:1.4;margin-top:6px}
.la3d-sheet.plans.map .pl-say{font-size:12px;color:#e2e8f0;line-height:1.4;margin-top:6px}
.la3d-sheet.plans.map .pl-say b{color:#fff}
.la3d-sheet.plans.map .pl-rec{font-size:11px;color:#a7f3d0;margin-top:6px}
.la3d-sheet.plans.map .pl-v{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:8px}
.la3d-sheet.plans.map .pl-v button{font:inherit;font-size:12px;font-weight:600;min-height:34px;padding:4px 4px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e2e8f0;cursor:pointer;white-space:normal;line-height:1.15}
.la3d-sheet.plans.map .pl-v button:hover:not([disabled]){background:rgba(255,255,255,.12)}
.la3d-sheet.plans.map .pl-v button[disabled]{opacity:.35;cursor:default}
.la3d-sheet.plans.map .pl-v button:focus-visible{outline:2px solid #fbbf24;outline-offset:1px}
.la3d-sheet.plans.map .pl-v button.new{background:#1b4332;border-color:#52b788;color:#d8f3dc}
.la3d-sheet.plans.map .pl-v button.cor{background:#172c4d;border-color:#60a5fa;color:#dbeafe}
.la3d-sheet.plans.map .pl-v button.bad{border-color:rgba(148,163,184,.6);color:#cbd5e1}
.la3d-sheet.plans.map .pl-v.four{grid-template-columns:repeat(4,1fr);margin-top:5px}
.la3d-sheet.plans.map .pl-v button.wide{grid-column:span 3}
.la3d-sheet.plans.map .pl-v kbd{font:inherit;font-size:10px;opacity:.6;margin-left:4px;font-weight:400}
.la3d-sheet.plans.map .pl-ctl{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:#94a3b8}
.la3d-sheet.plans.map .pl-ctl input[type=range]{flex:1;min-width:0}
.la3d-sheet.plans.map .pl-mini{font:inherit;font-size:11px;padding:3px 9px;min-height:26px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#cbd5e1;cursor:pointer;white-space:nowrap}
.la3d-sheet.plans.map .pl-mini[aria-pressed="true"]{background:#1b4332;border-color:#52b788;color:#d8f3dc}
.la3d-sheet.plans.map .pl-mini:focus-visible{outline:2px solid #fbbf24;outline-offset:1px}
.la3d-sheet.plans.map .pl-plans{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.la3d-sheet.plans.map .pl-keep{width:100%;font:inherit;font-size:12px;font-weight:700;min-height:36px;margin-top:9px;padding:6px 8px;border-radius:8px;border:1px solid #52b788;background:#52b788;color:#06210f;cursor:pointer}
.la3d-sheet.plans.map .pl-keep[disabled]{opacity:.5;cursor:default}
.la3d-sheet.plans.map .pl-more{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.la3d-sheet.plans.map .pl-sep{border-top:1px solid rgba(255,255,255,.08);margin-top:9px;padding-top:7px}
.la3d-sheet.plans.map .pl-miss{margin:6px 0 0;padding:0;list-style:none;font-size:12px;line-height:1.4;color:#e2e8f0}
.la3d-sheet.plans.map .pl-miss li{padding:2px 0}
@media (max-width:600px){
  .la3d-sheet.plans.map{left:0;right:0;bottom:52px;width:auto;max-height:44%;border-radius:14px;padding:8px 10px}
  .la3d-sheet.plans.map .pl-strip{margin:1px 0 4px}
  .la3d-sheet.plans.map .pl-cue,.la3d-sheet.plans.map .pl-say{margin-top:3px}
  .la3d-sheet.plans.map .pl-v{margin-top:6px}
  .la3d-sheet.plans.map .pl-v button{min-height:44px}
  .la3d-sheet.plans.map .pl-v kbd{display:none}
  .la3d-sheet.plans.map .pl-q button{width:40px;height:36px;line-height:34px}
  .la3d-sheet.plans.map .pl-mini{min-height:36px}
  .la3d-sheet.plans.map .pl-keep{min-height:44px}
  /* The map needs the room: on a phone the other tools stand aside (Done is in the bar). */
  .la3d:has(.la3d-sheet.plans.map) .la3d-toolseg{display:none!important}
}
.pl-pins{position:absolute;inset:0;z-index:3;pointer-events:none;overflow:hidden}
.pl-pin{position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;gap:3px;box-sizing:border-box;height:28px;min-width:40px;padding:0 7px;margin:0;
  pointer-events:auto;touch-action:none;cursor:pointer;border-radius:999px;border:2px solid #fff;font:700 12px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#241703;background:#f59e0b;box-shadow:0 1px 5px rgba(0,0,0,.6)}
.pl-pin svg{width:13px;height:13px;flex:none}
.pl-pin[data-state="new"],.pl-pin[data-state="kept_new"]{background:#52b788;color:#06210f}
.pl-pin[data-state="correction"],.pl-pin[data-state="kept_correction"]{background:#60a5fa;color:#071a33}
.pl-pin[data-state="failure"],.pl-pin[data-state="unmatched"]{background:#64748b;color:#f1f5f9;border-color:#cbd5e1}
.pl-pin[data-state="later"]{background:rgba(6,14,9,.88);color:#fde68a;border-color:#f59e0b}
.pl-pin[data-state="right"]{background:rgba(6,14,9,.88);color:#a7f3d0;border-color:#52b788}
.pl-pin[data-state="stale"]{background:repeating-linear-gradient(45deg,#64748b 0 5px,#334155 5px 10px);color:#f8fafc;border-color:#cbd5e1}
.pl-pin.cur{box-shadow:0 0 0 3px #06210f,0 0 0 5px #fff,0 2px 8px rgba(0,0,0,.6);z-index:2}
.pl-pin.moving{cursor:grab}
.pl-pin:focus-visible{outline:3px solid #fbbf24;outline-offset:3px}
.pl-pins.touch .pl-pin{height:44px;min-width:44px;font-size:14px;padding:0 9px}
.pl-pins.touch .pl-pin svg{width:15px;height:15px}
.pl-tag{position:absolute;left:0;top:0;padding:2px 8px;border-radius:999px;background:rgba(6,14,9,.92);border:1px solid rgba(245,158,11,.6);color:#fde68a;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap;pointer-events:none}
`;
const BANNER = "Experimental. On a small local AI about 2 in 10 stair suggestions are wrong and 2-3 in 10 real stairs are missed; railings about half; "
  + "lights only where the plan draws them. Doors and windows aren't offered: the local model got them mostly wrong.";
const CUE = { stairs: "Check which way is up and the shape.", railing: "The AI can't tell the side for sure: look at the plan.", light: "A wrong kind only changes the drawing." };
const STRIP = { stairs: "About 2 in 10 stairs are wrong, 2-3 in 10 are missed.", railing: "Railings: about half are wrong.", light: "About 3 in 10 lights are wrong, 4 in 10 are missed; handwritten marks far more." };
const SYMBOL_WORD = { pot: "a pot light", pendant: "a pendant", sconce: "a wall light" };
// What a kind is called (live_aboard_house.js LIGHT_KINDS, as the Heights tool says it).
const KIND_WORD = { glow: "just its light", fixture: "a ceiling light", pot: "pot lights", pot_ring: "pot lights round the room", pendant: "a pendant", chandelier: "a chandelier",
  sconce: "a wall light", vanity: "a vanity light", strip: "an LED strip", valance: "a valance", spot: "a spot", track: "track lights", tube: "a tube", fan: "a fan" };
const kindWord = (k) => KIND_WORD[k] || (k ? String(k).replace(/_/g, " ") : KIND_WORD.glow);
const SVG = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// Each kind: its word and its pin's glyph.
const KIND_OF = { stairs: { word: "Stairs", glyph: SVG('<path d="M2 14h3v-4h3V6h3V2h3"/>') },
  railing: { word: "Railing hint", glyph: SVG('<path d="M2 4h12M4 4v9M8 4v9M12 4v9"/>') },
  light: { word: "Light", glyph: SVG('<circle cx="8" cy="8" r="5"/><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>') } };
const GHOST = 0.45, DASH_COL = "#f59e0b", RECAP_EVERY = 25, TEX_MAX = 1024, PLAN_OPACITY = 0.7, SPOT_M = 14, MIN_PX_M = 34;
/** The signed picture links last 24 hours (map_image_view.py SIGN_TTL): asked for again well before that. */
const LINK_MS = 20 * 3600 * 1000;
const WHY = [["wrong_place", "Wrong place"], ["nothing_there", "Nothing there"], ["already_here", "Already here"], ["wrong_kind", "Wrong kind"], ["cant_tell", "Can't tell"]];
const WHY_WORD = Object.fromEntries(WHY);
const POLL_MS = 3000;
const PIECE_LABEL = "Stairs (from the plan)";
const RAIL_STYLES = [["balustrade", "Balustrade"], ["topless", "Topless"], ["single_bar", "Single bar"]];
const OPEN = new Set(["queued", "later", "right", "stale"]);
const CANCEL_WORDS = { user: "cancelled", switch_off: "stopped: the switch was turned off", house3d_off: "stopped: Live Aboard was turned off",
  licence: "stopped: the licence lapsed", plan_gone: "stopped: a plan was removed", plan_changed: "stopped: a plan was moved or replaced", restart: "" };
// Why reads failed (the session's `errors`), and so why a session read nothing at all (its `error`).
const NO_READ = { no_media: "Home Assistant's media folder couldn't take the plans for the AI", no_picture: "the plans' pictures wouldn't open",
  unreachable: "the AI couldn't be reached (is the computer it runs on switched on?)", timeout: "the AI didn't answer in time", bad_answer: "the AI gave no answer that could be used" };
/** A shared AI box: the session's budget (plan_ai.PLAN_BUDGET_S) is how long reads can hold it. */
const sharedNote = (withBackup) => `Reading can keep ${withBackup ? "this AI or the backup" : "this AI"} busy for up to 8 minutes: if ${withBackup ? "either" : "it"} also answers your voice assistant, voice may be slow until it ends.`;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const m1 = (v) => (num(v) === null ? "?" : (Math.round(v * 10) / 10).toFixed(1));
const mins = (s) => { s = Math.max(0, Math.round(num(s) || 0)); return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`; };

// ── the vetting map's rules, pure (tests/js/plans_map.mjs runs them) ─────────
/** What a suggestion's pin says, from the store's state and what the draft holds
 *  for it (design 4.1). null: no pin (a duplicate, a stair's settled hint, one
 *  undone, one ignored before): the list and the what's-missing pass have those. */
export function pinState(sug, pend = null){
  if (pend) return pend.v === "correction" ? "correction" : "new";
  switch (sug && sug.state) {
    case "queued": case "later": case "right": case "stale": case "unmatched": return sug.state;
    case "failure": return sug.verdict && sug.verdict.remembered ? null : "failure";
    case "committed_new": return "kept_new";
    case "committed_correction": return "kept_correction";
    default: return null;
  }
}
/** Still waiting for a person? */
export const isOpen = (state) => state === "queued" || state === "stale";
/** A staircase's hints straight after it, floors bottom up, then room by room as
 *  the plan reads, top left first. The number on a pin is its place here, so it
 *  never changes under a person. roomRank: a number, smaller first. */
export function orderItems(items, floorRank, roomRank){
  const byId = new Map(items.map(s => [s.id, s]));
  const key = (s) => {
    const home = (s.of_stair && byId.get(s.of_stair)) || s, g = home.geom || {};
    return [floorRank(home), roomRank(home), num(g.y_m) ?? 0, num(g.x_m) ?? 0, home.id, s === home ? 0 : 1, s.id];
  };
  const keyed = items.map(s => [key(s), s]);
  keyed.sort((a, b) => { for (let i = 0; i < a[0].length; i++) { if (a[0][i] < b[0][i]) return -1; if (a[0][i] > b[0][i]) return 1; } return 0; });
  return keyed.map(k => k[1]);
}
/** The next item to look at after `fromId`: anything still open, from there on,
 *  round to the start; then what was put off, only those after it, so a pass
 *  through Later ends. null: nothing left. */
export function nextOpen(order, fromId, stateOf){
  const at = order.findIndex(s => s.id === fromId), n = order.length;
  for (let i = 1; i <= n; i++) { const s = order[(Math.max(at, 0) + i) % n]; if (s && s.id !== fromId && isOpen(stateOf(s))) return s; }
  for (let i = Math.max(at, -1) + 1; i < n; i++) { const s = order[i]; if (s.id !== fromId && stateOf(s) === "later") return s; }
  return null;
}
/** Dashes along a line through `pts` (closed: back to the first), as triangles on
 *  a level plane: real width, because a WebGL line is one pixel on any screen. */
export function dashTriangles(pts, closed, dash = 0.24, gap = 0.16, w = 0.055){
  const out = [], list = closed ? [...pts, pts[0]] : pts;
  for (let i = 0; i + 1 < list.length; i++) {
    const [ax, ay] = list[i], [bx, by] = list[i + 1], L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-3) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy * w / 2, ny = ux * w / 2;
    for (let t = 0; t < L; t += dash + gap) {
      const e = Math.min(L, t + dash), x0 = ax + ux * t, y0 = ay + uy * t, x1 = ax + ux * e, y1 = ay + uy * e;
      out.push(x0 + nx, 0, y0 + ny, x1 + nx, 0, y1 + ny, x1 - nx, 0, y1 - ny, x0 + nx, 0, y0 + ny, x1 - nx, 0, y1 - ny, x0 - nx, 0, y0 - ny);
    }
  }
  return new Float32Array(out);
}
/** Pins on screen ([x, y] px, in their order) moved just far enough apart to press
 *  each (a stair and its hint share a spot): a later one to the nearest free place
 *  round where it belongs, never further than it has to go. */
export function spreadPins(pts, gap){
  const out = [], clear = (x, y) => !out.some(q => q && Math.hypot(q[0] - x, q[1] - y) < gap);
  for (const p of pts) {
    if (!p) { out.push(null); continue; }
    let at = clear(p[0], p[1]) ? p : null;
    for (let r = 1; !at && r <= 3; r++) for (let a = 0; !at && a < 8; a++) {
      const x = p[0] + Math.cos(a * Math.PI / 4) * gap * r, y = p[1] + Math.sin(a * Math.PI / 4) * gap * r;
      if (clear(x, y)) at = [x, y];
    }
    out.push(at || p);
  }
  return out;
}
/** A picture's size, the longer side at most `max`, never enlarged. */
export function fitSize(w, h, max = TEX_MAX){
  const k = Math.min(1, max / Math.max(1, w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}
/** "1.4 m east": a move in plan metres, in compass words. compass: {north, east}, unit plan vectors. */
export function moveWords(dx, dy, compass){
  const L = Math.hypot(dx, dy);
  if (!compass || L < 0.05) return `${m1(L)} m`;
  const n = dx * compass.north[0] + dy * compass.north[1], e = dx * compass.east[0] + dy * compass.east[1];
  const i = Math.round(((Math.atan2(e, n) * 180 / Math.PI) + 360) % 360 / 45) % 8;
  return `${m1(L)} m ${["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][i]}`;
}
/** The tally a recap says, from each item's pin state. */
export function tally(states){
  const t = { new: 0, correction: 0, failure: 0, later: 0, right: 0, open: 0 };
  for (const s of states) {
    if (s === "new" || s === "kept_new") t.new++;
    else if (s === "correction" || s === "kept_correction") t.correction++;
    else if (s === "failure" || s === "later" || s === "right") t[s]++;
    else if (isOpen(s)) t.open++;
  }
  return t;
}
export const inPolygon = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};
/** The what's-missing pass for one floor: what the queue can't show, the gaps
 *  (plans: {map_id, name, floor_id, answered}; stairs: the draft's on this floor, {id, label, room, x, y}). */
export function missingLines(fid, sugList, plans, stairs, same = (a, b) => String(a) === String(b)){
  const out = [], mine = plans.filter(p => same(p.floor_id, fid) && p.answered);
  const onPlan = (mid) => sugList.filter(s => s.kind === "stairs" && (s.map_id === mid || (s.seen_on || []).some(o => o.map_id === mid)));
  for (const p of mine) if (!onPlan(p.map_id).length) out.push(`The AI found no stairs on the ${p.name || "this"} plan.`);
  for (const st of stairs) for (const p of mine) {
    const seen = onPlan(p.map_id).some((s) => {
      const m = s.match || {}, g = s.geom || {};
      return m.target === st.id || (m.near || []).includes(st.id) || (num(g.x_m) !== null && Math.hypot(g.x_m - st.x, g.y_m - st.y) <= 2.5);
    });
    if (onPlan(p.map_id).length && !seen) out.push(`Your 3D stair${st.room ? ` in ${st.room}` : st.label ? `, ${st.label},` : ""} wasn't seen on ${p.name || "this plan"}.`);
  }
  const here = sugList.filter(s => same(s.floor_id, fid));
  const unmatched = here.filter(s => s.state === "unmatched").length;
  if (unmatched) out.push(`${unmatched} fixture symbol${unmatched === 1 ? "" : "s"} had no placed light (Mapping → Atlas).`);
  const ignored = here.filter(s => s.state === "failure" && s.verdict && s.verdict.remembered).length;
  if (ignored) out.push(`${ignored} ignored before.`);
  return out;
}

/** Which AI reads the plans, in the photo step's own words (its aiNote) with "plan" for "photo". */
function planNote(ai, n){
  const name = (ai && ai.name) || "The AI Task";
  const [them, stay, leave, it_] = n === 1 ? ["the plan", "stays", "leaves", "it"] : ["the plans", "stay", "leave", "them"];
  const whereOf = (local, it = "it") => (local === true ? `${it[0].toUpperCase()}${it.slice(1)} runs in your home, so ${them} ${stay} in the house.`
    : local === false ? `${it[0].toUpperCase()}${it.slice(1)} runs in the cloud: ${them} ${leave} the house for that service.`
    : `If ${it} runs in the cloud, ${them} ${leave} the house for that service.`);
  const bk = ai && ai.backup ? (ai.backup_name || ai.backup) : null;
  if (!bk && ai && ai.main_away) return `${name} is away right now, so nothing can read ${them}. Start it, or set a backup in Settings → AI, then open this again.`;
  if (bk && ai.main_away) return `The main AI Task is away, so the backup, ${bk}, will read ${them}. ${whereOf(ai.backup_local)} PadSpan keeps no copy.`;
  const also = bk ? ` If it's away, the backup, ${bk}, reads ${it_} instead. ${whereOf(ai.backup_local, "that one")}` : "";
  return `${name} will read ${them}. ${whereOf(ai && ai.local)}${also} PadSpan keeps no copy.`;
}

/**
 * ctx = { root, sheet, guard, host() → {callWS, settings} | null, floors() → [{fl: {id, name, outdoor}}],
 *         hint(text, bad), redraw() (the editor's paint and sheet again),
 *         DRAFT (live_aboard_draft.js), draft() → the editor's draft, change(fn) → one undo step, save() (the editor's Save),
 *         saving(), stairPiece(geom, floor id, label) → a draft piece, fileWritten(data) (an undo wrote the file),
 *         reloadFile() (read the 3D file again: someone else wrote it) }
 */
export function createPlans(ctx){
  const { sheet, guard } = ctx;
  let shownNow = false, step = "idle", info = null, sess = null, poll = null, busy = false, err = "", view = "list";
  let urls = null, urlsAt = 0, urlsAsked = false, ignored = null, failing = null, cancelNote = "", runningId = null, undoInfo = null, askUndo = false, focusBtn = null;
  let record = null;                 // this house's own record, per kind (the server's: plan_ai.track_record)
  const stackFloor = new Map();      // a stacked item's floor, as picked
  const railPick = new Map();        // a railing hint's side and style, as picked
  const picked = new Set();
  const kinds = { stairs: true, railing: true, light: false };
  const fixtures = new Map();        // map id → does it draw light fixtures: yes, no, unsure (the person's answer; lights read only on yes)
  const style = document.createElement("style");
  style.textContent = CSS;
  ctx.root.appendChild(style);

  const redraw = () => { const y = sheet.scrollTop; ctx.redraw(); sheet.scrollTop = y; };   // a verdict never jumps the list to its top
  const d = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const btn = (text, title, act, cls) => {
    const b = d("button", cls, text);
    b.type = "button"; b.title = title || "";
    b.addEventListener("click", guard((e) => { e.stopPropagation(); act(); }));
    return b;
  };
  const call = (type, extra) => {
    const h = ctx.host();
    if (!h || typeof h.callWS !== "function") return Promise.reject(new Error("The Plans tool has no connection."));
    return h.callWS({ type: `padspan_ha/${type}`, ...(extra || {}) });
  };
  const fail = (e) => { err = String((e && (e.message || e.code)) || e || "failed"); busy = false; redraw(); };
  const floorName = (fid) => { const G = (ctx.floors() || []).find(g => g && g.fl && String(g.fl.id) === String(fid)); return G ? (G.fl.name || String(fid)) : String(fid); };
  const outdoor = (fid) => { const s = String(fid).toLowerCase(); if (s === "__outside__" || s === "outside") return true;   // the server leaves these out too (plan_ai.plans)
    const G = (ctx.floors() || []).find(g => g && g.fl && String(g.fl.id) === String(fid)); return !!(G && G.fl.outdoor); };
  const planName = (mid) => { const p = ((info && info.plans) || []).find(x => x.map_id === mid) || ((sess && sess.plans) || []).find(x => x.map_id === mid); return p ? (p.name || "a plan") : "a plan"; };
  const sugs = () => Object.values((sess && sess.suggestions) || {});
  const movedPlan = (mid) => !!((sess && sess.plans) || []).find(x => x.map_id === mid && x.changed);
  const unread = () => ((sess && sess.plans) || []).filter(p => p.read && !p.answered).length;   // its whole read was tried, and no answer came of it
  // What is pending is the draft's: read off it each time, never kept here.
  const pendings = () => { const dr = ctx.draft && ctx.draft(); return dr && ctx.DRAFT ? ctx.DRAFT.planPending(dr.cur) : []; };
  const pendingOf = (id) => pendings().find(p => p.sug_id === id) || null;
  const dirty = () => { const dr = ctx.draft && ctx.draft(); return !!(dr && dr.dirty); };
  const take = (r) => { if (r && r.session) sess = r.session; if (r && "undo" in r) undoInfo = r.undo; if (r && r.record) record = r.record; };

  // ── opening: what is there to read, and what the last session left ───────
  async function open(){
    busy = true; err = ""; step = "loading"; redraw();
    try {
      info = await call("plan_ai_plans");
      if (!info || !Array.isArray(info.plans)) { info = null; step = "sample"; busy = false; redraw(); return; }
      picked.clear();
      for (const p of info.plans) if (!outdoor(p.floor_id)) picked.add(p.map_id);
      loadUrls();
      if (info.running) { sess = null; step = "progress"; startPoll(info.running); }
      else if (info.latest) {
        const r = await call("plan_ai_status", { session: info.latest });
        sess = r && r.session ? r.session : null;
        undoInfo = r ? r.undo || null : null;
        record = r && r.record ? r.record : null;
        settle();
        // What the last session left, or how it ended ("Home Assistant restarted during the read; run it again").
        step = sess && (Object.keys(sess.suggestions || {}).length || sess.status !== "done") ? "list" : "consent";
      } else step = "consent";
    } catch (e) { step = "consent"; err = String((e && e.message) || e); }
    busy = false;
    redraw();
  }
  function loadUrls(){
    if ((urls && Date.now() - urlsAt < LINK_MS) || urlsAsked) return;
    urlsAsked = true;
    call("maps_image_urls").then((r) => { urls = (r && r.image_urls) || {}; urlsAt = Date.now(); urlsAsked = false; redraw(); }).catch(() => { urls = {}; urlsAt = Date.now(); urlsAsked = false; });
  }

  /** Back to the plans and the button, with what the server says now (a start may be allowed again). */
  async function readAgain(){
    if (pendings().length) { ctx.hint("Save or take back the items you kept first: a new read starts a new list.", true); return; }
    step = "consent"; err = ""; redraw();
    try { const r = await call("plan_ai_plans"); if (r && Array.isArray(r.plans)) info = r; } catch (e) { err = String((e && e.message) || e); }
    redraw();
  }

  // ── the job: start, poll, cancel ──────────────────────────────────────────
  async function start(){
    if (busy) return;
    const ids = [...picked];
    if (!ids.length) { err = "Tick at least one plan."; redraw(); return; }
    busy = true; err = ""; redraw();
    try {
      const want = ["stairs"].concat(kinds.railing ? ["railing"] : [], kinds.light ? ["light"] : []);
      const r = await call("plan_ai_start", { map_ids: ids, kinds: want, ...(kinds.light ? { fixtures: Object.fromEntries(ids.map(id => [id, fixtures.get(id) || "unsure"])) } : null) });
      sess = null; cancelNote = ""; step = "progress"; busy = false;
      startPoll(r.session);
    } catch (e) { fail(e); }
    redraw();
  }
  function startPoll(sid){
    stopPoll();
    runningId = sid;
    const tick = guard(async () => {
      try {
        const r = await call("plan_ai_status", { session: sid });
        sess = r && r.session ? r.session : sess;
        if (r && "undo" in r) undoInfo = r.undo;
        if (r && r.record) record = r.record;
        if (sess && sess.status !== "running") { stopPoll(); step = "list"; loadUrls(); }
      } catch (e) { err = String((e && e.message) || e); stopPoll(); step = "consent"; }
      redraw();
    });
    poll = setInterval(tick, POLL_MS);
    tick();
  }
  function stopPoll(){ if (poll) { clearInterval(poll); poll = null; } }
  async function cancel(){
    if (!runningId) return;
    try { const r = await call("plan_ai_cancel", { session: runningId }); cancelNote = (r && r.message) || ""; }
    catch (e) { cancelNote = String((e && e.message) || e); }
    redraw();
  }

  // ── verdicts: failure, later, take that back; written at once ────────────
  async function verdict(sug, v, why){
    if (busy || !sess) return false;
    busy = true; err = ""; redraw();
    let ok = false;
    try {
      const r = await call("plan_ai_verdict", { session: sess.id, rev: sess.rev, sug_id: sug.id, v, ...(why ? { why } : {}) });
      sess.rev = r.rev; sess.suggestions[sug.id] = r.suggestion; failing = null;
      if (r.record) record = r.record;
      for (const h of r.changed || []) sess.suggestions[h.id] = h;     // a stair's railing hint goes and comes back with it
      ctx.hint(v === "failure" ? (why === "already_here" ? "Noted: yours stays where it is." : (r.changed || []).length ? "Noted. Its railing hint goes with it." : "Noted.") : v === "later" ? "Later, then."
        : v === "right" ? "Noted: it looks right. Nothing is written to your house." : "Taken back.");
      ok = true;
    } catch (e) {
      if (e && e.code === "rev_mismatch") { ctx.hint("That list had changed: here it is again."); await reload(); }
      else err = String((e && e.message) || e);
    }
    busy = false;
    settle();
    redraw();
    return ok;
  }
  async function reload(){
    if (!sess) return;
    try { take(await call("plan_ai_status", { session: sess.id })); } catch (_) { /* kept */ }
  }

  // ── New and Correction: the editor's draft, one undo step each ───────────
  const NOTE = () => ctx.DRAFT.PLAN_NOTE;
  /** A note added to the piece's entry for this suggestion (a piece can hold a stair's and its railing's). */
  const noted = (q, sugId, e) => { const n = q[NOTE()] || { session: sess.id, sugs: {} }; n.sugs[sugId] = e; q[NOTE()] = n; };
  function keepNew(sug){
    if (!ctx.change || !sess) return;
    if (sug.state === "stale" && movedPlan(sug.map_id)) { ctx.hint("The plan moved: read it again.", true); return; }
    const fid = stackFloor.get(sug.id) || sug.floor_id;
    const piece = ctx.stairPiece(sug.geom || {}, fid, PIECE_LABEL);
    if (!piece) { ctx.hint("The furniture builders aren't loaded yet: try again in a moment.", true); return; }
    noted(piece, sug.id, { v: "new", made: true });
    if (ctx.change((c) => { c.pieces[piece.id] = piece; })) ctx.hint("In your draft: nothing is kept until Save. Undo takes it back.");
    redraw();
  }
  function takeAi(sug, target = null){
    const m = sug.match || {}, tid = target || m.target, g = sug.geom || {};
    const ok = ctx.change((c) => {
      const q = c.pieces[tid];
      if (!q) return;
      noted(q, sug.id, { v: "correction", was: { x_m: q.x_m, y_m: q.y_m }, ...(target ? { target } : null) });
      q.x_m = g.x_m; q.y_m = g.y_m;
    });
    if (ok) ctx.hint(`Moved in your draft, ${m1(m.distance_m)} m: nothing is kept until Save. Undo takes it back.`);
    else ctx.hint("That stair isn't in your draft any more: it was removed.", true);
    redraw();
  }
  /** A light's kind, in the draft: never its place. One kind on a light: a second symbol's replaces the first's. */
  function keepLight(sug){
    const m = sug.match || {}, eid = m.target, kind = m.want_kind;
    if (!ctx.change || !sess || !eid || !kind) return;
    const others = new Set(pendings().filter(p => p.light && p.piece === eid && p.sug_id !== sug.id).map(p => p.sug_id));
    const ok = ctx.change((c) => {
      if (others.size) ctx.DRAFT.dropPlanPending(c, others);
      const lights = c.lights || (c.lights = {}), q = lights[eid] || (lights[eid] = {});
      noted(q, sug.id, { v: "correction", was: { kind: q.kind ?? null } });
      q.kind = kind;
    });
    if (ok) ctx.hint("Its kind is in your draft: nothing is kept until Save. Undo takes it back.");
    redraw();
  }
  /** Mapping → Atlas on the room a symbol with no placed light is in. */
  function openAtlas(sug){
    const h = ctx.host();
    if (h && typeof h.openAtlasRoom === "function") h.openAtlasRoom(sug.floor_id, roomOf(sug));
  }
  const canOpenAtlas = () => { const h = ctx.host(); return !!(h && typeof h.openAtlasRoom === "function"); };
  function takeBack(sug){
    if (ctx.change((c) => { ctx.DRAFT.dropPlanPending(c, new Set([sug.id])); })) ctx.hint("Taken back. Nothing was kept.");
    redraw();
  }
  /** The piece a railing hint goes on: the stair in the house, or its stair if it is kept or about to be. */
  function railHome(hint){
    const m = hint.match || {};
    if (m.target) return m.target;
    const stair = (sess.suggestions || {})[(hint.geom || {}).stair];
    if (!stair) return null;
    if (String(stair.state).startsWith("committed")) return stair.piece_id;
    const pend = pendingOf(stair.id);
    return pend ? pend.piece : null;
  }
  const flat = (params) => ((params && params.shape) || "straight") === "straight";
  function railSides(params){
    return flat(params) ? [["both", "Both"], ["inner", "Left"], ["outer", "Right"]] : [["both", "Both"], ["inner", "Inside"], ["outer", "Outside"]];
  }
  function keepRail(hint){
    const home = railHome(hint), pick = railPick.get(hint.id) || {};
    if (!home || !pick.side) return;
    const v = (hint.match || {}).relation === "correction" ? "correction" : "new", style = pick.style || "balustrade";
    const ok = ctx.change((c) => {
      const q = c.pieces[home];
      if (!q || !q.recipe) return;
      const params = q.recipe.params = { ...(q.recipe.params || {}) };
      noted(q, hint.id, { v, rail: { side: pick.side, style }, was_params: { rail: params.rail ?? null, rail_style: params.rail_style ?? null } });
      params.rail = pick.side; params.rail_style = style;
    });
    if (ok) ctx.hint("The railing is in your draft: nothing is kept until Save. Undo takes it back.");
    else ctx.hint("That stair isn't in your draft any more.", true);
    redraw();
  }
  /** Anything pending whose suggestion can't be kept any more (kept by someone
   *  else, marked wrong, gone) leaves the draft; in the file it is already. */
  function settle(extra = null){
    const dr = ctx.draft && ctx.draft();
    if (!dr || !ctx.DRAFT || !sess) return;
    const drop = new Set(extra || []);
    for (const p of pendings()) {
      if (p.session !== sess.id) continue;
      const s = (sess.suggestions || {})[p.sug_id];
      if (!s || !OPEN.has(s.state) || (s.state === "stale" && (p.v !== "new" || !p.made || movedPlan(s.map_id)))) drop.add(p.sug_id);
    }
    if (drop.size && !(ctx.saving && ctx.saving())) ctx.change((c) => { ctx.DRAFT.dropPlanPending(c, drop); });
  }

  // ── Save: what the draft holds goes to the one writer ─────────────────────
  /** Called by the editor's Save. {data, pieces, renamed, said}, or a refusal
   *  thrown (err.planRefusal): nothing was written and the draft stays. */
  async function commit(){
    const all = pendings();
    const sid = all.length ? all[0].session : null;
    if (!sid) return null;
    if (!sess || sess.id !== sid) { take(await call("plan_ai_status", { session: sid })); }
    if (!sess || sess.id !== sid) return null;
    const dr = ctx.draft(), mine = all.filter(p => p.session === sid), renamed = {}, keys = new Set();
    const items = mine.map((p) => {
      keys.add(p.piece);
      const sug = (sess.suggestions || {})[p.sug_id] || {};
      if (p.light) return { sug_id: p.sug_id, v: "correction" };                                  // its kind is the symbol the AI read
      if (sug.kind === "railing") return { sug_id: p.sug_id, v: p.v, rail: p.rail };
      const q = dr.cur.pieces[p.piece], final = p.made ? ctx.DRAFT.planFinal(q) : { x_m: q.x_m, y_m: q.y_m };   // a correction: where it stands, nothing else
      return { sug_id: p.sug_id, v: p.v, final, ...(p.target ? { target: p.target } : null) };
    });
    let r;
    try {
      r = await call("plan_ai_commit", { session: sid, rev: sess.rev, items });
    } catch (e) {
      throw Object.assign(new Error(String((e && e.message) || e)), { code: e && e.code, planRefusal: true });
    }
    if (r && r.ok === false) throw Object.assign(new Error(r.message || r.code), { code: r.code, planRefusal: true, changed: r.changed, items: r.items });
    sess.rev = r.rev;
    for (const [id, s] of Object.entries(r.suggestions || {})) sess.suggestions[id] = s;
    undoInfo = r.undo || undoInfo;
    const ids = r.piece_ids || {}, f = ctx.DRAFT.ownedOf(r.data), pieces = {}, lights = {};
    for (const p of mine) {
      const pid = ids[p.sug_id];
      if (!pid) continue;
      if (p.light) { if (f.lights[pid]) lights[pid] = f.lights[pid]; continue; }
      if (p.made) renamed[p.piece] = pid;
      if (f.pieces[pid]) pieces[pid] = f.pieces[pid];
    }
    const nNew = mine.filter(p => p.v === "new" && p.made).length, nCorr = mine.filter(p => p.v === "correction").length, nRail = mine.filter(p => p.rail).length;
    const said = `Kept ${[nNew ? `${nNew} new` : "", nCorr ? `${nCorr} correction${nCorr === 1 ? "" : "s"}` : "", nRail ? `${nRail} railing${nRail === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ")} from the plans. Undo this session takes them back.`;
    return { data: r.data, pieces, lights, renamed, said };
  }
  /** Refused: nothing was written. The list as it is now; what changed leaves the draft. */
  async function refused(e){
    await reload();
    const gone = new Set((e.changed || []).map(c => c.sug_id));
    for (const id of e.items || []) gone.add(id);
    if (e.code === "not_found") for (const p of pendings()) gone.add(p.sug_id);
    settle(gone);
    if (e.code === "changed_since") e.message = "Some items changed since you looked. Nothing was saved: check them again.";
    if (ctx.reloadFile && e.code !== "changed_since") ctx.reloadFile();   // someone else's keep: the house as it is now
    redraw();
  }

  // ── Undo this session ─────────────────────────────────────────────────────
  async function undoSession(){
    if (!undoInfo || busy) return;
    if (dirty()) { ctx.hint("Save or discard your changes first: an undo starts from what is saved.", true); askUndo = false; redraw(); return; }
    busy = true; err = ""; askUndo = false; redraw();
    try {
      const was = undoInfo, r = await call("plan_ai_undo", { batch_id: was.id });
      if (r && r.data && r.undone) ctx.fileWritten(r.data);
      await reload();                                      // the list, and what undoing now would do
      const left = (r.skipped || []).length;
      ctx.hint(`${was.puts_back ? "Put back" : "Undone"}: ${r.undone} of ${r.of}.${left ? ` ${left} ${left === 1 ? "was" : "were"} changed since and left as ${left === 1 ? "it is" : "they are"}.` : ""}`, !r.undone);
    } catch (e) { err = String((e && e.message) || e); }
    busy = false;
    redraw();
  }
  async function forget(key){
    if (busy) return;
    busy = true; err = ""; redraw();
    try {
      await call("plan_ai_reject_forget", { key });
      ignored = null;
      if (sess) { const r = await call("plan_ai_status", { session: sess.id }); sess = r.session || sess; }
    } catch (e) { err = String((e && e.message) || e); }
    busy = false;
    redraw();
  }
  async function openIgnored(){
    view = "ignored"; ignored = null; redraw();
    try { const r = await call("plan_ai_rejects_get"); ignored = (r && r.rejects) || []; } catch (e) { err = String((e && e.message) || e); ignored = []; }
    redraw();
  }

  // ── the crop: the plan's picture round the AI's box ───────────────────────
  const pics = new Map();
  function drawCrop(c, sug){
    const url = urls && urls[sug.map_id];
    if (movedPlan(sug.map_id)) return;                    // the picture may not be the one that was read
    if (!url || !Array.isArray(sug.box_px) || !Array.isArray(sug.frame)) return;
    let img = pics.get(url);
    if (!img) { img = new Image(); img.src = url; pics.set(url, img); }
    const paint = () => {
      try {
        const [fw, fh] = sug.frame, [x1, y1, x2, y2] = sug.box_px;
        const W = img.naturalWidth, H = img.naturalHeight;
        if (!W || !H) return;
        const bx = x1 / fw * W, by = y1 / fh * H, bw = (x2 - x1) / fw * W, bh = (y2 - y1) / fh * H;
        const m = Math.max(bw, bh) * 0.6;
        let sx = bx - m, sy = by - m, sw = bw + 2 * m, sh = bh + 2 * m;
        const ar = c.width / c.height;
        if (sw / sh < ar) { const nw = sh * ar; sx -= (nw - sw) / 2; sw = nw; } else { const nh = sw / ar; sy -= (nh - sh) / 2; sh = nh; }
        const g = c.getContext("2d");
        g.fillStyle = "#0b1510"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        const k = c.width / sw;
        g.strokeStyle = "#f59e0b"; g.lineWidth = 2; g.setLineDash([5, 3]);
        g.strokeRect((bx - sx) * k, (by - sy) * k, bw * k, bh * k);
      } catch (_) { /* a picture that will not draw leaves the box blank */ }
    };
    if (img.complete && img.naturalWidth) paint(); else img.addEventListener("load", paint, { once: true });
  }

  // ── the sheet ─────────────────────────────────────────────────────────────
  function head(title, sub){
    const h = d("h4");
    h.appendChild(d("span", null, title));
    h.appendChild(d("span", "pl-chip", "EXPERIMENTAL"));
    sheet.appendChild(h);
    if (sub) sheet.appendChild(d("p", "la3d-sub", sub));
  }
  function errLine(){ if (err) sheet.appendChild(d("div", "pl-note pl-bad", err)); }

  function paintConsent(){
    head("Add data via plans", "Your AI reads the floor plans you placed; you check every item.");
    sheet.appendChild(d("div", "pl-ban", BANNER));
    errLine();
    const plans = (info && info.plans) || [];
    if (!plans.length) { sheet.appendChild(d("div", "pl-note", "No placed floor plans to read: add one in Mapping and place it in Mapping → 3D Stack first.")); return; }
    // 1. Which plans, by floor; two on one floor said so.
    const byFloor = new Map();
    for (const p of plans) { if (outdoor(p.floor_id)) continue; if (!byFloor.has(p.floor_id)) byFloor.set(p.floor_id, []); byFloor.get(p.floor_id).push(p); }
    sheet.appendChild(d("h5", null, "Which plans"));
    for (const [fid, list] of byFloor) {
      sheet.appendChild(d("div", "pl-sub", floorName(fid)));
      for (const p of list) {
        const l = d("label", "pl-tick");
        const cb = d("input"); cb.type = "checkbox"; cb.checked = picked.has(p.map_id);
        cb.addEventListener("change", () => { if (cb.checked) picked.add(p.map_id); else picked.delete(p.map_id); redraw(); });
        l.appendChild(cb);
        if (urls && urls[p.map_id]) { const im = d("img"); im.src = urls[p.map_id]; im.alt = ""; im.loading = "lazy"; l.appendChild(im); }
        l.appendChild(d("span", null, `${p.name || "a plan"}${p.refs === 0 ? " (placed by eye)" : ""}`));
        sheet.appendChild(l);
      }
      if (list.length > 1) sheet.appendChild(d("div", "pl-note", `${list.length} plans cover ${floorName(fid)}: ${list.length === 2 ? "both" : "all"} are read, and you pick which to trust per item.`));
    }
    // 2. Which kinds.
    sheet.appendChild(d("h5", null, "Which kinds"));
    const kindRow = (key, text, on, disabled, note) => {
      const l = d("label", "pl-tick");
      const cb = d("input"); cb.type = "checkbox"; cb.checked = on; cb.disabled = disabled;
      if (key) cb.addEventListener("change", () => { kinds[key] = cb.checked; redraw(); });
      l.append(cb, d("span", null, text + (note ? ` — ${note}` : "")));
      sheet.appendChild(l);
    };
    kindRow(null, "Stairs", true, true, "always read");
    kindRow("railing", "Railings beside stairs", kinds.railing, false, "a hint beside each staircase found");
    kindRow("light", "Lights", kinds.light, false, "only on a plan that draws light fixtures");
    if (kinds.light) {
      sheet.appendChild(d("div", "pl-note", "Does this plan draw light fixtures, like circles or pot marks? Most architect's plans don't; electrical sheets do."));
      for (const p of plans) {
        if (!picked.has(p.map_id) || outdoor(p.floor_id)) continue;
        const row_ = d("div", "pl-choose"), now = fixtures.get(p.map_id) || "unsure";
        row_.appendChild(d("span", null, `${p.name || "a plan"}:`));
        for (const [v, word] of [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]]) {
          const b = btn(word, v === "yes" ? "Read this plan for lights too" : "Don't read this plan for lights", () => { fixtures.set(p.map_id, v); redraw(); });
          b.setAttribute("aria-pressed", String(now === v));
          row_.appendChild(b);
        }
        sheet.appendChild(row_);
      }
    }
    // 3. What to expect.
    const n = picked.size, yes = kinds.light ? [...picked].filter(id => fixtures.get(id) === "yes").length : 0;
    const lo = Math.max(1, Math.round(n * 1.5)) + yes * 6, hi = Math.max(lo, n * 4 + yes * 12);
    sheet.appendChild(d("div", "pl-note", `About 1-2 staircases and 0-2 railing hints per plan${yes ? "; on a plan with fixtures 6-12 lights" : ""}. For your ${n} plan${n === 1 ? "" : "s"}: roughly ${lo}-${hi} items, `
      + `${Math.max(1, n) + yes}-${Math.max(1, n) * 3 + yes * 3} minutes to vet.`));
    if (yes) sheet.appendChild(d("div", "pl-note", "Light tiles are read last, 2.5-3 minutes a plan. Lights are never placed or moved: a symbol can only change a placed light's kind."));
    if (kinds.light) sheet.appendChild(d("div", "pl-note", "Tick only the sheets that draw lights: with more plans ticked, the session's time can run out before the lights are read."));
    // 4. Where the plans go.
    sheet.appendChild(d("h5", null, "Where the plans go"));
    const ai = info && info.ai;
    if (!ai || ai.ready === false) sheet.appendChild(d("div", "pl-note pl-bad", (ai && ai.message) || "Pick an AI Task in Settings → AI first."));
    else {
      sheet.appendChild(d("div", "pl-note", planNote(ai, n)));
      if (ai.local !== false || ai.backup) sheet.appendChild(d("div", "pl-note", sharedNote(!!ai.backup)));
    }
    // 5. Go.
    const acts = d("div", "pl-acts");
    const go = btn("", "Start reading", () => start(), "go");
    go.textContent = `Read ${n} plan${n === 1 ? "" : "s"}`;
    const blocked = info && info.start_blocked;
    go.disabled = busy || !ai || ai.ready === false || !!blocked || !n || (ai.main_away === true && !ai.backup);
    acts.appendChild(go);
    if (sess && Object.keys(sess.suggestions || {}).length) acts.appendChild(btn("Back to the last list", "The last session's items", () => { step = "list"; redraw(); }));
    sheet.appendChild(acts);
    if (blocked) sheet.appendChild(d("div", "pl-note", { already_running: "A session is already reading your plans.", too_soon: "A session started less than a minute ago: wait a moment.",
      daily_cap: "That's the day's sessions: try again tomorrow." }[blocked] || String(blocked)));
  }

  function paintProgress(){
    head("Reading your plans", "The read runs on the server: this page can close and come back.");
    const pr = (sess && sess.progress) || {};
    const name = pr.name || "a plan", i = pr.plan || 0, n = pr.of || (info && info.running ? "?" : 0);
    const what = pr.step === "check" ? `Checking a find on ${name}` : pr.step === "railing" ? `Looking for a railing on ${name}`
      : pr.step === "tiles" ? `Reading ${name} for lights, tile ${pr.tile || 1} of 9` : pr.step === "light_check" ? `Checking a light on ${name}` : `Reading ${name} for stairs`;
    const later = pr.step === "stairs" || !pr.step ? ` then checking each find.${sess && sess.lights_asked ? " Light tiles come last." : ""}` : "";
    sheet.appendChild(d("div", "pl-sum", `${what} (${i} of ${n})…${later} A local AI can take a minute a read.`));
    if (sess) sheet.appendChild(d("div", "pl-note", `${sess.reads || 0} reads so far, ${mins(sess.spent_s)} spent of ${mins(sess.budget_s)}.`));
    if (cancelNote) sheet.appendChild(d("div", "pl-note", cancelNote));
    errLine();
    const acts = d("div", "pl-acts");
    acts.appendChild(btn("Cancel", "Stop between reads; what was read so far is kept", () => cancel()));
    sheet.appendChild(acts);
  }

  /** A mark near a placed light that nobody read a symbol from: nothing says it is that light. */
  const unsaid = (s) => s.kind === "light" && s.state === "duplicate" && (s.geom || {}).symbol === "unknown";
  function summary(){
    if (sess.status === "failed" && NO_READ[sess.error]) return `Nothing was read: ${NO_READ[sess.error]}. That isn't the AI finding nothing: read again once it's sorted.`;
    const ss = sugs();
    const stairs = ss.filter(s => s.kind === "stairs" && s.state !== "duplicate").length;
    const rails = ss.filter(s => s.kind === "railing").length;
    const lights = ss.filter(s => s.kind === "light" && s.state !== "duplicate").length, lightsHere = ss.filter(s => s.kind === "light" && s.state === "duplicate" && !unsaid(s)).length, lightsUnsaid = ss.filter(unsaid).length;
    const skipped = sess.skipped || 0, read = (sess.plans || []).filter(p => p.answered).length, notRead = unread();
    const errs = sess.errors || {}, failedReads = Object.keys(NO_READ).reduce((t, k) => t + (errs[k] || 0), 0);
    const worst = Object.keys(NO_READ).reduce((a, k) => ((errs[k] || 0) > (errs[a] || 0) ? k : a));
    const lightsWord = sess.lights_asked ? `, ${lights} light${lights === 1 ? "" : "s"}` : "";
    let line = `Found ${stairs} stair${stairs === 1 ? "" : "s"}, ${rails} railing hint${rails === 1 ? "" : "s"}${lightsWord} on ${read} plan${read === 1 ? "" : "s"} in ${mins(sess.spent_s)}.`;
    if (lightsHere) line += ` ${lightsHere} light${lightsHere === 1 ? " was" : "s were"} already there.`;
    if (lightsUnsaid) line += ` ${lightsUnsaid} mark${lightsUnsaid === 1 ? "" : "s"} near a placed light ${lightsUnsaid === 1 ? "wasn't" : "weren't"} read closely enough to say what ${lightsUnsaid === 1 ? "it is" : "they are"}.`;
    if (sess.tiles_skipped === "slow") line += " Lights weren't read: this AI's first read took over 45 seconds, and nine tiles a plan would use up the session.";
    else if (sess.lights_asked && !sess.tiles && (sess.plans || []).some(p => (p.kinds || []).includes("light"))) line += " Lights weren't read: the time ran out first.";
    if (sess.light_dropped) line += ` ${sess.light_dropped} light${sess.light_dropped === 1 ? "" : "s"} left out: a closer look found no fixture there.`;
    if (skipped) line += ` ${skipped} plan${skipped === 1 ? "" : "s"} skipped (out of time).`;
    if (notRead) line += ` ${notRead} plan${notRead === 1 ? "" : "s"} couldn't be read.`;
    if (failedReads) line += ` ${failedReads} read${failedReads === 1 ? "" : "s"} failed: ${NO_READ[worst]}.`;
    if (sess.crop_dropped) line += ` ${sess.crop_dropped} left out: a closer look found no staircase there.`;
    if (sess.no_floor) line += ` ${sess.no_floor} left out: no floor below for a staircase to climb from.`;
    if (sess.status === "out_of_time") line += skipped || sess.cut_short ? " The session ran out of time." : " It stopped after two reads in a row got no answer.";
    if (sess.status === "cancelled") line += ` The session was ${CANCEL_WORDS[sess.error] || "cancelled"}.`;
    if (sess.status === "failed") line += sess.error === "restart" ? " Home Assistant restarted during the read; run it again." : " The read failed; run it again.";
    if (sess.backup_used) line += " Read by the backup AI task.";
    if (sess.frame === "named") line += " This AI's picture size isn't known, so positions may be coarse.";
    return line + (ss.length ? " Vet them one by one." : "");
  }

  /** What a light's card says, list and map alike. */
  function lightLines(sug, stillOpen){
    const m = sug.match || {}, g = sug.geom || {}, out = [];
    if (m.relation === "correction" && stillOpen) {
      out.push(`The plan draws ${SYMBOL_WORD[g.symbol] || "a fixture"} here. ${m.label || "This light"} is drawn as ${kindWord(m.now_kind)}.`);
      if (m.group) out.push("This room's lights are placed as a group: kind only?");
      else out.push("Only what it is drawn as can change: where it stands stays.");
    }
    if (sug.state === "unmatched") out.push("A fixture symbol with no placed light here. PadSpan doesn't place lights from a plan: place it yourself if it's right.");
    return out;
  }
  function row(sug, acts){
    const r = d("div", "pl-row");
    const c = d("canvas"); c.width = 240; c.height = 168;
    r.appendChild(c);
    if (urls) drawCrop(c, sug);
    const t = d("div", "pl-txt");
    const g = sug.geom || {}, m = sug.match || {};
    const kind = (KIND_OF[sug.kind] || KIND_OF.stairs).word;
    const seen = Array.isArray(sug.seen_on) && sug.seen_on.length > 1 ? ` · seen on ${sug.seen_on.length} plans` : ` · ${planName(sug.map_id)}`;
    const size = sug.kind === "stairs" ? ` · ${m1(g.width_m)} × ${m1(g.depth_m)} m` : "";
    const side = sug.kind === "railing" ? (g.side ? ` · the AI says ${g.side}` : " · a rail on one side: which?") : "";
    t.appendChild(d("div", null, `${kind} · ${floorName(sug.floor_id)}${seen}${size}${side}`));
    const rel = d("div", "pl-sub");
    const label = m.target_snap && m.target_snap.label ? m.target_snap.label : "a stair";
    const pend = pendingOf(sug.id);
    if (sug.kind === "light" && !pend && sug.state !== "stale" && !String(sug.state).startsWith("committed") && sug.state !== "undone") {
      if (m.relation === "correction") rel.appendChild(d("span", "pl-rel correction", `correction · ${m.label || "a placed light"} is drawn as ${kindWord(m.now_kind)}`));
      else if (m.relation === "unmatched") rel.appendChild(d("span", "pl-rel stale", "a fixture symbol with no placed light here"));
    } else if (pend) rel.appendChild(d("span", "pl-rel kept", pend.v === "correction" ? "kept as a correction, until Save" : "kept, until Save"));
    else if (sug.state === "committed_new") rel.appendChild(d("span", "pl-rel kept", "kept as new"));
    else if (sug.state === "committed_correction") rel.appendChild(d("span", "pl-rel kept", "kept as a correction"));
    else if (sug.state === "undone") rel.appendChild(d("span", "pl-rel stale", "undone"));
    else if (sug.state === "stale") rel.appendChild(Object.assign(d("span", "pl-rel stale", movedPlan(sug.map_id) ? "the plan moved: read it again" : "changed since you looked"), { title: "The plan or the stair it points at changed since the read." }));
    else if (m.relation === "correction" && sug.kind === "railing") rel.appendChild(d("span", "pl-rel correction", `correction · a rail on another side of ${label}`));
    else if (m.relation === "correction") rel.appendChild(d("span", "pl-rel correction", `correction · ${m1(m.distance_m)} m from ${label}`));
    else if (m.relation === "stacked") rel.appendChild(d("span", "pl-rel stacked", "a second staircase here, stacked?"));
    else if (m.relation === "new") rel.appendChild(d("span", "pl-rel new", (m.near_names || []).length ? `new · near ${m.near_names.join(" and ")}` : "new"));
    rel.appendChild(document.createTextNode(CUE[sug.kind] || ""));
    t.appendChild(rel);
    const stillOpen = OPEN.has(sug.state) && sug.state !== "stale";
    if (stillOpen && sug.kind === "stairs" && m.relation === "correction" && m.hand === true) t.appendChild(d("div", "pl-sub", `You placed this one. The AI puts it ${m1(m.distance_m)} m away. Keep yours unless the plan says otherwise.`));
    else if (stillOpen && sug.kind === "stairs" && m.relation === "correction") t.appendChild(d("div", "pl-sub", `The AI placed this one too. This read puts it ${m1(m.distance_m)} m away.`));
    if (sug.kind === "light") for (const line of lightLines(sug, stillOpen)) t.appendChild(d("div", "pl-sub", line));
    for (const o of m.others || []) t.appendChild(d("div", "pl-sub", `${planName(o.map_id)} puts one ${m1(o.distance_m)} m from here: both are listed, nothing wins by itself.`));
    if (m.held === "frame") t.appendChild(d("div", "pl-sub", "Position may be coarse: this AI's picture size isn't known."));
    else if (m.held === "eye") t.appendChild(d("div", "pl-sub", sug.kind === "light" ? "The plan was placed by eye, so this may be another light." : "The plan was placed by eye, so the offset may be the plan's."));
    if (sug.verdict && sug.verdict.why) t.appendChild(d("div", "pl-sub", `Marked wrong: ${WHY_WORD[sug.verdict.why] || sug.verdict.why}${sug.verdict.remembered ? " (ignored before)" : ""}`));
    if (acts) t.appendChild(acts);
    r.appendChild(t);
    return r;
  }
  /** The floor a stacked staircase climbs from: asked before it is kept (the arrow read is unreliable). */
  function floorChoice(sug){
    const all = (ctx.floors() || []).filter(G => G && G.fl && !G.fl.outdoor && !G.fl.parent).sort((p, q) => (p.fl.elev || 0) - (q.fl.elev || 0));
    const from = all.slice(0, -1);
    const row_ = d("div", "pl-choose");
    row_.appendChild(d("span", null, "It climbs from:"));
    const cur = stackFloor.get(sug.id) || sug.floor_id;
    for (const G of from) {
      const b = btn(G.fl.name || String(G.fl.id), `It starts on ${G.fl.name || G.fl.id}`, () => { stackFloor.set(sug.id, String(G.fl.id)); if (mapAwake) goTo(sug.id); else redraw(); });   // its pin and ghost are on that floor now
      b.setAttribute("aria-pressed", String(String(G.fl.id) === String(cur)));
      row_.appendChild(b);
    }
    return row_;
  }
  /** A railing hint: which side (only when the AI could tell is one picked for you), which style. */
  function railActs(sug, a){
    const home = railHome(sug), dr = ctx.draft && ctx.draft();
    const q = home && dr ? dr.cur.pieces[home] : null;
    const params = q && q.recipe ? q.recipe.params : null;
    const pick = railPick.get(sug.id) || {};
    const said = { left: "inner", right: "outer", both: "both" }[(sug.geom || {}).side];
    if (!pick.side && said && (said === "both" || flat(params))) pick.side = said;
    if (!pick.style && params && RAIL_STYLES.some(([v]) => v === params.rail_style)) pick.style = params.rail_style;
    railPick.set(sug.id, pick);
    if (!home || !q) { a.appendChild(d("span", "pl-sub", "Keep its stair first: there is nothing to put a rail on yet.")); return; }
    const sides = d("div", "pl-choose");
    sides.appendChild(d("span", null, "Side:"));
    for (const [v, word] of railSides(params)) {
      const b = btn(word, `A rail: ${word.toLowerCase()}`, () => { pick.side = v; redraw(); });
      b.setAttribute("aria-pressed", String(pick.side === v));
      sides.appendChild(b);
    }
    a.appendChild(sides);
    const looks = d("div", "pl-choose");
    looks.appendChild(d("span", null, "Style:"));
    for (const [v, word] of RAIL_STYLES) {
      const b = btn(word, `The rail's style: ${word.toLowerCase()}`, () => { pick.style = v; redraw(); });
      b.setAttribute("aria-pressed", String((pick.style || "balustrade") === v));
      looks.appendChild(b);
    }
    a.appendChild(looks);
    const keep = btn("Keep this rail", "Into your draft: nothing is kept until Save", () => keepRail(sug), "go");
    keep.disabled = busy || !pick.side;
    a.appendChild(keep);
  }
  function queuedActs(sug){
    const a = d("div", "pl-acts");
    const m = sug.match || {};
    const stale = sug.state === "stale";
    // Already in the draft: only taking it back. The toolbar's Undo does the same.
    if (pendingOf(sug.id)) {
      const b = btn("Take that back", "Out of your draft: nothing was kept", () => takeBack(sug));
      b.disabled = busy;
      a.appendChild(b);
      return a;
    }
    const moved = movedPlan(sug.map_id);
    if (sug.kind === "light") {
      if (!stale && !moved && m.relation === "correction") {
        const mine = btn("Keep mine", "It stays as it is (noted at once)", () => verdict(sug, "failure", "already_here"));
        a.append(btn("Take the kind", "Into your draft: nothing is kept until Save", () => keepLight(sug), "go"), mine);
      }
    } else if (sug.kind === "railing") { if (!stale) railActs(sug, a); }
    else if (!moved) {
      if (m.relation === "stacked") a.appendChild(floorChoice(sug));
      const bNew = btn("New", m.relation === "correction" ? "A staircase of its own, beside the one you have (into your draft)" : "Add it to your draft: nothing is kept until Save", () => keepNew(sug), m.relation === "correction" ? null : "go");
      if (m.relation === "correction" && !stale) {
        // Keep mine is where a hand-placed stair starts; the AI's position only where the AI placed it too.
        const mine = btn("Keep mine", "Yours stays where it is (noted at once)", () => verdict(sug, "failure", "already_here"));
        const takeIt = btn("Take the AI's position", "Move it there in your draft: nothing is kept until Save", () => takeAi(sug), m.hand === true ? null : "go");
        if (m.hand === true) { a.append(mine, takeIt); if (!focusBtn) focusBtn = mine; }
        else { a.append(takeIt, mine); if (!focusBtn) focusBtn = takeIt; }
      }
      a.appendChild(bNew);
      if (m.relation === "new" && !m.held) for (const [i, id] of (m.near || []).entries()) {
        if (m.near_snaps && m.near_snaps[id]) a.appendChild(btn(`A correction of ${(m.near_names || [])[i] || "that stair"}`, "Move that stair here in your draft: nothing is kept until Save", () => takeAi(sug, id)));
      }
    }
    if (failing === sug.id) {
      for (const [k, word] of WHY) a.appendChild(btn(word, `Mark it wrong: ${word.toLowerCase()}`, () => verdict(sug, "failure", k), "why"));
      a.appendChild(btn("Never mind", "Keep it in the queue", () => { failing = null; redraw(); }));
    } else {
      if (sug.state !== "stale" && sug.state !== "right") a.appendChild(btn("Looks right", "The AI got this one right (noted at once; nothing is written to your house)", () => verdict(sug, "right")));
      a.appendChild(btn("Failure", "Mark it wrong, with a reason (noted at once)", () => { failing = sug.id; redraw(); }));
      if (sug.state !== "stale" && sug.state !== "later") a.appendChild(btn("Later", "Come back to it (noted at once)", () => verdict(sug, "later")));
      if (sug.state === "right" || sug.state === "later") a.appendChild(btn("Take that back", "Back to the queue", () => verdict(sug, "back")));
    }
    for (const b of a.querySelectorAll("button")) if (!b.disabled) b.disabled = busy;
    return a;
  }
  function backActs(sug){
    const a = d("div", "pl-acts");
    const b = btn("Take that back", "Back to the queue", () => verdict(sug, "back")); b.disabled = busy;
    a.appendChild(b);
    return a;
  }

  function paintList(){
    head("Add data via plans", "The AI's finds, one by one. Nothing goes into your house until you press Save.");
    sheet.appendChild(d("div", "pl-ban", BANNER));
    sheet.appendChild(d("div", "pl-sum", summary()));
    errLine();
    const ss = sugs();
    const order = (s) => (s.kind === "stairs" ? 0 : s.kind === "railing" ? 1 : 2);
    const group = (title, list, actsOf) => {
      if (!list.length) return;
      sheet.appendChild(d("h5", null, `${title} (${list.length})`));
      for (const s of list.sort((a, b) => order(a) - order(b) || String(a.floor_id).localeCompare(String(b.floor_id)))) sheet.appendChild(row(s, actsOf ? actsOf(s) : null));
    };
    const pendIds = new Set(pendings().map(p => p.sug_id));
    group("To keep, when you Save", ss.filter(s => pendIds.has(s.id)), queuedActs);
    group("To check", ss.filter(s => s.state === "queued" && !pendIds.has(s.id)), queuedActs);
    group("Changed since you looked", ss.filter(s => s.state === "stale" && !pendIds.has(s.id)), queuedActs);
    group("Looks right", ss.filter(s => s.state === "right" && !pendIds.has(s.id)), queuedActs);
    group("Later", ss.filter(s => s.state === "later" && !pendIds.has(s.id)), queuedActs);
    group("Marked wrong", ss.filter(s => s.state === "failure" && !(s.verdict && s.verdict.remembered)), backActs);
    group("No placed light here", ss.filter(s => s.state === "unmatched"), (s) => {
      if (!canOpenAtlas()) return null;
      const a = d("div", "pl-acts");
      a.appendChild(btn("Open Mapping → Atlas", "Place a light there yourself: the plans never place one", () => openAtlas(s)));
      return a;
    });
    group("Kept", ss.filter(s => String(s.state).startsWith("committed")), null);
    group("Undone", ss.filter(s => s.state === "undone"), null);
    group("Gone with its stair", ss.filter(s => s.state === "settled"), null);
    group("Already in your house", ss.filter(s => s.state === "duplicate" && !unsaid(s)), null);
    group("Near a placed light, not read closely", ss.filter(unsaid), null);
    group("Ignored before", ss.filter(s => s.state === "failure" && s.verdict && s.verdict.remembered),
      (s) => { const a = d("div", "pl-acts"); const b = btn("Un-ignore", "Forget that reject and queue it again", () => forget(s.verdict.reject)); b.disabled = busy; a.appendChild(b); return a; });
    if (!ss.length && sess.status === "done") sheet.appendChild(d("div", "pl-note", unread() ? "The AI found nothing on the plans it could read." : "The AI found nothing on these plans."));
    const foot = d("div", "pl-foot");
    const pend = pendings();
    if (pend.length) {
      const n = pend.filter(p => p.v === "new" && p.made).length, c = pend.filter(p => p.v === "correction").length, l = pend.filter(p => p.rail).length;
      const words = [n ? `${n} new` : "", c ? `${c} correction${c === 1 ? "" : "s"}` : "", l ? `${l} railing${l === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
      const keep = btn(`Keep ${words} (one undo for the whole session)`, "Save: into your 3D house, with a safety backup and one undo", () => ctx.save(), "go");
      keep.disabled = busy || !!(ctx.saving && ctx.saving());
      foot.appendChild(keep);
    }
    if (undoInfo && !askUndo) {
      const word = undoInfo.puts_back ? `Put back ${undoInfo.items}` : `Undo this session (${undoInfo.items})`;
      const b = btn(word, "Takes back what this session kept; anything changed since is left", () => { askUndo = true; redraw(); });
      b.disabled = busy;
      foot.appendChild(b);
    }
    foot.appendChild(btn("Manage ignored", "The finds you marked wrong, remembered per plan", () => openIgnored()));
    foot.appendChild(btn("Read again", "Back to the plans and the button", () => readAgain()));
    if (mapCan() && mapItems().length) foot.appendChild(btn("Back to the map", "The plan under the house, a pin per item", () => { listAsked = false; redraw(); }));
    sheet.appendChild(foot);
    if (undoInfo && askUndo) {
      const a = d("div", "pl-acts");
      a.appendChild(d("span", "pl-sub", undoInfo.puts_back ? "Put those items back in your 3D house?" : "Take what this session kept out of your 3D house? Anything you changed since is left as it is."));
      a.appendChild(btn(undoInfo.puts_back ? "Put back" : "Undo", "Goes at once", () => undoSession(), "go"));
      a.appendChild(btn("Cancel", "Leave it", () => { askUndo = false; redraw(); }));
      sheet.appendChild(a);
    }
  }

  function paintIgnored(){
    head("Ignored before", "Finds you marked wrong, remembered for that plan until it is moved or replaced.");
    errLine();
    if (ignored === null) sheet.appendChild(d("div", "pl-note", "Loading…"));
    else if (!ignored.length) sheet.appendChild(d("div", "pl-note", "Nothing is ignored."));
    for (const r of ignored || []) {
      const rowEl = d("div", "pl-row");
      const t = d("div", "pl-txt");
      t.appendChild(d("div", null, `${(KIND_OF[r.kind] || KIND_OF.stairs).word} · ${r.plan || "a plan"} · ${floorName(r.floor_id)} · at ${m1(r.x_m)}, ${m1(r.y_m)} m`));
      t.appendChild(d("div", "pl-sub", `Marked wrong: ${WHY_WORD[r.why] || r.why || "no reason given"}`));
      const a = d("div", "pl-acts");
      const b = btn("Forget", "Queue it again next time", () => forget(r.key)); b.disabled = busy;
      a.appendChild(b);
      t.appendChild(a);
      rowEl.appendChild(t);
      sheet.appendChild(rowEl);
    }
    const foot = d("div", "pl-foot");
    foot.appendChild(btn("Back", "Back to the list", () => { view = "list"; redraw(); }));
    sheet.appendChild(foot);
  }

  // ── the vetting map ───────────────────────────────────────────────────────
  // One card, one plan, a few pins. The list is one press away (and the only
  // view with no 3D behind it). All of it hangs off one group in the view's
  // scene and one layer of pins, taken away whole when the tool closes.
  const { THREE } = ctx;
  const pinsEl = d("div", "pl-pins");
  ctx.root.appendChild(pinsEl);
  const pins = new Map(), ghosts = new Map(), stairGhosts = new Map(), tags = new Map();
  let listAsked = false, mapAwake = false, cur = null, card = "item", floorSeen = null, expectFloor = null, shell = null, flyDue = false;
  let vCount = 0, vSinceRecap = 0, lastRecapAt = 0, moving = null, gesture = null, more = false, askDismiss = false, nextFloorItem = null, nearOpen = false;
  let planOn = true, opacity = PLAN_OPACITY, fade = GHOST, planNow = null, planMesh = null, planTok = 0, planKey = null, texLive = 0, planGone = false;
  let group = null, onion = null, onionKey = "", suppressClick = false, ghostsLate = false;
  const planPick = new Map(), acts = [];

  const mapCan = () => !!THREE && typeof ctx.scene === "function";
  const stateOf = (s) => pinState(s, pendingOf(s.id));
  const mapItems = () => sugs().filter(s => stateOf(s) !== null);
  const mapWanted = () => mapCan() && !listAsked && step === "list" && view === "list" && !!sess && mapItems().length > 0;
  const floorUi = (fid) => {
    const all = ctx.floors() || [], want = ctx.canon ? String(ctx.canon(fid)) : String(fid);
    return all.find(G => G && G.fl && String(G.fl.id) === want) || all.find(G => G && G.fl && String(G.fl.id) === String(fid)) || null;
  };
  const same = (a, b) => { const fa = floorUi(a), fb = floorUi(b); return fa && fb ? fa === fb : String(a) === String(b); };
  const itemFloorId = (s) => { const p = pendingOf(s.id), dr = ctx.draft && ctx.draft(); const q = p && dr ? dr.cur.pieces[p.piece] : null; return q ? q.floor_id : stackFloor.get(s.id) || s.floor_id; };
  const roomAt = (s, at = null, fid = itemFloorId(s)) => {
    const F = floorUi(fid), g = at || s.geom || {};
    return (F && (F.rooms || []).find(r2 => !r2.outdoor && Array.isArray(r2.pts) && r2.pts.length >= 3 && inPolygon(num(g.x_m) ?? 0, num(g.y_m) ?? 0, r2.pts))) || null;
  };
  const roomOf = (s, at = null) => { const r = roomAt(s, at); return r ? r.name || "" : ""; };
  // The order goes by the floor the AI read it on: a floor picked for a stacked stair renumbers nothing.
  const roomRank = (s) => { const r = roomAt(s, null, s.floor_id); return r ? Math.min(...r.pts.map(p => p[1])) * 1000 + Math.min(...r.pts.map(p => p[0])) : Infinity; };
  const floorRank = (s) => { const F = floorUi(s.floor_id); return F ? num(F.fl.elev) ?? 0 : 0; };
  const orderNow = () => orderItems(mapItems(), floorRank, roomRank);
  const sugOf = (id) => (id && sess && sess.suggestions ? sess.suggestions[id] || null : null);
  const shownFloor = () => (expectFloor && floorUi(expectFloor)) || (ctx.currentFloor ? ctx.currentFloor() : null);
  /** Where an item stands now: a stair kept moves with its piece in the draft. */
  function posOf(s){
    const dr = ctx.draft && ctx.draft(), p = pendingOf(s.id), g = s.geom || {};
    const pc = (id) => (id && dr ? dr.cur.pieces[id] : null);
    const q = (p && pc(p.piece)) || (s.kind === "railing" ? pc(railHome(s)) : null) || (String(s.state).startsWith("committed") ? pc(s.piece_id) : null);
    return q ? { x_m: q.x_m, y_m: q.y_m } : { x_m: g.x_m, y_m: g.y_m };
  }
  const targetOf = (s) => { const m = s.match || {}, dr = ctx.draft && ctx.draft(); return m.target && dr ? dr.cur.pieces[m.target] || null : null; };
  /** The plans another read of this staircase came from, and that suggestion. */
  const twins = (s) => {
    const m = s.match || {};
    return (m.others || []).map(o => ({ ...o, sug: sugs().find(t => t.id !== s.id && t.kind === s.kind && t.map_id === o.map_id && same(t.floor_id, s.floor_id)) || null }));
  };

  // ── the plan under the house: one texture, one plane ──────────────────────
  function planChoices(F){
    const all = (info && info.plans) || [];
    return F ? all.filter(p => same(p.floor_id, F.fl.id) && !movedPlan(p.map_id)) : [];
  }
  function planWanted(F){
    const list = planChoices(F), c = sugOf(cur);
    const want = F ? planPick.get(String(F.fl.id)) || (c && same(itemFloorId(c), F.fl.id) ? c.map_id : null) : null;
    return all_(info).find(p => p.map_id === want && !movedPlan(p.map_id)) || list[0] || null;
  }
  const all_ = (i) => (i && i.plans) || [];
  function releasePlan(){
    planTok++;
    planKey = null; planNow = null; planGone = false;
    if (!planMesh) return;
    if (planMesh.parent) planMesh.parent.remove(planMesh);
    if (planMesh.material.map) { planMesh.material.map.dispose(); texLive--; }
    planMesh.material.dispose(); planMesh.geometry.dispose();
    planMesh = null;
  }
  /** The plan as a plane on floor F, its corners in metres from the server. A
   *  picture that won't load or draw leaves the house without it, nothing more. */
  function syncPlan(F){
    const p = planWanted(F), url = p && urls ? urls[p.map_id] : null;
    const key = p && url && F ? `${p.map_id}|${F.fl.id}|${F.fl.elev}` : null;
    if (key !== planKey) {
      releasePlan();
      planKey = key; planNow = key ? p : null;
      if (key) loadPlan(p, url, F, planTok);
    }
    if (planMesh) { planMesh.visible = planOn; planMesh.material.opacity = opacity; }
  }
  function loadPlan(p, url, F, tok){
    const img = new Image();
    img.onload = () => {
      if (tok !== planTok) return;                      // the floor or the plan changed while it loaded: never a second texture
      try {
        const [w, h] = fitSize(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const tex = new THREE.CanvasTexture(c);
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        texLive++;
        const geo = new THREE.BufferGeometry(), y = F.fl.elev + 0.025, cs = p.corners_m;
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([cs[0][0], y, cs[0][1], cs[1][0], y, cs[1][1], cs[2][0], y, cs[2][1], cs[3][0], y, cs[3][1]]), 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
        geo.setIndex([0, 2, 1, 0, 3, 2]);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
        planMesh = new THREE.Mesh(geo, mat);
        planMesh.renderOrder = 1; planMesh.visible = planOn; planMesh.frustumCulled = false;
        if (group) group.add(planMesh);
        if (ctx.render) ctx.render();
      } catch (_) { planGone = true; }
    };
    img.onerror = () => { if (tok === planTok) { planGone = true; redraw(); } };
    img.src = url;
  }

  // ── ghosts: the real builders, outside the draft ──────────────────────────
  const dashMat = () => new THREE.MeshBasicMaterial({ color: DASH_COL, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  function dashMesh(tris, y){
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(tris, 3));
    const m = new THREE.Mesh(geo, dashMat());
    m.position.y = y; m.renderOrder = 8; m.frustumCulled = false;
    return m;
  }
  const dropMesh = (m) => { if (m.parent) m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); };
  /** The piece a suggestion would be, for drawing only. A correction is the stair
   *  it would move, where the AI puts it: shape and turn are never corrected. */
  function ghostPiece(s){
    const m = s.match || {}, g = s.geom || {};
    if (s.kind === "stairs") {
      if (m.relation === "correction") { const t = targetOf(s); if (t) return { ...t, x_m: g.x_m, y_m: g.y_m }; }
      const fid = stackFloor.get(s.id) || s.floor_id, k = `${s.id}|${fid}`;
      if (!stairGhosts.has(k)) { const pc = ctx.stairPiece(g, fid, PIECE_LABEL); if (!pc) return null; stairGhosts.set(k, pc); }
      return stairGhosts.get(k);
    }
    if (s.kind === "railing" && s.id === cur) {
      // A rail on its stair, as it would be: the side picked, or both while none is.
      const dr = ctx.draft && ctx.draft(), home = railHome(s), st = sugOf((s.geom || {}).stair) || sugOf(s.of_stair);
      const base = (home && dr ? dr.cur.pieces[home] : null) || (st ? ghostPiece(st) : null), pick = railPick.get(s.id) || {};
      if (!base || !base.recipe) return null;
      const said = { left: "inner", right: "outer", both: "both" }[g.side];
      return { ...base, recipe: { ...base.recipe, params: { ...(base.recipe.params || {}), rail: pick.side || said || "both", rail_style: pick.style || "balustrade" } } };
    }
    return null;
  }
  function ghostWanted(s){
    if (pendingOf(s.id) || movedPlan(s.map_id)) return false;
    return s.state === "queued" || s.state === "later" || s.state === "stale" || (s.kind === "light" && s.state === "unmatched");
  }
  function dropGhost(id){
    const G = ghosts.get(id);
    if (!G) return;
    if (G.root.parent) G.root.parent.remove(G.root);
    dropMesh(G.dash);
    for (const m of G.mats) m.dispose();
    if (G.geo) G.geo.dispose();
    try { const B = ctx.FURN && ctx.FURN(); if (B && B.disposePiece && G.body) B.disposePiece(G.body); } catch (_) { /* best effort */ }
    ghosts.delete(id);
  }
  function buildGhost(id, piece, F, key){
    const B = ctx.FURN && ctx.FURN();
    if (!B || typeof B.buildPiece !== "function") { ghostsLate = true; return; }    // the builders still on their way: drawn when they are in
    const recipe = ctx.recipeOf ? ctx.recipeOf(piece) || piece.recipe : piece.recipe;
    const body = B.buildPiece(THREE, recipe, { quality: "low" }), mats = [];
    const see = (m) => { const c = m.clone(); c.transparent = true; c.opacity = id === cur ? fade : GHOST; c.depthWrite = false; mats.push(c); return c; };
    body.traverse((o) => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map(see) : see(o.material); o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; } });
    const root = new THREE.Group();
    root.name = `plan-ghost:${id}`;
    root.position.set(num(piece.x_m) ?? 0, F.fl.elev + (num(piece.z_m) ?? 0), num(piece.y_m) ?? 0);
    root.rotation.set(0, ctx.PIECES.yawOfRot(piece.rotation), 0);
    root.add(body);
    group.add(root);
    const corners = ctx.STOREY && ctx.STOREY.footprint ? ctx.STOREY.footprint(piece) : null;
    const dash = dashMesh(dashTriangles(corners || [[piece.x_m, piece.y_m]], true), F.fl.elev + 0.05);
    group.add(dash);
    ghosts.set(id, { root, dash, body, mats, key, corners, id, floor: F });
  }
  /** A light's ghost: a disc and a dashed ring where the plan draws the symbol. It stands for nothing in the house. */
  function buildLightGhost(id, g, F, key){
    const x = num(g.x_m) ?? 0, y = num(g.y_m) ?? 0, R = 0.28, ring = [], corners = [[x - R, y - R], [x + R, y - R], [x + R, y + R], [x - R, y + R]];
    for (let i = 0; i < 16; i++) ring.push([x + Math.cos(i * Math.PI / 8) * R, y + Math.sin(i * Math.PI / 8) * R]);
    const geo = new THREE.CircleGeometry(0.17, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: DASH_COL, transparent: true, opacity: id === cur ? fade : GHOST, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(geo, mat), root = new THREE.Group();
    disc.renderOrder = 6;
    root.name = `plan-ghost:${id}`;
    root.position.set(x, F.fl.elev + 0.05, y);
    root.add(disc);
    group.add(root);
    const dash = dashMesh(dashTriangles(ring, true, 0.09, 0.06, 0.04), F.fl.elev + 0.05);
    group.add(dash);
    ghosts.set(id, { root, dash, body: null, geo, mats: [mat], key, corners, id, floor: F });
  }
  function syncGhosts(F){
    const want = new Map();
    if (F) for (const s of sugs()) {
      if (!same(itemFloorId(s), F.fl.id) || !ghostWanted(s)) continue;
      if (s.kind === "light") { want.set(s.id, { light: s.geom || {}, key: JSON.stringify([(s.geom || {}).x_m, (s.geom || {}).y_m, F.fl.elev]) }); continue; }
      const pc = ghostPiece(s);
      if (!pc) continue;
      const recipe = ctx.recipeOf ? ctx.recipeOf(pc) || pc.recipe : pc.recipe;
      want.set(s.id, { pc, key: JSON.stringify([pc.x_m, pc.y_m, pc.z_m, pc.rotation, recipe, F.fl.elev]) });
    }
    for (const [id, G] of [...ghosts]) { const w = want.get(id); if (!w || w.key !== G.key) dropGhost(id); }
    for (const [id, w] of want) if (!ghosts.has(id)) { try { if (w.light) buildLightGhost(id, w.light, F, w.key); else buildGhost(id, w.pc, F, w.key); } catch (_) { /* a ghost that won't draw: its pin still stands */ } }
    for (const [id, G] of ghosts) for (const m of G.mats) m.opacity = id === cur ? fade : GHOST;
  }
  /** Before and after on a correction: the path of the move, dashed, between the stair and the ghost. */
  function syncOnion(F){
    const c = sugOf(cur), p = c ? pendingOf(c.id) : null;
    let from = null, to = null;
    if (c && c.kind === "light" && F && same(itemFloorId(c), F.fl.id)) {
      // Which light it is about: the line from the light to the symbol. Nothing moves.
      const snap = (c.match || {}).target_snap, g = c.geom || {};
      if (snap && (c.match || {}).relation === "correction" && ghostWanted(c) && Math.hypot(snap.x_m - g.x_m, snap.y_m - g.y_m) >= 0.05) { from = [snap.x_m, snap.y_m]; to = [g.x_m, g.y_m]; }
    } else if (c && c.kind === "stairs" && F && same(itemFloorId(c), F.fl.id)) {
      if (p && p.v === "correction") {
        const dr = ctx.draft(), q = dr.cur.pieces[p.piece], e = q && q[NOTE()] && q[NOTE()].sugs[c.id];
        if (q && e && e.was) { from = [e.was.x_m, e.was.y_m]; to = [q.x_m, q.y_m]; }
      } else if (!p && (c.match || {}).relation === "correction" && ghostWanted(c)) {
        const t = targetOf(c), g = c.geom || {};
        if (t) { from = [t.x_m, t.y_m]; to = [g.x_m, g.y_m]; }
      }
    }
    const key = from ? JSON.stringify([from, to, F.fl.elev]) : "";
    if (key === onionKey) return;
    onionKey = key;
    if (onion) { dropMesh(onion); onion = null; }
    if (from) { onion = dashMesh(dashTriangles([from, to], false, 0.18, 0.12, 0.07), F.fl.elev + 0.06); group.add(onion); }
  }

  // ── pins ──────────────────────────────────────────────────────────────────
  function pressPin(id, e){
    if (e) e.stopPropagation();
    if (suppressClick) { suppressClick = false; return; }
    goTo(id);
  }
  function syncPins(F, order){
    pinsEl.classList.toggle("touch", touchy());
    const here = new Set();
    order.forEach((s, i) => {
      if (!F || !same(itemFloorId(s), F.fl.id)) return;
      const st = stateOf(s);
      here.add(s.id);
      let P = pins.get(s.id);
      if (!P) {
        const el = d("button", "pl-pin");
        el.type = "button";
        el.addEventListener("click", guard((e) => pressPin(s.id, e)));
        el.addEventListener("pointerdown", guard((e) => {
          if (moving && s.id === cur) { e.preventDefault(); e.stopPropagation(); gesture = dragFrom(e, true); try { el.setPointerCapture(e.pointerId); } catch (_) { /* moved on the canvas instead */ } }
        }));
        el.addEventListener("pointermove", guard((e) => { if (gesture && gesture.pin) move(e); }));
        el.addEventListener("pointerup", guard((e) => { if (gesture && gesture.pin) { suppressClick = gesture.moved; up(e); } }));
        pinsEl.appendChild(el);
        P = { id: s.id, el, xf: "" };
        pins.set(s.id, P);
      }
      const word = (KIND_OF[s.kind] || KIND_OF.stairs).word, n = String(i + 1), el = P.el;
      if (el.dataset.n !== n || el.dataset.kind !== s.kind) { el.innerHTML = `${(KIND_OF[s.kind] || KIND_OF.stairs).glyph}<span>${n}</span>`; el.dataset.n = n; el.dataset.kind = s.kind; }
      el.dataset.state = st;
      el.classList.toggle("cur", s.id === cur);
      el.classList.toggle("moving", moving !== null && s.id === cur);
      el.title = `${n}: ${word} · ${PIN_SAYS[st] || st}`;
      el.setAttribute("aria-label", el.title);
    });
    for (const [id, P] of [...pins]) if (!here.has(id)) { P.el.remove(); pins.delete(id); }
    // The plans' names on both ghosts, when two plans disagree; the move in numbers beside a correction.
    const c = sugOf(cur), wantTags = new Map();
    if (c && card === "item" && F && same(itemFloorId(c), F.fl.id)) {
      const tw = twins(c).filter(t => t.sug);
      if (tw.length) { wantTags.set(c.id, planName(c.map_id)); for (const t of tw) wantTags.set(t.sug.id, planName(t.map_id)); }
    }
    for (const [id, el] of [...tags]) if (!wantTags.has(id)) { el.remove(); tags.delete(id); }
    for (const [id, text] of wantTags) {
      let el = tags.get(id);
      if (!el) { el = d("div", "pl-tag"); pinsEl.appendChild(el); tags.set(id, el); }
      el.textContent = text;
    }
  }
  const touchy = () => (ctx.root && ctx.root.clientWidth > 0 && ctx.root.clientWidth <= 600) || !!(typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const PIN_SAYS = { queued: "to check", new: "new, until Save", correction: "a correction, until Save", failure: "marked wrong", later: "later", right: "looks right",
    stale: "changed since you looked", unmatched: "no placed light here", kept_new: "kept as new", kept_correction: "kept as a correction" };
  /** Only when the view draws (it draws nothing at rest): pins where they are on
   *  screen, and a floor or a house redrawn under them. */
  function layout(){
    if (!mapAwake) return;
    const F0 = ctx.currentFloor ? ctx.currentFloor() : null, id = F0 ? String(F0.fl.id) : null, gen = ctx.shellGen ? ctx.shellGen() : 0;
    if (ghostsLate && ctx.FURN && ctx.FURN()) { ghostsLate = false; syncMap(); }
    const arrived = !!expectFloor && floorUi(expectFloor) === F0;
    if (arrived) expectFloor = null;
    if (id !== floorSeen || gen !== shell) {
      const moved = id !== floorSeen && floorSeen !== null;
      floorSeen = id; shell = gen;
      if (moved && !arrived && !expectFloor) floorByHand(F0);
      else syncMap();
    }
    const F = shownFloor();
    if (!F || !ctx.screenAt) return;
    const r0 = ctx.root.getBoundingClientRect();
    const list = [...pins.values()], gap = touchy() ? 54 : 46;
    const pts = list.map((P) => { const s = sugOf(P.id), at = s ? posOf(s) : null, q = at ? ctx.screenAt(F, at.x_m, at.y_m, 0.1) : null; return q ? [q[0] - r0.left, q[1] - r0.top] : null; });
    const placed = spreadPins(pts, gap);
    list.forEach((P, i) => {
      const q = placed[i], xf = q ? `translate(${q[0].toFixed(1)}px,${q[1].toFixed(1)}px) translate(-50%,-50%)` : "";
      if (xf !== P.xf) { P.xf = xf; P.el.style.transform = xf; P.el.style.display = q ? "" : "none"; }
      const t = tags.get(P.id);
      if (t) { if (q) { t.style.display = ""; t.style.transform = `translate(${(q[0] - P.el.offsetWidth / 2 - 6).toFixed(1)}px,${q[1].toFixed(1)}px) translate(-100%,-50%)`; } else t.style.display = "none"; }
    });
  }

  // ── going to an item ──────────────────────────────────────────────────────
  /** What covers the view: the toolbar on top, the card to the right (or, on a phone, below), the bar. */
  function padNow(){
    const r = ctx.root.getBoundingClientRect(), c = sheet.getBoundingClientRect(), of = (q) => { const e = ctx.root.querySelector(q); return e ? e.getBoundingClientRect() : null; };
    const tools = of(".la3d-tools"), bar = of(".la3d-bar"), under = c.width >= r.width * 0.8;
    return { top: tools ? Math.max(0, tools.bottom - r.top) : 0, right: c.width && !under ? Math.max(0, r.right - c.left) : 0,
             bottom: Math.max(c.width && under ? r.bottom - c.top : 0, bar ? r.bottom - bar.top : 0) };
  }
  /** A floor that shows well whole stays whole, so the house never leaves the view.
   *  Too small that way (a phone, a big house): the item with what is round it. */
  function flyToItem(s){
    if (!ctx.flySpot || !s) return;
    const F = floorUi(itemFloorId(s)), at = posOf(s);
    if (!F || num(at.x_m) === null) return;
    const xs = [], ys = [], pad = padNow(), r0 = ctx.root.getBoundingClientRect();
    for (const r of F.rooms || []) for (const p of r.pts || []) { xs.push(p[0]); ys.push(p[1]); }
    const room = Math.min(r0.width - pad.right, r0.height - pad.top - pad.bottom), most = room > 0 ? Math.max(5, room / MIN_PX_M) : SPOT_M;
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), big = Math.max(x1 - x0, y1 - y0) + 2;
    if (!xs.length || big > most) ctx.flySpot(F, at.x_m, at.y_m, most, pad);
    else ctx.flySpot(F, (x0 + x1) / 2, (y0 + y1) / 2, big, pad);
  }
  function goTo(id, fly = true){
    const s = sugOf(id);
    if (!s) return;
    cur = id; card = "item"; failing = null; moving = null; nearOpen = false; fade = GHOST; askDismiss = false; askUndo = false;
    const fid = itemFloorId(s), F = shownFloor();
    planPick.delete(String(fid));
    if (!F || !same(fid, F.fl.id)) { const G = floorUi(fid); if (G) { expectFloor = String(G.fl.id); ctx.setTopFloor(String(G.fl.id)); } }
    redraw();
    if (fly) flyToItem(s);
  }
  /** The floor changed by hand: this floor's first item, after a recap if verdicts wait for one. */
  function floorByHand(F){
    const order = orderNow(), mine = order.filter(s => F && same(itemFloorId(s), F.fl.id));
    const c = sugOf(cur);
    if (!c || !F || !same(itemFloorId(c), F.fl.id)) {
      const first = mine.find(s => isOpen(stateOf(s))) || mine[0] || null;
      cur = first ? first.id : cur;
      moving = null; failing = null;
      card = vSinceRecap ? "recap" : first ? "item" : "floor";
      if (card === "recap") { vSinceRecap = 0; lastRecapAt = vCount; }
      nextFloorItem = null;
      redraw();
      if (first) flyToItem(first);
      return;
    }
    redraw();
  }
  /** Where a verdict leads: a recap every 25, the floor's what's-missing pass when it is done, else the next item. */
  function advance(fromId){
    moving = null; failing = null; nearOpen = false;
    if (vCount - lastRecapAt >= RECAP_EVERY) { lastRecapAt = vCount; vSinceRecap = 0; card = "recap"; redraw(); return; }
    continueFrom(fromId);
  }
  function continueFrom(fromId){
    const order = orderNow(), from = sugOf(fromId), next = nextOpen(order, fromId, stateOf);
    if (from && (!next || !same(itemFloorId(next), itemFloorId(from)))) { card = "floor"; nextFloorItem = next ? next.id : null; lastRecapAt = vCount; vSinceRecap = 0; redraw(); return; }
    if (next) goTo(next.id); else { card = "floor"; nextFloorItem = null; redraw(); }
  }
  const counted = (id, how) => { vCount++; vSinceRecap++; acts.push({ id, how }); if (acts.length > 100) acts.shift(); };
  function step_(dir){
    const order = orderNow();
    if (!order.length) return;
    const at = order.findIndex(s => s.id === cur);
    const next = order[(Math.max(at, 0) + dir + order.length) % order.length];
    if (next) goTo(next.id);
  }

  // ── the verdicts on the map: the list's own, then on to the next ──────────
  async function vServer(s, v, why){
    if (!await verdict(s, v, why)) return;
    counted(s.id, v);
    advance(s.id);
  }
  function vNew(s){
    if (s.kind === "railing") { vRail(s); return; }
    const had = pendings().length;
    keepNew(s);
    if (pendings().length > had) { counted(s.id, "draft"); advance(s.id); }
  }
  function vTake(s, target = null){
    const had = pendings().length;
    takeAi(s, target);
    if (pendings().length > had) { counted(s.id, "draft"); advance(s.id); }
  }
  function vKind(s){
    const had = pendingOf(s.id);
    keepLight(s);
    if (!had && pendingOf(s.id)) { counted(s.id, "draft"); advance(s.id); }
  }
  function vRail(s){
    const pick = railPick.get(s.id) || {};
    if (!railHome(s)) { ctx.hint("Keep its stair first: there is nothing to put a rail on yet.", true); return; }
    if (!pick.side) { ctx.hint("Pick a side first: the AI can't tell it for sure.", true); return; }
    const had = pendings().length;
    keepRail(s);
    if (pendings().length > had) { counted(s.id, "draft"); advance(s.id); }
  }
  /** Move by hand: accept it, then it is yours to drag; Done goes on. */
  function vMove(s){
    const had = pendings().length, m = s.match || {};
    if (!pendingOf(s.id)) {
      if (m.relation === "correction") takeAi(s); else keepNew(s);
      if (pendings().length > had) counted(s.id, "draft");
    }
    const p = pendingOf(s.id);
    if (!p) return;
    moving = p.piece;
    ctx.hint("Drag the stair or its pin into place. Nothing is kept until Save.");
    redraw();
  }
  /** Move by hand lasts as long as its item is in the draft: Undo or Discard ends it, so no drag goes outside the item's note. */
  const pendingPiece = (id) => pendings().some(p => p.piece === id);
  function holdMove(){ if (moving && !pendingPiece(moving)) moving = null; return !!moving; }
  function moveDone(){
    if (!moving) return;
    const id = cur;
    moving = null;
    advance(id);
  }
  function vTakeBack(s){
    const p = pendingOf(s.id);
    if (p) takeBack(s); else verdict(s, "back");
    moving = null;
  }
  /** Z: the last verdict, as it was given: a draft step by Undo, one written at click by the server's take-back. */
  function undoLast(){
    const a = acts.pop();
    if (!a) { ctx.undo(); return; }
    const s = sugOf(a.id);
    if (a.how === "draft") ctx.undo();
    else if (s) verdict(s, "back");
    vCount = Math.max(0, vCount - 1); vSinceRecap = Math.max(0, vSinceRecap - 1);
    if (s) goTo(s.id, false);
  }
  /** The one bulk action: everything unvetted goes to Later, never to wrong. */
  async function dismissRest(){
    askDismiss = false;
    const rest = orderNow().filter(s => stateOf(s) === "queued");
    for (const s of rest) if (!await verdict(s, "later")) break;
    ctx.hint(`${rest.length} put off to Later. Nothing was marked wrong.`);
    redraw();
  }

  // ── a finger, a pen or the mouse on the view, while it shows ──────────────
  const rayer = THREE ? new THREE.Raycaster() : null, ndc = THREE ? new THREE.Vector2() : null, levelPl = THREE ? new THREE.Plane() : null;
  const hitV = THREE ? new THREE.Vector3() : null, UP = THREE ? new THREE.Vector3(0, 1, 0) : null;
  function onFloor(x, y, F){
    const r = ctx.rect(), cam = ctx.camera();
    if (!r || !r.width || !r.height || !cam || !F) return null;
    ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    cam.updateMatrixWorld();
    rayer.setFromCamera(ndc, cam);
    levelPl.set(UP, -F.fl.elev);
    return rayer.ray.intersectPlane(levelPl, hitV) ? [hitV.x, hitV.z] : null;
  }
  function dragFrom(e, pin){
    const dr = ctx.draft(), q = dr && moving ? dr.cur.pieces[moving] : null, F = q ? floorUi(q.floor_id) : null, at = F ? onFloor(e.clientX, e.clientY, F) : null;
    if (!q || !at) return null;
    return { id: moving, F, off: pin ? [0, 0] : [q.x_m - at[0], q.y_m - at[1]], x0: e.clientX, y0: e.clientY, moved: false, pin: !!pin, group: `plan-drag:${moving}:${Math.random()}` };
  }
  function down(e){
    const F = shownFloor();
    if (holdMove()) {
      const dr = ctx.draft(), q = dr ? dr.cur.pieces[moving] : null, at = F ? onFloor(e.clientX, e.clientY, F) : null;
      const corners = q && ctx.STOREY && ctx.STOREY.footprint ? ctx.STOREY.footprint(q) : null;
      if (at && corners && inPolygon(at[0], at[1], corners)) { gesture = dragFrom(e, false); if (gesture) return "drag"; }
    } else if (F) {
      const at = onFloor(e.clientX, e.clientY, F);
      const g = at ? [...ghosts.values()].find(G => G.corners && inPolygon(at[0], at[1], G.corners)) : null;
      if (g && g.id !== cur) { gesture = { tap: g.id, x0: e.clientX, y0: e.clientY }; return "swallow"; }
    }
    return e.pointerType === "touch" || e.pointerType === "pen" ? "swallow" : "pan";
  }
  function move(e){
    const g = gesture;
    if (!g || !g.id) return;
    if (!pendingPiece(g.id)) { gesture = null; return; }
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= 6) return;
    g.moved = true;
    const at = onFloor(e.clientX, e.clientY, g.F);
    if (!at) return;
    const x = Math.round((at[0] + g.off[0]) * 1000) / 1000, y = Math.round((at[1] + g.off[1]) * 1000) / 1000;
    ctx.change((c) => { const q = c.pieces[g.id]; if (q) { q.x_m = x; q.y_m = y; } }, g.group, { piece: g.id });
  }
  function up(e){
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.tap) { if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= 6) goTo(g.tap); return; }
    if (g.moved) { if (ctx.redrawHouse) ctx.redrawHouse(); redraw(); }
  }
  function hover(e){
    if (!holdMove()) return "";
    const F = shownFloor(), dr = ctx.draft(), q = dr ? dr.cur.pieces[moving] : null, at = F ? onFloor(e.clientX, e.clientY, F) : null;
    const corners = q && ctx.STOREY && ctx.STOREY.footprint ? ctx.STOREY.footprint(q) : null;
    return at && corners && inPolygon(at[0], at[1], corners) ? "grab" : "";
  }
  /** While the map shows and focus is in no field: N, C, F, L, Enter, Backspace, Z, P. True: it was ours.
   *  N, C, F and L are always ours here, doing something or not, held or not, so none reaches Home Assistant's
   *  own one-letter shortcuts ("c" is its command palette); E, D, M and A go on to it. The map off the page
   *  (another view, another Home Assistant page: the slot isn't told): no key is ours.
   *  (Inside the panel's shadow root a window listener sees its host as the target: composedPath has the real one.) */
  function key(e){
    if (!mapAwake || !ctx.root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
    if (t && (/^(input|textarea|select)$/i.test(String(t.tagName || t.localName || "")) || t.isContentEditable)) return false;
    const mine = /^[ncfl]$/i.test(String(e.key));
    if (e.repeat || (ctx.saving && ctx.saving()) || ctx.root.querySelector(".la3d-ask.on")) return mine;
    // Enter on a button in the card is that button (Keep mine, where it starts); on a pin, the next item.
    const k = e.key, onBtn = !!(t && String(t.tagName).toUpperCase() === "BUTTON" && !(t.classList && t.classList.contains("pl-pin")));
    if (k === "Escape") {
      if (moving) { moveDone(); return true; }
      if (failing) { failing = null; redraw(); return true; }
      return false;
    }
    if (k === "p" || k === "P") { planOn = !planOn; if (planMesh) planMesh.visible = planOn; redraw(); if (ctx.render) ctx.render(); return true; }
    if (k === "z" || k === "Z") { undoLast(); return true; }
    if (card !== "item") {
      if (k === "Enter" && !onBtn) { onward(); return true; }
      return mine;
    }
    if (k === "Enter") { if (onBtn) return false; if (moving) moveDone(); else step_(1); return true; }
    if (k === "Backspace") { step_(-1); return true; }
    const s = sugOf(cur);
    if (!s || busy) return mine;
    const low = k.length === 1 ? k.toLowerCase() : "";
    const st = stateOf(s), open = st === "queued" || st === "stale" || st === "later" || st === "right", m = s.match || {};
    if (low === "n" && open && !movedPlan(s.map_id) && s.kind !== "light" && !(s.kind === "railing" && m.relation === "correction")) { vNew(s); return true; }
    if (low === "c" && open && st !== "stale") {
      if (s.kind === "light") { if (m.relation === "correction" && !movedPlan(s.map_id)) vKind(s); }
      else if (m.relation === "correction" && s.kind === "stairs") vTake(s);
      else if (m.relation === "correction") vRail(s);
      else if (m.relation === "new" && !m.held && (m.near || []).length) { nearOpen = true; redraw(); }
      return true;
    }
    if (low === "f" && open) { if (failing === s.id) vServer(s, "failure", "nothing_there"); else { failing = s.id; redraw(); } return true; }
    if (low === "l" && open && st !== "stale") { vServer(s, "later"); return true; }
    return mine;
  }
  /** On from a recap, or from the floor's what's-missing pass. */
  function onward(){
    const c = cur, wasFloor = card === "floor", go = nextFloorItem;
    card = "item";
    if (wasFloor) {
      nextFloorItem = null;
      if (go && sugOf(go)) goTo(go); else redraw();
      return;
    }
    continueFrom(c);
  }

  // ── the card ──────────────────────────────────────────────────────────────
  function vbtn(text, title, act, cls, keyHint, off){
    const b = btn("", title, act, cls);
    b.textContent = text;
    if (keyHint) { const kb = d("kbd", null, keyHint); b.appendChild(kb); }
    b.disabled = !!off || busy;
    return b;
  }
  /** The plan: on or off, how strong, which of two. */
  function paintPlanRow(F){
    const list = planChoices(F), ctl = d("div", "pl-ctl pl-sep");
    if (!list.length && !planNow) {
      const c = sugOf(cur);
      ctl.appendChild(d("span", null, c && movedPlan(c.map_id) ? "The plan moved: read it again." : "No plan to show on this floor."));
      sheet.appendChild(ctl);
      return;
    }
    const tog = d("button", "pl-mini", "Plan");
    tog.type = "button"; tog.title = "The plan under the house, on or off (P)";
    tog.setAttribute("aria-pressed", String(planOn));
    tog.addEventListener("click", guard(() => { planOn = !planOn; if (planMesh) planMesh.visible = planOn; redraw(); if (ctx.render) ctx.render(); }));
    ctl.appendChild(tog);
    const r = d("input");
    r.type = "range"; r.min = "0.15"; r.max = "1"; r.step = "0.05"; r.value = String(opacity);
    r.setAttribute("aria-label", "How strongly the plan shows");
    r.title = "How strongly the plan shows";
    r.addEventListener("input", guard(() => { opacity = Number(r.value); if (planMesh) planMesh.material.opacity = opacity; if (ctx.render) ctx.render(); }));
    r.addEventListener("change", () => { r.blur(); });
    ctl.appendChild(r);
    sheet.appendChild(ctl);
    const names = new Map(list.map(p => [p.map_id, p]));
    if (planNow) names.set(planNow.map_id, planNow);
    if (names.size > 1) {
      const row = d("div", "pl-plans");
      for (const p of names.values()) {
        const b = d("button", "pl-mini", p.name || "a plan");
        b.type = "button"; b.title = `Show ${p.name || "this plan"} under the house`;
        b.setAttribute("aria-pressed", String(!!planNow && planNow.map_id === p.map_id));
        b.addEventListener("click", guard(() => { planPick.set(String(F.fl.id), p.map_id); redraw(); }));
        row.appendChild(b);
      }
      sheet.appendChild(row);
    }
    if (planGone) sheet.appendChild(d("div", "pl-sub2", "The plan's picture wouldn't open here."));
  }
  function paintFoot(){
    const pend = pendings();
    if (pend.length) {
      const n = pend.filter(p => p.v === "new" && p.made).length, c = pend.filter(p => p.v === "correction").length, l = pend.filter(p => p.rail).length;
      const words = [n ? `${n} new` : "", c ? `${c} correction${c === 1 ? "" : "s"}` : "", l ? `${l} railing${l === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
      const keep = btn(`Keep ${words} (one undo for the whole session)`, "Save: into your 3D house, with a safety backup and one undo", () => ctx.save(), "pl-keep");
      keep.disabled = busy || !!(ctx.saving && ctx.saving());
      sheet.appendChild(keep);
    }
    const row = d("div", "pl-more");
    const tog = d("button", "pl-mini", more ? "Less" : "More");
    tog.type = "button"; tog.setAttribute("aria-expanded", String(more));
    tog.addEventListener("click", guard(() => { more = !more; askDismiss = false; redraw(); }));
    row.appendChild(tog);
    const mini = (text, title, act) => { const b = d("button", "pl-mini", text); b.type = "button"; b.title = title; b.disabled = busy; b.addEventListener("click", guard((e) => { e.stopPropagation(); act(); })); row.appendChild(b); return b; };
    if (more) {
      const rest = orderNow().filter(s => stateOf(s) === "queued").length;
      if (rest) mini("Dismiss the rest", "Puts everything you haven't looked at off to Later. It never marks anything wrong.", () => { askDismiss = true; redraw(); });
      mini("What's missing?", "What the AI didn't find on this floor", () => { card = "floor"; nextFloorItem = null; redraw(); });
      mini("As a list", "The same items, one row each", () => { listAsked = true; redraw(); });
      mini("Manage ignored", "The finds you marked wrong, remembered per plan", () => openIgnored());
      mini("Read again", "Back to the plans and the button", () => readAgain());
      if (undoInfo) mini(undoInfo.puts_back ? `Put back ${undoInfo.items}` : `Undo this session (${undoInfo.items})`, "Takes back what this session kept; anything changed since is left", () => { askUndo = true; redraw(); });
    }
    sheet.appendChild(row);
    if (askDismiss) {
      const rest = orderNow().filter(s => stateOf(s) === "queued").length;
      sheet.appendChild(d("div", "pl-say", `${rest} item${rest === 1 ? "" : "s"} you haven't looked at go to Later. None is marked wrong or kept.`));
      const a = d("div", "pl-more");
      const go = d("button", "pl-mini", "Dismiss them"); go.type = "button"; go.addEventListener("click", guard(() => dismissRest()));
      const no = d("button", "pl-mini", "Cancel"); no.type = "button"; no.addEventListener("click", guard(() => { askDismiss = false; redraw(); }));
      a.append(go, no);
      sheet.appendChild(a);
    }
    if (askUndo && undoInfo) {
      sheet.appendChild(d("div", "pl-say", undoInfo.puts_back ? "Put those items back in your 3D house?" : "Take what this session kept out of your 3D house? Anything you changed since is left as it is."));
      const a = d("div", "pl-more");
      const go = d("button", "pl-mini", undoInfo.puts_back ? "Put back" : "Undo"); go.type = "button"; go.addEventListener("click", guard(() => undoSession()));
      const no = d("button", "pl-mini", "Cancel"); no.type = "button"; no.addEventListener("click", guard(() => { askUndo = false; redraw(); }));
      a.append(go, no);
      sheet.appendChild(a);
    }
  }
  function tallyWords(states){
    const t = tally(states), bits = [];
    if (t.new) bits.push(`${t.new} new`);
    if (t.correction) bits.push(`${t.correction} correction${t.correction === 1 ? "" : "s"}`);
    if (t.right) bits.push(`${t.right} looked right`);
    if (t.failure) bits.push(`${t.failure} marked wrong`);
    if (t.later) bits.push(`${t.later} later`);
    if (t.open) bits.push(`${t.open} still to check`);
    return bits.join(", ") || "nothing yet";
  }
  /** Every 25 verdicts, and at a floor change: where this stands, in a person's own numbers. */
  function paintRecap(){
    const order = orderNow();
    sheet.appendChild(d("div", "pl-title", "So far"));
    sheet.appendChild(d("div", "pl-say", `${tallyWords(order.map(stateOf))}.`));
    sheet.appendChild(d("div", "pl-cue", "Look at the plan again: the AI misses things too, and the queue can't show what it missed."));
    const recs = recordLines();
    for (const line of recs) sheet.appendChild(d("div", "pl-rec", line));
    const a = d("div", "pl-v");
    const go = vbtn("Carry on", "On to the next item (Enter)", () => onward(), "new wide", "Enter");
    a.appendChild(go);
    sheet.appendChild(a);
    if (!focusBtn) focusBtn = go;
  }
  /** One floor's what's-missing pass: what the queue can't show. */
  function paintFloorDone(F){
    const fid = F ? F.fl.id : null, name = F ? F.fl.name || String(fid) : "This floor";
    const order = orderNow(), mine = order.filter(s => F && same(itemFloorId(s), fid));
    sheet.appendChild(d("div", "pl-title", `${name}: what's missing?`));
    sheet.appendChild(d("div", "pl-say", `On this floor: ${tallyWords(mine.map(stateOf))}.`));
    const dr = ctx.draft && ctx.draft();
    const stairs = dr && ctx.STOREY && fid !== null ? Object.values(dr.cur.pieces || {}).filter(p => ctx.STOREY.isStairs(p) && same(p.floor_id, fid) && !(p[NOTE()] && Object.values(p[NOTE()].sugs || {}).some(e => e.made)))
      .map(p => ({ id: p.id, label: p.label, x: p.x_m, y: p.y_m, room: roomOf({ floor_id: fid, id: "", geom: {} }, { x_m: p.x_m, y_m: p.y_m }) })) : [];
    const lines = fid === null ? [] : missingLines(fid, sugs(), (sess.plans || []).map(p => ({ ...p, floor_id: p.floor_id ?? ((info && info.plans) || []).find(q => q.map_id === p.map_id)?.floor_id })), stairs, same);
    const ul = d("ul", "pl-miss");
    if (!lines.length) ul.appendChild(d("li", null, "Nothing else to say on this floor."));
    for (const line of lines) ul.appendChild(d("li", null, line));
    sheet.appendChild(ul);
    const a = d("div", "pl-v");
    const go = nextFloorItem && sugOf(nextFloorItem);
    const on = vbtn(go ? `On to ${floorName(itemFloorId(sugOf(nextFloorItem)))}` : "Done", go ? "The next floor's items (Enter)" : "Back to the map (Enter)", () => onward(), "new");
    if (!go) on.style.gridColumn = "span 2";
    a.appendChild(on);
    if (go) a.appendChild(vbtn("Stay here", "Back to this floor's items", () => { nextFloorItem = null; card = "item"; redraw(); }));
    if (ctx.addByHand) a.appendChild(vbtn("Add by hand", "Opens Build ▾ so you can place what the AI missed", () => {
      const h = ctx.host(), kind = "stairs";
      if (h && typeof h.telemetry === "function") { try { h.telemetry(`plan_ai_missing_added:${kind}`); } catch (_) { /* a count, never in the way */ } }
      ctx.addByHand();
    }));
    sheet.appendChild(a);
    if (!focusBtn) focusBtn = on;
  }
  function recordLines(only = null){
    const out = [];
    for (const [kind, r] of Object.entries(record || {})) {
      if ((only && kind !== only) || !r || !(r.of >= 5)) continue;
      out.push(`${kind === "railing" ? "Railings" : kind === "light" ? "Lights" : "Stairs"}: ${r.right} of ${r.of} right in this house so far.`);
    }
    return out;
  }
  function paintItem(s, F){
    const order = orderNow(), at = order.findIndex(q => q.id === s.id), st = stateOf(s), m = s.match || {}, g = s.geom || {};
    const q = d("div", "pl-q"), room = roomOf(s, posOf(s));
    const prev = btn("‹", "The one before (Backspace)", () => step_(-1)), next = btn("›", "The next one (Enter)", () => step_(1));
    q.append(d("div", "pl-title", [(KIND_OF[s.kind] || KIND_OF.stairs).word, floorName(itemFloorId(s)), room].filter(Boolean).join(" · ")), d("span", "pl-of", `${at + 1} of ${order.length}`), prev, next);
    sheet.appendChild(q);
    const seen = Array.isArray(s.seen_on) && s.seen_on.length > 1 ? `seen on ${s.seen_on.length} plans` : planName(s.map_id);
    const size = s.kind === "stairs" ? `${m1(g.width_m)} × ${m1(g.depth_m)} m` : "";
    sheet.appendChild(d("div", "pl-sub2", [seen, size].filter(Boolean).join(" · ")));
    const decided = !(st === "queued" || st === "stale" || st === "later" || st === "right");
    if (!decided && CUE[s.kind]) sheet.appendChild(d("div", "pl-cue", CUE[s.kind]));
    // What it is, in words at the point of deciding.
    const label = m.target_snap && m.target_snap.label ? m.target_snap.label : "this stair";
    const t = s.kind === "stairs" ? targetOf(s) : null, mv = t && num(g.x_m) !== null ? moveWords(g.x_m - t.x_m, g.y_m - t.y_m, ctx.compass ? ctx.compass() : null) : `${m1(m.distance_m)} m`;
    const say = (text) => sheet.appendChild(d("div", "pl-say", text));
    if (st === "stale") say(movedPlan(s.map_id) ? "The plan moved: read it again." : "Changed since you looked.");
    if (st === "queued" || st === "later" || st === "right") {
      if (s.kind === "stairs" && m.relation === "correction") {
        say(m.hand === true ? `You placed this one. The AI puts it ${mv}. Keep yours unless the plan says otherwise.` : `The AI placed this one too. This read puts it ${mv}.`);
        if (t && g.shape && ((t.recipe && t.recipe.params && t.recipe.params.shape) || "straight") !== g.shape) say(`The AI read it as ${g.shape === "u" ? "a U" : g.shape === "l" ? "an L" : `a ${g.shape} flight`}: only where it stands can change here.`);
      } else if (s.kind === "stairs" && m.relation === "stacked") say("A second staircase here, stacked? Say which floor it climbs from.");
      else if (s.kind === "stairs" && (m.near_names || []).length) say(`Near ${m.near_names.join(" and ")}.`);
      if (s.kind === "railing" && m.relation === "correction") say(`A rail on another side of ${label}.`);
      if (s.kind === "railing" && g.side) say(`The AI says ${g.side}.`);
    }
    if (s.kind === "light") for (const line of lightLines(s, st === "queued" || st === "later" || st === "right")) say(line);
    for (const tw of twins(s)) say(`${planName(s.map_id)} puts it here, ${planName(tw.map_id)} there, ${m1(tw.distance_m)} m apart. Nothing wins by itself.`);
    if (m.held === "frame") say("Position may be coarse: this AI's picture size isn't known.");
    else if (m.held === "eye") say(s.kind === "light" ? "The plan was placed by eye, so this may be another light." : "The plan was placed by eye, so the offset may be the plan's.");
    const pend = pendingOf(s.id);
    if (moving) {
      const pc = ctx.draft().cur.pieces[moving], dist = pc && num(g.x_m) !== null ? Math.hypot(pc.x_m - g.x_m, pc.y_m - g.y_m) : 0;
      say(dist >= 0.05 ? `Drag it into place: ${moveWords(pc.x_m - g.x_m, pc.y_m - g.y_m, ctx.compass ? ctx.compass() : null)} from where the AI put it.` : "Drag the stair or its pin into place.");
      const a = d("div", "pl-v");
      const done = vbtn("Done", "That's where it goes (Enter)", () => moveDone(), "new", "Enter");
      a.append(done, vbtn("Take that back", "Out of your draft: nothing was kept", () => { vTakeBack(s); redraw(); }));
      a.children[1].style.gridColumn = "span 2";
      sheet.appendChild(a);
      if (!focusBtn) focusBtn = done;
    } else if (pend) {
      say(s.kind === "light" ? `Drawn as ${kindWord(m.want_kind)} in your draft: nothing is kept until Save.` : pend.v === "correction" ? `A correction in your draft: nothing is kept until Save.` : "New, in your draft: nothing is kept until Save.");
      const a = d("div", "pl-v");
      const back = vbtn("Take that back", "Out of your draft: nothing was kept", () => { vTakeBack(s); redraw(); });
      back.style.gridColumn = "span 2";
      a.appendChild(back);
      if (s.kind === "stairs") a.appendChild(vbtn("Move by hand", "Drag it into place", () => vMove(s)));
      sheet.appendChild(a);
    } else if (st === "unmatched") {
      if (canOpenAtlas()) {
        const a = d("div", "pl-v");
        a.appendChild(vbtn("Open Mapping → Atlas", "Place a light there yourself: the plans never place one", () => openAtlas(s), "wide"));
        sheet.appendChild(a);
      } else say("Place one in Mapping → Atlas.");
    } else if (st === "kept_new" || st === "kept_correction") {
      say(st === "kept_new" ? "Kept as new. Undo this session is under More." : "Kept as a correction. Undo this session is under More.");
    } else if (st === "failure") {
      const why = s.verdict && s.verdict.why;
      say(`Marked wrong: ${WHY_WORD[why] || why || "no reason given"}.`);
      const a = d("div", "pl-v");
      a.appendChild(vbtn("Take that back", "Back to the queue", () => verdict(s, "back"), "wide"));
      sheet.appendChild(a);
    } else if (failing === s.id) {
      say("What's wrong with it?");
      const a = d("div", "pl-v");
      for (const [k, word] of WHY) {
        const b = vbtn(word, `Mark it wrong: ${word.toLowerCase()} (noted at once)`, () => vServer(s, "failure", k), "bad");
        if (k === "nothing_there" && !focusBtn) focusBtn = b;
        a.appendChild(b);
      }
      a.appendChild(vbtn("Never mind", "Keep it in the queue (Esc)", () => { failing = null; redraw(); }));
      sheet.appendChild(a);
    } else paintVerdicts(s, st);
    const rec = recordLines(s.kind);
    for (const line of rec) sheet.appendChild(d("div", "pl-rec", line));
    if (s.kind === "stairs" && m.relation === "correction" && ghostWanted(s) && !pend) {
      const ctl = d("label", "pl-ctl");
      ctl.appendChild(d("span", null, "Fade"));
      const r = d("input");
      r.type = "range"; r.min = "0"; r.max = "1"; r.step = "0.05"; r.value = String(fade);
      r.setAttribute("aria-label", "Fade between your stair and the AI's ghost");
      r.title = "Your stair is solid; the AI's ghost is dashed. Fade it in and out.";
      r.addEventListener("input", guard(() => { fade = Number(r.value); const G = ghosts.get(s.id); if (G) { for (const mat of G.mats) mat.opacity = fade; } if (ctx.render) ctx.render(); }));
      r.addEventListener("change", () => { r.blur(); });
      ctl.appendChild(r);
      sheet.appendChild(ctl);
    }
  }
  /** A light's verdicts: its kind or not. No New, no Move by hand: a light's place is never touched from here. */
  function paintLightVerdicts(s, st){
    const m = s.match || {}, moved = movedPlan(s.map_id), stale = st === "stale", a = d("div", "pl-v"), b2 = d("div", "pl-v");
    if (m.relation === "correction" && !stale) {
      const take = vbtn("Take the kind", `Draw it as ${kindWord(m.want_kind)}, in your draft`, () => vKind(s), "cor", "C", moved);
      a.append(take, vbtn("Keep mine", "It stays as it is (noted at once)", () => vServer(s, "failure", "already_here")));
      a.children[1].style.gridColumn = "span 2";
      if (!focusBtn && !moved) focusBtn = take;
    }
    b2.appendChild(vbtn("Failure", "Mark it wrong, with a reason (noted at once)", () => { failing = s.id; redraw(); }, "bad", "F"));
    b2.appendChild(vbtn("Looks right", "The AI got this one right (noted at once; nothing is written to your house)", () => vServer(s, "right"), null, null, stale || st === "right"));
    b2.appendChild(vbtn("Later", "Come back to it (noted at once)", () => vServer(s, "later"), null, "L", stale || st === "later"));
    if (a.children.length) sheet.appendChild(a);
    sheet.appendChild(b2);
    if (st === "right" || st === "later") { const c = d("div", "pl-v"); c.appendChild(vbtn("Take that back", "Back to the queue", () => verdict(s, "back"), "wide")); sheet.appendChild(c); }
  }
  function paintVerdicts(s, st){
    if (s.kind === "light") { paintLightVerdicts(s, st); return; }
    const m = s.match || {}, moved = movedPlan(s.map_id), stale = st === "stale", rail = s.kind === "railing";
    if (rail && !stale) {
      const box = d("div");
      railActs(s, box);
      for (const kid of [...box.children]) if (kid.tagName === "BUTTON") kid.remove();   // its Keep this rail is the verdict row's New or Correction here
      sheet.appendChild(box);
    }
    if (s.kind === "stairs" && m.relation === "stacked" && !moved && !stale) sheet.appendChild(floorChoice(s));
    const a = d("div", "pl-v"), b2 = d("div", "pl-v four");
    const noRail = rail ? !railHome(s) || !(railPick.get(s.id) || {}).side : moved;
    const fixing = s.kind === "stairs" && m.relation === "correction" && !stale, rest = fixing ? b2 : a;
    if (fixing) {
      // Keep mine is where a hand-placed stair starts; the AI's position only where the AI placed it too.
      const mine = vbtn("Keep mine", "Yours stays where it is (noted at once)", () => vServer(s, "failure", "already_here"), m.hand === true ? "new" : null);
      const take = vbtn("Take the AI's position", "A correction: move it there in your draft", () => vTake(s), "cor", "C", moved);
      const hand = vbtn("Move by hand", "A correction: accept it, then drag it into place", () => vMove(s), null, null, moved);
      if (m.hand === true) { a.append(mine, take, hand); if (!focusBtn) focusBtn = mine; } else { a.append(take, mine, hand); if (!focusBtn) focusBtn = take; }
      b2.appendChild(vbtn("New", "A staircase of its own, beside the one you have", () => vNew(s), null, "N", moved));
    } else {
      const canCorrect = !stale && !moved && (rail ? m.relation === "correction" : m.relation === "new" && !m.held && (m.near || []).length > 0);
      a.appendChild(vbtn("New", rail ? "This rail, on its stair, in your draft" : "Add it to your draft: nothing is kept until Save", () => vNew(s), "new", "N", rail ? noRail || m.relation === "correction" : moved));
      a.appendChild(vbtn("Correction", canCorrect ? (rail ? "This side instead, in your draft" : "It is one of the stairs near it") : "Nothing near it to correct", () => { if (rail) vRail(s); else { nearOpen = !nearOpen; redraw(); } }, "cor", "C", !canCorrect || (rail && noRail)));
    }
    rest.appendChild(vbtn("Failure", "Mark it wrong, with a reason (noted at once)", () => { failing = s.id; redraw(); }, "bad", "F"));
    rest.appendChild(vbtn("Looks right", "The AI got this one right (noted at once; nothing is written to your house)", () => vServer(s, "right"), null, null, stale || st === "right"));
    rest.appendChild(vbtn("Later", "Come back to it (noted at once)", () => vServer(s, "later"), null, "L", stale || st === "later"));
    if (s.kind === "stairs" && m.relation !== "correction") rest.appendChild(vbtn("Move by hand", "Accept it, then drag it into place", () => vMove(s), null, null, moved));
    sheet.appendChild(a);
    if (fixing) sheet.appendChild(b2);
    if (st === "right" || st === "later") { const c = d("div", "pl-v"); c.appendChild(vbtn("Take that back", "Back to the queue", () => verdict(s, "back"), "wide")); sheet.appendChild(c); }
    if (nearOpen && !rail) {
      const c = d("div", "pl-v");
      for (const [i, id] of (m.near || []).entries()) if (m.near_snaps && m.near_snaps[id]) c.appendChild(vbtn(`A correction of ${(m.near_names || [])[i] || "that stair"}`, "Move that stair here in your draft", () => vTake(s, id), "cor wide"));
      sheet.appendChild(c);
    }
  }
  function paintMap(){
    const h = d("h4");
    h.appendChild(d("span", null, "Add data via plans"));
    h.appendChild(d("span", "pl-chip", "EXPERIMENTAL"));
    sheet.appendChild(h);
    const strip = d("div", "pl-strip", STRIP.stairs);
    sheet.appendChild(strip);
    errLine();
    const order = orderNow();
    if (!sugOf(cur) || stateOf(sugOf(cur)) === null) {
      // Start where the person is, when they picked a floor with items left; else at the first. Always one floor, never All.
      const F = ctx.currentFloor ? ctx.currentFloor() : null, picked = ctx.picked ? ctx.picked() : null;
      const first = (picked ? order.find(s => F && same(itemFloorId(s), F.fl.id) && isOpen(stateOf(s))) : null) || order.find(s => isOpen(stateOf(s))) || order[0];
      cur = first ? first.id : null;
      if (first) { const G = floorUi(itemFloorId(first)); if (G && (!picked || !F || G !== F)) { if (G !== F) expectFloor = String(G.fl.id); ctx.setTopFloor(String(G.fl.id)); } flyDue = true; }
    }
    const s = sugOf(cur), F = shownFloor();
    strip.textContent = STRIP[(s && s.kind) || "stairs"] || STRIP.stairs;
    syncPlan(F);                                         // so the plan row below says the plan that shows
    if (card === "recap") paintRecap();
    else if (card === "floor") paintFloorDone(F);
    else if (s) paintItem(s, F);
    paintPlanRow(F);
    paintFoot();
    if (flyDue && s) { flyDue = false; requestAnimationFrame(guard(() => { if (mapAwake) flyToItem(s); })); }
  }
  function syncMap(){
    if (!mapCan()) return;
    const sc = ctx.scene();
    if (!sc) return;
    if (!group) { group = new THREE.Group(); group.name = "plan-ai"; }
    if (group.parent !== sc) sc.add(group);
    if (!mapAwake) {
      mapAwake = true;
      keysTo(true);
      if (ctx.quiet) ctx.quiet(true);
      // A phone: the map and the card fill the screen, whatever the page had above them.
      if (touchy() && ctx.root.scrollIntoView) { try { ctx.root.scrollIntoView({ block: "start" }); } catch (_) { /* it stays where it is */ } } const F0 = ctx.currentFloor ? ctx.currentFloor() : null; floorSeen = F0 ? String(F0.fl.id) : null; shell = ctx.shellGen ? ctx.shellGen() : 0;
    }
    pinsEl.style.display = "";
    const F = shownFloor(), order = orderNow();
    syncPlan(F);
    syncGhosts(F);
    syncOnion(F);
    syncPins(F, order);
    if (ctx.render) ctx.render();
  }
  /** Heard first, on the window, only while the map shows: Home Assistant's own one-letter shortcuts ("c" is its
   *  command palette) listen further along, and a key that is ours goes no further. */
  const keyFirst = guard((e) => { if (key(e)) { e.preventDefault(); e.stopPropagation(); } });
  let keysOn = false;
  const keysTo = (on) => { if (on === keysOn) return; keysOn = on; window[on ? "addEventListener" : "removeEventListener"]("keydown", keyFirst, true); };
  function mapSleep(){
    if (!mapAwake) return;
    keysTo(false);
    mapAwake = false; expectFloor = null; gesture = null; moving = null;
    releasePlan();
    for (const id of [...ghosts.keys()]) dropGhost(id);
    stairGhosts.clear();
    if (onion) { dropMesh(onion); onion = null; onionKey = ""; }
    for (const P of pins.values()) P.el.remove();
    pins.clear();
    for (const t of tags.values()) t.remove();
    tags.clear();
    pinsEl.style.display = "none";
    if (ctx.quiet) ctx.quiet(false);
    if (group && group.parent) group.parent.remove(group);
    if (ctx.render) ctx.render();
  }

  /** Keep mine, or the AI's position where the AI placed it too: where the keyboard starts on the first correction. */
  function paintFocus(){
    if (focusBtn && !focusBtn.disabled) { try { focusBtn.focus({ preventScroll: true }); } catch (_) { /* no matter */ } }
  }
  function paint(){
    if (urls) loadUrls();                                // a tool left open overnight: fresh links before the old ones run out
    holdMove();
    sheet.classList.add("plans");
    const onMap = mapWanted();
    sheet.classList.toggle("map", onMap);
    focusBtn = null;
    if (view === "ignored") { mapSleep(); paintIgnored(); return true; }
    if (step === "loading") { mapSleep(); head("Add data via plans"); sheet.appendChild(d("div", "pl-note", "Looking for your plans…")); return true; }
    if (step === "sample") { mapSleep(); head("Add data via plans"); sheet.appendChild(d("div", "pl-note", "Sample mode shows a sample house: switch to Live mode to read your own plans.")); return true; }
    if (step === "progress") { mapSleep(); paintProgress(); return true; }
    if (onMap) { paintMap(); paintFocus(); syncMap(); return true; }
    mapSleep();
    if (step === "list" && sess) { paintList(); paintFocus(); return true; }
    paintConsent();
    return true;
  }

  return {
    /** The Plans tool on (the editor's tool) or off. */
    show(on){
      on = !!on;
      if (on === shownNow) return;
      shownNow = on;
      if (on) { view = "list"; failing = null; listAsked = false; cur = null; card = "item"; urls = null; open(); }
      else { stopPoll(); sheet.classList.remove("plans"); sheet.classList.remove("map"); mapSleep(); pics.clear(); }
    },
    /** The sheet's content for the step we are at; true: there is one. */
    sheet: () => paint(),
    commit, refused,
    /** A Save went in: each correction's target and each plan checked again. */
    afterSave(){ if (sess && shownNow) reload().then(() => { settle(); redraw(); }); },
    mapShown: () => mapAwake,
    down, move, up, cancel: () => { gesture = null; }, hover, layout, key,
    /** What the harness and the tests read. */
    state(){
      return { cur, card, moving, onMap: mapAwake, floor: floorSeen, pins: [...pins.values()].map(p => ({ id: p.id, n: Number(p.el.dataset.n), state: p.el.dataset.state })),
               ghosts: [...ghosts.keys()], plan: planNow ? planNow.map_id : null, planShown: !!(planMesh && planMesh.visible), opacity, textures: texLive, verdicts: vCount, fade };
    },
    dispose(){ stopPoll(); shownNow = false; mapSleep(); keysTo(false); try { style.remove(); pinsEl.remove(); } catch (_) { /* gone with its root */ } },
  };
}

/**
 * The list, with no 3D view behind it (no WebGL: Mapping → Furnish offers it).
 * Mounts in `box`; host = {callWS, floors: [{id, name, level, outdoor}], toast, and the view's rules: DRAFT, PIECES, FURN}.
 * The same draft rules and the same one writer as in Edit; a new stair stands as
 * the AI read it (nothing here knows the rooms' walls to square it to).
 */
export async function openPlansList(box, host){
  const { DRAFT, PIECES, FURN } = host;
  const r = await host.callWS({ type: "padspan_ha/house3d_get" });
  const file = DRAFT.ownedOf((r && r.data) || r || {});
  const draft = DRAFT.createDraft(file);
  const sheet = document.createElement("div");
  sheet.className = "la3d-sheet plans pl-flat on";
  box.appendChild(sheet);
  const floors = (host.floors || []).map(f => ({ fl: { id: f.id, name: f.name, outdoor: !!f.outdoor, elev: num(f.level) ?? 0 }, rooms: [] }));
  let saving = false, tool = null;
  const redraw = () => { const y = sheet.scrollTop; sheet.replaceChildren(); tool.sheet(); sheet.scrollTop = y; };
  const toast = (t, bad) => { if (typeof host.toast === "function") host.toast(t, bad); };
  tool = createPlans({ root: box, sheet, guard: (f) => f, host: () => host, floors: () => floors, hint: toast, redraw, DRAFT, draft: () => draft,
    change: (fn) => { const ok = draft.change(fn); if (ok) redraw(); return ok; }, saving: () => saving,
    stairPiece: (g, fid, label) => {
      const base = FURN ? FURN.defaultRecipe("stairs") : null;
      if (!base || base.kind !== "stairs") return null;
      const p = PIECES.makePiece({ ...base, params: { ...(base.params || {}), shape: g.shape || "straight", style: "closed", rail: "none" }, width_m: g.width_m, depth_m: g.depth_m }, fid, { x: g.x_m, y: g.y_m, rotation: g.rotation }, "build");
      p.label = label;
      return p;
    },
    fileWritten: (data) => { draft.rebase(DRAFT.ownedOf(data)); },
    save: async () => {
      if (saving) return;
      saving = true; redraw();
      try {
        const kept = await tool.commit();
        if (kept) { draft.adopt("pieces", kept.pieces, kept.renamed); if (kept.lights) draft.adopt("lights", kept.lights); draft.rebase(DRAFT.ownedOf(kept.data)); toast(kept.said); }
      } catch (e) {
        if (e && e.planRefusal) await tool.refused(e);
        toast(String((e && (e.message || e.code)) || e), true);
      }
      saving = false; redraw();
    } });
  tool.show(true);
  return { tool, dispose(){ tool.dispose(); sheet.remove(); } };
}
