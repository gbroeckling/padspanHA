// The click-through crawler's eyes inside the page (tools/ui_click_through/crawl.py
// adds this before any page script runs). It only watches and answers
// questions: which controls are on screen, what is covering what, what the
// visible text says. The crawler itself presses the buttons, with real mouse,
// touch and keyboard input.
(() => {
  if (window.__ct) return;
  const LISTENERS = new WeakMap();   // element -> Set of event types it listens for
  const TYPES = new Set(["click", "dblclick", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "wheel", "pointermove"]);
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      if (this instanceof Element && TYPES.has(type)) {
        let s = LISTENERS.get(this);
        if (!s) LISTENERS.set(this, (s = new Set()));
        s.add(type);
      }
    } catch (_) { /* never in the page's way */ }
    return add.call(this, type, fn, opts);
  };

  const errors = [];     // uncaught errors and rejected promises nobody caught
  const opened = [];     // window.open calls (never followed)
  const ws = [];         // every message the page sent to the fake Home Assistant
  add.call(window, "error", (e) => {
    if (e.target && e.target !== window && e.target.tagName) {
      errors.push({ kind: "resource", msg: `${e.target.tagName.toLowerCase()} failed to load: ${e.target.src || e.target.href || ""}`, stack: "" });
    } else {
      errors.push({ kind: "error", msg: String(e.message || e), stack: String((e.error && e.error.stack) || `${e.filename}:${e.lineno}:${e.colno}`) });
    }
  }, true);
  add.call(window, "unhandledrejection", (e) => {
    const r = e.reason;
    errors.push({ kind: "rejection", msg: String((r && r.message) || r), stack: String((r && r.stack) || "") });
  });
  window.open = (url) => { opened.push(String(url)); return null; };

  // Every websocket message, service call and API call the panel makes,
  // noted on its way to the fake Home Assistant (the element's hass setter).
  const brief = (v) => { try { const s = JSON.stringify(v); return s === undefined ? "undefined" : s.slice(0, 160); } catch (_) { return "(unprintable)"; } };
  const traced = (kind, fn) => function (...a) {
    const row = { kind, type: kind === "ws" ? String(a[0] && a[0].type) : kind === "service" ? `${a[0]}.${a[1]}` : `${a[0]} ${a[1]}`, msg: brief(a[0]), answer: "(pending)" };
    ws.push(row);
    let p;
    try { p = fn.apply(this, a); } catch (err) { row.answer = "threw: " + String(err && err.message); throw err; }
    Promise.resolve(p).then((r) => { row.answer = brief(r); row.empty = !!r && typeof r === "object" && !Array.isArray(r) && !Object.keys(r).length; },
                            (err) => { row.answer = "rejected: " + String((err && err.message) || err); });
    return p;
  };
  const wrapHass = (h) => {
    if (!h || h.__ctWrapped) return h;
    const c = h.connection || {};
    return { ...h, __ctWrapped: true, callWS: traced("ws", h.callWS), callService: traced("service", h.callService), callApi: traced("api", h.callApi),
             connection: { ...c, sendMessagePromise: traced("ws", c.sendMessagePromise) } };
  };
  const define = customElements.define.bind(customElements);
  customElements.define = (name, cls, opts) => {
    try {
      const d = Object.getOwnPropertyDescriptor(cls.prototype, "hass");
      if (d && d.set) Object.defineProperty(cls.prototype, "hass", { ...d, set(h) { d.set.call(this, wrapHass(h)); } });
    } catch (_) { /* untraced, still works */ }
    return define(name, cls, opts);
  };

  // ── Walking the page, shadow roots included ───────────────────────────────
  const parentOf = (el) => el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
  const walk = (root, visit) => {
    const kids = root.children || [];
    for (const el of kids) {
      if (visit(el) === false) continue;
      if (el.shadowRoot) walk(el.shadowRoot, visit);
      walk(el, visit);
    }
  };
  const vw = () => window.innerWidth, vh = () => window.innerHeight;
  // 0: hidden with everything in it; 1: takes no room itself (its children may); 2: on the page.
  const vis = (el) => {
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      return getComputedStyle(el).display === "contents" || el.tagName === "SLOT" ? 1 : 0;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 3 && r.height >= 3 ? 2 : 1;
  };
  const shown = (el) => vis(el) === 2;
  const scrollsX = (el) => {
    for (let p = parentOf(el); p; p = parentOf(p)) {
      const o = getComputedStyle(p).overflowX;
      if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  // On screen, or reachable by scrolling. A closed drawer parked off the
  // side of the screen is neither.
  const reachable = (el) => {
    const r = el.getBoundingClientRect();
    if (r.right > 0 && r.left < vw()) return true;
    return scrollsX(el);
  };
  const deepHit = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  };
  const within = (el, anc) => { for (let p = el; p; p = parentOf(p)) if (p === anc) return true; return false; };
  const clsOf = (el) => String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || "").trim().split(/\s+/).filter(Boolean);
  const nameOf = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + clsOf(el).slice(0, 2).map((c) => "." + c).join("");

  const REGIONS = [["#demo-bar", "demo"], ["#modal", "modal"], ["#toast", "toast"], ["aside.left", "side"], [".mobile-topbar", "top"],
                   [".desktop-topbar", "top"], [".mobile-bottom-nav", "bottomnav"]];
  const regionOf = (el) => {
    let fixed = "";
    for (let p = el; p; p = parentOf(p)) {
      for (const [sel, name] of REGIONS) if (p.matches(sel)) return name;
      if (!fixed && p !== el && getComputedStyle(p).position === "fixed") fixed = "overlay";
    }
    return fixed || "content";
  };

  const textOf = (el) => String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const labelOf = (el, kind) => {
    let t = el.getAttribute("aria-label") || "";
    if (!t && !["text", "number", "check", "range", "select", "file", "other"].includes(kind)) t = textOf(el).slice(0, 60);
    if (!t && el.labels && el.labels[0]) t = textOf(el.labels[0]).slice(0, 60);
    if (!t) { const l = el.closest && el.closest("label"); if (l) t = textOf(l).slice(0, 60); }
    if (!t) t = el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("name") || "";
    if (!t && ["text", "number", "check", "range", "select", "file", "other"].includes(kind)) {
      // An unlabelled field: the words just before it.
      const p = parentOf(el);
      if (p) t = textOf(p).slice(0, 50);
    }
    if (!t) t = el.id || clsOf(el)[0] || "";
    return t.slice(0, 80);
  };

  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") return null;
      if (type === "checkbox" || type === "radio") return "check";
      if (type === "range") return "range";
      if (type === "number") return "number";
      if (type === "file") return "file";
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (["color", "date", "time", "datetime-local", "month", "week"].includes(type)) return "other";
      return "text";
    }
    if (tag === "textarea" || el.isContentEditable) return "text";
    if (tag === "select") return "select";
    if (tag === "canvas") return "canvas";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    // A toggle switch: a label around a checkbox drawn invisible, so the label is what a person presses.
    if (tag === "label" && el.control && /^(checkbox|radio)$/.test(el.control.type) && !shown(el.control)) return "check";
    const role = el.getAttribute("role");
    if (["button", "tab", "link", "checkbox", "switch", "menuitem", "option", "radio", "slider"].includes(role)) return "button";
    const ls = LISTENERS.get(el);
    const pressable = !!(el.onclick || el.hasAttribute("onclick") || (ls && (ls.has("click") || ls.has("pointerdown") || ls.has("mousedown") || ls.has("touchstart") || ls.has("pointerup"))));
    if (tag === "svg" && ls && (ls.has("pointerdown") || ls.has("mousedown") || ls.has("wheel") || ls.has("touchstart") || ls.has("click"))) {
      const r = el.getBoundingClientRect();
      if (r.width >= 160 && r.height >= 120) return "canvas";
    }
    if (pressable && getComputedStyle(el).cursor === "pointer") return "button";
    if (pressable && tag === "label") return "button";
    if (el.hasAttribute("tabindex") && el.tabIndex >= 0 && pressable) return "button";
    return null;
  };

  const DOC = Math.random().toString(36).slice(2);   // this document: a reload gets another
  let lastEls = [];
  const norm = (s) => String(s).replace(/\d+([.,:]\d+)*/g, "#").toLowerCase();
  /** Every control a person could use now, in page order. */
  const collect = () => {
    const out = [], els = [], counts = new Map();
    walk(document.body, (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link") return false;
      if (el.id === "demo-bar") return false;          // the demo's own bar is not the product
      const v = vis(el);
      if (v < 2) return v === 1;
      const kind = kindOf(el);
      if (!kind) return true;
      if (!reachable(el)) return true;
      const region = regionOf(el);
      const label = labelOf(el, kind);
      const type = el.getAttribute("type") || el.getAttribute("role") || "";
      const key = [region, kind, tag, norm(label), type].join("|");
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      const r = el.getBoundingClientRect();
      const d = { sig: key + "#" + n, key, nth: n, region, kind, tag, label, type, name: nameOf(el),
                  disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"), readonly: !!el.readOnly,
                  focusable: el.tabIndex >= 0, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      if (kind === "link") { d.href = el.getAttribute("href"); d.target = el.getAttribute("target") || ""; }
      if (kind === "select") d.options = [...el.options].map((o) => o.value);
      if (kind === "number" || kind === "range") { d.min = el.min; d.max = el.max; d.step = el.step; }
      if (kind === "text") d.numeric = /numeric|decimal/.test(el.getAttribute("inputmode") || "") || (el.value !== "" && el.value !== undefined && !isNaN(Number(el.value)));
      if (kind === "file") d.accept = el.getAttribute("accept") || "";
      if (kind === "other") d.inputType = type;
      if (el.classList.contains("tab")) d.tab = true;
      if (el.classList.contains("navbtn") || el.classList.contains("mobile-bottom-nav-btn")) d.nav = true;
      out.push(d); els.push(el);
      return true;
    });
    for (const d of out) d.same = counts.get(d.key);
    lastEls = els;
    return out;
  };
  const find = (sig) => {
    const list = collect();
    const i = list.findIndex((d) => d.sig === sig);
    return i < 0 ? null : lastEls[i];
  };
  const candidates = () => new Set(lastEls);

  /** Bring a control into view and say where to press it: a point that hits
   *  it (not a control inside it, not something lying over it). */
  const aim = (sig) => {
    const el = find(sig);
    if (!el) return { found: false };
    const cands = candidates();
    try { el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); } catch (_) { el.scrollIntoView(); }
    const r = el.getBoundingClientRect();
    const box = { x: Math.max(r.left, 0), y: Math.max(r.top, 0), r: Math.min(r.right, vw()), b: Math.min(r.bottom, vh()) };
    if (box.r - box.x < 2 || box.b - box.y < 2) return { found: true, onscreen: false, rect: [r.left, r.top, r.width, r.height] };
    const fr = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.12, 0.2], [0.88, 0.2], [0.12, 0.8], [0.88, 0.8], [0.04, 0.5], [0.96, 0.5]];
    let cover = null, inner = null;
    for (const [fx, fy] of fr) {
      const x = box.x + (box.r - box.x) * fx, y = box.y + (box.b - box.y) * fy;
      const hit = deepHit(x, y);
      if (!hit) continue;
      const lab = hit.closest && hit.closest("label");
      if (!within(hit, el) && !(lab && lab.control === el)) { cover = cover || nameOf(hit) + " " + JSON.stringify(textOf(hit).slice(0, 40)); continue; }
      // The nearest control at that point must be this one.
      let owner = hit;
      while (owner && owner !== el && !cands.has(owner)) owner = parentOf(owner);
      if (owner !== el && within(hit, el)) { inner = inner || [x, y]; continue; }
      return { found: true, onscreen: true, x, y, rect: [r.left, r.top, r.width, r.height] };
    }
    if (inner) return { found: true, onscreen: true, x: inner[0], y: inner[1], rect: [r.left, r.top, r.width, r.height], innerOnly: true };
    return { found: true, onscreen: true, covered: cover || "something else", x: (box.x + box.r) / 2, y: (box.y + box.b) / 2, rect: [r.left, r.top, r.width, r.height] };
  };

  // ── What is lying over the page ───────────────────────────────────────────
  const CHROME = ["#toast", ".toast", ".mobile-topbar", ".mobile-bottom-nav", "#demo-bar", ".desktop-topbar", ".status-dot"];
  let lastOverlays = [];
  const overlays = () => {
    const out = [], els = [];
    const area = vw() * vh();
    walk(document.body, (el) => {
      if (el.id === "demo-bar") return false;
      const v = vis(el);
      if (v < 2) return v === 1;
      const cs = getComputedStyle(el);
      const dialog = el.matches("[role=dialog],[role=alertdialog],[role=menu],dialog[open],[aria-modal=true]");
      if (!dialog && cs.position !== "fixed" && !(cs.position === "absolute" && Number(cs.zIndex) >= 5)) return true;
      if (CHROME.some((s) => el.matches(s))) return true;
      if (cs.pointerEvents === "none" && !dialog) return true;
      const r = el.getBoundingClientRect();
      const ix = Math.max(0, Math.min(r.right, vw()) - Math.max(r.left, 0)), iy = Math.max(0, Math.min(r.bottom, vh()) - Math.max(r.top, 0));
      // A bar or a rail is part of the page; a sheet, a drawer or a popup covers a good part of it.
      if (ix * iy < Math.max(0.12 * area, 6000) && !dialog) return true;
      if (els.some((o) => within(el, o))) return true;         // part of one already counted
      out.push({ sig: nameOf(el), dialog, full: ix * iy >= 0.9 * area, modal: cs.position === "fixed", rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                 text: textOf(el).slice(0, 80) });
      els.push(el);
      return true;
    });
    lastOverlays = els;
    return out;
  };
  /** Where to click "outside" an overlay: a point on its dimmed surround or beyond it. */
  const outsidePoint = (sig) => {
    const list = overlays();
    const i = list.findIndex((o) => o.sig === sig);
    if (i < 0) return null;
    const ov = lastOverlays[i];
    const pts = [[6, 6], [vw() - 6, 6], [6, vh() - 6], [vw() - 6, vh() - 6], [vw() / 2, 6], [vw() / 2, vh() - 6], [6, vh() / 2], [vw() - 6, vh() / 2]];
    for (const [x, y] of pts) {
      const hit = deepHit(x, y);
      if (!hit) continue;
      if (within(hit, document.getElementById("demo-bar"))) continue;
      if (!within(hit, ov)) return { x, y, on: "page" };
      if (hit === ov && !ov.children.length) return { x, y, on: "backdrop" };     // the overlay is a backdrop
      // Its own surround: the overlay element itself, or a backdrop child nearly as big as the screen.
      const r = hit.getBoundingClientRect();
      if (hit === ov && ov.children.length && [...ov.children].every((c) => { const b = c.getBoundingClientRect(); return !(x >= b.left && x <= b.right && y >= b.top && y <= b.bottom); })) return { x, y, on: "surround" };
      if (hit !== ov && r.width * r.height >= 0.85 * vw() * vh() && !hit.children.length) return { x, y, on: "backdrop" };
    }
    return null;
  };
  const CLOSE_WORD = /^(close|cancel|done|ok|okay|got it|dismiss|back|not now|skip|later|no thanks|no, thanks|×|✕|✖|✗|x|hide|finish|exit)$/i;
  /** The signature of an overlay's own close control, if it has one. */
  const closeControl = (sig) => {
    const list = overlays();
    const i = list.findIndex((o) => o.sig === sig);
    if (i < 0) return null;
    const ov = lastOverlays[i];
    const ctrls = collect();
    let best = null;
    ctrls.forEach((d, k) => {
      if (d.disabled || !within(lastEls[k], ov)) return;
      const el = lastEls[k];
      const words = [d.label, el.getAttribute("title") || "", el.getAttribute("aria-label") || ""].map((s) => s.trim());
      const score = words.some((w) => CLOSE_WORD.test(w)) ? 2 : (clsOf(el).some((c) => /close|dismiss/i.test(c)) || words.some((w) => /\bclose\b/i.test(w))) ? 1 : 0;
      if (score && (!best || score > best.score)) best = { score, sig: d.sig, label: d.label };
    });
    return best;
  };

  // ── What the page says ────────────────────────────────────────────────────
  const JUNK = [[/\bundefined\b/, "undefined"], [/\bNaN\b/, "NaN"], [/\[object [A-Za-z]+\]/, "[object Object]"], [/\bnull\b/, "null"],
                [/\$\{[^}]*\}/, "an unfilled ${…}"], [/\{[a-z_]+\}/, "an unfilled {name}"], [/%[sd]\b/, "an unfilled %s"]];
  const BUSY = /\b(loading|working|saving|checking|fetching|generating|uploading|scanning|searching|waiting|please wait|one moment|just a moment)\b[^.!?\n]{0,60}(…|\.\.\.)/i;
  const texts = () => {
    const junk = [], busy = [];
    let chars = 0, media = 0;
    const seen = new Set();
    const note = (list, what, text, el) => {
      const row = what + "|" + text;
      if (seen.has(row)) return;
      seen.add(row);
      list.push({ what, text: text.slice(0, 140), at: el ? nameOf(el) : "" });
    };
    const scan = (text, el) => {
      const s = text.replace(/\s+/g, " ").trim();
      if (!s) return;
      chars += s.length;
      for (const [re, what] of JUNK) if (re.test(s)) note(junk, what, s, el);
      if (BUSY.test(s)) note(busy, "busy", s, el);
    };
    walk(document.body, (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || el.id === "demo-bar") return false;
      const v = vis(el);
      if (v < 2) return v === 1;
      if (tag === "canvas" || tag === "svg" || tag === "img" || tag === "video") media += 1;
      if (tag === "input" && !["checkbox", "radio", "range", "file", "hidden", "color"].includes(el.type)) scan(String(el.value || ""), el);
      else if (tag === "select") scan(el.selectedOptions[0] ? el.selectedOptions[0].textContent : "", el);
      else if (tag === "textarea") scan(String(el.value || ""), el);
      else if (tag === "code" || tag === "pre") return false;          // raw data shown on purpose
      else for (const n of el.childNodes) if (n.nodeType === 3) scan(n.nodeValue, el);
      if (clsOf(el).some((c) => /^(spinner|skeleton|loading)$/i.test(c))) note(busy, "busy", "." + clsOf(el).join(".") + " " + textOf(el).slice(0, 60), el);
      return true;
    });
    return { junk, busy, chars, media };
  };

  const hscroll = () => {
    const w = vw();
    const de = document.documentElement;
    const out = [];
    if (de.scrollWidth > w + 1) out.push({ at: "page", by: de.scrollWidth - w });
    walk(document.body, (el) => {
      if (el.id === "demo-bar") return false;
      const v = vis(el);
      if (v < 2) return v === 1;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // A box as wide as the screen that scrolls sideways: the page itself moves under the thumb.
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && r.width >= w * 0.9 && el.scrollWidth > el.clientWidth + 1 && r.height >= vh() * 0.5) {
        out.push({ at: nameOf(el), by: el.scrollWidth - el.clientWidth });
      }
      return true;
    });
    if (!out.length) return out;
    // What sticks out: the widest thing past the right edge that no scrolling box of its own holds.
    let worst = null;
    walk(document.body, (el) => {
      if (el.id === "demo-bar") return false;
      const v = vis(el);
      if (v < 2) return v === 1;
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && r.width < w * 3) {
        let held = false;
        for (let p = parentOf(el); p; p = parentOf(p)) {
          const cs = getComputedStyle(p), pr = p.getBoundingClientRect();
          if (cs.overflowX !== "visible" && pr.width < w * 0.9) { held = true; break; }
        }
        if (!held && (!worst || r.right > worst.right) && el.children.length < 4) worst = { right: r.right, name: nameOf(el), text: textOf(el).slice(0, 50) };
      }
      return true;
    });
    if (worst) out[0].widest = `${worst.name} ${JSON.stringify(worst.text)} reaches ${Math.round(worst.right)}px`;
    return out;
  };

  const focusNow = () => {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    if (!a || a === document.body || a === document.documentElement) return { where: "nowhere" };
    if (a.shadowRoot) return { where: "nowhere", host: nameOf(a) };       // a shadow host with nothing focused inside it
    return { where: nameOf(a), label: textOf(a).slice(0, 40), shown: shown(a) };
  };

  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };

  /** One look at the page: its controls, overlays, text, focus and what was sent. */
  const look = (opts = {}) => {
    const controls = collect();
    const ovs = overlays();
    const t = texts();
    const toastEl = (() => { let f = null; walk(document.body, (el) => { if (!f && el.id === "toast" && shown(el)) f = el; return !f; }); return f; })();
    const content = (() => { let f = null; walk(document.body, (el) => { if (!f && (el.id === "content" || el.tagName.toLowerCase() === "padspan-lights-app")) f = el; return !f; }); return f; })();
    let blank = false;
    if (content) {
      const r = content.getBoundingClientRect();
      const inner = content.shadowRoot || content;
      let n = 0, chars = 0, media = 0;
      walk(inner, (el) => { const v = vis(el); if (!v) return false; if (v === 2) { n += 1; const tg = el.tagName.toLowerCase(); if (["canvas", "svg", "img"].includes(tg)) media += 1; for (const c of el.childNodes) if (c.nodeType === 3) chars += c.nodeValue.trim().length; } return true; });
      blank = r.width < 10 || r.height < 10 || (chars < 8 && media === 0);
    } else blank = true;
    const volatile = new Set(opts.volatile || []);
    const stable = controls.filter((c) => !volatile.has(c.sig)).map((c) => c.sig + (c.disabled ? "!" : ""));
    const app = document.querySelector("padspan-ha-app");
    return { url: location.pathname + location.search, doc: DOC, view: (app && app.state && app.state.view) || "", controls, overlays: ovs, junk: t.junk, busy: t.busy, blank, hscroll: hscroll(), focus: focusNow(),
             toast: toastEl ? { text: textOf(toastEl), error: toastEl.classList.contains("error") } : null,
             fp: hash(location.search + "\n" + stable.join("\n") + "\n" + ovs.map((o) => o.sig).join("\n")),
             errors: errors.length, opened: opened.length, ws: ws.length, ready: document.documentElement.dataset.demoReady || "" };
  };

  window.__ct = { look, aim, find, outsidePoint, closeControl, errors, opened, ws,
                  since: (e, o, w) => ({ errors: errors.slice(e), opened: opened.slice(o), ws: ws.slice(w) }) };
})();
