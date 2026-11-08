// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house: what stands on a line above its spot on the floor
// (a motion sensor's marker and its code on their dashed line, a tag and its
// name on its stem) keeps clear of the words around it. "If you're going to
// have the motion sensor or anything else on a dotted line above the actual
// sensor, make the height adjust so it doesn't cover up other text." (Garry,
// 2026-11-02)
//
//   when     once the camera has stopped, or what shows has changed; never
//            while the camera moves: a marker stays where it was until then,
//            so nothing hops or shakes. A poll that changes nothing does
//            nothing
//   where    worked out on screen, for this view: the nearest height on its
//            line that clears every word. A height that clears by a little
//            is left alone, and one must clear by a margin to be moved to,
//            so a small turn of the camera doesn't send it back and forth
//   looking  straight down, a height moves nothing on screen: there it leans
//            along its line instead, the top moving aside over the ring
//   bounded  LIFT below; if nothing clears, the least overlap
//   drawing  only: the stored height and spot are never touched, nothing is
//            saved, and while editing everything stands at its real height
//   cost     nothing at rest: no timer, no frame. No frames at all unless
//            something moves, then a short ease on the view's capped clock.
//            With nothing raised and under two words, not even the timer
//   words    the rooms' names (each with the chip under it) and a chip outside
//            keep clear of each other the same way, first: one that lies on
//            another moves up or down on screen to the nearest clear spot
//            (spreadWords), and is never hidden for it. A name next to an
//            outdoor chip ("Pantry" on "Entry outside", 2026-11-07)
//
// Imports no three.js: the view hands it in.

/** restMs: the camera still this long before working it out. easeMs: how long
 *  a move takes, drawn this often (frameMs, by profile). pad: clear of a word
 *  by this many px; keep: moving to a new spot needs this many more (the
 *  hysteresis); nearer: and, already clear, to be this much nearer its real
 *  spot (m); gain: nothing clears, it moves only to cut the overlap by this
 *  many px². downM, upM, stepM: how far along the line (m), in what steps.
 *  leanPx: how far aside on screen (px), at most leanM (m) from its spot, once
 *  a metre of height moves it less than steepPx on screen. */
export const LIFT = { restMs: 220, easeMs: 240, frameMs: { high: 33, low: 66 }, pad: 3, keep: 6, gain: 40, nearer: 0.15,
                      downM: 1.6, upM: 0.6, stepM: 0.2, leanPx: [24, 40, 58, 76], leanM: 1.6, steepPx: 14 };

/** spreadWords: a word moves in steps of this much of its own height, at most
 *  this many steps up or down. */
export const SPREAD = { step: 0.25, steps: 12 };

/** Two boxes' shared area (px²), with one grown by pad all round: 0 when they
 *  stand at least pad apart. */
export function overlapArea(a, b, pad = 0){
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + pad;
  if (w <= 0) return 0;
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + pad;
  return h <= 0 ? 0 : w * h;
}
/** How much of `parts` lies on `others`: a word on an icon or a word counts,
 *  two icons on each other do not (no words are covered). */
export function costOf(parts, others, pad = 0){
  let sum = 0;
  for (const p of parts) for (const o of others) if (p.text || o.text) sum += overlapArea(p, o, pad);
  return sum;
}
/** Which spot: spots[{parts, d (how far from its real spot)}], nearest first
 *  (spots[0] is its real spot); cur: the index it stands at. To stay it only
 *  has to clear by pad; to move, by pad + keep. Nothing clears: the least
 *  overlap, and only for a real gain. */
export function chooseSpot(spots, cur, others, L = LIFT){
  const curCost = costOf(spots[cur].parts, others, L.pad);
  for (let i = 0; i < spots.length; i++) {
    if (curCost === 0 && spots[i].d > spots[cur].d - L.nearer) return cur;     // it is clear, and nothing is really nearer
    if (costOf(spots[i].parts, others, i === cur ? L.pad : L.pad + L.keep) === 0) return i;
  }
  let best = cur, bestCost = curCost;
  spots.forEach((s, i) => { const c = costOf(s.parts, others, L.pad); if (c < bestCost) { best = i; bestCost = c; } });
  return curCost - bestCost >= L.gain ? best : cur;
}
/** Words that lie on each other, apart: units [{parts (their boxes, px, as
 *  drawn now), dy (px: how far it is moved down now), h (px: its height)}],
 *  in order: each keeps clear of those before it (the first never moves), at
 *  the nearest step up or down that clears, with chooseSpot's margins (it
 *  stays where it clears; once nothing is in its way, home). Returns each
 *  one's dy. */
export function spreadWords(units, L = LIFT){
  const placed = [], out = [];
  for (const U of units) {
    const step = Math.max(1, U.h * SPREAD.step), spots = [];
    const at = (dy) => ({ dy, d: Math.abs(dy), parts: U.parts.map(p => ({ ...p, y0: p.y0 - U.dy + dy, y1: p.y1 - U.dy + dy })) });
    for (let i = 0; i <= SPREAD.steps; i++) for (const k of i ? [-i, i] : [0]) spots.push(at(k * step));
    if (!spots.some(s => Math.abs(s.dy - U.dy) < 0.5)) { spots.push(at(U.dy)); spots.sort((a, b) => a.d - b.d); }
    const S = spots[chooseSpot(spots, spots.findIndex(s => Math.abs(s.dy - U.dy) < 0.5), placed, { ...L, nearer: step / 2 })];
    placed.push(...S.parts);
    out.push(S.dy);
  }
  return out;
}
/** The heights along a line, nearest first: 0, then each step within reach
 *  either way (from, to: the metres it may go, up is positive). */
export function heightSteps(from, to, step){
  const out = [0];
  for (let i = 1; i * step <= Math.max(-from, to) + 1e-6; i++) {
    if (-i * step >= from - 1e-6) out.push(-i * step);
    if (i * step <= to + 1e-6) out.push(i * step);
  }
  return out;
}
/** Where a sprite's own marks lie on screen: {x0, y0, x1, y1, text} (px) for
 *  camera c, a view W x H px; tw and th: how much of the sprite its marks fill. */
function spriteBox(_v, sp, c, W, H, tw, th){
  _v.setFromMatrixPosition(sp.matrixWorld);
  const k = 2 * Math.tan((c.fov || 40) / 2 * Math.PI / 180) / Math.max(1, H);
  const per = sp.material.sizeAttenuation === false ? k : k * c.position.distanceTo(_v);
  const w = sp.scale.x / per, h = sp.scale.y / per;
  _v.project(c);
  const cx = (_v.x * 0.5 + 0.5) * W - (sp.center.x - 0.5) * w, cy = (-_v.y * 0.5 + 0.5) * H + (sp.center.y - 0.5) * h;
  return { x0: cx - w * tw / 2, x1: cx + w * tw / 2, y0: cy - h * th / 2, y1: cy + h * th / 2, text: true };
}

/**
 * ctx = {THREE, camera(), size() ([W, H] px), any() (is anything raised at
 *        all), raised() ([{id, shown, hold (it stays this time: it is on the
 *        move), home (world: where its anchor stands, unmoved), lift (Vector3,
 *        as drawn now), minY, maxY (world, its line's reach), parts
 *        ([{ox, oy, w, h, text}], px from the anchor), hides(v, c, withCode),
 *        code (a code hangs from it), set(x, y, z)}]), texts() (every word
 *        showing: [{sprite, tw, th, owner, id}]), ready() (it is on screen),
 *        busy() (a flight, a check, a frame owed), movedAt() (the camera's
 *        last move), off() (real heights: editing), quality(), draw() (a frame,
 *        please), settled() (a move ended: what hides what, again), words()
 *        (optional: the names and chips to keep apart, in order: [{id, h, dy,
 *        parts ([{sprite, tw, th}]), set(dy)}])}
 */
export function createRaisedLayer(ctx){
  const { THREE } = ctx;
  const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  let timer = null, lastSig = null, moving = [], runs = 0, moves = 0, lastMs = 0, disabled = false;

  function boxesOf(I, x, y, z, c, W, H){
    _v.set(I.home.x + x, I.home.y + y, I.home.z + z).project(c);
    if (!(_v.z > -1 && _v.z < 1)) return null;
    const px = (_v.x * 0.5 + 0.5) * W, py = (-_v.y * 0.5 + 0.5) * H;
    return { px, py, parts: I.parts.map(p => ({ x0: px + p.ox - p.w / 2, x1: px + p.ox + p.w / 2, y0: py + p.oy - p.h / 2, y1: py + p.oy + p.h / 2, text: !!p.text })) };
  }
  /** Everywhere this one may stand in this view: {x, y, z, d, parts}, its real
   *  spot first, nearest next, and where it stands now. */
  function spotsOf(I, c, W, H){
    const out = [], add = (x, y, z, always = false) => {
      const b = boxesOf(I, x, y, z, c, W, H);
      if (!b && !always) return;
      if (!always && (b.px < 0 || b.px > W || b.py < 0 || b.py > H)) return;   // on the screen, or not at all
      out.push({ x, y, z, d: Math.hypot(x, y, z), parts: b ? b.parts : [] });
    };
    const from = Math.min(0, Math.max(I.minY - I.home.y, -LIFT.downM)), to = Math.max(0, Math.min(I.maxY - I.home.y, LIFT.upM));
    for (const y of heightSteps(from, to, LIFT.stepM)) add(0, y, 0, y === 0);
    // Looking down from high enough that a height moves nothing: aside, along the line.
    const a = boxesOf(I, 0, 0, 0, c, W, H), up = boxesOf(I, 0, 1, 0, c, W, H);
    if (a && up && Math.hypot(up.px - a.px, up.py - a.py) < LIFT.steepPx) {
      _r.setFromMatrixColumn(c.matrixWorld, 0).setY(0); _u.setFromMatrixColumn(c.matrixWorld, 1).setY(0);
      if (_r.lengthSq() > 1e-6 && _u.lengthSq() > 1e-6) {
        _r.normalize(); _u.normalize();
        const rx = _r.x, rz = _r.z, ux = _u.x, uz = _u.z;
        const side = boxesOf(I, rx, 0, rz, c, W, H), m = side ? Math.max(1, Math.hypot(side.px - a.px, side.py - a.py)) : 1;
        for (const px of LIFT.leanPx) {
          const g = Math.min(px / m, LIFT.leanM);
          for (const [dx, dz] of [[ux, uz], [-ux, -uz], [rx, rz], [-rx, -rz]]) add(dx * g, 0, dz * g);
        }
      }
    }
    out.sort((p, q) => p.d - q.d);
    if (!out.some(s => s.x === I.lift.x && s.y === I.lift.y && s.z === I.lift.z)) {
      add(I.lift.x, I.lift.y, I.lift.z, true);
      out.sort((p, q) => p.d - q.d);
    }
    return out;
  }
  /** Every word that isn't a raised thing's own (those are its parts). */
  function wordsOf(items, c, W, H){
    const mine = new Set(items.filter(I => I.shown).map(I => I.id));
    return ctx.texts().filter(t => !(t.owner && mine.has(t.owner)))
      .map(t => ({ ...spriteBox(_v, t.sprite, c, W, H, t.tw, t.th), id: t.id }));
  }
  /** Where each one should stand now, as it stands in this view: to[id] = [x, y, z]. */
  function settle(items, words, c, W, H){
    const shown = items.filter(I => I.shown).sort((a, b) => (a.id < b.id ? -1 : 1)), to = new Map(), placed = new Map();
    const at = (I) => to.get(I.id) || [I.lift.x, I.lift.y, I.lift.z];
    for (const I of shown) { const b = boxesOf(I, I.lift.x, I.lift.y, I.lift.z, c, W, H); placed.set(I.id, b ? b.parts : []); }
    for (let pass = 0; pass < 2; pass++) {
      for (const I of shown) {
        if (I.hold) continue;
        let spots = spotsOf(I, c, W, H);
        const others = words.slice();
        for (const [id, parts] of placed) if (id !== I.id) others.push(...parts);
        const was = at(I);
        for (let tries = 0; tries < 8 && spots.length; tries++) {
          const cur = Math.max(0, spots.findIndex(s => s.x === was[0] && s.y === was[1] && s.z === was[2]));
          const S = spots[chooseSpot(spots, cur, others)];
          // One ray, only for a spot it is moved to: it must not end up behind what hides it.
          if (S.d > 0 && I.hides(_v.set(I.home.x + S.x, I.home.y + S.y, I.home.z + S.z), c, !!I.code)) { spots = spots.filter(s => s !== S); continue; }
          to.set(I.id, [S.x, S.y, S.z]);
          placed.set(I.id, S.parts);
          break;
        }
      }
    }
    return to;
  }
  /** The ease to where it goes next; nothing drawn when nothing moves. */
  function go(I, x, y, z){
    if (I.lift.x === x && I.lift.y === y && I.lift.z === z) return false;
    moving = moving.filter(m => m.id !== I.id);
    moving.push({ id: I.id, set: I.set, from: [I.lift.x, I.lift.y, I.lift.z], to: [x, y, z], t0: performance.now() });
    moves++;
    return true;
  }
  /** The names and chips, apart (spreadWords), before anything on a line
   *  looks for its spot: those see them where they go. They ease there. */
  function spread(c, W, H, off){
    if (!ctx.words) return false;
    const units = ctx.words();
    const dys = off ? units.map(() => 0)
      : spreadWords(units.map(U => ({ h: U.h, dy: U.dy, parts: U.parts.map(p => spriteBox(_v, p.sprite, c, W, H, p.tw, p.th)) })));
    let changed = false;
    units.forEach((U, i) => {
      const from = U.dy, to = dys[i];
      if (from === to) return;
      U.set(to);                                             // where it goes, for the look below
      moving = moving.filter(m => m.id !== "word " + U.id);
      moving.push({ id: "word " + U.id, set: (x, y) => { void x; U.set(y); }, from: [0, from, 0], to: [0, to, 0], t0: performance.now(), word: true, back: () => U.set(from) });
      moves++;
      changed = true;
    });
    return changed;
  }
  function signature(items, c, W, H, off){
    const s = [c.matrixWorld.elements.map(v => v.toFixed(3)).join(), W, H, off ? 1 : 0];
    for (const I of items) s.push(I.id, I.shown ? 1 : 0, I.hold ? 1 : 0, Math.round(I.home.x * 2), Math.round(I.home.y * 2), Math.round(I.home.z * 2), I.parts.map(p => Math.round(p.w)).join("/"));
    let n = 0, sum = 0, wide = 0;
    for (const t of ctx.texts()) { n++; sum += t.sprite.id; wide += Math.round(t.tw * 100); }
    s.push(n, sum, wide);
    return s.join("|");
  }
  function run(){
    const c = ctx.camera(), [W, H] = ctx.size();
    if (!c || !W || !H) return;
    c.updateMatrixWorld();
    const items = ctx.raised(), off = disabled || ctx.off(), sig = signature(items, c, W, H, off);
    if (sig === lastSig) return;
    lastSig = sig;
    const t0 = performance.now();
    let changed = spread(c, W, H, off);
    if (off) { for (const I of items) changed = go(I, 0, 0, 0) || changed; }
    else {
      const to = settle(items, wordsOf(items, c, W, H), c, W, H);
      for (const I of items) { const p = to.get(I.id); if (p) changed = go(I, p[0], p[1], p[2]) || changed; }
    }
    for (const m of moving) if (m.back) { m.back(); m.back = null; }      // the words ease from where they were
    runs++;
    lastMs = performance.now() - t0;
    if (changed) ctx.draw();
  }
  function check(){
    timer = null;
    if (!ctx.ready() || !ctx.any()) return;                       // the next poll asks again
    const still = performance.now() - ctx.movedAt();
    if (still < LIFT.restMs || ctx.busy()) { timer = setTimeout(check, Math.max(60, LIFT.restMs - still)); return; }
    run();
  }
  return {
    /** The camera moved, or what shows may have changed: looked at once it rests. */
    touch(){ if (timer === null && ctx.any()) timer = setTimeout(check, LIFT.restMs); },
    /** The frame's clock (t: performance.now()): the moves, a step on. */
    tick(t){
      if (!moving.length) return;
      moving = moving.filter((m) => {
        const q = Math.min(1, Math.max(0, (t - m.t0) / LIFT.easeMs)), e = 1 - Math.pow(1 - q, 3);
        if (q >= 1) m.set(m.to[0], m.to[1], m.to[2]);          // exactly: the next look compares with it
        else m.set(m.from[0] + (m.to[0] - m.from[0]) * e, m.from[1] + (m.to[1] - m.from[1]) * e, m.from[2] + (m.to[2] - m.from[2]) * e);
        return q < 1;
      });
      if (!moving.length) ctx.settled();
    },
    /** How often to draw while something moves (ms), or 0. */
    rate(){ return moving.length ? LIFT.frameMs[ctx.quality() === "high" ? "high" : "low"] : 0; },
    /** What it stood on was built afresh: nothing is owed to the old one. */
    forget(){ moving = []; lastSig = null; },
    /** The words each raised thing lies on now: {pairs: [{a, b, area}], count,
     *  area, items, words} (the harness counts them; the view never asks). */
    overlaps(){
      const c = ctx.camera(), [W, H] = ctx.size(), pairs = [];
      if (!c || !W || !H) return { pairs, count: 0, area: 0, items: 0, words: 0 };
      c.updateMatrixWorld();
      const items = ctx.raised().filter(I => I.shown), words = wordsOf(items, c, W, H);
      const placed = items.map(I => { const b = boxesOf(I, I.lift.x, I.lift.y, I.lift.z, c, W, H); return { id: I.id, parts: b ? b.parts : [] }; });
      placed.forEach((A, i) => {
        for (const p of A.parts) {
          for (const w of words) { const area = Math.round(overlapArea(p, w)); if (area > 0) pairs.push({ a: A.id, b: w.id, area }); }
          placed.forEach((B, j) => { if (j > i) for (const o of B.parts) if (p.text || o.text) { const area = Math.round(overlapArea(p, o)); if (area > 0) pairs.push({ a: A.id, b: B.id, area }); } });
        }
      });
      // The names and chips on each other (spreadWords).
      const units = ctx.words ? ctx.words().map(U => ({ id: U.id, parts: U.parts.map(p => spriteBox(_v, p.sprite, c, W, H, p.tw, p.th)) })) : [], crowd = [];
      units.forEach((A, i) => units.forEach((B, j) => {
        if (j <= i) return;
        const area = Math.round(A.parts.reduce((s, p) => s + B.parts.reduce((t, o) => t + overlapArea(p, o), 0), 0));
        if (area > 0) crowd.push({ a: A.id, b: B.id, area });
      }));
      return { pairs, count: pairs.length, area: pairs.reduce((s, q) => s + q.area, 0), items: items.length, words: words.length, crowd };
    },
    /** The harness's "before": every one at its real height (on: true), at once. */
    disable(on){
      disabled = !!on; lastSig = null; moving = [];
      if (disabled) { for (const I of ctx.raised()) I.set(0, 0, 0); if (ctx.words) for (const U of ctx.words()) U.set(0); }
      ctx.settled();
      ctx.draw();
      if (!disabled) run();
    },
    state(){
      return { armed: timer !== null, runs, moves, lastMs, easing: moving.length, disabled,
               items: ctx.raised().map(I => ({ id: I.id, shown: I.shown, lift: [I.lift.x, I.lift.y, I.lift.z].map(v => Math.round(v * 1000) / 1000) })),
               words: ctx.words ? ctx.words().map(U => ({ id: U.id, dy: Math.round(U.dy * 10) / 10 })) : [] };
    },
    dispose(){ if (timer !== null) clearTimeout(timer); timer = null; moving = []; lastSig = null; },
  };
}
