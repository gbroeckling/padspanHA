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


async def _write_refile(hass: HomeAssistant, map_id: str, side: dict[str, Any]) -> str | None:
    """THE refile write: the map's floor and its storey in the stack (level
    and height), in one maps_store.async_update_map (with the legacy stack
    copy of the floor when the map has one, which radio_map.js still reads
    first), and the placement record's floor (ModelStore.async_set_map_floor,
    the whole record kept). The placement stays: floors share one footprint."""
    mdl, ms, _cal = _house_stores(hass)
    if mdl is None or ms is None or ms.get_map(map_id) is None:
        return "gone"
    stack = {k: side[s] for k, s in (("floor_id", "stack_floor"), ("z_level", "stack_level"), ("ceiling_height_m", "stack_height"))
             if side.get(s) is not None}
    extra = {"stack": stack} if stack else {}
    await ms.async_update_map(map_id, floor_id=side["floor_id"], **extra)
    if not await mdl.async_set_map_floor(map_id, side.get("t_floor") or side["floor_id"]):
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
    between the checks and the writes: it is never written over)."""
    if from_side is not None and not _at(_live(hass, e["map_id"]), e[from_side], e.get("kind")):
        return "changed"
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
    off its picture). The reanchor runs it again at the write."""
    owned = bad = 0
    for p in snap["calibration"]:
        if p.get("map_id") != map_id or p.get("x_m") is None:
            continue
        try:
            fr = G.to_frac(new_t, float(p["x_m"]), float(p["y_m"]))
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
    return {"item_id": iid, "kind": it["kind"], "map_id": mid, "name": it.get("name") or "", "before": before, "after": after,
            "pins_before": _pins(m), "cal_before": {str(p.get("id")): [p.get("x_frac"), p.get("y_frac")] for p in points}}


def _landed(store: A.PlanAiStore, bid: str, b: dict[str, Any], at: float) -> None:
    """A batch whose writes all landed: its items say so (a commit's committed,
    an undo's undone, and the saves it undid spent)."""
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
    can't be written leaves the batch pending, for next time. In memory; the
    caller saves when it returns True."""
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
            _landed(store, bid, b, float(p.get("at") or time.time()))
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
    return settled


async def _backup(hass: HomeAssistant, note: str) -> str | None:
    from .ws_backup import _auto_backup  # noqa: PLC0415
    return await _auto_backup(hass, note, [MODEL_STORE_KEY, MAPS_STORE_KEY, CALIBRATION_STORE_KEY], slot=LINEUP_SLOT, slot_keep=A.S1_BACKUPS_KEPT)


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
    _landed(store, ubid, ub, at)
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
