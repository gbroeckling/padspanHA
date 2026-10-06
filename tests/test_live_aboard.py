# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part A: the 3D view behind the Atlas's Map / 3D switch.

tests/js/live_aboard_card.mjs runs the shared Atlas card (views/lights_map.js)
under the DOM shim with every module load recorded: off is byte-identical,
loads nothing and sends nothing; below Pro (Garry, 2026-09-30: PadSpan Pro
and Bright Pro only) it is exactly off; on at Pro the switch sits beside the
zoom and in the rail; each screen remembers its choice; with no WebGL (node
has none) the flat Atlas stays and the fallback is counted once.

The rest is held here: the plan's "Enforced by tests" names, the rules that
keep the feature dark (one import, behind the switch, of the bundled three.js
core and nothing else), the hosts, and the long-lived view's design. The
browser checks (real WebGL, the real 5 s poll, the GL context and camera
surviving it) run outside the suite, in headless Chromium.
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
def card() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_card.mjs"), str(_WWW)],
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


# ── the plan's "Enforced by tests" ───────────────────────────────────────────

def test_atlas_3d_off_is_byte_identical(card) -> None:
    """The flat drawing is identical with the feature absent, off, and on
    but not selected — in the classic, v2 and edge-to-edge layouts, on both
    screens. Absent and off are the whole card, byte for byte; on but showing
    Map differs only by the switch itself. Building absent, off or unset also
    asks for exactly the same listeners, timers, frames and observers (none of
    which the markup shows)."""
    _case(card, "off:")


def test_below_pro_is_exactly_off(card) -> None:
    """On, but at tier free or bright: byte-identical to absent, no switch,
    nothing loaded and nothing sent, even with 3D picked on that screen, and
    the same listeners, timers, frames and observers asked for. At
    Pro (PadSpan Pro and Bright Pro alike: the effective tier is "pro" in
    either edition) the switch shows on both screens."""
    _case(card, "gate:")


def test_off_means_no_import(card) -> None:
    """With the flag off (or on but showing Map, or below Pro) the card never
    loads the 3D module, its house module, its use surface, the compass or
    three.js — every module load is recorded. The positive control (on and
    3D) loads all five, so the recorder is known to see them."""
    _case(card, "noImport:")
    assert {"views/live_aboard.js", "views/live_aboard_house.js", "views/live_aboard_use.js", "views/fabric_compass.js",
            "vendor/three/three.module.min.js"} <= set(card["loaded"]), card["loaded"]
    # The Strip tool and its runs' rules (2026-10-05) are among what off never loads.
    assert {"views/live_aboard_strip.js", "views/live_aboard_runs.js"} <= set(card["loaded"]), card["loaded"]
    # So is motion (live_aboard_motion.js, 2026-10-05).
    assert "views/live_aboard_motion.js" in set(card["loaded"]), card["loaded"]
    # So is the house itself: each storey's floor, the roof, stairs' openings (live_aboard_storey.js, 2026-10-05).
    assert "views/live_aboard_storey.js" in set(card["loaded"]), card["loaded"]


def test_off_means_the_3d_file_is_never_read_or_written(card) -> None:
    """Off, below Pro, or on but showing Map: the hosts' load (house3d_get)
    and edit (house3d_edit) are never called."""
    _case(card, "file:")


def test_off_means_no_telemetry(card) -> None:
    _case(card, "silent:")


def test_the_switch_sits_beside_the_zoom_and_in_the_rail(card) -> None:
    _case(card, "switch:")


def test_each_screen_remembers_its_choice(card) -> None:
    _case(card, "pick:")


def test_any_failure_shows_the_flat_atlas_and_is_counted(card) -> None:
    """No WebGL2 is found on a canvas of its own before three.js is
    downloaded; it is remembered per browser and per build (a reload neither
    downloads nor looks again; a new build tries again). A screen too slow is
    remembered for the browser session only, never for the browser. The
    greyed 3D button says why in the page, not only in a tooltip."""
    _case(card, "fallback:")


def test_a_greyed_3d_button_tries_once_more(card) -> None:
    """A tap on the greyed 3D button, or on the reason beside it (on the
    edge-to-edge layout, the rail button once its drawer shows why), forgets
    no WebGL or too slow and tries once more: failing again, the reason is
    back and nothing is counted twice; able now, the 3D view shows."""
    _case(card, "retry:")


def test_a_view_still_loading_never_mounts_on_an_old_card(card) -> None:
    """Switched off (or the licence lapsing) while the 3D view still loads:
    no card from before gets it when it arrives."""
    _case(card, "pending:")


def test_every_card_case_passes(card) -> None:
    assert not card["failures"], json.dumps(card["failures"][:6], indent=2, ensure_ascii=False)
    assert len(card["cases"]) >= 9


# ── the report ───────────────────────────────────────────────────────────────

def test_the_card_sends_only_a_listed_word() -> None:
    """The one word the card sends itself (the module never arrived)."""
    lm = _js(_VIEWS / "lights_map.js")
    assert 'telemetry("house3d_fallback:error")' in lm
    assert "house3d_fallback:error" in T.HOUSE3D_EVENTS


def test_an_uncaught_3d_throw_is_attributed_to_its_module() -> None:
    assert "live_aboard" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard")


# ── kept dark: one import, behind the switch ─────────────────────────────────

def test_the_3d_module_is_imported_once_behind_the_switch_and_cache_busted() -> None:
    """Off, nothing of it is fetched: the shared card is the only importer,
    with its own .catch, and only from inside the switch's mount — which
    needs the setting on and the tier at Pro."""
    want = "import(`./live_aboard.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and want in _js(p))
    assert importers == ["lights_map.js"], importers
    lm = _js(_VIEWS / "lights_map.js").replace("\r\n", "\n")
    at = lm.index(want)
    assert lm[at:at + 400].count(".catch(") == 1, "the import must carry its own .catch"
    assert lm.index("function _laLoad(") < at < lm.index("export function buildLightsMapCard(")
    gate = ("const h3 = host.house3d && host.house3d.settings && host.house3d.settings.atlas_3d_enabled === true\n"
            '    && tierAtLeast(host.tier, "pro") ? host.house3d : null;')
    assert gate in lm
    assert "if (h3) mount3d();" in lm
    assert lm.count("_laLoad(") == 2, "one definition, one call (in mount3d)"
    # No other code in the panel names the 3D modules (prose in a comment may).
    for p in _WWW.rglob("*.js"):
        if "vendor" in p.parts or p.name in ("lights_map.js", "live_aboard.js", "live_aboard_house.js", "live_aboard_draft.js",
                                                  "live_aboard_edit.js", "live_aboard_furnish.js",   # P2: Furnish names its flows
                                                  "live_aboard_import.js",
                                                  "live_aboard_devices.js",     # P5: reads a light as the view does
                                                  "live_aboard_marks.js",       # the Atlas's leak sensors, locks and codes: reads the house as the view does
                                                  "live_aboard_motion.js",      # motion: reads the house as the view does
                                                  "live_aboard_people.js",    # the Furnish tab's people screen (P6)
                                                  "atlas_aboard.js"):         # the flat Atlas's people, tags, kinds and furniture (2026-10-05)
            continue
        code = "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*")))
        if p.name == "settings.js":
            # The library's Settings rows ask its module whether the library's
            # server is live (LIBRARY_SERVER_LIVE), only once Live Aboard is on.
            ask = "import(`./live_aboard_library.js${new URL(import.meta.url).search}`)"
            assert code.count(ask) == 1, p.name
            code = code.replace(ask, "")
        assert "live_aboard" not in code, p.name


def test_three_is_the_bundled_core_build_only() -> None:
    """three.js is the only outside code, used as a library through the
    bundled core build: no addons (the camera, merging and cut-away are
    PadSpan's own), never a CDN."""
    la = _js(_VIEWS / "live_aboard.js")
    assert "await import(`../vendor/three/three.module.min.js${new URL(import.meta.url).search}`)" in la
    for p in _WWW.rglob("*.js"):
        if "vendor" in p.parts:
            continue
        s = _js(p)
        for bad in ("examples/jsm", "three/addons", "OrbitControls", "BufferGeometryUtils", "RoundedBoxGeometry",
                    "cdn.jsdelivr", "unpkg.com"):
            assert bad not in s, (p.name, bad)
        if p.name == "live_aboard_people.js":
            # Its figure preview: the same bundled build, the same cache-busted URL (one module instance).
            assert s.count("three.module") == 1 and (
                "import(`../vendor/three/three.module.min.js${new URL(import.meta.url).search}`)" in s), p.name
        # The library's thumbnails load the same build the same way (tests/test_live_aboard_library.py).
        elif p.name not in ("live_aboard.js", "live_aboard_library.js"):
            assert "three.module" not in s, p.name
    assert (_WWW / "vendor" / "three" / "three.module.min.js").read_text(encoding="utf-8").startswith(
        "/**\n * @license\n * Copyright 2010-2024 Three.js Authors"), "the bundled build is unmodified"


def test_the_renderer_and_styles_are_untouched() -> None:
    """The flat drawing is byte-identical by construction: the renderer and
    the shared stylesheet know nothing of the 3D view (its sheet travels in
    its own element)."""
    iso = _js(_VIEWS / "iso_lights.js")
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    for s in (iso, css):
        assert "la3d" not in s and "live_aboard" not in s and "house3d" not in s


def test_the_hosts_hand_over_the_switch_only_from_settings() -> None:
    lp = _js(_WWW / "lights_panel.js")
    load = lp[lp.index("async _loadSettings("):lp.index("// ── Emergency lighting test")]
    assert "if (s.atlas_3d_enabled !== undefined) {" in load, "a failed fetch must keep the last answer"
    for k in ("atlas_3d_enabled", "atlas_3d_quality", "fabric_bearing_deg"):
        assert f"{k}: s.{k}" in load, k
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert 'slot: "atlas"' in block and "states: this._hass?.states" in block and "config: this._hass?.config" in block
    assert "if(!this.state._telemetryOn || !this._hass) return;" in block, "the report only while it is on"
    maps = _js(_VIEWS / "maps.js")
    mblock = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    mblock = mblock[:mblock.index("} : null,")]
    assert 'slot: "builder"' in mblock and "ctx.actions.telemetryEvent(name)" in mblock
    assert "states: ctx.hass?.states" in mblock and "config: ctx.hass?.config" in mblock


def test_the_compass_save_writes_the_bearing_alone() -> None:
    """The 3D compass's Save goes through the host, by the existing settings
    path, with fabric_bearing_deg and nothing else; the view writes nothing
    itself. (The browser run proves the payload, Cancel writing nothing and a
    tap still turning north-up.)"""
    lp = _js(_WWW / "lights_panel.js")
    block = lp[lp.index("house3d: this.state._house3d ?"):]
    block = block[:block.index("} : null,")]
    assert 'saveNorth: async (b)=>{' in block
    assert 'this._hass.callWS({ type:"padspan_ha/settings_set", fabric_bearing_deg: b })' in block
    # (P6: and Show people's read of Overview's live snapshot, only while it is on.)
    # (And the wall panel's: Show people / Show tags & scanners from inside the
    # view, the one key it is handed and nothing else.)
    assert block.count("callWS(") == 5, "the report's, the Save's, the 3D file's read, Show people's and the switches', nothing else"
    assert 'await this._hass.callWS({ type:"padspan_ha/settings_set", [key]: v });' in block
    assert 'people: { read: ()=>this._hass.callWS({ type:"padspan_ha/live_snapshot" })' in block
    assert 'load: ()=>this._hass.callWS({ type:"padspan_ha/house3d_get" }),' in block
    maps = _js(_VIEWS / "maps.js")
    mblock = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    mblock = mblock[:mblock.index("} : null,")]
    assert 'ctx.actions.wsCall("padspan_ha/settings_set", { fabric_bearing_deg: b })' in mblock
    # The fourth is P2 Furnish's: the host's connection handed to its flows
    # (contracts §4) and "This is a device…", only on Mapping → Furnish. The
    # fifth is Show people's read of the live snapshot (P6): Mapping does not
    # poll it, so the view reads it, only while Show people is on.
    # The sixth is the wall panel's switches (Show people, Show tags & scanners).
    assert "settingsSet(" not in mblock and mblock.count("wsCall(") == 6
    assert 'ctx.actions.wsCall("padspan_ha/settings_set", { [key]: v })' in mblock
    assert 'read: () => ctx.actions.wsCall("padspan_ha/live_snapshot")' in mblock
    assert "callWS: (msg) => { const { type, ...rest } = msg || {}; return ctx.actions.wsCall(type, rest); }," in mblock
    assert 'load: () => ctx.actions.wsCall("padspan_ha/house3d_get"),' in mblock
    lm = _js(_VIEWS / "lights_map.js")
    assert 'saveNorth: typeof h3.saveNorth === "function" ? h3.saveNorth : null,' in lm
    la = _js(_VIEWS / "live_aboard.js")
    assert "callWS" not in la and "wsCall" not in la and "settings_set" not in la
    # Save, Cancel, Escape, a tap elsewhere; the preview drives the sun only.
    for bit in ('"Save north"', '"Cancel"', 'e.key === "Escape"', "composedPath", "SPIN_SLOP", "bearingFromNeedle(",
                "northUpTheta(bearingNow())"):
        assert bit in la, bit


def test_the_view_survives_the_rebuild_by_design() -> None:
    """One long-lived element per screen, moved into each new card; the poll
    repaints lights and the sun, never shaders; renders on demand only."""
    la = _js(_VIEWS / "live_aboard.js")
    assert "export function liveAboardSlot(key)" in la and "export function releaseLiveAboardSlot(key)" in la
    assert "setInterval" not in la, "no timers of its own: it draws when something changes"
    # ...but for the live read's clock (Show people / tags while it shows), which draws nothing by itself.
    assert la.count("setTimeout(") == 1 and "peopleTimer = setTimeout(" in la
    assert "requestAnimationFrame(frame)" in la
    assert 'document.visibilityState === "hidden"' in la and "IntersectionObserver" in la
    # A bulb switching never changes visibility: the lamp pool's .visible is
    # only ever set by a profile change, and the sun is dimmed, never removed.
    assert la.count(".visible = i < Q.lamps") == 1 and "pl.visible" not in la
    assert "sun.visible" not in la and "sun.intensity = SUN_I * look.sun;" in la
    # The sun is read from the states the host holds: no calls of its own.
    assert "callWS" not in la and "callService" not in la and "fetch(" not in la
