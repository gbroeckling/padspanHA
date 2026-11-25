# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""How the robot's room location points are used: the owner's choice.

The owner, 2026-11-24: "there needs to be a choice, the robovac could wind up
being very accurate, the options need to be presented". Picked on the robot's
card before the first run (no default: Start waits for a pick), per house, in
the vacuum store (robot.use), changeable any time:

  full   "Count them like your own": every stop goes into calibration at full weight.
  fill   "Fill gaps, count them less": a stop goes in at FILL_WEIGHT, and only in
         a room where the owner's own points are fewer than FILL_OWN_MIN; the
         other stops stay in the run's record.
  none   "Find mistakes and Wi-Fi only": nothing goes into calibration.

Every stop is kept in its run's record (run["stops"]: where the robot stood,
when, and the tag's readings) whatever the choice, so Find mistakes reads them
(stops_as_points) and a change of choice can be applied to earlier runs: their
points come out and go back in by the new choice, as one step after a backup
(async_apply), and the choice before is kept so the card can put it back the
same way. A choice changed and not applied leaves calibration as it is.

A point's weight is the one calibration already has (calibration_store
_clean_point "weight"): k-NN weighs its neighbours by it, and the path-loss fit
behind the spatial model weighs its rows by it.
"""

from __future__ import annotations

import statistics

from .calibration_store import ROBOT_LABEL, is_owner_point
from .subzones import room_at

USE_FULL, USE_FILL, USE_NONE = "full", "fill", "none"
USES = (USE_FULL, USE_FILL, USE_NONE)
FILL_WEIGHT = 0.5            # a robot point counts half an owner's point
FILL_OWN_MIN = 3             # a room with this many of the owner's own points or more needs no filling
STOP_SAMPLES_KEPT = 40       # per receiver, in a run's record of a stop


def use_of(vs) -> str | None:
    u = ((vs.data.get("robot") or {}).get("use")) if vs is not None else None
    return u if u in USES else None


def own_per_room(points: list[dict], rooms: dict) -> dict[str, int]:
    """The owner's own calibration points in each room (its stored room, else
    where it stands among the rooms)."""
    out: dict[str, int] = {}
    for p in points or []:
        if not isinstance(p, dict) or not is_owner_point(p.get("label")):
            continue
        room = str(p.get("room") or "")
        if not room and isinstance(p.get("x_m"), (int, float)) and isinstance(p.get("y_m"), (int, float)):
            room = room_at(rooms or {}, str(p.get("floor_id") or ""), float(p["x_m"]), float(p["y_m"]))
        if room:
            out[room] = out.get(room, 0) + 1
    return out


def decide(use: str | None, room: str, own: dict[str, int]) -> float | None:
    """The weight a stop goes into calibration with, or None: it stays in the run's record."""
    if use == USE_FULL:
        return 1.0
    if use == USE_FILL and own.get(room, 0) < FILL_OWN_MIN:
        return FILL_WEIGHT
    return None


def label_of(run_id: str, room: str, tag_z_m: float) -> str:
    return f"{ROBOT_LABEL} {run_id} {room} (tag {tag_z_m:g} m above the floor)"


def stop_record(x_m: float, y_m: float, floor_id: str, room: str, ts_start: str, ts_end: str,
                readings: list[dict]) -> dict:
    return {"x_m": round(x_m, 3), "y_m": round(y_m, 3), "floor_id": floor_id, "room": room,
            "ts_start": ts_start, "ts_end": ts_end, "point_id": None, "weight": None,
            "readings": [{"source": r["source"], "rssi_samples": [round(v, 1) for v in r["rssi_samples"][-STOP_SAMPLES_KEPT:]]}
                         for r in readings]}


def stop_point(run_id: str, stop: dict, weight: float, tag: str, tag_z_m: float, dwell_s: float) -> dict:
    """A stop as calibration_store.async_add_point takes it."""
    return {"map_id": "", "x_frac": 0.5, "y_frac": 0.5, "x_m": stop["x_m"], "y_m": stop["y_m"],
            "floor_id": stop.get("floor_id") or "", "room": stop.get("room") or "",
            "label": label_of(run_id, stop.get("room") or "", tag_z_m), "device_id": tag,
            "collected_at": stop.get("ts_end") or stop.get("ts_start"), "duration_s": round(dwell_s),
            "weight": weight, "device_height_m": tag_z_m,
            "scanner_readings": [dict(r) for r in stop.get("readings") or []]}


def stops_as_points(runs: list[dict], in_calibration: set[str]) -> list[dict]:
    """The stops not in calibration (kept in their run's record), shaped as robot
    points for Find mistakes: the robot's exact spot and each receiver's median."""
    out = []
    for r in runs or []:
        if r.get("undone"):
            continue
        for i, s in enumerate(r.get("stops") or []):
            if s.get("point_id") and s["point_id"] in in_calibration:
                continue                                  # read from calibration itself
            reads = [{"source": x["source"], "name": x["source"], "mean_rssi": statistics.median(x["rssi_samples"])}
                     for x in s.get("readings") or [] if x.get("rssi_samples")]
            out.append({"id": f"{r.get('id')}:{i}", "label": f"{ROBOT_LABEL} {r.get('id')} {s.get('room') or ''}",
                        "x_m": s["x_m"], "y_m": s["y_m"], "floor_id": s.get("floor_id") or "", "scanner_readings": reads})
    return out


def plan_change(runs: list[dict], points: list[dict], rooms: dict, use: str | None) -> dict[str, int]:
    """What applying `use` to the earlier runs would do: points to add, to take
    out, to keep at another weight; runs without stop records (before 2026-11-24)
    stay as they are."""
    own = own_per_room(points, rooms)
    ids = {str(p.get("id")) for p in points}
    weight_of = {str(p.get("id")): float(p.get("weight") or 1.0) for p in points}
    add = remove = reweight = old = 0
    for r in runs or []:
        if r.get("undone") or r.get("state") == "running":
            continue
        if not r.get("stops"):
            old += 1 if r.get("points") else 0
            continue
        for s in r["stops"]:
            w = decide(use, s.get("room") or "", own)
            now = s.get("point_id") if s.get("point_id") in ids else None
            if now and w is None:
                remove += 1
            elif not now and w is not None:
                add += 1
            elif now and abs(weight_of.get(now, 1.0) - w) > 1e-6:
                reweight += 1
    return {"add": add, "remove": remove, "reweight": reweight, "old_runs": old}


async def async_apply(cal, runs: list[dict], rooms: dict, use: str | None, tag_z_m: float, dwell_s: float) -> dict[str, int]:
    """Earlier runs by `use`: each run's points out, then back in by the choice,
    from its stops. Only robot points of those runs are touched (each still
    labelled as its run's). The caller backs calibration up first."""
    points = cal.list_points()
    own = own_per_room(points, rooms)
    ids = {str(p.get("id")): p for p in points}
    out = {"added": 0, "removed": 0}
    gone: set[str] = set()
    for r in runs or []:
        if r.get("undone") or r.get("state") == "running" or not r.get("stops"):
            continue
        prefix = f"{ROBOT_LABEL} {r.get('id')} "
        for s in r["stops"]:
            pid = s.get("point_id")
            if pid and pid in ids and str(ids[pid].get("label") or "").startswith(prefix):
                gone.add(pid)
    removed = await cal.async_delete_points(gone) if gone else 0
    out["removed"] = removed
    for r in runs or []:
        if r.get("undone") or r.get("state") == "running" or not r.get("stops"):
            continue
        tag = str(r.get("tag") or "")
        r["points"] = [p for p in (r.get("points") or []) if p not in gone]
        for s in r["stops"]:
            if s.get("point_id") in gone:
                s["point_id"], s["weight"] = None, None
            w = decide(use, s.get("room") or "", own)
            if w is None or s.get("point_id"):
                continue
            saved = await cal.async_add_point(stop_point(str(r.get("id")), s, w, tag, tag_z_m, dwell_s))
            s["point_id"], s["weight"] = saved["id"], w
            r["points"].append(saved["id"])
            out["added"] += 1
        r["added"] = len(r["points"])
    return out
