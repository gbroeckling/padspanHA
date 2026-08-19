# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Cropping a map must not move the metre anchor (issue #62, rjbutler).

The invariant under test is a physical one: **cropping a photograph does not
change how many metres a world unit is.** The house did not move; only the
picture got smaller. So `find_metre_anchor` must return the same
`m_per_world_x` / `m_per_world_y` before and after a trim.

It does not today. `async_recompute_transform_for_map(crop=...)` rewrites the
map's METRIC record (`scale_x_m` / `scale_y_m` shrink by the retained
fraction, and the origin shifts by the cut-off margin) but nothing rewrites the
map's STACK, which is what says how much world space that image spans. The
anchor divides one by the other:

    m_per_world_x = scale_x_m / (stack.scale * stack.scale_x_adj)
    m_per_world_y = scale_y_m / (stack.scale * ref_ar)

so the numerator shrinks and the denominator does not.

Worse, a trim rarely removes the same fraction from both axes, so the two
scales stop agreeing with each other — which is why it reads as bad scaling
rather than a clean offset.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.model_store import ModelStore


# A well-formed measured map: 1600x1200 px covering 80 m x 60 m at 20 px/m.
# Its stack spans the full image across 1.0 world unit in x and ref_ar = 0.75
# in y, so both axes agree at 80 m per world unit and iso_error is 0.
_MEASURED = {
    "origin_x_m": 0.0,
    "origin_y_m": 0.0,
    "scale_x_m": 80.0,
    "scale_y_m": 60.0,
    "rotation_rad": 0.0,
    "floor_id": "main",
    "reference_measurements": [
        {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 40.0,
         "px_per_meter": 20.0, "angle_deg": 0, "date": "2026-07-01"},
    ],
}


def _store() -> ModelStore:
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_save = AsyncMock()
    store.data = {"map_transforms": {"m1": dict(_MEASURED)}}
    return store


def _map(width: int, height: int) -> dict:
    return {
        "id": "m1",
        "floor_id": "main",
        "image": {"width": width, "height": height},
        # ref_ar 0.75 == 1200/1600: the stack agrees with the untrimmed image.
        "stack": {"scale": 1.0, "scale_x_adj": 1.0, "ref_ar": 0.75,
                  "rotation": 0, "x_offset": 0, "y_offset": 0, "is_master": True},
        "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
    }


def test_untrimmed_map_anchor_is_self_consistent() -> None:
    """Control: before any crop the two axis scales agree exactly."""
    store = _store()
    anchor = fabric_truth.find_metre_anchor([_map(1600, 1200)], store)
    assert anchor is not None
    assert anchor["m_per_world_x"] == pytest.approx(80.0)
    assert anchor["m_per_world_y"] == pytest.approx(80.0)
    assert anchor["iso_error"] == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_symmetric_crop_does_not_move_the_anchor() -> None:
    """Cropping half off both axes must not rescale the world.

    Both axes shrink together here, so the map still looks self-consistent
    (iso_error stays 0) — but every fabric metre now converts into twice as
    much world space, so every room is drawn at double size.
    """
    store = _store()
    before = fabric_truth.find_metre_anchor([_map(1600, 1200)], store)

    # One dict throughout: the crop rewrites map["stack"] in place, exactly as
    # it does on the live map the maps store then persists.
    cropped = _map(800, 600)
    await store.async_recompute_transform_for_map(
        "m1", cropped, MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5},
    )
    after = fabric_truth.find_metre_anchor([cropped], store)

    assert after["m_per_world_x"] == pytest.approx(before["m_per_world_x"]), (
        "cropping the photo rescaled the world in x: "
        f"{before['m_per_world_x']} -> {after['m_per_world_x']} m per world unit"
    )
    assert after["m_per_world_y"] == pytest.approx(before["m_per_world_y"])


@pytest.mark.asyncio
async def test_anisotropic_crop_does_not_skew_the_anchor() -> None:
    """Trimming more off one axis than the other must not skew the world.

    This is rjbutler's case. Half the width removed, full height kept: the two
    axis scales stop agreeing, so the fabric is drawn through a scale that
    describes neither dimension of the picture it lands on. Rooms come out
    stretched on one axis only — "the previously drawn rooms are now
    incorrect", and an edge room (his garage) falls outside the drawn floor.
    """
    store = _store()
    before = fabric_truth.find_metre_anchor([_map(1600, 1200)], store)

    cropped = _map(800, 1200)
    await store.async_recompute_transform_for_map(
        "m1", cropped, MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 1.0},
    )
    after = fabric_truth.find_metre_anchor([cropped], store)

    assert after["iso_error"] == pytest.approx(before["iso_error"], abs=1e-6), (
        "the two axis scales stopped agreeing after a crop: iso_error "
        f"{before['iso_error']} -> {after['iso_error']}"
    )
    assert after["m_per_world_x"] == pytest.approx(before["m_per_world_x"])
    assert after["m_per_world_y"] == pytest.approx(before["m_per_world_y"])


# ── The shipped guard ────────────────────────────────────────────────────────
# It does not repair a trimmed map. It stops one anchoring the whole house,
# which is what made an untrimmed floor render wrong in rjbutler's install.

def _clean_map(map_id: str) -> dict:
    m = _map(1600, 1200)
    m["id"] = map_id
    return m


def _trimmed_map(map_id: str) -> dict:
    """Half the width cut off: image and metric extent moved, stack did not."""
    m = _map(800, 1200)
    m["id"] = map_id
    return m


_TRIMMED_T = {**_MEASURED, "scale_x_m": 40.0, "scale_y_m": 60.0}


def test_anchor_prefers_a_self_consistent_map_over_a_trimmed_one() -> None:
    """A trimmed map listed first must not anchor the house."""
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.data = {"map_transforms": {"trimmed": dict(_TRIMMED_T),
                                     "clean": dict(_MEASURED)}}

    anchor = fabric_truth.find_metre_anchor(
        [_trimmed_map("trimmed"), _clean_map("clean")], store)

    assert anchor["map_id"] == "clean", (
        "the skewed map anchored the house; every floor inherits its error"
    )
    assert anchor["iso_error"] == pytest.approx(0.0)
    assert not anchor.get("degraded")


def test_anchor_falls_back_to_least_skewed_when_nothing_is_clean() -> None:
    """No consistent map: keep working, but say so rather than silently skew."""
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.data = {"map_transforms": {"trimmed": dict(_TRIMMED_T)}}

    anchor = fabric_truth.find_metre_anchor([_trimmed_map("trimmed")], store)

    assert anchor is not None, "must not strand an install with one trimmed map"
    assert anchor["map_id"] == "trimmed"
    assert anchor["degraded"] is True


def test_offset_crop_keeps_the_map_where_it_was() -> None:
    """A crop taken off-centre must not slide the map through world space.

    Scale alone is not enough: the retained rectangle's centre is no longer the
    old image's centre, so the stack's offsets have to absorb the difference.
    A point of the house that survived the cut must land on the same world
    coordinate before and after.
    """
    from custom_components.padspan_ha.maps_store import MapsStore

    stk_old = _map(1600, 1200)["stack"]
    fx0, fy0, fw, fh = 0.25, 0.10, 0.50, 0.40

    # A feature at frac (0.5, 0.3) of the OLD image...
    px_old, py_old = 0.5, 0.3
    world_before = MapsStore.map_to_world(px_old, py_old, stk_old)

    # ...is at this frac of the NEW one.
    px_new = (px_old - fx0) / fw
    py_new = (py_old - fy0) / fh
    assert 0 <= px_new <= 1 and 0 <= py_new <= 1, "test point must survive the crop"

    from custom_components.padspan_ha.model_store import _recrop_stack
    stk_new = _recrop_stack(stk_old, fx0, fy0, fw, fh)
    world_after = MapsStore.map_to_world(px_new, py_new, stk_new)

    assert world_after[0] == pytest.approx(world_before[0], abs=1e-9)
    assert world_after[1] == pytest.approx(world_before[1], abs=1e-9)


def test_recrop_stack_is_identity_for_a_full_frame_crop() -> None:
    """Cropping nothing must change nothing."""
    stk = _map(1600, 1200)["stack"]
    out = _recrop_stack_ref(stk)
    assert out["scale"] == pytest.approx(stk["scale"])
    assert out["scale_x_adj"] == pytest.approx(stk["scale_x_adj"])
    assert out["x_offset"] == pytest.approx(stk["x_offset"])
    assert out["y_offset"] == pytest.approx(stk["y_offset"])
    assert out["ref_ar"] == pytest.approx(stk["ref_ar"]), "ref_ar is the shared frame — never rescaled"


def _recrop_stack_ref(stk: dict) -> dict:
    from custom_components.padspan_ha.model_store import _recrop_stack
    return _recrop_stack(stk, 0.0, 0.0, 1.0, 1.0)


# ── The remote self-check ────────────────────────────────────────────────────
# map_geometry_faults() is what lets an install report this class of bug
# itself, instead of it taking a user's screenshots to surface. Read only:
# it gates nothing and repairs nothing.

def _faults(maps, transforms):
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.data = {"map_transforms": transforms}
    return fabric_truth.map_geometry_faults(maps, store)


def test_a_healthy_map_reports_no_geometry_fault() -> None:
    assert _faults([_clean_map("clean")], {"clean": dict(_MEASURED)}) == []


def test_a_trimmed_map_reports_itself() -> None:
    """The signal that would have named rjbutler's install without a screenshot."""
    out = _faults([_trimmed_map("trimmed")], {"trimmed": dict(_TRIMMED_T)})

    assert len(out) == 1
    f = out[0]
    assert f["map_id"] == "trimmed"
    # Half the width cut off: its two axis scales now disagree by 100%.
    assert f["iso_error"] == pytest.approx(1.0, abs=0.01)
    # It is also the only measured map, so it anchors the house — the case that
    # makes rooms wrong on floors that were never touched.
    assert f["is_anchor"] is True
    assert f["anchor_degraded"] is True


def test_a_trimmed_map_beside_a_clean_one_is_named_but_not_the_anchor() -> None:
    out = _faults([_clean_map("clean"), _trimmed_map("trimmed")],
                  {"clean": dict(_MEASURED), "trimmed": dict(_TRIMMED_T)})

    assert [f["map_id"] for f in out] == ["trimmed"], "the clean map must not be flagged"
    f = out[0]
    assert f["is_anchor"] is False, "the guard kept the skewed map from anchoring"
    assert f["scale_error_frac"] > fabric_truth.GEOMETRY_SCALE_TOL


def test_geometry_faults_are_silent_without_an_anchor() -> None:
    """Nothing measured anywhere: no basis to judge, so no noise."""
    unmeasured = {k: v for k, v in _MEASURED.items() if k != "reference_measurements"}
    assert _faults([_clean_map("clean")], {"clean": unmeasured}) == []


# ── The raw-affine (_m) branch ───────────────────────────────────────────────
# Point-Align-solved maps carry a solved 2x2 matrix instead of
# scale/scale_x_adj/rotation, and take a different branch through
# _recrop_stack. Same invariant: a feature that survives the cut keeps its
# world coordinate, and the map's world footprint scales by what was kept.

def _affine_map(a: float, b: float, c: float, d: float, *, ox=0.0, oy=0.0) -> dict:
    m = _map(1600, 1200)
    m["stack"] = {
        "_m": [a, b, c, d], "_m_ar": 0.75, "ref_ar": 0.75,
        "x_offset": ox, "y_offset": oy, "is_master": True,
    }
    return m


@pytest.mark.parametrize("a,b,c,d,label", [
    (1.0, 0.0, 0.0, 1.0, "identity"),
    (0.8, 0.0, 0.0, 1.3, "anisotropic, no shear"),
    (1.0, 0.25, -0.15, 0.9, "sheared"),
    (0.0, -1.0, 1.0, 0.0, "90-degree rotation"),
])
@pytest.mark.parametrize("fx0,fy0,fw,fh", [
    (0.0, 0.0, 1.0, 1.0),      # identity crop
    (0.0, 0.0, 0.5, 0.5),      # symmetric, top-left
    (0.0, 0.0, 0.5, 1.0),      # anisotropic
    (0.25, 0.10, 0.50, 0.40),  # off-centre
])
def test_affine_crop_keeps_a_surviving_feature_in_place(a, b, c, d, label, fx0, fy0, fw, fh) -> None:
    from custom_components.padspan_ha.maps_store import MapsStore
    from custom_components.padspan_ha.model_store import _recrop_stack

    stk_old = _affine_map(a, b, c, d, ox=0.13, oy=-0.07)["stack"]

    # A feature at the centre of the retained rectangle, plus two more inside it.
    for fx, fy in ((0.5, 0.5), (0.25, 0.75), (0.9, 0.1)):
        px_old = fx0 + fx * fw
        py_old = fy0 + fy * fh
        world_before = MapsStore.map_to_world(px_old, py_old, stk_old)

        stk_new = _recrop_stack(stk_old, fx0, fy0, fw, fh)
        assert stk_new is not None, f"{label}: affine branch refused a representable crop"
        world_after = MapsStore.map_to_world(fx, fy, stk_new)

        assert world_after[0] == pytest.approx(world_before[0], abs=1e-9), (
            f"{label} crop=({fx0},{fy0},{fw},{fh}) pt=({fx},{fy}): world x moved"
        )
        assert world_after[1] == pytest.approx(world_before[1], abs=1e-9), (
            f"{label} crop=({fx0},{fy0},{fw},{fh}) pt=({fx},{fy}): world y moved"
        )


def test_affine_identity_crop_changes_nothing() -> None:
    from custom_components.padspan_ha.model_store import _recrop_stack
    stk = _affine_map(0.8, 0.25, -0.15, 1.3, ox=0.13, oy=-0.07)["stack"]
    out = _recrop_stack(stk, 0.0, 0.0, 1.0, 1.0)
    assert out["_m"] == pytest.approx(stk["_m"])
    assert out["x_offset"] == pytest.approx(stk["x_offset"])
    assert out["y_offset"] == pytest.approx(stk["y_offset"])
    assert out["_m_ar"] == pytest.approx(stk["_m_ar"]), "the frame's anisotropy is not the map's to rescale"


def test_affine_crop_scales_the_world_footprint_by_what_was_kept() -> None:
    """Half the width kept -> the image spans half the world x it used to."""
    from custom_components.padspan_ha.maps_store import MapsStore
    from custom_components.padspan_ha.model_store import _recrop_stack

    stk = _affine_map(1.0, 0.0, 0.0, 1.0)["stack"]
    span_before = (MapsStore.map_to_world(1.0, 0.5, stk)[0]
                   - MapsStore.map_to_world(0.0, 0.5, stk)[0])

    out = _recrop_stack(stk, 0.0, 0.0, 0.5, 1.0)
    span_after = (MapsStore.map_to_world(1.0, 0.5, out)[0]
                  - MapsStore.map_to_world(0.0, 0.5, out)[0])

    assert span_after == pytest.approx(span_before * 0.5)


# ── stack_from_transform: the repair for a stale stack ───────────────────────
# The correctness claim is a round trip. Rebuild the stack from the stored
# transform, push it back through stack_metre_transform, and the stored
# transform must come out again. If it does, the map's placement and its scale
# describe the same picture once more.

_ANCHOR = {"m_per_world": 80.0, "m_per_world_x": 80.0, "m_per_world_y": 80.0}


@pytest.mark.parametrize("rot", [0.0, 12.5, -30.0, 90.0])
@pytest.mark.parametrize("sx_m,sy_m,ox_m,oy_m", [
    (80.0, 60.0, 0.0, 0.0),
    (40.0, 60.0, 0.0, 0.0),       # rjbutler: half the width trimmed off
    (40.0, 24.0, 13.5, -7.25),    # trimmed off-centre
    (12.0, 55.0, -3.0, 41.0),     # tall and displaced
])
def test_stack_from_transform_round_trips(rot, sx_m, sy_m, ox_m, oy_m) -> None:
    m = _map(1600, 1200)
    m["stack"]["rotation"] = rot
    # Deliberately wrong stack — this is the stale half being repaired.
    m["stack"]["scale"] = 3.7
    m["stack"]["scale_x_adj"] = 0.41
    m["stack"]["x_offset"] = 2.2
    m["stack"]["y_offset"] = -1.4

    target = {"scale_x_m": sx_m, "scale_y_m": sy_m,
              "origin_x_m": ox_m, "origin_y_m": oy_m}

    repaired = fabric_truth.stack_from_transform(m, target, _ANCHOR)
    assert repaired is not None, "a plain decomposed stack must be repairable"

    m["stack"] = repaired
    got = fabric_truth.stack_metre_transform(m, _ANCHOR)
    assert got is not None

    assert got["scale_x_m"] == pytest.approx(sx_m, abs=1e-3)
    assert got["scale_y_m"] == pytest.approx(sy_m, abs=1e-3)
    assert got["origin_x_m"] == pytest.approx(ox_m, abs=1e-3)
    assert got["origin_y_m"] == pytest.approx(oy_m, abs=1e-3)


def test_repair_clears_the_geometry_fault_it_was_built_for() -> None:
    """End to end: the map that map_geometry_faults names stops being named."""
    trimmed = _trimmed_map("trimmed")
    transforms = {"clean": dict(_MEASURED), "trimmed": dict(_TRIMMED_T)}
    maps = [_clean_map("clean"), trimmed]

    assert [f["map_id"] for f in _faults(maps, transforms)] == ["trimmed"]

    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock(); store.store = AsyncMock()
    store.data = {"map_transforms": transforms}
    anchor = fabric_truth.find_metre_anchor(maps, store)
    trimmed["stack"] = fabric_truth.stack_from_transform(trimmed, _TRIMMED_T, anchor)

    assert _faults(maps, transforms) == [], "the repair did not clear the fault"


def test_repair_refuses_a_solved_affine_stack() -> None:
    """No scale/scale_x_adj to solve for — say so rather than invent one."""
    m = _map(1600, 1200)
    m["stack"]["_m"] = [1.0, 0.0, 0.0, 1.0]
    assert fabric_truth.stack_from_transform(m, dict(_TRIMMED_T), _ANCHOR) is None


def test_repair_leaves_the_shared_frame_alone() -> None:
    m = _map(1600, 1200)
    before_ar = m["stack"]["ref_ar"]
    out = fabric_truth.stack_from_transform(m, dict(_TRIMMED_T), _ANCHOR)
    assert out["ref_ar"] == pytest.approx(before_ar)
    assert out["rotation"] == m["stack"]["rotation"]
