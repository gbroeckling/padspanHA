# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Where something known only by its room stands in it: one rule
(views/room_spot.js) for the Overview's house map, Live Aboard and the flat
Atlas (live_aboard_tracked.js) and Traceback's playback (house_activity.js).

The Overview drew every device it knew only by its room at the mean of the
room's corners: in an L-shaped room that is in the notch, outside the room,
and the followed ones all sat on that one point. Live Aboard already put its
people at a point inside the room and nudged them apart; that rule moved to
room_spot.js and the Overview uses it.

tests/js/overview_room_spots.mjs renders the real Overview with an L-shaped
room, three followed devices and two named ones with a room and no position,
and one the server placed at the room's middle: every room-only marker stands
inside the L as drawn, no two on one point, none on the placed one; a
Traceback record known only by its room stands inside the L too; and the
rule itself puts an L's middle inside it and five there inside, apart.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def ov() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "overview_room_spots.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["drawn:", "inside:", "apart:", "the old spot:", "playback:", "rule:"])
def test_the_overview_harness_covers_each_part(ov, prefix) -> None:
    got = {k: v for k, v in ov["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(ov['cases'])}"
    bad = [f for f in ov["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_overview_case_passes(ov) -> None:
    assert not ov["failures"], json.dumps(ov["failures"][:6], indent=2, ensure_ascii=False)


def test_one_rule_for_every_view_that_places_by_room() -> None:
    want = "await import(`./room_spot.js${"
    users = sorted(p.name for p in _VIEWS.glob("*.js") if want in p.read_text(encoding="utf-8"))
    assert users == ["house_activity.js", "live_aboard_tracked.js", "overview.js"], users
    ov_src = (_VIEWS / "overview.js").read_text(encoding="utf-8")
    # The middle and the spread are room_spot.js's; the old corner mean and pixel spiral are gone.
    assert "const m = middleOf(r.pts);" in ov_src and "const at = spotIn(mid, _roomStands);" in ov_src
    assert "[bx,by] = _roomSpot(o.room);" in ov_src and "const [ix,iy] = _roomSpot(obj.room);" in ov_src
    assert "_roomObjCount" not in ov_src and "roomIsoPos[r.room] = iso(cx, cy, r.z);" not in ov_src
    tr = (_VIEWS / "live_aboard_tracked.js").read_text(encoding="utf-8")
    assert "function deepest(" not in tr and "function spotIn(" not in tr, "one copy, in room_spot.js"
