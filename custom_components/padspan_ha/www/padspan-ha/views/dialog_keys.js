// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * The keyboard for the panel's cards, sheets, drawers and dialogs.
 *
 * The click-through test of 2026-11-20 found that Escape did nothing on the
 * phone menu, the Atlas builder guide, the flat Atlas's room, door and
 * receiver cards and Live Aboard's receiver cards (their ✕ and a tap outside
 * worked), and that the panel's dialog never took the keyboard: Tab walked
 * the page behind it, and on closing the focus fell to the page.
 *
 * holdKeys(box, o) gives one of them, once it is on the page:
 *   - Escape does what its close does (o.close): only the one opened last,
 *     and only when the key was pressed in it or with nothing focused, so an
 *     editor's own Escape or the 3D view's keys elsewhere keep theirs. One
 *     opened without o.close keeps its own Escape (the panel's dialog).
 *   - It takes the focus (o.focus, or the box itself, which shows no ring),
 *     so the keyboard is in it; o.take === false leaves the focus alone.
 *   - o.modal: Tab and Shift+Tab stay inside it while it is open.
 *   - When it closes (the release it returns), the focus goes back to what
 *     had it when it opened (or, when nothing had, to what was pressed to
 *     open it: a tile or a room on the map, which takes the focus without
 *     joining the Tab order), or to what replaced that if the view was drawn
 *     again meanwhile.
 * Nothing about how they look changes.
 *
 * keyOf / findKey: a view drawn again replaces the control that had the
 * focus; the panel puts the focus on its replacement (panel.js
 * _renderCurrentView, lights_panel.js _render), found by its id, its data-*
 * attributes, or failing those by its tag, words and title when no other
 * control there has the same.
 *
 * tests/js/dialog_keys.mjs drives it.
 */

const TABBABLE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';

/** The element that has the focus, inside shadow roots too (null: nothing). */
export function deepActive(){
  const doc = globalThis.document;
  let a = doc ? doc.activeElement : null;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  if (!a || a === doc.body || a === doc.documentElement) return null;
  if (a.shadowRoot) return null;               // a shadow host with nothing focused inside it
  return a;
}
/** n is box or inside it, across shadow roots. */
export function within(n, box){
  for (let p = n; p; p = p.parentNode || p.host) if (p === box) return true;
  return false;
}
const shown = (n) => !n.getClientRects || n.getClientRects().length > 0;
/** The controls Tab reaches inside box, in order. */
export function tabbables(box){
  return [...box.querySelectorAll(TABBABLE)].filter((n) => !n.disabled && n.tabIndex >= 0 && shown(n));
}
function put(n){
  try { n.focus({ preventScroll: true }); } catch (_) { /* focus is a nicety */ }
}
const up = (n) => (n.parentNode && n.parentNode.nodeType === 1 ? n.parentNode : (n.parentNode && n.parentNode.host) || null);

// What was pressed last. A tile, a row or a room on the map that opens a card
// is often no control, so nothing has the focus after a tap on it; the card
// gives the focus back to what was pressed.
let pressed = null;
{
  const w = globalThis.window;
  if (w && typeof w.addEventListener === "function") {
    w.addEventListener("pointerdown", (e) => {
      const p = typeof e.composedPath === "function" ? e.composedPath() : [];
      pressed = { t: p[0] || e.target, at: Date.now() };
    }, true);
  }
}
/** What a press just now was on, outside box: its nearest focusable element, else the element that is the
 *  clickable thing (where cursor: pointer starts). Null when there was no press just now. */
function pressedControl(box){
  if (!pressed || Date.now() - pressed.at > 2000) return null;
  let n = pressed.t;
  if (n && n.nodeType !== 1) n = up(n);
  if (!n || !n.isConnected || within(n, box)) return null;
  for (let p = n; p; p = up(p)) if (p.tabIndex >= 0 && !p.disabled) return p;
  const cursor = (x) => { try { return globalThis.getComputedStyle(x).cursor; } catch (_) { return ""; } };
  if (cursor(n) !== "pointer") return null;
  while (up(n) && cursor(up(n)) === "pointer") n = up(n);
  return n;
}

const words = (n) => String(n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
/** What finds n again after a redraw: its id, its data-* attributes, or its tag and words. */
export function keyOf(n){
  if (!n || typeof n.getAttribute !== "function") return null;
  const id = n.getAttribute("id");
  if (id) return { id };
  const tag = String(n.tagName || "").toLowerCase();
  const names = typeof n.getAttributeNames === "function" ? n.getAttributeNames() : [];
  const data = names.filter((k) => k.startsWith("data-")).map((k) => [k, n.getAttribute(k)]);
  if (data.length) return { tag, data };
  const text = words(n), label = n.getAttribute("aria-label") || n.getAttribute("title") || "";
  if (!text && !label) return null;
  // Words alone are often not enough (a Rename on every row): the nearest
  // element round it that has an id or data-* attributes (the row) says which.
  let anc = null;
  for (let p = up(n), i = 0; p && i < 6 && !anc; p = up(p), i++) {
    if (typeof p.getAttribute !== "function") break;
    const pn = typeof p.getAttributeNames === "function" ? p.getAttributeNames() : [];
    if (p.getAttribute("id") || pn.some((k) => k.startsWith("data-"))) anc = keyOf(p);
  }
  return { tag, text, label, anc };
}
const q = (v) => String(v).replace(/["\\]/g, "\\$&");
/** The one element in root that key names (null: none, or more than one). */
export function findKey(root, key){
  if (!root || !key || typeof root.querySelectorAll !== "function") return null;
  const sel = key.id ? `[id="${q(key.id)}"]` : key.data ? key.tag + key.data.map(([k, v]) => `[${k}="${q(v)}"]`).join("") : key.tag;
  let all;
  try { all = [...root.querySelectorAll(sel)]; } catch (_) { return null; }
  if (key.text !== undefined) all = all.filter((n) => words(n) === key.text && (n.getAttribute("aria-label") || n.getAttribute("title") || "") === key.label);
  // Some data-* change from one drawing to the next (a row's age): one of the
  // others alone that still names exactly one element.
  if (all.length !== 1 && key.data && key.data.length > 1) {
    for (const [k, v] of key.data) {
      let one;
      try { one = root.querySelectorAll(`${key.tag}[${k}="${q(v)}"]`); } catch (_) { continue; }
      if (one.length === 1) return one[0];
    }
  }
  if (all.length !== 1 && key.anc) {
    const row = findKey(root, key.anc);
    return row ? findKey(row, { ...key, anc: null }) : null;
  }
  return all.length === 1 ? all[0] : null;
}
/** Focus what had it (from), or its replacement; false when neither is there. */
export function refocus(from){
  if (!from) return false;
  let n = from.el && from.el.isConnected ? from.el : null;
  if (!n && from.root && from.root.isConnected !== false) n = findKey(from.root, from.key);
  if (!n || n.disabled || typeof n.focus !== "function") return false;
  put(n);
  // What was pressed was no control (a tile, a room on the map): it takes the
  // focus back without joining the Tab order, and shows no ring for it.
  if (deepActive() !== n && typeof n.hasAttribute === "function" && !n.hasAttribute("tabindex")) {
    n.setAttribute("tabindex", "-1");
    if (n.style) n.style.outline = "none";
    put(n);
  }
  // A text field keeps where the caret was.
  if (from.sel && n !== from.el && typeof n.setSelectionRange === "function") {
    try { n.setSelectionRange(from.sel[0], from.sel[1]); } catch (_) { /* not a text field */ }
  }
  return deepActive() === n;
}
/** What refocus needs to find n again later. */
export function remember(n){
  if (!n) return null;
  let sel = null;
  try { if (typeof n.selectionStart === "number") sel = [n.selectionStart, n.selectionEnd]; } catch (_) { /* not a text field */ }
  return { el: n, key: keyOf(n), root: typeof n.getRootNode === "function" ? n.getRootNode() : null, sel };
}

// Open ones, the last opened last.
const stack = [];
const alive = (h) => h.box.isConnected && !(h.o.open && !h.o.open());
function onKey(e){
  while (stack.length && !alive(stack[stack.length - 1])) stack.pop();
  if (!stack.length) { stop(); return; }
  const top = stack[stack.length - 1];
  const path = typeof e.composedPath === "function" ? e.composedPath() : [];
  const t = path[0] || e.target;
  const doc = globalThis.document;
  const nowhere = !t || t === doc || t === doc.body || t === doc.documentElement || t === globalThis.window;
  if (e.key === "Escape") {
    if (e.defaultPrevented || typeof top.o.close !== "function") return;
    // Pressed somewhere else (an editor's field, the 3D view): that one's Escape.
    if (!nowhere && !within(t, top.box)) return;
    e.preventDefault();
    e.stopPropagation();
    top.o.close();
    return;
  }
  if (e.key !== "Tab" || !top.o.modal || e.altKey || e.ctrlKey || e.metaKey) return;
  const list = tabbables(top.box);
  const a = deepActive();
  if (!list.length) { e.preventDefault(); put(top.box); return; }
  const first = list[0], last = list[list.length - 1];
  if (!a || !within(a, top.box)) { e.preventDefault(); put(e.shiftKey ? last : first); }
  else if (e.shiftKey && (a === first || a === top.box)) { e.preventDefault(); put(last); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); put(first); }
}
let listening = false;
function start(){
  const w = globalThis.window;
  if (listening || !w || typeof w.addEventListener !== "function") return;
  // Capture: the open one hears its key before the page behind it does.
  w.addEventListener("keydown", onKey, true);
  listening = true;
}
function stop(){
  const w = globalThis.window;
  if (!listening || !w) return;
  w.removeEventListener("keydown", onKey, true);
  listening = false;
}

/**
 * Hold the keyboard for box (on the page already). o = { close, modal, focus,
 * take, opener, open }: see above; o.opener is what gets the focus back
 * (default: what has it now, else what was just pressed), o.open() false means it was closed some other
 * way (a drawer that stays on the page). Returns release(restore = true),
 * called by its close; release.opener is the opener, for a dialog that
 * replaces another.
 */
export function holdKeys(box, o = {}){
  const opener = o.opener !== undefined ? o.opener : (deepActive() || pressedControl(box));
  const back = remember(opener && !within(opener, box) ? opener : null);
  const h = { box, o };
  for (let i = stack.length - 1; i >= 0; i--) if (!alive(stack[i])) stack.splice(i, 1);
  stack.push(h);
  start();
  if (o.take !== false) {
    let to = o.focus || null;
    if (!to) {
      to = box;
      if (box.getAttribute && !box.hasAttribute("tabindex")) {
        box.setAttribute("tabindex", "-1");
        // The box takes the focus to hold the keyboard; it shows no ring for it.
        if (box.style) box.style.outline = "none";
      }
    }
    put(to);
  }
  let done = false;
  const release = (restore = true) => {
    if (done) return;
    done = true;
    const i = stack.indexOf(h);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) stop();
    if (!restore) return;
    // Only when the focus went with it (or nowhere): a press outside may have put it somewhere on purpose.
    const a = deepActive();
    if (!a || within(a, box) || !a.isConnected) refocus(back);
  };
  release.opener = opener;
  return release;
}
/** For the tests: how many are held. */
export const held = () => stack.length;
