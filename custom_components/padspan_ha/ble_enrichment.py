# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""BLE advertisement enrichment — decode company IDs, service UUIDs, and device types.

Data sources:
  - Bluetooth SIG and IEEE lists, as generated tables (device_tables.py)
  - Apple Continuity Protocol reverse-engineering (https://github.com/furiousMAC/continuity)
  - GATT Services specification

This module is pure lookups — no I/O, no async, no HA dependencies. The company,
service-owner and address tables answer once device_tables has loaded them.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import device_tables


# ─── GATT Service UUIDs ─────────────────────────────────────────────────────
# Key: 16-bit UUID as lowercase hex string (no 0x prefix).
# Standard services from bluetooth.com + vendor-specific 16-bit UUIDs that say more
# than their owner's name; any other UUID a company holds answers with the company
# (lookup_service_owner).

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
    "fcd2": "BTHome",
    "feab": "Nokia",
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
    return device_tables.company(company_id)


_SIG_BASE_TAIL = "-0000-1000-8000-00805f9b34fb"


def _uuid16(uuid_str: str) -> Optional[str]:
    """A UUID's 16-bit form, or None when it hasn't one.

    Accepts "0x180F", "180f", "0000180f-0000-1000-8000-00805f9b34fb". Only a
    128-bit UUID on the Bluetooth base has a 16-bit form: taking those four
    digits out of any other read "abcd1800-1111-..." as Generic Access.
    """
    u = uuid_str.strip().lower()
    if u.startswith("0x"):
        u = u[2:]
    if len(u) == 36:
        return u[4:8] if u.startswith("0000") and u.endswith(_SIG_BASE_TAIL) else None
    return u.zfill(4) if len(u) <= 4 else None


def lookup_service_uuid(uuid_str: str) -> Optional[str]:
    """Return a human name for a service UUID: the service's own, else the
    company that holds the UUID."""
    u = _uuid16(uuid_str)
    if u is None:
        return None
    return SERVICE_UUIDS.get(u) or device_tables.service_owner(u)


def lookup_service_owner(uuid_str: str) -> Optional[str]:
    """Which company holds this service UUID, per Bluetooth SIG's member list."""
    u = _uuid16(uuid_str)
    return device_tables.service_owner(u) if u is not None else None


# Open formats: a company holds the UUID, and anyone's hardware sends it. Like
# Apple's number on an iBeacon, they don't say who made the device: Eddystone,
# Fast Pair, BTHome, Exposure Notification, and FCB2, the format location
# trackers of any brand must send (Apple holds it).
_OPEN_FORMAT_UUIDS = frozenset({"feaa", "fe2c", "fcd2", "fd6f", "fcb2"})


def _owner_of_service(uuid_str: str) -> Optional[str]:
    """The company whose service a device broadcasts, open formats aside. That
    company often didn't make the device: a CP27 beacon's service is Neurostim
    OAB's, a Feasycom's Dialog Semiconductor's. So it's never a maker."""
    return None if _uuid16(uuid_str) in _OPEN_FORMAT_UUIDS else lookup_service_owner(uuid_str)


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


def _is_ibeacon_payload(payload: Any) -> bool:
    """Does this Apple-numbered block start 02 15, the iBeacon format?"""
    try:
        if isinstance(payload, (bytes, bytearray, list, tuple)):
            return len(payload) >= 2 and int(payload[0]) == 0x02 and int(payload[1]) == 0x15
        if isinstance(payload, str):
            parts = payload.strip().split()
            return len(parts) >= 2 and int(parts[0], 16) == 0x02 and int(parts[1], 16) == 0x15
    except (ValueError, TypeError):
        pass
    return False


# ESPresense's id for a device it has no address for. Its ids start with what
# it recognised; only these say who made the thing. An "iBeacon:" id doesn't:
# anyone's hardware can send one.
_ESPRESENSE_MAKERS = {"apple": 0x004C, "msft": 0x0006, "tile": 0x067C}


def _maker_from_espresense_id(device_id: Any) -> Optional[str]:
    """The maker in an ESPresense fingerprint id: apple:..., msft:..., tile:...,
    md:<company number in hex>:..., else None."""
    head, sep, rest = str(device_id or "").partition(":")
    if not sep:
        return None
    cid = _ESPRESENSE_MAKERS.get(head)
    if cid is not None:
        return lookup_company(cid)
    if head == "md":
        try:
            return lookup_company(int(rest.split(":")[0], 16))
        except ValueError:
            return None
    return None


def _owner_from_espresense_id(device_id: Any) -> Optional[str]:
    """The service owner in an ESPresense id, sd:<service UUID>...; a 128-bit
    UUID has its first dash at [8]."""
    head, sep, rest = str(device_id or "").partition(":")
    if head != "sd" or not sep or len(rest) < 4 or rest[8:9] == "-":
        return None
    return _owner_of_service(rest[:4])


def apply_address_maker(obj: Dict[str, Any], address: Any, address_type: Optional[str]) -> None:
    """Fill in the maker from the built-in address list, when the broadcast didn't say.

    address_type is what a radio reported. A confirmed public address really is
    maker-assigned: company_name, maker_source "address". A confirmed random
    address means nothing to the list and is never looked up. With no word from
    a radio (Tasmota, Shelly, ESPresense, or an address not heard lately) a hit
    is only likely, since a random address can match a block by chance, so it
    goes in maker_guess and the panel words it "probably". Bits 0x01 and 0x02
    of the first byte mark an address IEEE didn't assign, so those aren't tried.
    """
    if obj.get("company_name") or address_type == "random":
        return
    try:
        first = int(str(address).split(":")[0], 16)
    except (ValueError, IndexError):
        return
    if address_type != "public" and first & 0x03:
        return
    maker = device_tables.address_maker(address)
    if not maker:
        return
    if address_type == "public":
        obj["company_name"] = maker
        obj["maker_source"] = "address"
    else:
        obj["maker_guess"] = maker


def enrich_object(obj: Dict[str, Any]) -> Dict[str, Any]:
    """Add enrichment fields to a BLE object dict in-place and return it.

    Adds:
      - company_name: str|None — who made it, from what its broadcast says
      - maker_source: str|None — how that is known: "company_id" or "espresense"
        ("address" comes later, from apply_address_maker)
      - service_owner: str|None — whose service it broadcasts, which isn't a maker
      - device_type: str|None  — specific device type (e.g. "AirPods", "Find My", "Phone")
      - service_names: list[str] — human-readable names for service_uuids
    """
    manuf = obj.get("manufacturer_data") or {}
    svc_uuids = obj.get("service_uuids") or []
    # Advert rows are bluetooth_live's own records, enriched again each build.
    obj.pop("maker_guess", None)

    # ── Company name from manufacturer_data keys ──
    # The iBeacon format requires Apple's number whoever made the beacon, so
    # there it says nothing about the maker.
    company_name = None
    maker_source = None
    for key in manuf:
        try:
            cid = int(key)
            if cid == 0x004C and _is_ibeacon_payload(manuf[key]):
                continue
            name = lookup_company(cid)
            if name:
                company_name = name
                maker_source = "company_id"
                break
        except (ValueError, TypeError):
            continue

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

    # ── No company number: what ESPresense recognised ──
    if not company_name:
        company_name = _maker_from_espresense_id(obj.get("espresense_id"))
        if company_name:
            maker_source = "espresense"
    obj["company_name"] = company_name
    obj["maker_source"] = maker_source

    # ── Whose service it broadcasts. Kept apart from the maker ──
    owner = None
    for u in [*svc_uuids, *svc_data]:
        owner = _owner_of_service(str(u))
        if owner:
            break
    owner = owner or _owner_from_espresense_id(obj.get("espresense_id"))
    if owner and owner != company_name:
        obj["service_owner"] = owner
    else:
        obj.pop("service_owner", None)

    # Shown on their own; the same word again as a service says nothing.
    obj["service_names"] = [n for n in service_names if n != company_name and n != owner]
    obj["service_uuid_map"] = service_uuid_map

    return obj
