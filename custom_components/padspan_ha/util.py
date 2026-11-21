# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Small helpers shared across the integration."""
from __future__ import annotations

import ipaddress
import socket
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit


def ha_devices(dev_reg: Any) -> list[Any]:
    """Every device (DeviceEntry) in Home Assistant's device registry.

    The one place PadSpan reads `dev_reg.devices`, because its shape depends
    on the HA version. In HA 2026.7 and earlier it is a device_id ->
    DeviceEntry mapping, and iterating it yields ids. In HA 2026.9 it is a
    view whose iteration yields the entries, and every mapping use
    (`.values()`, `.get()`, `[id]`, `id in`) logs a deprecation warning and
    stops working in 2027.9.
    `.values()` on the first and iteration on the second give the same list.
    Look a device up by id in a dict built from this list, not with
    `dev_reg.async_get()`: from 2026.9 that also resolves child and composite
    devices, which `devices.get()` never did.
    """
    devices = dev_reg.devices
    if isinstance(devices, Mapping):
        return list(devices.values())
    return list(devices)


def ha_device_config_entries(dev: Any) -> set[str]:
    """The config entry ids a device belongs to, read without HA's deprecation shim.

    HA 2026.9 gave every device a single `config_entry_id` and kept
    `config_entries` as a compatibility property. From 2026.10 every read of
    that property calls `report_usage`, which walks the stack and copies
    `sys.modules` to name the caller: about a millisecond a read. Read once
    per device per snapshot build, that was 1-4 s per build on the event loop
    in houses with Bermuda (the opt-in report's `snap_ha_areas_ms`), and the
    warning it logs only once never showed it.

    A composite device (only ever made by `async_get` for an old id, never
    stored) still belongs to several entries, and its property does not report.
    Before 2026.9 `config_entries` is a plain set.
    """
    cid = getattr(dev, "config_entry_id", None)
    if isinstance(cid, str):
        if getattr(dev, "is_composite_device", False) is True:
            return set(dev.config_entries or ())
        return {cid}
    return set(getattr(dev, "config_entries", None) or ())


# ── addresses PadSpan fetches for the owner ─────────────────────────────────
# A robot vacuum (Valetudo) and the ESPresense Companion live on the home's
# network, so private addresses (10/8, 172.16/12, 192.168/16, fd00::/8) are
# what an owner gives and stay allowed. Never fetched: this machine itself
# (loopback, "localhost"), link-local (169.254/16, fe80::/10, where a cloud
# server's metadata answers), multicast and the empty address, judged on
# every address the host name resolves to.

class AddressRefused(ValueError):
    """An address PadSpan will not fetch, or cannot find; the text is for the owner."""


def _refused_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_loopback:
        return "this Home Assistant machine itself"
    if ip.is_link_local:
        return "a link-local address, not a device's address on your home network"
    if ip.is_multicast:
        return "a multicast address, not one device"
    if ip.is_unspecified:
        return "the empty address"
    return None


def address_url(base: str, path: str) -> str:
    """An http(s) address the owner gave, with `path` as its path.

    A query or fragment in what they gave is dropped, so it cannot swallow
    the path ("http://robot/?x" + path would fetch http://robot/). A `base`
    whose path already ends with `path` keeps it."""
    parts = urlsplit(str(base or "").strip())
    p = parts.path.rstrip("/")
    if not p.endswith(path):
        p += path
    return urlunsplit((parts.scheme, parts.netloc, p, "", ""))


def address_refusal(host: str) -> str | None:
    """Why `host` is never fetched, from the name alone (no lookup), or None."""
    h = (host or "").strip().lower().rstrip(".")
    if h == "localhost" or h.endswith(".localhost"):
        return "this Home Assistant machine itself"
    try:
        return _refused_ip(ipaddress.ip_address(h.split("%")[0]))
    except ValueError:
        return None


async def async_check_address(hass: Any, url: str, what: str) -> None:
    """Raise AddressRefused, in words for the owner, unless `url` is an http or
    https address PadSpan may fetch. `what` names the device ("the robot")."""
    example = f"Give {what}'s own address on your home network, for example http://192.168.1.50."
    try:
        parts = urlsplit(str(url or "").strip())
        host, port = parts.hostname, parts.port
    except ValueError as exc:
        raise AddressRefused(f"That is not a web address. {example}") from exc
    if parts.scheme not in ("http", "https") or not host:
        raise AddressRefused(f"The address must start with http:// or https://. {example}")
    why = address_refusal(host)
    if why:
        raise AddressRefused(f"PadSpan does not fetch from {host}: it is {why}. {example}")
    try:
        ipaddress.ip_address(host.split("%")[0])
        return  # a number, judged above
    except ValueError:
        pass
    try:
        infos = await hass.loop.getaddrinfo(host, port or (443 if parts.scheme == "https" else 80),
                                            type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as exc:
        raise AddressRefused(f"PadSpan could not find {host} on your network. Check the address, "
                             f"or use its number, for example http://192.168.1.50.") from exc
    for info in infos:
        try:
            ip = ipaddress.ip_address(str(info[4][0]).split("%")[0])
        except ValueError:
            continue
        why = _refused_ip(ip)
        if why:
            raise AddressRefused(f"PadSpan does not fetch from {host}: it leads to {ip}, {why}. {example}")
