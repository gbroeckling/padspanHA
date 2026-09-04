// Which floor an Upload actually lands the image on — the fix for GitHub #62
// (rjbutler): a 5s poll re-render mid-native-file-dialog used to rebuild the
// floor <select> onto floors[0] ("basement"), and the Upload button trusted
// that DOM value outright, silently uploading to the wrong floor.
//
// The floor_id-resolution body is lifted out of maps.js and RUN — the same
// string-surgery route tests/js/restore_by_id.mjs uses — so this can never
// silently drift from what actually ships.
//
// Run:  node tests/js/upload_floor_id.mjs <views dir>
// Prints one JSON line: { checks: [...], failures: [...], cases: {...} }.
import fs from "node:fs";
import { join } from "node:path";

const SRC = fs.readFileSync(join(process.argv[2], "maps.js"), "utf8");

const checks = [], failures = [];
function check(name, ok, detail) {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
}

const START = "const _validFloorIds = new Set(Array.from(floorSel.options).map(o => o.value));";
const END = "if(floor_id === OUTSIDE_FLOOR_ID){";
const a = SRC.indexOf(START), b = SRC.indexOf(END, a);
if (a < 0 || b < 0) throw new Error("the floor_id resolution body is not where this harness looks");
const BODY = SRC.slice(a, b);

check("still reads ctx.state._mapsUploadFloorId, not just the DOM", /ctx\.state\._mapsUploadFloorId/.test(BODY));

const resolve = new Function("ctx", "floorSel", `${BODY}\nreturn floor_id;`);

const mkSelect = (options, domValue) => ({
  options: options.map(value => ({ value })),
  value: domValue,
});

const cases = {};

// The bug itself: the user picked "main" (recorded in ctx.state), then a
// rebuild landed the <select> on floors[0] ("basement") before the real
// choice was restored. The upload must still go to "main".
cases.rebuildLandedOnFirstFloor = resolve(
  { state: { _mapsUploadFloorId: "main" } },
  mkSelect(["basement", "main", "attic"], "basement")
);

// The ordinary path: nothing has gone wrong, state and DOM agree.
cases.normalAgreement = resolve(
  { state: { _mapsUploadFloorId: "attic" } },
  mkSelect(["basement", "main", "attic"], "attic")
);

// State points at a floor that no longer exists (deleted/renamed since it
// was recorded) — the DOM's current value is the only honest answer left.
cases.staleStateFallsBackToDom = resolve(
  { state: { _mapsUploadFloorId: "deleted_floor" } },
  mkSelect(["basement", "main", "attic"], "basement")
);

// Nothing chosen yet this session (first-ever upload) — the DOM's default
// (floors[0], set by the restoration logic above this snippet) is used.
cases.neverChosenUsesDom = resolve(
  { state: {} },
  mkSelect(["basement", "main", "attic"], "basement")
);

console.log(JSON.stringify({ checks, failures, cases }));
