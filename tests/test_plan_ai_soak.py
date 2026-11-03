"""Add data via plans, Stage 1b: every interleaving. A few seeds of the review's soak
(PadspanResearch/review-plan-ai-1b-2026-11-02.md): rounds of one to three commands overlapping in one
event loop, each yielding a random number of times at every store read and write, plain, with backups
and restores, and with power cuts. After every round: the sofa untouched, no draft note in the file,
memory equal to disk, every other file keeping its bytes, and no stair deleted by hand back in the house
unless a person pressed Put back or kept it again."""
from __future__ import annotations

import asyncio
import copy
import json
import random
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import ws_backup
from custom_components.padspan_ha import ws_house3d as WH
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.const import (CALIBRATION_STORE_KEY, DATA_SETTINGS, DOMAIN, FABRIC_STORE_KEY, HOUSE3D_STORE_KEY, MAPS_STORE_KEY,
                                                MODEL_STORE_KEY, PLAN_AI_STORE_KEY, SETTINGS_STORE_KEY)
from tests.test_house3d_edit import _DiskStore, _file, _seed, disk  # noqa: F401
from tests.test_plan_ai import _WHOLE, _house, _session, _stair
from tests.test_plan_ai_commit import _final, _forget_memory, _on_disk, _seed_file
from tests.test_plan_ai_crash import SOFA, Cut

_REAL_SAVE, _REAL_LOAD = _DiskStore.async_save, _DiskStore.async_load
WHOLE = [*_WHOLE, {"bbox_2d": [700, 100, 800, 500], "says": "UP", "up": "top", "shape": "straight"},
         {"bbox_2d": [400, 550, 500, 750], "says": "UP", "shape": "straight"}, {"bbox_2d": [700, 550, 800, 750], "says": "UP", "shape": "straight"}]
ANS = {"whole": WHOLE, "crop": {"present": True}, "rail": {"rail": "yes", "side": "right"}}
SEEDS = {FABRIC_STORE_KEY: {"floors": {"main": {"f": 1}}}, MODEL_STORE_KEY: {"m": 1}, MAPS_STORE_KEY: {"maps": []}, CALIBRATION_STORE_KEY: {"points": [1, 2, 3]}}


def _conn(user):
    c = MagicMock()
    c.user = user
    return c


def _ans(c):
    if c.send_error.called:
        return {"error": c.send_error.call_args[0][1], "message": c.send_error.call_args[0][2]}
    return c.send_result.call_args[0][1] if c.send_result.called else None


def _start(monkeypatch, root, seed):
    target = _stair("fur_00000001", "main", 3.0, 4.0, label="Hall stairs", to="upper")
    for k, v in SEEDS.items():
        _seed(root, v, k)
    _seed_file(root, {"fur_00000001": target, "fur_00000003": SOFA})
    h, conn, ai, media = _house(monkeypatch, root, ANS, plans=(("m1", "Main", "main", __import__("tests.test_plan_ai", fromlist=["_T1"])._T1),))
    return h, conn


@pytest.mark.parametrize("mode", ("plain", "restores", "cuts"))
@pytest.mark.parametrize("seed", range(25))
def test_soak(monkeypatch, tmp_path, disk, seed, mode):
    rng = random.Random(f"{mode}{seed}")
    root = tmp_path
    h, conn = _start(monkeypatch, root, seed)
    cut = {"p": 0.0, "dead": False}

    async def load(self):
        for _ in range(rng.randint(0, 3)):
            await asyncio.sleep(0)
        if cut["dead"]:
            raise Cut("dead")      # the machine is off: nothing else runs
        return await _REAL_LOAD(self)

    async def save(self, data):
        for _ in range(rng.randint(0, 3)):
            await asyncio.sleep(0)
        if cut["dead"]:
            raise Cut("dead")
        if cut["p"] and self.key in (HOUSE3D_STORE_KEY, PLAN_AI_STORE_KEY) and rng.random() < cut["p"]:
            cut["dead"] = True
            if rng.random() < 0.5:
                raise Cut(self.key)
            await _REAL_SAVE(self, data)
            raise Cut(self.key)
        await _REAL_SAVE(self, data)
    monkeypatch.setattr(_DiskStore, "async_load", load)
    monkeypatch.setattr(_DiskStore, "async_save", save)

    problems: list = []
    deleted: set[str] = set()
    user = conn.user
    backups: list[str] = []
    a_restore_ran = {"v": False}

    async def run():
        store, sess, sid = await _session(h, ("m1",), ("stairs", "railing"))
        fixed = {k: copy.deepcopy(_file(root, k).read_bytes()) for k in SEEDS}
        sofa = copy.deepcopy(_on_disk(root)["pieces"]["fur_00000003"])

        async def keep(rev=None):
            st = store.session(sid)
            if not st:
                return
            open_ = [s for s in st["suggestions"].values() if s["kind"] == "stairs" and s["state"] in ("queued", "later", "right", "stale")]
            if not open_:
                return
            pick = rng.sample(open_, k=rng.randint(1, min(2, len(open_))))
            deleted.difference_update(x.get("piece_id") for x in pick)   # keeping it again: their own act, even if the power goes in the middle
            items = []
            for s in pick:
                if s["match"]["relation"] == "correction" and rng.random() < 0.7 and s["state"] != "stale":
                    items.append({"sug_id": s["id"], "v": "correction"})
                else:
                    items.append({"sug_id": s["id"], "v": "new", "final": _final(s)})
            c = _conn(user)
            await W.ws_plan_ai_commit(h, c, {"id": 1, "session": sid, "rev": rev if rev is not None else st["rev"], "items": items})
            a = _ans(c)
            if isinstance(a, dict) and a.get("ok"):      # a person keeping it again, after recovery put it back on the list: their own act
                deleted.difference_update(a["piece_ids"].values())
            return a

        async def undo():
            u = A.last_batch(store)
            if not u:
                return
            if u["puts_back"]:                                 # pressing Put back asks for what it holds: their own act
                deleted.difference_update(str(i.get("target")).partition("/")[2] for i in store.data["batches"][u["id"]]["items"])
            c = _conn(user)
            await W.ws_plan_ai_undo(h, c, {"id": 1, "batch_id": u["id"]})
            return _ans(c)

        async def hand():
            # Under the store's lock, as house3d_edit is: not a stale tab (a stale tab's upsert re-creates a piece, with or without the plan AI).
            hs = await H.async_get_store(h)
            async with hs.lock:
                house = hs.data
                ours = [k for k, v in house["pieces"].items() if v.get("plan_ai")]
                if not ours:
                    return
                pid = rng.choice(ours)
                if rng.random() < 0.4:
                    new = H.apply_edit(house, {"pieces": {pid: None}})
                    if await hs.async_write(new):
                        deleted.add(pid)
                else:
                    p = house["pieces"][pid]
                    await hs.async_write(H.apply_edit(house, {"pieces": {pid: {**p, "x_m": p["x_m"] + 0.05}}}))

        async def rails():
            c = _conn(user)
            await WH.ws_house3d_edit(h, c, {"id": 1, "rails_chosen": True})

        async def status():
            c = _conn(user)
            await W.ws_plan_ai_status(h, c, {"id": 1, "session": sid})

        async def verdict():
            st = store.session(sid)
            if not st:
                return
            s = rng.choice(list(st["suggestions"].values()))
            c = _conn(user)
            await W.ws_plan_ai_verdict(h, c, {"id": 1, "session": sid, "rev": st["rev"], "sug_id": s["id"], "v": rng.choice(("later", "right", "back"))})

        async def backup():
            c = _conn(user)
            await ws_backup.ws_store_backup_create(h, c, {"id": 1, "note": "b"})
            if c.send_result.called:
                backups.append(c.send_result.call_args[0][1]["backup_id"])

        async def restore():
            if backups:
                c = _conn(user)
                msg = {"id": 1, "backup_id": rng.choice(backups)}
                if rng.random() < 0.3:
                    msg["store_keys"] = [HOUSE3D_STORE_KEY]
                await ws_backup.ws_store_backup_restore(h, c, msg)
                a_restore_ran["v"] = True

        ops = [keep, keep, keep, undo, undo, hand, rails, status, status, verdict]
        if mode == "restores":
            ops += [backup, backup, restore, restore]
        if mode == "cuts":
            cut["p"] = 0.12
        for _round in range(22):
            batch = [rng.choice(ops) for _ in range(rng.randint(1, 3))]
            # Two hand edits of one piece at once upsert over each other (house3d_edit has no revision, before and without the plan AI): one a round.
            batch = [b for i, b in enumerate(batch) if b is not hand or hand not in batch[:i]]
            results = await asyncio.gather(*[op() for op in batch], return_exceptions=True)
            if __import__("os").environ.get("SOAK_TRACE"):
                _d = _on_disk(root)["pieces"]
                print(_round, [b.__name__ for b in batch], [ {k: r.get(k) for k in ("ok","code","error","undone","of","batch","skipped") if k in r} if isinstance(r, dict) else r for r in results], "AI:", sorted(k for k, v in _d.items() if v.get("plan_ai")), "deleted:", sorted(deleted), "states:", {sg["id"][-4:]: (sg["state"], (sg.get("piece_id") or "")[-4:]) for sg in store.session(sid)["suggestions"].values() if sg["kind"]=="stairs"})
            crashed = [r for r in results if isinstance(r, Cut)]
            others = [r for r in results if isinstance(r, BaseException) and not isinstance(r, Cut)]
            # A command that was running when the power went: whatever it raised on the way down isn't a finding.
            if crashed:
                others = []
            if others:
                problems.append(("raised", repr(others[0])))
            if crashed:
                # Everything in memory is gone: Home Assistant comes back.
                cut["p"], cut["dead"] = 0.0, False
                _forget_memory(h)
                store = await A.async_get_store(h)
                house = await H.async_get_store(h)
                # Nothing settles until a plan command runs: sometimes a hand edit comes first.
                if rng.random() < 0.3:
                    await hand()
                await status()
                ledger = _on_disk(root, PLAN_AI_STORE_KEY)
                if any("pending" in b for b in ledger["batches"].values() if isinstance(b, dict)):
                    problems.append(("pending after a restart and a status", _round))
                cut["p"] = 0.12
            # After each round, quiet: the plan store and the 3D file on disk match memory.
            if crashed:
                pass
            else:
                st = await A.async_get_store(h)
                on_disk = _on_disk(root)
                mem = (await H.async_get_store(h)).data
                if on_disk["pieces"] != mem["pieces"]:
                    problems.append(("3D memory and disk differ", _round, sorted(on_disk["pieces"]), sorted(mem["pieces"]), [b.__name__ for b in batch]))
                    await _forget_and_reload()
            now = _on_disk(root)["pieces"]
            if now.get("fur_00000003") != sofa:
                problems.append(("the sofa changed", _round))
            if any("plan_ai_pending" in v for v in now.values()):
                problems.append(("a draft's note reached the file", _round))
            if mode != "restores" and deleted & set(now):
                problems.append(("a stair deleted by hand came back", _round, sorted(deleted & set(now)), [b.__name__ for b in batch]))
            # One stair where the AI saw one: never two kept within a metre by anyone but a person insisting (nobody insists here).
            ai = [v for v in now.values() if v.get("plan_ai") and v.get("label") == "Stairs (from the plan)"]
            for i, p in enumerate(ai):
                for q in ai[i + 1:]:
                    if abs(p["x_m"] - q["x_m"]) + abs(p["y_m"] - q["y_m"]) < 0.3 and mode != "restores":
                        problems.append(("two AI stairs in one place", _round, p["id"], q["id"]))
            for k, raw in fixed.items():
                if mode != "restores" and _file(root, k).read_bytes() != raw:
                    problems.append(("a file nothing here may write changed", k))
        cut["p"] = 0.0
        await status()
        # Quiet: everything the ledger calls kept and standing either is in the file or was changed by hand.
        st = await A.async_get_store(h)
        ledger = _on_disk(root, PLAN_AI_STORE_KEY)
        if any("pending" in b for b in ledger["batches"].values() if isinstance(b, dict)):
            problems.append(("pending at the end",))
        # Undo all that stands; only pieces hand-touched or orphaned stay.
        for _ in range(30):
            u = A.last_batch(st)
            if not u or u["puts_back"]:
                break
            c = _conn(user)
            await W.ws_plan_ai_undo(h, c, {"id": 1, "batch_id": u["id"]})
        house = _on_disk(root)["pieces"]
        orphans = []
        for k, v in house.items():
            if v.get("label") == "Stairs (from the plan)" and "plan_ai" in v:
                known = any(it.get("target") == f"pieces/{k}" for b in st.data["batches"].values() if isinstance(b, dict) for it in b.get("items") or [])
                if not known:
                    orphans.append(k)
        return orphans, a_restore_ran["v"]

    async def _forget_and_reload():
        _forget_memory(h)
        await A.async_get_store(h)
        await H.async_get_store(h)

    orphans, restored = asyncio.new_event_loop().run_until_complete(run())
    if orphans:
        print("ORPHANS", mode, seed, orphans, "restored" if restored else "")
    if mode != "restores":
        assert not orphans, ("AI stairs in the file with no batch to undo them", orphans)
    assert not problems, json.dumps(problems[:6], default=str)
