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
this save happened, and whether the file now holds what it wrote. So:

1. SafeStore watches the Store's write. When Home Assistant writes the file
   (in its executor, with the text it made from the data), SafeStore takes a
   digest of exactly that text, and only once the write has returned without
   an error. A write that failed, or never ran, leaves no digest.
2. After the save, the file is read and its digest compared with that one,
   off the event loop.

Nothing is copied, turned into JSON a second time or parsed: the text is the
one Home Assistant made, so data that other code changes while the write is
under way is still judged by what was written. Home Assistant before 2025.12
does not hand the text over (it makes it and writes it in one step); there
the check is that its write of this save returned without an error. It writes
to a temporary file and moves it into place, all or nothing.

One save at a time per store, so the digest is this save's own. Nothing here
writes a second time, restores an older file or deletes one: a save that
fails leaves the disk exactly as that failed write left it.
"""
from __future__ import annotations

import asyncio
import hashlib
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

# The write returned, and this Home Assistant hands over no text to compare.
_WROTE_UNSEEN = b""


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
        # One save at a time: the digest a write leaves is that save's own.
        self._lock = asyncio.Lock()
        # The digest of what Home Assistant wrote for the save under way;
        # None until (and unless) its write returns without an error.
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
        """Have the Store tell this SafeStore what it wrote. Home Assistant
        2025.12 and later write through _write_prepared_data(mode, text);
        earlier ones through _write_data(path, data), which makes the text and
        writes it in one step. Either raises when the write fails (Home
        Assistant then logs it and returns normally)."""
        for name in ("_write_prepared_data", "_write_data"):
            write = getattr(self._store, name, None)
            if callable(write):
                break
        else:
            return False
        sees_text = name == "_write_prepared_data"

        def watched(*args: Any) -> None:   # in Home Assistant's executor
            write(*args)
            self._wrote = _digest(args[-1]) if sees_text else _WROTE_UNSEEN

        setattr(self._store, name, watched)
        return True

    async def async_save(self, data: Any) -> bool:
        """Save data, then check that the file holds what was written.

        Returns True if it does, False if it does not (the caller's data is
        unchanged either way, and so is the file a failed write left).
        """
        async with self._lock:
            self._wrote = None
            try:
                await self._store.async_save(data)
            except Exception as exc:  # noqa: BLE001
                return self._failed("PadSpan save FAILED for %s: %s", exc)

            if self._hass.state is CoreState.stopping or not self._watched:
                # Home Assistant is shutting down: it keeps the data and writes
                # it in its own last step, so there is no file to check yet.
                # (Or a Store whose write cannot be watched: said at start.)
                return True

            if self._wrote is None:
                return self._failed(
                    "PadSpan save FAILED for %s: Home Assistant did not write the file (its log says why)"
                )

            if self._wrote is not _WROTE_UNSEEN:
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
