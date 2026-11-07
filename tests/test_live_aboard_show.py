# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard's ⋯ list, "Show on this screen" (views/live_aboard_show.js).

tests/js/live_aboard_show.mjs runs the real 3D view under the DOM shim on a
small house with one of everything the list names: ⋯ beside the compass opens
the list grouped, the alarms ticked and greyed, and it closes on ✕, Escape, a
tap elsewhere and the idle flight home; a tick is this screen's alone and is
forgotten once it is back at the house's own; each line hides what it names
and nothing else, and an alarm never; a line the house hasn't set up says so,
with "Set it up" through the host; people off for the house take an
administrator to their switch and tell anyone else who turns it on; Back to
house defaults forgets it all; a poll rebuilds nothing because of the list,
and at rest nothing is drawn.

Held here too: the report's words are the frontend's (and fit the report),
the plain names on the install-base page, the hosts' way to Settings and
Mapping, the help in every shipped language, and the list module asking
nothing of Home Assistant.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T
from tests.test_telemetry import _hass

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_show.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["button:", "prefs:", "hide:", "setup:", "people:", "reset:", "report:", "rest:"])
def test_the_show_harness_covers_each_part(harness, prefix) -> None:
    got = {k: v for k, v in harness["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(harness['cases'])}"
    bad = [f for f in harness["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)


def test_every_show_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:4], indent=2, ensure_ascii=False)


# ═══ the usage report ═════════════════════════════════════════════════════════

def test_the_report_words_are_the_frontends(harness) -> None:
    """The frontend counts from its list, the backend drops what is not on
    its own: the two must be the same words or counts vanish silently."""
    assert tuple(harness["lists"]["keys"]) == T.HOUSE3D_SHOW_ITEMS
    assert set(harness["lists"]["events"]) == set(T.HOUSE3D_SHOW_EVENTS)
    assert T.HOUSE3D_SHOW_EVENTS <= T.HOUSE3D_EVENTS


def test_each_show_word_counts_and_never_a_name() -> None:
    h = _hass()
    for name in T.HOUSE3D_SHOW_EVENTS:
        assert T.bump(h, name), name
        assert len(name) <= 64 and re.fullmatch(r"house3d_show:[a-z_]+(:[a-z_]+)?", name), name
    for bad in ("house3d_show:hide:light.kitchen", "house3d_show:hide:Kitchen", "house3d_show:hide:", "house3d_show:hide:alarms",
                "house3d_show:hide:scenes", "house3d_show:opened:main", "house3d_show:permission:alex"):
        assert not T.bump(h, bad), bad
    T.assert_shareable(T.build_payload(h))


def test_the_install_base_names_every_line() -> None:
    ib = _js(_VIEWS / "installbase.js")
    m = re.search(r"const W_SHOW_LINE = \{(.*?)\n\};", ib, re.S)
    assert m, "installbase.js keeps W_SHOW_LINE"
    named = set(re.findall(r"\b([a-z_]+):", m.group(1)))
    assert set(T.HOUSE3D_SHOW_ITEMS) <= named, sorted(set(T.HOUSE3D_SHOW_ITEMS) - named)
    for b in ("opened", "reset", "hide", "show", "setup_seen", "setup_go", "permission"):
        assert f'b === "{b}"' in ib, b


# ═══ the hosts, the help, the module ═════════════════════════════════════════

def test_both_hosts_hand_over_a_way_to_settings_and_mapping_but_not_in_basic() -> None:
    lp = _code(_WWW / "lights_panel.js")
    assert "goTo: this._basicMode() ? null : (t)=>{" in lp and "/padspan-ha?${q.toString()}" in lp
    mp = _code(_VIEWS / "maps.js")
    assert "const la3dGoTo = !FOCUS.expertLinks(ctx.state) ? null : (t) => {" in mp and "goTo: la3dGoTo," in mp
    assert "ctx.state._settingsPart = t.part || null;" in mp
    lm = _code(_VIEWS / "lights_map.js")
    assert 'goTo: typeof h3.goTo === "function" ? h3.goTo : null,' in lm
    pj = _code(_WWW / "panel.js")
    assert 'if (reqView === "settings" && reqPart && /^[a-z0-9_]+$/.test(reqPart)) this.state._settingsPart = reqPart;' in pj
    st = _code(_VIEWS / "settings.js")
    assert "FOCUS.pickPart(root, wantPart)" in st and "ctx.state._settingsPart = null;" in st
    # Every place a line links to is a card or tab that exists.
    show = _js(_VIEWS / "live_aboard_show.js")
    for part in set(re.findall(r'part: "([a-z_0-9]+)"', show)):
        assert f'"data-focus-part":"{part}"' in _js(_VIEWS / "settings.js"), part


def test_the_list_module_imports_nothing_and_asks_nothing_of_home_assistant() -> None:
    code = _code(_VIEWS / "live_aboard_show.js")
    assert "import(" not in code and not re.search(r"^\s*import\s", code, re.M)
    for word in ("callWS", "hass", "settings_set", "saveSetting", "localStorage", "fetch("):
        assert word not in code, word


def test_the_help_says_where_the_list_is_in_every_language() -> None:
    help_js = _js(_WWW / "help_content.js")
    m = re.search(r't\("(⋯ beside the compass[^"]*)"\)', help_js)
    assert m and "Back to house defaults" in m.group(1) and "Views ▾" in m.group(1)
    for lang in ("de", "fr", "nl"):
        data = json.loads((_WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        assert m.group(1) in data and data[m.group(1)].startswith("⋯"), lang
