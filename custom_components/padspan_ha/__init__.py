# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Integration Entry Point
======================================
Initialises persistent stores, registers the websocket API, and registers a
single HA sidebar panel (internal view navigation happens inside the panel JS).

Startup order:
  1. ``async_setup`` — called once per HA boot (before any config entry).
     Creates stores, registers WS commands, registers the sidebar panel,
     and starts the Bluetooth live feed.
  2. ``async_setup_entry`` — called per config entry (one per install).
     Creates the PadSpanCoordinator, starts PresenceCoordinator (BLE polling),
     and forwards sensor/binary_sensor/device_tracker platforms.
  3. ``async_unload_entry`` — teardown: stops coordinator, flushes stores.
"""

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .build_info import BUILD_ID, BUILD_VERSION
from .const import (
    DOMAIN,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DATA_OBJECTS,
    DATA_ALERTS,
    DATA_MOVEMENT,
    DATA_ADAPTIVE,
    DATA_CALIBRATION,
    DATA_TRACEBACK,
    DATA_TAG_INTEGRATION,
    DATA_PANEL_REGISTERED,
    DATA_DEVICE_REGISTRY,
)
from .adaptive_store import AdaptiveStore
from .device_registry import DeviceRegistry
from .coordinator import PadSpanCoordinator
from .maps_store import MapsStore
from .model_store import ModelStore
from .alert_store import AlertStore
from .movement_store import MovementStore
from .object_store import ObjectStore
from .panel import async_setup_panel
from .presence_coordinator import PresenceCoordinator
from .settings_store import SettingsStore
from .websocket import async_register_websockets

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[str] = ["sensor", "binary_sensor", "device_tracker"]

SERVICE_SET_MAP = "set_room_tag_map"
SERVICE_SCHEMA = vol.Schema({vol.Required("room_tag_map"): dict})


async def _ensure_stores(hass: HomeAssistant, *, critical_only: bool = False) -> None:
    """Create/load persistent stores exactly once per HA runtime.

    Two tiers:
      critical (settings, maps, model) — needed for entity setup; always blocking.
      deferred (objects, alerts, movement, adaptive, calibration, traceback, tag)
        — used by the panel/websocket API but not needed for entities to register.
        When critical_only=True these are skipped and should be loaded via
        _ensure_deferred_stores() in the background.
    """
    import asyncio

    hass.data.setdefault(DOMAIN, {})

    # ── Store factory helpers ────────────────────────────────────────────────
    # Each factory returns (DATA_KEY, store_instance, debug_msg).

    async def _init_settings():
        st = SettingsStore(hass)
        await st.async_load()
        return (DATA_SETTINGS, st, "SettingsStore ready")

    async def _init_maps():
        ms = MapsStore(hass)
        await ms.async_setup()
        return (DATA_MAPS, ms, f"MapsStore ready ({ms.maps_dir})")

    async def _init_model():
        mdl = ModelStore(hass)
        await mdl.async_setup()
        # Phase 1: auto-sync fabric from HA registries on startup
        if mdl.sync_mode() == "auto":
            try:
                await mdl.async_sync_from_ha()
            except Exception as err:
                _LOGGER.debug("Fabric HA sync on startup skipped: %s", err)
        _sc = len(mdl.data.get("scanners", {}))
        _sp = len(mdl.data.get("scanner_positions_m", {}))
        return (DATA_MODEL, mdl, f"ModelStore ready ({len(mdl.floors())} floors, {len(mdl.room_meta())} rooms, {_sc} scanners, {_sp} positions_m)")

    async def _init_objects():
        obj_store = ObjectStore(hass)
        await obj_store.async_load()
        return (DATA_OBJECTS, obj_store, f"ObjectStore ready ({len(obj_store.all())} labels)")

    async def _init_alerts():
        alert_store = AlertStore(hass)
        await alert_store.async_load()
        return (DATA_ALERTS, alert_store, f"AlertStore ready ({len(alert_store.all())} configs)")

    async def _init_movement():
        mv_store = MovementStore(hass)
        await mv_store.async_load()
        return (DATA_MOVEMENT, mv_store, f"MovementStore ready ({len(mv_store.entries)} entries)")

    async def _init_adaptive():
        ad_store = AdaptiveStore(hass)
        await ad_store.async_load()
        obs = ad_store.data.get("stats", {}).get("total_observations", 0)
        return (DATA_ADAPTIVE, ad_store, f"AdaptiveStore ready ({obs} observations)")

    async def _init_calibration():
        from .calibration_store import CalibrationStore
        cal_store = CalibrationStore(hass)
        # Phase 3: wire ModelStore for metre conversions
        _mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        if _mdl:
            cal_store.set_model_store(_mdl)
        # Load data but defer RF training to background
        await cal_store.async_setup_fast()
        _pt_count = len(cal_store.data.get("points", []))
        return (DATA_CALIBRATION, cal_store, f"CalibrationStore ready ({_pt_count} points)")

    async def _init_traceback():
        from .traceback_store import TracebackStore
        tb_store = TracebackStore(hass)
        await tb_store.async_load()
        return (DATA_TRACEBACK, tb_store, f"TracebackStore ready ({len(tb_store.frames)} frames)")

    async def _init_device_registry():
        dev_reg = DeviceRegistry(hass)
        await dev_reg.async_load()
        # One-time migration from ObjectStore if device registry is empty
        # Backfill migration: import any ObjectStore labels not yet in DeviceRegistry
        # Runs every startup (idempotent — skips already-known keys)
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if obj_store and obj_store.all():
            stats = await dev_reg.async_migrate_from_object_store(obj_store)
            if stats["migrated"] or stats["merged"]:
                _LOGGER.info(
                    "DeviceRegistry migration: %d devices, %d merged, %d skipped",
                    stats["migrated"], stats["merged"], stats["skipped"],
                )
        return (DATA_DEVICE_REGISTRY, dev_reg, f"DeviceRegistry ready ({dev_reg.device_count()} devices)")

    async def _init_tag():
        from .tag_integration import TagIntegration
        tag_int = TagIntegration(hass)
        await tag_int.async_setup()
        return (DATA_TAG_INTEGRATION, tag_int, "TagIntegration ready")

    # ── Critical stores (block startup) ──────────────────────────────────────
    critical = []
    if DATA_SETTINGS not in hass.data[DOMAIN]:
        critical.append(_init_settings())
    if DATA_MAPS not in hass.data[DOMAIN]:
        critical.append(_init_maps())
    if DATA_MODEL not in hass.data[DOMAIN]:
        critical.append(_init_model())

    if critical:
        results = await asyncio.gather(*critical)
        for data_key, store, msg in results:
            hass.data[DOMAIN][data_key] = store
            _LOGGER.debug(msg)

    if critical_only:
        return

    # ── Deferred stores (panel/API features) ─────────────────────────────────
    deferred = []
    if DATA_OBJECTS not in hass.data[DOMAIN]:
        deferred.append(_init_objects())
    if DATA_ALERTS not in hass.data[DOMAIN]:
        deferred.append(_init_alerts())
    if DATA_MOVEMENT not in hass.data[DOMAIN]:
        deferred.append(_init_movement())
    if DATA_ADAPTIVE not in hass.data[DOMAIN]:
        deferred.append(_init_adaptive())
    if DATA_CALIBRATION not in hass.data[DOMAIN]:
        deferred.append(_init_calibration())
    if DATA_TRACEBACK not in hass.data[DOMAIN]:
        deferred.append(_init_traceback())
    if DATA_TAG_INTEGRATION not in hass.data[DOMAIN]:
        deferred.append(_init_tag())

    if deferred:
        results = await asyncio.gather(*deferred)
        for data_key, store, msg in results:
            hass.data[DOMAIN][data_key] = store
            _LOGGER.debug(msg)

    # DeviceRegistry must initialise AFTER the gather results are stored:
    # its ObjectStore→DeviceRegistry migration reads hass.data[DATA_OBJECTS],
    # which is only populated once the batch above completes.
    if DATA_DEVICE_REGISTRY not in hass.data[DOMAIN]:
        data_key, store, msg = await _init_device_registry()
        hass.data[DOMAIN][data_key] = store
        _LOGGER.debug(msg)

    # Kick off deferred RF training in background (non-blocking)
    cal = hass.data[DOMAIN].get(DATA_CALIBRATION)
    if cal and not cal.rf_trained and len(cal.data.get("points", [])) >= 4:
        hass.async_create_task(cal._async_train_rf())


async def _ensure_deferred_stores(hass: HomeAssistant) -> None:
    """Load non-critical stores in background. Safe to call multiple times."""
    try:
        await _ensure_stores(hass, critical_only=False)
    except Exception as err:
        _LOGGER.warning("Deferred store init error: %s", err)


async def _async_start_live_feeds(hass: HomeAssistant) -> None:
    """Start the live BLE feeds (bluetooth_live, TagIntegration, ESPresense MQTT).

    Idempotent. Called from async_setup's _background_init on first boot and
    from async_setup_entry after a config-entry reload (async_unload_entry
    tears the feeds down; without this they would stay dead until HA restart).
    The lock guards against double-creation if both paths run concurrently.
    """
    import asyncio

    dom = hass.data.setdefault(DOMAIN, {})
    lock = dom.setdefault("_live_feeds_lock", asyncio.Lock())
    async with lock:
        try:
            from .bluetooth_live import async_setup_bluetooth_live, get_bluetooth_live
            if get_bluetooth_live(hass) is None:
                await async_setup_bluetooth_live(hass)
        except Exception as err:
            _LOGGER.debug("Bluetooth live setup skipped: %s", err)

        try:
            if DATA_TAG_INTEGRATION not in dom:
                from .tag_integration import TagIntegration
                tag_int = TagIntegration(hass)
                await tag_int.async_setup()
                dom[DATA_TAG_INTEGRATION] = tag_int
                _LOGGER.debug("TagIntegration ready")
        except Exception as err:
            _LOGGER.debug("Tag integration setup skipped: %s", err)

        # ESPresense MQTT ingestion (off by default)
        try:
            from .const import DATA_ESPRESENSE_MQTT
            _st = dom.get(DATA_SETTINGS)
            if (
                _st
                and _st.data.get("espresense_mqtt_enabled")
                and DATA_ESPRESENSE_MQTT not in dom
            ):
                from .espresense_mqtt import async_setup_espresense_mqtt
                _prefix = _st.data.get("espresense_topic_prefix", "espresense")
                await async_setup_espresense_mqtt(hass, _prefix)
                _LOGGER.info("ESPresense MQTT ingestion started (prefix: %s)", _prefix)
        except Exception as err:
            _LOGGER.debug("ESPresense MQTT setup skipped: %s", err)


CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """One-time HA boot setup: stores → websockets → panel → BLE feed → services."""
    hass.data.setdefault(DOMAIN, {})

    _LOGGER.info("PadSpan HA starting v%s (build %s)", BUILD_VERSION, BUILD_ID)

    # Critical stores only (settings, maps, model) — enough for entities
    try:
        await _ensure_stores(hass, critical_only=True)
    except Exception as err:  # defensive: do not break HA startup
        _LOGGER.exception("Store init failed: %s", err)

    # Websockets for the panel (must be registered even if entry isn't created yet)
    try:
        async_register_websockets(hass)
    except Exception as err:
        _LOGGER.exception("Websocket registration failed: %s", err)

    # Panel (single sidebar entry)
    try:
        await async_setup_panel(hass)
    except Exception as err:
        _LOGGER.exception("Panel registration failed: %s", err)

    # Deferred stores + Bluetooth live — loaded in background so async_setup
    # returns fast and HA can proceed to config entry setup immediately.
    async def _background_init():
        try:
            await _ensure_deferred_stores(hass)
        except Exception as err:
            _LOGGER.debug("Deferred store init error: %s", err)

        # Phase 2: auto-derive map transforms + migrate spatial data to metres
        try:
            mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
            ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
            if mdl and ms and not mdl.has_spatial_model():
                # Derive default_floor_width from existing transforms if available
                _existing_t = mdl.data.get("map_transforms") or {}
                _default_w = 0.0
                for _t in _existing_t.values():
                    _sw = _t.get("scale_x_m", 0)
                    if _sw and float(_sw) > _default_w:
                        _default_w = float(_sw)
                n_transforms = await mdl.async_derive_transforms(ms, default_floor_width_m=_default_w)
                if n_transforms:
                    stats = await mdl.async_migrate_from_maps(ms)
                    _LOGGER.info(
                        "Phase 2 migration: %d transforms, %d scanner positions, "
                        "%d room geometries, %d barriers converted to metres",
                        n_transforms, stats["scanners_migrated"],
                        stats["rooms_migrated"], stats["barriers_migrated"],
                    )
        except Exception as err:
            _LOGGER.debug("Phase 2 spatial migration skipped: %s", err)

        # Phase 3: backfill metre coords on existing calibration points
        try:
            cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
            mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
            if cal and mdl:
                if not cal._model:
                    cal.set_model_store(mdl)
                n_backfilled = await cal.async_backfill_metres()
                if n_backfilled:
                    _LOGGER.info("Phase 3: backfilled %d calibration points with metre coords", n_backfilled)
        except Exception as err:
            _LOGGER.debug("Phase 3 calibration backfill skipped: %s", err)

        # Phase 4: backfill padspan_id on existing alert configs
        try:
            _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
            _alerts = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
            if _dev_reg and _alerts:
                _backfilled = 0
                for _addr, _cfg in list(_alerts.data.items()):
                    if isinstance(_cfg, dict) and not _cfg.get("padspan_id"):
                        _pid = _dev_reg.resolve(_addr)
                        # If can't resolve, create a persistent device entry
                        if not _pid:
                            _kind = "ibeacon" if _addr.startswith("ibeacon:") else "irk" if _addr.startswith("irk:") else "mac"
                            _pid = _dev_reg.resolve_or_create(_addr, kind=_kind, persist=True)
                        if _pid:
                            _cfg["padspan_id"] = _pid
                            _backfilled += 1
                if _backfilled:
                    await _alerts.store.async_save(_alerts.data)
                    await _dev_reg.async_flush_dirty()
                    _LOGGER.info("Phase 4: backfilled padspan_id on %d alert configs", _backfilled)
        except Exception as err:
            _LOGGER.debug("Phase 4 alert backfill skipped: %s", err)

        # Bluetooth live feed + TagIntegration + ESPresense MQTT (idempotent —
        # TagIntegration was already created by _ensure_deferred_stores above).
        await _async_start_live_feeds(hass)

    hass.async_create_task(_background_init())

    async def _set_map(call: ServiceCall) -> None:
        coord: PadSpanCoordinator | None = hass.data.get(DOMAIN, {}).get("coordinator")
        if not coord:
            coord = PadSpanCoordinator()
            hass.data[DOMAIN]["coordinator"] = coord
        coord.room_tag_map = call.data.get("room_tag_map") or {}
        coord.mark_success()
        # Persist so the map survives restarts/reloads (was in-memory only).
        try:
            _settings = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _settings:
                await _settings.async_set(room_tag_map=coord.room_tag_map)
        except Exception as err:
            _LOGGER.exception("Failed to persist room_tag_map: %s", err)
        _LOGGER.info("room_tag_map replaced via service (%d rooms, persisted)", len(coord.room_tag_map))

    hass.services.async_register(DOMAIN, SERVICE_SET_MAP, _set_map, schema=SERVICE_SCHEMA)

    async def _dump_devices(call: ServiceCall) -> dict | None:
        """Return all tracked BLE devices — equivalent to Bermuda's dump_devices."""
        presence_coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        data: dict[str, Any] = dict((presence_coord.data or {}) if presence_coord else {})

        from homeassistant.util import dt as dt_util  # noqa: PLC0415

        result = {
            "devices": data,
            "count": len(data),
            "version": BUILD_VERSION,
            "timestamp": dt_util.utcnow().isoformat(),
        }

        # Also create a persistent notification for easy human inspection
        try:
            from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415
            lines = []
            for key, obj in data.items():
                if obj.get("user_label") or obj.get("kind") == "entity":
                    name = obj.get("user_label") or obj.get("name") or key
                    room = obj.get("room") or "unknown"
                    kind = obj.get("kind") or "?"
                    age = obj.get("age_s")
                    age_str = f"{round(age)}s ago" if isinstance(age, (int, float)) else ""
                    lines.append(f"- **{name}** → {room} ({kind}) {age_str}".strip())
            summary = "\n".join(lines) or "No identified devices tracked yet."
            async_create(
                hass,
                f"**PadSpan HA — {len(data)} device(s)** (v{BUILD_VERSION})\n\n{summary}",
                title="padspan_ha.dump_devices",
                notification_id="padspan_ha_dump_devices",
            )
        except Exception:
            pass

        return result

    # Register dump_devices with response support (HA 2023.7+)
    try:
        from homeassistant.core import SupportsResponse  # noqa: PLC0415
        hass.services.async_register(
            DOMAIN, "dump_devices", _dump_devices,
            schema=vol.Schema({vol.Optional("notify", default=True): bool}),
            supports_response=SupportsResponse.OPTIONAL,
        )
    except ImportError:
        hass.services.async_register(
            DOMAIN, "dump_devices", _dump_devices,
            schema=vol.Schema({vol.Optional("notify", default=True): bool}),
        )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Per-config-entry setup: coordinator → presence polling → entity platforms."""
    hass.data.setdefault(DOMAIN, {})

    # Re-register panels with the current BUILD_ID so HACS reloads (without full
    # HA restart) always serve the latest module_url to the browser.
    try:
        await async_setup_panel(hass)
    except Exception as err:
        _LOGGER.warning("Panel re-registration failed: %s", err)

    # Ensure critical stores are present (reload-safe); deferred stores
    # are loaded in background by async_setup's _background_init task.
    try:
        await _ensure_stores(hass, critical_only=True)
    except Exception as err:
        _LOGGER.exception("Store init failed during setup_entry: %s", err)

    # Re-create the live feeds torn down by async_unload_entry (config-entry
    # reload, e.g. after saving options).  On first HA boot the feeds are
    # created exactly once by async_setup's _background_init — the flag is
    # only set by async_unload_entry, so this never double-creates them.
    if hass.data[DOMAIN].pop("_live_feeds_stopped", False):
        hass.async_create_task(_async_start_live_feeds(hass))

    coord: PadSpanCoordinator | None = hass.data[DOMAIN].get("coordinator")
    if coord is None:
        coord = PadSpanCoordinator()
        hass.data[DOMAIN]["coordinator"] = coord

    coord.enable_cloud = bool(entry.data.get(CONF_ENABLE_CLOUD, False))
    coord.hub_url = str(entry.data.get(CONF_HUB_URL, ""))
    coord.api_key = str(entry.data.get(CONF_API_KEY, ""))
    coord.scan_interval = int(entry.options.get(CONF_SCAN_INTERVAL, entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)))
    coord.ensure_defaults()

    # Restore the persisted room_tag_map.  It is saved into SettingsStore by the
    # set_room_tag_map service; without this load the coordinator starts empty on
    # every restart/reload, which blanks the Diagnostics check and the room→object
    # map the UI falls back to.  Only restore when the live coordinator has none,
    # so an in-session service update is never clobbered by a reload.
    try:
        _settings = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if _settings and not coord.room_tag_map:
            _saved_rtm = _settings.get("room_tag_map") or {}
            if isinstance(_saved_rtm, dict) and _saved_rtm:
                coord.room_tag_map = {
                    str(room): [str(k) for k in keys]
                    for room, keys in _saved_rtm.items()
                    if isinstance(keys, (list, tuple))
                }
                _LOGGER.info("Restored persisted room_tag_map (%d rooms)", len(coord.room_tag_map))
    except Exception as err:
        _LOGGER.exception("Failed to restore persisted room_tag_map: %s", err)

    # Ensure room metadata exists for all rooms
    try:
        mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        if mdl:
            await mdl.async_ensure_rooms(list(coord.room_tag_map.keys()))
    except Exception as err:
        _LOGGER.exception("ModelStore room ensure failed: %s", err)

    coord.mark_success()

    # Create and start the presence coordinator (drives sensor + device_tracker entities)
    presence_coord: PresenceCoordinator = hass.data[DOMAIN].get("presence_coordinator")  # type: ignore[assignment]
    if presence_coord is None:
        presence_coord = PresenceCoordinator(hass)
        hass.data[DOMAIN]["presence_coordinator"] = presence_coord

    # Forward platforms first so entities register quickly, then attempt first
    # data refresh with a short timeout.  If BLE isn't ready yet, entities will
    # populate on the next poll cycle (10 s) — this avoids blocking integration
    # setup for a long time on slow hardware or fresh installs.
    try:
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception as err:
        _LOGGER.exception("Forward entry setups failed: %s", err)
        return False

    # First refresh with 8 s timeout — long enough for a normal poll, short
    # enough not to stall integration setup on slow / fresh systems.
    import asyncio
    try:
        await asyncio.wait_for(
            presence_coord.async_config_entry_first_refresh(),
            timeout=8.0,
        )
    except asyncio.TimeoutError:
        _LOGGER.info("Presence coordinator first refresh timed out (8 s) — will retry on next poll")
    except Exception as err:
        _LOGGER.info("Presence coordinator initial fetch deferred (BLE may not be ready yet): %s", err)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Tear down: unload platforms, stop BLE, flush stores to disk."""
    unload_ok = True
    try:
        unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    except Exception as err:
        _LOGGER.warning("Platform unload error: %s", err)
        unload_ok = False

    # Clear panel registration flag so setup_entry re-registers with the
    # current BUILD_ID on next load (e.g. after a HACS update + reload).
    try:
        hass.data.get(DOMAIN, {}).pop(DATA_PANEL_REGISTERED, None)
    except Exception:
        pass

    # Stop presence coordinator (and its CPU-mode compute executor)
    try:
        _pc = hass.data.get(DOMAIN, {}).pop("presence_coordinator", None)
        if _pc is not None:
            _pc.shutdown_compute_executor()
    except Exception:
        pass

    # Stop tag integration listener
    try:
        tag_int = hass.data.get(DOMAIN, {}).pop(DATA_TAG_INTEGRATION, None)
        if tag_int:
            tag_int.unload()
    except Exception:
        pass

    # Stop ESPresense MQTT subscriber
    try:
        from .const import DATA_ESPRESENSE_MQTT
        esp = hass.data.get(DOMAIN, {}).pop(DATA_ESPRESENSE_MQTT, None)
        if esp:
            await esp.async_stop()
    except Exception:
        pass

    # Stop BLE callbacks/cache
    try:
        from .bluetooth_live import get_bluetooth_live, DATA_KEY
        bl = get_bluetooth_live(hass)
        if bl:
            bl.unload()
        hass.data.get(DOMAIN, {}).pop(DATA_KEY, None)
    except Exception as err:
        _LOGGER.debug("BLE cleanup error: %s", err)

    # Mark the live feeds as stopped so async_setup_entry re-creates them on
    # reload — they are otherwise only created once per HA boot in async_setup.
    hass.data.setdefault(DOMAIN, {})["_live_feeds_stopped"] = True

    # Flush object history to disk before shutdown
    try:
        from .const import DATA_OBJECT_HISTORY, OBJECT_HISTORY_STORE_KEY
        _dom = hass.data.get(DOMAIN, {})
        _hist = _dom.get(DATA_OBJECT_HISTORY)
        _store = _dom.get("_obj_hist_store")
        if _hist is not None and _store is not None:
            await _store.async_save(dict(_hist))
            _LOGGER.debug("Object history flushed to disk (%d entries)", len(_hist))
    except Exception as err:
        _LOGGER.debug("Object history flush error: %s", err)

    # Flush device registry to disk before shutdown
    try:
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            await _dev_reg.async_flush_dirty()
    except Exception as err:
        _LOGGER.debug("DeviceRegistry flush error: %s", err)

    # Flush traceback store to disk before shutdown
    try:
        _dom = hass.data.get(DOMAIN, {})
        _tb = _dom.get(DATA_TRACEBACK)
        if _tb is not None:
            await _tb.async_flush()
            _LOGGER.debug("Traceback flushed to disk (%d frames)", len(_tb.frames))
    except Exception as err:
        _LOGGER.debug("Traceback flush error: %s", err)

    return unload_ok
