# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P5: furniture that is a device behaves like it.

tests/js/live_aboard_devices.mjs reads each behaviour from fake states (a lamp
with its light, a TV, a fan's speed, a washer running, a robot cleaning or
docked, a radiator heating, a car charging), follows a renamed entity by its
registry id and marks a deleted one unlinked, then runs the real 3D view
under the DOM shim: the lamp glows in its light's colour with its fixture
stepping aside, the emergency lights are outlined while the test runs, the
view draws nothing at rest and a turning fan only on its capped clock, and a
press on a linked piece makes the calls tapping the light on the flat Atlas
makes (or opens Home Assistant's own controls for a device the Atlas has no
marker for).

The rest is held here: the module is optional and loaded only by the 3D view;
it calls nothing on Home Assistant and keeps no timer; the hosts hand over
only what they already hold; the light's stored place is never touched.
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
def dev() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_devices.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
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


@pytest.mark.parametrize("prefix,least", [
    ("look:", 6), ("link:", 1), ("view:", 6), ("frames:", 3), ("taps:", 3),
])
def test_the_devices_harness_covers_each_part(dev, prefix, least) -> None:
    got = [k for k in dev["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    _case(dev, prefix)


def test_every_devices_case_passes(dev) -> None:
    assert not dev["failures"], json.dumps(dev["failures"][:6], indent=2, ensure_ascii=False)


def test_every_live_kind_the_builders_offer_is_handled() -> None:
    """Each builder's `live` (live_aboard_furniture.js) is one the devices
    module draws, and each part it draws is one the builders hand over."""
    fur = _js(_VIEWS / "live_aboard_furniture.js")
    lives = set(re.findall(r'kind\("[^"]+", "(?:furniture|device|tag|scanner)", "[a-z]+", "([a-z]+)"', fur))
    dv = _js(_VIEWS / "live_aboard_devices.js")
    line = dv[dv.index("export const LIVE_KINDS"):].split("\n", 1)[0]
    kinds = set(re.findall(r'"([a-z]+)"', line))
    assert lives and lives <= kinds, (lives, kinds)
    for k in kinds:
        assert f'case "{k}"' in dv, k
    for part in ("glow", "screen", "spin", "run", "dock", "warm"):
        assert f"parts.{part} = " in fur and f"P.{part}" in dv, part


def test_the_module_is_optional_and_loaded_only_by_the_3d_view() -> None:
    want = "import(`./live_aboard_devices.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _VIEWS.glob("*.js") if "live_aboard_devices.js" in _js(p) and p.name != "live_aboard_devices.js")
    assert importers == ["live_aboard.js"], importers
    la = _js(_VIEWS / "live_aboard.js").replace("\r\n", "\n")
    after = la[la.index(want) + len(want):]
    assert after.lstrip().startswith(".catch("), after[:120]
    assert "lights_map.js" not in _code(_VIEWS / "live_aboard_devices.js")


def test_it_calls_nothing_on_home_assistant_and_keeps_no_timer() -> None:
    code = _code(_VIEWS / "live_aboard_devices.js")
    for bad in ("callWS", "callService", "callApi", "fetch(", "setTimeout", "setInterval", "requestAnimationFrame", "telemetry"):
        assert bad not in code, bad
    # A device the Atlas has no marker for: Home Assistant's own dialog, an
    # event in the page, never a blind switch.
    use = _code(_VIEWS / "live_aboard_use.js")
    assert 'new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: eid } })' in use
    assert 'if (t.kind === "entity") { if (r === "tap" || r === "open") moreInfo(o.root, t.eid); return; }' in use


def test_the_hosts_hand_over_only_what_they_hold() -> None:
    """The registry the Atlas already fetches gives each entity by its
    registry id (no new call); the sidebar hands its emergency test status
    and hass.entities; the shared card passes them on to the 3D view only."""
    lm = _js(_VIEWS / "lights_map.js")
    reg = lm[lm.index("export function ensureLightsRegistry("):]
    reg = reg[:reg.index("\n}\n")]
    assert reg.count("callWS(") == 2 and "regIds[e.id] = e.entity_id" in reg and "doorLockMap, regIds };" in reg
    mount = lm[lm.index("const mount3d = () => {"):lm.index("const pick3d = (on) => {")]
    assert "entities: h3.entities || null, regIds: h3.regIds || null, emergency: h3.emergency || null," in mount
    lp = _js(_WWW / "lights_panel.js")
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert "regIds: this._regStore?.reg?.regIds || null" in block and "this.state._emerg.test.active" in block
    maps = _js(_VIEWS / "maps.js")
    mblock = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    assert "regIds: ctx.state._lightsRegStore?.reg?.regIds || null," in mblock[:mblock.index("} : null,")]


def test_a_light_with_a_piece_steps_aside_in_3d_only() -> None:
    """The fixture is hidden by its look (a zero matrix, no glow), never by
    its placement: nothing here writes the map or the light's position."""
    la = _code(_VIEWS / "live_aboard.js")
    assert "hidden = !!(L.wall && L.wall.cut) || !!L.swap" in la
    dv = _code(_VIEWS / "live_aboard_devices.js")
    for bad in ("light_positions_m", "house3d_edit", "model_set", "edit("):
        assert bad not in dv, bad


def test_the_new_file_is_credited_in_the_report() -> None:
    assert "live_aboard_devices" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_devices")
