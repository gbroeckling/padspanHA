# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part B: the Atlas's live parts, read the Atlas's way.

tests/js/live_aboard_live.mjs runs views/live_aboard_house.js's live
readings for real against the flat Atlas's own renderer (iso_lights.js
buildIsoSVG) for the same house and the same states: a linked door, window or
lock reads as the Atlas draws it in every state (and as its own state word
says), an inverted sensor reads backwards for its barrier alone, motion and
air in the Atlas's colours on its clocks, the readouts in its words and
colours, one badge per plate as the Atlas numbers them, and the barrier card
handed exactly what the Atlas's click hands it.

The rest is held here: the copies the house file keeps of numbers the Atlas
holds inside buildIsoSVG (and the lock's flash, in styles.css) equal the
originals, read from those files themselves; and the readings reuse the
Atlas's own functions rather than a second copy of them.
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
def live() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_live.mjs"), str(_WWW)],
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
    ("doors:", 5), ("motion:", 3), ("air:", 1), ("readouts:", 2), ("badges:", 1), ("sensors:", 1),
])
def test_the_live_harness_covers_each_part(live, prefix, least) -> None:
    got = [k for k in live["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    _case(live, prefix)


def test_every_live_case_passes(live) -> None:
    assert not live["failures"], json.dumps(live["failures"][:6], indent=2, ensure_ascii=False)


# ── the copies, held to the originals ────────────────────────────────────────

def _iso() -> str:
    return (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")


def _js_num(expr: str, names: dict | None = None) -> int:
    """An integer the way the JS writes it: digits, *, and known names."""
    e = expr.strip()
    for k, v in (names or {}).items():
        e = e.replace(k, str(v))
    assert re.fullmatch(r"[\d*\s]+", e), expr
    out = 1
    for part in e.split("*"):
        out *= int(part)
    return out


def _const(src: str, name: str) -> str:
    m = re.search(rf"const {name}\s*=\s*([^;,]+)[;,]", src)
    assert m, name
    return m.group(1)


def test_the_motion_numbers_are_the_atlas_own(live) -> None:
    iso = _iso()
    hold = _js_num(_const(iso, "MOTION_HOLD_MS"))
    block = iso[iso.index("const MOTION_COLOR_STOPS=["):]
    block = block[:block.index("];")]
    block = re.sub(r"//[^\n]*", "", block[block.index("[") + 1:])
    stops = [[_js_num(a, {"MOTION_HOLD_MS": hold}), int(b)] for a, b in re.findall(r"\[\s*([^,\]]+),\s*(\d+)\s*\]", block)]
    c = live["copies"]
    assert stops and c["MOTION_COLOR_STOPS"] == stops
    assert c["MOTION_HOLD_MS"] == hold == 5 * 60 * 1000
    assert c["MOTION_RECENT_MS"] == _js_num(_const(iso, "MOTION_RECENT_MS"))
    assert c["MOTION_BOOT_GRACE_MS"] == _js_num(_const(iso, "BOOT_GRACE_MS"))
    # The pulse and the ring as the SVG animates them.
    pulse = iso[iso.index("const motionPulseSvg="):iso.index("const motionActive=")]
    assert f'values="{";".join(_n(v) for v in c["MOTION_PULSE"]["fill"])}" dur="1.6s"' in pulse
    assert c["MOTION_PULSE"]["ms"] == 1600
    lo, hi = c["MOTION_PULSE"]["ringR"]
    assert f"(r0*{_n(lo)})" in pulse and f"(r0*{_n(hi)})" in pulse
    assert f'values="{";".join(_n(v) for v in c["MOTION_PULSE"]["ringA"])}" dur="1.6s"' in pulse
    recent = iso[iso.index("const motionRecentPulseSvg="):iso.index("const LOCATE_R")]
    assert f'values="{";".join(_n(v) for v in c["MOTION_RECENT"]["op"])}" dur="3s"' in recent
    assert c["MOTION_RECENT"]["ms"] == 3000


def _n(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def test_the_readout_and_badge_numbers_are_the_atlas_own(live) -> None:
    iso = _iso()
    c = live["copies"]
    assert c["TEMP_FRESH_MS"] == _js_num(_const(iso, "TEMP_FRESH_MS"))
    assert re.search(rf"const TEMP_WARM_AT={c['TEMP_WARM_AT']}, TEMP_HOT_OVER={c['TEMP_HOT_OVER']};", iso)
    for band, t in c["TEMP_TINT"].items():
        assert re.search(rf'{band}:\s*\{{ wash:"{t["wash"]}", ink:"{t["ink"]}" \}}', iso), band
    pal = re.search(r"const LAYER_PAL = \[([^\]]+)\];", iso).group(1)
    assert c["LAYER_PAL"] == re.findall(r'"(#[0-9a-f]{6})"', pal)


def test_the_lock_flash_is_the_atlas_own(live) -> None:
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    f = live["copies"]["LOCK_FLASH"]
    a, b = f["op"]
    assert (f"@keyframes lv-lockflash{{0%,100%{{stroke:{f['from']};opacity:.{str(a).split('.')[1]}}}"
            f"50%{{stroke:{f['to']};opacity:{_n(b)}}}}}") in css
    assert f".lv-lockflash{{stroke:{f['to']};animation:lv-lockflash {f['ms'] // 1000}s ease-in-out infinite}}" in css


def test_the_readings_reuse_the_atlas_functions() -> None:
    """No second copy of a rule the Atlas already has: the no-reading rule,
    the state words and the plates come from the Atlas's own modules."""
    house = (_VIEWS / "live_aboard_house.js").read_text(encoding="utf-8")
    head = house[:house.index("// ── Small helpers")]
    for name in ("barrierNoReading", "fabricFrame", "floorIdAtLevel", "floorNameAtLevel"):
        assert re.search(rf"\b{name}\b", head[head.index("iso_lights.js") - 200:head.index("iso_lights.js")]), name
    assert "await import(`./lights_map.js${new URL(import.meta.url).search}`)" in head
    for name in ("stateWordOf", "floorIdsOnSlab", "airQualityBadness"):
        assert re.search(rf"\b{name}\b", head), name
    body = house[house.index("// ── The live parts: doors"):house.index("// ── Reading it all")]
    assert "barrierNoReading(dl)" in body and "stateWordOf(l)" in body and "airQualityBadness(l)" in body
    # Not re-derived: no state === "unavailable" / "unknown" test for a barrier here.
    assert 'dl.state === "unavailable"' not in body and 'dl.state === "unknown"' not in body


def test_the_live_parts_change_nothing_stored() -> None:
    """Read-only, as the rest of the house file: nothing writes, calls Home
    Assistant or keeps a clock of its own."""
    house = re.sub(r"//[^\n]*", "", (_VIEWS / "live_aboard_house.js").read_text(encoding="utf-8"))
    for bad in ("callWS", "callService", "callApi", "fetch(", "setTimeout", "setInterval", "localStorage", "Date.now()"):
        assert bad not in house, bad
