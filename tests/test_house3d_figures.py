# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P6: people figures and beacon and scanner looks in the 3D file
(house3d_store figures / devices, saved by ws_house3d.house3d_edit).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("Beacons, scanners and people from
photos", "Data"). Held here:
- a figure is keyed by its person (person.<name>), holds FIGURE's settings
  only (numbers clamped, choices and colours checked) and how it was made
  (photo or build); at most 50; removing it removes all of it;
- a device entry keeps the 3D editor's height ({z_m}, by entity id) working
  and can also carry a look ({recipe, library_id, submission_id}) keyed by
  the id PadSpan tracks the beacon or scanner by; each is removed without
  touching the other;
- people are never shared: no figure data in the usage report, and nothing
  but the 3D file itself reads the figures section.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import house3d_builders as B
from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_HOUSE3D, DOMAIN
from tests.test_house3d_edit import _edit, _file, _on, _seed, disk  # noqa: F401  (disk is a fixture)
from tests.test_telemetry import _hass

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"


def _figure(**params):
    fig = B.data()["figure"]
    base = {p["key"]: p["def"] for p in fig["params"]}
    base["colors"] = dict(fig["colors"])
    return {"params": {**base, **params}, "origin": "build"}


def _p(kind: str) -> dict:
    """The first FIGURE setting of a type."""
    return next(p for p in B.data()["figure"]["params"] if p["type"] == kind)


_LOOK = {"recipe": {"kind": "tag", "params": {"form": "puck"}, "colors": ["#ffffff"],
                    "width_m": 0.04, "depth_m": 0.04, "height_m": 0.008},
         "library_id": None, "submission_id": None}
_BEACON = "ble:AA:BB:CC:DD:EE:FF"
_SCANNER = "E8:9F:6D:00:11:22"


def _stored(tmp_path: Path) -> dict:
    return json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]


# ═══ figures ══════════════════════════════════════════════════════════════════

def test_a_figure_is_saved_with_its_settings_checked(disk, tmp_path):
    h, conn = _on(tmp_path)
    num = _p("num")
    fig = _figure(**{num["key"]: num["max"] + 5})
    fig["params"]["colors"] = {n: "#ABCDEF" for n in fig["params"]["colors"]}
    out = _edit(h, conn, figures={"person.garry": fig})
    saved = out["data"]["figures"]["person.garry"]
    assert saved["origin"] == "build"
    assert saved["params"][num["key"]] == num["max"], "numbers clamped"
    assert set(saved["params"]["colors"].values()) == {"#abcdef"}
    assert saved["params"] == B.clamp_figure(saved["params"]), "what the builders draw"
    assert _stored(tmp_path)["figures"] == out["data"]["figures"]


def test_a_setting_left_out_is_its_default(disk, tmp_path):
    h, conn = _on(tmp_path)
    out = _edit(h, conn, figures={"person.nicole": {"params": {}, "origin": "photo"}})
    assert out["data"]["figures"]["person.nicole"]["params"] == B.clamp_figure({})


_BAD_FIGURES = {
    "a key that is not a person": {"light.garry": None},
    "a person with no name": {"person.": None},
    "a person in capitals": {"person.Garry": None},
    "an entry that is not an object": {"person.garry": "tall"},
    "no origin": {"person.garry": {"params": {}}},
    "an origin not photo or build": {"person.garry": {"params": {}, "origin": "library"}},
    "an extra key": {"person.garry": {"params": {}, "origin": "build", "shared": True}},
    "params not an object": {"person.garry": {"params": [], "origin": "build"}},
    "a setting FIGURE does not have": {"person.garry": {"params": {"likeness": "exact"}, "origin": "build"}},
    "a colour for a part FIGURE does not have": {"person.garry": {"params": {"colors": {"eyes": "#000000"}},
                                                                  "origin": "build"}},
    "a colour that is not #rrggbb": {"person.garry": {"params": {"colors": {"top": "navy"}}, "origin": "build"}},
}


@pytest.mark.parametrize("why", sorted(_BAD_FIGURES))
def test_a_bad_figure_is_refused_and_nothing_written(disk, tmp_path, why):
    h, conn = _on(tmp_path)
    out = _edit(h, conn, figures=_BAD_FIGURES[why])
    assert out.get("error") == "invalid", why
    assert disk.writes == [] and not _file(tmp_path).exists()


@pytest.mark.parametrize("make", ["choice", "num", "bool"])
def test_wrong_values_for_figure_settings_are_refused(disk, tmp_path, make):
    h, conn = _on(tmp_path)
    p = _p(make)
    bad = {"choice": "not-a-choice", "num": "1.8", "bool": "yes"}[make]
    out = _edit(h, conn, figures={"person.garry": _figure(**{p["key"]: bad})})
    assert out.get("error") == "invalid" and p["key"] in out["message"]
    assert disk.writes == []


def test_at_most_fifty_figures(disk, tmp_path):
    h, conn = _on(tmp_path)
    many = {f"person.p{i}": _figure() for i in range(50)}
    assert len(_edit(h, conn, figures=many)["data"]["figures"]) == 50
    out = _edit(h, conn, figures={"person.one_more": _figure()})
    assert out.get("error") == "invalid" and "50" in out["message"]


def test_removing_a_figure_removes_all_of_it_and_a_change_keeps_a_newer_padspans_keys(disk, tmp_path):
    h, conn = _on(tmp_path)
    _seed(tmp_path, {"schema": 1, "figures": {"person.garry": {**_figure(), "pose": "waving"},
                                              "person.nicole": {**_figure(), "pose": "sitting"}}})
    out = _edit(h, conn, figures={"person.garry": None, "person.nicole": _figure()})
    assert "person.garry" not in out["data"]["figures"], "deleting a figure removes its recipe"
    assert out["data"]["figures"]["person.nicole"]["pose"] == "sitting", "what this version doesn't know stays"


def test_a_figure_whose_person_is_gone_stays_until_removed(disk, tmp_path):
    """Nothing on the server removes a figure on its own: the people screen
    shows one whose person is gone as unlinked, with Remove."""
    h, conn = _on(tmp_path)
    _edit(h, conn, figures={"person.visitor": _figure()})
    h.states.get = lambda eid: None
    out = _edit(h, conn, lights={"light.kitchen": {"z_m": 2.0}})
    assert "person.visitor" in out["data"]["figures"]


# ═══ device looks, beside the 3D editor's heights ═══════════════════════════════

@pytest.mark.parametrize("key", [_BEACON, _SCANNER, "ble:pixel_tag_7", "sensor.hall_motion"])
def test_a_look_is_saved_by_the_id_padspan_tracks_it_by(disk, tmp_path, key):
    h, conn = _on(tmp_path)
    out = _edit(h, conn, devices={key: _LOOK})
    assert out["data"]["devices"][key] == _LOOK


def test_a_height_and_a_look_are_kept_apart(disk, tmp_path):
    h, conn = _on(tmp_path)
    _edit(h, conn, devices={"sensor.hall": {"z_m": 1.5}})
    out = _edit(h, conn, devices={"sensor.hall": _LOOK})
    assert out["data"]["devices"]["sensor.hall"] == {"z_m": 1.5, **_LOOK}, "a look keeps the height"
    out = _edit(h, conn, devices={"sensor.hall": None})
    assert out["data"]["devices"]["sensor.hall"] == _LOOK, "the editor's reset height keeps the look"
    _edit(h, conn, devices={"sensor.hall": {"z_m": 2.0}})
    out = _edit(h, conn, devices={"sensor.hall": {"recipe": None}})
    assert out["data"]["devices"]["sensor.hall"] == {"z_m": 2.0}, "removing the look keeps the height"
    out = _edit(h, conn, devices={_BEACON: _LOOK})
    out = _edit(h, conn, devices={_BEACON: {"recipe": None}})
    assert _BEACON not in out["data"]["devices"], "nothing left: the entry goes"


def test_the_3d_editors_heights_work_as_before(disk, tmp_path):
    h, conn = _on(tmp_path)
    assert _edit(h, conn, devices={"sensor.t": {"z_m": 1.25}})["data"]["devices"] == {"sensor.t": {"z_m": 1.25}}
    for bad in ({"sensor.t": {"z_m": 11}}, {"sensor.t": {"z_m": 1, "colour": "red"}}, {"sensor.t": {}},
                {_BEACON: {"z_m": 1.0}}):
        assert _edit(h, conn, devices=bad).get("error") == "invalid", bad


_BAD_LOOKS = {
    "ids without a recipe": {"sensor.t": {"library_id": "lib_1"}},
    "a removed look with ids": {"sensor.t": {"recipe": None, "submission_id": "sub_1"}},
    "a recipe that is not an object": {"sensor.t": {**_LOOK, "recipe": "puck"}},
    "a kind in capitals": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "kind": "Tag"}}},
    "no colours": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "colors": []}}},
    "a bad colour": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "colors": ["white"]}}},
    "seven colours": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "colors": ["#ffffff"] * 7}}},
    "a size of 0": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "width_m": 0}}},
    "a size over 8 m": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "depth_m": 9}}},
    "a setting that is an object": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "params": {"a": {"b": 1}}}}},
    "a key the recipe doesn't have": {"sensor.t": {**_LOOK, "recipe": {**_LOOK["recipe"], "where": "kitchen"}}},
    "a bad library id": {"sensor.t": {**_LOOK, "library_id": "../../etc"}},
    "a tracked id with a space": {"ble:AA BB": _LOOK},
}


@pytest.mark.parametrize("why", sorted(_BAD_LOOKS))
def test_a_bad_look_is_refused_and_nothing_written(disk, tmp_path, why):
    h, conn = _on(tmp_path)
    assert _edit(h, conn, devices=_BAD_LOOKS[why]).get("error") == "invalid", why
    assert disk.writes == []


# ═══ people are never shared ══════════════════════════════════════════════════

def test_no_figure_data_in_the_usage_report():
    h = _hass()
    h.data[DOMAIN][DATA_HOUSE3D] = SimpleNamespace(data={
        "schema": 1, "pieces": {}, "lights": {}, "openings": {}, "devices": {},
        "figures": {"person.garry": {"params": {"height_m": 1.83, "build": "broad",
                                                "colors": {"hair": "#3a2a1b", "top": "#224467"}},
                                     "origin": "photo"}}})
    payload = json.dumps(T.build_payload(h))
    for leak in ("person.garry", "garry", "#3a2a1b", "#224467", "1.83", "figures"):
        assert leak not in payload, leak


def test_nothing_but_the_3d_file_reads_the_figures():
    """The figures section is read and written by the 3D file's own code only:
    no report, library, backup label or server code reaches into it."""
    allowed = {"house3d_store.py", "ws_house3d.py"}
    readers = sorted(p.name for p in _CC.rglob("*.py")
                     if re.search(r"""["']figures["']""", p.read_text(encoding="utf-8")) and p.name not in allowed)
    assert readers == []
    php = [p.name for p in (_ROOT / "server").rglob("*.php") if "figure" in p.read_text(encoding="utf-8").lower()]
    assert php == [], "no PadSpan server code knows about people figures"
    js_readers = sorted(p.name for p in (_CC / "www").rglob("*.js")
                        if re.search(r"""\.figures\b|["']figures["']|\bfigures\s*:""", p.read_text(encoding="utf-8")))
    # live_aboard_draft.js: the Furnish tab's one draft carries what People & devices
    # returns through to its one Save (house3d_edit), like every other section.
    assert set(js_readers) <= {"live_aboard_people.js", "live_aboard_furnish.js", "live_aboard.js", "live_aboard_draft.js",
                               "live_aboard_house.js", "live_aboard_live.js"}, js_readers
