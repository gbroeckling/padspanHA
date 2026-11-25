// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// The Audio add-on in views/editions.js (2026-11-25): audioAllowed is Pro or
// the backend's audio_licensed; audioKey tells an add-on key from a Pro key;
// an add-on key is never pitched as a lapsed Pro licence.
//
// usage: audio_addon.mjs <views-dir>
// prints one JSON line: { checks: [...], failures: [...] }

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const VIEWS = process.argv[2];
const E = await import(pathToFileURL(join(VIEWS, "editions.js")).href);
const checks = [], failures = [];
const check = (name, ok, detail) => { checks.push(name); if (!ok) failures.push({ name, detail: String(detail ?? "") }); };

const AUDIO = { tier: "free", pro_has_key: true, pro_active: true, license_tier: "free", license_addons: ["audio"], audio_licensed: true };
const AUDIO_LAPSED = { ...AUDIO, pro_active: false, audio_licensed: false };

check("the price", E.AUDIO_ADDON_PRICE === "$6.45 CAD", E.AUDIO_ADDON_PRICE);
check("the term", E.AUDIO_ADDON_TERM === "2 years", E.AUDIO_ADDON_TERM);
check("the buy link", E.AUDIO_BUY_URL === "https://padspan.traks.ca/#audio", E.AUDIO_BUY_URL);

// Pro includes it; an active add-on key has it; nothing else does.
for (const [name, s, want] of [
  ["Pro", { tier: "pro", pro_has_key: true, pro_active: true }, true],
  ["Pro, a payload without audio_licensed", { tier: "pro" }, true],
  ["an active audio key", AUDIO, true],
  ["a lapsed audio key", AUDIO_LAPSED, false],
  ["no key", { tier: "free", pro_has_key: false }, false],
  ["Bright", { tier: "bright", pro_has_key: true, pro_active: true, license_tier: "bright" }, false],
  ["free, audio_licensed missing", { tier: "free" }, false],
  ["free, audio_licensed a string", { tier: "free", audio_licensed: "true" }, false],
  ["nothing at all", undefined, false],
]) check(`audioAllowed: ${name}`, E.audioAllowed(s) === want, E.audioAllowed(s));

for (const [name, s, want] of [
  ["an active audio key", AUDIO, true],
  ["a lapsed audio key", AUDIO_LAPSED, true],
  ["a Pro key", { tier: "pro", pro_has_key: true, license_tier: "pro" }, false],
  ["a Pro key that still lists audio", { pro_has_key: true, license_tier: "pro", license_addons: ["audio"] }, false],
  ["no key", { pro_has_key: false, license_tier: "free", license_addons: ["audio"] }, false],
]) check(`audioKey: ${name}`, E.audioKey(s) === want, E.audioKey(s));

// What a licence adds is said to an add-on key as to a free install, lapsed or not:
// never "Your licence has lapsed" about Pro features it never had.
for (const [name, s] of [["active", AUDIO], ["lapsed", AUDIO_LAPSED]]) {
  const p = E.proPitch(s);
  check(`proPitch: an ${name} audio key is pitched as free`, p && p.kind === "free", JSON.stringify(p));
}
check("proPitch: a lapsed Pro key is still told it lapsed",
  (E.proPitch({ tier: "free", pro_has_key: true, pro_active: false, license_tier: "pro" }) || {}).kind === "lapsed");

process.stdout.write(JSON.stringify({ checks, failures }) + "\n", () => process.exit(failures.length ? 1 : 0));
