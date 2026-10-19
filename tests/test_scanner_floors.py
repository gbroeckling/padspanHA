# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Per-receiver minimum signal (opt-in; Ben Hines, 2026-10-16).

A receiver on an outside wall or floor hears the street, the shop below and the
neighbours. `scanner_min_rssi` = {source: dBm}: weaker readings at that receiver
are ignored by positioning and the occupancy phone count. It is an option: empty
by default, and with nothing set every reading counts exactly as before. Nothing
that needs every reading reads it: the snapshot's per-device sources (Find My
following, the lists), Forensics, Traceback, calibration and capture.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from custom_components.padspan_ha import ws_occupancy as OC
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_rules import below_floor, clean_floors, scanner_floors
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


def test_off_by_default_and_nothing_is_below_no_floor():
    assert DEFAULT_SETTINGS["scanner_min_rssi"] == {}
    assert scanner_floors(DEFAULT_SETTINGS) == {}
    assert not below_floor({}, "kit", -99) and not below_floor(None, "kit", -99)


def test_only_sources_with_a_floor_in_range_count():
    s = {"scanner_min_rssi": {"wall": -90, "door": "-80", "junk": "x", "loud": -10, "deaf": -200, "": -85}}
    assert scanner_floors(s) == {"wall": -90.0, "door": -80.0}
    assert clean_floors(s["scanner_min_rssi"]) == {"wall": -90, "door": -80}
    assert clean_floors("nope") == {} and clean_floors({"a": -84.6}) == {"a": -85}
    fl = scanner_floors(s)
    assert below_floor(fl, "wall", -91) and not below_floor(fl, "wall", -90) and not below_floor(fl, "other", -100)


def test_the_coordinator_reads_floors_with_its_masks():
    from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
    hass = MagicMock()
    st = MagicMock(); st.data = {"scanner_min_rssi": {"wall": -90}}
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    c = PresenceCoordinator(hass)
    assert c._floor_cache == {}
    c._excluded_sources()
    assert c._floor_cache == {"wall": -90.0}


def _ad(addr, src, rssi):
    # An Apple Nearby advert: what _phone_class takes for a phone.
    return {"address": addr, "source": src, "rssi": rssi, "manufacturer_data": {76: bytes.fromhex("10050b1c")}}


def test_occupancy_drops_a_neighbours_phone_only_when_floors_say_so():
    nb = "7A:11:22:33:44:55"            # rotating (RPA) address
    ads = [_ad(nb, "wall", -72), _ad(nb, "door", -74)]
    same_as_before = OC._phone_candidates(ads, set())
    assert OC._phone_candidates(ads, set(), {}) == same_as_before and nb in same_as_before
    # The wall receiver ignores anything weaker than -70: one scanner left, not counted.
    assert nb not in OC._phone_candidates(ads, set(), {"wall": -70.0})


def test_nothing_that_needs_every_reading_reads_the_floors():
    for f in ("snapshot_builder.py", "findmy.py", "forensics_store.py", "calibration_store.py",
              "ws_capture.py", "traceback_store.py", "bluetooth_live.py"):
        p = ROOT / f
        if p.exists():
            assert "scanner_min_rssi" not in p.read_text(encoding="utf-8") and "scanner_floors" not in p.read_text(encoding="utf-8"), f
    used = [f.name for f in ROOT.glob("*.py") if "scanner_floors(" in f.read_text(encoding="utf-8") and f.name != "presence_rules.py"]
    assert sorted(used) == ["presence_coordinator.py", "ws_occupancy.py", "ws_settings.py"] or sorted(used) == ["presence_coordinator.py", "ws_occupancy.py"], used


def test_a_floor_never_changes_what_auto_calibration_saves():
    """A floor is a positioning choice. The pinned-beacon auto-calibration
    still gets every reading, or a floor set on one receiver would write
    calibration points that lack it, biased to the beacon's stronger samples,
    and those points outlive the floor (pre-stable review, 0.38.139)."""
    from unittest.mock import AsyncMock, MagicMock
    from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
    from tests.test_poll_level import ble_object, make_coordinator, run_poll

    coord = make_coordinator({"scanner_min_rssi": {"wall": -85}})
    model = MagicMock()
    model.beacon_positions_m.return_value = {"bk1": {"room": "Kitchen", "floor_id": "main", "x_m": 1.0, "y_m": 1.0}}
    model.get_scanner_mappings.return_value = ({"wall": "Kitchen", "door": "Hall"}, {"wall": "main", "door": "main"})
    model.sync_mode.return_value = "manual"
    model.async_sync_floors = AsyncMock()
    coord.hass.data[DOMAIN][DATA_MODEL] = model
    coord._inject_beacon_calibration = AsyncMock()
    ads = [{"address": "AA:BB:CC:DD:EE:01", "source": "wall", "rssi": -90, "age_s": 1.0},
           {"address": "AA:BB:CC:DD:EE:01", "source": "door", "rssi": -60, "age_s": 1.0}]
    from tests.test_poll_level import snapshot
    run_poll(coord, snapshot([ble_object("bk1", "AA:BB:CC:DD:EE:01")], ads))

    assert coord._inject_beacon_calibration.await_count == 1
    cal_map = coord._inject_beacon_calibration.await_args.args[3]
    assert cal_map["AA:BB:CC:DD:EE:01"] == {"wall": -90.0, "door": -60.0}, cal_map
