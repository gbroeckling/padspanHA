# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard's Strip tool: lay out LED strips and string lights exactly.

Garry, 2026-10-05: "Need to build a tool for better height and area placement
for string lights ... we need to take it a step farther for Sims."

tests/js/live_aboard_runs.mjs runs views/live_aboard_runs.js and the light
builder (views/live_aboard_house.js runParts) for real on a synthetic house
shaped like Garry's: wall tracing round corners, Round this room with gaps at
the doors, runs on a piece moving and turning with it, the catenary and its
bulbs, one continuous mitred tape per run and its light per face, and a light
with no run drawn exactly as before.

tests/js/live_aboard_strip.mjs runs Edit → Strip inside the real view and
editor under the DOM shim: drawing by a drag round a corner and by taps,
the one-tap areas, height chips, typed heights, the handles, ↑/↓, which way
it shines, a string's swag and spacing, adding and deleting points, Remove
run, Undo and Redo, a piece deleted in Furnish (its run stays put, one Undo)
and Save.

Here: every run either harness made goes through the server's own
apply_edit; the new modules load only with the 3D view and import nothing.
"""

from __future__ import annotations

import copy
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


def _harness(name: str) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / name), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.fixture(scope="module")
def runs() -> dict:
    return _harness("live_aboard_runs.mjs")


@pytest.fixture(scope="module")
def strip() -> dict:
    return _harness("live_aboard_strip.mjs")


@pytest.mark.parametrize("prefix,least", [
    ("trace:", 3), ("room:", 4), ("piece:", 4), ("string:", 2), ("build:", 9), ("check:", 3), ("draft:", 2),
])
def test_the_runs_harness_covers_each_part(runs, prefix, least) -> None:
    got = {k: v for k, v in runs["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, sorted(runs["cases"])
    bad = [f for f in runs["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


@pytest.mark.parametrize("prefix,least", [
    ("tool:", 1), ("draw:", 2), ("areas:", 4), ("height:", 3), ("face:", 2), ("edit:", 2), ("piece:", 1), ("heights:", 1),
    ("save:", 1), ("rest:", 1),
])
def test_the_strip_harness_covers_each_flow(strip, prefix, least) -> None:
    got = {k: v for k, v in strip["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, sorted(strip["cases"])
    bad = [f for f in strip["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_case_passes(runs, strip) -> None:
    assert not runs["failures"] and not strip["failures"], json.dumps((runs["failures"] + strip["failures"])[:4], indent=2, ensure_ascii=False)


def test_every_run_made_is_one_the_server_keeps(runs) -> None:
    """The runs the tool's own functions made (round a room, a rail, a piece,
    a string, one detached from a removed piece): the server keeps each as
    it is, on a file that has the piece where the run is on one."""
    assert len(runs["payloads"]) >= 8
    tv = {"id": "fur_000000aa", "recipe": {"kind": "tv", "params": {}, "colors": [], "width_m": 1.3, "depth_m": 0.08, "height_m": 0.8},
          "floor_id": "main", "x_m": 0.71, "y_m": -5.5, "z_m": 0.95, "rotation": 270}
    base = {**HS.empty(), "pieces": {k: {**tv, "id": k} for k in ("fur_000000aa", "fur_000000bb", "fur_000000cc")}}
    for p in runs["payloads"]:
        out = HS.apply_edit(base, {"lights": {"light.x": p["entry"]}})
        assert out["lights"]["light.x"] == p["entry"], p["what"]


def test_every_save_the_strip_tool_sent_goes_through_the_server(strip) -> None:
    """Each Save the editor sent, applied by the server's own apply_edit on
    the file as it then was: accepted, and holding exactly what was sent."""
    data = copy.deepcopy(strip["start"])
    assert strip["payloads"], "the harness saved nothing"
    for changes in strip["payloads"]:
        data = HS.apply_edit(data, changes)
        for eid, e in (changes.get("lights") or {}).items():
            assert data["lights"][eid] == e, eid
    assert all(data["lights"][e].get("run") for e in ("light.under", "light.deck", "light.cove", "light.tv", "light.pendant"))


def _code(p: Path) -> str:
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def test_the_strip_modules_load_only_with_the_3d_view() -> None:
    """The view loads the tool and the runs' rules (the house's light builder
    reads the rules too); nothing else names them, so with Live Aboard off
    nothing of them loads (the card's own off tests see every live_aboard_
    module). The tool and the rules import nothing, keep no timers and ask
    nothing of the browser's storage or the network."""
    la = _code(_VIEWS / "live_aboard.js")
    for want in ("await import(`./live_aboard_runs.js${new URL(import.meta.url).search}`)",
                 "await import(`./live_aboard_strip.js${new URL(import.meta.url).search}`)"):
        assert want in la, want
    assert "await import(`./live_aboard_runs.js${new URL(import.meta.url).search}`)" in _code(_VIEWS / "live_aboard_house.js")
    for name, allowed in (("live_aboard_runs.js", ["live_aboard.js", "live_aboard_house.js"]), ("live_aboard_strip.js", ["live_aboard.js"])):
        importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and f"./{name}" in _code(p))
        assert importers == allowed, (name, importers)
    for name in ("live_aboard_runs.js", "live_aboard_strip.js"):
        code = _code(_VIEWS / name)
        assert "import(" not in code and "import " not in code.replace("import.meta", ""), name
        for bad in ("confirm(", "alert(", "prompt(", "setInterval", "setTimeout", "localStorage", "fetch(", "callWS", "callService"):
            assert bad not in code, (name, bad)


def test_new_words_never_call_it_3d() -> None:
    """Garry's naming: the feature is Live Aboard; no new text calls the view 3D."""
    import re
    for name in ("live_aboard_strip.js", "live_aboard_runs.js"):
        texts = re.findall(r'"([^"\n]*)"|`([^`\n]*)`', _code(_VIEWS / name))
        said = [a or b for a, b in texts if re.search(r"[A-Za-z]{3}", a or b)]
        assert said and not [t for t in said if re.search(r"\b3d\b", t, re.I)], name
