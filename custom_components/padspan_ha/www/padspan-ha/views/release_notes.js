// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * The release notes, inside the panel.
 *
 * "See what changed" on the Overview's "PadSpan HA updated" card used to open
 * padspan.traks.ca in a new tab. On a wall screen (Chrome --kiosk, touch only,
 * no tab strip, no keyboard) that tab can't be closed, so the screen was stuck
 * on the website. The notes now open over the panel, with a large ✕, a Close
 * button, a tap outside and Escape to close them.
 *
 * The notes come from assets/whatsnew.json, which scripts/release.py writes
 * from CHANGELOG.md on every release and ships with the integration, so they
 * work with no internet. The markdown is a small subset (### headings, - and
 * nested bullets, **bold**, `code`, [links](...)) and is built with DOM nodes
 * and text only — never innerHTML — so nothing in it can become markup. Links
 * show as their text: a link here would be another tab nobody can close.
 *
 * tests/js/release_notes.mjs drives it.
 */

export const NOTES_TITLE = "What's new in PadSpan HA";
export const NOTES_CLOSE = "Close";
export const NOTES_LOADING = "Loading the release notes…";
export const NOTES_FAILED = "The release notes couldn't be loaded. Refresh the page and try again.";
export const NOTES_HISTORY = "Full history on padspan.traks.ca";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** "2026-09-28" → "28 September 2026" (no Date: a UTC midnight shows the day before in Pacific time). */
export function formatNoteDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m || !MONTHS[+m[2] - 1]) return String(iso || "");
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

/** Append `text` to `parent`: **bold** and `code` as elements, [label](url) as its label, the rest as text. */
function inline(parent, text) {
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)\s]*\)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) inline(parent.appendChild(node("strong")), m[1]);
    else if (m[2] !== undefined) parent.appendChild(node("code", null, m[2]));
    else parent.appendChild(document.createTextNode(m[3]));
    last = re.lastIndex;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

/** One CHANGELOG section's markdown as DOM nodes. */
export function renderNotesMarkdown(md) {
  const out = node("div", "notes-md");
  let para = null, list = null, item = null, sub = null, subItem = null;
  const endPara = () => { para = null; };
  const endList = () => { list = item = sub = subItem = null; };
  for (const raw of String(md || "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if (!line) { endPara(); continue; }
    if (/^-{3,}$/.test(line.trim())) { endPara(); endList(); continue; }
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) {
      endPara(); endList();
      inline(out.appendChild(node("div", "notes-h")), m[1]);
    } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      endPara();
      if (!list) list = out.appendChild(node("ul", "notes-ul"));
      item = list.appendChild(node("li"));
      sub = subItem = null;
      inline(item, m[1]);
    } else if ((m = /^\s{2,}[-*]\s+(.*)$/.exec(line)) && item) {
      if (!sub) sub = item.appendChild(node("ul", "notes-ul"));
      subItem = sub.appendChild(node("li"));
      inline(subItem, m[1]);
    } else if (/^\s/.test(line) && (subItem || item)) {
      inline(subItem || item, " " + line.trim());      // a wrapped bullet
    } else {
      endList();
      if (para) inline(para, " " + line.trim());
      else inline(para = out.appendChild(node("p", "notes-p")), line.trim());
    }
  }
  return out;
}

/**
 * The website's full history, or null where the new tab it opens couldn't be
 * closed: a ?kiosk=1 panel, or a page that fills the whole screen — Chrome
 * --kiosk on a wall screen, which doesn't have to carry ?kiosk=1 (the owner's
 * doesn't). A pixel of slack for display scaling's rounding.
 */
export function notesHistoryLink(url, kiosk, win = globalThis) {
  if (kiosk) return null;
  try {
    const s = win.screen;
    if (s && win.innerWidth >= s.width - 1 && win.innerHeight >= s.height - 1) return null;
  } catch (_) { /* no screen to measure: a normal browser */ }
  return url || null;
}

/** The notes list: one block per release, newest first. */
export function renderNotes(notes) {
  const box = node("div", "notes-list");
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!n || !n.version) continue;
    const rel = box.appendChild(node("section", "notes-rel"));
    const head = rel.appendChild(node("div", "notes-relhead"));
    head.appendChild(node("span", "notes-ver", `v${n.version}`));
    if (n.date) head.appendChild(node("span", "notes-date", formatNoteDate(n.date)));
    if (n.title) rel.appendChild(node("div", "notes-reltitle", String(n.title)));
    rel.appendChild(renderNotesMarkdown(n.body_markdown));
  }
  return box;
}

/**
 * Open the notes over the panel, in `host` (the panel's #modal element).
 *   url      where whatsnew.json is (with the panel's cache-buster)
 *   history  the website's full history, or null to leave the link out
 *            (a kiosk: the new tab it opens can't be closed there)
 * Returns { close, loaded }: loaded settles once the notes are shown or failed.
 */
export function openReleaseNotes(host, { url, history = null } = {}) {
  const overlay = node("div", "overlay notes-overlay");
  const panel = overlay.appendChild(node("div", "panel notes-panel"));
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", NOTES_TITLE);

  const head = panel.appendChild(node("div", "head notes-head"));
  head.appendChild(node("div", "title notes-title", NOTES_TITLE));
  const x = head.appendChild(node("button", "notes-x", "✕"));
  x.setAttribute("aria-label", NOTES_CLOSE);
  x.setAttribute("data-notes-close", "x");

  const body = panel.appendChild(node("div", "body notes-body"));
  body.appendChild(node("div", "notes-status", NOTES_LOADING));

  const foot = panel.appendChild(node("div", "notes-foot"));
  if (history) {
    const a = foot.appendChild(node("a", "notes-history", NOTES_HISTORY));
    a.setAttribute("href", history);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
  }
  const closeBtn = foot.appendChild(node("button", "btn notes-close", NOTES_CLOSE));
  closeBtn.setAttribute("data-notes-close", "button");

  let open = true;
  const onKey = (e) => { if (e && e.key === "Escape") close(); };
  function close() {
    if (!open) return;
    open = false;
    window.removeEventListener("keydown", onKey);
    // Only if the notes are still what the host shows: another modal may
    // have replaced them since.
    if (host.contains(overlay)) {
      host.removeChild(overlay);
      host.classList.add("hidden");
    }
  }
  x.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e && e.target === overlay) close(); });
  window.addEventListener("keydown", onKey);

  host.replaceChildren(overlay);
  host.classList.remove("hidden");
  try { closeBtn.focus(); } catch (_) { /* focus is a nicety */ }

  const loaded = Promise.resolve()
    .then(() => fetch(url))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(notes => {
      const list = renderNotes(notes);
      if (!list.children.length) throw new Error("no notes in the file");
      body.replaceChildren(list);
    })
    .catch(err => {
      console.warn("PadSpan: release notes failed to load", err);
      body.replaceChildren(node("div", "notes-status", NOTES_FAILED));
    });
  return { close, loaded };
}
