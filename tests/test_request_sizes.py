# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Two history requests have a largest size.

A Traceback request returns at most 4,000 frames and a movement-history
request at most 200 entries: the most the panel asks for. A request for more
(or for less than one) is brought to the nearest end by the command's schema,
so it is answered, with the capped size.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import voluptuous as vol

from custom_components.padspan_ha import websocket as W

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _checked(handler, **msg) -> dict:
    schema = vol.Schema({vol.Required("id"): int, **handler.ws_schema})
    return schema({"id": 1, "type": handler.ws_schema["type"], **msg})


@pytest.mark.parametrize("asked,got", [(4000, 4000), (360, 360), (1, 1), (4001, 4000), (10**9, 4000), (0, 1), (-5, 1)])
def test_a_traceback_request_is_at_most_4000_frames(asked, got):
    assert _checked(W.ws_traceback_get, max_frames=asked)["max_frames"] == got


def test_a_traceback_request_that_names_no_size_gets_4000():
    assert _checked(W.ws_traceback_get)["max_frames"] == 4000


@pytest.mark.parametrize("asked,got", [(200, 200), (60, 60), (1, 1), (201, 200), (10**9, 200), (0, 1), (-5, 1)])
def test_a_movement_history_request_is_at_most_200_entries(asked, got):
    assert _checked(W.ws_movement_history_get, limit=asked)["limit"] == got


def test_a_movement_history_request_that_names_no_size_gets_100():
    assert _checked(W.ws_movement_history_get)["limit"] == 100


@pytest.mark.parametrize("handler,key", [(W.ws_traceback_get, "max_frames"), (W.ws_movement_history_get, "limit")])
@pytest.mark.parametrize("bad", ["4000", 12.5, None, [1]])
def test_a_size_that_is_not_a_whole_number_is_still_refused(handler, key, bad):
    with pytest.raises(vol.Invalid):
        _checked(handler, **{key: bad})


def _js() -> dict[str, str]:
    return {p.name: p.read_text(encoding="utf-8") for p in sorted(_WWW.rglob("*.js")) if "vendor" not in p.parts}


def test_the_panel_never_asks_for_more():
    src = _js()
    frames, entries = [], []
    for name, text in src.items():
        for m in re.finditer(r"max_frames:\s*([A-Za-z_0-9]+)", text):
            v = m.group(1)
            if not v.isdigit():                     # a named size: its value is in the same file
                v = re.search(rf"\b{v}\s*=\s*(\d+)\s*;", text).group(1)
            frames.append(int(v))
        for m in re.finditer(r'"padspan_ha/movement_history_get",\s*\{[^}]*\blimit:\s*(\d+)', text):
            entries.append(int(m.group(1)))
    assert len(frames) == 4 and max(frames) == 4000, frames
    assert sorted(entries) == [60, 200], entries
    # Every request for either goes through one of the calls counted above.
    assert sum(t.count('"padspan_ha/traceback_get"') for t in src.values()) == 4
    assert sum(t.count('"padspan_ha/movement_history_get"') for t in src.values()) == 2
