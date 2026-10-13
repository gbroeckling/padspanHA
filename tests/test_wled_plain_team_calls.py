# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Without the licence, a PadSpan team is switched by plain HA light calls,
one member after another. A member that raised (offline, timeout) ended the
loop: the members after it never switched. Every member is tried now, and
the first failure is still raised for the caller."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from custom_components.padspan_ha import wled_exact


@pytest.mark.asyncio
async def test_one_offline_member_does_not_stop_the_rest():
    called = []

    async def fake_call(hass, eid, on, bri, transition):
        called.append(eid)
        if eid == "light.b":
            raise RuntimeError("timed out")

    hass = MagicMock()
    hass.data = {}
    with patch.object(wled_exact, "_plain_call", fake_call):
        with pytest.raises(RuntimeError):
            await wled_exact._plain_calls(hass, [("light.a", None), ("light.b", None), ("light.c", None)], True, None)
    assert called == ["light.a", "light.b", "light.c"]
