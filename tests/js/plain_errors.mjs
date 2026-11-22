// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// What a toast says for a failure (views/ui_error.js errorText), run for real:
// PadSpan's own refusal as it is; a plain line for Home Assistant's machinery
// (its schema words, an unknown command, an unknown error, a lost connection)
// and for a bug on the page. Never throws, never "[object Object]".
//
// usage: plain_errors.mjs <www/padspan-ha dir>
// prints one JSON line: { name: { ok, detail } }
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const WWW = process.argv[2];
const M = await import(pathToFileURL(join(WWW, "views", "ui_error.js")).href);
const W = M.ERROR_WORDS;
const ERROR_WORDS_EN_CONNECTION = W.connection;   // read in English, before any language loads
const results = {};
const check = (name, got, want) => { results[name] = { ok: got === want, detail: got === want ? undefined : { got, want } }; };

check("PadSpan's refusal is shown as it is", M.errorText({ code: "no_room", message: "This room has no shape in the floor plan yet." }),
  "This room has no shape in the floor plan yet.");
check("a store still loading reads as PadSpan wrote it",
  M.errorText({ code: "no_model", message: "PadSpan hasn't finished loading. Try again in a minute." }), "PadSpan hasn't finished loading. Try again in a minute.");
check("Home Assistant's schema words get a plain line",
  M.errorText({ code: "invalid_format", message: "required key not provided @ data['map_id']. Got None" }), W.sent);
check("extra keys too", M.errorText({ code: "invalid_format", message: "extra keys not allowed @ data['x']" }), W.sent);
check("PadSpan's own invalid_format sentence stays",
  M.errorText({ code: "invalid_format", message: "Quiet hours are HH:MM-HH:MM." }), "Quiet hours are HH:MM-HH:MM.");
check("an unknown command: the page and the server don't match", M.errorText({ code: "unknown_command", message: "Unknown command." }), W.restart);
check("an unknown error: something went wrong in PadSpan", M.errorText({ code: "unknown_error", message: "Unknown error" }), W.server);
check("Python's words never reach a toast", M.errorText({ code: "failed", message: "'NoneType' object has no attribute 'get'" }), W.server);
check("a lost connection (an error object)", M.errorText({ code: 3, message: "Connection lost" }), W.connection);
check("a lost connection (just its number)", M.errorText(3), W.connection);
check("Home Assistant's Unauthorized", M.errorText({ code: "unauthorized", message: "Unauthorized" }), W.admin);
check("PadSpan's own unauthorized sentence stays",
  M.errorText({ code: "unauthorized", message: "Only an administrator can change Vacation Mode" }), "Only an administrator can change Vacation Mode");
check("a bug on the page", M.errorText(new TypeError("Cannot read properties of undefined (reading 'x')")), W.page);
check("the page's own Error keeps its words", M.errorText(new Error("Home Assistant isn't connected yet. Wait a moment and try again.")),
  "Home Assistant isn't connected yet. Wait a moment and try again.");
check("a thrown string", M.errorText("Pick a room first."), "Pick a room first.");
check("nothing at all", M.errorText(undefined), W.other);
check("an object with no words", M.errorText({ code: "x" }), W.other);
const hostile = { get message() { throw new Error("boom"); } };
check("a hostile error object", M.errorText(hostile), W.other);
check("never [object Object]", String(M.errorText({})).includes("[object"), false);

// In another language: the plain lines are its own, and PadSpan's sentence
// from the server is shown in it when it is one of the backend's whole
// sentences (i18n/<lang>/server.json); one it doesn't know stays as sent.
// The same views/i18n.js instance ui_error.js imports (no query here).
const { readFile } = await import("node:fs/promises");
const I18N = await import(pathToFileURL(join(WWW, "views", "i18n.js")).href);
globalThis.fetch = async (url) => {
  try { const body = await readFile(new URL(String(url).split("?")[0])); return { ok: true, json: async () => JSON.parse(body) }; }
  catch (_) { return { ok: false, json: async () => ({}) }; }
};
const got = await I18N.useLanguage({ language: "de" }, ["panel", "server"]);
const read = async (g) => JSON.parse(await readFile(join(WWW, "i18n", "de", g + ".json"), "utf-8"));
const server = await read("server"), panel = await read("panel");
const ADMIN = "Only an admin can change this while Enhanced security is on";
check("de: loaded", got, "de");
check("de: a refusal the backend sends whole is shown translated", M.errorText({ code: "admin_only", message: ADMIN }), server[ADMIN]);
check("de: serverText looks it up by its exact English", M.serverText(ADMIN), server[ADMIN]);
check("de: a sentence the backend doesn't send whole stays as it came",
  M.errorText({ code: "no_room", message: "Kitchen has no shape in the floor plan yet." }), "Kitchen has no shape in the floor plan yet.");
check("de: the plain lines are German", M.errorText(3), panel[ERROR_WORDS_EN_CONNECTION]);
check("de: a thrown string the backend sends whole", M.errorText(ADMIN), server[ADMIN]);
check("de: nothing at all", M.errorText(undefined), panel["Something went wrong. Try again."]);
// A refusal with a name in it comes with its template (Home Assistant's translation fields, const.refusal).
const ROOM = "{room} is not a room on the map.";
check("de: a refusal with a name in it, by its template; the name as it is",
  M.errorText({ code: "not_found", message: "Kitchen is not a room on the map.", translation_key: ROOM, translation_domain: "padspan_ha",
    translation_placeholders: { room: "Kitchen" } }), server[ROOM].replace("{room}", "Kitchen"));
check("de: a template it has no words for: the English as sent",
  M.errorText({ code: "x", message: "Kitchen is new.", translation_key: "{room} is new.", translation_placeholders: { room: "Kitchen" } }), "Kitchen is new.");

console.log(JSON.stringify(results));
