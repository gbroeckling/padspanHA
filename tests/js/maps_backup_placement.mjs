// The Map Data Backup carries each map's PLACEMENT, and the restore puts it back.
//
// The backup wrote the picture, the stack, the calibration and the notes, and
// left `map_transforms` behind — so a restore brought back maps that sat
// nowhere. It could not have worked even with the Model store restored beside
// it: `map_transforms` is keyed by map id and a restored map gets a NEW one.
//
// The two halves are lifted out of maps.js by text and run as they ship, the
// same route tests/js/align_repair_routing.mjs uses, so this cannot pass on a
// hand-written shape the panel never builds.
//
// Run:  node tests/js/maps_backup_placement.mjs <views dir>
// Prints one JSON line: { checks: [...], failures: [...], backup: {...},
//                         restoreCalls: [...] }.
import fs from "node:fs";
import { join } from "node:path";

const VIEWS_DIR = process.argv[2];
const SRC = fs.readFileSync(join(VIEWS_DIR, "maps.js"), "utf8");

const checks = [], failures = [];
function check(name, ok, detail) {
  checks.push(name);
  if (!ok) failures.push({ name, detail: detail === undefined ? "" : String(detail) });
}

// ── the EXPORT half, as it ships ──────────────────────────────────────────
const EXPORT_SITE = SRC.slice(
  SRC.indexOf("const entry = JSON.parse(JSON.stringify(m));"),
  SRC.indexOf("backupMaps.push(entry);"));
check("the export site was found", EXPORT_SITE.length > 0 && EXPORT_SITE.length < 4000,
      EXPORT_SITE.length);
check("the export reads map_transforms",
      /ctx\.state\.model\?\.map_transforms/.test(EXPORT_SITE));
check("the export writes entry.map_transform",
      /entry\.map_transform\s*=/.test(EXPORT_SITE));
check("the export deep-copies it rather than aliasing the live record",
      /JSON\.parse\(JSON\.stringify\(_tx\)\)/.test(EXPORT_SITE));

// Run it: one measured map, one unmeasured, and one whose record is missing.
const model = {
  map_transforms: {
    m1: { origin_x_m: 1.5, origin_y_m: -2.0, scale_x_m: 20, scale_y_m: 15,
          rotation_rad: 0.3, shear_rad: -0.08, floor_id: "main",
          reference_measurements: [{ m: 1 }] },
    m2: { origin_x_m: 0, origin_y_m: 0, scale_x_m: 10, scale_y_m: 7.5,
          rotation_rad: 0, shear_rad: 0, floor_id: "main" },
  },
};
const maps = [{ id: "m1", name: "Ground" }, { id: "m2", name: "Annex" },
              { id: "m3", name: "Unplaced" }];
const ctx = { state: { model } };
const backupMaps = [];
const runExport = new Function("ctx", "m", "backupMaps", `
  const entry = JSON.parse(JSON.stringify(m));
  const _tx = (ctx.state.model?.map_transforms || {})[m.id];
  if (_tx) entry.map_transform = JSON.parse(JSON.stringify(_tx));
  backupMaps.push(entry);
  return entry;
`);
for (const m of maps) runExport(ctx, m, backupMaps);

check("the measured map's placement is in the backup",
      backupMaps[0].map_transform && backupMaps[0].map_transform.scale_x_m === 20);
check("sigma survives the round trip",
      backupMaps[0].map_transform.shear_rad === -0.08);
check("the measured flag survives with it",
      (backupMaps[0].map_transform.reference_measurements || []).length === 1);
check("an unmeasured but PLACED map is carried too",
      backupMaps[1].map_transform && backupMaps[1].map_transform.scale_x_m === 10);
check("a map with no record gets no key rather than a null",
      !("map_transform" in backupMaps[2]));
// Aliasing would let a later edit of the live record change what was backed up.
model.map_transforms.m1.scale_x_m = 999;
check("the backup is a copy, not a view", backupMaps[0].map_transform.scale_x_m === 20);

// ── the RESTORE half, as it ships ─────────────────────────────────────────
const RESTORE_SITE = SRC.slice(
  SRC.indexOf("const newId = up?.map?.id;"),
  SRC.indexOf("}catch(e){ fail++;"));
check("the restore site was found", RESTORE_SITE.length > 0 && RESTORE_SITE.length < 4000,
      RESTORE_SITE.length);
check("the restore sends the placement under the NEW id",
      /map_id:\s*newId,\s*transform:\s*bm\.map_transform/.test(RESTORE_SITE));
check("the restore goes through the transform writer",
      /padspan_ha\/fabric_map_transform_set/.test(RESTORE_SITE));
check("a backup with no placement is not sent one",
      /if\(bm\.map_transform\)/.test(RESTORE_SITE));

// Run it against a recording ctx, for both an old and a new backup.
const restoreCalls = [];
const runRestore = new Function("ctx", "bm", "up", `
  return (async () => {
    const newId = up?.map?.id;
    if(newId){
      await ctx.actions.mapsUpdateQuiet({
        map_id: newId, calibration: bm.calibration||{},
        notes: bm.notes||"", stack: bm.stack||{},
      });
      if(bm.map_transform){
        await ctx.actions.callWS({
          type: "padspan_ha/fabric_map_transform_set",
          map_id: newId, transform: bm.map_transform,
        });
      }
    }
  })();
`);
const rctx = { actions: {
  mapsUpdateQuiet: async (p) => { restoreCalls.push(["update", p.map_id]); },
  callWS: async (p) => { restoreCalls.push([p.type, p.map_id, p.transform]); },
} };

await runRestore(rctx, backupMaps[0], { map: { id: "new1" } });
await runRestore(rctx, backupMaps[2], { map: { id: "new3" } });   // pre-R2 backup

const sent = restoreCalls.filter(c => c[0] === "padspan_ha/fabric_map_transform_set");
check("the placement is restored under the new id", sent.length === 1 && sent[0][1] === "new1");
check("the restored placement is the one that was backed up",
      sent[0][2] && sent[0][2].scale_x_m === 20 && sent[0][2].shear_rad === -0.08);
check("a backup written before this release restores exactly as it did",
      restoreCalls.filter(c => c[1] === "new3").length === 1);

console.log(JSON.stringify({ checks, failures, backupKeys: backupMaps.map(b => Object.keys(b).sort()) }));
