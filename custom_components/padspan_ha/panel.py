# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Panel Registration
=================================
Registers exactly ONE HA sidebar panel (``padspan-ha``).  Internal navigation
between views (Overview, Follow, Maps, etc.) happens inside the panel's JS —
we do NOT register separate panels per view.

The panel's ``module_url`` includes ``BUILD_ID`` as a cache-buster so that
HACS reloads (without full HA restart) always serve the latest JS module.

Optionally registers a second "Lights" panel when ``lights_panel_enabled``
is set in settings.
"""


import inspect
import logging
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION, DATA_PANEL_REGISTERED, DATA_SETTINGS
from .build_info import ASSET_ID, BUILD_ID
from .licence import edition

_LOGGER = logging.getLogger(__name__)

STATIC_URL = "/padspan_ha_static"
ICON_STATIC_URL = "/padspan_ha_int"
WEB_COMPONENT        = "padspan-ha-app"
LIGHTS_WEB_COMPONENT = "padspan-lights-app"

async def _register_static(hass: HomeAssistant, static_dir: Path, url: str = STATIC_URL) -> None:
    try:
        from homeassistant.components.http import StaticPathConfig  # type: ignore
        await hass.http.async_register_static_paths(
            [StaticPathConfig(url, str(static_dir), False)]
        )
        return
    except Exception:
        pass

    try:
        await hass.http.async_register_static_path(url, str(static_dir), False)
        return
    except Exception:
        pass

    try:
        hass.http.register_static_path(url, str(static_dir), False)
    except Exception:
        _LOGGER.debug("Static register fallback failed (url=%s)", url)

def _remove_panels(hass: HomeAssistant) -> None:
    """Remove existing panel registrations so they can be refreshed."""
    try:
        from homeassistant.components.frontend import async_remove_panel  # type: ignore
        async_remove_panel(hass, "padspan-ha")
        async_remove_panel(hass, "padspan-lights")
    except Exception:
        pass


async def async_setup_panel(hass: HomeAssistant) -> None:
    hass.data.setdefault(DOMAIN, {})

    # Re-register panels whenever called (clear stale registrations first).
    # This ensures HACS reloads (without full restart) always get the new module_url/BUILD_ID.
    _remove_panels(hass)
    hass.data[DOMAIN][DATA_PANEL_REGISTERED] = False

    await _register_static(hass, Path(__file__).parent / "www")
    # Also serve the integration root so icon.png is accessible at /padspan_ha_int/icon.png
    await _register_static(hass, Path(__file__).parent, url=ICON_STATIC_URL)

    from homeassistant.components import panel_custom

    async def _register_panel(**kwargs: Any) -> None:
        ret = panel_custom.async_register_panel(**kwargs)
        if inspect.isawaitable(ret):
            await ret

    await _register_panel(
        hass=hass,
        webcomponent_name=WEB_COMPONENT,
        frontend_url_path="padspan-ha",
        sidebar_title="PadSpan HA",
        # Radar for the presence product, a lamp for the lighting one — the
        # only visible difference in a Bright build besides its name.
        sidebar_icon="mdi:radar" if edition() == "full" else "mdi:lightbulb-on-outline",
        require_admin=False,
        module_url=f"{STATIC_URL}/padspan-ha/panel.js?v={VERSION}&b={ASSET_ID}&cb=full",
        config={
            "title": "PadSpan HA",
            "icon": f"{STATIC_URL}/padspan-ha/assets/padspan-mark.svg",
            "logo": f"{STATIC_URL}/padspan-ha/assets/padspan-logo.svg",
            "version": VERSION,
        },
    )

    # Lights panel — only register if enabled in settings (default off)
    _lights_on = False
    try:
        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if _st and _st.data:
            _lights_on = bool(_st.data.get("lights_panel_enabled", False))
    except Exception:
        pass
    if _lights_on:
        await _register_panel(
            hass=hass,
            webcomponent_name=LIGHTS_WEB_COMPONENT,
            frontend_url_path="padspan-lights",
            sidebar_title="Lights",
            sidebar_icon="mdi:lightbulb-group",
            require_admin=False,
            module_url=f"{STATIC_URL}/padspan-ha/lights_panel.js?v={VERSION}&b={ASSET_ID}",
            config={
                "title": "Lights",
                "version": VERSION,
            },
        )

    hass.data[DOMAIN][DATA_PANEL_REGISTERED] = True
    _LOGGER.info("PadSpan HA panel registered v%s (build %s)", VERSION, BUILD_ID)
