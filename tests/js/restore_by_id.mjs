// Which map a JSON restore writes the backup's stack onto.
//
// The restore uploaded the image and then found the map it had just created
// by NAME — `find(m => m.name === bm.name)`, first match wins. A backup
// holding two maps of the same name, or two unnamed ones (both of which
// become "Restored Map"), therefore wrote the second map's stack, calibration
// and notes onto the FIRST, and left the second on a default stack. Nothing
// in the result says which map got which alignment.
//
// The upload already answers the question: `maps_upload` replies with the map
// it made, and the Upload tab reads `uploadRes?.map?.id` three hundred lines
// away in the same file.
//
// The loop body is lifted out of maps.js and RUN — the string-surgery route
// tests/js/orphan_delete_payload.mjs uses — against a ctx whose mapsUpload
// behaves like the real one: it creates a map with its own id and appends it
// to the list the old code was searching.
//
// Run:  node tests/js/restore_by_id.mjs <views dir> <backup.json>
// Prints one JSON line: { "updates": [...], "created": [...], "checks": [...],
//                         "failures": [...] }.
import fs from "node:fs";
import { join } from "node:path";

const SRC = fs.readFileSync(join(process.argv[2], "maps.js"), "utf8");
const BACKUP = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

const checks = [], failures = [];
function check(name, ok, detail) {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
}

const START = "const up = await ctx.actions.mapsUpload({";
const END = "        ok++;";
const a = SRC.indexOf(START), b = SRC.indexOf(END, a);
if (a < 0 || b < 0) throw new Error("the restore body is not where this harness looks");
const BODY = SRC.slice(a, b);

check("the restore does not locate the new map by name",
      !/find\(m=>m\.name===\(bm\.name/.test(SRC));
check("it reads the id the upload returned", /up\?\.map\?\.id/.test(BODY));

const run = new Function("ctx", "bm", `return (async () => {${BODY}})();`);

const created = [], updates = [];
let n = 0;
const ctx = {
  state: { maps: { list: [] } },
  actions: {
    async mapsUpload(payload) {
      // The real one creates a map with a fresh id and refreshes the list.
      const map = { id: `m${++n}`, name: payload.name, floor_id: payload.floor_id };
      ctx.state.maps.list.push(map);
      created.push({ id: map.id, name: map.name });
      return { map };
    },
    async mapsUpdateQuiet(payload) { updates.push(payload); },
  },
};

for (const bm of BACKUP) await run(ctx, bm);

console.log(JSON.stringify({ updates, created, checks, failures }));
