# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Image-anchored data follows its image. Unconditionally.

A map carries two kinds of fractional data. `room_bounds` — the hand trace
OF the picture — has no truth but "these fractions of this image": when the
image moves, the trace must move with it, in the same call, no flag.
Receivers and beacons are fabric-anchored: their truth is metres, their
fractions a rendering, and `skip_frac_renorm` exists so a metre-model
caller can re-derive them instead.

For months `skip_frac_renorm` covered the trace too. Every measured map
trimmed in that window kept pre-trim traces that no code path could ever
correct — `async_rederive_map_fracs` refuses room_bounds (correctly; the
f3466fc incident is what re-deriving it looked like), so the skip left the
trace orphaned in an image space that no longer existed. That is how
rjbutler's basement and upstairs previews (issue #62, third act) came to
draw every room at ~55% of the photo's width: stale full-image fractions
on a cropped image.

These tests pin the repaired contract, per data kind and per operation.
"""

from __future__ import annotations

import base64
import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.maps_store import MapsStore


def _store(tmp_path, *, width=1000, height=800) -> tuple[MapsStore, dict]:
    ms = MapsStore.__new__(MapsStore)
    ms.hass = MagicMock()
    ms.store = AsyncMock()
    ms.maps_dir = tmp_path
    (tmp_path / "m1.png").write_bytes(b"old")
    m = {
        "id": "m1", "floor_id": "main", "name": "Main Floor",
        "image": {"filename": "m1.png", "width": width, "height": height},
        "receivers": [{"id": "rx1", "source": "rx1", "x": 0.8, "y": 0.6}],
        "beacons": [{"key": "b1", "x": 0.7, "y": 0.5}],
        "room_bounds": {
            "kitchen": {"type": "poly", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]},
            "nook": {"type": "circle", "cx": 0.8, "cy": 0.8, "r": 0.1},
        },
    }
    ms.data = {"maps": [m]}
    return ms, m


_PNG = base64.b64encode(b"new-image-bytes").decode()
_CROP = {"fx0": 0.0, "fy0": 0.0, "fx1": 0.55, "fy1": 1.0}  # a right-side trim


@pytest.mark.asyncio
async def test_a_trim_takes_the_trace_along_even_when_fracs_are_skipped(tmp_path) -> None:
    """THE fix. skip_frac_renorm=True is the measured-map path — the one
    that stranded rjbutler's traces. The trace renormalizes anyway."""
    ms, m = _store(tmp_path)
    await ms.async_replace_image("m1", _PNG, 550, 800, crop=dict(_CROP), skip_frac_renorm=True)

    pts = m["room_bounds"]["kitchen"]["points"]
    # (0.1 - 0)/0.55 etc. — the trace now speaks the cropped image's fractions.
    assert pts[0][0] == pytest.approx(0.1 / 0.55)
    assert pts[1][0] == pytest.approx(0.5 / 0.55)
    assert pts[0][1] == pytest.approx(0.1)  # y-axis untouched by an x-only trim
    assert m["room_bounds"]["nook"]["cx"] == pytest.approx(0.8 / 0.55, abs=1e-9) or \
        m["room_bounds"]["nook"]["cx"] == pytest.approx(1.0)  # clamped if past the edge

    # Fabric-anchored overlays honoured the skip — the caller re-derives them.
    assert m["receivers"][0]["x"] == pytest.approx(0.8)
    assert m["beacons"][0]["x"] == pytest.approx(0.7)


@pytest.mark.asyncio
async def test_the_unmeasured_path_still_renormalizes_everything(tmp_path) -> None:
    """No metre model, no re-derive coming — the crop renorm covers all
    three kinds, exactly as it always did."""
    ms, m = _store(tmp_path)
    await ms.async_replace_image("m1", _PNG, 550, 800, crop=dict(_CROP), skip_frac_renorm=False)

    assert m["room_bounds"]["kitchen"]["points"][0][0] == pytest.approx(0.1 / 0.55)
    assert m["receivers"][0]["x"] == pytest.approx(0.8 / 0.55, abs=1e-9) or m["receivers"][0]["x"] == 1.0
    assert m["beacons"][0]["x"] == pytest.approx(0.7 / 0.55, abs=1e-9) or m["beacons"][0]["x"] == 1.0


@pytest.mark.asyncio
async def test_a_baked_rotate_turns_the_trace_with_the_picture(tmp_path) -> None:
    """The other creation vector: a 90° bake arrives as a replace with a
    pixel_op and no crop. Before this, the trace stayed in pre-rotation
    space on every measured map, every single time."""
    ms, m = _store(tmp_path, width=1000, height=800)
    # 90° CCW in canvas form: new canvas is 800x1000.
    await ms.async_replace_image("m1", _PNG, 800, 1000, crop=None,
                                 skip_frac_renorm=True, pixel_op={"deg": 90, "sx": 1, "sy": 1})

    # Old frac (0.1, 0.1) → centred px (-400, -320)·? — check via the same
    # arithmetic the code uses: dx=(fx-.5)·ow, dy=(fy-.5)·oh, rotate, /new.
    def expect(fx, fy):
        dx = (fx - 0.5) * 1000
        dy = (fy - 0.5) * 800
        c, s = math.cos(math.radians(90)), math.sin(math.radians(90))
        return (0.5 + (dx * c - dy * s) / 800, 0.5 + (dx * s + dy * c) / 1000)

    got = m["room_bounds"]["kitchen"]["points"]
    for (gx, gy), (fx, fy) in zip(got, [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]):
        ex, ey = expect(fx, fy)
        assert gx == pytest.approx(max(0.0, min(1.0, ex)), abs=1e-9)
        assert gy == pytest.approx(max(0.0, min(1.0, ey)), abs=1e-9)
    # Receivers wait for the metre re-derive, as ever.
    assert m["receivers"][0]["x"] == pytest.approx(0.8)


@pytest.mark.asyncio
async def test_a_plain_replace_moves_nothing(tmp_path) -> None:
    """No crop, no declared bake — a pure resample. Every fraction maps 1:1
    onto the new pixels; touching anything would be inventing an op the
    client never declared."""
    ms, m = _store(tmp_path)
    before = {r: [list(p) for p in b["points"]] if b.get("type") == "poly" else dict(b)
              for r, b in m["room_bounds"].items()}
    await ms.async_replace_image("m1", _PNG, 2000, 1600, crop=None, skip_frac_renorm=True)
    assert m["room_bounds"]["kitchen"]["points"] == before["kitchen"]
    assert m["room_bounds"]["nook"]["cx"] == before["nook"]["cx"]


@pytest.mark.asyncio
async def test_the_trace_stays_on_the_same_square_metre_of_house(tmp_path) -> None:
    """The invariant end to end, in the units that matter. A trim rebases
    the placement (scale × retained fraction, origin at the cut corner) and
    renormalizes the trace; composed, every surviving trace point must land
    on the SAME metres it described before the trim."""
    ms, m = _store(tmp_path)
    p_old = {"origin_x_m": 2.0, "origin_y_m": 1.0, "scale_x_m": 20.0,
             "scale_y_m": 16.0, "rotation_rad": 0.0, "shear_rad": 0.0}
    orig = [list(p) for p in m["room_bounds"]["kitchen"]["points"]]

    await ms.async_replace_image("m1", _PNG, 550, 800, crop=dict(_CROP), skip_frac_renorm=True)
    p_new = fabric_truth.rebase_placement(p_old, _CROP["fx0"], _CROP["fy0"],
                                          _CROP["fx1"] - _CROP["fx0"], _CROP["fy1"] - _CROP["fy0"])

    for (ofx, ofy), (nfx, nfy) in zip(orig, m["room_bounds"]["kitchen"]["points"]):
        was = fabric_truth.placement_metres(p_old, ofx, ofy)
        now = fabric_truth.placement_metres(p_new, nfx, nfy)
        assert was[0] == pytest.approx(now[0], abs=1e-6)
        assert was[1] == pytest.approx(now[1], abs=1e-6)


@pytest.mark.asyncio
async def test_a_bake_and_the_composed_placement_agree_on_the_house(tmp_path) -> None:
    """The non-circular check. The bounds bake (maps_store) and the
    placement composition (model_store) are written independently; if their
    rotation conventions ever disagree, every traced point silently moves
    to a different square metre. So: run BOTH real code paths on a rotated,
    world-rotated map and demand the composition closes — same metres
    before and after, for every point."""
    from custom_components.padspan_ha.model_store import ModelStore

    ms, m = _store(tmp_path, width=1000, height=800)
    p_old = {"origin_x_m": 3.0, "origin_y_m": 2.0, "scale_x_m": 20.0,
             "scale_y_m": 16.0, "rotation_rad": 0.3, "shear_rad": 0.0}
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock(); mdl.store = AsyncMock(); mdl.fabric = None
    mdl.data = {"map_transforms": {"m1": dict(p_old)}}

    orig = [list(p) for p in m["room_bounds"]["kitchen"]["points"]]
    op = {"deg": 90, "sx": 1, "sy": 1}

    # The handler's order: replace (renorms the trace), then recompute the
    # placement from the SAME declared op and the old pixel dims.
    await ms.async_replace_image("m1", _PNG, 800, 1000, crop=None,
                                 skip_frac_renorm=True, pixel_op=dict(op))
    ok = await mdl.async_recompute_transform_for_map("m1", m, ms, pixel_op=dict(op),
                                                     old_px=(1000, 800))
    assert ok, "the composition must accept the same op the bounds took"
    p_new = mdl.map_transform("m1")

    for (ofx, ofy), (nfx, nfy) in zip(orig, m["room_bounds"]["kitchen"]["points"]):
        was = fabric_truth.placement_metres(p_old, ofx, ofy)
        now = fabric_truth.placement_metres(p_new, nfx, nfy)
        assert now[0] == pytest.approx(was[0], abs=0.01), (ofx, ofy)
        assert now[1] == pytest.approx(was[1], abs=0.01), (ofx, ofy)


@pytest.mark.asyncio
async def test_a_declared_bake_outranks_a_crop_in_both_layers(tmp_path) -> None:
    """No client sends both today. If one ever does, maps_store and
    model_store must pick the SAME op — model_store composes the bake
    first, so the trace follows the bake, not the crop."""
    ms, m = _store(tmp_path, width=1000, height=800)
    await ms.async_replace_image("m1", _PNG, 800, 1000, crop=dict(_CROP),
                                 skip_frac_renorm=True, pixel_op={"deg": 90, "sx": 1, "sy": 1})
    # Bake applied (axes mixed), crop ignored: the first kitchen x cannot be
    # the crop renorm's 0.1/0.55.
    assert m["room_bounds"]["kitchen"]["points"][0][0] != pytest.approx(0.1 / 0.55)


# ── Cross-map migration: the same discipline between two images ──────────────

@pytest.mark.asyncio
async def test_migrating_a_circle_scales_its_radius_from_source_values(tmp_path) -> None:
    """The radius probe reads the SOURCE record. It used to read the centre
    AFTER it had been overwritten with the target-space value, so it
    transformed (target_cx + r, target_cy) as if that were a source point —
    a wrong radius whenever the two placements differ at all, which is the
    whole reason a migration runs. Source 10 m wide, target 20 m wide: a
    0.12 circle must land at 0.06, not 0.141."""
    from custom_components.padspan_ha.model_store import ModelStore
    from custom_components.padspan_ha.ws_maps import ws_maps_delete_migrate
    from custom_components.padspan_ha.const import DOMAIN, DATA_MAPS, DATA_MODEL

    ms = MapsStore.__new__(MapsStore)
    ms.hass = MagicMock(); ms.store = AsyncMock(); ms.maps_dir = tmp_path
    src = {"id": "s1", "floor_id": "main", "name": "Src",
           "image": {"filename": "s1.png", "width": 500, "height": 400},
           "receivers": [], "beacons": [],
           "room_bounds": {"den": {"type": "circle", "cx": 0.5, "cy": 0.5, "r": 0.12}},
           "stack": {"z_level": 0}}
    tgt = {"id": "t1", "floor_id": "main", "name": "Tgt",
           "image": {"filename": "t1.png", "width": 1000, "height": 800},
           "receivers": [], "beacons": [], "room_bounds": {},
           "stack": {"z_level": 0}}
    ms.data = {"maps": [src, tgt]}
    ms.async_delete_map = AsyncMock(return_value=True)

    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock(); mdl.store = AsyncMock(); mdl.fabric = None
    mdl.data = {"map_transforms": {
        "s1": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0,
               "scale_y_m": 8.0, "rotation_rad": 0.0, "shear_rad": 0.0},
        "t1": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
               "scale_y_m": 16.0, "rotation_rad": 0.0, "shear_rad": 0.0},
    }}

    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MAPS: ms, DATA_MODEL: mdl}}
    conn = MagicMock()
    await ws_maps_delete_migrate(hass, conn, {"id": 1, "map_id": "s1", "target_map_id": "t1"})

    assert conn.send_result.called, getattr(conn.send_error, "call_args", None)
    moved = tgt["room_bounds"]["den"]
    assert moved["cx"] == pytest.approx(0.25, abs=1e-6)
    assert moved["cy"] == pytest.approx(0.25, abs=1e-6)
    assert moved["r"] == pytest.approx(0.06, abs=1e-6), "radius must scale from SOURCE values"


@pytest.mark.asyncio
async def test_a_proportional_trim_keeps_a_circle_rooms_real_size(tmp_path) -> None:
    """r is a fraction of the picture; trim the picture and the fraction
    must grow so the ROOM stays the same size. The old code left r alone,
    shrinking every circle room by the trimmed-off share — and the
    reconcile's convergence check would then refuse the room forever."""
    ms, m = _store(tmp_path)
    p_old = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
             "scale_y_m": 16.0, "rotation_rad": 0.0, "shear_rad": 0.0}
    r_m_before = m["room_bounds"]["nook"]["r"] * (20.0 + 16.0) / 2  # r · avg scale

    crop = {"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5}  # proportional
    await ms.async_replace_image("m1", _PNG, 500, 400, crop=crop, skip_frac_renorm=True)
    p_new = fabric_truth.rebase_placement(p_old, 0.0, 0.0, 0.5, 0.5)
    r_m_after = m["room_bounds"]["nook"]["r"] * (p_new["scale_x_m"] + p_new["scale_y_m"]) / 2
    assert r_m_after == pytest.approx(r_m_before, rel=1e-6)


@pytest.mark.asyncio
async def test_a_rotate_leaves_a_circles_radius_alone(tmp_path) -> None:
    """Dims swap, mean extent unchanged — a turn does not resize a room."""
    ms, m = _store(tmp_path, width=1000, height=800)
    r_before = m["room_bounds"]["nook"]["r"]
    await ms.async_replace_image("m1", _PNG, 800, 1000, crop=None,
                                 skip_frac_renorm=True, pixel_op={"deg": 90, "sx": 1, "sy": 1})
    assert m["room_bounds"]["nook"]["r"] == pytest.approx(r_before, rel=1e-9)


@pytest.mark.asyncio
async def test_an_unmeasured_bake_takes_the_pins_along_too(tmp_path) -> None:
    """No metre model means no re-derive is ever coming for receivers and
    beacons — so on that path they take the same bake the trace takes, or a
    rotate strands them in pre-rotation fractions with no writer left."""
    ms, m = _store(tmp_path, width=1000, height=800)
    await ms.async_replace_image("m1", _PNG, 800, 1000, crop=None,
                                 skip_frac_renorm=False, pixel_op={"deg": 90, "sx": 1, "sy": 1})
    # (0.8, 0.6) through the 90° centre bake on 1000x800 → 800x1000.
    dx, dy = (0.8 - 0.5) * 1000, (0.6 - 0.5) * 800
    ex = 0.5 + (dx * math.cos(math.radians(90)) - dy * math.sin(math.radians(90))) / 800
    ey = 0.5 + (dx * math.sin(math.radians(90)) + dy * math.cos(math.radians(90))) / 1000
    assert m["receivers"][0]["x"] == pytest.approx(max(0, min(1, ex)), abs=1e-9)
    assert m["receivers"][0]["y"] == pytest.approx(max(0, min(1, ey)), abs=1e-9)
    # The measured path still leaves them for the metre re-derive — pinned
    # by test_a_baked_rotate_turns_the_trace_with_the_picture above.


@pytest.mark.asyncio
async def test_replacing_the_image_invalidates_the_extend_snapshot(tmp_path) -> None:
    """_pre_extend describes the picture it was taken from; a revert reading
    it after a replace would crop the wrong rectangle out of the wrong
    image."""
    ms, m = _store(tmp_path)
    m["_pre_extend"] = {"width": 900, "height": 700, "pad_left": 50,
                        "pad_right": 50, "pad_top": 50, "pad_bottom": 50}
    await ms.async_replace_image("m1", _PNG, 550, 800, crop=dict(_CROP), skip_frac_renorm=True)
    assert "_pre_extend" not in m


@pytest.mark.asyncio
async def test_the_rederive_still_refuses_the_trace(tmp_path) -> None:
    """The design's load-bearing premise, pinned: `async_rederive_map_fracs`
    re-derives fabric-anchored pins from metres and never touches
    room_bounds — deriving the trace from metres is the f3466fc incident.
    The image-op renorm in maps_store is the trace's ONLY mover."""
    import copy as _copy
    from custom_components.padspan_ha.model_store import ModelStore

    ms, m = _store(tmp_path)
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock(); mdl.store = AsyncMock()
    # Positions read through the FabricStore, the same as live.
    fab = MagicMock()
    fab.scanner_positions_m.return_value = {"rx1": {"x_m": 5.0, "y_m": 4.0, "map_id": "m1"}}
    fab.beacon_positions_m.return_value = {}
    fab.rf_barriers_m.return_value = []
    mdl.fabric = fab
    mdl.data = {"map_transforms": {"m1": {"origin_x_m": 0.0, "origin_y_m": 0.0,
                                          "scale_x_m": 20.0, "scale_y_m": 16.0,
                                          "rotation_rad": 0.0, "shear_rad": 0.0}}}
    before = _copy.deepcopy(m["room_bounds"])
    n = await mdl.async_rederive_map_fracs("m1", m)
    assert n >= 1, "the receiver pin was re-derived"
    assert m["room_bounds"] == before, "the trace was touched by a metre re-derive"
