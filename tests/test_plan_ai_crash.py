"""Add data via plans, Stage 1b: a power cut at every file write, in every operation,
settled two ways; then every hand action a person can take before recovery runs.
From the safety review of 2026-11-02 (PadspanResearch/review-plan-ai-1b-2026-11-02.md).
Each case asserts the ledger's word against the 3D file."""
from __future__ import annotations

import copy
import json

import pytest

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import plan_ai_write as C
from custom_components.padspan_ha import ws_backup
from custom_components.padspan_ha import ws_house3d as WH
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY, PLAN_AI_STORE_KEY
from tests.test_house3d_edit import _file, disk, _DiskStore  # noqa: F401
from tests.test_house3d_store import _run
from tests.test_plan_ai import _WHOLE, _call, _stair
from tests.test_plan_ai_commit import _commit, _final, _forget_memory, _on_disk, _ready

_REAL_SAVE = _DiskStore.async_save
SOFA = {"id": "fur_00000003", "floor_id": "main", "x_m": 5.0, "y_m": 5.0, "z_m": 0.0, "rotation": 90.0, "origin": "build", "label": "Sofa", "library_id": None,
        "submission_id": None, "entity_id": None, "entity_reg_id": None, "updated_at": "2026-10-01T00:00:00+00:00",
        "recipe": {"kind": "sofa", "params": {}, "colors": [], "width_m": 2.0, "depth_m": 1.0, "height_m": 0.8}}
ANSWERS = {"whole": [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "up": "top", "shape": "straight"}],
           "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}}


class Cut(BaseException):
    pass


class Cutter:
    def __init__(self):
        self.n, self.at, self.when, self.log = 0, None, None, []


def _arm(monkeypatch):
    c = Cutter()

    async def save(self, data):
        i = c.n
        c.n += 1
        c.log.append(self.key)
        if i == c.at and c.when == "before":
            raise Cut(self.key)
        await _REAL_SAVE(self, data)
        if i == c.at and c.when == "after":
            raise Cut(self.key)
    monkeypatch.setattr(_DiskStore, "async_save", save)
    return c


def _setup(monkeypatch, root):
    _DiskStore.root, _DiskStore.writes, _DiskStore.fail, _DiskStore.slow = root, [], [], False
    root.mkdir(parents=True, exist_ok=True)
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall stairs", to="upper")
    target["updated_at"] = "2026-10-01T00:00:00+00:00"
    target["recipe"]["colors"] = []
    h, conn, store, sess, sid, counted = _ready(monkeypatch, root, {"fur_00000001": target, "fur_00000003": SOFA}, ANSWERS)
    return h, conn, store, sess, sid


def _pick(store, sid, kind, relation=None):
    return next(s for s in store.session(sid)["suggestions"].values() if s["kind"] == kind and (relation is None or s["match"]["relation"] == relation))


def _items(store, sid, what):
    out = []
    if "new" in what:
        s = _pick(store, sid, "stairs", "new")
        out.append({"sug_id": s["id"], "v": "new", "final": _final(s)})
    if "corr" in what:
        s = _pick(store, sid, "stairs", "correction")
        out.append({"sug_id": s["id"], "v": "correction"})
    if "rail" in what:
        s = next(s for s in store.session(sid)["suggestions"].values() if s["kind"] == "railing" and s["match"].get("target") == "fur_00000001" and s["state"] == "queued")
        out.append({"sug_id": s["id"], "v": s["match"]["relation"], "rail": {"side": "both", "style": "topless"}})
    return out


# What runs before the armed op, and the op itself.
def _pre(name, h, conn, store, sid):
    if name in ("new", "corr", "mix"):
        return None
    r = _commit(h, conn, sid, store.session(sid)["rev"], *_items(store, sid, ("new", "corr", "rail") if name != "join" else ("new",)))
    assert r.get("ok"), r
    if name == "undo":
        return r["batch"]
    if name == "join":
        return r["batch"]
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["undone"], u
    if name == "putback":
        return u["batch"]
    p = _call(W.ws_plan_ai_undo, h, conn, batch_id=u["batch"])
    assert p["undone"], p
    return p["batch"]      # undo3: the undo of the put-back


def _op(name, h, conn, store, sid, bid):
    if name == "new":
        return _commit(h, conn, sid, store.session(sid)["rev"], *_items(store, sid, ("new",)))
    if name == "corr":
        return _commit(h, conn, sid, store.session(sid)["rev"], *_items(store, sid, ("corr",)))
    if name == "mix":
        return _commit(h, conn, sid, store.session(sid)["rev"], *_items(store, sid, ("new", "corr", "rail")))
    if name == "join":
        return _commit(h, conn, sid, store.session(sid)["rev"], *_items(store, sid, ("corr", "rail")))
    return _call(W.ws_plan_ai_undo, h, conn, batch_id=bid)


OPS = ("new", "corr", "mix", "join", "undo", "putback", "undo3")
_SHAPE = lambda ps: sorted((p.get("label"), p["x_m"], p["y_m"], p["recipe"].get("params", {}).get("rail"), p["recipe"].get("params", {}).get("rail_style")) for p in ps.values())  # noqa: E731


def _dry(monkeypatch, tmp_path, name):
    root = tmp_path / f"dry_{name}"
    monkeypatch.setattr(_DiskStore, "async_save", _REAL_SAVE)
    h, conn, store, sess, sid = _setup(monkeypatch, root)
    bid = _pre(name, h, conn, store, sid)
    pre = copy.deepcopy(_on_disk(root)["pieces"])
    c = _arm(monkeypatch)
    r = _op(name, h, conn, store, sid, bid)
    assert r.get("ok"), r
    monkeypatch.setattr(_DiskStore, "async_save", _REAL_SAVE)
    return pre, copy.deepcopy(_on_disk(root)["pieces"]), c.log


@pytest.mark.parametrize("name", OPS)
@pytest.mark.parametrize("settle_by", ("status", "retry"))
def test_power_cut_at_every_write(monkeypatch, tmp_path, disk, name, settle_by):
    pre_d, post_d, log = _dry(monkeypatch, tmp_path, name)
    assert log, "no writes"
    bad = []
    for nth in range(len(log)):
        for when in ("before", "after"):
            root = tmp_path / f"{name}_{nth}_{when}"
            monkeypatch.setattr(_DiskStore, "async_save", _REAL_SAVE)
            h, conn, store, sess, sid = _setup(monkeypatch, root)
            bid = _pre(name, h, conn, store, sid)
            pre = copy.deepcopy(_on_disk(root)["pieces"])
            c = _arm(monkeypatch)
            c.at, c.when = nth, when
            try:
                _op(name, h, conn, store, sid, bid)
                bad.append((nth, when, "no cut happened"))
                continue
            except Cut:
                pass
            monkeypatch.setattr(_DiskStore, "async_save", _REAL_SAVE)
            on_disk = _on_disk(root)["pieces"]
            landed = _SHAPE(on_disk) == _SHAPE(post_d)
            untouched = on_disk == pre
            if not landed and not untouched:
                bad.append((nth, when, "3D file neither before nor after", log[nth]))
                continue
            _forget_memory(h)
            where = f"{nth}/{log[nth]}/{when}"
            if settle_by == "status":
                st = _call(W.ws_plan_ai_status, h, conn, session=sid)
            store2 = _run(A.async_get_store(h))
            if settle_by == "retry":
                # The first thing after the restart is the person pressing the same button again.
                if name in ("new", "corr", "mix", "join"):
                    try:
                        items = None
                        # A stale tab retries with the rev it had: refused; then with the fresh one.
                        rr = _call(W.ws_plan_ai_status, h, conn, session=sid)
                        store2 = _run(A.async_get_store(h))
                    except Exception as err:  # noqa: BLE001
                        bad.append((where, "status raised", repr(err)))
                        continue
                else:
                    rr = _call(W.ws_plan_ai_undo, h, conn, batch_id=bid)
                    if landed and rr.get("error") != "already_undone":
                        bad.append((where, "a second undo after it landed wasn't refused", rr))
                    if not landed and not rr.get("undone"):
                        bad.append((where, "the undo couldn't run again", rr))
                    continue
            disk_ledger = _on_disk(root, PLAN_AI_STORE_KEY)
            if any("pending" in b for b in disk_ledger["batches"].values()):
                bad.append((where, "still pending after settling"))
            # The suggestions and the file agree.
            sugs = store2.session(sid)["suggestions"]
            now = _on_disk(root)["pieces"]
            if name in ("new", "corr", "mix", "join"):
                states = {s["id"]: s["state"] for s in sugs.values() if s["kind"] == "stairs" or s["match"].get("target") == "fur_00000001"}
                kept = {k for k, v in states.items() if v.startswith("committed")}
                if landed:
                    # Everything the op kept must say so, and undo must be offered.
                    if not kept:
                        bad.append((where, "landed but nothing says committed", states))
                    if not (_call(W.ws_plan_ai_status, h, conn, session=sid).get("undo")):
                        bad.append((where, "landed but no undo offered"))
                else:
                    want_open = {s["sug_id"] for s in _items_safe(store2, sid, name)}
                    if not want_open:
                        bad.append((where, "never landed, but items are not open", states))
                    r = _op(name, h, conn, store2, sid, None)
                    if not r.get("ok"):
                        bad.append((where, "the retry failed", r))
                    elif _SHAPE(_on_disk(root)["pieces"]) != _SHAPE(post_d):
                        bad.append((where, "the retry didn't reach the same house", _SHAPE(_on_disk(root)["pieces"]), _SHAPE(post_d)))
                # Whatever happened: undoing what stands gives back the seed pieces.
                for _ in range(4):
                    u = A.last_batch(store2)
                    if not u or u["puts_back"]:
                        break
                    _call(W.ws_plan_ai_undo, h, conn, batch_id=u["id"])
                end = _on_disk(root)["pieces"]
                if set(end) != {"fur_00000001", "fur_00000003"}:
                    bad.append((where, "undo left pieces", sorted(end)))
                elif end["fur_00000003"] != SOFA:
                    bad.append((where, "the sofa changed"))
            else:
                # An undo cut short: the batch or its undo stands, and undoing whichever stands works.
                u = A.last_batch(store2, sid)
                if not u:
                    bad.append((where, "nothing to undo left"))
                else:
                    wanted_back = u["puts_back"]
                    if landed and u["id"] == bid:
                        bad.append((where, "landed but the old batch still offered"))
                    if not landed and u["id"] != bid:
                        bad.append((where, "never landed but another batch is offered", u, bid))
                    r = _call(W.ws_plan_ai_undo, h, conn, batch_id=u["id"])
                    if r.get("skipped"):
                        bad.append((where, "an undo after settling skipped items", r["skipped"]))
    print(f"CUTS {name}/{settle_by}: {len(log)} writes x 2 = {len(log) * 2} cut points; log {log}")
    assert not bad, json.dumps(bad, default=str, indent=1)


def _items_safe(store, sid, name):
    try:
        return _items(store, sid, {"new": ("new",), "corr": ("corr",), "mix": ("new", "corr", "rail"), "join": ("corr", "rail")}[name])
    except StopIteration:
        return []


# ── a hand action BEFORE recovery ran (nothing calls settle_pending at startup) ──

def _hand_delete(h, conn, root, store_):
    ps = _on_disk(root)["pieces"]
    pid = next((k for k, v in ps.items() if v.get("label") == "Stairs (from the plan)"), None)
    if pid:
        assert _call(WH.ws_house3d_edit, h, conn, pieces={pid: None}).get("data") is not None
    return pid


def _hand_move_target(h, conn, root, store_):
    ps = _on_disk(root)["pieces"]
    assert _call(WH.ws_house3d_edit, h, conn, pieces={"fur_00000001": {**ps["fur_00000001"], "x_m": ps["fur_00000001"]["x_m"] + 0.2}}).get("data") is not None


def _hand_other(h, conn, root, store_):
    ps = _on_disk(root)["pieces"]
    assert _call(WH.ws_house3d_edit, h, conn, pieces={"fur_00000003": {**ps["fur_00000003"], "x_m": ps["fur_00000003"]["x_m"] + 0.2}}).get("data") is not None


def _rails_chosen(h, conn, root, store_):
    assert _call(WH.ws_house3d_edit, h, conn, rails_chosen=True).get("data") is not None


def _clear_pieces(h, conn, root, store_):
    r = _call(WH.ws_house3d_clear, h, conn, only="pieces")
    assert r.get("cleared"), r


def _switch_off_on(h, conn, root, store_):
    st = h.data[DOMAIN][DATA_SETTINGS].data
    st["ai_plans_enabled"] = False
    assert _call(W.ws_plan_ai_status, h, conn, session="x").get("error") == "ai_plans_off"
    assert _call(W.ws_plan_ai_undo, h, conn, batch_id="x").get("error") == "ai_plans_off"
    st["ai_plans_enabled"] = True


HANDS = {"delete": _hand_delete, "move_target": _hand_move_target, "other": _hand_other, "rails_chosen": _rails_chosen, "clear_pieces": _clear_pieces, "switch": _switch_off_on}


@pytest.mark.parametrize("name", ("new", "corr", "mix", "undo", "putback"))
@pytest.mark.parametrize("cut", ("ledger", "house"))   # after the ledger, before the 3D file; after the 3D file, before the mark comes off
@pytest.mark.parametrize("hand", tuple(HANDS))
def test_hand_action_before_recovery(monkeypatch, tmp_path, disk, name, cut, hand):
    pre_d, post_d, log = _dry(monkeypatch, tmp_path, name)
    idx_house = max(i for i, k in enumerate(log) if k == HOUSE3D_STORE_KEY)
    nth, when = (idx_house, "before") if cut == "ledger" else (idx_house, "after")
    root = tmp_path / "run"
    monkeypatch.setattr(_DiskStore, "async_save", _REAL_SAVE)
    h, conn, store, sess, sid = _setup(monkeypatch, root)
    bid = _pre(name, h, conn, store, sid)
    c = _arm(monkeypatch)
    c.at, c.when = nth, when
    with pytest.raises(Cut):
        _op(name, h, conn, store, sid, bid)
    monkeypatch.setattr(_DiskStore, "async_save", _REAL_SAVE)
    _forget_memory(h)
    HANDS[hand](h, conn, root, None)
    st = _call(W.ws_plan_ai_status, h, conn, session=sid)
    store2 = _run(A.async_get_store(h))
    now = _on_disk(root)["pieces"]
    disk_ledger = _on_disk(root, PLAN_AI_STORE_KEY)
    problems = []
    if any("pending" in b for b in disk_ledger["batches"].values()):
        problems.append("still pending")
    sugs = store2.session(sid)["suggestions"]
    # The ledger's claim against the file: a suggestion "undone" whose piece still stands exactly as committed,
    # or a batch "undone" when nothing happened, is recovery writing the ledger wrong.
    for s in sugs.values():
        if s["kind"] != "stairs":
            continue
        pid = s.get("piece_id")
        if s["state"] == "undone" and pid and s["verdict"] and s["verdict"]["v"] == "new" and pid in now and now[pid].get("label") == "Stairs (from the plan)":
            problems.append(f"{s['id']} says undone but its stair is still in the house")
        if s["state"] == "committed_new" and pid not in now and hand not in ("delete", "clear_pieces"):
            problems.append(f"{s['id']} says kept but its stair isn't in the house")
    # The file: AI pieces unaccounted for by any standing batch.
    for k, v in now.items():
        if v.get("label") == "Stairs (from the plan)":
            owned = any(it.get("target") == f"pieces/{k}" and not b.get("undone_at") and not b.get("undo_of") or (b.get("undo_of") and it.get("target") == f"pieces/{k}" and not b.get("undone_at"))
                        for b in store2.data["batches"].values() for it in b.get("items") or [])
            if not owned:
                problems.append(f"{k} is in the house with no batch standing to undo it")
    # A correction: the ledger's word against the file.
    for s in sugs.values():
        if s["kind"] == "stairs" and s["match"]["relation"] == "correction" and hand not in ("clear_pieces",):
            live = now.get("fur_00000001")
            corrected = bool(live) and abs(live["x_m"] - s["geom"]["x_m"]) < 0.3
            if s["state"] == "undone" and corrected:
                problems.append(f"correction says undone but the stair is still where the AI put it")
            if s["state"] == "committed_correction" and live and not corrected and hand != "move_target" and (live.get("plan_ai") or {}).get("kind") is None:
                problems.append(f"correction says kept but the stair isn't where the AI put it")
    # No suggestion has two pieces after a retry.
    assert not problems, (name, cut, hand, problems, sorted(now), {s["id"]: s["state"] for s in sugs.values()})
