# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P2: Mapping → Furnish (views/live_aboard_furnish.js).

tests/js/live_aboard_furnish.mjs runs the Furnish tool for real inside the
real 3D view and editor under the DOM shim, as Mapping → Furnish mounts it:
it opens by itself at the furniture tool, Build, a drag that snaps to a wall
and undoes in one step, Turn, Floor ▲ / ▼ with the floor chips following,
Height in room (Garry's drop/raise), Duplicate and Delete, "This is a
device…", a fit warning, Save, and card rebuilds mid-edit. What Save sent goes
through the server's own apply_edit here. The rest is held here, in the code:
the Furnish tab only while Live Aboard shows, its modules loaded only by the
3D view, its flows each behind import().catch, one renderer for the plan and
the 3D view, and nothing asked in a browser dialog.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_store as HS
from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def furnish() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_furnish.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.mark.parametrize("prefix", ["open:", "add:", "drag:", "turn:", "floor:", "height:", "copy:", "device:", "fit:", "save:",
                                    "survive:"])
def test_the_furnish_harness_covers_each_part(furnish, prefix) -> None:
    got = [k for k in furnish["cases"] if k.startswith(prefix)]
    assert got, (prefix, sorted(furnish["cases"]))
    bad = [f for f in furnish["failures"] if f["name"].startswith(prefix)]
    assert all(furnish["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_furnish_case_passes(furnish) -> None:
    assert furnish["cases"] and all(furnish["cases"].values()), json.dumps(furnish["failures"][:6], indent=2, ensure_ascii=False)


def test_what_furnish_saved_the_server_keeps(furnish) -> None:
    """Every Save the tool sent goes through the server's own apply_edit:
    none is refused, and each piece comes back as it was sent (bar the
    server's own stamp)."""
    sent = furnish["payloads"]
    assert sent and all(set(c) <= set(HS.EDIT_SECTIONS) for c in sent)
    file = HS.empty()
    for changes in sent:
        file = HS.apply_edit(file, changes)
        for pid, p in changes.get("pieces", {}).items():
            if p is None:
                assert pid not in file["pieces"]
                continue
            got = {k: v for k, v in file["pieces"][pid].items() if k != "updated_at"}
            assert got == {k: v for k, v in p.items() if k != "updated_at"}, pid


def test_the_furnish_tab_shows_only_while_live_aboard_does() -> None:
    """After Atlas, only with the switch on at Pro or Bright Pro, never in
    Basic (the way Basic leaves tabs out); otherwise the tab is not there and
    a remembered Furnish falls back to Atlas. The tab list the telemetry
    vocabulary reads stays as it was."""
    maps = _js(_VIEWS / "maps.js")
    assert ('const furnishTab = !isBasic && ctx.state.settings?.atlas_3d_enabled === true '
            '&& _tierAtLeast(ctx.state.settings?.tier, "pro");') in maps
    assert 'if (furnishTab) tabDefs.splice(tabDefs.findIndex(([id]) => id === "lights") + 1, 0, ["furnish", "Furnish"]);' in maps
    assert 'else if (tab === "furnish") ctx.state.mapsTab = "lights";' in maps
    assert 'activeTab==="furnish" ? _lightsTab(ctx, maps, active) :' in maps
    assert 'const furnish = ctx.state.mapsTab === "furnish";' in maps
    line = next(ln for ln in maps.splitlines() if '["library","Library"],["upload","Upload"],["edit"' in ln)
    assert "furnish" not in line
    assert "live_aboard" not in _code(_VIEWS / "maps.js"), "Mapping never names the 3D modules itself"


def test_the_furnish_modules_load_only_with_the_3d_view() -> None:
    """The view loads the rules, the tool and the builders (a missing
    builders module: every piece a box); nothing else names them. The tool
    imports nothing of its own but its optional flows, each behind
    import().catch, so a missing one only hides its button."""
    la = _js(_VIEWS / "live_aboard.js")
    for want in ("await import(`./live_aboard_pieces.js${new URL(import.meta.url).search}`)",
                 "await import(`./live_aboard_furnish.js${new URL(import.meta.url).search}`)",
                 "await import(`./live_aboard_furniture.js${new URL(import.meta.url).search}`).catch(() => null)"):
        assert want in la, want
    for name in ("live_aboard_pieces.js", "live_aboard_furnish.js", "live_aboard_furniture.js"):
        importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and f"./{name}" in _code(p))
        assert importers == ["live_aboard.js"], (name, importers)
    fur = _code(_VIEWS / "live_aboard_furnish.js")
    assert fur.count("import(") == 1 and "await import(`./${file}${base}`).catch(() => null);" in fur
    for flow in ('"live_aboard_photo.js", "photoFlow"', '"live_aboard_library.js", "libraryFlow"', '"live_aboard_import.js", "importFlow"',
                 '"live_aboard_people.js", "peopleFlow"'):
        assert flow in fur, flow
    for bad in ("confirm(", "alert(", "prompt(", "setInterval", "setTimeout", "localStorage", "fetch("):
        assert bad not in fur, bad


def test_the_plan_and_the_3d_view_share_one_renderer() -> None:
    """Side by side on a wide screen (each its own viewport of the one
    canvas), Plan / 3D on a narrow one; the view still draws only on demand."""
    la = _js(_VIEWS / "live_aboard.js")
    assert "renderer.setScissorTest(true);" in la and "renderer.setViewport(r[0], drawnH - r[1] - r[3], r[2], r[3]);" in la
    assert la.count("new THREE.WebGLRenderer(") == 1 and "new THREE.OrthographicCamera(" in la
    assert "const SPLIT_MIN_W = 820, SPLIT_K = 0.58;" in la
    assert "setInterval" not in _code(_VIEWS / "live_aboard.js") and "setTimeout" not in _code(_VIEWS / "live_aboard.js")


def test_each_piece_carries_its_id_and_device_for_taps_later() -> None:
    fur = _code(_VIEWS / "live_aboard_furnish.js")
    assert "D.root.userData.pieceId = p.id; D.root.userData.entity_id = p.entity_id || null;" in fur


def test_the_new_file_is_credited_in_the_report() -> None:
    assert "live_aboard_furnish" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_furnish")
