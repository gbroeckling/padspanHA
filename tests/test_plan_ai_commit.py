"""Add data via plans, Stage 1b: commit and undo (plan_ai_write.py), the first
code that writes a house from AI suggestions, so safety is the whole job.

What must hold, each with its proof here: only the 3D file and padspan_ha.plan_ai
are written (and the one safety backup), and fabric, model, maps, settings and
calibration keep every byte after a commit and after an undo, by the file bytes
and by an OS audit hook; a hand-deleted stair isn't resurrected; two admins or a
double click make one piece; an undo restores byte for byte what it touched and
nothing else; a failed write leaves everything as it was, and so does a crash
between the two files; Discard loses no failure, later or reject (they never were
the draft's); a downgrade to v0.38.199 accepts the file.
"""
from __future__ import annotations

import asyncio
import copy
import importlib.util
import inspect
import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

import pytest

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import plan_ai_write as C
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d as WH
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha.const import (BACKUPS_STORE_KEY, CALIBRATION_STORE_KEY, DATA_HOUSE3D, DATA_PLAN_AI, DOMAIN, FABRIC_STORE_KEY,
                                                HOUSE3D_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY, PLAN_AI_STORE_KEY,
                                                SETTINGS_STORE_KEY)
from tests.test_house3d_edit import _file, _seed, disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_store import _run
from tests.test_plan_ai import _T1, _T2, _WHOLE, _call, _call_async, _house, _session, _stair

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_ONE_PLAN = (("m1", "Main", "main", _T1),)
_FILE = {"schema": 1, "lights": {}, "openings": {}, "devices": {}, "figures": {}, "library": {}, "rails_chosen": True}
H_ASYNC_WRITE, C_FINISH = H.House3dStore.async_write, C._finish     # put back after a test's crash
_FAR_STAIR = _stair("fur_00000009", "main", 9.0, 7.5, label="Far stairs", to="upper")   # never near the find at (1.5, 4.0)


def _seed_file(tmp_path, pieces):
    """A 3D file as this version writes it (nothing to stamp), so its bytes can be compared."""
    data = {**_FILE, "pieces": pieces}
    _seed(tmp_path, data)
    return data


def _ready(monkeypatch, tmp_path, pieces, answers=None, plans=_ONE_PLAN, kinds=("stairs", "railing")):
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    _seed_file(tmp_path, pieces)
    h, conn, ai, media = _house(monkeypatch, tmp_path, answers, plans=plans)
    store, sess, sid = _run(_session(h, tuple(p[0] for p in plans), kinds))
    return h, conn, store, sess, sid, counted


def _final(sug, **over):
    """What the editor's draft sends: the draft's piece for a new stair (live_aboard_furnish.planStair)."""
    g = sug["geom"]
    return {"id": "fur_aaaaaaaa", "floor_id": sug["floor_id"], "x_m": g["x_m"], "y_m": g["y_m"], "z_m": 0, "rotation": g["rotation"], "label": "anything",
            "entity_id": "light.ignored", "plan_ai_pending": {"session": "x", "sugs": {}},
            "recipe": {"kind": "stairs", "params": {"shape": "straight", "style": "closed", "rail": "none", "to_floor": "upper"},
                       "colors": ["#5b6b7a", "#3a4450", "#8a94a0"], "width_m": 1.0, "depth_m": 3.0, "height_m": 2.8}, **over}


def _one(sess, kind="stairs"):
    return next(s for s in sess["suggestions"].values() if s["kind"] == kind)


def _commit(h, conn, sid, rev, *items):
    return _call(W.ws_plan_ai_commit, h, conn, session=sid, rev=rev, items=list(items))


def _on_disk(tmp_path, key=HOUSE3D_STORE_KEY):
    return json.loads(_file(tmp_path, key).read_text(encoding="utf-8"))["data"]


def _forget_memory(h):
    """Home Assistant restarting: every store is read from its file again."""
    h.data[DOMAIN].pop(DATA_PLAN_AI, None)
    h.data[DOMAIN].pop(DATA_HOUSE3D, None)
    h.data[DOMAIN].pop(A._DATA_JOB, None)


# ═══ a commit ════════════════════════════════════════════════════════════════

def test_a_new_stair_is_one_piece_with_the_server_minted_id_the_note_the_label_and_no_rail(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    assert sug["match"]["relation"] == "new" and "plan_ai_verdict:stairs_new" not in counted
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert r["ok"] is True and r["rev"] > 1
    pid = r["piece_ids"][sug["id"]]
    assert pid != "fur_aaaaaaaa" and H.PIECE_ID.fullmatch(pid), "the server's id, not the draft's"
    p = _on_disk(tmp_path)["pieces"][pid]
    assert p["label"] == "Stairs (from the plan)" and p["origin"] == "build" and p["floor_id"] == "main"
    assert p["recipe"]["params"]["rail"] == "none" and p["plan_ai"] == {"session": sid, "batch": r["batch"], "kind": "stairs", "at": p["plan_ai"]["at"]}
    assert p["entity_id"] is None and "plan_ai_pending" not in p, "only the fields the draft decides"
    assert (p["x_m"], p["y_m"]) == (sug["geom"]["x_m"], sug["geom"]["y_m"])
    assert sug["state"] == "committed_new" and sug["piece_id"] == pid and sug["verdict"]["v"] == "new"
    assert r["data"]["pieces"][pid] == p and "token" not in json.dumps(r["data"]), "the answer carries the file, as house3d_edit does"
    assert counted.count("plan_ai_verdict:stairs_new") == 1 and "plan_ai_commit:done" in counted
    # The batch: `before` from the file at commit (none: it is new), `after` what it became.
    batch = store.data["batches"][r["batch"]]
    assert batch["session"] == sid and "pending" not in batch and batch["undone_at"] is None
    [item] = batch["items"]
    assert item == {"sug_id": sug["id"], "also": [], "kind": "stairs", "target": f"pieces/{pid}", "before": None, "after": p}
    assert r["undo"]["id"] == r["batch"] and r["undo"]["items"] == 1 and r["undo"]["puts_back"] is False


def test_a_drag_after_accepting_goes_in_and_is_counted_over_30_cm(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug, x_m=sug["geom"]["x_m"] + 0.5)})
    assert _on_disk(tmp_path)["pieces"][r["piece_ids"][sug["id"]]]["x_m"] == sug["geom"]["x_m"] + 0.5
    assert sug["verdict"]["moved_m"] == 0.5 and counted.count("plan_ai_moved_after_accept:stairs") == 1


def test_a_correction_moves_only_where_the_stair_stands_and_before_is_the_live_file(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall stairs", to="upper")
    target["entity_id"] = "light.on_the_stairs"
    target["library_id"] = "lib1"
    target["a_newer_key"] = {"kept": True}
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target})
    sug = _one(sess)
    assert sug["match"]["relation"] == "correction" and sug["match"]["target"] == "fur_00000001" and sug["match"]["hand"] is True
    live_before = copy.deepcopy(_on_disk(tmp_path)["pieces"]["fur_00000001"])
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    assert r["ok"] is True and r["piece_ids"][sug["id"]] == "fur_00000001"
    p = _on_disk(tmp_path)["pieces"]["fur_00000001"]
    assert (p["x_m"], p["y_m"]) == (sug["geom"]["x_m"], sug["geom"]["y_m"])
    for k in ("label", "entity_id", "library_id", "a_newer_key", "rotation"):
        assert p[k] == live_before[k], k
    assert {k: p["recipe"][k] for k in live_before["recipe"]} == live_before["recipe"]
    assert p["plan_ai"]["batch"] == r["batch"]
    [item] = store.data["batches"][r["batch"]]["items"]
    assert item["before"] == live_before and item["after"] == p
    assert sug["state"] == "committed_correction"
    assert counted.count("plan_ai_verdict:stairs_correction") == 1 and counted.count("plan_ai_correction_taken:hand") == 1


def test_a_correction_on_an_ai_placed_stair_is_counted_apart_and_keeps_its_label(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Stairs (from the plan)", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target})
    sug = _one(sess)
    assert sug["match"]["hand"] is False
    _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    assert counted.count("plan_ai_correction_taken:ai") == 1 and _on_disk(tmp_path)["pieces"]["fur_00000001"]["label"] == "Stairs (from the plan)"


def test_a_second_commit_in_a_session_joins_its_batch_one_undo_for_the_whole_session(monkeypatch, tmp_path, disk):
    whole = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "up": "top", "shape": "straight"}]
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {}, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "no"}})
    a, b = [s for s in sess["suggestions"].values() if s["kind"] == "stairs"]
    r1 = _commit(h, conn, sid, sess["rev"], {"sug_id": a["id"], "v": "new", "final": _final(a)})
    r2 = _commit(h, conn, sid, r1["rev"], {"sug_id": b["id"], "v": "new", "final": _final(b)})
    assert r1["batch"] == r2["batch"] and len(store.data["batches"]) == 1 and len(store.data["batches"][r1["batch"]]["items"]) == 2
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r1["batch"])
    assert u["undone"] == 2 and _on_disk(tmp_path)["pieces"] == {}


def test_only_the_draft_decides_what_it_should_a_sofa_or_the_outside_is_refused(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    raw = _file(tmp_path).read_bytes()
    sofa = _final(sug)
    sofa["recipe"] = {**sofa["recipe"], "kind": "sofa"}
    for bad in (sofa, _final(sug, floor_id="outside"), _final(sug, floor_id="__outside__"), _final(sug, floor_id="an_invented_floor"),
                _final(sug, x_m="here"), _final(sug, x_m=float("nan")), {"floor_id": "main"}, "nothing"):
        assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": bad})["error"] == "invalid", bad
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "keep"})["error"] == "invalid"
    assert _commit(h, conn, sid, sess["rev"])["error"] == "invalid"
    assert _file(tmp_path).read_bytes() == raw and sug["state"] == "queued" and not store.data["batches"]


def test_a_stair_too_small_is_the_stores_own_refusal_and_nothing_is_touched(monkeypatch, tmp_path, disk):
    """apply_edit's checks run before the backup, so a bad item costs no backup."""
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    small = _final(sug)
    small["recipe"] = {**small["recipe"], "width_m": 0.1}
    writes = list(disk.writes)
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": small})["error"] == "invalid"
    assert disk.writes == writes and sess.get("backup_id") is None


# ═══ the safety backup ═══════════════════════════════════════════════════════

def test_the_backup_comes_before_the_write_and_only_once_a_session(monkeypatch, tmp_path, disk):
    whole = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "up": "top", "shape": "straight"}]
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR}, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "no"}})
    a, b = [s for s in sess["suggestions"].values() if s["kind"] == "stairs"]
    taken = []
    from custom_components.padspan_ha import ws_backup

    async def _bk(hass, note, keys, **_):
        taken.append((note, list(keys), copy.deepcopy(hass.data[DOMAIN][DATA_HOUSE3D].data), list(disk.writes)))
        return "bk_test"
    async def _there(hass, backup_id):
        return True
    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    monkeypatch.setattr(ws_backup, "_backup_exists", _there)
    writes_before = list(disk.writes)
    r1 = _commit(h, conn, sid, sess["rev"], {"sug_id": a["id"], "v": "new", "final": _final(a)})
    assert len(taken) == 1 and taken[0][0] == "Before keeping items from the plans" and taken[0][1] == [HOUSE3D_STORE_KEY]
    assert taken[0][2]["pieces"] == {"fur_00000009": _FAR_STAIR} or set(taken[0][2]["pieces"]) == {"fur_00000009"}, "the house as it was"
    assert taken[0][3] == writes_before, "nothing written before it"
    assert sess["backup_id"] == "bk_test"
    r2 = _commit(h, conn, sid, r1["rev"], {"sug_id": b["id"], "v": "new", "final": _final(b)})
    assert r2["ok"] and len(taken) == 1, "one per session, while it is still there"
    assert r2["backup_id"] == "bk_test"


def test_no_backup_no_write(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    from custom_components.padspan_ha import ws_backup

    async def _none(hass, note, keys, **_):
        return None
    monkeypatch.setattr(ws_backup, "_auto_backup", _none)
    raw, ledger = _file(tmp_path).read_bytes(), _file(tmp_path, PLAN_AI_STORE_KEY).read_bytes()
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})["error"] == "backup_failed"
    assert _file(tmp_path).read_bytes() == raw and _file(tmp_path, PLAN_AI_STORE_KEY).read_bytes() == ledger and sug["state"] == "queued"
    assert counted.count("plan_ai_commit:backup_failed") == 1


# ═══ nothing else is written ═════════════════════════════════════════════════

_WATCHED: list[str] = []
_WATCHING = [False]


def _audit(event, args):
    """An OS audit hook: every file opened to write, renamed or removed, while a test watches."""
    if not _WATCHING[0]:
        return
    if event == "open":
        path, mode, flags = args
        writes = (isinstance(mode, str) and any(c in mode for c in "wax+")) or (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
        if writes and isinstance(path, (str, bytes, os.PathLike)):
            _WATCHED.append(os.fspath(path))
    elif event in ("os.rename", "os.replace", "shutil.move", "shutil.copyfile"):
        _WATCHED.append(os.fspath(args[1]))
    elif event in ("os.remove", "os.rmdir", "shutil.rmtree"):
        _WATCHED.append(os.fspath(args[0]))


sys.addaudithook(_audit)


def _seeds():
    return {
        FABRIC_STORE_KEY: {"rf_barriers_m": [{"id": "bar_a71a3324", "name": "Barrier 1", "material": "open", "floor_id": "main", "points_m": [[3.035, -9.228], [5.46, -9.255]]}],
                           "light_positions_m": {"light.kitchen": {"x_m": 1.0, "y_m": 2.0, "floor_id": "main"}}},
        MODEL_STORE_KEY: {"floors": [{"id": "main", "name": "Main"}], "map_transforms": {"m1": _T1}},
        MAPS_STORE_KEY: {"maps": [{"id": "m1", "name": "Main floor"}]},
        SETTINGS_STORE_KEY: {"atlas_3d_enabled": True, "ai_plans_enabled": True},
        CALIBRATION_STORE_KEY: {"points": [{"room": "Kitchen", "x_m": 1.0, "y_m": 1.0, "rssi": {"aa": -60}}]},
    }


def test_a_commit_and_an_undo_write_only_the_3d_file_and_the_plan_store_by_bytes_and_by_the_os(monkeypatch, tmp_path, disk):
    """Fabric, model, maps, settings and calibration keep every byte, after the
    commit and after the undo. The OS audit hook sees what really opens to write:
    the 3D file, the plan store and the one safety backup, nothing else."""
    seeds = _seeds()
    for k, v in seeds.items():
        _seed(tmp_path, v, k)
    raw = {k: _file(tmp_path, k).read_bytes() for k in seeds}
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target}, {"whole": [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "shape": "straight"}], "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}})
    cor = next(s for s in sess["suggestions"].values() if s["match"].get("relation") == "correction" and s["kind"] == "stairs")
    new = next(s for s in sess["suggestions"].values() if s["match"].get("relation") == "new" and s["kind"] == "stairs")
    disk.writes.clear()
    _WATCHED.clear()
    _WATCHING[0] = True
    try:
        r = _commit(h, conn, sid, sess["rev"], {"sug_id": cor["id"], "v": "correction"}, {"sug_id": new["id"], "v": "new", "final": _final(new)})
        assert r["ok"]
        for k in seeds:
            assert _file(tmp_path, k).read_bytes() == raw[k], k
        in_commit = {Path(p).name for p in _WATCHED}
        u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
        assert u["undone"] == 2
    finally:
        _WATCHING[0] = False
    for k in seeds:
        assert _file(tmp_path, k).read_bytes() == raw[k], k
    assert in_commit == {HOUSE3D_STORE_KEY, PLAN_AI_STORE_KEY, BACKUPS_STORE_KEY}, in_commit
    assert {Path(p).name for p in _WATCHED} == in_commit
    assert set(disk.writes) == in_commit


def test_the_plan_ais_one_writer_is_one_module(monkeypatch, tmp_path, disk):
    """No other part of the plan AI can write the house, and the writer reaches
    no other store: no fabric, no model, no maps, no calibration."""
    for mod in (A, W):
        src = inspect.getsource(mod)
        for word in ("apply_edit", "house.async_write", ".async_write(", "async_remap_from_metres"):
            assert word not in src, (mod.__name__, word)
    # The line-up's two writes live in the same module, apart (test_plan_build_write.py holds them to it);
    # the 3D part of it reaches nothing else.
    src = inspect.getsource(C).split("# ══ Build from plans: line up (Stage 1b", 1)[0]
    assert src.count("H.apply_edit(") == 1 and src.count("house.async_write(") == 2
    for word in ("DATA_FABRIC", "DATA_MAPS", "async_spatial_update", "async_remap_from_metres", "async_set_", "fabric_rf_barrier", "CALIBRATION", "DATA_SETTINGS", "model."):
        assert word not in src, word
    importers = [p.name for p in _PKG.glob("*.py") if "import plan_ai_write" in p.read_text(encoding="utf-8")]
    assert importers == ["ws_maps.py", "ws_plan_ai.py"], importers
    # ws_maps (the upload's hand measurement, 2026-11-12) takes only the pure reading and working-out of a length;
    # its one write is Measure's own (ws_fabric.async_write_measured_transform), never one of the plan AI's.
    used = set(re.findall(r"\bC\.(\w+)", (_PKG / "ws_maps.py").read_text(encoding="utf-8")))
    assert used <= {"measures_preview", "scale_from_measures", "feet_on", "_picture_size", "Refused", "SCALE_WORDS"}, used
    # And the ordinary Save can't keep a suggestion by mistake (ws_house3d.house3d_edit).
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"pieces": {"fur_11111111": {**_stair("fur_11111111", "main", 1.0, 1.0), "plan_ai_pending": {"session": "s", "sugs": {}}}}})


# ═══ a hand-deleted stair; targets that changed ══════════════════════════════

def test_a_correction_of_a_stair_deleted_by_hand_doesnt_bring_it_back(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target})
    sug = _one(sess)
    assert _call(WH.ws_house3d_edit, h, conn, pieces={"fur_00000001": None}).get("data") is not None
    raw = _file(tmp_path).read_bytes()
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    assert r["ok"] is False and r["code"] == "changed_since" and r["changed"] == [{"sug_id": sug["id"], "why": "gone"}]
    assert _file(tmp_path).read_bytes() == raw and "fur_00000001" not in _on_disk(tmp_path)["pieces"]
    assert sug["state"] == "stale" and sess["rev"] == r["rev"] and not store.data["batches"]
    assert counted.count("plan_ai_stale") == 1 and counted.count("plan_ai_commit:changed_since") == 1


def test_a_target_moved_since_is_refused_and_stale_can_be_new_or_failure_only(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target})
    sug = _one(sess)
    moved = {**_on_disk(tmp_path)["pieces"]["fur_00000001"], "x_m": 3.2}
    assert _call(WH.ws_house3d_edit, h, conn, pieces={"fur_00000001": moved}).get("data") is not None
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    assert r["code"] == "changed_since" and r["changed"][0]["why"] == "changed"
    assert _commit(h, conn, sid, r["rev"], {"sug_id": sug["id"], "v": "correction"})["code"] == "not_open"
    # The AI's own geometry still stands: it may be kept as a stair of its own, by a person who has seen it changed.
    k = _commit(h, conn, sid, r["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert k["ok"] and sug["state"] == "committed_new" and len(_on_disk(tmp_path)["pieces"]) == 2


def test_a_plan_moved_since_the_read_is_refused_whatever_the_item_says(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    from custom_components.padspan_ha.const import DATA_MODEL
    t = h.data[DOMAIN][DATA_MODEL].map_transform("m1")
    t["origin_x_m"] = 0.5
    raw = _file(tmp_path).read_bytes()
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    t["origin_x_m"] = 0.0
    assert r["code"] == "changed_since" and r["changed"] == [{"sug_id": sug["id"], "why": "plan"}] and sug["state"] == "stale"
    assert next(p for p in sess["plans"] if p["map_id"] == "m1")["changed"] is True
    assert _file(tmp_path).read_bytes() == raw
    r2 = _commit(h, conn, sid, r["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert r2["code"] == "changed_since" and r2["changed"][0]["why"] == "plan", "the plan moved: read it again, even with the placement back"
    assert _file(tmp_path).read_bytes() == raw


def test_a_coarse_position_is_never_offered_as_a_correction(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target})
    sug = _one(sess)
    sug["match"].update(held="frame", relation="new")
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})["error"] == "invalid"
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction", "target": "fur_00000001"})["error"] == "invalid"


def test_a_new_item_named_near_two_stairs_can_be_a_correction_of_either_by_a_persons_choice(monkeypatch, tmp_path, disk):
    pieces = {"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0, label="A", to="upper"), "fur_00000002": _stair("fur_00000002", "main", 0.0, 4.0, label="B", to="upper")}
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, pieces)
    sug = _one(sess)
    assert sug["match"]["relation"] == "new" and set(sug["match"]["near_snaps"]) == set(pieces)
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})["error"] == "invalid", "never auto-paired"
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction", "target": "fur_77777777"})["error"] == "invalid"
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction", "target": "fur_00000002"})
    assert r["ok"] and _on_disk(tmp_path)["pieces"]["fur_00000002"]["x_m"] == sug["geom"]["x_m"] and _on_disk(tmp_path)["pieces"]["fur_00000001"]["x_m"] == 3.0


def test_a_failed_read_of_the_3d_file_marks_nothing_stale(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target})
    sug = _one(sess)
    assert A.check_session(h, store, sess, None) is False and sug["state"] == "queued"


# ═══ two admins, a double click ══════════════════════════════════════════════

def test_a_double_click_makes_one_piece(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    disk.slow = True
    conn.send_result.reset_mock()
    conn.send_error.reset_mock()

    async def twice():
        msg = {"id": 1, "type": "x", "session": sid, "rev": sess["rev"], "items": [{"sug_id": sug["id"], "v": "new", "final": _final(sug)}]}
        await asyncio.gather(W.ws_plan_ai_commit(h, conn, dict(msg)), W.ws_plan_ai_commit(h, conn, dict(msg)))
    _run(twice())
    disk.slow = False
    assert len(_on_disk(tmp_path)["pieces"]) == 2 and conn.send_result.call_count == 1 and conn.send_error.call_args[0][1] == "rev_mismatch"
    assert len(next(iter(store.data["batches"].values()))["items"]) == 1


def test_two_admins_one_piece_and_a_retry_after_a_lost_answer_is_refused_by_the_suggestions_state(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    rev = sess["rev"]
    r1 = _commit(h, conn, sid, rev, {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    raw = _file(tmp_path).read_bytes()
    # The other admin still holds the old rev: reloads rather than overwrites.
    assert _commit(h, conn, sid, rev, {"sug_id": sug["id"], "v": "new", "final": _final(sug)})["error"] == "rev_mismatch"
    # Reloaded, and pressed all the same (or the first answer was lost).
    again = _commit(h, conn, sid, r1["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert again["ok"] is False and again["code"] == "already_committed" and again["items"] == [sug["id"]]
    assert _file(tmp_path).read_bytes() == raw and len(_on_disk(tmp_path)["pieces"]) == 2
    # A verdict can't touch it now either.
    assert _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=r1["rev"], sug_id=sug["id"], v="failure")["error"] == "not_open"


def test_two_sessions_with_the_same_find_are_not_two_pieces_unless_a_person_insists(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    other = copy.deepcopy(sess)
    store.data["sessions"]["ps_other"] = other
    other["started_at"] = sess["started_at"] - 1
    r1 = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert r1["ok"]
    twin = other["suggestions"][sug["id"]]
    r2 = _commit(h, conn, "ps_other", other["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(twin)})
    assert r2["code"] == "changed_since" and twin["state"] == "stale" and len(_on_disk(tmp_path)["pieces"]) == 2


def test_nothing_is_kept_while_a_session_reads_and_no_session_starts_inside_a_commit(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    monkeypatch.setattr(A, "running", lambda hass: object())
    raw = _file(tmp_path).read_bytes()
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})["error"] == "already_running"
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id="pb_none")["error"] == "already_running"
    assert _file(tmp_path).read_bytes() == raw
    src = inspect.getsource(W.ws_plan_ai_start)
    assert src.index("async with store.lock") < src.index("A.start_allowed(hass)") < src.index("A.start(hass")


def test_a_newer_file_or_an_unreadable_one_is_never_written(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    from custom_components.padspan_ha import house3d_store
    live = h.data[DOMAIN][DATA_HOUSE3D] if DATA_HOUSE3D in h.data[DOMAIN] else None
    live = live or _run(house3d_store.async_get_store(h))
    raw = _file(tmp_path).read_bytes()
    live.data = {**live.data, "schema": 2}
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})["error"] == "house3d_newer"
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id="pb_x")["error"] == "house3d_newer"
    live.data = {**live.data, "schema": 1}
    store.data["schema"] = 2
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})["error"] == "plan_ai_newer"
    store.data["schema"] = 1
    assert _file(tmp_path).read_bytes() == raw

    async def _fail(hass):
        raise house3d_store.ReadFailed("no")
    monkeypatch.setattr(house3d_store, "async_get_store", _fail)
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})["error"] == "read_failed"


# ═══ an undo ═════════════════════════════════════════════════════════════════

def test_an_undo_restores_the_file_byte_for_byte_and_is_a_batch_of_its_own(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    sofa = {"id": "fur_00000003", "floor_id": "main", "x_m": 5.0, "y_m": 5.0, "z_m": 0.0, "rotation": 90.0, "origin": "build", "label": "Sofa", "updated_at": "2026-10-01T00:00:00+00:00",
            "recipe": {"kind": "sofa", "params": {}, "colors": [], "width_m": 2.0, "depth_m": 1.0, "height_m": 0.8}}
    whole = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "up": "top", "shape": "straight"}]
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target, "fur_00000003": sofa}, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}})
    cor = next(s for s in sess["suggestions"].values() if s["kind"] == "stairs" and s["match"]["relation"] == "correction")
    new = next(s for s in sess["suggestions"].values() if s["kind"] == "stairs" and s["match"]["relation"] == "new")
    rail = next(s for s in sess["suggestions"].values() if s["kind"] == "railing" and s["match"]["target"] == "fur_00000001")
    original = _file(tmp_path).read_bytes()
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": cor["id"], "v": "correction"}, {"sug_id": new["id"], "v": "new", "final": _final(new)},
                {"sug_id": rail["id"], "v": "new", "rail": {"side": "outer", "style": "topless"}})
    assert r["ok"] and _file(tmp_path).read_bytes() != original
    assert r["undo"]["items"] == 3, "a stair and its rail are one entry, and two items to the person who kept them"
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["ok"] and u["undone"] == 3 and u["of"] == 3 and u["skipped"] == []
    assert _file(tmp_path).read_bytes() == original, "byte for byte"
    assert cor["state"] == new["state"] == rail["state"] == "undone" and new["piece_id"] == r["piece_ids"][new["id"]]
    assert counted.count("plan_ai_undo:batch") == 1 and counted.count("plan_ai_undo:stairs") == 2 and counted.count("plan_ai_undo:railing") == 1, "a stair and its rail: one entry, two items"
    b, ub = store.data["batches"][r["batch"]], store.data["batches"][u["batch"]]
    assert b["undone_at"] and ub["undo_of"] == r["batch"] and "pending" not in ub
    # Undone already.
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["error"] == "already_undone"
    # The undo can be undone: they come back, the same pieces, states as they were.
    assert u["undo"]["id"] == u["batch"] and u["undo"]["puts_back"] is True
    after_commit = copy.deepcopy(r["data"]["pieces"])
    back = _call(W.ws_plan_ai_undo, h, conn, batch_id=u["batch"])
    assert back["undone"] == 3 and _on_disk(tmp_path)["pieces"] == after_commit and new["state"] == "committed_new" and cor["state"] == "committed_correction" and rail["state"] == "committed_new"
    assert counted.count("plan_ai_undo:put_back") == 1 and back["undo"]["puts_back"] is False
    # And once more: the bytes again.
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=back["batch"])["undone"] == 3
    assert _file(tmp_path).read_bytes() == original and new["state"] == "undone"
    # An undone item is over: it can't be kept again by mistake (read the plan again).
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": new["id"], "v": "new", "final": _final(new)})["code"] == "not_open"


def test_an_undo_leaves_and_reports_what_changed_since_and_doesnt_resurrect_a_deleted_stair(monkeypatch, tmp_path, disk):
    pieces = {"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper"), "fur_00000009": _stair("fur_00000009", "main", 0.2, 7.8, label="Far", to="upper")}
    whole = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "up": "top", "shape": "straight"}, {"bbox_2d": [700, 550, 800, 750], "says": "UP", "up": "top", "shape": "straight"}]
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, pieces, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "no"}})
    cor = next(s for s in sess["suggestions"].values() if s["match"]["relation"] == "correction")
    a, b = [s for s in sess["suggestions"].values() if s["match"]["relation"] == "new"]
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": cor["id"], "v": "correction"}, {"sug_id": a["id"], "v": "new", "final": _final(a)}, {"sug_id": b["id"], "v": "new", "final": _final(b)})
    pa, pb = r["piece_ids"][a["id"]], r["piece_ids"][b["id"]]
    live = _on_disk(tmp_path)["pieces"]
    # By hand: one new stair deleted, the other moved, the corrected one untouched.
    assert _call(WH.ws_house3d_edit, h, conn, pieces={pa: None, pb: {**live[pb], "x_m": live[pb]["x_m"] + 0.2}}).get("data") is not None
    moved = _on_disk(tmp_path)["pieces"][pb]
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["undone"] == 1 and u["of"] == 3
    assert {(s["sug_id"], s["why"]) for s in u["skipped"]} == {(a["id"], "gone"), (b["id"], "changed")}
    pieces_now = _on_disk(tmp_path)["pieces"]
    assert pa not in pieces_now, "deleted by hand: not resurrected"
    assert pieces_now[pb] == moved, "moved by hand: left"
    assert pieces_now["fur_00000001"]["x_m"] == 3.0 and "plan_ai" not in pieces_now["fur_00000001"], "the correction, back"
    assert set(store.data["batches"][r["batch"]]["skipped"]) == {a["id"], b["id"]}
    assert counted.count("plan_ai_undo:item_skipped") == 2
    assert cor["state"] == "undone" and a["state"] == b["state"] == "committed_new", "what was left stays as it is"


def test_an_undo_with_everything_changed_writes_nothing_and_a_stale_after_deleting_the_target(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    pid = r["piece_ids"][sug["id"]]
    assert _call(WH.ws_house3d_edit, h, conn, pieces={pid: None}).get("data") is not None
    raw = _file(tmp_path).read_bytes()
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["undone"] == 0 and u["batch"] is None and u["skipped"][0]["why"] == "gone" and _file(tmp_path).read_bytes() == raw
    assert len(store.data["batches"]) == 1 and sug["state"] == "committed_new", "no undo batch; what it kept was the person's to delete"
    assert A.last_batch(store) is None, "spent: not offered for ever"
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["error"] == "already_undone"


def test_a_strip_on_a_stair_that_is_undone_stays_where_it_was_and_the_batch_survives_a_restored_backup(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    pid = r["piece_ids"][sug["id"]]
    run = {"pts": [[0, 0, 1.0], [1, 0, 1.0]], "face": "room", "loop": False, "piece": pid}
    assert _call(WH.ws_house3d_edit, h, conn, lights={"light.stairs": {"run": run}}).get("data") is not None
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["undone"] == 1
    kept = _on_disk(tmp_path)["lights"]["light.stairs"]["run"]
    assert "piece" not in kept and pid not in _on_disk(tmp_path)["pieces"], "as any delete leaves a strip"


def test_undo_of_a_batch_after_its_session_was_trimmed_still_works(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    store.data["sessions"].pop(sid)
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["undone"] == 1 and u["rev"] is None and list(_on_disk(tmp_path)["pieces"]) == ["fur_00000009"]
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id="pb_nothere")["error"] == "not_found"


# ═══ a failed write; a crash between the two files ═══════════════════════════

def _keep_one(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    return h, conn, store, sess, sid, counted, sug, {"sug_id": sug["id"], "v": "new", "final": _final(sug)}


@pytest.mark.parametrize("nth,how", [(0, "swallowed"), (0, "raised"), (1, "swallowed"), (1, "raised")], ids=["ledger-swallowed", "ledger-raised", "house-swallowed", "house-raised"])
def test_a_failed_write_leaves_everything_as_it_was_and_a_retry_works(monkeypatch, tmp_path, disk, nth, how):
    """Nth save after the backup: 0 the plan store's ledger, 1 the 3D file. The
    disk's failure is whatever Home Assistant's Store does: raises, or logs and
    returns normally, so only reading back tells."""
    h, conn, store, sess, sid, counted, sug, item = _keep_one(monkeypatch, tmp_path, disk)
    from custom_components.padspan_ha import ws_backup

    async def _bk(hass, note, keys, **_):
        return "bk_test"
    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    raw = _file(tmp_path).read_bytes()
    memory = copy.deepcopy(_run(H.async_get_store(h)).data)
    was_session = copy.deepcopy({k: v for k, v in sess.items() if k != "backup_id"})
    disk.fail = [None] * nth + [how]
    r = _commit(h, conn, sid, sess["rev"], item)
    assert r.get("error") == "save_failed", r
    disk.fail = []
    assert _file(tmp_path).read_bytes() == raw, "the 3D file's bytes"
    assert _run(H.async_get_store(h)).data == memory, "the 3D store in memory"
    now = store.session(sid)
    assert {k: v for k, v in now.items() if k != "backup_id"} == was_session, "the session, the suggestion, the rev"
    assert not store.data["batches"] and now["suggestions"][sug["id"]]["state"] == "queued"
    assert counted.count("plan_ai_commit:save_failed") == 1 and "plan_ai_verdict:stairs_new" not in counted
    # The net stays taken (one per session), and the same command works now.
    assert now["backup_id"] == "bk_test"
    r2 = _commit(h, conn, sid, now["rev"], {**item, "final": _final(now["suggestions"][sug["id"]])})
    assert r2["ok"] and len(_on_disk(tmp_path)["pieces"]) == 2


@pytest.mark.parametrize("nth,how", [(0, "swallowed"), (1, "swallowed")], ids=["ledger", "house"])
def test_a_failed_undo_leaves_everything_as_it_was(monkeypatch, tmp_path, disk, nth, how):
    h, conn, store, sess, sid, counted, sug, item = _keep_one(monkeypatch, tmp_path, disk)
    r = _commit(h, conn, sid, sess["rev"], item)
    raw = _file(tmp_path).read_bytes()
    disk.fail = [None] * nth + [how]
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u.get("error") == "save_failed"
    disk.fail = []
    assert _file(tmp_path).read_bytes() == raw
    assert store.session(sid)["suggestions"][sug["id"]]["state"] == "committed_new"
    assert store.data["batches"][r["batch"]]["undone_at"] is None and len(store.data["batches"]) == 1
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["undone"] == 1


def test_a_crash_after_the_ledger_before_the_3d_file_never_happened_and_the_piece_id_stands(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted, sug, item = _keep_one(monkeypatch, tmp_path, disk)
    raw = _file(tmp_path).read_bytes()

    class Crash(BaseException):
        pass

    async def _dies(self, new):
        raise Crash()
    monkeypatch.setattr(H.House3dStore, "async_write", _dies)
    with pytest.raises(Crash):
        _commit(h, conn, sid, sess["rev"], item)
    monkeypatch.setattr(H.House3dStore, "async_write", H_ASYNC_WRITE)
    assert _file(tmp_path).read_bytes() == raw
    on_disk = _on_disk(tmp_path, PLAN_AI_STORE_KEY)
    [(bid, b)] = on_disk["batches"].items()
    assert "pending" in b and on_disk["sessions"][sid]["suggestions"][sug["id"]]["state"] == "committed_new"
    minted = on_disk["sessions"][sid]["suggestions"][sug["id"]]["piece_id"]
    _forget_memory(h)
    # Home Assistant is back: the first read settles it. The 3D file says it never landed.
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    now = st["session"]["suggestions"][sug["id"]]
    assert now["state"] == "queued" and now["verdict"] is None and now["piece_id"] == minted
    assert st["undo"] is None
    on_disk = _on_disk(tmp_path, PLAN_AI_STORE_KEY)
    assert on_disk["batches"] == {} and on_disk["sessions"][sid]["suggestions"][sug["id"]]["state"] == "queued"
    # Kept again: the same piece, never a second.
    r = _commit(h, conn, sid, st["session"]["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(now)})
    assert r["ok"] and r["piece_ids"][sug["id"]] == minted and set(_on_disk(tmp_path)["pieces"]) == {"fur_00000009", minted}


def test_a_correction_cut_short_can_still_be_kept_as_a_stair_of_its_own(monkeypatch, tmp_path, disk):
    """Only a new stair's id is its own: the stair a correction was on isn't this suggestion's piece."""
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")})
    sug = _one(sess)

    class Crash(BaseException):
        pass

    async def _dies(self, new):
        raise Crash()
    monkeypatch.setattr(H.House3dStore, "async_write", _dies)
    with pytest.raises(Crash):
        _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    monkeypatch.setattr(H.House3dStore, "async_write", H_ASYNC_WRITE)
    _forget_memory(h)
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]
    now = st["suggestions"][sug["id"]]
    assert now["state"] == "queued" and now["piece_id"] is None
    r = _commit(h, conn, sid, st["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(now)})
    assert r["ok"] and r["piece_ids"][sug["id"]] != "fur_00000001" and _on_disk(tmp_path)["pieces"]["fur_00000001"]["x_m"] == 3.0


def test_a_crash_after_the_3d_file_before_the_last_mark_stands(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted, sug, item = _keep_one(monkeypatch, tmp_path, disk)

    class Crash(BaseException):
        pass

    async def _dies(store_, batch):
        raise Crash()
    monkeypatch.setattr(C, "_finish", _dies)
    with pytest.raises(Crash):
        _commit(h, conn, sid, sess["rev"], item)
    monkeypatch.setattr(C, "_finish", C_FINISH)
    pieces = _on_disk(tmp_path)["pieces"]
    assert len(pieces) == 2
    on_disk = _on_disk(tmp_path, PLAN_AI_STORE_KEY)
    [(bid, b)] = on_disk["batches"].items()
    assert "pending" in b
    _forget_memory(h)
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    assert st["session"]["suggestions"][sug["id"]]["state"] == "committed_new" and st["undo"]["id"] == bid
    assert "pending" not in _on_disk(tmp_path, PLAN_AI_STORE_KEY)["batches"][bid]
    # And it can be undone like any other.
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=bid)["undone"] == 1 and list(_on_disk(tmp_path)["pieces"]) == ["fur_00000009"]


def test_a_crash_there_then_the_stair_moved_by_hand_still_stands_by_its_note(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted, sug, item = _keep_one(monkeypatch, tmp_path, disk)

    class Crash(BaseException):
        pass

    async def _dies(store_, batch):
        raise Crash()
    monkeypatch.setattr(C, "_finish", _dies)
    with pytest.raises(Crash):
        _commit(h, conn, sid, sess["rev"], item)
    monkeypatch.setattr(C, "_finish", C_FINISH)
    _forget_memory(h)
    pid = next(k for k in _on_disk(tmp_path)["pieces"] if k != "fur_00000009")
    live = _on_disk(tmp_path)["pieces"][pid]
    assert _call(WH.ws_house3d_edit, h, conn, pieces={pid: {**live, "x_m": live["x_m"] + 1}}).get("data") is not None
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    assert st["session"]["suggestions"][sug["id"]]["state"] == "committed_new", "not taken back: a second commit would then be a second piece"


def test_a_crash_inside_an_undo_settles_both_ways(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted, sug, item = _keep_one(monkeypatch, tmp_path, disk)
    r = _commit(h, conn, sid, sess["rev"], item)
    raw = _file(tmp_path).read_bytes()

    class Crash(BaseException):
        pass

    async def _dies(self, new):
        raise Crash()
    monkeypatch.setattr(H.House3dStore, "async_write", _dies)
    with pytest.raises(Crash):
        _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    monkeypatch.setattr(H.House3dStore, "async_write", H_ASYNC_WRITE)
    _forget_memory(h)
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    assert _file(tmp_path).read_bytes() == raw and st["session"]["suggestions"][sug["id"]]["state"] == "committed_new"
    assert st["undo"]["id"] == r["batch"] and st["undo"]["puts_back"] is False

    async def _dies2(store_, batch):
        raise Crash()
    monkeypatch.setattr(C, "_finish", _dies2)
    with pytest.raises(Crash):
        _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    monkeypatch.setattr(C, "_finish", C_FINISH)
    _forget_memory(h)
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    assert list(_on_disk(tmp_path)["pieces"]) == ["fur_00000009"] and st["session"]["suggestions"][sug["id"]]["state"] == "undone"
    assert st["undo"]["puts_back"] is True


def test_an_unexpected_error_on_the_way_leaves_everything_as_it_was(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR}, _RAILS)
    sug = _one(sess)
    item = {"sug_id": sug["id"], "v": "new", "final": _final(sug)}
    from custom_components.padspan_ha import ws_backup

    async def _bk(hass, note, keys, **_):
        return "bk_test"
    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    monkeypatch.setattr(C, "_side_source", lambda *a: 1 / 0)
    hint = _one(sess, "railing")
    raw, rev = _file(tmp_path).read_bytes(), sess["rev"]
    r = _commit(h, conn, sid, rev, item, {"sug_id": hint["id"], "v": "new", "rail": {"side": "both", "style": "balustrade"}})
    assert r.get("error") == "save_failed" and _file(tmp_path).read_bytes() == raw
    now = store.session(sid)
    assert now["rev"] == rev and now["suggestions"][sug["id"]]["state"] == "queued" and not store.data["batches"]


def test_a_last_mark_that_wont_save_is_no_failure(monkeypatch, tmp_path, disk):
    """The commit point is the 3D file: the mark comes off in memory and the next
    read of the file settles it the same way."""
    h, conn, store, sess, sid, counted, sug, item = _keep_one(monkeypatch, tmp_path, disk)
    from custom_components.padspan_ha import ws_backup

    async def _bk(hass, note, keys, **_):
        return "bk_test"
    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    disk.fail = [None, None, "raised"]
    r = _commit(h, conn, sid, sess["rev"], item)
    assert r["ok"] and sug["state"] == "committed_new"
    disk.fail = []
    assert "pending" in next(iter(_on_disk(tmp_path, PLAN_AI_STORE_KEY)["batches"].values()))
    _forget_memory(h)
    assert _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]["suggestions"][sug["id"]]["state"] == "committed_new"


# ═══ what never was the draft's ══════════════════════════════════════════════

def test_failure_later_and_rejects_are_the_servers_at_click_so_discard_and_a_lost_page_lose_none(monkeypatch, tmp_path, disk):
    """A Discard or a lost page is the panel forgetting its draft: the server
    never hears of it. All three are on disk from the click, counted from the
    click, and no commit or undo touches them."""
    whole = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "shape": "straight"}, {"bbox_2d": [700, 550, 800, 750], "says": "UP", "shape": "straight"}]
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {}, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "no"}})
    a, b, c = [s for s in sess["suggestions"].values() if s["kind"] == "stairs"]
    rev = sess["rev"]
    rev = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev, sug_id=a["id"], v="failure", why="wrong_place")["rev"]
    rev = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev, sug_id=b["id"], v="later")["rev"]
    disk_now = _on_disk(tmp_path, PLAN_AI_STORE_KEY)
    assert disk_now["sessions"][sid]["suggestions"][a["id"]]["state"] == "failure" and disk_now["sessions"][sid]["suggestions"][b["id"]]["state"] == "later"
    assert len(disk_now["rejects"]) == 1 and counted.count("plan_ai_verdict:stairs_failure") == 1 and counted.count("plan_ai_verdict:stairs_later") == 1
    # The page is lost: everything is read again.
    _forget_memory(h)
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]
    assert st["suggestions"][a["id"]]["state"] == "failure" and st["suggestions"][b["id"]]["state"] == "later"
    # A commit of the third: the other two are untouched, and a failure can't be kept.
    third = st["suggestions"][c["id"]]
    r = _commit(h, conn, sid, st["rev"], {"sug_id": c["id"], "v": "new", "final": _final(third)})
    assert r["ok"]
    refused = _commit(h, conn, sid, r["rev"], {"sug_id": a["id"], "v": "new", "final": _final(third)})
    assert refused["code"] == "not_open" and refused["items"] == [a["id"]]
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]
    assert u["undone"] == 1 and st["suggestions"][a["id"]]["state"] == "failure" and st["suggestions"][b["id"]]["state"] == "later"
    assert len(_on_disk(tmp_path, PLAN_AI_STORE_KEY)["rejects"]) == 1


def test_later_and_looks_right_can_still_be_kept(monkeypatch, tmp_path, disk):
    whole = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "shape": "straight"}]
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {}, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "no"}})
    a, b = [s for s in sess["suggestions"].values() if s["kind"] == "stairs"]
    rev = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=a["id"], v="later")["rev"]
    rev = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=rev, sug_id=b["id"], v="right")["rev"]
    r = _commit(h, conn, sid, rev, {"sug_id": a["id"], "v": "new", "final": _final(a)}, {"sug_id": b["id"], "v": "new", "final": _final(b)})
    assert r["ok"] and a["state"] == b["state"] == "committed_new"


def test_keep_mine_is_already_here_a_reject_and_its_railing_hint_on_that_stair_stays(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target}, {"whole": _WHOLE, "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}})
    stair, hint = _one(sess), _one(sess, "railing")
    assert stair["match"]["relation"] == "correction" and hint["match"]["target"] == "fur_00000001"
    raw = _file(tmp_path).read_bytes()
    v = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=stair["id"], v="failure", why="already_here")
    assert stair["state"] == "failure" and stair["verdict"]["why"] == "already_here" and v["changed"] == [] and hint["state"] == "queued"
    assert counted.count("plan_ai_failure_why:stairs_already_here") == 1 and len(store.data["rejects"]) == 1
    assert _file(tmp_path).read_bytes() == raw


# ═══ railings ════════════════════════════════════════════════════════════════

_RAILS = {"whole": _WHOLE, "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}}


def test_a_railing_on_an_existing_stair_writes_side_and_style_and_nothing_else(monkeypatch, tmp_path, disk):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target}, _RAILS)
    hint = _one(sess, "railing")
    assert hint["geom"]["side"] is None or hint["geom"]["side"] in ("left", "right", "both")
    before = _on_disk(tmp_path)["pieces"]["fur_00000001"]
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": hint["id"], "v": "new", "rail": {"side": "inner", "style": "topless"}})
    assert r["ok"] and hint["state"] == "committed_new" and r["piece_ids"][hint["id"]] == "fur_00000001"
    p = _on_disk(tmp_path)["pieces"]["fur_00000001"]
    assert p["recipe"]["params"]["rail"] == "inner" and p["recipe"]["params"]["rail_style"] == "topless"
    assert (p["x_m"], p["y_m"], p["label"]) == (before["x_m"], before["y_m"], before["label"]), "the stair doesn't move"
    assert p["plan_ai"]["kind"] == "railing"
    assert counted.count("plan_ai_verdict:railing_new") == 1


@pytest.mark.parametrize("side,style", [("none", "topless"), ("auto", "topless"), ("left", "topless"), ("inner", "fancy"), (None, "topless")])
def test_a_railing_kept_is_a_real_side_and_style_never_less_rail(monkeypatch, tmp_path, disk, side, style):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target}, _RAILS)
    hint = _one(sess, "railing")
    raw = _file(tmp_path).read_bytes()
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": hint["id"], "v": "new", "rail": {"side": side, "style": style}})["error"] == "invalid"
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": hint["id"], "v": "new"})["error"] == "invalid"
    assert _file(tmp_path).read_bytes() == raw


def test_a_railing_on_a_new_stair_goes_with_it_or_after_it_never_before(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR}, _RAILS)
    stair, hint = _one(sess), _one(sess, "railing")
    assert hint["match"]["target"] is None and hint["of_stair"] == stair["id"]
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": hint["id"], "v": "new", "rail": {"side": "both", "style": "balustrade"}})["error"] == "stair_first"
    # Together, in any order: stairs go first.
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": hint["id"], "v": "new", "rail": {"side": "both", "style": "single_bar"}}, {"sug_id": stair["id"], "v": "new", "final": _final(stair)})
    assert r["ok"]
    pid = r["piece_ids"][stair["id"]]
    assert r["piece_ids"][hint["id"]] == pid
    p = _on_disk(tmp_path)["pieces"][pid]
    assert p["recipe"]["params"]["rail"] == "both" and p["recipe"]["params"]["rail_style"] == "single_bar" and p["plan_ai"]["kind"] == "stairs"
    [item] = store.data["batches"][r["batch"]]["items"]
    assert item["sug_id"] == stair["id"] and item["also"] == [hint["id"]], "one entry, one before and one after"


def test_a_railing_after_its_stair_was_kept_and_the_stair_deleted_or_undone(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR}, _RAILS)
    stair, hint = _one(sess), _one(sess, "railing")
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": stair["id"], "v": "new", "final": _final(stair)})
    pid = r["piece_ids"][stair["id"]]
    assert _call(WH.ws_house3d_edit, h, conn, pieces={pid: None}).get("data") is not None
    raw = _file(tmp_path).read_bytes()
    r2 = _commit(h, conn, sid, r["rev"], {"sug_id": hint["id"], "v": "new", "rail": {"side": "both", "style": "balustrade"}})
    assert r2["code"] == "changed_since" and r2["changed"][0]["why"] == "gone" and hint["state"] == "stale"
    assert _file(tmp_path).read_bytes() == raw, "the rail doesn't bring its stair back"


def test_a_hint_stale_after_its_stair_is_undone(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR}, _RAILS)
    stair, hint = _one(sess), _one(sess, "railing")
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": stair["id"], "v": "new", "final": _final(stair)})
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["undone"] == 1
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]
    assert st["suggestions"][hint["id"]]["state"] == "stale"


def test_a_stair_marked_wrong_takes_its_railing_with_it_and_keeping_the_rail_is_refused(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR}, _RAILS)
    stair, hint = _one(sess), _one(sess, "railing")
    v = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=stair["id"], v="failure", why="nothing_there")
    assert hint["state"] == "settled"
    raw = _file(tmp_path).read_bytes()
    r = _commit(h, conn, sid, v["rev"], {"sug_id": hint["id"], "v": "new", "rail": {"side": "both", "style": "balustrade"}})
    assert r["code"] == "not_open" and _file(tmp_path).read_bytes() == raw


@pytest.mark.parametrize("said,chosen,source", [("right", "outer", "ai"), ("left", "outer", "own"), ("both", "both", "ai"), (None, "inner", "own")])
def test_the_report_says_whose_side_a_railing_kept_has(monkeypatch, tmp_path, disk, said, chosen, source):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")}, _RAILS)
    hint = _one(sess, "railing")
    hint["geom"]["side"] = said
    _commit(h, conn, sid, sess["rev"], {"sug_id": hint["id"], "v": "new", "rail": {"side": chosen, "style": "balustrade"}})
    assert hint["verdict"]["side_source"] == source and counted.count(f"plan_ai_rail_side:{source}") == 1


# ═══ a stacked stair ═════════════════════════════════════════════════════════

def test_a_stacked_item_goes_on_the_floor_a_person_picks_and_is_counted(monkeypatch, tmp_path, disk):
    floors = ({"id": "basement", "name": "Basement"}, {"id": "main", "name": "Main"}, {"id": "upper", "name": "Upper"})
    pieces = {"fur_00000001": _stair("fur_00000001", "main", 1.5, 4.0, label="Main stairs", to="basement")}
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    _seed_file(tmp_path, pieces)
    h, conn, ai, media = _house(monkeypatch, tmp_path, None, plans=_ONE_PLAN, floors=floors)
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    sug = _one(sess)
    assert sug["match"]["relation"] == "stacked"
    final = _final(sug, floor_id="basement")
    final["recipe"]["params"]["to_floor"] = "main"
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": final})
    assert r["ok"]
    p = _on_disk(tmp_path)["pieces"][r["piece_ids"][sug["id"]]]
    assert p["floor_id"] == "basement" and p["recipe"]["params"]["to_floor"] == "main" and counted.count("plan_ai_stacked:taken") == 1


def test_a_split_level_floor_is_kept_as_its_whole_floor(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug, floor_id="main~0.75")})
    assert _on_disk(tmp_path)["pieces"][r["piece_ids"][sug["id"]]]["floor_id"] == "main"


# ═══ any order at all ════════════════════════════════════════════════════════

@pytest.mark.parametrize("seed", range(12))
def test_any_order_of_keeping_undoing_and_hand_edits_keeps_the_rules(monkeypatch, tmp_path, disk, seed):
    """Keep, undo, put back, move and delete by hand, in a random order. After
    every step: what no one touched keeps its value; a suggestion never has two
    pieces; a stair deleted by hand stays deleted; every undo reports what it
    left. At the end, undoing what stands leaves only what a person changed."""
    rng = random.Random(seed)
    sofa = {"id": "fur_00000003", "floor_id": "main", "x_m": 5.0, "y_m": 5.0, "z_m": 0.0, "rotation": 90.0, "origin": "build", "label": "Sofa", "library_id": None, "submission_id": None, "entity_id": None, "entity_reg_id": None,
            "updated_at": "2026-10-01T00:00:00+00:00", "recipe": {"kind": "sofa", "params": {}, "colors": [], "width_m": 2.0, "depth_m": 1.0, "height_m": 0.8}}
    whole = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "shape": "straight"}, {"bbox_2d": [700, 550, 800, 750], "says": "UP", "shape": "straight"}, {"bbox_2d": [400, 550, 500, 750], "says": "UP", "shape": "straight"}]
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000003": sofa}, {"whole": whole, "crop": {"present": True}, "rail": {"rail": "no"}})
    sofa_now = _on_disk(tmp_path)["pieces"]["fur_00000003"]
    deleted: set[str] = set()
    touched: set[str] = set()
    for _ in range(24):
        sugs = [s for s in store.session(sid)["suggestions"].values() if s["kind"] == "stairs"]
        rev = store.session(sid)["rev"]
        pieces = _on_disk(tmp_path)["pieces"]
        ours = [k for k, v in pieces.items() if v.get("plan_ai")]
        op = rng.choice(("keep", "keep", "undo", "put_back", "move", "delete"))
        if op == "keep" and (open_ := [s for s in sugs if s["state"] in C.OPEN_STATES]):
            pick = rng.sample(open_, k=rng.randint(1, min(2, len(open_))))
            r = _commit(h, conn, sid, rev, *[{"sug_id": s["id"], "v": "new", "final": _final(s)} for s in pick])
            assert r.get("ok") is True or r.get("code") == "changed_since", r
        elif op in ("undo", "put_back") and (u := A.last_batch(store)):
            r = _call(W.ws_plan_ai_undo, h, conn, batch_id=u["id"])
            assert r.get("undone", 0) + len(r.get("skipped", [])) >= 1 or r.get("error") in ("already_undone",), r
        elif op == "move" and ours:
            pid = rng.choice(ours)
            assert _call(WH.ws_house3d_edit, h, conn, pieces={pid: {**pieces[pid], "x_m": pieces[pid]["x_m"] + 0.05}}).get("data") is not None
            touched.add(pid)
        elif op == "delete" and ours:
            pid = rng.choice(ours)
            assert _call(WH.ws_house3d_edit, h, conn, pieces={pid: None}).get("data") is not None
            deleted.add(pid)
        now = _on_disk(tmp_path)["pieces"]
        assert now["fur_00000003"] == sofa_now, "what no one touched"
        assert not deleted & set(now), "deleted by hand stays deleted"
        kept = [s["piece_id"] for s in store.session(sid)["suggestions"].values() if s["kind"] == "stairs" and str(s["state"]).startswith("committed")]
        assert len(kept) == len(set(kept)), "one piece a suggestion"
        assert not any(v.get("plan_ai_pending") for v in now.values())
    for _ in range(40):                        # take back whatever still stands as kept; an undo that stands is left
        u = A.last_batch(store)
        if not u or u["puts_back"]:
            break
        _call(W.ws_plan_ai_undo, h, conn, batch_id=u["id"])
    now = _on_disk(tmp_path)["pieces"]
    assert now["fur_00000003"] == sofa_now and not deleted & set(now)
    left = {k for k, v in now.items() if v.get("plan_ai")}
    assert left <= touched | {s["piece_id"] for s in store.session(sid)["suggestions"].values() if str(s["state"]).startswith("committed")}, "only what a person changed, or a batch older than the last undo"


# ═══ a home with no 3D file yet ══════════════════════════════════════════════

def test_a_commit_on_a_home_with_no_3d_file_makes_it_and_its_backup_says_there_was_none(monkeypatch, tmp_path, disk):
    from custom_components.padspan_ha.ws_common import ABSENT_MARKER
    h, conn, ai, media = _house(monkeypatch, tmp_path, None, plans=_ONE_PLAN)
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    sug = _one(sess)
    assert not _file(tmp_path).exists() and sug["match"]["relation"] == "new"
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert r["ok"] and len(_on_disk(tmp_path)["pieces"]) == 1
    [bk] = _on_disk(tmp_path, BACKUPS_STORE_KEY)["backups"]
    assert bk["auto"] is True and bk["note"] == "Before keeping items from the plans" and bk["stores"][HOUSE3D_STORE_KEY] == {ABSENT_MARKER: True}
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["undone"] == 1 and _on_disk(tmp_path)["pieces"] == {}


# ═══ the Settings row ════════════════════════════════════════════════════════

def test_the_settings_row_is_an_administrators_under_the_switch_and_says_what_undo_does():
    src = (_PKG / "www" / "padspan-ha" / "views" / "settings.js").read_text(encoding="utf-8")
    assert 'ctx.hass.user.is_admin && settings.ai_plans_enabled === true) under.appendChild(_planAiLastRow(ctx, el))' in src
    body = src[src.index("function _planAiLastRow(ctx, el){"):src.index("function _atlas3dLibraryRows(")]
    assert 'wsCall("padspan_ha/plan_ai_sessions_get")' in body and 'wsCall("padspan_ha/plan_ai_undo", { batch_id: u.id })' in body
    assert "Last plan session:" in body and "Anything you changed since is left as it is." in body and "padspan-ha-house3d-changed" in body


# ═══ the gates ═══════════════════════════════════════════════════════════════

@pytest.mark.parametrize("off", ["switch", "house3d", "pro"])
def test_commit_and_undo_refuse_with_the_switch_live_aboard_or_pro_off(monkeypatch, tmp_path, disk, off):
    from custom_components.padspan_ha.const import DATA_SETTINGS
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    st = h.data[DOMAIN][DATA_SETTINGS].data
    if off == "switch":
        st["ai_plans_enabled"] = False
    elif off == "house3d":
        st["atlas_3d_enabled"] = False
    else:
        monkeypatch.setattr(W, "_tier_at_least", lambda hass, t: False)
    raw = _file(tmp_path).read_bytes()
    want = {"switch": "ai_plans_off", "house3d": "house3d_off", "pro": "house3d_off"}[off]
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})["error"] == want
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id="pb_x")["error"] == want
    assert _file(tmp_path).read_bytes() == raw


def test_the_status_and_the_sessions_say_what_undo_would_do(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    assert _call(W.ws_plan_ai_status, h, conn, session=sid)["undo"] is None
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    assert st["undo"] == {"id": r["batch"], "session": sid, "at": st["undo"]["at"], "items": 1, "puts_back": False}
    assert _call(W.ws_plan_ai_sessions_get, h, conn)["undo"]["id"] == r["batch"]
    _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert _call(W.ws_plan_ai_sessions_get, h, conn)["undo"]["puts_back"] is True


# ═══ the report ══════════════════════════════════════════════════════════════

def test_every_new_counter_is_in_the_closed_family_and_counts_only():
    for e in ("plan_ai_verdict:stairs_new", "plan_ai_verdict:stairs_correction", "plan_ai_verdict:railing_new", "plan_ai_verdict:railing_correction",
              "plan_ai_moved_after_accept:stairs", "plan_ai_stacked:taken", "plan_ai_rail_side:ai", "plan_ai_rail_side:own", "plan_ai_undo:batch",
              "plan_ai_undo:item_skipped", "plan_ai_undo:put_back", "plan_ai_undo:stairs", "plan_ai_undo:railing", "plan_ai_correction_taken:hand", "plan_ai_correction_taken:ai",
              "plan_ai_commit:done", "plan_ai_commit:changed_since", "plan_ai_commit:save_failed", "plan_ai_commit:backup_failed", "plan_ai_commit:rev_mismatch"):
        assert e in T.PLAN_AI_EVENTS and len(e) <= 64, e
    for name in ("not_found", "already_running", "house3d_newer", "plan_ai_newer"):
        assert f"plan_ai_commit:{name}" not in T.PLAN_AI_EVENTS, "a refusal with nothing to learn from is dropped by bump, never named"
    for code in ("rev_mismatch", "already_committed", "changed_since", "not_open", "stair_first", "invalid", "backup_failed", "save_failed"):
        assert f"plan_ai_commit:{code}" in T.PLAN_AI_EVENTS, code
    for code in ("already_undone", "save_failed"):
        assert f"plan_ai_undo:{code}" in T.PLAN_AI_EVENTS, code
    assert "plan_ai_commit:already_undone" not in T.PLAN_AI_EVENTS, "an undo's refusal is an undo's"


# ═══ a downgrade to v0.38.199 ════════════════════════════════════════════════

def _old_store():
    """The 3D file's reader and writer as they were at v0.38.199 (the stable),
    run on the file this version wrote."""
    try:
        src = subprocess.run(["git", "show", "v0.38.199:custom_components/padspan_ha/house3d_store.py"], cwd=_ROOT, capture_output=True, text=True, encoding="utf-8", timeout=30)
    except (OSError, subprocess.SubprocessError) as err:
        pytest.skip(f"git: {err}")
    if src.returncode != 0:
        pytest.skip("the v0.38.199 tag isn't in this clone")
    spec = importlib.util.spec_from_loader("custom_components.padspan_ha._house3d_store_0_38_199", loader=None)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "custom_components.padspan_ha"
    sys.modules[spec.name] = mod
    exec(compile(src.stdout, "house3d_store_0_38_199.py", "exec"), mod.__dict__)  # noqa: S102
    return mod


def test_a_downgrade_to_0_38_199_reads_the_file_and_saves_over_it(monkeypatch, tmp_path, disk):
    """The piece's plan_ai note and rail_style are keys it doesn't know, kept; the
    rail words are ones it knows; the store it never heard of it leaves alone.
    An older PadSpan refusing a whole save was the floating-stair incident."""
    old = _old_store()
    assert old.SCHEMA == 1 and "none" in old.STAIR_RAILS and "both" in old.STAIR_RAILS and "rail_style" not in str(old.STAIR_RAILS)
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall", to="upper")
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": target}, {"whole": [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "shape": "straight"}], "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}})
    cor = next(s for s in sess["suggestions"].values() if s["kind"] == "stairs" and s["match"]["relation"] == "correction")
    new = next(s for s in sess["suggestions"].values() if s["kind"] == "stairs" and s["match"]["relation"] == "new")
    rail = next(s for s in sess["suggestions"].values() if s["kind"] == "railing" and s["match"]["target"] == "fur_00000001")
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": cor["id"], "v": "correction"}, {"sug_id": new["id"], "v": "new", "final": _final(new)},
                {"sug_id": rail["id"], "v": "new", "rail": {"side": "both", "style": "topless"}})
    assert r["ok"]
    written = _on_disk(tmp_path)
    assert old.writable(written)
    read = old.normalise(copy.deepcopy(written))
    assert read["pieces"] == written["pieces"], "every key kept"
    # A whole Save in the old version: every piece as the old editor sends it, one moved.
    pid = r["piece_ids"][new["id"]]
    moved = {**read["pieces"][pid], "x_m": read["pieces"][pid]["x_m"] + 0.1}
    after = old.apply_edit(read, {"pieces": {pid: moved, "fur_00000001": read["pieces"]["fur_00000001"]}})
    assert after["pieces"][pid]["plan_ai"] == written["pieces"][pid]["plan_ai"], "the note survives its Save"
    assert after["pieces"]["fur_00000001"]["recipe"]["params"]["rail_style"] == "topless"
    assert after["pieces"]["fur_00000001"]["recipe"]["params"]["rail"] == "both"
