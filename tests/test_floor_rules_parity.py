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
