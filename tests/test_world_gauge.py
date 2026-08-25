# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The world gauge is STORED, written once, and nothing else may set it.

`find_metre_anchor` divided a measured map's `scale_x_m` by its world
footprint, and `legacy_world_footprint` reads the stack. R3 derives the stack from
the metric record, so measuring the record's units off that stack would be
this project's own bug class relocated — a quantity defined in terms of the
thing defined in terms of it. The gauge had to stop being measured before R3
could be built, or R3 would be built on a loop.

What that costs is one stored field and one rule: WRITE ONCE. A gauge that
re-measured on every write would be the per-render measurement again with a
delay on it, and the failure would be worse for being sticky — the house's
metre scale moving whenever a map was added, re-measured or re-ordered,
silently rescaling every room and every scanner that had not moved.
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.conftest import migration_backup, maps_store_with

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.migrations import (
    DERIVED_PLACEMENT, MARKER, TIE_INS_TO_METRES, UNMEASURED_PLACEMENTS,
    WORLD_GAUGE, async_run_photo_divorce,
)
from custom_components.padspan_ha.model_store import ModelStore


def _map(mid: str, *, master: bool, scale: float = 1.0, ar: float = 0.75) -> dict:
    return {"id": mid, "floor_id": "main", "name": mid.title(),
            "image": {"width": 1600, "height": int(1600 * ar)},
            "stack": {"is_master": master, "scale": scale, "scale_x_adj": 1.0,
                      "ref_ar": ar, "rotation": 0,
                      "x_offset": 0.0 if master else 0.2,
                      "y_offset": 0.0 if master else -0.1}}


def _measured(sx: float, sy: float) -> dict:
    return {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": sx,
            "scale_y_m": sy, "rotation_rad": 0.0, "shear_rad": 0.0,
            "floor_id": "main", "reference_measurements": [{"m": 1}]}


def _mdl(transforms: dict) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.store.async_save = AsyncMock()
    s.fabric = None
    s.data = {"map_transforms": transforms}
    return s


def _fab(marker: list[str] | None = None):
    from custom_components.padspan_ha.fabric_store import FabricStore
    f = FabricStore.__new__(FabricStore)
    f.hass = MagicMock()
    f.store = AsyncMock()
    f.store.async_save = AsyncMock()
    f.data = {"floors": {}, "history": [], "scanner_positions_m": {},
              "beacon_positions_m": {}, "rf_barriers_m": []}
    if marker:
        f.data[MARKER] = list(marker)
    return f


def _ms(maps: list[dict]):
    return maps_store_with(maps)


# ── it is stored, and it is one scalar ───────────────────────────────────────

@pytest.mark.asyncio
async def test_the_seed_is_written_to_the_model_store() -> None:
    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})

    g = await mdl.async_ensure_world_gauge(maps)

    assert g == {"m_per_unit": 20.0, "source_map_id": "ground"}
    assert mdl.data["world_gauge"] == {"m_per_unit": 20.0, "source_map_id": "ground"}
    mdl.store.async_save.assert_awaited()
    # The snapshot the panel reads carries it.
    assert mdl.snapshot()["world_gauge"] == {"m_per_unit": 20.0,
                                             "source_map_id": "ground"}


@pytest.mark.asyncio
async def test_it_is_written_once_and_a_re_measure_does_not_rescale_the_house() -> None:
    """The rule the whole design rests on.

    Re-measuring a plan means "this plan is a different size than I thought".
    It does not mean "the house is a different size than I thought". Under the
    old per-render measurement it meant both, because the anchor map's record
    WAS the house scale — so correcting one plan silently moved every room,
    scanner and barrier in the building, including on floors the owner had
    never touched.
    """
    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})
    await mdl.async_ensure_world_gauge(maps)

    # The owner re-measures the same plan: it is really 25 m across.
    mdl.data["map_transforms"]["ground"] = _measured(25.0, 18.75)
    again = await mdl.async_ensure_world_gauge(maps)

    assert again == {"m_per_unit": 20.0, "source_map_id": "ground"}
    assert mdl.data["world_gauge"]["m_per_unit"] == 20.0
    # The MAP's placement follows the re-measure, which is what it meant.
    assert mdl.map_transform("ground")["scale_x_m"] == 25.0


@pytest.mark.asyncio
async def test_nothing_measured_is_a_refusal_not_a_fabricated_scale() -> None:
    maps = [_map("ground", master=True)]
    unmeasured = {k: v for k, v in _measured(20.0, 15.0).items()
                  if k != "reference_measurements"}
    mdl = _mdl({"ground": unmeasured})

    assert await mdl.async_ensure_world_gauge(maps) is None
    assert fabric_truth.metre_gauge(mdl) is None
    assert mdl.data.get("world_gauge") in (None, {"m_per_unit": None,
                                                  "source_map_id": None})
    mdl.store.async_save.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_choice_is_logged_with_the_map_and_the_reason(caplog) -> None:
    """A one-time judgement is being frozen; the owner has to be able to see
    that it happened and which picture it was taken from."""
    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})

    with caplog.at_level(logging.INFO,
                         logger="custom_components.padspan_ha.model_store"):
        await mdl.async_ensure_world_gauge(maps)

    msg = "\n".join(r.getMessage() for r in caplog.records)
    assert "World gauge set" in msg, msg
    assert "ground" in msg and "20.0" in msg, msg
    assert "master" in msg, "the log does not say WHY this map was chosen"


# ── which map, and never the array's opinion ────────────────────────────────

@pytest.mark.asyncio
async def test_the_master_map_defines_the_world_unit() -> None:
    """World units ARE the master's picture: its stack is the identity."""
    ground = _map("zzz_ground", master=True)
    annex = _map("aaa_annex", master=False)
    mdl = _mdl({"zzz_ground": _measured(20.0, 15.0),
                "aaa_annex": _measured(24.0, 18.0)})

    g = await mdl.async_ensure_world_gauge([annex, ground])

    assert g["source_map_id"] == "zzz_ground", (
        "the gauge came from a map that sorts first rather than the master")
    assert g["m_per_unit"] == 20.0


def test_the_seed_is_the_same_in_any_order() -> None:
    """The 20% swing, measured, and then removed.

    Both maps are internally self-consistent, so the old candidate loop
    accepted whichever came first — and the two are measured at different
    scales, which is an ordinary two-plan install.
    """
    ground = _map("ground", master=True)
    annex = _map("annex", master=False)
    mdl = _mdl({"ground": _measured(20.0, 15.0),
                "annex": _measured(24.0, 18.0)})

    forward = fabric_truth.measure_world_gauge([ground, annex], mdl)
    reverse = fabric_truth.measure_world_gauge([annex, ground], mdl)

    assert forward == reverse
    assert forward["m_per_unit"] == 20.0
    # What the other order used to give, and what it cost.
    alone = fabric_truth.measure_world_gauge([annex], mdl)
    assert alone["m_per_unit"] == 24.0
    swing = abs(alone["m_per_unit"] - forward["m_per_unit"]) / forward["m_per_unit"]
    assert swing == pytest.approx(0.20), "the fixture no longer shows the swing"
    a = fabric_truth.legacy_stack_metre_transform(ground, forward)
    b = fabric_truth.legacy_stack_metre_transform(ground, alone)
    assert fabric_truth.placement_disagreement_m(a, b) == pytest.approx(5.0, abs=1e-6)


# ── the upgrade path ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_migration_seeds_a_store_that_already_has_measured_maps() -> None:
    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})
    fab = _fab()

    stats = await async_run_photo_divorce(MagicMock(), mdl, _ms(maps), fab, None, migration_backup)

    assert stats["gauge_seeded"] is True
    assert stats["gauge_m_per_unit"] == 20.0
    assert WORLD_GAUGE in fab.data[MARKER]
    assert fabric_truth.metre_gauge(mdl)["m_per_unit"] == 20.0


@pytest.mark.asyncio
async def test_an_unmeasured_install_is_asked_again_next_startup() -> None:
    """`done |= ran`: a step whose preconditions were absent has not run."""
    unmeasured = {k: v for k, v in _measured(20.0, 15.0).items()
                  if k != "reference_measurements"}
    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": unmeasured})
    fab = _fab()

    stats = await async_run_photo_divorce(MagicMock(), mdl, _ms(maps), fab, None, migration_backup)

    assert stats["gauge_seeded"] is False
    assert WORLD_GAUGE not in fab.data.get(MARKER, []), (
        "the seed was marked done on an install that has nothing to seed from")


@pytest.mark.asyncio
async def test_a_missing_gauge_is_re_seeded_even_when_the_marker_is_set() -> None:
    """Restoring a Model store backed up before R2 takes `world_gauge` with it.

    The marker is one-way, so a marker-guarded seed would never run again and
    the house would lose its metre scale permanently — at the moment the owner
    was trying to recover it. The ensure runs before the marker check.
    """
    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})
    fab = _fab([WORLD_GAUGE])          # already "done" from a previous boot

    await async_run_photo_divorce(MagicMock(), mdl, _ms(maps), fab, None, migration_backup)

    assert fabric_truth.metre_gauge(mdl)["m_per_unit"] == 20.0


@pytest.mark.asyncio
async def test_the_first_measurement_seeds_it_without_waiting_for_a_restart() -> None:
    """An install that measures its first map after upgrading."""
    from custom_components.padspan_ha.const import DATA_MAPS, DATA_MODEL, DOMAIN
    from custom_components.padspan_ha.ws_fabric import ws_fabric_map_transform_set

    maps = [_map("ground", master=True)]
    mdl = _mdl({})
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: _ms(maps)}}
    conn = MagicMock()

    assert fabric_truth.metre_gauge(mdl) is None
    await ws_fabric_map_transform_set(hass, conn, {
        "id": 1, "map_id": "ground", "transform": _measured(20.0, 15.0)})

    conn.send_error.assert_not_called()
    assert fabric_truth.metre_gauge(mdl) == {"m_per_unit": 20.0,
                                             "source_map_id": "ground"}


# ── PLACED is not MEASURED ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_unmeasured_map_gets_a_placement_in_gauge_units() -> None:
    """A map nobody measured still SITS somewhere.

    It has a stack — the owner dragged it into place — and with the gauge
    stored that stack has a size in metres. Writing it down turns "this map
    has no record" into "this map has a record nobody has measured", which is
    what `reference_measurements` is for and what R3 derives a stack from.
    """
    ground = _map("ground", master=True)
    annex = _map("annex", master=False, scale=0.5)
    mdl = _mdl({"ground": _measured(20.0, 15.0)})
    # An install that upgraded through an earlier release: step 1 is marked
    # done and will not run, which is the population this step exists for. On
    # a store that has never run step 1, step 1 places these maps itself —
    # see the test below — and this one has nothing to do.
    fab = _fab(["fabric_photo_divorce"])

    stats = await async_run_photo_divorce(MagicMock(), mdl, _ms([ground, annex]), fab, None, migration_backup)

    assert stats["unmeasured_placed"] == 1
    assert UNMEASURED_PLACEMENTS in fab.data[MARKER]
    t = mdl.map_transform("annex")
    assert fabric_truth.placement_is_readable(t)
    # 0.5 of the master's picture, and the master's picture is 20 m across.
    assert t["scale_x_m"] == pytest.approx(10.0, abs=1e-3)
    assert t["scale_y_m"] == pytest.approx(7.5, abs=1e-3)
    # PLACED, not MEASURED: it must not become able to set the house's scale.
    assert not t.get("reference_measurements")
    assert fabric_truth.measure_world_gauge(
        [annex], _mdl({"annex": t})) is None


@pytest.mark.asyncio
async def test_step_1_already_places_them_on_a_store_that_has_never_run_it() -> None:
    """Not a second writer — the same placement, from the step that gets there
    first. Step 1 replaces any record that disagrees with the stack, and a map
    with NO record disagrees, so a store running the migration for the first
    time comes out placed either way. Step 11 exists for the store that
    already carries step 1's marker and will never get it again.
    """
    ground = _map("ground", master=True)
    annex = _map("annex", master=False, scale=0.5)
    mdl = _mdl({"ground": _measured(20.0, 15.0)})

    stats = await async_run_photo_divorce(MagicMock(), mdl, _ms([ground, annex]), _fab(), None, migration_backup)

    assert stats["unmeasured_placed"] == 0, "two steps placed the same map"
    assert "Annex" in stats["maps_repaired"]
    assert fabric_truth.placement_is_readable(mdl.map_transform("annex"))
    assert not mdl.map_transform("annex").get("reference_measurements")


@pytest.mark.asyncio
async def test_placing_the_unmeasured_maps_raises_no_new_faults() -> None:
    """The placement written is the one the fault gate would ask for."""
    ground = _map("ground", master=True)
    annex = _map("annex", master=False, scale=0.5)
    maps = [ground, annex]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})

    await async_run_photo_divorce(MagicMock(), mdl, _ms(maps), _fab(["fabric_photo_divorce"]), None, migration_backup)

    assert fabric_truth.map_geometry_faults(maps, mdl) == []


@pytest.mark.asyncio
async def test_a_map_that_already_has_a_placement_is_left_alone() -> None:
    """This places maps with no placement; it does not re-place maps."""
    ground = _map("ground", master=True)
    annex = _map("annex", master=False, scale=0.5)
    hand_placed = {"origin_x_m": 3.0, "origin_y_m": -1.0, "scale_x_m": 9.0,
                   "scale_y_m": 7.0, "rotation_rad": 0.2, "shear_rad": 0.0,
                   "floor_id": "main"}
    mdl = _mdl({"ground": _measured(20.0, 15.0), "annex": dict(hand_placed)})

    # ONLY step 11 outstanding, which is what this test is about. Step 13 has
    # to be marked too: it converts every map on the store, and on THIS map —
    # a hand-dragged stack beside an unmeasured record that disagrees with it —
    # its rule legitimately takes the stack. That is step 13's decision, tested
    # where step 13 is tested; leaving it outstanding here made this assertion
    # depend on it.
    stats = await async_run_photo_divorce(MagicMock(), mdl, _ms([ground, annex]), _fab([
            "fabric_photo_divorce", "lights_to_metres", "cal_point_floors",
            "barrier_ids", "autocal_hygiene", "shear_sign",
            "unreadable_placements", WORLD_GAUGE, TIE_INS_TO_METRES,
            DERIVED_PLACEMENT]), None, migration_backup)

    assert stats["unmeasured_placed"] == 0
    assert mdl.map_transform("annex") == hand_placed


# ── the detectors can see the new state ─────────────────────────────────────

@pytest.mark.asyncio
async def test_the_usage_report_asks_whether_there_is_a_gauge() -> None:
    """`has_metre_anchor` keyed off the SOURCE MAP ID, not off the gauge.

    While the anchor was measured by walking the maps the two were the same
    question — an anchor WAS a map, so it always had an id. A stored gauge is
    a record and `source_map_id` is provenance on it: a record carrying a good
    `m_per_unit` and no source is a house that is fully scaled and drawing,
    and it was reported to the usage feed as having no metre scale at all.

    Not user-facing displacement — a permanently wrong developer signal about
    the one field R2 introduces, which is the kind of blindness that lets the
    next round measure nothing.
    """
    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})
    await mdl.async_ensure_world_gauge(maps)

    # Provenance dropped; the scale is untouched and the house still draws.
    mdl.data["world_gauge"] = {"m_per_unit": 20.0}
    g = fabric_truth.metre_gauge(mdl)
    assert g["m_per_unit"] == 20.0 and g["source_map_id"] is None
    assert fabric_truth.legacy_stack_metre_transform(maps[0], g) is not None

    src = (__import__("pathlib").Path(__file__).resolve().parents[1]
           / "custom_components" / "padspan_ha" / "telemetry.py"
           ).read_text(encoding="utf-8")
    assert "_has_anchor = _ft.metre_gauge(_mdl_store) is not None" in src, (
        "has_metre_anchor is derived from the source map id again")
    assert '_has_anchor = bool(_anchor_id)' not in src


# ── survivors worth closing ─────────────────────────────────────────────────

def test_a_trimmed_master_loses_to_a_clean_map() -> None:
    """The master is preferred BECAUSE its picture defines the unit — which
    is only a reason while its record still describes that picture.

    An install whose master was trimmed by a pre-0.36 build and whose second
    plan is clean is an ordinary two-plan house with one damaged photo, and
    taking the master's scale there hands every floor the trim's error. The
    master's preference is inside the self-consistency test, not beside it.
    """
    trimmed_master = _map("ground", master=True, ar=0.25)
    clean = _map("annex", master=False)
    mdl = _mdl({
        # 20 m across a world width of 1.0, 10 m down a world height of 0.25.
        "ground": _measured(20.0, 10.0),
        "annex": _measured(20.0, 15.0),
    })

    assert fabric_truth.legacy_record_iso_error(
        trimmed_master, mdl.map_transform("ground")) == pytest.approx(1.0)

    g = fabric_truth.measure_world_gauge([trimmed_master, clean], mdl)

    assert g["source_map_id"] == "annex", (
        "a trimmed master set the house scale; every floor inherits its error")
    assert g["m_per_unit"] == 20.0
    assert "matches its own picture" in g["source_reason"], g["source_reason"]


@pytest.mark.asyncio
async def test_the_gauge_is_ensured_even_when_every_marker_is_set() -> None:
    """The strongest form of the restore case.

    `async_run_photo_divorce` returns `{"skipped": True}` the moment nothing
    is outstanding. A gauge ensure placed after that check would never run on
    a fully-migrated install — which is every install, one release after this
    one — so a Model store restored from a pre-R2 backup would leave the house
    with no metre scale until somebody re-measured a map by hand.
    """
    from custom_components.padspan_ha.migrations import (
        AUTOCAL_HYGIENE, BARRIER_IDS, CAL_POINT_FLOORS, DERIVED_PLACEMENT,
        LIGHTS_TO_METRES, PHOTO_DIVORCE, SHEAR_SIGN, TIE_INS_TO_METRES,
        UNREADABLE_PLACEMENTS,
    )

    maps = [_map("ground", master=True)]
    mdl = _mdl({"ground": _measured(20.0, 15.0)})
    fab = _fab([PHOTO_DIVORCE, LIGHTS_TO_METRES, CAL_POINT_FLOORS, BARRIER_IDS,
                AUTOCAL_HYGIENE, SHEAR_SIGN, UNREADABLE_PLACEMENTS,
                WORLD_GAUGE, UNMEASURED_PLACEMENTS,
                TIE_INS_TO_METRES, DERIVED_PLACEMENT])

    stats = await async_run_photo_divorce(MagicMock(), mdl, _ms(maps), fab, None, migration_backup)

    assert stats == {"skipped": True}, "the fixture is not fully migrated"
    assert fabric_truth.metre_gauge(mdl) == {"m_per_unit": 20.0,
                                             "source_map_id": "ground"}


def test_the_metre_conversion_refuses_a_gaugeless_gauge_rather_than_defaulting() -> None:
    """The deleted 20 m fallback must not come back through the back door.

    `_gauge_scale` is the one function every metre conversion goes through,
    and every caller reaches it via `metre_gauge`, which has already refused an
    unusable gauge — so this is unreachable today. "Unreachable today" is
    exactly the argument that kept the fabricated 20 m house alive for a
    release. A default here would be that fallback rebuilt in the worst
    possible place, and silent: a house drawn at a scale nobody measured.
    """
    assert fabric_truth._gauge_scale({"m_per_unit": 20.0}) == 20.0
    for bad in ({}, {"m_per_unit": None}, {"m_per_unit": 0},
                {"m_per_unit": -1}, {"m_per_unit": float("nan")}):
        with pytest.raises((KeyError, TypeError, ValueError)):
            fabric_truth._gauge_scale(bad)


def test_the_seed_is_deterministic_with_no_master_to_prefer() -> None:
    """Determinism is the property, not the direction of the tie-break.

    With no master the two measured maps rank equally, and WHICH of them wins
    is arbitrary — but it must not be "whichever the array happened to put
    first", because that is the 20% swing R2 exists to remove. A map being
    added, deleted or re-sorted must not re-scale the house.
    """
    a = _map("aaa", master=False)
    b = _map("bbb", master=False)
    mdl = _mdl({"aaa": _measured(20.0, 15.0), "bbb": _measured(24.0, 18.0)})

    assert (fabric_truth.measure_world_gauge([a, b], mdl)
            == fabric_truth.measure_world_gauge([b, a], mdl))
    # ...and deleting the map that did NOT win leaves the gauge alone.
    winner = fabric_truth.measure_world_gauge([a, b], mdl)["source_map_id"]
    loser = "bbb" if winner == "aaa" else "aaa"
    kept = [m for m in (a, b) if m["id"] != loser]
    assert fabric_truth.measure_world_gauge(kept, mdl)["source_map_id"] == winner
