# Identity and Geometry — the invariants, and what they retire

Written 2026-08-19, after issue #62 and #63 turned into a run of patches.

This is not a bug list. Both of those bugs, and most of the code written to fix
them, exist because of two design decisions that are individually reasonable and
jointly unsound. Naming them is worth more than the fixes.

---

## The three concerns, and where they bleed

| | question | owns |
|---|---|---|
| **Identity** | which advertisements are one physical device? | address rotation, iBeacon grouping, IRK resolution, split/merge |
| **Geometry** | what is a metre, and where is everything in metres? | fabric, `map_transforms`, stack, anchor |
| **Placement** | given identity + geometry + RSSI, where is it? | k-NN, path loss, Kalman, room votes |

Placement consumes the other two. So a defect in identity or geometry surfaces
as *bad tracking*, which is the hardest possible place to diagnose it — and it
is why "the Tesla is floating outside the house" is not necessarily a placement
bug at all.

---

## I1. One stored representation per fact

**A map's placement is stored twice, independently.**

- `model.map_transforms[id]` — metric: `origin_x_m`, `origin_y_m`,
  `scale_x_m`, `scale_y_m`, `rotation_rad`
- `maps.maps[].stack` — world: `scale`, `scale_x_adj`, `ref_ar`, offsets, or a
  solved affine `_m` (`maps_store.py:114`, `:182`)

Both describe where one picture sits. Nothing makes them agree. Every code path
that edits one must remember to edit the other, and the moment one forgets, they
drift — silently, because each is internally consistent.

Issue #62 **is** that drift: the crop path re-derived the metric record and left
the stack behind. Everything built to deal with it is scaffolding around the
duplication rather than a fix for it:

- `_recrop_stack()` — keeps the second copy in step on crop
- `stack_from_transform()` — rebuilds the second copy when it has drifted
- `map_geometry_faults()` — detects that the two copies disagree
- `ws_fabric_map_align_to_stack` / `ws_fabric_map_stack_rebuild` — reconcile
  them, in opposite directions
- the Rooms "Map placements" table, and the red warning above it, which exist to
  ask a human *which of our two copies is right*

> **Invariant:** metres are stored. World placement is **derived** from
> `map_transforms` and the frame, recomputed on read, never stored as an
> independent truth.

The stack keeps the fields a human actually tunes (which map is master, what it
references). Its *numeric placement* stops being storage and becomes a view.

**What that retires:** all six items above, the concept of "which side is
stale", and the class of bug entirely — not this instance of it. A derived value
cannot drift from its source.

**Cost:** hand alignment must be expressed as an edit to the metric record. That
is a real migration, and it is the honest one.

---

## I2. No writer may consult a rendering parameter

The metre anchor converts fabric metres into the rendering world frame. It is
chosen as *one designated map* — the first measured one — so it is a
**convenience for drawing**, not a fact about the building.

Four write paths currently consult it:

```
migrations.py:125        writes derived transforms
ws_calibration.py:390    writes calibration geometry
ws_fabric.py:515         map_align_to_stack -> writes map_transforms
ws_fabric.py:620         map_stack_rebuild  -> writes stack
```

That is why one trimmed map could put rooms wrong on floors nobody had touched:
a single map's error became the scale of the whole house, and then got written
down.

> **Invariant:** the anchor is available to **renderers only**. Any code that
> persists anything reads `map_transforms` directly.

The guard added in 0.36.0 — prefer a self-consistent map, fall back to the
least-skewed — reduces the chance of picking a bad anchor. It does not address
that a rendering convenience is feeding writers. Under I1 the anchor stops being
load-bearing at all, because there is only one stored geometry to render from.

*Checked on the reporting install and on the developer's: both have exactly one
measured map, so the guard changes nothing there. It is insurance, not a fix.*

---

## I3. Identity is address liveness, and it must survive a restart

An address is **in use** or **abandoned**. That is the whole question. A device
that keeps advertising on an address is one device; a device that mints an
address, uses it once and drops it is rotating.

Everything else in `decide_split()` — `all_rpa`, `default_uuid`, `same_oui` — is
a *proxy* for that question, guessing from what an address looks like. Each
proxy has a documented false-positive population. They accumulated because the
real signal was not available at the moment of the decision.

Issue #63 was not a wrong rule. `decide_split()` answers correctly when given
the previous poll's addresses, and its tests prove it. The caller passed
"addresses seen in the last 60 seconds" instead — a window that, for a device
rotating every 1.3 s, overlaps itself almost completely poll after poll. The
unit was honest; the input was not.

> **Invariant:** liveness is measured, not inferred. An address is live when it
> has been observed to advertise again. The look-of-the-address proxies are
> confined to an explicit cold-start window, are labelled as such, and are never
> consulted once liveness is known.

**The memory must NOT persist.** An earlier draft of this document said to
persist `hass.data[DATA_BEACON_LAST_MACS]` across restarts, on the reasoning
that a restart re-enters cold start for every device. That was wrong, and it
contradicted the invariant directly above it.

*Durable* means **"I have observed this address re-advertise."** After a
restart nothing has been observed. Restoring the flag makes the system assert
an observation it never made — evidence manufactured to avoid admitting a gap,
which is the same disease as the 60-second window in the opposite direction.
Cold start is not a defect to engineer around; it is the honest state, and the
`memory_is_settled` path already says so.

It would also buy almost nothing. Roughly thirty per-object dicts are RAM only
and die on the same restart — `_ema_rssi`, `_kalman_p`, `_room_votes`,
`_confirmed_room`, `_knn_position`, `_coverage_hist` among them. Restoring
identity alone hands a correct split to a pipeline that still cannot place
anything, for the ~15 s (`_SETTLED_POLLS = 3`) it would have taken to
re-measure liveness anyway — inside a window where scanners are still
re-registering.

The post-restart churn that prompted the idea was those other states, not this
one. **If a restart's churn is ever worth fixing, fix it where it is: the
smoothing and vote state, and only after measuring which one dominates.**

---

## I5. A decision may not change because evidence became unavailable

**"Nothing reported" is not "a weak reading."** Conflating them lets a decision
flip on the absence of data, which is the one input nobody is watching.

The outside rule broke this:

```python
_live_fresh = {s: v for s, v in ema.items() if _miss.get(s, 0) < _SILENCE_GRACE}
_best_live  = max(_live_fresh.values()) if _live_fresh else None
```

`_best_live` is the strongest scanner still inside the silence grace. When the
scanner that hears a device best goes quiet, that value does not degrade — it
drops to the *next-best*, which can be 25–30 dB lower, and crosses the coverage
floor in a single poll. The rule then reads "its best radio stopped reporting"
as "it left the building".

Two properties made that severe rather than merely wrong:

- **It is shared.** Scanners serve many devices, so every device whose best
  hearer went quiet flips in the SAME poll — a whole house outside at once,
  back the next poll. Per-object noise can never do that; only a shared input
  can.
- **It gates the solver.** `if ... and not _outside:` skips the indoor spatial
  solve entirely, so a flipping verdict is also a flipping *position*. The
  "some polls perfect, some a complete mess" symptom and the "beacons outside
  the house" symptom are one fault, not two.

The hysteresis already present (`band_db`, `was_outside`) could not help: it
damps the object's reading *against* the floor, so it cannot damp the reading
itself.

> **Invariant:** a rule that consumes live evidence takes its input from a
> window, not a poll, and a poll that carried no evidence contributes nothing
> rather than a low value.

Implemented as `coverage_evidence()` — a trailing max over
`COVERAGE_WINDOW_POLLS`. That also makes the rule **deliberately asymmetric**,
which is the correct shape and should be stated as design rather than
discovered later: going outside disables the indoor solve, so it is the
destructive claim and must survive a whole window; coming back inside needs one
good reading, because being wrongly inside costs only an ordinary room vote.

**The accepted trade:** a vehicle that genuinely leaves is now marked outside
after up to a window (~30 s) rather than immediately, and is solved indoors
until then. That is the price of not flipping the house, and it is the right way
round.

**Audit.** Every other decision taking `max()`/`min()` over a set that can
shrink was checked. `_rssi_best` (`presence_coordinator.py:2431`) is diagnostics
only. The room candidate already passes through a majority-vote window, which
honours this invariant. The outside rule was the only decision that broke it —
stated so that a future reader knows the sweep was done, not assumed.

---

## I4. Open question — can editing geometry move a live object?

Not yet answered, and it should be, because it decides how dangerous the Rooms
tab is allowed to be.

Placement produces metres. Rooms are metres. If a room polygon is edited, an
object's *coordinates* should not move — only which room contains it. If that
holds, geometry edits are safe by construction. If placement anywhere consumes
world space or map fracs rather than metres, it does not hold, and geometry
edits can teleport live objects.

The placement engine has not been read as part of this work. Nothing here should
be trusted about it.

---

## Order of work

1. **I4** — read the placement engine and answer the question above. Nothing
   further should be designed around geometry until this is known.
2. **I1** — make world placement derived. Deletes six pieces of machinery,
   including most of what was written for #62.
3. **I2** — falls out of I1: with one stored geometry there is nothing for a
   writer to consult an anchor for.

*(A fourth item, "persist the identity memory", was listed first here and has
been struck — see I3. It asserted evidence the system had not gathered, which
is the opposite of what I3 says.)*

---

## What this means for the work already done

Honest accounting, because shipping this as if it were finished would be the
messy outcome:

**Load-bearing, keep:**
- the crop path re-deriving the stack (correct under today's design, and
  harmless under I1 where the stack stops being stored)
- `decide_split` taking durable addresses rather than a staleness window — this
  is I3, arrived at from the right direction
- the Mapping sub-tab fix, the SVG tracking fix, the `this.actions` guard: plain
  defects, unrelated to any of this

**Scaffolding — expect to delete under I1:**
- `stack_from_transform`, `map_geometry_faults`, both reconcile commands, the
  Rooms placements table and its warning, the geometry fault critic and its two
  telemetry counters

Scaffolding is not waste — it is what makes the drift visible while the
duplication still exists. It should be *labelled* as temporary, not left to look
like architecture.

**Unproven against live radio:** the identity change. It has tests, including a
faithful reproduction of the reporting install's rotation rate and a
mutation-checked jitter guard. It has never run against real hardware for a
sustained period. It should not go out on a release cut in the same session it
was written.
