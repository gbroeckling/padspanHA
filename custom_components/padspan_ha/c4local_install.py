# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""OS 2 Local for Control4, installed from inside PadSpan (the owner, 2026-11-25).

The specialty add-on c4local is its own Home Assistant integration, published at PROJECT_URL: the
domain `control4`, taking the place of Home Assistant's built-in Control4 integration, for OS 2
controllers (cloud services for Control4 OS 2 ended on 2026-11-01, and the built-in one logs in through
that cloud). HACS installs it too; this is the other way, from Settings → Tracking → Home Assistant
and integrations (views/c4local.js).

Nothing about it is shown or offered, to anyone, PadSpan Pro included, until the product is published
(the owner, 2026-11-25; published()): its one switch is c4local's on-sale flag, licence.NOT_ON_SALE (or a
moment in licence.ADDON_ON_SALE_FROM), with views/editions.js ADDONS on_sale / on_sale_from its twin
(tests/test_addon_gates.py holds the two equal). Flip both when github.com/gbroeckling/os2-local-for-control4
is published. Until then Install and the update check refuse ("not_published"); Undo never does.

A house that runs a local Control4 integration of its own (a custom `control4` with a LOCAL_MODULE module,
or an entry with the LOCAL_OPTION option: the owner's house runs exactly this) has a local login already:
local_other, said on Settings' card, never an offer, and Install refuses to go over it ("local_other").

Nothing here runs unless an administrator presses (every command is require_admin; Install and
the update check also need PadSpan Pro or the c4local add-on, licence.hass_addon_allowed):
  Install   downloads ZIP_URL, that one URL and nothing a caller sends, following GitHub's own
            redirects only (_HOSTS); refuses anything that is not the product: not a zip, over
            MAX_ZIP, a path that leaves the folder, a link, too much unpacked, or a manifest.json
            whose domain is not "control4" and whose name is not one of PRODUCT_NAMES. Then it moves any
            custom_components/control4 into BACKUPS (timestamped) and unpacks in its place.
  Undo      puts the newest backup back, or removes the folder when there is none, so the
            built-in Control4 comes back. It never touches a control4 folder that isn't the
            product, and it is never locked behind the licence.
  Check     reads the newest release's version from the redirect GitHub answers ZIP_URL with.
Home Assistant loads the change only when it restarts: the panel offers HA's own restart behind a
confirm. Nothing here ever restarts it. File work runs in HA's executor, the download on HA's
own aiohttp session.

The backups go to /config/padspan_ha/control4_backups/ (as WLED's go to padspan_ha/wled_backups),
not beside the folder: a copy in custom_components with the same manifest would be a second
`control4` to Home Assistant's loader.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import licence
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

ADDON = "c4local"
C4_DOMAIN = "control4"
PRODUCT_NAME = "OS 2 Local for Control4"
# Its manifest's name: the product's name since the owner's rename (2026-11-25), or the one its first releases
# were built with. Either is the product.
PRODUCT_NAMES = (PRODUCT_NAME, "Control4 OS 2 Local")
PROJECT_URL = "https://github.com/gbroeckling/os2-local-for-control4"
ZIP_URL = PROJECT_URL + "/releases/latest/download/control4.zip"
# Where GitHub sends ZIP_URL: the release's page, then its file store. No other host is followed.
_HOSTS = ("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
_TAG_RE = re.compile(r"^https://github\.com/gbroeckling/os2-local-for-control4/releases/download/v?(\d+(?:\.\d+){0,3})/control4\.zip$")
MAX_ZIP = 5 * 1024 * 1024          # the release is about 40 KiB
MAX_UNPACKED = 20 * 1024 * 1024
MAX_FILES = 300
_MAX_REDIRECTS = 5
_TIMEOUT_S = 60
# Config entry states that mean "failed to set up" (ConfigEntryState values).
_FAILED = ("setup_error", "setup_retry", "migration_error")
_LOCK = "c4local_lock"

NEED_ADDON = "Installing OS 2 Local for Control4 takes PadSpan Pro or the OS 2 Local for Control4 add-on."
NOT_PUBLISHED = "OS 2 Local for Control4 is not published yet."
LOCAL_OTHER = ("A local Control4 integration is installed (not OS 2 Local for Control4), so PadSpan does not "
               "install over it.")
# A local Control4 integration that is not the product: Home Assistant's own control4 with the controller's local
# token added (a local_token module), whose entry keeps the controller's system password (director_password).
LOCAL_MODULE = "local_token"
LOCAL_OPTION = "director_password"


def published() -> bool:
    """Whether the product is published: c4local on sale (licence.addon_on_sale, read on every call)."""
    return licence.addon_on_sale(ADDON)


class C4LocalError(Exception):
    """A refusal with its code; the panel says it in its own words by the code (views/c4local.js)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ── Paths ────────────────────────────────────────────────────────────────────

def _target(config_dir: str) -> Path:
    return Path(config_dir) / "custom_components" / C4_DOMAIN


def _backups(config_dir: str) -> Path:
    return Path(config_dir) / DOMAIN / "control4_backups"


def _staging(config_dir: str) -> Path:
    return Path(config_dir) / DOMAIN / "control4_staging"


def _manifest(folder: Path) -> dict[str, Any] | None:
    """A folder's manifest.json, or None (missing, unreadable, not an object)."""
    try:
        m = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return m if isinstance(m, dict) else None


def is_product(manifest: Any) -> bool:
    """Whether a manifest is OS 2 Local for Control4's: the domain control4, its name and a version."""
    return (isinstance(manifest, dict) and manifest.get("domain") == C4_DOMAIN
            and manifest.get("name") in PRODUCT_NAMES and isinstance(manifest.get("version"), str))


def _said(manifest: dict[str, Any] | None) -> dict[str, Any] | None:
    if manifest is None:
        return None
    return {"name": str(manifest.get("name") or ""), "version": str(manifest.get("version") or ""),
            "ours": is_product(manifest)}


def _version_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in re.findall(r"\d+", str(v))[:4])


def newer(latest: str | None, installed: str | None) -> bool:
    """Whether release `latest` is newer than `installed` (no installed version: any release is)."""
    if not latest:
        return False
    return not installed or _version_tuple(latest) > _version_tuple(installed)


# ── The zip ──────────────────────────────────────────────────────────────────

def check_zip(data: bytes) -> dict[str, Any]:
    """The product's manifest, if `data` is the product's release zip; C4LocalError otherwise.
    The integration's files sit at the zip's root (the release workflow's `git archive`)."""
    if len(data) > MAX_ZIP:
        raise C4LocalError("too_big", f"The download is over {MAX_ZIP // (1024 * 1024)} MiB.")
    if not data.startswith(b"PK\x03\x04"):
        raise C4LocalError("not_a_zip", "The download is not a zip file.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
            if not infos or len(infos) > MAX_FILES:
                raise C4LocalError("not_the_product", "The zip has no files, or far too many.")
            total = 0
            for info in infos:
                name = info.filename
                parts = name.split("/")
                if (not name or name.startswith("/") or "\\" in name or ":" in name or "\x00" in name
                        or any(p == ".." for p in parts)):
                    raise C4LocalError("not_the_product", "The zip has a path outside its folder.")
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise C4LocalError("not_the_product", "The zip has a link in it.")
                total += info.file_size
                if total > MAX_UNPACKED:
                    raise C4LocalError("too_big", "The zip unpacks to far too much.")
            if "manifest.json" not in zf.namelist() or "__init__.py" not in zf.namelist():
                raise C4LocalError("not_the_product", "The zip is not a Home Assistant integration.")
            try:
                manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            except (ValueError, UnicodeDecodeError) as err:
                raise C4LocalError("not_the_product", "The zip's manifest.json can't be read.") from err
            if not is_product(manifest):
                raise C4LocalError("not_the_product", f"The zip is not {PRODUCT_NAME}.")
            if zf.testzip() is not None:
                raise C4LocalError("not_a_zip", "The zip is damaged.")
    except zipfile.BadZipFile as err:
        raise C4LocalError("not_a_zip", "The download is not a zip file.") from err
    return manifest


# ── Files (executor) ─────────────────────────────────────────────────────────

def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _newest_backup(config_dir: str) -> Path | None:
    d = _backups(config_dir)
    if not d.is_dir():
        return None
    found = sorted(p for p in d.iterdir() if p.is_dir() and p.name.startswith("control4-"))
    return found[-1] if found else None


def _free(folder: Path, name: str) -> Path:
    out, n = folder / name, 2
    while out.exists():
        out, n = folder / f"{name}-{n}", n + 1
    return out


def disk_state(config_dir: str) -> dict[str, Any]:
    """What is on disk: the control4 folder's manifest, what Undo would do, and whether a folder that is not the
    product carries a local login of its own (LOCAL_MODULE)."""
    target = _target(config_dir)
    disk = _said(_manifest(target)) if target.is_dir() else None
    if target.exists() and disk is None:
        disk = {"name": "", "version": "", "ours": False}
    local = bool(disk and not disk["ours"]
                 and ((target / f"{LOCAL_MODULE}.py").is_file() or (target / LOCAL_MODULE).is_dir()))
    newest = _newest_backup(config_dir)
    undo = None
    if disk is None or disk["ours"]:
        if newest is not None:
            back = _said(_manifest(newest)) or {"name": "", "version": "", "ours": False}
            undo = {"what": "restore", "name": back["name"], "version": back["version"]}
        elif disk is not None:
            undo = {"what": "remove"}
    return {"disk": disk, "undo": undo, "local": local}


def install_files(config_dir: str, data: bytes, stamp: str) -> dict[str, Any]:
    """Unpack the checked release into custom_components/control4, the folder that was there moved
    into the backups first; on a failure the folder that was there is put back."""
    manifest = check_zip(data)
    target, backups, staging = _target(config_dir), _backups(config_dir), _staging(config_dir)
    if target.is_symlink() or (target.exists() and not target.is_dir()):
        raise C4LocalError("not_a_folder", "custom_components/control4 is not a plain folder; nothing was changed.")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        zf.extractall(staging)
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = None
    if target.exists():
        backups.mkdir(parents=True, exist_ok=True)
        backup = _free(backups, f"control4-{stamp}")
        shutil.move(str(target), str(backup))
    try:
        shutil.move(str(staging), str(target))
    except OSError:
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        if backup is not None:
            shutil.move(str(backup), str(target))
        raise
    return {"version": manifest["version"], "backup": backup.name if backup else None}


def undo_files(config_dir: str, stamp: str) -> dict[str, Any]:
    """Undo: the newest backup back in place, or the folder removed when there is none. Never a
    control4 folder that isn't the product."""
    target = _target(config_dir)
    state = disk_state(config_dir)
    if state["disk"] is not None and not state["disk"]["ours"]:
        raise C4LocalError("not_ours", f"custom_components/control4 is not {PRODUCT_NAME}; nothing was changed.")
    if state["undo"] is None:
        raise C4LocalError("nothing", "There is nothing to undo.")
    newest = _newest_backup(config_dir)
    old = None
    if target.exists():
        # Moved aside first (one rename), so a failure part-way never leaves half a folder in place.
        old = _free(_backups(config_dir), f"removed-{stamp}")
        old.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(target), str(old))
    if newest is not None:
        shutil.move(str(newest), str(target))
    if old is not None:
        shutil.rmtree(old, ignore_errors=True)
    return {"what": state["undo"]["what"], "version": state["undo"].get("version")}


# ── Home Assistant ───────────────────────────────────────────────────────────

def _entry_state(entry: Any) -> str:
    s = getattr(entry, "state", "")
    return str(getattr(s, "value", s))


def _os2_versions(hass: HomeAssistant, entry_ids: set[str]) -> list[str]:
    """The Director versions below 3 of the Control4 controllers HA knows (the core integration
    writes the controller's device with manufacturer Control4 and sw_version its Director's)."""
    if not entry_ids:
        return []
    from homeassistant.helpers import device_registry as dr  # noqa: PLC0415
    from .util import ha_device_config_entries, ha_devices  # noqa: PLC0415
    out = set()
    for d in ha_devices(dr.async_get(hass)):
        sw = str(getattr(d, "sw_version", "") or "")
        if (getattr(d, "manufacturer", "") == "Control4" and ha_device_config_entries(d) & entry_ids
                and re.match(r"^[0-2]\.", sw)):
            out.add(sw)
    return sorted(out)


async def _running(hass: HomeAssistant) -> dict[str, Any] | None:
    """The custom control4 Home Assistant loaded when it last started, or None (the built-in)."""
    try:
        from homeassistant.loader import async_get_custom_components  # noqa: PLC0415
    except ImportError:   # not a Home Assistant: nothing to say about it
        return None
    comps = await async_get_custom_components(hass)
    ci = comps.get(C4_DOMAIN) if isinstance(comps, dict) else None
    if ci is None:
        return None
    name = str(getattr(ci, "name", "") or "")
    version = getattr(ci, "version", None)
    return {"name": name, "version": str(version) if version is not None else "", "ours": name in PRODUCT_NAMES}


async def async_status(hass: HomeAssistant) -> dict[str, Any]:
    """What the panel's card shows: Control4 in this Home Assistant, the product on disk and
    running, whether HA must restart for it, and what Undo would do. Reads only."""
    entries = list(hass.config_entries.async_entries(C4_DOMAIN))
    ids = {e.entry_id for e in entries}
    # Reads only: a Control4 controller Home Assistant found and nobody has set up yet.
    discovered = bool(hass.config_entries.flow.async_progress_by_handler(C4_DOMAIN))
    files = await hass.async_add_executor_job(disk_state, hass.config.config_dir)
    running = await _running(hass)
    disk = files["disk"]
    was = (running["name"], running["version"]) if running else None
    now = (disk["name"], disk["version"]) if disk else None
    # Another custom control4, on disk or loaded, with a local login of its own: the house has one already.
    other = bool((disk and not disk["ours"]) or (running and not running["ours"]))
    with_option = any(LOCAL_OPTION in (getattr(e, "options", None) or {}) or LOCAL_OPTION in (getattr(e, "data", None) or {})
                      for e in entries)
    return {
        "published": published(),
        "local_other": other and (files["local"] or with_option),
        "allowed": licence.hass_addon_allowed(hass, ADDON),
        "entries": [{"title": str(e.title or ""), "state": _entry_state(e)} for e in entries],
        "failed": any(_entry_state(e) in _FAILED for e in entries),
        "os2": _os2_versions(hass, ids),
        "discovered": discovered,
        "disk": disk,
        "running": running,
        "restart_needed": was != now,
        "undo": files["undo"],
        "project_url": PROJECT_URL,
    }


def _hop(url: str, location: str) -> str:
    from yarl import URL  # noqa: PLC0415
    nxt = URL(url).join(URL(location))
    if nxt.scheme != "https" or nxt.host not in _HOSTS:
        raise C4LocalError("download_failed", "GitHub sent the download somewhere else; nothing was downloaded.")
    return str(nxt)


async def async_latest(hass: HomeAssistant) -> str:
    """The newest release's version, from where GitHub redirects ZIP_URL: the redirect is not followed, so
    nothing is downloaded."""
    from aiohttp import ClientError, ClientTimeout  # noqa: PLC0415
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
    session = async_get_clientsession(hass)
    try:
        async with session.get(ZIP_URL, allow_redirects=False, timeout=ClientTimeout(total=20)) as resp:
            location = resp.headers.get("Location", "")
            status = resp.status
    except (ClientError, asyncio.TimeoutError) as err:
        raise C4LocalError("offline", "GitHub couldn't be reached.") from err
    if status == 404:
        raise C4LocalError("no_release", f"{PRODUCT_NAME} has no release on GitHub yet.")
    m = _TAG_RE.match(_hop(ZIP_URL, location)) if status in (301, 302, 303, 307, 308) and location else None
    if not m:
        raise C4LocalError("download_failed", "GitHub's answer didn't say which release is the newest.")
    return m.group(1)


async def async_download(hass: HomeAssistant) -> tuple[str | None, bytes]:
    """ZIP_URL's bytes (at most MAX_ZIP), with the release's version where the redirect says it."""
    from aiohttp import ClientError, ClientTimeout  # noqa: PLC0415
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
    session = async_get_clientsession(hass)
    url, version = ZIP_URL, None
    try:
        for _ in range(_MAX_REDIRECTS + 1):
            async with session.get(url, allow_redirects=False, timeout=ClientTimeout(total=_TIMEOUT_S)) as resp:
                if resp.status in (301, 302, 303, 307, 308):
                    url = _hop(url, resp.headers.get("Location", ""))
                    if version is None and (m := _TAG_RE.match(url)):
                        version = m.group(1)
                    continue
                if resp.status == 404:
                    raise C4LocalError("no_release", f"{PRODUCT_NAME} has no release on GitHub yet.")
                if resp.status != 200:
                    raise C4LocalError("download_failed", f"GitHub answered {resp.status}.")
                if (resp.content_length or 0) > MAX_ZIP:
                    raise C4LocalError("too_big", f"The download is over {MAX_ZIP // (1024 * 1024)} MiB.")
                data = bytearray()
                async for chunk in resp.content.iter_chunked(65536):
                    data += chunk
                    if len(data) > MAX_ZIP:
                        raise C4LocalError("too_big", f"The download is over {MAX_ZIP // (1024 * 1024)} MiB.")
                return version, bytes(data)
    except (ClientError, asyncio.TimeoutError) as err:
        raise C4LocalError("offline", "GitHub couldn't be reached.") from err
    raise C4LocalError("download_failed", "GitHub sent the download round too many redirects.")


def _lock(hass: HomeAssistant) -> asyncio.Lock:
    return hass.data.setdefault(DOMAIN, {}).setdefault(_LOCK, asyncio.Lock())


async def async_install(hass: HomeAssistant) -> dict[str, Any]:
    """Download, check and unpack the newest release. HA must restart afterwards (never done here)."""
    lock = _lock(hass)
    if lock.locked():
        raise C4LocalError("busy", "An install or undo is already running.")
    async with lock:
        tag, data = await async_download(hass)
        manifest = await hass.async_add_executor_job(check_zip, data)
        if tag and _version_tuple(tag) != _version_tuple(manifest["version"]):
            raise C4LocalError("not_the_product", "The zip's version is not the release's.")
        out = await hass.async_add_executor_job(install_files, hass.config.config_dir, data, _stamp())
    _LOGGER.warning("PadSpan installed %s %s in custom_components/control4 (backup: %s); "
                    "Home Assistant loads it when it restarts", PRODUCT_NAME, out["version"], out["backup"] or "none")
    return out


async def async_undo(hass: HomeAssistant) -> dict[str, Any]:
    lock = _lock(hass)
    if lock.locked():
        raise C4LocalError("busy", "An install or undo is already running.")
    async with lock:
        out = await hass.async_add_executor_job(undo_files, hass.config.config_dir, _stamp())
    _LOGGER.warning("PadSpan undid %s: %s; Home Assistant loads the change when it restarts", PRODUCT_NAME,
                    "put back " + (out.get("version") or "the backup") if out["what"] == "restore" else "removed it")
    return out


# ── WebSocket commands (admins only) ─────────────────────────────────────────

@websocket_api.websocket_command({"type": "padspan_ha/c4local_status"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_c4local_status(hass: HomeAssistant, connection, msg) -> None:
    """Settings' OS 2 Local for Control4 card and the Overview's offer: what is there now (reads only)."""
    connection.send_result(msg["id"], await async_status(hass))


@websocket_api.websocket_command({"type": "padspan_ha/c4local_check"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_c4local_check(hass: HomeAssistant, connection, msg) -> None:
    """Check for an update: the newest release's version (pressed by an administrator)."""
    if not published():
        connection.send_error(msg["id"], "not_published", NOT_PUBLISHED)
        return
    if not licence.hass_addon_allowed(hass, ADDON):
        connection.send_error(msg["id"], "addon_required", NEED_ADDON)
        return
    try:
        latest = await async_latest(hass)
    except C4LocalError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    status = await async_status(hass)
    disk = status["disk"] if status["disk"] and status["disk"]["ours"] else None
    connection.send_result(msg["id"], {"latest": latest, "newer": newer(latest, disk["version"] if disk else None),
                                       "status": status})


@websocket_api.websocket_command({"type": "padspan_ha/c4local_install"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_c4local_install(hass: HomeAssistant, connection, msg) -> None:
    """Install or update (pressed by an administrator). Home Assistant must restart afterwards. Never before the
    product is published, and never over a local Control4 integration of the house's own."""
    if not published():
        connection.send_error(msg["id"], "not_published", NOT_PUBLISHED)
        return
    if not licence.hass_addon_allowed(hass, ADDON):
        connection.send_error(msg["id"], "addon_required", NEED_ADDON)
        return
    if (await async_status(hass))["local_other"]:
        connection.send_error(msg["id"], "local_other", LOCAL_OTHER)
        return
    try:
        out = await async_install(hass)
    except C4LocalError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    except OSError as err:
        _LOGGER.error("PadSpan couldn't install %s: %s", PRODUCT_NAME, err)
        connection.send_error(msg["id"], "files_failed", "The files couldn't be written; nothing was changed.")
        return
    connection.send_result(msg["id"], {"ok": True, **out, "restart_needed": True, "status": await async_status(hass)})


@websocket_api.websocket_command({"type": "padspan_ha/c4local_undo"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_c4local_undo(hass: HomeAssistant, connection, msg) -> None:
    """Undo (pressed by an administrator): never locked behind the licence."""
    try:
        out = await async_undo(hass)
    except C4LocalError as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    except OSError as err:
        _LOGGER.error("PadSpan couldn't undo %s: %s", PRODUCT_NAME, err)
        connection.send_error(msg["id"], "files_failed", "The files couldn't be moved; check Home Assistant's control4 folder.")
        return
    connection.send_result(msg["id"], {"ok": True, **out, "restart_needed": True, "status": await async_status(hass)})


WS_COMMANDS = (ws_c4local_status, ws_c4local_check, ws_c4local_install, ws_c4local_undo)
