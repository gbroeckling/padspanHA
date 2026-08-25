# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A record that is not a placement.

Pre-R1 `ws_fabric_map_transform_set` stored the client's dict verbatim, so a
payload carrying `scale_x_m: null` reached disk. Every consequence of that was
silence:

    placement_disagreement_m    returns None — `float(None)` is a TypeError
    placements_agree            None read as "nothing to repair"
    map_geometry_faults         `if sx <= 0 or sy <= 0: continue`
    measure_world_gauge           skips it, so the install has no anchor
    map_geometry_faults         ...and returned [] for want of one

So the ONE record that is provably broken was the one record reported as fine,
and on an install whose only measured map was that one, the diagnostic written
to find broken records was silenced by the breakage it was written to find.

A5 fixed the writer. It did not repair the records already on disk, and a
marker-guarded migration step never gets another turn — so this is a step of
its own, with its own marker.

The invariant: **a stored placement either places the map or says nothing.**
A record with neither scale says nothing, which is what an unmeasured map
looks like and what the writer now leaves behind when a payload's scale is
unusable. A record that names part of a placement it cannot deliver is
corrupt, and corrupt is loud.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN,
)
from custom_components.padspan_ha.migrations import (
    MARKER, PHOTO_DIVORCE, UNREADABLE_PLACEMENTS, async_run_photo_divorce,
)
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import maps_store_with, seed_world_gauge, migration_backup

_GOOD = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
         "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}

# Every shape a record has actually been found in, or can reach through a
# websocket payload that is a dict of whatever the client sent.
_CORRUPT = [
    ("scale_x null", {**_GOOD, "scale_x_m": None}),
    ("scale_y null", {**_GOOD, "scale_y_m": None}),
    ("scale is words", {**_GOOD, "scale_x_m": "twenty"}),
    ("scale is empty text", {**_GOOD, "scale_x_m": ""}),
    ("scale zero", {**_GOOD, "scale_x_m": 0.0}),
    ("scale negative", {**_GOOD, "scale_x_m": -20.0}),
    ("origin null", {**_GOOD, "origin_x_m": None}),
    ("rotation a string", {**_GOOD, "rotation_rad": "north"}),
    ("scale not a number", {**_GOOD, "scale_y_m": float("nan")}),
    ("scale infinite", {**_GOOD, "scale_y_m": float("inf")}),
]
_IDS = [c[0] for c in _CORRUPT]


# ── the predicate ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("_name,t", _CORRUPT, ids=_IDS)
def test_a_record_that_cannot_be_read_is_not_a_placement(_name, t) -> None:
    assert not fabric_truth.placement_is_readable(t)


@pytest.mark.parametrize("_name,t", _CORRUPT, ids=_IDS)
def test_and_it_does_not_agree_with_anything(_name, t) -> None:
    """`d is None` used to mean "nothing to repair". It means "unreadable"."""
    assert not fabric_truth.placements_agree(t, _GOOD)
    assert not fabric_truth.placements_agree(_GOOD, t)


def test_a_good_record_is_readable() -> None:
    """The control, so the predicate cannot pass by refusing everything."""
    assert fabric_truth.placement_is_readable(_GOOD)
    assert fabric_truth.placement_is_readable({"scale_x_m": 3, "scale_y_m": 2})
    assert fabric_truth.placements_agree(_GOOD, dict(_GOOD))


def test_a_numeric_string_is_the_number_it_says_and_not_a_fault() -> None:
    """`float("20")` is 20.0 and every reader in this codebase floats before
    it compares, so a JSON round-trip that quoted the scale places the map in
    exactly the same spot. Asked through the evaluator rather than by type, so
    the predicate answers what the readers actually do."""
    quoted = {**_GOOD, "scale_x_m": "20", "origin_y_m": "0"}
    assert fabric_truth.placement_is_readable(quoted)
    assert fabric_truth.placements_agree(quoted, _GOOD)


def test_a_record_with_no_scale_at_all_says_nothing_rather_than_lying() -> None:
    """The distinction the fault rests on.

    NEITHER scale is what an unmeasured map looks like and what the transform
    writer deliberately leaves behind — it is not corruption and must not be
    reported as any. It still is not a placement, so it still cannot agree.
    """
    silent = {"origin_x_m": 0.0, "origin_y_m": 0.0, "rotation_rad": 0.0}
    assert not fabric_truth.placement_is_readable(silent)
    assert not fabric_truth.placements_agree(silent, _GOOD)


# ── the diagnostic ───────────────────────────────────────────────────────────

def _store(transforms: dict, maps: list | None = None) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock(); s.store = AsyncMock(); s.fabric = None
    s.data = {"map_transforms": transforms}
    # The house has a metre scale, as an install that has measured anything
    # does. Seeded from the maps under test, so the gauge is this scene's.
    seed_world_gauge(s, maps if maps is not None else
                     [_map("master", "Ground", is_master=True),
                      _map("sub", "Annex", is_master=False)])
    return s


def _map(mid: str, name: str, *, is_master: bool) -> dict:
    return {"id": mid, "floor_id": "main", "name": name,
            "image": {"width": 1600, "height": 1200},
            "stack": {"is_master": is_master, "scale": 1.0, "scale_x_adj": 1.0,
                      "ref_ar": 0.75, "rotation": 0, "x_offset": 0, "y_offset": 0}}


@pytest.mark.parametrize("_name,t", _CORRUPT, ids=_IDS)
def test_the_diagnostic_names_it_instead_of_dropping_it(_name, t) -> None:
    """`if sx <= 0 or sy <= 0: continue` was the whole of the old handling."""
    maps = [_map("master", "Ground", is_master=True), _map("sub", "Annex", is_master=False)]
    mdl = _store({"master": {**_GOOD, "reference_measurements": [{"m": 1}]},
                  "sub": dict(t)})
    faults = {f["map_id"]: f for f in fabric_truth.map_geometry_faults(maps, mdl)}
    assert "sub" in faults, "the record that cannot be read is the one not reported"
    assert faults["sub"]["terms"] == ["unreadable"]
    assert "master" not in faults, "the healthy map must not be swept up"


def test_it_is_named_even_when_the_install_has_no_metre_anchor() -> None:
    """The A5 case in full: the only measured map is the broken one.

    `measure_world_gauge` skips an unreadable record, so there is no world
    frame, so the fault list was empty — the breakage silenced the report of
    itself. Readability is a question about the record and needs no frame.
    """
    maps = [_map("only", "Ground", is_master=True)]
    mdl = _store({"only": {**_GOOD, "scale_x_m": None,
                           "reference_measurements": [{"m": 1}]}})
    assert fabric_truth.measure_world_gauge(maps, mdl) is None
    faults = fabric_truth.map_geometry_faults(maps, mdl)
    assert [f["map_id"] for f in faults] == ["only"]
    assert faults[0]["terms"] == ["unreadable"]


def test_a_map_with_no_scale_is_not_reported_as_broken() -> None:
    """The honest unmeasured state stays quiet, or every install shouts."""
    maps = [_map("master", "Ground", is_master=True), _map("sub", "Annex", is_master=False)]
    mdl = _store({"master": {**_GOOD, "reference_measurements": [{"m": 1}]},
                  "sub": {"origin_x_m": 0.0, "origin_y_m": 0.0, "floor_id": "main"}})
    # It is reported as UNPLACED, not as damage. Before R3 such a map still
    # drew, through its stack, so silence was the honest answer; it cannot be
    # drawn at all now, and "not placed" is a different sentence from "this
    # record is broken" because the repairs are different.
    assert [(f["map_id"], f["terms"]) for f in fabric_truth.map_geometry_faults(maps, mdl)]         == [("sub", ["unplaced"])]


# ── what says so ─────────────────────────────────────────────────────────────

def _hass_with(transforms: dict, maps: list[dict]):
    mdl = _store(transforms)
    ms = maps_store_with(maps)
    ms.get_map = lambda mid: next((m for m in maps if m.get("id") == mid), None)
    ms.store = AsyncMock(); ms.async_update_map = AsyncMock()
    fab = MagicMock(); fab.rooms_flat.return_value = {}
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: ms, DATA_FABRIC: fab,
                          DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}}
    return hass, mdl, ms


@pytest.mark.asyncio
async def test_the_health_critic_says_the_placement_cannot_be_read() -> None:
    """A fault with no numeric term in it renders a sentence with nothing in
    the middle unless something names it — the B2 defect on a second fault
    kind. Its own critic, because its cause and its repair are its own."""
    from custom_components.padspan_ha.ws_diagnostics import ws_system_critics

    maps = [_map("master", "Ground", is_master=True), _map("sub", "Annex", is_master=False)]
    hass, _, _ = _hass_with({"master": {**_GOOD, "reference_measurements": [{"m": 1}]},
                             "sub": {**_GOOD, "scale_x_m": None}}, maps)
    conn = MagicMock()
    await ws_system_critics(hass, conn, {"id": 1})
    geo = [c for c in conn.send_result.call_args[0][1]["critics"]
           if c["category"] == "map_geometry"]
    assert len(geo) == 1, geo
    assert "not a placement" in geo[0]["message"]
    assert "— ." not in geo[0]["message"], geo[0]["message"]


def test_the_usage_report_counts_it() -> None:
    """It scores zero on all four existing counters, so an install would
    report a fault and no reason for it."""
    from custom_components.padspan_ha import telemetry as T

    maps = [_map("master", "Ground", is_master=True), _map("sub", "Annex", is_master=False)]
    hass, _, _ = _hass_with({"master": {**_GOOD, "reference_measurements": [{"m": 1}]},
                             "sub": {**_GOOD, "scale_x_m": None}}, maps)
    health = T.build_payload(hass)["health"]
    assert health["maps_geometry_faulted"] == 1
    assert health["geometry_fault_unreadable"] == 1
    # The four disagreement counters are gone: they measured the gap between a
    # map's two stored placements and there is one placement, so all four read
    # zero on every install, forever. A counter that cannot move is not a
    # counter.
    for gone in ("geometry_fault_iso", "geometry_fault_placement",
                 "geometry_fault_scale", "geometry_fault_origin"):
        assert gone not in health, gone


# ── the records already on disk ──────────────────────────────────────────────

def _upgraded_install(record: dict, *, measured_master: bool = True):
    """An install that upgraded through every earlier release: the finished
    markers are set, so nothing but the new step can do this work."""
    import tests.test_migration_photo_divorce as M

    mdl, fab, ms = M._scenario()
    if not measured_master:
        mdl.data["map_transforms"]["master"].pop("reference_measurements", None)
    mdl.data["map_transforms"]["bad"] = record
    fab.data[MARKER] = sorted({PHOTO_DIVORCE, "lights_to_metres", "cal_point_floors",
                               "barrier_ids", "autocal_hygiene", "shear_sign"})
    return mdl, fab, ms


@pytest.mark.asyncio
async def test_the_migration_recovers_the_placement_from_the_stack() -> None:
    """The map is drawn somewhere. That somewhere, in metres, is a placement
    — the same recovery step 1 performs, for the same reason."""
    mdl, fab, ms = _upgraded_install({"origin_x_m": 0.0, "origin_y_m": 0.0,
                                      "scale_x_m": None, "scale_y_m": 16.0,
                                      "rotation_rad": 0.0, "floor_id": "main"})
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, MagicMock(), migration_backup)

    assert stats["placements_recovered"] == 1
    assert stats["placements_stripped"] == 0
    t = mdl.map_transform("bad")
    assert fabric_truth.placement_is_readable(t)
    assert t["scale_x_m"] == pytest.approx(10.0), "the stack says this map is 10 m wide"
    # And it is a placement, so nothing is faulted any more.
    assert fabric_truth.map_geometry_faults(ms.data["maps"], mdl) == []


@pytest.mark.asyncio
async def test_the_migration_strips_what_it_cannot_recover() -> None:
    """No anchor, so no world frame, so nothing to recover the scale FROM.
    The unusable value goes anyway — through the one writer, whose rule for
    it already exists — and the map reads as unmeasured, which it is."""
    mdl, fab, ms = _upgraded_install({"origin_x_m": 0.0, "origin_y_m": 0.0,
                                      "scale_x_m": None, "scale_y_m": None,
                                      "rotation_rad": 0.0, "floor_id": "main"},
                                     measured_master=False)
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, MagicMock(), migration_backup)

    assert stats["placements_stripped"] == 1
    assert stats["placements_recovered"] == 0
    assert stats["placements_left"] == 0
    t = mdl.map_transform("bad")
    assert "scale_x_m" not in t and "scale_y_m" not in t, t
    # Absent is the state every reader handles, so it stops being reported.
    # Absent is the state every reader handles, so it stops being reported as
    # DAMAGE. What it IS reported as depends on the store: a map with no scale
    # is `unplaced`, and an install with nothing measured anywhere also has no
    # world frame at all, which is the one condition that draws nothing and
    # had no counter of its own before R3.
    assert sorted(t for f in fabric_truth.map_geometry_faults(ms.data["maps"], mdl)
                  for t in f["terms"]) == ["no_world_frame", "unplaced"]


# The strip is only available where the writer can actually deliver it. Its
# rule for an unusable scale falls back to the STORED one, so a record that
# still names a usable scale cannot be reduced to saying nothing by writing it
# back — and writing it back anyway repaired nothing while reporting that it
# had, on a step whose marker is one-way.
_NOT_STRIPPABLE = [
    # A5's shape: one scale nulled, the other good and usable.
    ("half a placement", {"origin_x_m": 0.0, "origin_y_m": 0.0,
                          "scale_x_m": None, "scale_y_m": 16.0,
                          "rotation_rad": 0.0, "floor_id": "main"}),
    # Worse than not repairing it: the writer sanitises a null origin to 0, so
    # the record became READABLE and the fault CLEARED — the map silently
    # placed at the world origin where it had been a loud absence.
    ("a null origin", {"origin_x_m": None, "origin_y_m": 6.0,
                       "scale_x_m": 20.0, "scale_y_m": 16.0,
                       "rotation_rad": 0.0, "floor_id": "main"}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("record", [r for _n, r in _NOT_STRIPPABLE],
                         ids=[n for n, _r in _NOT_STRIPPABLE])
async def test_what_it_cannot_strip_stays_loud_and_is_not_counted(record) -> None:
    """Neither outcome is honest here, so the record is left exactly as it is.

    Corrupt is loud: `map_geometry_faults` goes on naming it until somebody
    measures the map. What must not happen is the step reporting a repair it
    did not make and burning its one-shot marker on the way past.
    """
    mdl, fab, ms = _upgraded_install(dict(record), measured_master=False)
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, MagicMock(), migration_backup)

    assert (stats["placements_recovered"], stats["placements_stripped"]) == (0, 0)
    assert stats["placements_left"] == 1
    assert mdl.map_transform("bad") == record, "the record was rewritten"
    assert not fabric_truth.placement_is_readable(mdl.map_transform("bad"))
    faults = fabric_truth.map_geometry_faults(ms.data["maps"], mdl)
    assert [f["terms"] for f in faults if f["map_id"] == "bad"] == [["unreadable"]], faults


@pytest.mark.asyncio
async def test_a_healthy_record_is_left_alone() -> None:
    """The step must not rewrite every placement on the box."""
    mdl, fab, ms = _upgraded_install({"origin_x_m": 1.0, "origin_y_m": 2.0,
                                      "scale_x_m": 10.0, "scale_y_m": 8.0,
                                      "rotation_rad": 0.3, "floor_id": "main"})
    before = dict(mdl.map_transform("bad"))
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, MagicMock(), migration_backup)
    assert (stats["placements_recovered"], stats["placements_stripped"]) == (0, 0)
    assert mdl.map_transform("bad") == before


@pytest.mark.asyncio
async def test_the_step_has_its_own_marker_and_gets_its_own_turn() -> None:
    """An install that already carries every earlier marker still runs this
    one — the defect a shared "done" flag causes, on the step whose whole
    reason for existing is the records an earlier release wrote."""
    mdl, fab, ms = _upgraded_install({"origin_x_m": 0.0, "origin_y_m": 0.0,
                                      "scale_x_m": None, "scale_y_m": 16.0,
                                      "rotation_rad": 0.0, "floor_id": "main"})
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, MagicMock(), migration_backup)
    # R2 adds two steps of its own, so this install has three outstanding.
    # What the test is about is that THIS one is among them and gets its
    # own marker, not that it is the only step in the release.
    assert UNREADABLE_PLACEMENTS in stats["steps"], stats["steps"]
    assert UNREADABLE_PLACEMENTS in fab.data[MARKER]
    assert stats["placements_recovered"] == 1

    # ...and exactly once.
    again = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, MagicMock(), migration_backup)
    assert again.get("skipped") is True
