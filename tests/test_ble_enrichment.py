"""Unit tests for custom_components.padspan_ha.ble_enrichment."""

from __future__ import annotations

import pytest

from custom_components.padspan_ha.ble_enrichment import (
    APPLE_SUBTYPES,
    SERVICE_UUIDS,
    decode_apple_subtype,
    enrich_object,
    lookup_appearance,
    lookup_company,
    lookup_service_uuid,
)


# ---------------------------------------------------------------------------
# Tests: lookup_company
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "company_id, expected",
    [
        (76, "Apple"),
        (117, "Samsung Electronics"),
        (224, "Google"),
        (911, "Xiaomi"),
        (0x067C, "Tile"),
        (0, "Ericsson"),
        (741, "Espressif Systems"),
    ],
)
def test_lookup_company_known(company_id: int, expected: str) -> None:
    """Known company IDs return the right name."""
    assert lookup_company(company_id) == expected


def test_lookup_company_unknown() -> None:
    """Unknown company ID returns None."""
    assert lookup_company(99999) is None
    assert lookup_company(-1) is None


# ---------------------------------------------------------------------------
# Tests: lookup_service_uuid
# ---------------------------------------------------------------------------


def test_lookup_service_uuid_lowercase() -> None:
    """Lowercase 4-char hex string."""
    assert lookup_service_uuid("180f") == "Battery"
    assert lookup_service_uuid("180a") == "Device Information"


def test_lookup_service_uuid_0x_prefix() -> None:
    """0x-prefixed format."""
    assert lookup_service_uuid("0x180F") == "Battery"
    assert lookup_service_uuid("0x180f") == "Battery"


def test_lookup_service_uuid_full_128bit() -> None:
    """Full 128-bit UUID extracts the 16-bit part."""
    assert lookup_service_uuid("0000180f-0000-1000-8000-00805f9b34fb") == "Battery"


def test_lookup_service_uuid_short() -> None:
    """Short UUID gets zero-padded."""
    # "1800" → Generic Access; test that shorter strings still work
    assert lookup_service_uuid("1800") == "Generic Access"


def test_lookup_service_uuid_tile() -> None:
    """Tile's vendor UUID."""
    assert lookup_service_uuid("feed") == "Tile"
    assert lookup_service_uuid("FEED") == "Tile"
    assert lookup_service_uuid("0xFEED") == "Tile"


def test_lookup_service_uuid_unknown() -> None:
    """Unknown UUID returns None."""
    assert lookup_service_uuid("ffff") is None
    assert lookup_service_uuid("0000") is None


def test_lookup_service_uuid_whitespace() -> None:
    """Leading/trailing whitespace is stripped."""
    assert lookup_service_uuid("  180f  ") == "Battery"


# ---------------------------------------------------------------------------
# Tests: lookup_appearance
# ---------------------------------------------------------------------------


def test_lookup_appearance_exact() -> None:
    """Exact appearance codes."""
    assert lookup_appearance(64) == "Phone"
    assert lookup_appearance(192) == "Watch"
    assert lookup_appearance(512) == "Tag"
    assert lookup_appearance(961) == "Keyboard"


def test_lookup_appearance_category_fallback() -> None:
    """Subcategory codes fall back to category (top 6 bits)."""
    # 962 = Mouse, exact match
    assert lookup_appearance(962) == "Mouse"
    # 970 doesn't exist — category = (970 >> 6) << 6 = 960 = "HID"
    assert lookup_appearance(970) == "HID"


def test_lookup_appearance_unknown() -> None:
    """Unknown appearance returns None."""
    assert lookup_appearance(9999) is None


# ---------------------------------------------------------------------------
# Tests: decode_apple_subtype
# ---------------------------------------------------------------------------


def test_decode_apple_subtype_bytes() -> None:
    """Decode from raw bytes."""
    assert decode_apple_subtype(bytes([0x02])) == "iBeacon"
    assert decode_apple_subtype(bytes([0x12])) == "Find My"
    assert decode_apple_subtype(bytes([0x07])) == "AirPods"
    assert decode_apple_subtype(bytes([0x10])) == "Nearby Info"


def test_decode_apple_subtype_hex_string() -> None:
    """Decode from hex-list string (bluetooth_live.py format)."""
    assert decode_apple_subtype("0x12 0x19 0x00") == "Find My"
    assert decode_apple_subtype("0x02 0x15 0xAA") == "iBeacon"
    assert decode_apple_subtype("0x07 0x01") == "AirPods"


def test_decode_apple_subtype_list() -> None:
    """Decode from list of ints."""
    assert decode_apple_subtype([0x12]) == "Find My"
    assert decode_apple_subtype([0x02, 0x15]) == "iBeacon"


def test_decode_apple_subtype_empty() -> None:
    """Empty inputs return None."""
    assert decode_apple_subtype(b"") is None
    assert decode_apple_subtype("") is None
    assert decode_apple_subtype([]) is None
    assert decode_apple_subtype(()) is None


def test_decode_apple_subtype_unknown_byte() -> None:
    """Unknown subtype byte returns None."""
    assert decode_apple_subtype(bytes([0xFF])) is None
    assert decode_apple_subtype("0xFF") is None


def test_decode_apple_subtype_none() -> None:
    """None input returns None."""
    assert decode_apple_subtype(None) is None


def test_decode_apple_subtype_garbage_string() -> None:
    """Non-hex garbage string returns None."""
    assert decode_apple_subtype("not hex data") is None


# ---------------------------------------------------------------------------
# Tests: enrich_object
# ---------------------------------------------------------------------------


def test_enrich_object_empty() -> None:
    """Empty dict gets all enrichment fields set to None/empty."""
    obj = enrich_object({})
    assert obj["company_name"] is None
    assert obj["device_type"] is None
    assert obj["service_names"] == []
    assert obj["service_uuid_map"] == {}


def test_enrich_object_apple_airtag() -> None:
    """Apple Find My device gets company + device type."""
    obj = {
        "manufacturer_data": {76: bytes([0x12, 0x19, 0x00])},
    }
    enrich_object(obj)
    assert obj["company_name"] == "Apple"
    assert obj["device_type"] == "Find My"


def test_enrich_object_apple_string_key() -> None:
    """manufacturer_data with string key '76' also works."""
    obj = {
        "manufacturer_data": {"76": "0x07 0x01"},
    }
    enrich_object(obj)
    assert obj["company_name"] == "Apple"
    assert obj["device_type"] == "AirPods"


def test_enrich_object_samsung() -> None:
    """Samsung device gets company name, no Apple device type."""
    obj = {
        "manufacturer_data": {117: b"\x01\x02\x03"},
    }
    enrich_object(obj)
    assert obj["company_name"] == "Samsung Electronics"
    assert obj["device_type"] is None


def test_enrich_object_with_services() -> None:
    """Service UUIDs are mapped to human names."""
    obj = {
        "service_uuids": ["180f", "180a", "feed"],
    }
    enrich_object(obj)
    assert "Battery" in obj["service_names"]
    assert "Device Information" in obj["service_names"]
    assert obj["company_name"] is None and obj["service_owner"] == "Tile", "the company that holds feed"
    assert "Tile" not in obj["service_names"], "the owner isn't repeated as a service"
    assert obj["service_uuid_map"]["180f"] == "Battery"
    assert obj["service_uuid_map"]["feed"] == "Tile"


def test_enrich_object_deduplicates_service_names() -> None:
    """Duplicate service names are not repeated."""
    obj = {
        "service_uuids": ["fff0", "fff1", "fff2"],
    }
    enrich_object(obj)
    # All three map to "Common Vendor Service"
    assert obj["service_names"].count("Common Vendor Service") == 1


def test_enrich_object_unknown_services_skipped() -> None:
    """Unknown service UUIDs don't appear in service_names."""
    obj = {
        "service_uuids": ["180f", "9999"],
    }
    enrich_object(obj)
    assert obj["service_names"] == ["Battery"]
    assert "9999" not in obj["service_uuid_map"]


def test_enrich_object_appearance_fallback() -> None:
    """When no Apple subtype, appearance provides device_type."""
    obj = {
        "manufacturer_data": {117: b"\x01"},  # Samsung, no Apple data
        "appearance": 192,
    }
    enrich_object(obj)
    assert obj["device_type"] == "Watch"


def test_enrich_object_apple_subtype_over_appearance() -> None:
    """Apple subtype takes priority over appearance."""
    obj = {
        "manufacturer_data": {76: bytes([0x12, 0x19])},
        "appearance": 64,  # Phone
    }
    enrich_object(obj)
    assert obj["device_type"] == "Find My"  # not "Phone"


def test_enrich_object_returns_same_dict() -> None:
    """enrich_object modifies in-place and returns the same dict."""
    obj = {"manufacturer_data": {76: bytes([0x02])}}
    result = enrich_object(obj)
    assert result is obj


def test_enrich_object_no_manufacturer_data() -> None:
    """Missing manufacturer_data doesn't crash."""
    obj = {"service_uuids": ["180f"]}
    enrich_object(obj)
    assert obj["company_name"] is None
    assert obj["service_names"] == ["Battery"]


def test_enrich_object_manufacturer_data_string_company_id() -> None:
    """Company ID as string key works for non-Apple vendors."""
    obj = {
        "manufacturer_data": {"911": b"\x01\x02"},
    }
    enrich_object(obj)
    assert obj["company_name"] == "Xiaomi"
