# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part A: Settings → UI Structure → Atlas → 3D house.

tests/js/live_aboard_settings.mjs renders the box for real: off shows the
master switch and its one line; once on, Quality (Auto / Low / High) and
North — the GPS Bridge's own fabric_bearing_deg, with your plan's outline and
an N arrow as its preview, the compass loaded only once the switch is on.
Each control saves on its own, straight to the wire; a failed save puts it
back. The box is Pro's (PadSpan Pro and Bright Pro), in either edition, and
below Pro there is none. Held here too: the settings round-trip through the
real commands, and no new key.
"""

from __future__ import annotations

import asyncio
import json
import math
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def box() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_settings.mjs"), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
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


def test_the_box_runs(box) -> None:
    """Off: the switch and one line. Ticking it saves it alone and shows
    Quality and North; Quality saves alone; a failed save puts it back."""
    _case(box, "box:")
    assert not box["failures"], json.dumps(box["failures"][:4], indent=2, ensure_ascii=False)


def test_the_north_row_writes_only_the_gps_bridges_bearing(box) -> None:
    """fabric_bearing_deg alone, kept to 0-359 (370 saves 10, a blank is
    refused, never 0), the GPS Bridge's other settings untouched; the preview
    is the plan's outline, y down as drawn, its arrow from fabric_compass.js
    (loaded only once the switch is on)."""
    _case(box, "north:")


def test_the_box_is_pro_only_in_either_edition(box) -> None:
    _case(box, "gate:")
    src = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    assert 'if (tierAtLeast(currentTier(settings), "pro")) lightsCard.appendChild(_atlas3dSection(ctx, el, settings));' in src


def test_the_two_settings_and_their_defaults() -> None:
    assert DEFAULT_SETTINGS["atlas_3d_enabled"] is False, "normally off"
    assert DEFAULT_SETTINGS["atlas_3d_quality"] == "auto"
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"atlas_3d_enabled", "atlas_3d_quality", "fabric_bearing_deg"} <= keys


def test_the_settings_round_trip() -> None:
    """Saved by any user (nothing leaves the house), echoed in the reply the
    box reads, and read back by settings_get, which both Atlas hosts load.
    North is the GPS Bridge's key, normalised there as here."""
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    from tests.test_telemetry import _hass as _house_hass
    h, conn = _house_hass(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_enabled": True, "atlas_3d_quality": "LOW", "fabric_bearing_deg": 370}))
    assert not conn.send_error.called
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert data["atlas_3d_enabled"] is True and data["atlas_3d_quality"] == "low" and data["fabric_bearing_deg"] == 10.0
    reply = conn.send_result.call_args[0][1]["settings"]
    assert reply["atlas_3d_enabled"] is True and reply["atlas_3d_quality"] == "low" and reply["fabric_bearing_deg"] == 10.0
    get = MagicMock()
    _run(WS.ws_settings_get(h, get, {"id": 2}))
    back = get.send_result.call_args[0][1]["settings"]
    assert back["atlas_3d_enabled"] is True and back["atlas_3d_quality"] == "low" and back["fabric_bearing_deg"] == 10.0
    _run(WS.ws_settings_set(h, conn, {"id": 3, "atlas_3d_quality": "ultra", "atlas_3d_enabled": False}))
    assert data["atlas_3d_quality"] == "auto", "anything else is Auto"
    assert data["atlas_3d_enabled"] is False and data["fabric_bearing_deg"] == 10.0


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_north_is_never_nan_or_infinite(bad) -> None:
    """The 3D compass writes fabric_bearing_deg; the GPS Bridge and the 3D sun
    read it. NaN or an infinity (NaN after % 360) is refused, and nothing else
    in the message is saved."""
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    from tests.test_telemetry import _hass as _house_hass
    h, conn = _house_hass(), MagicMock()
    data = h.data[DOMAIN][DATA_SETTINGS].data
    data["fabric_bearing_deg"] = 10.0
    _run(WS.ws_settings_set(h, conn, {"id": 1, "fabric_bearing_deg": bad, "atlas_3d_quality": "low"}))
    assert conn.send_error.call_args[0][1] == "invalid"
    assert data["fabric_bearing_deg"] == 10.0 and "atlas_3d_quality" not in data


def test_the_box_saves_each_control_on_its_own() -> None:
    src = (_VIEWS / "settings.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    sec = src[src.index("function _atlas3dSection("):src.index("// ── UI Structure tab")]
    assert '"atlas_3d_enabled"' in sec and '"atlas_3d_quality"' in sec and 'save("fabric_bearing_deg", b,' in sec
    assert 'ctx.actions.wsCall("padspan_ha/settings_set"' in sec and "settingsSet(" not in sec
    assert "Adds a Map / 3D switch to the Atlas" in sec and "Off by default." in sec
    assert "The same bearing the GPS Bridge uses." in sec and "north-up" not in sec.lower()
    assert "import(`./fabric_compass.js${new URL(import.meta.url).search}`)" in sec
    for v in ('["auto", ', '["low", ', '["high", '):
        assert v in src[src.index("const _ATLAS_3D_QUALITY"):src.index("function _atlas3dSection(")], v
    # P2's Remove all furniture (admins; the server backs up first), and
    # P6's Show people; the later phases' rows are not here yet.
    assert '"Remove all furniture…"' in sec and 'wsCall("padspan_ha/house3d_clear", { only: "pieces" })' in sec
    assert 'tick("atlas_3d_people", "Show people", settings.atlas_3d_people === true,' in sec
    for later in ("atlas_3d_ai_task_entity", "atlas_3d_library"):
        assert later not in sec, later
