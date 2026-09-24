# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas drawing stacks floors by the backend's rule (review round 13).

fabricFrame (views/iso_lights.js) ranks floors the registry gave no level the
way ModelStore._ordered_floors / floor_stack_index do for the RF slab count.
Its copy of the conventional-storey table had drifted (no ground_floor,
first_floor, second_floor, garden...) and it ranked a name it didn't know by
its position in the list — so a room-less "Garage" shared Upstairs' slab and
named it, and the picture and the physics described different buildings.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha.model_store import ModelStore

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const IL = await import(pathToFileURL({json.dumps(str(_VIEWS / 'iso_lights.js'))}).href);\n"
        "const out={};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_conventional_storeys_are_the_backends_key_for_key():
    table = dict(ModelStore._CONVENTIONAL_LEVEL)
    unknown = ["garage", "wohnbereich", "shop", "annex"]
    out = _run(f"const keys={json.dumps(list(table) + unknown)};\n"
               "out.levels = Object.fromEntries(keys.map(k => [k, IL.conventionalLevel(k)]));\n")
    assert out["levels"] == {**table, **{k: None for k in unknown}}


# Floor registries as the backend hands them over — sorted by name, no levels.
_HOUSES = [
    ["basement", "garage", "main", "upstairs"],
    ["outside", "wohnbereich"],
    ["attic", "basement", "first_floor", "ground_floor"],
    ["basement", "main", "outside", "upper"],
    ["garden", "ground_floor", "loft", "second_floor", "shed", "workshop"],
]


@pytest.mark.parametrize("ids", _HOUSES, ids=lambda ids: "+".join(ids))
def test_the_drawing_stacks_each_floor_on_the_backends_slab(ids):
    ms = ModelStore.__new__(ModelStore)
    ms.data = {"floors": [{"id": i} for i in ids]}
    backend = ms.floor_stack_index()
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    model = {"floors": [{"id": i, "name": i, "level": None} for i in ids],
             "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": i, "points_m": sq} for n, i in enumerate(ids)}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.slabs = Object.fromEntries(M.floors.map(f => [f.id, fr.levelOf(f.id)]));\n")
    assert out["slabs"] == backend


# Registries in their stored (creation) order, as the backend ranks them;
# some with only SOME levels set — HA allows it, and the 3D Stack's Save
# writes one floor's level (review round 14).
_REGISTRIES = [
    [{"id": "basement"}, {"id": "main"}, {"id": "outside"}, {"id": "upper"}],
    [{"id": "main"}, {"id": "upper"}, {"id": "basement"}, {"id": "garage"}],
    [{"id": "basement", "level": -1}, {"id": "main", "level": 0}, {"id": "upper", "level": 1}, {"id": "outside"}],
    [{"id": "basement"}, {"id": "main", "level": 0}, {"id": "upper"}],
    [{"id": "ground_floor"}, {"id": "loft"}, {"id": "garden"}, {"id": "shed"}, {"id": "workshop"}],
]


@pytest.mark.parametrize("reg", _REGISTRIES, ids=lambda reg: "+".join(
    f["id"] + (f"={f['level']}" if "level" in f else "") for f in reg))
def test_with_the_elevations_home_assistant_sends_the_drawing_matches_the_backend(reg):
    """model_get always sends floor_elevations, and on a multi-storey house the
    drawing ranks by them — in metres. Round 14: a floor's own level was
    returned in place of its slab (storey numbers and slab indices in one
    number space), so with only some levels set two floors shared a slab;
    and an id with no elevation compared its storey number with metres."""
    ms = ModelStore.__new__(ModelStore)
    ms.data = {"floors": [dict(f) for f in reg]}
    backend, elevations = ms.floor_stack_index(), ms.floor_base_elevations_m()
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    floors = sorted(({"id": f["id"], "name": f["id"], "level": f.get("level")} for f in reg), key=lambda f: f["id"])
    model = {"floors": floors, "floor_elevations": elevations,
             "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": f["id"], "points_m": sq} for n, f in enumerate(reg)}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.slabs = Object.fromEntries(M.floors.map(f => [f.id, fr.levelOf(f.id)]));\n")
    assert out["slabs"] == backend, (elevations, out)


def test_the_fabrics_outdoor_sentinel_sits_on_the_ground_floor():
    """Round 14: with no "outside" floor in the registry, the fabric's
    "__outside__" had no elevation, and its storey (0) read as metres put the
    garden on the basement's slab."""
    ms = ModelStore.__new__(ModelStore)
    ms.data = {"floors": [{"id": "basement"}, {"id": "main"}, {"id": "upper"}]}
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    model = {"floors": [{"id": i, "name": i, "level": None} for i in ("basement", "main", "upper")],
             "floor_elevations": ms.floor_base_elevations_m(),
             "room_geometry_m": {"Den": {"type": "poly", "floor_id": "basement", "points_m": sq},
                                 "Kitchen": {"type": "poly", "floor_id": "main", "points_m": sq},
                                 "Bed": {"type": "poly", "floor_id": "upper", "points_m": sq},
                                 "Garden": {"type": "poly", "floor_id": "__outside__", "points_m": [[6, 0], [9, 0], [9, 4], [6, 4]]}}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.garden = fr.levelOf('__outside__'); out.main = fr.levelOf('main'); out.levels = fr.levels;\n")
    assert out["garden"] == out["main"] and out["levels"] == [0, 1, 2], out


@pytest.mark.parametrize("ids", [["home"], ["downstairs", "upstairs"], ["basement", "main", "upper"]],
                         ids=lambda ids: "+".join(ids))
def test_the_outdoor_sentinel_is_on_a_drawn_slab_whatever_the_floors_are_called(ids):
    """Round 15: with no floor naming the ground ("Home", "Downstairs" /
    "Upstairs"), the fabric's "__outside__" went on a slab above everything
    that is never drawn — a gate on the outside fence could no longer be
    found or linked. It sits with the nearest floor at or below the ground,
    else the lowest."""
    ms = ModelStore.__new__(ModelStore)
    ms.data = {"floors": [{"id": i} for i in ids]}
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    model = {"floors": [{"id": i, "name": i, "level": None} for i in ids],
             "floor_elevations": ms.floor_base_elevations_m(),
             "room_geometry_m": {**{f"R{n}": {"type": "poly", "floor_id": i, "points_m": sq} for n, i in enumerate(ids)},
                                 "Garden": {"type": "poly", "floor_id": "__outside__", "points_m": [[6, 0], [9, 0], [9, 4], [6, 4]]}}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.garden = fr.levelOf('__outside__'); out.levels = fr.levels;\n"
               "out.ground = fr.levelOf(M.floors[ids_ground].id);\n".replace("ids_ground", str(1 if ids == ["basement", "main", "upper"] else 0)))
    assert out["garden"] in out["levels"] and out["garden"] == out["ground"], out


def test_a_garden_named_floor_is_still_drawn():
    """Round 15: counting every outdoor NAME as outside (for the frame's
    scale) dropped a "Garden" or "Yard" floor's rooms and lights from the
    Atlas and the Overview altogether. Only the outside floor is kept off
    the plates."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    model = {"floors": [{"id": "garden", "name": "Garden", "level": None}, {"id": "main", "name": "Main", "level": None}],
             "room_geometry_m": {"Patio": {"type": "poly", "floor_id": "garden", "points_m": sq},
                                 "Kitchen": {"type": "poly", "floor_id": "main", "points_m": sq}}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.drawn = fr.rooms.map(r => r.room).sort(); out.overlay = fr.outdoor.map(r => r.room);\n")
    assert out == {"drawn": ["Kitchen", "Patio"], "overlay": []}

