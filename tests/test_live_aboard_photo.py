# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P3 and P6: the photo and people screens
(views/live_aboard_photo.js, views/live_aboard_people.js).

tests/js/live_aboard_photo.mjs runs both without a page, against the real
builders module and a fake callWS that records every call: a photo is sent
only by Read it, once a press; a person's photo never before the consent is
ticked; the AI's size only when it was sure, else one typed size and the
photo's proportions; Build instead, a box, try again; figures by hand and
from a photo, removed and unlinked; beacon and scanner looks. What the
people screen resolves goes through the server's own apply_edit here. And:
the files are credited in the report, and the Atlas never loads them.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_builders as B
from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def flows() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_photo.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_the_flows_hold(flows) -> None:
    assert flows["failures"] == [], json.dumps(flows["failures"], indent=1)[:4000]


@pytest.mark.parametrize("prefix,least", [
    ("photo:", 8), ("failed:", 6), ("measure:", 8), ("note:", 4), ("kinds:", 1), ("lists:", 5),
    ("consent:", 9), ("people:", 6), ("looks:", 1),
])
def test_the_harness_covers_each_part(flows, prefix, least) -> None:
    if prefix == "looks:" and not B.kinds_of(("tag",)):
        pytest.skip("the builders have no tag kinds yet")
    got = [k for k in flows["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)


def test_what_the_people_screen_resolves_the_server_takes(flows) -> None:
    assert flows["payloads"]
    for p in flows["payloads"]:
        out = H.apply_edit(H.empty(), {k: v for k, v in p.items() if v})
        for pid, f in (p.get("figures") or {}).items():
            assert (out["figures"].get(pid) is None) == (f is None)


def test_the_new_files_are_credited_in_the_report() -> None:
    for name in ("live_aboard_photo", "live_aboard_people"):
        assert (_VIEWS / f"{name}.js").is_file()
        assert name in T.UI_ERROR_HELPERS, name


def test_the_atlas_never_loads_them() -> None:
    """Only the Furnish tab opens these screens (contracts §4): the Atlas,
    its 3D view and the panel shell never import them, so with Live Aboard
    off nothing of them loads."""
    for f in ("live_aboard.js", "live_aboard_house.js", "live_aboard_edit.js", "live_aboard_use.js",
              "lights_map.js"):
        src = (_VIEWS / f).read_text(encoding="utf-8")
        assert "live_aboard_photo" not in src and "live_aboard_people" not in src, f
    for f in ("lights_panel.js", "panel.js"):
        src = (_WWW / f).read_text(encoding="utf-8")
        assert "live_aboard_photo" not in src and "live_aboard_people" not in src, f


def test_three_loads_only_for_a_preview_and_nothing_else_is_imported() -> None:
    photo = (_VIEWS / "live_aboard_photo.js").read_text(encoding="utf-8")
    people = (_VIEWS / "live_aboard_people.js").read_text(encoding="utf-8")
    assert not re.search(r"^\s*import\b", photo, re.M) and "import(" not in photo, "the photo screen imports nothing"
    # (And Carries' rules, the people layer's own: who keeps a thing picked for two.)
    assert re.findall(r"import\(`([^`$]+)", people) == ["./live_aboard_photo.js", "./live_aboard_tracked.js",
                                                         "../vendor/three/three.module.min.js"]
    top = people[:people.index("function makePreview")]
    assert "three.module" not in top, "three.js only when a preview opens"


def test_the_photo_is_kept_nowhere_in_the_browser() -> None:
    for f in ("live_aboard_photo.js", "live_aboard_people.js"):
        src = (_VIEWS / f).read_text(encoding="utf-8")
        assert not re.search(r"localStorage|sessionStorage|indexedDB|caches\.", src), f
