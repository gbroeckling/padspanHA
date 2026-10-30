# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Settings → Presence in sections, and no setting switched in two places.

Presence used to be some thirty cards in one run. They now sit under eight
headings (views/settings.js PRESENCE_SECTIONS), each card in exactly one, and
a section folds; a folded one is remembered in this browser. Every section
is open until someone folds one, so nothing changes for anyone who doesn't.

Quiet mode and the aggressive BLE reseed each had a switch in two places.
Each now has one, and the other place says where it is and links there.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VIEWS = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
SETTINGS_JS = (VIEWS / "settings.js").read_text(encoding="utf-8")

# Every card the Presence tab draws, by its title, in the section it belongs to.
EXPECTED = {
    "rooms": ["Room Change Delay", "Hold Room Through Short Gaps", "Why This Room (Sensor Attribute)", "Home/Away Timeout"],
    "phones": ["Guest tags", "Phone Tracking (Private BLE)"],
    "shown": ["Quiet Mode", "Object History Retention", "BLE Advertisement Timeout"],
    "positioning": ["Positioning Algorithm", "Positioning Choices", "Walk a Room (Calibration)", "Distance Calibration",
                    "Signal smoothing", "3D Positioning — Device Height", "Calibration Accuracy Reminders",
                    "Adaptive Learning", "Positioning Test Mode"],
    "receivers": ["Bluetooth refresh interval", "Receiver signal adjustments"],
    "performance": ["Presence Poll Interval", "CPU Mode", "Low-memory mode", "Optimize for scale"],
    "integrations": ["Room and receiver layout source", "GPS Bridge", "Automations", "HA Tags Integration", "Ignore Bermuda"],
    "privacy": ["Update Check", "Enhanced security", "💡 Suggest an idea", "Help improve PadSpan"],
}


def _presence_src() -> str:
    start = SETTINGS_JS.index("function _settingsPresence(ctx, el){")
    end = SETTINGS_JS.index("\n}\n", start) if "\n}\n" in SETTINGS_JS[start:] else SETTINGS_JS.index("\r\n}\r\n", start)
    return SETTINGS_JS[start:end]


def _section_keys() -> list[str]:
    block = SETTINGS_JS[SETTINGS_JS.index("export const PRESENCE_SECTIONS = ["):]
    block = block[:block.index("];")]
    return re.findall(r'\["([a-z]+)",\s*"[^"]+"\]', block)


@pytest.fixture(scope="module")
def drawn():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "settings_sections.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


# ── Sections: source ─────────────────────────────────────────────────────────

def test_every_presence_card_goes_into_a_known_section():
    src = _presence_src()
    keys = _section_keys()
    assert keys == list(EXPECTED), "the sections and their order"
    used = re.findall(r'put\("([a-z]+)",', src)
    assert len(used) == sum(len(v) for v in EXPECTED.values())
    assert set(used) == set(keys), "a section with no card, or a card in a section that isn't listed"
    # wrap only takes the heading and the sections: no card goes around them.
    direct = re.findall(r"wrap\.appendChild\(", src)
    assert len(direct) == 2, "a card appended straight to the tab, outside every section"
    assert "for (const sec of _presenceSections(ctx, el, bins)) wrap.appendChild(sec);" in src


def test_folding_is_remembered_in_this_browser_only():
    assert 'const _FOLD = "padspan_settings_fold_";' in SETTINGS_JS
    assert "localStorage.getItem(_FOLD + key) === \"0\"" in SETTINGS_JS
    # Nothing about folding goes to the backend.
    fn = SETTINGS_JS[SETTINGS_JS.index("function _presenceSections("):]
    fn = fn[:fn.index("\n}")]
    assert "settingsSet" not in fn and "wsCall" not in fn and "callWS" not in fn


# ── Sections: drawn ──────────────────────────────────────────────────────────

def test_every_card_is_in_exactly_one_section(drawn):
    plain = drawn["plain"]
    assert plain["loose"] == [], "cards drawn outside every section"
    got = {s["key"]: s["cards"] for s in plain["sections"]}
    assert [s["key"] for s in plain["sections"]] == drawn["order"]
    assert got == EXPECTED
    titles = [t for s in plain["sections"] for t in s["cards"]]
    assert len(titles) == len(set(titles)), "a card in two sections"


def test_all_sections_are_open_until_someone_folds_one(drawn):
    assert all(s["open"] for s in drawn["plain"]["sections"])


def test_a_folded_section_stays_folded_and_only_that_one(drawn):
    folded = {s["key"]: s["open"] for s in drawn["folded"]["sections"]}
    assert folded.pop("rooms") is False
    assert all(folded.values())


def test_a_link_to_a_card_opens_its_section_and_it_stays_open(drawn):
    assert {s["key"]: s["open"] for s in drawn["revealed"]["sections"]}["rooms"] is True
    assert drawn["revealed"]["reveal"] is None, "the reveal is used once"
    assert {s["key"]: s["open"] for s in drawn["afterReveal"]["sections"]}["rooms"] is True


def test_become_a_tester_opens_the_reports_section(drawn):
    assert {s["key"]: s["open"] for s in drawn["tester"]["sections"]}["privacy"] is True


def test_the_guests_link_opens_the_guest_tags_section():
    guests = (VIEWS / "guests.js").read_text(encoding="utf-8")
    assert 'ctx.state._settingsTab = "presence"; ctx.state._presenceReveal = "phones";' in guests


# ── One place per setting ────────────────────────────────────────────────────

def _writers(key: str) -> list[str]:
    """Views (and the panel's own .js) that save `key` through settingsSet."""
    out = []
    www = VIEWS.parent
    for f in sorted(www.rglob("*.js")):
        t = f.read_text(encoding="utf-8")
        for m in re.finditer(r"settingsSet\(\s*\{", t):
            body = t[m.end():t.index("}", m.end())]
            if re.search(r"\b" + key + r"\b\s*:", body):
                out.append(f.relative_to(www).as_posix())
                break
    return out


def test_quiet_mode_is_switched_only_on_the_overview():
    assert _writers("quiet_mode") == ["views/overview.js"]
    # Settings explains it and links there, with the same card title and words.
    assert 'data-goto":"overview-quiet"' in SETTINGS_JS
    assert "Switch it with the Quiet tick at the top of the Overview." in SETTINGS_JS
    assert "It only changes what this panel shows, not how much work Home Assistant or PadSpan does." in SETTINGS_JS
    assert 'id:"quietModeToggle"' not in SETTINGS_JS


def test_aggressive_reseed_is_switched_only_in_settings_beside_the_interval():
    assert _writers("aggressive_ble_reseed") == ["views/settings.js"]
    assert _writers("ble_reseed_interval_s") == ["views/settings.js"]
    src = _presence_src()
    # In the BLE Reseed Interval card, so in the Receivers section.
    i = src.index('"Bluetooth refresh interval"')
    card_start = src.rindex('put("', 0, i)
    assert src.startswith('put("receivers"', card_start)
    assert "aggressiveReseedRow," in src[card_start:i + 2000]
    assert "Refresh every 5 s for passive proxy scanners" in src
    manage = (VIEWS / "manage.js").read_text(encoding="utf-8")
    assert "Set it in Settings → Tracking → Receivers (Bluetooth refresh interval)." in manage
    assert 'ctx.state._presenceReveal = "receivers";' in manage


def test_the_settings_writes_and_their_schema_are_unchanged():
    ws = (ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("quiet_mode")' in ws
    assert 'vol.Optional("aggressive_ble_reseed"): bool' in ws
    assert 'vol.Optional("ble_reseed_interval_s"): vol.Coerce(int)' in ws
