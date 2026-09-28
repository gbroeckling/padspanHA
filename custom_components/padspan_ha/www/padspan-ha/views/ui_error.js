// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Which PadSpan module threw — or nobody.
//
// A window "error" / "unhandledrejection" listener hears EVERY error on the
// page: Home Assistant's own frontend, other cards and panels, browser
// extensions, the "ResizeObserver loop" notice. Crediting each one to the
// PadSpan tab that happened to be open is how the opt-in report came to show
// ui_error:overview on a third of installs with no way to tell whether any
// of it was ours. So an error counts only when a frame of its stack (or the
// file it was raised in) is served from PadSpan's own static path, and it is
// credited to the module that threw, not to the tab.
//
// What leaves this file is a module NAME — a view id, a helper file's base
// name, or one of panel / atlas_panel / lib / other. The backend drops any
// name outside its closed list (telemetry.py UI_ERRORS). Never the message,
// never the stack, never a URL.

const _FRAME = /\/padspan_ha_static\/padspan-ha\/([A-Za-z0-9_./-]+?)\.m?js(?=[?#:)\s]|$)/g;
const _NAME = /^[a-z0-9_]{1,40}$/;
const THROTTLE_MS = 60000;

/** Map one PadSpan file path (relative to padspan-ha/, no extension) to a name. */
export function moduleName(path) {
  const p = String(path || "");
  if (p === "panel") return "panel";
  if (p === "lights_panel") return "atlas_panel";
  if (p.startsWith("lib/")) return "lib";
  const m = /^views\/([^/]+)$/.exec(p);
  if (m && _NAME.test(m[1])) return m[1];
  return "other";
}

function _paths(text) {
  const out = [];
  if (typeof text !== "string" || !text) return out;
  _FRAME.lastIndex = 0;
  let m;
  while ((m = _FRAME.exec(text))) out.push(m[1]);
  return out;
}

/**
 * The PadSpan module an error event came from, or null when it is not ours.
 * Takes the top-most PadSpan frame; the vendored lib/ (Preact, htm) is
 * skipped when PadSpan code sits below it, because a throw inside Preact's
 * render is the view's bug, not Preact's.
 */
export function uiErrorModule(ev) {
  try {
    if (!ev) return null;
    let paths = [];
    if (ev.type === "unhandledrejection") {
      const r = ev.reason;
      paths = _paths(r && typeof r === "object" ? r.stack : null);
    } else {
      const e = ev.error;
      paths = _paths(e && typeof e === "object" ? e.stack : null);
      if (!paths.length) paths = _paths(ev.filename);
    }
    if (!paths.length) return null;
    const own = paths.find(p => !p.startsWith("lib/"));
    return moduleName(own || paths[0]);
  } catch (_e) {
    return null;   // a hostile reason object (throwing getter) is not ours to count
  }
}

// Shared by every copy of this module on the page. panel.js and
// lights_panel.js import it under different cache-buster queries, i.e. as
// two module instances; the throttle has to be one, or both panels count
// the same throw.
function _seen() {
  const g = globalThis;
  if (!g.__padspanUiErrorSeen || typeof g.__padspanUiErrorSeen !== "object") g.__padspanUiErrorSeen = {};
  return g.__padspanUiErrorSeen;
}

/**
 * Count one error event if it is PadSpan's: `ui_error:<module>`, and beside
 * it `ui_error_while:<openView>` — the tab that was on screen, which is not
 * always the module that threw (a helper, the panel shell). At most once per
 * module per minute: a throw inside a render loop fires as fast as the loop
 * does, and the signal worth having is "maps threw today". Never throws.
 * Returns the module name it counted, or null.
 */
export function reportUiError(ev, openView, send, now = Date.now()) {
  try {
    const mod = uiErrorModule(ev);
    if (!mod) return null;
    const seen = _seen();
    if (now - (seen[mod] || 0) < THROTTLE_MS) return null;
    seen[mod] = now;
    send("ui_error:" + mod);
    const view = String(openView || "");
    if (_NAME.test(view)) send("ui_error_while:" + view);
    return mod;
  } catch (_e) {
    return null;   // the error reporter must never be the error
  }
}
