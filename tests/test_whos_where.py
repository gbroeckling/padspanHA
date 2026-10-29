# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Who's where now (views/whos_where.js): the first thing a house with no
rooms drawn sees on the Overview.

tests/js/whos_where.mjs runs the module for real (what the scanners give,
who is in which room, phones to track, the card and its Track button).
Held here: the wiring in overview.js and panel.js — the card only before any
room is drawn, its updater called on the poll, the demo house's way back."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "whos_where.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 30


def test_the_overview_shows_it_only_before_any_room_is_drawn() -> None:
    ov = _src(_WWW / "views" / "overview.js")
    assert "const _noRoomsDrawn = !Object.keys((ctx.state.model || {}).room_geometry_m || {}).length;" in ov
    # The fabric is the truth (test_photo_divorce): a room drawn only on a
    # plan's photo (room_bounds) is deliberately not read here.
    assert 'const whosWhere = (dataMode === "live" && liveSnap && _noRoomsDrawn) ? whosWhereCard(ctx) : null;' in ov
    # Cleared on every render, so a house that has drawn its rooms polls nothing for it.
    assert ov.count("ctx.state._whosWhereUpdate = null;") == 1
    # In both layouts, right under the heading.
    assert ov.count("      sampleBanner,\n      whosWhere,\n") == 1
    assert ov.count("    sampleBanner,\n    whosWhere,\n") == 1


def test_the_poll_keeps_it_current() -> None:
    panel = _src(_WWW / "panel.js")
    # Wherever the poll moves the Overview's dots, it updates the card too.
    assert panel.count("this.state._isoUpdateObjects();") == panel.count("this.state._whosWhereUpdate();") == 3


def test_the_demo_house_has_a_way_back_and_a_way_in() -> None:
    ov = _src(_WWW / "views" / "overview.js")
    assert '"Back to my house"' in ov and 'ctx.actions.setDataMode("live")' in ov
    ww = _src(_WWW / "views" / "whos_where.js")
    assert '"Preview a finished house"' in ww and 'ctx.actions.setDataMode("sample")' in ww
    panel = _src(_WWW / "panel.js")
    assert "setDataMode: (mode) => this._setDataMode(mode)," in panel


def test_a_new_install_on_the_demo_house_notices_the_switch() -> None:
    panel = _src(_WWW / "panel.js")
    assert "const _every = (Date.now() - this._liveFirstSince) < 300000 ? 10000 : 120000;" in panel
    assert 'const _mapsBusy = this.state.view === "maps" && (!!this.state._mapsWizard || ["upload", "stack", "edit"].includes(this.state.mapsTab));' in panel
    assert 'if(this.state.settings?.onboarding?.live_first === "pending" && !_mapsBusy){' in panel
    assert "async _liveFirstCheck(){" in panel
    # The toast only when the server switched it.
    assert 'if(this.state.settings?.onboarding?.live_first === "switched")' in panel


def test_the_phone_card_starts_open_while_who_is_where_shows() -> None:
    ov = _src(_WWW / "views" / "overview.js")
    assert ov.count("if (whosWhere) _phoneHdr.click();") == 1      # Basic
    assert ov.count("if (whosWhere) _aPhoneHdr.click();") == 1     # Advanced
