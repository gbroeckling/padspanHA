# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The 3D Stack row Save never decides a floor's storey.

Mapping -> 3D Stack -> "Floor Assignment & Ceiling Heights": every row's Save
used to send ``padspan_ha/fabric_floor_elevations_set {id: <the row's floor>,
level: <the row's Stack Level>}``. Stack Level belongs to the MAP (its place
in the picture stack; maps_store clamps it to >= 0), and a stored level
outranks the HA registry's (async_sync_floors, ws_model_get's overlay). On an
install whose registry levels are all null — the house this came from — one
Save on the basement map's row (Stack Level 0) moved Main and Outside down
onto the basement slab: {basement:0, main:1, outside:1, upper:2} became
{basement:0, main:0, outside:0, upper:1}, and nothing in the UI can clear a
stored level.

Checked end to end: tests/js/stack_row_save.mjs renders the real tab and
clicks every row's Save as drawn; every call those clicks make is replayed
here into a real ModelStore seeded with that house's stored floors.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from .test_floor_elevations import _make_store

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "stack_row_save.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

# The house's ModelStore floors as stored: no level anywhere, because its HA
# registry levels are null. Order is the stored order.
_STORED_FLOORS = [
    {"id": "basement", "name": "Basement", "floor_to_floor_m": 3.0},
    {"id": "main", "name": "Main", "floor_to_floor_m": 2.3},
    {"id": "upper", "name": "Upper"},
    {"id": "outside", "name": "Outside"},
]
_STACK = {"basement": 0, "main": 1, "outside": 1, "upper": 2}
_BASES = {"basement": 0.0, "main": 3.0, "outside": 3.0, "upper": 5.3}

# What ws_model_get serves the panel for those floors: registry floors
# (level null) with the stored heights overlaid.
_SERVED_FLOORS = [
    {"id": "basement", "name": "Basement", "level": None, "floor_to_floor_m": 3.0},
    {"id": "main", "name": "Main", "level": None, "floor_to_floor_m": 2.3},
    {"id": "outside", "name": "Outside", "level": None},
    {"id": "upper", "name": "Upper", "level": None},
]


def _map(mid: str, floor_id: str, stack: dict) -> dict:
    return {"id": mid, "name": mid, "floor_id": floor_id,
            "image": {"width": 1000, "height": 700}, "stack": stack,
            "receivers": [], "rooms": [], "rf_barriers": []}


# The house's maps, with the Stack Levels they carry today: the photo stack
# counts from 0 at the basement, the HA storeys do not.
_MAPS = [
    _map("main-a", "main", {"z_level": 1, "ceiling_height_m": 2.2}),
    _map("main-b", "main", {"z_level": 1, "ceiling_height_m": 2.2, "ref_map_id": "main-a"}),
    _map("upper-a", "upper", {"z_level": 2, "ceiling_height_m": 2.4, "ref_map_id": "main-b"}),
    _map("basement-a", "basement", {"z_level": 0, "ceiling_height_m": 2.4, "ref_map_id": "main-b"}),
    _map("yard", "__outside__", {"z_level": 3, "ceiling_height_m": 2.4}),
]


@pytest.fixture(scope="module")
def clicked(tmp_path_factory) -> dict:
    fix = tmp_path_factory.mktemp("stack_row_save") / "fixture.json"
    fix.write_text(json.dumps({"maps": _MAPS, "model": {
        "floors": _SERVED_FLOORS, "map_transforms": {}, "floor_elevations": _BASES,
    }}), encoding="utf-8")
    proc = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS), str(fix)],
                          capture_output=True, text=True, timeout=120, check=False)
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["errors"] == [], out["errors"]
    return out


def _floor_writes(calls: list[dict]) -> list[list[dict]]:
    """Every fabric_floor_elevations_set the clicks sent, in either call shape."""
    writes = []
    for c in calls:
        a = c["args"]
        if a and isinstance(a[0], dict) and a[0].get("type") == "padspan_ha/fabric_floor_elevations_set":
            writes.append(a[0].get("floors") or [])
        elif len(a) >= 2 and a[0] == "padspan_ha/fabric_floor_elevations_set":
            writes.append((a[1] or {}).get("floors") or [])
    return writes


def test_every_row_is_clicked(clicked) -> None:
    # Not vacuous: the harness found the table and pressed every Save.
    assert clicked["rows"] == [m["name"] for m in _MAPS]


def test_row_save_still_saves_its_map(clicked) -> None:
    """What the Save is for is unchanged: the map's floor, level and ceiling."""
    for m in _MAPS:
        mine = [c for c in clicked["calls"] if c["row"] == m["name"]]
        upd = [c["args"][0] for c in mine if c["action"] == "mapsUpdateQuiet"]
        assert upd == [{"map_id": m["id"], "floor_id": m["floor_id"], "stack": m["stack"]}]
        assert [c for c in mine if c["action"] == "mapsRefresh"]


def test_row_save_sends_no_floor_level(clicked) -> None:
    levels = [f for w in _floor_writes(clicked["calls"]) for f in w if "level" in f]
    assert levels == [], f"a map row wrote a floor's storey: {levels}"


def test_house_floors_unchanged_after_every_row_save(clicked) -> None:
    """Replaying every click into the real store changes nothing, saves nothing."""
    store = _make_store([dict(f) for f in _STORED_FLOORS])
    assert store.floor_stack_index() == _STACK
    assert store.floor_base_elevations_m() == pytest.approx(_BASES)
    for floors in _floor_writes(clicked["calls"]):
        asyncio.run(store.async_set_floor_elevations(floors))
    assert store.floor_stack_index() == _STACK
    assert store.floor_base_elevations_m() == pytest.approx(_BASES)
    assert store.data["floors"] == _STORED_FLOORS
    store.store.async_save.assert_not_called()
