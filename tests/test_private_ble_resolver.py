"""Unit tests for custom_components.padspan_ha.private_ble_resolver."""

from __future__ import annotations

import base64

import pytest

from custom_components.padspan_ha.private_ble_resolver import (
    PrivateBLEResolver,
    _is_rpa,
    _parse_irk,
)


# ---------------------------------------------------------------------------
# Tests: _is_rpa
# ---------------------------------------------------------------------------


def test_is_rpa_valid_lower_bound() -> None:
    """0x40 top byte → bits 7-6 = 01 → valid RPA."""
    assert _is_rpa("40:00:00:00:00:00") is True


def test_is_rpa_valid_upper_bound() -> None:
    """0x7F top byte → bits 7-6 = 01 → valid RPA."""
    assert _is_rpa("7F:00:00:00:00:00") is True


def test_is_rpa_valid_mid() -> None:
    """0x5A top byte → bits 7-6 = 01 → valid RPA."""
    assert _is_rpa("5A:11:22:33:44:55") is True


def test_is_rpa_invalid_zero() -> None:
    """0x00 top byte → bits 7-6 = 00 → not RPA."""
    assert _is_rpa("00:00:00:00:00:00") is False


def test_is_rpa_invalid_public() -> None:
    """0xFF top byte → bits 7-6 = 11 → not RPA (static random)."""
    assert _is_rpa("FF:00:00:00:00:00") is False


def test_is_rpa_invalid_non_resolvable() -> None:
    """0x00-0x3F → bits 7-6 = 00 → not RPA."""
    assert _is_rpa("3F:00:00:00:00:00") is False


def test_is_rpa_invalid_high_bit() -> None:
    """0x80 → bits 7-6 = 10 → not RPA."""
    assert _is_rpa("80:00:00:00:00:00") is False


def test_is_rpa_malformed_address() -> None:
    """Non-MAC strings return False."""
    assert _is_rpa("not-a-mac") is False
    assert _is_rpa("") is False
    assert _is_rpa("ZZ:ZZ:ZZ:ZZ:ZZ:ZZ") is False


def test_is_rpa_lowercase() -> None:
    """Lowercase hex works."""
    assert _is_rpa("4a:bb:cc:dd:ee:ff") is True


# ---------------------------------------------------------------------------
# Tests: _parse_irk
# ---------------------------------------------------------------------------


_VALID_HEX = "0123456789abcdef0123456789abcdef"  # 32 chars = 16 bytes


def test_parse_irk_hex_32() -> None:
    """32-char hex string → 16 bytes."""
    result = _parse_irk(_VALID_HEX)
    assert result is not None
    assert len(result) == 16
    assert result == bytes.fromhex(_VALID_HEX)


def test_parse_irk_hex_with_colons() -> None:
    """Hex with colon separators."""
    with_colons = ":".join(_VALID_HEX[i : i + 2] for i in range(0, 32, 2))
    result = _parse_irk(with_colons)
    assert result is not None
    assert len(result) == 16


def test_parse_irk_hex_with_spaces() -> None:
    """Hex with space separators."""
    with_spaces = " ".join(_VALID_HEX[i : i + 2] for i in range(0, 32, 2))
    result = _parse_irk(with_spaces)
    assert result is not None
    assert len(result) == 16


def test_parse_irk_base64() -> None:
    """Base64-encoded 16-byte IRK."""
    irk_bytes = bytes.fromhex(_VALID_HEX)
    b64 = base64.b64encode(irk_bytes).decode()
    result = _parse_irk(b64)
    assert result == irk_bytes


def test_parse_irk_raw_bytes() -> None:
    """Raw bytes input."""
    irk_bytes = bytes.fromhex(_VALID_HEX)
    result = _parse_irk(irk_bytes)
    assert result == irk_bytes


def test_parse_irk_wrong_length_hex() -> None:
    """Hex string of wrong length → None."""
    assert _parse_irk("0123456789abcdef") is None  # only 8 bytes


def test_parse_irk_wrong_length_bytes() -> None:
    """Bytes of wrong length → None."""
    assert _parse_irk(b"\x01\x02\x03\x04") is None


def test_parse_irk_none() -> None:
    """None input → None."""
    assert _parse_irk(None) is None


def test_parse_irk_empty_string() -> None:
    """Empty string → None."""
    assert _parse_irk("") is None


def test_parse_irk_garbage() -> None:
    """Non-hex, non-base64 garbage → None."""
    assert _parse_irk("this is not an irk at all!!!!") is None


# ---------------------------------------------------------------------------
# Tests: parse_ibeacon
# ---------------------------------------------------------------------------


def _make_ibeacon_payload(
    uuid_hex: str = "00112233445566778899aabbccddeeff",
    major: int = 1,
    minor: int = 2,
    tx_power: int = -59,
) -> bytes:
    """Build a valid iBeacon manufacturer_data payload."""
    payload = bytearray()
    payload.append(0x02)  # subtype
    payload.append(0x15)  # length marker
    payload.extend(bytes.fromhex(uuid_hex))
    payload.extend(major.to_bytes(2, "big"))
    payload.extend(minor.to_bytes(2, "big"))
    # TX power as unsigned byte (signed → unsigned)
    payload.append(tx_power & 0xFF)
    return bytes(payload)


def test_parse_ibeacon_valid() -> None:
    """Valid iBeacon payload parses correctly."""
    payload = _make_ibeacon_payload()
    result = PrivateBLEResolver.parse_ibeacon({76: payload})
    assert result is not None
    assert result["uuid"] == "00112233-4455-6677-8899-aabbccddeeff"
    assert result["major"] == 1
    assert result["minor"] == 2
    assert result["tx_power"] == -59


def test_parse_ibeacon_tx_power_negative() -> None:
    """TX power is interpreted as signed int8."""
    payload = _make_ibeacon_payload(tx_power=-1)
    result = PrivateBLEResolver.parse_ibeacon({76: payload})
    assert result is not None
    assert result["tx_power"] == -1


def test_parse_ibeacon_tx_power_zero() -> None:
    """TX power of 0."""
    payload = _make_ibeacon_payload(tx_power=0)
    result = PrivateBLEResolver.parse_ibeacon({76: payload})
    assert result is not None
    assert result["tx_power"] == 0


def test_parse_ibeacon_major_minor() -> None:
    """Major and minor parsed as big-endian 16-bit."""
    payload = _make_ibeacon_payload(major=256, minor=512)
    result = PrivateBLEResolver.parse_ibeacon({76: payload})
    assert result is not None
    assert result["major"] == 256
    assert result["minor"] == 512


def test_parse_ibeacon_string_key() -> None:
    """String key '76' works."""
    payload = _make_ibeacon_payload()
    result = PrivateBLEResolver.parse_ibeacon({"76": payload})
    assert result is not None
    assert result["uuid"] == "00112233-4455-6677-8899-aabbccddeeff"


def test_parse_ibeacon_hex_string_payload() -> None:
    """Hex-space string payload (HA format)."""
    payload = _make_ibeacon_payload()
    hex_str = " ".join(f"0x{b:02X}" for b in payload)
    result = PrivateBLEResolver.parse_ibeacon({76: hex_str})
    assert result is not None
    assert result["major"] == 1


def test_parse_ibeacon_wrong_subtype() -> None:
    """Non-iBeacon Apple subtype returns None."""
    payload = bytearray(_make_ibeacon_payload())
    payload[0] = 0x07  # AirPods, not iBeacon
    result = PrivateBLEResolver.parse_ibeacon({76: bytes(payload)})
    assert result is None


def test_parse_ibeacon_too_short() -> None:
    """Payload shorter than 23 bytes returns None."""
    result = PrivateBLEResolver.parse_ibeacon({76: b"\x02\x15\x00\x01"})
    assert result is None


def test_parse_ibeacon_empty_dict() -> None:
    """Empty manufacturer_data returns None."""
    result = PrivateBLEResolver.parse_ibeacon({})
    assert result is None


def test_parse_ibeacon_no_apple_key() -> None:
    """Non-Apple company ID returns None."""
    payload = _make_ibeacon_payload()
    result = PrivateBLEResolver.parse_ibeacon({56: payload})  # Samsung
    assert result is None


# ---------------------------------------------------------------------------
# Tests: get_status source_info join
# ---------------------------------------------------------------------------


def test_get_status_duplicate_names_keep_correct_entry_ids() -> None:
    """Devices with identical titles must keep their OWN entry_id/source.

    _devices and _source_info are appended in lockstep; the old name-keyed
    join collapsed duplicate titles so every row got the LAST device's
    entry_id — the Delete button then removed the wrong config entry.
    """
    from unittest.mock import MagicMock

    r = PrivateBLEResolver.__new__(PrivateBLEResolver)
    r._hass = MagicMock()
    r._hass.config_entries.async_entries = MagicMock(return_value=[])
    r._devices = [
        {"canonical_id": "irk:aa", "name": "iPhone", "irk_bytes": b"\x00" * 16},
        {"canonical_id": "irk:bb", "name": "iPhone", "irk_bytes": b"\x01" * 16},
    ]
    r._source_info = [
        {"name": "iPhone", "source": "private_ble_device", "entry_id": "entry_A"},
        {"name": "iPhone", "source": "mobile_app", "entry_id": "entry_B"},
    ]
    st = r.get_status()
    assert [d["entry_id"] for d in st["devices"]] == ["entry_A", "entry_B"]
    assert [d["source"] for d in st["devices"]] == ["private_ble_device", "mobile_app"]
    assert [d["canonical_id"] for d in st["devices"]] == ["irk:aa", "irk:bb"]
