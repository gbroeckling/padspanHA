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
// name, or one of panel / atlas_panel / lib / other — and, beside it, the
// kind of error and the line in that PadSpan file it was thrown from. The
// backend drops anything outside its closed lists (telemetry.py UI_ERRORS,
// ui_error_at_allowed). Never the message, never the stack, never a URL.

const _FRAME = /\/padspan_ha_static\/padspan-ha\/([A-Za-z0-9_./-]+?)\.m?js(?=[?#:)\s]|$)/g;
const _NAME = /^[a-z0-9_]{1,40}$/;
const THROTTLE_MS = 60000;
// Counted as "other", never by name: the usage report's vocabulary is kept
// clear of the tester sign-up entirely (tests/test_tester.py).
const _AS_OTHER = new Set(["tester_signup"]);

/** Map one PadSpan file path (relative to padspan-ha/, no extension) to a name. */
export function moduleName(path) {
  const p = String(path || "");
  if (p === "panel") return "panel";
  if (p === "lights_panel") return "atlas_panel";
  if (p.startsWith("lib/")) return "lib";
  const m = /^views\/([^/]+)$/.exec(p);
  if (m && _NAME.test(m[1])) return _AS_OTHER.has(m[1]) ? "other" : m[1];
  return "other";
}

// The same frames with their line: ".../views/calibration.js?b=…:1380:12".
const _FRAME_LINE = /\/padspan_ha_static\/padspan-ha\/([A-Za-z0-9_./-]+?)\.m?js(?:\?[^:)\s]*)?:(\d{1,5}):\d+/g;
// The kind of error, from the error's own constructor name; a rejected
// promise without an Error (a Home Assistant websocket error object) is a
// rejection.
export const UI_ERROR_KINDS = ["type", "reference", "range", "syntax", "rejection", "other"];

/** "type" for a TypeError, "rejection" for a rejected promise that was not an Error, … */
export function uiErrorKind(ev) {
  try {
    const e = ev && (ev.type === "unhandledrejection" ? ev.reason : ev.error);
    const n = e && typeof e === "object" ? String(e.name || "") : "";
    const k = { TypeError: "type", ReferenceError: "reference", RangeError: "range", SyntaxError: "syntax" }[n];
    if (k) return k;
    if (ev && ev.type === "unhandledrejection" && !(e instanceof Error)) return "rejection";
    return "other";
  } catch (_e) {
    return "other";
  }
}

/** "<module>:<line>" of the top-most PadSpan frame that is not lib/, or null.
 * A line in PadSpan's own code says nothing about the house it ran in. */
export function uiErrorAt(ev) {
  try {
    const e = ev && (ev.type === "unhandledrejection" ? ev.reason : ev.error);
    const text = e && typeof e === "object" ? e.stack : null;
    if (typeof text !== "string" || !text) return null;
    _FRAME_LINE.lastIndex = 0;
    let m, first = null;
    while ((m = _FRAME_LINE.exec(text))) {
      const at = moduleName(m[1]) + ":" + String(parseInt(m[2], 10));
      if (!m[1].startsWith("lib/")) return at;
      if (!first) first = at;
    }
    return first;
  } catch (_e) {
    return null;
  }
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

// ── What a person is told when something fails (2026-11-21) ─────────────
// A toast used to show an error's own text: "FabricStore not loaded",
// "required key not provided @ data['map_id']", "Cannot read properties of
// undefined", "[object Object]" (String() of Home Assistant's error object)
// or just "3" (a lost connection). PadSpan's own refusals are sentences
// written for people (tests/test_plain_errors.py holds them to that), so
// those are shown as they are; what comes from Home Assistant's machinery or
// from a bug on this page gets a plain line that says what to do.
export const ERROR_WORDS = Object.freeze({
  connection: "The connection to Home Assistant was lost. Wait a moment and try again.",
  network: "PadSpan couldn't be reached over the network. Check the connection and try again.",
  restart: "This page and the PadSpan on Home Assistant don't match. Refresh the page; if that doesn't help, restart Home Assistant.",
  sent: "PadSpan couldn't use what this page sent. Refresh the page and try again.",
  server: "Something went wrong in PadSpan. Try again; if it keeps happening, Health → Open Diagnostics has a report to send.",
  page: "Something went wrong on this page. Refresh it and try again.",
  admin: "Only an administrator can do this.",
  other: "Something went wrong. Try again.",
});
// Home Assistant's schema check (voluptuous) words its refusals for programmers.
const _SCHEMA = /@ data\[|required key not provided|extra keys not allowed|expected (a |an )?(str|int|float|bool|dict|list|number)|not a valid value|value must be (at|one)|length of value/i;
// Python's own words, should one ever reach a refusal.
const _PYTHON = /Traceback|NoneType|has no attribute|is not defined|object is not (subscriptable|iterable|callable)|unsupported operand|positional argument|keyword argument/;
const _BUG = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError"]);

/** The words to show for an error a call or the page threw. Never throws. */
export function errorText(e) {
  try {
    if (e == null) return ERROR_WORDS.other;
    if (typeof e === "string") return e.trim() || ERROR_WORDS.other;
    if (typeof e === "number") return ERROR_WORDS.connection;   // home-assistant-js-websocket's ERR_* codes
    if (typeof e !== "object") return ERROR_WORDS.other;
    const code = e.code, msg = typeof e.message === "string" ? e.message.trim() : "";
    if (code === 3 || /^connection lost/i.test(msg)) return ERROR_WORDS.connection;
    if (code === "unknown_command") return ERROR_WORDS.restart;
    if (code === "unknown_error" || _PYTHON.test(msg)) return ERROR_WORDS.server;
    if (_SCHEMA.test(msg)) return ERROR_WORDS.sent;
    if (msg === "Unauthorized") return ERROR_WORDS.admin;
    // fetch() that never reached anyone throws a TypeError of its own words: the network, not a bug.
    if (e.name === "TypeError" && /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return ERROR_WORDS.network;
    if (_BUG.has(String(e.name || ""))) return ERROR_WORDS.page;
    return msg || ERROR_WORDS.other;
  } catch (_e) {
    return ERROR_WORDS.other;
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
    // Beside them (0.38.177), so a throw can be found in the code: its kind,
    // and the file and line it came from. Never the message.
    send("ui_error_kind:" + uiErrorKind(ev));
    const at = uiErrorAt(ev);
    if (at && /^[a-z0-9_]{1,40}:[1-9][0-9]{0,4}$/.test(at)) send("ui_error_at:" + at);
    return mod;
  } catch (_e) {
    return null;   // the error reporter must never be the error
  }
}
