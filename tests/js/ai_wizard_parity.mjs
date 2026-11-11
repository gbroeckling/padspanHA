// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// ai_wizard.py keeps a Python copy of views/setup_status.js's "is this step
// done" checks and of trial_offer.js's trialOfferable, for the opt-in report
// and the AI helper's rule. This runs the JavaScript ones on the battery
// tests/test_ai_wizard.py sends, so the two copies are held equal.
//
// Run:  node tests/js/ai_wizard_parity.mjs <views-dir> <battery.json>
// Prints one JSON line: {"setup": [{hasMaps, ...}], "trial": [bool]}.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { install } from "./dom_shim.mjs";

install(globalThis);
const VIEWS = process.argv[2];
const battery = JSON.parse(readFileSync(process.argv[3], "utf8"));
const S = await import(pathToFileURL(join(VIEWS, "setup_status.js")).href);
const T = await import(pathToFileURL(join(VIEWS, "trial_offer.js")).href);

const setup = battery.setup.map(state => Object.fromEntries(
  ["hasMaps", "hasReceivers", "hasFabricRooms", "hasRooms", "hasScale", "hasCalibration"].map(fn => [fn, S[fn](state)])));
const trial = battery.trial.map(settings => T.trialOfferable(settings));
console.log(JSON.stringify({ setup, trial }));
