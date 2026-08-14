"""Rules that must hold everywhere get ONE implementation.

Six defects in one week came from the same shape: a rule that has to be true
across the whole UI, written out again at each place that needed it, and the
copies drifting.  The away timeout had nine copies, the map-image cache buster
six, the floor resolution two, the marker scale two, the drag projection two.

These two were found by auditing for the pattern rather than by hitting the
bug:

  * roomColor had two entirely different algorithms — a continuous HSL hue and
    a ten-colour palette — under a comment claiming they matched.  Every room
    was one colour on the Overview and another on the lights map, and a colour
    the user set by hand was ignored by the lights map, which had no notion of
    the override at all.

  * the RSSI→distance model was written out inline in the calibration screen
    with n and rssi_1m hard-coded, while positioning used the configured values
    and per-scanner calibration fits.  The distance shown was not the distance
    the engine used.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_WWW = _ROOT / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _run(tmp_path: Path, modules: list[str], body: str) -> dict:
    for name in modules:
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(body, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, "node failed:\n" + res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


# ── Room colour ──────────────────────────────────────────────────────────────

def test_only_one_room_colour_implementation():
    """No file may derive a room colour itself."""
    offenders = []
    for path in list(_WWW.rglob("*.js")):
        if "/lib/" in path.as_posix() or path.name == "room_color.js":
            continue
        src = path.read_text(encoding="utf-8", errors="replace")
        # A hue or palette lookup built from the room name is a second copy.
        if re.search(r"hsl\(\$\{\s*h", src) or "ROOM_PAL" in src:
            offenders.append(path.name)
    assert not offenders, (
        "room colour is derived outside room_color.js, so surfaces will "
        "disagree: {}".format(offenders)
    )


def test_the_lights_map_and_the_panel_share_the_binding():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    iso = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert "room_color.js" in panel, "panel.js no longer imports the shared colour"
    assert "room_color.js" in iso, "the lights renderer no longer imports it"


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_a_hand_set_room_colour_is_honoured(tmp_path):
    """The override is the user's answer; it has to hold on every surface.

    The lights map had no notion of room_meta at all, so a colour set by hand
    applied everywhere except there.
    """
    out = _run(tmp_path, ["room_color"], (
        "import { roomColor } from './room_color.mjs';\n"
        "const model={room_meta:{Kitchen:{color:'#ff0000'}}};\n"
        "console.log(JSON.stringify({\n"
        "  override: roomColor('Kitchen', model),\n"
        "  derived: roomColor('Kitchen', {}),\n"
        "  noModel: roomColor('Kitchen'),\n"
        "  stable: roomColor('Kitchen', {}) === roomColor('Kitchen', {}),\n"
        "  distinct: roomColor('Kitchen', {}) !== roomColor('Garage', {}),\n"
        "}));\n"
    ))
    assert out["override"] == "#ff0000", "a hand-set colour was ignored"
    assert out["derived"].startswith("hsl("), out["derived"]
    assert out["noModel"] == out["derived"], "a caller without a model gets nothing"
    assert out["stable"], "the same room must be the same colour every time"
    assert out["distinct"], "two rooms collapsed to one colour"


# ── Path loss ────────────────────────────────────────────────────────────────

def test_no_view_writes_the_path_loss_formula_itself():
    offenders = []
    for path in list(_WWW.rglob("*.js")):
        if "/lib/" in path.as_posix() or path.name == "path_loss.js":
            continue
        src = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r"Math\.pow\(10,\s*\(([^)]*)\)\s*/\s*\(10", src):
            offenders.append("{}: {}".format(path.name, m.group(0)[:50]))
    assert not offenders, (
        "the RSSI->distance formula is written out instead of imported from "
        "path_loss.js, so the screen and the engine can disagree: {}".format(offenders)
    )


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_distance_uses_the_scanner_fit_then_settings_then_defaults(tmp_path):
    """The coordinator's own precedence, mirrored.

    A per-scanner calibration fit beats the site setting, which beats the
    built-in default. Hard-coding the default — which is what the calibration
    screen did — makes tuning move only half the system.
    """
    out = _run(tmp_path, ["path_loss"], (
        "import * as P from './path_loss.mjs';\n"
        "const rssi=-79;\n"
        "console.log(JSON.stringify({\n"
        "  def: P.estimateDistanceM(rssi, null, null, null),\n"
        "  setting: P.estimateDistanceM(rssi, null, null, {ref_power:-65, path_loss_exp:3.0}),\n"
        "  fit: P.estimateDistanceM(rssi, {rssi_1m:-65, n:3.0}, null, {ref_power:-59, path_loss_exp:2.5}),\n"
        "  tag: P.estimateDistanceM(rssi, null, -70, null),\n"
        "  bogusTag: P.estimateDistanceM(rssi, null, 8, null),\n"
        "  bad: P.estimateDistanceM(null, null, null, null),\n"
        "}));\n"
    ))
    # default: 10^((-59 - -79)/(10*2.5)) = 10^0.8
    assert abs(out["def"] - 10 ** 0.8) < 1e-9
    # settings honoured: 10^((-65 - -79)/(10*3)) = 10^(14/30)
    assert abs(out["setting"] - 10 ** (14 / 30)) < 1e-9
    # a scanner's own fit overrides the settings
    assert abs(out["fit"] - out["setting"]) < 1e-9
    # a plausible dBm@1m from the tag is used...
    assert abs(out["tag"] - 10 ** ((-70 + 79) / 25)) < 1e-9
    # ...but BLE radiated power (0..+12 dBm) is NOT a dBm@1m and must be refused
    assert abs(out["bogusTag"] - out["def"]) < 1e-9, (
        "radiated power was treated as a 1 m reference, which puts the tag "
        "kilometres away"
    )
    assert out["bad"] is None


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_frontend_matches_the_backend_formula(tmp_path):
    """Same inputs, same metres, as the coordinator computes them."""
    import math
    cases = [(-59.0, 2.5, -79.0), (-65.0, 3.0, -50.0), (-59.0, 2.0, -90.0)]
    out = _run(tmp_path, ["path_loss"], (
        "import * as P from './path_loss.mjs';\n"
        "const cases=" + json.dumps(cases) + ";\n"
        "console.log(JSON.stringify(cases.map(([ref,n,rssi]) =>\n"
        "  P.estimateDistanceM(rssi, {rssi_1m:ref, n:n}, null, null))));\n"
    ))
    for (ref, n, rssi), got in zip(cases, out):
        # presence_coordinator.py: 10.0 ** ((ref - rssi) / (10.0 * n))
        expected = 10.0 ** ((ref - rssi) / (10.0 * n))
        assert abs(got - expected) < 1e-9, (ref, n, rssi, got, expected)
