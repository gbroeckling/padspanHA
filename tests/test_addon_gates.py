# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Each paid feature asks for its own add-on (the owner, 2026-11-25).

Pro includes every add-on; an add-on unlocks only its own part; a Bright key
keeps what it had. For each install (free, free with one add-on, Bright, Pro):

  audio       the ⋯ line / Settings → Atlas → Audio, the sheet's Audio, the map's speaker
  alarm       Arm and Disarm, the emergency lights test (and its WS handlers), the door card,
              Door Openers and the relay wizard's openers and lock, linking them in the builder
  wifi        the Wi-Fi coverage tab
  climate     the ♨ Heatmap (both hosts, the Settings row)
  timetravel  Full house activity, which draws only what the install may show
  vacation    Vacation Mode and the whole-house presets (bar and scene row)
  looks       the four panel themes; Showcase, its themes, the forest and the Look presets, never placement
  forensics   recording, forensics_enabled
  insights    Busy Times and Locate, locate_self_key — "Presence insights", never the free Insights tab

Run in node: tests/js/addon_gates.mjs (editions, lights_map, settings, devices,
busy_times, locate) and tests/js/lights_panel_lifecycle.mjs (the sidebar's
alarm, emergency lights and Audio); the replay in tests/test_house_activity.py;
the emergency WS handlers in tests/test_emergency_test.py.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests import golden_settings as gs
from tests.test_settings_refusals import send

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")
ADDONS = list(licence.ADDONS)


@pytest.fixture(scope="module")
def gates() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "addon_gates.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=180)
    assert r.returncode == 0, r.stderr[-3000:] + r.stdout[-3000:]
    got = json.loads(r.stdout.strip().splitlines()[-1])
    assert got["fail"] == [], got["fail"]
    return got["out"]


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8")


# ── The rule itself ─────────────────────────────────────────────────────────


def test_each_add_on_unlocks_itself_alone_and_pro_unlocks_all(gates) -> None:
    allowed = gates["allowed"]
    assert allowed["free"] == [] and allowed["bright"] == []
    assert allowed["pro"] == ADDONS
    for name in ADDONS:
        assert allowed[name] == [name], name
    # Every refusal's price comes from editions.js ADDONS, never written out.
    assert gates["prices"]["looks"] == "$4.25 CAD" and gates["prices"]["climate"] == "$8.65 CAD" and gates["noPrice"] == ""


def test_insights_is_called_presence_insights() -> None:
    """The add-on must not clash with the free Insights tab (the owner, 2026-11-25)."""
    ed = _src("views/editions.js")
    assert '{ name: "insights", words: "Presence insights",' in ed
    assert 'insights: () => t("Presence insights"),' in _src("views/settings.js")
    site = (_ROOT / "site" / "index.html").read_text(encoding="utf-8")
    assert '<div style="font-weight:800">Presence insights <span' in site and ">Insights <span" not in site
    # The free Insights tab keeps its name.
    assert 'modeRow.appendChild(_makeModeBtn(t("Insights"), "insights"));' in _src("views/traceback.js")


# ── Looks pack: Showcase apart from placement ───────────────────────────────


def test_the_looks_pack_draws_showcase_never_placement(gates) -> None:
    host = gates["host"]
    placement = ("fitRooms", "isolux", "automorph", "scene", "ripple", "typeOverride", "placeRow", "hideUntouched")
    looks = host["looks"]
    assert looks["showcase"] and looks["presets"] and looks["theme"] == "west_coast_forest", looks
    assert looks["placed"] == 0 and not any(looks[k] for k in placement), looks
    for name in ("bright", "pro"):
        assert host[name]["showcase"] and host[name]["placed"] == 1 and all(host[name][k] for k in placement), name
    for name in ["free"] + [a for a in ADDONS if a != "looks"]:
        h = host[name]
        assert not h["showcase"] and not h["presets"] and h["placed"] == 0 and not any(h[k] for k in placement), name


def test_the_four_themes_are_the_looks_pack(gates) -> None:
    looks = gates["looks"]          # how many of Graphite, Ocean, Dusk and Day are locked
    assert looks["pro"] == 0 and looks["looks"] == 0
    for name in ["free", "bright"] + [a for a in ADDONS if a != "looks"]:
        assert looks[name] == 4, name
    panel = _src("panel.js")
    assert 'const pro = this._addon("looks");' in panel


# ── Vacation Mode & presets, Climate map: one way for every add-on in lights_map ──


def test_the_hosts_hand_lights_map_the_add_ons(gates) -> None:
    """Both hosts hand host.addons beside host.tier; every add-on gate in lights_map asks hostAddon."""
    assert "addons: this.state._addons || []," in _src("lights_panel.js")
    assert "addons: ctx.state.settings?.addons_licensed || []," in _src("views/maps.js")
    lm = _src("views/lights_map.js")
    assert ("export const hostAddon = (host, name) => addonAllowed({ tier: host && host.tier, "
            "addons_licensed: host && host.addons }, name);") in lm
    assert 'if (host.onWholeHouseApply && hostAddon(host, "vacation")) {' in lm
    assert 'const presets = hostAddon(h, "vacation") && typeof h.onWholeHouseApply === "function"' in lm
    assert 'tierAtLeast(host.tier, "pro")) {' not in lm.split("// Whole House Presets")[1][:2000]
    ha = gates["hostAddon"]
    assert ha["pro"] == ["vacation", "looks", "climate"] and ha["free"] == [] and ha["bright"] == []
    assert ha["vacation"] == ["vacation"] and ha["looks"] == ["looks"] and ha["climate"] == ["climate"]


def test_the_heatmap_is_the_climate_map(gates) -> None:
    rows = gates["atlasRows"]
    assert rows["pro"]["heatmap"] and rows["climate"]["heatmap"]
    for name in ["free", "bright"] + [a for a in ADDONS if a != "climate"]:
        assert not rows[name]["heatmap"], name
    assert 'return this._addon("climate") && !!this.state._heatmapOn;' in _src("lights_panel.js")
    assert 'return _addonAllowed(s, "climate") && s.atlas_heatmap_enabled === true;' in _src("views/maps.js")


# ── Audio on the classic layout ─────────────────────────────────────────────


def test_settings_offers_audio_where_it_is_allowed(gates) -> None:
    """The ⋯ list is Pro's display layout's: an Audio add-on on the classic layout turns Audio on in Settings → Atlas
    (house-wide, off by default). The row is there only where Audio is allowed (lights_panel_lifecycle runs it)."""
    rows = gates["atlasRows"]
    assert rows["pro"]["audio"] and rows["audio"]["audio"]
    for name in ["free", "bright"] + [a for a in ADDONS if a != "audio"]:
        assert not rows[name]["audio"], name
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["atlas_audio_enabled"] is False
    ws = (_PKG / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("atlas_audio_enabled"): bool,' in ws and '"atlas_heatmap_enabled", "atlas_audio_enabled",' in ws
    lm = _src("views/lights_map.js")
    assert ('const roomControlsOn = () => !!host.roomControls && (DISPLAY ? flatShow("room_controls") === true : '
            'host.audioOn === true);') in lm


@pytest.mark.parametrize("value", [True, False])
def test_the_audio_switch_saves(value: bool) -> None:
    got = send({"atlas_audio_enabled": value})
    assert got["error"] is None and got["data"]["atlas_audio_enabled"] is value


# ── Alarm & security ────────────────────────────────────────────────────────


def test_door_openers_and_the_relay_wizard_are_alarm_and_security(gates) -> None:
    """Marking openers and the wizard's opener and lock: Pro, the add-on or Bright; the wizard's relay light stays
    Bright or Pro (it is light placement's, not the alarm's)."""
    op = gates["openers"]
    for name in ("bright", "pro"):
        assert op[name] == {"refused": False, "relayLight": True, "opener": True, "lock": True}, name
    assert op["alarm"] == {"refused": False, "relayLight": False, "opener": True, "lock": True}
    for name in ["free"] + [a for a in ADDONS if a != "alarm"]:
        assert op[name] == {"refused": True, "relayLight": False, "opener": False, "lock": False}, name


def test_the_builder_links_openers_and_locks_and_opens_the_door_card_with_alarm_and_security() -> None:
    maps = _src("views/maps.js")
    assert 'return _isPro(ctx) || _addonAllowed(ctx.state.settings, "alarm");' in maps
    assert "const alarm = _alarmOk(ctx);" in maps
    for hook in ("onLinkDoorOpener: alarm && !preview ? async (l, openerEid) => {",
                 "onLinkDoorLock: alarm && !preview ? async (l, lockEid) => {",
                 "onBuildFromRelays: alarm && !preview ? () => {", "    barrierHit: alarm,"):
        assert hook in maps, hook
    # Every other placement and editing tool stays on light placement's own gate.
    for hook in ("onConfigureDoor: paid && !preview ? (l) => {", "onUnlinkDoor: paid && !preview ? async (l) => {",
                 "onPlaceRow: paid && !preview ? (eid) => {", "onToggleDoorSteel: paid && !preview ? async (l) => {"):
        assert hook in maps, hook
    # Without the build tools a door's wall section still opens its card (one function for both).
    assert maps.count("_openDoorCard(ctx, ") == 3          # the function and its two callers
    lp = _src("lights_panel.js")
    assert "barrierHit: this._alarmControls()," in lp


def test_what_stays_free() -> None:
    """A triggered alarm (shown with nothing to press), the red banner, locks on the map and in the room sheet, and
    Alert pulse: no add-on anywhere near them."""
    card = _src("views/alarm_panel.js")
    assert 'if (!o.controls && kind !== "triggered") return null;' in card
    shell = _src("panel.js")
    banner = shell[shell.index("  _updateEmergencyBanner(){"):shell.index("  // ── Navigation & View Routing")]
    assert "addon" not in banner.lower() and "tier" not in banner
    lm = _src("views/lights_map.js")
    for free in ("function openLockCard", "alertOpenings"):
        i = lm.find(free)
        if i >= 0:
            assert "hostAddon" not in lm[i:i + 1500] and "addonAllowed" not in lm[i:i + 1500], free
    lp = _src("lights_panel.js")
    assert "this.state._alertPulse = s.atlas_alert_pulse === true;" in lp


# ── Wi-Fi coverage, Time travel ─────────────────────────────────────────────


def test_the_wifi_tab_is_wifi_coverage() -> None:
    panel = _src("panel.js")
    assert 'if (!this.state._wifiSurveyOn || !this._addon("wifi")) out.delete("wifi");' in panel
    assert "return !!(EDITIONS && EDITIONS.addonAllowed && EDITIONS.addonAllowed(this.state.settings || {}, name));" in panel
    # The Atlas's Wi-Fi device chip (access points) is not this add-on's.
    assert "addon" not in _src("views/light_codes.js").lower()


def test_full_house_activity_is_time_travel_and_draws_what_the_install_may_show() -> None:
    tb = _src("views/traceback.js")
    assert 'const _houseOK = addonAllowed(ctx.state.settings, "timetravel");' in tb
    ha = _src("views/house_activity.js")
    assert "return lightsHostForTier({ tier: s.tier, addons: s.addons_licensed, model, ...atlasLookFromSettings(s) });" in ha
    assert "return buildIsoSVG(look.model, byRoom, hiddenOnMap," in ha


# ── Presence insights and Forensics ─────────────────────────────────────────


def test_busy_times_and_locate_are_presence_insights(gates) -> None:
    ins = gates["insights"]
    for name in ("pro", "insights"):
        assert ins[name] == {"busyGate": False, "locateGate": False}, name
    for name in ["free", "bright"] + [a for a in ADDONS if a != "insights"]:
        assert ins[name] == {"busyGate": True, "locateGate": True}, name


def _addon_key(*names: str) -> dict:
    return {"forensics_license_key": "PSPAN-TEST-0000-0000-0002", "license_tier": "free",
            "forensics_license_expires": "2099-12-31 00:00:00", "license_addons": list(names)}


_PRO_KEY = {"forensics_license_key": "PSPAN-TEST-0000-0000-0003", "license_tier": "pro",
            "forensics_license_expires": "2099-12-31 00:00:00"}
_BRIGHT_KEY = {**_PRO_KEY, "license_tier": "bright"}


@pytest.mark.parametrize("start, forensics, locate", [
    ({}, False, False),
    (_addon_key("forensics"), True, False),
    (_addon_key("insights"), False, True),
    (_addon_key("audio", "alarm", "wifi", "climate", "timetravel", "vacation", "looks"), False, False),
    (_PRO_KEY, True, True),
    (_BRIGHT_KEY, False, False),       # Bright Pro never had either
])
def test_the_backend_splits_forensics_from_locate(start: dict, forensics: bool, locate: bool) -> None:
    """ws_settings._addon_after: forensics_enabled is the Forensics add-on's, locate_self_key Presence insights'."""
    got = send({"forensics_enabled": True}, start=start)
    assert got["error"] is None and got["data"]["forensics_enabled"] is forensics
    got = send({"locate_self_key": "C0:FF:EE:00:00:01"}, start=start)
    assert got["error"] is None and (got["data"]["locate_self_key"] == "C0:FF:EE:00:00:01") is locate


def test_a_lowered_tier_judges_an_add_on_key_by_its_add_ons() -> None:
    """A tier override only lowers the tier: an add-on key keeps its add-ons, a Pro key looked at as free has none."""
    got = send({"license_tier_override": "free", "forensics_enabled": True}, start=_addon_key("forensics"))
    assert got["data"]["forensics_enabled"] is True
    got = send({"license_tier_override": "free", "forensics_enabled": True}, start=_PRO_KEY)
    assert got["data"]["forensics_enabled"] is False


def _hass(settings: dict) -> SimpleNamespace:
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(settings))}})


@pytest.mark.parametrize("key, records", [
    ({}, False), (_addon_key("forensics"), True), (_addon_key("insights"), False), (_PRO_KEY, True), (_BRIGHT_KEY, False),
])
def test_forensics_records_with_the_forensics_add_on(key: dict, records: bool) -> None:
    from custom_components.padspan_ha.forensics_store import _recording_enabled
    assert _recording_enabled(_hass({**key, "forensics_enabled": True, "data_mode": "live"})) is records


def test_the_settings_payload_says_which_add_ons() -> None:
    """The panel reads every gate off settings.addons_licensed (licence.addons_allowed), never a key."""
    assert licence.addons_allowed(_addon_key("looks", "audio"), True) == ["audio", "looks"]
    assert licence.addons_allowed(_PRO_KEY, True) == ADDONS
    assert licence.addons_allowed(_BRIGHT_KEY, True) == []
    assert licence.addons_allowed(_addon_key("looks"), False) == []        # a key that is not active: none
    assert gs.DEFAULT_SETTINGS.get("atlas_audio_enabled") is False


# ── The words ───────────────────────────────────────────────────────────────


def test_refusals_name_the_add_on_with_its_price_from_editions() -> None:
    """"PadSpan Pro or the … add-on", the price from editions.js (addonPrice / ADDONS), never hard-coded."""
    st = _src("views/settings.js")
    assert 't("PadSpan Pro or the {addon} add-on ({price})", { addon: addonWords(a), price: a.price });' in st
    for rel in ("views/busy_times.js", "views/locate.js"):
        assert 't("{feature} needs PadSpan Pro or the {addon} add-on ({price})",' in _src(rel), rel
        assert 'price: addonPrice("insights")' in _src(rel), rel
    assert '{ price: addonPrice("alarm") }' in _src("views/devices.js")
    assert '_addonPrice("looks")' in _src("views/maps.js")
    for rel in ("views/settings.js", "views/busy_times.js", "views/locate.js", "views/devices.js", "views/maps.js"):
        src = "".join(ln for ln in _src(rel).splitlines(True) if not ln.lstrip().startswith(("//", "*")))
        for a in ("$6.45", "$8.65", "$7.55", "$4.25", "$5.56"):
            assert a not in src, (rel, a)
    help_src = (_WWW / "help_content.js").read_text(encoding="utf-8")
    for tag in ("(PadSpan Pro or the Presence insights add-on)", "(PadSpan Pro or the Alarm & security add-on)",
                "(PadSpan Pro or the Climate map add-on)", "(PadSpan Pro or the Vacation Mode & presets add-on)",
                "(PadSpan Pro or the Time travel add-on)", "Audio (PadSpan Pro or the Audio add-on)"):
        assert tag in help_src, tag
