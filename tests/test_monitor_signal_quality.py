# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Per-scanner signal quality (Monitor tab's Diagnostics/Insights sub-tabs).

Garry, 2026-09-06 (live on his own install): "the radios all say poor, this
tab is obviously garbage and needs to be reworked completely." Root cause:
the old computation averaged RSSI across EVERY advertisement a scanner
merely overheard — on a real house, the overwhelming majority of BLE
traffic any scanner hears is someone else's phone two rooms away, or a
passing car, which is weak by nature. Averaging that in makes a busy,
healthy scanner indistinguishable from a broken one: every scanner trends
toward "Poor" regardless of how well it covers what is actually near it.

_scannerQuality credits each device's reading only to its OWN strongest
scanner — the one hearing it loudest — so a scanner's grade reflects how
well it covers what is close to it, not how much distant noise it also
picks up.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(tmp_path: Path, ads: list[dict]) -> dict:
    src = (_VIEWS / "monitor.js").read_text(encoding="utf-8")
    (tmp_path / "monitor.mjs").write_text(src, encoding="utf-8")
    script = (
        "import { _scannerQuality, _qualityGrade } from './monitor.mjs';\n"
        f"const ADS = {json.dumps(ads)};\n"
        "const stats = _scannerQuality(ADS);\n"
        "const out = {};\n"
        "for (const [src, s] of Object.entries(stats)) {\n"
        "  const avg = s.count > 0 ? Math.round(s.rssiSum / s.count) : null;\n"
        "  out[src] = { avg, count: s.count, grade: _qualityGrade(avg).label };\n"
        "}\n"
        "console.log(JSON.stringify(out));\n"
    )
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def _ad(address: str, source: str, rssi: float) -> dict:
    return {"address": address, "source": source, "rssi": rssi}


def test_a_busy_scanner_hearing_mostly_distant_devices_is_not_penalized_for_it(tmp_path) -> None:
    """The exact failure this exists to fix: one scanner overhears a pile
    of devices that are actually much closer to a second scanner. The busy
    scanner must not be graded on those weak overheard readings — only on
    the devices it actually wins."""
    ads = [_ad(f"AA:{i:02X}", "busy_scanner", -85) for i in range(20)]
    ads += [_ad(f"AA:{i:02X}", "other_scanner", -55) for i in range(20)]  # the SAME devices, heard louder elsewhere
    ads.append(_ad("BB:01", "busy_scanner", -50))  # one device this scanner genuinely owns

    out = _run(tmp_path, ads)
    assert out["busy_scanner"]["count"] == 1, "the 20 devices belonging to another scanner leaked in"
    assert out["busy_scanner"]["avg"] == -50
    assert out["busy_scanner"]["grade"] == "Excellent"
    assert out["other_scanner"]["count"] == 20
    assert out["other_scanner"]["grade"] == "Excellent"


def test_a_device_credits_only_its_single_strongest_scanner(tmp_path) -> None:
    ads = [_ad("AA:01", "s1", -70), _ad("AA:01", "s2", -55), _ad("AA:01", "s3", -90)]
    out = _run(tmp_path, ads)
    assert out.get("s2", {}).get("count") == 1
    assert "s1" not in out and "s3" not in out, "only the strongest scanner should get credit"


def test_ads_with_no_rssi_or_no_source_are_ignored(tmp_path) -> None:
    ads = [
        {"address": "AA:01", "source": "s1", "rssi": None},
        {"address": "AA:02", "source": "", "rssi": -60},
        {"address": "", "source": "s1", "rssi": -60},
    ]
    out = _run(tmp_path, ads)
    assert out == {}


@pytest.mark.parametrize("avg,expected", [
    (-55, "Excellent"), (-60, "Excellent"),
    (-65, "Good"), (-70, "Good"),
    (-75, "Fair"), (-80, "Fair"),
    (-85, "Poor"), (-100, "Poor"),
])
def test_quality_grade_thresholds(tmp_path, avg, expected) -> None:
    ads = [_ad("AA:01", "s1", avg)]
    out = _run(tmp_path, ads)
    assert out["s1"]["grade"] == expected


def test_quality_grade_with_no_data_is_a_dash_not_a_grade(tmp_path) -> None:
    out = _run(tmp_path, [])
    assert out == {}
