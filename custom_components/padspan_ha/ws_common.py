# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Shared helpers for the websocket handlers: settings access, the Pro licence gate, the RPA heuristic, the snapshot cache keys, the log ring buffer, geometry helpers.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
from typing import Any
from homeassistant.core import HomeAssistant, callback
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DATA_FABRIC,
    DATA_OBJECTS,
    DATA_OBJECT_HISTORY,
    OBJECT_HISTORY_STORE_KEY,
    DATA_CALIBRATION,
    DATA_ADAPTIVE,
    DATA_ALERTS,
    DATA_MOVEMENT,
    SETTINGS_STORE_KEY,
    CALIBRATION_STORE_KEY,
    ADAPTIVE_STORE_KEY,
    OBJECT_STORE_KEY,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
    FABRIC_STORE_KEY,
    ALERTS_STORE_KEY,
    MOVEMENT_STORE_KEY,
    DATA_TRACEBACK,
    TRACEBACK_STORE_KEY,
    DATA_FORENSICS,
    FORENSICS_STORE_KEY,
    DATA_DEVICE_REGISTRY,
    LIGHT_SHAPE_KINDS,
)
from .device_registry import DEVICE_REGISTRY_STORE_KEY


# ── In-memory ring buffer for PadSpan logs ────────────────────────────────────
# Captures WARNING+ from all padspan_ha loggers so the UI can show them.
_LOG_BUFFER_SIZE = 500


# Max rotating-MAC addresses retained per tracked object.  Bounds the persisted
# cache and the live-snapshot payload (an unbounded list reached 42k addresses /
# ~900KB on a single phone, ballooning the snapshot past the websocket limit).
_ALL_ADDR_CAP = 96


# Max addresses copied onto a single advertisement's _xref.  The frontend keys
# off canonical_id; only a cosmetic detail row ever reads these, so a sample is
# enough.  Shipping the full list on 1000+ ads grew the snapshot to ~300MB.
_XREF_ADDR_SAMPLE = 8


# Retention windows offered for object history, in days.  Anything else the
# user or a hand-edited settings file supplies falls back to the default.
_OBJECT_HISTORY_DAY_CHOICES = (1, 2, 7, 14)


# Marker shapes a light can be pinned to: const.LIGHT_SHAPE_KINDS ("auto" is
# absent as an override by design: it means "no override", which is stored
# as the entity simply not being present).
_LIGHT_SHAPE_KINDS = LIGHT_SHAPE_KINDS


_OBJECT_HISTORY_DAYS_DEFAULT = 1


def _object_history_ttl_s(hass) -> int:
    """Seconds an unidentified object is kept, from the object_history_days setting.

    Identified/tagged objects never expire, so this only bounds anonymous
    rotating-MAC churn.  Longer windows are paid for on every live_snapshot
    poll, which is why this is a small fixed set of choices rather than free
    input — see the retention note in _build_live_snapshot.
    """
    days = _OBJECT_HISTORY_DAYS_DEFAULT
    try:
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            raw = st.get("object_history_days")
            if raw in _OBJECT_HISTORY_DAY_CHOICES:
                days = raw
    except Exception:
        pass
    return days * 86400


def _capped_mac_history(addrs: list) -> list:
    """De-duplicate, MAC-filter, and cap a rotating-MAC address history.

    Order is preserved and callers pass the freshest addresses first, so the
    retained head is the most recent rotations.  Stale MACs are no longer
    broadcast, making the dropped tail unreachable anyway.

    The MAC-shape filter also scrubs historic cache entries poisoned with key
    strings ("ibeacon:...") appended by older merge code.
    """
    return [
        a for a in dict.fromkeys(addrs)
        if isinstance(a, str) and len(a) == 17 and a.count(":") == 5
    ][:_ALL_ADDR_CAP]


class _RingLogHandler(logging.Handler):
    """Captures log records into a bounded list for UI display."""
    def __init__(self, maxlen: int = _LOG_BUFFER_SIZE) -> None:
        super().__init__(level=logging.DEBUG)
        self._maxlen = maxlen
        self.records: list[dict[str, Any]] = []
        # WARNING+ counts by "LEVEL:module" since last taken — the opt-in
        # usage report reads and resets these (telemetry.py). Module names
        # only, never a message: a message can carry an address or a name.
        self.counts: dict[str, int] = {}

    def emit(self, record: logging.LogRecord) -> None:
        mod = record.name[len("custom_components.padspan_ha"):].lstrip(".") \
            if record.name.startswith("custom_components.padspan_ha") else record.name
        if not mod:
            mod = "__init__"
        entry = {
            "ts": record.created,
            "level": record.levelname,
            "logger": mod,
            "message": self.format(record),
        }
        self.records.append(entry)
        if len(self.records) > self._maxlen:
            self.records = self.records[-self._maxlen:]
        if record.levelno >= logging.WARNING:
            k = f"{record.levelname}:{mod.split('.')[0][:32]}"
            self.counts[k] = self.counts.get(k, 0) + 1

    def take_counts(self) -> dict[str, int]:
        out = dict(self.counts)
        self.counts = {}
        return out


_log_handler: _RingLogHandler | None = None


def _ensure_log_handler() -> _RingLogHandler:
    global _log_handler
    if _log_handler is None:
        _log_handler = _RingLogHandler()
        _log_handler.setFormatter(logging.Formatter("%(message)s"))
        # Attach to the padspan_ha root logger to capture all sub-modules
        root = logging.getLogger("custom_components.padspan_ha")
        root.addHandler(_log_handler)
    return _log_handler


@callback
def _get_settings(hass: HomeAssistant) -> dict:
    """Read current settings for the frontend, with the licence key redacted.

    Settings go to ANY authenticated Home Assistant user — the panel has to
    work for non-admins, so this payload cannot be admin-gated without
    breaking them. The licence key therefore never travels in it: callers get
    `pro_active` (the gate's own answer, so the frontend never re-implements
    the rule) plus the expiry, and an admin who needs the key itself asks for
    it explicitly via padspan_ha/forensics_license_reveal.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        return {"data_mode": "sample"}
    out = dict(st.data)
    state = _pro_expiry_state(hass)
    from .licence import edition as _edition, effective_tier as _eff  # noqa: PLC0415
    from .build_info import TIER_FLOOR as _floor  # noqa: PLC0415
    out["forensics_license_key"] = ""          # never leaves the backend
    out["pro_has_key"] = state["has_key"]
    out["pro_active"] = state["active"]        # a valid key of any tier
    out["pro_days_left"] = state["days_left"]
    # The tier model (licence.py): the frontend reads these and never
    # re-implements the ladder.
    out["tier"] = _eff(st.data, bool(state["active"]))
    out["tier_floor"] = _floor
    out["edition"] = _edition()
    return out


# Days a lapsed or unverifiable licence keeps working. Covers a house that is
# simply offline, a card that failed on renewal day, and the gap between a
# renewal and the next daily revalidation — none of which should cost someone
# access to a feature they paid for.
PRO_GRACE_DAYS = 14


def _pro_expiry_state(hass: HomeAssistant) -> dict[str, Any]:
    """Licence state without the secret: {has_key, active, expires, days_left}.

    `active` is the single source of truth for every Pro gate, and it stays
    True through PRO_GRACE_DAYS past expiry. An unparseable or absent expiry
    is treated as NOT expiring: older activations pre-date the expiry field,
    and a date we cannot read is not evidence that someone stopped paying.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        return {"has_key": False, "active": False, "expires": "", "days_left": None}
    from datetime import datetime as _dt, timezone as _tzinfo  # noqa: PLC0415

    has_key = bool(str(st.data.get("forensics_license_key") or "").strip())
    expires = str(st.data.get("forensics_license_expires") or "").strip()
    days_left: int | None = None
    active = has_key
    if has_key and expires:
        # Parsed with the stdlib, not dt_util: the expiry is an ISO string
        # produced by our own licence server, and this way the rule that
        # decides whether a customer keeps access has no dependency that can
        # be stubbed, patched or mocked into answering differently.
        try:
            exp = _dt.fromisoformat(expires.replace("Z", "+00:00"))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=_tzinfo.utc)
            days_left = (exp - _dt.now(_tzinfo.utc)).days
            active = days_left > -PRO_GRACE_DAYS
        except Exception:
            days_left = None      # unreadable date → treat as non-expiring
    return {"has_key": has_key, "active": active, "expires": expires, "days_left": days_left}


def _padspan_pro_active(hass: HomeAssistant) -> bool:
    """True when this install runs at the `pro` tier (key active, tier pro).

    The gate for the presence-side Pro features (Forensics, ...). Lighting
    features gate at `bright` — see _tier_at_least — because a Bright Pro key
    unlocks them and a Pro key is a superset. One ladder, one comparison.

    Soft degrade by design: this gate governs Pro EDITING only. Data a user
    already created stays readable and exportable when a licence lapses —
    losing access to your own recorded history because a card expired is not
    something this product does.
    """
    return _tier_at_least(hass, "pro")


def _tier_at_least(hass: HomeAssistant, want: str) -> bool:
    """The one gate: does the effective tier reach `want`? (licence.py)"""
    from .licence import hass_tier_at_least  # noqa: PLC0415
    return hass_tier_at_least(hass, want)


def _is_rpa_addr(address: str) -> bool:
    """Return True if a BLE address is a Resolvable Private Address (rotating MAC).

    CAUTION: this MSB heuristic is only meaningful for addresses that are
    actually of the *random* type.  HA's snapshot does not expose the HCI
    address-type bit, so any PUBLIC IEEE-assigned MAC whose OUI starts with
    0x40-0x7F (~25% of vendor space, e.g. 48:87:2D = Shen Zhen Da Xia "DX"
    beacons) false-positives here.  Callers must not treat a True result as
    proof of rotation on its own — see the named-device exemption in the
    objects build and the same-OUI guard in the iBeacon split.
    """
    try:
        msb = int(address.upper().split(":")[0], 16)
        return (msb & 0xC0) == 0x40
    except Exception:
        return False


# iBeacon UUIDs that ship as factory defaults on cheap beacon hardware.
# Beacons sold in multi-packs all broadcast the same uuid:major:minor out of
# the box, so these UUIDs must never be trusted as a unique device identity —
# the simultaneous-MAC split below always separates them per MAC.
_DEFAULT_IBEACON_UUIDS = frozenset({
    "e2c56db5-dffb-48d2-b060-d0f5a71096e0",  # AprilBrother / textbook demo UUID (DX CP27 and many clones)
    "fda50693-a4e2-4fb1-afcf-c6eb07647825",  # common Chinese default (HM-10 clones, iTag)
    "b9407f30-f5f8-466e-aff9-25556b57fe6d",  # Estimote factory default
    "f7826da6-4fa2-4e98-8024-bc5b71e0893e",  # Kontakt.io factory default
    "74278bda-b644-4520-8f0c-720eaf059935",  # Glimworm / generic example UUID
})


_SNAPSHOT_CACHE_TTL_S = 2.0


_DATA_SNAPSHOT_CACHE = "snapshot_cache"


_DATA_SNAPSHOT_CACHE_LOCK = "snapshot_cache_lock"


def _invalidate_snapshot_cache(hass: HomeAssistant) -> None:
    """Drop the cached live snapshot so the next fetch rebuilds.

    Called by mutating handlers whose effect the panel re-reads immediately
    (labels, radio areas, settings) — without this, a rename could appear to
    do nothing until the cache TTL expires.
    """
    hass.data.get(DOMAIN, {}).pop(_DATA_SNAPSHOT_CACHE, None)


_ALL_STORE_KEYS = [
    SETTINGS_STORE_KEY,
    CALIBRATION_STORE_KEY,
    ADAPTIVE_STORE_KEY,
    OBJECT_STORE_KEY,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
    FABRIC_STORE_KEY,
    ALERTS_STORE_KEY,
    MOVEMENT_STORE_KEY,
    TRACEBACK_STORE_KEY,
    OBJECT_HISTORY_STORE_KEY,
]


# Maps HA Storage file keys → in-memory hass.data[DOMAIN] keys.
# Used by both backup (read live data) and restore (hot-patch in-memory stores).
_DATA_KEY_MAP = {
    SETTINGS_STORE_KEY: DATA_SETTINGS,
    CALIBRATION_STORE_KEY: DATA_CALIBRATION,
    ADAPTIVE_STORE_KEY: DATA_ADAPTIVE,
    OBJECT_STORE_KEY: DATA_OBJECTS,
    MAPS_STORE_KEY: DATA_MAPS,
    MODEL_STORE_KEY: DATA_MODEL,
    FABRIC_STORE_KEY: DATA_FABRIC,
    ALERTS_STORE_KEY: DATA_ALERTS,
    MOVEMENT_STORE_KEY: DATA_MOVEMENT,
    TRACEBACK_STORE_KEY: DATA_TRACEBACK,
    OBJECT_HISTORY_STORE_KEY: DATA_OBJECT_HISTORY,
    # A Pro customer's forensics sessions are the data they paid to collect —
    # omitting them from "full backup" meant a restore silently lost the
    # paid-for feature's entire history. The device registry is the stable
    # identity map everything else references; without it a restore comes
    # back with correct data attached to unrecognisable devices.
    FORENSICS_STORE_KEY: DATA_FORENSICS,
    DEVICE_REGISTRY_STORE_KEY: DATA_DEVICE_REGISTRY,
}


_MAX_BACKUPS = 3  # Oldest backup is dropped when a new one exceeds this limit


def _room_from_bounds(room_bounds: dict, x: float, y: float) -> str:
    """Determine which room a point (x,y) falls in using room boundary shapes.

    Supports two shape types:
      - "circle": center (cx,cy) + radius r — simple distance check
      - "poly": list of [x,y] vertices — ray-casting point-in-polygon test
    Returns the room name or '' if the point is outside all boundaries.
    """
    for room_name, b in room_bounds.items():
        if not isinstance(b, dict):
            continue
        btype = b.get("type", "poly")
        if btype == "circle":
            cx = float(b.get("cx", 0.5))
            cy = float(b.get("cy", 0.5))
            r = float(b.get("r", 0.12))
            if (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2:
                return str(room_name)
        elif btype == "poly":
            pts = b.get("points") or []
            if len(pts) < 3:
                continue
            # Ray-casting point-in-polygon test
            inside = False
            n = len(pts)
            j = n - 1
            for i in range(n):
                xi, yi = float(pts[i][0]), float(pts[i][1])
                xj, yj = float(pts[j][0]), float(pts[j][1])
                if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                    inside = not inside
                j = i
            if inside:
                return str(room_name)
    return ""


def _point_in_polygon(x: float, y: float, polygon: list) -> bool:
    """Ray-casting point-in-polygon test for [x,y] coordinate lists."""
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = float(polygon[i][0]), float(polygon[i][1])
        xj, yj = float(polygon[j][0]), float(polygon[j][1])
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside
