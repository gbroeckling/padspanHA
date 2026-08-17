# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for HA Companion App phone discovery and follow.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_OBJECTS,
    DATA_COORDINATOR,
)
from .bluetooth_live import get_bluetooth_live
from .private_ble_resolver import PrivateBLEResolver, get_resolver as _get_ble_resolver
from .ws_common import _get_settings, _is_rpa_addr

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/companion_discover"})
@websocket_api.async_response
async def ws_companion_discover(hass: HomeAssistant, connection, msg) -> None:
    """Discover HA Companion App phones that have BLE Transmitter enabled.

    Returns a list of phones with their iBeacon UUID, visibility status,
    IRK availability, and whether they're already followed.  Disabled
    sensors are included so the UI can prompt the user to enable them.
    """
    try:
        from homeassistant.helpers import entity_registry as er

        ent_reg = er.async_get(hass)
        phones: list[dict[str, Any]] = []

        # Collect debug info about what mobile_app entities exist
        _debug_mobile_entities: list[str] = []
        _debug_ble_candidates: list[str] = []
        _debug_platforms: dict[str, int] = {}
        _debug_ble_any: list[str] = []  # BLE-related entities on ANY platform

        # Find all BLE transmitter sensor entities from mobile_app
        for entity in ent_reg.entities.values():
            # Track all platforms for debug
            _debug_platforms[entity.platform] = _debug_platforms.get(entity.platform, 0) + 1
            # Catch BLE-related entities on ANY platform
            _eid_lower = entity.entity_id.lower()
            if ("ble" in _eid_lower or "transmit" in _eid_lower or "beacon" in _eid_lower) and len(_debug_ble_any) < 20:
                _debug_ble_any.append(f"{entity.entity_id} (platform={entity.platform})")

            if entity.platform != "mobile_app":
                continue
            _debug_mobile_entities.append(entity.entity_id)
            eid = entity.entity_id
            if "ble_transmitter" not in eid:
                # Also check for BLE-related entities with different naming
                if "ble" in _eid_lower or "bluetooth" in _eid_lower or "transmit" in _eid_lower or "beacon" in _eid_lower:
                    _debug_ble_candidates.append(eid)
                continue

            # Read entity state — the state or attributes contain the transmitting UUID
            state_obj = hass.states.get(eid)
            is_disabled = entity.disabled_by is not None

            # Disabled entities have no state in HA.  Still show them in the
            # discovery list so the UI can prompt the user to enable them
            # (common on iOS where BLE Transmitter is disabled by default).
            if not state_obj and not is_disabled:
                continue

            attrs = (state_obj.attributes or {}) if state_obj else {}
            _LOGGER.debug(
                "companion_discover: %s state=%r disabled=%s attrs=%s",
                eid, state_obj.state if state_obj else "(no state)", is_disabled,
                {k: str(v)[:80] for k, v in attrs.items()},
            )

            # Companion App stores UUID, Major, Minor in separate attributes
            # or as a combined "transmitting_id" / "id" / the state itself.
            uuid_attr = ""
            major = 0
            minor = 0
            transmitting_id = ""

            # Try separate UUID / Major / Minor attributes first (most reliable)
            if attrs.get("UUID") or attrs.get("uuid"):
                uuid_attr = str(attrs.get("UUID") or attrs.get("uuid") or "")
                major = int(attrs.get("Major", attrs.get("major", 0)))
                minor = int(attrs.get("Minor", attrs.get("minor", 0)))
            else:
                # Fall back to combined transmitting_id / id attribute or state
                transmitting_id = (
                    attrs.get("transmitting_id")
                    or attrs.get("id")
                    or ""
                )
                # Also check if the state itself is a UUID-like string
                if not transmitting_id and state_obj and state_obj.state and len(state_obj.state) > 30:
                    transmitting_id = state_obj.state

                if transmitting_id:
                    # Parse UUID, Major, Minor from transmitting_id.
                    # Formats seen in the wild:
                    #   Dashes:      "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX-Major-Minor"
                    #   Underscores: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX_Major_Minor"
                    # A standard UUID is exactly 36 chars (8-4-4-4-12).
                    # If the string is longer, the suffix holds Major/Minor.
                    import re as _re
                    _tid = transmitting_id.strip()
                    if len(_tid) > 36:
                        _uuid_part = _tid[:36]
                        _suffix = _tid[36:]  # e.g. "_100_40004" or "-100-40004"
                        _nums = _re.findall(r"\d+", _suffix)
                        if len(_nums) >= 2:
                            try:
                                major = int(_nums[0])
                                minor = int(_nums[1])
                                uuid_attr = _uuid_part
                            except (ValueError, IndexError):
                                uuid_attr = _tid
                        elif len(_nums) == 1:
                            try:
                                major = int(_nums[0])
                                uuid_attr = _uuid_part
                            except (ValueError, IndexError):
                                uuid_attr = _tid
                        else:
                            uuid_attr = _tid
                    else:
                        uuid_attr = _tid

            # Disabled entities (common on iOS) — show in list so user can enable
            if is_disabled:
                device_name = ""
                if entity.device_id:
                    from homeassistant.helpers import device_registry as dr
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(entity.device_id)
                    if device:
                        device_name = device.name or device.name_by_user or ""
                if not device_name:
                    device_name = eid.replace("sensor.", "").replace("_ble_transmitter", "").replace("_", " ").title()
                phones.append({
                    "entity_id": eid,
                    "device_name": device_name,
                    "uuid": "",
                    "major": 0,
                    "minor": 0,
                    "ibeacon_key": "",
                    "transmitting_id": "",
                    "is_transmitting": False,
                    "is_visible": False,
                    "is_followed": False,
                    "is_disabled": True,
                    "existing_label": "",
                    "state": "disabled",
                    "attributes": {},
                    "has_irk": False,
                    "irk_canonical": "",
                })
                continue

            if not uuid_attr:
                _LOGGER.debug("companion_discover: %s — no UUID found, skipping", eid)
                continue

            # Normalise UUID to lowercase with dashes
            uuid_clean = uuid_attr.lower().strip().replace(" ", "")
            if len(uuid_clean) == 32:
                uuid_clean = f"{uuid_clean[:8]}-{uuid_clean[8:12]}-{uuid_clean[12:16]}-{uuid_clean[16:20]}-{uuid_clean[20:]}"

            # Get device name from the parent device
            device_name = ""
            if entity.device_id:
                from homeassistant.helpers import device_registry as dr
                dev_reg = dr.async_get(hass)
                device = dev_reg.async_get(entity.device_id)
                if device:
                    device_name = device.name or device.name_by_user or ""

            if not device_name:
                device_name = eid.replace("sensor.", "").replace("_ble_transmitter", "").replace("_", " ").title()

            # Build the iBeacon key that PadspanHA would use
            ibeacon_key = f"ibeacon:{uuid_clean}:{major}:{minor}"

            # Check if this phone is already labelled/followed
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            existing_label = ""
            if obj_store:
                entry = obj_store.get(ibeacon_key)
                if entry:
                    existing_label = entry.get("label", "")

            settings = _get_settings(hass)
            followed = settings.get("followed_addrs") or []
            is_followed = ibeacon_key in followed or ibeacon_key.upper() in [f.upper() for f in followed]

            # Check if the phone is currently visible in BLE.
            # Method 1: iBeacon advertisement matches UUID:major:minor.
            # Method 2: Any RPA resolves via IRK to a device matching this phone.
            is_visible = False
            has_irk = False
            irk_canonical = ""
            _vis_scanner_count = 0
            _vis_rssi = None
            try:
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=600)
                _irk_resolver = await _get_ble_resolver(hass)
                from .private_ble_resolver import PrivateBLEResolver

                # First check: does the resolver have an IRK device matching
                # this phone's name?  This works even without any live ads.
                for _dev in _irk_resolver._devices:
                    _dev_name = (_dev.get("name") or "").lower()
                    if device_name.lower() in _dev_name or _dev_name in device_name.lower():
                        has_irk = True
                        irk_canonical = _dev["canonical_id"]
                        break

                # Scan all BLE advertisements for this phone
                _irk_match_cid = irk_canonical  # canonical_id to match for IRK visibility
                for ad in (ble_snap.get("advertisements") or []):
                    ad_addr = (ad.get("address") or "").upper()
                    mfr = ad.get("manufacturer_data") or {}
                    parsed = PrivateBLEResolver.parse_ibeacon(mfr)
                    # iBeacon match
                    if parsed and parsed["uuid"].lower() == uuid_clean and parsed["major"] == major and parsed["minor"] == minor:
                        is_visible = True
                        # Also check IRK on this specific ad
                        if not has_irk and _is_rpa_addr(ad_addr):
                            _irk_res = _irk_resolver.resolve_address(ad_addr)
                            if _irk_res and _irk_res.get("canonical_id"):
                                has_irk = True
                                irk_canonical = _irk_res["canonical_id"]
                                _irk_match_cid = irk_canonical
                        continue
                    # IRK-only match: RPA resolves to the same canonical_id
                    if _irk_match_cid and _is_rpa_addr(ad_addr):
                        _irk_res = _irk_resolver.resolve_address(ad_addr)
                        if _irk_res and _irk_res.get("canonical_id") == _irk_match_cid:
                            is_visible = True
                            _rssi = ad.get("rssi")
                            if _rssi is not None and (_vis_rssi is None or _rssi > _vis_rssi):
                                _vis_rssi = _rssi
                            _vis_scanner_count += 1
            except Exception:
                pass

            phones.append({
                "entity_id": eid,
                "device_name": device_name,
                "uuid": uuid_clean,
                "major": major,
                "minor": minor,
                "ibeacon_key": ibeacon_key,
                "transmitting_id": transmitting_id,
                "is_transmitting": state_obj.state not in ("unavailable", "unknown", "off", ""),
                "is_visible": is_visible,
                "is_followed": is_followed,
                "is_disabled": False,
                "existing_label": existing_label,
                "state": state_obj.state,
                "attributes": {k: str(v) for k, v in attrs.items()},
                "has_irk": has_irk,
                "irk_canonical": irk_canonical,
            })

        # ── Device-registry fallback ──────────────────────────────────────
        # On Android, disabled sensors are never registered in the entity
        # registry.  The device registry always has the phone though.
        # Find mobile_app devices that have NO BLE transmitter entity and
        # surface them so the UI can tell the user to enable the sensor.
        _debug_devices: list[dict] = []
        _phones_entity_ids = {p["entity_id"] for p in phones}
        try:
            from homeassistant.helpers import device_registry as dr
            dev_reg = dr.async_get(hass)
            for entry in hass.config_entries.async_entries("mobile_app"):
                for device in dr.async_entries_for_config_entry(dev_reg, entry.entry_id):
                    device_name = device.name or device.name_by_user or ""
                    _debug_devices.append({
                        "device_id": device.id,
                        "name": device_name,
                        "model": device.model or "",
                        "manufacturer": device.manufacturer or "",
                    })
                    # Check if we already found a BLE transmitter entity for this device
                    has_ble = False
                    for p in phones:
                        if p.get("device_name", "").lower() == device_name.lower():
                            has_ble = True
                            break
                    if has_ble:
                        continue
                    # No BLE transmitter entity — phone is registered but sensor
                    # is not enabled.  Show it so the UI can prompt the user.
                    # Check if phone has IRK by name match
                    _fb_has_irk = False
                    _fb_irk_cid = ""
                    try:
                        _fb_resolver = await _get_ble_resolver(hass)
                        for _fb_dev in _fb_resolver._devices:
                            _fb_n = (_fb_dev.get("name") or "").lower()
                            if device_name.lower() in _fb_n or _fb_n in device_name.lower():
                                _fb_has_irk = True
                                _fb_irk_cid = _fb_dev["canonical_id"]
                                break
                    except Exception:
                        pass
                    phones.append({
                        "entity_id": "",
                        "device_name": device_name,
                        "uuid": "",
                        "major": 0,
                        "minor": 0,
                        "ibeacon_key": "",
                        "transmitting_id": "",
                        "is_transmitting": False,
                        "is_visible": False,
                        "is_followed": False,
                        "is_disabled": False,
                        "existing_label": "",
                        "state": "sensor_not_registered",
                        "attributes": {},
                        "device_id": device.id,
                        "model": device.model or "",
                        "manufacturer": device.manufacturer or "",
                        "has_irk": _fb_has_irk,
                        "irk_canonical": _fb_irk_cid,
                    })
        except Exception as e:
            _LOGGER.debug("companion_discover device-registry scan: %s", e)

        # ── Notify-service discovery ──────────────────────────────────────
        # notify.mobile_app_<name> services are ALWAYS created when the
        # Companion App registers, even if all sensors are disabled and
        # no entities exist.  This is the most reliable indicator.
        _debug_notify_services: list[str] = []
        _phones_names_lc = {p.get("device_name", "").lower() for p in phones}
        try:
            all_services = hass.services.async_services()
            notify_svcs = all_services.get("notify", {})
            for svc_name in notify_svcs:
                if svc_name.startswith("mobile_app_"):
                    _debug_notify_services.append(svc_name)
                    # Derive a human-readable device name
                    dev_slug = svc_name[len("mobile_app_"):]
                    dev_name = dev_slug.replace("_", " ").title()
                    if dev_name.lower() in _phones_names_lc:
                        continue  # already found via entity/device registry
                    # Try to find matching device in device registry
                    _dev_model = ""
                    _dev_manufacturer = ""
                    _dev_id = ""
                    try:
                        from homeassistant.helpers import device_registry as dr
                        dev_reg = dr.async_get(hass)
                        for device in dev_reg.devices.values():
                            dn = (device.name or "").lower().replace(" ", "_")
                            if dn == dev_slug or (device.name_by_user or "").lower().replace(" ", "_") == dev_slug:
                                dev_name = device.name or device.name_by_user or dev_name
                                _dev_model = device.model or ""
                                _dev_manufacturer = device.manufacturer or ""
                                _dev_id = device.id
                                break
                    except Exception:
                        pass
                    phones.append({
                        "entity_id": "",
                        "device_name": dev_name,
                        "uuid": "",
                        "major": 0,
                        "minor": 0,
                        "ibeacon_key": "",
                        "transmitting_id": "",
                        "is_transmitting": False,
                        "is_visible": False,
                        "is_followed": False,
                        "is_disabled": False,
                        "existing_label": "",
                        "state": "sensor_not_registered",
                        "attributes": {},
                        "device_id": _dev_id,
                        "model": _dev_model,
                        "manufacturer": _dev_manufacturer,
                        "found_via": "notify_service",
                        "has_irk": False,
                        "irk_canonical": "",
                    })
                    _phones_names_lc.add(dev_name.lower())
        except Exception as e:
            _LOGGER.debug("companion_discover notify scan: %s", e)

        # ── Device-tracker entity discovery ───────────────────────────────
        # device_tracker.* entities from mobile_app always exist even when
        # all sensors are disabled.  They track the phone's GPS location.
        _debug_device_trackers: list[str] = []
        try:
            for entity in ent_reg.entities.values():
                if entity.platform != "mobile_app":
                    continue
                if not entity.entity_id.startswith("device_tracker."):
                    continue
                _debug_device_trackers.append(entity.entity_id)
                # Derive device name from the entity
                dev_name = ""
                if entity.device_id:
                    from homeassistant.helpers import device_registry as dr
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(entity.device_id)
                    if device:
                        dev_name = device.name or device.name_by_user or ""
                if not dev_name:
                    dev_name = entity.entity_id.replace("device_tracker.", "").replace("_", " ").title()
                if dev_name.lower() in _phones_names_lc:
                    continue  # already found
                phones.append({
                    "entity_id": entity.entity_id,
                    "device_name": dev_name,
                    "uuid": "",
                    "major": 0,
                    "minor": 0,
                    "ibeacon_key": "",
                    "transmitting_id": "",
                    "is_transmitting": False,
                    "is_visible": False,
                    "is_followed": False,
                    "is_disabled": entity.disabled_by is not None,
                    "existing_label": "",
                    "state": "sensor_not_registered",
                    "attributes": {},
                    "device_id": entity.device_id or "",
                    "model": "",
                    "manufacturer": "",
                    "found_via": "device_tracker",
                    "has_irk": False,
                    "irk_canonical": "",
                })
                _phones_names_lc.add(dev_name.lower())
        except Exception as e:
            _LOGGER.debug("companion_discover device-tracker scan: %s", e)

        # ── Webhook / hass.data discovery ─────────────────────────────────
        # The mobile_app integration stores webhook registrations in
        # hass.data["mobile_app"].  This exists even with zero entities.
        _debug_webhooks: list[dict] = []
        try:
            mobile_data = hass.data.get("mobile_app")
            if mobile_data and isinstance(mobile_data, dict):
                # mobile_app stores registrations keyed by webhook_id
                for wh_key, wh_val in mobile_data.items():
                    if isinstance(wh_val, dict):
                        wh_name = wh_val.get("device_name") or wh_val.get("name") or ""
                        _debug_webhooks.append({
                            "webhook_id": str(wh_key)[:12],
                            "device_name": wh_name,
                            "os_name": wh_val.get("os_name", ""),
                            "os_version": wh_val.get("os_version", ""),
                            "app_version": wh_val.get("app_version", ""),
                            "model": wh_val.get("model", ""),
                            "manufacturer": wh_val.get("manufacturer", ""),
                        })
                        if wh_name and wh_name.lower() not in _phones_names_lc:
                            phones.append({
                                "entity_id": "",
                                "device_name": wh_name,
                                "uuid": "",
                                "major": 0,
                                "minor": 0,
                                "ibeacon_key": "",
                                "transmitting_id": "",
                                "is_transmitting": False,
                                "is_visible": False,
                                "is_followed": False,
                                "is_disabled": False,
                                "existing_label": "",
                                "state": "sensor_not_registered",
                                "attributes": {},
                                "device_id": "",
                                "model": wh_val.get("model", ""),
                                "manufacturer": wh_val.get("manufacturer", ""),
                                "found_via": "webhook",
                                "has_irk": False,
                                "irk_canonical": "",
                            })
                            _phones_names_lc.add(wh_name.lower())
            # Also try the mobile_app "registrations" storage key
            mobile_reg = hass.data.get("mobile_app_registrations")
            if mobile_reg and isinstance(mobile_reg, dict):
                for rk, rv in mobile_reg.items():
                    if isinstance(rv, dict):
                        _debug_webhooks.append({
                            "reg_key": str(rk)[:12],
                            "device_name": rv.get("device_name", ""),
                            "os_name": rv.get("os_name", ""),
                        })
        except Exception as e:
            _LOGGER.debug("companion_discover webhook scan: %s", e)

        # Sort platforms by count descending, top 20
        _sorted_plats = dict(sorted(_debug_platforms.items(), key=lambda x: -x[1])[:20])

        # Check if mobile_app integration is actually loaded in HA
        _mobile_app_loaded = "mobile_app" in hass.config.components
        _mobile_app_entries = len(hass.config_entries.async_entries("mobile_app"))

        # ── Broad device search ───────────────────────────────────────────
        # If no phones found via mobile_app, look for phone-like devices
        # across ALL integrations (the phone might be registered differently).
        _debug_all_phone_devices: list[dict] = []
        _debug_all_config_entries: list[dict] = []
        if not phones:
            try:
                from homeassistant.helpers import device_registry as dr
                dev_reg = dr.async_get(hass)

                # Log all config entries so we can see what integrations exist
                for ce in hass.config_entries.async_entries():
                    _debug_all_config_entries.append({
                        "domain": ce.domain,
                        "title": ce.title,
                        "entry_id": ce.entry_id[:8],
                    })

                # Search ALL devices for phone-like entries
                _phone_hints = {"phone", "mobile", "android", "iphone", "pixel",
                                "samsung", "galaxy", "oneplus", "xiaomi", "huawei",
                                "companion", "app"}
                for device in dev_reg.devices.values():
                    name_lower = ((device.name or "") + " " + (device.name_by_user or "") +
                                  " " + (device.model or "") + " " + (device.manufacturer or "")).lower()
                    if any(h in name_lower for h in _phone_hints):
                        # Find which config entry this device belongs to
                        domains = []
                        for ce_id in (device.config_entries or set()):
                            ce = hass.config_entries.async_get_entry(ce_id)
                            if ce:
                                domains.append(ce.domain)
                        _debug_all_phone_devices.append({
                            "device_id": device.id,
                            "name": device.name or "",
                            "name_by_user": device.name_by_user or "",
                            "model": device.model or "",
                            "manufacturer": device.manufacturer or "",
                            "integrations": domains,
                            "identifiers": [list(i) for i in (device.identifiers or set())],
                        })
            except Exception as e:
                _LOGGER.debug("companion_discover broad device scan: %s", e)

        # ── iBeacon scan from live BLE ────────────────────────────────────
        # If still no phones, show any iBeacons visible in BLE as
        # potential companion app phones (user can identify theirs).
        _debug_live_ibeacons: list[dict] = []
        if not phones:
            try:
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=120)
                from .private_ble_resolver import PrivateBLEResolver
                for ad in (ble_snap.get("advertisements") or []):
                    mfr = ad.get("manufacturer_data") or {}
                    parsed = PrivateBLEResolver.parse_ibeacon(mfr)
                    if parsed:
                        ib_key = f"ibeacon:{parsed['uuid']}:{parsed['major']}:{parsed['minor']}"
                        _debug_live_ibeacons.append({
                            "address": ad.get("address", ""),
                            "rssi": ad.get("rssi"),
                            "uuid": parsed["uuid"],
                            "major": parsed["major"],
                            "minor": parsed["minor"],
                            "ibeacon_key": ib_key,
                            "name": ad.get("name", ""),
                        })
            except Exception as e:
                _LOGGER.debug("companion_discover iBeacon scan: %s", e)

        connection.send_result(msg["id"], {
            "phones": phones,
            "mobile_app_loaded": _mobile_app_loaded,
            "mobile_app_entries": _mobile_app_entries,
            "debug": {
                "mobile_app_entities": _debug_mobile_entities[:50],
                "ble_candidates": _debug_ble_candidates[:20],
                "total_entities": len(list(ent_reg.entities.values())),
                "platforms": _sorted_plats,
                "ble_any_platform": _debug_ble_any,
                "mobile_app_devices": _debug_devices,
                "notify_services": _debug_notify_services,
                "device_trackers": _debug_device_trackers,
                "webhooks": _debug_webhooks,
                "all_phone_devices": _debug_all_phone_devices[:20],
                "all_config_entries": _debug_all_config_entries,
                "live_ibeacons": _debug_live_ibeacons[:20],
            },
        })
    except Exception as err:
        _LOGGER.warning("companion_discover failed: %s", err)
        connection.send_result(msg["id"], {"phones": [], "error": str(err)})


@websocket_api.websocket_command({
    "type": "padspan_ha/companion_follow",
    vol.Required("ibeacon_key"): str,
    vol.Required("device_name"): str,
    vol.Optional("entity_id"): str,
})
@websocket_api.async_response
async def ws_companion_follow(hass: HomeAssistant, connection, msg) -> None:
    """One-click "Follow This Phone" action for Companion App phones.

    Performs four steps atomically:
      1. Labels the iBeacon object in ObjectStore (+ cross-stores under canonical_id)
      2. Adds the uppercase iBeacon key to followed_addrs in settings
      3. Enables the BLE Transmitter sensor in the entity registry (un-disables)
      4. Sends a command_ble_transmitter turn_on notification to the phone app

    Returns verification flags so the UI can confirm each step succeeded.
    """
    try:
        ibeacon_key = str(msg["ibeacon_key"])
        follow_key = ibeacon_key.upper()  # followed_addrs are always uppercase
        device_name = str(msg["device_name"]).strip()
        transmitter_eid = str(msg.get("entity_id") or "").strip()

        if not device_name:
            device_name = "Phone"

        results: list[str] = []
        labelled = False
        followed = False
        transmitter_enabled = False

        # 1) Label the object in ObjectStore (tagged)
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if obj_store:
            await obj_store.async_set(ibeacon_key, device_name)
            # Also label the uppercase variant so lookups always match
            await obj_store.async_set(follow_key, device_name)

            # If this phone also resolves via IRK (private_ble), store the label
            # under the canonical_id too — otherwise the private_ble object won't
            # find it (private_ble looks up by canonical_id, not ibeacon key).
            try:
                resolver = await _get_ble_resolver(hass)
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=600)
                for ad in (ble_snap.get("advertisements") or []):
                    ib = resolver.parse_ibeacon(ad.get("manufacturer_data") or {})
                    if not ib:
                        continue
                    ad_ib_key = f"ibeacon:{ib['uuid']}:{ib['major']}:{ib['minor']}"
                    if ad_ib_key.upper() != follow_key:
                        continue
                    ad_addr = (ad.get("address") or "").upper()
                    resolved = resolver.resolve_address(ad_addr)
                    if resolved and resolved.get("canonical_id"):
                        cid = resolved["canonical_id"]
                        await obj_store.async_set(cid, device_name)
                        _LOGGER.info(
                            "companion_follow: also labelled canonical_id %s for %s",
                            cid, device_name,
                        )
                    break
            except Exception as _cid_err:
                _LOGGER.debug("companion_follow: canonical_id cross-label: %s", _cid_err)

            labelled = True
            results.append(f"Labelled as '{device_name}'")

        # 2) Add to followed_addrs in settings (always uppercase)
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            followed_list = list(st.data.get("followed_addrs") or [])
            existing_upper = {f.upper() for f in followed_list}
            if follow_key not in existing_upper:
                followed_list.append(follow_key)
                await st.async_set(followed_addrs=followed_list)
                followed = True
                results.append("Added to followed list")
            else:
                followed = True
                results.append("Already followed")

        # 3) Enable BLE Transmitter: entity registry + notify command to app.
        if transmitter_eid:
            # 3a) Enable in entity registry (un-disable if disabled)
            try:
                from homeassistant.helpers import entity_registry as er

                ent_reg = er.async_get(hass)
                ent_entry = ent_reg.async_get(transmitter_eid)
                if ent_entry and ent_entry.disabled_by is not None:
                    ent_reg.async_update_entity(
                        transmitter_eid, disabled_by=None
                    )
                    transmitter_enabled = True
                    results.append("BLE Transmitter entity enabled")
            except Exception as te:
                _LOGGER.debug("Entity registry enable for %s: %s", transmitter_eid, te)

            # 3b) Send notification command to Companion App to turn on the
            #     BLE transmitter sensor.  The Companion App (Android + iOS)
            #     supports command_ble_transmitter via the notify service.
            try:
                from homeassistant.helpers import entity_registry as er, device_registry as dr

                ent_reg = er.async_get(hass)
                ent_entry = ent_reg.async_get(transmitter_eid)
                if ent_entry and ent_entry.device_id:
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(ent_entry.device_id)
                    if device:
                        # Find the notify service for this mobile_app device.
                        # Convention: notify.mobile_app_<device_name_slug>
                        notify_target = None
                        for ident in device.identifiers:
                            if ident[0] == "mobile_app":
                                notify_target = f"mobile_app_{ident[1]}"
                                break
                        if not notify_target:
                            # Fallback: derive from device name
                            dname = (device.name or "").lower().replace(" ", "_").replace("-", "_")
                            if dname:
                                notify_target = f"mobile_app_{dname}"
                        if notify_target:
                            await hass.services.async_call(
                                "notify",
                                notify_target,
                                {
                                    "message": "command_ble_transmitter",
                                    "data": {"command": "turn_on"},
                                },
                                blocking=True,
                            )
                            transmitter_enabled = True
                            results.append("BLE Transmitter command sent to phone")
                            _LOGGER.info(
                                "Sent command_ble_transmitter turn_on via notify.%s",
                                notify_target,
                            )
            except Exception as te:
                _LOGGER.warning(
                    "Failed to send BLE Transmitter command for %s: %s",
                    transmitter_eid,
                    te,
                )
                results.append(f"BLE command send failed: {te}")

        # 4) Verify: re-read to confirm persistence
        verify_label = ""
        verify_followed = False
        if obj_store:
            entry = obj_store.get(ibeacon_key) or obj_store.get(follow_key)
            verify_label = (entry or {}).get("label", "")
        if st:
            verify_followed = follow_key in {f.upper() for f in (st.data.get("followed_addrs") or [])}

        connection.send_result(msg["id"], {
            "ok": True,
            "ibeacon_key": ibeacon_key,
            "follow_key": follow_key,
            "device_name": device_name,
            "labelled": labelled,
            "followed": followed,
            "transmitter_enabled": transmitter_enabled,
            "verified_label": verify_label,
            "verified_followed": verify_followed,
            "actions": results,
        })
    except Exception as err:
        _LOGGER.warning("companion_follow failed: %s", err)
        connection.send_error(msg["id"], "follow_failed", str(err))


@websocket_api.websocket_command({
    "type": "padspan_ha/companion_unfollow",
    vol.Required("ibeacon_key"): str,
})
@websocket_api.async_response
async def ws_companion_unfollow(hass: HomeAssistant, connection, msg) -> None:
    """Remove a Companion App phone from followed list and delete its label."""
    try:
        ibeacon_key = str(msg["ibeacon_key"])
        follow_key = ibeacon_key.upper()
        results: list[str] = []

        # 1) Remove label from ObjectStore
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if obj_store:
            await obj_store.async_delete(ibeacon_key)
            await obj_store.async_delete(follow_key)
            results.append("Label removed")

        # 2) Remove from followed_addrs
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            followed_list = list(st.data.get("followed_addrs") or [])
            new_list = [f for f in followed_list if f.upper() != follow_key]
            if len(new_list) < len(followed_list):
                await st.async_set(followed_addrs=new_list)
                results.append("Removed from followed list")

        # 3) Clear coordinator state so object doesn't linger as stale
        try:
            _coord_uf = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
            if _coord_uf:
                _coord_uf.clear_object_state(ibeacon_key)
        except Exception:
            pass

        connection.send_result(msg["id"], {
            "ok": True,
            "ibeacon_key": ibeacon_key,
            "actions": results,
        })
    except Exception as err:
        _LOGGER.warning("companion_unfollow failed: %s", err)
        connection.send_error(msg["id"], "unfollow_failed", str(err))
