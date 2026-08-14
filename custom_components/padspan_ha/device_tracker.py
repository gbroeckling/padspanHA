# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Device Trackers
==============================
Creates device_tracker.{label} entities for every labelled BLE device.
location_name = current room, so the tracker can be linked to a HA Person.

When not seen for longer than the configured away timeout (Settings → Presence →
Away timeout; default 5 minutes), location_name returns "not_home" explicitly.
It must be named, not left as None: HA falls through None to latitude/longitude,
which this tracker does not have, so the state came out "unknown" instead.

Entity ID example:  device_tracker.padspan_car_keys
Person link:        Settings → People → Alice → add device_tracker.padspan_alice_phone
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, DATA_SETTINGS, DATA_DEVICE_REGISTRY
from .presence_coordinator import PresenceCoordinator
from .presence_rules import away_timeout_s, is_away

# HA's own constant, with a literal fallback so an import change upstream
# cannot silently turn the away state back into "unknown".
try:
    from homeassistant.const import STATE_NOT_HOME
except ImportError:  # pragma: no cover
    STATE_NOT_HOME = "not_home"

_LOGGER = logging.getLogger(__name__)

# The away rule lives in presence_rules; this alias keeps existing call sites
# reading naturally while there is exactly one implementation.
_away_timeout_s = away_timeout_s

try:
    from homeassistant.components.device_tracker import SourceType, TrackerEntity
except ImportError:  # very old HA — graceful degradation
    TrackerEntity = None  # type: ignore[assignment,misc]
    SourceType = None  # type: ignore[assignment]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    if TrackerEntity is None:
        _LOGGER.warning("device_tracker.TrackerEntity unavailable — skipping PadSpan trackers")
        return

    coordinator: PresenceCoordinator | None = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    if not coordinator:
        return

    created: set[str] = set()
    # label → entity instance (for key migration on MAC rotation)
    label_entity: dict[str, PadSpanDeviceTracker] = {}

    @callback
    def _check_new() -> None:
        if not coordinator.data:
            return
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        _tracker_on = ((st.data or {}) if st else {}).get("ha_entity_tracker_enabled", True)
        if not _tracker_on:
            return
        new: list[PadSpanDeviceTracker] = []
        # Sort by freshness — lowest age_s first so the active key wins dedup
        items = sorted(
            coordinator.data.items(),
            key=lambda kv: kv[1].get("age_s") if isinstance(kv[1].get("age_s"), (int, float)) else 999999,
        )
        for key, obj in items:
            if key in created:
                # Key already tracked — but check if entity needs key refresh
                label = obj.get("user_label")
                if label and label in label_entity:
                    entity = label_entity[label]
                    age = obj.get("age_s")
                    old_obj = (coordinator.data or {}).get(entity._key, {})
                    old_age = old_obj.get("age_s")
                    # If this key is fresher than the entity's current key, migrate
                    if (isinstance(age, (int, float)) and
                        (not isinstance(old_age, (int, float)) or age < old_age) and
                        entity._key != key):
                        _LOGGER.debug(
                            "Migrating tracker '%s' from stale key %s to fresh key %s",
                            label, entity._key, key,
                        )
                        entity._key = key
                continue
            if obj.get("kind") in ("ble", "private_ble", "ibeacon") and obj.get("user_label"):
                label = obj["user_label"]
                if label in label_entity:
                    # Label already has an entity — migrate its key if this one is fresher
                    entity = label_entity[label]
                    old_obj = (coordinator.data or {}).get(entity._key, {})
                    old_age = old_obj.get("age_s")
                    age = obj.get("age_s")
                    if (isinstance(age, (int, float)) and
                        (not isinstance(old_age, (int, float)) or age < old_age)):
                        _LOGGER.debug(
                            "Migrating tracker '%s' from key %s to fresher key %s",
                            label, entity._key, key,
                        )
                        entity._key = key
                    created.add(key)
                    continue
                entity = PadSpanDeviceTracker(coordinator, key)
                new.append(entity)
                created.add(key)
                label_entity[label] = entity
        if new:
            _LOGGER.debug("Adding %d new PadSpan device tracker(s)", len(new))
            async_add_entities(new)

    _check_new()
    entry.async_on_unload(coordinator.async_add_listener(_check_new))


def _device_uid(obj: dict[str, Any]) -> str:
    # Prefer padspan_id (immutable stable identity from DeviceRegistry),
    # then canonical_id (survives MAC rotation for private_ble),
    # then volatile identifiers as last resort.
    if obj.get("padspan_id"):
        return obj["padspan_id"]
    if obj.get("canonical_id"):
        return obj["canonical_id"]
    return obj.get("address") or obj.get("entity_id") or obj.get("key", "")


def _stable_uid_key(hass: HomeAssistant, key: str, obj: dict[str, Any]) -> str:
    """Return the identity string used to build entity unique_ids.

    irk:/ibeacon:/entity: keys are already stable — keep the key-based scheme
    so entities registered under it are not orphaned.  Plain ble:/MAC keys
    rotate across restarts (labelled phones without a registered IRK,
    random-static MACs, degraded-mode IRK devices), minting _2/_3 orphan
    entities — for those, prefer the persistent padspan_id from the
    DeviceRegistry, then canonical_id, falling back to the key itself.
    """
    if key.startswith(("irk:", "ibeacon:", "entity:")):
        return key
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if dev_reg:
        # Only trust persistent registry entries — ephemeral padspan_ids are
        # regenerated every restart and would fragment unique_ids further.
        pid = obj.get("padspan_id")
        if pid and dev_reg.get(pid):
            return str(pid)
        rpid = dev_reg.resolve(key)
        if rpid and dev_reg.get(rpid):
            return str(rpid)
    if obj.get("canonical_id"):
        return str(obj["canonical_id"])
    return key


class PadSpanDeviceTracker(CoordinatorEntity["PresenceCoordinator"], TrackerEntity):  # type: ignore[misc]
    """Device tracker whose location_name is the current room for a labelled BLE device."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: "PresenceCoordinator", key: str) -> None:
        super().__init__(coordinator)
        self._key = key
        # Snapshot label and device UID at creation time (when coordinator.data has
        # the object).  This prevents device_info from returning empty identifiers
        # if the object temporarily drops out of the coordinator result.
        obj = (coordinator.data or {}).get(key, {})
        self._init_label = str(obj.get("user_label") or obj.get("name") or key)
        self._init_uid = _device_uid(obj) or key
        # Snapshot at creation: unique_id must never follow _key migrations
        self._uid_key = _stable_uid_key(coordinator.hass, key, obj)

    # ── internal helpers ─────────────────────────────────────────────────────

    @property
    def _obj(self) -> dict[str, Any]:
        return (self.coordinator.data or {}).get(self._key, {})

    def _label(self) -> str:
        obj = self._obj
        return str(obj.get("user_label") or obj.get("name") or self._init_label)

    # ── HA entity identity ────────────────────────────────────────────────────

    @property
    def unique_id(self) -> str:
        safe = self._uid_key.replace(":", "_").replace(" ", "_").replace("/", "_")
        return f"padspan_ha__{safe}__tracker"

    # name=None with has_entity_name=True → entity IS the device's main feature.
    # entity_id becomes device_tracker.alice (just the device label, no suffix).
    _attr_name = None

    @property
    def device_info(self) -> dict[str, Any]:
        uid = _device_uid(self._obj) or self._init_uid
        return {
            "identifiers": {(DOMAIN, uid)},
            "name": self._label(),
            "manufacturer": "PadSpan HA",
            "model": "BLE Presence Tracker",
        }

    # ── TrackerEntity requirements ────────────────────────────────────────────

    @property
    def source_type(self):
        if SourceType is not None:
            return SourceType.BLUETOOTH_LE
        return "bluetooth_le"

    @property
    def location_name(self) -> str | None:
        """Room name when seen recently, "not_home" once the timeout passes.

        Returning None here does NOT mean not_home: HA falls through to
        latitude/longitude, and this tracker has neither, so the state came out
        "unknown" — a car gone for an hour read as a device HA knew nothing
        about, and no automation could act on it. The away state has to be
        named explicitly.
        """
        obj = self._obj
        if is_away(obj, away_timeout_s(self.coordinator.hass)):
            return STATE_NOT_HOME
        return obj.get("room") or None

    @property
    def latitude(self) -> float | None:
        return None

    @property
    def longitude(self) -> float | None:
        return None

    @property
    def battery_level(self) -> int | None:
        return None

    @property
    def available(self) -> bool:
        # Always available while the coordinator is healthy — "not_home" is a
        # valid persistent state, not an error condition.
        return bool(self.coordinator.last_update_success and self.coordinator.data is not None)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        obj = self._obj
        age = obj.get("age_s")
        home = not (isinstance(age, (int, float)) and age > _away_timeout_s(self.coordinator.hass))
        return {
            "address": obj.get("address"),
            "padspan_id": obj.get("padspan_id"),
            "rssi": obj.get("rssi") if home else None,
            "age_s": round(age, 1) if isinstance(age, (int, float)) else None,
            "user_label": obj.get("user_label"),
            "home": home,
        }
