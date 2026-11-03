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
  minute, ten a day. It answers at once; the job runs on the server.
- plan_ai_status: the session (the latest, or one by id) with its
  suggestions, after the target and signature checks.
- plan_ai_cancel: the job stops between reads (the read in flight runs on).
- plan_ai_verdict: right (it looks right), failure (with a reason; a reject
  is remembered), later, or back (take that back). Written the moment it is
  clicked, to this store only.
- plan_ai_rejects_get / plan_ai_reject_forget: the remembered rejects.
- plan_ai_sessions_get: the sessions kept, in short.

Keeping a suggestion (new, correction: plan_ai_commit) and undoing a kept
batch (plan_ai_undo) come with the next stage. Nothing here writes the 3D
house, the map or calibration.
"""

from __future__ import annotations

import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import plan_ai as A
from . import ws_house3d_photo as P
from .const import DATA_MAPS, DOMAIN
from .house3d_store import enabled as house3d_on
from .ws_common import _tier_at_least
from .ws_house3d import OFF_CODE, OFF_MESSAGE, PRO_MESSAGE
from .ws_house3d_stairs import NOT_PLACED_CODE, PLANS_OFF_CODE, PLANS_OFF_MESSAGE

REV_CODE = "rev_mismatch"


async def _refused(hass: HomeAssistant, connection, msg) -> A.PlanAiStore | None:
    """The gates every command shares; the store when they pass."""
    if not house3d_on(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return None
    if not _tier_at_least(hass, "pro"):
        connection.send_error(msg["id"], OFF_CODE, PRO_MESSAGE)
        return None
    if not A.enabled(hass):
        connection.send_error(msg["id"], PLANS_OFF_CODE, PLANS_OFF_MESSAGE)
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
    return {"id": sid, **{k: v for k, v in sess.items() if k != "finds"}}


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
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_ai_start(hass: HomeAssistant, connection, msg) -> None:
    """Start one session over the ticked plans, read by the AI Task, or by the
    backup when it is away, as ask_ai always does."""
    store = await _refused(hass, connection, msg)
    if store is None:
        return
    why = A.start_allowed(hass)
    if why:
        connection.send_error(msg["id"], why, {"already_running": "A session is already reading your plans.",
                                               "too_soon": "A session started less than a minute ago.",
                                               "daily_cap": f"At most {A.STARTS_A_DAY} sessions a day."}[why])
        return
    kinds = [k for k in msg["kinds"] if k in A.KINDS]
    if not kinds or "stairs" not in kinds:
        connection.send_error(msg["id"], "bad_kinds", "Stairs are the one kind this version reads; lights come later.")
        return
    ai = P.ai_task(hass, with_backup=True)
    if not ai.get("ready"):
        A._bump(hass, "plan_ai_error:no_ai_task")  # noqa: SLF001
        connection.send_error(msg["id"], P.NO_AI_CODE, ai.get("message", ""))
        return
    by_id = {p["map_id"]: p for p in A.plans(hass)}
    want = list(dict.fromkeys(str(m) for m in msg["map_ids"]))
    missing = [m for m in want if m not in by_id]
    if not want or missing:
        connection.send_error(msg["id"], NOT_PLACED_CODE, "That floor plan isn't placed on its floor yet: place it in Mapping → 3D Stack first.")
        return
    sid = A.start(hass, store, ai, [by_id[m] for m in want], kinds, A.frame_kind(hass, ai["ai_task"]))
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
            if A.check_session(hass, store, sess, house):
                await store.async_save()
    connection.send_result(msg["id"], {"session": _public(sess, sid), "running": job.sid if job else None})


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
    not the house, and survive a lost page. New and correction come with the
    next stage's commit."""
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
            changed = A.settle_rails(hass, sess, msg["sug_id"]) if v == "failure" else A.unsettle_rails(hass, sess, msg["sug_id"])
        sess["rev"] = int(sess.get("rev") or 0) + 1
        store.trim()
        await store.async_save()
    connection.send_result(msg["id"], {"rev": sess["rev"], "suggestion": sug, "changed": changed})


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
    connection.send_result(msg["id"], {"sessions": out})


WS_COMMANDS = (ws_plan_ai_plans, ws_plan_ai_start, ws_plan_ai_status, ws_plan_ai_cancel, ws_plan_ai_verdict,
               ws_plan_ai_rejects_get, ws_plan_ai_reject_forget, ws_plan_ai_sessions_get)
