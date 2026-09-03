"""The WLED control popup decides what it offers from unstable data.

Home Assistant drops `brightness` while a light is off, and — the part that
bit us second — WLED does not report a stable `supported_color_modes`: the
same unit can say ['rgb'] in one state and ['onoff'] in another as segments
and effects change. Deciding from either snapshot alone made the brightness
slider and the colour picker appear and disappear on hardware that dims and
colours perfectly well.

These run the real decision from views/lights_map.js's shared control card
under node, against the attribute shapes actually observed on a live
install. The card used to live in lights_panel.js alone; it moved into the
shared module so the Mapping tab's "Preview as sidebar" opens the identical
card, not a second copy of the rule.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_PANEL = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "lights_map.js"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _extract_rules() -> tuple[str, str]:
    """Lift the two capability expressions out of the shared card's source.

    Reading them from the shipped file (rather than restating them here) is
    the point: a test that re-implements the rule cannot catch the rule
    changing. Whitespace-tolerant, because the rule now lives in a file with
    its own formatting conventions rather than lights_panel.js's.
    """
    src = _PANEL.read_text(encoding="utf-8")
    dim = re.search(r"const dimmable\s*=(.+?);", src, re.S)
    assert dim, "could not find the dimmable rule in views/lights_map.js"
    col = re.search(r"if\s*\((modes\.some\(m => \[\"rgb\".+?)\)\s*\{", src, re.S)
    assert col, "could not find the colour rule in views/lights_map.js"
    return dim.group(1).strip(), col.group(1).strip()


def _decide(cases: list[dict]) -> list[dict]:
    dim_expr, col_expr = _extract_rules()
    script = f"""
const CASES = {json.dumps(cases)};
const out = CASES.map(c => {{
  const attrs = c.attrs;
  const effectList = Array.isArray(attrs.effect_list) ? attrs.effect_list : [];
  const modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes : [];
  const dimmable = {dim_expr};
  const colour = ({col_expr});
  return {{ name: c.name, dimmable: !!dimmable, colour: !!colour }};
}});
console.log(JSON.stringify(out));
"""
    res = subprocess.run([_NODE, "-e", script], capture_output=True, text=True,
                         encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


_FX = ["Solid", "Rainbow"]


def test_a_wled_unit_keeps_its_controls_in_every_state_it_reports():
    """The reported bug: same unit, controls come and go."""
    results = {r["name"]: r for r in _decide([
        # The same physical strip, in the three shapes a live install showed.
        {"name": "on_rgb",   "attrs": {"effect_list": _FX, "supported_color_modes": ["rgb"],
                                        "brightness": 200, "rgb_color": [255, 0, 0]}},
        {"name": "off_rgb",  "attrs": {"effect_list": _FX, "supported_color_modes": ["rgb"]}},
        # Observed live: effect-capable, ON, but claiming on/off only and
        # reporting no brightness at all.
        {"name": "on_onoff", "attrs": {"effect_list": _FX, "supported_color_modes": ["onoff"]}},
    ])}
    for name, r in results.items():
        assert r["dimmable"] is True, f"{name}: a WLED unit lost its brightness slider"


def test_brightness_survives_the_light_being_off():
    r = _decide([{"name": "off", "attrs": {"effect_list": _FX,
                                           "supported_color_modes": ["rgb"]}}])[0]
    assert r["dimmable"] is True


def test_colour_survives_a_momentary_onoff_report():
    """A unit still reporting an rgb_color plainly takes colour."""
    r = _decide([{"name": "flap", "attrs": {"effect_list": _FX,
                                            "supported_color_modes": ["onoff"],
                                            "rgb_color": [12, 34, 56]}}])[0]
    assert r["colour"] is True


def test_a_plain_switch_is_still_not_offered_colour():
    """The rule must not become 'always show everything'."""
    r = _decide([{"name": "switch", "attrs": {"supported_color_modes": ["onoff"]}}])[0]
    assert r["colour"] is False
    assert r["dimmable"] is False


def test_a_dimmable_non_colour_bulb_gets_brightness_but_not_colour():
    r = _decide([{"name": "dimmer", "attrs": {"supported_color_modes": ["brightness"],
                                              "brightness": 128}}])[0]
    assert r["dimmable"] is True
    assert r["colour"] is False
