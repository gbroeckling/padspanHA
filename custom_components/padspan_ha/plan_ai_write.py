# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Add data via plans: the ONE writer of the 3D house from AI suggestions
(experimental, off by default; 2026-11).

commit keeps suggestions (new, correction, a railing's side and style); undo
takes a batch of them back. Each runs from ws_plan_ai.py with the 3D store's
lock and then the plan store's held, so nothing lands between its checks and
its writes. Nothing else in the plan AI touches the 3D file (test_plan_ai.py
scans for it), and nothing here touches any file but padspan_ha.house3d and
padspan_ha.plan_ai, apart from the one safety backup a session takes:
barriers, rooms, floors, scale, maps, settings and calibration are not reachable
from here (apply_edit refuses any section but the 3D file's own).

Two files can't be written at once, so a commit is written the way a database
writes one: the ledger first, marked pending, then the 3D file, then the mark
taken off. The 3D file is what decides: settle_pending, run before anything else
uses the store, finishes a batch whose write landed and takes back one whose
write didn't. A crash at any point therefore leaves a house and a ledger that
agree, and a suggestion's piece id, minted once and stored with the ledger, stays
the same however often a commit is retried.

Design: PadspanResearch/plan-ai-design-2026-11.md (4.1, 4.2, 4.3, 4.5).
"""

from __future__ import annotations

import copy
import logging
import math
import secrets
import time
from typing import Any

from homeassistant.core import HomeAssistant

from . import house3d_store as H
from . import plan_ai as A
from . import ws_house3d_photo as P
from .const import DATA_MODEL, DOMAIN, HOUSE3D_STORE_KEY
from .house3d_library import without_tokens

_LOGGER = logging.getLogger(__name__)

REV_CODE = "rev_mismatch"
PIECE_LABEL = "Stairs (from the plan)"       # setup_checks.stairs_summary counts this prefix as AI-placed
OPEN_STATES = ("queued", "later", "right", "stale")
COMMITTED = {"new": "committed_new", "correction": "committed_correction"}
RAIL_SIDES = ("both", "inner", "outer")      # a railing kept is a rail: nothing here proposes less rail
SECTIONS = ("pieces",)                       # lights (kind only) come with Stage 3
MOVED_M = 0.3                                # kept, then moved further than this before Save: the position wasn't good enough
_FINAL_PIECE = ("floor_id", "x_m", "y_m", "z_m", "rotation")
_FINAL_RECIPE = ("params", "colors", "width_m", "depth_m", "height_m")


class Refused(Exception):
    """Nothing was written. `extra`: the answer carries a list (an ok: false
    result); without it, a plain websocket error."""

    def __init__(self, code: str, message: str, extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra


def _entry(house: dict[str, Any], target: str) -> Any:
    section, _, key = str(target).partition("/")
    sec = house.get(section)
    return sec.get(key) if section in SECTIONS and isinstance(sec, dict) else None


def settle_pending(store: A.PlanAiStore, house: dict[str, Any] | None) -> bool:
    """A commit or an undo cut short between its writes (the module's note).
    Its write landed, if any item's entry is what the batch says it became or
    carries the note of this commit: the batch stands. Otherwise it never
    happened: its items go, and each suggestion is what it was, its minted
    piece id kept. `house` None (unreadable): left for next time. In memory;
    the caller saves when it returns True."""
    if house is None or not A.writable(store.data):
        return False
    batches = store.data.get("batches") or {}
    settled = False
    for bid, b in list(batches.items()):
        p = b.get("pending") if isinstance(b, dict) else None
        if not isinstance(p, dict):
            continue
        settled = True
        items = (b.get("items") or [])[int(p.get("from") or 0):]

        def landed(it: dict) -> bool:
            live = _entry(house, it.get("target"))
            if live == it.get("after"):
                return True
            note = live.get("plan_ai") if isinstance(live, dict) else None
            return isinstance(note, dict) and p.get("at") is not None and note.get("batch") == bid and note.get("at") == p["at"]

        if any(landed(it) for it in items):
            b.pop("pending", None)
            continue
        sess = store.session(b.get("session")) if b.get("session") else None
        for sug_id, was in (p.get("was") or {}).items():
            sug = ((sess or {}).get("suggestions") or {}).get(sug_id)
            if isinstance(sug, dict):
                if (sug.get("verdict") or {}).get("v") != "new" or sug.get("kind") != "stairs":
                    sug["piece_id"] = was.get("piece_id")        # only a new stair's id is its own, minted once; a correction's or a rail's is the stair it was on
                sug.update(state=was.get("state"), verdict=was.get("verdict"))
        if sess is not None:
            sess["batch"] = p.get("session_batch")
            sess["rev"] = int(sess.get("rev") or 0) + 1
        undid = batches.get(p.get("undid")) if p.get("undid") else None
        if isinstance(undid, dict):
            undid["undone_at"] = None
        del b["items"][int(p.get("from") or 0):]
        b.pop("pending", None)
        if not b["items"]:
            batches.pop(bid, None)
    return settled


async def _save(store: A.PlanAiStore) -> None:
    """A save that may fail with nothing lost: logged."""
    try:
        await store.async_save()
    except Exception as err:  # noqa: BLE001
        _LOGGER.error("PadSpan plans: the plan store couldn't be saved: %s", P._why(err))  # noqa: SLF001


async def _put_back(store: A.PlanAiStore, snap: dict[str, Any]) -> None:
    """A failed write: the store as it was, in memory and (as far as the disk
    lets) on it. A file left holding the pending batch settles by itself."""
    store.data = snap
    await _save(store)


async def _finish(store: A.PlanAiStore, batch: dict[str, Any]) -> None:
    """The 3D file holds it: the mark comes off. A failure here is no failure:
    the file still says pending, and settle_pending finds the write landed."""
    batch.pop("pending", None)
    await _save(store)


def _new_piece_id(pieces: dict[str, Any]) -> str:
    """Minted here, once, and kept with the suggestion."""
    while True:
        pid = "fur_" + secrets.token_hex(4)
        if pid not in pieces:
            return pid


def _side_source(ai_side: Any, chosen: str, shape: Any) -> str:
    """Whose side a railing kept is: the AI's, or the person's own. Left and
    right say inner and outer only on a straight flight (rail_relation)."""
    said = {"both": "both", **({"left": "inner", "right": "outer"} if shape == "straight" else {})}.get(ai_side)
    return "ai" if said == chosen else "own"


def _xy(final: Any) -> tuple[float, float] | None:
    """Where the draft's piece stands, when that is two plain numbers."""
    try:
        x, y = final["x_m"], final["y_m"]
        return (float(x), float(y)) if not isinstance(x, bool) and not isinstance(y, bool) and math.isfinite(x) and math.isfinite(y) else None
    except (KeyError, TypeError, ValueError):
        return None


def _indoor(hass: HomeAssistant) -> set[str]:
    model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    return {f["id"] for f in A.floor_order(model)}


def _final_recipe(sug_id: str, final: dict[str, Any]) -> dict[str, Any]:
    """The stair's recipe from the draft: a stair, nothing else, with only a
    recipe's own fields. Its checks are apply_edit's."""
    rec = final.get("recipe")
    if not isinstance(rec, dict) or rec.get("kind") != "stairs":
        raise Refused("invalid", f"{sug_id}: only a staircase can be kept here")
    return {"kind": "stairs", **{k: copy.deepcopy(rec[k]) for k in _FINAL_RECIPE if k in rec}}


def _new_piece(sug: dict, pid: str, final: Any, note: dict, indoor: set[str]) -> dict[str, Any]:
    """A new stair from the draft's piece (`final`, so a drag after accepting
    counts), which is all the draft decides: where it stands, its size and
    shape, the floor picked for a stacked one. Its label, its note, no device;
    no rail unless a person chose one."""
    if not isinstance(final, dict):
        raise Refused("invalid", f"{sug.get('id')}: a new stair needs the draft's piece")
    fid = A.base_floor(final.get("floor_id"))
    if fid not in indoor:
        raise Refused("invalid", f"{sug.get('id')}: that isn't an indoor floor")
    recipe = _final_recipe(str(sug.get("id")), final)
    params = recipe["params"] = dict(recipe.get("params") or {})
    if params.get("rail") not in RAIL_SIDES:
        params["rail"] = "none"
    return {"id": pid, "recipe": recipe, "origin": "build", "label": PIECE_LABEL, "floor_id": fid,
            "x_m": final.get("x_m"), "y_m": final.get("y_m"), "z_m": final.get("z_m", 0.0), "rotation": final.get("rotation", 0.0),
            "library_id": None, "submission_id": None, "entity_id": None, "entity_reg_id": None, "plan_ai": note}


def _corrected(sug: dict, live: dict, final: Any, note: dict, indoor: set[str]) -> dict[str, Any]:
    """The target as it is, with where the draft's piece stands (the AI's
    position when no final is sent) and its note. Whatever else the draft's
    piece changed goes too: it is a person's own edit of that stair. Its
    label, device and every other key stay."""
    geom = sug.get("geom") or {}
    out = copy.deepcopy(live)
    if isinstance(final, dict):
        out.update({k: final[k] for k in _FINAL_PIECE if k in final})
        fid = A.base_floor(out.get("floor_id"))
        if fid not in indoor:
            raise Refused("invalid", f"{sug.get('id')}: that isn't an indoor floor")
        out["floor_id"] = fid
        if "recipe" in final:
            out["recipe"] = {**out.get("recipe", {}), **_final_recipe(str(sug.get("id")), final)}
    else:
        out.update(x_m=geom.get("x_m"), y_m=geom.get("y_m"))
    out["plan_ai"] = note
    return out


def _with_rail(entry: dict, rail: dict) -> dict[str, Any]:
    out = copy.deepcopy(entry)
    params = dict((out.get("recipe") or {}).get("params") or {})
    params.update(rail=rail["side"], rail_style=rail["style"])
    out["recipe"] = {**out.get("recipe", {}), "params": params}
    return out


def _check_rail(sug_id: str, rail: Any) -> None:
    if not isinstance(rail, dict) or rail.get("side") not in RAIL_SIDES or rail.get("style") not in H.STAIR_RAIL_STYLES:
        raise Refused("invalid", f"{sug_id}: a railing kept has a side ({', '.join(RAIL_SIDES)}) and a style ({', '.join(H.STAIR_RAIL_STYLES)})")


def _correction_target(sug: dict, it: dict) -> tuple[str, Any]:
    """Which stair a correction moves, and how it was when the person looked:
    the one it was matched to, or one of the stairs it was named near. Never
    on a position that may be coarse (the design's held)."""
    m = sug.get("match") or {}
    if m.get("held") in ("frame", "suspect"):
        raise Refused("invalid", "This AI's picture size isn't known, so a correction isn't offered: keep it as new or mark it wrong.")
    chosen = it.get("target")
    if m.get("relation") == "correction" and m.get("target") and chosen in (None, m["target"]):
        return m["target"], m.get("target_snap")
    near = m.get("near_snaps") or {}
    if m.get("relation") == "new" and chosen in near:
        return chosen, near[chosen]
    raise Refused("invalid", f"{sug.get('id')}: that isn't a correction this suggestion offers")


async def commit(hass: HomeAssistant, store: A.PlanAiStore, house: H.House3dStore, sid: str, rev: int, items: Any) -> dict[str, Any]:
    """Keep suggestions, all of them or none. The caller holds both locks."""
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", "This plan store was saved by a newer PadSpan: update PadSpan to keep items.")
    if not H.writable(house.data):
        raise Refused("house3d_newer", H.NEWER_MESSAGE)
    if settle_pending(store, house.data):
        await _save(store)
    sess = store.session(sid)
    if sess is None:
        raise Refused("not_found", "That session isn't here any more: read the plans again.")
    if A.running(hass) is not None or sess.get("status") == "running":
        raise Refused("already_running", "A session is reading your plans: keep items when it ends.")
    if int(sess.get("rev") or 0) != rev:
        raise Refused(REV_CODE, "The session changed since you looked. Nothing was saved: it is reloaded, Save again.")
    sugs = sess.get("suggestions") or {}
    if not isinstance(items, list) or not items or not all(isinstance(i, dict) for i in items):
        raise Refused("invalid", "Nothing to keep.")
    wanted: list[tuple[dict, dict]] = []
    for it in items:
        sug = sugs.get(it.get("sug_id"))
        if not isinstance(sug, dict):
            raise Refused("not_found", "That suggestion isn't here any more.")
        if any(s["id"] == sug.get("id") for s, _ in wanted):
            raise Refused("invalid", "One suggestion can only be kept once.")
        if it.get("v") not in COMMITTED:
            raise Refused("invalid", "An item is kept as new or as a correction.")
        wanted.append((sug, it))
    done = [s["id"] for s, _ in wanted if str(s.get("state")).startswith("committed")]
    if done:
        raise Refused("already_committed", "Already kept: nothing was saved twice.", {"items": done, "rev": sess.get("rev")})
    shut = [s["id"] for s, _ in wanted if s.get("state") not in OPEN_STATES]
    if shut:
        raise Refused("not_open", "That item isn't open any more.", {"items": shut, "rev": sess.get("rev")})

    # Stairs before railings: a railing may sit on a stair this commit makes.
    wanted.sort(key=lambda t: 0 if t[0].get("kind") == "stairs" else 1)
    live_pieces = house.data.get("pieces") or {}
    stairs = {st["id"]: st for st in A.stair_pieces(house.data)}
    moved = A.plans_moved(hass, sess)
    indoor = _indoor(hass)
    changed: list[dict[str, str]] = []
    pids: dict[str, str] = {}                  # suggestion → the piece it is (or goes on), this commit
    for sug, it in wanted:
        sug_id, v, kind, m = sug["id"], it["v"], sug.get("kind"), sug.get("match") or {}
        why = None
        if kind == "stairs" and sug.get("map_id") in moved:
            why = "plan"
        elif kind == "stairs" and v == "correction":
            if sug.get("state") == "stale":
                raise Refused("not_open", "It changed since you looked: keep it as new or mark it wrong.", {"items": [sug_id], "rev": sess.get("rev")})
            target, snap = _correction_target(sug, it)
            tgt = stairs.get(target)
            why = "gone" if tgt is None else "changed" if A.target_snap(tgt) != snap else None
            pids[sug_id] = target
        elif kind == "stairs":
            final = it.get("final") if isinstance(it.get("final"), dict) else {}
            at_xy = _xy(final)
            if at_xy is None:
                raise Refused("invalid", f"{sug_id}: a new stair needs the draft's piece, where it stands")
            fid, near = A.base_floor(final.get("floor_id")), set(m.get("near") or [])
            if sug.get("state") != "stale" and any(st["floor_id"] == fid and st["id"] not in near
                                                   and math.hypot(st["x_m"] - at_xy[0], st["y_m"] - at_xy[1]) <= A.DUP_M for st in stairs.values()):
                why = "changed"                # a stair that wasn't there when it was read: two admins, two sessions
            minted = sug.get("piece_id")
            if minted and minted in live_pieces:
                raise Refused("already_committed", "Already kept: nothing was saved twice.", {"items": [sug_id], "rev": sess.get("rev")})
            pid = minted or _new_piece_id(live_pieces)
            pids[sug_id] = pid
        elif kind == "railing":
            _check_rail(sug_id, it.get("rail"))
            if sug.get("state") == "stale" or sug.get("map_id") in moved:
                why = "plan" if sug.get("map_id") in moved else "changed"
            elif m.get("target"):
                tgt = stairs.get(m["target"])
                why = "gone" if tgt is None else "changed" if A.target_snap(tgt) != m.get("target_snap") else None
                pids[sug_id] = m["target"]
            else:
                stair = sugs.get((sug.get("geom") or {}).get("stair")) or {}
                pid = pids.get(stair.get("id")) or (stair.get("piece_id") if str(stair.get("state")).startswith("committed") else None)
                if not pid:
                    raise Refused("stair_first", "Keep its stair first: there is nothing to put the railing on yet.")
                why = "gone" if pid not in live_pieces and pid not in pids.values() else None
                pids[sug_id] = pid
        else:
            raise Refused("invalid", f"{sug_id}: this version keeps only stairs and railings")
        if why:
            changed.append({"sug_id": sug_id, "why": why})
    if changed:                                # nothing written: marked stale, and the sheet reloads
        for c in changed:
            sug = sugs[c["sug_id"]]
            if sug.get("state") != "stale":
                sug["state"] = "stale"
                A._bump(hass, "plan_ai_stale")  # noqa: SLF001
        sess["rev"] = int(sess.get("rev") or 0) + 1
        await _save(store)
        raise Refused("changed_since", "Some items changed since you looked. Nothing was saved.", {"changed": changed, "rev": sess["rev"]})

    # The edit, checked in full before anything is touched.
    batch_id = sess.get("batch") if isinstance((store.data.get("batches") or {}).get(sess.get("batch")), dict) else None
    if batch_id and (store.data["batches"][batch_id].get("undone_at") or store.data["batches"][batch_id].get("undo_of")):
        batch_id = None
    batch_id = batch_id or "pb_" + secrets.token_hex(4)
    at = time.time()
    entries: dict[str, dict] = {}
    of_piece: dict[str, list[str]] = {}
    for sug, it in wanted:
        sug_id, v, kind = sug["id"], it["v"], sug.get("kind")
        pid = pids[sug_id]
        note = {"session": sid, "batch": batch_id, "kind": kind, "at": at}
        if kind == "stairs" and v == "new":
            entries[pid] = _new_piece(sug, pid, it.get("final"), note, indoor)
        elif kind == "stairs":
            entries[pid] = _corrected(sug, entries.get(pid) or live_pieces[pid], it.get("final"), note, indoor)
        else:
            base = entries.get(pid) or {**copy.deepcopy(live_pieces[pid]), "plan_ai": note}
            entries[pid] = _with_rail(base, it["rail"])
        of_piece.setdefault(pid, []).append(sug_id)
    try:
        new = H.apply_edit(house.data, {"pieces": entries})
    except H.NewerFile as err:
        raise Refused("house3d_newer", str(err)) from err
    except H.EditError as err:
        raise Refused("invalid", str(err)) from err

    # The net, once a session (auto backups are three, shared by every operation).
    if not sess.get("backup_id"):
        from .ws_backup import _auto_backup  # noqa: PLC0415
        backup_id = await _auto_backup(hass, "Before keeping items from the plans", [HOUSE3D_STORE_KEY], mark_absent=True)
        if not backup_id:
            raise Refused("backup_failed", "Could not take the safety backup. Nothing was saved.")
        sess["backup_id"] = backup_id

    # The ledger, pending; `before` from the file as it is now, under the lock.
    snap = copy.deepcopy(store.data)
    moved_far: list[dict] = []
    try:
        batches = store.data.setdefault("batches", {})
        batch = batches.get(batch_id)
        if batch is None:
            batch = batches[batch_id] = {"session": sid, "committed_at": at, "items": [], "undone_at": None, "undo_of": None, "skipped": []}
        was = {s["id"]: {k: s.get(k) for k in ("state", "verdict", "piece_id")} for s, _ in wanted}
        batch["pending"] = {"from": len(batch["items"]), "was": was, "session_batch": sess.get("batch"), "at": at}
        batch["committed_at"] = at
        by_id = {s["id"]: (s, it) for s, it in wanted}
        for pid, ids in of_piece.items():
            batch["items"].append({"sug_id": ids[0], "also": ids[1:], "kind": by_id[ids[0]][0].get("kind"), "target": f"pieces/{pid}",
                                   "before": copy.deepcopy(live_pieces.get(pid)), "after": copy.deepcopy(new["pieces"][pid])})
        for sug, it in wanted:
            sug_id, v, kind, geom = sug["id"], it["v"], sug.get("kind"), sug.get("geom") or {}
            side_source, moved_m, e = None, 0.0, new["pieces"][pids[sug_id]]
            if kind == "stairs":
                moved_m = round(math.hypot(float(e["x_m"]) - float(geom.get("x_m") or 0.0), float(e["y_m"]) - float(geom.get("y_m") or 0.0)), 3)
                if moved_m > MOVED_M:
                    moved_far.append(sug)
            else:
                side_source = _side_source(geom.get("side"), it["rail"]["side"], ((e.get("recipe") or {}).get("params") or {}).get("shape", "straight"))
            sug["state"] = COMMITTED[v]
            sug["piece_id"] = pids[sug_id]
            sug["verdict"] = {"v": v, "at": at, "final": {k: e.get(k) for k in _FINAL_PIECE} if kind == "stairs" else None,
                              "rail": {k: it["rail"][k] for k in ("side", "style")} if kind == "railing" else None,
                              "why": None, "side_source": side_source, "moved_m": moved_m}
        sess["batch"] = batch_id
        sess["rev"] = int(sess.get("rev") or 0) + 1
        store.trim()
        written = await store.async_checked_save() and await house.async_write(new)
    except Exception as err:  # noqa: BLE001 — whatever it was, nothing stays half done
        _LOGGER.error("PadSpan plans: keeping items failed: %s", P._why(err))  # noqa: SLF001
        written = False
    if not written:
        await _put_back(store, snap)
        raise Refused("save_failed", "Could not save the kept items. Nothing was changed; your items are still here: Save to try again.")
    await _finish(store, batch)

    # Counted once it stands.
    for sug, it in wanted:
        kind, v, m = sug.get("kind"), it["v"], sug.get("match") or {}
        A._bump(hass, f"plan_ai_verdict:{kind}_{v}")  # noqa: SLF001
        if kind == "stairs" and m.get("relation") == "stacked" and v == "new":
            A._bump(hass, "plan_ai_stacked:taken")  # noqa: SLF001
        if kind == "stairs" and v == "correction":
            target = pids[sug["id"]]
            A._bump(hass, "plan_ai_correction_taken:ai" if str((live_pieces.get(target) or {}).get("label") or "").startswith(A.AI_LABELS)  # noqa: SLF001
                    else "plan_ai_correction_taken:hand")
        if kind == "railing":
            A._bump(hass, f"plan_ai_rail_side:{sug['verdict']['side_source']}")  # noqa: SLF001
    for _ in moved_far:
        A._bump(hass, "plan_ai_moved_after_accept:stairs")  # noqa: SLF001
    A._bump(hass, "plan_ai_commit:done")  # noqa: SLF001
    return {"ok": True, "rev": sess["rev"], "batch": batch_id, "piece_ids": {s["id"]: pids[s["id"]] for s, _ in wanted},
            "suggestions": {s["id"]: s for s, _ in wanted}, "backup_id": sess.get("backup_id"), "undo": A.last_batch(store, sid),
            "data": without_tokens(house.data), "counts": house.counts()}


async def undo(hass: HomeAssistant, store: A.PlanAiStore, house: H.House3dStore, batch_id: str) -> dict[str, Any]:
    """Take a batch back, EditGroups style: an entry still exactly what the
    batch made it goes back to what it was (or goes, if it was new), byte for
    byte; one changed or removed since is left and reported. All in one write,
    which is a batch of its own, so it can be undone too. Nothing is resurrected:
    an entry gone from the house stays gone. The caller holds both locks."""
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", "This plan store was saved by a newer PadSpan: update PadSpan to undo.")
    if not H.writable(house.data):
        raise Refused("house3d_newer", H.NEWER_MESSAGE)
    if settle_pending(store, house.data):
        await _save(store)
    if A.running(hass) is not None:
        raise Refused("already_running", "A session is reading your plans: undo when it ends.")
    batches = store.data.get("batches") or {}
    b = batches.get(batch_id)
    if not isinstance(b, dict):
        raise Refused("not_found", "That batch isn't here any more.")
    if b.get("undone_at"):
        raise Refused("already_undone", "That was undone already.")
    new = copy.deepcopy(house.data)
    undone: list[dict] = []
    skipped: list[dict] = []
    removed: dict[str, dict] = {}
    # Newest first: a stair changed twice goes back through each state in turn.
    for it in reversed(b.get("items") or []):
        section, _, key = str(it.get("target")).partition("/")
        sec = new.get(section) if section in SECTIONS else None
        live = sec.get(key) if isinstance(sec, dict) else None
        if not isinstance(sec, dict) or live != it.get("after"):
            skipped.append({"sug_id": it.get("sug_id"), "also": it.get("also") or [], "target": it.get("target"), "why": "gone" if live is None else "changed"})
            continue
        if it.get("before") is None:
            sec.pop(key, None)
            removed[key] = live
        else:
            sec[key] = copy.deepcopy(it["before"])
        undone.append(it)
    if not undone:                             # everything changed or gone: it can never be undone now (a changed entry carries a new time), so it is spent
        b["undone_at"] = time.time()
        b["skipped"] = [s["sug_id"] for s in skipped]
        sess = store.session(b.get("session")) if b.get("session") else None
        await _save(store)
        if skipped:
            A._bump(hass, "plan_ai_undo:item_skipped", len(skipped))  # noqa: SLF001
        return {"ok": True, "undone": 0, "of": A.items_in(b.get("items")), "skipped": skipped, "batch": None,
                "rev": sess.get("rev") if sess else None, "undo": A.last_batch(store), "data": without_tokens(house.data), "counts": house.counts()}
    if removed:                                # a strip on a piece that goes stays where it was, as any delete leaves it
        H.detach_runs(new["lights"], removed)

    snap = copy.deepcopy(store.data)
    at = time.time()
    uid = "pb_" + secrets.token_hex(4)
    sess = store.session(b.get("session")) if b.get("session") else None
    sugs = (sess or {}).get("suggestions") or {}
    was: dict[str, dict] = {}
    try:
        u_items = []
        for it in undone:
            ids = [it.get("sug_id"), *(it.get("also") or [])]
            prior = {i: (sugs.get(i) or {}).get("state") for i in ids if isinstance(sugs.get(i), dict)}
            for i in prior:
                was[i] = {k: sugs[i].get(k) for k in ("state", "verdict")}
                sugs[i]["state"] = (it.get("prior") or {}).get(i) or "undone"
            u_items.append({"sug_id": it.get("sug_id"), "also": it.get("also") or [], "kind": it.get("kind"), "target": it.get("target"),
                            "before": copy.deepcopy(it.get("after")), "after": copy.deepcopy(it.get("before")), "prior": prior})
        batches[uid] = {"session": b.get("session"), "committed_at": at, "items": u_items, "undone_at": None, "undo_of": batch_id,
                        "skipped": [s["sug_id"] for s in skipped],
                        "pending": {"from": 0, "was": was, "undid": batch_id, "session_batch": (sess or {}).get("batch"), "at": None}}
        b["undone_at"] = at
        b["skipped"] = [s["sug_id"] for s in skipped]
        if sess is not None:
            sess["batch"] = None
            sess["rev"] = int(sess.get("rev") or 0) + 1
        store.trim()
        written = await store.async_checked_save() and await house.async_write(new)
    except Exception as err:  # noqa: BLE001 — whatever it was, nothing stays half done
        _LOGGER.error("PadSpan plans: the undo failed: %s", P._why(err))  # noqa: SLF001
        written = False
    if not written:
        await _put_back(store, snap)
        raise Refused("save_failed", "Could not undo. Nothing was changed.")
    await _finish(store, batches[uid])

    A._bump(hass, "plan_ai_undo:batch")  # noqa: SLF001
    if A.puts_back(batches, b):
        A._bump(hass, "plan_ai_undo:put_back")  # noqa: SLF001
    elif not b.get("undo_of"):
        for it in undone:
            for i in (it.get("sug_id"), *(it.get("also") or [])):
                A._bump(hass, f"plan_ai_undo:{(sugs.get(i) or {}).get('kind') or it.get('kind')}")  # noqa: SLF001
    if skipped:
        A._bump(hass, "plan_ai_undo:item_skipped", len(skipped))  # noqa: SLF001
    return {"ok": True, "undone": A.items_in(undone), "of": A.items_in(b.get("items")), "skipped": skipped, "batch": uid,
            "rev": sess.get("rev") if sess else None, "undo": A.last_batch(store), "suggestions": {i: sugs[i] for i in was},
            "data": without_tokens(house.data), "counts": house.counts()}
