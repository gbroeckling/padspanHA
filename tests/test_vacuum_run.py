"""Room location runs with the robot vacuum (vacuum_run.py, ws_vacuum.py's robot and run commands).

2026-11-24, the owner: the robot as an optional room-location tool, its points
"Added, with undo". What matters most here: calibration is backed up before a
run moves the robot, a run's points are exactly the ones undo takes away (the
owner's own points never), nothing is added where the tag was heard too
little, and the robot is sent home whatever way the run ends.

The robot is a fake Valetudo: vacuum_run.robot_call stubbed by a small class
that answers the four REST paths the way Valetudo 2026.10.0 does (and, for
robot_call itself, a real aiohttp server on this machine).
"""

from __future__ import annotations

import asyncio
import base64
import math
import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.padspan_ha import vacuum_import as vi
from custom_components.padspan_ha import vacuum_run as vr
from custom_components.padspan_ha import ws_backup
from custom_components.padspan_ha import ws_vacuum as wsv
from custom_components.padspan_ha.const import DATA_CALIBRATION, DOMAIN

CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
PS = 5                                     # cm per map pixel


# ── a small house, drawn as Valetudo draws it ───────────────────────────────

def _rect(x0, y0, x1, y1):
    out = []
    for y in range(y0, y1 + 1):
        out += [x0, y, x1 - x0 + 1]
    return out


def _house() -> dict:
    """Two 4 x 4 m rooms side by side with a door between them, a 1.2 x 1.0 m
    pantry and a closet too small for any spot, walls round all of them."""
    walls = []
    for x0, y0, x1, y1 in ((0, 0, 161, 0), (0, 81, 161, 81), (0, 0, 0, 102), (161, 0, 161, 81),
                           (80, 0, 80, 34), (80, 46, 80, 81),                 # the wall between, its door 35-45
                           (0, 91, 11, 91), (11, 81, 11, 91),                 # the closet
                           (19, 81, 19, 102), (44, 81, 44, 102), (19, 102, 44, 102)):   # the pantry
        walls += _rect(x0, y0, x1, y1)
    seg = lambda sid, name, r: {"type": "segment", "metaData": {"segmentId": sid, "name": name}, "compressedPixels": _rect(*r)}
    return {
        "__class": "ValetudoMap", "pixelSize": PS,
        "layers": [
            {"type": "wall", "compressedPixels": walls},
            {"type": "floor", "compressedPixels": _rect(80, 35, 80, 45)},     # the doorway
            seg("1", "Kitchen", (1, 1, 79, 80)),
            seg("2", "Hall", (81, 1, 160, 80)),
            seg("3", "Closet", (1, 82, 10, 90)),
            seg("4", "Pantry", (20, 82, 43, 101)),
        ],
        "entities": [
            {"type": "charger_location", "points": [150 * PS, 70 * PS]},     # the dock, in the Hall's corner
            {"type": "robot_position", "points": [150 * PS, 70 * PS], "metaData": {"angle": 0}},
        ],
    }


def _segment_px(vmap, name):
    for lay in vmap["layers"]:
        if lay["type"] == "segment" and lay["metaData"]["name"] == name:
            return set(vi._layer_pixels(lay))
    raise AssertionError(name)


def _wall_px(vmap):
    return {p for lay in vmap["layers"] if lay["type"] == "wall" for p in vi._layer_pixels(lay)}


# ── planning ────────────────────────────────────────────────────────────────

def test_spots_are_inside_their_rooms_and_clear_of_every_wall():
    vmap = _house()
    plan = vr.plan_spots(vmap)
    walls = _wall_px(vmap)
    assert plan["spots"] and plan["rooms"] == ["Kitchen", "Hall", "Closet", "Pantry"]
    for s in plan["spots"]:
        px = (int(s["x"] // PS), int(s["y"] // PS))
        assert px in _segment_px(vmap, s["room"]), s
        near = min(math.hypot(px[0] - w[0], px[1] - w[1]) for w in walls) * PS / 100
        assert near > vr.WALL_CLEAR_M, (s, near)


def test_a_big_room_gets_a_grid_a_small_one_a_spot_a_closet_none():
    plan = vr.plan_spots(_house())
    by = {}
    for s in plan["spots"]:
        by.setdefault(s["room"], []).append(s)
    assert len(by["Kitchen"]) >= 4 and len(by["Hall"]) >= 4          # 4 x 4 m: a 1.5 m grid
    assert len(by["Pantry"]) == 1                                      # room for one spot, not two 1 m apart
    assert "Closet" not in by and plan["small"] == ["Closet"]
    for room in ("Kitchen", "Hall"):
        pts = by[room]
        gaps = [math.hypot(a["x"] - b["x"], a["y"] - b["y"]) / 100 for i, a in enumerate(pts) for b in pts[i + 1:]]
        assert min(gaps) == pytest.approx(vr.RUN_SPACING_M, abs=0.06)


def test_spots_go_room_by_room_from_the_dock_each_room_once():
    plan = vr.plan_spots(_house())
    rooms = [s["room"] for s in plan["spots"]]
    assert rooms[0] == "Hall"                                          # the dock is in the Hall
    seen = [r for i, r in enumerate(rooms) if i == 0 or rooms[i - 1] != r]
    assert len(seen) == len(set(seen))                                 # never back to a room it left
    hall = [s for s in plan["spots"] if s["room"] == "Hall"]
    dock = (150 * PS, 70 * PS)
    first = math.hypot(hall[0]["x"] - dock[0], hall[0]["y"] - dock[1])
    assert first == min(math.hypot(s["x"] - dock[0], s["y"] - dock[1]) for s in hall)


def test_one_room_only():
    plan = vr.plan_spots(_house(), "Kitchen")
    assert plan["spots"] and {s["room"] for s in plan["spots"]} == {"Kitchen"}


# ── a fake Valetudo and a house to run in ───────────────────────────────────

class _Valetudo:
    """Answers robot_call as Valetudo does. After a go-to the robot is half way
    (moving) on the next read and there (idle) from the one after."""

    def __init__(self, vmap=None, *, unreachable=(), status_error_at=None, auth_needed=False, wifi=None,
                 status_after=None, battery=87, fail_reads=(), map_fails=False):
        self.vmap = vmap or _house()
        self.pos = (150.0 * PS, 70.0 * PS)
        self.target = None
        self.reads = 0
        self.log: list = []
        self.unreachable = set(unreachable)           # go-to targets it never reaches
        self.status_error_at = status_error_at        # the go-to number after which it reports an error
        self.auth_needed = auth_needed
        self.gotos = 0
        self.wifi = wifi                              # None: no WifiConfigurationCapability (an error, as a robot without it)
        self.status_after = status_after              # (go-to number, status): from then on it says that status
        self.battery = battery                        # a number, or a callable(rob)
        self.fail_reads = set(fail_reads)             # attribute reads (counted from 1) that do not answer
        self.attr_reads = 0
        self.map_fails = map_fails                    # its map never arrives whole

    async def call(self, hass, base, method, path, body=None, auth=None):
        if self.auth_needed and not auth:
            raise vr.RobotError("auth", "The robot asked for its Valetudo user name and password (HTTP 401)")
        self.log.append((method, path, body))
        if path == vr.GOTO_PATH:
            self.gotos += 1
            self.target, self.reads = (body["coordinates"]["x"], body["coordinates"]["y"]), 0
            return None
        if path == vr.CONTROL_PATH:
            return None
        if path == vr.WIFI_PATH:
            if self.wifi is None:
                raise vr.RobotError("refused", "The robot answered HTTP 404")
            return self.wifi(self) if callable(self.wifi) else self.wifi
        if path == vr.ATTRS_PATH:
            self.attr_reads += 1
            if self.attr_reads in self.fail_reads:
                raise vr.RobotError("unreachable", "The robot did not answer (TimeoutError)")
            err = self.status_error_at is not None and self.gotos >= self.status_error_at
            status = "error" if err else "moving" if self.target and self.reads < 2 else "idle"
            if self.status_after and self.gotos >= self.status_after[0]:
                status = self.status_after[1]
            bat = self.battery(self) if callable(self.battery) else self.battery
            return [{"__class": "StatusStateAttribute", "value": status, "flag": "none",
                     **({"error": {"message": "Wheel stuck"}} if err else {})},
                    {"__class": "BatteryStateAttribute", "level": bat, "flag": "discharging"}]
        if path == vr.MAP_PATH:
            if self.map_fails:
                raise vr.RobotError("refused", "The robot's answer is not JSON")
            if self.target and self.target not in self.unreachable:
                self.reads += 1
                tx, ty = self.target
                self.pos = ((self.pos[0] + tx) / 2, (self.pos[1] + ty) / 2) if self.reads == 1 else (tx, ty)
            m = dict(self.vmap)
            m["entities"] = [e for e in self.vmap["entities"] if e["type"] != "robot_position"] + [
                {"type": "robot_position", "points": list(self.pos), "metaData": {"angle": 90}}]
            return m
        raise AssertionError(path)

    def sent(self, path):
        return [b for _, p, b in self.log if p == path]


class _Cal:
    def __init__(self, points=None):
        self.points = [dict(p) for p in (points or [])]
        self.added = []

    def list_points(self):
        return list(self.points)

    async def async_add_point(self, point, auto_cap=None):
        p = {**point, "id": f"cp_{len(self.points)}"}
        self.points.append(p)
        self.added.append(p)
        return p

    async def async_delete_points(self, ids):
        before = len(self.points)
        self.points = [p for p in self.points if p["id"] not in ids]
        return before - len(self.points)


OWNER_POINT = {"id": "cp_owner", "label": "Kitchen table", "x_m": 1.0, "y_m": 1.0}


@pytest.fixture
def fast(monkeypatch):
    for k, v in (("POLL_S", 0.0), ("DWELL_S", 0.0), ("DWELL_MORE_S", 0.0), ("GOTO_TIMEOUT_S", 0.2)):
        monkeypatch.setattr(vr, k, v)


def _house_with(monkeypatch, valetudo, *, readings=None, backup="bk_1", events=None):
    cal = _Cal([OWNER_POINT])
    h = SimpleNamespace(data={DOMAIN: {DATA_CALIBRATION: cal}})
    h.states = SimpleNamespace(get=lambda eid: None)

    async def _exec(fn, *a):
        return fn(*a)
    h.async_add_executor_job = _exec
    h.async_create_background_task = lambda coro, name: asyncio.get_running_loop().create_task(coro)
    vs = vi.VacuumStore.__new__(vi.VacuumStore)
    vs.hass = h
    vs.store = SimpleNamespace(async_save=AsyncMock())
    vs.auth_store = SimpleNamespace(async_save=AsyncMock())
    vs.data = vi._default_data()
    vs.auth = {"user": "", "password": ""}
    vs.live = vs.preview = vs._last_spot = vs._unsub = None
    vs.data["link"] = {"enabled": False, "map_id": "m1", "floor_id": "main", "read": "url",
                       "ref": "http://192.168.1.50/api/v2/robot/state/map", "format": "valetudo",
                       "to_m": [0.01, 0, 0, 0, 0.01, 0]}
    vs.data["walker"] = {"enabled": False, "tag": "AA:BB:CC:DD:EE:FF"}
    h.data[DOMAIN][vi.DATA_VACUUM] = vs
    events = events if events is not None else []

    async def _backup(hass, note, keys, **kw):
        events.append(("backup", keys, kw.get("slot")))
        return backup
    monkeypatch.setattr(ws_backup, "_auto_backup", _backup)

    async def _call(*a, **kw):
        events.append(("robot", a[3]))
        return await valetudo.call(*a, **kw)
    monkeypatch.setattr(vr, "robot_call", _call)
    good = [{"source": "scanner_a", "rssi_samples": [-60.0] * 5}, {"source": "scanner_b", "rssi_samples": [-70.0] * 5}]
    calls = {"n": 0}

    def _samples(hass, tag, window):
        calls["n"] += 1
        return good if readings is None else readings
    monkeypatch.setattr(vi, "tag_samples", _samples)
    return h, vs, cal, calls


class _Conn:
    def __init__(self):
        self.result = self.error = None

    def send_result(self, _id, r):
        self.result = r

    def send_error(self, _id, code, text):
        self.error = (code, text)


async def _ws(handler, h, **msg):
    conn = _Conn()
    await handler(h, conn, {"id": 1, **msg})
    return conn


async def _start_and_wait(h, room=None):
    conn = await _ws(wsv.ws_vacuum_run_start, h, **({"room": room} if room else {}))
    eng = h.data[DOMAIN][vr.DATA_RUN]
    if conn.error is None:
        await eng._task
    return conn, eng


# ── the run ─────────────────────────────────────────────────────────────────

def test_a_run_backs_up_first_adds_a_point_per_spot_and_goes_home(monkeypatch, fast):
    rob, events = _Valetudo(), []
    h, vs, cal, _ = _house_with(monkeypatch, rob, events=events)

    async def go():
        return await _start_and_wait(h)
    conn, eng = asyncio.run(go())
    assert conn.error is None, conn.error
    spots = vr.plan_spots(_house())["spots"]
    # The backup, of calibration, before the robot was sent anywhere.
    first_goto = next(i for i, e in enumerate(events) if e == ("robot", vr.GOTO_PATH))
    assert events.index(("backup", ["padspan_ha.calibration"], "robot_run")) < first_goto
    run = vs.data["runs"][-1]
    assert run["state"] == "finished" and run["added"] == len(spots) == len(cal.added) and run["skipped"] == 0
    assert run["backup_id"] == "bk_1" and run["points"] == [p["id"] for p in cal.added]
    for p, s in zip(cal.added, spots):
        assert p["label"].startswith(f"[robot] {run['id']} {s['room']} ")
        assert (p["x_m"], p["y_m"]) == (round(s["x"] / 100, 3), round(s["y"] / 100, 3))   # where the robot stood, in metres
        assert p["floor_id"] == "main" and p["device_id"] == "AA:BB:CC:DD:EE:FF" and len(p["scanner_readings"]) == 2
    assert rob.sent(vr.CONTROL_PATH)[-1] == {"action": "home"}
    assert [b["coordinates"] for b in rob.sent(vr.GOTO_PATH)] == [{"x": s["x"], "y": s["y"]} for s in spots]
    assert cal.points[0] == OWNER_POINT


def test_too_few_receivers_adds_nothing_after_one_longer_listen(monkeypatch, fast):
    rob = _Valetudo()
    one = [{"source": "scanner_a", "rssi_samples": [-60.0] * 9}]          # one receiver only
    h, vs, cal, calls = _house_with(monkeypatch, rob, readings=one)
    _, eng = asyncio.run(_start_and_wait(h, "Pantry"))
    run = vs.data["runs"][-1]
    assert cal.added == [] and run["added"] == 0 and run["skipped"] == 1 == run["spots"]
    assert calls["n"] == 2                                                # listened, then once more
    few = [{"source": "a", "rssi_samples": [-60.0] * 2}, {"source": "b", "rssi_samples": [-61.0] * 2}]
    assert vr.good_readings(few) == [] and vr.good_readings(one) == []
    assert rob.sent(vr.CONTROL_PATH)[-1] == {"action": "home"}


def test_a_spot_never_reached_is_skipped_and_the_run_goes_on(monkeypatch, fast):
    spots = vr.plan_spots(_house(), "Kitchen")["spots"]
    rob = _Valetudo(unreachable={(spots[0]["x"], spots[0]["y"])})
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h, "Kitchen"))
    run = vs.data["runs"][-1]
    assert run["skipped"] == 1 and run["added"] == len(spots) - 1 and run["state"] == "finished"


def test_stop_sends_the_robot_home_and_keeps_the_points_so_far(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)

    async def go():
        conn = await _ws(wsv.ws_vacuum_run_start, h)
        eng = h.data[DOMAIN][vr.DATA_RUN]
        while vs.data["runs"][-1]["added"] < 2:
            await asyncio.sleep(0)
        stop = await _ws(wsv.ws_vacuum_run_stop, h)
        await eng._task
        return conn, stop
    conn, stop = asyncio.run(go())
    run = vs.data["runs"][-1]
    assert stop.result["stopped"] is True and run["state"] == "stopped"
    assert run["added"] == len(cal.added) >= 2 and run["added"] < run["spots"]
    assert rob.sent(vr.CONTROL_PATH)[-1] == {"action": "home"}


def test_a_robot_error_ends_the_run_and_sends_it_home(monkeypatch, fast):
    rob = _Valetudo(status_error_at=2)
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h))
    run = vs.data["runs"][-1]
    assert run["state"] == "failed" and run["error"] == "robot_error" and run["added"] == 1
    assert rob.sent(vr.CONTROL_PATH)[-1] == {"action": "home"}


def test_no_backup_no_run(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob, backup=None)
    conn, _ = asyncio.run(_start_and_wait(h))
    assert conn.error[0] == "backup_failed" and rob.sent(vr.GOTO_PATH) == [] and vs.data["runs"] == []


@pytest.mark.parametrize("change,code", [
    (lambda vs: vs.data["walker"].update(tag=""), "no_tag"),
    (lambda vs: vs.data.update(link=None), "no_map"),
    (lambda vs: vs.data["link"].update(read="camera_png", ref="camera.robot"), "no_address"),
    (lambda vs: vs.data["link"].update(format="attrs"), "no_map"),
], ids=["no-tag", "no-map", "no-address", "not-valetudo"])
def test_what_a_run_needs(monkeypatch, fast, change, code):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    change(vs)
    conn, _ = asyncio.run(_start_and_wait(h))
    assert conn.error[0] == code and rob.log == [] and vs.data["runs"] == []


def test_one_run_at_a_time_and_no_buttons_while_it_goes(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)

    async def go():
        await _ws(wsv.ws_vacuum_run_start, h)
        again = await _ws(wsv.ws_vacuum_run_start, h)
        dock = await _ws(wsv.ws_vacuum_robot_control, h, action="home")
        undo = await _ws(wsv.ws_vacuum_run_undo, h, run_id=vs.data["runs"][-1]["id"])
        h.data[DOMAIN][vr.DATA_RUN].stop()
        await h.data[DOMAIN][vr.DATA_RUN]._task
        return again, dock, undo
    again, dock, undo = asyncio.run(go())
    assert again.error[0] == "busy" and dock.error[0] == "busy" and undo.error[0] == "busy"
    assert len(vs.data["runs"]) == 1


def test_two_starts_at_once_make_one_run(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)

    async def go():
        a, b = await asyncio.gather(_ws(wsv.ws_vacuum_run_start, h, room="Pantry"), _ws(wsv.ws_vacuum_run_start, h, room="Pantry"))
        await h.data[DOMAIN][vr.DATA_RUN]._task
        return a, b
    a, b = asyncio.run(go())
    assert sorted([a.error is None, b.error is None]) == [False, True]
    assert (a.error or b.error)[0] == "busy" and len(vs.data["runs"]) == 1


# ── undo ────────────────────────────────────────────────────────────────────

def test_undo_removes_exactly_that_runs_points(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h, "Kitchen"))
    first = vs.data["runs"][-1]
    asyncio.run(_start_and_wait(h, "Hall"))
    second = vs.data["runs"][-1]
    # A point that carries the first run's id but no longer its label is not taken.
    relabelled = next(p for p in cal.points if p["id"] == first["points"][0])
    relabelled["label"] = "Kitchen corner, moved by hand"
    keep = {p["id"] for p in cal.points if p["id"] not in first["points"]} | {relabelled["id"]}

    conn = asyncio.run(_ws(wsv.ws_vacuum_run_undo, h, run_id=first["id"]))
    assert conn.error is None and conn.result["removed"] == len(first["points"]) - 1
    assert {p["id"] for p in cal.points} == keep
    assert OWNER_POINT in cal.points and all(i in keep for i in second["points"])
    assert first["undone"] is True and second["undone"] is False
    again = asyncio.run(_ws(wsv.ws_vacuum_run_undo, h, run_id=first["id"]))
    assert again.error[0] == "undone"
    gone = asyncio.run(_ws(wsv.ws_vacuum_run_undo, h, run_id="rr_nope"))
    assert gone.error[0] == "not_found"


def test_the_bulk_delete_takes_only_the_ids_given():
    from custom_components.padspan_ha.calibration_store import CalibrationStore
    cs = CalibrationStore.__new__(CalibrationStore)
    cs.data = {"points": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}
    cs.store = SimpleNamespace(async_save=AsyncMock())
    cs.rf_points_changed = lambda: None
    assert asyncio.run(cs.async_delete_points({"a", "c", "zz"})) == 2
    assert cs.data["points"] == [{"id": "b"}]
    assert asyncio.run(cs.async_delete_points(set())) == 0
    cs.store.async_save.assert_awaited_once()


def test_a_run_going_at_a_restart_is_over_and_still_undoable(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    vs.data["runs"] = [{"id": "rr_old", "state": "running", "ended": None, "points": [], "undone": False}]
    conn = asyncio.run(_ws(wsv.ws_vacuum_robot_status, h))
    assert vs.data["runs"][0]["state"] == "interrupted" and conn.result["run"] is None
    assert conn.result["runs"][0]["id"] == "rr_old"
    assert asyncio.run(_ws(wsv.ws_vacuum_run_undo, h, run_id="rr_old")).error is None


# ── the card's state, the address and the login ─────────────────────────────

def test_status_reads_the_robot_from_valetudo_and_hides_the_login(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    vs.auth = {"user": "robotuser", "password": "s3cret"}
    conn = asyncio.run(_ws(wsv.ws_vacuum_robot_status, h, rooms=True))
    r = conn.result
    assert r["state"]["status"] == "idle" and r["state"]["battery"] == 87 and r["state"]["charging"] is False
    assert r["robot"] == {"url": "http://192.168.1.50", "auth": True}            # the link's address, reused
    assert r["rooms"] == ["Kitchen", "Hall", "Closet", "Pantry"]
    assert r["link"]["valetudo"] is True and r["tag"]["address"] == "AA:BB:CC:DD:EE:FF"
    assert "s3cret" not in repr(r) and "robotuser" not in repr(r)


def test_a_401_is_said_plainly(monkeypatch, fast):
    rob = _Valetudo(auth_needed=True)
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    conn = asyncio.run(_ws(wsv.ws_vacuum_robot_status, h))
    assert conn.result["state"]["error"] == "auth" and "401" in conn.result["state"]["text"]
    start, _ = asyncio.run(_start_and_wait(h))
    assert start.error[0] == "auth" and vs.data["runs"] == []
    # With the login set, the same robot answers.
    asyncio.run(_ws(wsv.ws_vacuum_robot_set, h, user="robotuser", password="s3cret"))
    assert vs.basic_auth() == ("robotuser", "s3cret")
    assert asyncio.run(_ws(wsv.ws_vacuum_robot_status, h)).result["state"]["status"] == "idle"


def test_the_address_is_asked_once_when_the_link_has_none(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    vs.data["link"].update(read="camera_png", ref="camera.robot_map")
    assert asyncio.run(_ws(wsv.ws_vacuum_robot_status, h)).result["robot"]["url"] == ""
    bad = asyncio.run(_ws(wsv.ws_vacuum_robot_set, h, url="ftp://robot"))
    assert bad.error[0] == "invalid" and vs.data["robot"]["url"] == ""
    conn = asyncio.run(_ws(wsv.ws_vacuum_robot_set, h, url="http://192.168.1.60/"))
    assert conn.result["robot"]["url"] == "http://192.168.1.60" and conn.result["state"]["status"] == "idle"


def test_start_pause_dock_go_to_valetudos_basic_control(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    for a in ("start", "pause", "home"):
        assert asyncio.run(_ws(wsv.ws_vacuum_robot_control, h, action=a)).error is None
    assert rob.sent(vr.CONTROL_PATH) == [{"action": "start"}, {"action": "pause"}, {"action": "home"}]
    vs.data["link"] = None
    assert asyncio.run(_ws(wsv.ws_vacuum_robot_control, h, action="start")).error[0] == "no_address"


def test_the_tag_heard_now(monkeypatch):
    from collections import deque
    from custom_components.padspan_ha.bluetooth_live import DATA_KEY, _now
    from datetime import timedelta
    h = SimpleNamespace(data={DOMAIN: {}})
    now = _now()
    h.data[DOMAIN][DATA_KEY] = SimpleNamespace(_rssi_samples={"aa:bb:cc:dd:ee:ff": {
        "scanner_a": deque([(now - timedelta(seconds=3), -60.0)]),
        "scanner_b": deque([(now - timedelta(seconds=200), -70.0)]),
    }})
    heard = vr.tag_heard(h, "AA:BB:CC:DD:EE:FF")
    assert heard["receivers"] == 1 and heard["age_s"] in (3, 4)
    assert vr.tag_heard(h, "") == {"receivers": 0, "age_s": None}
    assert vr.tag_heard(h, "11:22:33:44:55:66") == {"receivers": 0, "age_s": None}


# ── robot_call against a real web server playing Valetudo ───────────────────

def test_robot_call_sends_the_login_and_reads_401_as_auth(monkeypatch):
    aiohttp = pytest.importorskip("aiohttp")
    from aiohttp import web
    import homeassistant.helpers.aiohttp_client as hac
    seen = []

    async def attrs(request):
        seen.append(request.headers.get("Authorization"))
        want = "Basic " + base64.b64encode(b"robotuser:s3cret").decode()
        if request.headers.get("Authorization") != want:
            return web.Response(status=401)
        return web.json_response([{"__class": "StatusStateAttribute", "value": "docked", "flag": "none"}])

    async def control(request):
        seen.append(await request.json())
        return web.Response(text="OK")

    async def go():
        app = web.Application()
        app.router.add_get(vr.ATTRS_PATH, attrs)
        app.router.add_put(vr.CONTROL_PATH, control)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        session = aiohttp.ClientSession()
        monkeypatch.setattr(hac, "async_get_clientsession", lambda hass: session)
        monkeypatch.setattr(vr, "async_check_address", AsyncMock())        # this machine is refused otherwise
        h = SimpleNamespace()

        async def _exec(fn, *a):
            return fn(*a)
        h.async_add_executor_job = _exec
        base = f"http://127.0.0.1:{port}"
        try:
            with pytest.raises(vr.RobotError) as e:
                await vr.robot_call(h, base, "GET", vr.ATTRS_PATH)
            ok = await vr.robot_call(h, base, "GET", vr.ATTRS_PATH, auth=("robotuser", "s3cret"))
            put = await vr.robot_call(h, base, "PUT", vr.CONTROL_PATH, {"action": "home"}, auth=("robotuser", "s3cret"))
        finally:
            await session.close()
            await runner.cleanup()
        return e.value, ok, put
    err, ok, put = asyncio.run(go())
    assert err.code == "auth" and "401" in str(err)
    assert vr.robot_state(ok)["status"] == "docked" and put is None
    assert seen[0] is None and seen[1].startswith("Basic ") and seen[2] == {"action": "home"}


# ── the rules, read from the code ───────────────────────────────────────────

def test_calibration_is_written_only_by_the_run_and_its_undo():
    src = (CC / "vacuum_run.py").read_text(encoding="utf-8")
    adds = [m.start() for m in re.finditer(r"\.async_add_point\(", src)]
    assert len(adds) == 1 and src.rfind("async def ", 0, adds[0]) == src.index("async def _async_run")
    dels = [m.start() for m in re.finditer(r"\.async_delete_points\(", src)]
    assert len(dels) == 1 and src.rfind("async def ", 0, dels[0]) == src.index("async def async_undo")
    for forbidden in ("async_delete_point(", "async_clear", "async_remap_from_metres", "async_prune", "async_move_points"):
        assert forbidden not in src
    # The backup comes before the run is recorded or the robot is moved.
    start = src[src.index("async def async_start"):src.index("def stop(self)")]
    assert start.index("_auto_backup(") < start.index("runs.append(run)") < start.index("async_create_background_task")


def test_nothing_starts_a_run_by_itself():
    for name in ("__init__.py", "vacuum_import.py", "snapshot_builder.py", "presence_coordinator.py"):
        p = CC / name
        if p.is_file():
            assert "async_start(" not in p.read_text(encoding="utf-8").replace("vs.start(", "")
    ws = (CC / "ws_vacuum.py").read_text(encoding="utf-8")
    assert ws.count(".async_start(") == 1 and "async def ws_vacuum_run_start" in ws


def test_the_report_counts_runs_and_nothing_else():
    from custom_components.padspan_ha import telemetry as T
    for w in ("started", "finished", "stopped", "failed", "time_limit", "undone",
              "points_0", "points_1_5", "points_6_20", "points_21_plus", "wifi_read"):
        assert T.event_allowed(f"robot_run:{w}")
    assert not T.event_allowed("robot_run:Kitchen") and not T.event_allowed("robot_run:http://192.168.1.50")
    # Only the engine's own words: two fixed ones, how the run ended, and the points bucket.
    src = (CC / "vacuum_run.py").read_text(encoding="utf-8")
    assert set(re.findall(r'self\._bump\(("[a-z_]+"|\w+)', src)) == {'"started"', '"undone"', '"wifi_read"', "why", "_points_bucket"}


def test_the_login_is_kept_where_no_backup_reaches():
    from custom_components.padspan_ha import ws_common as C
    assert vi.AUTH_STORE_KEY not in C._DATA_KEY_MAP and vi.AUTH_STORE_KEY not in C._ALL_STORE_KEYS   # noqa: SLF001
    assert "password" not in repr(vi._default_data())
    reset = (CC / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert '_St(hass, 1, AUTH_STORE_KEY).async_save({"user": "", "password": ""})' in reset


# ── robot points are PadSpan's, and only their run's Undo removes them (2026-11-24) ──

ROBOT = "[robot] rr_abc123 Kitchen (tag 0.1 m above the floor)"


def test_robot_points_are_automatic_not_the_owners():
    from custom_components.padspan_ha.calibration_store import is_beacon_auto_point, is_owner_point
    assert is_owner_point("Kitchen table") and is_owner_point("") and is_owner_point(None)
    assert not is_owner_point("[auto] Keys") and not is_owner_point(ROBOT)
    assert is_beacon_auto_point("[auto] Keys") and not is_beacon_auto_point(ROBOT)
    assert vr.LABEL_PREFIX == "[robot]"


def test_every_own_or_automatic_count_uses_the_one_helper():
    """No module tells PadSpan's points from the owner's by a prefix of its own:
    the label is read through calibration_store's helpers (presence_coordinator
    writes the [auto] label; it does not test for it)."""
    for p in sorted(CC.glob("*.py")):
        src = p.read_text(encoding="utf-8")
        for m in re.finditer(r'startswith\(\s*"\[(auto|robot)\]"', src):
            raise AssertionError(f"{p.name}: {src[m.start():m.start() + 40]}")
    for name, counted in (("plan_carry.py", 'out["points_hand"] += 1 if is_owner_point(p.get("label")) else 0'),
                          ("snapshot_builder.py", '_auto = sum(1 for p in _pts if not is_owner_point(p.get("label")))'),
                          ("telemetry.py", 'not is_owner_point(p.get("label")))')):
        assert counted in (CC / name).read_text(encoding="utf-8"), name


def _cal_store(points):
    from custom_components.padspan_ha.calibration_store import CalibrationStore
    cs = CalibrationStore.__new__(CalibrationStore)
    cs.data = {"points": points}
    cs.store = SimpleNamespace(async_save=AsyncMock())
    cs.rf_points_changed = lambda: None
    return cs


def test_the_beacon_caps_and_prunes_never_take_a_robot_point():
    tag = "AA:BB:CC:DD:EE:FF"
    robot = [{"id": f"r{i}", "label": ROBOT, "device_id": tag, "collected_at": f"2026-11-01T00:00:{i:02d}",
              "scanner_readings": [{"source": "a"}], "quality": "undersampled"} for i in range(8)]
    auto = [{"id": f"a{i}", "label": "[auto] Robot tag", "device_id": tag, "collected_at": f"2026-11-02T00:00:{i:02d}",
             "scanner_readings": [{"source": "a"}, {"source": "b"}]} for i in range(5)]
    cs = _cal_store(robot + auto)
    assert asyncio.run(cs.async_prune_auto_points(max_per_beacon=3)) == 2              # the beacon's own two oldest
    assert [p["id"] for p in cs.data["points"]][:8] == [f"r{i}" for i in range(8)]
    assert asyncio.run(cs.async_prune_one_scanner_auto_points()) == 0                 # a one-receiver robot point stays
    assert sum(1 for p in cs.data["points"] if p["label"] == ROBOT) == 8


def test_beacon_tunes_hard_relocation_never_takes_a_robot_point():
    import shutil
    import subprocess
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    src = (CC / "www" / "padspan-ha" / "views" / "calibration.js").read_text(encoding="utf-8")
    start = src.index("function _beaconTunePurgeIds(")
    fn = src[start:src.index("\n}\n", start) + 3]
    pts = [{"id": "robot", "label": ROBOT, "device_id": "AA:BB:CC:DD:EE:FF"},
           {"id": "auto", "label": "[auto] AA:BB:CC:DD:EE:FF", "device_id": "AA:BB:CC:DD:EE:FF"}]
    js = fn + ("\nconsole.log(JSON.stringify(_beaconTunePurgeIds(" + json.dumps(pts)
               + ', {deviceId: "AA:BB:CC:DD:EE:FF", key: "AA:BB:CC:DD:EE:FF", label: "[robot]"}, new Set())));')
    out = subprocess.run([node, "-e", js], capture_output=True, text=True, timeout=60)
    assert json.loads(out.stdout.strip()) == ["auto"], out.stderr


# ── Wi-Fi at each spot (2026-11-24) ─────────────────────────────────────────

def _wifi_status(rob):
    """Valetudo's ValetudoWifiStatus, the signal weaker the further the robot is from x = 0."""
    return {"__class": "ValetudoWifiStatus", "state": "connected",
            "details": {"ssid": "HomeNet", "bssid": "AA:BB:CC:00:11:22", "signal": -40 - rob.pos[0] / 100,
                        "frequency": "5ghz", "ips": ["fe80::1", "192.168.1.50"], "upspeed": 72, "downspeed": 72}}


def test_each_spot_keeps_the_robots_wifi_for_other_integrations(monkeypatch, fast):
    rob = _Valetudo(wifi=_wifi_status)
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h, "Kitchen"))
    run = vs.data["runs"][-1]
    spots = vr.plan_spots(_house(), "Kitchen")["spots"]
    conn = asyncio.run(_ws(wsv.ws_robot_wifi_readings, h))
    r = conn.result
    assert r["version"] == 1 and r["robot_ip"] == "192.168.1.50" and run["wifi"] == len(spots)
    assert len(r["readings"]) == len(spots)
    first = r["readings"][0]
    assert set(first) == {"run_id", "ts", "x_m", "y_m", "floor_id", "room", "signal", "bssid", "frequency", "state"}
    assert (first["run_id"], first["floor_id"], first["room"], first["frequency"], first["state"]) == (run["id"], "main", "Kitchen", "5ghz", "connected")
    assert (first["x_m"], first["y_m"]) == (round(spots[0]["x"] / 100, 3), round(spots[0]["y"] / 100, 3))
    assert first["signal"] == round(-40 - spots[0]["x"] / 100) and first["bssid"] == "aa:bb:cc:00:11:22"
    assert "HomeNet" not in repr(r)                                         # the SSID is not kept


def test_other_integrations_read_the_wifi_without_the_websocket(monkeypatch, fast):
    """robot_wifi_snapshot(hass): UniFi Utopia's Wi-Fi survey reads it in the same Home Assistant.
    The command's own answer, from the loaded store; None before the store is loaded; copies only."""
    assert vr.robot_wifi_snapshot(SimpleNamespace(data={})) is None                   # PadSpan not set up
    assert vr.robot_wifi_snapshot(SimpleNamespace(data={DOMAIN: {}})) is None         # the store not loaded yet
    rob = _Valetudo(wifi=_wifi_status)
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    empty = vr.robot_wifi_snapshot(h)
    assert empty == {"version": 1, "robot_ip": None, "readings": []}                  # robot never run: nothing, no error
    asyncio.run(_start_and_wait(h, "Kitchen"))
    snap = vr.robot_wifi_snapshot(h)
    assert snap == asyncio.run(_ws(wsv.ws_robot_wifi_readings, h)).result               # one shape, one path
    assert snap["version"] == vr.WIFI_VERSION == 1 and snap["robot_ip"] == "192.168.1.50" and snap["readings"]
    snap["readings"][0]["signal"] = 0
    snap["readings"].clear()
    assert vs.data["wifi"]["readings"] and vs.data["wifi"]["readings"][0]["signal"] != 0  # the store is never touched
    doc = vr.robot_wifi_snapshot.__doc__
    assert "UniFi Utopia" in doc and "padspan_ha/robot_wifi_readings" in doc


def test_a_wifi_read_that_fails_never_stops_a_run(monkeypatch, fast):
    rob = _Valetudo(wifi=None)                                              # no Wi-Fi capability: 404
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h, "Kitchen"))
    run = vs.data["runs"][-1]
    assert run["state"] == "finished" and run["added"] == run["spots"] and run["wifi"] == 0
    assert vs.data["wifi"]["readings"] == []
    assert vr.wifi_of("nonsense") is None
    assert vr.wifi_of({"state": "not_connected"}) == {"state": "not_connected", "signal": None, "bssid": None, "frequency": None}


def test_wifi_history_is_capped(monkeypatch, fast):
    monkeypatch.setattr(vr, "WIFI_KEPT", 3)
    rob = _Valetudo(wifi=_wifi_status)
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h, "Kitchen"))
    assert len(vs.data["wifi"]["readings"]) == 3


def test_the_wifi_command_is_admin_only_and_the_report_has_no_wifi_names():
    src = (CC / "ws_vacuum.py").read_text(encoding="utf-8")
    head = src[src.index('"type": "padspan_ha/robot_wifi_readings"'):src.index("async def ws_robot_wifi_readings")]
    assert "@websocket_api.require_admin" in head
    tel = (CC / "telemetry.py").read_text(encoding="utf-8")
    assert "bssid" not in tel.lower().replace("never an ssid or bssid", "") and "robot_ip" not in tel
    assert "padspan_ha/robot_wifi_readings" in (CC / "vacuum_run.py").read_text(encoding="utf-8")


# ── Find mistakes (vacuum_findings.py) ─────────────────────────────────────

def _robot_points(rx, *, floor="main", n_side=4, step=1.5, noise=None, label="[robot] rr_t Kitchen (tag 0.1 m above the floor)"):
    """Robot spots on a grid, each with the receivers' RSSI from the true spots in rx
    ({source: (x, y, floor)}): -45 - 25 log10(d), plus a small fixed wobble."""
    import itertools
    pts = []
    wob = noise or [0.0, 1.2, -0.8, 0.5, -1.4, 0.9, -0.3, 1.5, -1.1]
    for k, (i, j) in enumerate(itertools.product(range(n_side), range(n_side))):
        x, y = 1.0 + i * step, 1.0 + j * step
        reads = []
        for src, (tx, ty, tf) in rx.items():
            d = math.sqrt((x - tx) ** 2 + (y - ty) ** 2 + 0.9 ** 2) if tf == floor else math.sqrt((x - tx) ** 2 + (y - ty) ** 2 + 3.0 ** 2)
            v = -45 - 25 * math.log10(d) + wob[k % len(wob)] - (12 if tf != floor else 0)
            reads.append({"source": src, "name": src.title(), "mean_rssi": round(v, 1)})
        pts.append({"id": f"p{k}", "label": label, "x_m": x, "y_m": y, "floor_id": floor, "scanner_readings": reads})
    return pts


ROOMS = {"Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 7], [0, 7]]},
         "Hall": {"type": "poly", "floor_id": "main", "points_m": [[4, 0], [8, 0], [8, 7], [4, 7]]}}


def test_a_receiver_placed_right_is_not_flagged_and_one_moved_4_m_is_found():
    from custom_components.padspan_ha import vacuum_findings as vf
    true = {"right": (2.0, 2.0, "main"), "moved": (6.5, 5.0, "main")}
    pts = _robot_points(true, n_side=6, step=1.2)                                       # spots over both rooms
    placed = {"right": {"x_m": 2.0, "y_m": 2.0, "z_m": 1.0, "floor_id": "main"},
              "moved": {"x_m": 2.5, "y_m": 5.0, "z_m": 1.0, "floor_id": "main"}}        # 4 m from where it is
    out = vf.find_mistakes(pts + [{"id": "own", "label": "Kitchen table", "x_m": 9, "y_m": 9, "floor_id": "main",
                                   "scanner_readings": [{"source": "moved", "mean_rssi": -30}]}], placed, ROOMS)
    assert [f["source"] for f in out["findings"]] == ["moved"] and [f["source"] for f in out["fine"]] == ["right"]
    f = out["findings"][0]
    assert f["kind"] == "moved" and f["placed"]["room"] == "Kitchen" and f["found"]["room"] == "Hall"
    assert math.dist((f["found"]["x_m"], f["found"]["y_m"]), (6.5, 5.0)) < 1.0          # near its true spot
    assert f["found"]["distance_m"] > 2.5 and f["rms_after"] <= 0.65 * f["rms_before"] and f["spots"] == 36
    assert out["points"] == 36                                                          # only the robot's points


def test_too_few_spots_are_not_judged():
    from custom_components.padspan_ha import vacuum_findings as vf
    pts = _robot_points({"far": (2.0, 2.0, "main")}, n_side=2)                          # 4 spots
    out = vf.find_mistakes(pts, {"far": {"x_m": 7.0, "y_m": 6.0, "floor_id": "main"}}, ROOMS)
    assert out["findings"] == [] and out["thin"] == [{"source": "far", "name": "Far", "spots": 4, "why": "few"}]


def test_a_receiver_on_another_floor_that_hears_the_robot_strongly():
    from custom_components.padspan_ha import vacuum_findings as vf
    pts = _robot_points({"upstairs": (3.0, 3.0, "main"), "attic": (3.0, 3.0, "upper")})
    placed = {"upstairs": {"x_m": 3.0, "y_m": 3.0, "floor_id": "upper"},               # truly here, placed upstairs
              "attic": {"x_m": 3.0, "y_m": 3.0, "floor_id": "upper"}}                  # truly upstairs: faint here
    out = vf.find_mistakes(pts, placed, ROOMS)
    assert [f["source"] for f in out["findings"]] == ["upstairs"]
    f = out["findings"][0]
    assert f["kind"] == "other_floor" and f["found"]["floor_id"] == "main" and f["strong"] >= 3
    assert math.dist((f["found"]["x_m"], f["found"]["y_m"]), (3.0, 3.0)) < 1.0


def test_findings_move_nothing():
    src = (CC / "vacuum_findings.py").read_text(encoding="utf-8")
    for bad in ("async_", "hass", ".data[", "set_scanner", "await "):
        assert bad not in src, bad
    ws = (CC / "ws_vacuum.py").read_text(encoding="utf-8")
    body = ws[ws.index("async def ws_vacuum_findings"):ws.index("async def ws_robot_wifi_readings")]
    assert "await hass.async_add_executor_job(find_mistakes, pts, pos, rooms)" in body
    assert "async_set" not in body and "save" not in body


# ── review fixes (2026-11-24) ───────────────────────────────────────────────

def test_a_large_map_sent_in_pieces_is_read_whole(monkeypatch):
    """content.read(n) gave only what had arrived: a map over Wi-Fi, in pieces, came out "not JSON"."""
    aiohttp = pytest.importorskip("aiohttp")
    from aiohttp import web
    import homeassistant.helpers.aiohttp_client as hac
    big = dict(_house())
    big["padding"] = ["x" * 1000] * 2500                         # ~2.5 MB, as a real map's layers can be
    body = json.dumps(big).encode()

    async def chunked(request):
        resp = web.StreamResponse()
        await resp.prepare(request)
        for i in range(0, len(body), 64 * 1024):
            await resp.write(body[i:i + 64 * 1024])
            await asyncio.sleep(0.002)
        await resp.write_eof()
        return resp

    async def go():
        app = web.Application()
        app.router.add_get(vr.MAP_PATH, chunked)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        session = aiohttp.ClientSession()
        monkeypatch.setattr(hac, "async_get_clientsession", lambda hass: session)
        monkeypatch.setattr(vr, "async_check_address", AsyncMock())
        monkeypatch.setattr(vi, "async_check_address", AsyncMock())
        h = SimpleNamespace()

        async def _exec(fn, *a):
            return fn(*a)
        h.async_add_executor_job = _exec
        base = f"http://127.0.0.1:{port}"
        try:
            a = await vr.robot_call(h, base, "GET", vr.MAP_PATH)
            b = await vi.fetch_url_json(h, base + vr.MAP_PATH)
        finally:
            await session.close()
            await runner.cleanup()
        return a, b
    a, b = asyncio.run(go())
    assert a == big and b == big


def test_a_reply_past_the_cap_is_refused_while_it_arrives():
    class _Content:
        async def iter_chunked(self, n):
            for _ in range(5):
                yield b"x" * 4
    resp = SimpleNamespace(content_length=None, content=_Content())
    with pytest.raises(vi.VacuumImportError, match="too large"):
        asyncio.run(vi.read_capped(resp, cap=10))
    assert asyncio.run(vi.read_capped(SimpleNamespace(content_length=None, content=_Content()), cap=100)) == b"x" * 20
    with pytest.raises(vi.VacuumImportError):
        asyncio.run(vi.read_capped(SimpleNamespace(content_length=10 ** 9, content=_Content())))
    for name in ("vacuum_import.py", "vacuum_run.py"):
        assert "await resp.content.read(" not in (CC / name).read_text(encoding="utf-8"), name


def test_a_map_that_cannot_be_read_never_hides_the_robots_state(monkeypatch, fast):
    rob = _Valetudo(map_fails=True)
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    r = asyncio.run(_ws(wsv.ws_vacuum_robot_status, h, rooms=True)).result
    assert r["state"]["status"] == "idle" and r["state"]["battery"] == 87
    assert r["rooms_error"]["error"] == "refused" and "rooms" not in r


def test_every_run_with_points_stays_undoable_and_its_record_is_kept():
    runs = [{"id": f"r{i}", "state": "finished", "points": [f"p{i}"], "undone": i % 2 == 0} for i in range(30)]
    vr.trim_runs(runs, {f"p{i}" for i in range(30)})
    ids = [r["id"] for r in runs]
    assert all(f"r{i}" in ids for i in range(1, 30, 2))                    # every run with points not undone kept
    assert len(runs) == vr.RUNS_KEPT                                       # the undone ones went, oldest first
    # A run whose points the owner deleted by hand can go too.
    runs2 = [{"id": f"s{i}", "state": "finished", "points": [f"q{i}"], "undone": False} for i in range(25)]
    vr.trim_runs(runs2, {f"q{i}" for i in range(10, 25)})
    assert [r["id"] for r in runs2][0] == "s5" and len(runs2) == vr.RUNS_KEPT
    card = vr.runs_for_card([{"id": "a", "points": ["1"], "undone": False}, {"id": "b", "points": [], "undone": False},
                             {"id": "c", "points": ["2"], "undone": True}, {"id": "d", "points": [], "undone": False}])
    assert [r["id"] for r in card] == ["d", "a"]                           # the last, then each still undoable, newest first


def test_the_card_can_undo_an_older_run(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h, "Kitchen"))
    first = vs.data["runs"][-1]["id"]
    asyncio.run(_start_and_wait(h, "Hall"))
    r = asyncio.run(_ws(wsv.ws_vacuum_robot_status, h)).result
    assert [x["id"] for x in r["runs"]][1] == first and r["runs"][1]["points_kept"] > 0
    assert asyncio.run(_ws(wsv.ws_vacuum_run_undo, h, run_id=first)).error is None


def test_unloading_padspan_ends_the_run_and_sends_the_robot_home(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)

    async def go():
        await _ws(wsv.ws_vacuum_run_start, h)
        eng = h.data[DOMAIN][vr.DATA_RUN]
        while vs.data["runs"][-1]["added"] < 1:
            await asyncio.sleep(0)
        # A reload's new store meanwhile: the engine going is the one handed out, never a second one.
        other = vi.VacuumStore.__new__(vi.VacuumStore)
        assert vr.engine(h, other) is eng
        await vr.async_shutdown_run(h)
        return eng
    eng = asyncio.run(go())
    run = vs.data["runs"][-1]
    assert run["state"] == "interrupted" and not eng.running and vr.DATA_RUN not in h.data[DOMAIN]
    assert rob.sent(vr.CONTROL_PATH)[-1] == {"action": "home"}
    init = (CC / "__init__.py").read_text(encoding="utf-8")
    unload = init[init.index("async def async_unload_entry"):]
    assert unload.index("await async_shutdown_run(hass)") < unload.index("async_stop_power_teams")
    reset = (CC / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert reset.index("await async_shutdown_run(hass)") < reset.index('await st.async_save({"points": [], "model": {}})')
    restore = (CC / "ws_backup.py").read_text(encoding="utf-8")
    body = restore[restore.index("async def ws_store_backup_restore"):]
    assert body.index("await async_shutdown_run(hass)") < body.index('stores_data = backup.get("stores", {})')


@pytest.mark.parametrize("status", ["returning", "docked"])
def test_a_robot_going_home_on_its_own_ends_the_run_and_is_sent_nothing(monkeypatch, fast, status):
    rob = _Valetudo(status_after=(3, status))
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h))
    run = vs.data["runs"][-1]
    assert run["state"] == "robot_home" and run["added"] == 2 and rob.gotos == 3
    assert rob.sent(vr.CONTROL_PATH) == []                                 # nothing more sent


def test_a_low_battery_ends_the_run_or_never_starts_it(monkeypatch, fast):
    rob = _Valetudo(battery=lambda r: 87 if r.gotos < 2 else 15)
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h))
    run = vs.data["runs"][-1]
    assert run["state"] == "low_battery" and run["added"] == 1 and rob.sent(vr.CONTROL_PATH) == []
    rob2 = _Valetudo(battery=12)
    h2, vs2, cal2, _ = _house_with(monkeypatch, rob2)
    conn, _ = asyncio.run(_start_and_wait(h2))
    assert conn.error[0] == "low_battery" and rob2.sent(vr.GOTO_PATH) == [] and vs2.data["runs"] == []


def test_a_read_lost_now_and_then_is_no_reason_to_end_a_run(monkeypatch, fast):
    rob = _Valetudo(fail_reads={2, 3})                                    # two in a row, after the start's own read
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    asyncio.run(_start_and_wait(h, "Pantry"))
    assert vs.data["runs"][-1]["state"] == "finished" and vs.data["runs"][-1]["added"] == 1
    rob3 = _Valetudo(fail_reads={2, 3, 4})                                # three in a row: it gives up
    h3, vs3, cal3, _ = _house_with(monkeypatch, rob3)
    asyncio.run(_start_and_wait(h3, "Pantry"))
    assert vs3.data["runs"][-1]["state"] == "failed" and vs3.data["runs"][-1]["error"] == "unreachable"


def test_a_login_aiohttp_cannot_send_is_refused_when_saved(monkeypatch, fast):
    rob = _Valetudo()
    h, vs, cal, _ = _house_with(monkeypatch, rob)
    bad = asyncio.run(_ws(wsv.ws_vacuum_robot_set, h, user="robot:user", password="x"))
    assert bad.error[0] == "bad_login" and vs.basic_auth() is None
    bad = asyncio.run(_ws(wsv.ws_vacuum_robot_set, h, url="http://robotuser:s3cret@robot.local"))
    assert bad.error[0] == "bad_login" and vs.data["robot"]["url"] == ""


def test_spots_all_on_one_side_judge_nothing():
    """Review: 8 spots in one room flagged correctly placed receivers elsewhere."""
    from custom_components.padspan_ha import vacuum_findings as vf
    rx = {"a": (6.5, 2.0, "main"), "b": (7.0, 6.0, "main")}
    pts = _robot_points(rx, n_side=3, step=1.4)                           # spots in the Kitchen only (x 1..3.8)
    placed = {k: {"x_m": v[0], "y_m": v[1], "floor_id": "main"} for k, v in rx.items()}
    out = vf.find_mistakes(pts, placed, ROOMS)
    assert out["findings"] == [] and {t["why"] for t in out["thin"]} == {"around"}


def test_an_empty_floor_id_is_unknown_not_another_floor():
    from custom_components.padspan_ha import vacuum_findings as vf
    pts = _robot_points({"x": (3.0, 3.0, "main")})
    out = vf.find_mistakes(pts, {"x": {"x_m": 3.0, "y_m": 3.0, "floor_id": ""}}, ROOMS)
    assert out["findings"] == [] and [f["source"] for f in out["fine"]] == ["x"]


def test_findings_are_kept_until_the_points_change(monkeypatch):
    from custom_components.padspan_ha import vacuum_findings as vf
    from custom_components.padspan_ha.const import DATA_MODEL
    pts = _robot_points({"x": (3.0, 3.0, "main")})
    calls = {"n": 0}
    real = vf.find_mistakes

    def counted(*a):
        calls["n"] += 1
        return real(*a)
    monkeypatch.setattr(vf, "find_mistakes", counted)
    cal = SimpleNamespace(list_points=lambda: list(pts))
    mdl = SimpleNamespace(scanner_positions_m=lambda: {"x": {"x_m": 3.0, "y_m": 3.0, "floor_id": "main"}})
    h = SimpleNamespace(data={DOMAIN: {DATA_CALIBRATION: cal, DATA_MODEL: mdl}})

    async def _exec(fn, *a):
        return fn(*a)
    h.async_add_executor_job = _exec
    a = asyncio.run(_ws(wsv.ws_vacuum_findings, h)).result
    b = asyncio.run(_ws(wsv.ws_vacuum_findings, h)).result
    assert a == b and calls["n"] == 1
    pts.append({**pts[0], "id": "new"})
    asyncio.run(_ws(wsv.ws_vacuum_findings, h))
    assert calls["n"] == 2


def test_a_big_house_is_searched_coarse_then_fine():
    import time as _t
    from custom_components.padspan_ha import vacuum_findings as vf
    rooms = {"All": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [20, 0], [20, 15], [0, 15]]}}
    rx = {f"r{i}": (1.0 + (i % 5) * 4.0, 1.0 + (i // 5) * 3.0, "main") for i in range(25)}
    pts = _robot_points(rx, n_side=20, step=0.75)                        # 400 spots, 25 receivers
    placed = {k: {"x_m": v[0], "y_m": v[1], "floor_id": "main"} for k, v in rx.items()}
    t0 = _t.monotonic()
    out = vf.find_mistakes(pts, placed, rooms)
    assert _t.monotonic() - t0 < 10 and out["findings"] == []


def test_robot_points_are_never_held_out_test_spots():
    src = (CC / "heldout.py").read_text(encoding="utf-8").replace("\r\n", "\n")
    loop = src[src.index("    for i, p in enumerate(pts):\n        # A room walk is training data only"):]
    loop = loop[:loop.index("spots.append(i)")]
    assert "if _is_robot(p):\n            continue" in loop
