# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A map's placement changes in exactly ONE place, per store.

`map_transforms` had four writers: `async_set_map_transform`, which owns the
pose rules, and three call sites that assigned `map_transforms[mid] = {...}`
straight past it — the build-from-maps derivation, the image-replacement
recompute and the re-anchor preflight. `maps[].stack` had two: the maps
store's own `async_update_map`, which clamps and preserves, and
`ws_fabric_map_stack_rebuild` assigning `m["stack"]` and saving.

Every desync this codebase has shipped is two copies of a placement
disagreeing, and a second writer is how the second copy gets made. Concretely:
`shear_rad` had to be remembered at four separate sites or it silently
vanished on whichever one forgot it, and "what can move a map?" was a question
with four answers to check.

The check is a MUTATION, not a grep: the one writer is replaced with a
do-nothing, each path is run, and the store must come back untouched. A grep
for `transforms[` would pass on a path that mutated a stored record's fields
in place; a deep comparison of the whole dict does not.

That shape has a blind spot, and the two re-anchor ROLLBACKS sat in it: the
value a rollback writes is the value already in the store, so a bypass and the
real writer leave identical bytes and no comparison can separate them. Those
use the same mutation from the other side — the writer still writes, but it
FINGERPRINTS what it stores, and a record that arrives without the fingerprint
arrived past it.

Confirmed as cover by mutation. Replacing
`self._put_map_transform(map_id, old_t)` with
`self.data.setdefault("map_transforms", {})[map_id] = old_t` at the
points-out-of-range rollback fails
`test_the_reanchor_preflight_rollback_goes_through_the_one_writer`, and at the
exception rollback fails `test_the_reanchor_failure_rollback_goes_through_the_
one_writer` — one test each, and nothing else in the suite moves.
"""

from __future__ import annotations

import copy
import math
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import seed_world_gauge


_MEASURED = {
    "origin_x_m": 3.0, "origin_y_m": -1.0, "scale_x_m": 20.0, "scale_y_m": 15.0,
    "rotation_rad": 0.25, "shear_rad": -0.06, "floor_id": "main",
    "origin_anchored": True,
    "reference_measurements": [{"p1": [0.1, 0.5], "p2": [0.6, 0.5],
                               "distance_m": 10.0, "px_per_meter": 80.0}],
}


def _store(transforms: dict | None = None) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.store.async_save = AsyncMock()
    s.data = {"map_transforms": copy.deepcopy(transforms or {"m1": _MEASURED})}
    seed_world_gauge(s, [_map()])
    s.fabric = None
    return s


def _map(mid: str = "m1") -> dict:
    return {
        "id": mid, "floor_id": "main", "name": "Ground",
        "image": {"width": 1600, "height": 1200},
        "stack": {"is_master": True, "scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
                  "rotation": 12.0, "x_offset": 0.0, "y_offset": 0.0,
                  "z_level": 0, "ceiling_height_m": 2.4},
        "calibration": {"mode": "manual", "px_per_meter": 80.0, "reference_points": []},
        "receivers": [], "beacons": [],
    }


def _maps_store(maps: list[dict]):
    ms = MagicMock()
    ms.data = {"maps": maps}
    ms.get_map = lambda mid: next((m for m in maps if m.get("id") == mid), None)
    ms.store = AsyncMock()
    return ms


# ── map_transforms ───────────────────────────────────────────────────────────

async def _set(s):
    await s.async_set_map_transform("m1", {**_MEASURED, "scale_x_m": 99.0}, reanchor=True)


async def _recompute(s):
    m = _map()
    await s.async_recompute_transform_for_map(
        "m1", m, _maps_store([m]), crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 1.0})


async def _reanchor(s):
    await s.async_reanchor_map("m1", _map(), None, origin_x_m=50.0, origin_y_m=50.0)


def _skewed_map() -> dict:
    """`_map()` with the solved affine step 9 reads the sign off."""
    m = _map()
    m["stack"]["rotation"] = 0
    m["stack"]["_m"] = [1.0, math.sin(math.radians(5)), 0.0,
                        math.cos(math.radians(5)) / 0.75]
    m["stack"]["_m_ar"] = 0.75
    return m


def _unsigned_lean() -> float:
    """The record as an install actually holds it: |σ|, left by the `abs()`
    that wrote the field before it had a sign.

    Computed rather than written down. Part of this fixture's lean is
    manufactured by its own anchor, so the magnitude is a property of the
    fixture and would go stale as a constant the moment either changed.
    """
    from custom_components.padspan_ha import fabric_truth

    m = _skewed_map()
    st = fabric_truth.legacy_stack_metre_transform(
        m, fabric_truth.measure_world_gauge([m], _store()))
    return round(abs(st["shear_rad"]), 6)


async def _migrate(s):
    """Step 9 of the upgrade, which EDITS σ on a record nothing else touches.

    The fifth path that puts a placement on disk, and it arrived after the
    parametrisation below was written — which is the shape of the problem:
    "what can move a map?" is only a question with one answer while every new
    answer is added to the list.
    """
    from custom_components.padspan_ha import fabric_truth
    from custom_components.padspan_ha.migrations import _backfill_shear_sign

    m = _skewed_map()
    anchor = fabric_truth.measure_world_gauge([m], s)
    assert anchor, "no metre anchor — the backfill cannot run"
    out = await _backfill_shear_sign(s, [m], anchor)
    assert out["shear_signed"] == 1, "the fixture no longer exercises the backfill"


_PATHS = [_set, _recompute, _reanchor, _migrate]
_PATH_IDS = ["set", "recompute-after-crop", "reanchor", "migration-backfill"]
# The backfill only writes a record whose σ is unsigned — that is the state it
# exists to repair — so that path starts from one.
_PATH_TRANSFORMS = {_migrate: {"m1": {**_MEASURED, "shear_rad": _unsigned_lean()}}}


@pytest.mark.asyncio
@pytest.mark.parametrize("run", _PATHS, ids=_PATH_IDS)
async def test_nothing_but_the_one_writer_touches_map_transforms(run) -> None:
    s = _store(_PATH_TRANSFORMS.get(run))
    await run(s)                       # unpatched: it really does write
    changed = copy.deepcopy(s.data["map_transforms"])

    s2 = _store(_PATH_TRANSFORMS.get(run))
    with patch.object(ModelStore, "_put_map_transform", lambda self, mid, t: t):
        before = copy.deepcopy(s2.data["map_transforms"])
        await run(s2)
        assert s2.data["map_transforms"] == before, (
            "this path still writes map_transforms without going through "
            "_put_map_transform — a second writer, and the second copy of a "
            "placement is where every desync in this codebase starts"
        )
    # …and the unpatched run has to have done something, or the check above
    # is passing because the path is a no-op on this fixture.
    assert changed != before, "the fixture no longer exercises this write path"


@pytest.mark.asyncio
@pytest.mark.parametrize("run", _PATHS, ids=_PATH_IDS)
async def test_every_writer_leaves_a_whole_placement_on_the_record(run) -> None:
    """Reaching the one writer is not the same as handing it a whole record.

    The test above is a mutation check: it proves each path goes THROUGH
    `_put_map_transform` and says nothing about what it puts there. A record
    is six numbers — origin, both scales, ρ and σ — and every one of these
    paths rebuilds one. Rebuilding it field by field is how σ went missing on
    whichever branch forgot it, and a re-anchor that rebuilt the record
    five-field moved a map leaning 5° by 1.31 m without changing its pose at
    all. So each path is asked what it wrote, not merely whether it wrote.

    `derive` is the one exception on σ, and honestly so: it only ever writes a
    map that HAS no placement to preserve, and it reads scale off px_per_meter
    and rotation off the stack. Absent is 0 there because 0 is what that
    derivation means.
    """
    s = _store(_PATH_TRANSFORMS.get(run))
    await run(s)
    for mid, t in s.data["map_transforms"].items():
        missing = [k for k in ("origin_x_m", "origin_y_m", "scale_x_m",
                               "scale_y_m", "rotation_rad") if k not in t]
        assert not missing, f"{mid} came back without {missing}"
        assert "shear_rad" in t or mid == "m2", (
            f"{mid} lost its lean: a placement rebuilt out of five of its six "
            "fields, which squares up every map whose axes are not square"
        )


@pytest.mark.asyncio
async def test_the_writer_is_reached_once_per_placement_written() -> None:
    """Not just "reached" — the record handed to it is the record stored."""
    s = _store()
    with patch.object(ModelStore, "_put_map_transform",
                      autospec=True, side_effect=ModelStore._put_map_transform) as spy:
        await s.async_set_map_transform("m1", {**_MEASURED, "scale_x_m": 99.0}, reanchor=True)
    assert spy.call_count == 1
    assert spy.call_args[0][2] is s.data["map_transforms"]["m1"]


def _stranding_cal() -> MagicMock:
    """A calibration store whose points the new pose strands off the map, so
    the preflight refuses and the rollback branch is entered.

    The parametrized case above runs `async_reanchor_map` with `cal_store=None`
    — `owned` is then 0, the guard cannot fire, and neither rollback is
    reached. It covers the swap-IN write and nothing else.
    """
    cal = MagicMock()
    cal.data = {"points": [{"map_id": "m1", "x_m": 3.0, "y_m": -1.0},
                           {"map_id": "m1", "x_m": 4.0, "y_m": -1.0}]}
    return cal


@pytest.mark.asyncio
async def test_the_reanchor_preflight_rollback_restores_the_pose() -> None:
    """Nothing is persisted unless the new pose keeps the pins on the map.

    Named for what it asserts. It used to be called "…goes through it too",
    which it never checked and structurally cannot: the rollback restores
    `old_t`, so a direct `map_transforms[mid] = old_t` leaves the store deep-
    equal to `before` and satisfies this assertion identically. Proving the
    rollback went through the one writer needs a writer that can be told
    apart from an assignment — see the test below.
    """
    s = _store()
    before = copy.deepcopy(s.data["map_transforms"])
    res = await s.async_reanchor_map("m1", _map(), _stranding_cal(),
                                     origin_x_m=9000.0, origin_y_m=9000.0)
    assert res["ok"] is False and res["error"] == "points_out_of_range"
    assert s.data["map_transforms"] == before, "the rollback did not restore the pose"


def _tagging_writer(self, map_id: str, transform: dict) -> dict:
    """`_put_map_transform`, with a fingerprint on everything it stores.

    The mutation check the parametrized test uses — stub the writer out and
    demand the store come back untouched — cannot see a ROLLBACK: the value a
    rollback writes is the value already there, so a direct assignment and the
    real writer leave identical bytes. Tagging is the same mutation from the
    other side: the writer still writes, but what it writes is recognisable,
    so a record that reaches the store without the tag came in past it.
    """
    out = {**transform, "_via_the_one_writer": True}
    self.data.setdefault("map_transforms", {})[str(map_id)] = out
    return out


@pytest.mark.asyncio
async def test_the_reanchor_preflight_rollback_goes_through_the_one_writer() -> None:
    """A temporary placement is still a placement.

    The re-anchor swaps the new pose in, measures the calibration pins under
    it and rolls back before any await. All three of those mutate
    `map_transforms`, and the two rollbacks were direct assignments — a
    mutation the one writer never saw, which is what makes an audit of "what
    can move a map?" unreliable even when the answer looks like one thing.
    """
    s = _store()
    with patch.object(ModelStore, "_put_map_transform", _tagging_writer):
        res = await s.async_reanchor_map("m1", _map(), _stranding_cal(),
                                         origin_x_m=9000.0, origin_y_m=9000.0)
    assert res["error"] == "points_out_of_range", "the rollback branch was not entered"
    assert s.data["map_transforms"]["m1"].get("_via_the_one_writer"), (
        "the points-out-of-range rollback assigns map_transforms itself"
    )


@pytest.mark.asyncio
async def test_the_reanchor_failure_rollback_goes_through_the_one_writer() -> None:
    """The second rollback, on the far side of the first await.

    A remap or re-derive that throws must not leave the new pose persisted
    over old fracs — the exact split-brain the action exists to prevent — so
    it restores the old placement, and that restore is a write like any other.
    """
    cal = MagicMock()
    cal.data = {"points": []}
    cal.async_remap_from_metres = AsyncMock(side_effect=RuntimeError("boom"))
    s = _store()
    with patch.object(ModelStore, "_put_map_transform", _tagging_writer):
        res = await s.async_reanchor_map("m1", _map(), cal,
                                         origin_x_m=5.0, origin_y_m=6.0)
    assert res["error"] == "remap_failed", "the failure rollback was not entered"
    assert s.data["map_transforms"]["m1"].get("_via_the_one_writer"), (
        "the exception rollback assigns map_transforms itself"
    )


# ── maps[].stack ─────────────────────────────────────────────────────────────
#
# There is no second placement to keep a second writer honest with. The stack
# holds z_level, ceiling_height_m, ref_map_id and tie_ins now, and
# `ws_fabric_map_stack_rebuild` — the one path that used to assign `m["stack"]`
# directly and skip `async_update_map`'s sanitiser — is deleted with the
# disagreement it repaired. That the sanitiser cannot be bypassed is checked
# where it belongs, in test_maps_store.py.
