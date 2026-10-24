# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""How long a NEW install takes to its first room.

Only installs set up on 0.38.165 or later are measured: their settings store
was made fresh and stamped settings["onboarding"]["setup_ts"]
(settings_store.SettingsStore.async_load). Every install from before has an
empty dict and nothing here ever runs for it beyond one lookup.

Two moments, each recorded once, as a bucket of the time since setup:

  first_room   a device someone identified, named or follows is placed in a
               room for the first time (the snapshot's own room);
  first_calib  the calibration store holds its first point.

The opt-in report carries each bucket once per install, as a usage count of
1 under a closed name (telemetry.ONBOARDING_EVENTS), until a report carrying
it is accepted (its step is then listed in settings["onboarding"]["sent"]).
Nothing is reported with the report off.
"""
from __future__ import annotations

import time
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_SETTINGS, DOMAIN

# Upper edges in seconds; past the last one is "gt7d".
BUCKETS: tuple[tuple[float, str], ...] = (
    (15 * 60, "lt15m"), (3600, "lt1h"), (6 * 3600, "lt6h"), (86400, "lt1d"), (7 * 86400, "lt7d"),
)
BUCKET_WORDS: tuple[str, ...] = tuple(w for _, w in BUCKETS) + ("gt7d",)
STEPS: tuple[str, ...] = ("first_room", "first_calib")


def bucket(seconds: float) -> str:
    for edge, word in BUCKETS:
        if seconds < edge:
            return word
    return "gt7d"


def _placed(snap: dict[str, Any], followed: Any) -> bool:
    objects = snap.get("objects") if isinstance(snap.get("objects"), dict) else {}
    obj_list = objects.get("list") if isinstance(objects.get("list"), list) else []
    fol = {str(a).upper() for a in (followed or []) if a}
    for o in obj_list:
        if not isinstance(o, dict) or not o.get("room"):
            continue
        if o.get("identified") or o.get("user_label") or str(o.get("address") or o.get("key") or "").upper() in fol:
            return True
    return False


def note_snapshot(hass: HomeAssistant, snap: Any) -> None:
    """After a live snapshot build. One dict lookup on an install that is
    not being measured or has both answers; never raises."""
    try:
        dom = hass.data.get(DOMAIN, {})
        st = dom.get(DATA_SETTINGS)
        ob = (st.data if st else {}).get("onboarding")
        if not isinstance(ob, dict) or not ob.get("setup_ts") or all(ob.get(k) for k in STEPS):
            return
        t0 = float(ob["setup_ts"])
        got: dict[str, str] = {}
        if not ob.get("first_room") and isinstance(snap, dict) and _placed(snap, st.data.get("followed_addrs")):
            got["first_room"] = bucket(time.time() - t0)
        if not ob.get("first_calib"):
            cal = getattr(dom.get("calibration"), "data", None) or {}
            if isinstance(cal, dict) and cal.get("points"):
                got["first_calib"] = bucket(time.time() - t0)
        if got:
            new = {**ob, **got}
            st.data["onboarding"] = new   # at once, so the next build does not count it again
            hass.async_create_task(st.async_set(onboarding=new))
    except Exception:  # noqa: BLE001 - a measurement must never cost a snapshot
        pass


def report_events(settings: dict[str, Any]) -> list[str]:
    """The usage names a report carries for this install, until one is accepted."""
    ob = settings.get("onboarding") if isinstance(settings, dict) else None
    if not isinstance(ob, dict):
        return []
    sent = ob.get("sent") or []
    return [f"{k}:{ob[k]}" for k in STEPS if ob.get(k) in BUCKET_WORDS and k not in sent]


async def async_mark_reported(hass: HomeAssistant, sent: list[str]) -> None:
    """A report carrying `sent` was accepted: those steps never go again."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    ob = (st.data if st else {}).get("onboarding")
    done = {k for k in STEPS if isinstance(ob, dict) and f"{k}:{ob.get(k)}" in (sent or [])}
    if done:
        await st.async_set(onboarding={**ob, "sent": sorted(set(ob.get("sent") or []) | done)})
