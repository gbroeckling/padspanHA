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

// ── LED outputs (cfg hw.led.ins) ─────────────────────────────────────────────
// Type ids from WLED's const.h / bus_manager (16.0.1).
export const BUS_TYPES = {
  22: "WS281x", 24: "WS281x 400 kHz", 25: "TM1829", 26: "UCS8903", 27: "APA106", 33: "TM1914",
  30: "SK6812/WS2814 RGBW", 29: "UCS8904 RGBW", 31: "TM1814 RGBW", 28: "FW1906 RGB+CCT", 32: "WS2805 RGB+CCT",
  34: "SM16825 RGB+CCT", 19: "WS2811 white", 21: "WWA",
  50: "WS2801", 51: "APA102", 52: "LPD8806", 53: "P9813", 54: "LPD6803",
  40: "On/off relay", 41: "PWM white", 42: "PWM CCT", 43: "PWM RGB", 44: "PWM RGBW", 45: "PWM RGB+CCT",
  80: "DDP RGB (network)", 88: "DDP RGBW (network)", 82: "Art-Net RGB (network)", 89: "Art-Net RGBW (network)",
  65: "HUB75 half-scan", 66: "HUB75 quarter-scan",
};
export function busKind(type) {
  const t = Number(type) & 0x7f;                 // bit 7 is "refresh when off"
  if (t >= 80 && t <= 95) return "network";
  if (t >= 65 && t <= 66) return "hub75";
  if (t >= 50 && t <= 54) return "2pin";
  if (t === 40) return "onoff";
  if (t >= 41 && t <= 45) return "pwm";
  return "digital";
}
/** How many pin[] entries the type uses (network: the 4 IP octets). */
export function busPinCount(type) {
  const k = busKind(type);
  if (k === "network") return 4;
  if (k === "2pin") return 2;
  if (k === "pwm") return (Number(type) & 0x7f) - 40;
  if (k === "hub75") return 0;
  return 1;
}
export const ORDERS = ["GRB", "RGB", "BRG", "RBG", "BGR", "GBR"];
export const W_SWAPS = ["none", "W ↔ B", "W ↔ G", "W ↔ R"];
export const orderName = (order) => ORDERS[(Number(order) || 0) & 0x0f] || "GRB";
export const wSwapOf = (order) => ((Number(order) || 0) >> 4) & 0x0f;
export const orderCode = (name, wSwap = 0) => ((Math.max(0, ORDERS.indexOf(name)) & 0x0f) | ((wSwap & 0x0f) << 4));

/**
 * The colour-order wizard's answer. The device sent pure red, green, blue
 * under its current order; `seen` is what the person saw for each
 * ({R:"G", G:"R", B:"B"}). The strip's true byte order is the current order
 * with each channel replaced by what it showed — and that true order is the
 * setting that makes the strip right.
 */
export function orderFromObservation(currentOrder, seen) {
  const cur = orderName(currentOrder);
  const t = cur.split("").map(ch => seen[ch]).join("");
  return ORDERS.includes(t) ? t : null;          // not a permutation: a mis-tap
}

export function maxLedsFor(info) {
  const arch = String((info && info.arch) || "").toLowerCase();
  if (arch.includes("8266")) return 1536;
  if (arch.includes("s2")) return 2048;
  return 16384;
}
export const MAX_LEDS_PER_BUS = 2048;

/** Problems with a set of LED outputs, before they're saved. */
export function outputWarnings(ins, info, pins) {
  const out = [];
  const used = new Map();
  let total = 0;
  const sorted = [...(ins || [])].map((b, i) => ({ ...b, _i: i })).sort((a, b) => (a.start || 0) - (b.start || 0));
  for (const b of ins || []) {
    const kind = busKind(b.type);
    const len = Number(b.len) || 0;
    total += kind === "network" ? 0 : len;
    if (len > MAX_LEDS_PER_BUS && kind !== "network") out.push(`An output has ${len} LEDs — WLED allows ${MAX_LEDS_PER_BUS} per output`);
    if (kind === "network" || kind === "hub75") continue;
    for (const p of (b.pin || []).slice(0, busPinCount(b.type))) {
      if (p === undefined || p === null || p < 0) continue;
      if (used.has(p)) out.push(`GPIO ${p} is used by two outputs`);
      used.set(p, true);
      const pi = (pins || []).find(x => x.p === p);
      if (pi && (pi.c & 0x20)) out.push(`GPIO ${p} is input-only — it can't drive LEDs`);
      // Pins the LED outputs already hold report as a Bus…/LED owner — fine.
      if (pi && pi.a && pi.o !== undefined && !/led|bus/i.test(String(pi.n || ""))) out.push(`GPIO ${p} is already used by ${pi.n || "something else"}`);
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const aEnd = (a.start || 0) + (Number(a.len) || 0);
    if ((b.start || 0) < aEnd) out.push(`Outputs ${a._i + 1} and ${b._i + 1} overlap (LED ${b.start})`);
    else if ((b.start || 0) > aEnd) out.push(`LEDs ${aEnd}–${b.start - 1} belong to no output`);
  }
  const max = maxLedsFor(info);
  if (total > max) out.push(`${total} LEDs in all — this chip handles ${max}`);
  return out;
}
