# Pass 4: Delete the Map-Origin Class

**Status: PLAN ONLY — no code written.** All file:line citations verified against `b0abad8`
(release v0.29.2, 2026-08-12). Line numbers move; the anchors named alongside them
(function names, guard conditions) are what to search for if they have.

This is a **deletion pass**. It removes roughly 200 lines and adds roughly 20. If it grows
past that, it has stopped being this plan.

---

## The requirement

Garry, repeatedly, in his own words: the uploaded photo is a ONE-TIME BOOTSTRAP tool. After
it has been used once to place things, "the use of the map is over except for displaying a
map on the rare occasion where that is needed." A photo's placement quality must have ZERO
bearing on the fabric's correctness — "if an image is pinned incorrectly, so what... it's
not used for anything."

Rooms already satisfy this. Scanners, beacons and barriers do not.

## Why this pass exists

Passes 1-3 got the fabric to the right place by adding machinery. The machinery is now the
problem.

**Rooms** need no `origin` field, no guards, no classification of which save counts as a
placement, no removal special-case, and no per-entity-kind exception. They are simple
because there is exactly one class of room shape: it is fabric, and nothing else may write
it (`fabric_store.py` — `async_commit_floor` and `async_correct_room`, the only two writers).

**Scanners/beacons/barriers** carry all of that, for one reason: map-origin entries remain
perpetually re-derivable. The dual class *is* the patch. Pass 3 made it usable — it wired
the UI to set `manual`, which pass 2 had made immune but unreachable — it did not make it
simple.

### The organising principle

**Delete every implicit write. Keep every explicit one.**

Once the only writes to spatial fabric are deliberate placements, there is nothing left for
`origin` to distinguish, and every guard that reads it becomes dead weight.

| Write | Today | After |
|---|---|---|
| User drags a pin and saves | writes fabric | writes fabric (unchanged) |
| Map saved for any other reason | re-derives everything on it | no fabric write |
| Map transform corrected | re-derives everything on it | no fabric write |
| Positioning repair run | re-derives everything on it | no fabric write |
| Brand-new pin, never seen before | seeds | seeds (unchanged) |

---

## Delete

### 1. `model_store.async_sync_spatial_from_map` — lines 1156-1285 (130 lines)

The re-derivation engine: every scanner/beacon/barrier metre value recomputed from that
map's photo fracs times its current transform. Delete the function and all three callers.

| Caller | Fires on | Behaviour after |
|---|---|---|
| `websocket.py:4019` | every map save | map saves no longer touch the fabric |
| `websocket.py:5702` | `positioning_repair` | repairs transforms + calibration only |
| `websocket.py:9718` | `fabric_map_align_to_stack` | corrects where the photo is *drawn*, nothing else |

The `remove_scanners` / `remove_beacons` blocks inside it (`:1194-1199`, `:1250-1255`) go
with it. Removal becomes exclusively explicit — see Keep #3.

### 2. The guards that exist only because of #1

- `model_store.py:897` — batch save, scanners (`origin == "manual" and not manual`)
- `model_store.py:925` — batch save, beacons
- `model_store.py:1187`, `:1246` — inside the deleted function, go with it
- `model_store.py:1511`, `:1577` — in `async_rederive_map_fracs`, "don't override manual
  positions from other maps"; collapses to "draw the entries whose `map_id` is this map"
- `model_store.py:908`, `:1201` — the `z_origin` variants. Heights are the same dual class
  in miniature; `fabric_scanner_z_set` writes a height, and under one class that height is
  simply fabric.

### 3. Pass 3's origin plumbing

Deleted by its own success — with no implicit writes, the flag distinguishes nothing.

- `model_store.py:856` — the `origin: str = "map"` parameter, the `manual = ...` line, and
  the two `"origin": origin` stamps (`:907`, `:931`) reduce to provenance or nothing
- `websocket.py:9941` — `vol.Optional("origin"): vol.In(["map", "manual"])`
- `websocket.py:9974` — `origin=msg.get("origin") or "map"`
- 9 call sites: `views/calibration.js` (8), `views/maps.js` (1) — all `origin: "manual"`
- `tests/test_fabric_store.py::test_batch_save_command_forwards_origin` and the two
  origin-specific model tests

The doctrine test gets **stronger**, not deleted: it stops asserting "a manual entry holds"
and asserts a transform change moves *nothing at all*.

### 4. The fabricated scale — root cause of the live Position1 defect

`async_derive_transforms`' fallback sets `ppm = img_w / default_floor_width_m`, which
algebraically forces `scale_x_m` to exactly `default_floor_width_m` (20.0) for every
never-measured map regardless of what the photo shows.

- the fallback branch in `async_derive_transforms`
- `websocket.py:9889` `vol.Optional("default_floor_width_m")`, consumed at `:9906-9907`
- `views/health.js:440` which supplies it

Replace with a refusal: an unmeasured map seeds nothing and remains a display-only image
until someone measures it. Inventing a 20 m house is how the fabric got poisoned in the
first place (see `fabric-independence-plan-2026-08-10.md`).

---

## Keep

1. **`async_rederive_map_fracs`** (`model_store.py:1491`) — metres → fracs. This is the
   correct direction: the fabric is truth and the photo renders it. Note it currently
   re-injects fabric entries claiming a map (`:1519-1535` scanners, ~`:1587` beacons); that
   behaviour stays and is why removal must be explicit.
2. **`async_migrate_from_maps`** (`model_store.py:1027`) — already seed-only: it skips any
   key already present, and startup only calls it when `not has_spatial_model()`
   (`__init__.py:351`). This becomes the single sanctioned frac→metre conversion. It already
   returns `rooms_migrated: 0` — rooms have been independent since pass 1.
3. **`fabric_scanner_remove`** (`websocket.py:9275`) and **`fabric_beacon_remove`**
   (added in pass 3) plus their UI wiring in `views/calibration.js`. With nothing
   re-deriving, explicit removal is the only way anything leaves the fabric. Load-bearing.
4. **`async_batch_save_spatial`** (`model_store.py:851`, 93 lines) — stripped of origin
   logic, it becomes plainly "a person placed this; convert once, write."

---

## Open decision: barriers

`replace_map_barriers` (`fabric_store.py:570`, called from `model_store.py:937` and `:1279`)
replaces a map's barriers wholesale — and that *is* how barrier editing works today: they
are drawn on the photo in Maps → Edit. Barriers also have no stable identity; unnamed ones
auto-generate as `Barrier {map_id}_{idx+1}`, which is index-keyed, so reordering renames
them. That is why pass 3 deliberately left barriers map-origin.

Single-class requires picking one:

- **(a)** Barriers get a metre-space editor, as rooms have in the Rooms tab. Fully
  consistent, materially more work, and needs a real identity scheme first.
- **(b)** The photo remains their editor of record: an Edit save legitimately replaces that
  map's barriers. Cheap, and defensible *provided* it is the only thing the photo still
  writes and that is stated plainly in the code.

Recommendation: **(b)** for pass 4, **(a)** later if barriers ever warrant hand-tuning.
8 of 41 live entries are barriers.

---

## Verification

Pass 3 shipped broken because its tests called `async_batch_save_spatial` directly and never
crossed the websocket handler, which silently dropped the `origin` it had just declared in
its own schema. Do not repeat that.

1. **Every test drives the websocket command**, never the model function directly. See
   `test_batch_save_command_forwards_origin` for the pattern (fake `hass.data`, MagicMock
   connection, call `ws_*` directly — `conftest.py` makes handlers plain callables).
2. **Prove each deletion.** Restore the deleted line/branch and watch a test fail. A test
   that passes both with and without the code under test proves nothing.
3. **The global invariant** — this pass's payoff, and something pass 3 could never have:

   > Nothing writes spatial data to the fabric except an explicit placement.

   One test: snapshot the fabric, change a map transform, then run a map save, an
   align-to-stack and a positioning repair. Assert the fabric is byte-identical.
4. **Live check before claiming done.** Hash `/config/.storage/padspan_ha.fabric` on the HA
   box, exercise all three paths through the real UI, hash again. "Tests pass" is not the
   claim; "the store did not change" is.

---

## Ordering — do this first

After pass 4, correcting a photo's placement will no longer correct scanners derived
through the bad one. That is the doctrine working, but it means **anything currently
derived from a bad transform must be repaired before pass 4 lands**, or it is frozen wrong
and has to be re-placed by hand.

As of 2026-08-12 there is exactly one such map — every other map agrees with stack
alignment to the decimal:

```
floor __outside__ — 'Position1.jpg' (5da332482f20f9e6), 2 receivers
   system: 20.0 x 84.2m @(0.0, 0.0)     <- fabricated 20m default
   stack : 10.0 x 42.2m @(0.0, 0.0)
```

Exactly 2× in both axes. Fix via Mapping → Rooms → floor `__outside__` → "Fix alignment",
then pin those 2 receivers in Calibration → Tune so they are fabric-native before the
implicit writes disappear.

---

## Live state a fresh session will need

Verified on the HA box 2026-08-12; re-check rather than trust, but this is where to look.

- Fabric: `/config/.storage/padspan_ha.fabric`. 41 spatial entries — 21 scanners,
  12 beacons, 8 barriers. After pass 3 deployed (v0.29.2), 6 scanners on `Electrical-3` are
  `origin: "manual"`; the other 35 remain `map`. Rooms: 25 across 4 floors (2 finalized),
  18 `correction` + 7 `legacy_import`.
- Metre anchor: `Electrical.jpg` (`62abcefffa49b57d`), `m_per_world = 10.0364`. It is the
  only map carrying `reference_measurements` — 1 of 9.
- **254 of 746 calibration points are orphans** (`map_id: ""`) with metres.
  `calibration_store.async_remap_from_metres` defaults to `adopt_orphans=True`, so any
  `fabric_map_transform_set` permanently adopts whichever re-derive inside 0-1 fracs into
  that map. This is not reversible by restoring the transform. `fabric_map_reanchor` passes
  `adopt_orphans=False` (`model_store.py:1691`) and is the safe transform path.
- Backups on the host: `padspan_ha.fabric.bak-20260812-pre-pass3`, and the
  `-pre-pass2` / `-pre-0254` / `-pre-repair` sets from Aug 10-11.
- Deploy: `scripts/release.py X.Y.Z` (pre-release always), then
  `ssh administrator@192.168.1.2 "sed -i 's/vOLD/vNEW/' /tmp/deploy_padspan_0240.py && python3 /tmp/deploy_padspan_0240.py"`.
  The restart POST returns 504 — expected. Poll `http://192.168.1.11:8123/` until 200.
  A panel tab open through the restart keeps its old JavaScript; reconnecting does not
  re-fetch modules. Confirm the sidebar shows the new version before testing anything.
