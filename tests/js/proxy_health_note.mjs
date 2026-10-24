// Health's "Hearing less than usual" note (proxy_health.py): drawn only for a
// radio whose drop is on; a healthy house's Health view draws exactly as before.
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const H = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/health.js").href);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }
  return n;
}
const ser = (n) => { if (!n) return ""; let out = (n._html || "") + (n._text || "") + " " + Object.entries(n.attributes || n._attrs || {}).map(([k,v]) => k+"="+v).join(" "); for (const c of (n.children || n.childNodes || [])) out += " " + ser(c); return out; };
function draw(radios) {
  const recorder = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : recorder() });
  const state = { view: "health", version: "0.38.165", buildId: "b", dataMode: "live", timing: { lastRefreshMs: 5 },
    live: { snapshot: { rooms: [], tags: [], radios: [], ble: { radios, diag: { ok: true } } } } };
  const helpers = new Proxy({ el, helpBtn: () => el("button", {}, "?"), radioShortId: s => s }, { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ wsCall: () => new Promise(() => {}) }, { get: (t, k) => k in t ? t[k] : recorder() });
  return ser(H.render({ state, helpers, actions, toast: () => {} }));
}
const none = draw([]);
const healthy = draw([{ source: "aa", name: "Kitchen proxy" }, { source: "bb", name: "Hall proxy" }]);
const notFlag = draw([{ source: "aa", name: "Kitchen proxy", adv_rate_low: "yes" }]);
const deaf = draw([{ source: "aa", name: "<b>Kitchen</b> proxy", adv_rate_low: true }, { source: "bb", name: "Hall proxy" }]);
console.log(JSON.stringify({
  healthy_same: healthy === none && notFlag === none,
  healthy_no_note: !healthy.includes("Hearing less"),
  deaf_note: deaf.includes("Hearing less than usual") && deaf.includes("<b>Kitchen</b> proxy") && !deaf.includes("Hall proxy"),
}));
