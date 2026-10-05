# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard: every Atlas device and every Atlas drawer control works in it.

tests/js/live_aboard_controls.mjs runs views/live_aboard_marks.js with the
3D view (views/live_aboard.js) and the shared card (views/lights_map.js) for
real under the DOM shim and a stub GL: ☰'s class chips fade the other
classes and stop their taps; ◎ Find active flies to the Atlas's pick,
showing its floor first; ⚙'s Zoom drives the camera (100% is the whole-house
fit); Mapping's Layout & view steps Spacing and L / R aside and points Save
view and Reset view at Live Aboard while it shows; leak sensors alarm as the
Atlas's do (wet or latched), moving only while they alarm; locks sit on their
wall, coloured by state, tapped and held through the use api; a door sensor
placed as a point draws nothing, as on the Atlas; codes show at room scale in
the theme's chip colours, none while hidden; heights by kind and from the 3D
file. Off, below Pro or on Map, the card is the flat card.

The rest is held here: the copies the marks file keeps of the Atlas's numbers
(the flood ripple, the lock glyph's colours, the class chips' fade) equal the
originals, read from iso_lights.js itself, and the class and latch tests are
the Atlas's own functions, imported, not copied.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def ctl() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_controls.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("class:", 1), ("find:", 1), ("zoom:", 1), ("card:", 1), ("flood:", 2), ("lock:", 1), ("door:", 1), ("codes:", 1),
    ("heights:", 1), ("off:", 1),
])
def test_the_controls_harness_covers_each_part(ctl, prefix, least) -> None:
    got = [k for k in ctl["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in ctl["failures"] if f["name"].startswith(prefix)]
    assert all(ctl["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_controls_case_passes(ctl) -> None:
    assert not ctl["failures"], json.dumps(ctl["failures"][:6], indent=2, ensure_ascii=False)


# ── the copies, held to the originals ────────────────────────────────────────

def _iso() -> str:
    return (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")


def _n(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def test_the_flood_ripple_is_the_atlas_own(ctl) -> None:
    iso = _iso()
    r = ctl["copies"]["FLOOD_RIPPLE"]
    ring = iso[iso.index("const floodRingSvg="):]
    ring = ring[:ring.index('class="lflood"')]
    assert f"const N=liveWet?{r['wet']['n']}:{r['latched']['n']};" in ring
    assert f"const DUR=liveWet?{_n(r['wet']['ms'] / 1000)}:{_n(r['latched']['ms'] / 1000)};" in ring
    assert f"const spin=(liveWet?{_n(r['wet']['spinMs'] / 1000)}:{_n(r['latched']['spinMs'] / 1000)})" in ring
    assert f"(rMax*{_n(r['from'])})" in ring and f'values="{_n(r["op"])};0"' in ring
    assert re.search(rf"const FLOOD_WAVE_LOBES = {r['lobes']}, FLOOD_WAVE_AMP = {_n(r['amp'])};", iso)


def test_the_lock_and_the_fade_are_the_atlas_own(ctl) -> None:
    iso = _iso()
    c = ctl["copies"]
    marker = iso[iso.index("const markerSvg="):]
    marker = marker[:marker.index("const tempFreshMs")]
    assert f'const fill=on?lit:(SHOW?THEME.fixtureOffFill:"{c["LOCK_LOOK"]["off"]}");' in marker
    assert f"*(dim?{_n(c['DIM_K'])}:1);" in marker
    assert f'((entry&&entry.color)||"{c["LOCK_LOOK"]["locked"]}")' in iso
    assert 'l.isLock ? l.state==="locked"' in marker


def test_the_marks_use_the_atlas_functions() -> None:
    src = (_VIEWS / "live_aboard_marks.js").read_text(encoding="utf-8")
    assert re.search(r"const \{ classMatches \} =\s*await import\(`\./lights_map\.js", src)
    assert re.search(r"const \{ floodLatchActive \} =\s*await import\(`\./iso_lights\.js", src)
    assert "deviceClassOf" in src and "function lightClassOf" not in src and "FLOOD_ACTIVE_WINDOW_S" not in src
    # No three.js of its own: the view hands it in.
    assert "vendor/three" not in src
