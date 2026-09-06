"""whatif_placement.js — ghost-scanner room-discrimination scoring (gap #9
of the best-in-class roadmap, docs/BEST_IN_CLASS_ROADMAP.md).

Pure functions, no DOM. Statically imports radio_map.js (for its exported
physics — FLOOR_ATTEN_DB, DEFAULT_REF_POWER, DEFAULT_PATH_LOSS_N,
barrierAttenuation), so this harness copies that module alongside and
rewrites the one import line, same trick test_calibration_matrix.py uses
for path_loss.js.

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
    wi_src = (_VIEWS / "whatif_placement.js").read_text(encoding="utf-8")
    wi_src = wi_src.replace('from "./radio_map.js"', 'from "./radio_map.mjs"')
    (tmp_path / "whatif_placement.mjs").write_text(wi_src, encoding="utf-8")
    # radio_map.js dynamically imports stack_transform.js with a cache-buster
    # query string (`./stack_transform.js${new URL(import.meta.url).search}`)
    # — copy that module alongside too (it has no imports of its own) and
    # drop the .js extension so Node parses it as ESM (same .js -> .mjs
    # trick every node-harness test in this suite uses).
    rm_src = (_VIEWS / "radio_map.js").read_text(encoding="utf-8")
    rm_src = rm_src.replace(
        "`./stack_transform.js${new URL(import.meta.url).search}`",
        '"./stack_transform.mjs"',
    )
    (tmp_path / "radio_map.mjs").write_text(rm_src, encoding="utf-8")
    shutil.copy(_VIEWS / "stack_transform.js", tmp_path / "stack_transform.mjs")
    script = "const WI = await import('./whatif_placement.mjs');\n" + script_body
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# ── fingerprintAt ────────────────────────────────────────────────────────────

def test_a_closer_scanner_reads_a_stronger_less_negative_rssi(tmp_path):
    out = _run(tmp_path, (
        "const scanners = [{x_m: 0, y_m: 0, dz: 0, source: 's1', floorDist: 0}];\n"
        "const near = WI.fingerprintAt(1, 0, scanners, []);\n"
        "const far = WI.fingerprintAt(10, 0, scanners, []);\n"
        "console.log(JSON.stringify({near: near.s1, far: far.s1}));\n"
    ))
    assert out["near"] > out["far"], out


def test_a_wall_between_the_point_and_the_scanner_weakens_the_reading(tmp_path):
    out = _run(tmp_path, (
        "const scanners = [{x_m: 0, y_m: 0, dz: 0, source: 's1', floorDist: 0}];\n"
        "const noWall = WI.fingerprintAt(5, 0, scanners, []);\n"
        "const wall = [{points: [[2, -5], [2, 5]], attenuation_dbm: 8}];\n"
        "const withWall = WI.fingerprintAt(5, 0, scanners, wall);\n"
        "console.log(JSON.stringify({noWall: noWall.s1, withWall: withWall.s1}));\n"
    ))
    assert out["withWall"] == pytest.approx(out["noWall"] - 8, abs=1e-6)


def test_a_floor_crossing_weakens_the_reading_by_the_floor_penalty(tmp_path):
    out = _run(tmp_path, (
        "const same = WI.fingerprintAt(5, 0, [{x_m:0,y_m:0,dz:0,source:'s1',floorDist:0}], []);\n"
        "const cross = WI.fingerprintAt(5, 0, [{x_m:0,y_m:0,dz:0,source:'s1',floorDist:1}], []);\n"
        "console.log(JSON.stringify({same: same.s1, cross: cross.s1}));\n"
    ))
    assert out["cross"] < out["same"]


# ── polygonCentroid ──────────────────────────────────────────────────────────

def test_centroid_of_a_square_is_its_middle(tmp_path):
    out = _run(tmp_path, "console.log(JSON.stringify(WI.polygonCentroid([[0,0],[4,0],[4,4],[0,4]])));\n")
    assert out == [2, 2]


def test_centroid_of_empty_or_missing_points_is_null(tmp_path):
    out = _run(tmp_path, "console.log(JSON.stringify({a: WI.polygonCentroid([]), b: WI.polygonCentroid(null)}));\n")
    assert out == {"a": None, "b": None}


# ── fingerprintDistance ──────────────────────────────────────────────────────

def test_identical_fingerprints_have_zero_distance(tmp_path):
    out = _run(tmp_path, "console.log(JSON.stringify(WI.fingerprintDistance({s1:-60,s2:-70},{s1:-60,s2:-70})));\n")
    assert out == 0


def test_distance_matches_hand_computed_euclidean(tmp_path):
    # 3-4-5 triangle in dB-space.
    out = _run(tmp_path, "console.log(JSON.stringify(WI.fingerprintDistance({s1:0,s2:0},{s1:3,s2:4})));\n")
    assert out == pytest.approx(5.0)


def test_a_scanner_only_one_vector_has_counts_as_evidence_not_a_gap(tmp_path):
    """A scanner that only reaches one of two rooms is real separating
    evidence — treated as NO_SIGNAL (-120) on the side missing it, not
    skipped, so it still contributes to the distance."""
    out = _run(tmp_path, (
        "const d = WI.fingerprintDistance({s1: -60}, {s1: -60, s2: -50});\n"
        "console.log(JSON.stringify(d));\n"
    ))
    assert out == pytest.approx(70.0)  # |(-120) - (-50)| for s2


# ── roomDiscriminationScore ──────────────────────────────────────────────────

_ROOMS = {
    "Kitchen": {"pts": [[0, 0], [4, 0], [4, 4], [0, 4]]},
    "Living":  {"pts": [[4, 0], [8, 0], [8, 4], [4, 4]]},
    "Attic":   {"pts": [[20, 20], [24, 20], [24, 24], [20, 24]]},
}
_ADJ = {"Kitchen": ["Living"], "Living": ["Kitchen"]}


def test_score_is_zero_with_no_adjacency_data(tmp_path):
    out = _run(tmp_path, (
        f"const r = WI.roomDiscriminationScore({json.dumps(_ROOMS)}, {{}}, "
        "[{x_m:2,y_m:2,dz:0,source:'s1',floorDist:0}], []);\n"
        "console.log(JSON.stringify(r));\n"
    ))
    assert out == {"score": 0, "pairs": []}


def test_symmetric_adjacency_entries_are_not_double_counted(tmp_path):
    out = _run(tmp_path, (
        f"const r = WI.roomDiscriminationScore({json.dumps(_ROOMS)}, {json.dumps(_ADJ)}, "
        "[{x_m:2,y_m:2,dz:0,source:'s1',floorDist:0}], []);\n"
        "console.log(JSON.stringify(r.pairs.length));\n"
    ))
    assert out == 1, "Kitchen->Living and Living->Kitchen is one pair, not two"


def test_a_scanner_asymmetrically_placed_produces_a_positive_score(tmp_path):
    out = _run(tmp_path, (
        f"const r = WI.roomDiscriminationScore({json.dumps(_ROOMS)}, {json.dumps(_ADJ)}, "
        "[{x_m:2,y_m:2,dz:0,source:'s1',floorDist:0}], []);\n"
        "console.log(JSON.stringify(r.score));\n"
    ))
    assert out > 0


# ── whatIfDelta ──────────────────────────────────────────────────────────────

def test_a_ghost_scanner_inside_one_confusable_room_increases_the_score(tmp_path):
    """Two rooms near-equidistant from the one real scanner start nearly
    confusable (a small residual distance, not exactly 0, since their
    centroids aren't PERFECTLY equidistant). A ghost scanner placed inside
    ONE of them should make that room read much stronger while its
    neighbour still reads weak/no-signal from it — a clear, positive
    discrimination gain far bigger than that residual baseline."""
    out = _run(tmp_path, (
        f"const rooms = {json.dumps(_ROOMS)};\n"
        f"const adj = {json.dumps(_ADJ)};\n"
        "const real = [{x_m: 100, y_m: 100, dz: 0, source: 'far', floorDist: 0}];\n"
        "const ghost = {x_m: 2, y_m: 2, dz: 0, source: 'ghost', floorDist: 0};\n"
        "const out = WI.whatIfDelta(rooms, adj, real, ghost, []);\n"
        "console.log(JSON.stringify(out));\n"
    ))
    assert out["baseline"] < 1.0, out
    assert out["withGhost"] > out["baseline"] + 10, out
    assert out["delta"] == pytest.approx(out["withGhost"] - out["baseline"], abs=0.01)
    assert out["delta"] > 0


def test_the_baseline_never_includes_the_ghost_scanner(tmp_path):
    out = _run(tmp_path, (
        f"const rooms = {json.dumps(_ROOMS)};\n"
        f"const adj = {json.dumps(_ADJ)};\n"
        "const real = [{x_m: 2, y_m: 2, dz: 0, source: 's1', floorDist: 0}];\n"
        "const ghost = {x_m: 6, y_m: 2, dz: 0, source: 'ghost', floorDist: 0};\n"
        "const withoutGhost = WI.roomDiscriminationScore(rooms, adj, real, []).score;\n"
        "const out = WI.whatIfDelta(rooms, adj, real, ghost, []);\n"
        "console.log(JSON.stringify({baseline: out.baseline, direct: withoutGhost}));\n"
    ))
    assert out["baseline"] == out["direct"]
