# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard, the house itself (Garry, 2026-10-05: "Lots still missing on
the sims view"): stairs between floors, doorways and doors shown open, a roof
from outside, and a solid floor under each storey.

tests/js/live_aboard_house_model.mjs runs views/live_aboard_storey.js, the
stairs builder and the doorway rules for real under node, then the view under
the DOM shim: stairs reach the floor above and cut its opening, the storey's
floor under a hall never drawn as a room, a doorway drawn, a door with no
sensor ajar (and its sheet's Shown), the roof shown and hidden by the camera,
the floor, the view and the tool, and 0 frames at rest. Held here too: the
module imports nothing, is imported by the view alone with its own catch,
never writes and keeps no clock.
"""

from __future__ import annotations

import json
import re
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
def model() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_house_model.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _case(h: dict, prefix: str) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def _code(p: Path) -> str:
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith(("//", "*")))


@pytest.mark.parametrize("prefix,least", [
    ("storey:", 3), ("roof:", 3), ("stairs:", 3), ("door:", 1), ("doorway:", 1), ("types:", 4), ("view:", 10),
])
def test_the_house_model_harness_covers_each_part(model, prefix, least) -> None:
    got = [k for k in model["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    _case(model, prefix)


def test_every_house_model_case_passes(model) -> None:
    assert not model["failures"], json.dumps(model["failures"][:6], indent=2, ensure_ascii=False)


def test_the_view_cases_by_name(model) -> None:
    for name in ("view: stairs reach the floor above, as high as the gap, and cut their opening",
                 "view: the storey's own floor under a hall never drawn as a room",
                 "view: a doorway is drawn as a gap with no door in it",
                 "view: a door with no sensor stands ajar inside, shut outside, open when set",
                 "view: the roof shows a step out past the whole house, fading, then still: 0 frames at rest",
                 "view: zoomed in, a floor below the top, Top, walls Down, Edit or Roof Off: the roof lifts away",
                 "view: a door's sheet sets Shown: open, ajar or shut",
                 "view: each door drawn as its type, linked or as shown",
                 "view: a door on a cover follows its position, moves while it opens, then is still: 0 frames at rest",
                 "view: a door on a contact sensor slides open with it",
                 "view: a tap on a door on a cover sends nothing; a hold opens Home Assistant's own controls",
                 "view: a door something moves is one whose barrier card could move it",
                 "view: PadSpan's one guess: a wide patio door slides, a 1.85 m door is a double, a garage door sensor's is overhead",
                 "view: a door the 3D file links to a sensor reads it as the map does (backwards when the map says so)",
                 "view: a lock linked to a door on a cover is shown on it",
                 "view: a door of a type with no reading is the Atlas's grey, and stays where it was",
                 "view: the roof takes no press: what it hides is not pressed through it, an outside door below the eaves is"):
        assert model["cases"].get(name) is True, name


def test_imported_by_the_view_alone_with_its_own_catch() -> None:
    want = "import(`./live_aboard_storey.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and want in p.read_text(encoding="utf-8"))
    assert importers == ["live_aboard.js"], importers
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    at = la.index(want)
    assert ".catch(" in la[at:at + 200]


def test_it_imports_nothing_keeps_no_clock_and_writes_nothing() -> None:
    """three.js is handed in; only the view's capped clock moves the fade; it
    reads the house the view read and never calls Home Assistant."""
    src, doors = _code(_VIEWS / "live_aboard_storey.js"), _code(_VIEWS / "door_types.js")
    # Its one import: the doors' rules it shares with the flat Atlas, which import nothing.
    assert re.findall(r"\bimport\b[^;]*", src) == ["import(`./door_types.js${new URL(import.meta.url).search}`)"]
    assert not re.search(r"\bimport\b", doors)
    for bad in ("setInterval(", "setTimeout(", "requestAnimationFrame(", "callWS(", "callService(", "subscribe", "fetch(",
                "localStorage", "document."):
        assert bad not in src and bad not in doors, bad


def test_the_limits_are_the_servers() -> None:
    """The stair rise, the door's Shown, its types and options are the server's own lists."""
    src = (_VIEWS / "live_aboard_storey.js").read_text(encoding="utf-8")
    doors = (_VIEWS / "door_types.js").read_text(encoding="utf-8")
    draft = (_VIEWS / "live_aboard_draft.js").read_text(encoding="utf-8")
    assert 'export const DOOR_SHOWN = ["open", "ajar", "shut"];' in doors and HS.DOOR_SHOWN == ("open", "ajar", "shut")
    types = '["hinged", "double", "sliding", "barn", "pocket", "bifold", "overhead", "rollup", "tiltup", "gate"]'
    assert f"export const DOOR_TYPES = {types};" in doors and f"export const DOOR_TYPES = {types};" in draft
    assert list(HS.DOOR_TYPES) == json.loads(types)
    opts = 'export const DOOR_SLIDES = ["left", "right", "both"], DOOR_FACES = ["in", "out"], DOOR_PANELS = [2, 4];'
    assert opts in doors and opts in draft
    assert (HS.DOOR_SLIDES, HS.DOOR_FACES, HS.DOOR_PANELS) == (("left", "right", "both"), ("in", "out"), (2, 4))
    m = re.search(r"export const STAIR_RISE_M = \[([\d.]+), ([\d.]+)\];", src)
    assert m and (float(m[1]), float(m[2])) == HS.STAIR_RISE_M
    fur = (_VIEWS / "live_aboard_furniture.js").read_text(encoding="utf-8")
    assert 'choice("shape", "Shape", ["straight", "l", "u"]' in fur and HS.STAIR_SHAPES == ("straight", "l", "u")
    assert 'choice("turn", "Turns", ["left", "right"]' in fur and HS.STAIR_TURNS == ("left", "right")


def test_the_new_words_are_plain_and_never_say_3d() -> None:
    """New text says Live Aboard, never "3D" (the lead renames the old labels)."""
    for name, words in (("live_aboard.js", ("Roof: Auto", "Roof: Off", "The roof shows when you look at the house from outside")),
                        ("live_aboard_edit.js", ("Doorway", "an opening with no door in it", "It opens and shuts with its sensor.")),
                        ("live_aboard_furnish.js", ("Stairs up to the floor above: straight, L or U", "There is no floor above it to go up to."))):
        src = (_VIEWS / name).read_text(encoding="utf-8")
        for w in words:
            assert w in src, (name, w)
            line = next(ln for ln in src.splitlines() if w in ln)
            assert "3D" not in line, (name, line)
