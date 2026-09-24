// R9 repro: Bluetooth tab with a moved Find My tag (object address = first address A,
// live address B only in all_addresses / current_address) — as snapshot_builder B2 now builds it.
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
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const A = "D1:11:11:11:11:11", B = "E2:22:22:22:22:22";
const obj = { key: "ble:" + A, kind: "private_ble", address: A, canonical_id: A, all_addresses: [B, A], current_address: B,
  findmy: true, bridge_match: true, name: A, user_label: "Keys", identified: true, room: "Office", rssi: -52, age_s: 1 };
const xref = { key: obj.key, kind: "private_ble", label: "Keys", identified: true, room: "Office", canonical_id: A, all_addresses: [B, A], findmy: true };
const ads = ["kit", "off"].map((s, i) => ({ address: B, source: s, rssi: i ? -52 : -80, age_s: 1, name: B, _xref: xref, area_name: i ? "Office" : "Kitchen" }))
  // The address it was named by, lingering in HA's list after the change.
  .concat([{ address: A, source: "kit", rssi: -50, age_s: 400, name: A, _xref: xref, area_name: "Kitchen" }]);
function draw(btTab, quiet, followed, selectedAddr) {
  const recorder = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : recorder() });
  const state = { btTab, dataMode: "live", settings: { quiet_mode: quiet }, btSelectedAddr: selectedAddr || null,
    live: { snapshot: { ble: { radios: [{ source: "kit", name: "kit", area_name: "Kitchen" }, { source: "off", name: "off", area_name: "Office" }], advertisements: ads, diag: { ok: true, errors: [] } },
      objects: { list: [obj] } } } };
  const helpers = new Proxy({ el, esc, helpBtn: () => el("button", {}, "?"), radioShortId: s => s, isScanner: () => false, roomColor: () => "#fff" }, { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ followedHas: (a) => followed.has(String(a).toUpperCase()), showObjectDetail: () => {}, tagObjectPrompt: () => {} }, { get: (t, k) => k in t ? t[k] : recorder() });
  const ctx = { hass: { states: {} }, state, helpers, actions, toast: () => {} };
  const node = BT.render(ctx);
  const ser = (n) => { if (!n) return ""; let out = (n._html || "") + (n._text || "") + " " + Object.entries(n.attributes || n._attrs || {}).map(([k,v]) => k+"="+v).join(" "); for (const c of (n.children || n.childNodes || [])) out += " " + ser(c); return out; };
  const html = ser(node);
  return html;
}
const followed = new Set([A]);
const viz = draw("visualization", false, followed);
const vizQ = draw("visualization", true, followed);
const mon = draw("monitor", false, followed);
// The Unlink button: on the live address's row only (round 10).
const onLive = draw("monitor", false, followed, B);
const onNamed = draw("monitor", false, followed, A);
console.log(JSON.stringify({ named: /Keys/.test(viz), quietShown: vizQ.includes(B) || /Keys/.test(vizQ),
  findMyBadge: /Find My/.test(mon), irk: /IRK-resolved/.test(mon),
  unlinkOnLive: /Unlink/.test(onLive), unlinkOnNamed: /Unlink/.test(onNamed) }));
