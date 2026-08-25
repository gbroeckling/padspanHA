# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""When do two placements agree?

THREE SITES DECIDED IT AND ALL THREE COMPARED FIELDS — origin and the two
scales, four of the six a placement has.  ρ was in none of them and σ was in
none of them, so on a 20 x 15 m map with an IDENTICAL origin and IDENTICAL
scales every disagreement below scored zero on all four terms, the panel drew
a green tick, and all three repair routes closed on a map that is metres from
where it belongs.  The fix was to define agreement ONCE, as a distance in
metres over the map's own corners.

**All three sites are gone.**  They compared a map's metric record against its
world stack, and there is one placement now, so the comparison has no second
operand — `ws_fabric_map_align_to_stack`, `ws_fabric_map_stack_rebuild` and
`ws_positioning_repair` are deleted with the disagreement they repaired.

The PREDICATE survives, with two readers that are not about a second copy:
migration step 1 (which runs on legacy data, where the two copies still exist,
and is where the conversion's decision rule comes from) and the align editor's
tie-in conflicts, which compare an owner's saved constraint against the
placement they are about to commit.  What is tested here is therefore the
metric itself, at the site that still asks it.
"""

from __future__ import annotations

import inspect
import math
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DOMAIN,
)
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import seed_world_gauge


# A 20 m x 15 m map at the origin, square and unturned.
_SQUARE = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
           "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}


def _with(**kw) -> dict:
    return {**_SQUARE, **kw}


# Every one of these has the same origin and the same two scales as the
# placement it is compared against, so the four terms that used to decide
# agreement are all exactly zero.  The metres are what the map moves.
_INVISIBLE_TO_FOUR_FIELDS = [
    ("lean +5 deg vs -5 deg", _with(shear_rad=math.radians(5.0)),
     _with(shear_rad=math.radians(-5.0)), 2.6147),
    ("lean 20 deg", _SQUARE, _with(shear_rad=math.radians(20.0)), 5.2094),
    ("lean 45 deg", _SQUARE, _with(shear_rad=math.radians(45.0)), 11.4805),
    ("mirror", _SQUARE, _with(shear_rad=math.pi), 30.0000),
    ("rotation differs by 30 deg", _SQUARE,
     _with(rotation_rad=math.radians(30.0)), 12.9410),
    ("rotation differs by 180 deg", _SQUARE, _with(rotation_rad=math.pi), 50.0000),
]

_IDS = [c[0] for c in _INVISIBLE_TO_FOUR_FIELDS]


# The same disagreements as a map's stored RECORD against a stack that draws
# it square — which is what the three sites actually compare.  Identical
# origin and identical scales again, so the four terms are again all zero.
_RECORD_VS_SQUARE_STACK = [
    ("lean 5 deg", _with(shear_rad=math.radians(5.0)), 1.3086),
    ("lean 20 deg", _with(shear_rad=math.radians(20.0)), 5.2094),
    ("lean 45 deg", _with(shear_rad=math.radians(45.0)), 11.4805),
    ("mirror", _with(shear_rad=math.pi), 30.0000),
    ("rotation differs by 30 deg", _with(rotation_rad=math.radians(30.0)), 12.9410),
    ("rotation differs by 180 deg", _with(rotation_rad=math.pi), 50.0000),
]

_SITE_IDS = [c[0] for c in _RECORD_VS_SQUARE_STACK]


def _four_field_agrees(t: dict, st: dict) -> bool:
    """The comparison all three sites made, kept verbatim as the control.

    Not a paraphrase: this is what `ws_fabric` and `ws_calibration` both had,
    and `map_geometry_faults` had the same four quantities under its own two
    tolerances.  It is here so the table above can be shown to be invisible to
    it rather than asserted to be.
    """
    return (
        abs(float(t.get("origin_x_m", 0)) - st["origin_x_m"]) <= 0.2
        and abs(float(t.get("origin_y_m", 0)) - st["origin_y_m"]) <= 0.2
        and abs(float(t.get("scale_x_m", 0)) - st["scale_x_m"]) <= max(0.2, 0.02 * st["scale_x_m"])
        and abs(float(t.get("scale_y_m", 0)) - st["scale_y_m"]) <= max(0.2, 0.02 * st["scale_y_m"])
    )


# ── the metric ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("_name,a,b,metres", _INVISIBLE_TO_FOUR_FIELDS, ids=_IDS)
def test_the_disagreement_is_how_far_the_map_moves(_name, a, b, metres) -> None:
    """Agreement is a distance, and this is the distance."""
    assert fabric_truth.placement_disagreement_m(a, b) == pytest.approx(metres, abs=1e-3)
    assert fabric_truth.placement_disagreement_m(b, a) == pytest.approx(metres, abs=1e-3), (
        "the distance between two placements is not symmetric"
    )
    assert not fabric_truth.placements_agree(a, b)


@pytest.mark.parametrize("_name,a,b,metres", _INVISIBLE_TO_FOUR_FIELDS, ids=_IDS)
def test_the_control_four_fields_call_every_one_of_them_identical(_name, a, b, metres) -> None:
    """Why they all survived: the terms that decided are all zero here.

    This is the whole finding in one assertion — the comparison was not a
    little loose, it was blind, and no tolerance on those four terms could
    have caught a map 50 m out.
    """
    assert _four_field_agrees(a, b), "the fixture is no longer invisible to four fields"
    assert metres > fabric_truth.PLACEMENT_AGREE_TOL_M


def test_an_identical_placement_agrees_with_itself() -> None:
    assert fabric_truth.placement_disagreement_m(_SQUARE, dict(_SQUARE)) == 0.0
    assert fabric_truth.placements_agree(_SQUARE, dict(_SQUARE))


def test_a_missing_placement_never_agrees() -> None:
    """`None` is not a placement, and neither is `{}` — a map with no stored
    transform must not read as aligned with the stack."""
    assert not fabric_truth.placements_agree(None, _SQUARE)
    assert not fabric_truth.placements_agree(_SQUARE, None)
    assert not fabric_truth.placements_agree({}, _SQUARE)


def test_the_record_is_evaluated_in_exactly_one_place() -> None:
    """`ModelStore.map_frac_to_metres` is the map_id lookup plus this.

    Two evaluations of the placement model would be two chances to wrap σ
    differently, and σ is the field a disagreement is invisible in — the same
    reason `placement_from_columns`, its inverse, is a single function.
    """
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock(); s.store = AsyncMock()
    s.data = {"map_transforms": {"m": _with(rotation_rad=0.7, shear_rad=-0.21)}}
    for fx, fy in ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.137, 0.911)):
        assert s.map_frac_to_metres(fx, fy, "m") == fabric_truth.placement_metres(
            s.data["map_transforms"]["m"], fx, fy)




# ── the site that survives: migration step 1 ─────────────────────────────────
#
# It runs on LEGACY data — a store that still holds both copies — and it is
# where the conversion's decision rule comes from, so the predicate has to be
# right there or the one-way conversion writes the wrong side.


@pytest.mark.parametrize("_name,record,metres", _RECORD_VS_SQUARE_STACK, ids=_SITE_IDS)
def test_the_migration_repairs_what_four_fields_called_aligned(_name, record, metres) -> None:
    """A map the stack leans, mirrors or turns is repaired, not waved through.

    Step 1 is MARKER-GUARDED: a map counted `maps_already_correct` has the
    marker written and never gets another turn, so a blind compare here closed
    the one-shot repair permanently on exactly the placements that were most
    wrong.
    """
    import asyncio

    from custom_components.padspan_ha import migrations

    stack = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
             "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
    m = {"id": "m1", "name": "Main", "floor_id": "main",
         "image": {"width": 800, "height": 600}, "stack": stack}

    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock(); mdl.store = AsyncMock()
    mdl.data = {"map_transforms": {"m1": dict(record)},
                "world_gauge": {"m_per_unit": 20.0, "source_map_id": "m1"}}

    gauge = fabric_truth.metre_gauge(mdl)
    st = fabric_truth.legacy_stack_metre_transform(m, gauge)
    # The control: the four terms the three sites compared are all zero.
    assert _four_field_agrees(record, st), "the fixture is no longer invisible to four fields"
    assert fabric_truth.placement_disagreement_m(record, st) == pytest.approx(metres, abs=1e-3)
    assert not fabric_truth.placements_agree(record, st), (
        "step 1 would mark this map already-correct and never look at it again"
    )
    del asyncio


def test_a_map_that_really_does_agree_is_left_alone() -> None:
    """The other half: the predicate must not repair what is already right,
    or the conversion rewrites every map on every install for nothing."""
    stack = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
             "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
    m = {"id": "m1", "name": "Main", "floor_id": "main",
         "image": {"width": 800, "height": 600}, "stack": stack}
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock(); mdl.store = AsyncMock()
    mdl.data = {"map_transforms": {"m1": dict(_SQUARE)},
                "world_gauge": {"m_per_unit": 20.0, "source_map_id": "m1"}}
    st = fabric_truth.legacy_stack_metre_transform(m, fabric_truth.metre_gauge(mdl))
    assert fabric_truth.placements_agree(_SQUARE, st)
