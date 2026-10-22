# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Before Home Assistant 2026.8 the device registry matched Bluetooth
connections across integrations, so a labelled PadSpan device and Bermuda's
(or BTHome's) device for the same address merged, and PadSpan's name,
manufacturer and model overwrote theirs. There, PadSpan leaves the connection
out; from 2026.8 (and when the version can't be read) nothing changes."""

from __future__ import annotations

from pathlib import Path

from custom_components.padspan_ha import sensor as S


def test_2026_8_and_later_keep_the_connection_as_before(monkeypatch):
    monkeypatch.setattr(S, "_HA_KEEPS_BT_APART", True)
    got = S._bt_connections("AA:BB:CC:DD:EE:FF")
    assert len(got) == 1 and next(iter(got))[1] == "AA:BB:CC:DD:EE:FF"


def test_older_home_assistant_leaves_it_out(monkeypatch):
    monkeypatch.setattr(S, "_HA_KEEPS_BT_APART", False)
    assert S._bt_connections("AA:BB:CC:DD:EE:FF") == set()


def test_no_address_no_connection_and_every_device_uses_the_rule():
    assert S._bt_connections(None) == set() and S._bt_connections("") == set()
    src = Path(S.__file__).read_text(encoding="utf-8")
    assert src.count('"connections": _bt_connections(address),') == 3
    assert "{(dr.CONNECTION_BLUETOOTH, address)}\n" not in src.replace("\r\n", "\n").split("def _bt_connections")[0]
    assert "(int(_HA_MAJOR), int(_HA_MINOR)) >= (2026, 8)" in src and "_HA_KEEPS_BT_APART = True" in src
