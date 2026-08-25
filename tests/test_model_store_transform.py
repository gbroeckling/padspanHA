"""Unit tests for ModelStore.async_recompute_transform_for_map."""

from __future__ import annotations

import math
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


def _baked_dims(deg: float, bsx: float, bsy: float,
                ow: int = 1600, oh: int = 1200) -> tuple[int, int]:
    """The canvas the client allocates for a baked rotate+stretch."""
    rad = math.radians(deg)
    ca, sa = abs(math.cos(rad)), abs(math.sin(rad))
    return (math.ceil(ow * bsx * ca + oh * bsy * sa),
            math.ceil(ow * bsx * sa + oh * bsy * ca))


@pytest.mark.asyncio
@pytest.mark.parametrize("deg,bsx,bsy", [(30, 1.5, 1.0), (90, 1.0, 1.4),
                                         (-22.5, 0.8, 1.35)])
async def test_rotated_stretch_bake_composes_instead_of_invalidating(
        deg, bsx, bsy) -> None:
    """A turn baked together with an anisotropic stretch is representable.

    It is a general affine, and it was refused because the five-field record
    could not hold one: `_invalidate()`, the whole placement gone, and the
    panel's "re-measure the map" toast on a map that had been measured. The
    record has σ now and six fields are complete over the invertible 2x2, so
    the refusal outlived what it protected.

    Reachable in one click: Point Align across two differently-shaped pictures
    IS an anisotropic pixel stretch (issue #62), and it is almost always baked
    with a rotation, so this is the ordinary path through that button and not
    an exotic one.

    What is asserted is the physical invariant, not the fields: every feature
    that survived the bake is still at the same metres.
    """
    store = _make_store(_MEASURED)
    nw, nh = _baked_dims(deg, bsx, bsy)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(nw, nh), MagicMock(),
        pixel_op={"deg": deg, "sx": bsx, "sy": bsy}, old_px=(1600, 1200),
    )
    assert ok, "a measured map read unmeasured after one bake"
    t = store.data["map_transforms"]["m1"]
    assert t.get("reference_measurements"), (
        "the map lost the measurement that says it is measured"
    )
    for ofx, ofy in ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.375, 0.25)):
        nfx, nfy = _client_rot_frac(ofx, ofy, 1600, 1200, deg, nw, nh, bsx, bsy)
        wx, wy = store.map_frac_to_metres(nfx, nfy, "m1")
        # Canvas dims round up to whole pixels — ~1 px is 0.05 m at 20 px/m.
        assert wx == pytest.approx(ofx * 80.0, abs=0.06), (ofx, ofy)
        assert wy == pytest.approx(ofy * 60.0, abs=0.06), (ofx, ofy)


@pytest.mark.parametrize("deg,bsx,bsy,leans", [(30, 1.5, 1.0, True),
                                              (90, 1.0, 1.4, False),
                                              (-22.5, 0.8, 1.35, True)])
def test_the_control_what_the_refusal_was_protecting(deg, bsx, bsy, leans) -> None:
    """Why the refusal was right until σ existed, and where it was never right.

    A turn baked with an anisotropic stretch leans the map's two axes apart,
    and dropping that lean — which is all a five-field record could have
    stored — moves the far corner of an 80 x 60 m map by metres. Refusing
    beat writing a straightened record, so the branch was correct for the
    record it was written against.

    A QUARTER turn is the exception and always was: it swaps the two axes and
    leaves them square, so five fields held it exactly. The blanket refusal
    dropped that one too.
    """
    from custom_components.padspan_ha import fabric_truth

    nw, nh = _baked_dims(deg, bsx, bsy)
    o, ex, ey = (
        _client_inverse(fx, fy, 1600, 1200, deg, nw, nh, bsx, bsy)
        for fx, fy in ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0))
    )
    composed = fabric_truth.placement_from_columns(
        (o[0] * 80.0, o[1] * 60.0),
        ((ex[0] - o[0]) * 80.0, (ex[1] - o[1]) * 60.0),
        ((ey[0] - o[0]) * 80.0, (ey[1] - o[1]) * 60.0))
    assert (abs(composed["shear_rad"]) > 0.02) is leans, (
        f"the bake leans {math.degrees(composed['shear_rad']):.2f}°"
    )
    five = {k: v for k, v in composed.items() if k != "shear_rad"}
    assert (fabric_truth.placement_disagreement_m(composed, five) > 1.0) is leans


def _client_inverse(fx, fy, ow, oh, deg, nw, nh, sx=1.0, sy=1.0):
    """Where a NEW image fraction came from in the OLD image — the inverse of
    `_client_rot_frac`, which is what the composition has to solve."""
    rad = math.radians(deg)
    px, py = fx * nw - nw / 2, fy * nh - nh / 2
    rx = px * math.cos(rad) + py * math.sin(rad)
    ry = py * math.cos(rad) - px * math.sin(rad)
    return ((rx / sx + ow / 2) / ow, (ry / sy + oh / 2) / oh)


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
async def test_replace_without_prior_transform_places_it_at_the_origin(tmp_path: Path) -> None:
    """A map with no anchored placement is a map nobody has placed.

    It used to read `x_offset * scale_x_m` off the stack here — the OTHER copy
    of the placement — so replacing an unplaced map's image invented a
    position for it out of a cosmetic alignment. There is no other copy; the
    honest pose for a map nobody has placed is the origin, unturned, and the
    scale this derives from px_per_meter is the only thing it actually knows.
    """
    store = _make_store({})
    store.data["map_transforms"] = {}
    m = _map(800, 600, stack={"x_offset": 0.5, "y_offset": 0.5})
    m["calibration"]["px_per_meter"] = 10.0
    ok = await store.async_recompute_transform_for_map("m1", m, MagicMock())
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == 0.0
    assert t["origin_y_m"] == 0.0
    assert t["scale_x_m"] == pytest.approx(80.0)
    assert t["scale_y_m"] == pytest.approx(60.0)


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
async def test_set_map_transform_does_not_preserve_nan_rotation(tmp_path: Path) -> None:
    """A stored NaN rotation must not survive over the sanitized incoming
    value — it would poison every later conversion (codex review)."""
    bad = dict(_ANCHORED)
    bad["rotation_rad"] = float("nan")
    store = _make_store(bad)
    await store.async_set_map_transform("m1", {
        "origin_x_m": 0.0, "origin_y_m": 0.0,
        "scale_x_m": 90.0, "scale_y_m": 70.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    t = store.data["map_transforms"]["m1"]
    assert t["rotation_rad"] == 0.0                  # finite, not NaN
    assert t["origin_x_m"] == pytest.approx(5.0)     # origin still preserved


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


@pytest.mark.asyncio
async def test_setup_stamp_is_persisted_even_when_nothing_else_changes(tmp_path: Path) -> None:
    """self.data is a SHALLOW copy of loaded, so the stamp mutates both and
    the json change-compare alone can never see it — the save must fire from
    the explicit stamp flag (lean-review finding)."""
    import copy as _copy
    # Pass 1: produce a fully-normalized store shape.
    seed = ModelStore.__new__(ModelStore)
    seed.hass = MagicMock()
    seed.store = AsyncMock()
    seed.store.async_load = AsyncMock(return_value={
        "map_transforms": {
            "m1": {"origin_x_m": 5.0, "origin_y_m": 3.0, "scale_x_m": 80.0,
                   "scale_y_m": 60.0, "rotation_rad": 0.3, "floor_id": "main"},
        },
    })
    seed.store.async_save = AsyncMock()
    await seed.async_setup()
    # Pass 2: reload that stable shape with the stamp stripped — the ONLY
    # possible change on this load is the stamp itself.
    loaded = _copy.deepcopy(seed.data)
    for _t in loaded["map_transforms"].values():
        _t.pop("origin_anchored", None)
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=loaded)
    store.store.async_save = AsyncMock()
    await store.async_setup()
    assert store.data["map_transforms"]["m1"]["origin_anchored"] is True
    store.store.async_save.assert_awaited()
    # And a fully-stamped reload does NOT rewrite the store (idempotent).
    store2 = ModelStore.__new__(ModelStore)
    store2.hass = MagicMock()
    store2.store = AsyncMock()
    store2.store.async_load = AsyncMock(return_value=_copy.deepcopy(store.data))
    store2.store.async_save = AsyncMock()
    await store2.async_setup()
    store2.store.async_save.assert_not_awaited()


# ---------------------------------------------------------------------------
# A sheared map, through every op this function handles
# ---------------------------------------------------------------------------
#
# THE INVARIANT of an image operation: it changes the picture's pixels, not
# where the house is. Every point still depicted is still in the same place.
#
# The tests above measure that for a SQUARE map — every fixture in this file
# was origin/scale/rotation, five fields, and the record has six. σ is the
# angle between the map's two axes, and rebuilding a placement out of its
# fields drops it: the crop branch was fixed to ask the placement where a
# fraction went instead, and the bake branch was still composing `ρ' = ρ − θ`
# with the naive scales. A turn moves a map's two axes together only while
# they are already square to each other, so a baked rotation on a sheared map
# slid the picture sideways by the lean — 1.09 m on the 20 m map below at a
# 30° turn, 2.18 m at 90° — while the record kept a σ that no longer described
# the axes it was stored beside.


_LEAN_DEG = 5.0

# 20 m x 15 m at 80 px/m — isotropic pixel density, so the bake branch's
# same-scale precondition holds and the op is composed rather than refused.
_SHEARED = {
    "origin_x_m": 3.0,
    "origin_y_m": -1.0,
    "scale_x_m": 20.0,
    "scale_y_m": 15.0,
    "rotation_rad": 0.25,
    "shear_rad": math.radians(_LEAN_DEG),
    "floor_id": "main",
    "origin_anchored": True,
    "reference_measurements": [
        {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 10.0,
         "px_per_meter": 80.0, "angle_deg": 0, "date": "2026-07-01"},
    ],
}

_GRID = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.5, 0.5), (0.137, 0.911)]


def _unmeasured(width: int, height: int) -> dict:
    """The map dict, with no legacy px_per_meter to short-circuit the ops."""
    m = _map(width, height)
    m["calibration"] = {"mode": "none", "px_per_meter": None, "reference_points": []}
    return m


# Each op, as (kwargs for the recompute, new pixel size, old frac → new frac).
_OPS = {
    "bake rotate 30": (
        {"pixel_op": {"deg": 30, "sx": 1, "sy": 1}, "old_px": (1600, 1200)},
        (1986, 1839),
        lambda f: _client_rot_frac(f[0], f[1], 1600, 1200, 30, 1986, 1839),
    ),
    "bake rotate 90": (
        {"pixel_op": {"deg": 90, "sx": 1, "sy": 1}, "old_px": (1600, 1200)},
        (1200, 1600),
        lambda f: _client_rot_frac(f[0], f[1], 1600, 1200, 90, 1200, 1600),
    ),
    "bake scale 0.5": (
        {"pixel_op": {"deg": 0, "sx": 0.5, "sy": 0.5}, "old_px": (1600, 1200)},
        (800, 600),
        lambda f: f,
    ),
    "pure resample": (
        {}, (800, 600), lambda f: f,
    ),
    "crop": (
        {"crop": {"fx0": 0.18, "fy0": 0.31, "fx1": 0.77, "fy1": 0.94}},
        (944, 756),
        lambda f: ((f[0] - 0.18) / 0.59, (f[1] - 0.31) / 0.63),
    ),
}


@pytest.mark.asyncio
@pytest.mark.parametrize("op", sorted(_OPS), ids=sorted(_OPS))
async def test_no_image_operation_moves_a_sheared_map(op) -> None:
    """Where the picture is does not depend on which raster it arrived in."""
    kw, (nw, nh), refrac = _OPS[op]
    store = _make_store(_SHEARED)
    before = {f: store.map_frac_to_metres(*f, "m1") for f in _GRID}

    ok = await store.async_recompute_transform_for_map(
        "m1", _unmeasured(nw, nh), MagicMock(), **kw)
    assert ok, "the fixture no longer exercises this op"

    worst = 0.0
    for f in _GRID:
        g = refrac(f)
        if not (-0.01 <= g[0] <= 1.01 and -0.01 <= g[1] <= 1.01):
            continue        # cropped away — not depicted any more
        # …and the 1% is for the corners of a TURNED raster, which land on the
        # bounding box's edge and fall a rounded pixel either side of it. A
        # crop puts what it discarded tenths of a fraction outside, so nothing
        # this is meant to skip survives the margin.
        after = store.map_frac_to_metres(*g, "m1")
        worst = max(worst, math.hypot(*(a - b for a, b in zip(after, before[f]))))
    # 1 mm: the record is rounded to 0.1 mm and 1 µrad, which on a 20 m span
    # displaces the far corner by ~1e-4 m. The failures this guards are the
    # metres in the control below.
    assert worst < 1e-3, f"{op} moved the picture it kept by {worst:.4f} m"


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["crop", "bake scale 0.5", "pure resample"])
async def test_an_op_that_does_not_turn_the_map_leaves_the_lean_untouched(op) -> None:
    """…and the lean is still ON THE RECORD, not merely implied by numbers
    that happen to land in the right place.

    A crop and an axis-aligned pixel scale rescale the two fraction axes
    without turning either, and a resample does not touch them at all, so none
    of the three says anything about the angle between them. σ is carried
    forward untouched — to the digit, not to a tolerance.
    """
    kw, (nw, nh), _ = _OPS[op]
    store = _make_store(_SHEARED)
    await store.async_recompute_transform_for_map(
        "m1", _unmeasured(nw, nh), MagicMock(), **kw)
    t = store.data["map_transforms"]["m1"]
    assert "shear_rad" in t, f"{op} dropped the lean from the record"
    assert t["shear_rad"] == _SHEARED["shear_rad"], f"{op} restated the lean"


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["bake rotate 30", "bake rotate 90"])
async def test_a_baked_turn_restates_the_lean_it_does_not_drop_it(op) -> None:
    """A turn is the one op here that DOES change σ, and it is not free to.

    Fractions are of the BOUNDING BOX, and a turn gives the raster a new one:
    the same two world axes come out of the new fraction space at a different
    angle to each other (5° becomes 2.5° over the 30° bake below). So the
    lean is recomputed rather than preserved — but recomputed is not dropped,
    and the map is still not square. Where the picture ends up is the
    invariant, and that is the test above.
    """
    kw, (nw, nh), _ = _OPS[op]
    store = _make_store(_SHEARED)
    await store.async_recompute_transform_for_map(
        "m1", _unmeasured(nw, nh), MagicMock(), **kw)
    t = store.data["map_transforms"]["m1"]
    assert "shear_rad" in t, f"{op} dropped the lean from the record"
    assert abs(float(t["shear_rad"])) > 0.01, (
        f"{op} squared the map up: {t['shear_rad']}"
    )


@pytest.mark.asyncio
async def test_the_control_a_five_field_bake_moves_it_metres() -> None:
    """The test above has to be failing for the right reason.

    The composition that was here — `ρ' = ρ − θ`, the naive scales, and an
    origin built from `R(ρ)·(centre ⊙ scale)` — is applied to the same
    fixture, and the same corner is measured again. Neither of the two tests
    above is passing because the fixture is square.
    """
    for deg, expect in ((30, 1.0), (90, 2.0)):
        store = _make_store(_SHEARED)
        rad = math.radians(deg)
        nw, nh = (1986, 1839) if deg == 30 else (1200, 1600)
        ppm, k = 1600 / 20.0, 1.0
        rot0, o0x, o0y = 0.25, 3.0, -1.0
        cox, coy = 1600 / 2 / ppm, 1200 / 2 / ppm
        cnx, cny = nw / 2 / (ppm * k), nh / 2 / (ppm * k)
        c0, s0 = math.cos(rot0), math.sin(rot0)
        c1, s1 = math.cos(rot0 - rad), math.sin(rot0 - rad)
        five = {
            **_SHEARED,
            "origin_x_m": o0x + (cox * c0 - coy * s0) - (cnx * c1 - cny * s1),
            "origin_y_m": o0y + (cox * s0 + coy * c0) - (cnx * s1 + cny * c1),
            "scale_x_m": nw / (ppm * k), "scale_y_m": nh / (ppm * k),
            "rotation_rad": rot0 - rad,
        }
        moved = 0.0
        for f in _GRID:
            g = _client_rot_frac(f[0], f[1], 1600, 1200, deg, nw, nh)
            a = _make_store(five).map_frac_to_metres(*g, "m1")
            b = _make_store(_SHEARED).map_frac_to_metres(*f, "m1")
            moved = max(moved, math.hypot(a[0] - b[0], a[1] - b[1]))
        assert moved > expect, f"{deg} deg: only {moved:.4f} m"
