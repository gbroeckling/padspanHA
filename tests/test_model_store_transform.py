"""Unit tests for ModelStore.async_recompute_transform_for_map."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.model_store import ModelStore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store(transform: dict) -> ModelStore:
    """Create a ModelStore holding a single map transform for map id "m1"."""
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_save = AsyncMock()
    store.data = {"map_transforms": {"m1": dict(transform)}}
    return store


def _map(width: int, height: int, **kw) -> dict:
    """A map dict with the given NEW image dimensions."""
    m = {
        "id": "m1",
        "floor_id": "main",
        "image": {"width": width, "height": height},
        "stack": {"is_master": True},
        "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
    }
    m.update(kw)
    return m


# A map measured at 20 px/m: 1600x1200 px image covering 80m x 60m.
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


# ---------------------------------------------------------------------------
# Crop-aware rescaling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_crop_scales_extent_by_retained_fraction(tmp_path: Path) -> None:
    """Cropping to the middle half keeps half the real-world extent."""
    store = _make_store(_MEASURED)
    # Kept x 0.25-0.75 (half) and y 0.2-0.8 (60%); client resampled to 800x720.
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(800, 720), MagicMock(),
        crop={"fx0": 0.25, "fy0": 0.2, "fx1": 0.75, "fy1": 0.8},
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(40.0)   # 80 * 0.50
    assert t["scale_y_m"] == pytest.approx(36.0)   # 60 * 0.60


@pytest.mark.asyncio
async def test_crop_extent_is_independent_of_resample(tmp_path: Path) -> None:
    """The retained extent must not depend on the pixel dimensions chosen."""
    crop = {"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5}
    results = []
    for w, h in ((800, 600), (1600, 1200), (137, 103)):
        store = _make_store(_MEASURED)
        await store.async_recompute_transform_for_map(
            "m1", _map(w, h), MagicMock(), crop=crop
        )
        t = store.data["map_transforms"]["m1"]
        results.append((t["scale_x_m"], t["scale_y_m"]))
    assert results == [(40.0, 30.0)] * 3


@pytest.mark.asyncio
async def test_no_crop_preserves_extent_across_resample(tmp_path: Path) -> None:
    """A pure resample (rotate/replace, no crop) keeps the real-world extent."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(), crop=None
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(80.0)
    assert t["scale_y_m"] == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_degenerate_crop_falls_back_to_extent(tmp_path: Path) -> None:
    """A zero-area crop rectangle must not produce a zero-metre map."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(),
        crop={"fx0": 0.4, "fy0": 0.4, "fx1": 0.4, "fy1": 0.4},
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(80.0)
    assert t["scale_y_m"] == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_legacy_px_per_meter_still_honoured(tmp_path: Path) -> None:
    """Maps carrying legacy calibration px_per_meter keep using it (no crop)."""
    store = _make_store({"scale_x_m": 80.0, "scale_y_m": 60.0, "floor_id": "main"})
    m = _map(800, 600)
    m["calibration"]["px_per_meter"] = 10.0
    ok = await store.async_recompute_transform_for_map("m1", m, MagicMock())
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(80.0)   # 800 px / 10 px per m
    assert t["scale_y_m"] == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_unmeasured_map_without_transform_is_skipped(tmp_path: Path) -> None:
    """With neither calibration nor a prior transform there is nothing to recover."""
    store = _make_store({})
    store.data["map_transforms"] = {}
    ok = await store.async_recompute_transform_for_map("m1", _map(800, 600), MagicMock())
    assert ok is False


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reference_measurements_survive_recompute(tmp_path: Path) -> None:
    """Replacing an image must not un-measure the map."""
    store = _make_store(_MEASURED)
    await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5},
    )
    t = store.data["map_transforms"]["m1"]
    assert t.get("reference_measurements") == _MEASURED["reference_measurements"]


@pytest.mark.asyncio
async def test_crop_is_world_anchored(tmp_path: Path) -> None:
    """A crop shifts the origin by the cut-off margin so world coords hold.

    The stack-offset origin formula must NOT apply here — fabric data is
    stored in old world coordinates and the cropped image's frac (0,0) now
    sits at (fx0·scale_x, fy0·scale_y) in that world.
    """
    store = _make_store(_MEASURED)
    m = _map(800, 720, stack={"is_master": False, "x_offset": 0.5, "y_offset": 0.25})
    await store.async_recompute_transform_for_map(
        "m1", m, MagicMock(),
        crop={"fx0": 0.25, "fy0": 0.2, "fx1": 0.75, "fy1": 0.8},
    )
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(20.0)   # 0.25 * 80
    assert t["origin_y_m"] == pytest.approx(12.0)   # 0.20 * 60


@pytest.mark.asyncio
async def test_crop_roundtrips_fabric_position(tmp_path: Path) -> None:
    """A scanner's world position re-derives to the right frac after a trim.

    Regression for the origin bug: with the origin left at (0,0) the pin
    landed displaced by exactly the cut-off left/top margin.
    """
    store = _make_store(_MEASURED)
    # Scanner at world (30, 15): frac (0.375, 0.25) on the original map.
    await store.async_recompute_transform_for_map(
        "m1", _map(800, 720), MagicMock(),
        crop={"fx0": 0.25, "fy0": 0.2, "fx1": 0.75, "fy1": 0.8},
    )
    fx, fy = store.metres_to_map_frac(30.0, 15.0, "m1")
    # In the cropped image: ((0.375-0.25)/0.5, (0.25-0.2)/0.6)
    assert fx == pytest.approx(0.25)
    assert fy == pytest.approx(0.0833, abs=1e-3)
    # And the inverse agrees.
    wx, wy = store.map_frac_to_metres(fx, fy, "m1")
    assert (wx, wy) == (pytest.approx(30.0), pytest.approx(15.0))


@pytest.mark.asyncio
async def test_full_frame_crop_keeps_origin(tmp_path: Path) -> None:
    """A crop starting at (0,0) leaves the origin where it was."""
    store = _make_store(_MEASURED)
    await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5},
    )
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(0.0)
    assert t["origin_y_m"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Baked pixel ops (rotate / scale / stretch)
# ---------------------------------------------------------------------------


def _client_rot_frac(fx, fy, ow, oh, deg, nw, nh, sx=1.0, sy=1.0):
    """Mirror of the client's canvas bake: p' = c_new + R·S·(p − c_old)."""
    import math as _m
    rad = _m.radians(deg)
    px, py = fx * ow - ow / 2, fy * oh - oh / 2
    px, py = px * sx, py * sy
    rx = px * _m.cos(rad) - py * _m.sin(rad)
    ry = px * _m.sin(rad) + py * _m.cos(rad)
    return ((rx + nw / 2) / nw, (ry + nh / 2) / nh)


@pytest.mark.asyncio
async def test_rotate_90_composes_transform(tmp_path: Path) -> None:
    """A 90° bake swaps the extent, preserves ppm, and stays world-anchored.

    Hand-derived: 1600x1200 @ 80x60m, origin (0,0), rot 0, +90° → 1200x1600,
    scale (60, 80), rotation −π/2, origin (0, 60).
    """
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(1200, 1600), MagicMock(),
        pixel_op={"deg": 90, "sx": 1, "sy": 1}, old_px=(1600, 1200),
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(60.0)
    assert t["scale_y_m"] == pytest.approx(80.0)
    assert t["rotation_rad"] == pytest.approx(-1.5708, abs=1e-3)
    assert t["origin_x_m"] == pytest.approx(0.0, abs=1e-3)
    assert t["origin_y_m"] == pytest.approx(60.0, abs=1e-3)
    # World anchoring: old corner fracs must land on the same world points.
    for (ofx, ofy), world in (((0, 0), (0.0, 0.0)), ((1, 1), (80.0, 60.0)), ((0.375, 0.25), (30.0, 15.0))):
        nfx, nfy = _client_rot_frac(ofx, ofy, 1600, 1200, 90, 1200, 1600)
        wx, wy = store.map_frac_to_metres(nfx, nfy, "m1")
        # Stored transform rounds rotation to 6 dp → ~2e-5 m; assert to 1 mm.
        assert (wx, wy) == (pytest.approx(world[0], abs=1e-3), pytest.approx(world[1], abs=1e-3))


@pytest.mark.asyncio
async def test_rotate_arbitrary_angle_roundtrips(tmp_path: Path) -> None:
    """A 15° bake (arbitrary-angle rotate button) keeps world anchoring."""
    import math as _m
    store = _make_store(_MEASURED)
    rad = _m.radians(15)
    nw = round(1600 * abs(_m.cos(rad)) + 1200 * abs(_m.sin(rad)))
    nh = round(1600 * abs(_m.sin(rad)) + 1200 * abs(_m.cos(rad)))
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(nw, nh), MagicMock(),
        pixel_op={"deg": 15, "sx": 1, "sy": 1}, old_px=(1600, 1200),
    )
    assert ok
    for ofx, ofy, wx0, wy0 in ((0.25, 0.75, 20.0, 45.0), (0.9, 0.1, 72.0, 6.0)):
        nfx, nfy = _client_rot_frac(ofx, ofy, 1600, 1200, 15, nw, nh)
        wx, wy = store.map_frac_to_metres(nfx, nfy, "m1")
        # Canvas dims round to whole pixels — allow ~1px (0.05m at 20 px/m).
        assert wx == pytest.approx(wx0, abs=0.06)
        assert wy == pytest.approx(wy0, abs=0.06)


@pytest.mark.asyncio
async def test_uniform_scale_rotation_bake_composes(tmp_path: Path) -> None:
    """Point-Align bake with rotation + uniform scale composes (ppm scales)."""
    import math as _m
    store = _make_store(_MEASURED)
    k, deg = 1.25, 90
    nw, nh = round(1200 * k), round(1600 * k)   # 90°: dims swap, then scale
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(nw, nh), MagicMock(),
        pixel_op={"deg": deg, "sx": k, "sy": k}, old_px=(1600, 1200),
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    # Depicted extent is unchanged by pixel scaling: still 60x80 world-metres.
    assert t["scale_x_m"] == pytest.approx(60.0, abs=0.01)
    assert t["scale_y_m"] == pytest.approx(80.0, abs=0.01)
    nfx, nfy = _client_rot_frac(0.375, 0.25, 1600, 1200, deg, nw, nh, k, k)
    wx, wy = store.map_frac_to_metres(nfx, nfy, "m1")
    assert (wx, wy) == (pytest.approx(30.0, abs=0.06), pytest.approx(15.0, abs=0.06))


@pytest.mark.asyncio
async def test_stretch_only_bake_preserves_transform(tmp_path: Path) -> None:
    """A no-rotation anisotropic bake leaves the transform untouched."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(2400, 1200), MagicMock(),          # x stretched 1.5x
        pixel_op={"deg": 0, "sx": 1.5, "sy": 1.0}, old_px=(1600, 1200),
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(80.0)      # extent unchanged
    assert t["scale_y_m"] == pytest.approx(60.0)
    assert t["rotation_rad"] == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_rotated_stretch_bake_invalidates(tmp_path: Path) -> None:
    """Rotation + anisotropic stretch is unrepresentable — scale is dropped."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(2000, 1600), MagicMock(),
        pixel_op={"deg": 30, "sx": 1.5, "sy": 1.0}, old_px=(1600, 1200),
    )
    assert ok is False
    assert "m1" not in store.data["map_transforms"]   # honestly unmeasured
    store.store.async_save.assert_awaited()           # deletion persisted


@pytest.mark.asyncio
async def test_aspect_change_without_op_invalidates(tmp_path: Path) -> None:
    """An undeclared pixel-aspect-changing replacement drops the scale."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(1200, 1600), MagicMock(),          # 90°-swap dims, no op declared
        old_px=(1600, 1200),
    )
    assert ok is False
    assert "m1" not in store.data["map_transforms"]


@pytest.mark.asyncio
async def test_no_old_dims_keeps_legacy_preserve_extent(tmp_path: Path) -> None:
    """Without old dims the aspect check can't run — legacy behaviour holds."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(1200, 1600), MagicMock(),
    )
    assert ok
    assert store.data["map_transforms"]["m1"]["scale_x_m"] == pytest.approx(80.0)


@pytest.mark.asyncio
async def test_pixel_op_on_unmeasured_map_is_noop(tmp_path: Path) -> None:
    """A bake on a map with no transform has nothing to compose — skipped."""
    store = _make_store({})
    store.data["map_transforms"] = {}
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(1200, 1600), MagicMock(),
        pixel_op={"deg": 90, "sx": 1, "sy": 1}, old_px=(1600, 1200),
    )
    assert ok is False


# ---------------------------------------------------------------------------
# Origin decoupling: the world pose is write-once
# ---------------------------------------------------------------------------


_ANCHORED = {
    "origin_x_m": 5.0,
    "origin_y_m": 3.0,
    "scale_x_m": 80.0,
    "scale_y_m": 60.0,
    "rotation_rad": 0.3,
    "floor_id": "main",
    "origin_anchored": True,
}


@pytest.mark.asyncio
async def test_replace_keeps_anchored_pose(tmp_path: Path) -> None:
    """A plain image replacement must not re-derive origin/rotation from
    the cosmetic stack — the #56 drift class."""
    store = _make_store(_ANCHORED)
    m = _map(800, 600, stack={"is_master": False, "x_offset": 0.6,
                              "y_offset": 0.5, "rotation": 45})
    ok = await store.async_recompute_transform_for_map("m1", m, MagicMock())
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(5.0)     # NOT 0.6 * 80
    assert t["origin_y_m"] == pytest.approx(3.0)     # NOT 0.5 * 60
    assert t["rotation_rad"] == pytest.approx(0.3)   # NOT radians(45)


@pytest.mark.asyncio
async def test_replace_without_prior_transform_derives_from_stack(tmp_path: Path) -> None:
    """Fresh derivation (legacy px_per_meter, no transform) still uses stack."""
    store = _make_store({})
    store.data["map_transforms"] = {}
    m = _map(800, 600, stack={"is_master": False, "x_offset": 0.5, "y_offset": 0.5})
    m["calibration"]["px_per_meter"] = 10.0
    ok = await store.async_recompute_transform_for_map("m1", m, MagicMock())
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(40.0)    # 0.5 * 80
    assert t["origin_y_m"] == pytest.approx(30.0)


@pytest.mark.asyncio
async def test_set_map_transform_preserves_pose_on_remeasure(tmp_path: Path) -> None:
    """Re-measuring updates the scale but keeps the anchored world pose."""
    store = _make_store(_ANCHORED)
    await store.async_set_map_transform("m1", {
        "origin_x_m": 0.0, "origin_y_m": 0.0,   # client-derived — ignored
        "scale_x_m": 90.0, "scale_y_m": 70.0,
        "rotation_rad": 0.0, "floor_id": "main",
        "reference_measurements": [{"distance_m": 5.0}],
    })
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(5.0)
    assert t["origin_y_m"] == pytest.approx(3.0)
    assert t["rotation_rad"] == pytest.approx(0.3)
    assert t["scale_x_m"] == pytest.approx(90.0)     # scale DID update
    assert t["scale_y_m"] == pytest.approx(70.0)
    assert t["origin_anchored"] is True
    assert t["reference_measurements"] == [{"distance_m": 5.0}]


@pytest.mark.asyncio
async def test_set_map_transform_reanchor_overwrites_pose(tmp_path: Path) -> None:
    """reanchor=True is the explicit authorization to move the pose."""
    store = _make_store(_ANCHORED)
    await store.async_set_map_transform("m1", {
        "origin_x_m": 10.0, "origin_y_m": 8.0,
        "scale_x_m": 80.0, "scale_y_m": 60.0,
        "rotation_rad": 0.0, "floor_id": "main",
    }, reanchor=True)
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(10.0)
    assert t["origin_y_m"] == pytest.approx(8.0)
    assert t["rotation_rad"] == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_set_map_transform_new_map_sanitizes_pose(tmp_path: Path) -> None:
    """A brand-new transform stores the client pose, coerced to finite floats."""
    store = _make_store({})
    store.data["map_transforms"] = {}
    await store.async_set_map_transform("m1", {
        "origin_x_m": float("nan"), "origin_y_m": "junk",
        "scale_x_m": 80.0, "scale_y_m": 60.0, "floor_id": "main",
    })
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == 0.0
    assert t["origin_y_m"] == 0.0
    assert t["rotation_rad"] == 0.0
    assert t["origin_anchored"] is True


@pytest.mark.asyncio
async def test_derive_transforms_skips_existing_valid_transform(tmp_path: Path) -> None:
    """The migrate/boot derive path must never rewrite an existing pose,
    measured or not — calibration pins may depend on it."""
    store = _make_store({
        "origin_x_m": 5.0, "origin_y_m": 3.0,
        "scale_x_m": 80.0, "scale_y_m": 60.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })  # valid origin, NO reference_measurements
    maps_store = MagicMock()
    maps_store.data = {"maps": [{
        "id": "m1", "floor_id": "main",
        "image": {"width": 1600, "height": 1200},
        "stack": {"is_master": True},                 # would derive (0,0)
        "calibration": {"px_per_meter": 20.0},
    }]}
    count = await store.async_derive_transforms(maps_store)
    assert count == 1                                  # counted as done
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(5.0)       # untouched
    assert t["origin_y_m"] == pytest.approx(3.0)


@pytest.mark.asyncio
async def test_setup_stamps_existing_transforms(tmp_path: Path) -> None:
    """Load migration freezes existing poses without changing any numbers."""
    loaded = {
        "map_transforms": {
            "m1": {"origin_x_m": 5.0, "origin_y_m": 3.0, "scale_x_m": 80.0,
                   "scale_y_m": 60.0, "rotation_rad": 0.3, "floor_id": "main"},
            "m2": {"scale_x_m": 40.0, "floor_id": "up"},   # no origin — not stamped
        },
    }
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=loaded)
    store.store.async_save = AsyncMock()
    await store.async_setup()
    t1 = store.data["map_transforms"]["m1"]
    assert t1["origin_anchored"] is True
    assert t1["origin_x_m"] == 5.0 and t1["origin_y_m"] == 3.0
    assert t1["rotation_rad"] == 0.3
    assert "origin_anchored" not in store.data["map_transforms"]["m2"]
    store.store.async_save.assert_awaited()            # stamp persisted
