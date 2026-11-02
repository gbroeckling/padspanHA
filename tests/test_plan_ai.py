"""Add data via plans, Stage 1a (plan_ai.py, ws_plan_ai.py; experimental, off
by default; 2026-11): the master switch and its upgrade stamp, the store's
registration, the job (budget, caps, cancel reasons, the restart sweep, the
0-1000 trap), the conflation rules, verdicts and rejects, the counters, and
the hard rule: nothing here writes any store but padspan_ha.plan_ai.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import settings_store as SS
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_common
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha import ws_house3d_stairs as S
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.const import (CALIBRATION_STORE_KEY, DATA_MAPS, DATA_MODEL, DATA_PLAN_AI, DATA_SETTINGS,
                                                DOMAIN, FABRIC_STORE_KEY, HOUSE3D_STORE_KEY, MAPS_STORE_KEY,
                                                MODEL_STORE_KEY, PLAN_AI_STORE_KEY, SETTINGS_STORE_KEY)
from tests.test_house3d_edit import _file, _seed, disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_photo import _AiTask, _leftovers, _ready
from tests.test_house3d_store import _run

_MODEL_TEXT = A._model_text
_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_WWW = _ROOT / "www" / "padspan-ha"

# A plan 10 m × 8 m (1 px = 1 cm on a 1000 × 800 picture); the frame it is sent at is 1008 × 812 (frame_of).
_T1 = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0, "scale_y_m": 8.0, "rotation_rad": 0.0,
       "reference_measurements": [{"a": 1}]}
_T2 = {**_T1, "reference_measurements": []}       # placed by eye
_WHOLE = [{"bbox_2d": [100, 200, 200, 600], "says": "UP", "up": "top", "shape": "straight"}]


class _PlanAi(_AiTask):
    """The AI Task, answering by what it is asked: the whole read, the crop
    round a find, or the railing question. `answers` may hold an exception."""

    def __init__(self, media, answers: dict, delay: float = 0.0):
        super().__init__(media, None, delay)
        self.answers = answers

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        text = data["instructions"]
        key = "rail" if "handrail" in text else "crop" if "crop of a floor plan" in text else "whole"
        self.answer = self.answers.get(key)
        if callable(self.answer):                     # answers by the call, for a retry or a moment in the run
            self.answer = self.answer()
        self.calls.append((domain, service, data))
        if self.delay:
            await asyncio.sleep(self.delay)
        if isinstance(self.answer, BaseException):
            raise self.answer
        return {"conversation_id": "c1", "data": self.answer}


def _house(monkeypatch, tmp_path, answers=None, *, plans=(("m1", "Main", "main", _T1), ("m2", "Upper", "upper", _T1)),
           floors=({"id": "main", "name": "Main"}, {"id": "upper", "name": "Upper"}), platform="ollama", pieces=None):
    from PIL import Image
    h, conn, _ai, media = _ready(monkeypatch, tmp_path, answer="[]", platform=platform)
    monkeypatch.setattr(A, "_model_text", lambda hass, eid: "qwen2.5vl:7b")
    ai = _PlanAi(media, answers or {"whole": _WHOLE, "crop": {"present": True}, "rail": {"rail": "no", "side": "none"}})
    h.services.async_call = ai
    st = h.data[DOMAIN][DATA_SETTINGS].data
    st["ai_plans_enabled"] = True
    st["telemetry_enabled"] = True
    conn.user = SimpleNamespace(is_admin=True, name="Garry")
    plan = tmp_path / "plan.png"
    Image.new("RGB", (1000, 800), "white").save(plan)
    maps = [{"id": mid, "name": name, "floor_id": fid, "image": {"filename": "plan.png", "sha256": "abc"}, "updated": "2026-11-02T10:00:00"}
            for mid, name, fid, _t in plans]
    h.data[DOMAIN][DATA_MAPS] = SimpleNamespace(
        list_maps=lambda: maps, get_map=lambda mid: next((m for m in maps if m["id"] == mid), None),
        image_file=lambda fn, must_exist: plan if fn == "plan.png" else None)
    tf = {mid: t for mid, _n, _f, t in plans}
    elev = {f["id"]: i * 2.8 for i, f in enumerate(floors)}
    h.data[DOMAIN][DATA_MODEL] = SimpleNamespace(
        map_transform=lambda mid: tf.get(mid),
        map_frac_to_metres=lambda fx, fy, mid: (fx * tf[mid]["scale_x_m"], fy * tf[mid]["scale_y_m"]) if mid in tf else None,
        floors=lambda: list(floors), floor_base_elevations_m=lambda: dict(elev))
    if pieces is not None:
        _seed(tmp_path, {"schema": 1, "pieces": pieces, "lights": {}, "openings": {}, "devices": {}, "figures": {}, "library": {}})
    h.data[DOMAIN].pop(DATA_PLAN_AI, None)
    return h, conn, ai, media


def _call(fn, h, conn, **kw):
    conn.send_result.reset_mock()
    conn.send_error.reset_mock()
    _run(fn(h, conn, {"id": 5, "type": "x", **kw}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


async def _session(h, map_ids=("m1", "m2"), kinds=("stairs", "railing"), *, before=None):
    """Start a session as the command does and run its job to the end."""
    store = await A.async_get_store(h)
    ai = P.ai_task(h, with_backup=True)
    plans = [p for p in A.plans(h) if p["map_id"] in map_ids]
    sid = "ps_test"
    sess = A.new_session(ai, plans, list(kinds), False, A.frame_kind(h, ai["ai_task"]))
    store.data["sessions"][sid] = sess
    await store.async_save()
    job = A.Job(sid)
    h.data[DOMAIN][A._DATA_JOB] = job
    runner = A.Runner(h, store, job, ai)
    if before:
        before(runner, job)
    await runner.run()
    return store, store.session(sid), sid


def _stair(pid, fid, x, y, label="Stairs", to=None):
    params = {"shape": "straight", "style": "closed", "rail": "none"}
    if to:
        params["to_floor"] = to
    return {"id": pid, "floor_id": fid, "x_m": x, "y_m": y, "z_m": 0.0, "rotation": 0.0, "origin": "build", "label": label,
            "recipe": {"kind": "stairs", "params": params, "width_m": 1.0, "depth_m": 3.0, "height_m": 2.8}}


# ═══ the switch ══════════════════════════════════════════════════════════════

def test_the_switch_is_off_by_default_in_the_schema_bool_coerced_and_an_administrators():
    from custom_components.padspan_ha import websocket as ws
    assert SS.DEFAULT_SETTINGS["ai_plans_enabled"] is False
    assert "ai_plans_enabled" in {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    src = (_ROOT / "ws_settings.py").read_text(encoding="utf-8")
    assert '"ai_stairs_enabled", "ai_plans_enabled",' in src                      # the bool list
    assert '"ai_plans_enabled" in msg' in src                                      # the admin-only group
    assert "ai_plans_enabled" in T._FEATURE_ON_ONLY and T._FEATURE_ON_ONLY["ai_plans_enabled"] == "ai_plans"


def test_the_upgrade_stamp_turns_it_on_where_the_stair_finder_was_once():
    data = {}
    assert SS.ai_plans_stamp(data, {"ai_stairs_enabled": True}) and data == {"ai_plans_enabled": True}
    data = {}
    assert SS.ai_plans_stamp(data, {"ai_stairs_enabled": False}) and data == {"ai_plans_enabled": False}
    data = {}
    assert SS.ai_plans_stamp(data, {}) and data == {"ai_plans_enabled": False}
    # Decided once: a stored choice, either way, is kept; a fresh install (no file) sets nothing (the default is False).
    data = {"ai_plans_enabled": False}
    assert not SS.ai_plans_stamp(data, {"ai_stairs_enabled": True, "ai_plans_enabled": False}) and data["ai_plans_enabled"] is False
    assert not SS.ai_plans_stamp({}, None)


def test_the_stamp_runs_from_the_settings_load_and_from_a_restore(monkeypatch, disk, tmp_path):
    """From async_load (B11): a settings file from before the switch, with the
    stair finder on, loads with the master switch on and is re-saved with it;
    and the restore merge (ws_backup) calls the same helper, since a restore
    hot-patches the data without a load."""
    from tests.test_telemetry import _hass
    _seed(tmp_path, {"ai_stairs_enabled": True, "atlas_default_v1_applied": True, "first_seen_ts": 1.0}, SETTINGS_STORE_KEY)
    h = _hass()
    h.config.path = lambda *parts: str(tmp_path.joinpath(*parts))

    async def _executor(fn, *args):
        return fn(*args)
    h.async_add_executor_job = _executor
    monkeypatch.setattr(SS, "Store", disk)
    store = SS.SettingsStore(h)
    data = _run(store.async_load())
    assert data["ai_plans_enabled"] is True
    assert json.loads(_file(tmp_path, SETTINGS_STORE_KEY).read_text(encoding="utf-8"))["data"]["ai_plans_enabled"] is True
    src = (_ROOT / "ws_backup.py").read_text(encoding="utf-8")
    at = src.index("ai_plans_stamp(data, data)")
    assert src.rindex("atlas_default_v1_applied", 0, at) > 0 and "from .settings_store import ai_plans_stamp" in src[:at]


# ═══ off hides everything ════════════════════════════════════════════════════

def test_every_command_refuses_while_the_switch_live_aboard_or_pro_is_off(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    st = h.data[DOMAIN][DATA_SETTINGS].data
    cmds = {W.ws_plan_ai_plans: {}, W.ws_plan_ai_start: {"map_ids": ["m1"], "kinds": ["stairs"], "backup_ok": False},
            W.ws_plan_ai_status: {}, W.ws_plan_ai_cancel: {"session": "x"},
            W.ws_plan_ai_verdict: {"session": "x", "rev": 1, "sug_id": "s", "v": "later"},
            W.ws_plan_ai_rejects_get: {}, W.ws_plan_ai_reject_forget: {"key": "k"}, W.ws_plan_ai_sessions_get: {}}
    st["ai_plans_enabled"] = False
    for fn, kw in cmds.items():
        assert _call(fn, h, conn, **kw)["error"] == S.PLANS_OFF_CODE, fn.__name__
    st["ai_plans_enabled"] = True
    st["atlas_3d_enabled"] = False
    for fn, kw in cmds.items():
        assert _call(fn, h, conn, **kw)["error"] == "house3d_off", fn.__name__
    st["atlas_3d_enabled"] = True
    st["forensics_license_key"] = ""
    for fn, kw in cmds.items():
        out = _call(fn, h, conn, **kw)
        assert out["error"] == "house3d_off" and "Pro" in out["message"], fn.__name__
    assert ai.calls == [] and disk.writes == [] and DATA_PLAN_AI not in h.data[DOMAIN]


def test_every_command_is_an_administrators_registered_and_a_read_in_sample_mode():
    src = (_ROOT / "ws_plan_ai.py").read_text(encoding="utf-8")
    names = re.findall(r"async def (ws_plan_ai_[a-z_]+)\(", src)
    assert len(names) == 8 and set(names) == {fn.__name__ for fn in W.WS_COMMANDS}
    for name in names:
        head = src.split(f"async def {name}(", 1)[0].rsplit("@websocket_api.websocket_command", 1)[1]
        assert "@websocket_api.require_admin" in head, name
    assert "from .ws_plan_ai import WS_COMMANDS" in (_ROOT / "websocket.py").read_text(encoding="utf-8")
    # Sample mode: the two reads are answered empty, everything else is a write and refused (panel.js _sampleKind).
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    reads = panel[panel.index("const READS = new Set("):panel.index('.split(" ").map(t => "padspan_ha/" + t));')]
    assert "plan_ai_plans plan_ai_status" in reads and "plan_ai_start" not in reads and "plan_ai_verdict" not in reads


def test_the_stair_finders_loop_stops_on_the_master_code_and_its_menu_item_follows_the_switch():
    src = (_WWW / "views" / "live_aboard_furnish.js").read_text(encoding="utf-8")
    assert 'e.code === "ai_plans_off" || e.code === "ai_stairs_off" || e.code === "no_ai_task"' in src
    assert 'hs.ai_plans_enabled === true && hs.ai_stairs_enabled === true' in src
    # The Plans tool: the host hands it only with the switch on, an AI Task chosen, Edit on offer, and not on the sample house.
    card = (_WWW / "views" / "lights_map.js").read_text(encoding="utf-8")
    assert 'plans: h3.settings.ai_plans_enabled === true && h3.sample !== true && String(h3.settings.atlas_3d_ai_task_entity || "").startsWith("ai_task.")' in card
    assert 'typeof h3.edit === "function"' in card[card.index("plans: h3.settings.ai_plans_enabled"):card.index("setTopFloor:")]
    assert 'sample: ctx.state.dataMode !== "live"' in (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    # The module loads only when the editor asks, and nothing imports it statically.
    for path in (_WWW / "views").glob("*.js"):
        assert not re.search(r"^\s*import\b[^\n]*live_aboard_plans", path.read_text(encoding="utf-8"), re.M), path.name
    assert "loadPlans: () => import(`./live_aboard_plans.js" in (_WWW / "views" / "live_aboard.js").read_text(encoding="utf-8")


def test_the_settings_row_is_first_chipped_and_its_rows_hide_while_off():
    src = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    body = src[src.index('feats.appendChild(el("div",{class:"h2"}, "What it does for you"))'):]
    assert body.index("AI map-building research (experimental)") < body.index('"ai_photos_enabled", "Furniture from a photo"')
    assert body.index('"data-ai-plans-under":""') < body.index('"ai_stairs_enabled", "Stairs from your floor plans"') < body.index('"ai_photos_enabled", "Furniture from a photo"')
    assert '"EXPERIMENTAL"' in body and 'display:${settings.ai_plans_enabled === true ? "" : "none"}' in body
    assert "Turning it off hides it; it does not undo what you kept." in body


def test_only_an_administrator_changes_the_switch(monkeypatch, tmp_path, disk):
    from custom_components.padspan_ha import ws_settings
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data["ai_plans_enabled"] = False
    conn.user = SimpleNamespace(is_admin=False, name="Nicole")
    out = _call(ws_settings.ws_settings_set, h, conn, ai_plans_enabled=True)
    assert "error" in out and st.data["ai_plans_enabled"] is False


# ═══ the store ═══════════════════════════════════════════════════════════════

def test_the_store_is_registered_for_backup_restore_and_reset_like_sub_zones():
    assert PLAN_AI_STORE_KEY in ws_common._BACKUP_ONLY_ONCE_WRITTEN
    assert ws_common._DATA_KEY_MAP[PLAN_AI_STORE_KEY] == DATA_PLAN_AI
    assert PLAN_AI_STORE_KEY in ws_common._ALL_STORE_KEYS
    src = (_ROOT / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert "_St(hass, 1, PLAN_AI_STORE_KEY).async_save(_plan_ai_empty())" in src and "pa_obj.data = _plan_ai_empty()" in src


def test_a_restore_and_a_factory_reset_reach_the_store(monkeypatch, tmp_path, disk):
    """Run, not read: a backup holds the store once it is written, a restore
    replaces what the running store holds, and a reset empties file and store."""
    from custom_components.padspan_ha import ws_backup
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    from tests.test_backup_store_locks import _restore_msg
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))
    assert not _run(ws_common._store_file_written(h, PLAN_AI_STORE_KEY))     # no session yet: no file, and no entry in a backup
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    assert _run(ws_common._store_file_written(h, PLAN_AI_STORE_KEY))
    saved = copy.deepcopy(store.data)
    store.data["rejects"]["k"] = {"kind": "stairs"}
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {**_restore_msg(monkeypatch, {PLAN_AI_STORE_KEY: saved}), "store_keys": [PLAN_AI_STORE_KEY]}))
    assert h.data[DOMAIN][DATA_PLAN_AI].data == saved and h.data[DOMAIN][DATA_PLAN_AI] is store
    _run(ws_factory_reset(h, MagicMock(), {"id": 1, "confirm": "FACTORY RESET"}))
    assert store.data == A.empty()
    assert json.loads(_file(tmp_path, PLAN_AI_STORE_KEY).read_text(encoding="utf-8"))["data"] == A.empty()


def test_a_real_restore_of_a_backup_from_before_the_switch_stamps_it(monkeypatch, tmp_path, disk):
    from custom_components.padspan_ha import ws_backup
    from tests.test_backup_store_locks import _restore_msg
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data["ai_plans_enabled"] = False
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {**_restore_msg(monkeypatch, {SETTINGS_STORE_KEY: {"ai_stairs_enabled": True, "quiet_mode": True}}),
                                                            "store_keys": [SETTINGS_STORE_KEY]}))
    assert st.data["quiet_mode"] is True and st.data["ai_plans_enabled"] is True
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {**_restore_msg(monkeypatch, {SETTINGS_STORE_KEY: {"ai_stairs_enabled": True, "ai_plans_enabled": False}}),
                                                            "store_keys": [SETTINGS_STORE_KEY]}))
    assert st.data["ai_plans_enabled"] is False                               # a backup that has the key keeps its choice


def test_the_store_reads_tolerantly_sweeps_a_restart_and_never_writes_a_newer_file(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    assert A.normalise(None) == A.empty() and A.normalise({"schema": 1, "sessions": 3})["sessions"] == {}
    newer = A.normalise({"schema": 7, "sessions": "whatever", "extra": 1})
    assert newer == {"schema": 7, "sessions": "whatever", "extra": 1} and not A.writable(newer)
    # A session still running when Home Assistant stopped is failed (restart) on the next load, and counted.
    _seed(tmp_path, {"schema": 1, "sessions": {"ps_a": {"rev": 3, "status": "running", "started_at": 1.0, "plans": [], "suggestions": {}}},
                     "batches": {}, "rejects": {}}, PLAN_AI_STORE_KEY)
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    store = _run(A.async_get_store(h))
    s = store.session("ps_a")
    assert s["status"] == "failed" and s["error"] == "restart" and s["rev"] == 4
    assert disk.writes == [PLAN_AI_STORE_KEY] and counted == ["plan_ai_session:failed", "plan_ai_cancel_why:restart"]
    # A newer PadSpan's file is read and kept, and a save does nothing to it.
    h.data[DOMAIN].pop(DATA_PLAN_AI)
    _seed(tmp_path, {"schema": 9, "future": True}, PLAN_AI_STORE_KEY)
    store = _run(A.async_get_store(h))
    assert store.data == {"schema": 9, "future": True} and _run(store.async_save()) is False
    assert disk.writes == [PLAN_AI_STORE_KEY]


# ═══ the job ═════════════════════════════════════════════════════════════════

def test_a_session_reads_each_plan_places_each_find_and_keeps_nothing_but_the_store(monkeypatch, tmp_path, disk):
    """Two plans; the whole read finds one staircase on each, the crop places
    it, the railing question answers yes with a side. The finds go through
    the plan's placement to metres; the two plans' finds (Upper's on the
    floor below, Main's on Main) merge as one seen on both (the floor
    relation agrees). The plan's picture is sent only to the AI Task and
    leaves no file; the only store written is padspan_ha.plan_ai."""
    rail = {"rail": "yes", "side": "left"}
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": _WHOLE, "crop": {"present": True, "bbox_2d": [400, 300, 600, 700]},
                                                        "rail": rail})
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    store, sess, sid = _run(_session(h))
    assert sess["status"] == "done" and sess["error"] is None and sess["frame"] == "probed" and sess["local"] is True
    assert sess["reads"] == 6 and sess["timeouts"] == 0 and sess["errors"] == {} and all(p["read"] for p in sess["plans"])
    assert [p["frame"] for p in sess["plans"]] == [[1008, 812], [1008, 812]]
    sugs = list(sess["suggestions"].values())
    stairs = [s for s in sugs if s["kind"] == "stairs"]
    rails = [s for s in sugs if s["kind"] == "railing"]
    assert len(stairs) == 1 and len(rails) == 1
    st = stairs[0]
    # Upper's find says UP on the top floor: it belongs to Main; Main's find is on Main: one staircase, seen on both plans.
    assert st["floor_id"] == "main" and {s["map_id"] for s in st["seen_on"]} == {"m1", "m2"}
    # The whole read put it at (1.5, 3.9); the crop (8 m across round it, clipped at the plan's edge, sent at
    # its own frame) boxed it further in, and its centre, through the crop's bounds, re-placed the find.
    assert st["reads"] == ["whole", "crop"] and abs(st["geom"]["x_m"] - 3.4) < 0.5 and abs(st["geom"]["y_m"] - 3.4) < 0.5
    assert st["geom"]["sure_up"] is True and st["match"]["relation"] == "new" and st["state"] == "queued"
    assert st["box_px"] == [100.0, 200.0, 200.0, 600.0] and st["frame"] == [1008, 812]
    assert rails[0]["geom"] == {"stair": st["id"], "side": "left", "x_m": st["geom"]["x_m"], "y_m": st["geom"]["y_m"]} and rails[0]["state"] == "queued"
    # Every call carried a JPEG made here and named its size; the plan itself never went anywhere else.
    for (_d, _s, data), (f, seen) in zip(ai.calls, ai.seen):
        assert "structure" not in data and data["task_name"] == "PadSpan plans" and seen[:3] == bytes.fromhex("ffd8ff")
        assert re.search(r"\d+ by \d+ pixels", data["instructions"])
    assert _leftovers(media) == []
    assert set(disk.writes) == {PLAN_AI_STORE_KEY}
    # Counted: the session, the model, the frame, the plans band, each read's time, what was suggested, the reads band.
    assert counted.count("plan_ai_session:started") == 1 and counted.count("plan_ai_session:done") == 1
    assert "plan_ai_model:local" in counted and "plan_ai_frame:probed" in counted and "plan_ai_plans:2_3" in counted
    assert counted.count("plan_ai_read_secs:lt5") == 6 and "plan_ai_reads:6_15" in counted
    assert counted.count("plan_ai_suggested:stairs") == 1 and counted.count("plan_ai_suggested:railing") == 1
    assert counted.count("plan_ai_crop:placed") == 2
    assert "finds" not in sess                                # matched: the suggestions hold what is kept
    assert all(T.event_allowed(e) for e in counted if e.startswith("plan_ai_")), counted


def test_a_railing_hint_carries_no_side_unless_the_arrow_was_read(monkeypatch, tmp_path, disk):
    whole = [{"bbox_2d": [100, 200, 200, 600], "says": "", "up": "unsure"}]
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}},
                                plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",)))
    rails = [s for s in sess["suggestions"].values() if s["kind"] == "railing"]
    assert len(rails) == 1 and rails[0]["geom"]["side"] is None
    assert A.rail_of("Yes, there is a rail on the left.") == (True, None) and A.rail_of("no rail") == (False, None)
    assert A.rail_of({"rail": "yes", "side": "both"}) == (True, "both") and A.rail_of('{"rail":"no","side":"left"}') == (False, "left")


def test_the_local_cap_the_two_timeouts_rule_and_the_budget(monkeypatch, tmp_path, disk):
    """A local AI Task gets PLAN_READ_LOCAL_S a read, passed as timeout_s to
    ask_ai; two timeouts in a row end the session out_of_time (what was read
    is kept); no read starts with less than READ_MIN_S of the budget left."""
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    seen = []
    real = P.ask_ai

    async def spy(hass, ai_, instructions, structure, raw, mime, task_name="x", *, count=True, timeout_s=None):
        seen.append(timeout_s)
        return await real(hass, ai_, instructions, structure, raw, mime, task_name, count=count, timeout_s=timeout_s)
    monkeypatch.setattr(P, "ask_ai", spy)
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    assert sess["status"] == "done" and seen and all(t == A.PLAN_READ_LOCAL_S for t in seen)
    # Two timeouts in a row: out_of_time, the first plan's whole read lost, the second plan never asked.
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": TimeoutError(), "crop": TimeoutError(), "rail": TimeoutError()})
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    store, sess, sid = _run(_session(h))
    assert sess["status"] == "out_of_time" and sess["timeouts"] == 2 and sess["errors"] == {"timeout": 2}
    assert len(ai.calls) == 2 and counted.count("plan_ai_error:timeout") == 2 and "plan_ai_session:out_of_time" in counted
    # The budget spent before the second plan: it is skipped, counted, and the session is out_of_time.
    h, conn, ai, media = _house(monkeypatch, tmp_path)

    def spend(runner, job):
        runner.t0 -= A.PLAN_BUDGET_S - P.READ_MIN_S - 1
        orig = runner.read_plan

        async def once(pl, i):
            out = await orig(pl, i)
            runner.t0 -= 10
            return out
        runner.read_plan = once
    store, sess, sid = _run(_session(h, before=spend))
    assert sess["status"] == "out_of_time" and sess["skipped"] == 1 and sess["errors"].get("budget") == 1
    assert sess["plans"][0]["read"] and not sess["plans"][1]["read"] and len(sess["suggestions"]) >= 1


@pytest.mark.parametrize("how,why", [("switch", "switch_off"), ("house3d", "house3d_off"), ("licence", "licence"),
                                     ("gone", "plan_gone"), ("moved", "plan_changed"), ("cancel", "user")])
def test_a_failed_check_between_reads_ends_the_session_cancelled_with_its_reason(monkeypatch, tmp_path, disk, how, why):
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    st = h.data[DOMAIN][DATA_SETTINGS].data
    maps = h.data[DOMAIN][DATA_MAPS]

    def after_first(runner, job):
        orig = runner.read_plan

        async def once(pl, i):
            out = await orig(pl, i)
            if how == "switch":
                st["ai_plans_enabled"] = False
            elif how == "house3d":
                st["atlas_3d_enabled"] = False
            elif how == "licence":
                st["forensics_license_key"] = ""
            elif how == "gone":
                maps.list_maps().pop()
            elif how == "moved":
                h.data[DOMAIN][DATA_MODEL].map_transform = lambda mid: {**_T1, "origin_x_m": 2.0}
            elif how == "cancel":
                job.cancel = True
            return out
        runner.read_plan = once
    store, sess, sid = _run(_session(h, before=after_first))
    assert sess["status"] == "cancelled" and sess["error"] == why
    assert sess["plans"][0]["read"] and not sess["plans"][1]["read"]
    assert len(sess["suggestions"]) >= 1                      # what was read is kept and matched
    assert f"plan_ai_cancel_why:{why}" in counted and "plan_ai_session:cancelled" in counted


def test_a_model_answering_0_to_1000_on_a_bigger_frame_is_held_as_suspect(monkeypatch, tmp_path, disk):
    assert A.suspect_frame([{"bbox_2d": [100, 200, 950, 600]}], 1008, 812)
    assert not A.suspect_frame([{"bbox_2d": [100, 200, 950, 600]}], 1000, 800)      # the frame is not over 1000
    assert not A.suspect_frame([{"bbox_2d": [100, 200, 1004, 600]}], 1008, 812)     # past 1000: the real frame
    assert not A.suspect_frame([{"bbox_2d": [100, 200, 300, 600]}], 1008, 812)      # nothing near the edge
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": [{"bbox_2d": [100, 300, 200, 920]}], "crop": {"present": True}, "rail": {"rail": "no"}},
                                plans=(("m1", "Main", "main", _T1),))
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    assert sess["plans"][0]["suspect"] is True and sess["errors"].get("suspect_frame") == 1
    [sug] = sess["suggestions"].values()
    assert sug["match"]["held"] == "suspect" and "plan_ai_held:suspect" in counted


def test_a_named_frame_holds_corrections_and_a_cloud_task_gets_the_photo_cap(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, platform="openai_conversation",
                                pieces={"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0)})
    seen = []
    real = P.ask_ai

    async def spy(hass, ai_, instructions, structure, raw, mime, task_name="x", *, count=True, timeout_s=None):
        seen.append(timeout_s)
        return await real(hass, ai_, instructions, structure, raw, mime, task_name, count=count, timeout_s=timeout_s)
    monkeypatch.setattr(P, "ask_ai", spy)
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    assert sess["frame"] == "named" and sess["local"] is False and all(t == P.PHOTO_TIMEOUT_S for t in seen)
    [sug] = sess["suggestions"].values()
    # 1.5 m from the one stair on Main: a correction on a probed frame; held on a named one, and offered as new.
    assert sug["match"]["held"] == "frame" and sug["match"]["relation"] == "new" and sug["match"]["target"] == "fur_00000001"


def test_a_cancel_during_the_last_plans_reads_still_ends_the_session_cancelled(monkeypatch, tmp_path, disk):
    """The check between the crop and the railing of the very last plan: there
    is no next plan to notice it, and the session must not end "done"."""
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))
    job_of = {}

    def crop():
        job_of["job"].cancel = True
        return {"present": True}
    ai.answers = {"whole": _WHOLE, "crop": crop, "rail": {"rail": "yes"}}
    store, sess, sid = _run(_session(h, ("m1",), before=lambda runner, job: job_of.update(job=job)))
    assert sess["status"] == "cancelled" and sess["error"] == "user"
    assert [s["kind"] for s in sess["suggestions"].values()] == ["stairs"]            # what was read is kept; no railing read after it


def test_the_budget_running_out_inside_the_last_plan_is_out_of_time_not_done(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))

    def spend(runner, job):
        real = runner.ask

        async def ask(prompt, raw):
            out = await real(prompt, raw)
            runner.t0 -= A.PLAN_BUDGET_S                          # the whole read happens, then nothing is left for a crop
            return out
        runner.ask = ask
    store, sess, sid = _run(_session(h, ("m1",), before=spend))
    assert sess["status"] == "out_of_time" and len(ai.calls) == 1
    [sug] = sess["suggestions"].values()
    assert sug["reads"] == ["whole"] and sug["state"] == "queued"                     # kept as the whole read had it


def test_every_plans_whole_read_comes_before_any_crop_and_every_crop_before_any_railing(monkeypatch, tmp_path, disk):
    """The design's order, so a slow AI loses the extras and not a plan."""
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": [{"bbox_2d": [100, 200, 200, 600], "says": "UP", "up": "top"}, {"bbox_2d": [600, 200, 700, 600], "says": "UP", "up": "top"}],
                                                        "crop": {"present": True}, "rail": {"rail": "yes", "side": "left"}},
                                plans=(("m1", "Main", "main", _T1), ("m2", "Valance", "main", _T1)))
    store, sess, sid = _run(_session(h))
    what = ["rail" if "handrail" in d["instructions"] else "crop" if "crop of a floor plan" in d["instructions"] else "whole" for _d, _s, d in ai.calls]
    assert what == ["whole"] * 2 + ["crop"] * 4 + ["rail"] * 4, what
    assert sess["status"] == "done" and sess["reads"] == 10


def test_the_second_look_drops_a_find_it_says_isnt_there_and_retries_an_answer_it_cant_read(monkeypatch, tmp_path, disk):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    # "present": false: left out, said on the sheet, counted, and no railing question about it.
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": _WHOLE, "crop": '{"present": false}', "rail": {"rail": "yes"}},
                                plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",)))
    assert sess["suggestions"] == {} and sess["crop_dropped"] == 1 and "plan_ai_crop:dropped" in counted
    assert len(ai.calls) == 2 and sess["status"] == "done"
    # Text it can't read, twice: one retry, counted bad_answer, and the find stays where the whole read put it.
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": _WHOLE, "crop": "I think so", "rail": {"rail": "no"}},
                                plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    [sug] = sess["suggestions"].values()
    assert len(ai.calls) == 3 and sess["errors"] == {"bad_answer": 1} and sug["reads"] == ["whole"]
    # A whole read it can't read, then a good one: the one retry saves it.
    answers = iter(["{not json", _WHOLE])
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": lambda: next(answers), "crop": {"present": True}, "rail": {"rail": "no"}},
                                plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    assert len(ai.calls) == 3 and len(sess["suggestions"]) == 1 and sess["errors"] == {}


def test_the_crop_answer_is_reduced_to_a_yes_and_a_centre():
    assert A.crop_answer({"present": False}, 100, 100) == (False, None)
    assert A.crop_answer('```json\n{"present": true, "bbox_2d": [10, 20, 30, 40]}\n```', 100, 100) == (True, (0.2, 0.3))
    assert A.crop_answer({"present": True, "bbox_2d": [30, 40, 10, 20]}, 100, 100) == (True, (0.2, 0.3))
    assert A.crop_answer({"present": True}, 100, 100) == (True, None)
    assert A.crop_answer({"present": True, "bbox_2d": [10, 20, 500, 40]}, 100, 100) == (True, None)   # another frame's box
    assert A.crop_answer("a staircase, I think", 100, 100) is None and A.crop_answer([1], 100, 100) is None


def test_the_crop_round_a_find_is_the_measured_one(monkeypatch, tmp_path, disk):
    """2.5 × the find's long side, 3 to 8 m, clipped to the plan; sent no bigger than 768 before the frame."""
    from PIL import Image
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": [{"bbox_2d": [504, 406, 574, 466]}], "crop": {"present": True}, "rail": {"rail": "no"}},
                                plans=(("m1", "Main", "main", _T1),))
    sizes = []
    real = A.crop

    def spy(path, cx, cy, hx, hy):
        sizes.append((hx * 10 * 2, hy * 8 * 2))
        return real(path, cx, cy, hx, hy)
    monkeypatch.setattr(A, "crop", spy)
    _run(_session(h, ("m1",), ("stairs",)))
    assert sizes and all(abs(a - 3.0) < 1e-6 for a in sizes[0])                        # a small find: the 3 m floor
    plan = tmp_path / "p.png"
    Image.new("RGB", (4000, 3200), "white").save(plan)
    raw, w, h_, bounds = A.crop(plan, 0.5, 0.5, 0.25, 0.25)
    assert (w, h_) == S.frame_of(768, 614) and bounds == (0.25, 0.25, 0.75, 0.75) and raw[:3] == bytes.fromhex("ffd8ff")


def test_the_frame_is_probed_only_for_ollama_with_a_qwen25(monkeypatch, tmp_path, disk):
    import homeassistant.helpers.entity_registry as er
    monkeypatch.setattr(er, "async_get", lambda hass: SimpleNamespace(async_get=lambda eid: SimpleNamespace(
        name=None, original_name=None, config_entry_id="e1", config_subentry_id="s1")), raising=False)
    h = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lambda i: SimpleNamespace(
        subentries={"s1": SimpleNamespace(data={"model": "qwen2.5vl:7b"})}, options={}, data={})))
    assert "qwen2.5vl:7b" in _MODEL_TEXT(h, "ai_task.vision")
    monkeypatch.setattr(P, "_platform", lambda hass, eid: "ollama")
    assert A.frame_kind(h, "ai_task.vision") == "probed"
    h2 = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lambda i: SimpleNamespace(subentries={}, options={"model": "qwen3-vl"}, data={})))
    assert A.frame_kind(h2, "ai_task.vision") == "named"                               # Qwen3 answers 0-1000 by design
    assert A.frame_kind(h2, "ai_task.vision_mac_qwen2_5vl") == "probed"                # the entity's own name says so
    monkeypatch.setattr(P, "_platform", lambda hass, eid: "openai_conversation")
    assert A.frame_kind(h, "ai_task.vision") == "named"
    monkeypatch.setattr(er, "async_get", lambda hass: 1 / 0, raising=False)            # nothing to read: named
    monkeypatch.setattr(P, "_platform", lambda hass, eid: "ollama")
    assert A.frame_kind(h, "ai_task.vision") == "named"


def test_a_read_by_the_backup_holds_the_session_as_a_named_frame(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),),
                                pieces={"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0)})
    real = P.ask_ai

    async def by_backup(hass, ai_, *a, **kw):
        answer, _by = await real(hass, ai_, *a, **kw)
        return answer, "ai_task.cloud"
    monkeypatch.setattr(P, "ask_ai", by_backup)
    monkeypatch.setattr(A, "frame_kind", lambda hass, eid: "probed" if eid != "ai_task.cloud" else "named")
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    assert sess["backup_used"] is True and sess["frame"] == "named"
    [sug] = sess["suggestions"].values()
    assert sug["match"]["held"] == "frame" and sug["match"]["relation"] == "new"


def test_home_assistant_stopping_leaves_the_session_for_the_restart_sweep(monkeypatch, tmp_path, disk):
    """HA cancels a background task at stop: nothing is said to be the person's
    cancel, the file still says running, and the next load says restart."""
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))
    ai.delay = 30.0

    async def go():
        store = await A.async_get_store(h)
        aitask = P.ai_task(h, with_backup=True)
        loop = asyncio.get_running_loop()
        h.async_create_background_task = lambda coro, name: loop.create_task(coro)
        sid = A.start(h, store, aitask, A.plans(h), ["stairs"], False, "probed")
        await asyncio.sleep(0.05)
        job = A.running(h)
        job.task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job.task
        return sid
    sid = asyncio.new_event_loop().run_until_complete(go())
    on_disk = json.loads(_file(tmp_path, PLAN_AI_STORE_KEY).read_text(encoding="utf-8"))["data"]
    assert on_disk["sessions"][sid]["status"] == "running"
    h.data[DOMAIN].pop(DATA_PLAN_AI)
    s = _run(A.async_get_store(h)).session(sid)
    assert s["status"] == "failed" and s["error"] == "restart" and "finds" not in s


def test_status_says_a_session_with_no_job_behind_it_is_over_but_never_the_running_one(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))
    store = _run(A.async_get_store(h))
    store.data["sessions"]["ps_old"] = {"rev": 1, "status": "running", "started_at": 1.0, "plans": [], "suggestions": {}}
    out = _call(W.ws_plan_ai_status, h, conn, session="ps_old")
    assert out["session"]["status"] == "failed" and out["session"]["error"] == "restart"
    assert A.sweep_restart({"sessions": {"a": {"status": "running"}, "b": {"status": "running"}}}, keep="a") == 1


# ═══ conflation ══════════════════════════════════════════════════════════════

def _st(pid, fid, x, y, to=None, hand=True):
    return {"id": pid, "floor_id": fid, "x_m": x, "y_m": y, "rotation": 0.0, "to_floor": to, "label": "Stairs" if hand else "Stairs (AI first guess)", "hand": hand}


def test_within_a_metre_is_a_duplicate_whatever_the_shape_one_candidate_further_is_a_correction_two_are_new():
    a, b = _st("a", "main", 0.0, 0.0), _st("b", "main", 2.0, 0.0)
    assert A.classify("main", "upper", 0.9, 0.0, [a], set())["relation"] == "duplicate"
    c = A.classify("main", "upper", 1.5, 0.0, [a], set())
    assert c["relation"] == "correction" and c["target"] == "a" and c["distance_m"] == 1.5 and c["target_snap"]["x_m"] == 0.0
    assert A.classify("main", "upper", 2.6, 0.0, [a], set())["relation"] == "new"
    two = A.classify("main", "upper", 1.0, 0.0, [a, b], set())
    assert two["relation"] == "new" and two["target"] is None and set(two["near"]) == {"a", "b"} and two["near_names"] == ["Stairs", "Stairs"]
    # Another floor's stairs are never candidates.
    assert A.classify("main", "upper", 0.0, 0.0, [_st("u", "upper", 0.0, 0.0)], set())["relation"] == "new"


def test_a_stacked_stairwell_is_offered_not_swallowed():
    a = _st("a", "main", 0.0, 0.0)
    # Its candidate already matched this session, or a stair within reach going to another floor: "stacked?", the floor open.
    assert A.classify("main", "upper", 0.5, 0.0, [a], {"a"})["relation"] == "stacked"
    other = A.classify("main", "upper", 0.5, 0.0, [_st("d", "main", 0.0, 0.0, to="basement")], set())
    assert other["relation"] == "stacked" and other["target"] == "d"
    # A named to_floor that agrees with what the find implies is a plain candidate.
    assert A.classify("main", "upper", 0.5, 0.0, [_st("e", "main", 0.0, 0.0, to="upper")], set())["relation"] == "duplicate"


def test_never_merge_two_finds_from_one_plan_and_across_plans_only_on_agreeing_floors_or_overlap():
    base = {"rotation": 0.0, "width_m": 1.0, "depth_m": 3.0, "shape": "straight", "sure_up": True, "box_px": [0, 0, 1, 1], "frame": [1, 1], "reads": ["whole"]}
    f = lambda mid, pf, fid, x, y, says: {**base, "map_id": mid, "plan_floor": pf, "floor_id": fid, "x_m": x, "y_m": y, "says": says}  # noqa: E731
    # One plan, two finds 0.5 m apart: two.
    assert len(A.merge_across_plans([f("m1", "main", "main", 0, 0, "UP"), f("m1", "main", "main", 0.5, 0, "UP")])) == 2
    # Upper's DOWN and Main's UP on one floor, 0.8 m apart: one, seen on both, the one read where it climbs from winning.
    one = A.merge_across_plans([f("m2", "upper", "main", 0.8, 0, "DOWN"), f("m1", "main", "main", 0, 0, "UP")])
    assert len(one) == 1 and one[0]["map_id"] == "m1" and [s["map_id"] for s in one[0]["seen_on"]] == ["m2", "m1"]
    # Two plans, two UP finds 1.2 m apart (a split entry): distance alone never merges.
    assert len(A.merge_across_plans([f("m1", "main", "main", 0, 0, "UP"), f("m3", "main", "main", 1.2, 0, "UP")])) == 2
    # ...unless their footprints overlap (1 m wide flights 0.8 m apart; turned end-on, 2.5 m apart along the run).
    assert len(A.merge_across_plans([f("m1", "main", "main", 0, 0, "UP"), f("m3", "main", "main", 0.8, 0, "UP")])) == 1
    assert len(A.merge_across_plans([f("m1", "main", "main", 0, 0, "UP"), {**f("m3", "main", "main", 0, 2.5, "UP"), "rotation": 0.0}])) == 1
    assert len(A.merge_across_plans([f("m1", "main", "main", 0, 0, "UP"), {**f("m3", "main", "main", 0, 2.5, "UP"), "rotation": 90.0}])) == 2
    # Plans disagreeing by more than a metre: both kept, each by its plan.
    assert len(A.merge_across_plans([f("m2", "upper", "main", 2.5, 0, "DOWN"), f("m1", "main", "main", 0, 0, "UP")])) == 2


def test_a_down_find_belongs_to_the_floor_below_and_a_find_on_the_top_floor_too():
    floors = [{"id": "basement", "elev": -2.8}, {"id": "main", "elev": 0.0}, {"id": "upper", "elev": 2.8}]
    assert A.floor_of_find(floors, "main", "UP") == "main" and A.floor_of_find(floors, "main", "") == "main"
    assert A.floor_of_find(floors, "main", "DOWN") == "basement"
    assert A.floor_of_find(floors, "upper", "UP") == "main"             # the top floor's stairs climb from below
    assert A.floor_of_find(floors, "basement", "DOWN") is None and A.floor_of_find(floors, "garden", "UP") is None
    assert A.floor_step(floors, "main", 1) == "upper" and A.floor_step(floors, "upper", 1) is None


def test_a_correction_names_a_hand_placed_target_apart_from_an_ai_placed_one(monkeypatch, tmp_path, disk):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    h, conn, ai, media = _house(monkeypatch, tmp_path, pieces={"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0)},
                                plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    [sug] = sess["suggestions"].values()
    assert sug["match"]["relation"] == "correction" and sug["match"]["target"] == "fur_00000001" and sug["match"]["hand"] is True
    assert sug["match"]["target_snap"] == {"x_m": 3.0, "y_m": 4.0, "rotation": 0.0, "floor_id": "main", "to_floor": None, "label": "Stairs", "rail": "none"}
    assert "plan_ai_correction_target:hand" in counted and "plan_ai_correction_target:ai" not in counted
    h, conn, ai, media = _house(monkeypatch, tmp_path, pieces={"fur_00000002": _stair("fur_00000002", "main", 3.0, 4.0, "Stairs (AI first guess)")},
                                plans=(("m1", "Main", "main", _T1),))
    counted.clear()
    _run(_session(h, ("m1",), ("stairs",)))
    assert "plan_ai_correction_target:ai" in counted
    # Within a metre: a duplicate, not queued, counted and listed apart.
    h, conn, ai, media = _house(monkeypatch, tmp_path, pieces={"fur_00000003": _stair("fur_00000003", "main", 1.8, 4.0)},
                                plans=(("m1", "Main", "main", _T1),))
    counted.clear()
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    [sug] = sess["suggestions"].values()
    assert sug["state"] == "duplicate" and "plan_ai_duplicate:stairs" in counted and "plan_ai_suggested:stairs" not in counted


def test_a_chosen_rail_is_never_suggested_away():
    assert A.rail_relation("none", "left", "straight") == "new"
    assert A.rail_relation("none", None, "u") == "new"
    assert A.rail_relation("auto", "left", "straight") == "duplicate"     # draws its rails as it always did
    assert A.rail_relation("both", None, "straight") == "duplicate" and A.rail_relation("both", "left", "straight") == "duplicate"
    assert A.rail_relation("inner", None, "straight") == "duplicate"
    assert A.rail_relation("inner", "left", "straight") == "duplicate"    # a straight flight's inner is its left
    assert A.rail_relation("inner", "right", "straight") == "correction" and A.rail_relation("outer", "left", "straight") == "correction"
    assert A.rail_relation("outer", "both", "u") == "correction"          # more rail, looked at; never less
    assert A.rail_relation("outer", "left", "u") == "duplicate"           # a turning flight's left isn't inner or outer


@pytest.mark.parametrize("rail,relation,state", [("none", "new", "queued"), ("auto", "duplicate", "duplicate"), ("both", "duplicate", "duplicate"),
                                                 ("inner", "correction", "queued")])
def test_a_railing_hint_beside_an_existing_stair_is_matched_to_its_rail(monkeypatch, tmp_path, disk, rail, relation, state):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    piece = _stair("fur_00000001", "main", 1.8, 4.0)
    piece["recipe"]["params"]["rail"] = rail
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": _WHOLE, "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}},
                                plans=(("m1", "Main", "main", _T1),), pieces={"fur_00000001": piece})
    store, sess, sid = _run(_session(h, ("m1",)))
    stair = next(s for s in sess["suggestions"].values() if s["kind"] == "stairs")
    hint = next(s for s in sess["suggestions"].values() if s["kind"] == "railing")
    assert stair["state"] == "duplicate"                                  # the stair itself is already there: its hint still counts
    assert hint["geom"]["stair"] == "fur_00000001" and hint["match"]["relation"] == relation and hint["state"] == state and hint["match"]["have"] == rail
    assert ("plan_ai_duplicate:railing" in counted) == (relation == "duplicate")
    assert ("plan_ai_suggested:railing" in counted) == (relation != "duplicate")
    assert T.event_allowed("plan_ai_duplicate:railing")
    # A duplicate is not open for a verdict; the rail changing since makes the open ones stale.
    if state == "duplicate":
        assert _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=hint["id"], v="back")["error"] == "not_open"
    else:
        piece["recipe"]["params"]["rail"] = "both"
        _seed(tmp_path, {"schema": 1, "pieces": {"fur_00000001": piece}, "lights": {}, "openings": {}, "devices": {}, "figures": {}, "library": {}})
        from custom_components.padspan_ha.const import DATA_HOUSE3D
        h.data[DOMAIN].pop(DATA_HOUSE3D, None)
        assert _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]["suggestions"][hint["id"]]["state"] == "stale"


def test_a_rejected_railing_hint_is_remembered_at_its_stair_and_not_queued_again(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": _WHOLE, "crop": {"present": True}, "rail": {"rail": "yes"}},
                                plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",)))
    hint = next(s for s in sess["suggestions"].values() if s["kind"] == "railing")
    stair = next(s for s in sess["suggestions"].values() if s["kind"] == "stairs")
    _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=hint["id"], v="failure", why="nothing_there")
    [(key, r)] = store.data["rejects"].items()
    assert key.startswith("railing|m1|") and (r["x_m"], r["y_m"]) == (round(stair["geom"]["x_m"], 2), round(stair["geom"]["y_m"], 2))
    store, again, sid2 = _run(_session(h, ("m1",)))
    states = {s["kind"]: s for s in again["suggestions"].values()}
    assert states["stairs"]["state"] == "queued" and states["railing"]["state"] == "failure" and states["railing"]["verdict"]["remembered"] is True


def test_two_plans_a_little_apart_both_stay_named_and_a_plan_with_no_floor_is_main(monkeypatch, tmp_path, disk):
    answers = iter([[{"bbox_2d": [100, 200, 200, 600], "says": "UP"}], [{"bbox_2d": [260, 200, 360, 600], "says": "UP"}]])
    h, conn, ai, media = _house(monkeypatch, tmp_path, {"whole": lambda: next(answers), "crop": {"present": True}, "rail": {"rail": "no"}},
                                plans=(("m1", "Main", "main", _T1), ("m3", "Electrical", "", _T1)))
    assert [p["floor_id"] for p in A.plans(h)] == ["main", "main"]
    store, sess, sid = _run(_session(h, ("m1", "m3"), ("stairs",)))
    sugs = list(sess["suggestions"].values())
    assert len(sugs) == 2 and {s["map_id"] for s in sugs} == {"m1", "m3"}
    by = {s["map_id"]: s for s in sugs}
    assert by["m1"]["match"]["others"][0]["map_id"] == "m3" and 1.0 < by["m1"]["match"]["others"][0]["distance_m"] <= 2.5
    assert by["m3"]["match"]["others"][0]["map_id"] == "m1"


def test_a_find_with_no_floor_to_climb_from_is_said_not_dropped_silently(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),), floors=({"id": "main", "name": "Main"},))
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    assert sess["suggestions"] == {} and sess["no_floor"] == 1


# ═══ verdicts and rejects ════════════════════════════════════════════════════

def test_failure_and_later_are_written_at_click_counted_and_taken_back(monkeypatch, tmp_path, disk):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    [sug_id] = sess["suggestions"]
    rev = sess["rev"]
    counted.clear()
    disk.writes.clear()
    out = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev, sug_id=sug_id, v="failure", why="wrong_place")
    assert out["rev"] == rev + 1 and out["suggestion"]["state"] == "failure" and out["suggestion"]["verdict"]["why"] == "wrong_place"
    assert disk.writes == [PLAN_AI_STORE_KEY]                 # on disk the moment it is clicked
    on_disk = json.loads(_file(tmp_path, PLAN_AI_STORE_KEY).read_text(encoding="utf-8"))["data"]
    assert on_disk["sessions"][sid]["suggestions"][sug_id]["state"] == "failure"
    [key] = on_disk["rejects"]
    assert key.startswith("stairs|m1|") and on_disk["rejects"][key]["why"] == "wrong_place"
    assert counted == ["plan_ai_verdict:stairs_failure", "plan_ai_failure_why:wrong_place"]
    # A stale rev reloads; nothing changes.
    assert _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev, sug_id=sug_id, v="later")["error"] == W.REV_CODE
    # Take that back: queued again, the reject gone.
    out = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev + 1, sug_id=sug_id, v="back")
    assert out["suggestion"]["state"] == "queued" and out["suggestion"]["verdict"] is None and store.data["rejects"] == {}
    out = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev + 2, sug_id=sug_id, v="later")
    assert out["suggestion"]["state"] == "later" and counted[-1] == "plan_ai_verdict:stairs_later"
    # A failure with no reason given is "nothing there".
    out = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev + 3, sug_id=sug_id, v="failure")
    assert out["suggestion"]["verdict"]["why"] == "nothing_there"


def test_a_reject_is_remembered_on_the_same_plan_version_expires_with_a_re_placement_and_can_be_forgotten(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    [sug_id] = sess["suggestions"]
    _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=sug_id, v="failure", why="nothing_there")
    [key] = store.data["rejects"]
    assert A.remembered_reject(store.data["rejects"], "stairs", "m1", "20261102T100000", A.place_sig(_T1), 1.6, 4.3) == key
    assert A.remembered_reject(store.data["rejects"], "railing", "m1", "20261102T100000", A.place_sig(_T1), 1.5, 4.0) is None
    assert A.remembered_reject(store.data["rejects"], "stairs", "m1", "20261102T100000", A.place_sig(_T1), 2.5, 4.0) is None
    # Read again on the same plan version: the same find is not queued; it is listed as ignored before.
    store, sess2, sid2 = _run(_session(h, ("m1",), ("stairs",)))
    [sug] = sess2["suggestions"].values()
    assert sug["state"] == "failure" and sug["verdict"]["remembered"] is True and sug["verdict"]["reject"] == key
    # The plan re-placed: a different placement hash, so the reject no longer matches and the find is queued.
    h.data[DOMAIN][DATA_MODEL].map_transform = lambda mid: {**_T1, "origin_x_m": 0.001}
    store, sess3, sid3 = _run(_session(h, ("m1",), ("stairs",)))
    [sug] = sess3["suggestions"].values()
    assert sug["state"] == "queued"
    # Manage ignored: listed with the plan's name; forgotten, and the suggestion it had marked is queued again.
    out = _call(W.ws_plan_ai_rejects_get, h, conn)
    assert out["rejects"][0]["key"] == key and out["rejects"][0]["plan"] == "Main" and "x_m" in out["rejects"][0]
    assert _call(W.ws_plan_ai_reject_forget, h, conn, key=key) == {"ok": True}
    assert store.data["rejects"] == {} and store.session(sid2)["suggestions"][sug_id if sug_id in store.session(sid2)["suggestions"] else list(store.session(sid2)["suggestions"])[0]]["state"] == "queued"
    assert _call(W.ws_plan_ai_reject_forget, h, conn, key=key) == {"ok": False}


def test_status_marks_a_changed_plan_or_target_stale(monkeypatch, tmp_path, disk):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    h, conn, ai, media = _house(monkeypatch, tmp_path, pieces={"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0)})
    store, sess, sid = _run(_session(h, ("m1", "m2"), ("stairs",)))
    sugs = sess["suggestions"]
    assert all(s["state"] == "queued" for s in sugs.values()) and any(s["match"]["relation"] == "correction" for s in sugs.values())
    out = _call(W.ws_plan_ai_status, h, conn)
    assert out["session"]["id"] == sid and out["running"] is None and "finds" not in out["session"]
    assert all(s["state"] == "queued" for s in out["session"]["suggestions"].values())
    # The target moved since the read: stale, counted, the rev bumped.
    rev = sess["rev"]
    _seed(tmp_path, {"schema": 1, "pieces": {"fur_00000001": _stair("fur_00000001", "main", 3.4, 4.0)}, "lights": {}, "openings": {}, "devices": {}, "figures": {}, "library": {}})
    from custom_components.padspan_ha.const import DATA_HOUSE3D
    h.data[DOMAIN].pop(DATA_HOUSE3D, None)
    counted.clear()
    out = _call(W.ws_plan_ai_status, h, conn, session=sid)
    states = {s["id"]: s["state"] for s in out["session"]["suggestions"].values()}
    assert "stale" in states.values() and out["session"]["rev"] == rev + 1 and counted == ["plan_ai_stale"]
    # A plan moved since the read: everything still queued from it is stale, and the sheet is told the plan changed.
    h.data[DOMAIN][DATA_MODEL].map_transform = lambda mid: {**_T1, "origin_x_m": 5.0}
    out = _call(W.ws_plan_ai_status, h, conn, session=sid)
    assert all(p["changed"] for p in out["session"]["plans"]) and all(s["state"] == "stale" for s in out["session"]["suggestions"].values())


# ═══ the commands' caps ══════════════════════════════════════════════════════

def test_start_is_one_at_a_time_one_a_minute_ten_a_day_and_over_placed_plans_only(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    tasks = []

    def _task(coro):
        t = asyncio.get_event_loop().create_task(coro)
        tasks.append(t)
        return t
    h.async_create_background_task = lambda coro, name: _task(coro)

    async def go():
        out = _call_async(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=False)
        r = await out
        assert "session" in r and A.running(h) is not None
        assert (await _call_async(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=False))["error"] == "already_running"
        assert (await _call_async(W.ws_plan_ai_cancel, h, conn, session=r["session"]))["ok"] is True
        await tasks[-1]
        st = (await _call_async(W.ws_plan_ai_status, h, conn, session=r["session"]))["session"]
        assert st["status"] == "cancelled" and st["error"] == "user" and A.running(h) is None
        assert (await _call_async(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=False))["error"] == "too_soon"
        h.data[DOMAIN][A._DATA_STARTS] = [0.0]
        assert (await _call_async(W.ws_plan_ai_start, h, conn, map_ids=["nope"], kinds=["stairs"], backup_ok=False))["error"] == S.NOT_PLACED_CODE
        assert (await _call_async(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["lights"], backup_ok=False))["error"] == "bad_kinds"
        import time as _time
        h.data[DOMAIN][A._DATA_STARTS] = [_time.monotonic() - 3600 * i - 120 for i in range(A.STARTS_A_DAY)]
        assert (await _call_async(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=False))["error"] == "daily_cap"
        pl = await _call_async(W.ws_plan_ai_plans, h, conn)
        assert [p["map_id"] for p in pl["plans"]] == ["m1", "m2"] and pl["plans"][0]["refs"] == 1 and pl["plans"][0]["corners_m"] == [[0, 0], [10, 0], [10, 8], [0, 8]]
        assert pl["ai"]["ready"] is True and pl["ai"]["local"] is True and pl["start_blocked"] == "daily_cap"
        assert pl["latest"] == r["session"] and pl["running"] is None
        sessions = await _call_async(W.ws_plan_ai_sessions_get, h, conn)
        assert sessions["sessions"][0]["id"] == r["session"] and "states" in sessions["sessions"][0]
    asyncio.new_event_loop().run_until_complete(go())
    assert _leftovers(media) == [] and set(disk.writes) == {PLAN_AI_STORE_KEY}


async def _call_async(fn, h, conn, **kw):
    conn.send_result.reset_mock()
    conn.send_error.reset_mock()
    await fn(h, conn, {"id": 5, "type": "x", **kw})
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


def test_a_second_press_while_the_first_is_saving_starts_nothing(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    tasks = []
    h.async_create_background_task = lambda coro, name: tasks.append(asyncio.get_event_loop().create_task(coro)) or tasks[-1]

    async def go():
        conns = [MagicMock(), MagicMock()]
        await asyncio.gather(*(W.ws_plan_ai_start(h, c, {"id": 5, "map_ids": ["m1"], "kinds": ["stairs"], "backup_ok": False}) for c in conns))
        await asyncio.gather(*tasks)
        return conns
    conns = asyncio.new_event_loop().run_until_complete(go())
    assert sum(c.send_result.called for c in conns) == 1 and sum(c.send_error.called for c in conns) == 1
    assert len(tasks) == 1 and len(h.data[DOMAIN][DATA_PLAN_AI].data["sessions"]) == 1


def test_a_plan_leaves_the_house_only_with_the_tick_asked_on_the_server_too(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _house(monkeypatch, tmp_path, platform="openai_conversation")
    tasks = []
    h.async_create_background_task = lambda coro, name: tasks.append(asyncio.get_event_loop().create_task(coro)) or tasks[-1]

    async def go():
        out = await _call_async(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=False)
        assert out["error"] == "cloud_not_agreed" and ai.calls == []
        out = await _call_async(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=False, cloud_ok=True)
        assert "session" in out
        await asyncio.gather(*tasks)
    asyncio.new_event_loop().run_until_complete(go())
    assert ai.calls
    # A local main with a cloud backup: only the backup's own tick brings it in, and then the cloud tick is needed.
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    real = P.ai_task
    seen = []

    def ai_task(hass, *, with_backup=False):
        seen.append(with_backup)
        return {**real(hass), **({"backup": "ai_task.cloud", "backup_name": "Cloud", "backup_local": False} if with_backup else {})}
    monkeypatch.setattr(P, "ai_task", ai_task)
    assert _call(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=True)["error"] == "cloud_not_agreed" and seen == [True]


def test_without_an_ai_task_start_refuses_and_counts_it(monkeypatch, tmp_path, disk):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    h, conn, ai, media = _house(monkeypatch, tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = ""
    assert _call(W.ws_plan_ai_start, h, conn, map_ids=["m1"], kinds=["stairs"], backup_ok=False)["error"] == P.NO_AI_CODE
    assert counted == ["plan_ai_error:no_ai_task"] and ai.calls == []
    assert _call(W.ws_plan_ai_plans, h, conn)["ai"]["ready"] is False


# ═══ nothing else is written ═════════════════════════════════════════════════

def test_a_session_and_its_verdicts_leave_every_other_store_byte_identical(monkeypatch, tmp_path, disk):
    """The fabric, the model, the maps, the settings, calibration and the 3D
    house keep every byte through a session, a failure, a later and a
    forgotten reject: padspan_ha.plan_ai is the only file written."""
    seeds = {
        FABRIC_STORE_KEY: {"rf_barriers_m": [{"id": "bar_a71a3324", "name": "Barrier 1", "material": "metal", "floor_id": "main",
                                              "points_m": [[3.035, -9.228], [5.46, -9.255]]}],
                           "light_positions_m": {"light.kitchen": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"}}},
        MODEL_STORE_KEY: {"floors": [{"id": "main", "name": "Main"}], "map_transforms": {"m1": _T1}},
        MAPS_STORE_KEY: {"maps": [{"id": "m1", "name": "Main floor"}]},
        SETTINGS_STORE_KEY: {"atlas_3d_enabled": True, "ai_plans_enabled": True},
        CALIBRATION_STORE_KEY: {"points": [{"room": "Kitchen", "x_m": 1.0, "y_m": 1.0, "rssi": {"aa": -60}}]},
        HOUSE3D_STORE_KEY: {"schema": 1, "pieces": {"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0)}, "lights": {}, "openings": {},
                            "devices": {}, "figures": {}, "library": {}},
    }
    for k, v in seeds.items():
        _seed(tmp_path, v, k)
    raw = {k: _file(tmp_path, k).read_bytes() for k in seeds}
    h, conn, ai, media = _house(monkeypatch, tmp_path, plans=(("m1", "Main", "main", _T1),))
    store, sess, sid = _run(_session(h, ("m1",)))
    [sug_id] = [k for k, s in sess["suggestions"].items() if s["kind"] == "stairs"]
    _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=sug_id, v="failure", why="cant_tell")
    _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=sug_id, v="later")
    _call(W.ws_plan_ai_status, h, conn)
    for key in store.data["rejects"]:
        _call(W.ws_plan_ai_reject_forget, h, conn, key=key)
    assert set(disk.writes) == {PLAN_AI_STORE_KEY} and len(disk.writes) >= 3
    for k in seeds:
        assert _file(tmp_path, k).read_bytes() == raw[k], k
    assert _leftovers(media) == []
    # And the module never calls the writers: no store's save, no remap, no edit.
    src = inspect.getsource(A) + inspect.getsource(W)
    for word in ("async_write(", "apply_edit", "async_remap_from_metres", "async_set_", "async_put(", "async_save_", "fabric_rf_barrier",
                 "async_update_map", "async_place"):
        assert word not in src, word
    assert src.count("async_save()") == src.count("store.async_save()") + src.count("self.async_save()")


# ═══ the counters ════════════════════════════════════════════════════════════

def test_the_family_is_closed_every_name_has_a_call_site_and_nothing_names_a_plan():
    src = inspect.getsource(A) + inspect.getsource(W)
    for e in T.PLAN_AI_EVENTS:
        assert T.event_allowed(e) and len(e) <= 64, e
        a, _, b = e.partition(":")
        assert f'"{e}"' in src or f'"{a}:{{' in src or f"f\"{a}:" in src or f"'{a}:" in src or f'"{a}:' in src, e
    assert not T.event_allowed("plan_ai_session:anything") and not T.event_allowed("plan_ai_error:Main")
    # Every band and word the code can make is in the family (no silent drops).
    for n, band in ((1, "1"), (2, "2_3"), (5, "4_6"), (9, "gt6")):
        assert f"plan_ai_plans:{band}" in T.PLAN_AI_EVENTS and A._band(n, ((1, "1"), (3, "2_3"), (6, "4_6")), "gt6") == band
    for why in A.CANCEL_WHY:
        assert f"plan_ai_cancel_why:{why}" in T.PLAN_AI_EVENTS
    for why in A.FAILURE_WHY:
        assert f"plan_ai_failure_why:{why}" in T.PLAN_AI_EVENTS
    for k in A.KINDS:
        assert {f"plan_ai_suggested:{k}", f"plan_ai_duplicate:{k}", f"plan_ai_verdict:{k}_failure", f"plan_ai_verdict:{k}_later"} <= T.PLAN_AI_EVENTS
    # The report names (views/installbase.js) cover the family's prefixes.
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    for prefix in sorted({e.partition(":")[0] for e in T.PLAN_AI_EVENTS}):
        assert f'"{prefix}"' in ib, prefix


def test_the_report_carries_the_switch_only_when_on(monkeypatch, tmp_path, disk):
    from tests.test_telemetry import _hass
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = False
    payload = T.build_payload(h)
    assert "ai_plans" not in payload["features"]
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = True
    assert T.build_payload(h)["features"].get("ai_plans") is True


# ═══ the list view, run ══════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def sheet() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "plans_list.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_the_plans_sheet_runs(sheet):
    assert len(sheet) >= 20, sorted(sheet)
    bad = {k: v for k, v in sheet.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)
