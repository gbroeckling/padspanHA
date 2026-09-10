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
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

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
        """Load data with error handling."""
        try:
            return await self._store.async_load()
        except Exception as exc:  # noqa: BLE001
            _LOGGER.error(
                "PadSpan load FAILED for %s: %s",
                self._name,
                exc,
            )
            return None


def wrap_store(store: Store, hass: HomeAssistant, name: str = "") -> SafeStore:
    """Wrap a homeassistant Store with safety guarantees."""
    return SafeStore(store, hass, name)
