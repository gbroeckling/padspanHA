# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The flat Map's own ⋯ "Show on this screen" (the Atlas tab and its walls).

tests/js/atlas_flat_show.mjs runs lights_map.js's display card with
live_aboard_show.js under the DOM shim: ⋯ sits in the rail after ‹ (nothing
in the rail moves), with Live Aboard on or off, and not on Mapping's flat map;
its list is Live Aboard's own list with only the lines the flat Map honours;
"Tap a light to switch it" unticked there stops a tap on a light switching,
"Other floors, faded" ticked there draws the other floors faded at once; a
tick is the screen's one pref, read by both looks; opening it is counted as
the flat Map's.

Held here too: the flat Map's list is the shared component (createShowMenu
with flatMenu), not a second list; it is built only for display cards; the
lines it offers are exactly the ones lights_map.js reads through flatShow.
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


@pytest.fixture(scope="module")
def flat() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "atlas_flat_show.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["button:", "lines:", "taps:", "floors:", "shared:", "reset:"])
def test_the_flat_list_harness_covers_each_part(flat, prefix) -> None:
    got = {k: v for k, v in flat["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(flat['cases'])}"
    bad = [f for f in flat["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)


def test_every_flat_list_case_passes(flat) -> None:
    assert not flat["failures"], json.dumps(flat["failures"][:4], indent=2, ensure_ascii=False)


def _code(p: Path) -> str:
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def test_one_list_the_shared_component_on_display_cards_only() -> None:
    """The flat Map's ⋯ is the shared component (createShowMenu with
    flatMenu), adopted on the rail's own button, only where the host hands in
    the Atlas tab's screen; loaded at its first press (live_aboard_card.mjs
    holds that an untouched card loads no Live Aboard module); no listener of
    its own on the window or the document."""
    raw = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert raw.count("createShowMenu(") == 1 and "M.createShowMenu({ root: mapCard, button: more," in raw
    assert "...M.flatMenu({ prefs: _laPrefs, slot: flatSlot," in raw
    rail = raw[raw.index("  if (DISPLAY) {\n    // The slim rail"):raw.index("    mapCard.appendChild(rail);")]
    assert "const flatSlot = host.screen && host.screen.slot;" in rail and "rail.appendChild(more);" in rail
    assert rail.index("rail.appendChild(more);") < rail.index("rail.appendChild(railToggle);")   # before ‹ in the rail, drawn after it (order)
    assert "order:99" in rail
    assert "window.addEventListener" not in rail and "document.addEventListener" not in rail
    assert "const SHOWLIST" not in raw and "_loadShowList = () =>" in raw          # never imported up front


def test_the_flat_lines_are_exactly_what_the_flat_map_reads() -> None:
    lm = _code(_VIEWS / "lights_map.js")
    read = set(re.findall(r'flatShow\("([a-z_]+)"\)', lm))
    show = (_VIEWS / "live_aboard_show.js").read_text(encoding="utf-8")
    flat = set(re.findall(r'\{ key: "([a-z_]+)"[^\n]*flat: true', show))
    assert read == flat == {"scenes", "light_taps", "other_floors"}, (read, flat)
    assert 'lines: () => ["light_taps", "other_floors", ...(sc() ? ["scenes"] : [])],' in lm
