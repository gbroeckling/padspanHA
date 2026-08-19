# I1 — Make world placement derived. Migration design.

Written 2026-08-19, to be executed as one change. **Read before writing code.**
The irreversible part is converting stored alignments, so the decision rule for
that conversion is the thing to check first.

---

## Why there is a migration at all

There should not have been. A map's placement is stored twice — metric in
`model.map_transforms[id]`, world in `maps.maps[].stack` — and two stored copies
of one fact always drift. Issue #62 was that drift. Everything written for it
(`_recrop_stack`, `stack_from_transform`, `map_geometry_faults`,
`ws_fabric_map_stack_rebuild`, the Rooms placements table and its warning) is
machinery to detect and reconcile a divergence that should not be possible.

Deriving one from the other removes the possibility. But installs already hold
both, and some hold them in disagreement, so existing data has to be moved
**once**. That is debt from the original duplication, not from this change. Done
here at the start, it would have cost nothing.

The goal below is therefore a **single one-way conversion**, not an ongoing
reconciliation. After it runs, nothing reads the stack's numbers again.

---

## Target state

**Metres are the only stored geometry.**

`model.map_transforms[id]` keeps `origin_x_m`, `origin_y_m`, `scale_x_m`,
`scale_y_m`, `rotation_rad`, `reference_measurements`. That is the whole
placement of a map.

`maps.maps[].stack` keeps only what a human chooses and nothing derivable:

| keep | drop (becomes derived) |
|---|---|
| `is_master`, `ref_map_id`, `tie_ins` | `scale`, `scale_x_adj`, `x_offset`, `y_offset`, `rotation` |
| `z_level`, `ceiling_height_m` | `ref_ar`, `_m`, `_m_ar` |

**World space becomes metres scaled by a constant.** Not by a designated map.
`WORLD_M_PER_UNIT` is a fixed number (rendering convenience only), so:

```
world_x = origin_x_m / K + (frac_x * scale_x_m * cos - frac_y * scale_y_m * sin) / K
world_y = origin_y_m / K + (frac_x * scale_x_m * sin + frac_y * scale_y_m * cos) / K
```

There is no anchor map. **I2 falls out for free**: no writer can consult a
rendering parameter, because the rendering parameter is a constant.

---

## The conversion, and the decision rule to check

Runs once, in `migrations.py`, gated on a stored schema version so it cannot run
twice.

**Back up first.** Write `padspan_ha.maps.bak-preI1` and
`padspan_ha.model.bak-preI1` before touching anything, matching the existing
`.bak-20260812-pre-pass4` convention. If the conversion raises, restore and
leave the install on the old code path.

Per map, exactly one of:

| state | rule | why |
|---|---|---|
| transform exists **and** has `reference_measurements` | **transform wins.** Drop the stack numbers. | It is measured. The stack is a hand alignment of an unmeasured picture. |
| transform exists, no measurements, stack agrees within tolerance | transform wins, numbers dropped | Nothing to preserve — they say the same thing. |
| transform exists, no measurements, stack **disagrees** | **stack wins**: overwrite the transform via `stack_metre_transform()`, then drop the stack numbers | A disagreement on an unmeasured map means someone hand-tuned it and the system's guess is the stale side. |
| no transform, stack present | **stack wins**: write the transform from it | Only source available. |
| neither | leave unplaced | Honest. |
| stack is a solved affine `_m` with shear > 0.02 rad | **refuse and report** — leave the map on the old representation, list it in a migration receipt | The origin/scale/rotation model cannot represent shear. Refusing loudly beats silently distorting someone's alignment. |

**This is the decision to review.** Everything else is mechanical. The
consequence of getting a row wrong is a map that moves once, permanently.

The receipt (counts per branch, plus the names of any refused maps) goes to a
settings key and to the Health tab, so a user can see what happened rather than
discovering it on the map.

---

## The editor

`views/maps.js` Point Align and 3D Stack currently write stack numbers. They
must write `map_transforms` instead. Same gestures, same feel; the save path
converts the on-screen affine into `origin/scale/rotation` in metres and stores
that. This is the largest single piece of work and the only user-visible
behaviour change.

**A map whose alignment cannot be represented as origin/scale/rotation — a
sheared solve — is refused at save time with a reason,** rather than stored in a
second format. That is what removes the `_m` branch permanently.

---

## What gets deleted in the same commit

Not later. If it is not deleted here, this becomes a sixth layer.

- `_recrop_stack()` and its tests — a crop only moves `map_transforms` now
- `stack_from_transform()` and `ws_fabric_map_stack_rebuild`
- `ws_fabric_map_align_to_stack` — nothing to align to
- `map_geometry_faults()`, the `map_geometry` critic, and the two telemetry
  counters `map_align_to_stack` / `map_stack_rebuilt`
- the Rooms "Map placements" table and its red warning
- `find_metre_anchor` / `metreAnchor`, `ANCHOR_ISO_TOL`, `iso_error`
- `_within_floor_bounds` if still unused

Keep `inside_building_footprint()` — that is about rooms, not about map
placement, and is unaffected.

---

## Test plan

1. **Round trip** — every map in a realistic fixture converts and renders in the
   same place, within 1 cm.
2. **Each decision row** — one test per row of the table above, asserting which
   side won and that the stack numbers are gone.
3. **The refusal** — a sheared `_m` stack is refused, reported, and left intact.
4. **Idempotence** — running the migration twice changes nothing.
5. **Rollback** — a raised exception mid-conversion restores both backups.
6. **The drift is impossible** — the test that started this: crop a map, assert
   the rendered placement is unchanged. It should now pass *by construction*
   rather than because `_recrop_stack` kept two copies in step.
7. **Deletion is real** — a grep test asserting none of the retired symbols
   remain, so the scaffolding cannot survive by accident.

---

## Order of execution

1. Write the fixture and test 1 against the CURRENT code, so the reference
   renders are captured before anything moves.
2. Migration + receipt, tests 2–5.
3. Switch the readers (82 call sites, 5 files: `stack_transform.js`,
   `fabric_truth.py`, `maps_store.py`, `model_store.py`, `maps.js`).
4. Editor save path.
5. Delete the list above, test 7.
6. Re-run test 1 — same renders, derived instead of stored.

**Do not ship partially.** A half-migrated install has three representations
instead of two, which is worse than what it replaces.
