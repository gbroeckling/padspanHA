# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Private BLE Device Resolver
==========================================
Resolves Bluetooth Resolvable Private Addresses (RPAs) to canonical device
identities using IRKs registered in HA's built-in 'private_ble_device' component.

HOW IT WORKS
------------
Modern phones (iPhone, Android) rotate their Bluetooth MAC address every 10–15
minutes to prevent tracking.  They use a resolvable private address (RPA) scheme
from the BLE spec:

    hash  = AES-128-ECB(IRK, 0x000000000000000000000000 || prand)[0:3]
    address = prand[2] || prand[1] || prand[0] || hash[2] || hash[1] || hash[0]
              (where prand is 3 random bytes with bits 47-46 = "01")

Given the IRK (Identity Resolving Key), you can check any random MAC to see if
it was generated from that IRK — this is how HA's private_ble_device component
works, and how PadSpan finds rotating-MAC phones in the advertisement stream.

IBEACON SUPPORT
---------------
The HA Companion App iBeacon transmitter embeds a stable 16-byte UUID in Apple
manufacturer data (company ID 0x004C, sub-type 0x02).  This is parsed here as an
additional stable identifier independent of the MAC address.

USAGE
-----
    resolver = PrivateBLEResolver(hass)
    await resolver.async_load()                    # load IRKs from HA config entries

    result = resolver.resolve_address("AA:BB:CC:DD:EE:FF")
    # → {"canonical_id": "irk:...", "name": "Alice's Phone", "kind": "private_ble"}
    # → None if address doesn't match any registered IRK

    ibeacon = resolver.parse_ibeacon(manufacturer_data_dict)
    # → {"uuid": "...", "major": 1, "minor": 2}  or None
"""
from __future__ import annotations

import base64
import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# Resolvable Private Address: top byte bits 7-6 == 01 (0x40 mask)
_RPA_MASK = 0xC0
_RPA_VALUE = 0x40

# Cache resolved (address → canonical_id) mappings.
# RPAs change every ~15 minutes; cache for 20 minutes to avoid redundant AES checks.
_CACHE_TTL_S = 1200


class PrivateBLEResolver:
    """Loads IRKs from HA Private BLE Device config entries and resolves RPAs."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        # [{canonical_id, name, irk_bytes}]
        self._devices: list[dict[str, Any]] = []
        # {address_upper: (canonical_id | None, expiry_ts)}
        self._cache: dict[str, tuple[str | None, float]] = {}
        self._loaded_at: float = 0.0
        self._unresolved_log_count: int = 0

    # ── public interface ──────────────────────────────────────────────────────

    async def async_load(self) -> None:
        """Read IRKs from private_ble_device, system Bluetooth bonds, mobile_app, and PadSpan settings."""
        self._devices.clear()
        self._source_info: list[dict[str, Any]] = []  # for UI status
        seen_irk_hex: set[str] = set()

        def _add_device(irk_bytes: bytes, name: str, source: str, entry_id: str = "") -> None:
            """Register a device if its IRK hasn't been seen yet."""
            # Normalise: we always store the hex of the byte order that actually matches.
            # Since _address_matches_irk tries both orders, either order is fine,
            # but we canonicalise to what we were given.
            h = irk_bytes.hex()
            h_rev = bytes(reversed(irk_bytes)).hex()
            if h in seen_irk_hex or h_rev in seen_irk_hex:
                return
            seen_irk_hex.add(h)
            seen_irk_hex.add(h_rev)
            canonical_id = f"irk:{h}"
            self._devices.append({
                "canonical_id": canonical_id,
                "name": name,
                "irk_bytes": irk_bytes,
            })
            self._source_info.append({
                "name": name, "source": source,
                "entry_id": entry_id,
            })

        try:
            # 1) private_ble_device entries (the standard HA integration)
            # Prefer the device-registry friendly name (name_by_user) — HA
            # keeps the config-entry TITLE as the original MAC-ish string
            # forever, which made users' own phones look like anonymous junk
            # rows in the IRK table (issue #57's root UX trigger).
            _dev_reg = None
            try:
                from homeassistant.helpers import device_registry as _dr  # noqa: PLC0415
                _dev_reg = _dr.async_get(self._hass)
            except Exception:
                pass
            for entry in self._hass.config_entries.async_entries("private_ble_device"):
                irk_raw = (entry.data or {}).get("irk")
                if not irk_raw:
                    continue
                irk_bytes = _parse_irk(irk_raw)
                if irk_bytes:
                    _disp = entry.title or entry.entry_id
                    if _dev_reg is not None:
                        try:
                            from homeassistant.helpers import device_registry as _dr  # noqa: PLC0415
                            for _dev in _dr.async_entries_for_config_entry(_dev_reg, entry.entry_id):
                                _friendly = _dev.name_by_user or _dev.name
                                if _friendly and isinstance(_friendly, str):
                                    _disp = _friendly
                                    break
                        except Exception:
                            pass
                    _add_device(irk_bytes, _disp, "private_ble_device", entry.entry_id)

            # 2) System Bluetooth bonded devices — reads IRKs from the host OS
            #    Linux: /var/lib/bluetooth/<adapter>/<device>/info has [IdentityResolvingKey] Key=...
            #    HAOS/containers mount this path; works on all HA Linux installs.
            try:
                _sys_irks = await self._hass.async_add_executor_job(_read_system_bluetooth_irks)
                for si in _sys_irks:
                    irk_bytes = si["irk_bytes"]
                    _add_device(irk_bytes, si["name"], "bluetooth_bond")
                if _sys_irks:
                    _LOGGER.info("Found %d IRK(s) from system Bluetooth bonds", len(_sys_irks))
            except Exception as _sys_err:
                _LOGGER.debug("System Bluetooth IRK scan: %s", _sys_err)

            # 3) mobile_app entries — companion app config entry data
            #    Also check deeper: webhook data, app_data, device attributes
            for entry in self._hass.config_entries.async_entries("mobile_app"):
                data = entry.data or {}
                # Check all possible IRK key names (varies by app version/platform)
                irk_raw = (
                    data.get("ble_irk")
                    or data.get("irk")
                    or data.get("identity_resolving_key")
                    or data.get("bluetooth_irk")
                    or (data.get("app_data") or {}).get("irk")
                    or (data.get("app_data") or {}).get("ble_irk")
                )
                if not irk_raw:
                    # Check webhook registration data (deeper storage)
                    try:
                        webhook_id = data.get("webhook_id")
                        if webhook_id and "mobile_app" in self._hass.data:
                            for reg in self._hass.data["mobile_app"].values():
                                if hasattr(reg, "data") and reg.data.get("webhook_id") == webhook_id:
                                    irk_raw = (
                                        reg.data.get("ble_irk")
                                        or reg.data.get("irk")
                                        or reg.data.get("identity_resolving_key")
                                    )
                                    if irk_raw:
                                        break
                    except Exception:
                        pass
                if not irk_raw:
                    continue
                irk_bytes = _parse_irk(irk_raw)
                if irk_bytes:
                    _add_device(irk_bytes, entry.title or entry.entry_id, "mobile_app", entry.entry_id)

            # 3b) BLE Transmitter sensor attributes — companion app exposes IRK
            #     as a sensor attribute on sensor.*_ble_transmitter entities.
            try:
                for state in self._hass.states.async_all("sensor"):
                    eid = state.entity_id or ""
                    if "ble_transmitter" not in eid:
                        continue
                    attrs = state.attributes or {}
                    irk_raw = (
                        attrs.get("IRK")
                        or attrs.get("irk")
                        or attrs.get("identity_resolving_key")
                        or attrs.get("ble_irk")
                    )
                    if not irk_raw:
                        continue
                    irk_bytes = _parse_irk(str(irk_raw))
                    if irk_bytes:
                        # Derive name from entity_id
                        _name = eid.replace("sensor.", "").replace("_ble_transmitter", "").replace("_", " ").title()
                        _add_device(irk_bytes, _name, "companion_sensor")
                        _LOGGER.info("Found IRK from BLE Transmitter sensor: %s", eid)
            except Exception as _bt_err:
                _LOGGER.debug("BLE Transmitter sensor IRK scan: %s", _bt_err)

            # 4) PadSpan settings — IRKs added directly via PadSpan UI
            try:
                from .const import DOMAIN
                _settings = self._hass.data.get(DOMAIN, {}).get("settings")
                if _settings:
                    for irk_entry in (_settings.data.get("irk_devices") or []):
                        irk_raw = irk_entry.get("irk_hex") or ""
                        irk_name = irk_entry.get("name") or "PadSpan Device"
                        if not irk_raw:
                            continue
                        irk_bytes = _parse_irk(irk_raw)
                        if irk_bytes:
                            _add_device(irk_bytes, irk_name, "padspan")
            except Exception as _ps_err:
                _LOGGER.debug("PadSpan IRK load: %s", _ps_err)

            if self._devices:
                _LOGGER.info(
                    "PrivateBLEResolver loaded %d private device(s): %s",
                    len(self._devices),
                    ", ".join(d["name"] for d in self._devices),
                )
            else:
                _LOGGER.debug("PrivateBLEResolver: no private BLE devices found")
        except Exception as err:
            _LOGGER.warning("PrivateBLEResolver load failed: %s", err)
        self._loaded_at = time.monotonic()

    def resolve_address(self, address: str) -> dict[str, Any] | None:
        """
        Return {canonical_id, name} if the address resolves to a known private device.
        Returns None if unresolved or if address is not an RPA.

        Results are cached for _CACHE_TTL_S to avoid redundant AES ops on the same
        rotating address (an RPA stays valid for ~15 minutes).
        """
        if not self._devices:
            return None

        addr_upper = address.upper()
        now = time.monotonic()

        # Check cache
        cached = self._cache.get(addr_upper)
        if cached and now < cached[1]:
            cid = cached[0]
            if cid:
                dev = next((d for d in self._devices if d["canonical_id"] == cid), None)
                if dev:
                    return {"canonical_id": cid, "name": dev["name"], "kind": "private_ble"}
            return None

        # Check if it's even an RPA before running crypto
        if not _is_rpa(addr_upper):
            self._cache[addr_upper] = (None, now + _CACHE_TTL_S)
            return None

        # Try each registered IRK
        for dev in self._devices:
            try:
                if _address_matches_irk(addr_upper, dev["irk_bytes"]):
                    _LOGGER.debug(
                        "Resolved RPA %s → %s (%s)",
                        addr_upper, dev["canonical_id"], dev["name"],
                    )
                    self._cache[addr_upper] = (dev["canonical_id"], now + _CACHE_TTL_S)
                    return {"canonical_id": dev["canonical_id"], "name": dev["name"], "kind": "private_ble"}
            except Exception as err:
                _LOGGER.warning("IRK match error for %s: %s", addr_upper, err)

        # Log first few unresolved RPAs for debugging (helps diagnose IRK byte-order issues)
        _unresolved = getattr(self, "_unresolved_log_count", 0)
        if _unresolved < 5:
            self._unresolved_log_count = _unresolved + 1
            _LOGGER.info(
                "Unresolved RPA %s (checked %d IRK(s)). If your phone is nearby, "
                "the IRK byte order may be wrong or the IRK value is incorrect.",
                addr_upper, len(self._devices),
            )

        self._cache[addr_upper] = (None, now + _CACHE_TTL_S)
        return None

    def has_devices(self) -> bool:
        return bool(self._devices)

    @property
    def device_count(self) -> int:
        return len(self._devices)

    def count_rpas(self, addresses: list[str] | set[str]) -> int:
        """Count how many addresses in the list are Resolvable Private Addresses."""
        return sum(1 for a in addresses if _is_rpa(a.upper()))

    def get_status(self) -> dict[str, Any]:
        """Return status info for the UI."""
        has_integration = False
        try:
            entries = list(self._hass.config_entries.async_entries("private_ble_device"))
            has_integration = len(entries) > 0
        except Exception:
            pass

        mobile_apps: list[str] = []
        try:
            for entry in self._hass.config_entries.async_entries("mobile_app"):
                mobile_apps.append(entry.title or entry.entry_id)
        except Exception:
            pass

        # Merge source_info into device entries for unified UI display
        _si = {s["name"]: s for s in getattr(self, "_source_info", [])}
        devs = []
        for d in self._devices:
            si = _si.get(d["name"], {})
            devs.append({
                "name": d["name"],
                "canonical_id": d["canonical_id"],
                "source": si.get("source", ""),
                "entry_id": si.get("entry_id", ""),
            })
        return {
            "irk_count": len(self._devices),
            "devices": devs,
            "source_info": getattr(self, "_source_info", []),
            "has_private_ble_integration": has_integration,
            "mobile_apps": mobile_apps,
            "crypto_available": crypto_available(),
        }

    # ── iBeacon ───────────────────────────────────────────────────────────────

    @staticmethod
    def parse_ibeacon(manufacturer_data: dict[str, Any]) -> dict[str, Any] | None:
        """
        Parse Apple iBeacon from manufacturer_data dict.

        The HA Companion App iBeacon transmitter uses:
            manufacturer_data = {76: <bytes>}   (Apple company ID = 0x004C = 76)
        The bytes payload: [0x02, 0x15, <16-byte UUID>, <2-byte major>, <2-byte minor>, <1-byte TX power>]
        """
        try:
            # Apple company ID is 76 (0x004C) — may be stored as int key or string
            payload: bytes | None = None
            for k in (76, "76", "0x004c", "0x004C"):
                raw = manufacturer_data.get(k)
                if raw is not None:
                    if isinstance(raw, (bytes, bytearray)):
                        payload = bytes(raw)
                    elif isinstance(raw, str):
                        # HA stores manufacturer_data as hex string "0x4A 0x17 ..."
                        payload = bytes(int(x, 16) for x in raw.split())
                    break

            if not payload or len(payload) < 23:
                return None
            if payload[0] != 0x02 or payload[1] != 0x15:
                return None

            uuid_bytes = payload[2:18]
            major = int.from_bytes(payload[18:20], "big")
            minor = int.from_bytes(payload[20:22], "big")

            # Format UUID as standard 8-4-4-4-12
            h = uuid_bytes.hex()
            uuid = f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"

            # TX Power byte (index 22) — factory-calibrated RSSI at 1 m, signed int8.
            # ESPresense uses this to automatically set ref_power per iBeacon.
            raw_tx = payload[22]
            tx_power = raw_tx if raw_tx < 128 else raw_tx - 256  # convert to signed

            return {"uuid": uuid, "major": major, "minor": minor, "tx_power": tx_power}
        except Exception:
            return None


# ── module-level singleton per hass instance ──────────────────────────────────
# Keyed by hass object id to support test harnesses with multiple hass instances.
_resolvers: dict[int, PrivateBLEResolver] = {}


async def get_resolver(hass: HomeAssistant) -> PrivateBLEResolver:
    """Return (and lazily refresh) the cached resolver for this hass instance."""
    hass_id = id(hass)
    resolver = _resolvers.get(hass_id)
    if resolver is None:
        resolver = PrivateBLEResolver(hass)
        _resolvers[hass_id] = resolver

    # Reload IRK list every 5 minutes (catches newly-added Private BLE Devices)
    if time.monotonic() - resolver._loaded_at > 300:
        await resolver.async_load()

    return resolver


# ── crypto helpers ────────────────────────────────────────────────────────────

def _is_rpa(address: str) -> bool:
    """Return True if address is a BLE Resolvable Private Address."""
    try:
        msb = int(address.split(":")[0], 16)
        return (msb & _RPA_MASK) == _RPA_VALUE
    except Exception:
        return False


_crypto_ok: bool | None = None  # None = untested, True/False after first attempt


def _address_matches_irk(address: str, irk: bytes) -> bool:
    """
    Check if a BLE RPA was generated from the given IRK.

    Algorithm (BLE Core Spec Vol 3, Part H, §2.2.2 — ``ah`` function):
        rpa        = unhexlify(address)       — 6 bytes, MSB-first
        prand      = rpa[0:3]                 — upper 24 bits (bits 47-46 = "01")
        hash_value = rpa[3:6]                 — lower 24 bits
        plaintext  = b'\\x00'*13 + prand      — zero-padded to 128 bits
        ct         = AES-128-ECB(irk, plaintext)
        match      = (ct[13:16] == hash_value)  — least-significant 24 bits of ct

    Tries FOUR byte order permutations to handle LE/BE ambiguity across
    iOS, Android, HA storage, Apple Keychain, and nRF Connect exports.
    """
    global _crypto_ok  # noqa: PLW0603

    try:
        import binascii  # noqa: PLC0415
        from cryptography.hazmat.primitives.ciphers import (  # noqa: PLC0415
            Cipher, algorithms, modes,
        )
        from cryptography.hazmat.backends import default_backend  # noqa: PLC0415

        rpa = binascii.unhexlify(address.replace(":", "").replace("-", ""))
        prand = rpa[:3]
        hash_value = rpa[3:]
        plaintext = b"\x00" * 13 + prand

        def _test(key: bytes) -> bool:
            cipher = Cipher(algorithms.AES(key), modes.ECB(), backend=default_backend())
            enc = cipher.encryptor()
            ct = enc.update(plaintext) + enc.finalize()
            return ct[13:] == hash_value

        # Build unique set of byte order permutations
        irk_rev = bytes(reversed(irk))
        # Swap 8-byte halves (seen in some Android exports)
        irk_swap = irk[8:] + irk[:8]
        irk_swap_rev = bytes(reversed(irk_swap))

        tested: set[bytes] = set()
        for candidate in (irk, irk_rev, irk_swap, irk_swap_rev):
            if candidate in tested:
                continue
            tested.add(candidate)
            if _test(candidate):
                if _crypto_ok is None:
                    _crypto_ok = True
                return True

        if _crypto_ok is None:
            _crypto_ok = True  # crypto works even though no match
        return False
    except ImportError as exc:
        if _crypto_ok is None:
            _crypto_ok = False
            _LOGGER.error(
                "IRK resolution DISABLED — missing Python cryptography library: %s. "
                "Install 'cryptography' package or the Private BLE Device integration.",
                exc,
            )
        return False
    except Exception as exc:
        if _crypto_ok is not False:
            _crypto_ok = False
            _LOGGER.error(
                "IRK resolution FAILED — AES crypto error: %s. "
                "Private BLE devices will NOT be resolved until this is fixed.",
                exc,
            )
        return False


def crypto_available() -> bool:
    """Return whether the cryptography library is available for IRK resolution."""
    global _crypto_ok  # noqa: PLW0603
    if _crypto_ok is not None:
        return _crypto_ok
    try:
        from cryptography.hazmat.primitives.ciphers import (  # noqa: PLC0415,F401
            Cipher, algorithms, modes,
        )
        from cryptography.hazmat.backends import default_backend  # noqa: PLC0415,F401
        _crypto_ok = True
        return True
    except ImportError:
        _crypto_ok = False
        _LOGGER.error(
            "IRK resolution DISABLED — 'cryptography' Python package not available. "
            "Private BLE device tracking will not work."
        )
        return False


def _parse_irk(raw: Any) -> bytes | None:
    """Parse IRK from whatever format HA stored it (bytes, hex string, base64 string, irk:-prefixed base64).

    Returns the 16-byte IRK.  _address_matches_irk handles byte order
    permutations, so we return the bytes as-decoded without guessing endianness.
    """
    try:
        if isinstance(raw, (bytes, bytearray)):
            b = bytes(raw)
            if len(b) == 16:
                return b
        if isinstance(raw, str):
            s = raw.strip()
            # Strip "irk:" prefix (HA's private_ble_device stores IRKs this way)
            if s.lower().startswith("irk:"):
                s = s[4:]
            # Try hex (32 hex chars, with or without separators)
            clean = s.replace(":", "").replace("-", "").replace(" ", "")
            if len(clean) == 32:
                try:
                    b = bytes.fromhex(clean)
                    if len(b) == 16:
                        return b
                except ValueError:
                    pass
            # Try base64 — return bytes as decoded; _address_matches_irk tries
            # both byte orders so we don't need to guess endianness here.
            try:
                b = base64.b64decode(s)
                if len(b) == 16:
                    return b
            except Exception:
                pass
            # Some base64 strings have padding stripped
            for pad in ("=", "==", "==="):
                try:
                    b = base64.b64decode(s + pad)
                    if len(b) == 16:
                        return b
                except Exception:
                    pass
    except Exception:
        pass
    return None


def _read_system_bluetooth_irks() -> list[dict[str, Any]]:
    """Read IRKs from Linux Bluetooth bonded device info files.

    On HAOS / Debian / Ubuntu, bonded device info is stored at:
        /var/lib/bluetooth/<adapter_mac>/<device_mac>/info

    The [IdentityResolvingKey] section contains:
        Key=AABBCCDDEEFF00112233445566778899  (32 hex chars)

    This runs in the executor (blocking I/O).
    """
    import os
    import re as _re

    results: list[dict[str, Any]] = []
    bt_base = "/var/lib/bluetooth"

    if not os.path.isdir(bt_base):
        return results

    try:
        for adapter in os.listdir(bt_base):
            adapter_dir = os.path.join(bt_base, adapter)
            if not os.path.isdir(adapter_dir):
                continue
            for device in os.listdir(adapter_dir):
                device_dir = os.path.join(adapter_dir, device)
                info_file = os.path.join(device_dir, "info")
                if not os.path.isfile(info_file):
                    continue
                try:
                    with open(info_file, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()

                    # Parse [IdentityResolvingKey] section
                    irk_match = _re.search(
                        r"\[IdentityResolvingKey\]\s*\n(?:.*\n)*?Key=([0-9A-Fa-f]{32})",
                        content,
                    )
                    if not irk_match:
                        continue

                    irk_hex = irk_match.group(1)
                    irk_bytes = bytes.fromhex(irk_hex)

                    # Try to get device name from [General] section
                    name_match = _re.search(r"\[General\]\s*\n(?:.*\n)*?Name=(.+)", content)
                    name = name_match.group(1).strip() if name_match else device

                    results.append({
                        "irk_bytes": irk_bytes,
                        "name": name,
                        "device_mac": device,
                        "adapter": adapter,
                    })
                    _LOGGER.debug(
                        "System BT IRK found: %s (%s) adapter=%s",
                        name, device, adapter,
                    )
                except Exception as _fe:
                    _LOGGER.debug("Error reading BT info %s: %s", info_file, _fe)
    except Exception as _de:
        _LOGGER.debug("Error scanning %s: %s", bt_base, _de)

    return results
