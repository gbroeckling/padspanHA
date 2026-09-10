# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
HA Tags integration — three features:

1. Room-change tag events: emit tag_scanned when followed objects change rooms
2. NFC tap-to-identify: listen for tag_scanned, auto-label nearest BLE object
3. Companion phone auto-linkage: auto-track scanning phone's BLE transmitter
"""

import logging
import re
import time
from typing import Any

from homeassistant.core import HomeAssistant, Event, callback, CALLBACK_TYPE

from .const import DOMAIN, DATA_SETTINGS, DATA_OBJECTS

_LOGGER = logging.getLogger(__name__)

DATA_TAG_INTEGRATION = "tag_integration"

# Cooldown for room-change tag events (seconds per object). A followed
# object flickering between two rooms at a boundary (or briefly losing and
# regaining its strongest scanner) would otherwise fire a fresh tag_scanned
# — and the automations hanging off it — on every recomputed room, not just
# on a real, settled move. 30s is long enough to absorb that flicker while
# still being short enough that a genuine walk-through-the-house sequence
# still produces one event per room.
_ROOM_TAG_COOLDOWN_S = 30


def _sanitize_tag_id(key: str) -> str:
    """Convert a PadSpan object key to a valid HA tag_id."""
    return "padspan_" + re.sub(r"[^a-z0-9_]", "_", key.lower().strip())


class TagIntegration:
    """Manages HA Tags ↔ PadSpan integration."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._unsub: CALLBACK_TYPE | None = None
        self._room_tag_last: dict[str, float] = {}  # key → last emit ts
        self._nfc_pending: dict[str, float] = {}  # tag_id → ts of pending NFC identify

    async def async_setup(self) -> None:
        """Start listening for tag_scanned events."""
        self._unsub = self.hass.bus.async_listen("tag_scanned", self._handle_tag_scanned)
        _LOGGER.debug("TagIntegration: listening for tag_scanned events")

    def unload(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    # ── Feature 1: Room-change tag events ────────────────────────────────────

    async def async_emit_room_changes(
        self,
        changes: list[tuple[str, str | None, str]],
        result: dict[str, Any],
    ) -> None:
        """Emit tag_scanned events for followed objects that changed rooms.

        Called from presence_coordinator after room changes are confirmed.
        Only emits for objects in the followed_addrs list.
        """
        settings = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if not settings:
            return
        if not settings.data.get("tags_room_events_enabled", False):
            return

        followed_raw = settings.data.get("followed_addrs") or []
        followed_upper = {str(f).upper() for f in followed_raw}
        if not followed_upper:
            return

        now = time.time()

        for key, old_room, new_room in changes:
            # Only emit for followed objects
            if key.upper() not in followed_upper:
                continue

            # Cooldown per object
            last = self._room_tag_last.get(key, 0.0)
            if now - last < _ROOM_TAG_COOLDOWN_S:
                continue
            self._room_tag_last[key] = now

            tag_id = _sanitize_tag_id(key)

            # Get display label
            obj = result.get(key) or {}
            label = obj.get("user_label") or obj.get("name") or key

            try:
                from homeassistant.components.tag import async_scan_tag
                await async_scan_tag(self.hass, tag_id, device_id=None)
                _LOGGER.debug(
                    "TagIntegration: emitted tag_scanned for %s (%s → %s), tag_id=%s",
                    label, old_room, new_room, tag_id,
                )
            except ImportError:
                _LOGGER.debug("TagIntegration: HA tag component not available")
                return
            except Exception as err:
                _LOGGER.debug("TagIntegration: tag emit failed for %s: %s", key, err)

            # Also fire a custom padspan event with richer data for automations
            self.hass.bus.async_fire("padspan_room_change", {
                "object_key": key,
                "label": label,
                "from_room": old_room,
                "to_room": new_room,
                "tag_id": tag_id,
                "timestamp": now,
            })

    # ── Feature 2 & 3: Handle incoming tag_scanned events ────────────────────

    async def _handle_tag_scanned(self, event: Event) -> None:
        """Handle tag_scanned events for NFC identify + phone auto-linkage."""
        data = event.data or {}
        tag_id = data.get("tag_id", "")
        device_id = data.get("device_id", "")

        # Ignore our own room-change tag events
        if str(tag_id).startswith("padspan_"):
            return

        _LOGGER.debug(
            "TagIntegration: tag_scanned received — tag_id=%s, device_id=%s",
            tag_id, device_id,
        )

        settings = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if not settings:
            return

        # Feature 3: Auto-link companion phone
        if device_id and settings.data.get("tags_phone_autolink_enabled", False):
            await self._try_autolink_phone(device_id)

        # Feature 2: NFC tap-to-identify
        if device_id and settings.data.get("tags_nfc_identify_enabled", False):
            await self._try_nfc_identify(tag_id, device_id)

    # ── Feature 2: NFC tap-to-identify ───────────────────────────────────────

    async def _try_nfc_identify(self, tag_id: str, device_id: str) -> None:
        """When a phone scans an NFC tag, label the nearest unidentified BLE object.

        Logic:
        1. Find which room the scanning phone is in (via its BLE transmitter)
        2. Find unidentified BLE objects in that room
        3. Pick the strongest-signal unidentified object
        4. Label it with the NFC tag name and follow it
        """
        try:
            phone_room = await self._get_phone_room(device_id)
            if not phone_room:
                _LOGGER.debug("TagIntegration NFC: scanning phone not in any room")
                return

            # Get current snapshot objects
            presence_coord = self.hass.data.get(DOMAIN, {}).get("presence_coordinator")
            if not presence_coord or not presence_coord.data:
                return

            obj_store = self.hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)

            # Find unidentified objects in the same room as the phone
            candidates: list[tuple[str, dict[str, Any]]] = []
            for key, obj in presence_coord.data.items():
                obj_room = obj.get("room")
                if obj_room != phone_room:
                    continue
                # Skip already identified/labelled objects
                if obj.get("user_label") or obj.get("identified"):
                    continue
                if obj_store and obj_store.get(key):
                    continue
                # Only BLE-type objects (not HA entities)
                kind = obj.get("kind", "")
                if kind not in ("ble", "private_ble", "ibeacon"):
                    continue
                candidates.append((key, obj))

            if not candidates:
                _LOGGER.debug(
                    "TagIntegration NFC: no unidentified objects in room '%s'",
                    phone_room,
                )
                # Fire event so frontend can show feedback
                self.hass.bus.async_fire("padspan_nfc_identify_result", {
                    "success": False,
                    "reason": "no_candidates",
                    "room": phone_room,
                    "tag_id": tag_id,
                })
                return

            # Pick the one with the strongest RSSI: an NFC tap only tells us
            # WHICH ROOM the phone was in, not which of several unidentified
            # objects the person actually meant. The strongest signal is the
            # object physically closest to the scanners covering that room —
            # the best available proxy for "the one the phone tapped near" —
            # so ties are broken toward proximity rather than, say, first-seen.
            best_key = None
            best_rssi = -999.0
            best_obj = None
            for key, obj in candidates:
                rssi = obj.get("rssi") or -100
                if rssi > best_rssi:
                    best_rssi = rssi
                    best_key = key
                    best_obj = obj

            if not best_key or not best_obj:
                return

            # Generate a label from the tag
            # Use the tag name if available, otherwise "NFC Tagged Object"
            label = f"NFC: {tag_id[:20]}"

            # Try to get a better name from HA's tag registry
            try:
                from homeassistant.helpers import collection
                tag_store = self.hass.data.get("tag")
                if tag_store and hasattr(tag_store, "async_get_item"):
                    tag_item = tag_store.async_get_item(tag_id)
                    if tag_item and hasattr(tag_item, "name") and tag_item.name:
                        label = tag_item.name
            except Exception:
                pass

            # Label and follow the object
            follow_key = best_key.upper()
            if obj_store:
                await obj_store.async_set(best_key, label)
                await obj_store.async_set(follow_key, label)

            # Add to followed list
            st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if st:
                followed_list = list(st.data.get("followed_addrs") or [])
                existing_upper = {f.upper() for f in followed_list}
                if follow_key not in existing_upper:
                    followed_list.append(follow_key)
                    await st.async_set(followed_addrs=followed_list)

            _LOGGER.info(
                "TagIntegration NFC: identified %s as '%s' in room '%s' (RSSI: %.0f)",
                best_key, label, phone_room, best_rssi,
            )

            # Fire event for frontend feedback
            self.hass.bus.async_fire("padspan_nfc_identify_result", {
                "success": True,
                "object_key": best_key,
                "label": label,
                "room": phone_room,
                "rssi": best_rssi,
                "tag_id": tag_id,
            })

        except Exception as err:
            _LOGGER.warning("TagIntegration NFC identify failed: %s", err)

    # ── Feature 3: Companion phone auto-linkage ──────────────────────────────

    async def _try_autolink_phone(self, device_id: str) -> None:
        """When a phone scans any NFC tag, auto-track its BLE transmitter if not already."""
        try:
            from homeassistant.helpers import device_registry as dr, entity_registry as er

            dev_reg = dr.async_get(self.hass)
            ent_reg = er.async_get(self.hass)

            # Find the device
            device = dev_reg.async_get(device_id)
            if not device:
                return

            # Check if it's a mobile_app device
            is_mobile = any(
                ident[0] == "mobile_app" for ident in (device.identifiers or set())
            )
            if not is_mobile:
                return

            # Find its BLE transmitter entity
            ble_entity = None
            for entity in ent_reg.entities.values():
                if entity.device_id != device_id:
                    continue
                if entity.platform != "mobile_app":
                    continue
                if "ble_transmitter" not in entity.entity_id:
                    continue
                ble_entity = entity
                break

            if not ble_entity:
                _LOGGER.debug("TagIntegration autolink: no BLE transmitter for device %s", device_id)
                return

            # Read transmitter state
            state_obj = self.hass.states.get(ble_entity.entity_id)
            if not state_obj:
                return

            attrs = state_obj.attributes or {}
            transmitting_id = (
                attrs.get("transmitting_id")
                or attrs.get("id")
                or attrs.get("uuid")
                or ""
            )
            if not transmitting_id and state_obj.state and len(state_obj.state) > 30:
                transmitting_id = state_obj.state

            if not transmitting_id:
                return

            # Parse UUID-Major-Minor out of the HA Companion App's BLE
            # Transmitter sensor value, which packs all three into one
            # dash-joined string (uuid-major-minor) rather than exposing them
            # as separate attributes. This exact block is duplicated verbatim
            # in _get_phone_room below — both need the identical parse but
            # are independent small helpers with different failure handling
            # around them, so the duplication is deliberate rather than an
            # oversight; keep any future fix to this parsing in sync in both
            # places.
            parts = transmitting_id.rsplit("-", 2)
            uuid_str = ""
            major = 0
            minor = 0
            if len(parts) >= 3:
                try:
                    minor = int(parts[-1])
                    major = int(parts[-2])
                    uuid_str = parts[-3] if "-" not in parts[-3] else "-".join(transmitting_id.split("-")[:-2])
                except (ValueError, IndexError):
                    uuid_str = transmitting_id
            if not uuid_str:
                uuid_str = transmitting_id

            uuid_clean = uuid_str.lower().strip()
            if len(uuid_clean) == 32:
                uuid_clean = f"{uuid_clean[:8]}-{uuid_clean[8:12]}-{uuid_clean[12:16]}-{uuid_clean[16:20]}-{uuid_clean[20:]}"

            ibeacon_key = f"ibeacon:{uuid_clean}:{major}:{minor}"
            follow_key = ibeacon_key.upper()

            # Check if already followed
            st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if not st:
                return
            followed_list = list(st.data.get("followed_addrs") or [])
            existing_upper = {f.upper() for f in followed_list}
            if follow_key in existing_upper:
                return  # already tracked

            # Auto-follow
            device_name = device.name or device.name_by_user or "Phone"
            obj_store = self.hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            if obj_store:
                await obj_store.async_set(ibeacon_key, device_name)
                await obj_store.async_set(follow_key, device_name)

            followed_list.append(follow_key)
            await st.async_set(followed_addrs=followed_list)

            _LOGGER.info(
                "TagIntegration autolink: auto-tracked phone '%s' (%s)",
                device_name, ibeacon_key,
            )

            self.hass.bus.async_fire("padspan_phone_autolinked", {
                "device_id": device_id,
                "device_name": device_name,
                "ibeacon_key": ibeacon_key,
            })

        except Exception as err:
            _LOGGER.debug("TagIntegration autolink failed: %s", err)

    # ── Helper: find which room a phone is in ────────────────────────────────

    async def _get_phone_room(self, device_id: str) -> str | None:
        """Find the room a scanning phone is currently in via its BLE transmitter."""
        try:
            from homeassistant.helpers import device_registry as dr, entity_registry as er

            dev_reg = dr.async_get(self.hass)
            ent_reg = er.async_get(self.hass)

            device = dev_reg.async_get(device_id)
            if not device:
                return None

            # Find the BLE transmitter entity for this device
            for entity in ent_reg.entities.values():
                if entity.device_id != device_id:
                    continue
                if entity.platform != "mobile_app":
                    continue
                if "ble_transmitter" not in entity.entity_id:
                    continue

                state_obj = self.hass.states.get(entity.entity_id)
                if not state_obj:
                    continue

                attrs = state_obj.attributes or {}
                transmitting_id = (
                    attrs.get("transmitting_id")
                    or attrs.get("id")
                    or attrs.get("uuid")
                    or ""
                )
                if not transmitting_id:
                    continue

                # Parse to ibeacon key, then look up in presence data
                parts = transmitting_id.rsplit("-", 2)
                uuid_str = ""
                major = 0
                minor = 0
                if len(parts) >= 3:
                    try:
                        minor = int(parts[-1])
                        major = int(parts[-2])
                        uuid_str = parts[-3] if "-" not in parts[-3] else "-".join(transmitting_id.split("-")[:-2])
                    except (ValueError, IndexError):
                        uuid_str = transmitting_id
                if not uuid_str:
                    uuid_str = transmitting_id

                uuid_clean = uuid_str.lower().strip()
                if len(uuid_clean) == 32:
                    uuid_clean = f"{uuid_clean[:8]}-{uuid_clean[8:12]}-{uuid_clean[12:16]}-{uuid_clean[16:20]}-{uuid_clean[20:]}"

                ibeacon_key = f"ibeacon:{uuid_clean}:{major}:{minor}"

                # Look up in presence coordinator data
                presence_coord = self.hass.data.get(DOMAIN, {}).get("presence_coordinator")
                if presence_coord and presence_coord.data:
                    # Try both cases
                    for try_key in (ibeacon_key, ibeacon_key.upper()):
                        obj = presence_coord.data.get(try_key)
                        if obj and obj.get("room"):
                            return obj["room"]

            # Fallback: check if the phone has a device_tracker with an area
            for entity in ent_reg.entities.values():
                if entity.device_id != device_id:
                    continue
                if entity.domain != "device_tracker":
                    continue
                state_obj = self.hass.states.get(entity.entity_id)
                if state_obj and state_obj.state not in ("unknown", "unavailable", "not_home"):
                    return state_obj.state

            return None
        except Exception as err:
            _LOGGER.debug("TagIntegration: get_phone_room failed: %s", err)
            return None
