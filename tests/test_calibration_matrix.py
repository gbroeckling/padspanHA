"""calibration_matrix.js — the point×scanner error grid (gap #3 of the
best-in-class roadmap, docs/BEST_IN_CLASS_ROADMAP.md).

Pure data/string builders, no DOM. measured_m reuses path_loss.js's
estimateDistanceM (the one frontend RSSI->distance implementation), so this
harness copies that module alongside calibration_matrix.js to resolve its
relative import.

Skipped (not failed) when node is unavailable.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(tmp_path: Path, script_body: str) -> dict:
    # calibration_matrix.js statically imports "./path_loss.js" — copy that
    # module alongside as .mjs (forces ESM parsing, matching the .js -> .mjs
    # trick every other node-harness test in this suite uses) and rewrite
    # the one import line to match, since Node resolves relative specifiers
    # literally rather than by sibling-file convention.
    cm_src = (_VIEWS / "calibration_matrix.js").read_text(encoding="utf-8")
    cm_src = cm_src.replace('from "./path_loss.js"', 'from "./path_loss.mjs"')
    (tmp_path / "calibration_matrix.mjs").write_text(cm_src, encoding="utf-8")
    shutil.copy(_VIEWS / "path_loss.js", tmp_path / "path_loss.mjs")
    script = "const CM = await import('./calibration_matrix.mjs');\n" + script_body
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


_PATH_LOSS = {"s1": {"rssi_1m": -50.0, "n": 2.0, "units": "m", "scanner_name": "Kitchen RX"}}
_SCAN_POS = {"s1": {"x_m": 0.0, "y_m": 0.0, "floor_id": "main"}}


def test_a_point_at_the_fitted_distance_has_zero_error(tmp_path):
    # 10^((rssi_1m - rssi)/(10n)) = 10^((-50 - -60)/20) = 10^0.5 =~ 3.162m
    # placed at exactly that geometric distance, 2D (no floor elevation data).
    out = _run(tmp_path, (
        "const m = CM.buildCalibrationMatrix({"
        f"points: [{{x_m: {10**0.5}, y_m: 0, floor_id: 'main', room: 'Kitchen', "
        "scanner_readings: [{source:'s1', mean_rssi:-60.0}]}],"
        f"pathLoss: {json.dumps(_PATH_LOSS)}, scannerPositions: {json.dumps(_SCAN_POS)},"
        "floorElevations: {}, settings: {}});\n"
        "console.log(JSON.stringify(m));\n"
    ))
    assert out["scanners"] == ["s1"], out
    assert len(out["rows"]) == 1
    cell = out["rows"][0]["cells"]["s1"]
    assert abs(cell["error_m"]) <= 0.1, cell
    assert cell["rssi"] == -60.0


def test_a_scanner_that_never_heard_the_point_is_grey_not_zero(tmp_path):
    out = _run(tmp_path, (
        "const m = CM.buildCalibrationMatrix({"
        "points: [{x_m: 5, y_m: 0, floor_id: 'main', scanner_readings: []}],"
        f"pathLoss: {json.dumps(_PATH_LOSS)}, scannerPositions: {json.dumps(_SCAN_POS)},"
        "floorElevations: {}, settings: {}});\n"
        "console.log(JSON.stringify(m.rows[0].cells));\n"
    ))
    assert out == {"s1": None}, "no reading for this pair must be null (grey), not a zero/fabricated error"


def test_a_scanner_with_no_metre_position_is_excluded_from_the_columns(tmp_path):
    out = _run(tmp_path, (
        "const m = CM.buildCalibrationMatrix({"
        "points: [{x_m: 0, y_m: 0, scanner_readings: [{source:'s1', mean_rssi:-60}]}],"
        f"pathLoss: {json.dumps(_PATH_LOSS)}, scannerPositions: {{}}, "
        "floorElevations: {}, settings: {}});\n"
        "console.log(JSON.stringify(m));\n"
    ))
    assert out["scanners"] == [], "a scanner with no fabric position has nothing to compare geometry against"


def test_a_point_with_no_metre_position_is_excluded_from_the_rows(tmp_path):
    out = _run(tmp_path, (
        "const m = CM.buildCalibrationMatrix({"
        "points: [{room:'Attic', scanner_readings: [{source:'s1', mean_rssi:-60}]}],"  # no x_m/y_m
        f"pathLoss: {json.dumps(_PATH_LOSS)}, scannerPositions: {json.dumps(_SCAN_POS)},"
        "floorElevations: {}, settings: {}});\n"
        "console.log(JSON.stringify(m.rows));\n"
    ))
    assert out == [], "a fingerprint-only point (no real-world position) has no geometric distance to compare"


def test_floor_elevation_data_adds_a_vertical_component(tmp_path):
    scan_pos = {"s1": {"x_m": 0.0, "y_m": 0.0, "floor_id": "ground", "z_m": 2.4}}
    floor_elev = {"ground": 0.0, "upstairs": 3.0}
    out = _run(tmp_path, (
        "const m = CM.buildCalibrationMatrix({"
        "points: [{x_m: 0, y_m: 0, floor_id: 'upstairs', scanner_readings: [{source:'s1', mean_rssi:-60}]}],"
        f"pathLoss: {json.dumps(_PATH_LOSS)}, scannerPositions: {json.dumps(scan_pos)},"
        f"floorElevations: {json.dumps(floor_elev)}, settings: {{}}}});\n"
        "console.log(JSON.stringify(m.rows[0].cells.s1.expected_m));\n"
    ))
    # Directly overhead in x/y but 3m + device-height (1m default) - 2.4m
    # scanner height apart vertically: sqrt(0 + 0 + 1.6^2) = 1.6, not 0.
    assert out == pytest.approx(1.6, abs=0.05)


def test_a_units_fraction_fit_is_not_treated_as_metre_space(tmp_path):
    bad_fit = {"s1": {"rssi_1m": -50.0, "n": 2.0, "units": "frac"}}
    out = _run(tmp_path, (
        "const m = CM.buildCalibrationMatrix({"
        "points: [{x_m: 0, y_m: 0, scanner_readings: [{source:'s1', mean_rssi:-60}]}],"
        f"pathLoss: {json.dumps(bad_fit)}, scannerPositions: {json.dumps(_SCAN_POS)},"
        "floorElevations: {}, settings: {}});\n"
        "console.log(JSON.stringify(m.scanners));\n"
    ))
    assert out == [], "a non-metre fit has no geometric distance to compare against"


def test_empty_input_does_not_throw(tmp_path):
    out = _run(tmp_path, "console.log(JSON.stringify(CM.buildCalibrationMatrix({})));\n")
    assert out == {"scanners": [], "rows": []}


# ── errorColor ───────────────────────────────────────────────────────────────

def test_error_color_is_blue_for_negative_green_for_zero_red_for_positive(tmp_path):
    out = _run(tmp_path, (
        "console.log(JSON.stringify({"
        "  blue: CM.errorColor(-3), green: CM.errorColor(0), red: CM.errorColor(3),"
        "}));\n"
    ))
    import re
    def hue(s):
        return int(re.match(r"hsl\((\d+),", s).group(1))
    assert hue(out["blue"]) > hue(out["green"]) > hue(out["red"]), out


def test_error_color_clamps_beyond_the_cap(tmp_path):
    out = _run(tmp_path, (
        "console.log(JSON.stringify({far: CM.errorColor(-999), cap: CM.errorColor(-3)}));\n"
    ))
    assert out["far"] == out["cap"], "an error far beyond the cap must not run off the color scale"


def test_error_color_of_null_is_null_not_a_fabricated_color(tmp_path):
    out = _run(tmp_path, "console.log(JSON.stringify({a: CM.errorColor(null), b: CM.errorColor(undefined)}));\n")
    assert out == {"a": None, "b": None}
