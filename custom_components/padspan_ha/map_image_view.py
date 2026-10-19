# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Map image view
============================
Serves floor-plan images to logged-in users only.

Up to 0.38.142 the images sat under www/, and HA serves everything there at
/local/ without a login: on an install reachable from the internet, a home's
floor plan was open to anyone who had the URL. They now live under
<config>/padspan_ha/maps (maps_store.maps_dir_for) and leave only through
this view, which HA puts behind its auth.

An <img> cannot send an Authorization header, so the panel is handed a signed
link per map (async_sign_path, the way HA serves camera snapshots), from
maps_list and maps_image_urls. Two facts about signed links shape this:

  * Every signature is different — it carries the time it was issued. A
    link re-signed on every maps_list would give each image a new address
    after every pin save and make the browser fetch it again, so a link is
    kept and handed out again until it is half-way to expiring.
  * HA keeps the signing secret in memory only, so a restart invalidates
    every link. The panel re-fetches maps_list when it reconnects, and the
    cache here is in memory too, so nothing signed before the restart is
    handed out after it.

The links never go into the map dicts themselves: Diagnostics and the Maps
backup write those out whole, and a working link has no business in a file
somebody may attach to a GitHub issue.

The login check is done here rather than by `requires_auth = True`, the same
way core's CameraView does it and for its reason: a request HA refuses for a
view counts as a wrong login, so a wall tablet re-fetching a floor plan with
a link that expired (or died with a restart) would raise "Login attempt
failed" and, with IP banning on, ban the house's own tablet. As there, a bad
Authorization header is still a 401 and still counted; a stale link alone is
a 403.
"""

import functools
import logging
import re
import time
from datetime import timedelta
from typing import Any

from homeassistant.components.http import KEY_AUTHENTICATED, HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DATA_MAPS, DOMAIN, MAP_IMAGE_URL

_LOGGER = logging.getLogger(__name__)

SIGN_TTL = timedelta(hours=24)
# Hand a link out again only while it has at least this long left to live.
# The panel asks for its links every 10 minutes (panel.js _renewMapImageUrls),
# so the oldest link it can be holding still has over 11 h to spare.
_REUSE_S = 12 * 3600

_DATA_VIEW = f"{DOMAIN}_map_image_view"
_DATA_SIGNED = f"{DOMAIN}_map_image_signed"


def image_path(m: dict[str, Any]) -> str | None:
    """The unsigned path of a map's image, versioned on the picture.

    The PNG is rewritten in place by trim / rotate / replace, so the version
    is what stops a browser showing the pre-edit picture (issue #62). Same
    formula the panel used when it built the path itself.
    """
    image = m.get("image") or {}
    if not image.get("filename") or not m.get("id"):
        return None
    v = re.sub(r"[^a-zA-Z0-9]", "", str(m.get("updated") or image.get("sha256") or ""))[:16]
    path = f"{MAP_IMAGE_URL}/{m['id']}"
    return f"{path}?v={v}" if v else path


def signed_image_urls(
    hass: HomeAssistant, maps: list[dict[str, Any]], refresh_token_id: str | None
) -> dict[str, str]:
    """{map_id: signed link} for every map that has an image."""
    from homeassistant.components.http.auth import async_sign_path  # noqa: PLC0415

    cache: dict[tuple, tuple[str, float]] = hass.data.setdefault(_DATA_SIGNED, {})
    now = time.time()
    for key in [k for k, (_, t) in cache.items() if now - t >= _REUSE_S]:
        del cache[key]

    out: dict[str, str] = {}
    for m in maps:
        path = image_path(m)
        if path is None:
            continue
        key = (refresh_token_id, path)
        hit = cache.get(key)
        if hit is None:
            hit = cache[key] = (
                async_sign_path(hass, path, SIGN_TTL, refresh_token_id=refresh_token_id),
                now,
            )
        out[m["id"]] = hit[0]
    return out


class MapImageView(HomeAssistantView):
    """GET a map's image, for a logged-in user (header or signed link)."""

    url = MAP_IMAGE_URL + "/{map_id}"
    name = f"api:{DOMAIN}:map_image"
    # Checked in get(), as CameraView does — see the module docstring.
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request, map_id: str):
        from aiohttp import hdrs, web  # noqa: PLC0415

        # HA's auth middleware has already checked the header or the signed
        # link and recorded the answer; nothing is looked up before it is read.
        if not request.get(KEY_AUTHENTICATED, False):
            if hdrs.AUTHORIZATION in request.headers:
                raise web.HTTPUnauthorized   # a real login attempt: counted
            if "authSig" in request.query:
                # A signed link that no longer works; a bare request from a
                # stranger is not counted, so nobody outside can raise it.
                from .telemetry import bump  # noqa: PLC0415
                bump(self.hass, "map_image_stale")
            raise web.HTTPForbidden          # a stale link: not a wrong login

        fp = None
        ms = self.hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        # Looked up by id, never by a file name from the request, so the
        # request cannot point anywhere but at a map's own image.
        m = ms.get_map(map_id) if ms is not None else None
        fn = ((m or {}).get("image") or {}).get("filename")
        if fn:
            fp = await self.hass.async_add_executor_job(
                functools.partial(ms.image_file, fn, must_exist=True))
        if fp is None:
            return web.Response(status=404)
        # The link changes whenever the picture does (?v=), so caching it is
        # safe; "private" keeps it out of any shared cache in between.
        return web.FileResponse(fp, headers={"Cache-Control": "private, max-age=86400"})


def async_register_map_image_view(hass: HomeAssistant) -> None:
    """Register the view once per HA run (a reload must not add it again)."""
    if hass.data.get(_DATA_VIEW):
        return
    hass.http.register_view(MapImageView(hass))
    hass.data[_DATA_VIEW] = True
