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
// MoonModules WLED-MM shares version numbers with stock but not these
// features (review 2026-09-23): its m12 table differs (4 = jMap), and rSeg,
// segment blend, blend styles and psave's bootps are stock-only.
const STOCK_ONLY = new Set(["blendStyle", "segBlend", "resetSegs", "bootPreset", "pinwheel", "pins", "segCaps"]);
export function isMoonModules(info) {
  const txt = [info && info.repo, info && info.brand, info && info.product, info && info.cn, info && info.ver].join(" ");
  return /moon/i.test(txt);
}
export const has = (info, feature) => {
  if (isMoonModules(info) && STOCK_ONLY.has(feature)) return false;
  return wledGen(info) >= (FEATURES[feature] || 99);
};
/** 1D-on-2D expansion options, per firmware family. */
export function m12Options(info) {
  if (isMoonModules(info)) {
    return [[0, "Pixels"], [1, "Bar"], [2, "Arc"], [3, "Corner"], [4, "jMap"], [5, "Circle"], [6, "Block"], [7, "Pinwheel"]];
  }
  const o = [[0, "Pixels"], [1, "Bar"], [2, "Arc"], [3, "Corner"]];
  if (wledGen(info) >= 15) o.push([4, "Pinwheel"]);
  return o;
}
/** WLED's own names for sound simulation (FX.h): there is no "off". */
export const SOUND_SIM = [[0, "BeatSin"], [1, "WeWillRockYou"], [2, "10/13"], [3, "14/3"]];

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

// Mirrors WLED 16's index.js setEffectParameters rule for rule (review
// 2026-09-23): with metadata, a MISSING colour or palette section means
// hidden, and a numeric palette section means hidden; with none, fx < 128
// shows 2 sliders and fx >= 128 all 5, plus 3 colours and the palette.
export function parseFxData(str, fxId = 0) {
  const out = { sliders: [], toggles: [], colors: [], palette: false, paletteLabel: null,
    flags: { single: false, d1: true, d2: false, volume: false, frequency: false }, defaults: {} };
  if (str === undefined || str === null || str === "") {
    const n = fxId < 128 ? 2 : 5;
    out.sliders = SLIDER_KEYS.slice(0, n).map(k => ({ key: k, label: SLIDER_DEFAULT[k], max: k === "c3" ? 31 : 255 }));
    out.colors = COLOR_DEFAULT.map((label, i) => ({ slot: i, label: String(i + 1) }));
    out.palette = true;
    return out;
  }
  const parts = String(str).split(";");
  const sl = (parts[0] || "").split(",");
  SLIDER_KEYS.slice(0, 5).forEach((k, i) => {
    const raw = sl[i];
    if (raw === undefined || raw === "") return;
    out.sliders.push({ key: k, label: raw === "!" ? SLIDER_DEFAULT[k] : raw, max: k === "c3" ? 31 : 255 });
  });
  if (sl.length > 5) {
    SLIDER_KEYS.slice(5).forEach((k, i) => {
      const raw = sl[5 + i];
      if (raw === undefined || raw === "") return;
      out.toggles.push({ key: k, label: raw === "!" ? SLIDER_DEFAULT[k] : raw });
    });
  }
  const cols = parts.length > 1 && parts[1] !== "" ? parts[1].split(",") : [];
  cols.forEach((c, i) => { if (c !== "" && i < 3) out.colors.push({ slot: i, label: c === "!" ? COLOR_DEFAULT[i] : c }); });
  const pal = parts.length > 2 ? String(parts[2] || "").split(",")[0] : "";
  out.palette = pal !== "" && isNaN(Number(pal.split("=")[0]));
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

/** Problems with a layout, in words a person can act on. A matrix is
 * checked as rectangles (x and y); a strip as ranges. */
export function layoutWarnings(segs, ledCount, maxSeg, matrix) {
  if (matrix) return matrixWarnings(segs, matrix, maxSeg);
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

function matrixWarnings(segs, matrix, maxSeg) {
  const w = Number(matrix.w) || 0, hgt = Number(matrix.h) || 0;
  const live = (segs || []).filter(s => segLen(s) > 0);
  const rect = (s) => [s.start, s.stop, s.startY || 0, s.stopY || 1];
  const out = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const [ax0, ax1, ay0, ay1] = rect(live[i]), [bx0, bx1, by0, by1] = rect(live[j]);
    if (ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1 && !(live[i].bm || live[j].bm)) {
      out.push({ kind: "overlap", ids: [live[i].id, live[j].id], text: `Segments ${live[i].id} and ${live[j].id} overlap` });
    }
  }
  let area = 0;
  for (const s of live) {
    const [x0, x1, y0, y1] = rect(s);
    if (x1 > w || y1 > hgt) out.push({ kind: "beyond", ids: [s.id], text: `Segment ${s.id} reaches past the ${w}×${hgt} matrix` });
    area += Math.max(0, Math.min(x1, w) - x0) * Math.max(0, Math.min(y1, hgt) - y0);
  }
  if (!out.some(o => o.kind === "overlap") && area < w * hgt) {
    out.push({ kind: "gap", text: `${w * hgt - area} of the matrix's ${w * hgt} LEDs aren't in any segment` });
  }
  if (maxSeg && (segs || []).length > maxSeg) out.push({ kind: "count", text: `${(segs || []).length} segments — this device allows ${maxSeg}` });
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

/** Split a segment in two along its longer axis (a matrix keeps the other
 * axis's bounds). Returns [first-half write, new segment], or null. */
export function splitWrites(seg, newId, matrix) {
  if (matrix) {
    const w = seg.stop - seg.start, hgt = (seg.stopY || 1) - (seg.startY || 0);
    if (w < 2 && hgt < 2) return null;
    const name = (seg.n || `Segment ${seg.id}`) + " (2)";
    if (w >= hgt) {
      const mid = seg.start + Math.floor(w / 2);
      return [segBoundsWrite(seg, seg.start, mid), { id: newId, start: mid, stop: seg.stop, startY: seg.startY || 0, stopY: seg.stopY || 1, n: name }];
    }
    const midY = (seg.startY || 0) + Math.floor(hgt / 2);
    return [{ ...segBoundsWrite(seg, seg.start, seg.stop), startY: seg.startY || 0, stopY: midY },
      { id: newId, start: seg.start, stop: seg.stop, startY: midY, stopY: seg.stopY || 1, n: name }];
  }
  if (segLen(seg) < 2) return null;
  const mid = seg.start + Math.floor(segLen(seg) / 2);
  return [segBoundsWrite(seg, seg.start, mid), { id: newId, start: mid, stop: seg.stop, n: `${seg.n || "Segment " + seg.id} (2)` }];
}

/** Room for one more segment? WLED silently ignores one past maxseg. */
export const canAddSegment = (segs, maxSeg) => !maxSeg || nextSegId(segs) < maxSeg;

/** A bounds edit that WLED would read as a delete (start >= stop) is refused. */
export const boundsValid = (start, stop, startY, stopY) =>
  Number.isFinite(start) && Number.isFinite(stop) && stop > start
  && (startY === undefined || stopY === undefined || stopY > startY);

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
  46: "PWM 6-channel",
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
  if (t >= 41 && t <= 47) return "pwm";                 // 41-47: 1 to 7 PWM channels
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

/** The firmware's MAX_LEDS for this chip and generation (const.h): an
 * output ending past it is silently never created (round 5). */
export function maxLedsFor(info) {
  const arch = String((info && info.arch) || "").toLowerCase();
  if (arch.includes("8266")) return 1536;
  if (arch.includes("s2")) return 2048;
  return wledGen(info) >= 16 ? 16384 : 8192;
}
export const typeName = (type) => BUS_TYPES[Number(type) & 0x7f] || `Type ${Number(type) & 0x7f}`;

/** What must be fixed before outputs can be saved (a missing pin makes WLED
 * silently skip the output; a bad address sends frames nowhere). */
export function outputBlockers(ins) {
  const out = [];
  (ins || []).forEach((b, i) => {
    const kind = busKind(b.type), n = busPinCount(b.type), pins = (b.pin || []).slice(0, n);
    if (kind === "hub75") return;
    if (kind === "network") {
      const ok = pins.length === 4 && pins.every(o => Number.isInteger(o) && o >= 0 && o <= 255) && pins[0] !== 0 && pins[3] !== 255 && pins[0] < 224;
      if (!ok) out.push(`Output ${i + 1}: give the full address of the device to send to (like 192.168.2.119)`);
      return;
    }
    if (pins.length < n || pins.some(p => !Number.isInteger(p) || p < 0)) out.push(`Output ${i + 1}: choose ${n === 1 ? "its GPIO" : `all ${n} GPIOs`}`);
    if (!(Number(b.len) > 0)) out.push(`Output ${i + 1}: how many LEDs?`);
  });
  return out;
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
    const endAt = (Number(b.start) || 0) + len;
    if (endAt > maxLedsFor(info)) out.push(`An output ends at LED ${endAt} — this firmware on this chip stops at ${maxLedsFor(info)}, so WLED won't create it`);
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


/**
 * Every palette the segment can use, [id, name]. /json/pal lists built-ins
 * only (review 2026-09-23); custom palettes count down from 255 (0.14/0.15)
 * or from 200 (16), usermod palettes from 255 (16, umpalnames).
 */
export function paletteList(info, builtIns) {
  const out = (builtIns || []).map((n, i) => [i, n]);
  const cp = Number(info && info.cpalcount) || 0;
  const gen = wledGen(info);
  const top = gen >= 16 ? 200 : 255;
  for (let i = 0; i < cp; i++) out.push([top - i, `~ Custom ${i} ~`]);
  if (gen >= 16) {
    const names = (info && info.umpalnames) || [];
    const n = Number(info && info.umpalcount) || names.length;
    for (let i = 0; i < n; i++) out.push([255 - i, names[i] || `Usermod ${i}`]);
  }
  return out;
}

/** WLED's own effect defaults (FX.h DEFAULT_*), overlaid with the effect's. */
export function effectDefaults(meta) {
  const d = { sx: 128, ix: 128, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false, ...(meta ? meta.defaults : {}) };
  // WLED reads options as booleans — a number is ignored (round 5).
  for (const k of ["o1", "o2", "o3"]) d[k] = !!Number(d[k]);
  return d;
}

/**
 * The LED order across one 2D panel, as [[x, y], ...] in panel cells — for
 * the wiring preview. b/r: the first LED is at the bottom/right; v: rows run
 * vertically; s: serpentine (every other row runs back).
 */
export function panelPath(p) {
  const w = Math.max(1, Number(p.w) || 1), hgt = Math.max(1, Number(p.h) || 1);
  const major = p.v ? w : hgt, minor = p.v ? hgt : w;
  const out = [];
  for (let m = 0; m < major; m++) {
    for (let n = 0; n < minor; n++) {
      const nn = p.s && (m % 2) ? minor - 1 - n : n;
      let x = p.v ? m : nn, y = p.v ? nn : m;
      if (p.r) x = w - 1 - x;
      if (p.b) y = hgt - 1 - y;
      out.push([x, y]);
    }
  }
  return out;
}
