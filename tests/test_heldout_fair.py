# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The held-out score counts only what it can test (heldout.py, 2026-11-23).

A real house read 4 % rooms right where 32 of its 49 room spots could never
be right: rooms calibrated at one spot, labels that disagree with the drawn
room, a sample that took turns by room, and one-receiver spots that live
tracking never asks k-NN about. What must hold now:
  A. a room with nothing left once its spot is held out is untestable, not wrong;
  B. a spot's true room is the room drawn where it stands (its label only
     without a drawing), and disagreeing labels are counted;
  C. past the cap, each room gets places in proportion to its spots;
  D. a spot heard by fewer than MIN_LIVE_SCANNERS receivers is not tested.
"""

from __future__ import annotations

import math

from custom_components.padspan_ha import heldout as H

SCANNERS = {"s_a": (1.0, 1.0), "s_b": (9.0, 1.0), "s_c": (5.0, 8.0), "s_d": (1.0, 8.0)}
ROOMS = {"West": (0.0, 0.0, 4.0, 10.0), "East": (4.0, 0.0, 10.0, 10.0)}


def room_at(x: float, y: float, fl: str) -> str:
    for name, (x0, y0, x1, y1) in ROOMS.items():
        if x0 <= x < x1 and y0 <= y < y1:
            return name
    return ""


def _pt(x, y, label, n=0, scanners=None, dev=None):
    sc = scanners or SCANNERS
    rd = [{"source": s, "mean_rssi": round(-40 - 22 * math.log10(max(0.5, math.hypot(x - sx, y - sy))) - 0.3 * n, 2)}
          for s, (sx, sy) in sc.items()]
    p = {"id": f"p{x}_{y}_{n}", "x_m": x, "y_m": y, "floor_id": "f", "room": label, "label": label, "scanner_readings": rd}
    if dev:
        p.update(label=f"[auto] {dev}", device_id=dev)
    return p


def _spread(room, x0, x1, n):
    """n spots spread across a room, 2 m apart."""
    out = []
    for i in range(n):
        x = x0 + 0.5 + (i % 3) * 1.6
        y = 1.0 + (i // 3) * 2.0
        out.append(_pt(round(x, 2), round(y, 2), room, i))
    return out


def test_a_room_calibrated_at_one_spot_is_untestable_not_wrong():
    # West: one tight cluster (all within 1.5 m of each other). East: spread.
    west = [_pt(2.0, 5.0 + 0.1 * i, "West", i) for i in range(6)]
    east = _spread("East", 4.5, 9.5, 9)
    res = H.evaluate(west + east, room_at=room_at)
    assert res["untestable_rooms"] == ["West"]
    assert res["knn"]["room_spots"] == 9          # only East's spots are room spots
    assert res["knn"]["spots"] == 15              # West's still count for the position error


def test_the_true_room_is_the_room_drawn_where_it_stands():
    pts = _spread("West", 0.0, 4.0, 6) + _spread("East", 4.5, 9.5, 9)
    pts.append(_pt(7.0, 3.0, "West", 99))         # labelled West, standing in East
    res = H.evaluate(pts, room_at=room_at)
    assert res["label_disagrees"] == 1
    # No drawing at all: the label is the truth, and nothing disagrees.
    res2 = H.evaluate(pts, room_at=None)
    assert res2["label_disagrees"] == 0


def test_a_one_receiver_spot_is_not_tested():
    pts = _spread("West", 0.0, 4.0, 6) + _spread("East", 4.5, 9.5, 9)
    base = H.evaluate(pts, room_at=room_at)
    lone = _pt(8.0, 9.0, "East", 50, scanners={"s_b": SCANNERS["s_b"]})
    res = H.evaluate(pts + [lone], room_at=room_at)
    assert res["knn"]["spots"] == base["knn"]["spots"]
    assert res["knn"]["room_spots"] == base["knn"]["room_spots"]


def test_past_the_cap_each_room_gets_places_in_proportion():
    pts = [{"floor_id": "f", "room": "Big"} for _ in range(200)]
    for r in range(10):
        pts += [{"floor_id": "f", "room": f"Small{r}"} for _ in range(3)]
    spots = list(range(len(pts)))
    picked = H.sample_spots(pts, spots, 60)
    assert len(picked) == 60
    by = {}
    for i in picked:
        by[pts[i]["room"]] = by.get(pts[i]["room"], 0) + 1
    assert all(by.get(f"Small{r}", 0) >= 1 for r in range(10))     # every room tested
    assert by["Big"] >= 40                                          # ~87 % of the spots, not 1 in 11 turns
    assert picked == H.sample_spots(pts, spots, 60)                 # the same every run
    # More rooms than places: still exactly the cap, the biggest giving way.
    many = [{"floor_id": "f", "room": f"R{r}"} for r in range(80)]
    assert len(H.sample_spots(many, list(range(80)), 60)) == 60


def test_the_report_carries_counts_only():
    res = {"knn": {"rooms_right_pc": 30, "median_error_m": 3.0}, "spatial": None, "better": None,
           "untestable_rooms": ["Pantry", "Garage", "Shed"], "label_disagrees": 9}
    b = H.report_buckets(res)
    assert b["untest"] == "3_5" and b["disagree"] == "6_10"
    assert "Pantry" not in str(b)
