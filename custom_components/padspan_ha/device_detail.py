# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""One answer for what a device is called, who made it and what it is.

describe() is the one place these are worked out; every screen reads its fields.
A stronger source replaces a weaker one, never the reverse:

  your label > the phone's or Home Assistant device's name > the name it
  broadcasts > a beacon's generated name > its maker ("Samsung device") >
  "Unnamed device"

`obj["name"]` stays as it was: the same-name merge reads it.

What a device is comes from its own broadcast, by rules written from the primary
sources: Microsoft's MS-CDP, Google's Fast Pair, Find Hub and Eddystone
specifications, Ruuvi's documents. Apple publishes nothing for its Continuity
messages, and AirGuard (Apache-2.0) gives the Find My bits, SmartTag and Tile.

Privacy, by rule: only the kind of device is read. Nothing here decodes what
someone is doing (locked, driving, on a call, earbuds in), and scrub_apple_block
takes the phone, email and Apple ID hashes out of Apple's broadcasts before
anything stores them. Nothing here connects to a device.

Pure: no I/O, no HA.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from .ble_enrichment import _uuid16
from .findmy import _payload_bytes
from .xiaomi_models import XIAOMI_MODELS

UNNAMED = "Unnamed device"

# An address, in a name or as one.
_MAC_RE = re.compile(r"^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")
# What PadSpan or Home Assistant added to a name: "CP27-D1DB (9D:D1:DB)",
# "Proxy (AA:BB:CC:DD:EE:FF)". The address sits under the name anyway.
_NAME_TAIL_RE = re.compile(r"\s*\((?:[0-9A-Fa-f]{2}[:-]){2,5}[0-9A-Fa-f]{2}\)\s*$")
# A name PadSpan generated for an iBeacon, sometimes saved as a label by mistake.
_BEACON_NAME_RE = re.compile(r"^iBeacon [0-9a-f]{8}$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")

_OWN_MAKER = "PadSpan HA"  # sensor.py and device_tracker.py's DeviceInfo


def is_own_device(device: Any) -> bool:
    """Is this Home Assistant device one of PadSpan's own? Its entries carry the
    Bluetooth address of what they track, so they match it back."""
    return isinstance(device, dict) and device.get("manufacturer") == _OWN_MAKER


def clean_name(raw: Any) -> str:
    """A name fit to show: no control characters (one device's is "\\x00"), no
    address tail, and not just an address."""
    name = _NAME_TAIL_RE.sub("", _CONTROL_RE.sub("", str(raw or ""))).strip()
    return "" if _MAC_RE.match(name) else name


def broadcast_name(obj: dict[str, Any]) -> str:
    """The name a device itself broadcast, if `name` holds one. `name` can also be
    its address, your label (an iBeacon's), a generated "iBeacon xxxxxxxx", or
    the id ESPresense sends when the device sent no name."""
    raw = obj.get("name")
    if not raw or raw == obj.get("user_label") or raw == obj.get("espresense_id"):
        return ""
    name = clean_name(raw)
    return "" if _BEACON_NAME_RE.match(name) else name


def _a(word: str) -> str:
    """"a Google", "an Apple"."""
    return f"{'an' if word[:1].lower() in 'aeiou' else 'a'} {word}"


def _best_name(obj: dict[str, Any], maker: str | None, guess: str | None, owner: str | None) -> tuple[str, str]:
    label = clean_name(obj.get("user_label"))
    if label and not _BEACON_NAME_RE.match(label):
        return label, "label"
    phone = clean_name(obj.get("private_ble_name"))
    if phone:
        return phone, "device"
    device = obj.get("device")
    if isinstance(device, dict) and not is_own_device(device):
        name = clean_name(device.get("name"))
        if name:
            return name, "device"
    if obj.get("kind") == "entity":
        name = clean_name(obj.get("name")) or str(obj.get("entity_id") or "")
        if name:
            return name, "device"
    name = clean_name(obj.get("broadcast_name")) or broadcast_name(obj)
    if name:
        return name, "broadcast"
    beacon = clean_name(obj.get("name")) or label
    if _BEACON_NAME_RE.match(beacon):
        return beacon, "beacon"
    if maker:
        return f"{maker} device", "maker"
    if guess:
        return f"Probably {guess} device", "maker"
    if owner:
        return f"Device using {_a(owner)} service", "maker"
    return UNNAMED, "none"


# ─── Apple Continuity (company 0x004C) ──────────────────────────────────────
# The block is a chain of type, length, value records.


def _apple_records(raw: bytes) -> list[tuple[int, int, int]]:
    """(type, start, end) of each record; a record cut short ends the chain."""
    out: list[tuple[int, int, int]] = []
    i = 0
    while i + 2 <= len(raw):
        start, end = i + 2, i + 2 + raw[i + 1]
        if end > len(raw):
            break
        out.append((raw[i], start, end))
        i = end
    return out


# AirDrop: 2-byte hashes of Apple ID, phone and emails. Tethering Target: an
# iCloud id. Nearby Action: after its flags and type, 3-byte hashes of Apple ID,
# phone, email and network.
_APPLE_HASH_RECORDS = {0x05: 0, 0x0D: 0, 0x0F: 2}


def scrub_apple_block(raw: bytes) -> bytes:
    """Apple's block with the bytes that hash a person's identifiers zeroed, its
    shape unchanged. Before anything stores it: a hash of a phone number is not
    PadSpan's to keep, and nothing reads them."""
    out = None
    for kind, start, end in _apple_records(raw):
        keep = _APPLE_HASH_RECORDS.get(kind)
        if keep is None:
            continue
        if out is None:
            out = bytearray(raw)
        for i in range(start + keep, end):
            out[i] = 0
    return raw if out is None else bytes(out)


def scrub_apple_hex(value: Any) -> Any:
    """The same for the stored form, "0x12 0x19 ...", for what history kept."""
    raw = _payload_bytes(value)
    if not raw or not isinstance(value, str):
        return value
    clean = scrub_apple_block(raw)
    return value if clean == raw else " ".join(f"0x{b:02X}" for b in clean)


# Find My's device type, bits 4-5 of the status byte. AirGuard's classifier gives
# 0 Apple device, 1 AirTag, 2 other, 3 AirPods; its scan filters use mask 0x18.
# Measured on Garry's house 2026-11-02, 684 addresses: both agree on AirTag; none
# reads AirPods under either; and 83 addresses with value 2 send AirPods' own
# Proximity Pairing record in the same block. So value 2 isn't "another brand's",
# and AirPods are told by that record first.
_FINDMY_WHAT = {0: "Apple device", 1: "AirTag", 2: "Find My accessory", 3: "AirPods or Beats"}


@lru_cache(maxsize=8192)
def _apple_what(payload: str, classify: bool) -> tuple[str | None, str | None, bool]:
    raw = _payload_bytes(payload)
    kinds = {r[0]: r for r in (_apple_records(raw) if raw else [])}
    if 0x07 in kinds:
        return "AirPods or Beats", "its pairing broadcast", False
    if 0x12 in kinds:
        start, end = kinds[0x12][1:]
        if not classify or end <= start:
            return "Find My device", "its Find My broadcast", True
        return _FINDMY_WHAT[(raw[start] >> 4) & 0x03], "its Find My broadcast", True
    if 0x02 in kinds:
        return "iBeacon", "its iBeacon broadcast", False
    if 0x06 in kinds:
        return "Apple Home accessory", "its HomeKit broadcast", False
    if 0x10 in kinds:
        return "Apple phone or tablet", "its Nearby Info broadcast", False
    return None, None, False


# ─── Microsoft CDP (company 0x0006), MS-CDP "Bluetooth: Advertising Beacon" ─
# Scenario 1, then the device type in the low 5 bits. Self-declared.
_CDP_WHAT = {
    1: "Xbox", 6: "iPhone", 7: "iPad", 8: "Android device", 9: "Windows PC", 11: "Windows phone",
    12: "Linux computer", 13: "Windows IoT device", 14: "Surface Hub", 15: "Windows laptop", 16: "Windows tablet",
}


def _cdp_what(payload: Any) -> str | None:
    raw = _payload_bytes(payload)
    if not raw or len(raw) < 2 or raw[0] != 1:
        return None
    return _CDP_WHAT.get(raw[1] & 0x1F)


# ─── From the name ──────────────────────────────────────────────────────────
_SHELLY_MODELS = {
    "SBBT-002C": "Button1", "SBBT-102C": "Button1 ZB", "SBDW-002C": "Door/Window", "SBMO-003Z": "Motion",
    "SBHT-003C": "H&T", "SBHT-203C": "H&T ZB", "SBHT-103C": "H&T Display ZB", "SBBT-004CEU": "Wall Switch 4",
    "SBBT-004CUS": "RC Button 4", "SBTR-001AEU": "TRV",
}
_GOVEE_RE = re.compile(r"^(?:Govee_|GV)(H?\d{4}[A-Z]?)(?:[_ ]|$)")


def _what_from_name(name: str) -> str | None:
    model = _SHELLY_MODELS.get(name)
    if model:
        return f"Shelly BLU {model}"
    match = _GOVEE_RE.match(name)
    return f"Govee {match.group(1)}" if match else None


# ─── From a service ─────────────────────────────────────────────────────────
def _service_what(uuids: Any, data: Any) -> tuple[str | None, str | None, bool]:
    by_uuid: dict[str, bytes] = {}
    for key, value in (data or {}).items():
        short = _uuid16(str(key))
        if short:
            by_uuid[short] = _payload_bytes(value) or b""
    listed = {_uuid16(str(u)) for u in (uuids or ())}

    if "feaa" in by_uuid or "feaa" in listed:
        frame = by_uuid.get("feaa", b"")[:1]
        if frame in (b"\x40", b"\x41"):
            return "Find Hub tag", "its Find Hub broadcast", True
        if not frame or frame[0] in (0x00, 0x10, 0x20, 0x30):
            return "Eddystone beacon", "its Eddystone broadcast", False
    if by_uuid.get("fd5a", b"")[:1] and by_uuid["fd5a"][0] & 0xF8 == 0x10:
        return "Samsung SmartTag", "its SmartTag broadcast", True
    if "feed" in listed or by_uuid.get("feed", b"")[:2] == b"\x02\x00":
        return "Tile", "its Tile broadcast", True
    if "fe2c" in by_uuid:
        return "Fast Pair accessory", "its Fast Pair broadcast", False
    if len(by_uuid.get("fe95", b"")) >= 4:
        raw = by_uuid["fe95"]
        entry = XIAOMI_MODELS.get(raw[2] | raw[3] << 8)
        if entry:
            maker = entry[2] if len(entry) > 2 else "Xiaomi"
            return f"{maker} {entry[0]} {entry[1]}", "its MiBeacon broadcast", False
        return "MiBeacon device", "its MiBeacon broadcast", False
    return None, None, False


def _espresense_what(device_id: Any) -> str | None:
    """ESPresense sends no broadcast, only its id for the device."""
    text = str(device_id or "")
    if text.startswith("tile:"):
        return "Tile"
    if text.startswith("smarttag:"):
        return "Samsung SmartTag"
    if text.startswith("apple:findmy"):
        return "Find My device"
    if text.startswith("msft:cdp:"):
        try:
            return _CDP_WHAT.get(int(text[9:11], 16) & 0x1F)
        except ValueError:
            return None
    return None


def what_it_is(obj: dict[str, Any], classify_findmy: bool = True) -> tuple[str | None, str | None, bool]:
    """(what it is, how that's known, does it rotate whatever its address looks
    like). classify_findmy is the apple_auto_classify setting, for Find My's bits."""
    what = _what_from_name(clean_name(obj.get("broadcast_name") or obj.get("name")))
    if what:
        return what, "its name", False
    manuf = obj.get("manufacturer_data") or {}
    apple = manuf.get("76", manuf.get(76))
    if isinstance(apple, str):
        found = _apple_what(apple, classify_findmy)
        if found[0]:
            return found
    microsoft = manuf.get("6", manuf.get(6))
    if microsoft is not None:
        what = _cdp_what(microsoft)
        if what:
            return what, "its Microsoft broadcast", False
    if "1177" in manuf or 1177 in manuf:  # 0x0499
        return "RuuviTag", "its company number", False
    if "2985" in manuf or 2985 in manuf:  # 0x0BA9, Allterco
        return "Shelly BLU device", "its company number", False
    if "1660" in manuf or 1660 in manuf:  # 0x067C
        return "Tile", "its company number", True
    found = _service_what(obj.get("service_uuids"), obj.get("service_data"))
    if found[0]:
        return found
    if obj.get("kind") == "ibeacon":
        return "iBeacon", "its iBeacon broadcast", False
    what = _espresense_what(obj.get("espresense_id"))
    if what:
        return what, "the id ESPresense gave it", False
    return None, None, False


def address_kind(obj: dict[str, Any], rotates: bool = False) -> str | None:
    """"fixed", "rotating", or None when no radio has said. Only what a radio
    reported counts. A random address's top two bits give its sub-type: 00 and 01
    rotate, 11 is static, 10 is reserved. A tracker's key makes its address look
    static while it rotates (`rotates`)."""
    if obj.get("kind") == "private_ble":
        return "rotating"
    said = obj.get("address_type")
    if said == "public":
        return "fixed"
    if said != "random":
        return None
    if rotates:
        return "rotating"
    address = str(obj.get("address") or "")
    if not _MAC_RE.match(address):
        many = obj.get("all_addresses") or ()
        address = str(many[0]) if len(many) == 1 else ""
    try:
        top = int(address.split(":")[0], 16) >> 6
    except ValueError:
        return None
    return "fixed" if top == 3 else None if top == 2 else "rotating"


_MAKER_HOW = {
    "company_id": "{}, from its company number.",
    "address": "{}, from its address.",
    "espresense": "{}, from the id ESPresense gave it.",
}


def describe(obj: dict[str, Any], classify_findmy: bool = True) -> dict[str, Any]:
    """The name, maker, type and how each is known. A service's owner often isn't
    who made the device (a CP27 beacon reads "Neurostim OAB"), so a maker known
    only that way is said as "uses a ... service" and goes in service_owner."""
    company = obj.get("company_name") or None
    source = obj.get("maker_source")
    owner = company if source == "service_uuid" else None
    maker = None if owner else company
    guess = None if company else (obj.get("maker_guess") or None)

    what, what_how, rotates = what_it_is(obj, classify_findmy)
    name, name_source = _best_name(obj, maker, guess, owner)

    how: list[str] = []
    if owner:
        how.append(f"Uses {_a(owner)} service, from a service number in its broadcast.")
    elif maker:
        how.append(_MAKER_HOW.get(source, "{}, from its company number.").format(maker))
    elif guess:
        how.append(f"Probably {guess}, from its address. No receiver has confirmed the address is fixed.")
    if what:
        how.append(f"{what}, from {what_how}.")
    return {
        "best_name": name,
        "name_source": name_source,
        "maker": maker,
        "service_owner": owner,
        "what_it_is": what,
        "how_known": " ".join(how) or "Nothing in its broadcast says who made it or what it is.",
        "address_kind": address_kind(obj, rotates),
    }


def apply_detail(obj: dict[str, Any], classify_findmy: bool = True) -> None:
    """Put describe()'s answer on an object, empty fields left off, and drop a
    link to PadSpan's own Home Assistant device: it isn't another source."""
    if is_own_device(obj.get("device")):
        obj["device"] = None
    for key, value in describe(obj, classify_findmy).items():
        if value:
            obj[key] = value
        else:
            obj.pop(key, None)
