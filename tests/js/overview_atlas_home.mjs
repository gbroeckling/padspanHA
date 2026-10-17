// Settings → UI Structure → "Show the Atlas as Overview" (Pro): Overview is
// the sidebar's Atlas page, one element kept across redraws; Pure Live's switch
// picks Pure Live or the classic Overview.
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const OV = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/overview.js").href);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
  return n;
}
let renders = 0; const events = [];
const ctx = (tier, on) => ({ hass: { states: {} }, toast: () => {},
  state: { settings: { tier, overview_atlas: on }, live: { snapshot: null } },
  helpers: { el }, actions: { renderRooms: () => { renders++; }, telemetryEvent: (n) => events.push(n) } });
const pro = ctx("pro", true);
const a = OV.render(pro), b = OV.render(pro);
const appA = a.querySelector ? a.querySelector("padspan-lights-app") : null;
const tagOf = (n) => n && n.children && n.children[0] ? String(n.children[0].tagName || n.children[0].nodeName).toLowerCase() : "";
const out = {
  proOn: OV.atlasHomeOn(pro), freeOn: OV.atlasHomeOn(ctx("free", true)), proOff: OV.atlasHomeOn(ctx("pro", false)),
  bright: OV.atlasHomeOn(ctx("bright", true)),
  atlasTag: tagOf(a), sameElement: a.children[0] === b.children[0], noDots: pro.state._isoUpdateObjects === null,
};
const sw = OV.liveSwitch(pro);
const btns = sw.children;
btns[1].dispatchEvent(new Event("click"));
out.classicAfter = pro.state._liveClassic === true;
btns[0].dispatchEvent(new Event("click"));
out.liveAfter = pro.state._liveClassic === false;
out.renders = renders; out.events = events;
console.log(JSON.stringify(out));
