// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Share a replay (the owner, 2026-11-23; free on every tier): Traceback's
// chosen stretch as a 10 to 30 second clip of people moving through the
// house, ready to post. Privacy is the whole feature:
//  - names become "Person 1" or initials; device names, addresses, kinds and
//    signal readings are never drawn;
//  - room names are kept or replaced by generic ones ("Bedroom", "Room 3");
//  - floors are numbered, never named; the date is left out (time of day only);
//  - the clip is drawn from room outlines: no plan image, no address, no
//    coordinates;
//  - the dialog shows the clip and what is hidden before anything is saved,
//    and the file is made in this browser and downloaded. Nothing is
//    uploaded: there is no network call here at all, only the opt-in usage
//    report's counts (share_replay:<word>, telemetry.SHARE_REPLAY_EVENTS).
// The clip leads with people moving: no title card, the stretch is trimmed to
// where the first person changes room, and still stretches play fast.
// Recording: canvas.captureStream + MediaRecorder (MP4 where the browser's
// recorder makes it, made a plain MP4 by mp4_remux.js; else WebM), or GIF
// with gif_encoder.js.
// First version: the flat floor stack Traceback plays on (traceback.js
// _shareScene). The 3D house is a second step.

const Q = new URL(import.meta.url).search;
const { t, tn } = await import(`./i18n.js${Q}`);

export const CLIP = Object.freeze({
  minS: 10, maxS: 30, fps: 30, gifFps: 12,
  sizes: { wide: [1280, 720], vertical: [720, 1280] },
  gifSizes: { wide: [854, 480], vertical: [480, 854] },
});
export const DEFAULTS = Object.freeze({ names: "person", rooms: "generic", aspect: "wide", format: "mp4", seconds: 20, mark: true });
const ENUMS = { names: ["person", "initials"], rooms: ["generic", "keep"], aspect: ["wide", "vertical"], format: ["mp4", "webm", "gif"] };
const COLORS = ["#fbbf24", "#60a5fa", "#f87171", "#34d399", "#c4b5fd", "#fb923c", "#5eead4", "#f472b6", "#a3e635", "#818cf8"];
const IDLE = 0.12;      // a still step plays at an eighth of the pace of one where someone moves
const MOVE_PX = 30;     // or moves this far (iso units) without changing room

/** The clip's options, every one valid: unknown words fall back to the defaults, the length to 10-30 s. */
export function normaliseOptions(o = {}) {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(ENUMS)) if (ENUMS[k].includes(o[k])) out[k] = o[k];
  const s = Math.round(Number(o.seconds));
  out.seconds = Number.isFinite(s) ? Math.max(CLIP.minS, Math.min(CLIP.maxS, s)) : DEFAULTS.seconds;
  out.mark = o.mark === undefined ? DEFAULTS.mark : !!o.mark;
  return out;
}

/** Width, height and frames a second of a clip with these options. */
export function clipSize(opts) {
  const o = normaliseOptions(opts);
  const [w, h] = (o.format === "gif" ? CLIP.gifSizes : CLIP.sizes)[o.aspect];
  return { w, h, fps: o.format === "gif" ? CLIP.gifFps : CLIP.fps };
}

const MIMES = {
  mp4: ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.4d401f", "video/mp4;codecs=avc1.42e01e", "video/mp4;codecs=avc1", "video/mp4"],
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
};

/** The recorder type for a format, the first this browser makes, or null. GIF needs no recorder. */
export function pickMime(format, isTypeSupported) {
  if (format === "gif") return "image/gif";
  for (const m of MIMES[format] || []) {
    try { if (isTypeSupported(m)) return m; } catch (_) { /* not this one */ }
  }
  return null;
}

/** Which formats this browser can save: {mp4, webm, gif} as recorder types or null. */
export function availableFormats(env = globalThis) {
  const MR = env.MediaRecorder;
  const canvasOk = !!(env.HTMLCanvasElement && env.HTMLCanvasElement.prototype && env.HTMLCanvasElement.prototype.captureStream);
  const ok = MR && typeof MR.isTypeSupported === "function" && canvasOk ? (m) => MR.isTypeSupported(m) : () => false;
  return { mp4: pickMime("mp4", ok), webm: pickMime("webm", ok), gif: "image/gif" };
}

// ── who is in the clip, and what they are called ─────────────────────────

// Words that name a device, not a person: dropped before initials are taken.
const DEVICE_WORDS = new Set(("iphone ipad ipod phone smartphone handy mobile cell watch applewatch galaxy pixel oneplus xiaomi "
  + "huawei samsung apple google android ios tag airtag tile keys key keyring band fitbit garmin tracker beacon ibeacon ble "
  + "sensor device laptop macbook tablet airpods earbuds buds pro max mini plus ultra se lite fe von de du of the s my mein meine "
  + "sein seine ihr ihre collar halsband wallet bag car auto").split(" "));

/** A name's initials ("Alex's iPhone" → "A", "Sam Jordan Watch" → "SJ"), or
 *  null when nothing in it is a person's name (an address, a model). */
export function initialsOf(name) {
  const s = String(name || "").replace(/^(entity|ble):/i, "").replace(/^(sensor|device_tracker)\./i, "");
  if (/^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(s.trim())) return null;
  const words = s.split(/[\s_\-.,/()]+/).map(w => w.replace(/['’]s$/i, "").replace(/['’]$/, "")).filter(Boolean);
  const kept = words.filter(w => /^\p{L}/u.test(w) && !DEVICE_WORDS.has(w.toLowerCase()) && !/\d/.test(w));
  if (!kept.length) return null;
  return kept.slice(0, 2).map(w => w[0].toLocaleUpperCase()).join("");
}

/** The things the clip follows, in the order they first appear: everything
 *  recorded but receivers, and of those only what changes room when anything
 *  does (a tag that sat in its room all along is not a person moving). */
export function peopleIn(frames, scanners = new Set()) {
  const seen = new Map();
  for (const f of frames || []) {
    for (const o of (f && f.o) || []) {
      if (!o || !o.k || scanners.has(String(o.k).toUpperCase())) continue;
      let p = seen.get(o.k);
      if (!p) { p = { key: o.k, name: o.n || "", rooms: new Set() }; seen.set(o.k, p); }
      if (o.r) p.rooms.add(o.r);
      if (!p.name && o.n) p.name = o.n;
    }
  }
  const all = [...seen.values()];
  const moving = all.filter(p => p.rooms.size > 1);
  return (moving.length ? moving : all).map(p => ({ key: p.key, name: p.name }));
}

/** key → what the clip calls it: "Person 1", "Person 2"… or initials (a
 *  second "A" is "A2"; no initials to take, "Person N"). Never the device's name. */
export function personLabels(people, mode) {
  const out = new Map(), used = new Map();
  people.forEach((p, i) => {
    let label = mode === "initials" ? initialsOf(p.name) : null;
    if (label) {
      const n = (used.get(label) || 0) + 1;
      used.set(label, n);
      if (n > 1) label = label + n;
    } else {
      label = t("Person {n}", { n: i + 1 });
    }
    out.set(p.key, label);
  });
  return out;
}

// Generic room names, first match wins (a "Master bath" is a bathroom). The
// words are English and German: houses name their rooms in their language.
const ROOM_KINDS = [
  [/(^|[^\p{L}])(bath|en-?suite|wc|toilet|powder|shower|washroom|restroom|lavatory|bad|toilette|dusche)/u, () => t("Bathroom")],
  [/entry|entrance|foyer|mud ?room|vestibule|eingang|windfang|diele/u, () => t("Entrance")],
  [/stair|treppe/u, () => t("Stairs")],
  [/laundry|utility|wasch|hauswirtschaft/u, () => t("Laundry")],
  [/garage|carport/u, () => t("Garage")],
  [/kitchen|k(ü|ue)che|pantry/u, () => t("Kitchen")],
  [/dining|esszimmer|essbereich|(^|[^\p{L}])essen/u, () => t("Dining room")],
  [/living|lounge|family|great ?room|sitting|wohnzimmer|wohnbereich|stube|(^|[^\p{L}])(den|tv|media)([^\p{L}]|$)/u, () => t("Living room")],
  [/bed|schlaf|nursery|kinder|guest|g(ä|ae)ste|(^|[^\p{L}])kids?([^\p{L}]|$)/u, () => t("Bedroom")],
  [/office|study|b(ü|ue)ro|arbeitszimmer/u, () => t("Office")],
  [/hall|corridor|landing|flur/u, () => t("Hallway")],
  [/basement|cellar|keller/u, () => t("Basement")],
  [/garden|yard|patio|deck|terrace|terrasse|balcony|balkon|garten|outside|outdoor|porch|pool/u, () => t("Outside")],
  [/gym|fitness|workout/u, () => t("Gym")],
  [/closet|storage|abstell|attic|dachboden|speicher/u, () => t("Storage")],
];

/** A room name's generic kind, translated ("Alex's bedroom" → "Bedroom"), or null. */
export function genericRoomName(name) {
  const s = String(name || "").toLocaleLowerCase();
  for (const [re, label] of ROOM_KINDS) if (re.test(s)) return label();
  return null;
}

/** room → what the clip calls it. keep: as it is. generic: its kind, a
 *  second of a kind numbered ("Bedroom 2"), a room of no known kind "Room N". */
export function roomLabels(rooms, mode) {
  const out = new Map(), kinds = new Map();
  let other = 0;
  for (const r of rooms) {
    if (out.has(r)) continue;
    if (mode === "keep") { out.set(r, r); continue; }
    const kind = genericRoomName(r);
    if (!kind) { out.set(r, t("Room {n}", { n: ++other })); continue; }
    const n = (kinds.get(kind) || 0) + 1;
    kinds.set(kind, n);
    out.set(r, n > 1 ? `${kind} ${n}` : kind);
  }
  return out;
}

/** Every room the clip can show: the plan's, then any only the frames name. */
export function roomsOf(scene, frames) {
  const out = [];
  for (const fl of (scene && scene.floors) || []) for (const r of fl.rooms || []) if (!out.includes(r.room)) out.push(r.room);
  for (const f of frames || []) for (const o of (f && f.o) || []) if (o && o.r && !out.includes(o.r)) out.push(o.r);
  return out;
}

/** What the clip hides, as lines for the dialog: [{id, text}]. */
export function hiddenList(people, rooms, roomMap, opts) {
  const o = normaliseOptions(opts);
  const n = people.length;
  const changed = rooms.filter(r => roomMap.get(r) !== r).length;
  return [
    { id: "names", text: o.names === "initials"
      ? tn(n, "1 name shown as initials (Person 1 where there are none)", "{n} names shown as initials (Person N where there are none)")
      : tn(n, "1 name shown as Person 1", "{n} names shown as Person 1 to Person {n}") },
    { id: "devices", text: t("Device names, addresses, kinds and signal readings: left out") },
    { id: "rooms", text: o.rooms === "keep" ? t("Room names: kept as they are")
      : tn(changed, "1 room name replaced by a generic one", "{n} room names replaced by generic ones") },
    { id: "floors", text: t("Floor names: left out (floors are numbered)") },
    { id: "date", text: t("The date: left out (only the time of day is shown)") },
    { id: "plan", text: t("Plan images, the address and coordinates: never in the clip, which is drawn from room outlines only") },
    { id: "mark", text: o.mark ? t("The \"made with PadSpan\" mark: in the bottom corner") : t("The \"made with PadSpan\" mark: off") },
  ];
}

// ── the clip's timeline ──────────────────────────────────────────────────

const ease = (f) => f * f * (3 - 2 * f);

/** The clip, ready to draw: who is in it (key, label, colour), each one's
 *  place at every kept recorded frame, and how the clip's time runs over
 *  them. Trimmed to lead with movement: it starts a step before the first
 *  room change and ends a little after the last; steps where nobody moves
 *  play fast (IDLE). */
export function buildClip(frames, scene, opts, labels) {
  const o = normaliseOptions(opts);
  const scanners = (scene && scene.scanners) || new Set();
  const people = peopleIn(frames, scanners);
  const keys = people.map(p => p.key);
  const keySet = new Set(keys);
  const { w, h, fps } = clipSize(o);
  const fit = fitOf(sceneBounds(scene), w, h);
  const spread = 32 * fit.unit / fit.s;      // two in one spot stand this far apart on screen
  const list = (frames || []).filter(f => f && Number.isFinite(Number(f.ts)));
  // Each kept frame: every person's iso place (null when not recorded then) and room.
  const pos = list.map(f => {
    const at = {}, room = {}, groups = {};
    for (const ob of f.o || []) {
      if (!keySet.has(ob.k)) continue;
      const p = scene.posOf(ob);
      if (!p) continue;
      // Two in one spot (a room's centre) stand side by side, by their order in the clip.
      const g = `${Math.round(p[0] / 8)}|${Math.round(p[1] / 8)}`;
      const i = groups[g] = (groups[g] || 0) + 1;
      const ang = (i - 1) * 2.0, rad = i > 1 ? spread * (1 + (i - 2) * 0.3) : 0;
      at[ob.k] = [p[0] + Math.cos(ang) * rad, p[1] + Math.sin(ang) * rad * 0.7];
      room[ob.k] = ob.r;
    }
    return { ts: Number(f.ts), at, room };
  });
  // A step is active when someone changes room or moves far.
  const active = [];
  for (let j = 0; j + 1 < pos.length; j++) {
    const a = pos[j], b = pos[j + 1];
    active.push(keys.some(k => a.at[k] && b.at[k] && (a.room[k] !== b.room[k]
      || Math.hypot(a.at[k][0] - b.at[k][0], a.at[k][1] - b.at[k][1]) > MOVE_PX)));
  }
  let first = active.indexOf(true), last = active.lastIndexOf(true);
  if (first < 0) { first = 0; last = active.length - 1; }
  const j0 = Math.max(0, first - 1), j1 = Math.min(pos.length - 1, last + 3);
  const steps = pos.slice(j0, j1 + 1);
  const weights = active.slice(j0, j1).map(a => (a ? 1 : IDLE));
  const cum = [0];
  for (const w of weights) cum.push(cum[cum.length - 1] + w);
  return {
    opts: o, w, h, fps, frameCount: Math.max(1, Math.round(o.seconds * fps)),
    people: people.map((p, i) => ({ key: p.key, label: labels.get(p.key) || t("Person {n}", { n: i + 1 }), color: COLORS[i % COLORS.length] })),
    steps, cum, total: cum[cum.length - 1] || 0, fit,
  };
}

// Scene units to the w × h frame: the house fills it under the clock's band.
function fitOf(b, w, h) {
  const unit = Math.min(w, h) / 720;
  const top = h * 0.12, bottom = h * 0.06, side = w * 0.04;
  const s = Math.min((w - 2 * side) / Math.max(1, b.x1 - b.x0), (h - top - bottom) / Math.max(1, b.y1 - b.y0));
  return { unit, top, bottom, side, s,
    ox: side + ((w - 2 * side) - (b.x1 - b.x0) * s) / 2 - b.x0 * s,
    oy: top + ((h - top - bottom) - (b.y1 - b.y0) * s) / 2 - b.y0 * s };
}

function sceneBounds(scene) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (p) => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  for (const fl of (scene && scene.floors) || []) {
    (fl.corners || []).forEach(take);
    for (const r of fl.rooms || []) (r.poly || []).forEach(take);
  }
  if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 760, y1: 940 };
  return { x0, y0, x1, y1 };
}

/** Where the clip is at u (0 to 1): its time and each person's place. */
export function clipAt(clip, u) {
  const { steps, cum, total } = clip;
  if (!steps.length) return { ts: null, at: {} };
  if (steps.length === 1 || !total) return { ts: steps[0].ts, at: { ...steps[0].at } };
  const want = Math.max(0, Math.min(1, u)) * total;
  let lo = 0, hi = cum.length - 2;          // the step holding `want`: cum[j] <= want <= cum[j + 1]
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid + 1] < want) lo = mid + 1; else hi = mid; }
  const j = lo;
  const span = cum[j + 1] - cum[j];
  const f = span > 0 ? Math.max(0, Math.min(1, (want - cum[j]) / span)) : 0;
  const a = steps[j], b = steps[j + 1], e = ease(f);
  const at = {};
  for (const p of clip.people) {
    const pa = a.at[p.key], pb = b.at[p.key];
    if (pa && pb) at[p.key] = [pa[0] + (pb[0] - pa[0]) * e, pa[1] + (pb[1] - pa[1]) * e];
    else if (pa || pb) at[p.key] = (f < 0.5 ? pa : pb) || pa || pb;
  }
  return { ts: a.ts + (b.ts - a.ts) * f, at };
}

// ── drawing ──────────────────────────────────────────────────────────────

const timeOfDay = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function alpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return `rgba(82,183,136,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Frame i of the clip on a 2D context (the canvas is clip.w × clip.h).
 *  Draws only: numbered floors, room outlines with roomMap's names, the
 *  people by their labels, the time of day and, when on, the mark. */
export function drawClipFrame(g, clip, scene, roomMap, i, fmtTime = timeOfDay) {
  const { w, h } = clip, u = clip.frameCount > 1 ? i / (clip.frameCount - 1) : 0;
  const { unit, top, bottom, side, s, ox, oy } = clip.fit;
  const X = (p) => ox + p[0] * s, Y = (p) => oy + p[1] * s;
  const poly = (ps) => { g.beginPath(); ps.forEach((p, k) => (k ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p)))); g.closePath(); };

  g.fillStyle = "#071008";
  g.fillRect(0, 0, w, h);
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const fl of scene.floors || []) {
    poly(fl.corners);
    g.fillStyle = alpha(fl.color, 0.05); g.fill();
    g.setLineDash([10 * unit, 5 * unit]); g.lineWidth = 1.2 * unit; g.strokeStyle = alpha(fl.color, 0.4); g.stroke();
    g.setLineDash([]);
    for (const r of fl.rooms || []) {
      poly(r.poly);
      g.fillStyle = alpha(r.color, 0.16); g.fill();
      g.lineWidth = 1.4 * unit; g.strokeStyle = alpha(r.color, 0.75); g.stroke();
    }
    for (const r of fl.rooms || []) {
      g.font = `600 ${Math.round(Math.max(10, 12 * unit))}px system-ui, sans-serif`;
      g.fillStyle = alpha(r.color, 0.8);
      g.fillText(roomMap.get(r.room) || "", X(r.label), Y(r.label));
    }
    const bl = fl.corners[3];
    g.beginPath(); g.arc(X(bl), Y(bl), 13 * unit, 0, Math.PI * 2);
    g.fillStyle = alpha(fl.color, 0.75); g.fill();
    g.font = `700 ${Math.round(13 * unit)}px system-ui, sans-serif`;
    g.fillStyle = "#071008";
    g.fillText(String(fl.n), X(bl), Y(bl) + unit);
  }

  // People: a short trail, a halo, the dot, the label.
  const now = clipAt(clip, u);
  const TRAIL = 10, du = 0.005;
  for (const p of clip.people) {
    const trail = [];
    for (let k = TRAIL; k >= 1; k--) { const q = clipAt(clip, u - k * du).at[p.key]; if (q) trail.push(q); }
    const at = now.at[p.key];
    if (at) trail.push(at);
    if (trail.length > 1) {
      g.beginPath(); trail.forEach((q, k) => (k ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))));
      g.lineWidth = 5 * unit; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = alpha(p.color, 0.35); g.stroke();
    }
  }
  const shown = clip.people.filter(p => now.at[p.key]);
  for (const p of shown) {
    const x = X(now.at[p.key]), y = Y(now.at[p.key]);
    g.beginPath(); g.arc(x, y, 24 * unit, 0, Math.PI * 2); g.fillStyle = alpha(p.color, 0.18); g.fill();
    g.beginPath(); g.arc(x, y, 14 * unit, 0, Math.PI * 2); g.fillStyle = p.color; g.fill();
    g.lineWidth = 2.5 * unit; g.strokeStyle = "#071008"; g.stroke();
  }
  // Labels over the dots, a label that would cover another's lifted above it.
  const placed = [];
  for (const p of shown) {
    const x = X(now.at[p.key]), y = Y(now.at[p.key]);
    g.font = `700 ${Math.round(Math.max(12, 17 * unit))}px system-ui, sans-serif`;
    const tw = (g.measureText(p.label).width || p.label.length * 9 * unit) + 16 * unit;
    let ly = y - 36 * unit;
    for (let k = 0; k < 6 && placed.some(r => Math.abs(r.x - x) < (r.w + tw) / 2 && Math.abs(r.y - ly) < 28 * unit); k++) ly -= 29 * unit;
    placed.push({ x, y: ly, w: tw });
    g.fillStyle = "rgba(7,16,8,0.88)";
    g.fillRect(x - tw / 2, ly - 13 * unit, tw, 26 * unit);
    g.lineWidth = 1.5 * unit; g.strokeStyle = p.color; g.strokeRect(x - tw / 2, ly - 13 * unit, tw, 26 * unit);
    g.fillStyle = p.color;
    g.fillText(p.label, x, ly + unit);
  }

  // The time of day, top left; never the date.
  if (now.ts != null) {
    g.textAlign = "left";
    g.font = `700 ${Math.round(40 * unit)}px ui-monospace, monospace`;
    g.fillStyle = "#fbbf24";
    g.fillText(fmtTime(now.ts), side, top * 0.5);
  }
  if (clip.opts.mark) {
    g.textAlign = "right";
    g.font = `600 ${Math.round(15 * unit)}px system-ui, sans-serif`;
    g.fillStyle = "rgba(226,232,240,0.7)";
    g.fillText(t("made with PadSpan"), w - side * 0.6, h - bottom * 0.5);
  }
  g.textAlign = "center";
}

// ── saving ───────────────────────────────────────────────────────────────

const pause = (ms) => new Promise(r => setTimeout(r, ms));

/** The clip as a video: drawn frame by frame onto the canvas in real time
 *  while MediaRecorder records it. Resolves to the Blob. Each drawn frame is
 *  handed over itself (requestFrame): sampled at the frame rate instead, the
 *  stream dropped one draw in ten. */
export async function recordVideo(canvas, clip, draw, mime, { onProgress, cancelled } = {}) {
  let stream = canvas.captureStream(0);
  const track = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  let push = () => track.requestFrame();
  if (!track || typeof track.requestFrame !== "function") {
    for (const tr of stream.getTracks()) tr.stop();
    stream = canvas.captureStream(clip.fps);
    push = () => {};
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = (e) => reject(e.error || e); });
  rec.start(1000);
  draw(0); push();
  const t0 = performance.now(), step = 1000 / clip.fps;
  for (let i = 1; i < clip.frameCount; i++) {
    if (cancelled && cancelled()) break;
    const wait = t0 + i * step - performance.now();
    if (wait > 0) await pause(wait);
    draw(i); push();
    if (onProgress && i % clip.fps === 0) onProgress(i / clip.frameCount);
  }
  await pause(step * 2);            // the last frame is in the recording
  rec.stop();
  for (const tr of stream.getTracks()) tr.stop();
  await stopped;
  if (cancelled && cancelled()) return null;
  const type = mime.split(";")[0];
  const blob = new Blob(chunks, { type });
  if (type !== "video/mp4") return blob;
  // The recorder's MP4 is fragmented, with no duration: made one plain MP4
  // at a steady frame rate (mp4_remux.js). Anything unexpected: as recorded.
  try {
    const { defragment } = await import(`./mp4_remux.js${Q}`);
    return new Blob([defragment(new Uint8Array(await blob.arrayBuffer()), clip.fps)], { type });
  } catch (e) {
    console.warn("Share a replay: the MP4 is saved as recorded:", e);
    return blob;
  }
}

/** The clip as a GIF (gif_encoder.js): the palette from a few frames, then every frame. */
export async function encodeGif(g, clip, draw, { onProgress, cancelled } = {}) {
  const { GifWriter, buildPalette } = await import(`./gif_encoder.js${Q}`);
  const samples = [];
  for (let k = 0; k < 8; k++) {
    draw(Math.round(k * (clip.frameCount - 1) / 7));
    samples.push(g.getImageData(0, 0, clip.w, clip.h).data);
  }
  const gif = new GifWriter(clip.w, clip.h, buildPalette(samples));
  for (let i = 0; i < clip.frameCount; i++) {
    if (cancelled && cancelled()) return null;
    draw(i);
    const delay = Math.round((i + 1) * 100 / clip.fps) - Math.round(i * 100 / clip.fps);
    gif.addFrame(g.getImageData(0, 0, clip.w, clip.h).data, delay);
    if (onProgress) onProgress(i / clip.frameCount);
    if (i % 4 === 3) await pause(0);
  }
  return new Blob([gif.finish()], { type: "image/gif" });
}

/** The file's name: what it is and its shape, nothing about the house. */
export function clipFilename(opts) {
  const o = normaliseOptions(opts);
  return `padspan-replay-${o.aspect}.${o.format}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── the dialog ───────────────────────────────────────────────────────────

/** Share a replay's dialog: the options, the clip playing as it will be
 *  saved, what it hides, and Save. Returns its controller (tests drive it). */
export function openShareReplay(ctx, { frames, scene }) {
  const count = (word) => { try { if (ctx.actions.telemetryEvent) ctx.actions.telemetryEvent("share_replay:" + word); } catch (_) { /* no report */ } };
  const formats = availableFormats();
  const opts = normaliseOptions({ ...DEFAULTS, ...(ctx.state._shareReplayOpts || {}) });
  if (!formats[opts.format]) opts.format = formats.mp4 ? "mp4" : formats.webm ? "webm" : "gif";
  const st = { opts, clip: null, roomMap: null, people: [], rooms: [], busy: false, stop: false, frame: 0, saved: null };

  const body = document.createElement("div");
  body.className = "share-replay";
  body.style.cssText = "display:flex;flex-direction:column;gap:10px;max-width:880px";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:12px;color:#cbd5e1";
  body.appendChild(row);
  const controls = [];
  const field = (label, node) => {
    const wrap = document.createElement("label");
    wrap.style.cssText = "display:flex;align-items:center;gap:6px";
    const span = document.createElement("span");
    span.textContent = label;
    wrap.appendChild(span); wrap.appendChild(node);
    row.appendChild(wrap);
    controls.push(node);
    return node;
  };
  const select = (key, label, choices) => {
    const sel = document.createElement("select");
    sel.dataset.opt = key;
    for (const [value, text, off] of choices) {
      const op = document.createElement("option");
      op.value = value; op.textContent = text;
      if (off) op.disabled = true;
      if (st.opts[key] === value) op.selected = true;
      sel.appendChild(op);
    }
    sel.value = st.opts[key];
    sel.addEventListener("change", () => { set({ [key]: sel.value }); });
    return field(label, sel);
  };
  select("names", t("Names:"), [["person", t("Person 1, Person 2…")], ["initials", t("Initials")]]);
  select("rooms", t("Room names:"), [["generic", t("Generic (Bedroom, Kitchen…)")], ["keep", t("Keep as they are")]]);
  select("aspect", t("Shape:"), [["wide", t("Wide (16:9)")], ["vertical", t("Vertical (9:16)")]]);
  const notHere = t("not in this browser");
  select("format", t("File:"), [
    ["mp4", formats.mp4 ? t("MP4 (best for Reddit and X)") : `MP4 (${notHere})`, !formats.mp4],
    ["webm", formats.webm ? "WebM" : `WebM (${notHere})`, !formats.webm],
    ["gif", "GIF"],
  ]);
  const len = document.createElement("input");
  len.type = "range"; len.min = String(CLIP.minS); len.max = String(CLIP.maxS); len.step = "1";
  len.value = String(st.opts.seconds);
  len.dataset.opt = "seconds";
  const lenVal = document.createElement("span");
  lenVal.textContent = t("{n} s", { n: st.opts.seconds });
  len.addEventListener("input", () => { lenVal.textContent = t("{n} s", { n: len.value }); });
  len.addEventListener("change", () => set({ seconds: Number(len.value) }));
  field(t("Length:"), len).parentNode.appendChild(lenVal);
  const mark = document.createElement("input");
  mark.type = "checkbox";
  mark.checked = st.opts.mark;
  mark.dataset.opt = "mark";
  mark.addEventListener("change", () => set({ mark: !!mark.checked }));
  field(t("\"made with PadSpan\" mark"), mark);

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;max-width:100%;max-height:52vh;margin:0 auto;border-radius:8px;background:#071008;aspect-ratio:auto";
  body.appendChild(canvas);
  const g = canvas.getContext("2d");

  const hiddenBox = document.createElement("div");
  hiddenBox.className = "share-hidden";
  hiddenBox.style.cssText = "font-size:12px;color:#cbd5e1;line-height:1.5";
  body.appendChild(hiddenBox);

  const foot = document.createElement("div");
  foot.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
  const save = document.createElement("button");
  save.className = "btn";
  save.dataset.shareSave = "1";
  save.textContent = t("Save clip");
  const cancel = document.createElement("button");
  cancel.className = "btn inline";
  cancel.textContent = t("Stop");
  cancel.style.display = "none";
  const status = document.createElement("span");
  status.className = "share-status";
  status.style.cssText = "font-size:12px;color:#94a3b8";
  status.textContent = t("Nothing is uploaded: the clip is made in this browser and saved to your computer.");
  foot.appendChild(save); foot.appendChild(cancel); foot.appendChild(status);
  body.appendChild(foot);

  function rebuild() {
    st.people = peopleIn(frames, scene.scanners);
    st.rooms = roomsOf(scene, frames);
    st.roomMap = roomLabels(st.rooms, st.opts.rooms);
    const labels = personLabels(st.people, st.opts.names);
    st.clip = buildClip(frames, scene, st.opts, labels);
    canvas.width = st.clip.w; canvas.height = st.clip.h;
    st.frame = 0;
    // What is hidden, then each name and room as the clip shows it (this
    // list stays on this screen; it is not in the clip).
    hiddenBox.innerHTML = "";
    const head = document.createElement("div");
    head.style.cssText = "font-weight:700;color:#fbbf24;margin-bottom:2px";
    head.textContent = t("What the clip hides");
    hiddenBox.appendChild(head);
    const ul = document.createElement("ul");
    ul.style.cssText = "margin:0;padding-left:18px";
    for (const line of hiddenList(st.people, st.rooms, st.roomMap, st.opts)) {
      const li = document.createElement("li");
      li.dataset.hidden = line.id;
      li.textContent = line.text;
      ul.appendChild(li);
    }
    hiddenBox.appendChild(ul);
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = t("Show each name and room as the clip shows it");
    det.appendChild(sum);
    const tbl = document.createElement("div");
    tbl.className = "share-map";
    tbl.style.cssText = "display:grid;grid-template-columns:auto auto;gap:2px 14px;padding:4px 0 0 18px";
    const pair = (a, b) => { for (const v of [a, b]) { const d = document.createElement("div"); d.textContent = v; tbl.appendChild(d); } };
    for (const p of st.people) pair(p.name || t("unnamed device"), labels.get(p.key));
    for (const r of st.rooms) pair(r, st.roomMap.get(r));
    det.appendChild(tbl);
    hiddenBox.appendChild(det);
    save.disabled = !st.people.length;
    if (!st.people.length) status.textContent = t("Nobody moved in this stretch. Pick a longer one in Traceback.");
  }

  function set(change) {
    if (st.busy) return;
    Object.assign(st.opts, change);
    st.opts = normaliseOptions(st.opts);
    ctx.state._shareReplayOpts = { ...st.opts };
    rebuild();
    drawNow();
  }

  const drawAt = (i) => drawClipFrame(g, st.clip, scene, st.roomMap, i);
  function drawNow() { try { drawAt(st.frame); } catch (e) { console.error("Share a replay:", e); } }

  // The preview plays the clip as it will be saved, in a loop, until the dialog closes.
  let last = 0;
  const closed = () => st.stop || (st._mounted && !body.isConnected);
  function tick(now) {
    if (closed()) return;
    if (body.isConnected) st._mounted = true;
    if (!st.busy && now - last >= 1000 / st.clip.fps) {
      last = now;
      st.frame = (st.frame + 1) % st.clip.frameCount;
      drawNow();
    }
    requestAnimationFrame(tick);
  }

  async function doSave() {
    if (st.busy || !st.people.length) return;
    const o = st.opts, mime = formats[o.format];
    if (!mime) return;
    st.busy = true; st.cancel = false;
    for (const c of controls) c.disabled = true;
    save.disabled = true; cancel.style.display = "";
    const progress = (f) => { status.textContent = t("Making the clip… {pct}%", { pct: Math.round(f * 100) }); };
    status.textContent = o.format === "gif" ? t("Making the GIF…")
      : t("Recording: it takes as long as the clip. Keep this tab in front.");
    let blob = null;
    try {
      blob = o.format === "gif"
        ? await encodeGif(g, st.clip, drawAt, { onProgress: progress, cancelled: () => st.cancel || closed() })
        : await recordVideo(canvas, st.clip, drawAt, mime, { onProgress: progress, cancelled: () => st.cancel || closed() });
    } catch (e) {
      console.error("Share a replay:", e);
      count("failed");
      status.textContent = t("The clip could not be made in this browser: {why}", { why: String((e && e.message) || e).slice(0, 120) });
    }
    st.busy = false;
    for (const c of controls) c.disabled = false;
    save.disabled = false; cancel.style.display = "none";
    if (st.cancel || closed()) { status.textContent = t("Stopped. Nothing was saved."); return; }
    if (!blob) return;
    download(blob, clipFilename(o));
    st.saved = { name: clipFilename(o), type: blob.type, size: blob.size };
    status.textContent = t("Saved {name} to your downloads. Nothing was uploaded.", { name: clipFilename(o) });
    count("saved_" + o.format);
    count(o.aspect);
    count(o.names);
    if (o.rooms === "keep") count("rooms_kept");
    if (!o.mark) count("mark_off");
  }
  save.addEventListener("click", doSave);
  cancel.addEventListener("click", () => { st.cancel = true; });

  rebuild();
  drawNow();
  ctx.actions.openModal(t("Share a replay"), body, t("A short clip of people moving through the house, with names hidden"));
  count("opened");
  requestAnimationFrame(tick);
  return { st, body, canvas, set, save: doSave, close: () => { st.stop = true; } };
}
