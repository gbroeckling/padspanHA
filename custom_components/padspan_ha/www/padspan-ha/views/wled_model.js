// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * WLED model — the pure half of the Atlas WLED card's Advanced tab: parsing
 * WLED's own metadata, segment arithmetic, version gates. No DOM, no I/O, so
 * every rule here is unit tested (tests/test_wled_model.py).
 *
 * Every rule is taken from the WLED firmware source at v0.14.4 / v0.15.4 /
 * v16.0.1 — docs/research/wled-advanced-tab-2026-09-23.md, "API SURFACE MAP".
 */

// ── Version gates ────────────────────────────────────────────────────────────
// Upstream went 0.15.x → 16.0 (no 0.16). info.vid is the build number
// YYMMDDB; the firmware itself uses 2605010 as its 16.0 cutoff.
export function wledGen(info) {
  const vid = Number(info && info.vid) || 0;
  const ver = String((info && info.ver) || "");
  if (vid >= 2605010 || /^1[6-9]\./.test(ver)) return 16;
  if (/^0\.15\./.test(ver) || (vid >= 2412000 && vid < 2605010)) return 15;
  return 14;
}
export const FEATURES = {
  blendStyle: 16,      // state.bs
  segBlend: 16,        // seg.bm
  segCaps: 16,         // seg.lc
  resetSegs: 16,       // state.rSeg
  pins: 16,            // /json/pins
  bootPreset: 15,      // psave … bootps
  perBusCurrent: 15,   // hw.led.ins[].maxpwr/ledma
  nextInPlaylist: 15,  // state.np
  pinwheel: 15,        // m12 = 4
};
export const has = (info, feature) => wledGen(info) >= (FEATURES[feature] || 99);

/** A stock build says so; anything else is a fork or a board build. */
export function forkOf(info) {
  const repo = String((info && info.repo) || "");
  const ver = String((info && info.ver) || "");
  const brand = String((info && info.brand) || "");
  if (repo && !/^(wled|Aircoookie)\/WLED$/i.test(repo)) return repo;
  if (/sound|moon|mm|ac-/i.test(ver) || (brand && brand !== "WLED")) return ver || brand;
  return null;
}

// ── Effect metadata (/json/fxdata) ───────────────────────────────────────────
// "<sliders>;<colors>;<palette>;<flags>;<defaults>" (json.cpp / index.js
// setEffectParameters). Sliders map in order to sx, ix, c1, c2, c3, o1, o2,
// o3; "!" means the default label, an empty entry hides the control. With no
// metadata at all, the UI shows 2 sliders (fx < 128), 3 colours, a palette.
const SLIDER_KEYS = ["sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3"];
const SLIDER_DEFAULT = { sx: "Speed", ix: "Intensity", c1: "Custom 1", c2: "Custom 2", c3: "Custom 3",
  o1: "Option 1", o2: "Option 2", o3: "Option 3" };
const COLOR_DEFAULT = ["Fx", "Bg", "Cs"];

export function parseFxData(str, fxId = 0) {
  const out = { sliders: [], toggles: [], colors: [], palette: false, paletteLabel: null,
    flags: { single: false, d1: true, d2: false, volume: false, frequency: false }, defaults: {} };
  if (str === undefined || str === null || str === "") {
    if (fxId < 128) out.sliders = [{ key: "sx", label: "Speed" }, { key: "ix", label: "Intensity" }];
    out.colors = COLOR_DEFAULT.map((label, i) => ({ slot: i, label }));
    out.palette = true;
    return out;
  }
  const parts = String(str).split(";");
  const sl = (parts[0] || "").split(",");
  SLIDER_KEYS.forEach((k, i) => {
    const raw = sl[i];
    if (raw === undefined || raw === "") return;
    const label = raw === "!" ? SLIDER_DEFAULT[k] : raw;
    (k.startsWith("o") ? out.toggles : out.sliders).push({ key: k, label, max: k === "c3" ? 31 : 255 });
  });
  const cols = parts.length > 1 ? (parts[1] || "").split(",") : ["!", "!", "!"];
  cols.forEach((c, i) => { if (c !== "" && i < 3) out.colors.push({ slot: i, label: c === "!" ? COLOR_DEFAULT[i] : c }); });
  const pal = parts.length > 2 ? parts[2] : "!";
  out.palette = pal !== "" && pal !== undefined;
  if (out.palette && pal !== "!") out.paletteLabel = pal.split("=")[0] || null;
  const flags = parts.length > 3 ? String(parts[3] || "") : "1";
  out.flags = {
    single: flags.includes("0"), d1: flags.includes("1") || flags === "", d2: flags.includes("2"),
    volume: flags.includes("v"), frequency: flags.includes("f"),
  };
  for (const kv of (parts[4] || "").split(",")) {
    const [k, v] = kv.split("=");
    if (k && v !== undefined && v !== "") out.defaults[k.trim()] = Number(v);
  }
  return out;
}

/** [{id, name, meta}] without reserved slots, in WLED's order. */
export function effectCatalog(names, fxdata) {
  const out = [];
  (names || []).forEach((n, id) => {
    if (!n || n === "RSVD" || n === "-") return;
    out.push({ id, name: String(n).split("@")[0], meta: parseFxData((fxdata || [])[id], id) });
  });
  return out;
}

// ── Segments ─────────────────────────────────────────────────────────────────
// WLED's stop is EXCLUSIVE; people read "0–59 (60)". Deleting is stop:0.
export const segLen = (s) => Math.max(0, (Number(s.stop) || 0) - (Number(s.start) || 0));
export function segRangeLabel(s) {
  const n = segLen(s);
  if (!n) return "empty";
  return `LEDs ${s.start}–${s.stop - 1} (${n})`;
}

/** Problems with a 1D layout, in words a person can act on. */
export function layoutWarnings(segs, ledCount, maxSeg) {
  const live = (segs || []).filter(s => segLen(s) > 0).sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 1; i < live.length; i++) {
    const a = live[i - 1], b = live[i];
    // A deliberate blend (bm, v16) layers segments on purpose.
    if (b.start < a.stop && !(a.bm || b.bm)) {
      out.push({ kind: "overlap", ids: [a.id, b.id],
        text: `Segments ${a.id} and ${b.id} overlap on LEDs ${b.start}–${Math.min(a.stop, b.stop) - 1}` });
    }
  }
  const gaps = coverageGaps(live, ledCount);
  for (const g of gaps) out.push({ kind: "gap", range: g, text: `LEDs ${g[0]}–${g[1] - 1} aren't in any segment` });
  for (const s of live) {
    if (ledCount && s.stop > ledCount) out.push({ kind: "beyond", ids: [s.id],
      text: `Segment ${s.id} ends past the strip (${ledCount} LEDs)` });
  }
  if (maxSeg && (segs || []).length > maxSeg) out.push({ kind: "count",
    text: `${(segs || []).length} segments — this device allows ${maxSeg}` });
  return out;
}

/** Uncovered [start, stop) spans of 0..ledCount. */
export function coverageGaps(segs, ledCount) {
  const live = (segs || []).filter(s => segLen(s) > 0).map(s => [s.start, Math.min(s.stop, ledCount || s.stop)])
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let at = 0;
  for (const [a, b] of live) {
    if (a > at) gaps.push([at, a]);
    at = Math.max(at, b);
  }
  if (ledCount && at < ledCount) gaps.push([at, ledCount]);
  return gaps;
}

/** Where "Add segment" goes: the first gap, else split the longest segment. */
export function smartAddRange(segs, ledCount) {
  const gaps = coverageGaps(segs, ledCount);
  if (gaps.length) return { start: gaps[0][0], stop: gaps[0][1], split: null };
  const live = (segs || []).filter(s => segLen(s) > 1);
  if (!live.length) return null;
  const big = live.reduce((m, s) => (segLen(s) > segLen(m) ? s : m));
  const mid = big.start + Math.floor(segLen(big) / 2);
  return { start: mid, stop: big.stop, split: { id: big.id, stop: mid } };
}

/** The next free segment id (WLED appends when id >= the count). */
export function nextSegId(segs) {
  const ids = new Set((segs || []).filter(s => segLen(s) > 0 || s.id === 0).map(s => s.id));
  let id = 0;
  while (ids.has(id)) id++;
  return id;
}

/** One segment write: bounds changes always resend the name (v16 clears it). */
export function segBoundsWrite(seg, start, stop) {
  const w = { id: seg.id, start: Math.max(0, Math.round(start)), stop: Math.max(0, Math.round(stop)) };
  if (seg.n) w.n = seg.n;
  if (seg.startY !== undefined) { w.startY = seg.startY; w.stopY = seg.stopY; }
  return w;
}

/** Does the running layout differ from the boot preset's saved bounds? */
export function layoutDiffersFromPreset(segs, preset) {
  const want = ((preset && preset.seg) || []).filter(s => (Number(s.stop) || 0) > 0)
    .map(s => `${s.id}:${s.start}-${s.stop}`).sort().join("|");
  const have = (segs || []).filter(s => segLen(s) > 0).map(s => `${s.id}:${s.start}-${s.stop}`).sort().join("|");
  return want !== have;
}

// ── Colours ──────────────────────────────────────────────────────────────────
export function colToHex(c) {
  if (typeof c === "string") return "#" + c.slice(-6).padStart(6, "0");
  if (!Array.isArray(c)) return "#000000";
  return "#" + c.slice(0, 3).map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
}
export function hexToCol(hex, white) {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return white === undefined ? rgb : [...rgb, white];
}

// ── Errors and info ──────────────────────────────────────────────────────────
const ERRORS = {
  1: "Denied — the settings PIN is needed", 3: "The device was busy", 4: "Not implemented on this build",
  7: "Out of memory", 8: "Out of memory", 9: "The request wasn't valid JSON",
  90: "Rebooted after an error", 91: "Rebooted after a brownout — check the power supply",
  100: "A reboot is needed for a change to take effect", 101: "Power off and on for a change to take effect",
};
export function describeError(code) {
  code = Number(code);
  if (!code) return null;
  if (code >= 10 && code <= 19) return "A file-system error on the device";
  if (code >= 33 && code <= 37) return "The device is low on memory";
  return ERRORS[code] || `Device error ${code}`;
}

export function fmtUptime(s) {
  s = Math.max(0, Number(s) || 0);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/** WLED sync groups are an 8-bit mask; people think in group numbers. */
export const groupsOf = (mask) => [1, 2, 3, 4, 5, 6, 7, 8].filter(g => (Number(mask) || 0) & (1 << (g - 1)));
export const maskOf = (groups) => (groups || []).reduce((m, g) => m | (1 << (g - 1)), 0);
