# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P6, the live layer: beacons, scanners and people in the house.

tests/js/live_aboard_tracked.mjs finds each person through the phone or tag
they carry, then runs the real 3D view under the DOM shim: with Show people
off the snapshot is never read and no one is drawn; on, a scanner with a look
stands at its height, a beacon with a look where it is tracked, a person as
their figure (or a soft marker), walking to where they are now on the capped
clock and still at rest; the snapshot is read through the host no more often
than it says.

The rest is held here: the people layer is off by default and its switch is
in the 3D house box; the shared card hands the snapshot over only while it is
on; Mapping hands over the snapshot it already polls, the sidebar a read of
Overview's; the flat Atlas's beacons wear a look only inside Show beacons.
"""

from __future__ import annotations

import json
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


@pytest.fixture(scope="module")
def tr() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_tracked.mjs"), str(_WWW)],
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


@pytest.mark.parametrize("prefix", ["people:", "off:", "on:", "walk:", "reads:"])
def test_the_tracked_harness_covers_each_part(tr, prefix) -> None:
    _case(tr, prefix)


def test_every_tracked_case_passes(tr) -> None:
    assert not tr["failures"], json.dumps(tr["failures"][:6], indent=2, ensure_ascii=False)


def test_the_people_layer_is_off_by_default_with_its_row() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_people"] is False
    sec = _js(_VIEWS / "settings.js")
    sec = sec[sec.index("function _atlas3dSection("):]
    assert 'tick("atlas_3d_people", "Show people", settings.atlas_3d_people === true,' in sec


def test_the_snapshot_is_handed_over_only_while_show_people_is_on() -> None:
    lm = _js(_VIEWS / "lights_map.js")
    mount = lm[lm.index("const mount3d = () => {"):lm.index("const pick3d = (on) => {")]
    assert "people: h3.settings.atlas_3d_people === true && h3.people ? h3.people : null," in mount
    maps = _js(_VIEWS / "maps.js")
    mblock = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    mblock = mblock[:mblock.index("} : null,")]
    # Mapping does not poll (panel.js _pollTick skips it): with live data the
    # view reads the live snapshot itself, as the sidebar does; sample data
    # stays the page's own.
    assert "if(this.state.view === \"maps\") return;" in _js(_WWW / "panel.js")
    assert 'people: ctx.state.dataMode === "live"' in mblock
    assert '? { read: () => ctx.actions.wsCall("padspan_ha/live_snapshot").then((r) => (r && r.snapshot) || null),' in mblock
    assert "everyMs: 1000 * (Number(ctx.state.settings.presence_poll_interval_s) || 5) }" in mblock
    assert ": { snapshot: () => ctx.state.live?.snapshot || null }," in mblock
    lp = _js(_WWW / "lights_panel.js")
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert 'people: { read: ()=>this._hass.callWS({ type:"padspan_ha/live_snapshot" })' in block
    assert "atlas_3d_people: s.atlas_3d_people, presence_poll_interval_s: s.presence_poll_interval_s" in lp
    # The view reads it through the host, never under 5 s apart, with no timer.
    la = _code(_VIEWS / "live_aboard.js")
    assert "const PEOPLE_MS = 5000;" in la and "Math.max(PEOPLE_MS, Number(pp.everyMs) || 0)" in la


def test_the_layer_calls_nothing_and_keeps_no_timer() -> None:
    code = _code(_VIEWS / "live_aboard_tracked.js")
    for bad in ("callWS", "callService", "callApi", "fetch(", "setTimeout", "setInterval", "requestAnimationFrame", "telemetry"):
        assert bad not in code, bad
    importers = sorted(p.name for p in _VIEWS.glob("*.js") if "live_aboard_tracked.js" in _js(p) and p.name != "live_aboard_tracked.js")
    assert importers == ["live_aboard.js"], importers
    want = "import(`./live_aboard_tracked.js${new URL(import.meta.url).search}`)"
    la = _js(_VIEWS / "live_aboard.js")
    assert la[la.index(want) + len(want):].lstrip().startswith(".catch("), "optional, like the other layers"
    assert "live_aboard_tracked" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_tracked")


def test_flat_beacons_wear_a_look_only_inside_show_beacons() -> None:
    """The looks are read (once) only while Show beacons is on and Live Aboard
    is on at Pro; a beacon without a look draws exactly as before."""
    maps = _js(_VIEWS / "maps.js")
    assert ('const beaconLooks = showBeacons && ctx.state.settings?.atlas_3d_enabled === true && _tierAtLeast(tier, "pro")\n'
            "    ? _beaconLooks(ctx, mapState) : null;") in maps.replace("\r\n", "\n")
    iso = _js(_VIEWS / "iso_lights.js")
    assert "if(b.look) s+=beaconLookSVG(bx, by, b.look);" in iso
    assert ('else s+=`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="4.5" fill="#5eead4" `+\n'
            '        `stroke="#0a1a12" stroke-width="1.2" opacity="0.9" pointer-events="none"/>`;') in iso.replace("\r\n", "\n")
