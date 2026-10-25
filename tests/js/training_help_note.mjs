// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// views/training.js, rendered for real with a stand-in el(): the Quick Start
// and Full Manual tabs open with the translated help's note exactly once when
// helpNote() gives one, and render the same tree as without the helper when
// it gives "" (English).
//
// usage: training_help_note.mjs <www/padspan-ha dir>
// prints one JSON line: { cases, failures }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
if (!WWW) { console.error("usage: training_help_note.mjs <www/padspan-ha dir>"); process.exit(2); }

const failures = [];
const cases = {};
const check = (name, ok, detail) => { cases[name] = !!ok; if (!ok) failures.push({ name, detail: detail === undefined ? null : detail }); };

const el = (tag, attrs, ...kids) => {
  const n = { tag, attrs: Object.assign({}, attrs), children: [], className: "", style: {}, addEventListener() {},
    appendChild(c) { this.children.push(c); return c; } };
  for (const k of kids.flat()) if (k !== undefined && k !== null) n.children.push(k);
  return n;
};
const texts = (n) => typeof n === "string" ? [n] : (n && n.children ? n.children.flatMap(texts) : []);
const tree = (n) => JSON.stringify(n, (k, v) => typeof v === "function" ? undefined : v);

const T = await import(pathToFileURL(join(WWW, "views", "training.js")).href + "?b=T");
const HELP = { follow: { title: "Volgen", body: ["Een alinea."] }, overview: { title: "Overzicht", body: ["Nog een."] } };
const NOTE = "Deze hulp is vertaald.";
const run = (tab, helpers) => T.render({
  helpers: Object.assign({ el, HELP }, helpers),
  state: { view: "training", _training: { tab, walkId: null, walkStep: 0, manualOpen: {} } },
  actions: { renderRooms() {} },
});

for (const tab of ["manual", "quickstart"]) {
  const shown = texts(run(tab, { helpNote: () => NOTE })).filter(s => s === NOTE).length;
  check(`${tab}_note_once`, shown === 1, shown);
  check(`${tab}_english_unchanged`, tree(run(tab, { helpNote: () => "" })) === tree(run(tab, {})));
}
check("walkthroughs_no_note", !texts(run("walkthroughs", { helpNote: () => NOTE })).includes(NOTE));

console.log(JSON.stringify({ cases, failures }));
