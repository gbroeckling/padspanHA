// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Share a replay (views/share_replay.js, views/gif_encoder.js), RUN: names to
// "Person N" or initials and never a device's name, generic room names,
// receivers and still tags left out, the clip trimmed to lead with movement,
// what the preview says is hidden, the "made with PadSpan" switch, the clip
// options (length, shape, format, recorder types), a GIF that decodes back to
// its frames, a video recorded through MediaRecorder, the dialog opened from
// Traceback's own button, no network call when saving, and its words in German.
//
// usage: share_replay.mjs
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const H = await import("./traceback_harness.mjs");
const WWW = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "custom_components", "padspan_ha", "www", "padspan-ha");
const VIEWS = new URL("../../custom_components/padspan_ha/www/padspan-ha/views/", import.meta.url).href;
const S = await import(VIEWS + "share_replay.js?b=1");
const G = await import(VIEWS + "gif_encoder.js?b=1");
const M = await import(VIEWS + "mp4_remux.js?b=1");
const I = await import(VIEWS + "i18n.js?b=1");

const failures = [];
const cases = {};
const check = (name, ok, detail) => { if (cases[name] !== false) cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e && e.stack || e).slice(0, 1500)); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── a small house and an hour in it ──
const RECT = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const SCENE = {
  floors: [
    { n: 1, color: "#52b788", corners: RECT(0, 0, 400, 300), rooms: [
      { room: "Alex's bedroom", poly: RECT(0, 0, 200, 150), label: [100, 75], color: "#60a5fa" },
      { room: "Kitchen", poly: RECT(200, 0, 400, 150), label: [300, 75], color: "#f59e0b" },
      { room: "Sam's den", poly: RECT(0, 150, 200, 300), label: [100, 225], color: "#e879f9" },
    ] },
    { n: 2, color: "#f59e0b", corners: RECT(0, -400, 400, -100), rooms: [
      { room: "Master bath", poly: RECT(0, -400, 200, -250), label: [100, -325], color: "#34d399" },
    ] },
  ],
  posOf: (o) => ({ "Alex's bedroom": [100, 75], "Kitchen": [300, 75], "Sam's den": [100, 225], "Master bath": [100, -325] })[o.r] || null,
  scanners: new Set(["AA:BB:CC:00:00:01"]),
};
const ALEX = "11:22:33:44:55:66", SAM = "entity:device_tracker.sam_watch", TAG = "77:88:99:AA:BB:CC";
const frames = [];
for (let i = 0; i < 40; i++) {
  const o = [
    { k: ALEX, n: "Alex's iPhone", r: i < 25 ? "Alex's bedroom" : "Kitchen", rssi: -60, t: "private_ble", src: "upstairs_proxy" },
    { k: SAM, n: "Sam Jordan Watch", r: i < 30 ? "Sam's den" : "Master bath", t: "entity" },
    { k: TAG, n: "Car keys tag", r: "Kitchen", t: "ble" },
    { k: "AA:BB:CC:00:00:01", n: "Hall proxy", r: "Kitchen" },
  ];
  frames.push({ ts: 1_700_000_000 + i * 10, o });
}
const PRIVATE = ["Alex", "Sam", "Jordan", "iPhone", "Watch", "Car keys", "Hall proxy", ALEX, TAG, "11:22", "private_ble", "upstairs_proxy", "-60", "device_tracker", "Alex's bedroom", "Sam's den", "Master bath"];

function fakeG(canvas) {
  const texts = [];
  const g = { texts, canvas, measureText: (s) => ({ width: String(s).length * 8 }), fillText: (s) => texts.push(String(s)),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
  return new Proxy(g, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
}

await tryCase("initials", async () => {
  const want = { "Alex's iPhone": "A", "Sam Jordan Watch": "SJ", "iPhone 15 Pro": null, "AA:BB:CC:DD:EE:FF": null,
    "Blessing phone": "B", "ble:Jordan's tag": "J", "device_tracker.sam_pixel_7": "S", "": null, "Apple Watch": null };
  for (const [name, w] of Object.entries(want)) check("initials", S.initialsOf(name) === w, { name, got: S.initialsOf(name) });
});

await tryCase("people", async () => {
  const people = S.peopleIn(frames, SCENE.scanners);
  // The receiver never; the keys that sat in the Kitchen all along not while others move.
  check("people", eq(people.map(p => p.key), [ALEX, SAM]), people);
  const still = [{ ts: 1, o: [{ k: TAG, r: "Kitchen" }, { k: ALEX, r: "Kitchen" }] }];
  check("people", eq(S.peopleIn(still, new Set()).map(p => p.key), [TAG, ALEX]), "nobody moves: everyone");
});

await tryCase("person-labels", async () => {
  const people = [{ key: "a", name: "Alex's iPhone" }, { key: "b", name: "Andy Watch" }, { key: "c", name: "iPhone 15" }, { key: "d", name: "Sam" }];
  const p = S.personLabels(people, "person");
  check("person-labels", eq([...p.values()], ["Person 1", "Person 2", "Person 3", "Person 4"]), [...p.values()]);
  const i = S.personLabels(people, "initials");
  check("person-labels", eq([...i.values()], ["A", "A2", "Person 3", "S"]), [...i.values()]);
  for (const v of [...p.values(), ...i.values()]) check("person-labels", !/iphone|watch|alex|andy|sam/i.test(v), v);
});

await tryCase("rooms", async () => {
  const want = { "Alex's bedroom": "Bedroom", "Master bath": "Bathroom", "Küche": "Kitchen", "Wohnzimmer": "Living room",
    "Garden": "Outside", "Sam's den": "Living room", "Gäste-WC": "Bathroom", "Kinderzimmer": "Bedroom", "Front hall": "Hallway",
    "Mudroom": "Entrance", "Sam's room": null, "Jordan's lair": null };
  for (const [r, w] of Object.entries(want)) check("rooms", S.genericRoomName(r) === w, { r, got: S.genericRoomName(r) });
  const g = S.roomLabels(["Alex's bedroom", "Kitchen", "Sam's bedroom", "Sam's room", "Jordan's lair", "Kitchen"], "generic");
  check("rooms", eq([...g.entries()], [["Alex's bedroom", "Bedroom"], ["Kitchen", "Kitchen"], ["Sam's bedroom", "Bedroom 2"],
    ["Sam's room", "Room 1"], ["Jordan's lair", "Room 2"]]), [...g.entries()]);
  const k = S.roomLabels(["Alex's bedroom", "Kitchen"], "keep");
  check("rooms", eq([...k.entries()], [["Alex's bedroom", "Alex's bedroom"], ["Kitchen", "Kitchen"]]), [...k.entries()]);
  check("rooms", eq(S.roomsOf(SCENE, [{ ts: 1, o: [{ k: "x", r: "Porch" }] }]), ["Alex's bedroom", "Kitchen", "Sam's den", "Master bath", "Porch"]), "roomsOf");
});

await tryCase("hidden", async () => {
  const people = S.peopleIn(frames, SCENE.scanners);
  const rooms = S.roomsOf(SCENE, frames);
  const lines = (o) => Object.fromEntries(S.hiddenList(people, rooms, S.roomLabels(rooms, o.rooms || "generic"), o).map(l => [l.id, l.text]));
  const a = lines({});
  check("hidden", eq(Object.keys(a), ["names", "devices", "rooms", "floors", "date", "plan", "mark"]), Object.keys(a));
  check("hidden", a.names === "2 names shown as Person 1 to Person 2", a.names);
  check("hidden", a.devices.startsWith("Device names, addresses"), a.devices);
  // Kitchen stays Kitchen: three of the four replaced.
  check("hidden", a.rooms === "3 room names replaced by generic ones", a.rooms);
  check("hidden", /plan images/i.test(a.plan) && /coordinates/.test(a.plan) && /address/.test(a.plan), a.plan);
  check("hidden", /date: left out/.test(a.date), a.date);
  check("hidden", a.mark.endsWith("in the bottom corner"), a.mark);
  const b = lines({ names: "initials", rooms: "keep", mark: false });
  check("hidden", b.names.startsWith("2 names shown as initials"), b.names);
  check("hidden", b.rooms === "Room names: kept as they are", b.rooms);
  check("hidden", b.mark.endsWith(": off"), b.mark);
});

await tryCase("options", async () => {
  check("options", eq(S.normaliseOptions({}), S.DEFAULTS), S.normaliseOptions({}));
  check("options", S.DEFAULTS.names === "person" && S.DEFAULTS.rooms === "generic" && S.DEFAULTS.mark === true, S.DEFAULTS);
  check("options", S.normaliseOptions({ seconds: 3 }).seconds === 10 && S.normaliseOptions({ seconds: 99 }).seconds === 30
    && S.normaliseOptions({ seconds: "x" }).seconds === 20, "length 10-30 s");
  const bad = S.normaliseOptions({ names: "real", rooms: "x", aspect: "square", format: "avi", mark: 0 });
  check("options", bad.names === "person" && bad.rooms === "generic" && bad.aspect === "wide" && bad.format === "mp4" && bad.mark === false, bad);
  const sz = (o) => { const s = S.clipSize(o); return [s.w, s.h, s.fps]; };
  check("options", eq(sz({ aspect: "wide" }), [1280, 720, 30]) && eq(sz({ aspect: "vertical" }), [720, 1280, 30])
    && eq(sz({ aspect: "wide", format: "gif" }), [854, 480, 12]) && eq(sz({ aspect: "vertical", format: "gif" }), [480, 854, 12]), "sizes");
  const only = (...ok) => (m) => ok.includes(m);
  check("options", S.pickMime("mp4", only("video/mp4;codecs=avc1.42e01e", "video/mp4")) === "video/mp4;codecs=avc1.42e01e", "mp4 codec first");
  check("options", S.pickMime("mp4", only("video/webm")) === null && S.pickMime("webm", only("video/webm;codecs=vp8")) === "video/webm;codecs=vp8", "webm");
  check("options", S.pickMime("gif", () => false) === "image/gif", "gif needs no recorder");
  check("options", eq(S.availableFormats({}), { mp4: null, webm: null, gif: "image/gif" }), S.availableFormats({}));
  const env = { MediaRecorder: { isTypeSupported: only("video/webm;codecs=vp9") }, HTMLCanvasElement: { prototype: { captureStream() {} } } };
  check("options", eq(S.availableFormats(env), { mp4: null, webm: "video/webm;codecs=vp9", gif: "image/gif" }), S.availableFormats(env));
  check("options", S.clipFilename({ aspect: "vertical", format: "gif" }) === "padspan-replay-vertical.gif", S.clipFilename({ aspect: "vertical", format: "gif" }));
});

await tryCase("lead-with-moving", async () => {
  const people = S.peopleIn(frames, SCENE.scanners);
  const clip = S.buildClip(frames, SCENE, { seconds: 10 }, S.personLabels(people, "person"));
  // First room change is between frames 24 and 25: the clip starts at 23, not at 0.
  check("lead-with-moving", clip.steps[0].ts === frames[23].ts, clip.steps[0].ts - frames[0].ts);
  check("lead-with-moving", clip.steps[clip.steps.length - 1].ts <= frames[33].ts, "ends soon after the last move");
  check("lead-with-moving", clip.frameCount === 300 && clip.people.length === 2, [clip.frameCount, clip.people.length]);
  const first = S.clipAt(clip, 0);
  check("lead-with-moving", Object.keys(first.at).length === 2, "both people in the first frame");
  // A step where someone changes room plays at full weight, a still one at a fraction.
  const w = clip.cum.slice(1).map((c, i) => +(c - clip.cum[i]).toFixed(2));
  check("lead-with-moving", w.includes(1) && w.some(x => x < 0.5), w);
  const mid = S.clipAt(clip, (clip.cum[2] + clip.cum[1]) / 2 / clip.total).at[ALEX];
  check("lead-with-moving", mid[0] > 100 && mid[0] < 300, mid);
});

await tryCase("draw-private", async () => {
  const people = S.peopleIn(frames, SCENE.scanners);
  for (const names of ["person", "initials"]) {
    const rooms = S.roomsOf(SCENE, frames), roomMap = S.roomLabels(rooms, "generic");
    const clip = S.buildClip(frames, SCENE, { names, seconds: 10 }, S.personLabels(people, names));
    const g = fakeG();
    for (const i of [0, 100, 299]) S.drawClipFrame(g, clip, SCENE, roomMap, i, () => "07:15");
    const all = g.texts.join(" | ");
    for (const p of PRIVATE) check("draw-private", !all.includes(p), { names, p, all: all.slice(0, 300) });
    check("draw-private", names === "person" ? all.includes("Person 1") && all.includes("Person 2") : all.includes("A") && all.includes("SJ"), all.slice(0, 300));
    check("draw-private", all.includes("Bedroom") && all.includes("07:15") && !/2023|Nov/.test(all), all.slice(0, 300));
  }
  const keep = fakeG();
  const rooms = S.roomsOf(SCENE, frames);
  S.drawClipFrame(keep, S.buildClip(frames, SCENE, { rooms: "keep" }, S.personLabels(people, "person")), SCENE, S.roomLabels(rooms, "keep"), 0, () => "07:15");
  check("draw-private", keep.texts.includes("Alex's bedroom"), "rooms kept when asked");
});

await tryCase("mark", async () => {
  const people = S.peopleIn(frames, SCENE.scanners), rooms = S.roomsOf(SCENE, frames), roomMap = S.roomLabels(rooms, "generic");
  const drawn = (mark) => { const g = fakeG(); S.drawClipFrame(g, S.buildClip(frames, SCENE, { mark }, S.personLabels(people, "person")), SCENE, roomMap, 5); return g.texts; };
  check("mark", drawn(true).includes("made with PadSpan"), "on by default");
  check("mark", !drawn(false).some(s => /PadSpan/.test(s)), "off when switched off");
});

// A GIF decoder as a browser reads one (LZW per the GIF89a spec, frames composed with transparency).
function lzwDecode(data, min, n) {
  const clear = 1 << min, eoi = clear + 1;
  let size, next, dict, prev = null, pos = 0;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; size = min + 1; next = eoi + 1; prev = null; };
  reset();
  const out = [];
  const read = () => { let v = 0; for (let i = 0; i < size; i++, pos++) { const b = data[pos >> 3]; if (b === undefined) return -1; v |= ((b >> (pos & 7)) & 1) << i; } return v; };
  for (;;) {
    const code = read();
    if (code < 0 || code === eoi) break;
    if (code === clear) { reset(); continue; }
    if (prev === null) { prev = dict[code]; out.push(...prev); continue; }
    const entry = code < next ? dict[code] : code === next ? prev.concat([prev[0]]) : null;
    if (!entry) throw new Error("bad code " + code);
    out.push(...entry);
    if (next < 4096) { dict[next++] = prev.concat([entry[0]]); if (next === (1 << size) && size < 12) size++; }
    prev = entry;
  }
  if (out.length !== n) throw new Error(`decoded ${out.length} of ${n}`);
  return out;
}
function decodeGif(u8) {
  let p = 6;
  const W = u8[p] | (u8[p + 1] << 8), Hh = u8[p + 2] | (u8[p + 3] << 8), packed = u8[p + 4];
  p += 7;
  const gct = packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0;
  const pal = u8.slice(p, p + gct); p += gct;
  const screen = new Uint8Array(W * Hh), frames = [], delays = [];
  let trans = -1, loop = false;
  while (p < u8.length) {
    const b = u8[p++];
    if (b === 0x3B) break;
    if (b === 0x21) {
      const label = u8[p++];
      if (label === 0xF9) { trans = (u8[p + 1] & 1) ? u8[p + 4] : -1; delays.push(u8[p + 2] | (u8[p + 3] << 8)); p += u8[p] + 2; continue; }
      if (label === 0xFF) loop = true;
      while (u8[p]) p += u8[p] + 1;
      p++;
      continue;
    }
    if (b !== 0x2C) throw new Error("bad block " + b);
    const x = u8[p] | (u8[p + 1] << 8), y = u8[p + 2] | (u8[p + 3] << 8), w = u8[p + 4] | (u8[p + 5] << 8), h = u8[p + 6] | (u8[p + 7] << 8);
    p += 9;
    const min = u8[p++], data = [];
    while (u8[p]) { const n = u8[p++]; for (let i = 0; i < n; i++) data.push(u8[p + i]); p += n; }
    p++;
    const idx = lzwDecode(data, min, w * h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const v = idx[yy * w + xx]; if (v !== trans) screen[(y + yy) * W + x + xx] = v; }
    frames.push(screen.slice());
  }
  return { head: String.fromCharCode(...u8.slice(0, 6)), W, H: Hh, pal, frames, delays, loop, last: u8[u8.length - 1] };
}

await tryCase("gif", async () => {
  // 200 colours, random pixels: enough codes that the table fills and starts again.
  const W = 96, Hh = 80, COL = [];
  for (let i = 0; i < 200; i++) COL.push([(i * 37) % 256 & ~7, (i * 91) % 256 & ~7, (i * 53) % 256 & ~7]);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const frame = () => { const d = new Uint8ClampedArray(W * Hh * 4); for (let i = 0; i < W * Hh; i++) { const c = COL[Math.floor(rnd() * COL.length)]; d.set([...c, 255], i * 4); } return d; };
  const f1 = frame(), f2 = f1.slice(), f3 = f1.slice();
  for (let y = 10; y < 30; y++) for (let x = 40; x < 70; x++) f2.set([...COL[(x + y) % 200], 255], (y * W + x) * 4);
  const pal = G.buildPalette([f1, f2]);
  const gw = new G.GifWriter(W, Hh, pal);
  gw.addFrame(f1, 8); gw.addFrame(f2, 9); gw.addFrame(f3, 8);
  const bytes = gw.finish();
  const d = decodeGif(bytes);
  check("gif", d.head === "GIF89a" && d.W === W && d.H === Hh && d.loop && d.last === 0x3B && eq(d.delays, [8, 9, 8]), { head: d.head, delays: d.delays });
  const rgbOf = (fr) => { const out = []; for (const v of fr) out.push(d.pal[v * 3], d.pal[v * 3 + 1], d.pal[v * 3 + 2]); return out; };
  [f1, f2, f3].forEach((src, k) => {
    const got = rgbOf(d.frames[k]);
    let bad = 0;
    for (let i = 0; i < W * Hh; i++) if (got[i * 3] !== src[i * 4] || got[i * 3 + 1] !== src[i * 4 + 1] || got[i * 3 + 2] !== src[i * 4 + 2]) bad++;
    check("gif", bad === 0, { frame: k, bad });
  });
  // The second frame carries only the box that changed.
  check("gif", bytes.length < W * Hh * 3, bytes.length);
});

// A fragmented MP4 as Chrome's and Edge's MediaRecorder write one: an empty
// sample table, trex defaults, then moof (tfhd default-base-is-moof, tfdt,
// trun v1 with data offset, first-sample flags, duration, size) and mdat pairs.
const ascii = (str) => Uint8Array.from(str, c => c.charCodeAt(0));
const w32 = (...v) => { const o = new Uint8Array(v.length * 4), dv = new DataView(o.buffer); v.forEach((x, i) => dv.setUint32(i * 4, x >>> 0)); return o; };
function bx(name, ...parts) {
  const n = 8 + parts.reduce((a, q) => a + q.length, 0), o = new Uint8Array(n);
  new DataView(o.buffer).setUint32(0, n); o.set(ascii(name), 4);
  let at = 8; for (const q of parts) { o.set(q, at); at += q.length; }
  return o;
}
function fragmentedMp4(samples, perMoof = 3) {
  const tkhd = bx("tkhd", w32(3, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000, 1280 << 16, 720 << 16));
  const mdhd = bx("mdhd", w32(0x01000000, 0, 0, 0, 0, 90000, 0, 0), new Uint8Array([0x55, 0xc4, 0, 0]));
  const stbl = bx("stbl", bx("stsd", w32(0, 1), bx("avc1", new Uint8Array(78))), bx("stts", w32(0, 0)), bx("stsc", w32(0, 0)), bx("stsz", w32(0, 0, 0)), bx("stco", w32(0, 0)));
  const minf = bx("minf", bx("vmhd", w32(1, 0, 0)), bx("dinf", bx("dref", w32(0, 1), bx("url ", w32(1)))), stbl);
  const moov = bx("moov", bx("mvhd", w32(0, 0, 0, 1000, 0, 0x00010000), new Uint8Array(76), w32(2)),
    bx("trak", tkhd, bx("mdia", mdhd, bx("hdlr", w32(0, 0), ascii("vide"), w32(0, 0, 0), new Uint8Array([0x56, 0])), minf)),
    bx("mvex", bx("trex", w32(0, 1, 1, 0, 0, 0))));
  const parts = [bx("ftyp", ascii("iso5"), w32(512), ascii("iso5iso6mp41")), moov];
  for (let i = 0, seq = 1; i < samples.length; i += perMoof, seq++) {
    const run = samples.slice(i, i + perMoof);
    const trun = (off) => bx("trun", w32(0x01000305, run.length, off, run[0].sync ? 0x02000000 : 0x01010000), w32(...run.flatMap(x => [3000, x.bytes.length])));
    const moof = (off) => bx("moof", bx("mfhd", w32(0, seq)), bx("traf", bx("tfhd", w32(0x020020, 1, 0x01010000)), bx("tfdt", w32(0x01000000, 0, i * 3000)), trun(off)));
    const len = moof(0).length;
    parts.push(moof(len + 8), bx("mdat", ...run.map(x => x.bytes)));
  }
  const out = new Uint8Array(parts.reduce((a, q) => a + q.length, 0));
  let at = 0; for (const q of parts) { out.set(q, at); at += q.length; }
  return out;
}
const sampleSet = (n) => Array.from({ length: n }, (_, i) => ({ bytes: Uint8Array.from({ length: 50 + (i * 37) % 90 }, (_, j) => (i * 13 + j) & 255), sync: i % 30 === 0 }));
const boxAt = (b, path) => { let at = { body: 0, start: 0, size: b.length }; for (const name of path) { at = M.boxes(b, at.body, at.start + at.size).find(x => x.type === name); if (!at) return null; } return at; };
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

await tryCase("remux", async () => {
  const samples = sampleSet(70);
  const frag = fragmentedMp4(samples);
  const got = M.fragmentSamples(frag);
  check("remux", got.length === 70 && got.every((x, i) => x.size === samples[i].bytes.length && x.sync === samples[i].sync), got.length);
  const plain = M.defragment(frag, 30);
  const top = M.boxes(plain).map(x => x.type);
  check("remux", eq(top, ["ftyp", "moov", "mdat"]), top);
  const d = dv(plain), stbl = ["moov", "trak", "mdia", "minf", "stbl"];
  check("remux", !boxAt(plain, ["moov", "mvex"]), "no mvex left");
  const stsz = boxAt(plain, [...stbl, "stsz"]), stco = boxAt(plain, [...stbl, "stco"]), stts = boxAt(plain, [...stbl, "stts"]), stss = boxAt(plain, [...stbl, "stss"]);
  check("remux", d.getUint32(stsz.body + 8) === 70 && samples.every((x, i) => d.getUint32(stsz.body + 12 + i * 4) === x.bytes.length), "stsz");
  check("remux", d.getUint32(stts.body + 4) === 1 && d.getUint32(stts.body + 8) === 70 && d.getUint32(stts.body + 12) === 1000, "stts: 70 frames of 1/30 s");
  check("remux", eq([...Array(d.getUint32(stss.body + 4))].map((_, i) => d.getUint32(stss.body + 8 + i * 4)), [1, 31, 61]), "stss");
  // The samples, in order, from where stco says, byte for byte.
  let at = d.getUint32(stco.body + 8), same = true;
  for (const x of samples) { for (let j = 0; j < x.bytes.length; j++) if (plain[at + j] !== x.bytes[j]) same = false; at += x.bytes.length; }
  check("remux", same && at === plain.length, { same, at, len: plain.length });
  const mdhd = boxAt(plain, ["moov", "trak", "mdia", "mdhd"]), mvhd = boxAt(plain, ["moov", "mvhd"]), tkhd = boxAt(plain, ["moov", "trak", "tkhd"]);
  check("remux", d.getUint32(mdhd.body + 12) === 30000 && d.getUint32(mdhd.body + 16) === 70000, "mdhd");
  check("remux", d.getUint32(mvhd.body + 12) === 1000 && d.getUint32(mvhd.body + 16) === 2333 && d.getUint32(tkhd.body + 20) === 2333, "durations");
  let threw = false;
  try { M.defragment(ascii("not an mp4 at all"), 30); } catch (_) { threw = true; }
  check("remux", threw, "not an MP4: refused, so the recording is saved as it was");
});

// ── the dialog: opened from Traceback's own button, saved without a network call ──
const net = [];
globalThis.XMLHttpRequest = class { constructor() { net.push("xhr"); } open() {} send() {} };
globalThis.WebSocket = class { constructor() { net.push("ws"); } };
globalThis.navigator.sendBeacon = () => { net.push("beacon"); return true; };
const realCE = document.createElement;
const downloads = [];
document.createElement = (tag) => {
  const n = realCE(tag);
  if (tag === "canvas") n.getContext = () => fakeG(n);
  if (tag === "a") n.click = () => downloads.push({ href: n.href, download: n.download });
  return n;
};
const settle = async () => { for (let i = 0; i < 6; i++) { await H.flush(); await new Promise(r => globalThis._realSetTimeout(r, 5)); } };

function dialogCtx() {
  const opened = [], counted = [];
  const { ctx, calls } = H.makeCtx({
    wsCall: (ty) => ty === "padspan_ha/traceback_get" ? { frames, matched: frames.length, range: { start: frames[0].ts, end: frames[39].ts, count: 40 } }
      : ty === "padspan_ha/traceback_objects" ? { objects: [] } : {},
  });
  ctx.actions.openModal = (title, body, sub) => { opened.push({ title, body, sub }); document.body.appendChild(body); };
  ctx.actions.telemetryEvent = (w) => counted.push(w);
  ctx.actions.renderRooms = () => {};
  return { ctx, calls, opened, counted };
}

await tryCase("dialog", async () => {
  const { ctx, calls, opened, counted } = dialogCtx();
  const outer = H.TB.render(ctx);
  await settle();
  const all = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); all(c, acc); } return acc; };
  const btn = all(outer).find(n => n.dataset && n.dataset.shareReplay === "1");
  check("dialog", btn && btn.textContent === "Share a replay", btn && btn.textContent);
  btn.click();
  await settle();
  check("dialog", opened.length === 1 && opened[0].title === "Share a replay", opened.map(o => o.title));
  const body = opened[0].body;
  const text = body.textContent;
  check("dialog", text.includes("What the clip hides") && text.includes("Device names, addresses") && text.includes("Nothing is uploaded"), text.slice(0, 400));
  check("dialog", eq(counted, ["share_replay:opened"]), counted);
  // No MediaRecorder in this harness: MP4 and WebM offered as not in this browser, GIF chosen.
  const sel = all(body).filter(n => n.localName === "select");
  const fmt = sel.find(s => s.dataset.opt === "format");
  check("dialog", fmt && fmt.value === "gif" && all(fmt).filter(o => o.disabled).length === 2, fmt && fmt.value);
  // The watermark switch: off changes the preview's list and the clip.
  const mark = all(body).find(n => n.dataset && n.dataset.opt === "mark");
  mark.checked = false;
  mark.dispatchEvent({ type: "change" });
  check("dialog", body.textContent.includes("mark: off") && ctx.state._shareReplayOpts.mark === false, "mark off");
  // Names as initials: the list says so.
  const names = sel.find(s => s.dataset.opt === "names");
  names.value = "initials";
  names.dispatchEvent({ type: "change" });
  check("dialog", body.textContent.includes("shown as initials"), "initials");
  // Save: a GIF, downloaded by name, counted, and nothing sent anywhere.
  const before = calls.length;
  globalThis.fetch = async (u) => { net.push("fetch " + u); return { ok: false, json: async () => ({}) }; };
  const len = all(body).find(n => n.dataset && n.dataset.opt === "seconds");
  len.value = "10"; len.dispatchEvent({ type: "change" });
  const saveBtn = all(body).find(n => n.dataset && n.dataset.shareSave === "1");
  saveBtn.click();
  for (let i = 0; i < 400 && !downloads.length; i++) await H.flush();
  check("dialog", downloads.length === 1 && downloads[0].download === "padspan-replay-wide.gif" && String(downloads[0].href).startsWith("blob:"), downloads);
  check("dialog", calls.length === before && !net.length, { calls: calls.slice(before).map(c => c.type), net });
  check("dialog", eq(counted.slice(1), ["share_replay:saved_gif", "share_replay:wide", "share_replay:initials", "share_replay:mark_off"]), counted);
});

await tryCase("video", async () => {
  const recorded = [], blobs = [];
  let requested = 0;
  const realURL = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = (b) => { blobs.push(b); return realURL(b); };
  globalThis.HTMLCanvasElement = { prototype: { captureStream() {} } };
  globalThis.MediaRecorder = class {
    static isTypeSupported(m) { return m === "video/mp4;codecs=avc1.42e01e" || m.startsWith("video/webm"); }
    constructor(stream, o) { this.o = o; recorded.push(o.mimeType); }
    start() {} stop() { this.ondataavailable({ data: new Blob([fragmentedMp4(sampleSet(requested))]) }); this.onstop(); }
  };
  const { ctx, opened, counted } = dialogCtx();
  ctx.state._shareReplayOpts = { aspect: "vertical", seconds: 10 };
  const c = S.openShareReplay(ctx, { frames, scene: SCENE });
  const track = { requestFrame() { requested++; }, stop() {} };
  c.canvas.captureStream = (fps) => ({ fps, getVideoTracks: () => [track], getTracks: () => [track] });
  check("video", c.st.opts.format === "mp4" && c.canvas.width === 720 && c.canvas.height === 1280, [c.st.opts.format, c.canvas.width, c.canvas.height]);
  const n0 = downloads.length;
  const p = c.save();
  let done = false; p.then(() => { done = true; });
  for (let i = 0; i < 2000 && !done; i++) await H.flush(1);
  check("video", done && eq(recorded, ["video/mp4;codecs=avc1.42e01e"]), recorded);
  check("video", downloads.length === n0 + 1 && downloads[n0].download === "padspan-replay-vertical.mp4", downloads.slice(n0));
  check("video", c.st.saved && c.st.saved.type === "video/mp4", c.st.saved);
  check("video", counted.includes("share_replay:saved_mp4") && counted.includes("share_replay:vertical") && !counted.includes("share_replay:mark_off"), counted);
  check("video", opened.length === 1 && requested === 300, { opened: opened.length, requested });
  // Saved as a plain MP4: every frame handed over, one frame each, no fragments.
  const saved = new Uint8Array(await blobs[blobs.length - 1].arrayBuffer());
  check("video", eq(M.boxes(saved).map(x => x.type), ["ftyp", "moov", "mdat"]), M.boxes(saved).map(x => x.type));
  const stsz = boxAt(saved, ["moov", "trak", "mdia", "minf", "stbl", "stsz"]);
  check("video", dv(saved).getUint32(stsz.body + 8) === 300, "300 samples");
  globalThis.URL.createObjectURL = realURL;
  delete globalThis.MediaRecorder; delete globalThis.HTMLCanvasElement;
});

await tryCase("german", async () => {
  globalThis.fetch = async (url) => {
    const key = new URL(String(url)).pathname.split("/i18n/")[1];
    try { return { ok: true, json: async () => JSON.parse(readFileSync(join(WWW, "i18n", key), "utf-8")) }; }
    catch (_) { return { ok: false, json: async () => ({}) }; }
  };
  const lang = await I.useLanguage({ language: "de" }, ["traceback"]);
  check("german", lang === "de", lang);
  check("german", S.genericRoomName("Alex's bedroom") === "Schlafzimmer" && S.roomLabels(["Sam's room"], "generic").get("Sam's room") === "Raum 1", "rooms");
  check("german", S.personLabels([{ key: "a", name: "" }], "person").get("a") === "Person 1", "person");
  const people = S.peopleIn(frames, SCENE.scanners), rooms = S.roomsOf(SCENE, frames);
  const h = S.hiddenList(people, rooms, S.roomLabels(rooms, "generic"), {});
  check("german", h[0].text === "2 Namen als Person 1 bis Person 2 gezeigt" && h[6].text.includes("gemacht mit PadSpan"), h.map(l => l.text));
  const g = fakeG();
  S.drawClipFrame(g, S.buildClip(frames, SCENE, {}, S.personLabels(people, "person")), SCENE, S.roomLabels(rooms, "generic"), 0, () => "07:15");
  check("german", g.texts.includes("gemacht mit PadSpan") && g.texts.includes("Küche"), g.texts);
  await I.useLanguage({ language: "en" }, ["traceback"]);
});

console.log(JSON.stringify({ cases, failures: failures.slice(0, 20) }));
process.exit(0);
