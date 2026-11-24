# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Stair labels saved on a 3D house piece stay English in every panel language.

plan_ai.py (AI_LABELS) and setup_checks.py tell the AI's stairs and a stair
room's guess from hand-placed ones by these labels' English start. Review of
PR #107: routed through t(), a German house saved "Treppe (...)", so Plan AI
took its own stairs for hand-placed ones and the usage report counted none.
"""

from __future__ import annotations

import re
from pathlib import Path

from custom_components.padspan_ha.plan_ai import AI_LABELS

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def test_saved_stair_labels_are_not_translated():
    hits = []
    for p in sorted(_VIEWS.glob("live_aboard*.js")):
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\.label\s*=.*\bt\(\s*[\"'`]Stairs", line):
                hits.append(f"{p.name}:{n}: {line.strip()[:160]}")
    assert not hits, "a saved label is data, keep it English:\n" + "\n".join(hits)


def test_the_furnish_stair_labels_are_the_ones_the_backend_reads():
    src = (_VIEWS / "live_aboard_furnish.js").read_text(encoding="utf-8")
    for label in ("Stairs (AI first guess)", "Stairs (AI first guess, check which way is up)"):
        assert f'"{label}"' in src, label
        assert label.startswith(AI_LABELS), label
    assert "piece.label = `Stairs (${r.name})`;" in src
