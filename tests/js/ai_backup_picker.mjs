// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → AI's Backup AI task picker (ws_house3d_photo.ask_ai), RUN rather
// than read: under the main one, the same ai_task.* list with the main one
// hidden, "None" first and chosen until someone picks one, one line of help,
// saved on its own; a main changed to the backup's entity leaves no backup.
// The pytest wrapper is tests/test_ai_backup.py.
//
// Run:  node tests/js/ai_backup_picker.mjs <repo-root>
import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const { install } = await import(pathToFileURL(ROOT + "/tests/js/dom_shim.mjs").href);
install(globalThis);
const SET = await import(pathToFileURL(ROOT + "/custom_components/padspan_ha/www/padspan-ha/views/settings.js").href);

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail: ok ? undefined : detail }; };

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "id") n.id = v; else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) { if (c == null) continue; n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); }
  return n;
}
const quiet = () => new Proxy(() => document.createElement("span"), {
  get: (_t, k) => (k === "then" ? undefined : (k === Symbol.toPrimitive || k === "toString") ? () => "" : quiet()),
  apply: () => document.createElement("span"),
});
const all = (n, out = []) => { for (const c of (n.childNodes || n.children || [])) { out.push(c); all(c, out); } return out; };
const text = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
const tag = (n) => (n.tagName || n.localName || "").toUpperCase();

const AI_STATES = {
  "ai_task.mac_vision": { attributes: { friendly_name: "Mac vision" } },
  "ai_task.server_vision": { attributes: { friendly_name: "Server vision" } },
  "light.kitchen": { attributes: { friendly_name: "Kitchen" } },
};

function render(settings) {
  const calls = [];
  const s = {
    dataMode: "live", _dataModeKnown: true, complexity: "advanced", view: "settings", _settingsTab: "ai", version: "0", buildId: "b",
    settings: { tier: "pro", edition: "full", ...settings }, followedAddrs: new Set(), timing: {}, roomTagMap: {}, wsCounts: {},
    model: { floors: [], areas: [], room_meta: {}, room_geometry_m: {}, map_transforms: {} }, maps: { list: [] },
    live: { snapshot: { ble: { radios: [] }, objects: { list: [], summary: {} }, tags: [] } },
  };
  const actions = {
    wsCall: async (type, p) => {
      calls.push([type, p]);
      const out = { ...s.settings, ...p };
      // The server's rule (ws_settings): a backup the same as the main one is none.
      if (out.atlas_3d_ai_task_backup_entity === out.atlas_3d_ai_task_entity) out.atlas_3d_ai_task_backup_entity = "";
      return { settings: out };
    },
    canOpen: () => true,
  };
  const helpers = new Proxy({ el, esc: (x) => String(x ?? ""), helpBtn: () => el("button", {}, "?"), HELP: {} },
    { get: (t, k) => (k in t ? t[k] : quiet()) });
  const ctx = new Proxy({ hass: { states: AI_STATES, user: { is_admin: true }, connection: { sendMessagePromise: async () => ({}) } },
    state: s, helpers, actions: new Proxy(actions, { get: (t, k) => (k in t ? t[k] : quiet()) }),
    toast: (m) => calls.push(["toast", String(m)]) }, { get: (t, k) => (k in t ? t[k] : quiet()) });
  return { root: SET.render(ctx), calls, ctx };
}
const selects = (root) => all(root).filter(n => tag(n) === "SELECT");
const backupSel = (root) => all(root).find(n => n.getAttribute && n.getAttribute("data-ai-backup") !== null) || null;
const options = (sel) => (sel ? sel.children : []).map(o => ({ value: o.getAttribute("value"), text: text(o), hidden: !!o.hidden }));

{
  // An existing install: a main one chosen, no backup (the default).
  const { root } = render({ atlas_3d_ai_task_entity: "ai_task.mac_vision" });
  const bk = backupSel(root);
  const opts = options(bk);
  check("picker: a Backup AI task picker is drawn", !!bk && /Backup AI task/.test(text(root)), text(root).slice(0, 300));
  const sels = selects(root);
  check("picker: it comes right after the main AI Task picker", !!bk && sels.indexOf(bk) === 1 && sels[0].value === "ai_task.mac_vision",
    sels.map(x => x.getAttribute("data-ai-backup")));
  check("picker: None first and chosen when no backup is set", opts[0] && opts[0].value === "" && opts[0].text === "None" && bk.value === "", opts);
  check("picker: only ai_task.* entities, the main one hidden",
    opts.filter(o => o.value && !o.hidden).map(o => o.value).join(",") === "ai_task.server_vision"
    && opts.some(o => o.value === "ai_task.mac_vision" && o.hidden) && !opts.some(o => o.value === "light.kitchen"), opts);
  check("picker: its one line of help", /Used when the main one can't be reached, e\.g\. a computer that's away\./.test(text(root)), text(root));
}
{
  // Picking a backup saves that setting alone.
  const { root, calls } = render({ atlas_3d_ai_task_entity: "ai_task.mac_vision" });
  const bk = backupSel(root);
  bk.value = "ai_task.server_vision";
  bk.dispatchEvent(new Event("change"));
  await settle();
  const saved = calls.filter(c => c[0] === "padspan_ha/settings_set");
  check("picker: choosing one saves atlas_3d_ai_task_backup_entity alone",
    saved.length === 1 && JSON.stringify(saved[0][1]) === JSON.stringify({ atlas_3d_ai_task_backup_entity: "ai_task.server_vision" }), saved);
}
{
  // A backup set: shown chosen; the main changed to it leaves no backup.
  const { root } = render({ atlas_3d_ai_task_entity: "ai_task.mac_vision", atlas_3d_ai_task_backup_entity: "ai_task.server_vision" });
  const bk = backupSel(root), main = selects(root)[0];
  check("picker: a chosen backup shows as chosen", bk.value === "ai_task.server_vision", bk.value);
  main.value = "ai_task.server_vision";
  main.dispatchEvent(new Event("change"));
  await settle();
  const opts = options(bk);
  check("picker: a main one changed to the backup's entity leaves None, the new main hidden",
    bk.value === "" && opts.some(o => o.value === "ai_task.server_vision" && o.hidden)
    && opts.some(o => o.value === "ai_task.mac_vision" && !o.hidden), [bk.value, opts]);
}

console.log(JSON.stringify(results));
