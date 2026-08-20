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
