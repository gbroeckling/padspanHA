# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The conversion handling its own state.

R3's arithmetic was verified elsewhere: `test_derived_world_placement.py`
proves the placement it stores is the placement it chose, and that the four
historical bugs cannot be written. This file is about the other half — the
bookkeeping the one-way conversion does around that arithmetic, where every
defect is silent and none of it shows up as a wrong number in a receipt:

  * the snapshot it refuses to run without, and whether restoring it puts the
    install back;
  * which writer a step uses, and whether that writer deletes the input of the
    step after it;
  * whether a step that derives a placement from a LEGACY stack first asks
    whether the map still has one;
  * whether a per-map marker reaches disk while the run is still going;
  * which half wins when the record and the stack disagree.

Every case here is reachable on an ordinary upgrade and every one of them
moves maps in metres.
"""

from __future__ import annotations

import json
import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth, migrations
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DOMAIN,
    FABRIC_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY,
)
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.migrations import (
    DERIVED_PLACEMENT, DERIVED_PLACEMENT_MAPS, MARKER, PHOTO_DIVORCE,
    async_run_photo_divorce,
)
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import maps_store_with, migration_backup

_GAUGE = {"m_per_unit": 20.0, "source_map_id": "master"}
_SQUARE = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
           "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}
_IDENT = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
          "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
# What step 13 leaves behind: the residue, and not one placement field.
_CONVERTED_STACK = {"z_level": 0, "ceiling_height_m": 2.4}


def _map(mid: str, stack: dict, *, name: str | None = None) -> dict:
    return {"id": mid, "name": name or mid, "floor_id": "main",
            "created": "2020-01-01T00:00:00+00:00",
            "image": {"width": 1600, "height": 1200},
            "stack": {"z_level": 0, "ceiling_height_m": 2.4, **stack},
            "room_bounds": {}, "receivers": [], "beacons": [],
            "calibration": {"mode": "none"}}


def _mdl(transforms: dict) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.store.async_save = AsyncMock()
    s.data = {"map_transforms": transforms, "world_gauge": dict(_GAUGE)}
    s.fabric = None
    return s


def _fab(marker: list[str] | None = None, data: dict | None = None) -> FabricStore:
    f = FabricStore.__new__(FabricStore)
    f.hass = MagicMock()
    f.store = AsyncMock()
    f.store.async_save = AsyncMock()
    f.data = data if data is not None else {
        "floors": {}, "history": [], "scanner_positions_m": {},
        "beacon_positions_m": {}, "rf_barriers_m": []}
    if marker:
        f.data[MARKER] = list(marker)
    return f


def _gap(a: dict | None, b: dict | None) -> float:
    """Corner displacement in metres, or 0.0 when there is nothing to compare."""
    g = fabric_truth.placement_disagreement_m(a, b)
    return 0.0 if g is None else g


# ═══ D1. The snapshot covers the stores the conversion writes ═══════════════
#
# The conversion is the one irreversible thing in this file, so it refuses to
# run without a snapshot. The snapshot therefore has to be worth reaching for.


class _JsonStore:
    """`homeassistant.helpers.storage.Store`, including WHEN it serialises.

    The real Store writes the JSON inside `async_save`, so a snapshot that
    holds a live reference to a store's `data` is nevertheless frozen on disk
    at the moment it is taken. Modelling that matters here: a fake that keeps
    the reference would make a round-trip test pass by aliasing.
    """

    files: dict[str, str] = {}

    def __init__(self, hass, version, key):
        self._key = key

    async def async_load(self):
        raw = _JsonStore.files.get(self._key)
        return json.loads(raw) if raw is not None else None

    async def async_save(self, data):
        _JsonStore.files[self._key] = json.dumps(data)

    async def async_remove(self):
        _JsonStore.files.pop(self._key, None)


def _populated_fabric() -> dict:
    """A house: two storeys, four scanners, beacons, walls and a history."""
    return {
        "floors": {
            "main": {"rooms": {"Kitchen": {"type": "poly",
                                           "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]]}},
                     "committed": True},
            "upper": {"rooms": {"Bedroom": {"type": "poly",
                                            "points_m": [[0, 0], [3, 0], [3, 3], [0, 3]]}},
                      "committed": True},
        },
        "scanner_positions_m": {
            f"rx{i}": {"x_m": 1.0 + i, "y_m": 2.0 + i, "z_m": 2.4, "floor_id": "main"}
            for i in range(4)
        },
        "beacon_positions_m": {
            "bk1": {"x_m": 3.5, "y_m": 1.5, "floor_id": "main"}},
        "rf_barriers_m": [
            {"id": "bar_1", "x1_m": 0.0, "y1_m": 0.0, "x2_m": 4.0, "y2_m": 0.0,
             "attenuation_db": 6.0}],
        "light_positions_m": {
            "light.kitchen": {"x_m": 2.0, "y_m": 1.5, "floor_id": "main"}},
        "history": [{"op": f"op{i}", "at": "2026-01-01T00:00:00+00:00"}
                    for i in range(40)],
    }


@pytest.mark.asyncio
async def test_the_conversions_own_snapshot_restores_the_house(monkeypatch) -> None:
    """Take the snapshot the conversion takes, restore it, get the house back.

    THE COST OF GETTING THIS WRONG is not "the fabric is missing from the
    file". `ws_store_backup_restore` reads a snapshot with no fabric entry as
    one taken BEFORE the fabric store existed and CLEARS the fabric, so that
    the next boot can rebuild it from legacy geometry. There is no legacy
    geometry to rebuild it from after R3. So the one artefact an owner reaches
    for when the irreversible conversion has gone wrong was the thing that
    emptied their house — silently, under a log line announcing a pre-fabric
    restore.

    Round-tripped through a store that serialises when the real one does, so
    nothing here passes by holding a reference to the dict it is checking.
    """
    import homeassistant.helpers.storage as _hs
    from custom_components.padspan_ha.ws_backup import (
        _auto_backup, ws_store_backup_restore,
    )

    _JsonStore.files = {}
    monkeypatch.setattr(_hs, "Store", _JsonStore)

    maps = [_map("master", _IDENT), _map("annex", {"x_offset": 0.4, "y_offset": -0.2,
                                                   "scale": 0.8, "scale_x_adj": 1.0,
                                                   "rotation": 15.0, "ref_ar": 0.75})]
    mdl = _mdl({"master": {**_SQUARE, "reference_measurements": [{"m": 1}]}})
    ms = maps_store_with(maps)
    fab = _fab(data=_populated_fabric())
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: ms, DATA_FABRIC: fab}}

    # The fabric exactly as it stood when the snapshot was taken — captured in
    # the same call, so this is what "put it back" has to mean.
    at_snapshot: dict = {}

    async def _backup(_hass, note, keys):
        at_snapshot["keys"] = list(keys)
        at_snapshot["fabric"] = json.loads(json.dumps(fab.data))
        return await _auto_backup(_hass, note, keys)

    stats = await async_run_photo_divorce(hass, mdl, ms, fab, None, _backup)
    backup_id = stats["conversion_backup_id"]
    assert backup_id, "the conversion did not take its snapshot"
    assert FABRIC_STORE_KEY in at_snapshot["keys"], (
        "the conversion writes the fabric store — its own per-map markers live "
        "there — so its snapshot has to hold it")
    assert set(at_snapshot["keys"]) == {MAPS_STORE_KEY, MODEL_STORE_KEY,
                                        FABRIC_STORE_KEY}

    # The conversion has now run and the world copy is gone.
    assert not (set(ms.data["maps"][1]["stack"]) & {"x_offset", "scale", "rotation"})

    # The owner restores it, the way the Backup/Restore dialog does.
    conn = MagicMock()
    await ws_store_backup_restore(hass, conn, {"id": 1, "backup_id": backup_id})
    conn.send_error.assert_not_called()

    got = fab.data
    assert len(got.get("scanner_positions_m") or {}) == 4, (
        f"the restore lost scanners: {sorted((got.get('scanner_positions_m') or {}))}")
    assert sorted(got.get("floors") or {}) == ["main", "upper"]
    assert len(got.get("history") or []) == 40
    assert got.get("rf_barriers_m"), "the walls are gone"
    assert got.get("beacon_positions_m") and got.get("light_positions_m")
    assert got == at_snapshot["fabric"], "the fabric came back different"

    # And on disk, not only in memory.
    on_disk = json.loads(_JsonStore.files[FABRIC_STORE_KEY])
    assert on_disk == at_snapshot["fabric"]


# ═══ D2. A step may not write through the writer that deletes its successor's
#         input ══════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_converting_the_tie_ins_does_not_delete_the_stack_under_step_13() -> None:
    """Step 12 runs one step before the conversion, over the same list object.

    `MapsStore.async_update_map` rebuilds `stack` from the POST-conversion
    whitelist, so writing a tie-in through it strips `x_offset`, `scale`,
    `rotation` and `_m` off the very map dict step 13 is about to read. Step 13
    then sees a map nobody ever aligned and leaves it on whatever stale record
    it had.

    Reachable on any install whose PHOTO_DIVORCE marker was set by an earlier
    release — step 1 is not there to reconcile the two halves first — which is
    most of the install base.
    """
    aligned = {"x_offset": 0.55, "y_offset": -0.3, "scale": 1.2,
               "scale_x_adj": 1.0, "rotation": 24.0, "ref_ar": 0.75,
               "tie_ins": [{"ref_map_id": "master", "date": "2026-02-02",
                            "x_offset": 0.55, "y_offset": -0.3, "scale": 1.2,
                            "rotation": 24.0}]}
    maps = [_map("master", _IDENT), _map("annex", aligned)]
    mdl = _mdl({"master": {**_SQUARE, "reference_measurements": [{"m": 1}]},
                "annex": dict(_SQUARE)})
    ms = maps_store_with(maps)
    intent = fabric_truth.legacy_stack_metre_transform(maps[1], _GAUGE)
    stale = dict(mdl.map_transform("annex"))
    assert _gap(intent, stale) > 1.0, "the fixture has nothing to lose"

    # The install that has already been through an earlier release.
    fab = _fab([PHOTO_DIVORCE, "lights_to_metres", "cal_point_floors",
                "barrier_ids", "autocal_hygiene", "shear_sign",
                "unreadable_placements", "world_gauge_seed",
                "unmeasured_placements"])
    await async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, migration_backup)

    stored = mdl.map_transform("annex")
    assert _gap(intent, stored) < 0.01, (
        f"the owner's alignment was lost by {_gap(intent, stored):.3f} m — step 12 "
        f"deleted the stack before step 13 could read it")
    # And the tie-in still converted, and reached disk.
    tie = ms.data["maps"][1]["stack"]["tie_ins"][0]
    assert "origin_x_m" in tie and "x_offset" not in tie
    ms.store.async_save.assert_awaited()


# ═══ D3. No step may derive a placement from a stack that is not there ══════


def _converted_floor(n: int = 6):
    """A store the conversion has already finished with.

    Every stack is the residue and every placement is in the record — which is
    the steady state after R3, and the state any step that still reads a
    legacy stack has to survive meeting.
    """
    maps, transforms = [], {}
    for i in range(n):
        mid = f"m{i}"
        maps.append(_map(mid, dict(_CONVERTED_STACK)))
        transforms[mid] = {
            "origin_x_m": 4.0 * i - 10.0, "origin_y_m": 3.0 * i - 6.0,
            "scale_x_m": 18.0 + i, "scale_y_m": 13.5 + i,
            "rotation_rad": 0.3 + 0.1 * i, "shear_rad": 0.0,
            "floor_id": "main", "reference_measurements": [{"m": 1}],
        }
    return maps, transforms


@pytest.mark.asyncio
async def test_a_converted_map_is_not_re_placed_when_the_markers_are_gone() -> None:
    """The marker list is not the only thing standing between a converted map
    and the world origin.

    `legacy_stack_world_xform` reads an absent stack as the IDENTITY by design
    — one world unit across at the origin — so any step that derives a
    placement from a legacy stack without checking whether the map still HAS
    one does not fail on a converted map, it relocates it. Silently: a record
    at the origin is perfectly readable, so nothing is reported afterwards.

    Reachable two ways, neither of them exotic: a run that dies between the
    conversion and the fabric save, and a fabric restored from a snapshot
    taken before the conversion. Both leave a converted store with no marker.
    """
    maps, transforms = _converted_floor()
    mdl = _mdl(transforms)
    before = {mid: dict(t) for mid, t in transforms.items()}

    # No markers at all: every step gets a turn on an already-converted store.
    await async_run_photo_divorce(MagicMock(), mdl, maps_store_with(maps),
                                  _fab(), None, migration_backup)

    worst = max(_gap(before[m["id"]], mdl.map_transform(m["id"])) for m in maps)
    assert worst < 0.01, f"a converted map was moved {worst:.3f} m"
    for m in maps:
        t = mdl.map_transform(m["id"])
        assert t["rotation_rad"] == pytest.approx(before[m["id"]]["rotation_rad"]), (
            f"{m['id']} was un-turned")


@pytest.mark.asyncio
async def test_the_photo_hung_at_the_wrong_scale_is_still_repaired() -> None:
    """The other side of that gate, so it cannot be widened into uselessness.

    A never-measured photo was handed a fabricated 20 m width while its
    PRISTINE stack drew it 10 m wide. Repairing that is what this migration is
    FOR, and a pristine stack is a real answer here even though it carries no
    intent — which is why the gate asks whether the stack EXISTS and not
    whether anybody dragged it.
    """
    maps = [_map("master", {"is_master": True, "x_offset": 0, "y_offset": 0,
                            "scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75}),
            _map("bad", {"x_offset": 0, "y_offset": 0, "scale": 1.0,
                         "scale_x_adj": 1.0, "ref_ar": 0.75}, name="Outside")]
    mdl = _mdl({"master": {**_SQUARE, "scale_x_m": 10.0, "scale_y_m": 7.5,
                           "reference_measurements": [{"m": 1}]},
                "bad": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                        "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}})
    mdl.data["world_gauge"] = {"m_per_unit": 10.0, "source_map_id": "master"}

    stats = await async_run_photo_divorce(MagicMock(), mdl, maps_store_with(maps),
                                          _fab(), None, migration_backup)

    assert "Outside" in stats["maps_repaired"]
    assert mdl.map_transform("bad")["scale_x_m"] == pytest.approx(10.0, abs=1e-3)


# ═══ D4. A per-map marker that has not reached disk is not a marker ═════════


@pytest.mark.asyncio
async def test_the_per_map_marker_is_on_disk_before_the_run_ends() -> None:
    """A per-map marker exists to survive a run that does not finish.

    The fabric store holds BOTH `migrations_done` and the per-map
    `derived_placement_maps`, and `async_run_photo_divorce` saves it once, at
    the very end — after the conversion. `__init__.py` swallows the exception
    that skips that save, so a conversion that dies on map 3 left maps 1 and 2
    converted on disk with nothing on disk saying so, and the next boot read
    their emptied stacks all over again.
    """
    maps = [_map(f"m{i}", {"x_offset": 0.2 + 0.1 * i, "y_offset": -0.1,
                           "scale": 1.0 + 0.1 * i, "scale_x_adj": 1.0,
                           "rotation": 10.0 * i, "ref_ar": 0.75}) for i in range(4)]
    mdl = _mdl({})
    ms = maps_store_with(maps)

    saved: list[dict] = []
    fab = _fab()
    fab.store.async_save = AsyncMock(
        side_effect=lambda d: saved.append(json.loads(json.dumps(d))))

    # The run dies part-way through, the way any store write can.
    real_update = ms.async_update_map
    calls = {"n": 0}

    async def _boom(map_id, **kw):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("disk went away")
        return await real_update(map_id, **kw)

    ms.async_update_map = _boom
    with pytest.raises(RuntimeError):
        await migrations._derive_world_placement(mdl, ms, fab, maps, dict(_GAUGE))

    assert saved, "the fabric was never saved, so nothing survived the failure"
    marked = set(saved[-1].get(DERIVED_PLACEMENT_MAPS) or [])
    assert marked == {"m0", "m1"}, (
        f"on disk after the failure: {sorted(marked)} — the maps that were "
        f"actually converted are m0 and m1")
    # And the marker is written AFTER the map's own two writes, never before:
    # m2 died inside its own write and must not be claimed.
    assert "m2" not in marked


@pytest.mark.asyncio
async def test_a_map_already_marked_is_not_converted_again() -> None:
    """The marker's whole job, honoured from what is on disk."""
    maps = [_map("m0", {"x_offset": 0.3, "y_offset": 0.0, "scale": 1.0,
                        "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75})]
    mdl = _mdl({})
    fab = _fab()
    fab.data[DERIVED_PLACEMENT_MAPS] = ["m0"]

    out = await migrations._derive_world_placement(
        mdl, maps_store_with(maps), fab, maps, dict(_GAUGE))

    assert out["converted"] == 0
    assert mdl.map_transform("m0") is None, "an already-converted map was re-read"


@pytest.mark.asyncio
async def test_a_step_that_raised_is_not_marked_done() -> None:
    """The other half of the marker rule, found by auditing D4's class.

    Six blocks catch their own exception so that one broken store cannot block
    the rest of the migration — and with `ran.add(...)` as the block's first
    statement, a step that raised half way through was marked done anyway. A
    marker is one-way, so the maps it had not reached yet were never reachable
    again: measured on a three-map store where step 11 raised after the first
    map, the other two stayed unplaced and faulted for the life of the install.
    """
    maps = [_map("master", _IDENT)] + [
        _map(f"m{i}", {"x_offset": 0.3 * i, "y_offset": -0.1, "scale": 1.0,
                       "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75})
        for i in range(1, 4)]
    mdl = _mdl({"master": {**_SQUARE, "reference_measurements": [{"m": 1}]}})
    ms = maps_store_with(maps)
    fab = _fab([PHOTO_DIVORCE, "lights_to_metres", "cal_point_floors",
                "barrier_ids", "autocal_hygiene", "shear_sign",
                "unreadable_placements", "world_gauge_seed",
                "tie_ins_to_metres", DERIVED_PLACEMENT])

    real = migrations._place_unmeasured_maps

    async def _half(mdl_, maps_, gauge):
        await real(mdl_, maps_[:2], gauge)      # gets as far as m1
        raise RuntimeError("store write failed")

    migrations._place_unmeasured_maps = _half
    try:
        await async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, migration_backup)
    finally:
        migrations._place_unmeasured_maps = real

    assert "unmeasured_placements" not in (fab.data.get(MARKER) or []), (
        "a step that raised was marked done, so it never gets another turn")

    # The next boot finishes the job.
    await async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, migration_backup)
    unplaced = [mid for mid in ("m1", "m2", "m3")
                if not fabric_truth.placement_is_readable(mdl.map_transform(mid) or {})]
    assert not unplaced, f"left unplaced for the life of the install: {unplaced}"
    assert fabric_truth.map_geometry_faults(maps, mdl) == []


# ═══ D5. Which half wins ════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_an_unmeasured_record_loses_to_the_alignment_the_owner_applied() -> None:
    """`ws_maps` makes an applied Point Align a stack-only write BY DESIGN, so
    a record that disagrees with one is the NORMAL state of an aligned map,
    not an edge case. Reading that disagreement as a trim and keeping the
    record threw the alignment away.
    """
    solved = {"_m": [1.25, 0.10, -0.10, 0.95], "_m_ar": 0.75,
              "x_offset": 0.31, "y_offset": -0.18, "ref_ar": 0.75}
    maps = [_map("master", _IDENT), _map("annex", solved)]
    mdl = _mdl({"master": {**_SQUARE, "reference_measurements": [{"m": 1}]},
                "annex": dict(_SQUARE)})          # the system's guess: unmeasured
    intent = fabric_truth.legacy_stack_metre_transform(maps[1], _GAUGE)

    out = await migrations._derive_world_placement(
        mdl, maps_store_with(maps), _fab(), maps, dict(_GAUGE))

    assert out["stack_won"] == 1, out
    gap = _gap(intent, mdl.map_transform("annex"))
    assert gap < 0.01, f"the owner's Point Align was discarded, by {gap:.3f} m"


@pytest.mark.asyncio
async def test_a_measured_record_still_beats_the_alignment(caplog) -> None:
    """The other direction, which is issue #62 itself: rjbutler's Main Floor
    was MEASURED and the rigid solver's matrix was the broken half. A
    measurement is a distance somebody physically walked; an alignment is
    where they dragged a picture."""
    solved = {"_m": [1.25, 0.10, -0.10, 0.95], "_m_ar": 0.75,
              "x_offset": 0.31, "y_offset": -0.18, "ref_ar": 0.75}
    maps = [_map("master", _IDENT), _map("annex", solved)]
    measured = {**_SQUARE, "reference_measurements": [{"m": 1}]}
    mdl = _mdl({"master": dict(measured), "annex": dict(measured)})

    out = await migrations._derive_world_placement(
        mdl, maps_store_with(maps), _fab(), maps, dict(_GAUGE))

    assert out["record_won"] == 2, out
    assert mdl.map_transform("annex") == measured, "his measurement was overwritten"


@pytest.mark.asyncio
async def test_step_one_does_not_overwrite_a_measured_record() -> None:
    """Step 13 refuses to take a stack over a measurement. Step 1 runs FIRST,
    so if it reconciles the record onto the stack the refusal never gets asked.

    Reachable with no exotic history: Reset on the Stack tab writes
    x_offset=0, y_offset=0, scale=1, rotation=0 — a legacy stack by every test
    in this file — and on an install that never ran the photo-divorce release
    that took the record with it, 82.803 m, silently and for good.
    """
    legacy_stack = {"x_offset": 0.24, "y_offset": -0.17, "scale": 0.72,
                    "rotation": 9.0, "scale_x_adj": 1.0, "ref_ar": 0.75}
    maps = [_map("master", _IDENT), _map("annex", legacy_stack)]
    measured = {**_SQUARE, "reference_measurements": [{"m": 1}]}
    mdl = _mdl({"master": dict(measured), "annex": dict(measured)})
    before = dict(mdl.map_transform("annex"))

    out = await migrations.async_run_photo_divorce(
        MagicMock(), mdl, maps_store_with(maps), _fab(), None, migration_backup)

    assert out["measured_records_kept"] >= 1, out
    gap = _gap(before, mdl.map_transform("annex"))
    assert gap < 0.01, f"step 1 took a reset stack over a measurement, by {gap:.3f} m"
    assert mdl.map_transform("annex").get("reference_measurements"),         "the measurement itself was dropped"


@pytest.mark.asyncio
async def test_the_snapshot_is_taken_before_the_first_step_that_writes() -> None:
    """A snapshot is only a safety net if it predates everything it undoes.

    Taken between steps 12 and 13 it returned the POST-step-1 record — the
    owner's escape hatch did not reach the run it exists to escape from,
    27.857 m of difference on a pre-R1 store.
    """
    order: list[str] = []

    async def _spy(hass, label, keys):
        order.append("snapshot")
        return "bk-1"

    maps = [_map("master", _IDENT),
            _map("annex", {"x_offset": 0.22, "y_offset": -0.13, "scale": 0.8,
                           "rotation": 11.0, "scale_x_adj": 1.0, "ref_ar": 0.75})]
    mdl = _mdl({"master": dict(_SQUARE), "annex": dict(_SQUARE)})
    real_put = mdl._put_map_transform

    def _traced(map_id, rec):
        order.append("write")
        return real_put(map_id, rec)

    mdl._put_map_transform = _traced

    await migrations.async_run_photo_divorce(
        MagicMock(), mdl, maps_store_with(maps), _fab(), None, _spy)

    assert "snapshot" in order, "no snapshot was taken at all"
    assert order.index("snapshot") == 0, (
        "a record was written before the snapshot, so restoring it cannot "
        f"return the owner to where they started - order was {order[:5]}")


def test_the_iso_term_is_not_consulted_as_a_fault() -> None:
    """It is a gauge-seed tie-break and its own docstring says so.

    It compares the record's aspect against the footprint the STACK draws, so
    an X-stretch or a solved affine in the stack fires it exactly as hard as a
    crop in the record — which is why it took the record on all 20 of the
    disagreeing maps of one seed of the conversion's own wide fixture, and 18
    of 20 on another, at up to 94.584 m.
    """
    assert "legacy_record_iso_error" not in _calls_in("_derive_world_placement"), (
        "the conversion is deciding which half is stale on a tie-break")


@pytest.mark.asyncio
async def test_the_two_steps_agree_about_a_hand_alignment() -> None:
    """One question, one answer, whichever release the install came through.

    Step 1 repairs a record onto the stack; step 13 chooses between them. On
    an unmeasured map they now say the same thing, so an install that already
    carries step 1's marker is not placed differently from one that does not.
    """
    # Stretched on one axis as well as dragged, because that is the shape that
    # used to make the two steps disagree: the stretch changes the footprint's
    # aspect, the old trim signature read that as a crop, and step 13 kept the
    # record on exactly the maps step 1 would have moved onto the stack.
    dragged = {"x_offset": 0.45, "y_offset": -0.25, "scale": 1.3,
               "scale_x_adj": 1.25, "rotation": 18.0, "ref_ar": 0.75}
    outcomes = []
    for marker in ([], [PHOTO_DIVORCE]):
        maps = [_map("master", _IDENT), _map("annex", dict(dragged))]
        mdl = _mdl({"master": {**_SQUARE, "reference_measurements": [{"m": 1}]},
                    "annex": dict(_SQUARE)})
        await async_run_photo_divorce(MagicMock(), mdl, maps_store_with(maps),
                                      _fab(marker), None, migration_backup)
        outcomes.append(dict(mdl.map_transform("annex")))

    gap = _gap(outcomes[0], outcomes[1])
    assert gap < 0.01, (
        f"the same store lands {gap:.3f} m apart depending on whether step 1's "
        f"marker was already set")


# ═══ The class, swept ═══════════════════════════════════════════════════════


def _callers_of(attr: str) -> list[str]:
    """Top-level functions in `migrations` that CALL `.attr(...)`.

    Parsed, not grepped: a comment naming the method it deliberately does not
    call would otherwise read as a call.
    """
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(migrations))
    out = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for sub in ast.walk(node):
            if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute)
                    and sub.func.attr == attr):
                out.append(node.name)
                break
    return sorted(out)


def _calls_in(func_name: str) -> set[str]:
    """Every attribute a top-level function actually calls."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(migrations))
    for node in tree.body:
        if (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                and node.name == func_name):
            return {sub.func.attr for sub in ast.walk(node)
                    if isinstance(sub, ast.Call)
                    and isinstance(sub.func, ast.Attribute)}
    raise AssertionError(f"{func_name} is gone")



def test_every_legacy_stack_reader_asks_whether_the_stack_is_there() -> None:
    """The audit, as a test, so a new step cannot quietly join the class.

    `legacy_stack_metre_transform` is the one door onto the pre-R3 frame, and
    it answers the IDENTITY for a map with no stack — the world origin, one
    world unit across. Every function that opens that door has to ask first,
    in one of the three ways this module asks it: `_has_a_legacy_stack`,
    `_stack_is_a_hand_alignment` (which implies it), or a solved `_m` (which
    is a legacy field, so its presence is the same answer).
    """
    _GUARDS = ("_has_a_legacy_stack", "_stack_is_a_hand_alignment", '"_m"')
    readers = _callers_of("legacy_stack_metre_transform")
    assert readers, "the scan found nothing — it is not scanning"
    import inspect
    unguarded = [fn for fn in readers
                 if not any(g in inspect.getsource(getattr(migrations, fn))
                            for g in _GUARDS)]
    assert not unguarded, f"reads the legacy frame without asking: {unguarded}"


def test_no_step_writes_a_map_through_the_post_conversion_writer_early() -> None:
    """`async_update_map` rebuilds `stack` from the POST-conversion whitelist,
    so it deletes the legacy frame. Only the conversion may impose that shape,
    and only as it converts that map."""
    assert _callers_of("async_update_map") == ["_derive_world_placement"], (
        f"writes a map through the whitelisting writer before the conversion "
        f"has converted it: {_callers_of('async_update_map')}")


def test_the_snapshot_names_every_store_the_conversion_writes() -> None:
    """Model for the record, Maps for the stripped stack, Fabric for the
    per-map markers. Miss one and the restore is not a restore."""
    assert set(migrations.CONVERSION_STORE_KEYS) == {
        MAPS_STORE_KEY, MODEL_STORE_KEY, FABRIC_STORE_KEY}
    import inspect
    src = inspect.getsource(migrations.async_run_photo_divorce)
    assert "CONVERSION_STORE_KEYS" in src
    assert "[MAPS_STORE_KEY, MODEL_STORE_KEY]" not in src


def test_no_step_marker_is_written_before_its_body_runs() -> None:
    """`ran.add(X)` is the first statement of a block, but `ran` only reaches
    disk through `done |= ran` at the end, after every body. The per-map
    marker is the one that has to be durable as it goes, because it is the
    only one that describes work already done inside an unfinished run."""
    import inspect

    src = inspect.getsource(migrations._derive_world_placement)
    add = src.index("done.add(mid)")
    save = src.index("fab.store.async_save", add)
    assert src.index("await ms.async_update_map", 0) < add, (
        "the map's stack is stripped before it is marked done")
    assert save > add, "the marker is saved before the map is marked"
    assert math.isclose(1.0, 1.0)   # keeps the import honest
