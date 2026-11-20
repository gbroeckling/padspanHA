# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Make the stored house that tests_ha/test_upgrade.py upgrades.

Not part of the suite (the file name keeps pytest from collecting it). Run it
ONCE against the last stable's custom_components/, in a checkout whose
tests_ha/ is this one:

    git worktree add --detach ../stable v0.38.231
    cp -r tests_ha ../stable/ && cp pyproject.toml ../stable/
    cd ../stable && UPGRADE_FIXTURE_OUT=/tmp/v0.38.231.json \
        python -m pytest tests_ha/upgrade_capture.py -p no:cacheprovider

It builds a made-up house through the old version's own websocket commands
(floor plans, rooms, receivers, calibration points, labelled and followed
devices, pinned beacons, rules, guests, sub-zones, Live Aboard, settings
changed from default across every section), lets it poll, and writes
everything the old version stored, its entities and devices, and the HA
floors, areas and states the house stands on. Every value is made up: no
address, key or name in it belongs to anyone. Check the file before
committing it all the same.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

from homeassistant.const import EVENT_HOMEASSISTANT_FINAL_WRITE
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from .conftest import DOMAIN, call
from .upgrade_house import BEACON, ENTRY_ID, PHONE, STATES, TAG, WALLET, build_ha_house, poll, stand_in_bluetooth

PNG_1x1 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


async def _ws(client, steps: dict, name: str, msg: dict) -> Any:
    reply = await call(client, {"type": f"padspan_ha/{msg.pop('cmd')}", **msg})
    steps.setdefault(name, "ok" if reply["success"] else f"{reply['error']['code']}: {reply['error']['message'][:120]}")
    return reply.get("result") if reply["success"] else None


async def _settings_everywhere(client, steps: dict, defaults: dict) -> list[str]:
    """Every setting settings_set takes, changed from its default where a
    plain change is accepted; returns the keys that now read differently."""
    hand = {
        "positioning_algorithm": "rf", "kalman_q": 0.5, "kalman_r": 6.0, "presence_poll_interval_s": 7,
        "ble_reseed_interval_s": 20, "away_timeout_m": 12, "object_history_days": 2,
        "followed_addrs": [TAG, PHONE.lower()], "excluded_objects": ["02:00:00:00:00:99"],
        "excluded_scanners": ["scanner_example_attic"], "scanner_offsets": {"scanner_example_kitchen": -3.0},
        "scanner_min_rssi": {"scanner_example_office": -92},
        "ingest_rules": [{"match": "02:00:00:00:01:*", "action": "deny"}],
        "light_shapes": {"light.kitchen_ceiling": "square"},
        "light_type_overrides": {"light.bedroom_strip": "wled"},
        "door_opener_ids": ["cover.garage_example"],
        "emergency_entities": ["light.kitchen_ceiling"],
        "espresense_room_map": {"kitchen": "Kitchen"},
        "atlas_3d_director": [{"entity": "binary_sensor.front_door", "camera": ""}],
        "atlas_3d_director_people": [{"key": "person.alex_example", "rooms": ["Kitchen"]}],
        "atlas_3d_carries": {"person.alex_example": [TAG]},
        "padspan_automations": [{"trigger": "enter", "device_key": TAG, "device_label": "Example tag",
                                 "action": "turn_on", "entity_id": "light.kitchen_ceiling", "enabled": True,
                                 "room": "Kitchen"}],
        "lights_showcase_presets": [{"name": "Evening example", "theme": "classic", "automorph": False}],
        "whole_house_presets": [{"name": "All on example",
                                 "entities": {"light.kitchen_ceiling": {"state": "on", "brightness": 180}}}],
        "vacation_mode_anchors": ["light.living_lamp"], "vacation_mode_intensity": 60,
        "vacation_mode_source": "month", "vacation_mode_bedtime": "23:30",
        "theme_palette": "forest", "ui_skin": "classic", "cpu_mode": "balanced",
        "lights_showcase_theme": "classic", "lights_automorph_style": "soft",
        "fabric_origin_lat": 49.0, "fabric_origin_lon": -123.0, "fabric_bearing_deg": 15.0,
        "assumed_device_height_m": 1.1, "path_loss_exp": 2.8, "ref_power": -62,
        "advanced_extra_tabs": ["forensics"], "hidden_map_ids": [], "beacon_tune_disabled": ["example_device"],
        "beacon_group_overrides": {"example_device": "example_model"},
        "overview_iso_zoom": 1.25, "maps_iso_floor_gap": 160, "overview_iso_floor_gap": 170,
        "whatsnew_seen_version": "0.38.231",
    }
    # Kept as the old version had them, or left alone: the switch the
    # upgrade must keep off, and the links that need a broker or a server.
    skip = {"enhanced_security", "license_tier_override", "espresense_mqtt_enabled", "tasmota_ble_enabled",
            "mqtt_publish_enabled", "telemetry_enabled", "update_check_enabled", "espresense_companion_url",
            "onboarding_completed", "setup_progress", "health_reminder_last_ts", "low_memory_mode",
            "vacation_mode_enabled", "vacation_mode_end_at", "data_mode", "locate_self_key",
            # Entities stay on: they are what the upgrade must keep.
            "ha_entity_tracker_enabled", "ha_entity_area_enabled", "ha_entity_distance_enabled",
            "ha_entity_scanner_distance_enabled", "quiet_mode",
            "lights_panel_enabled", "atlas_3d_ai_task_entity", "atlas_3d_ai_task_backup_entity",
            "atlas_weather_condition_entity", "atlas_weather_rain_entity", "atlas_weather_warning_entity"}
    accepted = (await _ws(client, steps, "settings_get", {"cmd": "settings_get"})) or {}
    before = dict(accepted.get("settings") or {})
    keys =[k for k in _SETTINGS_SET_KEYS if k not in skip]
    for key in keys:
        cands = [hand[key]] if key in hand else []
        d = defaults.get(key, before.get(key))
        if isinstance(d, bool):
            cands.append(not d)
        elif isinstance(d, (int, float)) and d is not None:
            cands += [d * 2 if d else 1, d + 1, d / 2 if d else 0.5]
        outcome = "no change tried"
        for v in cands:
            r = await call(client, {"type": "padspan_ha/settings_set", key: v})
            if not r["success"]:
                outcome = r["error"]["code"]
                continue
            got = (((await call(client, {"type": "padspan_ha/settings_get"}))["result"] or {})
                   .get("settings") or {}).get(key)
            outcome = "changed" if got != d else "accepted, unchanged"
            if got != d:
                break
        steps[f"settings:{key}"] = outcome
    after = (await call(client, {"type": "padspan_ha/settings_get"}))["result"]["settings"]
    return sorted(k for k in after if after.get(k) != before.get(k))


_SETTINGS_SET_KEYS: list[str] = []


async def test_capture_the_house(hass, hass_storage, hass_ws_client, hass_config_dir, monkeypatch):
    from homeassistant.components import websocket_api  # noqa: PLC0415

    steps: dict[str, str] = {}
    stand_in_bluetooth(monkeypatch)
    build_ha_house(hass)

    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(domain=DOMAIN, title="PadSpan HA", data={}, entry_id=ENTRY_ID)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)

    from custom_components.padspan_ha import const  # noqa: PLC0415
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS  # noqa: PLC0415
    version = const.VERSION
    reg = hass.data[websocket_api.DOMAIN]
    schema = reg["padspan_ha/settings_set"][1].schema
    _SETTINGS_SET_KEYS[:] = sorted(str(getattr(k, "schema", k)) for k in schema if str(getattr(k, "schema", k))
                                   not in ("type", "id"))

    # A Pro key (made up) and the switches the features below sit behind.
    await hass.data[DOMAIN]["settings"].async_set(forensics_license_key="PSPAN-TEST-TEST-TEST-TEST")
    await _ws(client, steps, "settings_set:switches", {
        "cmd": "settings_set", "guest_tags_enabled": True, "subzones_enabled": True, "atlas_3d_enabled": True,
        "calibration_room_walk": True, "forensics_enabled": True, "rssi_capture_enabled": True,
        "adaptive_learning_enabled": True, "beacon_profiling_enabled": True, "data_mode": "live"})
    # The house is heard: every device by every receiver, and a few polls.
    await poll(hass, DOMAIN, 3)
    heard = [k for k in hass.data[DOMAIN]["presence_coordinator"].data or {} if not k.startswith("__")]
    ibeacon = next((k for k in heard if k.startswith("ibeacon:")), None)

    def key_of(addr: str) -> str:
        return next((k for k in heard if k.upper().endswith(addr.upper())), addr)

    steps["heard_objects"] = f"{len(heard)} (ibeacon {'found' if ibeacon else 'missing'})"

    # Floor plans: one per floor, each with receivers, pinned beacons, rooms drawn and a scale.
    maps = {}
    for name, floor in (("Ground plan", "ground"), ("Upstairs plan", "upstairs")):
        r = await _ws(client, steps, "maps_upload", {
            "cmd": "maps_upload", "name": name, "filename": f"{floor}.png", "mime": "image/png",
            "width": 1, "height": 1, "png_base64": PNG_1x1, "floor_id": floor})
        maps[floor] = r["map"]["id"]
    g, u = maps["ground"], maps["upstairs"]
    await _ws(client, steps, "maps_update:ground", {
        "cmd": "maps_update", "map_id": g, "notes": "Example ground floor",
        "receivers": [{"id": "rx_kitchen", "label": "Kitchen receiver", "x": 0.2, "y": 0.3, "room": "Kitchen",
                       "source": "scanner_example_kitchen"},
                      {"id": "rx_living", "label": "Living receiver", "x": 0.7, "y": 0.4, "room": "Living Room",
                       "source": "scanner_example_living"},
                      {"id": "rx_hall", "label": "Hall receiver", "x": 0.5, "y": 0.8, "room": "Hall",
                       "source": "scanner_example_hall"}],
        "beacons": [{"id": "bk_fixed1", "label": "Fixed beacon", "key": BEACON, "x": 0.4, "y": 0.5, "kind": "fixed"}],
        "room_bounds": {"Kitchen": {"type": "poly", "points": [[0.0, 0.0], [0.45, 0.0], [0.45, 0.6], [0.0, 0.6]]},
                        "Living Room": {"type": "poly", "points": [[0.45, 0.0], [1.0, 0.0], [1.0, 0.6], [0.45, 0.6]]},
                        "Hall": {"type": "circle", "cx": 0.5, "cy": 0.8, "r": 0.15}},
        "calibration": {"mode": "two_point", "px_per_meter": 0.1,
                        "reference_points": [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0, "d_m": 10.0}]},
        "stack": {"z": 0, "offset_x": 0, "offset_y": 0}})
    await _ws(client, steps, "maps_update:upstairs", {
        "cmd": "maps_update", "map_id": u,
        "receivers": [{"id": "rx_bed", "label": "Bedroom receiver", "x": 0.3, "y": 0.3, "room": "Bedroom",
                       "source": "scanner_example_bedroom"},
                      {"id": "rx_office", "label": "Office receiver", "x": 0.8, "y": 0.6, "room": "Office",
                       "source": "scanner_example_office"}],
        "room_bounds": {"Bedroom": {"type": "poly", "points": [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]]},
                        "Office": {"type": "poly", "points": [[0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [0.5, 1.0]]}}})
    for floor, mid in maps.items():
        await _ws(client, steps, f"fabric_map_transform_set:{floor}", {
            "cmd": "fabric_map_transform_set", "map_id": mid,
            "transform": {"scale_x_m": 10.0, "scale_y_m": 8.0, "origin_x_m": 0.0, "origin_y_m": 0.0,
                          "rotation_rad": 0.0, "floor_id": floor}})
    # Room colours and floors, heights, the floors' elevations.
    await _ws(client, steps, "model_update", {"cmd": "model_update", "room_meta": {
        "Kitchen": {"color": "#d08040", "floor_id": "ground"}, "Living Room": {"color": "#4080d0", "floor_id": "ground"},
        "Hall": {"color": "#808080", "floor_id": "ground"}, "Bedroom": {"color": "#a040a0", "floor_id": "upstairs"},
        "Office": {"color": "#40a040", "floor_id": "upstairs"}}})
    await _ws(client, steps, "fabric_floor_elevations_set", {"cmd": "fabric_floor_elevations_set", "floors": [
        {"id": "ground", "base_elevation_m": 0.0, "floor_to_floor_m": 2.7},
        {"id": "upstairs", "base_elevation_m": 2.7, "floor_to_floor_m": 2.5}]})
    # Rooms in metres, the rooms' own shapes (the room editor's save).
    rooms_m = {"ground": {"Kitchen": [[0, 0], [4.5, 0], [4.5, 4.8], [0, 4.8]],
                          "Living Room": [[4.5, 0], [10, 0], [10, 4.8], [4.5, 4.8]],
                          "Hall": [[3.5, 5.0], [6.5, 5.0], [6.5, 8.0], [3.5, 8.0]]},
               "upstairs": {"Bedroom": [[0, 0], [5, 0], [5, 8], [0, 8]],
                            "Office": [[5, 0], [10, 0], [10, 8], [5, 8]]}}
    for floor, rooms in rooms_m.items():
        for room, pts in rooms.items():
            await _ws(client, steps, "fabric_room_add", {"cmd": "fabric_room_add", "room": room, "floor_id": floor})
            await _ws(client, steps, "fabric_correct_room", {
                "cmd": "fabric_correct_room", "floor_id": floor, "room": room,
                "geometry": {"type": "poly", "points_m": pts}})
    await _ws(client, steps, "room_height_set", {"cmd": "room_height_set", "room": "Living Room", "height_m": 4.2})
    # Receivers placed in metres, one with its height and a trim.
    for src, x, y, floor in (("scanner_example_kitchen", 2.0, 2.4, "ground"), ("scanner_example_living", 7.0, 3.2, "ground"),
                             ("scanner_example_hall", 5.0, 6.4, "ground"), ("scanner_example_bedroom", 3.0, 2.4, "upstairs"),
                             ("scanner_example_office", 8.0, 4.8, "upstairs")):
        await _ws(client, steps, "fabric_scanner_position_set", {
            "cmd": "fabric_scanner_position_set", "source": src, "x_m": x, "y_m": y, "floor_id": floor})
    await _ws(client, steps, "fabric_scanner_z_set", {"cmd": "fabric_scanner_z_set", "source": "scanner_example_kitchen", "z_m": 1.8})
    await _ws(client, steps, "scanner_offset_set", {"cmd": "scanner_offset_set", "source": "scanner_example_hall", "offset_db": 4.0})
    # A pinned beacon in metres, a light placed, a signal wall.
    await _ws(client, steps, "fabric_beacon_position_set", {
        "cmd": "fabric_beacon_position_set", "key": BEACON, "x_m": 4.0, "y_m": 4.0, "floor_id": "ground",
        "room": "Kitchen", "kind": "fixed", "label": "Fixed beacon", "z_m": 1.2})
    await _ws(client, steps, "fabric_light_position_set", {
        "cmd": "fabric_light_position_set", "entity_id": "light.kitchen_ceiling", "x_m": 2.2, "y_m": 2.4,
        "floor_id": "ground", "color": "#ffcc88", "shape": "circle", "label": "Ceiling", "z_m": 2.6})
    await _ws(client, steps, "fabric_light_position_set", {
        "cmd": "fabric_light_position_set", "entity_id": "light.bedroom_strip", "x_m": 1.0, "y_m": 1.0,
        "floor_id": "upstairs"})
    await _ws(client, steps, "fabric_rf_barrier_set", {"cmd": "fabric_rf_barrier_set", "barrier": {
        "name": "Kitchen wall", "floor_id": "ground", "points_m": [[4.5, 0.0], [4.5, 4.8]], "material": "brick"}})
    # Calibration points: two on each floor.
    for floor, mid, room, x, y in (("ground", g, "Kitchen", 0.2, 0.3), ("ground", g, "Living Room", 0.7, 0.3),
                                   ("upstairs", u, "Bedroom", 0.25, 0.5), ("upstairs", u, "Office", 0.75, 0.5)):
        await _ws(client, steps, "calibration_save_point", {"cmd": "calibration_save_point", "point": {
            "map_id": mid, "x_frac": x, "y_frac": y, "floor_id": floor, "room": room, "label": f"{room} point",
            "device_id": "example_phone", "duration_s": 15, "scanner_readings": [
                {"source": "scanner_example_kitchen", "name": "Kitchen receiver", "rssi_samples": [-60, -61, -59, -62, -60]},
                {"source": "scanner_example_bedroom", "name": "Bedroom receiver", "rssi_samples": [-75, -76, -74, -77, -75]}]}})
    await _ws(client, steps, "calibration_room_walk_save", {
        "cmd": "calibration_room_walk_save", "room": "Hall", "map_id": g, "device_id": "example_phone",
        "duration_s": 30, "polls": [{"scanner_example_hall": -58 - i % 3, "scanner_example_kitchen": -70 - i % 4}
                                    for i in range(20)]})
    # Labelled devices, a followed one with a rule, an identity added.
    labels = [(key_of(TAG), "Example keys tag"), (key_of(PHONE), "Example phone"), (key_of(WALLET), "Example wallet"),
              (key_of(BEACON), "Example fixed beacon")] + ([(ibeacon, "Example iBeacon")] if ibeacon else [])
    for addr, label in labels:
        await _ws(client, steps, "object_label_set", {"cmd": "object_label_set", "address": addr, "label": label})
    await poll(hass, DOMAIN, 3)
    devs = (await _ws(client, steps, "device_registry_list", {"cmd": "device_registry_list"})) or {}
    dev_list = devs.get("devices") if isinstance(devs, dict) else devs
    first = next(iter(dev_list.values() if isinstance(dev_list, dict) else (dev_list or [])), None)
    if isinstance(first, dict) and first.get("padspan_id"):
        await _ws(client, steps, "device_registry_label_set", {
            "cmd": "device_registry_label_set", "padspan_id": first["padspan_id"], "label": "Example keys (renamed)"})
        await _ws(client, steps, "device_registry_add_identity", {
            "cmd": "device_registry_add_identity", "padspan_id": first["padspan_id"], "kind": "mac", "value": "02:00:00:00:00:05"})
    await _ws(client, steps, "follow_alert_save", {"cmd": "follow_alert_save", "addr": TAG, "config": {
        "enabled": True, "notify_on_enter": ["Kitchen"], "notify_on_leave": ["Hall"], "notify_target": "notify.example",
        "lost_after_m": 30}})
    await _ws(client, steps, "follow_alert_save:2", {"cmd": "follow_alert_save", "addr": PHONE, "config": {
        "enabled": False, "away_minutes": 15}})
    await _ws(client, steps, "irk_add", {"cmd": "irk_add", "name": "Example iPhone", "irk_hex": "00112233445566778899aabbccddeeff",
                                         "force": True})
    if ibeacon:
        await _ws(client, steps, "companion_follow", {
            "cmd": "companion_follow", "ibeacon_key": ibeacon, "device_name": "Example companion"})
    # Guests and their tag, a sub-zone, Live Aboard's own file.
    await _ws(client, steps, "guest_tag_mark", {"cmd": "guest_tag_mark", "key": key_of(WALLET)})
    guests = (await _ws(client, steps, "guests_get", {"cmd": "guests_get"})) or {}
    pid = next((t.get("pid") for t in guests.get("tags") or [] if isinstance(t, dict)), None)
    steps["guest_tag_pid"] = "found" if pid else f"missing: {sorted(guests)}"
    if pid:
        await _ws(client, steps, "guest_session_start", {
            "cmd": "guest_session_start", "pid": pid, "name": "Example guest", "off_limits": ["Office"],
            "notify_arrive": True, "notify_leave": False, "counts_home": True})
    await _ws(client, steps, "subzone_add", {"cmd": "subzone_add", "zone": {
        "name": "Example couch", "floor_id": "ground", "room": "Living Room", "type": "poly",
        "points_m": [[6.0, 1.0], [8.0, 1.0], [8.0, 2.0], [6.0, 2.0]], "dwell_s": 20}})
    await _ws(client, steps, "house3d_edit", {
        "cmd": "house3d_edit",
        "openings": {"door_0000000a": {"kind": "door", "floor_id": "ground", "a_m": [4.0, 4.8], "b_m": [4.9, 4.8],
                                       "head_m": 2.1, "hinge": "left", "swing": "in"},
                     "win_0000000b": {"kind": "window", "floor_id": "ground", "a_m": [0.0, 1.0], "b_m": [0.0, 2.2],
                                      "sill_m": 0.9, "head_m": 2.0}},
        "pieces": {"fur_0000000c": {"id": "fur_0000000c", "floor_id": "ground", "label": "Example sofa", "x_m": 7.0,
                                    "y_m": 1.5, "rotation": 90, "recipe": {"kind": "sofa", "params": {}, "colors": ["#5b6b7a"],
                                                                         "width_m": 2.0, "depth_m": 0.9, "height_m": 0.8}}},
        "lights": {"light.living_lamp": {"z_m": 1.5, "kind": "lamp"}}})
    # A safety copy, a capture session, and the settings in every section.
    await _ws(client, steps, "store_backup_create", {"cmd": "store_backup_create", "note": "Example backup"})
    await _ws(client, steps, "capture_start", {"cmd": "capture_start", "minutes": 1, "label": "Example capture"})
    await _ws(client, steps, "capture_mark", {"cmd": "capture_mark", "room": "Kitchen"})
    await _ws(client, steps, "capture_stop", {"cmd": "capture_stop"})
    changed = await _settings_everywhere(client, steps, DEFAULT_SETTINGS)
    await _ws(client, steps, "trial_or_tester", {"cmd": "settings_set", "trial_nudge_done": True, "tester_nudge_done": True})

    # It runs for a while: polls, then everything written, as at a shutdown.
    await poll(hass, DOMAIN, 4)
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
    await hass.async_block_till_done()

    reads = {}
    for cmd in ("settings_get", "maps_list", "model_get", "calibration_get", "object_label_list", "device_registry_list",
                "follow_alert_get", "guests_get", "subzones_list", "house3d_get", "store_backup_list", "capture_list"):
        r = await call(client, {"type": f"padspan_ha/{cmd}"})
        reads[cmd] = r["result"] if r["success"] else {"error": r["error"]["code"]}

    entities = sorted(({"entity_id": e.entity_id, "unique_id": e.unique_id, "platform": e.platform, "domain": e.domain,
                        "device_id": e.device_id, "disabled_by": str(e.disabled_by) if e.disabled_by else None,
                        "original_name": e.original_name, "has_entity_name": e.has_entity_name,
                        "translation_key": e.translation_key}
                       for e in er.async_entries_for_config_entry(er.async_get(hass), ENTRY_ID)),
                      key=lambda e: e["entity_id"])
    devices = sorted(({"id": d.id, "identifiers": sorted([list(i) for i in d.identifiers]),
                       "connections": sorted([list(c) for c in d.connections]), "name": d.name,
                       "manufacturer": d.manufacturer, "model": d.model, "via_device_id": d.via_device_id}
                      for d in dr.async_entries_for_config_entry(dr.async_get(hass), ENTRY_ID)),
                     key=lambda d: json.dumps(d["identifiers"]))
    config = Path(hass_config_dir)
    files = {str(p.relative_to(config)).replace(os.sep, "/"): base64.b64encode(p.read_bytes()).decode()
             for p in sorted(config.rglob("*")) if p.is_file() and p.stat().st_size < 64_000}
    out = {
        "made_by": version, "entry_id": ENTRY_ID,
        "floors": [{"floor_id": f.floor_id, "name": f.name, "level": f.level} for f in fr.async_get(hass).async_list_floors()],
        "areas": [{"area_id": a.id, "name": a.name, "floor_id": a.floor_id} for a in ar.async_get(hass).async_list_areas()],
        "states": {eid: {"state": s, "attributes": a} for eid, (s, a) in STATES.items()},
        "steps": steps, "settings_changed": changed,
        "storage": {k: v for k, v in sorted(hass_storage.items()) if k.startswith(DOMAIN + ".")},
        "entities": entities, "devices": devices, "files": files, "reads": reads,
    }
    Path(os.environ["UPGRADE_FIXTURE_OUT"]).write_text(json.dumps(out, indent=1, sort_keys=True, default=str) + "\n",
                                                       encoding="utf-8")
