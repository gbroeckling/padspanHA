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
    # Debug, not warning: a normal answer to the picker, every time it opens
    # (it was the only WARNING the opt-in report saw across the fleet).
    _LOGGER.debug(
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
    """Send a test notification exactly as a Follow alert is sent
    (presence_coordinator.async_send_follow_notify): to the chosen target
    only, auto-picked only when none is chosen, as alerts are. Its own send
    code fell back to auto-pick for any choice it did not recognise, so the
    Test passed for a renamed phone that alerts never reach, and never tried
    another integration's service (telegram_bot.send_message) that they use.
    """
    from .presence_coordinator import FollowNotifyNotSent, async_send_follow_notify  # noqa: PLC0415
    from .telemetry import bump  # noqa: PLC0415
    email = str(msg.get("email") or "").strip()
    chosen = str(msg.get("service") or "").strip()
    try:
        used = await async_send_follow_notify(
            hass, chosen, email, "PadSpan HA — Test Notification",
            "This is a test from PadSpan HA. If you see this, your notification pipeline is working correctly.",
            context=connection.context(msg),
        )
    except FollowNotifyNotSent as err:
        # The opt-in report (#151): a Test that failed, as alerts to it would.
        bump(hass, "follow_test_failed")
        if err.code == "no_notify":
            connection.send_error(
                msg["id"], "no_notify",
                "No notify services found in HA. You need to set up a notification "
                "integration first (e.g. SMTP email, Mobile App, Pushover). "
                "Go to HA Settings → Devices & Services → Add Integration → search for your notification provider."
            )
        elif err.code == "not_allowed":
            connection.send_error(
                msg["id"], "not_allowed",
                f"{chosen} is not a notification target: pick where to send from the list."
            )
        elif err.code == "not_found":
            connection.send_error(
                msg["id"], "not_found",
                f"{chosen} was not found in Home Assistant (renamed or removed?). "
                "Follow alerts to it are not sent either: pick where to send again."
            )
        else:
            connection.send_error(
                msg["id"], "send_failed",
                f"Send failed: {err}. "
                "Check HA Settings → Devices & Services for your notification provider's configuration."
            )
        return
    _LOGGER.info("PadSpan test notification sent via %s", used)
    bump(hass, "follow_test_sent")
    connection.send_result(msg["id"], {"ok": True, "service": used})
