// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): furniture in the
// 3D view (P2 Furnish).
//
//   createPieceLayer  every piece drawn on its floor, in any view: at its
//                     floor's height plus its own (z_m), hidden with the
//                     floors above the top one, never cut away with the
//                     walls. Low: flat colours and a soft shadow under what
//                     stands on the floor; High: the builders' finishes and
//                     the sun's shadows. Each piece's root carries its id and
//                     its device (userData.pieceId, .entity_id).
//   createFurnish     Mapping → Furnish: the furniture tool inside the 3D
//                     editor (live_aboard_edit.js), on its draft, so one Save
//                     writes doors, windows, heights and furniture together.
//                     Build (the builders' kinds, and a Box), From a photo,
//                     Library, Import and People & devices (each its own
//                     module, loaded only here; a missing one hides its
//                     button); drag across the floor with the piece's back
//                     snapping to walls; the piece's panel: label, size, the
//                     builder's own settings, colours, Turn, Floor ▲ / ▼ (the
//                     view follows it), Height in room, Duplicate, Delete and
//                     "This is a device…"; the fit checks as warnings.
//
// Imports nothing: three.js, the rules (live_aboard_pieces.js) and the
// builders (live_aboard_furniture.js — or null, and every piece is a box)
// are handed in by the view.

const SLOP = 6;                                     // px a press may move and still be a tap
const COL = { sel: "#52b788", warn: "#f59e0b" };
const FLOWS = [["photo", "From a photo", "live_aboard_photo.js", "photoFlow"],
               ["library", "Library", "live_aboard_library.js", "libraryFlow"],
               ["import", "Import", "live_aboard_import.js", "importFlow"],
               ["people", "People & devices", "live_aboard_people.js", "peopleFlow"]];
// What "This is a device…" offers: what a piece of furniture can be.
const DEVICE_DOMAINS = ["light", "media_player", "fan", "switch", "vacuum", "lawn_mower", "climate", "water_heater",
                        "humidifier", "cover", "remote", "valve", "lock", "camera", "input_boolean"];
// A washer, dryer, car or charger often says it runs or charges only through
// a sensor (its power, a running or charging state): those are offered too.
const SENSOR_LIVE = ["run", "charge"], SENSOR_DOMAINS = ["sensor", "binary_sensor"];

const CSS = `
.la3d-furbar{display:contents}
.la3d-furmenu{position:absolute;z-index:6;display:none;max-height:min(420px,calc(100% - 80px));overflow:auto;min-width:200px;
  padding:6px;border-radius:12px;background:rgba(6,14,9,.97);border:1px solid rgba(120,190,155,.26);box-shadow:0 10px 26px rgba(0,0,0,.55)}
.la3d-furmenu.on{display:block}
.la3d-furmenu h5{margin:6px 8px 4px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(226,240,232,.5)}
.la3d-furmenu button{all:unset;box-sizing:border-box;display:block;width:100%;padding:7px 10px;border-radius:8px;cursor:pointer;
  color:#e8f0ea;font-size:13px}
.la3d-furmenu button:hover,.la3d-furmenu button:focus-visible{background:rgba(82,183,136,.22)}
.la3d-sheet.fur{max-height:calc(100% - 120px);overflow-y:auto;right:calc(var(--la3d-plan-w, 0px) + 10px)}
@media (max-width:600px){.la3d-sheet.fur{left:10px;right:10px;width:auto;top:auto!important;bottom:58px;max-height:46%}}
.la3d-sheet .la3d-fin{width:100%;box-sizing:border-box;padding:5px 8px;border-radius:8px;border:1px solid rgba(120,190,155,.3);
  background:#0a150e;color:#e8f0ea;font-size:12.5px}
.la3d-sheet select.la3d-fin{width:auto;max-width:100%}
.la3d-sheet .la3d-cols{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
.la3d-sheet .la3d-cols label{display:flex;gap:5px;align-items:center;font-size:11.5px;color:rgba(226,240,232,.75)}
.la3d-sheet input[type=color]{width:34px;height:24px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:none}
.la3d-sheet .la3d-sec{margin:10px 0 2px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(226,240,232,.5)}
.la3d-sheet .la3d-warn{margin:8px 0 2px;padding:6px 8px;border-radius:8px;border:1px solid #f59e0b;background:rgba(245,158,11,.1);color:#fde68a;font-size:12px}
.la3d-sheet .la3d-warn div+div{margin-top:3px}
.la3d-sheet .la3d-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;
  color:#06210f;background:#52b788;vertical-align:1px}
.la3d-sheet .la3d-ents{max-height:180px;overflow:auto;margin-top:6px;border-radius:8px;border:1px solid rgba(120,190,155,.2)}
.la3d-sheet .la3d-ents button{all:unset;box-sizing:border-box;display:block;width:100%;padding:6px 8px;cursor:pointer;font-size:12px;color:#e8f0ea}
.la3d-sheet .la3d-ents button small{display:block;color:rgba(226,240,232,.5);font-size:10.5px}
.la3d-sheet .la3d-ents button:hover{background:rgba(82,183,136,.2)}
.la3d-flow{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
.la3d-flow > div{box-sizing:border-box;width:min(560px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;padding:12px 14px;
  border-radius:14px;background:#0b1410;border:1px solid rgba(120,190,155,.3);color:#e8f0ea;box-shadow:0 10px 30px rgba(0,0,0,.6)}
.la3d-flow h4{margin:0 0 8px;display:flex;gap:8px;align-items:center;font-size:14px}
.la3d-flow h4 span{flex:1}`;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const copy = (x) => JSON.parse(JSON.stringify(x));
const metres = (v) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;
/** A recipe's size kept to what the server keeps (5 cm to 8 m; house3d_store.py),
 *  whatever a builder or a flow allows, so a Save is never refused for it. */
function inRange(recipe){
  if (!recipe || typeof recipe !== "object") return recipe;
  for (const k of ["width_m", "depth_m", "height_m"]) {
    const v = num(recipe[k]);
    recipe[k] = Math.round(Math.max(0.05, Math.min(8, v === null ? 0.5 : v)) * 1000) / 1000;
  }
  return recipe;
}

/** The name a piece is shown by: its label, else its builder's name, else its kind. */
export function pieceName(p, FURN){
  const label = p && typeof p.label === "string" ? p.label.trim() : "";
  if (label) return label;
  const kind = String((p && p.recipe && p.recipe.kind) || "piece");
  const b = FURN && FURN.FURNITURE && FURN.FURNITURE[kind];
  return (b && b.name) || (kind.charAt(0).toUpperCase() + kind.slice(1)).replace(/_/g, " ");
}
/** A fit check, said plainly (live_aboard_pieces.js fitChecks). */
export function fitText(w, nameOf){
  const other = w.with ? nameOf(w.with) : "";
  switch (w.kind) {
    case "wall": return "It goes into a wall.";
    case "overlap": return `It overlaps the ${other}.`;
    case "door": return "It is in a door's swing.";
    case "blocks": return w.what === "side" ? `It blocks a side of the ${other}.` : `It blocks the front of the ${other}.`;
    case "blocked": return w.what === "side" ? `The ${other} blocks one of its sides.` : `The ${other} blocks its front.`;
    case "window": return "It is taller than the sill of the window behind it.";
    default: return "It may not fit here.";
  }
}

// ── the pieces, drawn ────────────────────────────────────────────────────────
/**
 * ctx = {THREE, PIECES, FURN (or null), floors() (the view's floors: {fl,
 *        group}), canon(fid) (a piece's floor id as the view names it),
 *        quality() ("low" | "high"), blobTex (a soft round shadow)}
 */
export function createPieceLayer(ctx){
  const { THREE, PIECES } = ctx;
  const drawn = new Map();                  // id -> {root, body, blob, look, F}
  let quality = null;
  const blobMat = new THREE.MeshBasicMaterial({ map: ctx.blobTex || null, color: 0x000000, transparent: true, opacity: 0.42,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const boxMats = new Map();

  const floorOf = (fid) => {
    const id = ctx.canon ? ctx.canon(fid) : String(fid);
    return ctx.floors().find(F => F.fl.id === id) || null;
  };
  function body(p){
    const FURN = ctx.FURN ? ctx.FURN() : null;
    if (FURN && typeof FURN.buildPiece === "function") {
      try { return { g: FURN.buildPiece(THREE, p.recipe, { quality: quality || "low" }), own: false }; } catch (_) { /* a box, below */ }
    }
    // No builders (or one that threw): a coloured box of its size.
    const s = PIECES.sizeOf(p.recipe), c = (p.recipe && Array.isArray(p.recipe.colors) && p.recipe.colors[0]) || "#9a8b78";
    let m = boxMats.get(c + quality);
    if (!m) { m = quality === "high" ? new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }) : new THREE.MeshLambertMaterial({ color: c }); boxMats.set(c + quality, m); }
    const g = new THREE.Group(), mesh = new THREE.Mesh(boxGeo, m);
    mesh.scale.set(s.w, s.h, s.d);
    g.add(mesh);
    return { g, own: true };
  }
  function dropBody(D){
    if (!D.body) return;
    D.root.remove(D.body.g);
    if (!D.body.own) { const FURN = ctx.FURN ? ctx.FURN() : null; try { if (FURN && FURN.disposePiece) FURN.disposePiece(D.body.g); } catch (_) { /* best effort */ } }
    D.body = null;
  }
  function place(D, p){
    const F = floorOf(p.floor_id);
    if (F !== D.F) {
      if (D.root.parent) D.root.parent.remove(D.root);
      if (D.blob && D.blob.parent) D.blob.parent.remove(D.blob);
      D.F = F;
      if (F) { F.group.add(D.root); if (D.blob) F.group.add(D.blob); }
    }
    if (!F) return false;
    const z = num(p.z_m) ?? 0, s = PIECES.sizeOf(p.recipe);
    D.root.position.set(num(p.x_m) ?? 0, F.fl.elev + z, num(p.y_m) ?? 0);
    D.root.rotation.set(0, PIECES.yawOfRot(p.rotation), 0);
    D.root.userData.pieceId = p.id; D.root.userData.entity_id = p.entity_id || null;
    if (D.blob) {
      D.blob.visible = z < 0.05;                       // only under what stands on the floor
      D.blob.position.set(D.root.position.x, F.fl.elev + 0.012, D.root.position.z);
      D.blob.rotation.set(0, D.root.rotation.y, 0);
      D.blob.scale.set(s.w * 1.3 + 0.2, 1, s.d * 1.3 + 0.2);
    }
    return true;
  }
  function dress(D, p){
    const look = JSON.stringify(p.recipe) + "|" + quality;
    if (D.look === look && D.body) return false;
    dropBody(D);
    D.body = body(p);
    D.look = look;
    const high = quality === "high";
    D.body.g.traverse((o) => { if (o.isMesh) { o.castShadow = high; o.receiveShadow = high; } });
    D.root.add(D.body.g);
    if (!high && !D.blob) { D.blob = new THREE.Mesh(blobGeo, blobMat); D.blob.renderOrder = 2; if (D.F) D.F.group.add(D.blob); }
    if (high && D.blob) { if (D.blob.parent) D.blob.parent.remove(D.blob); D.blob = null; }
    return true;
  }
  function remove(id){
    const D = drawn.get(id);
    if (!D) return;
    dropBody(D);
    if (D.root.parent) D.root.parent.remove(D.root);
    if (D.blob && D.blob.parent) D.blob.parent.remove(D.blob);
    drawn.delete(id);
  }
  return {
    /** Draw `pieces` ({id: piece}); `rebuilt`: the floors were made afresh
     *  (their groups are new). True when anything changed. */
    sync(pieces, rebuilt = false){
      const want = pieces && typeof pieces === "object" ? pieces : {};
      const q = ctx.quality() === "high" ? "high" : "low";
      let changed = q !== quality;
      quality = q;
      for (const id of [...drawn.keys()]) if (!want[id]) { remove(id); changed = true; }
      for (const [id, p] of Object.entries(want)) {
        if (!p || typeof p !== "object" || !p.recipe) continue;
        let D = drawn.get(id);
        if (!D) { D = { root: new THREE.Group(), body: null, blob: null, look: null, F: null }; D.root.name = "piece:" + id; drawn.set(id, D); changed = true; }
        if (rebuilt) { D.F = null; if (D.root.parent) D.root.parent.remove(D.root); if (D.blob && D.blob.parent) D.blob.parent.remove(D.blob); }
        if (dress(D, p)) changed = true;
        const before = D.root.position.toArray().join() + D.root.rotation.y + (D.F && D.F.fl.id);
        place(D, p);
        if (before !== D.root.position.toArray().join() + D.root.rotation.y + (D.F && D.F.fl.id)) changed = true;
      }
      return changed;
    },
    /** One piece moved (a drag, a turn, its height): placed again, nothing rebuilt. */
    move(id, p){
      const D = drawn.get(id);
      if (!D || !p) return false;
      return place(D, p);
    },
    rootOf(id){ const D = drawn.get(id); return D && D.F ? D.root : null; },
    /** Every drawn piece on a floor that is showing: {id, root, F}. */
    shown(){ return [...drawn.entries()].filter(([, D]) => D.F && D.F.group.visible).map(([id, D]) => ({ id, root: D.root, F: D.F })); },
    state(){
      return [...drawn.entries()].map(([id, D]) => ({ id, floor: D.F ? D.F.fl.id : null, shown: !!(D.F && D.F.group.visible),
        at: D.root.position.toArray().map(v => Math.round(v * 1000) / 1000), yaw: Math.round(D.root.rotation.y * 1000) / 1000,
        box: !!(D.body && D.body.own), blob: !!(D.blob && D.blob.visible), shadows: !!(D.body && D.body.g.children.some(o => o.castShadow)) }));
    },
    dispose(){
      for (const id of [...drawn.keys()]) remove(id);
      blobGeo.dispose(); blobMat.dispose(); boxGeo.dispose();
      for (const m of boxMats.values()) m.dispose();
      boxMats.clear();
    },
  };
}

// ── the Furnish tool ─────────────────────────────────────────────────────────
/**
 * ctx = {THREE, HOUSE, PIECES, FURN() (the builders or null), root, guard,
 *        tools (the editor's toolbar, the buttons go in it), sheet (its
 *        panel element), layer (createPieceLayer), draft() (the editor's
 *        draft, or null), change(fn, group, moves), redraw(), render(),
 *        hint(text, bad), floors(), topFloor() (the floor the view shows on
 *        top), setTopFloor(fid), viewAt(x, y) → {camera, rect} | null,
 *        centre() → [x, y] (the 3D view's middle on the plan), host() →
 *        {callWS, toast, settings, states, entities}, base (import.meta.url
 *        search, for the flows' modules), paintEditor()}
 */
export function createFurnish(ctx){
  const { THREE, PIECES, root, guard } = ctx;
  let sel = null, gesture = null, menuOpen = false, picker = null, flowEl = null, flowGen = 0, shownNow = false, lastDrag = null;
  let fitHint = null;                                // a fit warning the hint shows, until it no longer applies
  let mods = null;                                   // the flows: {photo, library, import, people} → their function
  let share = null;                                  // the library's shareFlow (P4), when it has one
  const FURN = () => (ctx.FURN ? ctx.FURN() : null);
  const cur = () => { const d = ctx.draft(); return d ? d.cur : null; };
  const pieceOf = (id) => { const c = cur(); return (c && c.pieces && c.pieces[id]) || null; };

  // ── the page ──────────────────────────────────────────────────────────────
  const d = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const btn = (text, title, act, cls) => {
    const b = d("button", cls, text);
    b.type = "button"; b.title = title;
    b.addEventListener("click", guard((e) => { e.stopPropagation(); act(e); }));
    return b;
  };
  const seg = (...items) => { const s = d("span", "lv-zoomseg"); for (const b of items) s.appendChild(b); return s; };
  const style = d("style");
  style.textContent = CSS;
  root.appendChild(style);
  const bBuild = btn("Build ▾", "Add a piece of furniture or a device", () => toggleMenu());
  bBuild.setAttribute("aria-haspopup", "menu");
  const flowBtns = {};
  for (const [k, label] of FLOWS) { flowBtns[k] = btn(label, label, () => openFlow(k)); flowBtns[k].style.display = "none"; }
  const bar = seg(bBuild, ...FLOWS.map(([k]) => flowBtns[k]));
  bar.classList.add("la3d-furbar-seg");
  bar.style.display = "none";
  ctx.tools.insertBefore(bar, ctx.tools.firstChild);
  const menu = d("div", "la3d-furmenu");
  menu.setAttribute("role", "menu");
  root.appendChild(menu);

  // ── marks: the selected piece's outline ───────────────────────────────────
  const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const outlineMat = new THREE.LineBasicMaterial({ color: COL.sel, depthTest: false, transparent: true, opacity: 0.95 });
  const outline = new THREE.LineSegments(outlineGeo, outlineMat);
  outline.renderOrder = 40; outline.visible = false; outline.frustumCulled = false;

  // ── the current floor, its walls, doors and pieces ────────────────────────
  const floorById = (fid) => ctx.floors().find(F => F.fl.id === String(fid)) || null;
  const ceilOf = (F) => F.fl.h - ctx.HOUSE.SLAB_T;
  const wallsOf = (F) => (F ? F.pieces.map(P => ({ ...P.pc, els: P.els })) : []);
  function sceneOf(p){
    const F = floorById(p.floor_id), walls = wallsOf(F);
    const doors = F ? PIECES.doorSwings(walls, (pc) => ctx.HOUSE.openingSwing(pc, F.rooms, pc.override || null)) : [];
    const c = cur(), others = Object.values((c && c.pieces) || {}).filter(o => o.floor_id === p.floor_id && o.id !== p.id);
    return { walls, doors, others };
  }
  const checksOf = (p) => PIECES.fitChecks(p, sceneOf(p));
  const nameOf = (id) => { const p = pieceOf(id); return p ? pieceName(p, FURN()).toLowerCase() : "piece"; };

  // ── adding ────────────────────────────────────────────────────────────────
  function spotHere(F){
    const [cx, cy] = ctx.centre() || [0, 0];
    return PIECES.spotFor(F ? F.rooms : [], cx, cy);
  }
  function recipeFor(kind){
    const B = FURN();
    if (B && typeof B.defaultRecipe === "function") { try { return B.defaultRecipe(kind); } catch (_) { /* a box */ } }
    return { kind: "box", params: {}, colors: ["#9a8b78"], width_m: 0.6, depth_m: 0.6, height_m: 0.6 };
  }
  /** Pieces into the draft, as one step: each on the current floor in the
   *  room under the view's centre unless it says where it goes; the last
   *  one selected. */
  function add(list, extra = null, what = "Added"){
    const F = ctx.topFloor();
    if (!F) { ctx.hint("Show a floor first: there is nowhere to put it.", true); return; }
    const spot = spotHere(F);
    let last = null;
    const ok = ctx.change((c) => {
      for (const item of list) {
        let p = item.piece ? copy(item.piece) : PIECES.makePiece(item.recipe, F.fl.id, spot, item.origin || "build");
        if (item.piece && (typeof p.floor_id !== "string" || num(p.x_m) === null || num(p.y_m) === null)) {
          const made = PIECES.makePiece(p.recipe, F.fl.id, spot, p.origin || item.origin || "import");
          p = { ...made, ...p, floor_id: made.floor_id, x_m: made.x_m, y_m: made.y_m, rotation: num(p.rotation) ?? made.rotation };
        }
        if (!PIECES.PIECE_ID.test(String(p.id))) p.id = PIECES.newPieceId();
        if (item.library_id) p.library_id = item.library_id;
        p.z_m = num(p.z_m) ?? 0;
        inRange(p.recipe);
        c.pieces[p.id] = p;
        last = p;
      }
      if (extra) extra(c);
    });
    if (!ok) return;
    if (last) select(last.id);
    ctx.redraw();
    ctx.hint(last ? `${what}: ${pieceName(last, FURN())}. Drag it into place; nothing is kept until Save.` : `${what}.`);
  }
  function buildMenu(){
    menu.innerHTML = "";
    const B = FURN(), kinds = B && Array.isArray(B.FURNITURE_KINDS) ? B.FURNITURE_KINDS : [];
    const groups = [["furniture", "Furniture"], ["device", "Devices"]];
    // The builders' box ("other") goes last, on its own; with no builders
    // here (the module missing or broken) a box is still something to place.
    const boxKind = kinds.includes("other") ? "other" : "box";
    for (const [g, title] of groups) {
      const ks = kinds.filter(k => k !== boxKind && B.FURNITURE[k] && (B.FURNITURE[k].group || "furniture") === g);
      if (!ks.length) continue;
      menu.appendChild(d("h5", null, title));
      for (const k of ks) menu.appendChild(btn(B.FURNITURE[k].name || k, `Add a ${B.FURNITURE[k].name || k}`, () => { closeMenu(); add([{ recipe: recipeFor(k) }]); }));
    }
    menu.appendChild(d("h5", null, "Other"));
    menu.appendChild(btn("Box", "A plain box of any size: anything with no builder of its own", () => { closeMenu(); add([{ recipe: recipeFor(boxKind) }]); }));
  }
  function toggleMenu(){ if (menuOpen) closeMenu(); else { buildMenu(); menuOpen = true; placeMenu(); menu.classList.add("on"); } }
  function closeMenu(){ menuOpen = false; menu.classList.remove("on"); }
  function placeMenu(){
    const r0 = root.getBoundingClientRect(), r = bBuild.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(r.left - r0.left, r0.width - 220))}px`;
    menu.style.top = `${r.bottom - r0.top + 6}px`;
  }

  // ── the flows (contracts §4) ──────────────────────────────────────────────
  async function loadFlows(){
    if (mods) return mods;
    const base = ctx.base || "";
    mods = {};
    await Promise.all(FLOWS.map(async ([k, , file, fn]) => {
      const m = await import(`./${file}${base}`).catch(() => null);
      mods[k] = m && typeof m[fn] === "function" ? m[fn] : null;
      if (k === "library" && m && typeof m.shareFlow === "function") share = m.shareFlow;
    }));
    for (const [k] of FLOWS) flowBtns[k].style.display = mods[k] ? "" : "none";
    return mods;
  }
  function closeFlow(){ flowGen++; if (flowEl) { flowEl.remove(); flowEl = null; } }
  async function openFlow(k, piece = null){
    closeMenu();
    const fn = k === "share" ? share : mods && mods[k];
    if (!fn) return;
    closeFlow();
    const gen = flowGen, host = ctx.host() || {}, F = ctx.topFloor();
    const spot = F ? spotHere(F) : null;
    flowEl = d("div", "la3d-flow");
    const card = d("div"), h = d("h4"), body = d("div");
    h.appendChild(d("span", null, k === "share" ? "Share" : FLOWS.find(f => f[0] === k)[1]));
    h.appendChild(btn("×", "Close", () => closeFlow(), "la3d-x"));
    card.append(h, body);
    flowEl.appendChild(card);
    root.appendChild(flowEl);
    const callWS = typeof host.callWS === "function" ? host.callWS : () => Promise.reject(new Error("no connection"));
    const fctx = { el: body, callWS, wsCall: callWS, toast: (t, bad) => (host.toast ? host.toast(t, bad) : ctx.hint(t, bad)),
                   settings: host.settings || {}, floor: F ? { id: F.fl.id, name: F.fl.name } : null,
                   room: spot && spot.room ? { name: spot.room.name } : null, recipeTools: FURN() };
    let r = null;
    try { r = await (k === "share" ? fn(fctx, copy(piece)) : fn(fctx)); } catch (err) { r = null; if (gen === flowGen) ctx.hint(`That didn't work: ${String((err && err.message) || err)}`, true); }
    if (gen !== flowGen) return;                     // closed meanwhile: what it found is dropped
    closeFlow();
    if (r && typeof r === "object") take(k, r, piece);
  }
  /** What a flow found, into the draft as one step. */
  function take(k, r, piece){
    if (k === "share" && piece && typeof r.submission_id === "string") {
      if (ctx.change((c) => { if (c.pieces[piece.id]) c.pieces[piece.id].submission_id = r.submission_id; })) { ctx.hint("Shared: Save keeps the link to it."); sheet(); }
    } else if (k === "photo" && r.recipe) {
      const recipe = r.details && typeof r.details === "object" ? { ...r.recipe, details: r.details } : r.recipe;
      add([{ recipe, origin: "photo" }], null, "From the photo");
    } else if (k === "library" && r.recipe) {
      add([{ recipe: r.recipe, origin: "library", library_id: r.library_id || null }], null, "From the library");
    } else if (k === "import") {
      const list = Object.values(r.pieces || {}).filter(p => p && p.recipe).map(p => ({ piece: { ...p, origin: "import" } }));
      const ops = r.openings && typeof r.openings === "object" ? r.openings : null;
      add(list, ops ? (c) => { for (const [id, o] of Object.entries(ops)) { if (o === null) delete c.openings[id]; else c.openings[id] = copy(o); } } : null, "Imported");
    } else if (k === "people") {
      const ok = ctx.change((c) => {
        for (const s of ["figures", "devices"]) {
          for (const [id, v] of Object.entries((r[s] && typeof r[s] === "object") ? r[s] : {})) {
            if (v === null) delete c[s][id]; else c[s][id] = copy(v);
          }
        }
      });
      if (ok) { ctx.redraw(); ctx.hint("People and devices changed: nothing is kept until Save."); }
    }
  }

  // ── selecting, and the panel ──────────────────────────────────────────────
  function select(id){
    if (fitHint && id !== sel) { fitHint = null; ctx.hint(""); }   // that warning was another piece's
    sel = id && pieceOf(id) ? id : null;
    picker = null;
    sheet();
    paint3d();
    ctx.paintEditor();
  }
  function edit(fn, group = null, moves = false){
    if (!sel) return false;
    const id = sel;
    return ctx.change((c) => { const p = c.pieces[id]; if (p) fn(p, c); }, group, moves ? { piece: id } : null);
  }
  const row = (label, input, value) => {
    const r = d("label", "la3d-row");
    r.append(d("span", null, label), input, value || d("b"));
    return r;
  };
  function slider(label, min, max, step, value, fmt, onInput, name = label){
    const inp = d("input");
    inp.type = "range"; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(value);
    inp.setAttribute("aria-label", name);
    const out = d("b", null, fmt(value));
    const gen = `slide:${label}:${sel}:${Math.random()}`;
    inp.addEventListener("input", guard(() => { const v = Number(inp.value); out.textContent = fmt(v); onInput(v, gen); }));
    inp.addEventListener("change", guard(() => { ctx.redraw(); sheet(); }));
    return row(label, inp, out);
  }
  function sheet(){
    const el = ctx.sheet;
    if (!ctx.active()) return false;                    // the editor's other tools own the panel then
    const p = sel ? pieceOf(sel) : null;
    if (!p) { sel = null; el.innerHTML = ""; el.classList.remove("on", "fur"); return false; }
    el.innerHTML = "";
    el.classList.add("fur");
    const B = FURN(), kind = String(p.recipe.kind || ""), spec = B && B.FURNITURE ? B.FURNITURE[kind] : null;
    // The name in the house, and the device it is.
    const h = d("h4");
    const title = d("span", null, pieceName(p, B));
    if (p.entity_id) title.appendChild(d("span", "la3d-badge", "linked"));
    h.append(title, btn("×", "Close", () => select(null), "la3d-x"));
    el.appendChild(h);
    // Under its name: what it is (once it has a name of its own) and where it came from.
    const what = [p.label ? (spec ? spec.name : pieceName({ recipe: { kind } }, null)) : null,
                  { photo: "From a photo", library: "From the library", import: "Imported" }[p.origin] || null].filter(Boolean).join(" · ");
    if (what) el.appendChild(d("p", "la3d-sub", what));
    const lab = d("input", "la3d-fin");
    lab.type = "text"; lab.maxLength = 60; lab.placeholder = "Its name in the house (optional)"; lab.value = p.label || "";
    lab.addEventListener("change", guard(() => { edit((q) => { q.label = [...lab.value].filter(ch => ch >= " " && ch !== "\u007f").join("").trim().slice(0, 60); }); sheet(); }));
    lab.addEventListener("keydown", (e) => e.stopPropagation());
    el.appendChild(lab);
    // Size.
    el.appendChild(d("div", "la3d-sec", "Size"));
    const S = PIECES.sizeOf(p.recipe), lim = (k, i, dflt) => (spec && spec.size && Array.isArray(spec.size[k]) ? spec.size[k][i] : dflt);
    for (const [k, label, name] of [["width_m", "W", "Width"], ["depth_m", "D", "Depth"], ["height_m", "H", "Height"]]) {
      const lo = Math.max(PIECES.SIZE_MIN_M, lim(k, 0, PIECES.SIZE_MIN_M)), hi = Math.min(PIECES.SIZE_MAX_M, lim(k, 1, k === "height_m" ? 3 : 4));
      const v = k === "width_m" ? S.w : k === "depth_m" ? S.d : S.h;
      el.appendChild(slider(label, Math.min(lo, v), Math.max(hi, v), 0.01, v, metres, (val, g) => edit((q) => {
        q.recipe[k] = Math.round(val * 1000) / 1000;
        tidyRecipe(q);
        if (k === "height_m") { const F = floorById(q.floor_id); if (F) q.z_m = PIECES.clampZ(q.z_m, ceilOf(F), PIECES.sizeOf(q.recipe).h); }
      }, g), name));
    }
    // The builder's own settings, and its colours.
    const params = spec && Array.isArray(spec.params) ? spec.params : [];
    if (params.length) el.appendChild(d("div", "la3d-sec", "Style"));
    for (const pr of params) el.appendChild(paramRow(p, pr));
    const names = spec && Array.isArray(spec.colorNames) && spec.colorNames.length ? spec.colorNames : (p.recipe.colors || []).map((_, i) => `Colour ${i + 1}`);
    if (names.length) {
      const cols = d("div", "la3d-cols");
      names.forEach((nm, i) => {
        const inp = d("input");
        inp.type = "color";
        inp.value = /^#[0-9a-f]{6}$/i.test(String((p.recipe.colors || [])[i])) ? p.recipe.colors[i] : ((spec && spec.colors && spec.colors[i]) || "#9a8b78");
        const gen = `colour:${i}:${sel}:${Math.random()}`;
        inp.addEventListener("input", guard(() => edit((q) => {
          const c = Array.isArray(q.recipe.colors) ? q.recipe.colors.slice(0, 6) : [];
          while (c.length < i) c.push((spec && spec.colors && spec.colors[c.length]) || "#9a8b78");
          c[i] = inp.value.toLowerCase();
          q.recipe.colors = c;
        }, gen)));
        inp.addEventListener("change", guard(() => ctx.redraw()));
        const l = d("label");
        l.append(inp, d("span", null, nm));
        cols.appendChild(l);
      });
      el.appendChild(cols);
    }
    // Turn, floor, height.
    el.appendChild(d("div", "la3d-sec", "Place"));
    const turnRow = d("div", "la3d-acts");
    turnRow.append(seg(btn("⟲ 15°", "Turn it anticlockwise", () => turn(-1)), btn("⟳ 15°", "Turn it clockwise", () => turn(1))),
                   d("span", "la3d-sub", `${Math.round(p.rotation || 0)}°`));
    el.appendChild(turnRow);
    const F = floorById(p.floor_id), floors = ctx.floors().map(G => ({ id: G.fl.id, elev: G.fl.elev, outdoor: G.fl.outdoor }));
    const upId = PIECES.floorStep(floors, p.floor_id, 1), downId = PIECES.floorStep(floors, p.floor_id, -1);
    const bUp = btn("Floor ▲", upId ? `Move it up to ${floorById(upId).fl.name}` : "It is on the top floor", () => toFloor(1));
    const bDown = btn("Floor ▼", downId ? `Move it down to ${floorById(downId).fl.name}` : "It is on the bottom floor", () => toFloor(-1));
    bUp.disabled = !upId; bDown.disabled = !downId;
    const floorRow = d("div", "la3d-acts");
    floorRow.append(seg(bUp, bDown), d("span", "la3d-sub", F ? `On ${F.fl.name}` : "Its floor is gone"));
    el.appendChild(floorRow);
    if (F) {
      // Its bottom above its floor, up to the ceiling less its own height:
      // on a shelf, on a table, on a wall.
      el.appendChild(d("div", "la3d-sec", "Height in room"));
      const top = PIECES.zMax(ceilOf(F), S.h);
      el.appendChild(slider("Up", 0, Math.max(top, 0.01), PIECES.Z_STEP_M, Math.min(p.z_m || 0, top), metres,
        (val, g) => edit((q) => { q.z_m = PIECES.clampZ(val, ceilOf(F), PIECES.sizeOf(q.recipe).h); }, g, true), "Height in room"));
      const onFloor = btn("On the floor", "Stand it on the floor", () => { if (edit((q) => { q.z_m = 0; }, null, true)) { ctx.hint("On the floor."); sheet(); paint3d(); } });
      onFloor.disabled = !(p.z_m > 0);
      const hRow = d("div", "la3d-acts");
      hRow.append(seg(onFloor));
      el.appendChild(hRow);
    }
    // Copy, delete, device.
    const acts = d("div", "la3d-acts");
    acts.append(seg(btn("Duplicate", "Another one beside it", () => duplicate()), btn("Delete", "Take it out", () => remove(), "la3d-del")));
    if (share) acts.append(seg(btn("Share…", "Add it to the shared library", () => openFlow("share", p))));
    el.appendChild(acts);
    el.appendChild(deviceRow(p));
    // The fit checks: warnings, never blocks.
    const warns = checksOf(p);
    if (fitHint && !warns.length) { fitHint = null; ctx.hint("It fits here now."); }   // raised onto the table, say
    if (warns.length) {
      const w = d("div", "la3d-warn");
      w.setAttribute("role", "status");
      for (const x of warns) w.appendChild(d("div", null, fitText(x, nameOf)));
      el.appendChild(w);
    }
    el.classList.add("on");
    return true;
  }
  function tidyRecipe(q){
    const B = FURN();
    if (B && typeof B.clampRecipe === "function") { try { q.recipe = B.clampRecipe(q.recipe); } catch (_) { /* kept as it is */ } }
    inRange(q.recipe);
  }
  function paramRow(p, pr){
    const v = p.recipe.params && pr.key in p.recipe.params ? p.recipe.params[pr.key] : pr.def;
    // A setting may bring its own size (a sofa's seats its width, a bed's size
    // all three): the builder says so in `sizes`.
    const set = (val, g = null) => edit((q) => {
      q.recipe.params = { ...(q.recipe.params || {}), [pr.key]: val };
      const s = pr.sizes && pr.sizes[val];
      if (s && typeof s === "object") for (const k of ["width_m", "depth_m", "height_m"]) if (num(s[k]) !== null) q.recipe[k] = s[k];
      tidyRecipe(q);
      const F = floorById(q.floor_id);
      if (F) q.z_m = PIECES.clampZ(q.z_m, ceilOf(F), PIECES.sizeOf(q.recipe).h);
    }, g);
    if (pr.type === "bool") {
      const cb = d("input");
      cb.type = "checkbox"; cb.checked = !!v;
      cb.addEventListener("change", guard(() => { set(cb.checked); ctx.redraw(); }));
      return row(pr.label || pr.key, cb);
    }
    if (pr.type === "choice") {
      const s = d("select", "la3d-fin");
      for (const c of pr.choices || []) {
        const [val, label] = Array.isArray(c) ? [c[0], c[1] ?? c[0]] : c && typeof c === "object" ? [c.value, c.label ?? c.value] : [c, c];
        const o = d("option", null, String(label));
        o.value = String(val);
        s.appendChild(o);
      }
      s.value = String(v);
      s.addEventListener("change", guard(() => { set(s.value); ctx.redraw(); }));
      return row(pr.label || pr.key, s);
    }
    const lo = num(pr.min) ?? 0, hi = num(pr.max) ?? Math.max(1, num(v) ?? 1), st = num(pr.step) ?? (pr.type === "int" ? 1 : 0.01);
    const fmt = (x) => (pr.type === "int" ? String(Math.round(x)) : String(Math.round(x * 100) / 100));
    return slider(pr.label || pr.key, lo, hi, st, num(v) ?? lo, fmt, (val, g) => set(pr.type === "int" ? Math.round(val) : val, g));
  }
  function deviceRow(p){
    const box = d("div");
    box.appendChild(d("div", "la3d-sec", "Device"));
    if (p.entity_id) {
      const host = ctx.host() || {}, st = host.states && host.states[p.entity_id];
      const nm = (st && st.attributes && st.attributes.friendly_name) || p.entity_id;
      const r = d("div", "la3d-acts");
      r.append(d("span", "la3d-sub", `This is ${nm}${st ? "" : " (not found now)"}`),
               seg(btn("Unlink", "It is just furniture again", () => { edit((q) => { q.entity_id = null; q.entity_reg_id = null; }); ctx.hint("Unlinked."); sheet(); })));
      box.appendChild(r);
      return box;
    }
    if (!picker) {
      box.appendChild(seg(btn("This is a device…", "Link it to a light, a TV, a fan…", () => { picker = { q: "" }; sheet(); })));
      return box;
    }
    const q = d("input", "la3d-fin");
    q.type = "search"; q.placeholder = "Find a light, a TV, a fan…"; q.value = picker.q;
    q.addEventListener("keydown", (e) => e.stopPropagation());
    const list = d("div", "la3d-ents");
    const fill = () => {
      list.innerHTML = "";
      for (const e of deviceList(picker.q).slice(0, 60)) {
        const b = btn("", `Link it to ${e.name}`, () => link(e.eid));
        b.textContent = e.name;
        b.appendChild(d("small", null, e.eid));
        list.appendChild(b);
      }
      if (!list.childNodes.length) list.appendChild(d("div", "la3d-sub", "Nothing matches."));
    };
    q.addEventListener("input", guard(() => { picker.q = q.value; fill(); }));
    fill();
    box.append(q, list, seg(btn("Cancel", "Leave it unlinked", () => { picker = null; sheet(); })));
    return box;
  }
  function deviceList(query){
    const host = ctx.host() || {}, states = host.states || {}, s = String(query || "").trim().toLowerCase();
    const p = sel && pieceOf(sel), F = FURN(), def = p && F && F.FURNITURE ? F.FURNITURE[p.recipe.kind] : null;
    const doms = def && SENSOR_LIVE.includes(def.live) ? DEVICE_DOMAINS.concat(SENSOR_DOMAINS) : DEVICE_DOMAINS;
    const out = [];
    for (const eid of Object.keys(states)) {
      if (!doms.includes(eid.split(".")[0])) continue;
      const name = (states[eid].attributes && states[eid].attributes.friendly_name) || eid;
      if (s && !name.toLowerCase().includes(s) && !eid.includes(s)) continue;
      out.push({ eid, name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function link(eid){
    const host = ctx.host() || {}, id = sel;
    let reg = (host.entities && host.entities[eid] && host.entities[eid].id) || null;
    if (!reg && typeof host.callWS === "function") {
      try { const r = await host.callWS({ type: "config/entity_registry/get", entity_id: eid }); reg = (r && r.id) || null; } catch (_) { reg = null; }
    }
    if (sel !== id) return;
    picker = null;
    if (edit((q) => { q.entity_id = eid; q.entity_reg_id = typeof reg === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(reg) ? reg : null; })) ctx.hint("Linked: it is that device now.");
    sheet();
  }
  function turn(dir){
    if (edit((q) => { q.rotation = PIECES.turned(q.rotation, dir); }, null, true)) { sheet(); paint3d(); }
  }
  function toFloor(dir){
    const p = sel && pieceOf(sel);
    if (!p) return;
    const floors = ctx.floors().map(G => ({ id: G.fl.id, elev: G.fl.elev, outdoor: G.fl.outdoor }));
    const to = PIECES.floorStep(floors, p.floor_id, dir), F = to && floorById(to);
    if (!F) return;
    if (!edit((q) => { q.floor_id = to; q.z_m = PIECES.clampZ(q.z_m, ceilOf(F), PIECES.sizeOf(q.recipe).h); })) return;
    ctx.setTopFloor(to);                              // the view follows it, so you see where it went
    ctx.redraw();
    ctx.hint(`Moved ${dir > 0 ? "up" : "down"} to ${F.fl.name}.`);
    sheet();
  }
  function duplicate(){
    const p = sel && pieceOf(sel);
    if (!p) return;
    const twin = PIECES.duplicateOf(p);
    if (ctx.change((c) => { c.pieces[twin.id] = twin; })) { select(twin.id); ctx.redraw(); ctx.hint("Duplicated: the copy is selected."); }
  }
  function remove(){
    const p = sel && pieceOf(sel);
    if (!p) return;
    if (ctx.change((c) => { delete c.pieces[p.id]; })) { select(null); ctx.redraw(); ctx.hint(`Deleted the ${pieceName(p, FURN()).toLowerCase()}. Undo brings it back.`); }
  }

  // ── where things are ──────────────────────────────────────────────────────
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hitV = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  function rayAt(x, y){
    const v = ctx.viewAt(x, y);
    if (!v || !v.camera || !v.rect.width || !v.rect.height) return null;
    ndc.set((x - v.rect.left) / v.rect.width * 2 - 1, -((y - v.rect.top) / v.rect.height) * 2 + 1);
    v.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, v.camera);
    return ray;
  }
  function pieceAt(x, y){
    const r = rayAt(x, y);
    if (!r) return null;
    const shown = ctx.layer.shown();
    const hits = r.intersectObjects(shown.map(s => s.root), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !(o.userData && o.userData.pieceId)) o = o.parent;
      if (o && pieceOf(o.userData.pieceId)) return o.userData.pieceId;
    }
    return null;
  }
  function onPlane(x, y, h){
    const r = rayAt(x, y);
    if (!r) return null;
    plane.set(UP, -h);
    return r.ray.intersectPlane(plane, hitV) ? [hitV.x, hitV.z] : null;
  }

  // ── presses (the view hands them over while the tool is on) ──────────────
  function down(e){
    closeMenu();
    const id = pieceAt(e.clientX, e.clientY);
    if (!id) return "tap";
    const p = pieceOf(id), F = floorById(p.floor_id);
    if (id !== sel) select(id);
    const at = F ? onPlane(e.clientX, e.clientY, F.fl.elev + (p.z_m || 0)) : null;
    if (!at) return "tap";
    gesture = { id, x0: e.clientX, y0: e.clientY, off: [p.x_m - at[0], p.y_m - at[1]], h: F.fl.elev + (p.z_m || 0),
                rot: p.rotation || 0, moved: false, snapped: false, group: `drag:${id}:${Math.random()}` };
    return "drag";
  }
  function move(e){
    const g = gesture;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= SLOP) return;
    g.moved = true;
    const at = onPlane(e.clientX, e.clientY, g.h);
    const p = pieceOf(g.id);
    if (!at || !p) return;
    const F = floorById(p.floor_id);
    const want = { ...p, x_m: Math.round((at[0] + g.off[0]) * 1000) / 1000, y_m: Math.round((at[1] + g.off[1]) * 1000) / 1000, rotation: g.rot };
    const s = PIECES.snapToWall(want, null, wallsOf(F));
    g.snapped = !!s;
    ctx.change((c) => {
      const q = c.pieces[g.id];
      if (!q) return;
      q.x_m = s ? s.x_m : want.x_m; q.y_m = s ? s.y_m : want.y_m; q.rotation = s ? s.rotation : g.rot;
    }, g.group, { piece: g.id });
    paint3d();
  }
  function up(){
    const g = gesture;
    gesture = null;
    if (!g) return;
    lastDrag = { id: g.id, moved: g.moved, snapped: g.snapped };
    if (g.moved) {
      ctx.redraw();
      const p = pieceOf(g.id), warns = p ? checksOf(p) : [];
      fitHint = warns.length ? fitText(warns[0], nameOf) : null;
      ctx.hint(fitHint || (g.snapped ? "Its back is against the wall." : "Moved."), !!fitHint);
    }
    sheet();
    paint3d();
  }
  function tap(){ gesture = null; if (sel) select(null); }
  function cancel(){ gesture = null; }
  function hover(e){ return pieceAt(e.clientX, e.clientY) ? "grab" : ""; }

  // ── drawing the marks ─────────────────────────────────────────────────────
  /** The picked piece's outline, where the piece is drawn now (green, amber
   *  with a fit warning). render: ask for a frame (a redraw has one coming). */
  function paint3d(render = true){
    const p = sel && pieceOf(sel), F = p && floorById(p.floor_id);
    if (!p || !F || !ctx.active()) {
      const was = outline.visible;
      outline.visible = false;
      if (outline.parent) outline.parent.remove(outline);
      if (was && render) ctx.render();
      return;
    }
    // From the draft itself (the piece is drawn there a frame later).
    if (outline.parent !== F.group) { if (outline.parent) outline.parent.remove(outline); F.group.add(outline); }
    const s = PIECES.sizeOf(p.recipe);
    outline.position.set(num(p.x_m) ?? 0, F.fl.elev + (num(p.z_m) ?? 0), num(p.y_m) ?? 0);
    outline.rotation.set(0, PIECES.yawOfRot(p.rotation), 0);
    outline.scale.set(s.w + 0.04, s.h + 0.02, s.d + 0.04);
    outlineMat.color.set(checksOf(p).length ? COL.warn : COL.sel);
    outline.visible = true;
    if (render) ctx.render();
  }

  return {
    get selected(){ return sel; },
    /** Furnish on (the tool is open) or off. */
    show(on){
      if (!!on === shownNow) return;
      shownNow = !!on;
      bar.style.display = on ? "" : "none";
      if (on) loadFlows().catch(() => {});
      else { closeMenu(); closeFlow(); sel = null; gesture = null; picker = null; paint3d(); }
    },
    sheet, down, move, up, tap, cancel, hover, paint3d, select,
    /** After Undo, Redo, Discard or a Save: the selection only if it is still there. */
    refresh(){ if (sel && !pieceOf(sel)) sel = null; picker = null; paint3d(); },
    /** Every frame (the view draws nothing at rest, so this asks for none). */
    layout(){ if (menuOpen) placeMenu(); },
    state(){
      return { sel, menu: menuOpen, flows: mods ? Object.keys(mods).filter(k => mods[k]) : null, gesture: gesture ? { id: gesture.id, moved: gesture.moved, snapped: gesture.snapped } : null,
               checks: sel && pieceOf(sel) ? checksOf(pieceOf(sel)).map(w => w.kind) : [], outline: outline.visible ? "#" + outlineMat.color.getHexString() : null,
               flowOpen: !!flowEl, picker: !!picker, lastDrag };
    },
    /** For the harness and a test: add a piece of a kind, as Build does. */
    build(kind){ add([{ recipe: recipeFor(kind) }]); return sel; },
    dispose(){ closeFlow(); if (outline.parent) outline.parent.remove(outline); outlineGeo.dispose(); outlineMat.dispose(); },
  };
}
