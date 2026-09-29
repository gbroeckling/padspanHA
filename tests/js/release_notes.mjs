// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The release notes over the panel (views/release_notes.js), RUN.
//
// Garry, 2026-09-28: "release notes screen has no way to close on touch
// monitor". "See what changed" opened padspan.traks.ca in a new tab, and a
// wall screen in Chrome --kiosk has no tab strip and no keyboard. The notes
// now open over the panel; this drives every way of closing them, the text
// the markdown becomes (never markup), and the shipped whatsnew.json itself.
//
// usage: node release_notes.mjs <views/release_notes.js> <assets/whatsnew.json>

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { install } from "./dom_shim.mjs";

const [MOD, JSON_PATH] = process.argv.slice(2);
if (!MOD || !JSON_PATH) { console.error("usage: release_notes.mjs <release_notes.js> <whatsnew.json>"); process.exit(2); }

install(globalThis);
// The shim's window listeners are no-ops; Escape needs real ones.
const winListeners = {};
globalThis.addEventListener = (t, fn) => { (winListeners[t] ||= []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winListeners[t] = (winListeners[t] || []).filter(f => f !== fn); };
const key = (k) => (winListeners.keydown || []).slice().forEach(fn => fn({ type: "keydown", key: k }));
const warned = [];
console.warn = (...a) => warned.push(a.join(" "));

const N = await import(pathToFileURL(MOD).href);
const SRC = readFileSync(MOD, "utf8");
const SHIPPED = JSON.parse(readFileSync(JSON_PATH, "utf8"));

const ok = [], fail = [];
async function t(label, fn) {
  try { await fn(); ok.push(label); } catch (e) { fail.push(`${label}: ${e && e.message ? e.message : e}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
const q = (root, sel) => root.querySelector(sel);
const qa = (root, sel) => root.querySelectorAll(sel);
/** Every node under root, root included. */
const all = (root) => [root, ...root._all()];
/** Nothing under root was ever given markup to parse. */
function noMarkup(root) {
  for (const n of all(root)) assert(!n._html, `innerHTML was set on <${n.localName}>: ${n._html}`);
}

let fetched = [];
function stubFetch(result) {
  globalThis.fetch = (url) => {
    fetched.push(url);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  };
}
const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

function host() {
  const h = document.createElement("div");
  h.className = "modal hidden";
  return h;
}
async function open(opts = {}, data = SHIPPED) {
  stubFetch(data instanceof Error || (data && data.json) ? data : okJson(data));
  const h = host();
  const r = N.openReleaseNotes(h, { url: "/static/whatsnew.json?v=9.9.9&b=X", ...opts });
  return { h, r, overlay: h.children[0] };
}

// ── The markdown ────────────────────────────────────────────────────────────
await t("markdown: headings, bullets, nested bullets, bold, code, paragraphs", () => {
  const md = [
    "Intro line one",
    "continues here.",
    "",
    "### Atlas — Test",
    "- **Added:** a `thing` that works.",
    "  - **Start:** every light on.",
    "  - **End:** only those off.",
    "- Plain second bullet",
    "  wrapped onto a second line.",
    "",
    "---",
    "",
    "### Settings",
    "- See [the docs](https://example.com/docs) for more.",
  ].join("\n");
  const out = N.renderNotesMarkdown(md);
  const ps = qa(out, "p");
  assert(ps.length === 1 && ps[0].textContent === "Intro line one continues here.", "paragraph: " + (ps[0] && ps[0].textContent));
  const hs = qa(out, ".notes-h");
  assert(hs.length === 2 && hs[0].textContent === "Atlas — Test" && hs[1].textContent === "Settings", "headings");
  const top = out.children.filter(c => c.localName === "ul");
  assert(top.length === 2, "two top-level lists, got " + top.length);
  const items = top[0].children;
  assert(items.length === 2, "two bullets in the first list, got " + items.length);
  const nested = q(items[0], "ul");
  assert(nested && nested.children.length === 2, "nested bullets");
  assert(nested.children[0].textContent === "Start: every light on.", nested.children[0].textContent);
  assert(q(items[0], "strong").textContent === "Added:", "bold");
  assert(q(items[0], "code").textContent === "thing", "code");
  assert(items[1].textContent === "Plain second bullet wrapped onto a second line.", "wrapped bullet: " + items[1].textContent);
  assert(top[1].children[0].textContent === "See the docs for more.", "link as its text: " + top[1].children[0].textContent);
  assert(!qa(out, "a").length, "a link became an <a> — another tab a kiosk can't close");
  assert(!out.textContent.includes("---"), "the separator was shown");
});

await t("markdown: bold with code inside, and code with stars inside", () => {
  const out = N.renderNotesMarkdown("- **Show `?kiosk=1` here** and `a**b**c`");
  const li = q(out, "li");
  assert(q(q(li, "strong"), "code").textContent === "?kiosk=1", "code inside bold");
  assert(qa(li, "code")[1].textContent === "a**b**c", "stars inside code were parsed");
});

await t("markdown: HTML in the notes stays text, never markup", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const md = `### ${evil}\n- **<script>alert(2)</script>** ${evil}\n  - \`<b>x</b>\`\n\n${evil} [<i>y</i>](javascript:alert(3))`;
  const out = N.renderNotesMarkdown(md);
  noMarkup(out);
  for (const tag of ["img", "script", "b", "i", "a"]) assert(!qa(out, tag).length, `a <${tag}> element was made`);
  const text = out.textContent;
  assert(text.includes(evil) && text.includes("<script>alert(2)</script>") && text.includes("<b>x</b>") && text.includes("<i>y</i>"),
    "the text was lost: " + text);
  assert(!text.includes("javascript:"), "a link's address was shown");
});

await t("source: the module never parses markup", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const s of ["innerHTML", "outerHTML", "insertAdjacentHTML", "DOMParser", "createContextualFragment"]) {
    assert(!code.includes(s), "release_notes.js uses " + s);
  }
});

// ── The overlay ─────────────────────────────────────────────────────────────
await t("open: shown at once over the panel, with ✕ and Close, then the notes", async () => {
  fetched = [];
  const { h, r, overlay } = await open({ history: "https://padspan.traks.ca/#whatsnew" });
  assert(!h.classList.contains("hidden"), "host still hidden");
  assert(h.children.length === 1 && overlay.classList.contains("overlay"), "no overlay");
  assert(q(h, ".notes-title").textContent === N.NOTES_TITLE, "title");
  const x = q(h, '[data-notes-close="x"]');
  assert(x && x.textContent === "✕" && x.getAttribute("aria-label") === "Close", "✕");
  assert(q(h, '[data-notes-close="button"]').textContent === N.NOTES_CLOSE, "Close button");
  assert(q(h, ".notes-status").textContent === N.NOTES_LOADING, "no loading line");
  assert(q(h, '[role="dialog"]'), "no dialog role");
  await r.loaded;
  assert(fetched.length === 1 && fetched[0] === "/static/whatsnew.json?v=9.9.9&b=X", "fetched " + JSON.stringify(fetched));
  const rels = qa(h, ".notes-rel");
  assert(rels.length === SHIPPED.length, `${rels.length} releases shown of ${SHIPPED.length}`);
  assert(q(rels[0], ".notes-ver").textContent === "v" + SHIPPED[0].version, "newest first");
  assert(q(rels[0], ".notes-reltitle").textContent === SHIPPED[0].title, "title of the release");
  assert(!q(h, ".notes-status"), "loading line left behind");
  noMarkup(h);
  r.close();
});

await t("history link: shown when given, opens the website; left out when not", async () => {
  const a = await open({ history: "https://padspan.traks.ca/#whatsnew" });
  const link = q(a.h, "a");
  assert(link && link.textContent === N.NOTES_HISTORY, "no history link");
  assert(link.getAttribute("href") === "https://padspan.traks.ca/#whatsnew" && link.getAttribute("target") === "_blank", "link target");
  a.r.close();
  const b = await open({ history: null });
  await b.r.loaded;
  assert(!qa(b.h, "a").length, "a link on a kiosk");
  b.r.close();
});

for (const [label, how] of [
  ["✕", (o) => q(o.h, '[data-notes-close="x"]').click()],
  ["the Close button", (o) => q(o.h, '[data-notes-close="button"]').click()],
  ["a tap outside", (o) => o.overlay.dispatchEvent({ type: "click", target: o.overlay })],
  ["Escape", () => key("Escape")],
]) {
  await t(`close: ${label}`, async () => {
    const o = await open();
    await o.r.loaded;
    assert((winListeners.keydown || []).length === 1, "no Escape listener");
    how(o);
    assert(o.h.classList.contains("hidden"), "host not hidden");
    assert(!o.h.children.length, "overlay left in the host");
    assert(!(winListeners.keydown || []).length, "Escape listener left behind");
  });
}

await t("close: a tap inside the notes, or another key, does not close them", async () => {
  const o = await open();
  await o.r.loaded;
  const panel = q(o.h, ".notes-panel");
  o.overlay.dispatchEvent({ type: "click", target: panel });
  o.overlay.dispatchEvent({ type: "click", target: q(o.h, ".notes-rel") });
  key("Enter");
  key("ArrowDown");
  assert(!o.h.classList.contains("hidden") && o.h.children.length === 1, "closed");
  o.r.close();
  o.r.close();                                // twice is fine
  assert(o.h.classList.contains("hidden"), "close() did not close");
});

await t("close: does not take away a modal that replaced the notes", async () => {
  const o = await open();
  const other = document.createElement("div");
  o.h.replaceChildren(other);                 // the panel's _openModal did this
  o.r.close();
  assert(!o.h.classList.contains("hidden") && o.h.children[0] === other, "closed the other modal");
  assert(!(winListeners.keydown || []).length, "Escape listener left behind");
});

for (const [label, res] of [
  ["the fetch fails", new Error("offline")],
  ["the file is missing", { ok: false, status: 404, json: async () => ({}) }],
  ["the file is empty", okJson([])],
  ["the file is not a list", okJson({ notes: "x" })],
]) {
  await t(`failure: ${label} — says so, still closes`, async () => {
    const o = await open({}, res);
    await o.r.loaded;
    assert(q(o.h, ".notes-status").textContent === N.NOTES_FAILED, "no failure line: " + o.h.textContent);
    q(o.h, '[data-notes-close="button"]').click();
    assert(o.h.classList.contains("hidden"), "could not close after a failure");
  });
}

// ── Where the website link may go ───────────────────────────────────────────
await t("history link: none on ?kiosk=1 or a page filling the screen (Chrome --kiosk)", () => {
  const U = "https://padspan.traks.ca/#whatsnew";
  const win = (iw, ih, sw, sh) => ({ innerWidth: iw, innerHeight: ih, screen: { width: sw, height: sh } });
  assert(N.notesHistoryLink(U, true, win(1280, 800, 1920, 1080)) === null, "kiosk");
  assert(N.notesHistoryLink(U, false, win(1080, 1920, 1080, 1920)) === null, "wall screen, portrait");
  assert(N.notesHistoryLink(U, false, win(864, 1536, 864, 1536)) === null, "wall screen at 125%");
  assert(N.notesHistoryLink(U, false, win(1920, 969, 1920, 1080)) === U, "a desktop browser window");
  assert(N.notesHistoryLink(U, false, win(390, 664, 390, 844)) === U, "a phone browser");
  assert(N.notesHistoryLink(U, false, {}) === U, "nothing to measure");
  assert(N.notesHistoryLink("", false, win(1, 1, 9, 9)) === null, "no url");
});

// ── The shipped notes ──────────────────────────────────────────────────────
await t("whatsnew.json: every release renders, with no markdown left showing", () => {
  assert(Array.isArray(SHIPPED) && SHIPPED.length >= 1 && SHIPPED.length <= 6, "length " + SHIPPED.length);
  const out = N.renderNotes(SHIPPED);
  assert(qa(out, ".notes-rel").length === SHIPPED.length, "not every release rendered");
  const text = out.textContent;
  for (const s of ["**", "](", "### ", "\n- "]) assert(!text.includes(s), `raw markdown ${JSON.stringify(s)} in the notes`);
  assert(qa(out, "li").length > SHIPPED.length, "bullets did not become list items");
  noMarkup(out);
});

await t("dates read as words, and the day is not moved by the time zone", () => {
  assert(N.formatNoteDate("2026-09-28") === "28 September 2026", N.formatNoteDate("2026-09-28"));
  assert(N.formatNoteDate("2026-01-01") === "1 January 2026", N.formatNoteDate("2026-01-01"));
  assert(N.formatNoteDate("soon") === "soon", "an odd date is shown as it is");
});

for (const o of ok) console.log(`  ok   ${o}`);
for (const f of fail) console.log(`  FAIL ${f}`);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
