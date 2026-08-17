# Outside attribution — plan (2026-08-17)

## The problem, stated so it generalises

A device that is on the property but not in the building — a vehicle in the
driveway, a bike in the shed, a phone on the deck — is heard by every indoor
scanner faintly, through the walls. Nothing about a faint reading says
"outside": the room vote takes the strongest scanner as it should, and the
strongest of several faint readings is some indoor room on the perimeter. So a
parked Bronco lives in the Bedroom Closet, and a Tesla in the Garage sits on
the Garage/outside line and flickers.

Pinning is not the answer. A vehicle moves; a pin says it never does. And
"more outdoor scanners" is not the answer either: even with three of them here
(Shed, Richard's Shed, Outside) the indoor readings win, because the vehicle is
nearer the house wall than the shed.

The one thing that IS true of an outside device on a covered site: **no scanner
hears it well.** A device inside a house with 22 scanners always has at least
one scanner within a few metres — its strongest reading is high. A device
outside is heard by everything at −85…−100 and by nothing better. That is a
property of the *site's coverage*, and the site can measure it about itself.

## Options researched

**A. Coverage envelope (recommended, detailed below).** "No scanner hears it
well" is the one signature an outdoor device always has on a covered site.
Learned per site from calibration; no constants; nothing regresses where the
data is missing. Weakness: a poorly covered indoor corner (a device the house
genuinely hears badly) reads as outside — which the 5th percentile absorbs, and
which is also *true* in the sense that matters: the site cannot place it.

**B. Modelled envelope (physics instead of calibration).** Predict, from
scanner positions and walls, the best RSSI an indoor device could produce at
every point of every room (the same model the Heat overlay draws); the minimum
over the building is the floor. Works on a site with no calibration. Weakness:
the path-loss model is a coarse stand-in for real walls and furniture — the
Heat overlay itself needs a gain/contrast slider to look right — so its floor
is a guess where A's is a measurement. **Use B as the fallback when A has too
few points**, and let A take over as calibration accrues. Same rule, two
sources for one number.

**C. Stationarity + any outdoor sighting.** A device whose vector has not
changed for N polls and that an outdoor scanner hears at all is outside. This
is the intuition in the ask ("not moving, seen by the shed"). Weakness: an
outdoor scanner by a wall hears indoor devices near that wall; a static beacon
in the Laundry next to the Shed would be moved outside. Stationarity is not
evidence of place, and "heard by an outdoor scanner" is weak evidence on its
own. Both are useful *inside* A — as the diagnostics that say why — but not as
the rule.

**D. Outdoor scanners around the spot (hardware).** Three or more outdoor
nodes covering a driveway give a real outdoor position by the same solve the
house uses. This is the only route to "where on the property"; it is a
product/hardware offer ("outdoor node pack"), not a software rule, and A is
what tells the customer they need it.

**E. Vehicles as a class with a parking spot.** The user marks a device as a
vehicle and gives it a parking area (an outdoor room). When A says outside and
the vehicle's outdoor attribution is that room's scanner (or no outdoor scanner
hears it), it is "parked"; when it is heard well indoors it is the keys/phone
in the house; when not heard it is away. Commercially attractive (a real
"where is the car" answer). Builds on A; a later step, not part of this one.

**F. Perimeter-scanner gradient / relative ratios (outdoor RSSI minus best
indoor).** Direction from which perimeter scanner hears best, or a ratio test.
Site- and geometry-dependent constants everywhere; rejected.

## The concept: the indoor coverage envelope

Every calibration point ever recorded indoors carries the readings the house
produced for a device standing right there. `max(mean_rssi)` per point is "how
well the nearest scanner hears you at that spot". Across all indoor points, the
low tail of that number is the worst the house ever hears an indoor device — the
**coverage floor**. A live device whose strongest fresh reading is below the
floor is somewhere the calibration never reached, i.e. outside the covered
building.

That is site-specific, learned from data the site already has, and it tightens
as coverage and calibration improve. It contains no constant that is true of
one house and wrong for the next.

## Rules

1. **Coverage floor** — the 5th percentile of per-point strongest reading over
   calibration points on indoor floors. Undefined (rule inactive) below 30
   indoor points, or when the fabric has no outdoor floor at all (a site with no
   notion of "outside" cannot attribute to it). Recomputed when calibration
   changes.
2. **Outside test** — per object, per poll: `best_live` = strongest reading
   among sources within the silence grace. Enter *outside* when
   `best_live < floor − 2 dB`; leave when `best_live > floor + 2 dB` (a 4 dB
   band, the same shape of hysteresis the indoor↔outdoor room step already
   uses at 8 dB). Otherwise the state is held.
3. **Attribution while outside** — the *area of the outdoor scanner that hears
   it best*, if any outdoor scanner hears it within the grace (Shed, Richard's
   Shed, Outside…). The spatial solve is not run: with all scanners indoors, an
   x/y for an outdoor device is a centroid inside the house. k-NN is left alone
   (outdoor calibration points are data, and it may legitimately say Shed).
   If no outdoor scanner hears it, the rule changes nothing — the device stays
   attributed as today, and the state is only recorded in diagnostics. The rule
   only ever *adds* an outdoor attribution when there is outdoor evidence.
4. **Floor** — follows the room, as everything does now (`_object_floor`): an
   outdoor room's floor is the outdoor floor. An HA area with no fabric geometry
   ("Outside") resolves through the scanner-to-floor map, which is what the
   registry says about it.
5. **Map** — an outdoor-attributed object draws in its outdoor room (the
   overview already draws outdoor rooms as an overlay when enabled) or, with a
   room but no drawn geometry, at the tether ring — with the ring's tooltip
   naming the outdoor area. Nothing new is invented on the map.
6. **Home / away** — untouched. Away is "not heard"; outside is "heard, but not
   indoors". A device leaving the house passes through outside on the way to
   away, which is the correct sequence.

## What "outdoor floor" means, in one place

Two spellings exist today: the fabric sentinel `__outside__` and whatever the
HA registry calls its outdoor floor (`outside`, `outdoors`, `garden`, `yard`,
`exterior`…). `model_store._CONVENTIONAL_LEVEL` already ranks those names at
ground level. The names move to `const.OUTDOOR_FLOOR_NAMES` and both the model
store and the new rule read them there — one definition, no third copy.

## Where it lives

- `presence_rules.py` — pure functions, unit-tested:
  `indoor_coverage_floor(points, is_outdoor_floor)`,
  `outside_by_coverage(best_live, floor, was_outside)`,
  `is_outdoor_floor(floor_id)`.
- `presence_coordinator.py` — computes the floor once per poll from the
  calibration store; in `_smooth_room`, after `ema` is known and before the
  candidate is chosen: apply the outside test, and when outside with outdoor
  evidence, set the candidate to the outdoor area and skip the spatial solve.
  Per-object state `_outside_by_cov`. Diagnostics (`_spatial_debug`) say
  `outside_by_coverage: best=-91 floor=-84`.
- Snapshot: `obj["outside"] = True` on the object when the rule holds, so any
  UI or automation can read it without inferring from a room name.
- Capture header: the coverage floor is recorded (`hdr["cov_floor"]`) so a
  replay reproduces the decision.

## Commercial fit

- **Zero configuration.** No threshold to type; the site learns it from the
  calibration it already has, and a site with no calibration simply does not
  get the rule (nothing regresses).
- **Every site shape.** A flat with no outdoors: no outdoor floor → rule
  inactive. A farm with more outdoor scanners than indoor: the coverage floor
  is still what indoor points measured, and outdoor scanners attribute exactly
  as designed. A garage on the outdoor floor: it is an outdoor room, and a
  device heard best by its scanner is in it.
- **Explains itself.** The state is in the object and in diagnostics with the
  two numbers that decided it. A support question is answered by reading them.
- **Stable.** Hysteresis band + the vote window; a device on the threshold does
  not flap.

## What this does not do (and should not pretend to)

- It does not place an outdoor device where it *is* on the property. With
  indoor-only scanners that is not knowable; with outdoor scanners it is the
  nearest one's area. A metre position outdoors needs three outdoor scanners
  around the spot — a hardware fact, stated in the tooltip, not worked around.
- The Tesla in the garage is not this problem: it IS in the building, on the
  garage/outside seam. That is a room-boundary case and is left as it is
  (per the reframe).

## Verification

- Unit tests for the three rule functions, including the percentile with too
  few points, the hysteresis band, and outdoor-floor spelling.
- Coordinator test: an object with `best_live` below the floor and an outdoor
  scanner reading is attributed to that scanner's area; without outdoor
  evidence, unchanged.
- Live: the Bronco, parked, ends up in the outdoor area whose scanner hears it
  (Richard's Shed / Outside), and stays there; the capture records the floor
  used.
