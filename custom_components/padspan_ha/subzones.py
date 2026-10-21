# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
Sub-zones — named areas inside a room (the bed, the couch, the desk)
=====================================================================
A sub-zone is a polygon or a circle in fabric metres on one floor. Each one
gets binary_sensor.padspan_<name>_occupied and sensor.padspan_<name>_who.

Who is in one is read from the position every labelled tag already has
(x_m / y_m / floor_id on the presence coordinator's objects) AFTER the
coordinator's update: nothing here changes how a position or a room is
worked out, and nothing here is read by positioning or calibration.

So it does not flap on a noisy position, a tag enters only once it is
enter_m inside the edge, leaves only once it is leave_m outside it (or has
no position, is away or on another floor), and either change has to hold
for dwell_s before it counts.

Off by default: settings.subzones_enabled. Nothing is written (no file in
.storage, so backups are as they were) and no entity exists until a user
adds a sub-zone.

Data layout in .storage/padspan_ha.subzones:
  {"zones": {"sz_<8 hex>": {
      "id", "name", "floor_id", "room",         # room: where it was drawn (shown, not used)
      "type": "poly"|"circle", "points_m" | "cx_m"/"cy_m"/"r_m",
      "enter_m", "leave_m", "dwell_s",
      "piece_id": "fur_…"|None}}}               # made from that Live Aboard piece

WebSocket (ws_subzones.py, admin): padspan_ha/subzones_list, subzone_add,
subzone_update, subzone_remove, subzone_from_piece.
"""
from __future__ import annotations

import asyncio
import math
import secrets
import time
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_SETTINGS, DATA_SUBZONES, DOMAIN, SUBZONES_STORE_KEY

MAX_ZONES = 200
NAME_MAX = 40
ENTER_M, LEAVE_M, DWELL_S = 0.1, 0.3, 5.0        # the defaults a new sub-zone gets
MARGIN_MAX_M, DWELL_MAX_S = 3.0, 600.0
_TRACKED_KINDS = ("ble", "private_ble", "ibeacon")   # sensor._should_track: the labelled ones
_MONITOR = "subzone_monitor"
_LOAD_LOCK = "_subzones_load_lock"


class ZoneError(ValueError):
    """A sub-zone that cannot be stored; the text is for the person."""


def enabled(hass: HomeAssistant) -> bool:
    """The master switch, settings.subzones_enabled (default off)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool(((st.data if st else {}) or {}).get("subzones_enabled", False))


# ── Geometry ──────────────────────────────────────────────────────────────────

def _seg_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    ll = dx * dx + dy * dy
    t = 0.0 if ll <= 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ll))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _in_poly(x: float, y: float, pts: list) -> bool:
    inside, n = False, len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def depth_m(zone: dict, x: float, y: float) -> float:
    """How far inside the sub-zone's edge a point is, in metres: positive
    inside, negative outside."""
    if zone.get("type") == "circle":
        return float(zone["r_m"]) - math.hypot(x - float(zone["cx_m"]), y - float(zone["cy_m"]))
    pts = zone.get("points_m") or []
    d = min(_seg_dist(x, y, *pts[i], *pts[(i + 1) % len(pts)]) for i in range(len(pts)))
    return d if _in_poly(x, y, pts) else -d


def piece_footprint(piece: dict) -> list[list[float]]:
    """A Live Aboard piece's four corners on its floor: centred on x_m/y_m,
    width across and depth to the front, turned by its rotation (the same
    frame as house3d_store.piece_point and live_aboard_pieces.js boxOf)."""
    r = piece.get("recipe") or {}
    hw, hd = float(r.get("width_m") or 0) / 2, float(r.get("depth_m") or 0) / 2
    t = math.radians(float(piece.get("rotation") or 0.0) % 360.0)
    cx, cy = float(piece.get("x_m") or 0.0), float(piece.get("y_m") or 0.0)
    return [[round(cx + math.cos(t) * a - math.sin(t) * b, 3), round(cy + math.sin(t) * a + math.cos(t) * b, 3)]
            for a, b in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]


def _num(v: Any, lo: float, hi: float, what: str) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ZoneError(f"{what} must be a number") from None
    if not math.isfinite(f) or not lo <= f <= hi:
        raise ZoneError(f"{what} must be between {lo:g} and {hi:g}")
    return round(f, 3)


def normalise_zone(zid: str, z: Any) -> dict[str, Any]:
    """A sub-zone as it is stored, or ZoneError."""
    from .fabric_store import _norm_geometry  # noqa: PLC0415 — the rooms' own shape rule
    if not isinstance(z, dict):
        raise ZoneError("a sub-zone must be an object")
    name = " ".join(str(z.get("name") or "").split())
    if not name or len(name) > NAME_MAX:
        raise ZoneError(f"a sub-zone needs a name of 1 to {NAME_MAX} characters")
    floor_id = str(z.get("floor_id") or "").strip()
    if not floor_id or len(floor_id) > 64:
        raise ZoneError("a sub-zone needs its floor (floor_id)")
    geo = _norm_geometry(z)
    if geo is None:
        raise ZoneError("a sub-zone is a polygon of 3 or more points or a circle, in metres")
    if geo["type"] == "poly" and len(geo["points_m"]) > 64:
        raise ZoneError("a sub-zone has at most 64 points")
    piece = z.get("piece_id")
    return {"id": zid, "name": name, "floor_id": floor_id, "room": str(z.get("room") or "")[:64], **geo,
            "enter_m": _num(z.get("enter_m", ENTER_M), 0.0, MARGIN_MAX_M, "enter_m"),
            "leave_m": _num(z.get("leave_m", LEAVE_M), 0.0, MARGIN_MAX_M, "leave_m"),
            "dwell_s": _num(z.get("dwell_s", DWELL_S), 0.0, DWELL_MAX_S, "dwell_s"),
            "piece_id": piece if isinstance(piece, str) and piece else None}


def room_at(rooms_flat: dict, floor_id: str, x: float, y: float) -> str:
    """The fabric room on that floor a point is in, for the label only."""
    for name, g in (rooms_flat or {}).items():
        if not isinstance(g, dict) or str(g.get("floor_id") or "") != floor_id:
            continue
        if g.get("type") in ("poly", "circle") and (g.get("points_m") or g.get("type") == "circle"):
            try:
                if depth_m(g, x, y) >= 0:
                    return str(name)
            except (KeyError, TypeError, ValueError):
                continue
    return ""


def centre_of(zone: dict) -> tuple[float, float]:
    if zone.get("type") == "circle":
        return float(zone["cx_m"]), float(zone["cy_m"])
    pts = zone["points_m"]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


# ── Membership ────────────────────────────────────────────────────────────────

class SubzoneTracker:
    """Who is in each sub-zone, with the enter/leave margins and the dwell.
    A pure function of (sub-zones, the coordinator's objects, the time):
    it reads positions and keeps only its own in/out state."""

    def __init__(self) -> None:
        self._in: dict[tuple[str, str], str] = {}        # in, under this label (kept if the tag vanishes)
        self._pending: dict[tuple[str, str], float] = {}   # since when the other answer has held

    def reset(self) -> None:
        self._in.clear()
        self._pending.clear()

    def evaluate(self, zones: dict[str, dict], objects: dict[str, dict] | None,
                 now: float, away_s: float) -> dict[str, list[str]]:
        objects = objects or {}
        out: dict[str, list[str]] = {}
        live = set()
        for zid, z in zones.items():
            names: set[str] = set()
            keys = {k for k, o in objects.items() if _tracked(o)} | {k for (zz, k) in self._in if zz == zid}
            for key in keys:
                sk = (zid, key)
                live.add(sk)
                obj = objects.get(key) or {}
                was = sk in self._in
                d = _depth_of(z, obj, away_s)
                want = (d is not None and d >= float(z.get("enter_m", ENTER_M))) if not was \
                    else not (d is None or d < -float(z.get("leave_m", LEAVE_M)))
                if want == was:
                    self._pending.pop(sk, None)
                else:
                    since = self._pending.setdefault(sk, now)
                    if now - since >= float(z.get("dwell_s", DWELL_S)):
                        was = want
                        self._pending.pop(sk, None)
                if was:
                    label = self._in[sk] = str(obj.get("user_label") or self._in.get(sk) or key)
                    names.add(label)
                else:
                    self._in.pop(sk, None)
            out[zid] = sorted(names)
        for sk in [k for k in self._in if k not in live]:
            self._in.pop(sk, None)
        for sk in [k for k in self._pending if k not in live]:
            self._pending.pop(sk, None)
        return out


def _tracked(obj: Any) -> bool:
    return isinstance(obj, dict) and obj.get("kind") in _TRACKED_KINDS and bool(obj.get("user_label"))


def _depth_of(zone: dict, obj: dict, away_s: float) -> float | None:
    """The object's depth inside the sub-zone, or None: no position, away,
    outside the building or on another floor."""
    if not _tracked(obj) or obj.get("outside"):
        return None
    age = obj.get("age_s")
    if isinstance(age, (int, float)) and age > away_s:
        return None
    if str(obj.get("floor_id") or "") != zone.get("floor_id"):
        return None
    x, y = obj.get("x_m"), obj.get("y_m")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return depth_m(zone, float(x), float(y))


class SubzoneMonitor:
    """One per install: the membership both entity platforms read, worked
    out once per coordinator update."""

    def __init__(self) -> None:
        self.tracker = SubzoneTracker()
        self.members: dict[str, list[str]] = {}
        self._seen: Any = None
        self._at = 0.0

    def current(self, hass: HomeAssistant, coordinator: Any) -> dict[str, list[str]]:
        data, now = getattr(coordinator, "data", None), time.monotonic()
        if data is self._seen and now - self._at < 1.0:
            return self.members
        self._seen, self._at = data, now
        store = hass.data.get(DOMAIN, {}).get(DATA_SUBZONES)
        zones = store.zones() if store is not None and enabled(hass) else {}
        if not zones:
            self.tracker.reset()
            self.members = {}
            return self.members
        from .presence_rules import away_timeout_s  # noqa: PLC0415
        self.members = self.tracker.evaluate(zones, data, now, away_timeout_s(hass))
        return self.members


def get_monitor(hass: HomeAssistant) -> SubzoneMonitor:
    dom = hass.data.setdefault(DOMAIN, {})
    mon = dom.get(_MONITOR)
    if not isinstance(mon, SubzoneMonitor):
        mon = dom[_MONITOR] = SubzoneMonitor()
    return mon


# ── Store ─────────────────────────────────────────────────────────────────────

def _normalise_data(raw: Any) -> dict[str, Any]:
    zones = raw.get("zones") if isinstance(raw, dict) else None
    out: dict[str, dict] = {}
    for zid, z in (zones or {}).items() if isinstance(zones, dict) else ():
        try:
            out[str(zid)] = normalise_zone(str(zid), z)
        except ZoneError:
            continue   # one unreadable entry never costs the others
    return {"zones": out}


class SubzoneStore:
    """padspan_ha.subzones. `.data` is what a backup saves and a restore
    replaces (ws_common._DATA_KEY_MAP); the file exists only once a user
    has added a sub-zone (ws_common._BACKUP_ONLY_ONCE_WRITTEN)."""

    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self.store = Store(hass, 1, SUBZONES_STORE_KEY)
        self._data: dict[str, Any] = {"zones": {}}
        self.lock = asyncio.Lock()

    @property
    def data(self) -> dict[str, Any]:
        return self._data

    @data.setter
    def data(self, value: Any) -> None:
        self._data = _normalise_data(value)

    async def async_load(self) -> dict[str, Any]:
        self.data = await self.store.async_load()
        return self._data

    def zones(self) -> dict[str, dict]:
        return self._data["zones"]

    async def async_put(self, zid: str | None, zone: Any) -> dict[str, Any]:
        """Add (zid None) or replace one sub-zone; returns it as stored."""
        async with self.lock:
            zones = self._data["zones"]
            if zid is None:
                if len(zones) >= MAX_ZONES:
                    raise ZoneError(f"at most {MAX_ZONES} sub-zones")
                zid = "sz_" + secrets.token_hex(4)
                while zid in zones:
                    zid = "sz_" + secrets.token_hex(4)
            elif zid not in zones:
                raise ZoneError("no such sub-zone")
            z = normalise_zone(zid, zone)
            new = {"zones": {**zones, zid: z}}
            await self.store.async_save(new)
            self._data = new
            return z

    async def async_remove(self, zid: str) -> bool:
        async with self.lock:
            zones = self._data["zones"]
            if zid not in zones:
                return False
            new = {"zones": {k: v for k, v in zones.items() if k != zid}}
            await self.store.async_save(new)
            self._data = new
            return True


async def async_get_store(hass: HomeAssistant) -> SubzoneStore:
    """The store, loaded on first use and kept in hass.data. Loading only
    reads; nothing writes the file until a sub-zone is added."""
    dom = hass.data.setdefault(DOMAIN, {})
    store = dom.get(DATA_SUBZONES)
    if isinstance(store, SubzoneStore):
        return store
    async with dom.setdefault(_LOAD_LOCK, asyncio.Lock()):
        store = dom.get(DATA_SUBZONES)
        if not isinstance(store, SubzoneStore):
            store = SubzoneStore(hass)
            await store.async_load()
            dom[DATA_SUBZONES] = store
    return store


# ── Entities (binary_sensor.py, sensor.py) ────────────────────────────────────

async def async_setup_entities(hass: HomeAssistant, entry: Any, async_add_entities: Any, make: Any) -> None:
    """Add make(coordinator, zone_id) for each sub-zone, then for each one
    added later, on the presence coordinator's updates. Off, or no
    sub-zones: no entity, and no file read."""
    from homeassistant.core import callback  # noqa: PLC0415
    coordinator = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    if not coordinator:
        return
    added: set[str] = set()
    loading: list[Any] = []

    @callback
    def _check() -> None:
        if not enabled(hass):
            return
        store = hass.data.get(DOMAIN, {}).get(DATA_SUBZONES)
        if store is None:
            # Switched on since start-up: read the file once, then look again.
            if not loading:
                loading.append(hass.async_create_task(async_get_store(hass)))
            return
        new = [zid for zid in store.zones() if zid not in added]
        if new:
            added.update(new)
            async_add_entities([make(coordinator, zid) for zid in new])

    if enabled(hass):
        await async_get_store(hass)
    _check()
    entry.async_on_unload(coordinator.async_add_listener(_check))


class SubzoneEntityMixin:
    """What both sub-zone entities share: identity, the device, availability."""

    _attr_has_entity_name = True
    _suffix = ""

    def _setup(self, zid: str) -> None:
        self._zid = zid

    @property
    def unique_id(self) -> str:
        return f"padspan_ha__subzone__{self._zid}__{self._suffix}"

    @property
    def _zone(self) -> dict | None:
        store = self.coordinator.hass.data.get(DOMAIN, {}).get(DATA_SUBZONES)
        return store.zones().get(self._zid) if store is not None else None

    @property
    def _people(self) -> list[str]:
        return get_monitor(self.coordinator.hass).current(self.coordinator.hass, self.coordinator).get(self._zid, [])

    @property
    def available(self) -> bool:
        return bool(enabled(self.coordinator.hass) and self._zone is not None
                    and self.coordinator.last_update_success and self.coordinator.data is not None)

    @property
    def device_info(self) -> dict[str, Any]:
        z = self._zone or {}
        return {"identifiers": {(DOMAIN, f"subzone_{self._zid}")},
                "name": f"PadSpan {z.get('name') or 'Sub-zone'}",
                "manufacturer": "PadSpan HA", "model": "Sub-zone"}

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        z = self._zone or {}
        people = self._people
        return {"people": people, "count": len(people), "room": z.get("room") or None,
                "floor_id": z.get("floor_id"), "subzone_id": self._zid}
