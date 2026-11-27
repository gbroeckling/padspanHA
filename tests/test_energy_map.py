# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Energy on the Atlas (views/energy_map.js), RUN (tests/js/energy_map.mjs); the panel itself in
tests/test_lights_panel_lifecycle.py (test_energy_through_the_panel), the backend in tests/test_energy.py.

The owner, 2026-11-26: a small "⚡ 120 W" chip by a metered room's name, with its readouts and never on them; a placed
device's watts; nothing for rooms without metering, and nothing under a low threshold; the room's card gains an Energy
part; the ⋯ line per screen on the display layout and on walls, Settings → Atlas → Energy on the classic layout.
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
_SCRIPT = Path(__file__).parent / "js" / "energy_map.mjs"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run():
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["format", "chips", "map", "review", "sheet", "host-only", "german"])
def test_energy_on_the_atlas(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_line_is_offered_only_where_the_house_has_energy_on():
    """The ⋯ list's Energy line: per screen, off unless ticked, and listed only where the host offers it (roomLines:
    the house has Energy on and the add-on), in the flat Map's list and the 3D look's alike."""
    show = _src("views/live_aboard_show.js")
    line = re.search(r'\{ key: "energy", group: "house",[^\n]*\}', show).group(0)
    assert "flat: true, dflt: false" in line
    la = _src("views/live_aboard.js")
    assert 'r.key !== "room_shades" && r.key !== "room_climate" && r.key !== "energy")' in la
    lp = _src("lights_panel.js")
    assert '...(this._energyHouse() ? ["energy"] : [])],' in lp
    assert "energy: this._energyHouse() ? this._energy() : null," in lp and "energyOn: this.state._energyAtlas === true," in lp


def test_the_main_panel_lists_energy_only_while_it_is_on_and_allowed():
    panel = _src("panel.js")
    assert '["energy","Energy","mdi:flash-outline"],' in panel and 'energy:       "./views/energy.js",' in panel
    assert ('if (this.state.settings?.energy_enabled !== true || !this._addon("energy")) out.delete("energy");') in panel
    assert 'if (view === "energy" && (settings.energy_enabled !== true || !this._addon("energy"))) return false;' in panel
    # Sample mode answers its reads from the sample house, never the real one.
    assert "energy_get energy_spikes" in panel


def test_settings_offers_energy_only_where_the_add_on_is_allowed():
    st = _src("views/settings.js")
    assert 'if (addonAllowed(settings, "energy")) wrap.appendChild(_atlasEnergySection(ctx, el, settings));' in st
    body = st[st.index("function _atlasEnergySection(ctx, el, settings){"):]
    assert 'row("energy_enabled", t("Energy"),' in body and "if (settings.energy_enabled !== true) return card;" in body
    assert body.index("if (settings.energy_enabled !== true) return card;") < body.index('row("atlas_energy_enabled"')
    assert body.index("if (admin) {") < body.index('row("energy_spikes_enabled"')


def test_the_view_counts_its_use_once_and_the_spikes_are_an_administrator_s():
    v = _src("views/energy.js")
    assert 'send("energy:view");' in v and 'addonUsedSeen(send, "energy");' in v
    assert 'if (admin && ctx.state.settings && ctx.state.settings.energy_spikes_enabled === true) content.appendChild(spikesCard(ctx, el, d));' in v
    assert "if (admin) content.appendChild(alwaysOnCard(ctx, el, d));" in v
    assert 'href: d.config_url || "/config/energy"' in v


def test_the_view_says_what_energy_needs_where_it_is_not_allowed_and_the_line_s_comment_is_its_own():
    """Not allowed, Settings has no Energy card to point to: the view says it needs PadSpan Pro or the add-on. And the ⋯
    list's Energy entry sits under its own comment, not between Audio's comment and Audio's entry."""
    v = _src("views/energy.js")
    assert 'd && d.allowed === false' in v and 't("Energy needs PadSpan Pro or the Energy add-on.")' in v
    show = _src("views/live_aboard_show.js").splitlines()
    i = next(n for n, ln in enumerate(show) if ln.startswith('  { key: "energy",'))
    j = next(n for n, ln in enumerate(show) if ln.startswith('  { key: "room_controls",'))
    assert i < j and show[i - 3].startswith("  // Energy (energy_map.js;") and show[j - 5].startswith("  // Audio (room_controls.js;")
    assert all(ln.lstrip().startswith("//") for ln in show[i + 1:j])


def test_a_chip_is_a_placed_label_so_the_next_room_s_chip_keeps_clear():
    iso = _src("views/iso_lights.js")
    at = iso.index("energyMark(ex, ey, efs, color, label)")
    assert "placedLabels.push({x:ex, y:ey, w:ehw*2, h:ehh*2});" in iso[at:at + 300]


def test_the_view_asks_again_only_after_its_refresh_time_and_reads_as_the_panel_does():
    """A failed energy_get is tried again after REFRESH_MS, not on every redraw (es.ts stamped before the call, as
    energy_map.js refresh() stamps `at`); card headings in the panel's green; the always-on rows at least 36 px; on a
    phone a row's figures go under its name instead of breaking it; dates in the panel's language."""
    v = _src("views/energy.js")
    body = v[v.index("async function load(ctx) {"):v.index("const card =")]
    assert body.index("es.ts = Date.now();") < body.index('await ctx.actions.wsCall("padspan_ha/energy_get")')
    assert body.count("es.ts = Date.now();") == 1
    assert 'const HEAD = "#52b788";' in v and "color:${HEAD};margin-bottom:8px" in v and "color:${AMBER};margin-bottom:8px" not in v
    assert "min-height:36px" in v and "flex-wrap:wrap" in v and "toLocaleString(locale()," in v
