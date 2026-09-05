# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for occupancy estimation.

The number is PEOPLE in the building, never devices. A person is counted
once, however many things they carry and however many HA entities point at
their phone. Evidence, strongest first:

  1. Known people — HA ``person.*`` entities that are home, deduplicated by
     the device_tracker behind them (two persons on one phone = one person),
     plus IRK-resolved phones PadSpan tracks itself. Placed in a room when a
     PadSpan object is theirs (linked to their tracker, or labelled with the
     tracker's name).
  2. Phone-class emitters nobody claims — rotating (RPA) addresses whose
     advert says "phone or watch in a pocket" (Apple continuity Nearby Info /
     Handoff / …, or a wearable maker), heard strongly by two or more
     scanners. Clustered by RSSI fingerprint so a phone plus its watch plus
     its last rotation is one person. Known people who are not placed by a
     PadSpan object absorb these first; the rest are unknown people.
  3. Occupancy / presence sensors and recent motion, by room, from
     ``device_class`` — a room with a person-shaped signal and nobody placed
     in it is one more person unless an unplaced known person explains it.

Labelled things — keys, beacons, boxes, vehicles — are never people. They
are reported so the user can see what was seen and not counted.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .ble_enrichment import decode_apple_subtype, lookup_company, lookup_service_uuid
from .bluetooth_live import get_bluetooth_live
from .const import DATA_MODEL, DATA_SETTINGS, DOMAIN
from .presence_rules import away_timeout_s, is_away, is_outdoor_floor
from .ws_common import _is_rpa_addr

_LOGGER = logging.getLogger(__name__)

# ── Gates ───────────────────────────────────────────────────────────────────
INSIDE_RSSI = -75.0        # dBm — weaker than this everywhere = outside the building
MIN_SCANNERS = 2           # one scanner only = wall bleed or a neighbour
PHONE_AD_MAX_AGE_S = 120   # a rotating address is "here" this long after its last advert;
                           # phones rotate every ~15 min, so the old address is a ghost
                           # for at most two minutes
MOTION_RECENT_S = 120      # motion that cleared this recently still says "someone"
MOTION_STUCK_S = 3600      # motion held 'on' this long is a stuck input, not a person
DEFAULT_CLUSTER_THRESH = 8.0  # dBm RMS — the clustering threshold itself; devices
                               # carried together typically differ by < 5 dBm, and
                               # this sits above that figure for measurement-noise headroom

# Apple continuity subtypes only a phone / watch / tablet in someone's hand
# or pocket sends. AirPlay, HomeKit, AirPods, iBeacon and Find My are fixed
# hardware, accessories or tags — never a person on their own.
PHONE_CLASS_APPLE = frozenset({
    "Nearby Info", "Nearby Action", "Handoff", "Hotspot",
    "Wi-Fi Join", "Wi-Fi Settings", "Siri", "AirDrop", "Magic Switch",
})
# Wearable makers whose watches and bands rotate their address like a phone
# (names as ble_enrichment's company table spells them).
PHONE_CLASS_COMPANIES = frozenset({"Garmin", "Fitbit", "Polar Electro", "Oura", "Withings"})
PERSON_SENSOR_CLASSES = ("occupancy", "presence", "motion")


# ── HA registry lookups (kept small so tests can replace them) ──────────────

def _entity_area_name(hass: HomeAssistant, entity_id: str) -> str | None:
    """The HA area an entity sits in — its own, else its device's."""
    try:
        from homeassistant.helpers import area_registry as ar
        from homeassistant.helpers import device_registry as dr
        from homeassistant.helpers import entity_registry as er
        ent = er.async_get(hass).async_get(entity_id)
        if ent is None:
            return None
        area_id = ent.area_id
        if not area_id and ent.device_id:
            dev = dr.async_get(hass).async_get(ent.device_id)
            area_id = dev.area_id if dev else None
        if not area_id:
            return None
        area = ar.async_get(hass).async_get_area(area_id)
        return area.name if area else None
    except Exception as err:  # registries missing in tests / early boot
        _LOGGER.debug("area lookup for %s failed: %s", entity_id, err)
        return None


def _match_room(name: str | None, room_names: dict[str, str]) -> str | None:
    """A room name from the fabric, matched case-insensitively."""
    key = (name or "").strip().lower()
    return room_names.get(key) if key else None


def _sensor_room(hass: HomeAssistant, state: Any, room_names: dict[str, str]) -> str | None:
    """Which room a binary_sensor speaks for: its HA area, spelled as the fabric spells it.

    The area is HA's own statement of where the sensor is — a sensor in the
    wrong area is fixed in HA, not guessed from its name here.
    """
    area = _entity_area_name(hass, state.entity_id)
    return _match_room(area, room_names) or area or None


# ── Evidence ────────────────────────────────────────────────────────────────

def _known_people(hass: HomeAssistant) -> list[dict[str, Any]]:
    """HA persons that are home, one entry per phone behind them."""
    people: list[dict[str, Any]] = []
    for st in hass.states.async_all("person"):
        if st.state != "home":
            continue
        attrs = st.attributes or {}
        trackers = {str(t) for t in (attrs.get("device_trackers") or [])}
        if attrs.get("source"):
            trackers.add(str(attrs["source"]))
        name = str(attrs.get("friendly_name") or st.entity_id)
        # Same tracker = same phone = same person, however many person.*
        # entities point at it (person.remote and person.pixel both on the
        # Pixel is one person).
        dup = next((p for p in people if p["trackers"] & trackers), None) if trackers else None
        if dup is not None:
            dup["aliases"].append(name)
            dup["trackers"] |= trackers
            continue
        names = {name.lower()}
        for t in trackers:
            tst = hass.states.get(t)
            fn = (getattr(tst, "attributes", None) or {}).get("friendly_name") if tst is not None else None
            if fn:
                names.add(str(fn).lower())
            names.add(t.split(".", 1)[-1].replace("_", " ").lower())
        people.append({
            "name": name, "entity_id": st.entity_id, "trackers": trackers,
            "match_names": names, "aliases": [], "room": None, "via": "person entity",
        })
    return people


def _seen_objects(hass: HomeAssistant, pc_data: dict[str, Any]) -> list[dict[str, Any]]:
    """PadSpan objects that carry an identity (label, IRK, HA entity) and are not away.

    "Away" is the one shared rule (presence_rules.is_away at the configured
    timeout), the same one the map and the device_tracker use.
    """
    timeout = away_timeout_s(hass)
    out = []
    for key, obj in pc_data.items():
        if not isinstance(obj, dict) or str(key).startswith("__"):
            continue
        if is_away(obj, timeout):
            continue
        if obj.get("user_label") or obj.get("kind") in ("private_ble", "entity"):
            out.append(obj)
    return out


def _claim_objects(people: list[dict[str, Any]], objects: list[dict[str, Any]]) -> None:
    """Place known people in rooms through the PadSpan objects that are theirs."""
    for person in people:
        for obj in objects:
            if obj.get("_claimed"):
                continue
            label = str(obj.get("user_label") or "").strip().lower()
            linked = {str(e) for e in (obj.get("linked_entities") or [])}
            if (label and label in person["match_names"]) or (linked & person["trackers"]):
                obj["_claimed"] = True
                person["room"] = obj.get("room") or None
                person["via"] = f"{obj.get('user_label') or obj.get('name') or 'phone'} (PadSpan)"
                break


def _irk_phones(objects: list[dict[str, Any]], people: list[dict[str, Any]]) -> None:
    """IRK-resolved phones are known people too; match to a person by name, else add one."""
    for obj in objects:
        if obj.get("kind") != "private_ble" or obj.get("_claimed"):
            continue
        name = str(obj.get("user_label") or obj.get("name") or "").strip()
        owner = next((p for p in people if name.lower() in p["match_names"]), None) if name else None
        obj["_claimed"] = True
        if owner is not None:
            if owner["room"] is None:
                owner["room"] = obj.get("room") or None
                owner["via"] = f"{name} (IRK)"
            continue
        people.append({
            "name": name or "Phone", "entity_id": "", "trackers": set(),
            "match_names": {name.lower()}, "aliases": [], "room": obj.get("room") or None,
            "via": f"{name or 'phone'} (IRK)",
        })


def _phone_class(manuf: dict[str, Any], service_uuids: list[Any]) -> bool:
    """Does this advert come from something a person carries?"""
    apple = manuf.get("76") if "76" in manuf else manuf.get(76)
    if apple is not None:
        return decode_apple_subtype(apple) in PHONE_CLASS_APPLE
    for key in manuf:
        try:
            company = lookup_company(int(key))
        except (TypeError, ValueError):
            continue
        if company in PHONE_CLASS_COMPANIES:
            return True
    return any(lookup_service_uuid(str(u)) == "Heart Rate" for u in (service_uuids or []))


def _phone_candidates(ads: list[dict[str, Any]], claimed_addrs: set[str]) -> dict[str, dict[str, float]]:
    """Rotating addresses that look like a phone or watch inside the building.

    Returns {address: {scanner: best_rssi}}. The locally-administered bit is
    not consulted — it is a random bit inside a rotating address. A local
    name disqualifies: a phone's rotating adverts are anonymous, a named
    rotating emitter is a Mac, a TV or a public OUI that merely looks rotating.
    """
    by_addr: dict[str, dict[str, Any]] = {}
    for ad in ads:
        addr = str(ad.get("address") or "").upper()
        if not addr or addr in claimed_addrs or not _is_rpa_addr(addr):
            continue
        entry = by_addr.setdefault(addr, {"fp": {}, "manuf": {}, "svc": [], "named": False})
        src = str(ad.get("source") or "")
        rssi = ad.get("rssi")
        if src and rssi is not None:
            entry["fp"][src] = max(entry["fp"].get(src, -999.0), float(rssi))
        name = str(ad.get("name") or "").strip()
        if name and name.upper() != addr:
            entry["named"] = True
        if not entry["manuf"] and ad.get("manufacturer_data"):
            entry["manuf"] = dict(ad["manufacturer_data"])
        if not entry["svc"] and ad.get("service_uuids"):
            entry["svc"] = list(ad["service_uuids"])
    out: dict[str, dict[str, float]] = {}
    for addr, entry in by_addr.items():
        fp = entry["fp"]
        if entry["named"] or len(fp) < MIN_SCANNERS or max(fp.values()) < INSIDE_RSSI:
            continue
        if not _phone_class(entry["manuf"], entry["svc"]):
            continue
        out[addr] = fp
    return out


def _fp_distance(fp1: dict[str, float], fp2: dict[str, float]) -> float:
    """RMS dBm gap between two per-scanner fingerprints; an unshared scanner counts 20 dBm."""
    shared = set(fp1) & set(fp2)
    all_srcs = set(fp1) | set(fp2)
    if not all_srcs:
        return 999.0
    sum_sq = sum((fp1[s] - fp2[s]) ** 2 for s in shared)
    sum_sq += (len(all_srcs) - len(shared)) * (20.0 ** 2)
    return (sum_sq / len(all_srcs)) ** 0.5


def _cluster(fps: dict[str, dict[str, float]], thresh: float) -> list[list[str]]:
    """Greedy average-linkage merge until every pair is further apart than thresh."""
    addrs = list(fps)
    clusters: list[list[int]] = [[i] for i in range(len(addrs))]
    while len(clusters) > 1:
        best = (thresh, -1, -1)
        for ci in range(len(clusters)):
            for cj in range(ci + 1, len(clusters)):
                dists = [_fp_distance(fps[addrs[a]], fps[addrs[b]]) for a in clusters[ci] for b in clusters[cj]]
                avg = sum(dists) / len(dists)
                if avg < best[0]:
                    best = (avg, ci, cj)
        if best[1] < 0:
            break
        clusters[best[1]].extend(clusters.pop(best[2]))
    return [[addrs[i] for i in members] for members in clusters]


def _sensor_rooms(hass: HomeAssistant, room_names: dict[str, str], room_floor: dict[str, str]) -> dict[str, Any]:
    """Rooms with a person-shaped sensor signal, from device_class, indoors only."""
    occupancy: list[str] = []
    motion: list[str] = []
    stuck: list[str] = []
    now = time.time()
    for st in hass.states.async_all("binary_sensor"):
        dc = (st.attributes or {}).get("device_class")
        if dc not in PERSON_SENSOR_CLASSES or st.state not in ("on", "off"):
            continue
        room = _sensor_room(hass, st, room_names)
        if not room or is_outdoor_floor(room_floor.get(room)) or is_outdoor_floor(room):
            continue
        changed = getattr(st, "last_changed", None)
        held = (now - changed.timestamp()) if changed is not None else 0.0
        if dc == "motion":
            if st.state == "on" and held > MOTION_STUCK_S:
                stuck.append(st.entity_id)
                continue
            if (st.state == "on" or held <= MOTION_RECENT_S) and room not in motion:
                motion.append(room)
        elif st.state == "on" and room not in occupancy:
            occupancy.append(room)
    return {"occupancy_rooms": occupancy, "motion_rooms": motion, "stuck_sensors": stuck}


# ── Accuracy, from confirmed headcounts ─────────────────────────────────────

def _accuracy_stats(observations: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Summarize estimate-vs-actual error over a set of training observations."""
    errors = [
        o["estimated"] - o["actual"]
        for o in observations
        if o.get("estimated") is not None and o.get("actual") is not None
    ]
    n = len(errors)
    if not n:
        return None
    exact = sum(1 for e in errors if e == 0)
    within_one = sum(1 for e in errors if abs(e) <= 1)
    return {
        "observations": n,
        "exact_match_pct": round(100 * exact / n, 1),
        "within_one_pct": round(100 * within_one / n, 1),
        "mean_abs_error": round(sum(abs(e) for e in errors) / n, 2),
        # Signed mean error: positive = estimator tends to over-count,
        # negative = tends to under-count.
        "bias": round(sum(errors) / n, 2),
    }


def _training_accuracy(training: list[dict[str, Any]]) -> dict[str, Any]:
    """All-time accuracy plus a recent-20 window, so a trend is visible
    (whether tuning is actually improving the estimate over time) rather than
    only ever showing one flat lifetime number."""
    return {
        "overall": _accuracy_stats(training),
        "recent": _accuracy_stats(training[-20:]) if len(training) > 20 else None,
    }


# ── The estimate ────────────────────────────────────────────────────────────

async def compute_occupancy_estimate(hass: HomeAssistant) -> dict[str, Any]:
    """People in the building: known people, unclaimed phones, sensed rooms.

    Called by the WS handler and by the occupancy sensor coordinator.
    """
    _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    _sd = (_st.data if _st else {}) or {}
    hybrid = bool(_sd.get("occupancy_hybrid_enabled", True))
    thresh = float(_sd.get("occupancy_cluster_threshold", DEFAULT_CLUSTER_THRESH))
    training = _sd.get("occupancy_training") or []

    # Fabric: scanner → room, room → floor, and the room names to match against.
    source_to_room: dict[str, str] = {}
    room_floor: dict[str, str] = {}
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if mdl:
        source_to_room, source_to_floor = mdl.get_scanner_mappings()
        for src, room in source_to_room.items():
            if src in source_to_floor:
                room_floor.setdefault(room, source_to_floor[src])
    room_names = {r.lower(): r for r in source_to_room.values()}

    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    pc_data = (pc.data or {}) if pc else {}
    objects = [dict(o) for o in _seen_objects(hass, pc_data)]

    # 1. Known people.
    people = _known_people(hass) if hybrid else []
    _claim_objects(people, objects)
    _irk_phones(objects, people)

    # 2. Unclaimed phones on the air.
    claimed_addrs: set[str] = set()
    for obj in objects:
        for a in [obj.get("address")] + list(obj.get("all_addresses") or []):
            if a:
                claimed_addrs.add(str(a).upper())
    bl = get_bluetooth_live(hass)
    ads = (bl.get_snapshot(max_ads=10000, max_age_s=PHONE_AD_MAX_AGE_S).get("advertisements") or []) if bl else []
    fps = _phone_candidates(ads, claimed_addrs)
    clusters = []
    for members in _cluster(fps, thresh):
        strongest = max(members, key=lambda a: max(fps[a].values()))
        best_src = max(fps[strongest], key=lambda s: fps[strongest][s])
        clusters.append({"addresses": members, "room": source_to_room.get(best_src) or None})

    # 3. Sensed rooms.
    sensed = _sensor_rooms(hass, room_names, room_floor) if hybrid else {
        "occupancy_rooms": [], "motion_rooms": [], "stuck_sensors": []}

    # 4. Fuse.
    #    A phone body is one person per room, however many rotating addresses
    #    sit there — a phone and its watch, or a phone across a rotation. A
    #    known person placed in that room owns it; a known person who is home
    #    but not placed is assumed to be it; what is left is an unknown
    #    person, and that is firm evidence.
    #    Occupancy is a floor: every occupied room needs a body, but the bodies
    #    are the people already counted, wherever a weak beacon put them —
    #    the first deploy added a person for every occupied room and said 4
    #    with 2 home. Motion attributes, and floors an otherwise empty count.
    known = len(people)
    bodies: list[dict[str, Any]] = []
    for c in clusters:
        body = next((b for b in bodies if c["room"] and b["room"] == c["room"]), None)
        if body is None:
            bodies.append({"room": c["room"], "addresses": list(c["addresses"]), "explained": False})
        else:
            body["addresses"].extend(c["addresses"])
    unplaced = [p for p in people if not p["room"]]

    def _assume(room: str | None, via: str) -> None:
        # A room named after someone is theirs first ("Nicole's Office").
        words = {w for w in (room or "").lower().replace("'s", "").split() if len(w) >= 3}
        owner = next((p for p in unplaced if any(w in words for w in p["name"].lower().split())), unplaced[0])
        unplaced.remove(owner)
        owner["room"], owner["via"], owner["assumed"] = room, via, True

    for body in bodies:
        if body["room"] and any(p["room"] == body["room"] for p in people):
            body["explained"] = True
        elif unplaced:
            _assume(body["room"], "unclaimed phone nearby (assumed)")
            body["explained"] = True
    unknown_phones = [b for b in bodies if not b["explained"]]

    placed_rooms = {p["room"] for p in people if p["room"]} | {b["room"] for b in unknown_phones if b["room"]}
    unaccounted = [r for r in sensed["occupancy_rooms"] if r not in placed_rooms]
    for r in list(unaccounted):
        if not unplaced:
            break
        _assume(r, "occupancy sensor (assumed)")
        unaccounted.remove(r)
    firm = known + len(unknown_phones)
    floor = len(sensed["occupancy_rooms"]) or (1 if sensed["motion_rooms"] else 0)
    estimate = max(firm, floor)
    low = firm
    high = firm + len(unaccounted)
    unknown = estimate - known

    if not hybrid or known == 0:
        confidence = "low"
    elif not unknown_phones and not unaccounted and all(p["room"] and not p.get("assumed") for p in people):
        confidence = "high"
    else:
        confidence = "medium"

    # Who was counted, by where the evidence sits.
    counted: list[dict[str, Any]] = [
        {"name": p["name"], "kind": "known", "room": p["room"], "via": p["via"],
         "aliases": p["aliases"], "assumed": bool(p.get("assumed"))} for p in people]
    for b in unknown_phones:
        counted.append({"name": "Unknown phone", "kind": "unknown", "room": b["room"],
                        "via": f"{len(b['addresses'])} rotating address{'es' if len(b['addresses']) != 1 else ''}"})
    slots = estimate - firm
    for r in unaccounted + [m for m in sensed["motion_rooms"] if m not in placed_rooms and m not in unaccounted]:
        if slots <= 0:
            break
        counted.append({"name": "Someone", "kind": "unknown", "room": r,
                        "via": "occupancy sensor" if r in sensed["occupancy_rooms"] else "motion"})
        slots -= 1

    # Rooms: evidence per room, not a second headcount.
    rooms: dict[str, dict[str, Any]] = {}
    def _room(name: str) -> dict[str, Any]:
        return rooms.setdefault(name, {"room": name, "people": [], "phones": 0, "occupancy": False, "motion": False})
    for p in people:
        if p["room"]:
            _room(p["room"])["people"].append(p["name"])
    for c in clusters:
        if c["room"]:
            _room(c["room"])["phones"] += 1
    for r in sensed["occupancy_rooms"]:
        _room(r)["occupancy"] = True
    for r in sensed["motion_rooms"]:
        _room(r)["motion"] = True

    # Things seen and not counted — one line per physical thing.
    things: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for obj in objects:
        if obj.get("_claimed"):
            continue
        ident = str(obj.get("padspan_id") or obj.get("user_label") or obj.get("key"))
        if ident in seen_ids:
            continue
        seen_ids.add(ident)
        things.append({"label": obj.get("user_label") or obj.get("name") or obj.get("key"),
                       "kind": obj.get("kind"), "room": obj.get("room") or None})

    return {
        "total_estimate": estimate,
        "total_low": low,
        "total_high": high,
        "confidence": confidence,
        "known": known,
        "unknown": unknown,
        "people": counted,
        "rooms": sorted(rooms.values(), key=lambda r: r["room"]),
        "evidence": {
            "persons_home": [p["name"] for p in people],
            "persons_unlocated": [p["name"] for p in people if not p["room"] or p.get("assumed")],
            "phone_clusters": len(bodies),
            "phone_addresses": len(fps),
            "occupancy_rooms": sensed["occupancy_rooms"],
            "motion_rooms": sensed["motion_rooms"],
            "unaccounted_rooms": unaccounted,
            "stuck_sensors": sensed["stuck_sensors"],
            "things_seen": things,
        },
        "hybrid_enabled": hybrid,
        "cluster_threshold": thresh,
        "training_count": len(training),
        "accuracy": _training_accuracy(training),
    }


@websocket_api.websocket_command({"type": "padspan_ha/occupancy_estimate"})
@websocket_api.async_response
async def ws_occupancy_estimate(hass: HomeAssistant, connection, msg) -> None:
    """WS wrapper for occupancy estimation."""
    result = await compute_occupancy_estimate(hass)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    "type": "padspan_ha/occupancy_train",
    "actual_count": vol.Coerce(int),
    vol.Optional("room"): str,
})
@websocket_api.async_response
async def ws_occupancy_train(hass: HomeAssistant, connection, msg) -> None:
    """Record an actual headcount beside what the estimator said at the time."""
    _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not _st:
        connection.send_error(msg["id"], "no_settings", "Settings not loaded")
        return

    est = await compute_occupancy_estimate(hass)
    observation = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "actual": int(msg["actual_count"]),
        "room": (msg.get("room") or "").strip(),
        "estimated": est["total_estimate"],
        "low": est["total_low"],
        "high": est["total_high"],
        "known": est["known"],
        "unknown": est["unknown"],
    }
    training = list(_st.data.get("occupancy_training") or [])
    training.append(observation)
    if len(training) > 100:
        training = training[-100:]
    _st.data["occupancy_training"] = training
    await _st.store.async_save(_st.data)

    connection.send_result(msg["id"], {"ok": True, "observation": observation, "total_observations": len(training)})
