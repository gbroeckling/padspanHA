# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""ESPresense MQTT ingestion.

The module is 370 lines of parsing against a wire format with three traps that
are documented at the top of it and were, until now, guarded by nothing:

  * the scanner identity is ONLY in the topic path, never in the payload, so a
    device heard by three nodes arrives as three messages differing only in the
    last topic segment,
  * rssi and distance are JSON *strings* ("-72.35"), not numbers,
  * MACs are lowercase 12-char hex with no separators.

Each is a silent-wrong-answer if it regresses. The readings still arrive, they
are just attributed to one scanner, or dropped, or filed under an address
nothing else in the system uses. These drive the real callbacks with real
ESPresense payloads.
"""

from __future__ import annotations

import datetime as dt
import json
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import espresense_mqtt as em


class _Msg:
    """What HA's MQTT integration hands a subscriber."""

    def __init__(self, topic: str, payload):
        self.topic = topic
        self.payload = payload


def _esp(prefix: str = "espresense") -> em.EspresenseMqtt:
    e = em.EspresenseMqtt(MagicMock())
    e._prefix = prefix
    return e


def _device_payload(**over) -> str:
    """A real ESPresense devices/ payload: numbers as strings, bare-hex mac."""
    d = {"mac": "aabbccddeeff", "id": "irk:9f2c", "name": "Phone",
         "rssi": "-72.35", "distance": "4.21", "rssi@1m": -59}
    d.update(over)
    return json.dumps(d)


# ── The documented traps ─────────────────────────────────────────────────────

def test_mac_is_normalised_to_ha_form() -> None:
    assert em._normalize_mac("aabbccddeeff") == "AA:BB:CC:DD:EE:FF"


@pytest.mark.parametrize("raw", [
    "aabbccddeeff",        # the documented form
    "AABBCCDDEEFF",
    "aa:bb:cc:dd:ee:ff",   # already separated, and the reason the strip exists
    "AA-BB-CC-DD-EE-FF",
    "aa bb cc dd ee ff",
])
def test_separators_are_stripped_before_regrouping(raw) -> None:
    """Whatever the node sends, one address reaches the rest of the system.

    A MAC that arrives already punctuated must not come out re-punctuated in
    its own style, or the same radio is filed under two addresses and its
    readings never combine.
    """
    assert em._normalize_mac(raw) == "AA:BB:CC:DD:EE:FF"


def test_mac_of_unexpected_length_is_passed_through_not_mangled() -> None:
    """Better an odd address than a confidently wrong one."""
    assert em._normalize_mac("irk:9f2c") == "IRK:9F2C"


@pytest.mark.parametrize("raw,want", [
    ("-72.35", -72.35), (-72.35, -72.35), ("0", 0.0),
    (None, None), ("", None), ("n/a", None), ({}, None),
])
def test_numeric_fields_arrive_as_strings(raw, want) -> None:
    assert em._parse_float(raw) == want


def test_the_scanner_identity_comes_from_the_topic() -> None:
    """One device, three nodes, three readings, kept apart by source alone.

    The payload is byte-identical across all three. If the topic segment stops
    being read they collapse into one reading, and the position solve silently
    loses two of its three ranges.
    """
    e = _esp()
    for node in ("living-room", "bedroom", "garage"):
        e._on_device_message(
            _Msg("espresense/devices/irk:9f2c/" + node, _device_payload()))

    assert set(e._seen) == {"AA:BB:CC:DD:EE:FF"}
    assert set(e._seen["AA:BB:CC:DD:EE:FF"]) == {
        "espresense_living-room", "espresense_bedroom", "espresense_garage"}
    assert e.scanner_count == 3


def test_a_reading_carries_the_parsed_numbers() -> None:
    e = _esp()
    e._on_device_message(_Msg("espresense/devices/irk:9f2c/den", _device_payload()))
    adv = e._seen["AA:BB:CC:DD:EE:FF"]["espresense_den"]
    assert adv.rssi == pytest.approx(-72.35)
    assert adv.distance == pytest.approx(4.21)
    assert adv.ref_rssi == -59
    assert adv.device_id == "irk:9f2c"


# ── Messages that must be ignored rather than half-read ──────────────────────

def test_a_topic_without_a_node_id_is_dropped() -> None:
    """No node_id means no scanner, and a reading with no scanner is noise."""
    e = _esp()
    e._on_device_message(_Msg("espresense/devices/irk:9f2c", _device_payload()))
    assert e._seen == {}
    assert e.scanner_count == 0


def test_a_reading_with_neither_rssi_nor_distance_is_dropped() -> None:
    e = _esp()
    e._on_device_message(_Msg(
        "espresense/devices/irk:9f2c/den",
        _device_payload(rssi=None, distance=None)))
    assert e._seen == {}


def test_malformed_payload_does_not_raise_into_the_mqtt_thread() -> None:
    e = _esp()
    for bad in ("not json", "", "[1,2,3]", b"\xff\xfe"):
        e._on_device_message(_Msg("espresense/devices/irk:9f2c/den", bad))
    assert e._seen == {}


def test_a_multi_level_topic_prefix_still_finds_the_node_id() -> None:
    """prefix_depth is computed, so "home/ble" must work as well as the default."""
    e = _esp("home/ble")
    e._on_device_message(_Msg("home/ble/devices/irk:9f2c/attic", _device_payload()))
    assert set(e._seen["AA:BB:CC:DD:EE:FF"]) == {"espresense_attic"}


def test_bytes_payloads_are_decoded() -> None:
    e = _esp()
    e._on_device_message(_Msg("espresense/devices/irk:9f2c/den",
                              _device_payload().encode("utf-8")))
    assert "AA:BB:CC:DD:EE:FF" in e._seen


# ── The rooms/ topic ─────────────────────────────────────────────────────────

def test_status_marks_a_node_offline_and_back() -> None:
    e = _esp()
    e._on_room_message(_Msg("espresense/rooms/den/status", "online"))
    assert e.online_count == 1
    e._on_room_message(_Msg("espresense/rooms/den/status", "offline"))
    assert e.online_count == 0
    assert e.scanner_count == 1, "an offline node is still a known node"


def test_the_retained_name_replaces_the_slug() -> None:
    e = _esp()
    e._on_room_message(_Msg("espresense/rooms/living-room/status", "online"))
    assert e._scanners["living-room"].room_name == "living-room"
    e._on_room_message(_Msg("espresense/rooms/living-room/name", "Living Room"))
    assert e._scanners["living-room"].room_name == "Living Room"


def test_telemetry_fills_in_ip_and_firmware() -> None:
    e = _esp()
    e._on_room_message(_Msg("espresense/rooms/den/telemetry",
                            json.dumps({"ip": "192.168.1.50", "ver": "3.2.1",
                                        "uptime": 4021, "count": 7})))
    sc = e._scanners["den"]
    assert (sc.ip, sc.firmware, sc.uptime, sc.device_count) == (
        "192.168.1.50", "3.2.1", 4021, 7)


def test_bad_telemetry_leaves_the_node_alone() -> None:
    e = _esp()
    e._on_room_message(_Msg("espresense/rooms/den/telemetry",
                            json.dumps({"ip": "10.0.0.9"})))
    e._on_room_message(_Msg("espresense/rooms/den/telemetry", "{{not json"))
    assert e._scanners["den"].ip == "10.0.0.9"


# ── The snapshot the rest of the system consumes ─────────────────────────────

def test_snapshot_shape_matches_the_bluetooth_live_contract() -> None:
    e = _esp()
    e._on_room_message(_Msg("espresense/rooms/den/name", "Den"))
    e._on_device_message(_Msg("espresense/devices/irk:9f2c/den", _device_payload()))

    snap = e.get_snapshot()
    assert set(snap) == {"radios", "advertisements", "diag"}

    radio = snap["radios"][0]
    assert radio["source"] == "espresense_den"
    assert radio["name"] == "Den (ESPresense)"
    assert radio["espresense"] is True
    assert radio["device_count"] == 1

    ad = snap["advertisements"][0]
    assert ad["address"] == "AA:BB:CC:DD:EE:FF"
    assert ad["rssi"] == -72          # rounded for the contract
    assert ad["tx_power"] == -59      # rssi@1m feeds the path-loss model
    assert ad["espresense_distance"] == pytest.approx(4.21)


def test_snapshot_drops_readings_older_than_max_age() -> None:
    e = _esp()
    e._on_device_message(_Msg("espresense/devices/irk:9f2c/den", _device_payload()))
    adv = e._seen["AA:BB:CC:DD:EE:FF"]["espresense_den"]
    adv.seen = adv.seen - dt.timedelta(seconds=1000)

    assert e.get_snapshot(max_age_s=900)["advertisements"] == []
    assert e.get_snapshot(max_age_s=900)["radios"][0]["device_count"] == 0
    assert e._seen, "inside the prune age, so still cached"


def test_snapshot_prunes_readings_past_the_prune_age() -> None:
    e = _esp()
    e._on_device_message(_Msg("espresense/devices/irk:9f2c/den", _device_payload()))
    adv = e._seen["AA:BB:CC:DD:EE:FF"]["espresense_den"]
    adv.seen = adv.seen - dt.timedelta(seconds=em._PRUNE_AGE_S + 60)

    e.get_snapshot()
    assert e._seen == {}, "past the prune age the address is dropped entirely"


def test_diag_reports_nothing_ok_before_any_node_is_heard() -> None:
    assert _esp().get_snapshot()["diag"]["ok"] is False
