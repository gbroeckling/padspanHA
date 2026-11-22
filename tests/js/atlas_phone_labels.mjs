// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The flat Atlas on a phone, and its room names kept readable (the owner,
// 2026-11-21: on a phone the house was a thumbnail beside a column of round
// buttons; "LARDER" under a strip light, "WALK-IN CLOSET" under Sam's badge,
// "LIVING ROOM" under "Jordan · Guest").
//
//   phone   the map's own width, worked out from the real style sheets
//           (styles.css and the panel's own <style>) for the sidebar's card:
//           on a 390 px phone the drawing has the phone's width, the rail a
//           row above it; on a desk and on a wall the rail is the column it was
//   names   every room name on every floor, plain and in every Showcase
//           theme, is not under a lit fixture or a code drawn after it (long
//           strips whose middles are off to one side of the name: the old dodge
//           only looked at a marker's middle), and its middle is in its room
//   people  with people and tags on, a name a person's badge or a tag's name
//           lands on moves to a spot in its room they do not cover, and goes
//           back once they leave; the layer turned off puts every name back
//
// usage: atlas_phone_labels.mjs <www/padspan-ha dir>
// prints one JSON line: { cases: {name: result}, failures: [...] }

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: atlas_phone_labels.mjs <www/padspan-ha dir>"); process.exit(2); }
install(globalThis);

const failures = [], cases = {};
const check = (name, ok, detail) => { cases[name] = cases[name] === false ? false : !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };
const tryCase = async (name, fn) => { try { await fn(); } catch (e) { failures.push({ name, detail: String(e && e.stack || e).slice(0, 900) }); cases[name] = false; } };
const url = (...p) => pathToFileURL(join(WWW, ...p)).href;
const ISO = await import(url("views", "iso_lights.js"));
const LM = await import(url("views", "lights_map.js"));
const AB = await import(url("views", "atlas_aboard.js"));

// ── phone: a small cascade over the real sheets ─────────────────────────────
// Enough CSS for this card: rules in and out of @media (width only), compound
// selectors with classes, ids, attributes, :not(), :host(), :last-child and
// the child and descendant combinators, specificity and source order, and the
// margin / padding / border shorthands. Anything else (another at-rule, a
// pseudo-element, :hover, :has) never applies here.
function parseCss(text){
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const walk = (s, media) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf("{", i);
      if (open < 0) return;
      const head = s.slice(i, open).split(";").pop().trim();
      let depth = 1, j = open + 1;
      for (; j < s.length && depth; j++) { if (s[j] === "{") depth++; else if (s[j] === "}") depth--; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(body, [...media, head.slice(6).trim()]);
      else if (!head.startsWith("@") && head) rules.push({ sels: splitTop(head, ","), body, media });
      i = j;
    }
  };
  walk(src, []);
  return rules;
}
function splitTop(s, ch){
  const out = []; let depth = 0, cur = "";
  for (const c of s) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === ch && !depth) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const mediaHolds = (conds, vw) => conds.every(c => splitTop(c, ",").some(alt => {
  const feats = [...alt.matchAll(/\(\s*([\w-]+)\s*:\s*([^)]+)\)/g)];
  if (!feats.length || /\bnot\b/.test(alt)) return false;
  return feats.every(([, f, v]) => f === "max-width" ? vw <= parseFloat(v) : f === "min-width" ? vw >= parseFloat(v) : false);
}));
// A selector as [compound, combinator, compound, ...]; a compound as {tag, ids, cls, attrs, pseudo}.
function parseSel(sel){
  const parts = []; let cur = "", depth = 0;
  const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ""; };
  for (const c of sel.trim()) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (!depth && (c === ">" || c === "+" || c === "~")) { push(); parts.push(c); continue; }
    if (!depth && /\s/.test(c)) { push(); if (parts.length && ![">", "+", "~", " "].includes(parts[parts.length - 1])) parts.push(" "); continue; }
    cur += c;
  }
  push();
  while (parts.length && [" "].includes(parts[parts.length - 1])) parts.pop();
  const clean = [];
  for (const p of parts) { if (p === " " && [">", "+", "~"].includes(clean[clean.length - 1])) continue; if ([">", "+", "~"].includes(p) && clean[clean.length - 1] === " ") clean.pop(); clean.push(p); }
  return clean.map((p, i) => (i % 2 ? p : compound(p)));
}
function compound(s){
  const c = { tag: null, ids: [], cls: [], attrs: [], pseudo: [], bad: false };
  let i = 0;
  const m0 = /^(\*|[a-zA-Z][\w-]*)/.exec(s);
  if (m0) { c.tag = m0[1] === "*" ? null : m0[1].toLowerCase(); i = m0[0].length; }
  while (i < s.length) {
    const ch = s[i];
    if (ch === "#" || ch === ".") { const m = /^[\w-]+/.exec(s.slice(i + 1)); (ch === "#" ? c.ids : c.cls).push(m[0]); i += 1 + m[0].length; }
    else if (ch === "[") { const j = s.indexOf("]", i); const m = /^([\w-]+)(?:([~^$*|]?=)["']?([^"']*)["']?)?$/.exec(s.slice(i + 1, j)); c.attrs.push(m ? [m[1], m[2] || null, m[3]] : ["?bad", null, null]); i = j + 1; }
    else if (s.startsWith("::", i)) { c.bad = true; break; }
    else if (ch === ":") {
      const m = /^:([\w-]+)/.exec(s.slice(i)); let arg = null; i += m[0].length;
      if (s[i] === "(") { let d = 1, j = i + 1; for (; j < s.length && d; j++) { if (s[j] === "(") d++; else if (s[j] === ")") d--; } arg = s.slice(i + 1, j - 1); i = j; }
      c.pseudo.push([m[1], arg]);
    } else { c.bad = true; break; }
  }
  return c;
}
// inHost: c is :host()'s own argument, tested on the host itself.
function compoundMatches(c, el, inHost = false){
  if (c.bad) return false;
  if (c.tag && el.tag !== c.tag) return false;
  if (c.ids.some(id => el.id !== id) || c.cls.some(k => !el.cls.has(k))) return false;
  for (const [a, op, v] of c.attrs) { if (!(a in el.attrs)) return false; if (op === "=" && String(el.attrs[a]) !== v) return false; if (op && op !== "=") return false; }
  for (const [p, arg] of c.pseudo) {
    if (p === "not") { if (splitTop(arg, ",").some(x => matches(parseSel(x), el, inHost))) return false; }
    else if (p === "host") { if (!el.host || (arg && !matches(parseSel(arg), el, true))) return false; }
    else if (p === "last-child") { if (!el.parent || el.parent.kids[el.parent.kids.length - 1] !== el) return false; }
    else if (p === "first-child") { if (!el.parent || el.parent.kids[0] !== el) return false; }
    else return false;
  }
  return !el.host || inHost || c.pseudo.some(([p]) => p === "host");
}
function matches(parts, el, inHost = false){
  if (!compoundMatches(parts[parts.length - 1], el, inHost)) return false;
  if (parts.length === 1) return true;
  const comb = parts[parts.length - 2], rest = parts.slice(0, -2);
  if (comb === ">") return !!el.parent && matches(rest, el.parent);
  if (comb === " ") { for (let p = el.parent; p; p = p.parent) if (matches(rest, p)) return true; return false; }
  return false;
}
function specificity(parts){
  let a = 0, b = 0, c = 0;
  for (const p of parts) {
    if (typeof p === "string") continue;
    a += p.ids.length; b += p.cls.length + p.attrs.length; c += p.tag ? 1 : 0;
    for (const [name, arg] of p.pseudo) {
      if ((name === "not" || name === "host") && arg) { const s = splitTop(arg, ",").map(x => specificity(parseSel(x))).sort((x, y) => (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]))[0]; a += s[0]; b += s[1] + (name === "host" ? 1 : 0); c += s[2]; }
      else b++;
    }
  }
  return [a, b, c];
}
const SIDES = ["top", "right", "bottom", "left"];
function decls(body){
  const out = [];
  for (const d of splitTop(body, ";")) {
    const k = d.indexOf(":"); if (k < 0) continue;
    const prop = d.slice(0, k).trim().toLowerCase(); let val = d.slice(k + 1).trim(); const imp = /!important\s*$/.test(val); val = val.replace(/!important\s*$/, "").trim();
    if (prop === "margin" || prop === "padding") {
      const v = val.split(/\s+/), four = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v;
      SIDES.forEach((s, i) => out.push([`${prop}-${s}`, four[i], imp]));
    } else if (prop === "border" || /^border-(top|right|bottom|left)$/.test(prop)) {
      const w = /none/.test(val) ? "0" : ((/(-?[\d.]+)px/.exec(val) || [, "3"])[1] + "px");
      for (const s of prop === "border" ? SIDES : [prop.slice(7)]) out.push([`border-${s}-width`, w, imp]);
    } else out.push([prop, val, imp]);
  }
  return out;
}
function cascade(rules, el, vw){
  const won = {};
  rules.forEach((r, order) => {
    if (!mediaHolds(r.media, vw)) return;
    for (const sel of r.sels) {
      const parts = parseSel(sel);
      if (!matches(parts, el)) continue;
      const spec = specificity(parts);
      for (const [prop, val, imp] of decls(r.body)) {
        const key = [imp ? 1 : 0, ...spec, order], had = won[prop];
        const i = had ? key.findIndex((v, k) => v !== had.key[k]) : -1;
        if (!had || i < 0 || key[i] > had.key[i]) won[prop] = { val, key };
      }
    }
  });
  return Object.fromEntries(Object.entries(won).map(([k, v]) => [k, v.val]));
}
const px = (v) => (v === undefined || v === "0" || v === "auto" ? 0 : /^-?[\d.]+px$/.test(String(v).trim()) ? parseFloat(v) : NaN);
const widthOf = (v, of) => { const s = String(v || "auto").replace(/\s+/g, " ").trim();
  if (s === "auto" || s === "100%") return of;
  const m = /^calc\(100% - ([\d.]+)px\)$/.exec(s); if (m) return of - parseFloat(m[1]);
  return /^[\d.]+px$/.test(s) ? parseFloat(s) : NaN; };

const node = (tag, { id = "", cls = "", attrs = {}, host = false } = {}, kids = []) => {
  const n = { tag, id, cls: new Set(cls.split(/\s+/).filter(Boolean)), attrs, host, kids: [], parent: null };
  for (const k of kids) { k.parent = n; n.kids.push(k); }
  return n;
};
/** The sidebar's map card as lights_panel.js and lights_map.js build it, in the panel's shadow root. */
function cardTree(wall){
  const rail = node("div", { cls: "lv-rail" }, ["☰", "★", "⚙", "🏠", "⋯", "‹"].map(() => node("button", { cls: "lv-railbtn" })));
  const stage = node("div", { cls: "lv-stage" });
  const card = node("div", { cls: `card lv-mapcard lv-atlascard lv-v2 lv-display${wall ? " lv-wall" : ""}` },
    [node("div", { cls: "lv-drawer" }), node("div", { cls: "lv-drawer" }), node("div", { cls: "lv-drawer" }), rail, stage,
     node("div", { cls: "lv-alone-anchor" }), node("div", { cls: "lv-legend lv-shapes" })]);
  const content = node("div", { id: "content" }, [node("div", {}, [card])]);
  const host = node("padspan-lights-app", { attrs: wall ? { "data-wall": "" } : {}, host: true }, [content]);
  return { host, content, wrap: content.kids[0], card, rail, stage };
}
function drawingWidth(rules, vw, wall = false){
  const t = cardTree(wall), C = (el) => cascade(rules, el, vw);
  const content = C(t.content), card = C(t.card), stage = C(t.stage), rail = C(t.rail);
  const inner = vw - px(content["padding-left"]) - px(content["padding-right"]);
  const cardW = widthOf(card.width, inner - px(card["margin-left"]) - px(card["margin-right"]));
  const cardIn = cardW - px(card["border-left-width"]) - px(card["border-right-width"]) - px(card["padding-left"]) - px(card["padding-right"]);
  const stageW = widthOf(stage.width, cardIn);
  const svgW = stageW - (stage["box-sizing"] === "border-box" ? px(stage["padding-left"]) + px(stage["padding-right"]) : 0);
  return { svgW, cardW, stageW, rail: { position: rail.position, flex: rail["flex-direction"] }, stageWidthRule: stage.width };
}

await tryCase("phone: the map has the phone's width, the rail a row above it", async () => {
  const sheet = readFileSync(join(WWW, "styles.css"), "utf8");
  const panel = readFileSync(join(WWW, "lights_panel.js"), "utf8");
  // The panel's own <style> in its shadow root (the one that sets #content's padding), its ${…} parts left out.
  const own = [...panel.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).find(s => s.includes("#content{padding:16px}"));
  if (!own) throw new Error("the panel's own <style> (#content{padding:16px}) was not found in lights_panel.js");
  const rules = parseCss(sheet + "\n" + own.replace(/\$\{[^}]*\}/g, ""));
  const phone = drawingWidth(rules, 390), desk = drawingWidth(rules, 1600), wall = drawingWidth(rules, 390, true);
  check("phone: the map has the phone's width, the rail a row above it",
    phone.svgW >= 0.95 * 390 && phone.svgW <= 390 && phone.rail.flex === "row" && phone.rail.position !== "absolute", phone);
  check("phone: on a desk the rail is the column beside the map it was",
    desk.rail.flex === "column" && desk.rail.position === "absolute" && desk.stageWidthRule === "calc(100% - 44px)" && desk.svgW === desk.cardW - 2 - 44 - 20, desk);
  check("phone: a wall keeps its column, whatever its width", wall.rail.flex === "column" && wall.rail.position === "absolute", wall);
});

// ── names: a two-floor house, its names, and fixtures over them ─────────────
const rect = (floor_id, x0, y0, x1, y1) => ({ type: "poly", floor_id, points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const FLOORS = [{ id: "main", name: "Main", level: 0 }, { id: "upper", name: "Upper", level: 1 }];
const ROOMS = { main: ["Living Room", "Kitchen", "Larder", "Walk-in Closet"], upper: ["Loft", "Study", "Linen", "Dressing Room"] };
const SHAPES_M = [[0, 0, 8, 6], [8.2, 0, 13, 3.4], [8.2, 3.6, 11.4, 4.8], [0, 6.2, 4.5, 7.8]];
const room_geometry_m = {};
for (const f of FLOORS) ROOMS[f.id].forEach((r, i) => { room_geometry_m[r] = rect(f.id, ...SHAPES_M[i]); });
const BARE = { floors: FLOORS, room_geometry_m, light_positions_m: {}, rf_barriers_m: [] };
const T0 = new Date(Date.now() - 3600e3).toISOString();
const GAP = 150;
const frame = ISO.fabricFrame(BARE, FLOORS, GAP, 0);
const nameAt = (svg, room, upper) => {
  const end = svg.indexOf(`>${upper ? room.toUpperCase() : room}</text>`);
  if (end < 0) return null;
  const at = svg.lastIndexOf("<text ", end), tag = svg.slice(at, end);
  const a = (k) => (new RegExp(` ${k}="([^"]*)"`).exec(tag) || [])[1];
  return { x: +a("x"), y: +a("y"), fs: +a("font-size"), ls: parseFloat(a("letter-spacing") || "0") || 0, at };
};
// Where each name sits with nothing in the house: the lights go there.
const bare = ISO.buildIsoSVG(BARE, {}, new Set(), null, GAP, 0, {}, false, FLOORS, {});
const positions = {}, states = {}, shapes = {}, lit = new Set();
for (const f of FLOORS) {
  const z = frame.levelOf(f.id);
  ROOMS[f.id].forEach((room, i) => {
    const n = nameAt(bare, room, false);
    if (!n) throw new Error(`no name for ${room}`);
    const half = room.length * n.fs * 0.39 + 5;                    // the old dodge's widest window (Showcase's): a marker's middle within it moved the name
    const slug = room.toLowerCase().replace(/[^a-z]+/g, "_");
    // A lit strip lying through the name, its middle just past the name's end (the dodge never saw it); in
    // the closet an unlit one; a lit pot right on the living room's name.
    const strip = (eid, on, dx, lenPx) => {
      const [mx, my] = frame.isoInv(n.x + dx, n.y, z);
      positions[eid] = { x_m: mx, y_m: my, floor_id: f.id, width_cm: Math.round(lenPx / frame.scale * 100), height_cm: 10, rotation: 0 };
      states[eid] = { state: on ? "on" : "off", attributes: { friendly_name: `${room} strip`, brightness: 200 }, last_changed: T0 };
      shapes[eid] = "bar"; if (on) lit.add(eid);
    };
    if (i === 0) {
      const eid = `light.${slug}_pot`, [mx, my] = frame.isoInv(n.x, n.y, z);
      positions[eid] = { x_m: mx, y_m: my, floor_id: f.id };
      states[eid] = { state: "on", attributes: { friendly_name: `${room} pot`, brightness: 200 }, last_changed: T0 };
      shapes[eid] = "circle"; lit.add(eid);
    } else strip(`light.${slug}_strip`, i !== 3, half + 6, 2 * half + 40);
  });
}
const MODEL = { ...BARE, light_positions_m: positions };
const LIGHTS = LM.gatherLights(states, {}, shapes, "pro", {}, {}, {}, {}, Date.now());
const LBE = Object.fromEntries(LIGHTS.map(l => [l.entity_id, l]));
const ink = (n, upper) => ({ hw: n.word.length * n.fs * ((upper ? 0.62 : 0.5) + n.ls) / 2, hh: n.fs * 0.35, cy: n.y - n.fs * 0.05 });
/** Each marker's body on screen: a polygon (its shape's box, scaled, turned and moved as the drawing does). */
function markers(svg){
  const out = [];
  const re = /<g class="lhex" data-eid="([^"]+)" data-cx="([\d.-]+)" data-cy="([\d.-]+)" data-z="([\d.-]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(svg))) {
    const body = svg.slice(m.index, svg.indexOf("</g></g>", m.index) + 8);
    const tf = /<g transform="translate\(([\d.-]+),([\d.-]+)\)(?: rotate\(([\d.-]+)\))?(?: scale\(([\d.-]+),([\d.-]+)\))?">/.exec(body);
    const shape = /<(rect|circle) (?!data-hit)([^>]*)\/>/.exec(tf ? body.slice(tf.index) : body.replace(/<circle data-hit[^>]*\/>/, ""));
    if (!shape) continue;
    const a = Object.fromEntries([...shape[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    const box = shape[1] === "circle" ? [+a.cx - +a.r, +a.cy - +a.r, +a.cx + +a.r, +a.cy + +a.r] : [+a.x, +a.y, +a.x + +a.width, +a.y + +a.height];
    let pts = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
    if (tf) {
      const [tx, ty, r, sx, sy] = [+tf[1], +tf[2], +(tf[3] || 0), +(tf[4] || 1), +(tf[5] || 1)], t = r * Math.PI / 180;
      pts = pts.map(([x, y]) => [x * sx, y * sy]).map(([x, y]) => [tx + x * Math.cos(t) - y * Math.sin(t), ty + x * Math.sin(t) + y * Math.cos(t)]);
    }
    out.push({ eid: m[1], z: +m[4], at: m.index, pts });
  }
  return out;
}
const codes = (svg) => [...svg.matchAll(/<g data-role="code"[^>]*><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"[^>]*fill="(?!transparent)/g)]
  .map(m => ({ at: m.index, pts: [[+m[1], +m[2]], [+m[1] + +m[3], +m[2]], [+m[1] + +m[3], +m[2] + +m[4]], [+m[1], +m[2] + +m[4]]] }));
// Does a polygon meet a box? (separating axes: the box's two and the polygon's own)
function meets(pts, [x0, y0, x1, y1]){
  const box = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const axes = [[1, 0], [0, 1], ...pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return [q[1] - p[1], p[0] - q[0]]; })];
  return axes.every(([ax, ay]) => {
    const pr = (P) => P.map(([x, y]) => x * ax + y * ay);
    const a = pr(pts), b = pr(box);
    return Math.max(...a) > Math.min(...b) && Math.max(...b) > Math.min(...a);
  });
}
const THEMES = [null, ...Object.keys(ISO.SHOWCASE_THEMES)];
await tryCase("names: no room name under a lit fixture or a code drawn over it, on any floor, in any theme", async () => {
  const bad = [];
  let looked = 0;
  for (const theme of THEMES) for (const hideCodes of [false, true]) {
    const opts = { codeChip: true, hideCodes, nowMs: Date.now(), ...(theme ? { showcase: true, showcaseTheme: theme } : {}) };
    const svg = ISO.buildIsoSVG(MODEL, {}, new Set(), null, GAP, 0, LBE, false, FLOORS, opts);
    const T = theme ? ISO.SHOWCASE_THEMES[theme] : null, upper = !!(T && T.roomLabelUppercase);
    const M = markers(svg).filter(k => lit.has(k.eid)), C = hideCodes ? [] : codes(svg);
    for (const f of FLOORS) for (const room of ROOMS[f.id]) {
      const n = nameAt(svg, room, upper);
      if (!n) { bad.push({ theme, room, why: "not drawn" }); continue; }
      n.word = room; looked++;
      const k = ink(n, upper), box = [n.x - k.hw, k.cy - k.hh, n.x + k.hw, k.cy + k.hh];
      const z = frame.levelOf(f.id);
      const over = [...M.filter(o => o.z === z && o.at > n.at && meets(o.pts, box)).map(o => o.eid),
                    ...C.filter(o => o.at > n.at && meets(o.pts, box)).map(() => "a code")];
      const [mx, my] = frame.isoInv(n.x, n.y, z);
      const inside = ISO.pointInPolygon(room_geometry_m[room].points_m, mx, my);
      if (over.length || !inside) bad.push({ theme, hideCodes, room, over, inside, at: [n.x, n.y] });
    }
  }
  check("names: no room name under a lit fixture or a code drawn over it, on any floor, in any theme",
    !bad.length && looked === THEMES.length * 2 * 8, { looked, bad: bad.slice(0, 8), nBad: bad.length });
});

// ── people: a badge or a tag's name on a room's name ─────────────────────────
await tryCase("people: a name a person or a tag's name lands on moves off them, and back once they leave", async () => {
  const NS = "http://www.w3.org/2000/svg";
  const names = new Map();
  const svgStr = ISO.buildIsoSVG(MODEL, {}, new Set(), frame.levelOf("main"), GAP, 0, LBE, false, FLOORS, { codeChip: true, hideCodes: true, labelSpots: names });
  // The drawing's names as elements (the DOM shim parses no markup): each g.lroom and g.lroom-name, by room and floor.
  const svg = document.createElementNS(NS, "svg");
  for (const m of svgStr.matchAll(/<g class="(lroom|lroom-name)" (?:data-role="room" )?data-room="([^"]+)" data-z="([\d.-]+)"/g)) {
    const g = document.createElementNS(NS, "g"); g.className = m[1]; g.setAttribute("class", m[1]); g.setAttribute("data-room", m[2]); g.setAttribute("data-z", m[3]);
    svg.appendChild(g);
  }
  const z = frame.levelOf("main");
  const closet = names.get(`${z}|Walk-in Closet`), living = names.get(`${z}|Living Room`);
  if (!closet || !living) throw new Error(`the drawing gave no spots: ${[...names.keys()]}`);
  // Sam stands on the closet's name; the guest's tag sits just under the living room's, so its name covers it.
  const at = (spot, dy = 0) => frame.isoInv(spot[0], spot[1] + dy, z);
  const [sx, sy] = at(closet.spots[0]), [gx, gy] = at(living.spots[0], 10);
  const STATES = { "person.sam": { state: "home", attributes: { friendly_name: "Sam", device_trackers: ["device_tracker.sam_phone"] }, last_changed: T0 } };
  const snap = (here) => ({ objects: { list: here ? [
    { key: "phone:sam", kind: "phone", name: "Sam's phone", linked_entities: ["device_tracker.sam_phone"], x_m: sx, y_m: sy, floor_id: "main", room: "Walk-in Closet", age_s: 2, knn_confidence: 0.7 },
    { key: "ble:guest", kind: "ble", user_label: "Jordan · Guest", identified: true, x_m: gx, y_m: gy, floor_id: "main", room: "Living Room", age_s: 4, knn_confidence: 0.9, sources: [] },
  ] : [] } });
  const L = AB.liveLayer("t-names");
  L.draw({ stage: { querySelector: () => svg }, frame, frameKey: `${GAP}|0`, model: MODEL, states: STATES, file: null, people: true, tags: true, names,
           hideNames: false, focused: () => true, outdoor: ISO.isOutdoorFloorId, home: () => document.body }, snap(true));
  const items = L.state(), sam = items.find(i => i.key === "person.sam"), guest = items.find(i => i.kind === "beacon");
  const g = (room) => [...svg.children].find(c => c.getAttribute("class") === "lroom" && c.getAttribute("data-room") === room);
  const moved = (room) => { const t = /translate\(([\d.-]+) ([\d.-]+)\)/.exec(g(room).getAttribute("transform") || ""); return t ? [+t[1], +t[2]] : [0, 0]; };
  const boxOf = (n, d) => [n.spots[0][0] + d[0] - n.ink[0], n.spots[0][1] + d[1] - n.ink[1], n.spots[0][0] + d[0] + n.ink[0], n.spots[0][1] + d[1] + n.ink[1]];
  const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const samBox = sam && [sam.at[0] - 8, sam.at[1] - 8, sam.at[0] + 8, sam.at[1] + 8];
  const tagName = guest && [guest.at[0] - guest.label.length * 2.4, guest.at[1] - 14.5, guest.at[0] + guest.label.length * 2.4, guest.at[1] - 6];
  const was = { closetMoved: moved("Walk-in Closet"), livingMoved: moved("Living Room"),
    samOnItsSpot: !!samBox && hit(samBox, boxOf(closet, [0, 0])), tagOnItsSpot: !!tagName && hit(tagName, boxOf(living, [0, 0])) };
  const clear = { closet: !!samBox && !hit(samBox, boxOf(closet, was.closetMoved)), living: !!tagName && !hit(tagName, boxOf(living, was.livingMoved)) };
  // They leave: both names go home. The layer off: nothing of it is left on the names.
  L.draw(null, snap(false));
  const back = !g("Walk-in Closet").getAttribute("transform") && !g("Living Room").getAttribute("transform");
  L.draw(null, snap(true));
  const again = !!g("Walk-in Closet").getAttribute("transform");
  L.clear();
  const off = [...svg.children].every(c => !c.getAttribute("transform"));
  check("people: a name a person or a tag's name lands on moves off them, and back once they leave",
    was.samOnItsSpot && was.tagOnItsSpot && clear.closet && clear.living && back && again && off,
    { was, clear, back, again, off, sam: sam && sam.at, guest: guest && [guest.at, guest.label], closet, living });
});

console.log(JSON.stringify({ cases, failures }));
