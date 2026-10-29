# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Resolving a BLE radio to its HA device (issue #65, p976dtrsg2-droid).

A radio carries a `source` and a display `name`, neither of which is an HA
device id, so the device has to be matched. It used to be matched with a
two-way substring test against every device name, taking the first hit from an
unordered registry:

    if key in src or src in key or key in rname or rname in key:

A proxy called "btproxy" therefore answered to "btproxy_livingroom" and
"btproxy_kitchen" as well. The reporter saw scanners move together when
assigning an area, because the same rule filled in every radio's displayed
area AND chose the device that `radio_area_set` wrote to.

The invariant: containment is not identity. A name that contains another name
is a different device. Where that cannot be decided, no device is returned,
because a scanner with no area is a visible gap and a scanner holding another
scanner's area is a wrong answer that looks right.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

import homeassistant.helpers.device_registry as _dr_mod
from custom_components.padspan_ha.ws_common import RadioDeviceIndex, radio_slug


class _Dev:
    def __init__(self, id, name, name_by_user=None, macs=(), area_id=None):
        self.id = id
        self.name = name
        self.name_by_user = name_by_user
        self.connections = {("mac", m) for m in macs}
        self.area_id = area_id

    def __repr__(self):
        return "<Dev %s %r>" % (self.id, self.name)


@pytest.fixture
def index(monkeypatch):
    """Build a RadioDeviceIndex over a given device list."""
    def _build(devices):
        monkeypatch.setattr(_dr_mod, "async_get",
                            lambda hass: MagicMock(devices={d.id: d for d in devices}),
                            raising=False)
        return RadioDeviceIndex(MagicMock())
    return _build


# The reporter's install: one bare proxy plus two whose names extend it.
_PREFIXED = [
    _Dev("d1", "btproxy"),
    _Dev("d2", "btproxy_livingroom"),
    _Dev("d3", "btproxy_kitchen"),
]


# ── The reported bug ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("source,want", [
    ("btproxy", "d1"),
    ("btproxy_livingroom", "d2"),
    ("btproxy_kitchen", "d3"),
])
def test_a_shared_prefix_no_longer_claims_the_other_scanners(index, source, want) -> None:
    m = index(_PREFIXED).resolve(source)
    assert m.device is not None, "resolved to nothing: " + m.reason
    assert m.device.id == want
    assert m.reason == "name"


def test_the_bare_prefix_device_does_not_answer_for_the_longer_names(index) -> None:
    """The specific wrong answer that was being produced."""
    m = index(_PREFIXED).resolve("btproxy_livingroom")
    assert m.device.id != "d1", "the 'btproxy' device claimed btproxy_livingroom again"


def test_registry_order_does_not_change_the_answer(index) -> None:
    """The old rule took the first hit out of an unordered dict."""
    forward = index(_PREFIXED).resolve("btproxy_livingroom").device.id
    reverse = index(list(reversed(_PREFIXED))).resolve("btproxy_livingroom").device.id
    assert forward == reverse == "d2"


# ── How a whole name is compared ─────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [
    ("Living Room Hub", "living_room_hub"),
    ("living-room-hub", "living_room_hub"),
    ("  Living   Room__Hub  ", "living_room_hub"),
    ("BTProxy", "btproxy"),
])
def test_names_are_compared_as_slugs(raw, want) -> None:
    assert radio_slug(raw) == want


def test_a_friendly_name_matches_a_slug_source(index) -> None:
    """"Living Room Hub" in HA against "living_room_hub" from the scanner."""
    m = index([_Dev("d1", "Living Room Hub"), _Dev("d2", "Kitchen Hub")]).resolve("living_room_hub")
    assert m.device.id == "d1" and m.reason == "name"


def test_the_user_given_name_is_matched_too(index) -> None:
    m = index([_Dev("d1", "esp32-abc123", name_by_user="Attic Proxy")]).resolve("attic_proxy")
    assert m.device.id == "d1"


def test_the_radio_display_name_is_used_when_the_source_does_not_match(index) -> None:
    m = index([_Dev("d1", "Attic Proxy")]).resolve("AA:BB:CC:00:11:22", "Attic Proxy")
    assert m.device.id == "d1"


# ── A MAC is the only identifier that is unique by construction ──────────────

def test_a_mac_source_resolves_through_device_connections(index) -> None:
    devs = [_Dev("d1", "btproxy", macs=["aa:bb:cc:00:11:22"]),
            _Dev("d2", "btproxy_livingroom", macs=["aa:bb:cc:33:44:55"])]
    m = index(devs).resolve("AA:BB:CC:33:44:55")
    assert m.device.id == "d2" and m.reason == "mac"


def test_mac_matching_is_case_and_separator_insensitive(index) -> None:
    m = index([_Dev("d1", "proxy", macs=["AA-BB-CC-00-11-22"])]).resolve("aa:bb:cc:00:11:22")
    assert m.device.id == "d1" and m.reason == "mac"


# ── Ambiguity is refused, not broken arbitrarily ─────────────────────────────

def test_two_devices_with_the_same_name_resolve_to_neither(index) -> None:
    m = index([_Dev("d1", "Hub"), _Dev("d2", "Hub")]).resolve("hub")
    assert m.device is None
    assert m.reason == "ambiguous"
    assert m.candidates == ["Hub", "Hub"], "the caller needs to say which names collide"


def test_an_unresolvable_source_says_so(index) -> None:
    m = index([_Dev("d1", "Kitchen Hub")]).resolve("something_else_entirely")
    assert m.device is None and m.reason == "none"


def test_an_empty_source_and_name_resolve_to_nothing(index) -> None:
    m = index([_Dev("d1", "Kitchen Hub")]).resolve("", "")
    assert m.device is None and m.reason == "none"


# ── Containment survives only where it names exactly one device ──────────────

def test_containment_is_accepted_when_it_is_unambiguous(index) -> None:
    """Keeps installs working where the names are related but not equal."""
    m = index([_Dev("d1", "Living Room Hub BLE Proxy")]).resolve("living_room_hub")
    assert m.device.id == "d1" and m.reason == "partial"


def test_containment_is_refused_when_it_names_several(index) -> None:
    devs = [_Dev("d1", "Hub North Proxy"), _Dev("d2", "Hub South Proxy")]
    m = index(devs).resolve("hub")
    assert m.device is None and m.reason == "ambiguous"
    assert sorted(m.candidates) == ["Hub North Proxy", "Hub South Proxy"]


def test_an_exact_name_beats_a_containment_candidate(index) -> None:
    """"hub" is the whole name of one device and part of another's."""
    m = index([_Dev("d1", "Hub"), _Dev("d2", "Hub Extension Proxy")]).resolve("hub")
    assert m.device.id == "d1" and m.reason == "name"


def test_a_two_character_name_is_not_a_containment_match(index) -> None:
    """Too short to be a name; matching on it is coincidence."""
    m = index([_Dev("d1", "hi")]).resolve("this_contains_hi_somewhere")
    assert m.device is None and m.reason == "none"


def test_a_device_with_no_name_is_not_a_candidate(index) -> None:
    m = index([_Dev("d1", None), _Dev("d2", "Kitchen Hub")]).resolve("kitchen_hub")
    assert m.device.id == "d2"


def test_many_same_named_devices_index_in_linear_time():
    """The index de-duplicated with `dev not in bucket`, comparing whole
    entries field by field (HA's DeviceEntry): quadratic in devices sharing a
    name (4,000 took 1.5 s with real HA objects, on every snapshot build).
    Membership is by identity now, so no entry is ever compared."""
    compared = [0]

    class _Costly(_Dev):
        def __eq__(self, other):
            compared[0] += 1
            return self is other
        __hash__ = object.__hash__

    devs = [_Costly(f"d{i}", "Same Name") for i in range(3000)]
    reg = MagicMock()
    reg.devices = {d.id: d for d in devs}
    from unittest.mock import patch
    import custom_components.padspan_ha.ws_common as WC
    with patch.object(_dr_mod, "async_get", return_value=reg), patch.object(WC, "ha_devices", lambda r: devs):
        idx = RadioDeviceIndex(MagicMock())
        assert idx.resolve("same_name").reason == "ambiguous"
    assert compared[0] == 0
    assert idx.same_name_max == 3000 and idx.devices_n == 3000


# ═══ Shelly: its scanner goes by the Bluetooth MAC, its device by the network MAC ═══
#
# Home Assistant's Shelly integration registers the scanner under
# format_mac(bluetooth_mac_from_primary_mac(mac)).upper(), the network MAC + 2
# (aioshelly), while the device it files lists only (CONNECTION_NETWORK_MAC,
# mac). Before 0.38.175 the scanner found its device by name or not at all, and
# "set this scanner's room" (radio_area_set), which looks up the source alone,
# answered "Could not find HA device for this radio source".

def _shelly(id, name, mac, name_by_user=None):
    d = _Dev(id, name, name_by_user=name_by_user, macs=[mac])
    d.identifiers = {("shelly", mac.replace(":", "").lower())}
    return d


def test_a_shelly_scanner_finds_its_device_by_its_bluetooth_mac(index) -> None:
    m = index([_shelly("d1", "Kitchen Light", "a8:03:2a:b1:23:45")]).resolve("A8:03:2A:B1:23:47")
    assert m.device.id == "d1" and m.reason == "mac"


def test_even_when_its_names_have_drifted_apart(index) -> None:
    # The scanner keeps the entry's title; the device was renamed in HA.
    devs = [_shelly("d1", "shellyplus1pm-a8032ab12345", "a8:03:2a:b1:23:45", name_by_user="Hall light"),
            _Dev("d2", "Kitchen Hub")]
    m = index(devs).resolve("A8:03:2A:B1:23:47", "shellyplus1pm-a8032ab12345 (A8:03:2A:B1:23:47)")
    assert m.device.id == "d1" and m.reason == "mac"


def test_the_plus_two_carries_across_octets(index) -> None:
    m = index([_shelly("d1", "Porch", "a8:03:2a:b1:00:ff")]).resolve("A8:03:2A:B1:01:01")
    assert m.device.id == "d1"


def test_only_shelly_devices_get_the_rule(index) -> None:
    # Another integration's device two addresses below a scanner is not it.
    m = index([_Dev("d1", "Some Plug", macs=["a8:03:2a:b1:23:45"])]).resolve("A8:03:2A:B1:23:47")
    assert m.device is None and m.reason == "none"


def test_a_device_that_lists_the_mac_itself_still_wins(index) -> None:
    # ESPHome lists its Bluetooth MAC among its connections: a direct match.
    devs = [_shelly("d1", "Kitchen Light", "a8:03:2a:b1:23:45"),
            _Dev("d2", "esp-proxy", macs=["a8:03:2a:b1:23:47"])]
    assert index(devs).resolve("A8:03:2A:B1:23:47").device.id == "d2"


def test_setting_a_shellys_room_finds_its_device(index) -> None:
    # radio_area_set resolves the source alone, with no name to fall back on.
    m = index([_shelly("d1", "Kitchen Light", "a8:03:2a:b1:23:45")]).resolve("A8:03:2A:B1:23:47")
    assert m.device is not None and m.device.id == "d1"


# ═══ A scanner's own device with no area takes the area of the device it belongs to ═══
#
# Since 2025.2 Home Assistant files each remote Bluetooth scanner as its own
# device under the Bluetooth integration (connections: its Bluetooth MAC), with
# via_device_id the device that provides it, and copies that device's area only
# when the scanner's device is set up and has none (bluetooth/__init__.py
# async_update_device). A Shelly given its area after its scanner appeared had a
# scanner with no area, so no room, until Home Assistant's next start.

def test_a_scanner_device_without_an_area_takes_its_shellys(index) -> None:
    shelly = _shelly("d1", "Kitchen Light", "a8:03:2a:b1:23:45")
    shelly.area_id = "kitchen"
    scanner = _Dev("d2", "Kitchen Light (A8:03:2A:B1:23:47)", macs=["a8:03:2a:b1:23:47"])
    scanner.via_device_id = "d1"
    idx = index([shelly, scanner])
    m = idx.resolve("A8:03:2A:B1:23:47", "Kitchen Light (A8:03:2A:B1:23:47)")
    assert m.device.id == "d2"                      # HA's scanner device, by its MAC
    assert idx.area_id_of(m.device) == "kitchen"     # ...with the Shelly's area


def test_a_scanner_devices_own_area_wins(index) -> None:
    shelly = _shelly("d1", "Kitchen Light", "a8:03:2a:b1:23:45")
    shelly.area_id = "kitchen"
    scanner = _Dev("d2", "Kitchen Light (A8:03:2A:B1:23:47)", macs=["a8:03:2a:b1:23:47"], area_id="hall")
    scanner.via_device_id = "d1"
    idx = index([shelly, scanner])
    assert idx.area_id_of(scanner) == "hall"


def test_no_area_anywhere_is_no_area(index) -> None:
    scanner = _Dev("d2", "Proxy (A8:03:2A:B1:23:47)", macs=["a8:03:2a:b1:23:47"])
    scanner.via_device_id = "missing"
    idx = index([scanner, _Dev("d3", "Lone")])
    assert idx.area_id_of(scanner) is None
    assert idx.area_id_of(idx.resolve("lone").device) is None


def test_the_shelly_rules_are_counted_for_the_report(index) -> None:
    # 0.38.175 and 0.38.176's field signal: how often each rule decided a radio.
    shelly = _shelly("d1", "Kitchen Light", "a8:03:2a:b1:23:45")
    shelly.area_id = "kitchen"
    scanner = _Dev("d2", "Porch (A8:03:2A:B1:99:99)", macs=["a8:03:2a:b1:99:99"])
    scanner.via_device_id = "d1"
    idx = index([shelly, scanner, _Dev("d3", "esp-proxy", macs=["11:22:33:44:55:66"], area_id="hall")])
    assert (idx.shelly_matched, idx.area_from_via) == (0, 0)
    idx.resolve("A8:03:2A:B1:23:47")                       # by the Shelly's MAC + 2
    idx.resolve("11:22:33:44:55:66")                       # a plain MAC match
    idx.area_id_of(scanner)                                # the Shelly's area
    idx.area_id_of(idx.resolve("11:22:33:44:55:66").device)   # its own area
    assert (idx.shelly_matched, idx.area_from_via) == (1, 1)
