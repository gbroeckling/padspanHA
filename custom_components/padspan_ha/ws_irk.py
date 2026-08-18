# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for Private BLE (IRK) management.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import DOMAIN, DATA_SETTINGS
from .bluetooth_live import get_bluetooth_live
from .private_ble_resolver import get_resolver as _get_ble_resolver
from .telemetry import bump as _bump

_LOGGER = logging.getLogger(__name__)


def _live_rpas(hass: HomeAssistant, *, max_ads: int = 5000, max_age_s: int = 3600) -> set[str]:
    """Every rotating address in the live advertisement cache."""
    from .private_ble_resolver import _is_rpa  # noqa: PLC0415
    try:
        snap = get_bluetooth_live(hass).get_snapshot(max_ads=max_ads, max_age_s=max_age_s)
    except Exception as err:
        _LOGGER.warning("irk: BLE snapshot error: %s", err)
        return set()
    out: set[str] = set()
    for ad in (snap.get("advertisements") or []):
        addr = (ad.get("address") or "").upper()
        if addr and _is_rpa(addr):
            out.add(addr)
    return out


def _live_matches(hass: HomeAssistant, irk_bytes: bytes) -> tuple[list[str], int]:
    """(addresses this key resolves right now, how many RPAs were tested)."""
    from .private_ble_resolver import _address_matches_irk  # noqa: PLC0415
    rpas = _live_rpas(hass)
    matched = [a for a in rpas if _address_matches_irk(a, irk_bytes)]
    return matched, len(rpas)


def _looks_like_a_beacon_uuid(hass: HomeAssistant, irk_bytes: bytes) -> str | None:
    """The one mistake worth naming.

    An IRK is 16 bytes and so is an iBeacon UUID, and the Companion App
    shows the UUID in the very screen people go looking for the key. A UUID
    pasted as an IRK resolves nothing, forever, and the only symptom is
    "0 resolved". So: if the pasted bytes equal the UUID of any iBeacon on
    the air, or of any BLE-transmitter sensor's `id`, say so — and say whose.
    Returns a human sentence, or None.
    """
    from .private_ble_resolver import PrivateBLEResolver  # noqa: PLC0415
    hexval = irk_bytes.hex().lower()
    # Companion App BLE transmitters — the sensor id is "<uuid>_<major>_<minor>"
    try:
        for st in hass.states.async_all("sensor"):
            if "ble_transmitter" not in (st.entity_id or ""):
                continue
            ident = str((st.attributes or {}).get("id") or "")
            if ident and ident.split("_")[0].replace("-", "").lower() == hexval:
                who = (st.attributes or {}).get("friendly_name") or st.entity_id
                return (f"That is the iBeacon UUID that \u201c{who}\u201d is broadcasting, not its IRK. "
                        "A phone advertising an iBeacon is already tracked by that UUID and does not need an IRK.")
    except Exception:
        pass
    # Any iBeacon on the air
    try:
        snap = get_bluetooth_live(hass).get_snapshot(max_ads=5000, max_age_s=3600)
        for ad in (snap.get("advertisements") or []):
            ib = PrivateBLEResolver.parse_ibeacon(ad.get("manufacturer_data") or {})
            if ib and str(ib.get("uuid") or "").replace("-", "").lower() == hexval:
                name = ad.get("name") or ad.get("address") or "a beacon"
                return (f"That is the iBeacon UUID of \u201c{name}\u201d (major {ib.get('major')}, minor {ib.get('minor')}), "
                        "not an IRK. iBeacons are tracked by their UUID already.")
    except Exception:
        pass
    return None


@websocket_api.websocket_command({"type": "padspan_ha/private_ble_status"})
@websocket_api.async_response
async def ws_private_ble_status(hass: HomeAssistant, connection, msg) -> None:
    """Return Private BLE Device resolver status for the UI setup wizard.

    Includes: IRK count, registered devices, RPA count in live BLE cache,
    and whether the private_ble_device integration is available.
    """
    try:
        resolver = await _get_ble_resolver(hass)
        status = resolver.get_status()

        # Count RPAs in live BLE cache
        ble_live = get_bluetooth_live(hass)
        snap = ble_live.get_snapshot(max_ads=2000, max_age_s=3600)
        all_addrs = set()
        for ad in (snap.get("advertisements") or []):
            addr = ad.get("address")
            if addr:
                all_addrs.add(addr)
        status["rpa_count"] = resolver.count_rpas(all_addrs)
        status["total_ble_addresses"] = len(all_addrs)

        connection.send_result(msg["id"], status)
    except Exception as err:
        _LOGGER.warning("private_ble_status failed: %s", err)
        connection.send_result(msg["id"], {
            "irk_count": 0, "devices": [], "source_info": [],
            "has_private_ble_integration": False, "mobile_apps": [],
            "rpa_count": 0, "total_ble_addresses": 0,
            "error": str(err),
        })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/irk_add",
        vol.Required("name"): str,
        vol.Required("irk_hex"): str,
        vol.Optional("force", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_irk_add(hass: HomeAssistant, connection, msg) -> None:
    """Add an IRK directly via PadSpan settings (no private_ble_device integration needed).

    Accepts IRK in multiple formats: 32 hex chars, base64 (24 chars = 16 bytes),
    or colon/dash/space-separated hex.  Normalises to lowercase hex, checks for
    duplicates, stores in settings.irk_devices, and reloads the resolver
    immediately so the IRK takes effect without restart.

    A key is SAVED ONLY IF IT WORKS: it must resolve at least one rotating
    address on the air right now, or the caller must say `force: true`
    (the phone is away — the UI offers "save unverified"). A value that
    equals an iBeacon UUID currently broadcasting is refused outright, with
    the beacon named: that is the mistake that reads "0 resolved" for weeks.
    """
    from .private_ble_resolver import _parse_irk  # noqa: PLC0415

    name = str(msg["name"]).strip()
    irk_raw = str(msg["irk_hex"]).strip()
    if not name:
        connection.send_error(msg["id"], "invalid", "name is required")
        return
    if not irk_raw:
        connection.send_error(msg["id"], "invalid", "irk_hex is required")
        return

    # Use _parse_irk for consistent handling (same path as resolver + validation)
    irk_bytes = _parse_irk(irk_raw)
    if not irk_bytes:
        connection.send_error(msg["id"], "invalid", "Could not parse IRK. Enter 32 hex chars or base64.")
        return

    irk_clean = irk_bytes.hex().lower()

    # Not an IRK at all — the pasted value is a beacon UUID on the air.
    beacon_reason = _looks_like_a_beacon_uuid(hass, irk_bytes)
    if beacon_reason:
        _bump(hass, "irk_add_refused")
        connection.send_error(msg["id"], "not_an_irk", beacon_reason)
        return

    # Does it resolve anything, right now?
    matched, rpa_count = _live_matches(hass, irk_bytes)
    if not matched and not msg.get("force"):
        connection.send_error(msg["id"], "unverified",
            f"No rotating address on the air resolves with this key ({rpa_count} tested). "
            "If the phone is here and awake, the key is wrong. If it is away, save it unverified.")
        return

    # Store in settings
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return

    irk_list = list(st.data.get("irk_devices") or [])
    # Check for duplicates
    for existing in irk_list:
        if (existing.get("irk_hex") or "").lower().replace(":", "").replace("-", "").replace(" ", "") == irk_clean:
            connection.send_error(msg["id"], "duplicate", f"IRK already registered for '{existing.get('name')}'")
            return

    irk_list.append({"name": name, "irk_hex": irk_clean})
    await st.async_set(irk_devices=irk_list)
    _bump(hass, "irk_added")

    # Reload the resolver so it picks up the new IRK immediately
    try:
        resolver = await _get_ble_resolver(hass)
        await resolver.async_load()
        _LOGGER.info("IRK added for '%s' — resolver reloaded (%d devices)", name, resolver.device_count)
    except Exception as e:
        _LOGGER.warning("IRK added but resolver reload failed: %s", e)

    connection.send_result(msg["id"], {
        "ok": True,
        "name": name,
        "irk_hex": irk_clean,
        "canonical_id": f"irk:{irk_clean}",
        "device_count": resolver.device_count if resolver else 0,
        "verified": bool(matched),
        "matched_count": len(matched),
        "rpa_count": rpa_count,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/irk_validate",
        vol.Required("irk_hex"): str,
    }
)
@websocket_api.async_response
async def ws_irk_validate(hass: HomeAssistant, connection, msg) -> None:
    """Test an IRK against all currently-visible BLE RPAs.

    Returns the number of matched addresses so the UI can confirm the key is
    valid before saving.  Does NOT persist anything — purely a read-only check.

    Tries the IRK in multiple byte orders and base64 vs hex interpretations
    to maximise the chance of finding a match.
    """
    from .private_ble_resolver import _parse_irk, _address_matches_irk, _is_rpa  # noqa: PLC0415
    import base64 as _b64  # noqa: PLC0415

    irk_raw = str(msg["irk_hex"]).strip()

    # Build a set of candidate IRK byte arrays to try
    candidates: list[tuple[bytes, str]] = []  # (irk_bytes, description)
    seen_hex: set[str] = set()

    def _add_candidate(b: bytes, desc: str) -> None:
        h = b.hex()
        if h not in seen_hex:
            seen_hex.add(h)
            candidates.append((b, desc))

    # Primary parse
    irk_bytes = _parse_irk(irk_raw)
    if irk_bytes:
        _add_candidate(irk_bytes, "parsed")
        _add_candidate(bytes(reversed(irk_bytes)), "parsed_reversed")

    # Also try raw base64 without any reversal (in case _parse_irk applied reversal)
    stripped = irk_raw.strip()
    if stripped.lower().startswith("irk:"):
        stripped = stripped[4:]
    try:
        raw_b64 = _b64.b64decode(stripped)
        if len(raw_b64) == 16:
            _add_candidate(raw_b64, "base64_raw")
            _add_candidate(bytes(reversed(raw_b64)), "base64_reversed")
    except Exception:
        pass
    # Try with padding
    for pad in ("=", "=="):
        try:
            raw_b64p = _b64.b64decode(stripped + pad)
            if len(raw_b64p) == 16:
                _add_candidate(raw_b64p, "base64_padded")
                _add_candidate(bytes(reversed(raw_b64p)), "base64_padded_reversed")
        except Exception:
            pass

    # Try hex with separator stripping
    import re as _re  # noqa: PLC0415
    cleaned = _re.sub(r"[:\-\s]", "", stripped)
    if len(cleaned) == 32:
        try:
            h_bytes = bytes.fromhex(cleaned)
            _add_candidate(h_bytes, "hex")
            _add_candidate(bytes(reversed(h_bytes)), "hex_reversed")
        except ValueError:
            pass

    if not candidates:
        connection.send_error(msg["id"], "invalid", "Could not parse IRK. Enter 32 hex chars or base64.")
        return

    # Gather all RPAs from the live BLE advertisement cache
    rpas = _live_rpas(hass)

    # Test ALL candidate byte orders against every RPA
    best_matched: list[str] = []
    best_irk: bytes | None = None
    best_desc: str = ""

    for cand_bytes, cand_desc in candidates:
        matched: list[str] = []
        for addr in rpas:
            try:
                if _address_matches_irk(addr, cand_bytes):
                    matched.append(addr)
            except Exception:
                pass
        if len(matched) > len(best_matched):
            best_matched = matched
            best_irk = cand_bytes
            best_desc = cand_desc
        if best_matched:
            break  # Found matches, no need to try more candidates

    result_irk = best_irk or (candidates[0][0] if candidates else irk_bytes)
    connection.send_result(msg["id"], {
        "valid": len(best_matched) > 0,
        "matched_count": len(best_matched),
        "matched_addresses": best_matched[:10],
        "rpa_count": len(rpas),
        "irk_hex": result_irk.hex() if result_irk else "",
        "matched_format": best_desc,
        "candidates_tried": len(candidates),
        # Why it will never match, when that can be said.
        "not_an_irk": (_looks_like_a_beacon_uuid(hass, result_irk) if result_irk and not best_matched else None),
    })


@websocket_api.websocket_command({"type": "padspan_ha/irk_auto_detect"})
@websocket_api.async_response
async def ws_irk_auto_detect(hass: HomeAssistant, connection, msg) -> None:
    """Scan system Bluetooth bonds and live BLE cache to find IRKs automatically.

    Checks:
    1. Linux Bluetooth bonded device files (/var/lib/bluetooth/...)
    2. HA private_ble_device config entries (already loaded by resolver)
    3. Live BLE advertisements — tests found IRKs against visible RPAs
    """
    from .private_ble_resolver import (  # noqa: PLC0415
        _read_system_bluetooth_irks, _parse_irk, _address_matches_irk, _is_rpa,
    )

    found: list[dict[str, Any]] = []
    already_registered: set[str] = set()

    # Get currently registered IRKs to mark duplicates
    try:
        resolver = await _get_ble_resolver(hass)
        for dev in resolver._devices:
            already_registered.add(dev["irk_bytes"].hex())
            already_registered.add(bytes(reversed(dev["irk_bytes"])).hex())
    except Exception:
        pass

    # 1. System Bluetooth bonds
    try:
        sys_irks = await hass.async_add_executor_job(_read_system_bluetooth_irks)
        for si in sys_irks:
            irk_hex = si["irk_bytes"].hex()
            is_dup = irk_hex in already_registered
            found.append({
                "name": si["name"],
                "irk_hex": irk_hex,
                "source": "bluetooth_bond",
                "device_mac": si.get("device_mac", ""),
                "already_registered": is_dup,
            })
    except Exception as err:
        _LOGGER.debug("IRK auto-detect system scan: %s", err)

    # 2. Gather RPAs from live BLE to verify found IRKs
    rpas: set[str] = set()
    try:
        ble_live = get_bluetooth_live(hass)
        snap = ble_live.get_snapshot(max_ads=5000, max_age_s=3600)
        for ad in (snap.get("advertisements") or []):
            addr = (ad.get("address") or "").upper()
            if addr and _is_rpa(addr):
                rpas.add(addr)
    except Exception:
        pass

    # Test each found IRK against live RPAs
    for item in found:
        if item["already_registered"]:
            item["verified"] = True
            item["matched_count"] = -1  # already tracked
            continue
        try:
            irk_bytes = bytes.fromhex(item["irk_hex"])
            matched = sum(1 for addr in rpas if _address_matches_irk(addr, irk_bytes))
            item["verified"] = matched > 0
            item["matched_count"] = matched
        except Exception:
            item["verified"] = False
            item["matched_count"] = 0

    connection.send_result(msg["id"], {
        "found": found,
        "rpa_count": len(rpas),
        "system_bond_count": len([f for f in found if f["source"] == "bluetooth_bond"]),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/irk_remove",
        vol.Required("irk_hex"): str,
    }
)
@websocket_api.async_response
async def ws_irk_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove a PadSpan-managed IRK and reload the resolver."""
    irk_raw = str(msg["irk_hex"]).strip().lower().replace(":", "").replace("-", "").replace(" ", "")
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return

    irk_list = list(st.data.get("irk_devices") or [])
    new_list = [e for e in irk_list if (e.get("irk_hex") or "").lower().replace(":", "").replace("-", "").replace(" ", "") != irk_raw]
    removed = len(irk_list) - len(new_list)
    await st.async_set(irk_devices=new_list)

    try:
        resolver = await _get_ble_resolver(hass)
        await resolver.async_load()
    except Exception:
        pass

    connection.send_result(msg["id"], {"ok": True, "removed": removed})


@websocket_api.websocket_command({
    "type": "padspan_ha/private_ble_add_irk",
    vol.Required("irk"): str,
    vol.Optional("name", default=""): str,
})
@websocket_api.async_response
async def ws_private_ble_add_irk(hass: HomeAssistant, connection, msg) -> None:
    """Add a Private BLE Device IRK via PadSpan UI (creates HA config entry)."""
    import re as _re
    import base64 as _b64

    irk_input = str(msg.get("irk", "")).strip()
    device_name = str(msg.get("name", "")).strip() or "PadSpan Device"

    if not irk_input:
        connection.send_error(msg["id"], "invalid_irk", "IRK is required")
        return

    # Normalise IRK: accept hex (with/without colons/spaces), base64, or irk:-prefixed base64
    irk_hex = ""
    irk_stripped = irk_input
    # Strip "irk:" prefix if present (HA format)
    if irk_stripped.lower().startswith("irk:"):
        irk_stripped = irk_stripped[4:]
    try:
        # Try hex first — strip separators
        cleaned = _re.sub(r"[:\-\s]", "", irk_stripped)
        if _re.fullmatch(r"[0-9a-fA-F]{32}", cleaned):
            irk_hex = cleaned.lower()
        else:
            # Try base64
            decoded = _b64.b64decode(irk_stripped)
            if len(decoded) == 16:
                irk_hex = decoded.hex()
    except Exception:
        pass

    if not irk_hex or len(irk_hex) != 32:
        connection.send_error(msg["id"], "invalid_irk",
            "IRK must be 32 hex characters, 24-char base64 (16 bytes), or irk:-prefixed base64")
        return

    # Check for duplicates.  Stored IRKs vary in format (plain hex, base64,
    # irk:-prefixed) and byte order — normalise through the same decoder and
    # compare BOTH orders, else re-adding the same IRK in a different format
    # sails past this check and creates a duplicate entry.
    def _stored_irk_hexes(raw: Any) -> set[str]:
        s = str(raw or "").strip()
        if s.lower().startswith("irk:"):
            s = s[4:]
        cleaned = _re.sub(r"[:\-\s]", "", s)
        if _re.fullmatch(r"[0-9a-fA-F]{32}", cleaned):
            b = bytes.fromhex(cleaned.lower())
        else:
            try:
                b = _b64.b64decode(s)
            except Exception:
                return set()
            if len(b) != 16:
                return set()
        return {b.hex(), b[::-1].hex()}

    for entry in hass.config_entries.async_entries("private_ble_device"):
        if irk_hex in _stored_irk_hexes((entry.data or {}).get("irk", "")):
            connection.send_result(msg["id"], {
                "ok": True, "duplicate": True,
                "message": f"IRK already registered as '{entry.title}'",
            })
            return

    # HA's private_ble_device config flow accepts:
    #   1) Plain hex: "aabbccdd..." (32 chars)
    #   2) "irk:"-prefixed base64: "irk:AAAA...==" (bytes are REVERSED by HA)
    # The flow also requires the device to be actively broadcasting in range.
    irk_bytes = bytes.fromhex(irk_hex)
    irk_bytes_reversed = irk_bytes[::-1]
    irk_formats = [
        irk_hex,                                                         # plain hex
        "irk:" + _b64.b64encode(irk_bytes_reversed).decode(),           # irk:-prefixed base64 (HA reverses)
        "irk:" + _b64.b64encode(irk_bytes).decode(),                    # irk:-prefixed base64 (no reversal)
        irk_bytes_reversed.hex(),                                        # reversed hex
    ]

    async def _try_create_entry(irk_value: str) -> tuple[dict | None, str]:
        """Attempt to create a private_ble_device config entry with the given IRK format.
        Returns (flow_result, error_detail) tuple."""
        flow_id = None

        def _abort_flow() -> None:
            # A failed attempt must not leave the config flow in progress —
            # each of the 4 format retries used to leak one, piling up
            # "discovered" flows in Settings until restart.
            if flow_id:
                try:
                    hass.config_entries.flow.async_abort(flow_id)
                except Exception:
                    pass

        try:
            result = await hass.config_entries.flow.async_init(
                "private_ble_device",
                context={"source": "user"},
            )
            rtype = str(result.get("type", ""))

            if "create_entry" in rtype:
                return result, ""

            flow_id = result.get("flow_id")
            if "form" not in rtype:
                _abort_flow()
                return None, f"flow init returned {rtype}"

            if not flow_id:
                return None, "no flow_id"

            # Submit the IRK to the form
            result2 = await hass.config_entries.flow.async_configure(
                flow_id, user_input={"irk": irk_value}
            )
            rtype2 = str(result2.get("type", ""))

            if "create_entry" in rtype2:
                return result2, ""

            errors = result2.get("errors") or {}
            if errors:
                err_detail = ", ".join(f"{k}: {v}" for k, v in errors.items())
                _LOGGER.debug("private_ble flow errors for format %s: %s",
                              irk_value[:20], err_detail)
                _abort_flow()
                return None, err_detail

            _abort_flow()
            return None, f"flow returned {rtype2}"
        except Exception as e:
            _abort_flow()
            return None, str(e)

    try:
        created = None
        all_errors: list[str] = []
        for fmt in irk_formats:
            result, err_detail = await _try_create_entry(fmt)
            if result:
                created = result
                break
            if err_detail:
                all_errors.append(err_detail)

        if created:
            entry = created.get("result")
            if entry and device_name:
                hass.config_entries.async_update_entry(entry, title=device_name)
            # Force resolver refresh
            try:
                resolver = await _get_ble_resolver(hass)
                await resolver.async_load()
            except Exception:
                pass
            connection.send_result(msg["id"], {
                "ok": True, "duplicate": False,
                "message": f"IRK registered as '{device_name}'",
                "entry_id": entry.entry_id if entry else None,
            })
        else:
            # Determine the most helpful error message
            unique_errors = list(dict.fromkeys(all_errors))  # deduplicate preserving order
            if any("irk_not_found" in e for e in unique_errors):
                connection.send_error(msg["id"], "irk_not_found",
                    "IRK is valid but no matching device was detected. "
                    "The device must be actively broadcasting nearby (Bluetooth on, in range of a scanner). "
                    "Make sure the device is awake and near a scanner, then try again.")
            elif any("irk_not_valid" in e for e in unique_errors):
                connection.send_error(msg["id"], "irk_not_valid",
                    "IRK format not recognised by HA. Try plain hex (32 chars), "
                    "base64, or irk:-prefixed base64 from Apple Keychain.")
            else:
                detail = "; ".join(unique_errors) if unique_errors else "unknown"
                connection.send_error(msg["id"], "flow_failed",
                    f"Could not create Private BLE Device entry ({detail}). "
                    "Make sure the 'Private BLE Device' integration is available in HA "
                    "(Settings → Devices & Services → Add Integration → search 'Private BLE').")
    except Exception as err:
        _LOGGER.warning("private_ble_add_irk failed: %s", err, exc_info=True)
        connection.send_error(msg["id"], "add_failed",
            f"Failed to add IRK: {err}. Make sure 'Private BLE Device' integration is available in HA.")


@websocket_api.websocket_command({
    "type": "padspan_ha/private_ble_delete_irk",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_private_ble_delete_irk(hass: HomeAssistant, connection, msg) -> None:
    """Delete a Private BLE Device config entry by entry_id."""
    entry_id = str(msg.get("entry_id", "")).strip()
    if not entry_id:
        connection.send_error(msg["id"], "invalid_entry", "entry_id is required")
        return
    entry = hass.config_entries.async_get_entry(entry_id)
    if not entry or entry.domain != "private_ble_device":
        connection.send_error(msg["id"], "not_found", "Config entry not found")
        return
    try:
        await hass.config_entries.async_remove(entry_id)
        # Refresh resolver so status reflects the deletion
        try:
            resolver = await _get_ble_resolver(hass)
            await resolver.async_load()
        except Exception:
            pass
        connection.send_result(msg["id"], {"ok": True, "removed": entry.title or entry_id})
    except Exception as err:
        connection.send_error(msg["id"], "remove_failed", str(err))
