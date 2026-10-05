# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The flat Atlas gets what Live Aboard has (Garry, 2026-10-05: "add features
back and forth where they are out of sync, but also don't damage either of
the working setups").

tests/js/atlas_gets_la.mjs runs the shared Atlas card (views/lights_map.js),
the screen's rules (views/atlas_screen.js) and the flat map's Live Aboard
layers (views/atlas_aboard.js) for real under the DOM shim: the drawing is
byte for byte what it was with every new option off (on a realistic house,
and on Garry's own when its private export is on this PC — never in the
repo); off, nothing is fetched or read; the map alone, full screen and the
covers' order; a double-tap on a room, and a light double-tapped switching
once; tags, scanners and people from the snapshot with Live Aboard's own
cards and one read for both views; light kinds and furniture.

The rest is held here: the sidebar is the only host that hands the screen,
nothing new runs at rest, Mapping's own Show beacons is unchanged, and the
people and tags switches stand outside the Live Aboard rows.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")
# Garry's real house (a read-only export, outside the repo): used when present.
_HOUSE = os.environ.get("PADSPAN_HOUSE_EXPORT", "")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    args = [_NODE, str(Path(__file__).parent / "js" / "atlas_gets_la.mjs"), str(_WWW)]
    if _HOUSE and Path(_HOUSE).is_file():
        args.append(_HOUSE)
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _case(h: dict, prefix: str) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def test_the_drawing_is_byte_identical_with_the_new_options_off(run) -> None:
    """buildIsoSVG with no underlay; the sidebar card with its screen, with
    people and tags on (they lie over the drawing), with Live Aboard on and a
    file that sets no kind, Show furniture on an empty file: all the same
    drawing as a card without any of it."""
    _case(run, "byte:")


def test_off_fetches_nothing_and_reads_nothing(run) -> None:
    _case(run, "off:")


def test_the_flat_map_alone_and_full_screen(run) -> None:
    """Zoomed in past the whole house the bars step aside; ☰, Escape and
    zooming out bring them back; the next card keeps it; ⛶ and its way out;
    a screen that may not go full screen gets the map alone; never while Live
    Aboard shows; the emergency dial and the Vacation banner stay above."""
    _case(run, "alone:")


def test_double_tap_a_room_and_a_light_switches_once(run) -> None:
    _case(run, "tap:")


def test_tags_scanners_and_people_on_the_flat_map(run) -> None:
    """From the snapshot, with Live Aboard's own card for a tag or a scanner,
    a person's card, smooth moves and jumps, one read for both views."""
    _case(run, "live:")


def test_kinds_draw_as_atlas_shapes_and_furniture_shows_when_on(run) -> None:
    _case(run, "kinds:")
    _case(run, "furn:")


def test_only_the_sidebar_hands_the_screen() -> None:
    lp = _js(_WWW / "lights_panel.js")
    assert 'screen: { slot: "atlas", shownAt: this._shownAt || 0 },' in lp
    assert "this._shownAt = Date.now();" in lp[lp.index("  connectedCallback(){"):lp.index("  disconnectedCallback(){")]
    maps = _js(_VIEWS / "maps.js")
    assert "screen: {" not in maps and "atlas_screen" not in maps and "atlas_aboard" not in maps, "Mapping's builder is left as it is"
    lm = _js(_VIEWS / "lights_map.js")
    assert "const scr = SCREEN && host.screen && host.screen.slot" in lm
    # Mapping's own Show beacons stays its builder switch, unchanged.
    assert "beacons: host.showBeacons ? (host.beacons || null) : null," in lm


def test_the_new_modules_load_as_the_others_do_and_run_nothing_at_rest() -> None:
    lm = _js(_VIEWS / "lights_map.js")
    want = "import(`./atlas_screen.js${new URL(import.meta.url).search}`)"
    at = lm.index(want)
    assert lm[at:at + 200].count(".catch(") == 1
    ab = "import(`./atlas_aboard.js${new URL(import.meta.url).search}`)"
    assert lm.count(ab) == 1 and lm.index("function _abLoad(") < lm.index(ab) < lm.index("export function buildLightsMapCard(")
    assert lm[lm.index(ab):lm.index(ab) + 400].count(".catch(") == 1, "a failure leaves the map as it was"
    importers = sorted(p.name for p in _VIEWS.glob("*.js") if "atlas_aboard.js" in _code(p) and p.name != "atlas_aboard.js")
    assert importers == ["lights_map.js"], importers
    la = _js(_VIEWS / "live_aboard.js")
    assert "const SCREEN = await import(`./atlas_screen.js${new URL(import.meta.url).search}`);" in la
    for name in ("atlas_screen.js", "atlas_aboard.js"):
        code = _code(_VIEWS / name)
        for bad in ("setTimeout", "setInterval", "requestAnimationFrame", "callWS", "callService", "fetch("):
            assert bad not in code, (name, bad)
    # The renderer's one new option is guarded: absent or empty, nothing.
    iso = _js(_VIEWS / "iso_lights.js")
    assert "const UNDERLAY = Array.isArray(opts.underlay) && opts.underlay.length ? opts.underlay : null;" in iso
    assert "if(UNDERLAY) for(const u of UNDERLAY){" in iso


def test_live_aboard_takes_the_shared_screen_rules() -> None:
    """One implementation of when the bars step aside, the panel's box and
    full screen, for both views."""
    la = _js(_VIEWS / "live_aboard.js")
    assert "SCREEN.soloStep({ at: cam.radius, fit: fitR, bare, hold: soloHold, inward })" in la
    assert "function coverRect(){ return SCREEN.coverRect(hostEl(), fsOn); }" in la
    assert "function canFull(){ return SCREEN.canFull(hostEl()); }" in la
    assert "const now = SCREEN.isFullOf(fsTarget);" in la
    assert "SOLO_IN" not in _code(_VIEWS / "live_aboard.js")


def test_people_and_tags_rows_stand_outside_the_live_aboard_rows() -> None:
    s = _js(_VIEWS / "settings.js")
    sec = s[s.index("function _atlas3dSection("):s.index("// Live Aboard's shared furniture library")]
    assert "On the Atlas's map and in Live Aboard" in sec
    for key in ("atlas_3d_people", "atlas_3d_tags"):
        row = sec[sec.index(f'tick("{key}"'):]
        row = row[:row.index(");")]
        assert row.endswith(", both"), key
    assert "box.appendChild(more);\n  box.appendChild(both);" in sec
    # Tied to the box's own tier gate (Pro): the box is built only at Pro.
    assert 'if (tierAtLeast(currentTier(settings), "pro")) lightsCard.appendChild(_atlas3dSection(ctx, el, settings));' in s
