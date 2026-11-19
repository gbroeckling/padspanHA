# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Is a person home? One rule, everywhere PadSpan asks.

People vanished from the 3D house and from the occupancy count while plainly
in: Live Aboard and Occupancy counted a person only when their state was
exactly "home". A person linked to PadSpan's own device tracker reads the
ROOM (that tracker's state is the room, and PadSpan's guide says to link it
to the person); a person with no tracker of their own reads "unknown" while
PadSpan hears their phone in the hall; a person in a Garden zone inside the
home zone reads "Garden". Vacation Mode's "pause while someone is home" and
the director's "Arrived home" had the same rule and the same hole.

Held here:
- the rule itself, on one table (tests/fixtures/person_home_cases.json), the
  same answers from presence_rules.person_is_home and the panel's
  views/person_home.js (tests/js/person_home.mjs runs that side, with Live
  Aboard's people and the director);
- Occupancy counts each such person, and never one who is away;
- Vacation Mode pauses for them, and not for someone away;
- nothing else in PadSpan compares a person's state to "home" by itself.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import presence_rules as PR
from tests.test_occupancy_people import _estimate, _hass, _obj, _person, _state, _tracker

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
_TABLE = Path(__file__).parent / "fixtures" / "person_home_cases.json"
_NODE = shutil.which("node")


def _table() -> dict:
    return json.loads(_TABLE.read_text(encoding="utf-8"))


def _zone_states(t: dict) -> list[SimpleNamespace]:
    return [SimpleNamespace(entity_id=z["entity_id"], state="0", attributes=z["attributes"]) for z in t["zones"]]


@pytest.fixture(scope="module")
def js() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "person_home.mjs"), str(_WWW), str(_TABLE)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


# ── the rule, on one table ──────────────────────────────────────────────────

def test_the_rule_answers_the_table() -> None:
    t = _table()
    zones = PR.home_zones(_zone_states(t))
    assert zones == t["zones_expected"]
    bad = [c["why"] for c in t["cases"]
           if PR.person_is_home(c["state"], rooms=t["rooms"], zones=zones, placed=c["placed"]) is not c["home"]]
    assert not bad, bad
    # A Home Assistant State, not only its string.
    assert PR.person_is_home(SimpleNamespace(state="Kitchen"), rooms=t["rooms"], zones=zones)


def test_the_panel_gives_the_same_answers(js) -> None:
    t = _table()
    zones = PR.home_zones(_zone_states(t))
    py = [PR.person_is_home(c["state"], rooms=t["rooms"], zones=zones, placed=c["placed"]) for c in t["cases"]]
    assert js["table"]["answers"] == py == [c["home"] for c in t["cases"]]
    assert js["table"]["asObjects"] == py
    assert js["table"]["zones"] == zones


@pytest.mark.parametrize("prefix", ["table:", "tracked:", "director:"])
def test_the_panel_harness_covers_each_part(js, prefix) -> None:
    got = {k: v for k, v in js["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(js['cases'])}"
    bad = [f for f in js["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_panel_case_passes(js) -> None:
    assert not js["failures"], json.dumps(js["failures"][:6], indent=2, ensure_ascii=False)


def test_rooms_padspan_knows_and_devices_it_places() -> None:
    from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
    mdl = SimpleNamespace(room_geometry_m=lambda: {"Living Room": {}}, get_scanner_mappings=lambda: ({"s1": "Kitchen"}, {}))
    pc = SimpleNamespace(data={"ble:a": {"kind": "ble", "room": "Den", "age_s": 3}, "ble:b": {"kind": "ble", "room": "unknown"}},
                         _last_source_to_area={"s2": "Bedroom"})
    hass = SimpleNamespace(data={DOMAIN: {DATA_MODEL: mdl, "presence_coordinator": pc}})
    assert PR.known_rooms(hass) == {"living room", "kitchen", "bedroom", "den"}
    assert PR.known_rooms(SimpleNamespace(data={})) == set(), "nothing set up yet: no rooms, no error"
    here = {"kind": "ble", "room": "Den", "age_s": 3}
    assert PR.placed_in_house(here, 300)
    assert PR.placed_in_house({"kind": "private_ble", "x_m": 1.0, "y_m": 2.0, "age_s": 3}, 300)
    for gone in ({**here, "age_s": 400}, {**here, "_stale": True}, {**here, "away": True}, {**here, "room": "not_home"},
                 {"kind": "entity", "room": "Den"}, {"kind": "ble", "age_s": 3}):
        assert not PR.placed_in_house(gone, 300), gone


# ── Occupancy ───────────────────────────────────────────────────────────────

_SCANNERS = {"s1": ("Kitchen", "main"), "s2": ("Den", "main"), "s3": ("Office", "main")}
_ZONES = [_state(z["entity_id"], "0", **z["attributes"]) for z in _table()["zones"] if z["entity_id"] != "zone.office_home"]


def _house(monkeypatch, persons, trackers=(), objects=None):
    return _hass(monkeypatch, persons=persons, trackers=list(trackers) + _ZONES, objects=objects or {}, scanners=_SCANNERS)


def test_occupancy_counts_a_person_whose_state_is_a_padspan_room(monkeypatch) -> None:
    """Linked to PadSpan's own tracker, as its guide says: the person reads the room."""
    h = _house(monkeypatch, [_person("person.ann", "Ann", "device_tracker.ann_phone", state="Kitchen")],
               [_state("device_tracker.ann_phone", "Kitchen", friendly_name="Ann's phone", source_type="bluetooth_le")],
               {"ble:ann": _obj("ble:ann", "ble", label="Ann's phone", room="Kitchen", linked=["device_tracker.ann_phone"])})
    res = _estimate(h)
    assert res["known"] == 1 and res["evidence"]["persons_home"] == ["Ann"]
    ann = res["people"][0]
    assert ann["room"] == "Kitchen" and not ann["assumed"]


def test_occupancy_counts_unknown_only_while_their_device_is_placed_in_the_house(monkeypatch) -> None:
    bob = _person("person.bob", "Bob", None, state="unknown")
    here = {"ble:bob": _obj("ble:bob", "ble", label="Bob", room="Den")}
    res = _estimate(_house(monkeypatch, [bob], objects=here))
    assert res["evidence"]["persons_home"] == ["Bob"] and res["people"][0]["room"] == "Den"
    # Nothing of his heard: not counted. Heard long ago (away): not counted.
    assert _estimate(_house(monkeypatch, [bob]))["known"] == 0
    gone = {"ble:bob": _obj("ble:bob", "ble", label="Bob", room="Den", age=4000.0)}
    assert _estimate(_house(monkeypatch, [bob], objects=gone))["known"] == 0
    # An HA entity's room (a tracker kept in its area for good) is not PadSpan placing him.
    cara = _person("person.cara", "Cara", "device_tracker.cara", state="unknown")
    ent = {"entity:device_tracker.cara": _obj("entity:device_tracker.cara", "entity", room="Den", age=None,
                                              linked=["device_tracker.cara"])}
    assert _estimate(_house(monkeypatch, [cara], [_tracker("device_tracker.cara", "Cara")], ent))["known"] == 0


def test_occupancy_counts_a_zone_inside_the_home_zone_and_never_one_elsewhere(monkeypatch) -> None:
    people = [_person("person.eve", "Eve", None, state="Garden"),
              _person("person.fay", "Fay", None, state="Office"),       # a zone 5 km away; also a room here
              _person("person.gus", "Gus", None, state="Workshop"),     # crosses the home zone's edge
              _person("person.hal", "Hal", None, state="not_home"),
              _person("person.ida", "Ida", None, state="Home")]         # the home zone, by its name
    res = _estimate(_house(monkeypatch, people))
    assert sorted(res["evidence"]["persons_home"]) == ["Eve", "Ida"]


def test_occupancy_still_counts_home_and_dedupes_a_shared_tracker(monkeypatch) -> None:
    people = [_person("person.remote", "remote", "device_tracker.pixel", state="Kitchen"),
              _person("person.pixel", "pixel", "device_tracker.pixel", state="Kitchen"),
              _person("person.nicole", "Nicole", "device_tracker.iphone")]
    res = _estimate(_house(monkeypatch, people, [_tracker("device_tracker.pixel", "Pixel"), _tracker("device_tracker.iphone", "iPhone")]))
    assert res["known"] == 2


# ── Vacation Mode ───────────────────────────────────────────────────────────

def test_vacation_mode_pauses_for_someone_in_a_padspan_room_and_not_for_someone_away() -> None:
    from custom_components.padspan_ha.const import DATA_MODEL, DOMAIN
    from custom_components.padspan_ha.vacation_mode import someone_home
    persons: list = []
    mdl = SimpleNamespace(room_geometry_m=lambda: {"Kitchen": {}, "Office": {}}, get_scanner_mappings=lambda: ({}, {}))
    pc = SimpleNamespace(data={"ble:bob": {"kind": "ble", "user_label": "Bob", "room": "Kitchen", "age_s": 5}})
    states = {s.entity_id: s for s in _ZONES}
    hass = SimpleNamespace(
        data={DOMAIN: {DATA_MODEL: mdl, "presence_coordinator": pc}},
        states=SimpleNamespace(get=states.get,
                               async_all=lambda domain=None: persons if domain == "person" else
                               [s for s in states.values() if s.entity_id.startswith(f"{domain}.")]))
    persons[:] = [_person("person.ann", "Ann", None, state="Kitchen")]
    assert someone_home(hass), "in the kitchen, by PadSpan's tracker"
    persons[:] = [_person("person.fay", "Fay", None, state="Office")]
    assert not someone_home(hass), "at the Office zone, not in the office at home"
    persons[:] = [_person("person.bob", "Bob", None, state="unknown")]
    assert someone_home(hass), "no tracker of his own; his tag is in the kitchen"
    pc.data["ble:bob"]["age_s"] = 4000
    assert not someone_home(hass), "his tag long gone"
    persons[:] = [_person("person.eve", "Eve", None, state="Garden")]
    assert someone_home(hass)


# ── one rule, no copies ─────────────────────────────────────────────────────

_COPY = re.compile(r"""(\.state\s*(===?|!==?|==|!=)\s*["']home["'])|(String\(\s*\w+\.state\s*\)\s*(===?|!==?)\s*["']home["'])"""
                   r"""|(state\s+(==|!=)\s+["']home["'])""")


def test_nothing_else_compares_a_persons_state_to_home() -> None:
    """The rule lives in presence_rules.py and views/person_home.js; a person's
    state compared to "home" anywhere else is a copy of it that will drift."""
    found = []
    for p in list(_PKG.rglob("*.py")) + [q for q in _WWW.rglob("*.js") if "vendor" not in q.parts]:
        if p.name in ("presence_rules.py", "person_home.js"):
            continue
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("//")[0] if p.suffix == ".js" else line.split("#")[0]
            if _COPY.search(code):
                found.append(f"{p.relative_to(_PKG)}:{n}: {line.strip()}")
    assert not found, found


def test_every_place_that_asks_uses_the_rule() -> None:
    occ = (_PKG / "ws_occupancy.py").read_text(encoding="utf-8")
    assert "if not person_home(hass, st, ctx):" in occ and "_known_people(hass, objects)" in occ
    vac = (_PKG / "vacation_mode.py").read_text(encoding="utf-8")
    assert "person_home(hass, s, ctx)" in vac
    tr = (_WWW / "views" / "live_aboard_tracked.js").read_text(encoding="utf-8")
    assert "personIsHome(st.state, { ...home, placed: P.at.beacon && !P.at.away })" in tr
    di = (_WWW / "views" / "live_aboard_director.js").read_text(encoding="utf-8")
    assert "!home(stWas) && home(st)" in di
    la = (_WWW / "views" / "live_aboard.js").read_text(encoding="utf-8")
    assert "isHome: PERSON_HOME ? (st) => PERSON_HOME.personIsHome(st, {" in la
