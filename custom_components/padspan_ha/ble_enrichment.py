# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""BLE advertisement enrichment — decode company IDs, service UUIDs, and device types.

Data sources:
  - Bluetooth SIG Assigned Numbers (https://www.bluetooth.com/specifications/assigned-numbers/)
  - Apple Continuity Protocol reverse-engineering (https://github.com/furiousMAC/continuern)
  - GATT Services specification

This module is pure lookup tables — no I/O, no async, no HA dependencies.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


# ─── Bluetooth SIG Company Identifiers ──────────────────────────────────────
# Key: integer company ID from manufacturer_data.  Value: short company name.
# Source: bluetooth.com/specifications/assigned-numbers/company-identifiers/
# Only the ~80 most common BLE advertisers are included to keep the module lean.

COMPANY_IDS: Dict[int, str] = {
    0: "Ericsson",
    1: "Nokia",
    2: "Intel",
    3: "IBM",
    4: "Toshiba",
    5: "3Com",
    6: "Microsoft",
    7: "Lucent",
    8: "Motorola",
    9: "Infineon",
    10: "Qualcomm",
    13: "Texas Instruments",
    15: "Broadcom",
    29: "Harman",
    56: "Samsung",
    57: "Samsung",
    72: "Plantronics",
    76: "Apple",
    77: "Nordic Semiconductor",
    78: "Mitel",
    80: "Garmin",
    89: "Bose",
    117: "Beats Electronics",
    134: "Google",
    137: "Polar Electro",
    152: "Logitech",
    171: "Amazon",
    196: "Huawei",
    224: "Google",
    256: "Tile",
    301: "Sony",
    310: "Xiaomi",
    311: "Xiaomi",
    343: "LG Electronics",
    348: "Samsung",
    353: "Fitbit",
    362: "Ring",
    376: "Fossil",
    387: "Jabra",
    388: "Jabra",
    393: "Withings",
    472: "Peloton",
    474: "Oura",
    501: "Amazfit",
    741: "Espressif",
    757: "Shelly",
    768: "Sonos",
    769: "IKEA",
    936: "Eufy",
    960: "SwitchBot",
    985: "Govee",
    1001: "Meross",
    1177: "Thermopro",
    2: "Intel",
}

# ─── GATT Service UUIDs ─────────────────────────────────────────────────────
# Key: 16-bit UUID as lowercase hex string (no 0x prefix).
# Standard services from bluetooth.com + common vendor-specific 16-bit UUIDs.

SERVICE_UUIDS: Dict[str, str] = {
    # Standard GATT Services
    "1800": "Generic Access",
    "1801": "Generic Attribute",
    "1802": "Immediate Alert",
    "1803": "Link Loss",
    "1804": "Tx Power",
    "1805": "Current Time",
    "1808": "Glucose",
    "1809": "Health Thermometer",
    "180a": "Device Information",
    "180d": "Heart Rate",
    "180e": "Phone Alert Status",
    "180f": "Battery",
    "1810": "Blood Pressure",
    "1811": "Alert Notification",
    "1812": "Human Interface Device",
    "1813": "Scan Parameters",
    "1814": "Running Speed",
    "1815": "Automation IO",
    "1816": "Cycling Speed",
    "1818": "Cycling Power",
    "1819": "Location & Navigation",
    "181a": "Environmental Sensing",
    "181b": "Body Composition",
    "181c": "User Data",
    "181d": "Weight Scale",
    "181e": "Bond Management",
    "1820": "Internet Protocol Support",
    "1821": "Indoor Positioning",
    "1822": "Pulse Oximeter",
    "1823": "HTTP Proxy",
    "1824": "Transport Discovery",
    "1826": "Fitness Machine",
    "1827": "Mesh Provisioning",
    "1828": "Mesh Proxy",
    "183a": "Insulin Delivery",
    "fd6f": "Exposure Notification",
    # Vendor/proprietary 16-bit
    "fe07": "Sonos",
    "fe2c": "Google Fast Pair",
    "fe9f": "Google",
    "fea0": "Google",
    "feaa": "Eddystone",
    "feab": "Nokia",
    "feb9": "Wearable Sensing",
    "febe": "Bose",
    "fec7": "Apple Continuity",
    "fec8": "Apple Continuity",
    "fec9": "Apple Continuity",
    "feca": "Apple Continuity",
    "fed8": "Google",
    "feed": "Tile",
    "fee7": "Tencent",
    "feeb": "Swirl Networks",
    "fff0": "Common Vendor Service",
    "fff1": "Common Vendor Service",
    "fff2": "Common Vendor Service",
    "fff3": "Common Vendor Service",
    "fff4": "Common Vendor Service",
    "fff5": "Common Vendor Service",
}

# ─── Appearance Values (GAP AD type 0x19) ───────────────────────────────────
# Key: 16-bit appearance value.  Value: human-readable category.
# Full list: bluetooth.com/specifications/assigned-numbers/generic-access-profile/

APPEARANCE: Dict[int, str] = {
    0: "Unknown",
    64: "Phone",
    128: "Computer",
    192: "Watch",
    193: "Sports Watch",
    256: "Clock",
    320: "Display",
    384: "Remote Control",
    448: "Eyeglasses",
    512: "Tag",
    576: "Keychain",
    640: "Media Player",
    704: "Barcode Scanner",
    768: "Thermometer",
    832: "Heart Rate Sensor",
    896: "Blood Pressure",
    960: "HID",
    961: "Keyboard",
    962: "Mouse",
    963: "Joystick",
    964: "Gamepad",
    965: "Digitizer Tablet",
    966: "Card Reader",
    967: "Digital Pen",
    968: "Barcode Scanner (HID)",
    1024: "Glucose Meter",
    1088: "Running Walking Sensor",
    1152: "Cycling",
    1216: "Pulse Oximeter",
    1280: "Weight Scale",
    1344: "Outdoor Sports",
}


# ─── Apple Continuity Protocol Subtypes ─────────────────────────────────────
# manufacturer_data key 76 (0x004C = Apple).  First byte of payload = subtype.
# Source: reverse-engineering projects (furiousMAC, hexway, etc.)

APPLE_SUBTYPES: Dict[int, str] = {
    0x01: "Apple Device",
    0x02: "iBeacon",
    0x03: "AirPrint",
    0x05: "AirDrop",
    0x06: "HomeKit",
    0x07: "AirPods",
    0x08: "Siri",
    0x09: "AirPlay",
    0x0A: "Apple Device",
    0x0B: "Magic Switch",
    0x0C: "Handoff",
    0x0D: "Wi-Fi Settings",
    0x0E: "Hotspot",
    0x0F: "Wi-Fi Join",
    0x10: "Nearby Info",
    0x12: "Find My",
    0x13: "Find My",
    0x14: "Find My",
    0x19: "Nearby Action",
}


# ═══════════════════════════════════════════════════════════════════════════════
# Public helpers
# ═══════════════════════════════════════════════════════════════════════════════

def lookup_company(company_id: int) -> Optional[str]:
    """Return company name for a Bluetooth SIG company identifier."""
    return COMPANY_IDS.get(company_id)


def lookup_service_uuid(uuid_str: str) -> Optional[str]:
    """Return human name for a 16-bit GATT service UUID string.

    Accepts formats: "0x180F", "180f", "0000180f-0000-1000-8000-00805f9b34fb".
    """
    u = uuid_str.strip().lower()
    # Strip 0x prefix
    if u.startswith("0x"):
        u = u[2:]
    # Extract 16-bit part from full 128-bit UUID
    if len(u) == 36 and u[8] == "-":
        u = u[4:8]
    # Normalize 4-char hex
    if len(u) <= 4:
        u = u.zfill(4)
    return SERVICE_UUIDS.get(u)


def lookup_appearance(code: int) -> Optional[str]:
    """Return appearance category name for a 16-bit appearance value."""
    if code in APPEARANCE:
        return APPEARANCE[code]
    # Try category (top 6 bits define the category, bottom 10 bits are subcategory)
    category = (code >> 6) << 6
    return APPEARANCE.get(category)


def decode_apple_subtype(manuf_payload: Any) -> Optional[str]:
    """Decode Apple Continuity Protocol subtype from manufacturer_data payload.

    manuf_payload can be:
      - bytes/bytearray (raw)
      - str like "0x12 0x19 0x00 ..." (hex-list format from bluetooth_live.py)
      - list of ints
    """
    try:
        if isinstance(manuf_payload, (bytes, bytearray)):
            if len(manuf_payload) < 1:
                return None
            return APPLE_SUBTYPES.get(manuf_payload[0])
        if isinstance(manuf_payload, str):
            # "0x12 0x19 ..." format
            parts = manuf_payload.strip().split()
            if not parts:
                return None
            first = parts[0]
            if first.startswith("0x") or first.startswith("0X"):
                byte_val = int(first, 16)
            else:
                byte_val = int(first)
            return APPLE_SUBTYPES.get(byte_val)
        if isinstance(manuf_payload, (list, tuple)):
            if not manuf_payload:
                return None
            return APPLE_SUBTYPES.get(int(manuf_payload[0]))
    except (ValueError, IndexError, TypeError):
        pass
    return None


def enrich_object(obj: Dict[str, Any]) -> Dict[str, Any]:
    """Add enrichment fields to a BLE object dict in-place and return it.

    Adds:
      - company_name: str|None — from manufacturer_data company ID
      - device_type: str|None  — specific device type (e.g. "AirPods", "Find My", "Phone")
      - service_names: list[str] — human-readable names for service_uuids
    """
    manuf = obj.get("manufacturer_data") or {}
    svc_uuids = obj.get("service_uuids") or []

    # ── Company name from manufacturer_data keys ──
    company_name = None
    for key in manuf:
        try:
            cid = int(key)
            name = lookup_company(cid)
            if name:
                company_name = name
                break
        except (ValueError, TypeError):
            continue
    obj["company_name"] = company_name

    # ── Device type — Apple Continuity subtype (most specific) ──
    device_type = None
    # Both key forms are checked because manufacturer_data's key type depends
    # on where obj came from: live bleak/HA bluetooth objects use the int
    # company ID (76) directly, while anything that has round-tripped through
    # JSON (websocket capture replay, stored snapshots) turns dict keys into
    # strings ("76") — JSON has no integer-keyed object type.
    apple_payload = manuf.get("76") or manuf.get(76)
    if apple_payload is not None:
        device_type = decode_apple_subtype(apple_payload)

    # Fall back to appearance if we have it
    if not device_type and obj.get("appearance") is not None:
        device_type = lookup_appearance(obj["appearance"])

    obj["device_type"] = device_type

    # ── Service UUID names ──
    service_names: List[str] = []
    service_uuid_map: Dict[str, str] = {}
    seen: set = set()
    for u in svc_uuids:
        ustr = str(u)
        name = lookup_service_uuid(ustr)
        if name:
            service_uuid_map[ustr] = name
            if name not in seen:
                service_names.append(name)
                seen.add(name)
    # Also check service_data keys (e.g. Eddystone "feaa" or full 128-bit UUIDs)
    svc_data = obj.get("service_data") or {}
    for sdk in svc_data:
        sdk_str = str(sdk).lower()
        # Extract short UUID from full 128-bit if it follows the BT SIG base pattern
        short = sdk_str
        if len(sdk_str) > 8 and sdk_str.endswith("-0000-1000-8000-00805f9b34fb"):
            short = sdk_str[:8].lstrip("0") or "0"
        name = lookup_service_uuid(short)
        if not name:
            name = lookup_service_uuid(sdk_str)
        if name:
            service_uuid_map[sdk_str] = name
            if name not in seen:
                service_names.append(name)
                seen.add(name)
    obj["service_names"] = service_names
    obj["service_uuid_map"] = service_uuid_map

    return obj
