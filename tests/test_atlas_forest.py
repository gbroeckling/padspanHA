# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Showcase's West Coast Forest: a theme like any other, with trees behind the flat map.

The theme is one more row in SHOWCASE_THEMES (iso_lights.js), _SHOWCASE_THEMES
(ws_settings.py) and SHOWCASE_LOOKS (live_aboard_showcase.js); there is no setting
of its own. While it is the theme showing, views/atlas_forest.js, fetched only
then, paints one picture for one plain box first in the stage: behind the drawing,
cut out where the rain's mask is, painted again only when the layout changes. Every other theme
draws as before. tests/js/atlas_forest.mjs runs it under the DOM shim.

PADSPAN_FOREST_DUMP=<model_get.json> runs the keep-clear check on a real house too
(house dumps stay out of the repo).
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
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")
_KEY = "west_coast_forest"


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _code(p: Path) -> str:
    """The file without its comment lines."""
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.fixture(scope="module")
def forest() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    args = [_NODE, str(Path(__file__).parent / "js" / "atlas_forest.mjs"), str(_WWW)]
    dump = os.environ.get("PADSPAN_FOREST_DUMP", "")
    if dump:
        args.append(dump)
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


# ── a theme like any other ───────────────────────────────────────────────────

def test_it_is_a_theme_and_not_a_setting() -> None:
    assert _KEY in WS._SHOWCASE_THEMES
    assert DEFAULT_SETTINGS["lights_showcase_theme"] == "classic"
    assert not [k for k in DEFAULT_SETTINGS if "outside" in k and k.startswith("atlas_")]
    iso = _js(_VIEWS / "iso_lights.js")
    assert f"  {_KEY}: {{\n" in iso and 'label: "West Coast Forest",' in iso


@pytest.mark.parametrize("raw,want", [(_KEY, _KEY), (" West_Coast_Forest ", _KEY), ("west_coast", "classic"), ("forest", "classic")])
def test_the_theme_name_is_kept_and_nothing_near_it(raw, want) -> None:
    assert WS._normalize_showcase_theme(raw) == want


def test_live_aboard_has_a_dark_row_and_its_own_trees() -> None:
    """Its row; the trees are live_aboard_forest.js (tests/test_live_aboard_forest.py), never the flat picture."""
    src = _js(_VIEWS / "live_aboard_showcase.js")
    m = re.search(r'west_coast_forest:\s+row\("(#[0-9a-f]{6})", "(#[0-9a-f]{6})"', src)
    assert m, "no row in SHOWCASE_LOOKS"
    for hx in m.groups():
        assert sum(int(hx[i:i + 2], 16) for i in (1, 3, 5)) < 90, "quite dark"
    la = _code(_VIEWS / "live_aboard.js")
    assert "atlas_forest" not in la and "atlas_forest" not in _code(_VIEWS / "live_aboard_showcase.js")


def test_the_new_file_s_errors_are_kept() -> None:
    assert "atlas_forest" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:atlas_forest")


# ── fetched only with the theme on ───────────────────────────────────────────

def test_the_file_is_fetched_only_with_the_theme_on() -> None:
    lm = _code(_VIEWS / "lights_map.js")
    assert lm.count("atlas_forest.js") == 1, "one import"
    load = lm[lm.index("function _forestLoad(){"):lm.index("export const WH_ARM_MS")]
    assert "import(`./atlas_forest.js${new URL(import.meta.url).search}`)" in load
    # Nothing at the top of the file brings it in: only _forestLoad does, and only mountForest calls that.
    assert lm.count("_forestLoad()") == 2
    assert 'const forestOn = () => !!host.showcase && host.showcaseTheme === FOREST_THEME;' in lm
    assert "mountForest(svgStr);\n    mountWeather(svgStr);" in lm, "the trees first, the rain over them"
    mount = lm[lm.index("const mountForest = (svgStr) => {"):lm.index("const mountWeather = (svgStr) => {")]
    assert mount.index("if (!forestOn())") < mount.index("_forestLoad();")
    # Below Pro, Showcase is off (lightsHostForTier), so the forest is too.
    assert "showcase: false, onShowcase: null," in lm


def test_the_ground_is_left_out_only_for_its_own_forest() -> None:
    lm = _code(_VIEWS / "lights_map.js")
    assert lm.count("outsideBehind") == 1 and "...(forestOn() ? { outsideBehind: true } : {})," in lm
    iso = _code(_VIEWS / "iso_lights.js")
    assert iso.count("outsideBehind") == 1 and """${SHOW&&opts.outsideBehind?' fill-opacity="0"':""}/>`;""" in iso
    # Traceback's and the rest's drawings never ask for it.
    for name in ("traceback.js", "overview.js", "maps.js"):
        assert "outsideBehind" not in _code(_VIEWS / name), name


# ── its own layer, nothing else touched ──────────────────────────────────────

def test_its_own_layer_and_never_pure_live() -> None:
    css = _js(_WWW / "styles.css")
    rule = css[css.index(".lv-forest{"):css.index("@media(max-width:900px){.lv-forest")]
    for word in ("position:", "z-index", "filter", "transform", "opacity", "isolation", "will-change"):
        assert word not in rule, f"{word}: the box must stay behind the drawing, in the flow"
    code = _code(_VIEWS / "atlas_forest.js")
    assert "purelive" not in code and "stage.style" not in code and "svg.style" not in code
    assert ".style.filter" not in code, "a filter on the box lifts it over the drawing"
    assert "stage.insertBefore(layer, stage.firstChild)" in code
    pure = _js(_VIEWS / "purelive.js") if (_VIEWS / "purelive.js").exists() else ""
    assert "forest" not in pure.lower()


def test_it_imports_only_the_rain_s_geometry_and_fetches_no_picture() -> None:
    code = _code(_VIEWS / "atlas_forest.js")
    assert re.findall(r"import\(`\./([a-z_]+\.js)", code) == ["atlas_weather.js"]
    for word in ("fetch(", ".png", ".jpg", ".webp"):
        assert word not in code, word


def test_a_poll_does_not_paint() -> None:
    """The picture is painted from fit(), and only when the plates or the size changed."""
    code = _code(_VIEWS / "atlas_forest.js")
    assert code.count("paint()") == 3
    fit = code[code.index("    fit(zoom, centred, width){"):code.index("    /** Off the page") if "    /** Off the page" in code else code.index("    detach(){")]
    assert "else if (sized) later();" in fit


# ── the words ────────────────────────────────────────────────────────────────

def test_help_in_every_language() -> None:
    src = _js(_WWW / "help_content.js")
    keys = re.findall(r't\("(  West Coast Forest — [^"]+)"\)', src)
    assert len(keys) == 1 and "  Theme — one of 20 looks for the whole map" in src
    for lang in ("de", "fr", "nl"):
        path = _WWW / "i18n" / lang / "help.json"
        data = json.loads(path.read_bytes().decode("utf-8"))
        assert data.get(keys[0]), lang
        assert "West Coast Forest" in data[keys[0]], lang
        assert "20" in data["  Theme — one of 20 looks for the whole map: colours, room edges and the style of the light."], lang


# ── the drawing (tests/js/atlas_forest.mjs) ──────────────────────────────────

@pytest.mark.parametrize("prefix", ["off:", "keep:", "clear: fixture", "clear: estate", "same:", "layer:", "light:", "turned:"])
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
