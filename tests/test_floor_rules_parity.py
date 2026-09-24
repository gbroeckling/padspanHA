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


def test_floors_whose_elevation_has_not_synced_keep_their_own_plates():
    """Round 16: before the model's floor list catches up with HA's registry
    (first sync, or a floor just added) only some floors have an elevation;
    metres for those and a fallback for the rest drew basement, main and
    upper on ONE plate. The stack ranks by metres only when every floor has
    one — otherwise by storey, as the backend does."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    ids = ["basement", "main", "upper"]
    lag = {"floors": [{"id": i, "name": i, "level": None} for i in ids], "floor_elevations": {"main": 0.0},
           "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": i, "points_m": sq} for n, i in enumerate(ids)}}
    bare = {"floors": [], "room_geometry_m": lag["room_geometry_m"]}
    out = _run(f"const A={json.dumps(lag)}, B={json.dumps(bare)};\n"
               "const fa = IL.fabricFrame(A, A.floors, 150, 0), fb = IL.fabricFrame(B, B.floors, 150, 0);\n"
               "out.lag = ['basement','main','upper'].map(i => fa.levelOf(i));\n"
               "out.noRegistry = ['basement','main','upper'].map(i => fb.levelOf(i));\n")
    assert out == {"lag": [0, 1, 2], "noRegistry": [0, 1, 2]}, out


def test_a_plate_has_one_name_everywhere():
    """Round 16: two registry floors on one plate were "Garden + Main" on the
    floor buttons and sheet but "Main" on the slider and the legend."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    model = {"floors": [{"id": "garden", "name": "Garden", "level": None}, {"id": "main", "name": "Main", "level": None}],
             "room_geometry_m": {"Patio": {"type": "poly", "floor_id": "garden", "points_m": sq},
                                 "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[5, 0], [9, 0], [9, 4], [5, 4]]}}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.levels = fr.levels; out.name = IL.floorNameAtLevel(fr, M, M.floors, fr.levels[0]);\n"
               "const svg = IL.buildIsoSVG(M, {}, new Set(), null, 150, 0, {}, false, M.floors, {});\n"
               "const i = svg.indexOf('>Motion<');\n"
               "out.legend = [...svg.slice(0, i).matchAll(/<text[^>]*>([^<]*)<\\/text>/g)].map(m => m[1]).slice(-1)[0];\n")
    assert out == {"levels": [0], "name": "Main/Garden", "legend": "Main/Garden"}, out


def _backend(stored):
    ms = ModelStore.__new__(ModelStore)
    ms.data = {"floors": [dict(f) for f in stored]}
    return ms.floor_stack_index(), ms.floor_base_elevations_m()


def _ranks(levels: dict) -> dict:
    order = sorted(set(levels.values()))
    return {k: order.index(v) for k, v in levels.items()}


def test_a_floor_ha_dropped_that_padspan_keeps_has_its_own_plate():
    """Round 17: the backend keeps a floor HA's registry dropped while rooms are
    still on it (and rooms on PadSpan's default "main" where HA has none);
    the drawing put such a floor on another floor's plate — Upper deleted in
    HA drew the bedrooms over the kitchen."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    cases = {
        "upper_deleted": ([{"id": "basement"}, {"id": "main"}, {"id": "outside"}, {"id": "upper"}], ["basement", "main", "outside"]),
        "only_main": ([{"id": "main"}, {"id": "basement"}, {"id": "upper"}], ["main"]),
        "main_default": ([{"id": "downstairs"}, {"id": "upstairs"}, {"id": "main"}], ["downstairs", "upstairs"]),
    }
    for name, (stored, registry) in cases.items():
        backend, elevations = _backend(stored)
        model = {"floors": [{"id": i, "name": i, "level": None} for i in sorted(registry)], "floor_elevations": elevations,
                 "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": f["id"], "points_m": sq} for n, f in enumerate(stored)}}
        out = _run(f"const M={json.dumps(model)};\n"
                   "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
                   f"out.slabs = Object.fromEntries({json.dumps([f['id'] for f in stored])}.map(i => [i, fr.levelOf(i)]));\n")
        assert _ranks(out["slabs"]) == _ranks(backend), (name, out, backend)
    # Without its elevation synced yet, by storey: still three plates.
    model = {"floors": [{"id": "main", "name": "main", "level": None}], "floor_elevations": {"main": 0.0},
             "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": i, "points_m": sq} for n, i in enumerate(["basement", "main", "upper"])}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.slabs = ['basement','main','upper'].map(i => fr.levelOf(i));\n")
    assert out["slabs"] == [0, 1, 2], out


def test_a_floor_just_added_keeps_the_others_in_the_backends_order():
    """Round 17: with one floor's elevation not synced, unknown names sorted by
    display name — Garage drawn below Home though created (and stacked by
    the backend) after it."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    model = {"floors": [{"id": i, "name": i, "level": None} for i in ("garage", "home", "workshop")],
             "floor_elevations": {"home": 0.0, "garage": 2.8},
             "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": i, "points_m": sq} for n, i in enumerate(["garage", "home", "workshop"])}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.slabs = Object.fromEntries(['home','garage','workshop'].map(i => [i, fr.levelOf(i)]));\n")
    assert out["slabs"] == {"home": 0, "garage": 1, "workshop": 2}, out


def test_the_outside_floor_never_names_a_plate_and_plates_read_apart_from_pairs():
    """Round 17: a ground plate drawing only the yard read "Outside + Yard";
    and " + " both inside a plate and between plates made "Basement + Main
    + Garden" unreadable."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    yard = {"floors": [{"id": i, "name": i.title(), "level": None} for i in ("basement", "outside", "upper", "yard")],
            "room_geometry_m": {"B": {"type": "poly", "floor_id": "basement", "points_m": sq},
                                "O": {"type": "poly", "floor_id": "outside", "points_m": sq},
                                "Y": {"type": "poly", "floor_id": "yard", "points_m": sq},
                                "U": {"type": "poly", "floor_id": "upper", "points_m": sq}}}
    garden = {"floors": [{"id": i, "name": i.title(), "level": None} for i in ("basement", "garden", "main")],
              "room_geometry_m": {"B": {"type": "poly", "floor_id": "basement", "points_m": sq},
                                  "G": {"type": "poly", "floor_id": "garden", "points_m": sq},
                                  "K": {"type": "poly", "floor_id": "main", "points_m": [[5, 0], [9, 0], [9, 4], [5, 4]]}}}
    out = _run(f"const Y={json.dumps(yard)}, G={json.dumps(garden)};\n"
               "const fy = IL.fabricFrame(Y, Y.floors, 150, 0);\n"
               "out.yard = IL.floorNameAtLevel(fy, Y, Y.floors, fy.levelOf('yard'));\n"
               "out.yardPick = IL.floorIdAtLevel(fy, Y, Y.floors, fy.levelOf('yard'));\n"
               f"const HA = await import({json.dumps((_VIEWS / 'house_activity.js').as_uri())});\n"
               "const pos = HA.atlasFocusPositions(G);\n"
               "out.labels = pos.positions.map((_, i) => pos.labelOf(i));\n")
    assert out["yard"] == "Yard" and out["yardPick"] == "yard", out
    assert out["labels"] == ["All floors", "Basement", "Basement + Main/Garden", "Main/Garden"], out


def test_the_drawing_stacks_like_the_backend_across_many_houses(tmp_path):
    """The class, not the cases: 300 seeded houses — HA registries with levels
    unset or partly set, floors the backend keeps after HA dropped them,
    unknown names, outdoor floors — stacked by the drawing (fed what
    model_get sends: floors sorted by name, the backend's elevations) and by
    ModelStore.floor_stack_index must agree. Registries where EVERY floor has
    a level take the explicit-level path (older, not covered here)."""
    import random
    rnd = random.Random(20260924)
    pool = ["basement", "cellar", "lower", "main", "ground", "ground_floor", "first_floor", "upper", "upstairs",
            "second_floor", "third", "loft", "attic", "garage", "home", "shop", "studio", "annex", "outside", "garden", "yard"]
    kept_pool = ["basement", "main", "upper", "attic", "garage", "loft", "studio", "yard", "garden"]
    light_only = ["main", "shed", "upper", "basement"]
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    cases = []
    while len(cases) < 300:
        k = rnd.randint(1, 5)
        reg = rnd.sample(pool, k)
        stored = [{"id": i} for i in reg]
        if rnd.random() < 0.3:
            for f in stored:
                if rnd.random() < 0.5:
                    f["level"] = rnd.randint(-1, 3)
        if stored and all("level" in f for f in stored):
            continue
        kept = []
        if rnd.random() < 0.35:
            cand = [i for i in kept_pool if i not in reg]
            if cand:
                kept = [rnd.choice(cand)]
                stored.insert(rnd.randint(0, len(stored)), {"id": kept[0]})
        backend, elevations = _backend(stored)
        floors = sorted(({"id": f["id"], "name": f["id"], "level": f.get("level")} for f in stored if f["id"] not in kept),
                        key=lambda f: f["id"])
        model = {"floors": floors, "floor_elevations": elevations,
                 "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": f["id"], "points_m": sq} for n, f in enumerate(stored)}}
        # A light saved on a floor with no rooms (PadSpan's default "main") is
        # on no floor the backend keeps — it lands on a floor's slab, never a
        # slab of its own (round 18: an empty plate between two floors).
        lid = None
        if rnd.random() < 0.3:
            lid = rnd.choice([i for i in light_only if i not in [f["id"] for f in stored]] or ["shed_x"])
            model["light_positions_m"] = {"light.stray": {"x_m": 1, "y_m": 1, "floor_id": lid}}
        cases.append((model, [f["id"] for f in stored], backend, lid))
    data = tmp_path / "houses.json"                 # too long for a command line
    data.write_text(json.dumps([[m, ids, lid] for m, ids, _, lid in cases]), encoding="utf-8")
    out = _run("const { readFileSync } = await import('node:fs');\n"
               f"const C = JSON.parse(readFileSync({json.dumps(str(data))}, 'utf8'));\n"
               "out.slabs = C.map(([M, ids, lid]) => { const fr = IL.fabricFrame(M, M.floors, 150, 0);"
               " return { slabs: Object.fromEntries(ids.map(i => [i, fr.levelOf(i)])), stray: lid ? fr.levelOf(lid) : null }; });\n")
    bad = [(m["floors"], m["floor_elevations"], got, want) for (m, _ids, want, _lid), got in zip(cases, out["slabs"])
           if _ranks(got["slabs"]) != _ranks(want)
           or (got["stray"] is not None and got["stray"] not in got["slabs"].values())]
    assert not bad, f"{len(bad)} of {len(cases)} houses stack differently, e.g. {bad[:2]}"


def test_a_light_on_a_floor_with_no_rooms_adds_no_plate():
    """Round 18: a light saved on "main" (PadSpan's default floor) beside HA's
    Downstairs/Upstairs was stacked as a floor of its own — an empty plate
    between the two, "L1" on its chip, "No floor record" on its badge."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    two = {"floors": [{"id": "downstairs", "name": "Downstairs", "level": None}, {"id": "upstairs", "name": "Upstairs", "level": None}],
           "floor_elevations": {"downstairs": 0.0, "upstairs": 2.8},
           "room_geometry_m": {"D": {"type": "poly", "floor_id": "downstairs", "points_m": sq},
                               "U": {"type": "poly", "floor_id": "upstairs", "points_m": sq}},
           "light_positions_m": {"light.stray": {"x_m": 1, "y_m": 1, "floor_id": "main"}}}
    home = {"floors": [{"id": "home", "name": "Home", "level": None}], "floor_elevations": {"home": 0.0},
            "room_geometry_m": {"H": {"type": "poly", "floor_id": "home", "points_m": sq}},
            "light_positions_m": {"light.stray": {"x_m": 1, "y_m": 1, "floor_id": "main"}}}
    out = _run(f"const A={json.dumps(two)}, B={json.dumps(home)};\n"
               "const fa = IL.fabricFrame(A, A.floors, 150, 0), fb = IL.fabricFrame(B, B.floors, 150, 0);\n"
               "out.two = { levels: fa.levels, main: fa.levelOf('main'), down: fa.levelOf('downstairs') };\n"
               "out.home = { levels: fb.levels, main: fb.levelOf('main'), home: fb.levelOf('home') };\n")
    assert out["two"] == {"levels": [0, 1], "main": 0, "down": 0}, out
    assert out["home"] == {"levels": [0], "main": 0, "home": 0}, out


def test_a_kept_outdoor_floor_has_the_backends_plate():
    """Round 18: a "yard" HA dropped while its patio stays is kept (and
    stacked) by the backend; the drawing put the patio on Downstairs."""
    sq = [[0, 0], [4, 0], [4, 4], [0, 4]]
    stored = [{"id": "downstairs"}, {"id": "upstairs"}, {"id": "yard"}]
    backend, elevations = _backend(stored)
    model = {"floors": [{"id": "downstairs", "name": "Downstairs", "level": None}, {"id": "upstairs", "name": "Upstairs", "level": None}],
             "floor_elevations": elevations,
             "room_geometry_m": {f"R{n}": {"type": "poly", "floor_id": f["id"], "points_m": sq} for n, f in enumerate(stored)}}
    out = _run(f"const M={json.dumps(model)};\n"
               "const fr = IL.fabricFrame(M, M.floors, 150, 0);\n"
               "out.slabs = Object.fromEntries(['downstairs','upstairs','yard'].map(i => [i, fr.levelOf(i)]));\n")
    assert _ranks(out["slabs"]) == _ranks(backend), (out, backend)

