"""What the settings command (padspan_ha/settings_set) does with each key.

Used by tests/test_golden_settings.py. For every key the command's schema
accepts there is a row of values here (VALUES): ones the key is meant to
take. To those are added, by the kind of value the schema reads the key as,
ones it is not meant to take (far out of range, not a number, an unknown
word, junk in a list, the wrong type). Each value is sent alone, as Home
Assistant would send it:

    the message goes through the command's own schema first (Home Assistant
    refuses a message the schema refuses, and hands the command the values
    the schema converted);
    then the command runs against a new install's settings (a few rows start
    from other settings, named in the row), as an administrator.

Each key's first value is also sent as a user who is not an administrator,
and again with Enhanced security on. A few messages carry several keys.

What is written down for every case: whether the schema took it, the error
the command sent (code and text), whether it answered, what it wrote to the
settings store, the key's value afterwards, and what else it set going (the
tasks it started, the counters it bumped, the entities it enabled or
disabled, and so on), in the order it did them.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
from contextlib import ExitStack, contextmanager
from types import SimpleNamespace
from typing import Any, Iterator
from unittest.mock import MagicMock, patch

import voluptuous as vol

from custom_components.padspan_ha import guest_tags, perf_sampler, vacation_mode
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.random_forest import RandomForestLocator
from custom_components.padspan_ha.const import (
    DATA_CALIBRATION, DATA_ESPRESENSE_MQTT, DATA_OBJECTS, DATA_SETTINGS, DOMAIN,
)
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS, SettingsStore, licence_key_hash
from custom_components.padspan_ha.tasmota_ble import DATA_TASMOTA_BLE
from custom_components.padspan_ha.ws_common import _DATA_SNAPSHOT_CACHE

NOW = 1_790_000_000.0          # the clock every case runs at
COMMAND = "padspan_ha/settings_set"
SEVERAL = "(several keys)"

BOOL = [("on", True), ("off", False)]
_PHONE, _TAG = "C0:FF:EE:00:00:01", "C0:FF:EE:00:00:02"
_IBEACON = "ibeacon:0a1b2c3d-0000-4000-8000-00000000cafe:1:2"


def one(value: Any) -> list[tuple[str, Any]]:
    return [("as meant", value)]


# ── A row for every key: the values it is meant to take ──────────────────────
VALUES: dict[str, list[tuple[str, Any]]] = {
    "data_mode": one("live"),
    "cpu_mode": one("single"),
    "update_check_enabled": BOOL,
    "telemetry_enabled": BOOL,
    "telemetry_asked": BOOL,
    "telemetry_heard": one("reddit"),
    "telemetry_heard_ask": one("done"),
    "trial_nudge_done": BOOL,
    "tester_nudge_done": BOOL,
    "launch_card_done": BOOL,
    "lifetime_card_done": BOOL,
    "house3d_free_card_done": BOOL,
    "whatsnew_seen_version": one("0.38.268"),
    "room_change_delay_s": one(45),
    "away_timeout_m": one(10),
    "thing_away_timeout_h": one(6),
    "ref_power": one(-65.5),
    "path_loss_exp": one(2.7),
    "kalman_q": one(0.3),
    "kalman_r": one(12),
    "hold_last_room_s": one(90),
    "room_reason_attribute": BOOL,
    "positioning_pick_better": BOOL,
    "positioning_unsure": BOOL,
    "positioning_sensor_fusion": BOOL,
    "calibration_room_walk": BOOL,
    "assumed_device_height_m": one(1.2),
    "fabric_origin_lat": one(50.0),
    "fabric_origin_lon": one(-125.0),
    "fabric_bearing_deg": one(370.5),
    "hidden_map_ids": one(["map_1", "map_2"]),
    "locate_self_key": one(_PHONE),
    "followed_addrs": one([_PHONE.lower(), _IBEACON + ":AA:BB:CC:DD:EE:FF", "device_tracker.phone"]),
    "health_reminder_enabled": BOOL,
    "health_reminder_last_ts": one(1_789_999_000.5),
    "maps_iso_floor_gap": one(200),
    "maps_iso_horiz_gap": one(-40),
    "maps_iso_focus": one(2),
    "overview_iso_floor_gap": one(120),
    "overview_iso_horiz_gap": one(30),
    "overview_iso_focus": one(1),
    "overview_iso_zoom": one(1.3),
    "lights_hidden": one(["light.kitchen"]),
    "atlas_emergency_button": BOOL,
    "atlas_live_colours": BOOL,
    "overview_atlas": BOOL,
    "emergency_entities": one(["light.hall", " switch.siren ", "lock.front", "light.hall"]),
    "atlas_alert_pulse": BOOL,
    "emergency_notify": BOOL,
    "atlas_heatmap_enabled": BOOL,
    "atlas_audio_enabled": BOOL,
    "atlas_weather_enabled": BOOL,
    "atlas_weather_rain_entity": one("binary_sensor.rain"),
    "atlas_weather_condition_entity": one("weather.home"),
    "atlas_weather_warning_entity": one("sensor.weather_alerts"),
    "atlas_weather_strength": one(1.2),
    "wall_screen_in": one(55),
    "wall_distance_m": one(3),
    "wall_text_arcmin": one(24),
    "wall_night_dim": one(0.4),
    "wall_pixel_shift": BOOL,
    "wall_floor_cycle_s": one(45),
    "wall_fully": BOOL,
    "atlas_3d_enabled": BOOL,
    "atlas_3d_quality": one("LOW"),
    "atlas_3d_people": BOOL,
    "atlas_3d_tags": BOOL,
    "atlas_3d_ai_task_entity": one("ai_task.main"),
    "atlas_3d_ai_task_backup_entity": one("ai_task.backup"),
    "ai_photos_enabled": BOOL,
    "ai_credit_month_usd": one(25.5),
    "ai_credit_warn_pct": one(75),
    "ai_stairs_enabled": BOOL,
    "ai_plans_enabled": BOOL,
    "ai_plan_build_enabled": BOOL,
    "ai_map_wizard": one({"dismissed": True, "scale_ok": ["map_1"], "snoozes": 2, "not_a_key": 1}),
    "atlas_3d_library": BOOL,
    "atlas_3d_weather": BOOL,
    "atlas_3d_showcase": BOOL,
    "atlas_3d_look": one("studio"),
    "atlas_3d_home_idle_s": one(300),
    "atlas_3d_carries": one({"person.alex": [_PHONE, "has a space", _PHONE], "light.kitchen": [_TAG]}),
    "atlas_3d_director": one([{"entity": "binary_sensor.front_door", "camera": "camera.porch"},
                              {"entity": "light.kitchen"}, {"entity": "event.doorbell", "camera": "light.hall"}]),
    "atlas_3d_director_people": one([{"key": "person.alex", "rooms": ["Kitchen", "Kitchen", ""]},
                                     {"key": "beacon:" + _TAG, "rooms": None}, {"key": "nobody"}]),
    "lights_showcase": BOOL,
    "lights_hide_untouched": BOOL,
    "lights_hide_device_codes": BOOL,
    "lights_show_beacons": BOOL,
    "lights_fit_rooms": BOOL,
    "lights_isolux": BOOL,
    "lights_automorph_enabled": BOOL,
    "lights_automorph_room_pct": one(40),
    "lights_automorph_hardness": one(-20),
    "lights_automorph_style": one("Geode"),
    "lights_automorph_subtlety": one(60),
    "lights_showcase_theme": one("hygge"),
    "lights_showcase_presets": one([
        {"name": "Evening", "values": {"lights_showcase": True, "lights_showcase_theme": "hygge",
                                       "lights_automorph_room_pct": 40, "lights_automorph_style": "geode",
                                       "overview_iso_zoom": 1.5, "overview_iso_focus": None}},
        {"name": "", "values": {}}, {"name": "No values"}]),
    "whole_house_presets": one([
        {"name": "Movie", "created_at": 1_789_000_000, "entities": {
            "light.lounge": {"state": "on", "brightness": 120.4, "color_mode": "hs", "hs_color": [30, 80]},
            "fan.loft": {"state": "on", "percentage": 50, "direction": "forward"},
            "lock.front": {"state": "on"}, "light.hall": {"state": "off"}}},
        {"name": "Nothing to restore", "entities": {"lock.front": {"state": "on"}}}]),
    "atlas_layout_v2": BOOL,
    "traceback_house_focus": one(2),
    "vacation_mode_enabled": BOOL,
    "vacation_mode_intensity": one(70),
    "vacation_mode_dark_only": BOOL,
    "vacation_mode_dark_offset_min": one(30),
    "vacation_mode_end_at": one(NOW + 7 * 86400),
    "vacation_mode_pause_home": BOOL,
    "vacation_mode_bedtime": one("23:30"),
    "vacation_mode_max_on_min": one(120),
    "vacation_mode_max_lights": one(6),
    "vacation_mode_anchors": one(["light.porch", "switch.pump", "light.porch", "light.hall"]),
    "vacation_mode_source": one("month"),
    "adaptive_learning_enabled": BOOL,
    "adaptive_floor_detection": BOOL,
    "advanced_extra_tabs": one(["devices", "qa", "not_a_tab"]),
    "ha_entity_tracker_enabled": BOOL,
    "ha_entity_area_enabled": BOOL,
    "ha_entity_distance_enabled": BOOL,
    "ha_entity_scanner_distance_enabled": BOOL,
    "ha_entity_occupancy_enabled": BOOL,
    "subzones_enabled": BOOL,
    "screens_remote_enabled": BOOL,
    "mqtt_publish_enabled": BOOL,
    "espresense_mqtt_enabled": BOOL,
    "espresense_topic_prefix": one("/home/espresense#/"),
    "tasmota_ble_enabled": BOOL,
    "espresense_room_map": one({"kitchen": "Kitchen", "hall": 5}),
    "espresense_companion_url": one("http://espresense.local:8267/"),
    "aggressive_ble_reseed": BOOL,
    "presence_poll_interval_s": one(10),
    "ble_reseed_interval_s": one(15),
    "lights_panel_enabled": BOOL,
    "bermuda_ignore": BOOL,
    "tags_room_events_enabled": BOOL,
    "tags_nfc_identify_enabled": BOOL,
    "tags_phone_autolink_enabled": BOOL,
    "quiet_mode": BOOL,
    "units_feet": BOOL,
    "light_theme": BOOL,
    "day_theme": BOOL,
    "theme_palette": one("Ocean"),
    "theme_follow_sun": BOOL,
    "ui_skin": one("2025"),
    "light_shapes": one({"light.kitchen": "bar", "fan.loft": "fan", "light.hall": "not_a_shape"}),
    "light_type_overrides": one({"light.strip": "wled", "switch.pump": "plain", "light.hall": "not_a_kind"}),
    "door_opener_ids": one(["switch.garage_relay", "cover.gate", "lock.front", "script.open_gate"]),
    "door_composites": one([{"id": "c1", "script": "script.gate"}, {"no_id": 1}, "junk"]),
    "beacon_auto_calibrate": BOOL,
    "overview_persistent_pins": BOOL,
    "overview_show_walls": BOOL,
    "overview_show_outdoor": BOOL,
    "overview_show_trails": BOOL,
    "object_history_days": one(7),
    "scanner_offsets": one({"AA:00:00:00:00:01": 3, "AA:00:00:00:00:02": "-2.5"}),
    "excluded_scanners": one(["AA:00:00:00:00:02", "AA:00:00:00:00:01", " "]),
    "scanner_min_rssi": one({"AA:00:00:00:00:01": -85.4, "AA:00:00:00:00:02": "loud", "": -80}),
    "excluded_objects": one([" C0:FF:EE:00:00:07 ", "C0:FF:EE:00:00:07", ""]),
    "ingest_rules": one([{"match": {"name": "Tile*"}, "action": "drop"}, {"match": "Tile*"}, 5]),
    "overview_2d_mode": BOOL,
    "positioning_algorithm": one("RF"),
    "beacon_profiling_enabled": BOOL,
    "beacon_tune_disabled": one(["C0:FF:EE:00:00:04", 5]),
    "beacon_group_overrides": one({"C0:FF:EE:00:00:04": "group_a"}),
    "walk_to_identify_enabled": BOOL,
    "radio_map_enabled": BOOL,
    "distortion_map_enabled": BOOL,
    "roomplan_import_enabled": BOOL,
    "vacuum_import_enabled": BOOL,
    "phone_wizard_enabled": BOOL,
    "iphone_irk_guide": BOOL,
    "mac_rotation_bridging": BOOL,
    "apple_auto_classify": BOOL,
    "low_memory_mode": BOOL,
    "optimize_for_scale": BOOL,
    "guest_tags_enabled": BOOL,
    "guest_retention_days": one(30),
    "yesterday_home_enabled": BOOL,
    "yesterday_home_time": one("07:30"),
    "yesterday_home_target": one("notify.mobile_app_alex"),
    "yesterday_home_lines": one(["comings", "lights"]),
    "lights_follow_enabled": BOOL,
    "lights_follow_rooms": one({"Kitchen": {"lights": ["light.kitchen", "lock.front"], "off_delay_s": 90.4, "dark": "sun",
                                            "quiet": "22:00-07:00", "sensors": ["binary_sensor.kitchen_motion"]},
                                "Den": {"lights": []}, "Hall": "junk"}),
    "lights_follow_people": one({"Alex phone": False, "Guest tag 1": True, "Sam": "yes"}),
    "room_audio_matches": one({"great_room": ["media_player.c4_great_room", "media_player.denon_zone_2", "light.kitchen"],
                               "den": ["media_player.c4_great_room", "media_player.den_speaker"], "": ["media_player.x"], "hall": "junk"}),
    "room_audio_ha_speakers": BOOL,
    "enhanced_security": BOOL,
    "forensics_enabled": BOOL,
    "license_tier_override": one("Bright"),
    "bright_reveal_presence": BOOL,
    "forensics_retention_days": one(30),
    "rssi_capture_enabled": BOOL,
    "rssi_capture_retention_days": one(7),
    "ble_max_age_s": one(600),
    "occupancy_hybrid_enabled": BOOL,
    "occupancy_cluster_threshold": one(12),
    "occupancy_multiplier": one(2.5),
    "occupancy_dwell_min": one(5),
    "distance_stationary_devices": one(["C0:FF:EE:00:00:05"]),
    "onboarding_completed": BOOL,
    "accuracy_tips_hidden": one(["scale", "all", "not_a_tip"]),
    "setup_progress": one({"at": "rooms", "skipped": ["scale", "not_a_step"], "done": True}),
    "heatmap_gain": one(5),
    "heatmap_contrast": one(-3),
    "distortion_intensity": one(50),
    "heatmap_source": one(25),
    "padspan_automations": one([
        {"id": "r1", "trigger": "arrive", "device_key": _PHONE, "device_label": "Phone",
         "action": "turn_on", "entity_id": "light.hall", "enabled": True},
        {"action": "unlock", "entity_id": "lock.front"}, {"action": "turn_off", "entity_id": "scene.movie"}, "junk"]),
}

# ── Rows that start from other settings than a new install's ─────────────────
_LICENCE = "PSPAN-TEST-0000-0000"
_PRO = {"forensics_license_key": _LICENCE, "forensics_license_expires": ""}
_FREE_LICENCE = {**_PRO, "forensics_license_expires": "2099-01-01T00:00:00+00:00",
                 "report_locked_key": licence_key_hash(_LICENCE), "telemetry_enabled": True}
_ON_VACATION = {"vacation_mode_enabled": True, "vacation_mode_enabled_at": NOW - 3 * 86400}

# key -> (case, value, the settings it starts from)
FROM_OTHER_SETTINGS: dict[str, list[tuple[str, Any, dict[str, Any]]]] = {
    "data_mode": [("chosen during a new install's first steps", "sample",
                   {"onboarding": {"live_first": "pending"}})],
    "telemetry_enabled": [
        ("off, already on", False, {"telemetry_enabled": True}),
        ("off, with a free licence that keeps it on", False, _FREE_LICENCE),
        ("on, with a licence key", True, _PRO),
        ("on, the question already answered", True, {"telemetry_heard": "reddit"})],
    "locate_self_key": [("with PadSpan Pro", _PHONE, _PRO)],
    "forensics_enabled": [("on, with PadSpan Pro", True, _PRO)],
    "followed_addrs": [("one unfollowed", [_PHONE], {"followed_addrs": [_PHONE, _TAG]})],
    "lights_showcase": [
        ("on, a look already chosen", True, {"lights_showcase_seen": True}),
        ("off, already on", False, {"lights_showcase": True})],
    "vacation_mode_enabled": [
        ("off, during a vacation", False, _ON_VACATION),
        ("on, an end date already past", True, {"vacation_mode_end_at": NOW - 86400})],
    "vacation_mode_source": [("a routine learned before the choice existed", "last_week",
                              {"vacation_mode_pattern": {"mon": []}})],
    "vacation_mode_end_at": [("in the past", NOW - 86400, {}), ("more than a year away", NOW + 400 * 86400, {})],
    "vacation_mode_bedtime": [("not a bedtime", "12:00", {})],
    "atlas_3d_ai_task_entity": [("the backup's own", "ai_task.backup",
                                 {"atlas_3d_ai_task_backup_entity": "ai_task.backup"})],
    "atlas_3d_ai_task_backup_entity": [("the main one's own", "ai_task.main",
                                        {"atlas_3d_ai_task_entity": "ai_task.main"})],
    "ai_credit_warn_pct": [("not one of the choices", 60, {})],
    "ai_plan_build_enabled": [("off, already on", False, {"ai_plan_build_enabled": True})],
    "guest_retention_days": [("not one of the choices", 5, {})],
    "yesterday_home_enabled": [("on, before today's time", True, {"yesterday_home_time": "23:00"}),
                               ("off, already on", False, {"yesterday_home_enabled": True})],
    "yesterday_home_time": [("not a time", "7:30", {})],
    "yesterday_home_target": [("not a notification target", "script.unlock_door", {})],
    "object_history_days": [("not one of the choices", 3, {})],
    "tasmota_ble_enabled": [("on, already running", True, {"__running__": "tasmota"}),
                            ("off, while running", False, {"__running__": "tasmota"})],
}

# Several keys in one message: (case, the message's keys, who sends it, start).
SEVERAL_KEYS: list[tuple[str, dict[str, Any], str, dict[str, Any]]] = [
    ("a follow, then a refused Vacation Mode source",
     {"followed_addrs": [_PHONE], "vacation_mode_source": "next_week"}, "admin", {"followed_addrs": [_TAG]}),
    ("the usage report on, then a refused guest retention",
     {"telemetry_enabled": True, "guest_retention_days": 5}, "admin", {}),
    ("build from plans on, then a refused bedtime",
     {"ai_plan_build_enabled": True, "vacation_mode_bedtime": "99:99"}, "admin", {}),
    ("showcase on, then a refused end date",
     {"lights_showcase": True, "vacation_mode_end_at": NOW - 5}, "admin", {}),
    ("quiet mode, with a key only an administrator may change",
     {"quiet_mode": True, "espresense_companion_url": "http://espresense.local:8267"}, "user", {}),
    ("a look and a layout together",
     {"lights_showcase": True, "lights_showcase_theme": "aurora", "overview_iso_zoom": 2.0}, "user", {}),
    ("Vacation Mode on with its options",
     {"vacation_mode_enabled": True, "vacation_mode_source": "month", "vacation_mode_end_at": NOW + 86400,
      "vacation_mode_anchors": ["light.porch"]}, "admin", {}),
    ("nothing at all", {}, "user", {}),
]


# ── Values a key is not meant to take, by how the schema reads it ────────────
def _kind(validator: Any) -> str:
    if isinstance(validator, vol.All):
        return _kind(validator.validators[0])     # what it takes; the rest only limit it
    if getattr(validator, "padspan_expects", None) == "text":
        return "str"                              # ws_common.name_text and its kin: text, limited
    if isinstance(validator, vol.Coerce):
        return f"number ({validator.type.__name__})"
    if isinstance(validator, vol.Any):
        return "any of " + ", ".join(sorted(
            _kind(v) if v is not None else "nothing" for v in validator.validators))
    if isinstance(validator, type):
        return validator.__name__
    raise AssertionError(f"the settings schema reads a key in a way this test does not know: {validator!r}")


_NUMBERS = [("zero", 0), ("far too big", 1e12), ("far too small", -1e12), ("a fraction", 2.7),
            ("the text nan", "nan"), ("the text inf", "inf"), ("not a number", "abc")]
_NOTHING = [("nothing", None)]
_WORDS = [("an unknown word", "no such word"), ("empty text", ""), ("a number", 5)]
_LISTS = [("junk in it", [1, None, {"x": 1}, "  ", ["a"]]), ("empty", []), ("not a list", "abc")]
_DICTS = [("junk in it", {"": None, "a": [1], "b": {"c": 1}, "light.x": "x"}), ("empty", {}), ("not a dict", "abc")]
NOT_MEANT: dict[str, list[tuple[str, Any]]] = {
    "bool": [("not a yes or no", "yes")],
    "str": _WORDS,
    "list": _LISTS,
    "dict": _DICTS,
    "number (float)": _NUMBERS,
    "number (int)": _NUMBERS,
    "any of nothing, number (float)": _NUMBERS + _NOTHING,
    "any of float, int, nothing": _NUMBERS + _NOTHING,
    "any of int, nothing": _NUMBERS + _NOTHING,
    "any of nothing, str": _WORDS + _NOTHING,
    "any of float, int, nothing, str": _NUMBERS + _NOTHING,
    "any of dict, nothing": _DICTS + _NOTHING,
    "any of list, nothing": _LISTS + _NOTHING,
}


def schema_keys() -> dict[str, Any]:
    """The keys padspan_ha/settings_set accepts, and how its schema reads each."""
    return {str(getattr(k, "schema", k)): v for k, v in WS.ws_settings_set.ws_schema.items()
            if str(getattr(k, "schema", k)) != "type"}


def cases() -> list[dict[str, Any]]:
    """Every case, in the schema's own key order."""
    out: list[dict[str, Any]] = []
    for key, validator in schema_keys().items():
        rows = VALUES.get(key)
        if rows is None:
            continue        # test_every_key_the_command_accepts_has_a_row says so
        for name, value in rows:
            out.append({"key": key, "case": name, "as": "admin", "message": {key: value}})
        for name, value in NOT_MEANT[_kind(validator)]:
            out.append({"key": key, "case": "not meant: " + name, "as": "admin", "message": {key: value}})
        for name, value, start in FROM_OTHER_SETTINGS.get(key, []):
            out.append({"key": key, "case": name, "as": "admin", "message": {key: value}, "from": start})
        first = rows[0][1]
        out.append({"key": key, "case": rows[0][0], "as": "user", "message": {key: first}})
        out.append({"key": key, "case": rows[0][0], "as": "user", "message": {key: first},
                    "from": {"enhanced_security": True}})
    for name, message, who, start in SEVERAL_KEYS:
        out.append({"key": SEVERAL, "case": name, "as": who, "message": message, **({"from": start} if start else {})})
    return out


# ── The stand-in house a case runs in ────────────────────────────────────────

class _Entry:
    def __init__(self, entity_id: str, unique_id: str, platform: str = DOMAIN, disabled_by: Any = None) -> None:
        self.entity_id, self.unique_id, self.platform, self.disabled_by = entity_id, unique_id, platform, disabled_by


def _calibration(hass: Any) -> Any:
    """The real calibration store, with no points: what a settings change
    makes it do (train the Random Forest in the background, or only mark it
    out of date) is decided by its own code and shows as a background task."""
    cal = CalibrationStore.__new__(CalibrationStore)
    cal.hass, cal.data, cal._rf = hass, {"points": [], "model": {}}, RandomForestLocator()
    return cal


class EspresenseStandIn:
    def async_stop(self) -> Any:
        async def espresense_listener_stopped() -> None:
            return None
        return espresense_listener_stopped()


class TasmotaStandIn:
    def async_stop(self) -> Any:
        async def tasmota_listener_stopped() -> None:
            return None
        return tasmota_listener_stopped()


def _coro_name(coro: Any) -> str:
    """A coroutine handed to Home Assistant to run: the function's own name
    (not where in the code it is defined) and its plain arguments."""
    args = {k: v for k, v in inspect.getcoroutinelocals(coro).items()
            if isinstance(v, (str, int, float, bool)) or v is None}
    coro.close()
    return coro.__name__ + ("(" + ", ".join(f"{k}={v!r}" for k, v in args.items()) + ")" if args else "")


def _house(start: dict[str, Any], admin: bool, effects: list[str]) -> tuple[Any, Any, Any, Any]:
    start = dict(start)
    running = start.pop("__running__", None)
    st = SettingsStore.__new__(SettingsStore)
    st.data = {**copy.deepcopy(DEFAULT_SETTINGS), **copy.deepcopy(start)}
    written: list[dict[str, Any]] = []
    real_set = st.async_set

    async def _set(**kw):
        written.append(copy.deepcopy(kw))
        return await real_set(**kw)

    async def _save(_data):
        effects.append("settings saved to disk")

    st.async_set = _set
    st.store = SimpleNamespace(async_save=_save)

    hass = MagicMock()
    st.hass = hass
    hass.config = SimpleNamespace(country="CA", latitude=50.0, longitude=-125.0)
    hass.auth.async_get_refresh_token = lambda _tid: SimpleNamespace(client_id="https://example.invalid/app",
                                                                     client_name="Test browser")
    hass.async_create_task = lambda coro, *a, **kw: effects.append("task started: " + _coro_name(coro))

    def _background(coro, *a, **kw):
        effects.append("background task started: " + _coro_name(coro))
        return SimpleNamespace(done=lambda: False)     # still running, as far as the command can tell
    hass.async_create_background_task = _background

    async def _label(key, label):
        effects.append(f"object labelled: {key} = {label!r}")

    hass.data = {DOMAIN: {
        DATA_SETTINGS: st,
        "presence_coordinator": SimpleNamespace(
            clear_object_state=lambda key: effects.append(f"object state cleared: {key}")),
        DATA_OBJECTS: SimpleNamespace(get=lambda key: None, async_set=_label),
        DATA_CALIBRATION: _calibration(hass),
        DATA_ESPRESENSE_MQTT: EspresenseStandIn(),
        _DATA_SNAPSHOT_CACHE: {"a": "cached snapshot"},
    }}
    if running == "tasmota":
        hass.data[DOMAIN][DATA_TASMOTA_BLE] = TasmotaStandIn()

    sent: dict[str, Any] = {"error": None, "answered": False}
    conn = SimpleNamespace(
        user=SimpleNamespace(is_admin=admin, name="Test admin" if admin else "Test user", id="user-1"),
        refresh_token_id="token-1",
        send_error=lambda _id, code, text=None, **kw: sent.update(error=[code, kw.get("message", text)]),
        send_result=lambda _id, _payload: sent.update(answered=True),
    )
    return hass, conn, st, (written, sent)


@contextmanager
def _watched(box: dict[str, list[str]]) -> Iterator[None]:
    """Everything the command sets going outside the settings store notes
    itself in box["effects"] and does nothing else."""

    def note(text: str, result: Any = None):
        def _f(*args, **kw):
            plain = [a for a in args[1:] if isinstance(a, (str, int, float, bool))]
            box["effects"].append(text + (": " + ", ".join(str(a) for a in plain) if plain else ""))
            return result
        return _f

    def note_async(text: str):
        async def _f(*args, **kw):
            box["effects"].append(text)
        return _f

    registry = SimpleNamespace(entities={})

    def _update(entity_id, **kw):
        box["effects"].append(f"entity {entity_id}: disabled_by={kw.get('disabled_by')!r}")

    def _registry(_hass):
        registry.entities = {e.entity_id: e for e in (
            _Entry("device_tracker.phone", "c0ffee__tracker"),
            _Entry("sensor.phone_area", "c0ffee__area", disabled_by="integration"),
            _Entry("sensor.phone_distance", "c0ffee__distance"),
            _Entry("sensor.phone_distance_kitchen", "c0ffee__dist__kitchen__distance", disabled_by="integration"),
            _Entry("sensor.someone_elses", "x__tracker", platform="another"),
            _Entry("sensor.phone_area_user_disabled", "c0ffee2__area", disabled_by="user"),
        )}
        registry.async_update_entity = _update
        return registry

    fake_registry = SimpleNamespace(async_get=_registry,
                                    RegistryEntryDisabler=SimpleNamespace(INTEGRATION="integration"))
    real_invalidate = WS._invalidate_snapshot_cache

    def _invalidate(hass):
        box["effects"].append("snapshot cache dropped")
        return real_invalidate(hass)

    live = SimpleNamespace(get_snapshot=lambda **kw: {"advertisements": [
        {"address": _PHONE, "name": "Tile"}, {"address": _TAG, "name": ""}]})

    with ExitStack() as stack:
        for target, name, stand_in in (
            (T, "bump", note("report counter")),
            (T, "ensure_install_id", note_async("report: install id made sure of")),
            (T, "reset_windows", note("report: usage and error windows started again")),
            (perf_sampler, "async_runs_opted_in", note_async("report: run log kept")),
            (perf_sampler, "async_runs_opted_out", note_async("report: run log removed")),
            (vacation_mode, "announce", note("Vacation Mode announced")),
            (vacation_mode, "refresh_status", note("Vacation Mode status entity re-read")),
            (guest_tags, "refresh", note("guest tags re-read")),
            (WS, "entity_registry", fake_registry),
            (WS, "_invalidate_snapshot_cache", _invalidate),
            (WS, "get_bluetooth_live", lambda _hass: live),
        ):
            stack.enter_context(patch.object(target, name, stand_in))
        stack.enter_context(patch("custom_components.padspan_ha.presence_keepalive",
                                  note("Bright presence polling")))
        stack.enter_context(patch("time.time", lambda: NOW))
        yield


def _through_schema(message: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    """The message as Home Assistant hands it to the command: validated and
    converted by the command's schema, or refused."""
    schema = vol.Schema({vol.Required("id"): int, **WS.ws_settings_set.ws_schema})
    try:
        return True, schema({"id": 1, "type": COMMAND, **copy.deepcopy(message)})
    except vol.Invalid:
        return False, {}


_FROM_A_SET = ("object labelled: ", "object state cleared: ")


def _in_a_fixed_order(effects: list[str]) -> list[str]:
    """The effects in the order they happened, except that the objects
    followed and unfollowed in one message are handled in the order a Python
    set gives them, which changes from run to run: each run of those is
    sorted."""
    out: list[str] = []
    i = 0
    while i < len(effects):
        prefix = next((p for p in _FROM_A_SET if effects[i].startswith(p)), None)
        j = i + 1
        while prefix and j < len(effects) and effects[j].startswith(prefix):
            j += 1
        out.extend(sorted(effects[i:j]))
        i = j
    return out


def run() -> list[dict[str, Any]]:
    """Run every case; one record each."""
    records: list[dict[str, Any]] = []
    loop = asyncio.new_event_loop()
    box: dict[str, list[str]] = {"effects": []}
    try:
        with _watched(box):
            for case in cases():
                box["effects"] = effects = []
                hass, conn, st, (written, sent) = _house(case.get("from", {}), case["as"] == "admin", effects)
                rec: dict[str, Any] = {k: case[k] for k in ("key", "case", "as")}
                if "from" in case:
                    rec["from"] = case["from"]
                rec["sent"] = case["message"]
                ok, msg = _through_schema(case["message"])
                rec["schema"] = "accepted" if ok else "refused"
                if ok:
                    got = {k: v for k, v in msg.items() if k not in ("id", "type")}
                    if repr(got) != repr(case["message"]):
                        rec["received"] = got
                    try:
                        loop.run_until_complete(WS.ws_settings_set(hass, conn, msg))
                        rec["raised"] = None
                    except Exception as err:  # noqa: BLE001 - what it raised is the record
                        rec["raised"] = type(err).__name__
                    rec["error"] = sent["error"]
                    rec["answered"] = sent["answered"]
                    rec["written"] = written
                    if case["key"] != SEVERAL:
                        rec["after"] = st.data.get(case["key"], "<no such setting>")
                    rec["effects"] = _in_a_fixed_order(effects)
                    other = [str(c[0]) for c in hass.mock_calls]
                    if other:
                        rec["home_assistant_calls"] = other
                records.append(rec)
    finally:
        loop.close()
    return records


def counts(records: list[dict[str, Any]]) -> dict[str, int]:
    return {"keys": len({r["key"] for r in records if r["key"] != SEVERAL}),
            "cases": len(records),
            "refused_by_schema": sum(1 for r in records if r["schema"] == "refused"),
            "errors_sent": sum(1 for r in records if r.get("error")),
            "raised": sum(1 for r in records if r.get("raised"))}


def label(record: dict[str, Any]) -> str:
    return f'(key "{record["key"]}", case "{record["case"]}", as {record["as"]})'
