// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): what a finger, a
// pen or a mouse does on the 3D view — the flat Atlas's use surface
// (lights_map.js wireUseSurface), on the same state machine
// (createHoldTracker) and calling the very same actions through the host's
// own api (lights_panel.js _useApi, maps.js previewApi). A tap switches a
// light; a hold opens its controls; a hold then a drag dims it; a room's
// name opens the room sheet, a floor's badge the floor sheet, a door the
// barrier card, a motion sensor its activity calendar; a read-only tile says
// it is read-only. Nothing here calls Home Assistant itself: the host's api
// and the Atlas's own helpers do, exactly as they do for the flat map.
//
// The 3D view finds what is under the pointer (live_aboard.js, its own
// picking) and where it is on screen; this file never touches three.js. A
// press that moves before its hold is armed is no press: it is handed back,
// and the drag turns the house.
//
// The hover box is the Atlas's (.lv-hoverhud): what a click would land on,
// and what is under it. The pressed ring is the Atlas's too (.lpress): it
// appears, fills while a hold counts and turns gold once armed. No timers:
// the 3D view's frames time the hold (tick), so nothing runs while nothing
// is pressed.

const { createHoldTracker, dragBrightness, setLightBrightness, exactDeviceOf, lastBrightness, openBarrierCard,
        HOLD_MS, PRESS_RING_MS, _exactBrightness, _tellProblems } =
  await import(`./lights_map.js${new URL(import.meta.url).search}`);

const NS = "http://www.w3.org/2000/svg";
const RING_R = 18;                         // the pressed ring, px
const HOVER_R = 15;                        // the hover mark, px
const HIDE_GRACE_MS = 450;                 // the hover box lingers this long over nothing (as on the Atlas)
/** A piece of furniture linked to a device the Atlas has no marker for (a TV,
 *  a washer, a robot; P5): a tap or a hold opens Home Assistant's own
 *  controls for it, never a blind switch (a washer on a plug must never go
 *  off from a stray tap). */
function moreInfo(node, eid){
  node.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: eid } }));
}
// The bubble wirePress shows while a drag dims, the same face.
const DIM_BUBBLE = "position:fixed;z-index:10001;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:800;"
  + "font-variant-numeric:tabular-nums;color:#111827;background:linear-gradient(135deg,#f59e0b,#fbbf24);"
  + "box-shadow:0 0 18px rgba(251,191,36,.6);pointer-events:none;font-family:Inter,system-ui,sans-serif";
const UNDER_TITLE = "Act on this one instead — it's under the marker on top";

/**
 * o = {
 *   root            the 3D view's element (the marks and the box go in it)
 *   pick(x, y)      → {hit, under} | null: the target under client (x, y)
 *                     and the devices under it. A target is {kind: "device" |
 *                     "room" | "floor" | "door" | "entity", key, label, eid?,
 *                     room?, z?, bar?} — z is the plate's storey as the
 *                     Atlas's badge carries it, bar the barrier as its card
 *                     is handed it; "entity" a piece of furniture linked to a
 *                     device the Atlas has no marker for (P5).
 *   screenOf(t)     → {x, y} | {poly: [[x, y], …]} | null, in px from root
 *   api()           → the host's use api, or null (then nothing is pressed)
 *   frame()         asks the view for a frame (the hold is timed on frames)
 *   cursor(on)      the pointer over something to press, or not
 * }
 */
export function createUseSurface(o){
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "la3d-ov");
  svg.setAttribute("aria-hidden", "true");
  const hoverG = document.createElementNS(NS, "g");
  svg.appendChild(hoverG);
  o.root.appendChild(svg);
  const hudBox = document.createElement("div");
  hudBox.className = "la3d-hud";
  const hud = document.createElement("div");
  hud.className = "lv-hoverhud";
  hud.hidden = true;
  hudBox.appendChild(hud);
  o.root.appendChild(hudBox);
  // Leaving the box for anywhere but the house is done with it.
  hudBox.addEventListener("pointerleave", (e) => {
    if (!press && !(e && e.relatedTarget && o.root.contains(e.relatedTarget))) hideHud();
  });

  let press = null, hover = null, hudKey = "", emptySince = null, rerender = null, lastHover = null;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const stamp = (e) => (e && Number.isFinite(e.timeStamp) ? e.timeStamp : now());

  // ── the marks over the house ──────────────────────────────────────────────
  function shape(tag, attrs){
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  }
  function mark(t, g){
    while (g.firstChild) g.removeChild(g.firstChild);
    const at = t ? o.screenOf(t) : null;
    if (!at) return;
    const st = { fill: "none", stroke: "#e879f9", "stroke-width": "2", "stroke-opacity": "0.9", "stroke-linejoin": "round" };
    if (at.poly) g.appendChild(shape("polygon", { ...st, points: at.poly.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") }));
    else g.appendChild(shape("circle", { ...st, cx: at.x.toFixed(1), cy: at.y.toFixed(1), r: HOVER_R }));
  }
  // The pressed ring (lights_map.js pressRing's own circle and classes, so
  // styles.css's .lpress animation fills it and .armed turns it gold).
  function ringFor(t){
    const at = o.screenOf(t);
    if (!at) return null;
    const p = at.poly ? at.poly.reduce((a, q) => [a[0] + q[0] / at.poly.length, a[1] + q[1] / at.poly.length], [0, 0]) : [at.x, at.y];
    const circ = (2 * Math.PI * RING_R).toFixed(1);
    const c = shape("circle", { class: "lpress", cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: RING_R, fill: "none",
      stroke: "#fbbf24", "stroke-width": "3", "pointer-events": "none", "stroke-dasharray": circ, "stroke-dashoffset": circ });
    c.style.setProperty("--lv-ring-ms", `${HOLD_MS - PRESS_RING_MS}ms`);
    svg.appendChild(c);
    return c;
  }
  function placeRing(c, t){
    const at = c && o.screenOf(t);
    if (!at) return;
    const p = at.poly ? at.poly.reduce((a, q) => [a[0] + q[0] / at.poly.length, a[1] + q[1] / at.poly.length], [0, 0]) : [at.x, at.y];
    c.setAttribute("cx", p[0].toFixed(1)); c.setAttribute("cy", p[1].toFixed(1));
  }

  // ── the hover box ─────────────────────────────────────────────────────────
  const line = (k, text, tag = "div", cls = "lv-hoverhud-hit") => {
    const n = document.createElement(tag);
    n.className = cls;
    const kk = document.createElement("span");
    kk.className = "lv-hoverhud-k";
    kk.textContent = k;
    n.appendChild(kk);
    n.appendChild(document.createTextNode(text));
    return n;
  };
  function showHud(t, under){
    const key = [t, ...under].map(u => u.key + "=" + u.label).join("|");
    emptySince = null;
    if (key === hudKey && !hud.hidden) return;
    hudKey = key;
    while (hud.firstChild) hud.removeChild(hud.firstChild);
    hud.hidden = false;
    hud.appendChild(line("Click", t.label));
    for (const u of under) {
      const b = line("Under", u.label, "button", "lv-hoverhud-under");
      b.type = "button";
      b.title = UNDER_TITLE;
      b.addEventListener("click", (e) => { e.stopPropagation(); actUnder(u); });
      hud.appendChild(b);
    }
  }
  function hideHud(){ hudKey = ""; emptySince = null; hud.hidden = true; }
  // An "Under" pick does what a tap on that device does (the sidebar's
  // onPickUnder): motion its activity, a device with controls its controls,
  // anything else switches.
  function actUnder(u){
    if (u.kind === "entity") { moreInfo(o.root, u.eid); return; }
    const api = o.api();
    const l0 = api && api.lightsByEid ? api.lightsByEid[u.eid] : null;
    if (!l0) return;
    if (l0.isMotion) api.openActivity(u.eid);
    else if (api.controlsFor(l0)) api.openControls(u.eid);
    else api.toggle(u.eid);
  }

  // ── a press ───────────────────────────────────────────────────────────────
  function endPress(){
    const p = press;
    press = null;
    if (!p) return;
    if (p.ring) { try { p.ring.remove(); } catch (_) { /* gone with the view */ } }
    if (p.bubble) { try { p.bubble.remove(); } catch (_) { /* gone already */ } }
    if (p.touch) hideHud();
  }
  // What the release meant, done the Atlas's way (wirePress's finish, the
  // room / floor / barrier clicks).
  function act(p, r){
    const api = p.api, t = p.target;
    if (t.kind === "entity") { if (r === "tap" || r === "open") moreInfo(o.root, t.eid); return; }
    if (t.kind === "device") {
      const eid = t.eid, l0 = api.lightsByEid[eid];
      if (l0.isMotion) { if (r === "tap" || r === "open") api.openActivity(eid); return; }
      if (r === "tap") { api.toggle(eid); return; }
      if (r === "open") { if (p.holdable) api.openControls(eid); else api.toggle(eid); return; }
      if (r === "drag-end") {
        const b = p.dragTo;
        if (typeof b === "number" && api.hass) setLightBrightness(api.hass, eid, b).then(q => _tellProblems(api.toast, q)).catch(() => api.toast("Could not set brightness", true));
        rerender = { at: now() + 500, api };
        o.frame();
      }
      return;
    }
    if (r !== "tap" && r !== "open") return;
    if (t.kind === "room") api.openRoom(t.room);
    else if (t.kind === "floor") api.openFloor(t.z);
    else if (t.kind === "door" && t.bar && t.bar.linked_entity_id && api.hass) openBarrierCard(api.hass, t.bar, api);
  }
  // The hold is armed once HOLD_MS has passed still (the Atlas's timer).
  // Checked on the frames, and on the next move too, so a slow screen whose
  // frame comes late never turns a held drag into a cancelled press.
  function arm(p, t){
    if (!p.holdable || p.armed || t - p.t0 < HOLD_MS || p.tracker.tick(t) !== "arm") return;
    p.armed = true;
    if (p.ring) p.ring.classList.add("armed");
    p.dragBri = null;
  }
  // A hold then a drag (dimmable lights): relative brightness, sent at most
  // every 180 ms, the bubble showing the level — wirePress's own.
  function dim(e, r){
    const p = press, api = p.api, eid = p.target.eid;
    if (e.preventDefault) e.preventDefault();
    if (p.dragBri === null) {
      const st = api.hass && api.hass.states ? api.hass.states[eid] : null;
      const ex = exactDeviceOf(eid);
      p.dragBri = ex ? (_exactBrightness(api.hass && api.hass.states, ex) ?? ex.lookBri ?? 128)
        : typeof st?.attributes?.brightness === "number" ? st.attributes.brightness : (lastBrightness(eid) || 128);
      if (p.ring) { p.ring.remove(); p.ring = null; }
      p.bubble = document.createElement("div");
      p.bubble.style.cssText = DIM_BUBBLE;
      document.body.appendChild(p.bubble);
    }
    const b = dragBrightness(p.dragBri, r.dy);
    p.bubble.textContent = `${Math.round(b / 255 * 100)}%`;
    p.bubble.style.left = `${e.clientX + 16}px`; p.bubble.style.top = `${e.clientY - 14}px`;
    p.dragTo = b;
    const t = Date.now();
    if (t - p.lastSend > 180 && api.hass) {
      p.lastSend = t;
      setLightBrightness(api.hass, eid, b).catch(() => {});
    }
  }

  return {
    /** A pointer went down on the house. True: a press on something has
     *  started, and the camera waits; false: nothing to press there. */
    down(e){
      if (press || (e.pointerType === "mouse" && e.button !== undefined && e.button !== 0)) return false;
      const api = o.api();
      const found = api ? o.pick(e.clientX, e.clientY) : null;
      const t = found && found.hit;
      if (!t) return false;
      let holdable = false, canDrag = false;
      if (t.kind === "device") {
        // The Atlas wires a press only for a device it knows (wirePress).
        const l0 = api.lightsByEid ? api.lightsByEid[t.eid] : null;
        if (!l0) return false;
        holdable = !!api.controlsFor(l0);
        canDrag = !!l0.dimmable && String(t.eid).startsWith("light.");
      }
      const tracker = createHoldTracker({ canDrag });
      tracker.down(e.clientX, e.clientY, stamp(e));
      press = { target: t, api, tracker, holdable, t0: stamp(e), ring: null, armed: false, dragBri: null, dragTo: null,
                bubble: null, lastSend: 0, touch: e.pointerType === "touch" };
      hover = null;
      mark(t, hoverG);
      showHud(t, []);
      o.frame();
      return true;
    },
    /** The pressed pointer moved: "cancel" hands it back to the camera,
     *  "dim" is a drag dimming the light, null is nothing yet. */
    move(e){
      if (!press) return null;
      arm(press, stamp(e));
      const r = press.tracker.move(e.clientX, e.clientY);
      if (r === "cancel") { mark(null, hoverG); endPress(); return "cancel"; }
      if (r && r.action === "drag") { dim(e, r); return "dim"; }
      return null;
    },
    up(e){
      if (!press) return;
      const p = press, r = p.tracker.up(stamp(e));
      if (p.touch) mark(null, hoverG);
      endPress();
      act(p, r);
    },
    cancel(){
      if (!press) return;
      press.tracker.cancel();
      mark(null, hoverG);
      endPress();
    },
    /** A mouse or pen moving over the house (no button down). */
    hover(e){
      if (press) return;
      lastHover = { clientX: e.clientX, clientY: e.clientY };
      const found = o.api() ? o.pick(e.clientX, e.clientY) : null;
      if (found && found.hit) {
        hover = found;
        mark(found.hit, hoverG);
        showHud(found.hit, found.under || []);
        o.cursor(true);
        return;
      }
      hover = null;
      mark(null, hoverG);
      o.cursor(false);
      // Crossing empty space on the way to the box must not hide it at once.
      if (!hud.hidden && emptySince === null) { emptySince = stamp(e); o.frame(); }
    },
    /** The house changed under a still pointer (a poll): what is there now,
     *  in its words now — a door just opened says so. */
    rehover(){
      if (press || !hover || !lastHover) return;
      const found = o.api() ? o.pick(lastHover.clientX, lastHover.clientY) : null;
      if (found && found.hit) { hover = found; mark(found.hit, hoverG); showHud(found.hit, found.under || []); }
    },
    /** The pointer left the house (into the box itself: kept). */
    leave(e){
      if (e && e.relatedTarget && hudBox.contains(e.relatedTarget)) return;
      lastHover = null;
      hover = null;
      mark(null, hoverG);
      o.cursor(false);
      if (!press) hideHud();
    },
    /** Called on the view's frames: the ring, the arming, the box's grace,
     *  the redraw after a dim. True while it still needs frames. */
    tick(t){
      let more = false;
      const p = press;
      if (p && p.holdable && p.tracker.active && !p.armed) {
        if (!p.ring && t - p.t0 >= PRESS_RING_MS) p.ring = ringFor(p.target);
        arm(p, t);
        more = !p.armed;
      }
      if (emptySince !== null && !press) {
        if (t - emptySince >= HIDE_GRACE_MS) hideHud(); else more = true;
      }
      if (rerender) {
        if (t >= rerender.at) { const r = rerender; rerender = null; try { r.api.rerender(); } catch (_) { /* the host's */ } }
        else more = true;
      }
      return more;
    },
    /** The camera moved: the marks follow what they mark. */
    layout(){
      if (press) { mark(press.target, hoverG); if (press.ring) placeRing(press.ring, press.target); }
      else if (hover) mark(hover.hit, hoverG);
    },
    /** Forget what is shown (the house was rebuilt, or the view left). */
    clear(){
      if (press) this.cancel();
      hover = null;
      mark(null, hoverG);
      hideHud();
    },
    dispose(){
      this.clear();
      try { svg.remove(); hudBox.remove(); } catch (_) { /* gone with the view */ }
    },
    get pressing(){ return !!press; },
    state(){
      return { hover: hover && hover.hit ? hover.hit.key : null, hud: hud.hidden ? null : hud.textContent,
               under: hover && hover.under ? hover.under.map(u => u.key) : [],
               press: press ? { key: press.target.key, armed: press.armed, ring: !!press.ring, dimming: press.dragBri !== null } : null };
    },
  };
}
