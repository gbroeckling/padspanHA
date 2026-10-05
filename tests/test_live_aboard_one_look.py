# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""One look: Live Aboard looks like the Atlas.

atlas_3d_look: "atlas" (the default) — Live Aboard wears whatever the Atlas
shows (its Showcase theme, or the plain Atlas): the same page, rooms drawn in
the Atlas's language, the floors' numbers and colours, the Atlas's words for
each reading; "own" — Live Aboard's own look, exactly as before. The older
atlas_3d_showcase switch stays valid (old backups, Bright) but nothing reads
it any more. tests/js/live_aboard_one_look.mjs draws it under the DOM shim.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_house3d_store import _house, _restore, store  # noqa: F401  (store: the Store stand-in fixture)

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def look() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_one_look.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _case(h: dict, prefix: str) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


# ── the setting ──────────────────────────────────────────────────────────────

def test_the_look_is_the_atlas_s_by_default() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_look"] == "atlas"
    assert DEFAULT_SETTINGS["atlas_3d_showcase"] is False, "the older switch is still known"
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"atlas_3d_look", "atlas_3d_showcase"} <= keys


@pytest.mark.parametrize("raw,want", [("atlas", "atlas"), ("own", "own"), ("OWN ", "own"), ("", "atlas"), (None, "atlas"),
                                      ("dark", "atlas"), (1, "atlas")])
def test_anything_but_own_is_the_atlas_s_look(raw, want) -> None:
    assert WS._atlas_3d_look(raw) == want


def test_the_look_round_trips_for_any_user() -> None:
    """Saved by any user (it changes only how this house is drawn), cleaned,
    echoed in the reply the Settings row reads and read back by settings_get."""
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    from tests.test_telemetry import _hass as _house_hass
    h, conn = _house_hass(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_look": "Own"}))
    assert not conn.send_error.called
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert data["atlas_3d_look"] == "own"
    assert conn.send_result.call_args[0][1]["settings"]["atlas_3d_look"] == "own"
    get = MagicMock()
    _run(WS.ws_settings_get(h, get, {"id": 2}))
    assert get.send_result.call_args[0][1]["settings"]["atlas_3d_look"] == "own"
    _run(WS.ws_settings_set(h, conn, {"id": 3, "atlas_3d_look": "nonsense"}))
    assert data["atlas_3d_look"] == "atlas", "anything else is the Atlas's look"


def _get(h) -> dict:
    get = MagicMock()
    _run(WS.ws_settings_get(h, get, {"id": 9}))
    return get.send_result.call_args[0][1]["settings"]


def test_a_backup_brings_the_look_back(store, monkeypatch) -> None:
    """Restored with the other settings; an older backup that has only
    atlas_3d_showcase (on or off) restores to the Atlas's look, which shows
    the Showcase theme whenever the Atlas does."""
    from custom_components.padspan_ha.const import SETTINGS_STORE_KEY
    h = _house()
    _restore(h, monkeypatch, {SETTINGS_STORE_KEY: {"atlas_3d_enabled": True, "atlas_3d_look": "own"}})
    assert _get(h)["atlas_3d_look"] == "own" and store.saved[SETTINGS_STORE_KEY]["atlas_3d_look"] == "own"
    for old in (True, False):
        _restore(h, monkeypatch, {SETTINGS_STORE_KEY: {"atlas_3d_enabled": True, "atlas_3d_showcase": old}})
        got = _get(h)
        # Until Home Assistant restarts the key is simply absent (both hosts
        # read that as the Atlas's look); the next load fills in the default.
        assert got.get("atlas_3d_look", "atlas") == "atlas" and got["atlas_3d_showcase"] is old
        assert {**DEFAULT_SETTINGS, **store.saved[SETTINGS_STORE_KEY]}["atlas_3d_look"] == "atlas"


# ── the hooks ────────────────────────────────────────────────────────────────

def test_the_hosts_hand_over_the_look_and_nothing_reads_the_old_switch() -> None:
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert 'look3d: h3.settings.atlas_3d_look === "own" ? "own" : "atlas",' in lm
    assert ('atlasLook: { on: !!host.showcase, key: host.showcaseTheme || "classic",\n'
            '                       theme: SHOWCASE_THEMES[host.showcaseTheme] || SHOWCASE_THEMES.classic },') in lm
    assert "atlas_3d_showcase" not in lm, "the flat Atlas's card never reads the older switch"
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "atlas_3d_look: s.atlas_3d_look," in lp
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    block = maps[maps.index("house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?"):]
    assert 'slot: "builder", settings: ctx.state.settings,' in block[:200], "Mapping hands over the whole settings payload"
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    assert 'LOOKS && p.look3d === "atlas" ? LOOKS.atlasLook(p.atlasLook) : null' in la


def test_the_settings_row_reads_plainly() -> None:
    src = (_VIEWS / "settings.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert 'const _ATLAS_3D_LOOK = [["atlas", "Same as the Atlas"], ["own", "Live Aboard\'s own"]];' in src
    sec = src[src.index("function _atlas3dSection("):src.index("// ── UI Structure tab")]
    assert 'more.appendChild(row("Look", [lookSel]));' in sec and 'save("atlas_3d_look", want,' in sec


def test_the_floor_colours_are_the_atlas_s_own_list() -> None:
    """Shared, not copied: iso_lights.js exports LAYER_PAL and Live Aboard
    takes it from there."""
    iso = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert iso.count("const LAYER_PAL = [") == 1 and "export const LAYER_PAL = [" in iso
    house = (_VIEWS / "live_aboard_house.js").read_text(encoding="utf-8")
    assert "export const { LAYER_PAL } = await import(`./iso_lights.js" in house and "LAYER_PAL = [" not in house


# ── the drawing (tests/js/live_aboard_one_look.mjs) ──────────────────────────

@pytest.mark.parametrize("prefix", ["choice:", "rules:", "rooms: plain", "rooms: hygge", "rooms: neo_hud", "floors:", "readouts:", "safety:"])
def test_each_part_of_the_look(look, prefix) -> None:
    """choice: no choice or own is today's look, atlas follows the Atlas, own
    again is today's; rules: the plain Atlas's room rules are the flat
    drawing's own and a theme's its own entry; rooms: per theme, floor,
    outline, name and off fixtures; floors: each floor's number in its
    plate's colour, each plate its line; readouts: the Atlas's words and
    colours; safety: the Vacation banner and the emergency dial above the
    cover."""
    _case(look, prefix)


def test_every_look_case_passes(look) -> None:
    assert not look["failures"], json.dumps(look["failures"][:6], indent=2, ensure_ascii=False)
