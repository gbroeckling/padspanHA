# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""The single owner of "is this object still here?".

One rule, one implementation.  It had been hand-rolled in nine places —
sensor.py, device_tracker.py and seven spots across the frontend — each
re-deriving `(away_timeout_m ?? 5) * 60`.  Copies drift: the server-side
room-occupancy rebuild never implemented it at all, so a car that had been
gone for an hour stayed listed in the Garage next to devices seen 20 seconds
ago.

Anything that decides whether an object is present must call these.
"""

from __future__ import annotations

from typing import Any

from .const import DATA_SETTINGS, DOMAIN

# Kinds that physically go away.  An HA entity has no radio and no age, so it
# is never "away" — blanking those was how an earlier attempt at this rule
# emptied half the UI.
RADIO_KINDS = ("ble", "private_ble", "ibeacon")

DEFAULT_AWAY_TIMEOUT_M = 5.0
_MIN_AWAY_TIMEOUT_M = 1.0
_MAX_AWAY_TIMEOUT_M = 1440.0


def excluded_sources(settings: dict[str, Any] | None) -> frozenset[str]:
    """Scanner sources masked out of positioning — all three ways at once.

    A source can be masked three ways and they mean the same thing downstream:

      excluded_scanners  the user masked a receiver whose readings are actively
                         misleading, usually because it physically moved
      lost_radios        marked lost
      disabled_radios    marked disabled

    This had four implementations. Two included all three sets; the two used by
    the LIVE SNAPSHOT and by advertisement INGESTION included only lost and
    disabled. So a scanner the user had explicitly excluded went on entering
    the RSSI maps and went on assigning rooms to objects, while the smoothed
    state was simultaneously being purged of it — two halves of one poll
    disagreeing about whether that receiver existed.

    Taking a settings dict rather than `hass` keeps this callable from the
    coordinator, the websocket snapshot and the calibration store alike, and
    keeps the rule testable without a Home Assistant instance.
    """
    d = settings or {}
    out = {str(s) for s in (d.get("excluded_scanners") or []) if s}
    out |= {str(s) for s in (d.get("lost_radios") or {})}
    out |= {str(s) for s in (d.get("disabled_radios") or {})}
    return frozenset(out)


def away_timeout_s(hass: Any) -> float:
    """Configured away timeout in seconds (default 5 min).

    Clamped to the same 1..1440 minute range the settings endpoint enforces,
    so a hand-edited store cannot produce a timeout the UI cannot express.
    """
    try:
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            val = (st.data or {}).get("away_timeout_m")
            if val is not None:
                return max(_MIN_AWAY_TIMEOUT_M,
                           min(_MAX_AWAY_TIMEOUT_M, float(val))) * 60.0
    except (AttributeError, TypeError, ValueError):
        pass
    return DEFAULT_AWAY_TIMEOUT_M * 60.0


def is_away(obj: dict[str, Any], timeout_s: float) -> bool:
    """Has this radio object gone quiet for longer than the timeout?

    Only radio-backed objects can be away.  An object with no usable age has
    never been aged out — absence of evidence is not evidence of absence, and
    treating it as away would hide devices the moment the field went missing.
    """
    if not isinstance(obj, dict):
        return False
    if obj.get("kind") not in RADIO_KINDS:
        return False
    age = obj.get("age_s")
    if not isinstance(age, (int, float)) or isinstance(age, bool):
        return False
    if age != age or age in (float("inf"), float("-inf")):  # NaN / inf
        return False
    return age > timeout_s
