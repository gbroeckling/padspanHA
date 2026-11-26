# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The add-ons, seen: the sale's Overview card and the usage report's Add-ons section.

1. "Half off every add-on until January 1" (panel.js _addonSaleCard, editions.js addonSaleCardDue): once, to an
   administrator, never on a wall, while the sale runs, to an install without paid Pro; its own flag
   (addon_sale_card_done) kept like the lifetime card's. The rule runs in tests/js/addon_sale.mjs, the card in
   tests/js/whats_new_card.mjs; here the backend's flag, and the card as a 0.38.274 install sees it after updating.
2. The report's `addons` (addon_report.py) and the funnel in `usage` (telemetry.ADDON_EVENTS): every field, its
   words, what it never carries, the Preview, and the receiver (server/telemetry.php) taking the new key.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import sys
import time
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import addon_report as A
from custom_components.padspan_ha import settings_store as ss
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha import ws_settings
from custom_components.padspan_ha.const import DATA_MAPS, DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.licence import ADDONS
from tests.test_telemetry import _SECRETS, _hass, _run

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_WWW = _CC / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NOW = datetime(2026, 12, 1, 12, tzinfo=timezone.utc).timestamp()


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _iso(days: float, now: float = _NOW) -> str:
    return datetime.fromtimestamp(now + days * 86400, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _node(script: str, *extra: str) -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    res = subprocess.run([node, str(Path(__file__).parent / "js" / script), str(_VIEWS), *extra],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout[-2000:] + res.stderr[-2000:]
    out = json.loads(lines[-1])
    assert not out["failures"] and res.returncode == 0, out["failures"]
    return out


# ── 1. The sale's card ───────────────────────────────────────────────────────

def test_the_sale_cards_flag_is_kept_settable_and_survives_a_restore_a_reset_and_bright() -> None:
    assert ss.DEFAULT_SETTINGS["addon_sale_card_done"] is False
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert "addon_sale_card_done" in keys, "settings_set would refuse it"
    assert 'payload["addon_sale_card_done"] = bool(msg.get("addon_sale_card_done"))' in _src(_CC / "ws_settings.py")
    assert "addon_sale_card_done" in ws_settings._EVERYONE_KEYS, "written as the panel is used, Enhanced security or not"
    assert ss.trial_state_kept({"addon_sale_card_done": True}, {"addon_sale_card_done": False})["addon_sale_card_done"] is True
    assert ss.trial_state_kept({}, {"addon_sale_card_done": True})["addon_sale_card_done"] is True
    # trial_state_kept is what a restore, a factory reset and the Bright import keep.
    for f in ("ws_backup.py", "ws_factory_reset.py", "bright_import.py"):
        assert "trial_state_kept" in _src(_CC / f), f
    gold = _src(_ROOT / "tests" / "golden" / "settings" / "settings_set.jsonl")
    assert '{"key":"addon_sale_card_done","case":"on","as":"admin"' in gold, "tests/regen_goldens.py not run"


def test_the_report_facts_are_backend_only_and_kept() -> None:
    assert ss.DEFAULT_SETTINGS[A.SEEN_KEY] == {}
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert A.SEEN_KEY not in keys, "the panel never writes it"
    seen = {"moved": ["power_teams"], "licence": "addon"}
    assert ss.trial_state_kept({A.SEEN_KEY: seen}, {A.SEEN_KEY: {}})[A.SEEN_KEY] == seen
    assert ss.trial_state_kept({}, {A.SEEN_KEY: seen})[A.SEEN_KEY] == seen
    assert A.SEEN_KEY not in ss.trial_state_kept({}, {})


def test_the_card_is_in_the_overview_line_with_the_lifetime_cards_gates() -> None:
    pj = _src(_WWW / "panel.js")
    assert ("|| this._addonSaleCard() || this._aiWizardOverviewCard() || this._trialMilestoneCard(_hasPositioned)"
            " || this._c4localOverviewCard();") in pj
    i = pj.index("\n  _addonSaleCard(){")
    card = pj[i:pj.index("\n  }\n", i)]
    for gate in ("this.state.kioskMode", 'this.state.dataMode !== "live"', "this._hass.user.is_admin", "this._overviewCardShown",
                 "EDITIONS.addonSaleCardDue(st)", "EDITIONS.addonHalfOff()", "addon_sale_card_done: true", "EDITIONS.ADDONS_URL"):
        assert gate in card, gate
    assert not re.search(r"20\d\d|Date\.parse|new Date|\$\d", card), "a date or a price written into the card itself"
    for word in ("shown", "clicked", "dismissed"):
        assert f'this._telemetryEvent("addon_sale_card:{word}")' in card and f"addon_sale_card:{word}" in T.ADDON_EVENTS
    # The add-ons' names in the card are editions.js's English, through t() (translated in i18n/<lang>/panel.json).
    ed = _src(_VIEWS / "editions.js")
    for name, words in re.findall(r'\{ name: "(\w+)", words: "([^"]+)"', ed):
        if name not in ("maps", "c4local"):              # c4local, the specialty: never in the sale, never on its card
            assert f'{name}: t("{words}")' in card, name
    assert "c4local" not in card
    for lang in ("de", "fr", "nl"):
        tr = json.loads((_WWW / "i18n" / lang / "panel.json").read_text(encoding="utf-8"))
        for k in ("Half off every add-on until January 1", "Now {list}. Each is paid once and covers 2 years.",
                  "See the add-ons", "No thanks", "At padspan.traks.ca", "Presence insights"):
            assert tr.get(k) and tr[k] != k or k in ("At padspan.traks.ca",), (lang, k)


def test_one_sale_window_everywhere() -> None:
    ed = _src(_VIEWS / "editions.js")
    assert f'ADDON_HALF_FROM = "{A.SALE_FROM}"' in ed and f'ADDON_HALF_UNTIL = "{A.SALE_UNTIL}"' in ed
    due = ed[ed.index("export function addonSaleCardDue"):]
    due = due[:due.index("\n}\n")]
    assert "addonHalfOff(now)" in due and not re.search(r"20\d\d-|Date\.parse|new Date", due)


def test_who_sees_the_card_tier_by_trial_by_lapsed_by_add_ons_by_the_sales_days() -> None:
    assert len(_node("addon_sale.mjs")["checks"]) >= 250


def _payload_from(stored: dict) -> dict:
    """What the panel gets from a store holding `stored`, the way a load does it ({**DEFAULT_SETTINGS, **loaded})."""
    from custom_components.padspan_ha.ws_common import _get_settings
    st = SimpleNamespace(data={**ss.DEFAULT_SETTINGS, **stored})
    return _get_settings(SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}))


def test_a_stable_0_38_274_install_sees_the_card_after_updating(tmp_path) -> None:
    """A 0.38.274 install's settings (tests/fixtures/settings_0_38_274.json: what that version stored; no add-on
    field, no sale flag) loaded by this backend: free, a trial, a lapsed key and Bright are shown the card in the sale
    and not before it; a paid Pro key never."""
    stored = json.loads((_ROOT / "tests" / "fixtures" / "settings_0_38_274.json").read_text(encoding="utf-8"))
    assert "addon_sale_card_done" not in stored and "license_addons" not in stored, "the fixture is a 0.38.274 install's"
    now = time.time()

    def key(days: float, **kw) -> dict:
        return {**stored, "forensics_license_key": "PSPAN-AAAA-BBBB-CCCC-DDDD", "forensics_license_expires": _iso(days, now), **kw}
    installs = {"free": stored, "pro_year": key(200, license_tier="pro"), "pro_untiered": key(200),
                "trial": key(60, license_tier="pro", license_is_trial=True), "lapsed": key(-60, license_tier="pro"),
                "bright": key(100, license_tier="bright")}
    payloads = {k: _payload_from(v) for k, v in installs.items()}
    for k, p in payloads.items():
        assert p["addon_sale_card_done"] is False and isinstance(p["pro_has_key"], bool) and isinstance(p["addons_licensed"], list), k
        assert p["forensics_license_key"] == "", "the key never leaves the backend"
    cases = {}
    for k, p in payloads.items():
        cases[f"{k}@sale"] = {"settings": p, "now": "2026-12-05T12:00:00Z"}
        cases[f"{k}@before"] = {"settings": p, "now": "2026-11-26T12:00:00Z"}
        cases[f"{k}@after"] = {"settings": p, "now": "2027-01-02T08:00:00Z"}
    f = tmp_path / "payloads.json"
    f.write_text(json.dumps(cases, default=str), encoding="utf-8")
    due = _node("addon_sale.mjs", str(f))["due"]
    want_sale = {"free": True, "pro_year": False, "pro_untiered": False, "trial": True, "lapsed": True, "bright": True}
    for k, want in want_sale.items():
        assert due[f"{k}@sale"] is want, k
        assert due[f"{k}@before"] is False and due[f"{k}@after"] is False, k


# ── 2. The report's add-ons ──────────────────────────────────────────────────

_KEY = "PSPAN-ADDO-NNNN-NNNN-0001"


def _addon_key(**kw) -> dict:
    return {"forensics_license_key": _KEY, "license_tier": "free", "license_addons": ["audio", "climate"],
            "license_addons_until": {"audio": _iso(400), "climate": _iso(10)}, "forensics_license_expires": _iso(400), **kw}


@pytest.mark.parametrize("settings,active,days,want", [
    ({}, False, None, "free"),
    ({"forensics_license_key": _KEY, "license_tier": "pro", "license_is_trial": True}, True, 60, "trial"),
    ({"forensics_license_key": _KEY, "license_tier": "pro", "license_is_trial": True}, False, -40, "lapsed_trial"),
    ({"forensics_license_key": _KEY, "license_tier": "pro"}, True, 200, "pro_year"),
    ({"forensics_license_key": _KEY}, True, 200, "pro_year"),                      # a key with no tier is Pro
    ({"forensics_license_key": _KEY, "license_tier": "pro"}, True, None, "pro_year"),
    ({"forensics_license_key": _KEY, "license_tier": "pro"}, True, 700, "pro_pass"),
    ({"forensics_license_key": _KEY, "license_tier": "pro"}, True, 26000, "pro_life"),
    ({"forensics_license_key": _KEY, "license_tier": "pro"}, False, -60, "lapsed_pro"),
    ({"forensics_license_key": _KEY, "license_tier": "bright"}, True, 100, "bright"),
    ({"forensics_license_key": _KEY, "license_tier": "bright"}, False, -60, "lapsed_bright"),
    (_addon_key(), True, 400, "addon"),
    (_addon_key(), False, -60, "lapsed_addon"),
])
def test_the_licence_word(settings, active, days, want) -> None:
    assert A.licence_word(settings, active, days) == want and want in A.LICENCE_WORDS


def test_a_free_pro_licence_reads_as_a_testers(monkeypatch) -> None:
    s = {"forensics_license_key": _KEY, "license_tier": "pro", "forensics_license_expires": _iso(700, time.time()),
         "report_locked_key": ss.licence_key_hash(_KEY)}
    assert A.licence_word(s, True, 700) == "pro_tester"
    assert A.licence_word({**s, "report_locked_key": ""}, True, 700) == "pro_pass", "a bought key is not a tester's"


def test_held_add_ons_with_their_time_left_and_the_one_kept_for_a_trial() -> None:
    s = _addon_key(license_addons_until={"audio": _iso(400), "climate": _iso(10), "wifi": _iso(-3), "looks": _iso(-40)},
                   license_addons=["audio", "climate"])
    assert A.held(s, _NOW) == {"audio": "gt365", "wifi": "grace", "climate": "lt30", "looks": "ended"}
    assert A.held({"license_addons": ["audio"]}, _NOW) == {}, "no key, nothing held"
    assert A.held({"forensics_license_key": _KEY, "license_tier": "pro"}, _NOW) == {}, "Pro holds them all: not listed"
    # A trial over an add-on key: the kept key's add-ons, which come back when it ends.
    trial = {"forensics_license_key": "PSPAN-TRIA-L000-0000-0001", "license_tier": "pro", "license_is_trial": True,
             "license_addons_kept": _addon_key()}
    assert A.held(trial, _NOW) == {"audio": "gt365", "climate": "lt30"}
    # A Pro invite's year claimed over an add-on key (pro_invite.py keeps it aside too): the kept key's add-ons.
    year = {"forensics_license_key": "PSPAN-YEAR-0000-0000-0001", "license_tier": "pro", "license_is_trial": False,
            "license_addons_kept": _addon_key()}
    assert A.held(year, _NOW) == {"audio": "gt365", "climate": "lt30"}
    assert A.days_word(None) == "unknown" and A.days_word(45) == "30_90" and A.days_word(200) == "91_365"


def test_the_sale_weeks() -> None:
    start = datetime(2026, 11, 27, 8, tzinfo=timezone.utc).timestamp()
    assert A.sale_when(start - 1) == "before" and A.sale_when(start) == "sale_w1"
    assert A.sale_when(start + 7 * 86400) == "sale_w2" and A.sale_when(start + 35 * 86400) == "sale_w6"
    assert A.sale_when(datetime(2027, 1, 2, 7, 59, tzinfo=timezone.utc).timestamp()) == "sale_w6"
    assert A.sale_when(datetime(2027, 1, 2, 8, tzinfo=timezone.utc).timestamp()) == "after"
    assert set(A.SALE_WHEN) == {A.sale_when(start + d * 86400) for d in range(-1, 40)}


def test_what_was_used_counts_only_what_the_install_may_use(monkeypatch) -> None:
    usage = {"room_controls:up": 2, "alarm_button:arm": 1, "tab:wifi": 3, "addon_used:insights": 1, "addon_used:timetravel": 1,
             "forensics_query": 1, "plan_ai_session:started": 1, "vacation_on": 1, "vacuum_imported": 1}
    state = {"atlas_heatmap_enabled": True, "theme_palette": "ocean", "power_teams": [{"adaptive": True}]}
    pro = {"forensics_license_key": _KEY, "license_tier": "pro", **state}
    assert A.used_words(pro, usage, True) == ["audio", "alarm", "wifi", "climate", "timetravel", "vacation", "looks",
                                              "forensics", "insights", "maps", "lighting", "vacuum"]
    # An add-on key: its own (audio and climate), and what is still everyone's (maps and vacuum, not on sale before
    # December 1). Lighting is an add-on on sale now, so a key without it doesn't count it.
    assert A.used_words({**_addon_key(), **state}, usage, True) == ["audio", "climate", "maps", "vacuum"]
    # Free: a palette stored from Pro days is not the Looks pack used; nor a power team's curve without lighting.
    assert A.used_words(dict(state), usage, False) == ["maps", "vacuum"]
    # Bright keeps what was Bright's: the alarm's controls, the light design tools and power teams, the robot vacuum.
    bright = {"forensics_license_key": _KEY, "license_tier": "bright", "power_teams": [{"adaptive": True}]}
    assert A.used_words(bright, usage, True) == ["alarm", "maps", "lighting", "vacuum"]
    assert A.used_words(pro, {}, True) == ["climate", "looks", "lighting"], "settings alone"
    assert A.used_words(pro, {"robot_run:started": 1}, True) == ["climate", "looks", "lighting", "vacuum"], "a room location run"
    # From December 1 Advanced map creation and Robot vacuum are sold: only their holders, Pro (and Bright, the robot).
    from custom_components.padspan_ha import licence
    from custom_components.padspan_ha.const import FREE_BASICS_FROM_TS
    monkeypatch.setattr(licence, "_clock", lambda: float(FREE_BASICS_FROM_TS))
    assert A.used_words({**_addon_key(), **state}, usage, True) == ["audio", "climate"]
    assert A.used_words(dict(state), usage, False) == []
    assert A.used_words(bright, usage, True) == ["alarm", "lighting", "vacuum"]
    assert A.used_words({**_addon_key(license_addons=["vacuum"], license_addons_until={}), **state}, usage, True) == ["vacuum"]


def _moved_house(tmp_teams=None, maps=None, roomplan=False):
    h = _hass()
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data.update({"power_teams": tmp_teams or [], "roomplan_import_enabled": roomplan})
    h.data[DOMAIN][DATA_MAPS].data["maps"] = maps or [{"id": "m1"}]
    return h, st


def test_the_moved_cohort_is_noted_once_report_on_or_not(monkeypatch) -> None:
    from custom_components.padspan_ha import emergency_test
    monkeypatch.setattr(emergency_test, "resolve_members", lambda hass: {"members": ["light.emergency_1"]})
    h, st = _moved_house([{"adaptive": True}, {"adaptive": False}], [{"id": "m1", "kind": "scan"}])
    st.data["telemetry_enabled"] = False
    _run(A.async_note_moved(h))
    assert st.data[A.SEEN_KEY] == {"moved": ["emergency_test", "power_teams", "circadian", "lidar"]}
    # Once: what the house has later (a purchase, a change) never rewrites it.
    monkeypatch.setattr(emergency_test, "resolve_members", lambda hass: {"members": []})
    st.data["power_teams"] = []
    _run(A.async_note_moved(h))
    assert st.data[A.SEEN_KEY]["moved"] == ["emergency_test", "power_teams", "circadian", "lidar"]
    # A house with none of them is noted too (an empty list), so it is never asked again.
    h2, st2 = _moved_house(roomplan=False)
    _run(A.async_note_moved(h2))
    assert st2.data[A.SEEN_KEY] == {"moved": []}
    h3, st3 = _moved_house(roomplan=True)
    assert A.moved_now(h3, st3.data) == ["lidar"], "the RoomPlan import switched on is a LiDAR scan used"
    # It runs from the scheduler's first call, which every install has (async_setup_telemetry).
    tel = _src(_CC / "telemetry.py")
    first = tel[tel.index("    async def _first("):]
    assert first.index("_addon_report.async_note_moved(hass)") < first.index("if _days_since_report(hass)")


def test_the_section_says_was_kept_moved_and_used() -> None:
    h = _hass()
    s = h.data[DOMAIN][DATA_SETTINGS].data
    s.update(_addon_key())
    s[A.SEEN_KEY] = {"licence": "free", "moved": ["power_teams", "bogus"]}
    sec = A.section(h, s, {"room_controls:mute": 1}, {}, _NOW)
    assert sec["licence"] == "addon" and sec["was"] == "free" and sec["moved"] == ["power_teams"] and sec["used"] == ["audio"]
    assert "kept" not in sec
    # An add-on key kept aside: said while a trial runs over it, and while a Pro invite's year does.
    for trial in (True, False):
        k = {**s, "forensics_license_key": "PSPAN-OVER-0000-0000-0001", "license_tier": "pro", "license_is_trial": trial,
             "license_addons_kept": _addon_key()}
        over = A.section(h, k, {}, {}, _NOW)
        assert over["kept"] is True and set(over["held"]) == {"audio", "climate"}, (trial, over)
        A.check(over)
    s[A.SEEN_KEY] = {"licence": "addon"}
    assert "was" not in A.section(h, s, {}, {}, _NOW), "said only when it changed"
    A.check(sec)


def _registry_house(monkeypatch):
    """A house with something for every add-on, every name and id in it a secret."""
    h = _hass()
    s = h.data[DOMAIN][DATA_SETTINGS].data
    s["power_teams"] = [{"name": "Jordan's lamps", "power": "light.kitchen_valance", "adaptive": True}]
    s["roomplan_import_enabled"] = True
    S = lambda eid, **attrs: SimpleNamespace(entity_id=eid, attributes=attrs)
    states = {
        "alarm_control_panel": [S("alarm_control_panel.jordans_alarm")],
        "cover": [S("cover.garage_door", device_class="garage"), S("cover.front_gate", device_class="gate"),
                  S("cover.blinds", device_class="shade")],
        "sensor": [S("sensor.attic_temp", device_class="temperature"), S("sensor.attic_hum", device_class="humidity"),
                   S("sensor.office_co2", device_class="carbon_dioxide"), S("sensor.power", device_class="power")],
        "media_player": [S(f"media_player.c4_room_{i}") for i in range(3)] + [S("media_player.den_receiver"),
                                                                              S("media_player.kitchen_sonos")],
        "vacuum": [S("vacuum.valetudo_robot")],
    }
    h.states = SimpleNamespace(get=lambda eid, default=None: default, async_all=lambda domain=None: states.get(domain, []))
    platforms = {**{f"media_player.c4_room_{i}": "control4" for i in range(3)}, "media_player.den_receiver": "denonavr",
                 "media_player.kitchen_sonos": "sonos", "vacuum.valetudo_robot": "mqtt"}
    ent = lambda eid: SimpleNamespace(platform=platforms.get(eid), device_id="d-vac" if eid.startswith("vacuum.") else None,
                                      unique_id="valetudo_48872D9DBC88_vacuum" if eid.startswith("vacuum.") else "x")
    devices = [SimpleNamespace(id="d-c4", identifiers={("control4", "000FFF001234")}, sw_version="2.10.6",
                               manufacturer="Control4", model="HC-800", name="Jordan's controller"),
               SimpleNamespace(id="d-vac", identifiers={("mqtt", "x")}, sw_version="Valetudo 2026.10.0",
                               manufacturer="Roborock", model="S5", name="Spare Bedroom Closet robot")]
    from homeassistant.helpers import device_registry as _dr, entity_registry as _er
    monkeypatch.setattr(_er, "async_get", lambda hass: SimpleNamespace(async_get=ent), raising=False)
    monkeypatch.setattr(_dr, "async_get", lambda hass: SimpleNamespace(devices={d.id: d for d in devices}), raising=False)
    from homeassistant.helpers import recorder as _rec
    monkeypatch.setattr(_rec, "get_instance", lambda hass: SimpleNamespace(keep_days=10), raising=False)
    from custom_components.padspan_ha import emergency_test
    monkeypatch.setattr(emergency_test, "resolve_members", lambda hass: {"members": ["light.emergency_1", "switch.poe_7"]})
    c4 = SimpleNamespace(entry_id="c4", title="Jordan's house", state=SimpleNamespace(value="setup_retry"),
                         options={"director_password": "hunter2"}, data={"host": "192.168.3.155", "username": "jordan@example.com"})
    entries = {"control4": [c4], "unifi_utopia": [SimpleNamespace(entry_id="u")], "unifi": [SimpleNamespace(entry_id="n")],
               "wled": [SimpleNamespace(entry_id="w1"), SimpleNamespace(entry_id="w2")],
               "esphome": [SimpleNamespace(entry_id="e1")], "bluetooth": [SimpleNamespace(entry_id="e1")]}
    h.config_entries.async_entries = lambda domain: entries.get(domain, [])
    return h


def test_the_market_from_what_the_house_has(monkeypatch) -> None:
    h = _registry_house(monkeypatch)
    env = {"power_teams": {"n": 1, "colour_bulbs_by_brand": {"hue": 6, "ikea": 2}}, "plans": {"picture": "full", "scan": "rooms", "scan_n": "1"}}
    m = A.market(h, h.data[DOMAIN][DATA_SETTINGS].data, env)
    assert m == {"alarm": 1, "garage": 1, "gate": 1, "temp": 1, "humidity": 1, "co2": 1, "emergency": 2,
                 "audio": {"control4": 3, "denon": 1}, "valetudo": True, "vacuum": 1,
                 "c4": {"entry": "setup_retry", "os": "2", "local": True}, "wifi": "utopia", "history": "7_13d",
                 "wled": 2, "teams": 1, "colour_bulbs": 8, "plans": ["picture", "scan"], "roomplan": True}
    A.check({"licence": "free", "market": m})
    # Control4 on OS 3, loaded, the core integration: no "local".
    h.config_entries.async_entries = lambda domain: [SimpleNamespace(state=SimpleNamespace(value="loaded"), options={})] \
        if domain == "control4" else []
    from homeassistant.helpers import device_registry as _dr
    monkeypatch.setattr(_dr, "async_get", lambda hass: SimpleNamespace(devices={"c": SimpleNamespace(
        id="c", identifiers={("control4", "1")}, sw_version="3.4.1.700000")}), raising=False)
    assert A.market(h, {}, {})["c4"] == {"entry": "loaded", "os": "3"}
    # The override loaded as a module counts as installed too.
    monkeypatch.setitem(sys.modules, "custom_components.control4.local_token", types.ModuleType("local_token"))
    assert A.market(h, {}, {})["c4"]["local"] is True


def test_an_empty_house_sends_almost_nothing(monkeypatch) -> None:
    h = _hass()
    from homeassistant.helpers import recorder as _rec
    monkeypatch.setattr(_rec, "get_instance", lambda hass: (_ for _ in ()).throw(KeyError("recorder")), raising=False)
    assert A.market(h, {}, {}) == {"history": "none"}


def test_the_whole_report_carries_none_of_the_houses_names_ids_keys_or_addresses(monkeypatch) -> None:
    h = _registry_house(monkeypatch)
    h.data[DOMAIN][DATA_SETTINGS].data[A.SEEN_KEY] = {"licence": "free", "moved": ["power_teams", "circadian"]}
    T.bump(h, "addon_offer:licence_card:audio")
    T.bump(h, "addon_buy:licence_card:audio")
    p = T.build_payload(h)
    T.assert_shareable(p)
    text = json.dumps(p["addons"])
    for secret in _SECRETS + ["Jordan", "hunter2", "000FFF001234", "jordan@example.com", "valetudo_48872D9DBC88", "HC-800",
                              "Roborock", "Spare Bedroom", "light.emergency_1", "media_player.", "cover.", "PSPAN-"]:
        assert secret not in text, secret
    assert p["addons"]["licence"] == "pro_year" and p["addons"]["was"] == "free"
    assert p["usage"]["addon_offer:licence_card:audio"] == 1 and p["usage"]["addon_buy:licence_card:audio"] == 1
    assert len(text) < 700, len(text)


@pytest.mark.parametrize("bad", [
    {"licence": "gold"},
    {"licence": "free", "colour": "red"},
    {"licence": "free", "held": {"audio": "soon"}},
    {"licence": "free", "held": {"radio": "gt365"}},
    {"licence": "free", "kept": False},
    {"licence": "free", "used": ["audio", "audio"]},
    {"licence": "free", "moved": ["teleport"]},
    {"licence": "free", "market": {"alarm": 100}},
    {"licence": "free", "market": {"alarm": True}},
    {"licence": "free", "market": {"audio": {"sonos": 2}}},
    {"licence": "free", "market": {"c4": {"os": "2", "entry": "loaded", "host": "192.168.3.155"}}},
    {"licence": "free", "market": {"c4": {"os": "10", "entry": "loaded"}}},
    {"licence": "free", "market": {"wifi": "eero"}},
    {"licence": "free", "market": {"name": "Jordan's house"}},
    "free",
])
def test_anything_off_the_lists_is_refused(bad) -> None:
    with pytest.raises(ValueError, match="addons"):
        A.check(bad)
    p = T.build_payload(_hass())
    p["addons"] = bad
    with pytest.raises(ValueError):
        T.assert_shareable(p)


def test_the_preview_shows_the_add_ons(monkeypatch) -> None:
    from custom_components.padspan_ha import ws_telemetry as WT

    async def _none(hass):
        return None
    for n in ("ensure_snapshot", "ensure_hw", "ensure_plan_ai"):
        monkeypatch.setattr(WT, n, _none)
    h = _hass()
    conn = MagicMock()
    _run(WT.ws_telemetry_preview.__wrapped__(h, conn, {"id": 1}) if hasattr(WT.ws_telemetry_preview, "__wrapped__")
         else WT.ws_telemetry_preview(h, conn, {"id": 1}))
    out = conn.send_result.call_args.args[1]
    assert out["payload"]["addons"]["licence"] == "pro_year" and out["problem"] == ""


def test_a_send_remembers_the_licence_word_for_the_next_reports_was(monkeypatch) -> None:
    h = _hass()

    class _Resp:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def json(self, content_type=None): return {"ok": True}

    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake.async_get_clientsession = lambda hass: SimpleNamespace(post=lambda *a, **k: _Resp())
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data[A.SEEN_KEY] = {"moved": ["lidar"]}
    assert _run(T.send_now(h, force=True))["sent"] is True
    assert st.data[A.SEEN_KEY] == {"moved": ["lidar"], "licence": "pro_year"}


# ── the funnel ───────────────────────────────────────────────────────────────

def test_every_add_on_event_the_code_sends_is_in_the_vocabulary() -> None:
    sent: set[str] = set()
    for p in _WWW.rglob("*.js"):
        if "vendor" in p.parts:
            continue
        src = _src(p)
        for place, name in re.findall(r'(?:addonOfferSeen|_addonOfferSeen)\([^,]+,\s*"(\w+)",\s*"(\w+)"\)', src):
            sent.add(f"addon_offer:{place}:{name}")
        for name in re.findall(r'addonUsedSeen\([^,]+,\s*"(\w+)"\)', src):
            sent.add(f"addon_used:{name}")
        sent.update(re.findall(r'"(addon_(?:sale_card|key|gained|buy):[a-z_0-9]+)"', src))
    for p in _CC.glob("*.py"):
        sent.update(re.findall(r'"(addon_(?:offer|key|gained|used|sale_card|buy):[a-z_0-9:]+)"', _src(p)))
    sent.discard("addon_key:")
    assert {"addon_offer:busy_times:insights", "addon_offer:locate:insights", "addon_offer:door_openers:alarm",
            "addon_offer:themes:looks", "addon_offer:showcase:looks", "addon_offer:forensics:forensics",
            "addon_offer:licence_card:audio", "addon_offer:emergency_test:alarm", "addon_used:insights", "addon_used:timetravel",
            "addon_sale_card:shown", "addon_key:entered"} <= sent | {"addon_offer:licence_card:audio"}
    off = sorted(e for e in sent if not T.event_allowed(e))
    assert not off, off
    # The licence card names each add-on it offers, and counts its click, by its name (settings.js).
    st = _src(_VIEWS / "settings.js")
    assert 'addonOfferSeen(_addonTel(ctx), "licence_card", a.name)' in st and '"addon_buy:licence_card:" + a.name' in st
    assert all(f"addon_offer:licence_card:{a}" in T.ADDON_EVENTS and f"addon_buy:licence_card:{a}" in T.ADDON_EVENTS for a in ADDONS)
    # Every word ADDON_EVENTS is built from: no key, no free text.
    assert all(re.fullmatch(r"addon_[a-z_]+:[a-z0-9_]+(:[a-z0-9_]+)?", e) for e in T.ADDON_EVENTS)


def test_advanced_smart_lighting_and_robot_vacuum_are_offered_and_counted_where_they_are_refused() -> None:
    """Each place that names Advanced smart lighting or Robot vacuum to an install without it counts the offer, and a
    place whose offer links to the site counts the link opened (ADDON_BUY_PLACES)."""
    assert T.ADDON_OFFER_PLACES["power_teams"] == T.ADDON_OFFER_PLACES["team_card"] == ("lighting",)
    assert T.ADDON_OFFER_PLACES["light_design"] == ("lighting",)
    assert T.ADDON_OFFER_PLACES["vacuum_import"] == T.ADDON_OFFER_PLACES["features"] == ("vacuum",)
    assert T.ADDON_BUY_PLACES == ("licence_card", "power_teams", "team_card", "c4local_card")
    for e in ("addon_offer:power_teams:lighting", "addon_buy:power_teams:lighting", "addon_offer:team_card:lighting",
              "addon_buy:team_card:lighting", "addon_offer:light_design:lighting", "addon_offer:vacuum_import:vacuum",
              "addon_offer:features:vacuum"):
        assert e in T.ADDON_EVENTS and T.event_allowed(e), e
    # A buy click only where the place links: never Busy Times', never Robot vacuum's.
    assert "addon_buy:busy_times:insights" not in T.ADDON_EVENTS and "addon_buy:vacuum_import:vacuum" not in T.ADDON_EVENTS
    # Where each one is drawn.
    st, lm, mp, rp = (_src(_VIEWS / f) for f in ("settings.js", "lights_map.js", "maps.js", "rough_plan.js"))
    assert 'onOffer: () => addonOfferSeen(_addonTel(ctx), "power_teams", "lighting")' in st
    assert 'onBuy: () => _addonTel(ctx)("addon_buy:power_teams:lighting")' in st
    assert 'onOffer: () => addonOfferSeen((w) => _track(hass, w), "team_card", "lighting")' in lm
    assert 'onBuy: () => _track(hass, "addon_buy:team_card:lighting")' in lm
    assert 'if (!_lit) _addonOfferSeen(_tel, "light_design", "lighting");' in mp
    assert mp.count('"vacuum_import", "vacuum")') == 2 and "opts.onVacuumOffer()" in rp
    assert 'needs: vacuumAllowed(settings) ? "" : proOrAddon("vacuum"), addon: "vacuum",' in st
    assert 'if (f.needs && f.addon) addonOfferSeen(_addonTel(ctx), "features", f.addon);' in st


def test_events_count_only_while_the_report_is_on() -> None:
    h = _hass()
    assert T.bump(h, "addon_sale_card:shown") is True
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    assert T.bump(h, "addon_sale_card:clicked") is False
    assert h.data[DOMAIN][T._DATA_COUNTERS] == {"addon_sale_card:shown": 1}
    pj = _src(_WWW / "panel.js")
    tel = pj[pj.index("  _telemetryEvent(name, extra){"):][:900]
    assert "if (!s.telemetry_enabled) { this._telemetryQueue = null; return; }" in tel


def _activation(monkeypatch, stored, answer, report_on=True):
    from tests.test_addons import _activate
    data, result, _ = _activate(monkeypatch, {"telemetry_enabled": report_on, **stored}, answer)
    return data, result


def test_a_key_entered_and_how_it_went(monkeypatch) -> None:
    from tests.test_addons import ANSWER, _St
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e) or True)
    _activation(monkeypatch, {}, ANSWER)
    assert counted == ["addon_key:entered", "addon_key:addon", "addon_gained:audio", f"addon_gained_in:{A.sale_when(time.time())}"]
    counted.clear()
    _activation(monkeypatch, _addon_key(), {"valid": True, "plan": "pro", "tier": "pro", "expires_at": "2027-11-25 00:00:00"})
    assert counted == ["addon_key:entered", "addon_key:pro_from_addon"]
    counted.clear()
    _activation(monkeypatch, {}, {"valid": True, "plan": "pro", "tier": "pro", "expires_at": "2027-11-25 00:00:00"})
    assert counted == ["addon_key:entered", "addon_key:pro"]
    for status, word in (("needs_update", "needs_update"), ("invalid", "invalid"), (None, "invalid"), ("activation_limit", "refused")):
        counted.clear()
        _activation(monkeypatch, {}, {"valid": False, "status": status, "message": "no"})
        assert counted == ["addon_key:entered", f"addon_key:{word}"], status


def test_an_add_on_added_to_the_key_is_counted_by_the_daily_check(monkeypatch) -> None:
    from tests.test_addons import KEY, _hass as _addon_hass, _wire
    from custom_components.padspan_ha.update_check import _revalidate_license
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e) or True)
    hass, st = _addon_hass({**KEY, "forensics_license_expires": "2028-11-25 10:00:00", "license_addons": ["audio"]})
    _wire(monkeypatch, {"valid": True, "plan": "addons", "tier": "free", "addons": ["audio", "looks"],
                        "addons_until": {"audio": "2028-11-25 10:00:00", "looks": "2028-12-25 10:00:00"}})
    _run(_revalidate_license(hass))
    assert counted == ["addon_gained:looks", f"addon_gained_in:{A.sale_when(time.time())}"]
    counted.clear()
    _run(_revalidate_license(hass))
    assert counted == [], "the same add-ons again: nothing gained"


def test_the_emergency_lights_test_refused_is_counted(monkeypatch) -> None:
    from custom_components.padspan_ha import emergency_test as E
    counted: list[str] = []
    monkeypatch.setattr(E, "_bump", lambda hass, e: counted.append(e))
    monkeypatch.setattr(E, "licensed", lambda hass: False)
    conn = MagicMock()
    fn = E.ws_emergency_test
    _run((fn.__wrapped__ if hasattr(fn, "__wrapped__") else fn)(SimpleNamespace(data={}), conn, {"id": 1, "on": True}))
    assert counted == ["addon_offer:emergency_test:alarm"] and conn.send_error.call_args.args[1] == E.ADDON_CODE


# ── the receiver ─────────────────────────────────────────────────────────────

def test_the_receiver_takes_the_add_ons_and_only_an_object_with_a_licence_word() -> None:
    php_path = _ROOT / "server" / "telemetry.php"
    if not php_path.exists():
        pytest.skip("no server/ in this tree")
    php = _src(php_path)
    allowed = set(re.findall(r"'([a-z_]+)'", php[php.index("$allowed = array("):].split(");")[0]))
    assert "addons" in allowed and set(T._TOP_KEYS) <= allowed
    rule = php[php.index("array_key_exists('addons', $r)"):][:400]
    assert "is_array($r['addons'])" in rule and "isset($r['addons']['licence'])" in rule
    rx = re.search(r"preg_match\('(/[^']+/)', \$r\['addons'\]\['licence'\]\)", rule).group(1)
    body = rx[1:rx.rindex("/")].replace("\\z", "\\Z")
    for w in A.LICENCE_WORDS:
        assert re.search(body, w), w
    for bad in ("", "x", "PSPAN-AAAA", "free text", "a" * 17):
        assert not re.search(body, bad), bad
