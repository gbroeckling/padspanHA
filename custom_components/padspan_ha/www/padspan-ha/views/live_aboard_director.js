// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// The director: Live Aboard on the sidebar (and a wall screen) flies to what
// just went off.
//
//   triggers     settings.atlas_3d_director: [{entity, camera}], an
//                administrator's pick in Settings → Live Aboard; [] (the
//                default) is off and nothing here runs. A doorbell or other
//                event.* firing, a binary_sensor turning on (a door, smoke,
//                motion at the front door), an alarm_control_panel going to
//                triggered. What each one was when the screen first looked is
//                never news: only a change after that.
//   the flight   the camera flies to where the device is drawn, else its room
//                (the view's own ◎ Find), its floor at the top, and a card
//                says what happened; with a camera picked, its snapshot
//                (Home Assistant's camera proxy, the picture it already
//                hands out: one image, no stream). After HOLD_MS it flies
//                back to the home view.
//   someone here a touch in the last TOUCH_GRACE_MS, someone followed, or
//                Edit, Furnish, full screen or a card open: the card shows,
//                the camera stays where they put it. Touched while the card
//                is up: it does not fly back; going home is the panel's
//                own idle return then.
//
// One look at the states a second while there are triggers, on the sidebar;
// nothing asked of Home Assistant, no frames at rest.

export const HOLD_MS = 20000;              // the card up, then home
export const TOUCH_GRACE_MS = 20000;       // touched this recently: the camera is theirs
const LOOK_MS = 1000;                      // the states looked at this often
const DOMAINS = ["event", "binary_sensor", "alarm_control_panel"];
const BAD = new Set(["", "unknown", "unavailable"]);

/** settings.atlas_3d_director as [{entity, camera}] (camera "" for none). */
export function triggersOf(raw){
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const e = t && typeof t.entity === "string" ? t.entity : "";
    if (!DOMAINS.includes(e.split(".")[0]) || out.some(o => o.entity === e)) continue;
    const c = t && typeof t.camera === "string" && t.camera.startsWith("camera.") ? t.camera : "";
    out.push({ entity: e, camera: c });
  }
  return out;
}

/** Did `eid` just go off, from state `was` to `st` (Home Assistant's state
 *  objects; was undefined: the first look, never news)? */
export function wentOff(eid, was, st){
  if (was === undefined || !st || BAD.has(String(st.state))) return false;
  const a = String(st.state), b = was ? String(was.state) : "";
  switch (eid.split(".")[0]) {
    case "event": return a !== b;                         // its state is when it last fired
    case "binary_sensor": return a === "on" && b !== "on";
    case "alarm_control_panel": return a === "triggered" && b !== "triggered";
    default: return false;
  }
}

/** What the card says happened. */
export function wordsOf(eid, st){
  const at = (st && st.attributes) || {}, dc = String(at.device_class || "");
  switch (eid.split(".")[0]) {
    case "event":
      if (dc === "doorbell") return "Someone rang the doorbell";
      return at.event_type ? `Event: ${String(at.event_type).replace(/_/g, " ")}` : "Event";
    case "alarm_control_panel": return "The alarm is going off";
    default:
      if (["door", "garage_door", "opening", "window"].includes(dc)) return "Opened";
      if (["smoke", "gas", "carbon_monoxide", "heat", "moisture", "safety", "problem", "tamper"].includes(dc))
        return `Alarm: ${dc.replace(/_/g, " ")}`;
      if (["motion", "occupancy", "presence", "moving"].includes(dc)) return "Motion";
      return "Turned on";
  }
}

/** The camera's snapshot through Home Assistant's camera proxy (its own
 *  entity_picture, the signed link it hands every card), or null. */
export function snapshotOf(st){
  const p = st && st.attributes && st.attributes.entity_picture;
  if (typeof p !== "string" || !p.startsWith("/api/camera_proxy/")) return null;
  return `${p}${p.includes("?") ? "&" : "?"}_=${Date.now()}`;
}

// Above the bar of controls (bottom:64px, the toast's own clearance), never over it;
// on a wall it grows with the other cards (live_aboard.js :host([data-wall])).
const CSS = `
.la3d-dircard{position:absolute;left:12px;bottom:64px;z-index:3;width:min(340px,calc(100% - 24px));box-sizing:border-box;padding:10px 12px;
  border-radius:12px;background:rgba(6,14,9,.92);border:1px solid rgba(251,191,36,.55);box-shadow:0 6px 22px rgba(0,0,0,.45);
  color:#e2e8f0;font:600 13px/1.35 system-ui,"Segoe UI",Roboto,sans-serif}
.la3d-dircard[hidden]{display:none}
.la3d-dircard .la3d-dtop{display:flex;align-items:flex-start;gap:8px}
.la3d-dircard .la3d-dname{flex:1;font-size:15px;font-weight:800}
.la3d-dircard .la3d-dwhat{color:#fbbf24;font-weight:700}
.la3d-dircard .la3d-dwhen{color:rgba(226,240,232,.65);font-weight:600;font-size:12px}
.la3d-dircard button{all:unset;box-sizing:border-box;cursor:pointer;padding:0 6px;border-radius:6px;font-size:18px;line-height:1;color:rgba(226,240,232,.75)}
.la3d-dircard button:hover,.la3d-dircard button:focus-visible{background:rgba(255,255,255,.1)}
.la3d-dircard img{display:block;width:100%;margin-top:8px;border-radius:8px;background:#000}`;

/**
 * v = {
 *   root, guard(fn)
 *   settings()        the settings (settings.atlas_3d_director), or null
 *   states()          Home Assistant's states now ({entity id: state})
 *   sidebar()         is this the sidebar's screen, showing?
 *   busy()            why the camera may not move now, or null
 *   following()       is someone followed?
 *   touchedAt()       when the screen was last touched (performance.now ms)
 *   fly(eid)          the camera to the device or its room, untouched by the
 *                     panel's count of touches; false: nowhere to go
 *   goHome()          back to the home view
 * }
 */
export function createDirector(v){
  const doc = v.root.ownerDocument || document;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const css = doc.createElement("style");
  css.textContent = CSS;
  v.root.appendChild(css);
  const card = doc.createElement("div");
  card.className = "la3d-dircard";
  card.hidden = true;
  card.setAttribute("data-la3d-director", "");
  card.setAttribute("role", "status");
  v.root.appendChild(card);
  const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
  for (const ev of ["pointerup", "wheel", "dblclick"]) card.addEventListener(ev, stop);

  let seen = new Map(), look = null, hold = null, shown = null, fired = 0, flights = 0, returns = 0;

  const triggers = () => { const s = v.settings(); return s ? triggersOf(s.atlas_3d_director) : []; };

  function hide(){
    if (hold !== null) { clearTimeout(hold); hold = null; }
    card.hidden = true;
    while (card.firstChild) card.removeChild(card.firstChild);
    shown = null;
  }
  function paint(t, st, cam){
    while (card.firstChild) card.removeChild(card.firstChild);
    const at = (st && st.attributes) || {};
    const top = doc.createElement("div"); top.className = "la3d-dtop";
    const name = doc.createElement("div"); name.className = "la3d-dname";
    name.textContent = String(at.friendly_name || t.entity);
    const x = doc.createElement("button");
    x.type = "button"; x.textContent = "×"; x.title = "Close"; x.setAttribute("aria-label", "Close");
    x.addEventListener("click", v.guard((e) => { stop(e); hide(); }));
    top.append(name, x);
    const what = doc.createElement("div"); what.className = "la3d-dwhat"; what.textContent = wordsOf(t.entity, st);
    const when = doc.createElement("div"); when.className = "la3d-dwhen";
    when.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    card.append(top, what, when);
    const src = cam ? snapshotOf(cam) : null;
    if (src) {
      const img = doc.createElement("img");
      img.alt = String((cam.attributes && cam.attributes.friendly_name) || t.camera);
      img.src = src;
      img.addEventListener("error", () => { try { img.remove(); } catch (_) { /* gone */ } });
      card.appendChild(img);
    }
    card.hidden = false;
  }
  /** `t` went off: the card, and the camera there unless someone is using the screen. */
  function direct(t, st, states){
    fired++;
    hide();
    paint(t, st, t.camera ? states[t.camera] : null);
    const free = !v.busy() && !v.following() && now() - v.touchedAt() > TOUCH_GRACE_MS;
    const flew = free && v.fly(t.entity) === true;
    if (flew) flights++;
    shown = { entity: t.entity, flew, touch: v.touchedAt() };
    hold = setTimeout(v.guard(done), HOLD_MS);
  }
  function done(){
    hold = null;
    const s = shown;
    hide();
    // Touched since, or busy now: the camera is theirs, and the panel's idle return takes it home.
    if (s && s.flew && v.touchedAt() === s.touch && !v.busy() && !v.following() && v.sidebar()) { returns++; v.goHome(); }
  }
  function check(){
    const list = triggers();
    if (!list.length || !v.sidebar()) { seen = new Map(); return; }
    const states = v.states() || {};
    const next = new Map();
    let hit = null;
    for (const t of list) {
      const st = states[t.entity];
      next.set(t.entity, st || null);
      // Several at once: an alarm before a door, else the first in the list.
      if (wentOff(t.entity, seen.has(t.entity) ? seen.get(t.entity) : undefined, st)
          && (!hit || (t.entity.startsWith("alarm_control_panel.") && !hit.t.entity.startsWith("alarm_control_panel.")))) hit = { t, st };
    }
    seen = next;
    if (hit) direct(hit.t, hit.st, states);
  }
  function loop(){
    look = null;
    check();
    if (triggers().length && v.sidebar()) look = setTimeout(v.guard(loop), LOOK_MS);
  }

  return {
    /** The newest card is in: look while there are triggers on the sidebar. */
    attach(){
      if (!triggers().length || !v.sidebar()) { this.detach(); return; }
      check();
      if (look === null) look = setTimeout(v.guard(loop), LOOK_MS);
    },
    /** The view left: nothing looks, nothing waits. */
    detach(){ if (look !== null) { clearTimeout(look); look = null; } hide(); seen = new Map(); },
    /** Is its card up (the panel's idle return waits for it)? */
    showing: () => shown !== null,
    check,
    state(){
      return { triggers: triggers().map(t => t.entity), looking: look !== null, holding: hold !== null, fired, flights, returns,
               card: shown ? { ...shown, text: card.textContent, img: (card.querySelector && card.querySelector("img") || {}).src || null } : null };
    },
    dispose(){
      this.detach();
      try { card.remove(); css.remove(); } catch (_) { /* gone with the view */ }
    },
  };
}
