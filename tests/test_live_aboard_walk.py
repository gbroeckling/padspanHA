# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Walk-through in the 3D house (views/live_aboard_walk.js, inside live_aboard.js).

The owner's item 21 (approved 2026-11-23): walk the house at eye height, an
on-screen stick on touch, W A S D or the arrows on a keyboard, drag to look;
walls and closed doors stop you, stairs carry you between floors; one button
returns to the orbit view; render on demand while standing still.

tests/js/live_aboard_walk.mjs runs the rules as numbers on a house read the
way the view reads it (walls, closed and open doors, a window's sill, an open
gap, a raised room, straight and L stairs, the stairs' opening upstairs, the
keys, the stick, a drag, the camera at the eyes, where a walk starts), then
the real view under the DOM shim with a stub GL: Walk on the bar and in
View ▾, the keys, a wall, the Den's door shut then opened by its sensor, up
and down the stairs, the stick and a drag, from the front door to the room
upstairs with the stick and a drag only (a tablet) and with the keys only
(a PC), Stop walking and Esc putting the orbit view back exactly, and no
frame drawn while standing still or back in orbit.

Held here too: the module asks nothing of Home Assistant, draws nothing
itself and asks for no frame on its own clock; the view alone imports it;
its report words are the same on both sides and allowed; its errors are
credited to it.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_walk.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("num:", 11), ("start:", 1), ("enter:", 2), ("keys:", 2), ("door:", 1), ("stairs:", 1), ("stick:", 2), ("tablet:", 2),
    ("stop:", 2), ("rest:", 2),
])
def test_the_walk_harness_covers_each_part(harness, prefix, least) -> None:
    got = {k: v for k, v in harness["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)}: {sorted(harness['cases'])}"
    bad = [f for f in harness["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)[:3000]


def test_every_walk_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:3], indent=2, ensure_ascii=False)[:3000]


def _code(p: Path) -> str:
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def test_it_asks_nothing_of_home_assistant_and_the_view_alone_imports_it() -> None:
    code = _code(_VIEWS / "live_aboard_walk.js")
    for word in ("callWS", "callService", "hass", "sendMessage", "localStorage", "fetch(", "THREE", "requestAnimationFrame",
                 "setTimeout", "setInterval", "requestPointerLock"):
        assert word not in code, word
    # Its only import: the panel's words.
    assert re.findall(r"import\(`\./([a-z_0-9]+\.js)", code) == ["i18n.js"]
    users = [p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and "import(`./live_aboard_walk.js" in p.read_text(encoding="utf-8")]
    assert users == ["live_aboard.js"], users
    # Optional: missing, the view has no Walk and is otherwise as it was.
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    assert 'const WALK = await import(`./live_aboard_walk.js${new URL(import.meta.url).search}`)\n  .catch(' in la
    assert "const walkB = WALK ? seg(null" in la and "...(WALK ? [null, { text: t(\"Walk\")" in la
    assert "live_aboard_walk" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_walk")


def test_nothing_else_moves_the_camera_while_walking() -> None:
    """The panel's flight home and the director wait (busy "walk"), Edgecut and the floor chips leave the camera alone,
    Explode and the chosen floor give way to every floor where it really is, and the walls stand."""
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    assert la.count('busy: () => (walking() ? "walk" :') == 2
    assert "if (!camera || !canvas || failed || walking()) return;" in la
    assert "if (walking()) return 0;" in la
    assert "const t = walking() ? null : HOUSE.topFloorElev(" in la
    assert 'const mode = walking() ? "up" :' in la
    assert "if (walking()) return;                                 // walking: every floor shows" in la
    # Frames: only while the walker moves (a key or the stick held, the eyes settling on a step).
    assert "(walking() && walkC.moving())) && !pending" in la


def test_the_report_words_are_the_same_on_both_sides() -> None:
    house = (_VIEWS / "live_aboard_house.js").read_text(encoding="utf-8")
    m = re.search(r'export const WALK_WAYS = \[([^\]]*)\];', house)
    assert m and tuple(re.findall(r'"([a-z_]+)"', m.group(1))) == T.HOUSE3D_WALK_WAYS == ("start", "keys", "stick", "drag", "stairs")
    assert "...WALK_WAYS.map(w => `house3d_walk:${w}`)" in house
    for w in T.HOUSE3D_WALK_WAYS:
        assert T.event_allowed(f"house3d_walk:{w}") and f"house3d_walk:{w}" in T.HOUSE3D_EVENTS
    assert not T.event_allowed("house3d_walk:Living room") and not T.event_allowed("house3d_walk:")
    # The owner's report reads them in words.
    ib = (_VIEWS / "installbase.js").read_text(encoding="utf-8")
    for w in T.HOUSE3D_WALK_WAYS:
        assert f'"house3d_walk:{w}":' in ib, w
