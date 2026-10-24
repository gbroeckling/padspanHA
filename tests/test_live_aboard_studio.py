# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Studio look: atlas_3d_look "studio".

A third look beside "atlas" (the default) and "own": Live Aboard's own
colours under a sky from the sun, a stage under the house and soft light
(views/live_aboard_studio.js). Off unless picked; with "atlas" or "own" the
view draws exactly as before (every Studio call in live_aboard.js waits on
the Studio object, made only while Studio is picked).
tests/js/live_aboard_studio.mjs draws it under the DOM shim.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _code(p: Path) -> str:
    """The file without its comment lines."""
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.fixture(scope="module")
def studio() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_studio.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


# ── the setting ──────────────────────────────────────────────────────────────

def test_the_default_look_is_still_the_atlas_s() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_look"] == "atlas"
    assert WS._ATLAS_3D_LOOK == ("atlas", "own", "studio")


@pytest.mark.parametrize("raw,want", [("studio", "studio"), ("STUDIO ", "studio"), ("studios", "atlas"), ("", "atlas")])
def test_studio_is_kept_and_nothing_else_new(raw, want) -> None:
    assert WS._atlas_3d_look(raw) == want


def test_studio_round_trips_for_any_user() -> None:
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    from tests.test_telemetry import _hass as _house_hass
    h, conn = _house_hass(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_look": "Studio"}))
    assert not conn.send_error.called
    assert h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_look"] == "studio"
    assert conn.send_result.call_args[0][1]["settings"]["atlas_3d_look"] == "studio"


# ── the report ───────────────────────────────────────────────────────────────

def test_the_report_counts_studio_only_where_it_applies() -> None:
    from tests.test_telemetry import _hass as _house_hass
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

    def ov(**kw):
        h = _house_hass()
        h.data[DOMAIN][DATA_SETTINGS].data.update(kw)
        return T.build_payload(h)["features"]

    assert "look_studio" in T.OVERVIEW_SET["ov_3d"]
    assert "ov_3d" not in ov(atlas_3d_look="studio"), "3D off: nothing about its look"
    assert ov(atlas_3d_enabled=True, atlas_3d_look="studio")["ov_3d"] == ["look_studio"]
    assert "ov_3d" not in ov(atlas_3d_enabled=True, atlas_3d_look="atlas"), "the default look adds nothing"
    assert ov(atlas_3d_enabled=True, atlas_3d_look="own")["ov_3d"] == ["look_own"]
    src = (_ROOT / "custom_components" / "padspan_ha" / "telemetry.py").read_text(encoding="utf-8")
    assert '"no_weather", "look_own", "look_studio"),' in src


def test_the_new_file_s_errors_are_kept() -> None:
    assert "live_aboard_studio" in T.UI_ERROR_HELPERS


# ── the choice ───────────────────────────────────────────────────────────────

def test_studio_is_offered_where_the_look_is_chosen() -> None:
    st = _js(_VIEWS / "settings.js")
    assert '["studio", "Studio — soft light and sky"]' in st
    assert ('const lookCur = settings.atlas_3d_look === "own" || settings.atlas_3d_look === "studio" '
            '? settings.atlas_3d_look : "atlas";') in st
    wz = _js(_VIEWS / "aboard_wizard.js")
    assert '["studio", "Studio: soft light and sky"]' in wz
    lm = _js(_VIEWS / "lights_map.js")
    assert ('look3d: h3.settings.atlas_3d_look === "own" || h3.settings.atlas_3d_look === "studio" '
            '? h3.settings.atlas_3d_look : "atlas",') in lm


def test_the_guide_names_studio() -> None:
    path = _ROOT / "docs" / "LIVE_ABOARD_GUIDE.md"
    if not path.exists():
        pytest.skip("the Bright derivation carries no docs/")
    assert "**Studio**" in path.read_text(encoding="utf-8")


# ── the other looks are untouched ────────────────────────────────────────────

def test_every_studio_call_waits_on_studio() -> None:
    """The Atlas's look and Live Aboard's own never reach Studio's code: each
    call is behind `if (studio)` / `studio ?`, inside the two functions that
    exist for it (syncStudio, arrive), or the import that may fail."""
    la = _code(_VIEWS / "live_aboard.js")
    body = la
    for fn in ("function syncStudio(", "function arrive("):
        i = body.index(fn)
        j = body.index("\n  }\n", i)
        body = body[:i] + body[j:]
    uses = [ln.strip() for ln in body.splitlines() if re.search(r"\bstudio\.|STUDIO\.", ln)]
    assert uses, "no Studio calls found"
    for ln in uses:
        assert ("if (studio)" in ln or "studio ?" in ln or "studio: studio ? studio.state()" in ln
                or "if (wantStudio !== !!studio) syncStudio(wantStudio);" in ln), ln
    assert "const wantStudio = !!STUDIO && p.look3d === \"studio\";" in la
    assert la.count("STUDIO.createStudio(") == 1 and la.count("let studio = null;") == 1
    assert ".catch(err => { console.warn(\"PadSpan: live_aboard_studio failed to load\", err); return null; });" in la
    # The existing paths, as they were.
    assert 'LOOKS && p.look3d === "atlas" ? LOOKS.atlasLook(p.atlasLook) : null' in la
    assert 'colour: studio ? studio.rain() : plainSky() ? "#ffffff" : (theme3d && theme3d.weather) || WEATHER.colourOf(p.showcase && p.showcase.theme),' in la
    assert "(now - f.t0) / (f.ms || FLY_MS)" in la, "a flight without its own length is as long as before"


def test_studio_brings_no_rules_into_the_shared_css() -> None:
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    assert "studio" not in css.lower()
    src = _js(_VIEWS / "live_aboard_studio.js")
    assert "import " not in _code(_VIEWS / "live_aboard_studio.js"), "three.js is handed in; the module imports nothing"
    assert "live_aboard" not in _code(_VIEWS / "live_aboard_studio.js")
    assert "pointer-events:none" in src, "the vignette never takes a press"


def test_studio_never_recolours_a_room() -> None:
    """Studio only lights, frames and backs the house: it never writes a
    room's, a light's or a name's colour (no tile, halo or label code)."""
    code = _code(_VIEWS / "live_aboard_studio.js")
    for word in ("r.color", "colorOf(", "roomColor", "setColorAt", "instanceColor", "labelSprite"):
        assert word not in code, word


# ── the drawing (tests/js/live_aboard_studio.mjs) ────────────────────────────

@pytest.mark.parametrize("prefix", ["colours:", "parts:", "sky:", "off:", "arrival:", "pure:"])
def test_each_part_of_studio(studio, prefix) -> None:
    """colours: the same tiles, glows and names as Live Aboard's own; parts:
    Low has no sky dome, front or rim light or shadow softening, High has them; sky: day and
    night from the sun, rain slate by day; off: back to own is today's look
    exactly; arrival: once, the house still untouched; pure: its numbers."""
    got = {k: v for k, v in studio["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(studio['cases'])}"
    bad = [f for f in studio["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)
