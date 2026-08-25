# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""One-shot upgrade repairs.

Each migration runs exactly once per install, guarded by a marker in the
fabric store, and is safe to call on every startup.

`fabric_photo_divorce` is the upgrade path onto the metre-only fabric. Before
it, scanner/beacon/barrier metres were continuously re-derived from
(photo fracs x that photo's transform), so a photo hanging in the wrong place
silently held wrong coordinates — and a never-measured photo was given a
fabricated 20 m width, which put every position on it at the wrong scale.
Nothing re-derives any more, which is the point: it also means whatever is
wrong today stays wrong. So the photo gets one final use on the way out —
transforms are repaired against the hand-tuned 3D stack, positions are
re-derived through the corrected placement, and the ownership keys that only
existed to serve re-derivation are stripped. After this the fabric stands on
its own and no image is consulted again.
"""

from __future__ import annotations

import logging
import math
import os
from typing import Any

from . import fabric_truth
from .const import (
    DEFAULT_FLOOR_ID,
    FABRIC_STORE_KEY,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
)

_LOGGER = logging.getLogger(__name__)

MARKER = "migrations_done"
PHOTO_DIVORCE = "fabric_photo_divorce"
LIGHTS_TO_METRES = "lights_to_metres"
CAL_POINT_FLOORS = "cal_point_floors"
BARRIER_IDS = "barrier_ids"
AUTOCAL_HYGIENE = "autocal_hygiene"
SHEAR_SIGN = "shear_sign"
UNREADABLE_PLACEMENTS = "unreadable_placements"
WORLD_GAUGE = "world_gauge_seed"
UNMEASURED_PLACEMENTS = "unmeasured_placements"
TIE_INS_TO_METRES = "tie_ins_to_metres"
DERIVED_PLACEMENT = "derived_world_placement"

# Per-MAP markers for the conversion, beside the per-step ones. A step marker
# would say "the conversion ran" for a store where half the maps had nothing
# to convert yet; each of those has to get another turn when it does, and none
# of the converted ones may ever be converted twice — a second pass reads an
# empty stack and would place the map at the world origin.
DERIVED_PLACEMENT_MAPS = "derived_placement_maps"

# THE SNAPSHOT COVERS EVERY STORE THE CONVERSION WRITES. Not "the stores the
# placement lives in" — the invariant is about what the restore has to put
# back, and the conversion writes three: the record through the Model store,
# the stripped stack through the Maps store, and its own per-map markers
# through the FABRIC store, which is also where the house's metre coordinates
# live.
#
# Omitting the fabric did not merely leave it out. `ws_store_backup_restore`
# reads a snapshot with no fabric entry as a PRE-FABRIC backup — one taken
# before that store existed — and clears the fabric so the next boot can
# rebuild it from legacy geometry. There is no legacy geometry to rebuild it
# from any more, so restoring the conversion's own safety net emptied the
# house: measured on a populated store, 4 of 4 `scanner_positions_m`, both
# floors, 40 history entries and every `rf_barriers_m` entry gone, under a log
# line that said "Restoring a pre-fabric backup". The one artefact the owner
# reaches for when the irreversible conversion goes wrong was the thing that
# destroyed their install.
CONVERSION_STORE_KEYS = [MAPS_STORE_KEY, MODEL_STORE_KEY, FABRIC_STORE_KEY]

# "A transform matching the stack this closely is already correct" was decided
# HERE, by a private four-field compare (_agrees, _ORIGIN_TOL_M,
# _SCALE_TOL_FRAC). It is decided by `fabric_truth.placements_agree` now — see
# step 1.


def _strip_legacy_keys(fab: Any) -> int:
    """Remove origin / z_origin / map_id — they only meant "re-derivable"."""
    n = 0
    for entry in list((fab.data.get("scanner_positions_m") or {}).values()):
        for k in ("origin", "z_origin", "map_id"):
            if k in entry:
                entry.pop(k, None)
                n += 1
    for entry in list((fab.data.get("beacon_positions_m") or {}).values()):
        for k in ("origin", "map_id"):
            if k in entry:
                entry.pop(k, None)
                n += 1
    for entry in list(fab.data.get("rf_barriers_m") or []):
        if "origin" in entry:
            entry.pop("origin", None)
            n += 1
    return n


def _identify_barriers(fab: Any) -> int:
    """Give every stored barrier an id and cut its photo link.

    Barriers were matched by name and unnamed ones were called "Barrier {n}"
    by list position; the map_id was kept only so an Edit-tab save could
    replace the walls that photo drew. Walls are placed and edited in
    metres now, by id, like everything else in the fabric.
    """
    n = 0
    for entry in list(fab.data.get("rf_barriers_m") or []):
        if not isinstance(entry, dict):
            continue
        if not str(entry.get("id") or "").strip():
            entry["id"] = f"bar_{os.urandom(4).hex()}"
            n += 1
        if "map_id" in entry:
            entry.pop("map_id", None)
            n += 1
    return n


async def async_run_photo_divorce(
    hass: Any, mdl: Any, ms: Any, fab: Any, cal: Any = None, backup: Any = None,
) -> dict[str, Any]:
    """Repair photo-derived coordinates once, then cut the cord.

    `backup(hass, note, store_keys) -> backup_id | None` is the ordinary
    auto-backup (`ws_backup._auto_backup`), injected so this module stays
    importable without the websocket layer — the same shape `bright_import`
    takes it in. NO SNAPSHOT, NO CONVERSION: the conversion deletes its own
    input, so it is the first thing in this file that cannot be run again to
    get a different answer, and an upgrade that silently had no safety net is
    worse than one that waited a restart.

    The snapshot is taken BEFORE THE FIRST STEP THAT WRITES, not just before
    the conversion. It used to sit immediately above it, on the reasoning that
    every other step is a repair re-derivable from data still on disk. That
    reasoning does not survive being measured: restoring it returned the
    POST-step-1 record, 27.857 m from where the owner started. A snapshot is
    only a safety net if it predates everything it is meant to undo.

    Returns a stats dict; {"skipped": True} if it has already run.
    """

    # The world gauge, BEFORE the marker check, and every startup.
    #
    # It is an ensure, not a step: it returns immediately once the gauge is
    # set, so running it always costs one dict read. Behind the marker it
    # would be a one-way door onto a value that can go missing without the
    # marker going with it — restoring a Model store backed up before this
    # release replaces `mdl.data` wholesale, taking `world_gauge` with it,
    # and a marker-guarded seed would then never run again. The house would
    # lose its metre scale permanently, at the moment the owner was trying to
    # recover it. The marker below still records that the seed happened; it
    # does not gate whether it can.
    _maps_now = (ms.data.get("maps") or []) if ms else []
    _had_gauge = fabric_truth.metre_gauge(mdl) is not None if mdl else False
    gauge = await mdl.async_ensure_world_gauge(_maps_now) if mdl else None

    done = set(fab.data.get(MARKER) or [])
    # Each step carries its own marker. A box that upgraded through an earlier
    # release has PHOTO_DIVORCE already set, and a step added afterwards must
    # still get its turn — one shared flag would silently skip it forever.
    todo = {PHOTO_DIVORCE, LIGHTS_TO_METRES, CAL_POINT_FLOORS, BARRIER_IDS,
            AUTOCAL_HYGIENE, SHEAR_SIGN, UNREADABLE_PLACEMENTS, WORLD_GAUGE,
            UNMEASURED_PLACEMENTS, TIE_INS_TO_METRES, DERIVED_PLACEMENT} - done
    if not todo:
        return {"skipped": True}
    # A step is marked done by the code path that RUNS it, never by the list
    # of steps that were outstanding. `done |= todo` marked every outstanding
    # step done including the ones whose preconditions were absent — no metre
    # anchor, no calibration store — and a marker is one-way: the step never
    # gets another turn. That silently skipped four of the six forever on
    # exactly the installs that had not measured a map yet.
    #
    # A step is marked done by its body COMPLETING, which is not the same as
    # its body starting. Six of the blocks below catch their own exception so
    # that one broken store cannot block the rest of the migration, and with
    # the marker as the block's first statement a step that raised half way
    # through was marked done for good: measured on a three-map store where
    # step 11 raised after the first map, the other two were left unplaced,
    # faulted, and unreachable by any later run for the life of the install.
    # So the marker is the LAST statement of the try, after the work it
    # claims. A step whose body raises is a step that has not run.
    ran: set[str] = set()

    stats: dict[str, Any] = {
        "maps_repaired": [], "maps_already_correct": 0,
        "positions_rederived": 0, "legacy_keys_stripped": 0,
        "cal_points_anchored": 0, "lights_converted": 0, "anchor": None,
        "cal_points_floored": 0, "barriers_identified": 0, "autocal_pruned": 0,
        "shear_signed": 0, "shear_no_matrix": 0, "shear_over_tol": 0,
        "placements_recovered": 0, "placements_stripped": 0,
        "placements_left": 0, "gauge_m_per_unit": None, "gauge_seeded": False,
        "unmeasured_placed": 0, "tie_ins_converted": 0, "tie_ins_dropped": 0,
        "measured_records_kept": 0,
        "conversion": None, "conversion_backup_id": None,
    }

    maps_list = _maps_now
    # The gauge was ensured above, before the marker check. Every step below
    # that used to MEASURE the anchor off a photograph on each call now reads
    # this one stored scalar. An install with nothing measured gets None,
    # does not mark the step, and is asked again next startup — the
    # `done |= ran` rule. Its FIRST measurement seeds it through the transform
    # writer instead, so this is the upgrade path and not the only path.
    anchor = gauge
    if WORLD_GAUGE in todo and anchor:
        ran.add(WORLD_GAUGE)
        stats["gauge_seeded"] = not _had_gauge
    stats["gauge_m_per_unit"] = (anchor or {}).get("m_per_unit")
    stats["anchor"] = (anchor or {}).get("source_map_id")
    stats["steps"] = sorted(todo)

    # THE SNAPSHOT, TAKEN BEFORE THE FIRST STEP THAT WRITES.
    #
    # It used to be taken between steps 12 and 13, on the reasoning that only
    # step 13 deletes its input while "every other step is a repair". That
    # reasoning does not survive being measured: on a pre-R1 store where step 1
    # repaired a map, restoring the conversion's own snapshot returned the
    # POST-step-1 record, not the one the owner had before the upgrade — 27.857
    # m of difference. The owner's escape hatch did not reach the run it exists
    # to escape from.
    #
    # A snapshot is only a safety net if it predates everything it is meant to
    # undo, so it is taken here, once, covering steps 1 through 13. The gate is
    # unchanged and still belongs to step 13: no snapshot, no conversion.
    _bk = None
    _will_convert = bool(anchor and DERIVED_PLACEMENT in todo and ms is not None)
    if _will_convert and backup is not None:
        try:
            _bk = await backup(hass, "Automatic — before world placement conversion",
                               CONVERSION_STORE_KEYS)
        except Exception as err:
            _LOGGER.warning("Snapshot before the placement conversion failed: %s", err)
    stats["conversion_backup_id"] = _bk

    # 1. Repair placements that disagree with the hand-tuned stack. Without a
    #    measured map there is no metre anchor and therefore nothing to check
    #    against — leave those alone rather than guess.
    if anchor and PHOTO_DIVORCE in todo:
        ran.add(PHOTO_DIVORCE)
        for m in maps_list:
            mid = m.get("id", "")
            t = mdl.map_transform(mid)
            # THE GATE STEP 13 HAS AND THIS ONE DID NOT — narrower than step
            # 13's, because the two steps ask different questions of the same
            # stack. Step 13 asks whether anybody PLACED it, because it is
            # choosing between two live descriptions. This step asks whether
            # the stack EXISTS, because a pristine legacy stack is a real
            # answer here: pre-R3 a map with one was drawn at the world origin
            # at unit size, and that is precisely the map this migration was
            # written for — a never-measured photo handed a fabricated 20 m
            # width, whose record says 20 m while the picture was drawn 10 m
            # wide. Gating on `_stack_is_a_hand_alignment` instead skips it
            # and the fabricated width survives the whole migration; that is
            # `test_repairs_a_photo_hung_at_the_wrong_scale`.
            #
            # What must not happen is reading a stack the conversion has
            # already deleted. See `_has_a_legacy_stack`.
            stk = m.get("stack") or {}
            if not _has_a_legacy_stack(stk):
                continue
            stack_t = fabric_truth.legacy_stack_metre_transform(m, anchor)
            if not stack_t:
                continue
            # THE agreement predicate, not a private one. What was here was a
            # four-field compare — origin x/y and the two scales — with ρ and
            # σ in neither, so it could not see a placement that differs only
            # by a turn or a lean. Measured on a 20 x 15 m map with an
            # identical origin and identical scales: a half-turn of rotation
            # scored AGREES at 50.00 m apart, a mirror at 30.00 m, a
            # quarter-turn at 35.36 m, a 5° lean at 1.31 m.
            #
            # And this step is MARKER-GUARDED. A map waved through here as
            # `maps_already_correct` has PHOTO_DIVORCE written for it and
            # never gets another turn, so the one-shot repair closed
            # permanently on exactly the placements that were most wrong.
            # `placements_agree` compares where the two put the map's corners,
            # in metres, which every degree of freedom moves.
            if t and fabric_truth.placements_agree(t, stack_t):
                stats["maps_already_correct"] += 1
                continue
            # ...but NEVER over a measured record. `reference_measurements` is
            # a distance the owner physically walked; a stack is a drag. Step
            # 13 already refuses to overwrite one - design row 1, the rule
            # that keeps issue #62 shut - and this step running FIRST must not
            # quietly undo that by reconciling the record onto the stack
            # before step 13 is ever asked. Same question, same field, same
            # answer, in both places.
            #
            # Reachable with no exotic history at all: Reset on the Stack tab
            # writes x_offset=0, y_offset=0, scale=1, rotation=0, which is a
            # legacy stack by every test in this file, and taking that over a
            # measured record moved a map 82.803 m - silently, permanently,
            # and on any install that never ran the photo-divorce release.
            if t and t.get("reference_measurements"):
                stats["measured_records_kept"] += 1
                continue
            # THE STACK, UNCONDITIONALLY, and it is not a disagreement with
            # step 13 — it is what makes step 13's job small. This step runs
            # first, on data where the stack is still what the renderer drew,
            # and its whole purpose is to move a record onto the picture the
            # owner has been looking at. Step 13 runs after it, on records
            # this step has already reconciled, and only has to choose
            # between them where this step could not reach: a map somebody
            # dragged after this step's marker was set, or a store that
            # carries the marker from an earlier release.
            #
            # What step 13 does NOT do any more is read
            # `legacy_record_iso_error` as a trim. It is not a trim signature:
            # a record derived from `px_per_meter` and a stack dragged with a
            # `scale_x_adj` differ in aspect for a reason that has nothing to
            # do with a crop — measured on a 400-map legacy store, 349 of
            # them, and on the conversion's own wide fixture 20 of 20. Where
            # it has to choose, it asks whether the record is MEASURED, which
            # is the reviewed rule and the one that keeps rjbutler's #62
            # store intact.
            # WHOLE record, σ included, and deliberately not the policy step
            # 9 applies. The two are different operations on the same field:
            # this one REPLACES a placement that provably disagrees with the
            # stack, so its output has to be internally consistent with what
            # the renderer draws — and on a degraded anchor the world→metre
            # map really is non-conformal, so the lean really is part of where
            # the map is drawn (on a 3×-degraded anchor a 30° decomposed
            # placement lands 6e-05 m from the renderer with σ and 0.47 m
            # from it without — see test_placement_shear.py). Dropping
            # σ here would store five of the six fields, which is the exact
            # record R1 exists to stop shipping. Step 9 EDITS one field of a
            # record that is otherwise trusted and re-derives nothing, so it
            # may only take σ from evidence the map itself holds. The rule
            # both obey: σ is written whole-record, or from the map's own
            # matrix, never inferred from the anchor onto a record in place.
            new_t = dict(stack_t)
            new_t["floor_id"] = str(m.get("floor_id", DEFAULT_FLOOR_ID))
            if t and t.get("reference_measurements"):
                new_t["reference_measurements"] = t["reference_measurements"]
            await mdl.async_set_map_transform(mid, new_t, reanchor=True)
            stats["maps_repaired"].append(m.get("name", mid))

    # 2. The photo's last job: convert its pins through the corrected
    #    placement, for entries that have never been touched in metres.
    if anchor and PHOTO_DIVORCE in todo:
        stats["positions_rederived"] = await _rederive_once(mdl, fab, maps_list)

    # 3. Calibration points recorded on a photo but never given metres get
    #    them now, through the repaired placements. A point's metres are where
    #    a person physically stood; after this they are the stored truth and
    #    the photo coordinates are only used to draw the dot.
    if cal is not None and anchor and PHOTO_DIVORCE in todo:
        try:
            stats["cal_points_anchored"] = await cal.async_backfill_metres()
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Calibration backfill during migration failed: %s", err)

    # 4. Light placements lived per-photo, in that photo's fraction space.
    #    Convert them to metres once; from here a light is placed in the
    #    house like everything else.
    if anchor and LIGHTS_TO_METRES in todo:
        ran.add(LIGHTS_TO_METRES)
        stats["lights_converted"] = await _convert_lights(mdl, fab, maps_list)

    # 5. Drop the keys that only existed to mark things re-derivable. Inside
    #    the anchor gate with steps 1-3, not beside it: `origin: "map"` is
    #    what step 2 reads to know which positions it may still convert, so
    #    stripping it on a run that could not convert anything would destroy
    #    the input the retry needs.
    if anchor and PHOTO_DIVORCE in todo:
        stats["legacy_keys_stripped"] = _strip_legacy_keys(fab)

    # 6. Calibration points saved before floors were resolved at save time
    #    have none, and count for no storey. Room's floor from the fabric,
    #    else the floor of the plan they were placed on. Needs no anchor.
    if cal is not None and CAL_POINT_FLOORS in todo:
        try:
            map_floor = {str(m.get("id")): str((m.get("stack") or {}).get("floor_id") or m.get("floor_id") or "")
                         for m in maps_list if m.get("id")}
            stats["cal_points_floored"] = await cal.async_backfill_floors(map_floor)
            ran.add(CAL_POINT_FLOORS)
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Calibration floor backfill during migration failed: %s", err)

    # 7. Every barrier gets an id; its photo link goes.
    if BARRIER_IDS in todo:
        ran.add(BARRIER_IDS)
        stats["barriers_identified"] = _identify_barriers(fab)

    # 8. Auto-calibration points that are one scanner's single reading go:
    #    not fingerprints, made by us, and they poisoned k-NN.
    if cal is not None and AUTOCAL_HYGIENE in todo:
        try:
            stats["autocal_pruned"] = await cal.async_prune_one_scanner_auto_points()
            ran.add(AUTOCAL_HYGIENE)
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Auto-calibration hygiene during migration failed: %s", err)

    # 9. Placements recorded before σ had a sign get it now, from the only
    #    thing that still holds it — the solved affine on the stack.
    if anchor and SHEAR_SIGN in todo:
        try:
            stats.update(await _backfill_shear_sign(mdl, maps_list, anchor))
            ran.add(SHEAR_SIGN)
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Shear sign backfill during migration failed: %s", err)

    # 10. Records that are not placements at all. Before A5 the transform
    #     writer stored the client's dict verbatim, so a payload carrying
    #     `scale_x_m: null` put a null on disk; every reader either raises on
    #     it or skips it, the gauge seed will not measure off it, and
    #     agreement called it aligned. A5 fixed the writer. Nothing repaired
    #     what it had already written, and a marker-guarded step 1 never gets
    #     another turn to.
    #
    #     NOT behind the anchor gate: whether a record can be READ is a
    #     question about the record, and an install whose only measured map is
    #     one of these has no anchor precisely BECAUSE of it.
    if UNREADABLE_PLACEMENTS in todo:
        try:
            stats.update(await _repair_unreadable_placements(mdl, maps_list, anchor))
            ran.add(UNREADABLE_PLACEMENTS)
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Unreadable placement repair during migration failed: %s", err)

    # 11. A map that was never measured still SITS somewhere. It has a stack —
    #     the owner dragged it into place — and with the gauge stored, that
    #     stack has a size in metres. So it gets a record like every other
    #     map: origin, both scales, ρ and σ, in gauge units.
    #
    #     PLACED and MEASURED are different facts and this is what separates
    #     them. `reference_measurements` keeps its job as the measured flag —
    #     nothing here writes one, so no map becomes measured, no map becomes
    #     eligible to seed the gauge, and the panel's "has a scale" badge is
    #     unchanged. What changes is that the map has a placement to be
    #     repaired, compared and (in R3) derived FROM, instead of a blank.
    #
    #     LAST, deliberately. Steps 2 and 3 convert pins and calibration
    #     points through `map_frac_to_metres`, which answers None for a map
    #     with no record; giving those maps a record earlier would silently
    #     change what those steps converted. Running here, this migration's
    #     other steps see exactly what they saw before.
    if anchor and UNMEASURED_PLACEMENTS in todo:
        try:
            stats["unmeasured_placed"] = await _place_unmeasured_maps(mdl, maps_list, anchor)
            ran.add(UNMEASURED_PLACEMENTS)
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Unmeasured map placement during migration failed: %s", err)

    # 12. Tie-ins are placement, in stack units. Re-expressed in metres before
    #     the conversion below deletes the frame they were written in.
    if anchor and TIE_INS_TO_METRES in todo and ms is not None:
        try:
            stats.update(await _tie_ins_to_metres(mdl, ms, maps_list, anchor))
            ran.add(TIE_INS_TO_METRES)
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Tie-in conversion during migration failed: %s", err)

    # 13. THE CONVERSION. A map's placement stops being stored twice.
    #
    #     LAST, and gated on three things it will not proceed without: a world
    #     gauge (a stack's numbers only become metres when multiplied by it, so
    #     without one there is nothing to convert TO), a maps store to write
    #     through, and a safety snapshot. Every other step in this file repairs
    #     data that is still on disk afterwards; this one deletes its input.
    if anchor and DERIVED_PLACEMENT in todo and ms is not None:
        # The snapshot was taken before step 1 — see there for why.
        if _bk is None:
            _LOGGER.warning(
                "Map placements were NOT converted: the automatic snapshot could not "
                "be taken, and this conversion deletes what it reads. It will be "
                "retried on the next restart.")
        else:
            ran.add(DERIVED_PLACEMENT)
            stats["conversion"] = await _derive_world_placement(
                mdl, ms, fab, maps_list, anchor)
            _c = stats["conversion"]
            _LOGGER.info(
                "World placement conversion: %d map(s) converted — %d kept their "
                "record, %d took their stack alignment, %d already agreed, %d left "
                "unplaced. Worst fidelity %.6f m (bar %.2f m). Maps that moved: %s. "
                "Snapshot %s.",
                _c["converted"], _c["record_won"], _c["stack_won"], _c["agreed"],
                _c["unplaced"], _c["worst_fidelity_m"], CONVERSION_FIDELITY_M,
                ", ".join(f"{e['map']} {e['moved_m']} m ({e['winner']})"
                          for e in _c["moved"]) or "none", _bk)

    # A step that could not run has not run, so it stays on the todo list and
    # gets another turn next startup. Without a metre anchor there is no world
    # frame to measure a placement against, and an install measures its first
    # map some time after it installs the release.
    done |= ran
    fab.data[MARKER] = sorted(done)
    await fab.store.async_save(fab.data)
    _LOGGER.info(
        "Photo divorce migration: %d map placement(s) repaired (%s), %d already correct, "
        "%d position(s) re-derived one last time, %d calibration point(s) anchored, "
        "%d light(s) converted to metres, %d legacy key(s) stripped, "
        "%d calibration point(s) given a floor, %d placement(s) given a signed "
        "shear (%d of them beyond %.2f rad), %d left unsigned for want of a matrix, "
        "%d unreadable placement(s) recovered from the stack, %d stripped to "
        "unmeasured and %d left faulted, %d unmeasured map(s) given a placement "
        "in gauge units",
        len(stats["maps_repaired"]), ", ".join(stats["maps_repaired"]) or "none",
        stats["maps_already_correct"], stats["positions_rederived"],
        stats["cal_points_anchored"], stats["lights_converted"],
        stats["legacy_keys_stripped"], stats["cal_points_floored"],
        stats["shear_signed"], stats["shear_over_tol"], fabric_truth.RECORD_ISO_TOL,
        stats["shear_no_matrix"], stats["placements_recovered"],
        stats["placements_stripped"], stats["placements_left"],
        stats["unmeasured_placed"],
    )
    return stats


async def _tie_ins_to_metres(mdl: Any, ms: Any, maps_list: list[dict], gauge: dict) -> dict[str, int]:
    """Re-express every tie-in in metres. Runs BEFORE the conversion.

    A tie-in is a saved alignment constraint: "when I checked this map against
    that one, it sat HERE". It was stored as four stack fields — x_offset,
    y_offset, scale, rotation — which is a placement in the units the stack
    used, so it is one of the copies R3 deletes. Left alone it would be the
    only surviving description of a map's position in a coordinate system
    nothing reads any more, and `_checkAlignConflicts` would compare the
    owner's next align against numbers from a dead frame.

    The feature is NOT dropped. Each tie-in becomes the six-field placement
    those four fields described, measured the same way the conversion measures
    the stack itself: build the legacy stack the tie-in recorded — the map's
    own frame, with the tie-in's four fields substituted — and ask
    `legacy_stack_metre_transform` where that put the map. Same arithmetic,
    same gauge, so a tie-in and the alignment it was taken from convert to the
    same metres.

    `_m` is deliberately NOT carried into the synthetic stack. A tie-in
    records the DECOMPOSED fields and nothing else, and the panel compared
    only those, so reading a solved matrix here would convert a tie-in through
    a placement it never described.
    """
    out = {"tie_ins_converted": 0, "tie_ins_dropped": 0}
    touched = False
    for m in maps_list:
        mid = m.get("id", "")
        ties = (m.get("stack") or {}).get("tie_ins")
        if not mid or not isinstance(ties, list) or not ties:
            continue
        base = dict(m.get("stack") or {})
        base.pop("_m", None)
        base.pop("_m_ar", None)
        new_ties = []
        for ti in ties:
            if not isinstance(ti, dict):
                continue
            if "origin_x_m" in ti:
                new_ties.append(ti)          # already converted
                continue
            if not _has_a_legacy_stack(base):
                # The map's own frame is gone — the conversion took it — so
                # the four fields this tie-in recorded cannot be read back
                # into metres by anybody, ever. The legacy reader would answer
                # the identity and the tie-in would come out claiming the map
                # sits at the world origin at unit size, which is a number the
                # panel would then compare the owner's next align against.
                # Dropped, and counted as dropped, which is what that counter
                # is for.
                out["tie_ins_dropped"] += 1
                continue
            synth = dict(base)
            synth["x_offset"] = float(ti.get("x_offset") or 0.0)
            synth["y_offset"] = float(ti.get("y_offset") or 0.0)
            synth["scale"] = float(ti.get("scale") or 1.0)
            synth["rotation"] = float(ti.get("rotation") or 0.0)
            placed = fabric_truth.legacy_stack_metre_transform(
                {**m, "stack": synth}, gauge)
            if not placed:
                out["tie_ins_dropped"] += 1
                continue
            new_ties.append({
                "ref_map_id": ti.get("ref_map_id"),
                "date": ti.get("date"),
                **placed,
            })
            out["tie_ins_converted"] += 1
        # NOT `ms.async_update_map`. THE INVARIANT: nothing may write a map
        # through the maps store's writer before the conversion has converted
        # that map. That writer rebuilds `stack` from the POST-conversion
        # whitelist — z_level, ceiling_height_m, floor_id, ref_map_id,
        # tie_ins — so calling it here deleted `x_offset`, `y_offset`,
        # `scale`, `scale_x_adj`, `rotation` and `_m` from the very map dict
        # step 13 is about to read, one step later and in the same list
        # object. Step 13 then saw no stack, read the map as never hand
        # aligned, and left a hand-dragged map on whatever its stale record
        # said: measured at 17.021 m on a dragged map with a tie-in, silently,
        # on any install whose PHOTO_DIVORCE marker was already set by an
        # earlier release. The step is a repair of one residue field, so it
        # writes that field and saves, the way every other step in this file
        # edits a store's dict in place.
        m["stack"]["tie_ins"] = new_ties
        touched = True
    if touched:
        await ms.store.async_save(ms.data)
    return out


# The fields the CONVERSION deletes. A stack that carries none of them is not
# a placement that happens to be at the origin — it is a stack that no longer
# exists, because step 13 stripped it down to the residue (z_level,
# ceiling_height_m, floor_id, ref_map_id, tie_ins) or because the map was made
# after the conversion and never had one.
#
# THE INVARIANT: no step may derive a placement from a legacy stack without
# first asking whether the map still HAS one. `legacy_stack_world_xform` reads
# an absent stack as the IDENTITY — the map at the world origin, one world
# unit across — by design, so a step that skips this question does not fail on
# a converted map, it silently relocates it. Measured on a converted six-map
# floor: every map to (0, 0) at rotation 0, worst 26.201 m and mean 18.204 m,
# and no fault raised afterwards, because a record at the origin is perfectly
# readable. Reachable whenever the conversion's own marker is not there to say
# the map is already done — a run that dies between the conversion and the
# marker save, or a fabric restored from a snapshot taken before it.
_LEGACY_STACK_FIELDS = ("x_offset", "y_offset", "scale", "scale_x_adj",
                        "rotation", "ref_ar", "_m", "_m_ar", "is_master")


def _has_a_legacy_stack(stk: Any) -> bool:
    """Does this map still carry the world-unit placement the conversion eats?"""
    return isinstance(stk, dict) and any(k in stk for k in _LEGACY_STACK_FIELDS)


# How far from the identity a stack has to be before it counts as somebody's
# alignment. It is the panel's own "pristine" test (`_isMasterEligible`), which
# decided the same question for a different reason: a map carrying offsets, a
# rotation or a stretch has been PLACED against something, and one that carries
# none of them has not been touched.
#
# THIS IS THE PRECONDITION OF THE DECISION RULE, not a guard on it. "The stack
# is the owner's most recent intent" is true because a Stack-tab drag is a
# stack-only write by design — and a stack nobody dragged carries no intent at
# all. Without this the conversion reads the DEFAULT stack of every map that
# was measured and never dragged as a hand alignment putting it at the world
# origin at unit size, and moves it there: on the fixture in
# test_unreadable_placement a healthy record at (1, 2) m turned 0.3 rad went to
# (0, 0) unturned. Every legacy master map has exactly this stack by
# definition, so it would have been every install's main floor plan.
_ALIGNED_OFFSET = 0.05      # world units, either axis
_ALIGNED_SCALE = 0.05       # fraction, `scale` or `scale_x_adj`
_ALIGNED_ROTATION = 2.0     # degrees


def _stack_is_a_hand_alignment(stk: dict) -> bool:
    """Has anybody actually placed this map with the alignment editor?"""
    _m = stk.get("_m")
    if isinstance(_m, (list, tuple)) and len(_m) == 4:
        return True             # a solved Point Align is nothing but intent
    try:
        return (abs(float(stk.get("x_offset") or 0.0)) > _ALIGNED_OFFSET
                or abs(float(stk.get("y_offset") or 0.0)) > _ALIGNED_OFFSET
                or abs(float(stk.get("scale") or 1.0) - 1.0) > _ALIGNED_SCALE
                or abs(float(stk.get("scale_x_adj") or 1.0) - 1.0) > _ALIGNED_SCALE
                or abs(float(stk.get("rotation") or 0.0)) > _ALIGNED_ROTATION)
    except (TypeError, ValueError):
        return False            # unreadable stack fields place nothing


# The conversion's own fidelity bar. It is not a tolerance on a disagreement —
# there is no disagreement left to tolerate — it is the distance between where
# the WINNING placement said the map was and where the store puts it
# afterwards. The only thing between the two is the record's rounding (0.1 mm
# on a length, 1 urad on an angle), which displaces the far corner of a 20 m
# map by about 1e-4 m. A centimetre is two orders of magnitude above that and
# nothing legitimate can reach it, so anything over is arithmetic that is
# wrong, not arithmetic that is imprecise.
CONVERSION_FIDELITY_M = 0.01


async def _derive_world_placement(
        mdl: Any, ms: Any, fab: Any, maps_list: list[dict], gauge: dict) -> dict[str, Any]:
    """THE ONE-WAY CONVERSION. A map's placement stops being stored twice.

    Before this, a map's placement lived in `model.map_transforms[id]` in
    metres AND in `maps[].stack` in world units, and every operation had to
    update both. The ones that did not are the trim, #62, #64 and #67. After
    this the stack is DERIVED from the record on read and the world copy is
    deleted, so there is nothing left to update twice.

    WHICH SIDE WINS is already decided by the code, not by a new judgement:

      * The two AGREE (`placements_agree`): the RECORD stands, untouched.
        There is nothing to preserve — they say the same thing — and writing
        anyway would move every map by the store's rounding for no reason.

      * They DISAGREE and the record is MEASURED (`reference_measurements`):
        the RECORD wins. A measurement is a distance the owner physically
        walked; an alignment is where they dragged a picture. That is the
        half issue #62 turns on — rjbutler's Main Floor was measured and the
        rigid solver's matrix was the broken half — and it is the rule the
        design was reviewed with.

      * They DISAGREE and the record is NOT measured: the STACK wins, IF
        anybody ever dragged it (see `_stack_is_a_hand_alignment`), and its
        metre form overwrites the record.
        `ws_maps.py` makes every Stack-tab drag and every applied Point Align
        a stack-only write BY DESIGN: the metre record is deliberately not
        touched, because the alignment was "cosmetic". So on an unmeasured
        map whose two halves differ, the stack is the owner's most recent
        intent and the record is the system's stale guess.

      * No stack numbers at all: the record stands (a map already converted,
        or one that was never placed by hand).

      * No record and no stack: nothing is written. The map is unplaced, which
        `map_geometry_faults` now says out loud.

    `reference_measurements` is carried through every branch. It is not a
    coordinate — it is what makes a map MEASURED — and a conversion that
    un-measured a map would take away the thing the owner physically did.

    THE RECEIPT. Two different numbers, and conflating them would hide the
    one that matters:

      `displacement_m` is FIDELITY — how far the stored result sits from the
      placement this function chose. It is bounded by the record's rounding
      and anything over `CONVERSION_FIDELITY_M` is a bug in here.

      `moved_m` is INTENT — how far the map moves on screen, i.e. between
      where the legacy stack drew it and where the derived stack draws it. It
      is large exactly on the maps that were broken, which is the repair
      happening, and it is reported per map so the owner can see which
      pictures moved and by how much rather than discovering it on the map.

    Per-map markers, not one flag for the step. A map skipped because it had
    no placement to convert gets another turn when it acquires one, and a map
    already converted is never converted twice — which matters because the
    second pass would read an empty stack and see a map at the world origin.
    """
    done = set(fab.data.get(DERIVED_PLACEMENT_MAPS) or [])
    out: dict[str, Any] = {
        "converted": 0, "record_won": 0, "stack_won": 0, "agreed": 0,
        "unplaced": 0, "worst_fidelity_m": 0.0, "moved": [],
    }
    for m in maps_list:
        mid = m.get("id", "")
        if not mid or mid in done:
            continue
        stk = m.get("stack") or {}
        t = mdl.map_transform(mid)
        readable = fabric_truth.placement_is_readable(t or {})
        stack_t = (fabric_truth.legacy_stack_metre_transform(m, gauge)
                   if _stack_is_a_hand_alignment(stk) else None)
        drawn_before = dict(stack_t) if stack_t else (dict(t) if readable else None)

        winner = None
        if stack_t and not readable:
            winner, why = stack_t, "stack_won"          # only source available
        elif stack_t and readable:
            if fabric_truth.placements_agree(t, stack_t):
                winner, why = None, "agreed"
            else:
                # MEASURED OR NOT. It is the reviewed rule, from the design
                # this conversion was specified from
                # (docs/i1-derive-world-placement-design.md): a record with
                # `reference_measurements` is a distance the owner physically
                # walked and wrote down, so it outranks an alignment; a record
                # without one is the system's own guess at where the picture
                # goes, and a hand alignment beats a guess. It needs no new
                # judgement and it reads one field.
                #
                # WHAT WAS HERE was `legacy_record_iso_error` over
                # RECORD_ISO_TOL, read as "a trim and only a trim". It is not
                # a diagnosis — its own docstring says so, and under R3 it
                # keeps exactly one job, ranking the gauge seed — and it
                # cannot be one: it compares the record's aspect against the
                # footprint the STACK draws, so an X-stretch or a solved
                # Point Align in the stack fires it exactly as hard as a crop
                # in the record. Measured on the wide fixture it took the
                # RECORD on every one of the 20 disagreeing maps of one
                # seed and 18 of 20 on another, every solved affine and every
                # unmeasured drag among them, at up to 94.584 m;
                # step 1 had already measured 349 of 400 legacy maps firing
                # it for reasons that have nothing to do with a crop. The
                # defence written here was that step 1 leaves every map
                # agreeing with its stack by the time this runs — step 1 is
                # marker-guarded, so on any install that upgraded through an
                # earlier release it never ran, and an applied Point Align on
                # an unmeasured picture, which is the tool's whole purpose,
                # lost to the record `ws_maps` deliberately did not write.
                #
                # It still keeps rjbutler's #62 store intact, and for the
                # reason that store actually turns on: his Main Floor record
                # is MEASURED and the rigid solver's matrix is the broken
                # half. That is this branch's other direction, not a second
                # rule.
                if (t or {}).get("reference_measurements"):
                    winner, why = None, "record_won"    # measured: a fact, not a guess
                else:
                    winner, why = stack_t, "stack_won"  # a drag: the record is stale
        elif readable:
            winner, why = None, "record_won"
        else:
            winner, why = None, "unplaced"

        if winner is not None:
            new_t = dict(winner)
            new_t["floor_id"] = str(m.get("floor_id", DEFAULT_FLOOR_ID))
            if (t or {}).get("reference_measurements"):
                new_t["reference_measurements"] = t["reference_measurements"]
            await mdl.async_set_map_transform(mid, new_t, reanchor=True)

        # Strip the world copy. EVERY map, including the ones nothing was
        # written for — leaving the numbers on a map that agreed would leave
        # a second copy that can go on to disagree, which is the whole thing
        # this deletes.
        await ms.async_update_map(mid, stack={
            k: v for k, v in stk.items()
            if k in ("z_level", "ceiling_height_m", "ref_map_id", "tie_ins", "floor_id")
        })

        stored = mdl.map_transform(mid) or {}
        if winner is not None:
            fid = fabric_truth.placement_disagreement_m(winner, stored)
            if fid is not None:
                out["worst_fidelity_m"] = max(out["worst_fidelity_m"], fid)
                if fid > CONVERSION_FIDELITY_M:
                    _LOGGER.error(
                        "Placement conversion for map %s landed %.4f m from the "
                        "placement it chose — over the %.2f m fidelity bar. This is "
                        "a bug in the conversion, please report it.",
                        mid, fid, CONVERSION_FIDELITY_M)
        moved = (fabric_truth.placement_disagreement_m(drawn_before, stored)
                 if drawn_before and fabric_truth.placement_is_readable(stored) else None)
        if moved is not None and moved > CONVERSION_FIDELITY_M:
            out["moved"].append({"map": m.get("name", mid), "moved_m": round(moved, 3),
                                 "winner": why})
        out[why] = out.get(why, 0) + 1
        out["converted"] += 1
        done.add(mid)
        # DURABLE AS IT GOES, per map, immediately after that map's record and
        # stack are both written. A per-map marker exists to survive a run
        # that does not finish; one held in `fab.data` until the end of
        # `async_run_photo_divorce` survives nothing, because the fabric is
        # saved once, there, and the caller in __init__.py swallows the
        # exception that skips it. The next boot then re-converted maps that
        # had already been converted, reading the stack this loop had just
        # emptied — 8.268 m on a four-map store, in the direction of the
        # world origin, and 26.201 m on the six-map floor above.
        # A save per map is the price of the guarantee, on a one-shot
        # conversion that already writes both other stores per map.
        fab.data[DERIVED_PLACEMENT_MAPS] = sorted(done)
        await fab.store.async_save(fab.data)

    out["worst_fidelity_m"] = round(out["worst_fidelity_m"], 6)
    return out


async def _place_unmeasured_maps(mdl: Any, maps_list: list[dict], gauge: dict) -> int:
    """Give every map with no readable placement one, in gauge units.

    The map's own stack, through the stored gauge, IS a placement in metres —
    that is what a gauge is for. Writing it down turns "this map has no
    record" into "this map has a record nobody has measured", which is the
    distinction `reference_measurements` exists to carry and the state R3
    derives a stack from.

    Nothing here writes `reference_measurements`, so no map becomes MEASURED
    and none becomes eligible to seed the gauge. `_put_map_transform` carries
    the stored one forward if there is one, under its own rule.

    Skipped for a map whose record is already readable: this places maps that
    have no placement, it does not re-place maps that have one. A map whose
    record is corrupt is step 10's, not this one's — that step runs first and
    either recovers the record or strips it to unmeasured, and a stripped
    record arrives here with no scales and gets placed.
    """
    from . import fabric_truth

    n = 0
    for m in maps_list:
        mid = m.get("id", "")
        if not mid:
            continue
        t = mdl.map_transform(mid) or {}
        if fabric_truth.placement_is_readable(t):
            continue
        # The same question step 1 asks, for the same reason: a map the
        # conversion has already emptied has no stack to be placed from, and
        # the legacy reader would answer the identity — which would turn the
        # honest `unplaced` a converted map is left with into a silent
        # placement at the world origin, one world unit across.
        if not _has_a_legacy_stack(m.get("stack")):
            continue
        st = fabric_truth.legacy_stack_metre_transform(m, gauge)
        if not st:
            continue          # no stack: nothing to place it from
        new_t = dict(st)
        new_t["floor_id"] = str(m.get("floor_id", DEFAULT_FLOOR_ID))
        await mdl.async_set_map_transform(mid, new_t, reanchor=True)
        n += 1
    return n


def _has_usable_scale(t: dict) -> bool:
    """Would the writer keep either of this record's scales?

    Finite and strictly positive is `async_set_map_transform`'s rule for a
    scale it can use, and a scale it can use survives a write back — including
    the fallback to the STORED value, which is the same rule read from the
    other side. Asked BEFORE the write, because afterwards the write has
    already happened.
    """
    for _k in ("scale_x_m", "scale_y_m"):
        try:
            _v = float(t.get(_k))
        except (TypeError, ValueError):
            continue
        if math.isfinite(_v) and _v > 0:
            return True
    return False


async def _repair_unreadable_placements(
        mdl: Any, maps_list: list[dict], anchor: dict | None) -> dict[str, int]:
    """Records that claim a placement they cannot deliver.

    A record with NEITHER scale states that it has no scale — that is what an
    unmeasured map looks like, every reader handles it, and it is left alone.
    A record that names a scale which is a null, a string or a zero, or a null
    origin beside two good scales, is the other thing: it is on disk claiming
    to place the map and it places nothing.

    Two outcomes, and which one a map gets is not a preference. A map whose
    stack can be measured against a metre anchor HAS a placement — it is where
    the renderer has been drawing it all along — and that is recovered whole,
    the same operation step 1 performs, for the same reason and with the same
    care over σ and `reference_measurements`. A map with no anchor to measure
    its stack against has nothing to recover FROM, so the record goes back
    through the one writer, which drops a scale it cannot use. The map then
    reads as unmeasured, which is what it is, and `map_geometry_faults` says
    so out loud until somebody measures it — that is the honest outcome, not
    a failed one.

    THE INVARIANT IS THE ONE ABOVE: a stored placement either places the map
    or says nothing. The writer can only deliver "says nothing" when NEITHER
    scale is usable, because an unusable value falls back to the stored one —
    so a third outcome exists and it is not a repair. `scale_x_m: null` beside
    a good `scale_y_m` came back out still naming half a placement, and
    `origin_x_m: null` beside two good scales came back out sanitised to the
    world origin: silently placed, fault cleared, where it had been a loud
    absence. Neither is honest, and neither is counted as one. Those records
    are left exactly as they are, still faulted, still loud.
    """
    from . import fabric_truth

    out = {"placements_recovered": 0, "placements_stripped": 0,
           "placements_left": 0}
    for m in maps_list:
        mid = m.get("id", "")
        t = mdl.map_transform(mid) if mid else None
        if not t or fabric_truth.placement_is_readable(t):
            continue
        if "scale_x_m" not in t and "scale_y_m" not in t:
            continue
        # And again: recovering a placement from a stack the conversion has
        # already deleted recovers the world origin. Without a legacy stack
        # this map takes the other outcome below — back through the one
        # writer, read as unmeasured, and reported as a fault until somebody
        # measures it — which is the honest one.
        st = (fabric_truth.legacy_stack_metre_transform(m, anchor)
              if anchor and _has_a_legacy_stack(m.get("stack")) else None)
        if st:
            new_t = dict(st)
            new_t["floor_id"] = str(m.get("floor_id", DEFAULT_FLOOR_ID))
            if t.get("reference_measurements"):
                new_t["reference_measurements"] = t["reference_measurements"]
            await mdl.async_set_map_transform(mid, new_t, reanchor=True)
            out["placements_recovered"] += 1
        elif _has_usable_scale(t):
            out["placements_left"] += 1
        else:
            # `dict(t)` back through the writer, not a hand-built record: the
            # rule for an unusable scale lives there, and a second copy of it
            # here is the second-writer defect this codebase keeps paying for.
            await mdl.async_set_map_transform(mid, dict(t))
            out["placements_stripped"] += 1
    return out


async def _backfill_shear_sign(mdl: Any, maps_list: list[dict], anchor: dict) -> dict[str, int]:
    """Give every placement that has a lean the σ that says WHICH WAY it leans.

    `shear_rad` has been reaching disk for releases already — step 1 above
    copies the whole of `legacy_stack_metre_transform`'s output into the record —
    but it was written through an `abs()`, so a map skewed +5° and a map
    skewed -5° both recorded +0.087266 and the record could not say which.
    Nothing read the field, so nothing noticed; now that the frac↔metre
    conversions honour it, an unsigned value would skew half the maps that
    have one the wrong way. This recovers the sign once.

    ONLY from the solved affine `_m` — which is not the policy step 1 applies
    to the same quantity, because they are not the same operation; see the
    note there. A decomposed stack has square axes by
    construction, so the lean `legacy_stack_metre_transform` reports for one is the
    ANCHOR's anisotropy showing through a rotation, not the map's placement —
    writing that into the record would bake a degraded anchor's error into
    the map permanently, and it would come back as a "fault" the moment the
    anchor was re-measured. A map whose matrix has since been nulled — any
    click on ±15°, Scale ±, X-stretch or Reset does that, and the map keeps
    no record that it once had one — has no sign left to recover. Those are
    counted, not guessed at: they stay absent and read as 0, exactly as they
    did before this ran.

    Write-only-if-absent, plus the one case that is not a write but a repair:
    a stored value whose MAGNITUDE matches the matrix while its sign does not
    is provably this codebase's own `abs()` output, because no other producer
    of the field has ever existed. Completing that is not overwriting
    somebody's number.
    """
    from . import fabric_truth

    out = {"shear_signed": 0, "shear_no_matrix": 0, "shear_over_tol": 0}
    for m in maps_list:
        mid = m.get("id", "")
        t = mdl.map_transform(mid)
        if not mid or not t:
            continue
        _m = (m.get("stack") or {}).get("_m")
        if not (isinstance(_m, (list, tuple)) and len(_m) == 4):
            # No matrix, so no sign to read. Only a map that HAS a recorded
            # lean is a loss: one with neither a matrix nor a stored shear is
            # not sheared at all, and counting it would report every ordinary
            # map on the floor as damage.
            if t.get("shear_rad"):
                out["shear_no_matrix"] += 1
            continue
        st = fabric_truth.legacy_stack_metre_transform(m, anchor)
        if not st:
            continue
        sigma = float(st["shear_rad"])
        stored = t.get("shear_rad")
        if stored is not None:
            try:
                stored = float(stored)
            except (TypeError, ValueError):
                stored = None
        if stored is not None and abs(stored - sigma) > 1e-6:
            if abs(stored - abs(sigma)) > 1e-6:
                continue        # not our abs() output — leave it alone
        elif stored is not None:
            continue            # already signed and already right
        new_t = dict(t)
        new_t["shear_rad"] = sigma
        await mdl.async_set_map_transform(mid, new_t)
        out["shear_signed"] += 1
        # RECORD_ISO_TOL, which was also `REBUILD_SHEAR_TOL` — the same
        # number under two names, one measuring a lean and one an axis-scale
        # disagreement, both being "the point at which this codebase stops
        # calling a map's geometry self-consistent". The rebuild it named is
        # deleted, so the alias is too; the counter is unchanged.
        if abs(sigma) > fabric_truth.RECORD_ISO_TOL:
            out["shear_over_tol"] += 1
    return out


async def _rederive_once(mdl: Any, fab: Any, maps_list: list[dict]) -> int:
    """Final frac -> metre conversion, for map-origin entries only.

    An entry a person has already placed in metres carries no origin marker
    and is never touched. This is the only place in the codebase that still
    reads photo coordinates into the fabric, and it runs once.
    """
    scanners = fab.scanner_positions_m()
    beacons = fab.beacon_positions_m()
    set_scanners: dict[str, dict] = {}
    set_beacons: dict[str, dict] = {}
    count = 0

    for m in maps_list:
        mid = m.get("id", "")
        if not mdl.map_transform(mid):
            continue
        fl = str(m.get("floor_id", DEFAULT_FLOOR_ID))
        for rx in (m.get("receivers") or []):
            src = rx.get("source") or rx.get("id", "")
            cur = scanners.get(src)
            if not src or not isinstance(cur, dict):
                continue
            if cur.get("origin") != "map":      # placed by hand — leave it
                continue
            coords = mdl.map_frac_to_metres(float(rx.get("x", 0)), float(rx.get("y", 0)), mid)
            if not coords:
                continue
            entry = {k: v for k, v in cur.items() if k not in ("origin", "z_origin", "map_id")}
            entry["x_m"], entry["y_m"] = round(coords[0], 3), round(coords[1], 3)
            entry["floor_id"] = fl
            set_scanners[src] = entry
            count += 1
        for bk in (m.get("beacons") or []):
            key = bk.get("key")
            cur = beacons.get(key)
            if not key or not isinstance(cur, dict):
                continue
            if cur.get("origin") != "map":
                continue
            coords = mdl.map_frac_to_metres(float(bk.get("x", 0)), float(bk.get("y", 0)), mid)
            if not coords:
                continue
            entry = {k: v for k, v in cur.items() if k not in ("origin", "map_id")}
            entry["x_m"], entry["y_m"] = round(coords[0], 3), round(coords[1], 3)
            entry["floor_id"] = fl
            set_beacons[key] = entry
            count += 1

    if set_scanners or set_beacons:
        await fab.async_spatial_update(
            set_scanners=set_scanners or None,
            set_beacons=set_beacons or None,
            op="migration:photo_divorce",
        )
    return count


async def _convert_lights(mdl: Any, fab: Any, maps_list: list[dict]) -> int:
    """Move per-photo light placements into the fabric, in metres.

    A light's x/y used the same fraction convention as room bounds, so the
    map's own transform converts it. A light already placed in metres wins.
    """
    existing = fab.light_positions_m()
    set_lights: dict[str, dict] = {}
    for m in maps_list:
        mid = m.get("id", "")
        if not mdl.map_transform(mid):
            continue
        fl = str(m.get("floor_id", DEFAULT_FLOOR_ID))
        for lt in (m.get("lights") or []):
            eid = str(lt.get("entity_id") or "")
            if not eid or eid in existing or eid in set_lights:
                continue
            coords = mdl.map_frac_to_metres(float(lt.get("x") or 0.0), float(lt.get("y") or 0.0), mid)
            if not coords:
                continue
            entry = {"x_m": round(coords[0], 3), "y_m": round(coords[1], 3), "floor_id": fl}
            for src, dst in (("color", "color"), ("shape", "shape"), ("label", "label")):
                if lt.get(src):
                    entry[dst] = lt[src]
            for k in ("rotation", "width_cm", "height_cm"):
                if lt.get(k):
                    entry[k] = float(lt[k])
            set_lights[eid] = entry
    if set_lights:
        await fab.async_spatial_update(set_lights=set_lights, op="migration:lights_to_metres")
    return len(set_lights)
