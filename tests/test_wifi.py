# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Wi-Fi coverage (views/wifi.js, test 2026-11-22): UniFi Utopia's survey drawn on PadSpan's floor model.

tests/js/wifi.mjs runs the view under the DOM shim: the radio map's colours, the floor's rooms from
the floor model, readings colouring only inside rooms and only near a reading, the floor and band choices,
each room's reading, placed devices on their band, the counts, the links card for an administrator only, and
no UniFi Utopia said in words. Held here: the tab is in the menu only while UniFi Utopia answers, and the
panel never asks on a wall screen or in Sample mode.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_view_under_the_dom_shim():
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "wifi.mjs"), str(_WWW)],
                         capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    out = json.loads(res.stdout.strip().splitlines()[-1])
    assert len(out["cases"]) >= 20 and not out["failures"], out["failures"]


def test_the_tab_follows_unifi_utopias_answer():
    p = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert '["wifi","Wi-Fi coverage","mdi:wifi"]' in p
    assert 'if (!this.state._wifiSurveyOn) out.delete("wifi");' in p
    probe = p[p.index("  _wifiProbe(){"):p.index("  _loadMissingView(v){")]
    assert 'st.dataMode !== "live" || st.kioskMode' in probe, "never asked on a wall screen or in Sample mode"
    assert '"unifi_utopia/wifi_heatmap"' in probe and "600000" in probe


def test_the_view_asks_only_unifi_utopia():
    v = (_WWW / "views" / "wifi.js").read_text(encoding="utf-8")
    types = {t for t in __import__("re").findall(r'type: "([a-z_/]+)"', v)}
    # Access points are placed in Mapping (the Atlas) since 2026-11-23: nothing here places one.
    assert types == {"unifi_utopia/wifi_heatmap", "unifi_utopia/wifi_links", "unifi_utopia/wifi_link_set"}, types
