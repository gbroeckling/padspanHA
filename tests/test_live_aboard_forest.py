# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""West Coast Forest's trees in Live Aboard (views/live_aboard_forest.js).

Only when Live Aboard follows the Atlas (atlas_3d_look "atlas") with Showcase on and
this theme: no setting of its own, the file fetched only then, every other look as
before. tests/js/live_aboard_forest.mjs runs the plan on the fixture house, the
estate and, with PADSPAN_FOREST_DUMP=<model_get.json>, a real house (dumps stay out
of the repo).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _code(p: Path) -> str:
    """The file without its comment lines."""
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def _between(src: str, a: str, b: str) -> str:
    return src[src.index(a):src.index(b)]


@pytest.fixture(scope="module")
def forest() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    args = [_NODE, str(Path(__file__).parent / "js" / "live_aboard_forest.mjs"), str(_WWW)]
    dump = os.environ.get("PADSPAN_FOREST_DUMP", "")
    if dump:
        args.append(dump)
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


# ── only with that look, fetched only then ───────────────────────────────────

def test_no_setting_of_its_own() -> None:
    assert not [k for k in DEFAULT_SETTINGS if "forest" in k or "trees" in k]


def test_the_file_is_fetched_only_with_the_atlas_look_showcase_and_the_theme() -> None:
    la = _code(_VIEWS / "live_aboard.js")
    assert la.count("live_aboard_forest.js") == 1, "one import"
    sync = _between(la, "  function syncForest(){", "  function dropForest(failedToo){")
    assert sync.index('const want = !!atlas && atlas.on && atlas.theme === "west_coast_forest" && !forestFailed;') < sync.index("import(`./live_aboard_forest.js")
    assert "if (!want) { dropForest(false); return; }" in sync
    # Nothing at the top of the file brings it in: the import is inside syncForest, and only update() calls that.
    assert la.count("syncForest()") == 2 and "    applySun(p);\n    syncForest();\n" in la
    # atlas is only ever set with the "atlas" look; on is Showcase on, and below Pro Showcase is off.
    assert 'A = LOOKS && p.look3d === "atlas" ? LOOKS.atlasLook(p.atlasLook) : null;' in la
    lm = _code(_VIEWS / "lights_map.js")
    assert "showcase: false, onShowcase: null," in lm and "atlasLook: { on: !!host.showcase," in lm


def test_every_other_look_draws_as_before() -> None:
    la = _code(_VIEWS / "live_aboard.js")
    # With no forest made, the only code that runs is its guard.
    for guard in ("      if (forest) forestFrame();\n", "if (step.fallback && forest) {", "try { if (forest) forest.dispose(); }"):
        assert guard in la, guard
    assert "${forest ? \"|forest\" : \"\"}`, ...(forest ? FOREST.RAIN_REACH : {})," in la
    assert la.count("ground.visible") == 2 and la.count("gridLines.visible") == 2, "only dropForest and forestFrame touch them"
    showcase = _js(_VIEWS / "live_aboard_showcase.js")
    assert "forest.js" not in showcase and 'west_coast_forest:      row("#070d0b", "#0e1712", "#8fb0a6", 0.3,  0.75, 0.42, 1.35),' in showcase


def test_the_ground_comes_back_where_the_trees_stay_out() -> None:
    la = _code(_VIEWS / "live_aboard.js")
    frame = _between(la, "  function forestFrame(){", "  function applyWeather(p){")
    assert "const on = !quiet && !furnishOn && !(editor && editor.active);" in frame
    assert "ground.visible = !on" in frame and "gridLines.visible = !on" in frame


def test_it_never_breaks_the_view() -> None:
    la = _code(_VIEWS / "live_aboard.js")
    assert 'console.warn("PadSpan: live_aboard_forest failed to load", err);' in la
    assert la.count('console.warn("PadSpan: the forest failed", err); dropForest(true);') == 2
    # Too slow with it: it goes before the view falls back to the flat Atlas.
    decide = _between(la, "  function decideQuality(){", "  function openView(){")
    assert decide.index("if (step.fallback && forest)") < decide.index("if (step.fallback) { fail(step.fallback); return; }")


def test_what_it_costs() -> None:
    code = _code(_VIEWS / "live_aboard_forest.js")
    assert re.findall(r"import\(`\./([a-z_]+\.js)", code) == ["atlas_forest.js"], "the flat forest's seeding; three.js is handed in"
    assert "requestAnimationFrame" not in code and "setInterval" not in code and "setTimeout" not in code, "nothing moves by itself"
    assert "castShadow" not in code and "MeshStandardMaterial" not in code and "fetch(" not in code
    assert "transparent: true" not in code, "cut out, not blended: no sorting, no overdraw blending"
    # A frame sets a few uniforms: no loop over the trees.
    prepare = _between(code, "    prepare(camera, target, o){", "    state(){")
    assert "for (" not in prepare and "forEach" not in prepare
    assert 'fog: false, lights: false' in code


def test_never_pure_live_and_no_new_import_outside() -> None:
    code = _code(_VIEWS / "live_aboard_forest.js")
    assert "purelive" not in code and ".style" not in code
    pure = _js(_VIEWS / "purelive.js") if (_VIEWS / "purelive.js").exists() else ""
    assert "forest" not in pure.lower()


def test_the_new_file_s_errors_are_kept() -> None:
    assert "live_aboard_forest" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_forest")


# ── the plan (tests/js/live_aboard_forest.mjs) ───────────────────────────────

@pytest.mark.parametrize("prefix", ["read:", "clear: fixture", "clear: estate", "same:", "dense:", "budget:", "rain:", "sun:"])
def test_each_part_of_the_forest(forest, prefix) -> None:
    got = {k: v for k, v in forest["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(forest['cases'])}"
    bad = [f for f in forest["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_a_real_house_too(forest) -> None:
    if not os.environ.get("PADSPAN_FOREST_DUMP"):
        pytest.skip("PADSPAN_FOREST_DUMP is not set (house dumps stay out of the repo)")
    bad = [f for f in forest["failures"] if f["name"].startswith("clear: dump")]
    assert forest["cases"].get("clear: dump") and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


# ── the words ────────────────────────────────────────────────────────────────

def test_help_says_the_trees_are_in_3d_too() -> None:
    src = _js(_WWW / "help_content.js")
    key = re.findall(r't\("(  West Coast Forest — [^"]+)"\)', src)[0]
    assert "trees in 3D" in key and "only its colours" not in key
    for lang in ("de", "fr", "nl"):
        data = json.loads((_WWW / "i18n" / lang / "help.json").read_bytes().decode("utf-8"))
        assert "3D" in data[key], lang

def test_the_trees_are_conifers_not_palms() -> None:
    """Garry, 2026-11-03: a few big boughs on a bare trunk read as palms. Many
    short boughs up a crown that starts low, and no stem down a bough's picture."""
    src = (Path(__file__).resolve().parent.parent / "custom_components/padspan_ha/www/padspan-ha/views/live_aboard_forest.js").read_text(encoding="utf-8")
    bases = [float(x) for x in re.findall(r"base: ([0-9.]+),\s+rmax", src)]
    assert len(bases) == 3 and max(bases) <= 0.3
    near = re.search(r"near: \{ whorls: (\d+), per: (\d+), wide: [0-9.]+, most: ([0-9.]+) \}", src)
    assert near and int(near[1]) * int(near[2]) >= 150 and float(near[3]) <= 0.08
    assert "function spray(" not in src and "function lace(" not in src
