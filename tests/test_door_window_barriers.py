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
    for name in ("stack_transform", "wall_geom"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        src = src.replace('"./wall_geom.js"', '"./wall_geom.mjs"')
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
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


# ── The Rooms-tab editing UI (maps.js) — source-structure tests ─────────────
# _commitDoorMark/_cancelDoorMark and the click-handler/panel wiring around
# them are closures inside _roomsTab, the same reason test_lights_transform.py
# checks _wireTransformHandles this way rather than fully executing it: no
# harness here builds the whole interactive DOM + a realistic mocked
# ctx.actions.callWS cheaply, and the geometry underneath (the actual hard
# part) is already execution-tested above. What is worth pinning statically
# is the id-preservation strategy and the metres conversion — a wrong id
# choice would orphan whatever else references the original barrier, and a
# missed toMetres call would write photo-fractional numbers into the fabric.

_MAPS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
         / "www" / "padspan-ha" / "views" / "maps.js")


def _commit_block() -> str:
    src = _MAPS.read_text(encoding="utf-8", errors="replace")
    block = src[src.index("const _commitDoorMark"):]
    return block[:block.index("const _cancelDoorMark")]


def test_maps_js_imports_the_split_geometry_from_stack_transform():
    src = _MAPS.read_text(encoding="utf-8", errors="replace")
    assert "nearestPointOnPolyline" in src and "splitPolylineAtTwoPositions" in src, (
        "the Rooms-tab editor no longer imports the wall-split geometry it needs"
    )


def test_a_click_while_marking_a_door_snaps_onto_that_walls_own_line():
    src = _MAPS.read_text(encoding="utf-8", errors="replace")
    block = src[src.index('if(ctx.state.maps._doorMarkBarrierId){'):]
    block = block[:block.index("// Measure mode")]
    assert "nearestPointOnPolyline(bar.points" in block, (
        "a door-marking click must snap onto the selected wall's own polyline, "
        "not record the raw cursor position"
    )
    assert "_doorMarkPts.length < 2" in block, (
        "the click handler must stop collecting points after 2 — a third click "
        "must not silently extend or restart the selection"
    )


def test_the_door_segment_keeps_the_original_id_only_when_nothing_survives():
    """The one invariant most worth pinning: whichever real remaining wall
    piece exists first (before, then after) keeps the ORIGINAL barrier's id
    — the door only inherits it when the section spans the whole wall."""
    block = _commit_block()
    before_branch = block[block.index("if (split.before)"):block.index("} else if (split.after)")]
    after_branch = block[block.index("} else if (split.after)"):block.index("} else {")]
    neither_branch = block[block.index("} else {", block.index("} else if (split.after)")):]

    # split.before real: the ORIGINAL id is reused for the "before" remainder...
    assert "id: barId" in before_branch and "points_m: toMetres(split.before)" in before_branch, before_branch
    # ...and the door gets a NEW id from its own fabric_rf_barrier_set reply.
    assert "doorId = r && r.barrier ? r.barrier.id : null" in before_branch, before_branch

    # split.before null, split.after real: same reasoning, mirrored.
    assert "id: barId" in after_branch and "points_m: toMetres(split.after)" in after_branch, after_branch
    assert "doorId = r && r.barrier ? r.barrier.id : null" in after_branch, after_branch

    # Neither survives: the ORIGINAL id becomes the door itself.
    assert "id: barId" in neither_branch and "points_m: toMetres(split.middle)" in neither_branch, neither_branch
    assert "doorId = barId" in neither_branch, neither_branch


def test_every_written_barrier_carries_its_points_through_toMetres():
    """A photo-fractional number written straight into the fabric (skipping
    the metres conversion) would silently corrupt the wall's real-world
    position — every setBarrier() call in this function must convert."""
    block = _commit_block()
    set_calls = [c for c in block.split("setBarrier({")[1:]]
    assert len(set_calls) >= 3, "expected before/door/after style calls, found fewer"
    for c in set_calls:
        head = c[:c.index("})")]
        assert "toMetres(" in head, ("a setBarrier call writes points_m without converting "
                                      "through toMetres first", head)


def test_the_door_segment_alone_carries_the_linked_entity_id():
    """Only the door/window section itself should ever carry
    linked_entity_id — a plain wall remainder must never accidentally
    inherit it from the barrier it was split out of."""
    block = _commit_block()
    door_calls = [c for c in block.split("setBarrier({")[1:] if "linked_entity_id" in c[:c.index("})")]]
    assert len(door_calls) == 3, (
        "expected exactly the 3 door-creating branches (before-real, after-real, "
        "neither-real) to carry linked_entity_id, found a different count", block
    )
    for c in door_calls:
        head = c[:c.index("})")]
        assert "points_m: toMetres(split.middle)" in head, (
            "linked_entity_id must only ever be written on the door SECTION "
            "(split.middle), never on a before/after remainder", head
        )


def test_cancel_clears_both_pieces_of_door_marking_state():
    src = _MAPS.read_text(encoding="utf-8", errors="replace")
    block = src[src.index("const _cancelDoorMark"):]
    block = block[:block.index("\n  };") + 5]
    assert "_doorMarkBarrierId = null" in block and "_doorMarkPts = null" in block, block


def test_the_door_button_is_withheld_once_a_wall_is_already_a_door():
    """A barrier row only offers "Door" when it has no linked_entity_id yet
    — marking a second door out of an already-carved section is confusing,
    not harmful, so the button is hidden rather than merely discouraged."""
    src = _MAPS.read_text(encoding="utf-8", errors="replace")
    idx = src.index('doorBtn.title = "Mark a door/window on this wall"')
    gate = src[:idx][-400:]
    assert "if(!bar.linked_entity_id){" in gate, gate


# ── Mapping → Lights: doors take no part in point-placement ─────────────────
# Garry, 2026-09-08, live on the deployed map: "The placement in mapping and
# lights is not making any sense, and is not consistant... Not sure what you
# created here." A door/window's real position is a section of wall — this
# section pins that _lightsTab's placement bookkeeping (the placed/unplaced
# checklist, the bulk queue, Spread, Accept-room-centres) excludes doors,
# and that the Map column's link status/jump wiring exists and is gated the
# same as the point-placement tools it replaces for that row.

def _lights_tab_block() -> str:
    src = _MAPS.read_text(encoding="utf-8", errors="replace")
    block = src[src.index("function _lightsTab(ctx, maps, active) {"):]
    return block[:block.index("\nfunction ", 1)]


def test_placement_bookkeeping_excludes_doors():
    block = _lights_tab_block()
    assert "const placeableLights = lights.filter(l => !l.isDoor);" in block, block
    for stat in ("nPlaced", "nApprox", "nUnplaced"):
        line = next(l for l in block.splitlines() if l.strip().startswith(f"const {stat} ="))
        assert "placeableLights" in line, (f"{stat} must be computed from placeableLights, not lights", line)
    # Room ASSIGNMENT (HA area) is a real, separate concern for a door too —
    # unlike point-placement, it is not excluded.
    noroom_line = next(l for l in block.splitlines() if l.strip().startswith("const nNoRoom ="))
    assert "lights.filter" in noroom_line and "placeableLights" not in noroom_line, noroom_line
    # The bulk tools (queue-all, spread, accept-centres) must draw from the
    # same excluded set — a door surfacing in any of these is the exact bug.
    for needle in (
        "mapState._placeQueue = placeableLights.filter(l => !placements[l.entity_id]).map(l => l.entity_id);",
        "roomsWithUnplaced = [...new Set(placeableLights.filter(l => l.area_name && !placements[l.entity_id])",
        "eids = placeableLights.filter(l => l.area_name === room && !placements[l.entity_id])",
        "eids = placeableLights.filter(l => l.area_name && !placements[l.entity_id])",
    ):
        assert needle in block, f"missing or reverted to `lights`: {needle!r}"


def test_configure_door_arms_the_on_map_circle_tool():
    """Garry, 2026-09-09, from scratch after the wall-then-two-points picker
    turned out "impossible to use" and "was never visible": onConfigureDoor
    now arms mapState._doorCircleEid — the first map click drops a circle
    (maps.js's SVG click handler / _doorCircleFloorForClick), dragging it
    moves/resizes it (_wireDoorCircle), and Done cuts the wall it matches
    (_commitDoorCircle, bestCircleWall) — see
    tests/test_lights_door_circle.py for the actual behaviour."""
    block = _lights_tab_block()
    idx = block.index("onConfigureDoor:")
    snippet = block[idx:block.index("\n    }", idx) + 8]
    assert "mapState._doorCircleEid = l ? l.entity_id : null" in snippet, snippet
    assert "mapState._doorCircleM = null" in snippet, snippet
    assert 'ctx.actions.setMapsTab("rooms")' not in snippet, (
        "onConfigureDoor must not send anyone away to Rooms any more"
    )
    # Same gate as onPlaceRow — a door's own configure entry point only
    # exists where point-placement tools exist at all (the paid, editing
    # builder), never in Preview or below Pro.
    assert "paid && !preview ?" in snippet, snippet


def test_on_door_circle_done_commits_and_is_gated_the_same_way():
    block = _lights_tab_block()
    idx = block.index("onDoorCircleDone:")
    snippet = block[idx:idx + 120]
    assert "_commitDoorCircle(ctx, mapState)" in snippet, snippet
    assert "paid && !preview ?" in snippet, snippet


def test_door_linked_ids_are_read_from_rf_barriers_m():
    block = _lights_tab_block()
    idx = block.index("doorLinkedIds:")
    snippet = block[idx:idx + 160]
    assert "ctx.state.model?.rf_barriers_m" in snippet, snippet
    assert "b.linked_entity_id" in snippet, snippet


# ── circlePolylineIntersections — the opening tool's actual geometry ────────
# Garry, 2026-09-09: place a circle over the opening, size/drag it, click
# Done — "the two places the line intersects with the room line... will be
# the edges of the opening. The part in the circle will be the opening."

def test_a_straight_wall_through_the_middle_of_the_circle_crosses_twice(tmp_path):
    out = _run(tmp_path, """
const pts = [[0, 0], [10, 0]];
out.hits = S.circlePolylineIntersections(pts, 5, 0, 2);
""")
    hits = out["hits"]
    assert len(hits) == 2, hits
    xs = sorted(h["x"] for h in hits)
    assert abs(xs[0] - 3) < 1e-6 and abs(xs[1] - 7) < 1e-6, hits
    assert all(abs(h["y"]) < 1e-6 for h in hits), hits


def test_a_wall_entirely_inside_the_circle_has_both_endpoints_as_the_edges(tmp_path):
    """A short wall fully swallowed by the circle never crosses its
    boundary at all — the opening must still resolve to the wall's own
    two ends, not fail with nothing found."""
    out = _run(tmp_path, """
const pts = [[4, 0], [6, 0]];
out.hits = S.circlePolylineIntersections(pts, 5, 0, 10);
""")
    hits = out["hits"]
    assert len(hits) == 2, hits
    xs = sorted(h["x"] for h in hits)
    assert abs(xs[0] - 4) < 1e-6 and abs(xs[1] - 6) < 1e-6, hits


def test_a_wall_that_ends_inside_the_circle_gives_one_crossing_and_the_endpoint(tmp_path):
    out = _run(tmp_path, """
const pts = [[-10, 0], [3, 0]];   // runs in from the left, ends well inside r=5 at x=5
out.hits = S.circlePolylineIntersections(pts, 5, 0, 5);
""")
    hits = out["hits"]
    assert len(hits) == 2, hits
    xs = sorted(h["x"] for h in hits)
    assert abs(xs[0] - 0) < 1e-6, hits    # the crossing, entering the circle at x=0
    assert abs(xs[1] - 3) < 1e-6, hits    # the wall's own end, inside the circle


def test_a_wall_nowhere_near_the_circle_has_no_hits(tmp_path):
    out = _run(tmp_path, """
const pts = [[100, 100], [110, 100]];
out.hits = S.circlePolylineIntersections(pts, 0, 0, 5);
""")
    assert out["hits"] == [], out["hits"]


def test_a_multi_point_wall_crossing_twice_takes_the_two_extreme_hits(tmp_path):
    """An L-shaped wall whose corner sits INSIDE the circle, both ends
    OUTSIDE: each leg crosses the boundary once, and the corner itself is
    also a real (inside) hit — three positions in total, which is correct,
    not a bug. What actually matters for the caller (which only ever takes
    the first and last by arc-length) is that those two extremes are the
    genuine boundary crossings on each leg, not the corner."""
    out = _run(tmp_path, """
const pts = [[-10, 3], [0, 3], [0, -10]];   // corner (0,3): dist 3, inside r=5
out.hits = S.circlePolylineIntersections(pts, 0, 0, 5);
""")
    hits = out["hits"]
    assert len(hits) == 3, hits
    first, last = hits[0], hits[-1]
    assert first["segIdx"] == 0 and last["segIdx"] == 1, hits
    # Both extremes lie exactly on the circle (distance r=5 from its centre,
    # 0,0) — the corner, checked separately below, is the one hit that does not.
    assert abs(first["x"] ** 2 + first["y"] ** 2 - 25) < 1e-6, hits
    assert abs(last["x"] ** 2 + last["y"] ** 2 - 25) < 1e-6, hits
    # The corner is a genuine hit too — inside the circle, between the two
    # boundary crossings by arc-length — but is neither extreme.
    assert hits[1]["x"] == 0 and hits[1]["y"] == 3, hits


def test_hits_feed_splitpolylineattwopositions_directly(tmp_path):
    """The whole point: no conversion needed between the two functions."""
    out = _run(tmp_path, """
const pts = [[0, 0], [10, 0]];
const hits = S.circlePolylineIntersections(pts, 5, 0, 2);
const split = S.splitPolylineAtTwoPositions(pts, hits[0], hits[1]);
out.before = split.before; out.middle = split.middle; out.after = split.after;
""")
    assert out["before"] == [[0, 0], [3, 0]], out
    assert out["middle"] == [[3, 0], [7, 0]], out
    assert out["after"] == [[7, 0], [10, 0]], out


# ── bestCircleWall — the ONE "which wall does this circle match" function,
# shared by the live on-map preview (iso_lights.js) and the commit handler
# (maps.js's _commitDoorCircle), so they can never disagree.

def test_best_circle_wall_picks_the_nearest_among_several(tmp_path):
    out = _run(tmp_path, """
const walls = [
  { id: 'far', points_m: [[100, 100], [110, 100]] },
  { id: 'near', points_m: [[0, 0], [10, 0]] },
  { id: 'linked', linked_entity_id: 'binary_sensor.already', points_m: [[4, -1], [6, -1]] },
];
out.match = S.bestCircleWall(walls, 5, 0, 2);
""")
    m = out["match"]
    assert m is not None, out
    assert m["bar"]["id"] == "near", m
    assert len(m["hits"]) == 2, m


def test_best_circle_wall_skips_already_linked_walls(tmp_path):
    """An already-linked barrier is a door, not a wall — never a candidate
    for a second circle to match, even when it is the closest thing."""
    out = _run(tmp_path, """
const walls = [
  { id: 'door', linked_entity_id: 'binary_sensor.already', points_m: [[0, 0], [10, 0]] },
];
out.match = S.bestCircleWall(walls, 5, 0, 2);
""")
    assert out["match"] is None, out["match"]


def test_best_circle_wall_returns_null_when_nothing_crosses(tmp_path):
    out = _run(tmp_path, """
const walls = [{ id: 'w1', points_m: [[100, 100], [110, 100]] }];
out.match = S.bestCircleWall(walls, 0, 0, 2);
""")
    assert out["match"] is None, out["match"]
