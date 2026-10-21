"""Unit tests for custom_components.padspan_ha.maps_store."""

from __future__ import annotations

import base64
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.maps_store import (
    MAX_MAP_BYTES,
    MapsStore,
    _sha256,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store(tmp_path: Path) -> MapsStore:
    """Create a MapsStore with a mock hass backed by *tmp_path*."""
    hass = MagicMock()
    hass.config.path = lambda *parts: str(tmp_path.joinpath(*parts))

    store = MapsStore.__new__(MapsStore)
    store.hass = hass
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.maps_dir = tmp_path / "www" / "padspan_ha" / "maps"
    store.maps_dir.mkdir(parents=True, exist_ok=True)
    store.data = {"maps": []}
    return store


def _small_png_b64() -> str:
    """Return a small, valid-ish PNG payload encoded as base64."""
    # 1x1 transparent PNG (67 bytes)
    raw = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(raw).decode()


# ---------------------------------------------------------------------------
# Tests: file size limit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_map_rejects_oversized_base64(tmp_path: Path) -> None:
    """Base64 string longer than the b64 equivalent of MAX_MAP_BYTES is rejected."""
    store = _make_store(tmp_path)
    # Create a base64 string that exceeds the limit check
    oversized_b64 = "A" * ((MAX_MAP_BYTES * 4) // 3 + 5 + 100)
    with pytest.raises(ValueError, match="exceeds"):
        await store.async_add_map(
            name="big",
            filename="big.png",
            mime="image/png",
            width=100,
            height=100,
            png_base64=oversized_b64,
        )


@pytest.mark.asyncio
async def test_add_map_rejects_oversized_decoded(tmp_path: Path) -> None:
    """Decoded bytes larger than MAX_MAP_BYTES are rejected even if b64 was short enough."""
    store = _make_store(tmp_path)
    # Build raw bytes that are exactly 1 byte over the limit
    raw = b"\x00" * (MAX_MAP_BYTES + 1)
    b64 = base64.b64encode(raw).decode()
    with pytest.raises(ValueError, match="exceeds"):
        await store.async_add_map(
            name="big",
            filename="big.png",
            mime="image/png",
            width=100,
            height=100,
            png_base64=b64,
        )


# ---------------------------------------------------------------------------
# Tests: path traversal protection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_map_rejects_path_traversal(tmp_path: Path) -> None:
    """A map whose filename contains '..' must not escape maps_dir."""
    store = _make_store(tmp_path)
    # Manually insert a map entry with a malicious filename
    bad_map = {
        "id": "evil",
        "image": {"filename": "../../etc/passwd"},
        "receivers": [],
        "calibration": {},
        "notes": "",
        "floor_id": "main",
        "room_bounds": {},
        "stack": {},
    }
    store.data["maps"].append(bad_map)

    # The delete method should silently skip the file (resolve check fails)
    await store.async_delete_map("evil")
    # Map entry should still be removed from the data list
    assert store.get_map("evil") is None


@pytest.mark.asyncio
async def test_replace_image_rejects_path_traversal(tmp_path: Path) -> None:
    """async_replace_image rejects filenames that resolve outside maps_dir."""
    store = _make_store(tmp_path)
    bad_map = {
        "id": "evil2",
        "image": {"filename": "../../../tmp/attack.png"},
        "receivers": [],
        "calibration": {},
        "notes": "",
        "floor_id": "main",
        "room_bounds": {},
        "stack": {},
    }
    store.data["maps"].append(bad_map)

    with pytest.raises(ValueError, match="Invalid filename"):
        await store.async_replace_image(
            map_id="evil2",
            png_base64=_small_png_b64(),
            width=1,
            height=1,
        )


def test_a_sibling_folder_sharing_the_prefix_is_outside(tmp_path: Path) -> None:
    """`maps_x` starts with the same characters as `maps` but is not in it."""
    store = _make_store(tmp_path)
    (store.maps_dir.parent / "maps_x").mkdir()
    (store.maps_dir.parent / "maps_x" / "f.png").write_bytes(b"x")
    assert store.image_file("../maps_x/f.png", must_exist=False) is None
    assert store.image_file("../maps_x/f.png", must_exist=True) is None
    assert store.image_file("a.png", must_exist=False) == (store.maps_dir / "a.png").resolve()


# ---------------------------------------------------------------------------
# Tests: empty / undecodable uploads
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("payload, why", [
    ("", "empty"),                                         # a backup whose image export failed
    ("A", "base64"),                                       # not base64 at all
    (base64.b64encode(b"<html>nope</html>").decode(), "not a PNG"),
])
async def test_add_map_refuses_a_picture_that_is_not_one(tmp_path: Path, payload: str, why: str) -> None:
    store = _make_store(tmp_path)
    with pytest.raises(ValueError, match=why):
        await store.async_add_map("Ground", "g.png", "image/png", 800, 600, payload)
    assert list(store.maps_dir.iterdir()) == [], "a file was written for a picture that isn't one"
    assert store.list_maps() == []


# ---------------------------------------------------------------------------
# Tests: a backup restore of a map whose backup has no picture
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_restore_without_a_picture_keeps_the_map_and_its_data(tmp_path: Path) -> None:
    """allow_no_image creates the map with no file; everything else comes through."""
    store = _make_store(tmp_path)
    info = await store.async_add_map("Ground", "g.png", "image/png", 1600, 1200, "",
                                     allow_no_image=True)
    assert info["image"]["missing"] is True
    assert (info["image"]["width"], info["image"]["height"]) == (1600, 1200)
    assert list(store.maps_dir.iterdir()) == [], "no picture, so no file"

    cal = {"mode": "two_point", "px_per_meter": 42.5,
           "reference_points": [{"x": 0.1, "y": 0.2}, {"x": 0.8, "y": 0.2}]}
    bounds = {"Kitchen": {"type": "poly", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]}}
    rx = [{"id": "esp-kitchen", "label": "Kitchen", "x": 0.3, "y": 0.3, "room": "Kitchen"}]
    await store.async_update_map(info["id"], calibration=cal, room_bounds=bounds, receivers=rx,
                                 stack={"z_level": 1, "ceiling_height_m": 2.7})
    m = store.get_map(info["id"])
    assert m["calibration"]["px_per_meter"] == 42.5
    assert m["calibration"]["reference_points"] == cal["reference_points"]
    assert m["room_bounds"]["Kitchen"]["points"] == bounds["Kitchen"]["points"]
    assert [(r["id"], r["x"], r["y"]) for r in m["receivers"]] == [("esp-kitchen", 0.3, 0.3)]
    assert m["stack"]["z_level"] == 1

    # Re-uploading the picture at the stored size fills it in and moves nothing.
    await store.async_replace_image(info["id"], _small_png_b64(), 1600, 1200)
    m = store.get_map(info["id"])
    assert "missing" not in m["image"]
    assert (store.maps_dir / m["image"]["filename"]).exists()
    assert m["room_bounds"]["Kitchen"]["points"] == bounds["Kitchen"]["points"]
    assert m["calibration"]["px_per_meter"] == 42.5


@pytest.mark.asyncio
async def test_allow_no_image_still_refuses_a_picture_that_is_not_a_png(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    with pytest.raises(ValueError, match="not a PNG"):
        await store.async_add_map("Ground", "g.jpg", "image/jpeg", 800, 600,
                                  base64.b64encode(b"\xff\xd8\xff\xe0JFIF").decode(),
                                  allow_no_image=True)
    assert store.list_maps() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("payload, extra, code", [
    ("", {}, "invalid_image"),                                   # the Upload tab: still refused
    ("A", {}, "invalid_image"),
    (base64.b64encode(b"<html>nope</html>").decode(), {}, "invalid_image"),
    ("A" * ((MAX_MAP_BYTES * 4) // 3 + 8), {}, "upload_too_large"),
    ("", {"allow_no_image": True}, None),                        # the backup restore
], ids=["empty", "bad-base64", "not-png", "too-large", "restore-no-image"])
async def test_the_upload_command_names_what_was_wrong(tmp_path: Path, payload, extra, code) -> None:
    from custom_components.padspan_ha.const import DATA_MAPS, DOMAIN
    from custom_components.padspan_ha.ws_maps import ws_maps_upload

    store = _make_store(tmp_path)
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MAPS: store}}
    conn = MagicMock()
    await ws_maps_upload(hass, conn, {"id": 1, "type": "padspan_ha/maps_upload", "name": "Ground",
                                      "filename": "g.png", "mime": "image/png", "width": 800,
                                      "height": 600, "png_base64": payload, **extra})
    if code is None:
        conn.send_error.assert_not_called()
        assert conn.send_result.call_args[0][1]["map"]["image"]["missing"] is True
    else:
        assert conn.send_error.call_args[0][1] == code
        assert store.list_maps() == []


# ---------------------------------------------------------------------------
# Tests: add / get / delete lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_get_delete_lifecycle(tmp_path: Path) -> None:
    """Add a map, retrieve it by id, delete it, confirm gone."""
    store = _make_store(tmp_path)
    b64 = _small_png_b64()

    info = await store.async_add_map(
        name="Living Room",
        filename="living.png",
        mime="image/png",
        width=800,
        height=600,
        png_base64=b64,
    )

    map_id = info["id"]
    assert isinstance(map_id, str) and len(map_id) == 16  # os.urandom(8).hex()

    # get_map returns the same info
    fetched = store.get_map(map_id)
    assert fetched is not None
    assert fetched["name"] == "Living Room"
    assert fetched["image"]["width"] == 800
    assert fetched["image"]["height"] == 600

    # list_maps includes it
    assert len(store.list_maps()) == 1

    # Delete
    await store.async_delete_map(map_id)
    assert store.get_map(map_id) is None
    assert len(store.list_maps()) == 0


@pytest.mark.asyncio
async def test_get_nonexistent_map_returns_none(tmp_path: Path) -> None:
    """get_map for a missing ID returns None."""
    store = _make_store(tmp_path)
    assert store.get_map("does_not_exist") is None


@pytest.mark.asyncio
async def test_delete_nonexistent_map_is_noop(tmp_path: Path) -> None:
    """Deleting a map ID that doesn't exist should not raise."""
    store = _make_store(tmp_path)
    await store.async_delete_map("nope")  # should not raise


# ---------------------------------------------------------------------------
# Tests: name truncation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_name_truncated_to_120_chars(tmp_path: Path) -> None:
    """Map name is truncated to 120 characters."""
    store = _make_store(tmp_path)
    long_name = "X" * 300
    info = await store.async_add_map(
        name=long_name,
        filename="f.png",
        mime="image/png",
        width=1,
        height=1,
        png_base64=_small_png_b64(),
    )
    assert len(info["name"]) == 120


@pytest.mark.asyncio
async def test_empty_name_becomes_untitled(tmp_path: Path) -> None:
    """An empty name defaults to 'Untitled Map'."""
    store = _make_store(tmp_path)
    info = await store.async_add_map(
        name="",
        filename="f.png",
        mime="image/png",
        width=1,
        height=1,
        png_base64=_small_png_b64(),
    )
    assert info["name"] == "Untitled Map"


@pytest.mark.asyncio
async def test_original_filename_truncated_to_180(tmp_path: Path) -> None:
    """Original filename is truncated to 180 characters."""
    store = _make_store(tmp_path)
    info = await store.async_add_map(
        name="ok",
        filename="A" * 500 + ".png",
        mime="image/png",
        width=1,
        height=1,
        png_base64=_small_png_b64(),
    )
    assert len(info["image"]["original_filename"]) == 180


# ---------------------------------------------------------------------------
# Tests: _sha256 helper
# ---------------------------------------------------------------------------


def test_sha256_helper() -> None:
    """_sha256 returns the correct hex digest for known input."""
    import hashlib

    data = b"padspan"
    expected = hashlib.sha256(data).hexdigest()
    assert _sha256(data) == expected


# ---------------------------------------------------------------------------
# A field is changed only by a payload that STATES it
# ---------------------------------------------------------------------------
#
# `async_update_map` rebuilt six stack fields from the constants in its own
# signature every time it was handed a `stack` dict, so a caller sending one
# field snapped the other five back to a pristine placement. It is the
# identical "absent means delete" defect the σ rule fixed on `map_transforms`,
# on the sibling record.
#
# FOUR OF THE SIX WERE PLACEMENT and are gone with the second copy: x_offset,
# y_offset, scale and rotation said where the map sat, in world units, beside
# a metre record that said the same thing differently. What is left is the
# residue a placement cannot express — which storey, how tall, what it was
# aligned against, and the tie-in constraints — and the rule still governs it.

_PLACED = {"z_level": 2, "ceiling_height_m": 2.7, "ref_map_id": "m0",
           "tie_ins": [{"ref_map_id": "m0", "origin_x_m": 1.0, "origin_y_m": 2.0,
                        "scale_x_m": 20.0, "scale_y_m": 15.0,
                        "rotation_rad": 0.0, "shear_rad": 0.0}]}

_REBUILT_FROM_DEFAULTS = {"z_level": 0, "ceiling_height_m": 2.4}


def _placed_map(tmp_path: Path) -> MapsStore:
    store = _make_store(tmp_path)
    store.data = {"maps": [{
        "id": "m1", "name": "Ground", "floor_id": "main",
        "image": {"width": 1600, "height": 1200},
        "receivers": [], "notes": "", "calibration": {"mode": "none"},
        "room_bounds": {}, "stack": dict(_PLACED),
    }]}
    return store


@pytest.mark.parametrize("field,value", [("z_level", 3), ("ceiling_height_m", 3.1),
                                         ("ref_map_id", "m9")],
                         ids=["z_level", "ceiling_height_m", "ref_map_id"])
@pytest.mark.asyncio
async def test_a_partial_stack_update_changes_only_what_it_states(
        tmp_path, field, value) -> None:
    """The 3D Stack table edits one cell. It must not lose anything else."""
    store = _placed_map(tmp_path)
    await store.async_update_map("m1", stack={field: value})

    stk = store.data["maps"][0]["stack"]
    assert stk[field] == value, "the field the caller stated did not change"
    for k, was in _PLACED.items():
        if k == field:
            continue
        assert stk[k] == was, (
            f"stating {field} reset {k} to {stk.get(k)}; the stored value was {was}"
        )


@pytest.mark.asyncio
async def test_no_placement_field_survives_a_stack_write(tmp_path) -> None:
    """A stack cannot HOLD a placement any more, whatever a client sends.

    The panel is not the only writer of this store — a restored backup and a
    hand-edited `.storage` both come through here — so the sanitiser is what
    makes "one stored placement" a property of the data rather than of the
    code that usually writes it.
    """
    store = _placed_map(tmp_path)
    await store.async_update_map("m1", stack={
        "z_level": 1, "x_offset": 0.42, "y_offset": -0.17, "scale": 1.35,
        "rotation": 30.0, "scale_x_adj": 1.1, "ref_ar": 0.75,
        "is_master": True, "_m": [1, 0, 0, 1], "_m_ar": 0.75,
    })
    stk = store.data["maps"][0]["stack"]
    assert set(stk) <= {"z_level", "ceiling_height_m", "ref_map_id", "tie_ins", "floor_id"}, (
        f"a placement field survived a stack write: {sorted(set(stk))}"
    )


@pytest.mark.asyncio
async def test_a_map_with_no_stack_still_gets_the_defaults(tmp_path) -> None:
    """Carried is not invented: with nothing stored the constants are right."""
    store = _make_store(tmp_path)
    store.data = {"maps": [{"id": "m1", "name": "Ground", "floor_id": "main",
                            "image": {"width": 1600, "height": 1200},
                            "receivers": [], "notes": "",
                            "calibration": {"mode": "none"}, "room_bounds": {}}]}
    await store.async_update_map("m1", stack={"z_level": 1})
    stk = store.data["maps"][0]["stack"]
    assert stk["z_level"] == 1
    assert stk["ceiling_height_m"] == 2.4


@pytest.mark.asyncio
async def test_a_new_map_is_not_placed_anywhere(tmp_path) -> None:
    """An uploaded picture has no position and no size until somebody gives it
    one. It used to be born at scale 1.0 at the world origin, which is
    indistinguishable from a placement and is not one."""
    store = _make_store(tmp_path)
    m = await store.async_add_map("Ground", "g.png", "image/png", 800, 600, _small_png_b64())
    assert set(m["stack"]) == {"z_level", "ceiling_height_m"}
