"""Add data via plans, Stage 1b: what the safety review of 2026-11-02 found, each by
the scenario that found it (PadspanResearch/review-plan-ai-1b-2026-11-02.md). The
power cuts are in test_plan_ai_crash.py; the panel's side in tests/js/plans_list.mjs,
live_aboard_draft.mjs and live_aboard_edit.mjs.
"""
from __future__ import annotations

import asyncio
import copy
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_backup
from custom_components.padspan_ha import ws_house3d as WH
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.const import BACKUPS_STORE_KEY, DOMAIN, FABRIC_STORE_KEY, HOUSE3D_STORE_KEY
from tests.test_house3d_edit import _DiskStore, _file, _seed, disk  # noqa: F401
from tests.test_house3d_store import _run
from tests.test_plan_ai import _WHOLE, _call, _house, _session, _stair
from tests.test_plan_ai_commit import _FAR_STAIR, _ONE_PLAN, _RAILS, _commit, _final, _forget_memory, _on_disk, _one, _ready
from tests.test_plan_ai_crash import _REAL_SAVE, Cut, _arm, _items, _pick, _setup

_TWO_FOUND = {"whole": [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "up": "top", "shape": "straight"}], "crop": {"present": True}, "rail": {"rail": "no"}}


def _full_target(**over):
    t = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall stairs", to="upper")
    t["recipe"]["colors"] = ["#5b6b7a"]
    t.update(over)
    return t


def _backups(tmp_path):
    return _on_disk(tmp_path, BACKUPS_STORE_KEY).get("backups", [])


# ── F1: a correction is position, a railing is side and style ─────────────────

def test_a_correction_from_a_stale_draft_doesnt_put_back_a_saved_shape_size_or_colour(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": _full_target()})
    sug = _one(sess)
    stale_draft = copy.deepcopy(_on_disk(tmp_path)["pieces"]["fur_00000001"])     # tab A opened Edit
    b = copy.deepcopy(stale_draft)                                                # tab B changes it and saves
    b["recipe"]["params"].update(shape="l", turn="right", style="floating")
    b["recipe"].update(width_m=1.4, depth_m=2.4, colors=["#112233"])
    assert _call(WH.ws_house3d_edit, h, conn, pieces={"fur_00000001": b}).get("data") is not None
    # An older panel's whole draft piece.
    final = {**stale_draft, "x_m": sug["geom"]["x_m"], "y_m": sug["geom"]["y_m"]}
    rev = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]["rev"]
    r = _commit(h, conn, sid, rev, {"sug_id": sug["id"], "v": "correction", "final": final})
    assert r["ok"], r
    now = _on_disk(tmp_path)["pieces"]["fur_00000001"]
    params, rec = now["recipe"]["params"], now["recipe"]
    assert (params["shape"], params["turn"], params["style"], rec["width_m"], rec["depth_m"], rec["colors"]) == ("l", "right", "floating", 1.4, 2.4, ["#112233"])
    assert (now["x_m"], now["y_m"]) == (sug["geom"]["x_m"], sug["geom"]["y_m"])


def test_a_correction_carries_nothing_but_position_whatever_is_sent(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": _full_target()})
    sug = _one(sess)
    live = copy.deepcopy(_on_disk(tmp_path)["pieces"]["fur_00000001"])
    final = copy.deepcopy(live)
    final.update(x_m=1.75, y_m=4.25, rotation=33.0, z_m=0.4, floor_id="upper", label="pwned", entity_id="light.pwned", library_id="x")
    final["recipe"]["params"].update(shape="u", rail="both", rail_style="topless", to_floor="main")
    final["recipe"].update(width_m=2.0, depth_m=2.0, height_m=3.0, colors=["#000000"], details={"x": 1}, kind="sofa")
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction", "final": final})
    assert r["ok"], r
    now = _on_disk(tmp_path)["pieces"]["fur_00000001"]
    assert (now["x_m"], now["y_m"]) == (1.75, 4.25), "a drag after taking the AI's position counts"
    changed = sorted(k for k in set(now) | set(live) if k not in ("plan_ai", "updated_at", "x_m", "y_m") and now.get(k) != live.get(k))
    assert not changed, changed


def test_a_railing_changes_side_and_style_and_nothing_else(monkeypatch, tmp_path, disk):
    t = _full_target()
    t["recipe"]["params"].update(shape="straight", style="open", turn="left", a_newer_param=3)
    t.update(a_newer_key={"k": 1}, entity_id="light.stair", library_id="lib1", updated_at="2026-10-01T00:00:00+00:00")
    t["recipe"]["details"] = {"maker": "x"}
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000001": t}, _RAILS)
    hint = _one(sess, "railing")
    live = copy.deepcopy(_on_disk(tmp_path)["pieces"]["fur_00000001"])
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": hint["id"], "v": hint["match"]["relation"], "rail": {"side": "inner", "style": "single_bar"}})
    assert r["ok"], r
    now = _on_disk(tmp_path)["pieces"]["fur_00000001"]
    assert (now["recipe"]["params"]["rail"], now["recipe"]["params"]["rail_style"]) == ("inner", "single_bar")
    a, b = copy.deepcopy(live), copy.deepcopy(now)
    for d in (a, b):
        d.pop("plan_ai", None)
        d.pop("updated_at", None)
        d["recipe"]["params"].pop("rail", None)
        d["recipe"]["params"].pop("rail_style", None)
        for k in ("entity_reg_id", "submission_id"):      # the schema's null fields, as any saved piece gets them
            if d.get(k) is None:
                d.pop(k, None)
    assert a == b, {k: (a.get(k), b.get(k)) for k in set(a) | set(b) if a.get(k) != b.get(k)}


# ── F3: the safety backup restores what was there ─────────────────────────────

def _restore(h, backup_id):
    c = MagicMock()
    _run(ws_backup.ws_store_backup_restore(h, c, {"id": 1, "backup_id": backup_id}))
    assert not c.send_error.called, c.send_error.call_args


def test_the_safety_backup_of_a_house_with_a_file_and_no_furniture_takes_the_stair_away(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert r["ok"] and r["backup_id"]
    pid = r["piece_ids"][sug["id"]]
    assert pid in _on_disk(tmp_path)["pieces"]
    _restore(h, r["backup_id"])
    assert pid not in _on_disk(tmp_path)["pieces"]
    assert pid not in _run(H.async_get_store(h)).data["pieces"]
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["undone"] == 0 and u["skipped"][0]["why"] == "gone", "the ledger reports, and resurrects nothing"


def test_the_safety_backup_with_furniture_takes_only_the_stair_away(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    _restore(h, r["backup_id"])
    assert set(_on_disk(tmp_path)["pieces"]) == {"fur_00000009"}


def test_the_safety_backup_with_no_3d_file_at_all_takes_it_away(monkeypatch, tmp_path, disk):
    async def _remove(self):
        self._path().unlink(missing_ok=True)
    monkeypatch.setattr(_DiskStore, "async_remove", _remove, raising=False)     # the fixture's Store lacks it; HA's has it
    h, conn, ai, media = _house(monkeypatch, tmp_path, None, plans=_ONE_PLAN)
    store, sess, sid = _run(_session(h, ("m1",), ("stairs",)))
    sug = _one(sess)
    assert not _file(tmp_path).exists()
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    assert r["ok"]
    _restore(h, r["backup_id"])
    assert _run(H.async_get_store(h)).data["pieces"] == {}


def test_any_other_backup_with_no_furniture_still_keeps_what_was_placed_since(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {})
    net = _run(ws_backup._auto_backup(h, "Before something else", [HOUSE3D_STORE_KEY]))
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    _restore(h, net)
    assert r["piece_ids"][sug["id"]] in _on_disk(tmp_path)["pieces"], "only the plan AI's net is marked exact"


# ── F4: one slot, and a session whose net is gone takes another ───────────────

def _new_session(h, name):
    s, se, si = _run(_session(h, ("m1",), ("stairs",)))
    s.data["sessions"][name] = s.data["sessions"].pop(si)
    return se


def test_plan_sessions_never_push_out_another_operations_net(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    _seed(tmp_path, {"floors": {}}, FABRIC_STORE_KEY)
    for note in ("Before Reset Spatial Model", "Before removing everything in Live Aboard", "Before PadSpan Bright import"):
        assert _run(ws_backup._auto_backup(h, note, [FABRIC_STORE_KEY]))
    for i in range(4):
        se = _new_session(h, f"ps_{i}")
        su = _one(se)
        r = _commit(h, conn, f"ps_{i}", se["rev"], {"sug_id": su["id"], "v": "new", "final": _final(su)})
        assert r["ok"], r
        assert r["backup_id"] in [b["id"] for b in _backups(tmp_path)]
        assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["undone"] == 1
    notes = [b["note"] for b in _backups(tmp_path)]
    assert notes.count("Before keeping items from the plans") == 1, notes
    for note in ("Before Reset Spatial Model", "Before removing everything in Live Aboard", "Before PadSpan Bright import"):
        assert note in notes, notes


def test_the_shared_cap_is_as_it_was_for_every_other_caller(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "new", "final": _final(sug)})
    for i in range(5):
        assert _run(ws_backup._auto_backup(h, f"another {i}", [HOUSE3D_STORE_KEY]))
    notes = [b["note"] for b in _backups(tmp_path)]
    assert notes == ["Before keeping items from the plans", "another 2", "another 3", "another 4"], notes
    assert [b["id"] for b in _backups(tmp_path)][0] == r["backup_id"]
    assert not any("slot" in b or "exact" in b for b in _backups(tmp_path)[1:]), "the others' backups are as they were"


def _keep_two(monkeypatch, tmp_path):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR}, _TWO_FOUND)
    a, b = [s for s in sess["suggestions"].values() if s["kind"] == "stairs"]
    r1 = _commit(h, conn, sid, sess["rev"], {"sug_id": a["id"], "v": "new", "final": _final(a)})
    assert r1["ok"], r1
    return h, conn, sid, b, r1


def test_a_session_whose_net_was_replaced_takes_a_new_one(monkeypatch, tmp_path, disk):
    h, conn, sid, b, r1 = _keep_two(monkeypatch, tmp_path)
    other = _run(ws_backup._auto_backup(h, "Before keeping items from the plans", [HOUSE3D_STORE_KEY], slot="plan_ai", exact=True))
    assert [x["id"] for x in _backups(tmp_path)] == [other], "another session's took the slot"
    r2 = _commit(h, conn, sid, r1["rev"], {"sug_id": b["id"], "v": "new", "final": _final(b)})
    assert r2["ok"] and r2["backup_id"] not in (r1["backup_id"], other)
    assert [x["id"] for x in _backups(tmp_path)] == [r2["backup_id"]]
    assert r1["piece_ids"][next(iter(r1["piece_ids"]))] in _backups(tmp_path)[0]["stores"][HOUSE3D_STORE_KEY]["pieces"], "the new net is the house as it stands now"


def test_a_session_whose_net_a_person_deleted_takes_a_new_one(monkeypatch, tmp_path, disk):
    h, conn, sid, b, r1 = _keep_two(monkeypatch, tmp_path)
    bk = _run(ws_backup._load_backups(h))
    bk["backups"] = []
    _run(ws_backup._save_backups(h, bk))
    r2 = _commit(h, conn, sid, r1["rev"], {"sug_id": b["id"], "v": "new", "final": _final(b)})
    assert r2["ok"] and [x["id"] for x in _backups(tmp_path)] == [r2["backup_id"]]


def test_a_session_whose_net_stands_takes_no_other(monkeypatch, tmp_path, disk):
    h, conn, sid, b, r1 = _keep_two(monkeypatch, tmp_path)
    r2 = _commit(h, conn, sid, r1["rev"], {"sug_id": b["id"], "v": "new", "final": _final(b)})
    assert r2["ok"] and r2["backup_id"] == r1["backup_id"] and [x["id"] for x in _backups(tmp_path)] == [r1["backup_id"]]


# ── F5: recovery doesn't take a hand delete for an undo that landed ───────────

def test_an_undo_cut_before_the_file_then_a_hand_delete_doesnt_claim_the_rest_undone(monkeypatch, tmp_path, disk):
    root = tmp_path / "r"
    h, conn, store, sess, sid = _setup(monkeypatch, root)
    r = _commit(h, conn, sid, sess["rev"], *_items(store, sid, ("new", "corr")))
    assert r["ok"]
    corrected = copy.deepcopy(_on_disk(root)["pieces"]["fur_00000001"])
    new_pid = next(k for k, v in _on_disk(root)["pieces"].items() if v["label"] == "Stairs (from the plan)")
    c = _arm(monkeypatch)
    c.at, c.when = 1, "before"                 # the undo's writes: ledger, then the 3D file
    with pytest.raises(Cut):
        _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    monkeypatch.setattr(_DiskStore, "async_save", _REAL_SAVE)
    assert _on_disk(root)["pieces"]["fur_00000001"] == corrected, "the undo never reached the file"
    _forget_memory(h)
    assert _call(WH.ws_house3d_edit, h, conn, pieces={new_pid: None}).get("data") is not None
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    store2 = _run(A.async_get_store(h))
    assert _pick(store2, sid, "stairs", "correction")["state"] == "committed_correction", "the correction still stands in the file"
    assert st["undo"]["id"] == r["batch"] and st["undo"]["puts_back"] is False
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["undone"] == 1 and u["skipped"][0]["why"] == "gone"
    assert _on_disk(root)["pieces"]["fur_00000001"]["x_m"] == 3.0 and new_pid not in _on_disk(root)["pieces"], "the stair deleted by hand stays deleted"


# ── F6: one undo for the whole session, after a put-back too ──────────────────

def test_a_keep_after_a_put_back_joins_it_so_one_undo_still_takes_it_all(monkeypatch, tmp_path, disk):
    root = tmp_path / "r"
    h, conn, store, sess, sid = _setup(monkeypatch, root)
    seed = copy.deepcopy(_on_disk(root)["pieces"])
    a = _commit(h, conn, sid, sess["rev"], *_items(store, sid, ("corr",)))
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=a["batch"])
    p = _call(W.ws_plan_ai_undo, h, conn, batch_id=u["batch"])
    assert p["undone"] == 1 and p["undo"]["puts_back"] is False
    rev = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]["rev"]
    b = _commit(h, conn, sid, rev, *_items(store, sid, ("new",)))
    assert b["ok"] and b["batch"] == p["batch"] and b["undo"]["items"] == 2, b["undo"]
    kept = copy.deepcopy(_on_disk(root)["pieces"])
    assert len(kept) == 3 and kept["fur_00000001"]["x_m"] != 3.0
    q = _call(W.ws_plan_ai_undo, h, conn, batch_id=b["batch"])
    assert q["undone"] == 2 and q["of"] == 2 and q["undo"]["puts_back"] is True
    assert _on_disk(root)["pieces"] == seed, "both groups are out, byte for byte"
    back = _call(W.ws_plan_ai_undo, h, conn, batch_id=q["batch"])
    assert back["undone"] == 2 and back["undo"]["puts_back"] is False
    assert _on_disk(root)["pieces"] == kept


def test_a_keep_after_an_undo_doesnt_join_the_undo(monkeypatch, tmp_path, disk):
    root = tmp_path / "r"
    h, conn, store, sess, sid = _setup(monkeypatch, root)
    a = _commit(h, conn, sid, sess["rev"], *_items(store, sid, ("corr",)))
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=a["batch"])
    rev = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]["rev"]
    b = _commit(h, conn, sid, rev, *_items(store, sid, ("new",)))
    assert b["ok"] and b["batch"] not in (a["batch"], u["batch"]) and b["undo"]["items"] == 1


# ── W4: a status doesn't answer with the state a failed commit threw away ─────

@pytest.mark.parametrize("yields", range(0, 12))
def test_a_status_during_a_failing_commit_answers_what_stands(monkeypatch, tmp_path, disk, yields):
    h, conn, store, sess, sid, counted = _ready(monkeypatch, tmp_path, {"fur_00000009": _FAR_STAIR})
    sug = _one(sess)
    item = {"sug_id": sug["id"], "v": "new", "final": _final(sug)}
    real = _DiskStore.async_save

    async def save(self, data):
        if self.key == HOUSE3D_STORE_KEY:
            await asyncio.sleep(0)
            return None                        # swallowed: the commit puts everything back
        await real(self, data)
    monkeypatch.setattr(_DiskStore, "async_save", save)

    async def go():
        conn_c, conn_s = MagicMock(), MagicMock()
        conn_c.user = conn_s.user = conn.user
        said = []                              # what a real connection does: written out as it is sent
        conn_s.send_result.side_effect = lambda _id, r: said.append(copy.deepcopy(r))
        rev = store.session(sid)["rev"]
        task = asyncio.ensure_future(W.ws_plan_ai_commit(h, conn_c, {"id": 1, "session": sid, "rev": rev, "items": [item]}))
        for _ in range(yields):
            await asyncio.sleep(0)
        await W.ws_plan_ai_status(h, conn_s, {"id": 2, "session": sid})
        await task
        return conn_c, said
    conn_c, said = asyncio.new_event_loop().run_until_complete(go())
    assert conn_c.send_error.call_args[0][1] == "save_failed", conn_c.send_error.call_args
    assert said[0]["session"]["suggestions"][sug["id"]]["state"] == "queued"


# ── W5: the button keeps its word past the batch cap ──────────────────────────

def test_puts_back_keeps_its_word_past_the_batch_cap(monkeypatch, tmp_path, disk):
    root = tmp_path / "r"
    h, conn, store, sess, sid = _setup(monkeypatch, root)
    bid = _commit(h, conn, sid, sess["rev"], *_items(store, sid, ("new",)))["batch"]
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    for i in range(1, 30):
        u = _call(W.ws_plan_ai_undo, h, conn, batch_id=bid)
        assert u["undone"] == 1, (i, u)
        bid = u["batch"]
        assert A.last_batch(store, sid)["puts_back"] is (i % 2 == 1), i
    assert len(store.data["batches"]) <= A.MAX_BATCHES
    assert counted.count("plan_ai_undo:put_back") == 14, "every other press past the first"


# ── W6: an undo's refusal is an undo's ────────────────────────────────────────

def test_an_undo_refusal_or_failure_is_counted_as_an_undo_not_a_commit(monkeypatch, tmp_path, disk):
    h, conn, store, sess, sid = _setup(monkeypatch, tmp_path / "r")
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    r = _commit(h, conn, sid, sess["rev"], *_items(store, sid, ("new",)))
    counted.clear()
    _DiskStore.fail = ["swallowed"]
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"]).get("error") == "save_failed"
    _DiskStore.fail = []
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["undone"] == 1
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"]).get("error") == "already_undone"
    assert {"plan_ai_undo:save_failed", "plan_ai_undo:already_undone"} <= set(counted) and not [e for e in counted if e.startswith("plan_ai_commit:")], counted
    assert all(T.event_allowed(e) for e in counted), counted


# ── W7: "Already in your house", once it isn't ────────────────────────────────

def test_a_later_sessions_duplicate_goes_stale_when_its_stair_is_undone_and_can_be_kept(monkeypatch, tmp_path, disk):
    root = tmp_path / "r"
    h, conn, store, sess, sid = _setup(monkeypatch, root)
    r = _commit(h, conn, sid, sess["rev"], *_items(store, sid, ("new",)))
    store.data["sessions"]["ps_one"] = store.data["sessions"].pop(sid)
    for b in store.data["batches"].values():
        b["session"] = "ps_one"
    s2, sess2, sid2 = _run(_session(h, ("m1",), ("stairs",)))
    dup = [s for s in sess2["suggestions"].values() if s["state"] == "duplicate" and s["match"]["target"] in r["piece_ids"].values()]
    assert dup, "the kept stair is a duplicate on the second read"
    st = _call(W.ws_plan_ai_status, h, conn, session=sid2)["session"]
    assert st["suggestions"][dup[0]["id"]]["state"] == "duplicate", "while its stair stands"
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])["undone"] == 1
    st = _call(W.ws_plan_ai_status, h, conn, session=sid2)["session"]
    assert st["suggestions"][dup[0]["id"]]["state"] == "stale"
    k = _commit(h, conn, sid2, st["rev"], {"sug_id": dup[0]["id"], "v": "new", "final": _final(dup[0])})
    assert k["ok"], k
