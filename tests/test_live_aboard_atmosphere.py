# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P8, atmosphere: rain and snow, and the Atlas's Showcase look.

Two settings, each switching off on its own: atlas_3d_weather (on — rain and
snow in Live Aboard; it follows the Outdoor weather settings, which must be on
too) and atlas_3d_showcase (off — the Atlas's Showcase theme as Live Aboard's
lighting). tests/js/live_aboard_atmosphere_box.mjs renders their two rows in
Settings → UI Structure → Atlas → 3D house.
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

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _harness(name: str, arg: Path) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / name), str(arg)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _case(h: dict, prefix: str) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def box() -> dict:
    return _harness("live_aboard_atmosphere_box.mjs", _VIEWS)


# ── the two settings ─────────────────────────────────────────────────────────

def test_the_two_settings_and_their_defaults() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_weather"] is True, "rain and snow: on (it follows Outdoor weather)"
    assert DEFAULT_SETTINGS["atlas_3d_showcase"] is False, "the Showcase look: off"
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"atlas_3d_weather", "atlas_3d_showcase"} <= keys
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    loop = src[src.index('for key in ("ha_entity_tracker_enabled"'):]
    loop = loop[:loop.index("):")]
    assert '"atlas_3d_weather"' in loop and '"atlas_3d_showcase"' in loop, "both are stored as bools"


def test_the_settings_round_trip() -> None:
    """Saved by any user (nothing leaves the house), stored as bools, echoed
    in the reply the box reads and read back by settings_get, which both
    Atlas hosts load."""
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    from tests.test_telemetry import _hass as _house_hass
    h, conn = _house_hass(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_weather": 0, "atlas_3d_showcase": 1}))
    assert not conn.send_error.called
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert data["atlas_3d_weather"] is False and data["atlas_3d_showcase"] is True
    reply = conn.send_result.call_args[0][1]["settings"]
    assert reply["atlas_3d_weather"] is False and reply["atlas_3d_showcase"] is True
    get = MagicMock()
    _run(WS.ws_settings_get(h, get, {"id": 2}))
    back = get.send_result.call_args[0][1]["settings"]
    assert back["atlas_3d_weather"] is False and back["atlas_3d_showcase"] is True
    _run(WS.ws_settings_set(h, conn, {"id": 3, "atlas_3d_weather": True}))
    assert data["atlas_3d_weather"] is True and data["atlas_3d_showcase"] is True, "each switches on its own"


def test_the_box_offers_each_row_saved_on_its_own(box) -> None:
    """Rain and snow (on unless switched off) says it follows Outdoor
    weather; the Showcase look is off unless switched on. Each saves alone,
    straight to the wire, shown only once the 3D house is on; a failed save
    puts the tick back."""
    _case(box, "box:")
    assert not box["failures"], json.dumps(box["failures"][:4], indent=2, ensure_ascii=False)
    src = (_VIEWS / "settings.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    sec = src[src.index("function _atlas3dSection("):src.index("// ── UI Structure tab")]
    assert 'tick("atlas_3d_weather", "Rain and snow", settings.atlas_3d_weather !== false,' in sec
    assert 'tick("atlas_3d_showcase", "Use the Atlas\'s Showcase look", settings.atlas_3d_showcase === true,' in sec
    assert 'ctx.actions.wsCall("padspan_ha/settings_set"' in sec and "settingsSet(" not in sec
