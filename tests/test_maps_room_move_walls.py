"""Mapping → Rooms: moving a room carries the walls drawn on its outline (0.38.164).

Dragging a selected room moved its outline but left its Open (Loft) edge (and
any other barrier drawn on it) behind, so Live Aboard's railing floated where
the room used to be. The rigid move now carries every barrier of the floor
whose corners all lie on a moved room's outline, unless it also runs along a
room left in place (a wall the two share stays). The carried walls are saved
with the room by the same Save corrections (movedBarriers), and Discard puts
them back. tests run maps.js's own helpers under node on synthetic rooms.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_MAPS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "maps.js"
_NODE = shutil.which("node")

_JS = r"""
const src = require("fs").readFileSync(process.argv[1], "utf8");
const a = src.indexOf("function _geomOutlineDist("), b = src.indexOf("// BLE-vs-motion/occupancy fusion badge");
const F = new Function(src.slice(a, b) + "; return { _barriersOnRooms, _geomOutlineDist };")();
const rect = (x0, y0, x1, y1) => ({ type: "poly", points_m: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const A = rect(0, 0, 4, 3), B = rect(4.1, 0, 8, 3);
const bars = [
  { id: "open_north", material: "open", points_m: [[1, 0.02], [3, -0.03]] },   // on A's north edge
  { id: "shared", material: "brick", points_m: [[4.05, 0.5], [4.05, 2.5]] },   // between A and B
  { id: "b_door", material: "wood", points_m: [[5, 3], [6, 3]] },              // on B only
  { id: "free", material: "glass", points_m: [[1, 1.5], [3, 1.5]] },           // inside A, not on its outline
  { id: "circ", material: "open", points_m: [[10, 1], [10.6, 1.8]] },          // on the circle
];
const C = { type: "circle", cx_m: 11, cy_m: 1, r_m: 1 };
const ids = (r) => r.map(c => bars[c.i].id);
console.log(JSON.stringify({
  a: ids(F._barriersOnRooms(bars, [A], [B, C])),
  ab: ids(F._barriersOnRooms(bars, [A, B], [C])),
  c: ids(F._barriersOnRooms(bars, [C], [A, B])),
  none: ids(F._barriersOnRooms([], [A], [B])),
  pts: F._barriersOnRooms(bars, [A], [B])[0].pts,
}));
"""


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_a_room_move_carries_only_the_walls_on_its_own_outline() -> None:
    res = subprocess.run([_NODE, "-e", _JS, str(_MAPS)], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])
    assert got["a"] == ["open_north"]                    # the shared wall stays, B's door stays, a wall inside stays
    assert got["ab"] == ["open_north", "shared", "b_door"]   # both moved: the wall between them goes too
    assert got["c"] == ["circ"]
    assert got["none"] == []
    assert got["pts"] == [[1, 0.02], [3, -0.03]]         # its corners before the move, copied


def test_the_rigid_move_moves_them_and_saving_is_unchanged() -> None:
    src = _MAPS.read_text(encoding="utf-8")
    drag = src[src.index("// Selected: drag moves the whole selection rigidly"):src.index("svg.appendChild(elS);")]
    assert "const carried = _barriersOnRooms(barDraft, Object.values(snap)," in drag
    assert "barDraft[c.i].points_m = c.pts.map(" in drag and "if (barSetters[c.i]) barSetters[c.i]();" in drag
    # A corner drag (reshape) carries nothing: only the rigid move does.
    handle = src[src.index("const mkHandle = (idx, mx, my, title) => {"):src.index("handleEls.push({ room, idx, elDiv: h });")]
    assert "barDraft" not in handle
    # Saved by the existing Save corrections, matched by id with its links kept.
    assert "barrier: { ..._barById.get(b.id), floor_id: floorId, points_m: b.points_m }," in src
