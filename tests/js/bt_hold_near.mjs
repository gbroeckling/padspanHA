// Bluetooth → Scanners: "Find the one in your hand" (Ben Hines, 2026-10-13:
// tagging a device in hand is unworkable among 2,000). holdNearRank and the box.
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const BT = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/bluetooth.js").href);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c))); else n.appendChild(c); }
  return n;
}
const esc = (s) => String(s ?? "");
const R = BT.holdNearRank({ "AA": -80, "BB": -60, "CC": -75 }, [
  { address: "aa", rssi: -48 },   // +32, held
  { address: "BB", rssi: -58 },   // +2, background
  { address: "CC", rssi: -72 },   // +3 and weak
  { address: "DD", rssi: -55 },   // not heard at Start: new
  { address: "EE", rssi: -90 },   // new but far
]);
const rank = R.map(r => [String(r.ad.address).toUpperCase(), Math.round(r.jump), r.fresh]);

const ads = [{ address: "AA:00:00:00:00:01", source: "kit", rssi: -45, age_s: 1, name: "AA:00:00:00:00:01" },
             { address: "AA:00:00:00:00:02", source: "kit", rssi: -70, age_s: 1, name: "AA:00:00:00:00:02" }];
const tagged = [];
function draw(hold) {
  const recorder = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : recorder() });
  const state = { btTab: "scanners", _scannerSel: "kit", dataMode: "live", settings: {}, _holdNear: hold,
    live: { snapshot: { ble: { radios: [{ source: "kit", name: "kit (AA:BB:CC:DD:EE:FF)", display_name: "Kitchen proxy", area_name: "Kitchen" }],
      advertisements: ads, diag: { ok: true, errors: [] } }, objects: { list: [] } } } };
  const helpers = new Proxy({ el, esc, helpBtn: () => el("button", {}, "?"), radioShortId: s => s, isScanner: () => false, roomColor: () => "#fff" }, { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ followedHas: () => false, showObjectDetail: () => {}, tagObjectPrompt: (a) => tagged.push(a), renderRooms: () => {} }, { get: (t, k) => k in t ? t[k] : recorder() });
  const ctx = { hass: { states: {} }, state, helpers, actions, toast: () => {} };
  const node = BT.render(ctx);
  const ser = (n) => { if (!n) return ""; let out = (n._html || "") + (n._text || "") + " " + Object.entries(n.attributes || n._attrs || {}).map(([k,v]) => k+"="+v).join(" "); for (const c of (n.children || n.childNodes || [])) out += " " + ser(c); return out; };
  return { node, html: ser(node), state };
}
const idle = draw(null).html;
const live = draw({ src: "kit", at: Date.now() - 25000, base: { "AA:00:00:00:00:01": -80, "AA:00:00:00:00:02": -72 } }).html;
console.log(JSON.stringify({ rank, idleStart: /Find the one in your hand/.test(idle) && /Start/.test(idle),
  liveJump: /\+35 dB/.test(live), liveOnlyHeld: !/AA:00:00:00:00:02[^]*\+2 dB/.test(live), tagBtn: /Tag/.test(live),
  oneName: /Kitchen proxy/.test(idle) }));
