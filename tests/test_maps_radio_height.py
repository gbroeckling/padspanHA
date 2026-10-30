"""Receiver height in Mapping → Edit → Radios (interface review, 2026-10-30).

A receiver's mounting height used to be settable only in Calibration → Tune
("Save Z"). Edit → Radios now shows the selected radio's height too, with a
"Save height" button. Both places read one value
(model.scanner_positions_m[source].z_m) and write it with one command
(padspan_ha/fabric_scanner_z_set {source, z_m}); there is no second store.
tests/js/maps_radio_height.mjs drives the real Edit view.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")


def _read(name: str) -> str:
    return (_VIEWS / name).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_edit_radios_height_drives_the_real_view() -> None:
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "maps_radio_height.mjs"), str(_VIEWS)],
                         capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])
    assert len(got) >= 19, got
    bad = {k: v for k, v in got.items() if not v["ok"]}
    assert not bad, bad


_Z_CALL = re.compile(
    r'callWS\(\{\s*type:\s*"padspan_ha/fabric_scanner_z_set",\s*source:\s*[\w.]+,\s*z_m:\s*v,\s*\}\)')


def test_both_places_send_the_same_command_and_payload() -> None:
    """Calibration's Save Z and Edit's Save height: the same command with
    the same two fields, once each, and no other writer of the height."""
    cal, maps = _read("calibration.js"), _read("maps.js")
    assert len(_Z_CALL.findall(cal)) == 1
    assert len(_Z_CALL.findall(maps)) == 1
    for src in (cal, maps):
        assert src.count('"padspan_ha/fabric_scanner_z_set"') == 1


def test_both_places_read_the_same_value_with_the_same_limits() -> None:
    cal, maps = _read("calibration.js"), _read("maps.js")
    assert "scanner_positions_m || {})[rx.source]" in cal
    assert "scanner_positions_m) || {})[src]" in maps
    for src in (cal, maps):
        assert "!= null ? " in src and "z_m : 2.4)" in src          # same 2.4 m default
        assert "v < 0 || v > 100" in src                             # same 0–100 m range
        assert "Math.round(Math.max(0, Math.min(100, v)) * 100) / 100" in src   # same publish rounding


def test_both_places_say_save_height() -> None:
    # Garry, 2026-10-30: "Save Z" became "Save height" in Calibration too
    assert 'zBtn.textContent = "Save height";' in _read("calibration.js")
    assert '"Save Z"' not in _read("calibration.js")
    assert '"Save height")' in _read("maps.js")
