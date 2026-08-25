# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Deleting a ghost room polygon is not a placement write.

Both orphan-delete paths in `views/manage.js` rebuild the map's room_bounds
and push the WHOLE map back through `padspan_ha/maps_update`.  They used to
carry `stack: map.stack || {}` with it — the client's copy of the placement,
as this tab last saw it.

`MapsStore.async_update_map` replaced x_offset, y_offset, scale, rotation and
z_level whenever it was handed a dict, so the round trip was a full placement
write: a tab left open on the Manage page, one click on "Delete", and whatever
another tab had since realigned was back to what this one remembered.  Nothing
in the map data says a room polygon was deleted, so there was nothing to
undo it from.

A stack cannot HOLD a placement any more, so a stale copy of one cannot carry
it back — but the same defect survives on what the stack still does hold, and
the residue includes `tie_ins`, which is a list of saved constraints another
tab may have just added to.  The rule is unchanged and this is what checks it.

The payload now has no `stack` key at all, and `isinstance(stack, dict)` is
False for a key that is absent, so the store keeps what is on disk.

Re-adding the key passed the whole suite: nothing ran the payload the panel
builds.  This lifts both object literals out of the shipped file, evaluates
them in node, and posts the result through the real websocket handler onto a
real maps store — so what is measured is a stored placement, not a source file.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.const import DATA_MAPS, DOMAIN
from custom_components.padspan_ha.maps_store import MapsStore
from custom_components.padspan_ha.ws_maps import ws_maps_update

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "orphan_delete_payload.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

# What the OTHER tab realigned the map to while this one sat on the Manage
# page: turned 30°, shifted, and rescaled.
_REALIGNED = {"z_level": 1, "ceiling_height_m": 2.9, "ref_map_id": "m0",
              "tie_ins": [{"ref_map_id": "m0", "origin_x_m": 4.0, "origin_y_m": 5.0,
                           "scale_x_m": 20.0, "scale_y_m": 15.0,
                           "rotation_rad": 0.5, "shear_rad": 0.0}]}

# What the stale tab still has in its copy of the map — the pristine placement.
_STALE = {"z_level": 0, "ceiling_height_m": 2.4, "ref_map_id": None, "tie_ins": []}

_PLACEMENT_KEYS = ("z_level", "ceiling_height_m", "ref_map_id", "tie_ins")


@pytest.fixture(scope="module")
def payloads() -> list[dict]:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS)],
                         capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)["payloads"]


def _store(tmp_path: Path) -> MapsStore:
    hass = MagicMock()
    hass.config.path = lambda *parts: str(tmp_path.joinpath(*parts))
    ms = MapsStore.__new__(MapsStore)
    ms.hass = hass
    ms.store = AsyncMock()
    ms.store.async_save = AsyncMock()
    ms.maps_dir = tmp_path
    ms.data = {"maps": [{
        "id": "m1", "name": "Ground", "floor_id": "main",
        "image": {"width": 1600, "height": 1200},
        "receivers": [], "notes": "", "calibration": {"mode": "none"},
        "room_bounds": {"Kitchen": {"type": "poly", "points": [[0, 0], [1, 0], [1, 1]]},
                        "Ghost": {"type": "poly", "points": [[0, 0], [0.2, 0], [0.2, 0.2]]}},
        "stack": dict(_REALIGNED),
    }]}
    return ms


def test_both_delete_paths_say_nothing_about_the_placement(payloads) -> None:
    """The single delete and the bulk delete, as the file ships them."""
    assert len(payloads) == 2
    for p in payloads:
        assert "stack" not in p, (
            "the orphan delete carries the client's copy of the placement again; "
            "a stale tab now overwrites another tab's realign on a polygon delete"
        )
        # The keys it DOES send are the ones a polygon delete is about.
        assert set(p) == {"map_id", "receivers", "room_bounds", "floor_id",
                          "calibration", "notes"}


@pytest.mark.parametrize("which", [0, 1], ids=["single delete", "bulk delete"])
@pytest.mark.asyncio
async def test_a_stale_tabs_delete_leaves_the_realigned_placement_alone(
        payloads, tmp_path, which) -> None:
    """End to end, through the real handler and the real store."""
    ms = _store(tmp_path)
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MAPS: ms}}
    conn = MagicMock()

    await ws_maps_update(hass, conn, {"id": 1, **payloads[which]})

    conn.send_error.assert_not_called()
    stored = ms.data["maps"][0]
    assert "Ghost" not in stored["room_bounds"], "the delete did not happen"
    for k in _PLACEMENT_KEYS:
        assert stored["stack"].get(k) == _REALIGNED[k], (
            f"deleting a room polygon moved the map: {k} is "
            f"{stored['stack'].get(k)}, the other tab left it at {_REALIGNED[k]}"
        )


@pytest.mark.parametrize("which", [0, 1], ids=["single delete", "bulk delete"])
@pytest.mark.asyncio
async def test_the_control_the_round_trip_is_worth_a_whole_realign(
        payloads, tmp_path, which) -> None:
    """What the missing key is worth, measured through the same handler.

    `stack: map.stack || {}` put back — nothing else changed — and the map
    goes back to the placement the stale tab remembered.
    """
    ms = _store(tmp_path)
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MAPS: ms}}
    conn = MagicMock()

    await ws_maps_update(hass, conn, {"id": 1, **payloads[which], "stack": dict(_STALE)})

    stored = ms.data["maps"][0]
    moved = [k for k in _PLACEMENT_KEYS if stored["stack"].get(k) != _REALIGNED[k]]
    assert moved == list(_PLACEMENT_KEYS), (
        "the store no longer takes a whole placement from this payload, so the "
        "test above is not proving anything"
    )
