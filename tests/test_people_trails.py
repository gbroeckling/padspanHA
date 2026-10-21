# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Trails: where each person and tag went in the last half hour, in Live Aboard.

tests/js/people_trails.mjs turns Traceback's frames into each thing's runs
(only the last half hour, broken on a floor change or a long silence) and
runs the real 3D view under the DOM shim: off by default Traceback is never
read; on, each person and tag drawn has its own fading ribbon on the floor it
was walked on, a floor not showing hides its trails, and it is read again no
sooner than TRAIL_MS; with people and tags off, nothing is drawn or read.

The rest is held here: Trails record nothing new (Traceback's own history,
read through padspan_ha/traceback_get), are kept per screen and off unless
that screen turned them on, and the hosts hand a reader over only with live
data.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def pt() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "people_trails.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*")))


@pytest.mark.parametrize("prefix", ["runs:", "fade:", "off:", "on:"])
def test_the_trails_harness_covers_each_part(pt, prefix) -> None:
    got = {k: v for k, v in pt["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(pt['cases'])}"
    bad = [f for f in pt["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_trails_case_passes(pt) -> None:
    assert not pt["failures"], json.dumps(pt["failures"][:6], indent=2, ensure_ascii=False)


def test_trails_read_only_what_traceback_already_keeps() -> None:
    """No new recording: the one message is Traceback's own read, half an
    hour back, and the module talks to nothing else."""
    src = _code(_VIEWS / "people_trails.js")
    assert src.count("padspan_ha/") == 1 and '"padspan_ha/traceback_get"' in src
    assert "callWS" not in src and "fetch(" not in src and "localStorage" not in src
    assert "export const TRAIL_S = 1800;" in src


def test_trails_are_off_unless_this_screen_turned_them_on() -> None:
    la = _code(_VIEWS / "live_aboard.js")
    assert 'const PREF_TRAILS = "trails";' in la
    reader = la[la.index("  function trailReader(p){"):la.index("  function trailsOffered(){")]
    assert 'prefGet(PREF_TRAILS) !== "1"' in reader and "(on(p.people) || on(p.tags))" in reader
    sync = la[la.index("  function syncTracked(p, vd, rebuilt){"):la.index("  function readPeople(pp){")]
    assert "trails: tr ? trailData : null" in sync
    # The menu offers it only where it can be read.
    assert "...(trailsOffered() ? [{ text: `Trails, last 30 min:" in la


def test_the_hosts_hand_a_trails_reader_with_live_data_only() -> None:
    lm = _code(_VIEWS / "lights_map.js")
    assert ("trails: (h3.settings.atlas_3d_people === true || h3.settings.atlas_3d_tags === true) && h3.trails ? h3.trails : null"
            in lm)
    maps = _code(_VIEWS / "maps.js")
    assert 'trails: ctx.state.dataMode !== "live" ? null' in maps
    assert "trails: { read: (msg)=>this._hass.callWS(msg) }" in _code(_WWW / "lights_panel.js")


def test_the_tracked_layer_draws_trails_without_naming_the_view() -> None:
    tr = _js(_VIEWS / "live_aboard_tracked.js")
    assert "live_aboard" not in tr
    assert "export function trailOwners(want){" in tr and "function syncTrails(want, trails, rebuilt){" in tr
    # Each ribbon on its own floor's group: a hidden floor hides its trails.
    assert "F.group.add(m); trailMeshes.push(m);" in tr


def test_people_trails_is_a_known_ui_helper() -> None:
    assert "people_trails" in T.UI_ERROR_HELPERS
    assert (_VIEWS / "people_trails.js").is_file()
