# Idea: Live Door/Window State — Opening Walls + Steel-Door RF Barriers

**Status: NOT STARTED — captured for later (Garry, 2026-09-06).** Not part of
the ranked best-in-class roadmap (`docs/BEST_IN_CLASS_ROADMAP.md`); a
separate, standalone feature idea. Garry asked for this to be thought
through and written up as a complete, self-contained prompt so a future
session (or Tuesday 2026-09-08, if not picked up sooner) can start directly
from this document with no other context.

## Origin (Garry's own words, verbatim, 2026-09-06)

> Another feature for mapping, lights, is door open or closed. A section of
> wall opens up if a door open/closed sensor show the door/windows is open.
> Add to that a toggle so that a steel door can be selected, and that also
> registers in the padspan main as a radio blocking wall. Think this one
> thru for the tuesday session.

## The problem being solved

Today a wall/barrier in the fabric (`rf_barriers_m`) is a static line: fixed
geometry, fixed `attenuation_dbm`, drawn once, never changing. Two things a
real house has that this doesn't capture at all:

1. **Visually**, a door or window is a gap in a wall that is sometimes open
   and sometimes closed — the map currently draws every wall as one
   unbroken dashed line regardless (`overview.js` — see "Relevant existing
   code" below), so an open door looks identical to a closed one.
2. **Physically**, a CLOSED steel door blocks BLE signal roughly like a
   wall does; an OPEN steel door blocks essentially nothing — it's a hole.
   Every other wall material in this codebase is currently a fixed,
   always-on attenuation value with no live component at all.

Grepped for any existing door/window integration first: none exists.
`ws_occupancy.py`'s sensor classes are `("occupancy", "presence", "motion")`
only (`ws_occupancy.py:73`) — no `binary_sensor` with `device_class: door`
or `device_class: window` is read anywhere in this codebase today. This is
new integration surface, not an extension of something half-built.

## The feature, precisely

Two coupled but separable pieces:

1. **Visual door/window state on the map.** A door or window is placed on
   a wall/barrier segment (or as its own short segment within one), linked
   to an HA `binary_sensor` with `device_class: door` or `window`. When
   that sensor reads `on` (open), the map draws a visible GAP in the wall
   at that door/window's position instead of the unbroken line — "a
   section of wall opens up." When `off` (closed), the wall draws solid,
   same as every other barrier today.
2. **Steel-door toggle → dynamic RF barrier.** A per-door toggle marks a
   door as steel (vs. a default/other material). When steel:
   - **Closed**: the door segment attenuates BLE signal like a real wall
     — feed it into the SAME `attenuation_dbm` mechanism every other
     barrier already uses (see below), not a parallel system.
   - **Open**: the attenuation for that segment drops to ~0 — an open
     steel door is a hole, not a wall, for radio purposes exactly as much
     as it is for the eye.
   A non-steel door/window (wood, glass) is visual-only in v1 — no RF
   attenuation change either way; most residential interior doors and all
   windows don't meaningfully block 2.4 GHz BLE regardless of open/closed,
   and this project already default-attenuates ordinary walls at 6 dB
   (`radio_map.js:259`, `bar.attenuation_dbm ?? 6`) — a non-steel door
   already has a barrier's default value if it sits ON a barrier line, or
   none if it doesn't. Steel is the one material where open-vs-closed is a
   genuinely different physical situation worth modelling.

## Relevant existing code to build on — do not reinvent

- **Barrier data model**: `model_store.py:31` — `rf_barriers_m: [{points_m,
  attenuation_dbm, floor_id}]` (also carries `id`, `name`, `material` per
  the JS mirror at `stack_transform.js`'s `fabricWorldBarriers`:
  `{id, name, material, attenuation_dbm, points}`). `model_store.py:948`
  exposes `rf_barriers_m()`; editing lives in `ws_maps.py`/`maps.js`'s
  Rooms tab (barrier draft, per the barrier-editing comments already in
  that file).
- **Barrier attenuation is ALREADY re-read every poll — the key finding
  that makes the dynamic (open/closed) half of this feasible without
  restructuring anything**: `presence_coordinator.py:670` — "RF barrier
  data for Gaussian scoring penalty (rebuilt each poll)"; `:1175-1176`
  re-fetches `self._rf_barriers` from `_model.rf_barriers_m()` on every
  single poll cycle, and `:2143-2147` calls `_barrier_attenuation(...)`
  fresh each time using whatever `attenuation_dbm` that fetch returned.
  **This means `rf_barriers_m()` computing a barrier's attenuation from a
  linked entity's LIVE state, instead of a stored constant, requires no
  new polling loop, no new subscription, no change to
  presence_coordinator.py at all** — only a change to what
  `rf_barriers_m()` itself returns for a barrier that carries a
  `linked_entity_id` + `material: "steel"`. The client-side mirror
  (`radio_map.js:253` `barrierAttenuation`, used by the coverage-heatmap/
  what-if tools) would need the SAME live-state check for its preview to
  agree with the live solver, since it currently just reads
  `bar.attenuation_dbm ?? 6` (`radio_map.js:259`) with no state awareness.
- **Wall drawing on the map**: `overview.js:1263-1271` — barriers are
  drawn once per storey as a single unbroken `<polyline>` per barrier
  (`stroke-dasharray="5 8"`, gated on the existing `_overviewShowWalls`
  toggle, `overview.js:933`). This is the ONE place (plus its Pure
  Live/iso_lights.js siblings drawing barriers — check `iso_lights.js` and
  any Stack-tab barrier rendering too) that would need to draw a GAP in
  the polyline at a door/window's position along it, live-state-driven.
  No existing code splits a barrier polyline into segments around a
  midpoint gap — this is new drawing logic, not a toggle on something that
  already exists.
- **Precedent for binding an arbitrary HA entity to the floorplan**: gap
  #8 of the best-in-class roadmap (DONE, commit `53ee119`) already built
  exactly the "pick an HA entity, place/link it on the map, read its live
  state each poll" pattern — for the `lock.*` domain. Read that
  implementation first (`ws_fabric.py`'s placement whitelist,
  `light_codes.js`'s `isLock`/`LIGHT_SHAPES`, `iso_lights.js`'s lock glyph,
  `lights_map.js`'s lock control card) as the direct template for "pick a
  `binary_sensor.door`/`binary_sensor.window` entity and place/link it,"
  adapted from a placed MARKER to a barrier-attached GAP.

## Technical challenges

1. **Where does a door "live" in the data model?** Two shapes to weigh:
   (a) a door is its OWN small object type (new list, `doors_m` or similar,
   each with its own `{x_m, y_m, floor_id, linked_entity_id, material,
   width_m, angle}`), positioned independently and only VISUALLY
   associated with whichever barrier polyline happens to pass near it; or
   (b) a door is an attribute attached to a SPECIFIC point/segment on an
   EXISTING barrier (`rf_barriers_m` entry gains an optional
   `door: {linked_entity_id, material, offset_along_segment}`). (b) keeps
   the RF-attenuation logic naturally scoped to "this barrier, this
   segment" (no need to reconcile "does this independent door object sit
   on this barrier" as a nearest-line-search every poll) but constrains a
   door to only exist where a barrier has already been drawn — matching
   the roadmap's own gap #8 domain-registry pattern would favour (a) for
   consistency, but (b) is likely simpler and more physically honest
   ("this wall has a door in it" rather than "there is a door floating
   near this wall"). Decide before implementing; don't half-build both.
2. **Wall-gap drawing.** A barrier is currently one polyline per barrier.
   Drawing a gap means splitting it into two (or more, for multiple
   doors on one wall) polyline segments around each open door's position,
   recomputed live each render — a modest but real change to
   `overview.js:1263-1271` and its Pure Live/iso_lights.js/Stack-tab
   counterparts (barriers are drawn in more than one place; find every
   caller before changing the shape barriers are described in, so one
   view doesn't fall out of sync with the others). The gap's width should
   probably be the door's own width in metres if stored (or a fixed
   reasonable default like 0.9 m), not the whole barrier's length.
3. **Steel-door attenuation lookup, live.** `rf_barriers_m()`
   (`model_store.py:948`) currently just returns stored dicts — it has no
   HA `hass` access to check a live entity state today (it's a pure data
   accessor). Giving it (or a wrapper the coordinator calls instead) live
   state access needs care: either `rf_barriers_m()` gains an optional
   `hass` parameter and does the state lookup itself only for
   steel-flagged barriers (cheap — most barriers won't have a linked
   entity at all), or the state resolution happens in
   `presence_coordinator.py` at the point it already calls
   `_model.rf_barriers_m()` (`presence_coordinator.py:1175`), overriding
   `attenuation_dbm` there for any barrier carrying a `linked_entity_id`
   before handing the list to `_barrier_attenuation`. The second option
   keeps `rf_barriers_m()` a pure data accessor and puts the "live" part
   where live things already happen (the coordinator's own poll) —
   probably the better fit with this codebase's existing separation.
4. **Client-side heatmap/what-if preview parity.** `radio_map.js`'s
   `barrierAttenuation` (used by the coverage heatmap and gap #9's what-if
   ghost-scanner tool) is PURE CLIENT JS with no live HA state access of
   its own — it works off whatever `rf_barriers_m` data the frontend
   already has in `ctx.state.model`. If the backend resolves live state
   into `attenuation_dbm` before the frontend ever sees it (folding the
   open/closed state into the number the client already reads), this
   requires NO separate client-side state-awareness at all — the
   heatmap preview would just see today's attenuation number and be
   correct automatically. Strongly prefer this shape (resolve live state
   server-side, ship one number) over teaching the client its own
   parallel live-state-lookup logic.
5. **A door with no linked sensor.** Must degrade gracefully to "closed,
   plain wall" (today's exact behaviour) — a door/window feature must
   never make an install that hasn't configured any sensors look or
   behave any differently than it does today.

## What "done" looks like

- A door/window can be added to a wall/barrier (via the Rooms tab, same
  general editing surface `rf_barriers_m` already uses), linked to an HA
  `binary_sensor` (`device_class: door` or `window`).
- The map (at minimum the Overview/Pure Live iso view where walls already
  draw today, `_overviewShowWalls`) shows a visible gap in the wall at
  that door/window's position whenever its linked sensor reads open, and
  a solid wall when closed — live, following the same ~5 s poll everything
  else already uses.
- A per-door "Steel" toggle. When set: the door's wall segment carries a
  wall-like attenuation while closed, and near-zero while open, and this
  measurably changes what the SAME positioning solver
  (`presence_coordinator.py`) computes — not just a cosmetic overlay,
  proven by comparing an object's confidence/room-vote near that doorway
  with the door open vs. closed (e.g. via a capture-and-replay pass, gap
  #13's tooling, comparing the two states on the same walk).
- Tests: a pure-function test for the wall-gap-splitting geometry (given a
  barrier polyline + a door's position + width, produces the two remaining
  segments) using this repo's established pure-JS + node-harness pattern;
  a Python test proving a steel-flagged barrier's resolved
  `attenuation_dbm` actually changes when the linked entity's mocked HA
  state flips open/closed, and that an unlinked or non-steel door leaves
  `attenuation_dbm` exactly as authored.

## Explicit non-goals for v1

- Non-steel doors/windows do not affect RF attenuation at all — visual
  only, per the reasoning above (ordinary interior doors/glass don't
  meaningfully block 2.4 GHz BLE either way).
- No attempt to model PARTIALLY-open doors, only binary open/closed
  (matches the binary_sensor device class itself — there is no "how far
  open" signal to consume).
- No new UI for hand-drawing a door's swing arc or hinge side — a door is
  a position + width + open/closed state, not an animated leaf.
- Does not need to be wired into every view that draws a wall on day one
  (Stack tab's 3D alignment view, if it separately draws barriers, is a
  reasonable v2) — ship it in the Overview/Pure Live iso view first,
  document what's deferred, the same tiering this session has used
  throughout the best-in-class roadmap (e.g. gap #7's Sweet-Home-3D-only
  floorplan import, gap #8's lock-domain-only entity binding).

## Research task before writing any implementation code

- Decide the data-model question in Technical Challenge #1 (door as its
  own object vs. an attribute on an existing barrier) — this shapes
  everything downstream and should not be revisited mid-implementation.
- Read gap #8's full diff (commit `53ee119`) end-to-end first — it is the
  most directly analogous precedent in this codebase (placing/linking an
  arbitrary HA entity onto the floorplan, reading its live state each
  poll, gating a UI toggle on it) and should shape this feature's shape
  rather than being reinvented from scratch.
- Confirm every place a barrier is currently drawn (Overview, Pure Live,
  iso_lights.js, any Stack-tab rendering) before touching the drawing
  code, so the wall-gap effect doesn't ship in one view and silently stay
  a solid line in another.

## Follow-up

Saved to Engram (project memory) alongside this file, and a calendar
reminder was placed for Tuesday 2026-09-08 in case this doesn't get picked
up sooner.
