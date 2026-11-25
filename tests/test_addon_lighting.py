# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Advanced smart lighting, the eleventh add-on (the owner, 2026-11-25).

$8.65 CAD, one payment for 2 years, on sale; PadSpan Pro includes it and a
Bright key keeps what it had (licence.hass_addon_or_bright; lights_map.js
designUnlocked). It unlocks:

  the light design tools   WLED's Advanced tab and Exact look (ws_wled._licensed), the W- and P-series strips and the
                           fixture shapes (gatherLights), the type override, Automorph, Scene, Ripple, Light spread,
                           Fit room and Hide untouched (lightsHostForTier). Light placement stays Bright or Pro.
  power teams              making, changing and removing one (power_teams_set), and their day, Sleep and wake-up.
                           A team already made keeps working without it as one light (on, off, dimming, its power,
                           each bulb, Try again), with no curve, no Sleep and no wake-up; lost mid wake-up or bedtime,
                           the lights stay as they are, and the day comes back by itself with the licence.

And an add-on key is told by its plan ("addons", license_plan), so one whose add-ons are all new to this PadSpan is
never read as Pro; the server's needs_update answer is said on the licence card and revokes nothing.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha import power_team as P
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_addons import KEY, _activate, _wire
from tests.test_power_team import BCFG, CFG, House

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_VIEWS = _PKG / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")
run = asyncio.run

_EXP = "2099-12-31 00:00:00"
_PRO = {"forensics_license_key": "PSPAN-TEST-0000-0000-0005", "license_tier": "pro", "forensics_license_expires": _EXP}
_BRIGHT = {**_PRO, "license_tier": "bright"}


def _addon_key(*names: str) -> dict:
    return {"forensics_license_key": "PSPAN-TEST-0000-0000-0006", "license_tier": "free", "license_plan": "addons",
            "forensics_license_expires": _EXP, "license_addons": list(names)}


def _hass(settings: dict) -> SimpleNamespace:
    st = SimpleNamespace(data=dict(settings), async_set=AsyncMock())
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}})


WHO = [({}, False), (_addon_key("looks"), False), (_addon_key("lighting"), True), (_PRO, True), (_BRIGHT, True)]


@pytest.mark.parametrize("key, allowed", WHO, ids=["free", "free+looks", "free+lighting", "pro", "bright"])
def test_who_has_advanced_smart_lighting(key: dict, allowed: bool) -> None:
    from custom_components.padspan_ha import ws_wled as W
    h = _hass(key)
    assert licence.hass_addon_or_bright(h, "lighting") is allowed
    assert W._licensed(h) is allowed                                    # WLED's Advanced tab and Exact look
    assert "lighting" in licence.ADDONS and licence.addon_on_sale("lighting")


@pytest.fixture(scope="module")
def gates() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "addon_gates.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=180)
    assert r.returncode == 0, r.stderr[-3000:]
    got = json.loads(r.stdout.strip().splitlines()[-1])
    assert got["fail"] == [], got["fail"]
    return got["out"]


def test_the_light_design_tools_are_bright_pro_or_the_add_on(gates) -> None:
    others = [a for a in licence.ADDONS if a != "lighting"]
    assert gates["designTier"] == [True, True, False, False]
    for name, want in [("free", False), ("bright", True), ("pro", True), ("lighting", True)] + [(a, False) for a in others]:
        assert gates["design"][name] is want, name
        assert gates["wled"][name] is want, name
        assert gates["gather"][name] == ({"strip": True, "shape": "pendant"} if want else {"strip": False, "shape": "hex"}), name


def test_placement_stays_apart_from_the_design_tools(gates) -> None:
    """With Advanced smart lighting alone: the tools (and Showcase as their stage, Classic, no Look presets), never a
    placed light or the placement queue."""
    light = gates["host"]["lighting"]
    assert light["placed"] == 0 and not light["placeRow"]
    for k in ("fitRooms", "isolux", "automorph", "scene", "ripple", "typeOverride", "hideUntouched"):
        assert light[k], k
    assert light["showcase"] and light["theme"] == "classic" and not light["presets"]
    lm = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    assert "if (api && api.wled && designUnlocked(api.wled)) {" in lm
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert 'const typeOk = proTier || _addonAllowed(ctx.state.settings, "lighting");' in maps
    assert "onTypeOverride: typeOk ? async (eid, kind) => {" in maps
    # The builder: Advanced smart lighting alone opens a light's inspector from the list, with its Shape; its size,
    # angle and spot stay placement's (no entry without it).
    assert 'const design = paid || _addonAllowed(ctx.state.settings, "lighting");' in maps
    assert "const sel = design && !preview ? mapState._selLight : null;" in maps
    assert "const entry = !paid ? null : (mapState._lightsDraftM || {})[sel.eid]" in maps
    assert maps.count("if (!design) { toggle(l.entity_id); return; }") == 2
    # The type override: Pro or the add-on, in the builder, the sidebar and the drawing; never Bright alone.
    assert gates["typeOverride"] == {**{k: None for k in gates["typeOverride"]}, "pro": "plain", "lighting": "plain"}
    lp = (_PKG / "www" / "padspan-ha" / "lights_panel.js").read_text(encoding="utf-8")
    assert 'onTypeOverride: this._addon("lighting") ? async (eid, kind) => {' in lp
    # Placement's own gate is untouched: Bright or Pro (maps.js _isPro, the backend's fabric light position).
    assert 'return t === "bright" || t === "pro";' in maps
    fabric = (_PKG / "ws_fabric.py").read_text(encoding="utf-8")
    assert fabric.count('if not _tier_at_least(hass, "bright"):') >= 3


# ── power teams without the add-on ──────────────────────────────────────────


def _house(lic: list) -> House:
    h = House(boot=0.0)
    h.io.licensed = lambda: lic[0]
    return h


def test_without_it_a_team_is_one_light_and_follows_nothing() -> None:
    lic = [False]
    h = _house(lic)
    t = P.Team(dict(CFG), h.io)
    assert not t.adaptive and t.effect is None and not t.licensed
    run(t.turn_on())
    sends = [d for _, s, d in h.to("light.b1") if s == "turn_on"]
    assert sends and all(d == {"brightness": 255, "color_temp_kelvin": 2700} for d in sends), "its own light, not the day's"
    h.calls.clear()
    h.now_target = {"brightness": 90, "kelvin": 2500}
    h.t += 300
    run(t.tick())
    assert h.to("light.b1") == [], "the day moves nothing"
    run(t.turn_on(brightness=100))                                       # dimming, by hand, works
    assert [d for _, s, d in h.to("light.b1") if s == "turn_on"][-1]["brightness"] == 100
    run(t.turn_on(effect=P.EFFECT_SLEEP))
    assert not t.sleep and t.effect is None, "no Sleep"
    assert run(t.go_to_sleep(30)) is False, "no bedtime"
    run(t.turn_off())
    assert not t.is_on and h.states["light.dimmer"].state == "off"       # the power is cut, as ever
    h.calls.clear()
    assert run(t.wake()) is False and h.calls == [], "no wake-up"
    run(t.turn_on())                                                     # Try again / on: as it last was
    assert t.is_on and t.phase == "ready"


def test_the_licence_going_mid_wake_up_leaves_the_lights_steady_and_the_day_comes_back_with_it() -> None:
    lic = [True]
    h = _house(lic)
    cfg = {**BCFG, "wake": {"on": True, "time": "06:30", "days": list(range(7)), "minutes": 20, "brightness": 80,
                            "kelvin": 4200, "back_after": 60}}
    t = P.Team(cfg, h.io)
    run(t.turn_on())
    run(t.turn_off())
    assert run(t.wake()) is True and t.waking and t.fading
    h.calls.clear()
    h.t += 300
    lic[0] = False
    run(t.tick())
    assert not t.waking and not t.manual and t.is_on and h.calls == [], "steady: nothing more is sent, nothing stuck waking"
    h.t += 3 * 3600
    run(t.tick())
    assert t.is_on and h.calls == [], "no hand-back to the day and no off, hours later"
    lic[0] = True
    run(t.tick())
    sends = [d for _, s, d in h.to("light.b1") if s == "turn_on"]
    assert sends and sends[-1]["brightness"] == 200 and sends[-1]["color_temp_kelvin"] == 4000, "the day leads again by itself"


def test_the_licence_going_mid_bedtime_never_turns_the_team_off() -> None:
    lic = [True]
    h = _house(lic)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    assert run(t.go_to_sleep(30, "off")) is True
    h.calls.clear()
    h.t += 600
    lic[0] = False
    run(t.tick())
    assert not t.sleep and t.effect is None
    h.t += 3600
    run(t.tick())
    assert t.is_on and h.calls == []


def test_its_light_offers_the_day_and_sleep_only_with_it_and_says_so_when_it_changes() -> None:
    lic = [True]
    h = _house(lic)
    t = P.Team(dict(CFG), h.io)
    run(t.tick())
    seen = h.changes
    assert t.adaptive
    lic[0] = False
    run(t.tick())
    assert not t.adaptive and h.changes > seen, "its light is written: Adaptive and Sleep leave its effects"
    light = (_PKG / "light.py").read_text(encoding="utf-8")
    assert "return [EFFECT_ADAPTIVE, EFFECT_SLEEP] if t and t.adaptive else None" in light
    src = (_PKG / "power_team.py").read_text(encoding="utf-8")
    assert 'due = wake_due(t.cfg.get("wake") or {}, local) if t.licensed else None' in src, "no wake-up is even due"
    assert 'bed = bedtime_due(t.cfg.get("bedtime") or {}, local) if t.adaptive else None' in src


def _cmds() -> tuple:
    get, set_, sleep = P._ws_commands()
    return get, set_, sleep


def _conn() -> MagicMock:
    c = MagicMock()
    c.user = SimpleNamespace(is_admin=True)
    return c


@pytest.mark.parametrize("key, allowed", WHO, ids=["free", "free+looks", "free+lighting", "pro", "bright"])
def test_making_and_changing_a_team_is_the_add_ons(key: dict, allowed: bool, monkeypatch) -> None:
    """power_teams_set refuses without it (the teams already made stay as they are); its view says so."""
    monkeypatch.setattr(P, "async_setup_power_teams", lambda hass: None)   # the running teams: Home Assistant's
    _get, set_, _sleep = _cmds()
    teams = [{"id": "t1", "name": "Bedroom", "power": "light.dimmer", "bulbs": ["light.b1"]}]
    h = _hass({**key, "power_teams": teams})
    conn = _conn()
    run(set_(h, conn, {"id": 1, "type": "padspan_ha/power_teams_set", "teams": []}))
    st = h.data[DOMAIN][DATA_SETTINGS]
    if allowed:
        assert not conn.send_error.called and st.async_set.await_args.kwargs == {"power_teams": []}
        assert conn.send_result.call_args.args[1]["lighting"] is True
    else:
        assert conn.send_error.call_args.args[1:] == (P.LIGHTING_CODE, P.TEAMS_MESSAGE)
        assert not st.async_set.await_count and st.data["power_teams"] == teams


def test_sleep_in_30_min_is_the_add_ons() -> None:
    _get, _set, sleep = _cmds()
    lic = [False]
    h0 = _house(lic)
    t = P.Team(dict(BCFG), h0.io)
    run(t.turn_on())
    h = _hass({})
    h.data[DOMAIN]["power_team_manager"] = SimpleNamespace(lights={"t1": "light.bedroom"}, teams={"t1": t})
    conn = _conn()
    run(sleep(h, conn, {"id": 2, "entity_id": "light.bedroom", "minutes": 30, "end": "off"}))
    assert conn.send_error.call_args.args[1:] == (P.LIGHTING_CODE, P.LIGHTING_MESSAGE)


@pytest.fixture(scope="module")
def views() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "power_team_lighting.mjs"), str(_VIEWS)],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-3000:]
    got = json.loads(r.stdout.strip().splitlines()[-1])
    assert got["fail"] == [], got["fail"]
    return got["out"]


def test_settings_shows_a_team_already_made_and_offers_the_add_on_without_it(views) -> None:
    s = views["settings_without"]
    assert s["save"] == s["add"] == s["remove"] == s["inputs"] == 0, "nothing to make, change or remove"
    assert s["locked"] == 1 and s["offer"] == 1 and s["named"] and s["price"] and s["keeps"]
    w = views["settings_with"]
    assert w["save"] == 1 and w["add"] == 1 and w["remove"] == 1 and w["inputs"] > 0 and w["locked"] == w["offer"] == 0


def test_the_card_keeps_manual_control_and_offers_the_add_on_without_it(views) -> None:
    c = views["card_without"]
    assert c["folds"] == [] and c["locked"] == 1 and c["price"] and c["keeps"], "no wake-up, bedtime, night or curve to set"
    assert c["offer"] == 1 and c["effects"] == 0 and c["sleepNow"] == 0, "the add-on offered; no Follow the day or Sleep"
    assert c["manual"] == ["Cut power", "Hue 1"], "the power and each bulb stay"
    w = views["card_with"]
    assert w["folds"] == ["wake", "bedtime", "night", "advanced"] and w["locked"] == w["offer"] == 0
    assert w["effects"] == 2 and w["sleepNow"] == 1 and w["manual"] == ["Cut power", "Hue 1"]


# ── an add-on key, told by its plan ─────────────────────────────────────────


def test_an_add_on_key_is_told_by_its_plan_even_with_add_ons_new_to_this_padspan() -> None:
    newer = {"forensics_license_key": "PSPAN-TEST-0000-0000-0007", "license_tier": "free", "license_plan": "addons",
             "forensics_license_expires": _EXP, "license_addons": [], "license_addons_until": {}}
    assert licence.is_addon_key(newer) and licence.key_tier(newer) == "free"
    assert licence.key_tier({**newer, "license_tier": ""}) == "free", "never Pro, whatever else is stored"
    assert not licence.is_addon_key(_PRO) and licence.key_tier({**_PRO, "license_tier": ""}) == "pro"
    assert "license_plan" in licence.ADDON_KEY_FIELDS
    # A key stored before the plan was kept, whose answer named the plan but no add-on (both lists empty): tier free,
    # so an add-on key, never Pro (the card's "PadSpan Pro licensed", the trial hidden).
    bare = {"forensics_license_key": "PSPAN-TEST-0000-0000-0008", "license_tier": "free", "forensics_license_expires": _EXP,
            "license_addons": [], "license_addons_until": {}}
    assert licence.key_tier(bare) == "free" and licence.is_addon_key(bare)
    from custom_components.padspan_ha.ws_common import _get_settings
    out = _get_settings(SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(bare))}}))
    assert out["addon_key"] is True and out["pro_has_key"] is True and out["tier"] == "free"


def test_activation_and_the_daily_check_keep_the_plan(monkeypatch) -> None:
    answer = {"valid": True, "status": "active", "plan": "addons", "tier": "free", "addons": [], "addons_until": {},
              "expires_at": "2028-11-25 10:00:00", "days_left": 730, "homes_max": 3, "token": "t" * 32, "homes_used": 1}
    data, result, _sent = _activate(monkeypatch, {}, answer)
    assert result["ok"] is True and data["license_plan"] == "addons" and data["license_tier"] == "free"
    assert licence.is_addon_key(data)
    from custom_components.padspan_ha.update_check import _revalidate_license
    from tests.test_addons import _hass as _h
    hass, st = _h({**KEY, "forensics_license_expires": "2028-11-25 10:00:00"})
    _wire(monkeypatch, {**answer, "addons": ["audio"]})
    run(_revalidate_license(hass))
    assert st.data["license_plan"] == "addons"


def test_needs_update_is_said_and_revokes_nothing(monkeypatch, gates) -> None:
    """The server's answer to an add-on key whose add-ons are all unknown to this PadSpan: at activation nothing is
    stored; on the daily check the key stays as it was (never Pro, never expired) and the card says to update."""
    refused = {"valid": False, "status": "needs_update", "message": "This add-on needs a newer PadSpan — update PadSpan."}
    data, result, _sent = _activate(monkeypatch, {}, refused)
    assert result["ok"] is False and result["status"] == "needs_update" and "forensics_license_key" not in data
    from custom_components.padspan_ha.update_check import _revalidate_license
    from tests.test_addons import _hass as _h
    stored = {**KEY, "forensics_license_expires": "2028-11-25 10:00:00", "license_plan": "addons"}
    hass, st = _h(stored)
    _wire(monkeypatch, refused)
    run(_revalidate_license(hass))
    assert st.data["license_home_status"] == "needs_update"
    assert st.data["forensics_license_expires"] == "2028-11-25 10:00:00" and st.data["license_tier"] == "free"
    assert gates["needsUpdate"] == {"said": True, "pro": False}
    st_js = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    assert 'r.status === "needs_update" ? NEEDS_UPDATE()' in st_js


def test_needs_update_in_a_valid_answer_keeps_the_key_as_an_add_on_key_never_pro(monkeypatch) -> None:
    """A valid answer saying needs_update and nothing else (no plan, tier or add-on this PadSpan knows): the key is
    kept as an add-on key, said on the licence card, at activation and on the daily check alike; never Pro."""
    answer = {"valid": True, "status": "needs_update", "addons": [], "expires_at": "2028-11-25 10:00:00", "days_left": 730}
    assert licence.answer_tier(answer) == "free"
    data, result, _sent = _activate(monkeypatch, {}, answer)
    assert result["ok"] is True and result["status"] == "needs_update"
    assert data["license_tier"] == "free" and data["license_home_status"] == "needs_update"
    assert licence.is_addon_key(data) and licence.key_tier(data) == "free"
    assert not data.get("forensics_enabled"), "nothing Pro turned on"
    from custom_components.padspan_ha.update_check import _revalidate_license
    from tests.test_addons import _hass as _h
    hass, st = _h({**KEY, "license_tier": "", "license_addons": [], "forensics_license_expires": "2028-11-25 10:00:00"})
    _wire(monkeypatch, answer)
    run(_revalidate_license(hass))
    assert st.data["license_home_status"] == "needs_update" and st.data["license_tier"] == "free"
    assert licence.is_addon_key(st.data) and licence.key_tier(st.data) == "free"
    # Once the server knows this PadSpan can read them (an update), the next valid answer clears it.
    _wire(monkeypatch, {**answer, "status": "active", "plan": "addons", "tier": "free", "addons": ["lighting"]})
    run(_revalidate_license(hass))
    assert st.data["license_home_status"] == "" and st.data["license_addons"] == ["lighting"]


def test_a_key_of_add_ons_this_padspan_does_not_know_reads_as_add_ons_with_the_trial_offered(gates) -> None:
    """Told by its plan alone (no status): the card names no Pro, asks for the update, offers Pro and the trial."""
    assert gates["unknownAddons"] == {"said": True, "pro": False, "buyPro": True, "trial": True}
