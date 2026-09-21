# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Flood/water-leak alarm latching.

Garry, 2026-09-18/19: "the alarm has to stay on for 2 days, or until reset."
A moisture binary_sensor's raw HA state is not enough on its own to build
that on — verified live the same day: the Kitchen Sink sensor
(binary_sensor.flood_kitchen_sink_0xa4c138cc861a9e67_water_leak) flapped
on/off in a tight, regular ~0.55s rhythm, three separate bursts over about
ten minutes (2026-09-18, ~13:37/13:43/13:46 PDT) — a genuine, sustained wet
event, but shorter and more intermittent than any reasonable poll interval
or point-in-time state check would reliably catch. Only an event listener
catching every transition, not a poller, sees a burst that short.

Researched against how life-safety/industrial alarm systems handle a
triggered-then-cleared condition (fire panels — NFPA 72; SCADA/BMS —
ISA-18.2): none auto-clear a genuine alarm on a timer with no human
acknowledgment, and a still-active alarm that re-triggers keeps its
ORIGINAL occurrence time rather than resetting the clock — only a genuinely
new event after a real return to normal starts a fresh one. This module
follows that second convention (see async_trigger below) even though the
2-day auto-expiry itself is a deliberate, scoped exception to the "always
require a human" norm — appropriate here only because nobody is watching a
console 24/7 for a domestic leak sensor.

Persisted in SettingsStore ("flood_latches": {entity_id: {"triggered_at":
epoch-s, "expires_at": epoch-s}}) rather than a new store class — low volume
(one entry per moisture sensor that has ever tripped, realistically a
handful in any house), so it rides the store PadSpan already loads and
saves through. Exposed to the frontend for free: every settings_get
response is dict(st.data), so this needs no new GET command.

"Active" (still alarming) is time math computed at read time against the
stored expires_at — the same shape as TEMP_FRESH_MS's "no reading in over
an hour" freshness gate elsewhere in this codebase, not a separate boolean
this code would have to remember to flip. is_active() below is the one
place that check lives server-side; views/iso_lights.js's
floodLatchActive() is its JS mirror and must be kept in the same shape —
change one, change both.

Found by the week-review workflow, 2026-09-19: the read-modify-write into
flood_latches must be serialized (see _async_latch's lock) — two different
sensors triggering back-to-back used to read the same pre-update snapshot
and silently clobber each other's write.

Same review, 2026-09-19: deleting a moisture sensor's entity used to leave
its flood_latches entry behind forever — nothing here listened for the
entity going away. _on_entity_registry_updated below closes that; a rename
(HA's "update" action) is deliberately left alone, since migrating the key
to a new entity_id is a different, bigger feature nobody has asked for.
"""

import asyncio
import functools
import logging
import time
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback as ha_callback

from .const import DOMAIN, DATA_SETTINGS

_LOGGER = logging.getLogger(__name__)

# 2 days (Garry, 2026-09-19: "the alarm has to stay on for 2 days, or until
# reset") — change here AND in views/iso_lights.js's FLOOD_ACTIVE_WINDOW_S.
ACTIVE_WINDOW_S = 2 * 24 * 60 * 60

_DATA_UNSUB = "_flood_latch_unsub"
_DATA_UNSUB_REGISTRY = "_flood_latch_unsub_registry"
_DATA_LOCK = "_flood_latch_lock"


def is_active(rec: Any, now_ts: float | None = None) -> bool:
    """True while `rec` (a {"triggered_at", "expires_at"} dict, or anything
    else = never triggered/already reset) hasn't reached its expires_at."""
    if not isinstance(rec, dict):
        return False
    expires_at = rec.get("expires_at")
    if not isinstance(expires_at, (int, float)) or isinstance(expires_at, bool):
        return False
    now = now_ts if now_ts is not None else time.time()
    return now < expires_at


async def _async_latch(hass: HomeAssistant, entity_id: str) -> None:
    """The actual read-check-write for one trigger, serialized behind a
    lock. Two DIFFERENT moisture sensors can fire 'on' back-to-back with no
    await between the two _on_state_changed calls (a normal HA pattern —
    e.g. RestoreEntity restoring several entities in one synchronous loop
    at startup). If each computed its own new flood_latches dict from a
    snapshot taken at trigger time, the later write would silently replace
    the earlier one's addition (SettingsStore.async_set replaces the whole
    key, it doesn't merge) — so the snapshot is taken here, at write time,
    under the lock, not in the synchronous callback."""
    dom = hass.data.get(DOMAIN)
    if not dom:
        return
    st = dom.get(DATA_SETTINGS)
    if not st:
        return
    lock = dom.setdefault(_DATA_LOCK, asyncio.Lock())
    async with lock:
        latches = dict(st.data.get("flood_latches") or {})
        existing = latches.get(entity_id)
        # A sensor that re-triggers (still wet, or wets again) while
        # already latched is a no-op on purpose — see the module
        # docstring's ISA-18.2 note. Without this, a chattering sensor
        # would never expire.
        if is_active(existing):
            return
        now = time.time()
        latches[entity_id] = {"triggered_at": now, "expires_at": now + ACTIVE_WINDOW_S}
        await st.async_set(flood_latches=latches)


@ha_callback
def _on_state_changed(hass: HomeAssistant, event: Event) -> None:
    new_state = event.data.get("new_state")
    if new_state is None or new_state.state != "on":
        return
    if not new_state.entity_id.startswith("binary_sensor."):
        return
    if new_state.attributes.get("device_class") != "moisture":
        return
    if not hass.data.get(DOMAIN, {}).get(DATA_SETTINGS):
        return
    hass.async_create_task(_async_latch(hass, new_state.entity_id))


@ha_callback
def _on_entity_registry_updated(hass: HomeAssistant, event: Event) -> None:
    """A deleted entity's flood_latches entry (if it has one) is now about
    nothing — the emergency banner would otherwise keep showing it as an
    ACTIVE alarm, identified only by its dead entity_id, for up to the full
    2-day window. Only "remove" is handled; a rename ("update" with a
    changed entity_id) leaves the old key in place rather than migrating it
    — out of scope here, see the module docstring."""
    if event.data.get("action") != "remove":
        return
    entity_id = event.data.get("entity_id")
    if not entity_id:
        return
    hass.async_create_task(async_reset_latch(hass, entity_id))


def async_setup_flood_latch(hass: HomeAssistant) -> None:
    """Idempotent across config-entry reloads — same shape as
    forensics_store.async_setup_forensics's sampler registration."""
    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_DATA_UNSUB):
        return
    # functools.partial, NOT a lambda: HA's dispatcher unwraps partial to find
    # the @callback marker on _on_state_changed and runs it straight on the
    # event loop. A lambda wrapper is a distinct, unmarked function — HA then
    # hands it to a worker thread instead, where the async_create_task below
    # is illegal and raises (verified live, 2026-09-18: every trigger threw
    # "calls hass.async_create_task from a thread other than the event loop"
    # and silently never wrote the latch — this is why nothing ever latched).
    dom[_DATA_UNSUB] = hass.bus.async_listen(
        "state_changed", functools.partial(_on_state_changed, hass)
    )
    dom[_DATA_UNSUB_REGISTRY] = hass.bus.async_listen(
        "entity_registry_updated", functools.partial(_on_entity_registry_updated, hass)
    )


def async_stop_flood_latch(hass: HomeAssistant) -> None:
    dom = hass.data.get(DOMAIN, {})
    for key in (_DATA_UNSUB, _DATA_UNSUB_REGISTRY):
        unsub = dom.pop(key, None)
        if unsub:
            try:
                unsub()
            except Exception:
                pass


async def async_reset_latch(hass: HomeAssistant, entity_id: str) -> bool:
    """Clear one sensor's latch (the Atlas Reset button). Returns True if it
    existed. Resetting is unconditional — the underlying HA entity's real,
    current state is untouched; this only dismisses PadSpan's own memory
    that it was recently triggered. Shares _async_latch's lock: a reset
    racing a fresh trigger for a DIFFERENT entity is the same
    read-modify-write hazard the module docstring describes, just from a
    second caller."""
    dom = hass.data.get(DOMAIN)
    if not dom:
        return False
    st = dom.get(DATA_SETTINGS)
    if not st:
        return False
    lock = dom.setdefault(_DATA_LOCK, asyncio.Lock())
    async with lock:
        latches = dict(st.data.get("flood_latches") or {})
        if entity_id not in latches:
            return False
        del latches[entity_id]
        await st.async_set(flood_latches=latches)
        return True
