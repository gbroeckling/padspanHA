# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""prefers-reduced-motion (0.38.165): with the browser asking for less motion,
the Overview's dots (and Traceback's, the same iso_motion.js merge) stand where
they are instead of gliding and fading, and the Overview map is swapped without
its crossfade. Without the preference nothing changes."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_prefers_still_follows_the_browser(tmp_path):
    shutil.copy(_VIEWS / "iso_motion.js", tmp_path / "iso_motion.mjs")
    code = ("const IM = await import('./iso_motion.mjs');\n"
            "const none = IM.prefersStill();\n"
            "globalThis.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });\n"
            "const on = IM.prefersStill();\n"
            "globalThis.matchMedia = () => ({ matches: false });\n"
            "const off = IM.prefersStill();\n"
            "globalThis.matchMedia = () => { throw new Error('x'); };\n"
            "const broken = IM.prefersStill();\n"
            "console.log(JSON.stringify([none, on, off, broken]));\n")
    (tmp_path / "run.mjs").write_text(code, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout.strip().splitlines()[-1]) == [False, True, False, False]


def test_the_merge_is_still_only_with_the_preference():
    im = _src(_VIEWS / "iso_motion.js")
    assert "const still = opts.still != null ? !!opts.still : prefersStill();" in im
    assert "const moveMs = still ? 0 : opts.moveMs != null ? opts.moveMs : 900;" in im
    assert "const fadeMs = still ? 0 : opts.fadeMs != null ? opts.fadeMs : 300;" in im
    # The glide and fade themselves are as they were.
    assert "node.style.transition = `translate ${moveMs}ms cubic-bezier(.22,.9,.35,1)`;" in im
    assert "node.style.transition = `opacity ${fadeMs}ms ease`;" in im


def test_the_overview_skips_its_crossfade_only_with_the_preference():
    ov = _src(_VIEWS / "overview.js")
    assert "const { mergeObjectLayer, trailPush, trailSvg, prefersStill } =" in ov
    assert ("      if (!_isoRebuiltOnce || prefersStill()) {\n        _isoRebuiltOnce = true;\n        doBuild();\n        return;\n      }\n"
            '      isoDiv.style.transition = "opacity 150ms ease";') in ov
