# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part A: the house read from the map, as numbers.

tests/js/live_aboard_house.mjs runs views/live_aboard_house.js and
views/fabric_compass.js for real: floors at their real heights, walls
derived from the room outlines with the barriers spliced in (glass a window,
open a gap), the whole-house cut-away rule, the Auto / Low / High pick, the
fixtures by the Atlas's own shape and their mount heights, the sun (sun.sun,
else worked out from hass.config, day / twilight / night), north from the
y-down fabric's bearing, and the usage report's words. The rest is held
here: those words equal telemetry.py's, closed, never an id, and an uncaught
throw in either file is credited to it.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def house() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_house.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _case(h: dict, prefix: str) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


@pytest.mark.parametrize("prefix,least", [
    ("floors:", 3), ("floorsTop:", 1), ("walls:", 6), ("cutaway:", 1), ("quality:", 3), ("lights:", 5),
    ("sun:", 5), ("compass:", 1), ("north:", 1), ("spin:", 4), ("telemetry:", 1),
])
def test_the_house_harness_covers_each_part(house, prefix, least) -> None:
    got = [k for k in house["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    _case(house, prefix)


def test_every_house_case_passes(house) -> None:
    assert not house["failures"], json.dumps(house["failures"][:6], indent=2, ensure_ascii=False)


def test_north_is_one_line_in_one_place() -> None:
    """fabric_compass.js is the only place the bearing becomes a direction and
    back: a redefined setting (say, the bearing the TOP of the plan faces) is
    its one marked constant, read by both directions. Nothing copies
    geo_bridge.py's y-up formula."""
    src = (_VIEWS / "fabric_compass.js").read_text(encoding="utf-8")
    marked = [ln for ln in src.splitlines() if "// the setting's meaning" in ln]
    assert len(marked) == 1 and marked[0].startswith("const OF_FABRIC_Y = 0;"), marked
    fwd = src[src.index("export function fabricCompass("):src.index("export function bearingOfNorth(")]
    inv = src[src.index("export function bearingOfNorth("):src.index("export function compassDir(")]
    assert "OF_FABRIC_Y" in fwd and "OF_FABRIC_Y" in inv
    for name in ("live_aboard_house.js", "live_aboard.js", "settings.js"):
        p = _VIEWS / name
        if not p.exists():
            continue
        code = "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith(("//", "*")))
        assert not re.search(r"(sin|cos)\(\s*\(?\s*(bearing|b)\b[^)]*\)", code.replace("Math.", "")), name


# ── the usage report ─────────────────────────────────────────────────────────

def test_the_report_words_are_the_frontends(house) -> None:
    """The frontend counts from its lists, the backend drops what is not on
    its own: the two must be the same words or counts vanish silently."""
    assert tuple(house["lists"]["fallbacks"]) == T.HOUSE3D_FALLBACK_KINDS
    assert set(house["lists"]["events"]) == set(T.HOUSE3D_EVENTS)
    assert set(T.HOUSE3D_EVENTS) == {"house3d_opened", "house3d_fallback:no_webgl", "house3d_fallback:slow_gpu",
                                     "house3d_fallback:context_lost", "house3d_fallback:error"}


def _hass(on: bool = True):
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": on})}}
    return h


def test_only_the_house3d_words_count_and_never_an_id() -> None:
    from custom_components.padspan_ha.const import DOMAIN
    h = _hass()
    for name in T.HOUSE3D_EVENTS:
        assert T.bump(h, name), name
        assert len(name) <= 64
    for bad in ("house3d_fallback:", "house3d_fallback:light.kitchen", "house3d_fallback:Nicole's Office",
                "house3d_opened:main", "house3d_fallback:no_webgl\n", "house3d_shown"):
        assert not T.bump(h, bad), bad
    assert set(h.data[DOMAIN][T._DATA_COUNTERS]) == set(T.HOUSE3D_EVENTS)
    T.assert_shareable(T.build_payload(h))
    assert not T.bump(_hass(on=False), "house3d_opened"), "nothing counted while the report is off"


def test_house3d_counts_pass_the_shareable_gate() -> None:
    usage = {n: 1 for n in T.HOUSE3D_EVENTS}
    for key in usage:
        for rx in (T._MAC_RE, T._UUID_RE, T._HEX32_RE, T._KEY_RE, T._IPV4_RE, T._IPV6_RE, T._EMAIL_RE, T._ENTITY_RE):
            assert not rx.search(key), (key, rx.pattern)
    T.assert_shareable({"schema": 1, "install_id": "8f0d0f7e-2c8f-4c8a-9d1c-0f2c3d4e5f60", "usage": usage})


def test_the_server_receiver_needs_nothing_new() -> None:
    """telemetry.php checks the shape of what arrives, never the names."""
    path = _ROOT / "server" / "telemetry.php"
    if not path.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    php = path.read_text(encoding="utf-8")
    pats = re.findall(r"'(/.+?/i?)',", php[php.index("$shapes = array("):])
    assert len(pats) >= 6
    flat = json.dumps({"usage": {n: 3 for n in T.HOUSE3D_EVENTS}})
    for p in pats:
        body, flags = p[1:p.rindex("/")], p[p.rindex("/") + 1:]
        assert not re.search(body.replace("\\'", "'"), flat, re.I if "i" in flags else 0), p


def test_an_uncaught_throw_is_attributed_to_its_module() -> None:
    for m in ("live_aboard_house", "fabric_compass"):
        assert m in T.UI_ERROR_HELPERS and T.event_allowed(f"ui_error:{m}"), m


def test_the_house_is_plain_numbers() -> None:
    """No three.js below the 3D view: these two run anywhere, node included."""
    for name in ("live_aboard_house.js", "fabric_compass.js"):
        code = re.sub(r"//.*", "", (_VIEWS / name).read_text(encoding="utf-8"))
        assert "three" not in code.lower(), name
    assert "import" not in re.sub(r"//.*", "", (_VIEWS / "fabric_compass.js").read_text(encoding="utf-8"))
