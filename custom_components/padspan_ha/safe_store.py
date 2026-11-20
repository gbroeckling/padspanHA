# PadSpan HA — Safe Storage Wrapper
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""
Safe wrapper around homeassistant.helpers.storage.Store that adds:
- Error handling on save (catches and logs failures)
- Write verification (reads back after save to confirm)
- Logging of all save operations for debugging
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Callable

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)


class SafeStore:
    """Drop-in replacement for direct Store usage with safety guarantees."""

    def __init__(self, store: Store, hass: HomeAssistant, name: str = ""):
        self._store = store
        self._hass = hass
        self._name = name or store.key

    async def async_save(self, data: Any) -> bool:
        """Save data with error handling and verification.

        Returns True if save succeeded, False if it failed.
        """
        try:
            await self._store.async_save(data)
        except Exception as exc:  # noqa: BLE001
            _LOGGER.error(
                "PadSpan save FAILED for %s: %s",
                self._name,
                exc,
            )
            return False

        # Verify the write by reading back
        try:
            verify = await self._store.async_load()
            if verify is None:
                _LOGGER.error(
                    "PadSpan save VERIFICATION FAILED for %s: read-back returned None",
                    self._name,
                )
                return False
        except Exception as exc:  # noqa: BLE001
            # Only a warning, not a failed save: async_save() above already
            # completed without raising, so the write itself succeeded. This
            # read-back is a belt-and-suspenders sanity check on top of that,
            # and a transient read error here (e.g. a momentary disk hiccup)
            # must not be reported as a lost write when the write itself is
            # fine — that would be a false alarm, not a caught bug.
            _LOGGER.warning(
                "PadSpan save verification read-back failed for %s: %s (save may still be ok)",
                self._name,
                exc,
            )

        return True

    async def async_load(self) -> Any:
        """Load data, logging a failure and RAISING it.

        Returning None for a failed read (an I/O error, a file it cannot
        open) told every store "first boot", and each saved its defaults over
        the real file: one bad read lost the rooms, maps, settings, licence
        and calibration. A read that fails now leaves the store unloaded for
        this run and the file untouched (house3d_store's ReadFailed rule).
        A file that is missing or corrupt is not an error here: Home
        Assistant returns None for the first and moves the second aside.
        """
        try:
            return await self._store.async_load()
        except Exception as exc:  # noqa: BLE001
            _LOGGER.error(
                "PadSpan load FAILED for %s: %s (the file is left untouched)",
                self._name,
                exc,
            )
            raise


def wrap_store(store: Store, hass: HomeAssistant, name: str = "") -> SafeStore:
    """Wrap a homeassistant Store with safety guarantees."""
    return SafeStore(store, hass, name)


async def async_load_readable(store: Store | SafeStore, readable: Callable[[Any], bool]) -> Any:
    """`store`'s data, or None when its file holds data `readable` says this
    version cannot use.

    Home Assistant moves a file it cannot parse aside (<file>.corrupt.<time>)
    and logs it. A file that parses but holds the wrong kind of data (a list
    where a dict is kept, a section missing) passed every check, so the store
    started empty without a word and its next save wrote over the person's
    file: rooms, labels, rules, safety copies, gone. That file is moved aside
    the same way (<file>.unreadable.<time>) and said once; the store then
    starts as with no file, which is what it did before, now with the file
    kept to restore from.
    """
    raw = getattr(store, "_store", store)      # a SafeStore wraps the Store
    try:
        loaded = await raw.async_load()
    except Exception as exc:  # noqa: BLE001 - told apart below, re-raised unless set aside
        # Valid JSON that is no store file at all (a bare list, a number, an
        # object without "data") makes Home Assistant's loader raise, every
        # time anything asks. Kept as a wrong-kind file is. Anything else (a
        # read that fails, a file Home Assistant could not open) is raised as
        # before, with the file left untouched.
        kind = await raw.hass.async_add_executor_job(_not_a_store_document, raw.path)
        if not kind:
            if raw is not store:
                _LOGGER.error("PadSpan load FAILED for %s: %s (the file is left untouched)",
                              getattr(store, "_name", raw.key), exc)
            raise
        return await _set_aside(raw, f"{kind}, not a Home Assistant store file")
    if loaded is None or readable(loaded):
        return loaded
    return await _set_aside(raw, f"{type(loaded).__name__}, not what this version keeps there")


def _not_a_store_document(path: str) -> str:
    """The kind of JSON the file holds when it is valid JSON but no Home
    Assistant store document ({"version": ..., "data": ...}); "" when it is
    one, or cannot be read or parsed (those are Home Assistant's to handle)."""
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return ""
    if isinstance(doc, dict) and "data" in doc:
        return ""
    return type(doc).__name__


async def _set_aside(raw: Store, what: str) -> None:
    """Move the store's file to <file>.unreadable.<time>, say so once, and
    let the store start as with no file."""
    path = raw.path
    aside = f"{path}.unreadable.{dt_util.utcnow().isoformat()}"
    try:
        await raw.hass.async_add_executor_job(os.replace, path, aside)
        kept = f"moved to {Path(aside).name}"
    except OSError as err:
        kept = f"could not be moved aside ({err.strerror or err})"
    _LOGGER.error(
        "PadSpan could not read %s: its file holds %s. It starts empty; the file %s. "
        "Restore a backup, or move the file back once a version that reads it runs.",
        raw.key, what, kept,
    )
    return None
