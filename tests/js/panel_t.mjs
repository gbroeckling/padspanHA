// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// panel.js's own t() and tn(), for a harness that lifts panel.js code by text
// and runs it: the definitions as panel.js writes them, with views/i18n.js not
// loaded, so they give the English source with its {placeholders} filled.

export function panelT(src) {
  src = String(src).replace(/\r\n/g, "\n");
  const a = src.indexOf("const _enFill = "), b = src.indexOf("\nfunction pill(text)", a);
  if (a < 0 || b < 0) throw new Error("panel.js: its t()/tn() were not found");
  return new Function("let _I18N = null;\n" + src.slice(a, b) + "\nreturn { t, tn };")();
}
