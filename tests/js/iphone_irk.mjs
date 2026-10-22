// The iPhone setup path (#69): with iphone_irk_guide on, the phone wizard's
// iPhone path walks through the IRK and never says "BLE Transmitter"; off,
// the IRK Manager renders exactly as before, and the Android path never moves.
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const VIEWS = ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/";
const BT = await import(pathToFileURL(VIEWS + "bluetooth.js").href);
const IP = await import(pathToFileURL(VIEWS + "iphone_irk.js").href);
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
const calls = [];
function draw(settings) {
  const recorder = () => new Proxy(() => document.createElement("span"), { get: (t, k) => k === "then" ? undefined : recorder() });
  const state = { btTab: "irk_panel", dataMode: "live", settings,
    _irkPanelStatus: { devices: [], rpa_count: 3, total_ble_addresses: 9, mobile_apps: ["Garry's iPhone", "Pixel 8"], has_private_ble_integration: true },
    live: { snapshot: { ble: { radios: [], advertisements: [], diag: { ok: true, errors: [] } }, objects: { list: [] } } } };
  const helpers = new Proxy({ el, esc: s => String(s ?? ""), helpBtn: () => el("button", {}, "?"), radioShortId: s => s, isScanner: () => false, roomColor: () => "#fff" }, { get: (t, k) => k in t ? t[k] : recorder() });
  const actions = new Proxy({ followedHas: () => false, renderRooms: () => {},
    wsCall: async (type, msg) => { calls.push([type, msg]); return { valid: true, matched_count: 2, rpa_count: 5 }; } },
    { get: (t, k) => k in t ? t[k] : recorder() });
  return BT.render({ hass: { states: {} }, state, helpers, actions, toast: () => {} });
}
// The path box whose title reads `title`.
function path(root, title) {
  let hit = null;
  (function walk(n) { if (hit || !n) return; const kids = n.children || [];
    if (kids[0] && kids[0].textContent === title) { hit = n; return; } kids.forEach(walk); })(root);
  return hit;
}
const today = draw({ phone_wizard_enabled: true });
const off = draw({ phone_wizard_enabled: true, iphone_irk_guide: false });
const on = draw({ phone_wizard_enabled: true, iphone_irk_guide: true });
const noWiz = draw({}), noWizOff = draw({ iphone_irk_guide: false }), onlyGuide = draw({ iphone_irk_guide: true });
const iph = path(on, "I have an iPhone");
const btn = iph && (function find(n) { if (n.localName === "button" && n.textContent === "Check") return n; for (const c of n.children || []) { const f = find(c); if (f) return f; } return null; })(iph);
const inp = iph && (function find(n) { if (n.localName === "input") return n; for (const c of n.children || []) { const f = find(c); if (f) return f; } return null; })(iph);
inp.value = "00112233445566778899aabbccddeeff";
btn.click();
await new Promise(r => globalThis._realSetTimeout(r, 20));
const iphText = iph.textContent;
console.log(JSON.stringify({
  offSame: ser(today) === ser(off),
  noWizSame: ser(noWiz) === ser(noWizOff),
  noWizHasNoWizard: !path(noWiz, "I have an iPhone"),
  androidSame: path(today, "I have an Android phone").textContent === path(on, "I have an Android phone").textContent,
  androidSaysTransmitter: /BLE Transmitter/.test(path(on, "I have an Android phone").textContent),
  todayIphoneOld: /Keychain Access/.test(path(today, "I have an iPhone").textContent),
  iphoneNoTransmitter: !/Transmitter/i.test(iphText),
  iphoneSteps: /Private BLE Device/.test(iphText) && /irk-capture/.test(iphText) && /bluetoothd\.plist/.test(iphText),
  detected: /Looks like an iPhone: Garry's iPhone\./.test(iphText),
  checked: calls.length === 1 && calls[0][0] === "padspan_ha/irk_validate" && /It resolves: 2 of 5/.test(iph.textContent),
  onlyGuideShowsPath: !!path(onlyGuide, "I have an iPhone") && /Private BLE Device/.test(path(onlyGuide, "I have an iPhone").textContent),
  alertNoTransmitter: !/Transmitter/i.test(IP.iphoneSetupAlert() + IP.IPHONE_META),
  apple: [
    IP.isApplePhone({ manufacturer: "Apple", model: "iPhone15,2" }),
    IP.isApplePhone({ model: "iPhone 13" }),
    IP.isApplePhone({ os_name: "iOS" }),
    IP.isApplePhone({ device_name: "Garry's iPad" }),
    IP.isApplePhone({ manufacturer: "Google", model: "Pixel 8" }),
    IP.isApplePhone({ manufacturer: "samsung", model: "SM-S911W", device_name: "Galaxy" }),
    IP.isApplePhone({}),
  ],
  guide: [IP.iphoneGuideOn({ iphone_irk_guide: true }), IP.iphoneGuideOn({}), IP.iphoneGuideOn(null), IP.iphoneGuideOn({ iphone_irk_guide: "yes" })],
}));
