// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// A DOM big enough to render a view into, and no bigger.
//
// The views build their output with document.createElement and string SVG.
// Nothing here lays anything out or paints — the harness is looking for code
// that THROWS, not for pixels — so an element is a bag of the properties the
// views actually touch, and the tree is real enough that appendChild,
// replaceChildren and querySelector behave.
//
// Two things it does NOT do, on purpose:
//   * alert/confirm/prompt never block. In a browser they freeze everything;
//     here they answer immediately so a render that asks a question still
//     completes and can be checked.
//   * requestAnimationFrame does not fire on its own. It queues, and the
//     driver flushes it — deferred work is precisely where the bugs this
//     harness exists for have been hiding.

export const rafQueue = [];
export const timerQueue = [];

let _idSeq = 0;

class ClassList {
  constructor(node) { this._n = node; }
  get _set() { return new Set(String(this._n.className || "").split(/\s+/).filter(Boolean)); }
  _write(s) { this._n.className = [...s].join(" "); }
  add(...c) { const s = this._set; c.forEach(x => s.add(x)); this._write(s); }
  remove(...c) { const s = this._set; c.forEach(x => s.delete(x)); this._write(s); }
  toggle(c, force) {
    const s = this._set;
    const on = force === undefined ? !s.has(c) : !!force;
    on ? s.add(c) : s.delete(c);
    this._write(s);
    return on;
  }
  contains(c) { return this._set.has(c); }
  get value() { return this._n.className; }
}

class Style {
  constructor() { this._p = {}; }
  setProperty(k, v) { this._p[k] = v; }
  removeProperty(k) { delete this._p[k]; }
  getPropertyValue(k) { return this._p[k] ?? ""; }
  get cssText() { return Object.entries(this._p).map(([k, v]) => `${k}:${v}`).join(";"); }
  set cssText(v) { this._p = {}; String(v || "").split(";").forEach(d => {
    const i = d.indexOf(":"); if (i > 0) this._p[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }); }
}

// Any style property a view sets (style.width = ...) has to stick without the
// shim needing to know its name, so unknown keys fall through to the bag.
function styleProxy() {
  const s = new Style();
  return new Proxy(s, {
    get(t, k) { return k in t ? t[k] : (t._p[String(k)] ?? ""); },
    set(t, k, v) { if (k in t) { t[k] = v; } else { t._p[String(k)] = v; } return true; },
  });
}

class Node {
  constructor(tag, ns) {
    this.tagName = String(tag || "").toUpperCase();
    this.localName = String(tag || "");
    this.namespaceURI = ns || null;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.attributes = {};
    this.style = styleProxy();
    this.dataset = {};
    this.className = "";
    this.id = "";
    this._text = "";
    this._html = "";
    this._listeners = {};
    this.classList = new ClassList(this);
    this._value = "";
    this.checked = false;
    this.disabled = false;
    this.selected = false;
    this.width = 300;
    this.height = 150;
    this.offsetWidth = 800;
    this.offsetHeight = 600;
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.files = [];
    this.options = [];
  }

  // ── tree ──
  appendChild(c) { if (!c) return c; c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(typeof c === "string" ? new Text(c) : c)); }
  prepend(...cs) { cs.reverse().forEach(c => { c.parentNode = this; this.children.unshift(c); }); }
  insertBefore(c, ref) {
    const i = this.children.indexOf(ref);
    c.parentNode = this;
    i < 0 ? this.children.push(c) : this.children.splice(i, 0, c);
    return c;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...cs) { this.children.length = 0; cs.forEach(c => this.appendChild(c)); }
  cloneNode() { const n = new Node(this.localName, this.namespaceURI); n.className = this.className; return n; }
  contains(n) { return n === this || this._all().includes(n); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstElementChild() { return this.children.find(c => c instanceof Node) || null; }
  get parentElement() { return this.parentNode; }
  get nextSibling() {
    const s = this.parentNode?.children || []; return s[s.indexOf(this) + 1] || null;
  }

  _all(out = []) { for (const c of this.children) { out.push(c); c._all?.(out); } return out; }

  // A <select> reports the value of its SELECTED <option>; the views read
  // tgtSel.value / refSel.value to decide which map they are acting on, so the
  // flat "" this used to hand back sent every one of those branches down the
  // "no such map" path and made them untestable.
  get value() {
    if (this.localName === "select" && this._value === "") {
      const o = this.children.find(c => c.selected) || this.children[0];
      return o ? o.value : "";
    }
    return this._value;
  }
  set value(v) { this._value = String(v ?? ""); }

  // ── attributes ──
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === "class") this.className = String(v);
    if (k === "id") this.id = String(v);
    if (k.startsWith("data-")) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  setAttributeNS(_ns, k, v) { this.setAttribute(k, v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  removeAttribute(k) { delete this.attributes[k]; }

  // ── content ──
  get textContent() {
    if (this._text) return this._text;
    return this.children.map(c => c.textContent ?? "").join("");
  }
  set textContent(v) { this._text = String(v ?? ""); this.children.length = 0; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v ?? ""); this.children.length = 0; }
  get outerHTML() { return this._html; }
  insertAdjacentHTML(_pos, html) { this._html += String(html ?? ""); }

  // ── queries ──
  // Selector support is deliberately shallow: id, class and tag. A view that
  // needs more gets null, which is the same thing it gets in a browser when
  // the node is not there yet, and every view already handles that.
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const s = String(sel || "").trim().split(/\s*,\s*/)[0];
    const all = this._all();
    if (s.startsWith("#")) return all.filter(n => n.id === s.slice(1));
    if (s.startsWith(".")) return all.filter(n => n.classList?.contains?.(s.slice(1)));
    return all.filter(n => n.localName === s);
  }
  closest(sel) {
    let n = this;
    while (n) { if (n.querySelectorAll && [n].concat().some(() => false)) break; n = n.parentNode; }
    return null;
  }

  // ── events ──
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) {
    this._listeners[t] = (this._listeners[t] || []).filter(f => f !== fn);
  }
  dispatchEvent(e) { (this._listeners[e?.type] || []).forEach(f => f(e)); return true; }
  click() { this.dispatchEvent({ type: "click", stopPropagation() {}, preventDefault() {} }); }
  focus() {} blur() {} scrollIntoView() {} select() {}
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 };
  }
  // Canvas: views that measure text or draw thumbnails must not explode.
  getContext() {
    return new Proxy({}, {
      get: (_t, k) => (k === "canvas" ? this
        : k === "measureText" ? (() => ({ width: 10 }))
        : k === "getImageData" ? (() => ({ data: new Uint8ClampedArray(4) }))
        : k === "createLinearGradient" || k === "createRadialGradient"
          ? (() => ({ addColorStop() {} }))
        : (() => undefined)),
      set: () => true,
    });
  }
  toDataURL() { return "data:image/png;base64,"; }
}

class Text extends Node {
  constructor(t) { super("#text"); this._text = String(t ?? ""); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v ?? ""); }
}

export function install(globalObj = globalThis) {
  const document = new Node("#document");
  document.body = new Node("body");
  document.documentElement = new Node("html");
  document.head = new Node("head");
  document.appendChild(document.documentElement);
  document.documentElement.appendChild(document.body);
  document.createElement = (t) => new Node(t);
  document.createElementNS = (ns, t) => new Node(t, ns);
  document.createTextNode = (t) => new Text(t);
  document.createDocumentFragment = () => new Node("#fragment");
  document.getElementById = (id) => document.querySelector("#" + id);
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  document.execCommand = () => true;
  document.activeElement = document.body;

  globalObj.document = document;
  globalObj.Node = Node;
  globalObj.Element = Node;
  globalObj.HTMLElement = Node;
  globalObj.SVGElement = Node;

  globalObj.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
  globalObj.cancelAnimationFrame = (id) => { rafQueue[id - 1] = null; };

  // Timers queue rather than fire, for the same reason rAF does: the driver
  // decides when deferred work runs, so a render that defers its real work
  // cannot quietly pass by never doing it.
  const realSetTimeout = globalObj.setTimeout;
  globalObj.setTimeout = (fn, ms = 0, ...a) => {
    timerQueue.push({ fn, ms, a });
    return timerQueue.length;
  };
  globalObj.clearTimeout = (id) => { if (timerQueue[id - 1]) timerQueue[id - 1] = null; };
  globalObj.setInterval = () => 0;          // nothing here runs long enough to need one
  globalObj.clearInterval = () => {};
  globalObj._realSetTimeout = realSetTimeout;

  globalObj.getComputedStyle = () => ({ getPropertyValue: () => "", width: "800px", height: "600px" });
  globalObj.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalObj.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalObj.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalObj.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalObj.customElements = { define() {}, get() { return undefined; }, whenDefined: () => Promise.resolve() };
  globalObj.devicePixelRatio = 1;
  globalObj.innerWidth = 1280;
  globalObj.innerHeight = 900;
  globalObj.scrollTo = () => {};
  globalObj.addEventListener = () => {};
  globalObj.removeEventListener = () => {};
  globalObj.localStorage = {
    _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }, clear() { this._d = {}; },
  };
  // Node defines `navigator` as a getter-only global, so assignment throws.
  // Define over it instead of assigning; anything else the runtime already
  // owns gets the same treatment.
  const define = (k, v) => {
    try { globalObj[k] = v; }
    catch { Object.defineProperty(globalObj, k, { value: v, configurable: true, writable: true }); }
  };
  define("navigator", { userAgent: "padspan-smoke", clipboard: { writeText: async () => {} }, language: "en" });
  // These are the ones that would hang a headless run forever.
  globalObj.alert = () => {};
  globalObj.confirm = () => true;
  globalObj.prompt = () => "";
  globalObj.URL = globalObj.URL || {};
  globalObj.URL.createObjectURL = () => "blob:padspan/" + (++_idSeq);
  globalObj.URL.revokeObjectURL = () => {};
  globalObj.window = globalObj;
  globalObj.self = globalObj;

  return document;
}

/** Run everything the render deferred, repeatedly, until it stops queueing. */
export async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    const rafs = rafQueue.splice(0, rafQueue.length).filter(Boolean);
    const timers = timerQueue.splice(0, timerQueue.length).filter(Boolean);
    if (!rafs.length && !timers.length) break;
    for (const fn of rafs) await fn(i * 16);
    for (const t of timers.sort((a, b) => a.ms - b.ms)) await t.fn(...t.a);
    await new Promise(r => globalThis._realSetTimeout(r, 0));
  }
}
