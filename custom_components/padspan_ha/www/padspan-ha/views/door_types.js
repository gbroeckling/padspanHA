// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Doors, as plain numbers, for both views of the house: the flat Atlas
// (iso_lights.js draws an open door's leaf swung open, Sims style) and Live
// Aboard (live_aboard_storey.js re-exports these; the view draws each panel).
// One rule each, shared, never copied:
//
//   doorSwing      which end hinges and which way a door swings (the indoor
//                  side, "left" as you stand outside facing in), unless the
//                  3D file says otherwise
//   doorShown      how a door with no sensor stands: as stored, or ajar
//                  inside, shut on an outside wall or as a garage door
//   guessDoorType  what a door is when nothing says: an overhead garage
//                  door, a sliding glass door, a closet's bifold, a double
//                  door or a hinged one; doorTypeOf adds the stored type and
//                  its options
//   doorPanels     where each panel of a door of any type is, at any point
//                  of opening, in the door's own frame
//   coverAt        a cover's position as how open a door is
//
// Imports nothing and draws nothing; node runs it as it is. Nothing here
// writes anything.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// A room outdoors: as its floor says (outdoor), else by its name (a deck, a patio...).
const OUTDOOR_NAME = /\b(deck|patio|porch|balcony|terrace|veranda|yard|garden|lawn|driveway|outside|outdoor)\b/i;
const outdoorRoom = (r) => (typeof r.outdoor === "boolean" ? r.outdoor : OUTDOOR_NAME.test(String(r.name || "")));
function inside(x, y, P){
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// ── which way it opens ───────────────────────────────────────────────────────
/** Which end of an opening hinges and which way it swings. Hinged on the
 *  left and swinging in, until the 3D file says otherwise (stored: its
 *  openings[...] entry — {hinge: "left" | "right", swing: "in" | "out"}).
 *  "In" is the indoor side: the side an indoor room is on, and for a wall
 *  between two rooms (or a barrier standing on its own) the side its wall's
 *  normal points away from. "Left" is as you stand outside, facing in.
 *  pc: {x0, y0, x1, y1, nx, ny}; rooms: [{outdoor, pts}]. {hinge: "a" |
 *  "b", side: +1 / -1}: the leaf opens toward (nx, ny) × side. */
export function doorSwing(pc, rooms, stored){
  const dx = pc.x1 - pc.x0, dy = pc.y1 - pc.y0;
  const mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2;
  const indoor = (s) => (rooms || []).some(r => !outdoorRoom(r) && inside(mx + pc.nx * s * 0.45, my + pc.ny * s * 0.45, r.pts));
  const inS = indoor(1) && !indoor(-1) ? 1 : -1;
  // Facing in, in the y-down plan: left of (fx, fy) is (fy, -fx).
  const fx = pc.nx * inS, fy = pc.ny * inS;
  let hingeB = dx * fy + dy * -fx > 0;                       // walking a → b goes left: b is the left end
  if (stored && stored.hinge === "right") hingeB = !hingeB;
  return { hinge: hingeB ? "b" : "a", side: stored && stored.swing === "out" ? -inS : inS };
}

/** The normal a barrier's wall has in Live Aboard (the house's
 *  deriveWalls): a wall along a room's edge faces as that edge does (dy, -dx
 *  over its length), built by the first indoor room in the map's order whose
 *  edge it lies along (within 8° and 0.47 m); a barrier along no room's edge
 *  stands on its own and faces (uy, -ux). So the flat Atlas swings a door the
 *  same way Live Aboard does. rooms: [{name, outdoor?, pts}] in map order. */
export function barrierNormal(a, b, rooms){
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const cos8 = Math.cos(8 * Math.PI / 180);
  for (const r of rooms || []) {
    if (outdoorRoom(r) || !r.pts) continue;
    const P = r.pts;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], el = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (el < 0.03) continue;
      const ex = (q[0] - p[0]) / el, ey = (q[1] - p[1]) / el;
      if (Math.abs(ex * ux + ey * uy) < cos8) continue;
      const off = (s) => Math.abs((s[0] - p[0]) * -ey + (s[1] - p[1]) * ex);
      const along = (s) => (s[0] - p[0]) * ex + (s[1] - p[1]) * ey, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (off(a) > 0.47 || off(b) > 0.47 || along(m) < -0.05 || along(m) > el + 0.05) continue;
      return [ey, -ex];
    }
  }
  return [uy, -ux];
}

// ── how a door with no sensor stands ─────────────────────────────────────────
// (house3d_store.py DOOR_SHOWN.) None stored: ajar inside, shut on an outside
// wall or as a garage door.
export const DOOR_SHOWN = ["open", "ajar", "shut"];
export const DOOR_ANGLE_DEG = { open: 85, ajar: 70, shut: 0 };
export const GARAGE_DOOR_M = 1.8;          // a door wider than this is a garage door (as the views have always drawn it)
export function doorShown(pc){
  const s = pc && pc.override && pc.override.shown;
  if (DOOR_SHOWN.includes(s)) return s;
  const len = pc ? Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0) : 0;
  return !pc || pc.cls === "ext" || len > GARAGE_DOOR_M ? "shut" : "ajar";
}
// ── door types (Garry, 2026-10-05: "a door will also need swing left, right,
// roll up or down, etc.") ────────────────────────────────────────────────────
// What a door is (openings[...].type; house3d_store.py DOOR_TYPES), what
// PadSpan guesses when nothing is stored, what drives it, and where each of
// its panels is at any point of opening, as numbers.
export const DOOR_TYPES = ["hinged", "double", "sliding", "barn", "pocket", "bifold", "overhead", "rollup", "tiltup", "gate"];
export const DOOR_TYPE_NAMES = { hinged: "Hinged", double: "Double / French", sliding: "Sliding", barn: "Barn", pocket: "Pocket",
                                 bifold: "Bifold", overhead: "Overhead garage", rollup: "Roll-up", tiltup: "Tilt-up", gate: "Gate" };
// Which options each type has on its sheet (and keeps in the file).
export const DOOR_TYPE_OPTIONS = {
  hinged: ["hinge", "swing"], double: ["swing", "glass"], sliding: ["slide", "glass"], barn: ["slide", "face"], pocket: ["slide"],
  bifold: ["slide", "panels"], overhead: [], rollup: [], tiltup: [], gate: ["swing", "slide", "panels"],
};
export const DOOR_SLIDES = ["left", "right", "both"], DOOR_FACES = ["in", "out"], DOOR_PANELS = [2, 4];
// How open "ajar" is for a door that rolls or lifts (a quarter), and how
// long a cover takes to travel all the way when it reports no position.
export const LIFT_AJAR = 0.25, COVER_TRAVEL_MS = 12000, COVER_STEP_MS = 1500;
const COVER_CLASSES = ["garage", "gate", "door", "shutter", "awning", "curtain", "blind", "shade", "window", "damper"];
const SLIDE_NAME = /\b(patio|slider|sliding)\b/i, CLOSET_NAME = /\b(closet|wardrobe)\b/i, GARAGE_NAME = /\b(garage|shop|workshop)\b/i;
export const OVERHEAD_MIN_M = 2.2, DOUBLE_M = [1.4, 1.9];

/** PadSpan's guess at what a door is, when nothing is stored: wide on an
 *  outside wall of a garage or a shop, an overhead door; glass, or a patio
 *  door or slider by its name, a sliding glass door; into a closet or a
 *  wardrobe, a bifold; 1.4 to 1.9 m wide, a double door; else hinged.
 *  rooms: [{name, outdoor, pts}] on its floor. {type, glass?, slide?}. */
export function guessDoorType(pc, rooms){
  const len = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0), mx = (pc.x0 + pc.x1) / 2, my = (pc.y0 + pc.y1) / 2;
  const nx = num(pc.nx) ?? 0, ny = num(pc.ny) ?? 0;
  const sides = [1, -1].map(s => (rooms || []).find(r => !outdoorRoom(r) && r.pts && inside(mx + nx * s * 0.45, my + ny * s * 0.45, r.pts)) || null);
  const name = String((pc.barrier && pc.barrier.name) || "");
  // (Outside: an outside wall, or with a room on one side only, as the flat Atlas sees a barrier.)
  const outside = pc.cls ? pc.cls === "ext" : !(sides[0] && sides[1]);
  if (len > OVERHEAD_MIN_M && outside && sides.some(r => r && GARAGE_NAME.test(r.name))) return { type: "overhead" };
  if (pc.mat === "glass" || SLIDE_NAME.test(name)) return { type: "sliding", glass: true };
  if (sides.some(r => r && CLOSET_NAME.test(r.name))) return { type: "bifold" };
  if (len >= DOUBLE_M[0] && len <= DOUBLE_M[1]) return { type: "double" };
  return { type: "hinged" };
}
/** A door's type and options as drawn: the stored ones (pc.override), else
 *  the guess; every option a type has, with its default. */
export function doorTypeOf(pc, rooms){
  const o = (pc && pc.override) || {}, guess = guessDoorType(pc, rooms);
  const stored = DOOR_TYPES.includes(o.type) ? o.type : null, type = stored || guess.type;
  const panels = Number.isInteger(o.panels) ? Math.max(DOOR_PANELS[0], Math.min(DOOR_PANELS[1], o.panels)) : null;
  return { type, guessed: !stored, guess: guess.type,
           slide: DOOR_SLIDES.includes(o.slide) ? o.slide : type === "gate" ? null : "right",
           face: DOOR_FACES.includes(o.face) ? o.face : "in",
           panels: panels ?? (type === "gate" ? 1 : type === "bifold" ? 2 : 2),
           glass: typeof o.glass === "boolean" ? o.glass : !!(stored ? false : guess.glass) || (!stored && pc && pc.mat === "glass") };
}
/** What a link drives: a cover (its position), a contact sensor (open or
 *  shut), or nothing. */
export function linkKind(eid, st){
  const dom = String(eid || "").split(".")[0];
  if (dom === "cover") return "cover";
  if (dom === "binary_sensor" || dom === "lock") return "sensor";
  return st && st.attributes && "current_position" in st.attributes ? "cover" : null;
}
/** A cover's state as an opening: {at (0 shut to 1 open), moving (+1
 *  opening, -1 closing, 0 still), none (no reading)}; current_position is
 *  proportional (40 is 40% open). */
export function coverAt(st){
  if (!st || st.state === "unavailable" || st.state === "unknown") return { at: 0, moving: 0, none: true };
  const p = num(st.attributes && st.attributes.current_position);
  const moving = st.state === "opening" ? 1 : st.state === "closing" ? -1 : 0;
  const at = p !== null ? Math.max(0, Math.min(100, p)) / 100 : st.state === "open" ? 1 : st.state === "closed" ? 0 : moving > 0 ? 0 : 1;
  return { at, moving, none: false };
}
/** Is this cover one a door follows (a garage door, a gate, a door)? */
export const coverIsDoor = (st) => !st || !st.attributes || !st.attributes.device_class || COVER_CLASSES.includes(st.attributes.device_class);

/** Where each panel of a door is, `a` open (0 shut, 1 fully open), in the
 *  door's own frame: u along the opening from its end a (metres, 0 to W),
 *  v across it toward the side it opens to (+), z up from its floor. Each
 *  panel {c: [u, v, z] (its middle), size: [along, up, thick], yaw (a turn
 *  about the upright from along the opening, toward +v), pitch (a tilt
 *  about its own long side, toward +v: 90° lies flat), glass, kind}. W: the
 *  opening's width, H: its head, wallT: the wall's thickness, ang: a hinged
 *  leaf's widest swing (radians), hingeAtB: the hinge is at end b, ceil:
 *  the ceiling over it (an overhead door's track stays under it). */
export function doorPanels(t, a, W, H, wallT, ang = 85 * Math.PI / 180, hingeAtB = false, ceil = H + 0.6){
  const T = 0.045, out = [], k = Math.max(0, Math.min(1, a));
  const leaf = (hu, dir, len, h, th, glass) => {
    // A leaf hinged at u = hu, lying toward dir (+1 toward b, -1 toward a), swung th toward +v.
    const cu = hu + dir * Math.cos(th) * len / 2, cv = Math.sin(th) * len / 2;
    out.push({ c: [cu, cv, h / 2], size: [len, h, T], yaw: dir > 0 ? th : Math.PI - th, pitch: 0, glass: !!glass, kind: "leaf" });
  };
  const slab = (u, v, z, len, h, th, glass, kind = "panel", pitch = 0) => out.push({ c: [u, v, z], size: [len, h, th], yaw: 0, pitch, glass: !!glass, kind });
  const g = !!t.glass, side = t.slide || "right";
  switch (t.type) {
    case "double": leaf(0, 1, W / 2, H, ang * k, g); leaf(W, -1, W / 2, H, ang * k, g); break;
    case "sliding": {
      if (side === "both") {
        // Two panels parting, each along the wall past its end.
        slab(W / 4 - k * W / 2, T, H / 2, W / 2, H, T, g); slab(3 * W / 4 + k * W / 2, T, H / 2, W / 2, H, T, g);
      } else {
        // One fixed half; the other slides behind it (to the right: toward b).
        const s = side === "right" ? 1 : -1, fixedU = s > 0 ? 3 * W / 4 : W / 4, startU = s > 0 ? W / 4 : 3 * W / 4;
        slab(fixedU, 0, H / 2, W / 2, H, T, g, "fixed");
        slab(startU + s * k * W / 2, 1.6 * T, H / 2, W / 2, H, T, g);
      }
      break;
    }
    case "barn": {
      const s = side === "left" ? -1 : 1, face = (t.face === "out" ? -1 : 1) * (wallT / 2 + 0.03);
      slab(W / 2 + s * k * (W + 0.05), face, (H + 0.05) / 2, W + 0.1, H + 0.05, T);
      break;
    }
    case "pocket": {
      const s = side === "left" ? -1 : 1;
      slab(W / 2 + s * k * W, 0, H / 2, W, H, T);           // into the wall: its open part is hidden in it
      break;
    }
    case "bifold": {
      // Panels folding in a zig-zag toward the side (both: half each way).
      const fold = (from, dir, n, len) => {
        const w = len / n, phi = k * 1.35;                  // up to about 77°
        let u = from, v = 0;
        for (let i = 0; i < n; i++) {
          const th = i % 2 === 0 ? phi : -phi, du = dir * Math.cos(phi) * w, dv = Math.sin(th) * w;
          out.push({ c: [u + du / 2, v + dv / 2, H / 2], size: [w, H, T * 0.8], yaw: dir > 0 ? th : Math.PI - th, pitch: 0, glass: false, kind: "fold" });
          u += du; v += dv;
        }
      };
      const n = Math.max(2, t.panels || 2);
      if (side === "both") { fold(0, 1, Math.max(1, Math.floor(n / 2)), W / 2); fold(W, -1, Math.max(1, Math.ceil(n / 2)), W / 2); }
      else if (side === "left") fold(0, 1, n, W); else fold(W, -1, n, W);
      break;
    }
    case "overhead": {
      // Four sections running up the opening, round a short bend and back
      // under the ceiling (toward +v, inside).
      const n = 4, h = H / n, r = Math.max(0.04, Math.min(0.25, ceil - H - 0.04)), d = k * H, bend = Math.PI * r / 2;
      for (let i = 0; i < n; i++) {
        const s = i * h + h / 2 + d;                        // the section's middle along its track
        if (s <= H) slab(W / 2, 0, s, W, h, T, false, "section");
        else if (s <= H + bend) {
          const q = (s - H) / r;                            // round the bend over the opening
          out.push({ c: [W / 2, r - r * Math.cos(q), H + r * Math.sin(q)], size: [W, h, T], yaw: 0, pitch: q, glass: false, kind: "section" });
        } else slab(W / 2, r + (s - H - bend), H + r, W, h, T, false, "section", Math.PI / 2);
      }
      break;
    }
    case "rollup": {
      // A drum over the opening; the curtain rises into it.
      slab(W / 2, 0.12, H + 0.17, W + 0.08, 0.34, 0.3, false, "drum");
      const hh = Math.max(0.02, H * (1 - k));
      slab(W / 2, 0, H - hh / 2, W, hh, T, false, "curtain");
      break;
    }
    case "tiltup": {
      // One piece swinging up and out about its head.
      const q = k * Math.PI / 2;
      out.push({ c: [W / 2, -Math.sin(q) * H / 2, H - Math.cos(q) * H / 2], size: [W, H, T], yaw: 0, pitch: -q, glass: false, kind: "panel" });
      break;
    }
    case "gate": {
      const gh = Math.min(H, 1.5);
      if (t.slide) {
        const s = t.slide === "left" ? -1 : 1;
        slab(W / 2 + s * k * W, 1.4 * T, gh / 2, W, gh, T * 0.6, false, "gate");
      } else if ((t.panels || 1) >= 2) { leaf(0, 1, W / 2, gh, ang * k, false); leaf(W, -1, W / 2, gh, ang * k, false); }
      else if (hingeAtB) leaf(W, -1, W, gh, ang * k, false); else leaf(0, 1, W, gh, ang * k, false);
      for (const p of out) p.kind = "gate";
      break;
    }
    default:
      if (hingeAtB) leaf(W, -1, W, H, ang * k, false); else leaf(0, 1, W, H, ang * k, false);
  }
  return out;
}
/** How far a door with no link stands open, by its type and how it is
 *  shown: shut, open, or ajar (a door that swings: its whole swing at the
 *  ajar angle; one that slides or folds: half; one that rolls or lifts: a
 *  quarter). */
export function shownAt(type, shown){
  if (shown === "shut") return 0;
  if (shown !== "ajar") return 1;
  return ["overhead", "rollup", "tiltup"].includes(type) ? LIFT_AJAR : ["sliding", "barn", "pocket", "bifold"].includes(type) ? 0.5 : 1;
}
/** A panel's colour, by what it is. */
export const PANEL_COLOURS = { leaf: "#8b6a4f", fold: "#a07e60", panel: "#8b6a4f", fixed: "#8b6a4f", glass: "#bcd9ea",
                               section: "#c3c9d0", curtain: "#b4bcc4", drum: "#8f969d", gate: "#6d5a48" };
export const panelColour = (p) => (p.glass ? PANEL_COLOURS.glass : PANEL_COLOURS[p.kind] || PANEL_COLOURS.panel);
/** Doors that lift or roll take longer to move than one that swings (ms). */
export const moveMs = (type) => (["overhead", "rollup", "tiltup"].includes(type) ? 2500 : ["sliding", "barn", "pocket", "bifold"].includes(type) ? 1000 : 650);
