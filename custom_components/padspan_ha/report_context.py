# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Two facts for the opt-in usage report that Home Assistant holds, not PadSpan.

    env.store     which store keeps this copy up to date: Home Assistant's
                  Marketplace (2026.11 and newer), HACS before it, or neither
                  (copied in by hand). One word from STORE_WORDS.
    env.used_in   how many automations and how many scripts use one of
                  PadSpan's entities or devices. Two counts, never which.

Both only read. The store is asked one question, whether it lists this
repository as installed; automations and scripts are asked through Home
Assistant's own "what uses this entity" helpers. telemetry.build_payload
calls both and leaves a field out when it cannot be read.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .quiet_errors import note as _quiet_error

REPOSITORY = "gbroeckling/padspanHA"
STORE_WORDS: tuple[str, ...] = ("marketplace", "hacs", "manual", "unknown")
USED_IN_KEYS: tuple[str, ...] = ("automations", "scripts")


def _lists_installed(repositories: Any) -> bool:
    """A store's repository list (the Marketplace's and HACS's share this
    shape: get_by_full_name(), then .data.installed)."""
    repo = repositories.get_by_full_name(REPOSITORY)
    return repo is not None and repo.data.installed is True


def install_store(hass: HomeAssistant) -> str:
    """"marketplace" or "hacs" when that store lists PadSpan as installed,
    "manual" when no store does, "unknown" when a store could not be read.
    An install HACS made that the Marketplace took over reads "marketplace":
    this is who keeps it up to date now, not who installed it first."""
    try:
        for entry in hass.config_entries.async_entries("marketplace"):
            manager = getattr(entry, "runtime_data", None)
            if manager is not None and _lists_installed(manager.repositories):
                return "marketplace"
        hacs = hass.data.get("hacs")
        if hacs is not None and _lists_installed(hacs.repositories):
            return "hacs"
    except Exception:  # noqa: BLE001 - another integration's objects: any surprise is "unknown"
        _quiet_error("report_context:install_store")
        return "unknown"
    return "manual"


def count_users(entity_ids: Iterable[str], device_ids: Iterable[str],
                with_entity: Callable[[str], Iterable[str]],
                with_device: Callable[[str], Iterable[str]]) -> int:
    """How many different automations (or scripts) use any of these."""
    users: set[str] = set()
    for eid in entity_ids:
        users.update(with_entity(eid))
    for did in device_ids:
        users.update(with_device(did))
    return len(users)


def used_in(hass: HomeAssistant) -> dict[str, int] | None:
    """{"automations": n, "scripts": n}, or None for a house where PadSpan
    has no entity or device yet (nothing there to use)."""
    from homeassistant.components import automation, script  # noqa: PLC0415
    from homeassistant.helpers import device_registry as dr, entity_registry as er  # noqa: PLC0415
    from .util import ha_devices  # noqa: PLC0415
    entities = sorted(e.entity_id for e in er.async_get(hass).entities.values() if e.platform == DOMAIN)
    devices = sorted(d.id for d in ha_devices(dr.async_get(hass))
                     if any(i and i[0] == DOMAIN for i in d.identifiers))
    if not entities and not devices:
        return None
    return {
        "automations": count_users(entities, devices,
                                   lambda e: automation.automations_with_entity(hass, e),
                                   lambda d: automation.automations_with_device(hass, d)),
        "scripts": count_users(entities, devices,
                               lambda e: script.scripts_with_entity(hass, e),
                               lambda d: script.scripts_with_device(hass, d)),
    }
