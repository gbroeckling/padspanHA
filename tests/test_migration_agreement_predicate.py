# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The migration's agreement gate was blind to ρ and σ, and it is one-way.

R1 defined agreement ONCE — `placement_disagreements` / `placements_agree` —
because three sites had decided it independently and all three compared
FIELDS: origin and the two scales, four of the six a placement has. A fourth
site was left behind: `migrations._agrees`, a private four-field compare with
its own `_ORIGIN_TOL_M` and `_SCALE_TOL_FRAC`.

Measured on a 20 x 15 m map with an IDENTICAL origin and IDENTICAL scales:

    half turn (ρ = π)        _agrees=True    50.00 m apart
    mirror    (σ = π)        _agrees=True    30.00 m apart
    quarter turn (ρ = π/2)   _agrees=True    35.36 m apart
    5° lean   (σ)            _agrees=True     1.31 m apart

That is not a cosmetic miss, because of WHERE it sat. Step 1 of the migration
is the one-shot repair for a placement that disagrees with the hand-tuned
stack, this gate is what decides a map does not need it, and the step is
MARKER-GUARDED: a map waved through as `maps_already_correct` has
PHOTO_DIVORCE written for it and never gets another turn. The repair closed
permanently on exactly the placements that were most wrong.

Fixed BEFORE R2's own tests were written, so that what they measure is real.
"""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.conftest import migration_backup, maps_store_with

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha import migrations
from custom_components.padspan_ha.migrations import MARKER, async_run_photo_divorce
from custom_components.padspan_ha.model_store import ModelStore

_SQUARE = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
           "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}

# Each of these differs from _SQUARE in ρ or σ ALONE, so every field the old
# gate compared is bit-identical, and the metres are what the map is out by.
_INVISIBLE = {
    "half turn": ({"rotation_rad": math.pi}, 50.00),
    "quarter turn": ({"rotation_rad": math.pi / 2}, 35.36),
    "mirror": ({"shear_rad": math.pi}, 30.00),
    "five degree lean": ({"shear_rad": math.radians(5)}, 1.31),
}


def _four_field_agrees(t: dict, stack_t: dict) -> bool:
    """`migrations._agrees`, verbatim as it stood before this round."""
    _origin_tol_m = 0.2
    _scale_tol_frac = 0.02
    try:
        return (
            abs(float(t.get("origin_x_m", 0)) - stack_t["origin_x_m"]) <= _origin_tol_m
            and abs(float(t.get("origin_y_m", 0)) - stack_t["origin_y_m"]) <= _origin_tol_m
            and abs(float(t.get("scale_x_m", 0)) - stack_t["scale_x_m"])
            <= max(_origin_tol_m, _scale_tol_frac * stack_t["scale_x_m"])
            and abs(float(t.get("scale_y_m", 0)) - stack_t["scale_y_m"])
            <= max(_origin_tol_m, _scale_tol_frac * stack_t["scale_y_m"])
        )
    except (TypeError, ValueError, KeyError):
        return False


@pytest.mark.parametrize("name", sorted(_INVISIBLE))
def test_the_old_gate_could_not_see_it_and_the_new_one_can(name) -> None:
    diff, metres = _INVISIBLE[name]
    t = {**_SQUARE, **diff}

    assert _four_field_agrees(t, _SQUARE), (
        f"the {name} fixture no longer exercises the blindness")
    assert fabric_truth.placement_disagreement_m(t, _SQUARE) == pytest.approx(
        metres, abs=0.01)
    assert not fabric_truth.placements_agree(t, _SQUARE)


def test_the_private_gate_is_gone_rather_than_widened() -> None:
    """A fifth copy of "do these agree" is the thing being removed."""
    for gone in ("_agrees", "_ORIGIN_TOL_M", "_SCALE_TOL_FRAC"):
        assert not hasattr(migrations, gone), f"{gone} is still there"


# ── the cost, through the real migration ────────────────────────────────────

def _scene(record: dict):
    """A measured master, plus a map whose stack puts it square at the origin
    while its RECORD says `record`."""
    def _mk(mid, name, master):
        return {"id": mid, "floor_id": "main", "name": name,
                "image": {"width": 1600, "height": 1200},
                "stack": {"is_master": master, "scale": 1.0, "scale_x_adj": 1.0,
                          "ref_ar": 0.75, "rotation": 0,
                          "x_offset": 0, "y_offset": 0}}

    maps = [_mk("master", "Ground", True), _mk("sub", "Annex", False)]
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock()
    mdl.store = AsyncMock()
    mdl.store.async_save = AsyncMock()
    mdl.fabric = None
    mdl.data = {"map_transforms": {
        "master": {**_SQUARE, "floor_id": "main",
                   "reference_measurements": [{"m": 1}]},
        "sub": {**record, "floor_id": "main"},
    }}
    ms = maps_store_with(maps)

    from custom_components.padspan_ha.fabric_store import FabricStore
    fab = FabricStore.__new__(FabricStore)
    fab.hass = MagicMock()
    fab.store = AsyncMock()
    fab.store.async_save = AsyncMock()
    fab.data = {"floors": {}, "history": [], "scanner_positions_m": {},
                "beacon_positions_m": {}, "rf_barriers_m": []}
    return maps, mdl, ms, fab


@pytest.mark.asyncio
@pytest.mark.parametrize("name", sorted(_INVISIBLE))
async def test_the_one_shot_repair_no_longer_closes_on_a_map_that_is_metres_out(name) -> None:
    """Both halves of the cost: the map is repaired, and the marker is set.

    Under the old gate this map was counted `maps_already_correct`, the marker
    was written, and the migration never looked at it again — a permanently
    wrong record, on an install whose only symptom is a floor plan drawn in
    the wrong place.
    """
    diff, metres = _INVISIBLE[name]
    maps, mdl, ms, fab = _scene({**_SQUARE, **diff})

    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, migration_backup)

    assert "Annex" in stats["maps_repaired"], (
        f"a map its stack puts {metres:.2f} m away was called already correct")
    assert stats["maps_already_correct"] == 1, "the control map stopped agreeing"
    # ...and the marker really is one-way, so being missed here was
    # permanent: step 1 does not run a second time, whatever else is still
    # outstanding (the calibration steps stay outstanding here because this
    # scene has no calibration store, exactly as production does).
    assert "fabric_photo_divorce" in fab.data[MARKER]
    again = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, migration_backup)
    assert again.get("maps_repaired") == [], again["steps"]
    assert "fabric_photo_divorce" not in again["steps"]

    # The repaired record now puts the map where the stack draws it.
    gauge = fabric_truth.metre_gauge(mdl)
    st = fabric_truth.legacy_stack_metre_transform(maps[1], gauge)
    assert fabric_truth.placements_agree(mdl.map_transform("sub"), st)
