"""Robot-vacuum map import (vacuum_import.py, ws_vacuum.py).

The Valetudo fixture (tests/fixtures/vacuum/valetudo_two_rooms.json) is
written by hand in Valetudo's documented ValetudoMap shape — two rooms, a
floor, walls, a dock and the robot — not a real user's map.

What matters most here: nothing reaches calibration on its own (the walker
fills a review pile; only an accepted point calls async_add_point), an import
never overwrites a room or a map, and with nothing turned on nothing changes.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import struct
import zlib
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha import vacuum_import as vi
from custom_components.padspan_ha import ws_vacuum as wsv
from custom_components.padspan_ha.const import (
    DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DOMAIN,
)
from custom_components.padspan_ha.maps_store import _encode_rgba_to_png

ROOT = Path(__file__).resolve().parents[1]
CC = ROOT / "custom_components" / "padspan_ha"
FIXTURE = Path(__file__).parent / "fixtures" / "vacuum" / "valetudo_two_rooms.json"


def _run(coro):
    return asyncio.run(coro)


def _vmap() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _blank_png(w: int, h: int) -> bytes:
    return _encode_rgba_to_png(bytes((b"\x00" + b"\xff" * (w * 4)) * h), w, h)


def _with_ztxt(png: bytes, payload: dict) -> bytes:
    data = b"ValetudoMap\x00\x00" + zlib.compress(json.dumps(payload).encode())
    chunk = struct.pack(">I", len(data)) + b"zTXt" + data + struct.pack(">I", zlib.crc32(b"zTXt" + data) & 0xFFFFFFFF)
    iend = png.rindex(b"IEND") - 4
    return png[:iend] + chunk + png[iend:]


def _bbox(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)


# ── parsing ─────────────────────────────────────────────────────────────────

def test_valetudo_rooms_come_out_in_metres_with_their_names():
    c = vi.parse_valetudo(_vmap())
    names = [r["name"] for r in c["rooms"]]
    assert names == ["Kitchen", "Room 18"]            # an unnamed segment keeps its id
    kitchen = c["rooms"][0]
    assert len(kitchen["points_m"]) == 4               # a rectangle stays four corners
    x0, y0, x1, y1 = _bbox(kitchen["points_m"])
    assert (round(x1 - x0, 3), round(y1 - y0, 3)) == (2.0, 3.0)   # 40 x 60 px of 5 cm
    hall = c["rooms"][1]
    assert _bbox(hall["points_m"])[0] == x1            # the hall starts where the kitchen ends
    assert c["warnings"] == []


def test_valetudo_picture_and_scale_agree():
    c = vi.parse_valetudo(_vmap())
    assert c["png"][:8] == b"\x89PNG\r\n\x1a\n"
    assert vi.png_size(c["png"]) == (c["width"], c["height"])
    assert c["scale_x_m"] == pytest.approx(c["width"] * c["m_per_px"])
    # The dock (2510, 2790 cm) sits 0.1 m right of and 2.9 m below the
    # kitchen's top-left corner (2500, 2500 cm).
    k = c["rooms"][0]["points_m"]
    assert c["dock"]["x_m"] - _bbox(k)[0] == pytest.approx(0.1, abs=1e-3)
    assert c["dock"]["y_m"] - _bbox(k)[1] == pytest.approx(2.9, abs=1e-3)
    assert c["robot"] is not None


def test_valetudo_map_in_a_camera_png_ztxt_chunk_reads_the_same():
    png = _with_ztxt(_blank_png(4, 4), _vmap())
    assert vi.extract_valetudo_json(png) == _vmap()
    assert vi.extract_valetudo_json(_blank_png(4, 4)) is None


def test_not_a_valetudo_map_is_refused_not_guessed():
    for bad in ({}, {"layers": "x"}, {"__class": "Other", "layers": []}, {"layers": [], "pixelSize": 5}):
        with pytest.raises(vi.VacuumImportError):
            vi.parse_valetudo(bad)


def _xcme_attrs():
    # Roborock-style XCME attributes: millimetres, Y up; 20 picture px per metre.
    return {
        "calibration_points": [
            {"vacuum": {"x": 25500, "y": 25500}, "map": {"x": 100, "y": 400}},
            {"vacuum": {"x": 26500, "y": 25500}, "map": {"x": 120, "y": 400}},
            {"vacuum": {"x": 25500, "y": 26500}, "map": {"x": 100, "y": 380}},
        ],
        "rooms": {"16": {"x0": 25500, "y0": 25500, "x1": 29500, "y1": 28500}},
        "vacuum_position": {"x": 26500, "y": 26500, "a": 90},
        "charger": {"x": 25600, "y": 25600},
    }


def test_calibration_points_camera_gives_metres_and_rectangle_rooms():
    c = vi.parse_calibrated_camera(_xcme_attrs(), _blank_png(300, 500))
    assert c["m_per_px"] == pytest.approx(0.05)
    assert c["scale_x_m"] == pytest.approx(15.0)
    room = c["rooms"][0]
    assert room["name"] == "Room 16"
    x0, y0, x1, y1 = _bbox(room["points_m"])
    assert (round(x1 - x0, 3), round(y1 - y0, 3)) == (4.0, 3.0)
    # Y up in the vacuum, Y down in the picture: the robot 1 m "up" is 1 m higher on the page.
    assert c["robot"]["y_m"] == pytest.approx(400 * 0.05 - 1.0)
    assert vi.robot_spot("attrs", _xcme_attrs()) == {"x": 26500.0, "y": 26500.0, "a": 90.0}


def test_empty_calibration_points_are_refused():
    attrs = {"calibration_points": [{"vacuum": {"x": 0, "y": 0}, "map": {"x": 0, "y": 0}}] * 3}
    with pytest.raises(vi.VacuumImportError):
        vi.parse_calibrated_camera(attrs, _blank_png(10, 10))
    with pytest.raises(vi.VacuumImportError):
        vi.parse_calibrated_camera({}, _blank_png(10, 10))


def test_robot_address_becomes_the_map_url_http_only():
    assert vi.valetudo_map_url("http://robot.local/") == "http://robot.local/api/v2/robot/state/map"
    assert vi.valetudo_map_url("http://robot.local/api/v2/robot/state/map") == "http://robot.local/api/v2/robot/state/map"
    with pytest.raises(vi.VacuumImportError):
        vi.valetudo_map_url("file:///etc/passwd")


# ── a small house ───────────────────────────────────────────────────────────

class _Model:
    def __init__(self, transforms=None):
        self.data = {"map_transforms": dict(transforms or {})}

    async def async_set_map_transform(self, map_id, t):
        self.data["map_transforms"][map_id] = dict(t)

    async def async_ensure_world_gauge(self, maps):
        return None

    def map_transform(self, map_id):
        return self.data["map_transforms"].get(map_id)

    def map_frac_to_metres(self, fx, fy, map_id):
        t = self.data["map_transforms"].get(map_id)
        return fabric_truth.placement_metres(t, fx, fy) if t else None


class _Maps:
    def __init__(self, maps=None):
        self.data = {"maps": list(maps or [])}
        self.added = []

    async def async_add_map(self, name, filename, mime, w, h, b64, floor_id, **kw):
        assert base64.b64decode(b64)[:8] == b"\x89PNG\r\n\x1a\n"
        info = {"id": f"new{len(self.added)}", "name": name, "floor_id": floor_id}
        self.added.append(info)
        self.data["maps"].append(info)
        return info


class _Fabric:
    def __init__(self, rooms=None):
        self.rooms = dict(rooms or {})
        self.calls = []

    async def async_correct_room(self, floor_id, room, geometry, committed_by="correction", **kw):
        self.calls.append((room, committed_by))
        if committed_by == "external_import" and room in self.rooms:
            return {"ok": False, "error": "exists"}
        self.rooms[room] = geometry
        return {"ok": True}


class _Conn:
    def __init__(self):
        self.result = None
        self.error = None

    def send_result(self, _id, r):
        self.result = r

    def send_error(self, _id, code, text):
        self.error = (code, text)


def _hass(**extra):
    h = SimpleNamespace()
    h.data = {DOMAIN: dict(extra)}
    h.states = SimpleNamespace(get=lambda eid: None)

    async def _exec(fn, *a):
        return fn(*a)
    h.async_add_executor_job = _exec
    return h


def _vstore(h):
    vs = vi.VacuumStore.__new__(vi.VacuumStore)
    vs.hass = h
    vs.store = SimpleNamespace(async_save=AsyncMock(), async_load=AsyncMock(return_value=None))
    vs.data = vi._default_data()
    vs.live = None
    vs.preview = None
    vs._last_spot = None
    vs._unsub = None
    h.data[DOMAIN][vi.DATA_VACUUM] = vs
    return vs


def _call(handler, h, **msg):
    conn = _Conn()
    _run(handler(h, conn, {"id": 1, **msg}))
    return conn


# ── commit: through the existing writers, never overwriting ─────────────────

def test_commit_adds_a_new_map_and_new_rooms_and_never_overwrites_a_room():
    existing_room = {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}
    old_map = {"id": "old", "floor_id": "main"}
    old_t = {"origin_x_m": 3.0, "origin_y_m": 4.0, "scale_x_m": 10.0, "scale_y_m": 8.0}
    ms, mdl, fab = _Maps([old_map]), _Model({"old": old_t}), _Fabric({"Kitchen": existing_room})
    cal = SimpleNamespace(async_add_point=AsyncMock())
    h = _hass(**{DATA_MAPS: ms, DATA_MODEL: mdl, DATA_FABRIC: fab, DATA_CALIBRATION: cal})
    vs = _vstore(h)

    conn = _call(wsv.ws_vacuum_import_preview, h, json_text=FIXTURE.read_text(encoding="utf-8"))
    assert conn.error is None and conn.result["rooms"] and conn.result["png_base64"]
    assert ms.added == [] and fab.calls == []               # a preview writes nothing

    conn = _call(wsv.ws_vacuum_import_commit, h, floor_id="main")
    assert conn.error is None
    assert [m["id"] for m in ms.added] == ["new0"]          # a NEW map, the old one kept
    assert mdl.data["map_transforms"]["old"] == old_t       # the old placement untouched
    assert mdl.data["map_transforms"]["new0"]["scale_x_m"] > 0
    assert conn.result["rooms_skipped"] == ["Kitchen"]      # refused: already there
    assert conn.result["rooms_added"] == ["Room 18"]
    assert fab.rooms["Kitchen"] is existing_room
    assert all(by == "external_import" for _, by in fab.calls)
    cal.async_add_point.assert_not_called()                 # an import is not calibration
    assert vs.data["link"] is None                          # a pasted file has nothing to link to


def test_commit_from_a_camera_records_a_link_that_is_off():
    ms, mdl, fab = _Maps(), _Model(), _Fabric()
    h = _hass(**{DATA_MAPS: ms, DATA_MODEL: mdl, DATA_FABRIC: fab})
    vs = _vstore(h)
    png = _with_ztxt(_blank_png(4, 4), _vmap())
    orig = vi.camera_image
    vi.camera_image = AsyncMock(return_value=png)
    try:
        conn = _call(wsv.ws_vacuum_import_preview, h, entity_id="camera.robot_map_data")
    finally:
        vi.camera_image = orig
    assert conn.error is None and conn.result["source"] == "valetudo"
    _call(wsv.ws_vacuum_import_commit, h, floor_id="main")
    lk = vs.data["link"]
    assert lk["enabled"] is False and lk["read"] == "camera_png" and lk["map_id"] == "new0"
    assert vs.link_on() is False and vi.live_position(h) is None


def test_commit_without_a_preview_writes_nothing():
    ms = _Maps()
    h = _hass(**{DATA_MAPS: ms, DATA_MODEL: _Model(), DATA_FABRIC: _Fabric()})
    _vstore(h)
    conn = _call(wsv.ws_vacuum_import_commit, h, floor_id="main")
    assert conn.error[0] == "no_preview" and ms.added == []


# ── live position and the walker → review pile only ─────────────────────────

def _linked(h, *, walker=True):
    mdl = _Model({"m1": {"origin_x_m": 1.0, "origin_y_m": 2.0, "scale_x_m": 10.0, "scale_y_m": 10.0}})
    h.data[DOMAIN][DATA_MODEL] = mdl
    vs = _vstore(h)
    vs.data["link"] = {"enabled": True, "map_id": "m1", "floor_id": "main", "read": "camera_attrs",
                       "ref": "camera.robot", "format": "attrs", "to_frac": [0.0001, 0, 0, 0, 0.0001, 0]}
    vs.data["walker"] = {"enabled": walker, "tag": "AA:BB:CC:DD:EE:FF"}
    return vs


def _ble(h, now):
    from collections import deque
    from custom_components.padspan_ha.bluetooth_live import DATA_KEY
    samples = {"aa:bb:cc:dd:ee:ff": {
        "scanner_a": deque([(now, -60.0)] * 5),
        "scanner_b": deque([(now, -70.0)] * 5),
    }}
    h.data[DOMAIN][DATA_KEY] = SimpleNamespace(_rssi_samples=samples)


def test_live_position_goes_through_the_maps_own_placement():
    h = _hass()
    vs = _linked(h, walker=False)
    vs.async_read_payload = AsyncMock(return_value={"vacuum_position": {"x": 5000, "y": 2500, "a": 0}})
    _run(vs.async_tick())
    live = vi.live_position(h)
    assert (live["x_m"], live["y_m"]) == (6.0, 4.5)          # frac (0.5, 0.25) on a 10 m map at (1, 2)
    assert live["floor_id"] == "main" and vs.pending_list() == []


def test_walker_fills_the_review_pile_and_never_calibration():
    from custom_components.padspan_ha.bluetooth_live import _now
    cal = SimpleNamespace(async_add_point=AsyncMock(return_value={"id": "cp_1"}))
    h = _hass(**{DATA_CALIBRATION: cal})
    vs = _linked(h)
    _ble(h, _now())
    vs.async_read_payload = AsyncMock(return_value={"vacuum_position": {"x": 5000, "y": 2500}})
    for _ in range(4):                                        # standing still on one spot
        _run(vs.async_tick())
    pend = vs.pending_list()
    assert len(pend) == 1                                      # one spot, one candidate
    assert pend[0]["x_m"] == 6.0 and len(pend[0]["scanner_readings"]) == 2
    cal.async_add_point.assert_not_called()                    # NOTHING reaches calibration by itself

    conn = _call(wsv.ws_vacuum_cal_pending_list, h)
    assert [p["id"] for p in conn.result["pending"]] == [pend[0]["id"]]
    conn = _call(wsv.ws_vacuum_cal_pending_accept, h, point_id=pend[0]["id"])
    assert conn.error is None
    cal.async_add_point.assert_awaited_once()
    sent = cal.async_add_point.await_args.args[0]
    assert (sent["x_m"], sent["y_m"], sent["floor_id"]) == (6.0, 4.5, "main")
    assert vs.pending_list() == []


def test_a_moving_robot_or_a_rejected_point_adds_nothing():
    from custom_components.padspan_ha.bluetooth_live import _now
    cal = SimpleNamespace(async_add_point=AsyncMock())
    h = _hass(**{DATA_CALIBRATION: cal})
    vs = _linked(h)
    _ble(h, _now())
    spots = iter([{"vacuum_position": {"x": 1000 * i, "y": 1000}} for i in range(5)])
    vs.async_read_payload = AsyncMock(side_effect=lambda lk: next(spots))
    for _ in range(5):
        _run(vs.async_tick())
    assert vs.pending_list() == []                             # never still: no candidate

    vs.data["pending"] = [{"id": "vp_x", "x_m": 1, "y_m": 1, "floor_id": "main"}]
    conn = _call(wsv.ws_vacuum_cal_pending_reject, h, point_id="vp_x")
    assert conn.result["rejected"] == 1 and vs.pending_list() == []
    cal.async_add_point.assert_not_called()


def test_walker_needs_its_own_switch_and_a_tag():
    from custom_components.padspan_ha.bluetooth_live import _now
    h = _hass()
    vs = _linked(h, walker=False)
    _ble(h, _now())
    vs.async_read_payload = AsyncMock(return_value={"vacuum_position": {"x": 5000, "y": 2500}})
    for _ in range(3):
        _run(vs.async_tick())
    assert vs.pending_list() == []


# ── off by default: nothing changes until the user turns it on ──────────────

def test_defaults_are_off_and_read_nothing():
    h = _hass()
    vs = _vstore(h)
    assert vs.data == {"link": None, "walker": {"enabled": False, "tag": ""}, "pending": []}
    assert vs.link_on() is False
    vs.start()                                                 # no link on: no timer at all
    assert vs._unsub is None
    vs.async_read_payload = AsyncMock()
    _run(vs.async_tick())
    vs.async_read_payload.assert_not_called()
    assert vi.live_position(h) is None
    assert vi.live_position(_hass()) is None                  # no store loaded at all


def test_a_link_that_is_turned_off_stops_the_live_position():
    h = _hass()
    vs = _linked(h, walker=False)
    vs.async_read_payload = AsyncMock(return_value={"vacuum_position": {"x": 5000, "y": 2500}})
    _run(vs.async_tick())
    assert vi.live_position(h)
    vs.data["link"]["enabled"] = False
    assert vi.live_position(h) is None


def test_link_cannot_be_turned_on_without_an_import():
    h = _hass()
    _vstore(h)
    conn = _call(wsv.ws_vacuum_link_set, h, enabled=True)
    assert conn.error[0] == "no_link"


def test_snapshot_only_carries_the_vacuum_when_linked():
    src = (CC / "snapshot_builder.py").read_text(encoding="utf-8")
    block = src[src.index("from .vacuum_import import live_position"):]
    block = block[:block.index("connection.send_result")]
    assert 'if _vac:\n            snap["vacuum"] = _vac' in block
    assert src.count('snap["vacuum"]') == 1


def test_every_vacuum_command_is_admin_only():
    src = (CC / "ws_vacuum.py").read_text(encoding="utf-8")
    cmds = re.findall(r'"type": "padspan_ha/(vacuum_[a-z_]+)"', src)
    assert len(cmds) == len(wsv.HANDLERS) == 7
    for chunk in src.split("@websocket_api.websocket_command(")[1:]:
        head = chunk[:chunk.index("async def")]
        assert "@websocket_api.require_admin" in head


def test_calibration_is_only_ever_written_by_the_accept_handler():
    for name in ("vacuum_import.py", "ws_vacuum.py"):
        src = (CC / name).read_text(encoding="utf-8")
        calls = [m.start() for m in re.finditer(r"\.async_add_point\(", src)]
        if name == "vacuum_import.py":
            assert calls == []
        else:
            assert len(calls) == 1
            assert src.rfind("async def ", 0, calls[0]) == src.index("async def ws_vacuum_cal_pending_accept")
        for forbidden in ("async_delete_point", "async_clear", "async_remap_from_metres", "async_prune"):
            assert forbidden not in src


# ── the panel ───────────────────────────────────────────────────────────────

_WWW = CC / "www" / "padspan-ha"


def test_marker_in_the_3d_house_only_with_a_linked_vacuum():
    import shutil
    import subprocess
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    res = subprocess.run([node, str(Path(__file__).parent / "js" / "vacuum_marker.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, res.stderr[-2000:]
    out = json.loads(lines[-1])
    assert out["cases"] and all(out["cases"].values()), out["failures"]


def test_import_block_sits_beside_the_sh3d_import_and_is_closed_by_default():
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    sh3d = maps.index('"📐 Import floorplan (.sh3d)"')
    hook = maps.index("VACUUM.vacuumImportBlock(ctx, floorId)")
    assert 0 < hook - sh3d < 3000
    assert ".catch(err => { console.warn(\"PadSpan: vacuum_import failed to load\"" in maps
    js = (_WWW / "views" / "vacuum_import.js").read_text(encoding="utf-8")
    assert "open: false" in js and "if (!st.open) return wrap;" in js
    # Nothing is read from the backend until the block is opened.
    head = js[js.index("export function vacuumImportBlock"):js.index("if (!st.open) return wrap;")]
    assert "wsCall" not in head.replace("refresh(ctx)", "")
    # The panel never writes calibration itself: only the accept command does.
    assert "calibration_save_point" not in js and "padspan_ha/vacuum_cal_pending_accept" in js
