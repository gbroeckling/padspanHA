# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Errors PadSpan handles quietly, counted.

Much of PadSpan is written so that one part failing never stops the rest: the
part is wrapped in `try`, and its `except Exception` carries on without the
value. That keeps the house running, and it also hides the failure: nothing is
logged, so nobody can tell that a handler is firing.

A quiet handler says so here, in one line:

    except Exception:
        _quiet_error("snapshot:areas")
        pass

`note` (imported as `_quiet_error`) counts by site and keeps the last error's
type and text for that site, with the time (replaced at most once a second,
so a handler firing in a loop costs a count each time and little more). All of it lives in memory only and
starts again with Home Assistant. Nothing is written to disk and nothing is
logged.

Where the handler can run many times a second (the poll, the smoothing, the
Bluetooth advertisement callback) the line is the count alone, a dict
increment, and no error is kept:

    except Exception:
        _QUIET_COUNTS["presence:poll_interval"] += 1

A site is a short fixed name written in the source: the module and a word or
two, joined by a colon. It is never built from data. (A colon, not a dot: the
usage report refuses anything shaped like an entity id.) Every name is listed
in SITES at the foot of this file, and tests/test_quiet_errors.py holds that
list and the source to each other. That list is what lets the opt-in usage
report carry the counts: site names and numbers, nothing else. The error text
can name things in the house, so it is shown to an administrator in the
panel's Diagnostics and goes nowhere else.

This module imports nothing from PadSpan or Home Assistant, so any module can
import it.
"""
from __future__ import annotations

import sys
import time
from collections import defaultdict
from typing import Any

MAX_SITES = 1024                 # sites `note` counts at most; any past that go under OVERFLOW
TEXT_MAX = 200                   # characters kept of an error's text
KEEP_EVERY_S = 1.0               # a site's kept error is replaced at most this often
OVERFLOW = "quiet_errors:other"  # not expected: sites are fixed names, far fewer than MAX_SITES
REPORT_SITES = 20                # sites the usage report carries at most, busiest first
REPORT_MORE = "more"             # the report's one other key: how many sites were left out

# site -> how many times its handler ran since Home Assistant started.
COUNTS: defaultdict[str, int] = defaultdict(int)
# site -> (time.time(), the error's type name, its text cut to TEXT_MAX).
_LAST: dict[str, tuple[float, str, str]] = {}
# site -> the count the last usage report took, so each report says what is new;
# and what that was before it, for a report that then fails to send.
_REPORTED: dict[str, int] = {}
_REPORTED_BEFORE: dict[str, int] = {}


def note(site: str, err: BaseException | None = None) -> None:
    """Count one quietly handled error at `site` and keep it as the site's last.

    Called from inside an `except` block; with no `err` given it takes the
    error being handled. Every call is counted; the kept error is replaced at
    most once every KEEP_EVERY_S. It never raises.
    """
    try:
        if site not in COUNTS and len(COUNTS) >= MAX_SITES:
            site = OVERFLOW
        COUNTS[site] += 1
        now = time.time()
        last = _LAST.get(site)
        if last is not None and 0 <= now - last[0] < KEEP_EVERY_S:
            return      # a handler firing in a loop: every one is counted, one error a second is kept
        if err is None:
            err = sys.exc_info()[1]
        _LAST[site] = (now, type(err).__name__, str(err)[:TEXT_MAX])
    except Exception:  # noqa: BLE001 - counting an error must never add one
        pass


def listing() -> list[dict[str, Any]]:
    """Every site that has fired, busiest first, for an administrator's eyes:
    site, count, and the last error's type, text and time where one was kept
    (a count-only site has none)."""
    out = []
    for site, n in sorted(list(COUNTS.items()), key=lambda kv: (-kv[1], kv[0])):
        if n <= 0:
            continue
        at, kind, text = _LAST.get(site, (None, "", ""))
        out.append({"site": site, "count": n, "type": kind, "text": text, "at": at})
    return out


def report_counts(consume: bool = False) -> dict[str, int]:
    """The usage report's section: site -> count since the last report taken.

    Site names from SITES and whole numbers, nothing else: at most REPORT_SITES
    sites, busiest first, and REPORT_MORE with how many were left out. With
    `consume` the next report starts from here (a preview leaves it alone).
    """
    new = ((s, n - _REPORTED.get(s, 0)) for s, n in dict(COUNTS).items() if s in SITES)
    fired = sorted(((s, n) for s, n in new if n > 0), key=lambda kv: (-kv[1], kv[0]))
    out = dict(fired[:REPORT_SITES])
    if len(fired) > REPORT_SITES:
        out[REPORT_MORE] = len(fired) - REPORT_SITES
    if consume:
        mark_reported()
    return out


def mark_reported() -> None:
    """A report took the counts: the next one starts from here."""
    _REPORTED_BEFORE.clear()
    _REPORTED_BEFORE.update(_REPORTED)
    _REPORTED.clear()
    _REPORTED.update(dict(COUNTS))


def unmark_reported() -> None:
    """That report was not sent after all: its counts go with the next one."""
    _REPORTED.clear()
    _REPORTED.update(_REPORTED_BEFORE)


def check_report(section: Any) -> None:
    """Refuse a report section that is anything but site names and counts."""
    if not isinstance(section, dict) or len(section) > REPORT_SITES + 1:
        raise ValueError("health.quiet_errors is not a short dict")
    for k, v in section.items():
        if k not in SITES and k != REPORT_MORE:
            raise ValueError(f"unexpected key in health.quiet_errors: {str(k)[:32]}")
        if isinstance(v, bool) or not isinstance(v, int) or v < 0:
            raise ValueError(f"not a count in health.quiet_errors.{str(k)[:32]}")


def reset() -> None:
    """Forget everything (tests)."""
    COUNTS.clear()
    _LAST.clear()
    _REPORTED.clear()
    _REPORTED_BEFORE.clear()


# Every site in the source, one per line, in order. Add a handler's name here
# when you add its line (tests/test_quiet_errors.py says which is missing).
SITES: frozenset[str] = frozenset("""
screens:send
presence:heldout_job_rooms
adaptive_store:summary
ai_usage:bump
ai_usage:check_warning
ai_usage:load
ai_usage:note_read
ai_usage:prompt_chars
ai_usage:refused
ai_usage:save
ai_usage:unusable
ai_wizard:create_area
ai_wizard:ensure_area_areas
ai_wizard:ensure_area_floors
ai_wizard:ha_areas
area_rename:after
area_rename:lookup
binary_sensor:setup_entry
ble:address_type_of
ble:adv_record_manufacturer
ble:adv_record_service_data
ble:coerce_source
ble:esphome_version_entries
ble:esphome_version_manager
ble:load_public
ble:on_adv
ble:rate_health_tick
ble:record_manufacturer
ble:record_service_data
ble:register_cb
ble:save_public
ble:save_public_fallback
ble:scan_mode_flips
ble:scanning_mode
ble:seed_from_discovered
ble:seed_last_info
ble:seed_scanner_iteration
ble:setup_callbacks
ble:setup_public_store
ble:snapshot
ble:snapshot_scanner_list
ble:snapshot_settings
ble:unload
bright_import:import
calibration_store:active_algorithm
calibration_store:excluded_sources
calibration_store:fit_path_loss
calibration_store:resolve_floor_id
calibration_store:rf_background
calibration_store:room_floor
capture_store:build_header
capture_store:retention_days
device_tracker:guest_attrs
dwell_analytics:compute_dwell_stats
emergency_test:automations_since
entity_identity:kept_device_info
entity_identity:pick_uid_key
espresense_mqtt:on_device_message
espresense_mqtt:on_room_message
espresense_mqtt:stop
flood_latch:notify
flood_latch:schedule_end
flood_latch:stop_flood_latch
forensics_store:stop_forensics
forensics_store:tick
guest_tags:bump
guest_tags:fire
guest_tags:notify
guest_tags:refresh
heldout:room_of
house3d_heights:move_heights
licence_homes:machine_id
maps_store:crop_png
maps_store:decode_png_to_rgba
maps_store:delete_map
maps_store:extend_png
maps_store:unfilter_png
maps_store:update_map
model_store:put_map_transform
model_store:reanchor_map
model_store:sync_floors
model_store:sync_from_snapshot
onboarding:note_snapshot
panel:remove_panels
panel:setup_panel
panel:static_path_async
panel:static_path_config
panel:static_path_legacy
perf_sampler:begin
perf_sampler:cpu_count
perf_sampler:deep_bytes
perf_sampler:detect
perf_sampler:hw_hassio
perf_sampler:hw_hassio_info
perf_sampler:hw_static
perf_sampler:hw_system_info
perf_sampler:maybe_detect_hw
perf_sampler:note_snapshot_request
perf_sampler:note_view
perf_sampler:on_read
perf_sampler:on_stop
perf_sampler:record_duration
perf_sampler:runs_opted_in
perf_sampler:runs_opted_out
perf_sampler:sampler_stop
perf_sampler:save_later
perf_sampler:sizes_entity_count
perf_sampler:sizes_registry
perf_sampler:snapshot_kb
perf_sampler:start_runs
perf_sampler:start_sampler
perf_sampler:static_machine
perf_sampler:static_system_info
perf_sampler:stop
perf_sampler:timer_loop
perf_sampler:timer_sample
perf_sampler:timer_sizes
plan_ai:ask
plan_ai:bump
plan_ai:bump_once
plan_ai:floor_order
plan_ai:look_again
plan_ai:measure_ticks
plan_ai:measure_tilt
plan_ai:read_dims
plan_ai:read_lights
plan_ai:read_plan
plan_ai:read_rooms
plan_ai:read_whole_ink
plan_ai:read_whole_picture
plan_ai:registry
plan_ai:rooms_gate
plan_ai:rooms_inputs
plan_ai_write:excluded
plan_ai_write:invalidate
plan_carry:carry_apply
power_team:call
power_team:power_teams_set
power_team:team_tick
power_team:tick
presence:beacon_cal_add_point
presence:beacon_cal_settings
presence:excluded_sources
presence:follow_notify_guest
presence:follow_notify_service
presence:fusion_nudge
presence:heldout
presence:heldout_job_excluded
presence:heldout_job_settings
presence:immediate_cal_add_point
presence:init
presence:maybe_refresh_heldout
presence:mqtt_publish
presence:mqtt_publish_one
presence:note_steadiness
presence:pin_compute_thread
presence:poll_adjacency
presence:poll_area_registry
presence:poll_capture_frame
presence:poll_coverage_floor
presence:poll_floor_registry
presence:poll_held_room_alerts
presence:poll_interval
presence:poll_model_geometry
presence:poll_path_loss_fits
presence:poll_pinned_beacons
presence:poll_scanner_offsets
presence:poll_tag_events
presence:poll_tag_events_held
presence:poll_traceback
presence:poll_vote_settings
presence:prefer_knn_now
presence:record_movement
presence:resolve_door_attenuation
presence:room_corroborated
presence:run_automations
presence:smooth_adaptive_setting
presence:smooth_floor_attenuation
presence:smooth_floor_transition
presence:smooth_fusion_settings
presence:smooth_kalman_settings
presence:smooth_path_loss_settings
presence:suspend_databases
presence:unsuspend_databases
presence:usual_move
presence_rules:home_context_objects
presence_rules:home_context_zones
presence_rules:is_carried_persons
presence_rules:known_rooms
pro_invite:send_decline
report_context:install_store
resolver:count
resolver:is_rpa
resolver:load_ble_transmitter
resolver:load_device_name
resolver:load_mobile_app_irk
resolver:load_padspan_irks
resolver:load_registry
resolver:load_system_irks
resolver:parse_ibeacon
resolver:parse_irk
resolver:parse_irk_base64
resolver:parse_irk_base64_padded
resolver:status_device_name
resolver:status_mobile_app
resolver:status_private_ble
resolver:status_registry
resolver:system_irks_file
resolver:system_irks_scan
safe_store:notice
sensor:ha_version
sensor:room_reason
sensor:room_reason_hold
settings_store:first_run
settings_store:load
setup:background_alerts
setup:background_stores
setup:dump_devices
setup:entry_area_rename
setup:entry_emergency_test
setup:entry_first_fetch
setup:entry_flood_latch
setup:entry_forensics
setup:entry_house3d_people
setup:entry_rain_wet
setup:entry_update_check
setup:entry_vacation
setup:entry_wled_exact
setup:entry_zigbee_twins
setup:feeds_bluetooth
setup:feeds_espresense
setup:feeds_tags
setup:feeds_tasmota
setup:flush_forensics
setup:flush_traceback
setup:init_model
setup:room_walk_default
setup:unload_area_rename
setup:unload_bluetooth
setup:unload_capture
setup:unload_device_registry
setup:unload_emergency_test
setup:unload_espresense
setup:unload_flood_latch
setup:unload_forensics
setup:unload_house3d_people
setup:unload_object_history
setup:unload_panel
setup:unload_power_teams
setup:unload_presence
setup:unload_rain_wet
setup:unload_tags
setup:unload_tasmota
setup:unload_traceback
setup:unload_update_check
setup:unload_vacation
setup:unload_vacuum
setup:unload_wled_exact
setup:unload_zigbee_twins
setup_checks:setup_phones
setup_checks:setup_tips
snapshot:ad_enrichment
snapshot:address_makers
snapshot:adv_age
snapshot:adv_last_seen
snapshot:adv_object
snapshot:adv_rssi
snapshot:apple_classify
snapshot:areas
snapshot:bermuda_area_devices
snapshot:bermuda_ignore
snapshot:ble
snapshot:cache_bermuda_drop
snapshot:cache_bermuda_state
snapshot:config_entries
snapshot:dedup
snapshot:dedup_after_cache
snapshot:dedup_apple_random
snapshot:dedup_apple_subtype
snapshot:dedup_ble_random
snapshot:dedup_maker_random
snapshot:dedup_name_random
snapshot:dedup_payload
snapshot:dedup_uuid_random
snapshot:device_connections
snapshot:device_detail
snapshot:device_registry
snapshot:device_tables
snapshot:enrich_object
snapshot:entities
snapshot:entity_address
snapshot:entity_entry
snapshot:espresense
snapshot:excluded_sources
snapshot:findmy_bridge
snapshot:findmy_bridge_step
snapshot:ibeacon
snapshot:ingest_policy
snapshot:label_follow
snapshot:label_links
snapshot:lost_found_prune
snapshot:mac_rotation_bridge
snapshot:object_labels
snapshot:object_labels_cached
snapshot:object_merge
snapshot:radio_areas
snapshot:radio_network
snapshot:receivers
snapshot:reenrich_history
snapshot:reenrich_history_job
snapshot:room_by_rssi
snapshot:room_tag_rows
snapshot:same_label_dedup
snapshot:saved_room_tags
snapshot:scanner_health
snapshot:scanner_offsets
snapshot:snapshot_ttl_s
snapshot:tasmota
snapshot:ws_away
snapshot:ws_calibration_status
snapshot:ws_guest_overlay
snapshot:ws_label_links
snapshot:ws_objects_envelope
snapshot:ws_slim
snapshot:ws_suspended
snapshot:ws_vacuum
tag_integration:emit_room_change
tag_integration:get_phone_room
tag_integration:ha_tag_name_registry
tag_integration:ha_tag_name_store
tag_integration:try_autolink_phone
tasmota_ble:maybe_request
tasmota_ble:on_message
tasmota_ble:stop
telemetry:ai_task_word
telemetry:ensure_hw
telemetry:ensure_plan_ai
telemetry:ensure_snapshot
telemetry:give_back_log_counts
telemetry:give_back_perf
telemetry:give_back_resolvers
telemetry:history_days
telemetry:len
telemetry:payload_ai_mapping
telemetry:payload_ai_task
telemetry:payload_cal_phantom_rooms
telemetry:payload_device_ids
telemetry:payload_entity_dups
telemetry:payload_floor_ids
telemetry:payload_forensics_paused
telemetry:payload_geometry_faults
telemetry:payload_guest
telemetry:payload_ha_version
telemetry:payload_heldout
telemetry:payload_house3d
telemetry:payload_hw
telemetry:payload_integrations
telemetry:payload_irk_capture_boards
telemetry:payload_irk_resolving
telemetry:payload_log_counts
telemetry:payload_maps_vanished
telemetry:payload_onboarding
telemetry:payload_perf
telemetry:payload_pinned_movers
telemetry:payload_plans
telemetry:payload_plans_out_of_shape
telemetry:payload_power_teams
telemetry:payload_presence_cfg
telemetry:payload_room_footprints
telemetry:payload_room_walk
telemetry:payload_rooms_overlap
telemetry:payload_store_used_in
telemetry:payload_vacation
telemetry:persist_counters
telemetry:positioning_now
telemetry:reset_log_counts
telemetry:reset_perf
telemetry:reset_resolvers
telemetry:restore_counters
telemetry:send_last_day
telemetry:send_onboarding
telemetry:send_post
telemetry:send_pro_invite
telemetry:send_removed
telemetry:send_reply_json
telemetry:setup_perf
telemetry:setup_restore_counters
telemetry:stop_perf
telemetry:stop_unsub
telemetry:take_log_counts
telemetry:take_perf
telemetry:take_resolvers
telemetry:temp_fresh_note
tester:post
tester:setup_lines
tester:wled_devices
traceback_store:load
update_check:check_fetch
update_check:check_notify
update_check:keep_offers
update_check:revalidate_license
update_check:stop_update_check
update_check:tester_line_edition
update_check:tester_line_signed_up
vacation_mode:announce
vacation_mode:count_rule_once_a_day
vacation_mode:eligible_platform
vacation_mode:eligible_states
vacation_mode:eligible_twins
vacation_mode:end_trip
vacation_mode:history_instance
vacation_mode:history_recorder
vacation_mode:off_alert
vacation_mode:off_notification
vacation_mode:refresh_status
vacation_mode:someone_home_guests
vacation_mode:someone_home_people
vacation_mode:stop_vacation_mode
vacation_mode:sun_times
vacation_mode:tick_bump
vacation_mode:tick_wled_power
vacation_mode:who_from_connection
vacuum_import:tick
vacuum_run:home
vacuum_run:run
vacuum_run:save
websocket:model_get_areas
websocket:model_get_floors
wled_exact:give_back_all
wled_exact:is_exact_entity
wled_exact:lapsed_team_follows
wled_exact:plain_targets
wled_exact:refresh_listener
wled_exact:schedule_late
wled_exact:schedule_retry
wled_exact:service_entities
wled_exact:stop_wled_exact
ws_adaptive:fingerprints_get
ws_backup:auto_backup
ws_backup:auto_backup_store
ws_backup:create_map_file
ws_backup:create_maps
ws_backup:exists
ws_backup:restore_map_file
ws_backup:restore_wled_listener
ws_calibration:health_latest_point
ws_calibration:health_live_radios
ws_calibration:health_maps
ws_calibration:heldout
ws_calibration:note_points_seen
ws_common:init
ws_common:is_rpa_addr
ws_common:object_history_ttl_s
ws_common:pro_expiry_state
ws_common:store_file_written
ws_companion:discover_ble
ws_companion:discover_device_lookup
ws_companion:discover_devices
ws_companion:discover_entities
ws_companion:discover_ibeacons
ws_companion:discover_notify
ws_companion:discover_registry_scan
ws_companion:discover_resolver
ws_companion:discover_webhooks
ws_companion:follow_canonical_id
ws_companion:follow_enable_entity
ws_companion:mobile_app_notify_service
ws_companion:phone_ids_labels
ws_companion:phone_ids_resolver
ws_companion:unfollow
ws_devices:espresense_config_read
ws_devices:espresense_import_room
ws_devices:espresense_import_z
ws_diagnostics:audit_automations
ws_diagnostics:audit_device
ws_diagnostics:audit_scripts
ws_diagnostics:auto_diagnostics
ws_diagnostics:critics_calibration_age
ws_diagnostics:critics_geometry
ws_diagnostics:critics_live_radios
ws_diagnostics:critics_map_quality
ws_diagnostics:critics_room_divergence
ws_diagnostics:critics_room_footprint
ws_diagnostics:positioning_diag
ws_diagnostics:propagation_areas
ws_diagnostics:propagation_heldout
ws_fabric:health_adaptive
ws_fabric:health_device_registry
ws_fabric:health_entity_identity
ws_fabric:health_label_pipeline
ws_fabric:health_occupancy
ws_fabric:health_padspan_ids
ws_fabric:health_recorder
ws_fabric:measured_transform_calibration
ws_fabric:measured_transform_old
ws_fabric:measured_transform_refs
ws_fabric:resync_prune
ws_fabric:resync_snapshot
ws_fabric:rooms_merge
ws_fabric:sync_mode_set
ws_factory_reset:delete_file
ws_factory_reset:reset_bluetooth
ws_factory_reset:reset_coordinator
ws_factory_reset:reset_presence
ws_floorplan_import:roomplan_base64
ws_floorplan_import:sh3d_base64
ws_follow:alert_save
ws_follow:area_delete
ws_guests:bump
ws_guests:guest_tag_mark
ws_guests:objects
ws_house3d:get
ws_house3d_import:preview_base64
ws_house3d_photo:ai_task
ws_house3d_photo:bump
ws_house3d_photo:ha_version
ws_house3d_photo:platform
ws_house3d_photo:probe
ws_house3d_photo:read_furniture
ws_house3d_photo:server_url
ws_house3d_photo:write
ws_house3d_stairs:bump
ws_house3d_stairs:stairs_read_picture
ws_irk:abort_flow
ws_irk:add_irk_parse
ws_irk:add_irk_resolver
ws_irk:auto_detect_ble
ws_irk:auto_detect_capture
ws_irk:auto_detect_resolver
ws_irk:auto_detect_system
ws_irk:auto_detect_verify
ws_irk:beacon_uuid_adverts
ws_irk:beacon_uuid_sensors
ws_irk:private_ble_delete_irk
ws_irk:remove
ws_irk:stored_irk_hexes
ws_irk:try_create_entry
ws_irk:validate_base64
ws_irk:validate_base64_padded
ws_irk:validate_match
ws_maps:delete_calibration
ws_maps:delete_migrate_calibration
ws_maps:delete_migrate_canvas
ws_maps:delete_settings
ws_maps:delete_traceback
ws_maps:fit_suggest
ws_maps:note_map_deleted
ws_maps:scan_create_model
ws_maps:scan_create_read
ws_maps:update_beacon_calibration
ws_maps:update_beacons_removed
ws_maps:update_calibration
ws_maps:update_old_map
ws_notify:services_list
ws_objects:label_delete_cross
ws_objects:label_delete_registry
ws_objects:label_delete_resolver
ws_objects:label_delete_stores
ws_objects:label_set_cross
ws_objects:label_set_cross_keys
ws_objects:label_set_registry
ws_objects:label_set_resolver
ws_objects:object_label_list
ws_occupancy:entity_area_name
ws_plan_ai:anthropic_set_up
ws_plan_ai:candidates
ws_plan_ai:helper_undo
ws_plan_ai:plan_build_rooms_edit
ws_plan_ai:plan_build_scale_preview
ws_plan_ai:reprojected
ws_plan_ai:rooms_settled
ws_plan_ai:scale_check
ws_plan_ai:undo_scale_word
ws_radios:area_set_areas
ws_radios:area_set_match
ws_settings:set_espresense
ws_settings:set_excluded_scanners
ws_settings:set_follow_auto_label
ws_settings:set_followed_ble
ws_settings:set_followed_old
ws_settings:set_followed_removed
ws_settings:set_positioning_algorithm
ws_settings:set_tasmota
ws_settings:set_toggle_entities
ws_vacuum:import_preview
ws_wled:run
ws_wled:run_ended
zigbee_twins:notify
zigbee_twins:notify_existing
zigbee_twins:power_teams
zigbee_twins:rain_wet
zigbee_twins:read
zigbee_twins:registry_id
""".split())
