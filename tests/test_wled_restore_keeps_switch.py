# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A backup restore brings WLED looks back, not what PadSpan did to the
devices. The records of which device PadSpan runs, the sync it switched off
and the original sync it keeps to put back describe each device's flash now;
an older backup replaced them, so a device switched since read "WLED sync"
with its sync still off, and switching it again kept the already-off
settings as the originals - lost for good."""

from __future__ import annotations

from custom_components.padspan_ha.wled_exact import (
    new_record, restore_keeps_switch_state, restore_keeps_team_state,
)


def test_live_switch_fields_survive_an_older_backup():
    live = new_record("AA", "dev1", "Strip")
    live.update(join="padspan", exact=True, sync_off="saved", prior_sync={"cfg": {"send": {"en": True}}},
                look={"bri": 10})
    old = new_record("AA", "dev1", "Strip")
    old.update(look={"bri": 200})
    out = restore_keeps_switch_state({"devices": {"AA": live}}, {"devices": {"AA": old}})
    rec = out["devices"]["AA"]
    assert rec["look"] == {"bri": 200}                       # the look is restored
    assert rec["exact"] is True and rec["join"] == "padspan"  # the device's state is not
    assert rec["prior_sync"] == {"cfg": {"send": {"en": True}}}


def test_a_device_padspan_runs_now_is_kept_if_the_backup_predates_it():
    live = new_record("BB", "dev2", "Porch")
    live.update(exact=True, join="padspan", prior_sync={"cfg": {}})
    out = restore_keeps_switch_state({"devices": {"BB": live}}, {"devices": {}})
    assert out["devices"]["BB"]["exact"] is True


def test_team_mode_and_prior_stay_live():
    live = [{"id": "t1", "name": "Deck", "mode": "padspan", "prior": {"dev1": {"x": 1}}},
            {"id": "t2", "name": "New", "mode": "padspan", "prior": {}}]
    old = [{"id": "t1", "name": "Deck (old name)", "mode": "mirror", "prior": None}]
    out = restore_keeps_team_state(live, old)
    assert out[0]["name"] == "Deck (old name)" and out[0]["mode"] == "padspan"
    assert out[0]["prior"] == {"dev1": {"x": 1}}
    assert [t["id"] for t in out] == ["t1", "t2"]
