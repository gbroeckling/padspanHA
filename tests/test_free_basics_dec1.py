# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The start of December 1, 2026 (00:00 Pacific): one moment, everywhere.

From 2026-12-01T08:00:00Z (the owner, 2026-11-25):

  * the free basics are on (licence.free_basics): exact placement, the plain
    wall screen and the 3D house's basics at any tier (what moves and what
    stays Pro: tests/test_free_basics.py), and Live Aboard comes on once
    where it was never a choice;
  * Advanced map creation (maps) and the new Robot vacuum add-on (vacuum)
    go on sale (licence.ADDON_ON_SALE_FROM; editions.js on_sale_from), so
    every robot-vacuum feature, free until then, needs PadSpan Pro, the
    Robot vacuum add-on or a Bright key (vacuum_import.licensed; the panel's
    editions.js vacuumAllowed);
  * the licence card offers both, at the Black Friday half price until the
    sale ends, and at 30% off to an install that holds the other of the two,
    whichever is lower, never both (editions.js addonPriceFor, addonBuyUrl);
  * an administrator without Pro sees "The 3D house is now free" once
    (panel.js _freeHouseCard; its own flag, house3d_free_card_done).

Each switches by itself on a running install: the backend reads the clock on
every call (licence._clock; the suite's day is before the moment,
tests/conftest.py), the panel follows the backend's word with its next
settings read (settings.free_basics, settings.addons_on_sale), and the
commercial words (prices, offers) go by the panel's own clock at the same
moment. Each part is held here just before and at the moment. The site's
switch at the same moment is tests/test_site_claims.py.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha import settings_store as ss
from custom_components.padspan_ha import vacuum_import as vi
from custom_components.padspan_ha import vacuum_run as vr
from custom_components.padspan_ha import ws_vacuum as wv
from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN, FREE_BASICS_FROM_TS
from tests.test_addon_gates import gates  # noqa: F401  (the panel's gates, run under node)
from tests.test_vacuum_import import _Conn, _run

_ROOT = Path(__file__).resolve().parents[1]
_ED = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "editions.js"
_T = float(FREE_BASICS_FROM_TS)
_JUST_BEFORE = _T - 1


def _at(monkeypatch, ts: float) -> None:
    monkeypatch.setattr(licence, "_clock", lambda: ts)


_FAR = "2099-12-31 00:00:00"
INSTALLS = {
    "free": {},
    "pro": {"forensics_license_key": "PSPAN-TEST-0000-0000-0003", "license_tier": "pro", "forensics_license_expires": _FAR},
    "bright": {"forensics_license_key": "PSPAN-TEST-0000-0000-0004", "license_tier": "bright", "forensics_license_expires": _FAR},
    "vacuum": {"forensics_license_key": "PSPAN-TEST-0000-0000-0002", "license_tier": "free", "forensics_license_expires": _FAR,
               "license_addons": ["vacuum"]},
    "maps": {"forensics_license_key": "PSPAN-TEST-0000-0000-0005", "license_tier": "free", "forensics_license_expires": _FAR,
             "license_addons": ["maps"]},
    "audio": {"forensics_license_key": "PSPAN-TEST-0000-0000-0006", "license_tier": "free", "forensics_license_expires": _FAR,
              "license_addons": ["audio"]},
    "vacuum_lapsed": {"forensics_license_key": "PSPAN-TEST-0000-0000-0007", "license_tier": "free",
                      "forensics_license_expires": "2026-01-01 00:00:00", "license_addons": ["vacuum"],
                      "license_addons_until": {"vacuum": "2026-01-01 00:00:00"}},
}


def _hass(settings: dict) -> SimpleNamespace:
    h = SimpleNamespace()
    h.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"forensics_license_key": "", **settings})}}
    h.states = SimpleNamespace(get=lambda eid: None)

    async def _exec(fn, *a):
        return fn(*a)
    h.async_add_executor_job = _exec
    return h


# ═══ One moment ════════════════════════════════════════════════════════════════

def test_one_moment_in_the_backend_the_panel_and_the_add_ons() -> None:
    assert datetime.fromtimestamp(FREE_BASICS_FROM_TS, timezone.utc) == datetime(2026, 12, 1, 8, 0, tzinfo=timezone.utc)
    ed = _ED.read_text(encoding="utf-8")
    m = re.search(r'export const FREE_BASICS_FROM = "([^"]+)";', ed)
    assert m and datetime.fromisoformat(m.group(1).replace("Z", "+00:00")).timestamp() == FREE_BASICS_FROM_TS
    assert licence.ADDON_ON_SALE_FROM == {"maps": FREE_BASICS_FROM_TS, "vacuum": FREE_BASICS_FROM_TS}
    for name in ("maps", "vacuum"):
        assert re.search(r'\{ name: "%s", words: "[^"]+", price: "\$[\d.]+ CAD", on_sale_from: FREE_BASICS_FROM,' % name, ed)
    # The suite's own day is before it, whatever day it runs (tests/conftest.py).
    assert licence._clock() < _T and not licence.free_basics()


def test_the_rungs_and_the_add_ons_on_sale_switch_at_the_moment(monkeypatch) -> None:
    assert licence.free_basics(_JUST_BEFORE) is False and licence.free_basics(_T) is True
    for a in licence.ADDONS:
        assert licence.addon_on_sale(a, _JUST_BEFORE) is (a not in ("maps", "vacuum")), a
        assert licence.addon_on_sale(a, _T) is True, a
    _at(monkeypatch, _JUST_BEFORE)
    assert (licence.placement_tier(), licence.house3d_tier()) == ("bright", "pro")
    assert "maps" not in licence.addons_on_sale() and "vacuum" not in licence.addons_on_sale()
    _at(monkeypatch, _T)
    assert (licence.placement_tier(), licence.house3d_tier()) == ("free", "free")
    assert licence.addons_on_sale() == list(licence.ADDONS)


def test_a_running_install_tells_the_panel_with_its_next_settings_read(monkeypatch) -> None:
    """No restart: the same Home Assistant, read just before and at the moment."""
    h = _hass({})
    _at(monkeypatch, _JUST_BEFORE)
    before = ws._get_settings(h)
    assert "free_basics" not in before
    assert before["addons_on_sale"] == [a for a in licence.ADDONS if a not in ("maps", "vacuum")]
    _at(monkeypatch, _T)
    after = ws._get_settings(h)
    assert after["free_basics"] is True and after["addons_on_sale"] == list(licence.ADDONS)


async def _store(stored: dict | None):
    saved: dict = {}
    store = ss.SettingsStore.__new__(ss.SettingsStore)
    store.store = SimpleNamespace(async_load=AsyncMock(return_value=stored),
                                  async_save=AsyncMock(side_effect=lambda d: saved.update(d)))
    await store.async_load()
    return store, saved


async def _settings_get(store) -> dict:
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: store}}
    conn = MagicMock()
    await ws.ws_settings_get(h, conn, {"id": 1})
    return conn.send_result.call_args[0][1]["settings"]


async def test_live_aboard_comes_on_with_the_first_settings_read_from_the_moment(monkeypatch) -> None:
    """An install loaded before the moment, never restarted: its next settings read turns Live Aboard on once
    (settings_store.free_basics_3d_once), saved; a later off stays off."""
    _at(monkeypatch, _JUST_BEFORE)
    store, saved = await _store({"atlas_3d_enabled": False, "atlas_default_v1_applied": True})
    got = await _settings_get(store)
    assert got["atlas_3d_enabled"] is False and "atlas_3d_default_v1_applied" not in saved
    _at(monkeypatch, _T)
    got = await _settings_get(store)
    assert got["atlas_3d_enabled"] is True and got["free_basics"] is True
    assert saved["atlas_3d_enabled"] is True and saved["atlas_3d_default_v1_applied"] is True
    store.data["atlas_3d_enabled"] = False
    store.store.async_save.reset_mock()
    got = await _settings_get(store)
    assert got["atlas_3d_enabled"] is False and not store.store.async_save.called


# ═══ The Robot vacuum add-on: free before, gated from the moment ═══════════════

@pytest.mark.parametrize("who, before, after", [
    ("free", True, False), ("audio", True, False), ("maps", True, False), ("vacuum_lapsed", True, False),
    ("vacuum", True, True), ("pro", True, True), ("bright", True, True),
])
def test_who_has_the_robot_vacuum_before_and_from_the_moment(monkeypatch, who, before, after) -> None:
    h = _hass(INSTALLS[who])
    _at(monkeypatch, _JUST_BEFORE)
    assert vi.licensed(h) is before
    _at(monkeypatch, _T)
    assert vi.licensed(h) is after


# Every handler that uses a robot-vacuum feature, with a message that would use it.
_GATED = [
    (wv.ws_vacuum_import_preview, {"json_text": "{}"}),
    (wv.ws_vacuum_import_commit, {}),
    (wv.ws_vacuum_cal_pending_accept, {"pending_id": "x"}),
    (wv.ws_vacuum_robot_status, {}),
    (wv.ws_vacuum_robot_set, {"url": "http://robot.local"}),
    (wv.ws_vacuum_robot_control, {"action": "start"}),
    (wv.ws_vacuum_run_start, {}),
    (wv.ws_vacuum_robot_use_set, {"use": "all"}),
    (wv.ws_vacuum_robot_use_apply, {}),
    (wv.ws_vacuum_findings, {}),
    (wv.ws_robot_wifi_readings, {}),
    (wv.ws_vacuum_link_set, {"enabled": True}),
    (wv.ws_vacuum_link_set, {"walker_enabled": True, "walker_tag": "AA"}),
]


@pytest.mark.parametrize("handler, msg", _GATED, ids=[f"{h.__name__}-{i}" for i, (h, _) in enumerate(_GATED)])
def test_from_the_moment_each_robot_vacuum_feature_says_what_brings_it_back(monkeypatch, handler, msg) -> None:
    _at(monkeypatch, _T)
    conn = _Conn()
    _run(handler(_hass({}), conn, {"id": 1, **msg}))
    assert getattr(conn, "error", None) == (vi.ADDON_CODE, vi.ADDON_MESSAGE), handler.__name__
    assert vi.ADDON_CODE == "addon_required" and "Robot vacuum add-on" in vi.ADDON_MESSAGE
    assert "https://padspan.traks.ca/#addons" in vi.ADDON_MESSAGE


def test_the_gate_comes_first_in_every_gated_handler_and_never_on_stop_undo_or_off() -> None:
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_vacuum.py").read_text(encoding="utf-8")

    def body(fn) -> str:
        i = src.index(f"async def {fn.__name__}(")
        j = src.find("\n@websocket_api.websocket_command", i)
        return src[i:j if j > 0 else len(src)]
    for fn in {h for h, _ in _GATED} - {wv.ws_vacuum_link_set, wv.ws_vacuum_robot_use_apply}:
        b = re.sub(r'""".*?"""\n', "", body(fn), count=1, flags=re.S)
        assert b.split("\n")[1].strip() == "if _refused(hass, connection, msg):", fn.__name__
    # Turning the link off, unlinking, leaving or undoing an apply: never refused.
    assert ('if (msg.get("enabled") or msg.get("walker_enabled")) and not msg.get("unlink") and _refused(hass, connection, msg):'
            in body(wv.ws_vacuum_link_set))
    assert 'if not msg.get("leave") and not msg.get("undo") and _refused(hass, connection, msg):' in body(wv.ws_vacuum_robot_use_apply)
    # Reads, stopping a run, undoing one and rejecting pending points: never refused (data safety, and nothing is used).
    for fn in (wv.ws_vacuum_status, wv.ws_vacuum_cal_pending_list, wv.ws_vacuum_cal_pending_reject, wv.ws_vacuum_run_stop,
               wv.ws_vacuum_run_undo):
        assert "_refused(" not in body(fn), fn.__name__


@pytest.mark.parametrize("msg", [{"enabled": False}, {"unlink": True}, {"walker_enabled": False}])
def test_from_the_moment_the_link_still_turns_off(monkeypatch, msg) -> None:
    from tests.test_vacuum_import import _vstore
    _at(monkeypatch, _T)
    h = _hass({})
    vs = _vstore(h)
    vs.start = lambda: None
    conn = _Conn()
    _run(wv.ws_vacuum_link_set(h, conn, {"id": 1, **msg}))
    assert getattr(conn, "error", None) is None and getattr(conn, "result", None) is not None


def test_from_the_moment_nothing_runs_in_the_background_without_it(monkeypatch) -> None:
    """The 10 s tick: no spot (the robot is not drawn, flat or 3D: the snapshot has no vacuum), no walker, no Wi-Fi
    while it cleans; the link and its map stay. robot_wifi_snapshot (UniFi Utopia's read) gives none either."""
    from tests.test_vacuum_import import _vstore
    h = _hass({})
    vs = _vstore(h)
    vs.data["link"] = {"enabled": True, "map_id": "m1", "format": "valetudo", "read": "url", "to_m": [1, 0, 0, 0, 1, 0]}
    vs.live = {"x_m": 1.0, "y_m": 1.0, "ts": 0.0}
    read = AsyncMock(return_value=None)
    vs.async_read_payload = read
    _at(monkeypatch, _JUST_BEFORE)
    _run(vs.async_tick())
    assert read.called, "before the moment the tick reads the robot as always"
    assert vr.robot_wifi_snapshot(h) is not None
    read.reset_mock()
    vs.live = {"x_m": 1.0, "y_m": 1.0, "ts": 0.0}
    _at(monkeypatch, _T)
    _run(vs.async_tick())
    assert not read.called and vs.live is None
    assert vs.data["link"]["map_id"] == "m1", "the link is kept"
    assert vr.robot_wifi_snapshot(h) is None
    h.data[DOMAIN][DATA_SETTINGS].data.update(INSTALLS["vacuum"])
    assert vr.robot_wifi_snapshot(h) is not None


# ═══ The panel (run under node: tests/js/addon_gates.mjs) ══════════════════════

def test_the_panels_robot_vacuum_gate_follows_the_backends_word(gates) -> None:  # noqa: F811
    v = gates["vacuum"]
    for k, a in v["allowed"].items():
        assert a["unsaid"] and a["before"], k                 # settings not in yet, or before the moment: everyone's
        assert a["from"] is (k in ("pro", "bright", "vacuum")), k
    assert v["host"] == {"free_from": False, "free_before": True, "vacuum_from": True, "bright_from": True}
    # Settings → Features says what the import needs, only once it is gated.
    assert v["needs"]["free_from"] == ("Needs PadSpan Pro or the Robot vacuum add-on ($6.45 CAD). "
                                       "Enter a key in Settings → Features → PadSpan licence.")
    assert v["needs"]["free_before"] is None and v["needs"]["vacuum_from"] is None


def _p(price: str, normal: str, *, half: bool = False, cross: str | None = None) -> dict:
    d = {"price": price, "normal": normal, "half": half, "cross": bool(cross)}
    if cross:
        d["with"] = cross
    return d


def test_the_cross_discount_and_the_sale_never_both(gates) -> None:  # noqa: F811
    v = gates["vacuum"]
    assert v["cross"] == {"maps": "$6.05 CAD", "vacuum": "$4.51 CAD"}       # 30% off, rounded down to the cent
    p = v["price"]
    # Holding Advanced map creation, buying Robot vacuum: not offered before the moment; from it the half price
    # ($3.22) is lower than 30% off ($4.51) until the sale ends; then 30% off.
    assert p["maps"]["vacuum"] == {"before": _p("$6.45 CAD", "$6.45"), "from": _p("$3.22 CAD", "$6.45", half=True),
                                   "sale_last": _p("$3.22 CAD", "$6.45", half=True),
                                   "after_sale": _p("$4.51 CAD", "$6.45", cross="maps")}
    assert p["vacuum"]["maps"] == {"before": _p("$8.65 CAD", "$8.65"), "from": _p("$4.32 CAD", "$8.65", half=True),
                                   "sale_last": _p("$4.32 CAD", "$8.65", half=True),
                                   "after_sale": _p("$6.05 CAD", "$8.65", cross="vacuum")}
    # Anyone else pays the public price; Pro buys none; a lapsed Advanced map creation holds nothing.
    for who in ("none", "pro", "lapsed"):
        assert p[who]["vacuum"]["after_sale"] == _p("$6.45 CAD", "$6.45"), who
        assert p[who]["maps"]["after_sale"] == _p("$8.65 CAD", "$8.65"), who
    # The cross discount is only between these two.
    assert p["maps"]["audio"]["after_sale"] == _p("$6.45 CAD", "$6.45") and p["vacuum"]["audio"]["from"]["half"] is True


def test_the_licence_cards_own_link_charges_the_discounted_amount(gates) -> None:  # noqa: F811
    v = gates["vacuum"]
    from urllib.parse import parse_qs, urlsplit
    u = urlsplit(v["url"]["cross"])
    assert (u.scheme, u.netloc, u.path) == ("https", "www.paypal.com", "/cgi-bin/webscr")
    q = {k: vals[0] for k, vals in parse_qs(u.query).items()}
    # Field for field the site's #addons forms (site/index.html), at the discounted amount.
    assert q == {"cmd": "_xclick", "business": "garry@bcmail.net", "currency_code": "CAD", "no_shipping": "1",
                 "notify_url": "https://traks.ca/license/?action=ipn", "return": "https://padspan.traks.ca/?bought=1",
                 "item_name": "PadSpan add-on: Robot vacuum — 2 years", "item_number": "padspan-addon-vacuum", "amount": "4.51"}
    m = {k: vals[0] for k, vals in parse_qs(urlsplit(v["url"]["mapsCross"]).query).items()}
    assert (m["item_number"], m["amount"], m["item_name"]) == ("padspan-addon-maps", "6.05", "PadSpan add-on: Advanced map creation — 2 years")
    site = (_ROOT / "site" / "index.html").read_text(encoding="utf-8")
    for field in ("cmd", "business", "currency_code", "no_shipping", "notify_url", "return"):
        assert f'name="{field}" value="{q[field]}"' in site, field
    # At the public price (or the sale's, which the site sells too), the site.
    assert v["url"]["sale"] == v["url"]["none"] == "https://padspan.traks.ca/#addons"
    # The card after the sale, holding Advanced map creation: Robot vacuum at 30% off through its own link, with the
    # email line; nobody else is told it.
    vac = [c for c in v["card"] if c["name"] == "vacuum"]
    assert vac == [{"name": "vacuum", "href": v["url"]["cross"],
                    "text": "Robot vacuum $4.51 CAD — 30% off with Advanced map creation (normally $6.45)"}]
    assert all(c["href"] == "https://padspan.traks.ca/#addons" for c in v["card"] if c["name"] != "vacuum")
    assert v["note"] == "Pay with the email your key was sent to: the 30% off is for the key that holds the other add-on."
    assert v["plainNote"] is False


def test_the_free_house_cards_rule(gates) -> None:  # noqa: F811
    """Shown cases, the card itself and its once: tests/js/whats_new_card.mjs (section 13)."""
    assert gates["vacuum"]["card3d"] == {"before": False, "from": True, "seen": False, "unknown": False, "pro": False,
                                         "addonKey": True, "none": False}


def test_the_free_house_cards_flag_is_kept_settable_and_survives_a_restore() -> None:
    from custom_components.padspan_ha import ws_settings
    assert ss.DEFAULT_SETTINGS["house3d_free_card_done"] is False
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert "house3d_free_card_done" in keys
    assert "house3d_free_card_done" in ws_settings._EVERYONE_KEYS
    assert ss.trial_state_kept({"house3d_free_card_done": True}, {"house3d_free_card_done": False})["house3d_free_card_done"] is True
    pj = (_ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    # In the Overview's one-card-at-a-time line, after the lifetime card (which ends with lifetime).
    assert "|| this._freeHouseCard() || this._addonSaleCard() || this._aiWizardOverviewCard() || this._trialMilestoneCard(_hasPositioned);" in pj


# ═══ A stable 0.38.274 install updating ════════════════════════════════════════

_STABLE = json.loads((_ROOT / "tests" / "fixtures" / "settings_0_38_274.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("key", ["", "pro"])
async def test_a_stable_0_38_274_install_before_and_from_the_moment(monkeypatch, key) -> None:
    """Its settings file as 0.38.274 saved it (no add-ons, no card flags, Live Aboard never chosen, the robot vacuum in
    use). Before the moment nothing it has changes; from it, without a key, Live Aboard comes on once and the robot
    vacuum needs the add-on; with a Pro key, Live Aboard stays as it was and the robot vacuum is still there."""
    stored = {**_STABLE, **(INSTALLS["pro"] if key else {})}
    assert "house3d_free_card_done" not in stored and "license_addons" not in stored and stored["vacuum_import_enabled"]
    _at(monkeypatch, _JUST_BEFORE)
    store, _ = await _store(dict(stored))
    got = await _settings_get(store)
    assert got["atlas_3d_enabled"] is False and got["vacuum_import_enabled"] is True
    assert "free_basics" not in got and got["house3d_free_card_done"] is False
    assert "maps" not in got["addons_on_sale"] and "vacuum" not in got["addons_on_sale"]
    h = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: store}})
    assert vi.licensed(h) is True
    assert "atlas_3d_default_v1_applied" not in store.data, "the once-marker written before the moment"
    _at(monkeypatch, _T)
    got = await _settings_get(store)
    assert got["free_basics"] is True and got["addons_on_sale"] == list(licence.ADDONS)
    assert got["atlas_3d_enabled"] is (not key)
    assert vi.licensed(h) is bool(key)
    assert got["tier"] == ("pro" if key else "free")
