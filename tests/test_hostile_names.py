# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A name always shows as the text it is.

Scanner names come from MQTT and the device registry, a calibration point's
label can be a beacon's own advertised name, and both are drawn into markup
the panel builds as strings (the Health view's low-reliability line, the
Calibration map's point tooltips). Rendered with a name that is markup, the
view must carry it escaped — the same characters, shown, never run.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_HARNESS = Path(__file__).parent / "js" / "hostile_names.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

HOSTILE = "<img src=x onerror=alert(1)>"
SHOWN = "&lt;img src=x onerror=alert(1)&gt;"


def _render(name: str) -> dict:
    res = subprocess.run([_NODE, str(_HARNESS), str(_WWW), name],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    return json.loads(res.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def hostile() -> dict:
    return _render(HOSTILE)


@pytest.mark.parametrize("view", ["health.js", "calibration.js"])
def test_a_hostile_name_is_drawn_as_text(hostile, view):
    out = hostile[view]
    assert out["error"] is None, out["error"]
    html = "\n".join(out["html"])
    assert HOSTILE not in html, f"{view} put a name into markup unescaped"
    assert SHOWN in html, f"{view} did not draw the name at all — the check proved nothing"


def test_the_calibration_tooltip_carries_the_name():
    """The point tooltip (a beacon's advertised name can be the label)."""
    html = "\n".join(_render(HOSTILE)["calibration.js"]["html"])
    assert f"<title>{SHOWN} (1 scanners)</title>" in html


def test_a_normal_name_is_unchanged():
    out = _render("Kitchen ESP32")
    assert "Kitchen ESP32 (40% agreement)" in "\n".join(out["health.js"]["html"])
    assert "<title>Kitchen ESP32 (1 scanners)</title>" in "\n".join(out["calibration.js"]["html"])
