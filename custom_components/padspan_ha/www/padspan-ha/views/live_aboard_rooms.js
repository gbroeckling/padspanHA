// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's rooms by name: the room chips along the top, and a room's
// panel beside the house.
//
//   chips   every named room of the map (a room with no name has none), under
//           a small label of its floor when there are several floors, the
//           top floor first; one name twice on a floor is one chip. A chip
//           shows the room's floor, flies to the room as a double-tap does,
//           tints it and opens its panel. One "Rooms ▾" button with the list,
//           grouped the same way, everywhere; a wide screen whose ⋯ list has
//           Room chips along the top ticked has a row along the top instead,
//           that scrolls sideways (the wheel scrolls it too). Both step aside
//           with the bars when the map is alone.
//   panel   a tap on a room opens its panel beside the house (a bottom sheet
//           on a narrow screen) instead of the Atlas's room sheet over the
//           whole page: the same lines and buttons (lights_map.js
//           openRoomSheet, drawn into the panel), then "More devices of the
//           area (n)": what Home Assistant puts in the room's area that the
//           map doesn't list, each opening Home Assistant's own controls.
//           ✕ or Escape closes it.
//
// The view (live_aboard.js) says what the rooms are, flies, and fills the
// panel; this file holds the rules, the elements and their looks. Nothing
// here imports three.js or calls Home Assistant.

/** The chips: [{fid, words, rooms: [{fid (the floor it is drawn on), top (its storey: a split level's own),
 *  name, key}]}], the top floor first, names in order. floors: [{id, name, elev, outdoor, parent, rooms: [{name}]}]. */
export function roomChipGroups(floors){
  const list = (floors || []).filter(f => f && f.id !== undefined);
  const byId = new Map(list.map(f => [String(f.id), f]));
  const groups = new Map();
  for (const f of list) {
    const top = f.parent && byId.has(String(f.parent)) ? byId.get(String(f.parent)) : f;
    const gid = String(top.id);
    if (!groups.has(gid)) groups.set(gid, { fid: gid, words: String(top.name || top.id), elev: Number(top.elev) || 0, outdoor: !!top.outdoor, rooms: [], seen: new Set() });
    const g = groups.get(gid);
    for (const r of f.rooms || []) {
      const name = r && typeof r.name === "string" ? r.name.trim() : "";
      if (!name || g.seen.has(name.toLowerCase())) continue;
      g.seen.add(name.toLowerCase());
      g.rooms.push({ fid: String(f.id), top: gid, name, key: `${f.id}|${name}` });
    }
  }
  return [...groups.values()].filter(g => g.rooms.length)
    .sort((a, b) => (a.outdoor - b.outdoor) || (b.elev - a.elev))
    .map(g => ({ fid: g.fid, words: g.words, rooms: g.rooms.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** What Home Assistant puts in a room's area (its own area, else its device's,
 *  the area named as the room, as roomScenes reads it) that the panel doesn't
 *  list already: [{eid, name, state}], by name. Not scenes and scripts (the
 *  panel's own buttons), not hidden, disabled, config or diagnostic entities,
 *  and nothing Home Assistant no longer has. shown: the eids listed above it. */
export function areaExtras(hass, room, shown){
  const ents = (hass && hass.entities) || {}, devs = (hass && hass.devices) || {}, areas = (hass && hass.areas) || {};
  const states = (hass && hass.states) || {}, want = String(room || "").trim().toLowerCase(), skip = new Set(shown || []);
  if (!want) return [];
  const out = [];
  for (const [eid, e] of Object.entries(ents)) {
    if (!e || skip.has(eid) || /^(scene|script)\./.test(eid) || e.hidden || e.hidden_by || e.disabled_by || e.entity_category) continue;
    const aid = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
    const area = aid && areas[aid];
    if (!area || String(area.name || "").trim().toLowerCase() !== want) continue;
    const st = states[eid];
    if (!st) continue;
    const unit = st.attributes && st.attributes.unit_of_measurement;
    out.push({ eid, name: String((st.attributes && st.attributes.friendly_name) || e.name || eid.split(".")[1]),
               state: `${String(st.state).replace(/_/g, " ")}${unit && st.state !== "unavailable" ? ` ${unit}` : ""}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const CSS = `
.la3d-rchips{position:absolute;left:122px;right:10px;top:16px;z-index:2;display:flex;align-items:center;gap:5px;height:40px;box-sizing:border-box;
  overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior:contain;white-space:nowrap;pointer-events:auto;
  -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);
  transition:opacity .25s ease,visibility .25s}
.la3d-rchips::-webkit-scrollbar{display:none}
.la3d-rchips button{all:unset;box-sizing:border-box;flex:none;cursor:pointer;padding:6px 12px;border-radius:999px;font:600 12.5px/1.2 system-ui,"Segoe UI",Roboto,sans-serif;
  color:#e2e8f0;background:rgba(6,14,9,.86);border:1px solid rgba(120,190,155,.26);box-shadow:0 2px 8px rgba(0,0,0,.3)}
.la3d-rchips button:hover,.la3d-rchips button:focus-visible{border-color:#52b788;background:rgba(20,48,34,.92)}
.la3d-rchips button[aria-pressed="true"]{border-color:#52b788;background:rgba(45,106,79,.92);color:#fff}
.la3d-rchips .la3d-rfl{flex:none;margin-left:6px;padding:5px 8px;border-radius:999px;background:rgba(6,14,9,.62);
  font:700 10px/1 system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#a7c4b5}
.la3d-rchips .la3d-rfl:first-child{margin-left:0}
.la3d-rchips.la3d-rcompact{right:auto;overflow:visible;-webkit-mask-image:none;mask-image:none}
.la3d.la3d-bare .la3d-rchips{opacity:0;visibility:hidden;pointer-events:none}
/* The rooms take the top line on a wide screen that is not a wall (the row, or Rooms ▾ beside ⋯): the touch tip gives
   way (How it works in Views ▾ has it), and the hover box, the People and Motion chips, the motion key and the rain line
   move down under it, so nothing centred at the top runs into Rooms ▾ on a screen of middling width. */
.la3d.la3d-roomrow .la3d-tip{display:none}
.la3d.la3d-hasrooms .la3d-hud{top:60px}
.la3d.la3d-roomrow .la3d-chiprow,.la3d.la3d-roomrow > .la3d-mchip{top:62px}
.la3d.la3d-roomrow .la3d-mkey{top:102px}
.la3d.la3d-roomrow .la3d-wet{top:100px}
.la3d.la3d-roomon:not(.la3d-narrow) .la3d-rchips:not(.la3d-rcompact){right:380px}
:host([data-wall]) .la3d-rchips{zoom:var(--wall-ctl,var(--wall-ui,1))}
.la3d-room{position:absolute;right:10px;top:10px;z-index:4;box-sizing:border-box;width:min(360px,calc(100% - 20px));max-height:var(--la3d-roomh,calc(100% - 78px));
  overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;border-radius:14px;background:linear-gradient(180deg,rgba(16,31,21,.97),rgba(11,23,16,.97));
  border:1px solid rgba(120,190,155,.3);box-shadow:0 12px 36px rgba(0,0,0,.55);color:#e2e8f0}
.la3d.la3d-bare .la3d-room{top:62px;max-height:calc(100% - 72px)}
.la3d.la3d-narrow .la3d-room{left:0;right:0;top:auto;bottom:0;width:auto;max-height:52%;border-radius:16px 16px 0 0;border-bottom:none;
  box-shadow:0 -10px 36px rgba(0,0,0,.55)}
.la3d.la3d-roomon .la3d-toast{z-index:6}
:host([data-wall]) .la3d-room{zoom:var(--wall-ctl,var(--wall-ui,1))}
.la3d-rmore{padding:0 14px 12px}
.la3d-rmore > button{all:unset;box-sizing:border-box;display:block;width:100%;margin-top:8px;padding:9px 12px;border-radius:10px;cursor:pointer;
  font:600 12.5px/1.3 Inter,system-ui,sans-serif;color:#7dd3fc;background:rgba(125,211,252,.07);border:1px solid rgba(125,211,252,.22)}
.la3d-rmore > button:hover,.la3d-rmore > button:focus-visible{background:rgba(125,211,252,.13)}
.la3d-rmore ul{list-style:none;margin:6px 0 0;padding:0}
.la3d-rmore li button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:8px 4px;cursor:pointer;
  border-bottom:1px solid rgba(120,190,155,.08);font:13px/1.3 Inter,system-ui,sans-serif;color:#e2e8f0}
.la3d-rmore li button:hover,.la3d-rmore li button:focus-visible{background:rgba(82,183,136,.08)}
.la3d-rmore li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.la3d-rmore li i{flex:none;font-style:normal;font-size:11px;font-weight:700;letter-spacing:.04em;color:#94a3b8}`;

const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
function styleOnce(root){
  if (root.querySelector("style[data-la3d-rooms-css]")) return;
  const s = (root.ownerDocument || document).createElement("style");
  s.setAttribute("data-la3d-rooms-css", "");
  s.textContent = CSS;
  root.appendChild(s);
}

/**
 * The room chips. v = {
 *   root, guard(fn)
 *   groups()         roomChipGroups(...) for the house as it is drawn
 *   compact()        true: one "Rooms ▾" button (the default; always on a narrow screen and a wall)
 *   line()           true: the rooms have the top line (a wide screen, not a wall), row or Rooms ▾
 *   go(chip, way)    a room picked: {fid, top, name, key}, and how: "chip" (the row) or "list" (Rooms ▾)
 *   list(anchor, items)   the view's own menu over `anchor` (items: {head} or {text, act})
 *   current()        the key of the room open, or null (its chip is marked)
 * } → { sync(), state(), dispose() }
 */
export function createRoomChips(v){
  const doc = v.root.ownerDocument || document;
  styleOnce(v.root);
  const el = doc.createElement("div");
  el.className = "la3d-rchips";
  el.setAttribute("data-la3d-rchips", "");
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Rooms");
  el.style.display = "none";
  for (const ev of ["pointerdown", "pointerup", "dblclick", "contextmenu"]) el.addEventListener(ev, stop);
  // The wheel scrolls the row sideways (it never zooms the house under it).
  el.addEventListener("wheel", v.guard((e) => {
    stop(e);
    if (el.classList.contains("la3d-rcompact")) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (d) { el.scrollLeft += d; if (e.preventDefault) e.preventDefault(); }
  }), { passive: false });
  v.root.appendChild(el);
  let drawn = null, groups = [];
  const items = () => groups.flatMap(g => [...(groups.length > 1 ? [{ head: g.words }] : []),
    ...g.rooms.map(c => ({ text: c.name, on: v.current() === c.key, act: () => v.go(c, "list") }))]);
  function sync(){
    groups = v.groups() || [];
    const compact = !!v.compact(), line = v.line ? !!v.line() : !compact, cur = v.current ? v.current() : null;
    const key = JSON.stringify([compact, line, groups.map(g => [g.words, g.rooms.map(c => c.key)])]);
    if (key !== drawn) {
      drawn = key;
      el.replaceChildren();
      el.classList.toggle("la3d-rcompact", compact);
      el.style.display = groups.length ? "" : "none";
      v.root.classList.toggle("la3d-hasrooms", !!groups.length);
      v.root.classList.toggle("la3d-roomrow", !!groups.length && line);
      if (compact) {
        const b = doc.createElement("button");
        b.type = "button"; b.textContent = "Rooms ▾";
        b.title = "Go to a room";
        b.setAttribute("data-la3d-rooms", "");
        b.setAttribute("aria-haspopup", "true");
        b.addEventListener("click", v.guard((e) => { stop(e); v.list(b, items()); }));
        el.appendChild(b);
      } else {
        for (const g of groups) {
          if (groups.length > 1) {
            const l = doc.createElement("span");
            l.className = "la3d-rfl"; l.textContent = g.words;
            el.appendChild(l);
          }
          for (const c of g.rooms) {
            const b = doc.createElement("button");
            b.type = "button"; b.textContent = c.name;
            b.title = `Go to ${c.name}${groups.length > 1 ? ` (${g.words})` : ""}`;
            b.setAttribute("data-la3d-rchip", c.key);
            b.setAttribute("aria-pressed", "false");
            b.addEventListener("click", v.guard((e) => { stop(e); v.go(c, "chip"); }));
            el.appendChild(b);
          }
        }
      }
    }
    for (const b of el.querySelectorAll("[data-la3d-rchip]")) {
      const on = b.getAttribute("data-la3d-rchip") === cur;
      if (on && b.getAttribute("aria-pressed") !== "true") {
        // The room open's chip scrolled into the row (the row only, never the page).
        const x0 = b.offsetLeft || 0, x1 = x0 + (b.offsetWidth || 0), w = el.clientWidth || 0;
        if (w && x0 < el.scrollLeft) el.scrollLeft = Math.max(0, x0 - 24);
        else if (w && x1 > el.scrollLeft + w) el.scrollLeft = x1 - w + 32;
      }
      b.setAttribute("aria-pressed", String(on));
    }
  }
  return {
    sync,
    state(){
      return { shown: el.style.display !== "none", compact: el.classList.contains("la3d-rcompact"),
               chips: [...el.querySelectorAll("[data-la3d-rchip]")].map(b => b.getAttribute("data-la3d-rchip")),
               floors: [...el.querySelectorAll(".la3d-rfl")].map(n => n.textContent),
               pressed: [...el.querySelectorAll("[data-la3d-rchip]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.getAttribute("data-la3d-rchip")) };
    },
    dispose(){ try { el.remove(); v.root.classList.remove("la3d-hasrooms", "la3d-roomrow"); } catch (_) { /* gone with the view */ } },
  };
}

/**
 * The room panel: its card in the view, its "More devices of the area" part,
 * Escape. v = { root, guard, onClose() (closed by ✕, Escape or close()),
 * moreInfo(eid) (Home Assistant's own controls for one) } → { open(room) →
 * the element the room's sheet is drawn into, more(list), close(), isOpen,
 * room, el, state() }.
 */
export function createRoomPanel(v){
  const doc = v.root.ownerDocument || document;
  styleOnce(v.root);
  let el = null, body = null, moreEl = null, room = null, moreOpen = false, list = [], off = null;
  function close(){
    if (!el) return;
    if (off) off();
    off = null;
    try { el.remove(); } catch (_) { /* gone with the view */ }
    el = body = moreEl = null;
    room = null; moreOpen = false; list = [];
    v.root.classList.remove("la3d-roomon");
    if (v.onClose) v.onClose();
  }
  function paintMore(){
    if (!moreEl) return;
    moreEl.replaceChildren();
    if (!list.length) return;
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = `${moreOpen ? "▾" : "▸"} More devices of the area (${list.length})`;
    b.setAttribute("aria-expanded", String(moreOpen));
    b.title = "What Home Assistant puts in this room's area that the map doesn't show";
    b.addEventListener("click", v.guard((e) => { stop(e); moreOpen = !moreOpen; paintMore(); }));
    moreEl.appendChild(b);
    if (!moreOpen) return;
    const ul = doc.createElement("ul");
    for (const d of list) {
      const li = doc.createElement("li"), r = doc.createElement("button"), n = doc.createElement("span"), s = doc.createElement("i");
      r.type = "button";
      r.setAttribute("data-la3d-more-eid", d.eid);
      r.title = `${d.name}: open its controls`;
      n.textContent = d.name; s.textContent = d.state;
      r.append(n, s);
      r.addEventListener("click", v.guard((e) => { stop(e); v.moreInfo(d.eid); }));
      li.appendChild(r);
      ul.appendChild(li);
    }
    moreEl.appendChild(ul);
  }
  return {
    /** Open (or move) the panel to `name`: the element its sheet goes into, emptied. */
    open(name){
      if (el && room === name) return body;
      if (el) close();
      room = name; moreOpen = false; list = [];
      el = doc.createElement("div");
      el.className = "la3d-room";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", name);
      el.setAttribute("data-la3d-room", name);
      for (const ev of ["pointerdown", "pointerup", "wheel", "dblclick", "contextmenu"]) el.addEventListener(ev, stop);
      body = doc.createElement("div");
      moreEl = doc.createElement("div");
      moreEl.className = "la3d-rmore";
      el.append(body, moreEl);
      v.root.appendChild(el);
      v.root.classList.add("la3d-roomon");
      const esc = v.guard((e) => { if (e.key === "Escape") close(); });
      const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
      if (win && win.addEventListener) { win.addEventListener("keydown", esc); off = () => win.removeEventListener("keydown", esc); }
      return body;
    },
    /** "More devices of the area (n)": areaExtras' list, kept open or shut as it was. */
    more(next){
      const was = JSON.stringify(list);
      list = Array.isArray(next) ? next : [];
      if (JSON.stringify(list) !== was || (moreEl && !moreEl.firstChild && list.length)) paintMore();
    },
    close,
    get isOpen(){ return !!el; },
    get room(){ return room; },
    get el(){ return el; },
    state(){
      return { open: !!el, room, more: list.length, moreOpen, rows: moreOpen ? list.map(d => d.eid) : [],
               text: el ? el.textContent : "" };
    },
  };
}
