"""Door/window barrier project, step 3: the wall-section-split geometry.

docs/IDEA_DOOR_WINDOW_BARRIERS.md's plan authors a door by carving a short
section out of an existing wall's own polyline, at EDIT time — not by
inventing a new object type, and not by computing a gap live on every
render. `nearestPointOnPolyline`/`splitPolylineAtTwoPositions`
(stack_transform.js) are the pure geometry behind that carving; this file is
the "pure-function test for the wall-gap-splitting geometry" the plan's own
"What done looks like" section calls for.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
          / "www" / "padspan-ha" / "views")
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(tmp_path: Path, script: str) -> dict:
    src = (_VIEWS / "stack_transform.js").read_text(encoding="utf-8")
    (tmp_path / "stack_transform.mjs").write_text(src, encoding="utf-8")
    (tmp_path / "run.mjs").write_text(
        "import * as S from './stack_transform.mjs';\nconst out={};\n"
        + script + "\nconsole.log(JSON.stringify(out));\n", encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# ── nearestPointOnPolyline ───────────────────────────────────────────────────

def test_snaps_a_click_onto_the_nearest_segment(tmp_path):
    """A straight 2-point wall from (0,0) to (10,0): a click above the
    midpoint snaps straight down onto the line, at the right segment/t."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0]];
out.mid = S.nearestPointOnPolyline(pts, 5, 3);
out.nearStart = S.nearestPointOnPolyline(pts, 0.2, 1);
out.pastEnd = S.nearestPointOnPolyline(pts, 15, 0);
""")
    mid = out["mid"]
    assert mid["segIdx"] == 0 and abs(mid["t"] - 0.5) < 1e-9, mid
    assert abs(mid["x"] - 5) < 1e-9 and abs(mid["y"] - 0) < 1e-9, mid
    # Clamped to the segment, never extrapolated past an endpoint.
    assert out["pastEnd"]["t"] == 1.0 and out["pastEnd"]["x"] == 10, out["pastEnd"]
    assert out["nearStart"]["t"] > 0, "a click just past the start must not clamp to t=0"


def test_picks_the_correct_segment_on_a_multi_point_wall(tmp_path):
    """An L-shaped wall — (0,0)->(10,0)->(10,10) — must snap onto whichever
    of its two segments is actually closest, not always the first."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0],[10,10]];
out.onFirstLeg = S.nearestPointOnPolyline(pts, 3, 1);
out.onSecondLeg = S.nearestPointOnPolyline(pts, 11, 5);
""")
    assert out["onFirstLeg"]["segIdx"] == 0, out["onFirstLeg"]
    assert out["onSecondLeg"]["segIdx"] == 1, out["onSecondLeg"]


def test_a_zero_length_segment_is_skipped_not_divided_by_zero(tmp_path):
    """Two accidentally-duplicated points must never NaN-poison the search —
    the next real segment still wins."""
    out = _run(tmp_path, """
const pts = [[0,0],[0,0],[10,0]];
out.r = S.nearestPointOnPolyline(pts, 5, 1);
""")
    r = out["r"]
    assert r["segIdx"] == 1 and abs(r["x"] - 5) < 1e-9, r
    assert all(v == v for v in (r["x"], r["y"], r["t"])), "NaN leaked through a zero-length segment"


# ── splitPolylineAtTwoPositions ──────────────────────────────────────────────

def test_a_door_in_the_middle_leaves_two_real_remaining_pieces(tmp_path):
    """A straight 10m wall, door from x=4 to x=6: both remainders are real,
    non-degenerate walls (2 points each), and the door section is exactly
    the 2m carved out — this is the ordinary, most common case."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0]];
const a = S.nearestPointOnPolyline(pts, 4, 0);
const b = S.nearestPointOnPolyline(pts, 6, 0);
out.r = S.splitPolylineAtTwoPositions(pts, a, b);
""")
    r = out["r"]
    assert r["before"] == [[0, 0], [4, 0]], r
    assert r["middle"] == [[4, 0], [6, 0]], r
    assert r["after"] == [[6, 0], [10, 0]], r


def test_order_of_the_two_clicks_does_not_matter(tmp_path):
    """Clicking the far side of the door first must produce the IDENTICAL
    split — arc-length ordering, not click order, decides before/after."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0]];
const a = S.nearestPointOnPolyline(pts, 4, 0);
const b = S.nearestPointOnPolyline(pts, 6, 0);
out.forward = S.splitPolylineAtTwoPositions(pts, a, b);
out.backward = S.splitPolylineAtTwoPositions(pts, b, a);
""")
    assert out["forward"] == out["backward"], out


def test_a_door_at_the_very_start_leaves_no_before_piece(tmp_path):
    """Door from x=0 to x=3 on a 10m wall: nothing remains before it — the
    original wall is now ONLY the after-piece, no degenerate empty wall."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0]];
const a = S.nearestPointOnPolyline(pts, 0, 0);
const b = S.nearestPointOnPolyline(pts, 3, 0);
out.r = S.splitPolylineAtTwoPositions(pts, a, b);
""")
    r = out["r"]
    assert r["before"] is None, r
    assert r["middle"] == [[0, 0], [3, 0]], r
    assert r["after"] == [[3, 0], [10, 0]], r


def test_a_door_at_the_very_end_leaves_no_after_piece(tmp_path):
    out = _run(tmp_path, """
const pts = [[0,0],[10,0]];
const a = S.nearestPointOnPolyline(pts, 7, 0);
const b = S.nearestPointOnPolyline(pts, 10, 0);
out.r = S.splitPolylineAtTwoPositions(pts, a, b);
""")
    r = out["r"]
    assert r["after"] is None, r
    assert r["middle"] == [[7, 0], [10, 0]], r
    assert r["before"] == [[0, 0], [7, 0]], r


def test_a_door_spanning_the_whole_wall_leaves_neither_remaining_piece(tmp_path):
    """The whole original wall becomes the door — both remainders are null,
    never a one-point 'wall' left behind."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0]];
const a = S.nearestPointOnPolyline(pts, 0, 0);
const b = S.nearestPointOnPolyline(pts, 10, 0);
out.r = S.splitPolylineAtTwoPositions(pts, a, b);
""")
    r = out["r"]
    assert r["before"] is None and r["after"] is None, r
    assert r["middle"] == [[0, 0], [10, 0]], r


def test_the_same_point_twice_is_rejected_as_a_zero_width_door(tmp_path):
    """The caller's job is to prevent this before it reaches the split, but
    the pure function itself must never fabricate a fake door out of a
    single point — middle is null too, the same "nothing usable" signal
    before/after already give."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0]];
const a = S.nearestPointOnPolyline(pts, 5, 0);
out.r = S.splitPolylineAtTwoPositions(pts, a, a);
""")
    assert out["r"]["middle"] is None, out["r"]


def test_a_multi_point_wall_keeps_its_own_interior_vertices(tmp_path):
    """An L-shaped wall, door carved entirely within the FIRST leg: the
    'after' piece must still carry the corner vertex and the whole second
    leg, not just a straight line to the far end."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0],[10,10]];
const a = S.nearestPointOnPolyline(pts, 4, 0);
const b = S.nearestPointOnPolyline(pts, 6, 0);
out.r = S.splitPolylineAtTwoPositions(pts, a, b);
""")
    r = out["r"]
    assert r["before"] == [[0, 0], [4, 0]], r
    assert r["middle"] == [[4, 0], [6, 0]], r
    assert r["after"] == [[6, 0], [10, 0], [10, 10]], r


def test_a_door_straddling_the_corner_of_an_l_shaped_wall(tmp_path):
    """The section crosses the wall's own corner vertex — the middle piece
    must include that vertex, not cut a straight diagonal across it."""
    out = _run(tmp_path, """
const pts = [[0,0],[10,0],[10,10]];
const a = S.nearestPointOnPolyline(pts, 8, 0);
const b = S.nearestPointOnPolyline(pts, 10, 3);
out.r = S.splitPolylineAtTwoPositions(pts, a, b);
""")
    r = out["r"]
    assert r["before"] == [[0, 0], [8, 0]], r
    assert r["middle"] == [[8, 0], [10, 0], [10, 3]], r
    assert r["after"] == [[10, 3], [10, 10]], r


def test_fabric_world_barriers_carries_linked_entity_id_through(tmp_path):
    """A door segment's linked_entity_id must survive the SAME projection
    every other barrier field (material, attenuation_dbm) already does —
    opaque passthrough, never a new parallel shape. A plain wall with no
    linked_entity_id reads back null, never a missing key or empty string."""
    out = _run(tmp_path, """
const model = {
  world_gauge: {m_per_unit: 1, source_map_id: 'm1'},
  rf_barriers_m: [
    {id: 'w1', name: 'Wall', floor_id: 'main', material: 'metal', attenuation_dbm: 12,
     points_m: [[0,0],[5,0]]},
    {id: 'd1', name: 'Door', floor_id: 'main', material: 'metal', attenuation_dbm: 12,
     points_m: [[5,0],[6,0]], linked_entity_id: 'binary_sensor.front_door'},
  ],
};
const bars = S.fabricWorldBarriers(model, 'main');
out.wall = bars.find(b => b.id === 'w1');
out.door = bars.find(b => b.id === 'd1');
""")
    assert out["wall"]["linked_entity_id"] is None, out["wall"]
    assert out["door"]["linked_entity_id"] == "binary_sensor.front_door", out["door"]
