# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Traceback CSV/JSON export — closing the one asymmetry left among the
three diagnostic history views.

Garry, 2026-09-10: "do 2-10" (from a missing-features shortlist) — #9:
Forensics and Insights both already had an export; Traceback, which carries
the richest per-frame data of the three (x_m/y_m, room, rssi, confidence,
scanner per ~10s frame), had none. Reuses insights.js's own CSV escaper/
download-blob pattern (matching, not shared — the same convention already
in place between forensics.js and insights.js).

Source-level pin, not a rendered-DOM test: traceback.js's own header notes
render() drives real canvas/SVG playback with no layout geometry under the
project's dom_shim.mjs, matching the class of UI this codebase already
verifies live rather than via a render harness (see calibration.js's
pan/zoom, pinned the same way in test_calibration_map_panzoom.py).
"""

from __future__ import annotations

from pathlib import Path

_TB = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
       / "www" / "padspan-ha" / "views" / "traceback.js")


def _src() -> str:
    return _TB.read_text(encoding="utf-8")


def test_export_functions_exist():
    s = _src()
    for name in ("_exportTracebackCsv", "_exportTracebackJson", "_csvEsc", "_downloadBlob"):
        assert f"function {name}(" in s, f"{name} is missing"


def test_csv_export_walks_every_frame_and_every_object_in_it():
    """A frame holds every object seen in that ~10s tick (frame.o is an
    array) — the export must emit one row per (frame, object) pair, not
    one row per frame."""
    s = _src()
    fn = s[s.index("function _exportTracebackCsv("):]
    fn = fn[:fn.index("\n  }\n")]
    assert "for (const frame of tb.frames)" in fn
    assert "for (const o of frame.o" in fn


def test_csv_columns_match_the_real_compact_frame_field_names():
    """traceback_store.py's compact per-object entry uses short keys (k, r,
    pid, x_m, y_m, f, c, rssi, n, t, src) — the export must read those
    exact names, not invented long-form ones."""
    s = _src()
    fn = s[s.index("function _exportTracebackCsv("):]
    fn = fn[:fn.index("\n  }\n")]
    for field in ("o.k", "o.n", "o.r", "o.f", "o.x_m", "o.y_m", "o.c", "o.rssi", "o.src", "o.t"):
        assert field in fn, f"CSV export never reads {field}"


def test_json_export_dumps_the_currently_loaded_window_verbatim():
    s = _src()
    fn = s[s.index("function _exportTracebackJson("):]
    fn = fn[:fn.index("\n  }\n")]
    assert "JSON.stringify(tb.frames" in fn


def test_export_buttons_are_only_offered_when_frames_are_loaded():
    """No dead buttons on the empty-state screen."""
    s = _src()
    i = s.index("if (tb.frames.length) {\n      const exportCsvBtn")
    block = s[i:s.index("ctrlCard.appendChild(filterRow);", i)]
    assert "_exportTracebackCsv" in block
    assert "_exportTracebackJson" in block
