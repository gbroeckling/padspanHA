# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for settings get/set.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_OBJECTS,
    DATA_COORDINATOR,
    DATA_CALIBRATION,
    DATA_ESPRESENSE_MQTT,
)
from .bluetooth_live import get_bluetooth_live
from .ws_common import _LIGHT_SHAPE_KINDS, _OBJECT_HISTORY_DAYS_DEFAULT, _OBJECT_HISTORY_DAY_CHOICES, _get_settings, _invalidate_snapshot_cache, _padspan_pro_active

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({"type": "padspan_ha/settings_get"})

@websocket_api.async_response
async def ws_settings_get(hass: HomeAssistant, connection, msg) -> None:
    from .presence_coordinator import PresenceCoordinator  # noqa: PLC0415
    connection.send_result(msg["id"], {
        "settings": _get_settings(hass),
        "cpu_pinning_supported": PresenceCoordinator.cpu_pinning_supported(),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/settings_set",
        vol.Optional("data_mode"): str,
        vol.Optional("cpu_mode"): str,                        # "shared"|"single"|"dedicated"
        vol.Optional("update_check_enabled"): bool,           # daily version ping (README)
        vol.Optional("telemetry_enabled"): bool,              # opt-in usage report (telemetry.py)
        vol.Optional("telemetry_asked"): bool,                # the ask card was answered; never shown again
        vol.Optional("vendor_lookup_enabled"): bool,
        vol.Optional("room_change_delay_s"): vol.Coerce(float),
        vol.Optional("away_timeout_m"): vol.Coerce(float),
        vol.Optional("ref_power"): vol.Coerce(float),
        vol.Optional("path_loss_exp"): vol.Coerce(float),
        vol.Optional("kalman_q"): vol.Coerce(float),
        vol.Optional("kalman_r"): vol.Coerce(float),
        vol.Optional("assumed_device_height_m"): vol.Coerce(float),
        vol.Optional("hidden_map_ids"): list,
        vol.Optional("followed_addrs"): list,
        vol.Optional("health_reminder_enabled"): bool,
        vol.Optional("health_reminder_last_ts"): vol.Any(float, int, None),
        vol.Optional("maps_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_focus"): vol.Any(int, None),
        vol.Optional("overview_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_focus"): vol.Any(int, None),
        vol.Optional("lights_hidden"): list,
        vol.Optional("lights_showcase"): bool,
        vol.Optional("lights_hide_untouched"): bool,
        vol.Optional("lights_fit_rooms"): bool,
        vol.Optional("adaptive_learning_enabled"): bool,
        vol.Optional("adaptive_floor_detection"): bool,
        vol.Optional("signal_loss_linger_s"): vol.Coerce(int),
        vol.Optional("advanced_extra_tabs"): list,
        vol.Optional("ha_entity_tracker_enabled"): bool,
        vol.Optional("ha_entity_area_enabled"): bool,
        vol.Optional("ha_entity_distance_enabled"): bool,
        vol.Optional("ha_entity_scanner_distance_enabled"): bool,
        vol.Optional("ha_entity_occupancy_enabled"): bool,
        vol.Optional("mqtt_publish_enabled"): bool,
        vol.Optional("espresense_mqtt_enabled"): bool,
        vol.Optional("espresense_topic_prefix"): str,
        vol.Optional("espresense_room_map"): dict,
        vol.Optional("espresense_companion_url"): str,
        vol.Optional("aggressive_ble_reseed"): bool,
        vol.Optional("presence_poll_interval_s"): vol.Coerce(int),
        vol.Optional("ble_reseed_interval_s"): vol.Coerce(int),
        vol.Optional("lights_panel_enabled"): bool,
        vol.Optional("bermuda_ignore"): bool,
        vol.Optional("tags_room_events_enabled"): bool,
        vol.Optional("tags_nfc_identify_enabled"): bool,
        vol.Optional("tags_phone_autolink_enabled"): bool,
        vol.Optional("quiet_mode"): bool,
        vol.Optional("light_theme"): bool,
        vol.Optional("ui_skin"): str,
        vol.Optional("light_shapes"): dict,
        vol.Optional("beacon_auto_calibrate"): bool,
        vol.Optional("overview_persistent_pins"): bool,
        vol.Optional("overview_show_walls"): bool,
        vol.Optional("overview_show_outdoor"): bool,
        vol.Optional("object_history_days"): vol.Coerce(int),
        vol.Optional("scanner_offsets"): dict,
        vol.Optional("excluded_scanners"): list,
        vol.Optional("excluded_objects"): list,
        vol.Optional("ingest_rules"): list,
        vol.Optional("overview_2d_mode"): bool,
        vol.Optional("positioning_algorithm"): str,
        vol.Optional("beacon_profiling_enabled"): bool,
        vol.Optional("beacon_tune_disabled"): list,
        vol.Optional("beacon_group_overrides"): dict,
        vol.Optional("trackability_rating_enabled"): bool,
        vol.Optional("walk_to_identify_enabled"): bool,
        vol.Optional("radio_map_enabled"): bool,
        vol.Optional("distortion_map_enabled"): bool,
        vol.Optional("compass_ring_enabled"): bool,
        vol.Optional("replay_timeline_enabled"): bool,
        vol.Optional("phone_wizard_enabled"): bool,
        vol.Optional("mac_rotation_bridging"): bool,
        vol.Optional("apple_auto_classify"): bool,
        vol.Optional("forensics_enabled"): bool,
        vol.Optional("license_tier_override"): str,
        vol.Optional("bright_reveal_presence"): bool,
        vol.Optional("forensics_retention_days"): vol.Coerce(int),
        vol.Optional("rssi_capture_enabled"): bool,
        vol.Optional("rssi_capture_retention_days"): vol.Coerce(int),
        vol.Optional("ble_max_age_s"): vol.Coerce(int),
        vol.Optional("occupancy_hybrid_enabled"): bool,
        vol.Optional("occupancy_cluster_threshold"): vol.Coerce(float),
        vol.Optional("distance_stationary_devices"): list,
        vol.Optional("onboarding_completed"): bool,
        # Radio map visualization parameters (clamped in handler below)
        vol.Optional("heatmap_gain"): vol.Coerce(int),        # -20 to +20 dB
        vol.Optional("heatmap_contrast"): vol.Coerce(int),    # -15 to +15
        vol.Optional("distortion_intensity"): vol.Coerce(int),  # 0-100 %
        vol.Optional("heatmap_source"): vol.Coerce(int),      # 0-100 % (calibration vs adaptive blend)
        vol.Optional("auto_offset_mode"): str,                # "off"|"partial"|"full"
        vol.Optional("padspan_automations"): list,              # [{trigger, device_key, device_label, action, entity_id, enabled}]
    }
)
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection, msg) -> None:
    """Persist one or more settings changes.

    Each field is individually validated and clamped to safe ranges before
    being written to the SettingsStore.  After saving, entity toggles in the
    HA registry are updated to reflect enabled/disabled preferences.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        payload: dict[str, Any] = {}
        # Only touch data_mode when the message actually carries it.  Callers
        # that omit it (e.g. the lights panel hiding a light) must not flip
        # the integration back to "sample" mode as a side effect.
        if "data_mode" in msg:
            mode = (msg.get("data_mode") or "sample").strip().lower()
            if mode not in ("sample", "live"):
                mode = "sample"
            payload["data_mode"] = mode
        if "cpu_mode" in msg:
            cm = (msg.get("cpu_mode") or "shared").strip().lower()
            if cm not in ("shared", "single", "dedicated"):
                cm = "shared"
            payload["cpu_mode"] = cm
        if "update_check_enabled" in msg:
            payload["update_check_enabled"] = bool(msg.get("update_check_enabled"))
        if "telemetry_enabled" in msg:
            # Opting a whole install into sending reports is an admin's call,
            # like the send-now and reset-id commands beside it.
            _user = getattr(connection, "user", None)
            if _user is not None and getattr(_user, "is_admin", True) is False:
                connection.send_error(msg["id"], "unauthorized", "Only an administrator can change the usage report")
                return
            payload["telemetry_enabled"] = bool(msg.get("telemetry_enabled"))
            if payload["telemetry_enabled"]:
                # Mint the anonymous id at opt-in, so the Preview shows the
                # real report from that moment on — and start the usage and
                # error windows here, so nothing from before the yes goes.
                from .telemetry import ensure_install_id, reset_windows  # noqa: PLC0415
                await ensure_install_id(hass)
                reset_windows(hass)
        if "telemetry_asked" in msg:
            payload["telemetry_asked"] = bool(msg.get("telemetry_asked"))
        if "vendor_lookup_enabled" in msg:
            payload["vendor_lookup_enabled"] = bool(msg.get("vendor_lookup_enabled"))
        if "room_change_delay_s" in msg:
            payload["room_change_delay_s"] = max(0.0, min(300.0, float(msg["room_change_delay_s"])))
        if "away_timeout_m" in msg:
            payload["away_timeout_m"] = max(1.0, min(1440.0, float(msg["away_timeout_m"])))
        if "ref_power" in msg:
            payload["ref_power"] = max(-100.0, min(0.0, float(msg["ref_power"])))
        if "path_loss_exp" in msg:
            payload["path_loss_exp"] = max(1.0, min(4.0, float(msg["path_loss_exp"])))
        if "kalman_q" in msg:
            payload["kalman_q"] = max(0.01, min(1.0, float(msg["kalman_q"])))
        if "kalman_r" in msg:
            payload["kalman_r"] = max(0.5, min(50.0, float(msg["kalman_r"])))
        if "assumed_device_height_m" in msg:
            payload["assumed_device_height_m"] = max(0.0, min(3.0, float(msg["assumed_device_height_m"])))
        if "hidden_map_ids" in msg:
            ids = msg["hidden_map_ids"]
            payload["hidden_map_ids"] = [str(x) for x in ids if isinstance(x, str)] if isinstance(ids, list) else []
        if "followed_addrs" in msg:
            addrs = msg["followed_addrs"]
            _new_followed = [str(x).upper() for x in addrs if isinstance(x, str)] if isinstance(addrs, list) else []
            payload["followed_addrs"] = _new_followed
            try:
                _old_followed = set(str(x).upper() for x in (st.data.get("followed_addrs") or []))
            except Exception:
                _old_followed = set()
            # Clear coordinator state for unfollowed objects so they don't
            # linger on the overview 3D map as stale ghosts.
            try:
                _removed_f = _old_followed - set(x.upper() for x in _new_followed)
                if _removed_f:
                    _coord_f = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
                    if _coord_f:
                        for _rf in _removed_f:
                            _coord_f.clear_object_state(_rf)
            except Exception:
                pass
            # Auto-label newly-followed objects that have no label yet.
            # Entity creation (device_tracker/sensor) requires user_label, so
            # following alone used to produce no entities and the device never
            # surfaced outside the panel.  Label = advertised BLE name when we
            # can see one, else a readable fallback derived from the key.
            try:
                _added_f = set(_new_followed) - _old_followed
                _obj_store_f = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
                if _added_f and _obj_store_f:
                    _name_by_mac: dict[str, str] = {}
                    try:
                        _bl_f = get_bluetooth_live(hass)
                        if _bl_f is not None:
                            for _adf in (_bl_f.get_snapshot(max_ads=5000, max_age_s=14400).get("advertisements") or []):
                                _a_addr = str(_adf.get("address") or "").upper()
                                _a_name = str(_adf.get("name") or "").strip()
                                if _a_addr and _a_name and _a_addr not in _name_by_mac:
                                    _name_by_mac[_a_addr] = _a_name
                    except Exception:
                        pass
                    for _af in _added_f:
                        if _obj_store_f.get(_af):
                            continue  # already labelled by the user
                        _parts_f = _af.split(":")
                        _mac_f = None
                        if len(_parts_f) >= 6 and all(len(p) == 2 for p in _parts_f[-6:]):
                            _mac_f = ":".join(_parts_f[-6:])
                        _lbl_f = _name_by_mac.get(_mac_f or _af, "")
                        if not _lbl_f:
                            if _af.startswith("IBEACON:") and len(_parts_f) >= 4:
                                _lbl_f = f"iBeacon {_parts_f[1][:8].lower()}"
                                if _mac_f:
                                    _lbl_f += f" ({_mac_f[-8:]})"
                            elif _mac_f:
                                _lbl_f = _mac_f
                            else:
                                continue  # entity_id or unknown form — already tracked via HA
                        await _obj_store_f.async_set(_af, _lbl_f)
                        _LOGGER.info("Auto-labelled followed object %s as %r", _af, _lbl_f)
            except Exception as _fl_err:
                _LOGGER.debug("Follow auto-label failed: %s", _fl_err)
        if "health_reminder_enabled" in msg:
            payload["health_reminder_enabled"] = bool(msg["health_reminder_enabled"])
        if "health_reminder_last_ts" in msg:
            ts = msg["health_reminder_last_ts"]
            payload["health_reminder_last_ts"] = float(ts) if ts is not None else None
        if "maps_iso_floor_gap" in msg:
            payload["maps_iso_floor_gap"] = max(60, min(340, int(msg["maps_iso_floor_gap"])))
        if "maps_iso_horiz_gap" in msg:
            payload["maps_iso_horiz_gap"] = max(-120, min(120, int(msg["maps_iso_horiz_gap"])))
        if "maps_iso_focus" in msg:
            v = msg["maps_iso_focus"]
            payload["maps_iso_focus"] = int(v) if v is not None else None
        if "overview_iso_floor_gap" in msg:
            payload["overview_iso_floor_gap"] = max(60, min(340, int(msg["overview_iso_floor_gap"])))
        if "overview_iso_horiz_gap" in msg:
            payload["overview_iso_horiz_gap"] = max(-120, min(120, int(msg["overview_iso_horiz_gap"])))
        if "overview_iso_focus" in msg:
            v = msg["overview_iso_focus"]
            payload["overview_iso_focus"] = int(v) if v is not None else None
        if "lights_hidden" in msg:
            ids = msg["lights_hidden"]
            payload["lights_hidden"] = [str(x) for x in ids if isinstance(x, str)] if isinstance(ids, list) else []
        if "ble_max_age_s" in msg:
            payload["ble_max_age_s"] = max(30, min(14400, int(msg["ble_max_age_s"])))
        # ── Radio map / heatmap visualization controls (v0.15.x) ──────────
        if "heatmap_gain" in msg:
            payload["heatmap_gain"] = max(-20, min(20, int(msg["heatmap_gain"])))
        if "heatmap_contrast" in msg:
            payload["heatmap_contrast"] = max(-15, min(15, int(msg["heatmap_contrast"])))
        if "distortion_intensity" in msg:
            payload["distortion_intensity"] = max(0, min(100, int(msg["distortion_intensity"])))
        if "heatmap_source" in msg:
            payload["heatmap_source"] = max(0, min(100, int(msg["heatmap_source"])))
        if "auto_offset_mode" in msg:
            # "off" = manual offsets only, "partial" = auto-adjust weak scanners,
            # "full" = auto-adjust all scanners to minimize prediction error
            mode = str(msg["auto_offset_mode"]).strip().lower()
            payload["auto_offset_mode"] = mode if mode in ("off", "partial", "full") else "partial"
        if "scanner_offsets" in msg:
            raw = msg["scanner_offsets"]
            if isinstance(raw, dict):
                payload["scanner_offsets"] = {str(k): float(v) for k, v in raw.items()}
        if "excluded_objects" in msg:
            # Stable identity keys only. Sorted and de-duplicated so the stored
            # list stays readable — this is a setting people hand-edit and paste
            # between installs.
            raw = msg["excluded_objects"]
            payload["excluded_objects"] = (
                sorted({str(x).strip() for x in raw if isinstance(x, str) and x.strip()})
                if isinstance(raw, list) else []
            )
        if "ingest_rules" in msg:
            # Kept as given apart from the shape check — IngestPolicy is the one
            # thing that interprets a rule, and validating the meaning in two
            # places is how the two come to disagree. A rule that matches
            # nothing is dropped there, not silently stored as a live rule here.
            raw = msg["ingest_rules"]
            payload["ingest_rules"] = (
                [r for r in raw if isinstance(r, dict) and isinstance(r.get("match"), dict)]
                if isinstance(raw, list) else []
            )
        if "excluded_scanners" in msg:
            raw = msg["excluded_scanners"]
            payload["excluded_scanners"] = (
                sorted({str(x) for x in raw if isinstance(x, str) and x.strip()})
                if isinstance(raw, list) else []
            )
        if "lights_showcase" in msg:
            payload["lights_showcase"] = bool(msg["lights_showcase"])
            if payload["lights_showcase"] and not st.data.get("lights_showcase"):
                from .telemetry import bump as _bump  # noqa: PLC0415
                _bump(hass, "showcase_on")
        if "lights_hide_untouched" in msg:
            payload["lights_hide_untouched"] = bool(msg["lights_hide_untouched"])
        if "lights_fit_rooms" in msg:
            payload["lights_fit_rooms"] = bool(msg["lights_fit_rooms"])
        if "light_shapes" in msg:
            # entity_id -> shape kind. Only known kinds are stored; an unknown
            # value would just fall back to the default marker in the frontend,
            # but there is no reason to persist junk. "auto" is expressed by
            # omitting the entity, so it is never stored.
            raw = msg["light_shapes"]
            if isinstance(raw, dict):
                payload["light_shapes"] = {
                    str(k): str(v) for k, v in raw.items()
                    if str(v) in _LIGHT_SHAPE_KINDS and str(k).startswith("light.")
                }
        if "object_history_days" in msg:
            _days = int(msg["object_history_days"])
            payload["object_history_days"] = (
                _days if _days in _OBJECT_HISTORY_DAY_CHOICES else _OBJECT_HISTORY_DAYS_DEFAULT
            )
        if "adaptive_learning_enabled" in msg:
            payload["adaptive_learning_enabled"] = bool(msg["adaptive_learning_enabled"])
        if "adaptive_floor_detection" in msg:
            payload["adaptive_floor_detection"] = bool(msg["adaptive_floor_detection"])
        if "signal_loss_linger_s" in msg:
            payload["signal_loss_linger_s"] = max(10, min(300, int(msg["signal_loss_linger_s"])))
        if "advanced_extra_tabs" in msg:
            valid = {"devices","bluetooth","presence","monitor","qa","sandbox"}
            payload["advanced_extra_tabs"] = [t for t in msg["advanced_extra_tabs"] if t in valid]
        if "ui_skin" in msg:
            # Anything unrecognised falls back to classic, so a bad value can
            # never leave someone stranded on a skin that failed to load.
            _skin = str(msg["ui_skin"] or "").strip().lower()
            payload["ui_skin"] = _skin if _skin in ("classic", "2025") else "classic"
        for key in ("ha_entity_tracker_enabled", "ha_entity_area_enabled",
                    "ha_entity_distance_enabled", "ha_entity_scanner_distance_enabled",
                    "mqtt_publish_enabled", "espresense_mqtt_enabled", "aggressive_ble_reseed",
                    "ha_entity_occupancy_enabled",
                    "lights_panel_enabled", "bermuda_ignore", "bright_reveal_presence",
                    "tags_room_events_enabled", "tags_nfc_identify_enabled",
                    "tags_phone_autolink_enabled", "quiet_mode", "light_theme",
                    "beacon_auto_calibrate", "overview_persistent_pins", "overview_show_walls",
                    "overview_show_outdoor",
                    "overview_2d_mode", "beacon_profiling_enabled",
                    "trackability_rating_enabled", "walk_to_identify_enabled",
                    "radio_map_enabled", "distortion_map_enabled",
                    "compass_ring_enabled", "replay_timeline_enabled",
                    "rssi_capture_enabled",
                    "phone_wizard_enabled", "mac_rotation_bridging",
                    "apple_auto_classify"):
            if key in msg:
                payload[key] = bool(msg[key])
        if "license_tier_override" in msg:
            # A supported way to LOOK at a lower tier from a Pro install — the
            # free experience is the one path a Pro developer can never notice
            # is broken otherwise. It can only lower the effective tier
            # (licence.effective_tier), so it is not a way past the licence.
            from .licence import TIERS  # noqa: PLC0415
            _ov = str(msg["license_tier_override"] or "").strip().lower()
            payload["license_tier_override"] = _ov if _ov in TIERS else ""
        if "forensics_enabled" in msg:
            # Enabling requires an activated PadSpan Pro licence key (set via
            # padspan_ha/forensics_license_activate).  Disabling is always allowed.
            _want = bool(msg["forensics_enabled"])
            if _want and not _padspan_pro_active(hass):
                _want = False      # same gate as everywhere else: expiry included
            payload["forensics_enabled"] = _want
        if "forensics_retention_days" in msg:
            from .forensics_store import RETENTION_CHOICES, DEFAULT_RETENTION_DAYS
            _fd = int(msg["forensics_retention_days"])
            payload["forensics_retention_days"] = _fd if _fd in RETENTION_CHOICES else DEFAULT_RETENTION_DAYS
        if "rssi_capture_retention_days" in msg:
            from .capture_store import RETENTION_CHOICES as _CAP_RC, DEFAULT_RETENTION_DAYS as _CAP_RD
            _cd = int(msg["rssi_capture_retention_days"])
            payload["rssi_capture_retention_days"] = _cd if _cd in _CAP_RC else _CAP_RD
        if "presence_poll_interval_s" in msg:
            payload["presence_poll_interval_s"] = max(1, min(60, int(msg["presence_poll_interval_s"])))
        if "ble_reseed_interval_s" in msg:
            payload["ble_reseed_interval_s"] = max(1, min(60, int(msg["ble_reseed_interval_s"])))
        if "positioning_algorithm" in msg:
            algo = str(msg["positioning_algorithm"]).strip().lower()
            payload["positioning_algorithm"] = algo if algo in ("knn", "rf") else "knn"
        if "beacon_tune_disabled" in msg:
            raw = msg["beacon_tune_disabled"]
            payload["beacon_tune_disabled"] = [str(x) for x in raw] if isinstance(raw, list) else []
        if "beacon_group_overrides" in msg:
            raw = msg["beacon_group_overrides"]
            payload["beacon_group_overrides"] = {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}
        if "distance_stationary_devices" in msg:
            raw = msg["distance_stationary_devices"]
            payload["distance_stationary_devices"] = [str(x) for x in raw] if isinstance(raw, list) else []
        if "onboarding_completed" in msg:
            payload["onboarding_completed"] = bool(msg["onboarding_completed"])
        if "espresense_companion_url" in msg:
            _url = str(msg["espresense_companion_url"]).strip().rstrip("/")
            payload["espresense_companion_url"] = _url
        if "espresense_topic_prefix" in msg:
            _raw_prefix = str(msg["espresense_topic_prefix"]).strip().strip("/").replace("#", "").replace("+", "")
            if _raw_prefix:
                payload["espresense_topic_prefix"] = _raw_prefix
        if "espresense_room_map" in msg:
            _raw_rm = msg["espresense_room_map"]
            payload["espresense_room_map"] = {str(k): str(v) for k, v in _raw_rm.items()} if isinstance(_raw_rm, dict) else {}
        # ── Occupancy estimation controls ──────────────────────────────────
        if "occupancy_multiplier" in msg:
            payload["occupancy_multiplier"] = max(0.5, min(10.0, float(msg["occupancy_multiplier"])))
        if "occupancy_dwell_min" in msg:
            payload["occupancy_dwell_min"] = max(0.0, min(60.0, float(msg["occupancy_dwell_min"])))
        if "occupancy_cluster_threshold" in msg:
            payload["occupancy_cluster_threshold"] = max(2.0, min(30.0, float(msg["occupancy_cluster_threshold"])))
        if "occupancy_hybrid_enabled" in msg:
            payload["occupancy_hybrid_enabled"] = bool(msg["occupancy_hybrid_enabled"])
        if "padspan_automations" in msg:
            # Validate and sanitize each rule
            _clean_rules = []
            for r in (msg["padspan_automations"] or []):
                if not isinstance(r, dict):
                    continue
                _clean_rules.append({
                    "id": str(r.get("id", "")),
                    "trigger": str(r.get("trigger", ""))[:10],
                    "device_key": str(r.get("device_key", "")),
                    "device_label": str(r.get("device_label", ""))[:80],
                    "action": str(r.get("action", ""))[:20],
                    "entity_id": str(r.get("entity_id", ""))[:120],
                    "enabled": bool(r.get("enabled", True)),
                })
            payload["padspan_automations"] = _clean_rules
        await st.async_set(**payload)

        # ── Excluded scanners changed → retrain the forest (issue #59) ───────
        # k-NN masks per query, but the Random Forest bakes its feature columns
        # in at training time: without a retrain the masked scanner would keep
        # its column (and its influence on every split) until the next
        # calibration edit. Retraining reads the new exclusion set and rebuilds
        # from the untouched stored samples, so this is reversible either way.
        if "excluded_scanners" in msg:
            try:
                _cal_ex = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
                if _cal_ex:
                    hass.async_create_task(_cal_ex._async_train_rf())
            except Exception as _ex_err:
                _LOGGER.debug("Excluded-scanner retrain: %s", _ex_err)

        # ── Dynamic ESPresense MQTT toggle ───────────────────────────────────
        if "espresense_mqtt_enabled" in msg:
            try:
                if bool(msg["espresense_mqtt_enabled"]):
                    _prefix = st.data.get("espresense_topic_prefix", "espresense")
                    from .espresense_mqtt import async_setup_espresense_mqtt
                    hass.async_create_task(async_setup_espresense_mqtt(hass, _prefix))
                else:
                    _esp = hass.data.get(DOMAIN, {}).pop(DATA_ESPRESENSE_MQTT, None)
                    if _esp:
                        hass.async_create_task(_esp.async_stop())
            except Exception:
                pass

        # ── Toggle existing PadSpan entities in HA registry ──────────────────
        _entity_keys = {
            "ha_entity_tracker_enabled": "__tracker",
            "ha_entity_area_enabled": "__area",
            "ha_entity_distance_enabled": "__distance",
            "ha_entity_scanner_distance_enabled": "__dist__",
        }
        _toggled_any = False
        for _skey, _suffix in _entity_keys.items():
            if _skey not in msg:
                continue
            _enabled = bool(msg[_skey])
            try:
                _er = entity_registry.async_get(hass)
                _disabler = entity_registry.RegistryEntryDisabler.INTEGRATION
                for _entry in list(_er.entities.values()):
                    if _entry.platform != DOMAIN:
                        continue
                    _uid = _entry.unique_id or ""
                    # __dist__ matches scanner-distance; __distance matches global distance
                    # Make sure __distance doesn't match __dist__ entries
                    if _suffix == "__distance" and "__dist__" in _uid:
                        continue
                    if _suffix not in _uid:
                        continue
                    if _enabled and _entry.disabled_by == _disabler:
                        _er.async_update_entity(_entry.entity_id, disabled_by=None)
                        _toggled_any = True
                    elif not _enabled and _entry.disabled_by is None:
                        _er.async_update_entity(_entry.entity_id, disabled_by=_disabler)
                        _toggled_any = True
            except Exception:
                _LOGGER.debug("Failed to toggle entities for %s", _skey, exc_info=True)
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"settings": _get_settings(hass)})
