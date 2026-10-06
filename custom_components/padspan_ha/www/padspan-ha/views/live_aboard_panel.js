// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard on the wall panel (the sidebar's screen), and the people in it.
//
//   home view    Views ▾ → Set as home keeps the camera and the floor showing
//                as this screen's home, in this browser (beside its saved
//                views). With none set, the home is the whole house on the
//                floor with the most rooms of its own (homeFloorOf), never
//                All, where an upper floor covers the rooms under it. The
//                sidebar opens on it.
//   going back   the sidebar's view, untouched for a while
//                (settings.atlas_3d_home_idle_s: 60 s, or 30 s, 5 min, off),
//                flies back to its home by itself, closing its menus and the
//                small cards beside tags and people. Never while Edit or
//                Furnish is open, a card or sheet the Atlas opened is up (a
//                light's controls, a room's or floor's sheet, a door's card,
//                the activity calendar), or full screen was asked for by
//                hand: then it looks again a little later. One timer in this
//                browser, nothing asked of Home Assistant, no frames at rest.
//   follow       a person's card has Follow: the camera keeps them in the
//                middle, gliding on the capped clock and only while they
//                move (to their floor too), until the view is touched
//   people chip  beside the Motion chip, how many people are home; each tap
//                flies to the next one, changing floor as needed, and says
//                who it is
//   switches     Show people and Show tags & scanners in Views ▾ (View ▾ on a
//                narrow screen): the same settings as in Settings, saved;
//                an administrator changes them, anyone else sees them on or off
//
// The view (live_aboard.js) hands in what this needs of it (createPanel's v);
// nothing here imports three.js or reads the house itself.

/** The choices for going back to the home view (s; 0: never). */
export const IDLE_CHOICES = [0, 30, 60, 300];
export const IDLE_DEFAULT_S = 60;
const RECHECK_MS = 10000;                  // held off (a card open, Edit…): looked at again after this
const FOLLOW_TAU_MS = 600;                 // the camera's glide after someone followed (a time constant)
const FOLLOW_UP = 0.8;                     // it looks at them this far above their floor (m)
const FOLLOW_MS = { high: 40, low: 100 };  // drawn this often while it glides (the walking clock)
const NEAR = 0.02;                         // closer than this (m): there
const PREF_HOME = "home_";

/** settings.atlas_3d_home_idle_s, as ms (0: never); not a number: never. */
export function idleMsOf(v){
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
}

const inPoly = (x, y, P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const middle = (P) => [P.reduce((a, p) => a + p[0], 0) / P.length, P.reduce((a, p) => a + p[1], 0) / P.length];

/**
 * The home view's floor when none was set: the indoor floor with the most
 * rooms of its own. A floor chosen shows its own rooms whole and hides the
 * floors above it; All (or the top floor, the same picture) covers every
 * room under an upper floor. A tie goes to the one that shows more rooms in
 * all (its own, and those below it that nothing between covers, judged at
 * each room's middle), then to the lower one. rooms: [{floor: {id, elev,
 * outdoor}, pts}] → {id, own, shows} or null (no indoor rooms).
 */
export function homeFloorOf(rooms){
  const list = (rooms || []).filter(r => r && r.floor && !r.floor.outdoor && Array.isArray(r.pts) && r.pts.length >= 3);
  const floors = new Map();
  for (const r of list) floors.set(r.floor.id, r.floor);
  let best = null;
  for (const f of floors.values()) {
    const own = list.filter(r => r.floor.id === f.id).length;
    let shows = 0;
    for (const r of list) {
      if (r.floor.elev > f.elev + 1e-3) continue;
      const [x, y] = middle(r.pts);
      if (!list.some(q => q.floor.elev > r.floor.elev + 1e-3 && q.floor.elev <= f.elev + 1e-3 && inPoly(x, y, q.pts))) shows++;
    }
    const c = { id: f.id, own, shows, elev: f.elev };
    if (!best || c.own > best.own || (c.own === best.own && (c.shows > best.shows || (c.shows === best.shows && c.elev < best.elev)))) best = c;
  }
  return best ? { id: best.id, own: best.own, shows: best.shows } : null;
}

/** Is a card or sheet the Atlas opened up (they cover the page: fixed, inset
 *  0, on the page or, full screen, in the panel)? node: the view's element. */
export function hostCardOpen(node){
  const lists = [];
  try { if (typeof document !== "undefined" && document.body) lists.push(document.body.children); } catch (_) { /* no page */ }
  try { const rn = node && node.getRootNode ? node.getRootNode() : null; if (rn && rn.host && rn.children) lists.push(rn.children); } catch (_) { /* not in a panel */ }
  for (const l of lists) {
    for (const n of [...(l || [])]) {
      const s = n && n.style;
      if (s && s.position === "fixed" && /^0(px)?$/.test(String(s.inset || "").trim()) && s.display !== "none") return true;
    }
  }
  return false;
}

const CSS = `
.la3d-chiprow{position:absolute;left:50%;top:44px;z-index:2;transform:translateX(-50%);display:flex;align-items:center;gap:6px;
  max-width:calc(100% - 150px);pointer-events:none}
.la3d-chiprow>*{pointer-events:auto}
.la3d.la3d-narrow .la3d-chiprow{top:auto;bottom:58px;max-width:calc(100% - 20px)}
.la3d-chiprow .la3d-mchip{position:static;left:auto;top:auto;bottom:auto;transform:none;max-width:none;min-width:0;flex:0 1 auto}
.la3d-pchip{display:flex;align-items:center;gap:2px;flex:none;padding:3px 4px 3px 12px;border-radius:999px;background:rgba(6,14,9,.8);
  border:1px solid rgba(120,190,155,.22);box-shadow:0 4px 14px rgba(0,0,0,.35);color:rgba(226,240,232,.75);
  font:600 12.5px/1.2 system-ui,"Segoe UI",Roboto,sans-serif;white-space:nowrap}
.la3d-pchip[hidden]{display:none}
.la3d-pchip button{all:unset;box-sizing:border-box;cursor:pointer;padding:4px 7px;border-radius:999px;font-weight:800;color:#7dd3fc}
.la3d-pchip button:hover,.la3d-pchip button:focus-visible{background:rgba(255,255,255,.1)}
.la3d-pchip .la3d-pstop{color:rgba(226,240,232,.75);font-weight:700}
.la3d.la3d-narrow .la3d-pchip{padding:2px 2px 2px 9px;font-size:11.5px}
.la3d.la3d-bare .la3d-pchip{opacity:0;visibility:hidden;pointer-events:none}
.la3d-menu button:disabled{cursor:default;opacity:.6}
.la3d-tagcard .la3d-cbtns{display:flex;gap:6px;margin-top:7px}
.la3d-tagcard .la3d-cbtns button{all:unset;box-sizing:border-box;cursor:pointer;padding:5px 12px;border-radius:8px;font-weight:700;
  background:rgba(82,183,136,.2);border:1px solid rgba(82,183,136,.45);color:#e8f0ea}
.la3d-tagcard .la3d-cbtns button:hover,.la3d-tagcard .la3d-cbtns button:focus-visible{background:rgba(82,183,136,.32)}`;

/**
 * v = {
 *   root, guard(fn), slotKey, prefGet(k), prefSet(k, value)
 *   host()            the newest card's data (settings3d, admin, saveSetting)
 *   sidebar()         is this the sidebar's screen, showing (mapOnly)?
 *   busy()            why it may not go back now ("edit" | "furnish" |
 *                     "full" | "card"), or null
 *   cam()             {theta, phi, radius, target: [x, y, z]}
 *   floorNow()        the floor showing at the top (its id), null for All
 *   onFloor(id)       is that floor (null: All) the one chosen now?
 *   setFloor(id)      choose it (null: All); the camera stays
 *   homeFloor()       homeFloorOf the house, or null
 *   wholeGoal()       the whole house on the floor showing, as the view opens on it
 *   go(goal, smooth)  the camera there ({theta, phi, radius, target}), flown or at once
 *   flying()          is the camera flying?
 *   closeAll(bars)    menus and the small cards closed (bars: the map alone too)
 *   tracked()         the people layer (whereOf, people), or null
 *   toPerson(key)     fly to someone, their floor at the top; false: not drawn
 *   showCard(key)     open their card beside them
 *   onTop(where)      does their floor show at the top?
 *   target(), setTarget([x, y, z])   the camera's middle
 *   quality(), toast(text), render()
 * }
 */
export function createPanel(v){
  const doc = v.root.ownerDocument || document;
  const css = doc.createElement("style");
  css.textContent = CSS;
  v.root.appendChild(css);
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ── the people chip, in a row with the Motion chip ─────────────────────────
  const row = doc.createElement("div");
  row.className = "la3d-chiprow";
  const chip = doc.createElement("div");
  chip.className = "la3d-pchip";
  chip.hidden = true;
  chip.setAttribute("data-la3d-people", "");
  row.appendChild(chip);
  const motion = v.root.querySelector ? v.root.querySelector("[data-la3d-motion]") : null;
  if (motion) row.appendChild(motion);
  v.root.appendChild(row);
  const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
  for (const ev of ["pointerup", "wheel", "dblclick"]) chip.addEventListener(ev, stop);

  let lastTouch = now(), atHome = false, timer = null, quiet = 0, returns = 0;
  let follow = null, gliding = false, lastStep = null, visited = null, chipKey = "";
  let hostEl = null, unhook = null;

  const host = () => v.host() || {};
  const s3 = () => (host().settings3d && typeof host().settings3d === "object" ? host().settings3d : null);
  const idleMs = () => { const s = s3(); return s ? idleMsOf(s.atlas_3d_home_idle_s ?? null) : 0; };
  const own = (fn) => { quiet++; try { return fn(); } finally { quiet--; } };

  // ── the home view ─────────────────────────────────────────────────────────
  function readHome(){
    try {
      const h = JSON.parse(v.prefGet(PREF_HOME + v.slotKey) || "null");
      return h && Array.isArray(h.target) && h.target.length === 3 && [h.theta, h.phi, h.radius, ...h.target].every(Number.isFinite)
        && (h.floor === null || typeof h.floor === "string") ? h : null;
    } catch (_) { return null; }
  }
  function setHome(){
    const c = v.cam();
    v.prefSet(PREF_HOME + v.slotKey, JSON.stringify({ theta: c.theta, phi: c.phi, radius: c.radius, target: c.target, floor: v.floorNow() }));
    atHome = true;
    disarm();
    v.toast("This is now this screen's home view");
  }
  function forgetHome(){
    v.prefSet(PREF_HOME + v.slotKey, "null");
    atHome = false;
    arm();
    v.toast("Home view forgotten: the whole house on the floor with the most rooms");
  }
  /** Where home is now: {floor, goal (null: the whole house once that floor shows)}. */
  function homeOf(){
    const h = readHome();
    if (h) return { floor: h.floor, goal: { theta: h.theta, phi: h.phi, radius: h.radius, target: h.target }, set: true };
    const f = v.homeFloor();
    return { floor: f ? f.id : null, goal: null, set: false };
  }
  /** Back home: menus and cards closed, no one followed, its floor, its camera. */
  function goHome(smooth){
    own(() => {
      v.closeAll(true);
      stopFollow(false);
      const h = homeOf();
      if (!v.onFloor(h.floor)) v.setFloor(h.floor);
      v.go(h.goal || v.wholeGoal(), smooth);
    });
    atHome = true;
    lastTouch = now();
    disarm();
    paintChip();
    return true;
  }

  // ── going back by itself ──────────────────────────────────────────────────
  function disarm(){ if (timer !== null) { clearTimeout(timer); timer = null; } }
  function arm(ms){
    const idle = idleMs();
    if (timer !== null || !idle || atHome || !v.sidebar()) return;
    timer = setTimeout(v.guard(fire), Math.max(50, ms ?? idle - (now() - lastTouch)));
  }
  function fire(){
    timer = null;
    const idle = idleMs();
    if (!idle || atHome || !v.sidebar()) return;
    const left = idle - (now() - lastTouch);
    if (left > 50) { arm(left); return; }
    if (v.busy()) { arm(Math.min(idle, RECHECK_MS)); return; }
    returns++;
    goHome(true);
  }
  /** Someone touched the screen (or changed its floor): it is not home, and the wait starts again. */
  function touched(inView){
    lastTouch = now();
    atHome = false;
    if (inView) stopFollow(true);
    disarm();
    arm();
  }
  const onView = v.guard(() => touched(true));
  const onPanel = v.guard(() => touched(false));
  for (const ev of ["pointerdown", "wheel", "keydown"]) v.root.addEventListener(ev, onView, true);

  // ── follow ─────────────────────────────────────────────────────────────────
  function stopFollow(paint = true){
    if (!follow) return;
    follow = null; gliding = false; lastStep = null;
    if (paint) paintChip();
  }
  function startFollow(key){
    const L = v.tracked(), who = L ? L.people().find(p => p.key === key) : null;
    if (!who) return false;
    own(() => v.toPerson(key));
    follow = { key, name: who.name };
    gliding = true; lastStep = null;
    atHome = false;
    v.closeAll(false);
    paintChip();
    v.render();
    return true;
  }
  const goalOf = (w) => [w.x, w.y + FOLLOW_UP, w.z];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** On the view's live clock (t: ms): the camera glides to whoever is followed. */
  function tick(t){
    if (!follow || v.flying()) { lastStep = null; return; }
    const L = v.tracked(), w = L ? L.whereOf(follow.key) : null;
    if (!w) { stopFollow(); return; }
    if (!v.onTop(w)) { own(() => v.setFloor(w.floor)); }
    const goal = goalOf(w), cur = v.target(), d = dist(goal, cur);
    if (d < NEAR) { if (d > 0) v.setTarget(goal); gliding = false; lastStep = null; return; }
    const dt = lastStep === null ? 1000 / 30 : Math.min(250, Math.max(0, t - lastStep));
    lastStep = t;
    const k = 1 - Math.exp(-dt / FOLLOW_TAU_MS), next = cur.map((c, i) => c + (goal[i] - c) * k);
    gliding = dist(goal, next) >= NEAR;
    v.setTarget(gliding ? next : goal);
  }
  /** How often to draw while the camera glides after someone (ms), or 0. */
  function rate(){
    if (!follow) return 0;
    const L = v.tracked(), w = L ? L.whereOf(follow.key) : null;
    if (!w) return 1;                                     // gone: the next frame lets go
    return dist(goalOf(w), v.target()) >= NEAR || (w.walking && w.shown) ? FOLLOW_MS[v.quality() === "high" ? "high" : "low"] : 0;
  }

  // ── the people chip: "3 home", each tap the next one ──────────────────────
  function paintChip(){
    const L = v.tracked(), s = s3(), list = L && (!s || s.atlas_3d_people === true) ? L.people() : [];
    const key = JSON.stringify([follow ? follow.name : null, list.map(p => p.key)]);
    if (key === chipKey) return;
    chipKey = key;
    while (chip.firstChild) chip.removeChild(chip.firstChild);
    if (!follow && !list.length) { chip.hidden = true; return; }
    chip.hidden = false;
    const lbl = doc.createElement("span");
    lbl.style.marginRight = "2px";
    if (follow) {
      lbl.textContent = `Following ${follow.name}`;
      const b = doc.createElement("button");
      b.type = "button"; b.className = "la3d-pstop"; b.textContent = "Stop";
      b.title = `Stop following ${follow.name}`;
      b.addEventListener("click", v.guard((e) => { stop(e); stopFollow(); }));
      chip.append(lbl, b);
      return;
    }
    lbl.textContent = "People:";
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = `${list.length} home`;
    b.title = "Go to each person in turn";
    b.setAttribute("aria-label", `${list.length} ${list.length === 1 ? "person" : "people"} home: go to each in turn`);
    b.addEventListener("click", v.guard((e) => { stop(e); nextPerson(); }));
    chip.append(lbl, b);
  }
  /** The next person after the one last gone to (by name), their floor at the top. */
  function nextPerson(){
    const L = v.tracked(), list = L ? L.people() : [];
    if (!list.length) return null;
    const i = list.findIndex(p => p.key === visited), next = list[(i + 1) % list.length];
    visited = next.key;
    if (own(() => v.toPerson(next.key))) v.showCard(next.key);
    atHome = false;
    disarm(); arm();
    return next.key;
  }

  // ── the menu: home, and the two switches ─────────────────────────────────
  function menuItems(){
    const set = !!readHome(), out = [null,
      { text: "Home view", title: set ? "Go to this screen's home view" : "The whole house on the floor with the most rooms", act: () => goHome(true),
        del: set ? () => forgetHome() : undefined },
      { text: "Set as home", title: "Keep this view and floor as this screen's home", act: () => setHome() }];
    const s = s3();
    if (!s) return out;
    const h = host(), may = h.admin === true && typeof h.saveSetting === "function";
    out.push(null);
    for (const [key, words] of [["atlas_3d_people", "Show people"], ["atlas_3d_tags", "Show tags & scanners"]]) {
      const on = s[key] === true;
      out.push({ text: `${words}: ${on ? "On" : "Off"}`, on, disabled: !may,
                 title: may ? `Turn ${words.toLowerCase()} ${on ? "off" : "on"} (the same switch as in Settings)` : "Only an administrator can change this",
                 act: () => { if (may) Promise.resolve().then(() => h.saveSetting(key, !on)).catch(e => v.toast(`Could not save: ${String((e && e.message) || e)}`)); } });
    }
    return out;
  }

  return {
    /** The newest card is in: listen where the panel is, and wait to go back. */
    attach(){
      const he = (() => { try { const rn = v.root.getRootNode ? v.root.getRootNode() : null; return rn && rn.host ? rn.host : null; } catch (_) { return null; } })();
      if (he !== hostEl) {
        if (unhook) unhook();
        unhook = null; hostEl = he;
        if (he && he.addEventListener) {
          for (const ev of ["pointerdown", "wheel", "keydown"]) he.addEventListener(ev, onPanel, true);
          unhook = () => { for (const ev of ["pointerdown", "wheel", "keydown"]) he.removeEventListener(ev, onPanel, true); };
        }
      }
      if (!v.sidebar() || !idleMs()) disarm();
      else arm();
      paintChip();
    },
    /** The view left (Map picked, switched off): nothing waits. */
    detach(){ disarm(); stopFollow(); },
    /** The sidebar's first view (and again while nobody has moved the
     *  camera, as the map arrives): its home, at once. False: open as ever
     *  (not the sidebar, or no house to choose a floor from yet). */
    open(){
      if (!v.sidebar() || !s3()) return false;
      const h = homeOf();
      return h.set || h.floor ? goHome(false) : false;
    },
    /** The floor showing changed: by hand (the floor chips, a key, a menu) it counts as a touch. */
    floorChanged(){ if (!quiet) touched(false); },
    /** The people drawn changed. */
    peopleChanged(){ paintChip(); },
    touched: () => touched(true),
    menuItems, tick, rate, nextPerson,
    /** A person's card, with Follow (or Stop following). */
    cardOf(key, card){
      const on = !!(follow && follow.key === key);
      return { ...card, buttons: [{ text: on ? "Stop following" : "Follow", title: on ? "Let the camera go" : "Keep the camera on them as they move",
                                    act: () => { if (on) stopFollow(); else startFollow(key); } }] };
    },
    follow: (key) => startFollow(key),
    stopFollow: () => stopFollow(),
    goHome: () => goHome(true),
    setHome,
    state(){
      return { home: readHome(), atHome, armed: timer !== null, idleMs: idleMs(), returns, follow: follow ? { ...follow } : null, gliding,
               chip: { shown: !chip.hidden, text: chip.hidden ? "" : chip.textContent }, visited };
    },
    dispose(){
      disarm();
      if (unhook) unhook();
      unhook = null; follow = null;
      for (const ev of ["pointerdown", "wheel", "keydown"]) v.root.removeEventListener(ev, onView, true);
      try { if (motion && motion.parentNode === row) v.root.appendChild(motion); row.remove(); css.remove(); } catch (_) { /* gone with the view */ }
    },
  };
}
