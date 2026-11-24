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

    def __init__(self, vmap=None, *, unreachable=(), status_error_at=None, auth_needed=False):
        self.vmap = vmap or _house()
        self.pos = (150.0 * PS, 70.0 * PS)
        self.target = None
        self.reads = 0
        self.log: list = []
        self.unreachable = set(unreachable)           # go-to targets it never reaches
        self.status_error_at = status_error_at        # the go-to number after which it reports an error
        self.auth_needed = auth_needed
        self.gotos = 0

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
        if path == vr.ATTRS_PATH:
            err = self.status_error_at is not None and self.gotos >= self.status_error_at
            status = "error" if err else "moving" if self.target and self.reads < 2 else "idle"
            return [{"__class": "StatusStateAttribute", "value": status, "flag": "none",
                     **({"error": {"message": "Wheel stuck"}} if err else {})},
                    {"__class": "BatteryStateAttribute", "level": 87, "flag": "discharging"}]
        if path == vr.MAP_PATH:
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
              "points_0", "points_1_5", "points_6_20", "points_21_plus"):
        assert T.event_allowed(f"robot_run:{w}")
    assert not T.event_allowed("robot_run:Kitchen") and not T.event_allowed("robot_run:http://192.168.1.50")
    # Only the engine's own words: two fixed ones, how the run ended, and the points bucket.
    src = (CC / "vacuum_run.py").read_text(encoding="utf-8")
    assert set(re.findall(r'self\._bump\(("[a-z_]+"|\w+)', src)) == {'"started"', '"undone"', "why", "_points_bucket"}


def test_the_login_is_kept_where_no_backup_reaches():
    from custom_components.padspan_ha import ws_common as C
    assert vi.AUTH_STORE_KEY not in C._DATA_KEY_MAP and vi.AUTH_STORE_KEY not in C._ALL_STORE_KEYS   # noqa: SLF001
    assert "password" not in repr(vi._default_data())
    reset = (CC / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert '_St(hass, 1, AUTH_STORE_KEY).async_save({"user": "", "password": ""})' in reset
