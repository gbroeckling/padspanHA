# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard: a person deleted in Home Assistant takes their figure along.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("People": deleting the person or the
figure deletes the recipe). Home Assistant's entity registry says when an
entity is deleted ("entity_registry_updated", action "remove"). For a
person.* entity whose figure is in Live Aboard's file, that figure is taken
out: one write, under the store's lock (House3dStore.lock, which every Save
holds), counted only once the file reads back as written. Nothing else in the
file changes, and a file without that figure is not written at all.

Only that event deletes. A person missing from the states (Home Assistant
starting, a restart, the person integration reloading) is never taken for a
deleted one: nothing here reads the states. A rename (an "update" with a new
entity id) moves the figure to the new id, the same way, so deleting the
person later still takes it.

Deleting the person is the owner's own act, and a figure is personal data, so
this holds whatever the Live Aboard switch says (off, or below Pro): the
recipe goes with the person. A house that never wrote the file has none to
read, and then nothing is read or written. A file that cannot be read, or a
newer PadSpan's, is left alone (the People screen still offers Remove).
"""

from __future__ import annotations

import copy
import functools
import logging
from typing import Any

from homeassistant.core import HomeAssistant, callback as ha_callback

from .const import DOMAIN
from .house3d_store import ReadFailed, async_file_exists, async_get_store, writable

_LOGGER = logging.getLogger(__name__)

_UNSUB = "house3d_people_unsub"     # hass.data[DOMAIN]: the registry listener


@ha_callback
def _on_entity_registry_updated(hass: HomeAssistant, event: Any) -> None:
    """A person deleted in Home Assistant: their figure goes; renamed: it
    moves to the new id (off the loop)."""
    data = getattr(event, "data", None) or {}
    entity_id, old = data.get("entity_id"), data.get("old_entity_id")
    if not isinstance(entity_id, str) or not entity_id.startswith("person."):
        return
    if data.get("action") == "remove":
        hass.async_create_task(async_forget_person(hass, entity_id))
    elif data.get("action") == "update" and isinstance(old, str) and old.startswith("person.") and old != entity_id:
        hass.async_create_task(async_rename_person(hass, old, entity_id))


async def async_forget_person(hass: HomeAssistant, entity_id: str) -> bool:
    """Take `entity_id`'s figure out of Live Aboard's file. True once the file
    no longer holds it (written and read back); False when it had none, or
    when it could not be taken out (the file unreadable, a newer PadSpan's,
    or the write failed: the figure stays, and Remove still works)."""
    if not await async_file_exists(hass):
        return False                          # never written: no figure, nothing to read
    try:
        store = await async_get_store(hass)
    except ReadFailed:
        _LOGGER.warning("Live Aboard: %s was deleted, but Live Aboard's file could not be read; "
                        "their figure is still in it", entity_id)
        return False
    async with store.lock:
        figures = store.data.get("figures")
        if not isinstance(figures, dict) or entity_id not in figures or not writable(store.data):
            return False
        new = copy.deepcopy(store.data)
        del new["figures"][entity_id]
        if not await store.async_write(new):
            _LOGGER.error("Live Aboard: %s was deleted, but their figure could not be removed "
                          "(the file was not written)", entity_id)
            return False
    _LOGGER.info("Live Aboard: %s was deleted in Home Assistant; their figure is removed", entity_id)
    return True


async def async_rename_person(hass: HomeAssistant, old: str, new_id: str) -> bool:
    """Move `old`'s figure to `new_id` (the person's entity id changed). True
    once written and read back; False when there is nothing to move (no file,
    no figure, or `new_id` already has one: that one is kept) or it could not
    be written (the figure stays under the old id)."""
    if not await async_file_exists(hass):
        return False
    try:
        store = await async_get_store(hass)
    except ReadFailed:
        _LOGGER.warning("Live Aboard: %s was renamed %s, but Live Aboard's file could not be read; "
                        "their figure keeps the old name", old, new_id)
        return False
    async with store.lock:
        figures = store.data.get("figures")
        if (not isinstance(figures, dict) or old not in figures or new_id in figures
                or not writable(store.data)):
            return False
        new = copy.deepcopy(store.data)
        new["figures"][new_id] = new["figures"].pop(old)
        if not await store.async_write(new):
            _LOGGER.error("Live Aboard: %s was renamed %s, but their figure could not be moved "
                          "(the file was not written)", old, new_id)
            return False
    _LOGGER.info("Live Aboard: %s was renamed %s in Home Assistant; their figure moved with them", old, new_id)
    return True


def async_setup_house3d_people(hass: HomeAssistant) -> None:
    """Idempotent across config-entry reloads (flood_latch.py's shape):
    functools.partial, so Home Assistant finds the @callback and runs the
    listener on the loop."""
    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_UNSUB):
        return
    dom[_UNSUB] = hass.bus.async_listen(
        "entity_registry_updated", functools.partial(_on_entity_registry_updated, hass)
    )


def async_stop_house3d_people(hass: HomeAssistant) -> None:
    unsub = (hass.data.get(DOMAIN) or {}).pop(_UNSUB, None)
    if unsub:
        unsub()
