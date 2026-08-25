# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Save Scale re-measures a map's SCALE, and must not restate its lean.

The backend rule is one sentence: a placement field is changed only by a
payload that STATES it. That rule is only worth having if the payloads
actually posted obey it, and the one Save Scale posts said

    shear_rad: Number(_savedTx.shear_rad) || 0

which is a statement in every case, and the wrong one in two of the three:

  * the panel's cached `map_transforms` has no entry for this map — first
    render, a map added since, a refresh that has not landed — and `|| 0`
    turns that into an explicit "the map is square", which straightens every
    sheared map the moment its scale is re-measured. That is the exact
    displacement the backend rule was written to stop, said out loud so the
    backend obeys it;
  * the cache is STALE. A Point Align writes σ that this tab does not see
    until it refreshes, so restating the cached value puts the old lean back
    on a map that has since been realigned.

Only the third case — cache present and current — was harmless, and it is the
case that needs no payload field at all. So the field is gone: the payload
says nothing about σ and the store keeps what is on disk.

Reverting it was invisible: nothing in the suite ran the payload the panel
builds, and nothing named the endpoint it posts to. This runs the shipped
object literal in node and posts the result through the real websocket
handler, so what is measured is a stored record and not a source file.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.model_store import ModelStore

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "save_scale_payload.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

# A map leaning 5°, measured, anchored — the state a Point Align leaves.
_SHEARED = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
            "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": -0.1161,
            "floor_id": "main", "origin_anchored": True}


@pytest.fixture(scope="module")
def built() -> dict:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in (res.stdout or "").strip().splitlines() if ln.startswith("{")]
    assert lines, (
        "the harness itself failed — a harness bug, not a payload bug:\n"
        f"{(res.stderr or '')[-3000:]}"
    )
    return json.loads(lines[-1])


def _model(t: dict) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.store.async_save = AsyncMock()
    s.data = {"map_transforms": {"m": dict(t)}}
    s.fabric = None
    return s


def test_the_payload_states_what_it_measured(built) -> None:
    """The control: this is a real Save Scale payload, not an empty object."""
    tx = built["payloads"]["panel agrees"]
    assert tx["scale_x_m"] == 20.0 and tx["scale_y_m"] == 15.0
    # And it states NOTHING about where the map is or which way it faces.
    # Those were derived from the stack here — this panel reading the other
    # copy of the placement and writing it back into this one — and a scale
    # measurement does not measure either of them. The writer's rule keeps the
    # stored pose for a payload that does not state one.
    assert "origin_x_m" not in tx and "rotation_rad" not in tx
    assert tx["floor_id"] == "main"
    assert len(tx["reference_measurements"]) == 2


@pytest.mark.parametrize("cache", ["panel has no record", "panel agrees", "panel is stale"])
def test_the_payload_says_nothing_about_the_lean(built, cache) -> None:
    """Whatever the panel is holding, a scale re-measure has not measured σ."""
    assert "shear_rad" not in built["payloads"][cache], built["payloads"][cache]


@pytest.mark.asyncio
@pytest.mark.parametrize("cache", ["panel has no record", "panel agrees", "panel is stale"])
async def test_the_map_still_leans_after_the_endpoint_has_had_it(built, cache) -> None:
    """End to end: the object the button builds, through the handler it posts
    to, against the record on disk.

    Either half alone leaves the other free to move the map — the frontend by
    stating "square", the backend by defaulting a missing key to 0 — and
    neither half is measured by a test of the other.
    """
    from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
    from custom_components.padspan_ha.ws_fabric import ws_fabric_map_transform_set

    mdl = _model(_SHEARED)
    before = mdl.map_frac_to_metres(1.0, 1.0, "m")
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl}}
    conn = MagicMock()
    await ws_fabric_map_transform_set(
        hass, conn, {"id": 1, "map_id": "m",
                     "transform": dict(built["payloads"][cache])})

    conn.send_error.assert_not_called()
    assert mdl.data["map_transforms"]["m"]["shear_rad"] == pytest.approx(-0.1161), (
        "Save Scale straightened the map"
    )
    # …and nothing else moved either: the payload restates the scale it
    # measured, which here is the scale the map already had.
    assert mdl.map_frac_to_metres(1.0, 1.0, "m") == pytest.approx(before, abs=1e-9)
