# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Rooms page (interface review item 12, 2026-10-30).

Each room's settings in one place, synced to Home Assistant's Areas: names
and floors read from HA, the colour, ceiling height and split level edited
inline through the commands Settings → Appearance and Mapping → Rooms already
use (no new storage), the outline drawn in Mapping → Edit (linked).

tests/js/rooms_page.mjs runs views/rooms.js under the DOM shim from a model
fixture; this file holds the wiring around it (menu, report vocabulary, the
"All rooms" links on the other screens).
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
_NODE = shutil.which("node")


def _read(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "rooms_page.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("floors:", 3), ("values:", 6), ("render:", 8), ("edit:", 5), ("same:", 2), ("link:", 7), ("empty:", 1),
])
def test_the_rooms_page(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_rooms_is_a_main_setup_screen_in_every_mode() -> None:
    src = _read("panel.js")
    assert 'rooms:        "./views/rooms.js"' in src
    assert '["rooms","Rooms",' in src
    for name in ("BASIC_TABS", "ADVANCED_DEFAULT"):
        body = re.search(rf"const {name} = new Set\(\[(.*?)\]\)", src).group(1)
        assert '"rooms"' in body, name
    assert '"rooms"' not in src.split("const DEV_ONLY_TABS")[1].split("\n")[0]
    assert '["Setup",     ["maps","rooms",' in src
    assert "rooms:" in src.split("const MENU_ICONS = {")[1].split("};")[0]


def test_the_report_counts_edits_and_opens() -> None:
    from custom_components.padspan_ha import telemetry as T
    assert "rooms" in T.VIEWS and T.event_allowed("tab:rooms"), "opens are counted as tab:rooms"
    assert "rooms_page_edit" in T.EVENTS and T.event_allowed("rooms_page_edit")
    assert _read("views/rooms.js").count('ctx.actions.telemetryEvent("rooms_page_edit")') == 1
    ib = _read("views/installbase.js")
    assert "rooms_page_edit:" in ib and 'rooms: "Rooms"' in ib


def test_no_new_storage_and_never_calibration() -> None:
    src = _read("views/rooms.js")
    sent = set(re.findall(r'"(padspan_ha/[a-z0-9_]+)"', src))
    assert sent == {"padspan_ha/room_height_set"}, sent
    assert "modelUpdate(" in src
    assert "calibration" not in src.lower().replace("never calibration data", "")


def test_the_other_screens_link_to_all_rooms() -> None:
    link = 'ctx.state.view = "rooms"; ctx.actions.renderNav(); ctx.actions.renderRooms();'
    assert _read("views/settings.js").count(link) == 1, "Settings → Appearance's Rooms card"
    assert _read("views/maps.js").count(link) == 2, "Mapping → Edit's Rooms tool and Mapping → Rooms"
