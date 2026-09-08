# Idea: Live Door/Window State — Opening Walls + Steel-Door RF Barriers

**Status: NOT STARTED.** Not part of the ranked best-in-class roadmap
(`docs/BEST_IN_CLASS_ROADMAP.md`); a separate, standalone feature idea.
Every open design question has now been resolved through conversation
(2026-09-06 origin, 2026-09-08 scoping session) — the plan below is a
straight, ordered build path. Start here; the "Design decisions" section
below it is reference/rationale, not required reading to begin.

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

1. **Admit door/window sensors as a new class in Mapping → Lights.**
   Smallest, most precedented step — directly mirrors how Motion and Temps
   already work, no dependency on anything else in this plan.
   - `lights_map.js`: extend the admission gate (currently
     `/^(light|fan|binary_sensor)\./` plus an `isTempSensor` carve-out for
     `sensor.*` + `device_class==="temperature"`) to also read
     `binary_sensor.*` with `device_class` `door` or `window`.
   - `light_codes.js`: add `isDoorSensor`/`isWindowSensor` (or one
     combined `isOpening`), same shape as `isMotionSensor`/`isTempSensor`;
     assign a class (`"door"` or reuse a shared `"opening"` class).
   - `lights_map.js`'s `LIGHT_CLASSES`: add a `Doors/Windows` filter chip.
   - `iso_lights.js`: a distinct glyph/border colour, same pattern as
     `MOTION_BORDER`/the motion dome shape.
   - Shows as a row in the Lights index table automatically once admitted.
   - Test: extend the existing admission/class-filter render tests the
     same way the motion/temp ones are already covered.

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

4. **Live attenuation resolution.** In `presence_coordinator.py`, at the
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

5. **Draw the open/closed state — Mapping → Lights first, since that is
   the stated point of the feature; Overview second.** For a barrier entry
   carrying a `linked_entity_id`: while open, skip drawing its polyline
   (or draw it much fainter) and show a clear open indicator — a visible
   gap at minimum, worth also giving a distinct colour/glyph so it reads
   at a glance the way this session already gave motion (the pulse) and
   Automorph (the on/off material split) a strong visual language.
   `iso_lights.js` needs a new, narrowly-scoped barrier-drawing pass to do
   this at all (it draws no barriers today) — scope it to exactly this,
   no Automorph/aura interaction implied or needed. Apply the identical
   open-state logic in `overview.js:1263-1271` (today's single unbroken
   `<polyline>` per barrier) so the two views can never disagree about
   whether a given door reads open.

   **Endpoint markers** (Garry, 2026-09-08): "have a small purple dot
   showing on the two sides where the opening starts and ends." At the two
   points where a linked segment meets the rest of the wall it was split
   from, draw a small purple dot — in BOTH open and closed states (this
   marks WHERE a configured door/window is on the wall, distinct from the
   gap/solid-line difference that already conveys open-vs-closed). Note
   for whoever builds this: `maps.js`'s existing `_MAT_COLORS` already uses
   purple (`#a855f7`) for the `custom` material's own wall-line colour —
   pick a clearly distinct purple (or confirm the reuse reads fine
   side-by-side with a `custom`-material wall) rather than assume no
   collision.

6. **Jump link from Mapping → Lights to the Rooms-tab wall editor.** Small
   navigation convenience once steps 1-5 exist — a button that opens the
   Rooms tab's wall editor, for someone working the Lights view who wants
   to configure a door without hunting for where wall material lives.
   Check `lights_panel.js`/`maps.js` for an existing cross-tab navigation
   pattern before inventing one.

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
