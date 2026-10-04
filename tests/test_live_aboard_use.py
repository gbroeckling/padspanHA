# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part B: taps and holds in 3D are the Atlas's own.

tests/js/live_aboard_use.mjs runs views/live_aboard_use.js under the DOM shim
side by side with the flat Atlas's own use surface (lights_map.js
wireUseSurface): every gesture — tap, hold, hold-and-drag, moved before it
was held, a right button — on every kind of device, and on a room's name, a
floor's badge and a door, makes the very same calls with the very same
arguments through the host's use api and Home Assistant; the pressed ring and
the hover box are the Atlas's. The browser run (headless Chromium, Garry's
house) proves the same against the real panel and its real api.

The rest is held here: the hosts hand over the api they already build, and
nothing else; the 3D view calls nothing on Home Assistant itself and keeps no
timer; the picking is PadSpan's own, against the scene; no new report word.
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
def use() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_use.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _case(h: dict, prefix: str) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*")))


def test_every_gesture_makes_the_atlas_own_calls(use) -> None:
    _case(use, "parity:")


def test_the_pressed_ring_is_the_atlas_own(use) -> None:
    _case(use, "ring:")


def test_the_hover_box_is_the_atlas_own(use) -> None:
    _case(use, "hud:")


def test_a_piece_that_is_a_device_acts_as_it(use) -> None:
    """P5: a piece linked to a light the Atlas knows is that light's own
    target; one linked to anything else opens Home Assistant's controls."""
    _case(use, "piece:")


def test_nothing_is_pressed_without_the_host_api(use) -> None:
    _case(use, "quiet:")


def test_every_use_case_passes(use) -> None:
    assert not use["failures"], json.dumps(use["failures"][:6], indent=2, ensure_ascii=False)
    assert len(use["cases"]) >= 5


# ── the hosts hand over what they already have ───────────────────────────────

def test_the_hosts_hand_over_their_own_use_api() -> None:
    """The sidebar's _useApi and the builder's previewApi — the very objects
    the flat map's use surface acts through — asked for on a press, nothing
    new built for 3D."""
    lp = _js(_WWW / "lights_panel.js")
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert "useApi: ()=>this._useApi(lightsByEid, lights)," in block
    assert "wireUseSurface(isoDiv, api);" in lp and "const api = this._useApi(lightsByEid, lights);" in lp
    maps = _js(_VIEWS / "maps.js")
    mblock = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    mblock = mblock[:mblock.index("} : null,")]
    assert "useApi: () => previewApi," in mblock
    assert "requestAnimationFrame(() => wireUseSurface(isoDiv, previewApi))" in maps
    lm = _js(_VIEWS / "lights_map.js")
    mount = lm[lm.index("const mount3d = () => {"):lm.index("const pick3d = (on) => {")]
    assert 'useApi: typeof h3.useApi === "function" ? h3.useApi : null,' in mount
    # Motion reads quiet after a restart exactly as the flat drawing reads it.
    stamp = "haStartedMs: Date.parse(host.model && host.model.ha_started_at) || 0,"
    assert stamp in mount and stamp in lm[lm.index("const rebuildISO = () => {"):]


def test_the_dim_uses_wirePress_own_helpers() -> None:
    """The two helpers wirePress dims with are exported, unchanged, and the
    3D press imports them with the rest of the Atlas's own functions."""
    lm = _js(_VIEWS / "lights_map.js")
    assert "export { _exactBrightness, _tellProblems };" in lm
    wire = lm[lm.index("export function wireUseSurface("):lm.index("// ── The room / floor sheet")]
    assert "_exactBrightness(api.hass && api.hass.states, ex)" in wire and "_tellProblems(api.toast, p)" in wire
    u = _js(_VIEWS / "live_aboard_use.js")
    head = u[:u.index("const NS =")]
    for name in ("createHoldTracker", "dragBrightness", "setLightBrightness", "exactDeviceOf", "lastBrightness",
                 "openBarrierCard", "HOLD_MS", "PRESS_RING_MS", "_exactBrightness", "_tellProblems"):
        assert re.search(rf"\b{name}\b", head), name
    assert "await import(`./lights_map.js${new URL(import.meta.url).search}`)" in head


def test_the_3d_view_calls_nothing_on_home_assistant_itself() -> None:
    """Every action goes through the host's api or the Atlas's own helper;
    no websocket call, service call, history read, fetch or timer of its own
    (the hold is timed on the 3D view's frames)."""
    for name in ("live_aboard.js", "live_aboard_use.js", "live_aboard_house.js", "live_aboard_draft.js", "live_aboard_edit.js"):
        code = _code(_VIEWS / name)
        for bad in ("callWS", "callService", "callApi", "fetch(", "setTimeout", "setInterval", "telemetry_event"):
            assert bad not in code, (name, bad)


def test_the_picking_is_padspan_own() -> None:
    """A ray against the scene — the merged floor tiles and the walls — and
    the screen, with three.js's core Raycaster only; no addon."""
    la = _js(_VIEWS / "live_aboard.js")
    pick = la[la.index("// ── picking: what a press lands on"):la.index("// ── drawing, on demand")]
    assert "new THREE.Raycaster()" in pick and "intersectObjects(occ, false)" in pick
    assert "F.tiles" in pick and "F.solid" in pick and "HOUSE.openingPressable(" in pick
    assert "HOUSE.barrierCardOf(b)" in pick
    # The compass's own gestures come first: a tap that only puts north back
    # presses nothing, and a finger on the compass never reaches the house.
    assert "const onlyNorth = e === northDismissed;" in la and "northDismissed = e; cancelNorth();" in la
    assert 'compass.addEventListener("pointerdown", guard((e) => spinDown(e)));' in la


def test_no_new_report_word_and_the_new_file_is_credited() -> None:
    """Telemetry: no Atlas action counts anything, so nothing new is sent;
    an uncaught throw in the new file is credited to it."""
    assert set(T.HOUSE3D_EVENTS) == {"house3d_opened", "house3d_fallback:no_webgl", "house3d_fallback:slow_gpu",
                                     "house3d_fallback:context_lost", "house3d_fallback:error"}
    assert "live_aboard_use" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_use")
    assert "telemetry" not in _code(_VIEWS / "live_aboard_use.js")
