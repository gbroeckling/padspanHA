# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
A motion sensor's last REAL change, across an offline blip.

HA dates the return from "unavailable"/"unknown" like any other change, so a
motion sensor that dropped off mid-run and came back "off" read on the Atlas
as motion that had just ended: the 5-minute pulse, then the 6-hour ring (live
2026-09-27 02:22 PDT: CarTruckHome and DeckLounge offline 29 s, alarm_di2/3/4
0.2 s — four such blips in 7 days, each on 2-5 placed markers).

The rule is Traceback replay's (house_activity.js buildStateTimeline): back
from an offline gap in the state it had before, a sensor's last real change
is still the one before the gap. Replay reads that from history; the live
page cannot — it may be opened after the blip, it samples hass.states every
5 s (a 0.2 s gap falls between two samples, and so does a 5-second alarm
PIR), and a hidden tab's suspended connection sees neither. This listener
sees every transition, so it holds the answer: for each motion sensor now
sitting on such a return, when HA dated the return ("at") and its last real
change ("last_changed"). The panel uses the second while the sensor's
last_changed is still "at" (lights_map.js gatherLights); a real change moves
last_changed on and drops the entry.

Memory only, from HA start: a restart's restored timestamps are the boot
grace's job (ha_started_at).
"""

import functools

from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback as ha_callback

from .const import DOMAIN

_GAP = ("unavailable", "unknown")
# The Atlas's motion classes — light_codes.js isMotionSensor.
_MOTION_CLASSES = ("motion", "occupancy")

_DATA = "_motion_reconnects"


def _data(hass: HomeAssistant) -> dict:
    return hass.data.setdefault(DOMAIN, {}).setdefault(
        _DATA, {"before": {}, "reconnects": {}, "subs": {}})


def _push(d: dict) -> None:
    for send in list(d["subs"].values()):
        send(dict(d["reconnects"]))


@ha_callback
def _on_state_changed(hass: HomeAssistant, event: Event) -> None:
    eid = event.data.get("entity_id") or ""
    if not eid.startswith("binary_sensor."):
        return
    new, old = event.data.get("new_state"), event.data.get("old_state")
    d = _data(hass)
    before, reconnects = d["before"], d["reconnects"]
    if new is None:
        before.pop(eid, None)
        if reconnects.pop(eid, None) is not None:
            _push(d)
        return
    if new.attributes.get("device_class") not in _MOTION_CLASSES:
        return
    if old is not None and old.state == new.state:
        return                      # attributes only — last_changed is kept
    if new.state in _GAP:
        # The last real reading going in; one already back from an earlier
        # blip carries that blip's real change, not its return.
        if old is not None and old.state not in _GAP:
            r = reconnects.get(eid)
            before[eid] = (old.state, r["last_changed"] if r else old.last_changed.isoformat())
        return
    was = before.pop(eid, None)
    if was is not None and was[0] == new.state:
        reconnects[eid] = {"at": new.last_changed.isoformat(), "last_changed": was[1]}
    elif reconnects.pop(eid, None) is None:
        return
    _push(d)


def async_setup_motion_reconnects(hass: HomeAssistant) -> None:
    """Once per HA process (async_setup): an entry reload keeps what it saw.
    functools.partial, never a lambda — see flood_latch.py."""
    d = _data(hass)
    if not d.get("unsub"):
        d["unsub"] = hass.bus.async_listen("state_changed", functools.partial(_on_state_changed, hass))


@websocket_api.websocket_command({"type": "padspan_ha/motion_reconnects"})
@websocket_api.async_response
async def ws_motion_reconnects(hass: HomeAssistant, connection, msg) -> None:
    """Subscription: {entity_id: {"at", "last_changed"}} now, then on every change."""
    d = _data(hass)
    key = (id(connection), msg["id"])

    def _send(payload: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    connection.subscriptions[msg["id"]] = functools.partial(d["subs"].pop, key, None)
    d["subs"][key] = _send
    connection.send_result(msg["id"])
    _send(dict(d["reconnects"]))
