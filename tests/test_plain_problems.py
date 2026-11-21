# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Health's "Problems found" in words a house owner understands (2026-11-21).

The checks read like an engineer's log: "LOO mean error: 1.85 m", "Average
RSSI variance 31.0 dBm²", "Scanner disagrees with consensus", "bidirectional
transitions", the "fabric" in every map critic. And a brand-new house, with
nobody calibrated yet, was told it had a CRITICAL "No calibration data" while
its rooms already came from the nearest receiver.

Every check is still there. What changed is the words and one severity rule:
the title says what the person would notice, the message why, the action
what to do; the measurements and terms moved to `detail`, kept, not removed.
What a house still being set up simply hasn't done yet is its next step
("info"), never a critical problem. And each problem that has a screen where
it is fixed names it (`go`), for Health's "Go there" button.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth, snapshot_builder
from custom_components.padspan_ha.const import (
    DATA_ADAPTIVE, DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN,
)
from custom_components.padspan_ha.ws_diagnostics import ws_system_critics
from tests.conftest import maps_store_with

ROOT = Path(__file__).resolve().parents[1]

# Words for engineers: never in a title, message or action, only in detail.
JARGON = re.compile(r"\bLOO\b|leave-one-out|\bRSSI\b|variance|dBm|fabric|consensus|propagation|"
                    r"bidirectional|fingerprint|\bpolls?\b|reliability|\bHA area\b|oscillat", re.I)
GO_TARGETS = {"measure": {"map_id"}, "calibrate": set(), "layout": {"floor_id"},
              "receivers": {"source"}, "adaptive_learning": set()}


def _maps():
    return [
        {"id": "ground", "name": "Ground", "floor_id": "main", "room_bounds": {"Kitchen": {}}},
        {"id": "attic", "name": "Attic", "floor_id": "upper"},
    ]


def _hass(*, points, maps, adaptive=None, pc=None):
    calib = MagicMock()
    calib.data = {"points": points}
    calib.async_prepare_model = AsyncMock()
    calib.compute_model.return_value = {"coverage_by_map": {
        "ground": {"loo_accuracy": {"mean_error_m": 3.0, "max_error_m": 5.5}, "point_count": 9},
        "attic": {"loo_accuracy": None, "point_count": 2},
    }}
    mdl = MagicMock()
    mdl.data = {"floors": [{"id": "main", "name": "Main Floor"}, {"id": "upper", "name": "Upper Floor"}]}
    mdl.room_geometry_m.return_value = {}
    dom = {DATA_CALIBRATION: calib, DATA_MODEL: mdl, DATA_MAPS: maps_store_with(maps),
           DATA_FABRIC: MagicMock(), DATA_SETTINGS: SimpleNamespace(data={})}
    if adaptive is not None:
        dom[DATA_ADAPTIVE] = adaptive
    if pc is not None:
        dom["presence_coordinator"] = pc
    hass = MagicMock()
    hass.data = {DOMAIN: dom}
    return hass


async def _critics(hass) -> dict:
    conn = MagicMock()
    await ws_system_critics(hass, conn, {"id": 1})
    return conn.send_result.call_args[0][1]


@pytest.fixture
def every_check(monkeypatch):
    """A house where every kind of check has something to say."""
    monkeypatch.setattr(fabric_truth, "map_geometry_faults", lambda maps, mdl: [
        {"map_id": "", "name": "", "floor_id": "", "terms": ["no_world_frame"]},
        {"map_id": "ground", "name": "Ground", "floor_id": "main", "terms": ["unreadable"]},
        {"map_id": "ground", "name": "Ground", "floor_id": "main", "terms": ["unplaced"]},
        {"map_id": "attic", "name": "Attic", "floor_id": "upper", "terms": ["unplaced"]},
    ])
    monkeypatch.setattr(fabric_truth, "room_footprint_faults", lambda geo, maps, mdl: [
        {"floor_id": "main", "map_id": "ground", "map_name": "Ground", "room_w_m": 14.0, "room_h_m": 9.0,
         "map_w_m": 10.0, "map_h_m": 8.0, "terms": ["oversized"], "footprint_frac": 1.4},
        {"floor_id": "upper", "map_id": "attic", "map_name": "Attic", "room_w_m": 2.0, "room_h_m": 2.0,
         "map_w_m": 10.0, "map_h_m": 8.0, "terms": ["undersized"], "footprint_frac": 0.2},
    ])
    monkeypatch.setattr(fabric_truth, "room_divergence_faults", lambda geo, maps, mdl: [
        {"map_id": "ground", "map_name": "Ground", "floor_id": "main", "rooms": ["Kitchen", "Hall"],
         "ratio_x": 1.8, "ratio_y": 1.8, "terms": ["group_offset"]},
    ])

    async def _snap(hass):
        return {"ble": {"radios": [{"source": "AA:BB", "name": "Hall proxy"}]}}
    monkeypatch.setattr(snapshot_builder, "_live_snapshot", _snap)
    adaptive = SimpleNamespace(data={
        "transition_counts": {"Kitchen": {"Hall": 30}, "Hall": {"Kitchen": 25}},
        "room_fingerprints": {"Kitchen": {"AA:BB": {"n": 20, "var": 40.0}}},
        "stats": {"total_observations": 0},
    })
    pc = SimpleNamespace(_scanner_reliability={"AA:BB": 0.5}, _scanner_agree={"AA:BB": [1, 0] * 10})
    return _hass(points=[{"collected_at": "2026-01-01T00:00:00+00:00"}], maps=_maps(), adaptive=adaptive, pc=pc)


@pytest.mark.asyncio
async def test_every_check_speaks_plainly_and_keeps_its_figures(every_check) -> None:
    res = await _critics(every_check)
    critics = res["critics"]
    assert {c["category"] for c in critics} == {"room_confusion", "map_quality", "map_geometry", "room_footprint",
                                                "room_divergence", "scanner", "calibration", "propagation"}
    for c in critics:
        for k in ("title", "message", "action", "detail"):
            assert isinstance(c.get(k), str) and c[k].strip(), (k, c)
        for k in ("title", "message", "action"):
            assert not JARGON.search(c[k]), (k, c[k])
        go = c.get("go")
        assert go and go["to"] in GO_TARGETS and GO_TARGETS[go["to"]] <= set(go), c
    # The figures an expert wants are all still there, in the detail line.
    detail = " ".join(c["detail"] for c in critics)
    for figure in ("Leave-one-out mean error 3.00 m", "worst 5.50 m", "RSSI variance 40.0 dBm",
                   "Reliability 0.50", "50% agreement", "over 20 polls", "moves back and forth",
                   "Rooms span 14.0m × 9.0m", "×1.8 across", "not a placement"):
        assert figure in detail, figure
    # A floor by its name, never its id.
    fp = [c for c in critics if c["category"] == "room_footprint"]
    assert any("Main Floor" in c["title"] for c in fp) and not any("‘main’" in c["title"] for c in fp)


@pytest.mark.asyncio
async def test_each_problem_names_the_screen_that_fixes_it(every_check) -> None:
    critics = (await _critics(every_check))["critics"]
    go = {(c["category"], c["go"]["to"]) for c in critics}
    assert go == {("room_confusion", "calibrate"), ("map_quality", "calibrate"), ("map_geometry", "measure"),
                  ("room_footprint", "layout"), ("room_divergence", "layout"), ("scanner", "receivers"),
                  ("calibration", "calibrate"), ("propagation", "calibrate"), ("propagation", "adaptive_learning")}
    by_title = {c["title"]: c["go"] for c in critics}
    assert by_title["PadSpan can't read where “Ground” goes"] == {"to": "measure", "map_id": "ground"}
    assert by_title["No floor plan has a scale, so the map stays empty"]["map_id"] == "ground"
    assert by_title["Receiver “Hall proxy” often points to the wrong room"] == {"to": "receivers", "source": "AA:BB"}
    assert {c["go"]["floor_id"] for c in critics if c["go"]["to"] == "layout"} == {"main", "upper"}


@pytest.mark.asyncio
async def test_a_new_house_is_told_its_next_steps_not_a_critical_problem(monkeypatch) -> None:
    """A plan just uploaded and nobody calibrated: two next steps, no alarm."""
    monkeypatch.setattr(fabric_truth, "map_geometry_faults", lambda maps, mdl: [
        {"map_id": "attic", "name": "Attic", "floor_id": "upper", "terms": ["unplaced"]}])
    monkeypatch.setattr(fabric_truth, "room_footprint_faults", lambda geo, maps, mdl: [])
    monkeypatch.setattr(fabric_truth, "room_divergence_faults", lambda geo, maps, mdl: [])
    hass = _hass(points=[], maps=[{"id": "attic", "name": "Attic", "floor_id": "upper"}])
    hass.data[DOMAIN][DATA_CALIBRATION].compute_model.return_value = {"coverage_by_map": {}}
    res = await _critics(hass)
    assert res["summary"]["critical"] == 0 and res["summary"]["warning"] == 0, res["critics"]
    titles = [c["title"] for c in res["critics"]]
    assert titles == ["Next step: calibrate", "Next step: set the scale of “Attic”"], titles
    assert all(c["severity"] == "info" for c in res["critics"])


@pytest.mark.asyncio
async def test_a_plan_with_rooms_on_it_and_no_scale_is_still_a_problem(every_check) -> None:
    unplaced = [c for c in (await _critics(every_check))["critics"]
                if c["category"] == "map_geometry" and c["go"]["to"] == "measure" and "scale" in c["title"]
                and "No floor plan" not in c["title"]]
    sev = {c["title"]: c["severity"] for c in unplaced}
    assert sev == {"“Ground” has rooms or receivers but no scale": "warning",
                   "Next step: set the scale of “Attic”": "info"}, sev


# ── Health, run (tests/js/plain_problems.mjs) ────────────────────────────────

@pytest.fixture(scope="module")
def shown() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "plain_problems.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_health_shows_each_problem_plainly_with_its_go_there(shown) -> None:
    bad = {k: v for k, v in shown.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)[:3000]
    assert len(shown) >= 24
