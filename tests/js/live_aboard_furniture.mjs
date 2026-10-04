// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Live Aboard's furniture builders (views/live_aboard_furniture.js), run for
// real with the bundled three.js.
//
//   api      the exports, FURNITURE well-formed (defaults inside ranges,
//            categories and groups from the closed lists, size hints valid)
//   recipe   defaultRecipe complete; clampRecipe keeps unknown keys, clamps
//            numbers, fixes bad choices and colours, never refuses
//   build    every kind across its parameter range (each number at min, mid
//            and max, each choice, each yes/no, the smallest and biggest box,
//            seeded mixes), Low and High: no throw, a finite non-empty box
//            inside width × depth × height (+1 mm), no face turned inward,
//            the triangle budget, the live parts its kind needs
//   front    the front toward +z where a kind has one
//   unknown  an unknown kind is a box of its size
//   dispose  what a piece made is freed; a shared look only once no piece
//            uses it, so nothing outlives the pieces
//   figure   the people figure across its range, feet at 0, facing +z
//
// usage: live_aboard_furniture.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...], stats: {...} }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: live_aboard_furniture.mjs <www/padspan-ha dir>"); process.exit(2); }
const THREE = await import(pathToFileURL(join(WWW, "vendor", "three", "three.module.min.js")).href);
const F = await import(pathToFileURL(join(WWW, "views", "live_aboard_furniture.js")).href);

const failures = [];
const cases = {};
const stats = {};
const check = (name, ok, detail) => {
  cases[name] = (cases[name] ?? true) && !!ok;
  if (!ok && failures.length < 400) failures.push({ name, detail: detail === undefined ? null : detail });
};
const tryCase = (name, fn) => { try { fn(); } catch (e) { check(name, false, String(e && e.stack || e).slice(0, 900)); } };

const CATEGORIES = ["seating", "sleeping", "tables", "storage", "lighting", "media", "decor", "outdoor", "appliance", "kids",
                    "pets", "office", "bath", "kitchen", "device", "other"];
const GROUPS = ["furniture", "device", "tag", "scanner"];
const LIVE = { glow: "glow", screen: "screen", spin: "spin", run: "run", dock: "dock", warm: "warm", charge: "glow" };
const PART_KEYS = ["glow", "screen", "spin", "run", "dock", "warm"];
const STARTERS = ["sofa", "bed", "table", "chair", "desk", "dresser", "tv", "lamp"];
const DIMS = ["width_m", "depth_m", "height_m"];
const BUDGET = { low: 1500, high: 5000 };
const EPS = 1e-3;

// ── api ─────────────────────────────────────────────────────────────────────
tryCase("api: the exports are there", () => {
  const want = { FURNITURE_KINDS: "object", FURNITURE: "object", defaultRecipe: "function", clampRecipe: "function",
                 pieceSize: "function", buildPiece: "function", disposePiece: "function", FIGURE: "object", buildFigure: "function" };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, typeof F[k]]));
  check("api: the exports are there", JSON.stringify(got) === JSON.stringify(want), got);
});
tryCase("api: the Build menu", () => {
  const k = F.FURNITURE_KINDS;
  const bad = k.filter((x) => !F.FURNITURE[x] || !["furniture", "device"].includes(F.FURNITURE[x].group));
  const starters = STARTERS.filter((s) => F.FURNITURE[s]);
  check("api: the Build menu", Array.isArray(k) && new Set(k).size === k.length && !bad.length
    && JSON.stringify(k.slice(0, starters.length)) === JSON.stringify(starters) && k.includes("other"), { k, bad });
});
const paramOk = (s) => {
  const base = typeof s.key === "string" && /^[a-z][a-z0-9_]*$/.test(s.key) && typeof s.label === "string" && s.label.length > 0;
  if (s.type === "int" || s.type === "num") {
    return base && Number.isFinite(s.min) && Number.isFinite(s.max) && s.min < s.max && s.step > 0 && s.def >= s.min && s.def <= s.max
      && (s.type === "num" || (Number.isInteger(s.min) && Number.isInteger(s.max) && Number.isInteger(s.def) && s.step === 1));
  }
  if (s.type === "choice") return base && Array.isArray(s.choices) && s.choices.length >= 2 && s.choices.includes(s.def)
    && s.choices.every((c) => typeof c === "string" && /^[a-z][a-z0-9 -]*$/.test(c));
  if (s.type === "bool") return base && typeof s.def === "boolean";
  return false;
};
for (const [kind, def] of Object.entries(F.FURNITURE)) {
  tryCase(`api: ${kind} is well-formed`, () => {
    const name = `api: ${kind} is well-formed`;
    check(name, typeof def.name === "string" && def.name.length > 0, "name");
    check(name, GROUPS.includes(def.group), def.group);
    check(name, CATEGORIES.includes(def.category), def.category);
    check(name, def.live === null || Object.keys(LIVE).includes(def.live), def.live);
    check(name, def.group === "furniture" ? true : def.live === null || def.group === "device", "only devices have live");
    check(name, Array.isArray(def.colors) && def.colors.length >= 1 && def.colors.every((c) => /^#[0-9a-f]{6}$/.test(c))
      && Array.isArray(def.colorNames) && def.colorNames.length === def.colors.length, def.colors);
    for (const k of DIMS) {
      const r = def.size[k];
      check(name, Array.isArray(r) && r.length === 3 && r[0] > 0 && r[0] < r[1] && r[2] >= r[0] && r[2] <= r[1], { k, r });
    }
    check(name, Array.isArray(def.params) && def.params.length <= 8, "one screen of sliders");
    const keys = new Set();
    for (const s of def.params) {
      check(name, paramOk(s), s);
      check(name, !keys.has(s.key), `duplicate ${s.key}`);
      keys.add(s.key);
      check(name, !DIMS.includes(s.key), `${s.key} restates a size`);
      if (s.sizes) {
        for (const [v, hint] of Object.entries(s.sizes)) {
          const okV = s.type === "choice" ? s.choices.includes(v) : Number.isInteger(+v) && +v >= s.min && +v <= s.max;
          check(name, okV, { key: s.key, v });
          for (const [dk, dv] of Object.entries(hint)) {
            check(name, DIMS.includes(dk) && dv >= def.size[dk][0] && dv <= def.size[dk][1], { key: s.key, v, dk, dv });
          }
        }
      }
    }
    JSON.stringify(def);   // plain data
  });
}

// ── recipe ──────────────────────────────────────────────────────────────────
tryCase("recipe: defaultRecipe has every default", () => {
  for (const [kind, def] of Object.entries(F.FURNITURE)) {
    const r = F.defaultRecipe(kind);
    const okP = def.params.every((s) => r.params[s.key] === s.def) && Object.keys(r.params).length === def.params.length;
    check("recipe: defaultRecipe has every default", r.kind === kind && okP && JSON.stringify(r.colors) === JSON.stringify(def.colors)
      && DIMS.every((k) => r[k] === def.size[k][2]) && JSON.stringify(F.clampRecipe(r)) === JSON.stringify(r), { kind, r });
  }
});
tryCase("recipe: clampRecipe keeps what it does not know", () => {
  const src = { kind: "sofa", params: { seats: 2, mystery: { a: [1, 2] }, glow: "x" }, colors: ["#112233", "#445566", "#778899"],
                width_m: 2, depth_m: 0.9, height_m: 0.8, details: { title: "Grey sofa", rooms: ["living"] }, later: 7 };
  const before = JSON.stringify(src);
  const r = F.clampRecipe(src);
  check("recipe: clampRecipe keeps what it does not know", r.params.mystery.a[1] === 2 && r.params.glow === "x" && r.later === 7
    && r.details.title === "Grey sofa" && r.details.rooms[0] === "living" && r.colors.length === 3 && r.colors[2] === "#778899"
    && JSON.stringify(src) === before && r.params !== src.params, r);
});
tryCase("recipe: clampRecipe clamps numbers and fixes choices", () => {
  const def = F.FURNITURE.sofa;
  const r = F.clampRecipe({ kind: "Sofa ", params: { seats: 99, arms: "Rolled", seat_h_m: "0.4", legs: "gold", cushions: 2.6 },
                            colors: ["#ABC", "red"], width_m: -3, depth_m: "deep", height_m: 1e9 });
  check("recipe: clampRecipe clamps numbers and fixes choices", r.kind === "sofa" && r.params.seats === 4 && r.params.arms === "rolled"
    && r.params.seat_h_m === 0.4 && r.params.legs === def.params.find((s) => s.key === "legs").def && r.params.cushions === 3
    && r.colors[0] === "#aabbcc" && r.colors[1] === def.colors[1] && r.width_m === def.size.width_m[0]
    && r.depth_m === def.size.depth_m[2] && r.height_m === def.size.height_m[1], r);
  const b = F.clampRecipe({ kind: "bed", params: { footboard: "true", size: null } });
  check("recipe: clampRecipe clamps numbers and fixes choices", b.params.footboard === true && b.params.size === "queen", b);
  const n = F.clampRecipe({ kind: "sofa", params: { seats: NaN, seat_h_m: Infinity }, width_m: NaN });
  check("recipe: clampRecipe clamps numbers and fixes choices", n.params.seats === 3 && n.params.seat_h_m === 0.44
    && n.width_m === def.size.width_m[2] && JSON.stringify(n).indexOf("null") < 0, n);
});
tryCase("recipe: nothing is ever refused", () => {
  for (const bad of [null, undefined, 42, "sofa", [], { kind: 7 }, { kind: "" }, { kind: "constructor" }, { kind: "__proto__" },
                     { kind: "toString", params: [], colors: "x" }, JSON.parse('{"kind":"sofa","__proto__":{"x":1},"params":{"__proto__":{"y":2}}}')]) {
    const r = F.clampRecipe(bad);
    const ok = r && typeof r.kind === "string" && DIMS.every((k) => Number.isFinite(r[k]) && r[k] > 0)
      && Array.isArray(r.colors) && r.colors.length >= 1 && typeof r.params === "object" && !Array.isArray(r.params)
      && Object.getPrototypeOf(r) === Object.prototype && Object.getPrototypeOf(r.params) === Object.prototype;
    check("recipe: nothing is ever refused", ok, { bad: String(bad && JSON.stringify(bad)), r });
    const g = F.buildPiece(THREE, bad, { quality: "low" });
    check("recipe: nothing is ever refused", g && g.isGroup, String(bad));
    F.disposePiece(g);
  }
});
tryCase("recipe: pieceSize is the clamped box", () => {
  const s = F.pieceSize({ kind: "bed", width_m: 50, depth_m: 1.9, height_m: "x" });
  const d = F.FURNITURE.bed.size;
  check("recipe: pieceSize is the clamped box", s.w === d.width_m[1] && s.d === 1.9 && s.h === d.height_m[2], s);
});
tryCase("recipe: clamping twice changes nothing", () => {
  let n = 0;
  for (const kind of Object.keys(F.FURNITURE)) {
    for (const [, r] of variants(kind)) {
      const a = F.clampRecipe(r), b = F.clampRecipe(a);
      if (JSON.stringify(a) !== JSON.stringify(b)) { check("recipe: clamping twice changes nothing", false, { kind, a, b }); return; }
      n++;
    }
  }
  check("recipe: clamping twice changes nothing", n > 0, n);
});

// ── build ───────────────────────────────────────────────────────────────────
function rng(seed){ let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function variants(kind){
  const def = F.FURNITURE[kind], base = F.defaultRecipe(kind), out = [["default", base]];
  const valsOf = (s) => s.type === "choice" ? s.choices : s.type === "bool" ? [false, true]
    : [s.min, s.type === "int" ? Math.round((s.min + s.max) / 2) : (s.min + s.max) / 2, s.max];
  const withP = (r, k, v) => ({ ...r, params: { ...r.params, [k]: v } });
  for (const s of def.params) for (const v of valsOf(s)) out.push([`${s.key}=${v}`, withP(base, s.key, v)]);
  for (const k of DIMS) {
    const [mn, mx] = def.size[k];
    for (const v of [mn, (mn + mx) / 2, mx]) out.push([`${k}=${+v.toFixed(4)}`, { ...base, [k]: v }]);
  }
  const box = (r, end) => ({ ...r, ...Object.fromEntries(DIMS.map((k) => [k, def.size[k][end]])) });
  // Every choice and yes/no in the smallest and the biggest box.
  for (const s of def.params) {
    if (s.type !== "choice" && s.type !== "bool") continue;
    for (const v of valsOf(s)) { out.push([`${s.key}=${v} small`, box(withP(base, s.key, v), 0)]); out.push([`${s.key}=${v} big`, box(withP(base, s.key, v), 1)]); }
  }
  const ends = (end) => {
    const p = {};
    for (const s of def.params) p[s.key] = s.type === "choice" ? s.choices[end ? s.choices.length - 1 : 0] : s.type === "bool" ? !!end : end ? s.max : s.min;
    return box({ ...base, params: p }, end);
  };
  out.push(["all min", ends(0)], ["all max", ends(1)]);
  const R = rng(kind.length * 7919 + kind.charCodeAt(0));
  for (let i = 0; i < 16; i++) {
    const p = {};
    for (const s of def.params) {
      const vs = valsOf(s);
      p[s.key] = s.type === "num" ? s.min + (s.max - s.min) * R() : s.type === "int" ? s.min + Math.floor(R() * (s.max - s.min + 1)) : vs[Math.floor(R() * vs.length)];
    }
    const r = { ...base, params: p };
    for (const k of DIMS) r[k] = def.size[k][0] + (def.size[k][1] - def.size[k][0]) * R();
    out.push([`mix ${i}`, r]);
  }
  return out;
}

function meshesOf(g){ const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; }
function trianglesOf(g){ let n = 0; for (const m of meshesOf(g)) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; return n; }
function boundsOf(g){ g.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g); }
// Faces turned inward: a triangle whose winding disagrees with its own normals.
function inwardFaces(g){
  let bad = 0, total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  for (const m of meshesOf(g)) {
    const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal, idx = m.geometry.index;
    if (!pos || !nor || !m.geometry.attributes.uv) return { bad: -1, total };
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      if (ia >= pos.count || ib >= pos.count || ic >= pos.count) return { bad: -2, total };
      a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
      t.subVectors(c, b); n.subVectors(a, b).cross(t);      // (a-b) × (c-b) = -(b-a) × (c-a)
      const area = n.length();
      if (area < 1e-10) continue;
      total++;
      const vn = new THREE.Vector3().fromBufferAttribute(nor, ia).add(t.fromBufferAttribute(nor, ib)).add(new THREE.Vector3().fromBufferAttribute(nor, ic));
      if (-n.dot(vn) < 0) bad++;
    }
  }
  return { bad, total };
}
function partsOk(def, parts){
  const keys = Object.keys(parts);
  if (!keys.every((k) => PART_KEYS.includes(k))) return false;
  if (def.live === null) return keys.length === 0;
  const k = LIVE[def.live], v = parts[k];
  if (k === "glow" || k === "warm") return Array.isArray(v) && v.length > 0 && v.every((m) => m.isMesh && m.material.userData.ownPart);
  if (k === "screen") return v && v.isMesh && v.material.userData.ownPart;
  return v && v.isObject3D && meshesOf(v).length > 0;
}

for (const kind of Object.keys(F.FURNITURE)) {
  const def = F.FURNITURE[kind];
  const st = stats[kind] = { builds: 0, low: 0, high: 0 };
  tryCase(`build: ${kind}`, () => {
    for (const [label, recipe] of variants(kind)) {
      for (const quality of ["low", "high"]) {
        const where = `${label} (${quality})`;
        let g;
        try { g = F.buildPiece(THREE, recipe, { quality }); } catch (e) { check(`build: ${kind}`, false, { where, e: String(e.stack || e).slice(0, 500) }); continue; }
        st.builds++;
        const s = F.pieceSize(recipe), bb = boundsOf(g);
        const fin = [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].every(Number.isFinite);
        check(`build: ${kind}`, g.userData.fallback === false, { where, fallback: true });
        check(`build: ${kind}`, fin && !bb.isEmpty() && bb.max.x - bb.min.x > 0 && bb.max.y - bb.min.y > 0 && bb.max.z - bb.min.z > 0, { where, bb });
        const inside = bb.min.x >= -s.w / 2 - EPS && bb.max.x <= s.w / 2 + EPS && bb.min.z >= -s.d / 2 - EPS && bb.max.z <= s.d / 2 + EPS
          && bb.min.y >= -EPS && bb.max.y <= s.h + EPS;
        check(`build: ${kind}`, inside, { where, s, min: bb.min, max: bb.max });
        const free = kind === "tv" && F.clampRecipe(recipe).params.unit === "none";   // a TV alone keeps its screen size
        const fills = free || (bb.max.x - bb.min.x >= s.w * 0.5 && bb.max.z - bb.min.z >= s.d * 0.5 && bb.max.y - bb.min.y >= s.h * 0.5);
        check(`build: ${kind}`, fills, { where, s, min: bb.min, max: bb.max });
        const tris = trianglesOf(g);
        st[quality] = Math.max(st[quality], tris);
        check(`build: ${kind}`, tris <= BUDGET[quality], { where, tris });
        const inw = inwardFaces(g);
        check(`build: ${kind}`, inw.bad === 0 && inw.total > 0, { where, inw });
        check(`build: ${kind}`, partsOk(def, g.userData.parts), { where, parts: Object.keys(g.userData.parts) });
        check(`build: ${kind}`, meshesOf(g).length <= 14, { where, meshes: meshesOf(g).length });
        F.disposePiece(g);
      }
    }
  });
}

// ── front ───────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
function hitFrom(g, origin, dir){
  g.updateMatrixWorld(true);
  ray.set(origin, dir);
  ray.far = 100;
  const h = ray.intersectObject(g, true);
  return h.length ? h[0] : null;
}
const topAt = (g, x, z) => { const h = hitFrom(g, new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0)); return h ? h.point.y : -Infinity; };
const sameColour = (m, hex) => {
  const want = new THREE.Color(hex), c = m.material.color;
  return Math.abs(c.r - want.r) < 2e-3 && Math.abs(c.g - want.g) < 2e-3 && Math.abs(c.b - want.b) < 2e-3;
};
// The colour of the first thing a ray along z meets at (x, y): dir 1 comes from +z.
function colourFrom(g, x, y, dir){
  const h = hitFrom(g, new THREE.Vector3(x, y, dir * 20), new THREE.Vector3(0, 0, -dir));
  return h ? h.object.material.color.getHexString() : null;
}
// The share of rays along z over a grid of (x, y) whose first colour passes test.
function shows(g, xs, ys, dir, test){
  let n = 0, ok = 0;
  for (const x of xs) for (const y of ys) { const c = colourFrom(g, x, y, dir); if (c === null) continue; n++; if (test(c)) ok++; }
  return n ? ok / n : 0;
}
// How much deeper rays reach from +z than from −z, on average (metres).
function depthBias(g, s, xs, ys){
  let n = 0, sum = 0;
  for (const x of xs) for (const y of ys) {
    const f = hitFrom(g, new THREE.Vector3(x, y, 20), new THREE.Vector3(0, 0, -1)), b = hitFrom(g, new THREE.Vector3(x, y, -20), new THREE.Vector3(0, 0, 1));
    if (!f || !b) continue;
    n++; sum += (s.d / 2 - f.point.z) - (b.point.z + s.d / 2);
  }
  return n ? sum / n : 0;
}
const frontHitZ = (g, x, y) => { const h = hitFrom(g, new THREE.Vector3(x, y, 20), new THREE.Vector3(0, 0, -1)); return h ? h.point.z : Infinity; };
function centreOfColour(g, hex){
  g.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const m of meshesOf(g)) if (sameColour(m, hex)) box.expandByObject(m);
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}
// A front probe per kind: true when the front faces +z. null: no front.
const FRONT = {
  // The back is the tall part at −z: straight down near the back hits higher than near the front.
  sofa: (g, s) => Math.max(...[-0.2, 0, 0.2].map((f) => topAt(g, f * s.w, -s.d / 2 + 0.03)))
    > Math.max(...[-0.2, 0, 0.2].map((f) => topAt(g, f * s.w, s.d / 2 - 0.04))) + 0.08,
  // The pillows (the bedding's lightest colour) lie at the head, −z, behind
  // the duvet's middle; a crib has none, and no front.
  bed: (g, s, r) => {
    if (r.params.size === "crib") return true;
    const c = centreOfColour(g, "#8c8c8c"), duvet = centreOfColour(g, "#000000");
    return c !== null && duvet !== null && c.z < 0 && c.z < duvet.z - 0.1;
  },
  table: null,
  // A chair's back is at −z, as a sofa's; a stool has none and no front.
  chair: (g, s, r) => r.params.style === "stool" ? true
    : Math.max(...[-0.2, 0, 0.2].map((f) => topAt(g, f * s.w, -s.d / 2 + 0.02)))
      > Math.max(...[-0.2, 0, 0.2].map((f) => topAt(g, f * s.w, s.d / 2 - 0.04))) + 0.08,
  // Drawers face +z, where you sit: the pedestal shows its fronts from +z and
  // its body from −z. With no drawers, the back panel is at −z.
  desk: (g, s, r) => {
    if (r.params.drawers === "none") return !r.params.back || frontHitZ(g, 0, s.h * 0.75) < 0;
    const sx = r.params.drawers === "left" ? -1 : 1, pw = Math.min(0.42, s.w * 0.32);
    const xs = [0.2, 0.4, 0.6, 0.8].map((f) => sx * (s.w / 2 - 0.005 - pw * f)), ys = [0.1, 0.2, 0.3, 0.4].map((f) => s.h * f);
    return shows(g, xs, ys, 1, (c) => c !== "ff0000") > 0.6 && shows(g, xs, ys, -1, (c) => c === "ff0000") > 0.6;
  },
  // Fronts (drawers or doors) and handles face +z; the body is all that shows from −z.
  dresser: (g, s) => {
    const xs = [-0.37, -0.23, -0.11, 0.07, 0.19, 0.33].map((f) => f * s.w), ys = [0.33, 0.47, 0.61, 0.73, 0.87].map((f) => s.h * f);
    return shows(g, xs, ys, 1, (c) => c !== "ff0000") > 0.5 && shows(g, xs, ys, -1, (c) => c === "ff0000") > 0.9;
  },
  // The screen (its own part) is what you see of the TV from +z, and faces +z.
  tv: (g, s, r) => {
    const sc = g.userData.parts.screen, bb = new THREE.Box3().setFromObject(sc), c = bb.getCenter(new THREE.Vector3());
    const h = hitFrom(g, new THREE.Vector3(c.x, c.y, 20), new THREE.Vector3(0, 0, -1));
    const n = sc.geometry.attributes.normal, front = [...Array(n.count).keys()].some((i) => n.getZ(i) > 0.99);
    return h && h.object === sc && front;
  },
  lamp: null,
  rug: null,
  // Open toward +z: rays from the front travel in to the books or the back
  // panel; from behind they stop at once. With neither, it has no front.
  shelf: (g, s, r) => {
    const books = centreOfColour(g, "#000000");                   // the first books' colour
    if (books && books.z >= 0) return false;
    if (!r.params.back || r.params.style === "wall") return true;
    const xs = [-0.37, -0.21, -0.06, 0.09, 0.23, 0.38].map((f) => f * s.w), ys = [0.13, 0.27, 0.41, 0.56, 0.69, 0.83].map((f) => s.h * f);
    return depthBias(g, s, xs, ys) > 0.003;
  },
  // Doors (and any drawers) face +z; only the body shows from −z.
  wardrobe: (g, s) => {
    const xs = [-0.37, -0.23, -0.11, 0.07, 0.19, 0.33].map((f) => f * s.w), ys = [0.33, 0.47, 0.61, 0.73, 0.87].map((f) => s.h * f);
    return shows(g, xs, ys, 1, (c) => c !== "ff0000") > 0.5 && shows(g, xs, ys, -1, (c) => c === "ff0000") > 0.9;
  },
  plant: null,
  other: null,
};
for (const kind of Object.keys(F.FURNITURE)) {
  tryCase(`front: ${kind}`, () => {
    check(`front: ${kind}`, kind in FRONT, "every kind has a front probe or is listed as having no front");
    const probe = FRONT[kind];
    if (!probe) return;
    for (const [label, recipe0] of variants(kind)) {
      const recipe = { ...recipe0, colors: ["#ff0000", "#000000", "#0000ff", "#00ff00"].slice(0, F.FURNITURE[kind].colors.length) };
      const g = F.buildPiece(THREE, recipe, { quality: "low" });
      const r = F.clampRecipe(recipe);
      check(`front: ${kind}`, probe(g, F.pieceSize(r), r), label);
      F.disposePiece(g);
    }
  });
}

// ── unknown ─────────────────────────────────────────────────────────────────
tryCase("unknown: an unknown kind is a box of its size", () => {
  for (const q of ["low", "high"]) {
    const r = { kind: "grand piano", params: { keys: 88 }, colors: ["#101010"], width_m: 1.5, depth_m: 1.9, height_m: 1.0 };
    const g = F.buildPiece(THREE, r, { quality: q }), bb = boundsOf(g);
    const size = bb.getSize(new THREE.Vector3());
    const c = F.clampRecipe(r);
    check("unknown: an unknown kind is a box of its size", c.kind === "grand piano" && c.params.keys === 88
      && Math.abs(size.x - 1.5) < EPS && Math.abs(size.z - 1.9) < EPS && Math.abs(size.y - 1.0) < EPS && Math.abs(bb.min.y) < EPS
      && meshesOf(g).length === 1 && sameColour(meshesOf(g)[0], "#101010") && g.userData.fallback === true, { q, size });
    F.disposePiece(g);
  }
});

// ── dispose ─────────────────────────────────────────────────────────────────
function spy(objs){ const fired = new Set(); for (const o of objs) o.addEventListener("dispose", () => fired.add(o)); return fired; }
function resOf(g){
  const geos = new Set(), mats = new Set();
  g.traverse((o) => { if (o.geometry) geos.add(o.geometry); if (o.material) mats.add(o.material); });
  return { geos: [...geos], mats: [...mats], texs: [...mats].map((m) => m.map).filter(Boolean) };
}
tryCase("dispose: a piece frees what it made, never what another uses", () => {
  for (const quality of ["low", "high"]) {
    const a = F.buildPiece(THREE, F.defaultRecipe("sofa"), { quality });
    const b = F.buildPiece(THREE, F.defaultRecipe("sofa"), { quality });
    const ra = resOf(a), rb = resOf(b);
    const shared = ra.mats.filter((m) => rb.mats.includes(m));
    check("dispose: a piece frees what it made, never what another uses", shared.length === ra.mats.length && shared.length > 0
      && ra.geos.every((x) => !rb.geos.includes(x)), { quality, shared: shared.length, mats: ra.mats.length });
    const fired = spy([...ra.geos, ...ra.mats, ...ra.texs, ...rb.geos]);
    F.disposePiece(a);
    F.disposePiece(a);                                   // twice is harmless
    check("dispose: a piece frees what it made, never what another uses",
      ra.geos.every((x) => fired.has(x)) && ra.mats.every((m) => !fired.has(m)) && ra.texs.every((t) => !fired.has(t))
      && rb.geos.every((x) => !fired.has(x)), { quality, step: "first" });
    F.disposePiece(b);
    check("dispose: a piece frees what it made, never what another uses",
      ra.mats.every((m) => fired.has(m)) && ra.texs.every((t) => fired.has(t)) && (quality === "low" || ra.texs.length > 0),
      { quality, step: "last", texs: ra.texs.length });
    const c = F.buildPiece(THREE, F.defaultRecipe("sofa"), { quality });
    check("dispose: a piece frees what it made, never what another uses", resOf(c).mats.every((m) => !ra.mats.includes(m)), "a freed look is made afresh");
    F.disposePiece(c);
  }
});
tryCase("dispose: a live part's own material goes with its piece", () => {
  let tried = 0;
  for (const [kind, def] of Object.entries(F.FURNITURE)) {
    if (!def.live) continue;
    tried++;
    const g = F.buildPiece(THREE, F.defaultRecipe(kind), { quality: "high" });
    const own = resOf(g).mats.filter((m) => m.userData.ownPart);
    const fired = spy(own);
    F.disposePiece(g);
    check("dispose: a live part's own material goes with its piece", own.length > 0 && own.every((m) => fired.has(m)), kind);
  }
  check("dispose: a live part's own material goes with its piece", true, tried);
});

// ── figure ──────────────────────────────────────────────────────────────────
tryCase("figure: FIGURE is well-formed", () => {
  const P = F.FIGURE;
  const h = P.params.find((s) => s.key === "height_m");
  check("figure: FIGURE is well-formed", P.params.every(paramOk) && h && h.min === 1 && h.max === 2.1
    && ["build", "hair"].every((k) => P.params.some((s) => s.key === k))
    && JSON.stringify(P.params.find((s) => s.key === "build").choices) === JSON.stringify(["slim", "medium", "broad"])
    && JSON.stringify(P.params.find((s) => s.key === "hair").choices) === JSON.stringify(["none", "short", "long", "bun"])
    && ["hair", "skin", "top", "bottom"].every((k) => /^#[0-9a-f]{6}$/.test(P.colors[k]) && typeof P.colorNames[k] === "string"), P);
});
tryCase("figure: across its range", () => {
  const P = F.FIGURE, base = {};
  for (const s of P.params) base[s.key] = s.def;
  const vs = [["default", base], ["garbage", { height_m: "tall", build: "huge", hair: 3, colors: { hair: "nope" } }], ["nothing", null]];
  for (const s of P.params) {
    const vals = s.type === "choice" ? s.choices : s.type === "bool" ? [false, true] : [s.min, (s.min + s.max) / 2, s.max];
    for (const v of vals) vs.push([`${s.key}=${v}`, { ...base, [s.key]: v }]);
  }
  for (const height_m of [1, 2.1]) for (const hat of [false, true]) for (const hair of ["long", "bun"]) vs.push([`${height_m} ${hat} ${hair}`, { ...base, height_m, hat, hair, glasses: true }]);
  for (const [label, params] of vs) {
    for (const quality of ["low", "high"]) {
      const g = F.buildFigure(THREE, params, { quality });
      const H = Number.isFinite(+(params && params.height_m)) && params && typeof params.height_m === "number" ? params.height_m : 1.75;
      const bb = boundsOf(g), tris = trianglesOf(g), inw = inwardFaces(g);
      const eyes = centreOfColour(g, "#1d1d1f");
      check("figure: across its range", Math.abs(bb.min.y) < EPS && bb.max.y <= H + EPS && bb.max.y >= H * 0.95
        && Math.abs(bb.max.x + bb.min.x) < 0.01 && bb.max.x - bb.min.x <= g.userData.size.w + EPS && bb.max.z - bb.min.z <= g.userData.size.d + EPS
        && eyes && eyes.z > 0 && eyes.y > H * 0.85, { label, quality, min: bb.min, max: bb.max, H });
      check("figure: across its range", tris <= BUDGET[quality] && inw.bad === 0, { label, quality, tris, inw });
      stats.figure = { low: Math.max(stats.figure?.low || 0, quality === "low" ? tris : 0), high: Math.max(stats.figure?.high || 0, quality === "high" ? tris : 0) };
      F.disposePiece(g);
    }
  }
});

console.log(JSON.stringify({ cases, failures, stats }));
