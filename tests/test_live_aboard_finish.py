# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard, Furnish's floors and walls (views/live_aboard_finish.js; the
owner's item 22, approved 2026-11-23).

tests/js/live_aboard_finish.mjs runs Furnish for real inside the real 3D view
and editor under the DOM shim: a tap on a room's floor opens its panel, a
material and wall colours set per room, one wall its own colour, a floor's
outside walls, each one Undo, one Save, a view opened afresh drawing them from
the file, Classic and Studio drawing them, a Showcase theme keeping its own
look (the house exactly as with nothing chosen), and "As drawn" bringing the
house back exactly. What it saved goes through the server's own apply_edit
here; the rest is held in the code: the rules import nothing, no picture is
fetched, and the words are German too.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_store as HS

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def finish() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_finish.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.mark.parametrize("prefix", ["none:", "open:", "floor:", "walls:", "onewall:", "outside:", "undo:", "save:", "reload:",
                                    "looks:", "cleared:"])
def test_the_harness_covers_each_part(finish, prefix) -> None:
    got = [k for k in finish["cases"] if k.startswith(prefix)]
    assert got, (prefix, sorted(finish["cases"]))
    bad = [f for f in finish["failures"] if f["name"].startswith(prefix)]
    assert all(finish["cases"][k] for k in got) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)[:4000]


def test_what_it_saved_the_server_keeps(finish) -> None:
    """Every Save goes through the server's own apply_edit: none is refused,
    and the file then holds what the screen showed."""
    sent = finish["payloads"]
    assert sent and all(set(c) <= set(HS.EDIT_SECTIONS) for c in sent)
    file = HS.empty()
    file = HS.apply_edit(file, sent[0])
    assert file["rooms"] == {"Living": {"floor": "wood", "wall": "#3f6e8c", "walls": {"0": "#aa3322"}}}
    assert file["floors"] == {"main": {"outside": "#c8b89a"}}
    for changes in sent[1:]:
        file = HS.apply_edit(file, changes)
    assert file["rooms"] == {} and file["floors"] == {}


def test_the_rules_are_plain_numbers_and_the_lists_match_the_servers() -> None:
    code = _code(_VIEWS / "live_aboard_finish.js")
    for bad in ("import(", "import ", "document.", "window.", "fetch(", "three", "i18n"):
        assert bad not in code, bad
    src = _js(_VIEWS / "live_aboard_finish.js")
    assert 'export const FLOOR_MATERIALS = ["wood", "light_wood", "tile", "stone", "carpet", "concrete"];' in src
    assert tuple(HS.FLOOR_MATERIALS) == ("wood", "light_wood", "tile", "stone", "carpet", "concrete")
    assert "export const WALLS_MAX = 200;" in src and HS.WALLS_MAX == 200
    # The draft owns the two sections (and imports nothing for them).
    draft = _js(_VIEWS / "live_aboard_draft.js")
    assert 'export const SECTIONS = ["openings", "lights", "devices", "pieces", "figures", "rooms", "floors"];' in draft
    assert 'const FINISH_KEYS = { rooms: ["floor", "wall", "walls"], floors: ["outside"] };' in draft


def test_materials_are_drawn_in_code_and_only_in_live_aboards_own_looks() -> None:
    la = _js(_VIEWS / "live_aboard.js")
    # No picture is fetched: each material's lines are painted on a canvas, as the paving's are.
    at = la.index("function finishMat(fm){")
    body = la[at:at + 2500]
    assert "document.createElement(\"canvas\")" in body and "TextureLoader" not in la and ".jpg" not in body and ".png" not in body
    # The theme wins: they show only with Live Aboard's own colours (Classic, Studio).
    assert "const finishShown = () => !atlas && (!LOOKS || theme3d === LOOKS.SHOWCASE_LOOKS.classic);" in la
    assert "const fm = finishShown() ? FIN.floorOf(finNow, r.name) : null;" in la
    assert "const fin = finishShown() && FIN.hasFinish(finNow) ? finNow : null;" in la
    # Nothing chosen: the walls' program and geometry are the ones from before.
    assert 'm.customProgramCacheKey = () => (spec.two ? "la3d-walltop-two" : "la3d-walltop");' in la
    assert "if (two) { geo = twoFaces(list); spec = { ...spec, two: 1 }; }" in la


def test_every_new_word_is_german_too() -> None:
    de = json.loads((_WWW / "i18n" / "de" / "furnish.json").read_text(encoding="utf-8"))
    for k in ("Wood", "Light wood", "Tile", "Stone", "Carpet", "Concrete", "{room}: floor and walls", "Floor", "Walls",
              "Outside walls", "As drawn", "Wall {n}, {len}", "{n} walls have their own",
              "Build adds a piece. Drag a piece to move it; tap it to change it. Tap a room's floor for its floor and walls."):
        assert de.get(k), k
