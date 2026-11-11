# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Add data via plans: the ONE writer of the 3D house from AI suggestions
(experimental, off by default; 2026-11).

commit keeps suggestions (new, correction, a railing's side and style, a light's
kind, and never a light's position); undo
takes a batch of them back. Each runs from ws_plan_ai.py with the 3D store's
lock and then the plan store's held, so nothing lands between its checks and
its writes. Nothing else in the plan AI touches the 3D file (test_plan_ai.py
scans for it), and nothing here touches any file but padspan_ha.house3d and
padspan_ha.plan_ai, apart from the one safety backup it keeps:
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

Build from plans: line up (Stage 1b, experimental): the same one writer,
extended for the line-up's two writes and nothing else (plan-build design 3.8,
15). They and their checks are in their own section at the end of this file,
which says what they write and what they never touch.
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
from . import plan_geom as G
from . import ws_house3d_photo as P
from .const import DATA_MODEL, DOMAIN, HOUSE3D_STORE_KEY
from .house3d_library import without_tokens

_LOGGER = logging.getLogger(__name__)

REV_CODE = "rev_mismatch"
PIECE_LABEL = "Stairs (from the plan)"       # setup_checks.stairs_summary counts this prefix as AI-placed
OPEN_STATES = ("queued", "later", "right", "stale")
COMMITTED = {"new": "committed_new", "correction": "committed_correction"}
RAIL_SIDES = ("both", "inner", "outer")      # a railing kept is a rail: nothing here proposes less rail
SECTIONS = ("pieces", "lights")
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
    A commit's write landed if any item's entry is what the batch says it became
    or carries the note of this commit. An undo's landed if any entry is what it
    went back to; but a stair gone proves nothing by itself (one deleted by hand
    looks like the undo of a new stair), so that counts only while no other entry
    is still what the undo would have changed. Landed, the batch stands. Otherwise
    it never happened: its items go, and each suggestion is what it was, its minted
    piece id kept. `house` None (unreadable): left for next time. In memory; the
    caller saves when it returns True."""
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

        def holds(it: dict, key: str) -> bool:
            return it.get(key) is not None and _entry(house, it.get("target")) == it[key]

        stands = any(landed(it) for it in items)
        if p.get("at") is None:
            stands = any(holds(it, "after") for it in items) or (stands and not any(holds(it, "before") for it in items))
        if stands:
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


def _corrected(sug: dict, live: dict, final: Any, note: dict) -> dict[str, Any]:
    """The target as it is, with where the draft's piece stands (the AI's
    position when no final is sent) and its note. Nothing else comes from the
    draft, which may be older than the stair: shape, size, turn, style, colours,
    floor, label and device stay as the file has them. A person's own edit of
    those stays in the draft for the ordinary Save after this (draft.adopt)."""
    geom = sug.get("geom") or {}
    at = final if isinstance(final, dict) else {}
    out = copy.deepcopy(live)
    out.update(x_m=at.get("x_m", geom.get("x_m")), y_m=at.get("y_m", geom.get("y_m")))
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


def _light_kind(live: Any, kind: str) -> dict[str, Any]:
    """A light's entry with its kind changed: the whole entry, as a key left out
    goes (house3d_store _LIGHT_OWNED). Only what an edit may send: a newer
    PadSpan's own keys stay in the file by themselves (apply_edit)."""
    return {**{k: copy.deepcopy(v) for k, v in (live if isinstance(live, dict) else {}).items() if k in H._LIGHT_OWNED}, "kind": kind}  # noqa: SLF001


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
    live_lights = house.data.get("lights") or {}
    stairs = {st["id"]: st for st in A.stair_pieces(house.data)}
    placed = {lt["id"]: lt for lt in A.placed_lights(hass, house.data)} if any(s.get("kind") == "light" for s, _ in wanted) else {}
    moved = A.plans_moved(hass, sess)
    indoor = _indoor(hass)
    changed: list[dict[str, str]] = []
    pids: dict[str, str] = {}                  # suggestion → the piece it is (or goes on), this commit
    for sug, it in wanted:
        sug_id, v, kind, m = sug["id"], it["v"], sug.get("kind"), sug.get("match") or {}
        why = None
        if kind == "light":
            # A kind, on the light it was matched to. Never a position, so never new.
            if v != "correction" or m.get("relation") != "correction" or m.get("held") in ("frame", "suspect") or (sug.get("geom") or {}).get("symbol") not in A.SYMBOL_KIND:
                raise Refused("invalid", f"{sug_id}: a light's only change here is its kind, on the placed light it was matched to")
            if sug.get("state") == "stale":
                raise Refused("not_open", "It changed since you looked: read it again or mark it wrong.", {"items": [sug_id], "rev": sess.get("rev")})
            tgt = placed.get(m.get("target"))
            why = "plan" if sug.get("map_id") in moved else "gone" if tgt is None else "changed" if A.light_snap(tgt) != m.get("target_snap") else None
            if m.get("target") in pids.values():
                raise Refused("invalid", "One light can only be given one kind in a keep.")
            pids[sug_id] = m.get("target")
        elif kind == "stairs" and sug.get("map_id") in moved:
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
            raise Refused("invalid", f"{sug_id}: this version keeps only stairs, railings and a light's kind")
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
    if batch_id and (store.data["batches"][batch_id].get("undone_at") or A.puts_back(store.data["batches"][batch_id])):
        batch_id = None
    batch_id = batch_id or "pb_" + secrets.token_hex(4)
    at = time.time()
    entries: dict[str, dict] = {}
    light_entries: dict[str, dict] = {}
    of_piece: dict[str, list[str]] = {}
    for sug, it in wanted:
        sug_id, v, kind = sug["id"], it["v"], sug.get("kind")
        pid = pids[sug_id]
        note = {"session": sid, "batch": batch_id, "kind": kind, "at": at}
        if kind == "light":
            light_entries[pid] = _light_kind(live_lights.get(pid), A.SYMBOL_KIND[sug["geom"]["symbol"]])
            of_piece.setdefault(f"lights/{pid}", []).append(sug_id)
            continue
        if kind == "stairs" and v == "new":
            entries[pid] = _new_piece(sug, pid, it.get("final"), note, indoor)
        elif kind == "stairs":
            entries[pid] = _corrected(sug, entries.get(pid) or live_pieces[pid], it.get("final"), note)
        else:
            base = entries.get(pid) or {**copy.deepcopy(live_pieces[pid]), "plan_ai": note}
            entries[pid] = _with_rail(base, it["rail"])
        of_piece.setdefault(f"pieces/{pid}", []).append(sug_id)
    try:
        new = H.apply_edit(house.data, {k: v for k, v in (("pieces", entries), ("lights", light_entries)) if v})
    except H.NewerFile as err:
        raise Refused("house3d_newer", str(err)) from err
    except H.EditError as err:
        raise Refused("invalid", str(err)) from err

    # The net, once a session while it lasts. It holds one slot of its own, so it
    # never pushes out another operation's; a later session's takes that slot.
    from .ws_backup import _auto_backup, _backup_exists  # noqa: PLC0415
    if not sess.get("backup_id") or not await _backup_exists(hass, sess["backup_id"]):
        backup_id = await _auto_backup(hass, "Before keeping items from the plans", [HOUSE3D_STORE_KEY], mark_absent=True, slot="plan_ai", exact=True)
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
        for target, ids in of_piece.items():
            section, _, pid = target.partition("/")
            batch["items"].append({"sug_id": ids[0], "also": ids[1:], "kind": by_id[ids[0]][0].get("kind"), "target": target,
                                   "before": copy.deepcopy((house.data.get(section) or {}).get(pid)), "after": copy.deepcopy(new[section][pid])})
        for sug, it in wanted:
            sug_id, v, kind, geom = sug["id"], it["v"], sug.get("kind"), sug.get("geom") or {}
            side_source, moved_m, e = None, 0.0, new["lights" if kind == "light" else "pieces"][pids[sug_id]]
            if kind == "light":
                pass
            elif kind == "stairs":
                moved_m = round(math.hypot(float(e["x_m"]) - float(geom.get("x_m") or 0.0), float(e["y_m"]) - float(geom.get("y_m") or 0.0)), 3)
                if moved_m > MOVED_M:
                    moved_far.append(sug)
            else:
                side_source = _side_source(geom.get("side"), it["rail"]["side"], ((e.get("recipe") or {}).get("params") or {}).get("shape", "straight"))
            sug["state"] = COMMITTED[v]
            sug["piece_id"] = pids[sug_id]
            sug["verdict"] = {"v": v, "at": at, "final": {k: e.get(k) for k in _FINAL_PIECE} if kind == "stairs" else {"kind": e.get("kind")} if kind == "light" else None,
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
            if section == "pieces":
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
    puts = not A.puts_back(b)                  # stored: past the batch cap the chain it comes from is gone
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
        batches[uid] = {"session": b.get("session"), "committed_at": at, "items": u_items, "undone_at": None, "undo_of": batch_id, "puts_back": puts,
                        "skipped": [s["sug_id"] for s in skipped],
                        "pending": {"from": 0, "was": was, "undid": batch_id, "session_batch": (sess or {}).get("batch"), "at": None}}
        b["undone_at"] = at
        b["skipped"] = [s["sug_id"] for s in skipped]
        if sess is not None:
            sess["batch"] = None if puts else uid   # what a put-back kept stands: the next keep joins it, so one undo still takes it all
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
    if A.puts_back(b):
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


# ══ Build from plans: line up (Stage 1b; experimental) ═══════════════════════
# Plan-build design 3.8 and 15. The two writes are _write_place (the six numbers
# of a placement, through async_reanchor_map) and _write_refile (a floor). Both
# run only from lineup_commit, lineup_undo and settle_lineups, each with the
# plan store's lock held by its caller (ws_plan_ai.py). A ledger entry holds,
# per plan, `before` and `after` (the placement's numbers as stored, or the
# floor), and the plan's scanner and beacon pins as they were, so an undo puts
# the very pins back when nothing moved them since; calibration pins are
# re-derived from their unchanged metres, never copied (design 3.8).
#
# What it writes: a plan's placement through ModelStore.async_reanchor_map, the
# Align editor's own commit (its calibration preflight; the picture positions of
# the plan's calibration points, scanners and beacons re-derived from their
# unchanged metres, never Save Scale); a refile of a plan with nothing drawn on
# it, its floor in the maps store and in its placement record
# (ModelStore.async_set_map_floor, origin_anchored kept). What it never writes:
# calibration metres, room outlines, device metres, the measured plan, the
# house's metre scale (test_plan_build_write.py scans for it). A backup before
# each save and each undo in the line-up's own slot (the last six kept); the
# ledger in the plan store's "lineup_batches", pending until the writes land;
# settle_lineups finishes a save cut short or puts it back.

from .const import CALIBRATION_STORE_KEY, DATA_CALIBRATION, DATA_MAPS, MAPS_STORE_KEY, MODEL_STORE_KEY  # noqa: E402

LINEUP_ACCEPT: tuple[str, ...] = ("open", "not_now", "undone")   # not_now: the anchor's own scale waits there; undone: applied again
LINEUP_SLOT = "plan_build"                                        # the backups' own slot (ws_backup._auto_backup, the last A.S1_BACKUPS_KEPT)
LP = "Line up plans (experimental): "
_PIN_LISTS = ("receivers", "beacons")                             # what async_rederive_map_fracs re-derives on a map record


def _house_stores(hass: HomeAssistant) -> tuple[Any, Any, Any]:
    dom = hass.data.get(DOMAIN, {})
    return dom.get(DATA_MODEL), dom.get(DATA_MAPS), dom.get(DATA_CALIBRATION)


def _pins(m: dict | None) -> dict[str, Any]:
    return {k: copy.deepcopy((m or {}).get(k) or []) for k in _PIN_LISTS}


def _live(hass: HomeAssistant, map_id: str) -> dict[str, Any] | None:
    """A plan as it is: its placement's numbers, its floor and its pins.
    None: gone or not placed."""
    mdl, ms, _cal = _house_stores(hass)
    m = ms.get_map(map_id) if ms is not None else None
    t = mdl.map_transform(map_id) if mdl is not None else None
    if not isinstance(m, dict) or not isinstance(t, dict):
        return None
    return {"t": A.placement_of(t), "floor_id": str(m.get("floor_id") or ""), "pins": _pins(m)}


def _at(live: dict | None, side: Any, kind: str) -> bool:
    """Is the plan at this side of a ledger entry (its before or its after)?"""
    if live is None or not isinstance(side, dict):
        return False
    if kind == "refile":
        return live["floor_id"] == side.get("floor_id")
    return live["t"] is not None and live["t"] == A.placement_of(side.get("t"))


async def _write_place(hass: HomeAssistant, map_id: str, to_t: dict[str, Any], pins: dict[str, Any] | None = None) -> str | None:
    """THE placement write: the six numbers through ModelStore.async_reanchor_map,
    exactly as the Align editor's Save sends them (ws_fabric_map_reanchor): its
    calibration preflight refuses, writing nothing, when most of the plan's
    calibration pins would fall off the picture; the pins' picture positions
    re-derive from their stored metres, and the map record is saved when they
    did. A lean is stated when the target has one or the plan has one now (an
    absent lean is 0.0). `pins`: the scanner and beacon pins put back exactly
    (an undo of a save nothing has moved since). None, or why it failed."""
    mdl, ms, cal = _house_stores(hass)
    m = ms.get_map(map_id) if ms is not None else None
    if mdl is None or m is None:
        return "gone"
    live = mdl.map_transform(map_id) or {}
    kw = {k: float(to_t[k]) for k in ("origin_x_m", "origin_y_m", "rotation_rad", "scale_x_m", "scale_y_m")}
    if "shear_rad" in to_t or abs(float(live.get("shear_rad") or 0.0)) > 0:
        kw["shear_rad"] = float(to_t.get("shear_rad") or 0.0)
    res = await mdl.async_reanchor_map(map_id, m, cal, **kw)
    if not res.get("ok"):
        return str(res.get("error") or "reanchor_failed")
    if pins is not None:
        for k, v in pins.items():
            m[k] = copy.deepcopy(v)
    if res.get("map_items_rederived") or pins is not None:
        await ms.store.async_save(ms.data)
    return None


def _storey(hass: HomeAssistant, floor_id: str, map_id: str) -> tuple[int | None, float | None]:
    """The stack level and storey height a map filed on this floor should
    carry, as Mapping → 3D Stack's floor select gives them: the level the
    floor's other maps share, else Home Assistant's level for the floor; the
    height the other maps share. The readers take a floor's storey from its
    maps' stack (traceback.js, radio_map.js, calibration.js, the 3D Stack
    slabs). None: nothing to go on, the map's own is kept."""
    mdl, ms, _cal = _house_stores(hass)
    others = [m.get("stack") or {} for m in (ms.list_maps() if ms is not None else [])
              if str(m.get("floor_id") or "") == floor_id and m.get("id") != map_id]
    levels = {s["z_level"] for s in others if isinstance(s.get("z_level"), int)}
    heights = {s["ceiling_height_m"] for s in others if isinstance(s.get("ceiling_height_m"), (int, float))}
    ha = next((f.get("level") for f in (mdl.floors() if mdl is not None else []) if f.get("id") == floor_id), None)
    level = next(iter(levels)) if len(levels) == 1 else ha if isinstance(ha, int) else None
    return (None if level is None else max(0, min(20, int(level)))), (next(iter(heights)) if len(heights) == 1 else None)


async def _write_refile(hass: HomeAssistant, map_id: str, side: dict[str, Any], record: bool = True) -> str | None:
    """THE refile write: the map's floor and its storey in the stack (level
    and height), in one maps_store.async_update_map (with the legacy stack
    copy of the floor when the map has one, which radio_map.js still reads
    first), and the placement record's floor (ModelStore.async_set_map_floor,
    the whole record kept). The placement stays: floors share one footprint.
    `record` False: a plan with no placement record (the rooms helper's scale
    undo, after the record went), the maps store's floor only."""
    mdl, ms, _cal = _house_stores(hass)
    if mdl is None or ms is None or ms.get_map(map_id) is None:
        return "gone"
    stack = {k: side[s] for k, s in (("floor_id", "stack_floor"), ("z_level", "stack_level"), ("ceiling_height_m", "stack_height"))
             if side.get(s) is not None}
    extra = {"stack": stack} if stack else {}
    await ms.async_update_map(map_id, floor_id=side["floor_id"], **extra)
    if record and not await mdl.async_set_map_floor(map_id, side.get("t_floor") or side["floor_id"]):
        return "not_placed"
    return None


def _refile_whole(hass: HomeAssistant, e: dict[str, Any]) -> bool:
    """A refile at its `after` in every copy: the placement record's floor
    (presence_coordinator reads it to pick the map a position is drawn on)
    and the stack's, not only the maps record's that _at compares."""
    mdl, ms, _cal = _house_stores(hass)
    m, t, a = (ms.get_map(e["map_id"]) if ms is not None else None) or {}, (mdl.map_transform(e["map_id"]) if mdl is not None else None) or {}, e["after"]
    stk = m.get("stack") or {}
    return (t.get("floor_id") == (a.get("t_floor") or a["floor_id"])
            and all(a.get(s) is None or stk.get(k) == a[s] for k, s in (("floor_id", "stack_floor"), ("z_level", "stack_level"),
                                                                       ("ceiling_height_m", "stack_height"))))


async def _write_side(hass: HomeAssistant, e: dict[str, Any], side: str, pins: dict[str, Any] | None = None,
                      from_side: str | None = None) -> str | None:
    """One ledger entry taken to its before or its after; never raises.
    `from_side`: written only while the plan is still at that side of the
    entry, else "changed" and nothing written (the Align editor, 3D Stack or
    the Rooms tab don't take the plan store's lock, so a hand save can land
    between the checks and the writes: it is never written over). A save's
    entry from its before also needs the anchor its placement was composed
    on where it was ("changed"), and a refile a plan with nothing drawn on
    it ("refile_refused"), read fresh (review B7)."""
    if from_side is not None and not _at(_live(hass, e["map_id"]), e[from_side], e.get("kind")):
        return "changed"
    if from_side == "before" and isinstance(e.get("anchor"), dict):
        live = _live(hass, e["anchor"]["map_id"])
        if live is None or live["t"] != A.placement_of(e["anchor"]["t"]):
            return "changed"
    if from_side == "before" and e.get("empty"):
        drawn = (A.house_snapshot(hass)["plans"].get(e["map_id"]) or {}).get("drawn")
        if drawn is None or A.drawn_total(drawn):
            return "refile_refused"
    try:
        if e.get("kind") == "refile":
            return await _write_refile(hass, e["map_id"], e[side])
        return await _write_place(hass, e["map_id"], e[side]["t"], pins)
    except Exception as err:  # noqa: BLE001 — a write that throws is a write that failed
        _LOGGER.error("PadSpan plan line-up: a write failed: %s", P._why(err))  # noqa: SLF001
        return "error"


async def _rederive(hass: HomeAssistant, map_ids: set[str]) -> None:
    """The re-derivations reanchor makes, made again (both repeat safely): a
    save cut short between the placement and the calibration or map files."""
    mdl, ms, cal = _house_stores(hass)
    for mid in sorted(map_ids):
        try:
            m = ms.get_map(mid) if ms is not None else None
            if cal is not None and hasattr(cal, "async_remap_from_metres"):
                await cal.async_remap_from_metres(mid)
            if mdl is not None and m is not None and await mdl.async_rederive_map_fracs(mid, m):
                await ms.store.async_save(ms.data)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("PadSpan plan line-up: re-deriving a plan's pins failed: %s", P._why(err))  # noqa: SLF001


def _stop(hass: HomeAssistant, store: A.PlanAiStore, sess: dict | None, reason: str, map_id: str | None = None) -> None:
    """A stop of the writes: named, counted, kept on the session (design 14)."""
    A.note_stop(hass, store.data, sess, reason, map_id)
    if sess is not None:
        sess["rev"] = int(sess.get("rev") or 0) + 1


def _floor_name(snap: dict, fid: Any) -> str:
    return next((str(f.get("name") or f["id"]) for f in snap["floors"] if f["id"] == fid), str(fid or "this floor"))


def _preflight(snap: dict, map_id: str, new_t: dict) -> tuple[int, int]:
    """async_reanchor_map's calibration test, run in memory on the proposal
    before anything is written (design 3.8.1): (points on the plan, of them
    off its picture), through the reanchor's own metres-to-picture rule
    (ModelStore.metres_to_map_frac) on the proposed placement. The reanchor
    runs it again at the write."""
    from types import SimpleNamespace  # noqa: PLC0415
    from .model_store import ModelStore  # noqa: PLC0415
    proposed = SimpleNamespace(data={"map_transforms": {map_id: new_t}})
    owned = bad = 0
    for p in snap["calibration"]:
        if p.get("map_id") != map_id or p.get("x_m") is None:
            continue
        try:
            fr = ModelStore.metres_to_map_frac(proposed, float(p["x_m"]), float(p["y_m"]), map_id)
        except (TypeError, ValueError, KeyError):
            continue
        owned += 1
        if not fr or not (-0.05 <= fr[0] <= 1.05 and -0.05 <= fr[1] <= 1.05):
            bad += 1
    return owned, bad


def _ledger_entry(hass: HomeAssistant, iid: str, it: dict[str, Any]) -> dict[str, Any]:
    """An item's before and after as the stores hold them now, under the lock."""
    mdl, ms, cal = _house_stores(hass)
    mid = it["map_id"]
    m, t = ms.get_map(mid), mdl.map_transform(mid) or {}
    stk = m.get("stack") or {}
    before: dict[str, Any] = {"t": {k: t[k] for k in G.FIELDS if k in t}, "floor_id": str(m.get("floor_id") or ""),
                              "t_floor": t.get("floor_id"), "stack_floor": stk.get("floor_id"),
                              "stack_level": stk.get("z_level"), "stack_height": stk.get("ceiling_height_m")}
    if it["kind"] == "refile":
        to = it["proposal"]["to_floor_id"]
        level, height = _storey(hass, to, mid)
        after = {"t": dict(before["t"]), "floor_id": to, "t_floor": to, "stack_floor": to if before["stack_floor"] else None,
                 "stack_level": before["stack_level"] if level is None else level, "stack_height": before["stack_height"] if height is None else height}
    else:
        after = {"t": {k: it["proposal"][k] for k in G.FIELDS if k in it["proposal"]}, "floor_id": before["floor_id"],
                 "t_floor": before["t_floor"], "stack_floor": before["stack_floor"]}
    points = [p for p in ((cal.data.get("points") or []) if cal is not None and isinstance(getattr(cal, "data", None), dict) else [])
              if isinstance(p, dict) and p.get("map_id") == mid]
    entry = {"item_id": iid, "kind": it["kind"], "map_id": mid, "name": it.get("name") or "", "before": before, "after": after,
             "pins_before": _pins(m), "cal_before": {str(p.get("id")): [p.get("x_frac"), p.get("y_frac")] for p in points}}
    anchor = (it.get("evidence") or {}).get("anchor")
    if it["kind"] == "place" and anchor and isinstance(it.get("anchor_now"), dict):
        entry["anchor"] = {"map_id": anchor, "t": it["anchor_now"]}      # checked again at its write (_write_side, review B7)
    if it["kind"] == "refile":
        entry["empty"] = True                                            # a refile only of a plan with nothing drawn on it, at its write too
    return entry


def _fitted_to(hass: HomeAssistant, store: A.PlanAiStore, anchor_id: str) -> list[str]:
    """The saved placements, not undone, that were fitted to this plan and
    still sit where their save put them: composed on the anchor's placement,
    they would come off their drawings if its scale changed under them."""
    out: list[str] = []
    for b in (store.data.get("lineup_batches") or {}).values():
        if not isinstance(b, dict) or b.get("undo_of") or b.get("undone_at") or b.get("pending"):
            continue
        items = (store.lineup(b.get("session")) or {}).get("items") or {}
        for e in b.get("items") or []:
            it = items.get(e.get("item_id")) or {}
            if e.get("kind") == "place" and (it.get("evidence") or {}).get("anchor") == anchor_id and _at(_live(hass, e["map_id"]), e["after"], "place"):
                out.append(e.get("name") or e["map_id"])
    return out


def _resign(hass: HomeAssistant, store: A.PlanAiStore, b: dict[str, Any]) -> None:
    """The batch's plans as its own writes left them, signed again on its
    session (review B1): a save or an undo moves a plan's placement (a refile
    its floor), and the session's guard and Resume must not take the
    line-up's own write for a plan moved in Mapping. Only a plan still where
    the batch put it: a hand move since stays a change. The reads are in the
    picture's own pixels, so the line-up's own move doesn't make them stale."""
    sess = store.lineup(b.get("session"))
    if sess is None:
        return
    landed = {e["map_id"] for e in b.get("items") or [] if _at(_live(hass, e["map_id"]), e["after"], e["kind"])}
    for pl in sess.get("plans") or []:
        now = A.plan_now(hass, pl["map_id"]) if pl.get("map_id") in landed else None
        if now is not None:
            pl["place_sig"], pl["floor_id"] = now["place_sig"], now["floor_id"]


def _landed(hass: HomeAssistant, store: A.PlanAiStore, bid: str, b: dict[str, Any], at: float) -> None:
    """A batch whose writes all landed: its items say so (a commit's committed,
    an undo's undone, and the saves it undid spent), and its plans are signed
    again on the session."""
    _resign(hass, store, b)
    sess = store.lineup(b.get("session"))
    items = (sess or {}).get("items") or {}
    for e in b.get("items") or []:
        it = items.get(e["item_id"])
        if isinstance(it, dict):
            it["state"] = "undone" if b.get("undo_of") else "committed"
    for of in b.get("undo_of") or []:
        ob = (store.data.get("lineup_batches") or {}).get(of)
        if isinstance(ob, dict):
            ob["undone_at"] = at
    if sess is not None:
        if not b.get("undo_of") and bid not in (sess.get("batches") or []):
            sess.setdefault("batches", []).append(bid)
        sess["rev"] = int(sess.get("rev") or 0) + 1


async def settle_lineups(hass: HomeAssistant, store: A.PlanAiStore) -> bool:
    """A line-up save or undo cut short (a restart, a crash) between its
    writes: run before any line-up command. The house decides. Every plan at
    its `after`: the batch stands; the mark comes off, and the re-derivations
    are made again in case the cut fell between the placement and the pin
    files. Otherwise it never happened: each plan at its `after` is put back
    to its `before` (its pins exactly), and the batch goes. A put-back that
    can't be written (the reanchor's preflight refuses the old placement, say)
    is settled once, never retried: the plans it couldn't put back stand as
    saved, the batch keeps only them, Undo takes them back, and the session
    says so by a named stop. In memory; the caller saves when it returns True."""
    if not A.writable(store.data):
        return False
    batches = store.data.get("lineup_batches") or {}
    settled = False
    for bid, b in list(batches.items()):
        p = b.get("pending") if isinstance(b, dict) else None
        if not isinstance(p, dict):
            continue
        settled = True
        entries = b.get("items") or []
        lives = [_live(hass, e["map_id"]) for e in entries]
        if entries and all(_at(lv, e["after"], e["kind"]) for lv, e in zip(lives, entries)):
            for e in entries:                          # a refile cut between its writes: the placement record's floor too (presence reads it)
                if e["kind"] == "refile" and not _refile_whole(hass, e):
                    await _write_side(hass, e, "after")
            b.pop("pending", None)
            await _rederive(hass, {e["map_id"] for e in entries if e["kind"] != "refile"})
            _landed(hass, store, bid, b, float(p.get("at") or time.time()))
            A._bump(hass, "plan_build_settled:finished")  # noqa: SLF001
            continue
        kept = True
        for lv, e in zip(reversed(lives), reversed(entries)):
            if _at(lv, e["after"], e["kind"]) and not _at(lv, e["before"], e["kind"]):
                pins = e.get("pins_before") if e["kind"] != "refile" else None     # the pins as they were when this batch began
                if await _write_side(hass, e, "before", pins):
                    kept = False
        if kept:
            batches.pop(bid, None)
            _invalidate(hass)
            A._bump(hass, "plan_build_settled:put_back")  # noqa: SLF001
            continue
        _stood(hass, store, bid, b, float(p.get("at") or time.time()))
    return settled


def _stood(hass: HomeAssistant, store: A.PlanAiStore, bid: str, b: dict[str, Any], at: float) -> None:
    """A batch cut short whose put-back couldn't be written: it stands for
    the plans still at its `after` (the others are back at `before`), its
    mark off, and it is said once (save_stands or undo_stands). A save that
    stands is undone like any other; an undo that stands leaves the rest of
    the saves it was undoing to the next Undo."""
    batches = store.data.get("lineup_batches") or {}
    stand = [e for e in b.get("items") or [] if _at(_live(hass, e["map_id"]), e["after"], e["kind"])]
    if not stand:                                      # nothing of it is left in the house after all: it never happened
        batches.pop(bid, None)
        _invalidate(hass)
        A._bump(hass, "plan_build_settled:put_back")  # noqa: SLF001
        return
    b["items"] = stand
    b.pop("pending", None)
    b["stood"] = True
    sess = store.lineup(b.get("session"))
    if not b.get("undo_of"):
        _landed(hass, store, bid, b, at)
    else:
        covered = {(e.get("of"), e["item_id"]) for e in stand}
        for of in b["undo_of"]:
            ob = batches.get(of)
            if isinstance(ob, dict):                   # what this undo reached is taken out of the save; the rest stays to undo
                ob["items"] = [e for e in ob.get("items") or [] if (of, e["item_id"]) not in covered]
                if not ob["items"]:
                    ob["undone_at"] = at
        _resign(hass, store, b)
        items = (sess or {}).get("items") or {}
        for e in stand:
            if isinstance(items.get(e["item_id"]), dict):
                items[e["item_id"]]["state"] = "undone"
    _stop(hass, store, sess, "undo_stands" if b.get("undo_of") else "save_stands")
    _invalidate(hass)
    _LOGGER.warning("PadSpan plan line-up (experimental): a %s cut short couldn't be put back; %d plan(s) stand as it left them",
                    "undo" if b.get("undo_of") else "save", len(stand))
    A._bump(hass, "plan_build_settled:stood")  # noqa: SLF001


async def _backup(hass: HomeAssistant, note: str, slot: str = LINEUP_SLOT) -> str | None:
    from .ws_backup import _auto_backup  # noqa: PLC0415
    return await _auto_backup(hass, note, [MODEL_STORE_KEY, MAPS_STORE_KEY, CALIBRATION_STORE_KEY], slot=slot, slot_keep=A.S1_BACKUPS_KEPT)


def _invalidate(hass: HomeAssistant) -> None:
    try:
        from .ws_common import _invalidate_snapshot_cache  # noqa: PLC0415
        _invalidate_snapshot_cache(hass)
    except Exception:  # noqa: BLE001
        pass


async def lineup_commit(hass: HomeAssistant, store: A.PlanAiStore, sid: str, rev: int, item_ids: Any, group: bool = False) -> dict[str, Any]:
    """Save accepted line-up items: one at a time, or a group of items that
    shift nothing drawn on their plans (form q8). Everything is checked
    before anything is written (design 3.8.1); then a backup (refused without
    one), the ledger pending, the writes one plan at a time (a failure puts
    back the plans already written), the mark off. The caller holds the store's lock."""
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", LP + "this plan store was saved by a newer PadSpan: update PadSpan to save.")
    if await settle_lineups(hass, store):
        await _save(store)
    sess = store.lineup(sid)
    if sess is None:
        raise Refused("not_found", LP + "that session isn't here any more: line the floor up again.")
    if A.running(hass) is not None or sess.get("status") == "running":
        raise Refused("already_running", LP + "a session is reading your plans: save when it ends.")
    if int(sess.get("rev") or 0) != rev:
        raise Refused(REV_CODE, LP + "the session changed since you looked. Nothing was saved: it is reloaded, try again.")
    ids = list(item_ids) if isinstance(item_ids, list) else []
    if not ids or len(set(ids)) != len(ids) or not all(isinstance(i, str) for i in ids):
        raise Refused("invalid", LP + "nothing to save.")
    if not group and len(ids) != 1:
        raise Refused("invalid", LP + "items are accepted one at a time; only items that shift nothing drawn on a plan go as a group.")
    items = sess.get("items") or {}
    wanted = [(iid, items.get(iid)) for iid in ids]
    if any(not isinstance(it, dict) for _, it in wanted):
        raise Refused("not_found", LP + "that item isn't here any more.")
    shut = [iid for iid, it in wanted if it.get("state") not in LINEUP_ACCEPT or it.get("kind") not in A.ITEM_KINDS]
    if shut:
        raise Refused("not_open", LP + "that item can't be accepted now.", {"items": shut, "rev": sess.get("rev")})

    snap = A.house_snapshot(hass)

    async def refuse(code: str, message: str, stop: str | None, mid: str | None, counter: str, extra: dict | None = None) -> None:
        """Nothing written: the stop named and counted, the session's rev moved on, the refusal said."""
        if stop:
            _stop(hass, store, sess, stop, mid)
        else:
            sess["rev"] = int(sess.get("rev") or 0) + 1
        A._bump(hass, f"plan_build_commit:{counter}")  # noqa: SLF001
        await _save(store)
        raise Refused(code, message, {**(extra or {}), "rev": sess.get("rev")})

    flags_now: dict[str, list] = {}

    async def recheck(snap: dict, during: bool) -> None:
        """Each item against the house as it is: its plan, picture, placement,
        floor, anchor and flags, a refile's plan still clean. `during`: again
        after the backup, which leaves the event loop free for the Align
        editor's own save; a change then is its own named stop (design 14)."""
        changed: list[dict[str, str]] = []
        for iid, it in wanted:
            why = A.item_now(snap, sess, it)
            if why is None and it["kind"] != "refile":
                flags_now[iid], _others = A.effects(snap, it["map_id"], it["proposal"])
                seen = {(f["what"], f["id"]) for f in it.get("flags") or []}
                if any((f["what"], f["id"]) not in seen for f in flags_now[iid]):
                    why = "new_flag"                       # something drawn on the plan since the person looked
            if why:
                changed.append({"item_id": iid, "why": why})
        if changed:
            for c in changed:
                it = items[c["item_id"]]
                if it.get("state") != "stale":
                    it["state"] = "stale"
                    A._bump(hass, f"plan_build_item:{it['kind']}_stale")  # noqa: SLF001
            gone = next((c for c in changed if c["why"] == "floor_gone"), None)
            if gone:
                await refuse("floor_gone", LP + " ".join(A.STOPS["floor_gone"]), "floor_gone", items[gone["item_id"]]["map_id"], "changed_since",
                             {"changed": changed})
            if during:
                await refuse("changed_since", LP + " ".join(A.STOPS["changed_while_saving"]), "changed_while_saving", None, "changed_since",
                             {"changed": changed})
            await refuse("changed_since", LP + "the plan changed since you looked (moved, a new picture, or something drawn on it). "
                         "Nothing was saved: line the floor up again.", None, None, "changed_since", {"changed": changed})
        for iid, it in wanted:
            if it["kind"] == "refile" and A.drawn_total(snap["plans"][it["map_id"]]["drawn"]):
                it["state"] = "refused"
                await refuse("refile_refused", LP + " ".join(A.STOPS["refile_refused"]), "refile_refused", it["map_id"], "refile_refused", {"items": [iid]})

    # 1. Check everything; write nothing if any check fails.
    for iid, it in wanted:
        if it["map_id"] == snap["gauge_map"]:
            await refuse("measured_plan_protected", LP + " ".join(A.STOPS["measured_plan_protected"]), "measured_plan_protected", it["map_id"],
                         "measured_plan_protected", {"items": [iid]})
    await recheck(snap, False)
    if group:
        shifting = [iid for iid, it in wanted if it.get("flags") or flags_now.get(iid)]
        if shifting:
            await refuse("group_refused", LP + " ".join(A.STOPS["group_refused"]), "group_refused", None, "group_refused", {"items": shifting})
    scaled = {it["map_id"] for _, it in wanted if it["kind"] == "anchor_scale"}
    if any(it["kind"] == "place" and (it.get("evidence") or {}).get("anchor") in scaled for _, it in wanted):
        raise Refused("invalid", LP + "save the anchor's own scale on its own: the plans fitted to it are lined up again after.", {"rev": sess.get("rev")})
    for iid, it in wanted:                             # a saved plan fitted to this one would be left off its drawing (review S4, B6)
        fitted = _fitted_to(hass, store, it["map_id"]) if it["kind"] in ("anchor_scale", "place") else []
        if fitted:
            await refuse("anchor_after_fit", LP + f"{', '.join(fitted)} {'is' if len(fitted) == 1 else 'are'} saved lined up to this plan as it is. "
                         + " ".join(A.STOPS["anchor_after_fit"]), "anchor_after_fit", it["map_id"], "anchor_after_fit", {"items": [iid]})
    for iid, it in wanted:
        if it["kind"] == "refile":
            continue
        owned, bad = _preflight(snap, it["map_id"], it["proposal"])
        A._bump(hass, "plan_build_preflight:checked")  # noqa: SLF001
        if owned and bad * 2 > owned:
            A._bump(hass, "plan_build_preflight:blocked")  # noqa: SLF001
            it["refused"] = {"why": "points_out_of_range", "owned": owned, "off": bad}
            await refuse("points_out_of_range", LP + f"{bad} of {owned} calibration points on {it.get('name') or 'this plan'} would fall off its picture, "
                         "so nothing was saved. " + A.STOPS["preflight_blocked"][1], "preflight_blocked", it["map_id"], "points_out_of_range",
                         {"items": [iid]})

    # 2. The backup, before each save, in its own slot.
    backup_id = await _backup(hass, f"Before plan line-up (experimental): {_floor_name(snap, sess.get('floor_id'))}")
    if not backup_id:
        await refuse("backup_failed", LP + " ".join(A.STOPS["backup_failed"]), "backup_failed", None, "backup_failed")
    # The backup awaited: a hand save may have landed meanwhile. The checks again, on the house as it is now.
    await recheck(A.house_snapshot(hass), True)

    # 3. The ledger, pending, from the stores as they are now (under the lock).
    snap_store = copy.deepcopy(store.data)
    at = time.time()
    bid = "lb_" + secrets.token_hex(4)
    entries = [_ledger_entry(hass, iid, it) for iid, it in wanted]
    batch = {"session": sid, "floor_id": sess.get("floor_id"), "committed_at": at, "backup_id": backup_id, "group": bool(group),
             "items": entries, "undone_at": None, "undo_of": None, "pending": {"at": at}}
    store.data.setdefault("lineup_batches", {})[bid] = batch
    store.trim()
    if not await store.async_checked_save():
        await _put_back(store, snap_store)
        sess = store.lineup(sid) or sess
        await refuse("save_failed", LP + "couldn't save the line-up's record, so nothing was changed. Try again.", None, None, "save_failed")

    # 4. The writes, one plan at a time.
    done: list[dict] = []
    failed: str | None = None
    for e in entries:
        failed = await _write_side(hass, e, "after", from_side="before")     # still where the ledger found it, or not written
        if failed:
            break
        e["pins_after"] = _pins(_house_stores(hass)[1].get_map(e["map_id"]))
        done.append(e)
    if failed:
        put_back = True
        for e in reversed(done):                       # only a plan still as this save left it: a hand save since stands
            if await _write_side(hass, e, "before", e.get("pins_before") if e["kind"] != "refile" else None, from_side="after") not in (None, "changed"):
                put_back = False
        if put_back:
            await _put_back(store, snap_store)         # the batch never happened
        else:
            await _save(store)                         # left pending: settle_lineups puts it back next time
        if done:
            A._bump(hass, "plan_build_commit:rolled_back")  # noqa: SLF001
        _invalidate(hass)
        sess = store.lineup(sid) or sess
        if failed == "points_out_of_range":
            A._bump(hass, "plan_build_preflight:blocked")  # noqa: SLF001
        if failed == "changed":
            await refuse("changed_since", LP + " ".join(A.STOPS["changed_while_saving"]), "changed_while_saving", None, "changed_since")
        if failed == "refile_refused":                 # something was drawn on the plan since the last check
            ((sess.get("items") or {}).get(e["item_id"]) or {})["state"] = "refused"      # the session as put back
            await refuse("refile_refused", LP + " ".join(A.STOPS["refile_refused"]), "refile_refused", e["map_id"], "refile_refused",
                         {"items": [e["item_id"]]})
        await refuse("save_failed", LP + ("couldn't write the line-up, so what was written is put back: nothing was changed. " if put_back else
                                          "couldn't write the line-up; what was written is put back the next time Line up plans opens. ")
                     + "Try again; check Home Assistant's storage.", "preflight_blocked" if failed == "points_out_of_range" else None, None, "save_failed")

    # 5. The mark off; what was saved is said and counted.
    batch.pop("pending", None)
    for iid, it in wanted:
        it["state"] = "committed"
        it["verdict"] = {"v": "accepted", "group": bool(group), "at": at, "batch": bid, "why": None, "was": (it.get("verdict") or {}).get("was")}
        it.pop("refused", None)
    sess.setdefault("batches", []).append(bid)
    _resign(hass, store, batch)
    sess["rev"] = int(sess.get("rev") or 0) + 1
    await _save(store)
    _invalidate(hass)
    _LOGGER.info("PadSpan plan line-up (experimental): saved %d item(s) of session %s (backup %s)", len(entries), sid, backup_id)
    for iid, it in wanted:
        A._bump(hass, f"plan_build_item:{it['kind']}_{'accepted_group' if group else 'accepted'}")  # noqa: SLF001
        if it["kind"] == "refile":
            A._bump(hass, "plan_build_refile:accepted")  # noqa: SLF001
        elif it.get("max_move_m") is not None:
            A._bump(hass, f"plan_build_move:accepted_{A._band_m(float(it['max_move_m']))}")  # noqa: SLF001
            A._bump(hass, f"plan_build_scale_change:accepted_{A._scale_band(float(it.get('scale_change') or 0) * 100)}")  # noqa: SLF001
    A._bump(hass, "plan_build_commit:done")  # noqa: SLF001
    return {"ok": True, "rev": sess["rev"], "batch": bid, "backup_id": backup_id, "items": {iid: items[iid] for iid in ids},
            "undo": A.lineup_undo_info(store, sid)}


async def lineup_undo(hass: HomeAssistant, store: A.PlanAiStore, sid: str) -> dict[str, Any]:
    """Undo a whole line-up session: every save of it, newest first. A plan
    still exactly as a save left it goes back to what it was (its placement or
    floor through the same writes, its scanner and beacon pins exactly when
    nothing moved them since, its calibration pins re-derived from their
    unchanged metres); one moved since by hand is left and said. Allowed
    whatever the AI Task (form q3). Backed up first, and a batch of its own in
    the ledger. The caller holds the store's lock."""
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", LP + "this plan store was saved by a newer PadSpan: update PadSpan to undo.")
    if await settle_lineups(hass, store):
        await _save(store)
    if A.running(hass) is not None:
        raise Refused("already_running", LP + "a session is reading your plans: undo when it ends.")
    sess = store.lineup(sid)
    batches = store.data.setdefault("lineup_batches", {})
    mine = sorted(((bid, b) for bid, b in batches.items() if isinstance(b, dict) and b.get("session") == sid and not b.get("undo_of")
                   and not b.get("undone_at") and not b.get("pending")), key=lambda t: float(t[1].get("committed_at") or 0), reverse=True)
    if not mine:
        raise Refused("nothing_to_undo", LP + "nothing of this session is left to undo.")
    todo: list[tuple[str, dict, dict | None]] = []
    skipped: list[dict] = []
    for bid, b in mine:
        for e in reversed(b.get("items") or []):
            lv = _live(hass, e["map_id"])
            if _at(lv, e["after"], e["kind"]):
                todo.append((bid, e, lv))
            else:
                skipped.append({"item_id": e["item_id"], "map_id": e["map_id"], "name": e.get("name") or "", "why": "gone" if lv is None else "moved"})
    at = time.time()
    if not todo:                                  # every plan moved since: nothing can be put back, so the saves are spent
        for _bid, b in mine:
            b["undone_at"] = at
            b["skipped"] = skipped
        if sess is not None:
            sess["rev"] = int(sess.get("rev") or 0) + 1
        await _save(store)
        A._bump(hass, "plan_build_undo:item_skipped", len(skipped))  # noqa: SLF001
        return {"ok": True, "undone": 0, "skipped": skipped, "rev": (sess or {}).get("rev"), "undo": A.lineup_undo_info(store)}

    snap = A.house_snapshot(hass)
    floor = _floor_name(snap, (sess or {}).get("floor_id") or mine[0][1].get("floor_id"))

    async def failed_undo(code: str, reason: str) -> None:
        _stop(hass, store, store.lineup(sid), reason)
        A._bump(hass, "plan_build_undo:failed")  # noqa: SLF001
        await _save(store)
        raise Refused(code, LP + " ".join(A.STOPS[reason]), {"rev": (store.lineup(sid) or {}).get("rev")})

    backup_id = await _backup(hass, f"Before undoing a plan line-up (experimental): {floor}")
    if not backup_id:
        await failed_undo("backup_failed", "backup_failed")

    snap_store = copy.deepcopy(store.data)
    ubid = "lb_" + secrets.token_hex(4)
    u_items = []
    for bid, e, lv in todo:
        exact = e.get("pins_before") if e["kind"] != "refile" and lv is not None and lv["pins"] == e.get("pins_after") else None
        u_items.append({"item_id": e["item_id"], "kind": e["kind"], "map_id": e["map_id"], "name": e.get("name") or "", "of": bid,
                        "before": copy.deepcopy(e["after"]), "after": copy.deepcopy(e["before"]),
                        "pins_before": lv["pins"] if lv else None, "pins_restore": exact})
    batches[ubid] = {"session": sid, "floor_id": mine[0][1].get("floor_id"), "committed_at": at, "backup_id": backup_id, "items": u_items,
                     "undo_of": [bid for bid, _ in mine], "undone_at": None, "skipped": skipped, "pending": {"at": at}}
    store.trim()
    if not await store.async_checked_save():
        await _put_back(store, snap_store)
        await failed_undo("undo_failed", "undo_failed")
    done: list[dict] = []
    failed = None
    for u in u_items:
        failed = await _write_side(hass, u, "after", u.get("pins_restore"), from_side="before")
        if failed:
            break
        done.append(u)
    if failed:
        put_back = True
        for u in reversed(done):
            if await _write_side(hass, u, "before", u.get("pins_before") if u["kind"] != "refile" else None, from_side="after") not in (None, "changed"):
                put_back = False
        if put_back:
            await _put_back(store, snap_store)
        _invalidate(hass)
        await failed_undo("undo_failed", "undo_failed")

    ub = batches[ubid]
    ub.pop("pending", None)
    _landed(hass, store, ubid, ub, at)
    await _save(store)
    _invalidate(hass)
    _LOGGER.info("PadSpan plan line-up (experimental): undid session %s, %d plan(s) back, %d left (backup %s)", sid, len(u_items), len(skipped), backup_id)
    A._bump(hass, "plan_build_undo:session")  # noqa: SLF001
    if skipped:
        A._bump(hass, "plan_build_undo:item_skipped", len(skipped))  # noqa: SLF001
    for u in u_items:
        A._bump(hass, f"plan_build_item:{u['kind']}_undone")  # noqa: SLF001
        if u["kind"] == "refile":
            A._bump(hass, "plan_build_refile:undone")  # noqa: SLF001
    sess = store.lineup(sid)
    return {"ok": True, "undone": len(u_items), "skipped": skipped, "batch": ubid, "backup_id": backup_id, "rev": (sess or {}).get("rev"),
            "items": {u["item_id"]: ((sess or {}).get("items") or {}).get(u["item_id"]) for u in u_items}, "undo": A.lineup_undo_info(store)}


# ══ Build from plans: rooms, doors, windows and stairs (Stage 2; experimental) ══
# Plan-build design 5 ("Stage 2 as built"). ONE save writes a floor's accepted
# rooms, doors, windows and stairs: a room's outline through
# FabricStore.async_correct_room (the room editor's own path; a new room is
# first made as fabric_room_add makes one: ModelStore.async_ensure_rooms, its
# floor and its adjacency entry), the doors, windows and stairs in one 3D file
# write (apply_edit, async_write; a stair as Add data via plans keeps one).
# Before it: every check, the rooms gate, ONE backup (fabric, model, 3D file;
# its own slot, the last six kept), the ledger with every item's `before`,
# pending until the writes land; settle_rooms finishes a save cut short or puts
# it back. rooms_undo takes the session back: what is still as the save left it
# goes back to `before`, what changed since is left and said. Never a rename,
# never a deleted room of the person's, never a calibration point, a barrier, a
# placement or anything in metres but these outlines, openings and stairs
# (tests/test_plan_build_rooms.py scans for it).

from .const import DATA_FABRIC, FABRIC_STORE_KEY  # noqa: E402

ROOMS_SLOT = "plan_build_rooms"                                    # the backups' own slot (the last A.S1_BACKUPS_KEPT)
RP = "Rooms from plans (experimental): "
ROOM_KINDS = ("room", "room_new")
HOUSE_KINDS = ("opening", "stairs")


def _fab_record(hass: HomeAssistant, room: str) -> dict[str, Any] | None:
    """A room's fabric record as stored (any floor), a copy; None: no such room."""
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    for floor in ((getattr(fab, "data", None) or {}).get("floors") or {}).values():
        rec = ((floor or {}).get("rooms") or {}).get(room) if isinstance(floor, dict) else None
        if isinstance(rec, dict):
            return copy.deepcopy(rec)
    return None


def _shape(rec: Any) -> Any:
    """What makes two room records the same shape: the outline, as stored."""
    if not isinstance(rec, dict):
        return None
    return (rec.get("type", "poly"), [[round(float(v), 3) for v in p[:2]] for p in rec.get("points_m") or []],
            rec.get("cx_m"), rec.get("cy_m"), rec.get("r_m"), str(rec.get("floor_id") or ""))


def _room_at(hass: HomeAssistant, e: dict[str, Any], side: str) -> bool:
    want = e.get(side)
    rec = _fab_record(hass, e["room"])
    if want is None:
        return rec is None
    return rec is not None and _shape(rec) == _shape({**want, "floor_id": e["floor_id"]})


def _house_at(house: dict, e: dict[str, Any], side: str) -> bool:
    section, _, key = e["target"].partition("/")
    return ((house.get(section) or {}).get(key) if isinstance(house.get(section), dict) else None) == e.get(side)


def _at_side(hass: HomeAssistant, house: dict, e: dict[str, Any], side: str) -> bool:
    return _room_at(hass, e, side) if e["kind"] in ROOM_KINDS else _house_at(house, e, side)


async def _write_room(hass: HomeAssistant, e: dict[str, Any], side: str) -> str | None:
    """THE room write: one room to its `before` or `after`, through the room
    editor's own writer. A room the save made is taken away again only by
    ModelStore.async_remove_room (geometry, meta, adjacency), and only by an
    undo or a put-back that found it still as made. A `before` with a
    provenance stamp gets it back (async_correct_room's source fields); an
    external import's record comes back as a correction (that writer refuses
    to import over a room). None, or why it failed."""
    dom = hass.data.get(DOMAIN, {})
    fab, mdl = dom.get(DATA_FABRIC), dom.get(DATA_MODEL)
    if fab is None or mdl is None:
        return "no_fabric"
    want, room, fl = e.get(side), e["room"], e["floor_id"]
    try:
        had = e.get("meta_before") or {}
        if want is None and (had.get("room_meta") is not None or had.get("adjacency") is not None or had.get("scanners")):
            # A new room under a name that already had settings (a Home Assistant area with its floor, colour,
            # height, adjacency) or a receiver in it: only the shape the save added goes; the settings come back as
            # they were (review B1), and the receivers stay (ModelStore.async_remove_room would take them along).
            res = await fab.async_remove_room(room)
            if not res.get("ok"):
                return str(res.get("error") or "remove_failed")
            for key, was in (("room_meta", had.get("room_meta")), ("room_adjacency", had.get("adjacency"))):
                if was is None:
                    (mdl.data.get(key) or {}).pop(room, None)
                else:
                    mdl.data.setdefault(key, {})[room] = copy.deepcopy(was)
            await mdl.store.async_save(mdl.data)
            return None
        if want is None:
            res = await mdl.async_remove_room(room)
            return None if res.get("ok") else str(res.get("error") or "remove_failed")
        if e["kind"] == "room_new" and side == "after":
            await mdl.async_ensure_rooms([room])
            rm = mdl.data.get("room_meta", {})
            if room in rm:
                rm[room]["floor_id"] = fl
            mdl.data.setdefault("room_adjacency", {}).setdefault(room, [])
            await mdl.store.async_save(mdl.data)
        whole = "committed_by" in want or "source_map_id" in want          # a record as it was stored (an undo's or a put-back's side)
        stamp = {k: want.get(k) for k in ("source_map_id", "source_transform", "source_image")} if whole else {}
        by = want.get("committed_by") if whole and want.get("committed_by") not in (None, "external_import") else "correction"
        geo = {k: want[k] for k in ("type", "points_m", "cx_m", "cy_m", "r_m") if k in want}
        res = await fab.async_correct_room(fl, room, geo, committed_by=by, **stamp)
        return None if res.get("ok") else str(res.get("error") or "correct_failed")
    except Exception as err:  # noqa: BLE001 — a write that throws is a write that failed
        _LOGGER.error("PadSpan rooms from plans: a room write failed: %s", P._why(err))  # noqa: SLF001
        return "error"


async def _write_house(house: H.House3dStore, entries: list[dict], side: str) -> str | None:
    """THE 3D write: these doors, windows and stairs to one side, in one
    apply_edit and one checked write. None, or why it failed."""
    if not entries:
        return None
    changes: dict[str, dict] = {}
    for e in entries:
        section, _, key = e["target"].partition("/")
        changes.setdefault(section, {})[key] = copy.deepcopy(e.get(side))
    try:
        new = H.apply_edit(house.data, changes)
        return None if await house.async_write(new) else "save_failed"
    except H.EditError as err:
        return f"invalid: {err}"
    except Exception as err:  # noqa: BLE001
        _LOGGER.error("PadSpan rooms from plans: the 3D file couldn't be written: %s", P._why(err))  # noqa: SLF001
        return "error"


async def _write_entries(hass: HomeAssistant, house: H.House3dStore, entries: list[dict], side: str, only_from: str | None = None
                         ) -> tuple[list[dict], str | None]:
    """Entries to one side: the 3D file's in one write first, then each room.
    `only_from`: an entry is written only while it is still at that side
    (a hand edit since stays). (written, why it stopped or None)."""
    live = house.data
    todo = [e for e in entries if only_from is None or _at_side(hass, live, e, only_from)]
    done: list[dict] = []
    houses = [e for e in todo if e["kind"] in HOUSE_KINDS]
    why = await _write_house(house, houses, side)
    if why:
        return done, why
    done += houses
    for e in todo:
        if e["kind"] in ROOM_KINDS:
            why = await _write_room(hass, e, side)
            if why:
                return done, why
            done.append(e)
    return done, None


def _mint(existing: Any, prefix: str) -> str:
    while True:
        oid = f"{prefix}_{secrets.token_hex(4)}"
        if oid not in (existing or {}):
            return oid


def _opening_entry(o: dict) -> dict[str, Any]:
    """A proposed door, doorway or window as the 3D editor would add it (its defaults)."""
    base = {"kind": o["kind"], "floor_id": o["floor_id"], "a_m": list(o["a_m"]), "b_m": list(o["b_m"])}
    if o["kind"] == "window":
        return {**base, "sill_m": A.S2_WINDOW_SILL_M, "head_m": A.S2_WINDOW_HEAD_M}
    if o["kind"] == "doorway":
        return {**base, "head_m": A.S2_DOOR_HEAD_M}
    return {**base, "head_m": A.S2_DOOR_HEAD_M, "hinge": "left", "swing": "in", **({"type": o["type"]} if o.get("type") else {})}


def _offered(prop: dict, iid: str) -> bool:
    """An item a save may write."""
    kind, _, key = iid.partition(":")
    if kind == "room":
        return key in (prop.get("rooms") or {})
    if kind == "space":
        s = (prop.get("spaces") or {}).get(iid) or {}
        return bool(s.get("new")) and not s.get("merged_into")
    if kind in ("door", "window"):
        o = (prop.get("openings") or {}).get(iid) or {}
        return bool(o.get("placed")) and (not o.get("existing") or (o["existing"].get("what") == "opening" and bool(o["existing"].get("entry"))))
    if kind == "stairs":
        return ((prop.get("stairs") or {}).get(iid) or {}).get("relation") in ("new", "correction", "stacked")
    return False


def _writes_of(prop: dict, iid: str) -> Any:
    """What a save of this item writes, to compare a fresh proposal with the one the person saw."""
    kind = iid.partition(":")[0]
    if kind == "room":
        r = prop["rooms"].get(iid[5:]) or {}
        return (r.get("outline_m"), r.get("now_m"))
    if kind == "space":
        s = prop["spaces"].get(iid) or {}
        return (s.get("outline_m"), s.get("new"), s.get("merged_into"))
    if kind in ("door", "window"):
        o = prop["openings"].get(iid) or {}
        return (o.get("a_m"), o.get("b_m"), o.get("kind"), o.get("existing"))
    s = prop["stairs"].get(iid) or {}
    return (s.get("geom"), s.get("floor_id"), s.get("relation"), s.get("target"), s.get("target_snap"))


async def settle_rooms(hass: HomeAssistant, store: A.PlanAiStore, house: H.House3dStore) -> bool:
    """A rooms save or undo cut short between its writes: run before any rooms
    command. Every entry at its `after`: the batch stands (the mark comes
    off). Otherwise what is at `after` goes back to `before` and the batch
    goes; a put-back that can't be written leaves the batch standing for what
    it still holds, said once (save_stands or undo_stands). In memory; the
    caller saves when it returns True."""
    if not A.writable(store.data):
        return False
    settled = False
    batches = store.data.get("room_batches") or {}
    for bid, b in list(batches.items()):
        p = b.get("pending") if isinstance(b, dict) else None
        if not isinstance(p, dict):
            continue
        settled = True
        entries = b.get("items") or []
        if entries and all(_at_side(hass, house.data, e, "after") for e in entries):
            b.pop("pending", None)
            _rooms_landed(store, bid, b, float(p.get("at") or time.time()))
            A._bump(hass, "plan_build_settled:finished")  # noqa: SLF001
            continue
        back = [e for e in entries if _at_side(hass, house.data, e, "after") and not _at_side(hass, house.data, e, "before")]
        _done, why = await _write_entries(hass, house, back, "before", only_from="after")
        _invalidate(hass)
        if why is None:
            batches.pop(bid, None)
            A._bump(hass, "plan_build_settled:put_back")  # noqa: SLF001
            continue
        b["items"] = [e for e in entries if _at_side(hass, house.data, e, "after")]
        b.pop("pending", None)
        b["stood"] = True
        _rooms_landed(store, bid, b, float(p.get("at") or time.time()))
        _stop(hass, store, store.rooms_session(b.get("session")), "undo_stands" if b.get("undo_of") else "save_stands")
        A._bump(hass, "plan_build_settled:stood")  # noqa: SLF001
    return settled


def _rooms_landed(store: A.PlanAiStore, bid: str, b: dict[str, Any], at: float) -> None:
    """A batch whose writes all landed: the session says which items are saved, an undo's saves are spent."""
    sess = store.rooms_session(b.get("session"))
    saved = (sess or {}).setdefault("saved", {})
    for e in b.get("items") or []:
        if b.get("undo_of"):
            for iid in e.get("item_ids") or [e["item_id"]]:
                saved.pop(iid, None)
        else:
            saved[e["item_id"]] = bid
    for of in b.get("undo_of") or []:
        ob = (store.data.get("room_batches") or {}).get(of)
        if isinstance(ob, dict):
            ob["undone_at"] = at
    if sess is not None:
        if not b.get("undo_of") and bid not in (sess.get("batches") or []):
            sess.setdefault("batches", []).append(bid)
        sess["rev"] = int(sess.get("rev") or 0) + 1


async def rooms_commit(hass: HomeAssistant, store: A.PlanAiStore, house: H.House3dStore, sid: str, rev: int, item_ids: Any,
                       finals: Any = None) -> dict[str, Any]:
    """Accept all for this floor (Garry: "an all or nothing option"): the
    ticked rooms, new rooms, doors, windows and stairs in ONE save. Every
    check first, then the gate, one backup, the ledger pending, the writes
    (a failure puts back what was written), the mark off. `finals`: a new
    stair's piece as the panel builds it ({item id: piece}). The caller holds
    the 3D store's lock and then the plan store's."""
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", RP + "this plan store was saved by a newer PadSpan: update PadSpan to save.")
    if not H.writable(house.data):
        raise Refused("house3d_newer", RP + H.NEWER_MESSAGE)
    if await settle_rooms(hass, store, house):
        await _save(store)
    sess = store.rooms_session(sid)
    if sess is None:
        raise Refused("not_found", RP + "that session isn't here any more: read the floor again.")
    if A.running(hass) is not None or sess.get("status") == "running":
        raise Refused("already_running", RP + "a session is reading your plans: save when it ends.")
    if int(sess.get("rev") or 0) != rev:
        raise Refused(REV_CODE, RP + "the session changed since you looked. Nothing was saved: it is reloaded, try again.")
    ids = list(item_ids) if isinstance(item_ids, list) else []
    prop = sess.get("proposal") or {}
    if not ids or len(set(ids)) != len(ids) or not all(isinstance(i, str) for i in ids) or not prop:
        raise Refused("invalid", RP + "nothing to save.")
    shut = [i for i in ids if not _offered(prop, i) or i in (sess.get("saved") or {})]
    if shut:
        raise Refused("not_open", RP + "some items can't be saved now.", {"items": shut, "rev": sess.get("rev")})
    finals = finals if isinstance(finals, dict) else {}
    fid = sess["floor_id"]

    async def refuse(code: str, message: str, stop: str | None, counter: str, extra: dict | None = None) -> None:
        if stop:
            _stop(hass, store, sess, stop)
        else:
            sess["rev"] = int(sess.get("rev") or 0) + 1
        A._bump(hass, f"plan_build_commit:{counter}")  # noqa: SLF001
        await _save(store)
        raise Refused(code, message, {**(extra or {}), "rev": sess.get("rev")})

    async def fresh() -> tuple[dict, dict, list, list, dict]:
        snap, house_now, points, barriers = await A.rooms_inputs(hass)
        return snap, house_now, points, barriers, await hass.async_add_executor_job(A.rooms_proposal, copy.deepcopy(sess), snap, house_now, points, barriers)

    async def recheck(during: bool) -> tuple[dict, list, dict]:
        """The plans, the line-up and every item against the house as it is now."""
        snap, _house_now, points, _barriers, now = await fresh()
        if A.plans_moved(hass, sess):                 # a plan moved or changed since the read: its metres are not what was read
            changed = [i for i in ids if i.startswith(("room:", "space:", "door:", "window:", "stairs:"))]
            sess["stale"] = changed
            await refuse("changed_since", RP + " ".join(A.STOPS["plan_changed"]), "plan_changed", "changed_since", {"changed": changed})
        changed = [i for i in ids if _writes_of(now, i) != _writes_of(prop, i)]
        names = [i for i in ids if i.startswith("space:") and str(prop["spaces"][i]["new"]).lower() in {n.lower() for n in snap["rooms"]}]
        if names:
            await refuse("name_taken", RP + " ".join(A.STOPS["name_taken"]), "name_taken", "changed_since", {"items": names})
        if changed:
            sess["stale"] = changed
            await refuse("changed_since", RP + " ".join(A.STOPS["changed_while_saving" if during else "rooms_changed"]),
                         "changed_while_saving" if during else "rooms_changed", "changed_since", {"changed": changed})
        return snap, points, now

    # 1. Check everything; write nothing if any check fails.
    snap, points, _now = await recheck(False)
    stairs_new = [i for i in ids if i.startswith("stairs:") and prop["stairs"][i]["relation"] in ("new", "stacked")]
    missing = [i for i in stairs_new if not isinstance(finals.get(i), dict)]
    if missing:
        raise Refused("invalid", RP + "a new stair is built in the 3D view: open Live Aboard to save it, or untick it.", {"items": missing, "rev": sess.get("rev")})
    at = time.time()
    bid = "rb_" + secrets.token_hex(4)
    note = {"session": sid, "batch": bid, "kind": "stairs", "at": at}
    house_entries: list[dict] = []
    live_open, live_pieces = house.data.get("openings") or {}, house.data.get("pieces") or {}
    indoor = _indoor(hass)
    minted: set[str] = set()
    for iid in ids:
        if iid.startswith(("door:", "window:")):
            o = prop["openings"][iid]
            ex = o.get("existing")
            if ex:                                       # a correction: the opening already there (unchanged since the read: recheck), moved or resized to the read one
                live = live_open.get(ex["id"])
                house_entries.append({"item_id": iid, "kind": "opening", "target": f"openings/{ex['id']}", "before": copy.deepcopy(live),
                                      "after": {**copy.deepcopy(live), "a_m": list(o["a_m"]), "b_m": list(o["b_m"])}})
                continue
            oid = _mint({**live_open, **dict.fromkeys(minted)}, {"window": "win", "door": "door", "doorway": "doorway"}[o["kind"]])
            minted.add(oid)
            house_entries.append({"item_id": iid, "kind": "opening", "target": f"openings/{oid}", "before": None, "after": _opening_entry(o)})
        elif iid.startswith("stairs:"):
            st = prop["stairs"][iid]
            if st["relation"] == "correction":
                tgt = st["target"]
                house_entries.append({"item_id": iid, "kind": "stairs", "target": f"pieces/{tgt}", "before": copy.deepcopy(live_pieces.get(tgt)),
                                      "after": _corrected({"geom": st["geom"]}, live_pieces[tgt], None, note)})
            else:
                pid = _new_piece_id({**live_pieces, **dict.fromkeys(minted)})
                minted.add(pid)
                house_entries.append({"item_id": iid, "kind": "stairs", "target": f"pieces/{pid}", "before": None,
                                      "after": _new_piece({"id": iid}, pid, finals[iid], note, indoor)})
    if house_entries:                                   # checked in full before anything is touched
        changes: dict[str, dict] = {}
        for e in house_entries:
            section, _, key = e["target"].partition("/")
            changes.setdefault(section, {})[key] = e["after"]
        try:
            new = H.apply_edit(house.data, changes)
        except H.EditError as err:
            raise Refused("invalid", RP + str(err), {"rev": sess.get("rev")}) from err
        for e in house_entries:                          # as the file will hold it (apply_edit stamps a piece)
            section, _, key = e["target"].partition("/")
            e["after"] = copy.deepcopy(new[section][key])
    room_entries: list[dict] = []
    for iid in ids:
        if iid.startswith("room:"):
            r = prop["rooms"][iid[5:]]
            room_entries.append({"item_id": iid, "kind": "room", "room": r["room"], "floor_id": fid, "before": _fab_record(hass, r["room"]),
                                 "after": {"type": "poly", "points_m": [[round(x, 3), round(y, 3)] for x, y in r["outline_m"]]}})
        elif iid.startswith("space:"):
            s = prop["spaces"][iid]
            mdata = getattr(hass.data.get(DOMAIN, {}).get(DATA_MODEL), "data", None) or {}
            room_entries.append({"item_id": iid, "kind": "room_new", "room": s["new"], "floor_id": fid, "before": None,
                                 "after": {"type": "poly", "points_m": [[round(x, 3), round(y, 3)] for x, y in s["outline_m"]]},
                                 # What the name had before the save (an area's settings, the scanners in it): undo puts it back (review B1).
                                 "meta_before": {"room_meta": copy.deepcopy((mdata.get("room_meta") or {}).get(s["new"])),
                                                 "adjacency": copy.deepcopy((mdata.get("room_adjacency") or {}).get(s["new"])),
                                                 "scanners": sorted(k for k, v in (mdata.get("scanners") or {}).items()
                                                                    if isinstance(v, dict) and v.get("room") == s["new"])}})

    # 2. The room score on this floor's calibration spots: kept with the save and counted, never a refusal (Garry, 2026-11-10:
    #    accuracy is information and a choice per room; a wrong save costs one undo, a refusal costs the tool).
    gate = await hass.async_add_executor_job(A.rooms_gate, points, fid, snap["rooms"], A.chosen_outlines(prop, ids), _excluded(hass))
    sess["gate"] = gate
    A._bump(hass, f"plan_build_heldout:{A.gate_event(gate)}")  # noqa: SLF001

    # 3. One backup, in its own slot.
    backup_id = await _auto_backup_rooms(hass, f"Before rooms from plans (experimental): {_floor_name(snap, fid)}")
    if not backup_id:
        await refuse("backup_failed", RP + " ".join(A.STOPS["backup_failed"]), "backup_failed", "backup_failed")
    await recheck(True)                                   # the backup awaited: a hand edit may have landed meanwhile
    if any(not _house_at(house.data, e, "before") for e in house_entries) or any(not _room_at(hass, e, "before") for e in room_entries):
        await refuse("changed_since", RP + " ".join(A.STOPS["changed_while_saving"]), "changed_while_saving", "changed_since")

    # 4. The ledger, pending.
    snap_store = copy.deepcopy(store.data)
    entries = house_entries + room_entries
    batch = {"session": sid, "floor_id": fid, "committed_at": at, "backup_id": backup_id, "items": entries, "undone_at": None,
             "undo_of": None, "gate": gate, "pending": {"at": at}}
    store.data.setdefault("room_batches", {})[bid] = batch
    store.trim()
    if not await store.async_checked_save():
        await _put_back(store, snap_store)
        await refuse("save_failed", RP + "couldn't save the record of this save, so nothing was changed. Try again.", None, "save_failed")

    # 5. The writes: the 3D file in one, then each room.
    done, why = await _write_entries(hass, house, entries, "after", only_from="before")
    if why or len(done) != len(entries):
        _back, back_why = await _write_entries(hass, house, list(reversed(done)), "before", only_from="after")
        if back_why is None:
            await _put_back(store, snap_store)
        else:
            await _save(store)                             # left pending: settle_rooms puts it back next time
        _invalidate(hass)
        if done:
            A._bump(hass, "plan_build_commit:rolled_back")  # noqa: SLF001
        sess = store.rooms_session(sid) or sess
        await refuse("save_failed", RP + ("couldn't write it all, so what was written is put back: nothing was changed. " if back_why is None else
                                          "couldn't write it all; what was written is put back the next time Rooms from plans opens. ")
                     + "Try again; check Home Assistant's storage.", None, "save_failed")

    # 6. The mark off; what was saved is said and counted. The proposal is worked out again on the house as it is now,
    #    so a second save of what isn't saved yet is checked against it, not refused as changed (review B12).
    batch.pop("pending", None)
    _rooms_landed(store, bid, batch, at)
    await _repropose(hass, sess)
    await _save(store)
    _invalidate(hass)
    _LOGGER.info("PadSpan rooms from plans (experimental): saved %d item(s) of session %s (backup %s)", len(entries), sid, backup_id)
    for e in entries:
        k = {"room": "room", "room_new": "space", "stairs": "stairs"}.get(e["kind"]) or e["item_id"].partition(":")[0]
        A._bump(hass, f"plan_build_item:{k}_accepted")  # noqa: SLF001
    for m in (sess.get("edits") or {}).get("merges") or []:
        A._bump(hass, f"plan_build_merge:{'into_room' if m.get('into') else 'together'}")  # noqa: SLF001
    for _ in (e for e in room_entries if e["kind"] == "room_new"):
        A._bump(hass, "plan_build_merge:new_room")  # noqa: SLF001
    A._bump(hass, "plan_build_commit:done")  # noqa: SLF001
    return {"ok": True, "rev": sess["rev"], "batch": bid, "backup_id": backup_id, "gate": gate, "saved": ids, "undo": A.rooms_undo_info(store, sid)}


async def _repropose(hass: HomeAssistant, sess: dict | None) -> None:
    """A session's proposal worked out again on the house as it is (after a
    save or an undo). One that can't be worked out keeps the one it had."""
    if not sess or not sess.get("proposal"):
        return
    _invalidate(hass)
    try:
        snap, house_now, points, barriers = await A.rooms_inputs(hass)
        sess["proposal"] = await hass.async_add_executor_job(A.rooms_proposal, copy.deepcopy(sess), snap, house_now, points, barriers)
    except Exception as err:  # noqa: BLE001 — what was saved stands; the next save checks against a fresh one anyway
        _LOGGER.warning("PadSpan rooms from plans: the proposal couldn't be worked out again: %s", P._why(err))  # noqa: SLF001


def _excluded(hass: HomeAssistant) -> frozenset:
    from .const import DATA_CALIBRATION  # noqa: PLC0415
    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    try:
        return frozenset(cal.excluded_sources()) if cal is not None and hasattr(cal, "excluded_sources") else frozenset()
    except Exception:  # noqa: BLE001
        return frozenset()


async def _auto_backup_rooms(hass: HomeAssistant, note: str) -> str | None:
    from .ws_backup import _auto_backup  # noqa: PLC0415
    return await _auto_backup(hass, note, [FABRIC_STORE_KEY, MODEL_STORE_KEY, HOUSE3D_STORE_KEY], mark_absent=True, slot=ROOMS_SLOT,
                              exact=True, slot_keep=A.S1_BACKUPS_KEPT)


async def rooms_undo(hass: HomeAssistant, store: A.PlanAiStore, house: H.House3dStore, sid: str) -> dict[str, Any]:
    """Undo a rooms session: every save of it, newest first. What is still as
    a save left it goes back (an outline with its stamp as it was; a room the
    save made is taken away, unless a scanner was put in it since; an opening
    or a stair to what it was); what changed since is left and said. A backup
    first; a batch of its own in the ledger. Allowed whatever the AI Task. The
    caller holds the 3D store's lock and then the plan store's."""
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", RP + "this plan store was saved by a newer PadSpan: update PadSpan to undo.")
    if not H.writable(house.data):
        raise Refused("house3d_newer", RP + H.NEWER_MESSAGE)
    if await settle_rooms(hass, store, house):
        await _save(store)
    if A.running(hass) is not None:
        raise Refused("already_running", RP + "a session is reading your plans: undo when it ends.")
    sess = store.rooms_session(sid)
    batches = store.data.setdefault("room_batches", {})
    mine = sorted(((bid, b) for bid, b in batches.items() if isinstance(b, dict) and b.get("session") == sid and not b.get("undo_of")
                   and not b.get("undone_at") and not b.get("pending")), key=lambda t: float(t[1].get("committed_at") or 0), reverse=True)
    if not mine:
        raise Refused("nothing_to_undo", RP + "nothing of this session is left to undo.")
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    scanners = (getattr(mdl, "data", None) or {}).get("scanners") or {}
    todo: list[dict] = []
    skipped: list[dict] = []
    # One undo per target (review B3): two saves of the session may touch one room, door or stair. The newest `after`
    # is checked against the house as it is; the oldest `before` is written back.
    targets: dict[tuple, list[tuple[str, dict]]] = {}
    for bid, b in mine:
        for e in reversed(b.get("items") or []):
            targets.setdefault(("room", e["room"]) if e["kind"] in ROOM_KINDS else ("house", e["target"]), []).append((bid, e))
    for got in targets.values():
        (bid, newest), (_obid, oldest) = got[0], got[-1]
        had = set((oldest.get("meta_before") or {}).get("scanners") or [])
        in_use = oldest["kind"] == "room_new" and any(isinstance(v, dict) and v.get("room") == oldest["room"] and k not in had
                                                      for k, v in scanners.items())
        if _at_side(hass, house.data, newest, "after") and not in_use:
            todo.append({**copy.deepcopy(oldest), "item_id": newest["item_id"], "item_ids": [e["item_id"] for _b, e in got],
                         "before": copy.deepcopy(newest["after"]), "after": copy.deepcopy(oldest["before"]), "of": bid})
        else:
            skipped += [{"item_id": e["item_id"], "why": "in_use" if in_use else "changed"} for _b, e in got]
    at = time.time()
    if not todo:                                          # everything changed since: nothing can go back, so the saves are spent
        for _bid, b in mine:
            b["undone_at"] = at
            b["skipped"] = skipped
        if sess is not None:
            sess["saved"] = {}
            sess["rev"] = int(sess.get("rev") or 0) + 1
        await _save(store)
        A._bump(hass, "plan_build_undo:item_skipped", len(skipped))  # noqa: SLF001
        return {"ok": True, "undone": 0, "skipped": skipped, "rev": (sess or {}).get("rev"), "undo": A.rooms_undo_info(store)}

    snap = A.house_snapshot(hass)

    async def failed_undo(code: str, reason: str) -> None:
        _stop(hass, store, store.rooms_session(sid), reason)
        A._bump(hass, "plan_build_undo:failed")  # noqa: SLF001
        await _save(store)
        raise Refused(code, RP + " ".join(A.STOPS[reason]), {"rev": (store.rooms_session(sid) or {}).get("rev")})

    backup_id = await _auto_backup_rooms(hass, f"Before undoing rooms from plans (experimental): {_floor_name(snap, (sess or {}).get('floor_id'))}")
    if not backup_id:
        await failed_undo("backup_failed", "backup_failed")
    snap_store = copy.deepcopy(store.data)
    ubid = "rb_" + secrets.token_hex(4)
    batches[ubid] = {"session": sid, "floor_id": mine[0][1].get("floor_id"), "committed_at": at, "backup_id": backup_id, "items": todo,
                     "undo_of": [bid for bid, _ in mine], "undone_at": None, "skipped": skipped, "pending": {"at": at}}
    store.trim()
    if not await store.async_checked_save():
        await _put_back(store, snap_store)
        await failed_undo("undo_failed", "undo_failed")
    done, why = await _write_entries(hass, house, todo, "after", only_from="before")
    if why or len(done) != len(todo):
        _back, back_why = await _write_entries(hass, house, list(reversed(done)), "before", only_from="after")
        if back_why is None:
            await _put_back(store, snap_store)
        _invalidate(hass)
        await failed_undo("undo_failed", "undo_failed")
    ub = batches[ubid]
    ub.pop("pending", None)
    _rooms_landed(store, ubid, ub, at)
    await _repropose(hass, store.rooms_session(sid))
    await _save(store)
    _invalidate(hass)
    _LOGGER.info("PadSpan rooms from plans (experimental): undid session %s, %d item(s) back, %d left (backup %s)", sid, len(todo), len(skipped), backup_id)
    A._bump(hass, "plan_build_undo:session")  # noqa: SLF001
    if skipped:
        A._bump(hass, "plan_build_undo:item_skipped", len(skipped))  # noqa: SLF001
    for e in todo:
        k = {"room": "room", "room_new": "space", "stairs": "stairs"}.get(e["kind"]) or e["item_id"].partition(":")[0]
        A._bump(hass, f"plan_build_item:{k}_undone")  # noqa: SLF001
    return {"ok": True, "undone": len(todo), "skipped": skipped, "batch": ubid, "backup_id": backup_id,
            "rev": (store.rooms_session(sid) or {}).get("rev"), "undo": A.rooms_undo_info(store)}


# ── The rooms helper's scale: one guided measurement (AI mapping wizard piece 3) ──
# Design ai-wizard-design-2026-11-10.md, E.3-E.6. What it writes: a plan's
# first scale, exactly as Mapping → Edit → Measure's Save writes it, through
# Measure's own writer (ws_fabric.async_write_measured_transform), which seeds
# the house's metre scale only when the house has none; and the plan's floor,
# through the refile write above, only when the person picked another. What it
# never does: write a plan that already has any placement record, change a
# house scale that was set, move a calibration point, a room, a receiver, a
# beacon or a light, or re-place anything (no async_reanchor_map, no reanchor).
# Its undo takes back exactly that, only while nothing in metres was added
# since, through ModelStore.async_unset_world_gauge (compare and clear).
# The ledger (scale_batches in this store) is written first, marked pending,
# as the line-up's and the rooms' are: settle_scale finishes or takes back a
# save or an undo a restart cut short.
import hashlib  # noqa: E402
import json  # noqa: E402

from . import fabric_truth as FT  # noqa: E402
from . import subzones as SZ  # noqa: E402
from .const import DATA_HOUSE3D, DATA_SUBZONES  # noqa: E402

SCALE_SLOT = "plan_build_scale"                                  # the backups' own slot (the last A.S1_BACKUPS_KEPT)
SCALE_SOURCES: tuple[str, ...] = ("guided", "plan_dimension", "plan_dimension_corrected")
SCALE_STOPS: tuple[str, ...] = ("already_placed", "points_on_plan", "plan_changed", "no_picture_size", "floor_unknown", "backup_failed")
SCALE_ODD_M: tuple[float, float] = (2.0, 100.0)                  # a plan this many metres across or down is odd: said, never refused
MIN_PX = 8.0                                                     # two clicks closer than this on the picture aren't a measurement
SCALE_WORDS: dict[str, str] = {
    "already_placed": "This plan already has a scale, so nothing was changed. To change it, use Mapping → Edit → Measure.",
    "points_on_plan": "Calibration spots are already saved on this plan, so its scale is left as it is. "
                      "To set it, use Mapping → Edit → Measure.",
    "plan_changed": "The plan picture changed since this screen opened. Nothing was saved: measure again.",
    "no_picture_size": "This plan's picture has no size on record, so its scale can't be worked out here. "
                       "Use Mapping → Edit → Measure.",
    "floor_unknown": "Pick which floor this plan shows.",
    "backup_failed": "The safety backup couldn't be made, so nothing was saved. Check Home Assistant's storage and try again.",
    "changed_since": "Something in metres changed since the scale was saved (a room, a wall, a receiver, a zone, something in 3D, "
                     "another plan's scale, or calibration points were recorded since, some of them automatically), so the scale "
                     "stays. To change it, use Mapping → Edit → Measure.",
    "nothing_to_undo": "There's no scale saved by this helper to take back.",
    "save_failed": "The record of this save couldn't be written, so nothing was changed. Try again.",
}


def _picture_size(m: dict | None) -> tuple[int, int] | None:
    img = (m or {}).get("image") or {}
    try:
        w, h = int(img.get("width") or 0), int(img.get("height") or 0)
    except (TypeError, ValueError):
        return None
    return (w, h) if w > 0 and h > 0 else None


def _frac_pt(p: Any) -> list[float] | None:
    if not isinstance(p, (list, tuple)) or len(p) != 2:
        return None
    try:
        x, y = float(p[0]), float(p[1])
    except (TypeError, ValueError):
        return None
    if isinstance(p[0], bool) or isinstance(p[1], bool) or not (math.isfinite(x) and math.isfinite(y)):
        return None
    return [round(x, 4), round(y, 4)] if -0.001 <= x <= 1.001 and -0.001 <= y <= 1.001 else None


def scale_from_measures(size: tuple[int, int], measures: Any, source: str, today: str) -> dict[str, Any]:
    """Pure. The typed lengths parsed (plan_geom.parse_length: feet and inches,
    mm, cm, m) and the scale worked out HERE from the two points and the
    stored picture size, as Measure works it out (maps.js: px/m per
    measurement, their average, the plan's size from it, both rounded as
    Measure rounds them). A px/m the panel sends is never read. Refused
    ("invalid") when a length isn't one or the points aren't two on the plan.
    Returns {transform: exactly Measure's payload, ppm, across_m, down_m, odd}."""
    w, h = size
    if not isinstance(measures, list) or not 1 <= len(measures) <= 2:
        raise Refused("invalid", "Click both ends of something on the plan, then type its length.")
    refs, ppms = [], []
    for ms_ in measures:
        ms_ = ms_ if isinstance(ms_, dict) else {}
        p1, p2 = _frac_pt(ms_.get("p1")), _frac_pt(ms_.get("p2"))
        metres = G.parse_length(ms_.get("text"))
        if p1 is None or p2 is None:
            raise Refused("invalid", "Click both ends of something on the plan, then type its length.")
        if metres is None or not 0.05 <= metres <= 1000:
            raise Refused("invalid", "Type a length such as 4.2 m, 420 cm or 13' 9\".")
        dx, dy = (p2[0] - p1[0]) * w, (p2[1] - p1[1]) * h
        dist_px = math.hypot(dx, dy)
        if dist_px < MIN_PX:
            raise Refused("invalid", "The two ends are too close together: click both ends of something longer.")
        ppm = dist_px / metres
        ppms.append(ppm)
        refs.append({"p1": p1, "p2": p2, "distance_m": round(metres, 4), "px_per_meter": round(ppm * 100) / 100,
                     "angle_deg": round(math.degrees(math.atan2(abs(dy), abs(dx)))), "date": today, "source": source})
    ppm = round(sum(ppms) / len(ppms) * 100) / 100
    sx, sy = round(w / ppm * 10000) / 10000, round(h / ppm * 10000) / 10000
    lo, hi = SCALE_ODD_M
    return {"transform": {"scale_x_m": sx, "scale_y_m": sy, "reference_measurements": refs}, "ppm": ppm, "across_m": sx, "down_m": sy,
            "metres": [r["distance_m"] for r in refs], "odd": not (lo <= sx <= hi and lo <= sy <= hi)}


def _points_on(hass: HomeAssistant, map_id: str) -> bool:
    """A calibration point with stored metres on this plan."""
    _mdl, _ms, cal = _house_stores(hass)
    return any(isinstance(p, dict) and p.get("map_id") == map_id and p.get("x_m") is not None
               for p in ((getattr(cal, "data", None) or {}).get("points") or []))


def _canon(v: Any) -> Any:
    """A value as the fingerprint hashes it: numbers to four decimals (1 and 1.0 alike, as a reload reads them)."""
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, (int, float)):
        return f"{float(v):.4f}"
    if isinstance(v, dict):
        return {str(k): _canon(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_canon(x) for x in v]
    return str(v)


async def _metre_files_read(hass: HomeAssistant) -> None:
    """The 3D file and the sub-zones are read on first use: read them now (reading
    writes nothing), so the fingerprint sees what they hold. One that can't be
    read is fingerprinted as unread, which a later read never matches: the undo is refused."""
    for get in (H.async_get_store, SZ.async_get_store):
        try:
            await get(hass)
        except Exception:  # noqa: BLE001
            _LOGGER.warning("PadSpan rooms helper: a file couldn't be read for the scale's undo check", exc_info=True)


def _metres_fp(hass: HomeAssistant, map_id: str) -> str:
    """Everything in metres a scale undo must find unchanged: the rooms, the
    walls, the receivers', beacons' and lights' positions, every calibration
    point's place in metres (by id and plan: one moved, or one added and one
    deleted, counts; so do the [auto] ones a pinned beacon records on its own,
    since their metres come from the scale), the sub-zones, the 3D file's
    pieces (stairs among them), openings, lights, devices and figures, and
    every OTHER plan's placement record. Synchronous, so a caller can compare
    and write with no await between. A hash, the same after a restart (sorted
    keys, numbers to four decimals). Taken before the save writes: the save
    changes none of it."""
    mdl, _ms, cal = _house_stores(hass)
    dom = hass.data.get(DOMAIN, {})
    h3, sz = dom.get(DATA_HOUSE3D), dom.get(DATA_SUBZONES)
    points = [p for p in ((getattr(cal, "data", None) or {}).get("points") or []) if isinstance(p, dict)]
    got = {"rooms": mdl.room_geometry_m(), "walls": mdl.rf_barriers_m(), "receivers": mdl.scanner_positions_m(),
           "beacons": mdl.beacon_positions_m(), "lights": mdl.light_positions_m(),
           "points": sorted(json.dumps(_canon([p.get("id"), p.get("map_id"), p.get("x_m"), p.get("y_m")])) for p in points),
           "zones": sz.zones() if isinstance(sz, SZ.SubzoneStore) else "unread",
           "3d": {s: h3.data.get(s) for s in H.SECTIONS} if isinstance(h3, H.House3dStore) else "unread",
           "others": {k: v for k, v in (mdl.data.get("map_transforms") or {}).items() if k != map_id}}
    return hashlib.sha256(json.dumps(_canon(got), sort_keys=True).encode("utf-8")).hexdigest()[:16]


def _floor_side(hass: HomeAssistant, m: dict, fid: str | None = None) -> dict[str, Any]:
    """A plan's floor as the refile write takes it: as it is, or (fid) moved to that floor's storey."""
    stk = m.get("stack") or {}
    side = {"floor_id": str(m.get("floor_id") or ""), "t_floor": None, "stack_floor": stk.get("floor_id"),
            "stack_level": stk.get("z_level"), "stack_height": stk.get("ceiling_height_m")}
    if fid is None:
        return side
    level, height = _storey(hass, fid, m["id"])
    return {"floor_id": fid, "t_floor": fid, "stack_floor": fid if side["stack_floor"] else None,
            "stack_level": side["stack_level"] if level is None else level, "stack_height": side["stack_height"] if height is None else height}


def scale_check(hass: HomeAssistant, map_id: str, sig: str | None, floor_id: str | None) -> tuple[dict, str]:
    """The data-safety checks, in order; (the plan, its floor) when all pass. Refused with the stop's word."""
    mdl, ms, _cal = _house_stores(hass)
    m = ms.get_map(map_id) if ms is not None else None
    if mdl is None or not isinstance(m, dict) or (sig is not None and A.image_sig(m) != sig):
        raise Refused("plan_changed", SCALE_WORDS["plan_changed"])
    if _picture_size(m) is None:
        raise Refused("no_picture_size", SCALE_WORDS["no_picture_size"])
    if mdl.map_transform(map_id) is not None:
        raise Refused("already_placed", SCALE_WORDS["already_placed"])
    if _points_on(hass, map_id):
        raise Refused("points_on_plan", SCALE_WORDS["points_on_plan"])
    fid = str(floor_id or m.get("floor_id") or "")
    if fid not in _indoor(hass):
        raise Refused("floor_unknown", SCALE_WORDS["floor_unknown"], {"floors": [f["id"] for f in A.floor_order(mdl)]})
    return m, fid


def scale_preview(hass: HomeAssistant, map_id: str, measures: Any) -> dict[str, Any]:
    """What the screen shows while the person types: the plan's picture
    signature (sent back with Save), whether its floor is one of the house's,
    whether it may be measured here at all (`stop`), the unit a length typed
    with none was read in (`assumed`), and, once a length and two points are
    given, the plan's size from them. Writes nothing."""
    mdl, ms, _cal = _house_stores(hass)
    m = ms.get_map(map_id) if ms is not None else None
    size = _picture_size(m)
    out: dict[str, Any] = {"sig": A.image_sig(m) if isinstance(m, dict) else None, "size": list(size) if size else None,
                           "floor_known": isinstance(m, dict) and str(m.get("floor_id") or "") in _indoor(hass),
                           "floors": [f["id"] for f in A.floor_order(mdl)] if mdl is not None else []}
    try:
        scale_check(hass, map_id, None, (m or {}).get("floor_id") if out["floor_known"] else (out["floors"] or [None])[0])
        out["stop"] = None
    except Refused as err:
        out.update(stop=err.code, stop_message=err.message)
    measures = [x for x in measures if isinstance(x, dict)] if isinstance(measures, list) else []
    if measures:
        read = [G.length_read(x.get("text")) for x in measures]             # said as the person types, before both ends are clicked
        out["metres"], out["assumed"] = [r[0] for r in read], [r[1] for r in read]
        if None in out["metres"]:
            out["invalid"] = "Type a length such as 4.2 m, 420 cm or 13' 9\"."
        elif size and all(x.get("p1") is not None and x.get("p2") is not None for x in measures):
            try:
                got = scale_from_measures(size, measures, "guided", "")
                out.update(metres=got["metres"], across_m=got["across_m"], down_m=got["down_m"], odd=got["odd"])
            except Refused as err:
                out["invalid"] = err.message
    return out


async def settle_scale(hass: HomeAssistant, store: A.PlanAiStore) -> bool:
    """A scale save or undo cut short by a restart, finished or taken back
    (the ledger's pending mark). A save whose measurement is on the plan is
    finished (the house scale seeded if it still has none, the floor moved,
    `after` noted with the metres fingerprint the save took BEFORE it wrote:
    whatever was added since the restart is not taken as the save's own); one
    whose isn't never happened. An undo whose record is gone is finished (the
    floor put back); one whose isn't never happened. A floor is moved only
    while the plan is still on the floor the cut step left it on: one changed
    by hand meanwhile stays. In memory; the caller saves when it returns True."""
    if not A.writable(store.data):
        return False
    mdl, ms, _cal = _house_stores(hass)
    if mdl is None or ms is None:
        return False
    settled = False
    batches = store.data.get("scale_batches") or {}
    for bid, b in list(batches.items()):
        p = b.get("pending") if isinstance(b, dict) else None
        if not isinstance(p, dict):
            continue
        settled = True
        mid, t = b["map_id"], mdl.map_transform(b["map_id"])
        m = ms.get_map(mid)
        on = str((m or {}).get("floor_id") or "")
        if b.get("undo_of"):
            ob = batches.get(b["undo_of"]) or {}
            if t is None:                                     # the record went: the undo landed
                if m is not None and on != ob["before"]["floor"]["floor_id"] and on == (ob.get("after") or {}).get("floor_id"):
                    await _write_refile(hass, mid, ob["before"]["floor"], record=False)
                ob["undone_at"] = float(p.get("at") or time.time())
                b.pop("pending", None)
                A._bump(hass, "plan_build_settled:finished")  # noqa: SLF001
            else:                                             # it didn't: the save stands as it was
                # (the undo moves the floor only after the record went, so a floor other than the save's is the person's own)
                batches.pop(bid, None)
                A._bump(hass, "plan_build_settled:put_back")  # noqa: SLF001
            continue
        refs = (t or {}).get("reference_measurements") if isinstance(t, dict) else None
        if refs == p["refs"]:                                 # Measure's write landed: finish the rest
            try:
                await mdl.async_ensure_world_gauge(ms.data.get("maps") or [])
            except Exception:  # noqa: BLE001 — refusal, as in the writer
                _LOGGER.exception("PadSpan rooms helper: the house scale couldn't be seeded while settling a save")
            if m is not None and b["floor_id"] != on and on == b["before"]["floor"]["floor_id"]:
                await _write_refile(hass, mid, _floor_side(hass, m, b["floor_id"]))
            _scale_landed(hass, b, mid, p.get("fp"))
            b.pop("pending", None)
            A._bump(hass, "plan_build_settled:finished")  # noqa: SLF001
        else:                                                 # it didn't: nothing was written
            batches.pop(bid, None)
            A._bump(hass, "plan_build_settled:put_back")  # noqa: SLF001
    return settled


def _scale_landed(hass: HomeAssistant, b: dict[str, Any], map_id: str, fp: str | None) -> None:
    """A save's `after`: the plan's record, its floor, the house scale as they are now, and
    the metres fingerprint taken before the write (none: the undo is refused)."""
    mdl, ms, _cal = _house_stores(hass)
    m = ms.get_map(map_id) or {}
    b["after"] = {"t": copy.deepcopy(mdl.map_transform(map_id)), "floor_id": str(m.get("floor_id") or ""), "floor": _floor_side(hass, m),
                  "gauge": copy.deepcopy(mdl.data.get("world_gauge"))}
    b["fp"] = fp


async def scale_save(hass: HomeAssistant, store: A.PlanAiStore, *, map_id: str, sig: str, floor_id: str | None, measures: Any,
                     source: str, session: str | None = None) -> dict[str, Any]:
    """The rooms helper's scale for a plan that has none (design E.3): every
    check, a backup, the ledger pending, Measure's own write, the floor if it
    moved, the mark off. Piece 4 calls this unchanged with source
    plan_dimension or plan_dimension_corrected. The caller holds the plan
    store's lock."""
    from .ws_fabric import async_write_measured_transform  # noqa: PLC0415
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", "This plan store was saved by a newer PadSpan: update PadSpan to save.")
    if source not in SCALE_SOURCES:
        raise Refused("invalid", "Unknown measurement source.")
    if await settle_scale(hass, store):
        await _save(store)

    def stop(err: Refused) -> Refused:
        if err.code in SCALE_STOPS:
            A._bump(hass, f"plan_build_scale_save:{err.code}")  # noqa: SLF001
        return err

    try:
        m, fid = scale_check(hass, map_id, sig, floor_id)
        got = scale_from_measures(_picture_size(m), measures, source, time.strftime("%Y-%m-%d", time.gmtime()))   # type: ignore[arg-type]  (UTC, as Measure dates it)
    except Refused as err:
        raise stop(err) from None
    mdl, _ms, _cal = _house_stores(hass)
    await _metre_files_read(hass)
    backup_id = await _backup(hass, f"Before Let Claude draw your rooms set a plan's scale: {m.get('name') or 'plan'}", SCALE_SLOT)
    if not backup_id:
        raise stop(Refused("backup_failed", SCALE_WORDS["backup_failed"]))

    def as_now() -> tuple[dict, str, dict]:
        """Every check again and what the ledger keeps of the house as it is: with no await
        between this and the write, nothing (Measure takes no lock) can land between them."""
        m_, fid_ = scale_check(hass, map_id, sig, floor_id)
        return m_, fid_, {"floor": _floor_side(hass, m_), "gauge": copy.deepcopy(mdl.data.get("world_gauge")),
                          "gauge_set": FT.metre_gauge(mdl) is not None, "fp": _metres_fp(hass, map_id)}

    try:
        m, fid, now = as_now()                                      # the backup awaited: a hand edit may have landed meanwhile
    except Refused as err:
        raise stop(err) from None
    at = time.time()
    bid = "sb_" + secrets.token_hex(4)
    transform = {**got["transform"], "floor_id": fid}
    snap_store = copy.deepcopy(store.data)
    batch = {"map_id": map_id, "session": session, "source": source, "committed_at": at, "backup_id": backup_id, "floor_id": fid,
             "before": {"t": None, "floor": now["floor"], "gauge": now["gauge"], "gauge_set": now["gauge_set"]},
             "after": None, "fp": None, "undone_at": None, "undo_of": None,
             "pending": {"at": at, "refs": copy.deepcopy(transform["reference_measurements"]), "fp": now["fp"]}}
    store.data.setdefault("scale_batches", {})[bid] = batch
    store.trim()
    if not await store.async_checked_save():
        await _put_back(store, snap_store)
        raise Refused("save_failed", SCALE_WORDS["save_failed"])
    try:
        m, fid2, now = as_now()                                     # the ledger's save awaited: once more, then straight to the write
        if fid2 != fid:
            raise Refused("floor_unknown", SCALE_WORDS["floor_unknown"])
    except Refused as err:
        await _put_back(store, snap_store)
        raise stop(err) from None
    batch["before"].update(floor=now["floor"], gauge=now["gauge"], gauge_set=now["gauge_set"])   # as they are at the write (saved below)
    batch["pending"]["fp"] = now["fp"]
    await async_write_measured_transform(hass, map_id, transform)
    if fid != now["floor"]["floor_id"]:
        await _write_refile(hass, map_id, _floor_side(hass, m, fid))
    _scale_landed(hass, batch, map_id, now["fp"])
    batch.pop("pending", None)
    await _save(store)
    _invalidate(hass)
    seeded = not now["gauge_set"] and FT.metre_gauge(mdl) is not None
    A._mark_scale_saved(hass)  # noqa: SLF001
    _LOGGER.info("PadSpan rooms helper: plan %s measured (%s), %.2f m x %.2f m%s (backup %s)", map_id, source,
                 got["across_m"], got["down_m"], "; the house's metre scale was set from it" if seeded else "", backup_id)
    A._bump(hass, "plan_build_scale_save:done")  # noqa: SLF001
    return {"ok": True, "batch": bid, "backup_id": backup_id, "map_id": map_id, "floor_id": fid, "across_m": got["across_m"],
            "down_m": got["down_m"], "odd": got["odd"], "house_scale_set": seeded}


def scale_undo_info(store: A.PlanAiStore, map_id: str | None = None) -> dict[str, Any] | None:
    """The newest scale save of the helper still standing (of this plan, if given), or None."""
    live = [(bid, b) for bid, b in (store.data.get("scale_batches") or {}).items()
            if isinstance(b, dict) and not b.get("undo_of") and not b.get("undone_at") and not b.get("pending") and b.get("after")
            and (map_id is None or b.get("map_id") == map_id)]
    if not live:
        return None
    bid, b = max(live, key=lambda t: float(t[1].get("committed_at") or 0))
    return {"batch": bid, "map_id": b["map_id"], "at": b["committed_at"]}


async def scale_undo(hass: HomeAssistant, store: A.PlanAiStore, map_id: str | None = None) -> dict[str, Any]:
    """Take the helper's scale back (owner's choice, 2026-11-10): only while
    the plan's record and the house scale are exactly what the save wrote and
    nothing in metres was added since. A backup, the ledger pending, the floor
    back, then the record (and the house scale, only when this save set it)
    through ModelStore.async_unset_world_gauge. Otherwise refused, pointing to
    Measure. The helper's Undo runs rooms_undo first, then this. The caller
    holds the plan store's lock."""
    if not A.writable(store.data):
        raise Refused("plan_ai_newer", "This plan store was saved by a newer PadSpan: update PadSpan to undo.")
    if await settle_scale(hass, store):
        await _save(store)
    info = scale_undo_info(store, map_id)
    if info is None:
        raise Refused("nothing_to_undo", SCALE_WORDS["nothing_to_undo"])
    bid, b = info["batch"], store.data["scale_batches"][info["batch"]]
    mid = b["map_id"]
    mdl, ms, _cal = _house_stores(hass)
    after = b["after"]
    seeded = not b["before"]["gauge_set"]
    await _metre_files_read(hass)

    def same() -> bool:
        if mdl.map_transform(mid) != after["t"] or mdl.data.get("world_gauge") != after["gauge"] or _metres_fp(hass, mid) != b["fp"]:
            return False
        g = FT.metre_gauge(mdl)
        return not seeded or g is None or g.get("source_map_id") == mid

    if not same():
        A._bump(hass, "plan_build_scale_undo:changed_since")  # noqa: SLF001
        raise Refused("changed_since", SCALE_WORDS["changed_since"])
    m = ms.get_map(mid) or {"id": mid}
    backup_id = await _backup(hass, f"Before undoing the plan scale Let Claude draw your rooms set: {m.get('name') or 'plan'}", SCALE_SLOT)
    if not backup_id:
        A._bump(hass, "plan_build_scale_undo:failed")  # noqa: SLF001
        raise Refused("backup_failed", SCALE_WORDS["backup_failed"])
    if not same():
        A._bump(hass, "plan_build_scale_undo:changed_since")  # noqa: SLF001
        raise Refused("changed_since", SCALE_WORDS["changed_since"])
    at = time.time()
    snap_store = copy.deepcopy(store.data)
    ubid = "sb_" + secrets.token_hex(4)
    store.data["scale_batches"][ubid] = {"map_id": mid, "committed_at": at, "backup_id": backup_id, "undo_of": bid, "undone_at": None,
                                          "pending": {"at": at}}
    store.trim()
    if not await store.async_checked_save():
        await _put_back(store, snap_store)
        A._bump(hass, "plan_build_scale_undo:failed")  # noqa: SLF001
        raise Refused("save_failed", SCALE_WORDS["save_failed"])
    # The ledger's save awaited (Measure takes no lock): same() runs again inside
    # the compare and clear, with no await between it and the clear.
    gauge_expect = after["gauge"] if seeded and FT.metre_gauge(mdl) is not None else None
    if not await mdl.async_unset_world_gauge(mid, after["t"], gauge_expect, still=same):
        await _put_back(store, snap_store)
        A._bump(hass, "plan_build_scale_undo:changed_since")  # noqa: SLF001
        raise Refused("changed_since", SCALE_WORDS["changed_since"])
    on = str((ms.get_map(mid) or {}).get("floor_id") or "")
    if ms.get_map(mid) is not None and on != b["before"]["floor"]["floor_id"] and on == after["floor_id"]:   # a floor changed by hand stays
        await _write_refile(hass, mid, b["before"]["floor"], record=False)
    b["undone_at"] = at
    store.data["scale_batches"][ubid].pop("pending", None)
    await _save(store)
    _invalidate(hass)
    _LOGGER.info("PadSpan rooms helper: plan %s's scale taken back (backup %s)", mid, backup_id)
    A._bump(hass, "plan_build_scale_undo:done")  # noqa: SLF001
    return {"ok": True, "map_id": mid, "backup_id": backup_id, "house_scale_unset": gauge_expect is not None}
