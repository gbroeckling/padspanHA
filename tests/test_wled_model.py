# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""views/wled_model.js — the pure rules behind the WLED Advanced tab, checked
against the WLED firmware behaviour documented in
docs/research/wled-advanced-tab-2026-09-23.md. Skipped without node."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_MODEL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "wled_model.js"
_NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    src = ("import { pathToFileURL } from 'node:url';\n"
           f"const M = await import(pathToFileURL({json.dumps(str(_MODEL))}).href);\n"
           "const out = {};\n" + script + "\nconsole.log(JSON.stringify(out));\n")
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr[-2000:]
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_generations_follow_the_16_0_renumbering():
    out = _run("""
out.g = [
  M.wledGen({ ver: "0.14.4", vid: 2405180 }), M.wledGen({ ver: "0.15.0-b7", vid: 2410270 }),
  M.wledGen({ ver: "0.15.3", vid: 2503090 }), M.wledGen({ ver: "16.0.1", vid: 2607070 }),
  M.wledGen({ ver: "17.0.0-dev", vid: 2609010 }), M.wledGen({}),
];
out.bs = [M.has({ ver: "16.0.1", vid: 2607070 }, "blendStyle"), M.has({ ver: "0.15.3" }, "blendStyle")];
""")
    assert out["g"] == [14, 15, 15, 16, 16, 14]
    assert out["bs"] == [True, False]


def test_effect_metadata_is_parsed_the_way_wled_s_own_ui_reads_it():
    out = _run("""
// Real strings from WLED 16.0.1 FX.cpp.
out.fire = M.parseFxData("!,!;!;!;01;sx=64,ix=128,pal=35", 66);
out.twod = M.parseFxData("Speed,,Blur;,,;!;2", 150);
out.opts = M.parseFxData("!,!,,,,Smooth,Reverse;!,!;!;1v;c3=10", 20);
out.none = M.parseFxData(undefined, 5);
out.noneHi = M.parseFxData("", 200);
out.noPal = M.parseFxData("!;;;", 0);
""")
    f = out["fire"]
    assert [s["key"] for s in f["sliders"]] == ["sx", "ix"] and f["sliders"][0]["label"] == "Speed"
    assert f["palette"] and f["flags"]["single"] and f["flags"]["d1"] and not f["flags"]["d2"]
    assert f["defaults"] == {"sx": 64, "ix": 128, "pal": 35}
    t = out["twod"]
    assert [(s["key"], s["label"]) for s in t["sliders"]] == [("sx", "Speed"), ("c1", "Blur")]
    assert t["colors"] == [] and t["flags"]["d2"]
    o = out["opts"]
    assert [(x["key"], x["label"]) for x in o["toggles"]] == [("o1", "Smooth"), ("o2", "Reverse")]
    assert o["flags"]["volume"] and o["defaults"] == {"c3": 10}
    assert [c["label"] for c in o["colors"]] == ["Fx", "Bg"]
    assert [s["key"] for s in out["none"]["sliders"]] == ["sx", "ix"] and out["none"]["palette"]
    assert out["noneHi"]["sliders"] == []            # no metadata, fx >= 128: no default sliders
    assert out["noPal"]["palette"] is False


def test_the_catalog_hides_reserved_slots_and_strips_names():
    out = _run("""
out.c = M.effectCatalog(["Solid", "RSVD", "Blink@!,!;!,!;;01", "-"], ["", "", "!,!;!,!;;01", ""]).map(e => [e.id, e.name]);
""")
    assert out["c"] == [[0, "Solid"], [2, "Blink"]]


def test_segment_ranges_read_inclusive():
    out = _run("""
out.l = [M.segRangeLabel({ start: 0, stop: 60 }), M.segRangeLabel({ start: 10, stop: 10 })];
""")
    assert out["l"] == ["LEDs 0–59 (60)", "empty"]


def test_layout_warnings_find_overlaps_gaps_and_overruns():
    out = _run("""
const segs = [{ id: 0, start: 0, stop: 50 }, { id: 1, start: 40, stop: 80 }, { id: 2, start: 90, stop: 130 }];
out.w = M.layoutWarnings(segs, 120, 32).map(w => w.kind);
out.blend = M.layoutWarnings([{ id: 0, start: 0, stop: 50, bm: 2 }, { id: 1, start: 40, stop: 50 }], 50).map(w => w.kind);
out.gaps = M.coverageGaps(segs, 150);
""")
    # 120 LEDs: one gap (80–89); segment 2 runs past the end, so no trailing gap.
    assert out["w"] == ["overlap", "gap", "beyond"]
    assert out["blend"] == []                      # a deliberate blend layers on purpose
    assert out["gaps"] == [[80, 90], [130, 150]]


def test_add_segment_fills_a_gap_else_splits_the_longest():
    out = _run("""
out.gap = M.smartAddRange([{ id: 0, start: 0, stop: 60 }], 100);
out.split = M.smartAddRange([{ id: 0, start: 0, stop: 60 }, { id: 1, start: 60, stop: 100 }], 100);
out.next = M.nextSegId([{ id: 0, start: 0, stop: 60 }, { id: 1, start: 0, stop: 0 }, { id: 2, start: 60, stop: 90 }]);
""")
    assert out["gap"] == {"start": 60, "stop": 100, "split": None}
    assert out["split"] == {"start": 30, "stop": 60, "split": {"id": 0, "stop": 30}}
    assert out["next"] == 1


def test_a_bounds_write_always_resends_the_name():
    """WLED 16 clears a segment's name when its bounds change without it."""
    out = _run("""
out.w = M.segBoundsWrite({ id: 2, start: 0, stop: 10, n: "Porch" }, 5.4, 40.6);
out.anon = M.segBoundsWrite({ id: 1, start: 0, stop: 10 }, 0, 20);
""")
    assert out["w"] == {"id": 2, "start": 5, "stop": 41, "n": "Porch"}
    assert out["anon"] == {"id": 1, "start": 0, "stop": 20}


def test_unsaved_layout_is_compared_with_the_boot_preset():
    out = _run("""
const preset = { seg: [{ id: 0, start: 0, stop: 60 }, { id: 1, stop: 0 }] };
out.same = M.layoutDiffersFromPreset([{ id: 0, start: 0, stop: 60 }], preset);
out.diff = M.layoutDiffersFromPreset([{ id: 0, start: 0, stop: 30 }, { id: 1, start: 30, stop: 60 }], preset);
""")
    assert out == {"same": False, "diff": True}


def test_sync_groups_and_errors_in_words():
    out = _run("""
out.g = M.groupsOf(5); out.m = M.maskOf([1, 3]);
out.e = [M.describeError(91), M.describeError(12), M.describeError(0)];
out.fork = [M.forkOf({ repo: "MoonModules/WLED" }), M.forkOf({ repo: "wled/WLED", ver: "16.0.1", brand: "WLED" })];
""")
    assert out["g"] == [1, 3] and out["m"] == 5
    assert out["e"][0].startswith("Rebooted after a brownout") and out["e"][1].startswith("A file-system") and out["e"][2] is None
    assert out["fork"] == ["MoonModules/WLED", None]
