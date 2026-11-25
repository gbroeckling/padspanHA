// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// A small animated-GIF writer for Share a replay (share_replay.js), written
// here rather than vendored: one 255-colour palette for the whole clip (the
// clip's own colours, counted from a few of its frames), and each frame after
// the first only the box that changed, with the pixels that did not change
// transparent, so a clip whose house stands still stays small. GIF89a,
// looping. Runs in the browser; nothing leaves it.

const TRANSPARENT = 255;   // palette slot 255 is never a colour: it marks "unchanged"

/** The clip's palette from a few of its frames (RGBA bytes): the 255 commonest
 *  colours at 5 bits a channel, each the average of what fell in it, and a
 *  table from every 15-bit colour to its nearest. */
export function buildPalette(samples) {
  const count = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  for (const rgba of samples) {
    for (let i = 0; i < rgba.length; i += 4) {
      const k = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      count[k]++; sr[k] += rgba[i]; sg[k] += rgba[i + 1]; sb[k] += rgba[i + 2];
    }
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (count[k]) keys.push(k);
  keys.sort((a, b) => count[b] - count[a]);
  const used = Math.max(1, Math.min(255, keys.length));
  const colors = new Uint8Array(256 * 3);
  for (let i = 0; i < Math.min(used, keys.length); i++) {
    const k = keys[i];
    colors[i * 3] = Math.round(sr[k] / count[k]);
    colors[i * 3 + 1] = Math.round(sg[k] / count[k]);
    colors[i * 3 + 2] = Math.round(sb[k] / count[k]);
  }
  const lut = new Uint8Array(32768);
  for (let k = 0; k < 32768; k++) {
    const r = ((k >> 10) << 3) + 4, g = (((k >> 5) & 31) << 3) + 4, b = ((k & 31) << 3) + 4;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < used; i++) {
      const dr = r - colors[i * 3], dg = g - colors[i * 3 + 1], db = b - colors[i * 3 + 2];
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (d < bestD) { bestD = d; best = i; if (!d) break; }
    }
    lut[k] = best;
  }
  return { colors, lut, used };
}

/** RGBA bytes to palette indices. */
export function indexPixels(rgba, lut) {
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = lut[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
  }
  return out;
}

class Bytes {
  constructor(n = 1 << 16) { this.buf = new Uint8Array(n); this.len = 0; }
  push(b) {
    if (this.len === this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
    this.buf[this.len++] = b;
  }
  word(v) { this.push(v & 255); this.push((v >> 8) & 255); }
  all(arr) { for (const b of arr) this.push(b); }
  bytes() { return this.buf.subarray(0, this.len); }
}

// The dictionary of the LZW below, shared between calls: a code per
// (prefix code, next index), valid while its stamp is the current table's.
const _dict = new Int16Array(4096 * 256);
const _stamp = new Int32Array(4096 * 256);
let _gen = 0;

/** GIF's LZW over palette indices (8-bit codes), as the raw code stream. */
export function lzwEncode(pixels, minCode = 8) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, cur = 0, bits = 0;
  const out = new Bytes(Math.max(64, pixels.length >> 1));
  const emit = (code) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  const reset = () => { _gen++; if (_gen > 2e9) { _stamp.fill(0); _gen = 1; } size = minCode + 1; next = eoi + 1; };
  reset();
  emit(clear);
  if (!pixels.length) { emit(eoi); if (bits) out.push(cur & 255); return out.bytes(); }
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = (prefix << 8) | k;
    if (_stamp[key] === _gen) { prefix = _dict[key]; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      reset();
    } else {
      if (next >= (1 << size)) size++;
      _dict[key] = next++; _stamp[key] = _gen;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits) out.push(cur & 255);
  return out.bytes();
}

/** An animated GIF, a frame at a time: new GifWriter(w, h, palette), then
 *  addFrame(rgba, delayCentiseconds) for each, then finish() for the bytes. */
export class GifWriter {
  constructor(width, height, palette) {
    this.w = width; this.h = height; this.pal = palette; this.prev = null;
    const o = this.out = new Bytes(1 << 20);
    o.all([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);            // GIF89a
    o.word(width); o.word(height);
    o.push(0xF7); o.push(0); o.push(0);                       // a 256-colour global table
    o.all(palette.colors);
    o.all([0x21, 0xFF, 0x0B]); o.all([...("NETSCAPE2.0")].map(c => c.charCodeAt(0)));
    o.all([0x03, 0x01, 0x00, 0x00, 0x00]);                    // loop for ever
  }

  addFrame(rgba, delayCs) {
    const idx = indexPixels(rgba, this.pal.lut);
    const { w, h } = this;
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    let pixels = idx;
    if (this.prev) {
      // Only the box that changed, and in it only what changed.
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          if (idx[row + x] !== this.prev[row + x]) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      pixels = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) {
        const src = (y0 + y) * w + x0;
        for (let x = 0; x < bw; x++) {
          const v = idx[src + x];
          pixels[y * bw + x] = v === this.prev[src + x] ? TRANSPARENT : v;
        }
      }
    }
    this.prev = idx;
    const o = this.out;
    const d = Math.max(2, Math.round(delayCs));
    o.all([0x21, 0xF9, 0x04, 0x05]); o.word(d); o.push(TRANSPARENT); o.push(0);   // keep the last frame; 255 shows it through
    o.push(0x2C); o.word(x0); o.word(y0); o.word(x1 - x0 + 1); o.word(y1 - y0 + 1); o.push(0);
    o.push(8);
    const code = lzwEncode(pixels, 8);
    for (let i = 0; i < code.length; i += 255) {
      const n = Math.min(255, code.length - i);
      o.push(n);
      for (let j = 0; j < n; j++) o.push(code[i + j]);
    }
    o.push(0);
  }

  finish() {
    this.out.push(0x3B);
    return this.out.bytes();
  }
}
