# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
The PadSpan join and the exact on/off for WLED (Garry, 2026-09-27: "switch
off WLED's own join/sync and use a PadSpan join where all instructions come
from PadSpan, with in-depth memory of each device's setup, and an exact,
durable on/off that reproduces complex 5-6 channel strings 100% every time").

- MEMORY: a Store (padspan_ha.wled_looks), keyed by the MAC Home Assistant
  verified for the WLED entry — never the IP (Far West answers on two, and
  three old HA entries are ESPHome now). Per device: the remembered look and
  5 older ones, the LED setup it was made on, whether PadSpan runs it, the
  sync settings to put back, the last command and its result, drift.
- ONE PATH: async_power() — every PadSpan surface (Atlas, Vacation Mode,
  presence rules, the wled_on/wled_off services) turns an exact device on or
  off through it. Each device has one worker: one command in flight, one
  pending (the newest wins), under ws_wled.device_lock so Identify never
  overlaps it; the result is compared with the look and differing segments
  re-sent (3 tries), and a late check T + 1 s later catches a timer, a
  button or the 480 panel changing it again.
- THE SWITCH: switching a device to PadSpan saves its sync settings, writes
  exactly wled_look.SYNC_OFF_PATCH through ws_wled.safe_cfg_write, and turns
  the live sync off; switching back puts both back. Where the safe write
  refuses (the I2C guard) it is live-only, re-applied on every command.
- HOLD: when something outside PadSpan turns an exact light on, the look is
  put back keeping the brightness it was given; a PadSpan team follows a
  member switched from outside; after a power cut the last command goes back.

Never used: firmware, OTA, reboot, presets or playlists (wled_look.FORBIDDEN_KEYS
is checked on every request). Tier: Bright Pro / Pro, like the Advanced tab;
without it every path is a plain HA light call, so no light goes dark over
licensing — and switching back to WLED sync is always allowed.
"""

import asyncio
import copy
import inspect
import logging
import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from . import wled_look as L
from . import ws_wled as W
from .const import DATA_SETTINGS, DATA_WLED_LOOKS, DOMAIN, WLED_LOOKS_STORE_KEY
from .ws_common import _tier_at_least

_LOGGER = logging.getLogger(__name__)

HISTORY_KEPT = 5
MAX_TRIES = 3
RETRY_DELAYS = (0.4, 1.2)
ECHO_WINDOW_S = 3.0          # PadSpan's own change coming back through HA
LATE_EXTRA_S = 1.0
RECONNECT_DEDUPE_S = 10.0
SETUP_RECHECK_S = 86400
SAVE_DELAY_S = 2.0

LIVE_ONLY_MSG = ("Sync is switched off until the device restarts; PadSpan switches it off again every time it "
                 "turns the light on or reconnects.")

_WORKERS = "_wled_exact_workers"
_UNSUB = "_wled_exact_unsub"
_REG_UNSUB = "_wled_exact_reg_unsub"
_STORE_LOCK = "_wled_looks_lock"

# Indirections the tests replace.
_now = time.time
_mono = time.monotonic


def _later(hass: HomeAssistant, delay: float, job: Any) -> Any:
    from homeassistant.helpers.event import async_call_later  # noqa: PLC0415
    return async_call_later(hass, delay, job)


# ── The memory ───────────────────────────────────────────────────────────────


def new_record(mac: str, device_id: str, name: str) -> dict[str, Any]:
    return {"mac": mac, "device_id": device_id, "name": name, "join": "wled", "exact": False,
            # Q1 (2026-09-27): "put the look back when something else turns
            # it on" is on unless switched off, keeping the caller's brightness.
            "hold": True, "team_id": None, "sync_off": None, "prior_sync": None,
            "look": None, "history": [], "last_cmd": None, "last_result": None, "drift": None,
            "setup_checked_at": None}


class WledLooksStore:
    """padspan_ha.wled_looks: {"devices": {mac: record}}. `.data` is what a
    PadSpan backup saves and a restore replaces (ws_common._DATA_KEY_MAP)."""

    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self.store = Store(hass, 1, WLED_LOOKS_STORE_KEY)
        self.data: dict[str, Any] = {"devices": {}}

    async def async_load(self) -> dict[str, Any]:
        loaded = await self.store.async_load()
        self.data = loaded if isinstance(loaded, dict) and isinstance(loaded.get("devices"), dict) else {"devices": {}}
        return self.data

    def records(self) -> dict[str, dict]:
        if not isinstance(self.data, dict) or not isinstance(self.data.get("devices"), dict):
            self.data = {"devices": {}}
        return self.data["devices"]

    def get(self, mac: str | None) -> dict | None:
        return self.records().get(mac) if mac else None

    def by_device_id(self, device_id: str | None) -> dict | None:
        for rec in self.records().values():
            if isinstance(rec, dict) and rec.get("device_id") == device_id:
                return rec
        return None

    def ensure(self, mac: str, device_id: str, name: str) -> dict:
        rec = self.records().get(mac)
        if rec is None:
            rec = self.records()[mac] = new_record(mac, device_id, name)
        rec["device_id"], rec["name"] = device_id, name
        return rec

    def schedule_save(self) -> None:
        self.store.async_delay_save(lambda: self.data, SAVE_DELAY_S)

    async def async_save(self) -> None:
        await self.store.async_save(self.data)


def _store(hass: HomeAssistant) -> WledLooksStore | None:
    return (hass.data.get(DOMAIN) or {}).get(DATA_WLED_LOOKS)


async def async_get_store(hass: HomeAssistant) -> WledLooksStore:
    st = _store(hass)
    if st is not None:
        return st
    lock = hass.data.setdefault(DOMAIN, {}).setdefault(_STORE_LOCK, asyncio.Lock())
    async with lock:
        st = _store(hass)
        if st is None:
            st = WledLooksStore(hass)
            await st.async_load()
            hass.data[DOMAIN][DATA_WLED_LOOKS] = st
    return st


# ── Devices, entities, teams ─────────────────────────────────────────────────


def _identify(hass: HomeAssistant, entity_id: str | None = None, device_id: str | None = None) -> dict | None:
    """{device_id, mac, name, tgt} for a light/device of HA's WLED
    integration — found even while the device is offline (tgt is then
    None). The MAC is the one HA verified for the entry; never from a client."""
    from homeassistant.helpers import device_registry as dr, entity_registry as er  # noqa: PLC0415

    if entity_id and not device_id:
        ent = er.async_get(hass).async_get(entity_id)
        device_id = ent.device_id if ent is not None else None
    if not device_id:
        return None
    dev = dr.async_get(hass).async_get(device_id)
    if dev is None:
        return None
    entries = W._wled_entries(hass)
    for entry_id in getattr(dev, "config_entries", ()) or ():
        entry = entries.get(entry_id)
        if entry is None or getattr(entry, "disabled_by", None):
            continue
        mac = W._norm_mac(getattr(entry, "unique_id", None))
        if mac:
            return {"device_id": device_id, "mac": mac, "name": dev.name_by_user or dev.name or mac,
                    "tgt": W.resolve_device(hass, device_id=device_id)}
    return None


def device_lights(hass: HomeAssistant, device_id: str, mac: str) -> dict[str, Any]:
    """{entity_id: "main" | segment id} — HA's WLED lights are unique_id
    <mac> (the main light) and <mac>_<segment> (light.py 2026.7.4)."""
    from homeassistant.helpers import entity_registry as er  # noqa: PLC0415

    out: dict[str, Any] = {}
    for e in er.async_entries_for_device(er.async_get(hass), device_id):
        if not e.entity_id.startswith("light."):
            continue
        uid = str(getattr(e, "unique_id", "") or "")
        base, _, seg = uid.partition("_")
        if W._norm_mac(base) != mac:
            continue
        if not seg:
            out[e.entity_id] = "main"
        elif seg.isdigit():
            out[e.entity_id] = int(seg)
    return out


def _has_main(hass: HomeAssistant, lights: dict[str, Any]) -> bool:
    """HA shows a main light only for more than one segment (or the
    keep-main option); it is unavailable otherwise."""
    for eid, role in lights.items():
        if role == "main":
            st = hass.states.get(eid)
            return st is not None and st.state != "unavailable"
    return False


def _teams(hass: HomeAssistant) -> list[dict]:
    st = (hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
    return [t for t in ((st.data if st else {}).get("wled_teams") or []) if isinstance(t, dict)]


def team_of(hass: HomeAssistant, device_id: str | None) -> dict | None:
    for t in _teams(hass):
        if device_id == t.get("leader") or device_id in (t.get("followers") or []):
            return t
    return None


def padspan_team_of(hass: HomeAssistant, device_id: str | None) -> dict | None:
    t = team_of(hass, device_id)
    return t if t and t.get("mode") == "padspan" else None


def _members(t: dict) -> list[str]:
    return [str(t.get("leader"))] + [str(f) for f in t.get("followers") or []]


def _exact_record(hass: HomeAssistant, entity_id: str) -> dict | None:
    if not _tier_at_least(hass, W.TIER):
        return None
    st = _store(hass)
    if st is None:
        return None
    from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
    ent = er.async_get(hass).async_get(entity_id)
    rec = st.by_device_id(ent.device_id) if ent is not None and ent.device_id else None
    return rec if rec and rec.get("exact") and rec.get("look") else None


def is_exact_entity(hass: HomeAssistant, entity_id: str) -> bool:
    """Is this light a device PadSpan runs (and is the licence there)?"""
    try:
        return _exact_record(hass, entity_id) is not None
    except Exception:  # noqa: BLE001 — a registry hiccup means "plain light"
        return False


# ── One device's worker ──────────────────────────────────────────────────────


class _Worker:
    """Newest-wins: each device keeps only its newest wanted state and a
    generation; at most one command in flight plus one pending."""

    def __init__(self, hass: HomeAssistant, mac: str) -> None:
        self.hass, self.mac = hass, mac
        self.gen = 0
        self.done = 0
        self.want: dict | None = None
        self.task: asyncio.Task | None = None
        self.waiters: list[tuple[int, asyncio.Future]] = []
        self.last_write = -1e9       # monotonic time of PadSpan's last POST
        self.last_reconnect = -1e9
        self.late_cancel: Any = None
        self.plan: dict | None = None   # what the last command checked against (for the late check)
        self.applies = 0

    def busy(self) -> bool:
        return self.task is not None and not self.task.done()

    def submit(self, want: dict) -> asyncio.Future:
        self.gen += 1
        self.want = want
        fut = asyncio.get_running_loop().create_future()
        self.waiters.append((self.gen, fut))
        if self.late_cancel:
            self.late_cancel()
            self.late_cancel = None
        if not self.busy():
            self.task = self.hass.async_create_background_task(self._run(), f"padspan_wled_exact_{self.mac}")
        return fut

    async def _run(self) -> None:
        while self.done < self.gen:
            gen, want = self.gen, dict(self.want or {})
            try:
                result = await _apply(self.hass, self, want, gen)
            except Exception as err:  # noqa: BLE001 — a worker must never die with waiters pending
                _LOGGER.warning("WLED exact look: %s failed: %s", self.mac, err)
                result = {"at": _now(), "ok": False, "error": str(err)[:200], "source": want.get("source")}
            self.done = gen
            for g, fut in self.waiters:
                if g <= gen and not fut.done():
                    fut.set_result(result if g == gen else {**result, "merged": True})
            self.waiters = [(g, f) for g, f in self.waiters if g > gen]


def _worker(hass: HomeAssistant, mac: str) -> _Worker:
    workers: dict = hass.data.setdefault(DOMAIN, {}).setdefault(_WORKERS, {})
    w = workers.get(mac)
    if w is None:
        w = workers[mac] = _Worker(hass, mac)
    return w


def _clamp_bri(v: Any) -> int:
    try:
        return max(1, min(255, int(v)))
    except (TypeError, ValueError):
        return 128


def _effective(look_state: dict, want: dict, live: dict) -> dict:
    """The look, with a segment's opacity taken from the device where the
    person set it (hold on a segment light when a main light exists)."""
    seg_bri = want.get("seg_bri") or {}
    if not seg_bri:
        return look_state
    eff = copy.deepcopy(look_state)
    live_segs = {s.get("id"): s for s in live.get("seg") or []}
    for s in eff.get("seg") or []:
        if s.get("id") in seg_bri and s.get("id") in live_segs:
            s["bri"] = live_segs[s["id"]].get("bri", s.get("bri"))
    return eff


def _plan(eff: dict, live: dict, ctx: L.Ctx, *, on: bool, bri: int, tt: int, team: bool) -> list[dict]:
    """Compare first, then write only what is needed: off → the off request
    if it is on or sync/nightlight need putting back; dark → the whole look,
    the tail, then on; lit and matching → only the brightness; lit and
    different → the whole look in one go."""
    if not on:
        if live.get("on") or not L.udpn_ok(live) or (live.get("nl") or {}).get("on"):
            return [L.off_body(tt)]
        return []
    if not live.get("on"):
        return L.on_bodies(eff, live, ctx, bri=bri, tt=tt, dark=True, team=team)
    diffs = L.compare(eff, live, ctx, exact=True)
    if any(d["key"] not in ("udpn", "nl", "extra") for d in diffs):
        return L.on_bodies(eff, live, ctx, bri=bri, tt=tt, dark=False)
    bodies: list[dict] = []
    extra = L.extra_segment_ids(eff, live)
    if extra:
        bodies.append(L.tail_body(extra))
    sync_bad = any(d["key"] in ("udpn", "nl") for d in diffs)
    if live.get("bri") != bri or sync_bad:
        body = L.dim_body(bri, sync_ok=not sync_bad)
        if sync_bad:
            body["nl"] = {"on": False}
        bodies.append(body)
    return bodies


async def _post_all(hass: HomeAssistant, worker: _Worker, host: str, bodies: list[dict]) -> dict | None:
    """Send in order; the last reply (v:true) is the device's state. A lost
    reply is followed by a read — never by a blind re-send."""
    reply: Any = None
    for body in bodies:
        bad = L.forbidden_in(body)
        if bad:                     # the exact path never sends these
            raise W.WledError("refused", f"refused to send {bad}")
        try:
            reply = await W._request(hass, host, "POST", "json/state", body, W.POST_TIMEOUT_S)
            worker.last_write = _mono()
            worker.applies += 1
        except W.WledError as e:
            if e.code not in ("timeout", "unreachable"):
                raise
            worker.last_write = _mono()
            try:
                return await W._request(hass, host, "GET", "json/state")
            except W.WledError:
                return None
    if not isinstance(reply, dict) or "seg" not in reply:
        try:
            reply = await W._request(hass, host, "GET", "json/state")
        except W.WledError:
            return None
    return reply


def _accept_remaps(diffs: list[dict], reply: dict, prev: dict | None) -> list[dict]:
    """An effect id WLED remapped (a reserved id moves to the next one) comes
    back the same way on every try: the same answer twice is accepted."""
    if not prev:
        return diffs
    now_fx = {s.get("id"): s.get("fx") for s in reply.get("seg") or []}
    before_fx = {s.get("id"): s.get("fx") for s in prev.get("seg") or []}
    return [d for d in diffs if not (d["key"] == "fx" and d["seg"] in now_fx and now_fx[d["seg"]] == before_fx.get(d["seg"]))]


async def _maybe_check_setup(hass: HomeAssistant, rec: dict, host: str, info: dict, now: float) -> None:
    """The LED setup rechecked after a device restart and once a day;
    differences recorded as plain lines (never changed by PadSpan)."""
    look = rec.get("look") or {}
    checked = rec.get("setup_checked_at") or look.get("at") or 0
    up = info.get("uptime")
    restarted = isinstance(up, (int, float)) and up < now - checked
    fw_changed = info.get("ver") != look.get("fw") and not rec.get("drift")
    if not (restarted or fw_changed or now - checked >= SETUP_RECHECK_S):
        return
    try:
        cfg = await W._request(hass, host, "GET", "json/cfg")
    except W.WledError:
        return
    setup = L.setup_record(info, cfg)
    rec["setup_checked_at"] = now
    diff = L.setup_diff(look.get("setup"), setup)
    what = diff["geometry"] + diff["colour"]
    if info.get("ver") != look.get("fw"):
        what.append(f"Firmware changed from {look.get('fw')} to {info.get('ver')}")
    rec["drift"] = {"at": now, "what": what, "geometry": bool(diff["geometry"])} if what else None


async def _apply(hass: HomeAssistant, worker: _Worker, want: dict, gen: int) -> dict:
    st = _store(hass)
    rec = st.get(worker.mac) if st else None
    now = _now()
    result: dict[str, Any] = {"at": now, "ok": False, "tries": 0, "diffs": [], "source": want.get("source"),
                              "on": want.get("on")}
    look = (rec or {}).get("look")
    if not rec or not look:
        result["error"] = "No remembered look"
        return result
    tgt = W.resolve_device(hass, device_id=rec.get("device_id"))
    if tgt is None:
        result.update(waiting=True, error="Offline — the look goes on when it reconnects")
        rec["last_result"] = result
        st.schedule_save()
        return result
    host = tgt["host"]
    async with W.device_lock(hass, host):
        try:
            si = await W._request(hass, host, "GET", "json/si")
        except W.WledError as e:
            result.update(waiting=True, error=str(e))
            rec["last_result"] = result
            st.schedule_save()
            return result
        info, live = si.get("info") or {}, si.get("state") or {}
        if tgt.get("mac") and W._norm_mac(info.get("mac")) and W._norm_mac(info.get("mac")) != tgt["mac"]:
            result["error"] = "The device reports a different MAC than Home Assistant has for it — refused"
            rec["last_result"] = result
            return result
        await _maybe_check_setup(hass, rec, host, info, now)
        ctx = L.Ctx(info, geometry_ok=not (rec.get("drift") or {}).get("geometry"))
        on = bool(live.get("on")) if want.get("on") is None else bool(want["on"])
        eff = _effective(look["state"], want, live)
        if want.get("bri") is not None:
            bri = _clamp_bri(want["bri"])
        elif want.get("keep_bri"):
            bri = _clamp_bri(live.get("bri"))
        else:
            bri = _clamp_bri(look["state"].get("bri"))
        tt = int(want["tt"]) if want.get("tt") is not None else int(look["state"].get("tt", 7) or 0)
        result["on"], result["bri"] = on, bri
        tries, reply, prev = 0, live, None
        try:
            bodies = _plan(eff, live, ctx, on=on, bri=bri, tt=tt, team=bool(want.get("team")))
            if bodies:
                tries = 1
                reply = await _post_all(hass, worker, host, bodies)
            diffs = L.compare(eff, reply, ctx, on=on, bri=bri, exact=True) if reply is not None else \
                [{"seg": None, "key": "reply", "what": "no answer"}]
            while diffs and tries < MAX_TRIES:
                await asyncio.sleep(RETRY_DELAYS[min(tries - 1, len(RETRY_DELAYS) - 1)] if tries else 0)
                tries += 1
                prev = reply
                segs = L.differing_segments(diffs)
                extra = [d["seg"] for d in diffs if d["key"] == "extra"]
                bodies = (L.resend_bodies(eff, ctx, segs, on=True, bri=bri, tt=tt) if on else [L.off_body(tt)])
                if extra:
                    bodies.append(L.tail_body(extra))
                reply = await _post_all(hass, worker, host, bodies)
                if reply is None:
                    diffs = [{"seg": None, "key": "reply", "what": "no answer"}]
                    continue
                diffs = _accept_remaps(L.compare(eff, reply, ctx, on=on, bri=bri, exact=True), reply, prev)
        except W.WledError as e:
            result.update(tries=tries, error=str(e))
            rec["last_result"] = result
            st.schedule_save()
            return result
        result.update(ok=not diffs, tries=tries, diffs=L.describe(diffs))
        if diffs:
            result["message"] = f"{'; '.join(L.describe(diffs))} didn't take after {tries} tries"
    rec["last_result"] = result
    if want.get("on") is not None and isinstance(rec.get("last_cmd"), dict):
        rec["last_cmd"].update(on=on, bri=bri)
    st.schedule_save()
    if tries:
        worker.plan = {"eff": eff, "ctx": ctx, "on": on, "bri": bri, "tt": tt, "gen": gen}
        _schedule_late(hass, worker, gen, tt, stage=1)
    return result


def _schedule_late(hass: HomeAssistant, worker: _Worker, gen: int, tt: int, stage: int) -> None:
    async def _fire(_now_arg: Any = None) -> None:
        worker.late_cancel = None
        await _late_check(hass, worker, gen, stage)

    try:
        worker.late_cancel = _later(hass, tt / 10 + LATE_EXTRA_S, _fire)
    except Exception as err:  # noqa: BLE001 — a missing timer loses only the late check
        _LOGGER.debug("WLED exact look: late check not scheduled: %s", err)


async def _late_check(hass: HomeAssistant, worker: _Worker, gen: int, stage: int) -> None:
    """Once, T + 1 s after a command: something that changed the light again
    is fixed once; if it changes again, the result says so."""
    plan = worker.plan
    st = _store(hass)
    rec = st.get(worker.mac) if st else None
    if plan is None or plan["gen"] != gen or worker.gen != gen or worker.busy() or rec is None:
        return
    tgt = W.resolve_device(hass, device_id=rec.get("device_id"))
    if tgt is None:
        return
    async with W.device_lock(hass, tgt["host"]):
        if worker.gen != gen:
            return
        try:
            live = await W._request(hass, tgt["host"], "GET", "json/state")
        except W.WledError:
            return
        diffs = L.compare(plan["eff"], live, plan["ctx"], on=plan["on"], bri=plan["bri"], exact=True)
        if not diffs:
            return
        result = rec.get("last_result") if isinstance(rec.get("last_result"), dict) else {}
        whats = []
        for d in diffs:
            if d["what"] not in whats:
                whats.append(d["what"])
        if stage >= 2:
            result.update(ok=False, diffs=L.describe(diffs),
                          message=f"Something else keeps changing this light: {', '.join(whats)}")
            rec["last_result"] = result
            st.schedule_save()
            return
        segs = L.differing_segments(diffs)
        extra = [d["seg"] for d in diffs if d["key"] == "extra"]
        bodies = (L.resend_bodies(plan["eff"], plan["ctx"], segs, on=True, bri=plan["bri"], tt=plan["tt"])
                  if plan["on"] else [L.off_body(plan["tt"])])
        if extra:
            bodies.append(L.tail_body(extra))
        try:
            await _post_all(hass, worker, tgt["host"], bodies)
        except W.WledError:
            return
        result["late"] = f"Put back after something changed it: {', '.join(whats)}"
        rec["last_result"] = result
        st.schedule_save()
    _schedule_late(hass, worker, gen, plan["tt"], stage=2)


# ── async_power: the one path ────────────────────────────────────────────────


async def _plain_call(hass: HomeAssistant, entity_id: str, on: bool, brightness: int | None,
                      transition: float | None) -> None:
    data: dict[str, Any] = {"entity_id": entity_id}
    if on and brightness is not None:
        data["brightness"] = int(brightness)
    if transition is not None:
        data["transition"] = transition
    await hass.services.async_call("light", "turn_on" if on else "turn_off", data, blocking=True)


def _submit(hass: HomeAssistant, rec: dict, want: dict) -> asyncio.Future:
    look_bri = ((rec.get("look") or {}).get("state") or {}).get("bri")
    if want.get("on") is not None:
        rec["last_cmd"] = {"on": bool(want["on"]), "bri": want.get("bri") if want.get("bri") is not None else look_bri,
                           "at": _now(), "source": want.get("source")}
    st = _store(hass)
    if st:
        st.schedule_save()
    return _worker(hass, rec["mac"]).submit(want)


def _team_wants(hass: HomeAssistant, rec: dict, team: dict | None, on: bool, brightness: int | None,
                tt: int | None, source: str) -> list[tuple[dict, dict]]:
    """(record, want) for the device and, in a PadSpan team, every member —
    brightness scaled so members keep their tuning, relative to the device
    that was commanded (it gets exactly what was asked)."""
    st = _store(hass)
    members = [rec]
    if team and st:
        members = [st.by_device_id(d) for d in _members(team)]
        members = [m for m in members if m and m.get("exact") and m.get("look")]
        if rec not in members:
            members.insert(0, rec)
    ref = ((rec.get("look") or {}).get("state") or {}).get("bri")
    out = []
    for m in members:
        b = None
        if brightness is not None:
            b = int(brightness) if m is rec else L.team_bri(m["look"]["state"].get("bri"), int(brightness), ref)
        out.append((m, {"on": on, "bri": b, "tt": tt, "team": bool(team), "source": source}))
    return out


def _public_result(rec: dict, result: dict) -> dict:
    return {"device_id": rec.get("device_id"), "name": rec.get("name"), "ok": bool(result.get("ok")),
            "waiting": bool(result.get("waiting")), "tries": result.get("tries", 0), "diffs": result.get("diffs") or [],
            "message": result.get("message") or result.get("error"), "on": result.get("on"), "bri": result.get("bri")}


async def async_power(hass: HomeAssistant, entity_id: str, on: bool, brightness: int | None = None, *,
                      source: str = "padspan", transition: float | None = None) -> dict[str, Any]:
    """Turn an exact WLED light on (with its look) or off — with its PadSpan
    team if it has one. Anything else, or without the licence, is a plain
    HA light call: {"handled": False}."""
    rec = _exact_record(hass, entity_id)
    if rec is None:
        await _plain_call(hass, entity_id, on, brightness, transition)
        return {"handled": False, "results": []}
    tt = round(float(transition) * 10) if transition is not None else None
    team = padspan_team_of(hass, rec.get("device_id"))
    pairs = _team_wants(hass, rec, team, bool(on), brightness, tt, source)
    futures = [_submit(hass, m, want) for m, want in pairs]          # all members before any reply
    results = await asyncio.gather(*futures)
    return {"handled": True, "results": [_public_result(m, r) for (m, _), r in zip(pairs, results)]}


# ── Outside changes: hold the look, a team follows, reconnects ───────────────


async def on_state_change(hass: HomeAssistant, entity_id: str, old: Any, new: Any) -> None:
    if not _tier_at_least(hass, W.TIER):
        return
    st = _store(hass)
    if st is None:
        return
    from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
    ent = er.async_get(hass).async_get(entity_id)
    rec = st.by_device_id(ent.device_id) if ent is not None and ent.device_id else None
    if not rec or not rec.get("exact") or not rec.get("look"):
        return
    old_s, new_s = getattr(old, "state", None), getattr(new, "state", None)
    worker = _worker(hass, rec["mac"])
    if old_s == "unavailable" and new_s in ("on", "off"):
        if _mono() - worker.last_reconnect < RECONNECT_DEDUPE_S:
            return
        worker.last_reconnect = _mono()
        await _reconnect(hass, rec)
        return
    if old_s not in ("on", "off") or new_s not in ("on", "off") or old_s == new_s:
        return
    if _mono() - worker.last_write < ECHO_WINDOW_S or worker.busy():
        return                      # PadSpan's own change coming back
    lights = device_lights(hass, rec["device_id"], rec["mac"])
    role = lights.get(entity_id)
    master = role == "main" or not _has_main(hass, lights)
    team = padspan_team_of(hass, rec.get("device_id"))
    if master:
        if new_s == "off":
            rec["last_cmd"] = {"on": False, "bri": None, "at": _now(), "source": "outside"}
            st.schedule_save()
            if team:
                for m, want in _team_wants(hass, rec, team, False, None, None, "team"):
                    if m is not rec:
                        _submit(hass, m, want)
            return
        if team:
            attrs = getattr(new, "attributes", None) or {}
            ref = attrs.get("brightness")
            if isinstance(ref, (int, float)) and role != "main":
                seg0 = next((s for s in rec["look"]["state"].get("seg") or [] if s.get("id") == role), {})
                ref = ref * 255 / max(1, int(seg0.get("bri") or 255))
            for m, want in _team_wants(hass, rec, team, True, _clamp_bri(ref) if ref else None, None, "team"):
                if m is rec:
                    want = {**want, "bri": None, "keep_bri": True, "source": "hold"}
                _submit(hass, m, want)
            return
        if rec.get("hold", True):
            _submit(hass, rec, {"on": True, "keep_bri": True, "source": "hold"})
        return
    if new_s == "on" and rec.get("hold", True):
        # A segment light when a main light exists: its opacity is what the
        # person set; the master stays as it is.
        _submit(hass, rec, {"on": None, "keep_bri": True, "seg_bri": {role: True}, "source": "hold"})


async def _reconnect(hass: HomeAssistant, rec: dict) -> None:
    """Back after a power cut (restarted since the last command): the last
    command goes back — on with its look, or off. Only reconnected: the look
    is held if it is on (Q2, 2026-09-27; nothing written to presets)."""
    tgt = W.resolve_device(hass, device_id=rec.get("device_id"))
    if tgt is None:
        return
    try:
        async with W.device_lock(hass, tgt["host"]):
            info = await W._request(hass, tgt["host"], "GET", "json/info")
    except W.WledError:
        return
    last = rec.get("last_cmd") if isinstance(rec.get("last_cmd"), dict) else None
    up = info.get("uptime")
    team = padspan_team_of(hass, rec.get("device_id"))
    if last and isinstance(up, (int, float)) and up < _now() - float(last.get("at") or 0):
        _submit(hass, rec, {"on": bool(last.get("on")), "bri": last.get("bri"), "team": bool(team),
                            "source": "reconnect"})
    else:
        _submit(hass, rec, {"on": None, "keep_bri": True, "source": "reconnect"})


def _refresh_listener(hass: HomeAssistant) -> None:
    dom = hass.data.setdefault(DOMAIN, {})
    unsub = dom.pop(_UNSUB, None)
    if unsub:
        try:
            unsub()
        except Exception:  # noqa: BLE001
            pass
    st = _store(hass)
    if st is None:
        return
    ids: list[str] = []
    for rec in st.records().values():
        if isinstance(rec, dict) and rec.get("exact"):
            ids += list(device_lights(hass, rec["device_id"], rec["mac"]))
    if not ids:
        return
    from homeassistant.helpers.event import async_track_state_change_event  # noqa: PLC0415

    @callback
    def _cb(event: Any) -> None:
        data = event.data
        hass.async_create_background_task(
            on_state_change(hass, data.get("entity_id"), data.get("old_state"), data.get("new_state")),
            "padspan_wled_exact_state")

    dom[_UNSUB] = async_track_state_change_event(hass, ids, _cb)


async def async_setup_wled_exact(hass: HomeAssistant) -> None:
    """Idempotent across config-entry reloads."""
    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_REG_UNSUB):
        return
    await async_get_store(hass)
    _refresh_listener(hass)

    @callback
    def _reg_changed(_event: Any) -> None:
        _refresh_listener(hass)

    dom[_REG_UNSUB] = hass.bus.async_listen("entity_registry_updated", _reg_changed)


def async_stop_wled_exact(hass: HomeAssistant) -> None:
    dom = hass.data.get(DOMAIN, {})
    for key in (_UNSUB, _REG_UNSUB):
        unsub = dom.pop(key, None)
        if unsub:
            try:
                unsub()
            except Exception:  # noqa: BLE001
                pass
    for w in (dom.get(_WORKERS) or {}).values():
        if w.late_cancel:
            w.late_cancel()
            w.late_cancel = None


# ── The switch: WLED sync ↔ PadSpan ──────────────────────────────────────────


def _sync_blocks(cfg: dict) -> dict:
    sync = (((cfg or {}).get("if") or {}).get("sync")) or {}
    return {"send": copy.deepcopy(sync.get("send") or {}), "recv": copy.deepcopy(sync.get("recv") or {})}


async def _cfg_write(hass: HomeAssistant, tgt: dict, patch: dict, base_hash: str) -> dict:
    """The only config write the exact look makes: the sync blocks, through
    ws_wled.safe_cfg_write (backup first, same MAC, hash, I2C, reset keys)."""
    err = L.check_exact_cfg_patch(patch)
    if err:
        raise W.WledError("refused", err)
    return await W.safe_cfg_write(hass, tgt, patch, base_hash)


def _check_mac(tgt: dict, info: dict) -> None:
    if tgt.get("mac") and W._norm_mac(info.get("mac")) and W._norm_mac(info.get("mac")) != tgt["mac"]:
        raise W.WledError("mac_mismatch", "The device reports a different MAC than Home Assistant has for it — refused")


async def _restore_saved(hass: HomeAssistant, tgt: dict, prior: dict) -> dict | None:
    blocks = {k: v for k, v in ((prior or {}).get("cfg") or {}).items() if v}
    if not blocks:
        return None
    cfg = await W._request(hass, tgt["host"], "GET", "json/cfg")
    return await _cfg_write(hass, tgt, {"if": {"sync": blocks}}, W.cfg_hash(cfg))


async def switch_to_padspan(hass: HomeAssistant, rec: dict, tgt: dict, team_prior: dict | None = None) -> dict:
    """Save the sync settings, write the one sync-off patch safely, switch
    live sync off; roll the saved change back if the live one fails. The
    caller holds the device lock."""
    host = tgt["host"]
    info = await W._request(hass, host, "GET", "json/info")
    _check_mac(tgt, info)
    cfg = await W._request(hass, host, "GET", "json/cfg")
    state = await W._request(hass, host, "GET", "json/state")
    udpn = state.get("udpn") or {}
    if rec.get("join") == "padspan" and rec.get("prior_sync"):
        prior = rec["prior_sync"]                  # already switched: keep the ORIGINAL settings
    elif team_prior and (team_prior.get("send") or team_prior.get("recv")):
        # Already in a WLED team: its settings from before the team.
        send, recv = copy.deepcopy(team_prior.get("send") or {}), copy.deepcopy(team_prior.get("recv") or {})
        prior = {"cfg": {"send": send, "recv": recv},
                 "live": {"send": bool(send.get("en", False)), "recv": bool(recv.get("grp", 0)),
                          "sgrp": send.get("grp", 0), "rgrp": recv.get("grp", 0)}, "at": _now()}
    else:
        prior = {"cfg": _sync_blocks(cfg),
                 "live": {k: udpn[k] for k in ("send", "recv", "sgrp", "rgrp") if k in udpn}, "at": _now()}
    before = {**_sync_blocks(cfg), "live": {k: udpn.get(k) for k in ("send", "recv", "sgrp", "rgrp")}}
    backup, sync_off, message = None, "saved", None
    try:
        res = await _cfg_write(hass, tgt, L.sync_off_patch(), W.cfg_hash(cfg))
        backup = res.get("backup")
    except W.WledError as e:
        if e.code != "i2c_in_use":
            raise
        sync_off, message = "live", LIVE_ONLY_MSG
    try:
        reply = await W._request(hass, host, "POST", "json/state", {"udpn": dict(L.UDPN_OFF), "v": True},
                                 W.POST_TIMEOUT_S)
        if not isinstance(reply, dict) or "udpn" not in reply:
            reply = await W._request(hass, host, "GET", "json/state")
        if not L.udpn_ok(reply):
            raise W.WledError("not_applied", "The device didn't switch its sync off")
    except W.WledError:
        if sync_off == "saved":
            try:
                await _restore_saved(hass, tgt, prior)
            except W.WledError as err:
                _LOGGER.warning("WLED exact look: rolling %s back failed: %s", rec.get("name"), err)
        raise
    try:
        after_cfg = await W._request(hass, host, "GET", "json/cfg")
        after = {**_sync_blocks(after_cfg), "live": {k: (reply.get("udpn") or {}).get(k) for k in ("send", "recv", "sgrp", "rgrp")}}
    except W.WledError:
        after = None
    rec.update(join="padspan", exact=True, sync_off=sync_off, prior_sync=prior)
    return {"backup": backup, "sync_off": sync_off, "message": message, "before": before, "after": after}


async def switch_to_wled(hass: HomeAssistant, rec: dict, tgt: dict) -> dict:
    """Put the saved send/recv blocks back (same safe write), then the saved
    live sync. The caller holds the device lock."""
    host = tgt["host"]
    info = await W._request(hass, host, "GET", "json/info")
    _check_mac(tgt, info)
    prior = rec.get("prior_sync") or {}
    cfg = await W._request(hass, host, "GET", "json/cfg")
    state = await W._request(hass, host, "GET", "json/state")
    before = {**_sync_blocks(cfg), "live": {k: (state.get("udpn") or {}).get(k) for k in ("send", "recv", "sgrp", "rgrp")}}
    backup = None
    if rec.get("sync_off") == "saved":
        blocks = {k: v for k, v in (prior.get("cfg") or {}).items() if v}
        if blocks:
            res = await _cfg_write(hass, tgt, {"if": {"sync": blocks}}, W.cfg_hash(cfg))
            backup = res.get("backup")
    live = {k: v for k, v in (prior.get("live") or {}).items() if k in ("send", "recv", "sgrp", "rgrp")}
    reply = await W._request(hass, host, "POST", "json/state", {"udpn": {**live, "nn": True}, "v": True},
                             W.POST_TIMEOUT_S)
    try:
        after_cfg = await W._request(hass, host, "GET", "json/cfg")
        after = {**_sync_blocks(after_cfg), "live": {k: ((reply or {}).get("udpn") or {}).get(k)
                                                     for k in ("send", "recv", "sgrp", "rgrp")}}
    except W.WledError:
        after = None
    rec.update(join="wled", exact=False, sync_off=None, prior_sync=None)
    return {"backup": backup, "before": before, "after": after}


# ── Websocket commands ───────────────────────────────────────────────────────


def _user_name(connection: Any) -> str:
    user = getattr(connection, "user", None)
    return str(getattr(user, "name", None) or "someone")


def _public(hass: HomeAssistant, rec: dict, admin: bool) -> dict[str, Any]:
    team = team_of(hass, rec.get("device_id"))
    return {
        "device_id": rec.get("device_id"), "mac": rec.get("mac"), "name": rec.get("name"),
        "join": rec.get("join", "wled"), "exact": bool(rec.get("exact")), "hold": bool(rec.get("hold", True)),
        "sync_off": rec.get("sync_off"), "sync_off_message": LIVE_ONLY_MSG if rec.get("sync_off") == "live" else None,
        "team_id": team.get("id") if team else None, "team_mode": team.get("mode") if team else None,
        "look": rec.get("look"),
        "history": [{"index": i, **lk} for i, lk in enumerate(rec.get("history") or [])],
        "last_cmd": rec.get("last_cmd"), "last_result": rec.get("last_result"), "drift": rec.get("drift"),
        "prior_sync": rec.get("prior_sync") if admin else None,
        "can_switch": bool(rec.get("look")),
    }


async def _gate(hass: HomeAssistant, connection: Any, msg: dict, *, tier: bool = True) -> dict | None:
    if tier and not _tier_at_least(hass, W.TIER):
        connection.send_error(msg["id"], "bright_required", W.TIER_MSG)
        return None
    ident = _identify(hass, entity_id=msg.get("entity_id"), device_id=msg.get("device_id"))
    if ident is None:
        connection.send_error(msg["id"], "not_wled", "That light isn't a WLED device in Home Assistant's WLED integration")
        return None
    return ident


def _offline(connection: Any, msg: dict, ident: dict) -> None:
    connection.send_error(msg["id"], "wled_offline",
                          f"Home Assistant can't reach {ident['name']} — check it's powered on and on the network")


@websocket_api.websocket_command({"type": "padspan_ha/wled_exact_list"})
@websocket_api.async_response
async def ws_wled_exact_list(hass: HomeAssistant, connection, msg) -> None:
    """Which WLED lights PadSpan runs — for the Atlas's routing. Empty without
    the licence, so every surface falls back to plain HA light calls."""
    if not _tier_at_least(hass, W.TIER):
        connection.send_result(msg["id"], {"devices": []})
        return
    st = await async_get_store(hass)
    out = []
    for rec in st.records().values():
        if not isinstance(rec, dict) or not rec.get("exact") or not rec.get("look"):
            continue
        lights = device_lights(hass, rec["device_id"], rec["mac"])
        team = padspan_team_of(hass, rec["device_id"])
        main = next((e for e, r in lights.items() if r == "main"), None)
        out.append({"device_id": rec["device_id"], "mac": rec["mac"], "name": rec.get("name"),
                    "main": main if main and _has_main(hass, lights) else None, "lights": lights,
                    "team_id": team.get("id") if team else None, "hold": bool(rec.get("hold", True)),
                    "look_bri": rec["look"]["state"].get("bri")})
    connection.send_result(msg["id"], {"devices": out})


@websocket_api.websocket_command({"type": "padspan_ha/wled_look_get", vol.Optional("compare", default=False): bool,
                                  **W._TARGET})
@websocket_api.async_response
async def ws_wled_look_get(hass: HomeAssistant, connection, msg) -> None:
    ident = await _gate(hass, connection, msg)
    if ident is None:
        return
    st = await async_get_store(hass)
    rec = st.get(ident["mac"]) or new_record(ident["mac"], ident["device_id"], ident["name"])
    out = _public(hass, rec, W._is_admin(connection))
    out["differs"], out["compare_error"] = None, None
    if msg.get("compare") and rec.get("look"):
        if ident["tgt"] is None:
            out["compare_error"] = "offline"
        else:
            try:
                async with W.device_lock(hass, ident["tgt"]["host"]):
                    si = await W._request(hass, ident["tgt"]["host"], "GET", "json/si")
                ctx = L.Ctx(si.get("info"), geometry_ok=not (rec.get("drift") or {}).get("geometry"))
                out["differs"] = L.describe(L.compare(rec["look"]["state"], si.get("state") or {}, ctx,
                                                      exact=bool(rec.get("exact"))))
            except W.WledError as e:
                out["compare_error"] = str(e)
    connection.send_result(msg["id"], out)


async def _capture(hass: HomeAssistant, ident: dict, by: str) -> dict:
    tgt = ident["tgt"]
    if tgt is None:
        raise W.WledError("wled_offline", f"{ident['name']} is offline")
    async with W.device_lock(hass, tgt["host"]):
        si = await W._request(hass, tgt["host"], "GET", "json/si")
        _check_mac(tgt, si.get("info") or {})
        cfg = await W._request(hass, tgt["host"], "GET", "json/cfg")
    return L.capture(si, cfg, by=by, at=_now())


@websocket_api.websocket_command({"type": "padspan_ha/wled_look_remember",
                                  vol.Optional("team", default=False): bool,
                                  vol.Optional("preview", default=False): bool, **W._TARGET})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wled_look_remember(hass: HomeAssistant, connection, msg) -> None:
    """Remember the look as it is now (only when someone asks — an accidental
    state never becomes the look): GET /json/si, then /json/cfg. With team,
    every member at once; nothing is saved unless every member answered."""
    ident = await _gate(hass, connection, msg)
    if ident is None:
        return
    idents = [ident]
    if msg.get("team"):
        team = team_of(hass, ident["device_id"])
        if team is None:
            connection.send_error(msg["id"], "no_team", f"{ident['name']} isn't in a team")
            return
        idents = [_identify(hass, device_id=d) for d in _members(team)]
        if any(i is None for i in idents):
            connection.send_error(msg["id"], "not_wled", "A team member isn't a WLED device in Home Assistant any more")
            return
    by = _user_name(connection)
    looks = await asyncio.gather(*(_capture(hass, i, by) for i in idents), return_exceptions=True)
    failed = [i["name"] for i, lk in zip(idents, looks) if isinstance(lk, BaseException)]
    if failed:
        connection.send_error(msg["id"], "unreachable", f"Couldn't read {', '.join(failed)} — nothing was remembered")
        return
    team_warn = L.team_warnings(list(looks)) if msg.get("team") else []
    if not msg.get("preview"):
        st = await async_get_store(hass)
        for i, look in zip(idents, looks):
            rec = st.ensure(i["mac"], i["device_id"], i["name"])
            if rec.get("look"):
                rec["history"] = ([rec["look"]] + list(rec.get("history") or []))[:HISTORY_KEPT]
            rec["look"], rec["drift"], rec["setup_checked_at"] = look, None, look["at"]
        await st.async_save()
    connection.send_result(msg["id"], {
        "saved": not msg.get("preview"), "team_warnings": team_warn,
        "looks": [{"device_id": i["device_id"], "name": i["name"], "mac": i["mac"], "look": lk,
                   "warnings": lk.get("warnings") or []} for i, lk in zip(idents, looks)]})


@websocket_api.websocket_command({"type": "padspan_ha/wled_look_use_history",
                                  vol.Required("index"): vol.All(int, vol.Range(min=0, max=HISTORY_KEPT - 1)),
                                  **W._TARGET})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wled_look_use_history(hass: HomeAssistant, connection, msg) -> None:
    ident = await _gate(hass, connection, msg)
    if ident is None:
        return
    st = await async_get_store(hass)
    rec = st.get(ident["mac"])
    history = list((rec or {}).get("history") or [])
    if not rec or msg["index"] >= len(history):
        connection.send_error(msg["id"], "not_found", "There's no remembered look at that place in the history")
        return
    chosen = history.pop(msg["index"])
    if rec.get("look"):
        history.insert(0, rec["look"])
    rec["look"], rec["history"], rec["drift"], rec["setup_checked_at"] = chosen, history[:HISTORY_KEPT], None, None
    await st.async_save()
    out = _public(hass, rec, True)
    connection.send_result(msg["id"], {"look": out["look"], "history": out["history"]})


@websocket_api.websocket_command({"type": "padspan_ha/wled_exact_set", vol.Optional("exact"): bool,
                                  vol.Optional("hold"): bool, **W._TARGET})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wled_exact_set(hass: HomeAssistant, connection, msg) -> None:
    """Who gives this light its instructions: WLED sync or PadSpan (and the
    "put the look back" switch). Switching back is allowed without the
    licence — a lapse must never strand a device with its sync off."""
    if "exact" not in msg and "hold" not in msg:
        connection.send_error(msg["id"], "invalid", "Nothing to change")
        return
    turning_on = msg.get("exact") is True or ("hold" in msg and "exact" not in msg)
    ident = await _gate(hass, connection, msg, tier=turning_on)
    if ident is None:
        return
    st = await async_get_store(hass)
    rec = st.ensure(ident["mac"], ident["device_id"], ident["name"])
    out: dict[str, Any] = {"before": None, "after": None, "backup": None, "message": None}
    if "exact" in msg and bool(msg["exact"]) != bool(rec.get("exact")):
        team = padspan_team_of(hass, ident["device_id"])
        if team:
            connection.send_error(msg["id"], "in_team",
                                  f"{ident['name']} is in a team run by PadSpan — switch the team back to WLED sync first")
            return
        if msg["exact"] and not rec.get("look"):
            connection.send_error(msg["id"], "no_look", "Remember the look first — PadSpan needs it to turn this light on")
            return
        if ident["tgt"] is None:
            _offline(connection, msg, ident)
            return
        try:
            async with W.device_lock(hass, ident["tgt"]["host"]):
                if msg["exact"]:
                    wteam = team_of(hass, ident["device_id"])
                    prior = ((wteam or {}).get("prior") or {}).get(ident["device_id"])
                    res = await switch_to_padspan(hass, rec, ident["tgt"], team_prior=prior)
                else:
                    res = await switch_to_wled(hass, rec, ident["tgt"])
        except W.WledError as e:
            await st.async_save()
            connection.send_error(msg["id"], e.code, str(e))
            return
        out.update({k: res.get(k) for k in ("before", "after", "backup", "message")})
    if "hold" in msg:
        rec["hold"] = bool(msg["hold"])
    await st.async_save()
    _refresh_listener(hass)
    pub = _public(hass, rec, True)
    out.update({k: pub[k] for k in ("join", "exact", "hold", "sync_off", "sync_off_message")})
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command({"type": "padspan_ha/wled_team_mode", vol.Required("team_id"): str,
                                  vol.Required("mode"): vol.In(["padspan", "mirror"])})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wled_team_mode(hass: HomeAssistant, connection, msg) -> None:
    """Run this team by WLED sync or by PadSpan. PadSpan: every member is
    switched one at a time, and all are rolled back if one fails. WLED sync:
    every member's sync goes back to before the team (the card then sets the
    team's groups up again, as for a new team)."""
    if msg["mode"] == "padspan" and not _tier_at_least(hass, W.TIER):
        connection.send_error(msg["id"], "bright_required", W.TIER_MSG)
        return
    sst = (hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
    stored = list((sst.data if sst else {}).get("wled_teams") or [])
    team = next((t for t in stored if isinstance(t, dict) and t.get("id") == msg["team_id"]), None)
    if team is None or sst is None:
        connection.send_error(msg["id"], "not_found", "That team doesn't exist any more — reload")
        return
    st = await async_get_store(hass)
    idents = [_identify(hass, device_id=d) for d in _members(team)]
    if any(i is None for i in idents):
        connection.send_error(msg["id"], "not_wled", "A team member isn't a WLED device in Home Assistant any more")
        return
    members: list[dict] = []
    if msg["mode"] == "padspan":
        missing = [i["name"] for i in idents if not (st.get(i["mac"]) or {}).get("look")]
        if missing:
            connection.send_error(msg["id"], "no_look", f"Remember the team look first ({', '.join(missing)})")
            return
        offline = [i["name"] for i in idents if i["tgt"] is None]
        if offline:
            connection.send_error(msg["id"], "wled_offline", f"{', '.join(offline)} can't be reached — nothing was changed")
            return
        done: list[tuple[dict, dict]] = []
        for i in idents:
            rec = st.ensure(i["mac"], i["device_id"], i["name"])
            try:
                async with W.device_lock(hass, i["tgt"]["host"]):
                    res = await switch_to_padspan(hass, rec, i["tgt"], team_prior=(team.get("prior") or {}).get(i["device_id"]))
                done.append((i, rec))
                members.append({"device_id": i["device_id"], "name": i["name"], "ok": True,
                                "sync_off": res["sync_off"], "message": res["message"]})
            except W.WledError as e:
                back = []
                for bi, brec in reversed(done):
                    try:
                        async with W.device_lock(hass, bi["tgt"]["host"]):
                            await switch_to_wled(hass, brec, bi["tgt"])
                    except W.WledError as err:
                        back.append(f"{bi['name']} ({err})")
                await st.async_save()
                tail = f"; couldn't switch back: {', '.join(back)}" if back else "; the others were switched back"
                connection.send_error(msg["id"], "failed", f"{i['name']}: {e}{tail}")
                return
    else:
        failed = []
        for i in idents:
            rec = st.get(i["mac"])
            if not rec or not rec.get("exact"):
                continue
            if i["tgt"] is None:
                failed.append(f"{i['name']} (offline)")
                continue
            try:
                async with W.device_lock(hass, i["tgt"]["host"]):
                    await switch_to_wled(hass, rec, i["tgt"])
                members.append({"device_id": i["device_id"], "name": i["name"], "ok": True, "sync_off": None, "message": None})
            except W.WledError as e:
                failed.append(f"{i['name']} ({e})")
        if failed:
            await st.async_save()
            connection.send_error(msg["id"], "failed", f"Couldn't switch back: {', '.join(failed)} — the team is still run by PadSpan")
            return
    for i in idents:
        rec = st.get(i["mac"])
        if rec:
            rec["team_id"] = team["id"] if msg["mode"] == "padspan" else None
    new = [{**t, "mode": msg["mode"]} if t is team else t for t in stored]
    teams = W.sanitize_teams(hass, new, stored)
    if isinstance(teams, str):
        connection.send_error(msg["id"], "invalid", teams)
        return
    await sst.async_set(wled_teams=teams)
    await st.async_save()
    _refresh_listener(hass)
    saved = next((t for t in teams if t["id"] == team["id"]), None)
    connection.send_result(msg["id"], {"team": saved, "hash": W.cfg_hash(teams), "members": members})


@websocket_api.websocket_command({"type": "padspan_ha/wled_power", vol.Required("entity_id"): str,
                                  vol.Required("on"): bool,
                                  vol.Optional("brightness"): vol.All(int, vol.Range(min=1, max=255)),
                                  vol.Optional("transition"): vol.All(vol.Coerce(float), vol.Range(min=0, max=300)),
                                  vol.Optional("source", default="atlas"): vol.All(str, vol.Length(max=32))})
@websocket_api.async_response
async def ws_wled_power(hass: HomeAssistant, connection, msg) -> None:
    """On (with the look) / off / a brightness, for an exact light — open to
    any user, as HA's own light control is. A light PadSpan doesn't run (or
    no licence) gets a plain HA light call: {"handled": false}."""
    if not str(msg["entity_id"]).startswith("light."):
        connection.send_error(msg["id"], "invalid", "Only a light can be switched here")
        return
    try:
        res = await async_power(hass, msg["entity_id"], msg["on"], msg.get("brightness"),
                                source=msg.get("source") or "atlas", transition=msg.get("transition"))
    except Exception as err:  # noqa: BLE001 — the plain call's own errors
        connection.send_error(msg["id"], "failed", str(err)[:200])
        return
    connection.send_result(msg["id"], res)


WS_COMMANDS = (ws_wled_exact_list, ws_wled_look_get, ws_wled_look_remember, ws_wled_look_use_history,
               ws_wled_exact_set, ws_wled_team_mode, ws_wled_power)


# ── Services: padspan_ha.wled_on / padspan_ha.wled_off ───────────────────────


def _brightness_from(call_data: dict) -> int | None:
    pct = call_data.get("brightness_pct")
    return None if pct is None else max(1, min(255, round(float(pct) * 255 / 100)))


async def _service_entities(hass: HomeAssistant, call: Any) -> list[str]:
    try:
        from homeassistant.helpers.service import async_extract_entity_ids  # noqa: PLC0415
        found = async_extract_entity_ids(hass, call)
        if inspect.isawaitable(found):
            found = await found
        ids = set(found or ())
    except Exception:  # noqa: BLE001 — fall back to the entity_id field itself
        ids = set()
    raw = call.data.get("entity_id")
    if not ids and raw:
        ids = {raw} if isinstance(raw, str) else set(raw)
    return sorted(e for e in ids if isinstance(e, str) and e.startswith("light."))


def _service_schema() -> vol.Schema:
    return vol.Schema({
        vol.Optional("brightness_pct"): vol.All(vol.Coerce(float), vol.Range(min=1, max=100)),
        vol.Optional("transition"): vol.All(vol.Coerce(float), vol.Range(min=0, max=300)),
    }, extra=vol.ALLOW_EXTRA)


def async_register_services(hass: HomeAssistant) -> None:
    """For automations that want the look with no flash (the sunset
    automation's "select Solid, then turn_on" race). A light PadSpan doesn't
    run is switched by HA as usual, so a service call always does something."""
    async def _handle(call: Any, on: bool) -> None:
        ids = await _service_entities(hass, call)
        bri = _brightness_from(call.data) if on else None
        tr = call.data.get("transition")
        results = await asyncio.gather(*(async_power(hass, e, on, bri, source="service", transition=tr) for e in ids),
                                       return_exceptions=True)
        for e, r in zip(ids, results):
            if isinstance(r, BaseException):
                _LOGGER.warning("padspan_ha.wled_%s %s failed: %s", "on" if on else "off", e, r)

    async def _on(call: Any) -> None:
        await _handle(call, True)

    async def _off(call: Any) -> None:
        await _handle(call, False)

    hass.services.async_register(DOMAIN, "wled_on", _on, schema=_service_schema())
    hass.services.async_register(DOMAIN, "wled_off", _off, schema=_service_schema())
