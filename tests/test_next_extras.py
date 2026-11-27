# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Four small items the owner picked for one beta (2026-11-26).

  1. The usage report's env.emergency_count: the leak, smoke, gas and CO
     alarms placed on the map, a count, sent only when there is one. The
     number of power teams was already there (env.power_teams.n, zeros left
     out), so nothing new was added for it.
  2. The licence card and the tiers wizard say the free version in the
     owner's words: no "forever", no "stays free".
  3. Guest tags recommend a beacon with a fixed address or a phone with
     Private BLE, never a Find My tag (it changes its address); and the
     consent lines: phones of people who agreed, a guest told their tag is
     followed.
  4. A new install's first words welcome rather than alarm, the manifest has
     its Marketplace category, and the public code discusses no
     competitor's prices or products.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_FABRIC, DATA_SETTINGS, DOMAIN
from tests.test_telemetry import _hass as _report_hass

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"


def _read(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8")


# ═══ 1. the report ════════════════════════════════════════════════════════════

def _with_devices(states: dict[str, str]):
    """The report's test house with these entities placed on the map, each with its device class."""
    h = _report_hass()
    fab = h.data[DOMAIN][DATA_FABRIC].data
    for eid in states:
        fab["light_positions_m"][eid] = {"x_m": 1.0, "y_m": 1.0, "floor_id": "main"}
    known = {eid: {"device_class": dc} for eid, dc in states.items()}
    old = h.states

    def get(eid, default=None):
        return SimpleNamespace(attributes=known[eid]) if eid in known else old.get(eid, default)
    h.states = SimpleNamespace(get=get, async_all=old.async_all)
    return h


def test_no_emergency_device_sends_nothing():
    payload = T.build_payload(_report_hass())
    assert "emergency_count" not in payload["env"]
    # a smoke reading from a sensor, not an alarm, is not one either
    payload = T.build_payload(_with_devices({"sensor.kitchen_co": "carbon_monoxide", "binary_sensor.door": "door"}))
    assert "emergency_count" not in payload["env"]


def test_leak_smoke_gas_and_co_alarms_are_counted():
    h = _with_devices({"binary_sensor.washer_leak": "moisture", "binary_sensor.hall_smoke": "smoke",
                       "binary_sensor.furnace_gas": "gas", "binary_sensor.bedroom_co": "carbon_monoxide",
                       "binary_sensor.hall_motion": "motion"})
    payload = T.build_payload(h)
    T.assert_shareable(payload)
    assert payload["env"]["emergency_count"] == 4
    assert T.EMERGENCY_DEVICE_CLASSES == {"moisture", "smoke", "gas", "carbon_monoxide"}
    # a count, never which: no name or entity id of them anywhere in the report
    flat = json.dumps(payload)
    for word in ("washer", "hall_smoke", "furnace", "bedroom_co"):
        assert word not in flat


def test_the_count_is_held_to_a_count_above_zero():
    payload = T.build_payload(_with_devices({"binary_sensor.washer_leak": "moisture"}))
    assert payload["env"]["emergency_count"] == 1
    for bad in (0, -1, True, "1", 1.5, ["binary_sensor.washer_leak"]):
        payload["env"]["emergency_count"] = bad
        with pytest.raises(ValueError):
            T.assert_shareable(payload)


def test_the_panels_emergency_classes_are_the_reports():
    src = _read("views/light_codes.js")
    got = re.search(r"export const EMERGENCY_CLASSES = \{([^}]*)\}", src).group(1)
    assert set(re.findall(r"(\w+):", got)) == T.EMERGENCY_DEVICE_CLASSES


def test_power_teams_already_say_how_many():
    # env.power_teams.n: the number of teams, zeros left out, as before (power_teams_report).
    assert "n" in T.POWER_TEAM_COUNTS
    h = _report_hass()
    assert "power_teams" not in T.build_payload(h)["env"]
    h.data[DOMAIN][DATA_SETTINGS].data["power_teams"] = [{"name": "Den", "power": "light.den_dimmer", "bulbs": []}]
    pt = T.build_payload(h)["env"]["power_teams"]
    assert pt["n"] == 1 and "Den" not in json.dumps(pt)


def test_the_receiver_takes_any_key_inside_env():
    php = (_ROOT / "server" / "telemetry.php")
    if not php.exists():
        pytest.skip("no server/ in this tree")
    src = php.read_text(encoding="utf-8")
    # only the top-level keys are checked against a list; env is passed as it is
    assert "$allowed = array(" in src and "'env'" in src
    assert "$r['env']" not in src


# ═══ 2. the free version, in the owner's words ════════════════════════════════

_FREE = ("The free version needs no key and doesn't run out. Some features need PadSpan Pro or an add-on, "
         "and PadSpan says which where you meet them. Pro includes every add-on.")


def _licence_parts() -> str:
    s = _read("views/settings.js")
    wizard = s[s.index("function _tiersWizardFree("):s.index("function _tiersWizardLadder(")]
    card = s[s.index('el("div", { style: "font-weight:700;font-size:14px;color:#52b788" }, t("PadSpan licence"))'):]
    card = card[:card.index("} else if (isAddons) {")]
    return wizard + card


def test_no_forever_and_no_stays_free_on_the_licence_card():
    text = _licence_parts()
    assert "forever" not in text and "stays free" not in text
    # one click away: the tiers wizard's step labels, and its "?" (the settings_tiers help)
    s = _read("views/settings.js")
    steps = s[s.index("const TIERS_WIZARD_STEPS = ["):s.index("function _tiersWizardFooter(")]
    assert "always free" not in steps and 't("The free version")' in steps
    helps = _read("help_content.js")
    tiers = helps[helps.index("  settings_tiers: {"):]
    tiers = tiers[:tiers.index("\n  },")]
    assert "forever" not in tiers.lower() and "stays free" not in tiers and "always free" not in tiers
    assert "the free version doesn't run out" in tiers and "PadSpan says which where you meet them" in tiers
    assert "FREE_LINE()" in text and _FREE in _read("views/settings.js")


def test_what_needs_what_is_said_as_it_is_now():
    s = _read("views/settings.js")
    assert ("Fixture shapes with their size and angle, WLED's Advanced controls and Fit room need Pro or the Advanced "
            "smart lighting add-on") in s
    assert "Showcase needs Pro or the Looks pack" in s
    # before December 1 as well as from it: what Forensics, Locate and Busy Times need
    card = s[s.index("  if (!hasKey) {\n    line = fb"):s.index("    line += \" \" + FREE_LINE();")]
    assert card.count("Forensics, Locate and Busy Times need Pro or Presence insights") == 2, card
    assert "The lights' looks (fixture shapes and sizes, WLED, Showcase, Fit room), the 3D editor and Furnish are locked" not in s


# ═══ 3. guest tags and consent ════════════════════════════════════════════════

def test_guest_tags_never_recommend_a_find_my_tag():
    settings, helps = _read("views/settings.js"), _read("help_content.js")
    places = {
        "guests.js": _read("views/guests.js"),
        # the Guest tags card, and the guest tags' help pages (elsewhere a Find My tag is named for what it is)
        "settings.js": settings[settings.index('t("Guest tags")'):settings.index('t("Keep a finished stay')],
        "help_content.js": helps[helps.index('title: t("Tracking → Phones and guest tags")'):helps.index("  guest_tags: {") + 3000],
        "GUEST_TAGS_GUIDE.md": (_ROOT / "docs" / "GUEST_TAGS_GUIDE.md").read_text(encoding="utf-8"),
    }
    for name, src in places.items():
        assert "a Find My tag" not in src and "steady identity" not in src, name
    assert "iBeacon or Eddystone" in places["guests.js"] and "won't be followed reliably" in places["guests.js"]
    assert "iBeacon or Eddystone" in places["help_content.js"] and "Tile" in places["help_content.js"]
    assert "iBeacon or Eddystone" in places["GUEST_TAGS_GUIDE.md"] and "Tile" in places["GUEST_TAGS_GUIDE.md"]


def test_the_consent_lines():
    consent = "Only add the phones of people who've agreed."
    assert consent in _read("views/iphone_irk.js") and consent in _read("views/settings.js")
    irk = _read("views/iphone_irk.js")
    assert "phoneConsent()" in irk[irk.index("export function iphoneSetupAlert("):]
    assert "phoneConsent()" in irk[irk.index("export function renderCaptureSteps("):]
    assert "phoneConsent()" in _read("views/bluetooth.js")
    assert "Tell your guest their tag is followed" in _read("views/guests.js")
    assert "including neighbours' and passers-by's" in _read("views/settings.js")


# ═══ 4. first words, the manifest, competitors ════════════════════════════════

def test_a_new_installs_first_words_welcome():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    ask = panel[panel.index("_telemetryAskCard(compact){"):panel.index("disconnectedCallback(){")]
    first = re.search(r'\[t\("([^"]+)"\)', ask[ask.index('t("Help improve PadSpan")'):]).group(1)
    assert first.startswith("PadSpan shows your whole house on one screen"), first
    assert "bleeding edge" not in ask and "not a solved problem" not in ask


def test_the_manifest_has_its_marketplace_category():
    m = json.loads((_PKG / "manifest.json").read_text(encoding="utf-8"))
    assert m["categories"] == ["sensors.motion_presence"]
    # hassfest's order: domain, name, then alphabetical
    keys = list(m)
    assert keys[:2] == ["domain", "name"] and keys[2:] == sorted(keys[2:])


def test_no_competitor_prices_or_products_in_public_code():
    name = "Neon" + "Plan"       # spelled apart, so this file is not a hit itself
    hits = []
    for top in ("custom_components", "tests", "scripts"):
        for p in (_ROOT / top).rglob("*"):
            if p.is_file() and p.suffix in (".py", ".js", ".mjs", ".json", ".md") and name in p.read_text(encoding="utf-8", errors="ignore"):
                hits.append(p.relative_to(_ROOT).as_posix())
    # A file format PadSpan imports, as another app reads it, is technical and stays.
    assert hits == ["custom_components/padspan_ha/plan_file_import.py"] or hits == [], hits
