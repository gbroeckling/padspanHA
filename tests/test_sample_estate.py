# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
""""Preview a finished house": Sample mode shows the estate, and writes nothing.

Sample mode used to swap only the live snapshot for sample_data.js's small
Smith Residence, over the real house's model. It now puts the estate
(estate.js through sample_house.js, the website demo's house too) in front of
Home Assistant: panel.js _sampleCall answers every read from it, refuses
every write with the Sample-mode message, and lets through to Home Assistant
only the settings read, the version, the opt-in report's preview, and a
settings save that switches the data mode, records the release notes
seen or answers the report's question. Nothing is counted in the opt-in
report from Sample mode: the sample house's stairs and 3D are not the real
one's.

tests/js/sample_estate.mjs runs the real panel.js methods and views against a
recording fake Home Assistant; the checks below hold the rest by reading.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "sample_estate.mjs"
_NODE = shutil.which("node")

_CASES = [
    "Live mode never loads the sample house",
    "Sample mode loads the sample house once and shows it: 3 floors, 22 rooms, 3 plans, 19 receivers",
    "Rooms: the sample house's rooms by floor, read-only, with its people",
    "Receivers: 19 rows, read-only",
    "Calibration Results: the sample house's own walk, not the five sample rooms",
    "Setup: a finished house, six of six",
    "Mapping: the sample house's plans, read-only",
    "rendering every view in Sample mode sends Home Assistant no write and nothing about the house",
    "Basic focused links in Sample mode: the part opens, Basic stays Basic, and nothing reaches Home Assistant",
    "writes are refused with the Sample-mode message, through every door",
    "back to Live: the real house reloads and nothing of the sample one is left",
    "Bright: Sample mode shows the sample house the same way, and writes nothing",
    "the house could not load: the small demo house, and writes still refused",
    "the website demo's fake Home Assistant (padspan_demo) is asked directly",
    # review follow-ups
    "a Sample-mode page load sends none of the report's queued counts",
    "following in Sample mode never reaches the real follow list, and Live gets its own back",
    "the preview is per browser: one screen's Sample never turns another, nor the server",
    "no choice yet: the server's Sample from before is kept on load, and only a turn to Live follows later",
    "theme and look changes go through in Sample mode; other settings do not",
    "reads that look like actions are answered empty, without the refusal",
    "the sample house's settings: no real Vacation Mode, even in what the Atlas reads",
    "after the switch back, a view still holding the sample hass talks to the real house",
    # second review
    "Back to my house refused (Enhanced security, no admin) or unanswered: the screen stays in Sample and says why",
    "a real flood alarm still shows in Sample mode, with the way back instead of Reset",
    "the preview's own counts: opened from Live and back, and nothing in between",
    "a screen with no choice follows another screen's Back to my house within 30 s",
    "back to Live with the settings read failing: the real settings, not the sample copy",
]


def _text(p: Path) -> str:
    return p.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def cases() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in (res.stdout or "").splitlines() if ln.startswith('{"cases"')]
    assert lines, f"harness printed no result:\n{res.stdout[-3000:]}\n{(res.stderr or '')[-3000:]}"
    return json.loads(lines[-1])["cases"]


def test_the_harness_ran_every_case(cases: dict) -> None:
    missing = [c for c in _CASES if c not in cases]
    assert not missing, f"case(s) never ran: {missing}"
    # A case the harness runs but this list lacks would fail unseen.
    unlisted = [c for c in cases if c not in _CASES]
    assert not unlisted, f"case(s) not checked here: {unlisted}"


@pytest.mark.parametrize("case", _CASES)
def test_case(cases: dict, case: str) -> None:
    got = cases.get(case)
    assert got is not None, f"case never ran: {case}"
    assert got["ok"], got.get("detail")


def test_the_house_is_loaded_only_for_sample_mode() -> None:
    """A Live install never downloads the estate (~100 KB): nothing imports it
    statically, it is in neither load phase, and its one import is inside
    _ensureSampleHouse (run only while the server says data_mode=sample)."""
    panel = _text(_WWW / "panel.js")
    assert not re.search(r"^\s*import\s[^(]*from\s", panel, re.M), "panel.js has a static import"
    assert len(re.findall(r"import\([^)]*sample_house", panel)) == 1 and not re.search(r"import\([^)]*estate", panel)
    i = panel.index("  _ensureSampleHouse(){")
    assert i < panel.index("import(`./sample_house.js?b=${BUILD_ID}`)") < panel.index("  _sampleBlocked(){")
    assert '"./views/sample_house.js"' not in panel and "sample_house" not in panel[panel.index("const _VIEW_PATHS"):panel.index("const _VIEW_PATHS_HIDDEN_OK")]
    # Only the house module imports the estate, with the panel's own ?b= stamp.
    importers = [p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and "estate.js" in _text(p) and p.name != "estate.js"]
    assert importers == ["sample_house.js"], importers
    assert "await import(`./estate.js${new URL(import.meta.url).search}`)" in _text(_WWW / "sample_house.js")


def test_only_these_messages_reach_home_assistant_in_sample_mode() -> None:
    """The "pass" list, pinned: widening it is a decision, not a refactor."""
    panel = _text(_WWW / "panel.js")
    body = panel[panel.index("function _sampleKind(payload){"):panel.index("const READS = new Set(")]
    assert 'const PASS = ["padspan_ha/settings_get", "padspan_ha/version", "padspan_ha/telemetry_preview"];' in body
    assert re.findall(r'"padspan_ha/[a-z_]+"', body) == [
        '"padspan_ha/settings_get"', '"padspan_ha/version"', '"padspan_ha/telemetry_preview"', '"padspan_ha/telemetry_event"',
        '"padspan_ha/settings_set"',
    ]
    assert 'const ok = ["data_mode", "whatsnew_seen_version", "telemetry_enabled", "telemetry_asked",\n' in body
    assert '"theme_palette", "light_theme", "day_theme", "theme_follow_sun", "ui_skin"];' in body
    # Sample is never saved to the server: the preview is this browser's own.
    assert 'if ("data_mode" in payload && payload.data_mode !== "live") return "write";' in body
    assert 'if (type === "padspan_ha/telemetry_event") return "drop";' in body
    # The gate is the views' hass in Sample mode: callWS, the connection, services and the REST API all go through it.
    for s in ("callWS: (m) => self._sampleCall(m)", "sendMessagePromise: (m) => self._sampleCall(m)",
              "callService: (...a) => self._sampleGateOn() ? Promise.reject(self._sampleBlocked()) : self._realHass.callService(...a)", "this._hass = this._viewHass(hass);"):
        assert s in panel, s


def test_the_real_onboarding_is_never_finished_from_the_made_up_house() -> None:
    panel = _text(_WWW / "panel.js")
    assert '!this._onboardingAutoTried && this.state.dataMode === "live") {' in panel


def test_the_estate_identifies_nobody() -> None:
    """The house ships in the integration now: no addresses, IPs or e-mail in it."""
    for p in (_WWW / "estate.js", _WWW / "sample_house.js"):
        t = _text(p)
        assert not re.findall(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b", t), p.name
        assert not re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", t), p.name
        assert not re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", t), p.name
