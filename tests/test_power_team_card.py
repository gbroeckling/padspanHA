"""A power team on the map (2026-11-21): the Control4 dimmer and its Hue bulbs on one card.

"The case we have here needs the control4 light teamed with the hue on one card. Think about the logic and make a card
that will cover all contingencies"; "when controlling the team with a single button press, use hue, but when pressing
to get the card, give control4 power as an option"; "those advanced settings should show in the card, and a bit of
control over using the lights as a morning alarm". tests/js/power_team_card.mjs runs it: the tap, the drag and the hold
on the dimmer, the marker, the card's every state, Cut power and Power on, Try again, the wake-up and the curve saved
whole, live updates, and an ordinary user's card."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VIEWS = ROOT / "custom_components/padspan_ha/www/padspan-ha/views"


def test_the_team_card_and_the_map_run() -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    res = subprocess.run([node, str(Path(__file__).parent / "js" / "power_team_card.mjs"), str(VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert not out["failures"], json.dumps(out["failures"][:6], indent=2, ensure_ascii=False)
    assert len(out["cases"]) >= 18


def test_the_map_loads_the_card_optionally_and_a_team_light_is_never_a_strip() -> None:
    lm = (VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert "const TEAM = await import(`./power_team_card.js${new URL(import.meta.url).search}`)" in lm
    assert '.catch(err => { console.warn("PadSpan: power_team_card failed to load", err); return null; });' in lm
    codes = (VIEWS / "light_codes.js").read_text(encoding="utf-8")
    assert "if (l.power_team) return false;" in codes
