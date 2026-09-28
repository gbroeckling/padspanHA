# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Emergency lighting test — the Atlas "Test emergency lighting" button (Garry,
2026-09-28: "If any of the lights are already on tag that so they are not
switched off when the button is toggled off, but have a force off button").

A MANUAL test/override only. Home Assistant's own power-failure automations
(automation.emergency_lights_power_failure / _power_restored) switch the same
lights on a real outage; nothing here reads, disables or repeats them.

WHICH LIGHTS (resolve_members), first that gives any:
  1. "settings"  the emergency_entities setting, when set;
  2. "group"     every HA group entity (group./light./switch. with a list
                 `entity_id` attribute) whose entity_id or name says
                 "emergenc", nested groups expanded, all of them unioned —
                 HA group helpers are single-domain, so the lights and the
                 PoE ports are two groups;
  3. "default"   switch.pakedge_poe_port_7/_8 if they exist, plus each WLED
                 device's light named "emergenc…" — one light per device: the
                 master light when HA shows it, otherwise its first segment.
The members are switched one by one, never the group entities themselves.

THE TAG: starting a test records the members already on (kept_on). Ending it
turns off only the others; Force off turns off every member. The test state
is a Store, so a restart mid-test keeps the tags.

BY HAND: the card behind the button's ring switches (or opens the controls
of) one member at a time (async_member). During a test such a member is
tagged `manual` and the end of the test leaves it as the person set it — on
or off — and a second start does not switch it back either. Force off still
turns it off.
"""

import asyncio
import datetime as _dt
import logging
import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_SETTINGS, DOMAIN, EMERGENCY_TEST_STORE_KEY

_LOGGER = logging.getLogger(__name__)

SETTING = "emergency_entities"
MATCH = "emergenc"
DEFAULT_SWITCHES = ("switch.pakedge_poe_port_7", "switch.pakedge_poe_port_8")
_GROUP_DOMAINS = ("group", "light", "switch")
# Only lights and switches are ever switched: the setting is writable by any
# user (settings_set is not admin-only), and a group. can hold anything.
_SWITCHABLE = ("light", "switch")
_DATA = "emergency_test"
_LOCK = "emergency_test_lock"
_EMPTY = {"active": False, "started_at": None, "kept_on": [], "manual": [], "members": []}


# ── Which lights ─────────────────────────────────────────────────────────────


def _name(hass: HomeAssistant, eid: str) -> str:
    st = hass.states.get(eid)
    name = st.attributes.get("friendly_name") if st is not None else None
    return str(name or eid)


def _group_members(st: Any) -> list[str] | None:
    ids = (getattr(st, "attributes", None) or {}).get("entity_id")
    return [str(e) for e in ids] if isinstance(ids, (list, tuple)) else None


def _expand(hass: HomeAssistant, eid: str, seen: set[str], out: list[str]) -> None:
    if eid in seen:
        return
    seen.add(eid)
    st = hass.states.get(eid)
    members = _group_members(st) if st is not None else None
    if members is None:
        out.append(eid)
        return
    for m in members:
        _expand(hass, m, seen, out)


def _from_groups(hass: HomeAssistant) -> tuple[list[str], list[str]]:
    groups: list[str] = []
    for st in hass.states.async_all():
        eid = str(st.entity_id)
        if eid.split(".", 1)[0] not in _GROUP_DOMAINS or _group_members(st) is None:
            continue
        name = str((st.attributes or {}).get("friendly_name") or "")
        if MATCH in eid.lower() or MATCH in name.lower():
            groups.append(eid)
    groups.sort()
    out: list[str] = []
    seen: set[str] = set()
    for g in groups:
        _expand(hass, g, seen, out)
    return groups, [e for e in dict.fromkeys(out) if e not in groups]


def _wled_role(uid: str) -> Any:
    """"main" for a WLED master light (unique_id <mac>), the segment number
    for <mac>_<n>, None otherwise — as in wled_exact.device_lights."""
    _base, _, seg = str(uid or "").partition("_")
    if not seg:
        return "main"
    return int(seg) if seg.isdigit() else None


def _from_default(hass: HomeAssistant) -> list[str]:
    from homeassistant.helpers import device_registry as dr, entity_registry as er  # noqa: PLC0415

    ents = er.async_get(hass)
    devs = dr.async_get(hass)
    out = [e for e in DEFAULT_SWITCHES if hass.states.get(e) is not None or ents.async_get(e) is not None]
    wled = [e for e in ents.entities.values()
            if getattr(e, "platform", None) == "wled" and str(e.entity_id).startswith("light.")
            and not getattr(e, "disabled_by", None)]

    def named(e: Any) -> bool:
        dev = devs.async_get(e.device_id) if e.device_id else None
        names = (getattr(e, "name", None), getattr(e, "original_name", None), _name(hass, e.entity_id),
                 getattr(dev, "name_by_user", None), getattr(dev, "name", None))
        return any(MATCH in str(n).lower() for n in names if n)

    by_device: dict[str, list[Any]] = {}
    for e in wled:
        if named(e):
            by_device.setdefault(e.device_id or e.entity_id, []).append(e)
    for key in sorted(by_device):
        cands = by_device[key]
        siblings = [e for e in wled if e.device_id and e.device_id == key] or cands
        main = next((e for e in siblings if _wled_role(e.unique_id) == "main"), None)
        st = hass.states.get(main.entity_id) if main is not None else None
        if st is not None and st.state != "unavailable":
            out.append(main.entity_id)          # HA shows the master light only for 2+ segments
            continue
        segs = sorted((e for e in cands if isinstance(_wled_role(e.unique_id), int)),
                      key=lambda e: (_wled_role(e.unique_id), e.entity_id))
        out.append((segs[0] if segs else sorted(cands, key=lambda e: e.entity_id)[0]).entity_id)
    return list(dict.fromkeys(out))


def resolve_members(hass: HomeAssistant) -> dict[str, Any]:
    """{source: "settings"|"group"|"default"|None, groups, members}."""
    st = (hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
    override = (st.data if st else {}).get(SETTING) or []
    ids = [e for e in override if isinstance(e, str) and e.startswith(("light.", "switch."))] \
        if isinstance(override, list) else []
    if ids:
        return {"source": "settings", "groups": [], "members": list(dict.fromkeys(ids))}
    groups, members = _from_groups(hass)
    if members:
        return {"source": "group", "groups": groups, "members": members}
    members = _from_default(hass)
    return {"source": "default" if members else None, "groups": [], "members": members}


# ── Test state (a Store: the tags survive a restart) ─────────────────────────


class EmergencyTestStore:
    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.store = Store(hass, 1, EMERGENCY_TEST_STORE_KEY)
        self.data: dict[str, Any] = dict(_EMPTY)

    async def async_load(self) -> None:
        loaded = await self.store.async_load()
        self.data = {**_EMPTY, **loaded} if isinstance(loaded, dict) else dict(_EMPTY)

    async def async_set(self, data: dict[str, Any]) -> None:
        self.data = data
        await self.store.async_save(data)


async def async_get_store(hass: HomeAssistant) -> EmergencyTestStore:
    dom = hass.data.setdefault(DOMAIN, {})
    lock = dom.setdefault(_LOCK, asyncio.Lock())
    if dom.get(_DATA) is None:
        async with lock:
            if dom.get(_DATA) is None:
                st = EmergencyTestStore(hass)
                await st.async_load()
                dom[_DATA] = st
    return dom[_DATA]


# ── Switching ────────────────────────────────────────────────────────────────


async def _switch(hass: HomeAssistant, eid: str, on: bool) -> dict[str, Any]:
    st = hass.states.get(eid)
    if st is None:
        return {"entity_id": eid, "ok": False, "skipped": "missing"}
    if st.state == "unavailable":
        return {"entity_id": eid, "ok": False, "skipped": "unavailable"}
    domain = eid.split(".", 1)[0]
    if domain not in _SWITCHABLE:
        return {"entity_id": eid, "ok": False, "skipped": "not a light or switch"}
    try:
        await hass.services.async_call(domain, "turn_on" if on else "turn_off",
                                       {"entity_id": eid}, blocking=True)
    except Exception as err:  # noqa: BLE001 — one member failing must not stop the rest
        _LOGGER.warning("Emergency lighting test: %s %s failed: %s", "on" if on else "off", eid, err)
        return {"entity_id": eid, "ok": False, "error": str(err)[:200]}
    return {"entity_id": eid, "ok": True}


async def _switch_all(hass: HomeAssistant, ids: list[str], on: bool) -> list[dict[str, Any]]:
    return list(await asyncio.gather(*(_switch(hass, e, on) for e in ids)))


async def async_status(hass: HomeAssistant) -> dict[str, Any]:
    res = resolve_members(hass)
    store = await async_get_store(hass)
    t = store.data
    members = []
    for eid in res["members"]:
        st = hass.states.get(eid)
        members.append({"entity_id": eid, "name": _name(hass, eid), "state": st.state if st is not None else "missing"})
    return {"available": bool(members), "source": res["source"], "groups": res["groups"], "members": members,
            "test": {"active": bool(t.get("active")), "started_at": t.get("started_at"),
                     "kept_on": list(t.get("kept_on") or []), "manual": list(t.get("manual") or [])}}


def _bump(hass: HomeAssistant, event: str) -> None:
    from .telemetry import bump  # noqa: PLC0415 — avoids an import cycle
    bump(hass, event)


def emergency_automations_since(hass: HomeAssistant, since: Any) -> list[str]:
    """Names of HA automations with "emergenc" in their id or name that ran
    after `since` (epoch seconds) - e.g. the power-failure automation."""
    try:
        since_ts = float(since)
    except (TypeError, ValueError):
        return []
    out: list[str] = []
    for st in hass.states.async_all("automation"):
        name = str(st.attributes.get("friendly_name") or st.entity_id)
        if "emergenc" not in (st.entity_id + " " + name).lower():
            continue
        last = st.attributes.get("last_triggered")
        try:
            if isinstance(last, _dt.datetime):
                ts = last.timestamp()
            else:
                ts = _dt.datetime.fromisoformat(str(last).replace("Z", "+00:00")).timestamp()
        except Exception:  # noqa: BLE001 - never triggered, or unreadable
            continue
        if ts > since_ts:
            out.append(name)
    return out


async def async_test(hass: HomeAssistant, on: bool) -> list[dict[str, Any]]:
    """Start (tag what is on, turn every member on) or end (turn off all
    but the tagged). A second start while one runs keeps the first tags."""
    store = await async_get_store(hass)
    async with hass.data[DOMAIN][_LOCK]:
        t = store.data
        if on:
            ids = resolve_members(hass)["members"]
            manual = list(t.get("manual") or []) if t.get("active") else []
            if t.get("active"):
                ids = list(dict.fromkeys([*t.get("members", []), *ids]))
                kept = list(t.get("kept_on") or [])
            else:
                kept = [e for e in ids if getattr(hass.states.get(e), "state", None) == "on"]
                _bump(hass, "emergency_test_on")
            await store.async_set({"active": True, "started_at": t.get("started_at") if t.get("active") else time.time(),
                                   "kept_on": kept, "manual": manual, "members": ids})
            return await _switch_all(hass, [e for e in ids if e not in kept and e not in manual], True)
        if not t.get("active"):
            return []
        # A real emergency during a test outranks the test: if Home
        # Assistant's own emergency automation (the power-failure one) ran
        # since the test started, the lights it turned on are the real thing.
        # Nothing is switched off; the test just ends. Force off still works.
        ran = emergency_automations_since(hass, t.get("started_at"))
        if ran:
            await store.async_set(dict(_EMPTY))
            _bump(hass, "emergency_test_off")
            return [{"entity_id": e, "ok": True, "kept": "emergency", "by": ran}
                    for e in t.get("members") or []]
        keep = {*(t.get("kept_on") or []), *(t.get("manual") or [])}
        ids = [e for e in t.get("members") or [] if e not in keep]
        await store.async_set(dict(_EMPTY))
        _bump(hass, "emergency_test_off")
        return await _switch_all(hass, ids, False)


async def async_force_off(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Every member off — the tagged ones too — and the test ended."""
    store = await async_get_store(hass)
    async with hass.data[DOMAIN][_LOCK]:
        ids = list(dict.fromkeys([*(store.data.get("members") or []), *resolve_members(hass)["members"]]))
        await store.async_set(dict(_EMPTY))
        _bump(hass, "emergency_force_off")
        return await _switch_all(hass, ids, False)


async def async_member(hass: HomeAssistant, eid: str, on: bool | None) -> list[dict[str, Any]] | None:
    """One member by hand: switched (on given) or only adjusted (its
    controls opened — on None). None when `eid` is not a member. During a
    test it is tagged manual, so the end of the test leaves it as set."""
    store = await async_get_store(hass)
    async with hass.data[DOMAIN][_LOCK]:
        t = store.data
        if eid not in {*resolve_members(hass)["members"], *(t.get("members") or [])}:
            return None
        if t.get("active") and eid not in (t.get("manual") or []):
            await store.async_set({**t, "manual": [*(t.get("manual") or []), eid]})
        return [] if on is None else [await _switch(hass, eid, on)]


# ── Websocket (any logged-in user: HA lets them switch these lights anyway) ──


@websocket_api.websocket_command({"type": "padspan_ha/emergency_status"})
@websocket_api.async_response
async def ws_emergency_status(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], await async_status(hass))


@websocket_api.websocket_command({"type": "padspan_ha/emergency_test", vol.Required("on"): bool})
@websocket_api.async_response
async def ws_emergency_test(hass: HomeAssistant, connection, msg) -> None:
    results = await async_test(hass, msg["on"])
    connection.send_result(msg["id"], {**await async_status(hass), "results": results})


@websocket_api.websocket_command({"type": "padspan_ha/emergency_force_off"})
@websocket_api.async_response
async def ws_emergency_force_off(hass: HomeAssistant, connection, msg) -> None:
    results = await async_force_off(hass)
    connection.send_result(msg["id"], {**await async_status(hass), "results": results})


@websocket_api.websocket_command({"type": "padspan_ha/emergency_member", vol.Required("entity_id"): str,
                                  vol.Optional("on"): bool})
@websocket_api.async_response
async def ws_emergency_member(hass: HomeAssistant, connection, msg) -> None:
    results = await async_member(hass, msg["entity_id"], msg.get("on"))
    if results is None:
        connection.send_error(msg["id"], "not_found", "Not one of the emergency lights")
        return
    connection.send_result(msg["id"], {**await async_status(hass), "results": results})


WS_COMMANDS = (ws_emergency_status, ws_emergency_test, ws_emergency_force_off, ws_emergency_member)
