"""'Set this plan's scale now' after an upload (owner, 2026-11-12), and its quiet reminder.

The server side RUN on test_plan_build_scale.py's synthetic house in the REAL
model and maps stores: the upload marks the plan (never an Outside one), the
hand measurement (one length or two) is read, previewed and saved through
Mapping → Edit → Measure's own writer as a hand measurement (no helper source,
no ledger, nothing for the helper's undo), Later ends it; the counters are
allowed, summed and labelled. The panel side is tests/js/scale_nudge.mjs, run
here: upload → nudge → measure → saved, Later, shown once, the reminder line,
nothing for non-admins, Sample or a wall screen, two lengths that disagree.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_fabric as F
from custom_components.padspan_ha import ws_maps as WM
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_plan_build import _call
from tests.test_house3d_store import _run
from tests.test_plan_build_scale import _setup

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")

# On the 1000 x 800 plan "n1": half its width is five metres (100 px/m), and half its height is four.
_ACROSS = {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "text": "5 m"}
_DOWN = {"p1": [0.5, 0.1], "p2": [0.5, 0.6], "text": "4 m"}
_DOWN_OFF = {"p1": [0.5, 0.1], "p2": [0.5, 0.6], "text": "5 m"}     # the same 400 px called 5 m: 20 % apart


def _house(monkeypatch, tmp_path, disk, **kw):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, **kw)
    # No AI, no plan tools: the hand measurement needs none of the helper's switches or Claude.
    h.data[DOMAIN][DATA_SETTINGS].data.update(atlas_3d_ai_task_entity="", ai_plans_enabled=False, ai_plan_build_enabled=False)
    ms.get_map("n1")["scale_nudge"] = True
    return h, conn, mdl, ms, cal


def test_the_preview_reads_the_lengths_and_writes_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    before = json.dumps([mdl.data, ms.data])
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"text": "12"}])
    assert out["metres"] == [12.0] and out["assumed"] == ["metres"] and "across_m" not in out
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)])
    assert out["across_m"] == 10.0 and out["down_m"] == 8.0 and out["odd"] is False and "differ_pct" not in out
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS), dict(_DOWN)])
    assert out["differ_pct"] == 0.0 and out["across_m"] == 10.0
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS), dict(_DOWN_OFF)])
    assert out["differ_pct"] == 22.2                                 # 100 and 80 px/m: 20 / 90
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"text": "lots"}])
    assert out["invalid"].startswith("Type a length")
    assert json.dumps([mdl.data, ms.data]) == before and not disk.writes


def test_the_save_is_measures_own_write_a_hand_measurement(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    sent, real = [], F.async_write_measured_transform

    async def spy(hass, map_id, transform):
        sent.append((map_id, copy.deepcopy(transform)))
        return await real(hass, map_id, transform)
    monkeypatch.setattr(F, "async_write_measured_transform", spy)
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS), dict(_DOWN)], save=True)
    assert out == {"ok": True, "map_id": "n1", "scale_x_m": 10.0, "scale_y_m": 8.0, "lengths": 2}
    (mid, t), = sent
    refs = t["reference_measurements"]
    # Measure's payload: the size, the plan's own floor, both lengths averaged; no helper source on them.
    assert mid == "n1" and t["scale_x_m"] == 10.0 and t["scale_y_m"] == 8.0 and t["floor_id"] == "main" and len(refs) == 2
    assert all("source" not in r for r in refs) and [r["distance_m"] for r in refs] == [5.0, 4.0]
    assert all(r.get("source") not in F.HELPER_SCALE_SOURCES for r in mdl.map_transform("n1")["reference_measurements"])
    assert "scale_nudge" not in ms.get_map("n1")                     # Save ended the nudge


def test_the_save_is_never_the_helpers_to_take_back(monkeypatch, tmp_path, disk):  # noqa: F811
    from custom_components.padspan_ha import ws_plan_ai as WP
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)], save=True)
    assert not (_run(A.async_get_store(h)).data.get("scale_batches") or {})   # no ledger entry: nothing of the helper's
    out = _call(WP.ws_plan_build_scale_undo, h, conn, map_id="n1", via="wizard")
    assert out["ok"] is False and out["code"] == "nothing_to_undo" and mdl.map_transform("n1")["scale_x_m"] == 10.0


def test_a_save_that_cant_go_writes_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    before = json.dumps([mdl.data, ms.data])
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"p1": [0.1, 0.5], "p2": [0.6, 0.5], "text": "lots"}], save=True)
    assert out["ok"] is False and out["code"] == "invalid" and json.dumps([mdl.data, ms.data]) == before
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="gone", measures=[dict(_ACROSS)], save=True)
    assert out["error"] == "not_found"


def test_later_ends_it_for_good_and_the_upload_marks_only_an_indoor_plan(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    assert _call(WM.ws_maps_scale_nudge_end, h, conn, map_id="n1") == {"ok": True, "ended": True}
    assert "scale_nudge" not in ms.get_map("n1")
    assert _call(WM.ws_maps_scale_nudge_end, h, conn, map_id="n1") == {"ok": True, "ended": False}
    ms.maps_dir = tmp_path                                           # the fixture's store has no picture folder
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    up = dict(name="Up", filename="up.png", mime="image/png", width=1, height=1, png_base64=png)
    m1 = _call(WM.ws_maps_upload, h, conn, **up, floor_id="main", scale_nudge=True)["map"]
    m2 = _call(WM.ws_maps_upload, h, conn, **up, floor_id="__outside__", scale_nudge=True)["map"]
    m3 = _call(WM.ws_maps_upload, h, conn, **up, floor_id="main")["map"]
    assert m1.get("scale_nudge") is True and "scale_nudge" not in m2 and "scale_nudge" not in m3


def test_the_counters_are_allowed_summed_and_labelled():
    words = {f"scale_nudge:{k}" for k in ("shown", "measured_one", "measured_two", "later", "reminder_measure")}
    assert T.SCALE_NUDGE_EVENTS == words and all(T.event_allowed(e) for e in words)
    spec = importlib.util.spec_from_file_location("telemetry_summary", _ROOT / "server" / "telemetry_summary.py")
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    assert set(S._SCALE_NUDGE) == words
    js = (_WWW / "views" / "scale_nudge.js").read_text(encoding="utf-8")
    sent = set(re.findall(r'tel\(ctx, "([a-z_]+)"\)', js)) | set(re.findall(r'"(measured_[a-z]+)"', js))
    assert {f"scale_nudge:{w}" for w in sent} == words
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert all(f"{k}:" in ib for k in ("measured_one", "measured_two", "reminder_measure")) and 'a === "scale_nudge"' in ib


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_panel_harness():
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "scale_nudge.mjs"), str(_WWW)], capture_output=True, text=True, timeout=180)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert out["cases"] and not out["failures"], json.dumps(out["failures"], indent=1)
