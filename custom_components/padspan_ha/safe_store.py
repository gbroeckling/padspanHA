# PadSpan HA — Safe Storage Wrapper
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""
Safe wrapper around homeassistant.helpers.storage.Store that adds:
- Error handling on save (catches and logs failures)
- Write verification (the file must hold the bytes Home Assistant wrote)
- A repair notice, a log line and a count when a save did not reach the disk
- A failed read that raises instead of looking like a first boot

How a save is checked. Home Assistant's Store logs a failed write and returns
normally, so "the save returned" and "the file can be read" say nothing: the
read finds the old file. What tells is whether Home Assistant's own write of
this save happened, and whether the file now holds what it wrote. So
SafeStore watches the Store's write:

1. The write of this save must return without an error. Home Assistant's
   write raises when the text cannot be made or the file cannot be written
   (a full or read-only disk), and a write it skips never runs: either way
   the save is not saved.
2. Home Assistant 2025.12 and later hand the text they made to the part that
   writes the file. SafeStore takes a digest of exactly that text once it is
   written, and after the save reads the file and compares its digest, off
   the event loop. Earlier versions make the text and write it in one step;
   there the check is the first one. Home Assistant writes a temporary file
   and moves it into place, all or nothing.

Nothing is copied, turned into JSON a second time or parsed: the text is the
one Home Assistant made, so data that other code changes while the write is
under way is still judged by what was written.

One save at a time per store, so what the write leaves is this save's own.
Nothing here writes a second time, restores an older file or deletes one: a
save that fails leaves the disk exactly as that failed write left it.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any, Callable

from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

def _digest(text: bytes | str) -> bytes:
    """The digest of what Home Assistant writes (bytes, or text it writes as
    UTF-8). Hashing a large buffer lets go of the interpreter lock."""
    return hashlib.blake2b(text.encode("utf-8") if isinstance(text, str) else text).digest()


def _file_digest(path: str) -> bytes:
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "blake2b").digest()


class SafeStore:
    """Drop-in replacement for direct Store usage with safety guarantees."""

    def __init__(self, store: Store, hass: HomeAssistant, name: str = ""):
        self._store = store
        self._hass = hass
        self._name = name or store.key
        # One save at a time: what a write leaves here is that save's own.
        self._lock = asyncio.Lock()
        # For the save under way: did Home Assistant's write of it return
        # without an error, and the digest of the text it wrote (when its
        # Store hands the text over).
        self._written = False
        self._wrote: bytes | None = None
        self._watched = self._watch_writes()
        if not self._watched:
            _LOGGER.warning(
                "PadSpan cannot check that saves of %s reach the disk with this Home Assistant version", self._name
            )
        # Is this store's repair notice up? None until the first save of this
        # run has been checked (a notice can be left from before a restart).
        self._failing: bool | None = None
        # Saves that did not reach the disk since Home Assistant started.
        self.failed_saves = 0

    def _watch_writes(self) -> bool:
        """Have the Store tell this SafeStore what it wrote.

        Every Home Assistant since 2024.1 writes a store through
        _async_write_data, which raises when the text cannot be made or the
        file cannot be written (the Store then logs it and returns normally).
        Home Assistant 2025.12 and later hand the text to
        _write_prepared_data(mode, text) in the executor, where its digest is
        taken once the write has returned."""
        write = getattr(self._store, "_async_write_data", None)
        if not callable(write):
            return False

        async def watched(*args: Any) -> None:
            await write(*args)
            self._written = True

        setattr(self._store, "_async_write_data", watched)

        write_text = getattr(self._store, "_write_prepared_data", None)
        if callable(write_text):
            def watched_text(*args: Any) -> None:   # in Home Assistant's executor
                write_text(*args)
                self._wrote = _digest(args[-1])

            setattr(self._store, "_write_prepared_data", watched_text)
        return True

    async def async_save(self, data: Any) -> bool:
        """Save data, then check that the file holds what was written.

        Returns True if it does, False if it does not (the caller's data is
        unchanged either way, and so is the file a failed write left).
        """
        async with self._lock:
            self._written, self._wrote = False, None
            try:
                await self._store.async_save(data)
            except Exception as exc:  # noqa: BLE001
                return self._failed("PadSpan save FAILED for %s: %s", exc)

            if self._hass.state is CoreState.stopping or not self._watched:
                # Home Assistant is shutting down: it keeps the data and writes
                # it in its own last step, so there is no file to check yet.
                # (Or a Store whose write cannot be watched: said at start.)
                return True

            if not self._written:
                return self._failed(
                    "PadSpan save FAILED for %s: Home Assistant did not write the file (its log says why)"
                )

            if self._wrote is not None:
                try:
                    on_disk = await self._hass.async_add_executor_job(_file_digest, self._store.path)
                except Exception as exc:  # noqa: BLE001
                    # A file that cannot be read back is a save nobody can
                    # vouch for; the next save that checks out clears it.
                    return self._failed(
                        "PadSpan save VERIFICATION FAILED for %s: the file could not be read back (%s)", exc
                    )
                if on_disk != self._wrote:
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
            _quiet_error("safe_store:notice")
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
        try:
            return await self._store.async_load()
        except Exception as exc:  # noqa: BLE001
            # Valid JSON that is no store file at all is not a failed read:
            # async_load_readable sets it aside and says so once.
            path = getattr(self._store, "path", None)
            if not path or not await self._hass.async_add_executor_job(_not_a_store_document, path):
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
        loaded = await store.async_load()
    except Exception:  # noqa: BLE001 - told apart below, re-raised unless set aside
        # Valid JSON that is no store file at all (a bare list, a number, an
        # object without "data") makes Home Assistant's loader raise, every
        # time anything asks. Kept as a wrong-kind file is. Anything else (a
        # read that fails, a file Home Assistant could not open) is raised as
        # before, with the file left untouched.
        hass = getattr(raw, "hass", None) or getattr(store, "_hass", None)
        path = getattr(raw, "path", None)
        kind = await hass.async_add_executor_job(_not_a_store_document, path) if hass is not None and path else ""
        if not kind:
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
    except (OSError, ValueError, TypeError):
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
