# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Energy, the add-on (energy.py; the owner, 2026-11-26).

Off by default and nothing read while off; only where the add-on is allowed (PadSpan Pro or an "energy" key); not on
sale. With Home Assistant's Energy setup faked (prefs, states, statistics): devices by room, a parent less its child,
W and kW, stale readings out of every total, the cost at the grid's price (a number, an entity, a /MWh entity, the
older flow_from), the house from the home source or the grid plus solar, the rest of the house; the health checks;
empty rooms from PadSpan's presence (Traceback), from the rooms' motion sensors without scanners, and with everyone
away, the always-on list left out; away standby's samples and percentile; the spikes and their administrator's check;
Yesterday at home's line; the usage report's counts; the settings.
"""

from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from custom_components.padspan_ha import energy as E
from custom_components.padspan_ha import presence_coordinator as PC
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_MODEL, DATA_SETTINGS, DATA_TRACEBACK, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

NOW = datetime(2026, 11, 26, 14, 0, tzinfo=timezone.utc).timestamp()
MIDNIGHT = datetime(2026, 11, 26, 0, 0, tzinfo=timezone.utc).timestamp()
LATER = (datetime.now(timezone.utc) + timedelta(days=700)).strftime("%Y-%m-%d %H:%M:%S")
KEY = {"forensics_license_key": "PSPAN-ADDO-NNNN-NNNN-0009", "license_tier": "free", "license_addons": ["energy"],
       "license_addons_until": {"energy": LATER}}


def st(state: Any, unit: str | None = None, age: float = 30.0, **attrs: Any) -> SimpleNamespace:
    """A state as Home Assistant has it: its value, unit, when it last reported and last changed."""
    at = datetime.fromtimestamp(NOW - age, timezone.utc)
    a = {**({"unit_of_measurement": unit} if unit else {}), **attrs}
    return SimpleNamespace(state=str(state), attributes=a, last_updated=at, last_reported=at, last_changed=at)


class States(dict):
    def get(self, eid, default=None):   # noqa: D401 - as hass.states.get
        return super().get(eid, default)

    def async_all(self, domain=None):
        return [SimpleNamespace(entity_id=k, **vars(v)) for k, v in self.items() if domain is None or k.startswith(domain + ".")]


PREFS = {
    "energy_sources": [
        {"type": "grid", "stat_energy_from": "sensor.grid_in", "stat_rate": "sensor.grid_power", "number_energy_price": 0.12},
        {"type": "solar", "stat_energy_from": "sensor.solar", "stat_rate": "sensor.solar_power"},
        {"type": "home", "stat_energy_to": "sensor.home", "stat_rate": "sensor.home_power"},
    ],
    "device_consumption": [
        {"stat_consumption": "sensor.fridge_energy", "stat_rate": "sensor.fridge_power", "name": "Fridge"},
        {"stat_consumption": "sensor.strip_energy", "stat_rate": "sensor.strip_power", "name": "Desk strip"},
        {"stat_consumption": "sensor.pc_energy", "stat_rate": "sensor.pc_power", "included_in_stat": "sensor.strip_energy"},
        {"stat_consumption": "sensor.heater_energy", "stat_rate": "sensor.heater_power", "name": "Heater"},
        {"stat_consumption": "sensor.fridge_energy", "name": "a duplicate"},
        {"stat_consumption": "sensor.nowhere_energy"},
    ],
}


def states(**over: Any) -> States:
    s = States({
        "sensor.home_power": st(2000, "W"), "sensor.grid_power": st(800, "W"), "sensor.solar_power": st(1.2, "kW"),
        "sensor.fridge_power": st(80, "W"), "sensor.fridge_energy": st(100, "kWh"),
        "sensor.strip_power": st(150, "W"), "sensor.strip_energy": st(50, "kWh"),
        "sensor.pc_power": st(100, "W", friendly_name="Gaming PC"), "sensor.pc_energy": st(20000, "Wh"),
        "sensor.heater_power": st(1.5, "kW"), "sensor.heater_energy": st(7, "kWh"),
        "sensor.nowhere_energy": st(3, "kWh"),
        "sun.sun": st("above_horizon"),
    })
    s.update(over)
    return s


AREAS = {"sensor.fridge_power": ("Kitchen", "dev_fridge"), "sensor.fridge_energy": ("Kitchen", "dev_fridge"),
         "sensor.strip_power": ("Office", "dev_strip"), "sensor.strip_energy": (None, "dev_strip"),
         "sensor.pc_power": (None, None), "sensor.pc_energy": ("Den", "dev_pc"),
         "sensor.heater_power": ("Bedroom", "dev_heater"), "sensor.heater_energy": ("Bedroom", "dev_heater"),
         "sensor.nowhere_energy": (None, None)}
KWH = {"sensor.fridge_energy": 1.2, "sensor.strip_energy": 2.0, "sensor.pc_energy": 1.5, "sensor.heater_energy": 3.0}


def facts(**over: Any) -> dict[str, Any]:
    f = {"prefs": PREFS, "states": states(), "now": NOW, "day_start": MIDNIGHT, "settings": {}, "currency": "CAD",
         "areas": AREAS, "rooms": ["Kitchen", "Office", "Bedroom", "Living room"], "kwh": KWH, "hourly": {},
         "power_kwh": {}, "occupancy": {}, "sun_below": False, "samples": []}
    f.update(over)
    return f


def by(rows: list[dict], key: str, value: Any) -> dict:
    return next(r for r in rows if r[key] == value)


# ── what Home Assistant gives ───────────────────────────────────────────────

def test_the_devices_once_each_and_a_parent_that_is_metered() -> None:
    devs = E.devices_of(PREFS)
    assert [d["id"] for d in devs] == ["sensor.fridge_energy", "sensor.strip_energy", "sensor.pc_energy",
                                       "sensor.heater_energy", "sensor.nowhere_energy"]
    assert by(devs, "id", "sensor.pc_energy")["parent"] == "sensor.strip_energy"
    assert E.devices_of({"device_consumption": [{"stat_consumption": "sensor.a", "included_in_stat": "sensor.gone"}]})[0]["parent"] is None
    assert E.devices_of(None) == [] and E.devices_of({"device_consumption": ["junk", {"name": "no stat"}]}) == []


def test_watts_from_w_and_kw_and_a_stale_or_odd_reading() -> None:
    assert E.reading(st(1.5, "kW"), NOW)["w"] == 1500.0 and E.reading(st(80, "W"), NOW)["w"] == 80.0
    old = E.reading(st(80, "W", age=E.STALE_S + 1), NOW)
    assert old["stale"] is True and old["age_s"] > E.STALE_S
    va = E.reading(st(80, "VA"), NOW)
    assert va["w"] is None and va["unit_ok"] is False
    assert E.reading(st("unavailable", "W"), NOW)["stale"] is True and E.reading(None, NOW)["w"] is None


def test_the_price_from_a_number_an_entity_and_the_older_flow_list() -> None:
    assert E.price_of(PREFS, states()) == 0.12
    ent = {"energy_sources": [{"type": "grid", "entity_energy_price": "sensor.price"}]}
    assert E.price_of(ent, states(**{"sensor.price": st(0.15, "CAD/kWh")})) == 0.15
    assert E.price_of(ent, states(**{"sensor.price": st(150, "CAD/MWh")})) == pytest.approx(0.15)
    assert E.price_of(ent, states()) is None
    old = {"energy_sources": [{"type": "grid", "flow_from": [{"stat_energy_from": "sensor.x", "number_energy_price": 0.2}]}]}
    assert E.price_of(old, states()) == 0.2 and E.price_of({}, states()) is None


# ── rooms, nesting, cost, the house ─────────────────────────────────────────

def test_rooms_devices_nesting_cost_and_the_rest_of_the_house() -> None:
    got = E.compute(facts())
    assert got["on"] is True and got["set_up"] is True and got["currency"] == "CAD" and got["price"] == 0.12
    d = {r["id"]: r for r in got["devices"]}
    assert d["sensor.fridge_energy"]["room"] == "Kitchen" and d["sensor.fridge_energy"]["on_map"] is True
    assert d["sensor.fridge_energy"]["device_id"] == "dev_fridge"
    assert d["sensor.heater_energy"]["w"] == 1500.0                                  # kW read as W
    # The strip's own watts and kWh are its own less the PC plugged into it: nothing counted twice.
    assert d["sensor.strip_energy"]["w"] == 150.0 and d["sensor.strip_energy"]["own_w"] == 50.0
    assert d["sensor.strip_energy"]["own_kwh"] == 0.5 and d["sensor.strip_energy"]["cost"] == pytest.approx(0.06)
    # The PC's room: its power sensor has no area, its energy sensor's is the Den (not on the map: still a room).
    assert d["sensor.pc_energy"]["room"] == "Den" and d["sensor.pc_energy"]["on_map"] is False
    assert d["sensor.pc_energy"]["name"] == "Gaming PC"
    rooms = {r["room"]: r for r in got["rooms"]}
    assert rooms["Office"]["w"] == 50.0 and rooms["Den"]["w"] == 100.0 and rooms["Kitchen"]["kwh"] == 1.2
    assert rooms["Kitchen"]["cost"] == pytest.approx(0.144) and "Living room" not in rooms     # no metering: no room
    h = got["house"]
    assert h["source"] == "home" and h["w"] == 2000.0 and h["metered_w"] == 80 + 50 + 100 + 1500
    assert h["rest_w"] == 2000.0 - 1730.0
    assert got["rooms"][0]["room"] == "Bedroom"                                       # the busiest room first


def test_the_house_is_the_grid_plus_solar_without_a_home_source_and_none_without_either() -> None:
    prefs = {**PREFS, "energy_sources": [s for s in PREFS["energy_sources"] if s["type"] != "home"]}
    got = E.compute(facts(prefs=prefs))
    assert got["house"]["source"] == "grid" and got["house"]["w"] == 800.0 + 1200.0
    exporting = E.compute(facts(prefs=prefs, states=states(**{"sensor.grid_power": st(-700, "W")})))
    assert exporting["house"]["w"] == -700.0 + 1200.0                                 # signed: export is minus
    bare = {"device_consumption": PREFS["device_consumption"]}
    none = E.compute(facts(prefs=bare))
    assert none["house"]["w"] is None and none["house"]["rest_w"] is None and none["set_up"] is True
    assert E.compute(facts(prefs=None))["set_up"] is False and E.compute(facts(prefs={}))["devices"] == []


def test_a_stale_reading_is_said_and_left_out_of_every_total() -> None:
    got = E.compute(facts(states=states(**{"sensor.heater_power": st(1.5, "kW", age=E.STALE_S + 60)})))
    d = by(got["devices"], "id", "sensor.heater_energy")
    assert d["stale"] is True and d["w"] is None and d["own_w"] is None
    assert by(got["rooms"], "room", "Bedroom")["w"] == 0.0 and got["house"]["metered_w"] == 230.0
    assert {"kind": "stale", "entity": "sensor.heater_power"} == {k: v for k, v in got["issues"][0].items() if k != "age_s"}


# ── the health check ────────────────────────────────────────────────────────

def test_the_health_check_finds_each_kind_with_its_entity() -> None:
    s = states(**{"sensor.fridge_power": st(80, "VA"), "sensor.heater_energy": st(7, "L"),
                  "sensor.pc_power": st(400, "W"), "sensor.grid_power": st(-300, "W"), "sun.sun": st("below_horizon")})
    got = E.compute(facts(states=s, sun_below=True, power_kwh={"sensor.strip_power": 6.0}))
    kinds = {(i["kind"], i["entity"]) for i in got["issues"]}
    assert ("unit", "sensor.fridge_power") in kinds and ("unit", "sensor.heater_energy") in kinds
    assert ("no_area", "sensor.nowhere_energy") in kinds
    assert ("mismatch", "sensor.strip_energy") in kinds                               # 2.0 kWh against 6.0 from power
    assert ("child_over_parent", "sensor.pc_energy") in kinds                         # 400 W in a 150 W strip
    assert ("grid_sign", "sensor.grid_power") in kinds                                # export at night, no battery
    assert set(i["kind"] for i in got["issues"]) <= set(E.ISSUE_KINDS)
    # A battery can export at night: no grid_sign then; the day: none either.
    battery = {**PREFS, "energy_sources": [*PREFS["energy_sources"], {"type": "battery", "stat_rate": "sensor.batt"}]}
    assert not [i for i in E.compute(facts(prefs=battery, states=s, sun_below=True))["issues"] if i["kind"] == "grid_sign"]
    assert not [i for i in E.compute(facts(states=s, sun_below=False))["issues"] if i["kind"] == "grid_sign"]
    assert not [i for i in E.compute(facts())["issues"] if i["kind"] != "no_area"]


# ── empty rooms ─────────────────────────────────────────────────────────────

def test_padspan_presence_says_which_rooms_are_empty_and_since_when() -> None:
    trace = {"kitchen": [(NOW - 3 * 3600, NOW - 2 * 3600)], "office": [(NOW - 7200, NOW - 30)]}
    occ = E.room_occupancy(["Kitchen", "Office", "Bedroom"], trace, NOW - E.LOOKBACK_S, {}, None, NOW, 900, MIDNIGHT,
                           receivers=["Bedroom"])
    assert occ["office"]["occupied"] is True
    assert occ["kitchen"]["occupied"] is False and occ["kitchen"]["since"] == NOW - 2 * 3600
    assert occ["kitchen"]["empty"] == 7200
    # Today's empty stretches start once the room has been empty after_s: midnight to its visit, and after it.
    assert occ["kitchen"]["spans"] == [(MIDNIGHT, NOW - 3 * 3600), (NOW - 2 * 3600 + 900, NOW)]
    assert occ["bedroom"]["since"] == NOW - E.LOOKBACK_S                              # nobody in it all day
    got = E.compute(facts(occupancy=occ, settings={"energy_empty_after_min": 15}))
    kitchen = by(got["rooms"], "room", "Kitchen")
    assert kitchen["empty"]["w"] == 80.0 and kitchen["empty"]["for_s"] == 7200
    assert by(got["rooms"], "room", "Office")["empty"] is None
    assert {e["room"] for e in got["empty"]["rooms"]} == {"Kitchen", "Bedroom"} and got["empty"]["w"] == 1580.0
    assert got["empty"]["rooms"][0]["room"] == "Bedroom" and got["empty"]["after_min"] == 15


def test_between_traceback_reads_its_last_minutes_say_who_is_in_now() -> None:
    trace = {"kitchen": [(NOW - 7200, NOW - 3600)]}
    frames = [{"ts": NOW - 900, "o": [{"k": "a", "r": "Office"}]}, {"ts": NOW - 30, "o": [{"k": "a", "r": "Kitchen"}]}]
    got = E.with_recent(trace, frames, NOW - 600)
    assert got["kitchen"][-1] == (NOW - 30, NOW - 30) and "office" not in got
    assert trace == {"kitchen": [(NOW - 7200, NOW - 3600)]}                           # the cached read is left as it was
    occ = E.room_occupancy(["Kitchen"], got, NOW - E.LOOKBACK_S, {}, None, NOW, 900, MIDNIGHT)
    assert occ["kitchen"]["occupied"] is True
    assert E.with_recent(None, [], NOW) is None and E.with_recent(None, [{"ts": NOW, "o": [{"r": "Den"}]}], NOW - 1) == {"den": [(NOW, NOW)]}


def test_a_room_empty_for_less_than_the_set_time_is_not_empty_yet() -> None:
    trace = {"kitchen": [(NOW - 3600, NOW - 600)]}
    occ = E.room_occupancy(["Kitchen"], trace, NOW - E.LOOKBACK_S, {}, None, NOW, 900, MIDNIGHT)
    assert E.compute(facts(occupancy=occ))["empty"]["rooms"] == []
    assert by(E.compute(facts(occupancy=occ, settings={"energy_empty_after_min": 5}))["rooms"], "room", "Kitchen")["empty"]


def test_without_scanners_the_rooms_own_motion_sensors_say_it_and_a_room_without_them_says_nothing() -> None:
    sensors = {"kitchen": [(False, NOW - 3600)], "office": [(True, NOW - 60)]}
    occ = E.room_occupancy(["Kitchen", "Office", "Bedroom"], None, NOW - E.LOOKBACK_S, sensors, None, NOW, 900, MIDNIGHT)
    assert occ["kitchen"]["since"] == NOW - 3600 and occ["office"]["occupied"] is True and "bedroom" not in occ
    assert occ["kitchen"]["spans"] == [(NOW - 3600 + 900, NOW)]
    got = E.compute(facts(occupancy=occ))
    assert [e["room"] for e in got["empty"]["rooms"]] == ["Kitchen"]


def test_with_everyone_away_every_room_is_empty_since_they_left() -> None:
    occ = E.room_occupancy(["Kitchen", "Bedroom"], None, NOW - E.LOOKBACK_S, {}, NOW - 5400, NOW, 900, MIDNIGHT)
    assert occ["bedroom"]["since"] == NOW - 5400 and occ["bedroom"]["spans"] == [(NOW - 5400 + 900, NOW)]
    assert {e["room"] for e in E.compute(facts(occupancy=occ))["empty"]["rooms"]} == {"Kitchen", "Bedroom"}


def test_the_always_on_list_is_left_out_and_today_s_empty_kwh_is_counted_by_the_hour() -> None:
    occ = {"kitchen": {"occupied": False, "since": NOW - 7200, "empty": 7200.0, "spans": [(NOW - 7200, NOW)]},
           "bedroom": {"occupied": False, "since": NOW - 7200, "empty": 7200.0, "spans": [(NOW - 5400, NOW)]}}
    hourly = {"sensor.heater_energy": [(NOW - 7200, 1.0), (NOW - 3600, 1.0)]}
    got = E.compute(facts(occupancy=occ, hourly=hourly, settings={"energy_always_on": ["sensor.fridge_power"]}))
    assert by(got["devices"], "id", "sensor.fridge_energy")["always_on"] is True
    assert [e["room"] for e in got["empty"]["rooms"]] == ["Bedroom"]                  # the fridge's kitchen: nothing left
    bed = by(got["rooms"], "room", "Bedroom")["empty"]
    assert bed["kwh"] == 1.5 and bed["cost"] == pytest.approx(0.18) and bed["w"] == 1500.0


def test_a_tiny_reading_keeps_a_room_quiet() -> None:
    s = states(**{"sensor.fridge_power": st(0.4, "W")})
    occ = {"kitchen": {"occupied": False, "since": NOW - 7200, "empty": 7200.0, "spans": []}}
    assert E.compute(facts(states=s, occupancy=occ))["empty"]["rooms"] == []
    assert E.compute(facts(states=s))["quiet_w"] == E.QUIET_W


# ── away standby ────────────────────────────────────────────────────────────

def test_standby_is_a_low_percentile_of_the_away_samples_and_waits_for_enough_of_them() -> None:
    few = [[NOW - i * 300, 300.0] for i in range(E.STANDBY_MIN_SAMPLES - 1)]
    assert E.standby_w(few, NOW) is None
    many = [[NOW - i * 300, 200.0 + i] for i in range(200)] + [[NOW - 90 * 86400, 5.0]]   # an old one is not read
    assert E.standby_w(many, NOW) == 202.0                                            # the 1 % bin of 200: the third lowest
    got = E.compute(facts(samples=many))
    assert got["standby"]["w"] == 202.0 and got["standby"]["year_cost"] == pytest.approx(202 / 1000 * 8760 * 0.12, abs=0.01)


def _hass(settings: dict | None = None, st: States | None = None, tb: Any = None) -> SimpleNamespace:
    data = {DATA_SETTINGS: SimpleNamespace(data={**DEFAULT_SETTINGS, **KEY, **(settings or {})}),
            DATA_MODEL: SimpleNamespace(room_geometry_m=lambda: {"Kitchen": {}, "Office": {}, "Bedroom": {}})}
    if tb is not None:
        data[DATA_TRACEBACK] = tb
    return SimpleNamespace(data={DOMAIN: data}, states=st if st is not None else states(),
                           config=SimpleNamespace(currency="CAD", time_zone="UTC"))


class Samples(E.Samples):
    def __init__(self) -> None:   # noqa: D107 - no Store
        self.samples, self.loaded, self.saved = [], True, 0

    async def async_load(self) -> None:
        return None

    def add(self, ts: float, w: float) -> None:
        self.samples.append([ts, w])
        self.saved += 1


@pytest.fixture
def fake_ha(monkeypatch):
    calls = {"prefs": 0, "stats": []}

    async def prefs(_hass):
        calls["prefs"] += 1
        return PREFS

    async def stats(_hass, ids, start, end, period, types):
        calls["stats"].append((period, sorted(ids), sorted(types)))
        if period == "hour":
            return {sid: [{"start": MIDNIGHT + 3600, "change": KWH.get(sid, 0)}] for sid in ids}
        if period == "5minute" and "mean" in types:
            return {sid: [{"start": MIDNIGHT, "mean": 100.0}] for sid in ids}
        return {}
    monkeypatch.setattr(E, "_async_prefs", prefs)
    monkeypatch.setattr(E, "_async_stats", stats)
    monkeypatch.setattr(E, "_area_of", lambda hass, eids: {e: AREAS.get(e, (None, None)) for e in eids})
    return calls


async def test_away_standby_samples_only_while_everyone_is_out_or_on_vacation(fake_ha) -> None:
    people = {"person.a": st("not_home", age=4000), "person.b": st("work", age=3000)}
    h = _hass({"energy_enabled": True}, states(**people))
    h.data[DOMAIN]["_energy"] = {"samples": Samples(), "counts": {"at": NOW}}
    await E.async_tick(h, NOW)
    assert h.data[DOMAIN]["_energy"]["samples"].samples == [[NOW, 2000.0]]
    assert E.away_since(h, NOW) == NOW - 3000                                          # the last to leave
    # Someone home, or PadSpan seeing a person's own phone at home: no sample.
    home = _hass({"energy_enabled": True}, states(**{**people, "person.b": st("home")}))
    home.data[DOMAIN]["_energy"] = {"samples": Samples(), "counts": {"at": NOW}}
    await E.async_tick(home, NOW)
    phone = {"k1": {"key": "k1", "user_label": "Person B phone", "room": "Kitchen", "away": False}}
    seen = _hass({"energy_enabled": True, "atlas_3d_carries": {"person.b": ["k1"]}}, states(**people))
    seen.data[DOMAIN]["presence_coordinator"] = SimpleNamespace(data=phone)
    seen.data[DOMAIN]["_energy"] = {"samples": Samples(), "counts": {"at": NOW}}
    await E.async_tick(seen, NOW)
    assert home.data[DOMAIN]["_energy"]["samples"].samples == [] == seen.data[DOMAIN]["_energy"]["samples"].samples
    # A tag on keys left at home writes Traceback frames all day, and nobody carries it: still everyone out.
    keys = {"k2": {"key": "k2", "user_label": "Keys tag", "room": "Hall", "away": False}}
    left = _hass({"energy_enabled": True}, states(**people), tb=SimpleNamespace(frames=[{"ts": NOW - 10, "o": [{"k": "k2", "n": "Keys tag", "r": "Hall"}]}]))
    left.data[DOMAIN]["presence_coordinator"] = SimpleNamespace(data=keys)
    left.data[DOMAIN]["_energy"] = {"samples": Samples(), "counts": {"at": NOW}}
    await E.async_tick(left, NOW)
    assert left.data[DOMAIN]["_energy"]["samples"].samples == [[NOW, 2000.0]]
    # Vacation Mode on: sampled though someone shows home.
    vac = _hass({"energy_enabled": True, "vacation_mode_enabled": True}, states(**{**people, "person.b": st("home")}))
    vac.data[DOMAIN]["_energy"] = {"samples": Samples(), "counts": {"at": NOW}}
    await E.async_tick(vac, NOW)
    assert vac.data[DOMAIN]["_energy"]["samples"].samples == [[NOW, 2000.0]]
    # Off: nothing at all.
    off = _hass({}, states(**people))
    off.data[DOMAIN]["_energy"] = {"samples": Samples()}
    fake_ha["prefs"] = 0
    await E.async_tick(off, NOW)
    assert off.data[DOMAIN]["_energy"]["samples"].samples == [] and fake_ha["prefs"] == 0


def test_the_samples_store_is_bounded_and_forgets_old_ones(monkeypatch) -> None:
    s = E.Samples.__new__(E.Samples)
    s.store = SimpleNamespace(async_delay_save=lambda fn, delay: fn())
    s.samples, s.loaded = [[NOW - 30 * 86400, 1.0]], True
    for i in range(E.SAMPLES_MAX + 50):
        s.add(NOW + i * 300, 100.0)
    assert len(s.samples) == E.SAMPLES_MAX and s.samples[0][0] >= NOW and s.samples[-1][0] == round(NOW + (E.SAMPLES_MAX + 49) * 300)


# ── off by default, and the add-on's gate ───────────────────────────────────

def test_the_settings_start_off() -> None:
    assert DEFAULT_SETTINGS["energy_enabled"] is False and DEFAULT_SETTINGS["atlas_energy_enabled"] is False
    assert DEFAULT_SETTINGS["energy_spikes_enabled"] is False and DEFAULT_SETTINGS["energy_always_on"] == []
    assert DEFAULT_SETTINGS["energy_empty_after_min"] == 15


async def test_off_or_not_allowed_nothing_is_read(fake_ha) -> None:
    assert await E.async_summary(_hass(), NOW) == {"on": False, "allowed": True}
    audio_key = {**KEY, "license_addons": ["audio"], "license_addons_until": {"audio": LATER}}
    assert await E.async_summary(_hass({"energy_enabled": True, **audio_key}), NOW) == {"on": False, "allowed": False}
    assert fake_ha["prefs"] == 0 and fake_ha["stats"] == []
    pro = {"forensics_license_key": "PSPAN-PROK-0000-0000-0001", "license_tier": "pro", "license_addons": [], "license_addons_until": {}}
    assert (await E.async_summary(_hass({"energy_enabled": True, **pro}), NOW))["on"] is True


async def test_the_summary_from_a_running_home_assistant(fake_ha) -> None:
    tb = SimpleNamespace(frames=[], async_day_summary=None)

    async def day(start, end, guests=None):
        return {"frames": 50, "occupied": {"Office": [(NOW - 600, NOW - 20)]}}
    tb.async_day_summary = day
    sensors = {"binary_sensor.kitchen_motion": st("off", age=7200, device_class="motion")}
    E_area = E._area_of
    E._area_of = lambda hass, eids: {**E_area(hass, eids), **({"binary_sensor.kitchen_motion": ("Kitchen", None)}
                                                              if "binary_sensor.kitchen_motion" in eids else {})}
    h = _hass({"energy_enabled": True}, states(**sensors), tb=tb)
    h.data[DOMAIN]["presence_coordinator"] = SimpleNamespace(data={}, _last_source_to_area={"scanner_a": "Bedroom"})
    h.data[DOMAIN]["_energy"] = {"samples": Samples()}
    got = await E.async_summary(h, NOW)
    assert got["on"] is True and got["currency"] == "CAD" and got["empty"]["source"] == "padspan"
    assert by(got["devices"], "id", "sensor.fridge_energy")["kwh"] == 1.2
    assert ("hour", sorted(d["id"] for d in E.devices_of(PREFS)), ["change"]) in fake_ha["stats"]
    # The office has someone; the Bedroom has a receiver and nobody in it all day; the Kitchen's motion sensor has been
    # off two hours; the Den (the PC's area, no receiver, no sensor) is never said to be empty.
    assert {e["room"] for e in got["empty"]["rooms"]} == {"Kitchen", "Bedroom"}
    assert h.data[DOMAIN]["_energy"]["counts"]["devices"] == 5
    # Read again within STATS_EVERY_S: the recorder is not asked again.
    n = len(fake_ha["stats"])
    await E.async_summary(h, NOW + 60)
    assert len(fake_ha["stats"]) == n


async def test_energy_get_answers_any_logged_in_user(fake_ha) -> None:
    sent = {}
    conn = SimpleNamespace(user=SimpleNamespace(is_admin=False), send_result=lambda i, r: sent.update(r=r),
                           send_error=lambda i, c, m: sent.update(e=(c, m)))
    h = _hass({"energy_enabled": True})
    h.data[DOMAIN]["_energy"] = {"samples": Samples()}
    await E.ws_energy_get(h, conn, {"id": 1, "type": "padspan_ha/energy_get"})
    assert sent["r"]["on"] is True and "e" not in sent
    assert E.ws_energy_get.ws_schema == {"type": "padspan_ha/energy_get"}


# ── the spikes ──────────────────────────────────────────────────────────────

def test_a_spike_is_well_above_the_hour_before_and_above_a_floor() -> None:
    base = [(MIDNIGHT + i * 300, 400.0) for i in range(24)]
    spike = [(MIDNIGHT + 24 * 300, 3200.0), (MIDNIGHT + 25 * 300, 3600.0), (MIDNIGHT + 26 * 300, 500.0)]
    small = [(MIDNIGHT + (27 + i) * 300, 400.0) for i in range(12)] + [(MIDNIGHT + 39 * 300, 1300.0)]
    got = E.find_spikes(base + spike + small)
    assert got == [{"ts": MIDNIGHT + 25 * 300, "w": 3600, "baseline": 400}]
    assert E.find_spikes([(MIDNIGHT, 5000.0)]) == []                                  # no hour before it: no baseline


def test_who_was_home_reads_traceback_s_named_devices() -> None:
    frames = [{"ts": 1, "o": [{"k": "a", "n": "Alex phone", "r": "Kitchen"}, {"k": "b", "r": "Office"}]},
              {"ts": 2, "o": [{"k": "a", "n": "Alex phone", "r": "Office"}]}]
    assert E.who_at(frames) == [{"name": "Alex phone", "rooms": ["Kitchen", "Office"]}]
    assert E.traceback_link(10000.0) == "/padspan-ha?view=traceback&from=9400&to=10900"


async def test_the_spikes_are_an_administrator_s_and_only_while_switched_on(fake_ha, monkeypatch) -> None:
    pts = [{"start": MIDNIGHT + i * 300, "mean": 400.0} for i in range(24)] + [{"start": MIDNIGHT + 24 * 300, "mean": 4000.0}]

    async def stats(_hass, ids, start, end, period, types):
        assert period == "5minute" and types == {"mean"}
        return {"sensor.home_power": pts}
    monkeypatch.setattr(E, "_async_stats", stats)

    async def frames(start, end, max_frames=4000):
        return [{"ts": start + 10, "o": [{"k": "a", "n": "Sam watch", "r": "Kitchen"}]}]
    tb = SimpleNamespace(frames=[], async_get_frames=frames)
    out = {}
    user = SimpleNamespace(user=SimpleNamespace(is_admin=False), send_result=lambda i, r: out.update(r=r),
                           send_error=lambda i, c, m: out.update(e=(c, m)))
    h = _hass({"energy_enabled": True, "energy_spikes_enabled": True}, tb=tb)
    await E.ws_energy_spikes(h, user, {"id": 1})
    assert out == {"e": ("unauthorized", "Only an administrator can see who was home at spikes")}
    out.clear()
    admin = SimpleNamespace(user=SimpleNamespace(is_admin=True), send_result=lambda i, r: out.update(r=r),
                            send_error=lambda i, c, m: out.update(e=(c, m)))
    await E.ws_energy_spikes(h, admin, {"id": 2})
    s = out["r"]["spikes"]
    assert out["r"]["enabled"] is True and len(s) == 1 and s[0]["w"] == 4000
    assert s[0]["who"] == [{"name": "Sam watch", "rooms": ["Kitchen"]}] and s[0]["link"].startswith("/padspan-ha?view=traceback&from=")
    out.clear()
    await E.ws_energy_spikes(_hass({"energy_enabled": True}, tb=tb), admin, {"id": 3})
    assert out["r"] == {"enabled": False, "spikes": []}


# ── Yesterday at home ───────────────────────────────────────────────────────

async def test_yesterday_s_kwh_in_empty_rooms(fake_ha, monkeypatch) -> None:
    start, end = MIDNIGHT - 86400, MIDNIGHT

    async def stats(_hass, ids, s, e, period, types):
        return {"sensor.heater_energy": [{"start": start + h * 3600, "change": 0.5} for h in range(24)],
                "sensor.fridge_energy": [{"start": start + h * 3600, "change": 0.1} for h in range(24)]}
    monkeypatch.setattr(E, "_async_stats", stats)
    h = _hass({"energy_enabled": True, "energy_always_on": ["sensor.fridge_energy"], "energy_empty_after_min": 60})
    # The bedroom was occupied until 08:00 and from 20:00: empty 08:00-20:00, counted from 09:00 (its hour).
    got = await E.async_yesterday(h, start, end, {"Bedroom": [(start, start + 8 * 3600), (start + 20 * 3600, end)],
                                                   "Kitchen": []})
    assert got == {"kwh": 5.5, "cost": 0.66, "currency": "CAD"}
    assert E.yesterday_words(got) == "Used in empty rooms: 5.50 kWh (about 0.66 CAD)."
    assert E.yesterday_words({"kwh": 0.0}) is None and await E.async_yesterday(_hass(), start, end, {}) is None
    title, msg, said = PC.yesterday_message("Wed 25 Nov", {"people": []}, ["Bedroom"], [], [], start, end, str, "/x",
                                            True, E.yesterday_words(got))
    assert "Used in empty rooms: 5.50 kWh" in msg and said == ["energy"]
    assert "yesterday_home:line_energy" in T.YESTERDAY_HOME_EVENTS


# ── the usage report ────────────────────────────────────────────────────────

def test_the_report_has_counts_only_and_only_while_on() -> None:
    h = _hass({"energy_enabled": True})
    h.data[DOMAIN]["_energy"] = {"counts": {"rooms": 4, "devices": 140, "issues": 2, "house": True}}
    got = E.report(h, h.data[DOMAIN][DATA_SETTINGS].data)
    assert got == {"on": True, "rooms": 4, "devices": 99, "issues": 2, "house": True, "spikes": False}
    assert E.report_ok(got) and not E.report_ok({**got, "w": 120}) and not E.report_ok({**got, "rooms": 1.5})
    assert E.report(_hass(), DEFAULT_SETTINGS) is None
    T._check_load_sections({"env": {"energy": got}})
    with pytest.raises(ValueError):
        T._check_load_sections({"env": {"energy": {**got, "kwh": 3}}})
    assert T.ENERGY_EVENTS == {f"energy:{w}" for w in ("on", "view", "sheet", "always_on", "spikes")}
    assert all(T.event_allowed(e) for e in T.ENERGY_EVENTS) and not T.event_allowed("energy:120")
    assert "energy" in T.VIEWS and "energy" in T.HOUSE3D_SHOW_ITEMS and "energy_map" in T.UI_ERROR_HELPERS


def test_used_says_energy_where_it_was_used() -> None:
    from custom_components.padspan_ha import addon_report as A
    pro = {"forensics_license_key": "K", "license_tier": "pro"}
    assert "energy" in A.used_words(pro, {"energy:view": 1}, True)
    assert "energy" not in A.used_words(pro, {"energy:on": 1}, True)
    audio = KEY | {"license_addons": ["audio"], "license_addons_until": {"audio": LATER}}
    assert "energy" not in A.used_words(audio, {"energy:view": 1}, True)


# ── the settings ────────────────────────────────────────────────────────────

def test_the_settings_are_validated_cleaned_and_the_lists_an_administrator_s() -> None:
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"energy_enabled", "atlas_energy_enabled", "energy_empty_after_min", "energy_always_on", "energy_spikes_enabled"} <= keys
    assert E.clean_always_on(["sensor.a", " SENSOR.B ", "x", 3, "sensor.a", "a.b.c", "sensor.$"]) == ["sensor.a", "sensor.b"]
    assert E.clean_always_on("sensor.a") == [] and len(E.clean_always_on([f"sensor.s{i}" for i in range(500)])) == E.ALWAYS_ON_MAX
    assert E.empty_after_s({"energy_empty_after_min": 30}) == 1800 and E.empty_after_s({"energy_empty_after_min": 0}) == 900
    assert E.empty_after_s({"energy_empty_after_min": True}) == 900


def test_the_energy_integration_s_manager_is_read_and_none_without_it(monkeypatch) -> None:
    import asyncio
    mod = types.ModuleType("homeassistant.components.energy.data")

    async def manager(hass):
        return SimpleNamespace(data=PREFS)
    mod.async_get_manager = manager
    monkeypatch.setitem(sys.modules, "homeassistant.components.energy", types.ModuleType("homeassistant.components.energy"))
    monkeypatch.setitem(sys.modules, "homeassistant.components.energy.data", mod)
    assert asyncio.run(E._async_prefs(SimpleNamespace())) is PREFS
    mod.async_get_manager = None
    assert asyncio.run(E._async_prefs(SimpleNamespace())) is None


def test_the_recorder_is_asked_in_kwh_and_w(monkeypatch) -> None:
    import asyncio
    seen = {}
    mod = types.ModuleType("homeassistant.components.recorder.statistics")

    def during(hass, start, end, ids, period, units, types_):
        seen.update(ids=ids, period=period, units=units, types=types_)
        return {"sensor.a": [{"start": 1.0, "change": 0.5}]}
    mod.statistics_during_period = during
    monkeypatch.setitem(sys.modules, "homeassistant.components.recorder.statistics", mod)
    got = asyncio.run(E._async_stats(SimpleNamespace(), {"sensor.a"}, datetime.now(timezone.utc), datetime.now(timezone.utc),
                                     "hour", {"change"}))
    assert got == {"sensor.a": [{"start": 1.0, "change": 0.5}]}
    assert seen == {"ids": {"sensor.a"}, "period": "hour", "units": {"energy": "kWh", "power": "W"}, "types": {"change"}}
    assert asyncio.run(E._async_stats(SimpleNamespace(), set(), None, None, "hour", {"change"})) == {}


# ── the review's fixes (2026-11-26) ─────────────────────────────────────────

def test_a_room_padspan_cannot_see_into_is_never_empty_by_traceback_alone() -> None:
    """A garage with a freezer, no receiver and nobody ever seen in it: not "Empty for 1 d"; its own motion sensor, or
    everyone away, can still say it."""
    trace = {"kitchen": [(NOW - 3600, NOW - 1800)]}
    occ = E.room_occupancy(["Kitchen", "Garage", "Office"], trace, NOW - E.LOOKBACK_S, {}, None, NOW, 900, MIDNIGHT,
                           receivers=["Kitchen", "Office"])
    assert "garage" not in occ and occ["office"]["since"] == NOW - E.LOOKBACK_S and occ["kitchen"]["since"] == NOW - 1800
    by_sensor = E.room_occupancy(["Garage"], trace, NOW - E.LOOKBACK_S, {"garage": [(False, NOW - 5000)]}, None, NOW, 900,
                                 MIDNIGHT, receivers=["Kitchen"])
    assert by_sensor["garage"]["since"] == NOW - 5000
    away = E.room_occupancy(["Garage"], trace, NOW - E.LOOKBACK_S, {}, NOW - 4000, NOW, 900, MIDNIGHT, receivers=[])
    assert away["garage"]["since"] == NOW - 4000


def test_the_battery_is_in_the_house_and_a_stale_part_leaves_no_figure() -> None:
    prefs = {"energy_sources": [{"type": "grid", "stat_rate": "sensor.grid_power"}, {"type": "solar", "stat_rate": "sensor.solar_power"},
                                {"type": "battery", "stat_rate": "sensor.batt_power"}]}
    night = states(**{"sensor.grid_power": st(20, "W"), "sensor.solar_power": st(0, "W"), "sensor.batt_power": st(800, "W")})
    assert E.house_w(prefs, night, NOW) == 820.0
    got = E.compute(facts(prefs={**prefs, "device_consumption": []}, states=night))
    assert got["house"]["w"] == 820.0 and got["house"]["source"] == "grid"
    stale_solar = states(**{"sensor.grid_power": st(300, "W"), "sensor.solar_power": st(2, "kW", age=E.STALE_S + 5),
                            "sensor.batt_power": st(0, "W")})
    got = E.compute(facts(prefs={**prefs, "device_consumption": []}, states=stale_solar))
    assert got["house"]["w"] is None and got["house"]["stale"] is True and got["house"]["rest_w"] is None
    assert ("stale", "sensor.solar_power") in {(i["kind"], i["entity"]) for i in got["issues"]}
    assert E.house_w(prefs, stale_solar, NOW) is None
    two = {"energy_sources": [{"type": "grid", "stat_rate": "sensor.g1"}, {"type": "grid", "stat_rate": "sensor.g2"}]}
    assert E.house_w(two, states(**{"sensor.g1": st(500, "W"), "sensor.g2": st(400, "W", age=E.STALE_S + 5)}), NOW) is None
    assert E.house_w(two, states(**{"sensor.g1": st(500, "W"), "sensor.g2": st(400, "W")}), NOW) == 900.0


async def test_a_stale_part_takes_no_standby_sample(fake_ha, monkeypatch) -> None:
    prefs = {"energy_sources": [{"type": "grid", "stat_rate": "sensor.grid_power"}, {"type": "solar", "stat_rate": "sensor.solar_power"}]}

    async def p(_hass):
        return prefs
    monkeypatch.setattr(E, "_async_prefs", p)
    people = {"person.a": st("not_home", age=4000), "sensor.solar_power": st(0, "W", age=E.STALE_S + 5)}
    h = _hass({"energy_enabled": True}, states(**people))
    h.data[DOMAIN]["_energy"] = {"samples": Samples(), "counts": {"at": NOW}}
    await E.async_tick(h, NOW)
    assert h.data[DOMAIN]["_energy"]["samples"].samples == []


async def test_the_mismatch_compares_the_same_hours_and_a_half_hour_zone_keeps_its_first_half_hour(monkeypatch) -> None:
    """The hourly change ends at the last full hour, so the 5-minute means are summed only up to there; and where local
    midnight is on the half hour, the half hour before the first full hour comes from the 5-minute rows."""
    asked = []
    half = MIDNIGHT - 1800                                                     # a +0:30 zone's midnight

    async def stats(_hass, ids, start, end, period, types):
        asked.append((period, sorted(types), start.timestamp(), end.timestamp()))
        if period == "hour":
            return {"sensor.fridge_energy": [{"start": MIDNIGHT + h * 3600, "change": 0.1} for h in range(13)]}
        if period == "5minute" and types == {"change"}:
            return {"sensor.fridge_energy": [{"start": half + i * 300, "change": 0.01} for i in range(6)]}
        # 100 W all day, to now: the part after 13:00 (the last hourly row's end) is left out.
        return {"sensor.fridge_power": [{"start": half + i * 300, "mean": 100.0} for i in range(int((NOW - half) // 300))]}
    monkeypatch.setattr(E, "_async_stats", stats)
    h = _hass({"energy_enabled": True})
    devs = [{"id": "sensor.fridge_energy", "rate": "sensor.fridge_power", "name": None, "parent": None, "loop": False}]
    got = await E._async_today(h, devs, NOW, half)
    assert ("hour", ["change"], MIDNIGHT, NOW + 3600) in asked and ("5minute", ["change"], half, MIDNIGHT) in asked
    assert got["hourly"]["sensor.fridge_energy"][0] == (half, pytest.approx(0.06), 1800.0)
    assert got["kwh"]["sensor.fridge_energy"] == pytest.approx(1.36)
    assert got["power_kwh"]["sensor.fridge_power"] == pytest.approx(0.1 * 13.5)        # 00:00 (local) to 13:00 UTC
    assert E.kwh_in_spans([(half, 0.06, 1800.0)], [(half, half + 900)]) == pytest.approx(0.03)


async def test_two_reads_at_once_ask_the_recorder_once(monkeypatch) -> None:
    import asyncio
    n = {"calls": 0}

    async def stats(_hass, ids, start, end, period, types):
        n["calls"] += period == "hour"
        await asyncio.sleep(0)
        return {}
    monkeypatch.setattr(E, "_async_stats", stats)
    h = _hass({"energy_enabled": True})
    devs = [{"id": "sensor.a", "rate": None, "name": None, "parent": None, "loop": False}]
    a, b = await asyncio.gather(E._async_today(h, devs, NOW, MIDNIGHT), E._async_today(h, devs, NOW, MIDNIGHT))
    assert a is b and n["calls"] == 1


async def test_traceback_is_read_from_a_cursor_and_not_at_all_without_energy_set_up(fake_ha, monkeypatch) -> None:
    reads = []

    async def day(start, end, guests=None):
        reads.append((start, end))
        return {"frames": 3, "occupied": {"Office": [(end - 60, end - 30)]}}
    tb = SimpleNamespace(frames=[], async_day_summary=day)
    h = _hass({"energy_enabled": True}, tb=tb)
    first, _ = await E._async_trace(h, NOW)
    await E._async_trace(h, NOW + 60)                                          # within OCCUPANCY_EVERY_S: not read
    again, _ = await E._async_trace(h, NOW + E.OCCUPANCY_EVERY_S)
    assert reads == [(NOW - E.LOOKBACK_S, NOW), (NOW, NOW + E.OCCUPANCY_EVERY_S)]   # the second from where the first ended
    assert again["office"] == [(NOW - 60, NOW - 30), (NOW + E.OCCUPANCY_EVERY_S - 60, NOW + E.OCCUPANCY_EVERY_S - 30)]
    later, _ = await E._async_trace(h, NOW + E.LOOKBACK_S + 2 * E.OCCUPANCY_EVERY_S)
    assert all(e >= NOW + E.OCCUPANCY_EVERY_S for _s, e in later["office"])    # older than a day: dropped

    async def none(_hass):
        return None
    monkeypatch.setattr(E, "_async_prefs", none)
    reads.clear()
    fresh = _hass({"energy_enabled": True}, tb=tb)
    got = await E.async_summary(fresh, NOW)
    assert got["set_up"] is False and reads == [] and fake_ha["stats"] == []


async def test_the_spikes_read_traceback_once(fake_ha, monkeypatch) -> None:
    pts = [{"start": MIDNIGHT + i * 300, "mean": 400.0} for i in range(60)]
    for i in (20, 45):
        pts[i] = {"start": MIDNIGHT + i * 300, "mean": 4000.0}

    async def stats(_hass, ids, start, end, period, types):
        return {"sensor.home_power": pts}
    monkeypatch.setattr(E, "_async_stats", stats)
    calls = []

    async def frames(start, end, max_frames=4000):
        calls.append((start, end, max_frames))
        return [{"ts": MIDNIGHT + 20 * 300 + 10, "o": [{"n": "Sam", "r": "Kitchen"}]},
                {"ts": MIDNIGHT + 45 * 300 + 10, "o": [{"n": "Alex", "r": "Office"}]}]
    h = _hass({"energy_enabled": True, "energy_spikes_enabled": True}, tb=SimpleNamespace(frames=[], async_get_frames=frames))
    got = await E.async_spikes(h, NOW)
    assert len(calls) == 1 and calls[0] == (MIDNIGHT + 20 * 300, MIDNIGHT + 45 * 300 + 300, E.SPIKE_FRAMES)
    assert [s["who"] for s in got["spikes"]] == [[{"name": "Alex", "rooms": ["Office"]}], [{"name": "Sam", "rooms": ["Kitchen"]}]]


def test_an_idle_plug_that_reports_its_same_value_stays_fresh() -> None:
    """A plug that only writes on change: Home Assistant's last_reported (2024.3 on) moves with every report even when
    the value doesn't, and that is what the age is read from; last_updated only without it."""
    idle = SimpleNamespace(state="0.3", attributes={"unit_of_measurement": "W"},
                           last_updated=datetime.fromtimestamp(NOW - 5 * 3600, timezone.utc),
                           last_reported=datetime.fromtimestamp(NOW - 60, timezone.utc))
    assert E.reading(idle, NOW)["stale"] is False
    old = SimpleNamespace(state="0.3", attributes={"unit_of_measurement": "W"},
                          last_updated=datetime.fromtimestamp(NOW - 5 * 3600, timezone.utc))
    assert E.reading(old, NOW)["stale"] is True


def test_every_unit_home_assistant_converts_is_read() -> None:
    assert E.reading(st(250, "mW"), NOW)["w"] == 0.25 and E.reading(st(0.002, "MW"), NOW)["w"] == 2000.0
    for unit in ("MWh", "GJ", "kWh", "Wh", "MJ"):
        got = E.compute(facts(states=states(**{"sensor.heater_energy": st(7, unit)})))
        assert not [i for i in got["issues"] if i["kind"] == "unit"], unit
    assert [i for i in E.compute(facts(states=states(**{"sensor.heater_energy": st(7, "m³")})))["issues"] if i["kind"] == "unit"]


def test_an_included_in_stat_loop_is_left_out_and_said() -> None:
    prefs = {"device_consumption": [{"stat_consumption": "sensor.a", "stat_rate": "sensor.a_w", "included_in_stat": "sensor.b"},
                                    {"stat_consumption": "sensor.b", "stat_rate": "sensor.b_w", "included_in_stat": "sensor.a"},
                                    {"stat_consumption": "sensor.c", "included_in_stat": "sensor.a"}]}
    devs = {d["id"]: d for d in E.devices_of(prefs)}
    assert devs["sensor.a"]["parent"] is None and devs["sensor.b"]["parent"] is None and devs["sensor.a"]["loop"] is True
    assert devs["sensor.c"]["parent"] == "sensor.a" and devs["sensor.c"]["loop"] is False
    s = states(**{"sensor.a_w": st(100, "W"), "sensor.b_w": st(60, "W"), "sensor.a": st(1, "kWh"), "sensor.b": st(1, "kWh"), "sensor.c": st(1, "kWh")})
    got = E.compute(facts(prefs=prefs, states=s, areas={}))
    d = {r["id"]: r for r in got["devices"]}
    assert d["sensor.a"]["own_w"] == 100.0 and d["sensor.b"]["own_w"] == 60.0               # not collapsed to 40
    assert {("loop", "sensor.a"), ("loop", "sensor.b")} <= {(i["kind"], i["entity"]) for i in got["issues"]}


def test_turning_energy_on_is_an_administrator_s() -> None:
    import asyncio
    sent = {}
    st_ = SimpleNamespace(data=dict(DEFAULT_SETTINGS), async_set=None)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st_}})
    conn = SimpleNamespace(user=SimpleNamespace(is_admin=False), send_error=lambda i, c, m: sent.update(e=(c, m)),
                           send_result=lambda i, r: sent.update(r=r))
    asyncio.run(WS.ws_settings_set(hass, conn, {"id": 1, "type": "padspan_ha/settings_set", "energy_enabled": True}))
    assert sent.get("e") == ("unauthorized", "Only an administrator can turn Energy on or off") and st_.data["energy_enabled"] is False
