# PadSpan HA — Safe Storage Wrapper
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""
Safe wrapper around homeassistant.helpers.storage.Store that adds:
- Error handling on save (catches and logs failures)
- Write verification (the file is read back and compared with what was written)
- A repair notice, a log line and a count when a save did not reach the disk
- A failed read that raises instead of looking like a first boot

How a save is checked. Home Assistant's Store logs a failed write and returns
normally, so "the save returned" and "the file can be read" say nothing: the
read finds the old file. The only thing that tells is whether the file holds
what was written. So a save:

1. Takes the data as it is at that moment, in the form a JSON file holds it
   (tuples are lists, every key is text). The stores hand over their live
   dict, which other code goes on changing while the write is under way, so
   this copy is what gets written and what the file is compared with. The
   store's own data is never touched.
2. Has Home Assistant's Store write the copy.
3. Reads the file back and compares it with the copy.

One save at a time per store, and no load of it meanwhile, so the file read
back is this save's own. Nothing here writes a second time, restores an older
file or deletes one: a save that fails leaves the disk exactly as that failed
write left it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import operator
import os
from pathlib import Path
from typing import Any, Callable

from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

try:
    # What Home Assistant's Store writes a file with and reads it with, so the
    # copy is exactly what the file will hold.
    from homeassistant.helpers.json import json_bytes as _to_json
    from homeassistant.util.json import json_loads as _from_json
except ImportError:
    # No Home Assistant JSON helpers (the test suite's stand-in for Home
    # Assistant): the standard library, made to give the same result. A set
    # is written as a list, and NaN and infinity read back as None.
    def _json_default(obj: Any) -> Any:
        if isinstance(obj, (set, frozenset)):
            return list(obj)
        raise TypeError(f"Type is not JSON serializable: {type(obj).__name__}")

    def _to_json(data: Any) -> bytes:
        return json.dumps(data, default=_json_default).encode("utf-8")

    def _from_json(blob: bytes) -> Any:
        return json.loads(blob, parse_constant=lambda _name: None)


class SafeStore:
    """Drop-in replacement for direct Store usage with safety guarantees."""

    def __init__(self, store: Store, hass: HomeAssistant, name: str = ""):
        self._store = store
        self._hass = hass
        self._name = name or store.key
        # One save at a time, and no load meanwhile: a second save's write
        # would otherwise land between this save's write and its read-back,
        # and Home Assistant hands a read that is already under way (begun
        # before the write) to whoever asks next.
        self._lock = asyncio.Lock()
        # Is this store's repair notice up? None until the first save of this
        # run has been checked (a notice can be left from before a restart).
        self._failing: bool | None = None
        # Saves that did not reach the disk since Home Assistant started.
        self.failed_saves = 0

    async def async_save(self, data: Any) -> bool:
        """Save data, then read the file back and compare.

        Returns True if the file holds what was saved, False if it does not
        (the caller's data is unchanged either way, and so is the file a
        failed write left).
        """
        async with self._lock:
            try:
                blob = _to_json(data)
            except Exception as exc:  # noqa: BLE001
                return self._failed("PadSpan save FAILED for %s: it cannot be written as JSON (%s)", exc)
            # Parsing and comparing a large store takes a while: off the event loop.
            written = await self._hass.async_add_executor_job(_from_json, blob)

            try:
                await self._store.async_save(written)
            except Exception as exc:  # noqa: BLE001
                return self._failed("PadSpan save FAILED for %s: %s", exc)

            if self._hass.state is CoreState.stopping:
                # Home Assistant is shutting down: it keeps the data and writes
                # it in its own last step, so there is no file to check yet.
                return True

            try:
                back = await self._store.async_load()
            except Exception as exc:  # noqa: BLE001
                # A file that cannot be read back is a save nobody can vouch
                # for. async_save() above returning says nothing (Home
                # Assistant swallows a failed write), so this is not counted
                # as saved; the next save that checks out clears it.
                return self._failed(
                    "PadSpan save VERIFICATION FAILED for %s: the file could not be read back (%s)", exc
                )

            if not await self._hass.async_add_executor_job(operator.eq, back, written):
                return self._failed(
                    "PadSpan save VERIFICATION FAILED for %s: the file does not hold what was written"
                )

            if self._failing is not False:
                if self._failing:
                    _LOGGER.warning("PadSpan save for %s reaches the disk again", self._name)
                self._failing = False
                self._notice(False)
            return True

    def _failed(self, message: str, *args: Any) -> bool:
        """A save that did not reach the disk: count it, and the first time
        (until a save works again) log it and raise the repair notice. The
        log names the store and the error, never the data."""
        self.failed_saves += 1
        if not self._failing:
            self._failing = True
            _LOGGER.error(message, self._name, *args)
            self._notice(True)
        return False

    def _notice(self, failing: bool) -> None:
        """Raise this store's repair notice (Settings, Repairs), or take it
        down. It is kept over a restart, and the next save that reaches the
        disk takes it down. A notice that cannot be raised must not turn a
        save into an exception."""
        try:
            from homeassistant.helpers import issue_registry as ir  # noqa: PLC0415
            issue_id = f"save_not_written_{self._name}"
            if failing:
                ir.async_create_issue(
                    self._hass,
                    DOMAIN,
                    issue_id,
                    is_fixable=False,
                    is_persistent=True,
                    severity=ir.IssueSeverity.ERROR,
                    translation_key="save_not_written",
                    translation_placeholders={"store": self._name},
                )
            else:
                ir.async_delete_issue(self._hass, DOMAIN, issue_id)
        except Exception as exc:  # noqa: BLE001
            _LOGGER.debug("PadSpan repair notice for %s could not be changed: %s", self._name, exc)

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
        async with self._lock:
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
    loaded = await store.async_load()
    if loaded is None or readable(loaded):
        return loaded
    raw = getattr(store, "_store", store)      # a SafeStore wraps the Store
    path = raw.path
    aside = f"{path}.unreadable.{dt_util.utcnow().isoformat()}"
    try:
        await raw.hass.async_add_executor_job(os.replace, path, aside)
        kept = f"moved to {Path(aside).name}"
    except OSError as err:
        kept = f"could not be moved aside ({err.strerror or err})"
    _LOGGER.error(
        "PadSpan could not read %s: its file holds %s, not what this version keeps there. It starts "
        "empty; the file %s. Restore a backup, or move the file back once a version that reads it runs.",
        raw.key, type(loaded).__name__, kept,
    )
    return None
