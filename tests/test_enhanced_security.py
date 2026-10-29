# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Enhanced security: one switch, off by default, admin-only.

Off, every command behaves exactly as it did before the switch existed. On,
a command that changes the home's shared setup or state answers a non-admin
with a polite refusal; reading, everyday use (lights, the emergency test,
Follow's Test button) and a person's own view settings stay open. The radio
Assign button (Overview -> Bluetooth radios) is open to everyone either way:
the owner's standing rule.

Every padspan_ha/* command is classified below, so a new one cannot ship
without someone deciding which side of the switch it is on.
"""

from __future__ import annotations

import ast
import asyncio
import importlib
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import ws_common as C
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_telemetry import _hass

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"

# Shared setup or state: refused to a non-admin while the switch is on.
GATED = {
    "websocket": "model_update room_height_set lost_and_found_forget suspend_databases unsuspend_databases logs_get",
    "ws_adaptive": "adaptive_reset",
    "ws_calibration": "calibration_save_point calibration_delete_point calibration_compute_model "
                      "calibration_retrain_rf calibration_swap_radio calibration_relearn_radio "
                      "calibration_room_walk_save calibration_room_walk_remove",
    "ws_companion": "companion_follow companion_unfollow",
    "ws_devices": "device_registry_migrate device_registry_merge device_registry_label_set "
                  "device_registry_add_identity device_registry_delete",
    "ws_fabric": "fabric_scanner_remove fabric_light_position_set fabric_light_height_set fabric_light_remove "
                 "fabric_beacon_position_set fabric_beacon_height_set fabric_beacon_remove fabric_room_add "
                 "fabric_room_remove fabric_sync_mode_set fabric_scanner_position_set fabric_scanner_z_set "
                 "fabric_floor_elevations_set fabric_correct_room fabric_rooms_reconcile fabric_rf_barrier_set "
                 "fabric_rf_barrier_remove fabric_resync",
    "ws_follow": "follow_alert_save follow_alert_delete room_tag_purge_missing",
    "ws_guests": "guests_get",      # guest tags (0.38.178): names of guests; the rest is admin only
    "ws_house3d": "house3d_edit",
    "ws_house3d_library": "house3d_library_report house3d_library_share house3d_terms_accept",
    "ws_house3d_photo": "house3d_from_photo",
    "ws_house3d_stairs": "house3d_stairs_plans house3d_stairs_read",
    "ws_maps": "maps_update",
    "ws_objects": "object_label_set object_label_delete findmy_unlink objects_clear_history",
    "ws_occupancy": "occupancy_train",
    "ws_radios": "scanner_offset_set radio_lost_set radio_disabled_set",
}
# settings_set is gated per key (every key but _EVERYONE_KEYS), tested below.
PER_KEY = {"settings_set"}
# Reads: never gated.
READ = set("""
status version model_get movement_history_get lost_and_found_get traceback_get traceback_objects insights_get
vacation_log_get tags_status wled_exact_list wled_look_get adaptive_status_get adaptive_fingerprints_get
bright_import_status calibration_health_check calibration_get calibration_beacon_profiles companion_discover
calibration_room_walk_preview
device_registry_list auto_diagnostics positioning_diag propagation_health system_critics ha_entities_audit
fabric_truth_candidates fabric_health room_tags follow_alert_get forensics_stats house3d_get
house3d_import_preview house3d_library_search house3d_library_get private_ble_status irk_validate
irk_auto_detect maps_list maps_image_urls notify_services_list object_label_list occupancy_estimate
radio_audit settings_get subzones_list telemetry_preview live_snapshot motion_reconnects emergency_status
wled_devices wled_get wled_state wled_backups wled_teams_get vendor_lookup
setup_tips
""".split())
# Everyday use, open to everyone as Home Assistant's own controls are.
EVERYDAY = {"emergency_test", "emergency_force_off", "emergency_member", "flood_reset", "wled_power",
            "wled_identify", "wled_live", "notify_test", "telemetry_event",
            "radio_area_set"}    # the owner's standing rule: Assign stays open to non-admins


def _commands() -> dict[str, tuple[str, bool, bool]]:
    """command -> (module, require_admin, admin_if_enhanced_security), from the source."""
    out = {}
    for f in sorted(_CC.glob("*.py")):
        tree = ast.parse(f.read_text(encoding="utf-8"))
        for node in tree.body:
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            src = [ast.unparse(d) for d in node.decorator_list]
            m = next((re.search(r"'padspan_ha/([a-z0-9_]+)'", s) for s in src if "websocket_command" in s), None)
            if m:
                out[m.group(1)] = (f.stem, any("require_admin" in s for s in src),
                                   any(s == "admin_if_enhanced_security" for s in src))
    return out


def _gated() -> dict[str, str]:
    return {c: mod for mod, names in GATED.items() for c in names.split()}


def test_every_command_is_on_one_side_of_the_switch():
    cmds = _commands()
    assert len(cmds) > 150, "the scan found too few commands to mean anything"
    gated = _gated()
    open_ = {c for c, (_m, adm, _g) in cmds.items() if not adm}
    sides = [set(gated), PER_KEY, READ, EVERYDAY]
    assert sum(len(s) for s in sides) == len(set().union(*sides)), "a command is listed twice"
    unclassified = sorted(open_ - set().union(*sides))
    assert not unclassified, f"commands any user can call, not yet classified here: {unclassified}"


def test_exactly_the_shared_setup_commands_carry_the_switch():
    cmds = _commands()
    for c, mod in _gated().items():
        assert c in cmds and cmds[c][0] == mod, f"{c} is not in {mod}.py"
        assert cmds[c][2], f"{c} changes shared setup but is not behind Enhanced security"
    for c, (_m, _adm, g) in cmds.items():
        if g:
            assert c in _gated(), f"{c} carries the switch but is not listed as gated"


def test_the_radio_area_assign_stays_open_with_the_switch_on():
    assert _commands()["radio_area_set"][1:] == (False, False)


# ── the helper ───────────────────────────────────────────────────────────────

def _house(on):
    h = _hass()
    if on is not None:
        h.data[DOMAIN][DATA_SETTINGS].data["enhanced_security"] = on
    return h


def _conn(admin):
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=admin)
    return conn


def _run(coro):
    return asyncio.run(coro)


def test_it_is_off_by_default():
    assert DEFAULT_SETTINGS["enhanced_security"] is False
    assert C.enhanced_security_on(_house(None)) is False


@pytest.mark.parametrize("on,admin,goes", [(False, False, True), (False, True, True),
                                           (True, True, True), (True, False, False)])
def test_the_helper(on, admin, goes):
    conn = _conn(admin)
    assert C.require_admin_if_enhanced(_house(on), conn, {"id": 7}) is goes
    if goes:
        conn.send_error.assert_not_called()
    else:
        conn.send_error.assert_called_once_with(
            7, "admin_only", "Only an admin can change this while Enhanced security is on")


def test_a_house_with_no_settings_yet_is_off():
    assert C.enhanced_security_on(MagicMock()) is False


@pytest.mark.parametrize("cmd", sorted(_gated()))
def test_a_gated_command_refuses_a_non_admin_when_on(cmd):
    mod = importlib.import_module(f"custom_components.padspan_ha.{_gated()[cmd]}")
    handler = getattr(mod, f"ws_{cmd}")
    assert getattr(handler, "enhanced_security_gated", False) and handler.__wrapped__ is not None
    conn = _conn(False)
    _run(handler(_house(True), conn, {"id": 1}))
    assert conn.send_error.call_args.args[1] == "admin_only"
    conn.send_result.assert_not_called()
    # The same wrapper, off or for an admin: the command itself runs, untouched.
    inner = AsyncMock()
    gated = C.admin_if_enhanced_security(inner)
    for on, admin in ((False, False), (None, False), (True, True)):
        inner.reset_mock()
        c, h = _conn(admin), _house(on)
        _run(gated(h, c, {"id": 2, "x": 1}))
        inner.assert_awaited_once_with(h, c, {"id": 2, "x": 1})
        c.send_error.assert_not_called()


def test_off_a_non_admin_still_suspends_learning_as_before():
    from custom_components.padspan_ha import websocket as W
    for on in (None, False):
        h, conn = _house(on), _conn(False)
        coord = MagicMock()
        h.data[DOMAIN]["presence_coordinator"] = coord
        _run(W.ws_suspend_databases(h, conn, {"id": 1, "minutes": 30}))
        coord.suspend_databases.assert_called_once_with(30)
        assert conn.send_result.call_args.args[1] == {"ok": True, "minutes": 30, "suspended": True}


def test_on_a_non_admin_cannot_suspend_learning_and_nothing_happens():
    from custom_components.padspan_ha import websocket as W
    h, conn = _house(True), _conn(False)
    coord = MagicMock()
    h.data[DOMAIN]["presence_coordinator"] = coord
    _run(W.ws_suspend_databases(h, conn, {"id": 1, "minutes": 30}))
    coord.suspend_databases.assert_not_called()


# ── settings_set ─────────────────────────────────────────────────────────────

def _set(on, admin, **keys):
    h, conn = _house(on), _conn(admin)
    _run(WS.ws_settings_set(h, conn, {"id": 1, **keys}))
    return h.data[DOMAIN][DATA_SETTINGS].data, conn


@pytest.mark.parametrize("key,value", [("update_check_enabled", False), ("vendor_lookup_enabled", False),
                                       ("room_change_delay_s", 12.0), ("data_mode", "sample")])
def test_settings_off_a_non_admin_saves_as_before(key, value):
    data, conn = _set(False, False, **{key: value})
    conn.send_error.assert_not_called()
    assert data[key] == value


@pytest.mark.parametrize("key,value", [("update_check_enabled", False), ("vendor_lookup_enabled", False),
                                       ("room_change_delay_s", 12.0)])
def test_settings_on_a_non_admin_cannot_change_the_homes_setup(key, value):
    data, conn = _set(True, False, **{key: value})
    assert conn.send_error.call_args.args[1] == "admin_only"
    assert data.get(key) != value


def test_settings_on_a_mixed_message_from_a_non_admin_changes_nothing():
    data, conn = _set(True, False, light_theme=True, vendor_lookup_enabled=False)
    assert conn.send_error.call_args.args[1] == "admin_only"
    assert "light_theme" not in data and data.get("vendor_lookup_enabled") is not False


@pytest.mark.parametrize("key,value", [("light_theme", True), ("whatsnew_seen_version", "0.38.164"),
                                       ("followed_addrs", ["AA:BB:CC:DD:EE:FF"]), ("overview_iso_zoom", 1.5)])
def test_settings_on_a_persons_own_view_stays_theirs(key, value):
    data, conn = _set(True, False, **{key: value})
    conn.send_error.assert_not_called()
    assert data[key] == value


def test_settings_on_an_admin_changes_anything():
    data, conn = _set(True, True, vendor_lookup_enabled=False, update_check_enabled=False)
    conn.send_error.assert_not_called()
    assert data["vendor_lookup_enabled"] is False and data["update_check_enabled"] is False


@pytest.mark.parametrize("on", [None, False, True])
def test_only_an_admin_turns_the_switch_on_or_off(on):
    want = not on
    data, conn = _set(on, False, enhanced_security=want)
    assert conn.send_error.call_args.args[1] == "unauthorized"
    assert data.get("enhanced_security") is on
    data, conn = _set(on, True, enhanced_security=want)
    conn.send_error.assert_not_called()
    assert data["enhanced_security"] is want


def test_the_switch_is_reported_only_when_on():
    from custom_components.padspan_ha import telemetry as T
    assert T._FEATURE_ON_ONLY["enhanced_security"] == "enhanced_security"


# ── the panel ────────────────────────────────────────────────────────────────

_WWW = _CC / "www" / "padspan-ha"


def test_the_panel_shows_the_refusal_politely_and_keeps_it_up():
    src = (_WWW / "panel.js").read_text(encoding="utf-8")
    body = src[src.index("  async _callWS(payload){"):src.index("  // Fetch settings and store quietly")]
    assert 'err.code === "admin_only"' in body and "throw err;" in body, "the error must still reach the view"
    assert "this._adminOnlyToastUntil" in src[src.index("  _toast(msg, isErr=false){"):]


def test_the_settings_card_is_there_and_only_an_admin_can_press_it():
    src = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    card = src[src.index("// ── Enhanced security"):src.index("// ── Help improve PadSpan")]
    assert 'el("div", { class: "h2" }, "Enhanced security")' in card
    assert "settings.enhanced_security === true" in card, "off unless it is really on"
    assert "if (!secAdmin) { secBtn.disabled = true;" in card
    assert "settingsSet({ enhanced_security: !secOn })" in card
    assert "More protections will be added here over time." in card
    assert "can still view and use PadSpan" in card


# ── the sidebar Atlas page (lights_panel.js) ─────────────────────────────────

def _atlas_methods() -> str:
    src = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    start = src.index("  _ws(msg){")
    end = src.index("\n  }\n", src.index("  _toast(msg, isError=false, durationMs=null){")) + 4
    return src[start:end]


def test_every_atlas_command_goes_through_the_one_wrapper():
    src = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    # Only _ws itself and three reads (never refused) call hass.callWS directly.
    assert src.count("this._hass.callWS(") == 4
    # (The live snapshot's read sends slim:true with Optimize for scale on, 0.38.178.)
    for read in ('return this._hass.callWS(msg).then(r=>{ const snap', "(msg)=>this._hass.callWS(msg) }",
                 'this._hass.callWS({ type:"padspan_ha/house3d_get" })'):
        assert read in src
    assert "return Promise.resolve(this._hass.callWS(msg)).catch(" in _atlas_methods()


_ATLAS_JS = r"""
const shown = [];
globalThis.document = { body: { appendChild(t){ shown.push([t.textContent, t.style.cssText.includes("127,29,29")]); } },
  createElement(){ return { style: {}, remove(){} }; } };
globalThis.setTimeout = () => 0;
class P { %s }
const run = async (reply) => {
  shown.length = 0;
  const p = new P();
  p._hass = { callWS: async () => { if (reply instanceof Error) throw reply; return reply; } };
  let out, err = null;
  try { out = await p._ws({ type: "padspan_ha/settings_set", vacation_mode_enabled: true }); } catch (e) { err = e; }
  p._toast("Could not disable Vacation Mode: x", true);
  return { out: out ?? null, rethrown: err === reply, shown: shown.slice() };
};
const e = (code, message) => Object.assign(new Error(message), { code });
console.log(JSON.stringify({
  refused: await run(e("admin_only", "Only an admin can change this while Enhanced security is on")),
  other:   await run(e("unknown_error", "boom")),
  ok:      await run({ ok: true }),
}));
"""


@pytest.mark.skipif(__import__("shutil").which("node") is None, reason="node is not installed")
def test_the_atlas_page_says_a_change_needs_an_admin_and_nothing_else_changes():
    import json, shutil, subprocess
    res = subprocess.run([shutil.which("node"), "--input-type=module", "-e", _ATLAS_JS % _atlas_methods()],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    r = json.loads(res.stdout.strip().splitlines()[-1])
    # Refused while Enhanced security is on: the polite message, not red, and
    # the caller's own error toast right after it does not cover it.
    assert r["refused"]["rethrown"] is True
    assert r["refused"]["shown"] == [["Only an admin can change this while Enhanced security is on", False]]
    # Setting off (the server never answers admin_only): exactly as before,
    # the error reaches the caller and its own toast shows.
    assert r["other"]["rethrown"] is True
    assert r["other"]["shown"] == [["Could not disable Vacation Mode: x", True]]
    assert r["ok"]["out"] == {"ok": True} and r["ok"]["shown"] == [["Could not disable Vacation Mode: x", True]]


def test_the_card_does_not_promise_whole_home_display_settings():
    # Quiet mode and the Atlas's home-wide display settings change every
    # screen, so they stay an admin's while the switch is on; the card says so.
    for k in ("quiet_mode", "overview_atlas", "atlas_layout_v2", "lights_showcase_theme"):
        assert k not in WS._EVERYONE_KEYS, k
    src = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    card = src[src.index("// ── Enhanced security"):src.index("// ── Help improve PadSpan")]
    assert "their own view and theme choices" not in card
    assert "the choices kept in their own browser" in card and "Display settings that change every screen" in card


# 0.38.165's positioning choices change how every device is placed, so they
# are the home's setup: an admin's while the switch is on.
_POSITIONING_CHOICES = ("positioning_pick_better", "positioning_unsure", "positioning_sensor_fusion")


@pytest.mark.parametrize("key", _POSITIONING_CHOICES)
def test_positioning_choices_are_the_homes_setup(key):
    assert key not in WS._EVERYONE_KEYS
    data, conn = _set(True, False, **{key: True})
    assert conn.send_error.call_args.args[1] == "admin_only"
    assert data.get(key) is not True
    data, conn = _set(False, False, **{key: True})
    conn.send_error.assert_not_called()
    assert data[key] is True
