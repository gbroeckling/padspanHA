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
  maps        Advanced map creation, NOT ON SALE YET (it comes with the free 3D house): AI plan reading (the Plans
              tool, Line up plans, Rooms from plans, the rooms helper), reading a photo, a RoomPlan scan into the
              3D house, Furniture from scans: Pro or maps now; the basic LiDAR scan -> floor plan stays everyone's
              until maps is on sale; nothing offers it until then

Run in node: tests/js/addon_gates.mjs (editions, lights_map, settings, devices,
busy_times, locate) and tests/js/lights_panel_lifecycle.mjs (the sidebar's
alarm, emergency lights and Audio); the replay in tests/test_house_activity.py;
the emergency WS handlers in tests/test_emergency_test.py.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN, FREE_BASICS_FROM_TS
from tests import golden_settings as gs
from tests.test_settings_refusals import send
from tests.test_house3d_edit import disk  # noqa: F401  (the 3D house's on-disk store fixture)

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
    # Every other placement and editing tool stays on light placement's own gate (placing a row, on its own rung
    # since the free basics: tests/test_free_basics.py).
    for hook in ("onConfigureDoor: paid && !preview ? (l) => {", "onUnlinkDoor: paid && !preview ? async (l) => {",
                 "onPlaceRow: place && !preview ? (eid) => {", "onToggleDoorSteel: paid && !preview ? async (l) => {"):
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
    assert "return !!EDITIONS.addonAllowed(s, name);" in panel
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
    assert 't("PadSpan Pro or the {addon} add-on ({price})", { addon: addonWords(a), price: addonPrice(a.name) });' in st
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
                "(PadSpan Pro or the Time travel add-on)", "Audio (PadSpan Pro or the Audio add-on)",
                # The help can't read the moment (HELP is built once, at import), so the vacuum's says both sides.
                "Robot Vacuum Import (PadSpan Pro or the Robot vacuum add-on from December 1, 2026; free before then)"):
        assert tag in help_src, tag


# ── Advanced map creation (maps) and Robot vacuum: on sale from December 1 ──


def test_maps_and_vacuum_go_on_sale_at_the_moment_in_both_halves(gates) -> None:
    """editions.js on_sale_from and licence.ADDON_ON_SALE_FROM say the same moment; before it nothing offers them (the
    licence card; the site: tests/test_site_claims.py), from it the licence card does."""
    late = ("maps", "vacuum")
    assert all(a in ADDONS for a in late)
    assert licence.ADDON_ON_SALE_FROM == {"maps": FREE_BASICS_FROM_TS, "vacuum": FREE_BASICS_FROM_TS}
    for a in ADDONS:
        assert licence.addon_on_sale(a, FREE_BASICS_FROM_TS - 1) is (a not in late), a
        assert licence.addon_on_sale(a, FREE_BASICS_FROM_TS) is True, a
    assert not licence.addon_on_sale("maps") and not licence.addon_on_sale("vacuum")    # the suite's day: before
    assert gates["onSale"] == {"before": {a: a not in late for a in ADDONS}, "from": {a: True for a in ADDONS}}
    ed = _src("views/editions.js")
    for name in late:
        assert re.search(r'\{ name: "%s", words: "[^"]+", price: "\$[\d.]+ CAD", on_sale_from: FREE_BASICS_FROM,' % name, ed), name
    assert gates["offered"]["before"]["free"] == [a for a in ADDONS if a not in late]
    assert gates["offered"]["before"]["audio"] == [a for a in ADDONS if a not in ("audio", *late)]
    assert gates["offered"]["from"]["free"] == list(ADDONS)
    assert gates["offered"]["from"]["audio"] == [a for a in ADDONS if a != "audio"]


def test_the_free_floor_plan_from_a_scan_stays_free_until_maps_is_on_sale(gates) -> None:
    gate = gates["mapsGate"]
    assert all(gate["before"].values()), gate            # not on sale: everyone's, as it always was
    assert {k for k, v in gate["from"].items() if v} == {"pro", "maps"}, gate
    assert ('const roomplanOn = ctx.state.settings?.roomplan_import_enabled === true && _addonGate(ctx.state.settings, "maps");'
            in _src("views/maps.js"))


def _roomplan_floor(start: dict, on_sale: bool, monkeypatch) -> dict:
    from tests.test_roomplan_import import _B64, _hass, _rp
    if on_sale:
        monkeypatch.setattr(licence, "_clock", lambda: float(FREE_BASICS_FROM_TS))
    h = _hass(True)
    h.data[DOMAIN][DATA_SETTINGS].data.update(start)
    return _rp(h, _B64)


@pytest.mark.parametrize("start, now, later", [
    ({}, True, False),                       # free: kept until maps is on sale, then refused
    (_addon_key("audio"), True, False),      # another add-on: the same
    (_addon_key("maps"), True, True),
    (_PRO_KEY, True, True),
])
def test_the_basic_scan_import_gate(monkeypatch, start: dict, now: bool, later: bool) -> None:
    from custom_components.padspan_ha import ws_floorplan_import as WFI
    got = _roomplan_floor(start, False, monkeypatch)
    assert ("error" not in got) is now, got
    got = _roomplan_floor(start, True, monkeypatch)
    assert ("error" not in got) is later, got
    if not later:
        assert got["error"] == WFI.ROOMPLAN_ADDON_CODE and got["message"] == WFI.ROOMPLAN_ADDON_MESSAGE


@pytest.mark.parametrize("who, roomplan, sh3d", [
    ("pro", True, True), ("maps", True, False), ("audio", False, False), ("free", False, False),
])
def test_a_scan_into_the_3d_house_is_maps_a_design_file_stays_pro(disk, tmp_path, who, roomplan, sh3d) -> None:
    """A RoomPlan scan's doors, windows, furniture and stairs into the 3D house: Pro or maps. A .sh3d (a design
    program's file, not a scan) stays the 3D house's own, Pro."""
    from custom_components.padspan_ha import ws_house3d as W3
    from tests.test_house3d_edit import _on
    from tests.test_house3d_import import _preview
    from tests.test_house3d_store import _run
    from custom_components.padspan_ha import ws_house3d_import as WI

    def ask(fmt: str) -> bool:
        h, conn = _on(tmp_path, tier="free" if who == "free" else "pro")
        if who in ("maps", "audio"):
            h.data[DOMAIN][DATA_SETTINGS].data.update(license_tier="free", license_addons=[who])
        if fmt == "sh3d":
            out = _preview(h, conn)
        else:
            _run(WI.ws_house3d_import_preview(h, conn, {"id": 9, "type": "padspan_ha/house3d_import_preview",
                                                        "sh3d_base64": "e30=", "format": "roomplan"}))
            out = {"error": conn.send_error.call_args[0][1]} if conn.send_error.called else {}
        return out.get("error") != W3.OFF_CODE
    assert ask("roomplan") is roomplan and ask("sh3d") is sh3d


def test_ai_plan_reading_photos_and_scan_furniture_are_pro_or_maps(gates) -> None:
    pkg = {n: (_PKG / n).read_text(encoding="utf-8") for n in ("plan_ai.py", "ws_plan_ai.py", "ws_house3d_photo.py",
                                                             "ws_house3d.py", "ai_wizard.py")}
    assert pkg["plan_ai.py"].count('if not hass_addon_allowed(self.hass, "maps"):') == 2       # both read guards
    assert '_tier_at_least(self.hass, "pro")' not in pkg["plan_ai.py"]
    # The plan guard still needs the 3D house on (house3d_on), as before.
    assert pkg["plan_ai.py"].count("if not house3d_on(self.hass)") >= 1
    assert 'if not hass_addon_allowed(hass, "maps"):\n        connection.send_error(msg["id"], OFF_CODE, prefix + PRO_MESSAGE)' in pkg["ws_plan_ai.py"]
    assert 'and hass_addon_allowed(hass, "maps"):' in pkg["ws_plan_ai.py"] and "_tier_at_least" not in pkg["ws_plan_ai.py"]
    assert 'if not hass_addon_allowed(hass, "maps"):' in pkg["ws_house3d_photo.py"] and "_tier_at_least" not in pkg["ws_house3d_photo.py"]
    assert 'sp = scan_pieces(hass) if hass_addon_allowed(hass, "maps") else None' in pkg["ws_house3d.py"]
    assert '"maps": hass_addon_allowed(hass, "maps"),' in pkg["ai_wizard.py"]
    assert 'const scanLoad = scr && host.house3d && hostAddon(host, "maps") &&' in _src("views/lights_map.js")
    # The rooms helper (Let Claude draw your rooms): offered to Pro or maps, the trial otherwise.
    assert gates["helper"] == {"pro": "start", "maps": "start", "free": "no_pro", "trial": "trial"}, gates["helper"]


@pytest.mark.parametrize("start, allowed", [
    ({}, False), (_addon_key("maps"), True), (_addon_key("insights"), False), (_PRO_KEY, True), (_BRIGHT_KEY, False),
])
def test_the_rooms_helper_and_the_plans_read_with_pro_or_maps(start: dict, allowed: bool) -> None:
    from custom_components.padspan_ha import ai_wizard as AW
    h = _hass(start)
    assert licence.hass_addon_allowed(h, "maps") is allowed
    f = {"admin": True, "live": True, "kiosk": False, "edition": "full", "rooms": False, "room_bounds": False,
         "indoor_plans": 1, "plan_age_days": 18.0, "wizard": {}, "now": 1.8e9, "tool_used": False,
         "tier": licence.hass_tier(h), "maps": allowed, "trial_offerable": False, "plan_scaled": True}
    assert (AW.offer_reason(f, "push") == "offer") is allowed


# ── The review (2026-11-25) ─────────────────────────────────────────────────


def _maps_house(tmp_path, who: str):
    from tests.test_house3d_edit import _on
    h, conn = _on(tmp_path, tier="free" if who == "free" else "pro", admin=True)
    if who in ("maps", "audio"):
        h.data[DOMAIN][DATA_SETTINGS].data.update(license_tier="free", license_addons=[who])
    return h, conn


@pytest.mark.parametrize("who", ["pro", "maps", "audio", "free"])
def test_advanced_map_creation_saves_its_own_work_in_the_3d_house(disk, tmp_path, who) -> None:
    """A maps buyer previews a scan into the 3D house, then saves it: its pieces (origin import or photo), openings
    and photo figures save; anything else in the 3D house stays Pro's (house3d_edit _maps_edit)."""
    from custom_components.padspan_ha import ws_house3d as W
    from tests.test_house3d_edit import _DOOR, _edit
    from tests.test_house3d_pieces import _sofa
    h, conn = _maps_house(tmp_path, who)
    scan = _edit(h, conn, pieces={"fur_00000001": _sofa(id="fur_00000001", origin="import")}, openings={"door_1a2b3c4d": dict(_DOOR)})
    ok = who in ("pro", "maps")
    assert ("error" not in scan) is ok, scan
    if ok:
        assert scan["data"]["pieces"]["fur_00000001"]["origin"] == "import"
    h, conn = _maps_house(tmp_path, who)
    built = _edit(h, conn, pieces={"fur_00000002": _sofa(id="fur_00000002", origin="build")})
    assert ("error" not in built) is (who == "pro"), built
    h, conn = _maps_house(tmp_path, who)
    rooms = _edit(h, conn, rooms={"Hall": {"floor": "#ffffff"}})
    assert (rooms.get("error") == W.OFF_CODE) is (who != "pro"), rooms


def test_the_maps_edit_rule() -> None:
    from custom_components.padspan_ha.ws_house3d import _maps_edit
    data = {"pieces": {"fur_b": {"origin": "build"}, "fur_i": {"origin": "import"}}, "figures": {"person.a": {"origin": "build"}}}
    assert _maps_edit(data, {"id": 1, "type": "x", "pieces": {"fur_n": {"origin": "import"}, "fur_i": None}})
    assert _maps_edit(data, {"pieces": {"fur_p": {"origin": "photo"}}, "openings": {"d": {}}, "figures": {"person.b": {"origin": "photo"}}})
    assert not _maps_edit(data, {"pieces": {"fur_b": None}}), "a piece built by hand is Pro's to remove"
    assert not _maps_edit(data, {"pieces": {"fur_b": {"origin": "import"}}}), "nor to overwrite"
    assert not _maps_edit(data, {"figures": {"person.a": {"origin": "photo"}}})
    assert not _maps_edit(data, {"lights": {}}) and not _maps_edit(data, {"heights_set": []})


@pytest.mark.parametrize("who, furniture, whole", [("pro", True, True), ("maps", True, False), ("audio", False, False)])
def test_removing_all_furniture_is_maps_too_the_whole_house_pro(disk, tmp_path, who, furniture, whole) -> None:
    from custom_components.padspan_ha import ws_house3d as W
    from tests.test_house3d_store import _run

    def clear(only):
        h, conn = _maps_house(tmp_path, who)
        _run(W.ws_house3d_clear(h, conn, {"id": 3, **({"only": only} if only else {})}))
        return not (conn.send_error.called and conn.send_error.call_args[0][1] == W.OFF_CODE)
    assert clear("pieces") is furniture and clear(None) is whole


@pytest.mark.parametrize("who, allowed", [("pro", True), ("maps", True), ("audio", False), ("free", False)])
def test_reading_a_plans_stairs_is_ai_plan_reading(disk, tmp_path, who, allowed) -> None:
    from custom_components.padspan_ha import ws_house3d as W
    from custom_components.padspan_ha import ws_house3d_stairs as WS
    h, conn = _maps_house(tmp_path, who)
    WS._refused(h, conn, {"id": 4})
    refused_for_tier = conn.send_error.called and conn.send_error.call_args[0][1] == W.OFF_CODE
    assert refused_for_tier is not allowed


def test_an_add_on_key_is_offered_the_trial_on_every_surface() -> None:
    """The sidebar's trial card reads addon_key (trial_offer.js trialOfferable), and the rooms helper's facts follow the
    same rule (an add-on key is kept aside for the trial)."""
    assert "this.state._trialSettings = { pro_has_key: s.pro_has_key, addon_key: s.addon_key, tier: s.tier," in _src("lights_panel.js")
    aw = (_PKG / "ai_wizard.py").read_text(encoding="utf-8")
    assert ('"trial_offerable": trial_offerable(bool(str(settings.get("forensics_license_key") or "").strip())\n'
            '                                                             and not is_addon_key(settings), tier),') in aw
    from custom_components.padspan_ha import ai_wizard as AW
    addon = _addon_key("audio")
    assert licence.is_addon_key(addon)
    assert AW.trial_offerable(bool(addon["forensics_license_key"]) and not licence.is_addon_key(addon), licence.key_tier(addon))
    assert not AW.trial_offerable(bool(_PRO_KEY["forensics_license_key"]) and not licence.is_addon_key(_PRO_KEY), "free")


def test_pro_keeps_its_add_ons_when_editions_fails_to_load(tmp_path) -> None:
    """panel.js _addon and devices.js fall back to the tier, so a Pro house keeps Day, the themes, the Wi-Fi tab and
    Door Openers if editions.js can't load; nobody else gets anything from the fallback."""
    panel = _src("panel.js")
    assert 'if (!(EDITIONS && EDITIONS.addonAllowed)) return String(s.tier || "").toLowerCase() === "pro";' in panel
    if _NODE is None:
        pytest.skip("node is not installed")
    for name in ("devices.js", "device_name.js", "i18n.js"):          # no editions.js beside it
        shutil.copy(_VIEWS / name, tmp_path / ("devices.mjs" if name == "devices.js" else name))
    shutil.copy(_ROOT / "tests" / "js" / "dom_shim.mjs", tmp_path / "dom_shim.mjs")
    (tmp_path / "run.mjs").write_text("""
import { install } from './dom_shim.mjs';
install(globalThis);
const D = await import('./devices.mjs');
const el = (tag, attrs = {}, children = []) => { const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && !k.startsWith("on")) n.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c != null) n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  return n; };
const out = {};
for (const tier of ["pro", "free"]) {
  const ctx = { helpers: { el }, state: { settings: { tier }, _devicesTab: "openers" }, hass: { states: {} },
    actions: { renderRooms: () => {} }, toast: () => {} };
  out[tier] = (D.render(ctx).textContent || "").includes("Door Openers needs PadSpan Pro");
}
console.log(JSON.stringify(out));
""", encoding="utf-8")
    r = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    assert json.loads(r.stdout.strip().splitlines()[-1]) == {"pro": False, "free": True}
