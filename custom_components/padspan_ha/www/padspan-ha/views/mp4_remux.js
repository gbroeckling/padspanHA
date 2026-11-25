// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Share a replay's MP4, made plain (share_replay.js). Chrome's and Edge's
// MediaRecorder write a fragmented MP4: an empty sample table, moof/mdat
// pieces after it, a movie duration of 0 and frame times off the wall clock,
// which ffprobe reads as a 30000 fps stream. Players cope; an upload checker
// (frame rate at most 60, a duration) may not. This rewrites it as one
// ordinary MP4, in the browser: the same H.264 samples, untouched, in one
// mdat after a full moov (stts, ctts, stss, stsz, stsc, stco), every frame
// 1/fps long, the durations filled in. One video track, as the clip has.

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const s32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const type = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);

/** The boxes in b[from, to): [{type, start, size, body}] (body = where the payload starts). */
export function boxes(b, from = 0, to = b.length) {
  const out = [];
  for (let o = from; o + 8 <= to;) {
    let size = u32(b, o), body = o + 8;
    if (size === 1) { size = u64(b, o + 8); body = o + 16; } else if (size === 0) size = to - o;
    if (size < 8 || o + size > to) throw new Error("mp4: bad box at " + o);
    out.push({ type: type(b, o), start: o, size, body });
    o += size;
  }
  return out;
}
const child = (b, box, name) => boxes(b, box.body, box.start + box.size).find(x => x.type === name) || null;
const raw = (b, box) => b.subarray(box.start, box.start + box.size);

function box(name, ...parts) {
  const n = 8 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  new DataView(out.buffer).setUint32(0, n);
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function words(...v) {           // 32-bit big-endian words
  const out = new Uint8Array(v.length * 4), dv = new DataView(out.buffer);
  v.forEach((x, i) => dv.setUint32(i * 4, x >>> 0));
  return out;
}

/** Every sample of the fragments: [{offset, size, sync, cts}] in decode order, and the track's timescale. */
export function fragmentSamples(b) {
  const top = boxes(b);
  const moov = top.find(x => x.type === "moov");
  if (!moov) throw new Error("mp4: no moov");
  const trex = (() => { const mvex = child(b, moov, "mvex"); return mvex && child(b, mvex, "trex"); })();
  const tx = trex ? { dur: u32(b, trex.body + 12), size: u32(b, trex.body + 16), flags: u32(b, trex.body + 20) } : { dur: 0, size: 0, flags: 0 };
  const samples = [];
  for (const moof of top.filter(x => x.type === "moof")) {
    for (const traf of boxes(b, moof.body, moof.start + moof.size).filter(x => x.type === "traf")) {
      const tfhd = child(b, traf, "tfhd");
      if (!tfhd) continue;
      const tf = u32(b, tfhd.body) & 0xFFFFFF;
      let p = tfhd.body + 8, base = moof.start;
      if (tf & 0x1) { base = u64(b, p); p += 8; }
      if (tf & 0x2) p += 4;
      const dDur = tf & 0x8 ? u32(b, (p += 4) - 4) : tx.dur;
      const dSize = tf & 0x10 ? u32(b, (p += 4) - 4) : tx.size;
      const dFlags = tf & 0x20 ? u32(b, (p += 4) - 4) : tx.flags;
      let next = null;           // a second trun goes on where the first ended
      for (const trun of boxes(b, traf.body, traf.start + traf.size).filter(x => x.type === "trun")) {
        const ver = b[trun.body], fl = u32(b, trun.body) & 0xFFFFFF, count = u32(b, trun.body + 4);
        let q = trun.body + 8, at = next == null ? base : next;
        if (fl & 0x1) { at = base + s32(b, q); q += 4; }
        let first = null;
        if (fl & 0x4) { first = u32(b, q); q += 4; }
        for (let i = 0; i < count; i++) {
          let dur = dDur, size = dSize, flags = i === 0 && first != null ? first : dFlags, cts = 0;
          if (fl & 0x100) { dur = u32(b, q); q += 4; }
          if (fl & 0x200) { size = u32(b, q); q += 4; }
          if (fl & 0x400) { flags = u32(b, q); q += 4; }
          if (fl & 0x800) { cts = ver ? s32(b, q) : u32(b, q); q += 4; }
          if (at + size > b.length) throw new Error("mp4: a sample runs past the end");
          samples.push({ offset: at, size, sync: !(flags & 0x10000), cts, dur });
          at += size;
        }
        next = at;
      }
    }
  }
  if (!samples.length) throw new Error("mp4: no samples");
  return samples;
}

/** A fragmented MP4 (one video track) as a plain one, `fps` frames a second. */
export function defragment(b, fps) {
  const top = boxes(b);
  const moov = top.find(x => x.type === "moov");
  const trak = moov && child(b, moov, "trak");
  const mdia = trak && child(b, trak, "mdia");
  const minf = mdia && child(b, mdia, "minf");
  const stbl = minf && child(b, minf, "stbl");
  const stsd = stbl && child(b, stbl, "stsd");
  const tkhd = trak && child(b, trak, "tkhd"), mdhd = mdia && child(b, mdia, "mdhd"), hdlr = mdia && child(b, mdia, "hdlr");
  if (!stsd || !tkhd || !mdhd || !hdlr) throw new Error("mp4: not one video track");
  if (boxes(b, moov.body, moov.start + moov.size).filter(x => x.type === "trak").length !== 1) throw new Error("mp4: more than one track");
  const oldScale = u32(b, mdhd.body + (b[mdhd.body] ? 20 : 12));
  const samples = fragmentSamples(b);
  const n = samples.length, T = Math.round(fps) * 1000, D = 1000;          // each frame 1000 ticks of fps*1000
  const lang = b.subarray(mdhd.body + (b[mdhd.body] ? 32 : 20), mdhd.body + (b[mdhd.body] ? 34 : 22));
  const movieMs = Math.round(n * 1000 / fps);

  const mvhd = box("mvhd", words(0, 0, 0, 1000, movieMs, 0x00010000), new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    words(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000), new Uint8Array(24), words(2));
  const tk = raw(b, tkhd).slice();
  if (tk[8]) { new DataView(tk.buffer).setUint32(36, 0); new DataView(tk.buffer).setUint32(40, movieMs); }
  else new DataView(tk.buffer).setUint32(28, movieMs);
  const mdhdNew = box("mdhd", words(0, 0, 0, T, n * D), lang, new Uint8Array(2));
  const stts = box("stts", words(0, 1, n, D));
  const ctsAt = samples.map(s => Math.round(s.cts * fps / oldScale) * D);
  const ctts = ctsAt.some(Boolean) ? box("ctts", words(ctsAt.some(c => c < 0) ? 0x01000000 : 0, n), words(...ctsAt.flatMap(c => [1, c]))) : null;
  const sync = samples.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);
  const stss = sync.length < n ? box("stss", words(0, sync.length, ...sync)) : null;
  const stsz = box("stsz", words(0, 0, n, ...samples.map(s => s.size)));
  const stsc = box("stsc", words(0, 1, 1, n, 1));
  const build = (chunkAt) => {
    const stco = box("stco", words(0, 1, chunkAt));
    const st = box("stbl", raw(b, stsd), stts, ...(ctts ? [ctts] : []), ...(stss ? [stss] : []), stsz, stsc, stco);
    const keep = boxes(b, minf.body, minf.start + minf.size).filter(x => x.type !== "stbl").map(x => raw(b, x));
    const mi = box("minf", ...keep, st);
    const md = box("mdia", mdhdNew, raw(b, hdlr), mi);
    return box("moov", mvhd, box("trak", tk, md));
  };
  // Our own ftyp (isom, minor 512; isom iso2 avc1 mp41): the recorder's names fragment brands.
  const head = box("ftyp", new Uint8Array([105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50, 97, 118, 99, 49, 109, 112, 52, 49]));
  const total = samples.reduce((a, s) => a + s.size, 0);
  const moovLen = build(0).length;
  const moovNew = build(head.length + moovLen + 8);
  const out = new Uint8Array(head.length + moovNew.length + 8 + total);
  out.set(head, 0);
  out.set(moovNew, head.length);
  let o = head.length + moovNew.length;
  new DataView(out.buffer).setUint32(o, 8 + total);
  out.set([109, 100, 97, 116], o + 4);
  o += 8;
  for (const s of samples) { out.set(b.subarray(s.offset, s.offset + s.size), o); o += s.size; }
  return out;
}
