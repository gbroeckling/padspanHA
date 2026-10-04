// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md): the furniture
// builders. Every piece is a recipe, plain data —
//   {kind, params, colors: ["#rrggbb", …], width_m, depth_m, height_m, details?}
// — and a builder here, PadSpan's own code, draws it. The look is
// deliberately simple and Sims-like: boxes, rounded boxes, cylinders and
// bevels, flat colours on Low and finishes made in code on High (wood grain,
// fabric weave, brushed metal, gloss). No model files, no texture files.
//
// The recipe's width × depth × height is always the piece's whole box (what
// the plan, the fit checks, a photo's one real measurement and the library
// use); a kind's params are its style and never restate a size. So a sofa's
// "back height" is its Height and its "seat depth" its Depth, and a bed's
// headboard height is the bed's Height. A choice that implies a size (a king
// bed, a 4-seat sofa) carries `sizes`, the sizes Build may set when that
// choice is picked; the recipe's own numbers always win when drawing.
// Params whose key ends in _m are metres.
//
// Reading is tolerant, as everywhere in the 3D file: unknown kinds, params
// and keys are kept, numbers are clamped, a bad choice becomes the default,
// and an unknown kind is drawn as a coloured box of its size. Nothing is
// ever refused.
//
// three.js is handed in by the caller (the view already holds the bundled
// build), so this file imports nothing and runs under node in the tests.
// Each piece's local frame: the origin on the floor under the centre of its
// footprint, width along x, depth along z with the FRONT toward +z, up +y,
// and all of it inside width × depth × height.
//
// Each piece's geometry is merged per look (one draw call per colour and
// finish) by this file's own small merge. Materials and finish textures are
// shared between pieces by colour + finish and counted: disposing a piece
// never frees one another piece still uses, and once no piece uses one it
// is freed, so nothing here outlives the pieces (or keeps an old renderer
// alive). A live part — a lamp's glow, a TV's screen, a radiator's warmth —
// has a material of its own, so changing it changes only that piece.

const TILE = 0.5;                       // a finish repeats every half metre
const BOX_COLOR = "#9aa3ab";
const BOX_SIZE = { width_m: [0.05, 6, 0.6], depth_m: [0.05, 6, 0.6], height_m: [0.02, 4, 0.6] };
const DIMS = ["width_m", "depth_m", "height_m"];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const toNum = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

// A JSON-safe deep copy: recipes are plain data, so anything else is dropped.
function plain(v, depth = 0){
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (depth > 24) return null;
  if (Array.isArray(v)) return v.map((x) => { const c = plain(x, depth + 1); return c === undefined ? null : c; });
  if (isObj(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "__proto__") continue;
      const c = plain(x, depth + 1);
      if (c !== undefined) o[k] = c;
    }
    return o;
  }
  return undefined;
}
function hexOf(v){
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}
function mix(a, b, t){
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return "#" + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0");
}
const lighten = (c, t) => mix(c, "#ffffff", t);
const darken = (c, t) => mix(c, "#000000", t);

// ── the kinds ────────────────────────────────────────────────────────────────
const int = (key, label, min, max, def, more) => ({ key, label, type: "int", min, max, step: 1, def, ...more });
const num = (key, label, min, max, step, def, more) => ({ key, label, type: "num", min, max, step, def, ...more });
const choice = (key, label, choices, def, more) => ({ key, label, type: "choice", choices, def, ...more });
const bool = (key, label, def) => ({ key, label, type: "bool", def });
const kind = (name, group, category, live, colorNames, colors, size, params) =>
  ({ name, group, category, params, colorNames, colors, size, live });
const sz = (w, d, h) => ({ width_m: w, depth_m: d, height_m: h });

export const FURNITURE = {
  sofa: kind("Sofa", "furniture", "seating", null, ["Body", "Cushions"], ["#5b6b7a", "#c8b89a"],
    sz([0.6, 3.6, 2.1], [0.6, 1.2, 0.9], [0.55, 1.1, 0.82]), [
      int("seats", "Seats", 1, 4, 3, { sizes: { 1: { width_m: 0.95 }, 2: { width_m: 1.55 }, 3: { width_m: 2.1 }, 4: { width_m: 2.7 } } }),
      choice("arms", "Arms", ["none", "slim", "wide", "rolled"], "slim"),
      num("seat_h_m", "Seat height", 0.3, 0.55, 0.01, 0.44),
      choice("legs", "Legs", ["none", "block", "tapered", "metal"], "tapered"),
      int("cushions", "Back cushions", 0, 4, 3),
    ]),
  bed: kind("Bed", "furniture", "sleeping", null, ["Frame", "Bedding"], ["#6b4f3a", "#7f97ad"],
    sz([0.6, 2.3, 1.66], [1.0, 2.4, 2.2], [0.35, 2.0, 1.1]), [
      choice("size", "Size", ["twin", "double", "queen", "king", "crib", "bunk"], "queen", { sizes: {
        twin: { width_m: 1.13, depth_m: 2.1, height_m: 1.0 }, double: { width_m: 1.51, depth_m: 2.1, height_m: 1.05 },
        queen: { width_m: 1.66, depth_m: 2.2, height_m: 1.1 }, king: { width_m: 2.07, depth_m: 2.2, height_m: 1.15 },
        crib: { width_m: 0.8, depth_m: 1.42, height_m: 0.95 }, bunk: { width_m: 1.13, depth_m: 2.1, height_m: 1.7 } } }),
      choice("headboard", "Headboard", ["none", "panel", "slatted", "padded"], "padded"),
      bool("footboard", "Footboard", false),
      choice("base", "Base", ["frame", "platform"], "frame"),
    ]),
  other: kind("Box", "furniture", "other", null, ["Colour"], [BOX_COLOR], BOX_SIZE, []),
};

// The Build menu, in order. Tags and scanners (groups "tag" and "scanner")
// are in FURNITURE for the beacon screen, not here.
export const FURNITURE_KINDS = ["sofa", "bed", "other"];

const defOf = (k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(FURNITURE, k) ? FURNITURE[k] : null);

// ── recipes ──────────────────────────────────────────────────────────────────
function clampParam(s, v){
  if (s.type === "choice") {
    if (s.choices.includes(v)) return v;
    const t = typeof v === "string" ? v.trim().toLowerCase() : null;
    return t !== null && s.choices.includes(t) ? t : s.def;
  }
  if (s.type === "bool") {
    if (v === true || v === false) return v;
    if (v === "true" || v === 1 || v === "1") return true;
    if (v === "false" || v === 0 || v === "0") return false;
    return s.def;
  }
  const n = toNum(v);
  if (!Number.isFinite(n)) return s.def;
  const c = clamp(n, s.min, s.max);
  return s.type === "int" ? Math.round(c) : c;
}
function clampSize(v, range){
  const n = toNum(v);
  return Number.isFinite(n) ? clamp(n, range[0], range[1]) : range[2];
}
function clampColors(want, v){
  const src = Array.isArray(v) ? v : [];
  const out = want.map((c, i) => hexOf(src[i]) || c);
  for (let i = want.length; i < src.length; i++) { const c = hexOf(src[i]); if (c) out.push(c); }
  if (!out.length) out.push(BOX_COLOR);
  return out;
}

export function defaultRecipe(kind){
  const def = defOf(kind);
  if (!def) return clampRecipe({ kind });
  const params = {};
  for (const s of def.params) params[s.key] = s.def;
  return { kind, params, colors: def.colors.slice(), width_m: def.size.width_m[2], depth_m: def.size.depth_m[2],
           height_m: def.size.height_m[2] };
}

export function clampRecipe(recipe){
  const src = isObj(recipe) ? recipe : {};
  const out = plain(src);
  const raw = typeof src.kind === "string" && src.kind.trim() ? src.kind.trim() : "other";
  const def = defOf(raw.toLowerCase());
  out.kind = def ? raw.toLowerCase() : raw;
  const given = isObj(src.params) ? src.params : {};
  const params = plain(given);
  if (def) for (const s of def.params) params[s.key] = clampParam(s, given[s.key]);
  out.params = params;
  out.colors = clampColors(def ? def.colors : [], src.colors);
  const size = def ? def.size : BOX_SIZE;
  for (const k of DIMS) out[k] = clampSize(src[k], size[k]);
  return out;
}

export function pieceSize(recipe){
  const r = clampRecipe(recipe);
  return { w: r.width_m, d: r.depth_m, h: r.height_m };
}

// ── geometry: PadSpan's own rounded box, placing and merging ─────────────────
// Each face of the box: its normal axis and sign, then the two in-plane axes
// (axis, sign) with u × v = the normal, so every quad winds outward.
const FACES = [
  [0, 1, 2, -1, 1, 1], [0, -1, 2, 1, 1, 1], [1, 1, 0, 1, 2, -1],
  [1, -1, 0, 1, 2, 1], [2, 1, 0, 1, 1, 1], [2, -1, 0, -1, 1, 1],
];
// The grid lines along one axis: flat in the middle, and m steps on each
// rounded edge spaced so the steps turn by equal angles once rounded.
function gridLines(half, r, m){
  if (!(r > 0) || m === 0) return [-half, half];
  const inner = half - r, out = [];
  for (let k = m; k >= 1; k--) out.push(-inner - r * Math.tan(k * Math.PI / 4 / m));
  out.push(-inner);
  if (inner > 1e-6) out.push(inner);
  for (let k = 1; k <= m; k++) out.push(inner + r * Math.tan(k * Math.PI / 4 / m));
  return out;
}
// A box w × h × d centred on the origin with its edges rounded to r in m
// steps a half-arc (m = 0: sharp). UVs are metres along each face's longer
// side, so a wood grain runs along a board whatever its size.
function boxGeo(THREE, w, h, d, r, m){
  const half = [w / 2, h / 2, d / 2];
  r = m > 0 ? Math.min(r, half[0], half[1], half[2]) : 0;
  if (r < 1e-4) { r = 0; m = 0; }
  const inner = half.map((v) => v - r);
  const lines = half.map((v) => gridLines(v, r, m));
  const pos = [], nor = [], uv = [], idx = [];
  const p = [0, 0, 0], q = [0, 0, 0];
  for (const [na, ns, ua, us, va, vs] of FACES) {
    const lu = lines[ua], lv = lines[va], base = pos.length / 3;
    const swap = half[ua] < half[va];
    for (let j = 0; j < lv.length; j++) {
      for (let i = 0; i < lu.length; i++) {
        p[na] = ns * half[na]; p[ua] = us * lu[i]; p[va] = vs * lv[j];
        if (r > 0) {
          for (let k = 0; k < 3; k++) q[k] = clamp(p[k], -inner[k], inner[k]);
          const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2], len = Math.hypot(dx, dy, dz) || 1;
          pos.push(q[0] + dx / len * r, q[1] + dy / len * r, q[2] + dz / len * r);
          nor.push(dx / len, dy / len, dz / len);
        } else {
          pos.push(p[0], p[1], p[2]);
          nor.push(na === 0 ? ns : 0, na === 1 ? ns : 0, na === 2 ? ns : 0);
        }
        const a = lu[i] / TILE, b = lv[j] / TILE;
        uv.push(swap ? b : a, swap ? a : b);
      }
    }
    const nu = lu.length;
    for (let j = 0; j < lv.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, c = a + nu + 1, e = a + nu;
        idx.push(a, b, c, a, c, e);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function scaleUv(g, su, sv){
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * su, a.getY(i) * sv);
  return g;
}
function place(THREE, g, x, y, z, rot, scl){
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  if (rot) quat.setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0));
  m.compose(new THREE.Vector3(x, y, z), quat, scl ? new THREE.Vector3(scl[0], scl[1], scl[2]) : new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}
// One geometry from many, each already placed (position, normal, uv).
function merge(THREE, geos){
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
    else for (let i = 0; i < n; i++) idx[io++] = vo + i;
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ── looks: shared, counted materials and finishes ────────────────────────────
// A look is {c: "#rrggbb", f: finish}. Low draws flat colours; High a
// physically based material with the finish's pattern as a small greyscale
// texture made here, tinted by the colour.
const FINISH = {
  plain:  { r: 0.85, m: 0 },
  wood:   { r: 0.6, m: 0, tex: "wood" },
  fabric: { r: 0.97, m: 0, tex: "fabric" },
  metal:  { r: 0.36, m: 0.55, tex: "metal" },
  gloss:  { r: 0.22, m: 0 },
  soft:   { r: 0.75, m: 0 },
};
const CACHES = new WeakMap();           // per three.js instance: {mats, texs}
function cacheOf(THREE){
  let c = CACHES.get(THREE);
  if (!c) CACHES.set(THREE, c = { mats: new Map(), texs: new Map() });
  return c;
}
function release(e){
  if (--e.refs > 0) return;
  e.cache.delete(e.key);
  e.res.dispose();
  if (e.dep) release(e.dep);
}
// A small hash and periodic value noise: a pattern that tiles seamlessly.
function hash2(i, j, seed){ const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y, period, seed){
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash2(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function finishTexture(THREE, name){
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let t;
      if (name === "wood") {
        // Grain lines along u, wavering, with a few darker rings.
        const ring = v * 7 + 0.9 * noise(u * 4, v * 4, 4, 1) + 0.15 * noise(u * 16, v * 2, 16, 2);
        const band = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * ring), 3);
        t = 0.8 + 0.12 * (1 - band) + 0.08 * noise(u * 32, v * 8, 32, 3);
      } else if (name === "fabric") {
        // A fine weave over a soft mottle.
        const wx = 0.5 + 0.5 * Math.sin(2 * Math.PI * u * 32), wy = 0.5 + 0.5 * Math.sin(2 * Math.PI * v * 32);
        t = 0.84 + 0.07 * ((x + y) % 2 ? wx : wy) + 0.09 * noise(u * 8, v * 8, 8, 4);
      } else {
        // Brushed metal: thin streaks along u.
        t = 0.8 + 0.14 * noise(u * 2, v * 64, 64, 5) + 0.06 * noise(u * 8, v * 16, 16, 6);
      }
      const g = Math.round(255 * clamp(t, 0, 1)), i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function sharedTex(THREE, name){
  const C = cacheOf(THREE);
  let e = C.texs.get(name);
  if (!e) C.texs.set(name, e = { key: name, cache: C.texs, res: finishTexture(THREE, name), refs: 0, dep: null });
  e.refs++;
  return e;
}
function sharedMat(THREE, hi, look, held){
  const C = cacheOf(THREE), f = FINISH[look.f] ? look.f : "plain", F = FINISH[f];
  const key = (hi ? "h|" : "l|") + look.c + "|" + f;
  let e = C.mats.get(key);
  if (!e) {
    const dep = hi && F.tex ? sharedTex(THREE, F.tex) : null;
    const res = hi ? new THREE.MeshStandardMaterial({ color: look.c, roughness: F.r, metalness: F.m, map: dep ? dep.res : null })
      : new THREE.MeshLambertMaterial({ color: look.c });
    C.mats.set(key, e = { key, cache: C.mats, res, refs: 0, dep });
  }
  if (!held.has(e)) { held.add(e); e.refs++; }
  return e.res;
}
// A live part's own material: never shared, freed with its piece. Both kinds
// carry an emissive colour, so a glow or a warm screen is one number.
function ownMat(THREE, hi, look){
  const F = FINISH[look.f] || FINISH.plain;
  const m = hi ? new THREE.MeshStandardMaterial({ color: look.c, roughness: F.r, metalness: F.m, emissive: 0x000000 })
    : new THREE.MeshLambertMaterial({ color: look.c, emissive: 0x000000 });
  m.userData.ownPart = true;
  return m;
}

// ── the kit a builder draws with ─────────────────────────────────────────────
// Every primitive is placed in its target's frame and collected by look; at
// the end each look becomes one mesh. kit.at(obj) draws into a moving part
// (a fan's blades, a robot), kit.own(look, fn) makes one mesh with a
// material of its own (a live part).
function stepsFor(r, hi){ return r < 0.006 ? 0 : hi ? (r >= 0.03 ? 2 : 1) : (r >= 0.03 ? 1 : 0); }
function makeKit(THREE, quality, root){
  const hi = quality === "high";
  const sinks = new Map(), owns = [], held = new Set(), geos = [];
  const push = (target, look, g) => {
    const key = target.id + "|" + look.c + "|" + (look.f || "plain");
    let s = sinks.get(key);
    if (!s) sinks.set(key, s = { target, look, geos: [] });
    s.geos.push(g);
  };
  const api = (target, add) => ({
    hi,
    box(w, h, d, x, y, z, look, r = 0, rot = null){
      add(look, place(THREE, boxGeo(THREE, w, h, d, r, stepsFor(r, hi)), x, y, z, rot));
    },
    cyl(rt, rb, h, x, y, z, look, seg = 12, rot = null){
      const n = Math.max(5, Math.round(hi ? seg : seg * 0.6));
      const g = scaleUv(new THREE.CylinderGeometry(rt, rb, h, n, 1, false), 2 * Math.PI * Math.max(rt, rb) / TILE, h / TILE);
      g.clearGroups();
      add(look, place(THREE, g, x, y, z, rot));
    },
    ball(rad, x, y, z, look, scl = null, rot = null, seg = 14, cap = Math.PI){
      const ws = Math.max(6, Math.round(hi ? seg : seg * 0.6)), hs = Math.max(4, Math.round(ws * 0.7));
      const g = scaleUv(new THREE.SphereGeometry(rad, ws, hs, 0, Math.PI * 2, 0, cap), 2 * Math.PI * rad / TILE, Math.PI * rad / TILE);
      add(look, place(THREE, g, x, y, z, rot, scl));
    },
    at(obj){ return api(obj, (look, g) => push(obj, look, g)); },
    own(look, fn, parent = target){
      const list = [];
      fn(api(parent, (_l, g) => list.push(g)));
      const mesh = new THREE.Mesh(merge(THREE, list), ownMat(THREE, hi, look));
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      owns.push(mesh);
      return mesh;
    },
  });
  const kit = api(root, (look, g) => push(root, look, g));
  kit.finish = () => {
    for (const s of sinks.values()) {
      const mesh = new THREE.Mesh(merge(THREE, s.geos), sharedMat(THREE, hi, s.look, held));
      mesh.castShadow = mesh.receiveShadow = true;
      s.target.add(mesh);
      geos.push(mesh.geometry);
    }
    for (const m of owns) geos.push(m.geometry);
    return { held: [...held], geos, own: owns.map((m) => m.material), done: false };
  };
  return kit;
}

// ── the builders ─────────────────────────────────────────────────────────────
// Each draws one clamped recipe inside its box S = {w, d, h}: p its params,
// C its colours, parts the live parts it fills in.
const L = (c, f = "plain") => ({ c, f });
const LEG_WOOD = "#5e4431", LEG_DARK = "#2f2621", METAL = "#b9bec3";

function buildBox(K, S, p, C){
  K.box(S.w, S.h, S.d, 0, S.h / 2, 0, L(C[0]), Math.min(0.015, S.w / 4, S.d / 4, S.h / 4));
}

// Sofa: seats across the width between its arms, the back at −z.
function buildSofa(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const body = L(C[0], "fabric"), cush = L(C[1], "fabric");
  const armW = Math.min({ none: 0, slim: 0.1, wide: 0.22, rolled: 0.16 }[p.arms], W * 0.18);
  const legH = p.legs === "none" ? 0 : Math.min({ block: 0.07, tapered: 0.13, metal: 0.14 }[p.legs], H * 0.2);
  const backT = clamp(D * 0.22, 0.12, 0.26), seatD = D - backT;
  const cushT = clamp(H * 0.15, 0.08, 0.14);
  const baseTop = Math.max(Math.min(p.seat_h_m, H - 0.12) - cushT, legH + 0.05), seatTop = baseTop + cushT;
  const innerW = W - 2 * armW;
  K.box(W, baseTop - legH, D, 0, legH + (baseTop - legH) / 2, 0, body, 0.03);
  K.box(armW ? innerW + 0.02 : W, H - baseTop, backT, 0, baseTop + (H - baseTop) / 2, -D / 2 + backT / 2, body, 0.045);
  const cw = innerW / p.seats;
  for (let i = 0; i < p.seats; i++) {
    K.box(cw - 0.014, cushT, seatD - 0.01, -innerW / 2 + cw * (i + 0.5), baseTop + cushT / 2, backT / 2, cush, Math.min(0.05, cushT / 2));
  }
  const bh = Math.min(H - seatTop - 0.04, 0.55);
  if (p.cushions > 0 && bh > 0.1) {
    const bw = innerW / p.cushions;
    for (let i = 0; i < p.cushions; i++) {
      K.box(bw - 0.024, bh, 0.13, -innerW / 2 + bw * (i + 0.5), seatTop + bh / 2, -D / 2 + backT + 0.068, cush, 0.055, [-0.1, 0, 0]);
    }
  }
  if (armW) {
    const armTop = Math.min(seatTop + 0.2, H - 0.02);
    for (const s of [-1, 1]) {
      const ax = s * (W / 2 - armW / 2);
      if (p.arms === "rolled") {
        const rr = Math.min(armW * 0.62, (armTop - legH) / 2);
        K.box(armW, armTop - rr - legH, D, ax, legH + (armTop - rr - legH) / 2, 0, body, 0.03);
        K.cyl(rr, rr, D, s * (W / 2 - rr), armTop - rr, 0, body, 20, [Math.PI / 2, 0, 0]);
      } else {
        K.box(armW, armTop - legH, D, ax, legH + (armTop - legH) / 2, 0, body, p.arms === "wide" ? 0.07 : 0.035);
      }
    }
  }
  if (legH) {
    const lx = W / 2 - 0.06, lz = D / 2 - 0.06;
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
      if (p.legs === "block") K.box(0.07, legH, 0.07, sx * lx, legH / 2, sz2 * lz, L(LEG_DARK, "wood"));
      else if (p.legs === "tapered") K.cyl(0.025, 0.013, legH, sx * lx, legH / 2, sz2 * lz, L(LEG_WOOD, "wood"), 10);
      else K.cyl(0.011, 0.011, legH, sx * lx, legH / 2, sz2 * lz, L(METAL, "metal"), 8);
    }
  }
}

// Bed: the head at −z (pillows and headboard), the foot toward +z.
function bedding(K, x, zc, mw, ml, base, mattH, C, pillows){
  const top = base + mattH;
  K.box(mw, mattH, ml, x, base + mattH / 2, zc, L("#efece4", "fabric"), Math.min(0.05, mattH / 2));
  const duvL = ml * 0.72, drape = Math.min(0.17, mattH * 0.8);
  K.box(mw + 0.05, drape + 0.04, duvL, x, top + 0.04 - (drape + 0.04) / 2, zc + ml / 2 - duvL / 2 + 0.02, L(C[1], "fabric"), 0.03);
  K.box(mw + 0.055, 0.045, 0.2, x, top + 0.025, zc + ml / 2 - duvL + 0.12, L(lighten(C[1], 0.35), "fabric"), 0.02);
  if (!pillows) return;
  const pw = (mw - 0.12) / pillows - 0.03;
  for (let i = 0; i < pillows; i++) {
    K.box(pw, 0.12, 0.4, x - mw / 2 + 0.06 + (pw + 0.03) * (i + 0.5) + 0.015 * (pillows - 1), top + 0.055, zc - ml / 2 + 0.27,
          L(lighten(C[1], 0.55), "fabric"), 0.055);
  }
}
function buildBed(K, S, p, C){
  if (p.size === "crib") return buildCrib(K, S, p, C);
  if (p.size === "bunk") return buildBunk(K, S, p, C);
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood");
  const hbD = Math.min({ none: 0, panel: 0.05, slatted: 0.06, padded: 0.1 }[p.headboard], D * 0.08);
  const fbD = p.footboard ? 0.05 : 0;
  const zb = -D / 2 + hbD, zf = D / 2 - fbD, Lz = zf - zb, zc = (zb + zf) / 2;
  const rim = clamp(W * 0.04, 0.03, 0.06), mw = W - 2 * rim, ml = Lz - 2 * rim;
  // The mattress top at its usual height under a headboard (which takes the
  // rest of the Height); with none, the bed itself is the Height.
  const platform = p.base === "platform", usual = platform ? 0.5 : 0.56;
  const mattTop = p.headboard === "none" ? H - 0.12 : Math.min(usual, H - 0.12);
  const mattH = 0.22 * Math.min(1, mattTop / usual), baseTop = mattTop - mattH;
  if (platform) {
    const toe = Math.min(0.08, baseTop * 0.3);
    K.box(W, baseTop - toe, Lz, 0, toe + (baseTop - toe) / 2, zc, frame, 0.02);
    K.box(W - 0.2, toe, Lz - 0.2, 0, toe / 2, zc, L("#26211d"));
  } else {
    const railH = Math.min(0.16, baseTop * 0.5), legH = baseTop - railH;
    K.box(W, railH, Lz, 0, legH + railH / 2, zc, frame, 0.015);
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(0.07, legH, 0.07, sx * (W / 2 - 0.05), legH / 2, zc + sz2 * (Lz / 2 - 0.05), frame);
  }
  bedding(K, 0, zc, mw, ml, baseTop, mattH, C, p.size === "twin" ? 1 : 2);
  const zh = -D / 2 + hbD / 2;
  if (p.headboard === "panel") K.box(W, H, hbD, 0, H / 2, zh, frame, 0.015);
  else if (p.headboard === "padded") {
    K.box(W, H - 0.06, hbD, 0, 0.06 + (H - 0.06) / 2, zh, L(C[0], "fabric"), 0.045);
    for (const s of [-1, 1]) K.box(0.05, 0.06, hbD * 0.6, s * (W / 2 - 0.08), 0.03, zh, L(LEG_DARK, "wood"));
  } else if (p.headboard === "slatted") {
    for (const s of [-1, 1]) K.box(0.06, H, hbD, s * (W / 2 - 0.03), H / 2, zh, frame, 0.01);
    K.box(W, 0.06, hbD, 0, H - 0.03, zh, frame, 0.01);
    const ns = Math.max(3, Math.round(W / 0.17)), top = H - 0.06, sh = top - baseTop;
    if (sh > 0.05) for (let i = 0; i < ns; i++) K.box(0.045, sh, hbD * 0.5, -(W - 0.12) / 2 + (W - 0.12) * (i + 0.5) / ns, baseTop + sh / 2, zh, frame);
  }
  if (p.footboard) { const fh = Math.min(mattTop + 0.12, H); K.box(W, fh, fbD, 0, fh / 2, D / 2 - fbD / 2, frame, 0.015); }
}
// A crib: bars all round, a low mattress, no pillow.
function buildCrib(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), post = 0.05;
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(post, H, post, sx * (W / 2 - post / 2), H / 2, sz2 * (D / 2 - post / 2), frame, 0.008);
  const baseTop = clamp(H * 0.32, 0.12, 0.42), mattH = Math.min(0.1, baseTop * 0.5);
  K.box(W - 0.06, 0.04, D - 0.06, 0, baseTop - 0.02, 0, frame);
  bedding(K, 0, 0, W - 0.12, D - 0.12, baseTop, mattH, C, 0);
  const lo = baseTop - 0.04, hi = H - 0.04, barH = hi - lo;
  for (const sz2 of [-1, 1]) {
    K.box(W - 2 * post, 0.04, 0.035, 0, H - 0.02, sz2 * (D / 2 - post / 2), frame, 0.008);
    K.box(W - 2 * post, 0.04, 0.035, 0, lo, sz2 * (D / 2 - post / 2), frame);
    const n = clamp(Math.round((W - 2 * post) / 0.09), 3, 16);
    for (let i = 0; i < n; i++) K.box(0.022, barH, 0.022, -(W / 2 - post) + (W - 2 * post) * (i + 0.5) / n, lo + barH / 2, sz2 * (D / 2 - post / 2), frame);
  }
  for (const sx of [-1, 1]) {
    K.box(0.035, 0.04, D - 2 * post, sx * (W / 2 - post / 2), H - 0.02, 0, frame, 0.008);
    K.box(0.035, 0.04, D - 2 * post, sx * (W / 2 - post / 2), lo, 0, frame);
    const n = clamp(Math.round((D - 2 * post) / 0.09), 3, 16);
    for (let i = 0; i < n; i++) K.box(0.022, barH, 0.022, sx * (W / 2 - post / 2), lo + barH / 2, -(D / 2 - post) + (D - 2 * post) * (i + 0.5) / n, frame);
  }
}
// A bunk bed: two beds on four posts, the ladder up the right side at the foot.
function buildBunk(K, S, p, C){
  const { w: W, d: D, h: H } = S;
  const frame = L(C[0], "wood"), post = 0.07;
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) K.box(post, H, post, sx * (W / 2 - post / 2), H / 2, sz2 * (D / 2 - post / 2), frame, 0.01);
  const mattH = Math.min(0.16, H * 0.1), railH = Math.min(0.1, H * 0.08);
  const lowBase = clamp(H * 0.18, railH, 0.3);
  const upTop = H - Math.max(0.12, Math.min(0.28, H * 0.18)), upBase = Math.max(upTop - mattH, lowBase);
  const ml = D - 2 * post - 0.06, mw = W - 2 * post - 0.02;
  for (const base of [lowBase, upBase]) {
    K.box(W - 2 * post, railH, D - 2 * post, 0, base - railH / 2, 0, frame, 0.01);
    bedding(K, 0, -0.02, mw, ml, base, mattH, C, 1);
    const bh = Math.min(0.16, H - base - 0.005);
    for (const sz2 of [-1, 1]) K.box(W - 2 * post, bh, 0.03, 0, base + bh / 2, sz2 * (D / 2 - post / 2), frame, 0.008);
  }
  // The top bunk's guard rails, left open on the right where the ladder comes up.
  const gy = H - 0.03, ladW = Math.min(0.42, (D - 2 * post) * 0.4);
  K.box(0.04, 0.06, D - 2 * post, -(W / 2 - post / 2), gy, 0, frame, 0.01);
  const openL = D - 2 * post - ladW - 0.06;
  if (openL > 0.1) K.box(0.04, 0.06, openL, W / 2 - post / 2, gy, -(D / 2 - post) + openL / 2, frame, 0.01);
  const lx = W / 2 - 0.02, z0 = D / 2 - post - ladW;
  for (const z of [z0 + 0.015, z0 + ladW - 0.015]) K.box(0.03, upTop, 0.03, lx, upTop / 2, z, frame);
  const rungs = Math.max(2, Math.floor((upTop - 0.2) / 0.28));
  for (let i = 1; i <= rungs; i++) K.cyl(0.014, 0.014, ladW - 0.03, lx, i * (upTop / (rungs + 1)), z0 + ladW / 2, L(METAL, "metal"), 8, [Math.PI / 2, 0, 0]);
}

const BUILDERS = { sofa: buildSofa, bed: buildBed, other: buildBox };

// ── building and freeing ─────────────────────────────────────────────────────
function build(THREE, quality, fn, S, p, C, meta){
  const group = new THREE.Group();
  const parts = {};
  const kit = makeKit(THREE, quality, group);
  fn(kit, S, p, C, parts, THREE);
  const res = kit.finish();
  group.userData = { ...meta, size: S, quality, parts, pieceRes: res };
  return group;
}

export function buildPiece(THREE, recipe, opts){
  const r = clampRecipe(recipe);
  const quality = opts && opts.quality === "high" ? "high" : "low";
  const S = { w: r.width_m, d: r.depth_m, h: r.height_m };
  const fn = defOf(r.kind) ? BUILDERS[r.kind] || buildBox : buildBox;
  try {
    return build(THREE, quality, fn, S, r.params, r.colors, { kind: r.kind, recipe: r, fallback: fn === buildBox && r.kind !== "other" });
  } catch (e) {
    console.warn("Live Aboard: a piece drawn as a box", r.kind, e);
    return build(THREE, quality, buildBox, S, r.params, r.colors, { kind: r.kind, recipe: r, fallback: true });
  }
}

export function disposePiece(group){
  const res = group && group.userData && group.userData.pieceRes;
  if (!res || res.done) return;
  res.done = true;
  for (const g of res.geos) g.dispose();
  for (const m of res.own) m.dispose();
  for (const e of res.held) release(e);
  res.geos = []; res.own = []; res.held = [];
}

// ── the people figure ────────────────────────────────────────────────────────
// Stylised, Sims-like, never a likeness: height, build, hair, colours, and
// glasses or a cap. No face beyond two dots for eyes, which show where it faces.
export const FIGURE = {
  name: "Person",
  params: [
    num("height_m", "Height", 1.0, 2.1, 0.01, 1.75),
    choice("build", "Build", ["slim", "medium", "broad"], "medium"),
    choice("hair", "Hair", ["none", "short", "long", "bun"], "short"),
    bool("glasses", "Glasses", false),
    bool("hat", "Cap", false),
  ],
  colorNames: { hair: "Hair", skin: "Skin", top: "Top", bottom: "Bottom" },
  colors: { hair: "#3a2a1a", skin: "#c8956d", top: "#224466", bottom: "#333333" },
};

function clampFigure(params){
  const src = isObj(params) ? params : {};
  const out = {};
  for (const s of FIGURE.params) out[s.key] = clampParam(s, src[s.key]);
  const cols = isObj(src.colors) ? src.colors : {};
  out.colors = {};
  for (const [k, c] of Object.entries(FIGURE.colors)) out.colors[k] = hexOf(cols[k]) || c;
  return out;
}

function drawFigure(K, S, p){
  const H = p.height_m, c = p.colors;
  const skin = L(c.skin, "soft"), top = L(c.top, "fabric"), bottom = L(c.bottom, "fabric"), hair = L(c.hair, "soft");
  const shoe = L("#2a2624", "soft"), dark = L("#1d1d1f", "gloss");
  const tw = { slim: 0.2, medium: 0.23, broad: 0.27 }[p.build] * H, td = { slim: 0.12, medium: 0.13, broad: 0.15 }[p.build] * H;
  const legR = tw * 0.17, hip = 0.48 * H, ankle = 0.035 * H;
  for (const s of [-1, 1]) {
    K.cyl(legR, legR * 0.85, hip - ankle, s * tw * 0.24, ankle + (hip - ankle) / 2, 0, bottom, 12);
    K.box(legR * 2.1, ankle, legR * 2 + ankle, s * tw * 0.24, ankle / 2, ankle / 2, shoe, 0.012 * H);
  }
  K.box(tw, 0.08 * H, td, 0, 0.46 * H + 0.04 * H, 0, bottom, 0.03 * H);
  K.box(tw, 0.3 * H, td, 0, 0.5 * H + 0.15 * H, 0, top, 0.035 * H);
  const armR = 0.03 * H, ax = tw / 2 + armR + 0.004 * H;
  for (const s of [-1, 1]) {
    K.cyl(armR, armR * 0.9, 0.18 * H, s * ax, 0.69 * H, 0, top, 10);
    K.cyl(armR * 0.85, armR * 0.75, 0.15 * H, s * ax, 0.525 * H, 0, skin, 10);
    K.ball(0.03 * H, s * ax, 0.445 * H, 0, skin, null, null, 10);
  }
  K.cyl(0.035 * H, 0.04 * H, 0.05 * H, 0, 0.82 * H, 0, skin, 12);
  const hr = 0.075 * H, hy = 0.9 * H;
  K.ball(hr, 0, hy, 0, skin, null, null, 18);
  for (const s of [-1, 1]) K.ball(0.009 * H, s * 0.027 * H, hy + 0.008 * H, hr * 0.93, dark, null, null, 8);
  if (p.hair !== "none") {
    K.ball(hr * 1.07, 0, hy + 0.004 * H, -0.004 * H, hair, null, [-0.45, 0, 0], 18, Math.PI * 0.55);
    if (p.hair === "long") K.box(hr * 1.9, 0.15 * H, 0.035 * H, 0, hy - 0.06 * H, -hr * 0.78, hair, 0.015 * H);
    if (p.hair === "bun") K.ball(0.035 * H, 0, hy + hr * 0.75, -hr * 0.75, hair, null, null, 12);
  }
  if (p.glasses) {
    K.box(hr * 1.5, 0.022 * H, 0.006 * H, 0, hy + 0.008 * H, hr * 0.98, dark);
  }
  if (p.hat) {
    K.ball(hr * 1.1, 0, hy + 0.006 * H, 0, L(c.top, "fabric"), [1, 0.92, 1], [-0.25, 0, 0], 18, Math.PI * 0.48);
    K.box(hr * 1.3, 0.008 * H, hr * 0.8, 0, hy + hr * 0.42, hr * 1.1, L(c.top, "fabric"));
  }
}

export function buildFigure(THREE, params, opts){
  const p = clampFigure(params);
  const quality = opts && opts.quality === "high" ? "high" : "low";
  const H = p.height_m, S = { w: 0.42 * H, d: 0.24 * H, h: H };
  return build(THREE, quality, (K) => drawFigure(K, S, p), S, p, [], { kind: "figure", recipe: p, fallback: false });
}
