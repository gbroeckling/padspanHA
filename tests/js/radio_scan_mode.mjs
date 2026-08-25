// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// RUN the radio marker's scan-mode logic, rather than reading it.
//
// tests/test_scan_mode.py checks that the source keys off `scan_mode` and not
// `connectable`. That is a text check: it proves the right WORD is there, not
// that the right MARKUP comes out. The what's-new card taught the difference
// on 2026-08-25 — source that reads correctly and still throws, or emits the
// wrong thing, the moment it runs.
//
// So this lifts the three expressions the marker is actually built from, out
// of both renderers, and EVALUATES them against radio fixtures covering every
// state a scanner can be in:
//
//     active    the radio transmits — SCAN_REQ out, SCAN_RSP back   -> red, blinking
//     passive   listens only                                        -> unchanged
//     auto      manager promotes it on demand; not a claim of now   -> unchanged
//     null      older habluetooth, or the scanner did not say       -> unchanged
//     offline   no live record at all                              -> unchanged
//
// The last three matter most. On the maintainer's own install 17 of 18 radios
// are passive and 16 of those are connectable, so a marker that guesses paints
// the whole map red.

import { readFileSync } from "node:fs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: radio_scan_mode.mjs <www/padspan-ha dir>"); process.exit(2); }

const fail = [], ok = [];

// Each renderer names things differently; the LOGIC must be identical.
const RENDERERS = [
  {
    file: "views/overview.js",
    live: "isLive", radio: "liveRadio",
    // stand-ins for the drawing locals the template interpolates
    scope: { px: 100, py: 200, rxColor: "#52b788", Math },
  },
  {
    file: "views/plan_viewer.js",
    live: "isOnline", radio: "liveR",
    scope: { px: 0.5, py: 0.25, rxColor: "#52b788", _f: (n) => String(n), _mkR: 6, _sw: 2 },
  },
];

function extract(src, re, what, file) {
  const m = re.exec(src);
  if (!m) throw new Error(`${file}: could not find ${what} — renamed? update this test`);
  return m[1];
}

/** Build the marker exactly as the renderer does, for one radio. */
function marker(r, radio) {
  const src = readFileSync(`${WWW}/${r.file}`, "utf8");
  const activeExpr = extract(src, /const rxActive = ([^;]+);/, "rxActive", r.file);
  const innerExpr = extract(src, /const rxInner = ([^;]+);/, "rxInner", r.file);
  // `;[\r\n]`, not `;\n` — this repo checks out CRLF on Windows, and unlike
  // Python's text mode node hands back the bytes as they are.
  const emit = extract(src, /s \+= (rxActive\s*\?[\s\S]+?);[\r\n]/, "the ring branch", r.file);

  const names = Object.keys(r.scope);
  const vals = names.map((k) => r.scope[k]);
  const fn = new Function(...names, r.live, r.radio, `
    const rxActive = ${activeExpr};
    const rxInner  = ${innerExpr};
    let s = "";
    s += ${emit};
    return { s, rxActive, rxInner };
  `);
  return fn(...vals, radio !== null, radio);
}

function check(label, cond, detail) {
  if (cond) ok.push(label); else fail.push(`${label}${detail ? " — " + detail : ""}`);
}

for (const r of RENDERERS) {
  const tag = r.file.replace("views/", "");

  // ── ACTIVE: red and blinking ─────────────────────────────────────────────
  let out = marker(r, { name: "hub", scan_mode: "active", connectable: false });
  check(`${tag}: active is flagged`, out.rxActive === true, `rxActive=${out.rxActive}`);
  check(`${tag}: active ring is red`, out.rxInner === "#f87171", `rxInner=${out.rxInner}`);
  check(`${tag}: active ring blinks`, /<animate\b[^>]*attributeName="opacity"/.test(out.s), out.s.slice(0, 160));
  check(`${tag}: active ring repeats forever`, /repeatCount="indefinite"/.test(out.s));
  check(`${tag}: active markup is a closed element`, /<\/circle>/.test(out.s), out.s.slice(0, 160));
  check(`${tag}: active ring carries the red stroke`, out.s.includes("#f87171"), out.s.slice(0, 160));
  // connectable:false above proves the decision does NOT come from connectable.

  // ── PASSIVE: untouched, and crucially NOT animated ───────────────────────
  out = marker(r, { name: "hub", scan_mode: "passive", connectable: true });
  check(`${tag}: passive is not active`, out.rxActive === false, `rxActive=${out.rxActive}`);
  check(`${tag}: passive keeps the online colour`, out.rxInner === "#52b788", `rxInner=${out.rxInner}`);
  check(`${tag}: passive does not blink`, !/<animate/.test(out.s), out.s.slice(0, 160));
  check(`${tag}: passive is not red`, !out.s.includes("#f87171"));
  // connectable:true above is the exact shape of 16 of the 18 real radios.

  // ── AUTO: a promise the manager may keep later, not a claim about now ────
  out = marker(r, { name: "hub", scan_mode: "auto", connectable: true });
  check(`${tag}: auto is not drawn as active`, out.rxActive === false, `rxActive=${out.rxActive}`);
  check(`${tag}: auto does not blink`, !/<animate/.test(out.s));

  // ── UNKNOWN: not transmitting and not telling us are different facts ─────
  out = marker(r, { name: "hub", scan_mode: null, connectable: true });
  check(`${tag}: null mode is not active`, out.rxActive === false, `rxActive=${out.rxActive}`);
  out = marker(r, { name: "hub", connectable: true });          // key absent entirely
  check(`${tag}: absent mode is not active`, out.rxActive === false, `rxActive=${out.rxActive}`);

  // ── OFFLINE: no live record. Must not throw reaching into it. ────────────
  try {
    out = marker(r, null);
    check(`${tag}: offline is not active`, out.rxActive === false, `rxActive=${out.rxActive}`);
    check(`${tag}: offline does not blink`, !/<animate/.test(out.s));
  } catch (e) {
    fail.push(`${tag}: offline radio THREW — ${e.message}`);
  }
}

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
