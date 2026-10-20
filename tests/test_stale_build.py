# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A panel left open through an update ran the old UI against the new
backend until someone reloaded it (a wall screen, for days). The panel
compares its build with the backend's on every full refresh."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_PANEL = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_NODE = shutil.which("node")


def _action(page, backend, kiosk, reloaded_for):
    if _NODE is None:
        pytest.skip("node is not installed")
    src = _PANEL.read_text(encoding="utf-8")
    fn = re.search(r"^function staleBuildAction\(.*?^}", src, re.S | re.M).group(0)
    js = fn + f"\nconsole.log(JSON.stringify(staleBuildAction({json.dumps(page)}, {json.dumps(backend)}, {json.dumps(kiosk)}, {json.dumps(reloaded_for)})));"
    res = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


OLD, NEW = "20261012T010000Z", "20261013T043232Z"


def test_same_build_or_no_backend_build_does_nothing():
    assert _action(NEW, NEW, True, "") is None
    assert _action(NEW, "", True, "") is None


def test_an_update_shows_and_a_kiosk_screen_reloads_once():
    assert _action(OLD, NEW, False, "") == {"newer": True, "reload": False}
    assert _action(OLD, NEW, True, "") == {"newer": True, "reload": True}
    assert _action(OLD, NEW, True, NEW) == {"newer": True, "reload": False}   # reloaded once already


def test_a_page_newer_than_the_backend_never_reloads():
    """Files updated by HACS before HA restarts: a reload loads the same
    new page, so reloading would loop."""
    assert _action(NEW, OLD, True, "") == {"newer": False, "reload": False}


def test_the_check_runs_on_every_full_refresh():
    s = _PANEL.read_text(encoding="utf-8")
    body = s[s.index("  async _refreshAll("):]
    body = body[:body.index("\n  }\n")]
    assert "this._checkBuild();" in body
    assert '<div id="staleBuild" class="stale-build hidden"></div>' in s


def test_a_screen_that_never_refreshes_still_checks_every_ten_minutes():
    s = _PANEL.read_text(encoding="utf-8")
    assert "if(Date.now() - (this._versionPollTs || 0) > 600000){" in s
    i = s.index("if(Date.now() - (this._versionPollTs || 0) > 600000){")
    assert "await this._getVersionInfo();" in s[i:i + 300] and "this._checkBuild();" in s[i:i + 300]


# ── The Atlas panel and wall screens (2026-10-19) ────────────────────────────
# A wall left on the sidebar Atlas through 0.38.105 -> 0.38.144 kept running
# the 0.38.105 Atlas: lights_panel.js had no build check at all. And the main
# panel only reloaded itself with ?kiosk=1, which a Chrome --kiosk wall
# screen does not carry.

_ATLAS = _PANEL.parent / "lights_panel.js"


def _fn(path: Path, name: str) -> str:
    src = path.read_text(encoding="utf-8")
    return re.search(rf"^function {name}\(.*?^}}", src, re.S | re.M).group(0)


def test_the_atlas_has_the_same_build_check():
    for name in ("staleBuildAction", "wallScreen", "untouchedFor"):
        assert _fn(_ATLAS, name) == _fn(_PANEL, name), f"{name} differs between panel.js and lights_panel.js"
    atlas = _ATLAS.read_text(encoding="utf-8")
    assert 'type:"padspan_ha/version"' in atlas
    assert "const wall = kiosk || (wallScreen(false) && untouchedFor(120000));" in atlas
    assert "staleBuildAction(BUILD_ID, be, wall, reloadedFor)" in atlas
    assert 'sessionStorage.setItem("padspan_reloaded_for", be)' in atlas, "a reload must be remembered, or it can loop"


def test_the_main_panel_treats_a_full_screen_window_as_a_wall():
    # ?kiosk=1 reloads at once; a full-screen window only after two idle minutes,
    # as it may be a tablet in use, or a desktop at F11, with unsaved work.
    src = _PANEL.read_text(encoding="utf-8")
    assert "const wall = this.state.kioskMode || (wallScreen(false) && untouchedFor(120000));" in src
    assert "staleBuildAction(RELEASE_BUILD_ID, be, wall, reloadedFor)" in src


@pytest.mark.parametrize("kiosk,w,h,sw,sh,want", [
    (True, 800, 600, 1920, 1080, True),     # ?kiosk=1
    (False, 1920, 1080, 1920, 1080, True),  # Chrome --kiosk, a full-screen tablet
    (False, 1280, 900, 1920, 1080, False),  # a normal browser window
])
def test_what_counts_as_a_wall_screen(kiosk, w, h, sw, sh, want):
    if _NODE is None:
        pytest.skip("node is not installed")
    js = _fn(_PANEL, "wallScreen") + (
        f"\nconsole.log(JSON.stringify(wallScreen({json.dumps(kiosk)}, "
        f"{{innerWidth: {w}, innerHeight: {h}, screen: {{width: {sw}, height: {sh}}}}})));")
    res = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout) is want


# ── The opt-in report's view of wall screens (0.38.149) ───────────────────────
# 0.38.145's self-reload and full-screen rule could only be confirmed on real
# walls: the report says what kind of screen each page is, how a self-reload
# went, and how a ?view= link fared.

def _node(js):
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_both_panels_judge_screens_and_reloads_alike():
    for name in ("screenKind", "reloadOutcome"):
        assert _fn(_ATLAS, name) == _fn(_PANEL, name), f"{name} differs between panel.js and lights_panel.js"


@pytest.mark.parametrize("panel,page,reloaded_for,how,want", [
    ("panel", NEW, NEW, "panel:kiosk", "kiosk"),           # came back on the build it went for
    ("atlas", NEW, NEW, "atlas:fullscreen", "fullscreen"),
    ("panel", OLD, NEW, "panel:fullscreen", "stuck"),      # came back on the old build
    ("panel", NEW, NEW, "atlas:kiosk", None),              # the other panel's reload
    ("panel", NEW, NEW, "", None),                         # an ordinary reload
    ("atlas", NEW, OLD, "atlas:kiosk", None),              # an older note, nothing to say
])
def test_how_a_self_reload_went(panel, page, reloaded_for, how, want):
    js = _fn(_PANEL, "reloadOutcome") + (
        f"\nconsole.log(JSON.stringify(reloadOutcome({json.dumps(panel)}, {json.dumps(page)}, "
        f"{json.dumps(reloaded_for)}, {json.dumps(how)})));")
    assert _node(js) == want


@pytest.mark.parametrize("kiosk,w,idle,want", [
    (True, 800, False, "kiosk"),
    (False, 1920, True, "fullscreen_idle"),
    (False, 1920, False, "fullscreen_used"),
    (False, 1280, True, "windowed"),
])
def test_what_kind_of_screen(kiosk, w, idle, want):
    stub = f"function untouchedFor(ms){{ return {json.dumps(idle)}; }}\n"
    js = stub + _fn(_PANEL, "wallScreen") + "\n" + _fn(_PANEL, "screenKind") + (
        f"\nconsole.log(JSON.stringify(screenKind({json.dumps(kiosk)}, "
        f"{{innerWidth: {w}, innerHeight: 1080, screen: {{width: 1920, height: 1080}}}})));")
    assert _node(js) == want


def test_the_reports_are_wired_and_in_the_vocabulary():
    from custom_components.padspan_ha import telemetry as T
    panel, atlas = _PANEL.read_text(encoding="utf-8"), _ATLAS.read_text(encoding="utf-8")
    for src, name in ((panel, "panel"), (atlas, "atlas")):
        assert f'"wall_screen:{name}:" + screenKind(' in src
        assert f'"wall_reload:{name}:" + _reloadNote' in src
        assert f'sessionStorage.setItem("padspan_reload_how", "{name}:" +' in src
        assert all(T.event_allowed(f"wall_screen:{name}:{k}") for k in T.SCREEN_KINDS)
        assert all(T.event_allowed(f"wall_reload:{name}:{k}") for k in T.RELOAD_OUTCOMES)
    assert '"view_link:" + (this._keepsLinkedView(v) ? "kept" : off ? "forensics_off" : "edition")' in panel
    assert "this._countViewLink();" in panel
    assert all(T.event_allowed(f"view_link:{k}") for k in T.VIEW_LINK_OUTCOMES)
    assert not T.event_allowed("wall_screen:panel:huge") and not T.event_allowed("view_link:https")
