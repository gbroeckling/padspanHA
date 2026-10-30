# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Basic's focused views (views/focus.js, 2026-10-30).

Garry: "Make sure basic still makes sense, no access to things that are so
foreign to the user that it doesn't tie together." Basic is for seeing who's
where and setting the house up. A link in Basic comes only from something
Basic asks for, and opens just that part of the expert screen, under one
"← Back" to where it was; the mode never changes:

  Appearance's Usage report / Guest tags,   one Settings card each
  Guests' Open Settings, the tester sign-up,
  the Live Aboard wizard's setting links
  Rooms' Edit outline                       the editor with the Rooms tool only
  Receivers' Place / Move                   the Radios tool only, its height row
  the floor-heights links                   3D Stack's Floor Heights card alone
  links to expert screens (QA, receiver     not shown in Basic
  tuning, the light builder)

Advanced and Development open the whole tab, as before.
tests/js/basic_focus.mjs renders each of them; the audit behind the list is
in PadspanResearch/basic-links-audit-2026-10-30.md.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _read(rel: str) -> str:
    return (WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def got() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "basic_focus.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("prefix", ["settings:", "edit:", "heights:", "expert:", "advanced:", "back:"])
def test_each_part_is_covered_and_passes(got, prefix) -> None:
    mine = {k: v for k, v in got.items() if k.startswith(prefix)}
    assert mine, (prefix, sorted(got))
    bad = {k: v for k, v in mine.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_every_basic_link_is_checked(got) -> None:
    for name in (
        "settings: usage_report opens only that card (Settings → presence), back to Settings",
        "settings: guest_tags opens only that card (Settings → presence), back to Settings",
        "settings: Guests' Open Settings opens only the Guest tags card, back to Guests",
        "settings: the tester card's Sign me up opens only the usage report's card, back to Overview",
        "settings: the wizard's Quality link opens only its card (la3d), still Basic",
        "settings: the wizard's Show the Atlas as Overview link opens only its card (atlas_overview), still Basic",
        "edit: Edit outline in Basic is the editor with the Rooms tool only",
        "edit: Place / Move in Basic is the editor with the Radios tool only, on that receiver",
        "heights: from overview, only 3D Stack's Floor Heights card",
        "heights: from calibration, only 3D Stack's Floor Heights card",
        "heights: Setup → Floors opens only the Floor Heights card, Setup's bar the one way back",
    ):
        assert name in got, name


def test_the_sources_use_the_one_mechanism() -> None:
    """Every Basic link goes through views/focus.js; the old whole-tab deep
    links (state._settingsDeep / state._mapsDeep) are gone."""
    for f in [WWW / "panel.js", WWW / "lights_panel.js", *(WWW / "views").glob("*.js")]:
        src = f.read_text(encoding="utf-8")
        assert "_settingsDeep" not in src and "_mapsDeep" not in src, f.name
    uses = {
        "views/rooms.js": 'FOCUS.openFocus(ctx, FOCUS.part("roomOutline"',
        "views/receivers.js": 'FOCUS.openFocus(ctx, FOCUS.part("receiverPlace"',
        "views/guests.js": 'FOCUS.openFocus(ctx, FOCUS.part("guestTags"))',
        "views/setup.js": 'FOCUS.openFocus(ctx, FOCUS.part("floorHeights"',
        "views/calibration_results.js": 'FOCUS.openFocus(ctx, FOCUS.part("floorHeights"))',
        "views/aboard_wizard.js": "FOCUS.openFocus(ctx, FOCUS.part(where.part ||",
        "views/settings.js": "FOCUS.openFocus(ctx, PART.usageReport)",
        "panel.js": 'F.openFocus(this._ctx(), F.part("floorHeights"))',
    }
    for rel, needle in uses.items():
        assert needle in _read(rel), rel


def test_expert_links_are_hidden_in_basic() -> None:
    cal = _read("views/calibration.js")
    fin = cal[cal.index('const qaBtn = el("button", { class: "btn primary" }, "See detailed quality report →");'):]
    fin = fin[:fin.index('const anotherBtn')]
    assert "if (FOCUS.expertLinks(ctx.state)) row.appendChild(qaBtn);" in fin
    # Calibration's tabs themselves stay the same in every mode (test_basic_calibration).
    assert "complexity" not in cal
    assert "FOCUS.expertLinks(ctx.state) ? go : null," in _read("views/manage.js")
    assert "FOCUS.expertLinks(ctx.state) ? go : null," in _read("views/settings.js")
    lp = _read("lights_panel.js")
    assert "onEdit: this._isAdmin() && !this._basicMode() ? (e)=>this._gotoBuilder(e) : null," in lp
    # The Atlas header's ✎ Edit map goes to the builder too: not in Basic either.
    assert '...(this._isAdmin() && !this._basicMode() ? [el("button",{class:"lv-act",title:"Open Mapping' in lp
    assert 'localStorage.getItem("padspan_complexity") === "basic"' in lp
