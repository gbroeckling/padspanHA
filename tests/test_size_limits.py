"""Generous limits on what a command's message may hold (ws_common).

The hostile-input pass found these accepted and stored as sent: 100,000
characters and NUL characters in names, labels, notes and ids; 1e308 as a
position; lists of 10,000 entries; dicts nested 200 deep; walls keeping any
key they were sent. Each limit is far past a real home (its longest label is
81 characters, its ids 74, its furthest position 59 m, its longest setting
list 14 entries, its deepest record 5 levels) and refused at the schema, so
Home Assistant answers in words and the handler never runs.
"""

from __future__ import annotations

import pytest
import voluptuous as vol

from custom_components.padspan_ha import fabric_store
from custom_components.padspan_ha import websocket as W
from custom_components.padspan_ha import ws_backup, ws_companion, ws_devices, ws_fabric, ws_follow, ws_guests
from custom_components.padspan_ha import ws_maps, ws_objects, ws_occupancy, ws_radios, ws_settings, ws_vacuum
from custom_components.padspan_ha.ws_common import DEPTH_MAX, NAME_MAX, NOTE_MAX, POSITION_MAX_M, SETTINGS_LIST_MAX


def _field(handler, name):
    for key, validator in handler.ws_schema.items():
        if str(getattr(key, "schema", key)) == name:
            return vol.Schema(validator)
    raise AssertionError(f"{handler.__name__} has no field {name}")


def _refused(handler, name, value) -> bool:
    try:
        _field(handler, name)(value)
    except vol.Invalid:
        return True
    return False


# Names, labels, rooms, ids, addresses and keys: 200 characters.
NAMES = [
    (ws_companion.ws_companion_follow, "ibeacon_key"), (ws_companion.ws_companion_follow, "device_name"),
    (ws_companion.ws_companion_follow, "entity_id"),
    (ws_devices.ws_device_registry_label_set, "label"), (ws_devices.ws_device_registry_label_set, "padspan_id"),
    (ws_devices.ws_device_registry_add_identity, "value"),
    (ws_fabric.ws_fabric_beacon_position_set, "key"), (ws_fabric.ws_fabric_beacon_position_set, "floor_id"),
    (ws_fabric.ws_fabric_beacon_position_set, "room"), (ws_fabric.ws_fabric_beacon_position_set, "kind"),
    (ws_fabric.ws_fabric_beacon_position_set, "label"),
    (ws_fabric.ws_fabric_floor_finalize, "floor_id"),
    (ws_fabric.ws_fabric_light_position_set, "entity_id"), (ws_fabric.ws_fabric_light_position_set, "floor_id"),
    (ws_fabric.ws_fabric_light_position_set, "color"), (ws_fabric.ws_fabric_light_position_set, "shape"),
    (ws_fabric.ws_fabric_light_position_set, "label"),
    (ws_fabric.ws_fabric_map_transform_set, "map_id"),
    (ws_fabric.ws_fabric_room_add, "room"), (ws_fabric.ws_fabric_room_add, "floor_id"),
    (ws_fabric.ws_fabric_scanner_position_set, "source"), (ws_fabric.ws_fabric_scanner_position_set, "floor_id"),
    (ws_follow.ws_follow_alert_save, "addr"),
    (ws_guests.ws_guest_session_update, "name"), (ws_guests.ws_guest_session_update, "notify_target"),
    (ws_objects.ws_label_link_hint_off, "key"),
    (ws_objects.ws_object_label_set, "address"), (ws_objects.ws_object_label_set, "label"),
    (ws_radios.ws_radio_disabled_set, "source"), (ws_radios.ws_radio_lost_set, "source"),
    (ws_maps.ws_maps_update, "map_id"), (ws_maps.ws_maps_update, "floor_id"),
    (ws_settings.ws_settings_set, "espresense_topic_prefix"), (ws_settings.ws_settings_set, "locate_self_key"),
    (ws_vacuum.ws_vacuum_link_set, "walker_tag"), (ws_vacuum.ws_vacuum_link_set, "vacuum_entity"),
]
NOTES = [(ws_backup.ws_store_backup_create, "note"), (ws_maps.ws_maps_update, "notes")]
_IDS = [f"{h.__name__}.{f}" for h, f in NAMES]


@pytest.mark.parametrize(("handler", "name"), NAMES, ids=_IDS)
def test_a_name_takes_200_characters_and_no_nul(handler, name):
    assert not _refused(handler, name, "é" * NAME_MAX) and not _refused(handler, name, "Kitchen ceiling")
    for bad in ("x" * (NAME_MAX + 1), "x" * 100_000, "\x00", "a\x00b"):
        assert _refused(handler, name, bad), (name, bad[:10])


@pytest.mark.parametrize(("handler", "name"), NOTES, ids=[f"{h.__name__}.{f}" for h, f in NOTES])
def test_a_note_takes_2000_characters_and_no_nul(handler, name):
    assert not _refused(handler, name, "n" * NOTE_MAX) and not _refused(handler, name, "line one\nline two")
    for bad in ("n" * (NOTE_MAX + 1), "x" * 100_000, "a\x00b"):
        assert _refused(handler, name, bad)


def test_a_room_for_the_headcount_keeps_its_120_characters_and_takes_no_nul():
    h = ws_occupancy.ws_occupancy_train
    assert not _refused(h, "room", "r" * 120) and _refused(h, "room", "r" * 121) and _refused(h, "room", "a\x00")


def test_rooms_a_guest_may_not_enter_are_names_and_at_most_500():
    h = ws_guests.ws_guest_session_update
    assert not _refused(h, "off_limits", ["Office", "Garage"]) and not _refused(h, "off_limits", ["r"] * 500)
    assert _refused(h, "off_limits", ["r"] * 501) and _refused(h, "off_limits", ["a\x00"])


# Positions in metres: within 10 km of the house's origin.
POSITIONS = [
    (ws_fabric.ws_fabric_beacon_position_set, "x_m"), (ws_fabric.ws_fabric_beacon_position_set, "y_m"),
    (ws_fabric.ws_fabric_light_position_set, "x_m"), (ws_fabric.ws_fabric_light_position_set, "y_m"),
    (ws_fabric.ws_fabric_scanner_position_set, "x_m"), (ws_fabric.ws_fabric_scanner_position_set, "y_m"),
    (ws_fabric.ws_fabric_scanner_position_set, "z_m"),
    (ws_fabric.ws_fabric_map_reanchor, "origin_x_m"), (ws_fabric.ws_fabric_map_reanchor, "origin_y_m"),
    (ws_fabric.ws_fabric_map_reanchor, "scale_x_m"), (ws_fabric.ws_fabric_map_reanchor, "scale_y_m"),
    (W.ws_room_height_set, "height_m"), (W.ws_room_height_set, "floor_raise_m"),
]


@pytest.mark.parametrize(("handler", "name"), POSITIONS, ids=[f"{h.__name__}.{f}" for h, f in POSITIONS])
def test_a_position_is_within_10_km(handler, name):
    for good in (0, 2, -59.1, "3.5", POSITION_MAX_M, -POSITION_MAX_M):
        assert not _refused(handler, name, good), good
    for bad in (1e308, -1e308, POSITION_MAX_M + 1, "nan", "inf"):
        assert _refused(handler, name, bad), bad


def test_a_turn_or_lean_is_a_few_turns_at_most():
    for name in ("rotation_rad", "shear_rad"):
        assert not _refused(ws_fabric.ws_fabric_map_reanchor, name, -3.14)
        assert _refused(ws_fabric.ws_fabric_map_reanchor, name, 1e308)


def test_a_height_above_its_floor_is_within_10_km_for_lights_and_beacons():
    for fn in (ws_fabric.ws_fabric_light_position_set, ws_fabric.ws_fabric_beacon_position_set):
        import inspect
        assert "_height_ok(msg.get(\"z_m\"))" in inspect.getsource(fn)
    assert ws_fabric._height_ok(2.4) and ws_fabric._height_ok(None)
    assert not ws_fabric._height_ok(1e308) and not ws_fabric._height_ok(-1e308)


def test_the_last_health_reminder_is_a_time_in_seconds():
    h = ws_settings.ws_settings_set
    for good in (None, 0, 1_763_600_000, 1_763_600_000.5):
        assert not _refused(h, "health_reminder_last_ts", good)
    for bad in (1e308, -1e308, -1, 1e11):
        assert _refused(h, "health_reminder_last_ts", bad)


# Lists and maps a setting keeps: 5,000 entries.
SETTING_LISTS = ["hidden_map_ids", "followed_addrs", "lights_hidden", "advanced_extra_tabs", "door_composites",
                 "excluded_scanners", "excluded_objects", "ingest_rules", "beacon_tune_disabled",
                 "distance_stationary_devices", "accuracy_tips_hidden", "padspan_automations", "emergency_entities",
                 "atlas_3d_director", "atlas_3d_director_people", "whole_house_presets", "vacation_mode_anchors",
                 "door_opener_ids"]
SETTING_MAPS = ["espresense_room_map", "scanner_offsets", "beacon_group_overrides", "setup_progress",
                "atlas_3d_carries", "light_shapes", "light_type_overrides"]


@pytest.mark.parametrize("name", SETTING_LISTS)
def test_a_settings_list_takes_5000_entries(name):
    h = ws_settings.ws_settings_set
    assert not _refused(h, name, ["a"] * SETTINGS_LIST_MAX) and _refused(h, name, ["a"] * (SETTINGS_LIST_MAX + 1))
    assert _refused(h, name, ["a"] * 10_000)


@pytest.mark.parametrize("name", SETTING_MAPS)
def test_a_settings_map_takes_5000_keys(name):
    h = ws_settings.ws_settings_set
    assert not _refused(h, name, {f"k{i}": "v" for i in range(SETTINGS_LIST_MAX)})
    assert _refused(h, name, {f"k{i}": "v" for i in range(10_000)})


def _nested(levels):
    d: dict = {}
    x = d
    for _ in range(levels - 1):
        x["a"] = {}
        x = x["a"]
    return d


# Dicts and lists a command takes whole: 10 levels.
WHOLE = [(ws_fabric.ws_fabric_map_transform_set, "transform"), (ws_follow.ws_follow_alert_save, "config"),
         (W.ws_model_update, "room_meta"), (ws_maps.ws_maps_update, "calibration"),
         (ws_maps.ws_maps_update, "room_bounds"), (ws_maps.ws_maps_update, "stack"),
         (ws_fabric.ws_fabric_rf_barrier_set, "barrier")]


@pytest.mark.parametrize(("handler", "name"), WHOLE, ids=[f"{h.__name__}.{f}" for h, f in WHOLE])
def test_a_dict_taken_whole_is_at_most_10_levels_deep(handler, name):
    assert not _refused(handler, name, _nested(DEPTH_MAX)) and not _refused(handler, name, {})
    assert _refused(handler, name, _nested(DEPTH_MAX + 1)) and _refused(handler, name, _nested(200))


def test_a_plans_pins_are_at_most_1000_and_its_rooms_500():
    h = ws_maps.ws_maps_update
    for name in ("receivers", "beacons", "lights"):
        assert not _refused(h, name, [{}] * 1000) and _refused(h, name, [{}] * 1001)
        assert _refused(h, name, [{}] * 10_000)
    assert not _refused(h, "room_bounds", {f"r{i}": {} for i in range(500)})
    assert _refused(h, "room_bounds", {f"r{i}": {} for i in range(501)})
    assert _refused(W.ws_model_update, "room_meta", {f"r{i}": {} for i in range(501)})


# A wall keeps a wall's own keys.

def _wall(**extra):
    return {"name": "Hall wall", "points_m": [[0, 0], [3, 0]], "floor_id": "main", "material": "drywall",
            "attenuation_dbm": 3, **extra}


def test_a_wall_keeps_its_own_keys_and_nothing_else():
    out = fabric_store.FabricStore._norm_barrier(_wall(id="bar_1", rail="none", invert_state=True,
                                                       linked_entity_id="binary_sensor.door",
                                                       linked_opener_entity_id=None, linked_lock_entity_id="lock.x",
                                                       zz_missing_field="x", script="<script>", map_id="m1"))
    assert set(out) == {"name", "points_m", "floor_id", "material", "attenuation_dbm", "id", "rail",
                        "invert_state", "linked_entity_id", "linked_opener_entity_id", "linked_lock_entity_id"}
    assert out["points_m"] == [[0.0, 0.0], [3.0, 0.0]] and out["invert_state"] is True


def test_a_wall_of_a_long_or_nul_name_or_too_many_points_is_refused():
    norm = fabric_store.FabricStore._norm_barrier
    assert norm(_wall(name="w" * 200)) is not None
    assert norm(_wall(name="w" * 201)) is None and norm(_wall(name="a\x00b")) is None
    assert norm(_wall(material="m" * 100_000)) is None
    assert norm(_wall(points_m=[[i, 0] for i in range(1000)])) is not None
    assert norm(_wall(points_m=[[i, 0] for i in range(1001)])) is None


def test_what_the_panel_sends_for_a_wall_is_all_kept():
    """views/maps.js sends a stored wall back whole ({...raw, rail}) or the keys
    it names: every one of those is a wall's own."""
    import re
    from pathlib import Path

    js = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
          / "maps.js").read_text(encoding="utf-8")
    sent = set()
    for m in re.finditer(r"(?:setBarrier\(|barrier: )\{([^{}]*)\}", js):
        sent |= {k for k in re.findall(r"(?:^|[,{]\s*)([a-z_]+)\s*:", m.group(1))}
        sent |= {k for k in re.findall(r"(?:^|,)\s*([a-z_]+)\s*(?=,|$)", m.group(1)) if not k.startswith("_")}
    sent -= {"raw", "bar"}
    assert sent and sent <= fabric_store._BARRIER_KEYS, sent - fabric_store._BARRIER_KEYS
