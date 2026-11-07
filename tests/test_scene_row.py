# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The scene row under the Atlas and in Live Aboard (views/scene_row.js).

tests/js/scene_row.mjs runs its pure parts, the row under the DOM shim and the
row inside the real 3D view with the ⋯ list: which scenes and presets make a
tile (a scene that sets a placed light; a preset lit on one floor), on / mixed
/ off and what a tap does, the mini map (one scale, a tall house turned, its
own lights lit, the rest faint, the floor with most lights and the others
named), ✎ and + New scene for administrators and never on a wall, the row on
Live Aboard's bottom bar above its controls, the ⋯ list's Scene row line, and
Railings taking a stair's rails too.

Held here too: the report's words are the frontend's, the plain names on the
install-base page, the sidebar host handing in scenes and keeping a wall on
its page, the help in every shipped language, and the row asking nothing of
Home Assistant itself (the host makes every call).
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
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "scene_row.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["qualify:", "state:", "map:", "row:", "aboard:", "rails:", "report:"])
def test_the_scene_harness_covers_each_part(harness, prefix) -> None:
    got = {k: v for k, v in harness["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(harness['cases'])}"
    bad = [f for f in harness["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)


def test_every_scene_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:4], indent=2, ensure_ascii=False)


# ═══ the usage report ═════════════════════════════════════════════════════════

def test_the_rows_words_are_the_reports(harness) -> None:
    words = set(harness["events"])
    assert len(words) == 12 and words <= T.HOUSE3D_SHOW_EVENTS <= T.HOUSE3D_EVENTS
    h = _hass()
    for name in words:
        assert T.bump(h, name) and re.fullmatch(r"house3d_show:scene_[a-z]+:[a-z]+", name), name
    for bad in ("house3d_show:scene_run:scene.evening", "house3d_show:scene_run:Evening", "house3d_show:scene_edit:1730000000001"):
        assert not T.bump(h, bad), bad
    T.assert_shareable(T.build_payload(h))


def test_the_install_base_names_the_rows_counts() -> None:
    ib = _js(_VIEWS / "installbase.js")
    for b in ("scene_row", "scene_run", "scene_off", "scene_new", "scene_edit"):
        assert f'b === "{b}"' in ib, b
    assert 'scenes: "the scene row"' in ib


# ═══ the hosts ═══════════════════════════════════════════════════════════════

def test_the_sidebar_hands_in_scenes_and_keeps_a_wall_on_its_page() -> None:
    lp = _code(_WWW / "lights_panel.js")
    assert 'kiosk=new URLSearchParams(location.search).get("kiosk")==="1";' in lp
    assert "goTo: this._basicMode() || kiosk ? null : (t)=>{" in lp
    assert "scenes: {" in lp and "admin: !!this._hass?.user?.is_admin, kiosk," in lp
    assert 'callService: (d, svc, data)=>this._hass.callService(d, svc, data),' in lp and "setMany: (eids, on)=>this._setMany(eids, on)," in lp
    lm = _code(_VIEWS / "lights_map.js")
    # The card's signature leaves the scenes (their states) out: the row keeps up on the poll's update.
    assert '"scenes"]);' in lm and "if (sceneRow) sceneRow.update(scenesFlat(host));" in lm
    assert "scenes: scenesNow()," in lm and 'kiosk: h3.kiosk === true,' in lm
    # A new scene and an edit are an administrator's, never on a wall.
    assert "add: admin && !kiosk ? (from) => sceneNew(from) : null" in lm
    assert lm.count("sc.admin !== true || sc.kiosk === true") == 2
    # Presets as the bar has them: PadSpan Pro's.
    assert 'tierAtLeast(h.tier, "pro") && typeof h.onWholeHouseApply === "function"' in lm


def test_the_row_asks_nothing_of_home_assistant_itself() -> None:
    code = _code(_VIEWS / "scene_row.js")
    assert "import(" not in code and not re.search(r"^\s*import\s", code, re.M)
    for word in ("callWS", "callService", "hass", "localStorage", "fetch(", "settings_set"):
        assert word not in code, word


def test_settings_has_a_scenes_line_for_administrators() -> None:
    st = _code(_VIEWS / "settings.js")
    assert "lightsCard.appendChild(_atlasScenesLine(ctx, el));" in st
    assert 'open("/config/scene/edit/new", "house3d_show:scene_new:settings")' in st
    assert '"An administrator makes scenes in Home Assistant."' in st


def test_the_help_explains_the_row_in_every_language() -> None:
    help_js = _js(_WWW / "help_content.js")
    found = [json.loads(f'"{m}"') for m in
             re.findall(r't\("((?:Scenes: the row|Making scenes:|Scene row: your|Scenes — where)(?:\\.|[^"\\])*)"\)', help_js)]
    assert len(found) == 4, found
    assert any("kiosk=1" in f and "from another screen" in f for f in found)
    assert any("Railings hides stair rails" in f for f in found)
    for lang in ("de", "fr", "nl"):
        data = json.loads((_WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        for f in found:
            assert f in data and data[f] != f, (lang, f[:40])
