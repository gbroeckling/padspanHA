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
"""

from __future__ import annotations

import asyncio
import functools
import logging
import re
from typing import Any, Iterable

from homeassistant.core import HomeAssistant, callback as ha_callback

from .const import DATA_SETTINGS, DOMAIN
from .quiet_errors import note as _quiet_error
from .util import ha_devices

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


def async_stop_zigbee_twins(hass: HomeAssistant) -> None:
    dom = hass.data.get(DOMAIN) or {}
    for unsub in dom.pop(_DATA_UNSUB, None) or ():
        unsub()
    dom.pop(_DATA_CACHE, None)
