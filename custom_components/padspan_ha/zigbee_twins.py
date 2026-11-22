# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""One Zigbee device in Home Assistant twice (2026-11-22).

The same physical Zigbee device can be in Home Assistant once through ZHA and
once through Zigbee2MQTT (MQTT), both with its one 64-bit Zigbee address
(IEEE). Found on a real home: 37 addresses in both, two of them the
coordinator sticks. PadSpan used to offer both copies in its lists, so a
sensor could be wired to the stale one.

The owner's rules: do not double up sensors; when a device is in both, use the
Zigbee2MQTT one first (the other copy is the duplicate); PadSpan never changes
Home Assistant itself (no disabling, removing or renaming), it only chooses
and shows; and it notices a new copy when it appears, not by polling.

How a copy is known, from Home Assistant's device registry (the shapes the
integrations register):
  * Zigbee2MQTT: identifier ("mqtt", "zigbee2mqtt_0x00158d0001a2b3c4"); its
    bridge, the coordinator, is ("mqtt", "zigbee2mqtt_bridge_0x...").
  * ZHA: identifier ("zha", "00:15:8d:00:01:a2:b3:c4") and connection
    ("zigbee", the same); its coordinator is the one ZHA device with no
    via_device (every other ZHA device is registered via it).
  * deCONZ, and anything else: the connection ("zigbee", address).
A coordinator or bridge, and any device other Zigbee devices are registered
via, is never a duplicate: its address is left out. A disabled device is not
offered anywhere, so it is no copy either. Copies within one integration are
not this problem and are left alone.

The copy PadSpan keeps: Zigbee2MQTT, then ZHA, then deCONZ, then any other.
Each entity of another copy maps to the kept copy's entity that measures the
same thing (find_twin): the same domain and kind of device class, narrowed by
device class, unit, category and name. One left is its twin; several is no
twin ("" , so the panel names the device and lets the person pick); none
means the kept copy measures nothing like it, and it is not a duplicate.

The panel gets the map in its settings (ws_common._get_settings: no request of
its own), computed once and again only after a registry change.

When a new device turns out to be the same unit as one already in another
integration (device_registry_updated, create, or an update that changes what
identifies it), the administrator is told once, in a Home Assistant
notification naming both copies; settings[TOLD_KEY] remembers each pair told.
The pairs already there when this version first runs are told once, together
(async_tell_existing, at setup: one read, no poll), and remembered the same way.

"Use the Zigbee2MQTT one" (padspan_ha/zigbee_twin_use, async_use_twin): the
kept copy's entity takes the duplicate's place everywhere PadSpan keeps an
entity: every setting naming it (its shape, type, hidden from the map, a
chosen sensor, power teams, door openers, Vacation Mode's lights...), its
place on the map with its looks, label and height, the walls linked to it
(with their invert), and Live Aboard's links, heights and runs. What the kept
entity already has of its own stays; the duplicate's entries go. Only when
the person presses it, and nothing in Home Assistant changes.
"""

from __future__ import annotations

import asyncio
import copy
import functools
import logging
import re
from typing import Any, Iterable

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback as ha_callback

from .const import DATA_MODEL, DATA_SETTINGS, DOMAIN
from .quiet_errors import note as _quiet_error
from .util import ha_devices
from .ws_common import admin_if_enhanced_security

_LOGGER = logging.getLogger(__name__)

Z2M, ZHA, DECONZ = "zigbee2mqtt", "zha", "deconz"
# The integrations' own names, for the panel and the notice.
WORDS = {Z2M: "Zigbee2MQTT", ZHA: "ZHA", DECONZ: "deCONZ"}
# Which copy is kept: the lowest rank (any other integration ranks after these).
RANK = {Z2M: 0, ZHA: 1, DECONZ: 2}
_Z2M_ID = re.compile(r"zigbee2mqtt_(bridge_)?0x([0-9a-fA-F]{16})")
# Device classes the integrations give the same sensor differently: Zigbee2MQTT
# calls a contact sensor "door" where ZHA says "opening", occupancy where ZHA
# says "motion".
_FAMILY = {"motion": "motion", "occupancy": "motion", "presence": "motion",
           "door": "opening", "window": "opening", "opening": "opening", "garage_door": "opening"}
# What in a device registry update can make (or unmake) a copy.
_IDENTIFYING = frozenset({"identifiers", "connections", "disabled_by", "config_entries", "config_entry_id"})

TOLD_KEY = "zigbee_twins_told"      # settings: the pairs the administrator was told about
TOLD_MAX = 500                      # kept at most (the oldest go first)
EXISTING = "existing"               # in TOLD_KEY: the pairs already there at first run were told
SUMMARY_MAX = 10                    # pairs the first run's notice names; the rest are counted

_DATA_CACHE = "_zigbee_twins"
_DATA_UNSUB = "_zigbee_twins_unsub"
_DATA_LOCK = "_zigbee_twins_lock"


def zigbee_address(raw: Any) -> str | None:
    """A Zigbee address as 16 lower-case hex digits, from any of the ways the
    integrations write it ("0x00158D...", "00:15:8d:..."), or None."""
    s = str(raw or "").strip().lower()
    if s.startswith("0x"):
        s = s[2:]
    s = s.replace(":", "").replace("-", "")
    return s if len(s) == 16 and all(c in "0123456789abcdef" for c in s) else None


def _pairs(v: Any) -> list[tuple[str, str]]:
    out = []
    for p in v or ():
        if isinstance(p, (tuple, list)) and len(p) == 2:
            out.append((str(p[0]), str(p[1])))
    return out


def device_copy(dev: Any) -> tuple[str, str, bool] | None:
    """(address, integration, is_bridge) for a device registry entry that is a
    Zigbee device, else None. is_bridge: a Zigbee2MQTT bridge (a coordinator)."""
    idents = _pairs(getattr(dev, "identifiers", None))
    for dom, val in idents:
        if dom == "mqtt":
            m = _Z2M_ID.fullmatch(val)
            if m:
                return m.group(2).lower(), Z2M, bool(m.group(1))
        elif dom == ZHA:
            addr = zigbee_address(val)
            if addr:
                return addr, ZHA, False
    for kind, val in _pairs(getattr(dev, "connections", None)):
        if kind == "zigbee":
            addr = zigbee_address(val)
            if addr:
                return addr, (idents[0][0] if idents else "zigbee"), False
    return None


def _name(dev: Any) -> str:
    return str(getattr(dev, "name_by_user", None) or getattr(dev, "name", None) or "Unnamed device")


def words(integration: str) -> str:
    return WORDS.get(integration) or integration.replace("_", " ").title()


def _what(e: Any) -> dict[str, Any]:
    dc = getattr(e, "device_class", None) or getattr(e, "original_device_class", None)
    dc = str(getattr(dc, "value", dc)) if dc else None
    cat = getattr(e, "entity_category", None)
    return {"domain": str(e.entity_id).split(".", 1)[0], "dc": dc, "family": _FAMILY.get(dc or "", dc),
            "unit": getattr(e, "unit_of_measurement", None) or None,
            "category": str(getattr(cat, "value", cat)) if cat else None,
            "key": getattr(e, "translation_key", None) or None,
            "name": str(getattr(e, "original_name", None) or "").strip().casefold() or None}


def find_twin(entry: Any, kept: Iterable[Any]) -> str | None:
    """The kept copy's entity that measures what `entry` does: its entity id
    when there is exactly one, "" when several could be, None when none
    (then `entry` is not a duplicate of anything). Same domain and kind of
    device class first; then each of device class, unit, category, the
    integration's key and the entity's own name narrows the choice, as long
    as something is left."""
    w = _what(entry)
    cands = [(k, _what(k)) for k in kept]
    cands = [c for c in cands if c[1]["domain"] == w["domain"] and c[1]["family"] == w["family"]]
    if not cands:
        return None
    for field in ("dc", "unit", "category", "key", "name"):
        same = [c for c in cands if c[1][field] == w[field]]
        if same:
            cands = same
    return str(cands[0][0].entity_id) if len(cands) == 1 else ""


def find_twins(devices: Iterable[Any], entities: Iterable[Any]) -> dict[str, Any]:
    """The duplicates among Home Assistant's devices.

    {"devices": {copy's device id: {name, via, twin, twin_name, twin_via}},
     "entities": {copy's entity id: {twin: entity id or "", device: copy's device id}},
     "pairs": [{key, address, keep, copies}]}: `via` the integration's name,
    `twin` the kept device; `key` names the pair for the once-only notice."""
    devices = list(devices)
    copies: dict[str, tuple[str, str]] = {}
    coordinators: set[str] = set()
    for dev in devices:
        c = device_copy(dev)
        if c is None:
            continue
        addr, integ, bridge = c
        if bridge or (integ == ZHA and not getattr(dev, "via_device_id", None)):
            coordinators.add(addr)
            continue
        copies[str(dev.id)] = (addr, integ)
    by_id = {str(d.id): d for d in devices}
    for dev_id in copies:
        parent = getattr(by_id[dev_id], "via_device_id", None)
        if parent and str(parent) in copies:
            coordinators.add(copies[str(parent)][0])     # other Zigbee devices go through it
    groups: dict[str, list[Any]] = {}
    for dev_id, (addr, _integ) in copies.items():
        dev = by_id[dev_id]
        if addr not in coordinators and not getattr(dev, "disabled_by", None):
            groups.setdefault(addr, []).append(dev)
    out: dict[str, Any] = {"devices": {}, "entities": {}, "pairs": []}
    wanted: dict[str, tuple[Any, Any]] = {}
    for addr in sorted(groups):
        devs = sorted(groups[addr], key=lambda d: (RANK.get(copies[str(d.id)][1], 9), copies[str(d.id)][1], str(d.id)))
        keep, kinteg = devs[0], copies[str(devs[0].id)][1]
        dups = [d for d in devs[1:] if copies[str(d.id)][1] != kinteg]
        if not dups:
            continue
        integs = sorted({copies[str(d.id)][1] for d in devs})
        out["pairs"].append({"key": f"{addr}:{'+'.join(integs)}", "address": addr, "keep": str(keep.id),
                             "copies": [str(d.id) for d in dups]})
        for d in dups:
            out["devices"][str(d.id)] = {"name": _name(d), "via": words(copies[str(d.id)][1]), "twin": str(keep.id),
                                         "twin_name": _name(keep), "twin_via": words(kinteg)}
            wanted[str(d.id)] = (d, keep)
    if not wanted:
        return out
    need = set(wanted) | {str(k.id) for _d, k in wanted.values()}
    by_dev: dict[str, list[Any]] = {}
    for e in entities:
        did = getattr(e, "device_id", None)
        if did and str(did) in need and not getattr(e, "disabled_by", None):
            by_dev.setdefault(str(did), []).append(e)
    for dup_id, (_d, keep) in wanted.items():
        kept = by_dev.get(str(keep.id), [])
        for e in sorted(by_dev.get(dup_id, []), key=lambda x: str(x.entity_id)):
            twin = find_twin(e, kept)
            if twin is not None:
                out["entities"][str(e.entity_id)] = {"twin": twin, "device": dup_id}
    return out


def _read(hass: HomeAssistant) -> dict[str, Any]:
    from homeassistant.helpers import device_registry as dr, entity_registry as er  # noqa: PLC0415
    return find_twins(ha_devices(dr.async_get(hass)), er.async_get(hass).entities.values())


def twins(hass: HomeAssistant) -> dict[str, Any]:
    """find_twins on this Home Assistant, kept until a registry changes (kept
    only while the listeners below run, which is what says it changed)."""
    dom = hass.data.get(DOMAIN)
    listening = isinstance(dom, dict) and bool(dom.get(_DATA_UNSUB))
    if listening and dom.get(_DATA_CACHE) is not None:
        return dom[_DATA_CACHE]
    try:
        out = _read(hass)
    except Exception:  # noqa: BLE001 — no registry to read: no duplicates to show
        _quiet_error("zigbee_twins:read")
        out = {"devices": {}, "entities": {}, "pairs": []}
    if listening:
        dom[_DATA_CACHE] = out
    return out


def panel_twins(hass: HomeAssistant) -> dict[str, Any]:
    """What the panel needs (ws_common._get_settings): the copies and their
    entities, never the addresses."""
    t = twins(hass)
    return {"devices": t["devices"], "entities": t["entities"]}


def notice(pair: dict[str, Any], new_id: str, devices: dict[str, Any]) -> tuple[str, str]:
    """(title, message) telling the administrator that `new_id` is the same
    unit as a device already in another integration."""
    keep = pair["keep"]
    dup_info = devices[pair["copies"][0]]
    kept_words, kept_name = dup_info["twin_via"], dup_info["twin_name"]
    if new_id == keep:
        new_words, new_name = kept_words, kept_name
        others = [devices[c] for c in pair["copies"]]
    else:
        new_words, new_name = devices[new_id]["via"], devices[new_id]["name"]
        others = [{"via": kept_words, "name": kept_name}] + [devices[c] for c in pair["copies"] if c != new_id]
    already = " and ".join(f"{o['via']} as **{o['name']}**" for o in others)
    left_out = " and ".join(sorted({devices[c]["via"] for c in pair["copies"]}))
    return ("PadSpan: a Zigbee device is in Home Assistant twice",
            f"{new_words} just added **{new_name}**, a device already in {already}: the same Zigbee address, "
            f"so the same unit. PadSpan uses the {kept_words} one and leaves the {left_out} copy out of its lists, "
            "so nothing is counted twice. Home Assistant itself is unchanged.")


async def async_tell(hass: HomeAssistant, device_id: str) -> bool:
    """Tell the administrator once that `device_id` is the same unit as a
    device in another integration. True when told now."""
    dom = hass.data.get(DOMAIN)
    st = dom.get(DATA_SETTINGS) if isinstance(dom, dict) else None
    if st is None:
        return False
    lock = dom.setdefault(_DATA_LOCK, asyncio.Lock())
    async with lock:                                # two new devices at once must not both miss the other's write
        t = twins(hass)
        pair = next((p for p in t["pairs"] if device_id == p["keep"] or device_id in p["copies"]), None)
        told = [k for k in (st.data.get(TOLD_KEY) or []) if isinstance(k, str)]
        if pair is None or pair["key"] in told:
            return False
        title, message = notice(pair, device_id, t["devices"])
        try:
            from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415
            async_create(hass, message, title=title, notification_id=f"padspan_ha_zigbee_twin_{pair['address']}")
        except Exception:  # noqa: BLE001 — not told: try again on the next change
            _quiet_error("zigbee_twins:notify")
            return False
        await st.async_set(**{TOLD_KEY: (told + [pair["key"]])[-TOLD_MAX:]})
        return True


def existing_notice(pairs: list[dict[str, Any]], devices: dict[str, Any]) -> tuple[str, str]:
    """(title, message) for the pairs already there when this version first
    runs: how many, which copy is used, at most SUMMARY_MAX by name, then how
    many more."""
    rows = sorted(((devices[p["copies"][0]], p) for p in pairs), key=lambda r: r[0]["twin_name"].casefold())
    kept = sorted({d["twin_via"] for d, _p in rows})
    n = len(rows)
    lines = [f"- **{d['twin_name']}** ({d['twin_via']}), also in "
             + " and ".join(f"{devices[c]['via']} as **{devices[c]['name']}**" for c in p["copies"])
             for d, p in rows[:SUMMARY_MAX]]
    if n > SUMMARY_MAX:
        lines.append(f"- and {n - SUMMARY_MAX} more")
    used = f"the {kept[0]} copy" if len(kept) == 1 else "the Zigbee2MQTT copy where there is one (else ZHA, then deCONZ)"
    head = "A Zigbee device is in Home Assistant twice" if n == 1 else f"{n} Zigbee devices are in Home Assistant twice"
    title = "PadSpan: a Zigbee device is in Home Assistant twice" if n == 1 else f"PadSpan: {head}"
    return (title,
            f"{head}, with the same Zigbee address in two integrations. PadSpan uses {used} and leaves the other "
            "out of its lists, so nothing is counted twice:\n\n" + "\n".join(lines) + "\n\n"
            "Where PadSpan already uses a copy it leaves out, it says so, with a button to use the other one. "
            "Home Assistant itself is unchanged.")


async def async_tell_existing(hass: HomeAssistant) -> bool:
    """Once ever: the pairs already in Home Assistant when this version first
    runs, in one notification (nothing when there are none), each then
    remembered as told. True when told now."""
    dom = hass.data.get(DOMAIN)
    st = dom.get(DATA_SETTINGS) if isinstance(dom, dict) else None
    if st is None:
        return False
    lock = dom.setdefault(_DATA_LOCK, asyncio.Lock())
    async with lock:
        told = [k for k in (st.data.get(TOLD_KEY) or []) if isinstance(k, str)]
        if EXISTING in told:
            return False
        t = twins(hass)
        fresh = [p for p in t["pairs"] if p["key"] not in told]
        if fresh:
            title, message = existing_notice(fresh, t["devices"])
            try:
                from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415
                async_create(hass, message, title=title, notification_id="padspan_ha_zigbee_twins_existing")
            except Exception:  # noqa: BLE001 — not told: try again at the next start
                _quiet_error("zigbee_twins:notify_existing")
                return False
        keys = [k for k in told if k != EXISTING] + [p["key"] for p in fresh]
        await st.async_set(**{TOLD_KEY: [EXISTING] + keys[-(TOLD_MAX - 1):]})
        return bool(fresh)


# ── "Use the Zigbee2MQTT one" ───────────────────────────────────────────────

def rekey(value: Any, old: str, new: str) -> tuple[Any, int]:
    """`value` with the entity id `old` made `new` wherever it is a value or a
    key, and how many places that was. A key `new` already has keeps its own
    entry (the duplicate's goes); a list names `new` once. Unchanged, the
    value itself comes back."""
    if isinstance(value, str):
        return (new, 1) if value == old else (value, 0)
    if isinstance(value, list):
        out, n, seen = [], 0, False
        for x in value:
            y, m = rekey(x, old, new)
            n += m
            if isinstance(y, str) and y == new:
                if seen:
                    continue
                seen = True
            out.append(y)
        return (out, n) if n else (value, 0)
    if isinstance(value, dict):
        d, n = {}, 0
        for k, x in value.items():
            if k == old:
                n += 1
                if new in value:
                    continue
                k = new
            y, m = rekey(x, old, new)
            n += m
            d[k] = y
        return (d, n) if n else (value, 0)
    return value, 0


async def _async_house3d_use(hass: HomeAssistant, old: str, new: str) -> int:
    """Live Aboard's file: `old`'s height, run and look (lights, devices), the
    openings that follow it and the pieces linked to it, now `new`'s. One
    write under the file's lock, only with something to change; a file that
    is not there, cannot be read or is a newer PadSpan's is left alone."""
    from .house3d_store import ReadFailed, async_file_exists, async_get_store, writable  # noqa: PLC0415
    if not await async_file_exists(hass):
        return 0
    try:
        store = await async_get_store(hass)
    except ReadFailed:
        return 0
    reg_id = None
    try:
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
        entry = er.async_get(hass).async_get(new)
        reg_id = getattr(entry, "id", None) if entry else None
    except Exception:  # noqa: BLE001 — the link follows a rename only with it
        _quiet_error("zigbee_twins:registry_id")
    async with store.lock:
        if not writable(store.data):
            return 0
        data, n = copy.deepcopy(store.data), 0
        for section in ("lights", "devices"):
            sec = data.get(section)
            if isinstance(sec, dict) and old in sec:
                e = sec.pop(old)
                n += 1
                sec.setdefault(new, e)
        for o in (data.get("openings") or {}).values():
            if isinstance(o, dict) and o.get("link") == old:
                o["link"] = new
                n += 1
        for p in (data.get("pieces") or {}).values():
            if isinstance(p, dict) and p.get("entity_id") == old:
                p["entity_id"] = new
                p["entity_reg_id"] = reg_id if isinstance(reg_id, str) else None
                n += 1
        if n and not await store.async_write(data):
            _LOGGER.error("PadSpan: Live Aboard's links to %s could not be moved to %s (the file was not written)", old, new)
            return 0
        return n


async def async_use_twin(hass: HomeAssistant, old: str, new: str) -> dict[str, int]:
    """Make `new` (the kept copy's entity) what PadSpan uses wherever it used
    `old` (a duplicate copy's), and take `old`'s entries out: {settings,
    placement, walls, live_aboard} counted."""
    dom = hass.data.get(DOMAIN) or {}
    moved = {"settings": 0, "placement": 0, "walls": 0, "live_aboard": 0}
    st = dom.get(DATA_SETTINGS)
    if st is not None:
        changed: dict[str, Any] = {}
        for key, value in st.data.items():
            if key == TOLD_KEY:
                continue
            v, n = rekey(value, old, new)
            if n:
                changed[key], moved["settings"] = v, moved["settings"] + n
        if "power_teams" in changed:
            from .power_team import sanitize_teams  # noqa: PLC0415
            teams = sanitize_teams(changed["power_teams"])
            if isinstance(teams, str):
                changed.pop("power_teams")
            else:
                changed["power_teams"] = teams
        if changed:
            await st.async_set(**changed)
        if "power_teams" in changed:                # as padspan_ha/power_teams_set: the teams run with it at once
            try:
                from .power_team import SIGNAL_TEAMS, async_setup_power_teams  # noqa: PLC0415
                async_setup_power_teams(hass)
                from homeassistant.helpers.dispatcher import async_dispatcher_send  # noqa: PLC0415
                async_dispatcher_send(hass, SIGNAL_TEAMS)
            except Exception:  # noqa: BLE001 — saved; the teams take it at the next start
                _quiet_error("zigbee_twins:power_teams")
    mdl = dom.get(DATA_MODEL)
    fab = getattr(mdl, "fabric", None)
    if fab is not None:
        placed = mdl.light_positions_m()            # each record with its height
        set_lights = {new: dict(placed[old])} if old in placed and new not in placed else {}
        bars = []
        for b in fab.rf_barriers_m():
            nb, n = rekey(b, old, new)
            if n:
                bars.append(nb)
        if old in placed or bars:
            await fab.async_spatial_update(set_lights=set_lights or None, remove_lights=[old] if old in placed else None,
                                           set_barriers=bars or None, op="zigbee_twin_use")
            moved["placement"], moved["walls"] = int(old in placed), len(bars)
    moved["live_aboard"] = await _async_house3d_use(hass, old, new)
    _LOGGER.info("PadSpan: %s is used in place of %s (its Zigbee duplicate): %s", new, old, moved)
    return moved


@websocket_api.websocket_command({
    "type": "padspan_ha/zigbee_twin_use",
    vol.Required("entity_id"): str,
    vol.Required("twin"): str,
})
@websocket_api.async_response
@admin_if_enhanced_security
async def ws_zigbee_twin_use(hass: HomeAssistant, connection, msg) -> None:
    """Use the Zigbee2MQTT copy's entity wherever PadSpan uses its duplicate's (async_use_twin): {ok, moved, settings}.

    Only for a duplicate copy and the one twin find_twins gives it, so a stale
    page can move nothing it should not."""
    old, new = str(msg["entity_id"]).strip(), str(msg["twin"]).strip()
    entry = twins(hass)["entities"].get(old)
    if not entry or not entry.get("twin") or entry["twin"] != new:
        connection.send_error(msg["id"], "not_a_duplicate",
                              "That is no longer a duplicate of that device. Refresh the page and try again.")
        return
    moved = await async_use_twin(hass, old, new)
    from .ws_common import _get_settings  # noqa: PLC0415
    connection.send_result(msg["id"], {"ok": True, "moved": moved, "settings": _get_settings(hass, connection)})


WS_COMMANDS = (ws_zigbee_twin_use,)


@ha_callback
def _on_device_registry_updated(hass: HomeAssistant, event: Any) -> None:
    dom = hass.data.get(DOMAIN)
    if not isinstance(dom, dict):
        return
    dom[_DATA_CACHE] = None
    data = getattr(event, "data", None) or {}
    action, device_id = data.get("action"), data.get("device_id")
    if not isinstance(device_id, str):
        return
    if action == "create" or (action == "update" and _IDENTIFYING & set(data.get("changes") or {})):
        hass.async_create_task(async_tell(hass, device_id))


@ha_callback
def _on_entity_registry_updated(hass: HomeAssistant, event: Any) -> None:
    dom = hass.data.get(DOMAIN)
    if isinstance(dom, dict):
        dom[_DATA_CACHE] = None


def async_setup_zigbee_twins(hass: HomeAssistant) -> None:
    """Listen to the device and entity registries (no poll, no timer).
    Idempotent across config-entry reloads (flood_latch.py's shape)."""
    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_DATA_UNSUB):
        return
    dom[_DATA_CACHE] = None
    dom[_DATA_UNSUB] = (
        hass.bus.async_listen("device_registry_updated", functools.partial(_on_device_registry_updated, hass)),
        hass.bus.async_listen("entity_registry_updated", functools.partial(_on_entity_registry_updated, hass)),
    )
    hass.async_create_task(async_tell_existing(hass))     # once ever: the pairs already there


def async_stop_zigbee_twins(hass: HomeAssistant) -> None:
    dom = hass.data.get(DOMAIN) or {}
    for unsub in dom.pop(_DATA_UNSUB, None) or ():
        unsub()
    dom.pop(_DATA_CACHE, None)
