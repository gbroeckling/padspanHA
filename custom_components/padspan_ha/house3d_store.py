# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard, the 3D house: its own file, padspan_ha.house3d.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md on the live-aboard branch ("Data", "Normally
off"). Everything the 3D view needs that the map does not hold lives here, so
this feature never writes the map (fabric, model, maps, light positions).

Normally off. While settings.atlas_3d_enabled is False (the default) the file
is registered, so backup, restore and factory reset know it, but nothing
writes it, and it is not even loaded until something asks for it
(async_get_store), so an install with the feature off does no work at all.

The Home Assistant store version stays 1 forever: a different major version
makes HA refuse the file, SafeStore turns that into None, and the next save
would overwrite what was there. Shape changes go through the data's own
"schema" field. Reading is tolerant: every key is kept, known or not, so an
older and a newer PadSpan never lose what the other wrote.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_HOUSE3D, DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY
from .safe_store import wrap_store

SCHEMA = 1
# The keyed sections (docs: pieces, 3D-only light heights, door hinge and swing,
# beacon/scanner recipes, people figures). "library" holds the terms acceptance.
SECTIONS: tuple[str, ...] = ("pieces", "lights", "openings", "devices", "figures")


def empty() -> dict[str, Any]:
    """The file's content for a house with nothing in 3D yet."""
    return {"schema": SCHEMA, **{k: {} for k in SECTIONS}, "library": {}}


def normalise(raw: Any) -> dict[str, Any]:
    """Tolerant read: every key in `raw` is kept; a missing or broken section
    becomes empty; anything that is not a dict is an empty house."""
    if not isinstance(raw, dict):
        return empty()
    out = dict(raw)
    out.setdefault("schema", SCHEMA)
    for k in (*SECTIONS, "library"):
        if not isinstance(out.get(k), dict):
            out[k] = {}
    return out


def file_path(hass: HomeAssistant) -> str:
    """Where Home Assistant keeps the file (.storage/<key>)."""
    return hass.config.path(".storage", HOUSE3D_STORE_KEY)


async def async_file_exists(hass: HomeAssistant) -> bool:
    """Has anything ever written the file? An install that never used the
    feature has none, and backups, restores and resets keep it that way."""
    import os  # noqa: PLC0415
    return bool(await hass.async_add_executor_job(os.path.isfile, file_path(hass)))


def enabled(hass: HomeAssistant) -> bool:
    """The master switch, settings.atlas_3d_enabled (default off)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool(((st.data if st else {}) or {}).get("atlas_3d_enabled", False))


class House3dStore:
    """padspan_ha.house3d. `.data` is what a PadSpan backup saves and a
    restore replaces (ws_common._DATA_KEY_MAP)."""

    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self._raw_store = Store(hass, 1, HOUSE3D_STORE_KEY)
        self.store = wrap_store(self._raw_store, hass, "house3d")
        self._data: dict[str, Any] = empty()

    @property
    def data(self) -> dict[str, Any]:
        return self._data

    @data.setter
    def data(self, value: Any) -> None:
        # A restore (ws_backup) and a factory reset assign .data directly:
        # whatever comes in is read the tolerant way, so the sections are
        # always there for the code that reads them.
        self._data = normalise(value)

    async def async_load(self) -> dict[str, Any]:
        self.data = normalise(await self.store.async_load())
        return self.data

    async def async_save(self) -> bool:
        return bool(await self.store.async_save(self.data))

    async def async_clear(self) -> bool:
        self.data = empty()
        return await self.async_save()

    def counts(self) -> dict[str, int]:
        return {k: len(self.data.get(k) or {}) for k in SECTIONS}


async def async_get_store(hass: HomeAssistant) -> House3dStore:
    """The store, loaded on first use and kept in hass.data. Loading reads the
    file; it never writes it."""
    dom = hass.data.setdefault(DOMAIN, {})
    store = dom.get(DATA_HOUSE3D)
    if not isinstance(store, House3dStore):
        store = House3dStore(hass)
        await store.async_load()
        dom[DATA_HOUSE3D] = store
    return store
