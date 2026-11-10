# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket commands for Add data via plans (plan_ai.py; experimental).

Every one is an administrator's (a plan may leave the house for a cloud AI),
and every one refuses while the master switch (Settings → AI → AI
map-building research) is off, while Live Aboard is off, and below Pro.

- plan_ai_plans: the placed plans there are to read, with their corners
  and signatures, and the AI Task that would read them (local or not).
- plan_ai_start: one session over the ticked plans; one at a time, one a
  minute, ten a day. It answers at once; the job runs on the server. Lights only
  on a plan the person says draws fixtures.
- plan_ai_status: the session (the latest, or one by id) with its
  suggestions, after the target and signature checks.
- plan_ai_cancel: the job stops between reads (the read in flight runs on).
- plan_ai_verdict: right (it looks right), failure (with a reason; a reject
  is remembered), later, or back (take that back). Written the moment it is
  clicked, to this store only.
- plan_ai_rejects_get / plan_ai_reject_forget: the remembered rejects.
- plan_ai_sessions_get: the sessions kept, in short, and the last batch.
- plan_ai_commit: keep suggestions as new or as corrections (a light's: its kind,
  never its position): the one thing that writes the 3D house from the AI's finds
  (plan_ai_write.py). All or none.
- plan_ai_undo: take a batch back; what changed since is left and reported.

Only plan_ai_commit and plan_ai_undo write the 3D file, and nothing here writes
the map or calibration.

Build from plans: line up (Stage 1, experimental; plan_ai.py's line-up): every
command an administrator's, refusing while the master switch, Build from plans,
Claude's unlock (Opus 5.5 or newer), Live Aboard or Pro is missing, except
plan_build_info, which Settings asks to know whether to draw the row.
- plan_build_info / plan_build_start {floor_id, map_ids} / plan_build_status /
  plan_build_cancel / plan_build_resume: one floor's session.
- plan_build_answer: the little help (confirm a dimension, tap a corner on two
  plans); reruns the local steps, no new read.
- plan_build_verdict: Not now, Wrong (one reason), back; written at the click.
- plan_build_refile: "This plan isn't Basement?": a refile item by hand, under
  the suggested refile's rules (only a plan with nothing drawn on it).
- plan_build_commit: save accepted items (one at a time, or a group that shifts
  nothing drawn on a plan) and plan_build_undo: take a whole session back,
  allowed whatever the AI Task. Both through plan_ai_write.py, the one writer;
  nothing here writes a placement, a floor, calibration or any metres itself.

Rooms from plans (Stage 2, experimental; plan_ai.py's rooms), on any floor with
a plan placed in metres (an unfinished line-up is a note): plan_build_rooms_start
/ _status / _resume (Stop is plan_build_cancel); plan_build_rooms_edit (merge,
separate, a new room's name, read 1, 2 or 3), kept on the session;
plan_build_rooms_read_again (a third read for a flagged room);
plan_build_rooms_check (the room score on the calibration spots, writing
nothing); plan_build_rooms_commit (Accept all for this floor: one save) and
plan_build_rooms_undo, both plan_ai_write.py's.
"""

from __future__ import annotations

import copy
import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import ai_usage as U
from . import plan_ai as A
from . import plan_ai_write as C
from . import ws_house3d_photo as P
from .const import DATA_MAPS, DATA_MODEL, DOMAIN
from .house3d_store import enabled as house3d_on
from .ws_common import _tier_at_least
from .ws_house3d import OFF_CODE, OFF_MESSAGE, PRO_MESSAGE, READ_CODE, READ_MESSAGE
from .ws_house3d_stairs import NOT_PLACED_CODE, PLANS_OFF_CODE, PLANS_OFF_MESSAGE

REV_CODE = C.REV_CODE


async def _refused(hass: HomeAssistant, connection, msg, prefix: str = "") -> A.PlanAiStore | None:
    """The gates every command shares; the store when they pass. `prefix`:
    the line-up's (experimental, design 7) before each refusal."""
    if not house3d_on(hass):
        connection.send_error(msg["id"], OFF_CODE, prefix + OFF_MESSAGE)
        return None
    if not _tier_at_least(hass, "pro"):
        connection.send_error(msg["id"], OFF_CODE, prefix + PRO_MESSAGE)
        return None
    if not A.enabled(hass):
        connection.send_error(msg["id"], PLANS_OFF_CODE, prefix + PLANS_OFF_MESSAGE)
        return None
    return await A.async_get_store(hass)


def _ai_info(hass: HomeAssistant, ai: dict[str, Any]) -> dict[str, Any]:
    """What the sheet says about where the plans go (live_aboard_photo.aiNote):
    the main AI Task's name and whether it is local, the backup's too, and
    whether the main one is away (ai_task says so only with a backup set)."""
    if not ai.get("ready"):
        return {"ready": False, "message": ai.get("message", "")}
    out = {"ready": True, "name": ai.get("name"), "local": ai.get("local"),
           "main_away": bool(ai.get("main_away")) or P._state_of(hass, ai["ai_task"]) == "unavailable"}  # noqa: SLF001
    if ai.get("backup"):
        out.update(backup=ai["backup"], backup_name=ai.get("backup_name"), backup_local=ai.get("backup_local"))
    return out


def _public(sess: dict[str, Any] | None, sid: str | None) -> dict[str, Any] | None:
    """A session as the sheet sees it: everything but the raw finds."""
    if not sess:
        return None
    return {"id": sid, **{k: v for k, v in sess.items() if k not in ("finds", "light_finds")}}


@websocket_api.websocket_command({"type": "padspan_ha/plan_ai_plans"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_plans(hass: HomeAssistant, connection, msg) -> None:
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    ai = P.ai_task(hass, with_backup=True)
    pls = A.plans(hass)
    job = A.running(hass)
    latest = store.session(None)
    connection.send_result(msg["id"], {
        "plans": pls, "ai": _ai_info(hass, ai), "kinds": list(A.KINDS),
        "running": job.sid if job else None,
        "latest": next((sid for sid, s in (store.data.get("sessions") or {}).items() if s is latest), None),
        "budget_s": A.PLAN_BUDGET_S, "start_blocked": A.start_allowed(hass)})


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_ai_start",
    vol.Required("map_ids"): [str],
    vol.Optional("kinds", default=["stairs", "railing"]): [str],
    vol.Optional("fixtures", default={}): {str: vol.In(("yes", "no", "unsure"))},
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_start(hass: HomeAssistant, connection, msg) -> None:
    """Start one session over the ticked plans, read by the AI Task, or by the
    backup when it is away, as ask_ai always does."""
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    # Under the plan store's lock: no job starts inside a commit or an undo (plan_ai_write.py).
    async with store.lock:
        why = A.start_allowed(hass)
        if why:
            connection.send_error(msg["id"], why, {"already_running": "A session is already reading your plans.",
                                                   "too_soon": "A session started less than a minute ago.",
                                                   "daily_cap": f"At most {A.STARTS_A_DAY} sessions a day."}[why])
            return
        kinds = [k for k in msg["kinds"] if k in A.KINDS]
        if not kinds or "stairs" not in kinds:
            connection.send_error(msg["id"], "bad_kinds", "Stairs are read on every plan.")
            return
        ai = P.ai_task(hass, with_backup=True)
        if not ai.get("ready"):
            A._bump(hass, "plan_ai_error:no_ai_task")  # noqa: SLF001
            await U.refused(hass, "no_ai", ai.get("ai_task"))
            connection.send_error(msg["id"], P.NO_AI_CODE, ai.get("message", ""))
            return
        by_id = {p["map_id"]: p for p in A.plans(hass)}
        want = list(dict.fromkeys(str(m) for m in msg["map_ids"]))
        missing = [m for m in want if m not in by_id]
        if not want or missing:
            connection.send_error(msg["id"], NOT_PLACED_CODE, "That floor plan isn't placed on its floor yet: place it in Mapping → 3D Stack first.")
            return
        fixtures = {m: msg["fixtures"].get(m, "unsure") for m in want} if "light" in kinds else {}
        for answer in fixtures.values():
            A._bump(hass, f"plan_ai_fixtures:{answer}")  # noqa: SLF001
        sid = A.start(hass, store, ai, [by_id[m] for m in want], kinds, A.frame_kind(hass, ai["ai_task"]), fixtures)
    connection.send_result(msg["id"], {"session": sid})


@websocket_api.websocket_command({"type": "padspan_ha/plan_ai_status", vol.Optional("session"): vol.Any(str, None)})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_status(hass: HomeAssistant, connection, msg) -> None:
    """The session, after the checks: on one that is not running, a changed
    plan or a changed target marks its suggestions stale."""
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    sid = msg.get("session") or None
    sess = store.session(sid)
    if sess is None:
        connection.send_result(msg["id"], {"session": None, "running": None})
        return
    if sid is None:
        sid = next((k for k, s in (store.data.get("sessions") or {}).items() if s is sess), None)
    job = A.running(hass)
    await store.async_sweep(job.sid if job else None)      # marked running with no job behind it: over
    if sess.get("status") != "running":
        from .house3d_store import ReadFailed, async_get_store as house_store  # noqa: PLC0415
        try:
            house = (await house_store(hass)).data
        except ReadFailed:
            house = None
        async with store.lock:
            sess = store.session(sid) or sess              # a commit that failed while this waited put back a whole new store
            settled = C.settle_pending(store, house)       # a commit a crash cut short: finished or taken back
            if A.check_session(hass, store, sess, house) or settled:
                await store.async_save()
    connection.send_result(msg["id"], {"session": _public(sess, sid), "running": job.sid if job else None, "undo": A.last_batch(store, sid), "record": A.track_record(store)})


@websocket_api.websocket_command({"type": "padspan_ha/plan_ai_cancel", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_cancel(hass: HomeAssistant, connection, msg) -> None:
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    job = A.running(hass)
    if job is None or job.sid != msg["session"]:
        connection.send_result(msg["id"], {"ok": False, "message": "That session isn't running."})
        return
    job.cancel = True
    connection.send_result(msg["id"], {"ok": True, "message": "Stopping after the read in flight: a Home Assistant service call can't be cut short. What was read so far is kept."})


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_ai_verdict",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("sug_id"): str,
    vol.Required("v"): vol.In((*A.VERDICTS, "back")),
    vol.Optional("why"): vol.Any(vol.In(A.FAILURE_WHY), None),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_verdict(hass: HomeAssistant, connection, msg) -> None:
    """Right (it looks right: stored and counted, nothing else), failure (one
    reason; a reject is remembered with it, and a stair's railing hint leaves
    the queue with it), later, or back to the queue (a failure's reject goes
    with it, and its hint comes back). Written at once: these describe the AI,
    not the house, and survive a lost page. New and correction stay in the
    editor's draft until plan_ai_commit."""
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        sess = store.session(msg["session"])
        if sess is None or not isinstance((sess.get("suggestions") or {}).get(msg["sug_id"]), dict):
            connection.send_error(msg["id"], "not_found", "That suggestion isn't here any more.")
            return
        if int(sess.get("rev") or 0) != msg["rev"]:
            connection.send_error(msg["id"], REV_CODE, "The session changed since you looked: it is reloaded.")
            return
        sug = sess["suggestions"][msg["sug_id"]]
        if sug.get("state") not in ("queued", "failure", "later", "right", "stale"):
            connection.send_error(msg["id"], "not_open", "That item isn't open for a verdict.")
            return
        v, kind, was = msg["v"], str(sug.get("kind") or "stairs"), sug.get("state")
        if v == "right" and was == "stale":
            connection.send_error(msg["id"], "not_open", "The plan or its stair changed since the read: read it again.")
            return
        rejects = store.data.setdefault("rejects", {})
        old = (sug.get("verdict") or {}).get("reject")
        if old:
            rejects.pop(old, None)
        if was in A.VERDICTS and was != v and not (sug.get("verdict") or {}).get("remembered"):
            A._bump(hass, f"plan_ai_taken_back:{kind}_{was}")  # noqa: SLF001
        if v == "back":
            sug["state"], sug["verdict"] = "queued", None
        else:
            why = msg.get("why") or ("nothing_there" if v == "failure" else None)
            sug["state"] = v
            sug["verdict"] = {"v": v, "at": time.time(), "why": why if v == "failure" else None}
            A._bump(hass, f"plan_ai_verdict:{kind}_{v}")  # noqa: SLF001
            if v == "failure":
                A._bump(hass, f"plan_ai_failure_why:{kind}_{why}")  # noqa: SLF001
                pl = next((p for p in sess.get("plans") or [] if p["map_id"] == sug.get("map_id")), {})
                geom = sug.get("geom") or {}
                x, y = float(geom.get("x_m") or 0.0), float(geom.get("y_m") or 0.0)
                key = A.reject_key(kind, sug.get("map_id") or "", pl.get("image_sig") or "", pl.get("place_sig") or "", x, y)
                rejects[key] = {"kind": kind, "map_id": sug.get("map_id"), "image_sig": pl.get("image_sig"),
                                "place_sig": pl.get("place_sig"), "floor_id": sug.get("floor_id"), "x_m": round(x, 2),
                                "y_m": round(y, 2), "why": why, "at": time.time()}
                sug["verdict"]["reject"] = key
        changed = []
        if kind == "stairs":
            changed = A.settle_rails(hass, sess, msg["sug_id"], why) if v == "failure" else A.unsettle_rails(hass, sess, msg["sug_id"])
        sess["rev"] = int(sess.get("rev") or 0) + 1
        store.trim()
        await store.async_save()
    connection.send_result(msg["id"], {"rev": sess["rev"], "suggestion": sug, "changed": changed, "record": A.track_record(store)})


@websocket_api.websocket_command({"type": "padspan_ha/plan_ai_rejects_get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_rejects_get(hass: HomeAssistant, connection, msg) -> None:
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    maps = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    names = {str(m.get("id") or ""): str(m.get("name") or "")[:80] for m in (maps.list_maps() if maps else [])}
    out = [{"key": k, **r, "plan": names.get(str(r.get("map_id") or ""), "")}
           for k, r in (store.data.get("rejects") or {}).items() if isinstance(r, dict)]
    connection.send_result(msg["id"], {"rejects": out})


@websocket_api.websocket_command({"type": "padspan_ha/plan_ai_reject_forget", vol.Required("key"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_reject_forget(hass: HomeAssistant, connection, msg) -> None:
    """Un-ignore: the reject goes (a failure taken back, counted apart), and a
    suggestion it had marked wrong, in any kept session, is queued again, with
    its railing hint."""
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        reject = (store.data.get("rejects") or {}).pop(msg["key"], None)
        gone = reject is not None
        changed = gone
        if gone:
            A._bump(hass, f"plan_ai_taken_back:{(reject or {}).get('kind') or 'stairs'}_failure")  # noqa: SLF001
        for sess in (store.data.get("sessions") or {}).values():
            touched = False
            for sug in ((sess.get("suggestions") or {}) if isinstance(sess, dict) else {}).values():
                if isinstance(sug, dict) and (sug.get("verdict") or {}).get("reject") == msg["key"] and sug.get("state") == "failure":
                    sug["state"], sug["verdict"] = "queued", None
                    A.unsettle_rails(hass, sess, sug.get("id"))
                    touched = True
            if touched:
                sess["rev"] = int(sess.get("rev") or 0) + 1
                changed = True
        if changed:
            await store.async_save()
    connection.send_result(msg["id"], {"ok": gone})


@websocket_api.websocket_command({"type": "padspan_ha/plan_ai_sessions_get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_sessions_get(hass: HomeAssistant, connection, msg) -> None:
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    out = []
    for sid, s in (store.data.get("sessions") or {}).items():
        if not isinstance(s, dict):
            continue
        sugs = [x for x in (s.get("suggestions") or {}).values() if isinstance(x, dict)]
        out.append({"id": sid, "started_at": s.get("started_at"), "finished_at": s.get("finished_at"), "status": s.get("status"),
                    "error": s.get("error"), "plans": len(s.get("plans") or []), "spent_s": s.get("spent_s"),
                    "suggestions": len(sugs), "states": {st: sum(1 for x in sugs if x.get("state") == st)
                                                         for st in sorted({str(x.get("state")) for x in sugs})}})
    out.sort(key=lambda s: float(s.get("started_at") or 0), reverse=True)
    connection.send_result(msg["id"], {"sessions": out, "undo": A.last_batch(store)})


async def _write(hass: HomeAssistant, connection, msg, store: A.PlanAiStore, what, counter: str) -> None:
    """One of the two writers, with the 3D store's lock and then the plan
    store's held throughout (never the other way about), so nothing lands
    between its checks and its writes. A refusal with a list is an ok: false
    answer; any other, a websocket error. Nothing was written either way."""
    from .house3d_store import ReadFailed, async_get_store as house_store  # noqa: PLC0415
    try:
        house = await house_store(hass)
    except ReadFailed:
        connection.send_error(msg["id"], READ_CODE, READ_MESSAGE)
        return
    try:
        async with house.lock, store.lock:
            answer = await what(house)
    except C.Refused as err:
        A._bump(hass, f"{counter}:{err.code}")  # noqa: SLF001
        if err.extra is None:
            connection.send_error(msg["id"], err.code, err.message)
        else:
            connection.send_result(msg["id"], {"ok": False, "code": err.code, "message": err.message, **err.extra})
        return
    connection.send_result(msg["id"], answer)


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_ai_commit",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("items"): [dict],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_commit(hass: HomeAssistant, connection, msg) -> None:
    """Keep suggestions: items [{sug_id, v: new|correction, final (the draft's
    piece), rail: {side, style} (a railing), target (a stair it was named near)}].
    A light's item is {sug_id, v: correction}: the kind is the symbol the AI read."""
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    await _write(hass, connection, msg, store, lambda house: C.commit(hass, store, house, msg["session"], msg["rev"], msg["items"]), "plan_ai_commit")


@websocket_api.websocket_command({"type": "padspan_ha/plan_ai_undo", vol.Required("batch_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_undo(hass: HomeAssistant, connection, msg) -> None:
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    await _write(hass, connection, msg, store, lambda house: C.undo(hass, store, house, msg["batch_id"]), "plan_ai_undo")


WS_COMMANDS = (ws_plan_ai_plans, ws_plan_ai_start, ws_plan_ai_status, ws_plan_ai_cancel, ws_plan_ai_verdict,
               ws_plan_ai_rejects_get, ws_plan_ai_reject_forget, ws_plan_ai_sessions_get, ws_plan_ai_commit, ws_plan_ai_undo)


# ══ Build from plans: line up (Stage 1; experimental) ═══════════════════════
# plan_build_info answers an administrator even while locked (Settings asks it
# to know whether to draw the row, and the undo it keeps reachable), and so does
# plan_build_undo under the master switch (form q3); every other command refuses
# while the master switch, this switch, Claude's unlock, Live Aboard or Pro is
# missing. The saves and the undo are plan_ai_write.py's (the one writer).

LOCKED_CODE, BUILD_OFF_CODE = "plan_build_locked", "plan_build_off"
PREFIX = C.LP


async def _settled(hass: HomeAssistant, store: A.PlanAiStore) -> None:
    """A save or an undo cut short is finished or put back before anything else
    looks at the line-ups (plan_ai_write.settle_lineups), under the store's lock."""
    if not any(isinstance(b, dict) and b.get("pending") for b in (store.data.get("lineup_batches") or {}).values()):
        return
    async with store.lock:
        if await C.settle_lineups(hass, store):
            await store.async_save()


async def _build_refused(hass: HomeAssistant, connection, msg) -> A.PlanAiStore | None:
    """The gates every line-up command shares (design 4); the store when they pass."""
    store = await _refused(hass, connection, msg, PREFIX)
    if store is None:
        return None
    await _settled(hass, store)
    if not A.build_switch(hass):
        connection.send_error(msg["id"], BUILD_OFF_CODE, PREFIX + "it is off: turn it on in Settings → AI.")
        return None
    u = A.unlock(hass)
    if not u.get("ok"):
        A.note_stop(hass, store.data, None, "locked")
        await store.async_save()
        connection.send_error(msg["id"], LOCKED_CODE, PREFIX + A.STOPS["locked"][0] + " " + A.STOPS["locked"][1])
        return None
    return store


def _floors(hass: HomeAssistant, store: A.PlanAiStore, snap: dict) -> list[dict[str, Any]]:
    """Each indoor floor, lowest first, with its plans and its last line-up."""
    out = []
    for f in snap["floors"]:
        mids = A.floor_plans(snap, f["id"])
        last = max(((sid, s) for sid, s in (store.data.get("lineups") or {}).items() if isinstance(s, dict) and s.get("floor_id") == f["id"]),
                   key=lambda t: float(t[1].get("started_at") or 0), default=None)
        out.append({"id": f["id"], "name": f.get("name"), "plans": [{"map_id": m, "name": snap["plans"][m]["name"], "drawn": snap["plans"][m]["drawn"],
                                                                     "gauge": m == snap["gauge_map"], "refs": snap["plans"][m]["refs"],
                                                                     "est_usd": A.plan_estimate(hass, snap["plans"][m]["size"])} for m in mids],
                    "last": {"session": last[0], "at": last[1].get("finished_at") or last[1].get("started_at"), "status": last[1].get("status")} if last else None})
    return out


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_info"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_info(hass: HomeAssistant, connection, msg) -> None:
    """Whether the line-up can be offered here (design 1): the unlock, the
    switch and the effective rule, the floors with their plans, this house's
    stops (design 14). Answers while locked: the row is drawn only when ok."""
    u = A.unlock(hass)
    on_master = A.enabled(hass)
    out: dict[str, Any] = {"unlock": {k: u.get(k) for k in ("ok", "why", "display")}, "master": on_master,
                           "switch": A.build_switch(hass), "on": on_master and A.build_switch(hass) and bool(u.get("ok")),
                           "floors": [], "stall": None, "running": None, "undo": None}
    if on_master:
        A._bump_once(hass, f"plan_build_unlock:{A.unlock_event(u)}")  # noqa: SLF001
        if u.get("ok"):
            A._bump_once(hass, "plan_build_setting:shown")  # noqa: SLF001
        # The last session's undo, whatever the AI Task (form q3), after a restart too.
        store = await A.async_get_store(hass)
        await _settled(hass, store)
        und = A.lineup_undo_info(store)
        model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        names = {str(f.get("id")): f.get("name") for f in (model.floors() if model is not None else [])}
        if und:
            out["undo"] = {**und, "floor_name": names.get(str(und.get("floor_id"))) or und.get("floor_id")}
        await _rooms_settled(hass, store)
        rund = A.rooms_undo_info(store)                # the rooms' undo too (Stage 2), whatever the AI Task
        if rund:
            out["rooms_undo"] = {**rund, "floor_name": names.get(str(rund.get("floor_id"))) or rund.get("floor_id")}
    if out["on"] and house3d_on(hass) and _tier_at_least(hass, "pro"):
        store = await A.async_get_store(hass)
        if A.sweep_abandoned(hass, store):
            await store.async_save()
        snap = A.house_snapshot(hass)
        job = A.running(hass)
        out.update(floors=_floors(hass, store, snap), stall=A.stall_summary(store), gauge=snap["gauge"],
                   running=job.sid if job and store.lineup(job.sid) else None, start_blocked=A.start_allowed(hass),
                   rooms=_rooms_floors(hass, store, snap), rooms_running=job.sid if job and store.rooms_session(job.sid) else None)
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_start",
    vol.Required("floor_id"): str,
    vol.Optional("map_ids"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_start(hass: HomeAssistant, connection, msg) -> None:
    """One floor's line-up (design 3.1's preconditions; one AI job per house,
    one a minute, ten a day). It answers at once; the job runs on the server."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        why = A.start_allowed(hass)
        if why:
            connection.send_error(msg["id"], why, PREFIX + {"already_running": "a session is already reading your plans.",
                                                            "too_soon": "a session started less than a minute ago.",
                                                            "daily_cap": f"at most {A.STARTS_A_DAY} sessions a day."}[why])
            return
        snap = A.house_snapshot(hass)
        if not snap["gauge"]:
            A.note_stop(hass, store.data, None, "no_metre_scale")
            await store.async_save()
            connection.send_error(msg["id"], "no_metre_scale", PREFIX + " ".join(A.STOPS["no_metre_scale"]))
            return
        on_floor = A.floor_plans(snap, msg["floor_id"])
        want = [m for m in (msg.get("map_ids") or on_floor) if m in on_floor]
        if not on_floor or not want:
            A.note_stop(hass, store.data, None, "not_placed")
            await store.async_save()
            connection.send_error(msg["id"], NOT_PLACED_CODE, PREFIX + " ".join(A.STOPS["not_placed"]))
            return
        u = A.unlock(hass)
        sess = A.new_lineup(u, snap, msg["floor_id"], want, A.earlier_reads(store))
        sid = A.start_lineup(hass, store, sess)
        await store.async_save()
    connection.send_result(msg["id"], {"session": sid})


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_status", vol.Optional("session"): vol.Any(str, None)})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_status(hass: HomeAssistant, connection, msg) -> None:
    """A line-up (by id, or the newest), its plans' and items' signatures
    checked: an item whose plan moved or changed since is stale."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    job = A.running(hass)
    await store.async_sweep(job.sid if job else None)
    sid = msg.get("session")
    if not sid:
        sid = max(((k, s) for k, s in (store.data.get("lineups") or {}).items() if isinstance(s, dict)),
                  key=lambda t: float(t[1].get("started_at") or 0), default=(None, None))[0]
    sess = store.lineup(sid)
    if sess is not None and sess.get("status") != "running":
        snap = A.house_snapshot(hass)
        changed = False
        for it in (sess.get("items") or {}).values():
            if it.get("state") in ("open", "same", "info", "not_now", "refused", "undone") and A.item_now(snap, sess, it):
                it["state"] = "stale"
                A._bump(hass, f"plan_build_item:{it['kind']}_stale")  # noqa: SLF001
                changed = True
        if changed:
            sess["rev"] = int(sess.get("rev") or 0) + 1
            await store.async_save()
    connection.send_result(msg["id"], {"session": A.lineup_public(sess, sid), "running": job.sid if job else None})


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_cancel", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_cancel(hass: HomeAssistant, connection, msg) -> None:
    store = await _refused(hass, connection, msg, PREFIX)
    if store is None:
        return
    job = A.running(hass)
    if job is None or job.sid != msg["session"]:
        connection.send_result(msg["id"], {"ok": False, "message": PREFIX + "that session isn't running."})
        return
    job.cancel = True
    connection.send_result(msg["id"], {"ok": True, "message": PREFIX + "stopping after the read in flight. What was read so far is kept; Resume reads the rest."})


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_resume", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_resume(hass: HomeAssistant, connection, msg) -> None:
    """A session that stopped short reads the rest (design 8, 14)."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        sess = store.lineup(msg["session"])
        stop = A.resume_refused(hass, store, sess)
        if stop == "not_open":
            connection.send_error(msg["id"], "not_open", PREFIX + "that session has nothing to resume.")
            return
        if stop:                                       # a plan or the AI changed under it: said, and no start spent
            await store.async_save()
            connection.send_error(msg["id"], stop, PREFIX + " ".join(A.STOPS[stop]))
            return
        why = A.start_allowed(hass)
        if why == "already_running":
            connection.send_error(msg["id"], why, PREFIX + "a session is already reading your plans.")
            return
        A.resume_lineup(hass, store, msg["session"])
        await store.async_save()
    connection.send_result(msg["id"], {"session": msg["session"]})


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_answer",
    vol.Required("session"): str,
    vol.Required("question_id"): str,
    vol.Required("answer"): vol.Any("yes", "skip", {vol.Required("metres"): vol.Coerce(float)}, {vol.Required("taps"): [[vol.Coerce(float)]]}),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_answer(hass: HomeAssistant, connection, msg) -> None:
    """The little help (design 3.5): the answer reruns the local steps only,
    no new read, and only for the plan it is about. It answers at once; the
    rerun is the house's one job (Stop reaches it), outside the store's lock."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        if A.running(hass) is not None:
            connection.send_error(msg["id"], "already_running", PREFIX + "wait for the reading to finish.")
            return
        sess = store.lineup(msg["session"])
        if sess is None:
            connection.send_error(msg["id"], "not_found", PREFIX + "that session isn't here any more.")
            return
        word = A.apply_answer(sess, msg["question_id"], msg["answer"])
        if word in ("not_open", "bad_answer"):
            connection.send_error(msg["id"], word, PREFIX + ("that question isn't open." if word == "not_open" else "that answer can't be used."))
            return
        A._bump(hass, f"plan_build_help:{word}")  # noqa: SLF001
        A.stop_resolved(hass, sess, ("help_unanswered", "fit_rejected"))
        q = next(q for q in sess.get("questions") or [] if q.get("id") == msg["question_id"])
        n = len(sess.get("plans") or [])
        sess.update(status="running", error=None, finished_at=None, progress={"plan": n, "of": n, "name": q.get("name") or "", "step": "measure"},
                    rev=int(sess.get("rev") or 0) + 1)
        A.start_answer(hass, store, msg["session"], {q["map_id"]})
        await store.async_save()
    connection.send_result(msg["id"], {"session": A.lineup_public(store.lineup(msg["session"]), msg["session"])})


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_verdict",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("item_id"): str,
    vol.Required("v"): vol.In(("not_now", "wrong", "back")),
    vol.Optional("why"): vol.Any(vol.In(A.WRONG_WHY), None),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_verdict(hass: HomeAssistant, connection, msg) -> None:
    """Not now, Wrong (one reason) or back: written at the click; they
    describe the AI, not the house (design 4)."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        sess = store.lineup(msg["session"])
        it = ((sess or {}).get("items") or {}).get(msg["item_id"])
        if not isinstance(it, dict):
            connection.send_error(msg["id"], "not_found", PREFIX + "that item isn't here any more.")
            return
        if int(sess.get("rev") or 0) != msg["rev"]:
            connection.send_error(msg["id"], REV_CODE, PREFIX + "the session changed since you looked: it is reloaded.")
            return
        if sess.get("status") == "running":            # its items are made again when the reading or re-measuring ends
            connection.send_error(msg["id"], "already_running", PREFIX + "wait for the reading to finish.")
            return
        if it.get("state") in ("stale", "refused"):
            connection.send_error(msg["id"], "not_open", PREFIX + "that item can't be judged now.")
            return
        if it.get("state") == "committed":
            connection.send_error(msg["id"], "not_open", PREFIX + "that item is saved: Undo this line-up session takes it back.")
            return
        v = msg["v"]
        if v == "back":
            was = (it.get("verdict") or {}).get("was") or "open"
            it["state"], it["verdict"] = was, None
        else:
            why = msg.get("why") or ("cant_tell" if v == "wrong" else None)
            it["verdict"] = {"v": v, "why": why, "at": time.time(), "was": (it.get("verdict") or {}).get("was") or it.get("state")}
            it["state"] = v
            A._bump(hass, f"plan_build_item:{it['kind']}_{v}")  # noqa: SLF001
            if v == "wrong":
                A._bump(hass, f"plan_build_wrong_why:{why}")  # noqa: SLF001
                if it["kind"] == "refile":
                    A._bump(hass, "plan_build_refile:wrong")  # noqa: SLF001
        sess["rev"] = int(sess.get("rev") or 0) + 1
        await store.async_save()
    connection.send_result(msg["id"], {"rev": sess["rev"], "item": it})


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_refile",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("map_id"): str,
    vol.Required("to_floor_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_refile(hass: HomeAssistant, connection, msg) -> None:
    """"This plan isn't Basement?" (design 2, by hand): the same refile item a
    suggestion makes, under the same rules, accepted and saved like any other.
    A plan with things drawn on it is refused and says what; nothing is written."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        sess = store.lineup(msg["session"])
        if sess is None:
            connection.send_error(msg["id"], "not_found", PREFIX + "that session isn't here any more.")
            return
        if int(sess.get("rev") or 0) != msg["rev"]:
            connection.send_error(msg["id"], REV_CODE, PREFIX + "the session changed since you looked: it is reloaded.")
            return
        if sess.get("status") == "running":
            connection.send_error(msg["id"], "already_running", PREFIX + "wait for the reading to finish.")
            return
        word, it = A.refile_by_hand(sess, A.house_snapshot(hass), msg["map_id"], msg["to_floor_id"])
        if word in ("not_found", "invalid"):
            connection.send_error(msg["id"], word, PREFIX + ("that plan isn't on this floor any more." if word == "not_found" else "pick another indoor floor."))
            return
        if word == "measured_plan_protected":
            A.note_stop(hass, store.data, sess, word, msg["map_id"])
            sess["rev"] = int(sess.get("rev") or 0) + 1
            await store.async_save()
            connection.send_result(msg["id"], {"ok": False, "code": word, "message": PREFIX + " ".join(A.STOPS[word]), "rev": sess["rev"]})
            return
        A._bump(hass, "plan_build_refile:by_hand")  # noqa: SLF001
        iid = f"refile_{msg['map_id']}"
        sess.setdefault("items", {})[iid] = it
        if word == "refile_refused":
            A._bump(hass, "plan_build_refile:refused_drawn")  # noqa: SLF001
            A.note_stop(hass, store.data, sess, word, msg["map_id"])
        else:
            A._bump(hass, "plan_build_item:refile_shown")  # noqa: SLF001
        sess["rev"] = int(sess.get("rev") or 0) + 1
        await store.async_save()
    connection.send_result(msg["id"], {"ok": word == "ok", "code": word, "message": PREFIX + " ".join(A.STOPS["refile_refused"]) if word != "ok" else "",
                                       "rev": sess["rev"], "item_id": iid, "item": it, "session": A.lineup_public(sess, msg["session"])})


async def _lineup_write(hass: HomeAssistant, connection, msg, store: A.PlanAiStore, what) -> None:
    """A line-up save or undo (plan_ai_write.py) with the plan store's lock held
    throughout. A refusal with a list is an ok: false answer (the session's new
    rev with it); any other, a websocket error. Nothing was written either way."""
    try:
        async with store.lock:
            answer = await what()
    except C.Refused as err:
        if err.extra is None:
            connection.send_error(msg["id"], err.code, err.message)
        else:
            connection.send_result(msg["id"], {"ok": False, "code": err.code, "message": err.message, **err.extra})
        return
    sid = msg["session"]
    connection.send_result(msg["id"], {**answer, "session": A.lineup_public(store.lineup(sid), sid)})


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_commit",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("items"): [str],
    vol.Optional("group", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_commit(hass: HomeAssistant, connection, msg) -> None:
    """Save accepted items (design 3.8): one at a time, or `group` for items
    that shift nothing drawn on their plans (form q8). A backup first; the
    placement through the Align editor's own writer; nothing else."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    await _lineup_write(hass, connection, msg, store, lambda: C.lineup_commit(hass, store, msg["session"], msg["rev"], msg["items"], bool(msg.get("group"))))


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_undo", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_undo(hass: HomeAssistant, connection, msg) -> None:
    """Undo a whole line-up session (design 3.8). Allowed while locked, with
    Build from plans off, below Pro or with Live Aboard off (form q3): only
    the master switch, under which Settings → AI shows it, and an administrator."""
    if not A.enabled(hass):
        connection.send_error(msg["id"], PLANS_OFF_CODE, PREFIX + PLANS_OFF_MESSAGE)
        return
    store = await A.async_get_store(hass)
    await _settled(hass, store)
    await _lineup_write(hass, connection, msg, store, lambda: C.lineup_undo(hass, store, msg["session"]))


WS_COMMANDS = WS_COMMANDS + (ws_plan_build_info, ws_plan_build_start, ws_plan_build_status, ws_plan_build_cancel, ws_plan_build_resume,
                             ws_plan_build_answer, ws_plan_build_verdict, ws_plan_build_refile, ws_plan_build_commit, ws_plan_build_undo)


# ══ Build from plans: rooms, doors, windows and stairs (Stage 2; experimental) ══
# Design 5. The same gates as the line-up's; the one write and its undo are
# plan_ai_write.py's (rooms_commit, rooms_undo), with the 3D store's lock and
# then the plan store's held. plan_build_rooms_undo, like plan_build_undo,
# answers under the master switch whatever the AI Task.

RP = C.RP


async def _rooms_settled(hass: HomeAssistant, store: A.PlanAiStore) -> None:
    """A rooms save or undo cut short is finished or put back first (plan_ai_write.settle_rooms)."""
    if not any(isinstance(b, dict) and b.get("pending") for b in (store.data.get("room_batches") or {}).values()):
        return
    from .house3d_store import async_get_store as house_store  # noqa: PLC0415
    try:
        house = await house_store(hass)
    except Exception:  # noqa: BLE001 — the 3D file can't be read now: settled next time
        return
    async with house.lock, store.lock:
        if await C.settle_rooms(hass, store, house):
            await store.async_save()


def _areas(hass: HomeAssistant, rooms: dict[str, Any], floor_id: str) -> list[str]:
    """Home Assistant's areas that aren't a room yet, this floor's first: the
    names offered for a new room (design 5: a name the person picks)."""
    try:
        from homeassistant.helpers import area_registry  # noqa: PLC0415
        areas = list(area_registry.async_get(hass).async_list_areas())
    except Exception:  # noqa: BLE001
        return []
    taken = {str(n).lower() for n in rooms}
    free = [a for a in areas if str(getattr(a, "name", "") or "").lower() not in taken and getattr(a, "name", None)]
    free.sort(key=lambda a: (getattr(a, "floor_id", None) != floor_id, str(a.name).lower()))
    return [str(a.name) for a in free][:60]


def _rooms_answer(hass: HomeAssistant, store: A.PlanAiStore, sid: str | None) -> dict[str, Any]:
    sess = store.rooms_session(sid)
    job = A.running(hass)
    out: dict[str, Any] = {"session": A.rooms_public(sess, sid), "running": job.sid if job else None}
    if sess is not None:
        snap = A.house_snapshot(hass)
        out["areas"] = _areas(hass, snap["rooms"], sess.get("floor_id"))
        out["undo"] = A.rooms_undo_info(store, sid)
    return out


def _rooms_floors(hass: HomeAssistant, store: A.PlanAiStore, snap: dict) -> dict[str, dict[str, Any]]:
    """Per indoor floor: whether its rooms can be read (a plan placed in metres), its plans (each with what the
    line-up says of it, ticked or not) and the estimate, the line-up's note, its last rooms session."""
    out = {}
    for f in snap["floors"]:
        ready = A.rooms_ready(store, snap, f["id"])
        last = max(((sid, s) for sid, s in (store.data.get("rooms") or {}).items() if isinstance(s, dict) and s.get("floor_id") == f["id"]),
                   key=lambda t: float(t[1].get("started_at") or 0), default=None)
        why_of = {o["map_id"]: o["why"] for o in ready["others"]}
        out[f["id"]] = {"ready": ready["ok"], "why": ready["why"], "note": ready["note"], "lined_up": ready["lined_up"],
                        "plans": [{"map_id": m, "name": snap["plans"][m]["name"], "est_usd": A.rooms_estimate(hass, [snap["plans"][m]["size"]]),
                                   "lineup": why_of.get(m, "lined_up"), "tick": m in ready["suggest"]} for m in ready["plans"]],
                        "others": ready["others"],
                        "last": {"session": last[0], "at": last[1].get("finished_at") or last[1].get("started_at"), "status": last[1].get("status")} if last else None}
    return out


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_rooms_start",
    vol.Required("floor_id"): str,
    vol.Optional("map_ids"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_start(hass: HomeAssistant, connection, msg) -> None:
    """One floor's rooms read (design 5): only its lined-up plans, two reads each.
    It answers at once; the job runs on the server."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        why = A.start_allowed(hass)
        if why:
            connection.send_error(msg["id"], why, RP + {"already_running": "a session is already reading your plans.",
                                                        "too_soon": "a session started less than a minute ago.",
                                                        "daily_cap": f"at most {A.STARTS_A_DAY} sessions a day."}[why])
            return
        snap = A.house_snapshot(hass)
        ready = A.rooms_ready(store, snap, msg["floor_id"])
        want = [m for m in (msg.get("map_ids") or ready["suggest"]) if m in ready["plans"]]
        if not ready["ok"] or not want:                 # the one refusal: no plan placed in metres to read (data, not accuracy)
            A.note_stop(hass, store.data, None, "not_placed")
            await store.async_save()
            connection.send_error(msg["id"], NOT_PLACED_CODE, RP + " ".join(A.STOPS["not_placed"]))
            return
        sess = A.new_rooms_session(A.unlock(hass), snap, msg["floor_id"], ready, want)
        sess["lineup_note"] = ready["note"]             # said on the session: "Line-up not finished on this floor…"
        sid = A.start_rooms(hass, store, sess)
        await store.async_save()
    connection.send_result(msg["id"], {"session": sid})


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_rooms_status", vol.Optional("session"): vol.Any(str, None)})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_status(hass: HomeAssistant, connection, msg) -> None:
    """A rooms session (by id, or the newest) with its proposal, and the names a new room may take."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    await _rooms_settled(hass, store)
    job = A.running(hass)
    await store.async_sweep(job.sid if job else None)
    sid = msg.get("session")
    if not sid:
        sid = max(((k, s) for k, s in (store.data.get("rooms") or {}).items() if isinstance(s, dict)),
                  key=lambda t: float(t[1].get("started_at") or 0), default=(None, None))[0]
    connection.send_result(msg["id"], _rooms_answer(hass, store, sid))


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_rooms_resume", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_resume(hass: HomeAssistant, connection, msg) -> None:
    """A rooms session that stopped short reads the rest."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        sess = store.rooms_session(msg["session"])
        stop = A.rooms_resume_refused(hass, store, sess)
        if stop == "not_open":
            connection.send_error(msg["id"], "not_open", RP + "that session has nothing to resume.")
            return
        if stop:
            await store.async_save()
            connection.send_error(msg["id"], stop, RP + " ".join(A.STOPS[stop]))
            return
        if A.start_allowed(hass) == "already_running":
            connection.send_error(msg["id"], "already_running", RP + "a session is already reading your plans.")
            return
        A.resume_rooms(hass, store, msg["session"])
        await store.async_save()
    connection.send_result(msg["id"], {"session": msg["session"]})


_EDIT_WORDS = {"not_found": "that isn't in the proposal any more.", "invalid": "pick two or more rooms or spaces.",
               "two_rooms": "two of your rooms can't be merged here: that would remove one. Merge spaces into one room.",
               "depends": "a later merge took this one in: separate that one first.",
               "apart": "those don't touch (more than a metre apart), so they can't be one outline: nothing was merged. Merge only what touches."}


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_rooms_edit",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("op"): vol.In(("merge", "separate", "space", "pick")),
    vol.Optional("parts"): [str],
    vol.Optional("merge"): int,
    vol.Optional("space"): str,
    vol.Optional("name"): vol.Any(str, None),
    vol.Optional("room"): str,
    vol.Optional("read"): int,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_edit(hass: HomeAssistant, connection, msg) -> None:
    """The person's edit of the proposal (design 5): merge rooms and spaces
    into one, separate a merge, name a space as a new room (or leave it out),
    pick read 1 or 2 for a room. Kept on the session, nothing written to the
    house; the proposal is worked out again."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        sess = store.rooms_session(msg["session"])
        if sess is None:
            connection.send_error(msg["id"], "not_found", RP + "that session isn't here any more.")
            return
        if int(sess.get("rev") or 0) != msg["rev"]:
            connection.send_error(msg["id"], REV_CODE, RP + "the session changed since you looked: it is reloaded.")
            return
        if sess.get("status") == "running" or not sess.get("proposal"):
            connection.send_error(msg["id"], "already_running", RP + "wait for the reading to finish.")
            return
        snap0 = A.house_snapshot(hass)
        was = copy.deepcopy(sess.get("edits"))
        word = A.apply_rooms_edit(sess, snap0, msg["op"], {k: msg[k] for k in ("parts", "merge", "space", "name", "room", "read") if k in msg})
        if word != "ok":
            if word == "name_taken":
                A.note_stop(hass, store.data, sess, "name_taken")
                sess["rev"] = int(sess.get("rev") or 0) + 1
                await store.async_save()
            connection.send_error(msg["id"], word, RP + (" ".join(A.STOPS["name_taken"]) if word == "name_taken" else _EDIT_WORDS.get(word, "that can't be done.")))
            return
        snap, house, points, barriers = await A.rooms_inputs(hass)
        try:
            prop = await hass.async_add_executor_job(A.rooms_proposal, copy.deepcopy(sess), snap, house, points, barriers)
        except Exception:  # noqa: BLE001 — an edit that can't be worked out is taken back
            sess["edits"] = was
            connection.send_error(msg["id"], "invalid", RP + "that edit couldn't be worked out, so it was taken back.")
            return
        new_merge = (sess["edits"].get("merges") or [{}])[-1].get("id") if msg["op"] == "merge" else None
        if new_merge is not None and new_merge in (prop.get("apart") or []):
            sess["edits"] = was                    # a choice, not a silent drop: said, and nothing changes (review B8)
            connection.send_error(msg["id"], "apart", RP + _EDIT_WORDS["apart"])
            return
        sess["proposal"] = prop
        if msg["op"] == "separate":
            A._bump(hass, "plan_build_merge:separated")  # noqa: SLF001
        sess["rev"] = int(sess.get("rev") or 0) + 1
        await store.async_save()
    connection.send_result(msg["id"], _rooms_answer(hass, store, msg["session"]))


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_rooms_read_again",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("room"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_read_again(hass: HomeAssistant, connection, msg) -> None:
    """Read again (design 5): a third whole read of the plans a flagged room was
    read on; two reads out of three decide it. The same reader, counted by the
    AI credit tracker; it answers at once, the job runs on the server."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    async with store.lock:
        sess = store.rooms_session(msg["session"])
        if sess is None:
            connection.send_error(msg["id"], "not_found", RP + "that session isn't here any more.")
            return
        if int(sess.get("rev") or 0) != msg["rev"]:
            connection.send_error(msg["id"], REV_CODE, RP + "the session changed since you looked: it is reloaded.")
            return
        if sess.get("status") == "running":
            connection.send_error(msg["id"], "already_running", RP + "wait for the reading to finish.")
            return
        word = A.read_again(hass, store, msg["session"], msg["room"])
        if word != "ok":
            connection.send_error(msg["id"], word, RP + {"not_found": "that room isn't in the proposal.",
                                                         "not_flagged": "only a room whose reads differ is read again.",
                                                         "already_running": "a session is already reading your plans."}.get(word, "that can't be done."))
            return
        await store.async_save()
    connection.send_result(msg["id"], _rooms_answer(hass, store, msg["session"]))


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_rooms_check",
    vol.Required("session"): str,
    vol.Required("items"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_check(hass: HomeAssistant, connection, msg) -> None:
    """The rooms gate for these ticks, before Save (design 5): the room score on
    this floor's calibration spots, now and with them. Writes nothing."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    sess = store.rooms_session(msg["session"])
    prop = (sess or {}).get("proposal")
    if not prop:
        connection.send_error(msg["id"], "not_found", RP + "that session has no proposal.")
        return
    snap, _house, points, _barriers = await A.rooms_inputs(hass)
    gate = await hass.async_add_executor_job(A.rooms_gate, points, sess["floor_id"], snap["rooms"], A.chosen_outlines(prop, msg["items"]),
                                             C._excluded(hass))  # noqa: SLF001
    connection.send_result(msg["id"], {"gate": gate})


@websocket_api.websocket_command({
    "type": "padspan_ha/plan_build_rooms_commit",
    vol.Required("session"): str,
    vol.Required("rev"): int,
    vol.Required("items"): [str],
    vol.Optional("finals"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_commit(hass: HomeAssistant, connection, msg) -> None:
    """Accept all for this floor: the ticked items in ONE save (design 5)."""
    store = await _build_refused(hass, connection, msg)
    if store is None:
        return
    await _rooms_write(hass, connection, msg, store, lambda house: C.rooms_commit(hass, store, house, msg["session"], msg["rev"], msg["items"],
                                                                                  msg.get("finals")))


@websocket_api.websocket_command({"type": "padspan_ha/plan_build_rooms_undo", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_build_rooms_undo(hass: HomeAssistant, connection, msg) -> None:
    """Undo a rooms session; allowed under the master switch whatever the AI Task (form q3)."""
    if not A.enabled(hass):
        connection.send_error(msg["id"], PLANS_OFF_CODE, RP + PLANS_OFF_MESSAGE)
        return
    store = await A.async_get_store(hass)
    await _rooms_write(hass, connection, msg, store, lambda house: C.rooms_undo(hass, store, house, msg["session"]))


async def _rooms_write(hass: HomeAssistant, connection, msg, store: A.PlanAiStore, what) -> None:
    """A rooms save or undo with the 3D store's lock and then the plan store's
    held throughout. A refusal with a list is an ok: false answer; any other a
    websocket error. Nothing was written either way."""
    from .house3d_store import ReadFailed, async_get_store as house_store  # noqa: PLC0415
    try:
        house = await house_store(hass)
    except ReadFailed:
        connection.send_error(msg["id"], READ_CODE, RP + READ_MESSAGE)
        return
    try:
        async with house.lock, store.lock:
            answer = await what(house)
    except C.Refused as err:
        if err.extra is None:
            connection.send_error(msg["id"], err.code, err.message)
        else:
            connection.send_result(msg["id"], {"ok": False, "code": err.code, "message": err.message, **err.extra,
                                               **_rooms_answer(hass, store, msg["session"])})
        return
    connection.send_result(msg["id"], {**answer, **_rooms_answer(hass, store, msg["session"])})


WS_COMMANDS = WS_COMMANDS + (ws_plan_build_rooms_start, ws_plan_build_rooms_status, ws_plan_build_rooms_resume, ws_plan_build_rooms_edit,
                             ws_plan_build_rooms_read_again, ws_plan_build_rooms_check, ws_plan_build_rooms_commit, ws_plan_build_rooms_undo)
