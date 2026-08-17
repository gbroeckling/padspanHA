# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Storeys stack by what their names mean, not by the order they were created.

HA's floor registry lets `level` be null and on a real install it usually is,
so `_ordered_floors` fell straight through to stored order. That order is
whatever the registry hands back — alphabetical on the install this came from,
which put `attic` below `basement` and would have stacked a house upside down.

This is not only a drawing concern. The index difference between two floors is
the number of slabs an RF path crosses (`_slabs_crossed`, presence_coordinator),
so a wrong order is a wrong attenuation. Two floors apart penalised as one is
issue #54's fix quietly not applying.

Scope note, learned the hard way: floors the FABRIC uses but the registry never
declared are deliberately NOT adopted here. The stored `.storage` blob can hold
a stale one-floor list while the live registry has all four, so adopting from
the fabric "fixed" an ordering that was never broken and moved every floor's
base elevation with it. Declared floors are the building; convention only
decides their order.
"""

from __future__ import annotations

from typing import Any

from custom_components.padspan_ha.model_store import ModelStore


def _store(floors: list[dict[str, Any]]) -> ModelStore:
    ms = ModelStore.__new__(ModelStore)
    ms.data = {"floors": floors}
    return ms


# A registry with no levels set, handed back alphabetically — the shape that
# made this a bug rather than a preference.
ALPHABETICAL = [{"id": "attic"}, {"id": "basement"}, {"id": "main"}, {"id": "upper"}]


def test_a_house_is_not_stacked_alphabetically() -> None:
    """The bug, stated as the thing that is wrong with the answer."""
    idx = _store(ALPHABETICAL).floor_stack_index()
    assert idx["basement"] < idx["main"] < idx["upper"] < idx["attic"], idx


def test_the_slab_count_matches_the_storeys_between() -> None:
    """The positioning half: one floor apart is one slab, two is two."""
    idx = _store(ALPHABETICAL).floor_stack_index()
    assert abs(idx["main"] - idx["upper"]) == 1
    assert abs(idx["basement"] - idx["upper"]) == 2


def test_base_elevations_follow_the_corrected_order() -> None:
    """Heights are a running sum over the stack, so a wrong order is wrong metres."""
    elev = _store(ALPHABETICAL).floor_base_elevations_m()
    assert elev["basement"] < elev["main"] < elev["upper"] < elev["attic"], elev


def test_an_explicit_level_always_wins() -> None:
    """Somebody who filled in the table meant it, whatever the name suggests.

    A converted house can genuinely call its ground floor "attic", and the
    registry is the authority when it has been told.
    """
    idx = _store([{"id": "attic", "level": 0}, {"id": "main", "level": 1}]).floor_stack_index()
    assert idx["attic"] < idx["main"], idx


def test_one_explicit_level_does_not_drag_the_rest_out_of_order() -> None:
    """Mixed registries are the normal case — one floor edited, the others not.

    Convention and explicit levels share a number line on purpose (basement
    -1, ground 0, upper 1), so a floor that has been given a level slots in
    beside the ones that have not instead of jumping to an end.
    """
    idx = _store([{"id": "basement"}, {"id": "main"}, {"id": "upper", "level": 1}]).floor_stack_index()
    assert idx["basement"] < idx["main"] < idx["upper"], idx


def test_an_unrecognised_name_keeps_its_stored_order() -> None:
    """Convention covers the common names, not every name.

    Anything it cannot place stays stable and distinct rather than being
    interleaved with storeys it cannot be compared to.
    """
    idx = _store([{"id": "mezzanine_b"}, {"id": "mezzanine_a"}]).floor_stack_index()
    assert idx["mezzanine_b"] < idx["mezzanine_a"], "stored order was not preserved"


def test_a_single_floor_house_is_unchanged() -> None:
    """Nobody with one floor may notice this."""
    assert _store([{"id": "main"}]).floor_stack_index() == {"main": 0}


def test_floors_the_registry_never_declared_are_left_alone() -> None:
    """The half that was backed out, kept as a statement of scope.

    A floor id that only ever appears in the fabric gets no stack index and no
    base elevation. Inventing one gives it an order nothing justifies and a
    height in metres nothing measured — and the 3D distance calculation
    believes heights.
    """
    ms = _store([{"id": "main", "level": 0, "floor_to_floor_m": 2.8}])
    assert "mezzanine" not in ms.floor_stack_index()
    assert ms.floor_base_elevations_m().get("mezzanine", 0.0) == 0.0


def test_a_floor_on_the_same_storey_shares_its_base_not_the_next_storeys() -> None:
    """The real house: basement, main, outside, upper — no levels set.

    "outside" is ground level by convention, the same storey as "main". The
    running sum had ALREADY advanced to the next storey when main was placed,
    and the same-storey floor read its base from there — so the garden came
    out level with the bedrooms (5.6 m on the live install), and every
    outdoor scanner was modelled a storey above the ground it stands on.
    """
    ms = _store([
        {"id": "basement", "floor_to_floor_m": 3.0},
        {"id": "main", "floor_to_floor_m": 2.3},
        {"id": "outside"},
        {"id": "upper"},
    ])
    elev = ms.floor_base_elevations_m()
    assert elev["basement"] == 0.0
    assert elev["main"] == 3.0
    assert elev["outside"] == elev["main"], elev
    assert elev["upper"] == 5.3, elev
