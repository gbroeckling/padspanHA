# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Tie-ins are PLACEMENT, so they are in metres.

A tie-in is a saved alignment constraint: "when I last checked this map
against that one, it sat HERE". It stored four stack fields — x_offset,
y_offset, scale, rotation — which is a placement in the units the stack used,
so it is one of the copies this release deletes. Left alone it would be the
only surviving description of a map's position in a coordinate system nothing
reads, and `_checkAlignConflicts` would compare the owner's next align against
numbers from a dead frame.

THE FEATURE IS NOT DROPPED. Each tie-in becomes the six-field placement those
four fields described, measured the same way the conversion measures a stack:
the legacy stack the tie-in recorded, through the stored gauge. Same
arithmetic, same gauge, so a tie-in and the alignment it was taken from
convert to the same metres.

The comparison changes with it, and for the better. It was a weighted blend of
"% offset" (a fraction of the MASTER picture, so the same percentage meant
different distances on different houses), "% scale difference" and "degrees of
rotation" — three units summed into one number, none of them a distance, and
none of them able to see a mirror or a lean at all. It is the distance in
metres this codebase defines everywhere else.
"""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth, migrations
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import maps_store_with

_IDENT = {"is_master": True, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0,
          "scale_x_adj": 1.0, "rotation": 0.0, "ref_ar": 0.75}
_MEASURED = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
             "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0,
             "reference_measurements": [{"m": 1}]}


def _mdl(transforms: dict) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock()
    s.store = AsyncMock()
    s.data = {"map_transforms": transforms,
              "world_gauge": {"m_per_unit": 20.0, "source_map_id": "m0"}}
    s.fabric = None
    return s


def _map(mid: str, stack: dict) -> dict:
    return {"id": mid, "name": mid, "floor_id": "main",
            "created": "2020-01-01T00:00:00+00:00",
            "image": {"width": 1600, "height": 1200}, "stack": dict(stack),
            "room_bounds": {}, "receivers": [], "beacons": [],
            "calibration": {"mode": "none"}}


def _scene(tie_ins):
    maps = [_map("m0", _IDENT),
            _map("m1", {"x_offset": 0.3, "y_offset": -0.2, "scale": 1.1,
                        "scale_x_adj": 1.0, "rotation": 12.0, "ref_ar": 0.75,
                        "tie_ins": tie_ins, "z_level": 0, "ceiling_height_m": 2.4})]
    return maps, _mdl({"m0": dict(_MEASURED)}), maps_store_with(maps)


@pytest.mark.asyncio
async def test_a_tie_in_converts_to_the_placement_it_described() -> None:
    """The four fields it stored, as metres, through the same gauge."""
    ti = {"ref_map_id": "m0", "x_offset": 0.25, "y_offset": 0.1, "scale": 1.4,
          "rotation": -33.0, "date": "2026-01-02"}
    maps, mdl, ms = _scene([ti])
    gauge = fabric_truth.metre_gauge(mdl)

    # What those four fields meant, computed the way the conversion does.
    synth = {**maps[1]["stack"], "x_offset": 0.25, "y_offset": 0.1,
             "scale": 1.4, "rotation": -33.0}
    want = fabric_truth.legacy_stack_metre_transform({**maps[1], "stack": synth}, gauge)

    out = await migrations._tie_ins_to_metres(mdl, ms, maps, gauge)
    assert out == {"tie_ins_converted": 1, "tie_ins_dropped": 0}

    got = ms.data["maps"][1]["stack"]["tie_ins"][0]
    assert got["ref_map_id"] == "m0" and got["date"] == "2026-01-02"
    for k in ("origin_x_m", "origin_y_m", "scale_x_m", "scale_y_m",
              "rotation_rad", "shear_rad"):
        assert got[k] == pytest.approx(want[k], abs=1e-9), k
    # The dead-frame fields go with the frame.
    assert not (set(got) & {"x_offset", "y_offset", "scale", "rotation"})


@pytest.mark.asyncio
async def test_a_tie_in_and_the_align_it_was_taken_from_convert_alike() -> None:
    """The point of using the same arithmetic: a tie-in recorded at the map's
    CURRENT alignment must not become a conflict the moment it is converted."""
    stk = {"x_offset": 0.3, "y_offset": -0.2, "scale": 1.1, "rotation": 12.0}
    maps, mdl, ms = _scene([{"ref_map_id": "m0", "date": "2026-01-02", **stk}])
    gauge = fabric_truth.metre_gauge(mdl)
    align = fabric_truth.legacy_stack_metre_transform(maps[1], gauge)

    await migrations._tie_ins_to_metres(mdl, ms, maps, gauge)
    tie = ms.data["maps"][1]["stack"]["tie_ins"][0]
    gap = fabric_truth.placement_disagreement_m(align, tie)
    assert gap < 1e-6, f"the tie-in moved {gap:.6f} m relative to the alignment it recorded"


@pytest.mark.asyncio
async def test_an_already_converted_tie_in_is_left_alone() -> None:
    """It runs before the conversion and the conversion deletes its input, so
    a second pass has no legacy frame to read. Idempotent by recognising its
    own output rather than by a marker, because a map can gain a tie-in after
    the step is marked done."""
    metric = {"ref_map_id": "m0", "date": "2026-01-02", "origin_x_m": 5.0,
              "origin_y_m": -3.0, "scale_x_m": 22.0, "scale_y_m": 16.5,
              "rotation_rad": 0.21, "shear_rad": 0.0}
    maps, mdl, ms = _scene([dict(metric)])
    gauge = fabric_truth.metre_gauge(mdl)
    out = await migrations._tie_ins_to_metres(mdl, ms, maps, gauge)
    assert out == {"tie_ins_converted": 0, "tie_ins_dropped": 0}
    assert ms.data["maps"][1]["stack"]["tie_ins"] == [metric]


@pytest.mark.asyncio
async def test_the_step_runs_before_the_conversion_deletes_the_frame() -> None:
    """Order, checked through the real migration rather than by reading it.

    Step 12 converts tie-ins; step 13 converts the stacks and deletes them.
    The other way round, every tie-in on the box would convert through an
    empty stack — a map at the world origin at unit size — and every one of
    them would come out saying the map is somewhere it has never been.
    """
    ti = {"ref_map_id": "m0", "x_offset": 0.25, "y_offset": 0.1, "scale": 1.4,
          "rotation": -33.0, "date": "2026-01-02"}
    maps, mdl, ms = _scene([ti])
    gauge = fabric_truth.metre_gauge(mdl)
    synth = {**maps[1]["stack"], "x_offset": 0.25, "y_offset": 0.1,
             "scale": 1.4, "rotation": -33.0}
    want = fabric_truth.legacy_stack_metre_transform({**maps[1], "stack": synth}, gauge)

    fab = MagicMock()
    fab.data = {}
    fab.store = AsyncMock()

    async def _backup(hass, note, keys):
        return "bk_1"

    await migrations.async_run_photo_divorce(MagicMock(), mdl, ms, fab, None, _backup)

    stk = ms.data["maps"][1]["stack"]
    assert not (set(stk) & {"x_offset", "y_offset", "scale", "rotation", "_m"}), (
        "the conversion did not run")
    got = stk["tie_ins"][0]
    assert fabric_truth.placement_disagreement_m(want, got) < 1e-6, (
        "the tie-in was converted through a stack that had already been deleted")


@pytest.mark.asyncio
async def test_the_panel_measures_a_conflict_in_metres() -> None:
    """The comparison, in the panel, on the converted tie-in.

    The old blend could not see a mirror or a lean at all — neither is in any
    of its four terms — so a tie-in that put the map on the other side of the
    house scored zero and the save went through silently.
    """
    import json
    import shutil
    import subprocess
    from pathlib import Path

    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")

    views = (Path(__file__).resolve().parents[1] / "custom_components" /
             "padspan_ha" / "www" / "padspan-ha" / "views")
    src = (views / "maps.js").read_text(encoding="utf-8")
    # `_placementGapM` exactly as it ships, with the one import it needs.
    start = src.index("function _placementGapM(")
    end = src.index("\n}\n", start) + 3
    body = src[start:end]

    square = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
              "scale_y_m": 15.0, "rotation_rad": 0.0, "shear_rad": 0.0}
    cases = [
        ("identical", dict(square), 0.0),
        ("mirrored", {**square, "shear_rad": math.pi}, 30.0),
        ("half a turn", {**square, "rotation_rad": math.pi}, 50.0),
        ("leaning 20 deg", {**square, "shear_rad": math.radians(20)}, 5.2094),
        ("nudged 0.4 m", {**square, "origin_x_m": 0.4}, 0.4),
    ]
    script = (
        "import { mapFracToMetres } from './stack_transform.js';\n"
        + body
        + "\nconst out = [];\n"
        + "for (const [name, b, want] of " + json.dumps(
            [[n, b, w] for n, b, w in cases]) + ") {\n"
        + "  out.push([name, _placementGapM(" + json.dumps(square) + ", b), want]);\n"
        + "}\nconsole.log(JSON.stringify(out));\n"
    )
    tmp = views / "_tiein_gap_probe.mjs"
    tmp.write_text(script, encoding="utf-8")
    try:
        res = subprocess.run([node, str(tmp)], capture_output=True, text=True,
                             encoding="utf-8", timeout=60)
    finally:
        tmp.unlink(missing_ok=True)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])

    for name, gap, want in got:
        assert gap == pytest.approx(want, abs=1e-3), name
        # And the Python definition agrees, because it is the same question.
        py = fabric_truth.placement_disagreement_m(
            square, dict(next(b for n, b, _ in cases if n == name)))
        assert py == pytest.approx(gap, abs=1e-9), name
