# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The integration's own folder gives out two images and nothing else.

/padspan_ha_int/icon.png and /padspan_ha_int/logo.png are each registered as
one file. No other file of the integration has a URL there. The panel's own
files are served from /padspan_ha_static as before.
"""

from __future__ import annotations

import sys
import types
from collections import namedtuple
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import panel as P
from custom_components.padspan_ha.const import DOMAIN

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


class _Http:
    """Home Assistant's static paths, as far as this needs them: a registered
    folder serves every file under its URL, a registered file serves at
    exactly its URL."""

    def __init__(self, api: str) -> None:
        self.paths: list[tuple[str, Path]] = []
        if api == "configs":                       # current Home Assistant
            async def _many(configs):
                self.paths.extend((c.url_path, Path(c.path)) for c in configs)
            self.async_register_static_paths = _many
        elif api == "async":                       # older
            async def _one(url, path, cache_headers=True):
                self.paths.append((url, Path(path)))
            self.async_register_static_path = _one
        else:                                      # oldest
            self.register_static_path = lambda url, path, cache_headers=True: self.paths.append((url, Path(path)))

    def served(self, url: str) -> Path | None:
        for base, path in self.paths:
            if path.is_dir():
                if url.startswith(base + "/"):
                    target = (path / url[len(base) + 1:]).resolve()
                    if target.is_file() and path.resolve() in target.parents:
                        return target
            elif url == base and path.is_file():
                return path.resolve()
        return None


def _set_up(monkeypatch, api: str) -> _Http:
    import homeassistant.components as comps
    import homeassistant.components.http as ha_http
    if api == "configs":
        monkeypatch.setattr(ha_http, "StaticPathConfig", namedtuple("StaticPathConfig", "url_path path cache_headers"),
                            raising=False)
    else:
        monkeypatch.delattr(ha_http, "StaticPathConfig", raising=False)
    pc = types.SimpleNamespace(async_register_panel=lambda **kw: None)
    monkeypatch.setattr(comps, "panel_custom", pc, raising=False)
    monkeypatch.setitem(sys.modules, "homeassistant.components.panel_custom", pc)
    monkeypatch.setattr(P, "edition", lambda: "full")
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    hass.http = _Http(api)
    return hass


_APIS = ["configs", "async", "sync"]


@pytest.mark.parametrize("api", _APIS)
async def test_the_two_images_are_served_where_they_always_were(monkeypatch, api):
    hass = _set_up(monkeypatch, api)
    await P.async_setup_panel(hass)
    assert hass.http.served("/padspan_ha_int/icon.png") == (_CC / "icon.png").resolve()
    assert hass.http.served("/padspan_ha_int/logo.png") == (_CC / "logo.png").resolve()


@pytest.mark.parametrize("api", _APIS)
@pytest.mark.parametrize("name", ["panel.py", "__init__.py", "const.py", "manifest.json", "strings.json",
                                  "brand/icon.png", "data/bt_companies.tsv", "www/padspan-ha/panel.js",
                                  "icon.png/", "icon.png/../panel.py", ""])
async def test_nothing_else_in_the_folder_is_served(monkeypatch, api, name):
    hass = _set_up(monkeypatch, api)
    await P.async_setup_panel(hass)
    assert hass.http.served(f"/padspan_ha_int/{name}") is None
    assert hass.http.served("/padspan_ha_int") is None


@pytest.mark.parametrize("api", _APIS)
async def test_only_the_panels_own_folder_is_registered_as_a_folder(monkeypatch, api):
    hass = _set_up(monkeypatch, api)
    await P.async_setup_panel(hass)
    assert sorted((url, path.resolve()) for url, path in hass.http.paths) == sorted([
        ("/padspan_ha_static", (_CC / "www").resolve()),
        ("/padspan_ha_int/icon.png", (_CC / "icon.png").resolve()),
        ("/padspan_ha_int/logo.png", (_CC / "logo.png").resolve()),
    ])
    assert [url for url, path in hass.http.paths if path.is_dir()] == ["/padspan_ha_static"]
    # The panel's own files, at the URLs the panel is loaded from.
    assert hass.http.served("/padspan_ha_static/padspan-ha/panel.js") == (_CC / "www" / "padspan-ha" / "panel.js").resolve()
    assert hass.http.served("/padspan_ha_static/padspan-ha/assets/padspan-mark.svg") is not None


def test_the_two_images_are_in_the_folder():
    assert P.ICON_FILES == ("icon.png", "logo.png")
    for name in P.ICON_FILES:
        assert (_CC / name).is_file(), name
