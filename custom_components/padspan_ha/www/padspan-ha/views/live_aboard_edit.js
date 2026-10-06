// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the 3D editor, in
// the 3D view (P1 part C). Only for the people who may place lights: the
// host hands the view its `edit` only then (maps.js, the same gate as light
// placement), and the server holds the same gate (ws_house3d.house3d_edit).
//
// Edit opens three tools — Door, Window and Heights — with Undo, Redo, Save
// and Discard. Nothing is stored until Save, which sends the draft's
// changes in one command; leaving with unsaved changes asks first, here in
// the view (never a browser dialog).
//
//   Door, Window  a line drawn on a wall (live_aboard_draft.js has the
//                 rules): press on a wall and drag along it, or tap its two
//                 ends. It stays on that wall, stops at a corner and at any
//                 door or window already there, and shows its length as it
//                 goes; on release it is the opening. It draws on the floor
//                 the stepper or the floor chips picked, any floor; with
//                 All, on the floor whose wall is under the pointer. Picking
//                 the tool turns the camera straight down on that floor (with
//                 All, the top one showing), so drawing is tracing the plan
//                 (it works in 3D as well). Then
//                 drag either end, set the heights, switch door ↔ window,
//                 hinge and swing, or Delete.
//   Heights       tap a light, a sensor or a readout: a height from its floor
//                 to the ceiling, or back to its default; for a light, also
//                 what it is ("What is this?": a pot, a valance, a lamp...),
//                 or PadSpan's guess. (Scanners keep the height the map gives
//                 them: presence uses it.)
//   a door or window from the map (a barrier): tap it to set its hinge and
//                 swing, or its sill and head, in 3D only.
//   Doorway       drawn like a door: an opening with no door in it (an
//                 archway, an open plan). A door with no sensor stands ajar
//                 inside and shut on an outside wall; its sheet's "Shown"
//                 sets it open, ajar or shut (one with a sensor follows it).
//                 Its Type ▾ (PadSpan's guess until one is picked: hinged,
//                 double, sliding, barn, pocket, bifold, overhead garage,
//                 roll-up, tilt-up or a gate) with only that type's options,
//                 and Follows: a door or garage sensor, or a cover whose
//                 position it follows (a cover's door never moves on a tap).
//
// One finger (or the left button) draws while a tool is on; two fingers
// still pan and zoom. The draft, the tool and what is picked live in the
// view's long-lived slot, so the Atlas's 5 s rebuild never touches them.
// Everything three.js is handed in (ctx.THREE): this file imports nothing.

const SLOP = 6;                                   // px a press may move and still be a tap
const REACH = { mouse: 22, touch: 30 };           // how near a wall a press must land (px)
const GRAB = { mouse: 16, touch: 26 };            // how near an end a press must land to drag it (px)
const PICK_OPENING = 8;                           // px round an opening's own outline
const COL = { window: "#60a5fa", door: "#f59e0b", doorway: "#c084fc", stop: "#ef4444", map: "#a3e635", arc: "#fbbf24" };
// What each kind drawn on a wall is called, and the words for drawing one.
const NAME = { door: "Door", window: "Window", doorway: "Doorway" };
const DRAW_HINT = "Door, Window or Doorway: draw along a wall. Heights: tap a device. Tap a door or window to change it.";
const FEW = (n) => `${n} change${n === 1 ? "" : "s"}`;
// The server's refusals (ws_house3d.py), said plainly. The house still draws
// from the map, and a refused Save keeps the draft, to be saved again.
const CANT_EDIT = {
  read_failed: "Can't edit: Live Aboard's file couldn't be read (nothing in it was changed). Show Map, then Live Aboard, to try again.",
  house3d_newer: "Can't edit: a newer PadSpan saved Live Aboard's file, and this version never changes it. Update PadSpan to edit it.",
};
const NOT_SAVED = {
  read_failed: "Not saved: Live Aboard's file couldn't be read, so nothing was changed. Your changes are still here: Save to try again.",
  save_failed: "Not saved: Live Aboard's file couldn't be written, so nothing was changed. Your changes are still here: Save to try again.",
  house3d_newer: "Not saved: a newer PadSpan saved Live Aboard's file, and this version never changes it. Update PadSpan to save these changes.",
};

const CSS = `
.la3d-editseg button[aria-pressed="true"]{background:rgba(245,176,65,.28)!important;color:#fff7e6!important}
.la3d-tools{position:absolute;left:72px;right:10px;top:10px;z-index:4;display:none;flex-wrap:wrap;gap:6px;align-items:center;pointer-events:none}
.la3d-tools.on{display:flex}
.la3d-tools > *{pointer-events:auto}
.la3d .la3d-tools button:disabled{opacity:.38;cursor:default}
.la3d-tools .la3d-save{color:#06210f!important;background:#52b788!important;font-weight:700}
.la3d-tools .la3d-save:disabled{background:rgba(82,183,136,.25)!important;color:#cfe9da!important}
.la3d-hint{flex-basis:100%;font-size:12px;line-height:1.35;color:#d6e6dc;text-shadow:0 1px 3px #000;pointer-events:none}
.la3d-hint.bad{color:#fca5a5}
.la3d-editwhy{align-self:center;padding:0 8px;font-size:11px;line-height:1.3;color:#fde2e2;max-width:300px;white-space:normal}
.la3d-sheet{position:absolute;right:10px;z-index:4;display:none;box-sizing:border-box;width:min(300px,calc(100% - 20px));
  padding:10px 12px 12px;border-radius:12px;background:rgba(6,14,9,.95);border:1px solid rgba(120,190,155,.26);
  color:#e8f0ea;font-size:12.5px;box-shadow:0 8px 22px rgba(0,0,0,.5)}
.la3d-sheet.on{display:block}
.la3d-sheet.busy{opacity:.55}
.la3d-sheet h4{margin:0 0 2px;font-size:13.5px;font-weight:700;color:#f3f6f4;display:flex;gap:8px;align-items:center}
.la3d-sheet h4 span{flex:1}
.la3d-sheet .la3d-sub{margin:0 0 8px;color:rgba(226,240,232,.6);font-size:11.5px}
.la3d-sheet .la3d-row{display:grid;grid-template-columns:52px 1fr 54px;gap:8px;align-items:center;margin:6px 0}
.la3d-sheet .la3d-row b{text-align:right;font-variant-numeric:tabular-nums}
.la3d-sheet input[type=range]{width:100%;margin:0;accent-color:#52b788}
.la3d-sheet .la3d-row.la3d-kind{grid-template-columns:auto 1fr}
.la3d-sheet select{width:100%;min-width:0;box-sizing:border-box;padding:5px 6px;border-radius:8px;font:inherit;
  background:#0b1410;color:#e8f0ea;border:1px solid rgba(120,190,155,.35)}
.la3d-sheet .la3d-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.la3d-sheet .lv-zoomseg{box-shadow:none}
.la3d-sheet button.la3d-x{all:unset;cursor:pointer;padding:0 4px;font-size:16px;color:rgba(226,240,232,.6)}
.la3d-sheet .la3d-del{color:#fca5a5!important}
.la3d-ask{position:absolute;inset:0;z-index:7;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.46)}
.la3d-ask.on{display:flex}
.la3d-ask > div{max-width:calc(100% - 40px);padding:14px 16px;border-radius:14px;background:#0b1410;border:1px solid rgba(120,190,155,.3);
  color:#e8f0ea;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.6)}
.la3d-ask p{margin:0 0 10px}
.la3d-len{position:absolute;z-index:3;display:none;transform:translate(-50%,-50%);padding:3px 9px;border-radius:999px;
  background:rgba(6,14,9,.92);border:1px solid rgba(255,255,255,.3);color:#fff;font:700 12px system-ui,sans-serif;
  white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}
.la3d-len.bad{border-color:#ef4444;color:#fecaca}
.la3d-dot{position:absolute;z-index:3;display:none;box-sizing:border-box;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;
  border:2px solid #fff;background:#3b82f6;box-shadow:0 0 0 3px rgba(0,0,0,.35);pointer-events:none}
.la3d-dot.stop{background:#ef4444}
.la3d-dot.ring{background:transparent;border:3px solid #fbbf24;width:34px;height:34px;margin:-17px 0 0 -17px}`;

/**
 * ctx = {
 *   THREE, HOUSE (live_aboard_house.js), DRAFT (live_aboard_draft.js)
 *   root, canvas, bar          the view's element, its canvas, its bottom bar
 *   camera(), scene()          the view's own
 *   floors()                   the floors as drawn: {fl, group, rooms, pieces: [{pc, els, cut}]}
 *   shellGen()                 a number that moves whenever the walls are rebuilt
 *   pick(x, y)                 the view's own picking ({hit: {kind, eid, …}} | null)
 *   blocked(v, own)            is world point v hidden (under a floor, behind a wall)? own: its "meshId:i" keys
 *   device(eid)                {section, label, F, z, zDefault, at} | null: a drawn device
 *   file()                     the 3D file as the editor owns it (DRAFT.ownedOf), or null unread
 *   reload()                   → Promise<boolean>: read the file again
 *   saved(data)                the file as the server now holds it
 *   problem()                  why the file cannot be edited ({code: "read_failed" | "house3d_newer"}), or null
 *   newer()                    a Save was refused as a newer PadSpan's file: problem() says so until
 *                              a read finds the file this version's
 *   redraw()                   draw the house again, from the draft while editing
 *   preview(t)                 a slider being dragged: move only what it moves, {opening: id} or
 *                              {eid}, in place from the draft (false: not drawn, redraw instead)
 *   render()                   ask for a frame
 *   topDown(F)                 the camera straight down on floor F
 *   selected()                 the floor ids the stepper or the floor chips picked (a Set), or null: All
 *   clearUse()                 the Atlas's hover box and rings off
 *   guard(fn)                  fn, any throw puts the flat Atlas back
 * }
 */
export function createEditor(ctx){
  const { THREE, HOUSE, DRAFT, root, canvas, bar, guard } = ctx;
  let editFn = null, editing = false, draft = null, tool = null, sel = null, gesture = null, pending = null;
  let saving = false, afterSave = null, askGo = null, hintMsg = "", hintBad = false, redrawDue = false, sliderGen = 0, sheetRefresh = null;
  let moveDue = null, sliding = null;        // a slider being dragged: what it moves, drawn in place once a frame
  let resheet = false;                       // a light's kind changed: its sheet again once it is drawn as it
  let furnishOn = false;                     // Mapping → Furnish: Edit opens at the furniture tool (P2)
  let runsGen = null, arcsGen = null;
  const runsByFloor = new Map();
  const active = () => editing && !!editFn && !!draft;

  // ── the page ──────────────────────────────────────────────────────────────
  const d = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const btn = (text, title, act, cls) => {
    const b = d("button", cls, text);
    b.type = "button"; b.title = title;
    b.addEventListener("click", guard((e) => { e.stopPropagation(); act(); }));
    return b;
  };
  const seg = (...items) => { const s = d("span", "lv-zoomseg"); for (const b of items) s.appendChild(b); return s; };
  const style = d("style");
  style.textContent = CSS;
  root.appendChild(style);
  const bEdit = btn("Edit", "Draw doors and windows, set heights", () => (editing ? finish() : begin(furnishOn ? "furnish" : null)));
  const editWhy = d("span", "la3d-editwhy");                   // why Edit is unavailable, said in the page
  editWhy.id = `la3d-editwhy-${Math.random().toString(36).slice(2, 8)}`;
  const editSeg = seg(bEdit, editWhy);
  editSeg.classList.add("la3d-editseg");
  editSeg.style.cssText = "display:none;margin-left:auto";      // beside the view buttons, on the right
  const viewsSeg = bar.querySelector("[data-la3d-views]");          // in the bar's right-hand group
  (viewsSeg && viewsSeg.parentNode ? viewsSeg.parentNode : bar).insertBefore(editSeg, viewsSeg || null);
  const bDoor = btn("Door", "Draw a door along a wall", () => pickTool("door"));
  const bWin = btn("Window", "Draw a window along a wall", () => pickTool("window"));
  const bWay = btn("Doorway", "Draw a doorway along a wall: an opening with no door in it", () => pickTool("doorway"));
  const bHts = btn("Heights", "Tap a light, a sensor or a readout to set its height (a light: also what it is)", () => pickTool("heights"));
  const bStrip = ctx.STRIP && ctx.RUNS ? btn("Strip", "Lay out an LED strip or string lights: where it really goes, how high, which way it shines", () => pickTool("strip")) : null;
  const bUndo = btn("Undo", "Undo", () => { if (draft && !saving && draft.undo()) afterHistory("Undone."); });
  const bRedo = btn("Redo", "Redo", () => { if (draft && !saving && draft.redo()) afterHistory("Redone."); });
  const bSave = btn("Save", "Save the changes", () => save(null), "la3d-save");
  const bDiscard = btn("Discard", "Back to what is saved (Undo brings it back)", () => discard());
  const tools = d("div", "la3d-tools");
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "Live Aboard editor");
  const hintEl = d("div", "la3d-hint");
  hintEl.setAttribute("aria-live", "polite");
  const toolSeg = seg(bDoor, bWin, bHts, ...(bStrip ? [bStrip] : []));
  toolSeg.insertBefore(bWay, bWin.nextSibling);
  tools.append(toolSeg, seg(bUndo, bRedo), seg(bSave, bDiscard), hintEl);
  root.appendChild(tools);
  const sheet = d("div", "la3d-sheet");
  root.appendChild(sheet);
  const askEl = d("div", "la3d-ask");
  root.appendChild(askEl);
  const lenEl = d("div", "la3d-len");
  const ends = [d("div", "la3d-dot"), d("div", "la3d-dot")];
  const ring = d("div", "la3d-dot ring");
  root.append(lenEl, ends[0], ends[1], ring);
  // Furniture (P2 Furnish, live_aboard_furnish.js): a tool of its own on this
  // same draft, so one Save writes doors, windows, heights and furniture.
  const FUR_HINT = "Build adds a piece. Drag a piece to move it; tap it to change it.";
  const fur = ctx.FURNISH ? ctx.FURNISH.createFurnish({
    THREE, HOUSE, PIECES: ctx.PIECES, FURN: ctx.FURN, root, guard, tools, sheet, layer: ctx.layer,
    draft: () => draft, active: () => active() && tool === "furnish",
    change: (fn, group, moves) => change(fn, group, moves), redraw: () => redrawSoon(), render: () => ctx.render(),
    hint: (text, bad) => hint(text, bad), floors: () => ctx.floors(), topFloor: () => currentFloor(),
    setTopFloor: (fid) => ctx.setTopFloor(fid), viewAt: (x, y) => ctx.viewAt(x, y), centre: () => ctx.centre(),
    host: () => ctx.host(), base: ctx.base || "", paintEditor: () => paint(),
    STOREY: ctx.STOREY || null,                              // stairs: the floor they reach and their rise
  }) : null;
  const furnishing = () => !!fur && active() && tool === "furnish";
  // The Strip tool (live_aboard_strip.js): a light's run, on this same draft.
  const strip = bStrip ? ctx.STRIP.createStrip({
    THREE, HOUSE, RUNS: ctx.RUNS, root, guard, sheet, layer: ctx.layer,
    draft: () => draft, active: () => active() && tool === "strip",
    change: (fn, group) => change(fn, group), redraw: () => redrawSoon(), render: () => ctx.render(), hint: (text, bad) => hint(text, bad),
    floors: () => ctx.floors(), lights: () => (ctx.lights ? ctx.lights() : []), pick: (x, y) => ctx.pick(x, y),
    device: (eid) => ctx.device(eid), camera: () => ctx.camera(), scene: () => ctx.scene(), rect: () => viewRect(), shellGen: () => ctx.shellGen(),
  }) : null;
  const stripping = () => !!strip && active() && tool === "strip";

  // ── 3D marks: the line, the doors' swings ─────────────────────────────────
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const lineMat = new THREE.MeshBasicMaterial({ color: COL.window, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false });
  const line = new THREE.Mesh(box, lineMat);
  line.matrixAutoUpdate = false; line.renderOrder = 30; line.visible = false; line.frustumCulled = false;
  const arcMat = new THREE.MeshBasicMaterial({ color: COL.arc, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const fillMat = new THREE.MeshBasicMaterial({ color: COL.arc, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  let arcs = [];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane();
  function place(mesh, F, a, b, z0, z1, thick){
    const dx = b[0] - a[0], dy = b[1] - a[1];
    _q.setFromAxisAngle(Y, HOUSE.yawOf([dx, dy]));
    _p.set((a[0] + b[0]) / 2, F.fl.elev + z0, (a[1] + b[1]) / 2);
    _s.set(Math.max(0.02, Math.hypot(dx, dy)), Math.max(0.02, z1 - z0), thick);
    mesh.matrix.compose(_p, _q, _s);
    mesh.matrixWorldNeedsUpdate = true;
  }
  function ensureLine(){ const sc = ctx.scene(); if (sc && line.parent !== sc) sc.add(line); }
  function clearArcs(){
    for (const a of arcs) { if (a.parent) a.parent.remove(a); a.geometry.dispose(); }
    arcs = [];
  }
  // Every door on the floors showing, hinge and swing drawn on its floor as
  // a quarter circle: what a tap on it changes.
  function syncArcs(){
    arcsGen = ctx.shellGen();
    clearArcs();
    if (!active()) return;
    for (const F of ctx.floors()) {
      for (const P of F.pieces) {
        const pc = P.pc, len = Math.hypot(pc.x1 - pc.x0, pc.y1 - pc.y0);
        if (pc.kind !== "door" || len > 1.8 || len < 0.3) continue;
        const sw = HOUSE.openingSwing(pc, F.rooms, pc.override || null);
        const hb = sw.hinge === "b", hx = hb ? pc.x1 : pc.x0, hy = hb ? pc.y1 : pc.y0;
        const ux = ((hb ? pc.x0 : pc.x1) - hx) / len, uy = ((hb ? pc.y0 : pc.y1) - hy) / len;
        const a0 = HOUSE.yawOf([ux, uy]), a1 = HOUSE.yawOf([pc.nx * sw.side, pc.ny * sw.side]);
        let dA = a1 - a0;
        while (dA > Math.PI) dA -= 2 * Math.PI;
        while (dA <= -Math.PI) dA += 2 * Math.PI;
        const from = dA >= 0 ? a0 : a1, sweep = Math.abs(dA);
        const fill = new THREE.RingGeometry(0, len, 28, 1, from, sweep).rotateX(-Math.PI / 2);
        const rim = new THREE.RingGeometry(len - 0.06, len, 28, 1, from, sweep).rotateX(-Math.PI / 2);
        const leaf = new THREE.PlaneGeometry(len, 0.06).rotateX(-Math.PI / 2).translate(len / 2, 0, 0)
          .rotateY(a1);
        for (const [geo, mt] of [[fill, fillMat], [rim, arcMat], [leaf, arcMat]]) {
          const m = new THREE.Mesh(geo, mt);
          m.position.set(hx, F.fl.elev + 0.015, hy);
          m.renderOrder = 6;
          F.group.add(m);
          arcs.push(m);
        }
      }
    }
  }

  // ── where things are ──────────────────────────────────────────────────────
  // The 3D view's part of the canvas (all of it, but beside Furnish's plan).
  const viewRect = () => (ctx.rect ? ctx.rect() : canvas.getBoundingClientRect());
  function rayAt(x, y){
    const r = viewRect(), cam = ctx.camera();
    if (!r.width || !r.height || !cam) return null;
    ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    cam.updateMatrixWorld();
    ray.setFromCamera(ndc, cam);
    return ray.ray;
  }
  /** A plan point at height z above floor F, in client px (or null). */
  function screenAt(F, x, y, z){
    const r = viewRect(), cam = ctx.camera();
    if (!cam || !r.width) return null;
    _v.set(x, F.fl.elev + z, y).project(cam);
    if (!(_v.z > -1 && _v.z < 1)) return null;
    return [r.left + (_v.x + 1) / 2 * r.width, r.top + (1 - _v.y) / 2 * r.height];
  }
  function segPx(px, py, a, b){
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
    return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
  }
  const ceilOf = (F) => F.fl.h - HOUSE.SLAB_T;
  const kindOfPtr = (e) => (e.pointerType === "touch" || e.pointerType === "pen" ? "touch" : "mouse");
  // The runs of a floor's walls (and where a line on each must stop), as
  // drawn now: worked out again whenever the walls are rebuilt, a run's
  // stops only once something is drawn on it.
  function runsOf(F){
    if (runsGen !== ctx.shellGen()) { runsByFloor.clear(); runsGen = ctx.shellGen(); }
    let R = runsByFloor.get(F.fl.id);
    if (!R) {
      const pcs = F.pieces.map(P => P.pc);
      R = DRAFT.wallRuns(pcs).map(run => {
        let stops = null;
        return { run, get stops(){ return stops || (stops = DRAFT.runStops(run, pcs)); }, ops: DRAFT.runOpenings(run) };
      });
      runsByFloor.set(F.fl.id, R);
    }
    return R;
  }
  const visibleFloors = () => ctx.floors().filter(F => F.group.visible);
  /** A floor as drawn, by its id (a door or window's own floor). */
  const floorOf = (fid) => ctx.floors().find(F => F.fl.id === fid) || null;
  /** The floors the line tool draws on: the one the stepper or the floor
   *  chips picked (two at the same height: both), or with All, every indoor
   *  floor showing. Highest first. */
  function drawFloors(){
    const sel = ctx.selected ? ctx.selected() : null;
    const shown = visibleFloors().filter(F => !F.fl.outdoor && F.rooms.length).sort((a, b) => b.fl.elev - a.fl.elev);
    const picked = sel ? shown.filter(F => sel.has(String(F.fl.id))) : [];
    return picked.length ? picked : shown;
  }
  /** The top one of those: the floor the line tool looks down on. */
  function currentFloor(){
    return drawFloors()[0] || null;
  }
  /** t along a run under the pointer: on the wall's own upright plane when
   *  it is seen from the side, else on the level plane it was pressed at. */
  function tAlong(w, x, y){
    const rr = rayAt(x, y);
    if (!rr) return null;
    _v.set(w.run.nx, 0, w.run.ny);
    let hit = null;
    if (Math.abs(rr.direction.dot(_v)) > 0.3) { plane.set(_v.clone(), -w.run.c); hit = rr.intersectPlane(plane, new THREE.Vector3()); }
    if (!hit) { plane.set(Y, -(w.F.fl.elev + w.h)); hit = rr.intersectPlane(plane, new THREE.Vector3()); }
    return hit ? DRAFT.tOn(w.run, hit.x, hit.z) : null;
  }
  /** The wall under the pointer while drawing: the nearest within reach on
   *  screen, on the floors the tool draws on (drawFloors: the floor picked,
   *  or with All, the one whose walls are under the pointer). A floor lower
   *  than the top one there counts only where its wall is in plain view:
   *  from above, its walls show through the floor over them, a little
   *  inside that floor's own, and are never what was meant. */
  function wallAt(x, y, reach){
    const floors = drawFloors();
    if (!floors.length) return null;
    const top = floors[0].fl.elev;
    let best = null;
    for (const F of floors) {
      const near = [];
      for (const P of F.pieces) {
        const pc = P.pc;
        if (pc.kind === "rail") continue;
        const h = P.cut ? HOUSE.CUT_H * 0.6 : Math.min(1.2, ceilOf(F) * 0.45);
        const a = screenAt(F, pc.x0, pc.y0, h), b = screenAt(F, pc.x1, pc.y1, h);
        if (!a || !b) continue;
        const dd = segPx(x, y, a, b);
        if (dd <= reach && (!best || dd < best.d)) near.push({ d: dd, P, h, F, a, b });
      }
      const lower = F.fl.elev < top - 1e-3;
      for (const c of near.sort((p, q) => p.d - q.d).slice(0, lower ? 3 : 1)) {
        if (lower && wallHidden(c, x, y)) continue;
        best = c;
        break;
      }
    }
    if (!best) return null;
    const F = best.F, entry = runsOf(F).find(r => r.run.pcs.includes(best.P.pc));
    if (!entry) return null;
    const w = { F, run: entry.run, stops: entry.stops, ops: entry.ops, h: best.h };
    w.t = tAlong(w, x, y);
    return w.t === null ? null : w;
  }
  /** Is a wall wallAt found hidden where the pointer is on it (under a
   *  floor above, or behind another wall)? Its own parts never hide it. */
  function wallHidden(c, x, y){
    if (!ctx.blocked) return false;
    const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], L2 = dx * dx + dy * dy, pc = c.P.pc;
    const t = L2 ? Math.max(0, Math.min(1, ((x - c.a[0]) * dx + (y - c.a[1]) * dy) / L2)) : 0;
    const v = new THREE.Vector3(pc.x0 + (pc.x1 - pc.x0) * t, c.F.fl.elev + c.h, pc.y0 + (pc.y1 - pc.y0) * t);
    return ctx.blocked(v, new Set(c.P.els.filter(e => e.mesh).map(e => `${e.mesh.id}:${e.i}`)));
  }
  /** A door or window under the pointer (one drawn in 3D, or a barrier's
   *  from the map), by its outline on screen; the nearest wins. While
   *  drawing, only the floors drawn on; one on another floor than the top
   *  one only where nothing hides it (the view's own test: under the floor
   *  above, or behind a wall, it is not there to tap). */
  function openingAt(x, y){
    const cam = ctx.camera(), cur = currentFloor(), drawing = tool === "door" || tool === "window" || tool === "doorway";
    let best = null;
    for (const F of drawing ? drawFloors() : visibleFloors()) {
      for (const P of F.pieces) {
        const pc = P.pc, id = pc.added || (pc.barrier && pc.barrier.id) || null;
        if (!id || (pc.kind !== "door" && pc.kind !== "window" && pc.kind !== "doorway")) continue;
        // A doorway has no leaf: its opening, floor to head, is what a tap finds.
        const leaf = P.els.find(e => e.leaf) || (pc.kind === "doorway" ? { z0: 0, z1: typeof pc.head_m === "number" ? pc.head_m : HOUSE.DOOR_H } : null);
        if (!leaf) continue;
        const z0 = Math.max(0, leaf.z0), z1 = P.cut ? Math.min(leaf.z1, HOUSE.CUT_H) : leaf.z1;
        const q = [[pc.x0, pc.y0, z0], [pc.x1, pc.y1, z0], [pc.x1, pc.y1, z1], [pc.x0, pc.y0, z1]].map(([px, py, z]) => screenAt(F, px, py, z));
        if (!q.every(Boolean)) continue;
        const inside = HOUSE.inPoly(x, y, q) || q.some((a, i) => segPx(x, y, a, q[(i + 1) % 4]) <= PICK_OPENING);
        if (!inside) continue;
        const mid = new THREE.Vector3((pc.x0 + pc.x1) / 2, F.fl.elev + (z0 + z1) / 2, (pc.y0 + pc.y1) / 2);
        // Its own leaf, lintel and sill wall never hide it.
        if (F !== cur && ctx.blocked(mid, new Set(P.els.filter(e => e.mesh).map(e => `${e.mesh.id}:${e.i}`)))) continue;
        const depth = cam.position.distanceTo(mid);
        if (!best || depth < best.depth) best = { depth, F, P, id, added: !!pc.added, kind: pc.kind };
      }
    }
    return best && { id: best.id, added: best.added, kind: best.kind, F: best.F, name: (best.P.pc.barrier && best.P.pc.barrier.name) || null };
  }
  /** Where a 3D opening is drawn now: its floor, piece and run. */
  function addedNow(id){
    for (const F of ctx.floors()) {
      const P = F.pieces.find(q => q.pc.added === id);
      if (!P) continue;
      const entry = runsOf(F).find(r => r.run.pcs.includes(P.pc));
      return { F, P, entry };
    }
    return null;
  }
  function endsOf(id){
    const rec = draft && draft.cur.openings[id];
    return rec ? { a: rec.a_m, b: rec.b_m } : null;
  }

  // Why the 3D file cannot be edited, plainly ("" when it can): read but
  // refused (the file is there but unreadable), or a newer PadSpan's file,
  // which this version never writes (ws_house3d.py), read so or found so by a
  // refused Save (ctx.newer). The house still draws from the map either way.
  const problemCode = () => { const p = ctx.problem ? ctx.problem() : null; return (p && p.code) || null; };
  function cantEdit(){
    const code = problemCode();
    return code ? CANT_EDIT[code] || CANT_EDIT.read_failed : "";
  }

  // ── the draft ─────────────────────────────────────────────────────────────
  // Nothing changes it while a save is in flight: what was sent is what the
  // draft starts again from once it is in (rebase).
  function change(fn, group = null, moves = null){
    // A piece removed takes no strip with it: a run on it stays where it was, in the same step.
    const step = ctx.RUNS ? (c) => { const before = { ...(c.pieces || {}) }; fn(c); ctx.RUNS.keepRunsOf(c, before); } : fn;
    if (!draft || saving || !draft.change(step, group)) return false;
    if (moves || sliding) moveSoon(moves || sliding); else redrawSoon();   // moves: a piece dragged or raised (Furnish)
    paint();                                     // Save, Undo and the line now; the walls on the next frame
    if (sheetRefresh) sheetRefresh();            // the open sheet's Reset, without rebuilding its sliders
    return true;
  }
  // One redraw per frame however fast a slider moves.
  function redrawSoon(){
    if (redrawDue) return;
    redrawDue = true;
    requestAnimationFrame(guard(() => {
      redrawDue = false;
      ctx.redraw();
      if (resheet) { resheet = false; sheetFor(); }
      if (fur) fur.paint3d(false);               // the picked piece's outline, where it is drawn now
      paint();
    }));
  }
  // A slider being dragged: only what it moves, in place, once a frame
  // (nothing read again, nothing rebuilt); let go, the house is drawn whole.
  function moveSoon(target){
    if (redrawDue) return;                       // the whole house is coming anyway
    const queued = moveDue !== null;
    moveDue = target;
    if (queued) return;
    requestAnimationFrame(guard(() => {
      const t = moveDue;
      moveDue = null;
      if (redrawDue || !t) return;
      if (!ctx.preview || !ctx.preview(t)) redrawSoon();
      else paint();
    }));
  }
  function afterHistory(msg){
    if (sel && sel.opening && sel.opening.added && !draft.cur.openings[sel.opening.id]) sel = null;
    if (fur) fur.refresh();                      // a piece undone away is no longer picked
    if (strip) strip.refresh();
    gesture = null; pending = null;
    redrawSoon();
    hint(msg);
    sheetFor();
    paint();                                     // Undo and Redo as they are now, not a frame later
  }
  function discard(){
    if (!draft || !draft.dirty) return;
    const n = Object.values(draft.changes() || {}).reduce((a, s) => a + Object.keys(s).length, 0);
    draft.discard();
    sel = null;
    afterHistory(`Discarded ${FEW(n)}. Undo brings ${n === 1 ? "it" : "them"} back.`);
  }
  /** Save; then `then` (Save, then go on). One save at a time: asked again
   *  while one is in flight, `then` waits for it and goes on once it is in. */
  async function save(then){
    if (!draft || !editFn) return;
    if (saving) { if (then) afterSave = then; return; }
    const ch = draft.changes();
    if (!ch) { if (then) then(); return; }
    const sent = draft;
    saving = true; paint();
    try {
      const r = await editFn(ch);
      if (!r || typeof r !== "object" || !r.data) throw new Error("no answer");
      saving = false;
      ctx.saved(r.data);
      // Left meanwhile (Edit closed), there is no draft to start again: what
      // was sent is saved all the same.
      if (draft === sent) draft.rebase(ctx.file() || DRAFT.ownedOf(r.data));
      if (fur) fur.refresh();
      if (strip) strip.refresh();
      hint("Saved.");
    } catch (err) {
      // Refused: the draft stays, to be saved again; what went wrong said plainly.
      saving = false; afterSave = null;
      const code = err && err.code;
      if (code === "house3d_newer" && ctx.newer) ctx.newer();   // the file's own error, until a read finds otherwise
      hint(NOT_SAVED[code] || `Not saved: ${String((err && (err.message || err.code)) || err)}`, true);
      paint();
      return;
    }
    redrawSoon();
    sheetFor();
    paint();
    const next = then || afterSave;
    afterSave = null;
    if (next) save(next);                        // nothing left to send: it goes on at once
  }

  // ── Edit, the tools, leaving ──────────────────────────────────────────────
  // Edit may open: offered, not open already, no save in flight, and nothing
  // about the file against it.
  const mayBegin = () => !!editFn && !editing && !saving && !cantEdit();
  async function begin(t = null){
    if (!mayBegin()) return;
    let f = ctx.file();
    if (!f) {
      hint("Reading Live Aboard's file…");
      let ok = false;
      try { ok = await ctx.reload(); } catch (_) { ok = false; }
      f = ctx.file();
      if (!ok || !f) { flash("Couldn't read Live Aboard's file. Try again."); return; }
      // Asked again of what the read found (a newer PadSpan's file: Edit
      // says why), and of anything that changed while it was read.
      if (!mayBegin()) return;
    }
    draft = DRAFT.createDraft(f);
    editing = true; tool = t === "furnish" && fur ? "furnish" : null; sel = null; gesture = null; pending = null;
    ctx.clearUse();
    hint(tool === "furnish" ? FUR_HINT : DRAW_HINT);
    syncArcs();
    paint();
    sheetFor();
    ctx.render();
  }
  function stop(){
    editing = false; draft = null; tool = null; sel = null; gesture = null; pending = null; askGo = null; afterSave = null;
    clearArcs();
    line.visible = false;
    canvas.style.cursor = "";
    askEl.classList.remove("on");
    paint();
    sheetFor();
    ctx.redraw();
    ctx.render();
  }
  /** Done: straight out when everything is saved, else ask first. */
  function finish(){ if (!holdLeave(() => {})) paint(); }
  /** Something wants to leave Edit (Done, or the screen going to Map): with
   *  unsaved changes it asks first and holds (true); `go` runs once the
   *  person has saved or discarded. Without, Edit simply ends (false). */
  function holdLeave(go){
    if (!editing) return false;
    if (!draft || !draft.dirty) { stop(); return false; }
    ask(go);
    return true;
  }
  function ask(go){
    askGo = go;
    askEl.innerHTML = "";
    const card = d("div");
    const n = Object.values(draft.changes() || {}).reduce((a, s) => a + Object.keys(s).length, 0);
    card.appendChild(d("p", null, `${FEW(n)} in Live Aboard ${n === 1 ? "is" : "are"} not saved yet.`));
    const acts = d("div", "la3d-acts");
    acts.append(seg(
      btn("Save", "Save them, then go on", () => { askEl.classList.remove("on"); save(() => { const g = askGo; stop(); if (g) g(); }); }, "la3d-save"),
      btn("Discard", "Throw them away, then go on", () => { const g = askGo; stop(); if (g) g(); }),
      btn("Keep editing", "Stay here", () => { askGo = null; askEl.classList.remove("on"); }),
    ));
    card.appendChild(acts);
    askEl.appendChild(card);
    askEl.classList.add("on");
  }
  function pickTool(t){
    const was = tool;
    tool = tool === t ? null : t;
    pending = null; gesture = null; line.visible = false;
    const drawing = (x) => x === "door" || x === "window" || x === "doorway";
    if (drawing(tool) && !drawing(was)) { const F = currentFloor(); if (F) ctx.topDown(F); }
    if (tool === "heights" && sel && sel.opening) sel = null;
    hint(drawing(tool) ? "Press on a wall and drag along it, or tap its two ends."
      : tool === "heights" ? "Tap a light, a sensor or a readout."
      : tool === "strip" ? "Tap a light, or pick one from the list."
      : DRAW_HINT);
    paint();
    sheetFor();
    ctx.render();
  }
  function hint(text, bad = false){ hintMsg = text; hintBad = bad; paintHint(); }
  function flash(text){ hint(text, true); }
  function paintHint(){
    hintEl.textContent = hintMsg;
    hintEl.classList.toggle("bad", hintBad);
  }
  function paint(){
    const on = active();
    editSeg.style.display = editFn && !(furnishOn && editing) ? "" : "none";   // Furnish is always editing
    bEdit.textContent = editing ? "Done" : "Edit";
    bEdit.setAttribute("aria-pressed", String(editing));
    // Edit unavailable: greyed (it still takes focus) with the reason beside it.
    const why = editing ? "" : cantEdit();
    editWhy.textContent = why;
    editWhy.style.display = why ? "" : "none";
    if (why) { bEdit.setAttribute("aria-disabled", "true"); bEdit.setAttribute("aria-describedby", editWhy.id); bEdit.style.opacity = "0.5"; }
    else { bEdit.removeAttribute("aria-disabled"); bEdit.removeAttribute("aria-describedby"); bEdit.style.opacity = ""; }
    tools.classList.toggle("on", on);
    toolSeg.style.display = furnishOn ? "none" : "";        // Furnish: furniture only
    if (fur) fur.show(on && tool === "furnish");
    if (strip) strip.show(on && tool === "strip");
    for (const [b, t] of [[bDoor, "door"], [bWin, "window"], [bHts, "heights"], [bStrip, "strip"]]) if (b) b.setAttribute("aria-pressed", String(tool === t));
    bWay.setAttribute("aria-pressed", String(tool === "doorway"));
    bUndo.disabled = !on || saving || !draft.canUndo;
    bRedo.disabled = !on || saving || !draft.canRedo;
    const dirty = on && draft.dirty;
    bSave.disabled = !dirty || saving || problemCode() === "house3d_newer";
    bSave.textContent = saving ? "Saving…" : "Save";
    bDiscard.disabled = !dirty || saving;
    sheet.classList.toggle("busy", saving);
    sheet.inert = saving;                          // a slider or Delete waits for the save in flight
    paintHint();
    paint3d();
    if (!on) { sheet.classList.remove("on"); askEl.classList.remove("on"); }
  }

  // ── the sheet: what is picked ─────────────────────────────────────────────
  function select(s){ sel = s; pending = null; sheetFor(); paint(); }
  function sheetFor(){
    sheet.innerHTML = "";
    sheetRefresh = null;
    sheet.classList.remove("fur");
    sheet.classList.remove("strip");
    if (furnishing()) { sheet.classList.toggle("on", fur.sheet()); placeSheet(); return; }   // the picked piece's panel
    if (stripping()) { sheet.classList.toggle("on", strip.sheet()); placeSheet(); return; }   // the light picked, or the list
    if (!active() || !sel) { sheet.classList.remove("on"); return; }
    if (sel.opening) (sel.opening.added ? sheetAdded : sheetMapOpening)(sel.opening);
    else if (sel.eid) sheetDevice(sel.eid);
    sheet.classList.toggle("on", sheet.childNodes.length > 0);
    placeSheet();
  }
  // Under the toolbar, however many rows that wraps to: placed as it opens,
  // so it never jumps under a finger.
  function placeSheet(){
    if (sheet.classList.contains("on")) sheet.style.top = `${tools.offsetTop + tools.offsetHeight + 8}px`;
  }
  function head(title, sub){
    const h = d("h4");
    h.appendChild(d("span", null, title));
    h.appendChild(btn("×", "Close", () => select(null), "la3d-x"));
    sheet.appendChild(h);
    if (sub) sheet.appendChild(d("p", "la3d-sub", sub));
  }
  function slider(label, min, max, value, onInput, moves = null){
    const row = d("label", "la3d-row");
    const val = d("b", null, DRAFT.metres(value));
    const r = d("input");
    r.type = "range"; r.min = String(min); r.max = String(max); r.step = "0.01"; r.value = String(value);
    r.setAttribute("aria-label", label);
    let group = null;
    r.addEventListener("pointerdown", () => { group = `slider:${++sliderGen}`; });
    r.addEventListener("change", () => { group = null; if (moves) redrawSoon(); });   // let go: drawn whole again
    r.addEventListener("input", guard(() => {
      const v = Number(r.value);
      val.textContent = DRAFT.metres(v);
      sliding = moves;
      try { onInput(v, group || `slider:${++sliderGen}`); } finally { sliding = null; }
    }));
    row.append(d("span", null, label), r, val);
    sheet.appendChild(row);
    return r;
  }
  function choice(label, options, cur, act){
    const row = d("div", "la3d-row");
    const s = d("span", "lv-zoomseg");
    for (const [v, text] of options) {
      const b = btn(text, `${label}: ${text}`, () => act(v));
      b.setAttribute("aria-pressed", String(cur === v));
      s.appendChild(b);
    }
    row.append(d("span", null, label), s);
    sheet.appendChild(row);
  }
  function sheetAdded(o){
    // From the draft itself: a door or window just drawn is not drawn in
    // the walls until the next frame.
    const rec = draft.cur.openings[o.id];
    if (!rec) { sel = null; return; }
    const F = floorOf(rec.floor_id), ceil = F ? ceilOf(F) : 2.65, lim = DRAFT.heightLimits(ceil);
    const w = Math.hypot(rec.b_m[0] - rec.a_m[0], rec.b_m[1] - rec.a_m[1]);
    head(`${NAME[rec.kind] || "Window"} · ${DRAFT.metres(w)}`, "Drawn in Live Aboard. Drag either end to change its width.");
    choice("Is a", [["door", "Door"], ["window", "Window"], ["doorway", "Doorway"]], rec.kind, (k) => {
      if (k === rec.kind) return;
      const sw = DRAFT.switchKind(o.id, rec, ceil, k);
      if (sw.error) { flash(sw.error + "."); return; }
      change((c) => { delete c.openings[o.id]; c.openings[sw.id] = sw.rec; });
      sel = { opening: { ...o, id: sw.id, kind: sw.rec.kind } };
      hint(`Now a ${sw.rec.kind}.`);
      sheetFor();
    });
    const set = (patch, group) => change((c) => {
      const cur = c.openings[o.id];
      if (cur) Object.assign(cur, DRAFT.openingHeights({ ...cur, ...patch }, ceil));
    }, group);
    if (rec.kind === "window") {
      slider("Sill", 0, DRAFT.mm(lim.sill), rec.sill_m, (v, g) => set({ sill_m: v }, g), { opening: o.id });
      slider("Head", DRAFT.GAP_MIN_M, DRAFT.mm(lim.head), rec.head_m, (v, g) => set({ head_m: v }, g), { opening: o.id });
    } else {
      slider("Height", DRAFT.mm(lim.doorLow), DRAFT.mm(lim.doorHigh), rec.head_m, (v, g) => set({ head_m: v }, g), { opening: o.id });
      const pick = (k, v) => { change((c) => { if (c.openings[o.id]) c.openings[o.id][k] = v; }); sheetFor(); };
      if (rec.kind === "door") {
        typeRows(addedNow(o.id), rec, (patch) => {
          change((c) => { const e = c.openings[o.id]; if (e) for (const [k, v] of Object.entries(patch)) { if (v === null) delete e[k]; else e[k] = v; } });
          sheetFor();
        }, pick);
      }
    }
    const acts = d("div", "la3d-acts");
    acts.appendChild(seg(btn("Delete", `Delete this ${rec.kind}`, () => {
      change((c) => { delete c.openings[o.id]; });
      select(null);
      hint(`${NAME[rec.kind] || "Window"} deleted. Undo brings it back.`);
    }, "la3d-del")));
    sheet.appendChild(acts);
  }
  function sheetMapOpening(o){
    const cur = draft.cur.openings[o.id] || {}, F = o.F, ceil = ceilOf(F), lim = DRAFT.heightLimits(ceil);
    head(o.name || (o.kind === "door" ? "Door" : "Window"), "From the map. These change Live Aboard only.");
    const set = (patch, group) => change((c) => { c.openings[o.id] = { ...(c.openings[o.id] || {}), ...patch }; }, group);
    if (o.kind === "window") {
      const now = DRAFT.openingHeights({ kind: "window", sill_m: cur.sill_m ?? HOUSE.SILL_H, head_m: cur.head_m ?? HOUSE.HEAD_H }, ceil);
      slider("Sill", 0, DRAFT.mm(lim.sill), now.sill_m, (v, g) => {
        const c0 = draft.cur.openings[o.id] || {};
        set(DRAFT.openingHeights({ kind: "window", sill_m: v, head_m: c0.head_m ?? HOUSE.HEAD_H }, ceil), g);
      }, { opening: o.id });
      slider("Head", DRAFT.GAP_MIN_M, DRAFT.mm(lim.head), now.head_m, (v, g) => {
        const c0 = draft.cur.openings[o.id] || {};
        set(DRAFT.openingHeights({ kind: "window", sill_m: c0.sill_m ?? HOUSE.SILL_H, head_m: v }, ceil), g);
      }, { opening: o.id });
    } else {
      const P = o.F.pieces.find(q => q.pc.barrier && q.pc.barrier.id === o.id && q.pc.kind === "door");
      typeRows(P ? { P, F: o.F } : null, cur, (patch) => {
        change((c) => {
          const e = { ...(c.openings[o.id] || {}) };
          for (const [k, v] of Object.entries(patch)) { if (v === null) delete e[k]; else e[k] = v; }
          if (Object.keys(e).length) c.openings[o.id] = e; else delete c.openings[o.id];
        });
        sheetFor();
      }, (k, v) => { set({ [k]: v }); sheetFor(); });
    }
    const acts = d("div", "la3d-acts");
    const reset = btn("Reset", "Back to how the map has it", () => { change((c) => { delete c.openings[o.id]; }); sheetFor(); });
    sheetRefresh = () => { reset.disabled = !draft.cur.openings[o.id]; };
    sheetRefresh();
    acts.appendChild(seg(reset));
    sheet.appendChild(acts);
  }
  /** A door's Type ▾ (PadSpan's guess until one is picked), the options
   *  that type has, what drives it (Follows: a door or garage sensor, or a
   *  cover), and with nothing linked how it is shown. `cur`: its entry in
   *  the draft; set(patch) (null takes a key out); pick(key, value). */
  function typeRows(at, cur, set, pick){
    const S2 = ctx.STOREY, P = at && at.P;
    if (!S2) {                                     // no house module: the hinged door's own
      choice("Hinge", [["left", "Left"], ["right", "Right"]], cur.hinge || "left", (v) => pick("hinge", v));
      choice("Swing", [["in", "In"], ["out", "Out"]], cur.swing || "in", (v) => pick("swing", v));
      shownRow(at, cur.shown, (v) => pick("shown", v));
      return;
    }
    const pc = P ? { ...P.pc, override: { ...(P.pc.override || {}), ...cur } } : { x0: 0, y0: 0, x1: 0.9, y1: 0, cls: "int", override: cur };
    const host = ctx.host ? ctx.host() || {} : {}, states = host.states || {};
    const fol = states[cur.link || (P && P.pc.barrier && P.pc.barrier.linked_entity_id) || ""];
    const t = S2.doorTypeOf(pc, at && at.F ? at.F.rooms : P ? [] : [], (fol && fol.attributes && fol.attributes.device_class) || null);
    const row = d("label", "la3d-row la3d-kind"), sel2 = d("select");
    sel2.setAttribute("aria-label", "Type");
    const opt = (v, text) => { const n = d("option", null, text); n.value = v; return n; };
    sel2.appendChild(opt("", `PadSpan's guess: ${S2.DOOR_TYPE_NAMES[t.guess]}`));
    for (const k of S2.DOOR_TYPES) sel2.appendChild(opt(k, S2.DOOR_TYPE_NAMES[k]));
    sel2.value = S2.DOOR_TYPES.includes(cur.type) ? cur.type : "";
    sel2.addEventListener("change", guard(() => set({ type: sel2.value || null })));
    row.append(d("span", null, "Type"), sel2);
    sheet.appendChild(row);
    const has = S2.DOOR_TYPE_OPTIONS[t.type] || [];
    if (has.includes("hinge")) choice("Hinge", [["left", "Left"], ["right", "Right"]], cur.hinge || "left", (v) => set({ hinge: v }));
    if (has.includes("swing") && !(t.type === "gate" && t.slide)) choice("Swing", [["in", "In"], ["out", "Out"]], cur.swing || "in", (v) => set({ swing: v }));
    if (t.type === "gate") {
      choice("Opens", [["swing", "Swings"], ["left", "Slides left"], ["right", "Slides right"]], t.slide || "swing", (v) => set({ slide: v === "swing" ? null : v }));
      if (!t.slide) choice("Gates", [["one", "Single"], ["two", "Double"]], t.panels >= 2 ? "two" : "one", (v) => set({ panels: v === "two" ? 2 : null }));
    } else if (has.includes("slide")) {
      const both = t.type === "sliding" || t.type === "bifold";
      choice(t.type === "bifold" ? "Folds" : "Slides", [["left", "Left"], ["right", "Right"], ...(both ? [["both", "Both ways"]] : [])],
        t.slide === "both" && !both ? "right" : t.slide, (v) => set({ slide: v }));
    }
    if (has.includes("face")) choice("Runs on", [["in", "Room side"], ["out", "Outside"]], t.face, (v) => set({ face: v }));
    if (t.type === "bifold") choice("Panels", [[2, "2"], [3, "3"], [4, "4"]], t.panels, (v) => set({ panels: v }));
    if (has.includes("glass")) choice("Glass", [[true, "Glass"], [false, "Solid"]], !!t.glass, (v) => set({ glass: v }));
    // What drives it: the map's sensor, else what Follows says, else Shown.
    const b = P && P.pc.barrier;
    if (b && b.linked_entity_id && !cur.link) { sheet.appendChild(d("p", "la3d-sub", "It opens and shuts with its sensor.")); return; }
    const fl = d("label", "la3d-row la3d-kind"), fsel = d("select");
    fsel.setAttribute("aria-label", "Follows");
    fsel.appendChild(opt("", "Nothing: shown as below"));
    const ok = (eid) => {
      const st = states[eid], dc = st && st.attributes ? st.attributes.device_class : null, dom = eid.split(".")[0];
      return dom === "cover" ? S2.coverIsDoor(st) : dom === "binary_sensor" && ["door", "garage_door", "opening", "window"].includes(dc);
    };
    const eids = Object.keys(states).filter(ok).sort((p, q) => String((states[p].attributes || {}).friendly_name || p).localeCompare(String((states[q].attributes || {}).friendly_name || q)));
    if (cur.link && !eids.includes(cur.link)) eids.unshift(cur.link);
    for (const eid of eids) fsel.appendChild(opt(eid, `${(states[eid] && states[eid].attributes && states[eid].attributes.friendly_name) || eid}${eid.startsWith("cover.") ? " (moves it: follows where it is)" : ""}`));
    fsel.value = cur.link || "";
    fsel.addEventListener("change", guard(() => set({ link: fsel.value || null })));
    fl.append(d("span", null, "Follows"), fsel);
    sheet.appendChild(fl);
    if (cur.link) sheet.appendChild(d("p", "la3d-sub", cur.link.startsWith("cover.")
      ? "It follows where the door is. A tap shows its card; hold for its controls. It never moves on a tap."
      : "It opens and shuts with that sensor."));
    else shownRow(at, cur.shown, (v) => set({ shown: v }));
  }
  /** A door's "Shown": open, ajar or shut, when no sensor says (one with a
   *  sensor follows it). `at`: where it is drawn ({P}); `stored`: the file's. */
  function shownRow(at, stored, act){
    const P = at && at.P, b = P && P.pc.barrier;
    if (b && b.linked_entity_id) { sheet.appendChild(d("p", "la3d-sub", "It opens and shuts with its sensor.")); return; }
    const now = DRAFT.DOOR_SHOWN.includes(stored) ? stored : P && ctx.STOREY ? ctx.STOREY.doorShown(P.pc) : "ajar";
    choice("Shown", [["open", "Open"], ["ajar", "Ajar"], ["shut", "Shut"]], now, (v) => act(v));
  }
  function sheetDevice(eid){
    const info = ctx.device(eid);
    if (!info || info.z === null) { sel = null; return; }
    const ceil = ceilOf(info.F), cur = draft.cur[info.section][eid], top = DRAFT.heightRange(ceil, info.section).max;
    const light = info.section === "lights", setZ = (e) => !!e && typeof e.z_m === "number";
    if (light && strip && cur && cur.run) {                // laid out with Strip: its heights are there
      head(info.label, "Laid out with Strip: its run sets where it is and how high.");
      kindPicker(eid, info);
      const acts = d("div", "la3d-acts");
      acts.appendChild(seg(btn("Lay it out in Strip", "Open it in the Strip tool", () => { pickTool("strip"); strip.select(eid); })));
      sheet.appendChild(acts);
      return;
    }
    head(info.label, `Height above its floor, 0 to ${DRAFT.metres(top)}. Default ${DRAFT.metres(info.zDefault)}.`);
    if (light) kindPicker(eid, info);
    slider("Height", 0, top, setZ(cur) ? cur.z_m : info.z, (v, g) => {
      // A light keeps what it is (its kind) as its height changes.
      change((c) => { c[info.section][eid] = { ...(light ? c.lights[eid] : null), z_m: DRAFT.clampHeight(v, ceil, info.section) }; }, g);
    }, { eid });
    const acts = d("div", "la3d-acts");
    const reset = btn("Reset to default", "Back to the height its type gives it", () => {
      change((c) => {
        const e = c[info.section][eid];
        const keep = light && e ? { ...(e.kind ? { kind: e.kind } : null), ...(e.run ? { run: e.run } : null) } : {};
        if (Object.keys(keep).length) c.lights[eid] = keep; else delete c[info.section][eid];
      });
      sheetFor();
    });
    sheetRefresh = () => { reset.disabled = !setZ(draft.cur[info.section][eid]); };
    sheetRefresh();
    acts.appendChild(seg(reset));
    sheet.appendChild(acts);
  }

  /** "What is this?": a light's kind in Live Aboard (3D only), or PadSpan's guess. */
  function kindPicker(eid, info){
    const row = d("label", "la3d-row la3d-kind"), pick = d("select");
    pick.setAttribute("aria-label", "What is this?");
    const nameOf = (k) => (HOUSE.LIGHT_KINDS.find(([v]) => v === k) || [null, "Just its light"])[1];
    const opt = (v, text) => { const o = d("option", null, text); o.value = v; return o; };
    pick.appendChild(opt("", `PadSpan's guess: ${nameOf(info.guess)}`));
    for (const [k, text] of HOUSE.LIGHT_KINDS) pick.appendChild(opt(k, text));
    const cur = draft.cur.lights[eid];
    pick.value = cur && HOUSE.LIGHT_KINDS.some(([k]) => k === cur.kind) ? cur.kind : "";
    pick.addEventListener("change", guard(() => {
      const v = pick.value;
      if (change((c) => {
        const e = { ...(c.lights[eid] || {}) };
        if (v) e.kind = v; else delete e.kind;
        if (Object.keys(e).length) c.lights[eid] = e; else delete c.lights[eid];
      })) resheet = true;                        // its default height is the new kind's
    }));
    row.append(d("span", null, "What is this?"), pick);
    sheet.appendChild(row);
  }

  // ── the line, the ends, the length ────────────────────────────────────────
  // What the 3D line shows: the line being drawn, the end being dragged, or
  // the opening that is picked.
  function shown(){
    if (gesture && gesture.span && (gesture.kind === "line" || gesture.kind === "drag")) {
      const g = gesture, run = g.w.run, kind = g.kindOf;
      const hts = DRAFT.openingHeights({ kind, sill_m: g.sill, head_m: g.head }, ceilOf(g.w.F));
      const z = kind === "window" ? [hts.sill_m, hts.head_m] : [0, hts.head_m];
      return { F: g.w.F, a: DRAFT.pointOf(run, g.span.t0), b: DRAFT.pointOf(run, g.span.t1), z, kind, thick: g.w.run.thick,
               len: g.span.len, stop: g.span.stop, short: g.span.len < DRAFT.minWidth(kind) - 1e-6, fixed: g.fixed };
    }
    if (sel && sel.opening && sel.opening.added) {
      const rec = draft.cur.openings[sel.opening.id], F = rec ? floorOf(rec.floor_id) : null;
      if (!rec || !F) return null;
      const at = addedNow(sel.opening.id);
      return { F, a: rec.a_m, b: rec.b_m, z: rec.kind === "window" ? [rec.sill_m, rec.head_m] : [0, rec.head_m], kind: rec.kind,
               thick: at ? at.P.pc.thick : 0.14, len: Math.hypot(rec.b_m[0] - rec.a_m[0], rec.b_m[1] - rec.a_m[1]),
               stop: null, short: false, handles: true };
    }
    if (sel && sel.opening) {
      for (const F of ctx.floors()) {
        const P = F.pieces.find(q => q.pc.barrier && q.pc.barrier.id === sel.opening.id && (q.pc.kind === "door" || q.pc.kind === "window"));
        const leaf = P && P.els.find(e => e.leaf);
        if (leaf) return { F, a: [P.pc.x0, P.pc.y0], b: [P.pc.x1, P.pc.y1], z: [Math.max(0, leaf.z0), leaf.z1], kind: "map",
                           thick: P.pc.thick, len: Math.hypot(P.pc.x1 - P.pc.x0, P.pc.y1 - P.pc.y0), stop: null, short: false };
      }
    }
    return null;
  }
  function paint3d(){
    ensureLine();
    const s = active() ? shown() : null;
    line.visible = !!s;
    if (s) {
      lineMat.color.set(s.stop === "opening" || s.short ? COL.stop : COL[s.kind] || COL.window);
      // Wider than the wall, so it shows from straight above too.
      place(line, s.F, s.a, s.b, s.z[0], s.z[1], Math.max((s.thick || 0.12) + 0.12, 0.34));
    }
    ctx.render();
  }
  /** Every frame: the ends, the length and the picked device's ring, where
   *  they are on screen now. */
  function layout(){
    const on = active();
    if (fur && furnishing()) fur.layout();
    if (strip && stripping()) strip.layout();
    if (on && arcsGen !== ctx.shellGen()) { syncArcs(); ctx.render(); }
    const r0 = root.getBoundingClientRect(), off = (p) => [p[0] - r0.left - (root.clientLeft || 0), p[1] - r0.top - (root.clientTop || 0)];
    const put = (el, p, cls) => {
      if (!p) { el.style.display = "none"; return; }
      const q = off(p);
      el.style.display = "block"; el.style.left = `${q[0]}px`; el.style.top = `${q[1]}px`;
      if (cls !== undefined) el.classList.toggle("stop", cls);
    };
    const s = on ? shown() : null;
    const mid = s ? (s.z[0] + s.z[1]) / 2 : 0;
    const showEnds = s && (s.handles || (gesture && (gesture.kind === "line" || gesture.kind === "drag")));
    put(ends[0], showEnds ? screenAt(s.F, s.a[0], s.a[1], mid) : null, false);
    put(ends[1], showEnds ? screenAt(s.F, s.b[0], s.b[1], mid) : null, !!(s && (s.stop === "opening" || s.short)));
    if (!showEnds && on && pending) {
      const p = DRAFT.pointOf(pending.run, pending.t);
      put(ends[0], screenAt(pending.F, p[0], p[1], pending.h), false);
    }
    if (s) {
      // Beside the line, never on it: off its middle, square to it on screen
      // (above it, or to its left when it runs up the screen).
      lenEl.textContent = DRAFT.metres(s.len) + (s.stop === "opening" ? " · stops at the opening" : s.stop === "corner" ? " · corner" : "");
      lenEl.classList.toggle("bad", s.stop === "opening" || s.short);
      const pa = screenAt(s.F, s.a[0], s.a[1], mid), pb = screenAt(s.F, s.b[0], s.b[1], mid);
      if (pa && pb) {
        const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy) || 1;
        let nx = -dy / L, ny = dx / L;
        if (ny > 0.3 || (Math.abs(ny) <= 0.3 && nx > 0)) { nx = -nx; ny = -ny; }
        lenEl.style.display = "block";
        const off = 16 + Math.abs(nx) * lenEl.offsetWidth / 2 + Math.abs(ny) * lenEl.offsetHeight / 2;
        put(lenEl, [(pa[0] + pb[0]) / 2 + nx * off, (pa[1] + pb[1]) / 2 + ny * off]);
      } else put(lenEl, null);
    } else put(lenEl, null);
    const dev = on && sel && sel.eid ? ctx.device(sel.eid) : null;
    put(ring, dev && dev.at ? screenAt(dev.F, dev.at.x, dev.at.z, dev.at.y - dev.F.fl.elev) : null);
    placeSheet();
  }

  // ── a finger, a pen or the mouse (live_aboard.js hands them over) ─────────
  /** A press on the view while editing: "line" (drawing), "drag" (an end),
   *  "tap" (picks on release; a move turns the house instead), "swallow"
   *  (a finger that missed every wall while drawing: nothing), or null
   *  (the house turns, as ever). */
  function down(e){
    if (!active() || askEl.classList.contains("on") || saving) return null;
    if (furnishing()) return fur.down(e);                // a piece: "drag"; anything else: "tap"
    if (stripping()) return strip.down(e);               // a handle: "drag"; a wall while drawing: "line"; a light: "tap"
    const x = e.clientX, y = e.clientY, k = kindOfPtr(e);
    const s = shown();
    if (s && s.handles && sel) {
      const mid = (s.z[0] + s.z[1]) / 2;
      const pa = screenAt(s.F, s.a[0], s.a[1], mid), pb = screenAt(s.F, s.b[0], s.b[1], mid);
      const da = pa ? Math.hypot(pa[0] - x, pa[1] - y) : Infinity, db = pb ? Math.hypot(pb[0] - x, pb[1] - y) : Infinity;
      if (Math.min(da, db) <= GRAB[k]) {
        const at = addedNow(sel.opening.id), rec = draft.cur.openings[sel.opening.id];
        if (at && at.entry && rec) {
          const moving = da <= db ? "a" : "b", run = at.entry.run;
          const fixedT = DRAFT.tOn(run, ...(moving === "a" ? rec.b_m : rec.a_m)), startT = DRAFT.tOn(run, ...(moving === "a" ? rec.a_m : rec.b_m));
          const w = { F: at.F, run, stops: at.entry.stops, ops: at.entry.ops, h: mid };
          gesture = { kind: "drag", id: sel.opening.id, moving, w, fixedT, startT, kindOf: rec.kind, x0: x, y0: y,
                      sill: rec.sill_m, head: rec.head_m, span: DRAFT.spanOf(run, w.stops, w.ops, fixedT, startT, sel.opening.id) };
          paint3d();
          return "drag";
        }
      }
    }
    const op = openingAt(x, y);
    if (op) { gesture = { kind: "tap", target: { opening: op }, x0: x, y0: y }; return "tap"; }
    if (tool === "door" || tool === "window" || tool === "doorway") {
      const w = wallAt(x, y, REACH[k]);
      if (!w) {
        if (k !== "touch") return null;
        hint("Press on a wall.", true);
        return "swallow";
      }
      if (DRAFT.insideOpening(w.ops, w.t)) { hint("That is already a door or window.", true); return "swallow"; }
      gesture = { kind: "line", w, from: w.t, to: w.t, x0: x, y0: y, moved: false, kindOf: tool,
                  span: DRAFT.spanOf(w.run, w.stops, w.ops, w.t, w.t) };
      paint3d();
      return "line";
    }
    const hit = ctx.pick(x, y);
    // A tag or a scanner over a light is not what Heights sets: the device under it is.
    const dev = hit && [hit.hit, ...(hit.hit && hit.hit.kind !== "device" ? hit.under || [] : [])]
      .find(t => t && t.kind === "device" && ctx.device(t.eid));
    if (dev) {
      gesture = { kind: "tap", target: { eid: dev.eid }, x0: x, y0: y };
      return "tap";
    }
    return null;
  }
  function move(e){
    if (furnishing()) { fur.move(e); return; }
    if (stripping()) { strip.move(e); return; }
    const g = gesture;
    if (!g || (g.kind !== "line" && g.kind !== "drag")) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > SLOP) g.moved = true;
    const t = tAlong(g.w, e.clientX, e.clientY);
    if (t === null) return;
    if (g.kind === "line") {
      g.to = t;
      g.span = DRAFT.spanOf(g.w.run, g.w.stops, g.w.ops, g.from, t);
    } else {
      // An end never passes its other end: back past it is no width at all.
      const dir = Math.sign(g.startT - g.fixedT) || 1;
      const to = (t - g.fixedT) * dir < 0 ? g.fixedT : t;
      g.span = DRAFT.spanOf(g.w.run, g.w.stops, g.w.ops, g.fixedT, to, g.id);
    }
    paint3d();
  }
  function up(e){
    if (furnishing()) { fur.up(e); paint(); return; }
    if (stripping()) { strip.up(e); paint(); return; }
    const g = gesture;
    gesture = null;
    if (!g) { paint3d(); return; }
    if (g.kind === "line") {
      if (g.moved) { pending = null; addOpening(g.w, g.span); }
      else tapEnd(g.w);
    } else if (g.kind === "drag") {
      if (g.moved) moveEnd(g);
    } else if (g.kind === "tap") tap(e, g);
    paint3d();
    paint();
  }
  function tap(e, g = gesture){
    if (furnishing()) { fur.tap(e); return; }
    if (stripping()) { strip.tap(e); return; }
    gesture = null;
    if (!g || !g.target) return;
    if (g.target.opening) { select({ opening: g.target.opening }); hint(g.target.opening.added ? "Drag either end to change its width." : "From the map: set it for Live Aboard."); }
    else if (g.target.eid) select({ eid: g.target.eid });
  }
  // Two taps: the first marks an end, the second (on the same wall) the other.
  function tapEnd(w){
    const same = pending && pending.F.fl.id === w.F.fl.id && Math.abs(pending.run.ux * w.run.ux + pending.run.uy * w.run.uy) > 0.999
      && Math.abs(pending.run.c - w.run.c) < 0.02;
    if (same) {
      const sp = DRAFT.spanOf(w.run, w.stops, w.ops, DRAFT.tOn(w.run, ...DRAFT.pointOf(pending.run, pending.t)), w.t);
      pending = null;
      addOpening(w, sp);
      return;
    }
    pending = { F: w.F, run: w.run, t: w.t, h: w.h };
    hint("Now tap the other end, on the same wall.");
  }
  function addOpening(w, sp){
    const kind = tool === "door" || tool === "doorway" ? tool : "window", min = DRAFT.minWidth(kind);
    if (!sp || sp.len < min - 1e-6) {
      flash(`Too short: a ${kind} is at least ${min.toFixed(2)} m wide${sp && sp.stop === "opening" ? ", and openings never overlap" : ""}.`);
      return;
    }
    const id = DRAFT.newOpeningId(kind);
    const rec = DRAFT.newOpening(kind, w.F.fl.id, DRAFT.pointOf(w.run, sp.t0), DRAFT.pointOf(w.run, sp.t1), ceilOf(w.F));
    change((c) => { c.openings[id] = rec; });
    select({ opening: { id, added: true, kind } });
    if (sp.stop === "opening") flash(`${NAME[kind]} ${DRAFT.metres(sp.len)}: it stops at the opening next to it (openings never overlap).`);
    else hint(`${NAME[kind]} ${DRAFT.metres(sp.len)} added. Drag either end to change it.`);
  }
  function moveEnd(g){
    const min = DRAFT.minWidth(g.kindOf);
    if (g.span.len < min - 1e-6) { flash(`Too short: a ${g.kindOf} is at least ${min.toFixed(2)} m wide.`); return; }
    // To the millimetre, the moved end pushed on when rounding would take
    // it under the least width (the server checks the rounded ends).
    const [fixedP, movedP] = DRAFT.endsMm(DRAFT.pointOf(g.w.run, g.fixedT),
      DRAFT.pointOf(g.w.run, g.span.t0 === g.fixedT ? g.span.t1 : g.span.t0), min);
    change((c) => {
      const cur = c.openings[g.id];
      if (!cur) return;
      if (g.moving === "a") { cur.a_m = movedP; cur.b_m = fixedP; } else { cur.a_m = fixedP; cur.b_m = movedP; }
    });
    sheetFor();
    if (g.span.stop === "opening") flash("Stopped at the opening next to it: openings never overlap.");
    else hint(`${NAME[g.kindOf] || "Window"} now ${DRAFT.metres(g.span.len)}.`);
  }
  function cancel(){ gesture = null; if (fur) fur.cancel(); if (strip) strip.cancel(); paint3d(); }
  function hover(e){
    if (!active()) return false;
    if (furnishing()) { canvas.style.cursor = fur.hover(e); return true; }
    if (stripping()) { canvas.style.cursor = strip.hover(e); return true; }
    let cur = "";
    if (openingAt(e.clientX, e.clientY)) cur = "pointer";
    else if ((tool === "door" || tool === "window") && wallAt(e.clientX, e.clientY, REACH.mouse)) cur = "crosshair";
    canvas.style.cursor = cur;
    return true;
  }

  return {
    /** The host's edit (the light-placement gate), or null: no Edit. */
    setEdit(fn){
      const had = !!editFn;
      editFn = typeof fn === "function" ? fn : null;
      if (had !== !!editFn) { paint(); sheetFor(); if (editing) { syncArcs(); ctx.redraw(); } }
      if (!had && editFn && furnishOn && !editing) begin("furnish");   // Save just became possible here
    },
    /** Mapping → Furnish (on): Edit opens at the furniture tool. Any other
     *  screen (off): the furniture tool closes; with nothing unsaved Edit
     *  closes with it (a tap is a tap again there), else the draft, unsaved
     *  furniture and all, stays for Save. */
    setFurnish(on){
      const want = !!on && !!fur;
      if (want === furnishOn) return;
      furnishOn = want;
      if (furnishOn) {
        if (editing) { tool = "furnish"; sel = null; gesture = null; pending = null; line.visible = false; hint(FUR_HINT); }
        else if (editFn) begin("furnish");
      } else if (tool === "furnish") {
        if (!draft || !draft.dirty) stop();
        else {
          tool = null;
          hint(DRAW_HINT);
        }
      }
      paint(); sheetFor(); ctx.render();
    },
    /** The Furnish tool (the harness reaches it here). */
    get furnish(){ return fur; },
    /** The Strip tool (the harness reaches it here). */
    get strip(){ return strip; },
    get active(){ return active(); },
    /** The file was read again, or could not be, or a Save found it a newer
     *  PadSpan's: Edit says so, and while it is open the hint says whether
     *  Save can go ahead. */
    refresh(){
      const code = problemCode();
      if (editing && code === "house3d_newer") hint(NOT_SAVED.house3d_newer, true);
      else if (editing && !code && hintMsg === NOT_SAVED.house3d_newer) hint("Live Aboard's file can be saved again.");
      paint();
    },
    /** The file was read again (changed elsewhere: Settings → Remove all
     *  furniture, say). A draft with nothing unsaved follows it; one with
     *  unsaved work loses only the pieces the file no longer has, from its
     *  Undo and Redo too, so no Save brings one back. */
    fileChanged(){
      const f = ctx.file();
      if (!editing || !draft || !f || JSON.stringify(draft.base) === JSON.stringify(f)) return;
      if (!draft.dirty) draft.rebase(f);
      else draft.forget("pieces", Object.keys(draft.base.pieces || {}).filter(id => !(f.pieces && f.pieces[id])));
      if (fur) fur.refresh();
      paint(); sheetFor();
    },
    /** The draft while editing (what the view draws instead of the file). */
    view(){ return active() ? draft.cur : null; },
    down, move, up, tap: (e) => tap(e), cancel, hover, layout, holdLeave,
    /** The screen went to Map. Picked here, unsaved work was asked about
     *  first (holdLeave); picked in another tab of this browser it arrives
     *  as a poll with no one to ask: unsaved work then stays, Edit open with
     *  it, for when the screen is back in 3D. Nothing unsaved: Edit ends,
     *  and Furnish opens afresh when the screen is back. */
    leave(){
      if (!editing || !draft || !draft.dirty) { furnishOn = false; if (editing) stop(); return; }
      gesture = null; pending = null; askGo = null;
      askEl.classList.remove("on");
      paint();
    },
    state(){
      return { editing, active: active(), tool, dirty: !!(draft && draft.dirty), canUndo: !!(draft && draft.canUndo),
               canRedo: !!(draft && draft.canRedo), saving, asking: askEl.classList.contains("on"), hint: hintMsg, hintBad,
               sel: sel ? (sel.opening ? { opening: { id: sel.opening.id, added: sel.opening.added, kind: sel.opening.kind } } : { eid: sel.eid }) : null,
               draft: draft ? JSON.parse(JSON.stringify(draft.cur)) : null, changes: draft ? draft.changes() : null,
               gesture: gesture ? { kind: gesture.kind, span: gesture.span || null } : null, pending: !!pending,
               line: line.visible, arcs: arcs.length / 3, cantEdit: cantEdit(), editWhy: editWhy.style.display === "none" ? "" : editWhy.textContent,
               editAvailable: bEdit.getAttribute("aria-disabled") !== "true",
               furnishOn, furnish: fur ? fur.state() : null, strip: strip ? strip.state() : null };
    },
    /** A plan point on floor fid at height z, in client px (the harness presses it). */
    whereOf(fid, x, y, z = 1){ const F = ctx.floors().find(q => q.fl.id === fid); return F ? screenAt(F, x, y, z) : null; },
    dispose(){
      if (fur) fur.dispose();
      if (strip) strip.dispose();
      clearArcs();
      if (line.parent) line.parent.remove(line);
      box.dispose(); lineMat.dispose(); arcMat.dispose(); fillMat.dispose();
    },
  };
}
