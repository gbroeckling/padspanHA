# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Which key a label's HA entities are named after.

One label can sit on two keys: the phone wizard puts the phone's name on its
iBeacon key and its IRK, and naming a device copies the label onto several
keys. The entity's unique_id came from whichever key happened to poll first,
so a restart where the other key was fresher created a second set of
entities (device_tracker.phone_2) and left the first unavailable.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from .const import DATA_DEVICE_REGISTRY, DOMAIN

# Kinds whose key is already a stable identity, most stable first.
_PREFERRED = ("irk:", "ibeacon:")
# How long entity creation waits for PadSpan's device list to load: before
# it loads, a plain-address device is named after its address instead of its
# saved id, and that unique_id sticks.
REGISTRY_WAIT_S = 60.0


def uid_safe(text: str) -> str:
    return text.replace(":", "_").replace(" ", "_").replace("/", "_")


def alternates_of(key: str, obj: dict[str, Any]) -> list[str]:
    """The other names an older version may have given this key's entities."""
    return [u for u in (key, str(obj.get("canonical_id") or "")) if u]


def registry_ready(hass: Any, since_mono: float) -> bool:
    return (DATA_DEVICE_REGISTRY in hass.data.get(DOMAIN, {})
            or time.monotonic() - since_mono > REGISTRY_WAIT_S)


def pick_uid_key(hass: Any, platform: str, unique_ids: Callable[[str], list[str]],
                 candidates: list[tuple[str, str]], alternates: list[str] | None = None,
                 fallback: str | None = None) -> str:
    """The uid key for a label's new entity, from its (key, uid_key) pairs.

    An entity already registered under one of them - or under one of the
    `alternates` (the raw key or canonical id an older version named it
    after, e.g. before the device list loaded) - keeps it, so nothing
    existing is renamed. Otherwise `fallback` if given (the label's other
    entities' uid), else a fixed order (IRK, then iBeacon, then the rest
    alphabetically), not whichever key polled first.
    """
    try:
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
        reg = er.async_get(hass)
        tried: set[str] = set()
        for uid in [u for _k, u in candidates] + list(alternates or []):
            if not uid or uid in tried:
                continue
            tried.add(uid)
            for unique_id in unique_ids(uid):
                if reg.async_get_entity_id(platform, DOMAIN, unique_id):
                    return uid
    except Exception:  # noqa: BLE001 - no registry answer: the fixed order decides
        pass
    if fallback:
        return fallback

    def _rank(c: tuple[str, str]) -> tuple[int, str]:
        key = c[0]
        pos = next((i for i, p in enumerate(_PREFERRED) if key.startswith(p)), len(_PREFERRED))
        return pos, c[1]

    return min(candidates, key=_rank)[1]
