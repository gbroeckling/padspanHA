// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Add data via plans, the vetting map (views/live_aboard_plans.js), RUN rather
// than read, with a counting three.js and a stub scene: the verdict state machine
// through the real draft (New, Correction, Failure, Later, Looks right, Undo,
// take that back), ghosts outside the draft until accepted (so no stair cut),
// the one bulk action that never marks anything wrong, one texture at a time,
// the keys, Move by hand, stacked stairs, two plans that disagree, recaps, the
// what's-missing pass, the track record, and the list with no 3D behind it.
// The pytest wrapper is tests/test_plan_ai.py.
//
// Run:  node tests/js/plans_map.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const W = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const P = await import(pathToFileURL(W + "live_aboard_plans.js").href);
const FURNITURE = await import(pathToFileURL(W + "live_aboard_furniture.js").href);
const DRAFT = await import(pathToFileURL(W + "live_aboard_draft.js").href);
const STOREY = await import(pathToFileURL(W + "live_aboard_storey.js").href);
const PIECES = await import(pathToFileURL(W + "live_aboard_pieces.js").href);

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const tag = (n) => (n.tagName || "").toUpperCase();
const buttons = (sheet) => all(sheet).filter(n => tag(n) === "BUTTON");
const label = (b) => all(b).length ? text(b).replace(/ ?(N|C|F|L|Enter)$/, "") : text(b);
const button = (sheet, word) => buttons(sheet).find(b => label(b) === word) || null;
const click = async (b) => { b.dispatchEvent(new Event("click", { bubbles: true })); await settle(); };

// ── a three.js that counts ───────────────────────────────────────────────────
const live = { textures: 0, made: 0, disposed: 0 };
class Obj {
  constructor() { this.children = []; this.parent = null; this.position = { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } }; this.rotation = { y: 0, set(a, b, c) { this.y = b; } }; this.userData = {}; this.visible = true; }
  add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); }
  remove(c) { this.children = this.children.filter(x => x !== c); c.parent = null; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
}
class Mat { constructor(o = {}) { Object.assign(this, { opacity: 1 }, o); this.isMat = true; } clone() { return new Mat(this); } dispose() { this.gone = true; } }
const THREE = {
  Group: Obj, DoubleSide: 2,
  Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } },
  MeshBasicMaterial: Mat,
  BufferGeometry: class { setAttribute() {} setIndex() {} dispose() {} },
  CircleGeometry: class { rotateX() { return this; } dispose() {} },
  BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
  CanvasTexture: class { constructor(c) { this.image = c; live.textures++; live.made++; } dispose() { live.textures--; live.disposed++; } },
  Raycaster: class { constructor() { this.ray = { intersectPlane: (_p, v) => { v.x = RAY[0]; v.z = RAY[1]; return v; } }; } setFromCamera() {} },
  Vector2: class { set() {} }, Plane: class { set() {} }, Vector3: class {},
};
let RAY = [0, 0];
// Pictures load when the test says.
const pictures = [];
globalThis.Image = class { constructor() { this.naturalWidth = 3000; this.naturalHeight = 2000; pictures.push(this); } addEventListener() {} set src(v) { this._src = v; } get src() { return this._src; } };
const loadAll = () => { for (const im of pictures.splice(0)) if (im.onload) im.onload(); };
const canvases = [];
const realCreate = document.createElement.bind(document);
document.createElement = (t) => { const n = realCreate(t); if (String(t) === "canvas") canvases.push(n); return n; };

const FURN = { buildPiece: () => { const g = new Obj(); const m = new THREE.Mesh({}, new Mat({ color: 1 })); g.add(m); g.userData = {}; return g; }, disposePiece: () => {} };

// ── a session ────────────────────────────────────────────────────────────────
const stairPc = (id, x, y, over = {}) => ({ id, floor_id: "main", x_m: x, y_m: y, z_m: 0, rotation: 0, label: "Hall stairs", origin: "build", recipe: { kind: "stairs", params: { shape: "straight", rail: "none" }, width_m: 1, depth_m: 3, height_m: 2.8 }, ...over });
const stair = (id, x, y, match = {}, extra = {}) => ({ id, kind: "stairs", map_id: "m1", floor_id: "main", state: "queued", verdict: null, seen_on: [{ map_id: "m1" }], box_px: [1, 1, 2, 2], frame: [100, 100],
  geom: { x_m: x, y_m: y, width_m: 1.1, depth_m: 3.2, rotation: 0, shape: "straight" }, match: { relation: "new", near: [], near_names: [], held: null, ...match }, ...extra });
const SUGS = () => ({
  a: stair("a", 1, 1),
  b: stair("b", 4, 4, { relation: "correction", target: "fur_0000000f", distance_m: 1.4, hand: true, target_snap: { label: "Hall stairs" } }),
  c: stair("c", 6, 1, { others: [{ map_id: "m2", distance_m: 1.5 }] }),
  c2: stair("c2", 6, 2.5, { others: [{ map_id: "m1", distance_m: 1.5 }] }, { map_id: "m2" }),
  s: stair("s", 3.2, 4.2, { relation: "stacked", target: "fur_0000000f", distance_m: 0.2, target_snap: { label: "Hall stairs" } }),
  r: { ...stair("r", 1, 1), kind: "railing", of_stair: "a", geom: { stair: "a", side: null, x_m: 1, y_m: 1 } },
  u: stair("u", 2, 2, {}, { floor_id: "upper", map_id: "m3" }),
  dup: stair("dup", 3, 4, { relation: "duplicate", target: "fur_0000000f" }, { state: "duplicate" }),
});
const SESSION = (s) => ({ id: "ps_1", rev: 1, status: "done", spent_s: 10, budget_s: 480, frame: "probed", reads: 1, skipped: 0, errors: {}, suggestions: s,
  plans: [{ map_id: "m1", name: "Main floor", floor_id: "main", read: true, answered: true }, { map_id: "m2", name: "Electrical", floor_id: "main", read: true, answered: true },
          { map_id: "m3", name: "Upper floor", floor_id: "upper", read: true, answered: true }, { map_id: "m4", name: "Basement", floor_id: "basement", read: true, answered: true }] });
const INFO = { plans: [["m1", "Main floor", "main"], ["m2", "Electrical", "main"], ["m3", "Upper floor", "upper"], ["m4", "Basement", "basement"]].map(([map_id, name, floor_id]) => ({ map_id, name, floor_id, refs: 2, corners_m: [[0, 0], [10, 0], [10, 10], [0, 10]] })),
  ai: { ready: true, name: "Mac", local: true }, running: null, latest: "ps_1", start_blocked: null };
const FLOORS = () => [
  { fl: { id: "basement", name: "Basement", elev: -2.8 }, rooms: [] },
  { fl: { id: "main", name: "Main", elev: 0 }, rooms: [{ name: "Hall", pts: [[0, 0], [20, 0], [20, 20], [0, 20]] }] },
  { fl: { id: "upper", name: "Upper", elev: 2.8 }, rooms: [] },
];

function mount(over = {}) {
  const sess = SESSION(over.suggestions || SUGS());
  const sheet = document.createElement("div"), root = document.createElement("div"), scene = new Obj();
  root.clientWidth = 1200;
  root.isConnected = true;
  sheet.scrollTop = 0;
  const calls = [], hints = [], floors = FLOORS(), M = { floor: "main", shell: 1, flown: [], quiet: [], renders: 0, telemetry: [] };
  const answers = {
    maps_image_urls: { image_urls: { m1: "/u/m1", m2: "/u/m2", m3: "/u/m3", m4: "/u/m4" } },
    plan_ai_plans: INFO,
    plan_ai_status: () => ({ session: sess, undo: over.undo || null, record: over.record || null }),
    plan_ai_verdict: (m) => {
      const s = sess.suggestions[m.sug_id];
      if (m.v === "back") { s.state = "queued"; s.verdict = null; } else { s.state = m.v; s.verdict = { v: m.v, why: m.why || null }; }
      return { rev: ++sess.rev, suggestion: s, changed: [], record: over.record || null };
    },
    ...(over.answers || {}),
  };
  const callWS = async (m) => {
    calls.push(m);
    const a = answers[m.type.replace("padspan_ha/", "")];
    return typeof a === "function" ? a(m) : a;
  };
  const draft = DRAFT.createDraft(DRAFT.ownedOf({ schema: 1, pieces: { fur_0000000f: stairPc("fur_0000000f", 2.6, 4) } }));
  let tool, n = 0;
  const redraw = () => { sheet.replaceChildren(); tool.sheet(); };
  tool = P.createPlans({ root, sheet, guard: (f) => f, host: () => ({ callWS, telemetry: (t) => M.telemetry.push(t), ...(over.host || {}) }), floors: () => floors, hint: (t, bad) => hints.push([t, bad]), redraw,
    DRAFT, draft: () => draft, change: (fn) => { const ok = draft.change(fn); if (ok) redraw(); return ok; }, saving: () => false, save: () => { M.saved = true; },
    stairPiece: (g, fid, lab) => stairPc(`fur_0000000${++n}`, g.x_m, g.y_m, { floor_id: fid, label: lab }), fileWritten: () => {},
    THREE, PIECES, STOREY, FURN: () => FURN, recipeOf: (p) => p.recipe, canon: (f) => String(f), compass: () => ({ north: [0, -1], east: [1, 0] }),
    scene: () => scene, camera: () => ({ updateMatrixWorld() {} }), rect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    screenAt: (_F, x, y) => [x * 20 + 100, y * 20 + 100], shellGen: () => M.shell, render: () => { M.renders++; }, redrawHouse: () => {},
    currentFloor: () => floors.find(F => F.fl.id === M.floor), setTopFloor: (fid) => { M.floor = fid; }, picked: () => null,
    flySpot: (F, x, y, span, pad) => { M.flown.push({ floor: F.fl.id, x, y, span, pad }); }, quiet: (on) => { M.quiet.push(on); },
    undo: () => { draft.undo(); redraw(); }, addByHand: () => { M.byHand = true; } });
  return { sheet, root, scene, tool, calls, hints, draft, M, floors, sess, redraw, sent: (t) => calls.filter(c => c.type === `padspan_ha/${t}`), state: () => tool.state(), pin: (id) => tool.state().pins.find(q => q.id === id) };
}
const key = (M, k) => { const ok = M.tool.key({ key: k, target: {} }); return settle().then(() => ok); };
const walk = async (M, id) => { for (let i = 0; i < 12 && M.state().cur !== id; i++) await click(buttons(M.sheet).find(b => text(b) === "›")); };
const openMap = async (M) => { M.tool.show(true); await settle(); M.redraw(); await settle(); };

// ── the pure rules ───────────────────────────────────────────────────────────
{
  const s = (state, extra = {}) => ({ state, verdict: null, ...extra });
  check("pinState: each state's colour word", P.pinState(s("queued")) === "queued" && P.pinState(s("later")) === "later" && P.pinState(s("stale")) === "stale" && P.pinState(s("right")) === "right"
    && P.pinState(s("failure"), null) === "failure" && P.pinState(s("committed_new")) === "kept_new" && P.pinState(s("committed_correction")) === "kept_correction", "");
  check("pinState: the draft's word wins", P.pinState(s("queued"), { v: "new" }) === "new" && P.pinState(s("queued"), { v: "correction" }) === "correction", "");
  check("pinState: no pin for what the queue doesn't hold", P.pinState(s("duplicate")) === null && P.pinState(s("settled")) === null && P.pinState(s("undone")) === null && P.pinState({ state: "failure", verdict: { remembered: true } }) === null, "");
  const order = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const states = { a: "new", b: "later", c: "queued", d: "stale" };
  check("nextOpen: open first, round from where you are", P.nextOpen(order, "c", x => states[x.id]).id === "d" && P.nextOpen(order, "d", x => states[x.id]).id === "c", "");
  const later = { a: "new", b: "later", c: "later", d: "new" };
  check("nextOpen: Later comes back at the end, a pass through it ends", P.nextOpen(order, "a", x => later[x.id]).id === "b" && P.nextOpen(order, "b", x => later[x.id]).id === "c" && P.nextOpen(order, "c", x => later[x.id]) === null, "");
  const items = [{ id: "r", of_stair: "x", geom: {} }, { id: "y", geom: { x_m: 1, y_m: 1 }, up: 1 }, { id: "x", geom: { x_m: 5, y_m: 0 }, up: 0 }, { id: "w", geom: { x_m: 0, y_m: 0 }, up: 0 }];
  const ord = P.orderItems(items, (i) => i.up ?? 0, () => 0).map(i => i.id).join();
  check("orderItems: floor by floor, a hint straight after its stair", ord === "w,x,r,y", ord);
  check("fitSize: at most 1024, never enlarged", P.fitSize(3000, 2000).join() === "1024,683" && P.fitSize(800, 600).join() === "800,600", P.fitSize(3000, 2000).join());
  check("moveWords: compass words", P.moveWords(1.4, 0, { north: [0, -1], east: [1, 0] }) === "1.4 m east" && P.moveWords(0, 2, { north: [0, -1], east: [1, 0] }) === "2.0 m south", P.moveWords(1.4, 0, { north: [0, -1], east: [1, 0] }));
  const placed = P.spreadPins([[10, 10], [10, 10], null, [100, 100]], 40);
  check("spreadPins: two on one spot both pressable; one alone stays; null stays", Math.hypot(placed[0][0] - placed[1][0], placed[0][1] - placed[1][1]) >= 40 && placed[0][0] === 10 && placed[2] === null && placed[3][0] === 100, JSON.stringify(placed));
  check("dashTriangles: real geometry, six vertices a dash", P.dashTriangles([[0, 0], [1, 0]], false, 0.24, 0.16, 0.05).length % 18 === 0 && P.dashTriangles([[0, 0], [1, 0]], false).length > 0, "");
  const lines = P.missingLines("main", [stair("x", 5, 5, {}, { map_id: "m1" })], [{ map_id: "m1", name: "Main floor", floor_id: "main", answered: true }, { map_id: "m2", name: "Electrical", floor_id: "main", answered: true }, { map_id: "m3", name: "Up", floor_id: "upper", answered: true }],
    [{ id: "p", room: "Hall", x: 0, y: 0 }, { id: "q", room: "Den", x: 5, y: 5 }]);
  check("missingLines: no stairs on a plan, your stair not seen, near one counts as seen", lines.includes("The AI found no stairs on the Electrical plan.") && lines.includes("Your 3D stair in Hall wasn't seen on Main floor.") && !lines.some(l => l.includes("Den")) && !lines.some(l => l.includes("Up")), JSON.stringify(lines));
  const light = P.missingLines("main", [{ ...stair("l", 1, 1), kind: "light", state: "unmatched" }, stair("i", 1, 1, {}, { state: "failure", verdict: { remembered: true } })], [], []);
  check("missingLines: fixtures with no light (Stage 3's) and ignored ones", light.some(l => l.startsWith("1 fixture symbol")) && light.includes("1 ignored before."), JSON.stringify(light));
}
// ── opening: quiet, one floor, ghosts outside the draft ──────────────────────
{
  const M = mount();
  M.M.floor = "upper";
  await openMap(M);
  const st = M.state();
  check("open: the map shows, one card, the first item's floor", st.onMap && st.cur === "a" && M.M.floor === "main", JSON.stringify(st));
  check("open: the house goes quiet", M.M.quiet.at(-1) === true, JSON.stringify(M.M.quiet));
  check("open: pins for this floor only, numbered in order, a duplicate has none", st.pins.map(p => p.id).join() === "a,r,c,c2,b,s" && st.pins[0].n === 1 && !M.pin("dup") && !M.pin("u"), JSON.stringify(st.pins));
  check("open: ghosts for this floor's stairs", ["a", "b", "c", "c2", "s"].every(id => st.ghosts.includes(id)) && !st.ghosts.includes("u") && !st.ghosts.includes("dup"), st.ghosts.join());
  check("ghosts: NOT in the draft, nothing unsaved", !M.draft.dirty && Object.keys(M.draft.cur.pieces).join() === "fur_0000000f", Object.keys(M.draft.cur.pieces).join());
  const floorsPlain = FLOORS().map(F => F.fl);
  const cuts = STOREY.stairCuts(M.draft.cur.pieces, floorsPlain);
  const before = JSON.stringify([...cuts.entries()]);
  check("ghosts: cut no floor (only the house's own stair does)", [...cuts.values()].every(list => list.length === 1), before);
  check("ghosts: drawn by the real builder at 45 %, dashed amber beside them", M.scene.children[0].children.filter(c => c.name && c.name.startsWith("plan-ghost")).every(g => g.children[0].children[0].material.opacity === 0.45 && g.children[0].children[0].material.transparent), "");
  check("ghosts: the real builder's own material untouched", M.scene.children[0].children.some(c => c.material && c.material.color === "#f59e0b" && c.material.depthTest === false), "");
  // Later: the verdict row, and no accept-all of any kind.
  const words = buttons(M.sheet).map(label);
  check("card: New, Correction, Failure, Looks right, Later", ["New", "Correction", "Failure", "Looks right", "Later"].every(w => words.includes(w)), words.join("|"));
  check("card: an experimental chip and the numbers, always", text(M.sheet).includes("EXPERIMENTAL") && text(M.sheet).includes("About 2 in 10 stairs are wrong"), text(M.sheet));
  check("card: no confidence number and no record before five", !text(M.sheet).includes("% ") && !text(M.sheet).includes("right in this house"), text(M.sheet));
  M.tool.dispose();
}
// ── the state machine, through the real draft ────────────────────────────────
{
  const M = mount();
  await openMap(M);
  const before = M.calls.length;
  await click(button(M.sheet, "New"));
  let held = DRAFT.planPending(M.draft.cur);
  check("New: into the draft only, no server call", held.length === 1 && held[0].sug_id === "a" && M.calls.length === before && M.draft.dirty, JSON.stringify(held));
  check("New: the pin goes green, its ghost goes (it is a piece now)", M.pin("a").state === "new" && !M.state().ghosts.includes("a"), JSON.stringify(M.pin("a")));
  check("New: on to the next, its railing hint", M.state().cur === "r", M.state().cur);
  check("New: one undo step (Undo clears the pin, the ghost comes back, nothing counted)", M.draft.undo() && (M.redraw(), M.pin("a").state === "queued" && M.state().ghosts.includes("a") && M.calls.length === before), JSON.stringify(M.pin("a")));
  M.tool.dispose();
  // Failure: written at click, one reason, default offered; take that back.
  const F = mount();
  await openMap(F);
  await click(button(F.sheet, "Failure"));
  const chips = ["Wrong place", "Nothing there", "Already here", "Wrong kind", "Can't tell"];
  check("Failure: asks one reason, nothing sent yet", chips.every(c => !!button(F.sheet, c)) && F.sent("plan_ai_verdict").length === 0, text(F.sheet));
  await click(button(F.sheet, "Nothing there"));
  const v = F.sent("plan_ai_verdict")[0];
  check("Failure: written at click with its reason, the pin grey, on to the next", v && v.v === "failure" && v.why === "nothing_there" && F.pin("a").state === "failure" && F.state().cur !== "a", JSON.stringify(v));
  check("Failure: never in the draft, its ghost gone", !F.draft.dirty && !F.state().ghosts.includes("a"), "");
  await key(F, "Backspace");
  check("Backspace: back to it, says what it was", F.state().cur === "a" && text(F.sheet).includes("Marked wrong: Nothing there"), text(F.sheet));
  await click(button(F.sheet, "Take that back"));
  check("take that back: a server call, queued again", F.sent("plan_ai_verdict").at(-1).v === "back" && F.pin("a").state === "queued", JSON.stringify(F.sent("plan_ai_verdict").at(-1)));
  // Later and Looks right: written at click, Later returns at the end.
  await click(button(F.sheet, "Later"));
  check("Later: written at click, the pin hollow", F.sent("plan_ai_verdict").at(-1).v === "later" && F.pin("a").state === "later", "");
  await key(F, "Backspace");
  await click(button(F.sheet, "Take that back"));
  await click(button(F.sheet, "Looks right"));
  check("Looks right: written at click, nothing in the draft", F.sent("plan_ai_verdict").at(-1).v === "right" && F.pin("a").state === "right" && !F.draft.dirty, "");
  F.tool.dispose();
  // Discard: nothing pending; what was written stays written.
  const D = mount();
  await openMap(D);
  await click(button(D.sheet, "New"));
  await click(button(D.sheet, "Failure"));
  await click(button(D.sheet, "Nothing there"));
  const n = D.sent("plan_ai_verdict").length;
  D.draft.discard(); D.redraw();
  check("Discard: the pending pin back to queued, the failure still failure, no call", D.pin("a").state === "queued" && D.pin("r").state === "failure" && D.sent("plan_ai_verdict").length === n, JSON.stringify(D.state().pins));
  D.tool.dispose();
}
// ── a correction: onion skin, Keep mine, Take, Move by hand ──────────────────
{
  let focused = null;
  const proto = Object.getPrototypeOf(document.createElement("button"));
  const real = proto.focus;
  proto.focus = function () { focused = text(this); };
  const M = mount();
  await openMap(M);
  await click(buttons(M.sheet).find(b => text(b) === "›"));
  check("queue: the next button walks in order, a hint after its stair", M.state().cur === "r", M.state().cur);
  await walk(M, "b");
  check("correction: says who placed it and the move in compass words", text(M.sheet).includes("You placed this one. The AI puts it 1.4 m east. Keep yours unless the plan says otherwise."), text(M.sheet));
  check("correction: Keep mine has the keyboard on a hand-placed stair", focused && focused.startsWith("Keep mine"), focused);
  check("correction: a Fade slider, and its ghost fades", all(M.sheet).some(n => tag(n) === "INPUT" && n.getAttribute && n.getAttribute("aria-label") && n.getAttribute("aria-label").startsWith("Fade")), text(M.sheet));
  check("correction: before and after: the stair stays where it is, the ghost is the AI's", M.draft.cur.pieces.fur_0000000f.x_m === 2.6 && M.state().ghosts.includes("b"), "");
  await click(button(M.sheet, "Take the AI's position"));
  const p = DRAFT.planPending(M.draft.cur)[0];
  check("Take: the target moved in the draft, one step, the pin blue, the file's stair unchanged", p.v === "correction" && M.draft.cur.pieces.fur_0000000f.x_m === 4 && M.draft.base.pieces.fur_0000000f.x_m === 2.6 && M.pin("b").state === "correction", JSON.stringify(p));
  await key(M, "z");
  check("Z: Undo takes the correction back", M.pin("b").state === "queued" && M.draft.cur.pieces.fur_0000000f.x_m === 2.6, JSON.stringify(M.pin("b")));
  await click(button(M.sheet, "Move by hand"));
  check("Move by hand: accepted, then yours to drag", M.state().moving === "fur_0000000f" && M.pin("b").state === "correction" && text(M.sheet).includes("Drag"), JSON.stringify(M.state()));
  RAY = [4, 4];
  const g = M.tool.down({ clientX: 10, clientY: 10, pointerType: "mouse" });
  RAY = [5.5, 4.5];
  M.tool.move({ clientX: 60, clientY: 40 });
  M.tool.up({ clientX: 60, clientY: 40 });
  check("Move by hand: a drag on it moves it in the draft, one step", g === "drag" && M.draft.cur.pieces.fur_0000000f.x_m === 5.5 && DRAFT.planPending(M.draft.cur).length === 1 && text(M.sheet).includes("from where the AI put it"), `${g} ${JSON.stringify(M.draft.cur.pieces.fur_0000000f.x_m)}`);
  await key(M, "Enter");
  check("Move by hand: Enter is Done, on to the next", M.state().moving === null && M.state().cur !== "b", JSON.stringify(M.state()));
  M.tool.dispose();
  focused = null;
  const Ai = SUGS(); Ai.b.match.hand = false; Ai.b.match.target_snap = { label: "Stairs (from the plan)" };
  const A = mount({ suggestions: Ai });
  await openMap(A);
  await walk(A, "b");
  check("correction: the AI's position has the keyboard only on a stair the AI placed", focused && focused.startsWith("Take the AI's position") && !text(A.sheet).includes("You placed this one"), focused);
  A.tool.dispose();
  proto.focus = real;
  const K = mount();
  await openMap(K);
  await walk(K, "b");
  await click(button(K.sheet, "Keep mine"));
  const km = K.sent("plan_ai_verdict").at(-1);
  check("Keep mine: already here, written at click, the stair untouched", km.v === "failure" && km.why === "already_here" && !K.draft.dirty, JSON.stringify(km));
  K.tool.dispose();
}
// ── the keys ─────────────────────────────────────────────────────────────────
{
  const M = mount();
  await openMap(M);
  check("N: new", await key(M, "n") && M.pin("a").state === "new", JSON.stringify(M.pin("a")));
  const atRail = M.state().cur;
  await key(M, "z");
  check("Z: undoes it (a draft step)", M.pin("a").state === "queued" && M.state().cur === "a", `${atRail} ${JSON.stringify(M.pin("a"))}`);
  await key(M, "f");
  check("F: asks the reason; Escape lets go", !!button(M.sheet, "Wrong place") && M.tool.key({ key: "Escape", target: {} }) && !button(M.sheet, "Wrong place"), text(M.sheet));
  await key(M, "f"); await key(M, "f");
  check("F twice: the default reason", M.sent("plan_ai_verdict").at(-1).why === "nothing_there" && M.pin("a").state === "failure", JSON.stringify(M.sent("plan_ai_verdict").at(-1)));
  await key(M, "z");
  check("Z: a verdict written at click is taken back at the server", M.sent("plan_ai_verdict").at(-1).v === "back" && M.pin("a").state === "queued", JSON.stringify(M.sent("plan_ai_verdict").at(-1)));
  await key(M, "l");
  check("L: later", M.pin("a").state === "later", "");
  await key(M, "Backspace");
  check("Backspace: the one before", M.state().cur === "a", M.state().cur);
  await key(M, "Enter");
  check("Enter: the next", M.state().cur === "r", M.state().cur);
  const on = M.state().planShown;
  await key(M, "p");
  check("P: the plan on and off, no server, no draft", M.state().planShown === false && on === false || M.tool.state().planShown === on, "");
  check("keys: a button with focus keeps its Enter", M.tool.key({ key: "Enter", target: { tagName: "BUTTON" } }) === false, "");
  check("keys: a pin with focus: Enter is the next item", M.tool.key({ key: "Enter", target: { tagName: "BUTTON", classList: { contains: (c) => c === "pl-pin" } } }) === true, "");
  check("keys: never while typing, seen through the shadow root", M.tool.key({ key: "n", target: { tagName: "PADSPAN-HA-APP" }, composedPath: () => [{ tagName: "INPUT" }] }) === false, "");
  check("keys: a chord is the browser's", M.tool.key({ key: "z", ctrlKey: true, target: {} }) === false && M.tool.key({ key: "n", metaKey: true, target: {} }) === false, "");
  check("keys: nothing with the map closed", (M.tool.show(false), M.tool.key({ key: "n", target: {} }) === false), "");
  M.tool.dispose();
}
// ── no accept-all; Dismiss the rest ──────────────────────────────────────────
{
  const M = mount();
  await openMap(M);
  await click(button(M.sheet, "New"));
  await click(buttons(M.sheet).find(b => text(b) === "More"));
  const words = buttons(M.sheet).map(text);
  check("no accept-all: no such button anywhere", !words.some(t => /accept|approve|keep all|all new/i.test(t)), words.join("|"));
  check("no accept-all: the keep button counts only what was accepted", words.some(t => t === "Keep 1 new (one undo for the whole session)"), words.join("|"));
  await click(button(M.sheet, "Dismiss the rest"));
  check("Dismiss the rest: asks first, says what it does", text(M.sheet).includes("go to Later. None is marked wrong or kept.") && M.sent("plan_ai_verdict").length === 0, text(M.sheet));
  await click(button(M.sheet, "Dismiss them"));
  const sent = M.sent("plan_ai_verdict");
  check("Dismiss the rest: everything unvetted goes to Later, nothing to wrong", sent.length >= 4 && sent.every(c => c.v === "later"), JSON.stringify(sent.map(c => c.v)));
  check("Dismiss the rest: what was accepted stays accepted", M.pin("a").state === "new" && DRAFT.planPending(M.draft.cur).length === 1, JSON.stringify(M.pin("a")));
  check("Dismiss the rest: revs in order, one each", new Set(sent.map(c => c.rev)).size === sent.length, JSON.stringify(sent.map(c => c.rev)));
  M.tool.dispose();
}
// ── one texture at a time ────────────────────────────────────────────────────
{
  live.textures = 0; live.made = 0; live.disposed = 0; pictures.length = 0; canvases.length = 0;
  const M = mount();
  await openMap(M);
  check("plan: nothing until the picture is in", live.textures === 0 && M.state().plan === "m1", JSON.stringify(M.state()));
  loadAll();
  check("plan: one texture, downscaled to 1024", live.textures === 1 && canvases.some(c => c.width === 1024 && c.height === 683), JSON.stringify(canvases.map(c => [c.width, c.height])));
  check("plan: a plane in the scene, at its opacity, from the server's corners", M.state().planShown && M.state().opacity === 0.7, JSON.stringify(M.state()));
  await click(button(M.sheet, "Electrical"));
  check("plan: the switch releases the first before the second arrives", live.textures === 0 && live.disposed === 1 && M.state().plan === "m2", JSON.stringify(live));
  loadAll();
  check("plan: the second is the only one", live.textures === 1 && live.made === 2, JSON.stringify(live));
  // A picture still loading when the plan changes never becomes a second texture.
  await click(button(M.sheet, "Main floor"));
  const stale = pictures.splice(0);
  await click(button(M.sheet, "Electrical"));
  for (const im of stale) im.onload();
  check("plan: a late picture is dropped", live.textures === 0, JSON.stringify(live));
  loadAll();
  check("plan: one, still", live.textures === 1, JSON.stringify(live));
  // A floor change by hand releases it.
  M.M.floor = "upper";
  M.tool.layout();
  check("plan: a floor change releases it, the next floor's comes", live.textures === 0 && M.state().floor === "upper" && M.state().plan === "m3", JSON.stringify([live, M.state().plan]));
  loadAll();
  check("plan: one on the new floor, its ghosts and pins only", live.textures === 1 && M.state().ghosts.join() === "u" && M.state().pins.map(p => p.id).join() === "u", JSON.stringify(M.state()));
  M.tool.show(false);
  check("plan: closing the tool releases it, and the rest of the map", live.textures === 0 && !M.state().onMap && !M.state().ghosts.length && !M.state().pins.length && M.M.quiet.at(-1) === false, JSON.stringify(M.state()));
  M.tool.dispose();
  // A plan that moved isn't drawn.
  const S = mount();
  S.sess.plans[0].changed = true;
  await openMap(S);
  loadAll();
  check("plan: a plan that moved is not drawn", S.state().plan !== "m1", S.state().plan);
  S.tool.dispose();
}
// ── stacked, two plans, recap, floors, missing, record ───────────────────────
{
  const M = mount();
  await openMap(M);
  await walk(M, "s");
  check("stacked: asks the floor first", text(M.sheet).includes("It climbs from:") && !!button(M.sheet, "Basement") && !button(M.sheet, "Upper"), text(M.sheet));
  await click(button(M.sheet, "Basement"));
  await click(button(M.sheet, "New"));
  const held = DRAFT.planPending(M.draft.cur).find(p => p.sug_id === "s");
  check("stacked: goes on the floor picked", held && M.draft.cur.pieces[held.piece].floor_id === "basement", JSON.stringify(held));
  M.tool.dispose();
  const T = mount();
  await openMap(T);
  await walk(T, "c");
  const tags = all(T.root).filter(n => n.classList && n.classList.contains("pl-tag")).map(text).sort().join();
  check("two plans: both ghosts named on the map, and both said on the card", tags === "Electrical,Main floor" && text(T.sheet).includes("Main floor puts it here, Electrical there, 1.5 m apart. Nothing wins by itself."), `${tags} ${text(T.sheet)}`);
  await click(button(T.sheet, "New"));
  check("two plans: the other stays open, nothing merged", T.pin("c2").state === "queued", JSON.stringify(T.pin("c2")));
  T.tool.dispose();
  // A recap every 25 verdicts.
  const many = {};
  for (let i = 0; i < 26; i++) many[`x${i}`] = stair(`x${i}`, 1 + (i % 5), 1 + Math.floor(i / 5));
  const R = mount({ suggestions: many });
  await openMap(R);
  for (let i = 0; i < 24; i++) await key(R, "l");
  check("recap: not before 25", !text(R.sheet).includes("So far"), text(R.sheet));
  await key(R, "l");
  check("recap: at 25, the tally and a look back at the plan", text(R.sheet).includes("So far") && text(R.sheet).includes("25 later") && text(R.sheet).includes("the queue can't show what it missed"), text(R.sheet));
  await key(R, "Enter");
  check("recap: Enter carries on", !text(R.sheet).includes("So far") && R.state().card === "item", text(R.sheet));
  R.tool.dispose();
  // A floor ends: the what's-missing pass, and on to the next floor.
  const one = SUGS(); for (const id of ["b", "c", "c2", "s", "r"]) delete one[id];
  const F = mount({ suggestions: one });
  await openMap(F);
  await key(F, "n");
  check("floor end: the recap and the what's-missing pass", F.state().card === "floor" && text(F.sheet).includes("Main: what's missing?") && text(F.sheet).includes("1 new") && text(F.sheet).includes("The AI found no stairs on the Electrical plan.") && text(F.sheet).includes("wasn't seen on Main floor") === false, text(F.sheet));
  check("floor end: Add by hand beside On to the next floor", !!button(F.sheet, "Add by hand") && !!button(F.sheet, "On to Upper"), buttons(F.sheet).map(text).join("|"));
  await click(button(F.sheet, "Add by hand"));
  check("Add by hand: opens Build and is counted, no name", F.M.byHand === true && F.M.telemetry.filter(t => t !== "plans_tool:opened").join() === "plan_ai_missing_added:stairs"
    && F.M.telemetry.filter(t => t === "plans_tool:opened").length === 1, JSON.stringify(F.M.telemetry));   // and the tool's opening, once (telemetry.PLANS_TOOL_EVENTS)
  await click(button(F.sheet, "On to Upper"));
  check("floor end: on to the next floor's first item, the camera follows", F.state().cur === "u" && F.M.floor === "upper" && F.M.flown.at(-1).floor === "upper", JSON.stringify(F.M.flown.at(-1)));
  F.tool.dispose();
  // The track record.
  const Rec = mount({ record: { stairs: { right: 7, of: 9 }, railing: { right: 1, of: 4 } } });
  await openMap(Rec);
  check("record: at five or more, in plain words, this house", text(Rec.sheet).includes("Stairs: 7 of 9 right in this house so far."), text(Rec.sheet));
  await walk(Rec, "r");
  check("record: not under five", !text(Rec.sheet).includes("Railings: 1 of 4"), text(Rec.sheet));
  Rec.tool.dispose();
  // A pin pressed.
  const Pn = mount();
  await openMap(Pn);
  const pinEl = all(Pn.root).find(n => n.classList && n.classList.contains("pl-pin") && n.dataset.n === "5");
  await click(pinEl);
  check("pin: a press jumps to it and the camera flies", Pn.state().cur === "b" && Pn.M.flown.length >= 1, JSON.stringify(Pn.M.flown.at(-1)));
  Pn.tool.layout();
  check("pin: placed by the view's layout, nothing asked at rest", /translate/.test(pinEl.style.transform || ""), String(pinEl.style.transform));
  const renders = Pn.M.renders;
  Pn.tool.layout(); Pn.tool.layout();
  check("rest: layout asks for no frame", Pn.M.renders === renders, `${renders} ${Pn.M.renders}`);
  // The list is a press away, and comes back.
  await click(buttons(Pn.sheet).find(b => text(b) === "More"));
  await click(button(Pn.sheet, "As a list"));
  check("list: under More, and the map sleeps", !Pn.state().onMap && text(Pn.sheet).includes("To check"), text(Pn.sheet));
  await click(button(Pn.sheet, "Back to the map"));
  check("list: back to the map", Pn.state().onMap, "");
  Pn.tool.dispose();
  // No three.js: only the list, as before.
  const stale = mount({ suggestions: { m: stair("m", 1, 1, {}, { state: "stale", map_id: "m1" }) } });
  stale.sess.plans[0].changed = true;
  await openMap(stale);
  check("a plan that moved: New and Later off, it says read it again", text(stale.sheet).includes("The plan moved: read it again.") && button(stale.sheet, "New").disabled && button(stale.sheet, "Later").disabled && !button(stale.sheet, "Failure").disabled, text(stale.sheet));
  stale.tool.dispose();
}
// ── the list with no 3D behind it ────────────────────────────────────────────
{
  const box = document.createElement("div"), sess = SESSION({ a: stair("a", 1, 1), b: stair("b", 4, 4, { relation: "correction", target: "fur_0000000f", distance_m: 1.4, hand: true, target_snap: { label: "Hall stairs" } }) });
  const calls = [], toasts = [];
  const callWS = async (m) => {
    calls.push(m);
    const t = m.type.replace("padspan_ha/", "");
    if (t === "house3d_get") return { data: { schema: 1, pieces: { fur_0000000f: stairPc("fur_0000000f", 2.6, 4) } } };
    if (t === "plan_ai_plans") return INFO;
    if (t === "plan_ai_status") return { session: sess, undo: null };
    if (t === "maps_image_urls") return { image_urls: {} };
    if (t === "plan_ai_commit") return { ok: true, rev: 9, piece_ids: { a: "fur_abcdef01" }, suggestions: { a: { ...sess.suggestions.a, state: "committed_new", piece_id: "fur_abcdef01" } }, undo: { id: "pb", items: 1, puts_back: false },
      data: { schema: 1, pieces: { fur_0000000f: stairPc("fur_0000000f", 2.6, 4), fur_abcdef01: stairPc("fur_abcdef01", 1, 1, { label: "Stairs (from the plan)" }) } } };
    return {};
  };
  const L = await P.openPlansList(box, { DRAFT, PIECES, FURN: FURNITURE, callWS, floors: [{ id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }], toast: (t, bad) => toasts.push([t, bad]) });
  await settle();
  const sheet = all(box).find(n => n.classList && n.classList.contains("pl-flat"));
  check("no 3D: the list opens, no pins, no map", !!sheet && text(sheet).includes("To check (2)") && !L.tool.state().onMap && L.tool.state().pins.length === 0, text(sheet || box));
  check("no 3D: corrections are Take and Keep, no Move by hand", !!button(sheet, "Take the AI's position") && !!button(sheet, "Keep mine") && !button(sheet, "Move by hand"), buttons(sheet).map(text).join("|"));
  await click(buttons(sheet).find(b => text(b) === "New"));
  const keep = buttons(sheet).find(b => text(b).startsWith("Keep 1 new"));
  check("no 3D: New goes to its own draft; a keep button", !!keep, buttons(sheet).map(text).join("|"));
  await click(keep);
  const sent = calls.find(c => c.type === "padspan_ha/plan_ai_commit");
  check("no 3D: the keep goes through the one writer, the stair as read, no rail", sent && sent.items[0].sug_id === "a" && sent.items[0].final.x_m === 1 && sent.items[0].final.recipe.params.rail === "none" && sent.items[0].final.label === "Stairs (from the plan)", JSON.stringify(sent));
  check("no 3D: says it is kept, listed as kept", toasts.some(t => /Kept 1 new/.test(t[0])) && text(sheet).includes("Kept (1)"), JSON.stringify(toasts) + text(sheet));
  L.dispose();
  check("no 3D: closes", !all(box).some(n => n.classList && n.classList.contains("pl-flat")), "");
}
// ── lights: kind only, ghosts and pins, the same card ─────────────────────────
{
  const light = (id, x, y, match, extra = {}) => ({ id, kind: "light", map_id: "m1", floor_id: "main", state: "queued", verdict: null, seen_on: [{ map_id: "m1" }], box_px: [1, 1, 2, 2], frame: [100, 100], reads: ["tile", "crop"],
    geom: { x_m: x, y_m: y, symbol: "pot" }, match: { relation: "correction", target: "light.hall", distance_m: 0.2, want_kind: "pot", now_kind: "fixture", label: "Hall ceiling", group: false, near: [], held: null, target_snap: { x_m: x, y_m: y + 0.2, floor_id: "main", stored_kind: "fixture" }, ...match }, ...extra });
  const opened = [];
  const M = mount({ suggestions: {
    lc: light("lc", 1, 1, {}),
    lg: light("lg", 2, 2, { target: "light.pots", label: "Pots Main", group: true, now_kind: null }),
    lu: light("lu", 3, 3, { relation: "unmatched", target: null, target_snap: null, want_kind: undefined }, { state: "unmatched" }),
    ld: light("ld", 4, 4, { relation: "duplicate" }, { state: "duplicate" }),
  }, host: { openAtlasRoom: (f, r) => opened.push([f, r]) } });
  const before = JSON.stringify(M.draft.cur.pieces);
  await openMap(M);
  const st = M.state();
  check("lights: a pin each, none for one already there", ["lc", "lg", "lu"].every(id => st.pins.some(p => p.id === id)) && !st.pins.some(p => p.id === "ld"), st.pins);
  check("lights: ghosts, outside the draft", ["lc", "lg", "lu"].every(id => st.ghosts.includes(id)) && JSON.stringify(M.draft.cur.pieces) === before && !Object.keys(M.draft.cur.lights || {}).length, st.ghosts);
  check("lights: the card says what it is and what the light is drawn as", text(M.sheet).includes("The plan draws a pot light here. Hall ceiling is drawn as a ceiling light.") && text(M.sheet).includes("About 3 in 10 lights are wrong"), text(M.sheet));
  check("lights: no New and no Move by hand: a light's place is never touched", !button(M.sheet, "New") && !button(M.sheet, "Move by hand") && !!button(M.sheet, "Take the kind") && !!button(M.sheet, "Keep mine") && !!button(M.sheet, "Failure"), buttons(M.sheet).map(label));
  await key(M, "n");
  check("lights: N does nothing", !DRAFT.planPending(M.draft.cur).length, DRAFT.planPending(M.draft.cur));
  await key(M, "c");
  const e = (M.draft.cur.lights || {})["light.hall"] || {};
  const pend = DRAFT.planPending(M.draft.cur);
  check("lights: C puts the kind in the draft, and nothing else", e.kind === "pot" && e.x_m === undefined && e.z_m === undefined && JSON.stringify(M.draft.cur.pieces) === before && pend.length === 1 && pend[0].light === true && pend[0].piece === "light.hall", { e, pend });
  check("lights: its pin says correction, and on to the next", M.pin("lc").state === "correction" && M.state().cur === "lg", M.state());
  check("lights: a room group says so", text(M.sheet).includes("This room's lights are placed as a group: kind only?"), text(M.sheet));
  await click(button(M.sheet, "Take the kind"));
  check("lights: the keep button counts them as corrections", text(M.sheet).includes("Keep 2 corrections"), text(M.sheet));
  await click(buttons(M.sheet).find(b => text(b) === "›") || button(M.sheet, "Done") || button(M.sheet, "Stay here"));
  await walk(M, "lu");
  if (M.state().card !== "item") { M.tool.show(false); M.tool.show(true); await settle(); M.redraw(); await settle(); await walk(M, "lu"); }
  check("lights: unmatched is listed, with the Atlas button and no verdict", M.state().cur === "lu" && text(M.sheet).includes("A fixture symbol with no placed light here") && !!button(M.sheet, "Open Mapping → Atlas") && !button(M.sheet, "Failure") && !button(M.sheet, "Later"), { cur: M.state().cur, card: M.state().card, t: text(M.sheet) });
  await click(button(M.sheet, "Open Mapping → Atlas"));
  check("lights: the button opens Mapping → Atlas on that room", opened.length === 1 && opened[0][0] === "main" && opened[0][1] === "Hall", opened);
  await key(M, "f");
  check("lights: F on an unmatched symbol does nothing", M.sent("plan_ai_verdict").length === 0 && !text(M.sheet).includes("What's wrong with it?"), M.sent("plan_ai_verdict"));
  check("lights: the floor's pass counts the symbol, not as a failure", P.missingLines("main", Object.values(M.sess.suggestions), [], []).includes("1 fixture symbol had no placed light (Mapping → Atlas)."), "");
  // Save: items say which suggestion, and the server takes the kind from the symbol it read.
  let got = null;
  const commitAnswer = (m) => { got = m; return { ok: true, rev: 9, batch: "pb_1", piece_ids: { lc: "light.hall" }, suggestions: {}, undo: null,
    data: { schema: 1, pieces: {}, lights: { "light.hall": { kind: "pot" } } } }; };
  const M2 = mount({ suggestions: { lc: light("lc", 1, 1, {}) }, answers: { plan_ai_commit: commitAnswer } });
  await openMap(M2);
  await key(M2, "c");
  const kept = await M2.tool.commit();
  check("lights: a keep sends the suggestion alone", got && JSON.stringify(got.items) === JSON.stringify([{ sug_id: "lc", v: "correction" }]), got);
  check("lights: the file's entries come back for the draft", kept && kept.lights["light.hall"] && kept.lights["light.hall"].kind === "pot" && !Object.keys(kept.renamed).length && /1 correction/.test(kept.said), kept);
  // The draft's own rules: back to what it was; another edit of the same light stays.
  const base = DRAFT.ownedOf({ schema: 1, pieces: {}, lights: { "light.a": { kind: "fixture", z_m: 2 } } });
  const d = DRAFT.createDraft(base);
  d.change((c) => { c.lights["light.a"].plan_ai_pending = { session: "s", sugs: { x: { v: "correction", was: { kind: "fixture" } } } }; c.lights["light.a"].kind = "pot"; c.lights["light.b"] = { kind: "pot", plan_ai_pending: { session: "s", sugs: { y: { v: "correction", was: { kind: null } } } } }; });
  d.change((c) => { DRAFT.dropPlanPending(c, null); });
  check("lights: taken back, the kind is what it was, and an entry made only for it goes", Object.keys(d.cur.lights).join() === "light.a" && d.cur.lights["light.a"].kind === "fixture" && d.cur.lights["light.a"].z_m === 2 && !d.cur.lights["light.a"].plan_ai_pending, d.cur.lights);
  const d2 = DRAFT.createDraft(base);
  d2.change((c) => { c.lights["light.a"].plan_ai_pending = { session: "s", sugs: { x: { v: "correction", was: { kind: "fixture" } } } }; c.lights["light.a"].kind = "pot"; c.lights["light.a"].z_m = 2.5; });
  d2.adopt("lights", { "light.a": { kind: "pot", z_m: 2 } });
  check("lights: a keep adopted, the person's own height stays for the Save after", d2.cur.lights["light.a"].kind === "pot" && d2.cur.lights["light.a"].z_m === 2.5 && !d2.cur.lights["light.a"].plan_ai_pending && d2.base.lights["light.a"].z_m === 2, d2.cur.lights);
  // The fixture question.
  const Q = mount({ suggestions: {}, answers: { plan_ai_plans: { ...INFO, latest: null }, plan_ai_start: { session: "ps_2" } } });
  Q.tool.show(true); await settle(); Q.redraw(); await settle();
  check("the question: not asked until Lights is ticked", !text(Q.sheet).includes("Does this plan draw light fixtures"), text(Q.sheet));
  const tick = all(Q.sheet).filter(n => tag(n) === "LABEL").find(n => text(n).startsWith("Lights"));
  const cb = all(tick).find(n => tag(n) === "INPUT");
  cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  check("the question: per plan, Yes, No, Not sure, starting on Not sure", text(Q.sheet).includes("Does this plan draw light fixtures, like circles or pot marks?") && buttons(Q.sheet).filter(b => label(b) === "Yes").length === 4 && buttons(Q.sheet).filter(b => label(b) === "Not sure" && b.getAttribute("aria-pressed") === "true").length === 4, text(Q.sheet));
  await click(buttons(Q.sheet).filter(b => label(b) === "Yes")[1]);
  check("the question: what to expect counts the plan on Yes", text(Q.sheet).includes("on a plan with fixtures 6-12 lights"), text(Q.sheet));
  await click(buttons(Q.sheet).find(b => /^Read 4 plans/.test(text(b))));
  const started = Q.sent("plan_ai_start")[0] || {};
  check("the question: the start carries each plan's answer", (started.kinds || []).includes("light") && started.fixtures && started.fixtures.m2 === "yes" && started.fixtures.m1 === "unsure" && Object.keys(started.fixtures).length === 4, started);
  Q.tool.dispose();
}
// ── the review of 2026-11-02 (S1-S7) ─────────────────────────────────────────
{
  // S1: off the page the keys are nobody's here.
  const M = mount();
  await openMap(M);
  const n0 = M.sent("plan_ai_verdict").length;
  M.root.isConnected = false;
  const away = ["l", "c", "n", "f", "z", "p", "Enter", "Backspace", "Escape"].map(k => M.tool.key({ key: k, target: {} }));
  await settle();
  check("S1: off the page no key is taken and none acts", away.every(x => x === false) && M.sent("plan_ai_verdict").length === n0 && !DRAFT.planPending(M.draft.cur).length && M.state().card === "item", JSON.stringify(away));
  M.root.isConnected = true;
  check("S1: back on the page they are the map's again", await key(M, "l") === true && M.sent("plan_ai_verdict").length === n0 + 1, "");
  M.tool.dispose();
}
for (const how of ["undo", "discard"]) {
  // S2: Undo or Discard with Move by hand open.
  const M = mount();
  await openMap(M);
  await walk(M, "b");
  await click(button(M.sheet, "Move by hand"));
  check(`S2 ${how}: (Move by hand open)`, M.state().moving === "fur_0000000f", M.state());
  const x0 = "fur_0000000f";
  if (how === "undo") M.draft.undo(); else M.draft.discard();
  const before = JSON.stringify(M.draft.cur.pieces[x0]);
  // A drag before anything is painted: no Move by hand is left to start one.
  RAY = [2.6, 4];
  const early = M.tool.down({ clientX: 10, clientY: 10, pointerType: "mouse" });
  check(`S2 ${how}: at once, a press on the stair starts no drag`, early !== "drag" && M.state().moving === null, early);
  M.redraw();
  check(`S2 ${how}: the card no longer says drag, nothing pending`, M.state().moving === null && !text(M.sheet).includes("Drag") && !DRAFT.planPending(M.draft.cur).length, text(M.sheet));
  M.tool.move({ clientX: 60, clientY: 40 });
  M.tool.up({ clientX: 60, clientY: 40 });
  check(`S2 ${how}: the person's own stair stays where it was`, JSON.stringify(M.draft.cur.pieces[x0]) === before && !M.draft.dirty, M.draft.cur.pieces[x0]);
  M.tool.dispose();
}
{
  // S2: a drag under way when the item leaves the draft.
  const M = mount();
  await openMap(M);
  await walk(M, "b");
  await click(button(M.sheet, "Move by hand"));
  RAY = [4, 4];
  const g = M.tool.down({ clientX: 10, clientY: 10, pointerType: "mouse" });
  M.draft.undo();
  const before = JSON.stringify(M.draft.cur.pieces.fur_0000000f);
  RAY = [9, 9];
  M.tool.move({ clientX: 80, clientY: 80 });
  M.tool.up({ clientX: 80, clientY: 80 });
  check("S2: a drag under way when Undo comes writes nothing", g === "drag" && JSON.stringify(M.draft.cur.pieces.fur_0000000f) === before && !M.draft.dirty, M.draft.cur.pieces.fur_0000000f);
  M.tool.dispose();
}
{
  // S3: N, C, F and L never reach Home Assistant while the map shows.
  const M = mount({ suggestions: { ...SUGS(), k: stair("k", 9, 9, {}, { state: "committed_new" }) } });
  await openMap(M);
  await walk(M, "k");
  const calls0 = M.calls.length;
  const decided = [];
  for (const k of ["n", "c", "f", "l", "C", "L"]) decided.push(await key(M, k));
  check("S3: on a decided item they are taken and do nothing", decided.every(x => x === true) && M.calls.length === calls0 && !DRAFT.planPending(M.draft.cur).length, JSON.stringify(decided));
  await walk(M, "a");
  const others = ["e", "d", "m", "a"].map(k => M.tool.key({ key: k, target: {} }));
  check("S3: E, D, M and A pass on", others.every(x => x === false), JSON.stringify(others));
  const typed = [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "DIV", isContentEditable: true }].map(n => ["n", "c", "f", "l"].map(k => M.tool.key({ key: k, target: {}, composedPath: () => [n] }))).flat();
  check("S3: typed text is the field's, in a shadow root too", typed.every(x => x === false) && !DRAFT.planPending(M.draft.cur).length && !M.state().verdicts, JSON.stringify(typed));
  const chord = M.tool.key({ key: "c", ctrlKey: true, target: {} });
  check("S3: Ctrl+C is the browser's", chord === false, "");
  // Held: the first press decides, the repeats are swallowed and do nothing.
  await walk(M, "a");
  check("S3: the first press of a held key decides", await key(M, "l") === true && M.sent("plan_ai_verdict").length === 1, M.sent("plan_ai_verdict"));
  const n = M.sent("plan_ai_verdict").length, at = M.state().cur;
  const held = ["l", "c", "n", "f"].map(k => M.tool.key({ key: k, repeat: true, target: {} }));
  await settle();
  check("S3: its repeats are taken and do nothing", held.every(x => x === true) && M.sent("plan_ai_verdict").length === n && M.state().cur === at, JSON.stringify(held));
  check("S3: a held Enter is still the page's", M.tool.key({ key: "Enter", repeat: true, target: {} }) === false, "");
  M.tool.dispose();
  // The what's-missing card.
  const F = mount({ suggestions: { a: stair("a", 1, 1) } });
  await openMap(F);
  await key(F, "n");
  check("S3: (the what's-missing card)", F.state().card === "floor", F.state());
  const onFloor = ["n", "c", "f", "l"].map(k => F.tool.key({ key: k, target: {} }));
  check("S3: on the what's-missing card they are taken and do nothing", onFloor.every(x => x === true) && F.state().card === "floor" && DRAFT.planPending(F.draft.cur).length === 1, JSON.stringify(onFloor));
  F.tool.dispose();
  // The recap.
  const many = {};
  for (let i = 0; i < 27; i++) many[`i${i}`] = stair(`i${i}`, i % 5, Math.floor(i / 5));
  const C = mount({ suggestions: many });
  await openMap(C);
  for (let i = 0; i < 25 && C.state().card !== "recap"; i++) await key(C, "l");
  check("S3: (the recap)", C.state().card === "recap", C.state());
  const onRecap = ["n", "c", "f", "l"].map(k => C.tool.key({ key: k, target: {} }));
  check("S3: on the recap they are taken and do nothing", onRecap.every(x => x === true) && C.state().card === "recap", JSON.stringify(onRecap));
  C.tool.dispose();
}
{
  // S4: another floor for a stacked stair: it stays in view, and the numbers hold.
  const M = mount();
  await openMap(M);
  await walk(M, "s");
  const was = Object.fromEntries(M.state().pins.map(p => [p.id, p.n]));
  await click(button(M.sheet, "Basement"));
  const st = M.state();
  check("S4: the view goes to that floor", M.M.floor === "basement" && st.cur === "s", JSON.stringify({ floor: M.M.floor, cur: st.cur }));
  check("S4: its pin and ghost are on it", M.pin("s") && st.ghosts.includes("s"), JSON.stringify(st));
  check("S4: its number holds", M.pin("s") && M.pin("s").n === was.s, JSON.stringify([was.s, M.pin("s")]));
  check("S4: the card says it, and asks no more than it did", text(M.sheet).includes("It climbs from:") && button(M.sheet, "Basement").getAttribute("aria-pressed") === "true", text(M.sheet));
  await key(M, "Backspace");
  const now = Object.fromEntries(M.state().pins.map(p => [p.id, p.n]));
  check("S4: every other pin keeps its number", Object.keys(was).filter(id => id !== "s").every(id => now[id] === was[id]) && !("s" in now), JSON.stringify([was, now]));
  M.tool.dispose();
  // Picking the floor it already has is no surprise, and a keep writes the floor picked.
  const K = mount();
  await openMap(K);
  await walk(K, "s");
  await click(button(K.sheet, "Basement"));
  await click(button(K.sheet, "New"));
  const held = DRAFT.planPending(K.draft.cur).find(p => p.sug_id === "s");
  check("S4: New then writes the floor picked", held && K.draft.cur.pieces[held.piece].floor_id === "basement", JSON.stringify(held));
  K.tool.dispose();
}
{
  // S6: signed links expire; each opening asks again, and a tool left open does.
  const M = mount();
  await openMap(M);
  const asks = () => M.sent("maps_image_urls").length;
  const a0 = asks();
  M.redraw(); await settle();
  check("S6: no asking on each paint", asks() === a0 && a0 === 1, a0);
  M.tool.show(false); await settle();
  M.tool.show(true); await settle(); M.redraw(); await settle();
  check("S6: each opening asks again", asks() === a0 + 1, asks());
  const realNow = Date.now;
  Date.now = () => realNow() + 21 * 3600 * 1000;
  M.redraw(); await settle();
  const late = asks();
  M.redraw(); await settle();
  Date.now = realNow;
  check("S6: a tool left open asks again before they run out, and once", late === a0 + 2 && asks() === late, [late, asks()]);
  M.tool.dispose();
}
{
  // S7: the words on the sheet.
  const Q = mount({ suggestions: {}, answers: { plan_ai_plans: { ...INFO, latest: null } } });
  Q.tool.show(true); await settle(); Q.redraw(); await settle();
  check("S7: nothing about lights until Lights is ticked", !text(Q.sheet).includes("Tick only the sheets") && !text(Q.sheet).includes("minutes a plan"), text(Q.sheet));
  const tick = all(Q.sheet).filter(n => tag(n) === "LABEL").find(n => text(n).startsWith("Lights"));
  const cb = all(tick).find(n => tag(n) === "INPUT");
  cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  check("S7: with Lights ticked: tick only the sheets that draw them", text(Q.sheet).includes("Tick only the sheets that draw lights"), text(Q.sheet));
  await click(buttons(Q.sheet).filter(b => label(b) === "Yes")[0]);
  check("S7: the time as measured", text(Q.sheet).includes("2.5-3 minutes a plan") && !text(Q.sheet).includes("a minute and a half"), text(Q.sheet));
  Q.tool.dispose();
}
console.log(JSON.stringify(results));
process.exit(0);
