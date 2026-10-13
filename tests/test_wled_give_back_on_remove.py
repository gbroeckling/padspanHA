# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Deleting PadSpan gives every WLED device it runs its sync back.

Switching a device to PadSpan writes sync off into its saved config; the
original settings live only in padspan_ha.wled_looks. There was no
async_remove_entry, so deleting the integration left every such device with
its WLED sync groups dead across reboots, and nothing left to restore them."""

from __future__ import annotations

import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.padspan_ha import wled_exact
from custom_components.padspan_ha.wled_exact import new_record


def test_the_integration_has_a_remove_hook():
    import custom_components.padspan_ha as pkg
    assert hasattr(pkg, "async_remove_entry")


@pytest.mark.asyncio
async def test_padspan_run_devices_are_switched_back_and_unreachable_ones_named():
    run = new_record("AA", "dev1", "Deck")
    run.update(join="padspan", exact=True, sync_off="saved", prior_sync={"cfg": {}})
    off = new_record("BB", "dev2", "Porch")
    off.update(join="padspan", exact=True, sync_off="saved", prior_sync={"cfg": {}})
    plain = new_record("CC", "dev3", "Hall")
    st = MagicMock()
    st.data = {"devices": {"AA": run, "BB": off, "CC": plain}}
    st.async_save = AsyncMock()
    idents = {"dev1": {"tgt": {"host": "10.0.0.5"}}, "dev2": {"tgt": None}}
    switched = []

    async def fake_switch(hass, rec, tgt):
        switched.append(rec["name"])

    with patch.object(wled_exact, "async_get_store", AsyncMock(return_value=st)), \
         patch.object(wled_exact, "_identify", lambda hass, device_id=None: idents.get(device_id)), \
         patch.object(wled_exact, "switch_to_wled", fake_switch), \
         patch.object(wled_exact.W, "device_lock", lambda hass, host: contextlib.nullcontext()):
        hass = MagicMock()
        hass.config_entries.async_entries = lambda domain: []
        missed = await wled_exact.async_give_back_all(hass)
    assert switched == ["Deck"]
    assert missed == ["Porch"]
    st.async_save.assert_awaited_once()


def test_a_lapsed_licence_can_give_a_padspan_team_back():
    """The fallback card skipped team members entirely; members can't leave a
    team one by one and the Team card is behind the licence, so there was no
    button anywhere although the backend allows it."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www"
           / "padspan-ha" / "views" / "lights_map.js").read_text(encoding="utf-8")
    assert 'x.team_mode === "padspan") return;' not in src
    assert 'type: "padspan_ha/wled_team_mode", team_id: x.team_id, mode: "mirror"' in src


@pytest.mark.asyncio
async def test_nothing_is_touched_while_the_other_edition_is_installed():
    """Someone who moved between PadSpan HA and Bright may run the device from
    the other edition now; this store's record of it is old."""
    run = new_record("AA", "dev1", "Deck")
    run.update(join="padspan", exact=True, sync_off="saved", prior_sync={"cfg": {}})
    st = MagicMock()
    st.data = {"devices": {"AA": run}}
    st.async_save = AsyncMock()
    switch = AsyncMock()
    hass = MagicMock()
    hass.config_entries.async_entries = lambda domain: [object()] if domain == wled_exact._OTHER_EDITION_DOMAIN else []
    with patch.object(wled_exact, "async_get_store", AsyncMock(return_value=st)),          patch.object(wled_exact, "switch_to_wled", switch):
        await wled_exact.async_give_back_all(hass)
    switch.assert_not_awaited()
    # The other edition, in either build (the Bright build renames this file's
    # own domain; the full edition's name is spelled to survive that).
    assert wled_exact._OTHER_EDITION_DOMAIN != wled_exact.DOMAIN
    assert {wled_exact._OTHER_EDITION_DOMAIN, wled_exact.DOMAIN} == {"padspan" + "_ha", "padspan_bright"}
