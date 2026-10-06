// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's Strip tool (Garry, 2026-10-05: "better height and area
// placement for string lights ... a step farther for Sims"): Edit → Strip,
// beside Door, Window and Heights, on the editor's own draft, so one Save
// writes it with everything else (live_aboard_edit.js).
//
//   Pick the light   tap a light in Live Aboard, or choose it from "Lights to
//                    lay out" (strips, valances, coves, under-cabinet, toe-kick,
//                    TV and string lights with no run yet first). It pulses
//                    a moment, then stays outlined (the real light is never
//                    switched).
//   Draw its run     Draw, then press on a wall and drag along it: the run
//                    follows the wall at the height pressed and carries on
//                    round the room's corners. Or tap points one at a time
//                    (an L, a U; a tap off any wall is a free point, a post,
//                    at the height chosen); double-tap or Done ends it. A tap
//                    on a piece of furniture lands on its nearest edge; a run
//                    all on one piece moves and turns with it. The length
//                    shows as it goes, with how far the next corner is.
//   One tap          Round this room (gaps at the doors, and at windows if
//                    asked), Under / Behind / Top of a piece, Along a rail
//                    (a deck), Continue from another light's run (a WLED
//                    segment after the one before it).
//   Height           chips (Toe-kick, Counter, Under cabinets, Valance, Cove,
//                    Ceiling edge), typed in cm for the whole run or the
//                    picked point, ↑/↓ 1 cm (Shift 10 cm), and handles in the
//                    view: the middle one raises it all, an end one tilts it.
//                    Dragged heights snap to the chips (3 cm), a piece's edges
//                    and the ceiling, with a dashed line up from the floor.
//   Which way        Up, Down, Into the room, Onto the wall.
//   String lights    the swag between points and how far apart the bulbs are.
//   Edit             drag a point, tap the run to add one, delete one, or
//                    remove the run (back to PadSpan's guess).
//
// Imports nothing: three.js, the house's rules and the runs' rules
// (live_aboard_runs.js) are handed in by the editor.

const SLOP = 6;                                     // px a press may move and still be a tap
const GRAB = { mouse: 14, touch: 24 };              // px round a handle or a point
const ON_RUN = { mouse: 10, touch: 18 };            // px from the run for a tap that adds a point
const TAP2_MS = 380;                                // two taps this close: done
const PULSE_MS = 2400;                              // the picked light pulses this long, then stays outlined
const COL = { run: "#fbbf24", draw: "#60a5fa", corner: "#38bdf8", dash: "#e2e8f0" };
const KIND_NAMES = [["strip", "LED strip on a wall"], ["valance", "Valance"], ["cove", "Cove round the room"],
                    ["undercab", "Under the cabinets"], ["kick", "Toe-kick or stairs"], ["tv", "Behind the TV"],
                    ["string", "String lights (bulbs on a wire)"]];
const AREA_HINT = { room: "Tap the room to go round.", under: "Tap the piece to go under.", behind: "Tap the piece to go behind.",
                    top: "Tap the piece to go along the top of.", rail: "Tap the deck to go along its rail." };
const DRAW_HINT = "Press on a wall and drag along it, or tap points one at a time; double-tap or Done ends it.";

const CSS = `
.la3d-sheet.strip{max-height:calc(100% - 120px);overflow-y:auto}
@media (max-width:600px){.la3d-sheet.strip{left:10px;right:10px;width:auto;top:auto!important;bottom:58px;max-height:40%}}
.la3d-sheet .la3d-sl{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto;margin-top:4px}
.la3d-sheet .la3d-sl button{all:unset;box-sizing:border-box;display:block;width:100%;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:12.5px;color:#e8f0ea}
.la3d-sheet .la3d-sl button:hover,.la3d-sheet .la3d-sl button:focus-visible{background:rgba(82,183,136,.2)}
.la3d-sheet .la3d-sl small{display:block;color:rgba(226,240,232,.55);font-size:10.5px}
.la3d-sheet .la3d-sl h5{margin:6px 8px 2px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(226,240,232,.5)}
.la3d-sheet .la3d-chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 6px}
.la3d-sheet .la3d-chips button{all:unset;cursor:pointer;padding:4px 9px;border-radius:999px;font-size:11.5px;color:#e8f0ea;
  background:rgba(255,255,255,.07);border:1px solid rgba(120,190,155,.28)}
.la3d-sheet .la3d-chips button[aria-pressed="true"]{background:rgba(82,183,136,.32);border-color:#52b788}
.la3d-sheet .la3d-chips button:disabled{opacity:.4;cursor:default}
.la3d-sheet .la3d-cm{display:flex;gap:6px;align-items:center;margin:4px 0}
.la3d-sheet .la3d-cm input{width:72px;box-sizing:border-box;padding:4px 6px;border-radius:8px;border:1px solid rgba(120,190,155,.3);
  background:#0a150e;color:#e8f0ea;font:inherit}
.la3d-sheet .la3d-tick{display:flex;gap:6px;align-items:center;font-size:12px;margin:2px 0}
.la3d-hnd{position:absolute;z-index:3;display:none;box-sizing:border-box;min-width:24px;height:24px;margin:-12px 0 0 -12px;padding:0 4px;
  border-radius:12px;border:2px solid #fff;background:#f59e0b;color:#1f1300;font:700 14px/20px system-ui,sans-serif;text-align:center;
  box-shadow:0 0 0 3px rgba(0,0,0,.35);pointer-events:none}
.la3d-sdot{position:absolute;z-index:3;display:none;box-sizing:border-box;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
  border:2px solid #fff;background:#fbbf24;box-shadow:0 0 0 2px rgba(0,0,0,.35);pointer-events:none}
.la3d-sdot.on{background:#ef4444;width:22px;height:22px;margin:-11px 0 0 -11px}
.la3d-sring{position:absolute;z-index:3;display:none;box-sizing:border-box;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;
  border:3px solid #fbbf24;pointer-events:none}
.la3d-spill{position:absolute;z-index:3;display:none;transform:translate(-50%,-50%);padding:3px 9px;border-radius:999px;
  background:rgba(6,14,9,.92);border:1px solid rgba(255,255,255,.3);color:#fff;font:700 12px system-ui,sans-serif;
  white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}
.la3d-spill.corner{border-color:#38bdf8;color:#e0f2fe}`;

/**
 * ctx = {
 *   THREE, HOUSE, RUNS, root, guard, sheet (the editor's)
 *   draft()                  the editor's draft (cur: what it owns)
 *   active()                 the Strip tool is on in an open editor
 *   change(fn, group)        one undoable step on the draft (a group: one drag)
 *   redraw(), render(), hint(text, bad)
 *   floors()                 the floors as drawn: {fl, group, rooms, pieces: [{pc, cut}]}
 *   lights()                 the lights drawn: [{eid, F, drawn, guess, label}]
 *   pick(x, y)               the view's own picking
 *   device(eid)              a drawn light: {section, F, z, at, label, guess}
 *   camera(), scene(), rect(), layer (the furniture drawn), shellGen()
 *   paint()                  the editor's buttons again (Save, Undo)
 * }
 */
export function createStrip(ctx){
  const { THREE, HOUSE, RUNS, root, guard } = ctx;
  let shownNow = false, sel = null, drawing = null, area = null, gesture = null, ptSel = null, lastTap = null;
  let pulseUntil = 0, pulsing = false, dragGen = 0, lastCam = null, burst = null;
  let folded = false;                                // the panel folded to its title (a phone: the house shows)
  const opts = { doors: true, windows: false };
  const loops = new Map();
  let loopsGen = null;
  const cur = () => { const d = ctx.draft(); return d ? d.cur : null; };
  const entryOf = (eid) => { const c = cur(); return (c && c.lights && c.lights[eid]) || null; };
  const runOf = (eid) => { const e = entryOf(eid); return e && e.run && typeof e.run === "object" ? e.run : null; };
  const pieceOf = (id) => { const c = cur(); return (c && c.pieces && c.pieces[id]) || null; };
  const info = () => (sel ? ctx.device(sel) : null);
  const ceilOf = (F) => F.fl.h - HOUSE.SLAB_T;
  const kindOf = (eid) => { const e = entryOf(eid), I = e && e.kind ? null : ctx.device(eid); return (e && e.kind) || (I && I.kind) || "strip"; };
  /** The run where it is drawn: its points on its floor (null: its piece is gone). */
  const placedOf = (eid) => RUNS.placed(runOf(eid), (cur() || {}).pieces);

  // ── the page ──────────────────────────────────────────────────────────────
  const d = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const btn = (text, title, act, cls) => {
    const b = d("button", cls, text);
    b.type = "button"; b.title = title;
    b.addEventListener("click", guard((e) => { e.stopPropagation(); act(e); }));
    return b;
  };
  const seg = (...items) => { const s = d("span", "lv-zoomseg"); for (const b of items) if (b) s.appendChild(b); return s; };
  const style = d("style");
  style.textContent = CSS;
  root.appendChild(style);
  const dots = [];
  const dot = (i) => { while (dots.length <= i) { const e = d("div", "la3d-sdot"); root.appendChild(e); dots.push(e); } return dots[i]; };
  const hMid = d("div", "la3d-hnd", "↕"), hEnds = [d("div", "la3d-hnd", "↕"), d("div", "la3d-hnd", "↕")];
  const ring = d("div", "la3d-sring"), lenPill = d("div", "la3d-spill"), cornerPill = d("div", "la3d-spill corner"), hPill = d("div", "la3d-spill");
  root.append(hMid, hEnds[0], hEnds[1], ring, lenPill, cornerPill, hPill);
  for (const h of [hMid, ...hEnds]) h.title = "Drag up or down";

  // ── 3D marks: the run picked or being drawn, the corner, the height ───────
  const box = new THREE.BoxGeometry(1, 1, 1);
  const markMat = new THREE.MeshBasicMaterial({ color: COL.run, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
  const MAX_MARK = 130;
  const mark = new THREE.InstancedMesh(box, markMat, MAX_MARK);
  mark.renderOrder = 31; mark.frustumCulled = false; mark.count = 0;
  const cornerMat = new THREE.MeshBasicMaterial({ color: COL.corner, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const corner = new THREE.Mesh(box, cornerMat);
  corner.matrixAutoUpdate = false; corner.renderOrder = 32; corner.visible = false; corner.frustumCulled = false;
  const dashGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const dashMat = new THREE.LineDashedMaterial({ color: COL.dash, dashSize: 0.06, gapSize: 0.05, depthTest: false, transparent: true });
  const dash = new THREE.Line(dashGeo, dashMat);
  dash.renderOrder = 33; dash.frustumCulled = false; dash.visible = false;
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), plane = new THREE.Plane();
  function ensureMarks(){
    const sc = ctx.scene();
    if (!sc) return;
    for (const o of [mark, corner, dash]) if (o.parent !== sc) sc.add(o);
  }
  /** The polyline marked: its stretches as thin boxes over everything. */
  function markRun(F, pts, loop, col, gaps = null){
    const g = new Set(gaps || []), st = pts.length >= 2 ? RUNS.stretches(pts, loop) : [];
    let n = 0;
    for (const q of st) {
      if (n >= MAX_MARK) break;
      if (RUNS.lengthOf([q.a, q.b], false) < 1e-3) continue;
      _m.fromArray(RUNS.boxMatrix(q.a, q.b, g.has(q.i) ? 0.012 : 0.04));
      _m.elements[13] += F.fl.elev;
      mark.setMatrixAt(n++, _m);
    }
    mark.count = n;
    mark.instanceMatrix.needsUpdate = true;
    markMat.color.set(col);
  }

  // ── where things are ──────────────────────────────────────────────────────
  const kindOfPtr = (e) => (e.pointerType === "touch" || e.pointerType === "pen" ? "touch" : "mouse");
  function rayAt(x, y){
    const r = ctx.rect(), cam = ctx.camera();
    if (!r.width || !r.height || !cam) return null;
    ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    cam.updateMatrixWorld();
    ray.setFromCamera(ndc, cam);
    lastCam = cam;
    return ray.ray;
  }
  function screenAt(F, x, y, h){
    const r = ctx.rect(), cam = ctx.camera();
    if (!cam || !r.width) return null;
    _v.set(x, F.fl.elev + h, y).project(cam);
    if (!(_v.z > -1 && _v.z < 1)) return null;
    return [r.left + (_v.x + 1) / 2 * r.width, r.top + (1 - _v.y) / 2 * r.height];
  }
  const floorById = (fid) => ctx.floors().find(F => F.fl.id === fid) || null;
  /** Each indoor room's walls as one loop (their inside faces, a strip's
   *  width in), and each loop stretch's wall piece (cut away or not). */
  function loopsOf(F){
    if (loopsGen !== ctx.shellGen()) { loops.clear(); loopsGen = ctx.shellGen(); }
    let L = loops.get(F.fl.id);
    if (!L) {
      L = F.rooms.filter(r => !r.outdoor && !F.fl.outdoor).map(room => {
        const loop = RUNS.insetLoop(room.pts, 0.015);
        const walls = loop.map((a, i) => {
          const b = loop[(i + 1) % loop.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          let best = null;
          for (const P of F.pieces) {
            const pc = P.pc;
            if (pc.kind === "rail") continue;
            const dd = segDist(m, [pc.x0, pc.y0], [pc.x1, pc.y1]);
            if (dd < 0.4 && (!best || dd < best.d)) best = { d: dd, P };
          }
          return best ? best.P : null;
        });
        return { room, loop, walls };
      });
      loops.set(F.fl.id, L);
    }
    return L;
  }
  /** The wall face under the pointer on floor F: an inside face of a room
   *  (as one loop round it), or the outside face of an outside wall. The
   *  nearest along the ray; a face seen from its room's side only. */
  function wallHit(F, r){
    const elev = F.fl.elev, ceil = ceilOf(F);
    let best = null;
    const take = (t, hit) => { if (t > 0 && (!best || t < best.t)) best = { t, ...hit }; };
    for (const Lp of loopsOf(F)) {
      const { loop } = Lp;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length], n = RUNS.inwardOf(loop, i);
        const dn = r.direction.x * n[0] + r.direction.z * n[1];
        if (dn > -0.05) continue;                                   // seen from behind, or edge on
        const t = ((a[0] - r.origin.x) * n[0] + (a[1] - r.origin.z) * n[1]) / dn;
        const x = r.origin.x + r.direction.x * t, y = r.origin.z + r.direction.z * t, h = r.origin.y + r.direction.y * t - elev;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), s = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (L || 1);
        const P = Lp.walls[i], top = P && P.cut ? HOUSE.CUT_H : ceil;
        if (s < -0.02 || s > L + 0.02 || h < 0 || h > top) continue;
        take(t, { kind: "loop", Lp, s: RUNS.perimeter(loop).cum[i] + Math.max(0, Math.min(L, s)), h, x, y });
      }
    }
    // The outside of an outside wall (string lights from the eaves).
    for (const P of F.pieces) {
      const pc = P.pc;
      if (pc.kind !== "wall" || pc.cls !== "ext") continue;
      const L = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
      if (L < 0.2) continue;
      const u = [(pc.x1 - pc.x0) / L, (pc.y1 - pc.y0) / L], m = [(pc.x0 + pc.x1) / 2, (pc.y0 + pc.y1) / 2];
      let n = [pc.nx, pc.ny];
      const probe = [m[0] + n[0] * (pc.thick / 2 + 0.1), m[1] + n[1] * (pc.thick / 2 + 0.1)];
      if (F.rooms.some(q => !q.outdoor && HOUSE.inPoly(probe[0], probe[1], q.pts))) n = [-n[0], -n[1]];
      const off = pc.thick / 2 + 0.015, a = [pc.x0 + n[0] * off, pc.y0 + n[1] * off];
      const dn = r.direction.x * n[0] + r.direction.z * n[1];
      if (dn > -0.05) continue;
      const t = ((a[0] - r.origin.x) * n[0] + (a[1] - r.origin.z) * n[1]) / dn;
      const x = r.origin.x + r.direction.x * t, y = r.origin.z + r.direction.z * t, h = r.origin.y + r.direction.y * t - elev;
      const s = (x - a[0]) * u[0] + (y - a[1]) * u[1];
      if (s < 0 || s > L || h < 0 || h > (P.cut ? HOUSE.CUT_H : ceil)) continue;
      take(t, { kind: "face", a, u, L, s, h, x, y });
    }
    return best;
  }
  /** A plan point at height h above floor F under the pointer. */
  function onLevel(F, r, h){
    plane.set(new THREE.Vector3(0, 1, 0), -(F.fl.elev + h));
    return r.intersectPlane(plane, _v) ? [_v.x, _v.z] : null;
  }
  /** A piece of furniture under the pointer on floor F, nothing in front of
   *  it (as Furnish picks): {id, p (the piece), q (the point in its frame)}. */
  function pieceHit(F, x, y){
    const r = rayAt(x, y);
    if (!r || !ctx.layer) return null;
    const shown = ctx.layer.shown();
    const hits = ray.intersectObjects(shown.map(s => s.root), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !(o.userData && o.userData.pieceId)) o = o.parent;
      const p = o && pieceOf(o.userData.pieceId);
      if (!p || String(p.floor_id) !== String(F.fl.id)) continue;
      const q = RUNS.onPieceFrame(p, [h.point.x, h.point.z, h.point.y - F.fl.elev]);
      return { id: p.id, p, q, t: h.distance };
    }
    return null;
  }
  const sizeOf = (p) => { const r = (p && p.recipe) || {}; const n = (v, dflt) => (typeof v === "number" && v > 0 ? v : dflt); return { w: n(r.width_m, 0.5), d: n(r.depth_m, 0.5), h: n(r.height_m, 0.5) }; };
  /** Heights a dragged height snaps to near (x, y): the tops and bottoms of
   *  the pieces there. */
  function edgesNear(F, x, y){
    const out = [];
    for (const p of Object.values((cur() || {}).pieces || {})) {
      if (String(p.floor_id) !== String(F.fl.id)) continue;
      const s = sizeOf(p), q = RUNS.onPieceFrame(p, [x, y, 0]);
      if (Math.abs(q[0]) > s.w / 2 + 0.4 || Math.abs(q[1]) > s.d / 2 + 0.4) continue;
      const z = typeof p.z_m === "number" ? p.z_m : 0;
      out.push({ h: z, label: "the piece's underside" }, { h: z + s.h, label: "the piece's top" });
    }
    return out;
  }
  function segDist(p, a, b){
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  }

  // ── the draft ─────────────────────────────────────────────────────────────
  /** Set the picked light's run (null: none, back to PadSpan's guess). A run
   *  laid out on a light PadSpan draws as something other than a strip makes
   *  it a strip (its kind; Heights can still change it). */
  function setRun(run, group = null, eid = sel){
    const k = kindOf(eid);
    return ctx.change((c) => {
      const e = { ...(c.lights[eid] || {}) };
      if (run) { e.run = run; if (!e.kind && !RUNS.STRIP_KINDS.has(k)) e.kind = "strip"; } else delete e.run;
      if (Object.keys(e).length) c.lights[eid] = e; else delete c.lights[eid];
    }, group);
  }
  /** A run made from points drawn on floor F (anchors: on a room's walls, an
   *  outside wall, a piece, or free): on one piece only, it is that piece's. */
  function runFrom(anchors, face){
    const pieceIds = new Set(anchors.map(a => (a.kind === "piece" ? a.id : null)));
    const onOne = pieceIds.size === 1 && !pieceIds.has(null) ? [...pieceIds][0] : null;
    const pts = [];
    const abs = (a) => (a.kind === "piece" ? RUNS.piecePoint(pieceOf(a.id), a.q) : [a.x, a.y, a.h]);
    anchors.forEach((a, i) => {
      const prev = anchors[i - 1];
      if (prev && prev.kind === "loop" && a.kind === "loop" && prev.Lp === a.Lp) {
        // Along the walls between them, round the corners, the shorter way.
        const loop = a.Lp.loop, s1 = prev.s + RUNS.stepRound(loop, prev.s, a.s), path = RUNS.pathAlong(loop, prev.s, s1);
        const tot = Math.abs(s1 - prev.s) || 1;
        let run = 0;
        for (let k = 1; k < path.length; k++) {
          run += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
          pts.push([path[k][0], path[k][1], prev.h + (a.h - prev.h) * Math.min(1, run / tot)]);
        }
      } else pts.push(onOne ? a.q.slice() : abs(a));
    });
    // Back where it started (all the way round a room): a loop.
    const loop = pts.length >= 4 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.1;
    if (loop) pts.pop();
    return RUNS.tidy({ pts, face, loop, ...(onOne ? { piece: onOne } : null) });
  }
  const defaultH = (F, eid = sel) => {
    const k = kindOf(eid), ceil = ceilOf(F), e = entryOf(eid);
    // Its own height (on its placement record, else the 3D file's) when it has one.
    if (e && typeof e.z_m === "number" && Number.isFinite(e.z_m)) return Math.max(0, Math.min(e.z_m, ceil - 0.05));
    return k === "cove" ? RUNS.chips(ceil)[4][2] : Math.min(HOUSE.mountHeight(HOUSE.MOUNT[k] ? k : "strip", ceil), ceil - 0.05);
  };
  const faceFor = (eid = sel) => { const r = runOf(eid); return r ? r.face : RUNS.faceOf(kindOf(eid)); };
  const stringy = (eid = sel) => kindOf(eid) === "string";
  const withString = (run, eid = sel) => (stringy(eid) ? { sag_m: RUNS.SAG_M, spacing_m: RUNS.SPACING_M, ...run } : run);
  function finish(anchors){
    const F = drawing && drawing.F;
    drawing = null; ptSel = null;
    if (!F || anchors.length < 2) { ctx.hint(anchors.length ? "A run needs two points or more." : "Nothing drawn.", !!anchors.length); paint(); return; }
    const r = runFrom(anchors, faceFor());
    if (r.error) { ctx.hint(r.error, true); paint(); return; }
    setRun(withString(r.run));
    ctx.hint(`Laid out${r.run.loop ? " all the way round" : ""}: ${RUNS.metres(RUNS.lengthOf(r.run.pts, r.run.loop))}. Drag a point or a handle to change it.`);
    sheet(); paint();
  }

  // ── picking a light, drawing, the areas ───────────────────────────────────
  function select(eid){
    sel = eid; drawing = null; area = null; ptSel = null; gesture = null;
    if (eid) startPulse();
    sheet(); paint();
  }
  function startPulse(){
    pulseUntil = performance.now() + PULSE_MS;
    if (pulsing) return;
    pulsing = true;
    const step = guard(() => {
      const t = performance.now();
      if (!shownNow || t >= pulseUntil) { pulsing = false; markMat.opacity = 0.8; ring.style.opacity = ""; ctx.render(); return; }
      const k = Math.abs(Math.sin((t % 800) / 800 * Math.PI));
      markMat.opacity = 0.45 + 0.45 * k;
      ring.style.opacity = String(0.35 + 0.65 * k);
      layout();
      ctx.render();
      requestAnimationFrame(step);
    });
    requestAnimationFrame(step);
  }
  function startDraw(seed = null){
    const I = info();
    if (!I) return;
    area = null; ptSel = null;
    drawing = { F: I.F, anchors: seed ? [seed] : [], h: defaultH(I.F) };
    ctx.hint(seed ? "Now press on a wall and drag, or tap the next points; double-tap or Done ends it." : DRAW_HINT);
    sheet(); paint();
  }
  function pickArea(kind){
    drawing = null; ptSel = null;
    area = area === kind ? null : kind;
    ctx.hint(area ? AREA_HINT[area] : "");
    sheet(); paint();
  }
  /** "Round this room": the room's walls at the run's height (or the kind's). */
  function roundRoom(F, room){
    const run = placedOf(sel), h = run ? run.pts.reduce((s, q) => s + q[2], 0) / run.pts.length : defaultH(F);
    const ops = F.pieces.map(P => P.pc).filter(pc => pc.kind === "door" || pc.kind === "window" || pc.kind === "open" || pc.kind === "doorway")
      .map(pc => ({ kind: pc.kind, a: [pc.x0, pc.y0], b: [pc.x1, pc.y1], sill: pc.sill_m, head: pc.head_m }));
    const r = RUNS.roundRoom(RUNS.insetLoop(room.pts, 0.015), Math.min(h, ceilOf(F) - 0.012), ops, { ...opts, face: faceFor() });
    if (r.error) { ctx.hint(r.error, true); return; }
    setRun(withString(r.run));
    const gaps = (r.run.gaps || []).length;
    ctx.hint(`Round the ${room.name}: ${RUNS.metres(RUNS.lengthOf(r.run.pts, true))}${gaps ? `, ${gaps} gap${gaps === 1 ? "" : "s"} at the doors${opts.windows ? " and windows" : ""}` : ""}.`);
  }
  function roundPiece(id, mode){
    const p = pieceOf(id);
    if (!p) return;
    const r = RUNS.roundPiece(p, sizeOf(p), mode);
    if (r.error) { ctx.hint(r.error, true); return; }
    setRun(withString(r.run));
    ctx.hint({ under: "Under it.", behind: "Round its back: a halo on the wall.", top: "Along its top edge." }[mode] + " It moves with the piece.");
  }
  function alongRail(F, room){
    const rails = F.pieces.map(P => P.pc).filter(pc => pc.kind === "rail").map(pc => ({ a: [pc.x0, pc.y0], b: [pc.x1, pc.y1] }));
    const r = RUNS.alongRail(RUNS.insetLoop(room.pts, 0.03), rails, { face: faceFor() });
    if (r.error) { ctx.hint(r.error, true); return; }
    setRun(withString(r.run));
    ctx.hint(rails.length ? "Along the rail's top." : "Along the deck's edge.");
  }
  /** "Continue from…": start where another light's run ends. */
  function continueFrom(eid){
    const run = placedOf(eid);
    if (!run) return;
    const q = run.pts[run.pts.length - 1];
    startDraw({ kind: "free", x: q[0], y: q[1], h: q[2] });
  }
  function removeRun(){
    if (!runOf(sel)) return;
    setRun(null);
    ptSel = null;
    ctx.hint("Run removed: drawn where PadSpan guesses again. Undo brings it back.");
    sheet();
  }
  function deletePoint(){
    const run = runOf(sel);
    if (!run || ptSel === null || run.pts.length <= 2) return;
    const pts = run.pts.filter((_, i) => i !== ptSel);
    const gaps = (run.gaps || []).filter(i => i !== ptSel).map(i => (i > ptSel ? i - 1 : i));
    const r = RUNS.tidy({ ...run, pts, loop: run.loop && pts.length >= 3, gaps });
    if (r.error) { ctx.hint(r.error, true); return; }
    setRun(r.run);
    ptSel = null;
    ctx.hint("Point deleted.");
    sheet();
  }
  /** Raise or lower the run (or the picked point) by dh, kept under the ceiling. */
  function raiseBy(dh, group = null){
    const run = runOf(sel), I = info();
    if (!run || !I) return false;
    const r = RUNS.raised(run, dh, ptSel, run.piece ? RUNS.HEIGHT_MAX_M : ceilOf(I.F));
    return !!r && setRun(r, group);
  }
  /** A height typed or a chip: the whole run (or the picked point) to h above the floor. */
  function setHeight(h){
    const run = runOf(sel), I = info(), pl = placedOf(sel);
    if (!run || !I || !pl) return;
    const at = ptSel !== null ? pl.pts[ptSel][2] : pl.pts.reduce((s, q) => s + q[2], 0) / pl.pts.length;
    if (ptSel === null) {
      // All of it to h (a tilted run is made level).
      const off = run.piece ? (pieceOf(run.piece).z_m || 0) : 0, top = ceilOf(I.F) - off;
      setRun({ ...run, pts: run.pts.map(q => [q[0], q[1], RUNS.mm(Math.max(0, Math.min(top, h - off)))]) });
    } else raiseBy(h - at);
    sheet();
  }

  // ── the sheet ─────────────────────────────────────────────────────────────
  const el = () => ctx.sheet;
  function sheet(){
    if (!shownNow || !ctx.active()) return false;
    const S = el();
    S.innerHTML = "";
    S.classList.add("strip");
    const h4 = d("h4");
    h4.appendChild(d("span", null, sel ? (info() || {}).label || sel : "Strip"));
    const fold = btn(folded ? "▴" : "▾", folded ? "Show the panel" : "Fold the panel away", () => { folded = !folded; sheet(); }, "la3d-x");
    fold.setAttribute("aria-expanded", String(!folded));
    h4.appendChild(fold);
    if (sel) h4.appendChild(btn("×", "Back to the list", () => select(null), "la3d-x"));
    S.appendChild(h4);
    if (folded) { S.classList.add("on"); return true; }
    if (!sel || !info()) { listOf(S); S.classList.add("on"); return true; }
    const run = runOf(sel), pl = placedOf(sel), F = info().F, ceil = ceilOf(F);
    S.appendChild(d("p", "la3d-sub", run && !pl ? "Its piece is gone: lay it out again."
      : run ? `Laid out: ${RUNS.metres(RUNS.lengthOf(pl.pts, pl.loop))}, ${pl.pts.length} points${pl.loop ? ", round" : ""}${run.piece ? ", on a piece" : ""}.`
      : "Not laid out yet: drawn where PadSpan guesses."));
    // What it is (the strip kinds; Heights has every kind).
    const krow = d("label", "la3d-row la3d-kind"), pick = d("select");
    pick.setAttribute("aria-label", "What is this?");
    const now = kindOf(sel);
    if (!KIND_NAMES.some(([k]) => k === now)) { const o = d("option", null, `Now: ${(HOUSE.LIGHT_KINDS.find(([k]) => k === now) || [0, now])[1]}`); o.value = ""; pick.appendChild(o); }
    for (const [k, t] of KIND_NAMES) { const o = d("option", null, t); o.value = k; pick.appendChild(o); }
    pick.value = KIND_NAMES.some(([k]) => k === now) ? now : "";
    pick.addEventListener("change", guard(() => {
      const v = pick.value;
      if (!v) return;
      ctx.change((c) => {
        const e = { ...(c.lights[sel] || {}), kind: v };
        if (e.run && v === "string") e.run = { sag_m: RUNS.SAG_M, spacing_m: RUNS.SPACING_M, ...e.run };
        c.lights[sel] = e;
      });
      sheet();
    }));
    krow.append(d("span", null, "What is this?"), pick);
    S.appendChild(krow);
    // Draw it, or one tap.
    S.appendChild(d("div", "la3d-sec", "Lay it out"));
    const acts = d("div", "la3d-acts");
    if (drawing) {
      acts.appendChild(seg(btn("Done", "End the run here", () => finish(drawing.anchors), "la3d-save"),
        btn("Cancel", "Stop drawing", () => { drawing = null; ctx.hint(""); sheet(); paint(); })));
      // A point tapped off any wall (a post) goes at this height.
      const row = d("label", "la3d-cm"), inp = d("input");
      inp.type = "number"; inp.min = "0"; inp.max = String(Math.round(ceil * 100)); inp.step = "1"; inp.value = String(Math.round(drawing.h * 100));
      inp.setAttribute("aria-label", "New points at, cm");
      const take = () => { const v = Number(inp.value); if (Number.isFinite(v) && drawing) drawing.h = RUNS.mm(Math.max(0, Math.min(ceil, v / 100))); };
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") take(); });
      inp.addEventListener("change", guard(take));
      row.append(d("span", null, "New points at"), inp, d("span", null, "cm"));
      S.appendChild(acts);
      S.appendChild(row);
    } else acts.appendChild(seg(btn(run ? "Draw again" : "Draw", "Press on a wall and drag, or tap points", () => startDraw())));
    const areaBtn = (k, text, title) => { const b = btn(text, title, () => pickArea(k)); b.setAttribute("aria-pressed", String(area === k)); return b; };
    acts.appendChild(seg(areaBtn("room", "Round this room", "Tap a room: the run goes along every wall")));
    acts.appendChild(seg(areaBtn("under", "Under", "Under a piece: wall cabinets, a bed"), areaBtn("behind", "Behind", "Behind a piece: a TV, a headboard"),
      areaBtn("top", "Top edge", "Along the top of a piece: a shelf, a cabinet")));
    if (F.fl.outdoor || F.rooms.some(r => r.outdoor)) acts.appendChild(seg(areaBtn("rail", "Along a rail", "Tap a deck: along its rail or edge")));
    if (!acts.parentNode) S.appendChild(acts);
    const tick = (label, key, title) => {
      const l = d("label", "la3d-tick"), c = d("input");
      c.type = "checkbox"; c.checked = opts[key]; c.title = title;
      c.addEventListener("change", guard(() => { opts[key] = c.checked; }));
      l.append(c, d("span", null, label));
      return l;
    };
    if (area === "room") { S.appendChild(tick("Leave gaps at doors", "doors", "Only wire past a door")); S.appendChild(tick("and windows", "windows", "Only wire past a window")); }
    const others = ctx.lights().filter(L => L.eid !== sel && L.F.fl.id === F.fl.id && placedOf(L.eid));
    if (others.length) {
      const row = d("label", "la3d-row la3d-kind"), cs = d("select");
      cs.setAttribute("aria-label", "Continue from");
      const o0 = d("option", null, "Pick a light…"); o0.value = ""; cs.appendChild(o0);
      for (const L of others) { const o = d("option", null, L.label); o.value = L.eid; cs.appendChild(o); }
      cs.addEventListener("change", guard(() => { if (cs.value) continueFrom(cs.value); }));
      row.append(d("span", null, "Continue from"), cs);
      S.appendChild(row);
    }
    if (run && pl) {
      // How high.
      S.appendChild(d("div", "la3d-sec", ptSel === null ? "Height, all of it" : `Height, point ${ptSel + 1}`));
      const at = ptSel !== null ? pl.pts[ptSel][2] : pl.pts.reduce((s, q) => s + q[2], 0) / pl.pts.length;
      const chipRow = d("div", "la3d-chips"), mid = pl.pts[Math.floor((pl.pts.length - 1) / 2)], cab = cabinetOver(F, mid);
      for (const [key, label0, h0] of RUNS.chips(ceil)) {
        const h = key === "undercab" && cab !== null ? cab : h0, label = key === "undercab" && cab !== null ? `Under cabinets ${RUNS.cm(h)}` : label0;
        const b = btn(label, `${label}: ${RUNS.cm(h)}`, () => setHeight(h));
        b.dataset.chip = key;
        b.setAttribute("aria-pressed", String(Math.abs(h - at) < 0.005));
        chipRow.appendChild(b);
      }
      S.appendChild(chipRow);
      const cmRow = d("label", "la3d-cm"), inp = d("input");
      inp.type = "number"; inp.min = "0"; inp.max = String(Math.round(ceil * 100)); inp.step = "1"; inp.value = String(Math.round(at * 100));
      inp.setAttribute("aria-label", "Height in cm");
      const take = () => { const v = Number(inp.value); if (Number.isFinite(v)) setHeight(Math.max(0, Math.min(ceil, v / 100))); };
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") take(); });
      inp.addEventListener("change", guard(take));
      cmRow.append(inp, d("span", null, "cm above the floor"));
      S.appendChild(cmRow);
      // Which way it shines.
      S.appendChild(d("div", "la3d-sec", "Which way it shines"));
      const faceRow = d("div", "la3d-chips");
      for (const [k, label] of RUNS.FACE_NAMES) {
        const b = btn(label, label, () => { setRun({ ...run, face: k }); sheet(); });
        b.setAttribute("aria-pressed", String(run.face === k));
        faceRow.appendChild(b);
      }
      S.appendChild(faceRow);
      if (stringy()) {
        S.appendChild(d("div", "la3d-sec", "String lights"));
        const sag = d("label", "la3d-row"), r = d("input"), val = d("b", null, RUNS.cm(run.sag_m ?? RUNS.SAG_M));
        r.type = "range"; r.min = "0"; r.max = String(RUNS.SAG_MAX_M); r.step = "0.01"; r.value = String(run.sag_m ?? RUNS.SAG_M);
        r.setAttribute("aria-label", "Swag");
        let g = null;
        r.addEventListener("pointerdown", () => { g = `sag:${++dragGen}`; });
        r.addEventListener("input", guard(() => { val.textContent = RUNS.cm(Number(r.value)); const now0 = runOf(sel); if (now0) setRun({ ...now0, sag_m: RUNS.mm(Number(r.value)) }, g || `sag:${++dragGen}`); }));
        sag.append(d("span", null, "Swag"), r, val);
        S.appendChild(sag);
        const sp = d("label", "la3d-cm"), si = d("input");
        si.type = "number"; si.min = "15"; si.max = "200"; si.step = "1"; si.value = String(Math.round((run.spacing_m ?? RUNS.SPACING_M) * 100));
        si.setAttribute("aria-label", "Bulbs every, cm");
        const takeS = () => { const v = Number(si.value); if (!Number.isFinite(v)) return; const now0 = runOf(sel); if (now0) setRun({ ...now0, spacing_m: RUNS.mm(Math.max(15, Math.min(200, v)) / 100) }); sheet(); };
        si.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") takeS(); });
        si.addEventListener("change", guard(takeS));
        sp.append(d("span", null, "A bulb every"), si, d("span", null, "cm"));
        S.appendChild(sp);
      }
      const ends = d("div", "la3d-acts");
      ends.appendChild(seg(ptSel !== null && run.pts.length > 2 ? btn("Delete point", `Delete point ${ptSel + 1}`, () => deletePoint(), "la3d-del") : null,
        btn("Remove run", "Back to where PadSpan guesses (Undo brings it back)", () => removeRun(), "la3d-del")));
      S.appendChild(ends);
    } else if (run) {
      const ends = d("div", "la3d-acts");
      ends.appendChild(seg(btn("Remove run", "Back to where PadSpan guesses", () => removeRun(), "la3d-del")));
      S.appendChild(ends);
    }
    S.classList.add("on");
    return true;
  }
  /** The underside of a piece hung up off the floor (a wall cabinet, a shelf)
   *  over or beside point q, or null. */
  function cabinetOver(F, q){
    let best = null;
    for (const p of Object.values((cur() || {}).pieces || {})) {
      const z = typeof p.z_m === "number" ? p.z_m : 0;
      if (String(p.floor_id) !== String(F.fl.id) || z < 0.3) continue;
      const s = sizeOf(p), l = RUNS.onPieceFrame(p, [q[0], q[1], 0]);
      if (Math.abs(l[0]) > s.w / 2 + 0.3 || Math.abs(l[1]) > s.d / 2 + 0.3) continue;
      if (best === null || Math.abs(z - q[2]) < Math.abs(best - q[2])) best = z;
    }
    return best;
  }
  /** "Lights to lay out": strips and string lights with no run first. */
  function listOf(S){
    S.appendChild(d("p", "la3d-sub", "Tap a light in Live Aboard, or pick one here."));
    const all = ctx.lights().filter(L => L.F.group.visible);
    const want = (L) => RUNS.STRIP_KINDS.has(kindOf(L.eid)) && !runOf(L.eid);
    const gone = (L) => !!runOf(L.eid) && !placedOf(L.eid);
    const first = all.filter(L => want(L) || gone(L)), rest = all.filter(L => !first.includes(L));
    const box2 = d("div", "la3d-sl");
    const group = (title, list) => {
      if (!list.length) return;
      box2.appendChild(d("h5", null, title));
      for (const L of list) {
        const b = btn("", `Lay out ${L.label}`, () => select(L.eid));
        b.dataset.eid = L.eid;
        b.appendChild(document.createTextNode(L.label));
        const kn = (HOUSE.LIGHT_KINDS.find(([k]) => k === kindOf(L.eid)) || [0, "Just its light"])[1];
        b.appendChild(d("small", null, `${kn} · ${gone(L) ? "its piece is gone: lay it out again" : runOf(L.eid) ? "laid out" : "not laid out yet"} · ${L.F.fl.name || L.F.fl.id}`));
        box2.appendChild(b);
      }
    };
    group("Lights to lay out", first);
    group("All the others", rest);
    if (!all.length) box2.appendChild(d("p", "la3d-sub", "No lights on the floors showing."));
    S.appendChild(box2);
  }

  // ── on screen: the run, its points and handles, the length ────────────────
  function shownRun(){
    if (!sel) return null;
    const I = info();
    if (!I) return null;
    if (drawing) {
      const pts = drawPts();
      return { F: I.F, pts, loop: false, gaps: null, drawing: true };
    }
    const pl = placedOf(sel);
    return pl ? { F: I.F, pts: pl.pts, loop: pl.loop, gaps: pl.gaps, drawing: false } : null;
  }
  /** The points drawn so far (and the drag under way). */
  function drawPts(){
    if (!drawing) return [];
    const anchors = [...drawing.anchors];
    if (gesture && gesture.kind === "draw") anchors.push(...gesture.path());
    const r = anchors.length >= 2 ? runFrom(anchors, "room") : null;
    if (r && r.run) return RUNS.placed(r.run, (cur() || {}).pieces) ? RUNS.placed(r.run, (cur() || {}).pieces).pts : [];
    return anchors.map(a => (a.kind === "piece" ? RUNS.piecePoint(pieceOf(a.id), a.q) : [a.x, a.y, a.h]));
  }
  function paint(){
    ensureMarks();
    const s = shownNow && ctx.active() ? shownRun() : null;
    if (s && s.pts.length) markRun(s.F, s.pts, s.loop, s.drawing ? COL.draw : COL.run, s.gaps);
    else mark.count = 0;
    mark.visible = !!(s && s.pts.length);
    const g = gesture;
    corner.visible = false; dash.visible = false;
    if (g && g.kind === "draw" && g.cornerAt) {
      const [a, b] = g.cornerAt, F = drawing.F;
      _m.fromArray(RUNS.boxMatrix(a, b, 0.025));
      _m.elements[13] += F.fl.elev;
      corner.matrix.copy(_m); corner.matrixWorldNeedsUpdate = true; corner.visible = true;
    }
    if (g && g.kind === "height" && g.at) {
      const F = info().F;
      dash.position.set(g.at[0], F.fl.elev, g.at[1]);
      dash.scale.set(1, Math.max(0.01, g.at[2]), 1);
      dash.computeLineDistances();
      dashMat.dashSize = 0.06 / Math.max(0.01, g.at[2]); dashMat.gapSize = 0.05 / Math.max(0.01, g.at[2]);
      dash.visible = true;
    }
    layout();
    ctx.render();
  }
  function layout(){
    const on = shownNow && ctx.active();
    const r0 = root.getBoundingClientRect(), off = (p) => [p[0] - r0.left - (root.clientLeft || 0), p[1] - r0.top - (root.clientTop || 0)];
    const put = (e, p) => { if (!p) { e.style.display = "none"; return; } const q = off(p); e.style.display = "block"; e.style.left = `${q[0]}px`; e.style.top = `${q[1]}px`; };
    const s = on ? shownRun() : null, hs = on ? handles(s) : null;
    const pts = hs ? hs.points : [];
    pts.forEach((h, j) => dot(j));
    dots.forEach((e, j) => { const h = pts[j]; put(e, h ? h.p : null); e.classList.toggle("on", !!h && ptSel === h.i); });
    put(hMid, hs && hs.mid ? hs.mid.p : null);
    hEnds.forEach((e, k) => put(e, hs && hs.ends[k] ? hs.ends[k].p : null));
    const I = on && sel ? info() : null;
    put(ring, I && !s && I.at ? screenAt(I.F, I.at.x, I.at.z, I.at.y - I.F.fl.elev) : null);
    // The length, beside the run's middle (while drawing: by its moving end).
    if (s && s.pts.length >= 2) {
      const len = RUNS.lengthOf(s.pts, s.loop), q = s.drawing ? s.pts[s.pts.length - 1] : s.pts[Math.floor((s.pts.length - 1) / 2)];
      lenPill.textContent = RUNS.metres(len);
      const p = screenAt(s.F, q[0], q[1], q[2]);
      put(lenPill, p ? [p[0], p[1] - 30] : null);
    } else put(lenPill, null);
    const g = gesture;
    if (g && g.kind === "draw" && g.cornerAt && g.cornerLen > 0.005) {
      const [a, b] = g.cornerAt, F = drawing.F;
      cornerPill.textContent = `${RUNS.metres(g.cornerLen)} to the corner`;
      put(cornerPill, screenAt(F, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2] + 0.1));
    } else put(cornerPill, null);
    if (g && g.kind === "height" && g.at) {
      hPill.textContent = `${RUNS.cm(g.at[2])}${g.snap ? ` · ${g.snap}` : ""}`;
      const F = info().F, p = screenAt(F, g.at[0], g.at[1], g.at[2]);
      put(hPill, p ? [p[0] + 70, p[1]] : null);
    } else put(hPill, null);
  }
  /** Where the handles are on screen now: each point, the middle's height
   *  handle, and (an open run) a tilt handle above each end. */
  function handles(s){
    if (!s || s.drawing || s.pts.length < 2) return null;
    const pts = s.pts.map((q, i) => ({ i, q, p: screenAt(s.F, q[0], q[1], q[2]) }));
    const st = RUNS.stretches(s.pts, s.loop), tot = RUNS.lengthOf(s.pts, s.loop);
    let acc = 0, mid = null;
    for (const q of st) {
      const L = RUNS.lengthOf([q.a, q.b], false);
      if (acc + L >= tot / 2 && L > 0) {
        const f = (tot / 2 - acc) / L, m = [q.a[0] + (q.b[0] - q.a[0]) * f, q.a[1] + (q.b[1] - q.a[1]) * f, q.a[2] + (q.b[2] - q.a[2]) * f];
        mid = { q: m, p: screenAt(s.F, m[0], m[1], m[2] + 0.12) };
        break;
      }
      acc += L;
    }
    const ends = s.loop ? [] : [0, s.pts.length - 1].map(i => { const q = s.pts[i]; const p = screenAt(s.F, q[0], q[1], q[2]); return p ? { i, q, p: [p[0], p[1] - 30] } : null; });
    return { points: pts.filter(x => x.p), mid: mid && mid.p ? mid : null, ends };
  }

  // ── presses (the editor hands them over while the tool is on) ─────────────
  function down(e){
    const x = e.clientX, y = e.clientY, k = kindOfPtr(e);
    rayAt(x, y);
    burst = null;
    const I = info();
    // A handle or a point of the picked run.
    const s = shownRun(), hs = handles(s);
    if (hs && I) {
      const near = (p) => p && Math.hypot(p[0] - x, p[1] - y) <= GRAB[k];
      const pl = placedOf(sel);
      const heightGesture = (idx, q) => {
        gesture = { kind: "height", idx, x0: x, y0: y, run0: runOf(sel), pl0: pl, at: q.slice(), q0: q.slice(), group: `strip-h:${++dragGen}`, moved: false };
        gesture.h0 = heightUnder(gesture, x, y);                       // where it was pressed: the run moves by as much as the pointer
        return "drag";
      };
      if (hs.mid && near(hs.mid.p)) return heightGesture(null, hs.mid.q);
      for (const en of hs.ends) if (en && near(en.p)) { ptSel = en.i; return heightGesture(en.i, en.q); }
      const pt = hs.points.find(h => near(h.p));
      if (pt) {
        gesture = { kind: "point", i: pt.i, x0: x, y0: y, run0: runOf(sel), pl0: pl, group: `strip-p:${++dragGen}`, moved: false };
        return "drag";
      }
    }
    if (area) return "tap";
    if (drawing && I) {
      const F = drawing.F, r = rayAt(x, y), w = r ? wallHit(F, r) : null, ph = pieceHit(F, x, y);
      if (ph && (!w || ph.t < w.t)) { gesture = { kind: "tapPiece", ph, x0: x, y0: y }; return "tap"; }
      if (w) {
        const snap = pressHeight(F, w.h, w.x, w.y);
        const start = w.kind === "loop" ? { kind: "loop", Lp: w.Lp, s: w.s, h: snap.h, x: w.x, y: w.y } : { kind: "free", x: w.x, y: w.y, h: snap.h, face: w };
        drawing.h = snap.h;
        let acc = 0, last = w.s;
        gesture = { kind: "draw", w, start, x0: x, y0: y, moved: false, acc: 0, cornerAt: null, cornerLen: 0,
          path(){
            if (!this.moved) return [start];
            if (w.kind === "loop") {
              const loop = w.Lp.loop, P = RUNS.perimeter(loop).P;
              const go = Math.abs(acc) >= P - 0.05 ? Math.sign(acc) * (P - 0.06) : acc;   // all the way round: it closes (finish)
              const end = RUNS.atS(loop, start.s + go);
              return [start, ...midMarks(loop, start.s, go, start.h), { kind: "free", x: end.x, y: end.y, h: start.h }];
            }
            const t = Math.max(0, Math.min(w.L, this.t ?? w.s));
            return [start, { kind: "free", x: w.a[0] + w.u[0] * t, y: w.a[1] + w.u[1] * t, h: start.h }];
          },
          track(x2, y2){
            const r2 = rayAt(x2, y2);
            if (!r2) return;
            const p = onLevel(F, r2, start.h);
            if (!p) return;
            if (w.kind === "loop") {
              const loop = w.Lp.loop, s2 = RUNS.sOf(loop, p[0], p[1]).s;
              acc += RUNS.stepRound(loop, last, s2); last = s2;
              const P = RUNS.perimeter(loop).P;
              acc = Math.max(-P, Math.min(P, acc));
              const now = RUNS.atS(loop, start.s + acc), dir = Math.sign(acc) || 1, toC = RUNS.toCorner(loop, start.s + acc, dir);
              const c = RUNS.atS(loop, start.s + acc + dir * toC);
              this.cornerAt = [[now.x, now.y, start.h], [c.x, c.y, start.h]]; this.cornerLen = toC;
            } else {
              this.t = (p[0] - w.a[0]) * w.u[0] + (p[1] - w.a[1]) * w.u[1];
              const t = Math.max(0, Math.min(w.L, this.t)), dir = this.t >= w.s ? 1 : -1, end = dir > 0 ? w.L : 0;
              const a = [w.a[0] + w.u[0] * t, w.a[1] + w.u[1] * t, start.h], b = [w.a[0] + w.u[0] * end, w.a[1] + w.u[1] * end, start.h];
              this.cornerAt = [a, b]; this.cornerLen = Math.abs(end - t);
            }
          } };
        return "line";
      }
      return "tap";                                               // a free point (a post) on release, or the house turns
    }
    // Tap the run to add a point there.
    if (s && !s.drawing && onRunPx(s, x, y) <= ON_RUN[k]) { gesture = { kind: "tapRun", x0: x, y0: y }; return "tap"; }
    const hit = ctx.pick(x, y);
    const dev = hit && [hit.hit, ...(hit.under || [])].find(t => t && t.kind === "device" && ctx.device(t.eid) && ctx.device(t.eid).section === "lights");
    if (dev) { gesture = { kind: "tapLight", eid: dev.eid }; return "tap"; }
    return null;
  }
  /** The height a press on a wall starts a run at: near the ceiling, its
   *  edge (a cove); near the floor, the toe-kick; else snapped as a drag is. */
  function pressHeight(F, h, x, y){
    const ceil = ceilOf(F), c = RUNS.chips(ceil);
    if (h >= ceil - 0.12) return { h: c[5][2], snap: c[5][1] };
    if (h <= 0.16) return { h: c[0][2], snap: c[0][1] };
    return RUNS.snapHeight(h, ceil, edgesNear(F, x, y));
  }
  /** The height under the pointer on the upright plane through a height
   *  handle's point, square to the view (null: none). */
  function heightUnder(g, x, y){
    const I = info(), r = rayAt(x, y);
    if (!I || !r) return null;
    const nx = r.direction.x, nz = r.direction.z, L = Math.hypot(nx, nz) || 1;
    plane.set(new THREE.Vector3(nx / L, 0, nz / L), -(g.q0[0] * nx / L + g.q0[1] * nz / L));
    return r.intersectPlane(plane, _v) ? _v.y - I.F.fl.elev : null;
  }
  // The corners a drag passes on the way round (as loop anchors at its height).
  function midMarks(loop, s0, acc, h){
    const path = RUNS.pathAlong(loop, s0, s0 + acc);
    return path.slice(1, -1).map(p => { const q = RUNS.sOf(loop, p[0], p[1]); return { kind: "free", x: p[0], y: p[1], h, s: q.s }; });
  }
  function onRunPx(s, x, y){
    let best = Infinity;
    for (const q of RUNS.stretches(s.pts, s.loop)) {
      const a = screenAt(s.F, q.a[0], q.a[1], q.a[2]), b = screenAt(s.F, q.b[0], q.b[1], q.b[2]);
      if (a && b) best = Math.min(best, segDist([x, y], a, b));
    }
    return best;
  }
  function move(e){
    const g = gesture;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= SLOP) return;
    g.moved = true;
    if (g.kind === "draw") { g.track(e.clientX, e.clientY); paint(); return; }
    if (g.kind === "height") {
      const I = info(), hNow = heightUnder(g, e.clientX, e.clientY);
      if (!I || hNow === null || g.h0 === null) return;
      const want = g.q0[2] + (hNow - g.h0), sn = RUNS.snapHeight(want, ceilOf(I.F), edgesNear(I.F, g.q0[0], g.q0[1]));
      const run = RUNS.raised(g.run0, sn.h - g.q0[2], g.idx, g.run0.piece ? RUNS.HEIGHT_MAX_M : ceilOf(I.F));
      g.at = [g.q0[0], g.q0[1], sn.h]; g.snap = sn.snap;
      if (run) setRun(run, g.group); else setRun(g.run0, g.group);
      paint();
      return;
    }
    if (g.kind === "point") {
      const I = info(), r = rayAt(e.clientX, e.clientY);
      if (!I || !r) return;
      const q0 = g.pl0.pts[g.i], p = onLevel(I.F, r, q0[2]);
      if (!p) return;
      // Onto the wall of a room when near one.
      let at = p;
      for (const Lp of loopsOf(I.F)) { const n = RUNS.sOf(Lp.loop, p[0], p[1]); if (n.d < 0.2) { const a = RUNS.atS(Lp.loop, n.s); at = [a.x, a.y]; break; } }
      const abs = [at[0], at[1], q0[2]], run0 = g.run0;
      const q = run0.piece ? RUNS.onPieceFrame(pieceOf(run0.piece), abs) : abs.map(RUNS.mm);
      const pts = run0.pts.map((x, i) => (i === g.i ? q : x));
      if (!RUNS.problem({ ...run0, pts })) setRun({ ...run0, pts }, g.group);
      paint();
    }
  }
  function up(e){
    const g = gesture;
    gesture = null;
    if (!g) { paint(); return; }
    if (g.kind === "draw") {
      if (!g.moved) { addAnchor(g.start); paint(); return; }
      finish([...drawing.anchors, ...g.path()]);
      return;
    }
    if (g.kind === "height") { ctx.redraw(); if (g.moved) ctx.hint(`${g.idx === null ? "All of it" : `Point ${g.idx + 1}`} at ${RUNS.cm(g.at[2])}${g.snap ? ` (${g.snap})` : ""}.`); sheet(); }
    else if (g.kind === "point") { if (!g.moved) { ptSel = ptSel === g.i ? null : g.i; ctx.hint(ptSel === null ? "" : `Point ${g.i + 1}: drag it, set its height, or delete it.`); } ctx.redraw(); sheet(); }
    paint();
    void e;
  }
  function addAnchor(a){
    if (!drawing) return;
    const t = performance.now();
    drawing.anchors.push(a);
    // Two taps quick and in one place: the second is the end, not a point of its own.
    const prev = drawing.anchors[drawing.anchors.length - 2];
    const two = lastTap && t - lastTap.t <= TAP2_MS && prev && Math.hypot(prev.x - a.x, prev.y - a.y) < 0.3;
    lastTap = { t };
    if (two) {
      drawing.anchors.pop();
      finish(drawing.anchors);
      return;
    }
    const n = drawing.anchors.length;
    ctx.hint(n === 1 ? "Now the next point. Double-tap or Done ends it." : `${n} points. Double-tap or Done ends it.`);
    sheet();
  }
  function tap(e){
    const g = gesture;
    gesture = null;
    const x = e.clientX, y = e.clientY, I = info();
    if (area && I) {
      const F = I.F, r = rayAt(x, y);
      if (area === "under" || area === "behind" || area === "top") {
        const ph = pieceHit(F, x, y);
        if (!ph) { ctx.hint("Tap a piece of furniture on this floor.", true); return; }
        roundPiece(ph.id, area);
      } else {
        const p = r ? onLevel(F, r, 0) : null, room = p ? F.rooms.find(q => HOUSE.inPoly(p[0], p[1], q.pts)) : null;
        if (!room) { ctx.hint(area === "rail" ? "Tap the deck." : "Tap inside a room on this floor.", true); return; }
        if (area === "rail") alongRail(F, room); else roundRoom(F, room);
      }
      area = null;
      sheet(); paint();
      return;
    }
    if (g && g.kind === "tapLight") { select(g.eid); ctx.hint(runOf(g.eid) ? "Drag a point or a handle, or pick from the panel." : "Draw its run, or pick an area in the panel."); return; }
    if (g && g.kind === "tapPiece" && drawing) {
      const s = sizeOf(g.ph.p);
      addAnchor({ kind: "piece", id: g.ph.id, q: RUNS.nearestBoxEdge(g.ph.q, s), x: g.ph.p.x_m, y: g.ph.p.y_m });
      paint();
      return;
    }
    if (drawing && I) {                                          // a free point, at the height chosen
      const r = rayAt(x, y), p = r ? onLevel(drawing.F, r, drawing.h) : null;
      if (!p) return;
      // Near a deck's rail: on its top.
      for (const P of drawing.F.pieces) {
        const pc = P.pc;
        if (pc.kind !== "rail") continue;
        const L = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0) || 1, t = Math.max(0, Math.min(L, ((p[0] - pc.x0) * (pc.x1 - pc.x0) + (p[1] - pc.y0) * (pc.y1 - pc.y0)) / L));
        const q = [pc.x0 + (pc.x1 - pc.x0) * t / L, pc.y0 + (pc.y1 - pc.y0) * t / L];
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3) { addAnchor({ kind: "free", x: q[0], y: q[1], h: RUNS.RAIL_TOP_M }); paint(); return; }
      }
      // Near a room's wall (seen from above): on it.
      for (const Lp of loopsOf(drawing.F)) {
        const n = RUNS.sOf(Lp.loop, p[0], p[1]);
        if (n.d < 0.25) { const a = RUNS.atS(Lp.loop, n.s); addAnchor({ kind: "loop", Lp, s: n.s, h: drawing.h, x: a.x, y: a.y }); paint(); return; }
      }
      addAnchor({ kind: "free", x: p[0], y: p[1], h: drawing.h });
      paint();
      return;
    }
    if (g && g.kind === "tapRun") { insertAt(x, y); return; }
  }
  /** A tap on the run: a point there (on the stretch nearest on screen). */
  function insertAt(x, y){
    const s = shownRun(), run = runOf(sel);
    if (!s || !run || run.pts.length >= RUNS.PTS_MAX) return;
    let best = null;
    for (const q of RUNS.stretches(s.pts, s.loop)) {
      const a = screenAt(s.F, q.a[0], q.a[1], q.a[2]), b = screenAt(s.F, q.b[0], q.b[1], q.b[2]);
      if (!a || !b) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, f = L2 ? Math.max(0.05, Math.min(0.95, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0.5;
      const dd = segDist([x, y], a, b);
      if (!best || dd < best.d) best = { d: dd, q, f };
    }
    if (!best) return;
    const i = best.q.i, A = run.pts[i], B = run.pts[(i + 1) % run.pts.length], f = best.f;
    const np = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f].map(RUNS.mm);
    const pts = [...run.pts.slice(0, i + 1), np, ...run.pts.slice(i + 1)];
    const gaps = (run.gaps || []).flatMap(g => (g < i ? [g] : g === i ? [i, i + 1] : [g + 1]));
    const r = RUNS.tidy({ ...run, pts, gaps });
    if (r.error) { ctx.hint(r.error, true); return; }
    setRun(r.run);
    ptSel = i + 1;
    ctx.hint(`Point ${i + 2} added: drag it.`);
    sheet(); paint();
  }
  function cancel(){ gesture = null; paint(); }
  function hover(e){
    const s = shownRun(), hs = handles(s), x = e.clientX, y = e.clientY;
    if (hs && ([hs.mid, ...hs.ends].some(h => h && Math.hypot(h.p[0] - x, h.p[1] - y) <= GRAB.mouse))) return "ns-resize";
    if (hs && hs.points.some(h => Math.hypot(h.p[0] - x, h.p[1] - y) <= GRAB.mouse)) return "grab";
    if (drawing || area) return "crosshair";
    if (s && onRunPx(s, x, y) <= ON_RUN.mouse) return "copy";
    return "";
  }

  // ── keys: ↑/↓ 1 cm, Shift 10 cm ───────────────────────────────────────────
  const onKey = guard((e) => {
    if (!shownNow || !sel || !ctx.active() || gesture || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
    if (t && (/^(input|textarea|select)$/i.test(String(t.tagName || t.localName || "")) || t.isContentEditable)) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" || !runOf(sel)) return;
    e.preventDefault();
    const now = performance.now();
    if (!burst || now - burst.t > 900) burst = { g: `strip-key:${++dragGen}` };
    burst.t = now;
    const step = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01);
    if (raiseBy(step, burst.g)) { ctx.hint(`${e.key === "ArrowUp" ? "Up" : "Down"} ${e.shiftKey ? "10 cm" : "1 cm"}.`); sheet(); paint(); }
  });
  let keysOn = false;
  function keys(on){
    if (on === keysOn || typeof document === "undefined") return;
    keysOn = on;
    if (on) document.addEventListener("keydown", onKey); else document.removeEventListener("keydown", onKey);
  }

  return {
    /** The Strip tool on (the editor's tool) or off. */
    show(on){
      on = !!on;
      if (on === shownNow) return;
      shownNow = on;
      keys(on);
      if (!on) { drawing = null; area = null; gesture = null; ptSel = null; ctx.sheet.classList.remove("strip"); }
      paint();
    },
    sheet, down, move, up, tap, cancel, hover, layout, paint,
    /** Pick a light (the harness, and Heights' "Lay it out in Strip"). */
    select: (eid) => select(eid || null),
    /** After Undo, Redo, Discard or a Save: a point no longer there is not picked. */
    refresh(){ const r = sel && runOf(sel); if (ptSel !== null && (!r || ptSel >= r.pts.length)) ptSel = null; gesture = null; if (shownNow) { sheet(); paint(); } },
    get selected(){ return sel; },
    /** For the harness and the tests: draw a run from plan points as taps would. */
    drawPoints(points){
      startDraw();
      if (!drawing) return false;
      for (const [x, y, h] of points) drawing.anchors.push({ kind: "free", x, y, h });
      finish(drawing.anchors);
      return true;
    },
    roundRoomNamed(name){
      const I = info(), room = I && I.F.rooms.find(r => r.name === name);
      if (!room) return false;
      roundRoom(I.F, room); sheet(); paint();
      return true;
    },
    roundPieceId(id, mode){ roundPiece(id, mode); sheet(); paint(); return !!runOf(sel); },
    setHeight: (h) => setHeight(h), setFace: (f) => { const r = runOf(sel); if (r) { setRun({ ...r, face: f }); sheet(); paint(); } },
    raise: (dh) => raiseBy(dh), pickPoint: (i) => { ptSel = i; sheet(); paint(); }, deletePoint: () => deletePoint(), removeRun: () => removeRun(),
    setOpts: (o) => Object.assign(opts, o),
    fold: (on) => { folded = !!on; sheet(); },
    state(){
      const s = shownNow ? shownRun() : null;
      return { shown: shownNow, sel, folded, drawing: drawing ? drawing.anchors.length : null, area, ptSel, gesture: gesture ? gesture.kind : null,
               mark: mark.visible ? mark.count : 0, pulsing, opts: { ...opts }, keys: keysOn,
               pts: s ? s.pts.map(q => q.map(RUNS.mm)) : null, len: s && s.pts.length >= 2 ? RUNS.mm(RUNS.lengthOf(s.pts, s.loop)) : null,
               lenText: lenPill.style.display === "block" ? lenPill.textContent : null,
               cornerText: cornerPill.style.display === "block" ? cornerPill.textContent : null,
               handles: (() => { const hs = handles(s); return hs ? { points: hs.points.length, mid: !!hs.mid, ends: hs.ends.filter(Boolean).length } : null; })() };
    },
    /** A plan point at height h on the picked light's floor, in client px (the harness presses it). */
    whereOf(x, y, h){ const I = info(); return I ? screenAt(I.F, x, y, h) : null; },
    /** Where a handle is on screen (the harness drags it): "mid", "end0", "end1", or a point's number. */
    handleAt(which){
      const hs = handles(shownRun());
      if (!hs) return null;
      if (which === "mid") return hs.mid ? hs.mid.p : null;
      if (which === "end0" || which === "end1") { const e = hs.ends[which === "end0" ? 0 : 1]; return e ? e.p : null; }
      const p = hs.points.find(h => h.i === which);
      return p ? p.p : null;
    },
    dispose(){
      keys(false);
      for (const o of [mark, corner, dash]) if (o.parent) o.parent.remove(o);
      box.dispose(); markMat.dispose(); cornerMat.dispose(); dashGeo.dispose(); dashMat.dispose(); mark.dispose();
      for (const e of [...dots, hMid, ...hEnds, ring, lenPill, cornerPill, hPill, style]) e.remove();
    },
  };
}
