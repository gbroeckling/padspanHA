// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// views/ui_error.js on real-shaped error events: which ones are PadSpan's,
// which module each is credited to, and the per-module throttle.
//
// usage: ui_error_attribution.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, report: {...} }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
const M = await import(pathToFileURL(join(WWW, "views", "ui_error.js")).href);

const HOST = "http://192.168.1.11:8123";
const S = `${HOST}/padspan_ha_static/padspan-ha`;
const chrome = (...files) => "TypeError: x is undefined\n" + files.map((f, i) => `    at fn${i} (${f}:${10 + i}:${5 + i})`).join("\n");
const firefox = (...files) => files.map((f, i) => `fn${i}@${f}:${10 + i}:${5 + i}`).join("\n");
const err = (stack) => ({ type: "error", error: { stack }, filename: "", message: "boom" });
const rej = (reason) => ({ type: "unhandledrejection", reason });

const cases = {
  ha_frontend: err(chrome(`${HOST}/frontend_latest/app.abc123.js`, `${HOST}/frontend_latest/core.js`)),
  resize_observer: { type: "error", error: null, filename: "", message: "ResizeObserver loop completed with undelivered notifications." },
  other_card: err(chrome(`${HOST}/hacsfiles/button-card/button-card.js`)),
  lookalike_path: err(chrome(`${HOST}/hacsfiles/padspan-ha/views/overview.js`)),
  overview_chrome: err(chrome(`${S}/views/overview.js?b=abc`, `${S}/panel.js?v=0.38.85&b=abc&cb=full`)),
  overview_firefox: err(firefox(`${S}/views/overview.js?b=abc`, `${S}/panel.js?v=0.38.85&b=abc&cb=full`)),
  helper: err(chrome(`${S}/views/wled_tab_look.js?v=1&b=2`, `${S}/views/maps.js?b=2`)),
  panel: err(chrome(`${S}/panel.js?v=0.38.85&b=abc&cb=full`)),
  atlas: err(chrome(`${S}/lights_panel.js?v=0.38.85&b=abc`)),
  ha_over_ours: err(chrome(`${HOST}/frontend_latest/app.js`, `${S}/views/follow.js?b=x`)),
  lib_over_view: err(chrome(`${S}/lib/preact-bundle.js?b=x`, `${S}/lib/preact-bundle.js?b=x`, `${S}/views/maps.js?b=x`)),
  lib_only: err(chrome(`${S}/lib/preact-bundle.js?b=x`, `${HOST}/frontend_latest/app.js`)),
  other_file: err(chrome(`${S}/help_content.js?b=x`)),
  no_query: err(chrome(`${S}/views/traceback.js`)),
  filename_only: { type: "error", error: "a thrown string", filename: `${S}/views/health.js?b=x`, message: "x" },
  filename_foreign: { type: "error", error: "a thrown string", filename: `${HOST}/frontend_latest/app.js`, message: "x" },
  rejection_ours: rej({ stack: chrome(`${S}/views/occupancy.js?b=x`) }),
  rejection_ha_ws: rej({ code: "unknown_command", message: "Unknown command." }),
  rejection_null: rej(null),
  rejection_string: rej(`${S}/views/overview.js`),
  rejection_hostile: rej({ get stack() { throw new Error("no"); } }),
  no_event: null,
};
const out = {};
for (const [k, ev] of Object.entries(cases)) out[k] = M.uiErrorModule(ev);

// Throttle, the "while" name, and a reporter that must never throw.
const sent = [];
const send = (n) => sent.push(n);
const t0 = 1_000_000;
const report = {
  first: M.reportUiError(cases.overview_chrome, "overview", send, t0),
  again_30s: M.reportUiError(cases.overview_chrome, "maps", send, t0 + 30_000),
  other_module_30s: M.reportUiError(cases.helper, "maps", send, t0 + 30_000),
  foreign: M.reportUiError(cases.ha_frontend, "overview", send, t0 + 40_000),
  after_61s: M.reportUiError(cases.overview_chrome, "follow", send, t0 + 61_000),
  bad_view_name: M.reportUiError(cases.atlas, "Nicole's Office", send, t0),
  send_throws: (() => { try { return M.reportUiError(cases.panel, "overview", () => { throw new Error("ws down"); }, t0); } catch (e) { return "THREW"; } })(),
  garbage_event: (() => { try { return M.reportUiError(42, "overview", send, t0); } catch (e) { return "THREW"; } })(),
  sent,
};
// The kind of error and the line in PadSpan's own file (0.38.174).
const typeErr = () => { try { null.x; } catch (e) { return e; } };
const kinds = {
  type: M.uiErrorKind({ type: "error", error: typeErr() }),
  reference: M.uiErrorKind({ type: "error", error: new ReferenceError("q") }),
  range: M.uiErrorKind({ type: "error", error: new RangeError("q") }),
  plain: M.uiErrorKind({ type: "error", error: new Error("q") }),
  ws_rejection: M.uiErrorKind(rej({ code: "save_failed", message: "This map has no metre scale yet" })),
  error_rejection: M.uiErrorKind(rej(new TypeError("q"))),
  garbage: M.uiErrorKind(42),
};
const ats = {
  chrome: M.uiErrorAt(cases.overview_chrome),
  firefox: M.uiErrorAt(cases.overview_firefox),
  lib_over_view: M.uiErrorAt(cases.lib_over_view),
  lib_only: M.uiErrorAt(cases.lib_only),
  filename_only: M.uiErrorAt(cases.filename_only),
  rejection_ours: M.uiErrorAt(cases.rejection_ours),
  foreign: M.uiErrorAt(cases.ha_frontend),
};
console.log(JSON.stringify({ cases: out, report, kinds, ats }));
