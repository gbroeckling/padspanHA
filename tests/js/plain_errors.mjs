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

console.log(JSON.stringify(results));
