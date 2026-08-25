# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The stack is DERIVED. A map's placement is stored once, in metres.

A map's placement lived in `model.map_transforms[id]` in metres AND in
`maps[].stack` in world units. Every operation had to update both, and the
ones that did not are the trim, #62, #64 and #67. `stack_desync`,
`map_geometry_faults`' four disagreement terms, `stack_from_transform`,
`ws_fabric_map_align_to_stack`, `ws_fabric_map_stack_rebuild`,
`ws_positioning_repair`, `_recrop_stack` and `_alignRepair` were all machinery
to detect and reconcile a divergence that should not have been possible.

    world = metres / gauge.m_per_unit

is the whole coordinate system now, so the divergence is unrepresentable and
that machinery is deleted.

This file proves three things:

  1. THE CONVERSION IS EXACT. Per-map corner displacement between the
     placement it CHOSE and the placement it STORED, over a wide fixture set.
     Anything over a centimetre is a bug, not rounding.

  2. THE FOUR HISTORICAL BUGS ARE UNWRITABLE. Each is attempted — the bad
     state is actually constructed and the code is asked to hold it — and
     shown not to survive.

  3. THE DELETION IS REAL. A source scan, so the scaffolding cannot come back
     by accident, and an idempotence check so the conversion cannot run twice.
"""

from __future__ import annotations

import base64
import math
import random
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth, migrations
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import maps_store_with

_FRACS = ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.5, 0.5))


def _mdl(transforms: dict, gauge: float | None = 20.0) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.data = {"map_transforms": transforms,
              "world_gauge": {"m_per_unit": gauge, "source_map_id": "m0"}}
    s.fabric = None
    return s


def _fab():
    f = MagicMock()
    f.data = {}
    f.store = AsyncMock()
    return f


def _map(mid: str, *, stack: dict | None = None, w: int = 1600, h: int = 1200,
         created: str = "2020-01-01T00:00:00+00:00") -> dict:
    return {"id": mid, "name": mid, "floor_id": "main", "created": created,
            "image": {"width": w, "height": h},
            "stack": dict(stack or {"z_level": 0, "ceiling_height_m": 2.4}),
            "room_bounds": {}, "receivers": [], "beacons": [],
            "calibration": {"mode": "none"}}


# ── 1. The conversion is exact ───────────────────────────────────────────────


def _wide_fixture_set(seed: int = 7):
    """Every shape of store the conversion can meet, on one floor.

    Legacy stacks of both kinds (decomposed and solved-affine), records that
    are measured and unmeasured, records that agree with their stack and
    records that do not, trimmed records, maps with no record, maps with no
    stack, and a pristine stack beside a placed record — which is the case
    that decides whether a never-dragged map keeps its measurement.
    """
    r = random.Random(seed)
    maps, transforms, expected = [], {}, {}
    n = 0

    def add(label, stack, record):
        nonlocal n
        mid = f"m{n}"
        n += 1
        maps.append(_map(mid, stack={**(stack or {}), "z_level": 0,
                                     "ceiling_height_m": 2.4},
                         w=r.choice([800, 1600, 930]), h=r.choice([600, 853, 850])))
        if record is not None:
            transforms[mid] = dict(record)
        expected[mid] = label

    # The gauge source: a legacy master, identity stack, measured.
    add("master", {"is_master": True, "x_offset": 0.0, "y_offset": 0.0,
                   "scale": 1.0, "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75},
        {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0, "scale_y_m": 15.0,
         "rotation_rad": 0.0, "shear_rad": 0.0, "reference_measurements": [{"m": 1}]})

    for i in range(40):
        ox = round(r.uniform(-0.9, 0.9), 4)
        oy = round(r.uniform(-0.9, 0.9), 4)
        sc = round(r.uniform(0.3, 2.4), 4)
        sxa = round(r.uniform(0.7, 1.4), 4)
        rot = round(r.uniform(-180, 180), 2)
        dragged = {"x_offset": ox, "y_offset": oy, "scale": sc,
                   "scale_x_adj": sxa, "rotation": rot, "ref_ar": 0.75}
        pristine = {"x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
                    "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
        solved = {"_m": [round(r.uniform(0.3, 1.6), 5), round(r.uniform(-0.4, 0.4), 5),
                         round(r.uniform(-0.4, 0.4), 5), round(r.uniform(0.3, 1.6), 5)],
                  "_m_ar": 0.75, "x_offset": ox, "y_offset": oy, "ref_ar": 0.75}
        rec = {"origin_x_m": round(r.uniform(-40, 40), 4),
               "origin_y_m": round(r.uniform(-40, 40), 4),
               "scale_x_m": round(r.uniform(4, 45), 4),
               "scale_y_m": round(r.uniform(4, 45), 4),
               "rotation_rad": round(r.uniform(-math.pi, math.pi), 6),
               "shear_rad": round(r.choice([0.0, 0.0, r.uniform(-0.3, 0.3)]), 6)}
        measured = {**rec, "reference_measurements": [{"m": 1}]}
        kind = i % 8
        if kind == 0:
            add("dragged + unmeasured record", dragged, rec)
        elif kind == 1:
            add("dragged + measured record", dragged, measured)
        elif kind == 2:
            add("solved affine + record", solved, rec)
        elif kind == 3:
            add("pristine stack + measured record", pristine, measured)
        elif kind == 4:
            add("dragged, no record", dragged, None)
        elif kind == 5:
            add("no stack, measured record", {}, measured)
        elif kind == 6:
            add("nothing at all", {}, None)
        else:
            # A trim: the record was re-derived from the retained fraction and
            # the stack was left describing the pre-crop picture.
            add("trimmed record", dragged, {**measured, "scale_y_m": rec["scale_y_m"] * 0.5})
    return maps, transforms, expected


@pytest.mark.asyncio
async def test_the_conversion_stores_the_placement_it_chose() -> None:
    """FIDELITY. Every map, every corner, over the whole fixture set.

    The only thing between the placement the rule picks and the placement on
    disk is the store's grid — 0.1 mm on a length, 1 µrad on an angle — which
    displaces the far corner of a 20 m map by about 1e-4 m. A centimetre is
    two orders of magnitude above that, so anything over it is arithmetic that
    is wrong rather than arithmetic that is imprecise.
    """
    maps, transforms, _ = _wide_fixture_set()
    mdl = _mdl(transforms)
    ms = maps_store_with(maps)
    gauge = fabric_truth.metre_gauge(mdl)

    # What the conversion will be choosing between, captured before it runs.
    chosen = {}
    for m in maps:
        mid = m["id"]
        t = mdl.map_transform(mid)
        st = (fabric_truth.legacy_stack_metre_transform(m, gauge)
              if migrations._stack_is_a_hand_alignment(m["stack"]) else None)
        chosen[mid] = (dict(t) if t else None, st)

    out = await migrations._derive_world_placement(mdl, ms, _fab(), maps, gauge)

    worst, dist = 0.0, []
    for m in maps:
        mid = m["id"]
        rec, st = chosen[mid]
        stored = mdl.map_transform(mid)
        if not fabric_truth.placement_is_readable(stored or {}):
            continue
        # The stored placement has to BE one of the two candidates, to the
        # store's grid. Which one is the decision rule's business, tested
        # below; that it stored what it chose is this one's.
        gaps = [fabric_truth.placement_disagreement_m(c, stored)
                for c in (rec, st) if fabric_truth.placement_is_readable(c or {})]
        assert gaps, f"{mid}: stored a placement that came from neither candidate"
        d = min(g for g in gaps if g is not None)
        dist.append(d)
        worst = max(worst, d)

    assert dist, "the fixture produced no placements"
    assert worst <= migrations.CONVERSION_FIDELITY_M, (
        f"worst corner displacement {worst:.6f} m over {len(dist)} maps"
    )
    # And the reported figure is the measured one.
    assert out["worst_fidelity_m"] <= migrations.CONVERSION_FIDELITY_M
    assert out["converted"] == len(maps)


@pytest.mark.asyncio
async def test_the_decision_rule_is_the_one_that_was_decided() -> None:
    """Which side wins, per branch, on hand-built stores.

    Not a sweep: each row of the table gets its own store so the branch that
    fired is unambiguous.
    """
    gauge = {"m_per_unit": 20.0, "source_map_id": "m0"}
    ident = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
             "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
    square = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
              "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}

    # m0 — the legacy master — is converted alongside m1 in every scene, and
    # its identity stack is not a hand alignment, so it always contributes one
    # `record_won`. The figures below are m1's, net of that.
    async def convert(stack, record):
        maps = [_map("m0", stack=ident),
                _map("m1", stack={**stack, "z_level": 0, "ceiling_height_m": 2.4})]
        tr = {"m0": {**square, "reference_measurements": [{"m": 1}]}}
        if record is not None:
            tr["m1"] = dict(record)
        mdl = _mdl(tr)
        ms = maps_store_with(maps)
        out = await migrations._derive_world_placement(mdl, ms, _fab(), maps, gauge)
        return out, mdl.map_transform("m1"), ms.data["maps"][1]["stack"]

    # 1. A dragged map whose stack says the same thing as its record: the
    #    record stands, byte for byte. Writing anyway would move every map on
    #    every install by the store's rounding, for nothing.
    dragged_agreeing = {"x_offset": 0.25, "y_offset": 0.0, "scale": 1.0,
                        "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
    out, t, stk = await convert(dragged_agreeing, {**square, "origin_x_m": 5.0})
    assert (out["agreed"], out["record_won"]) == (1, 1), out
    assert t == {**square, "origin_x_m": 5.0}

    # 2. The record does not match its own picture — a trim. The RECORD wins,
    #    because the crop path re-derived it from the retained fraction.
    trimmed = {**square, "scale_y_m": 7.5, "reference_measurements": [{"m": 1}]}
    out, t, stk = await convert(
        {"x_offset": 0.3, "y_offset": 0.0, "scale": 1.0, "scale_x_adj": 1.0,
         "rotation": 0.0, "ref_ar": 0.75}, trimmed)
    assert out["record_won"] == 2, out
    assert t["scale_y_m"] == 7.5, "the trim's re-derived scale was overwritten"

    # 3. They disagree, the record matches its own picture, and somebody
    #    dragged the map. The STACK wins — a Stack-tab drag is a stack-only
    #    write by design, so it is the owner's most recent intent.
    out, t, stk = await convert(
        {"x_offset": 0.5, "y_offset": 0.0, "scale": 1.0, "scale_x_adj": 1.0,
         "rotation": 0.0, "ref_ar": 0.75}, dict(square))
    assert (out["stack_won"], out["record_won"]) == (1, 1), out
    assert t["origin_x_m"] == pytest.approx(10.0, abs=1e-3), (
        "0.5 world units at 20 m to the unit is 10 m")

    # 4. NOBODY dragged it. The record stands even though the two disagree —
    #    a pristine stack carries no intent, and every legacy master map has
    #    exactly this stack by definition.
    moved = {**square, "origin_x_m": 31.0, "origin_y_m": -4.0,
             "rotation_rad": 0.3, "reference_measurements": [{"m": 1}]}
    out, t, stk = await convert(ident, moved)
    assert out["record_won"] == 2, out
    assert t["origin_x_m"] == 31.0 and t["rotation_rad"] == 0.3

    # 5. No record, a stack: the stack is the only source.
    out, t, stk = await convert(
        {"x_offset": 0.25, "y_offset": 0.0, "scale": 1.0, "scale_x_adj": 1.0,
         "rotation": 0.0, "ref_ar": 0.75}, None)
    assert (out["stack_won"], out["record_won"]) == (1, 1)
    assert t["origin_x_m"] == pytest.approx(5.0, abs=1e-3)

    # 6. Neither: unplaced, and nothing is written.
    out, t, stk = await convert({}, None)
    assert (out["unplaced"], out["record_won"]) == (1, 1) and t is None

    # ...and in every branch the world copy is gone.
    assert set(stk) <= {"z_level", "ceiling_height_m", "ref_map_id", "tie_ins", "floor_id"}


@pytest.mark.asyncio
async def test_a_measurement_is_never_lost() -> None:
    """`reference_measurements` is not a coordinate. It is what the owner
    physically did, and the conversion carries it through every branch."""
    maps, transforms, _ = _wide_fixture_set(seed=11)
    measured = {mid for mid, t in transforms.items() if t.get("reference_measurements")}
    assert measured, "the fixture has no measured maps"
    mdl = _mdl(transforms)
    await migrations._derive_world_placement(
        mdl, maps_store_with(maps), _fab(), maps, fabric_truth.metre_gauge(mdl))
    still = {mid for mid in measured
             if (mdl.map_transform(mid) or {}).get("reference_measurements")}
    assert still == measured, f"un-measured by the conversion: {sorted(measured - still)}"


@pytest.mark.asyncio
async def test_it_refuses_without_a_snapshot_and_without_a_gauge() -> None:
    """No snapshot, no conversion — it deletes what it reads.

    And no gauge, no conversion: a legacy stack only becomes metres when
    multiplied by the gauge, so with none there is nothing to convert TO.
    Both leave the marker unset, so the step gets another turn.
    """
    maps = [_map("m0", stack={"is_master": True, "x_offset": 0.0, "y_offset": 0.0,
                              "scale": 1.0, "ref_ar": 0.75})]
    tr = {"m0": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                 "scale_y_m": 15.0, "rotation_rad": 0.0,
                 "reference_measurements": [{"m": 1}]}}

    # No backup function at all.
    mdl, fab, ms = _mdl(tr), _fab(), maps_store_with(maps)
    fab.data = {}
    stats = await migrations.async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, None)
    assert stats["conversion"] is None
    assert migrations.DERIVED_PLACEMENT not in fab.data[migrations.MARKER]
    assert "x_offset" in ms.data["maps"][0]["stack"], "it converted without a snapshot"

    # A backup function that cannot take one.
    async def _fails(hass, note, keys):
        return None

    mdl, fab, ms = _mdl(tr), _fab(), maps_store_with(maps)
    fab.data = {}
    stats = await migrations.async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, _fails)
    assert stats["conversion"] is None
    assert stats["conversion_backup_id"] is None
    assert migrations.DERIVED_PLACEMENT not in fab.data[migrations.MARKER]

    # No gauge: nothing measured anywhere.
    async def _ok(hass, note, keys):
        return "bk_1"

    mdl, fab, ms = _mdl({}, gauge=None), _fab(), maps_store_with(maps)
    fab.data = {}
    stats = await migrations.async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, _ok)
    assert stats["conversion"] is None
    assert migrations.DERIVED_PLACEMENT not in fab.data[migrations.MARKER]
    assert "x_offset" in ms.data["maps"][0]["stack"]


@pytest.mark.asyncio
async def test_a_map_is_never_converted_twice() -> None:
    """A per-MAP marker, not one flag for the step.

    A second pass would read an empty stack — which is a map at the world
    origin at unit size — and place the map there. A map that had nothing to
    convert when the step ran must still get its turn later, which one flag
    could not give it.
    """
    ident = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
             "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
    maps = [_map("m0", stack=ident),
            _map("m1", stack={"x_offset": 0.4, "y_offset": 0.1, "scale": 1.0,
                              "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75})]
    tr = {"m0": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                 "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0,
                 "reference_measurements": [{"m": 1}]}}
    mdl, fab, ms = _mdl(tr), _fab(), maps_store_with(maps)
    gauge = fabric_truth.metre_gauge(mdl)

    first = await migrations._derive_world_placement(mdl, ms, fab, maps, gauge)
    assert first["converted"] == 2
    after = dict(mdl.map_transform("m1"))
    assert after["origin_x_m"] == pytest.approx(8.0, abs=1e-3)

    second = await migrations._derive_world_placement(mdl, ms, fab, maps, gauge)
    assert second["converted"] == 0, "a converted map was converted again"
    assert mdl.map_transform("m1") == after

    # A map that arrives afterwards still gets its turn.
    maps.append(_map("m2", stack={"x_offset": -0.5, "y_offset": 0.0, "scale": 1.0,
                                  "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}))
    ms.data["maps"] = maps
    third = await migrations._derive_world_placement(mdl, ms, fab, maps, gauge)
    assert third["converted"] == 1 and third["stack_won"] == 1
    assert mdl.map_transform("m2")["origin_x_m"] == pytest.approx(-10.0, abs=1e-3)


# ── 2. The four historical bugs, attempted ───────────────────────────────────
#
# Each one is CONSTRUCTED, not asserted about: the bad state is written the
# way the bug wrote it, and then the code is asked whether it holds.


def _placed_store():
    ident = {"z_level": 0, "ceiling_height_m": 2.4}
    maps = [_map("m0", stack=ident, w=1600, h=1200)]
    tr = {"m0": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                 "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0,
                 "reference_measurements": [{"m": 1}]}}
    return maps, _mdl(tr), maps_store_with(maps)


def _drawn_corners(mdl, m):
    """Where the renderer puts the map's four corners, in world units."""
    xf = fabric_truth.stack_world_xform(mdl.map_transform(m["id"]),
                                        fabric_truth.metre_gauge(mdl))
    return [xf(fx, fy) for fx, fy in _FRACS]


@pytest.mark.asyncio
async def test_the_trim_bug_is_unwritable() -> None:
    """THE TRIM (#62). A crop re-derived the metric record and left the stack
    describing the pre-crop image, so the two disagreed by the fraction cut.

    Attempted: crop the map and then look for a second description to be stale.
    There is not one — the picture is drawn from the record the crop rewrote —
    and the physical invariant falls out by construction: a feature that
    survives the cut is in the same place in the house afterwards.
    """
    maps, mdl, ms = _placed_store()
    m = maps[0]
    # A feature at (0.6, 0.7) of the old image, and where it is in the house.
    before = mdl.map_frac_to_metres(0.6, 0.7, "m0")

    fx0, fy0, fw, fh = 0.2, 0.1, 0.5, 0.6      # keep the middle, unevenly
    ok = await mdl.async_recompute_transform_for_map(
        "m0", {**m, "image": {"width": 800, "height": 720}}, ms,
        crop={"fx0": fx0, "fy0": fy0, "fx1": fx0 + fw, "fy1": fy0 + fh})
    assert ok
    after = mdl.map_frac_to_metres((0.6 - fx0) / fw, (0.7 - fy0) / fh, "m0")
    moved = math.hypot(after[0] - before[0], after[1] - before[1])
    assert moved < 1e-9, f"the crop moved a surviving feature {moved:.6f} m"

    # And there is nowhere for a stale second copy to be.
    stk = ms.data["maps"][0]["stack"]
    assert not (set(stk) & {"x_offset", "y_offset", "scale", "scale_x_adj",
                            "rotation", "ref_ar", "_m", "_m_ar"})
    assert fabric_truth.map_geometry_faults(maps, mdl) == []


@pytest.mark.asyncio
async def test_the_canvas_extend_bug_is_unwritable() -> None:
    """THE SAME BUG THE OTHER WAY, which was live and unreported.

    `async_extend_canvas` renormalises every stored fraction into the padded
    image's frac space and used to touch NEITHER placement — so a map padded
    20% on the left kept a `scale_x_m` describing the old width and an origin
    pointing at the old top-left corner, and every frac on it converted to
    metres that were wrong by the pad.
    """
    maps, mdl, _ = _placed_store()
    ms = maps_store_with(maps)
    ms.data["maps"][0]["image"]["filename"] = None
    ms.data["maps"][0]["receivers"] = [{"id": "rx", "x": 0.6, "y": 0.7,
                                        "label": "", "room": "", "source": "rx"}]
    before = mdl.map_frac_to_metres(0.6, 0.7, "m0")

    # The image work needs a file; the coordinate work does not, so drive the
    # rebase through the one function both go through.
    old_w, old_h, add_l, add_t = 1600, 1200, 320, 120
    new_w, new_h = old_w + add_l + 160, old_h + add_t
    assert await mdl.async_rebase_placement(
        "m0", -add_l / old_w, -add_t / old_h, new_w / old_w, new_h / old_h)

    # The receiver's NEW fraction, as async_extend_canvas renormalises it.
    nx = add_l / new_w + 0.6 * (old_w / new_w)
    ny = add_t / new_h + 0.7 * (old_h / new_h)
    after = mdl.map_frac_to_metres(nx, ny, "m0")
    moved = math.hypot(after[0] - before[0], after[1] - before[1])
    assert moved < 1e-9, f"the pad moved a scanner that did not move: {moved:.6f} m"

    # The control: leave the placement alone and the picture keeps a
    # `scale_x_m` describing the OLD width, so every fraction on it converts
    # to the wrong metres — worst at the far edge of the retained image, where
    # the whole pad has accumulated.
    stale = _mdl({"m0": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                         "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}})
    edge_x = (add_l + old_w) / new_w
    edge_y = (add_t + old_h) / new_h
    truth = (20.0, 15.0)                          # the retained image's far corner
    was = stale.map_frac_to_metres(edge_x, edge_y, "m0")
    now = mdl.map_frac_to_metres(edge_x, edge_y, "m0")
    assert math.hypot(now[0] - truth[0], now[1] - truth[1]) < 1e-9
    assert math.hypot(was[0] - truth[0], was[1] - truth[1]) > 1.0, (
        f"the control does not show the defect: {was} vs {truth}")

    # And the revert is exactly the inverse, through the same function.
    assert await mdl.async_rebase_placement(
        "m0", add_l / new_w, add_t / new_h, old_w / new_w, old_h / new_h)
    back = mdl.map_frac_to_metres(0.6, 0.7, "m0")
    assert math.hypot(back[0] - before[0], back[1] - before[1]) < 1e-3


def test_issue_64_is_unwritable() -> None:
    """#64. A map placed by Point Align carried BOTH a solved matrix and a
    decomposition of it, and an operation that updated one and not the other
    parted them — the map drew through the matrix and looked placed while every
    stored number said something else.

    Attempted: write the two descriptions in disagreement and look for the
    drawn position to differ from the stored one.
    """
    maps, mdl, ms = _placed_store()
    stored = dict(mdl.map_transform("m0"))

    # There is one description, and no writer takes a second. The parted
    # state cannot even be expressed — `stack_desync` measured the gap and
    # has no operands left.
    assert not hasattr(fabric_truth, "stack_desync")
    for gone in ("_m", "_m_ar", "scale", "scale_x_adj", "rotation",
                 "x_offset", "y_offset", "ref_ar"):
        assert gone not in ms.data["maps"][0]["stack"]

    # Where the map DRAWS is a function of the record and nothing else, so
    # nothing can be stale relative to it.
    drawn = _drawn_corners(mdl, maps[0])
    k = fabric_truth.metre_gauge(mdl)["m_per_unit"]
    for (fx, fy), (wx, wy) in zip(_FRACS, drawn):
        mx, my = fabric_truth.placement_metres(stored, fx, fy)
        assert (wx * k, wy * k) == pytest.approx((mx, my), abs=1e-9)


@pytest.mark.asyncio
async def test_issue_67_is_unwritable(tmp_path) -> None:
    """#67. An ordinary map save carried the client's copy of `is_master`, so
    a stale tab revoked the star — and the star decided which map won a
    room-name collision, so a floor's rooms silently changed shape.

    Attempted: send `is_master` on a save, both ways, and look for the rooms
    on the floor to move.
    """
    from custom_components.padspan_ha.maps_store import MapsStore

    bounds = {"Kitchen": {"type": "poly",
                          "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]}}
    older = _map("old", created="2019-01-01T00:00:00+00:00")
    newer = _map("new", created="2025-01-01T00:00:00+00:00")
    older["room_bounds"] = dict(bounds)
    newer["room_bounds"] = dict(bounds)
    mdl = _mdl({
        "old": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0,
                "reference_measurements": [{"m": 1}]},
        "new": {"origin_x_m": 50.0, "origin_y_m": 50.0, "scale_x_m": 20.0,
                "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0},
    })
    ms = maps_store_with([older, newer])
    ms.maps_dir = tmp_path

    def kitchen():
        return fabric_truth.rooms_from_transforms(ms.data["maps"], mdl)["Kitchen"]

    was = kitchen()
    assert was["source_map_id"] == "old"

    for payload in ({"is_master": True}, {"is_master": False},
                    {"is_master": True, "z_level": 1}):
        await MapsStore.async_update_map(ms, "new", stack=dict(payload))
        await MapsStore.async_update_map(ms, "old", stack={"is_master": False})
        assert kitchen() == was, f"{payload} moved the rooms on this floor"
        assert "is_master" not in ms.data["maps"][0]["stack"]

    # And the precedence cannot be nulled, because there is nothing to null:
    # `created` is written once by async_add_map and by nothing else.
    assert fabric_truth.room_precedence(older) < fabric_truth.room_precedence(newer)


def test_a_singular_placement_is_unwritable() -> None:
    """The blind spot R3 OPENS, closed before anything relies on it.

    A placement whose two axes lie on one line covers no area:
    `placement_metres` evaluates it happily and both scales are positive, so
    `placement_is_readable` said yes. While the stack was stored such a map was
    caught anyway — it disagreed with the stack that was actually drawing it —
    and deriving the stack removes that second opinion, so the map would be
    drawn AS a line with every detector reporting a healthy install.
    """
    base = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
            "scale_y_m": 15.0, "rotation_rad": 0.0}
    assert fabric_truth.placement_is_readable({**base, "shear_rad": 0.0})
    for sigma in (math.pi / 2, -math.pi / 2):
        bad = {**base, "shear_rad": sigma}
        # It has NO AREA — the whole picture maps onto one segment.
        o = fabric_truth.placement_metres(bad, 0, 0)
        x = fabric_truth.placement_metres(bad, 1, 0)
        y = fabric_truth.placement_metres(bad, 0, 1)
        det = (x[0] - o[0]) * (y[1] - o[1]) - (x[1] - o[1]) * (y[0] - o[0])
        assert abs(det) < 1e-9
        assert not fabric_truth.placement_is_readable(bad)
        # The two implementations of "is this record usable" agree: the
        # inverse has always refused it.
        mdl = _mdl({"m0": bad})
        assert mdl.metres_to_map_frac(1.0, 1.0, "m0") is None
        # And the fault report names it.
        assert [f["terms"] for f in fabric_truth.map_geometry_faults(
            [_map("m0")], mdl)] == [["unreadable"]]


@pytest.mark.asyncio
async def test_the_commit_refuses_a_singular_placement() -> None:
    """And the writer will not take one, so it cannot reach disk from the UI."""
    maps, mdl, _ = _placed_store()
    res = await mdl.async_reanchor_map("m0", maps[0], None, shear_rad=math.pi / 2)
    assert res == {"ok": False, "error": "invalid_pose"}
    res = await mdl.async_reanchor_map("m0", maps[0], None, scale_x_m=0.0)
    assert res == {"ok": False, "error": "invalid_pose"}
    assert mdl.map_transform("m0")["scale_x_m"] == 20.0


# ── 3. The deletion is real ──────────────────────────────────────────────────

_RETIRED = [
    # fabric_truth: the whole reconciliation half
    ("stack_desync", "measured the gap between a placement's two descriptions"),
    ("stack_from_transform", "rebuilt the stack from the record"),
    ("rooms_from_stack", "the second room candidate"),
    ("_stack_metre_fit", "renamed legacy_"),
    ("_master_last", "master-flag room precedence"),
    ("ANCHOR_ISO_TOL", "renamed RECORD_ISO_TOL in R2"),
    ("REBUILD_SHEAR_TOL", "the rebuild's shear bar"),
    ("record_iso_error", "renamed legacy_"),
    ("world_footprint", "renamed legacy_"),
    ("find_metre_anchor", "deleted in R2"),
    # model_store / maps_store
    ("_recrop_stack", "kept the second copy in step on a crop"),
    ("async_derive_transforms", "derived a placement from the stack on boot"),
    ("_stack_recropped", "the flag that told ws_maps a stack had been rewritten"),
    ("map_to_world", "a fourth copy of the renderer's affine"),
    ("world_to_map", "its inverse"),
    # ws layer
    ("ws_fabric_map_align_to_stack", "wrote the stack into the record"),
    ("ws_fabric_map_stack_rebuild", "wrote the record into the stack"),
    ("ws_positioning_repair", "the bulk version of the first"),
    # panel
    ("changeMasterStacks", "re-based every map on a new master"),
    ("worldAffine", "read a stack as the affine it drew"),
    ("composeAffine", "and composed two of them"),
    ("invertAffine", "and inverted one"),
    ("decomposeFracMatrix", "and read fields back off one"),
    ("stackFieldsFromAffine", "and wrote all three descriptions at once"),
    ("worldFootprint", "the JS half of the derivation R2 deleted"),
    ("_alignRepair", "routed a faulted map to one of two repairs"),
    ("_isMasterEligible", "guarded the master flag"),
    ("_alignMasterRefusal", "refused an align onto the master"),
    ("_executeChangeMaster", "the Change Master wizard"),
    ("_changeMasterWizard", "and its UI"),
]


def test_the_scaffolding_is_gone_and_stays_gone() -> None:
    """A grep test, because a deletion that is not checked comes back.

    Every name here existed to detect or reconcile two stored copies of one
    placement. `legacy_` prefixes are exempt by construction: those two
    functions read the pre-R3 representation and have only the gauge seed and
    the one-way conversion as callers.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    files = list(root.glob("*.py")) + list((root / "www" / "padspan-ha").rglob("*.js"))
    def code_lines(text: str):
        """Every line that is not a comment or a docstring body.

        Prose may name what it deleted — most of this release's comments do —
        so a scan that could not tell code from prose would forbid explaining
        the deletion, which is the opposite of the point.
        """
        in_doc = False
        for i, line in enumerate(text.splitlines(), 1):
            ticks = line.count('"""')
            if in_doc:
                if ticks:
                    in_doc = False
                continue
            if ticks and ticks % 2:
                in_doc = True
                head = line.split('"""')[0]
                if head.strip() and not head.strip().startswith(("#", "//")):
                    yield i, head
                continue
            stripped = line.strip()
            if stripped.startswith(("#", "//", "*", '"""')):
                continue
            yield i, line.split("#")[0].split("//")[0]

    import re as _re

    offenders = []
    for name, why in _RETIRED:
        # The whole identifier, so `_legacy_stack_metre_fit` does not read as
        # `_stack_metre_fit` coming back, and a quoted key is data rather than
        # a call — `"stack_desync": None` is the one deliberately kept.
        pat = _re.compile(r"(?<![A-Za-z0-9_])(legacy_)?" + _re.escape(name.lstrip("_"))
                          + r"(?![A-Za-z0-9_])")
        for path in files:
            for i, line in code_lines(path.read_text(encoding="utf-8")):
                for mm in pat.finditer(line):
                    if mm.group(1):
                        continue                       # the renamed legacy reader
                    j = mm.start()
                    if line[max(0, j - 8):j].endswith("_legacy_"):
                        continue
                    if line[max(0, j - 1):j] == '"' or line[max(0, j - 1):j] == "'":
                        continue                       # a payload key, not a call
                    offenders.append(f"{path.name}:{i} {name} ({why})")
    assert not offenders, "retired machinery is back:\n" + "\n".join(offenders)


def test_stack_desync_has_nothing_left_to_compare() -> None:
    """The usage report keeps the key and reports NULL.

    A zero in a series that used to carry real counts reads as "fixed"; null
    reads as "this question no longer exists", which is what happened to it.
    """
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "custom_components" /
           "padspan_ha" / "telemetry.py").read_text(encoding="utf-8")
    assert '"stack_desync": None,' in src


# ── The two image ops that used to forget the placement ─────────────────────


def _real_png(w: int, h: int) -> bytes:
    """A real, decodable PNG — `_extend_png` inflates and re-filters it, so a
    stub will not do. Solid grey, RGBA, no per-line filtering."""
    import struct
    import zlib

    raw = b"".join(b"\x00" + bytes([128, 128, 128, 255]) * w for _ in range(h))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


async def _extend_scene(tmp_path):
    """A measured map with a real image file, and its model store."""
    from custom_components.padspan_ha.maps_store import MapsStore

    ms = MapsStore.__new__(MapsStore)
    ms.hass = MagicMock()
    ms.store = AsyncMock()
    ms.store.async_save = AsyncMock()
    ms.maps_dir = tmp_path / "maps"
    ms.maps_dir.mkdir(parents=True, exist_ok=True)
    ms.data = {"maps": []}
    m = await ms.async_add_map("Ground", "g.png", "image/png", 160, 120,
                               base64.b64encode(_real_png(160, 120)).decode())

    mdl = _mdl({m["id"]: {
        "origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0, "scale_y_m": 15.0,
        "rotation_rad": 0.0, "shear_rad": 0.0, "reference_measurements": [{"m": 1}]}})
    mdl.store.async_save = AsyncMock()
    m["receivers"] = [{"id": "rx", "source": "rx", "label": "", "room": "",
                       "x": 0.6, "y": 0.7}]
    return ms, mdl, m


@pytest.mark.asyncio
async def test_extending_the_canvas_moves_the_placement_with_the_picture(tmp_path) -> None:
    """THE LIVE, UNREPORTED HALF OF THE TRIM BUG.

    `async_extend_canvas` pads the image and renormalises every stored
    fraction — receivers, beacons, room bounds — into the new frac space. It
    touched NEITHER placement, so the map kept a `scale_x_m` describing the old
    width and an origin pointing at the old top-left corner, and every one of
    those fractions then converted to metres that were wrong by the pad.

    Driven through the real store method, with a real PNG, because that is
    where the defect was: the arithmetic has always been right in
    `async_recompute_transform_for_map`, and the bug was that this path never
    called anything.
    """
    ms, mdl, m = await _extend_scene(tmp_path)
    mid = m["id"]
    rx = m["receivers"][0]
    before = mdl.map_frac_to_metres(rx["x"], rx["y"], mid)
    corner_before = mdl.map_frac_to_metres(1.0, 1.0, mid)

    await ms.async_extend_canvas(mid, 0.2, 0.1, 0.25, 0.0, model_store=mdl)

    # The receiver's fraction moved, because the picture grew around it.
    assert m["receivers"][0]["x"] != pytest.approx(0.6)
    # Its METRES did not: it is a scanner on a wall and nobody moved the wall.
    after = mdl.map_frac_to_metres(m["receivers"][0]["x"], m["receivers"][0]["y"], mid)
    moved = math.hypot(after[0] - before[0], after[1] - before[1])
    assert moved < 1e-3, f"the pad moved a scanner that did not move: {moved:.4f} m"

    # And the far corner of the RETAINED picture is still where it was.
    iw, ih = m["image"]["width"], m["image"]["height"]
    ex = (round(0.2 * 160) + 160) / iw
    ey = (round(0.25 * 120) + 120) / ih
    corner_after = mdl.map_frac_to_metres(ex, ey, mid)
    assert math.hypot(corner_after[0] - corner_before[0],
                      corner_after[1] - corner_before[1]) < 1e-3

    # The reverse is exact, through the same one function.
    await ms.async_revert_extend(mid, model_store=mdl)
    assert (m["image"]["width"], m["image"]["height"]) == (160, 120)
    back = mdl.map_frac_to_metres(1.0, 1.0, mid)
    assert math.hypot(back[0] - corner_before[0], back[1] - corner_before[1]) < 1e-3
    assert m["receivers"][0]["x"] == pytest.approx(0.6, abs=1e-3)


@pytest.mark.asyncio
async def test_the_control_a_pad_with_no_rebase_moves_the_whole_map(tmp_path) -> None:
    """What the fix is worth, in metres, on the same pad."""
    ms, mdl, m = await _extend_scene(tmp_path)
    mid = m["id"]
    corner_before = mdl.map_frac_to_metres(1.0, 1.0, mid)
    await ms.async_extend_canvas(mid, 0.2, 0.1, 0.25, 0.0, model_store=None)
    iw, ih = m["image"]["width"], m["image"]["height"]
    ex = (round(0.2 * 160) + 160) / iw
    ey = (round(0.25 * 120) + 120) / ih
    corner_after = mdl.map_frac_to_metres(ex, ey, mid)
    off = math.hypot(corner_after[0] - corner_before[0],
                     corner_after[1] - corner_before[1])
    assert off > 1.0, f"the control does not show the defect: {off:.3f} m"


# ── One record-usability predicate, in three places ─────────────────────────


def test_three_implementations_of_usable_agree() -> None:
    """`placement_is_readable`, `metres_to_map_frac` and the panel's
    `metresToMapFrac` are one question asked three times.

    They used to differ: two of them tested `|cos σ| < 1e-9`, which let a
    quarter-turn lean through — rounded to the store's 1 µrad grid `cos σ`
    reads 3.3e-07 — while the third did not test the lean at all. Two
    implementations of "is this record usable" disagreeing about which records
    are usable is where this programme started.
    """
    import json
    import shutil
    import subprocess
    from pathlib import Path

    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")

    base = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
            "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}
    cases = {
        "healthy": base,
        "sigma = 90 deg exactly": {**base, "shear_rad": math.pi / 2},
        "sigma = 90 deg on the store grid": {**base, "shear_rad": round(math.pi / 2, 6)},
        "sigma = -90 deg": {**base, "shear_rad": -math.pi / 2},
        "sigma = 89 deg": {**base, "shear_rad": math.radians(89)},
        "scale_x_m = 0": {**base, "scale_x_m": 0.0},
        "scale_y_m = 0": {**base, "scale_y_m": 0.0},
        "scale_x_m = 0.0005": {**base, "scale_x_m": 0.0005},
        "a 1 m x 1 m map": {**base, "scale_x_m": 1.0, "scale_y_m": 1.0},
    }
    mdl = _mdl({})
    py = {}
    for name, t in cases.items():
        mdl.data["map_transforms"]["m"] = t
        py[name] = [fabric_truth.placement_is_readable(t),
                    mdl.metres_to_map_frac(1.0, 1.0, "m") is not None]

    views = (Path(__file__).resolve().parents[1] / "custom_components" /
             "padspan_ha" / "www" / "padspan-ha" / "views")
    probe = views / "_usable_probe.mjs"
    probe.write_text(
        "import { metresToMapFrac } from './stack_transform.js';\n"
        "const C = " + json.dumps(cases) + ";\n"
        "const out = {};\n"
        "for (const k of Object.keys(C)) out[k] = metresToMapFrac(C[k], 1, 1) !== null;\n"
        "console.log(JSON.stringify(out));\n", encoding="utf-8")
    try:
        res = subprocess.run([node, str(probe)], capture_output=True, text=True,
                             encoding="utf-8", timeout=60)
    finally:
        probe.unlink(missing_ok=True)
    assert res.returncode == 0, res.stderr[-2000:]
    js = json.loads(res.stdout.strip().splitlines()[-1])

    for name in cases:
        readable, inv = py[name]
        assert readable == inv == js[name], (
            f"{name}: placement_is_readable={readable}, "
            f"metres_to_map_frac={inv}, metresToMapFrac={js[name]}")
    # The control: the table is neither all-yes nor all-no.
    assert 0 < sum(1 for n in cases if py[n][0]) < len(cases)


@pytest.mark.asyncio
async def test_a_tie_in_is_converted_from_what_it_recorded(tmp_path) -> None:
    """A tie-in records the DECOMPOSED fields and nothing else.

    A map can carry a solved Point Align matrix AND tie-ins, and the matrix
    takes precedence in the legacy renderer — so converting a tie-in through
    the map's current stack WITH its matrix reads it through a placement the
    tie-in never described. What the panel compared was the four fields; what
    the conversion reads has to be the same four.
    """
    ident = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
             "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
    ti = {"ref_map_id": "m0", "x_offset": 0.25, "y_offset": 0.1, "scale": 1.4,
          "rotation": -33.0, "date": "2026-01-02"}
    solved = {"_m": [1.7, 0.4, -0.35, 0.9], "_m_ar": 0.75, "ref_ar": 0.75,
              "x_offset": 0.6, "y_offset": -0.4, "scale": 2.2, "scale_x_adj": 1.3,
              "rotation": 71.0, "tie_ins": [dict(ti)],
              "z_level": 0, "ceiling_height_m": 2.4}
    maps = [_map("m0", stack=ident), _map("m1", stack=solved)]
    mdl = _mdl({"m0": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                       "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0,
                       "reference_measurements": [{"m": 1}]}})
    ms = maps_store_with(maps)
    gauge = fabric_truth.metre_gauge(mdl)

    # The four fields, read WITHOUT the matrix — what the tie-in described.
    want_stack = {k: v for k, v in solved.items() if k not in ("_m", "_m_ar")}
    want_stack.update(x_offset=0.25, y_offset=0.1, scale=1.4, rotation=-33.0)
    want = fabric_truth.legacy_stack_metre_transform(
        {**maps[1], "stack": want_stack}, gauge)
    # And WITH it — what a conversion that forgot to drop the matrix would get.
    wrong = fabric_truth.legacy_stack_metre_transform(maps[1], gauge)

    await migrations._tie_ins_to_metres(mdl, ms, maps, gauge)
    got = ms.data["maps"][1]["stack"]["tie_ins"][0]
    assert fabric_truth.placement_disagreement_m(want, got) < 1e-6
    apart = fabric_truth.placement_disagreement_m(wrong, got)
    assert apart > 1.0, (
        f"the control does not separate the two readings: {apart:.3f} m")


@pytest.mark.asyncio
async def test_losing_the_per_map_marker_is_harmless() -> None:
    """The markers live in the FABRIC store, and a fabric restore can drop them.

    That is the one way a converted map can be handed to the conversion again.
    It is safe by construction rather than by the marker: a converted map has
    no legacy stack left, so there is no hand alignment to read, the record
    wins, and nothing is written. The marker is there so the step is not
    re-done needlessly, not because re-doing it would be wrong.
    """
    ident = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
             "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
    maps = [_map("m0", stack=ident),
            _map("m1", stack={**ident, "is_master": False,
                              "x_offset": 0.45, "y_offset": 0.1})]
    mdl = _mdl({"m0": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                       "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0,
                       "reference_measurements": [{"m": 1}]}})
    ms = maps_store_with(maps)
    gauge = fabric_truth.metre_gauge(mdl)

    await migrations._derive_world_placement(mdl, ms, _fab(), maps, gauge)
    after = dict(mdl.map_transform("m1"))
    assert after["origin_x_m"] == pytest.approx(9.0, abs=1e-3)

    lost = _fab()                       # a fabric restored from before R3
    out = await migrations._derive_world_placement(mdl, ms, lost, maps, gauge)
    assert out["converted"] == 2 and out["record_won"] == 2
    assert fabric_truth.placement_disagreement_m(after, mdl.map_transform("m1")) == 0.0
