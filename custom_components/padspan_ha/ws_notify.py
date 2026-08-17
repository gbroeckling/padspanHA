# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for notification service discovery and test.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/notify_services_list"})
@websocket_api.async_response
async def ws_notify_services_list(hass: HomeAssistant, connection, msg) -> None:
    """Discover all available HA notification services/entities.

    WHY so many methods: HA's notify landscape is fragmented across versions.
    Legacy YAML services, entity-based platform (2024+), entity registry entries,
    entity platforms, and cross-domain services all need checking to reliably
    find every notification target.  The UI uses this to populate the alert
    service picker dropdown.
    """
    result_set: set[str] = set()

    # ── Method 1: hass.services — legacy YAML-configured services ────────
    # async_services() returns {domain: {service_name: ...}}
    # For YAML notify: name "Foo" → service "notify.foo" (lowered, spaces→_)
    try:
        all_svc = hass.services.async_services()
        notify_svc = all_svc.get("notify", {})
        for svc_name in notify_svc:
            if svc_name == "send_message":
                continue  # generic dispatcher, not a target
            # Legacy services are called as notify.{svc_name}
            result_set.add(f"notify.{svc_name}")
        _LOGGER.debug("notify discovery method1 (services): %s", list(notify_svc.keys()))
    except Exception as exc:
        _LOGGER.warning("notify discovery method1 failed: %s", exc)

    # ── Method 2: hass.services.async_services_for_domain (HA 2024.4+) ───
    try:
        if hasattr(hass.services, "async_services_for_domain"):
            domain_svc = hass.services.async_services_for_domain("notify")
            for svc_name in domain_svc:
                if svc_name != "send_message":
                    result_set.add(f"notify.{svc_name}")
            _LOGGER.debug("notify discovery method2 (for_domain): %s", list(domain_svc.keys()))
    except Exception as exc:
        _LOGGER.warning("notify discovery method2 failed: %s", exc)

    # ── Method 3: notify entities from state machine ─────────────────────
    try:
        for state in hass.states.async_all("notify"):
            result_set.add(state.entity_id)
        _LOGGER.debug("notify discovery method3 (states): %s",
                       [s.entity_id for s in hass.states.async_all("notify")])
    except Exception as exc:
        _LOGGER.warning("notify discovery method3 failed: %s", exc)

    # ── Method 4: entity registry (catches entities without state) ───────
    try:
        from homeassistant.helpers import entity_registry as er
        ent_reg = er.async_get(hass)
        for entry in ent_reg.entities.values():
            if entry.domain == "notify" and not entry.disabled_by:
                result_set.add(entry.entity_id)
    except Exception as exc:
        _LOGGER.warning("notify discovery method4 failed: %s", exc)

    # ── Method 5: entity platforms ───────────────────────────────────────
    try:
        from homeassistant.helpers import entity_platform
        for platform in entity_platform.async_get_platforms(hass, "notify"):
            for entity in platform.entities.values():
                if hasattr(entity, "entity_id"):
                    result_set.add(entity.entity_id)
    except Exception as exc:
        _LOGGER.warning("notify discovery method5 failed: %s", exc)

    # ── Method 6: scan ALL services for notify-like domains ──────────────
    # Some integrations register under their own domain with send_message
    try:
        all_svc = hass.services.async_services()
        for domain, svcs in all_svc.items():
            if domain == "notify":
                continue
            # Look for domains that have a "send_message" or "notify" service
            if "send_message" in svcs or "notify" in svcs:
                result_set.add(f"{domain}.send_message")
    except Exception as exc:
        _LOGGER.warning("notify discovery method6 failed: %s", exc)

    has_send_message = False
    try:
        has_send_message = "send_message" in hass.services.async_services().get("notify", {})
    except Exception:
        pass

    result = sorted(result_set)
    _LOGGER.warning(
        "notify_services_list result: %s (has_send_message=%s)",
        result, has_send_message,
    )
    connection.send_result(msg["id"], {
        "services": result,
        "has_send_message": has_send_message,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/notify_test",
        vol.Optional("email"): str,
        vol.Optional("service"): str,
    }
)
@websocket_api.async_response
async def ws_notify_test(hass: HomeAssistant, connection, msg) -> None:
    """Send a test notification via HA notify to verify the pipeline works.

    Supports both legacy notify.{name} services and the newer HA 2024+
    entity-based notify platform (notify.send_message + entity_id).
    """
    email = str(msg.get("email") or "").strip()
    chosen = str(msg.get("service") or "").strip()
    services = hass.services.async_services().get("notify", {})
    has_send_message = "send_message" in services
    # Gather all notify entities (new platform)
    entity_ids = [s.entity_id for s in hass.states.async_all("notify")]
    legacy = [k for k in services if k != "send_message"]

    if not services and not entity_ids:
        connection.send_error(
            msg["id"], "no_notify",
            "No notify services found in HA. You need to set up a notification "
            "integration first (e.g. SMTP email, Mobile App, Pushover). "
            "Go to HA Settings → Devices & Services → Add Integration → search for your notification provider."
        )
        return

    base_data: dict[str, Any] = {
        "title": "PadSpan HA — Test Notification",
        "message": "This is a test from PadSpan HA. If you see this, your notification pipeline is working correctly.",
    }

    # Determine if the chosen value is an entity_id (e.g. "notify.smtp")
    is_entity = chosen.startswith("notify.")
    attempts: list[tuple[str, str, dict[str, Any]]] = []  # (description, svc_name, payload)

    if is_entity and has_send_message:
        # New HA platform: use notify.send_message with entity_id targeting
        payload_eid = {**base_data, "entity_id": chosen}
        if email:
            attempts.append(("send_message+entity+target", "send_message", {**payload_eid, "target": email}))
            attempts.append(("send_message+entity+data.target", "send_message", {**payload_eid, "data": {"target": email}}))
        attempts.append(("send_message+entity", "send_message", payload_eid))
        # Also try legacy call with the slug (e.g. notify.smtp → service "smtp")
        slug = chosen.split(".", 1)[1] if "." in chosen else chosen
        if slug in services:
            if email:
                attempts.append(("legacy+target", slug, {**base_data, "target": email}))
            attempts.append(("legacy", slug, base_data))
    elif chosen and chosen in services:
        # Legacy service chosen directly
        if email:
            attempts.append(("legacy+target", chosen, {**base_data, "target": email}))
            attempts.append(("legacy+data.target", chosen, {**base_data, "data": {"target": email}}))
        attempts.append(("legacy", chosen, base_data))
    else:
        # Nothing chosen or invalid — auto-pick
        # Prefer entity_ids with mail/smtp, then legacy with mail/smtp, then first available
        pick_entity = None
        pick_legacy = None
        for eid in entity_ids:
            if "mail" in eid.lower() or "smtp" in eid.lower():
                pick_entity = eid
                break
        for svc in legacy:
            if "mail" in svc.lower() or "smtp" in svc.lower():
                pick_legacy = svc
                break
        if pick_entity and has_send_message:
            payload_eid = {**base_data, "entity_id": pick_entity}
            if email:
                attempts.append(("auto-entity+target", "send_message", {**payload_eid, "target": email}))
            attempts.append(("auto-entity", "send_message", payload_eid))
        if pick_legacy:
            if email:
                attempts.append(("auto-legacy+target", pick_legacy, {**base_data, "target": email}))
            attempts.append(("auto-legacy", pick_legacy, base_data))
        # Last resort: first entity or first legacy
        if not attempts:
            if entity_ids and has_send_message:
                eid = entity_ids[0]
                attempts.append(("fallback-entity", "send_message", {**base_data, "entity_id": eid}))
            elif legacy:
                attempts.append(("fallback-legacy", legacy[0], base_data))

    if not attempts:
        connection.send_error(
            msg["id"], "no_notify",
            "Could not find a usable notify service or entity. "
            "Go to HA Settings → Devices & Services → Add Integration → add a notification provider."
        )
        return

    last_err = None
    for desc, svc_name, payload in attempts:
        try:
            await hass.services.async_call("notify", svc_name, payload)
            used = svc_name if svc_name != "send_message" else payload.get("entity_id", svc_name)
            _LOGGER.info("PadSpan test notification sent via notify.%s (%s)", used, desc)
            connection.send_result(msg["id"], {
                "ok": True, "service": used,
                "available_services": sorted(set(entity_ids + legacy)),
            })
            return
        except Exception as err:
            last_err = err
            _LOGGER.debug("PadSpan test notify (%s) failed: %s", desc, err)
            continue

    detail = str(last_err) if last_err else "Unknown error"
    all_avail = sorted(set(entity_ids + legacy))
    connection.send_error(
        msg["id"], "send_failed",
        f"All send attempts failed: {detail}. "
        f"Available: {', '.join(all_avail) or 'none'}. "
        "Check HA Settings → Devices & Services for your notification provider's configuration."
    )
