# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Receivers page (interface review item 11, 2026-10-30).

Every Bluetooth receiver in one table, with what used to be spread over six
screens. It has no storage of its own: height goes through the command
Calibration → Tune and Mapping → Edit → Radios send, the signal adjustment
through Settings' action, the status through the top bar dot's rules, and a
position only through Mapping's own placement (linked, never re-implemented).
tests/js/receivers_page.mjs drives the real view.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_page_drives_for_real() -> None:
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "receivers_page.mjs"), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])
    assert len(got) >= 55, sorted(got)
    bad = {k: v for k, v in got.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)[:3000]


_Z_CALL = re.compile(
    r'callWS\(\{\s*type:\s*"padspan_ha/fabric_scanner_z_set",\s*source:\s*[\w.]+,\s*z_m:\s*v,\s*\}\)')


def test_height_is_the_same_command_in_all_three_places() -> None:
    for name in ("calibration.js", "maps.js", "receivers.js"):
        src = _read(_VIEWS / name)
        assert len(_Z_CALL.findall(src)) == 1, name
        assert "v < 0 || v > 100" in src and "Math.round(Math.max(0, Math.min(100, v)) * 100) / 100" in src, name
    rx = _read(_VIEWS / "receivers.js")
    assert "z_m != null ? Number(fab.z_m) : 2.4" in rx          # Tune's 2.4 m default
    assert "TSP.tuneTryAcquire(ts)" in rx and "TSP.tuneRelease(ts)" in rx


def test_signal_adjustment_is_settings_action_and_range() -> None:
    rx, st = _read(_VIEWS / "receivers.js"), _read(_VIEWS / "settings.js")
    assert "ctx.actions.scannerOffsetSet(row.source, v)" in rx
    assert "await ctx.actions.scannerOffsetSet(src, v);" in st
    assert 'min:"-20",max:"20",step:"0.5"' in st
    assert "OFFSET_MIN = -20, OFFSET_MAX = 20" in rx and 'step: "0.5"' in rx
    assert "settings.scanner_offsets" in rx and "settings.scanner_offsets" in st


def test_no_new_storage_and_no_position_writes() -> None:
    """Only the two existing writers; calibration points never read or written."""
    rx = _read(_VIEWS / "receivers.js")
    assert re.findall(r'"padspan_ha/[a-z_]+"', rx) == ['"padspan_ha/fabric_scanner_z_set"']
    for word in ("calibration", "maps_update", "mapsUpdate", "settingsSet", "fabric_scanner_set", "x_m:"):
        assert word not in rx.split("*/", 1)[1], word


def test_status_comes_from_the_status_dot() -> None:
    rx, sd = _read(_VIEWS / "receivers.js"), _read(_VIEWS / "status_dot.js")
    assert "SD.receiverStatus(r, devices, { heard: heardAny, masked })" in rx
    assert "radios.filter(r => isSilent(r, heard))" in sd and "radios.filter(isHearingLess)" in sd
    assert "snap.ble.radios.filter(r => inUse(r, masked))" in sd
    assert "last_heard_s > SILENT_S" not in rx


def test_registered_everywhere_a_view_is() -> None:
    from custom_components.padspan_ha import telemetry as T
    panel = _read(_WWW / "panel.js")
    assert 'receivers:    "./views/receivers.js"' in panel
    assert '["receivers","Receivers","mdi:access-point"]' in panel
    for const in ("BASIC_TABS", "ADVANCED_DEFAULT"):
        line = panel.split(f"const {const} = new Set(")[1].split("\n")[0]
        assert '"receivers"' in line, const
    setup = panel.split('["Setup",')[1].split("\n")[0]
    assert '"receivers"' in setup
    assert "  receivers:   '<" in panel                                  # its menu icon
    assert "receivers" in T.VIEWS and T.event_allowed("tab:receivers")
    assert "receivers_page_edit" in T.EVENTS and T.event_allowed("receivers_page_edit")
    ib = _read(_VIEWS / "installbase.js")
    assert "receivers_page_edit:" in ib and 'receivers: "Receivers"' in ib
    assert 'receivers:   "presence"' in _read(_VIEWS / "editions.js")
    assert "\n  receivers: {\n" in _read(_WWW / "help_content.js")


def test_other_screens_link_to_the_page() -> None:
    for name, where in (("maps.js", "maps"), ("settings.js", "settings"), ("health.js", "health"),
                        ("bluetooth.js", "bluetooth")):
        src = _read(_VIEWS / name)
        assert f'"data-all-receivers":"{where}"' in src.replace(" ", "") or f'"data-all-receivers": "{where}"' in src, name
        assert "ctx.actions.openReceivers()" in src, name
    panel = _read(_WWW / "panel.js")
    # One open helper for the in-screen links, counted as a tab open.
    assert 'openReceivers: ()=>this._openCountedView("receivers"),' in panel
    helper = panel.split("  _openCountedView(id){")[1].split("\n  }\n")[0]
    assert 'this._telemetryEvent("tab:" + id);' in helper and "_loadView(id)" in helper
    # A build without the page (Bright) leaves the link out.
    assert "canOpen: (id)=>this._getVisibleTabs().has(id)," in panel
    for name in ("maps.js", "settings.js", "health.js", "bluetooth.js"):
        assert 'ctx.actions.openReceivers && (!ctx.actions.canOpen || ctx.actions.canOpen("receivers")) ? ' in _read(_VIEWS / name), name


def test_maps_one_shot_selects_and_is_used_up() -> None:
    maps = _read(_VIEWS / "maps.js")
    assert "ctx.state.maps._openRadios = null;" in maps
    assert 'ctx.state.maps._mode = "receivers";' in maps
