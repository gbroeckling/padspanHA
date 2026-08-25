// The onboarding card must not answer "is setup done?" before it can know.
//
// Run:  node tests/js/onboarding_gate.mjs <panel.js path>
// Prints one JSON line: { "checks": [...], "failures": [...] }.
//
// WHY THIS EXISTS
// v0.38.5 flashed "Setup Progress - 0/5 - Upload Floor Plan" at established
// installs on every panel open. Nothing was wrong with them: the card computes
// _hasMaps from this.state.maps.list, and on first paint that list has not been
// fetched yet. Empty was read as "not done".
//
// It mattered on that release in particular, because 0.38.5 is the one that
// rewrote how every map stores its position. Somebody who upgrades and is then
// told they have never uploaded a floor plan reasonably concludes the upgrade
// ate their setup, and reaches for a backup restore - a destructive answer to a
// problem that does not exist.
//
// The gate is lifted from the shipped source by text rather than reimplemented,
// so this test fails if the real condition changes.
import { readFileSync } from "node:fs";

const SRC = readFileSync(process.argv[2], "utf8");
const checks = [], failures = [];
const check = (name, ok, detail) => {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
};

// ── lift the real gate out of panel.js ──────────────────────────────────────
const knownLine = SRC.match(/const\s+_setupKnown\s*=\s*([^;]+);/);
check("panel.js defines _setupKnown", !!knownLine);

const ifLine = SRC.match(/if\s*\(\s*_setupKnown\s*&&\s*!_onboardingDone[^)]*\)\s*\{/);
check("the onboarding card is gated on _setupKnown", !!ifLine,
      "the card renders without waiting for the stores that answer it");

const hasMapsLine = SRC.match(/const\s+_hasMaps\s*=\s*([^;]+);/);
check("panel.js still derives _hasMaps", !!hasMapsLine);

// The gate is only worth anything if the flags START false. Evaluating the gate
// against fabricated state cannot see the initial value, so assert it directly:
// a flag initialised true means "loaded" before anything was fetched, and the
// flash comes straight back with the gate still nominally in place.
for (const flag of ["_mapsLoaded", "_modelLoaded"]) {
  const init = SRC.match(new RegExp(flag + "\\s*:\\s*(true|false)\\s*,"));
  check(`${flag} is declared in the initial state`, !!init);
  check(`${flag} starts FALSE (unknown), not true`,
        !!init && init[1] === "false",
        init ? `initialised ${init[1]} - the gate opens before anything is fetched` : "absent");
}

if (knownLine && ifLine && hasMapsLine) {
  // Evaluate the SHIPPED expressions against fabricated panel state.
  const gate = new Function("state", `const this_ = {state}; const t = this_;
    const _setupKnown = ${knownLine[1].replace(/this\.state/g, "state")};
    return !!_setupKnown;`);
  const hasMaps = new Function("state",
    `return !!(${hasMapsLine[1].replace(/this\.state/g, "state")});`);

  const loading   = { maps: { list: [] }, model: {}, _mapsLoaded: false, _modelLoaded: false };
  const mapsOnly  = { maps: { list: [] }, model: {}, _mapsLoaded: true,  _modelLoaded: false };
  const newUser   = { maps: { list: [] }, model: {}, _mapsLoaded: true,  _modelLoaded: true };
  const established = { maps: { list: [{ id: "m1", receivers: [{}], room_bounds: { Kitchen: {} } }] },
                        model: {}, _mapsLoaded: true, _modelLoaded: true };

  // THE BUG: mid-load, an established install looks identical to a new one.
  check("mid-load, an established install is indistinguishable from a new one",
        hasMaps(loading) === false,
        "if this ever becomes true the flash is gone for another reason - re-read this test");

  // ...which is exactly why the card must not render yet.
  check("the card does NOT render while the stores are still loading",
        gate(loading) === false, "an established install would be told 0/5");
  check("the card does NOT render when only maps have arrived",
        gate(mapsOnly) === false, "the model still answers Set Scale and Draw Rooms");

  // ...but a genuinely new install must still be onboarded.
  check("a NEW install still gets the card once the stores settle",
        gate(newUser) === true, "an empty list is an ANSWER, not an absence");
  check("an established install also passes the gate (the steps then read done)",
        gate(established) === true);
  check("an established install reads as having maps once loaded",
        hasMaps(established) === true);
}

console.log(JSON.stringify({ checks, failures }));
