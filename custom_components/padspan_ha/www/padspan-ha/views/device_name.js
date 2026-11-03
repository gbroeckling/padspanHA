// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * One name for a device on every screen, and how device lists show the rotating
 * addresses a day of phones and PCs leave behind. The server works the name out
 * (device_detail.py); the chain here is only for what never went through it, like
 * Sample mode's objects. Pure but for groupRows' DOM and copyText.
 */

export const UNNAMED = "Unnamed device";

/** The device's one name. */
export function deviceName(o, fallback = UNNAMED){
  if(!o) return fallback;
  if(o.best_name) return o.best_name;
  const named = o.user_label || o.private_ble_name || o.name || o.entity_id || "";
  if(named && String(named).toUpperCase() !== String(o.address || "").toUpperCase()) return String(named);
  return o.company_name ? `${o.company_name} device` : (o.address ? UNNAMED : fallback);
}

/** What the device is, from its broadcast. "Handoff" and the like are message
 *  types, not devices; only what never went through the server shows them. */
export function deviceWhat(o){
  if(!o) return null;
  return o.what_it_is || (o.best_name ? null : (o.auto_class || o.device_type || null));
}

/** "Uses a service from Google", and why that isn't a maker. */
export const serviceWords = (o) => o && o.service_owner ? `Uses a service from ${o.service_owner}` : "";
export const SERVICE_HOW = "It broadcasts a service number Bluetooth assigned to this company. Other makers' devices can use it too, so this doesn't say who made the device.";

const ADDRESS_WORDS = {
  fixed: ["Fixed", "This device keeps one address, so it reads as one device."],
  rotating: ["Rotating", "This device changes its address every so often, as phones and trackers do, so one device can leave many rows."],
};

/** A small Fixed or Rotating badge, or null when no receiver has said. */
export function addressBadge(el, o){
  const word = o && ADDRESS_WORDS[o.address_kind];
  if(!word) return null;
  return el("span", {
    class: "badge",
    style: "font-size:10px;padding:1px 5px;" + (o.address_kind === "fixed"
      ? "background:#1a3a2a;color:#a7f3d0;border-color:#166534" : "background:#2a2a1a;color:#fde68a;border-color:#854d0e"),
    title: word[1],
  }, word[0]);
}

/** How far to fade a row nobody named by how long ago it was heard. */
export function fadeFor(o){
  const age = o && o.age_s;
  if(!o || o.user_label || typeof age !== "number") return 1;
  return age <= 300 ? 1 : age <= 3600 ? 0.8 : age <= 21600 ? 0.62 : 0.5;
}

/** The word a rotating address is grouped under, or null when it stands alone:
 *  only addresses nobody named, and whose best name is no more than their kind.
 *  isKept(o) keeps others out, like a followed device. */
export function groupWord(o, isKept){
  if(!o || o.address_kind !== "rotating" || o.user_label || o.identified) return null;
  if(!["maker", "service", "none", "beacon"].includes(o.name_source)) return null;
  if(isKept && isKept(o)) return null;
  return o.what_it_is || (o.company_name ? `${o.company_name} device` : "") || (o.service_owner ? `${o.service_owner} service` : "") || "unnamed";
}

/** entries in order, with any two or more sharing a word gathered at the place
 *  of the first: [{entry}|{group:{word, entries, newest}}]. Nothing is dropped. */
export function groupDevices(entries, objOf, isKept){
  const byWord = new Map();
  for(const e of entries){
    const word = groupWord(objOf(e), isKept);
    if(!word) continue;
    if(!byWord.has(word)) byWord.set(word, []);
    byWord.get(word).push(e);
  }
  const out = [], placed = new Set();
  for(const e of entries){
    const word = groupWord(objOf(e), isKept);
    const members = word ? byWord.get(word) : null;
    if(!members || members.length < 2){ out.push({ entry: e }); continue; }
    if(placed.has(word)) continue;
    placed.add(word);
    let newest = null;
    for(const m of members){
      const age = objOf(m).age_s;
      if(typeof age === "number" && (newest === null || age < newest)) newest = age;
    }
    out.push({ group: { word, entries: members, newest } });
  }
  return out;
}

const ago = (s) => s == null ? "" : s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;

/** "169 Windows PC addresses", or "3 of 169 ..." while a search narrows them. */
export function groupTitle(group, shown = group.entries.length){
  const n = group.entries.length, count = shown < n ? `${shown} of ${n}` : String(n);
  return `${count} ${group.word} ${n === 1 ? "address" : "addresses"}`;
}

/** A group's clickable head. makeShell(content) puts it in a row of the list's own kind. */
export function groupHead(el, group, open, onToggle, makeShell){
  const title = el("span", { style: "font-weight:600" }, "");
  const when = el("span", { class: "muted", style: "font-size:11px" }, group.newest == null ? "" : `newest ${ago(group.newest)}`);
  const arrow = el("span", { "aria-hidden": "true", style: "display:inline-block;width:14px;font-size:15px;color:#52b788" }, open ? "▾" : "▸");
  const button = el("button", {
    type: "button",
    "aria-expanded": open ? "true" : "false",
    style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;min-height:36px;padding:4px 6px;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer",
    onclick: (e) => { e.stopPropagation(); onToggle(); },
  }, [arrow, title, when]);
  const shell = makeShell(button);
  shell.style.opacity = String(group.newest == null ? 1 : fadeFor({ age_s: group.newest }));
  return { shell, title };
}

/**
 * Gather rows already in `parent`: [{node, obj}]. Rows in a closed group are
 * hidden, not removed, so a list's own filter keeps working: call refresh(searching)
 * right after each pass of it (it reads the display each row was just given), and
 * the group counts what passed. A search opens every group it matches.
 * reapply() runs the list's filter again, after a group opens or closes.
 */
export function groupRows(el, rows, parent, { openKeys, isKept, makeShell, reapply }){
  const groups = [];
  for(const item of groupDevices(rows, r => r.obj, isKept)){
    if(!item.group) continue;
    const group = item.group, key = group.word;
    const head = groupHead(el, group, openKeys.has(key), () => {
      if(openKeys.has(key)) openKeys.delete(key); else openKeys.add(key);
      reapply();
    }, makeShell);
    parent.insertBefore(head.shell, group.entries[0].node);
    let at = head.shell;
    for(const r of group.entries){
      parent.insertBefore(r.node, at.nextSibling);
      at = r.node;
    }
    groups.push({ group, key, head });
  }
  return {
    groups,
    refresh(searching){
      for(const { group, key, head } of groups){
        const shown = group.entries.filter(r => r.node.style.display !== "none").length;
        const open = openKeys.has(key) || (searching && shown > 0);
        head.shell.style.display = shown ? "" : "none";
        head.title.textContent = groupTitle(group, shown);
        const button = head.shell.querySelector("button");
        if(button){
          button.setAttribute("aria-expanded", open ? "true" : "false");
          button.firstChild.textContent = open ? "▾" : "▸";
        }
        if(!open) for(const r of group.entries) r.node.style.display = "none";
      }
    },
  };
}

/** Which receivers heard it, short enough for a list: a device heard by all 18
 *  would otherwise be the tallest thing on the screen. The full list is the title. */
export function firstFew(names, n = 3){
  return names.length <= n ? names.join(", ") : `${names.slice(0, n).join(", ")} +${names.length - n} more`;
}

/** The raw broadcast, as a person can paste it into a bug report. Apple's hashes
 *  of a phone, email or Apple ID were taken out before it was ever stored. */
export function rawBroadcast(o){
  const raw = { address: o.address || "" };
  if(o.address_type) raw.address_type = o.address_type;
  if(o.name && o.name !== o.address) raw.name = o.name;
  for(const k of ["manufacturer_data", "service_data", "service_uuids", "connectable", "tx_power", "espresense_id"]){
    const v = o[k];
    if(v === null || v === undefined) continue;
    if(typeof v === "object" && !Object.keys(v).length) continue;
    raw[k] = v;
  }
  return JSON.stringify(raw, null, 2);
}

/** Copy text; the clipboard API only exists on https or localhost, and Home
 *  Assistant is often plain http. True when it worked. */
export async function copyText(text){
  try {
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch(_e) { /* the old way below */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch(_e) { ok = false; }
  ta.remove();
  return ok;
}
