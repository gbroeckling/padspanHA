# Idea: Live Door/Window State — Opening Walls + Steel-Door RF Barriers

**Status: ALL SIX STEPS BUILT, 2026-09-09.** Not part of the ranked
best-in-class roadmap (`docs/BEST_IN_CLASS_ROADMAP.md`); a separate,
standalone feature idea. Steps 1 (corrected), 2 (implicit — the backend
already passed extra `rf_barriers_m` fields through unchanged), 3, 4 and the
Mapping → Lights / Overview half of 5 are built. Only the explicit v1
non-goals below (Stack tab's 3D barrier drawing, partial-open modeling,
swing-arc UI, un-instrumented-doorway geodesic correction) remain out of
scope, by design.

**Correction to step 3/6, 2026-09-09 (live, deployed):** the plan's own
"Why editing stays Rooms-tab-only" decision (see "Design decisions" below)
was wrong in practice. Garry, after step 6's jump link shipped: "What
imaginary setup do you think I see for setting up a door or windows in the
software???? ... no-one can see the thing you seem to think is there ...
needs to be under lights to build." Then: "In lights it's triggered by a
sensor for open/close being placed." Fixed by moving the trigger AND the
picking interaction itself onto the Lights map: an unlinked door/window row
has a **Link on map** button (`maps.js`'s `onConfigureDoor`, replacing the
old jump to Rooms); clicking it arms `mapState._doorLinkEid`, and three
clicks on the Lights map — the wall (drawn faintly while armed, since an
ordinary wall otherwise never shows there — `iso_lights.js`), then its two
ends — commit via `_doorLinkPickWall`/`_commitDoorLink`. These reuse the
exact fabric mechanics the Rooms-tab picker already used
(`nearestPointOnPolyline`/`splitPolylineAtTwoPositions`, stack_transform.js;
the same `fabric_rf_barrier_set`/`remove` calls) — only the click surface
changed, and it is actually simpler: the Lights map is already in world
metres (`frame.isoInv`), so unlike the Rooms-tab photo overlay there is no
photo-fraction round-trip at all. Rooms → RF Barriers still works
unchanged — same fabric, either surface — it is just no longer the ONLY
way in. Tests: `tests/test_lights_door_link.py`.

**Correction to step 1, 2026-09-08 (live, deployed):** Garry, looking at the
shipped step 1 on the real map: "The placement in mapping and lights is not
making any sense, and is not consistant... Not sure what you created here"
— a door/window sensor was admitted as a freely-draggable point marker,
mirroring Motion/Temps exactly as step 1 originally specified. That was
wrong: a door has no physical point of its own the way a PIR or a
thermostat does — its real position is a SECTION OF WALL, which step 3
already models. Two disconnected representations of the same sensor (a
floating icon AND a wall link) is what "doesn't make sense" meant. Fixed by
retiring the point-marker path for this class entirely and pulling step 5's
visual forward to be step 1's real replacement — see "Design decisions"
below for the corrected shape of step 1.

## Origin (Garry's own words, verbatim, 2026-09-06)

> Another feature for mapping, lights, is door open or closed. A section of
> wall opens up if a door open/closed sensor show the door/windows is open.
> Add to that a toggle so that a steel door can be selected, and that also
> registers in the padspan main as a radio blocking wall.

And, 2026-09-08, sharpening the point of the whole feature: "this also
will allow a tie in to a open/closed sensor, that is the whole point. I
want the lighting map to clearly show when a door or window is left open."

## The feature, precisely

A door or window is a short **section of an existing wall**, marked out in
the Rooms-tab wall editor (the same place walls already get their material
assigned) and linked to an HA `binary_sensor` (`device_class: door` or
`window`). Two things follow from that link, live:

1. **Visual**: the Mapping → Lights map (the primary place this needs to
   read at a glance — that is "the whole point") shows a clear gap/open
   indicator on that wall section whenever the linked sensor reads open,
   and a solid wall when closed.
2. **RF**: a per-section material choice of **metal** (steel — reuses the
   wall editor's existing material picker, not a new "Steel toggle")
   attenuates BLE signal like a wall while closed, and drops to ~0 while
   open — feeding the SAME `attenuation_dbm` mechanism every other barrier
   already uses. A non-metal door/window is visual-only: no RF change
   either way (ordinary interior doors and glass don't meaningfully block
   2.4 GHz BLE regardless of open/closed).

Also required, independent of the above and shippable first: door/window
sensors are admitted and shown as their **own recognized device type** in
the Mapping → Lights index and map — the same way Motion and Temps already
are — regardless of whether that sensor is yet linked to a wall section.

## Implementation plan, in order

Each step is independently shippable and testable; later steps depend on
earlier ones, not the reverse.

1. **DONE, corrected 2026-09-08 — admit door/window sensors as a new class
   in Mapping → Lights, WITHOUT a point marker.** Originally specified (and
   first shipped) as a direct mirror of Motion/Temps — a draggable point
   icon. Live feedback showed that was wrong: a door has no point of its
   own to place. The corrected shape:
   - `lights_map.js`: admission gate, `LIGHT_CLASSES` chip, `light_codes.js`
     `isDoorSensor`/`DOOR_BORDER`/D-series code — all as originally planned,
     unchanged. Still shows as a row in the Lights index table.
   - **Never joins point-placement**: `iso_lights.js`'s `buildIsoSVG` drops
     any door/window entity from both the placed-marker loop (even a legacy
     `light_positions_m` entry) and the room's unplaced hex-cluster pile —
     a door is never a draggable icon, placed or not. `maps.js`'s
     `_lightsTab` excludes doors from the placed/unplaced checklist, the
     bulk queue, Spread and Accept-room-centres (`placeableLights`).
   - **The Lights table's Map column** shows link status instead of a Place
     button for a door row: "🔗 Linked" once an `rf_barriers_m` entry names
     it as `linked_entity_id`, otherwise a "Link in Rooms →" button
     (`onConfigureDoor`) that jumps straight to Rooms → RF Barriers — a
     small piece of step 6 pulled forward specifically for this row, since
     without it an unlinked door had no path forward at all.
   - The actual spatial visual is step 5's barrier pass, below — a door's
     marker IS the wall section it's linked to, nothing else.
   - Test: `tests/test_lights_renderer.py` (marker suppression, both
     placed and unplaced), `tests/test_lights_free_gate.py` (table link
     status + code-column click gating), `tests/test_door_window_barriers.py`
     (placement-bookkeeping exclusion, `onConfigureDoor`/`doorLinkedIds`).

2. **Extend the `rf_barriers_m` schema, additively.** Backend only, no
   drawing or UI yet. Add optional `linked_entity_id` and `door_type`
   fields to a barrier entry; leave `material`/`attenuation_dbm` as they
   are (a door's material IS the existing `material` field — "steel" is
   `metal`, not a new value). A barrier without these fields must render
   and behave byte-identically to today.

3. **Rooms-tab editing: select a wall section, split it, link a sensor.**
   The one genuinely new UI interaction in this whole feature — nothing in
   the codebase today splits a drawn wall polyline into pieces. Splitting
   happens once, at edit time, producing an ordinary short `rf_barriers_m`
   entry (the door) plus the shortened remainder of the original wall.
   Reuse the existing material picker for that new entry's `material`;
   reuse gap #8's entity-picker pattern (`53ee119`, the lock-domain
   binding — the direct precedent for "pick an HA entity and link it to
   something on the map") for `linked_entity_id`.
   - Test: pure-function test for the section-split geometry (given a
     barrier polyline + a split position + width, produces the two
     resulting segments), this repo's established pure-JS + node-harness
     pattern.

4. **DONE, 2026-09-09 — live attenuation resolution.** In `presence_coordinator.py`, at the
   point it already re-fetches `rf_barriers_m()` every poll, override
   `attenuation_dbm` for any barrier carrying a `linked_entity_id` and
   `material==="metal"`: closed → the material's normal value, open → ~0.
   Resolve server-side, once, here — NOT in `rf_barriers_m()` itself
   (keeps it a pure data accessor) and NOT by teaching the client-side
   `radio_map.js` its own parallel state-lookup (`barrierAttenuation`
   already just reads whatever `attenuation_dbm` it's given, so the
   coverage-heatmap/what-if preview stays correct automatically once the
   backend resolves the number once).
   - Test: Python test proving a metal + linked barrier's resolved
     `attenuation_dbm` changes when the linked entity's mocked HA state
     flips open/closed, and that an unlinked or non-metal door leaves
     `attenuation_dbm` exactly as authored.
   - **Debounce the flip** (lesson from the prior-art research below):
     require the linked sensor's new state to hold across 2 consecutive
     polls before applying the attenuation override, rather than trusting
     the very first reading. Cheap, and guards against a flapping/bouncing
     door sensor making the solver jitter right at a transition — both
     alternative approaches researched below avoid trusting a single
     instant reading blindly, in their own different ways; this is the
     equivalent guard that costs almost nothing to add here.

5. **DONE (Mapping → Lights + Overview) — draw the open/closed state.** For
   a barrier entry carrying a `linked_entity_id`: closed draws the ordinary
   wall/barrier line; open fades it and switches to a thin rose dash
   (`DOOR_BORDER`, `#fb7185`) — a visible, distinctly-coloured indicator, not
   a silent gap, matching the strong visual language motion (the pulse) and
   Automorph already established. `iso_lights.js` gained a new, narrowly
   scoped barrier-drawing pass for exactly this (it still draws no
   *unlinked* barrier — that stays Rooms-tab-only); an unlinked door leaves
   the map byte-identical to before this feature existed. `overview.js`'s
   existing `<polyline>`-per-barrier loop (`_storeyOf`'s `barriers` array,
   `ctx.state._overviewShowWalls`) got the same open/closed branch, reading
   the SAME linked entity's live HA state, so the two views can never
   disagree about whether a given door reads open.

   **Endpoint markers** (Garry, 2026-09-08): "have a small purple dot
   showing on the two sides where the opening starts and ends." Shipped in
   both views — `#9333ea`, confirmed distinct from `maps.js`'s
   `_MAT_COLORS.custom` purple (`#a855f7`) and from the drop-marker pink
   (`#e879f9`) already used elsewhere on the Lights map, per the caution
   below. Drawn at the barrier's own first/last `points_m` entry, in BOTH
   open and closed states.

6. **DONE, shipped as part of step 1's correction — jump link from
   Mapping → Lights to the Rooms-tab wall editor.** `maps.js`'s
   `onConfigureDoor` (paid/builder-only, same gate as `onPlaceRow`) switches
   the map into barriers mode and jumps to the Rooms tab; `lights_map.js`
   wires it to the Lights table's "Link in Rooms →" button for an unlinked
   door row (see step 1). Originally scoped as a later, separate step, but
   pulled forward once step 1's correction showed an unlinked door had no
   path forward at all without it.

## Explicit non-goals for v1

- Non-metal doors/windows do not affect RF attenuation at all — visual
  only (ordinary interior doors/glass don't meaningfully block 2.4 GHz
  BLE either way).
- No attempt to model PARTIALLY-open doors, only binary open/closed
  (matches the binary_sensor device class itself — there is no "how far
  open" signal to consume).
- No new UI for hand-drawing a door's swing arc or hinge side — a door is
  a position + width + open/closed state, not an animated leaf.
- Stack tab's 3D alignment view (if it separately draws barriers) is a
  reasonable v2, not day one — same tiering this session used throughout
  the best-in-class roadmap (e.g. gap #7's Sweet-Home-3D-only floorplan
  import, gap #8's lock-domain-only entity binding).
- A door with no linked sensor must degrade to exactly today's behaviour
  (a plain, solid, static wall) — this feature must never change how an
  install with no door sensors configured looks or behaves.

## Prior art — what others do differently (researched 2026-09-08)

Checked the actual field before assuming this was a solved problem
elsewhere. No existing system, HA-ecosystem or academic, does what this
plan proposes — a specific `binary_sensor.door` deterministically
overriding one specific wall segment's attenuation in a live solver, the
instant it changes. Two different approaches turned up instead:

- **BPS** ([github.com/Hogster/BPS](https://github.com/Hogster/BPS)),
  built on top of [Bermuda](https://github.com/agittins/bermuda) for Home
  Assistant — the closest real-world comparison, same category of tool as
  PadSpan (BLE trilateration + floorplan tracking). Handles door state
  completely differently: no linked sensor, no per-wall override. Instead
  it runs continuous statistical auto-calibration — samples every 30s into
  a rolling ~6-hour window, re-solves every 15 minutes, and absorbs "a
  door staying open" as one more source of drift alongside furniture
  moving. It never knows WHICH door opened or why the signal shifted, it
  just re-averages over time.
- **Academic indoor-localization research** takes a third route: rather
  than a static wall with a punched-through attenuation exception, recent
  work uses geodesic/pathfinding-based path-loss models — signal loss is
  computed along the actual shortest walkable route through the floorplan
  ([Geodesic Path Model for Indoor Propagation Loss Prediction, PMC
  9269714](https://pmc.ncbi.nlm.nih.gov/articles/PMC9269714/)). A doorway
  falls out of the geometry as a low-loss path; it is never modeled as a
  discrete sensor-driven event at all. See also [Obstruction-aware
  Bluetooth Low Energy Indoor
  Positioning](https://ewireless.eng.ed.ac.uk/sites/ewireless.eng.ed.ac.uk/files/attachments/Obstruction-aware%20Bluetooth%20Low%20Energy%20Indoor%20Positioning.pdf).

What this means for the plan above: it trades "needs the actual door
sensor and someone to mark the wall" for something neither alternative
has — an immediate, exact correction on a real, known event, not an
average that eventually catches up (BPS) and not a geometric assumption
that can't tell a closed steel door from an open wooden one (geodesic
models). There is no prior art to borrow the hard parts from, but also
nothing indicating the idea itself is wrong — just genuinely new ground
for this class of tool.

**Lessons actually worth taking from the comparison:**
- **The speed advantage is real, not just claimed.** PadSpan's
  `presence_coordinator.py` already polls roughly every 5s; BPS's
  statistical correction re-solves every 15 minutes. Confirmed, not
  assumed — this plan's live per-poll reactivity is a genuine, checkable
  advantage over the closest comparable tool, not a hand-wave.
- **Added to step 4 above**: a 2-poll debounce on the sensor flip before
  applying the attenuation override. Both alternatives avoid trusting a
  single instant reading blindly (BPS by smoothing over a rolling window,
  the NLOS/obstruction-aware research by modeling uncertainty rather than
  a hard number) — this is the cheap equivalent guard for this design.
- **A real gap this feature does NOT address, worth naming rather than
  silently leaving out**: an un-instrumented doorway (no sensor
  configured) gets no correction at all, same as today. The geodesic
  path-loss approach is the natural way to close that gap generally —
  but it is a materially different, floorplan-geometry-wide technique,
  not a small addition to this plan. Worth a one-line forward-pointer
  only: a genuinely good separate future idea if better accuracy near
  UN-instrumented doorways ever matters, not in scope here.

## Design decisions (resolved) — reference only

Kept for the reasoning behind the plan above; not required to start
building from it.

- **Why a door is an ordinary `rf_barriers_m` entry, not a new object
  type or an attribute bolted onto a whole barrier**: splitting the wall
  once at edit time (step 3) means a door needs no new geometry concept
  at render time, and no "does this door object sit on this barrier"
  reconciliation every poll — it already IS a barrier, just a short one,
  reusing the existing `material` field instead of inventing a parallel
  attenuation concept for "steel."
- **Why editing stays Rooms-tab-only rather than being duplicated in
  Mapping → Lights**: the wall editor and its material picker already
  live there; rebuilding that surface in Lights would be pure duplication
  for no capability gain, versus a jump link (step 6).
- **Why Mapping → Lights still needs new rendering (not just editing)
  capability**: because showing open/closed state IS the feature's stated
  purpose, not an optional extra — confirmed directly by Garry after the
  editing-surface question was settled.
- **Effort, by direct comparison**: gap #8 (lock-domain binding,
  `53ee119`, 7 files / ~190 lines) is the closest precedent for "bind an
  HA entity to the map," but its own commit message calls it the simplest
  of six remaining domain generalizations, because a lock's state shape
  already matched the existing marker pipeline. This feature adds two
  mechanisms nothing in the codebase does today — splitting a drawn wall,
  and live-resolving an attenuation value — so size it bigger than gap #8,
  not as an instance of it. Step 1 (device-class admission) is the
  exception: that step genuinely is gap-#8-sized, and can ship first and
  independently.
- **What was checked against the live tree, not assumed**: no existing
  door/window integration anywhere (`ws_occupancy.py`'s sensor classes
  are occupancy/presence/motion only); `iso_lights.js` draws zero
  barriers today; a material→attenuation table already exists in
  `maps.js` (`_MAT_ATTEN`: `metal:12, concrete:8, brick:4, custom:6,
  open:0` dB, matching `_MAT_COLORS`) — confirming "steel" belongs there
  as `metal`, not as a new key.

## Follow-up

Saved to Engram (project memory) alongside this file.
