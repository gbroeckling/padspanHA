// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The day theme (Settings → Appearance → Day theme, settings.light_theme).
//
// The panel is drawn in night colours, about 4,500 of them written straight
// into the views. The day theme does not invert the page (the old way, which
// turned photos and maps into negatives); it takes every interface colour and
// flips its lightness, keeping its hue: dark surfaces become pale ones, light
// text becomes dark, and a coloured word (the green accent, an amber warning)
// is only darkened enough to read on white.
//
// It works on what the panel draws: the stylesheets get a day copy, and a
// watcher swaps the colours in each element's style as it appears, keeping
// the night one beside it so switching back restores it exactly. Drawings
// keep their night colours: a large SVG or canvas (a map, the 3D house, a
// chart) and the box around it, every rule for the Atlas, Live Aboard and
// Pure Live (.lv-, .la, .pl-), and all of Pure Live while it is open.

// ── colours ─────────────────────────────────────────────────────────────────

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^)]*\)/g;

function parseColor(s) {
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length <= 4) h = h.split("").map(c => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a, hex: true };
  }
  const p = s.slice(s.indexOf("(") + 1, -1).split(/[\s,/]+/).filter(Boolean);
  if (p.length < 3 || p.some(x => x.includes("%") || x.includes("var"))) return null;
  const a = p.length > 3 ? parseFloat(p[3]) : 1;
  const [r, g, b] = p.slice(0, 3).map(Number);
  if ([r, g, b, a].some(v => !Number.isFinite(v))) return null;
  return { r, g, b, a, hex: false };
}

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }) {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3) };
}

function fmt({ r, g, b }, a, hex) {
  if (hex && a >= 1) return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}

/** One colour by its job: "text" (a word on a surface) or "surface" (a
 *  background, a border, a shadow). Unknown shapes come back unchanged. */
export function dayColor(css, role) {
  const c = parseColor(css);
  if (!c) return css;
  const hsl = toHsl(c);
  if (role === "text") {
    if (hsl.s > 0.35 && hsl.l >= 0.4) hsl.l = Math.min(hsl.l, 0.38);  // a coloured word, darkened to read
    else if (hsl.l > 0.6) hsl.l = 1 - hsl.l;                    // light grey text → dark grey
    else if (hsl.l < 0.25) hsl.l = 1 - hsl.l;                   // dark text (on a coloured button) → light
    return fmt(fromHsl(hsl), c.a, c.hex);
  }
  if (role === "shadow") return css;                                        // shadows and glows stay
  // surface
  if (hsl.l > 0.9 && c.a < 0.5) return `rgba(0,0,0,${+c.a.toFixed(3)})`;   // a white haze over dark → a grey one
  if (hsl.l < 0.1 && c.a < 1) return `rgba(0,0,0,${+Math.min(c.a * 0.1, 0.06).toFixed(3)})`;  // a dark inset → a faint one
  if (hsl.l >= 0.5) return css;                                             // accent fills stay
  hsl.l = 1 - hsl.l * 0.9;
  hsl.s *= hsl.l > 0.9 ? 0.25 : 0.6;                                       // the palest surfaces nearly neutral
  return fmt(fromHsl(hsl), c.a, c.hex);
}

// Which job a property's colours do. Anything else (fill, stroke, a
// gradient mask) is left alone.
function roleOf(prop) {
  prop = prop.trim().toLowerCase();
  if (prop === "color" || prop === "caret-color" || prop === "-webkit-text-fill-color") return "text";
  if (prop === "box-shadow" || prop === "text-shadow") return "shadow";
  if (/^(background|border|outline|column-rule)/.test(prop)) return "surface";
  if (prop.startsWith("--")) return /(ink|text|tx|fg|dim|faint|muted)/.test(prop) ? "text" : /shadow|glow/.test(prop) ? "shadow" : "surface";
  return null;
}

const DECL_RE = /(^|[;{\s])([-a-zA-Z0-9]+)\s*:\s*([^;{}]+)/g;

/** A declaration list (a style attribute, or a rule body) in day colours. */
export function dayDecls(text) {
  return text.replace(DECL_RE, (m, pre, prop, val) => {
    const role = roleOf(prop);
    if (!role || !COLOR_RE.test(val)) { COLOR_RE.lastIndex = 0; return m; }
    COLOR_RE.lastIndex = 0;
    return `${pre}${prop}:${val.replace(COLOR_RE, c => dayColor(c, role))}`;
  });
}

// Rules for the drawings keep their night colours.
const KEEP_SELECTOR_RE = /\.(lv|la|la3d|pl)[-_]/;

/** A stylesheet in day colours, rule by rule. */
export function dayCss(css) {
  return css.split("}").map(chunk => {
    const i = chunk.lastIndexOf("{");
    if (i < 0) return chunk;
    const sel = chunk.slice(0, i);
    return KEEP_SELECTOR_RE.test(sel) ? chunk : sel + "{" + dayDecls(chunk.slice(i + 1));
  }).join("}");
}

// ── the watcher ─────────────────────────────────────────────────────────────

const NIGHT = "data-night-style";     // an element's own style, kept for switching back
const KEEP = "data-keep-night";       // a drawing's box: it and everything in it stay night
const BIG_W = 250, BIG_H = 150;

/** Turn the day theme on for a shadow root. `frozen(node)` says a node must
 *  not be touched at all (Pure Live). Returns a function that turns it off
 *  and puts every night colour back. */
export function attachDayTheme(root, { frozen = () => false, extraCss = [] } = {}) {
  const written = new WeakMap();
  const styleOrig = new Map();

  const skip = (el) => frozen(el) || !!el.closest(`[${KEEP}]`) || (el.namespaceURI === "http://www.w3.org/2000/svg");

  const paint = (el) => {
    if (!el.getAttribute || skip(el)) return;
    const cur = el.getAttribute("style");
    if (cur == null || cur === written.get(el)) return;
    const day = dayDecls(cur);
    el.setAttribute(NIGHT, cur);
    if (day !== cur) { written.set(el, day); el.setAttribute("style", day); }
    else written.set(el, cur);
  };
  const paintSheet = (st) => {
    if (styleOrig.has(st) || frozen(st) || KEEP_SELECTOR_RE.test(st.textContent.slice(0, 400))) return;
    styleOrig.set(st, st.textContent);
    st.textContent = dayCss(st.textContent);
  };
  const restore = (el) => {
    if (!el.hasAttribute(NIGHT)) return;
    el.setAttribute("style", el.getAttribute(NIGHT));
    el.removeAttribute(NIGHT);
    written.delete(el);
  };
  // A big drawing keeps its night box: the nearest box around it with a
  // background of its own, within four levels.
  const keepDrawings = () => {
    root.querySelectorAll("svg, canvas").forEach(d => {
      if (d.closest(`[${KEEP}]`) || frozen(d) || d.parentElement?.closest("svg")) return;
      const r = d.getBoundingClientRect();
      if (r.width < BIG_W || r.height < BIG_H) return;
      let box = null;
      for (let p = d.parentElement, i = 0; p && i < 4; i++, p = p.parentElement) {
        const night = p.getAttribute(NIGHT) || p.getAttribute("style") || "";
        if (/background/.test(night) || p.classList.contains("card")) { box = p; break; }
      }
      box = box || d.parentElement;
      if (!box) return;
      box.setAttribute(KEEP, "");
      restore(box);
      box.querySelectorAll(`[${NIGHT}]`).forEach(restore);
      // Its background may come from a class (now light) or be see-through:
      // a drawing made for the night needs a night ground under it.
      const bg = parseColor(getComputedStyle(box).backgroundColor || "") || { r: 255, g: 255, b: 255, a: 0 };
      if (bg.a < 0.9 || toHsl(bg).l > 0.3) {
        box.setAttribute(NIGHT, box.getAttribute("style") || "");
        box.style.backgroundColor = "#0a150e";
      }
    });
  };
  const sweep = (node) => {
    if (node.nodeType !== 1) return;
    if (node.tagName === "STYLE") { paintSheet(node); return; }
    paint(node);
    node.querySelectorAll("[style]").forEach(paint);
    node.querySelectorAll("style").forEach(paintSheet);
  };

  const extra = extraCss.map(css => {
    const st = document.createElement("style");
    st.setAttribute("data-day-css", "");
    st.textContent = dayCss(css);
    root.appendChild(st);
    return st;
  });
  root.querySelectorAll("[style]").forEach(paint);
  root.querySelectorAll("style:not([data-day-css])").forEach(paintSheet);
  keepDrawings();

  const mo = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === "attributes") paint(m.target);
      else m.addedNodes.forEach(n => { if (!(n.hasAttribute && n.hasAttribute("data-day-css"))) sweep(n); });
    }
    keepDrawings();
  });
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });

  return function detach() {
    mo.disconnect();
    extra.forEach(st => st.remove());
    root.querySelectorAll(`[${NIGHT}]`).forEach(restore);
    root.querySelectorAll(`[${KEEP}]`).forEach(el => el.removeAttribute(KEEP));
    styleOrig.forEach((txt, st) => { st.textContent = txt; });
  };
}
