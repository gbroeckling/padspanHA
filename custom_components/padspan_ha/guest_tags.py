# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Guest tags (0.38.178): a tag lent to a guest, and the stay it is lent for.

Garry, 2026-10-26: "build an option to have a tag used as a track guest in
house tag, with all the tools that would go with it." Off until it is chosen
in Settings (guest_tags_enabled): with it off nothing here runs, no file is
written and the presence poll does not call in.

THE TAG is a device PadSpan already tracks under a label the owner gave it
("Guest tag 1"), so its identity across address changes, its tracker entity
and its history are the ones every labelled device has. The label stays the
tag's: the guest's name belongs to the stay, never to the tag, so
device_tracker.padspan_guest_tag_1 is the same entity for every guest.

A STAY (session) is one guest with that tag, from start to end: who, until
when, the rooms they should not go into, the notices wanted, quiet hours,
and whether they count as someone home (a house-sitter does, for Vacation
Mode). Its summary — arrived, left, time in each room, off-limits visits,
notices — is kept as the stay goes, so it outlives Traceback's week. A
finished stay is kept guest_retention_days (30 by default), then deleted,
name and all. Names never leave this file's store: not the opt-in report, not
a backup.

The monitor runs from the presence poll with the poll's own result: present
or not (presence_rules.is_away, as arrivals and departures are), and the room.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DATA_SETTINGS, DOMAIN

_LOGGER = logging.getLogger(__name__)

STORE_KEY = "padspan_ha.guests"
DATA_GUESTS = "_guest_store"
SIGNAL_GUESTS = "padspan_ha_guest_update"
EVENT_GUEST = "padspan_ha_guest"
RETENTION_CHOICES = (0, 7, 30, 90)
OFFLIMITS_DWELL_S = 30          # a room passed through is not a visit
STALE_REMIND_S = 48 * 3600      # unseen this long: "is the stay over?"
STALE_END_S = 7 * 86400         # unseen this long: the stay ends itself
OFFLIMITS_LOG_MAX = 50
NAME_MAX = 60
TICK_MAX_S = 60                 # a poll gap longer than this is not counted as time in a room
SAVE_DELAY_S = 120


def enabled(hass: HomeAssistant) -> bool:
    st = (hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
    return bool(st and (st.data or {}).get("guest_tags_enabled"))


def retention_days(hass: HomeAssistant) -> int:
    st = (hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
    v = (st.data if st else {}).get("guest_retention_days", 30)
    return v if isinstance(v, int) and not isinstance(v, bool) and v in RETENTION_CHOICES else 30


def _new_sid() -> str:
    return "gs_" + os.urandom(4).hex()


def quiet_now(spec: str, at: datetime) -> bool:
    """True inside "HH:MM-HH:MM" (local), including one that runs past midnight."""
    try:
        a, b = str(spec or "").split("-", 1)
        s = int(a[:2]) * 60 + int(a[3:5])
        e = int(b[:2]) * 60 + int(b[3:5])
    except (ValueError, IndexError):
        return False
    t = at.hour * 60 + at.minute
    if s == e:
        return False
    return s <= t < e if s < e else (t >= s or t < e)


def valid_quiet(spec: Any) -> bool:
    if spec in (None, ""):
        return True
    try:
        a, b = str(spec).split("-", 1)
        return (len(a) == 5 and len(b) == 5 and a[2] == ":" and b[2] == ":"
                and 0 <= int(a[:2]) < 24 and 0 <= int(a[3:]) < 60 and 0 <= int(b[:2]) < 24 and 0 <= int(b[3:]) < 60)
    except ValueError:
        return False


def _empty_summary() -> dict:
    return {"first_in": None, "last_out": None, "arrivals": 0, "departures": 0, "rooms": {},
            "off_limits": [], "notices": 0, "last_seen": None}


class GuestStore:
    """The guest tags and their stays. Loaded on first use; no file until then."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store(hass, 1, STORE_KEY)
        self.data: dict[str, Any] = {"tags": {}, "sessions": {}}
        self.loaded = False

    async def async_load(self) -> None:
        if self.loaded:
            return
        raw = await self._store.async_load()
        if isinstance(raw, dict):
            self.data = {"tags": dict(raw.get("tags") or {}), "sessions": dict(raw.get("sessions") or {})}
        self.loaded = True

    def save(self) -> None:
        # Two minutes: a running stay's time per room is saved from the poll,
        # and an SD card should not be written every few seconds. Starting,
        # ending and forgetting a stay save at once (async_save_now).
        self._store.async_delay_save(lambda: self.data, SAVE_DELAY_S)

    async def async_save_now(self) -> None:
        await self._store.async_save(self.data)

    # ── tags ────────────────────────────────────────────────────────────────
    def tags(self) -> dict[str, dict]:
        return self.data["tags"]

    def mark(self, pid: str, label: str, keys: list[str], kind: str, now: float) -> dict:
        main = next((str(k) for k in keys if k), "")      # the snapshot key, for Traceback
        tag = {"pid": pid, "label": label[:48], "key": main, "keys": sorted({str(k) for k in keys if k})[:12],
               "kind": kind if kind in ("ibeacon", "private_ble", "findmy", "ble", "entity") else "ble",
               "marked_at": now}
        self.data["tags"][pid] = tag
        self.save()
        return tag

    def unmark(self, pid: str) -> bool:
        if self.active_for(pid):
            raise ValueError("This tag is lent to a guest; end the stay first.")
        found = self.data["tags"].pop(pid, None) is not None
        self.save()
        return found

    # ── stays ───────────────────────────────────────────────────────────────
    def sessions(self) -> dict[str, dict]:
        return self.data["sessions"]

    def active(self) -> list[dict]:
        return [s for s in self.data["sessions"].values() if not s.get("ended")]

    def active_for(self, pid: str) -> dict | None:
        return next((s for s in self.active() if s.get("pid") == pid), None)

    def start(self, pid: str, name: str, now: float, end_planned: float | None, opts: dict) -> dict:
        if pid not in self.data["tags"]:
            raise ValueError("That device is not a guest tag.")
        if self.active_for(pid):
            raise ValueError("This tag is already lent to a guest.")
        name = str(name or "").strip()[:NAME_MAX]
        if not name:
            raise ValueError("A guest name is needed.")
        sid = _new_sid()
        self.data["sessions"][sid] = {
            "id": sid, "pid": pid, "name": name, "start": now,
            "end_planned": end_planned if end_planned and end_planned > now else None,
            "ended": None, "end_how": None, "opts": clean_opts(opts),
            "summary": _empty_summary(), "live": {},
        }
        self.save()
        return self.data["sessions"][sid]

    def update(self, sid: str, now: float, **fields: Any) -> dict:
        s = self.data["sessions"].get(sid)
        if not s or s.get("ended"):
            raise ValueError("No such stay running.")
        if "name" in fields and str(fields["name"] or "").strip():
            s["name"] = str(fields["name"]).strip()[:NAME_MAX]
        if "end_planned" in fields:
            ep = fields["end_planned"]
            s["end_planned"] = ep if ep and ep > now else None
        if "opts" in fields:
            s["opts"] = clean_opts({**s.get("opts", {}), **(fields["opts"] or {})})
        self.save()
        return s

    def end(self, sid: str, now: float, how: str = "manual") -> dict:
        s = self.data["sessions"].get(sid)
        if not s or s.get("ended"):
            raise ValueError("No such stay running.")
        live = s.get("live") or {}
        if live.get("present"):
            s["summary"]["last_out"] = now
        s["ended"] = now
        s["end_how"] = how if how in ("manual", "scheduled", "stale") else "manual"
        s["live"] = {}
        self.save()
        return s

    def forget(self, sid: str) -> bool:
        s = self.data["sessions"].get(sid)
        if s and not s.get("ended"):
            raise ValueError("End the stay before forgetting it.")
        found = self.data["sessions"].pop(sid, None) is not None
        self.save()
        return found

    def prune(self, now: float, days: int) -> int:
        """Finished stays older than the retention go, name and all."""
        cut = now - days * 86400
        old = [k for k, s in self.data["sessions"].items() if s.get("ended") and s["ended"] <= cut]
        for k in old:
            del self.data["sessions"][k]
        if old:
            self.save()
        return len(old)


def clean_opts(o: dict | None) -> dict:
    o = o or {}
    rooms = [str(r)[:120] for r in (o.get("off_limits") or []) if isinstance(r, str) and r.strip()][:30]
    return {
        "off_limits": rooms,
        "notify_arrive": bool(o.get("notify_arrive", True)),
        "notify_leave": bool(o.get("notify_leave", True)),
        "notify_target": str(o.get("notify_target") or "")[:120],
        "quiet": str(o.get("quiet") or "") if valid_quiet(o.get("quiet")) else "",
        "counts_home": bool(o.get("counts_home", False)),
    }


async def async_get_store(hass: HomeAssistant) -> GuestStore:
    dom = hass.data.setdefault(DOMAIN, {})
    st = dom.get(DATA_GUESTS)
    if st is None:
        st = dom[DATA_GUESTS] = GuestStore(hass)
    await st.async_load()
    return st


def store_if_loaded(hass: HomeAssistant) -> GuestStore | None:
    st = (hass.data.get(DOMAIN) or {}).get(DATA_GUESTS)
    return st if st is not None and st.loaded else None


# ── matching a tag in the poll's result ─────────────────────────────────────

def tag_objects(tag: dict, result: dict) -> list[tuple[str, dict]]:
    """The poll's objects that are this tag: by its PadSpan id, one of its
    keys, or its label (a label can sit on two keys of one device)."""
    pid, keys = tag.get("pid"), set(tag.get("keys") or [])
    lbl = str(tag.get("label") or "").strip().lower()
    out = []
    for k, o in result.items():
        if not isinstance(o, dict):
            continue
        if (pid and o.get("padspan_id") == pid) or k in keys or (o.get("address") and o["address"] in keys) \
                or (lbl and str(o.get("user_label") or "").strip().lower() == lbl):
            out.append((k, o))
    return out


def tag_state(tag: dict, result: dict, present_keys: set[str]) -> tuple[bool, str | None, list[str]]:
    """(present, room, keys) — the room of the freshest present key."""
    objs = tag_objects(tag, result)
    here = [(k, o) for k, o in objs if k in present_keys]
    if not here:
        return False, None, [k for k, _ in objs]
    here.sort(key=lambda ko: ko[1].get("age_s") if isinstance(ko[1].get("age_s"), (int, float)) else 1e12)
    room = here[0][1].get("room") or None
    return True, room, [k for k, _ in objs]


# ── the monitor (pure step + glue) ──────────────────────────────────────────

def step(session: dict, present: bool, room: str | None, now: float, at_local: datetime) -> list[tuple[str, dict]]:
    """Advance one stay by one poll. Mutates the stay's live state and
    summary; returns the things that happened, as (kind, detail):
    arrived, left, off_limits, remind, end_scheduled, end_stale. Pure apart
    from the session dict it is given."""
    out: list[tuple[str, dict]] = []
    live = session.setdefault("live", {})
    summ = session.setdefault("summary", _empty_summary())
    opts = session.get("opts") or {}
    first = "present" not in live
    last_tick = live.get("tick")
    dt = min(max(0.0, now - last_tick), TICK_MAX_S) if isinstance(last_tick, (int, float)) else 0.0
    live["tick"] = now
    was = bool(live.get("present"))
    if was and live.get("room") and dt:
        rooms = summ.setdefault("rooms", {})
        rooms[live["room"]] = round(rooms.get(live["room"], 0) + dt, 1)
    if present:
        summ["last_seen"] = now
        live.pop("reminded", None)
        if not was:
            summ["arrivals"] = summ.get("arrivals", 0) + (0 if first else 1)
            if summ.get("first_in") is None:
                summ["first_in"] = now
            if not first:
                out.append(("arrived", {"room": room}))
        if room != live.get("room"):
            live["room"] = room
            live["room_since"] = now
            live.pop("off_noted", None)
        off = set(opts.get("off_limits") or [])
        if room and room in off and not live.get("off_noted") and now - live.get("room_since", now) >= OFFLIMITS_DWELL_S:
            live["off_noted"] = True
            log = summ.setdefault("off_limits", [])
            log.append([now, room])
            del log[:-OFFLIMITS_LOG_MAX]
            out.append(("off_limits", {"room": room}))
    else:
        if was:
            summ["departures"] = summ.get("departures", 0) + 1
            summ["last_out"] = now
            out.append(("left", {"room": live.get("room")}))
        live["room"] = None
        seen = summ.get("last_seen") or session.get("start") or now
        if now - seen >= STALE_END_S:
            out.append(("end_stale", {}))
        elif now - seen >= STALE_REMIND_S and not live.get("reminded"):
            live["reminded"] = True
            out.append(("remind", {}))
    live["present"] = present
    ep = session.get("end_planned")
    if ep and now >= ep and not any(k == "end_stale" for k, _ in out):
        out.append(("end_scheduled", {}))
    return out


def notice_text(kind: str, name: str, label: str, detail: dict) -> tuple[str, str] | None:
    room = detail.get("room")
    if kind == "arrived":
        return f"PadSpan: {name} arrived", f"{name} ({label}) arrived" + (f", in the {room}." if room else ".")
    if kind == "left":
        return (f"PadSpan: {name} left",
                f"{name}'s tag ({label}) is no longer heard" + (f"; last in the {room}." if room else ".")
                + " If the tag's battery is low this can look the same as leaving.")
    if kind == "off_limits":
        return f"PadSpan: {name} in the {room}", f"{name} ({label}) is in the {room}, a room set as off-limits for this stay."
    if kind == "remind":
        return (f"PadSpan: is {name}'s stay over?",
                f"{name}'s tag ({label}) has not been heard for two days. End the stay in PadSpan → Guests when the tag is back; "
                "after a week unheard it ends by itself.")
    if kind in ("end_scheduled", "end_stale"):
        why = "at its planned end" if kind == "end_scheduled" else "after a week without the tag being heard"
        return f"PadSpan: {name}'s stay ended", f"{name}'s stay with {label} ended {why}. Its report is in PadSpan → Guests."
    return None


async def _async_notify(hass: HomeAssistant, session: dict, title: str, message: str) -> bool:
    target = (session.get("opts") or {}).get("notify_target") or ""
    if target:
        try:
            from .presence_coordinator import async_send_follow_notify  # noqa: PLC0415
            await async_send_follow_notify(hass, target, "", title, message)
            return True
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Guest notice not sent via %s: %s", target, err)
            return False
    try:
        from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415
        async_create(hass, message, title=title, notification_id=f"padspan_ha_guest_{session.get('id')}")
        return True
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Guest notice not shown: %s", err)
        return False


def fire(hass: HomeAssistant, kind: str, session: dict, tag: dict | None, detail: dict | None = None) -> None:
    try:
        hass.bus.async_fire(EVENT_GUEST, {"type": kind, "session": session.get("id"), "guest": session.get("name"),
                                          "tag": (tag or {}).get("label"), **(detail or {})})
    except Exception:  # noqa: BLE001
        pass
    refresh(hass)


def refresh(hass: HomeAssistant) -> None:
    try:
        from homeassistant.helpers.dispatcher import async_dispatcher_send  # noqa: PLC0415
        async_dispatcher_send(hass, SIGNAL_GUESTS)
    except Exception:  # noqa: BLE001
        pass


def _bump(hass: HomeAssistant, name: str) -> None:
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, name)
    except Exception:  # noqa: BLE001
        pass


async def async_poll(hass: HomeAssistant, result: dict, present_keys: set[str], now: float | None = None) -> None:
    """Called by the presence poll. Nothing at all while guest tags are off."""
    if not enabled(hass):
        return
    st = await async_get_store(hass)
    now = time.time() if now is None else now
    from homeassistant.util import dt as dt_util  # noqa: PLC0415
    at_local = dt_util.as_local(dt_util.utc_from_timestamp(now))
    changed = False
    for s in list(st.active()):
        tag = st.tags().get(s.get("pid")) or {}
        present, room, _keys = tag_state(tag, result, present_keys)
        was = bool((s.get("live") or {}).get("present"))
        for kind, detail in step(s, present, room, now, at_local):
            changed = True
            if kind in ("end_scheduled", "end_stale"):
                st.end(s["id"], now, "scheduled" if kind == "end_scheduled" else "stale")
                if kind == "end_stale":
                    _bump(hass, "guest_stale_ended")
                fire(hass, "ended", s, tag, {"how": s.get("end_how")})
                _bump(hass, "guest_session_ended")
            else:
                fire(hass, {"off_limits": "off_limits", "remind": "reminder"}.get(kind, kind), s, tag, detail)
                if kind == "off_limits":
                    _bump(hass, "guest_offlimits_sent")
            opts = s.get("opts") or {}
            wanted = (kind == "arrived" and opts.get("notify_arrive")) or (kind == "left" and opts.get("notify_leave")) \
                or kind in ("off_limits", "remind", "end_scheduled", "end_stale")
            if not wanted:
                continue
            if kind in ("arrived", "left") and quiet_now(opts.get("quiet") or "", at_local):
                _bump(hass, "guest_quiet_held")
                continue
            text = notice_text(kind, s.get("name") or "Guest", tag.get("label") or "the tag", detail)
            if text and await _async_notify(hass, s, *text):
                s["summary"]["notices"] = s["summary"].get("notices", 0) + 1
                _bump(hass, "guest_notice_sent")
            elif text:
                _bump(hass, "guest_notice_failed")
        if present != was:
            changed = True
    # Retention, about once an hour.
    dom = hass.data.setdefault(DOMAIN, {})
    if now - dom.get("_guest_pruned", 0) > 3600:
        dom["_guest_pruned"] = now
        if st.prune(now, retention_days(hass)):
            changed = True
    if st.active():
        st.save()           # the running stays' time per room
    if changed:
        refresh(hass)


# ── what other parts of PadSpan ask ─────────────────────────────────────────

def session_for_object(hass: HomeAssistant, obj: dict) -> tuple[dict, dict] | None:
    """(session, tag) for an object that is a guest tag lent right now."""
    st = store_if_loaded(hass)
    if st is None or not enabled(hass) or not isinstance(obj, dict):
        return None
    for s in st.active():
        tag = st.tags().get(s.get("pid")) or {}
        if tag_objects(tag, {"_": obj}):
            return s, tag
    return None


def key_in_active_session(hass: HomeAssistant, key: str, obj: dict | None = None) -> bool:
    """Follow's own alerts stay quiet for a tag while it is lent (the stay sends its own)."""
    st = store_if_loaded(hass)
    if st is None or not enabled(hass):
        return False
    for s in st.active():
        tag = st.tags().get(s.get("pid")) or {}
        if key in set(tag.get("keys") or []) or (obj is not None and tag_objects(tag, {"_": obj})):
            return True
    return False


def counts_home_present(hass: HomeAssistant) -> bool:
    """A stay set to count as someone home (a house-sitter), with its tag here."""
    st = store_if_loaded(hass)
    if st is None or not enabled(hass):
        return False
    return any((s.get("opts") or {}).get("counts_home") and (s.get("live") or {}).get("present") for s in st.active())


def anyone_guest_home(hass: HomeAssistant) -> bool:
    st = store_if_loaded(hass)
    if st is None or not enabled(hass):
        return False
    return any((s.get("live") or {}).get("present") for s in st.active())


def tracker_attributes(hass: HomeAssistant, obj: dict) -> dict:
    found = session_for_object(hass, obj)
    if not found:
        return {}
    s, _tag = found
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    def iso(ts: Any) -> str | None:
        return dt_util.utc_from_timestamp(ts).isoformat() if isinstance(ts, (int, float)) and ts > 0 else None
    live = s.get("live") or {}
    off = (s.get("opts") or {}).get("off_limits") or []
    return {"guest_session": s.get("id"), "guest_name": s.get("name"), "guest_since": iso(s.get("start")),
            "guest_until": iso(s.get("end_planned")), "guest_off_limits": off,
            "guest_in_off_limits": bool(live.get("room") and live.get("room") in off)}


def snapshot_overlay(hass: HomeAssistant, objects: list[dict]) -> None:
    """Mark each lent tag's objects in the snapshot copy with its guest (the
    Overview, Atlas and Live Aboard draw a Guest badge from it)."""
    st = store_if_loaded(hass)
    if st is None or not enabled(hass):
        return
    act = st.active()
    if not act:
        return
    for o in objects:
        for s in act:
            tag = st.tags().get(s.get("pid")) or {}
            if tag_objects(tag, {"_": o}):
                o["guest"] = {"name": s.get("name"), "session": s.get("id")}
                break


# ── reports ─────────────────────────────────────────────────────────────────

def session_out(s: dict, tag: dict | None, now: float) -> dict:
    live = s.get("live") or {}
    summ = s.get("summary") or {}
    end = s.get("ended") or now
    return {"id": s.get("id"), "pid": s.get("pid"), "name": s.get("name"), "tag": (tag or {}).get("label"),
            "start": s.get("start"), "end_planned": s.get("end_planned"), "ended": s.get("ended"),
            "end_how": s.get("end_how"), "opts": s.get("opts") or {},
            "present": bool(live.get("present")), "room": live.get("room"),
            "summary": {**summ, "length_s": round(end - (s.get("start") or end))}}


REPORT_WORDS = {
    "tags": ("1", "2-3", "4+"),
    "active": ("0", "1", "2+"),
    "sessions_30d": ("0", "1", "2-5", "6+"),
    "length": ("<1d", "1-3d", "4-14d", "15d+", "open"),
    "end_how": ("manual", "scheduled", "stale", "none"),
    "off_limits_rooms": ("0", "1-2", "3+"),
    "counts_home": ("yes", "no"),
    "quiet": ("yes", "no"),
    "tag_kind": ("ibeacon", "private_ble", "findmy", "ble", "entity"),
    "retention": ("0", "7", "30", "90"),
}


def _b(n: float, edges: tuple, words: tuple) -> str:
    for e, w in zip(edges, words):
        if n <= e:
            return w
    return words[-1]


def report_buckets(hass: HomeAssistant, now: float) -> dict | None:
    """env.guest for the opt-in report: words only, never a name, and only
    where guest tags are on and have a tag."""
    st = store_if_loaded(hass)
    if st is None or not enabled(hass) or not st.tags():
        return None
    ses = list(st.sessions().values())
    recent = [s for s in ses if (s.get("ended") or now) >= now - 30 * 86400]
    last = max(ses, key=lambda s: s.get("start") or 0) if ses else None
    out = {"tags": _b(len(st.tags()), (1, 3), REPORT_WORDS["tags"]),
           "active": _b(len(st.active()), (0, 1), REPORT_WORDS["active"]),
           "sessions_30d": _b(len(recent), (0, 1, 5), REPORT_WORDS["sessions_30d"]),
           "retention": str(retention_days(hass))}
    kinds = [t.get("kind") for t in st.tags().values() if t.get("kind") in REPORT_WORDS["tag_kind"]]
    if kinds:
        out["tag_kind"] = max(set(kinds), key=kinds.count)
    if last:
        o = last.get("opts") or {}
        if last.get("ended"):
            d = (last["ended"] - (last.get("start") or last["ended"])) / 86400
            out["length"] = _b(d, (1, 3, 14), ("<1d", "1-3d", "4-14d", "15d+"))
        else:
            out["length"] = "open"
        out["end_how"] = last.get("end_how") if last.get("end_how") in ("manual", "scheduled", "stale") else "none"
        out["off_limits_rooms"] = _b(len(o.get("off_limits") or []), (0, 2), REPORT_WORDS["off_limits_rooms"])
        out["counts_home"] = "yes" if o.get("counts_home") else "no"
        out["quiet"] = "yes" if o.get("quiet") else "no"
    return out
