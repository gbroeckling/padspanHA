# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for settings get/set.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import math
import re

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
    LIGHT_TYPE_OVERRIDE_KINDS,
)
from .bluetooth_live import get_bluetooth_live
from .ws_common import _LIGHT_SHAPE_KINDS, _OBJECT_HISTORY_DAYS_DEFAULT, _OBJECT_HISTORY_DAY_CHOICES, _get_settings, _invalidate_snapshot_cache, _padspan_pro_active

_LOGGER = logging.getLogger(__name__)

# Shared whitelists — referenced both by the individual lights_automorph_style
# / lights_showcase_theme setters below AND by the Showcase preset sanitizer
# (a preset's saved "values" blob must never let a removed/renamed style or
# theme key persist forever in someone's saved presets), so a new style or
# theme only ever needs adding in ONE Python-side place.
_AUTOMORPH_STYLES = (
    # 2026-09-17: circuit, contour, facet, sumie, stainedglass,
    # constellation, pulse, orbitring, puzzle and shatter removed as
    # near-duplicates of each other and of glow — see AUTOMORPH_STYLE_LABELS
    # in iso_lights.js for why. A saved preset or live setting still naming
    # one falls back to "glow" through _normalize_automorph_style below,
    # exactly as the sanitizer was built for.
    "glow", "blueprint", "nebula", "halo", "spikecrown", "scallop",
    "bloomflower", "geode", "honeycomb", "extrude",
    "shardburst", "origami", "inkbleed", "rosette", "lensflare", "mycelium",
)
_SHOWCASE_THEMES = (
    # 2026-09-16: editorial_minimalist, elevated_blueprint and nightscape
    # were removed as near-duplicates (a similarity pass over all 22 put
    # each within 0.5 of a theme it added nothing to). A saved preset or a
    # live setting still naming one falls back to "classic" through
    # _normalize_showcase_theme, exactly as the sanitizer was built for.
    # tests/test_showcase_registry_parity.py holds this tuple equal to the
    # frontend's SHOWCASE_THEMES so the two can never drift silently again.
    "classic", "cinematic_glass", "neo_hud",
    "ambient_premium", "dataviz_precision", "organic_bioluminescent",
    "material_you", "neon_precision", "luxury_realestate",
    "wabi_sabi", "hygge", "aurora", "automotive_hud", "art_deco",
    "swiss_style", "bauhaus", "holographic", "retro_futurism",
    "obsidian_noir",
)


def _normalize_automorph_style(value: Any) -> str:
    """Lowercase/whitelist an Automorph style key, defaulting to "glow" for
    anything unrecognized (a stale key from a removed style, a hand-edited
    settings file, or garbage input). Shared by the live setter AND the
    Showcase preset sanitizer below, so both fall back the same way — this
    exact bug class (a whitelist check skipped in one of the two places)
    already shipped once, for a sibling setting, before this was extracted."""
    v = str(value or "").strip().lower()
    return v if v in _AUTOMORPH_STYLES else "glow"


def _sanitize_light_shapes(raw: Any) -> dict[str, str]:
    """entity_id -> shape kind. Only known kinds are stored; an unknown
    value would just fall back to the default marker in the frontend, but
    there is no reason to persist junk. "auto" is expressed by omitting the
    entity, so it is never stored.

    CORRECTED 2026-09-19 (Phase 2a registry audit): this used to keep only
    "light."-prefixed keys, unlike light_type_overrides (which is correctly
    light.*-only — a type override only ever makes sense for a light). But
    the Atlas inspector offers this same Shape chooser for EVERY placed
    class, and resolveLightShape (light_codes.js) already applies an
    override generically regardless of class — so picking a shape for a
    fan, a door, or any other non-light entity silently saved nothing
    server-side, with no error shown. No domain check at all now, matching
    what the frontend already does with the value; a fixed-glyph class
    (motion/flood/temp/humidity/air/lock) has nothing to gain from an
    override, but that's a UI decision (the inspector hides the control for
    those — hasFixedGlyph), not something this schema needs to police.
    """
    if not isinstance(raw, dict):
        return {}
    return {
        str(k): str(v) for k, v in raw.items()
        if str(v) in _LIGHT_SHAPE_KINDS and str(k)
    }


def _normalize_showcase_theme(value: Any) -> str:
    """The Showcase-theme equivalent of _normalize_automorph_style above —
    same reasoning, same shared use by the live setter and the preset
    sanitizer, defaulting to "classic"."""
    v = str(value or "").strip().lower()
    return v if v in _SHOWCASE_THEMES else "classic"


def _sanitize_showcase_presets(presets_in: Any) -> list[dict[str, Any]]:
    """Named snapshots of the whole Showcase "look" bundle — Garry: "we now
    have thousands of combinations in the mapping, lights setup, we need to
    build a preset system." Each entry's `values` uses the SAME real
    setting keys the live setters above already validate individually, so
    applying a preset is one plain settingsSet(values) call on the frontend
    with no translation layer — and so this is the one place a saved preset
    is defended against a stale/removed style or theme key, a future
    settings-schema change, or hand-edited storage. A standalone function
    (not inlined in the websocket handler) so it can be unit-tested
    directly, without constructing a fake connection/message just to
    exercise a few lines of validation.
    """
    presets_out: list[dict[str, Any]] = []
    if not isinstance(presets_in, list):
        return presets_out
    # The frontend always appends a newly-saved preset LAST — cap from the
    # END (keep the 50 most recent), not the front, or the 51st save
    # silently vanishes while the UI still reports "Saved" (found in
    # review: the old `[:50]` kept exactly the 50 OLD entries and dropped
    # the just-added one every time).
    for p in presets_in[-50:]:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()[:60]
        vals = p.get("values")
        if not name or not isinstance(vals, dict):
            continue
        try:
            values: dict[str, Any] = {
                "lights_showcase": bool(vals.get("lights_showcase")),
                "lights_showcase_theme": _normalize_showcase_theme(vals.get("lights_showcase_theme")),
                "lights_fit_rooms": bool(vals.get("lights_fit_rooms")),
                "lights_isolux": bool(vals.get("lights_isolux")),
                "lights_show_beacons": bool(vals.get("lights_show_beacons")),
                "lights_hide_device_codes": bool(vals.get("lights_hide_device_codes")),
                "lights_hide_untouched": bool(vals.get("lights_hide_untouched")),
                "lights_automorph_enabled": bool(vals.get("lights_automorph_enabled")),
                "lights_automorph_room_pct": max(0, min(100, int(vals.get("lights_automorph_room_pct") or 0))),
                "lights_automorph_hardness": max(-100, min(100, int(vals.get("lights_automorph_hardness") or 0))),
                "lights_automorph_style": _normalize_automorph_style(vals.get("lights_automorph_style")),
                "lights_automorph_subtlety": max(0, min(100, int(vals.get("lights_automorph_subtlety") or 0))),
            }
            # Layout & view — Floor focus / Spacing / L-R (Garry, 2026-09-12:
            # "include more elements into this feature"). OPTIONAL, kept only
            # when the preset carries them: a look saved before these existed
            # must keep applying as a pure look, never snap the camera to a
            # default it never asked for. Same clamps as the live setters.
            if vals.get("overview_iso_floor_gap") is not None:
                values["overview_iso_floor_gap"] = max(60, min(340, int(vals["overview_iso_floor_gap"])))
            if vals.get("overview_iso_horiz_gap") is not None:
                values["overview_iso_horiz_gap"] = max(-120, min(120, int(vals["overview_iso_horiz_gap"])))
            if "overview_iso_focus" in vals:
                f = vals["overview_iso_focus"]
                values["overview_iso_focus"] = int(f) if f is not None else None
            if vals.get("overview_iso_zoom") is not None:
                values["overview_iso_zoom"] = max(0.4, min(2.5, float(vals["overview_iso_zoom"])))
            presets_out.append({"name": name, "values": values})
        except (TypeError, ValueError):
            continue  # one malformed preset must not reject the whole save
    return presets_out

# ── Whole House Presets ──────────────────────────────────────────────────────
# Garry, 2026-09-21: "a pull down like presets, but call whole house presets.
# There will be a set, and a name on it. It will remember every setting in
# the house when set is hit, and bring all settings back when selected."
#
# A named snapshot of real DEVICE state (not PadSpan's own view settings —
# that is lights_showcase_presets above). Each preset's `entities` is stored
# in exactly the shape HA's own scene.apply service takes
# ({entity_id: {"state": "on", "brightness": 120, ...}}), so applying one is
# a single native service call from the frontend, under the calling user's
# own HA permissions — no server-side service-calling code, so nothing new
# for the Phase 2i allowlist to police. light.* and fan.* ONLY: a saved
# preset that could unlock a door (or arm/disarm anything) is exactly the
# hole that security pass closed, so locks, covers, alarm panels and every
# other domain are refused here regardless of what a client sends.
_WHP_DOMAINS = ("light.", "fan.")
_WHP_MAX_PRESETS = 20
_WHP_MAX_ENTITIES = 300
_WHP_ENTITY_ID = re.compile(r"^(?:light|fan)\.[a-z0-9_]+$")
_WHP_COLOR_ATTRS = {"hs_color": 2, "xy_color": 2, "rgb_color": 3, "rgbw_color": 4, "rgbww_color": 5}
_WHP_COLOR_MODES = frozenset({"onoff", "brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white"})


def _whp_number(v: Any) -> float | None:
    """A real finite number, or None. bool is an int subclass — refused."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _sanitize_whole_house_entity(eid: Any, raw: Any) -> dict[str, Any] | None:
    """One entity's saved state in scene.apply shape, or None to drop it.
    Only "on"/"off" are storable — an unavailable/unknown device at capture
    time has no state worth restoring."""
    if not isinstance(eid, str) or not _WHP_ENTITY_ID.match(eid) or not isinstance(raw, dict):
        return None
    state = raw.get("state")
    if state not in ("on", "off"):
        return None
    if state == "off":
        return {"state": "off"}
    out: dict[str, Any] = {"state": "on"}
    if eid.startswith("light."):
        b = _whp_number(raw.get("brightness"))
        if b is not None:
            out["brightness"] = max(1, min(255, int(round(b))))
        mode = raw.get("color_mode")
        if isinstance(mode, str) and mode in _WHP_COLOR_MODES:
            out["color_mode"] = mode
        k = _whp_number(raw.get("color_temp_kelvin"))
        if k is not None:
            out["color_temp_kelvin"] = max(1000, min(12000, int(round(k))))
        for attr, n in _WHP_COLOR_ATTRS.items():
            v = raw.get(attr)
            if isinstance(v, (list, tuple)) and len(v) == n:
                nums = [_whp_number(x) for x in v]
                if all(x is not None for x in nums):
                    out[attr] = [round(x, 4) for x in nums]
        eff = raw.get("effect")
        if isinstance(eff, str) and eff.strip():
            out["effect"] = eff.strip()[:100]
    else:  # fan.
        pct = _whp_number(raw.get("percentage"))
        if pct is not None:
            out["percentage"] = max(0, min(100, int(round(pct))))
        pm = raw.get("preset_mode")
        if isinstance(pm, str) and pm.strip():
            out["preset_mode"] = pm.strip()[:60]
        if isinstance(raw.get("oscillating"), bool):
            out["oscillating"] = raw["oscillating"]
        if raw.get("direction") in ("forward", "reverse"):
            out["direction"] = raw["direction"]
    return out


def _sanitize_whole_house_presets(presets_in: Any) -> list[dict[str, Any]]:
    """Same discipline as _sanitize_showcase_presets: malformed entries are
    dropped without rejecting the rest, names are capped at 60, and the cap
    keeps the NEWEST (the frontend appends a new preset last). A preset left
    with no storable entity at all is dropped — it could restore nothing."""
    out: list[dict[str, Any]] = []
    if not isinstance(presets_in, list):
        return out
    for p in presets_in[-_WHP_MAX_PRESETS:]:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()[:60]
        ents_in = p.get("entities")
        if not name or not isinstance(ents_in, dict):
            continue
        entities: dict[str, Any] = {}
        for eid, raw in ents_in.items():
            if len(entities) >= _WHP_MAX_ENTITIES:
                break
            clean = _sanitize_whole_house_entity(eid, raw)
            if clean is not None:
                entities[eid] = clean
        if not entities:
            continue
        created = _whp_number(p.get("created_at"))
        out.append({"name": name, "created_at": created if created and created > 0 else 0, "entities": entities})
    return out



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
        vol.Optional("whatsnew_seen_version"): str,           # version the what's-new card last reported
        vol.Optional("vendor_lookup_enabled"): bool,
        vol.Optional("room_change_delay_s"): vol.Coerce(float),
        vol.Optional("away_timeout_m"): vol.Coerce(float),
        vol.Optional("ref_power"): vol.Coerce(float),
        vol.Optional("path_loss_exp"): vol.Coerce(float),
        vol.Optional("kalman_q"): vol.Coerce(float),
        vol.Optional("kalman_r"): vol.Coerce(float),
        vol.Optional("assumed_device_height_m"): vol.Coerce(float),
        vol.Optional("fabric_origin_lat"): vol.Any(vol.Coerce(float), None),
        vol.Optional("fabric_origin_lon"): vol.Any(vol.Coerce(float), None),
        vol.Optional("fabric_bearing_deg"): vol.Coerce(float),
        vol.Optional("hidden_map_ids"): list,
        vol.Optional("locate_self_key"): str,
        vol.Optional("followed_addrs"): list,
        vol.Optional("health_reminder_enabled"): bool,
        vol.Optional("health_reminder_last_ts"): vol.Any(float, int, None),
        vol.Optional("maps_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_focus"): vol.Any(int, None),
        vol.Optional("overview_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_focus"): vol.Any(int, None),
        vol.Optional("overview_iso_zoom"): vol.Coerce(float),
        vol.Optional("lights_hidden"): list,
        vol.Optional("lights_showcase"): bool,
        vol.Optional("lights_hide_untouched"): bool,
        vol.Optional("lights_hide_device_codes"): bool,
        vol.Optional("lights_show_beacons"): bool,
        vol.Optional("lights_fit_rooms"): bool,
        vol.Optional("lights_isolux"): bool,
        vol.Optional("lights_automorph_enabled"): bool,
        vol.Optional("lights_automorph_room_pct"): vol.Coerce(int),
        vol.Optional("lights_automorph_hardness"): vol.Coerce(int),
        vol.Optional("lights_automorph_style"): str,
        vol.Optional("lights_automorph_subtlety"): vol.Coerce(int),
        vol.Optional("lights_showcase_theme"): str,
        vol.Optional("lights_showcase_presets"): list,
        vol.Optional("whole_house_presets"): list,
        vol.Optional("atlas_layout_v2"): bool,
        vol.Optional("vacation_mode_enabled"): bool,
        vol.Optional("vacation_mode_intensity"): vol.Coerce(int),
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
        vol.Optional("light_type_overrides"): dict,
        vol.Optional("door_opener_ids"): list,
        vol.Optional("beacon_auto_calibrate"): bool,
        vol.Optional("overview_persistent_pins"): bool,
        vol.Optional("overview_show_walls"): bool,
        vol.Optional("overview_show_outdoor"): bool,
        vol.Optional("overview_show_trails"): bool,
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
        vol.Optional("walk_to_identify_enabled"): bool,
        vol.Optional("radio_map_enabled"): bool,
        vol.Optional("distortion_map_enabled"): bool,
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
        if "whatsnew_seen_version" in msg:
            # A version string and nothing else. It is written by the panel from
            # its own build constant, so anything that is not shaped like one is
            # a bug or a probe; store an empty string rather than the input.
            _wn = str(msg.get("whatsnew_seen_version") or "").strip()
            payload["whatsnew_seen_version"] = _wn if re.fullmatch(r"\d+\.\d+\.\d+", _wn) else ""
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
        if "fabric_origin_lat" in msg:
            _lat = msg["fabric_origin_lat"]
            payload["fabric_origin_lat"] = None if _lat is None else max(-90.0, min(90.0, float(_lat)))
        if "fabric_origin_lon" in msg:
            _lon = msg["fabric_origin_lon"]
            payload["fabric_origin_lon"] = None if _lon is None else max(-180.0, min(180.0, float(_lon)))
        if "fabric_bearing_deg" in msg:
            payload["fabric_bearing_deg"] = float(msg["fabric_bearing_deg"]) % 360.0
        if "hidden_map_ids" in msg:
            ids = msg["hidden_map_ids"]
            payload["hidden_map_ids"] = [str(x) for x in ids if isinstance(x, str)] if isinstance(ids, list) else []
        if "locate_self_key" in msg:
            # Locate is a PadSpan Pro feature; same gate as forensics_enabled
            # below — refusing the write here (not just hiding the tab) means
            # a free install can't get room-graph wayfinding by editing the
            # frontend, only by not persisting who "you" are.
            _lsk = str(msg.get("locate_self_key") or "")
            payload["locate_self_key"] = _lsk if _padspan_pro_active(hass) else ""
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
        if "overview_iso_zoom" in msg:
            payload["overview_iso_zoom"] = max(0.4, min(2.5, float(msg["overview_iso_zoom"])))
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
        if "lights_hide_device_codes" in msg:
            payload["lights_hide_device_codes"] = bool(msg["lights_hide_device_codes"])
        if "lights_show_beacons" in msg:
            payload["lights_show_beacons"] = bool(msg["lights_show_beacons"])
        if "lights_fit_rooms" in msg:
            payload["lights_fit_rooms"] = bool(msg["lights_fit_rooms"])
        if "atlas_layout_v2" in msg:
            payload["atlas_layout_v2"] = bool(msg["atlas_layout_v2"])
        if "vacation_mode_enabled" in msg:
            # Admin-only: unlike a saved Whole House Preset (a one-shot,
            # user-initiated apply), this autonomously operates real lights
            # on a schedule while nobody may be home to notice something
            # wrong with it — a materially bigger lever than the rest of
            # this feature, same reasoning as telemetry_enabled/
            # espresense_companion_url above.
            _user = getattr(connection, "user", None)
            if _user is not None and getattr(_user, "is_admin", True) is False:
                connection.send_error(msg["id"], "unauthorized", "Only an administrator can change Vacation Mode")
                return
            payload["vacation_mode_enabled"] = bool(msg["vacation_mode_enabled"])
        if "vacation_mode_intensity" in msg:
            payload["vacation_mode_intensity"] = max(5, min(100, int(msg["vacation_mode_intensity"])))
        if "lights_isolux" in msg:
            payload["lights_isolux"] = bool(msg["lights_isolux"])
        if "lights_automorph_enabled" in msg:
            payload["lights_automorph_enabled"] = bool(msg["lights_automorph_enabled"])
        if "lights_automorph_room_pct" in msg:
            payload["lights_automorph_room_pct"] = max(0, min(100, int(msg["lights_automorph_room_pct"])))
        if "lights_automorph_hardness" in msg:
            payload["lights_automorph_hardness"] = max(-100, min(100, int(msg["lights_automorph_hardness"])))
        if "lights_automorph_style" in msg:
            payload["lights_automorph_style"] = _normalize_automorph_style(msg["lights_automorph_style"])
        if "lights_automorph_subtlety" in msg:
            payload["lights_automorph_subtlety"] = max(0, min(100, int(msg["lights_automorph_subtlety"])))
        if "lights_showcase_theme" in msg:
            payload["lights_showcase_theme"] = _normalize_showcase_theme(msg["lights_showcase_theme"])
        if "lights_showcase_presets" in msg:
            payload["lights_showcase_presets"] = _sanitize_showcase_presets(msg["lights_showcase_presets"])
        if "whole_house_presets" in msg:
            payload["whole_house_presets"] = _sanitize_whole_house_presets(msg["whole_house_presets"])
        if "light_shapes" in msg and isinstance(msg["light_shapes"], dict):
            # A non-dict is ignored, not stored as empty — same discipline
            # as every other dict-shaped setting here: a malformed payload
            # must never wipe out what's already saved.
            payload["light_shapes"] = _sanitize_light_shapes(msg["light_shapes"])
        if "light_type_overrides" in msg:
            # entity_id -> forced class (wled/partition/plain), same discipline
            # as light_shapes above: closed vocabulary, light.* keys only,
            # "auto" is expressed by omitting the entity. A Pro feature — the
            # frontend only offers the control at pro and ignores the stored
            # map below pro, but the storage itself is tier-blind like every
            # other setting (data survives a lapsed licence).
            raw = msg["light_type_overrides"]
            if isinstance(raw, dict):
                payload["light_type_overrides"] = {
                    str(k): str(v) for k, v in raw.items()
                    if str(v) in LIGHT_TYPE_OVERRIDE_KINDS and str(k).startswith("light.")
                }
        if "door_opener_ids" in msg:
            # A flat allowlist, not a classifier: cover./switch./button. cover
            # nearly every domain in the house (raw device relays especially
            # give no reliable hint they open a door rather than run a pump),
            # so — unlike light_type_overrides' closed vocabulary of forced
            # CLASSES — this is a closed vocabulary of DOMAINS only, and
            # membership itself is the entire signal: Garry, 2026-09-22,
            # confirming two real garage-door relays as the motivating case
            # ("Upper Garage Car Door"/"Upper Garage Truck Door", switch.*
            # with no device_class of their own to test against).
            raw = msg["door_opener_ids"]
            if isinstance(raw, list):
                payload["door_opener_ids"] = sorted({
                    str(eid) for eid in raw
                    if isinstance(eid, str) and eid.startswith(("cover.", "switch.", "button."))
                })
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
                    "overview_show_outdoor", "overview_show_trails",
                    "overview_2d_mode", "beacon_profiling_enabled",
                    "walk_to_identify_enabled",
                    "radio_map_enabled", "distortion_map_enabled",
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
            # Admin-only (Phase 2i security audit, 2026-09-19): this URL is
            # later fetched server-side, verbatim, by the admin-only
            # espresense_companion_import command — a non-admin account
            # staging an arbitrary host here (internal, a cloud metadata
            # address) and waiting for an admin to click Import was the
            # actual attack shape found. Same gate as telemetry_enabled above.
            _user = getattr(connection, "user", None)
            if _user is not None and getattr(_user, "is_admin", True) is False:
                connection.send_error(msg["id"], "unauthorized", "Only an administrator can change the ESPresense Companion URL")
                return
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
        # occupancy_multiplier/occupancy_dwell_min appear to be unreachable
        # as written: unlike occupancy_hybrid_enabled/occupancy_cluster_threshold
        # just below, neither key is declared in this handler's
        # @websocket_command vol.Schema above, and nothing in the frontend
        # (grepped the whole www/ tree) ever sends either one — only
        # ws_fabric.py reads occupancy_multiplier back out, always via
        # `.get(..., 1.5)`, i.e. always the default. Left as-is (no
        # behavior change in scope here); worth confirming whether these
        # are dead legacy code or a still-planned control missing its
        # schema entry and its frontend UI.
        if "occupancy_multiplier" in msg:
            payload["occupancy_multiplier"] = max(0.5, min(10.0, float(msg["occupancy_multiplier"])))
        if "occupancy_dwell_min" in msg:
            payload["occupancy_dwell_min"] = max(0.0, min(60.0, float(msg["occupancy_dwell_min"])))
        if "occupancy_cluster_threshold" in msg:
            payload["occupancy_cluster_threshold"] = max(2.0, min(30.0, float(msg["occupancy_cluster_threshold"])))
        if "occupancy_hybrid_enabled" in msg:
            payload["occupancy_hybrid_enabled"] = bool(msg["occupancy_hybrid_enabled"])
        if "padspan_automations" in msg:
            # Validate and sanitize each rule. Security-relevant, not just
            # tidy input: presence_coordinator.py executes these unattended
            # on a BLE arrive/depart trigger via
            # hass.services.async_call(domain-from-entity_id, action, ...)
            # with no allowlist of its own — found in the Phase 2i security
            # audit, 2026-09-19. Before this, ANY domain/service pair a
            # client stored would fire (lock.unlock, alarm_control_panel.
            # alarm_disarm, ...), and this command has no require_admin, so
            # any signed-in non-admin HA account (the padspan-ha panel is
            # itself require_admin=False) could wire a lock or an alarm
            # panel to a BLE presence trigger with zero human confirmation.
            # The UI (settings.js) has only ever offered turn_on/turn_off
            # against light./switch./scene./script. entities — this is the
            # SAME allowlist, enforced server-side rather than trusted from
            # the client that's supposed to be the only one using it.
            _clean_rules = []
            for r in (msg["padspan_automations"] or []):
                if not isinstance(r, dict):
                    continue
                _action = str(r.get("action", ""))[:20]
                _eid = str(r.get("entity_id", ""))[:120]
                _domain = _eid.split(".", 1)[0] if "." in _eid else ""
                if _action not in ("turn_on", "turn_off") or _domain not in (
                    "light", "switch", "scene", "script"
                ):
                    continue
                _clean_rules.append({
                    "id": str(r.get("id", "")),
                    "trigger": str(r.get("trigger", ""))[:10],
                    "device_key": str(r.get("device_key", "")),
                    "device_label": str(r.get("device_label", ""))[:80],
                    "action": _action,
                    "entity_id": _eid,
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
