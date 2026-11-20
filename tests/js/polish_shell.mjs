// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The panel's skin before its settings arrive, and the top bar's two badges
// before the first refresh has answered (audit 2026-11-19), RUN rather than
// read: the real _applySkin and _updateBadges are lifted out of panel.js by
// text (as poll_settings_throttle.mjs does) and run against a fake `this`.
//
// Run:  node tests/js/polish_shell.mjs <panel.js path>
// prints one JSON line: { cases: {name: ok}, failures: [...] }

import { readFileSync } from "node:fs";

const PANEL = process.argv[2];
if (!PANEL) { console.error("usage: polish_shell.mjs <panel.js>"); process.exit(2); }
const src = readFileSync(PANEL, "utf8");

const cases = {}, failures = [];
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

/** Source of a class method `name(...)`. */
function extractMethod(name) {
  const m = new RegExp(`^\\s{2}${name}\\s*\\(`, "m").exec(src);
  if (!m) throw new Error(`could not find method ${name}() in panel.js — renamed? update this test`);
  const bodyStart = src.indexOf("{", src.indexOf(")", m.index));
  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) return src.slice(m.index, j + 1); }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}
const lift = (name) => new Function("localStorage", "APP_VERSION", "BUILD_ID", `const o = { ${extractMethod(name)} }; return o.${name};`);

// ── The skin ────────────────────────────────────────────────────────────────
function store(initial = {}) {
  const kept = { ...initial };
  return { kept, getItem: (k) => (k in kept ? kept[k] : null), setItem: (k, v) => { kept[k] = String(v); } };
}
function page(settings) {
  const link = { href: null, removeAttribute(a) { if (a === "href") this.href = null; } };
  return { state: { settings }, _skin: null, attrs: {}, link,
    setAttribute(k, v) { this.attrs[k] = v; }, shadowRoot: { querySelector: (q) => (q === "#skinLink" ? link : null) } };
}
{
  // A first visit: nothing kept, no settings yet. Classic, as it always was.
  const ls = store();
  const applySkin = lift("_applySkin")(ls, "1.2.3", "b1");
  const first = page({});
  applySkin.call(first);
  check("skin: nothing remembered and no settings yet is classic", first._skin === "classic" && first.link.href === null && !("padspan_ui_skin" in ls.kept),
    { skin: first._skin, href: first.link.href, kept: ls.kept });
  // The settings arrive and choose 2025: worn, and kept for the next visit.
  first.state.settings = { ui_skin: "2025" };
  const changed = applySkin.call(first);
  check("skin: the settings decide, and their choice is kept in this browser",
    changed === true && first._skin === "2025" && /styles-2025\.css\?v=1\.2\.3&b=b1$/.test(first.link.href || "") && ls.kept.padspan_ui_skin === "2025",
    { changed, skin: first._skin, href: first.link.href, kept: ls.kept });
  // The next visit: the page is built before any settings are read.
  const next = page({});
  applySkin.call(next);
  check("skin: the next visit wears the kept skin before the settings arrive",
    next._skin === "2025" && next.attrs["data-skin"] === "2025" && /styles-2025\.css/.test(next.link.href || ""), { skin: next._skin, href: next.link.href });
  // The settings then say classic (changed on another screen): classic, and that is kept instead.
  next.state.settings = { ui_skin: "classic" };
  applySkin.call(next);
  check("skin: settings that differ from the kept skin win", next._skin === "classic" && next.link.href === null && ls.kept.padspan_ui_skin === "classic",
    { skin: next._skin, href: next.link.href, kept: ls.kept });
  // Anything but the exact word is classic, kept as classic.
  const odd = page({ ui_skin: "2026" });
  applySkin.call(odd);
  check("skin: an unknown skin name is classic", odd._skin === "classic" && ls.kept.padspan_ui_skin === "classic", { skin: odd._skin, kept: ls.kept });
}
{
  // No storage at all (blocked, private window): as before, never a throw.
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const applySkin = lift("_applySkin")(broken, "1", "b");
  const p = page({});
  let threw = null;
  try { applySkin.call(p); p.state.settings = { ui_skin: "2025" }; applySkin.call(p); } catch (e) { threw = String(e); }
  check("skin: with no storage the settings still decide", threw === null && p._skin === "2025", { threw, skin: p._skin });
}

// ── The top bar's Scan and Status badges ────────────────────────────────────
{
  const updateBadges = lift("_updateBadges")(store(), "1", "b");
  const badges = (state) => {
    const els = {};
    const self = new Proxy({ state: { complexity: "advanced", ...state },
      $: (q) => (els[q] || (els[q] = { textContent: "", style: {} })) },
      { get: (t, k) => (k in t ? t[k] : () => {}) });
    updateBadges.call(self);
    return [els["#scanBadge"].textContent, els["#statusBadge"].textContent];
  };
  const early = badges({ status: {}, timing: { lastRefreshMs: null } });
  check("badges: before the first refresh they wait, with no dash", early[0] === "Scan: …" && early[1] === "Status: …", early);
  const read = badges({ status: { scan_interval: 5, status: "ok" }, timing: { lastRefreshMs: 240 } });
  check("badges: a reading is shown as it was", read[0] === "Scan: 5s" && read[1] === "Status: ok", read);
  const arrived = badges({ status: { scan_interval: 5, status: "ok" }, timing: { lastRefreshMs: null } });
  check("badges: a status that arrived before the refresh finished is shown", arrived[0] === "Scan: 5s" && arrived[1] === "Status: ok", arrived);
  const none = badges({ status: {}, timing: { lastRefreshMs: 240 } });
  check("badges: after the refresh, no reading is a dash as before", none[0] === "Scan: —s" && none[1] === "Status: —", none);
  const dropped = badges({ status: null, timing: { lastRefreshMs: 240 } });
  check("badges: a dropped status (data mode changed) does not throw", dropped[0] === "Scan: —s" && dropped[1] === "Status: —", dropped);
}

console.log(JSON.stringify({ cases, failures }));
