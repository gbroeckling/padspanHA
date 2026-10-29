# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Setup checks (setup_checks.py, 0.38.193): the Overview's accuracy tips and
the report's new counts.

Garry, 2026-10-28: "Do 2 and 3, and opt in upgrades". The report showed most
multi-floor homes skip floor heights, receiver heights and a real-world
scale, so the Overview says so to an administrator; and the report now
counts rooms drawn over each other, the stairs in the 3D file (and how many
the AI read and were kept), how long the AI takes over a plan, and the house
size beside each time the 3D view gives up.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

from custom_components.padspan_ha import setup_checks as C
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_FABRIC, DATA_HOUSE3D, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN
from tests.test_house3d_store import _run
from tests.test_telemetry import _hass as _report_hass


def _rect(fid, x0, y0, x1, y1):
    return {"type": "poly", "floor_id": fid, "points_m": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


# ── rooms drawn over each other ─────────────────────────────────────────────
def test_rooms_drawn_over_each_other_are_counted_by_pairs():
    side_by_side = {"A": _rect("main", 0, 0, 4, 3), "B": _rect("main", 4, 0, 8, 3)}
    assert C.rooms_overlapping(side_by_side) == 0, "a shared wall is not an overlap"
    near = {"A": _rect("main", 0, 0, 4, 3), "B": _rect("main", 3.95, 0, 8, 3)}
    assert C.rooms_overlapping(near) == 0, "outlines a few centimetres apart are not counted"
    # Garry's Garage and Laundry: 17 cm over each other.
    garage = {"Garage": _rect("main", 3.3, -16.48, 11.15, -9.03), "Laundry": _rect("main", 7.89, -9.20, 9.80, -6.08)}
    assert C.rooms_overlapping(garage) == 1
    other_floor = {"A": _rect("main", 0, 0, 4, 3), "B": _rect("up", 1, 1, 3, 2)}
    assert C.rooms_overlapping(other_floor) == 0
    inside = {"Big": _rect("main", 0, 0, 10, 10), "Small": _rect("main", 2, 2, 4, 4), "Odd": {"type": "circle"}}
    assert C.rooms_overlapping(inside) == 1, "a room drawn wholly inside another"


def test_the_count_stays_cheap_on_a_house_of_hundreds_of_rooms():
    # It runs inside the report, on Home Assistant's event loop (the stable
    # review, 2026-10-29: every pair compared point by point could block it
    # for tens of seconds). 600 rooms on one floor, 40 corners each, a grid
    # of 3 m rooms with 25 of them drawn 20 cm into the room to their left.
    import math, time
    geo = {}
    for i in range(30):
        for j in range(20):
            k = i * 20 + j
            x0, y0 = i * 3.0 - (0.2 if (i % 5 == 0 and i and j % 4 == 0) else 0.0), j * 3.0
            pts = []
            for t in range(40):   # a 3 x 3 m square traced with 40 corners
                a = t / 40 * 4
                side, f = int(a), a - int(a)
                pts.append([[x0 + 3 * f, y0], [x0 + 3, y0 + 3 * f], [x0 + 3 - 3 * f, y0 + 3], [x0, y0 + 3 - 3 * f]][side])
            geo[f"R{k}"] = {"type": "poly", "floor_id": "main", "points_m": pts}
    t = time.perf_counter()
    n = C.rooms_overlapping(geo)
    took = time.perf_counter() - t
    assert n == 25, n           # columns 5, 10, 15, 20, 25 x rows 0, 4, 8, 12, 16
    assert took < 1.0, f"{took:.2f} s"


# ── the stairs in the 3D file ───────────────────────────────────────────────
def test_the_stairs_in_the_3d_file():
    st = lambda label, fid, to: {"recipe": {"kind": "stairs", "params": {"to_floor": to}}, "label": label, "floor_id": fid}
    pieces = {"a": st("Stairs (AI first guess)", "main", "upper"), "b": st("Stairs (from the plan, check which way is up)", "main", "upper"),
              "c": st("Entrance stairs", "main", "upper"), "d": st("Garage steps", "main", "main"),
              "e": st("Old", "main", "main~-0.55"), "sofa": {"recipe": {"kind": "sofa"}, "label": "Stairs (AI first guess)"}}
    assert C.stairs_summary(pieces) == {"total": 5, "ai_kept": 2, "within": 2}
    assert C.stairs_summary({}) is None and C.stairs_summary(None) is None


# ── the tips ────────────────────────────────────────────────────────────────
def _home(floors, scanners, maps=True, gauge=None, hidden=None):
    h = MagicMock()
    h.data = {DOMAIN: {
        DATA_MODEL: SimpleNamespace(data={"floors": floors}),
        DATA_FABRIC: SimpleNamespace(data={"scanner_positions_m": scanners}),
        DATA_MAPS: SimpleNamespace(data={"maps": [{"id": "m1"}] if maps else []}),
        DATA_SETTINGS: SimpleNamespace(data={"accuracy_tips_hidden": hidden or []}),
    }}
    return h


def test_the_tips_follow_the_reports_own_rules(monkeypatch):
    from custom_components.padspan_ha import fabric_truth
    monkeypatch.setattr(fabric_truth, "metre_gauge", lambda store: None)
    two = [{"id": "main"}, {"id": "up"}]
    same = {"a": {"z_m": 2.4}, "b": {"z_m": 2.4}}
    assert C.setup_tips(_home(two, same)) == ["floor_heights", "receiver_heights", "scale"]
    # Each one fixed, each one gone.
    assert "floor_heights" not in C.setup_tips(_home([{"id": "main", "floor_to_floor_m": 2.8}, {"id": "up"}], same))
    assert "receiver_heights" not in C.setup_tips(_home(two, {"a": {"z_m": 2.4}, "b": {"z_m": 0.4}}))
    monkeypatch.setattr(fabric_truth, "metre_gauge", lambda store: {"m_per_unit": 0.01})
    assert C.setup_tips(_home(two, same)) == ["floor_heights", "receiver_heights"]
    # A bungalow is asked about neither height; no plan, no scale to ask for.
    monkeypatch.setattr(fabric_truth, "metre_gauge", lambda store: None)
    assert C.setup_tips(_home([{"id": "main"}], same)) == ["scale"]
    assert C.setup_tips(_home(two, {"a": {}}, maps=False)) == ["floor_heights"]
    assert C.setup_tips(_home(two, {"a": {}, "b": {}}, maps=False)) == ["floor_heights", "receiver_heights"], "none given counts as one height"


def _ws(h, admin=True):
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=admin)
    _run(C.ws_setup_tips(h, conn, {"id": 4, "type": "padspan_ha/setup_tips"}))
    return conn.send_result.call_args[0][1]


def test_the_command_answers_administrators_and_keeps_out_what_was_hidden(monkeypatch):
    from custom_components.padspan_ha import fabric_truth
    monkeypatch.setattr(fabric_truth, "metre_gauge", lambda store: None)
    two, same = [{"id": "main"}, {"id": "up"}], {"a": {"z_m": 2.4}, "b": {"z_m": 2.4}}
    assert _ws(_home(two, same)) == {"tips": ["floor_heights", "receiver_heights", "scale"]}
    assert _ws(_home(two, same), admin=False) == {"tips": []}
    assert _ws(_home(two, same, hidden=["scale"])) == {"tips": ["floor_heights", "receiver_heights"]}
    assert _ws(_home(two, same, hidden=["all"])) == {"tips": []}
    assert C.WS_COMMANDS == (C.ws_setup_tips,)


def test_the_hidden_tips_setting_keeps_only_known_ids():
    import inspect
    from custom_components.padspan_ha import ws_settings
    src = inspect.getsource(ws_settings)
    assert 'vol.Optional("accuracy_tips_hidden"): list' in src
    assert 'str(x) in _TIPS or str(x) == "all"' in src
    assert C.TIPS == T.TIP_IDS, "the tips and the report's names for them are one list"


# ── the report ──────────────────────────────────────────────────────────────
def test_the_report_counts_overlaps_and_stairs_only_where_they_apply():
    h = _report_hass()
    dom = h.data[DOMAIN]
    p = T.build_payload(h)
    assert "stairs" not in p["env"], "no 3D file loaded: nothing said"
    geo = {"Garage": _rect("main", 3.3, -16.48, 11.15, -9.03), "Laundry": _rect("main", 7.89, -9.20, 9.80, -6.08)}
    dom[DATA_MODEL].room_geometry_m = lambda: geo
    dom[DATA_HOUSE3D] = SimpleNamespace(data={"pieces": {
        "a": {"recipe": {"kind": "stairs", "params": {"to_floor": "main"}}, "label": "Stairs (AI first guess)", "floor_id": "main"}}})
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["health"]["rooms_overlap"] == 1
    assert p["env"]["stairs"] == {"total": 1, "ai_kept": 1, "within": 1}
    assert "Garage" not in json.dumps(p) and "Laundry" not in json.dumps(p), "counts, never rooms"


def test_the_new_events_are_allowed_and_nothing_else():
    for e in ("tip_shown:scale", "tip_opened:floor_heights", "tip_hidden:receiver_heights", "tip_hidden:all",
              "stair_secs:lt5", "stair_secs:gt45", "house3d_fallback_size:lt20", "house3d_fallback_size:gt150"):
        assert T.event_allowed(e), e
    for e in ("tip_shown:other", "tip_hidden:everything", "stair_secs:5", "house3d_fallback_size:huge"):
        assert not T.event_allowed(e), e


# ── recent fixes at work (0.38.175/176/191, the stable's field signals) ─────
def test_the_report_says_where_recent_fixes_acted(monkeypatch):
    from custom_components.padspan_ha import forensics_store
    h = _report_hass()
    dom = h.data[DOMAIN]
    p = T.build_payload(h)
    assert not {"radios_shelly_mac", "radios_area_via", "forensics_paused_licence"} & set(p["health"]), "nothing where nothing acted"
    snap = dom["snapshot_cache"][1]
    snap["ble"]["shelly_rules"] = {"mac": 2, "area_via": 0}
    dom[DATA_SETTINGS].data["forensics_enabled"] = True
    monkeypatch.setattr(forensics_store, "_recording_enabled", lambda hass: False)
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert p["health"]["radios_shelly_mac"] == 2 and "radios_area_via" not in p["health"]
    assert p["health"]["forensics_paused_licence"] is True
    monkeypatch.setattr(forensics_store, "_recording_enabled", lambda hass: True)
    assert T.build_payload(h)["health"]["forensics_paused_licence"] is False
    dom[DATA_SETTINGS].data["data_mode"] = "sample"
    assert "forensics_paused_licence" not in T.build_payload(h)["health"], "only a live house can record"
    assert T.event_allowed("stale_receivers_listed")
