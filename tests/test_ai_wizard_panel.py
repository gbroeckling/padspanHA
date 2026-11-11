"""Let Claude draw your rooms, piece 2: the panel (views/ai_wizard.js and
views/ai_wizard_offer.js; design PadspanResearch ai-wizard-design-2026-11-10.md,
A.4, B, G).

tests/js/ai_wizard.mjs runs the helper for real under the DOM shim against a
fake server: each starting state reaches its screen and words, the consent is
a tick, the rooms check, Save, Done, Undo, a wall screen, a stopped read, the
Overview card. Here: every case passes; no word a person reads is one of the
plan tools' inside words; the failure words are the report's; no dollar sign;
the counts it sends are allowed; the four offers are wired; the outlines come
from the Plans tool's one list, not a copy.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")
_BANNED = ("anchor", "refile", "fabric", "gauge", "transform", "placement", "proposal")


def _src(name: str) -> str:
    return (_WWW / "views" / name).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "ai_wizard.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_passes(run: dict) -> None:
    assert len(run["cases"]) >= 60, sorted(run["cases"])
    assert not run["failures"], run["failures"][:5]


def test_no_screen_says_an_inside_word(run: dict) -> None:
    for t in run["texts"]:
        for w in _BANNED:
            assert not re.search(rf"\b{w}", t, re.I), (w, t[:300])


def test_the_failure_words_are_the_reports(run: dict) -> None:
    assert set(run["fails"]) == set(T.AI_WIZARD_FAILS)


def test_no_dollar_sign_and_no_shop():
    for name in ("ai_wizard.js", "ai_wizard_offer.js"):
        s = _src(name)
        assert not re.search(r"\$\s*\d|US\$|USD|est_usd|price", s, re.I), name    # no amount, and the estimate isn't shown
        assert "/buy" not in s and "BUY_URL" not in s and "trialOfferCard(host, \"ai_wizard\", { buy: false })" in _src("ai_wizard.js")


def test_the_counts_it_sends_are_allowed_and_its_surfaces_are_the_reports():
    js = _src("ai_wizard.js") + _src("ai_wizard_offer.js")
    for e in re.findall(r'"(ai_wizard[a-z_]*:[a-z0-9_]+)"', js):
        assert T.event_allowed(e), e
    for fam in re.findall(r'"(ai_wizard[a-z_]*:)" \+', js):
        assert any(e.startswith(fam) for e in T.AI_WIZARD_EVENTS), fam
    for w in T.AI_WIZARD_LINKS:
        assert f'"{w}")' in js, w
    m = re.search(r"export const SURFACES = Object\.freeze\(\[([^\]]*)\]\)", _src("ai_wizard_offer.js"))
    assert tuple(re.findall(r'"([a-z_]+)"', m.group(1))) == T.AI_WIZARD_SURFACES
    steps = set(re.findall(r'step: "([a-z_]+)"', js)) | set(re.findall(r'(?:trial|consent|connect|rooms_read|rooms_check|saved): "([a-z_]+)"', js))
    assert steps and steps <= set(T.AI_WIZARD_STEPS), steps


def test_the_four_offers_are_wired_and_the_view_is_unlisted():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert 'ai_wizard:    "./views/ai_wizard.js",' in panel and '_VIEW_PATHS_HIDDEN_OK.add("ai_wizard");' in panel
    assert "AIW.gettingStartedRow(this._ctx())" in panel and "this._aiWizardOverviewCard() || this._trialMilestoneCard(_hasPositioned)" in panel
    assert 'AIW.offerLine(ctx, "setup")' in _src("setup.js")
    assert _src("maps.js").count('AIW.offerLine(ctx, "maps_wizard")') == 2


def test_one_list_of_outlines_and_one_home_assistant_link():
    plans = _src("live_aboard_plans.js")
    assert "export function roomShapes(prop, opts = {})" in plans and "function rbShapes(){ return roomShapes(rbProp(), { both: rbBoth }); }" in plans
    wiz = _src("ai_wizard.js")
    assert "const { roomShapes } = await import(" in wiz and "const { _haLink } = await import(" in wiz
    assert "export function _haLink(" in _src("rooms.js")
    assert "document.createElement" not in wiz       # SVG as a string (innerHTML), the views' way
